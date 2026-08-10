"""Fold the Apartments.com detail payload into the listings.

This replaces the hand-rolled browser harvest. That one worked, but it asked
apartments.com for 477 pages at roughly one a second and Akamai blocked the
whole client -- including ordinary browsing. Paying an actor that maintains its
own scraping infrastructure is the honest way to get this: about a tenth of a
cent per property.

What arrives here that the manual version could not get:
  - every review's text, title and date, not just the star distribution
  - the property's sound score
  - the management company

Review text is quoted, never paraphrased, and always with its date. These are
people's own words about a place they lived; summarising them into a verdict
would put words in their mouths, and a 2024 complaint about parking is a
different claim than a 2026 one.
"""
import collections, json, os, re

apts = json.load(open("app_data.json"))
rows = json.load(open("apify_apts.json")) if os.path.exists("apify_apts.json") else []
MANUAL = json.load(open("apts_reviews.json")) if os.path.exists("apts_reviews.json") else {}
print(f"apartments.com properties returned: {len(rows)}")

THEMES = [
    ("Management",  r"\bmanage(ment|r)|staff|office|leasing|landlord"),
    ("Maintenance", r"\bmaintenance|repair|broken|fix(ed|ing)?\b|work order"),
    ("Elevator",    r"\belevator"),
    ("Pests",       r"\broach|cockroach|bed ?bug|rodent|mice|mouse|rat\b|pest"),
    ("Noise",       r"\bnois(e|y)|loud|thin walls"),
    ("Security",    r"\bsecurity|break.?in|stolen|theft|package.*(stolen|taken)|unsafe"),
    ("Cleanliness", r"\bdirty|filth|trash|garbage|smell"),
    ("Fees & rent", r"\bfee\b|fees|deposit|rent increase|utilit"),
    ("Parking",     r"\bparking|garage"),
]
NEG = re.compile(r"\b(no|not|never|avoid|worst|terrible|awful|horrible|poor|bad|"
                 r"rude|ignore[ds]?|refus|broken|filthy|disgusting|stay away|"
                 r"unresponsive|slow|dirty|scam|overpriced)\b", re.I)

by_url = {}
for r in rows:
    u = (r.get("url") or "").split("?")[0]
    if u:
        by_url[u.rstrip("/") + "/"] = r


def digest(r):
    rt = r.get("rating") or {}
    val, cnt = rt.get("value"), rt.get("count")
    if not val or not cnt:
        return None
    revs = [x for x in (r.get("reviews") or []) if (x.get("text") or "").strip()]
    revs.sort(key=lambda x: x.get("date") or "", reverse=True)

    # The actor returns each review's text but not its star count, so the
    # distribution has to come from the pages harvested by hand. Where it is
    # missing the bars are simply not drawn -- better than inventing a shape.
    key = (r.get("url") or "").replace("https://www.apartments.com/", "")
    dist = {str(k): c for k, c in (MANUAL.get(key, {}).get("d") or [])}

    themes = []
    for name, pat in THEMES:
        hits = [x for x in revs if re.search(pat, x.get("text") or "", re.I)]
        if hits:
            neg = sum(1 for x in hits if NEG.search(x.get("text") or ""))
            themes.append({"t": name, "n": len(hits), "neg": neg})
    themes.sort(key=lambda t: (-t["neg"], -t["n"]))

    # keep a couple of quotes, most recent first, trimmed to a sentence or two
    def trim(t):
        t = re.sub(r"\s+", " ", t).strip()
        return t if len(t) <= 240 else t[:237].rsplit(" ", 1)[0] + "…"
    quotes = [{"t": trim(x["text"]), "d": (x.get("date") or "")[:10],
               "h": (x.get("title") or "")[:80]} for x in revs[:3]]

    sc = r.get("scores") if isinstance(r.get("scores"), dict) else {}
    num = lambda k: sc.get(k) if isinstance(sc.get(k), (int, float)) else None

    return {"score": round(float(val), 1), "n": int(cnt), "dist": dist,
            "themes": themes[:5], "quotes": quotes, "nrev": len(revs),
            "sound": num("soundScore"), "soundLabel": sc.get("soundScoreLabel"),
            "walk": num("walkScore"), "transit": num("transitScore"),
            "mgmt": r.get("managementCompany") or None, "url": r.get("url")}


direct = 0
for a in apts:
    for s in a["src"]:
        if s["n"] != "Apartments.com":
            continue
        r = by_url.get(s["u"].rstrip("/") + "/")
        d = digest(r) if r else None
        if not d:
            continue
        tot = sum(d["dist"].values())
        d["split"] = bool(tot >= 6 and (d["dist"].get("5", 0) + d["dist"].get("1", 0)) / tot >= 0.6
                          and d["dist"].get("5", 0) >= 2 and d["dist"].get("1", 0) >= 2)
        a["areview"] = d
        direct += 1
print(f"listings given renter reviews directly: {direct}")

# ---------- carry building-level reviews to every listing at that parcel ----------
best = {}
for a in apts:
    if not a.get("parcel_ok"):
        continue
    pid = a["id"].split("|")[0]
    for key in ("areview", "greview"):
        v = a.get(key)
        if not v or v.get("inherited"):
            continue
        n = v.get("n") or 0
        if n > (best.get((pid, key), {}).get("n") or 0):
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

# ---------- what the card shows ----------
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
    # Only call it a disagreement when both sides have enough reviews to be one.
    # Three angry renters against 800 Google ratings is a sample-size artefact,
    # and dressing it up as "the two populations differ" would be the same
    # mistake as the flat 5/5 stars this replaced.
    if (ar and g_ok and ar["n"] >= 5 and gr["n"] >= 5
            and abs(ar["score"] - gr["score"]) >= 1.0):
        a["rating_gap"] = {"renters": ar["score"], "rn": ar["n"],
                           "google": gr["score"], "gn": gr["n"]}

json.dump(apts, open("app_data.json", "w"), separators=(",", ":"))

rated = [a for a in apts if a["rating"]]
print(f"\nlistings with a rating: {len(rated):,} of {len(apts):,}"
      f"   {dict(collections.Counter(a['rating_src'] for a in rated))}")
print(f"  with quotable review text: {sum(1 for a in apts if (a.get('areview') or {}).get('quotes')):,}")
print(f"  with a sound score:        {sum(1 for a in apts if (a.get('areview') or {}).get('sound')):,}")
print(f"  split verdict:             {sum(1 for a in apts if (a.get('areview') or {}).get('split')):,}")
print(f"  renters vs Google differ by 1.0+: {sum(1 for a in apts if a.get('rating_gap')):,}")
