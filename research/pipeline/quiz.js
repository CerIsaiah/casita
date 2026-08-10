/* quiz.js — the front door.
   ============================================================
   A new renter does not see apartments first. They see this.

   That is not a courtesy, it is the architecture: every number on the next
   screen is an answer to "is this good for *you*", and until someone has said
   what they want, there is no "you" to answer for. The previous build hid the
   quiz behind a header button, so the default experience was a generic list
   wearing a personal one's clothes.

   Two constraints on what may be asked.

   · Only housing. Budgets, places you go, what you would trade. Never age,
     income bracket, household makeup, or anything that stands in for a
     protected trait. "I want to be near the bars" is a housing preference;
     "24 and single" is a demographic proxy for the same answer, and it does
     not belong in a rental product.

   · Nothing collected that is not read. Six screens, and every answer moves
     the ranking or changes what the next screen shows. The question that
     would be nice to have but changes nothing is the question that makes a
     quiz feel like a settings form.
   ============================================================ */

const QUIZ = (() => {
  "use strict";

  const KEY = "casita.profile.v1";
  const VERSION = 1;

  const BLANK = {
    v: VERSION, done: false,
    comfort: 2800, maxBudget: 3200,
    beds: null, moveIn: "soon", pets: "none",
    must: [], nice: [],
    priorities: {},          // key -> "vhigh" | "high" | "nice"
    anchors: [],
    groceryBrand: null, gymBrand: null,
    maxCommute: null,        // minutes one way to the first anchor; null = no limit
    lively: 35,              // 0 = quiet, 100 = lively
    spaceVsLocation: 50,     // 0 = location, 100 = space
    charVsNew: 45,           // 0 = character, 100 = newer
  };

  function load() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      return p && p.v === VERSION && p.done ? p : null;
    } catch { return null; }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }
  function clear() { try { localStorage.removeItem(KEY); } catch {} }

  /* ---------- what the profile means downstream ----------
     The quiz writes answers; this turns them into the handful of fields the
     scoring model actually reads. Keeping the translation in one function is
     what stops a question from being collected and then quietly ignored. */
  function derive(p) {
    // Errands drawn on the map are the ones tied to a stated priority. Someone
    // who never mentioned the gym does not get a gym line on their map.
    const errands = [];
    for (const k of ["grocery", "gym", "transit"])
      if (p.priorities[k]) errands.push(k);
    if (p.priorities.nightlife) errands.push("nightlife");
    if (p.priorities.walk && !errands.includes("grocery")) errands.push("grocery");

    // The space/location trade sets the square-footage the Space factor scores
    // against, so the slider moves a real number rather than a mood.
    const base = p.beds >= 2 ? 900 : p.beds === 1 ? 700 : 500;
    return Object.assign({}, p, {
      errands,
      idealSqft: Math.round(base * (0.85 + p.spaceVsLocation / 100 * 0.45)),
      // Wanting a lively block and wanting quiet nights are the same axis read
      // from opposite ends; the slider decides which way Quiet is scored.
      wantsLively: p.lively >= 60,
    });
  }

  /* ---------- destinations ----------
     Searched locally first. The demo has to work with the network off, and a
     dead address box on screen two is a dead product. Nominatim is the
     fallback for anything the local index does not know, and it is keyless. */
  const LANDMARKS = [
    ["Mission Bay", 37.7706, -122.3893], ["Financial District", 37.7936, -122.3993],
    ["SoMa", 37.7785, -122.4056], ["Downtown / Union Square", 37.7880, -122.4074],
    ["Mission District", 37.7599, -122.4148], ["Castro", 37.7609, -122.4350],
    ["Hayes Valley", 37.7765, -122.4241], ["Nob Hill", 37.7930, -122.4161],
    ["Marina", 37.8021, -122.4367], ["Presidio", 37.7989, -122.4662],
    ["Dogpatch", 37.7576, -122.3880], ["Potrero Hill", 37.7605, -122.4008],
    ["Sunset", 37.7521, -122.4943], ["Richmond", 37.7801, -122.4644],
    ["Berkeley", 37.8715, -122.2730], ["Oakland Downtown", 37.8044, -122.2712],
    ["Palo Alto", 37.4419, -122.1430], ["SFO Airport", 37.6213, -122.3790],
    ["UCSF Parnassus", 37.7632, -122.4585], ["Salesforce Tower", 37.7897, -122.3972],
    ["Chase Center", 37.7680, -122.3877], ["Golden Gate Park", 37.7694, -122.4862],
  ];

  function searchPlaces(q) {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];
    for (const [nm, la, lo] of LANDMARKS)
      if (nm.toLowerCase().includes(s)) out.push({ name: nm, lat: la, lon: lo, sub: "San Francisco Bay Area" });
    for (const p of GEO.PL) {
      if (out.length > 9) break;
      if ((p.n || "").toLowerCase().includes(s))
        out.push({ name: p.n, lat: p.la, lon: p.lo, sub: p.k });
    }
    return out.slice(0, 7);
  }

  async function geocode(q) {
    const u = "https://nominatim.openstreetmap.org/search?format=json&limit=5"
            + "&viewbox=-122.6,37.95,-122.0,37.55&bounded=1&q=" + encodeURIComponent(q);
    try {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      return (await r.json()).map((x) => ({
        name: x.display_name.split(",")[0],
        sub: x.display_name.split(",").slice(1, 3).join(",").trim(),
        lat: +x.lat, lon: +x.lon,
      }));
    } catch { return []; }
  }

  /* ---------- content ---------- */
  const ANCHOR_KINDS = [
    ["briefcase", "Work"], ["dumbbell", "Gym"], ["cart", "Grocery"],
    ["star", "Partner"], ["building", "School"], ["coffee", "Favorite spot"],
  ];

  // Only amenities the data can actually answer. There is no parking, elevator
  // or doorman field in any of the three sources, and a pill that can never be
  // confirmed is a promise the results page would have to break.
  const AMENITIES = [
    ["ac", "snowflake", "A/C"], ["wd", "window", "In-unit laundry"],
    ["dishwasher", "grid", "Dishwasher"], ["outdoor", "tree", "Outdoor space"],
    ["storage", "building", "Storage / walk-in"], ["furnished", "window", "Furnished"],
    ["rc", "shield", "Rent-controlled"],
  ];

  const PRIORITIES = [
    ["quiet", "moon", "Quiet nights"], ["street", "shield", "Street conditions"],
    ["cost", "money", "Lower monthly cost"], ["space", "ruler", "More space"],
    ["management", "wrench", "Good management"], ["residents", "star", "Resident satisfaction"],
    ["transit", "train", "Transit"], ["walk", "walk", "Walkability"],
    ["nightlife", "wine", "Nightlife"], ["grocery", "cart", "Grocery access"],
    ["gym", "dumbbell", "Gym access"], ["commute", "briefcase", "Short commute"],
  ];

  const IMP_LABEL = [["nice", "Nice to have"], ["high", "Important"], ["vhigh", "Very important"]];

  /* ---------- steps ---------- */
  let D = null, step = 0, host = null, onDone = null;

  const STEPS = [
    {
      section: "What you need",
      title: "What can you spend?",
      sub: "Total monthly housing cost — not just the advertised rent. We compare against our estimate of the real number.",
      body: () => `
        <div class="q-budget">
          <div class="q-bnum">
            <label>Comfortable each month</label>
            <output>${money(D.comfort)}</output>
            <input type="range" min="1200" max="8000" step="50" value="${D.comfort}" data-slider="comfort">
          </div>
          <div class="q-bnum">
            <label>Absolute maximum</label>
            <output>${money(D.maxBudget)}</output>
            <input type="range" min="1200" max="9000" step="50" value="${D.maxBudget}" data-slider="maxBudget">
          </div>
        </div>
        <p class="q-note">Anything over your maximum is treated as a wall, not a preference.</p>`,
    },
    {
      section: "What you need",
      title: "Tell us about the place.",
      sub: "Just the basics — we'll use these as filters, not as scoring.",
      body: () => `
        <p class="q-label">Bedrooms</p>
        <div class="q-pills">${[[null, "Studio+"], [0, "Studio"], [1, "1+"], [2, "2+"], [3, "3+"]]
          .map(([v, l]) => `<button class="q-pill ${D.beds === v ? "on" : ""}" data-beds="${v}">${l}</button>`).join("")}</div>

        <p class="q-label">Move-in</p>
        <div class="q-pills">${[["asap", "As soon as possible"], ["soon", "Within a month"],
            ["later", "1–3 months"], ["flex", "Flexible"]]
          .map(([v, l]) => `<button class="q-pill ${D.moveIn === v ? "on" : ""}" data-movein="${v}">${l}</button>`).join("")}</div>

        <p class="q-label">Pets</p>
        <div class="q-pills">${[["none", "🚫 None"], ["cat", "🐈 Cat"], ["dog", "🐕 Dog"]]
          .map(([v, l]) => `<button class="q-pill ${D.pets === v ? "on" : ""}" data-pets="${v}">${l}</button>`).join("")}</div>
        ${D.pets === "dog" ? `<p class="q-note">We'll only show places whose policy mentions dogs,
          and add a Walks tab that maps a loop from the front door past the nearest green space.</p>` : ""}`,
    },
    {
      section: "What you need",
      title: "Anything you won't live without?",
      sub: "Tap once for nice to have, twice for must have. Must-haves are constraints — we'll say so when a listing can't prove one.",
      body: () => `
        <div class="q-amens">${AMENITIES.map(([k, ic, l]) => {
          const state = D.must.includes(k) ? "must" : D.nice.includes(k) ? "nice" : "";
          return `<button class="q-amen ${state}" data-amen="${k}">
            ${ICON.svg(ic, 17)}<span>${l}</span>
            <em>${state === "must" ? "Must have" : state === "nice" ? "Nice to have" : ""}</em>
          </button>`;
        }).join("")}</div>
        <p class="q-note">Only amenities our sources actually publish are listed here. We never fail a
          listing for staying silent — we mark it "needs verification" instead.</p>`,
    },
    {
      section: "What matters most",
      title: "What matters most about where you live?",
      /* One is a legitimate answer.
         Requiring three forced people to invent preferences they did not have,
         and an invented priority is not neutral — it is averaged in against the
         real one and dilutes it. Someone who only cares about being near the
         bars should be able to say exactly that and get the bars. */
      sub: "Pick one to five. This decides what we rank on — and what we bother showing you.",
      body: () => {
        const chosen = Object.keys(D.priorities);
        return `<div class="q-prios">${PRIORITIES.map(([k, ic, l]) => {
          const imp = D.priorities[k];
          return `<div class="q-prio ${imp ? "on" : ""}" data-prio="${k}">
            <button class="q-priobtn">${ICON.svg(ic, 17)}<b>${l}</b></button>
            ${imp ? `<div class="q-imp">${IMP_LABEL.map(([v, lb]) =>
              `<button class="${imp === v ? "on" : ""}" data-imp="${k}|${v}">${lb}</button>`).join("")}</div>` : ""}
          </div>`;
        }).join("")}</div>
        <p class="q-note">${!chosen.length
          ? "Pick at least one."
          : chosen.length >= 5 ? "That's the limit — five is already a lot to weigh at once."
          : `${chosen.length} picked. Add more if they genuinely matter; each one you
             add divides the attention the others get.`}</p>`;
      },
      valid: () => Object.keys(D.priorities).length >= 1,
    },
    {
      section: "Your life",
      title: "Where does your life happen?",
      sub: "We'll draw the route from every apartment to these, and rank on how far they are.",
      body: () => `
        <div class="q-anchors">${D.anchors.map((an, i) =>
          `<div class="q-anchor">${ICON.svg(an.icon, 17)}
            <div><b>${esc(an.label)}</b><small>${esc(an.place || "")}</small></div>
            <span class="q-modes">${[["walk", "Walk"], ["transit", "Transit"], ["drive", "Drive"]]
              .map(([m, l]) => `<button class="${(an.mode || "transit") === m ? "on" : ""}"
                data-anchormode="${i}|${m}">${l}</button>`).join("")}</span>
            <button data-rmanchor="${i}" aria-label="Remove">✕</button></div>`).join("")}</div>
        <div class="q-addwrap">
          <div class="q-kinds">${ANCHOR_KINDS.map(([ic, l]) =>
            `<button class="q-kind ${D._kind === l ? "on" : ""}" data-kind="${ic}|${l}">
              ${ICON.svg(ic, 15)}${l}</button>`).join("")}</div>
          <input class="q-search" id="q-search" placeholder="${D._kind ? `Where is ${D._kind.toLowerCase()}? Search an address or place…` : "Pick a category, then search…"}"
            autocomplete="off" ${D._kind ? "" : "disabled"}>
          <div class="q-results" id="q-results"></div>
        </div>
        ${D.anchors.some((x) => x.label === "Work") ? `
          <p class="q-label">How long is too long to commute?</p>
          <div class="q-pills">${[[20, "20 min"], [30, "30 min"], [45, "45 min"],
              [60, "An hour"], [null, "No limit"]]
            .map(([v, l]) => `<button class="q-pill ${D.maxCommute === v ? "on" : ""}"
              data-commute="${v}">${l}</button>`).join("")}</div>
          <p class="q-note">One way, door to door. Anything longer is treated as a wall, like your
            budget — a beautiful flat you would resent every morning is not a good match.</p>` : ""}
        <p class="q-note">Addresses are looked up once and stay in this browser. Travel times are
          estimates, not live routing.</p>`,
    },
    {
      section: "Tradeoffs",
      title: "Last thing — what would you trade?",
      sub: "There is no right answer. This only breaks ties.",
      body: () => `
        <div class="q-trades">
          ${trade("lively", "Quiet", "Lively", D.lively)}
          ${trade("spaceVsLocation", "Best location", "More space", D.spaceVsLocation)}
          ${trade("charVsNew", "Character", "Newer building", D.charVsNew)}
        </div>`,
    },
  ];

  const trade = (k, left, right, v) => `
    <div class="q-trade">
      <div class="q-tends"><span>${left}</span><span>${right}</span></div>
      <input type="range" min="0" max="100" step="5" value="${v}" data-slider="${k}">
    </div>`;

  /* ---------- render ---------- */
  function draw() {
    const st = STEPS[step];
    const last = step === STEPS.length - 1;
    const ok = st.valid ? st.valid() : true;
    host.innerHTML = `
      <div class="q-shell">
        <div class="q-top">
          <div class="q-brand">${LOGO_SVG}<b>Casita</b></div>
          <div class="q-dots">${STEPS.map((_, i) =>
            `<i class="${i === step ? "on" : i < step ? "done" : ""}"></i>`).join("")}</div>
        </div>
        <div class="q-main">
          <div class="q-card">
            <p class="q-section">${st.section}</p>
            <h1>${st.title}</h1>
            <p class="q-sub">${st.sub}</p>
            <div class="q-body">${st.body()}</div>
          </div>
        </div>
        <div class="q-foot">
          <button class="q-back" ${step ? "" : 'style="visibility:hidden"'}>Back</button>
          <div class="q-footright">
            ${last ? "" : `<button class="q-skip">Skip</button>`}
            <button class="q-next" ${ok ? "" : "disabled"}>${last ? "Show me what fits" : "Continue"}</button>
          </div>
        </div>
        ${last ? `<p class="q-anytime">You can change any of this at any time.</p>` : ""}
      </div>`;

    host.querySelector(".q-next").onclick = () => {
      if (last) return finish();
      step++; draw();
    };
    const back = host.querySelector(".q-back");
    if (back) back.onclick = () => { step--; draw(); };
    const skip = host.querySelector(".q-skip");
    if (skip) skip.onclick = () => { step++; draw(); };

    const s = host.querySelector("#q-search");
    if (s && D._kind) setTimeout(() => s.focus(), 60);
  }

  /* One delegated listener for the whole quiz. Redrawing on every answer is
     what keeps the copy underneath the pills honest — "pick two more" has to
     count down as you tap. */
  function wire() {
    host.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.slider) {
        D[t.dataset.slider] = +t.value;
        // Sliders redraw their own label only. A full redraw would tear the
        // thumb out from under the pointer mid-drag.
        const out = t.parentNode.querySelector("output");
        if (out) out.textContent = money(+t.value);
        // The two budget numbers cannot cross.
        if (t.dataset.slider === "comfort" && D.maxBudget < D.comfort) D.maxBudget = D.comfort;
        if (t.dataset.slider === "maxBudget" && D.maxBudget < D.comfort) D.comfort = D.maxBudget;
        return;
      }
      if (t.id === "q-search") runSearch(t.value);
    });

    host.addEventListener("click", (e) => {
      const t = e.target.closest("[data-beds],[data-movein],[data-pets],[data-amen]," +
        "[data-prio],[data-imp],[data-kind],[data-place],[data-rmanchor],[data-commute],[data-anchormode]");
      if (!t) return;

      if (t.dataset.beds !== undefined)
        D.beds = t.dataset.beds === "null" ? null : +t.dataset.beds;
      if (t.dataset.movein) D.moveIn = t.dataset.movein;
      if (t.dataset.commute !== undefined)
        D.maxCommute = t.dataset.commute === "null" ? null : +t.dataset.commute;
      if (t.dataset.pets) {
        D.pets = t.dataset.pets;
        D.must = D.must.filter((x) => x !== "pets");
        if (D.pets !== "none") D.must.push("pets");
      }
      // Tri-state on one control: nothing -> nice -> must -> nothing.
      if (t.dataset.amen) {
        const k = t.dataset.amen;
        if (D.must.includes(k)) { D.must = D.must.filter((x) => x !== k); }
        else if (D.nice.includes(k)) { D.nice = D.nice.filter((x) => x !== k); D.must.push(k); }
        else D.nice.push(k);
      }
      if (t.dataset.imp) {
        const [k, v] = t.dataset.imp.split("|");
        D.priorities[k] = v;
        draw();
        return;                       // don't let the click fall through to the card
      }
      if (t.dataset.prio) {
        const k = t.dataset.prio;
        if (D.priorities[k]) delete D.priorities[k];
        else if (Object.keys(D.priorities).length < 5) D.priorities[k] = "high";
      }
      if (t.dataset.kind) {
        const [ic, l] = t.dataset.kind.split("|");
        D._kind = D._kind === l ? null : l;
        D._icon = ic;
      }
      if (t.dataset.rmanchor !== undefined) D.anchors.splice(+t.dataset.rmanchor, 1);
      if (t.dataset.anchormode) {
        const [i, m] = t.dataset.anchormode.split("|");
        // How you get there changes both the ranking and what we can route:
        // walking and driving are measured on the street network, transit is
        // an estimate because we have no timetable.
        if (D.anchors[+i]) D.anchors[+i].mode = m;
      }
      if (t.dataset.place) {
        const r = (window.__qres || [])[+t.dataset.place];
        if (r) {
          D.anchors.push({ icon: D._icon || "pin", label: D._kind || "Place",
                           place: r.name, lat: r.lat, lon: r.lon,
                           mode: D._kind === "Work" ? "transit" : "walk" });
          D._kind = null;
        }
      }
      draw();
    });
  }

  let searchT = null;
  function runSearch(q) {
    clearTimeout(searchT);
    const box = host.querySelector("#q-results");
    if (!box) return;
    const local = searchPlaces(q);
    show(local);
    if (q.trim().length < 4) return;
    // Only ask the network for what the local index could not answer.
    searchT = setTimeout(async () => {
      if (local.length >= 4) return;
      const remote = await geocode(q);
      if (remote.length) show(local.concat(remote).slice(0, 7));
    }, 450);

    function show(list) {
      window.__qres = list;
      box.innerHTML = list.map((r, i) =>
        `<button class="q-result" data-place="${i}"><b>${esc(r.name)}</b><small>${esc(r.sub || "")}</small></button>`).join("");
    }
  }

  function finish() {
    D.done = true;
    delete D._kind; delete D._icon;
    save(D);
    onDone(derive(D));
  }

  /* ---------- entry points ---------- */
  function open(hostEl, existing, done) {
    host = hostEl; onDone = done;
    D = JSON.parse(JSON.stringify(existing || BLANK));
    D.done = false;
    step = 0;
    if (!host.dataset.wired) { wire(); host.dataset.wired = "1"; }
    host.hidden = false;
    draw();
  }

  const LOGO_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9H4Z"/></svg>`;

  return { open, load, save, clear, derive, VERSION, LOGO_SVG, PRIORITIES, AMENITIES };
})();
