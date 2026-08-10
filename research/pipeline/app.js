const n = v => (v == null ? "—" : v.toLocaleString("en-US"));
const money = v => v == null ? "—" : "$" + v.toLocaleString("en-US");
const cl = (v,a,b) => Math.max(a, Math.min(b, v));
const hrTxt = h => h == null ? "—" : `${h%12===0?12:h%12} ${h<12?"AM":"PM"}`;
const bedTxt = b => b == null ? "—" : b === 0 ? "Studio" : `${b} bd`;
const srcTxt = src => src.map(s => s.c > 1 ? `${s.n} (${s.c} ads)` : s.n).join(" + ");

const IC = {
  star:'<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8Z"/></svg>',
  moon:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z"/></svg>',
  glass:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4h14l-6 7v7M9 21h6"/></svg>',
  shield:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  warn:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 8v5M12 16.5v.4"/><circle cx="12" cy="12" r="9"/></svg>',
  ext:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>',
  spark:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8Z"/></svg>',
  eye:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.4"/><path d="m4 4 16 16"/></svg>',
  down:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v13M6 13l6 6 6-6"/></svg>',
  clock:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  heart:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.6-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6C19 15.4 12 20 12 20Z"/></svg>',
};


/* ============================================================
   SEARCH MEMORY — real, stored in this browser.
   Nothing here is seeded: an apartment is "new to you" because
   you genuinely have not opened this page with it in the list before.
   ============================================================ */
const MEM_KEY = "huntly.memory.v1";
const MEM = (() => {
  try { return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; }
  catch { return {}; }
})();
function saveMem(){ try { localStorage.setItem(MEM_KEY, JSON.stringify(MEM)); } catch {} }
const today = () => new Date().toISOString().slice(0,10);
const daysSince = d => Math.max(0, Math.round((Date.now() - new Date(d)) / 864e5));

let firstRun = Object.keys(MEM).length === 0;

/* Record what this run saw, and detect genuine changes since last time. */
function syncMemory(){
  const now = today();
  for (const a of A){
    const m = MEM[a.id];
    if (!m){
      MEM[a.id] = { first: now, last: now, rent: a.rent, seen: 1 };
      a.mem = { state: "New to you" };
    } else {
      const drop = m.rent && a.rent < m.rent ? m.rent - a.rent : 0;
      const rise = m.rent && a.rent > m.rent ? a.rent - m.rent : 0;
      a.mem = {
        state: m.passed ? "You passed before"
             : m.contacted ? "Waiting on reply"
             : m.saved ? "Saved"
             : drop ? "Price drop" : "You've seen this before",
        first: m.first, days: daysSince(m.first), drop, rise,
        reason: m.reason || null, seen: (m.seen || 1) + 1,
      };
      m.last = now; m.seen = (m.seen || 1) + 1;
      if (drop || rise) m.prevRent = m.rent;
      m.rent = a.rent;
    }
    if (MEM[a.id].saved) saved.add(a.id);
  }
  saveMem();
}

function stateOf(a){ return (a.mem && a.mem.state) || "New to you"; }
// A chip should earn its place. "Seen before" on everything is wallpaper.
const NOTABLE = new Set(["New to you","Price drop","You passed before","Saved",
                         "Waiting on reply"]);
function chipFor(a){ const st = stateOf(a); return NOTABLE.has(st) ? st : null; }
function memNote(a){
  const m = a.mem || {};
  if (m.state === "You passed before" && m.reason) return `You passed before: ${m.reason}`;
  if (m.state === "Price drop") return `Down $${m.drop} since you last looked`;

  if (m.state === "Waiting on reply") return `You marked this contacted`;
  return null;
}
function markMem(id, patch){
  MEM[id] = Object.assign(MEM[id] || { first: today(), seen: 1 }, patch);
  saveMem();
  const a = A.find(x => x.id === id);
  if (a) a.mem = Object.assign(a.mem || {}, {
    state: patch.passed ? "You passed before"
         : patch.contacted ? "Waiting on reply"
         : patch.saved ? "Saved" : (a.mem && a.mem.state),
    reason: patch.reason || (a.mem && a.mem.reason),
  });
  render();
}


/* ============================================================
   OWNER LOOKUP — on demand only.
   The key lives in serve.py, never in this file. The monthly cap is
   enforced server-side so a bug here cannot run up an overage bill.
   ============================================================ */
const ownerCache = {};
let quota = null;

async function refreshQuota(){
  try { quota = await (await fetch("/api/quota")).json(); } catch { quota = null; }
  return quota;
}
function quotaLine(){
  if (!quota) return "";
  return `${quota.left} of ${quota.cap} owner lookups left this month`;
}
async function lookupOwner(id, addr){
  const box = document.getElementById("ownerbox");
  if (box) box.innerHTML = `<p style="font-size:14px;color:var(--ink-2)">Looking up the deed…</p>`;
  let r;
  try {
    r = await (await fetch("/api/owner?addr=" + encodeURIComponent(addr))).json();
  } catch {
    if (box) box.innerHTML = `<p style="font-size:14px;color:var(--or)">
      Couldn't reach the local server. Start it with
      <code>python3 research/serve.py</code>.</p>`;
    return;
  }
  ownerCache[id] = r;
  await refreshQuota();
  renderOwner(id, r);
}
function renderOwner(id, r){
  const box = document.getElementById("ownerbox");
  if (!box) return;
  if (r.error){
    box.innerHTML = `<p style="font-size:14px;color:var(--or)">${r.error}${
      r.note ? ` — ${r.note}` : ""}</p>`;
    return;
  }
  const a = A.find(x => x.id === id);
  const op = a && a.landlord ? a.landlord.name : null;
  if (!r.found){
    box.innerHTML = `<p style="font-size:14px;color:var(--ink-2)">
      No owner name on record for this address. Coverage is patchy in California —
      about half of SF addresses come back blank.</p>
      <p style="font-size:12px;color:var(--ink-3);margin-top:8px">
      RentCast · ${r.cached ? "cached, no request used" : "1 request used"} · ${quotaLine()}</p>`;
    return;
  }
  const names = r.names.join(", ");
  // Compare on shared name tokens, not a prefix — "Jeff" and "JEFFREY" are the
  // same person, and a prefix test says they aren't.
  const toks = x => new Set((x||"").toLowerCase().replace(/[^a-z ]/g," ")
    .split(/\s+/).filter(t => t.length > 2 &&
      !["llc","inc","lp","the","and","co","corp","trust","company","etal"].includes(t)));
  const shared = op ? [...toks(names)].filter(t => toks(op).has(t)) : [];
  const same = shared.length > 0;
  // Mail arriving at the building itself is the strongest owner-occupancy signal.
  const atBuilding = r.ownerOccupied === true ||
    (r.mail && a && r.mail.toLowerCase().startsWith((a.addr||"").toLowerCase().slice(0,10)));

  let verdict;
  if (same && atBuilding) verdict = `The deed and the registered operator are the same
    party, and mail goes to the building itself. <b>Owner-occupied</b> — you'd be dealing
    with the owner directly.`;
  else if (same) verdict = `The deed and the registered operator are the same party.
    <b>Owner-operated</b> — repairs go to the person who owns the building.`;
  else if (!op && atBuilding) verdict = `No management company is registered here and mail
    goes to the building. <b>Likely owner-occupied</b> — a small landlord living on site.`;
  else if (!op) verdict = `No business is registered to operate here. For a building this
    size that's normal — SF only requires registration at 4+ units.`;
  else verdict = `The deed says <b>${names}</b>, but <b>${op}</b> is registered to operate
    here. Those look like different parties, which usually means professional management:
    your day-to-day contact would be the manager, not the owner.`;
  box.innerHTML = `
    <p style="font-size:17px;font-weight:650">${names}</p>
    <p style="font-size:13.5px;color:var(--ink-2);margin-top:3px">
      Owner of record${r.type ? ` · ${r.type}` : ""}${
      r.lastSale ? ` · last sold ${r.lastSale}` : ""}</p>
    ${r.mail ? `<p style="font-size:13.5px;color:var(--ink-2);margin-top:7px">
      Mail goes to <b>${r.mail}</b>${
      r.ownerOccupied ? "" : " — not the building itself, so the owner lives elsewhere."}</p>` : ""}
    <div class="recbox" style="margin-top:11px">${verdict}</div>
    <p style="font-size:12px;color:var(--ink-3);margin-top:9px">
      RentCast · ${r.cached ? "cached, no request used" : "1 request used"} · ${quotaLine()}</p>`;
}

/* ---------- state ---------- */
let F = { q:"", pmin:null, pmax:null, beds:new Set(), baths:new Set(),
          more:new Set(), src:new Set(), showActual:false };
/* `sel` drives the big card at the top of the list. It used to default to
   A[0] -- the first row of the raw data file, in scrape order -- so the hero
   slot went to an arbitrary listing while the actual #1 was demoted to a small
   card underneath it. In the worst case that arbitrary listing was one that
   breached a hard constraint, so the page led with "Outside what you said you'd
   accept" above the best match.

   It now follows the ranking unless you deliberately pick something, which is
   what `selPinned` records. Clicking a card or a map pin pins it; changing the
   filters, the sort or your answers unpins, because the thing you chose is no
   longer necessarily in front of you. */
let sel = null, selPinned = false;
let saved = new Set();

const chipClass = s => ({
  "New to you":"c-new", "You've seen this before":"c-seen",
  "Price drop":"c-drop", "You passed before":"c-pass",
  "Saved":"c-save", "Waiting on reply":"c-save"
}[s] || "c-seen");

