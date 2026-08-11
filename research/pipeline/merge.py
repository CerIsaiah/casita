"""Normalise every source into one canonical apartment record, then dedupe."""
import json, math, re, sys, time, collections
from enrich import City, M_LAT, m_lon

MONEY = re.compile(r"[\d,]+")
# "514 17th Ave, APT 2" is a doorstep; "mission district" is a shrug.
STREETISH = re.compile(r"^\s*\d+[a-z]?\s+\S")

# A unit designator, so two flats in one building are not read as two buildings.
UNIT_SUFFIX = re.compile(
    r"\s*(?:,\s*)?(?:#|\bunit\b|\bapt\b|\bapartment\b|\bste\b|\bsuite\b)\s*[\w-]*\.?\s*$",
    re.I,
)


def building_of(addr):
    """The street address with any unit designator removed.

    `mark_fuzzy` asks whether one coordinate serves more than one *building*.
    It was asking whether one coordinate served more than one address string,
    which stops being the same question the moment a source publishes unit
    numbers. Zillow does:

        140 S Van Ness Ave Unit 429
        140 S Van Ness Ave Unit 743
        140 S Van Ness Ave Unit 1024

    Three strings, one doorstep. They were read as a crowded pin and all three
    flagged unplaceable, which cost them the parcel match, the "matches a real
    building" tick, and a large slice of their verification score. The same
    building arrives from Apartments.com as plain "140 S Van Ness Ave" and
    matches cleanly -- so one source was being penalised for publishing more
    detail than the other.
    """
    a = (addr or "").strip().lower()
    # The street portion only. Sources append the city, state and postcode
    # after the unit -- "140 S Van Ness Ave Unit 743, San Francisco, CA 94103"
    # -- so a suffix pattern anchored to the end of the string matches the
    # postcode and leaves the unit exactly where it was.
    a = a.split(",")[0].strip()
    prev = None
    while a != prev:                       # "…Ave Unit 4B #2" -> "…Ave"
        prev = a
        a = UNIT_SUFFIX.sub("", a).strip().rstrip(",").strip()
    return a


def money(v):
    if v is None: return None
    if isinstance(v, (int, float)): return int(v)
    if isinstance(v, dict):
        for k in ("min", "max"):
            if isinstance(v.get(k), (int, float)): return int(v[k])
        return None
    m = MONEY.search(str(v))
    return int(m.group(0).replace(",", "")) if m else None


def beds_of(v):
    if v is None: return None
    if isinstance(v, (int, float)): return int(v)
    s = str(v).lower()
    if "studio" in s: return 0
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else None


def norm_unit(s):
    if not s: return None
    m = re.search(r"(?:#|apt\.?|unit|no\.?)\s*([0-9]+[A-Za-z]?|[A-Za-z]?[0-9]+)", str(s), re.I)
    return m.group(1).upper() if m else None


# Apartments.com publishes freshness as prose -- "1 hour ago", "3 days ago" --
# rather than a timestamp. Turning it into one here keeps every source speaking
# the same language downstream, and anything unparseable stays None rather than
# defaulting to "now", which would make a stale listing look fresh.
REL = re.compile(r"(\d+)\s*(minute|hour|day|week|month)", re.I)
REL_SECS = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000}


def rel_to_epoch(s, now=None):
    if not s:
        return None
    if re.search(r"\btoday|just now|moments?\b", str(s), re.I):
        return int(now or time.time())
    m = REL.search(str(s))
    if not m:
        return None
    return int((now or time.time()) - int(m.group(1)) * REL_SECS[m.group(2).lower()])


