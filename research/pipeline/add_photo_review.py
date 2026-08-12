#!/usr/bin/env python3
"""Look at the photographs, because the advert will not tell you.

add_qualities.py reads what the listing *says* -- two floors, a view, good
light -- and it can only report what somebody chose to write down. Half the
adverts in this data set say nothing about light at all, and a Craigslist post
with four photographs and one line of text is not a flat with no character, it
is a flat nobody described.

The pictures are already there. Every listing here carries up to five, and they
answer the question the prose skips: is the light any good, is that a view or a
lightwell, has the kitchen been touched since 1997, is the "private patio" a
strip of concrete by the bins.

WHAT THIS DOES NOT DO. It does not rate the flat's beauty and hand back a
number to rank on. Beauty is the reader's call and a model's opinion of it is
not evidence. This reports observable things -- how much daylight reaches the
room, whether a window looks at sky or at a wall, whether the finishes are new
or tired -- and each one comes back with the photo index it came from, so the
reader can look at the same picture and disagree. Same rule as the quoted
sentence in add_qualities.py, for the same reason.

COST. The full sweep is about fifty cents, which is a tenth of what the Zillow
descriptions cost. Three things keep it there:

  a cheap model    gemini-2.5-flash-lite, $0.10 per million input tokens. The
                   judgments here are gross -- bright or dim, new or tired --
                   and do not need a frontier model's reasoning.
  small images     Gemini bills 258 tokens for an image inside 384x384 and
                   tiles anything larger. A 596x446 Craigslist photo tiles to
                   six, so downscaling first is a straight 6x saving and costs
                   nothing that matters: you do not need 984 pixels to see that
                   a room is dark.
  one call a flat  all five photos in a single request, so the model compares
                   them and the prompt is paid for once.

Set GEMINI_API_KEY in .env. Every answer is cached to disk against a hash of
the photo set, so a rerun costs nothing for what it already has, and photos
changing invalidates just that listing.

    uv run --with pillow --with google-genai python add_photo_review.py --dry
    uv run --with pillow --with google-genai python add_photo_review.py --limit 25
    uv run --with pillow --with google-genai python add_photo_review.py
"""
import hashlib
import io
import json
import os
import pathlib
import random
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import atomicjson

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "app_data.json"
CACHE = HERE / "photo_review.json"

MODEL = os.environ.get("CASITA_PHOTO_MODEL", "gemini-3.1-flash-lite")
WORKERS = int(os.environ.get("CASITA_PHOTO_WORKERS", "32"))
# Eight rather than five. Redfin publishes a median of 19 photographs and
# Craigslist posters often shoot every room, so five was frequently the living
# room from four angles and the front door -- and the questions here are about
# rooms this listing never showed. Also gives the not-the-flat filter more to
# work with, since a floor plan and a logo can easily be two of five.
MAX_PHOTOS = 8
# Two independent levers on image cost, and both are set as low as the job can
# stand, because the job is not a demanding one.
#
#   BOX          Gemini 2.x billed a flat 258 tokens inside 384x384 and tiled
#                anything larger. The 3.x models price by media_resolution
#                instead, but the downscale still earns its place: these
#                arrive at 596x446 and 984x656, and shrinking before upload
#                turns 13,545 downloads into a fraction of the bandwidth.
#   RESOLUTION   3.x bills roughly 280 tokens an image at "low" against 1,120
#                at the default. Four times the price to tell a bright room
#                from a dim one is not worth paying.
BOX = 384
RESOLUTION = "MEDIA_RESOLUTION_LOW"
PER_IMAGE_TOKENS = 280
USD_PER_M_IN, USD_PER_M_OUT = 0.25, 1.50
PROMPT_TOKENS, REPLY_TOKENS = 210, 130