function trust(a){
  const lv = a.trust ? a.trust.level : "medium";
  const nw = a.trust ? a.trust.warn.length : 0;
  if (lv === "high")   return { t:"Checks out", s:"Address & landlord verified", cls:"ok" };
  if (lv === "low")    return { t:"Verify first", s:`${nw} things don't add up`, cls:"warn" };
  return { t:"Partly verified", s:`${nw} thing${nw===1?"":"s"} to check`, cls:"dim" };
}
function actTxt(a){
  const [lo,hi] = a.act;
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi).replace("$","")}`;
}
function whyWorth(a){
  const bits = [];
  if (a.rating && a.rating >= 4 && (a.rating_n||0) >= 10)
    bits.push(`${a.rating}/5 across ${a.rating_n} Google reviews`);
  const bn = barsNear(a);
  if (nightScore(a) <= NIGHT_QUIET) bits.push("the block is quiet after dark");
  else if (bn >= 20) bits.push(`${bn} bars and clubs are within a ten-minute walk`);
  if (a.rc === "yes") bits.push("the building looks rent-controlled");
  if (a.over_year > 5) bits.push(`${a.over_year} violations here took over a year to fix`);
  else if (a.novs === 0) bits.push("no violations on the building's record");
  if (!bits.length) bits.push("nothing unusual came back on the building record");
  return bits.slice(0,3).join(", ") + ".";
}

/* ---------- filtering ---------- */
function pass(a){
  if (F.pmin && a.rent < F.pmin) return false;
  if (F.pmax && a.rent > F.pmax) return false;
  if (F.beds.size && !F.beds.has(a.beds === 0 ? 0 : (a.beds ?? -1))) return false;
  if (F.baths.size){
    const b = parseFloat(a.baths) || 0;
    if (![...F.baths].some(x => b >= x)) return false;
  }
  if (F.more.has("rc") && a.rc !== "yes") return false;
  if (F.more.has("quiet")  && nightScore(a) > NIGHT_QUIET) return false;
  if (F.more.has("lively") && nightScore(a) < NIGHT_LIVELY) return false;
  if (F.more.has("clean") && a.novs > 0) return false;
  if (F.more.has("rated") && !a.rating) return false;
  if (F.more.has("multi") && !a.multi) return false;
  if (F.more.has("newonly") && stateOf(a) !== "New to you") return false;
  if (F.more.has("trusted") && (!a.trust || a.trust.level !== "high")) return false;
  if (F.more.has("landlord") && !a.landlord) return false;
  // Verified down, or a live building with nothing to rent. Both are dead ends
  // for a renter, so they stay out unless asked for. See add_availability.py.
  if (!F.more.has("gone") && (a.avail === "gone" || a.avail === "no_units")) return false;
  if (!F.more.has("rooms") && a.shared) return false;
  if (F.src.size && !a.src.some(s => F.src.has(s.n))) return false;
  if (F.q){
    const s = (a.addr + " " + (a.hood||"") + " " + (a.name||"")).toLowerCase();
    if (!s.includes(F.q.toLowerCase())) return false;
  }
  return true;
}
let view = "search";
function inView(a){
  if (view === "saved")  return saved.has(a.id);
  if (view === "hunt")   return saved.has(a.id) || (MEM[a.id] &&
                                (MEM[a.id].contacted || MEM[a.id].passed));
  if (view === "tours")  return MEM[a.id] && MEM[a.id].contacted;
  if (view === "reviews") return !!a.rating;
  return true;
}
/* ============================================================
   MATCH SCORE

   The preference-free fallback, used only before someone has answered the quiz.
   It says "is this a decent place" -- not "is this right for you", which is what
   the fit score in life.js is for.

   These weights used to be seven sliders in the sort menu. They came out because
   they were the wrong question asked the wrong way: nobody can say what
   "reviews: 2" means against "crime: 1", the numbers carried no units, they
   reset on every reload because W was never persisted, and they drove a second
   ranking that openly disagreed with the one the quiz produces. Four questions
   about your life collect the same information in a form a person can answer.

   Encampment stays at zero. Those reports measure who calls 311 as much as what
   is on the street, and ranking homes down for them would bake that in quietly.
   ============================================================ */
const W = { value:2, reviews:2, building:2, crime:1, quiet:0, rc:1, encampment:0 };
let SORT = "match";   // becomes "fit" once the quiz is filled in

// A 5.0 from one reviewer is not better than a 4.3 from two hundred. Pull every
// rating toward the overall average in proportion to how thin its evidence is.
const RATING_PRIOR = 10;
let _gm = null;
function globalMean(){
  if (_gm === null){
    const r = A.filter(a => a.rating);
    _gm = r.length ? r.reduce((s,a)=>s+a.rating,0)/r.length : 3.8;
  }
  return _gm;
}
function shrunkRating(a){
  if (!a.rating) return null;
  const n = a.rating_n || 0, m = globalMean();
  return (a.rating * n + m * RATING_PRIOR) / (n + RATING_PRIOR);
}

// rent percentile among listings with the same bed count — cheap is good
let _rentBands = null;
function rentPct(a){
  if (!_rentBands){
    _rentBands = {};
    for (const x of A){
      const k = x.beds ?? -1;
      (_rentBands[k] = _rentBands[k] || []).push(x.rent);
    }
    for (const k in _rentBands) _rentBands[k].sort((p,q)=>p-q);
  }
  const arr = _rentBands[a.beds ?? -1] || [];
  if (arr.length < 4) return 0.5;
  let lo = 0, hi = arr.length;
  while (lo < hi){ const mid = (lo+hi)>>1; arr[mid] < a.rent ? lo = mid+1 : hi = mid; }
  return 1 - lo/arr.length;                 // cheaper => closer to 1
}

/* Every percentile shown or sorted on has to be the one the score actually used.
   life.js corrects these for how many reports sit behind them -- a block with
   almost nothing on file is a blank page, not a safe street -- and without this
   the drawer cheerfully said "calmer than 100% of listings" about an address the
   ranking had just marked down for exactly that reason. */
const spct = (a, k) => window.LIFE_READY ? streetPct(a, k) : (a.street_pct || {})[k];

/* Nightlife, from the same OSM index the fit score uses.

   This page used to run on `a.venues` -- SF entertainment permits -- and the
   permits do not mean what their names suggest: "Extended Hours Premises" is
   held by Silvercrest Donuts and The Mosser Hotel as readily as by a club (see
   add_places.py). The two only correlate at 0.82, and 76 listings have zero
   permits with eight or more real bars inside a ten-minute walk -- precisely
   the blocks the "Quiet at night" filter was calling quiet.

   Keeping both meant one card could read "72 bars, 6 clubs" from OSM directly
   above "28 permitted venues within 400m" from the permits, and the "Good for
   going out" filter could hide a listing the fit score had just ranked first for
   nightlife. One signal now; the permits survive only as `late`, which is the
   one thing OSM can't say.

   Guarded: app.js renders once before life.js has built its place index. */
function barsNear(a){
  return window.LIFE_READY ? countWithin(a, "bar", 800) + countWithin(a, "club", 800) : 0;
}

/* The filters run on the score itself, not on a raw count sitting beside it.

   Counting bars and cutting at p75 looked equivalent and wasn't: the ranker's
   top nightlife pick had 36 bars against a cutoff of 37, so "Good for going
   out" hid the listing the ranking had just put first. Two numbers describing
   one idea will always find a boundary to disagree on. Sharing
   nightlifeScore() means the filter can only differ from the ranking about
   *where* the line sits, never about which direction is better. */
const nightScore = a => window.LIFE_READY ? nightlifeScore(a) : 0;
const NIGHT_QUIET = 0.18, NIGHT_LIVELY = 0.42;

function parts(a){
  const p = {};
  p.value = rentPct(a);
  const sr = shrunkRating(a);
  p.reviews = sr === null ? null : cl((sr - 2.5) / 2.0, 0, 1);
  if (a.parcel_ok){
    const perUnit = (a.novs || 0) / Math.max(1, a.units || 1);
    let b = 1 - cl(perUnit / 1.5, 0, 1);
    b -= cl((a.active || 0) / 8, 0, 0.25);
    b -= cl((a.over_year || 0) / 6, 0, 0.25);
    if (a.referred > 0) b -= 0.15;
    p.building = cl(b, 0, 1);
  } else p.building = null;
  const br = spct(a, "break_in"), vi = spct(a, "violent"), en = spct(a, "encampment");
  p.crime = br == null ? null : 1 - ((br + (vi ?? br)) / 2) / 100;
  p.encampment = en == null ? null : 1 - en / 100;
  p.quiet = 1 - cl(barsNear(a) / 45, 0, 1);
  p.rc = a.rc === "yes" ? 1 : a.rc === "no" ? 0 : 0.4;
  return p;
}

function matchScore(a){
  const p = parts(a);
  let num = 0, known = 0, total = 0;
  for (const k in W){
    if (!W[k]) continue;
    total += W[k];
    if (p[k] == null) continue;
    num += W[k] * p[k]; known += W[k];
  }
  if (!total) return { score: null, p, known: 0, total: 0 };
  // An unknown counts as average, not as bad and not as free marks. Skipping it
  // entirely let a listing with no reviews and no building record outrank a
  // documented one, because it was only ever judged on its good parts.
  const score = (num + 0.5 * (total - known)) / total;
  return { score: Math.round(score * 100), p, known, total };
}

// redFlags() reads only the listing, never the profile, so this can be cached
// for the session -- the fit sort calls it O(n log n) times per render.
const _flagCache = new Map();
function hasFlags(a){
  if (!window.LIFE_READY) return false;
  let v = _flagCache.get(a.id);
  if (v === undefined){ v = redFlags(a).length > 0; _flagCache.set(a.id, v); }
  return v;
}

const SORTS = {
  // A wall is not a weight: anything that breaks a hard constraint sinks below
  // everything that doesn't, however good the rest of it looks.
  /* Three tiers, then score. A wall is not a weight, and neither is a visible
     defect: a listing whose own text says it is a room, or that never states a
     bedroom count, or that two reviewers rated 2/5, should not lead the page
     however well it scores.

     It used to sort purely on score, which put a red-flagged listing at the top
     of the list while picks() -- which does exclude them -- offered a lower
     number as "Best overall". The page contradicted itself: 51 at the top, 49
     labelled the best. Same rule in both places now, so the hero card is the
     recommendation. Flagged listings keep their place in the list, below the
     clean ones, because they are still real options worth seeing. */
  fit: (x,y) => {
    if (!window.LIFE_READY) return 0;
    const fx = fit(x) || {}, fy = fit(y) || {};
    if (!!fx.blocked !== !!fy.blocked) return fx.blocked ? 1 : -1;
    const rx = hasFlags(x), ry = hasFlags(y);
    if (rx !== ry) return rx ? 1 : -1;
    return (fy.score ?? -1) - (fx.score ?? -1);
  },
  match:  (x,y) => (matchScore(y).score ?? -1) - (matchScore(x).score ?? -1),
  rent:   (x,y) => x.rent - y.rent,
  rating: (x,y) => (shrunkRating(y) ?? 0) - (shrunkRating(x) ?? 0),
  calm:   (x,y) => (spct(x,"break_in") ?? 100) - (spct(y,"break_in") ?? 100),
  fresh:  (x,y) => (stateOf(x)==="New to you"?0:1) - (stateOf(y)==="New to you"?0:1) || x.rank - y.rank,
};
/* Same building, different unit. Five ads for 1222 Harrison St in a row is not a
   shortlist, it's the same decision five times, and it pushed every other
   building off the first screen -- the better the ranking got, the worse this
   read, because a building that wins once tends to win with all of its units.

   Dedup can't fix it: these are genuinely different apartments at different
   rents. So the list collapses to the best-scoring unit per building and counts
   the rest on its card. The list arrives sorted, so first-seen is best-seen. */
function collapseBuildings(list){
  if (F.more.has("allunits")) return list;
  const out = [], at = new Map();
  for (const a of list){
    const k = (a.addr || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!k){ out.push(a); continue; }
    const i = at.get(k);
    if (i === undefined){ at.set(k, out.length); a._more = 0; out.push(a); }
    else out[i]._more++;
  }
  return out;
}
const visible = () => collapseBuildings(
  A.filter(a => pass(a) && inView(a)).sort(SORTS[SORT] || SORTS.match));

/* ---------- summary strip ---------- */
function strip(){
  const v = visible();
  const news = v.filter(a => stateOf(a) === "New to you").length;
  const dups = A.reduce((t,a) => t + Math.max(0, (a.n_ads || a.src.length) - 1), 0);
  const drops = v.filter(a => a.mem && a.mem.drop).length;
  const wait = v.filter(a => stateOf(a) === "Waiting on reply").length;
  const firstNote = firstRun
    ? `<p>First visit — every apartment here is new to you.<br>
       <b>Come back and we'll show only what changed.</b></p>`
    : `<p>We merge the same apartment across sites so you<br>
       <b>never process the same place twice.</b></p>`;
  /* Three of these four are structurally zero on a first visit -- price drops
     and replies need a previous visit to compare against, and "new to you" is
     just the whole list restated. A first impression made of zeroes reads as an
     empty product. So the first visit gets facts about the data instead, and
     the change-tracking metrics appear once there is a change to track. */
  // app.js renders once before life.js has run. Function declarations hoist
  // across the shared script block so lifeOn() resolves, but LIFE is still
  // undefined at that point -- guard on the same flag every other call site uses
  // rather than lean on that.
  const ready = window.LIFE_READY && lifeOn();
  const clears = ready ? v.filter(a => { const f = fit(a); return f && !f.blocked; }).length : 0;
  const petOK = v.filter(a => a.pet && a.pet.ok).length;
  const tiles = firstRun
    ? [[IC.spark, ready ? n(clears) : n(v.length), ready ? "fit your answers" : "apartments tracked"],
       [IC.eye,   n(dups),  "duplicate ads merged"],
       [IC.shield, n(v.filter(a => a.rc === "yes").length), "likely rent-controlled"],
       [IC.heart, n(petOK), "say pets are welcome"]]
    : [[IC.spark, n(news),  "new to you"],
       [IC.eye,   n(dups),  "duplicate ads merged"],
       [IC.down,  n(drops), "price drops"],
       [IC.clock, n(wait),  "waiting on replies"]];
  const cls = ["m-new","m-dup","m-drop","m-wait"];
  document.getElementById("strip").innerHTML =
    tiles.map(([ic,val,label],i) => `
    <div class="metric ${cls[i]}"><span class="ic">${ic}</span>
      <div><b>${val}</b><span>${label}</span></div></div>`).join("") + `
    <div class="stripnote"><span class="ic">${IC.shield}</span>
      ${firstNote}<a id="dupinfo">How this works</a></div>`;
  document.getElementById("dupinfo").onclick = () =>
    document.getElementById("infodlg").showModal();
}

/* ---------- cards ---------- */
function photo(a, cls){
  if (!a.photo) return `<div class="noph">No photo on the source listing</div>`;
  return `<img class="${cls||''}" src="${a.photo}" alt="" loading="lazy"
    onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('beforeend',
    '<div class=noph>Photo unavailable</div>')">`;
}
/* The headline number gets a ring, and beside it the four facts that a person
   actually repeats out loud: how far to work, to the gym, to food, and whether
   it clears the budget. Everything else is one line down. */
