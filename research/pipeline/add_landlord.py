"""Landlord identity from SF business registrations, joined by street address.

SF requires a separate business registration per building with 4+ rental units,
so `ownership_name` at `full_business_address` is the landlord entity.
"""
import csv, io, re, sqlite3, sys, time, urllib.parse, urllib.request

SOC = "https://data.sfgov.org/resource"
UA = {"User-Agent": "casita/1.0"}


def fetch(ds, select, where=None, page=50000):
    rows, off = [], 0
    while True:
        p = {"$limit": str(page), "$offset": str(off), "$select": select, "$order": ":id"}
        if where: p["$where"] = where
        url = f"{SOC}/{ds}.csv?" + urllib.parse.urlencode(p)
        for a in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as h:
                    txt = h.read().decode("utf-8", "replace")
                break
            except Exception as e:
                if a == 3: print("FAIL", e); return rows
                time.sleep(2*(a+1))
        c = list(csv.DictReader(io.StringIO(txt)))
        rows += c
        sys.stdout.write(f"\r  {ds}: {len(rows):,}"); sys.stdout.flush()
        if len(c) < page: break
        off += page
    print()
    return rows


def norm(s):
    """'1234 Market St #200' -> '1234 market'  (number + first street word)"""
    s = re.sub(r"[.,#].*$", "", (s or "")).strip().lower()
    s = re.sub(r"\s+", " ", s)
    m = re.match(r"^(\d+)\s+([a-z0-9']+)", s)
    return f"{m.group(1)} {m.group(2)}" if m else None


con = sqlite3.connect("city.sqlite")
con.executescript("""
DROP TABLE IF EXISTS landlord;
CREATE TABLE landlord(key TEXT, owner TEXT, dba TEXT, addr TEXT, mail TEXT, start TEXT);
CREATE INDEX ix_ll ON landlord(key);
""")

print("[1/2] registered business locations (residential lessors)")
rows = fetch("g8m3-pdis",
    "ownership_name,dba_name,full_business_address,business_zip,location_start_date",
    where="location_end_date IS NULL")
keep = []
for r in rows:
    addr = r.get("full_business_address") or ""
    k = norm(addr)
    if not k: continue
    # residential lessors, or anything that looks like a property holder
    own = (r.get("ownership_name") or "")
    keep.append((k, own, r.get("dba_name"), addr,
                 r.get("business_zip"), r.get("location_start_date")))
con.executemany("INSERT INTO landlord VALUES(?,?,?,?,?,?)", keep)
con.commit()
print(f"  landlord rows kept: {len(keep):,}")

print("[2/2] portfolio sizes")
c = con.cursor()
c.execute("""SELECT owner, COUNT(DISTINCT key) n FROM landlord
             WHERE owner IS NOT NULL AND owner <> ''
             GROUP BY owner HAVING n > 1 ORDER BY n DESC LIMIT 12""")
print("  largest portfolios by distinct address:")
for o, nn in c.fetchall():
    print(f"    {nn:>4}  {o[:52]}")
c.execute("SELECT COUNT(DISTINCT key) FROM landlord")
print(f"  distinct addresses with a landlord: {c.fetchone()[0]:,}")
con.close()
