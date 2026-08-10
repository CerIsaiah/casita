"""Build a city-wide per-parcel intelligence DB from SF open data.

Downloads once, aggregates locally. Everything here is free and unauthenticated.
"""
import csv, io, json, os, sqlite3, sys, time, urllib.parse, urllib.request

SOC = "https://data.sfgov.org/resource"
UA = {"User-Agent": "casita/1.0", "Accept-Encoding": "gzip"}
DB = "city.sqlite"


def fetch_csv(ds, select=None, where=None, group=None, order=None, page=50000, cap=None):
    """Page through a Socrata dataset as CSV."""
    rows, off = [], 0
    while True:
        p = {"$limit": str(page), "$offset": str(off)}
        if select: p["$select"] = select
        if where: p["$where"] = where
        if group: p["$group"] = group
        p["$order"] = order or (group or ":id")
        url = f"{SOC}/{ds}.csv?" + urllib.parse.urlencode(p)
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=300) as h:
                    raw = h.read()
                    if h.headers.get("Content-Encoding") == "gzip":
                        import gzip
                        raw = gzip.decompress(raw)
                    txt = raw.decode("utf-8", "replace")
                break
            except Exception as e:
                if attempt == 3:
                    print(f"    FAIL {ds} @{off}: {e}"); return rows
                time.sleep(2 * (attempt + 1))
        chunk = list(csv.DictReader(io.StringIO(txt)))
        rows += chunk
        sys.stdout.write(f"\r    {ds}: {len(rows):,}")
        sys.stdout.flush()
        if len(chunk) < page or (cap and len(rows) >= cap):
            break
        off += page
    print()
    return rows


con = sqlite3.connect(DB)
con.executescript("""
PRAGMA journal_mode=WAL;
DROP TABLE IF EXISTS parcel;
CREATE TABLE parcel(
  blklot TEXT PRIMARY KEY, block TEXT, lot TEXT,
  address TEXT, neighborhood TEXT, lat REAL, lon REAL,
  year_built INT, units INT, stories REAL, prop_class TEXT, use_def TEXT,
  rc_status TEXT, rc_why TEXT,
  novs INT DEFAULT 0, complaints INT DEFAULT 0, active_complaints INT DEFAULT 0,
  abate_n INT DEFAULT 0, abate_median INT, abate_over_year INT DEFAULT 0,
  referred INT DEFAULT 0,
  nov_top TEXT
);
CREATE INDEX IF NOT EXISTS ix_parcel_bl ON parcel(block,lot);
""")

# ---------- 1. assessor: the spine ----------
print("[1/5] assessor roll")
roll = fetch_csv("wv5m-vpq2",
    select="block,lot,property_location,analysis_neighborhood,year_property_built,"
           "number_of_units,number_of_stories,property_class_code_definition,"
           "use_definition,the_geom,closed_roll_year",
    where="closed_roll_year=2024 and number_of_units>='1'")

import re, math
def clean_addr(raw):
    s = re.sub(r"\s+", " ", (raw or "")).strip()
    toks = [t for t in s.split(" ") if t and t not in ("0000", "00")]
    nums = [t for t in toks if t.isdigit()]
    rest = [t for t in toks if not t.isdigit()]
    num = str(int(nums[-1])) if nums else ""
    st = " ".join(rest)
    st = re.sub(r"\bAV0*$|\bAV$", "Ave", st); st = re.sub(r"\bST0*$|\bST$", "St", st)
    st = re.sub(r"0+$", "", st).strip()
    out = f"{num} {st}".strip().title()
    for a, b in [(r"\b(\d+)Th\b", r"\1th"), (r"\b(\d+)St\b", r"\1st"),
                 (r"\b(\d+)Nd\b", r"\1nd"), (r"\b(\d+)Rd\b", r"\1rd")]:
        out = re.sub(a, b, out)
    return out

def rc(y, u, pc, use):
    pcs = ((pc or "") + " " + (use or "")).lower()
    if not y: return ("unknown", "No year built on the assessor roll.")
    if "hotel" in pcs or "sro" in pcs:
        return ("maybe", f"Built {y}, before the 13 June 1979 cutoff — but classed as a "
                "residential hotel / SRO, and stays under 32 continuous days sit outside "
                "the Rent Ordinance.")
    if y > 1979:
        return ("no", f"First occupied {y}, after the 13 June 1979 cutoff, so price control "
                "doesn't apply. Just-cause eviction protection still does.")
    if "condominium" in pcs:
        return ("maybe", f"Built {y}, but condo status can trigger the Costa-Hawkins exemption.")
    if u < 2:
        return ("maybe", f"Built {y}, but single-family homes are usually Costa-Hawkins exempt.")
    return ("yes", f"Built {y}, {u} units, not a condo. Meets the SF Rent Ordinance test for "
            "price control and just-cause eviction protection.")

seen = {}
for r in roll:
    blk, lot = (r.get("block") or "").strip(), (r.get("lot") or "").strip()
    if not blk or not lot: continue
    bl = blk + lot
    if bl in seen: continue
    try: y = int(float(r.get("year_property_built") or 0)) or None
    except ValueError: y = None
    try: u = int(float(r.get("number_of_units") or 0))
    except ValueError: u = 0
    try: st = float(r.get("number_of_stories") or 0) or None
    except ValueError: st = None
    lat = lon = None
    g = r.get("the_geom") or ""
    m = re.search(r"\(\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)", g)
    if m: lon, lat = float(m.group(1)), float(m.group(2))
    s_, w_ = rc(y, u, r.get("property_class_code_definition"), r.get("use_definition"))
    seen[bl] = (bl, blk, lot, clean_addr(r.get("property_location")),
                r.get("analysis_neighborhood"), lat, lon, y, u, st,
                r.get("property_class_code_definition"), r.get("use_definition"), s_, w_)