def from_apartments(it):
    loc = it.get("location") or {}
    co = it.get("coordinates") or {}
    rentals = it.get("rentals") or []
    out = []
    base = {
      "source": "Apartments.com", "url": it.get("url"),
      "name": it.get("propertyName"), "addr": loc.get("fullAddress"),
      "hood": loc.get("neighborhood"),
      "lat": co.get("latitude"), "lon": co.get("longitude"),
      "photos": (it.get("photos") or [])[:8],
      "rating": it.get("rating"), "fees": it.get("fees"),
      "posted": rel_to_epoch(it.get("lastUpdated")),
      # Fields the old adapter dropped on the floor. The phone number is the
      # one a renter actually wants -- it is the difference between "somebody
      # letting this" and "an advert". `specials` is real money: six weeks free
      # on a twelve-month lease is 12% off, and it never appeared anywhere.
      "phone": ((it.get("contact") or {}).get("phone")),
      "site": it.get("propertyWebsite"),
      "desc": it.get("description"),
      "special": ((it.get("specials") or {}).get("description")
                  or (it.get("specials") or {}).get("title")),
      "tours": len(it.get("virtualTours") or []),
    }
    if rentals:
        for r in rentals[:6]:
            out.append({**base, "unit": norm_unit(r.get("unitNumber")) or r.get("unitNumber"),
                        "rent": money(r.get("basePrice")), "total": money(r.get("totalPrice")),
                        "beds": beds_of(r.get("beds")), "baths": r.get("baths"),
                        "sqft": r.get("squareFeet"), "avail": r.get("availability")})
    else:
        out.append({**base, "unit": None, "rent": money(it.get("baseRent")),
                    "total": money(it.get("totalRent")), "beds": beds_of(it.get("beds")),
                    "baths": it.get("baths"), "sqft": it.get("sqft"), "avail": None})
    return out


def from_craigslist(it):
    loc = it.get("location")
    if isinstance(loc, dict):
        addr = (loc.get("street") or "").strip() or (loc.get("city") or "").strip()
    else:
        addr = (loc or "").strip()
    addr = addr or (it.get("address") or "").strip()
    # mapAccuracy < 10 means Craigslist fuzzed the pin; don't pin it to a building
    try: acc = float(it.get("mapAccuracy") or 0)
    except (TypeError, ValueError): acc = 0
    return [{
      "source": "Craigslist", "url": it.get("url"),
      "name": it.get("title") or it.get("label"), "addr": addr, "hood": None,
      "lat": it.get("latitude"), "lon": it.get("longitude"),
      "photos": [p.get("url") if isinstance(p, dict) else p for p in (it.get("pics") or [])][:8],
      "rating": None, "fees": None, "unit": norm_unit(it.get("title")),
      "rent": money(it.get("price")), "total": None,
      "beds": beds_of(it.get("bedrooms")), "baths": it.get("bathrooms"),
      "sqft": (it.get("properties") or {}).get("sqft") if isinstance(it.get("properties"), dict) else None,
      # craigslist_api.py decodes this out of the batch response; the old key
      # was "datetime", which nothing ever set, so every posting date was None.
      "avail": it.get("availableFrom"),
      "posted": it.get("posted") or it.get("datetime"),
      "fuzzy_pin": acc < 10,
    }]


def from_zillow(it):
    a = it.get("address")
    if isinstance(a, dict):
        addr = a.get("streetAddress") or ""
    else:
        addr = a or it.get("addressStreet") or ""
    return [{
      "source": "Zillow",
      "url": it.get("detailUrl") or it.get("url") or
             (f"https://www.zillow.com{it['hdpUrl']}" if it.get("hdpUrl") else None),
      "name": None, "addr": addr, "hood": None,
      "lat": it.get("latitude") or (it.get("latLong") or {}).get("latitude"),
      "lon": it.get("longitude") or (it.get("latLong") or {}).get("longitude"),
      # The feed carries the whole carousel; zillow_api.gallery() unpacks it.
      # Falling back to imgSrc keeps older harvests readable.
      "photos": (it.get("photos") or ([it["imgSrc"]] if it.get("imgSrc") else []))[:8],
      "rating": None, "fees": None, "unit": norm_unit(addr),
      "rent": money(it.get("unformattedPrice") or it.get("price")), "total": None,
      "beds": beds_of(it.get("beds")), "baths": it.get("baths"),
      "sqft": it.get("area"),
      # Zillow publishes when the flat is free, which is not the same as when
      # the advert went up -- so it fills `avail`, not `posted`.
      "avail": it.get("availabilityDate"),
      # daysOnZillow is the closest thing the feed has to a posting date.
      "posted": (int(time.time()) - int(it["daysOnZillow"]) * 86400)
                if isinstance(it.get("daysOnZillow"), (int, float)) else None,
    }]


