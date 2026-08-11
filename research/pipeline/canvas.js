/* canvas.js — the decision screen.
   ============================================================
   One apartment at a time, and only the part of it this renter asked about.

   The old build put 2,547 listings in a scrolling column beside a map with six
   toggles. It showed everything it knew, which is the same as deciding
   nothing. This screen inverts that: the score exists to REMOVE information,
   and what survives is four reasons, one tradeoff, and a picture that answers
   whichever question is currently being asked.

   Layout, left to right:

     · the decision canvas — photo, address, price, fit, why, what to watch
     · the filmstrip        — the alternatives, small, so the field stays finite
     · the answer canvas    — tabs built from THIS renter's priorities

   The answer canvas is the part that is not a map. It is a map when the
   question is "where would my life happen", a night-time surface when the
   question is "is it quiet", a heat layer when the question is the street, and
   not a map at all when the question is cost or the neighbours. Localize's
   idea, and the reason the panel earns half the screen.
   ============================================================ */

(() => {
  "use strict";

  /* ---------- state ---------- */
  const S = {
    P: null,          // derived profile
    M: null,          // scoring model
    list: [],         // ranked, one unit per building
    i: 0,             // index into list
    tab: "life",
    phase: 0,         // 0..1 entry animation for the current view
    phaseT: 0,
    street: null,     // expanded street sub-layer, or null for the grouped view
    walk: null,       // which walking loop is showing
    district: null,   // part of town, the coarse filter people actually think in
    hood: null,       // a specific area inside it, or null for the whole district
    saved: new Set(),
    passed: new Set(),
    onlySaved: false, // showing the shortlist, or only the ones you kept
    onlyPlans: false, // showing the buildings that publish layouts, not units
    sort: "fit",      // "fit" = matches what you asked for; "value" = underpriced
    hoodOpen: false,  // the area picker is folded away until asked for
  };

  const $ = (id) => document.getElementById(id);
  const cur = () => S.list[S.i] || null;

  /* ---------- saved places ----------
     Kept in localStorage rather than memory. A saved list that a refresh
     empties is worse than no saved list: it invites you to rely on it and then
     quietly loses the one flat you wanted to come back to. Shortlisting a
     place to view is a decision made over days, not in one sitting. */
  const SAVED_KEY = "casita.saved.v1";
  function loadSaved() {
    try { return new Set(JSON.parse(localStorage.getItem(SAVED_KEY)) || []); }
    catch { return new Set(); }
  }
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify([...S.saved])); } catch {}
  }

  /* ---------- theme ----------
     Three states. "System" is the default and is a real setting, not the
     absence of one: it keeps following the OS if the reader changes it at
     dusk, which a two-way toggle cannot do. The choice is remembered, and the
     map's basemap wash reads the resolved theme so the tiles darken with
     everything else. */
  const THEME_KEY = "casita.theme.v1";
  function setTheme(mode) {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
    for (const b of document.querySelectorAll("[data-theme-set]"))
      b.classList.toggle("on", b.dataset.themeSet === mode);
    MK.request();
  }
  function initTheme() {
    let mode = "system";
    try { mode = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    setTheme(mode);
    // Repaint the canvas when the OS flips while we are following it.
    if (window.matchMedia) {
      matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => MK.request());
    }
  }
  const isDark = () => getComputedStyle(document.documentElement)
    .getPropertyValue("color-scheme").trim() === "dark";

  /* ---------- memory ----------
     Kept, because "new to you" is genuinely useful, but kept small. These are
     six-point labels on a thumbnail, not a feature with a dashboard.

     The wording is deliberate. We know when a listing first appeared in OUR
     data; we do not know when it first appeared anywhere, and saying "new
     listing" would be a claim about the market we cannot support. */
  const MEM_KEY = "casita.seen.v1";
  const MEM = (() => { try { return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; } catch { return {}; } })();
  const firstRun = !Object.keys(MEM).length;
  function rememberAll(list) {
    for (const a of list) {
      const m = MEM[a.id];
      const rent = a.act ? a.act[0] : a.rent;
      if (!m) MEM[a.id] = { rent, seen: 0 };
      else { m.drop = rent < m.rent - 25 ? m.rent - rent : 0; m.rent = Math.min(m.rent, rent); }
    }
    try { localStorage.setItem(MEM_KEY, JSON.stringify(MEM)); } catch {}
  }
  /* Label priority runs from hardest evidence to softest. A price drop is a
     number we watched change. A posting date comes from the source itself.
     "New to you" is only our own memory, so it yields to both — and it is the
     one that would otherwise mislead, since a listing can be new to you and
     three weeks old. */
  function tag(a) {
    const m = MEM[a.id];
    if (m && m.drop) return { t: `${money(m.drop)} drop`, c: "drop" };
    if (a.posted) {
      const h = (Date.now() / 1000 - a.posted) / 3600;
      if (h < 24) return { t: "Posted today", c: "new" };
      if (h < 72) return { t: `${Math.round(h / 24)}d old`, c: "new" };
    }
    if (!firstRun && !m) return { t: "New to you", c: "new" };
    if (S.saved.has(a.id)) return { t: "Saved", c: "save" };
    return null;
  }

  /* ---------- ranking ----------
     One unit per building. Six identical studios at the same address are one
     decision, and letting them take six filmstrip slots is how a focused
     screen turns back into a feed. */

  /* A room in someone's flat is a different product from an apartment, and it
     wins any contest that rewards low rent — which is how a string-lit bedroom
     with no stated bedroom count came back as the single best match in this
     city. Chasing adjectives in listing text is a losing game, so the test
     runs the other way: a headline recommendation has to show positive
     evidence it is a whole home. */
  const ROOMISH = /\b(room|occupancy|roommate|shared|sublet|sro|cuarto|habitaci[oó]n)\b/i;
  function isWholeHome(a) {
    if (a.shared) return false;
    const t = a.name || "";
    if (ROOMISH.test(t) && !/living room|dining room/i.test(t)) return false;
    return a.beds != null;          // silence about bedrooms is not a bedroom
  }

  const SHOW = 60;
  const blank = () => ({ missed: 0, rooms: 0, gone: 0, plans: 0, eligible: 0,
                         underpriced: 0, by: {}, overBudget: [] });
  let counts = blank();

  function rank(all) {
    const best = new Map();
    counts = blank();
    for (const a of all) {
      if (S.passed.has(a.id)) continue;
      const f = S.M.score(a);
      if (f.score == null) continue;
      // Three different reasons to step aside, counted separately because they
      // mean different things to a reader: you ruled it out, we can't tell you
      // what it is, or it is not on the market any more.
      if (f.blocked) {
        counts.missed++;
        /* Which wall, not just how many. "1,769 ruled out" is a number a
           reader can do nothing with; "1,540 of them are over your ceiling,
           and $250 more would return 300 of those" is a decision. The rents
           are kept so the interface can answer the second part honestly rather
           than inventing a round number to suggest. */
        for (const r of f.fails) counts.by[r.key] = (counts.by[r.key] || 0) + 1;
        if (f.fails.some((r) => r.key === "budget")) {
          const rent = a.act ? a.act[0] : a.rent;
          if (rent) counts.overBudget.push(rent);
        }
        continue;
      }
      if (!isWholeHome(a)) { counts.rooms++; continue; }
      // Recommending something the last sweep could not find wastes the one
      // resource this product is meant to save.
      if (a.avail === "gone" || a.avail === "no_units") { counts.gone++; continue; }
      /* A floor plan is a real lead and not a real flat. Apartments.com
         generates one per layout when a building will not publish its
         vacancies, so "SI FL1-ID1921" is worth a phone call and cannot be
         viewed, and ranking it beside places you could see on Saturday makes
         the list quietly untrue. They get their own shelf instead of a
         deletion, because the building may well have something. */
      if (FACTORS.isPlan(a) !== S.onlyPlans) {
        if (!S.onlyPlans) counts.plans++;
        continue;
      }
      // The saved view is a view of things you already chose, so it ignores
      // the area filter -- hiding a flat you saved because you have since
      // clicked a different district would look like losing it.
      if (S.onlySaved) {
        if (!S.saved.has(a.id)) continue;
        const k0 = (a.addr || a.id).toLowerCase();
        const p0 = best.get(k0);
        if (!p0 || f.score > p0.f.score) best.set(k0, { a, f });
        continue;
      }
      const area = HOODS.areaOf(a);
      if (S.district && HOODS.districtOf(area) !== S.district) continue;
      if (S.hood && area !== S.hood) continue;
      const k = (a.addr || a.id).toLowerCase();
      const prev = best.get(k);
      if (!prev || f.score > prev.f.score) best.set(k, { a, f });
    }
    const out = [...best.values()];
    counts.underpriced = out.filter((x) => dealValue(x.a)).length;
    if (S.sort === "value") {
      // Fit still breaks ties, so two equally underpriced flats are ordered by
      // which one you would actually want.
      out.sort((x, y) => ((dealValue(y.a) || {}).pct || 0) - ((dealValue(x.a) || {}).pct || 0)
                         || y.f.score - x.f.score);
    } else {
      out.sort((x, y) => y.f.score - x.f.score);
    }
    counts.eligible = out.length;
    return out.slice(0, SHOW);
  }

  /* ---------- filtering by area ----------
     A neighbourhood filter is the one control renters ask for that the rest of
     this interface deliberately does without — everything else is inferred
     from the quiz. It earns its place because "I already know I want the
     Richmond" is real information the quiz has no way to collect, and because
     it carries the description with it: picking an area tells you what that
     area is known for, which is the part a newcomer actually needs. */
  function drawHood() {
    const el = $("hoodbar");
    if (!el) return;
    const ds = HOODS.districts(A);
    const areas = S.district ? HOODS.areasIn(A, S.district) : [];
    const base = (S.hood && Object.keys(HOODS.SPLITS)
      .find((b) => HOODS.SPLITS[b].above === S.hood || HOODS.SPLITS[b].below === S.hood)) || S.hood;
    const note = S.hood ? HOODS.noteFor(S.hood, base) : null;

    /* Folded away until asked for.

       Eight district chips and a sub-area row is a lot of permanent furniture
       above the thing you came to look at, and most people never change it -
       the quiz already decided where to look. So the control states the
       current selection and gets out of the way, and opens to the same chips
       as before. A dropdown of forty neighbourhoods was the version before
       this one and asked the reader to hold the whole city in their head; the
       chips still do that job, they just wait to be asked. */
    const label = S.hood || S.district || "All of San Francisco";
    const open = S.hoodOpen ? " open" : "";

    el.innerHTML = `
      <div class="hoodbar-top">
        <button class="hoodpick${open}" data-hoodtoggle="1"
          aria-expanded="${S.hoodOpen ? "true" : "false"}">
          ${ICON.svg("pin", 13)}<b>${esc(label)}</b>
          <em>${num(counts.eligible)}</em>
          <span class="chev">›</span>
        </button>
        ${S.saved.size ? `<button class="hoodchip saved ${S.onlySaved ? "on" : ""}"
          data-saved="1">${ICON.svg("heart", 13)}Saved <em>${S.saved.size}</em></button>` : ""}
      </div>
      ${S.hoodOpen ? `<div class="hoodpanel">
        <div class="hoodrow">
          <button class="hoodchip ${!S.district && !S.onlySaved && !S.onlyPlans ? "on" : ""}" data-district="">All of SF</button>
          ${ds.map((d) => `<button class="hoodchip ${d.name === S.district ? "on" : ""}"
            data-district="${esc(d.name)}">${ICON.svg(d.icon, 14)}${esc(d.name)}
            <em>${d.n}</em></button>`).join("")}
        </div>
        ${S.district && areas.length > 1 ? `<div class="hoodrow sub">
          <button class="hoodchip small ${!S.hood ? "on" : ""}" data-hood="">Whole district</button>
          ${areas.map(([nm, c]) => `<button class="hoodchip small ${nm === S.hood ? "on" : ""}"
            data-hood="${esc(nm)}">${esc(nm)} <em>${c}</em></button>`).join("")}
        </div>` : ""}
      </div>` : ""}
      ${note ? `<p class="hoodnote">${esc(note)}${
        HOODS.splitNote(base) ? " " + esc(HOODS.splitNote(base)) : ""}</p>` : ""}
      ${leadIn()}`;
  }

  /* Names the left-hand column.
     Without it the page opens on a photograph and a number with no statement
     of what either is — the reader has to infer that this is a ranked shortlist
     rather than a search result, and inferring the premise is not their job. */
  function leadIn() {
    const n = (S.list || []).length;
    if (!n) return "";
    const where = S.hood || S.district || "San Francisco";
    if (S.onlyPlans) {
      return `<div class="leadin">
        <h2>Buildings worth a call</h2>
        <p>${n} building${n === 1 ? "" : "s"} that publish a layout and a price but never
           name a vacant flat. There may well be something free - you cannot book a viewing
           from the page, so ring them rather than turning up.</p>
      </div>`;
    }
    if (S.onlySaved) {
      return `<div class="leadin">
        <h2>Saved</h2>
        <p>${n} place${n === 1 ? "" : "s"} you kept, from anywhere in the city - the area
           filter is ignored here so a place cannot disappear because you changed districts.</p>
      </div>`;
    }
    // Counted across the whole eligible field, not the list on screen. Sorting
    // by value already selects for it, so "60 of 60 are underpriced" would be
    // true and useless - the number worth knowing is how rare that is.
    const nv = counts.underpriced;
    return `<div class="leadin">
      <div class="leadin-head">
        <h2>Your shortlist</h2>
        <div class="sortpick">
          <button class="${S.sort === "fit" ? "on" : ""}" data-sort="fit">Best match</button>
          <button class="${S.sort === "value" ? "on" : ""}" data-sort="value">Best value</button>
        </div>
      </div>
      <p>${S.sort === "value"
        ? `Ordered by how far under comparable units each one is, discounted by
           anything the checks could not explain. ${num(nv)} of ${num(counts.eligible)}
           places that clear your must-haves are priced under their block.`
        : `${n} place${n === 1 ? "" : "s"} in ${esc(where)} that clear your must-haves,
           ordered by how well each fits what you said matters.`}</p>
      ${gateHTML()}
    </div>`;
  }

  /* ---------- what your requirements cost you ----------
     A hard requirement is the only thing in this product that removes a place
     from view entirely, so it is the one number the reader most deserves to
     see argued rather than asserted. This shows which wall did the removing,
     and - when it is the budget - what a specific increase would buy back,
     computed from the actual rents that were excluded rather than from a
     round number chosen to look helpful.

     It only appears when the walls are doing real work. Ruling out a handful
     of places is the requirement behaving normally and does not need a panel. */
  const GATE_LABEL = {
    budget: "over your maximum", beds: "wrong bedroom count",
    commute: "past your commute limit", pets: "no pets", ac: "no A/C",
    wd: "no in-unit laundry", dishwasher: "no dishwasher",
    outdoor: "no outdoor space", storage: "no storage",
    furnished: "not furnished", rc: "not rent-controlled",
  };

  function gateHTML() {
    const total = counts.missed;
    // Below a third of the field this is just a filter working.
    if (!total || total < (counts.eligible + total) * 0.34) return "";

    const rows = Object.entries(counts.by).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!rows.length) return "";

    let unlock = "";
    const over = counts.overBudget;
    if (over.length >= 20 && S.P.maxBudget) {
      // The smallest step that returns a number worth acting on. Judged in
      // places, not as a share of the excluded pool: when the budget is far
      // under the market that pool is enormous, and asking for a percentage of
      // it forces the suggestion up to a jump nobody would make.
      for (const step of [100, 200, 300, 500, 750, 1000, 1500]) {
        const gained = over.filter((r) => r <= S.P.maxBudget + step).length;
        if (gained >= 25) {
          unlock = `<button class="gate-cta" onclick="CASITA.editPriorities()">
            ${money(S.P.maxBudget + step)} would return ${num(gained)}</button>`;
          break;
        }
      }
    }

    // When one wall accounts for effectively all of it, name it in the
    // sentence instead of repeating the same number underneath as a chip.
    const soleKey = rows.length === 1 || rows[0][1] >= total * 0.95 ? rows[0][0] : null;
    const head = soleKey === "budget" && S.P.maxBudget
      ? `${num(total)} places are over your ${money(S.P.maxBudget)} maximum`
      : soleKey
        ? `${num(total)} places are out - ${esc(GATE_LABEL[soleKey] || soleKey)}`
        : `${num(total)} places are hidden by your must-haves`;

    return `<div class="gate">
      <div class="gate-head">
        <b>${head}</b>
        ${unlock}
      </div>
      ${soleKey ? "" : `<ul class="gate-rows">${rows.map(([k, v]) =>
        `<li><em>${num(v)}</em> ${esc(GATE_LABEL[k] || k)}</li>`).join("")}</ul>`}
    </div>`;
  }

  function applyHood() {
    S.list = rank(A);
    S.i = 0;
    drawHood(); drawDecision(); drawFilm(); drawTabs(); drawPanel(); reframe(false); restart();
  }

  /* ============================================================
     THE DECISION CANVAS
     ============================================================ */
  /* ---------- value, which is not the same thing as fit ----------
     The fit score answers "is this the kind of place I asked for", and the
     places that answer it best are mostly expensive: a quiet block with a
     responsive manager near everything costs money. Ranked by fit, the median
     rent of the top twenty is $3,095 and the bottom hundred is $1,600 - the
     cheap end of the market sits at the bottom, and only one in twenty of the
     top scorers is even flagged as underpriced.

     That is the ranking behaving correctly and answering a different question
     than "is this a steal". So value gets its own number rather than being
     smuggled into the first one.

     A discount only counts as value when it is explicable. Twenty-five percent
     under comparable units with three independent confirmations is a find;
     forty percent under with two unresolved concerns is the shape of a listing
     that is cheap for a reason nobody has told you. So the discount is scaled
     by what the auditor found, and a listing whose size we do not know scores
     nothing at all - a price with no size attached is not a price.

     Named dealValue, not valueOf: `valueOf` is a method on every object in the
     language, and a bare call to it resolves to the built-in anywhere the
     local binding is not in scope. */
  function dealValue(a) {
    const d = DEAL.audit(a);
    if (d.discount == null || d.discount <= 0.05) return null;
    if (a.beds == null && !a.sqft && !a.sqft_said) return null;
    if (d.verdict === "suspect") return null;      // cheap for a reason
    const trust = cl(1 - (d.high * 0.35 + (d.weight - d.high * 2) * 0.12), 0, 1);
    const corrob = cl(0.55 + d.corroborates.length * 0.12, 0, 1);
    const pct = Math.round(d.discount * 100 * trust * corrob);
    if (pct < 8) return null;
    return { pct, under: Math.round(d.discount * 100), basis: d.expected && d.expected.basis,
             verdict: d.verdict };
  }

  /* What the advert says about the shape of the place.

     Amenity pills answer "is there a dishwasher". They cannot answer the
     questions that actually decide between two flats at the same price: is it
     two floors, is there a view, is it on the ground floor facing the street,
     does the manager live on the landing. None of that is a field on any
     source - it is written in prose or nowhere, and add_qualities.py reads it
     out with the sentence it came from attached.

     Each one carries its quote, because an extractor working on marketing copy
     will sometimes be wrong and the reader should be able to see that for
     themselves rather than take the label on trust. That matters more now than
     it used to: these fed nothing but this panel for a long time, so a lovely
     flat and a dull one at the same price scored the same. They feed the
     "Standout features" factor as well, which means a wrong label costs
     something, which is exactly why the sentence stays attached to it. */
  function qualitiesHTML(a) {
    const qs = a.qualities || [];
    if (!qs.length) {
      // Silence here means we could not read the advert, not that the flat is
      // plain. Saying which is the difference between a gap and a verdict.
      return a.text_read === false
        ? `<p class="lab">What it's like inside</p>
           <p class="fine">${esc((a.src && a.src[0] || {}).n || "This source")} publishes no
             description for this listing, so there is nothing to read here. Open the
             listing to see what the advert actually says.</p>`
        : "";
    }
    return `<p class="lab">What it's like inside</p>
      <div class="quals">${qs.map((q) => `
        <details class="qual q-${q.pol > 0 ? "up" : q.pol < 0 ? "down" : "flat"}">
          <summary>${esc(q.label)}${q.hedge ? `<i class="qhedge">some units</i>` : ""}</summary>
          <p>"${esc(q.quote)}"</p>
          ${q.hedge ? `<p class="fine">The advert promises this to some flats in the building
            without saying it is one of them - worth asking about this one specifically.</p>` : ""}
        </details>`).join("")}</div>
      ${a.sqft_said && !a.sqft ? `<p class="fine">The advert says ${num(a.sqft_said)} sq ft;
        the listing has no square-footage field, so this is the text's word for it.</p>` : ""}`;
  }

  /* Which panel can actually show this problem.

     A warning that says "street conditions here are in the bottom third" is
     asking to be taken on trust. The Street panel already draws what the four
     city datasets recorded on that block — the evidence exists, it was just
     three clicks away behind a tab the reader had no reason to suspect was
     related. Only keys with a real visualisation appear here; the rest stay
     plain text rather than growing a button that opens something irrelevant. */
  const VIZ_FOR = {
    street:    { tab: "street", verb: "See the block" },
    quiet:     { tab: "quiet",  verb: "See the noise" },
    nightlife: { tab: "quiet",  verb: "See what's nearby" },
    walk:      { tab: "walks",  verb: "See the walks" },
    commute:   { tab: "life",   verb: "See the route" },
    transit:   { tab: "life",   verb: "See the route" },
    grocery:   { tab: "life",   verb: "See what's nearby" },
    residents: { tab: "residents", verb: "Read the reviews" },
    management:{ tab: "residents", verb: "Read the reviews" },
    verification: { tab: "verify", verb: "See the checks" },
  };
  const vizForKey = (k) => {
    const v = k && VIZ_FOR[k];
    // Only offer a tab this profile is actually shown.
    return v && tabsFor().includes(v.tab) ? v : null;
  };

  function drawDecision() {
    const it = cur();
    const el = $("decision");
    if (!it) {
      el.innerHTML = `<div class="empty">
        <h2>Nothing clears your must-haves.</h2>
        <p>Loosen one requirement and this fills back in.</p>
        <button class="btn primary" onclick="CASITA.editPriorities()">Edit my priorities</button>
      </div>`;
      return;
    }
    const { a, f } = it;
    const hi = S.M.highlights(f, 4);
    const bad = S.M.tradeoffs(f, 2);
    const act = a.act ? a.act[0] : a.rent;
    const actHi = a.act && a.act[1] !== a.act[0] ? a.act[1] : null;
    const t = tag(a);

    el.innerHTML = `
      <div class="card decision-card">
        <div class="pager">
          <button class="ghost-round" data-step="-1" aria-label="Previous">‹</button>
          <span>${S.i + 1} of ${S.list.length}</span>
          <button class="ghost-round" data-step="1" aria-label="Next">›</button>
        </div>

        ${heroHTML(a, t)}

        <div class="head">
          <div>
            <h2>${titleOf(a)}</h2>
            <p class="hood">${(a.loc || {}).level === "neighbourhood"
              ? "Address not published" : esc(a.hood || "San Francisco")}
              ${(a.src || []).map((s) => `<span class="srcbadge ${SRC_CLASS[s.n] || "other"}"
                title="${esc(s.n)}${s.c > 1 ? ` · ${s.c} ads` : ""}">${esc(s.n)}</span>`).join("")}</p>
            <p class="price">
              <b>${money(a.rent)}</b> listed
              <span class="dot">·</span>
              <span class="est">~${money(act)}${actHi ? `–${money(actHi)}` : ""}/mo estimated</span>
              ${(() => { const k = FACTORS.isPlan(a) ? "plan" : a.avail; const v = AVAIL[k];
                 return v ? `<span class="avail ${v.c}" title="${esc(v.why(a))}">${v.t}</span>` : ""; })()}
            </p>
            ${a.special && a.special !== "None"
              ? `<p class="special">${esc(a.special.slice(0, 90))}</p>` : ""}
            <p class="posted">${a.posted
              ? `Posted ${agoWords(a.posted)}`
              : `Posting date not published by ${esc((a.src && a.src[0] || {}).n || "this source")}`}</p>
          </div>
          <div class="fit">
            <b style="color:${tone(f.score)}">${f.score}</b>
            <span style="color:${tone(f.score)}">${f.label}</span>
            <button class="why-score" data-open="score" aria-label="Why this score?">i</button>
          </div>
        </div>

        ${hi.length ? `<p class="lab">Why you'd like it</p>
          <div class="reasons">${hi.map((h) =>
            `<div class="reason">${ICON.svg(h.icon, 16)}<span>${esc(h.text)}</span></div>`).join("")}</div>` : ""}

        ${(() => {
          const v = dealValue(a);
          return v ? `<div class="valuetag">
            <b>${v.under}% under ${esc(v.basis || "comparable units")}</b>
            <span>${v.verdict === "bargain"
              ? "nothing unexplained in the checks"
              : "worth confirming in person"}</span></div>` : "";
        })()}

        ${qualitiesHTML(a)}

        ${bad.length ? `<p class="lab">Good to know</p>
          <div class="warns">${bad.map((w) => {
            const t = vizForKey(w.key);
            return `<div class="warn"><span class="ic">⚠</span>
              <span>${esc(w.text)}${t ? `
                <button class="warn-viz" data-tab="${t.tab}">${t.verb}</button>` : ""}</span>
            </div>`;
          }).join("")}</div>` : ""}

        <div class="actions">
          <button class="btn" data-act="pass">✕ Pass</button>
          <button class="btn ${S.saved.has(a.id) ? "on" : ""}" data-act="save">
            ${S.saved.has(a.id) ? "♥ Saved" : "♡ Save"}</button>
          <a class="btn primary" href="${esc((a.src && a.src[0] || {}).u || "#")}"
             target="_blank" rel="noopener">View listing →</a>
        </div>
      </div>

      <details class="everything">
        <summary>Everything else about this place</summary>
        <div class="ev-body">${everythingHTML(a, f)}</div>
      </details>`;
  }

  // Thresholds match the label bands in factors.js, which are ranks now.
  const tone = (s) => s == null ? "var(--ink-3)"
    : s >= 75 ? "var(--good)" : s >= 50 ? "var(--warm)" : "var(--accent)";

  /* ---------- the photographs ----------
     Sources publish up to five. Showing one and hiding the rest was the single
     most obviously missing thing on this card: a renter's first question about
     a flat is what it looks like, and one exterior shot does not answer it.

     Photo index is held per listing rather than globally, so paging through
     the filmstrip and coming back does not reset you to the first frame. */
  const photoIdx = new Map();
  const photosOf = (a) => (a.photos && a.photos.length ? a.photos
                          : a.photo ? [a.photo] : []);

  function heroHTML(a, t) {
    const ph = photosOf(a);
    const i = Math.min(photoIdx.get(a.id) || 0, Math.max(0, ph.length - 1));
    const dog = a.pet && a.pet.dogs;
    return `<div class="hero" id="hero">
      ${ph.length
        ? `<img src="${esc(ph[i])}" alt="Photo ${i + 1} of ${ph.length}"
             fetchpriority="high" decoding="async" onerror="CASITA.retryImg(this)">`
        : `<div class="hero-none">No photo published</div>`}
      ${t ? `<span class="hero-tag ${t.c}">${t.t}</span>` : ""}
      ${dog ? `<span class="hero-dog">${ICON.svg("dog", 13)}Dogs OK</span>` : ""}
      ${ph.length > 1 ? `
        <button class="hero-nav prev" data-photo="-1" aria-label="Previous photo">‹</button>
        <button class="hero-nav next" data-photo="1" aria-label="Next photo">›</button>
        <span class="hero-count">${i + 1} / ${ph.length}</span>
        <span class="hero-dots">${ph.map((_, k) =>
          `<i class="${k === i ? "on" : ""}"></i>`).join("")}</span>` : ""}
    </div>`;
  }

  function stepPhoto(d) {
    const a = cur() && cur().a;
    if (!a) return;
    const n = photosOf(a).length;
    if (n < 2) return;
    photoIdx.set(a.id, ((photoIdx.get(a.id) || 0) + d + n) % n);
    const hero = $("hero");
    if (hero) hero.outerHTML = heroHTML(a, tag(a));
  }

  /* ---------- what to call a listing we cannot place ----------
     Craigslist publishes a neighbourhood, so merge.py matched the pin to the
     nearest building on the parcel map and that address became the headline.
     For 677 Castro St #1 the headline read "695 Castro St" — a real building,
     a hundred metres away, that has nothing to do with the advert. Rendering
     an inferred address in the same type as a published one is the most
     confident lie this interface was telling.

     So an unplaced listing is titled by what we actually know: its size and
     its neighbourhood. The parcel guess is not shown at all. */
  function titleOf(a) {
    if ((a.loc || {}).level !== "neighbourhood")
      // A generated plan reference is not an apartment number; show the
      // building and let the panel explain what the listing actually is.
      return esc(a.addr) + (a.unit && !FACTORS.isPlan(a) ? ` #${esc(a.unit)}` : "");
    const beds = a.beds === 0 ? "Studio" : a.beds ? `${a.beds}-bed` : "Home";
    return `${beds} in ${esc(a.hood || "San Francisco")}`;
  }
  // The filmstrip has room for far less, but the same rule applies.
  function shortLabel(a) {
    if ((a.loc || {}).level !== "neighbourhood") return shortAddr(a);
    return a.hood || "San Francisco";
  }

  /* Which site this came from, said on the card and on every thumbnail.
     It is not decoration: the three sources have genuinely different
     reliability. Apartments.com and Zillow are listed by management companies
     against a real unit inventory; a Craigslist post is whatever somebody
     typed into a box. A renter reading a score deserves to know which kind of
     claim it was computed from without opening anything. */
  /* How confidently we can place this flat on a map. Craigslist publishes a
     neighbourhood, so locate.py tries to recover the address out of the listing
     text; these are the four outcomes it can reach. */
  const LOC_WORD = {
    exact: "Exact address", title_address: "Recovered from the title",
    building_name: "Recovered by building", neighbourhood: "Neighbourhood only",
  };
  const LOC_PILL = {
    exact: "good", title_address: "good", building_name: "mid", neighbourhood: "bad",
  };

  const SRC_CLASS = { Craigslist: "cl", Zillow: "zl", "Apartments.com": "ac" };
  const SRC_SHORT = { Craigslist: "CL", Zillow: "Zillow", "Apartments.com": "Apts" };

  /* Said on the card, not buried, because turning up to a flat that went two
     weeks ago is the most expensive mistake this product can let someone make.
     "Unchecked" is its own state: Zillow publishes no free way to ask, and
     rendering that as "available" would be inventing a fact. */
  const AVAIL = {
    live:     { t: "Verified live", c: "live",
                why: (a) => `Present in the latest ${a.avail_src || "sweep"}` },
    plan:     { t: "Floor plan, not a unit", c: "unknown",
                why: () => "The site generated this from a floor plan; the building may have "
                         + "something free, but this particular unit is not a real vacancy" },
    unknown:  { t: "Availability unchecked", c: "unknown",
                why: () => "This source publishes no free way to confirm a listing is still up" },
    gone:     { t: "May be gone", c: "gone",
                why: (a) => `Absent from the latest ${a.avail_src || "sweep"}` },
    no_units: { t: "No units listed", c: "gone",
                why: (a) => `The building's unit list was empty in the latest ${a.avail_src || "sweep"}` },
  };

  /* Progressive disclosure, and the only place on the screen where volume is
     the point. Everything the sources gave us that did not earn a line above
     lives here, each claim next to the record it came from. */
  function everythingHTML(a, f) {
    const rows = [];
    const row = (k, v) => v ? rows.push(`<div class="ev-row"><span>${k}</span><b>${v}</b></div>`) : null;

    row("Bedrooms", a.beds == null ? "not stated" : bedTxt(a.beds));
    row("Bathrooms", a.baths);
    row("Size", a.sqft ? `${num(a.sqft)} sq ft` : "not published");
    row("Built", a.yr);
    row("Units in building", a.units ? num(a.units) : null);
    row("Rent control", a.rc === "yes" ? "Likely - " + esc(a.rc_why || "")
        : a.rc === "no" ? "City records say no" : "Unclear");
    row("In-unit laundry", a.wd === true ? "Yes" : a.wd === false ? "Not mentioned" : "Unknown");
    row("Amenities listed", (a.unit_amen || []).join(", ") || "none published");
    row("Pets", a.pet ? (a.pet.ok ? `Allowed${a.pet.monthly ? ` - ${money(a.pet.monthly)}/mo` : ""}` : "Not stated") : "No policy published");
    row("Building violations", `${num(a.novs)} on file · ${num(a.active)} open · ${num(a.over_year)} open over a year`);
    row("Availability", a.avail === "live" ? `Verified live (${esc(a.avail_src || "")})`
        : a.avail === "unknown" ? "Not checkable - this source has no free liveness check"
        : "May be gone");

    const st = a.street || {}, sp = a.street_pct || {};
    const street = ["encampment", "break_in", "violent", "cleaning"].map((k) =>
      `<div class="ev-row"><span>${STREET_LABEL[k]}</span>
        <b>${num(st[k])} reports · busier than ${Math.round(FACTORS.streetPct(a, k))}% of listings</b></div>`).join("");

    const tr = a.trust || {};
    return `
      <div class="ev-grid">
        <section><h4>The unit</h4>${rows.join("")}</section>
        <section><h4>Street records, 250m radius, last 12 months</h4>${street}
          <p class="ev-src">Source: SF 311 service requests and SFPD incident reports.
            Percentiles compare this address with the other listings in your search, and are
            pulled toward the middle where a block has few reports on file.</p></section>
        <section><h4>What we could and couldn't verify</h4>
          ${(tr.ok || []).map((x) => `<div class="ev-ok">✓ ${esc(x)}</div>`).join("")}
          ${(tr.warn || []).map((x) => `<div class="ev-warn">! ${esc(x)}</div>`).join("")}
          <p class="ev-src">${esc(GEO.pinNote(a) || "This address matched a building on the city parcel map.")}</p>
        </section>
        <section><h4>Where this came from</h4>
          ${(a.src || []).map((s) => `<div class="ev-row"><span>${esc(s.n)}</span>
            <b><a href="${esc(s.u)}" target="_blank" rel="noopener">open →</a></b></div>`).join("")}
          <p class="ev-src">Casita first observed this listing in its own data; we can't say when
            it first appeared anywhere.</p></section>
      </div>`;
  }

  const STREET_LABEL = {
    encampment: "Homelessness-related reports", break_in: "Vehicle break-ins",
    violent: "Violent incidents", cleaning: "Service / cleaning requests",
  };

  /* ============================================================
     THE FILMSTRIP
     ============================================================ */
  function drawFilm() {
    const el = $("film");
    el.innerHTML = `<div class="film-row">
      <button class="film-arrow" data-scroll="-1">‹</button>
      <div class="film-rail" id="film-rail">${S.list.map((it, i) => {
        const t = tag(it.a);
        const src = (it.a.src && it.a.src[0] || {}).n;
        return `<button class="film-card ${i === S.i ? "on" : ""}" data-pick="${i}">
          <span class="film-score" style="color:${tone(it.f.score)}">${it.f.score}</span>
          <span class="film-photo">${it.a.photo
            ? `<img src="${esc(it.a.photo)}" alt="" loading="lazy" decoding="async"
                 fetchpriority="low" onerror="CASITA.retryImg(this)">`
            : `<em class="film-nophoto">no photo</em>`}
            ${t ? `<em class="film-tag ${t.c}">${t.t}</em>` : ""}</span>
          <span class="film-name">${esc(shortLabel(it.a))}</span>
          <span class="film-src ${SRC_CLASS[src] || "other"}">${esc(SRC_SHORT[src] || src || "-")}</span>
        </button>`;
      }).join("")}</div>
      <button class="film-arrow" data-scroll="1">›</button></div>
      <p class="film-note">${S.onlyPlans
        ? `${num(S.list.length)} building${S.list.length === 1 ? "" : "s"} publishing layouts
           rather than vacancies - call before you plan a viewing.
           <button class="linkish" data-plans="1">Back to places you can see</button> -`
        : `Top ${num(S.list.length)} of ${num(counts.eligible)} buildings that
           clear your requirements${counts.rooms
             ? ` · ${num(counts.rooms)} rooms and shares left out` : ""}${counts.gone
             ? ` · ${num(counts.gone)} no longer listed` : ""}.
           ${counts.plans ? `<button class="linkish" data-plans="1">${num(counts.plans)}
             floor plans set aside</button> -` : ""}
           ${counts.missed ? `<button class="linkish" onclick="CASITA.editPriorities()">${
             num(counts.missed)} ruled out by your budget and bedrooms</button> -` : ""}`}
        scraped ${ago(scrapedAt())}. Use ← → to move.</p>`;
    const sel = el.querySelector(".film-card.on");
    if (sel) sel.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
  const shortAddr = (a) => (a.addr || "").replace(/\b(Street|Avenue|Boulevard)\b/g, (m) => m[0] + "t");

  /* ============================================================
     THE ANSWER CANVAS — tabs
     ============================================================
     Built from the renter's priorities, not from a fixed menu. Someone who
     never mentioned nightlife or noise does not get a Quiet tab; someone who
     picked management and reviews gets Residents first. "My life" only exists
     if they told us where their life happens. */
  /* Cost lost its tab. The breakdown table was answering a question the card
     already answers in one line, and it was the least-looked-at panel here.
     Price still shows on the card and still counts toward fit — only the
     spreadsheet is gone. */
  const TAB_DEF = {
    life:      { label: "My life",  icon: "compass" },
    walks:     { label: "Walks",    icon: "dog" },
    quiet:     { label: "Quiet",    icon: "moon" },
    street:    { label: "Safety",   icon: "shield" },
    residents: { label: "Residents", icon: "people" },
    verify:    { label: "Is it real?", icon: "search" },
  };

  function tabsFor() {
    const P = S.P, out = [];
    if ((P.anchors || []).length || (P.errands || []).length) out.push("life");
    const prio = P.priorities || {};
    // Anyone with a dog gets Walks second, because they will open it every time.
    if ((P.pets || "none") === "dog") out.push("walks");
    if (prio.quiet || prio.nightlife) out.push("quiet");
    if (prio.street) out.push("street");
    if (prio.residents || prio.management) out.push("residents");
    if (prio.walk || prio.nightlife) out.push("walks");
    // Always leave a way to see the street and whether the listing is real.
    // Nobody puts "check this isn't a scam" on a wishlist, and everybody wants
    // it the moment they are about to send someone a deposit.
    for (const k of ["street", "verify"]) if (!out.includes(k)) out.push(k);
    return [...new Set(out)];
  }

  function drawTabs() {
    const tabs = tabsFor();
    if (!tabs.includes(S.tab)) S.tab = tabs[0];
    $("tabs").innerHTML = tabs.map((k) =>
      `<button class="tab ${k === S.tab ? "on" : ""}" data-tab="${k}">
        ${ICON.svg(TAB_DEF[k].icon, 15)}${TAB_DEF[k].label}</button>`).join("");
  }

  function setTab(k) {
    if (S.tab === k) return;
    S.tab = k;
    S.street = null;
    restart();
    drawTabs(); drawPanel(); reframe();
  }

  // Every view enters the same way: a short ramp the draw functions read as
  // "how far in am I". One clock, so nothing has its own timer.
  function restart() { S.phase = 0; S.phaseT = performance.now(); MK.keepAwake(1600); }

  /* ---------- framing ---------- */
  function frameFor() {
    const it = cur();
    if (!it) return { lat: 37.7825, lon: -122.4143, zoom: 14 };
    const a = it.a;
    if (S.tab === "life") {
      const lg = GEO.legs(a, S.P);
      // Endpoint labels are ~90px wide and sit above the pin, so the padding
      // has to buy room for the chip, not just the dot.
      return MK.frame([[a.lat, a.lon], ...lg.map((l) => [l.lat, l.lon])], { x: 200, y: 160 });
    }
    if (S.tab === "walks") {
      const w = GEO.walk(a, S.walk);
      return w ? MK.frame([[a.lat, a.lon], ...w.stops.map((s) => [s.lat, s.lon])], { x: 110, y: 90 })
               : { lat: a.lat, lon: a.lon, zoom: 15.2 };
    }
    // The other two views are about this block, not this city.
    return { lat: a.lat, lon: a.lon, zoom: S.tab === "quiet" ? 15.1 : 14.6 };
  }

  const isMapTab = () => ["life", "walks", "quiet", "street"].includes(S.tab);

  function reframe(animate) {
    $("viz").classList.toggle("is-map", isMapTab());
    if (!isMapTab()) return;
    if (animate === false) MK.jumpTo(frameFor());
    else MK.flyTo(frameFor(), 620, () => MK.request());
    MK.request();
  }

  /* ---------- the frame ---------- */
  function frame(now) {
    const it = cur();
    if (!it) { MK.clear(); return false; }
    const cx = MK.ctx;
    if (!cx) return false;
    /* Clamped at both ends. requestAnimationFrame hands back the timestamp of
       the frame's START, which can predate the performance.now() that restart()
       recorded a moment later — so this went slightly negative, ease() returned
       a negative number, and the street view asked the canvas for a circle of
       radius -0.53. Every frame of the entry animation threw. */
    S.phase = cl((now - S.phaseT) / 1100, 0, 1);
    MK.clear();
    if (S.tab === "life") drawLifeView(it.a, cx);
    else if (S.tab === "walks") drawWalkView(it.a, cx);
    else if (S.tab === "quiet") drawQuietView(it.a, cx);
    else if (S.tab === "street") drawStreetView(it.a, cx);
    return S.phase < 1;
  }

  const ease = (t) => 1 - Math.pow(1 - t, 2.6);

  /* ---------- real routes ----------
     ROUTER holds OpenStreetMap's footway network for the city. When it has
     loaded, every line on this map is an actual walk down actual streets and
     every time beside it is that walk's real length. Until it has, we fall back
     to the straight-line estimate the product has always used and keep saying
     it is an estimate. The distinction is surfaced, not smoothed over: a route
     is either measured or approximated, and the reader is told which.

     Cached per apartment-and-destination. Routing is fast but not free, and a
     redraw happens on every animation frame. */
  const routeCache = new Map();
  /* `mode` matters. The network here is pavements and footpaths, so it can
     answer "how far is that walk" exactly and cannot answer "how long is that
     bus" at all. Routing a transit commute across it produced an 87-minute
     walking figure on the map beside a 33-minute transit figure in the panel —
     two numbers for one trip, one of them measuring something nobody was going
     to do. So a walk gets the real route and the real length; anything else
     keeps the straight-line estimate and says which it is. */
  function pathFor(a, la, lo, mode) {
    const k = `${a.id}|${la.toFixed(5)},${lo.toFixed(5)}|${mode || "walk"}`;
    if (routeCache.has(k)) return routeCache.get(k);
    let out = null;
    // Walking and driving both run on the street network. Transit does not:
    // no timetable, so no route and no measured time.
    const routable = (mode || "walk") === "walk" || mode === "drive";
    if (routable && canRoute(a)) {
      const r = ROUTER.route(a.lat, a.lon, la, lo, mode === "drive" ? "drive" : "walk");
      if (r) out = { points: r.points, mins: r.mins, metres: r.metres, real: true };
    }
    // Not a route, and drawn so nobody could mistake it for one: two points,
    // dashed. A transit trip does not follow the pavements and we have no
    // timetable, so the honest picture is a bearing and a stated estimate.
    if (!out) out = { points: [[a.lat, a.lon], [la, lo]], real: false };
    routeCache.set(k, out);
    return out;
  }
  // A soft pin makes a metre-accurate route meaningless: it would be a precise
  // walk from the wrong doorstep.
  const canRoute = (a) => ROUTER.ready() && !GEO.soft(a);

  /* ---------- MY LIFE ----------
     Walking legs are routed on the real pavement network and drawn solid.
     Anything we cannot route -- a bus, a drive, a pin we only know to the
     neighbourhood -- is drawn as a dashed bearing, because that is genuinely
     all we know about it. */
  const LEG_COLOR = {
    briefcase: "#2F6FB0", star: "#C2456B", building: "#7C4DBE", dumbbell: "#7C4DBE",
    cart: "#2E8B57", train: "#E0A32E", coffee: "#B4682E", wine: "#9A3F6B", pin: "#6B6D74",
    tree: "#2E8B57",
  };

  function drawLifeView(a, cx) {
    MK.drawBasemap(0.28);
    const lg = GEO.legs(a, S.P);
    const home = MK.proj(a.lat, a.lon);
    const STAGGER = 0.13, SPAN = 0.55;
    // Downtown, the transit stop and the bar can both be ninety seconds away,
    // which puts their labels on top of each other and on top of the home pin.
    // Badges are therefore placed in a second pass against a list of rectangles
    // already spoken for, starting with the pin itself.
    const taken = [{ x: home[0] - 24, y: home[1] - 30, w: 48, h: 52 }];
    const pending = [];

    lg.forEach((l, i) => {
      const t = ease(cl((S.phase - i * STAGGER) / SPAN, 0, 1));
      if (t <= 0) return;
      const pts = pathFor(a, l.lat, l.lon, l.mode).points.map(([la, lo]) => MK.proj(la, lo));
      const col = LEG_COLOR[l.icon] || "#6B6D74";

      // Walk the polyline to `t` of its total length, so the line grows at a
      // constant speed instead of lurching at every corner.
      const seg = [];
      let total = 0;
      for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      let want = total * t, acc = 0;
      seg.push(pts[0]);
      for (let k = 1; k < pts.length; k++) {
        const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        if (acc + d >= want) {
          const u = d ? (want - acc) / d : 0;
          seg.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u,
                    pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u]);
          break;
        }
        acc += d; seg.push(pts[k]);
      }

      const routed = pathFor(a, l.lat, l.lon, l.mode).real;
      cx.strokeStyle = col;
      cx.lineWidth = routed ? (l.fixed ? 3.4 : 2.6) : 2;
      cx.lineCap = "round"; cx.lineJoin = "round";
      cx.globalAlpha = routed ? 0.92 : 0.6;
      cx.setLineDash(routed ? [] : [4, 6]);
      cx.beginPath(); cx.moveTo(seg[0][0], seg[0][1]);
      for (let k = 1; k < seg.length; k++) cx.lineTo(seg[k][0], seg[k][1]);
      cx.stroke();
      cx.setLineDash([]);
      cx.globalAlpha = 1;

      if (t < 0.999) return;
      const q = pts[pts.length - 1];
      cx.fillStyle = col;
      cx.beginPath(); cx.arc(q[0], q[1], 5, 0, 7); cx.fill();
      cx.strokeStyle = "#fff"; cx.lineWidth = 2; cx.stroke();
      pending.push({ q, l, col });
    });

    for (const { q, l, col } of pending) {
      const r = place(cx, q[0], q[1] - 12, l.label, taken);
      taken.push(r);
      const rt = pathFor(a, l.lat, l.lon, l.mode);
      badge(cx, r, l.icon, l.label, `${rt.real ? rt.mins : l.mins} min`, col);
    }

    homePin(cx, home);
  }

  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x &&
                         a.y < b.y + b.h && a.y + a.h > b.y;

  /* Nudge a badge until it is not sitting on anything already placed. It tries
     above first (the natural spot for a label on a pin), then below, then
     further out, and gives up rather than wandering — a label six rows away
     from its own dot is worse than a slight overlap. */
  function place(cx, x, y, label, taken) {
    cx.font = "600 12.5px -apple-system,system-ui,sans-serif";
    const w = Math.max(cx.measureText(label).width + 42, 82), h = 40;
    const base = { x: cl(x - w / 2, 6, MK.w - w - 6), y: cl(y - h, 6, MK.h - h - 6), w, h };
    const step = h + 7;
    for (let i = 0; i < 8; i++) {
      for (const dy of i === 0 ? [0] : [-i * step, i * step]) {
        const r = { x: base.x, y: cl(base.y + dy, 6, MK.h - h - 6), w, h };
        if (!taken.some((t) => hits(r, t))) return r;
      }
    }
    return base;
  }

  /* A two-line chip: what it is, then how long it takes. */
  function badge(cx, { x: bx, y: by, w, h }, icon, label, sub, col) {
    cx.fillStyle = "#fff";
    cx.strokeStyle = "rgba(20,20,25,.10)"; cx.lineWidth = 1;
    cx.beginPath(); cx.roundRect(bx, by, w, h, 11);
    cx.shadowColor = "rgba(20,20,25,.14)"; cx.shadowBlur = 12; cx.shadowOffsetY = 3;
    cx.fill(); cx.shadowColor = "transparent"; cx.shadowBlur = 0; cx.shadowOffsetY = 0;
    cx.stroke();
    // A dot in the route's own colour, not a glyph. Emoji on canvas render at
    // whatever size and baseline the platform font decides, and half of them
    // arrived as tofu; the label already says what the place is.
    cx.fillStyle = col;
    cx.beginPath(); cx.arc(bx + 16, by + h / 2, 4.5, 0, 7); cx.fill();
    cx.fillStyle = "#17171A";
    cx.font = "620 12.5px -apple-system,system-ui,sans-serif";
    cx.fillText(label, bx + 28, by + 17);
    cx.font = "600 11.5px -apple-system,system-ui,sans-serif";
    cx.fillStyle = col;
    cx.fillText(sub, bx + 28, by + 32);
  }

  /* The apartment is the one thing on this canvas that must never be lost.
     Over a dense encampment or break-in layer the orange pin was reading as
     just another hot cell, so it now sits in a punched-out halo: a soft light
     disc knocks the heat back, and the pin is drawn on top of that. Always
     last, in every view, whatever is underneath. */
  function homePin(cx, home) {
    const r = 21;
    const halo = cx.createRadialGradient(home[0], home[1] - 2, 6, home[0], home[1] - 2, 46);
    halo.addColorStop(0, "rgba(251,250,248,.95)");
    halo.addColorStop(0.6, "rgba(251,250,248,.7)");
    halo.addColorStop(1, "rgba(251,250,248,0)");
    cx.fillStyle = halo;
    cx.beginPath(); cx.arc(home[0], home[1] - 2, 46, 0, 7); cx.fill();

    cx.fillStyle = "#E4622A";
    cx.strokeStyle = "#fff"; cx.lineWidth = 3.5;
    cx.beginPath();
    cx.arc(home[0], home[1] - 6, r, Math.PI * 0.86, Math.PI * 0.14);
    cx.lineTo(home[0], home[1] + 17);
    cx.closePath();
    cx.shadowColor = "rgba(20,20,25,.22)"; cx.shadowBlur = 12; cx.shadowOffsetY = 3;
    cx.fill();
    cx.shadowColor = "transparent"; cx.shadowBlur = 0; cx.shadowOffsetY = 0;
    cx.stroke();
    cx.font = "15px -apple-system,system-ui,sans-serif";
    cx.textAlign = "center";
    cx.fillStyle = "#fff";
    cx.fillText("🏠", home[0], home[1] - 1);
    cx.textAlign = "left";
  }

  /* Markers, and deliberately no line between them.

     This drew a loop through the nearest parks, snapped to the street grid the
     way the commute lines are. It looked like a route and it was not one:
     there is no pedestrian graph behind this page, so the corners were placed
     by a formula rather than by any street you could walk down.

     A real version is buildable — OpenStreetMap's footway network for San
     Francisco is about 555,000 vertices, roughly 1.6MB trimmed, and Overpass
     will serve a 1km box around one address in about three seconds — but until
     that exists, drawing the line is the same false precision as printing a
     six-minute walk off a neighbourhood centroid. So the stops are shown,
     because they are real places at real distances, and the invented path
     between them is gone. */
  function drawWalkView(a, cx) {
    MK.drawBasemap(0.2);
    const w = GEO.walk(a, S.walk);
    const home = MK.proj(a.lat, a.lon);
    if (!w) { homePin(cx, home); return; }
    const t = ease(S.phase);
    const real = canRoute(a);

    w.stops.forEach((s2, i) => {
      const share = (i + 1) / (w.stops.length + 1);
      if (t < share) return;
      const q = MK.proj(s2.lat, s2.lon);

      if (real) {
        // An actual walk down actual pavements.
        const r = pathFor(a, s2.lat, s2.lon, "walk");
        if (r.real) {
          const pts = r.points.map(([la, lo]) => MK.proj(la, lo));
          cx.strokeStyle = "#2E8B57"; cx.lineWidth = 3;
          cx.lineCap = "round"; cx.lineJoin = "round";
          cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k][0], pts[k][1]);
          cx.stroke();
        }
      } else {
        // No network, or a pin we do not trust: a dotted spoke says "this one,
        // this far" without pretending to know the way.
        cx.strokeStyle = "rgba(46,139,87,.45)";
        cx.setLineDash([3, 5]); cx.lineWidth = 1.4;
        cx.beginPath(); cx.moveTo(home[0], home[1]); cx.lineTo(q[0], q[1]); cx.stroke();
        cx.setLineDash([]);
      }

      cx.fillStyle = "#2E8B57";
      cx.beginPath(); cx.arc(q[0], q[1], 11, 0, 7); cx.fill();
      cx.strokeStyle = "#fff"; cx.lineWidth = 2.5; cx.stroke();
      cx.fillStyle = "#fff";
      cx.font = "700 12px -apple-system,system-ui,sans-serif";
      cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.fillText(String(i + 1), q[0], q[1] + 0.5);
      cx.textAlign = "left"; cx.textBaseline = "alphabetic";
    });
    homePin(cx, home);
  }

  /* ---------- QUIET ----------
     The map stops being a map of places and becomes a map of a time of day.
     Two real surfaces: where 311 noise reports cluster after 10 PM, and where
     the late-licensed venues are. Nothing simulated. */
  let nightCells = null;
  function nightSurface() {
    if (nightCells) return nightCells;
    // Per-building 311 noise volume, weighted by the share of it that lands
    // between 22:00 and 05:00. Aggregated onto a ~90m grid so overlapping
    // buildings on one block read as one bloom.
    const cells = new Map();
    for (const a of A) {
      const w = (a.noise || 0) * cl((a.night_pct || 0) / 100, 0, 1);
      if (w <= 0) continue;
      const k = `${Math.round(a.lat / 0.0011)},${Math.round(a.lon / 0.0011)}`;
      cells.set(k, (cells.get(k) || 0) + w);
    }
    nightCells = [...cells.entries()].map(([k, v]) => {
      const [i, j] = k.split(",").map(Number);
      return [i * 0.0011, j * 0.0011, v];
    });
    return nightCells;
  }

  const NIGHT_RAMP = [[237, 233, 247], [166, 160, 214], [122, 92, 178], [58, 36, 102]];

  function drawQuietView(a, cx) {
    /* Dusk, not erasure. The first version washed the basemap 72% toward paper
       so the noise layer would pop, and on a genuinely quiet block — which has
       almost no noise layer to show — that left a white rectangle. The reader
       is supposed to watch the SAME streets change meaning, so the streets have
       to survive the transition. A light indigo tint does the work the white
       wash was failing to do. */
    MK.drawBasemap(0.14);
    cx.fillStyle = `rgba(48,40,92,${0.17 * ease(S.phase)})`;
    cx.fillRect(0, 0, MK.w, MK.h);
    cx.globalAlpha = 1;
    MK.drawHeat(nightSurface(), "night", NIGHT_RAMP, 0.8 * ease(S.phase));

    // Late-licensed venues, drawn as points because a count is the honest unit
    // — these are addresses, not a field.
    const t = ease(cl((S.phase - 0.25) / 0.6, 0, 1));
    if (t > 0) {
      for (const p of GEO.PL) {
        if (!["bar", "club", "music"].includes(p.k)) continue;
        const q = MK.proj(p.la, p.lo);
        if (q[0] < -20 || q[0] > MK.w + 20 || q[1] < -20 || q[1] > MK.h + 20) continue;
        cx.fillStyle = `rgba(228,98,42,${0.75 * t})`;
        cx.beginPath(); cx.arc(q[0], q[1], 2.6, 0, 7); cx.fill();
      }
    }
    homePin(cx, MK.proj(a.lat, a.lon));
  }

  /* ---------- STREET ----------
     Four separate city datasets, grouped under one heading for navigation and
     kept separable underneath. They are deliberately NOT summed into a single
     safety number: they measure different things, they are reported by
     different people for different reasons, and adding them would manufacture
     a scientific-looking score out of four incomparable series. */
  const STREET_RAMP = {
    encampment: [[254, 243, 199], [252, 191, 73], [234, 120, 48], [157, 44, 32]],
    break_in:   [[237, 233, 247], [178, 164, 216], [136, 86, 167], [77, 26, 110]],
    violent:    [[254, 232, 224], [250, 160, 130], [225, 80, 70], [140, 20, 30]],
    cleaning:   [[236, 242, 236], [168, 199, 171], [100, 150, 120], [38, 86, 74]],
  };

  function drawStreetView(a, cx) {
    MK.drawBasemap(0.24);
    const k = S.street || "violent";
    const cells = STREET_GRID[k] || [];
    MK.drawHeat(cells, k, STREET_RAMP[k], 0.82 * ease(S.phase));
    // The radius every number on the panel is measured over, drawn so the
    // reader can see how big "around this address" actually is.
    const home = MK.proj(a.lat, a.lon);
    const px = Math.abs(MK.proj(a.lat + 0.00225, a.lon)[1] - home[1]);   // 250m
    cx.strokeStyle = "rgba(20,20,25,.42)";
    cx.setLineDash([5, 5]); cx.lineWidth = 1.4;
    cx.beginPath();
    cx.arc(home[0], home[1], Math.max(0, px * ease(S.phase)), 0, 7);
    cx.stroke();
    cx.setLineDash([]);
    homePin(cx, home);
  }

  /* ============================================================
     THE PANEL UNDER THE CANVAS
     ============================================================ */
  function drawPanel() {
    const it = cur();
    if (!it) { $("vizpanel").innerHTML = ""; $("vizhead").innerHTML = ""; return; }
    const { a, f } = it;
    const H = { life: lifeHead, walks: walksHead, quiet: quietHead,
                street: streetHead, residents: residentsHead, verify: verifyHead }[S.tab];
    const out = H(a, f);
    $("vizhead").innerHTML = out.head || "";
    $("vizpanel").innerHTML = out.body || "";
  }

  const band = (pct) => pct >= 66 ? ["Lower", "good"] : pct >= 34 ? ["Average", "mid"] : ["Higher", "bad"];

  function lifeHead(a) {
    const lg = GEO.legs(a, S.P);
    const daily = lg.reduce((s, l) => s + l.mins * 2, 0);
    return {
      head: `<h3>Your life from here</h3>
        <p>${lg.length ? `About ${daily} minutes a day getting to the places you named.`
                        : "Add the places you go and we'll draw the routes."}</p>`,
      body: lg.length ? `<div class="legs">${lg.map((l) =>
        `<div class="leg">${ICON.svg(l.icon, 17)}
          <div><b>${esc(l.label)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ""}</div>
          <span class="leg-min">${(() => { const r = pathFor(a, l.lat, l.lon, l.mode);
            return r.real ? `${r.mins} min` : GEO.minsText(a, l.mins); })()
            }<em>${l.mode}</em></span></div>`).join("")}
        <p class="fine">${canRoute(a)
          ? "Walking legs are routed on OpenStreetMap's pavement network - real streets, real lengths. Transit and driving legs stay estimates: this network is pavements, so it can measure a walk exactly and cannot time a bus at all."
          : "Straight-line distance with a 30% detour allowance, drawn along the street grid - estimates, not routing."}${
          GEO.pinNote(a) ? " " + esc(GEO.pinNote(a)) : ""}</p>
        </div>` : `<button class="btn" onclick="CASITA.editPriorities()">Add your places</button>`,
    };
  }

  /* ---------- WALKS ----------
     The loop from the front door and back. Which loops are offered depends on
     the profile: a dog gets a dog walk, a nightlife pick gets a night out. */
  function walksHead(a) {
    const kinds = GEO.walksFor(S.P);
    if (!S.walk || !kinds.includes(S.walk)) S.walk = kinds[0];
    const w = GEO.walk(a, S.walk);
    const spec = GEO.WALKS[S.walk] || {};
    return {
      head: `<h3>${esc(spec.label || "Walks")} from the door</h3>
        <p>${w ? `${w.stops.length} within walking distance - the nearest is ${
                   GEO.minutesTo(a, w.stops[0].lat, w.stops[0].lon, "walk")} min away.`
               : "Nothing of that kind close enough to walk to from here."}</p>`,
      body: `
        <div class="walkpick">${kinds.map((k) =>
          `<button class="${k === S.walk ? "on" : ""}" data-walk="${k}">
            ${ICON.svg(GEO.WALKS[k].icon, 15)}${GEO.WALKS[k].label}</button>`).join("")}</div>
        ${w ? `<div class="legs">${w.stops.map((s, i) =>
          `<div class="leg"><span class="stopnum">${i + 1}</span>
            <div><b>${esc(s.name)}</b><small>${esc(s.kind)}</small></div>
            <span class="leg-min">${(() => { const r = pathFor(a, s.lat, s.lon, "walk");
              return r.real ? `${r.mins} min` : GEO.minsText(a, GEO.minutesTo(a, s.lat, s.lon, "walk")); })()
              }<em>walk</em></span>
          </div>`).join("")}</div>`
           : ""}
        <p class="fine">${canRoute(a)
          ? "Routed on OpenStreetMap's pavement and footpath network - these are the streets you would actually walk, and the times are those routes' real lengths."
          : GEO.soft(a)
            ? "This listing gives a neighbourhood rather than an address, so routing it door-to-door would be precision from the wrong doorstep. Distances are straight-line with a 30% detour allowance."
            : "Loading the street network - until it arrives these are straight-line estimates with a 30% detour allowance."}</p>`,
    };
  }

  function quietHead(a, f) {
    const q = f.F.quiet, lively = S.P.wantsLively;
    const late = a.late || 0;
    const pct = q && q.pct != null ? q.pct : null;
    return {
      head: `<h3>${lively ? (pct >= 55 ? "There's something going on" : "Quieter than you might want")
                          : (pct >= 55 ? "Quiet after 10 PM" : "Livelier after dark than most")}</h3>
        <p>${pct == null ? "We don't have enough on this block to say."
          : `${pct >= 55 ? "Less" : "More"} late-night activity than about
             ${pct >= 55 ? pct : 100 - pct}% of comparable blocks in your search.`}</p>`,
      body: `
        <div class="hours">
          <p class="lab">311 noise reports on this block, by hour</p>
          <div class="hourbar">${(a.hours || []).map((h, i) => {
            const max = Math.max(1, ...(a.hours || [1]));
            const night = i >= 22 || i < 5;
            return `<i style="height:${Math.max(3, h / max * 100)}%;
              background:${night ? "var(--night)" : "var(--line-2)"}" title="${hr(i)}: ${h}"></i>`;
          }).join("")}</div>
          <div class="hourlab"><span>12 AM</span><span>noon</span><span>11 PM</span></div>
        </div>
        <div class="rows">
          <div class="row"><span>Venues licensed past 2 AM nearby</span><b>${late}</b></div>
          <div class="row"><span>Bars, clubs and music within a 10-min walk</span>
            <b>${GEO.countWithin(a, ["bar", "club", "music"], 800)}</b></div>
          <div class="row"><span>Share of noise reports after 10 PM</span><b>${a.night_pct}%</b></div>
        </div>
        ${(a.vnames || []).length ? `<p class="fine">Closest late venues:
          ${(a.vnames || []).slice(0, 3).map((v) => `${esc(v.n)} (${v.d}m)`).join(", ")}.</p>` : ""}
        <p class="fine">Sources: SF 311 noise complaints, SF entertainment permits, OpenStreetMap.</p>`,
    };
  }

  function streetHead(a, f) {
    const p = f.F.street;
    const summary = p == null || p.pct == null ? "We don't have enough reports here to characterise this block."
      : p.pct >= 66 ? "This block reports fewer incidents than most of your search."
      : p.pct >= 34 ? "This block is about average for your search."
      : "This block reports more incidents than most of your search.";
    const keys = ["encampment", "break_in", "violent", "cleaning"];
    return {
      head: `<h3>Safety of the block</h3><p>${summary}</p>`,
      body: `
        <div class="rows street-rows">${keys.map((k) => {
          const pct = FACTORS.streetPct(a, k);
          const [lbl, cls] = band(100 - pct);
          return `<button class="row pick ${S.street === k ? "on" : ""}" data-street="${k}">
            <span>${STREET_LABEL[k]}</span>
            <b class="pill ${cls}">${lbl}</b></button>`;
        }).join("")}</div>
        ${S.street ? `<div class="street-detail">
            <div class="rows">
              <div class="row"><span>Reports in the last 12 months</span><b>${num((a.street || {})[S.street])}</b></div>
              <div class="row"><span>Radius measured</span><b>250 m around this address</b></div>
              <div class="row"><span>Compared with</span><b>the other ${num(S.list.length)} listings in your search</b></div>
              <div class="row"><span>Busier than</span><b>${Math.round(FACTORS.streetPct(a, S.street))}% of them</b></div>
            </div>
            <p class="fine">Source: ${S.street === "violent" || S.street === "break_in"
              ? "SFPD incident reports" : "SF 311 service requests"}, rolling 12 months.
              Percentiles are pulled toward the middle on blocks with few reports on file, so an
              empty block does not read as a calm one.</p>
          </div>`
        : `<p class="fine">Tap a row to map it on its own. These are four separate city datasets -
            we group them for navigation, we don't add them into a safety score.</p>`}`,
    };
  }

  /* ---------- COST ----------
     The panel takes the whole canvas here, because the honest answer to "what
     would I pay" is a table with three confidence levels in it, not a map. */
  function costHead(a) {
    const act = a.act ? a.act[0] : a.rent;
    const hi = a.act && a.act[1] !== a.act[0] ? a.act[1] : null;
    const util = Math.max(0, act - a.rent);
    const verified = a.est === "verified";
    const petFee = a.pet && a.pet.monthly && (S.P.must || []).includes("pets") ? a.pet.monthly : 0;
    return {
      head: `<h3>What you'd likely pay</h3>
        <p>Against the ${money(S.P.comfort)} you called comfortable.</p>`,
      body: `
        <div class="cost">
          <div class="cost-row"><span>Listed rent</span>
            <b>${money(a.rent)}</b><em class="tagv">Verified</em></div>
          <div class="cost-row"><span>Utilities</span>
            <b>${util ? money(util) + (hi ? `–${money(hi - a.rent)}` : "") : "-"}</b>
            <em class="${verified ? "tagv" : "tage"}">${verified ? "Verified" : "Estimated"}</em></div>
          ${petFee ? `<div class="cost-row"><span>Pet rent</span><b>${money(petFee)}</b>
            <em class="tagv">Verified</em></div>` : ""}
          <div class="cost-row"><span>Other mandatory fees</span><b>-</b>
            <em class="tagu">Unknown</em></div>
          <div class="cost-total"><span>Estimated monthly total</span>
            <b>${money(act + petFee)}${hi ? `–${money(hi + petFee)}` : ""}</b></div>
        </div>
        <p class="fine">California does not require all-in pricing, so anything a source did not
          publish stays marked unknown rather than assumed to be zero. Utilities are a range because
          building attributes explain only about a third of the variation between similar units.</p>
        <div class="rows">
          <div class="row"><span>Against your comfortable number</span>
            <b style="color:${act <= S.P.comfort ? "var(--good)" : "var(--accent)"}">
              ${act <= S.P.comfort ? `${money(S.P.comfort - act)} under` : `${money(act - S.P.comfort)} over`}</b></div>
          <div class="row"><span>Against your maximum</span>
            <b>${act <= S.P.maxBudget ? `${money(S.P.maxBudget - act)} of headroom` : "over your ceiling"}</b></div>
          ${a.mkt_ratio ? `<div class="row"><span>Against similar SF units</span>
            <b>${Math.round(a.mkt_ratio * 100)}% of the going rate for its size</b></div>` : ""}
        </div>`,
    };
  }

  /* ---------- RESIDENTS ----------
     Human experience, or an honest blank. Missing reviews are never converted
     into a good score - that is the single most common lie in this category. */
  function residentsHead(a) {
    const g = a.greview;
    if (!g && !a.rating) {
      return {
        head: `<h3>No resident reviews</h3>
          <p>Nobody has reviewed this building on the sources we read. That is not a good sign or a
             bad one - it is nothing.</p>`,
        body: `<div class="rows">
            <div class="row"><span>Building violations on file</span><b>${num(a.novs)}</b></div>
            <div class="row"><span>Open cases</span><b>${num(a.active)}</b></div>
            <div class="row"><span>Open more than a year</span><b>${num(a.over_year)}</b></div>
          </div>
          <p class="fine">The city's inspection record is the only resident-adjacent evidence we have
            for this address. Source: SF DBI complaints.</p>`,
      };
    }
    const themes = (g && g.themes) || [];
    return {
      head: `<h3>Residents say</h3>
        <p><b class="big">${a.rating ?? g.score}</b> / 5 · ${num(a.rating_n || g.n)}
           ${a.rating_src === "Google" ? "Google" : "renter"} reviews</p>`,
      body: `
        ${themes.length ? `<div class="themes">${themes.map((t) =>
          `<div class="theme ${t.neg >= t.n / 2 ? "neg" : "pos"}">
            <span>${t.neg >= t.n / 2 ? "⚠" : "👍"}</span>
            <b>${esc(t.t)}</b><em>${t.n} mention${t.n === 1 ? "" : "s"}</em></div>`).join("")}</div>`
        : `<p class="fine">Not enough reviews to pull out themes.</p>`}
        ${g && g.quote ? `<blockquote>${esc(g.quote.q)}
          <cite>${g.quote.s}/5 · ${esc(g.quote.d)}</cite></blockquote>` : ""}
        <p class="fine">${g ? `Read from ${num(g.sampled)} of ${num(g.n)} published reviews.` : ""}
          Source: ${esc(a.rating_src || "Apartments.com")}. We show what reviewers wrote; we don't
          summarise it into a claim about the landlord.</p>`,
    };
  }

  const hr = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

  /* ---------- IS IT REAL? ----------
     Everything a reader needs before they email a stranger about money:
     what we checked, what we couldn't, whether the place is still on the
     market, who owns the building, and where all of it came from.

     The rule this panel is built on: it reports checks, it does not render a
     verdict about a person or a company. "No photos" and "no landlord entity
     registered at this address" are facts. "This is a scam" is not ours to
     say, and the data cannot support it. */
  function verifyHead(a, f) {
    const v = f.F.verification;
    const photos = (a.photos || []).length;
    const t = a.trust || {};
    /* Derived from the same audit the panel leads with, not from the
       verification percentile.

       Those are two different measurements - one is "how much of this listing
       could we corroborate relative to other listings", the other is "does
       what it says add up" - and letting each write its own headline produced
       a panel that opened with "Some checks didn't come back clean" directly
       above a score of 99 and the words "Nothing unusual". A reader cannot
       reconcile that, and shouldn't have to: whichever they believe, the page
       has told them the other thing too. */
    const s = trustScore(DEAL.audit(a));
    const head = s >= 80
      ? "This listing checks out"
      : s >= 55
        ? "Some checks didn't come back clean"
        : "Treat this listing with caution";

    const availRow = FACTORS.isPlan(a)
      ? `<div class="row"><span>Still listed</span>
           <b class="pill mid">Floor plan, not a unit</b></div>
         <div class="row"><span>What that means</span>
           <b>${esc(a.avail_src || "the site")} generated this reference; ask the building what is actually free</b></div>`
      : a.avail === "live"
      ? `<div class="row"><span>Still listed</span><b class="pill good">Verified live</b></div>
         <div class="row"><span>How we know</span><b>${esc(a.avail_src || "availability sweep")}</b></div>`
      : a.avail === "unknown"
        ? `<div class="row"><span>Still listed</span><b class="pill mid">Not checked</b></div>
           <div class="row"><span>Why not</span><b>This source has no free liveness check</b></div>`
        : `<div class="row"><span>Still listed</span><b class="pill bad">Looks gone</b></div>
           <div class="row"><span>How we know</span><b>Absent from the latest ${esc(a.avail_src || "sweep")}</b></div>`;

    return {
      head: `<h3>${head}</h3>
        <p>${photos ? `${photos} photo${photos === 1 ? "" : "s"} published` : "No photos published"} ·
           listed on ${(a.src || []).map((s) => esc(s.n)).join(" + ") || "one site"}.</p>`,
      body: `
        <p class="lab">Still available?</p>
        <div class="rows">${availRow}
          <div class="row"><span>Advert posted / last updated</span>
            <b>${a.posted ? esc(agoWords(a.posted)) + ` · ${esc(dateOf(a.posted))}`
                          : "not published by this source"}</b></div>
          <div class="row"><span>Listings last swept</span><b>${ago(scrapedAt())}</b></div>
          <div class="row"><span>How well we know the address</span>
            <b class="pill ${LOC_PILL[(a.loc || {}).level] || "mid"}">${LOC_WORD[(a.loc || {}).level] || "Approximate"}</b></div>
        </div>
        ${(a.loc || {}).why ? `<p class="fine">${esc(a.loc.why)}${
          a.loc.moved_m ? ` The pin moved ${Math.round(a.loc.moved_m)} m from where the site put it.` : ""}</p>` : ""}
        <div class="verify-actions">
          <button class="btn" id="recheck">Re-check availability now</button>
          <span class="fine" id="recheck-note">Free - re-sweeps the Craigslist index.</span>
        </div>

        ${auditHTML(a)}

        ${(a.src || []).some((x) => x.n === "Craigslist") ? `
        ${a.phone || a.has_phone ? `<p class="lab">Who to call</p>
          <div class="rows"><div class="row"><span>Published phone</span>
            ${a.phone
              ? `<b><a href="tel:${esc(a.phone.replace(/[^\d+]/g, ""))}">${esc(a.phone)}</a></b>`
              /* The public build ships whether a number exists, not the number
                 itself. What the audit reasons about is the presence -- a
                 listing nobody can be reached at is the loudest fraud signal
                 here -- so the claim survives the number being withheld. */
              : `<b>yes - on the listing</b>`}</div>
            ${a.site ? `<div class="row"><span>The building's own site</span>
              <b><a href="${esc(a.site)}" target="_blank" rel="noopener">open →</a></b></div>` : ""}
          </div>` : ""}
        ${a.desc && a.desc !== "None" ? `<p class="lab">What the listing says</p>
          <p class="fine" style="color:var(--ink-2)">${esc(a.desc.slice(0, 420))}${
            a.desc.length > 420 ? "…" : ""}</p>` : ""}

        <p class="lab">Is anyone actually there?</p>
        <div id="deepbox">
          <p class="fine">The search index carries no contact details. Casita can open the posting
            itself and check whether it accepts replies at all - free, one listing at a time.</p>
          <button class="btn" id="deepbtn"
            data-url="${esc(((a.src || []).find((x) => x.n === "Craigslist") || {}).u || "")}">
            Check the posting</button>
        </div>` : ""}

        <p class="lab">The flat, or the building?</p>
        <div class="rows">
          <div class="row"><span>Photographs published</span>
            ${a.photos_partial
              /* Printing "1" would be false about the advert and true only
                 about us: Zillow's feed hands over a single preview and the
                 gallery sits behind a bot wall. The honest answer is that we
                 did not count them. */
              ? `<b class="dim">not counted - open the listing</b>`
              : `<b>${(a.photos || []).length || "none"}</b>`}</div>
          <div class="row"><span>Amenities listed for this unit</span>
            <b>${(a.unit_amen || []).length
              ? esc(a.unit_amen.join(", ")) : "none - building-level listing"}</b></div>
          <div class="row"><span>Rent and size</span>
            <b>${a.est === "verified" ? "verified for this unit" : "estimated from the building"}${
              a.sqft ? ` · ${num(a.sqft)} sq ft` : ""}</b></div>
        </div>
        <p class="fine">Casita doesn't look at the pictures - that would need a paid vision API.
          It checks something cheaper and nearly as useful: whether anyone published facts about
          <em>this unit</em> rather than the building. 35% of listings here have four or more
          photos and not one unit-level fact.</p>

        <p class="lab">What we could check</p>
        <div class="checks">
          ${(t.ok || []).map((x) => `<div class="ck ok">✓ ${esc(x)}</div>`).join("")}
          ${(t.warn || []).map((x) => `<div class="ck warn">! ${esc(x)}</div>`).join("")}
          ${!(t.ok || []).length && !(t.warn || []).length
            ? `<p class="fine">Nothing on file for this address.</p>` : ""}
        </div>

        <p class="lab">Who owns the building</p>
        <div id="ownerbox">
          <p class="fine">Looked up one address at a time from public property records.</p>
          ${(a.loc || {}).level === "neighbourhood"
            ? `<p class="fine">No published address to look up - this listing gives a neighbourhood only.</p>`
            : `<button class="btn" id="ownerbtn" data-addr="${esc(a.addr)}">Look up the owner</button>`}
        </div>

        <p class="lab">Where this came from</p>
        <div class="rows">
          ${(a.src || []).map((s) => `<div class="row"><span>${esc(s.n)}${
            s.c > 1 ? ` · ${s.c} ads` : ""}</span><b><a href="${esc(s.u)}" target="_blank"
            rel="noopener">open the original →</a></b></div>`).join("")}
        </div>
        <p class="fine">Craigslist, Zillow and Apartments.com, matched to city records: the SF
          parcel map, DBI complaints, SFPD incidents and 311 requests (rolling 12 months), plus
          OpenStreetMap for what is nearby.</p>`,
    };
  }

  /* The auditor's report. Concerns and the reasons against them are shown
     together and in that order, because the reader's question is never "is
     this cheap" - they can see the price - but "is it cheap for a reason". */
  const VERDICT = {
    suspect:  { cls: "bad",  word: "Doesn't add up" },
    check:    { cls: "mid",  word: "Worth checking" },
    bargain:  { cls: "good", word: "Rare find" },
    ordinary: { cls: "good", word: "Nothing unusual" },
  };

  /* A number, a word, and one sentence.

     This panel used to open with four stacked lists - concerns, then reasons
     the price might legitimately be low, then independent confirmation, then a
     disclaimer - before the reader learned whether the listing was fine. That
     is backwards: the answer is "probably fine" for most listings, and making
     someone read eleven bullet points to discover it trains them to skip the
     panel entirely, which is precisely the panel you cannot afford to have
     skipped.

     So the verdict leads, as a score anyone can read at a glance, and the
     evidence moves behind a disclosure. Nothing is removed - every line is one
     click away and still cites its source - but the reader is no longer made
     to assemble the conclusion themselves. */
  function trustScore(d) {
    let s = 100;
    for (const c of d.concerns) s -= c.sev === "high" ? 24 : c.sev === "med" ? 11 : 6;
    // Corroboration can repair a score but never manufacture a clean one: five
    // independent confirmations do not cancel a landlord asking for a deposit
    // by wire.
    s += Math.min(18, d.corroborates.length * 4);
    if (d.explains.length) s += Math.min(8, d.explains.length * 3);
    return cl(Math.round(s), 5, 99);
  }

  function auditHTML(a) {
    const d = DEAL.audit(a);
    const v = VERDICT[d.verdict];
    const pct = d.discount != null && d.discount > 0 ? Math.round(d.discount * 100) : null;
    const s = trustScore(d);
    const tone = s >= 80 ? "ok" : s >= 55 ? "watch" : "bad";
    const n = d.concerns.length;
    return `
      <p class="lab">Does this listing add up?</p>
      <div class="audit">
        <div class="trust trust-${tone}">
          <div class="trust-n">${s}</div>
          <div class="trust-t">
            <b>${v.word}</b>
            <span>${esc(d.line)}</span>
          </div>
          ${pct ? `<span class="trust-tag">${pct}% under ${esc(d.expected.basis)}</span>` : ""}
        </div>
        <details class="audit-more">
          <summary>${n ? `${n} thing${n === 1 ? "" : "s"} to check` : "What we checked"}${
            d.corroborates.length ? ` · ${d.corroborates.length} confirmed` : ""}</summary>
          ${d.concerns.length ? `<div class="checks">${d.concerns.map((c) =>
            `<div class="ck ${c.sev === "high" ? "warn" : "note"}">
              <b>${c.sev === "high" ? "!" : "·"}</b> ${esc(c.text)}
              <em>${esc(c.src)}</em></div>`).join("")}</div>` : ""}
          ${d.explains.length ? `<p class="audit-sub">Why the price could legitimately be low</p>
            <div class="checks">${d.explains.map((x) =>
              `<div class="ck ok">✓ ${x}</div>`).join("")}</div>` : ""}
          ${d.corroborates.length ? `<p class="audit-sub">Independent confirmation</p>
            <div class="checks">${d.corroborates.map((x) =>
              `<div class="ck ok">✓ ${esc(x)}</div>`).join("")}</div>` : ""}
          <p class="fine">Each line compares two facts we can point at - not a judgement about
            whoever posted it. Never pay before seeing the place.</p>
        </details>
      </div>`;
  }

  /* ---------- freshness ---------- */
  const dateOf = (epoch) => new Date(epoch * 1000)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const scrapedAt = () => {
    const m = document.querySelector('meta[name="casita:scraped"]');
    return m ? new Date(m.content) : null;
  };
  function ago(d) {
    if (!d || isNaN(d)) return "unknown";
    const h = (Date.now() - d) / 36e5;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
    if (h < 24) return `${Math.round(h)} hours ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  /* ---------- opening the actual posting ----------
     Everything a renter checks by instinct and Casita cannot see from the
     search index: is there a reply button, is there a body worth reading, is
     there any way to reach a person. A post with seventeen photographs, a
     beautifully written description and no way to contact anybody is the shape
     the reader was worried about, and until now nothing here could see it. */
  /* Three features here reach a server: opening a live posting, looking up an
     owner, and re-sweeping availability. The published build has no server, so
     rather than let them fail into a message about a file the reader does not
     have, they say what they are and why they are not running. */
  const LOCAL_ONLY = `<p class="fine">Live check - runs against the local
    pipeline (<code>research/serve.py</code>), which holds the API key and the
    request budget. Not wired up on the published build.</p>`;

  async function deepCheck(url) {
    const box = $("deepbox");
    if (window.CASITA_PUBLIC) { box.innerHTML = LOCAL_ONLY; return; }
    if (!url) { box.innerHTML = `<p class="fine">No Craigslist URL on this listing.</p>`; return; }
    box.innerHTML = `<p class="fine">Opening the posting…</p>`;
    let r;
    try {
      r = await (await fetch("/api/listing?url=" + encodeURIComponent(url))).json();
    } catch {
      box.innerHTML = `<p class="fine">Couldn't reach the local server (research/serve.py).</p>`;
      return;
    }
    if (r.error) { box.innerHTML = `<p class="fine">${esc(r.error)}</p>`; return; }
    if (r.gone) {
      box.innerHTML = `<div class="rows"><div class="row"><span>The posting</span>
        <b class="pill bad">Deleted or expired</b></div></div>
        <p class="fine">It was in the last sweep but the page is gone now.</p>`;
      return;
    }
    const thin = r.bodyChars < r.bodyP25;
    const veryThin = r.bodyChars < r.bodyP25 / 2;
    box.innerHTML = `<div class="rows">
        <div class="row"><span>Written about the place</span>
          <b class="pill ${veryThin ? "bad" : thin ? "mid" : "good"}">${num(r.bodyChars)} characters</b></div>
        <div class="row"><span>Against other SF postings</span>
          <b>${thin ? `shorter than about 75%` : `around or above the median`} (median ${num(r.bodyMedian)})</b></div>
        <div class="row"><span>Phone or email in the text</span>
          <b>${r.emailsInBody || r.phonesInBody
            ? `${r.emailsInBody} email${r.emailsInBody === 1 ? "" : "s"}, ${r.phonesInBody} phone`
            : "none - normal for Craigslist"}</b></div>
      </div>
      ${thin ? `<div class="ck ${veryThin ? "warn" : "note"}" style="margin-top:8px">
        <b>${veryThin ? "!" : "·"}</b> Less written here than in most postings - worth asking for
        the things it leaves out before you spend an evening on it.</div>` : ""}
      <p class="fine">Read off the posting just now. Casita deliberately does not report whether
        the post "accepts replies": Craigslist ships that button on every page, so the check would
        say yes every time. Contact runs through their anonymous relay, which is why no phone or
        email in the text is normal rather than a warning sign.</p>`;
  }

  /* ---------- owner lookup ----------
     Proxied through serve.py, which holds the API key, caches every answer
     forever and refuses to exceed the free monthly allowance. The button can
     therefore be pressed without any risk of running up a bill, and the panel
     reports what is left rather than hiding the meter. */
  const ownerCache = {};
  async function lookupOwner(addr) {
    const box = $("ownerbox");
    // Owner lookups return the names of identifiable people out of public
    // property records. That is a local-tool affordance, not something to
    // expose from a public URL to anyone who finds it.
    if (window.CASITA_PUBLIC) { box.innerHTML = LOCAL_ONLY; return; }
    if (ownerCache[addr]) return renderOwner(ownerCache[addr]);
    box.innerHTML = `<p class="fine">Looking up public property records…</p>`;
    let r;
    try {
      r = await (await fetch("/api/owner?addr=" + encodeURIComponent(addr))).json();
    } catch {
      box.innerHTML = `<p class="fine">Couldn't reach the local server - owner lookups need
        <code>research/serve.py</code> running.</p>`;
      return;
    }
    if (r.error) {
      box.innerHTML = `<p class="fine">${esc(r.note || r.error)}</p>`;
      return;
    }
    ownerCache[addr] = r;
    renderOwner(r);
  }

  function renderOwner(r) {
    const box = $("ownerbox");
    if (!r.found) {
      box.innerHTML = `<div class="rows"><div class="row"><span>Owner on record</span>
        <b>Nothing published for this address</b></div></div>
        <p class="fine">The records service had no owner for this address. That is common for
          smaller buildings and does not mean anything is wrong.</p>`;
      return;
    }
    box.innerHTML = `<div class="rows">
        <div class="row"><span>Owner on record</span><b>${r.names.map(esc).join(", ")}</b></div>
        ${r.type ? `<div class="row"><span>Type</span><b>${esc(r.type)}</b></div>` : ""}
        ${r.lastSale ? `<div class="row"><span>Last sold</span><b>${esc(r.lastSale)}</b></div>` : ""}
        ${r.ownerOccupied != null ? `<div class="row"><span>Owner-occupied</span>
          <b>${r.ownerOccupied ? "Yes" : "No"}</b></div>` : ""}
      </div>
      <p class="fine">From public property records${r.cached ? ", cached from an earlier lookup" : ""}.
        ${r.left != null ? `${r.left} lookups left this month.` : ""}
        These are lawfully public names attached to a parcel. We show the record and nothing
        inferred from it - no claims about how this owner behaves as a landlord.</p>`;
  }

  /* ---------- re-check availability ----------
     The free mode only: it re-sweeps the Craigslist search index, which costs
     nothing. The paid Apify re-scrape stays behind the server's own env flag
     and is deliberately not reachable from a button. */
  let recheckTimer = null;
  async function recheck() {
    const btn = $("recheck"), note = $("recheck-note");
    if (!btn) return;
    if (window.CASITA_PUBLIC) {
      note.textContent = "Runs against the local pipeline; not on the published build.";
      btn.disabled = true;
      return;
    }
    btn.disabled = true;
    note.textContent = "Starting…";
    try {
      const r = await fetch("/api/refresh?mode=live", { method: "POST" });
      const j = await r.json();
      if (!r.ok) { note.textContent = j.note || j.error || "Refused."; btn.disabled = false; return; }
    } catch {
      note.textContent = "Couldn't reach the local server (research/serve.py).";
      btn.disabled = false;
      return;
    }
    poll();
  }
  async function poll() {
    clearTimeout(recheckTimer);
    const note = $("recheck-note");
    let s;
    try { s = await (await fetch("/api/refresh")).json(); } catch { return; }
    const job = s.job || {};
    if (note) note.textContent = job.running ? `${job.step || "working"}…` : "";
    if (job.running) { recheckTimer = setTimeout(poll, 2000); return; }
    // The run rewrote this page's data; only a reload picks it up.
    if (job.done && !job.error) location.reload();
    else if (job.error && note) {
      note.textContent = "Failed: " + job.error;
      const b = $("recheck"); if (b) b.disabled = false;
    }
  }

  /* ============================================================
     WIRING
     ============================================================ */
  function select(i) {
    if (!S.list.length) return;
    S.i = cl(i, 0, S.list.length - 1);
    restart();
    drawDecision(); drawFilm(); drawTabs(); drawPanel(); reframe();
  }

  function rebuild() {
    S.M = FACTORS.build(A, S.P);
    S.list = rank(A);
    rememberAll(A);
    S.i = 0;
    // Show the shell and measure it BEFORE framing anything. A hidden canvas
    // reports a zero-sized rect, and MK.frame() solving for a zoom against
    // width 0 produced a camera showing the whole peninsula.
    $("app").hidden = false;
    $("onboard").hidden = true;
    MK.resize();
    drawHood(); drawDecision(); drawFilm(); drawTabs(); drawPanel();
    reframe(false);               // first paint lands framed, with no fly-in
    restart();
  }

  function editPriorities() {
    $("app").hidden = true;
    QUIZ.open($("onboard"), QUIZ.load(), (P) => { S.P = P; rebuild(); });
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-pick],[data-step],[data-act],[data-scroll]," +
      "[data-street],[data-open],[data-zoom],[data-recenter],[data-theme-set],[data-photo]," +
      "[data-walk],[data-hood],[data-district],[data-saved],[data-hoodtoggle],[data-sort]," +
      "[data-plans]," +
      "#ownerbtn,#recheck,#deepbtn");
    if (!t) return;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.dataset.pick) return select(+t.dataset.pick);
    if (t.dataset.step) return select(S.i + +t.dataset.step);
    if (t.dataset.scroll) {
      const rail = $("film-rail");
      rail.scrollBy({ left: +t.dataset.scroll * 320, behavior: "smooth" });
      return;
    }
    if (t.dataset.street) {
      S.street = S.street === t.dataset.street ? null : t.dataset.street;
      restart(); drawPanel(); MK.request();
      return;
    }
    if (t.dataset.open === "score") return openScore();
    if (t.dataset.themeSet) return setTheme(t.dataset.themeSet);
    if (t.dataset.photo) return stepPhoto(+t.dataset.photo);
    if (t.dataset.district !== undefined) {
      S.district = t.dataset.district || null; S.hood = null;
      // Choosing a district reveals its sub-areas, so the panel stays open;
      // choosing "All of SF" is a finished answer and closes it.
      S.hoodOpen = !!S.district;
      applyHood(); return;
    }
    if (t.dataset.hood !== undefined) {
      S.hood = t.dataset.hood || null;
      S.hoodOpen = false;          // a specific area is a finished answer
      applyHood(); return;
    }
    if (t.dataset.walk) {
      S.walk = t.dataset.walk;
      restart(); drawPanel(); reframe();
      return;
    }
    if (t.id === "deepbtn") return deepCheck(t.dataset.url);
    if (t.id === "ownerbtn") return lookupOwner(t.dataset.addr);
    if (t.id === "recheck") return recheck();
    if (t.dataset.zoom) return MK.zoomAround(+t.dataset.zoom, MK.w / 2, MK.h / 2);
    if (t.dataset.recenter !== undefined) { reframe(true); return; }
    if (t.dataset.act === "save") {
      const a = cur().a;
      S.saved.has(a.id) ? S.saved.delete(a.id) : S.saved.add(a.id);
      persistSaved();
      // Un-saving the last one while filtered to saved would leave an empty
      // screen with no way back, so the filter releases itself.
      if (S.onlySaved && !S.saved.size) { S.onlySaved = false; applyHood(); return; }
      if (S.onlySaved) { applyHood(); return; }
      drawDecision(); drawFilm(); drawHood();
      return;
    }
    if (t.dataset.sort) {
      S.sort = t.dataset.sort;
      applyHood();
      return;
    }
    if (t.dataset.hoodtoggle !== undefined) {
      S.hoodOpen = !S.hoodOpen;
      drawHood();
      return;
    }
    if (t.dataset.saved !== undefined) {
      S.onlySaved = !S.onlySaved;
      if (S.onlySaved) S.onlyPlans = false;
      applyHood();
      return;
    }
    if (t.dataset.plans !== undefined) {
      S.onlyPlans = !S.onlyPlans;
      if (S.onlyPlans) S.onlySaved = false;
      applyHood();
      return;
    }
    if (t.dataset.act === "pass") {
      S.passed.add(cur().a.id);
      const at = S.i;
      S.list = rank(A);
      select(Math.min(at, S.list.length - 1));
      return;
    }
  });

  addEventListener("keydown", (e) => {
    if ($("app").hidden) return;
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") select(S.i + 1);
    if (e.key === "ArrowLeft") select(S.i - 1);
    if (e.key === "Escape") $("scoredlg").close();
  });

  /* "Why this score?" — available, and hidden by default. The renter should
     never have to read this; the fact that they could is what makes the number
     worth anything. */
  function openScore() {
    const { a, f } = cur();
    const rows = Object.values(f.F)
      .filter((x) => x.adj != null && x.w >= 1)
      .sort((x, y) => y.w * y.adj - x.w * x.adj);
    $("scorebody").innerHTML = `
      <h3>${f.score} · ${f.label}</h3>
      <p class="fine"><b>${f.score} is a rank, not a grade.</b> It means this fits the answers you
        gave better than ${f.score}% of the ${num(counts.eligible)} places that clear your budget,
        bedrooms and must-haves. Each factor below is a rank in the same way. Underlying weighted
        score ${f.raw}/100 - averaging this many factors compresses toward the middle, which is why
        the rank is the more useful number. Confidence: ${f.confLabel.toLowerCase()}.</p>
      <div class="rows">${rows.map((x) =>
        `<div class="row"><span class="rowlbl">${ICON.svg(x.def.icon, 15)}${x.def.label}</span>
          <b>${x.pct}${x.conf < 0.5 ? ` <em class="fine">thin evidence</em>` : ""}</b></div>`).join("")}</div>
      ${(f.gates || []).length ? `<p class="lab">What held it back</p>
        <div class="rows">${f.gates.map((g) =>
          `<div class="row"><span>${esc(g.label)} is in the bottom ${g.pct}% of your search</span>
            <b style="color:var(--accent)">−${Math.round((1 - g.gate) * 100)}%</b></div>`).join("")}</div>
        <p class="fine">You said this mattered, so a weak result multiplies the score down rather
          than being averaged against everything else.</p>` : ""}
      ${f.unknowns.length ? `<p class="lab">Needs verification</p>
        <div class="rows">${f.unknowns.map((u) =>
          `<div class="row"><span>${esc(u.text)}</span></div>`).join("")}</div>` : ""}
      <p class="fine">Factors you didn't pick still carry a small weight, so a building with a serious
        record can't be hidden by the things you did pick. Anything severe is named under
        "Good to know" rather than quietly subtracted.</p>`;
    $("scoredlg").showModal();
  }

  /* ---------- boot ---------- */
  function boot() {
    initTheme();
    S.saved = loadSaved();
    MK.attach($("map"), frame);
    /* Listing photos come from the same congested burst the tiles do, and a
       broken <img> stays broken with no way back. Two retries with backoff,
       then it is left alone rather than hammering a genuinely dead URL. */
    window.CASITA = {
      editPriorities, select, state: S,
      retryImg(el) {
        const n = (+el.dataset.retry || 0) + 1;
        if (n > 2) { el.style.visibility = "hidden"; return; }
        el.dataset.retry = n;
        const base = el.src.split("?")[0];
        setTimeout(() => { el.src = base + "?r=" + n; }, 350 * n);
      },
    };
    const saved = QUIZ.load();
    if (saved) { S.P = QUIZ.derive(saved); rebuild(); }
    else {
      $("app").hidden = true;
      QUIZ.open($("onboard"), null, (P) => { S.P = P; rebuild(); });
    }
    addEventListener("resize", () => { MK.resize(); MK.request(); });

    /* The street network is ~2MB and nothing on screen needs it to appear, so
       it loads after the first paint and the map simply gets better when it
       lands. A failure is not an error state: the straight-line estimates that
       preceded it are still there, still labelled as estimates. */
    ROUTER.load("walk_graph.json").then(() => {
      routeCache.clear();
      drawPanel(); MK.request();
    }).catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
