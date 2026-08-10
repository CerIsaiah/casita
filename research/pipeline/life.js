/* ============================================================
   MY LIFE — the quiz, the fit score, and the map that draws your
   life around an apartment.

   Two rules this file holds to:

   1. A score you can't interrogate is a horoscope. Every number here
      decomposes into four buckets, and every bucket decomposes into the
      specific facts that moved it. If a reason can't be stated in a sentence
      with a number in it, it doesn't get to affect the score.

   2. Only ask about housing. The quiz collects budgets, places you go, and
      what you'd trade — never age, income bracket, household makeup, or
      anything that stands in for a protected trait. "Right in the action"
      is a housing preference; "24 and single" is not, and would smuggle in
      a demographic proxy for the same answer.
   ============================================================ */

var LIFE_KEY = "huntly.life.v1";
// Separate from the profile: records that we offered the quiz, so declining it
// once doesn't mean being asked again on every visit.
var QUIZ_SEEN = "huntly.quiz.seen.v1";
var LIFE = (() => {
  try { return JSON.parse(localStorage.getItem(LIFE_KEY)) || null; }
  catch { return null; }
})();
function saveLife(){ try { localStorage.setItem(LIFE_KEY, JSON.stringify(LIFE)); } catch {} }

/* The quiz changed shape: budget/anchors/brands/night/commute/priorities became
   budget/near/needs/safety, and the new answers are the ones the score reads.
   A profile saved by the old build still had `done: true`, so lifeOn() was
   satisfied, first-run never fired, and returning users were silently ranked
   with `near` and `musts` undefined -- every listing scored as if they had asked
   for nothing. Bumping the version is what makes them get asked again. */
var LIFE_V = 2;
function lifeOn(){ return !!(LIFE && LIFE.done && LIFE.v === LIFE_V); }

/* ---------- geography ---------- */
var M_LAT = 110540, mLon = la => 111320 * Math.cos(la * Math.PI / 180);
function metres(la1, lo1, la2, lo2){
  const x = (lo2 - lo1) * mLon(la1), y = (la2 - la1) * M_LAT;
  return Math.hypot(x, y);
}
// Straight-line under-reads real routes; SF's grid costs roughly 30% extra.
// Speeds are door-to-door including the waiting and parking nobody counts.
var CIRCUITY = 1.30;
var SPEED = { walk: 78, bike: 200, transit: 240, drive: 330 };   // metres/minute
var modeName = { walk:"walk", bike:"bike", transit:"transit", drive:"drive" };
function minutesTo(a, lat, lon, mode){
  const d = metres(a.lat, a.lon, lat, lon) * CIRCUITY;
  return Math.max(1, Math.round(d / (SPEED[mode] || SPEED.walk)));
}
// short hops are walked whatever you said you'd do
function autoMode(a, lat, lon, pref){
  const d = metres(a.lat, a.lon, lat, lon) * CIRCUITY;
  if (d < 1300) return "walk";
  return pref || "transit";
}

/* ---------- the place index ---------- */
var PL = (typeof PLACES !== "undefined") ? PLACES : [];
var plGrid = {};
for (const p of PL){
  const k = `${Math.round(p.la/0.006)},${Math.round(p.lo/0.006)}`;
  (plGrid[k] = plGrid[k] || []).push(p);
}
var _nearCache = new Map();
function nearest(a, kind, brand){
  const key = a.id + "|" + kind + "|" + (brand||"");
  if (_nearCache.has(key)) return _nearCache.get(key);
  const r = nearestUncached(a, kind, brand);
  _nearCache.set(key, r);
  return r;
}
function nearestUncached(a, kind, brand){
  let best = null, bd = Infinity;
  const ci = Math.round(a.lat/0.006), cj = Math.round(a.lon/0.006);
  for (let r = 1; r <= 4 && !best; r++){
    for (let i = ci-r; i <= ci+r; i++) for (let j = cj-r; j <= cj+r; j++){
      for (const p of (plGrid[`${i},${j}`] || [])){
        if (p.k !== kind) continue;
        if (brand && !(p.b === brand || p.n === brand ||
                       (p.n||"").toLowerCase().includes(brand.toLowerCase()))) continue;
        const d = metres(a.lat, a.lon, p.la, p.lo);
        if (d < bd){ bd = d; best = p; }
      }
    }
    if (best) break;
  }
  return best ? { p: best, m: bd } : null;
}

// Distance to the nearest one answers "can I get there". Density answers "is
// this a scene", which is the actual question behind wanting to live near the
// bars: one good bar on an empty block is not a night out, and the fifteenth
// adds nothing. Same 0.006-degree grid; a ring of one covers 800m comfortably.
var _countCache = new Map();
function countWithin(a, kind, radius){
  const key = a.id + "|" + kind + "|" + radius;
  if (_countCache.has(key)) return _countCache.get(key);
  let n = 0;
  const ci = Math.round(a.lat/0.006), cj = Math.round(a.lon/0.006);
  for (let i = ci-1; i <= ci+1; i++) for (let j = cj-1; j <= cj+1; j++)
    for (const p of (plGrid[`${i},${j}`] || []))
      if (p.k === kind && metres(a.lat, a.lon, p.la, p.lo) <= radius) n++;
  _countCache.set(key, n);
  return n;
}

/* ---------- what "your life" resolves to for one apartment ---------- */
function legs(a){
  if (!lifeOn()) return [];
  const out = [];
  for (const an of LIFE.anchors || []){
    const mode = autoMode(a, an.lat, an.lon, an.mode);
    out.push({ label: an.label, icon: an.icon || "📍", lat: an.lat, lon: an.lon,
               mins: minutesTo(a, an.lat, an.lon, mode), mode, fixed: true });
  }
  const wants = [
    ["grocery", LIFE.groceryBrand, "🛒", LIFE.groceryBrand || "Groceries"],
    ["gym",     LIFE.gymBrand,     "🏋️", LIFE.gymBrand || "Gym"],
    ["transit", null,              "🚇", "Transit"],
  ];
  for (const [kind, brand, icon, label] of wants){
    if (LIFE.skip && LIFE.skip.includes(kind)) continue;
    let n = brand ? nearest(a, kind, brand) : null;
    let exact = !!n;
    if (!n) n = nearest(a, kind, null);
    if (!n) continue;
    const mode = autoMode(a, n.p.la, n.p.lo, "walk");
    out.push({ label: exact ? label : (n.p.n || label), icon, lat: n.p.la, lon: n.p.lo,
               mins: minutesTo(a, n.p.la, n.p.lo, mode), mode,
               sub: exact ? n.p.n : (brand ? `nearest ${kind}, not ${brand}` : null) });
  }
  return out;
}

/* ============================================================
   THE SCORING PIPELINE

   Hard constraints  ->  Personal Fit  ->  Property Quality  ->  Match

   Three separate ideas, deliberately not blended into one:

   * A hard constraint is a wall, not a weight. "I will not pay over $3,000"
     must not be outvoted by a short commute and a nice kitchen.
   * Personal Fit answers "how good is this for you", and is meaningless
     without your targets.
   * Property Quality answers "is this a good building", and must not move
     when your preferences do -- otherwise a bad building wins on being cheap.

   Every listing gets a Match. Missing facts are normalised out of the
   denominator rather than scored as zero, and surface as confidence instead.
   ============================================================ */

/* Piecewise curve through control points: [[value, score], ...].
   Preferences have an ideal zone and then decay, so a single threshold
   ("under budget ✓") throws away most of what the user told us. */
function curve(v, pts){
  if (v == null) return null;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++){
    if (v <= pts[i][0]){
      const [x0,y0] = pts[i-1], [x1,y1] = pts[i];
      return y0 + (y1-y0) * ((v-x0) / (x1-x0 || 1));
    }
  }
  return pts[pts.length-1][1];
}

function priceTargets(){
  const p = LIFE.price || {};
  const ideal = p.ideal || Math.round((LIFE.budget || 3000) * 0.78);
  const comf  = p.comfortable || Math.round((LIFE.budget || 3000) * 0.92);
  const max   = p.max || LIFE.budget || 3200;
  return { ideal, comf, max };
}
function commuteTargets(){
  const c = LIFE.commute || {};
  return { ideal: c.ideal || 15, ok: c.ok || (LIFE.commuteTol || 25), bad: c.bad || 40 };
}

/* ---------- going out ----------
   "Near the bars" is four different requests, so it is scored four ways. Each
   is a count within a ten-minute walk of the kind of place you named.

   The first version of this ran entirely off SF entertainment permits, and the
   permits do not mean what their names suggest. "Extended Hours Premises" is a
   licence to trade late, held by Silvercrest Donuts, The Mosser Hotel and
   SOMArts Cultural Center as readily as by a club. "Limited Live Performance"
   covers Fior d'Italia and a charitable foundation. Ranking a party block off
   those put donut shops in the numerator.

   So density comes from OSM, which says bar when it means bar, and the permits
   are kept only for the one thing OSM can't tell us -- which of these is
   licensed to still be open at 2am -- at a weight that reflects how noisy the
   signal is. */
/* Each kind is scored on its own saturation curve and then blended, rather than
   having its counts added together. Summing them looked simpler and was wrong:
   there are 463 bars in the city against 53 music venues, so a single total let
   bars swamp everything, and "live music" came back with a block that has
   fourteen bars and no music venue at all as its top result.

   Each entry is [kind, saturation curve, weight]. The weight is what stops a
   secondary kind from standing in for the one you actually asked for. */
