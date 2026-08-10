#!/usr/bin/env python3
"""Ask Zillow whether its listings are still available.

Zillow's search feed reports `statusType: FOR_RENT` on every row it returns --
a constant, not a status -- so a third of the inventory has been carrying
"availability unchecked" since the beginning. That was honest but useless: it
is the single most expensive thing a renter can get wrong, and "we don't know"
is a floor, not a ceiling.

The listing pages themselves do carry it. A building page's own <title> ends in
"(N units available)", and the embedded __NEXT_DATA__ blob has the same figure
alongside per-unit detail. Nothing exotic is needed to read it: a plain request
with a browser user-agent returns the real page most of the time. The catch is
rate: hammering it earns a 403 within a handful of requests.

So this is built around patience rather than cleverness.

  · Every answer is cached to disk forever. A rerun costs nothing for pages
    already fetched, which matters because a full sweep takes the better part
    of an hour and will be interrupted.
  · Requests are paced with jitter and back off hard on a 403, which is a
    "slow down", not a "go away" -- the same URL succeeds minutes later.
  · A page that cannot be read after retries is recorded as unknown rather
    than guessed. The whole point of this file is to replace a guess.

Falls back to the project's Playwright context (src/casita/browser.py, which
keeps a persistent profile so a solved captcha sticks) only if plain requests
stop working entirely.

Zillow blocks by URL class, not by rate. Measured over a clean sample, with
seconds of spacing between requests:

    /apartments/<building>/    200 on every attempt   279 pages
    /homedetails/<address>/    403 on every attempt   490 pages

That is worth stating plainly because the first version of this file assumed
the opposite. It treated every 403 as "slow down" and climbed a backoff ladder
into it, so a 25-page sample ran for nineteen minutes without finishing ten --
and it would never have finished, because no amount of waiting turns a
homedetails 403 into a 200. Backing off from a wall just means hitting it
later.

So the two classes are fetched two different ways:

  · Building pages go over plain HTTP, paced. Cheap, and it works.
  · Single-home pages go through the project's Playwright context
    (src/casita/browser.py), which keeps a persistent profile so a captcha
    solved once sticks. Slower and heavier, and reserved for the half of the
    inventory that genuinely needs it.

    python3 add_zillow_avail.py            both phases, every listing
    python3 add_zillow_avail.py --plain    building pages only (fast)
    python3 add_zillow_avail.py --browser  single-home pages only
    python3 add_zillow_avail.py --limit 40 cap the work (for testing)
"""
import json
import pathlib
import random
import re
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / "zillow_avail.json"
DATA = HERE / "app_data.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}

UNITS_RE = re.compile(r"\((\d+)\s+units?\s+available\)", re.I)

# ---------------------------------------------------------------------------
# The units table, which is the only part of a building page that tells the
# truth about a specific unit.
#
# 1350 Washington St is the case that proved the title cannot be trusted. Its
# <title> read "(1 units available)". Its units table read, in full:
#
#     22 | Currently unavailable | 1 bd, 1 ba | 550 sqft | $3,195+
#
# One unit, and it is not for rent. The title is a marketing count that Zillow
# does not keep in step with the table underneath it, and this file was
# reporting "Verified live" off the strength of it.
#
# Worse, the listing being checked was #2F -- a unit that does not appear on
# that page at all. A count of available units in a *building* says nothing
# about whether the *unit* we are advertising is one of them, and conflating
# the two turned a building-level fact into a unit-level promise.
#
# Both signals are in the static HTML, so neither needed a browser. They just
# needed reading.
# One row per unit. The bed/bath cell is the only field every row has, and a
# studio writes it "Studio, 1 ba" rather than "0 bd, 1 ba" -- matching only the
# numeric form found zero rows on every studio building in the city and quietly
# handed the decision back to the title this exists to distrust.
UNIT_ROW_RE = re.compile(r"(?:studio|\d+\s*bd)\s*,\s*\d+(?:\.\d+)?\s*ba", re.I)
UNAVAIL_TAG_RE = re.compile(r"Currently unavailable", re.I)
# The label column takes two shapes: an explicit "Unit 103", or a floor-plan
# name like "Studio floor plan" for buildings that advertise plans rather than
# specific apartments. The second is worth keeping precisely because it tells
# you no specific unit was named.
UNIT_LABEL_RE = re.compile(r"Unit\s+([0-9]{1,5}[A-Za-z]?)\b", re.I)
TAGS_RE = re.compile(r"<[^>]+>")