con.executemany("INSERT OR REPLACE INTO parcel(blklot,block,lot,address,neighborhood,lat,lon,"
    "year_built,units,stories,prop_class,use_def,rc_status,rc_why) "
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", list(seen.values()))
con.commit()
print(f"    parcels stored: {len(seen):,}")

# ---------- 2. NOV counts per parcel (server-side aggregate) ----------
print("[2/5] notices of violation")
nov = fetch_csv("nbtm-fbw5", select="block,lot,count(1) as n", group="block,lot")
con.executemany("UPDATE parcel SET novs=? WHERE block=? AND lot=?",
    [(int(r["n"]), (r.get("block") or "").strip(), (r.get("lot") or "").strip()) for r in nov])
con.commit()
print(f"    parcels with NOVs: {len(nov):,}")

print("      top NOV category per parcel")
novcat = fetch_csv("nbtm-fbw5", select="block,lot,nov_category_description,count(1) as n",
                   group="block,lot,nov_category_description")
best = {}
for r in novcat:
    k = ((r.get("block") or "").strip(), (r.get("lot") or "").strip())
    n = int(r["n"] or 0)
    if k not in best or n > best[k][1]:
        best[k] = ((r.get("nov_category_description") or "").replace(" section", ""), n)
con.executemany("UPDATE parcel SET nov_top=? WHERE block=? AND lot=?",
    [(f"{v[0]}|{v[1]}", k[0], k[1]) for k, v in best.items()])
con.commit()

# ---------- 3. complaints + abatement (needs row detail) ----------
print("[3/5] complaints + abatement lifecycle")
comp = fetch_csv("gm2e-bten",
    select="block,lot,status,date_1st_nov_issued,date_abated,date_referred_to_city_attorney")
import datetime, collections
agg = collections.defaultdict(lambda: {"n": 0, "act": 0, "days": [], "ref": 0})
for r in comp:
    k = ((r.get("block") or "").strip(), (r.get("lot") or "").strip())
    if not k[0]: continue
    a = agg[k]; a["n"] += 1
    if (r.get("status") or "") == "Active": a["act"] += 1
    if (r.get("date_referred_to_city_attorney") or "").strip(): a["ref"] += 1
    s, e = r.get("date_1st_nov_issued"), r.get("date_abated")
    if s and e:
        try:
            d = (datetime.datetime.fromisoformat(e[:19]) -
                 datetime.datetime.fromisoformat(s[:19])).days
            if 0 <= d < 20000: a["days"].append(d)
        except Exception: pass
rows = []
for (blk, lot), a in agg.items():
    ds = sorted(a["days"]); nn = len(ds)
    rows.append((a["n"], a["act"], nn, ds[nn//2] if nn else None,
                 sum(1 for d in ds if d > 365), a["ref"], blk, lot))
con.executemany("UPDATE parcel SET complaints=?,active_complaints=?,abate_n=?,"
    "abate_median=?,abate_over_year=?,referred=? WHERE block=? AND lot=?", rows)
con.commit()
print(f"    parcels with complaints: {len(agg):,}")

# ---------- 4. noise points (for block context) ----------
print("[4/5] noise reports with coordinates")
noise = fetch_csv("vw6y-z8j6", select="lat,long,requested_datetime",
    where="(service_name='Noise Report' or service_name='Noise') and lat is not null")
con.executescript("DROP TABLE IF EXISTS noise;"
                  "CREATE TABLE noise(lat REAL, lon REAL, hr INT);")
nr = []
for r in noise:
    try: la, lo = float(r["lat"]), float(r["long"])
    except Exception: continue
    dt = r.get("requested_datetime") or ""
    hr = int(dt[11:13]) if len(dt) >= 13 and dt[11:13].isdigit() else -1
    nr.append((la, lo, hr))
con.executemany("INSERT INTO noise VALUES(?,?,?)", nr)
con.executescript("CREATE INDEX ix_noise ON noise(lat,lon);")
con.commit()
print(f"    noise points: {len(nr):,}")

# ---------- 5. entertainment venues ----------
print("[5/5] entertainment permits")
ven = fetch_csv("86e8-rfem", select="dba_name,license_type,point")
con.executescript("DROP TABLE IF EXISTS venue;"
                  "CREATE TABLE venue(name TEXT, kind TEXT, lat REAL, lon REAL);")
vr = []
for r in ven:
    m = re.search(r"\(\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)", r.get("point") or "")
    if not m: continue
    vr.append((r.get("dba_name"), r.get("license_type"), float(m.group(2)), float(m.group(1))))
con.executemany("INSERT INTO venue VALUES(?,?,?,?)", vr)
con.executescript("CREATE INDEX ix_venue ON venue(lat,lon);")
con.commit()
print(f"    venues: {len(vr):,}")

c = con.cursor()
print("\n--- summary ---")
for q_, lbl in [
  ("SELECT COUNT(*) FROM parcel", "parcels"),
  ("SELECT COUNT(*) FROM parcel WHERE units>=2", "multi-unit parcels"),
  ("SELECT COUNT(*) FROM parcel WHERE rc_status='yes'", "likely rent-controlled"),
  ("SELECT COUNT(*) FROM parcel WHERE novs>0", "with violations"),
  ("SELECT COUNT(*) FROM parcel WHERE abate_over_year>5", "5+ violations over a year to fix"),
  ("SELECT COUNT(*) FROM parcel WHERE referred>0", "escalated to City Attorney"),
]:
    print(f"  {c.execute(q_).fetchone()[0]:>9,}  {lbl}")
print(f"  {os.path.getsize(DB)/1e6:>9.1f}  MB on disk")
con.close()
