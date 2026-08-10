"""Landlord identity + 'is this a real listing?' checks, added to the payload."""
import collections, json, re, statistics

apts = json.load(open("app_data.json"))
LL = json.load(open("landlords.json"))


def norm(s):
    s = re.sub(r"[.,#].*$", "", (s or "")).strip().lower()
    m = re.match(r"^(\d+)\s+([a-z0-9']+)", re.sub(r"\s+", " ", s))
    return f"{m.group(1)} {m.group(2)}" if m else None


# ---------- 1. photo reuse across different addresses ----------
# The classic rental scam is stolen photography. Same image on two different
# buildings is the single strongest signal available to us.
photo_addr = collections.defaultdict(set)
for a in apts:
    for p in (a.get("photos") or [])[:5]:
        if p: photo_addr[p].add(norm(a["addr"]) or a["id"])
reused = {p for p, s in photo_addr.items() if len(s) > 1}
print(f"photos appearing at 2+ distinct addresses: {len(reused):,}")

# ---------- 2. price sanity, per bedroom count ----------
by_beds = collections.defaultdict(list)
for a in apts:
    if a["rent"] and a["beds"] is not None:
        by_beds[a["beds"]].append(a["rent"])
med = {b: statistics.median(v) for b, v in by_beds.items() if len(v) >= 12}
print("median rent by beds:", {b: int(m) for b, m in sorted(med.items())})

flag_counts = collections.Counter()
for a in apts:
    checks, warns = [], []

    # landlord
    k = norm(a["addr"])
    ll = LL.get(k) if k else None
    big_enough = (a.get("units") or 0) >= 4
    if ll and big_enough:
        a["landlord"] = {"name": ll["owner"], "since": (ll.get("since") or "")[:10],
                         "portfolio": ll.get("portfolio", 1), "conf": "registered"}
        checks.append("Landlord entity registered with the city at this address")
    elif ll:
        a["landlord"] = {"name": ll["owner"], "since": (ll.get("since") or "")[:10],
                         "portfolio": ll.get("portfolio", 1), "conf": "weak"}
        warns.append("A business is registered here, but the building is small enough "
                     "that it may not be the landlord")
    else:
        a["landlord"] = None
        if big_enough:
            warns.append("No landlord entity registered at this address")

    # address verifiability
    if a.get("parcel_ok") and not a.get("fuzzy"):
        checks.append("Address matches a real building on the city parcel map")
    elif a.get("fuzzy"):
        warns.append("The source published only an approximate map pin")
        flag_counts["fuzzy"] += 1
    else:
        warns.append("We could not match this address to a building on the parcel map")
        flag_counts["nomatch"] += 1

    # building record exists
    if a.get("yr"):
        checks.append(f"Building on record since {a['yr']}")

    # photo reuse
    dupes = [p for p in (a.get("photos") or [])[:5] if p in reused]
    if dupes:
        others = set()
        for p in dupes: others |= photo_addr[p]
        others.discard(norm(a["addr"]))
        a["photo_reuse"] = len(others)
        warns.append(f"{len(dupes)} of its photos also appear on {len(others)} other "
                     f"address{'es' if len(others)!=1 else ''}")
        flag_counts["photo_reuse"] += 1
    else:
        a["photo_reuse"] = 0
        if a.get("photo"): checks.append("Photos are unique to this listing")

    # price sanity
    m = med.get(a["beds"])
    if m and a["rent"] < m * 0.45:
        warns.append(f"Rent is {round((1-a['rent']/m)*100)}% below the median for "
                     f"{'a studio' if a['beds']==0 else str(a['beds'])+'bd'} in this data set")
        flag_counts["cheap"] += 1
    elif m:
        checks.append("Rent is in a normal range for its size")

    # no photos at all
    if not a.get("photo"):
        warns.append("No photos on the source listing")
        flag_counts["nophoto"] += 1

    a["trust"] = {
        "ok": checks, "warn": warns,
        "level": "low" if len(warns) >= 3 else "medium" if warns else "high",
    }

json.dump(apts, open("app_data.json", "w"), separators=(",", ":"))

lv = collections.Counter(a["trust"]["level"] for a in apts)
print(f"\ntrust levels: {dict(lv)}")
print("flag counts:", dict(flag_counts))
print(f"with landlord named: {sum(1 for a in apts if a.get('landlord')):,}")
print(f"  high confidence:   {sum(1 for a in apts if a.get('landlord') and a['landlord']['conf']=='registered'):,}")
worst = sorted(apts, key=lambda a: -len(a["trust"]["warn"]))[:6]
print("\nlistings with the most warnings:")
for a in worst:
    print(f"  {a['addr'][:26]:<26} ${a['rent']:<6} {len(a['trust']['warn'])} warns "
          f"| {a['trust']['warn'][0][:60]}")
