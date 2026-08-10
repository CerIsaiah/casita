"""Use the unit-level data that was already paid for and then ignored.

The Apartments.com payload carries, per individual unit: the true total monthly
price, the real square footage, and that unit's own amenity list. Three things
follow from actually reading it.

  1. "Actual monthly" stops being an estimate. For unit 0501 at Geary Courtyard
     the site publishes $2,546 against a $2,539 base. The old estimate said
     $2,621 -- $75 too high, and labelled "est" when the exact figure was
     sitting in the payload.

  2. Amenities are per unit, not per building. A building that advertises
     "washer/dryer in select homes" tells you nothing about the home you'd
     actually rent. The unit record does: 0501 lists Washer/Dryer.

  3. Walk, transit and sound scores come along for free.

Also fixes a genuine inconsistency: reviews describe a building, so every
listing in that building must show the same ones. Before this, three ads at
639 Geary St showed Residents scores of 70, 31 and 43 depending on which
source each ad happened to inherit.
"""
import collections, json, os, re
import atomicjson

apts = json.load(open("app_data.json"))
rows = json.load(open("apify_apts.json")) if os.path.exists("apify_apts.json") else []

by_url = {}
for r in rows:
    u = (r.get("url") or "").split("?")[0]
    if u:
        by_url[u.rstrip("/") + "/"] = r


def norm_unit(u):
    if not u:
        return None
    s = re.sub(r"[^0-9a-z]", "", str(u).lower())
    return s.lstrip("0") or s


KEEP = ["Washer/Dryer", "Washer/Dryer Hookup", "Air Conditioning", "Dishwasher",
        "Balcony", "Patio", "Deck", "Views", "Walk-In Closets", "Storage Space",
        "Fireplace", "Hardwood Floors", "Furnished", "Loft Layout", "High Ceilings"]

# ---------- pet policy ----------
# Published per building and thrown away until now. Two things come out of it,
# and only the first is obvious.
#
#   1. Whether pets are accommodated. Read the vocabulary before trusting this:
#      there is no "Not Allowed" value in the feed at all -- only "Allowed" and
#      a list of charges. So a missing pet section means the building never
#      published one, NOT that pets are banned, and it is recorded as unknown
#      for exactly the same reason a missing amenity list is.
#
#   2. Pet rent is rent. A $150/mo pet fee on a $4,000 apartment is real money,
#      and getting "actual monthly" right is the reason this product exists. It
#      stays a separate number rather than folding into `act`, because it only
#      applies to people who actually have a pet.
MONTHLY_FEE = re.compile(r"\b(?:pet|dog|cat)s?\s*(?:rent|premium)\b|monthly\s*pet\s*fee|petrt", re.I)
ONETIME_FEE = re.compile(r"deposit|one-?time|screening|\bfee\b", re.I)
CAT_RE = re.compile(r"\bcats?\b", re.I)
DOG_RE = re.compile(r"\bdogs?\b", re.I)
MAX_RE = re.compile(r"max of (\d+)", re.I)


def money_num(s):
    m = re.search(r"\$\s*([\d,]+)", str(s or ""))
    return int(m.group(1).replace(",", "")) if m else None


def pet_policy(r):
    entries = (r.get("fees") or {}).get("pet") or []
    if not entries:
        return None
    monthly = onetime = maxn = 0
    cats = dogs = False
    for e in entries:
        name, grp = e.get("name") or "", e.get("group") or ""
        # `group` is unreliable -- "Cat Deposit" arrives filed under "Dogs" --
        # so species is taken from whichever of the two actually names one.
        blob = grp + " " + name
        cats = cats or bool(CAT_RE.search(blob))
        dogs = dogs or bool(DOG_RE.search(blob))
        amt = money_num(e.get("amount"))
        if amt:
            if MONTHLY_FEE.search(name):
                monthly = max(monthly, amt)
            elif ONETIME_FEE.search(name):
                onetime = max(onetime, amt)
        m = MAX_RE.search(e.get("note") or "")
        if m:
            maxn = max(maxn, int(m.group(1)))
    return {"ok": True, "dogs": dogs or None, "cats": cats or None,
            "monthly": monthly or None, "onetime": onetime or None,
            "max": maxn or None, "src": "Apartments.com"}


