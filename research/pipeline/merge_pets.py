"""Attach Craigslist pet flags to listings, alongside the Apartments.com ones.

Runs after merge_units.py, which writes the Apartments.com policy (the one with
fees attached). The two sources answer different halves of the question and
neither is redundant:

  * Apartments.com knows the money -- pet rent, deposit, how many are allowed --
    but publishes no "not allowed" value, so it can only ever say yes.
  * Craigslist knows the yes/no, because the posting form asks directly, but
    never the price.

Where a listing has both, keep the fees and take the permissive reading of the
flags. Where a Craigslist posting is in the universe we swept but ticked neither
box, that is recorded as `ok: False` -- a form was put in front of the poster and
came back blank. That is weaker than a landlord saying no, so it is a soft signal
on purpose; see petGate() in life.js. A listing with no `pet` key at all is the
third state: never asked.
"""
import json, os, re
import atomicjson

apts = json.load(open("app_data.json"))
if not os.path.exists("craigslist_pets.json"):
    raise SystemExit("craigslist_pets.json missing -- run craigslist_pets.py first")
cp = json.load(open("craigslist_pets.json"))
universe, dogs, cats = set(cp["all"]), set(cp["dogs"]), set(cp["cats"])

PID = re.compile(r"/(\d{8,})\.html")


def cl_pid(a):
    for s in a.get("src") or []:
        if s.get("n") != "Craigslist":
            continue
        m = PID.search(s.get("u") or "")
        if m:
            return m.group(1)
    return None


seen = merged = added = expired = 0
for a in apts:
    pid = cl_pid(a)
    if not pid:
        continue
    seen += 1
    if pid not in universe:
        # Posting has aged out since the sweep; absence here says nothing about
        # pets, so leave whatever Apartments.com had rather than inventing a no.
        expired += 1
        continue
    d, c = pid in dogs, pid in cats
    cur = a.get("pet")
    if cur:
        # `or ... or None` laundered an explicit False into None, turning a
        # recorded "asked and not stated" back into "we never asked".
        if d:
            cur["dogs"] = True
        if c:
            cur["cats"] = True
        cur["ok"] = bool(cur.get("ok") or d or c)
        # Idempotent: re-running used to grow "Apartments.com + Craigslist +
        # Craigslist + ...".
        if "Craigslist" not in (cur.get("src") or ""):
            cur["src"] = (cur.get("src") or "") + " + Craigslist"
        merged += 1
    else:
        a["pet"] = {"ok": bool(d or c), "dogs": d or None, "cats": c or None,
                    "monthly": None, "onetime": None, "max": None, "src": "Craigslist"}
        added += 1

atomicjson.dump(apts, "app_data.json")

have = [a["pet"] for a in apts if a.get("pet")]
print(f"craigslist listings seen:            {seen:,}")
print(f"  matched to the pet sweep:          {seen - expired:,}  (expired since: {expired:,})")
print(f"  new pet records:                   {added:,}")
print(f"  merged into an existing record:    {merged:,}")
print(f"\nlistings with any pet policy:        {len(have):,} of {len(apts):,} "
      f"({len(have)/len(apts)*100:.0f}%)")
print(f"  pets allowed:                      {sum(1 for p in have if p['ok']):,}")
print(f"  asked but not stated:              {sum(1 for p in have if not p['ok']):,}")
print(f"  with a monthly fee attached:       {sum(1 for p in have if p.get('monthly')):,}")
