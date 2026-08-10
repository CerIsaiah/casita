"""Per-listing street counts + a coarse citywide grid for the map heatmaps."""
import collections, json, math, sqlite3, sys
import atomicjson

M_LAT = 110540.0
def m_lon(lat): return 111320.0 * math.cos(math.radians(lat))

EXPECT = {"encampment", "cleaning", "break_in", "violent"}

con = sqlite3.connect("city.sqlite")
pts = collections.defaultdict(list)
try:
    rows = con.execute("SELECT kind,lat,lon FROM street").fetchall()
except sqlite3.OperationalError:
    con.close()
    sys.exit("city.sqlite has no `street` table -- run add_street.py first.")
for kind, la, lo in rows:
    pts[kind].append((la, lo))
con.close()
print({k: len(v) for k, v in pts.items()})

# An empty or partial `street` table is a failed fetch upstream, not a city with
# no incidents in it -- and without this guard the failure is silent and
# destructive: every listing gets street={} and street_pct={}, street_grid.json
# becomes {}, and app_data.json is overwritten with all of it. That single run
# would take out the safety gate, the neighbourhood dimension, the calm sort, all
# four heat layers and the drawer's street section, with a clean exit code.
missing = EXPECT - set(pts)
if missing or not rows:
    sys.exit(f"`street` table is empty or incomplete (missing: {sorted(missing) or 'all'}). "
             f"Re-run add_street.py; refusing to overwrite app_data.json.")

# spatial index per layer
CELL = 0.0035
grids = {}
for k, v in pts.items():
    g = collections.defaultdict(list)
    for la, lo in v:
        g[(int(la / CELL), int(lo / CELL))].append((la, lo))
    grids[k] = g


def near(k, lat, lon, r):
    g = grids.get(k) or {}
    dla = r / M_LAT
    dlo = r / m_lon(lat)
    n = 0
    for i in range(int((lat - dla) / CELL), int((lat + dla) / CELL) + 1):
        for j in range(int((lon - dlo) / CELL), int((lon + dlo) / CELL) + 1):
            for la, lo in g.get((i, j), ()):
                if math.hypot((lo - lon) * m_lon(lat), (la - lat) * M_LAT) <= r:
                    n += 1
    return n


apts = json.load(open("app_data.json"))
cache = {}
for a in apts:
    key = (round(a["lat"], 4), round(a["lon"], 4))
    if key not in cache:
        cache[key] = {k: near(k, a["lat"], a["lon"], 250) for k in pts}
    a["street"] = cache[key]
# a raw count means nothing without knowing what is normal for SF
import bisect
ranked = {k: sorted(a["street"][k] for a in apts) for k in pts}
for a in apts:
    a["street_pct"] = {}
    for k in pts:
        arr = ranked[k]
        a["street_pct"][k] = round(bisect.bisect_left(arr, a["street"][k]) / len(arr) * 100)
atomicjson.dump(apts, "app_data.json")

for k in pts:
    vals = sorted(a["street"][k] for a in apts)
    n = len(vals)
    print(f"  {k:<12} median {vals[n//2]:>5}   p90 {vals[int(n*0.9)]:>5}   max {vals[-1]:>5}"
          f"   (within 250m)")

# citywide grid for the heatmap layers, ~90m cells
GC = 0.0011
grid_out = {}
for k, v in pts.items():
    c = collections.Counter()
    for la, lo in v:
        c[(round(la / GC), round(lo / GC))] += 1
    # drop the long tail of single hits so the payload stays small
    cells = [[round(i * GC, 5), round(j * GC, 5), n] for (i, j), n in c.items() if n >= 2]
    grid_out[k] = cells
    print(f"  {k:<12} grid cells: {len(cells):,}")
atomicjson.dump(grid_out, "street_grid.json")
import os
print(f"  grid payload: {os.path.getsize('street_grid.json')/1e6:.2f} MB")
