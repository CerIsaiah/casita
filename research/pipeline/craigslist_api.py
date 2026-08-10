"""Craigslist SF via the site's own JSON API.

The Apify actor stalled around 200 items per run because it crawls detail pages
and gets throttled. This uses the endpoint the website itself calls.

The API hard-caps a response at 360 items but reports the true total for any
filter, so the trick is to bisect on price until every band fits under the cap.
Complete coverage, no cost.
"""
import json, re, sys, time, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
BASE = "https://sapi.craigslist.org/web/v8/postings/search/full"
CAP = 360


def call(path, lo=None, hi=None):
    p = {"batch": "1-0-360-0-0", "cc": "US", "lang": "en", "searchPath": path}
    if lo is not None: p["min_price"] = lo
    if hi is not None: p["max_price"] = hi
    req = urllib.request.Request(BASE + "?" + urllib.parse.urlencode(p), headers={
        "User-Agent": UA, "Accept": "application/json",
        "Referer": "https://sfbay.craigslist.org/"})
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as h:
                return json.load(h)["data"]
        except Exception as e:
            if a == 3:
                print(f"   fail {lo}-{hi}: {e}", file=sys.stderr)
                return None
            time.sleep(2 * (a + 1))


def parse(data):
    dec = data.get("decode") if isinstance(data.get("decode"), dict) else {}
    descs = dec.get("locationDescriptions") or []
    minid = dec.get("minPostingId") or 0
    # Craigslist delta-encodes both the posting id and the posting time against
    # the oldest row in the batch, and we were only decoding the id. it[1] is
    # seconds since decode.minPostedDate -- verified against decode.maxPostedDate,
    # which equals minPostedDate + max(it[1]) exactly. This is the only real
    # posting timestamp any of the three sources gives us, and it was being
    # dropped one line above where it arrived.
    mindate = dec.get("minPostedDate") or 0
    out = []
    for it in data.get("items", []):
        if len(it) < 5:
            continue
        pid = minid + (it[0] or 0)
        posted = (mindate + it[1]) if (mindate and isinstance(it[1], int)) else None
        price = it[3] if isinstance(it[3], (int, float)) else None
        lat = lon = None
        hood = None
        # 1:<desc>[:<hood>]~lat~lon  -- the second index is optional
        m = re.match(r"1:(\d+)(?::\d+)?~(-?[\d.]+)~(-?[\d.]+)", str(it[4]))
        if m:
            lat, lon = float(m.group(2)), float(m.group(3))
            i = int(m.group(1))
            if i < len(descs):
                hood = descs[i]
        title = slug = None
        beds = sqft = None
        imgs = []
        for f in it[5:]:
            if isinstance(f, list) and f:
                if f[0] == 6 and len(f) > 1:
                    slug = f[1]
                elif f[0] == 4:
                    imgs = [x for x in f[1:] if isinstance(x, str)]
                elif f[0] == 5:
                    if len(f) > 1 and isinstance(f[1], (int, float)): beds = f[1]
                    if len(f) > 2 and isinstance(f[2], (int, float)): sqft = f[2]
            elif isinstance(f, str) and len(f) > 12 and title is None:
                title = f
        out.append({
            "id": str(pid), "price": price, "latitude": lat, "longitude": lon,
            "location": hood, "title": title, "bedrooms": beds, "sqft": sqft,
            "posted": posted,
            "url": (f"https://sfbay.craigslist.org/sfc/apa/d/{slug}/{pid}.html"
                    if slug else f"https://sfbay.craigslist.org/d/{pid}.html"),
            "pics": [f"https://images.craigslist.org/{i.split(':')[-1]}_300x300.jpg"
                     for i in imgs[:5] if ":" in i],
            "mapAccuracy": 22 if lat else 0})
    return out


def harvest(path, lo, hi, depth=0, seen=None, out=None):
    """Pull a price band; if it comes back capped, split it and recurse."""
    seen = seen if seen is not None else set()
    out = out if out is not None else []
    d = call(path, lo, hi)
    if not d:
        return out
    total = d.get("totalResultCount") or 0
    rows = parse(d)
    pad = "  " * depth
    if total > CAP and depth < 9 and (hi - lo) > 25:
        mid = (lo + hi) // 2
        print(f"{pad}${lo}-{hi}: {total} over cap, splitting at {mid}", flush=True)
        harvest(path, lo, mid, depth + 1, seen, out)
        harvest(path, mid, hi, depth + 1, seen, out)
        return out
    new = 0
    for r in rows:
        if r["id"] not in seen:
            seen.add(r["id"])
            out.append(r)
            new += 1
    print(f"{pad}${lo}-{hi}: {total} total, +{new} new", flush=True)
    time.sleep(0.8)
    return out


if __name__ == "__main__":
    seen, rows = set(), []
    for path in ["sfc/apa", "sfc/roo"]:
        print(f"\n=== {path}")
        harvest(path, 0, 30000, 0, seen, rows)
    insf = [r for r in rows if r["latitude"] and r["price"]
            and 37.70 <= r["latitude"] <= 37.84
            and -122.52 <= r["longitude"] <= -122.35]
    print(f"\nunique postings fetched:   {len(rows):,}")
    print(f"in SF with coords + price: {len(insf):,}")
    print(f"  with photos: {sum(1 for r in insf if r['pics']):,}"
          f"   with beds: {sum(1 for r in insf if r['bedrooms'] is not None):,}")
    json.dump(insf, open("craigslist_api.json", "w"))