def _units_table(html):
    """Row count, unavailable-count and unit labels from 'Available units'.

    Returns (rows, unavailable, labels). Regex rather than a DOM parse because
    this module deliberately has no HTML-parser dependency; the markers it
    needs are unambiguous enough to find without one.
    """
    i = html.find("Available units")
    if i < 0:
        return 0, 0, []
    # The table sits near the top of the section; 60k of markup covers a
    # building with dozens of units without running into the reviews below.
    seg = html[i:i + 60000]
    text = re.sub(r"\s+", " ", TAGS_RE.sub(" ", seg))
    rows = len(UNIT_ROW_RE.findall(text))
    unavail = len(UNAVAIL_TAG_RE.findall(text))
    labels = UNIT_LABEL_RE.findall(text)
    return rows, unavail, labels[:40]


GONE_RE = re.compile(r"no longer available|off market|is not available|"
                     r"page not found|has been removed", re.I)
# The wall itself, not the bot-detection vendor. Zillow ships a
# `<script id="scripts.perimeterX">` tag on every page it serves, including
# perfectly good ones, so matching the vendor name marks every success as a
# block -- which is exactly what the first version of this did. Match only
# markup that appears when the wall is actually up.
BLOCKED_RE = re.compile(
    r"px-captcha|Press &amp;? ?Hold|Access to this page has been denied", re.I)


def load_cache():
    try:
        return json.loads(CACHE.read_text())
    except Exception:
        return {}


def save_cache(c):
    CACHE.write_text(json.dumps(c, separators=(",", ":")))


def interpret(html):
    """Read availability out of a fetched page.

    Returns (state, units, note, unit_labels). The labels let the caller check
    that the unit we are advertising is one of the ones the page actually
    lists -- a building with a vacancy is not the same as *our* unit being it.
    """
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()

    # The table first, because it is the thing that is actually true. Only if
    # there is no table does the title's count get a say, and even then it is
    # reported as a building-level claim rather than a unit-level one.
    rows, unavail, labels = _units_table(html)
    if rows:
        free = rows - unavail
        if free <= 0:
            return ("gone", 0,
                    f"Every unit on the building page reads "
                    f"'Currently unavailable' ({rows} listed)", labels)
        return ("live", free,
                f"{free} of {rows} unit(s) on the building page are available",
                labels)

    um = UNITS_RE.search(title)
    if um:
        n = int(um.group(1))
        # No table to corroborate it, so this stays the weaker claim it is.
        return (("live" if n else "gone"), n,
                f"Zillow's page title claims {n} unit(s) available "
                f"(no unit table found)", [])

    if BLOCKED_RE.search(html):
        return "blocked", None, "Bot wall", []

    # Single-home pages do not carry a unit count; they say so in prose.
    if GONE_RE.search(title) or GONE_RE.search(html[:200000]):
        return "gone", 0, "Zillow says this is no longer available", []
    if "__NEXT_DATA__" in html:
        # A real page that simply does not publish a count. Present is not
        # the same as available, so this stays a weaker claim.
        return "listed", None, "Listing page is live but publishes no unit count", []
    return "unknown", None, "Page did not look like a listing", []


def read(url, tries=2):
    """Fetch one page over plain HTTP.

    Retries only what retrying can fix -- timeouts and transport errors. A 403
    here is a wall, not a queue, so it returns immediately and lets the caller
    decide whether to spend a browser on it.
    """
    for i in range(tries):
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(url, headers=HEADERS), timeout=35) as h:
                html = h.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return "gone", 0, f"Zillow returned {e.code}", []
            if e.code in (403, 429):
                return "blocked", None, f"HTTP {e.code}", []
            return "unknown", None, f"HTTP {e.code}", []
        except Exception:
            time.sleep(4 * (i + 1))
            continue
        return interpret(html)

    return "unknown", None, "Could not be fetched"


def sweep_plain(todo, cache):
    for i, u in enumerate(todo, 1):
        state, units, note, labels = read(u)
        cache[u] = {"state": state, "units": units, "note": note,
                    "units_listed": labels, "via": "http", "t": int(time.time())}
        if i % 10 == 0 or i == len(todo):
            save_cache(cache)
            print(f"  http {i}/{len(todo)}  {state:<8} {note[:52]}", flush=True)
        time.sleep(random.uniform(3.0, 5.5))
    save_cache(cache)


