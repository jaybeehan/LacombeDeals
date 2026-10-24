"""Fetch live samples from each data source so parsers can be checked against real data."""
import json, os, sys, traceback
os.makedirs("probe_out", exist_ok=True)
PC = "T4L2N3"
def save(name, data):
    mode = "w" if isinstance(data, str) else "wb"
    with open(f"probe_out/{name}", mode) as f:
        f.write(data)
def run(name, fn):
    try:
        fn(); print("OK", name)
    except Exception:
        print("FAIL", name); traceback.print_exc()
import requests
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
     "Accept-Language": "en-CA,en;q=0.9"}
def flipp_search():
    for q in ["chicken breast", "milk", "ground beef", "pizza"]:
        r = requests.get("https://backflipp.wishabi.com/flipp/items/search",
                         params={"locale": "en-ca", "postal_code": PC, "q": q}, headers=H, timeout=30)
        save(f"flipp_search_{q.replace(' ','_')}.json", r.text)
def flipp_flyers():
    r = requests.get("https://backflipp.wishabi.com/flipp/flyers",
                     params={"locale": "en-ca", "postal_code": PC}, headers=H, timeout=30)
    save("flipp_flyers.json", r.text)
    fl = r.json().get("flyers", [])
    n = 0
    for f in fl:
        cats = f.get("categories")
        cats = ",".join(cats) if isinstance(cats, list) else str(cats)
        if "Groc" in cats or "Restaurant" in cats or n < 2:
            r2 = requests.get(f"https://backflipp.wishabi.com/flipp/flyers/{f['id']}",
                              params={"locale": "en-ca", "postal_code": PC}, headers=H, timeout=30)
            save(f"flipp_flyer_{f['id']}_{str(f.get('merchant','')).replace(' ','_').replace('/','')}.json", r2.text)
            n += 1
            if n >= 14: break
def html_pages():
    pages = {
      "doordash": "https://www.doordash.com/en/food-delivery/lacombe-ab-restaurants/",
      "ubereats": "https://www.ubereats.com/ca/city/lacombe-ab",
      "skip": "https://www.skipthedishes.com/lacombe",
      "rfd_rss": "https://forums.redflagdeals.com/feed/forum/9",
    }
    for k, u in pages.items():
        try:
            r = requests.get(u, headers=H, timeout=30)
            save(f"{k}_requests_{r.status_code}.html", r.text)
        except Exception as e:
            save(f"{k}_requests_ERR.txt", repr(e))
        try:
            from curl_cffi import requests as cr
            r = cr.get(u, impersonate="chrome", timeout=30)
            save(f"{k}_cffi_{r.status_code}.html", r.text)
        except Exception as e:
            save(f"{k}_cffi_ERR.txt", repr(e))
run("flipp_search", flipp_search)
run("flipp_flyers", flipp_flyers)
run("html", html_pages)
