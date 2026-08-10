/* proto.js — a layout prototype for the results column.
   ============================================================
   Loads after app.js and life.js and replaces the presentation layer only.
   Every number on this page still comes from computeFit(), picks() and
   whyLow() in life.js; nothing here re-scores anything.

   What it changes, and why:

   1. The quiz is the front door. Without a profile the app shell is not
      rendered at all, so the first screen is the four questions rather than
      a dense list with a modal over it. There is no "you" to rank against
      yet, and pretending otherwise is what made the quiz feel optional.

   2. The answers stay on screen as chips, each one reopening the step that
      set it. "Always changeable" is a property of the page, not a button in
      the header, and it keeps the inputs to the score visible while you read
      the score.

   3. picks() is promoted from a row labelled "Also worth a look" to the
      answer. The six dimension bars move out of the drawer and onto it.
      That panel was the best screen in the app and it was three clicks deep.

   4. The list below collapses to compact rows behind a disclosure. The
      ~25-field hero card is gone.

   5. The thing costing you the most becomes a button. whyLow() already names
      it when a gate is responsible; where no gate is, the weakest weighted
      dimension is named instead. Both carry an exact point figure and a
      one-click change with an undo. This is the loop the app was missing:
      answers -> score -> what to change -> answers.

   Every class is prefixed px- because huntly.html already defines .chip and
   .bar for unrelated components, and an unprefixed .chip inherited
   position:absolute and stacked the whole answer row in one corner.

   Nothing is deleted from app.js: renderRecs and render are overridden, so
   the original build still works from the same sources. */

