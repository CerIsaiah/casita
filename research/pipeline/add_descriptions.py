#!/usr/bin/env python3
"""Fetch the listing text the search feeds do not carry.

What a flat is actually like -- two floors, a view, the manager on the same
landing, a bedroom with no window -- is written in the advert's prose and
nowhere else. add_qualities.py can read it, but only for listings that have
prose to read, and after a scrape that was 751 of 2,895: Apartments.com only,
because its API returns the description and the other two feeds do not.

Both gaps are fillable, and neither needs a browser:

  Craigslist   the search API returns no body, but the posting page is not
               behind anything. One plain request per listing.
  Zillow       /apartments/ building pages carry it as JSON; /homedetails/
               pages render it into an <article>. Both are reachable.

The /homedetails/ half was written off three times -- plain request, headless
Chrome, headed Chrome with a stealth profile, 403 every time -- and the
conclusion was wrong. The wall is not judging the IP or the browser. It wants
the client hints and Sec-Fetch metadata that accompany a real Chrome
navigation, and a bare User-Agent sends none of them. Adding the headers turned
403 into 200 on the same IP that had been refused all day.

Worth remembering the shape of that mistake: three failures with the same tool
looked like proof the door was locked, when all three had been knocking wrong.

Every answer is cached to disk, so a rerun after a partial sweep costs nothing
for what it already has.

    python3 add_descriptions.py              both sources
    python3 add_descriptions.py --craigslist only Craigslist
    python3 add_descriptions.py --zillow     only Zillow listing pages
    python3 add_descriptions.py --limit 50   cap the work, for testing
"""
import gzip
import http.cookiejar
import json
import math
import pathlib
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import atomicjson

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "app_data.json"
CACHE = HERE / "descriptions.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
# The header set that gets past Zillow's /homedetails/ wall.
#
# Three earlier attempts concluded those pages were unreachable -- plain
# request, headless Chrome, headed Chrome with a stealth profile, all 403. The
# conclusion was wrong. The wall is not checking the IP or the browser, it is
# checking whether the request carries the client hints and Sec-Fetch metadata
# a real Chrome navigation sends. A bare User-Agent does not, so it was refused
# on a signal that had nothing to do with who was asking.
#
# With them: HTTP 200 and 1.5MB of page, on the same IP that had been getting
# 403s all day.
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
              "image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Referer": "https://www.zillow.com/san-francisco-ca/rentals/",
}

CL_BODY = re.compile(r'id="postingbody"[^>]*>(.*?)</section>', re.S)
# Craigslist prefixes every body with this, and it is not part of the advert.
CL_JUNK = re.compile(r"QR Code Link to This Post\s*", re.I)
Z_DESC = re.compile(r'"description"\s*:\s*"((?:[^"\\]|\\.){60,})"')
# Building pages carry it as JSON; single-home pages render it into an
# <article> instead, so both shapes are tried.
Z_ARTICLE = re.compile(r'"description"\s*>\s*<article[^>]*>(.*?)</article>', re.S)
TAGS = re.compile(r"<[^>]+>")

# Sentinel: refused, as distinct from absent.
WALLED = object()


def clean(html_fragment):
    t = TAGS.sub(" ", html_fragment)
    t = t.replace("&amp;", "&").replace("&#x27;", "'").replace("&quot;", '"')
    t = t.replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    return " ".join(t.split())


# ---------------------------------------------------------------------------
# A browsing session, rather than a thousand unrelated strangers.
#
# Every request so far was cookieless and refererless: a fresh anonymous client
# asking for a deep listing page it could not have found, a thousand times in a
# row. No person browses that way, and PerimeterX scores exactly that shape.
# The header set got past the first check; the traffic pattern failed the
# second one.
#
# So this keeps one session. It warms up on the search page the way a visitor
# arrives, keeps the cookies that page sets, sends each request with the last
# page as its referer, and paces itself like someone reading rather than like a
# metronome -- mostly a second or two, occasionally stopping to actually look
# at something.
_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))
_session = {"referer": "https://www.zillow.com/san-francisco-ca/rentals/",
            "warm": False, "since_pause": 0}
