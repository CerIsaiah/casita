/* router.js — actual walking routes, on actual streets.
   ============================================================
   Everything else in this product measures distance as a straight line with a
   30% detour allowance, and says so wherever it prints a number. That was an
   honest approximation but a poor one: 30% is the citywide average, and the
   places where it is wrong are exactly the places a renter cares about — a hill
   with no through street, a block cut off by a freeway, a park you have to walk
   around rather than through.

   This routes on OpenStreetMap's footway network instead. build_walk_graph.py
   contracts the city to its junctions and ships the shape of each stretch
   between them, so the search space is around forty thousand decisions rather
   than half a million points, and a drawn route follows the real bend of the
   road because it *is* the road.

   Three things worth knowing about the design:

   1. It loads lazily and off the critical path. The graph is a separate file,
      fetched after first paint. Until it arrives every caller gets null and the
      interface falls back to the straight-line estimate it always used, so a
      slow network degrades the routes rather than the page.

   2. A* rather than Dijkstra, with a straight-line heuristic in metres. On a
      graph this size Dijkstra would also be fast enough, but A* keeps the
      explored set small enough that several routes per apartment stay
      imperceptible.

   3. It refuses to guess. If either end cannot be snapped to the network
      within 250m, or the search exhausts, it returns null instead of a
      plausible-looking line — the whole reason for building this was that a
      plausible-looking line is worse than an admitted estimate.
   ============================================================ */