var NIGHT_KINDS = {
  any:   { parts: [["bar",   [[0,0],[2,.40],[8,.80],[18,1]], 1],
                   ["club",  [[0,0],[1,.50],[3,.85],[6,1]],  1],
                   ["music", [[0,0],[1,.50],[3,.85],[7,1]],  0.8]], late: 0.30 },
  bars:  { parts: [["bar",   [[0,0],[2,.40],[7,.80],[16,1]], 1],
                   ["club",  [[0,0],[1,.50],[3,.85],[6,1]],  0.6]], late: 0.35 },
  music: { parts: [["music", [[0,0],[1,.50],[3,.85],[7,1]],  1],
                   ["bar",   [[0,0],[3,.40],[10,.80],[20,1]], 0.3]], late: 0.20 },
  food:  { parts: [["restaurant", [[0,0],[8,.40],[25,.80],[60,1]], 1],
                   ["cafe",       [[0,0],[5,.40],[15,.80],[35,1]], 0.5]], late: 0.15 },
};
// Null-safe: app.js filters on this before any profile exists.
function nightSpec(){ return NIGHT_KINDS[LIFE && LIFE.nightKind] || NIGHT_KINDS.any; }

function nightlifeScore(a){
  const spec = nightSpec();
  let num = 0, den = 0;
  for (const [kind, pts, w] of spec.parts){
    num += curve(countWithin(a, kind, 800), pts) * w;
    den += w;
  }
  const density = den ? num / den : 0;
  const late = curve(a.late || 0, [[0,0],[2,0.5],[5,0.85],[9,1]]);
  return cl(density * (1 - spec.late) + late * spec.late, 0, 1);
}
// What the score actually saw, for the card to quote instead of asserting.
function nightlifeCounts(a){
  const out = {};
  for (const [kind] of nightSpec().parts) out[kind] = countWithin(a, kind, 800);
  return out;
}

/* ---------- amenities ----------
   The thinnest column we have: unit_amen is on 25% of listings and wd on the
   same 25%. Scoring only those would quietly rank a quarter of the city and
   leave the rest at the prior, which reads as "no amenities" to anyone looking
   at the list.

   So when the listing doesn't say, fall back to the three facts that predict an
   amenity building and are on ~95% of records: when it was built, how many
   units it has, and whether a management company is behind it. A 2019 tower
   with 240 units has a gym. Returns `known` so the UI can say which one it is
   rather than passing off a guess as a fact. */
function amenityScore(a){
  if (a.unit_amen && a.unit_amen.length)
    return { v: cl(a.unit_amen.length / 7, 0, 1), known: true };
  const parts = [];
  if (a.yr)    parts.push(curve(a.yr,    [[1920,0.15],[1970,0.25],[2000,0.6],[2015,0.9],[2020,1]]));
  if (a.units) parts.push(curve(a.units, [[4,0.1],[20,0.3],[60,0.65],[200,0.95]]));
  if (((a.areview || {}).mgmt || {}).name) parts.push(0.8);
  if (!parts.length) return { v: null, known: false };
  return { v: cl(parts.reduce((s,x) => s+x, 0) / parts.length, 0, 1), known: false };
}

/* ---------- safety ----------
   Safety is a gate, not a term, and this is the whole reason the old score
   couldn't answer "near the bars but somewhere safe".

   Averaged in with everything else, a block in the worst 5% of the city for
   assaults scores the same as a calm one as long as the rent is low and the
   bars are close — which is exactly the trade someone who said "dealbreaker"
   told us not to make. Worse, in SF late venues and violent crime are strongly
   correlated (Tenderloin, SoMa, the Mission), so an average hands the same
   mediocre number to a party block that is genuinely dangerous and to a safe
   block with nothing to do, and the rare listing that wins both never surfaces.

   Multiplying instead means a bad block can cost a listing most of its match
   and no amount of nightlife buys it back. The floor is how far it can fall. */
const SAFETY_FLOOR = { dealbreaker: 0.30, alot: 0.55, some: 0.80, fine: 1 };

/* A percentile built on almost no reports is not a safety record, it's a blank
   page. 5% of listings sit within 250m of fewer than ~90 total street reports --
   low-density blocks where nobody calls 311 -- against a city median of 1,082,
   and they swept the top of every safety-first ranking purely for having nothing
   on file. Treasure Island came back as the safest place in San Francisco.

   So percentiles get pulled toward the middle in proportion to how thin the
   coverage behind them is: the same correction ratings and building records
   already get here, for the same reason. */
function streetCoverage(a){
  const s = a.street || {};
  return (s.violent||0) + (s.break_in||0) + (s.encampment||0) + (s.cleaning||0);
}
function streetPct(a, k){
  const v = (a.street_pct || {})[k];
  if (v == null) return null;
  const trust = cl(streetCoverage(a) / 300, 0, 1);
  return v * trust + 45 * (1 - trust);
}
function safetyRisk(a){
  const v = streetPct(a, "violent"), b = streetPct(a, "break_in");
  if (v == null && b == null) return null;
  // A mugging and a smashed window are not the same event; violent counts double.
  return cl(((v ?? b) * 2 + (b ?? v)) / 300, 0, 1);
}
function safetyGate(a){
  const floor = SAFETY_FLOOR[LIFE.safety || "some"] ?? 0.8;
  if (floor >= 1) return 1;
  const risk = safetyRisk(a);
  if (risk == null) return 1;
  // Nothing below the middle of the city counts as unsafe — penalising a median
  // block would just deflate every score equally and tell you nothing. Past that
  // it bites, and accelerates.
  const over = cl((risk - 0.55) / 0.45, 0, 1);
  return cl(1 - (1 - floor) * Math.pow(over, 1.5), floor, 1);
}

/* ---------- hard constraints ---------- */
// Returns the list of walls this listing runs into. Empty means eligible.
function breaches(a){
  const h = LIFE.hard || {}, out = [];
  const act = a.act ? a.act[0] : a.rent;
  const max = h.maxCost || priceTargets().max;
  if (max && act > max) out.push(`${money(act)} is over your ${money(max)} ceiling`);
  if (h.beds != null && a.beds != null && a.beds < h.beds)
    out.push(`${bedTxt(a.beds)}, you need ${h.beds}+ bed`);
  if (h.minSqft && a.sqft && a.sqft < h.minSqft)
    out.push(`${n(a.sqft)} sq ft, under your ${n(h.minSqft)} minimum`);
  if (h.wd && a.wd === false) out.push("no in-unit washer/dryer");
  // Musts are walls only where the data can say no out loud. unit_amen is
  // published by a quarter of listings, so blocking on a missing amenity would
  // punish the ads that bothered to itemise anything and quietly promote the
  // ones that told us nothing. Rent control is on 95% of records, and only a
  // flat "no" counts -- "maybe" is the city's own hedge, not a rejection.
  if ((LIFE.musts || []).includes("rc") && a.rc === "no")
    out.push("city records say this building is not rent-controlled");
  if (LIFE.safety === "dealbreaker"){
    // The last raw-percentile read on the safety path. It happened to agree with
    // the corrected one today only because thin-coverage blocks all sit at raw 0.
    const vi = streetPct(a, "violent");
    if (vi >= 90)
      out.push(`assaults and robberies nearby busier than ${Math.round(vi)}% of listings here`);
  }
  if (h.maxCommute){
    const w = (legs(a) || []).find(l => l.fixed);
    if (w && w.mins > h.maxCommute)
      out.push(`${w.mins} min to ${w.label}, over your ${h.maxCommute} min limit`);
  }
  if ((h.avoid || []).length && a.hood && h.avoid.includes(a.hood))
    out.push(`${a.hood} is on your avoid list`);
  return out;
}

/* ---------- weighted travel burden ---------- */
// A seven-minute gain on a five-day commute is worth more than the same gain on
// a grocery run. Weight every trip by how often it happens and how much it matters.
const FREQ = { daily: 6, often: 4, weekly: 2, rarely: 0.5 };
const IMP  = { vhigh: 3, high: 2, med: 1, low: 0.5 };
function travel(a){
  const lg = legs(a);
  if (!lg.length) return null;
  let burden = 0, weight = 0, worst = null;
  const t = commuteTargets();
  for (const l of lg){
    const f = FREQ[l.freq || (l.fixed ? "daily" : "weekly")];
    const w = IMP[l.importance || (l.fixed ? "vhigh" : "med")];
    const wt = f * w;
    const cap = l.fixed ? t : { ideal: 8, ok: 15, bad: 25 };
    const sc = curve(l.mins, [[cap.ideal,100],[cap.ok,72],[cap.bad,20],[cap.bad*1.8,0]]);
    burden += wt * sc; weight += wt;
    l.score = Math.round(sc);
    if (!worst || sc < worst.score) worst = l;
    l.weekly = Math.round(f * l.mins * 2);        // round trips per week
  }
  return { score: weight ? burden/weight/100 : null, legs: lg, worst,
           weekly: lg.reduce((s,l)=>s+(l.weekly||0),0) };
}

/* ---------- the six personal dimensions ---------- */
/* Cost has to keep discriminating below the ideal number, or it stops being a
   dimension at all.

   The old curve pinned everything at or under `ideal` (0.78 x budget) to a flat
   100. But the hard ceiling has already removed everything above budget, so
   among the listings that survive, most sit under the ideal and saturate:
   measured p50 = 0.98, p90 = 1.00. That handed a quarter of the total weight to
   a near-constant, which is exactly what makes every score come out near the
   same number -- the same defect as the commute dimension scoring errands for
   people with no anchor.

   Below-ideal now still improves the score, just gently: $1,800 against a
   $3,000 budget genuinely is better on cost than $2,300, and saying they are
   identical throws away the only thing cost knows. */
