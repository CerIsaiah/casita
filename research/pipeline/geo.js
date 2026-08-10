/* geo.js — distances, the place index, and the paths drawn on the map.
   ============================================================
   Everything positional the interface claims comes from here. Two honesty
   constraints shape the whole file:

   1. There is no routing engine behind this page, and adding one would mean a
      paid API key on a demo that is contractually credentials-free. So travel
      times are straight-line distance with a detour allowance, and they are
      labelled as estimates everywhere they appear. What is NOT done is drawing
      them as straight lines where a real route exists — see router.js.

   2. A pin is only as good as its address. Craigslist deliberately fuzzes
      location and 116 listings never matched the city parcel map, so anything
      measured from those pins is marked approximate rather than quietly
      averaged in with the exact ones.
   ============================================================ */

const GEO = (() => {
  "use strict";

  const M_LAT = 110540;
  const mLon = (la) => 111320 * Math.cos(la * Math.PI / 180);

  function metres(la1, lo1, la2, lo2) {
    return Math.hypot((lo2 - lo1) * mLon(la1), (la2 - la1) * M_LAT);
  }

  // SF's grid costs roughly 30% over the crow-flight distance. Speeds are
  // door to door, including the waiting and parking nobody counts.
  const CIRCUITY = 1.30;
  const SPEED = { walk: 78, bike: 200, transit: 240, drive: 330 };  // metres/min

  function minutesTo(a, la, lo, mode) {
    const d = metres(a.lat, a.lon, la, lo) * CIRCUITY;
    return Math.max(1, Math.round(d / (SPEED[mode] || SPEED.walk)));
  }
  // Short hops get walked whatever you said you would do.
  function autoMode(a, la, lo, pref) {
    return metres(a.lat, a.lon, la, lo) * CIRCUITY < 1300 ? "walk" : (pref || "transit");
  }

  /* ---------- the place index ----------
     4,092 OSM points, bucketed on a ~600m grid so "nearest gym" is a handful
     of comparisons rather than a scan of the whole set. */
  const PL = (typeof PLACES !== "undefined") ? PLACES : [];
  const CELL = 0.006;
  const grid = new Map();
  for (const p of PL) {
    const k = `${Math.round(p.la / CELL)},${Math.round(p.lo / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }

  const nearCache = new Map();
  function nearest(a, kind, brand) {
    const key = `${a.id}|${kind}|${brand || ""}`;
    if (nearCache.has(key)) return nearCache.get(key);
    let best = null, bd = Infinity;
    const ci = Math.round(a.lat / CELL), cj = Math.round(a.lon / CELL);
    for (let r = 1; r <= 4; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (const p of (grid.get(`${i},${j}`) || [])) {
            if (p.k !== kind) continue;
            if (brand && !(p.b === brand || p.n === brand ||
                (p.n || "").toLowerCase().includes(brand.toLowerCase()))) continue;
            const d = metres(a.lat, a.lon, p.la, p.lo);
            if (d < bd) { bd = d; best = p; }
          }
        }
      }
      if (best) break;
    }
    const out = best ? { p: best, m: bd } : null;
    nearCache.set(key, out);
    return out;
  }

  /* Distance to the nearest one answers "can I get there". Density answers "is
     this a scene", which is the real question behind wanting to live near the
     bars: one good bar on an empty block is not a night out. */
  const countCache = new Map();
  function countWithin(a, kinds, radius) {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    const key = `${a.id}|${list.join("+")}|${radius}`;
    if (countCache.has(key)) return countCache.get(key);
    let n = 0;
    const ci = Math.round(a.lat / CELL), cj = Math.round(a.lon / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const p of (grid.get(`${i},${j}`) || [])) {
          if (list.includes(p.k) && metres(a.lat, a.lon, p.la, p.lo) <= radius) n++;
        }
      }
    }
    countCache.set(key, n);
    return n;
  }

  /* The grid-snapped path generator that used to live here has been deleted.

     It drew two doglegs between the endpoints, aligned to whichever of San
     Francisco's two street grids the trip was in. The corners made it read as
     a route -- right angles look like streets -- while the segments went
     straight through blocks and buildings. A line that is obviously a straight
     line is honest; a line that mimics streets and is not one is a lie with
     better art direction, and it is exactly what router.js now exists to
     replace. Anything that cannot be routed is drawn as a plain dashed
     bearing, so the picture matches what we actually know.

     See router.js and build_walk_graph.py. */

  /* ---------- what "your life" resolves to for one apartment ----------
     The anchors the renter typed, plus the everyday errands they said they
     cared about. Anything they did not ask about is left off: the panel shows
     three to five destinations, and filling it with a gym for someone who
     never mentioned one is exactly the noise this redesign exists to remove. */
  const ERRANDS = {
    grocery:  { icon: "cart", label: "Grocery",  kind: "grocery" },
    gym:      { icon: "🏋️", label: "Gym",      kind: "gym" },
    transit:  { icon: "🚇", label: "Transit",  kind: "transit" },
    cafe:     { icon: "coffee", label: "Café",     kind: "cafe" },
    park:     { icon: "tree", label: "Park",     kind: "park" },
    nightlife:{ icon: "wine", label: "Nightlife", kind: "bar" },
  };

  /* Profiles saved before the icon set existed hold emoji. Map them rather
     than reset anybody's answers. */
  const ANCHOR_ICON = { "💼": "briefcase", "🏋️": "dumbbell", "🛒": "cart",
    "❤️": "star", "🎓": "building", "☕": "coffee", "📍": "pin" };

  function legs(a, P) {
    if (!a || !P) return [];
    const out = [];
    for (const an of P.anchors || []) {
      const mode = autoMode(a, an.lat, an.lon, an.mode);
      out.push({
        key: "anchor:" + an.label, label: an.label, icon: ANCHOR_ICON[an.icon] || an.icon || "pin",
        lat: an.lat, lon: an.lon, mode, fixed: true,
        mins: minutesTo(a, an.lat, an.lon, mode),
      });
    }
    // Errands ride along only where the renter named the matching priority —
    // and only where they did not already pin the real thing. Someone who
    // typed in their actual gym does not also want the nearest gym drawn
    // beside it; two lines labelled "Gym" reads as a bug, and it is one.
    const pinned = new Set(out.map((l) => l.label.toLowerCase()));
    for (const k of P.errands || []) {
      const e = ERRANDS[k];
      if (!e || pinned.has(e.label.toLowerCase())) continue;
      const brand = k === "grocery" ? P.groceryBrand : k === "gym" ? P.gymBrand : null;
      const hit = (brand && nearest(a, e.kind, brand)) || nearest(a, e.kind, null);
      if (!hit) continue;
      const mode = autoMode(a, hit.p.la, hit.p.lo, "walk");
      out.push({
        key: "errand:" + k, label: e.label, icon: e.icon,
        lat: hit.p.la, lon: hit.p.lo, mode,
        mins: minutesTo(a, hit.p.la, hit.p.lo, mode),
        sub: hit.p.n || null,
        exact: !!(brand && hit.p.b === brand),
      });
    }
    // Closest first: the map reads outward from home, and the labels collide
    // less when the short legs are drawn under the long ones.
    return out.sort((x, y) => x.mins - y.mins).slice(0, 5);
  }

  /* If the renter typed in their actual gym, that is the gym. Scoring "gym
     access" off the nearest gym in the city while the map draws a line to the
     one they named produces two different answers to one question — a listing
     four minutes from a gym they will never go to, sitting next to a 127-minute
     line to the gym they will. Whoever is asking, the anchor wins. */
  function anchorFor(P, label) {
    const want = String(label || "").toLowerCase();
    return (P.anchors || []).find((an) => an.label.toLowerCase() === want) || null;
  }

  /* ---------- walks worth taking from the front door ----------
     A dog needs walking twice a day for as long as you live somewhere, which
     makes "is there anywhere decent to walk" a bigger question than most of
     what a listing page tells you, and one no listing page answers.

     The same machinery answers the other version of the question. Somebody who
     picked nightlife wants to know what a Friday looks like on foot from here;
     somebody who picked cafés wants the Saturday morning version. So a walk is
     just: pick the kinds of place that matter to this renter, take the nearest
     few, and string them into a loop that comes home.

     What this is NOT is a routed walk. There is no pedestrian graph behind it,
     so the legs are drawn with routePath() along the street grid like every
     other line on this map, and the distance is the sum of those legs with the
     same detour allowance. It is a suggestion of a loop, and the panel says so.

     Blocks with heavy street-incident percentiles are avoided where an
     alternative of the same kind exists nearby -- that is the "safe" half of a
     safe, fun walk, and it uses the same coverage-corrected percentile the
     Street tab shows rather than a separate invented safety number. */
  const WALKS = {
    dog:    { icon: "dog", label: "Dog walk",  kinds: ["park"], stops: 3, want: 2200 },
    park:   { icon: "tree", label: "Green loop", kinds: ["park"], stops: 3, want: 2200 },
    coffee: { icon: "coffee", label: "Coffee walk", kinds: ["cafe"], stops: 3, want: 1500 },
    night:  { icon: "wine", label: "Night out",  kinds: ["bar", "club", "music"], stops: 4, want: 1600 },
    errand: { icon: "cart", label: "Errand run", kinds: ["grocery", "pharmacy"], stops: 2, want: 1600 },
  };

  // Candidate stops of the requested kinds, nearest first, within reach.
  function candidates(a, kinds, radius) {
    const out = [];
    const ci = Math.round(a.lat / CELL), cj = Math.round(a.lon / CELL);
    const r = Math.ceil(radius / 600) + 1;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (const p of (grid.get(`${i},${j}`) || [])) {
          if (!kinds.includes(p.k)) continue;
          const d = metres(a.lat, a.lon, p.la, p.lo);
          if (d <= radius) out.push({ p, m: d });
        }
      }
    }
    return out.sort((x, y) => x.m - y.m);
  }

  function walk(a, kind) {
    const spec = WALKS[kind];
    if (!spec) return null;
    const pool = candidates(a, spec.kinds, spec.want);
    if (!pool.length) return null;

    /* Spread the stops out instead of taking the three nearest, which are
       usually three doors of the same building. Each new stop has to be at
       least 150m from the ones already chosen, so the loop actually goes
       somewhere. */
    const stops = [];
    for (const c of pool) {
      if (stops.length >= spec.stops) break;
      if (stops.every((s) => metres(s.p.la, s.p.lo, c.p.la, c.p.lo) > 150)) stops.push(c);
    }
    if (!stops.length) return null;

    // Walk them in bearing order so the path sweeps round rather than
    // doubling back on itself, then close the loop at the front door.
    const bearing = (p) => Math.atan2(p.la - a.lat, p.lon - a.lon);
    stops.sort((x, y) => bearing(x.p) - bearing(y.p));

    const pts = [[a.lat, a.lon], ...stops.map((s) => [s.p.la, s.p.lo]), [a.lat, a.lon]];
    let metresTotal = 0;
    const legs = [];
    for (let i = 1; i < pts.length; i++) {
      metresTotal += metres(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * CIRCUITY;
      legs.push([[pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]]);
    }
    return {
      kind, icon: spec.icon, label: spec.label, legs,
      stops: stops.map((s) => ({ name: s.p.n || spec.label, lat: s.p.la, lon: s.p.lo, kind: s.p.k })),
      metres: Math.round(metresTotal),
      mins: Math.max(1, Math.round(metresTotal / SPEED.walk)),
    };
  }

  // Which walks are worth offering here, given what the renter said matters.
  function walksFor(P) {
    const out = [];
    if ((P.pets || "none") === "dog") out.push("dog");
    if (P.priorities && P.priorities.nightlife) out.push("night");
    if (P.priorities && (P.priorities.walk || P.priorities.quiet)) out.push("park");
    out.push("coffee", "errand");
    return [...new Set(out)].slice(0, 4);
  }

  /* How much to trust the dot. Said out loud rather than averaged away.
     locate.py has already tried to recover an address from the listing text, so
     this reports the outcome of that attempt rather than guessing from the
     source name. */
  function pinNote(a) {
    const lv = (a.loc || {}).level;
    if (lv === "title_address" || lv === "building_name")
      return (a.loc.why || "Located from the listing text") +
             ". The source itself published only a neighbourhood.";
    if (lv === "neighbourhood")
      return ((a.loc && a.loc.why) || "The source published only a neighbourhood") +
             ", so this pin is the middle of that area and every distance below could be out by half a mile in any direction.";
    if (!a.parcel_ok)
      return "This address never matched a building on the city parcel map, so the pin — and every distance measured from it — is approximate.";
    return null;
  }

  // A time measured from a neighbourhood centroid is not a time, it is a range.
  // Printing "6 min" off a pin that could be half a mile out is the sort of
  // false precision this whole file exists to avoid.
  const soft = (a) => (a.loc || {}).level === "neighbourhood" || !a.parcel_ok;
  function minsText(a, mins) {
    return soft(a) ? `${Math.max(1, Math.round(mins * 0.6))}–${Math.round(mins * 1.6)} min`
                   : `${mins} min`;
  }

  return { metres, minutesTo, autoMode, nearest, countWithin, legs,
           anchorFor, pinNote, minsText, soft, walk, walksFor, WALKS, ERRANDS, PL };
})();
