#!/usr/bin/env python3
"""Local server for the apartment hunt.

Serves the page and proxies owner lookups. The RentCast key never reaches the
browser, and the monthly cap is enforced here rather than in client code, so a
bug in the page cannot run up an overage bill.

    python3 research/serve.py            -> http://127.0.0.1:8799

RentCast's free plan is 50 requests/month, then $0.20 each. This refuses to
exceed the cap, caches every answer to disk forever, and never batches.
"""
import http.server
import json
import os
import pathlib
import re
import socketserver
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
PIPE = HERE / "pipeline"
CACHE = PIPE / "owner_cache.json"
USAGE = PIPE / "owner_usage.json"
PORT = int(os.environ.get("PORT", "8799"))
MONTHLY_CAP = int(os.environ.get("RENTCAST_CAP", "50"))

# Refreshing costs money on two of the three modes, so paid runs are refused
# unless the operator opted in on the command line -- the same reasoning as
# MONTHLY_CAP above. A bug in the page, or a stray double-click, must not be
# able to spend Apify credit.
ALLOW_PAID = os.environ.get("CASITA_ALLOW_PAID_REFRESH") == "1"

REFRESH_MODES = {
    # Craigslist's own search API. No Apify, no token, no spend.
    "live": {
        "label": "Re-check availability",
        "cost": "free",
        "paid": False,
        "note": "Re-sweeps the Craigslist index and re-marks what has come down.",
        "steps": [
            ("craigslist_pets.py", "sweeping the Craigslist index"),
            ("merge_pets.py", "merging pet flags"),
            ("add_availability.py", "re-marking what is still rentable"),
        ],
    },
    # One paid mode, not two. refresh.sh advertises a --quick variant at "~$2"
    # against a full run at "~$3-4"; scrape_all.py imports neither os nor
    # environ, so the QUICK variable refresh.sh exports is never read and the
    # two invocations do exactly the same work for exactly the same money.
    #
    # The cost is measured, not estimated. Only Apartments.com goes through
    # Apify (epctex/apartments-scraper-api); Zillow is read from __NEXT_DATA__
    # on its own search pages and Craigslist from its own JSON API, both free.
    # Billed runs of that actor on 2026-08-09: $0.11 and $0.40.
    "full": {
        "label": "Re-scrape listings",
        "cost": "~$0.40 of Apify credit",
        "paid": True,
        "note": "Re-scrapes Apartments.com through Apify. Zillow and Craigslist "
                "are re-fetched free in the same run.",
        "steps": None,          # delegates to refresh.sh
    },
}

# One run at a time, guarded by a lock rather than a flag: two concurrent
# pipelines would interleave writes to app_data.json.
JOB_LOCK = threading.Lock()
JOB = {"running": False, "mode": None, "step": "", "log": [],
       "done": False, "error": None, "started": None, "finished": None}


def job_log(line):
    JOB["log"].append(line)
    del JOB["log"][:-40]                     # keep the tail bounded


def run_refresh(mode):
    spec = REFRESH_MODES[mode]
    try:
        if spec["steps"] is None:
            cmd = [str(HERE / "refresh.sh")] + (["--quick"] if mode == "quick" else [])
            JOB["step"] = "re-scraping listings"
            job_log(f"$ {' '.join(cmd)}")
            p = subprocess.run(cmd, cwd=str(HERE), capture_output=True, text=True)
            for ln in (p.stdout or "").splitlines():
                job_log(ln)
            if p.returncode:
                raise RuntimeError((p.stderr or "refresh.sh failed").strip()[:400])
        else:
            for script, label in spec["steps"]:
                JOB["step"] = label
                job_log(f"$ python3 {script}")
                p = subprocess.run(["python3", script], cwd=str(PIPE),
                                   capture_output=True, text=True)
                for ln in (p.stdout or "").splitlines()[-6:]:
                    job_log(ln)
                if p.returncode:
                    raise RuntimeError(f"{script}: {(p.stderr or '').strip()[:300]}")

        JOB["step"] = "rebuilding the pages"
        job_log("$ python3 build_pages.py")
        p = subprocess.run(["python3", "build_pages.py"], cwd=str(PIPE),
                           capture_output=True, text=True)
        for ln in (p.stdout or "").splitlines():
            job_log(ln)
        if p.returncode:
            raise RuntimeError(f"build_pages.py: {(p.stderr or '').strip()[:300]}")
        JOB["step"] = "done"
    except Exception as e:                   # surfaced to the page, not swallowed
        JOB["error"] = str(e)[:400]
        job_log(f"!! {JOB['error']}")
    finally:
        JOB["running"] = False
        JOB["done"] = True
        JOB["finished"] = time.time()
        JOB_LOCK.release()


