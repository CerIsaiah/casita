"""Two correctness fixes found by checking a real building against other sources.

1. Multi-lot buildings. A single building can span several legal lots. Geary
   Courtyard is "639 Geary St" on both 0318021 (46 violations, units=1) and
   0318022 (0 violations, units=164). Whichever lot a listing matched decided
   whether it looked clean, and the tie broke toward clean. Aggregate the group.

2. Rating provenance. `rating` was whatever the source site put in its feed.
   For Apartments.com that is a marketing star, not a resident score: 296
   listings carried a flat 5 while their Google score said otherwise (118 round
   to 4, twelve to 3, six to 2). A number labelled "Resident rating" has to come
   from residents, so only Google-review scores survive, and the count travels
   with the score.
"""
import collections, json, re, sqlite3
import atomicjson


def money_pct(r):
    return f"{round(r * 100)}%"


def bedTxt_py(a):
    b = a.get("beds")
    return "a studio" if b == 0 else f"a {b}-bed" if b else "this size" 

con = sqlite3.connect("city.sqlite")
rows = con.execute(
    "SELECT blklot,address,units,novs,complaints,active_complaints,"
    "abate_median,abate_over_year,referred,nov_top FROM parcel "
    "WHERE address IS NOT NULL").fetchall()
con.close()


def norm(a):
    return re.sub(r"\s+", " ", (a or "").upper().strip())


groups = collections.defaultdict(list)
for r in rows:
    groups[norm(r[1])].append(r)

apts = json.load(open("app_data.json"))

# ---------- 1. roll multi-lot buildings back into one building ----------
merged = 0
for a in apts:
    g = groups.get(norm(a["addr"]))
    if not g or len(g) < 2:
        continue
    before = a["novs"]
    a["units"] = max((x[2] or 0) for x in g) or a["units"]
    a["novs"] = sum(x[3] or 0 for x in g)
    a["active"] = sum(x[5] or 0 for x in g)
    a["over_year"] = sum(x[7] or 0 for x in g)
    a["referred"] = sum(x[8] or 0 for x in g)
    med = [x[6] for x in g if x[6]]
    a["abate_med"] = round(sum(med) / len(med)) if med else None
    top = [x[9] for x in g if x[9]]
    a["nov_top"] = top[0] if top else None
    a["lots"] = len(g)                       # so the drawer can say why
    if a["novs"] != before:
        merged += 1
print(f"multi-lot buildings corrected: {merged} listings")

# ---------- 2. a resident rating has to come from residents ----------
dropped = kept = 0
for a in apts:
    g = a.get("greview")
    site = a.get("rating")
    if g and g.get("score"):
        a["rating"] = g["score"]
        a["rating_n"] = g["n"]
        a["rating_src"] = "Google"
        a["rating_sampled"] = g.get("sampled") or 0
        kept += 1
    else:
        if site:
            dropped += 1
        a["rating"] = None
        a["rating_n"] = 0
        a["rating_src"] = None
        a["rating_sampled"] = 0
    a["site_stars"] = site if site and not g else None
print(f"ratings kept (Google, with count): {kept}")
print(f"unsourced site stars removed:      {dropped}")

# ---------- 3. sqft has to be a number ----------
# Some feeds send "633 sq ft", a range like "367 - 981 sq ft", or a building
# total dressed as a unit size ("521 - 14,111,519 sq ft"). A string here made
# every arithmetic use of it NaN, which silently voided the whole home score.
# A flat 80-5000 window let a building footprint through as a one-bedroom:
# 151 Chenery St came out as a 2,248 sq ft 1-bed for $2,700. Size has to be
# plausible for the number of bedrooms, not just plausible in the abstract.
SQFT_CEIL = {0: 950, 1: 1400, 2: 2000, 3: 2800, 4: 3600}


def unit_sqft(v, beds=None):
    if isinstance(v, (int, float)):
        n = int(v)
    elif isinstance(v, str):
        m = re.search(r"[\d,]+", v)
        if not m:
            return None
        n = int(m.group(0).replace(",", ""))
    else:
        return None
    if n < 80:
        return None
    ceil = SQFT_CEIL.get(beds, 5000) if beds is not None else 2500
    return n if n <= ceil else None


fixed = dropped = 0
for a in apts:
    before = a.get("sqft")
    a["sqft"] = unit_sqft(before, a.get("beds"))
    if isinstance(before, str) and a["sqft"] is not None:
        fixed += 1
    elif before is not None and a["sqft"] is None:
        dropped += 1
print(f"\nsqft parsed from text: {fixed}   implausible values dropped: {dropped}")