def sweep_browser(todo, cache):
    """Drive the shared Playwright profile at the pages plain HTTP cannot reach.

    Imported lazily: the plain phase is the common case and must not require
    Playwright to be installed to run.
    """
    import asyncio
    sys.path.insert(0, str(HERE.parent.parent / "src"))
    from casita.browser import context           # noqa: E402

    async def go():
        async with context(headless=False) as ctx:
            page = await ctx.new_page()
            for i, u in enumerate(todo, 1):
                try:
                    await page.goto(u, wait_until="domcontentloaded", timeout=45000)
                    await page.wait_for_timeout(random.randint(1200, 2600))
                    html = await page.content()
                    state, units, note, labels = interpret(html)
                except Exception as e:
                    state, units, note, labels = ("unknown", None,
                        f"browser: {type(e).__name__}", [])
                # A wall here means the profile needs a human to clear the
                # captcha once. Say so and stop rather than grinding through
                # 490 pages recording the same non-answer.
                if state == "blocked":
                    print("\n  blocked in-browser. Open the window, clear the "
                          "captcha, then rerun --browser to resume.", flush=True)
                    save_cache(cache)
                    return
                cache[u] = {"state": state, "units": units, "note": note,
                            "units_listed": labels, "via": "browser",
                            "t": int(time.time())}
                if i % 5 == 0 or i == len(todo):
                    save_cache(cache)
                    print(f"  browser {i}/{len(todo)}  {state:<8} {note[:48]}", flush=True)
                await page.wait_for_timeout(random.randint(1500, 3500))
            save_cache(cache)

    asyncio.run(go())


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    only_plain = "--plain" in sys.argv
    only_browser = "--browser" in sys.argv

    data = json.load(open(DATA))
    cache = load_cache()

    targets = []
    for a in data:
        src = (a.get("src") or [{}])[0]
        if src.get("n") != "Zillow" or not src.get("u"):
            continue
        targets.append((a, src["u"]))

    urls = list(dict.fromkeys(u for _a, u in targets))
    # Split on the measured wall, not on a guess about which is which.
    plain = [u for u in urls if "/homedetails/" not in u]
    browser = [u for u in urls if "/homedetails/" in u]
    fresh = lambda xs: [u for u in xs if u not in cache or
                        cache[u]["state"] in ("blocked", "unknown")]
    plain, browser = fresh(plain), fresh(browser)
    if limit:
        plain, browser = plain[:limit], browser[:limit]

    print(f"zillow listings {len(targets):,} · distinct pages {len(urls):,} · "
          f"cached {len(cache):,}", flush=True)
    print(f"  building pages over http: {len(plain):,}"
          f"   ·  single-home pages via browser: {len(browser):,}", flush=True)

    if plain and not only_browser:
        sweep_plain(plain, cache)
    # The browser phase stays opt-in. Measured against homedetails, a headless
    # browser and a headed one with the stealth profile were both refused, so
    # this is not the answer for the walled half -- zillow_presence.py is.
    if browser and only_browser:
        sweep_browser(browser, cache)

    # Merge the two signals, strongest claim first.
    #
    #   page   the listing's own page says "N units available" -- a quote
    #   feed   the listing is, or is not, in today's search results -- an
    #          inference, and the only thing available for the walled half
    #
    # These are kept apart rather than averaged because they do not mean the
    # same thing. A building still in the feed is being advertised; a building
    # whose page reports zero units is being advertised and has nothing to
    # rent. Collapsing them would lose exactly the distinction worth showing.
    try:
        feed = json.loads((HERE / "zillow_presence.json").read_text())
    except Exception:
        feed = {}

    counts = {}
    for a, u in targets:
        page = cache.get(u)
        seen = feed.get(u)
        if page and page["state"] in ("live", "gone", "listed"):
            st = "live" if page["state"] == "listed" else page["state"]
            a["avail"] = st
            a["avail_src"] = ("Zillow listing page"
                              if page["state"] != "listed" else
                              "Zillow listing page (no unit count published)")
            if page.get("units") is not None:
                a["zunits"] = page["units"]
            counts["page:" + st] = counts.get("page:" + st, 0) + 1
        elif seen:
            a["avail"] = seen["state"]
            a["avail_src"] = "Zillow search results"
            if seen.get("units") is not None:
                a["zunits"] = seen["units"]
            if seen.get("days") is not None:
                a["zdays"] = seen["days"]
            counts["feed:" + seen["state"]] = counts.get("feed:" + seen["state"], 0) + 1
        else:
            counts["unresolved"] = counts.get("unresolved", 0) + 1

    json.dump(data, open(DATA, "w"), separators=(",", ":"))
    print("\nresolved:", counts)
    still = sum(1 for a, _ in targets if a.get("avail") in (None, "unknown"))
    print(f"still unknown: {still:,} of {len(targets):,}")


if __name__ == "__main__":
    main()