function dimCost(a){
  const t = priceTargets(), act = a.act ? a.act[0] : a.rent;
  return curve(act, [[t.max * 0.45, 100], [t.ideal, 86], [t.comf, 68],
                     [t.max, 35], [t.max * 1.12, 0]]) / 100;
}
// The amenity chips, and what counts as satisfying one in unit_amen's fixed
// 15-value vocabulary.
const AMEN_MATCH = [
  ["dishwasher", /dishwasher/i],
  ["ac",         /air condition/i],
  ["outdoor",    /patio|balcony|deck/i],
];
function dimApartment(a){
  const parts = [], push = (v,w=1) => { if (Number.isFinite(v) && w > 0) parts.push([cl(v,0,1),w]); };
  const musts = LIFE.musts || [], wants = k => musts.includes(k);
  if (a.sqft){
    const want = (LIFE.hard||{}).idealSqft || (LIFE.space ? 750 : 500);
    push(curve(a.sqft, [[want*0.55,25],[want*0.8,70],[want,100],[want*1.6,100]])/100, 2);
  }
  if (a.wd !== undefined) push(a.wd ? 1 : 0.3, wants("wd") ? 3 : 1.5);
  const am = amenityScore(a);
  if (am.v != null) push(am.v, wants("amenities") ? 3 : 1);
  // A named amenity is only scored where the listing actually itemised its
  // amenities. Silence is not evidence of absence, so a listing with no list
  // sits this term out rather than taking a hit for a blank field.
  if (a.unit_amen)
    for (const [k, re] of AMEN_MATCH)
      if (wants(k)) push(a.unit_amen.some(x => re.test(x)) ? 1 : 0, 1.5);
  if (wants("rc")) push(a.rc === "yes" ? 1 : a.rc === "maybe" ? 0.5 : 0, 2);
  if (a.yr) push(curve(a.yr, [[1900,0.5],[1950,0.6],[1990,0.8],[2015,1]]), 0.5);
  const num = parts.reduce((s,[v,w])=>s+v*w,0), den = parts.reduce((s,[,w])=>s+w,0);
  return den ? num/den : null;
}
function dimNeighborhood(a){
  const parts = [], push = (v,w=1) => { if (Number.isFinite(v)) parts.push([cl(v,0,1),w]); };
  const want = (LIFE.night ?? 2) / 4;
  // Noise is the nuisance side of nightlife, and it is deliberately scored apart
  // from wanting bars nearby (which lives in Lifestyle). You can be two blocks
  // from the strip without living above it, and those are different apartments.
  // night_pct is the share of 311 noise reports here landing 22:00-05:00.
  push(1 - Math.abs(cl((a.night_pct || 0) / 55, 0, 1) - want), 2);
  const snd = (a.scores||{}).sound;
  if (snd != null) push(1 - Math.abs(snd/100 - want), 1);
  // Street conditions stay at a fixed weight here. How much they matter to *you*
  // is carried by safetyGate(), which multiplies the finished score -- counting
  // the same answer in both places would let it swamp the other five dimensions.
  const br = streetPct(a,"break_in"), vi = streetPct(a,"violent"),
        en = streetPct(a,"encampment"), cle = streetPct(a,"cleaning");
  if (br != null) push(1 - ((br + (vi ?? br)) / 2) / 100, 1.5);
  if (en != null) push(1 - en/100, LIFE.streetMatters ? 1.5 : 0.5);
  if (cle != null) push(1 - cle/100, 0.5);
  const num = parts.reduce((s,[v,w])=>s+v*w,0), den = parts.reduce((s,[,w])=>s+w,0);
  return den ? num/den : null;
}
function dimBuilding(a){
  if (!a.parcel_ok) return null;
  const parts = [];
  // DBI inspects every building in SF, so a clean record is genuine evidence --
  // but a clean record on a four-unit building says far less than a clean record
  // on two hundred units, because there was far less to go wrong.
  const units = Math.max(1, a.units || 1);
  const depth = cl(Math.log2(units + 1) / 6, 0.15, 1);
  let rec = 1 - cl((a.novs||0) / units / 1.5, 0, 1);
  rec -= cl((a.active||0)/8, 0, 0.25);
  rec -= cl((a.over_year||0)/6, 0, 0.25);
  if (a.referred > 0) rec -= 0.15;
  parts.push([cl(rec, 0, 1), 2 * depth]);

  const sr = shrunkRating(a);
  if (sr !== null) parts.push([cl((sr-2.5)/2, 0, 1), cl((a.rating_n||0)/12, 0.3, 2)]);

  const num = parts.reduce((s,[v,w])=>s+v*w, 0), den = parts.reduce((s,[,w])=>s+w, 0);
  // Nothing known is not the same as nothing wrong. Pull toward the middle in
  // proportion to how thin the evidence is; 24% of listings were scoring a
  // flawless building purely because no one had ever reviewed or cited them.
  const PRIOR = 1.3;
  return (num + 0.5*PRIOR) / (den + PRIOR);
}

// Confidence should describe the evidence, not how many formulas happened to
// return a number. Street data covers the whole city, so every listing could
// always compute a "neighbourhood" score and look well understood.
function evidence(a){
  let e = 0;
  if ((a.rating_n||0) >= 10) e += 2; else if (a.rating_n) e += 1;
  if (a.est === "verified") e += 1;
  if (a.sqft) e += 1;
  if (a.parcel_ok) e += 1;
  if ((a.units||0) >= 15) e += 1;
  if (a.unit_amen && a.unit_amen.length) e += 1;
  return e;                                   // out of 7
}

/* What you said you want to be near, in the order you picked it. Once you have
   named something, the things you didn't name stop competing with it -- they
   still separate two otherwise identical listings, they no longer outvote the
   answer you actually gave. */
const NEAR_PICKED = [3, 2, 1.4];
const NEAR_BASE = { grocery:0.9, transit:0.9, gym:0.4, cafe:0.4, park:0.4, nightlife:0 };
function nearWeight(kind){
  const picks = LIFE.near || [], i = picks.indexOf(kind);
  if (i >= 0) return NEAR_PICKED[i] ?? 1;
  return picks.length ? 0.2 : (NEAR_BASE[kind] ?? 0.4);
}
// Bars are the one "near what" answer with no POI pin behind it -- it comes off
// the city's entertainment permits instead. Everything else is walking distance.
function proximityScore(a, kind){
  if (kind === "nightlife") return nightlifeScore(a);
  const brand = kind==="grocery" ? LIFE.groceryBrand : kind==="gym" ? LIFE.gymBrand : null;
  const nr = (brand && nearest(a, kind, brand)) || nearest(a, kind, null);
  return nr ? curve(nr.m, [[300,1],[800,0.75],[1600,0.35],[3000,0]]) : null;
}

/* Pets gate only if you said you have one, and gently, because the evidence is
   weak in a particular direction. Apartments.com publishes no "not allowed"
   value at all -- only "Allowed" and a list of charges -- and an unticked
   Craigslist pet box means the poster skipped a checkbox, not that the landlord
   said no. Neither source can produce a confident refusal, so this pushes a
   listing down and says why; it is never allowed to hide one. */
function petGate(a){
  if (!(LIFE.musts || []).includes("pets")) return 1;
  if (!a.pet) return 0.92;              // nobody published a policy either way
  return a.pet.ok ? 1 : 0.75;           // the form asked, and got no answer
}

/* Your first pick is a requirement, not a tiebreaker.

   Averaged in with five other dimensions it came out at roughly 6% of the final
   score -- which is how the first version of this answered "I want to be near
   the bars" with Treasure Island, an island with none. So it gates too, at a
   gentler floor than safety: being far from what you asked for is a
   disappointment, not a hazard. */
function wantGate(a){
  const top = (LIFE.near || [])[0];
  if (!top) return 1;
  const v = proximityScore(a, top);
  // Floor raised from 0.5. dimLifestyle already weights the first pick at 3
  // against 0.2 for anything unpicked, so a 0.5 floor was charging for the same
  // answer twice -- mean gate 0.77 across the list, which is a level shift
  // rather than a distinction. This still buries a listing with none of what you
  // asked for without taxing everything else to do it.
  return v == null ? 1 : cl(0.65 + 0.35 * v, 0.65, 1);
}

function dimLifestyle(a){
  const parts = [], push = (v,w=1) => { if (Number.isFinite(v) && w > 0) parts.push([cl(v,0,1),w]); };
  for (const kind of ["grocery","gym","transit","cafe","park","nightlife"])
    push(proximityScore(a, kind), nearWeight(kind));
  const walk = (a.scores||{}).walk;
  if (walk != null) push(walk/100, (LIFE.near||[]).length ? 0.5 : 1);
  const num = parts.reduce((s,[v,w])=>s+v*w,0), den = parts.reduce((s,[,w])=>s+w,0);
  return den ? num/den : null;
}

var DIMS = [
  ["cost",        "Price",        "Actual monthly against your targets"],
  ["commute",     "Commute",      "Weighted by how often you make each trip"],
  ["neighborhood","Neighborhood", "Night-time character and street conditions"],
  ["apartment",   "Apartment",    "Size, laundry, condition of the unit"],
  ["building",    "Building",     "Repair record and what residents say"],
  ["lifestyle",   "Lifestyle",    "Groceries, gym, transit, coffee, parks"],
];
var DEFAULT_W = { cost:25, commute:20, neighborhood:20, apartment:15, building:10, lifestyle:10 };
var IMPORTANCE_MULT = { vhigh:2, high:1.5, med:1, low:0.4, none:0 };

