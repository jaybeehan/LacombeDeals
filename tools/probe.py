import requests, os, json
os.makedirs("probe_out", exist_ok=True)
H={"User-Agent":"Mozilla/5.0 Chrome/130"}
urls={
 "recent_en":"https://healthycanadians.gc.ca/recall-alert-rappel-avis/api/recent/en",
 "search_food":"https://healthycanadians.gc.ca/recall-alert-rappel-avis/api/search?search=&lang=en&cat=1&lim=25",
 "opendata":"https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json",
 "cfia_rss":"https://recalls-rappels.canada.ca/en/feed/cfia-alerts-recalls",
}
for k,u in urls.items():
    try:
        r=requests.get(u,headers=H,timeout=60)
        open(f"probe_out/{k}_{r.status_code}.txt","w").write(r.text[:400000])
    except Exception as e:
        open(f"probe_out/{k}_ERR.txt","w").write(repr(e))