(function () {
  "use strict";

  /* ---------- styles ---------- */
  const CSS = `
  .px-ans{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:14px 0 0;
    padding:12px 14px;background:var(--card);border:1px solid var(--line);
    border-radius:var(--r);box-shadow:var(--sh)}
  .px-ans .px-lbl{font-size:11px;font-weight:680;letter-spacing:.07em;text-transform:uppercase;
    color:var(--ink-3);margin-right:3px}
  .px-c{border:1px solid var(--line);background:var(--sub);color:var(--ink);
    border-radius:99px;font-size:13px;font-weight:540;padding:5px 12px;cursor:pointer;
    display:inline-flex;align-items:center;gap:6px;white-space:nowrap;position:static}
  .px-c:hover{border-color:var(--or);color:var(--or);background:var(--or-bg)}
  .px-c.px-add{background:0;border-style:dashed;color:var(--ink-2)}
  .px-ans .px-edit{margin-left:auto;font-size:13px;font-weight:600;color:var(--or);
    background:0;border:0;cursor:pointer;padding:5px 4px;white-space:nowrap}
  .px-ans .px-undo{font-size:12.5px;color:var(--ink-2);background:0;border:0;cursor:pointer;
    text-decoration:underline;padding:5px 2px}

  .px-fresh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0;
    padding:9px 14px;background:var(--sub);border:1px solid var(--line);
    border-radius:var(--r);font-size:12.5px;color:var(--ink-2)}
  .px-fresh b{color:var(--ink);font-weight:620}
  .px-fresh .px-warn{color:var(--am)}
  .px-fresh button{margin-left:auto;border:1px solid var(--line);background:var(--card);
    color:var(--ink);border-radius:var(--r-sm);font-size:12.5px;font-weight:620;
    padding:6px 12px;cursor:pointer;white-space:nowrap}
  .px-fresh button:hover:not(:disabled){border-color:var(--or);color:var(--or)}
  .px-fresh button:disabled{opacity:.55;cursor:default}
  .px-fresh .px-paid{margin-left:0;border-style:dashed}
  .px-spin{display:inline-block;width:11px;height:11px;border-radius:50%;
    border:2px solid var(--line);border-top-color:var(--or);
    animation:px-sp .7s linear infinite;vertical-align:-1px}
  @keyframes px-sp{to{transform:rotate(360deg)}}

  .px-v{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    box-shadow:var(--sh);overflow:hidden;margin-bottom:12px}
  .px-vh{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
    color:var(--or);padding:14px 18px 0}
  .px-vt{display:grid;grid-template-columns:196px 1fr;gap:18px;padding:12px 18px 16px}
  .px-vt img{width:196px;height:150px;object-fit:cover;border-radius:var(--r-sm);
    background:var(--sub);cursor:pointer}
  .px-vt .px-noimg{width:196px;height:150px;border-radius:var(--r-sm);background:var(--sub)}
  .px-name{font-size:22px;font-weight:700;letter-spacing:-.025em;cursor:pointer}
  .px-name:hover{color:var(--or)}
  .px-meta{font-size:13.5px;color:var(--ink-2);margin-top:3px}
  .px-price{font-size:19px;font-weight:680;letter-spacing:-.02em;margin-top:9px}
  .px-price small{font-size:12.5px;color:var(--ink-3);font-weight:500;margin-left:5px}
  .px-sc{display:flex;align-items:baseline;gap:10px;margin-top:11px;flex-wrap:wrap}
  .px-sc b{font-size:44px;font-weight:730;letter-spacing:-.045em;line-height:1}
  .px-sc .px-lab{font-size:15px;font-weight:640}
  .px-sc .px-conf{font-size:12px;color:var(--ink-2);background:var(--sub);
    border-radius:99px;padding:3px 9px}

  .px-bars{border-top:1px solid var(--line-2);padding:14px 18px 5px}
  .px-b{display:grid;grid-template-columns:118px 1fr 34px;align-items:center;
    gap:11px;margin-bottom:9px}
  .px-b .px-bn{font-size:13px;font-weight:580;line-height:1.25}
  .px-b .px-bn i{display:block;font-style:normal;font-size:11px;color:var(--ink-3);
    font-weight:400;letter-spacing:.02em}
  .px-b .px-bt{height:7px;border-radius:99px;background:var(--line-2);overflow:hidden}
  .px-b .px-bt i{display:block;height:100%;border-radius:99px}
  .px-b .px-bv{font-size:13px;font-weight:640;text-align:right;
    font-variant-numeric:tabular-nums}
  .px-b.px-off .px-bn,.px-b.px-off .px-bv{color:var(--ink-3)}
  .px-b.px-off .px-bv{font-weight:500}

  .px-fix{margin:6px 18px 16px;padding:12px 14px;background:var(--or-bg);
    border:1px solid var(--or-line);border-radius:var(--r-sm)}
  .px-fix p{font-size:13.5px;color:var(--ink);line-height:1.45}
  .px-fix p b{font-weight:680}
  .px-fixrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .px-fixb{border:1px solid var(--or);background:var(--card);color:var(--or);
    border-radius:var(--r-sm);font-size:13px;font-weight:620;padding:7px 13px;cursor:pointer;
    display:inline-flex;align-items:baseline;gap:6px}
  .px-fixb:hover{background:var(--or);color:#fff}
  .px-fixb small{font-weight:500;opacity:.75;font-size:11.5px}

  .px-foot{display:flex;gap:8px;padding:0 18px 16px;flex-wrap:wrap}
  .px-foot button{border:1px solid var(--line);background:var(--card);color:var(--ink);
    border-radius:var(--r-sm);font-size:13.5px;font-weight:600;padding:9px 14px;cursor:pointer}
  .px-foot button:hover{border-color:var(--ink-3)}
  .px-foot .px-prim{background:var(--ink);color:#fff;border-color:var(--ink)}

  .px-alts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  .px-alt{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    padding:13px 15px;cursor:pointer;box-shadow:var(--sh)}
  .px-alt:hover{border-color:var(--or)}
  .px-alt .px-k{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:var(--ink-3);margin-bottom:6px}
  .px-alt .px-r{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
  .px-alt h5{margin:0;font-size:14.5px;font-weight:650;letter-spacing:-.015em}
  .px-alt .px-m{font-size:22px;font-weight:700;letter-spacing:-.03em}
  .px-alt p{font-size:12.5px;color:var(--ink-2);margin-top:5px;line-height:1.4}

  .px-more{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
    background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    padding:12px 16px;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;
    box-shadow:var(--sh);text-align:left}
  .px-more:hover{border-color:var(--ink-3)}
  .px-more span{font-weight:450;color:var(--ink-2);font-size:13px}
  .px-list{margin-top:10px}
  @media(max-width:900px){
    .px-vt{grid-template-columns:1fr}
    .px-vt img,.px-vt .px-noimg{width:100%}
    .px-alts{grid-template-columns:1fr}
  }`;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tone = (v) => v >= 0.64 ? "var(--gr)" : v >= 0.5 ? "var(--am)" : "var(--or)";
  const STRONG = 64;                       // fitLabel's "Strong match" threshold

  let showAll = false;
  let UNDO = null;
  let currentPick = null;

  /* app.js declares `sel`, `selPinned` and `SORT` with let, so they are
     lexical bindings rather than window properties. This file is concatenated
     into the same script, so bare references reach them and `window.selPinned`
     would silently read undefined. */

  /* ---------- skipping the quiz still produces a profile ----------
     The old build answered "no profile" with a second, preference-free ranking
     (matchScore, sorted by "Best match"), so the app had two scores that
     disagreed. Skipping now installs a neutral profile instead: every
     dimension medium, no gates, no hard constraint but the default budget.
     One scoring path, always, and the chips show what it assumed. */
  function installNeutral() {
    const d = JSON.parse(JSON.stringify(BLANK));
    d.done = true;
    d.v = LIFE_V;
    d.hard = { maxCost: d.budget, beds: null, wd: false };
    d.importance = deriveImportance(d);
    LIFE = d;
    saveLife();
    invalidateFit();
    SORT = "fit";
    sortMenu();
  }

  /* ---------- ?fresh — replay the first run ----------
     The quiz is deliberately once-only (QUIZ_SEEN), which makes the front-door
     experience impossible to look at twice. Loading with ?fresh clears the
     profile so the next paint is a true first run. Not the default: resetting
     on every refresh would mean retaking the quiz to glance at the list. */
  if (/[?&]fresh\b/.test(location.search)) {
    try {
      localStorage.removeItem("huntly.life.v1");
      localStorage.removeItem("huntly.quiz.seen.v1");
    } catch {}
    LIFE = null;
    invalidateFit();
  }

  /* Catches every way the quiz can close -- Skip, the ✕, and the backdrop --
     without rebinding handlers that life.js captured by value. */
  function watchQuiz() {
    const q = $("quiz");
    if (!q || q.dataset.pxWatched) return;
    q.dataset.pxWatched = "1";
    new MutationObserver(() => {
      if (!q.classList.contains("on") && !lifeOn()) { installNeutral(); render(); }
    }).observe(q, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------- shell: the quiz is the front door ---------- */
  function syncShell() {
    const on = window.LIFE_READY && lifeOn();
    const hide = (el, h) => { if (el) el.style.display = h ? "none" : ""; };
    hide($("strip"), !on);
    hide($("filterbar"), true);              // replaced by the answer row
    hide(document.querySelector(".split"), !on);
    hide(document.querySelector(".pillars"), !on);
  }

  /* ---------- the answer chips ---------- */
  function openQuizAt(step, full) {
    openQuiz(full ? { full: true } : undefined);
    window.qStep = step;
    drawQuiz();
  }

  function answerRow() {
    let el = $("px-ans");
    if (!el) {
      el = document.createElement("div");
      el.className = "px-ans";
      el.id = "px-ans";
      const split = document.querySelector(".split");
      split.parentNode.insertBefore(el, split);
      el.addEventListener("click", (e) => {
        if (e.target.closest("#px-undo")) return undoRelax();
        if (e.target.closest("#px-reset")) {
          try {
            localStorage.removeItem("huntly.life.v1");
            localStorage.removeItem("huntly.quiz.seen.v1");
          } catch {}
          LIFE = null;
          UNDO = null;
          invalidateFit();
          render();
          return openQuiz();
        }
        const b = e.target.closest("[data-step]");
        if (b) openQuizAt(+b.dataset.step, b.dataset.full === "1");
      });
    }
    if (!(window.LIFE_READY && lifeOn())) { el.style.display = "none"; return; }
    el.style.display = "";

    const L = window.LIFE, chips = [];
    const add = (label, step, full) =>
      chips.push(`<button class="px-c" data-step="${step}"${full ? ' data-full="1"' : ""
        }>${esc(label)}</button>`);

    add(money(L.budget) + " all-in", 0);
    const bed = (BED_OPTS.find((o) => o[0] === L.beds) || [, "Any"])[1];
    add(bed === "Any" ? "any beds" : bed + " bed", 2);
    for (const k of L.near || [])
      add("near " + ((NEAR_OPTS.find((o) => o[0] === k) || [, , k])[2] || k).toLowerCase(), 1);
    for (const k of L.musts || [])
      add((MUST_OPTS.find((o) => o[0] === k) || [, , k])[2] || k, 2);
    add("streets: " + ((SAFETY_OPTS.find((o) => o[0] === L.safety) || [, "somewhat"])[1]
      .toLowerCase()), 3);
    if ((L.anchors || []).length)
      for (const an of L.anchors) add(an.icon + " " + an.label, 4, true);
    else
      chips.push(`<button class="px-c px-add" data-step="4" data-full="1">+ where you go</button>`);

    el.innerHTML = `<span class="px-lbl">Ranking for</span>${chips.join("")}` +
      (UNDO ? `<button class="px-undo" id="px-undo">Undo last change</button>` : "") +
      `<button class="px-undo" id="px-reset">Start over</button>` +
      `<button class="px-edit" data-step="0">Edit all answers</button>`;
  }

  /* ---------- freshness, and refreshing on demand ----------
     The page never said when its listings were scraped, which for an app that
     cites a dataset id under every other claim was the conspicuous omission.
     build_pages.py stamps it into a meta tag; this reads it back.

     The button is deliberately the free mode. Re-sweeping the Craigslist index
     costs nothing and re-verifies liveness for the 991 listings that can be
     checked. The two Apify modes cost real money, so they only appear when the
     server was started with HUNTLY_ALLOW_PAID_REFRESH=1, and they still ask. */
  let FRESH = null;                          // /api/refresh payload
  let poll = null;

  const scrapedAt = () => {
    const m = document.querySelector('meta[name="huntly:scraped"]');
    return m ? new Date(m.content) : null;
  };

  function ago(d) {
    if (!d || isNaN(d)) return "unknown";
    const h = (Date.now() - d) / 36e5;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function freshRow() {
    let el = $("px-fresh");
    if (!el) {
      el = document.createElement("div");
      el.className = "px-fresh";
      el.id = "px-fresh";
      const ans = $("px-ans");
      ans.parentNode.insertBefore(el, ans.nextSibling);
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-mode]");
        if (b) startRefresh(b.dataset.mode);
      });
    }
    if (!(window.LIFE_READY && lifeOn())) { el.style.display = "none"; return; }
    el.style.display = "";

    const job = FRESH && FRESH.job;
    if (job && job.running) {
      el.innerHTML = `<span class="px-spin"></span>
        <span><b>${esc(job.step || "working")}</b> — ${esc(
          (FRESH.modes[job.mode] || {}).label || job.mode)}. This page reloads when it finishes.</span>`;
      return;
    }
    if (job && job.error) {
      el.innerHTML = `<span class="px-warn">Refresh failed: ${esc(job.error)}</span>
        <button data-mode="live">Try again</button>`;
      return;
    }

    // Counted from the data itself rather than trusted from a label.
    let live = 0, unknown = 0, gone = 0;
    for (const a of A) {
      if (a.avail === "live") live++;
      else if (a.avail === "unknown") unknown++;
      else if (a.avail === "gone" || a.avail === "no_units") gone++;
    }
    const paid = FRESH && FRESH.allowPaid
      ? Object.entries(FRESH.modes).filter(([, m]) => m.paid).map(([k, m]) =>
          `<button class="px-paid" data-mode="${k}">${esc(m.label)} · ${esc(m.cost)}</button>`
        ).join("")
      : "";

    el.innerHTML = `<span>Listings scraped <b>${ago(scrapedAt())}</b> ·
        <b>${n(live)}</b> verified live · <b>${n(gone)}</b> gone ·
        <span class="px-warn">${n(unknown)} unchecked (Zillow has no free liveness check)</span></span>
      <button data-mode="live">Re-check availability · free</button>${paid}`;
  }

  async function startRefresh(mode) {
    const spec = FRESH && FRESH.modes && FRESH.modes[mode];
    if (spec && spec.paid &&
        !confirm(`${spec.label} costs ${spec.cost} and takes several minutes.\n\n${
          spec.note}\n\nRun it?`)) return;
    try {
      const r = await fetch(`/api/refresh?mode=${encodeURIComponent(mode)}`,
                            { method: "POST" });
      const j = await r.json();
      if (!r.ok) { alert(j.note || j.error || "Refresh refused."); return; }
    } catch (e) {
      alert("Could not reach the local server. Is serve.py running?");
      return;
    }
    pollRefresh();
  }

  async function pollRefresh() {
    clearTimeout(poll);
    try {
      FRESH = await (await fetch("/api/refresh")).json();
    } catch { return; }
    freshRow();
    if (FRESH.job && FRESH.job.running) { poll = setTimeout(pollRefresh, 2000); return; }
    // A finished run rewrote this very file; only a reload picks up new data.
    if (FRESH.job && FRESH.job.done && !FRESH.job.error) location.reload();
  }

  /* ---------- what is costing you, and how to get it back ----------
     ungated - score is exactly what the three multiplicative gates removed,
     so that figure is arithmetic rather than an estimate. When no gate is
     responsible the drag is an ordinary weighted dimension, and the honest
     thing to name is whichever contributes the most missing weight. */
  const SAFETY_ORDER = ["dealbreaker", "alot", "some", "fine"];

  function weakestDim(f) {
    let worst = null, loss = 0;
    for (const [k, label] of DIMS) {
      const v = f.d[k];
      if (v == null) continue;
      const l = f.w[k] * (1 - v);
      if (l > loss) { loss = l; worst = [k, label]; }
    }
    return worst ? { key: worst[0], label: worst[1], loss } : null;
  }

  function relaxOptions(f) {
    const L = window.LIFE, out = [];
    const gates = [["want", f.wantGate], ["safe", f.safeGate], ["pet", f.petGate]]
      .filter(([, g]) => g != null && g < 0.97).sort((a, b) => a[1] - b[1]);
    const top = gates[0] && gates[0][0];

    if (top === "want" && (L.near || []).length) {
      const k = L.near[0];
      const lbl = ((NEAR_OPTS.find((o) => o[0] === k) || [, , k])[2] || k).toLowerCase();
      out.push({ label: `Stop requiring ${lbl}`,
                 apply: (p) => { p.near = (p.near || []).slice(1); } });
    }
    if (top === "safe") {
      const i = SAFETY_ORDER.indexOf(L.safety || "some");
      if (i >= 0 && i < SAFETY_ORDER.length - 1) {
        const next = SAFETY_ORDER[i + 1];
        const lbl = (SAFETY_OPTS.find((o) => o[0] === next) || [, next])[1].toLowerCase();
        out.push({ label: `Ease streets to "${lbl}"`,
                   apply: (p) => { p.safety = next; p.streetMatters = next === "alot"; } });
      }
    }
    if (top === "pet")
      out.push({ label: "Drop the pet-friendly requirement",
                 apply: (p) => { p.musts = (p.musts || []).filter((m) => m !== "pets"); } });

    // Budget is always offered: it is the one lever that adds listings rather
    // than only re-weighting the ones already here.
    const bump = 300;
    out.push({
      label: `Raise budget to ${money(L.budget + bump)}`,
      apply: (p) => {
        p.budget = p.budget + bump;
        p.hard = Object.assign({}, p.hard || {}, { maxCost: p.budget });
        delete p.price;
      },
    });
    return out.slice(0, 2);
  }

  /* Re-score the listings on screen under a hypothetical profile. Counted
     against the same set the reader is looking at, and worded that way on the
     button -- a projection over all 2,547 would be a number they cannot check. */
  function project(list, apply) {
    const snapshot = JSON.stringify(window.LIFE);
    let strong = 0, best = 0;
    try {
      const draft = JSON.parse(snapshot);
      apply(draft);
      draft.importance = deriveImportance(draft);
      window.LIFE = draft;
      invalidateFit();
      for (const a of list) {
        const f = fit(a);
        if (!f || f.score == null || f.blocked) continue;
        if (f.score >= STRONG) strong++;
        if (f.score > best) best = f.score;
      }
    } finally {
      window.LIFE = JSON.parse(snapshot);
      invalidateFit();
    }
    return { strong, best };
  }

  function tally(list) {
    let strong = 0, best = 0;
    for (const a of list) {
      const f = fit(a);
      if (!f || f.score == null || f.blocked) continue;
      if (f.score >= STRONG) strong++;
      if (f.score > best) best = f.score;
    }
    return { strong, best };
  }

  function applyRelax(idx) {
    const opt = relaxOptions(fit(currentPick))[idx];
    if (!opt) return;
    UNDO = JSON.parse(JSON.stringify(window.LIFE));
    const draft = JSON.parse(JSON.stringify(window.LIFE));
    opt.apply(draft);
    draft.importance = deriveImportance(draft);
    window.LIFE = draft;
    saveLife();
    invalidateFit();
    selPinned = false;
    render();
  }

  function undoRelax() {
    if (!UNDO) return;
    window.LIFE = UNDO;
    UNDO = null;
    saveLife();
    invalidateFit();
    selPinned = false;
    render();
  }

  /* ---------- the verdict ---------- */
  function barsHTML(f) {
    return `<div class="px-bars">` + DIMS.map(([k, label]) => {
      const v = f.d[k], w = Math.round(f.w[k]);
      if (v == null)
        return `<div class="px-b px-off"><div class="px-bn">${label}<i>nothing on file</i></div>
          <div class="px-bt"></div><div class="px-bv">n/a</div></div>`;
      const pct = Math.round(v * 100);
      return `<div class="px-b"><div class="px-bn">${label}<i>weight ${w}</i></div>
        <div class="px-bt"><i style="width:${pct}%;background:${tone(v)}"></i></div>
        <div class="px-bv" style="color:${tone(v)}">${pct}</div></div>`;
    }).join("") + `</div>`;
  }

  function fixHTML(f, v) {
    const lost = (f.ungated != null && f.score != null) ? f.ungated - f.score : 0;
    if (lost < 3 && f.score >= STRONG) return "";

    const why = whyLow(f);
    let line;
    if (why && lost >= 3)
      line = `${esc(why)} It takes <b>${lost} point${lost === 1 ? "" : "s"}</b> off this one.`;
    else if (lost >= 3)
      line = `Your answers gate <b>${lost} point${lost === 1 ? "" : "s"}</b> off this listing.`;
    else {
      const w = weakestDim(f);
      line = w
        ? `Nothing is gated here — <b>${esc(w.label)}</b> is simply the weakest of the six above, and it carries the most weight you are losing.`
        : `This is as close as your answers get in this city.`;
    }

    const now = tally(v);
    const opts = relaxOptions(f);
    const btns = opts.map((o, i) => {
      const p = project(v, o.apply);
      const d = p.strong - now.strong;
      const note = d > 0 ? `+${n(d)} strong`
                 : p.best > now.best ? `best rises to ${p.best}`
                 : d < 0 ? `${n(d)} strong` : "no change";
      return `<button class="px-fixb" data-relax="${i}">${esc(o.label)}
        <small>${note}</small></button>`;
    }).join("");

    return `<div class="px-fix"><p>${line}</p><div class="px-fixrow">${btns}</div></div>`;
  }

  function verdictHTML(a, f, v) {
    const act = a.act ? a.act[0] : a.rent;
    const hi = a.act && a.act[1] !== a.act[0] ? a.act[1] : null;
    return `<div class="px-v">
      <div class="px-vh">Your best match</div>
      <div class="px-vt">
        ${a.photo ? `<img src="${esc(a.photo)}" alt="" data-open="${esc(a.id)}" loading="lazy">`
                  : `<div class="px-noimg"></div>`}
        <div>
          <div class="px-name" data-open="${esc(a.id)}">${esc(a.addr)}${
            a.unit ? " #" + esc(a.unit) : ""}</div>
          <div class="px-meta">${esc(a.hood || "San Francisco")} · ${bedTxt(a.beds)}${
            a.sqft ? " · " + n(a.sqft) + " sqft" : ""}</div>
          <div class="px-price">${money(act)}${hi ? "–" + money(hi) : ""}
            <small>estimated monthly, all in · ${money(a.rent)} listed</small></div>
          <div class="px-sc"><b style="color:${fitTone(f.score)}">${f.score}</b>
            <span class="px-lab" style="color:${fitTone(f.score)}">${f.label}</span>
            <span class="px-conf">${f.conf} confidence · ${f.ev} of 7 known</span></div>
        </div>
      </div>
      ${barsHTML(f)}
      ${fixHTML(f, v)}
      <div class="px-foot">
        <button class="px-prim" data-open="${esc(a.id)}">See everything about this place</button>
      </div></div>`;
  }

  function altsHTML(p) {
    const alt = p.filter((x) => x.a.id !== (currentPick && currentPick.id)).slice(0, 2);
    if (!alt.length) return "";
    const MED = { "Best value": "💰", "Best apartment": "✨", "Best overall": "🥇" };
    return `<div class="px-alts">` + alt.map((x) => `<div class="px-alt" data-open="${esc(x.a.id)}">
      <div class="px-k">${MED[x.kind] || ""} ${esc(x.kind)}</div>
      <div class="px-r"><h5>${esc(x.a.addr)}${x.a.unit ? " #" + esc(x.a.unit) : ""}</h5>
        <span class="px-m" style="color:${fitTone(x.f.score)}">${x.f.score}</span></div>
      <p>${esc(x.line)}</p></div>`).join("") + `</div>`;
  }

  /* ---------- render ---------- */
  function protoRender() {
    watchQuiz();
    syncShell();
    answerRow();
    freshRow();
    if (!(window.LIFE_READY && lifeOn())) return;

    const v = visible();
    indexRanks(v);
    const list = $("results");

    const pinned = selPinned ? v.find((a) => a.id === sel) : null;
    const best = v.find((a) => { const f = fit(a);
                                 return f && !f.blocked && !a.shared && !hasFlags(a); })
              || v.find((a) => { const f = fit(a); return f && !f.blocked; }) || v[0];
    const pick = pinned || best;
    currentPick = pick;
    if (pick) sel = pick.id;

    const p = pick ? picks(v) : [];
    const rest = v.filter((a) => a.id !== sel);
    const shown = showAll ? rest.slice(0, 60) : [];

    list.innerHTML =
      (pick ? verdictHTML(pick, fit(pick), v) : "") +
      altsHTML(p) +
      (v.length === 0 ? `<div style="background:var(--card);border:1px dashed var(--line);
          border-radius:10px;padding:44px 24px;text-align:center;color:var(--ink-2)">
          <p style="font-size:17px;font-weight:620;color:var(--ink);margin-bottom:7px">
          Nothing clears your answers</p>
          <p style="font-size:14px">Ease one of the chips above and this fills back in.</p>
          </div>` : "") +
      (rest.length ? `<button class="px-more" id="px-more">
          <span style="font-weight:600;color:var(--ink)">${showAll
            ? "Hide the full list" : `See the other ${n(rest.length)} matches`}</span>
          <span>${showAll ? "" : "ranked by the same six numbers"}</span>
        </button><div class="px-list">${shown.map(rowCard).join("")}</div>` : "");

    $("mapcount").textContent = `${n(v.length)} apartments · ${n(A.length)} tracked`;
    strip();
    drawMap(); placePins();

    const mt = $("px-more");
    if (mt) mt.onclick = () => { showAll = !showAll; render(); };
    list.querySelectorAll("[data-relax]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); applyRelax(+b.dataset.relax); };
    });
  }

  /* Override rather than delete, so the original build still works. */
  window.renderRecs = function () { const el = $("recs"); if (el) el.innerHTML = ""; };
  window.render = protoRender;

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", protoRender);
  else protoRender();

  // Picks up allowPaid and any run left in flight from a previous page load.
  pollRefresh();
})();