function dimWeights(){
  const imp = LIFE.importance || {};
  const w = {};
  for (const k in DEFAULT_W) w[k] = DEFAULT_W[k] * (IMPORTANCE_MULT[imp[k]] ?? 1);
  return w;
}

/* ---------- property quality: the same for everyone ---------- */
function quality(a){
  const parts = [], push = (v,w=1) => { if (Number.isFinite(v)) parts.push([cl(v,0,1),w]); };
  if (a.sqft) push(cl((a.sqft-280)/750, 0, 1), 1);
  if (a.unit_amen) push(cl(a.unit_amen.length/6, 0, 1), 1);
  const b = dimBuilding(a); if (b != null) push(b, 2.5);
  const sr = shrunkRating(a); if (sr !== null) push(cl((sr-2.5)/2,0,1), 2);
  const snd = (a.scores||{}).sound; if (snd != null) push(1 - snd/100, 1);
  // Coverage-corrected like every other consumer. This one matters most: quality
  // is 25% of every fit score and the sort key behind "Best apartment", so the
  // Treasure-Island effect -- a blank page reading as a spotless block -- was
  // still live here after it had been fixed everywhere else.
  const br = streetPct(a, "break_in"), vi = streetPct(a, "violent");
  if (br != null) push(1 - ((br + (vi ?? br)) / 2) / 100, 1.5);
  const num = parts.reduce((s,[v,w])=>s+v*w,0), den = parts.reduce((s,[,w])=>s+w,0);
  if (!den) return { score: null, known: 0 };
  // Thin evidence must not produce a perfect building. Pull the score toward
  // average in proportion to how little is actually known about the place --
  // the same correction ratings get, for the same reason.
  const PRIOR = 3.5;
  const score = Math.round((num + 0.5*PRIOR) / (den + PRIOR) * 100);
  return { score, known: den };
}

/* ---------- the match ---------- */
var BUCKETS = DIMS.map(([k,l]) => [k,l]);

// Sorting calls fit() twice per comparison, and every card calls it again, so a
// 2,500-listing render was recomputing grid searches tens of thousands of times
// and locking the tab. The answer only changes when the profile changes.
var _fitCache = new Map(), _fitStamp = "";
function lifeStamp(){ return lifeOn() ? JSON.stringify(LIFE) : ""; }
function invalidateFit(){ _fitCache.clear(); _fitStamp = lifeStamp(); }

function fit(a){
  if (!lifeOn()) return null;
  const stamp = _fitStamp || (_fitStamp = lifeStamp());
  const hit = _fitCache.get(a.id);
  if (hit && hit.stamp === stamp) return hit.v;
  const v = computeFit(a);
  _fitCache.set(a.id, { stamp, v });
  return v;
}
function computeFit(a){
  const tv = travel(a);
  const d = {
    cost: dimCost(a),
    // No anchor means nothing to commute to. Dropping the weight to "low" wasn't
    // enough: travel() still scored the grocery/gym/transit legs, came back at a
    // near-constant 0.99, and handed every listing the same free points while
    // double-counting the errands dimLifestyle already measures. Absence is
    // normalised out of the denominator, so null is the honest value.
    commute: (LIFE.anchors || []).length ? (tv ? tv.score : null) : null,
    neighborhood: dimNeighborhood(a),
    apartment: dimApartment(a),
    building: dimBuilding(a),
    lifestyle: dimLifestyle(a),
  };
  const w = dimWeights();
  let num = 0, known = 0, total = 0;
  for (const k in w){
    total += w[k];
    if (d[k] == null) continue;
    num += w[k]*d[k]; known += w[k];
  }
  // normalise over what is known; absence becomes confidence, not a penalty
  const personal = known ? num/known : null;
  const q = quality(a);
  const cover = total ? known/total : 0;
  const ev = evidence(a);
  const conf = ev >= 5 ? "High" : ev >= 3 ? "Medium" : "Low";
  const blended = personal == null ? null
            : (q.score == null ? personal*100 : personal*100*0.75 + q.score*0.25);
  // Safety multiplies rather than averages -- see safetyGate(). Both numbers are
  // returned so the card can show the drop and name it, instead of quietly
  // handing back a lower score with no account of where it went.
  const safe = safetyGate(a), want = wantGate(a), pet = petGate(a);
  const gate = safe * want * pet;
  const raw = blended == null ? null : blended * gate;
  const hard = breaches(a);
  const score = Number.isFinite(raw) ? Math.round(raw) : null;
  return { score, d, w, q: q.score, lg: tv ? tv.legs : [], travel: tv,
           gate, safeGate: safe, wantGate: want, petGate: pet,
           ungated: Number.isFinite(blended) ? Math.round(blended) : null,
           conf, cover, ev, hard, blocked: hard.length > 0,
           b: d, label: fitLabel(score) };   // b kept so older callers keep working
}
/* Calibrated against the actual spread, which the old cutoffs (85/72/58/45)
   never were -- they predated the gates and were guesses either way. Measured
   over four profiles: with no stated preferences the field runs p50 62 / max 83,
   and the more you ask for the harder it compresses, down to p50 35 / max 60 for
   "$3k, near the bars, pet-friendly, safe streets".

   The compression is the honest part and is left alone. A demanding search in
   this city really does top out at "worth a look", and saying so beats inflating
   it -- but the best thing available should not have read "Mixed", which is what
   these thresholds used to do. */
var fitLabel = s => s == null ? "" : s >= 78 ? "Excellent match" : s >= 64 ? "Strong match"
                  : s >= 50 ? "Worth a look" : s >= 36 ? "Mixed" : "Poor match";

/* The colour has to turn where the words turn. app.js coloured rows green at 72
   and amber at 58 while the labels moved at 78/64/50, so a listing reading
   "Strong match" rendered amber -- and under a demanding profile the gold-medal
   "Best overall" pick came out the same colour as the worst thing on the page.
   One threshold set, used everywhere. */
var fitTone = s => s == null ? "var(--ink-3)" : s >= 64 ? "var(--gr)"
                 : s >= 50 ? "var(--am)" : "var(--or)";

/* When the whole field is weak, name what is costing it. A row of mediocre
   scores with no explanation reads as a broken ranker; the same row with "your
   safety answer is what's holding these down" reads as an answer. */
function whyLow(f){
  if (!f) return null;
  const top = (LIFE.near || [])[0];
  const nearLbl = ((NEAR_OPTS.find(o => o[0] === top) || [,, ""])[2] || "").toLowerCase();
  const drags = [
    [f.safeGate, "calm streets"],
    [f.wantGate, nearLbl ? `being near ${nearLbl}` : "what you asked to be near"],
    [f.petGate,  "pet-friendly buildings"],
  ].filter(([g]) => g != null && g < 0.97).sort((a, b) => a[0] - b[0]);
  if (!drags.length) return null;
  return `Asking for ${drags[0][1]} is what holds these scores down — little in this ` +
         `city does all of it at once.`;
}

/* Ties in this list are real, and are left visible.

   A demanding profile produces a top forty of 52,51,51,51,50,49,49,49,48...
   -- twelve distinct values across forty listings -- because a weighted mean of
   six bounded dimensions concentrates toward the middle by construction. That
   looks broken and isn't: on the criteria given, those forty places really are
   near-equivalent.

   Calibrating the displayed number to the field was tried and reverted. It made
   the range look healthy (3-99) while making the top *worse* -- ten distinct
   values instead of twelve, since equal raw scores map to equal percentiles --
   and it printed "99 Match" on a listing the honest label calls "Worth a look".
   A score that disagrees with its own label is the horoscope this file opens by
   refusing to be.

   What separates near-equal listings is the reasons on the card, and rank,
   which says plainly that #7 and #8 are a hair apart rather than implying a gap
   the data cannot support. Rank is indexed in app.js, where the rendered list
   already exists. */

/* Reasons come out of the same numbers the score used, each tagged by how it
   actually lands: good, tolerable, or a problem. */