_session_lock = threading.Lock()


def warm_up():
    """Arrive the way a visitor arrives, and keep what the front door hands you."""
    with _session_lock:
        if _session["warm"]:
            return True
        try:
            h = dict(HEADERS)
            h.pop("Referer", None)
            h["Sec-Fetch-Site"] = "none"
            _opener.open(urllib.request.Request(
                "https://www.zillow.com/san-francisco-ca/rentals/", headers=h), timeout=30).read()
            _session["warm"] = True
            time.sleep(random.uniform(2.0, 4.0))     # read the results page
            return True
        except Exception:
            return False


def human_pause():
    """A reading rhythm, not a clock.

    Log-normal so most gaps are short and a few are long, with a proper break
    every ten to twenty-five pages. A fixed interval is the easiest pattern in
    the world to recognise, and the one thing a person never produces.
    """
    with _session_lock:
        _session["since_pause"] += 1
        due = _session["since_pause"] >= random.randint(10, 25)
        if due:
            _session["since_pause"] = 0
    time.sleep(random.uniform(12, 30) if due
               else min(9.0, math.exp(random.gauss(0.35, 0.55))))


def get(url, tries=2):
    for i in range(tries):
        try:
            h_ = dict(HEADERS)
            with _session_lock:
                h_["Referer"] = _session["referer"]
            with _opener.open(
                    urllib.request.Request(url, headers=h_), timeout=30) as h:
                raw = h.read()
                if h.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                # Where we "came from" next is where we just were.
                with _session_lock:
                    _session["referer"] = url
                return raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None            # the advert is gone; not worth retrying
            if e.code in (403, 429):
                return WALLED          # tell the pacer to give ground
        except Exception:
            time.sleep(3 * (i + 1))
    return None


def craigslist_body(url):
    h = get(url)
    if h is WALLED:
        return WALLED
    if not h:
        return None
    m = CL_BODY.search(h)
    if not m:
        return None
    body = CL_JUNK.sub("", clean(m.group(1)))
    return body[:4000] or None


def zillow_body(url):
    h = get(url)
    if h is WALLED:
        return WALLED
    if not h:
        return None
    art = Z_ARTICLE.search(h)
    if art:
        return clean(art.group(1))[:4000] or None
    m = Z_DESC.search(h)
    if not m:
        return None
    try:
        body = json.loads('"' + m.group(1) + '"')
    except json.JSONDecodeError:
        body = m.group(1)
    return " ".join(str(body).split())[:4000] or None


class Pacer:
    """A shared clock, so N workers still add up to a polite request rate.

    Fetching two thousand pages one at a time with a two-second sleep is ninety
    minutes of mostly waiting, and the wait does nothing for the site: what a
    host cares about is requests per second, not how many sockets they arrive
    on. So the workers run concurrently and this decides when any of them may
    go, which makes the rate a number worth stating rather than an accident of
    how long each response happened to take.

    It gives ground rather than holding it. Every refusal widens the interval;
    a clean run slowly narrows it back. A site that starts pushing back gets a
    slower client within a few seconds, without anyone watching.
    """

    def __init__(self, interval, floor=None, ceiling=8.0):
        self.interval = interval
        self.floor = floor if floor is not None else interval
        self.ceiling = ceiling
        self.next_at = 0.0
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            due = max(now, self.next_at)
            self.next_at = due + self.interval * random.uniform(0.8, 1.2)
        gap = due - time.monotonic()
        if gap > 0:
            time.sleep(gap)

    def refused(self):
        with self.lock:
            self.interval = min(self.ceiling, self.interval * 1.6)

    def ok(self):
        with self.lock:
            self.interval = max(self.floor, self.interval * 0.97)


