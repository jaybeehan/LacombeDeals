"""Collect Lacombe grocery flyers and restaurant/delivery deals.

Run by GitHub Actions every 6 hours. Reads/writes long-term state in STATE_DIR
(kept on the `data` branch) and writes the JSON the web page reads into OUT_DIR.

    python collector/collect.py --state state --out site/data
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import traceback
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(__file__))
import config  # noqa: E402
from match import matches, normalize  # noqa: E402
from rating import is_active, rate  # noqa: E402
from units import savings_pct, unit_price  # noqa: E402

FLIPP = "https://backflipp.wishabi.com/flipp"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "en-CA,en;q=0.9"})
NOW = datetime.now(timezone.utc)
STATUS = {}  # source -> {"ok": bool, "msg": str}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get_json(url, params=None, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, params=params, timeout=40)
            if r.status_code == 200:
                return r.json()
            log("HTTP", r.status_code, url)
        except Exception as e:  # network hiccup
            log("ERR", url, e)
        time.sleep(2 + 3 * i)
    return None


def get_html(url):
    """Fetch a web page looking like a real Chrome (some sites block plain scripts)."""
    try:
        from curl_cffi import requests as cr
        r = cr.get(url, impersonate="chrome", timeout=40)
        return r.status_code, r.text
    except Exception:
        r = S.get(url, timeout=40)
        return r.status_code, r.text


def https(u):
    return u.replace("http://", "https://", 1) if u else u


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, data, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(data, f, ensure_ascii=False, indent=1)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def day(iso):
    return (iso or "")[:10]


# ---------------------------------------------------------------- groceries
def merchant_clean(m):
    return re.sub(r"\s+", " ", (m or "").strip())


def fetch_flyers():
    data = get_json(f"{FLIPP}/flyers", {"locale": "en-ca", "postal_code": config.POSTAL_CODE})
    if not data:
        raise RuntimeError("Flipp flyer list unavailable")
    out = []
    for f in data.get("flyers", []):
        cats = f.get("categories") or []
        if isinstance(cats, str):
            cats = cats.split(",")
        merchant = merchant_clean(f.get("merchant"))
        if "Groceries" not in cats or merchant in config.SKIP_MERCHANTS:
            continue
        if f.get("valid_to") and not is_active(f["valid_to"]):
            continue
        out.append({
            "id": f["id"], "merchant": merchant, "name": f.get("name") or "",
            "from": f.get("valid_from"), "to": f.get("valid_to"),
            "thumb": https(f.get("thumbnail_url")), "logo": https(f.get("merchant_logo")),
            "local": merchant in config.LACOMBE_STORES,
            "cats": [c for c in cats if c not in ("All Flyers", "Groceries")],
        })
    return out


def fetch_flyer_items(flyer):
    data = get_json(f"{FLIPP}/flyers/{flyer['id']}",
                    {"locale": "en-ca", "postal_code": config.POSTAL_CODE})
    items = []
    for it in (data or {}).get("items", []):
        name = (it.get("name") or "").strip()
        if not name or name.lower().startswith("banner") or not it.get("price"):
            continue
        try:
            price = float(it["price"])
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        items.append({
            "id": it.get("id"), "n": name, "p": price,
            "d": it.get("discount") or None,
            "img": https(it.get("cutout_image_url")),
            "url": it.get("ttm_url") or None,
        })
    return items


def search(q):
    data = get_json(f"{FLIPP}/items/search",
                    {"locale": "en-ca", "postal_code": config.POSTAL_CODE, "q": q})
    return (data or {}).get("items", [])


def build_item(it, flyer_ids, flyer_by_id):
    if it.get("item_type") not in (None, "flyer"):
        return None
    fid = it.get("flyer_id")
    if fid not in flyer_ids:
        return None  # not one of the grocery flyers we follow (e.g. pet store)
    name = (it.get("name") or "").strip()
    if not name:
        return None
    up = unit_price(name, it.get("current_price"), it.get("pre_price_text"),
                    it.get("post_price_text"), it.get("sale_story"))
    sav = savings_pct(it.get("current_price"), it.get("original_price"), it.get("sale_story"))
    fl = flyer_by_id[fid]
    return {
        "id": it.get("flyer_item_id") or it.get("id"),
        "fid": fid,
        "m": fl["merchant"],
        "n": name,
        "norm": normalize(name),
        "price": round(up.price, 2) if up.price is not None else None,
        "pre": (it.get("pre_price_text") or "").strip() or None,
        "post": (it.get("post_price_text") or "").strip() or None,
        "story": (it.get("sale_story") or "").strip() or None,
        "orig": it.get("original_price"),
        "up": round(up.unit_price, 4) if up.unit_price is not None else None,
        "b": up.basis,
        "ud": up.display(),
        "multi": up.multi,
        "sav": sav,
        "l1": it.get("_L1"), "l2": it.get("_L2"),
        "img": https(it.get("clean_image_url")),
        "to": it.get("valid_to") or fl["to"],
        "from": it.get("valid_from") or fl["from"],
    }


def collect_groceries(state_dir, out_dir):
    flyers = fetch_flyers()
    log(f"{len(flyers)} grocery flyers")
    flyer_by_id = {f["id"]: f for f in flyers}
    flyer_ids = set(flyer_by_id)

    # Full flyer listings (for browsing every item in a flyer)
    flyer_items = {}
    for f in flyers:
        items = fetch_flyer_items(f)
        f["count"] = len(items)
        flyer_items[str(f["id"])] = items
        time.sleep(0.3)
    log("flyer items:", sum(len(v) for v in flyer_items.values()))

    # Staple searches (proper unit prices + history)
    items = {}
    group_of = {}
    for q in config.STAPLES:
        for raw in search(q):
            it = build_item(raw, flyer_ids, flyer_by_id)
            if not it or it["price"] is None:
                continue
            items.setdefault(it["id"], it)
            # group = the search whose words actually appear in the name (used for
            # cross-store comparisons); fall back to the first search that found it
            if matches(q, it["n"]):
                if it["id"] not in group_of or not group_of[it["id"]][1]:
                    group_of[it["id"]] = (q, True)
            else:
                group_of.setdefault(it["id"], (q, False))
        time.sleep(0.25)
    log("searched items:", len(items))
    if len(items) < int(os.environ.get("MIN_ITEMS", "50")):
        raise RuntimeError(f"Only {len(items)} items found - Flipp may be failing")

    # -------- price history (kept on the data branch)
    hist_path = os.path.join(state_dir, "history.json")
    hist = load(hist_path, {"obs": {}})
    obs = hist["obs"]  # item_id -> [norm, merchant, unit_price, basis, valid_from_day, valid_to_day, price]
    for it in items.values():
        if it["up"] is None:
            continue
        obs[str(it["id"])] = [it["norm"], it["m"], it["up"], it["b"], day(it["from"]),
                              day(it["to"]), it["price"]]
    cutoff = (NOW - timedelta(days=400)).strftime("%Y-%m-%d")
    obs = {k: v for k, v in obs.items() if v[5] >= cutoff}
    hist["obs"] = obs
    hist["since"] = hist.get("since") or NOW.strftime("%Y-%m-%d")
    save(hist_path, hist)

    today = NOW.strftime("%Y-%m-%d")
    past_by_norm = defaultdict(list)
    for k, v in obs.items():
        if v[5] < today:  # finished flyers only
            past_by_norm[(v[0], v[3])].append(v[2])

    group_of = {k: (g if strong else "~" + g) for k, (g, strong) in group_of.items()}
    by_group = defaultdict(list)
    for iid, it in items.items():
        by_group[group_of[iid]].append(it)

    for iid, it in items.items():
        others = [] if group_of[iid].startswith("~") else [o["up"] for o in by_group[group_of[iid]]
                  if o["id"] != iid and o["b"] == it["b"] and o["up"] and o["m"] != it["m"]]
        r = rate(it["up"], it["b"], past_by_norm.get((it["norm"], it["b"]), []), others, it["sav"])
        it["tier"], it["pct"], it["why"] = r["tier"], r["pct"], r["reason"]
        it["g"] = group_of[iid].lstrip("~")
        it["dept"] = config.DEPT_OF.get(group_of[iid].lstrip("~"), "Other")

    # -------- compact history for the page (watchlist ratings run in the browser)
    merchants = sorted({v[1] for v in obs.values()})
    midx = {m: i for i, m in enumerate(merchants)}
    hist_out = defaultdict(list)
    for v in obs.values():
        hist_out[v[0]].append([v[4], round(v[2], 3), v[3], midx[v[1]], v[6], v[5]])
    for k in hist_out:
        hist_out[k].sort()

    save(os.path.join(out_dir, "flyers.json"), flyers)
    save(os.path.join(out_dir, "flyer_items.json"), flyer_items)
    save(os.path.join(out_dir, "items.json"), list(items.values()))
    save(os.path.join(out_dir, "history.json"),
         {"since": hist["since"], "merchants": merchants, "h": hist_out})
    return {"flyers": len(flyers), "items": len(items),
            "flyer_items": sum(len(v) for v in flyer_items.values()),
            "history_points": len(obs), "history_since": hist["since"]}


# ---------------------------------------------------------------- restaurants
PROMO_RE = re.compile(
    r"(\d+\s*%\s*off|\$\s*\d+(?:\.\d+)?\s*off|buy\s*\d+,?\s*get\s*\d+|buy\s*1|bogo|"
    r"free\s+(?:item|delivery|\w+)|spend\s+\$|save\s+\$|\$0\s+delivery|items?\s+on\s+sale|"
    r"offer|deal|\d+\+?\s+items on sale)", re.I)


def parse_store_cards(page_html, base):
    """Store cards on Uber Eats / DoorDash city pages: a link to /store/ with the name
    in an <h3>; promo badges are the short texts before or after the name."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(page_html, "lxml")
    out, seen = [], set()
    for a in soup.select('a[href*="/store/"]'):
        href = a.get("href") or ""
        if "/store/" not in href or href.startswith("https://play.") or "apps.apple" in href:
            continue
        card = a
        for _ in range(5):
            if card.find("h3"):
                break
            card = card.parent
        h3 = card.find("h3") if card else None
        if not h3:
            continue
        name = h3.get_text(" ", strip=True)
        url = href if href.startswith("http") else base + href
        key = url.split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        texts = [t.strip() for t in card.stripped_strings]
        promos, cuisine, address = [], "", ""
        for t in texts:
            if t == name or t in ("New", "Sponsored") or len(t) > 70 and "•" not in t:
                continue
            if "•" in t and not cuisine:
                cuisine = t
            elif re.search(r"\b(lacombe|AB|T4L)\b", t, re.I) and re.search(r"\d", t):
                address = t.rstrip(",")
            elif PROMO_RE.search(t) and len(t) <= 60 and not re.match(r"^\d\.\d", t):
                # "$0 delivery fee • 0.6 mi • 22 min" is a standard listing line, not a promo
                t = " • ".join(x for x in t.split(" • ")
                               if not re.search(r"^\$0 delivery fee$|\d\s*(mi|km|min)$", x.strip(), re.I))
                if t:
                    promos.append(t)
        address = re.sub(r",?\s*NAMER\b", ", AB", address).replace("\n", " ")
        kind = "grocery" if re.search(r"grocery|liquor|alcohol|convenience|pharmacy", cuisine, re.I) else "restaurant"
        out.append({"name": name, "url": key, "cuisine": cuisine, "address": address, "kind": kind,
                    "promos": list(dict.fromkeys(promos))})
    return out


