"""Pick the most plausible landlord entity per address and test on real listings."""
import json, re, sqlite3, collections

# service businesses that share a building address but do not own it
NOT_LANDLORD = re.compile(
    r"\b(parking|park\b|janitor|cleaning|abm |compass group|bon appetit|catering|cafe|"
    r"restaurant|salon|spa|barber|cellco|wireless|at&t|verizon|t-mobile|sprint|"
    r"security service|staffing|dental|medical|clinic|law offices|insurance agency|"
    r"construction|plumbing|electric co|roofing|landscap|market|liquor|deli|laundry|"
    r"cleaners|pharmacy|church|school|academy|hotel|hostel|tours|travel|"
    r"consulting|software|technolog|media|design studio|photograph)\b", re.I)

LANDLORDISH = re.compile(
    r"\b(apartments?|properties|property|realty|real estate|housing|residential|rentals?|"
    r"estates?|management|mgmt|holdings?|investments?|partners|associates|"
    r"trust|family|llc|l\.l\.c|lp\b|l\.p|inc\b|company|co\b)\b", re.I)


def score(owner, dba):
    s = 0
    name = f"{owner} {dba or ''}"
    if NOT_LANDLORD.search(name): return -10
    if re.search(r"\b(apartments?|properties|property|realty|housing|residential|rentals?)\b",
                 name, re.I): s += 5
    if re.search(r"\b(holdings?|investments?|partners|associates|estates?|management|mgmt)\b",
                 name, re.I): s += 3
    if re.search(r"\b(llc|lp|l\.p|trust)\b", name, re.I): s += 2
    if re.search(r"\binc\b|\bcorp\b|\bcompany\b", name, re.I): s += 1
    return s


con = sqlite3.connect("city.sqlite")
con.row_factory = sqlite3.Row
rows = con.execute("SELECT key, owner, dba, addr, start FROM landlord").fetchall()
best = {}
for r in rows:
    sc = score(r["owner"], r["dba"])
    if sc <= 0: continue
    k = r["key"]
    if k not in best or sc > best[k][0]:
        best[k] = (sc, dict(r))
print(f"addresses with a plausible landlord entity: {len(best):,}")

# top portfolios among the filtered set
port = collections.Counter()
for _, r in best.values():
    if r["owner"]: port[r["owner"]] += 1
print("\nlargest landlord portfolios (distinct addresses):")
for o, c in port.most_common(12):
    print(f"  {c:>4}  {o[:56]}")


def norm(s):
    s = re.sub(r"[.,#].*$", "", (s or "")).strip().lower()
    m = re.match(r"^(\d+)\s+([a-z0-9']+)", re.sub(r"\s+", " ", s))
    return f"{m.group(1)} {m.group(2)}" if m else None


apts = json.load(open("app_data.json"))
hit = 0
samples = []
for a in apts:
    k = norm(a["addr"])
    if k and k in best:
        hit += 1
        if len(samples) < 12:
            r = best[k][1]
            samples.append((a["addr"], a["units"], r["owner"][:40], port[r["owner"]]))
print(f"\nlistings with a landlord identified: {hit:,} of {len(apts):,} "
      f"({hit/len(apts)*100:.0f}%)")
print(f"{'listing':<26}{'units':>6}  {'registered entity':<42}{'portfolio'}")
for ad, u, o, p in samples:
    print(f"{ad[:26]:<26}{str(u):>6}  {o:<42}{p}")

json.dump({k: {"owner": v[1]["owner"], "dba": v[1]["dba"], "since": v[1]["start"],
               "portfolio": port[v[1]["owner"]]}
           for k, v in best.items()}, open("landlords.json", "w"))
print("\nwrote landlords.json")