const TILE_IC = {
  work:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/></svg>',
  gym:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 9v6M20 9v6M7 7v10M17 7v10M7 12h10"/></svg>',
  cart:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 4h2l2.4 11h10L20 7H6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
  tag:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 12V5h7l8 8-7 7-8-8Z"/><circle cx="8.5" cy="8.5" r="1.2"/></svg>',
  transit:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="5" y="4" width="14" height="12" rx="3"/><path d="M7 20l2-3M17 20l-2-3M5 11h14"/></svg>',
};
function fitTiles(a, f){
  const out = [];
  const work = f && f.lg.find(l => l.fixed);
  if (work) out.push([TILE_IC.work, `${work.mins} min`, `to ${work.label.toLowerCase()}`]);
  const gym = f && f.lg.find(l => l.icon === "🏋️");
  if (gym) out.push([TILE_IC.gym, `${gym.mins} min`, "to gym"]);
  const gro = f && f.lg.find(l => l.icon === "🛒");
  if (gro) out.push([TILE_IC.cart, `${gro.mins} min`, "to grocery"]);
  const tr = f && f.lg.find(l => l.icon === "🚇");
  if (out.length < 3 && tr) out.push([TILE_IC.transit, `${tr.mins} min`, "to transit"]);
  if (window.LIFE_READY && lifeOn() && LIFE.budget){
    const d = LIFE.budget - a.act[0];
    out.push([TILE_IC.tag, `${money(Math.abs(d))}`, d>=0 ? "under budget" : "over budget", d>=0]);
  }
  return out.slice(0,4);
}
function featCard(a){
  const tr = trust(a);
  const f = window.LIFE_READY ? fit(a) : null;
  const r = f ? reasons(a, f) : null;
  const ph = a.photos || [];
  return `<article class="lc feat sel" data-id="${a.id}">
    <div class="top">
      <div class="phcol">
        <div class="ph">
          ${chipFor(a)?`<span class="chip ${chipClass(chipFor(a))}">${
  chipFor(a)==="New to you"?'<span class="d"></span>':''}${chipFor(a)}</span>`:''}
          <span class="heart ${saved.has(a.id)?'on':''}" data-heart="${a.id}">${IC.heart}</span>
          ${photo(a)}
        </div>
        ${ph.length>1 ? `<div class="thumbs">${ph.slice(1,4).map(u=>
          `<div><img src="${u}" alt="" loading="lazy"></div>`).join("")}
          ${ph.length>4?`<div class="more">+${ph.length-4}</div>`:""}</div>` : ""}
      </div>
      <div class="body">
        <div class="hd">
          <div>
            <h3>${a.addr}${a.unit?` #${a.unit}`:""}</h3>
            <p class="sub">${a.hood || "San Francisco"}</p>
            <p class="specs">${bedTxt(a.beds)} <i></i> ${a.baths||"1 bath"}
              ${a.sqft?`<i></i> ${n(a.sqft)} sqft`:""}</p>
          </div>
          <div class="prices">
            <div class="pr"><div class="v" style="font-size:15px;font-weight:600">${
              money(a.rent)} listed</div></div>
            <div class="pr act"><div class="v">~${actTxt(a)}</div>
              <div class="l">actual monthly ${a.est==="verified"
                ?'<span class="tagx v">published</span>'
                :a.est==="part"?'<span class="tagx v">part verified</span>'
                :'<span class="tagx e">est</span>'}</div></div>
          </div>
        </div>

        ${f && f.score!=null ? `
          <div style="display:flex;gap:14px;align-items:center;margin-top:12px">
            <div class="matchbig"><b>${f.score}</b><span>Match</span></div>
            <span class="conf">${f.conf} confidence</span>
            <div class="tiles" style="margin-left:auto">${fitTiles(a,f).map(([ic,big,sub,good])=>
              `<div class="tile ${good?"good":""}"><span class="ic">${ic}</span>
                <b>${big}</b><span>${sub}</span></div>`).join("")}</div>
          </div>
          ${f.blocked ? `<div class="blocked"><b>Outside what you said you'd accept:</b>
            ${f.hard.join(" · ")}</div>` : ""}
          ${a.shared ? `<div class="blocked"><b>This is a room, not a whole apartment.</b>
            ${a.shared_why ? a.shared_why[0].toUpperCase()+a.shared_why.slice(1)+"." : ""}
            Rooms are kept out of the recommendations because they win any comparison
            that rewards low rent.</div>` : ""}
          <div class="rz">${r.top.map(([k,txt])=>
            `<div class="${k}"><span class="dot"></span>${txt}</div>`).join("")}</div>
          ${r.note ? `<p style="font-size:11.5px;color:var(--ink-3);margin-top:7px;
            line-height:1.45">${r.note}</p>` : ""}
          ${(()=>{ const rf = redFlags(a);
            return rf.length ? `<div class="blocked" style="margin-top:9px">
              <b>Why we won't headline this one:</b> ${rf.join(" · ")}.</div>` : ""; })()}
          <button class="brkbtn" data-jump="score" data-id="${a.id}">See score breakdown</button>
        ` : `<div class="why"><span class="ic">${IC.spark}</span>
            <div><b>Why it's worth your time:</b> ${whyWorth(a)}</div></div>`}

        <div class="pillrow">
          <div class="pillbox"><span style="color:var(--am)">${IC.star}</span>
            <b>${a.rating ? a.rating : "—"}</b>
            <span class="sub">${a.rating ? `(${n(a.rating_n)} ${
              a.rating_src==="Google"?"Google":"residents"})` : "no reviews"}</span></div>
          <div class="pillbox"><span style="color:${
            tr.cls==="ok"?"var(--gr)":"var(--ink-3)"}">${
            tr.cls==="ok"?IC.shield:IC.warn}</span>
            <span>Landlord</span><b style="color:${tr.cls==="ok"?"var(--gr)":"var(--ink-2)"}">${
              a.landlord ? "Verified" : tr.t}</b></div>
          ${a.src.slice(0,2).map(sr=>`<button class="srcbtn" data-src="${a.id}">${sr.n}</button>`).join("")}
        </div>

        <div class="tabrow">
          ${[["res","Residents",IC.star],["cost","Costs",TILE_IC.tag],
             ["block","Block",IC.moon],["ll","Landlord",IC.shield]].map(([k,l,ic])=>
            `<button data-jump="${k}" data-id="${a.id}">${ic}${l}</button>`).join("")}
          <div style="margin-left:auto;display:flex;gap:8px">
            <button class="viewbtn ghost" data-open="${a.id}">See details</button>
            <button class="viewbtn" data-src="${a.id}">View original listing ${IC.ext}</button>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}
/* Rank does the separating the score honestly can't. Forty listings inside
   eleven points are a real tie, and "#7 of 266" says which one is in front
   without inventing a gap the numbers don't support. Computed once per render
   rather than per card -- indexOf inside a 24-card loop is quadratic. */
let _rankIdx = new Map(), eligibleCount = 0;
function indexRanks(v){
  _rankIdx = new Map(); eligibleCount = 0;
  if (!window.LIFE_READY || !lifeOn()) return;
  for (const a of v){
    const f = fit(a);
    if (!f || f.score == null || f.blocked || a.shared) continue;
    _rankIdx.set(a.id, ++eligibleCount);
  }
}

