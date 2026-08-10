"""The places a life is actually built around: groceries, gyms, transit.

OpenStreetMap via Overpass. Free, no key, and good enough for "is there a
Trader Joe's within walking distance" -- which is the only question being asked
of it. Brand is kept separately from name so someone who specifically wants a
Trader Joe's or a 24 Hour Fitness can say so.

Work, a partner's place, a studio -- those are personal, so they are never
stored here. The browser holds them, the same way it holds search memory.
"""
import collections, json, sqlite3, sys, time, urllib.parse, urllib.request

BBOX = "37.70,-122.53,37.84,-122.34"
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter"]

QUERIES = {
    "grocery": f"""node["shop"~"^(supermarket|greengrocer)$"]({BBOX});
                   way["shop"="supermarket"]({BBOX});""",
    "gym":     f"""node["leisure"="fitness_centre"]({BBOX});
                   node["amenity"="gym"]({BBOX});
                   way["leisure"="fitness_centre"]({BBOX});""",
    "transit": f"""node["railway"="station"]({BBOX});
                   node["railway"="tram_stop"]({BBOX});
                   node["station"="subway"]({BBOX});""",
    "cafe":    f"""node["amenity"="cafe"]({BBOX});""",
    "park":    f"""way["leisure"="park"]({BBOX});""",
    "pharmacy": f"""node["amenity"="pharmacy"]({BBOX});""",
    # Going out, split by what you'd actually be doing.
    #
    # These exist because the city's entertainment permits -- the other source
    # of nightlife in this project -- do not mean what the name suggests.
    # "Extended Hours Premises" is a licence to trade late, and it is held by
    # Silvercrest Donuts, The Mosser Hotel and SOMArts Cultural Center as
    # readily as by a club. "Limited Live Performance" covers Fior d'Italia and
    # a charitable foundation. Scoring a party block off those alone put donut
    # shops in the numerator. OSM says bar when it means bar.
    "bar":     f"""node["amenity"~"^(bar|pub)$"]({BBOX});""",
    "club":    f"""node["amenity"="nightclub"]({BBOX});""",
    "music":   f"""node["amenity"="music_venue"]({BBOX});
                   node["amenity"="theatre"]({BBOX});""",
    "restaurant": f"""node["amenity"="restaurant"]({BBOX});""",
}


def overpass(body):
    q = f"[out:json][timeout:90];({body});out center;"
    for m in MIRRORS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(
                    m, data=urllib.parse.urlencode({"data": q}).encode(),
                    headers={"User-Agent": "casita/1.0 (personal apartment search)"})
                with urllib.request.urlopen(req, timeout=150) as h:
                    return json.load(h).get("elements", [])
            except Exception as e:
                print(f"   {m.split('/')[2]} attempt {attempt+1}: {str(e)[:60]}")
                time.sleep(4)
    return []


con = sqlite3.connect("city.sqlite")

# What each category looked like last time, so an Overpass timeout can't quietly
# empty one. This actually happened: the park query 504'd on a rebuild, the
# script printed "park 0" and carried on, and places.json shipped with no parks
# in it at all. A category that collapses to nothing is a failed fetch, not a
# city that lost its parks.
try:
    before = dict(con.execute("SELECT kind, COUNT(*) FROM place GROUP BY kind"))
except sqlite3.OperationalError:
    before = {}

rows, thin = [], []
for kind, body in QUERIES.items():
    els = overpass(body)
    seen = set()
    for e in els:
        t = e.get("tags", {}) or {}
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        name = t.get("name")
        if not (lat and lon and name):
            continue
        k = (round(lat, 5), round(lon, 5), name)
        if k in seen:
            continue
        seen.add(k)
        brand = t.get("brand") or t.get("operator") or None
        # transit that is really a rail stop, so the label can say which network
        if kind == "transit":
            net = t.get("network") or t.get("operator") or ""
            brand = ("BART" if "BART" in net.upper() else
                     "Caltrain" if "caltrain" in net.lower() else
                     "Muni" if "muni" in net.lower() or t.get("railway") == "tram_stop"
                     else brand)
        rows.append((kind, name, brand, float(lat), float(lon)))
    was = before.get(kind, 0)
    # Both halves of the old test needed a non-zero `was`, so on a rebuilt or
    # missing `place` table (before == {}) the guard did nothing at all -- a
    # total Overpass failure would write an empty table and places.json = [],
    # exit 0, and take the whole proximity and nightlife layer down city-wide.
    # An empty category is a failed fetch regardless of what we knew before.
    lost = (was and len(seen) < was * 0.5) or not seen
    print(f"  {kind:<11} {len(seen):>4}{f'   was {was} -- FETCH FAILED' if lost else ''}")
    if lost:
        thin.append((kind, len(seen), was))
    time.sleep(1.5)                    # Overpass is a donated service; don't hammer it

if thin:
    con.close()
    print("\nRefusing to write. These came back far short of last run, which means\n"
          "Overpass failed rather than the city changing:", file=sys.stderr)
    for kind, got, was in thin:
        print(f"  {kind}: {got} now, {was} before", file=sys.stderr)
    print("\ncity.sqlite and places.json are unchanged. Re-run when Overpass is healthy.",
          file=sys.stderr)
    sys.exit(1)

# Build beside the live table and swap only once the insert has succeeded --
# dropping first meant a failure during executemany left nothing behind, which is
# the loss the guard above exists to prevent.
con.executescript("""
DROP TABLE IF EXISTS place_new;
CREATE TABLE place_new(kind TEXT, name TEXT, brand TEXT, lat REAL, lon REAL);
""")
con.executemany("INSERT INTO place_new VALUES(?,?,?,?,?)", rows)
con.executescript("""
DROP TABLE IF EXISTS place;
ALTER TABLE place_new RENAME TO place;
""")
con.commit()
con.executescript("CREATE INDEX ix_place ON place(kind,lat,lon);")

print(f"\nstored {len(rows):,} places")
for k, n in con.execute("SELECT kind,COUNT(*) FROM place GROUP BY kind ORDER BY 2 DESC"):
    print(f"  {k:<9} {n:>4}")

# the chains people name when they say "my gym" or "my grocery store"
print("\nchains worth offering by name:")
for kind in ("grocery", "gym"):
    # One count per place, keyed the same way life.js keys it (brand or else
    # name). Adding a Counter of brands to a Counter of names double-counted
    # every store whose brand and name match -- which is most chains -- so the
    # number a human uses to sanity-check the quiz's chain list read about 2x.
    c = collections.Counter(
        (b or nm) for b, nm in
        con.execute("SELECT brand, name FROM place WHERE kind=?", (kind,)))
    for b, n in c.most_common(8):
        if n >= 2:
            print(f"  {kind:<9} {b} ({n})")

out = [{"k": k, "n": n, "b": b, "la": round(la, 5), "lo": round(lo, 5)}
       for k, n, b, la, lo in con.execute("SELECT kind,name,brand,lat,lon FROM place")]
json.dump(out, open("places.json", "w"), separators=(",", ":"))
import os
print(f"\nplaces.json {os.path.getsize('places.json')/1e6:.2f} MB")
con.close()
