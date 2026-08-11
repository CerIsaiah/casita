"""Full SF listing sweep across platforms."""
import json, time, urllib.parse, urllib.request

TOK = [l.split("=", 1)[1].strip() for l in
       open("/Users/icerven/Documents/apt-hunt/.env") if l.startswith("APIFY_API_TOKEN=")][0]
Q = urllib.parse.quote(TOK)

SQS = {
  "pagination": {},
  "usersSearchTerm": "San Francisco, CA",
  "mapBounds": {"west": -122.5170, "east": -122.3560, "south": 37.7040, "north": 37.8340},
  "isMapVisible": True,
  "filterState": {
     "fore": {"value": False}, "auc": {"value": False}, "nc": {"value": False},
     "fsbo": {"value": False}, "cmsn": {"value": False}, "fsba": {"value": False},
     "fr": {"value": True}},
  "isListVisible": True,
}
ZURL = ("https://www.zillow.com/san-francisco-ca/rentals/?searchQueryState="
        + urllib.parse.quote(json.dumps(SQS, separators=(",", ":"))))

JOBS = [
  ("apartments", "epctex~apartments-scraper-api", {
      "search": "San Francisco, CA", "maxItems": 3000,
      "includeReviews": False, "includeVisuals": True,
      "includeInteriorAmenities": True}),

]

runs = {}
for name, act, payload in JOBS:
    req = urllib.request.Request(
        f"https://api.apify.com/v2/acts/{act}/runs?token={Q}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))["data"]
        runs[name] = (d["id"], d["defaultDatasetId"])
        print(f"started {name}: {d['id']}", flush=True)
    except Exception as e:
        print(f"FAILED start {name}: {e}", flush=True)

t0 = time.time()
done = {}
while runs and time.time() - t0 < 3300:
    time.sleep(20)
    for name in list(runs):
        rid, ds = runs[name]
        try:
            st = json.load(urllib.request.urlopen(
                f"https://api.apify.com/v2/actor-runs/{rid}?token={Q}", timeout=60))["data"]
        except Exception:
            continue
        n = (st.get("stats") or {}).get("itemCount")
        if st["status"] in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            done[name] = (ds, st["status"], st.get("usageTotalUsd"))
            del runs[name]
            print(f"  DONE {name}: {st['status']} ${st.get('usageTotalUsd')}", flush=True)
    if runs:
        print(f"  [{int(time.time()-t0)}s] running: {', '.join(runs)}", flush=True)

total = 0.0
out = {}
for name, (ds, status, usd) in done.items():
    items, off = [], 0
    while True:
        chunk = json.load(urllib.request.urlopen(
            f"https://api.apify.com/v2/datasets/{ds}/items?token={Q}&clean=true"
            f"&limit=1000&offset={off}", timeout=240))
        items += chunk
        if len(chunk) < 1000:
            break
        off += 1000
    out[name] = items
    total += (usd or 0)
    print(f"{name}: {len(items):,} items  status={status}  ${usd}", flush=True)

# Zillow's JSON endpoint is behind PerimeterX, but its ordinary search pages
# embed the same listing data in __NEXT_DATA__.
try:
    import zillow_api
    zs, zr = set(), []
    zillow_api.harvest(0, 30000, zs, zr)
    out["zillow"] = [r for r in zr if r["latitude"] and r["unformattedPrice"]
                     and 37.70 <= r["latitude"] <= 37.84
                     and -122.52 <= r["longitude"] <= -122.35]
    print(f"zillow (free): {len(out['zillow']):,} items", flush=True)
except Exception as e:
    print("zillow failed:", e, flush=True)

# Craigslist comes from its own JSON API -- free, complete, and far faster than
# crawling detail pages, which throttles at ~200 items.
try:
    import craigslist_api
    seen, cl = set(), []
    for path in ["sfc/apa", "sfc/roo"]:
        craigslist_api.harvest(path, 0, 30000, 0, seen, cl)
    out["craigslist"] = [r for r in cl if r["latitude"] and r["price"]
                         and 37.70 <= r["latitude"] <= 37.84
                         and -122.52 <= r["longitude"] <= -122.35]
    print(f"craigslist (free API): {len(out['craigslist']):,} items", flush=True)
except Exception as e:
    print("craigslist API failed:", e, flush=True)

# Zumper is the fourth source and the only one that is neither CoStar nor a
# direct-from-renter board. Its listings come off landlord-side property
# management systems -- AppFolio, Yardi, Entrata, ShowMojo, Intellirent -- which
# is why roughly a third of them are addresses the other three never carried.
# It publishes floor area on every row, where we manage 56%, and prose on about
# three quarters, free, which is what the Zillow half of the pipeline pays for.
# Plain HTTP, no browser, no key.
try:
    import zumper_api
    zr = zumper_api.harvest()
    out["zumper"] = [r for r in zr if r.get("lat") and r.get("min_price")]
    print(f"zumper (free): {len(out['zumper']):,} items", flush=True)
except Exception as e:
    print("zumper failed:", e, flush=True)

json.dump(out, open("listings_raw.json", "w"))
print(f"\nTOTAL SPEND: ${total:.2f}", flush=True)
