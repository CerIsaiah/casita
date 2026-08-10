"""Street-condition layers: encampments, car break-ins, cleaning requests.

Deliberately kept as separate named categories rather than blended into one
"safety score". Those scores are routinely criticised for encoding bias, and
they also just tell you less -- a block with car break-ins and a block with
encampment reports are different problems with different implications.
"""
import csv, io, json, sqlite3, sys, time, urllib.parse, urllib.request

SOC = "https://data.sfgov.org/resource"
UA = {"User-Agent": "casita/1.0"}
SINCE = "2025-08-01T00:00:00.000"

FAILED = []          # a page that never came back; see the guard before the swap


def fetch(ds, select, where, page=50000):
    rows, off = [], 0
    while True:
        p = {"$limit": str(page), "$offset": str(off), "$select": select,
             "$where": where, "$order": ":id"}
        url = f"{SOC}/{ds}.csv?" + urllib.parse.urlencode(p)
        for a in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                            timeout=300) as h:
                    txt = h.read().decode("utf-8", "replace")
                break
            except Exception as e:
                if a == 3:
                    print("  fail", str(e)[:70])
                    FAILED.append(f"{ds} offset {off}: {str(e)[:70]}")
                    return rows
                time.sleep(2 * (a + 1))
        c = list(csv.DictReader(io.StringIO(txt)))
        rows += c
        sys.stdout.write(f"\r  {ds}: {len(rows):,}"); sys.stdout.flush()
        if len(c) < page: break
        off += page
    print()
    return rows


con = sqlite3.connect("city.sqlite")
# Built beside the live table and swapped at the end. Dropping first meant a
# Socrata outage left an empty-but-present `street`, which add_street_stats.py
# then happily turned into street={} on all 2,547 listings and an empty
# street_grid.json -- silently, with a clean exit code.
con.executescript("""
DROP TABLE IF EXISTS street_new;
CREATE TABLE street_new(kind TEXT, lat REAL, lon REAL);
""")

jobs = [
    ("encampment", "vw6y-z8j6", "lat,long",
     f"service_name='Encampment' and requested_datetime > '{SINCE}' and lat is not null"),
    ("cleaning", "vw6y-z8j6", "lat,long",
     f"service_name='Street and Sidewalk Cleaning' and requested_datetime > '{SINCE}' "
     f"and lat is not null"),
    ("break_in", "wg3w-h783", "latitude,longitude",
     f"incident_date > '{SINCE}' and latitude is not null and "
     f"(incident_subcategory in('Larceny - From Vehicle','Theft From Vehicle') "
     f"or incident_category='Motor Vehicle Theft')"),
    ("violent", "wg3w-h783", "latitude,longitude",
     f"incident_date > '{SINCE}' and latitude is not null and "
     f"incident_category in('Assault','Robbery','Homicide','Sex Offense')"),
]

for kind, ds, sel, where in jobs:
    print(f"[{kind}]")
    rows = fetch(ds, sel, where)
    pts = []
    for r in rows:
        la = r.get("lat") or r.get("latitude")
        lo = r.get("long") or r.get("longitude")
        try:
            la, lo = float(la), float(lo)
        except (TypeError, ValueError):
            continue
        if 37.6 < la < 37.9 and -122.6 < lo < -122.3:
            pts.append((kind, la, lo))
    con.executemany("INSERT INTO street_new VALUES(?,?,?)", pts)
    con.commit()
    print(f"  stored {len(pts):,}")
    if not pts:
        FAILED.append(f"{kind}: zero rows")

if FAILED:
    con.executescript("DROP TABLE IF EXISTS street_new;")
    con.close()
    print("\nIncomplete fetch -- keeping the existing table. Gaps here are\n"
          "indistinguishable from calm blocks downstream:", file=sys.stderr)
    for f in FAILED:
        print("  " + f, file=sys.stderr)
    sys.exit(1)

con.executescript("""
DROP INDEX IF EXISTS ix_street;
DROP TABLE IF EXISTS street;
ALTER TABLE street_new RENAME TO street;
CREATE INDEX ix_street ON street(lat,lon);
""")
con.commit()
for k, in con.execute("SELECT DISTINCT kind FROM street"):
    n = con.execute("SELECT COUNT(*) FROM street WHERE kind=?", (k,)).fetchone()[0]
    print(f"  {k:<12} {n:>8,}")
con.close()