const ROUTER = (() => {
  "use strict";

  let G = null;                 // the loaded graph
  let loading = null;
  let grid = null;              // spatial index over junctions
  const CELL = 0.004;           // ~440m buckets for snapping
  const M_LAT = 110540;

  function metres(la1, lo1, la2, lo2) {
    const x = (lo2 - lo1) * 111320 * Math.cos(la1 * Math.PI / 180);
    return Math.hypot(x, (la2 - la1) * M_LAT);
  }

  /* ---------- loading ---------- */
  async function load(url) {
    if (G) return G;
    if (loading) return loading;
    loading = (async () => {
      const r = await fetch(url || "walk_graph.json");
      if (!r.ok) throw new Error("graph " + r.status);
      const d = await r.json();

      const q = d.quant, lat0 = d.lat0, lon0 = d.lon0;
      const n = d.nodes.length / 2;
      const lat = new Float64Array(n), lon = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        lat[i] = (d.nodes[i * 2] + lat0) * q;
        lon[i] = (d.nodes[i * 2 + 1] + lon0) * q;
      }
      // Adjacency as a flat CSR-style structure: one pass to count, one to
      // fill. Arrays of arrays would allocate 40,000 objects for no reason.
      const m = d.edges.length / 3;
      const deg = new Uint32Array(n + 1);
      for (let e = 0; e < m; e++) { deg[d.edges[e * 3]]++; deg[d.edges[e * 3 + 1]]++; }
      const start = new Uint32Array(n + 1);
      for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
      const to = new Uint32Array(start[n]), cost = new Float32Array(start[n]);
      const eid = new Uint32Array(start[n]);
      // Whether a car may use each arc. 42% of the network is footway, steps
      // or pedestrian-only; routing a drive over those would send somebody
      // down a staircase, which is the sort of thing this file exists to stop.
      const drivable = new Uint8Array(start[n]);
      const dflags = d.drive || [];
      const fill = start.slice();
      for (let e = 0; e < m; e++) {
        const a = d.edges[e * 3], b = d.edges[e * 3 + 1], w = d.edges[e * 3 + 2];
        const dr = dflags[e] ? 1 : 0;
        to[fill[a]] = b; cost[fill[a]] = w; drivable[fill[a]] = dr; eid[fill[a]++] = e;
        to[fill[b]] = a; cost[fill[b]] = w; drivable[fill[b]] = dr; eid[fill[b]++] = e;
      }
      // A node is a valid start or end for a drive only if a road reaches it.
      const nodeDrivable = new Uint8Array(n);
      for (let v = 0; v < n; v++)
        for (let e = start[v]; e < start[v + 1]; e++)
          if (drivable[e]) { nodeDrivable[v] = 1; break; }

      G = { n, lat, lon, start, to, cost, eid, drivable, nodeDrivable,
            geomIx: d.geomIx, geom: d.geom, q, lat0, lon0,
            edges: d.edges };

      grid = new Map();
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(lat[i] / CELL)},${Math.round(lon[i] / CELL)}`;
        let b = grid.get(k);
        if (!b) grid.set(k, b = []);
        b.push(i);
      }
      return G;
    })();
    return loading;
  }

  const ready = () => !!G;

  /* ---------- snapping ---------- */
  function nearestNode(la, lo, maxM, needDrivable) {
    if (!G) return -1;
    const ci = Math.round(la / CELL), cj = Math.round(lo / CELL);
    let best = -1, bd = Infinity;
    // Driving snaps to the nearest road, which can be further away than the
    // nearest pavement, so the search ring is allowed to widen.
    const rings = needDrivable ? 5 : 3;
    for (let r = 0; r <= rings && best < 0; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (r && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
          for (const k of (grid.get(`${i},${j}`) || [])) {
            if (needDrivable && !G.nodeDrivable[k]) continue;
            const d = metres(la, lo, G.lat[k], G.lon[k]);
            if (d < bd) { bd = d; best = k; }
          }
        }
      }
    }
    return bd <= (maxM || (needDrivable ? 400 : 250)) ? best : -1;
  }

  /* ---------- A* ----------
     A binary heap rather than a sorted array: with ~40k junctions and several
     routes per apartment, the difference is the whole frame budget. */
  /* `mode` is "walk" (default) or "drive". Anything else -- a bus, a train --
     is not routable here and callers get null, because a pedestrian network
     cannot answer a transit question and guessing is the failure mode this
     replaced. */
  const SPEED = { walk: 78, drive: 330 };          // metres per minute

  function route(fromLa, fromLo, toLa, toLo, mode) {
    if (!G) return null;
    mode = mode === "drive" ? "drive" : "walk";
    if (!SPEED[mode]) return null;
    const needDrive = mode === "drive";
    const s = nearestNode(fromLa, fromLo, null, needDrive);
    const t = nearestNode(toLa, toLo, null, needDrive);
    if (s < 0 || t < 0) return null;
    if (s === t) return { metres: 0, mins: 1, mode,
                          points: [[fromLa, fromLo], [toLa, toLo]] };

    const n = G.n;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevEdge = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const h = (i) => metres(G.lat[i], G.lon[i], G.lat[t], G.lon[t]);

    const heap = [];                       // [f, node]
    const push = (f, v) => {
      heap.push([f, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };

    dist[s] = 0; push(h(s), s);
    let guard = 0;
    while (heap.length) {
      const [, v] = pop();
      if (done[v]) continue;
      done[v] = 1;
      if (v === t) break;
      if (++guard > 250000) return null;              // pathological input
      for (let e = G.start[v]; e < G.start[v + 1]; e++) {
        if (needDrive && !G.drivable[e]) continue;
        const w = G.to[e], nd = dist[v] + G.cost[e];
        if (nd < dist[w]) {
          dist[w] = nd; prev[w] = v; prevEdge[w] = e;
          push(nd + h(w), w);
        }
      }
    }
    if (dist[t] === Infinity) return null;

    // Walk the chain back, stitching each edge's stored shape in the right
    // direction so the drawn line follows the street rather than cutting the
    // corner between junctions.
    const chain = [];
    for (let v = t; v !== -1 && v !== s; v = prev[v]) chain.push(v);
    chain.push(s);
    chain.reverse();

    const pts = [[fromLa, fromLo]];
    for (let i = 1; i < chain.length; i++) {
      const v = chain[i], e = prevEdge[v];
      const id = G.eid[e];
      const a = G.edges[id * 3];
      const from = chain[i - 1];
      const g0 = G.geomIx[id], g1 = G.geomIx[id + 1];
      const shape = [];
      for (let k = g0; k < g1; k++)
        shape.push([(G.geom[k * 2] + G.lat0) * G.q, (G.geom[k * 2 + 1] + G.lon0) * G.q]);
      if (from !== a) shape.reverse();               // traversing it backwards
      pts.push(...shape, [G.lat[v], G.lon[v]]);
    }
    pts.push([toLa, toLo]);

    // Add the walk from the door to the network and from the network to the
    // door: honest, and usually a few metres.
    const tail = metres(fromLa, fromLo, G.lat[s], G.lon[s]) +
                 metres(toLa, toLo, G.lat[t], G.lon[t]);
    const total = dist[t] + tail;
    return { metres: Math.round(total), mode,
             mins: Math.max(1, Math.round(total / SPEED[mode])), points: pts };
  }

  return { load, ready, route, nearestNode };
})();
