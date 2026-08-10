"""Join listings -> parcel -> city intelligence. Grid-indexed, runs in memory."""
import json, math, re, sqlite3, sys, collections

DB = "city.sqlite"
M_LAT = 110540.0
def m_lon(lat): return 111320.0 * math.cos(math.radians(lat))


class City:
    def __init__(self, db=DB):
        c = sqlite3.connect(db); c.row_factory = sqlite3.Row
        self.parcels = [dict(r) for r in c.execute(
            "SELECT * FROM parcel WHERE lat IS NOT NULL")]
        self.noise = c.execute("SELECT lat,lon,hr FROM noise").fetchall()
        self.venues = c.execute("SELECT name,kind,lat,lon FROM venue").fetchall()
        c.close()
        self.pg = self._grid([(p["lat"], p["lon"], i) for i, p in enumerate(self.parcels)], 0.0025)
        self.ng = self._grid([(r[0], r[1], k) for k, r in enumerate(self.noise)], 0.0045)
        self.vg = self._grid([(r[2], r[3], k) for k, r in enumerate(self.venues)], 0.0060)
        print(f"  city: {len(self.parcels):,} parcels · {len(self.noise):,} noise · "
              f"{len(self.venues):,} venues", file=sys.stderr)

    @staticmethod
    def _grid(items, cell):
        g = collections.defaultdict(list)
        for la, lo, idx in items:
            g[(int(la/cell), int(lo/cell))].append((la, lo, idx))
        return (g, cell)

    @staticmethod
    def _near(grid, lat, lon, radius_m):
        g, cell = grid
        dlat = radius_m / M_LAT
        dlon = radius_m / m_lon(lat)
        out = []
        for i in range(int((lat-dlat)/cell), int((lat+dlat)/cell)+1):
            for j in range(int((lon-dlon)/cell), int((lon+dlon)/cell)+1):
                for la, lo, idx in g.get((i, j), ()):
                    dy = (la-lat)*M_LAT
                    dx = (lo-lon)*m_lon(lat)
                    d = math.hypot(dx, dy)
                    if d <= radius_m:
                        out.append((d, idx, dx, dy))
        return out

    def parcel_for(self, lat, lon, addr=None):
        """Nearest parcel; prefer a street-number match when addresses agree."""
        cands = sorted(self._near(self.pg, lat, lon, 70))[:14]
        if not cands:
            return None, None
        num = None
        if addr:
            m = re.match(r"\s*(\d+)", addr)
            if m: num = m.group(1)
        if num:
            for d, i, _, _ in cands:
                pa = self.parcels[i].get("address") or ""
                if re.match(rf"\s*{num}\b", pa):
                    return self.parcels[i], round(d, 1)
        d, i, _, _ = cands[0]
        return self.parcels[i], round(d, 1)

    def block(self, lat, lon):
        pts = self._near(self.ng, lat, lon, 250)
        hrs = [0]*24
        for _, k, _, _ in pts:
            h = self.noise[k][2]
            if 0 <= h < 24: hrs[h] += 1
        tot = sum(hrs)
        night = sum(hrs[22:]) + sum(hrs[:5])
        ven = self._near(self.vg, lat, lon, 400)
        late = sum(1 for _, k, _, _ in ven
                   if re.search(r"Extended Hours", self.venues[k][1] or "", re.I))
        # nearest named venues, so "good for going out" can name names
        vlist = sorted(ven)[:8]
        names = []
        for dist, k, _, _ in vlist:
            nm, kind = self.venues[k][0], self.venues[k][1] or ""
            if not nm: continue
            names.append({"n": nm[:34].title() if nm.isupper() else nm[:34],
                          "d": int(dist),
                          "l": 1 if re.search(r"Extended Hours", kind, re.I) else 0})
        return {
            "venue_names": names,
            "noise_250m": len(pts),
            "night_pct": round(night/tot*100) if tot else 0,
            "peak_hr": hrs.index(max(hrs)) if tot else None,
            "venues_400m": len(ven), "late_venues": late,
            "hours": hrs,
        }


def norm_addr(s):
    s = re.sub(r"[,#].*$", "", (s or "")).strip().lower()
    s = re.sub(r"\b(street)\b", "st", s); s = re.sub(r"\b(avenue)\b", "ave", s)
    s = re.sub(r"\b(boulevard)\b", "blvd", s); s = re.sub(r"\b(drive)\b", "dr", s)
    return re.sub(r"\s+", " ", s).strip()


if __name__ == "__main__":
    city = City()
    raw = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "listings_test.json"))
    hit = miss = 0
    samples = []
    for src, items in raw.items():
        for it in items[:400]:
            co = it.get("coordinates") or {}
            lat = co.get("latitude") or it.get("latitude")
            lon = co.get("longitude") or it.get("longitude")
            if lat is None or lon is None:
                miss += 1; continue
            addr = ((it.get("location") or {}).get("fullAddress")
                    if isinstance(it.get("location"), dict) else None) \
                   or it.get("propertyName") or ""
            p, dist = city.parcel_for(float(lat), float(lon), addr)
            if not p:
                miss += 1; continue
            hit += 1
            if len(samples) < 8:
                b = city.block(float(lat), float(lon))
                samples.append((src, addr[:38], p["address"][:26], dist,
                                p["year_built"], p["units"], p["rc_status"],
                                p["novs"], p["abate_over_year"], p["referred"],
                                b["noise_250m"], b["night_pct"], b["venues_400m"]))
    print(f"\njoined: {hit}  unmatched: {miss}")
    print(f"{'src':<11}{'listing':<40}{'parcel':<28}{'m':>5} {'yr':>5}{'u':>5} "
          f"{'rc':>6}{'nov':>5}{'>1y':>5}{'atty':>5}{'nz':>6}{'nite':>5}{'ven':>5}")
    for s in samples:
        print(f"{s[0]:<11}{s[1]:<40}{s[2]:<28}{s[3]:>5} {str(s[4]):>5}{str(s[5]):>5} "
              f"{s[6]:>6}{s[7]:>5}{s[8]:>5}{s[9]:>5}{s[10]:>6}{s[11]:>5}{s[12]:>5}")
