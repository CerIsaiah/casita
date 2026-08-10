#!/usr/bin/env python3
"""Decide Zillow availability by re-running the search, not by fetching pages.

Zillow serves two kinds of rental page and walls exactly one of them:

    /apartments/<building>/    200 to a plain request
    /homedetails/<address>/    403 to a plain request, to a headless browser,
                               and to a headed browser with a stealth profile

add_zillow_avail.py reads the first kind directly -- the unit count is in the
page title. This file answers the second kind without fetching those pages at
all, because the question does not actually require them.

A rental listing is "available" if Zillow is still offering it. Zillow tells us
that every time we run a search: the listing is in the results, or it is not.
So the search feed -- which is not walled, and which this project already
scrapes -- is the availability signal. Re-run today's sweep, and:

    in the feed  ->  live      Zillow is still renting it
    absent       ->  gone      it left the market since we scraped it

Two honesty constraints, because this is an inference rather than a quote:

  · Absence only means "gone" if the sweep was complete. Zillow caps a search
    around 800 results, and a truncated sweep would mark healthy listings dead.
    If the harvest comes back implausibly small, this refuses to conclude
    anything rather than delisting the whole city.
  · `daysOnZillow` rides along, so the interface can say how stale a still-live
    listing is instead of implying that "listed" means "fresh".

    python3 zillow_presence.py           sweep and write zillow_presence.json
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import zillow_api as Z                                          # noqa: E402

OUT = HERE / "zillow_presence.json"
DATA = HERE / "app_data.json"

# Below this, assume the sweep was blocked or truncated rather than assuming
# San Francisco emptied out. Our stored set is ~790 Zillow listings; a healthy
# sweep returns several thousand rows across all price bands.
MIN_PLAUSIBLE = 600


def keep_extra(r):
    """Z.norm, plus the freshness fields it drops."""
    out = _norm(r)
    hd = r.get("hdpData", {}).get("homeInfo", {}) if isinstance(r.get("hdpData"), dict) else {}
    out["daysOnZillow"] = hd.get("daysOnZillow")
    out["availabilityCount"] = r.get("availabilityCount")
    return out


_norm = Z.norm
Z.norm = keep_extra


def url_key(u):
    """Compare on path, not on query strings or host spelling."""
    if not u:
        return ""
    u = u.split("?")[0].rstrip("/")
    return u.replace("https://www.zillow.com", "").replace("http://www.zillow.com", "")


def main():
    seen, rows = set(), []
    Z.harvest(0, 30000, seen, rows)
    print(f"\nfeed rows: {len(rows):,}", flush=True)

    if len(rows) < MIN_PLAUSIBLE:
        print(f"refusing to conclude: {len(rows)} rows is below the "
              f"{MIN_PLAUSIBLE} needed to trust an absence. Nothing written.")
        return 1

    live_urls = {url_key(r["detailUrl"]): r for r in rows if r.get("detailUrl")}
    live_zpids = {str(r["zpid"]): r for r in rows if r.get("zpid")}

    data = json.load(open(DATA))
    out, counts = {}, {}
    for a in data:
        src = (a.get("src") or [{}])[0]
        if src.get("n") != "Zillow" or not src.get("u"):
            continue
        u = src["u"]
        hit = live_urls.get(url_key(u))
        if not hit:
            # zpid survives a slug rewrite; the URL does not.
            import re
            m = re.search(r"/(\d+)_zpid/", u)
            if m:
                hit = live_zpids.get(m.group(1))
        state = "live" if hit else "gone"
        counts[state] = counts.get(state, 0) + 1
        rec = {"state": state, "via": "feed",
               "note": ("Still listed in Zillow's current search results"
                        if hit else
                        "No longer in Zillow's search results")}
        if hit:
            if hit.get("daysOnZillow") is not None:
                rec["days"] = hit["daysOnZillow"]
            if hit.get("availabilityCount") is not None:
                rec["units"] = hit["availabilityCount"]
        out[u] = rec

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print("presence:", counts)
    print(f"wrote {OUT.name} ({len(out):,} listings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
