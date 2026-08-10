"""Craigslist pet policy, taken from the filter rather than the posting body.

The search API exposes `pets_dog` and `pets_cat` as filters, which is far more
reliable than reading "dogs ok" out of free text. Ask for the dog-friendly set,
ask for the cat-friendly set, ask for everything, and the answer for any one
posting is set membership.

Read the negative carefully. A posting that shows up in the unfiltered sweep but
not in the dog sweep did not tick a box the form put in front of the poster --
which is weaker than "no dogs" and stronger than silence. It is recorded as
`False` with `stated: False` so nothing downstream mistakes it for a landlord
saying no. About two thirds of postings tick at least one, so the field is well
used enough for the absence to mean something, and not well used enough to
justify hiding a listing over it.

Same bisect-on-price trick as craigslist_api.py: the API caps a response at 360
items but reports the true total, so any band over the cap gets split.
"""
import json, sys, time, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
BASE = "https://sapi.craigslist.org/web/v8/postings/search/full"
CAP = 360
PATHS = ["sfc/apa", "sfc/roo"]


FAILED = []            # bands that never returned, or came back capped


def call(path, lo, hi, **extra):
    p = {"batch": "1-0-360-0-0", "cc": "US", "lang": "en", "searchPath": path,
         "min_price": lo, "max_price": hi}
    p.update(extra)
    req = urllib.request.Request(BASE + "?" + urllib.parse.urlencode(p), headers={
        "User-Agent": UA, "Accept": "application/json",
        "Referer": "https://sfbay.craigslist.org/"})
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as h:
                return json.load(h)["data"]
        except Exception as e:
            if a == 3:
                print(f"   fail {lo}-{hi}: {e}", file=sys.stderr)
                FAILED.append(f"{path} ${lo}-{hi} {extra}: {e}")
                return None
            time.sleep(2 * (a + 1))


def ids(data):
    """Posting ids only -- the pet sweeps don't need any other field."""
    dec = data.get("decode") if isinstance(data.get("decode"), dict) else {}
    minid = dec.get("minPostingId") or 0
    return {str(minid + (it[0] or 0)) for it in data.get("items", []) if len(it) >= 5}


def harvest(path, lo, hi, depth=0, seen=None, **extra):
    seen = seen if seen is not None else set()
    d = call(path, lo, hi, **extra)
    if not d:
        return seen
    total = d.get("totalResultCount") or 0
    if total > CAP and depth < 9 and (hi - lo) > 25:
        mid = (lo + hi) // 2
        harvest(path, lo, mid, depth + 1, seen, **extra)
        harvest(path, mid, hi, depth + 1, seen, **extra)
        return seen
    if total > CAP:
        # Bottomed out still over the cap: we are keeping the first 360 of a
        # larger band and would silently record the remainder as "no pets".
        FAILED.append(f"{path} ${lo}-{hi} {extra}: {total} results, capped at {CAP}")
    seen |= ids(d)
    time.sleep(0.8)
    return seen


def sweep(label, **extra):
    out = set()
    for path in PATHS:
        harvest(path, 0, 30000, 0, out, **extra)
    print(f"  {label:<16} {len(out):,} postings", flush=True)
    return out


if __name__ == "__main__":
    print("sweeping craigslist...", flush=True)
    allp = sweep("all")
    dogs = sweep("dogs ok", pets_dog=1)
    cats = sweep("cats ok", pets_cat=1)
    # A pet sweep can surface a posting the unfiltered sweep missed between
    # requests; union them so membership is never tested against a stale universe.
    allp |= dogs | cats

    # A band that failed during the dogs sweep but succeeded in the all sweep
    # puts every posting in it into `universe` and none into `dogs`, which
    # merge_pets.py writes as ok=False and petGate() then docks 25% for. A
    # transient 503 must not become "this landlord won't take pets", so a partial
    # sweep is thrown away rather than published.
    if FAILED:
        print("\nIncomplete sweep -- refusing to write, because the gaps would be\n"
              "indistinguishable from postings that declined to allow pets:", file=sys.stderr)
        for f in FAILED:
            print("  " + f, file=sys.stderr)
        sys.exit(1)

    json.dump({"all": sorted(allp), "dogs": sorted(dogs), "cats": sorted(cats)},
              open("craigslist_pets.json", "w"))
    print(f"\nuniverse {len(allp):,}  dogs {len(dogs):,} ({len(dogs)/len(allp)*100:.0f}%)"
          f"  cats {len(cats):,} ({len(cats)/len(allp)*100:.0f}%)"
          f"  neither {len(allp - dogs - cats):,}")
