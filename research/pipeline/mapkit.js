/* mapkit.js — the drawing surface underneath the visual answer canvas.
   ============================================================
   This is a map only some of the time. The right-hand panel answers whichever
   question the renter is holding, and four of the five answers are not "where
   is it" — they are "how loud", "how rough", "what would I pay", "what do
   people say". So this file exposes a projection, a tile layer and a heat
   layer, and lets canvas.js compose them per question rather than owning a
   single fixed map widget.

   Mercator, tile fetching and additive heat accumulation are the same
   arithmetic app.js uses; the parts that differ are the ones that matter here:
   a camera that eases between framings instead of jumping, and a dimming pass
   so route lines and noise blooms sit on a quiet basemap rather than fighting
   a full-colour one. */

const MK = (() => {
  "use strict";

  const TILE = 256;
  const RETINA = (devicePixelRatio || 1) > 1.3 ? "@2x" : "";
  // Voyager is the calmest of the free Carto styles: low-saturation roads, no
  // POI clutter competing with the endpoints we draw on top.
  const TILE_URL = (z, x, y) =>
    `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}${RETINA}.png`;

  const dark = () => getComputedStyle(document.documentElement)
    .getPropertyValue("color-scheme").trim() === "dark";

  let cvs = null, cx = null;
  let W = 0, H = 0;
  // camera
  let lat = 37.7825, lon = -122.4143, zoom = 14.4;

  /* ---------- projection ---------- */
  const scaleN = () => TILE * Math.pow(2, zoom);
  const worldX = (lo) => (lo + 180) / 360 * scaleN();
  const worldY = (la) => {
    const s = Math.sin(la * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scaleN();
  };
  // unit-mercator y, independent of zoom — used when solving for a zoom level
  const unitY = (la) => {
    const s = Math.sin(la * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };
  // …and the way back, which panning and pointer-anchored zoom both need.
  const lonAt = (x) => x / scaleN() * 360 - 180;
  const latAt = (y) => {
    const n = Math.PI - 2 * Math.PI * y / scaleN();
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };
  function proj(la, lo) {
    return [worldX(lo) - worldX(lon) + W / 2, worldY(la) - worldY(lat) + H / 2];
  }

  /* ---------- tiles ---------- */
  /* A failed tile used to be cached as failed forever, which is how a map ends
     up permanently blank. The page opens ~75 image requests at once — sixty
     filmstrip thumbnails, the hero, and a grid of tiles — and under that burst
     a handful of connections drop. Measured on a cold load: 48 of 61 images
     never completed, while the very same URLs fetched fine a second later.

     So a miss is retried with backoff rather than remembered. Three attempts,
     widening, then it gives up quietly and the parent-tile fallback covers the
     hole. `_bad` is now a timestamp, not a verdict. */
  const tiles = new Map();
  let onTile = () => {};
  const RETRIES = 3;

  function load(img, z, x, y) {
    img._ok = false;
    img.crossOrigin = "anonymous";
    img.onload = () => { img._ok = true; onTile(); };
    img.onerror = () => {
      img._tries = (img._tries || 0) + 1;
      if (img._tries > RETRIES) { img._dead = true; return; }
      // 400ms, 900ms, 1900ms — long enough for a burst to clear.
      setTimeout(() => load(img, z, x, y), 400 + img._tries * 500);
    };
    // Cache-busting on retry only: a plain re-assign of the same src can be
    // served straight from the browser's failed-request cache.
    img.src = TILE_URL(z, x, y) + (img._tries ? `?r=${img._tries}` : "");
  }

  function getTile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    if (tiles.has(k)) return tiles.get(k);
    const img = new Image();
    load(img, z, x, y);
    tiles.set(k, img);
    if (tiles.size > 700) {
      for (const key of tiles.keys()) { tiles.delete(key); if (tiles.size <= 560) break; }
    }
    return img;
  }

  /* `fade` lets a view sit the basemap back so the layer above it reads. At 0
     the map is untouched; at 1 it is nearly paper. Drawing a translucent wash
     over the tiles is cheaper and more predictable than a CSS filter, which
     would also wash out everything we draw afterwards. */
  /* Switching tabs re-frames the camera, which asks for a zoom level whose
     tiles are not in the cache yet — and a panel that answers "is it quiet"
     with two seconds of blank grey has not answered anything. So a tile that
     is not ready falls back to the matching quarter of its parent: blurrier
     for a moment, never empty. */
  function drawParent(z, x, y, dx, dy, size) {
    for (let dz = 1; dz <= 5; dz++) {
      const pz = z - dz;
      if (pz < 1) return false;
      const img = tiles.get(`${pz}/${x >> dz}/${y >> dz}`);
      if (!img || !img._ok) continue;
      const span = 1 << dz;                       // parent covers span² children
      const src = img.naturalWidth / span;
      cx.drawImage(img, (x % span) * src, (y % span) * src, src, src,
                        dx, dy, size + 1, size + 1);
      return true;
    }
    return false;
  }

  function drawBasemap(fade) {
    const z = Math.max(1, Math.min(19, Math.round(zoom)));
    const n = Math.pow(2, z);
    const size = TILE * (scaleN() / (TILE * n));
    const ox = worldX(lon) - W / 2, oy = worldY(lat) - H / 2;
    const x0 = Math.floor(ox / size), x1 = Math.floor((ox + W) / size);
    const y0 = Math.floor(oy / size), y1 = Math.floor((oy + H) / size);
    /* Carto publishes no free dark Voyager raster, so the light tiles are
       inverted on the way in. invert + hue-rotate(180°) is the standard trick
       and the only one that works: it flips the luminance while putting the
       hues back where they started, so parks stay green and water stays blue.
       Inverting afterwards with a composite operation — which is what the
       first attempt did — also inverts the routes and heat drawn on top, and
       turns the whole panel into a blue-and-green mess. */
    const night = dark();
    if (night) cx.filter = "invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.75)";
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        const tx = ((x % n) + n) % n;
        const img = getTile(z, tx, y);
        const dx = x * size - ox, dy = y * size - oy;
        if (img._ok) cx.drawImage(img, dx, dy, size + 1, size + 1);
        else drawParent(z, tx, y, dx, dy, size);
      }
    }
    if (night) cx.filter = "none";
    if (fade > 0) {
      // The wash colour follows the theme, so the basemap sinks into a dark
      // page instead of glowing on it. --map-fade is set by both theme blocks.
      const wash = getComputedStyle(document.documentElement)
        .getPropertyValue("--map-fade").trim() || "#FBFAF8";
      cx.save();
      cx.globalAlpha = fade;
      cx.fillStyle = wash;
      cx.fillRect(0, 0, W, H);
      cx.restore();
    }
  }

  /* ---------- heat ---------- */
  /* Additive density into an offscreen buffer, then recoloured through a ramp.
     Normalising against p92 rather than the maximum is what keeps a typical
     block visible instead of leaving everything but a few hot cells at an
     invisible alpha. */
  const buf = document.createElement("canvas");
  const normCache = new Map();

  function pctl(cells, key, p) {
    const k = key + "|" + p;
    if (!normCache.has(k)) {
      const v = cells.map((c) => c[2]).sort((a, b) => a - b);
      normCache.set(k, v[Math.floor(v.length * p)] || 1);
    }
    return normCache.get(k);
  }

  function drawHeat(cells, key, ramp, alpha) {
    // The panel collapses to zero height on the tabs that are not maps, and a
    // frame can still be in flight when it does. getImageData throws on a
    // zero-height source, which took the whole render loop down.
    if (W < 2 || H < 2) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    buf.width = W * d; buf.height = H * d;
    const h = buf.getContext("2d");
    h.setTransform(d, 0, 0, d, 0, 0);
    const norm = pctl(cells, key, 0.92);
    const cellPx = Math.abs(worldY(lat) - worldY(lat + 0.0011));
    const r = Math.max(7, cellPx * 1.05);
    h.globalCompositeOperation = "lighter";
    for (const [la, lo, cnt] of cells) {
      const q = proj(la, lo);
      if (q[0] < -r || q[0] > W + r || q[1] < -r || q[1] > H + r) continue;
      const t = Math.min(1, cnt / norm);
      const g = h.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
      g.addColorStop(0, `rgba(0,0,0,${0.5 * Math.pow(t, 0.7)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      h.fillStyle = g; h.beginPath(); h.arc(q[0], q[1], r, 0, 7); h.fill();
    }
    const img = h.getImageData(0, 0, buf.width, buf.height), px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const t = px[i + 3] / 255;
      if (t < 0.05) { px[i + 3] = 0; continue; }
      const u = Math.min(0.999, t) * (ramp.length - 1);
      const j = Math.floor(u), f = u - j;
      const c0 = ramp[j], c1 = ramp[Math.min(ramp.length - 1, j + 1)];
      px[i] = c0[0] + (c1[0] - c0[0]) * f;
      px[i + 1] = c0[1] + (c1[1] - c0[1]) * f;
      px[i + 2] = c0[2] + (c1[2] - c0[2]) * f;
      px[i + 3] = Math.min(255, Math.pow(t, 0.75) * 250);
    }
    h.putImageData(img, 0, 0);
    cx.globalAlpha = alpha == null ? 0.85 : alpha;
    cx.drawImage(buf, 0, 0, W, H);
    cx.globalAlpha = 1;
  }

  /* ---------- camera ---------- */
  /* Switching tabs re-frames the map. Cutting straight to the new framing lost
     people — the same streets at a different scale read as a different city. An
     eased fly-over is the 200-400ms transition the rest of the interface uses,
     applied to the one element that would otherwise teleport. */
  let flying = null;
  const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function frame(points, pad) {
    if (!points.length) return { lat, lon, zoom };
    let north = -90, south = 90, west = 180, east = -180;
    for (const [la, lo] of points) {
      north = Math.max(north, la); south = Math.min(south, la);
      west = Math.min(west, lo); east = Math.max(east, lo);
    }
    const p = pad || { x: 150, y: 120 };
    const dx = Math.max(2e-5, (east - west) / 360);
    const dy = Math.max(2e-5, Math.abs(unitY(south) - unitY(north)));
    const zx = Math.log2(Math.max(80, W - p.x) / (TILE * dx));
    const zy = Math.log2(Math.max(80, H - p.y) / (TILE * dy));
    return {
      lat: (north + south) / 2, lon: (west + east) / 2,
      zoom: Math.max(10.5, Math.min(16.8, Math.min(zx, zy))),
    };
  }

  function flyTo(target, ms, tick) {
    const from = { lat, lon, zoom };
    // A move of a block or two is not worth animating; it reads as drift.
    const tiny = Math.abs(target.lat - lat) < 3e-4 &&
                 Math.abs(target.lon - lon) < 3e-4 &&
                 Math.abs(target.zoom - zoom) < 0.05;
    const still = window.matchMedia &&
                  matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (tiny || still || ms <= 0 || document.hidden) {
      lat = target.lat; lon = target.lon; zoom = target.zoom;
      flying = null; tick && tick(1);
      return;
    }
    const t0 = performance.now();
    flying = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = easeInOut(t);
      lat = from.lat + (target.lat - from.lat) * e;
      lon = from.lon + (target.lon - from.lon) * e;
      zoom = from.zoom + (target.zoom - from.zoom) * e;
      if (t >= 1) flying = null;
      tick && tick(t);
      return t < 1;
    };
  }

  function jumpTo(t) { lat = t.lat; lon = t.lon; zoom = t.zoom; flying = null; }

  /* ---------- direct manipulation ----------
     A map you cannot move is a picture of a map. Every question this panel
     answers — how rough is the next block over, where does the noise stop —
     is a question about somewhere slightly off-centre, and the only honest
     answer to it is "drag and see".

     Any gesture cancels an in-flight fly-over. Being yanked toward a
     destination you just steered away from is the most annoying bug a map can
     have. */
  const ZMIN = 10.5, ZMAX = 18;
  let dragging = false, moved = false, lastX = 0, lastY = 0;

  function unproject(px, py) {
    return { lat: latAt(py - H / 2 + worldY(lat)), lon: lonAt(px - W / 2 + worldX(lon)) };
  }

  function panBy(dx, dy) {
    flying = null;
    lon = lonAt(worldX(lon) - dx);
    lat = latAt(worldY(lat) - dy);
    request();
  }

  // Zoom about the pointer, so the street under the cursor stays under it.
  function zoomAround(dz, px, py) {
    flying = null;
    const before = unproject(px, py);
    zoom = Math.max(ZMIN, Math.min(ZMAX, zoom + dz));
    const after = unproject(px, py);
    lat += before.lat - after.lat;
    lon += before.lon - after.lon;
    request();
  }

  function bindGestures() {
    cvs.style.touchAction = "none";
    cvs.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      // Throws for a pointer id the browser does not consider active, which
      // synthetic events and some pen hardware produce. Capture is a nicety —
      // losing it must not take the drag down with it.
      try { cvs.setPointerCapture(e.pointerId); } catch {}
      cvs.style.cursor = "grabbing";
    });
    cvs.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      lastX = e.clientX; lastY = e.clientY;
      panBy(dx, dy);
    });
    const end = (e) => {
      dragging = false;
      cvs.style.cursor = "grab";
      try { cvs.releasePointerCapture(e.pointerId); } catch {}
    };
    cvs.addEventListener("pointerup", end);
    cvs.addEventListener("pointercancel", end);
    cvs.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cvs.getBoundingClientRect();
      // Trackpads report small deltas continuously; a wheel reports ~100 a
      // notch. Clamping keeps both feeling like the same gesture.
      const dz = Math.max(-0.6, Math.min(0.6, -e.deltaY * 0.004));
      zoomAround(dz, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cvs.style.cursor = "grab";
  }

  /* ---------- frame loop ---------- */
  /* One loop, one owner. Every view is a function of (camera, phase), so views
     never schedule their own frames — they say what they want drawn and this
     decides whether another frame is owed. */
  let painter = () => {}, running = false, wake = 0;
  function paint(now) {
    running = false;
    let more = false;
    if (flying) more = flying(now) || more;
    const r = painter(now);
    if (r === true) more = true;
    if (more || now < wake) request();
  }
  function request() {
    if (running) return;
    running = true;
    requestAnimationFrame(paint);
  }

  /* The parent-tile fallback only helps if a parent exists, and on a cold load
     nothing does. Eleven tiles at z11–z12 cover the whole city for about 60kB
     and guarantee every later view has something to fall back to. */
  function warm() {
    const box = { w: -122.55, e: -122.34, s: 37.69, n: 37.84 };
    for (const z of [11, 12]) {
      const n = Math.pow(2, z);
      const tx = (lo) => Math.floor((lo + 180) / 360 * n);
      const ty = (la) => {
        const s = Math.sin(la * Math.PI / 180);
        return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
      };
      for (let x = tx(box.w); x <= tx(box.e); x++)
        for (let y = ty(box.n); y <= ty(box.s); y++) getTile(z, x, y);
    }
  }

  function attach(canvas, drawFn) {
    cvs = canvas; cx = cvs.getContext("2d");
    painter = drawFn;
    onTile = request;
    resize();
    warm();
    bindGestures();
    new ResizeObserver(() => { resize(); request(); }).observe(cvs);
  }

  function resize() {
    const r = cvs.getBoundingClientRect();
    const d = Math.min(devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    cvs.width = Math.round(W * d); cvs.height = Math.round(H * d);
    cx.setTransform(d, 0, 0, d, 0, 0);
  }

  return {
    attach, request, resize,
    get ctx() { return cx; },
    get w() { return W; }, get h() { return H; },
    get zoom() { return zoom; },
    get busy() { return !!flying; },
    proj, frame, flyTo, jumpTo, drawBasemap, drawHeat, panBy, zoomAround,
    // True when the last pointer sequence was a drag rather than a click, so
    // callers can ignore the click that ends a pan.
    get dragged() { return moved; },
    clear() { cx.clearRect(0, 0, W, H); },
    // Lets a view hold the loop open for a fixed stretch (an animation with no
    // per-frame predicate of its own) without owning a timer.
    keepAwake(ms) { wake = Math.max(wake, performance.now() + ms); request(); },
  };
})();
