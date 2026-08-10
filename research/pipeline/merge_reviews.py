"""Fold Google ratings into the payload, with the honest caveats attached.

A star average alone repeats what the listing sites already show. What matters is
how many reviews describe living there rather than touring, and what the negative
ones keep coming back to.
"""
import collections, json, re

places = json.load(open("google_places.json"))
apts = json.load(open("app_data.json"))


def norm(s):
    s = re.sub(r"[,#].*$", "", (s or "")).strip().lower()
    m = re.match(r"^(\d+)\s+([a-z0-9']+)", re.sub(r"\s+", " ", s))
    return f"{m.group(1)} {m.group(2)}" if m else None


LIVING = re.compile(
    r"\b(lived|living|been here|resident|my unit|my apartment|neighbo|years? here|"
    r"maintenance|elevator|noise|pest|rodent|mold|repair|broken|hot water|heater|"
    r"move[d]? out|deposit|management)\b", re.I)
TOURY = re.compile(
    r"\b(tour(ed|ing)?|leasing|applicat|move[- ]?in process|showed (me|us)|"
    r"signing|answered (all )?my questions|helped me (find|choose))\b", re.I)
THEMES = [
    ("Maintenance", r"\b(maintenance|work order|repair|fix(ed|ing)?|broken|leak|mold|hot water)\b"),
    ("Management", r"\b(management|manager|office staff|unresponsive|never respond|ignore)\b"),
    ("Noise", r"\b(noise|noisy|loud|thin walls|hear (my|the) neighbo)\b"),
    ("Pests", r"\b(roach|rodent|mice|mouse|rats?|bed ?bugs?|pest)\b"),
    ("Elevator", r"\belevator"),
    ("Security", r"\b(unsafe|security|break[- ]?in|stolen|package theft)\b"),
    ("Fees", r"\b(fee|deposit|rent increase|raised (my|the) rent|charged)\b"),
]

by_addr = {}
for p in places:
    k = norm(p.get("address") or p.get("title"))
    if not k or not p.get("totalScore"):
        continue
    revs = [r for r in (p.get("reviews") or []) if (r.get("text") or "").strip()]
    living = [r for r in revs if LIVING.search(r["text"]) and not TOURY.search(r["text"])]
    neg = [r for r in revs if (r.get("stars") or 5) <= 2]
    themes = []
    for label, pat in THEMES:
        rx = re.compile(pat, re.I)
        hits = [r for r in revs if rx.search(r["text"])]
        nn = [r for r in hits if (r.get("stars") or 5) <= 2]
        if hits:
            themes.append({"t": label, "n": len(hits), "neg": len(nn)})
    themes.sort(key=lambda x: (-x["neg"], -x["n"]))
    quote = None
    for r in neg:
        t = re.sub(r"\s+", " ", r["text"]).strip()
        if 40 < len(t):
            quote = {"q": t[:170] + ("…" if len(t) > 170 else ""),
                     "s": r.get("stars"), "d": (r.get("publishedAtDate") or "")[:10]}
            break
    prev = by_addr.get(k)
    rec = {"score": round(p["totalScore"], 2), "n": p.get("reviewsCount") or len(revs),
           "sampled": len(revs), "living": len(living), "neg": len(neg),
           "themes": themes[:5], "quote": quote, "name": p.get("title")}
    if not prev or rec["n"] > prev["n"]:
        by_addr[k] = rec

added = kept = 0
for a in apts:
    k = norm(a["addr"])
    g = by_addr.get(k) if k else None
    if g:
        a["greview"] = g
        if not a.get("rating"):
            a["rating"] = g["score"]
            added += 1
        else:
            kept += 1
json.dump(apts, open("app_data.json", "w"), separators=(",", ":"))

tot = sum(1 for a in apts if a.get("rating"))
print(f"places with a rating:      {len(by_addr):,} addresses")
print(f"listings gaining a rating: {added:,}")
print(f"listings now rated:        {tot:,} of {len(apts):,} ({tot/len(apts)*100:.0f}%)")
deep = [a for a in apts if a.get("greview") and a["greview"]["n"] >= 20]
print(f"with 20+ reviews:          {len(deep):,}")
if deep:
    ex = max(deep, key=lambda a: a["greview"]["n"])
    g = ex["greview"]
    print(f"\ndeepest: {ex['addr']} — {g['score']}★ from {g['n']:,} reviews")
    print(f"  of {g['sampled']} sampled, {g['living']} describe living there, {g['neg']} negative")
    print(f"  themes: {[(t['t'],t['n'],t['neg']) for t in g['themes']]}")
    if g["quote"]: print(f"  quote: [{g['quote']['s']}★] {g['quote']['q'][:110]}")
