#!/usr/bin/env python3
"""Zillow listing detail, via Apify, for the pages we cannot reach ourselves.

Zillow's search feed carries no description and no floor area, and its listing
pages sit behind PerimeterX. A plain request with the right headers gets
through once; a few hundred in a row does not, and pushing it got this IP
refused for everything including the search pages the rest of the pipeline
depends on. Reusing the browser's own session cookie would very likely burn
that session too, which is a bad trade for a field on a rental listing.

So this rents the problem out. The actor runs on residential proxies that are
not ours, which keeps our address out of it entirely -- the same reasoning that
already sends Apartments.com through Apify.

It is the only paid step in the description pipeline, and it is opt-in for that
reason: roughly $0.003 a listing, so about $3.50 for a full San Francisco
sweep. Craigslist and the Zillow search feed stay free.

Two fields come back that nothing else in the pipeline has:

  description   the prose add_qualities.py reads for two-level layouts, views,
                ground-floor units and a manager on the landing
  livingArea    square footage, which the search feed omits entirely, leaving
                the Space factor unable to score a third of the data set

    python3 add_zillow_apify.py            every Zillow listing missing prose
    python3 add_zillow_apify.py --limit 50 cap the spend while testing
    python3 add_zillow_apify.py --dry      show the cost, run nothing
"""
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import atomicjson

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "app_data.json"
CACHE = HERE / "zillow_detail.json"
ACTOR = "maxcopell~zillow-detail-scraper"
PER_ITEM_USD = 0.003


def token():
    t = os.environ.get("APIFY_API_TOKEN")
    if t:
        return t
    env = HERE.parent.parent / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("APIFY_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("no APIFY_API_TOKEN in the environment or .env")


def api(path, tok, data=None, timeout=60):
    url = f"https://api.apify.com/v2/{path}{'&' if '?' in path else '?'}token={urllib.parse.quote(tok)}"
    req = urllib.request.Request(
        url, data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as h:
        return json.load(h)


def main():
    tok = token()
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    dry = "--dry" in sys.argv

    data = json.load(open(DATA))
    try:
        cache = json.loads(CACHE.read_text())
    except Exception:
        cache = {}

    todo = []
    for a in data:
        s = (a.get("src") or [{}])[0]
        u = s.get("u")
        if s.get("n") != "Zillow" or not u:
            continue
        if (a.get("desc") or "").strip("None "):
            continue
        if u in cache or u in todo:
            continue
        todo.append(u)
    if limit:
        todo = todo[:limit]

    print(f"  zillow listings needing prose: {len(todo):,}  "
          f"(cached {len(cache):,})")
    print(f"  estimated cost: ${len(todo) * PER_ITEM_USD:,.2f}")
    if dry or not todo:
        return

    run = api(f"acts/{ACTOR}/runs", tok,
              {"startUrls": [{"url": u} for u in todo]})["data"]
    rid, dsid = run["id"], run["defaultDatasetId"]
    print(f"  run {rid} started", flush=True)

    t0 = time.time()
    while time.time() - t0 < 5400:
        time.sleep(20)
        st = api(f"actor-runs/{rid}", tok)["data"]
        n = (st.get("stats") or {}).get("itemCount") or 0
        if st["status"] != "RUNNING":
            print(f"  {st['status']}  items {n:,}  cost ${st.get('usageTotalUsd') or 0:.2f}",
                  flush=True)
            break
        print(f"    [{int(time.time() - t0)}s] {n:,} so far", flush=True)

    # Paginate the dataset; a full sweep is well past one page.
    got, offset = [], 0
    while True:
        page = api(f"datasets/{dsid}/items?limit=1000&offset={offset}", tok)
        if not page:
            break
        got += page
        offset += len(page)
        if len(page) < 1000:
            break
    print(f"  dataset rows: {len(got):,}")

    for r in got:
        # The actor echoes the URL it was given, which is how a row is matched
        # back to a listing -- Zillow's own `url` field is sometimes a
        # canonicalised variant that no longer equals what we asked for.
        u = r.get("addressOrUrlFromInput") or r.get("url")
        if not u:
            continue
        cache[u] = {"desc": (r.get("description") or "").strip(),
                    "sqft": r.get("livingArea")}
    atomicjson.dump(cache, str(CACHE))

    added = sqft = 0
    for a in data:
        u = (a.get("src") or [{}])[0].get("u")
        hit = cache.get(u or "")
        if not hit:
            continue
        if hit.get("desc") and not (a.get("desc") or "").strip("None "):
            a["desc"] = hit["desc"][:4000]
            added += 1
        if hit.get("sqft") and not a.get("sqft"):
            a["sqft"] = hit["sqft"]
            sqft += 1
    atomicjson.dump(data, str(DATA))

    have = sum(1 for a in data if (a.get("desc") or "").strip("None "))
    print(f"\n  descriptions attached: {added:,}   square footage filled: {sqft:,}")
    print(f"  listings with a description now: {have:,} of {len(data):,}")


if __name__ == "__main__":
    main()