function reasons(a, f){
  const R = [];
  const t = priceTargets(), act = a.act ? a.act[0] : a.rent;
  if (act <= t.ideal) R.push(["g", `${money(t.ideal-act)} under your ideal budget`]);
  else if (act <= t.comf) R.push(["y", `${money(act-t.ideal)} over ideal, still comfortable`]);
  else if (act <= t.max) R.push(["r", `${money(act-t.comf)} above what you called comfortable`]);
  else R.push(["r", `${money(act-t.max)} over your absolute maximum`]);

  const w = f.lg.find(l => l.fixed);
  if (w){
    const ct = commuteTargets();
    R.push([w.mins <= ct.ideal ? "g" : w.mins <= ct.ok ? "y" : "r",
            `≈${w.mins} min to ${w.label}`]);
  }
  if (a.sqft){
    const want = (LIFE.hard||{}).idealSqft || (LIFE.space ? 750 : 500);
    if (a.sqft < want*0.7) R.push(["y", `${n(a.sqft)} sq ft is smaller than you prefer`]);
    else if (a.sqft >= want) R.push(["g", `${n(a.sqft)} sq ft`]);
  }
  if (a.wd === true) R.push(["g", "washer/dryer in the unit"]);
  else if (a.wd === false) R.push(["y", "no washer/dryer in the unit"]);

  if ((LIFE.near || []).includes("nightlife")){
    const nl = nightlifeScore(a), c = nightlifeCounts(a);
    const LBL = {bar:["bar","bars"], club:["club","clubs"],
                 music:["music venue","music venues"],
                 restaurant:["restaurant","restaurants"], cafe:["café","cafés"]};
    const bits = Object.entries(c).filter(([,v]) => v)
      .map(([k,v]) => `${v} ${(LBL[k] || [k,k])[v === 1 ? 0 : 1]}`);
    R.push([nl >= 0.6 ? "g" : nl >= 0.3 ? "y" : "r",
            (bits.length ? bits.join(", ") : "nothing of the kind you asked for") +
            " within a 10-min walk" +
            (a.late ? `, ${a.late} licensed past 2am` : "")]);
  }
  if ((LIFE.musts || []).includes("pets")){
    const p = a.pet;
    if (!p)
      R.push(["y", "no pet policy published — worth asking before you view"]);
    else if (p.ok){
      // Pet rent is deliberately shown rather than folded into the cost score:
      // charging a listing for publishing its fee would rank the buildings that
      // stayed quiet about theirs above the ones that were straight with you.
      const bits = [];
      if (p.monthly) bits.push(`${money(p.monthly)}/mo pet rent`);
      if (p.onetime) bits.push(`${money(p.onetime)} deposit`);
      if (p.max) bits.push(`max ${p.max}`);
      R.push(["g", bits.length ? `pets allowed — ${bits.join(", ")}` : "pets allowed"]);
    } else
      R.push(["r", `this ${(a.src && a.src[0] || {}).n || "listing"} post doesn't say pets are OK`]);
  }
  if ((LIFE.musts || []).includes("amenities")){
    const am = amenityScore(a);
    if (am.v != null)
      R.push([am.v >= 0.6 ? "g" : am.v >= 0.35 ? "y" : "r",
              am.known
                ? `lists ${a.unit_amen.length} amenities — ${a.unit_amen.slice(0,3).join(", ").toLowerCase()}`
                : `amenities not listed; inferred from ${a.yr ? `a ${a.yr} building` : "the building"}${
                    a.units ? ` of ${n(a.units)} units` : ""}`]);
  }
  // Naming the drop matters more than the drop. A score that silently fell 40
  // points is the horoscope this file is meant not to be.
  if (f.ungated != null && f.safeGate != null && f.safeGate < 0.98)
    R.push(["r", `${Math.round(f.ungated * (1 - f.safeGate))} points off for the block — ` +
                 `assaults and break-ins nearby busier than ${(a.street_pct||{}).violent}% of listings`]);
  if (f.ungated != null && f.wantGate != null && f.wantGate < 0.9){
    const top = (LIFE.near || [])[0];
    const label = ((NEAR_OPTS.find(o => o[0] === top) || [,,top])[2] || top).toLowerCase();
    R.push(["r", `${Math.round(f.ungated * f.safeGate * (1 - f.wantGate))} points off — ` +
                 `this is not near ${label}, the first thing you asked for`]);
  }

  if (f.d.neighborhood != null && f.d.neighborhood < 0.4)
    R.push(["r", "block scores poorly for what you asked for"]);
  else if (f.d.neighborhood != null && f.d.neighborhood > 0.75)
    R.push(["g", "block matches the feel you wanted"]);
  if (a.rating && a.rating_n >= 10)
    R.push([a.rating >= 4 ? "g" : a.rating <= 3 ? "r" : "y",
            `${a.rating}/5 from ${a.rating_n} ${a.rating_src==="Google"?"Google":"renter"} reviews`]);
  if (a.over_year > 5) R.push(["r", `${a.over_year} violations took over a year to fix`]);
  if (a.rc === "yes") R.push(["g", "likely rent-controlled"]);

  const good = R.filter(x=>x[0]==="g").map(x=>x[1]);
  const bad  = R.filter(x=>x[0]==="r").map(x=>x[1]);
  const mid  = R.filter(x=>x[0]==="y").map(x=>x[1]);
  return { R, good, bad, mid,
           top: [...R.filter(x=>x[0]==="g").slice(0,2),
                 ...R.filter(x=>x[0]==="y").slice(0,1),
                 ...R.filter(x=>x[0]==="r").slice(0,1)].slice(0,4),
           why: good.slice(0,3).join(" + "),
           note: f.lg.length
             ? "Times are straight-line estimates with a 30% detour allowance, not live routing."
               + (pinNote(a) ? " " + pinNote(a) : "")
             : pinNote(a) };
}

/* How much to trust the dot on the map.

   Everything positional here -- walk times, bars within 800m, the 250m street
   ring -- is computed from one lat/lon, and for a large slice of the list that
   lat/lon is approximate by design. Craigslist deliberately fuzzes a posting's
   location, and it shows: 34 coordinates in this data set are shared by two or
   more distinct addresses, including one point carrying 301 Main St, 250 King St
   and 338 Main St, which are the better part of a kilometre apart. A further 116
   listings could not be matched to a building on the parcel map at all.

   None of that is fixable from here without paying for geocoding. Saying it is
   free, and a reader who knows the pin is soft will read the ten-minute walk as
   the estimate it is. */
function pinNote(a){
  if (!a.parcel_ok)
    return "This address could not be matched to a building on the city parcel map, so the pin — and every distance measured from it — is approximate.";
  const clOnly = (a.src || []).length === 1 && a.src[0].n === "Craigslist";
  if (clOnly)
    return "Craigslist obscures exact addresses, so this pin is the neighbourhood the poster chose rather than the doorstep.";
  return null;
}

/* ---------- what a careful reader would object to ----------
   Written by asking: if someone took this listing and dug into it for ten
   minutes, what would they come back with? Anything on this list demolishes a
   recommendation, so nothing carrying one gets recommended -- however well it
   scores. Proving a place is fine is not possible; refusing to headline one
   that has a visible problem is.

   Note the direction of the room test. Chasing adjectives ("large room",
   "quiet room", ...) is a losing game, so a headline pick has to show positive
   evidence it is a whole home instead: a bedroom count, and no room wording. */
const ROOMISH = /\b(room|occupancy|roommate|shared|sublet|sro|cuarto|habitaci[oó]n)\b/i;
function redFlags(a){
  const out = [];
  if (a.shared) out.push(a.shared_why || "looks like a room rather than a whole home");
  else {
    const t = a.name || "";
    if (ROOMISH.test(t) && !/living room|dining room/i.test(t))
      out.push("the listing text describes a room or shared occupancy");
    if (a.beds == null) out.push("the listing never says how many bedrooms it has");
  }
  const perUnit = (a.novs||0) / Math.max(1, a.units||1);
  if (perUnit > 1.5)
    out.push(`${n(a.novs)} building violations across ${n(a.units)} units`);
  if ((a.over_year||0) > 3)
    out.push(`${a.over_year} violations here took over a year to fix`);
  if (a.referred > 0) out.push("the city escalated a case here to the City Attorney");
  // Coverage-corrected, like everywhere else -- a block with nothing on file
  // should not be disqualified, and should not be vouched for either.
  const vi = streetPct(a, "violent"), br = streetPct(a, "break_in");
  if (vi >= 85) out.push(`assaults and robberies busier than ${Math.round(vi)}% of listings`);
  if (br >= 88) out.push(`car break-ins busier than ${Math.round(br)}% of listings`);
  if (a.rating != null && a.rating < 3 && (a.rating_n||0) >= 2)
    out.push(`rated ${a.rating}/5 by ${a.rating_n} reviewer${a.rating_n===1?"":"s"}`);
  return out;
}

/* ---------- the recommendation layer ---------- */
// The point of the product is not 2,547 percentages. It is three sentences.
function picks(list){
  // Rooms and co-living pods are a different product, and they win any contest
  // that rewards low rent. They are excluded from the picks, not from the list.
  const all = list.map(a => ({ a, f: fit(a) }))
                  .filter(x => x.f && x.f.score != null && !x.f.blocked && !x.a.shared);
  if (!all.length) return [];

  /* Red flags still disqualify. Thin evidence no longer does, and that is a
     reversal worth explaining.

     The old rule was "don't recommend what you can't vouch for": median match
     falls as we learn more about a place, because a building with reviews and an
     inspection record has things counting against it while an anonymous ad has
     nothing on file, so headline picks had to clear an evidence bar the list did
     not. Defensible in the abstract, indefensible on screen. At a $3,000 budget
     the bar threw out 262 of 266 eligible listings, and "Best overall" came back
     at 45 while the very first card underneath it scored 63. A headline pick
     that loses to the list it is sitting on top of does not read as caution, it
     reads as broken -- and it quietly told the user their own ranking was wrong.

     So the picks now agree with the list by construction, and confidence is said
     out loud on the card rather than used to hide things. */
  const clean = all.filter(x => !redFlags(x.a).length);
  const scored = clean.length ? clean : all;
  const relaxed = !clean.length;
  const t = priceTargets();
  // Each category picks the best listing not already taken. Without this, one
  // listing that happened to win two categories collapsed the row to two cards.
  const by = (fn) => scored.filter(x => !used.has(x.a.id))
                           .sort((x,y) => fn(y) - fn(x))[0];
  const out = [], used = new Set();
  const take = (x, kind, line) => {
    if (!x || used.has(x.a.id)) return;
    used.add(x.a.id); out.push({ ...x, kind, line, relaxed });
  };
  take(by(x => x.f.score), "Best overall",
       "Best balance of price, commute, neighbourhood and building.");
  // The alternates have to stay in the same conversation as the winner. "Best
  // apartment" is chosen on property quality, which can crown something that
  // matches you badly -- a 31 sitting next to a 56 is not an alternative, it is
  // a distraction, and it makes the row look like it isn't reading the profile.
  const best = out[0];
  const near = x => best && x.f.score >= best.f.score - 15;
  // value: what it saves against your comfortable number, per point of match given up
  take(by(x => {
    if (!near(x)) return -1;
    const saved = t.comf - (x.a.act ? x.a.act[0] : x.a.rent);
    if (saved <= 0) return -1;
    return x.f.score - (best ? (best.f.score - x.f.score) * 1.4 : 0) + saved/40;
  }), "Best value", null);
  take(by(x => near(x) ? (x.f.q ?? -1) : -1), "Best apartment", null);
  // A category with nothing worth offering drops out rather than filling the row.
  for (let i = out.length - 1; i >= 1; i--)
    if (!near(out[i])) out.splice(i, 1);
  for (const o of out){
    if (o.line) continue;
    const saved = t.comf - (o.a.act ? o.a.act[0] : o.a.rent);
    o.line = o.kind === "Best value"
      ? (() => { const d = Math.max(0, out[0].f.score - o.f.score);
          return `Saves ${money(Math.max(0,saved))}/mo against your comfortable number, ${
            d ? `giving up ${d} point${d === 1 ? "" : "s"} of match.` : "at the same match."}`; })()
      : `Highest property quality we could verify (${o.f.q}/100), at ${
          money(o.a.act ? o.a.act[0] : o.a.rent)} a month.`;
  }
  return out;
}