def from_zumper(it):
    """Zumper rows, which arrive better-formed than anything else here.

    Every one publishes floor area, most publish prose, and the price is a
    range across the building's live units rather than one number - `min_price`
    is the cheapest thing actually available, which is the same thing the other
    sources call the rent.

    Two things are dropped rather than imported:

    Short lets. A 30-day minimum is a furnished corporate stay, not somewhere
    to live, and the operators doing it (Blueground and friends) quote the
    cheapest possible night as a monthly rent - one of them advertises $2,860
    in the price field and $9,735 in its own description. Importing that would
    put a fake bargain at the top of a list whose whole job is to not do that.

    Buildings with no street number. `STREETISH` elsewhere in this file already
    treats those as a shrug rather than a doorstep.
    """
    if (it.get("min_lease_days") or 999) < 180:
        return []
    addr = (it.get("address") or "").strip()
    photos = [f"https://img.zumpercdn.com/{i}/1280x960"
              for i in (it.get("image_ids") or [])[:8]]
    url = it.get("url") or ""
    return [{
      "source": "Zumper",
      "url": ("https://www.zumper.com" + url) if url.startswith("/") else (url or None),
      "name": it.get("building_name") or it.get("title"),
      "addr": addr, "hood": it.get("neighborhood_name"),
      "lat": it.get("lat"), "lon": it.get("lng"),
      "photos": photos,
      # `rating` here is Zumper's own building score, not a renter review count,
      # so it stays out rather than being mixed in with Apartments.com's.
      "rating": None, "fees": it.get("leasing_fee"), "unit": norm_unit(addr),
      "rent": money(it.get("min_price")), "total": None,
      "beds": beds_of(it.get("min_bedrooms")), "baths": it.get("min_bathrooms"),
      "sqft": it.get("min_square_feet"),
      "avail": it.get("date_available"),
      # `listed_on` is when this advert went up; `created_on` is when Zumper
      # first saw the building, which for a large operator can be years back.
      "posted": it.get("listed_on") or None,
      "desc": (it.get("short_description") or "").strip() or None,
    }]


ADAPT = {"apartments": from_apartments, "craigslist": from_craigslist,
         "zillow": from_zillow, "zumper": from_zumper}


def mark_fuzzy(rows):
    """Work out which pins are a neighbourhood, not a doorstep.

    Craigslist deliberately obscures addresses, and its search API gives us no
    accuracy field to read -- craigslist_api.py used to invent one
    (`mapAccuracy: 22`, hardcoded), which meant the `acc < 10` test downstream
    could never fire and not a single listing was ever flagged. Half of them
    should have been.

    Two tells, and the first one carries most of the weight.

    A soft pin usually announces itself in the address field: Craigslist rows
    come through as "mission district", "north beach / telegraph hill" or plain
    "San Francisco, CA" rather than a street address. Anything without a house
    number in front of a street name was never locatable to begin with.

    The second tell is a coordinate serving more than one distinct street
    address, which cannot be a doorstep. This has to be counted per address
    rather than per row: a 200-unit building on Apartments.com legitimately
    lists six units at one coordinate, and flagging that would be wrong. On a
    fresh sweep the split is stark -- 436 Craigslist rows sit on a coordinate
    carrying two or more distinct addresses, against 27 from Apartments.com.

    This matters well beyond the map. A fuzzed pin was being matched to
    whichever building happened to sit nearest the centroid, and that match
    then fed walking times, the 250m street statistics, and a green tick
    reading "Address matches a real building on the city parcel map".
    """
    at = collections.defaultdict(list)
    for r in rows:
        at[(round(r["lat"], 5), round(r["lon"], 5))].append(r)

    for group in at.values():
        distinct = {building_of(r.get("addr"))
                    for r in group if STREETISH.match(r.get("addr") or "")}
        crowded = len(distinct) > 1
        for r in group:
            if crowded or not STREETISH.match(r.get("addr") or ""):
                r["fuzzy_pin"] = True

    n = sum(1 for r in rows if r.get("fuzzy_pin"))
    by = collections.Counter(r["source"] for r in rows if r.get("fuzzy_pin"))
    print(f"pins we cannot place on a building: {n:,} of {len(rows):,}  {dict(by)}")


