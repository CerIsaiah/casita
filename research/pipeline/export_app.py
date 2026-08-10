"""Trim the merged apartments into a browser payload, adding block context."""
import json, math, re, collections
from enrich import City

city = City()
apts = json.load(open("apartments.json"))

# block context is expensive per-listing; cache by ~60m cell
cache = {}
def block_for(lat, lon):
    k = (round(lat, 3), round(lon, 3))
    if k not in cache:
        cache[k] = city.block(lat, lon)
    return cache[k]

UTIL = {0: (75, 150), 1: (85, 190), 2: (110, 250), 3: (140, 310)}

def util_range(beds):
    return UTIL.get(min(beds if beds is not None else 1, 3), (85, 190))

def unit_sqft(v):
    """Apartments.com sometimes returns the whole building's floor area.
    Anything over ~5,000 sq ft is not one apartment."""
    m = re.search(r"[\d,]+", str(v or ""))
    if not m: return None
    n = int(m.group(0).replace(",", ""))
    return v if 80 <= n <= 5000 else None

def street_only(s):
    """'38 Dolores St, San Francisco, CA 94103' -> '38 Dolores St'"""
    s = (s or "").split(",")[0].strip()
    return re.sub(r"\s+", " ", s)

def best_addr(a):
    """Craigslist gives a neighbourhood blurb, not an address. If the source
    string isn't street-like, use the parcel we matched it to."""
    src = street_only(a.get("addr"))
    if re.match(r"^\d+\s+\S", src):
        return src
    par = street_only(a.get("parcel_addr"))
    return par or src or ""

out = []
for a in apts:
    if not a.get("rent") or a["rent"] < 400 or a["rent"] > 25000:
        continue          # drop obvious junk prices
    b = block_for(float(a["lat"]), float(a["lon"]))
    lo, hi = util_range(a.get("beds"))
    total = a.get("total")
    # actual monthly: use the source's own total when it gave one, else rent + utilities
    if total and total > (a["rent"] or 0):
        act_lo = act_hi = total + lo
        est = "part"
    else:
        act_lo, act_hi = a["rent"] + lo, a["rent"] + hi
        est = "est"
    nights = b["night_pct"]
    out.append({
      "id": a["id"],
      "addr": best_addr(a) or "", "name": a.get("name"), "unit": a.get("unit"),
      "hood": a.get("hood"), "lat": round(float(a["lat"]), 6), "lon": round(float(a["lon"]), 6),
      "beds": a.get("beds"), "baths": a.get("baths"), "sqft": unit_sqft(a.get("sqft")),
      "rent": a["rent"], "act": [act_lo, act_hi], "est": est,
      "rating": a.get("rating"),
      "photo": (a.get("photos") or [None])[0],
      "photos": (a.get("photos") or [])[:5],
      "src": [{"n": s["n"], "u": s.get("u"), "c": s.get("c", 1)} for s in a.get("sources", [])],
      # Epoch seconds, from the source that published one. Craigslist gives a
      # real posting time; Apartments.com gives prose we parse; Zillow's search
      # results carry no date at all, so this stays null there rather than
      # being quietly backfilled with the scrape time.
      "posted": a.get("posted"),
      # Contact, concessions and the listing's own words. The description is
      # what lets the scam auditor read more than a truncated title.
      "phone": a.get("phone"), "site": a.get("site"),
      "special": a.get("special"), "tours": a.get("tours") or 0,
      "desc": (a.get("desc") or "")[:1200] or None,
      "multi": a.get("multi"), "fuzzy": a.get("fuzzy_pin"),
      "yr": a.get("yr"), "units": a.get("units"),
      "rc": a.get("rc"), "rc_why": a.get("rc_why"),
      "novs": a.get("novs") or 0, "active": a.get("active") or 0,
      "over_year": a.get("over_year") or 0, "referred": a.get("referred") or 0,
      "abate_med": a.get("abate_median"), "nov_top": a.get("nov_top"),
      "noise": b["noise_250m"], "night_pct": nights, "peak": b["peak_hr"],
      "venues": b["venues_400m"], "late": b["late_venues"],
      "vnames": b.get("venue_names", []),
      "hours": b["hours"],
      # A parcel match on a fuzzed pin is a match to whichever building sits
      # nearest a neighbourhood centroid, which is not the same as knowing where
      # the flat is. Everything downstream reads parcel_ok as "we know the
      # building", so a soft pin must not claim it.
      "parcel_ok": bool(a.get("parcel")) and not a.get("fuzzy_pin"),
    })

def score(a):
    """Recommended order: complete, plausible listings first."""
    s = 0
    if a["photo"]: s += 3
    if a["parcel_ok"]: s += 2
    if a["rating"]: s += 2
    if a["beds"] is not None: s += 1
    if a["rent"] >= 1500: s += 2      # under this in SF is usually a room, not a unit
    elif a["rent"] >= 1200: s += 1
    if a.get("sqft"): s += 1
    return -s

out.sort(key=lambda a: (score(a), a["rent"]))
for i, a in enumerate(out):
    a["rank"] = i

json.dump(out, open("app_data.json", "w"), separators=(",", ":"))

print(f"apartments exported: {len(out):,}")
print(f"  with photo:        {sum(1 for a in out if a['photo']):,}")
print(f"  with rating:       {sum(1 for a in out if a['rating']):,}")
print(f"  multi-source:      {sum(1 for a in out if a['multi']):,}")
print(f"  rent-controlled:   {sum(1 for a in out if a['rc']=='yes'):,}")
print(f"  quiet blocks:      {sum(1 for a in out if a['venues']<6):,}")
print(f"  active after dark: {sum(1 for a in out if a['venues']>=12):,}")
b = [a for a in out if a["novs"] > 0]
print(f"  with violations:   {len(b):,}")
print(f"  slow repairs (>5 over a year): {sum(1 for a in out if a['over_year']>5):,}")
print(f"  city-attorney escalations:     {sum(1 for a in out if a['referred']>0):,}")
import os
print(f"  payload: {os.path.getsize('app_data.json')/1e6:.2f} MB")
print("\nprice range:", min(a['rent'] for a in out), "-", max(a['rent'] for a in out))
print("hoods:", collections.Counter(a['hood'] for a in out if a['hood']).most_common(8))