/* ============================================================
   THE QUIZ
   ============================================================ */
var CHAINS = (() => {
  const c = {grocery:{}, gym:{}};
  for (const p of PL){ if (c[p.k]) { const nm = p.b || p.n; c[p.k][nm] = (c[p.k][nm]||0)+1; } }
  const top = k => Object.entries(c[k]).filter(([,n])=>n>=3)
    .sort((x,y)=>y[1]-x[1]).slice(0,7).map(([n])=>n);
  return { grocery: top("grocery"), gym: top("gym") };
})();

var qStep = 0, DRAFT = null;
var BLANK = { budget:3200, anchors:[], groceryBrand:null, gymBrand:null, night:2,
                commuteTol:30, space:false, streetMatters:false, skip:[],
                near:[], musts:[], safety:"some", beds:null, nightKind:"any" };
// `priorities`, `weights` and `pets` used to live here. The first two fed
// deriveWeights(), which wrote a shape dimWeights() never read; `pets` is now
// just an entry in `musts`. All three are gone rather than left as decoration.

function openQuiz(opts){
  DRAFT = JSON.parse(JSON.stringify(LIFE || BLANK));
  // Profiles saved by an earlier build predate near/musts/safety. Backfill from
  // BLANK so a returning user gets the new questions instead of a broken step.
  for (const k in BLANK)
    if (DRAFT[k] === undefined) DRAFT[k] = JSON.parse(JSON.stringify(BLANK[k]));
  DRAFT.done = false; qStep = 0;
  STEPS = (opts && opts.full) ? CORE_STEPS.concat(MORE_STEPS) : CORE_STEPS;
  document.getElementById("quiz").classList.add("on");
  drawQuiz();
}
function closeQuiz(){
  document.getElementById("quiz").classList.remove("on");
  // Versioned for the same reason lifeOn() is: declining the old quiz should not
  // count as declining a different one.
  try { localStorage.setItem(QUIZ_SEEN, String(LIFE_V)); } catch {}
}

/* ---------- the four questions ----------
   Four is the budget, so each one has to pay for itself by moving the ranking
   in a way the others can't. Budget sets the wall and the price curve; what you
   want to be near sets Lifestyle; what the place needs sets Apartment; and how
   much the block matters sets the safety gate. Nothing here is asked twice, and
   nothing asked here goes unread -- the previous version collected six answers
   and wired two of them up. */
var NEAR_OPTS = [
  ["nightlife","🎉","Bars & nightlife"], ["cafe","☕","Cafés"], ["gym","🏋️","Gyms"],
  ["park","🌳","Parks"], ["grocery","🛒","Groceries"], ["transit","🚇","Transit"],
];
var NIGHT_OPTS = [["any","A bit of everything"],["bars","Bars & clubs"],
                  ["music","Live music"],["food","Restaurants & late food"]];
var BED_OPTS = [[null,"Any"],[0,"Studio"],[1,"1+"],[2,"2+"],[3,"3+"]];
var MUST_OPTS = [
  ["pets","🐕","Pet-friendly"], ["wd","🧺","In-unit laundry"],
  ["amenities","🏊","Building amenities"], ["dishwasher","🍽️","Dishwasher"],
  ["ac","❄️","A/C"], ["outdoor","🌿","Outdoor space"], ["rc","🔒","Rent-controlled"],
];
var SAFETY_OPTS = [
  ["dealbreaker","Dealbreaker",
   "Only calm blocks. Anything in the worst 10% for assaults, among the listings in this search, is dropped outright."],
  ["alot","Matters a lot",
   "A rough block costs a listing up to half its match, whatever else it has going for it."],
  ["some","Somewhat",
   "Counts against a place, but a very good apartment can still outweigh it."],
  ["fine","I can handle a gritty block",
   "Street reports stay on the card, but they won't move the ranking."],
];

var CORE_STEPS = [
  { t:"What can you actually spend?",
    s:"Not the listed rent — the number that leaves your account each month, utilities and fees included.",
    body:()=>`<div class="qbig">${money(DRAFT.budget)}<span>per month, all in</span></div>
      <input type="range" min="1200" max="9000" step="50" value="${DRAFT.budget}" data-q="budget">
      <p class="qhint">This is a ceiling, not a target. We compare it against estimated true
        monthly cost, not the advertised rent.</p>` },

  { t:"What do you want to be near?",
    s:"Pick up to three, best first — the order matters more than the count.",
    body:()=>`<div class="qrow wrap">${NEAR_OPTS.map(([k,ic,l])=>{
        const i = DRAFT.near.indexOf(k);
        return `<button class="qchip big ${i>=0?"on":""}" data-qnear="${k}">${ic} ${l}${
          i>=0?` <b style="opacity:.7">${i+1}</b>`:""}</button>`;
      }).join("")}</div>
      <p class="qhint">${DRAFT.near.length
        ? DRAFT.near.map((k,i)=>`${i+1}. ${(NEAR_OPTS.find(o=>o[0]===k)||[,,k])[2]}`).join(" · ")
        : "Nothing picked yet — everything is weighted evenly."}</p>
      ${DRAFT.near.includes("nightlife") ? `
        <p class="qlabel" style="margin-top:16px">What kind of night?</p>
        <div class="qrow wrap">${NIGHT_OPTS.map(([k,l])=>
          `<button class="qchip ${(DRAFT.nightKind||"any")===k?"on":""}" data-qnk="${k}">${l}</button>`
          ).join("")}</div>
        <p class="qhint">Counted as places of that kind within a ten-minute walk, from
          OpenStreetMap. The city's entertainment permits add which ones are licensed past
          2am — a small weight, because that licence is held by donut shops and hotels too.</p>`
        : ""}` },

  { t:"What does the place need?",
    s:"Only tick what you'd actually walk away over. Everything else still counts, just less.",
    body:()=>`<p class="qlabel">Bedrooms</p>
      <div class="qrow wrap">${BED_OPTS.map(([v,l])=>
        `<button class="qchip ${DRAFT.beds===v?"on":""}" data-qbed="${v}">${l}</button>`).join("")}</div>
      <p class="qlabel" style="margin-top:16px">Must have</p>
      <div class="qrow wrap">${MUST_OPTS.map(([k,ic,l])=>
        `<button class="qchip big ${DRAFT.musts.includes(k)?"on":""}" data-qmust="${k}">${ic} ${l}</button>`
        ).join("")}</div>
      <p class="qhint">A quarter of listings publish an amenity list. We never drop a place for
        staying silent about one — only for saying no outright.</p>` },

  { t:"How much do the streets matter?",
    s:"The one question with a real cost attached: in this city the liveliest blocks and the roughest ones are often the same blocks.",
    body:()=>`<div class="qopts">${SAFETY_OPTS.map(([k,l,d])=>
        `<button class="qopt ${DRAFT.safety===k?"on":""}" data-qsafe="${k}">
           <b>${l}</b><span>${d}</span></button>`).join("")}</div>` },
];