def brand_of(name):
    b = re.sub(r"\s*\(.*?\)\s*", " ", name).strip()
    b = re.sub(r"\s+canada$", "", b, flags=re.I)
    if b.isupper() and len(b) > 4:
        b = b.title()
    return b


def collect_restaurants(state_dir, out_dir):
    st_path = os.path.join(state_dir, "restaurants.json")
    st = load(st_path, {"stores": {}})
    stores = st["stores"]
    now = NOW.isoformat()
    sources = {}
    for src, url, base in (("Uber Eats", config.UBER_EATS_URL, "https://www.ubereats.com"),
                           ("DoorDash", config.DOORDASH_URL, "https://www.doordash.com")):
        try:
            code, page = get_html(url)
            cards = parse_store_cards(page, base) if code == 200 else []
            sources[src] = {"ok": bool(cards), "count": len(cards), "url": url,
                            "msg": "" if cards else f"blocked or changed (HTTP {code})"}
            log(src, code, len(cards), "stores")
        except Exception as e:
            cards = []
            sources[src] = {"ok": False, "count": 0, "url": url, "msg": str(e)[:200]}
        if not cards:
            continue  # keep previous data for this source rather than wiping it
        seen_now = set()
        for c in cards:
            k = f"{src}|{c['url']}"
            seen_now.add(k)
            old = stores.get(k, {})
            promo_since = dict(old.get("promo_since", {}))
            for p in c["promos"]:
                promo_since.setdefault(p, now)
            promo_since = {p: t for p, t in promo_since.items() if p in c["promos"]}
            stores[k] = {"src": src, "name": c["name"], "brand": brand_of(c["name"]),
                         "url": c["url"], "cuisine": c["cuisine"], "address": c["address"],
                         "kind": c["kind"],
                         "promos": c["promos"], "promo_since": promo_since,
                         "first_seen": old.get("first_seen", now), "last_seen": now}
        for k, v in stores.items():
            if v["src"] == src and k not in seen_now:
                v["promos"], v["promo_since"] = [], {}
    # drop stores not seen for 30 days
    cutoff = (NOW - timedelta(days=30)).isoformat()
    st["stores"] = {k: v for k, v in stores.items() if v["last_seen"] >= cutoff}
    save(st_path, st)

    # ---- RedFlagDeals Hot Deals: restaurant + delivery-app deals, kept 30 days
    rfd_path = os.path.join(state_dir, "rfd.json")
    rfd = load(rfd_path, {"posts": {}})
    brands_here = {normalize(v["brand"]) for v in st["stores"].values()}
    try:
        r = S.get(config.RFD_FEED, timeout=40)
        posts = parse_rfd(r.text) if r.status_code == 200 else []
        sources["RedFlagDeals"] = {"ok": r.status_code == 200, "count": len(posts),
                                   "url": "https://forums.redflagdeals.com/hot-deals-f9/",
                                   "msg": "" if r.status_code == 200 else f"HTTP {r.status_code}"}
        for p in posts:
            cls = classify_rfd(p["title"], p["summary"], brands_here)
            if cls:
                p.update(cls)
                rfd["posts"].setdefault(p["id"], p).update(p)
    except Exception as e:
        sources["RedFlagDeals"] = {"ok": False, "count": 0, "msg": str(e)[:200]}
    cutoff = (NOW - timedelta(days=30)).isoformat()
    rfd["posts"] = {k: v for k, v in rfd["posts"].items() if (v.get("published") or "") >= cutoff[:10]}
    save(rfd_path, rfd)

    out_stores = sorted(st["stores"].values(), key=lambda v: (not v["promos"], v["brand"].lower()))
    save(os.path.join(out_dir, "restaurants.json"), {
        "stores": out_stores,
        "rfd": sorted(rfd["posts"].values(), key=lambda p: p.get("published", ""), reverse=True),
        "sources": sources,
    })
    return {"stores": len(out_stores), "with_promos": sum(1 for s in out_stores if s["promos"]),
            "rfd": len(rfd["posts"]), "sources": sources}


