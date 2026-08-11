"""Zillow SF rentals from the public search pages.

Zillow's JSON endpoint sits behind PerimeterX, so this reads the ordinary search
page instead — the same HTML any visitor gets — and parses the listing data
Zillow embeds in __NEXT_DATA__. Paginated, and split by price when a search hits
Zillow's own result ceiling.
"""
import json, re, sys, time, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
SPLIT_ABOVE = 300      # keep bands inside the range Zillow pages reliably
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


def gallery(r):
    """Every photo the search feed carries, not just the cover.

    `carouselPhotosComposable` holds a `baseUrl` template and a list of photo
    keys -- twenty-three of them for 140 S Van Ness #743, the same count the
    listing page shows. We were storing `imgSrc` alone, so all 1,180 Zillow
    rows looked like one-photograph adverts, the verification factor docked
    them for it and the fraud auditor called it a concern.

    The gallery was never behind the bot wall. It was in the response we
    already had, one key over from the one we were reading.
    """
    c = r.get("carouselPhotosComposable") or {}
    base, data = c.get("baseUrl"), c.get("photoData") or []
    if base and data:
        urls = [base.replace("{photoKey}", d["photoKey"])
                for d in data if isinstance(d, dict) and d.get("photoKey")]
        if urls:
            return urls
    return [r["imgSrc"]] if r.get("imgSrc") else []


def baths_of(r, hd):
    """Halves included.

    `baths` in the feed rounds 1.5 up to 2, which is a bathroom this flat does
    not have. `factsAndFeatures` counts full and half separately, so prefer it
    and fall back to the rounded figure only when it is absent.
    """
    ff = r.get("factsAndFeatures") or {}
    full, half = ff.get("fullBathroomCount"), ff.get("halfBathroomCount")
    if isinstance(full, (int, float)):
        return full + 0.5 * (half or 0)
    return r.get("baths") or hd.get("bathrooms")


def norm(r):
    hd = r.get("hdpData", {}).get("homeInfo", {}) if isinstance(r.get("hdpData"), dict) else {}
    price = r.get("unformattedPrice")
    if not price:
        m = re.search(r"[\d,]+", str(r.get("price") or ""))
        price = int(m.group(0).replace(",", "")) if m else None
    url = r.get("detailUrl") or ""
    if url.startswith("/"): url = "https://www.zillow.com" + url
    photos = gallery(r)
    return {"zpid": r.get("zpid"), "address": r.get("address"),
            "unformattedPrice": price,
            "latitude": r.get("latLong", {}).get("latitude") or hd.get("latitude"),
            "longitude": r.get("latLong", {}).get("longitude") or hd.get("longitude"),
            "beds": r.get("beds") or hd.get("bedrooms"),
            "baths": baths_of(r, hd),
            "area": r.get("area") or hd.get("livingArea"),
            "imgSrc": photos[0] if photos else r.get("imgSrc"),
            "photos": photos,
            # When the flat is actually free, and how long it has been sitting.
            # Both were in the feed and neither was read, which is why Zillow
            # listings carried no posting date at all.
            "availabilityDate": r.get("availabilityDate"),
            "daysOnZillow": hd.get("daysOnZillow"),
            # Zillow's own estimate of the market rent. An asking price far
            # under it is the kind of thing the deal auditor exists to notice.
            "rentZestimate": hd.get("rentZestimate"),
            "detailUrl": url,
            "statusType": r.get("statusType")}


def harvest(lo=None, hi=None, seen=None, out=None, depth=0):
    seen = seen if seen is not None else set()
    out = out if out is not None else []
    first, total = fetch(1, lo, hi)
    if first is None:
        return out
    pad = "  " * depth
    # Split well below what a single search can hold, not at the ceiling.
    #
    # The old threshold was 780, just under Zillow's ~800 cap, which meant a
    # 658-result band never split and had to be paged seventeen times. Zillow
    # reshuffles results between requests, so those pages overlap heavily and a
    # page arrives with nothing new long before the band is exhausted -- and
    # the loop below used to treat that as "done". Measured on $0-3750: 658
    # reported, 470 collected, and which 188 went missing changed run to run.
    #
    # That is how a friend's $3,000 one-bed at 140 S Van Ness (zpid 64969415)
    # was absent from a scrape while sitting on page four of the same query.
    #
    # Smaller bands page reliably, and the depth and width limits are relaxed
    # to let the recursion actually reach them. Zillow is free, so the extra
    # requests cost only time.
    if total > SPLIT_ABOVE and depth < 9 and hi and lo is not None and hi - lo > 25:
        mid = (lo + hi) // 2
        print(f"{pad}${lo}-{hi}: {total} over cap, splitting at {mid}", flush=True)
        harvest(lo, mid, seen, out, depth + 1)
        harvest(mid, hi, seen, out, depth + 1)
        return out
    added = 0
    band = set()                       # zpids seen in THIS band, for the stop test
    for r in first:
        z = r.get("zpid")
        if z:
            band.add(z)
            if z not in seen:
                seen.add(z); out.append(norm(r)); added += 1

    pages = min(25, max(1, -(-total // 40)))
    dry = 0
    for p in range(2, pages + 1):
        res, _ = fetch(p, lo, hi)
        if not res:
            break
        fresh = 0
        for r in res:
            z = r.get("zpid")
            if not z:
                continue
            if z not in band:
                fresh += 1
            band.add(z)
            if z not in seen:
                seen.add(z); out.append(norm(r)); added += 1
        # Two consecutive pages with nothing new to THIS band, not one page with
        # nothing new overall. See the note above SPLIT_ABOVE.
        dry = dry + 1 if fresh == 0 else 0
        if dry >= 2:
            break
        time.sleep(1.2)

    got = len(band)
    short = f"  (!! {total - got} short)" if total and got < total * 0.9 else ""
    print(f"{pad}${lo}-{hi}: {total} total, {got} seen, +{added} new{short}", flush=True)
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
