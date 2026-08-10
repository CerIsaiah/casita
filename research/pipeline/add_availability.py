"""Is this place still rentable? Mark what we can check, and admit what we can't.

Showing a listing that has already gone is the fastest way to lose someone's
trust, and until now nothing in the pipeline checked. Three sources, three very
different answers:

  * Craigslist  -- checkable. The search API is swept for the full live posting
    set, so a listing whose posting id is absent has come down. This is a real
    verification, not an inference.

  * Apartments.com -- checkable. The payload carries the building's currently
    available units. A property with an empty `units` array is still a real
    building with a live page, but nothing to rent today.

  * Zillow -- not checkable from here. There is no free endpoint and no live
    set, so 803 listings (a third of the list) carry no availability signal at
    all. They are marked "unknown" rather than quietly assumed live, because a
    green tick we did not earn is worse than an honest blank.

`avail` is one of: live | gone | no_units | unknown, with `avail_src` naming
what did the checking so a reader can weigh it.
"""
import json, os, re
import atomicjson

apts = json.load(open("app_data.json"))

live_cl = set()
if os.path.exists("craigslist_pets.json"):
    live_cl = set(json.load(open("craigslist_pets.json"))["all"])

by_url = {}
if os.path.exists("apify_apts.json"):
    for r in json.load(open("apify_apts.json")):
        u = (r.get("url") or "").split("?")[0]
        if u:
            by_url[u.rstrip("/") + "/"] = r

PID = re.compile(r"/(\d{8,})\.html")


def source(a, name):
    return next((s for s in a.get("src") or [] if s.get("n") == name), None)


counts = {}
for a in apts:
    state, why = "unknown", None

    cl = source(a, "Craigslist")
    if cl and live_cl:
        m = PID.search(cl.get("u") or "")
        if m:
            state = "live" if m.group(1) in live_cl else "gone"
            why = "Craigslist search index"

    ac = source(a, "Apartments.com")
    if ac and state != "live":
        r = by_url.get((ac.get("u") or "").rstrip("/") + "/")
        if r is not None:
            has = bool(r.get("units") or [])
            # A live building with nothing available is not the same as a dead
            # ad, and saying so is more useful than collapsing both to "gone".
            state = "live" if has else "no_units"
            why = "Apartments.com unit list"

    a["avail"] = state
    a["avail_src"] = why
    counts[state] = counts.get(state, 0) + 1

atomicjson.dump(apts, "app_data.json")

total = len(apts)
print(f"{total:,} listings")
for k in ("live", "gone", "no_units", "unknown"):
    v = counts.get(k, 0)
    print(f"  {k:<9} {v:>5}  ({v/total*100:.0f}%)")
print("\nunknown is almost entirely Zillow, which has no free liveness check.")
