"""Craigslist SF, parallelised across price bands."""
import json, time, urllib.parse, urllib.request

TOK = [l.split("=", 1)[1].strip() for l in
       open("/Users/icerven/Documents/apt-hunt/.env") if l.startswith("APIFY_API_TOKEN=")][0]
Q = urllib.parse.quote(TOK)

# kill the stalled run first
try:
    runs = json.load(urllib.request.urlopen(
        f"https://api.apify.com/v2/actor-runs?token={Q}&limit=10&desc=1", timeout=40))["data"]["items"]
    for r in runs:
        if r.get("actId") == "NYrMCo2bNksJVKebg" and r["status"] == "RUNNING":
            req = urllib.request.Request(
                f"https://api.apify.com/v2/actor-runs/{r['id']}/abort?token={Q}", method="POST")
            urllib.request.urlopen(req, timeout=40)
            print("aborted stalled run", r["id"])
except Exception as e:
    print("abort:", e)

BANDS = [(0, 1800), (1800, 2400), (2400, 3000), (3000, 3800), (3800, 5000), (5000, 30000)]
BASE = "https://sfbay.craigslist.org/search/sfc/apa"

started = []
for lo, hi in BANDS:
    url = f"{BASE}?min_price={lo}&max_price={hi}"
    payload = {
        "startUrls": [{"url": url}],
        "includeDetails": True,
        "extractReplyEmail": False,
        "hideDuplicates": True,
        "maxItems": 700,
        "maxConcurrency": 24,
        "maxRequestRetries": 6,
    }
    req = urllib.request.Request(
        f"https://api.apify.com/v2/acts/memo23~craigslist-scraper/runs?token={Q}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))["data"]
        started.append((f"{lo}-{hi}", d["id"], d["defaultDatasetId"]))
        print(f"started ${lo}-${hi}: {d['id']}", flush=True)
    except Exception as e:
        print(f"FAILED ${lo}-${hi}: {e}", flush=True)

t0 = time.time()
pending = {i: (nm, ds) for nm, i, ds in started}
out = []
while pending and time.time() - t0 < 2400:
    time.sleep(25)
    for rid in list(pending):
        nm, ds = pending[rid]
        try:
            st = json.load(urllib.request.urlopen(
                f"https://api.apify.com/v2/actor-runs/{rid}?token={Q}", timeout=60))["data"]
        except Exception:
            continue
        if st["status"] in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            del pending[rid]
            print(f"  done ${nm}: {st['status']} ${st.get('usageTotalUsd')}", flush=True)
    if pending:
        tot = 0
        for rid, (nm, ds) in pending.items():
            try:
                tot += json.load(urllib.request.urlopen(
                    f"https://api.apify.com/v2/datasets/{ds}?token={Q}", timeout=30))["data"].get("itemCount", 0)
            except Exception: pass
        print(f"  [{int(time.time()-t0)}s] {len(pending)} bands running · {tot} items so far", flush=True)

seen = set()
for nm, rid, ds in started:
    off = 0
    while True:
        chunk = json.load(urllib.request.urlopen(
            f"https://api.apify.com/v2/datasets/{ds}/items?token={Q}&clean=true&limit=1000&offset={off}",
            timeout=240))
        for it in chunk:
            k = it.get("id") or it.get("url")
            if k and k not in seen:
                seen.add(k); out.append(it)
        if len(chunk) < 1000: break
        off += 1000

json.dump(out, open("craigslist_full.json", "w"))
print(f"\nCraigslist total unique: {len(out):,}")