# Apartments.com's CDN refuses anything that does not look like a browser
# loading an <img>, and returns 403 to a bare urllib request. Zillow and
# Craigslist do not care, but one header set for all three is simpler than
# three.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
IMG_HEADERS = {
    "User-Agent": UA,
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.apartments.com/",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "same-site",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}

SYSTEM = """You are looking at photographs from a San Francisco rental advert.

Report only what is visible. You are not rating the flat and you are not
guessing at anything off-camera: if the photos do not show it, the answer is
null. A listing that only photographed the kitchen has not told you about its
light, and saying so is more useful than a confident average.

For every judgement you do make, give the 0-based index of the photo you made
it from, so a reader can check you.

Ignore floor plans, maps, logos, exterior shots of other buildings, and
photographs of people - those are marketing, not the flat. Note them in
`not_the_unit` instead.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "light": {"type": "string", "nullable": True,
                  "enum": ["bright", "average", "dim"],
                  "description": "How much daylight reaches the living space. "
                                 "null if no room with a window is shown."},
        "light_photo": {"type": "integer", "nullable": True},
        "view": {"type": "string", "nullable": True,
                 "enum": ["open", "ordinary", "blocked"],
                 "description": "What the windows face. 'open' = sky, water, "
                                "hills, a long street. 'blocked' = a wall, a "
                                "lightwell, a neighbour a few feet away. null "
                                "if no window view is visible."},
        "view_photo": {"type": "integer", "nullable": True},
        "condition": {"type": "string", "nullable": True,
                      "enum": ["renovated", "maintained", "tired"],
                      "description": "Kitchens and bathrooms give this away "
                                     "fastest. 'tired' = worn fittings, dated "
                                     "units, visible damage."},
        "condition_photo": {"type": "integer", "nullable": True},
        "outdoor": {"type": "string", "nullable": True,
                    "enum": ["private", "shared", "none"],
                    "description": "Only if outdoor space is actually pictured."},
        "two_level": {"type": "boolean",
                      "description": "True only if a staircase inside the flat "
                                     "is visible, or a loft/mezzanine level."},
        "notable": {"type": "array", "items": {"type": "string"},
                    "description": "Up to three short, concrete, checkable "
                                   "things a renter would want to know and the "
                                   "advert probably omits. 'Bedroom window "
                                   "faces a blank wall'. 'Kitchen has no "
                                   "counter space'. Not adjectives."},
        "not_the_unit": {"type": "array", "items": {"type": "integer"},
                         "description": "Indices of photos that are floor "
                                        "plans, maps, logos, people, or a "
                                        "different building."},
        "best_photo": {"type": "integer", "nullable": True,
                       "description": "Index of the photo that best shows what "
                                      "living here is like. Prefer a main room "
                                      "over a bathroom or a close-up."},
    },
    "required": ["light", "view", "condition", "outdoor", "two_level",
                 "notable", "not_the_unit", "best_photo"],
}


def load_key():
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        if os.environ.get(name):
            return os.environ[name]
    env = HERE.parent.parent / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        for name in ("GEMINI_API_KEY=", "GOOGLE_API_KEY="):
            if line.startswith(name):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    sys.exit("no GEMINI_API_KEY in the environment or .env  "
             "(https://aistudio.google.com/apikey)")


def shrink(raw):
    """Down to something Gemini bills as one tile, as a JPEG.

    Returns None for anything that is not a decodable image, which is a real
    outcome here -- a few of these URLs are dead or serve an HTML error page
    with an image content-type.
    """
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im = im.convert("RGB")
    im.thumbnail((BOX, BOX), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=82)
    return out.getvalue()


def fetch(url):
    try:
        req = urllib.request.Request(url, headers=IMG_HEADERS)
        with urllib.request.urlopen(req, timeout=20) as h:
            return shrink(h.read())
    except Exception:
        return None


def targets(data, cache):
    """Listings worth spending on: photos we have, an answer we do not.

    Keyed on a hash of the photo list rather than the listing id, so a building
    that swapped its pictures gets looked at again and one that did not is
    free.
    """
    out = []
    for a in data:
        photos = (a.get("photos") or [])[:MAX_PHOTOS]
        if not photos:
            continue
        h = hashlib.md5("|".join(photos).encode()).hexdigest()[:16]
        if cache.get(a["id"], {}).get("h") == h:
            continue
        out.append((a["id"], h, photos))
    return out


def review(client, gtypes, photos, pool):
    # The downloads for one flat are independent and each is a round trip to a
    # CDN, so doing them in sequence spent most of the wall clock waiting. They
    # share the outer pool's budget via `pool` rather than each worker spawning
    # its own, which would multiply the thread count by MAX_PHOTOS.
    blobs = list(pool.map(fetch, photos))
    # Which originals survived the download, in order. The model is shown a
    # dense list and answers in its own indices, so without this a single dead
    # image silently shifts every answer after it: photo 3 fails, photo 4 is
    # shown as index 3, and "index 3 is a floor plan" then deletes photo 3 from
    # the gallery instead of photo 4. Nothing about that failure is visible --
    # the shape of the reply is still perfectly valid.
    kept = [i for i, b in enumerate(blobs) if b]
    parts = [gtypes.Part.from_bytes(data=blobs[i], mime_type="image/jpeg")
             for i in kept]
    if not parts:
        return None, 0
    parts.append(gtypes.Part.from_text(
        text="Review these photos and return the structured JSON. Photo "
             f"indices are 0 to {len(parts) - 1} in the order given."))
    resp = client.models.generate_content(
        model=MODEL,
        contents=[gtypes.Content(role="user", parts=parts)],
        config=gtypes.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=SCHEMA,
            system_instruction=SYSTEM,
            media_resolution=RESOLUTION,
        ),
    )
    r = json.loads((resp.text or "").strip() or "null")
    return remap(r, kept), len(parts) - 1


def remap(r, kept):
    """Answers come back in the model's indices; put them back in ours."""
    if not r:
        return r
    at = lambda i: kept[i] if isinstance(i, int) and 0 <= i < len(kept) else None
    for k in ("light_photo", "view_photo", "condition_photo", "best_photo"):
        if k in r:
            r[k] = at(r[k])
    r["not_the_unit"] = [j for j in (at(i) for i in (r.get("not_the_unit") or []))
                         if j is not None]
    return r


def main():
    dry = "--dry" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None

    data = json.load(open(DATA))
    try:
        cache = json.loads(CACHE.read_text())
    except Exception:
        cache = {}

    todo = targets(data, cache)
    if limit:
        todo = todo[:limit]

    imgs = sum(len(p) for _, _, p in todo)
    tin = imgs * PER_IMAGE_TOKENS + len(todo) * PROMPT_TOKENS
    cost = tin / 1e6 * USD_PER_M_IN + len(todo) * REPLY_TOKENS / 1e6 * USD_PER_M_OUT
    print(f"  listings needing a photo review: {len(todo):,}  (cached {len(cache):,})")
    print(f"  photographs: {imgs:,} · downscaled to {BOX}px · {MODEL}")
    print(f"  estimated cost: ${cost:,.2f}")
    if dry or not todo:
        return

    key = load_key()
    from google import genai
    from google.genai import types as gtypes
    client = genai.Client(api_key=key)

    done, failed, lock = [0], [0], threading.Lock()
    t0 = time.monotonic()
    # One call per flat and five small downloads inside it, so the job is
    # almost entirely waiting on other people's servers. Threads are close to
    # free here; the ceiling is Gemini's rate limit, not this machine.
    fetchers = ThreadPoolExecutor(max_workers=WORKERS)

    def one(item):
        lid, h, photos = item
        r = n = None
        for attempt in range(4):
            try:
                r, n = review(client, gtypes, photos, fetchers)
                break
            except Exception as e:
                msg = str(e)
                # 429 is the rate limiter, 503 is the model being busy. Both
                # mean "later", not "no", and a sweep this size will meet them.
                if ("429" in msg or "503" in msg or "RESOURCE_EXHAUSTED" in msg) \
                        and attempt < 3:
                    time.sleep(2 ** attempt * 1.5 + random.random())
                    continue
                with lock:
                    failed[0] += 1
                    if failed[0] <= 3:
                        print(f"    ! {type(e).__name__}: {msg[:110]}", flush=True)
                return
        with lock:
            # A listing whose photos all failed to download is not a listing
            # with nothing in its pictures. Leaving it out of the cache means
            # the next run tries again rather than recording the gap as an
            # answer -- the same trap add_descriptions.py fell into.
            if r is not None:
                r["n"] = n
                cache[lid] = {"h": h, "r": r}
            else:
                failed[0] += 1
            done[0] += 1
            if done[0] % 100 == 0 or done[0] == len(todo):
                atomicjson.dump(cache, str(CACHE))
                rate = done[0] / max(0.001, time.monotonic() - t0)
                left = (len(todo) - done[0]) / max(0.01, rate)
                print(f"    {done[0]}/{len(todo)}  reviewed {len(cache):,}  "
                      f"failed {failed[0]}  {rate:.1f}/s  ~{left / 60:.0f} min left",
                      flush=True)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(one, todo))
    fetchers.shutdown(wait=False)
    atomicjson.dump(cache, str(CACHE))
    print(f"  swept in {(time.monotonic() - t0) / 60:.1f} min")

    applied = 0
    for a in data:
        hit = cache.get(a["id"])
        if not hit:
            a.pop("photo_review", None)
            continue
        a["photo_review"] = hit["r"]
        applied += 1
    atomicjson.dump(data, str(DATA))

    seen = [a["photo_review"] for a in data if a.get("photo_review")]
    print(f"\n  photo reviews attached: {applied:,} of {len(data):,}")
    for field in ("light", "view", "condition", "outdoor"):
        tally = {}
        for r in seen:
            tally[r.get(field)] = tally.get(r.get(field), 0) + 1
        pretty = "  ".join(f"{k or 'unknown'} {v:,}" for k, v in
                           sorted(tally.items(), key=lambda x: -x[1]))
        print(f"    {field:11} {pretty}")
    junk = sum(len(r.get("not_the_unit") or []) for r in seen)
    print(f"    photos that were not the flat: {junk:,}")


if __name__ == "__main__":
    main()
