/* factors.js — what this renter cares about, scored and ranked.
   ============================================================
   This file is the reason two people can open the same apartment and see
   different screens. It holds one registry of factors, and everything visible
   downstream is a projection of it:

     · the fit score              — factors weighted by stated importance
     · "Why you'd like it"        — the strongest factors this renter picked
     · "Good to know"             — the weakest, plus anomalies nobody picked
     · the tabs on the right      — the factors that have a visual answer

   Five rules, in the order the scoring applies them.

   1. HARD REQUIREMENTS come first and are not weights. A hard maximum is a
      wall. But *unknown is not failure*: a listing that never published its
      A/C status has not failed an A/C requirement, it needs verification, and
      saying otherwise would punish the ads that published less.

   2. FACTOR SCORES ARE PERCENTILES against the renter's own search, not
      absolute grades. "Quiet 89" means quieter than 89% of the apartments this
      person is actually choosing between. An absolute noise grade is not a
      decision aid, because nobody gets to rent the abstract ideal.

   3. IMPORTANCE COMES FROM THE QUIZ, and stays out of the interface. The
      renter said what matters; they should never see a weight, a percentage,
      or a slider labelled 0.35.

   4. BASELINE QUALITY still counts. Someone who only picked gym and commute
      must not be handed a building with a wall of unresolved violations just
      because it is near a gym. Unpicked factors keep a small voice.

   5. ANOMALIES OVERRIDE the quiz. Anything severe enough that a reasonable
      person would want to know regardless of their priorities gets surfaced,
      with its source, instead of being silently priced into a number.

   And running underneath all five: CONFIDENCE. A factor computed from thin
   evidence is pulled toward neutral rather than trusted or punished. Missing
   data is missing, not bad.
   ============================================================ */

/* ---------- small shared helpers ---------- */
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const money = (v) => v == null ? "-" : "$" + Math.round(v).toLocaleString("en-US");
const num = (v) => v == null ? "-" : Math.round(v).toLocaleString("en-US");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bedTxt = (b) => b == null ? "-" : b === 0 ? "Studio" : `${b} bd`;

/* Epoch seconds -> "3 days ago". Deliberately coarse: an advert posted at
   14:22 is not meaningfully different from one posted at 16:45, and printing
   the minute would imply a precision the relative strings we parse out of
   Apartments.com never had. */
function agoWords(epoch) {
  if (!epoch) return "at an unknown time";
  const h = (Date.now() / 1000 - epoch) / 3600;
  if (h < 1) return "in the last hour";
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d <= 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `${Math.round(d / 7)} weeks ago`;
}

// Piecewise-linear interpolation through named points, so a curve reads as the
// judgement it is rather than as an unexplained polynomial.
function curve(v, pts) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (v - x0) / (x1 - x0 || 1);
    }
  }
  return pts[pts.length - 1][1];
}

