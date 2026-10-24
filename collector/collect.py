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
def collect_restaurants(state_dir, out_dir):
    """Restaurant deals posted on RedFlagDeals (kept for 30 days). No delivery apps."""
    old = os.path.join(state_dir, "restaurants.json")  # from the delivery-app version
    if os.path.exists(old):
        os.remove(old)
    rfd_path = os.path.join(state_dir, "rfd.json")
    rfd = load(rfd_path, {"posts": {}})
    rfd["posts"] = {k: v for k, v in rfd["posts"].items() if classify_rfd(v["title"], v.get("summary", ""))}
    r = S.get(config.RFD_FEED, timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"RedFlagDeals feed HTTP {r.status_code}")
    posts = parse_rfd(r.text)
    for p in posts:
        cls = classify_rfd(p["title"], p["summary"])
        if cls:
            p.update(cls)
            rfd["posts"].setdefault(p["id"], p).update(p)
    cutoff = (NOW - timedelta(days=30)).isoformat()[:10]
    rfd["posts"] = {k: v for k, v in rfd["posts"].items() if (v.get("published") or "")[:10] >= cutoff}
    save(rfd_path, rfd)
    save(os.path.join(out_dir, "restaurants.json"), {
        "restaurants": config.LACOMBE_RESTAURANTS,
        "rfd": sorted(rfd["posts"].values(), key=lambda p: p.get("published", ""), reverse=True),
    })
    return {"rfd_posts_checked": len(posts), "rfd_kept": len(rfd["posts"])}


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


def _key(t):
    return re.sub(r"[^a-z0-9]", "", t.lower().replace("&", "and"))


LOCAL_KEYS = {_key(r["name"]) for r in config.LACOMBE_RESTAURANTS}


def classify_rfd(title, summary):
    tl = f" {title} ".lower()
    if any(w in f" {title} {summary} ".lower() for w in config.DELIVERY_WORDS):
        return None  # delivery-app deals are not wanted
    for c in config.CHAINS:
        if re.search(r"(?<![a-z])" + re.escape(c.lower()) + r"(?![a-z])", tl):
            k = _key(c)
            local = any(k in lk or lk in k for lk in LOCAL_KEYS) or (k == "tims" and "timhortons" in LOCAL_KEYS) \
                or (k == "mcdonalds" and "mcdonalds" in LOCAL_KEYS)
            name = {"tims": "Tim Hortons", "mcdonalds": "McDonald's", "dominos": "Domino's",
                    "mrmikes": "Mr. Mike's"}.get(k, c)
            return {"kind": "restaurant", "chain": name, "local": bool(local)}
    if re.search(r"\[(restaurant|food)", tl) or " restaurant" in tl:
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