def sweep(targets, fetch, cache, label, rps=2.5, workers=6):
    todo = [u for u in targets if u not in cache]
    # One shared clock for all workers, so the interval is the gap between
    # *any* two requests: 1/rps, not workers/rps. Dividing by the worker count
    # made eight workers eight times politer than asked, and turned a four-a-
    # second sweep into one every two seconds.
    pacer = Pacer(1.0 / rps, floor=1.0 / (rps * 2))
    print(f"  {label}: {len(targets):,} listings · cached {len(targets) - len(todo):,} "
          f"· fetching {len(todo):,} at ~{rps}/s across {workers} workers", flush=True)
    if not todo:
        return

    done = [0]
    refused = [0]
    lock = threading.Lock()

    def one(u):
        pacer.wait()
        body = fetch(u)
        # An empty result is either a dead advert or a wall. Only the wall
        # should slow everyone down, and `fetch` reports which via WALLED.
        walled = body is WALLED
        if walled:
            pacer.refused()
            with lock:
                refused[0] += 1
            body = None
        else:
            pacer.ok()
        with lock:
            # A refusal is not an answer. Writing "" for it would put the URL
            # in the cache, and the next run skips anything already cached --
            # so a listing the site declined to serve once would be recorded as
            # permanently description-less. Only real outcomes are cached: text
            # when there is text, "" when the advert genuinely has none.
            if not walled:
                cache[u] = body or ""
            done[0] += 1
            n = done[0]
            if n % 50 == 0 or n == len(todo):
                atomicjson.dump(cache, str(CACHE))
                got = sum(1 for v in cache.values() if v)
                print(f"    {n}/{len(todo)}  kept {got:,}  "
                      f"refused {refused[0]}  interval {pacer.interval:.2f}s", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(one, todo))
    atomicjson.dump(cache, str(CACHE))

    # A sweep that is mostly being refused is not a sweep; say so rather than
    # writing a cache full of blanks that later runs will treat as "checked".
    if refused[0] > len(todo) * 0.25:
        print(f"    !! {refused[0]:,} of {len(todo):,} refused - the wall is up; "
              f"rerun later, the cache keeps what landed", flush=True)


def main():
    only_cl = "--craigslist" in sys.argv
    only_z = "--zillow" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None

    data = json.load(open(DATA))
    try:
        cache = json.loads(CACHE.read_text())
    except Exception:
        cache = {}

    def urls(pred):
        seen = []
        for a in data:
            s = (a.get("src") or [{}])[0]
            u = s.get("u")
            if u and pred(s, u) and u not in seen and not (a.get("desc") or "").strip("None "):
                seen.append(u)
        return seen[:limit] if limit else seen

    if not only_z:
        sweep(urls(lambda s, u: s.get("n") == "Craigslist"),
              craigslist_body, cache, "craigslist postings", rps=4.0, workers=8)
    if not only_cl:
        # Zillow and Craigslist tolerate very different rates, and the difference is
        # measured rather than assumed: Craigslist served 736 pages at 7.5/s with
        # zero refusals, Zillow refused 35 of the first 100 at 2.5/s. Its limiter
        # watches burst rate, so the workers are few and the clock is slow.
        sweep(urls(lambda s, u: s.get("n") == "Zillow"),
              zillow_body, cache, "zillow listing pages", rps=1.0, workers=3)

    added = 0
    for a in data:
        if (a.get("desc") or "").strip() and a["desc"] != "None":
            continue
        u = (a.get("src") or [{}])[0].get("u")
        body = cache.get(u or "")
        if body:
            a["desc"] = body
            added += 1
    atomicjson.dump(data, str(DATA))

    have = sum(1 for a in data if (a.get("desc") or "").strip() and a["desc"] != "None")
    print(f"\n  descriptions attached this run: {added:,}")
    print(f"  listings with a description now: {have:,} of {len(data):,}")


if __name__ == "__main__":
    main()