function rowCard(a){
  const st = chipFor(a), m = a.mem || {};
  // one status, one line of evidence for it — the memory is the whole point
  const TAG = {"New to you":["t-new", m.first ? "Added today" : "First time seen"],
               "Price drop":["t-drop", `$${m.drop} less than ${m.days||0}d ago`],
               "You've seen this before":["t-seen", `Viewed ${m.days||0} days ago`],
               "Saved":["t-save","In your saved list"],
               "Waiting on reply":["t-save","You marked this contacted"],
               "You passed before":["t-seen", m.reason ? `Passed: ${m.reason}` : "You passed before"]};
  const seen = !st && m.seen > 1;
  const tag = TAG[st] || (seen ? ["t-rep", `Back on ${m.days||0} days ago`] : null);
  const f = window.LIFE_READY ? fit(a) : null;
  const flags = window.LIFE_READY ? redFlags(a) : [];
  const rank = _rankIdx.get(a.id) || null;
  const mcol = !f || f.score==null || f.blocked || flags.length
             ? "var(--ink-3)" : fitTone(f.score);
  return `<article class="rowc ${a.id===sel?'sel':''}" data-id="${a.id}">
    <div class="th">${a.photos && a.photos[0]
      ? `<img src="${a.photos[0]}" alt="" loading="lazy">` : ""}</div>
    <div>
      <h4>${a.addr}${a.unit?` #${a.unit}`:""}</h4>
      <p class="hood">${a.hood || "San Francisco"}</p>
      <p class="sp">${bedTxt(a.beds)} · ${a.baths||"1 ba"}${a.sqft?` · ${n(a.sqft)} sqft`:""}${
        a._more ? ` · <b style="color:var(--or)">+${a._more} more unit${
          a._more>1?"s":""} here</b>` : ""}</p>
    </div>
    <div class="mt">${f && f.score!=null
      ? `<b style="color:${mcol}">${f.score}</b><span>match</span>
         <i>${f.blocked || flags.length ? (f.conf==="Low"?"low conf":f.conf==="Medium"?"med conf":"high conf")
             : rank ? `#${rank} of ${n(eligibleCount)}` : ""}</i>`
      : `<b style="color:var(--ink-3)">—</b><span>set up My Life</span>`}</div>
    <div class="pr"><b>${money(a.rent)} listed</b>
      <span>~${actTxt(a)} actual</span></div>
    <div class="st">${a.avail === "gone"
      ? `<span class="tag t-rep">Gone</span><span class="sub">no longer posted</span>`
      : a.avail === "no_units"
      ? `<span class="tag t-rep">No units</span><span class="sub">building listed, nothing available</span>`
      : f && f.blocked
      ? `<span class="tag t-rep">Over budget</span><span class="sub">${f.hard[0]||""}</span>`
      : flags.length
      ? `<span class="tag t-seen">Check first</span><span class="sub">${flags[0]}</span>`
      : a.shared
      ? `<span class="tag t-seen">Room</span><span class="sub">not a whole unit</span>`
      : tag?`<span class="tag ${tag[0]}">${st || "Reposted"}</span>
      <span class="sub">${tag[1]}</span>`:""}</div>
    <span class="heart ${saved.has(a.id)?'on':''}" data-heart="${a.id}">${IC.heart}</span>
  </article>`;
}

function renderRecs(v){
  const el = document.getElementById("recs");
  if (!el) return;
  if (!window.LIFE_READY || !lifeOn() || SORT !== "fit"){ el.innerHTML = ""; return; }
  const p = picks(v);
  // One good pick is worth showing. Requiring two meant that whenever the
  // alternates were too weak to offer, the whole row vanished and the page lost
  // its answer entirely.
  if (!p.length){ el.innerHTML = ""; return; }
  const MED = {"Best overall":"🥇","Best value":"💰","Best apartment":"✨"};
  const low = p[0].f.score < 64 ? whyLow(p[0].f) : null;
  /* The best overall listing is the big card immediately below this row, so
     printing it here too put the top match in a small square beside its own
     alternatives -- the thing that made the page read upside down. This row is
     now only the listings the ranking does NOT already lead with: the cheaper
     one, and the better-built one. */
  const alt = p.filter(x => x.a.id !== sel);
  el.innerHTML = `<div class="head"><b>${
      alt.length < p.length ? "Also worth a look" : "Your best matches"}</b>
      <span>out of ${n(v.length)} that clear your constraints</span></div>` +
    (low ? `<p style="grid-column:1/-1;font-size:12.5px;color:var(--ink-2);margin:-2px 0 8px">
       ${low}</p>` : "") +
    alt.map(x=>`<div class="reccard" data-open="${x.a.id}">
      <div class="kind">${MED[x.kind]||""} ${x.kind}</div>
      <div class="hdr"><h5>${x.a.addr}${x.a.unit?` #${x.a.unit}`:""}</h5>
        <span class="m">${x.f.score}<i>match</i></span></div>
      <p>${x.line}</p>
      <p style="font-size:11.5px;color:var(--ink-3)">${x.f.conf} confidence · we know
        ${x.f.ev} of 7 things about it${x.relaxed
          ? " · everything in this search has something on its record" : ""}</p>
    </div>`).join("");
  if (!alt.length) el.innerHTML = "";   // nothing left once the hero is removed
}

let page = 24;
function render(){
  const v = visible();
  indexRanks(v);
  const list = document.getElementById("results");
  // Feature the top of the list unless the reader pinned something else, and
  // never feature a listing that fails a hard constraint -- those sort to the
  // bottom for a reason.
  const pinned = selPinned ? v.find(a => a.id === sel) : null;
  const best = v.find(a => { const f = window.LIFE_READY ? fit(a) : null;
                             return !f || (!f.blocked && !a.shared && !hasFlags(a)); })
            || v.find(a => { const f = window.LIFE_READY ? fit(a) : null;
                             return !f || !f.blocked; }) || v[0];
  const selA = pinned || best;
  if (selA) sel = selA.id;
  const rest = v.filter(a=>a.id!==sel).slice(0, page);
  list.innerHTML = (selA?featCard(selA):"") + rest.map(rowCard).join("") +
    (v.length === 0 ? `<div style="background:var(--card);border:1px dashed var(--line);
        border-radius:10px;padding:44px 24px;text-align:center;color:var(--ink-2)">
        <p style="font-size:17px;font-weight:620;color:var(--ink);margin-bottom:7px">
        Nothing here yet</p>
        <p style="font-size:14px">${view==="saved"?"Tap the heart on a listing to save it."
          :view==="tours"?"Mark an apartment as contacted and it shows up here."
          :view==="reviews"?"No listings in view have resident ratings."
          :"No apartments match those filters."}</p></div>` : "") +
    (v.length > rest.length+1
      ? `<button class="viewbtn ghost" id="more" style="justify-content:center;padding:13px">
         Show more — ${n(v.length-rest.length-1)} remaining</button>` : "");
  document.getElementById("mapcount").textContent =
    `${n(v.length)} apartments · ${n(A.length)} tracked`;
  strip();
  renderRecs(v);
  drawMap(); placePins();
  const m = document.getElementById("more");
  if (m) m.onclick = () => { page += 24; render(); };
}

/* ---------- filters UI ---------- */
document.getElementById("bedmenu").innerHTML =
  [[0,"Studio"],[1,"1 bed"],[2,"2 beds"],[3,"3+ beds"]].map(([v,l])=>
  `<label><input type="checkbox" data-bed="${v}"> ${l}</label>`).join("");
document.getElementById("bathmenu").innerHTML =
  [[1,"1+"],[2,"2+"],[3,"3+"]].map(([v,l])=>
  `<label><input type="checkbox" data-bath="${v}"> ${l} baths</label>`).join("");
document.getElementById("moremenu").innerHTML = [
  ["rc","Likely rent-controlled"],["quiet","Quiet at night"],["lively","Good for going out"],
  ["clean","No violations on record"],["rated","Has resident reviews"],
  ["multi","Listed on 2+ sites"],["newonly","New to you only"],
  ["trusted","Fully verified only"],["landlord","Landlord identified"],
  ["rooms","Include rooms & co-living"],["allunits","Every unit, not one per building"],
  ["gone","Include listings that have come down"]].map(([v,l])=>
  `<label><input type="checkbox" data-more="${v}"> ${l}</label>`).join("");

// Source counts are live, so you can see what each platform is actually adding.
document.getElementById("srcmenu").innerHTML = (() => {
  const c = {};
  for (const a of A) for (const s of a.src) c[s.n] = (c[s.n] || 0) + 1;
  return Object.entries(c).sort((x,y) => y[1]-x[1]).map(([nm,ct]) =>
    `<label><input type="checkbox" data-src="${nm}"> ${nm}
      <span style="margin-left:auto;color:var(--ink-3);font-variant-numeric:tabular-nums"
      >${ct.toLocaleString()}</span></label>`).join("");
})();

const SORT_LABELS = {fit:"Best fit for me", match:"Best match", rent:"Lowest rent", rating:"Best reviewed",
                     calm:"Calmest street", fresh:"Newest first"};
function sortMenu(){
  document.getElementById("sortmenu").innerHTML =
    Object.entries(SORT_LABELS).map(([k,l])=>
      `<div class="sortopt ${SORT===k?'on':''}" data-sort="${k}">${
        SORT===k?"●":"○"} ${l}</div>`).join("") +
    /* Seven raw weight sliders used to live here, and they were the wrong
       question asked the wrong way. Nobody knows what "reviews: 2" means against
       "crime: 1", the numbers had no units, they reset on reload because W was
       never persisted, and they drove a second scoring system that competed with
       the one the quiz builds -- two different "best match" answers on the same
       page. The quiz asks about the life you want and derives the weights; that
       is the same information, in a form someone can actually answer. */
    (window.LIFE_READY && lifeOn()
      ? `<p style="font-size:12.5px;color:var(--ink-2);margin:12px 0 8px;line-height:1.45">
           "Best fit for me" is scored from your four answers.</p>
         <button class="viewbtn ghost" id="sortedit" style="width:100%;justify-content:center"
           >Change my answers</button>`
      : `<p style="font-size:12.5px;color:var(--ink-2);margin:12px 0 8px;line-height:1.45">
           Answer four questions and this list gets ranked around your life instead of
           generic quality.</p>
         <button class="viewbtn" id="sortedit" style="width:100%;justify-content:center"
           >Set up my life</button>`);
  const ed = document.getElementById("sortedit");
  if (ed) ed.onclick = () => { if (typeof openQuiz === "function") openQuiz(); };
  document.getElementById("fb-sort").childNodes[0].nodeValue = SORT_LABELS[SORT] + " ";
}
sortMenu();

document.addEventListener("click", e => {
  const s = e.target.closest("[data-sort]");
  if (s){ SORT = s.dataset.sort; selPinned = false; sortMenu(); render(); return; }
  const d = e.target.closest(".fdrop");
  document.querySelectorAll(".fdrop").forEach(x => { if (x !== d) x.classList.remove("open"); });
  if (d && e.target.closest(".fbtn")) d.classList.toggle("open");
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.bed !== undefined){
    const v = +t.dataset.bed; t.checked ? F.beds.add(v) : F.beds.delete(v);
    document.getElementById("fb-price").parentNode; syncF("beds","fb-beds","Beds"); render();
  }
  if (t.dataset.bath !== undefined){
    const v = +t.dataset.bath; t.checked ? F.baths.add(v) : F.baths.delete(v);
    syncF("baths","fb-baths","Baths"); render();
  }
  if (t.dataset.more !== undefined){
    const v = t.dataset.more; t.checked ? F.more.add(v) : F.more.delete(v);
    syncF("more","fb-more","More"); render();
  }
  if (t.dataset.src !== undefined){
    const v = t.dataset.src; t.checked ? F.src.add(v) : F.src.delete(v);
    syncF("src","fb-src","Source"); render();
  }
  if (t.name === "ml"){ mapLayer = t.value; drawMap(); placePins(); }
});
function syncF(key, btnId, label){
  const s = F[key], b = document.getElementById(btnId);
  b.classList.toggle("act", s.size > 0);
  b.childNodes[0].nodeValue = s.size ? `${label} · ${s.size} ` : label + " ";
}
["pmin","pmax"].forEach(id => document.getElementById(id).addEventListener("input", e => {
  F[id] = e.target.value ? +e.target.value : null;
  const on = F.pmin || F.pmax;
  const b = document.getElementById("fb-price");
  b.classList.toggle("act", !!on);
  b.childNodes[0].nodeValue = on ? `$${F.pmin||0}–${F.pmax||"∞"} ` : "Price ";
  // Typing a maximum here used to hide rows and leave every score untouched --
  // two separate ideas of "my budget" that never spoke, so changing the number
  // that matters most to a renter moved nothing. There is one budget now: this
  // control and the quiz's answer are the same value, and the scores recompute.
  if (window.LIFE_READY && lifeOn()) setBudget(F.pmax || LIFE.budget);
  selPinned = false; page = 24; render();
}));
document.getElementById("q").addEventListener("input", e => {
  F.q = e.target.value.trim(); selPinned = false; page = 24; render(); });
document.getElementById("t-base").onclick = () => setToggle(false);
document.getElementById("t-act").onclick = () => setToggle(true);
function setToggle(v){
  F.showActual = v;
  document.getElementById("t-base").classList.toggle("on", !v);
  document.getElementById("t-act").classList.toggle("on", v);
  drawMap(); placePins();
}
document.getElementById("infodot").onclick = () => document.getElementById("infodlg").showModal();
document.getElementById("infoclose").onclick = () => document.getElementById("infodlg").close();

/* ---------- map ---------- */
/* Real tiles, Web Mercator.
   Voyager is the full-colour street style: parks, water, POI labels, road
   hierarchy. Free and keyless. Swap BASEMAP to move providers -- a Mapbox or
   MapTiler key is a one-line change here, nothing else in the file cares. */
const cvs = document.getElementById("map"), mx = cvs.getContext("2d");
let MW=0, MH=0, ZOOM=13.4, CX=-122.4260, CY=37.7680, mapLayer="listings";
const GRID = (typeof STREET_GRID!=="undefined") ? STREET_GRID : {};
const RETINA = (devicePixelRatio||1) > 1.3 ? "@2x" : "";
const BASEMAP = {
  url: (z,x,y) => `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}${RETINA}.png`,
  credit: "© OpenStreetMap contributors © CARTO",
};
const TILE = 256;

function sizeMap(){
  const r = cvs.getBoundingClientRect(), d = Math.min(devicePixelRatio||1, 2);
  if (!r.width) return;
  MW = r.width; MH = r.height; cvs.width = MW*d; cvs.height = MH*d;
  mx.setTransform(d,0,0,d,0,0);
}
/* world pixel coords at the current zoom */
const scaleN = () => TILE * Math.pow(2, ZOOM);
function worldX(lon){ return (lon + 180) / 360 * scaleN(); }
function worldY(lat){
  const s = Math.sin(lat * Math.PI/180);
  return (0.5 - Math.log((1+s)/(1-s)) / (4*Math.PI)) * scaleN();
}
function lonAt(x){ return x / scaleN() * 360 - 180; }
function latAt(y){
  const n = Math.PI - 2*Math.PI*y/scaleN();
  return 180/Math.PI * Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
}
function proj(lat, lon){
  return [worldX(lon) - worldX(CX) + MW/2, worldY(lat) - worldY(CY) + MH/2];
}

/* tile cache */
const tiles = new Map();
function getTile(z, x, y){
  const k = `${z}/${x}/${y}`;
  if (tiles.has(k)) return tiles.get(k);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    img._ok = true;
    setTimeout(() => { drawMap(); drawDrawerMap(); }, 0);   // rAF stalls in background tabs
  };
  img.onerror = () => { img._bad = true; };
  img.src = BASEMAP.url(z, x, y);
  tiles.set(k, img);
  if (tiles.size > 600){                     // keep the cache from growing forever
    for (const key of tiles.keys()){ tiles.delete(key); if (tiles.size <= 500) break; }
  }
  return img;
}

function drawTiles(){
  const z = Math.max(1, Math.min(19, Math.round(ZOOM)));
  const n = Math.pow(2, z);
  const scaleAdj = scaleN() / (TILE * n);     // fractional zoom -> draw scaled tiles
  const size = TILE * scaleAdj;
  const originX = worldX(CX) - MW/2, originY = worldY(CY) - MH/2;
  const x0 = Math.floor(originX / size), x1 = Math.floor((originX + MW) / size);
  const y0 = Math.floor(originY / size), y1 = Math.floor((originY + MH) / size);
  for (let x = x0; x <= x1; x++){
    for (let y = y0; y <= y1; y++){
      if (y < 0 || y >= n) continue;
      const img = getTile(z, ((x % n) + n) % n, y);
      if (img._ok){
        mx.drawImage(img, x*size - originX, y*size - originY, size+1, size+1);
      }
    }
  }
}

/* Heatmaps, done the usual way: accumulate density additively into an
   offscreen buffer, then push that through a colour ramp. The first attempt
   scaled each blob's alpha against the single busiest cell, which put the
   median cell at alpha 0.13 -- invisible. Normalising against p90 instead means
   a typical block actually reads, and the handful of extreme cells clip. */
const RAMP = {
  encampment: [[254,243,199],[252,191,73],[234,120,48],[157,44,32]],
  break_in:   [[237,233,247],[178,164,216],[136,86,167],[77,26,110]],
  violent:    [[254,232,224],[250,160,130],[225,80,70],[140,20,30]],
  cleaning:   [[236,242,236],[168,199,171],[100,150,120],[38,86,74]],
};
const heatBuf = document.createElement("canvas");
let normCache = {};

function pctl(cells, p){
  const k = mapLayer + p;
  if (normCache[k] == null){
    const v = cells.map(c => c[2]).sort((a,b) => a-b);
    normCache[k] = v[Math.floor(v.length * p)] || 1;
  }
  return normCache[k];
}

function drawHeat(cells, ramp){
  const d = Math.min(devicePixelRatio||1, 2);
  heatBuf.width = MW*d; heatBuf.height = MH*d;
  const h = heatBuf.getContext("2d");
  h.setTransform(d,0,0,d,0,0);
  const norm = pctl(cells, 0.92);
  const cellPx = Math.abs(worldY(CY) - worldY(CY + 0.0011));
  // neighbouring blobs overlap and add, so per-blob alpha stays low and no floor
  // is applied -- a floor is what turned the whole city one flat colour
  const r = Math.max(6, cellPx * 1.05);
  h.globalCompositeOperation = "lighter";
  for (const [la,lo,cnt] of cells){
    const q = proj(la,lo);
    if (q[0]<-r||q[0]>MW+r||q[1]<-r||q[1]>MH+r) continue;
    const t = Math.min(1, cnt/norm);
    const g = h.createRadialGradient(q[0],q[1],0,q[0],q[1],r);
    g.addColorStop(0, `rgba(0,0,0,${0.5*Math.pow(t,0.7)})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    h.fillStyle=g; h.beginPath(); h.arc(q[0],q[1],r,0,7); h.fill();
  }
  // recolour the accumulated density through the ramp
  const img = h.getImageData(0,0,heatBuf.width,heatBuf.height), px = img.data;
  for (let i = 0; i < px.length; i += 4){
    const t = px[i+3]/255;
    if (t < 0.05){ px[i+3] = 0; continue; }
    const u = Math.min(0.999, t) * (ramp.length-1);
    const j = Math.floor(u), f = u - j;
    const c0 = ramp[j], c1 = ramp[Math.min(ramp.length-1, j+1)];
    px[i]   = c0[0] + (c1[0]-c0[0])*f;
    px[i+1] = c0[1] + (c1[1]-c0[1])*f;
    px[i+2] = c0[2] + (c1[2]-c0[2])*f;
    px[i+3] = Math.min(255, Math.pow(t, 0.75) * 250);
  }
  h.putImageData(img,0,0);
  mx.globalAlpha = 0.86;
  mx.drawImage(heatBuf, 0, 0, MW, MH);
  mx.globalAlpha = 1;
}