matched = priced = amen = scored = pets = 0
for a in apts:
    src = next((s for s in a["src"] if s["n"] == "Apartments.com"), None)
    if not src:
        continue
    r = by_url.get(src["u"].rstrip("/") + "/")
    if not r:
        continue

    # Building-level, so it is read before the unit match below can `continue`.
    pp = pet_policy(r)
    if pp:
        # Merge rather than replace. A plain assignment here meant that running
        # this after merge_pets.py silently deleted every Craigslist yes/no flag,
        # so the pair only worked in one order and said so nowhere.
        cur = a.get("pet")
        if cur and "Craigslist" in (cur.get("src") or ""):
            for k in ("monthly", "onetime", "max"):
                cur[k] = cur.get(k) or pp[k]
            cur["ok"] = bool(cur.get("ok") or pp["ok"])
            cur["dogs"] = cur.get("dogs") or pp["dogs"]
            cur["cats"] = cur.get("cats") or pp["cats"]
            if "Apartments.com" not in (cur.get("src") or ""):
                cur["src"] = "Apartments.com + " + cur["src"]
        else:
            a["pet"] = pp
        pets += 1

    sc = r.get("scores") if isinstance(r.get("scores"), dict) else {}
    num = lambda k: sc.get(k) if isinstance(sc.get(k), (int, float)) else None
    if num("walkScore") or num("soundScore"):
        a["scores"] = {"walk": num("walkScore"), "transit": num("transitScore"),
                       "sound": num("soundScore"), "soundLabel": sc.get("soundScoreLabel"),
                       "bike": num("bikeScore")}
        scored += 1

    units = r.get("units") or []
    want = norm_unit(a.get("unit"))
    u = None
    if want:
        u = next((x for x in units if norm_unit(x.get("unitNumber")) == want), None)
    if not u and len(units) == 1:
        u = units[0]
    if not u and units:
        # fall back to the unit whose beds and rent match this ad
        cand = [x for x in units if (x.get("beds") == a.get("beds"))
                and abs((x.get("rent") or 0) - (a.get("rent") or 0)) <= 60]
        if len(cand) == 1:
            u = cand[0]
    if not u:
        continue
    matched += 1

    tot = u.get("totalMonthlyPriceMin")
    if tot and u.get("rent"):
        a["act"] = [int(tot), int(u.get("totalMonthlyPriceMax") or tot)]
        a["est"] = "verified"                     # the site publishes this, we aren't guessing
        a["rent"] = int(u["rent"])
        priced += 1
    if u.get("sqft"):
        # same plausibility ceiling as fix_data: a 1-bed is not 2,200 sq ft
        ceil = {0:950, 1:1400, 2:2000, 3:2800, 4:3600}.get(a.get("beds"), 2500)
        # Only overwrite when the unit record is plausible. Blanking on a bad
        # value threw away good sqft already established from another source,
        # and sqft is thin enough (about half the list) to matter -- it feeds
        # evidence(), quality() and dimApartment().
        if 80 <= int(u["sqft"]) <= ceil:
            a["sqft"] = int(u["sqft"])
    ua = u.get("amenities") or []
    if ua:
        a["unit_amen"] = [x for x in KEEP if x in ua]
        # A hookup is a pipe, not an appliance. Counting it as in-unit laundry
        # made the card say "Yes -- listed on this unit", made `wd` satisfy the
        # in-unit-laundry hard constraint, and printed "washer/dryer in the unit"
        # as a green reason, for a home with no washer in it. The hookup is still
        # visible: it stays in unit_amen.
        a["wd"] = "Washer/Dryer" in ua
        amen += 1

print(f"listings matched to a specific unit: {matched:,}")
print(f"  actual monthly now verified, not estimated: {priced:,}")
print(f"  with that unit's own amenity list:          {amen:,}")
print(f"  with walk / transit / sound scores:         {scored:,}")
print(f"listings with a published pet policy:       {pets:,}")

# ---------- one building, one set of reviews ----------
# Keyed on address, not parcel: 639 Geary St sits on two legal lots, so a
# parcel key left the same building showing 3.9 on one ad and 3.1 on another.
def bkey(a):
    return re.sub(r"\s+", " ", (a.get("addr") or "").upper().strip())

best = {}
for a in apts:
    pid = bkey(a)
    if not pid:
        continue
    for key in ("areview", "greview"):
        v = a.get(key)
        if not v:
            continue
        if (v.get("n") or 0) > (best.get((pid, key), {}).get("n") or 0):
            best[(pid, key)] = v

evened = 0
for a in apts:
    pid = bkey(a)
    if not pid:
        continue
    for key in ("areview", "greview"):
        v = best.get((pid, key))
        if v and a.get(key) is not v:
            a[key] = v
            evened += 1

for a in apts:
    ar, gr = a.get("areview"), a.get("greview")
    g_ok = gr and gr.get("score")
    a.pop("rating_gap", None)
    if ar and ar["n"] >= 5:
        a["rating_src"], a["rating"], a["rating_n"] = "Apartments.com renters", ar["score"], ar["n"]
    elif g_ok:
        a["rating_src"], a["rating"], a["rating_n"] = "Google", gr["score"], gr["n"]
    elif ar:
        a["rating_src"], a["rating"], a["rating_n"] = "Apartments.com renters", ar["score"], ar["n"]
    else:
        a["rating"] = None; a["rating_n"] = 0; a["rating_src"] = None
    if (ar and g_ok and ar["n"] >= 5 and gr["n"] >= 5
            and abs(ar["score"] - gr["score"]) >= 1.0):
        a["rating_gap"] = {"renters": ar["score"], "rn": ar["n"],
                           "google": gr["score"], "gn": gr["n"]}

print(f"\nreview records levelled across a building: {evened:,}")
spread = collections.defaultdict(set)
for a in apts:
    # Skip the address-less ones, exactly as the two levelling loops above do.
    # Without this they all land in a single "" bucket, which is never levelled
    # and so always disagrees with itself -- inflating the count below into a
    # permanent false alarm.
    if not bkey(a):
        continue
    spread[bkey(a)].add(a["rating"])
bad = [p for p, v in spread.items() if len(v) > 1]
print(f"buildings still showing more than one rating: {len(bad)}")

atomicjson.dump(apts, "app_data.json")
print(f"\nverified actual monthly: {sum(1 for a in apts if a.get('est')=='verified'):,} of {len(apts):,}")
print(f"in-unit washer/dryer known: {sum(1 for a in apts if a.get('wd') is not None):,}"
      f"  (of those, have one: {sum(1 for a in apts if a.get('wd')):,})")
