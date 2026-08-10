"""Zillow SF rentals from the public search pages.

Zillow's JSON endpoint sits behind PerimeterX, so this reads the ordinary search
page instead — the same HTML any visitor gets — and parses the listing data
Zillow embeds in __NEXT_DATA__. Paginated, and split by price when a search hits
Zillow's own result ceiling.
"""
import json, re, sys, time, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
BOUNDS = {"west": -122.5170, "east": -122.3560, "south": 37.7040, "north": 37.8340}


def page_url(page=1, lo=None, hi=None):
    fs = {"fr": {"value": True}, "fsba": {"value": False}, "fsbo": {"value": False},
          "nc": {"value": False}, "cmsn": {"value": False}, "auc": {"value": False},
          "fore": {"value": False}}
    if lo is not None or hi is not None:
        mp = {}
        if lo is not None: mp["min"] = lo
        if hi is not None: mp["max"] = hi
        fs["mp"] = mp                      # monthly payment = rent filter
    sqs = {"pagination": ({"currentPage": page} if page > 1 else {}),
           "isMapVisible": False, "isListVisible": True,
           "mapBounds": BOUNDS, "usersSearchTerm": "San Francisco, CA",
           "filterState": fs}
    return ("https://www.zillow.com/san-francisco-ca/rentals/?searchQueryState="
            + urllib.parse.quote(json.dumps(sqs, separators=(",", ":"))))


def fetch(page=1, lo=None, hi=None):
    req = urllib.request.Request(page_url(page, lo, hi), headers={
        "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml"})
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=50) as h:
                html = h.read().decode("utf-8", "replace")
            m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
                          html, re.S)
            if not m:
                return None, 0
            d = json.loads(m.group(1))
            sps = (d.get("props", {}).get("pageProps", {}).get("searchPageState")
                   or d.get("props", {}).get("searchPageState") or {})
            res = sps.get("cat1", {}).get("searchResults", {}).get("listResults", []) or []
            total = sps.get("cat1", {}).get("searchList", {}).get("totalResultCount") or 0
            return res, total
        except Exception as e:
            if a == 2:
                print(f"   fail p{page} {lo}-{hi}: {str(e)[:70]}", file=sys.stderr)
                return None, 0
            time.sleep(3 * (a + 1))


def norm(r):
    hd = r.get("hdpData", {}).get("homeInfo", {}) if isinstance(r.get("hdpData"), dict) else {}
    price = r.get("unformattedPrice")
    if not price:
        m = re.search(r"[\d,]+", str(r.get("price") or ""))
        price = int(m.group(0).replace(",", "")) if m else None
    url = r.get("detailUrl") or ""
    if url.startswith("/"): url = "https://www.zillow.com" + url
    return {"zpid": r.get("zpid"), "address": r.get("address"),
            "unformattedPrice": price,
            "latitude": r.get("latLong", {}).get("latitude") or hd.get("latitude"),
            "longitude": r.get("latLong", {}).get("longitude") or hd.get("longitude"),
            "beds": r.get("beds") or hd.get("bedrooms"),
            "baths": r.get("baths") or hd.get("bathrooms"),
            "area": r.get("area") or hd.get("livingArea"),
            "imgSrc": r.get("imgSrc"), "detailUrl": url,
            "statusType": r.get("statusType")}


def harvest(lo=None, hi=None, seen=None, out=None, depth=0):
    seen = seen if seen is not None else set()
    out = out if out is not None else []
    first, total = fetch(1, lo, hi)
    if first is None:
        return out
    pad = "  " * depth
    # Zillow caps a single search around 800 results; split the price band if needed
    if total > 780 and depth < 6 and hi and lo is not None and hi - lo > 150:
        mid = (lo + hi) // 2
        print(f"{pad}${lo}-{hi}: {total} over cap, splitting at {mid}", flush=True)
        harvest(lo, mid, seen, out, depth + 1)
        harvest(mid, hi, seen, out, depth + 1)
        return out
    added = 0
    for r in first:
        z = r.get("zpid")
        if z and z not in seen:
            seen.add(z); out.append(norm(r)); added += 1
    pages = min(20, max(1, -(-total // 40)))
    for p in range(2, pages + 1):
        res, _ = fetch(p, lo, hi)
        if not res: break
        new = 0
        for r in res:
            z = r.get("zpid")
            if z and z not in seen:
                seen.add(z); out.append(norm(r)); new += 1; added += 1
        if new == 0: break
        time.sleep(1.2)
    print(f"{pad}${lo}-{hi}: {total} total, +{added} new", flush=True)
    return out


if __name__ == "__main__":
    seen, rows = set(), []
    harvest(0, 30000, seen, rows)
    good = [r for r in rows if r["latitude"] and r["unformattedPrice"]
            and 37.70 <= r["latitude"] <= 37.84 and -122.52 <= r["longitude"] <= -122.35]
    print(f"\nunique zillow listings: {len(rows):,}")
    print(f"  in SF with price:     {len(good):,}")
    print(f"  with photo:           {sum(1 for r in good if r['imgSrc']):,}")
    json.dump(good, open("zillow_api.json", "w"))
