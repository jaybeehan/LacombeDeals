"""Check which public Flipp link formats work (used for 'Open on Flipp' links)."""
import os, requests
os.makedirs("probe_out", exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"}
fid = requests.get("https://backflipp.wishabi.com/flipp/flyers", params={"locale": "en-ca", "postal_code": "T4L2N3"}, headers=H).json()["flyers"][0]["id"]
item = requests.get("https://backflipp.wishabi.com/flipp/items/search", params={"locale": "en-ca", "postal_code": "T4L2N3", "q": "milk"}, headers=H).json()["items"][0]["flyer_item_id"]
urls = [f"https://flipp.com/en-ca/flyer/{fid}", f"https://flipp.com/flyer/{fid}", f"https://flipp.com/en-ca/lacombe-ab/flyer/{fid}",
        f"https://flipp.com/en-ca/item/{item}", f"https://flipp.com/item/{item}", f"https://flipp.com/en-ca/lacombe-ab/item/{item}",
        "https://flipp.com/en-ca/weekly_ads?postal_code=T4L2N3"]
with open("probe_out/links.txt", "w") as f:
    for u in urls:
        try:
            r = requests.get(u, headers=H, timeout=30, allow_redirects=True)
            import re
            t = re.findall(r"<title>(.*?)</title>", r.text, re.S)
            f.write(f"{r.status_code} {u} -> {r.url} | {t[:1]}\n")
        except Exception as e:
            f.write(f"ERR {u} {e}\n")