def parse_rfd(xml):
    posts = []
    for m in re.finditer(r"<entry>(.*?)</entry>", xml, re.S):
        e = m.group(1)

        def tag(t):
            mm = re.search(rf"<{t}[^>]*>(.*?)</{t}>", e, re.S)
            v = mm.group(1) if mm else ""
            v = re.sub(r"^<!\[CDATA\[|\]\]>$", "", v.strip())
            return html.unescape(v).strip()

        link = re.search(r'<link href="([^"]+)"', e)
        link = html.unescape(link.group(1)) if link else ""
        tid = re.search(r"t=(\d+)", link)
        title = tag("title")
        summary = re.sub(r"<[^>]+>", " ", tag("content"))
        summary = re.sub(r"Statistics:.*$", "", summary, flags=re.S)
        summary = re.sub(r"\s+", " ", summary).strip()[:280]
        retailer = re.match(r"\s*\[([^\]]+)\]", title)
        posts.append({
            "id": tid.group(1) if tid else link,
            "title": title, "link": link.split("&p=")[0],
            "published": tag("published"), "retailer": retailer.group(1) if retailer else "",
            "summary": summary,
        })
    return posts


def classify_rfd(title, summary, brands_here):
    text = f" {title} {summary} ".lower()
    tl = f" {title} ".lower()
    for app, words in config.DELIVERY_APPS.items():
        if any(w in tl for w in words):
            return {"kind": "delivery", "chain": app, "local": True}
    for c in config.CHAINS:
        cl = c.lower()
        if re.search(r"(?<![a-z])" + re.escape(cl) + r"(?![a-z])", tl):
            here = normalize(c) in brands_here or any(normalize(c) in b for b in brands_here)
            return {"kind": "restaurant", "chain": c, "local": bool(here)}
    if re.search(r"\[(restaurant|food)", tl) or "restaurant" in tl:
        return {"kind": "restaurant", "chain": "", "local": False}
    return None


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="state")
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--only", choices=["groceries", "restaurants"])
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(a.state, exist_ok=True)
    meta_path = os.path.join(a.out, "meta.json")
    meta = load(meta_path, {})
    meta.update({"postal_code": config.POSTAL_CODE, "town": config.TOWN})
    ok = True
    for part, fn in (("groceries", collect_groceries), ("restaurants", collect_restaurants)):
        if a.only and a.only != part:
            continue
        try:
            stats = fn(a.state, a.out)
            meta[part] = {"ok": True, "updated": NOW.isoformat(), "stats": stats}
        except Exception as e:
            traceback.print_exc()
            ok = False
            prev = meta.get(part, {})
            meta[part] = {**prev, "ok": False, "error": str(e)[:300], "failed_at": NOW.isoformat()}
    meta["updated"] = NOW.isoformat()
    save(meta_path, meta, pretty=True)
    log("done", json.dumps({k: v.get("ok") for k, v in meta.items() if isinstance(v, dict)}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