const LAYER_TXT = {
  encampment: ["Encampment reports", "311 reports per ~90m block, last 12 months"],
  break_in:   ["Car break-ins & vehicle theft", "Police incidents per ~90m block, last 12 months"],
  violent:    ["Assault, robbery & sex offenses", "Police incidents per ~90m block, last 12 months"],
  cleaning:   ["Street cleaning requests", "311 requests per ~90m block, last 12 months"],
};
function legendHide(){ const el=document.getElementById("maplegend"); if(el) el.hidden=true; }
function legend(){
  const el = document.getElementById("maplegend");
  if (!el) return;
  const ramp = RAMP[mapLayer], cells = GRID[mapLayer];
  if (!ramp || !cells){ el.hidden = true; return; }
  const hi = pctl(cells, 0.90);
  const css = ramp.map((c,i) =>
    `rgb(${c.join(",")}) ${Math.round(i/(ramp.length-1)*100)}%`).join(",");
  const [title, sub] = LAYER_TXT[mapLayer];
  el.hidden = false;
  el.innerHTML = `<b>${title}</b>
    <div class="bar" style="background:linear-gradient(90deg,${css})"></div>
    <div class="sc"><span>0</span><span>${hi}+</span></div>
    <p>${sub}. A report is a report — not a conviction.</p>`;
}

/* The drawer's own small map. Same tiles and same heat renderer as the big one,
   locked to this address so the numbers underneath have a picture attached. */
let dLayer = "encampment", dApt = null;
function drawDrawerMap(){
  const c = document.getElementById("dmap");
  if (!c || !dApt) return;
  const r = c.getBoundingClientRect(); if (!r.width) return;
  const d = Math.min(devicePixelRatio||1, 2);
  c.width = r.width*d; c.height = r.height*d;
  const g = c.getContext("2d"); g.setTransform(d,0,0,d,0,0);
  const W2 = r.width, H2 = r.height, Z2 = 15.6;
  const n2 = 256*Math.pow(2,Z2);
  const wx = l => (l+180)/360*n2;
  const wy = la => { const s=Math.sin(la*Math.PI/180);
    return (0.5 - Math.log((1+s)/(1-s))/(4*Math.PI))*n2; };
  const ox = wx(dApt.lon) - W2/2, oy = wy(dApt.lat) - H2/2;
  const pj = (la,lo) => [wx(lo)-ox, wy(la)-oy];

  g.fillStyle = "#EEEAE4"; g.fillRect(0,0,W2,H2);
  const z = Math.round(Z2), tn = Math.pow(2,z), size = n2/tn;
  for (let x = Math.floor(ox/size); x <= Math.floor((ox+W2)/size); x++)
    for (let y = Math.floor(oy/size); y <= Math.floor((oy+H2)/size); y++){
      if (y<0||y>=tn) continue;
      const img = getTile(z, ((x%tn)+tn)%tn, y);
      if (img._ok) g.drawImage(img, x*size-ox, y*size-oy, size+1, size+1);
    }
  g.fillStyle = "rgba(252,251,249,.6)"; g.fillRect(0,0,W2,H2);

  const cells = GRID[dLayer], ramp = RAMP[dLayer];
  if (cells && ramp){
    const buf = document.createElement("canvas");
    buf.width = c.width; buf.height = c.height;
    const h = buf.getContext("2d"); h.setTransform(d,0,0,d,0,0);
    const norm = pctl(cells, 0.92);
    const cellPx = Math.abs(wy(dApt.lat) - wy(dApt.lat + 0.0011));
    const rad = Math.max(6, cellPx*1.05);
    h.globalCompositeOperation = "lighter";
    for (const [la,lo,cnt] of cells){
      const q = pj(la,lo);
      if (q[0]<-rad||q[0]>W2+rad||q[1]<-rad||q[1]>H2+rad) continue;
      const t = Math.min(1, cnt/norm);
      const gr = h.createRadialGradient(q[0],q[1],0,q[0],q[1],rad);
      gr.addColorStop(0,`rgba(0,0,0,${0.5*Math.pow(t,0.7)})`);
      gr.addColorStop(1,"rgba(0,0,0,0)");
      h.fillStyle=gr; h.beginPath(); h.arc(q[0],q[1],rad,0,7); h.fill();
    }
    const im = h.getImageData(0,0,buf.width,buf.height), px = im.data;
    for (let i=0;i<px.length;i+=4){
      const t = px[i+3]/255;
      if (t < 0.05){ px[i+3]=0; continue; }
      const u = Math.min(0.999,t)*(ramp.length-1), j = Math.floor(u), f = u-j;
      const c0 = ramp[j], c1 = ramp[Math.min(ramp.length-1,j+1)];
      px[i]=c0[0]+(c1[0]-c0[0])*f; px[i+1]=c0[1]+(c1[1]-c0[1])*f;
      px[i+2]=c0[2]+(c1[2]-c0[2])*f; px[i+3]=Math.min(255,Math.pow(t,0.75)*250);
    }
    h.putImageData(im,0,0);
    g.globalAlpha = 0.88; g.drawImage(buf,0,0,W2,H2); g.globalAlpha = 1;
  }
  // the 250m ring the counts are measured over
  const mPerPx = 156543.03 * Math.cos(dApt.lat*Math.PI/180) / Math.pow(2,Z2);
  g.strokeStyle = "rgba(20,20,20,.55)"; g.lineWidth = 1.5; g.setLineDash([5,4]);
  g.beginPath(); g.arc(W2/2, H2/2, 250/mPerPx, 0, 7); g.stroke(); g.setLineDash([]);
  g.fillStyle = "#E4622A"; g.strokeStyle = "#fff"; g.lineWidth = 2.5;
  g.beginPath(); g.arc(W2/2, H2/2, 6, 0, 7); g.fill(); g.stroke();
}

/* A city-wide heat map answers "where is this a problem". Selecting a listing
   changes the question to "is it a problem here", and the answer was three
   clicks away in the drawer. So the moment a place is selected, ring the 250m
   the counts are actually measured over and put this listing's number on it --
   the heat stops being a mood and starts being about an address. */
function focusRing(){
  const a = A.find(x => x.id === sel);
  if (!a) return;
  const q = proj(a.lat, a.lon);
  const mPerPx = 156543.03 * Math.cos(a.lat*Math.PI/180) / Math.pow(2, ZOOM);
  const r = 250 / mPerPx;
  if (r < 9 || q[0] < -r || q[0] > MW+r || q[1] < -r || q[1] > MH+r) return;

  mx.strokeStyle = "rgba(20,20,25,.6)"; mx.lineWidth = 1.5;
  mx.setLineDash([5,4]);
  mx.beginPath(); mx.arc(q[0], q[1], r, 0, 7); mx.stroke();
  mx.setLineDash([]);

  const v = (a.street || {})[mapLayer];
  if (v == null) return;
  const pct = Math.round(spct(a, mapLayer) ?? 0);
  const txt = `${n(v)} · ${pct >= 80 ? `busier than ${pct}%`
              : pct <= 25 ? `calmer than ${100-pct}%` : "mid-pack"}`;
  mx.font = "600 11.5px -apple-system,system-ui,sans-serif";
  const w = mx.measureText(txt).width + 16;
  const bx = cl(q[0] - w/2, 4, MW - w - 4), by = cl(q[1] - r - 26, 4, MH - 26);
  mx.fillStyle = "rgba(255,255,255,.94)";
  mx.strokeStyle = "rgba(0,0,0,.12)"; mx.lineWidth = 1;
  mx.beginPath(); mx.roundRect(bx, by, w, 20, 6); mx.fill(); mx.stroke();
  mx.fillStyle = pct >= 80 ? "#C9521F" : pct <= 25 ? "#2E8B57" : "#5F6169";
  mx.fillText(txt, bx + 8, by + 14);
}

function drawMap(){
  sizeMap(); if (!MW) return;
  mx.clearRect(0,0,MW,MH);
  mx.fillStyle = "#E8E4DE"; mx.fillRect(0,0,MW,MH);
  drawTiles();

  // a full-colour basemap competes with a data overlay, so mute it underneath one
  if (RAMP[mapLayer] || mapLayer === "dark"){
    mx.fillStyle = "rgba(252,251,249,.66)"; mx.fillRect(0,0,MW,MH);
  }
  if (window.LIFE_READY && lifeMode){ drawLife(); legendHide(); return; }
  if (RAMP[mapLayer] && GRID[mapLayer]){
    drawHeat(GRID[mapLayer], RAMP[mapLayer]);
    focusRing();
  }
  legend();
  if (mapLayer === "dark"){
    mx.globalCompositeOperation = "multiply";
    for (const a of visible()){
      const bn = barsNear(a);
      if (bn < 8) continue;
      const q = proj(a.lat,a.lon);
      const r = (14 + bn*0.7) * Math.max(0.55, Math.pow(2, ZOOM-13.4)*0.9);
      const g = mx.createRadialGradient(q[0],q[1],0,q[0],q[1],r);
      g.addColorStop(0,`rgba(228,98,42,${cl(bn/60,0,1)*0.45})`);
      g.addColorStop(1,"rgba(228,98,42,0)");
      mx.fillStyle=g; mx.beginPath(); mx.arc(q[0],q[1],r,0,7); mx.fill();
    }
    mx.globalCompositeOperation = "source-over";
  }
  /* attribution — required by CARTO and OSM */
  mx.font = "10px -apple-system,system-ui,sans-serif";
  const cred = BASEMAP.credit;
  const w = mx.measureText(cred).width;
  mx.fillStyle = "rgba(255,255,255,.78)";
  mx.fillRect(MW-w-12, MH-16, w+10, 14);
  mx.fillStyle = "#6B6B6B";
  mx.fillText(cred, MW-w-7, MH-6);
}

