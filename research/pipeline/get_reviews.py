"""Google ratings + a few reviews per building, batched."""
import json, math, time, urllib.parse, urllib.request

TOK = [l.split("=", 1)[1].strip() for l in
       open("/Users/icerven/Documents/apt-hunt/.env") if l.startswith("APIFY_API_TOKEN=")][0]
Q = urllib.parse.quote(TOK)

import math
targets = json.load(open("review_targets.json"))
apt = {}
for a in json.load(open("app_data.json")):
    import re as _re
    k = _re.sub(r"[,#].*$", "", (a["addr"] or "")).strip()
    if k and k not in apt: apt[k] = (a["lat"], a["lon"])
targets = [(t, *apt[t]) for t in targets if t in apt]
BATCH = 25
batches = [targets[i:i+BATCH] for i in range(0, len(targets), BATCH)]
print(f"{len(targets)} addresses in {len(batches)} batches", flush=True)

runs = []
for i, b in enumerate(batches):
    def box(lat, lon, m=180):
        dla = m / 110540.0
        dlo = m / (111320.0 * math.cos(math.radians(lat)))
        return [[[lon-dlo, lat-dla], [lon+dlo, lat-dla], [lon+dlo, lat+dla],
                 [lon-dlo, lat+dla], [lon-dlo, lat-dla]]]
    payload = {
        "searchStringsArray": ["apartment building"],
        "customGeolocation": {"type": "MultiPolygon",
                              "coordinates": [box(la, lo) for _, la, lo in b]},
        "maxCrawledPlacesPerSearch": 70,
        "maxReviews": 8,
        "reviewsSort": "newest",
        "language": "en",
        "scrapePlaceDetailPage": False,
        "skipClosedPlaces": False,
    }
    req = urllib.request.Request(
        f"https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token={Q}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))["data"]
        runs.append((i, d["id"], d["defaultDatasetId"]))
        print(f"  batch {i+1}/{len(batches)} started", flush=True)
    except Exception as e:
        print(f"  batch {i+1} FAILED: {e}", flush=True)
    time.sleep(1)

t0, pending, spend = time.time(), {r[1]: r for r in runs}, 0.0
while pending and time.time() - t0 < 3000:
    time.sleep(25)
    for rid in list(pending):
        try:
            st = json.load(urllib.request.urlopen(
                f"https://api.apify.com/v2/actor-runs/{rid}?token={Q}", timeout=60))["data"]
        except Exception:
            continue
        if st["status"] in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            spend += st.get("usageTotalUsd") or 0
            del pending[rid]
    print(f"  [{int(time.time()-t0)}s] {len(pending)} batches left · ${spend:.2f}", flush=True)

out = []
for i, rid, ds in runs:
    off = 0
    while True:
        try:
            c = json.load(urllib.request.urlopen(
                f"https://api.apify.com/v2/datasets/{ds}/items?token={Q}&clean=true"
                f"&limit=1000&offset={off}", timeout=180))
        except Exception:
            break
        out += c
        if len(c) < 1000: break
        off += 1000

json.dump(out, open("google_places.json", "w"))
rated = [p for p in out if p.get("totalScore")]
print(f"\nplaces returned: {len(out):,}   with a rating: {len(rated):,}")
print(f"total spend: ${spend:.2f}")
