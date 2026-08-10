/* deal.js — the second opinion.
   ============================================================
   A small auditor that reads one listing against everything else we know and
   asks a single question: does this hang together?

   It exists because of Craigslist. An ad there is whatever the poster typed,
   and the cheapest listings in this data set are a mix of two very different
   things: real bargains, and posts that are cheap precisely because nothing
   behind them is real. Price alone cannot tell them apart. A $1,600 one-bed in
   Nob Hill is either a rent-controlled walk-up whose tenant of eleven years
   finally moved out, or it is a photograph of someone else's apartment.

   So this does not score cheapness. It cross-examines it:

     CONCERNS      things that do not line up with each other
     EXPLANATIONS  legitimate reasons this price could be low
     CORROBORATION independent evidence the place exists as described

   A deep discount with three concerns and nothing corroborating it is a
   different object from the same discount on a 1907 rent-controlled building
   that two sources list, the city has inspected, and residents have reviewed.
   The first gets a warning. The second gets told it is a rare find.

   Two rules it holds to:

   1. It never accuses anyone. Every finding is a comparison between two facts
      we can name, with its source attached. "No photos, and the rent is 38%
      under the median for a 1-bed in this neighbourhood" is a finding. "This
      is a scam" is a legal conclusion about a person, and it is not ours.

   2. It never converts absence into guilt on its own. One missing field is
      housekeeping. It takes a pattern to raise a verdict, which is why the
      thresholds below count concerns rather than tripping on any single one.
   ============================================================ */