var MORE_STEPS = [
  { t:"Where does your life happen?",
    s:"Add the places you go most. Work matters most; a partner's place or a studio counts just as much.",
    body:()=>`<div class="anchors">${(DRAFT.anchors||[]).map((an,i)=>
        `<div class="anchor"><span>${an.icon}</span><b>${an.label}</b>
          <small>${an.mode}</small><button data-rm="${i}">✕</button></div>`).join("")
        || `<p class="qhint">Nothing added yet — search an address below.</p>`}</div>
      <div class="qrow"><input id="qaddr" placeholder="Search an address or place…" autocomplete="off">
        <select id="qmode"><option value="transit">transit</option><option value="walk">walk</option>
          <option value="bike">bike</option><option value="drive">drive</option></select></div>
      <div class="qrow" style="margin-top:6px">
        ${["💼 Work","❤️ Partner","🎓 School","📍 Other"].map(x=>
          `<button class="qchip" data-alabel="${x}">${x}</button>`).join("")}</div>
      <div id="qresults"></div>
      <p class="qhint">Addresses are looked up once and kept in this browser only.</p>` },

  { t:"Groceries and the gym",
    s:"If you're loyal to a chain, say so — we'll measure the distance to that one, not just any of them.",
    body:()=>`<p class="qlabel">Grocery store</p>
      <div class="qrow wrap">${["Any", ...CHAINS.grocery].map(b=>
        `<button class="qchip ${(DRAFT.groceryBrand||"Any")===b?"on":""}" data-brand="grocery|${b}">${b}</button>`).join("")}
        <button class="qchip ${(DRAFT.skip||[]).includes("grocery")?"on":""}" data-skip="grocery">Don't care</button></div>
      <p class="qlabel" style="margin-top:14px">Gym</p>
      <div class="qrow wrap">${["Any", ...CHAINS.gym].map(b=>
        `<button class="qchip ${(DRAFT.gymBrand||"Any")===b?"on":""}" data-brand="gym|${b}">${b}</button>`).join("")}
        <button class="qchip ${(DRAFT.skip||[]).includes("gym")?"on":""}" data-skip="gym">Don't care</button></div>` },

  { t:"How far will you travel?",
    s:"One-way, door to door, on a normal weekday.",
    body:()=>`<div class="qbig">${DRAFT.commuteTol} min<span>tolerable one-way</span></div>
      <input type="range" min="10" max="70" step="5" value="${DRAFT.commuteTol}" data-q="commuteTol">
      <label class="qcheck" style="margin-top:14px"><input type="checkbox" data-q="space" ${DRAFT.space?"checked":""}>
        I'd trade location for more space</label>` },
];
var STEPS = CORE_STEPS;

/* The old quiz ended on "pick the three that matter most" and fed the answers
   into a {lifestyle, home, residents, block} object. dimWeights() reads
   {cost, commute, neighborhood, apartment, building, lifestyle}. The two never
   met, so six questions produced exactly one working weight and every listing
   was ranked on DEFAULT_W no matter what anyone answered. These four answers
   write the shape that is actually read. */
function deriveImportance(d){
  const imp = { cost:"med", commute:"med", neighborhood:"med",
                apartment:"med", building:"med", lifestyle:"med" };
  // With no anchor there is nowhere to commute to, and travel() would quietly
  // fall back to scoring errand distance -- which Lifestyle already does, better.
  if (!(d.anchors || []).length)   imp.commute = "low";
  if ((d.near  || []).length)      imp.lifestyle = "high";
  if ((d.musts || []).length >= 2) imp.apartment = "high";
  if (d.safety === "dealbreaker")  imp.neighborhood = "vhigh";
  else if (d.safety === "alot")    imp.neighborhood = "high";
  return imp;
}

/* One budget, settable from either place. The quiz asks for it once; the price
   filter is the same number afterwards. Price targets are re-derived rather than
   kept, so a later change moves the whole cost curve with it. */
window.setBudget = function(v){
  if (!lifeOn() || !v || v === LIFE.budget) return;
  LIFE.budget = v;
  LIFE.hard = Object.assign({}, LIFE.hard || {}, { maxCost: v });
  delete LIFE.price;                       // priceTargets() re-derives from budget
  saveLife(); invalidateFit();
};

function finishQuiz(){
  const d = DRAFT, musts = d.musts || [];
  d.hard = Object.assign({}, d.hard || {},
    { maxCost: d.budget, beds: d.beds, wd: musts.includes("wd") });
  // Tolerance for noise outside the window follows from how badly you wanted the
  // bars: first pick means you'll take the 2am crowd, third means you'd rather not.
  const ni = (d.near || []).indexOf("nightlife");
  d.night = ni >= 0 ? 4 - ni : 1;
  d.streetMatters = d.safety === "dealbreaker" || d.safety === "alot";
  d.importance = deriveImportance(d);
  d.done = true; d.v = LIFE_V;
  LIFE = d; saveLife(); invalidateFit(); closeQuiz();
  selPinned = false;                     // new answers, new #1

  SORT = "fit"; sortMenu(); render(); lifeChrome();
}

function drawQuiz(){
  const st = STEPS[qStep], last = qStep === STEPS.length - 1;
  const canExtend = last && STEPS === CORE_STEPS;
  document.getElementById("qbody").innerHTML = `
    <div class="qhead"><span>${qStep+1} of ${STEPS.length}</span>
      <div class="qbar"><i style="width:${(qStep+1)/STEPS.length*100}%"></i></div></div>
    <h2>${st.t}</h2><p class="qsub">${st.s}</p>
    <div class="qcontent">${st.body()}</div>
    <div class="qnav">
      ${qStep ? `<button class="ghost" id="qback">Back</button>`
              : `<button class="ghost" id="qskip">Skip for now</button>`}
      ${canExtend ? `<button class="link" id="qmore">Fine-tune commute &amp; brands</button>` : ""}
      <button id="qnext">${last ? "Rank apartments around my life" : "Continue"}</button>
    </div>`;
  document.getElementById("qnext").onclick = () => {
    if (last) finishQuiz(); else { qStep++; drawQuiz(); }
  };
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("qback", () => { qStep--; drawQuiz(); });
  on("qskip", closeQuiz);
  on("qmore", () => { STEPS = CORE_STEPS.concat(MORE_STEPS); qStep++; drawQuiz(); });
}

/* address search — Nominatim, one request per keystroke-pause, results cached */
var geoT = null, geoCache = {};
async function geocode(q){
  if (geoCache[q]) return geoCache[q];
  const u = "https://nominatim.openstreetmap.org/search?format=json&limit=5&viewbox="
          + "-122.55,37.85,-122.33,37.69&bounded=1&q=" + encodeURIComponent(q);
  try {
    const r = await fetch(u, {headers:{"Accept":"application/json"}});
    const j = await r.json();
    geoCache[q] = j; return j;
  } catch { return []; }
}

document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset && t.dataset.q !== undefined && DRAFT){
    DRAFT[t.dataset.q] = t.type === "checkbox" ? t.checked : +t.value;
    if (t.type !== "checkbox") drawQuiz();
  }
  if (t.id === "qaddr"){
    clearTimeout(geoT);
    const q = t.value.trim();
    if (q.length < 4){ document.getElementById("qresults").innerHTML = ""; return; }
    geoT = setTimeout(async () => {
      const res = await geocode(q);
      document.getElementById("qresults").innerHTML = res.map((r,i)=>
        `<div class="qres" data-geo="${i}">${r.display_name.split(",").slice(0,3).join(",")}</div>`).join("");
      window.__geo = res;
    }, 550);
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset && t.dataset.q !== undefined && DRAFT && t.type === "checkbox"){
    DRAFT[t.dataset.q] = t.checked;
  }
});
document.addEventListener("click", e => {
  const t = e.target.closest("[data-brand],[data-skip],[data-geo],[data-alabel],[data-rm]," +
                             "[data-qnear],[data-qbed],[data-qmust],[data-qsafe],[data-qnk]");
  if (!t || !DRAFT) return;
  // Order is the answer here, so picking is a queue: tapping an already-picked
  // chip drops it and everything after it slides up a rank.
  if (t.dataset.qnear){
    const k = t.dataset.qnear, i = DRAFT.near.indexOf(k);
    if (i >= 0) DRAFT.near.splice(i, 1);
    else if (DRAFT.near.length < 3) DRAFT.near.push(k);
    drawQuiz();
  }
  if (t.dataset.qbed !== undefined){
    const v = t.dataset.qbed;
    DRAFT.beds = v === "null" ? null : +v;
    drawQuiz();
  }
  if (t.dataset.qmust){
    const k = t.dataset.qmust, i = DRAFT.musts.indexOf(k);
    if (i >= 0) DRAFT.musts.splice(i, 1); else DRAFT.musts.push(k);
    drawQuiz();
  }
  if (t.dataset.qnk){ DRAFT.nightKind = t.dataset.qnk; drawQuiz(); }
  if (t.dataset.qsafe){ DRAFT.safety = t.dataset.qsafe; drawQuiz(); }
  if (t.dataset.brand){
    const [kind, b] = t.dataset.brand.split("|");
    DRAFT[kind === "grocery" ? "groceryBrand" : "gymBrand"] = b === "Any" ? null : b;
    DRAFT.skip = (DRAFT.skip||[]).filter(x => x !== kind);
    drawQuiz();
  }
  if (t.dataset.skip){
    const k = t.dataset.skip;
    DRAFT.skip = (DRAFT.skip||[]).includes(k) ? DRAFT.skip.filter(x=>x!==k) : [...(DRAFT.skip||[]), k];
    drawQuiz();
  }
  if (t.dataset.alabel){ window.__alabel = t.dataset.alabel;
    document.querySelectorAll("[data-alabel]").forEach(x=>x.classList.toggle("on", x===t)); }
  if (t.dataset.geo){
    const r = (window.__geo||[])[+t.dataset.geo]; if (!r) return;
    const lbl = window.__alabel || "📍 Other";
    DRAFT.anchors.push({ icon: lbl.split(" ")[0], label: lbl.split(" ").slice(1).join(" "),
      lat:+r.lat, lon:+r.lon, mode: document.getElementById("qmode").value });
    drawQuiz();
  }
  if (t.dataset.rm !== undefined){ DRAFT.anchors.splice(+t.dataset.rm,1); drawQuiz(); }
});

/* ============================================================
   MY LIFE MAP — the constellation
   ============================================================ */