function placePins(){
  const layer = document.getElementById("pins");
  const dim = window.LIFE_READY && lifeMode;   // pins stay for context, quietened
  const v = visible();
  const chosen = [], grid = new Set();
  const selA = v.find(a=>a.id===sel);
  if (selA) chosen.push(selA);
  for (const a of v){
    if (a.id === sel) continue;
    const q = proj(a.lat,a.lon);
    if (q[0]<-40||q[0]>MW+40||q[1]<-30||q[1]>MH+30) continue;
    const k = `${Math.round(q[0]/74)},${Math.round(q[1]/38)}`;
    if (grid.has(k)) continue;
    grid.add(k); chosen.push(a);
    if (chosen.length > 42) break;
  }
  layer.innerHTML = chosen.map(a=>{
    const q = proj(a.lat,a.lon);
    const val = F.showActual ? a.act[0] : a.rent;
    const lbl = val >= 1000 ? `$${(val/1000).toFixed(2)}k` : `$${val}`;
    return `<button class="mpin ${a.id===sel?'sel':''}" data-pin="${a.id}"
      style="left:${q[0]}px;top:${q[1]}px${dim && a.id!==sel
        ? ";opacity:.42;background:#fff;color:var(--ink-3);box-shadow:none" : ""}">${lbl}</button>`;
  }).join("");
}

(function(){
  let down=false,lx=0,ly=0;
  cvs.addEventListener("mousedown",e=>{down=true;lx=e.clientX;ly=e.clientY;cvs.classList.add("drag")});
  addEventListener("mousemove",e=>{
    if(!down) return;
    const wx = worldX(CX) - (e.clientX-lx), wy = worldY(CY) - (e.clientY-ly);
    CX = lonAt(wx); CY = latAt(wy);
    lx=e.clientX; ly=e.clientY; drawMap(); placePins();
  });
  addEventListener("mouseup",()=>{down=false;cvs.classList.remove("drag")});
  /* Zoom about a fixed point. A flat step per wheel event is wrong on a
     trackpad, which fires a stream of small deltas -- scale by the delta and
     clamp instead, and treat a pinch (ctrlKey) as the coarser gesture. */
  function zoomAt(dz, px, py){
    const latB = latAt(worldY(CY)-MH/2+py), lonB = lonAt(worldX(CX)-MW/2+px);
    const before = ZOOM;
    ZOOM = cl(ZOOM + dz, 10.5, 18);
    if (ZOOM === before) return;
    CX = lonAt(worldX(lonB) - (px - MW/2));
    CY = latAt(worldY(latB) - (py - MH/2));
    drawMap(); placePins();
  }
  cvs.addEventListener("wheel",e=>{
    e.preventDefault();
    const r = cvs.getBoundingClientRect();
    const dz = cl(-e.deltaY * (e.ctrlKey ? 0.025 : 0.0075), -0.55, 0.55);
    zoomAt(dz, e.clientX-r.left, e.clientY-r.top);
  },{passive:false});
  cvs.addEventListener("dblclick",e=>{
    const r = cvs.getBoundingClientRect();
    zoomAt(e.shiftKey ? -1.2 : 1.2, e.clientX-r.left, e.clientY-r.top);
  });
  const zoomBy = d => zoomAt(d, MW/2, MH/2);
  document.getElementById("zin").onclick = ()=>zoomBy(1);
  document.getElementById("zout").onclick = ()=>zoomBy(-1);
  // +/- work whenever you're not typing in a field
  addEventListener("keydown", e => {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (e.key === "+" || e.key === "=") zoomBy(1);
    else if (e.key === "-" || e.key === "_") zoomBy(-1);
  });
})();
addEventListener("resize",()=>{drawMap();placePins()});

/* ---------- interactions ---------- */
document.addEventListener("click", e => {
  const h = e.target.closest("[data-heart]");
  if (h){ e.stopPropagation();
    const id = h.dataset.heart;
    const on = !saved.has(id);
    on ? saved.add(id) : saved.delete(id);
    markMem(id, { saved: on });
    return; }
  const s = e.target.closest("[data-src]");
  if (s){ e.stopPropagation(); const a=A.find(x=>x.id===s.dataset.src);
    openSource(a); return; }
  const o = e.target.closest("[data-open]");
  if (o){ e.stopPropagation(); openDrawer(A.find(x=>x.id===o.dataset.open)); return; }
  const j = e.target.closest("[data-jump]");
  if (j){ e.stopPropagation();
    openDrawer(A.find(x => x.id === j.dataset.id), j.dataset.jump); return; }
  const lk = e.target.closest("[data-lookup]");
  if (lk){
    e.stopPropagation();
    lk.disabled = true; lk.textContent = "Looking up…";
    lookupOwner(lk.dataset.lookup, lk.dataset.addr);
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act){
    e.stopPropagation();
    const id = act.dataset.id, kind = act.dataset.act;
    if (kind === "passed"){
      const why = prompt("Why are you passing on this one?\n(Kept locally, shown if it reappears.)");
      if (why === null) return;
      markMem(id, { passed: true, contacted: false, reason: why.trim() || "no reason given" });
    } else if (kind === "contacted"){
      markMem(id, { contacted: true, passed: false });
    } else {
      markMem(id, { passed: false, contacted: false, reason: null });
    }
    const a = A.find(x => x.id === id);
    if (a) openDrawer(a);
    return;
  }
  const pin = e.target.closest("[data-pin]");
  if (pin){ sel = pin.dataset.pin; selPinned = true; page=24; render();
    document.getElementById("results").scrollTo({top:0,behavior:"smooth"}); return; }
  const card = e.target.closest(".lc, .rowc");
  if (card){
    if (card.classList.contains("feat")) openDrawer(A.find(x=>x.id===card.dataset.id));
    else {
      sel = card.dataset.id; selPinned = true;
      const a = A.find(x => x.id === sel);
      render();
      // Selecting a place should immediately show what life around it looks
      // like — that's the whole point of having the routes.
      if (window.LIFE_READY && lifeOn() && a) showLife(a);
      document.getElementById("results").scrollTo({top:0,behavior:"smooth"});
    }
  }
});
function openSource(a){
  // Contacting, touring and applying stay on the source site; we keep the
  // record, the research and your notes.
  const s = a && a.src && a.src[0];
  if (s && s.u) window.open(s.u, "_blank", "noopener");
}

