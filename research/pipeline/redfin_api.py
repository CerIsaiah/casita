#!/usr/bin/env python3
"""Redfin rentals, for the quarter of them that are not Zillow wearing a hat.

This one nearly did not get built, on my own advice, and the advice was wrong
for an instructive reason: I said Redfin rentals were CoStar inventory and
therefore a duplicate of Apartments.com. They are not CoStar. They are mostly
*Zillow*, which we already scrape directly, so the conclusion happened to
survive while the reasoning did not.

The listings say so themselves. Every row carries `feedOriginalSource`:

    ZILLOW 260 · LOVELY 66 · REDFIN 23 · APPFOLIO 1

So three quarters of what comes back is a source we already hold, and adding
this means most of the work lands on merge.py's deduper. What justifies it is
the other quarter: measured against our data by normalised street address, 27%
of a 350-row sample were addresses nothing else carried - and that share lines
up almost exactly with the non-Zillow rows, which is the consistency check that
makes the number believable rather than a coincidence of address formatting.

REDFIN_DIY is the interesting slice. Those are landlords listing directly on
Redfin rather than through an agent or a syndication feed, which is the same
kind of inventory Craigslist has and the aggregators mostly miss.

It also carries `isIncomeRestricted`, which is the only structured
below-market-rate flag on any feed in this pipeline. Only a handful of rows in
San Francisco set it, so it is thin rather than useless, and it is passed
through rather than scored.

Plain JSON, no key, no browser, no bot wall. Two requests cover the city.

    python3 redfin_api.py            sweep, write redfin_raw.json
    python3 redfin_api.py --dry      show the counts, write nothing
"""
import collections
import gzip
import json
import pathlib
import random
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "redfin_raw.json"

# region 17151 / type 6 is the city of San Francisco in Redfin's gazetteer.
API = ("https://www.redfin.com/stingray/api/v1/search/rentals"
       "?al=1&market=sanfrancisco&region_id=17151&region_type=6")
PAGE = "https://www.redfin.com/city/17151/CA/San-Francisco/apartments-for-rent"
PHOTO = "https://ssl.cdn-redfin.com/photo/rent/{rid}/islphoto/genIsl.{i}_{v}.jpg"
SF = (37.70, 37.84, -122.52, -122.35)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
# An XHR, not a navigation: this is the request the rentals page makes after it
# loads, and the Sec-Fetch triple has to say so or it is refused.
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Referer": PAGE,
}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as h:
                raw = h.read()
                if h.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            time.sleep(2 * (i + 1) + random.random())
        except Exception:
            time.sleep(2 * (i + 1) + random.random())
    return None


def payload(text):
    """Redfin prefixes some of its endpoints with `{}&&` to break naive eval.

    The rentals endpoint currently does not, but the GIS one on the same host
    does, and a harvester that assumes today's behaviour is a harvester that
    breaks quietly. Skipping to the first `{` after any guard prefix costs
    nothing and survives them turning it on.
    """
    if not text:
        return None
    i = text.find('{"')
    if i == -1:
        i = text.find("{")
    try:
        return json.loads(text[i:])
    except Exception:
        return None


def photos(home, rx, cap=8):
    """Rebuild the gallery from the ranges the feed describes it with.

    Redfin does not hand over image URLs. It gives a rental id and a list of
    position ranges, each with its own version stamp, and the URL is assembled
    from the three. Photo 4 is not necessarily the same version as photo 0,
    which is why this walks the ranges rather than assuming one.
    """
    rid = rx.get("rentalId")
    if not rid:
        return []
    out = []
    for r in (home.get("photosInfo") or {}).get("photoRanges") or []:
        v = r.get("version")
        for i in range(r.get("startPos", 0), (r.get("endPos", 0)) + 1):
            out.append(PHOTO.format(rid=rid, i=i, v=v))
            if len(out) >= cap:
                return out
    return out


def in_sf(home):
    c = ((home.get("addressInfo") or {}).get("centroid") or {}).get("centroid") or {}
    try:
        la, lo = float(c.get("latitude")), float(c.get("longitude"))
    except (TypeError, ValueError):
        return False
    return SF[0] <= la <= SF[1] and SF[2] <= lo <= SF[3]


def harvest(page_size=350, max_pages=6, pace=1.4):
    out, seen, total = [], set(), None
    for p in range(max_pages):
        d = payload(get(f"{API}&num_homes={page_size}&start={p * page_size}"))
        homes = (d or {}).get("homes") or []
        if total is None:
            total = (d or {}).get("numMatchedHomes")
        if not homes:
            break
        fresh = 0
        for h in homes:
            hd, rx = h.get("homeData") or {}, h.get("rentalExtension") or {}
            pid = hd.get("propertyId") or rx.get("rentalId")
            if not pid or pid in seen or not in_sf(hd):
                continue
            seen.add(pid)
            out.append(h)
            fresh += 1
        print(f"  start {p * page_size:>4}: {len(homes):>3} rows, {fresh:>3} new "
              f"(total {len(out):,} of {total or '?'})", flush=True)
        if len(homes) < page_size:
            break
        time.sleep(pace * random.uniform(0.8, 1.2))
    return out


def main():
    rows = harvest()
    print(f"\n  collected {len(rows):,} rentals in San Francisco")
    feeds = collections.Counter(
        (r.get("rentalExtension") or {}).get("feedOriginalSource") or "(none)"
        for r in rows)
    print("  where they originally came from:")
    for k, v in feeds.most_common(8):
        note = "  <- we already scrape this directly" if k == "ZILLOW" else ""
        print(f"    {str(k)[:26]:28} {v:>5}{note}")
    rx = [r.get("rentalExtension") or {} for r in rows]
    print(f"  with a description: {sum(1 for r in rx if (r.get('description') or '').strip()):,}")
    print(f"  below-market-rate flagged: {sum(1 for r in rx if r.get('isIncomeRestricted')):,}")
    if "--dry" in sys.argv:
        return
    json.dump(rows, open(OUT, "w"))
    print(f"  wrote {OUT.name}")


if __name__ == "__main__":
    main()