def env(name):
    try:
        for line in (ROOT / ".env").read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return os.environ.get(name)


KEY = env("RENTCAST_API_KEY")


def load(p, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def save(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1))


def month_key():
    import datetime
    return datetime.date.today().strftime("%Y-%m")


def norm(addr):
    a = re.sub(r"\s+", " ", (addr or "").strip().lower())
    a = re.sub(r"[,#].*$", "", a)
    return a


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/refresh":
            return self.refresh(urllib.parse.parse_qs(u.query))
        return self._json(404, {"error": "not found"})

    def refresh(self, q):
        mode = (q.get("mode") or ["live"])[0]
        spec = REFRESH_MODES.get(mode)
        if not spec:
            return self._json(400, {"error": f"unknown mode {mode!r}"})
        if spec["paid"] and not ALLOW_PAID:
            return self._json(403, {
                "error": "paid refresh is off",
                "note": "Restart with CASITA_ALLOW_PAID_REFRESH=1 to enable "
                        f"{mode} ({spec['cost']}).",
            })
        if not JOB_LOCK.acquire(blocking=False):
            return self._json(409, {"error": "a refresh is already running",
                                    "mode": JOB["mode"], "step": JOB["step"]})
        JOB.update({"running": True, "mode": mode, "step": "starting", "log": [],
                    "done": False, "error": None, "started": time.time(),
                    "finished": None})
        threading.Thread(target=run_refresh, args=(mode,), daemon=True).start()
        return self._json(202, {"started": True, "mode": mode, "cost": spec["cost"]})

    def deep(self, q):
        """Fetch one listing page and report what a careful reader would check.

        The search API carries no contact details, no body text and no reply
        option -- those live only on the posting page. Fetching 1,500 of them
        on every refresh would be slow and rude; fetching one, when a reader
        has already been told something looks off, costs nothing and answers
        the question they actually have: is there a human behind this.
        """
        url = (q.get("url") or [""])[0]
        if not url.startswith(("https://sfbay.craigslist.org/", "https://www.craigslist.org/")):
            return self._json(400, {"error": "only craigslist posting URLs"})
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return self._json(200, {"gone": True})
            return self._json(502, {"error": f"craigslist {e.code}"})
        except Exception as e:
            return self._json(502, {"error": str(e)[:200]})

        body = ""
        m = re.search(r'id="postingbody".*?>(.*?)</section>', html, re.S)
        if m:
            body = re.sub(r"<[^>]+>", " ", m.group(1))
            body = re.sub(r"\s+", " ", body).replace(
                "QR Code Link to This Post", "").strip()

        # No "does it accept replies" flag here, deliberately. The obvious
        # test -- looking for the reply button markup -- returned true on every
        # one of thirty postings checked, because Craigslist ships that markup
        # on all of them. A check that is always true is worse than no check:
        # it reassures. Contact on Craigslist runs through an anonymised relay,
        # so an address in the body is the exception, not the rule.
        emails = set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", body))
        phones = set(re.findall(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}", body))
        # Percentiles measured over a random sample of live SF postings, so
        # "short" means short compared with the real distribution rather than
        # compared with a number somebody guessed.
        return self._json(200, {
            "gone": "This posting has been deleted" in html or "has expired" in html,
            "bodyChars": len(body),
            "bodyP25": 635, "bodyMedian": 1198,
            "emailsInBody": len(emails),
            "phonesInBody": len(phones),
            "body": body[:1200],
        })

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        # The walking network ships gzipped: 4.3MB of coordinates become 1.5MB
        # on the wire, and the browser inflates it for free. Serving the plain
        # file would triple the download for no benefit.
        if u.path == "/walk_graph.json":
            gz = HERE / "walk_graph.json.gz"
            if gz.exists():
                body = gz.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "max-age=86400")
                self.end_headers()
                self.wfile.write(body)
                return
        if u.path == "/api/listing":
            return self.deep(urllib.parse.parse_qs(u.query))
        if u.path == "/api/owner":
            return self.owner(urllib.parse.parse_qs(u.query))
        if u.path == "/api/refresh":
            return self._json(200, {
                "allowPaid": ALLOW_PAID,
                "modes": {k: {kk: vv for kk, vv in v.items() if kk != "steps"}
                          for k, v in REFRESH_MODES.items()},
                "job": {k: JOB[k] for k in
                        ("running", "mode", "step", "log", "done", "error",
                         "started", "finished")},
                "scraped": (PIPE / "app_data.json").stat().st_mtime,
            })
        if u.path == "/api/quota":
            usage = load(USAGE, {})
            used = usage.get(month_key(), 0)
            return self._json(200, {"used": used, "cap": MONTHLY_CAP,
                                    "left": max(0, MONTHLY_CAP - used),
                                    "cached": len(load(CACHE, {}))})
        return super().do_GET()

    def owner(self, q):
        addr = (q.get("addr") or [""])[0]
        if not addr:
            return self._json(400, {"error": "missing addr"})
        if not KEY:
            return self._json(503, {"error": "No RENTCAST_API_KEY in .env"})

        cache = load(CACHE, {})
        k = norm(addr)
        if k in cache:                       # never spend twice on one address
            return self._json(200, {**cache[k], "cached": True})

        usage = load(USAGE, {})
        m = month_key()
        used = usage.get(m, 0)
        if used >= MONTHLY_CAP:              # hard stop, server-side
            return self._json(429, {
                "error": "monthly cap reached",
                "used": used, "cap": MONTHLY_CAP,
                "note": "Raise with RENTCAST_CAP=… only if you mean to pay $0.20/request."})

        url = "https://api.rentcast.io/v1/properties?" + urllib.parse.urlencode(
            {"address": addr if "," in addr else f"{addr}, San Francisco, CA"})
        req = urllib.request.Request(url, headers={"X-Api-Key": KEY,
                                                   "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"error": f"RentCast {e.code}",
                                       "detail": e.read().decode()[:200]})
        except Exception as e:
            return self._json(502, {"error": str(e)[:200]})

        usage[m] = used + 1                  # count it the moment it is spent
        save(USAGE, usage)

        p = (data[0] if isinstance(data, list) and data else data) or {}
        own = p.get("owner") or {}
        names = own.get("names") if isinstance(own, dict) else None
        mail = own.get("mailingAddress") if isinstance(own, dict) else None
        out = {
            "addr": p.get("formattedAddress") or addr,
            "names": names or [],
            "type": own.get("type") if isinstance(own, dict) else None,
            "mail": (mail or {}).get("formattedAddress") if isinstance(mail, dict) else None,
            "ownerOccupied": p.get("ownerOccupied"),
            "lastSale": (p.get("lastSaleDate") or "")[:10] or None,
            "found": bool(names),
            "used": usage[m], "cap": MONTHLY_CAP,
            "left": max(0, MONTHLY_CAP - usage[m]),
            "cached": False,
        }
        cache[k] = {kk: vv for kk, vv in out.items()
                    if kk not in ("used", "cap", "left", "cached")}
        save(CACHE, cache)
        return self._json(200, out)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    u = load(USAGE, {}).get(month_key(), 0)
    print(f"Casita             → http://127.0.0.1:{PORT}/casita-demo.html")
    print("   The quiz is the front door. Clear this site's local storage to see it again.")
    if (HERE / "xray-demo.html").exists():
        print(f"Casita (old build) → http://127.0.0.1:{PORT}/xray-demo.html")
    if (HERE / "proto-demo.html").exists():
        print(f"Casita (prototype) → http://127.0.0.1:{PORT}/proto-demo.html"
              f"   (add ?fresh to replay the first run)")
    print(f"owner lookups used this month: {u}/{MONTHLY_CAP}"
          f"  ·  cached addresses: {len(load(CACHE, {}))}")
    if not KEY:
        print("!! no RENTCAST_API_KEY in .env — owner lookups will return 503")
    with Server(("127.0.0.1", PORT), Handler) as s:
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