/* ---------- detail drawer ---------- */
const JUMP_TO = {
  res:   "Residents",
  cost:  "What you'd actually pay",
  block: "Street conditions",
  ll:    "Who you'd be renting from",
  score: "Score breakdown",
};
let jumpT = null;
// `settle` re-runs after async sections (the owner lookup) have injected their
// content and moved everything below them; without it the last tab lands short.
function jumpTo(key, settle){
  const want = JUMP_TO[key];
  if (!want) return;
  const panel = document.getElementById("panel");
  const h = [...panel.querySelectorAll("h4")].find(x => x.textContent.trim() === want);
  if (!h) return;
  const sec = h.closest(".dsec") || h;
  const to = Math.max(0, sec.offsetTop - 12);
  if (settle && Math.abs(panel.scrollTop - to) < 30) return;   // already right

  // scroll-behavior:smooth is a no-op in a backgrounded tab and under
  // reduced-motion, so drive it from the clock and always land on the target.
  clearInterval(jumpT);
  const from = panel.scrollTop, t0 = Date.now(), DUR = 380;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (settle || reduced || document.hidden || Math.abs(to - from) < 40){
    panel.scrollTop = to;
  } else {
    jumpT = setInterval(() => {
      const t = cl((Date.now() - t0) / DUR, 0, 1);
      panel.scrollTop = from + (to - from) * (1 - Math.pow(1 - t, 3));
      if (t >= 1) clearInterval(jumpT);
    }, 16);
  }
  sec.animate([{ background: "var(--or-bg)" }, { background: "transparent" }],
              { duration: 1100, easing: "ease-out" });
  document.querySelectorAll("[data-jump]").forEach(b =>
    b.classList.toggle("on", b.dataset.jump === key));
}
function openDrawer(a, jump){
  if (!a) return;
  if (typeof selectForLife === "function") selectForLife(a);
  const hrs = a.hours || [];
  const mxh = Math.max(1, ...hrs);
  const [lo,hi] = a.act;
  const util = [lo - a.rent, hi - a.rent];
  document.getElementById("panel").innerHTML = `
    <div class="pclose"><button id="pcl">← Back to results</button>
      <b style="font-size:15px">${a.addr}${a.unit?` #${a.unit}`:""}</b></div>
    <div class="pbody">
      ${a.photos && a.photos.length ? `<div class="gallery">
        <img class="g1" src="${a.photos[0]}" alt="" loading="lazy">
        ${(a.photos.slice(1,3)).map(p=>`<img class="gx" src="${p}" alt="" loading="lazy">`).join("")}
        ${a.photos.length<3?'<div class="gx" style="background:var(--sub)"></div>'.repeat(3-a.photos.length):""}
      </div>`:""}

      <div class="dsec"><h4>What you'd actually pay</h4>
        <div class="costrow"><span>Listed rent</span><span class="tagx v">Verified</span>
          <span class="v">${money(a.rent)}</span></div>
        <div class="costrow"><span>Gas &amp; electricity
          <span style="display:block;font-size:12px;color:var(--ink-3)">
          typical for ${a.beds===0?"a studio":a.beds+"bd"} in SF — PG&amp;E rates against
          comparable units, not a quote</span></span>
          <span class="tagx e">Estimated</span>
          <span class="v">$${util[0]}–${util[1]}</span></div>
        <div class="costrow"><span>Water, sewer, refuse</span><span class="tagx v">Verified</span>
          <span class="v">Landlord-paid</span></div>
        <div class="costrow"><span>Mandatory fees, parking, pet rent</span>
          <span class="tagx u">Unverified</span><span class="v dim">—</span></div>
        <div class="dtotal"><span>Actual monthly</span><span class="b">${actTxt(a)}</span></div>
        <div class="recbox">No California law requires landlords to advertise all-in pricing —
          the bill that would have, AB 1248, died in February 2026. Anything we couldn't
          confirm from the source stays unverified.</div>
      </div>

      <div class="dsec"><h4>The block after dark</h4>
        <p style="font-size:16px;font-weight:640;margin-bottom:4px">
          ${nightScore(a)>=NIGHT_LIVELY?"This block gets much busier after dark"
            :nightScore(a)>NIGHT_QUIET?"Moderate late-night activity nearby":"This block stays quiet after dark"}</p>
        <p style="font-size:14px;color:var(--ink-2)">
          ${n(a.noise)} noise reports within 250m, ${a.night_pct}% of them between 10pm and 5am.
          ${barsNear(a)} bars and clubs within a ten-minute walk${
            a.late?`, ${a.late} licensed past 2am`:""}.</p>
        <div class="hourbar">${hrs.map((v,h)=>
          `<i class="${h>=22||h<5?'hi':''}" style="height:${Math.max(2,v/mxh*100)}%"
            title="${hrTxt(h)}: ${v}"></i>`).join("")}</div>
        <div class="hourlab"><span>12 AM</span><span>6 AM</span><span>12 PM</span>
          <span>6 PM</span><span>11 PM</span></div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:8px">
          311 noise reports · vw6y-z8j6 &nbsp;·&nbsp; Entertainment permits · 86e8-rfem</p>
      </div>

      <div class="dsec"><h4>Residents</h4>
        ${a.areview ? `
          <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:14px">
            <div style="text-align:center;min-width:74px">
              <div style="font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1">
                ${a.areview.score}</div>
              <div style="color:var(--am);font-size:12px;letter-spacing:2px">★★★★★</div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">
                ${n(a.areview.n)} renter${a.areview.n===1?"":"s"}</div>
            </div>
            <div style="flex:1">
              ${[5,4,3,2,1].map(s=>{
                const c = (a.areview.dist||{})[s] || 0;
                const w = a.areview.n ? Math.round(c / a.areview.n * 100) : 0;
                return `<div style="display:grid;grid-template-columns:34px 1fr 20px;gap:7px;
                  align-items:center;font-size:11.5px;color:var(--ink-3);margin-bottom:3px">
                  <span>${s} star</span>
                  <span style="height:6px;background:var(--line-2);border-radius:3px;overflow:hidden">
                    <span style="display:block;height:100%;width:${w}%;background:var(--am)"></span></span>
                  <span style="text-align:right;font-variant-numeric:tabular-nums">${c}</span>
                </div>`}).join("")}
            </div>
          </div>
          ${a.areview.split ? `<div class="recbox" style="margin-bottom:12px">
            This building splits people. Most reviews are 5 stars or 1 star with little in
            between, so the ${a.areview.score} average describes almost nobody's experience.
            Read the ends, not the middle.</div>` : ""}
          ${a.rating_gap ? `<div class="recbox" style="margin-bottom:12px">
            Renters rate this <b>${a.rating_gap.renters}</b> (${a.rating_gap.rn} reviews) while
            Google says <b>${a.rating_gap.google}</b> (${a.rating_gap.gn}). Google's reviewers
            include people who toured but never lived here, and management can ask happy
            tenants to post. When the two disagree, the renters are the ones who signed a lease.
          </div>` : ""}
          ${a.areview.themes && a.areview.themes.length ? `
            <p style="font-size:12px;font-weight:640;letter-spacing:.06em;
              text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">
              What renters keep raising</p>
            ${a.areview.themes.map(t=>`<div style="display:grid;
              grid-template-columns:1fr auto;gap:10px;font-size:13.5px;padding:6px 0;
              border-bottom:1px solid var(--line-2)">
              <span>${t.t}</span>
              <span style="color:var(--ink-3)">${t.n} review${t.n===1?"":"s"}${
                t.neg?` · <b style="color:var(--or)">${t.neg} critical</b>`:""}</span>
            </div>`).join("")}` : ""}
          ${a.areview.quotes && a.areview.quotes.length ? `
            <p style="font-size:12px;font-weight:640;letter-spacing:.06em;
              text-transform:uppercase;color:var(--ink-3);margin:16px 0 8px">
              Most recent, in their words</p>
            ${a.areview.quotes.map(q=>`<blockquote style="margin:0 0 10px;padding:9px 12px;
              border-left:2px solid var(--line);background:var(--bg-2);border-radius:0 7px 7px 0">
              ${q.h?`<b style="font-size:13px;display:block;margin-bottom:3px">${q.h}</b>`:""}
              <span style="font-size:13.5px;color:var(--ink-2)">“${q.t}”</span>
              <span style="display:block;font-size:11.5px;color:var(--ink-3);margin-top:5px"
                >${q.d}</span></blockquote>`).join("")}` : ""}
          <p style="font-size:11.5px;color:var(--ink-3);margin-bottom:14px">
            Apartments.com renter reviews${a.areview.inherited
              ? " — for this building, not this specific unit" : ""}${
              a.areview.mgmt ? ` · managed by ${a.areview.mgmt}` : ""}.
            Apartments.com discloses that participating residents may receive reward points for
            posting, regardless of what they say.
            ${a.areview.url?`<a href="${a.areview.url}" target="_blank" rel="noopener"
              style="color:var(--or)">Read them</a>`:""}</p>
        ` : ""}
        ${a.greview ? `
          <div style="display:flex;gap:20px;align-items:center;margin-bottom:12px">
            <div style="text-align:center">
              <div style="font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1">
                ${a.greview.score}</div>
              <div style="color:var(--am);font-size:12px;letter-spacing:2px">★★★★★</div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">
                ${n(a.greview.n)} on Google</div>
            </div>
            <div style="flex:1;font-size:13.5px;color:var(--ink-2)">
              ${a.greview.living >= 3
                ? `Of the ${a.greview.sampled} most recent reviews,
                   <b>${a.greview.living}</b> describe actually living here —
                   the rest are mostly about touring and moving in.`
                : `Of the ${a.greview.sampled} most recent reviews, almost none describe
                   living here. Ratings on apartment listings skew toward people reviewing
                   the leasing office, so treat the average carefully.`}
            </div>
          </div>
          ${a.greview.themes && a.greview.themes.length ? `
            <p style="font-size:12px;font-weight:640;letter-spacing:.06em;
              text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">
              What reviewers keep mentioning</p>
            ${a.greview.themes.map(t=>`<div style="display:grid;
              grid-template-columns:1fr auto;gap:10px;font-size:13.5px;padding:6px 0;
              border-bottom:1px solid var(--line-2)">
              <span>${t.t}</span>
              <span style="color:var(--ink-3)">${t.n} mention${t.n===1?"":"s"}${
                t.neg?` · <b style="color:var(--or)">${t.neg} negative</b>`:""}</span>
              </div>`).join("")}` : ""}
          ${a.greview.quote ? `<div style="border-left:2px solid var(--or-line);
            padding-left:13px;margin-top:13px">
            <p style="font-size:13.5px;color:var(--ink-2);font-style:italic">
              "${a.greview.quote.q}"</p>
            <p style="font-size:11.5px;color:var(--ink-3);margin-top:5px">
              ${a.greview.quote.s}★ · ${a.greview.quote.d} · the most critical recent review</p>
          </div>` : ""}
          <p style="font-size:11.5px;color:var(--ink-3);margin-top:11px">
            Google reviews · fetched for this building</p>
        ` : `
          <p style="font-size:14px;color:var(--ink-2)">
            No resident reviews found for this building. That's normal for small, older,
            often rent-controlled buildings — review sites cover large managed complexes
            and skip the rest. It's a gap in the coverage, not a clean record.</p>
          <p style="font-size:11.5px;color:var(--ink-3);margin-top:9px">
            Checked Google and Apartments.com</p>`}
      </div>

      <div class="dsec"><h4>This exact unit</h4>
        ${a.est==="verified" ? `<p style="font-size:13.5px;color:var(--ink-2);margin-bottom:10px">
            Apartments.com publishes a total monthly price for this unit, so the figure below
            is theirs, not our estimate.</p>
          <div class="kv"><span>Listed rent</span><span class="v">${money(a.rent)}</span></div>
          <div class="kv"><span>Total monthly, published</span>
            <span class="v">${actTxt(a)}</span></div>` : ""}
        ${a.wd !== undefined ? `<div class="kv"><span>Washer/dryer in the unit</span>
          <span class="v" style="color:${a.wd?"var(--gr)":"var(--or)"}">${
            a.wd ? "Yes — listed on this unit" : "Not listed on this unit"}</span></div>` : ""}
        ${a.sqft ? `<div class="kv"><span>Size</span><span class="v">${n(a.sqft)} sq ft</span></div>` : ""}
        ${a.unit_amen && a.unit_amen.length ? `<p style="font-size:13px;color:var(--ink-2);margin-top:10px">
          ${a.unit_amen.join(" · ")}</p>` : ""}
        ${a.scores ? `<div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap">
          ${[["walk","Walk"],["transit","Transit"],["sound","Sound"],["bike","Bike"]]
            .filter(([k])=>a.scores[k]!=null).map(([k,l])=>
            `<div><b style="font-size:19px;font-weight:700">${a.scores[k]}</b>
              <span style="font-size:11.5px;color:var(--ink-3);display:block">${l}${
                k==="sound"&&a.scores.soundLabel?` · ${a.scores.soundLabel}`:""}</span></div>`).join("")}
        </div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:8px">
          Walk, transit and sound scores as published by Apartments.com. A higher sound
          score means a busier, louder block.</p>` : ""}
        ${a.est!=="verified" && a.wd===undefined && !a.scores ? `<p style="font-size:14px;
          color:var(--ink-2)">We couldn't match this ad to a specific unit on the property page,
          so amenities and the published total monthly aren't available for it.</p>` : ""}
      </div>

      <div class="dsec"><h4>Score breakdown</h4>
        ${(()=>{ const f = window.LIFE_READY ? fit(a) : null;
          if (!f || f.score==null) return `<p style="font-size:14px;color:var(--ink-2)">
            Set up My Life and every apartment gets a personal match score.</p>`;
          const q = f.q;
          return `<div class="matchbig" style="margin-bottom:4px">
              <b>${f.score}</b><span>Match</span>
              <span class="conf">${f.conf} confidence</span></div>
            <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:13px">
              Three quarters of this is how well it fits you, one quarter is how good the
              property is regardless of who's looking${q!=null?` (quality ${q}/100)`:""}.</p>
            ${DIMS.map(([k,label,help])=>{
              const v = f.d[k]==null ? null : Math.round(f.d[k]*100);
              const wt = Math.round(f.w[k]);
              return `<div style="display:grid;grid-template-columns:1fr 92px 40px;gap:11px;
                align-items:center;padding:7px 0;border-bottom:1px solid var(--line-2)">
                <span style="font-size:13.5px">${label}
                  <span style="color:var(--ink-3);font-size:11.5px">· weight ${wt}</span>
                  <span style="display:block;font-size:11.5px;color:var(--ink-3)">${help}</span></span>
                <span style="height:6px;background:var(--line-2);border-radius:3px;overflow:hidden">
                  ${v==null?"":`<span style="display:block;height:100%;width:${v}%;background:${
                    v>=66?"var(--gr)":v>=40?"var(--am)":"var(--or)"}"></span>`}</span>
                <span style="font-size:13px;text-align:right;font-variant-numeric:tabular-nums;
                  color:${v==null?"var(--ink-3)":"var(--ink)"}">${v==null?"n/a":v}</span></div>`;
            }).join("")}
            <p style="font-size:12px;color:var(--ink-3);margin-top:10px">
              <b>${f.conf} confidence</b> — we know ${f.ev} of 7 things that matter here
              (reviews, published price, size, parcel record, building size, unit amenities).
              Where a fact is missing it is left out of the average rather than counted
              against the place, and a building nobody has reviewed or cited is scored as
              ordinary rather than flawless.</p>
            ${f.travel ? `<p style="font-size:12.5px;color:var(--ink-2);margin-top:11px">
              About <b>${f.travel.weekly} min a week</b> of travel to your places, weighted by
              how often you make each trip.</p>` : ""}`;
        })()}
      </div>

      <div class="dsec"><h4>Street conditions</h4>
        <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:10px">
          Reports filed within 250m in the last 12 months, and where that sits
          against every other listing in this search.</p>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          ${[["encampment","Encampments"],["break_in","Break-ins"],
             ["violent","Violent"],["cleaning","Cleaning"]].map(([k,l],i)=>
            `<button class="dlayer${i?"":" on"}" data-dlayer="${k}">${l}</button>`).join("")}
        </div>
        <canvas id="dmap" style="width:100%;height:190px;border-radius:9px;
          border:1px solid var(--line);display:block"></canvas>
        <p style="font-size:11.5px;color:var(--ink-3);margin:6px 0 14px">
          The circle is 250m around this address — the area the counts below cover.</p>
        ${[["encampment","Encampment reports"],["break_in","Car break-ins &amp; vehicle theft"],
           ["violent","Assault, robbery &amp; sex offenses"],["cleaning","Street cleaning requests"]]
          .map(([k,label])=>{
            const v=(a.street||{})[k], pct=Math.round(spct(a,k) ?? 0);
            if (v==null) return "";
            const hot = pct>=80, calm = pct<=25;
            const col = hot?"var(--or)":calm?"var(--gr)":"var(--am)";
            const ramp = (RAMP[k]||[]).slice(-2)[0] || [150,150,150];
            return `<div style="padding:9px 0;border-bottom:1px solid var(--line-2)">
              <div style="display:grid;grid-template-columns:1fr auto auto;gap:12px;
                align-items:center">
                <span style="font-size:14px">${label}</span>
                <span style="font-size:12.5px;color:${col}">
                  ${hot?`busier than ${pct}% of listings`
                      :calm?`calmer than ${100-pct}% of listings`
                      :`around the middle`}</span>
                <span style="font-size:14px;font-weight:640;
                  font-variant-numeric:tabular-nums;min-width:56px;text-align:right">${n(v)}</span>
              </div>
              <i style="display:block;height:5px;border-radius:3px;margin-top:6px;
                background:var(--line-2);overflow:hidden"><s style="display:block;height:100%;
                width:${pct}%;background:rgb(${ramp.join(",")})"></s></i>
            </div>`}).join("")}
        ${(() => {
          // Same correction the score applies. Saying it out loud matters here,
          // because the bars above are the one place a reader would otherwise
          // read "nothing reported" as "nothing happens".
          const cov = window.LIFE_READY ? streetCoverage(a) : null;
          return cov != null && cov < 150
            ? `<p style="font-size:12px;color:var(--am);margin-top:10px">Only ${n(cov)} reports
                 of any kind were filed within 250m of here in the last year, against a city
                 median of about 1,080. That is thin coverage rather than a quiet block, so
                 these percentiles are pulled toward the middle before they count.</p>` : "";
        })()}
        <div class="recbox" style="margin-top:12px">
          These are four separate things, not one score. A block with car break-ins and a
          block with encampment reports are different problems — and a report is a report,
          not a conviction or a measure of who lives there.
        </div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:9px">
          311 Cases · vw6y-z8j6 &nbsp;·&nbsp; Police incidents · wg3w-h783 · last 12 months</p>
      </div>

      <div class="dsec"><h4>Going out from here</h4>
        <p style="font-size:16px;font-weight:640;margin-bottom:4px">
          ${nightScore(a)>=NIGHT_LIVELY?"You'd be in the middle of it"
            :barsNear(a)>=20?"Plenty within a few minutes' walk"
            :nightScore(a)>NIGHT_QUIET?"A handful of spots nearby"
            :"Not much within walking distance"}</p>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:${a.vnames&&a.vnames.length?"12px":"0"}">
          ${barsNear(a)} bars and clubs within a ten-minute walk${
            a.late?`, ${a.late} licensed past 2am`:""}.
          ${barsNear(a)>=20?"That's the same density that makes the block busier at night — worth knowing either way."
            :"Quiet has its own value."}</p>
        ${a.vnames && a.vnames.length ? `<div style="display:grid;gap:6px">
          ${a.vnames.slice(0,7).map(v=>`<div style="display:grid;
            grid-template-columns:1fr auto auto;gap:10px;align-items:center;font-size:13.5px;
            padding:5px 0;border-bottom:1px solid var(--line-2)">
            <span>${v.n}</span>
            ${v.l?`<span class="tagx e">late</span>`:"<span></span>"}
            <span style="color:var(--ink-3);font-variant-numeric:tabular-nums">
              ${v.d}m · ${Math.max(1,Math.round(v.d/80))} min</span></div>`).join("")}
        </div>` : ""}
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:10px">
          Entertainment permits · 86e8-rfem — licensed venues only, so restaurants and
          cafés without an entertainment permit aren't counted.</p>
      </div>

      <div class="dsec"><h4>The building's record</h4>
        ${a.parcel_ok ? `
        <div class="costrow"><span>Notices of violation</span><span></span>
          <span class="v">${n(a.novs)}</span></div>
        <div class="costrow"><span>Still open</span><span></span>
          <span class="v">${n(a.active)}</span></div>
        <div class="costrow"><span>Took over a year to fix</span><span></span>
          <span class="v" style="${a.over_year>5?'color:var(--or)':''}">${n(a.over_year)}</span></div>
        <div class="costrow"><span>Escalated to the City Attorney</span><span></span>
          <span class="v" style="${a.referred>0?'color:var(--or)':''}">${n(a.referred)}</span></div>
        ${a.abate_med!=null?`<div class="costrow"><span>Median time to fix</span><span></span>
          <span class="v">${a.abate_med} days</span></div>`:""}
        ${a.nov_top?`<p style="font-size:13px;color:var(--ink-2);margin-top:11px">
          Most common category: <b>${a.nov_top.split("|")[0]}</b> (${a.nov_top.split("|")[1]} items)</p>`:""}
        ${a.lots > 1 ? `<p style="font-size:12.5px;color:var(--ink-2);margin-top:9px">
          This building sits on ${a.lots} legal lots, so these totals are added across
          all of them. Looking at one lot alone would understate the record.</p>` : ""}
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:9px">
          DBI complaints · gm2e-bten &nbsp;·&nbsp; Notices of violation · nbtm-fbw5</p>`
        : `<p style="font-size:14px;color:var(--ink-2)">We couldn't match this listing to a
           specific building on the city's parcel map, so the building record isn't shown.
           ${a.fuzzy?"The source published only an approximate pin.":""}</p>`}
      </div>

      <div class="dsec"><h4>Rent protections</h4>
        <p style="font-size:16px;font-weight:640;margin-bottom:5px;
          color:${a.rc==='yes'?'var(--gr)':a.rc==='no'?'var(--ink-2)':'var(--or)'}">
          ${a.rc==='yes'?'Likely rent controlled':a.rc==='no'?'Not rent controlled':
            a.rc==='maybe'?'Depends on the tenancy':'Unknown'}</p>
        <p style="font-size:14px;color:var(--ink-2)">${a.rc_why||"No assessor record matched."}</p>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:9px">
          Assessor roll · wv5m-vpq2 &nbsp;·&nbsp; SF Admin Code §37.3</p>
      </div>

      <div class="dsec"><h4>Is this a real listing?</h4>
        <p style="font-size:16px;font-weight:640;margin-bottom:11px;
          color:${a.trust.level==="high"?"var(--gr)":a.trust.level==="low"?"var(--or)":"var(--ink)"}">
          ${a.trust.level==="high"?"Everything we can check, checks out"
            :a.trust.level==="low"?"Several things don't add up — verify before paying anything"
            :"Mostly checks out, with a few gaps"}</p>
        ${a.trust.ok.map(t=>`<div style="display:flex;gap:9px;font-size:13.5px;
          color:var(--ink-2);padding:5px 0"><span style="color:var(--gr)">✓</span>${t}</div>`).join("")}
        ${a.trust.warn.map(t=>`<div style="display:flex;gap:9px;font-size:13.5px;
          color:var(--ink-2);padding:5px 0"><span style="color:var(--or)">!</span>${t}</div>`).join("")}
        ${a.photo_reuse ? `<div class="recbox"><b>Photo reuse is the most common rental scam.</b>
          These images also appear on ${a.photo_reuse} other address${a.photo_reuse!==1?"es":""} in
          our data. That can be a management company reusing stock shots — or a stolen listing.
          Never send a deposit before seeing the unit in person.</div>` : ""}
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:10px">
          Parcel map · acdm-wktn &nbsp;·&nbsp; Registered businesses · g8m3-pdis</p>
      </div>

      <div class="dsec"><h4>Who you'd be renting from</h4>
        ${a.landlord ? `
          <p style="font-size:17px;font-weight:650;margin-bottom:5px">${a.landlord.name}</p>
          <p style="font-size:13.5px;color:var(--ink-2)">
            Registered with the city at this address${a.landlord.since?` since ${a.landlord.since}`:""}.
            ${a.landlord.portfolio>1?`This entity is registered at
              <b>${a.landlord.portfolio} addresses</b> in San Francisco.`:
              "Registered at this address only."}</p>
          ${a.landlord.conf==="weak"?`<p style="font-size:13px;color:var(--or);margin-top:9px">
            This building is small, so the registered business may be a tenant rather than
            the owner. Confirm before you rely on it.</p>`:""}
          <p style="font-size:13px;color:var(--ink-2);margin-top:11px">
            SF doesn't publish property-owner names, so this is the business registered to
            operate at the address — usually the landlord or their management company.</p>
        ` : `
          <p style="font-size:14px;color:var(--ink-2)">No business is registered with the city
          at this address. SF requires registration for buildings with 4+ rental units, so for
          a larger building that gap is worth asking about. For a small building it's normal.</p>`}
        <div style="margin-top:14px;padding-top:13px;border-top:1px solid var(--line-2)">
          <div id="ownerbox">
            <p style="font-size:13.5px;color:var(--ink-2)">
              SF doesn't publish deeds online. We can pull the owner of record on
              demand — one lookup, cached so you never spend it twice.</p>
          </div>
          <button class="viewbtn ghost" id="ownerbtn" data-lookup="${a.id}"
            data-addr="${(a.addr||"").replace(/"/g,"")}" style="margin-top:11px">
            Look up the owner</button>
        </div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:10px">
          Registered Business Locations · g8m3-pdis &nbsp;·&nbsp; RentCast (deeds)</p>
      </div>

      <div class="dsec"><h4>Your notes on this place</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="viewbtn ghost" data-act="contacted" data-id="${a.id}">
            ${MEM[a.id]&&MEM[a.id].contacted?"✓ Contacted":"Mark as contacted"}</button>
          <button class="viewbtn ghost" data-act="passed" data-id="${a.id}">
            ${MEM[a.id]&&MEM[a.id].passed?"✓ Passed":"Pass on this"}</button>
          ${MEM[a.id]&&(MEM[a.id].passed||MEM[a.id].contacted)?
            `<button class="viewbtn ghost" data-act="clear" data-id="${a.id}">Undo</button>`:""}
        </div>
        ${MEM[a.id]&&MEM[a.id].reason?
          `<p style="font-size:13.5px;color:var(--ink-2);margin-top:11px">
           You passed because: <b>${MEM[a.id].reason}</b></p>`:""}
        ${a.mem&&a.mem.days?`<p style="font-size:13px;color:var(--ink-3);margin-top:9px">
          You first saw this ${a.mem.days} day${a.mem.days===1?"":"s"} ago ·
          seen ${a.mem.seen||1} time${(a.mem.seen||1)===1?"":"s"}</p>`:
          `<p style="font-size:13px;color:var(--ink-3);margin-top:9px">
           First time you've seen this one.</p>`}
      </div>

      <div class="dsec"><h4>Where you found it</h4>
        <div class="srcbtns">${a.src.map(s=>
          `<button class="viewbtn ghost" data-src="${a.id}">View on ${s.n} ${IC.ext}</button>`).join("")}</div>
        <p style="font-size:13px;color:var(--ink-2);margin-top:11px">
          Contacting, touring and applying happen on the source site. We keep the record,
          the research and your notes.</p>
        ${a.multi?`<p style="font-size:13px;color:var(--gr);margin-top:8px">
          ✓ Merged from ${a.src.length} listings — you only see it once.</p>`:""}
      </div>
    </div>`;
  document.getElementById("drawer").classList.add("on");
  if (ownerCache[a.id]) renderOwner(a.id, ownerCache[a.id]);
  refreshQuota();
  document.getElementById("pcl").onclick = closeDrawer;
  // rAF never fires in a background tab; a timeout always does
  if (jump){
    setTimeout(() => jumpTo(jump), 0);
    setTimeout(() => jumpTo(jump, true), 500);
  }
  dApt = a;                                    // lay out first, then measure
  setTimeout(drawDrawerMap, 0);
  document.getElementById("panel").querySelectorAll("[data-dlayer]").forEach(b => {
    b.onclick = () => {
      dLayer = b.dataset.dlayer;
      document.getElementById("panel").querySelectorAll("[data-dlayer]")
        .forEach(x => x.classList.toggle("on", x === b));
      drawDrawerMap();
    };
  });
}
function closeDrawer(){ document.getElementById("drawer").classList.remove("on"); }
document.getElementById("scrim").onclick = closeDrawer;
addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

/* ---------- add apartment ---------- */
document.getElementById("addbtn").onclick = () => {
  document.getElementById("dupmsg").innerHTML = "";
  document.getElementById("addin").value = "";
  document.getElementById("adddlg").showModal();
};
document.getElementById("addcancel").onclick = () => document.getElementById("adddlg").close();
document.getElementById("addgo").onclick = () => document.getElementById("adddlg").close();
document.getElementById("addin").addEventListener("input", e => {
  const v = e.target.value.toLowerCase().trim();
  const hit = v.length > 5 && A.find(a => a.addr && a.addr.toLowerCase().includes(v.slice(0,14)));
  document.getElementById("dupmsg").innerHTML = hit
    ? `<div style="background:var(--am-bg);border:1px solid #EBD9A8;border-radius:7px;
         padding:11px 13px;font-size:13.5px;margin-bottom:11px">
       <b>You've already got this one.</b><br>${hit.addr} — found on
       ${hit.src.map(s=>s.n).join(" + ")}. We'll link this URL to the same record
       instead of creating a duplicate.</div>` : "";
});
document.querySelectorAll("nav a").forEach(x => x.onclick = () => {
  document.querySelectorAll("nav a").forEach(y => y.classList.remove("on"));
  x.classList.add("on");
  view = x.dataset.nav; selPinned = false; page = 24; render();
});
// Rebuilt from the declaration rather than retyped: the hand-written version
// omitted `src`, so pass() hit `F.src.size` on the next render and clicking the
// logo threw a TypeError that took the whole page down.
document.getElementById("logo").onclick = () => {
  F = { q:"", pmin:null, pmax:null, beds:new Set(), baths:new Set(),
        more:new Set(), src:new Set(), showActual:F.showActual };
  page = 24;
  document.getElementById("q").value = ""; render();
};

syncMemory();
sizeMap(); render();
