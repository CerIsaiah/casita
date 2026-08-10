#!/usr/bin/env python3
"""Recover where a Craigslist listing actually is, from what it says.

Craigslist publishes a neighbourhood centroid instead of an address -- only 6
of 1,497 rows in a recent sweep carried a street address in the address field --
so half the map was pinned to a point that no listing actually occupies. That is
handled honestly upstream (merge.py marks those pins soft), but "we don't know"
is a floor, not a ceiling. The poster usually tells you anyway; just not in the
field built for it.

Three clues, strongest first. Each one is only accepted if it agrees with the
constraint we already have -- the fuzzed pin is still a real neighbourhood, so a
title claiming an address three miles away is evidence of a problem rather than
evidence of a location.

  1. A street address in the title. "434 Leavenworth St - 404B" resolves
     against the city parcel map to an exact building. About 8% of postings.
  2. A building name in the title. Apartments.com publishes 367 property names
     with exact coordinates; when a Craigslist post names one, it inherits it.
  3. A neighbourhood name in the title. Not a location, but it is a claim, and
     comparing it against the pin's own neighbourhood catches posts that say
     Pacific Heights while sitting in Bayview.

Nothing here overwrites a coordinate we already trust, and every upgrade records
what moved it and by how far, so the page can say "located from the listing
title" rather than quietly implying we knew all along.
"""
import json
import math
import re
import sqlite3
import collections

M_LAT = 110540.0


def m_lon(lat):
    return 111320.0 * math.cos(math.radians(lat))


def metres(la1, lo1, la2, lo2):
    return math.hypot((lo2 - lo1) * m_lon(la1), (la2 - la1) * M_LAT)


SUFFIX = {
    "st": "st", "street": "st", "ave": "ave", "avenue": "ave", "blvd": "blvd",
    "boulevard": "blvd", "rd": "rd", "road": "rd", "dr": "dr", "drive": "dr",
    "way": "way", "ct": "ct", "court": "ct", "pl": "pl", "place": "pl",
    "ln": "ln", "lane": "ln", "ter": "ter", "terrace": "ter",
}
ADDR_RE = re.compile(
    r"\b(\d{1,5})\s+([A-Za-z0-9'\.]+(?:\s+[A-Za-z0-9'\.]+){0,2}?)\s+"
    r"(%s)\b\.?" % "|".join(SUFFIX), re.I)

# Written the way San Franciscans write them, lowercased for matching.
HOODS = [
    "nob hill", "russian hill", "pacific heights", "lower pacific heights", "marina",
    "cow hollow", "mission district", "the mission", "mission", "soma", "south of market",
    "tenderloin", "castro", "hayes valley", "inner richmond", "outer richmond", "richmond",
    "inner sunset", "outer sunset", "sunset", "noe valley", "potrero hill", "dogpatch",
    "north beach", "telegraph hill", "cole valley", "haight", "lower haight",
    "bernal heights", "excelsior", "bayview", "glen park", "japantown", "financial district",
    "union square", "civic center", "presidio", "west portal", "twin peaks", "sunnyside",
    "visitacion valley", "portola", "outer mission", "ingleside", "lakeshore", "seacliff",
    "nopa", "duboce triangle", "mission bay", "polk gulch", "chinatown", "embarcadero",
]


def norm_addr(num, name, suf):
    name = re.sub(r"\s+", " ", name.strip().lower())
    name = re.sub(r"^(the|a)\s+", "", name)
    return f"{int(num)} {name} {SUFFIX[suf.lower()]}"


def parcel_index(db):
    """Every building in the city, keyed the same way titles get parsed."""
    idx = {}
    for addr, lat, lon, blklot, hood in db.execute(
            "select address, lat, lon, blklot, neighborhood from parcel "
            "where address is not null and lat is not null"):
        m = ADDR_RE.match(addr.strip())
        if not m:
            continue
        k = norm_addr(*m.groups())
        # Multi-lot buildings repeat an address; first one wins, they agree to
        # within a few metres anyway.
        idx.setdefault(k, (lat, lon, blklot, hood))
    return idx


def main():
    data = json.load(open("app_data.json"))
    db = sqlite3.connect("city.sqlite")
    parcels = parcel_index(db)

    # Buildings whose coordinates we already trust, by name.
    named = {}
    for a in data:
        nm = (a.get("name") or "").strip().lower()
        if len(nm) > 6 and not a.get("fuzzy") and a.get("parcel_ok"):
            named.setdefault(nm, (a["lat"], a["lon"], a.get("addr")))

    stats = collections.Counter()
    for a in data:
        title = a.get("name") or ""
        level, why, moved = None, None, None

        if not a.get("fuzzy"):
            level, why = "exact", "Address published by the source"
            stats["already exact"] += 1
        else:
            # 1. a street address written into the title
            m = ADDR_RE.search(title)
            hit = parcels.get(norm_addr(*m.groups())) if m else None
            if hit:
                d = metres(a["lat"], a["lon"], hit[0], hit[1])
                if d <= 3000:
                    a["lat"], a["lon"] = round(hit[0], 6), round(hit[1], 6)
                    a["addr"] = m.group(0).strip()
                    a["parcel_ok"] = True
                    a["fuzzy"] = False
                    level, why, moved = ("title_address",
                                         f"Located from the address in the listing title ({m.group(0).strip()})",
                                         round(d))
                    stats["located from title address"] += 1
                else:
                    # The post names an address nowhere near where Craigslist
                    # put it. That is a discrepancy, not a location.
                    a["addr_conflict"] = round(d)
                    stats["title address contradicts the pin"] += 1

            # 2. a building name we already have coordinates for
            if level is None:
                for nm, (la, lo, addr) in named.items():
                    if nm in title.lower():
                        d = metres(a["lat"], a["lon"], la, lo)
                        if d <= 2500:
                            a["lat"], a["lon"] = round(la, 6), round(lo, 6)
                            a["addr"] = addr or a["addr"]
                            a["parcel_ok"] = True
                            a["fuzzy"] = False
                            level, why, moved = ("building_name",
                                                 f"Located by the building named in the title ({addr})",
                                                 round(d))
                            stats["located from building name"] += 1
                        break

            if level is None:
                level = "neighbourhood"
                # Attribute the vagueness to whoever is actually responsible.
                # Craigslist obscures addresses as policy; the other two publish
                # them, so a soft pin there means the address we got could not
                # be tied to a single building.
                src = (a.get("src") or [{}])[0].get("n") or "This source"
                why = ("Craigslist publishes a neighbourhood rather than an address"
                       if src == "Craigslist"
                       else f"{src} gave an address we could not tie to one building")
                stats["neighbourhood only"] += 1

        # 3. what the title claims about the neighbourhood, either way
        claim = next((h for h in HOODS if h in title.lower()), None)
        if claim:
            a["hood_claim"] = claim
            have = (a.get("hood") or "").lower()
            # Substring either direction: "mission" vs "Mission District".
            if have and claim not in have and have not in claim:
                a["hood_conflict"] = claim
                stats["title neighbourhood disagrees with the pin"] += 1

        a["loc"] = {"level": level, "why": why, "moved_m": moved}

    json.dump(data, open("app_data.json", "w"), separators=(",", ":"))
    print(f"located {len(data):,} listings")
    for k, v in stats.most_common():
        print(f"   {k:<44} {v:,}")


if __name__ == "__main__":
    main()