const FACTORS = (() => {
  "use strict";

  /* ---------- coverage-corrected street percentiles ----------
     A percentile built on almost no reports is not a record, it is a blank
     page. Five percent of listings sit near fewer than ~90 total street
     reports against a city median of 1,082, and they swept the top of every
     safety-first ranking purely by having nothing on file. So a thin
     percentile gets pulled toward the middle in proportion to how thin it is. */
  const streetCoverage = (a) => {
    const s = a.street || {};
    return (s.violent || 0) + (s.break_in || 0) + (s.encampment || 0) + (s.cleaning || 0);
  };
  function streetPct(a, k) {
    const v = (a.street_pct || {})[k];
    if (v == null) return null;
    const t = cl(streetCoverage(a) / 300, 0, 1);
    return v * t + 45 * (1 - t);
  }

  // Ratings shrink toward the city mean until enough people have spoken.
  let _mean = null;
  function globalMean(list) {
    if (_mean != null) return _mean;
    const r = list.filter((a) => a.rating != null && a.rating_n);
    _mean = r.length ? r.reduce((s, a) => s + a.rating, 0) / r.length : 3.7;
    return _mean;
  }
  function shrunkRating(a, list) {
    if (a.rating == null || !a.rating_n) return null;
    const PRIOR = 10, m = globalMean(list);
    return (a.rating * a.rating_n + m * PRIOR) / (a.rating_n + PRIOR);
  }

  /* add_trust.py already flags a rent far under the median for its size, and
     phrases it as a sentence. Reading that back is cheaper and more honest
     than recomputing the comparison with a different denominator and possibly
     disagreeing with the panel that displays it. */
  const UNDERPRICED = /below the median/i;
  const warnings = (a) => ((a.trust || {}).warn || []);
  const underpriced = (a) => warnings(a).some((w) => UNDERPRICED.test(w));
  const reusedPhotos = (a) => warnings(a).find((w) => /photos also appear/i.test(w));

  /* ---------- floor plans wearing a unit number ----------
     Apartments.com generates a placeholder per floor plan when a building will
     not publish its actual vacancies: "SI FL2-ID182", "Floor 3-ID461". These
     are not apartments. The building may well have something free, but that
     particular "unit" cannot be viewed or rented, which is why turning up to
     one is a wasted evening.

     119 listings here carry one, 114 of them marked live. The unit number is
     machine output and was being rendered as though a letting agent had typed
     it. */
  const PLAN_UNIT = /\bSI\s*FL\d+|(^|[^A-Z0-9])ID\d{2,}\b|floor\s*\d+\s*-\s*id\d+/i;
  const isPlan = (a) => PLAN_UNIT.test(String(a.unit || "")) ||
                        PLAN_UNIT.test(String(a.name || ""));

  /* One "where is the nearest X" for the whole file, so a factor and the map
     can never disagree about which X they meant. An address the renter pinned
     beats a brand they named, which beats the closest one of its kind. */
  const ANCHOR_LABEL = { grocery: "Grocery", gym: "Gym" };
  function placeTarget(a, P, kind) {
    const an = GEO.anchorFor(P, ANCHOR_LABEL[kind]);
    if (an) return { lat: an.lat, lon: an.lon, name: an.place || an.label, pinned: true };
    const brand = kind === "grocery" ? P.groceryBrand : kind === "gym" ? P.gymBrand : null;
    const nr = (brand && GEO.nearest(a, kind, brand)) || GEO.nearest(a, kind, null);
    return nr ? { lat: nr.p.la, lon: nr.p.lo, name: nr.p.n || kind, pinned: false } : null;
  }
  function placeCurve(a, P, kind, pts) {
    const t = placeTarget(a, P, kind);
    return t ? curve(GEO.metres(a.lat, a.lon, t.lat, t.lon), pts) : null;
  }

  /* ---------- the registry ----------
     Each factor answers four questions about one apartment:

       raw   how good is it, on whatever native scale the data has
       conf  how much do we actually know here, 0..1
       why   the one line to show if this is a strength
       but   the one line to show if this is the tradeoff

     `tab` names the visual answer that explains it, or null if the factor has
     no picture worth drawing. `quizzable` marks the ones the renter can pick
     in section B - the rest exist only as baseline quality and anomalies. */
  const REG = {

    quiet: {
      label: "Quiet nights", icon: "moon", tab: "quiet", quizzable: true,
      // night_pct is the share of 311 noise reports on this block landing
      // between 22:00 and 05:00. Every listing has it; the sound score does
      // not, so it refines rather than decides.
      raw(a) {
        const night = 100 - cl(a.night_pct ?? 33, 0, 100);
        const snd = (a.scores || {}).sound;
        const late = 100 - cl((a.late || 0) * 9, 0, 60);
        return snd == null ? night * 0.75 + late * 0.25
                           : night * 0.55 + (100 - snd) * 0.25 + late * 0.20;
      },
      conf: (a) => (a.scores || {}).sound != null ? 0.9 : 0.65,
      why: (a) => a.late
        ? `Quiet after 10 PM - ${a.late} venue${a.late === 1 ? "" : "s"} licensed late nearby`
        : "Quiet after 10 PM",
      but: (a) => `Busier after dark than most blocks in your search`,
    },

    street: {
      label: "Safety", icon: "shield", tab: "street", quizzable: true,
      /* Deliberately NOT a safety score. Four separate city datasets, grouped
         for navigation and inspectable underneath.

         The mix is weighted toward crime. A car break-in is a thing that
         happens TO you and costs you a window and a laptop; an encampment
         report is a 311 call about the condition of a street, and it is as
         often a report about someone else's hardship as about any risk to the
         person reporting it. Treating those as comparable overweighted the
         complaint and underweighted the theft. Crime now carries four fifths
         of this number, split fairly evenly between violence and break-ins,
         because break-ins are the far likelier thing to actually happen. */
      raw(a) {
        const vi = streetPct(a, "violent"), br = streetPct(a, "break_in");
        const en = streetPct(a, "encampment"), cle = streetPct(a, "cleaning");
        if (vi == null && br == null) return null;
        const v = vi ?? br, b = br ?? vi;
        const crime = 100 - (v * 0.55 + b * 0.45);
        const upkeep = 100 - ((en ?? 45) * 0.7 + (cle ?? 45) * 0.3);
        return crime * 0.8 + upkeep * 0.2;
      },
      conf: (a) => cl(streetCoverage(a) / 400, 0.35, 1),
      why: () => "This block reports fewer incidents than most",
      but: () => "This block reports more incidents than most",
    },

    cost: {
      label: "Lower monthly cost", icon: "money", tab: "cost", quizzable: true,
      raw(a, P) {
        const act = a.act ? a.act[0] : a.rent;
        if (act == null) return null;
        // Measured against this renter's own comfortable number, so the same
        // apartment scores differently for different budgets.
        return curve(act / (P.comfort || 3000),
          [[0.6, 100], [0.85, 88], [1, 70], [1.1, 45], [1.25, 8], [1.5, 0]]);
      },
      conf: (a) => a.est === "verified" ? 0.95 : 0.6,
      // Being cheaper than most of a pricey field is not the same as being
      // affordable. Without this guard a listing $235 over the renter's own
      // comfortable number was headlined as a reason to like it.
      strong: (a, P) => (a.act ? a.act[0] : a.rent) <= (P.comfort || Infinity),
      why(a, P) {
        const act = a.act ? a.act[0] : a.rent;
        return `~${money((P.comfort || 0) - act)} under your target`;
      },
      but(a, P) {
        const act = a.act ? a.act[0] : a.rent;
        return `~${money(act - (P.comfort || 0))} over your comfortable number`;
      },
    },

    space: {
      label: "More space", icon: "ruler", tab: null, quizzable: true,
      raw(a, P) {
        if (!a.sqft) return null;
        const want = P.idealSqft || (a.beds >= 2 ? 900 : a.beds === 1 ? 700 : 500);
        return curve(a.sqft / want, [[0.55, 10], [0.8, 55], [1, 85], [1.35, 100]]);
      },
      conf: (a) => a.sqft ? 0.9 : 0,
      why: (a) => `${num(a.sqft)} sq ft`,
      but: (a) => "Smaller than your ideal",
    },

    management: {
      label: "Good management", icon: "wrench", tab: "residents", quizzable: true,
      // The city inspects every building in SF, so a clean record is real
      // evidence — but a clean record on four units says far less than a clean
      // record on two hundred, because there was less to go wrong.
      raw(a) {
        if (!a.parcel_ok) return null;
        const units = Math.max(1, a.units || 1);
        let v = 100 - cl((a.novs || 0) / units / 1.5, 0, 1) * 100;
        v -= cl((a.active || 0) / 8, 0, 1) * 22;
        v -= cl((a.over_year || 0) / 6, 0, 1) * 22;
        if (a.referred > 0) v -= 15;
        return cl(v, 0, 100);
      },
      conf: (a) => a.parcel_ok ? cl(Math.log2((a.units || 1) + 1) / 7, 0.2, 0.9) : 0,
      why: (a) => a.active ? "Open repair cases are few for its size"
                           : "No open repair cases on the city's record",
      but: (a) => a.over_year
        ? `${a.over_year} violation${a.over_year === 1 ? "" : "s"} took over a year to close`
        : `${num(a.novs)} violations on file across ${num(a.units)} units`,
    },

    residents: {
      label: "Resident satisfaction", icon: "star", tab: "residents", quizzable: true,
      raw(a, P, ctx) {
        const sr = shrunkRating(a, ctx.all);
        return sr == null ? null : cl((sr - 2.4) / 2.2, 0, 1) * 100;
      },
      // 23% of listings carry a rating at all, and a rating from three people
      // is not a consensus. Confidence tracks both.
      conf: (a) => a.rating == null ? 0 : cl((a.rating_n || 0) / 14, 0.15, 0.95),
      why: (a) => `${a.rating}/5 from ${num(a.rating_n)} ${a.rating_src === "Google" ? "Google" : "renter"} reviews`,
      but: (a) => `Rated ${a.rating}/5 by ${num(a.rating_n)} reviewer${a.rating_n === 1 ? "" : "s"}`,
    },

    transit: {
      label: "Transit", icon: "train", tab: "life", quizzable: true,
      raw(a) {
        const t = (a.scores || {}).transit;
        const nr = GEO.nearest(a, "transit", null);
        const byWalk = nr ? curve(nr.m, [[200, 100], [500, 82], [1000, 55], [2000, 12]]) : null;
        if (t == null) return byWalk;
        return byWalk == null ? t : t * 0.5 + byWalk * 0.5;
      },
      conf: (a) => (a.scores || {}).transit != null ? 0.9 : 0.6,
      why(a) {
        const nr = GEO.nearest(a, "transit", null);
        return nr ? `${GEO.minutesTo(a, nr.p.la, nr.p.lo, "walk")} min walk to ${nr.p.n || "transit"}`
                  : "Well served by transit";
      },
      but: () => "Transit is a longer walk than you'd like",
    },

    walk: {
      label: "Walkability", icon: "walk", tab: "life", quizzable: true,
      raw(a) {
        const w = (a.scores || {}).walk;
        // Everyday-errand density is the fallback, and it is what a walk score
        // is measuring anyway.
        const d = GEO.countWithin(a, ["grocery", "cafe", "restaurant", "pharmacy"], 800);
        const byDensity = curve(d, [[2, 25], [10, 60], [30, 85], [70, 100]]);
        return w == null ? byDensity : w * 0.6 + byDensity * 0.4;
      },
      conf: (a) => (a.scores || {}).walk != null ? 0.9 : 0.7,
      why: (a) => `${GEO.countWithin(a, ["grocery", "cafe", "restaurant"], 800)} everyday places within a 10-min walk`,
      but: () => "Fewer everyday places in walking distance",
    },

    nightlife: {
      label: "Nightlife", icon: "wine", tab: "quiet", quizzable: true,
      raw(a) {
        const bars = GEO.countWithin(a, ["bar", "club", "music"], 800);
        return curve(bars, [[0, 0], [2, 35], [6, 68], [15, 90], [30, 100]]);
      },
      conf: () => 0.8,
      why(a) {
        const b = GEO.countWithin(a, ["bar", "club", "music"], 800);
        return `${b} bar${b === 1 ? "" : "s"} and venue${b === 1 ? "" : "s"} within a 10-min walk`;
      },
      but: () => "Little going on within walking distance at night",
    },

    grocery: {
      label: "Grocery access", icon: "cart", tab: "life", quizzable: true,
      raw: (a, P) => placeCurve(a, P, "grocery", [[250, 100], [700, 80], [1400, 45], [2600, 5]]),
      conf: () => 0.85,
      why(a, P) {
        const t = placeTarget(a, P, "grocery");
        return t ? `${GEO.minutesTo(a, t.lat, t.lon, "walk")} min to ${t.name}` : "Groceries nearby";
      },
      but: (a, P) => GEO.anchorFor(P, "Grocery")
        ? "A long way from the shop you named" : "No grocery store close by",
    },

    gym: {
      label: "Gym access", icon: "dumbbell", tab: "life", quizzable: true,
      raw: (a, P) => placeCurve(a, P, "gym", [[300, 100], [900, 78], [1800, 42], [3200, 5]]),
      conf: () => 0.8,
      why(a, P) {
        const t = placeTarget(a, P, "gym");
        return t ? `${GEO.minutesTo(a, t.lat, t.lon, "walk")} min to ${t.pinned ? "your gym" : t.name}` : "Gym nearby";
      },
      but: (a, P) => GEO.anchorFor(P, "Gym")
        ? "A long way from your gym" : "The nearest gym is a trek",
    },

    commute: {
      label: "Short commute", icon: "briefcase", tab: "life", quizzable: true,
      // Only scores where the renter gave us somewhere to go. With no anchor
      // there is nothing to commute to, and scoring errand distance instead
      // would double-count what walkability already measures.
      raw(a, P) {
        const lg = GEO.legs(a, P).filter((l) => l.fixed);
        if (!lg.length) return null;
        let burden = 0, w = 0;
        for (const l of lg) {
          const wt = l.label.toLowerCase().includes("work") ? 3 : 1.5;
          burden += wt * curve(l.mins, [[8, 100], [18, 74], [30, 38], [50, 0]]);
          w += wt;
        }
        return burden / w;
      },
      conf: (a) => a.parcel_ok ? 0.8 : 0.5,
      why(a, P) {
        const l = GEO.legs(a, P).filter((x) => x.fixed)[0];
        return l ? `${l.mins} min to ${l.label}` : "Short trips to your places";
      },
      but(a, P) {
        const l = GEO.legs(a, P).filter((x) => x.fixed).sort((x, y) => y.mins - x.mins)[0];
        return l ? `${l.mins} min each way to ${l.label}` : "A long way from your places";
      },
    },

    /* ---------- can we believe this listing at all? ----------
       Not offered in the quiz, and weighted heavily anyway, because nobody
       thinks to ask for it and everybody wants it.

       A post with no photographs is the single loudest signal in this data.
       Only 70 of 2,547 listings have none, 63 of them on Craigslist, and a
       Craigslist ad with no pictures, an address that never matched the parcel
       map, and a rent well under the median for its size is the classic shape
       of a rental scam. None of those facts proves fraud on its own, so this
       does not accuse anyone — it lowers the score, says which checks failed,
       and lets the reader draw the conclusion. */
    verification: {
      label: "Listing verification", icon: "search", tab: "verify", quizzable: false,
      baseW: 1.7,
      raw(a) {
        let v = 70;                                  // an ordinary listing
        const photos = (a.photos || []).length;
        if (!photos) v -= 40;                        // the loudest signal here
        else if (photos === 1) v -= 9;
        else v += 9;
        if (a.photo_reuse) v -= 22;                  // same pictures, other address
        if (!a.parcel_ok) v -= 16;                   // no such building on the map
        if (underpriced(a)) v -= 30;                 // too good to be true
        if ((a.src || []).length > 1) v += 12;       // two sources agree it exists
        if (a.est === "verified") v += 5;
        if (a.landlord && a.landlord.conf === "registered") v += 8;
        if (isPlan(a)) v -= 14;          // a plan is not a vacancy
        if (a.avail === "live") v += 7;
        else if (a.avail === "gone" || a.avail === "no_units") v -= 22;
        // Whatever the cross-examination in deal.js turned up, weighted by how
        // much of it there was rather than by any single finding.
        const d = DEAL.audit(a);
        v -= Math.min(34, d.weight * 7);
        if (d.verdict === "bargain") v += 6;
        return cl(v, 0, 100);
      },
      // These are structural facts about the record, not sampled measurements,
      // so we are not guessing — we either checked or we didn't.
      conf: () => 0.9,
      why: (a) => (a.src || []).length > 1
        ? `Listed on ${a.src.length} sites that agree on the address`
        : "Address matches a real building on the city parcel map",
      but(a) {
        if (!(a.photos || []).length) return "No photos on the listing - we can't see the unit";
        if (underpriced(a)) return "Priced well under the going rate for its size - verify before paying anything";
        if (a.photo_reuse) return "Some of these photos appear on another address";
        if (!a.parcel_ok) return "This address didn't match a building on the parcel map";
        return "Little independent confirmation this listing is genuine";
      },
    },

    /* ---------- how old is this advert ----------
       Not in the quiz because nobody needs to be asked whether they would like
       to chase a flat that went three weeks ago.

       Craigslist delta-encodes a real posting time; Apartments.com publishes
       "3 days ago" and we parse it. Zillow's search results carry no date at
       all, so a third of the field returns null here — and null is normalised
       out of the denominator rather than scored as stale. Punishing Zillow for
       what Zillow declines to publish would quietly re-rank the whole list on
       a fact about the source rather than about the apartment. */
    freshness: {
      label: "Recently posted", icon: "clock", tab: "verify", quizzable: false,
      baseW: 1.1,
      raw(a) {
        if (!a.posted) return null;
        const days = (Date.now() / 1000 - a.posted) / 86400;
        return curve(days, [[1, 100], [3, 92], [7, 76], [14, 52], [30, 22], [60, 4]]);
      },
      conf: (a) => a.posted ? 0.9 : 0,
      why: (a) => `Posted ${agoWords(a.posted)}`,
      but: (a) => `Posted ${agoWords(a.posted)} - older ads are likelier to be gone`,
    },

    /* ---------- living here with a dog ----------
       Only scores for people who said they have one, and it is deliberately
       more than "does the lease allow it". A flat that permits dogs but sits
       twenty minutes from the nearest green space is a worse dog home than one
       across from a park, and no listing site tells you that. So this is the
       policy, the fees, and somewhere to actually walk. */
    dogs: {
      label: "Good for a dog", icon: "dog", tab: "walks", quizzable: false, baseW: 0,
      raw(a, P) {
        if ((P.pets || "none") !== "dog") return null;
        let v = 50;
        if (a.pet && a.pet.dogs) v += 30;
        else if (a.pet && a.pet.ok) v += 15;
        else if (!a.pet) v -= 5;                    // nobody published a policy
        // Somewhere to go twice a day.
        const parks = GEO.countWithin(a, ["park"], 800);
        v += Math.min(25, parks * 8);
        const nr = GEO.nearest(a, "park", null);
        if (nr && nr.m > 1200) v -= 12;
        // Recurring pet rent is a real monthly cost, not a footnote.
        if (a.pet && a.pet.monthly) v -= Math.min(12, a.pet.monthly / 10);
        return cl(v, 0, 100);
      },
      conf: (a) => a.pet ? 0.85 : 0.4,
      why(a) {
        const parks = GEO.countWithin(a, ["park"], 800);
        const fee = a.pet && a.pet.monthly ? `, ${money(a.pet.monthly)}/mo pet rent` : "";
        return `Dogs allowed${fee} · ${parks} green space${parks === 1 ? "" : "s"} within a 10-min walk`;
      },
      but(a) {
        if (!a.pet) return "No pet policy published - confirm dogs before you view";
        if (!a.pet.dogs) return "The policy mentions pets but not dogs specifically";
        return "Little green space within walking distance for a dog";
      },
    },

    /* ---------- is this the flat, or the building's brochure? ----------
       The cheap, honest version of looking at the photographs.

       We cannot see pixels here — that would need a vision API, a key, and a
       bill, on a demo that has to run offline. But there is a free signal
       sitting in the data that answers most of the same question: how much
       does this listing know about THE UNIT, as opposed to the building?

       A leasing page for a 200-unit tower has five beautiful photographs of a
       lobby, a gym and a model apartment nobody is renting, and nothing about
       the flat you would actually get. A listing matched to a specific unit has
       its own amenity list, its own verified rent, its own floor area. The
       shape is stark: 929 listings — 35% of the field, 909 of them Craigslist —
       carry four or more photographs and not one unit-level fact.

       So photographs are not counted as evidence of anything except that
       photographs exist. What counts is whether anybody told us about the
       apartment. */
    unitproof: {
      label: "Shows the actual unit", icon: "window", tab: "verify",
      quizzable: false, baseW: 1.2,
      raw(a) {
        let v = 25;
        const am = (a.unit_amen || []).length;
        if (am) v += 18 + Math.min(14, am * 3);   // its own amenity list
        if (a.est === "verified") v += 22;        // its own rent, not the building's range
        if (a.sqft) v += 14;                      // its own floor area
        if (a.wd != null) v += 8;                 // somebody checked the laundry
        // Lots of pictures and nothing else is the brochure, not the flat.
        if ((a.photos || []).length >= 4 && !am && a.est !== "verified" && !a.sqft) v -= 18;
        return cl(v, 0, 100);
      },
      conf: () => 0.85,
      why(a) {
        const am = (a.unit_amen || []).length;
        if (am && a.est === "verified")
          return `Matched to this unit - ${am} amenities and its own verified rent`;
        if (am) return `${am} amenities listed for this unit specifically`;
        if (a.est === "verified") return "Rent verified for this unit, not the building";
        return `${num(a.sqft)} sq ft published for this unit`;
      },
      but(a) {
        if ((a.photos || []).length >= 4)
          return `${a.photos.length} photos but nothing specific to this unit - you may be looking at the building, not the flat`;
        return "Nothing published about this specific unit - ask what you'd actually be renting";
      },
    },

    /* Not offered in the quiz. These exist so that step 4 has something to say
       about a building nobody asked questions about. */
    condition: {
      label: "Building condition", icon: "building", tab: null, quizzable: false, baseW: 0.26,
      raw(a) {
        if (!a.yr) return null;
        return curve(a.yr, [[1900, 45], [1950, 55], [1990, 72], [2015, 92], [2025, 96]]);
      },
      conf: (a) => a.yr ? 0.5 : 0,
      why: (a) => `Built ${a.yr}`,
      but: (a) => `A ${a.yr} building - expect its age to show`,
    },
  };

  /* ---------- hard requirements ----------
     Three outcomes, never two. `fail` is a wall the listing runs into.
     `unknown` is a question the renter has to ask on the viewing, and it is
     shown as "needs verification" rather than counted as a failure. */
  const AMEN_MATCH = {
    ac:         /air condition/i,
    wd:         /washer\/dryer/i,
    dishwasher: /dishwasher/i,
    outdoor:    /patio|balcony|deck/i,
    furnished:  /furnished/i,
    storage:    /storage|walk-in closet/i,
  };
  const AMEN_LABEL = {
    ac: "A/C", wd: "In-unit laundry", dishwasher: "Dishwasher",
    outdoor: "Outdoor space", furnished: "Furnished", storage: "Storage",
    pets: "Pet-friendly", rc: "Rent-controlled",
  };

  function requirements(a, P) {
    const out = [];
    const act = a.act ? a.act[0] : a.rent;
    const say = (state, key, text) => out.push({ state, key, text });

    if (P.maxBudget && act != null) {
      if (act > P.maxBudget) say("fail", "budget", `${money(act)}/mo est. is over your ${money(P.maxBudget)} maximum`);
      else say("ok", "budget", `Within your ${money(P.maxBudget)} maximum`);
    }
    if (P.beds != null) {
      if (a.beds == null) say("unknown", "beds", "The listing never says how many bedrooms");
      else if (a.beds < P.beds) say("fail", "beds", `${bedTxt(a.beds)}, you need ${P.beds}+`);
      else say("ok", "beds", `${bedTxt(a.beds)}`);
    }
    /* A commute ceiling is a wall in the same way a budget is. Somebody who
       says forty-five minutes has told us that the hour-and-ten-minute flat in
       a lovely neighbourhood is not a candidate, however well it scores on
       everything else — and averaging that into a mean would put it back. */
    if (P.maxCommute) {
      const work = GEO.legs(a, P).filter((l) => l.fixed)
        .sort((x, y) => (/work/i.test(y.label) ? 1 : 0) - (/work/i.test(x.label) ? 1 : 0))[0];
      if (work) {
        if (work.mins > P.maxCommute)
          say("fail", "commute", `${work.mins} min to ${work.label}, past your ${P.maxCommute} min limit`);
        else say("ok", "commute", `${work.mins} min to ${work.label}`);
      }
    }
    for (const k of P.must || []) {
      if (k === "pets") {
        // Apartments.com publishes no "not allowed" value at all, and an
        // unticked Craigslist box means the poster skipped a checkbox. Neither
        // source can produce a confident refusal, so a pet requirement can be
        // unknown but never failed.
        if (!a.pet) say("unknown", k, "No pet policy published - ask before you view");
        else if (a.pet.ok) say("ok", k, a.pet.monthly ? `Pets OK - ${money(a.pet.monthly)}/mo pet rent` : "Pets allowed");
        else say("unknown", k, "This post doesn't say pets are OK - worth confirming");
        continue;
      }
      if (k === "rc") {
        if (a.rc === "yes") say("ok", k, "Likely rent-controlled");
        else if (a.rc === "no") say("fail", k, "City records say this building is not rent-controlled");
        else say("unknown", k, "Rent-control status is unclear for this building");
        continue;
      }
      if (k === "wd" && a.wd != null) { // an explicit field beats the amenity list
        if (a.wd) say("ok", k, "In-unit washer/dryer");
        else say("unknown", k, "No in-unit laundry mentioned - worth confirming");
        continue;
      }
      const re = AMEN_MATCH[k];
      if (!re) continue;
      // Silence is not evidence of absence. Only a listing that published an
      // amenity list can be read as not having something on it, and even then
      // we ask rather than reject.
      if (!a.unit_amen || !a.unit_amen.length) say("unknown", k, `${AMEN_LABEL[k]} not listed - needs verification`);
      else if (a.unit_amen.some((x) => re.test(x))) say("ok", k, `${AMEN_LABEL[k]} confirmed`);
      else say("unknown", k, `${AMEN_LABEL[k]} isn't on this listing's amenity list`);
    }
    return out;
  }

  /* ---------- anomalies (step 5) ----------
     Severe enough to say regardless of what the renter picked, attributed to
     the record that supports it. Nothing model-generated, nothing inferred
     about a named person or company. */
  function anomalies(a) {
    const out = [];
    const perUnit = (a.novs || 0) / Math.max(1, a.units || 1);
    if (perUnit > 1.5)
      out.push({ text: `${num(a.novs)} building violations across ${num(a.units)} units`, src: "SF DBI complaints" });
    if ((a.over_year || 0) > 3)
      out.push({ text: `${a.over_year} violations here took over a year to close`, src: "SF DBI complaints" });
    if (a.referred > 0)
      out.push({ text: "The city escalated a case here to the City Attorney", src: "SF DBI referrals" });
    // `key` names the panel that can show the reader the same records this
    // sentence was derived from, so a claim about a block can be checked
    // against the map of that block instead of being taken on faith.
    const vi = streetPct(a, "violent"), br = streetPct(a, "break_in");
    if (vi >= 88)
      out.push({ text: `Assaults and robberies nearby busier than ${Math.round(vi)}% of listings`, src: "SFPD incident reports", key: "street" });
    else if (br >= 90)
      out.push({ text: `Car break-ins nearby busier than ${Math.round(br)}% of listings`, src: "SFPD incident reports", key: "street" });
    if (a.rating != null && a.rating < 3 && (a.rating_n || 0) >= 3)
      out.push({ text: `Rated ${a.rating}/5 by ${num(a.rating_n)} reviewers`, src: a.rating_src || "reviews", key: "residents" });
    if (a.shared)
      out.push({ text: a.shared_why || "This looks like a room rather than a whole home", src: "listing text" });

    /* Legitimacy. deal.js has already cross-examined this listing against the
       rest of the data set, so rather than repeat its checks here we promote
       whatever it found serious. A listing it cleared says nothing, which is
       the point — the old version warned about a low price even when rent
       control explained it. */
    const d = DEAL.audit(a);
    if (d.verdict === "suspect" || d.high) {
      for (const c of d.concerns.filter((x) => x.sev === "high").slice(0, 2))
        out.push({ text: c.text, src: c.src });
    }

    /* Availability is the complaint that actually costs a renter their evening.
       Zillow has no free liveness check, so its listings can only ever be
       "unchecked" — and saying that plainly is better than implying they are
       live because we did not look. */
    if (a.avail === "gone" || a.avail === "no_units")
      out.push({ text: "This listing looks gone - it was not in the latest sweep",
                 src: a.avail_src || "availability sweep" });
    else if (a.avail === "unknown")
      out.push({ text: "We could not check whether this is still available",
                 src: "no free liveness check on this source", soft: true });

    if (a.est !== "verified")
      out.push({ text: "Some monthly fees are unverified", src: "listing", soft: true });
    return out;
  }

  /* ---------- the model ----------
     Built once per search set, because rule 2 needs the whole distribution
     before any single apartment can be given a percentile. */
  function build(all, P) {
    _mean = null;
    DEAL.init(all);              // the auditor's medians come from this search
    const ctx = { all };
    const keys = Object.keys(REG);

    // 1. raw values for the whole field
    const raws = new Map();
    for (const k of keys) raws.set(k, new Map());
    for (const a of all) {
      for (const k of keys) {
        let v = null;
        try { v = REG[k].raw(a, P, ctx); } catch { v = null; }
        raws.get(k).set(a.id, Number.isFinite(v) ? v : null);
      }
    }

    // 2. percentile tables — one sorted array of known values per factor
    const dist = new Map();
    for (const k of keys) {
      const vals = [...raws.get(k).values()].filter((v) => v != null).sort((x, y) => x - y);
      dist.set(k, vals);
    }
    function pctOf(k, v) {
      const vals = dist.get(k);
      if (!vals || !vals.length || v == null) return null;
      let lo = 0, hi = vals.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
      // Midpoint of the tied run, so identical blocks share a percentile
      // instead of one arbitrarily outranking the other.
      let hi2 = lo;
      while (hi2 < vals.length && vals[hi2] === v) hi2++;
      return Math.round(((lo + hi2) / 2) / vals.length * 100);
    }

    /* 3. weights. Never rendered — see rule 3.

       Factors fall into two groups that answer different questions, and they
       are averaged separately because averaging them together was a bug.

         picked    what this renter said matters. "Is this the kind of place
                   I asked for?"
         baseline  everything else. "Is it a decent, real, safe place at all?"
                   Nobody should have to ask for this.

       Mixing them into one weighted mean is what produced "I said partying
       matters and it sent me to the middle of nowhere". With fourteen factors
       contributing, a top priority weighted 3.2 was still only 23% of the
       mean, so a listing in the 95th percentile on the single thing that
       mattered — and unremarkable elsewhere — came out around 60, which is
       where a listing that is mediocre at everything also comes out. A mean
       over fourteen terms cannot express a preference. It can only express an
       average, and it did that faithfully.

       Splitting the groups lets a priority move the number the way the person
       who stated it expects, while the baseline still stops the answer from
       being a nightlife-adjacent hovel. */
    const IMP_W = { vhigh: 3.2, high: 2.1, nice: 1.2 };
    const BASELINE = 0.32;
    const PRIORITY_SHARE = 0.7;    // of the composite, when anything was picked

    const picked = new Set(
      Object.keys(P.priorities || {}).filter((k) => REG[k] && (P.priorities[k] in IMP_W))
    );

    /* Budget decides what the baseline is allowed to demand.

       Paying the top of your range for a place with nothing in it is a worse
       deal than paying the bottom of it for the same place, so the further up
       the renter's own range a listing sits, the more the "what else am I
       getting" factors count — amenities, how the area actually is, how the
       building is run. Near the bottom of the range those are luxuries, and
       what matters is that the place is real and safe.

       Scaled against the renter's own comfort/max range rather than the
       market, because "expensive" only means anything relative to what this
       person can spend. */
    const DEMAND_KEYS = new Set(["space", "management", "residents", "amenities",
                                 "grocery", "gym", "walk", "transit", "nightlife"]);
    const SAFETY_KEYS = new Set(["street", "quiet", "verification", "unitproof"]);

    function demandFor(a) {
      const max = P.maxBudget || P.comfort || 0;
      const comfort = P.comfort || max;
      const rent = (a && (a.rent || (a.act && a.act[0]))) || 0;
      if (!max || !rent) return 0.5;
      // 0 at the comfortable number, 1 at the ceiling. Below comfort stays 0.
      return cl((rent - comfort) / Math.max(1, max - comfort), 0, 1);
    }

    const weights = {};
    for (const k of keys) {
      const imp = (P.priorities || {})[k];
      // A factor nobody can pick may still declare its own weight — that is how
      // "is this listing real" gets a real say without anyone asking for it.
      weights[k] = REG[k].quizzable
        ? (IMP_W[imp] ?? BASELINE)
        : (REG[k].baseW ?? BASELINE * 0.8);
      // Living with a dog is not a preference to be weighed against others --
      // for the people it applies to it is most of the decision, and for
      // everyone else it is noise. So it is all or nothing.
      if (k === "dogs") weights[k] = (P.pets || "none") === "dog" ? 2.4 : 0;
    }

    // Baseline weight for one factor at a given budget pressure. Demand-side
    // factors climb with what you are being asked to pay; safety-side factors
    // matter throughout and climb a little as the stakes rise.
    function baseWeightFor(k, demand) {
      const w = weights[k];
      if (DEMAND_KEYS.has(k)) return w * (0.55 + 1.30 * demand);
      if (SAFETY_KEYS.has(k)) return w * (1.00 + 0.35 * demand);
      return w;
    }

    /* ---------- phase one: the composite ----------
       A weighted mean of confidence-adjusted percentiles. Honest, and
       compressed by construction: averaging eight percentiles regresses to the
       middle, so even a listing in the 95th percentile on its owner's top
       priority came out at 62. That is the arithmetic working, not failing. */
    function evaluate(a) {
      const req = requirements(a, P);
      const fails = req.filter((r) => r.state === "fail");
      const unknowns = req.filter((r) => r.state === "unknown");

      const F = {};
      const demand = demandFor(a);
      let pNum = 0, pDen = 0, bNum = 0, bDen = 0, confSum = 0, confW = 0;
      for (const k of keys) {
        const raw = raws.get(k).get(a.id);
        const pct = pctOf(k, raw);
        const c = raw == null ? 0 : cl(REG[k].conf(a, P) ?? 0.5, 0, 1);
        // Pull an uncertain observation toward neutral instead of trusting or
        // punishing it. This is what costs the top of the field its ceiling,
        // and it is worth the cost: the alternative rewards listings we know
        // least about.
        const adj = pct == null ? null : c * pct + (1 - c) * 50;
        const isPicked = picked.has(k);
        const w = isPicked ? weights[k] : baseWeightFor(k, demand);
        F[k] = { key: k, raw, pct, conf: c, adj, w, picked: isPicked, def: REG[k] };
        if (adj == null) continue;
        if (isPicked) { pNum += w * adj; pDen += w; }
        else { bNum += w * adj; bDen += w; }
        confSum += c * w; confW += w;
      }

      // Averaged within each group, then blended — so a priority competes with
      // the handful of other things this renter named, not with every fact the
      // pipeline happens to know.
      const priorityScore = pDen ? pNum / pDen : null;
      const baselineScore = bDen ? bNum / bDen : null;
      let composite =
        priorityScore == null ? baselineScore
        : baselineScore == null ? priorityScore
        : PRIORITY_SHARE * priorityScore + (1 - PRIORITY_SHARE) * baselineScore;

      /* ---------- a stated priority cannot be averaged away ----------
         A weighted mean is the wrong shape for a preference someone declared.
         755 O'Farrell scored 23rd percentile on street conditions — with full
         confidence, on a block where all four city datasets read "higher" —
         for a renter who called street conditions important, and still came
         out ranked 97, because one bad factor among fifteen barely moves a
         mean. That is the mean working as designed and the design being wrong.

         So a picked factor in the bottom third multiplies the score down
         instead of nudging it. The floor is set by how important they said it
         was: someone who called it very important can lose nearly half, someone
         who called it nice-to-have loses a little. Nothing bites above the 35th
         percentile, so this only ever fires on a genuine weak spot, and the
         card names it under "Good to know" rather than quietly deducting. */
      /* Only the worst one, and only a genuine weak spot.

         Multiplying every gate together fired on 79% of the field -- with four
         priorities, most listings are in the bottom third of at least one, and
         stacking three 0.9s is a 27% penalty for being unremarkable. That
         collapsed the median composite from 49 to 34 and made the gate a level
         shift rather than a distinction, which is the same defect as a check
         that is always true.

         So: the single worst picked factor gates, nothing stacks, and it only
         engages below the 30th percentile. A listing is penalised for the one
         thing it is genuinely bad at, not for being average at four. */
      const GATE_FLOOR = { vhigh: 0.55, high: 0.68, nice: 0.85 };
      const BITE = 30;
      let gates = [];
      if (composite != null) {
        for (const k in (P.priorities || {})) {
          const f = F[k];
          if (!f || f.pct == null || f.pct >= BITE) continue;
          const floor = GATE_FLOOR[P.priorities[k]] ?? 0.85;
          const over = cl((BITE - f.pct) / BITE, 0, 1);
          // Linear in how far below the line it sits, so the bottom decile is
          // punished roughly three times as hard as the 27th percentile.
          const g = cl(1 - (1 - floor) * over, floor, 1);
          gates.push({ key: k, label: REG[k].label, pct: f.pct, gate: g });
        }
        gates.sort((x, y) => x.gate - y.gate);
        gates = gates.slice(0, 1);
        if (gates.length) composite *= gates[0].gate;
      }

      const anom = anomalies(a).filter((x) => !x.soft);
      if (composite != null && anom.length) composite -= Math.min(14, anom.length * 6);

      const confidence = confW ? confSum / confW : 0;
      return { a, composite, priorityScore, baselineScore, demand,
               F, req, fails, unknowns, gates,
               anomalies: anomalies(a), blocked: fails.length > 0,
               conf: confidence,
               confLabel: confidence >= 0.72 ? "High" : confidence >= 0.5 ? "Medium" : "Low" };
    }

    /* ---------- phase two: where that lands you ----------
       Two earlier versions of this number failed in opposite directions, and
       the reason is worth writing down because the obvious fixes are the two
       that did not work.

       Showing the composite directly put the best listing in the city at 62,
       because a weighted mean of confidence-adjusted percentiles regresses to
       the middle by construction. Everything looked mediocre.

       Replacing it with a percentile rank of the eligible field fixed the
       ceiling and broke the floor: the interface only ever shows the top sixty
       of eight hundred, so every visible listing sat between 91 and 99 and
       every one of them read "Excellent fit". The rank was arithmetically
       correct and told the reader nothing, which is the same defect as a check
       that is always true.

       So the number is a linear rescale of the composite against the range
       actually achievable for this profile: the floor of the field maps near
       zero, the best listing maps near the top, and everything else lands in
       proportion to how far along that span it really is. Unlike a percentile
       it does not flatten differences where listings are dense, so a listing
       that is genuinely twice as far above the floor scores twice as far above
       it. A weak market yields low numbers, and it should — "the best of a bad
       week" is information the reader is entitled to. */
    let field = null;
    function buildField() {
      if (field) return field;
      const v = [];
      for (const a of all) {
        const e = evaluate(a);
        if (e.composite == null || e.blocked) continue;   // not on the market for you
        v.push(e.composite);
      }
      v.sort((x, y) => x - y);
      // The floor is a percentile so one broken record cannot drag the scale
      // down. The ceiling is the true maximum, because the composite is a
      // weighted mean of bounded percentiles and therefore cannot produce a
      // runaway outlier — and anchoring it on p99.5 instead flattened the top
      // of the list, which is the part the reader is actually choosing between.
      const at = (p) => v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : 0;
      const lo = at(0.05), hi = v[v.length - 1];
      field = { v, lo, hi: hi > lo + 1 ? hi : lo + 1 };
      return field;
    }

    function rankOf(composite) {
      const f = buildField();
      if (!f.v.length || composite == null) return null;
      return cl(Math.round((composite - f.lo) / (f.hi - f.lo) * 100), 1, 99);
    }

    /* Thresholds sit where they do because the scale now means "how far up the
       range you can actually reach is this", not "how many listings did it
       beat". Most of what anyone is shown should land in the upper half; that
       is what being shown at all is supposed to signify. */
    const label = (r) => r == null ? "-"
      : r >= 85 ? "Excellent fit" : r >= 70 ? "Great fit"
      : r >= 50 ? "Good fit" : r >= 30 ? "Worth a look" : "Weak fit";

    function score(a) {
      const e = evaluate(a);
      // A listing that fails a hard requirement is not in the field it would
      // be ranked against, so it gets a rank floor rather than a percentile.
      const r = e.blocked ? Math.min(20, rankOf(e.composite) ?? 20) : rankOf(e.composite);
      return Object.assign(e, {
        score: r,
        raw: e.composite == null ? null : Math.round(e.composite),
        label: label(r),
      });
    }

    /* ---------- what to put on screen ----------
       The whole point of the score is that it REDUCES information. These two
       pick the handful of lines the card is allowed to show. */

    // Strengths, restricted to what this renter actually asked about, so a
    // nightlife-lover and a quiet-seeker get different sentences from the same
    // building. A factor has to be genuinely good (top third) to earn a line.
    function highlights(fit, max) {
      const picked = Object.keys(P.priorities || {});
      const pool = picked.length ? picked : ["cost", "quiet", "walk", "transit"];
      const out = pool
        .map((k) => fit.F[k])
        .filter((f) => f && f.adj != null && f.pct >= 60)
        // A factor may veto its own good percentile — see cost.strong().
        .filter((f) => !f.def.strong || f.def.strong(fit.a, P))
        .sort((x, y) => (y.adj * y.w) - (x.adj * x.w))
        .map((f) => ({ icon: f.def.icon, text: f.def.why(fit.a, P, { pct: f.pct }), key: f.key }));

      // A confirmed must-have is a strength too, and the one the renter is most
      // likely to be scanning for.
      for (const r of fit.req) {
        if (r.state === "ok" && r.key !== "budget" && r.key !== "beds")
          out.unshift({ icon: "snowflake", text: r.text, key: r.key });
      }
      return out.slice(0, max || 4);
    }

    // "What could make me regret choosing this?" — at most two, and never five
    // warning cards. A failed requirement outranks a weak factor; an anomaly
    // outranks both.
    /* Order is the whole feature. There are only two slots, so whatever fills
       them has to be the thing most likely to cause regret — and "some fees are
       unverified", which is true of most of the city, must never crowd out
       "two hours from the gym you told us about". Hard failures first, then
       severe records, then the renter's own priorities going badly, then
       questions to ask, and only then the boilerplate caveats. */
    function tradeoffs(fit, max) {
      const picked = Object.keys(P.priorities || {});
      // `key` rides along so the interface can offer to *show* the problem
      // rather than only assert it. "Street conditions are in the bottom
      // third" is a claim; the map of what the city recorded on that block is
      // the evidence, and the reader should not have to go hunting for the tab
      // that holds it.
      const weak = picked.map((k) => fit.F[k])
        .filter((f) => f && f.adj != null && f.pct <= 34)
        .sort((x, y) => (x.adj * x.w) - (y.adj * y.w))
        .map((f) => ({ text: f.def.but(fit.a, P, { pct: f.pct }),
                       kind: "weak", key: f.key, pct: f.pct }));

      const hard = fit.anomalies.filter((x) => !x.soft)
        .map((x) => ({ text: x.text, kind: "anomaly", src: x.src, key: x.key }));
      const soft = fit.anomalies.filter((x) => x.soft)
        .map((x) => ({ text: x.text, kind: "anomaly", src: x.src, key: x.key }));

      return [
        ...fit.fails.map((r) => ({ text: r.text, kind: "fail" })),
        ...hard,
        ...weak,
        ...fit.unknowns.map((r) => ({ text: r.text, kind: "unknown" })),
        ...soft,
      ].slice(0, max || 2);
    }

    return { score, highlights, tradeoffs, pctOf, weights, REG, P,
             raw: (a, k) => raws.get(k).get(a.id) };
  }

  return { build, REG, requirements, anomalies, streetPct, shrunkRating, AMEN_LABEL,
           underpriced, warnings, isPlan };
})();