def run(path="listings_raw.json"):
    raw = json.load(open(path))
    flat = []
    for src, items in raw.items():
        fn = ADAPT.get(src)
        if not fn: continue
        for it in items:
            try: flat += fn(it)
            except Exception: pass
    def in_sf(r):
        try: la, lo = float(r["lat"]), float(r["lon"])
        except (TypeError, ValueError, KeyError): return False
        return 37.70 <= la <= 37.84 and -122.52 <= lo <= -122.35
    before = len(flat)
    flat = [r for r in flat if r.get("lat") and r.get("lon") and r.get("rent") and in_sf(r)]
    for r in flat:                       # sources hand back coords as strings
        r["lat"] = float(r["lat"]); r["lon"] = float(r["lon"])
    print(f"dropped {before-len(flat):,} rows (missing price/coords or outside SF)")
    print(f"normalised rows: {len(flat):,}")
    for s, c in collections.Counter(r["source"] for r in flat).items():
        print(f"   {s:<16} {c:,}")

    mark_fuzzy(flat)

    city = City()
    for r in flat:
        p, dist = city.parcel_for(float(r["lat"]), float(r["lon"]), r.get("addr"))
        r["parcel"] = p["blklot"] if p else None
        r["_p"] = p
        r["_dist"] = dist

    # Canonical key. A known unit number is a strong identifier, so merge on it
    # across every source. Without one, only merge when the price also matches --
    # two Craigslist ads in the same building are usually different units.
    groups = collections.defaultdict(list)
    for r in flat:
        base = r["parcel"] or f"xy{round(r['lat'],4)},{round(r['lon'],4)}"
        beds = r.get("beds") if r.get("beds") is not None else -1
        if r.get("unit"):
            key = (base, r["unit"], beds)
        else:
            key = (base, "", beds, round((r.get("rent") or 0) / 50))
        groups[key].append(r)

    apts = []
    for key, rows in groups.items():
        rows.sort(key=lambda x: {"Apartments.com": 0, "Zillow": 1, "Craigslist": 2}
                  .get(x["source"], 3))
        best = rows[0]
        p = best["_p"] or {}
        rents = [r["rent"] for r in rows if r.get("rent")]
        srcs = sorted({r["source"] for r in rows})
        photos = []
        for r in rows:
            for ph in (r.get("photos") or []):
                if ph and ph not in photos: photos.append(ph)
        apts.append({
          "id": "|".join(str(k) for k in key),
          "addr": best.get("addr") or p.get("address"),
          "parcel_addr": p.get("address"),
          "name": best.get("name"), "unit": best.get("unit"),
          "hood": best.get("hood") or p.get("neighborhood"),
          "lat": best["lat"], "lon": best["lon"],
          "beds": best.get("beds"), "baths": best.get("baths"), "sqft": best.get("sqft"),
          "rent": min(rents) if rents else None,
          "rent_spread": [min(rents), max(rents)] if rents and max(rents) != min(rents) else None,
          "total": best.get("total"),
          "rating": next((r["rating"] for r in rows if r.get("rating")), None),
          "photos": photos[:8],
          "sources": [{"n": nm, "u": next(r.get("url") for r in rows if r["source"] == nm),
                        "c": sum(1 for r in rows if r["source"] == nm)}
                       for nm in sorted({r["source"] for r in rows})],
          # The freshest ad wins. One building can be advertised on three sites
          # on three different days, and what a renter wants to know is when
          # anybody last touched it, not when the stalest copy went up.
          "posted": max((r["posted"] for r in rows if r.get("posted")), default=None),
          "phone": next((r.get("phone") for r in rows if r.get("phone")), None),
          "site": next((r.get("site") for r in rows if r.get("site")), None),
          "desc": next((r.get("desc") for r in rows if r.get("desc")), None),
          "special": next((r.get("special") for r in rows if r.get("special")), None),
          "tours": max((r.get("tours") or 0 for r in rows), default=0),
          "n_ads": len(rows), "multi": len(srcs) > 1,
          "parcel": best["parcel"], "dist_m": best["_dist"],
          "fuzzy_pin": bool(best.get("fuzzy_pin")),
          "yr": p.get("year_built"), "units": p.get("units"),
          "rc": p.get("rc_status"), "rc_why": p.get("rc_why"),
          "novs": p.get("novs"), "complaints": p.get("complaints"),
          "active": p.get("active_complaints"), "over_year": p.get("abate_over_year"),
          "abate_median": p.get("abate_median"), "referred": p.get("referred"),
          "nov_top": p.get("nov_top"),
        })
    dup = len(flat) - len(apts)
    print(f"\ncanonical apartments: {len(apts):,}   (deduped {dup:,} ads)")
    print(f"  on 2+ platforms: {sum(1 for a in apts if a['multi']):,}")
    print(f"  matched to a parcel: {sum(1 for a in apts if a['parcel']):,}")
    print(f"  with photos: {sum(1 for a in apts if a['photos']):,}")
    print(f"  with a rating: {sum(1 for a in apts if a['rating']):,}")
    print(f"  likely rent-controlled: {sum(1 for a in apts if a['rc']=='yes'):,}")
    json.dump(apts, open("apartments.json", "w"))
    return apts


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "listings_raw.json")