const DEAL = (() => {
  "use strict";

  /* ---------- what this apartment ought to cost ----------
     Built from the data set itself rather than an outside index, so the
     comparison is always against listings the renter could actually see. */
  let IDX = null;

  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function index(all) {
    if (IDX) return IDX;
    const byHoodBeds = new Map(), byBeds = new Map();
    const psfByHood = new Map(), byAddr = new Map();
    const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

    for (const a of all) {
      const rent = a.act ? a.act[0] : a.rent;
      if (!rent) continue;
      if (a.beds != null) {
        push(byBeds, a.beds, rent);
        if (a.hood) push(byHoodBeds, `${a.hood}|${a.beds}`, rent);
      }
      if (a.sqft > 120 && a.hood) push(psfByHood, a.hood, rent / a.sqft);
      push(byAddr, (a.addr || "").toLowerCase(), { id: a.id, rent, beds: a.beds });
    }
    const fold = (m) => { const o = new Map(); for (const [k, v] of m) o.set(k, median(v)); return o; };
    IDX = { hoodBeds: fold(byHoodBeds), beds: fold(byBeds),
            psf: fold(psfByHood), addr: byAddr,
            counts: new Map([...byHoodBeds].map(([k, v]) => [k, v.length])) };
    return IDX;
  }

  /* The expected rent, and how much we trust it. A neighbourhood-and-bedroom
     median built on four listings is a rumour, so thin comparisons fall back to
     the citywide figure for that bedroom count. */
  function expected(a) {
    const i = index(dataset());
    const key = `${a.hood}|${a.beds}`;
    const local = i.hoodBeds.get(key), n = i.counts.get(key) || 0;
    if (local && n >= 6) return { rent: local, basis: `${a.hood} ${bedWord(a.beds)}`, n };
    const city = i.beds.get(a.beds);
    if (city) return { rent: city, basis: `${bedWord(a.beds)} across this search`, n: 0 };
    return null;
  }
  const bedWord = (b) => b === 0 ? "studios" : b === 1 ? "1-beds" : `${b}-beds`;

  /* Falls back to the full data set rather than an empty one. init() is called
     from FACTORS.build(), which only runs once there is a profile to rank
     against -- so anything asking this auditor a question before the quiz is
     finished used to get a silent null from every price check, which reads
     exactly like "nothing wrong here". Failing quiet is the one thing a fraud
     check must never do. */
  let ALL = [];
  function init(all) { ALL = all; IDX = null; }
  const dataset = () => ALL.length ? ALL : (typeof A !== "undefined" ? A : []);

  /* ---------- the checks ----------
     Each returns null or a finding. Severity is about how much it should change
     someone's behaviour, not how unusual it is. */
  const LUXURY = /luxur|renovat|remodel|doorman|penthouse|new construction|high[- ]end|designer/i;

  /* The vocabulary of a for-sale brochure, not a rental ad. Scam posts are
     routinely built by pasting the description off an old Redfin or MLS page
     for the same building — which is why they read beautifully and tell you
     nothing a tenant needs, like who to contact or when you can see it. */
  const BROCHURE = /\b(boasts?|light[- ]filled|period details?|highly desirable|coved ceiling|picture rail|granite counters?|stainless appliances?|gleaming|immaculate|pristine|ample storage|entry leads|conveniently located|steps from)\b/i;
  // Craigslist truncates titles at 70 characters. A title that runs to the wire
  // and stops mid-phrase was not written as a title.
  const PROSE_START = /^\s*(this|the|a|an)\s+[a-z]+/i;
  const ENDS_CLEANLY = /[.!?)\]]\s*$|\d\s*$/;
  const URGENT = /urgent|asap|must go|today only|first come|no credit check/i;
  // The FTC's list, near enough verbatim: the payment rails you cannot claw
  // money back from. Scams are not a Craigslist problem -- these run on every
  // listing site -- so this is checked on all three sources, not just one.
  const PAY_RISK = /\bwire(d|s|ing)?\b|western union|money ?gram|zelle|cash ?app|venmo|gift ?card|bitcoin|crypto|btc|usdt|deposit before|sight ?unseen/i;

  function audit(a) {
    const rent = a.act ? a.act[0] : a.rent;
    const exp = expected(a);
    const discount = exp && exp.rent ? 1 - rent / exp.rent : null;
    const concerns = [], explains = [], corroborates = [];
    const title = a.name || "";
    /* Apartments.com publishes a real description for 730 listings, and until
       now the auditor was reading a 70-character title and nothing else. Body
       text is where urgency, payment demands and brochure copy actually live,
       so every wording check reads both. Apartments.com also emits the literal
       string "None" for an absent special, which is not a special. */
    const body = (a.desc && a.desc !== "None") ? a.desc : "";
    const words = `${title}\n${body}`;

    /* --- price against its own neighbourhood --- */
    if (discount != null && discount >= 0.22) {
      concerns.push({
        id: "below_market", sev: discount >= 0.4 ? "high" : "med",
        text: `${Math.round(discount * 100)}% under the median for ${exp.basis} (${money(exp.rent)})`,
        src: "this data set",
      });
    }

    /* --- price against the same building ---
       The strongest single check available, because it holds neighbourhood,
       building, age and management constant. If four units at this address ask
       $3,400 and this one asks $1,900, the difference is not the market. */
    const sameAddr = (index(dataset()).addr.get((a.addr || "").toLowerCase()) || [])
      .filter((x) => x.id !== a.id && x.beds === a.beds);
    if (sameAddr.length >= 2) {
      const m = median(sameAddr.map((x) => x.rent));
      if (m && rent < m * 0.7) {
        concerns.push({
          id: "below_building", sev: "high",
          text: `${Math.round((1 - rent / m) * 100)}% under the other ${sameAddr.length} ${
            bedWord(a.beds)} listed at this same address (${money(m)})`,
          src: "other listings at this address",
        });
      }
    }

    /* --- price against floor area --- */
    if (a.sqft > 120 && a.hood) {
      const psf = index(dataset()).psf.get(a.hood);
      if (psf && rent / a.sqft < psf * 0.6) {
        concerns.push({
          id: "cheap_psf", sev: "med",
          text: `$${(rent / a.sqft).toFixed(2)} per sq ft against $${psf.toFixed(2)} typical in ${a.hood}`,
          src: "this data set",
        });
      }
    }

    /* --- what it claims against what it costs ---
       Renovations and doormen are things landlords charge for. A listing
       advertising both at half price is describing two different apartments. */
    if (discount != null && discount >= 0.28 && LUXURY.test(title)) {
      concerns.push({
        id: "luxury_cheap", sev: "high",
        text: `The ad advertises a renovated or luxury unit at ${Math.round(discount * 100)}% under the going rate`,
        src: "listing title",
      });
    }
    if (discount != null && discount >= 0.25 && (a.unit_amen || []).includes("Furnished")) {
      concerns.push({
        id: "furnished_cheap", sev: "med",
        text: "Listed as furnished, which normally costs more, at well under the going rate",
        src: "listing amenities",
      });
    }

    /* --- pressure language ---
       Not proof of anything, and deliberately low severity. It is here because
       it is the one thing on this list a reader can check in five seconds. */
    if (URGENT.test(words)) {
      concerns.push({
        id: "urgency", sev: "med",
        text: "The ad uses urgency or off-platform payment wording",
        src: "listing title",
      });
    }

    /* --- does the advert agree with itself about where it is ---
       locate.py reads the listing text against the pin. A post naming a
       neighbourhood it is not in, or an address a mile from where the site
       placed it, is the oldest trick in the category: borrow a nicer
       neighbourhood's name to sell a flat somewhere else. Neither proves bad
       faith on its own -- posters are sloppy, and "Mission-adjacent" is a real
       thing people write -- so this reports the disagreement rather than
       resolving it. */
    if (a.addr_conflict)
      concerns.push({ id: "addr_conflict", sev: "high",
        text: `The title names an address about ${(a.addr_conflict / 1609).toFixed(1)} miles from where the site placed this listing`,
        src: "listing title vs source location" });
    if (a.hood_conflict)
      concerns.push({ id: "hood_conflict", sev: "med",
        text: `The title says ${a.hood_conflict}, but the listing is pinned in ${a.hood || "somewhere else"}`,
        src: "listing title vs source location" });
    if ((a.loc || {}).level === "neighbourhood")
      concerns.push({ id: "soft_pin", sev: "info",
        text: "Only a neighbourhood, not an address - every distance here is approximate",
        src: "Craigslist location policy" });

    /* --- deposits and how you are asked to pay ---
       California caps a security deposit at one month's rent for most landlords
       (AB 12, in force since July 2024; small owners of four units or fewer may
       ask two), and a pet deposit counts inside that cap rather than on top of
       it. The FTC's line on payment is blunter: being asked to wire money, or
       send it by gift card or a peer-to-peer app, before seeing the place is
       the single most reliable sign of a rental scam. */
    const dep = (a.pet || {}).onetime || 0;
    if (dep && rent && dep > rent)
      concerns.push({ id: "deposit_cap", sev: "high",
        text: `A ${money(dep)} pet deposit on ${money(rent)} rent - California counts pet deposits inside the one-month deposit cap`,
        src: "CA Civil Code §1950.5 as amended by AB 12" });
    if (PAY_RISK.test(words))
      concerns.push({ id: "payment", sev: "high",
        text: "The ad mentions wiring money or paying by app or gift card - the FTC calls this the surest sign of a rental scam",
        src: "FTC consumer advice on rental listing scams" });

    /* --- was this written for Craigslist, or pasted into it? ---
       The single most useful thing in a post nobody reads carefully. A title
       like "This beautiful condominium in a 4-unit building is located in the
       high" is the opening sentence of a property description, cut off at the
       70-character limit. Somebody who is renting out their flat writes a
       title; somebody recycling a listing pastes one. */
    const truncated = title.length >= 62 && !ENDS_CLEANLY.test(title) && PROSE_START.test(title);
    if (truncated)
      concerns.push({ id: "pasted_title", sev: "high",
        text: "The title is the opening line of a description, cut off at Craigslist's character limit - it was pasted in, not written",
        src: "listing title" });
    if (BROCHURE.test(words))
      concerns.push({ id: "brochure", sev: truncated ? "high" : "med",
        text: "The wording reads like an estate-agent brochure rather than a rental ad",
        src: "listing title" });

    if (FACTORS.isPlan(a))
      concerns.push({ id: "floor_plan", sev: "med",
        text: "This is a floor plan the site generated, not a specific unit - the building may have something free, but not this one",
        src: "auto-generated unit reference" });

    /* --- is there an apartment behind the advert at all --- */
    if (!(a.photos || []).length)
      concerns.push({ id: "no_photos", sev: "high",
        text: "No photographs at all", src: (a.src && a.src[0] || {}).n || "listing" });
    else if (a.photos.length === 1)
      concerns.push({ id: "one_photo", sev: "info",
        text: "Only one photograph", src: (a.src && a.src[0] || {}).n || "listing" });
    if (a.photo_reuse)
      concerns.push({ id: "photo_reuse", sev: "high",
        text: "Some of these photographs also appear on a different address",
        src: "photo comparison across this data set" });
    /* Only a concern when the post gave an address that failed to match. A
       Craigslist listing that never published an address has nothing to fail,
       and firing here anyway made this a constant across 999 of 1,055 posts --
       a signal that is always on is not a signal, it just drags every listing
       from one source toward "suspect" regardless of merit. The location
       weakness is already reported, honestly and separately, as soft_pin. */
    if (!a.parcel_ok && (a.loc || {}).level !== "neighbourhood")
      concerns.push({ id: "no_parcel", sev: "med",
        text: "The address did not match any building on the city parcel map",
        src: "SF parcel map" });

    /* --- geometry that cannot be true --- */
    if (a.sqft && a.beds >= 1 && a.sqft / a.beds < 160)
      concerns.push({ id: "tight", sev: "med",
        text: `${num(a.sqft)} sq ft split across ${a.beds} bedroom${a.beds === 1 ? "" : "s"}`,
        src: "listing" });

    /* --- nothing else in the world confirms this exists --- */
    const cl_only = (a.src || []).length === 1 && (a.src[0] || {}).n === "Craigslist";
    if (cl_only && discount != null && discount >= 0.3)
      concerns.push({ id: "uncorroborated", sev: "med",
        text: "Only on Craigslist, where the ad is whatever the poster typed, and priced well under the area",
        src: "sources" });

    /* ---------- legitimate reasons a price can be low ----------
       This half matters as much as the other. Without it the auditor would
       flag every rent-controlled walk-up in the city, which is most of the
       genuinely good deals in San Francisco. */
    if (a.rc === "yes")
      explains.push(`Rent control applies here (${esc(a.rc_why || "meets the SF Rent Ordinance test")}), which holds rents below market between tenancies`);
    if (a.yr && a.yr < 1950 && (a.units || 0) < 25)
      explains.push(`A small ${a.yr} building - older walk-ups list below newer stock with the same bedroom count`);
    if (a.street_pct && FACTORS.streetPct(a, "violent") >= 75)
      explains.push("The block reports more incidents than most, which is reflected in what it can ask");
    if ((a.scores || {}).sound >= 75)
      explains.push("It is a noisy address, which discounts rent honestly");

    /* ---------- independent confirmation ---------- */
    if ((a.src || []).length > 1)
      corroborates.push(`Listed on ${a.src.length} independent sites that agree on the address`);
    if (a.parcel_ok) corroborates.push("Address matches a real building on the city parcel map");
    if (a.landlord && a.landlord.conf === "registered")
      corroborates.push("A landlord entity is registered with the city at this address");
    if ((a.rating_n || 0) >= 5)
      corroborates.push(`${num(a.rating_n)} residents have reviewed this building`);
    if (a.avail === "live") corroborates.push("Still present in the most recent availability sweep");
    if ((a.photos || []).length >= 4) corroborates.push(`${a.photos.length} photographs published`);
    // The public build ships `has_phone` rather than the number itself. What
    // corroborates a listing is that somebody can be reached at all, so the
    // claim is unchanged when the digits are withheld.
    if (a.phone) corroborates.push(`A phone number is published: ${a.phone}`);
    else if (a.has_phone) corroborates.push("A phone number is published on the listing");
    if ((a.tours || 0) > 0) corroborates.push(`${a.tours} video tour${a.tours === 1 ? "" : "s"} on the listing`);

    /* ---------- the verdict ----------
       Weighed, not counted. The question is never "is it cheap" but "is it
       cheap for a reason anyone can point at". */
    const high = concerns.filter((c) => c.sev === "high").length;
    const med = concerns.filter((c) => c.sev === "med").length;
    const weight = high * 2 + med;
    const cheap = discount != null && discount >= 0.22;

    let verdict, line;
    if (high >= 2 || weight >= 4) {
      verdict = "suspect";
      line = "Several things about this listing don't line up with each other.";
    } else if (cheap && weight >= 2) {
      verdict = "check";
      line = "Cheap for the area, and a few things are worth confirming before you commit.";
    } else if (cheap && !high && corroborates.length >= 3) {
      verdict = "bargain";
      line = explains.length
        ? "Under the going rate, and there is a reason for it that checks out."
        : "Under the going rate with nothing out of place - genuinely rare, so move quickly but still view it.";
    } else if (cheap) {
      verdict = "check";
      line = "Under the going rate. Worth a look, and worth verifying in person.";
    } else if (weight >= 2) {
      verdict = "check";
      line = "A few details on this listing are worth confirming.";
    } else {
      verdict = "ordinary";
      line = "Nothing about this listing looks out of place.";
    }

    return { verdict, line, discount, expected: exp, concerns, explains, corroborates,
             weight, high };
  }

  return { init, audit, expected };
})();