var lifeMode = false, anim = 0, animT = null;
function setLifeMode(on){
  lifeMode = on;
  document.getElementById("mode-apts").classList.toggle("on", !on);
  document.getElementById("mode-life").classList.toggle("on", on);
  document.getElementById("maplayers").style.display = on ? "none" : "";
  const lc = document.getElementById("lifecard");
  if (lc && !on) lc.style.display = "none";
  if (on){
    const a = A.find(x => x.id === sel);
    if (a) frameLegs(a, legs(a));
    runLegs();
  } else { drawMap(); placePins(); }
}
// Slow enough to read as drawing rather than appearing. Each route starts a
// beat after the one before it, so you watch them go out one at a time instead
// of getting the finished constellation in a single frame.
var LEG_DUR = 2100, LEG_STAGGER = 0.14, LEG_SPAN = 0.55;
var easeOut = t => 1 - Math.pow(1 - t, 2.4);

function runLegs(){
  clearInterval(animT);
  // Progress comes from the clock, not from how many ticks fired. Background
  // tabs get throttled to about one tick a second, which left the routes frozen
  // a tenth of the way out.
  const t0 = Date.now(), DUR = LEG_DUR;
  anim = 0;
  const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.hidden || still){ anim = 1; drawMap(); placePins(); return; }
  animT = setInterval(() => {
    anim = cl((Date.now() - t0) / DUR, 0, 1);
    drawMap(); placePins();
    if (anim >= 1) clearInterval(animT);
  }, 16);
}
// Fit the apartment and everywhere it connects to on screen at once. The first
// version stepped the zoom down by guesswork and left the commute off the edge;
// this solves for the zoom directly from the span.
function frameLegs(a, lg){
  if (!lg.length) return;
  let north = a.lat, south = a.lat, west = a.lon, east = a.lon;
  for (const l of lg){
    north = Math.max(north, l.lat); south = Math.min(south, l.lat);
    west  = Math.min(west,  l.lon); east  = Math.max(east,  l.lon);
  }
  CX = (west + east) / 2; CY = (north + south) / 2;
  const yOf = la => { const sn = Math.sin(la*Math.PI/180);
    return 0.5 - Math.log((1+sn)/(1-sn)) / (4*Math.PI); };       // unit mercator
  const dx = Math.max(1e-5, (east - west) / 360);
  const dy = Math.max(1e-5, Math.abs(yOf(south) - yOf(north)));
  // leave room for the labels, which sit above and beside each endpoint
  const zx = Math.log2((MW - 150) / (256 * dx));
  const zy = Math.log2((MH - 120) / (256 * dy));
  ZOOM = cl(Math.min(zx, zy), 10.5, 16.5);
}

// Each kind of trip gets its own colour, so a glance tells you which line is
// the commute and which is the errand without reading a single label.
const LEG_COL = { "💼":"#2F6FB0", "❤️":"#C2456B", "🎓":"#7C4DBE", "📍":"#5F6169",
                  "🛒":"#2E8B57", "🏋️":"#7C4DBE", "🚇":"#E0A32E" };
function drawLife(){
  const a = A.find(x => x.id === sel);
  if (!a) return;
  const lg = legs(a);
  mx.fillStyle = "rgba(252,251,249,.55)"; mx.fillRect(0,0,MW,MH);
  const home = proj(a.lat, a.lon);

  lg.forEach((l, i) => {
    const q = proj(l.lat, l.lon);
    const t = easeOut(cl((anim - i*LEG_STAGGER) / LEG_SPAN, 0, 1));
    if (t <= 0) return;
    const col = LEG_COL[l.icon] || "#5F6169";
    // a gentle bow reads as a route rather than a ruler line
    const mxp = (home[0]+q[0])/2 + (q[1]-home[1])*0.12;
    const myp = (home[1]+q[1])/2 - (q[0]-home[0])*0.12;
    mx.strokeStyle = col; mx.lineWidth = l.fixed ? 3.2 : 2.6;
    mx.lineCap = "round";
    mx.beginPath(); mx.moveTo(home[0], home[1]);
    mx.quadraticCurveTo(home[0]+(mxp-home[0])*t, home[1]+(myp-home[1])*t,
                        home[0]+(q[0]-home[0])*t, home[1]+(q[1]-home[1])*t);
    mx.stroke();
    if (t < 1) return;

    // two-tier badge: what it is, then how far
    mx.font = "600 12px -apple-system,system-ui,sans-serif";
    const w = Math.max(mx.measureText(l.label).width + 30, 62);
    const bx = cl(q[0]-w/2, 4, MW-w-4), by = cl(q[1]-46, 4, MH-52);
    mx.fillStyle = "#FFF"; mx.strokeStyle = "rgba(0,0,0,.10)"; mx.lineWidth = 1;
    mx.beginPath(); mx.roundRect(bx, by, w, 25, 8); mx.fill(); mx.stroke();
    mx.fillStyle = col; mx.font = "600 12px -apple-system,system-ui,sans-serif";
    mx.fillText(l.icon, bx+8, by+17);
    mx.fillStyle = "#17171A";
    mx.fillText(l.label.length>13 ? l.label.slice(0,12)+"…" : l.label, bx+26, by+17);
    // time chip below, in the leg's colour
    const tw = mx.measureText(`${l.mins}m`).width + 18;
    mx.fillStyle = "#FFF"; mx.strokeStyle = "rgba(0,0,0,.10)";
    mx.beginPath(); mx.roundRect(bx+(w-tw)/2, by+27, tw, 21, 7); mx.fill(); mx.stroke();
    mx.fillStyle = col; mx.font = "700 12px -apple-system,system-ui,sans-serif";
    mx.fillText(`${l.mins}m`, bx+(w-tw)/2+9, by+42);
    mx.fillStyle = col;
    mx.beginPath(); mx.arc(q[0],q[1],5,0,7); mx.fill();
    mx.strokeStyle="#FFF"; mx.lineWidth=2; mx.stroke();
  });

  // the apartment itself, as a pin rather than a dot
  mx.fillStyle = "#E4622A"; mx.strokeStyle = "#FFF"; mx.lineWidth = 3;
  mx.beginPath(); mx.arc(home[0], home[1]-4, 13, Math.PI, 0);
  mx.lineTo(home[0], home[1]+14); mx.closePath(); mx.fill(); mx.stroke();
  mx.fillStyle = "#FFF";
  mx.beginPath(); mx.arc(home[0], home[1]-4, 4.5, 0, 7); mx.fill();
  lifeSummary(a, lg);
}

// "Your life from here" — the honest version of a lifestyle score: total time,
// and how that compares with the places you already saved.
function lifeSummary(a, lg){
  const el = document.getElementById("lifecard");
  if (!el) return;
  if (!lg.length || anim < 0.7){ el.style.display = "none"; return; }
  const daily = lg.reduce((s,l) => s + l.mins*2, 0);
  const others = [...saved].map(id => A.find(x=>x.id===id)).filter(x=>x && x.id!==a.id)
    .map(x => legs(x).reduce((s,l)=>s+l.mins*2,0)).filter(x=>x>0);
  const avg = others.length ? Math.round(others.reduce((s,x)=>s+x,0)/others.length) : null;
  const diff = avg == null ? null : avg - daily;
  el.style.display = "";
  el.innerHTML = `<h6>${IC.spark} Your life from here</h6>
    <div class="r"><b>≈${daily} min/day</b>&nbsp;getting around</div>
    ${diff == null
      ? `<div class="r" style="color:var(--ink-3)">Save another place and we'll compare
           this against it.</div>`
      : `<div class="r"><span class="ok">${diff>=0?"✓":"•"}</span>
           <span><b>${Math.abs(diff)} min</b> ${diff>=0?"less":"more"} than your other
           saved places.</span></div>`}
    <p style="font-size:11px;color:var(--ink-3);margin-top:2px">Round trips, straight-line
      estimate.</p>`;
}
function lifeChrome(){
  const on = lifeOn();
  document.getElementById("mode-life").style.display = on ? "" : "none";
  document.getElementById("quizbtn").textContent = on ? "Edit my life" : "Set up my life";
  const b = document.getElementById("lifebanner");
  if (b) b.style.display = on ? "none" : "";
}

/* ---------- wiring ----------
   The script block sits above the quiz markup, so binding has to wait for the
   parser. Getting this wrong killed the whole file silently: one null .onclick
   threw, LIFE_READY was never set, and every life feature stayed dark. */
window.LIFE_READY = true;

function bindLife(){
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("quizbtn", openQuiz);
  on("qx", closeQuiz);
  on("mode-apts", () => setLifeMode(false));
  on("mode-life", () => { if (lifeOn()) setLifeMode(true); });
  const q = document.getElementById("quiz");
  if (q) q.addEventListener("click", e => { if (e.target.id === "quiz") closeQuiz(); });
  lifeChrome();
}

// Selecting anything draws its routes. Hiding this behind a mode toggle meant
// the most useful thing on the map only appeared if you already knew to ask.
window.showLife = function(a){
  if (!lifeOn() || !a) return;
  sel = a.id;
  if (!lifeMode) setLifeMode(true);
  else { frameLegs(a, legs(a)); runLegs(); }
};
window.selectForLife = function(a){ if (lifeMode) showLife(a); };

// Ask before ranking. Every number on this page is an answer to "is this good
// for you", and without a profile there is no "you" -- the old build hid the
// quiz behind a header button, so the default experience was a generic list
// pretending to be a personal one. Declining is remembered, so this asks once.
function firstRunQuiz(){
  if (lifeOn()) return;
  let seen = null;
  try { seen = localStorage.getItem(QUIZ_SEEN); } catch {}
  if (seen !== String(LIFE_V)) openQuiz();
}

if (lifeOn()){ SORT = "fit"; sortMenu(); }
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => { bindLife(); render(); firstRunQuiz(); });
else { bindLife(); render(); firstRunQuiz(); }
