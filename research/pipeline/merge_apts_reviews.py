"""Fold Apartments.com renter reviews in, and let a building's reviews reach
every listing in that building.

Two things this adds over the Google score already on the payload:

1. A different population. Google reviews of a leasing office skew high --
   management asks happy tenants and tour visitors. Apartments.com reviews are
   posted by renters, and skew low for the opposite reason. Neither is "the"
   rating, so both are shown, named, with their counts.

2. The shape, not just the mean. Geary Courtyard averages 3.1, which sounds
   mediocre and uneventful. The distribution is seven 5-stars and seven
   1-stars -- a building people either like or can't wait to leave. That is a
   different thing to know than "3.1", and it is the reason the mean alone was
   never enough.

Craigslist has no reviews at all. But a Craigslist ad sits at a parcel, and if
any other listing in the same building carries reviews, they describe the same
building -- so they carry across, labelled as building-level.
"""
import collections, json, os

apts = json.load(open("app_data.json"))
raw = json.load(open("apts_reviews.json")) if os.path.exists("apts_reviews.json") else {}

usable = {k: v for k, v in raw.items() if v.get("m") and v.get("n")}
print(f"apartments.com pages harvested: {len(raw)}  with a renter rating: {len(usable)}")

# ---------- attach by the listing's own Apartments.com URL ----------
direct = 0
for a in apts:
    for s in a["src"]:
        if s["n"] != "Apartments.com":
            continue
        p = s["u"].replace("https://www.apartments.com/", "")
        v = usable.get(p)
        if not v:
            continue
        dist = {str(k): c for k, c in (v.get("d") or [])}
        tot = sum(dist.values()) or v["n"]
        a["areview"] = {
            "score": v["m"], "n": v["n"], "dist": dist,
            # the mean hides a split verdict; say so when the ends outweigh the middle
            "split": bool(tot >= 6 and (dist.get("5", 0) + dist.get("1", 0)) / tot >= 0.6
                          and dist.get("5", 0) >= 2 and dist.get("1", 0) >= 2),
            "url": s["u"],
        }
        direct += 1
print(f"listings given a renter rating directly: {direct}")

# ---------- carry building-level reviews across the whole parcel ----------
best = {}
for a in apts:
    if not a.get("parcel_ok"):
        continue
    pid = a["id"].split("|")[0]
    for key, src in (("areview", "Apartments.com"), ("greview", "Google")):
        v = a.get(key)
        if not v:
            continue
        n = v.get("n") or 0
        cur = best.get((pid, key))
        if not cur or n > (cur.get("n") or 0):
            best[(pid, key)] = v

carried = collections.Counter()
for a in apts:
    if not a.get("parcel_ok"):
        continue
    pid = a["id"].split("|")[0]
    for key in ("areview", "greview"):
        if a.get(key):
            continue
        v = best.get((pid, key))
        if v:
            a[key] = dict(v, inherited=True)
            carried[key] += 1
print(f"carried across the building: {dict(carried)}")

# ---------- pick what the card shows ----------
# Prefer renters over Google when there are enough of them. Google's reviewers
# include tour visitors and people the office asked; Apartments.com's are
# people who signed a lease. Picking purely on volume would have buried
# 150 Van Ness's 1.6 from renters under a 3.8 from Google.
for a in apts:
    ar, gr = a.get("areview"), a.get("greview")
    g_ok = gr and gr.get("score")
    if ar and ar["n"] >= 5:
        a["rating_src"], a["rating"], a["rating_n"] = "Apartments.com renters", ar["score"], ar["n"]
    elif g_ok:
        a["rating_src"], a["rating"], a["rating_n"] = "Google", gr["score"], gr["n"]
    elif ar:
        a["rating_src"], a["rating"], a["rating_n"] = "Apartments.com renters", ar["score"], ar["n"]
    else:
        a["rating"] = None; a["rating_n"] = 0; a["rating_src"] = None
    # when the two populations disagree, that gap is the finding
    if ar and g_ok and abs(ar["score"] - gr["score"]) >= 1.0:
        a["rating_gap"] = {"renters": ar["score"], "rn": ar["n"],
                           "google": gr["score"], "gn": gr["n"]}

json.dump(apts, open("app_data.json", "w"), separators=(",", ":"))

n = sum(1 for a in apts if a["rating"])
by = collections.Counter(a["rating_src"] for a in apts if a["rating"])
splits = sum(1 for a in apts if (a.get("areview") or {}).get("split"))
both = sum(1 for a in apts if a.get("areview") and a.get("greview"))
print(f"\nlistings with a rating: {n:,} of {len(apts):,}   {dict(by)}")
print(f"  rated by both sites:  {both:,}")
print(f"  split verdict (loved and hated): {splits:,}")
dis = [(a["addr"], a["areview"]["score"], a["greview"]["score"]) for a in apts
       if a.get("areview") and a.get("greview") and a["greview"].get("score")
       and abs(a["areview"]["score"] - a["greview"]["score"]) >= 1.0]
print(f"  sites disagree by 1.0+: {len(dis):,}")
for d in dis[:5]:
    print(f"    {d[0]:<26} renters {d[1]}  vs  Google {d[2]}")