# ---------- 4. a private room is not an apartment ----------
# Craigslist room shares arrive labelled as whole units at a fraction of market
# rent, and a scoring engine that rewards low cost puts them straight on top.
#
# Four passes of keyword matching kept finding more ("private room", then "room
# in a 3BR", then "Room -7- for Rent", then "rooms available"), which is the
# signal that text was the wrong instrument. The reliable test is arithmetic: a
# whole apartment cannot rent for a third of what its size goes for on its own
# block. Keywords are kept, but only to confirm what the price already says.
ROOM_WORDS = re.compile(
    r"\b(private\s+(bed)?room|bedroom\s+for\s+rent|roommate|shared\s+(room|apartment"
    r"|house|living|kitchen|bath)|co-?living|sleeping\s+pod|furnished\s+room"
    r"|single\s+room|master\s+bedroom|rooms?\s+available)\b"
    r"|\broom\s+in\s+(a|an|the|my|our)?\s*[\w\s\-,']{0,28}?"
    r"\b(\d\s?b\.?r\.?|bed(room)?s?|apartment|appartment|apt|flat|house|home|condo|unit)\b"
    r"|\broom\b[\s\-–#\w]{0,12}\bfor\s+rent\b"
    # SRO is a room by definition, and Craigslist SF is bilingual
    # an adjective in front of "room" is how these are almost always written;
    # "living room" and "dining room" are deliberately not in this list
    r"|\b(large|spacious|sunny|cozy|cosy|nice|clean|big|bright|huge)\s+room\b"
    r"|\bs\.?r\.?o\.?\b|\bsingle\s+room\s+occupancy\b"
    r"|\bse\s+renta\s+cuarto\b|\bcuarto\b|\bhabitaci[oó]n\b|\brecamara\b"
    r"|\bno\s+kitchen\b|\bwithout\s+(a\s+)?kitchen\b", re.I)

MIN_SAMPLE = 8          # below this a neighbourhood median is noise
FLOOR = 0.55            # under 55% of local going rate is not a whole home
RATIO_CAP = 2800        # above this the ratio test stops applying: a $6,700 three-bed
                        # is obviously a whole home even where the median is higher
ABS_FLOOR = 1250        # nothing self-contained rents for less than this in SF


def median(xs):
    v = sorted(xs)
    return v[len(v) // 2] if v else None


def build_market(pool):
    """Median rent by (neighbourhood, beds), falling back to beds citywide."""
    hood, city = collections.defaultdict(list), collections.defaultdict(list)
    for a in pool:
        city[a.get("beds")].append(a["rent"])
        if a.get("hood"):
            hood[(a["hood"], a.get("beds"))].append(a["rent"])
    return ({k: median(v) for k, v in hood.items() if len(v) >= MIN_SAMPLE},
            {k: median(v) for k, v in city.items() if len(v) >= MIN_SAMPLE})


def going_rate(a, hood_med, city_med):
    return (hood_med.get((a.get("hood"), a.get("beds")))
            or city_med.get(a.get("beds"))
            or city_med.get(None))


# The rooms sit inside the very sample used to detect them, dragging the median
# down and hiding themselves. Re-derive the market from what survives, twice.
pool = list(apts)
for _ in range(3):
    hood_med, city_med = build_market(pool)
    keep = []
    for a in apts:
        rate = going_rate(a, hood_med, city_med)
        if not rate or a["rent"] >= FLOOR * rate:
            keep.append(a)
    if len(keep) == len(pool):
        break
    pool = keep

hood_med, city_med = build_market(pool)
shared = 0
for a in apts:
    rate = going_rate(a, hood_med, city_med)
    ratio = (a["rent"] / rate) if rate else None
    words = bool(ROOM_WORDS.search(a.get("name") or ""))
    # The ratio catches the middle of the market; an absolute floor catches the
    # bottom, where a handful of cheap rooms can drag the local median with them.
    by_price = (ratio is not None and ratio < FLOOR and a["rent"] < RATIO_CAP) \
               or a["rent"] < ABS_FLOOR
    a["shared"] = bool(by_price or words)
    if by_price and words:
        a["shared_why"] = (f"{money_pct(ratio)} of the going rate for {bedTxt_py(a)} in "
                           f"{a.get('hood') or 'SF'}, and the listing calls it a room")
    elif by_price:
        a["shared_why"] = (f"{money_pct(ratio)} of the going rate for {bedTxt_py(a)} in "
                           f"{a.get('hood') or 'SF'}")
    elif words:
        a["shared_why"] = "the listing describes a room rather than a whole home"
    else:
        a["shared_why"] = None
    a["mkt_ratio"] = round(ratio, 2) if ratio else None
    shared += a["shared"]

both = sum(1 for a in apts if a["shared"] and a["mkt_ratio"] and a["mkt_ratio"] < FLOOR
           and ROOM_WORDS.search(a.get("name") or ""))
price_only = sum(1 for a in apts if a["shared"] and a["mkt_ratio"] and a["mkt_ratio"] < FLOOR
                 and not ROOM_WORDS.search(a.get("name") or ""))
word_only = sum(1 for a in apts if a["shared"] and not (a["mkt_ratio"] and a["mkt_ratio"] < FLOOR))
print(f"\nflagged as a room or shared unit: {shared}")
print(f"   price and wording agree:      {both}")
print(f"   caught by price alone:        {price_only}   <- what keywords kept missing")
print(f"   caught by wording alone:      {word_only}")

atomicjson.dump(apts, "app_data.json")

n = sum(1 for a in apts if a["rating"])
thin = sum(1 for a in apts if a["rating"] and a["rating_n"] < 10)
print(f"\nlistings with a real rating: {n:,} of {len(apts):,}")
print(f"  of those, fewer than 10 reviews: {thin:,}  (shown as thin evidence)")
