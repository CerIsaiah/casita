#!/usr/bin/env python3
"""Zumper, without the browser its old scraper insisted on.

src/casita/zumper.py already reads this site, and it drives Playwright to do
it. That turns out to be unnecessary: Zumper server-renders the whole result
set into `window.__PRELOADED_STATE__`, so one plain HTTP request returns 25
fully-structured listings and a browser buys nothing but startup cost and a
bigger fingerprint. It also hard-codes the previous owner's search - two and
three bedrooms, dogs, six Richmond and Sunset slugs - which is not a city.

WHY IT IS WORTH A FOURTH SOURCE. The question that decides this is not "does
it have listings", it is "are they the same listings". Apartments.com is
CoStar inventory, and most rental aggregators are reselling exactly that, so
adding one is usually a day's work to import duplicates.

Zumper is not. Every listing carries `feed_name`, which names the system that
supplied it, and in a 200-row sample those were landlord-side property
management platforms - AppFolio, Yardi, Entrata, RealPage, ShowMojo,
Intellirent - with no CoStar feed present at all. Measured against our existing
data by normalised street address, 36% of that sample were addresses we did not
have. That is a different pipeline, not a mirror.

It also closes a real gap. Floor area is published for every Zumper row; ours
sits at 56%, which is why the Space factor cannot score nearly half the data
set. `short_description` arrives on about 70% of them, free, which is prose the
Zillow half of the pipeline pays Apify for.

What it is weaker at: the new inventory skews to large managed buildings and
corporate operators, so a fair slice of it lands above a normal budget and gets
filtered straight back out. It is an addition to Craigslist's small landlords,
not a replacement for them.

    python3 zumper_api.py            sweep the city, write zumper_raw.json
    python3 zumper_api.py --pages 4  stop early, for testing
"""
import collections
import gzip
import json
import pathlib
import random
import re
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "zumper_raw.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

ROOT = "https://www.zumper.com"
CITY = ROOT + "/apartments-for-rent/san-francisco-ca"

# The city search stops at 275 listings however far you page it, which is a
# small fraction of San Francisco. Splitting the search walks past that ceiling
# -- but not the way zillow_api.py does it. Zillow honours a price band in the
# query string; Zumper does not honour anything in the query string, because it
# server-renders one default result set and applies filters client-side after
# hydration. `?min-price=3000`, `?price=3000-3500` and `?bed=1` all come back
# byte-identical, which is the same trap the old Playwright scraper hit and
# wrote down as "URL filters get partially stripped on render".
#
# What does partition the results is the neighbourhood, because that is a path
# segment and therefore part of what the server renders. Each one is its own
# result set with its own ceiling.
#
# The list is read out of the city payload rather than hard-coded. The previous
# scraper hard-coded six slugs, all of them in the Richmond and the Sunset, and
# a list that only its author could have chosen is a list nobody will notice
# has gone stale.
SF = (37.70, 37.84, -122.52, -122.35)


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


def preloaded(html):
    """The hydration blob, brace-matched rather than pattern-matched.

    A regex for `= {...};` either stops at the first closing brace or runs to
    the last one in the document; the payload is 340 KB of nested JSON with
    braces inside string values, so neither works. Counting depth while
    respecting string literals and escapes is the only version that is right
    for the right reason.
    """
    if not html:
        return None
    i = html.find("__PRELOADED_STATE__")
    if i == -1:
        return None
    i = html.find("{", i)
    if i == -1:
        return None
    depth, in_str, esc = 0, False, False
    for j in range(i, len(html)):
        c = html[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[i:j + 1])
                except Exception:
                    return None
    return None


def listables(doc):
    if not doc:
        return []
    cur = doc.get("currentSearch") or {}
    box = cur.get("listables") or {}
    return box.get("listables") or []


def in_sf(it):
    try:
        la, lo = float(it.get("lat")), float(it.get("lng"))
    except (TypeError, ValueError):
        return False
    return SF[0] <= la <= SF[1] and SF[2] <= lo <= SF[3]


def areas(doc):
    """Neighbourhood search paths, as the city page itself lists them."""
    cur = (doc or {}).get("currentSearch") or {}
    out = []
    for n in (cur.get("city") or {}).get("neighborhoods") or []:
        url = n.get("url") or n.get("slug") or ""
        if url.startswith("/"):
            out.append((n.get("name") or url.rsplit("/", 1)[-1], ROOT + url))
    return out


def sweep(url, label, max_pages, seen, out, pace):
    """One result set, paged until it stops producing anything new.

    Two dry pages rather than one before giving up: a page that repeats what we
    already hold is common in the middle of a result set and is not the end of
    it. That is the tolerance zillow_api.py needed after a single-page stop
    rule silently truncated a third of its harvest.
    """
    got = dry = 0
    for page in range(1, max_pages + 1):
        sep = "&" if "?" in url else "?"
        items = listables(preloaded(get(url if page == 1 else f"{url}{sep}page={page}")))
        if not items:
            break
        fresh = [i for i in items if i.get("listing_id") not in seen and in_sf(i)]
        for i in fresh:
            seen.add(i.get("listing_id"))
        out += fresh
        got += len(fresh)
        dry = dry + 1 if not fresh else 0
        if dry >= 2:
            break
        time.sleep(pace * random.uniform(0.8, 1.25))
    print(f"  {label[:26]:<28} {got:>4} new   (total {len(out):,})", flush=True)
    return got


def harvest(max_pages=14, seen=None, out=None, pace=1.1):
    seen = seen if seen is not None else set()
    out = out if out is not None else []
    doc = preloaded(get(CITY))
    sweep(CITY, "whole city", max_pages, seen, out, pace)
    hoods = areas(doc)
    if not hoods:
        print("  ! no neighbourhood list in the payload - city search only, "
              "which caps around 275", flush=True)
    for name, url in hoods:
        sweep(url, name, max_pages, seen, out, pace)
    return out


def main():
    pages = int(sys.argv[sys.argv.index("--pages") + 1]) if "--pages" in sys.argv else 40
    rows = harvest(max_pages=pages)

    print(f"\n  collected {len(rows):,} listings in San Francisco")
    feeds = collections.Counter(r.get("feed_name") or "(direct)" for r in rows)
    print("  who supplied them:")
    for k, v in feeds.most_common(8):
        print(f"    {str(k)[:34]:36} {v:>5}")
    print(f"  with floor area: {sum(1 for r in rows if r.get('min_square_feet')):,}")
    print(f"  with a description: {sum(1 for r in rows if (r.get('short_description') or '').strip()):,}")
    json.dump(rows, open(OUT, "w"))
    print(f"  wrote {OUT.name}")


if __name__ == "__main__":
    main()
