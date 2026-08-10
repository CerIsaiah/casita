# Casita — interview presentation

Filled-in version of the outline. Every number is pulled from the repo.

**Two changes to the running order.** Problem before architecture — the
architecture slide lands much harder once they already want the thing. And a
closing slide on what I *refused* to build, which was missing and is the
strongest signal in the deck.

---

## 1. What it is

> **Casita — the apartment hunter that shows its work.**
>
> Every SF rental worth looking at, ranked against what *you* said mattered,
> with every number traced back to the city record it came from.

On "the safest, funniest apartment hunter" — I'd drop both words from the
headline.

- *Safest* is a claim about outcomes I can't back, and my own market research
  turned up the cautionary tale: **Zillow pulled First Street's climate scores
  off its listings in Nov 2025** after CRMLS challenged their accuracy, the CEO
  conceding the predictions "ended up being very wrong" on California flooding.
  A risk-scoring product got removed from the largest portal in the country for
  being wrong. That's the failure mode I designed against — so I shouldn't lead
  with the adjective that invites it.
- *Funniest* is real in the voice, but it's a delivery mechanism, not a
  differentiator. Show the humor; don't claim it.

What's left is the actual thesis, and it's sharper: **a score you can't
interrogate is a horoscope.**

---

## 2. Find an actual problem

Qualitative first — conversations with my girlfriend and friends who'd hunted in
SF recently. Nobody's problem was "I couldn't find listings." It was *"I
couldn't tell which ones were real, and I couldn't tell what I'd be walking out
my front door into."*

Then I measured it. One full scrape: **2,867 raw listings** — Craigslist 1,493,
Zillow 876, Apartments.com 498 — collapsing to **2,603** canonical apartments.

| What the data says | Number |
| --- | --- |
| Listings appearing on more than one source | **87 of 2,589 (3%)** |
| Publishing only a neighborhood centroid, not an address | **1,268 (49%)** |
| No stated pet policy at all | **1,179 (46%)** |
| Availability not confirmable | **806 (31%)** |
| 4+ photos and *zero* unit-level facts | **929 (35%)**, 909 of them Craigslist |
| No photos at all | **70**, 63 of them Craigslist |

Those rows *are* the problem statement, and they beat a survey because they came
from the market rather than from people's memory of it.

- **3% overlap means no single site substitutes for the others.** That's the
  four-open-browser-tabs problem, quantified.
- **Half the market won't tell you where it is.** Any product that draws
  confident pins is lying about half its inventory.
- **A third of listings are a building's brochure, not a unit.** Four photos and
  nothing you could verify.

⚠️ **On the Reddit slide:** I don't have the artifact — no scrape, no thread
list, no coded top-20 anywhere in the repo. Either I run it before the interview
and show the output, or I cut the claim and lead with this table, which is
stronger evidence anyway. What I shouldn't do is describe research I can't
produce on request.

---

## 3. Market research

Full writeup: `research/sf-data-inventory.md` — 34KB, every dataset ID verified
against a live API, contradictions flagged rather than resolved.

**Every official listing feed is a dead end.** Zillow Group's Rentals Feed is
*inbound only* — it exists so property managers can syndicate *into* Zillow.
Rentberry has no API. Realtor.com and Rent. are the same shape. So managed
scrapers or scraping infrastructure are the only paths. That's a finding, not an
excuse.

**Prior art, and what it leaves open:**

| Product | Status | Gap |
| --- | --- | --- |
| rentcontrolchecker.com | Live, closed source, cites dataset `wv5m-vpq2` | Address in, one answer out. Doesn't start from a listing. |
| Evictorbook (Anti-Eviction Mapping Project) | Live. Landlord shell webs — Veritas 499 associated businesses, Mosser 263 | Sources owner names from the Assessor directly. A research tool, not a search tool. |
| "Am I Rent Controlled" | **Never existed.** Both domains NXDOMAIN; three empty Wayback stubs from 2018 | — |
| **Localize.city** | **Shut down 19 Aug 2024.** ~$70M raised, not acquired. **Never covered SF** — NYC and Chicago only | The closest thing to this that has ever existed, and it's gone. |

I pulled Localize's actual insight taxonomy out of its frozen SSR payload
(`window.__SSR_HYDRATED_CONTEXT__`) rather than its marketing. Three decisions
worth stealing, and I did:

1. Its page header was literally **"The truth you should know."** Same thesis.
2. **Insights were two-sided** — each carried `goodTradeoff: true|false`, so
   `BRIGHT & SUNNY` sat beside `LESS NATURAL LIGHT`. Not a negativity engine.
   Casita's "Why you'd like it" / "Good to know" split is this.
3. It surfaced **~8 insights out of 20–30 computed.** They'd already solved
   "don't hand someone a 20-score dashboard."

**The 2026 landscape is fragmented single-signal vendors** — Redfin Sunscore
(launched May 2026, SF-covered), Shadowmap, HowLoud (noise), Local Logic (18
scores), First Street (climate). Each sells one number into someone else's
portal.

**Confirmed gap: nothing in 2026 assembles a Localize-style unified layer for
San Francisco.** Per-building permits, violations, 311 complaints, truck routes,
approved-but-unbuilt development — all public SF data, and no consumer product
combines them.

Licensing mattered because this lives in an MIT repo: `nycdb` is AGPL, JustFix's
`who-owns-what` is GPL, most Anti-Eviction Mapping Project repos are unlicensed.
**Read them for method; don't vendor them.** The one safely reusable analogue is
`writingdeveloper/rentrights` (MIT).

---

## 4. Marketability — the differentiator

Everyone else ships **a number**. Walk Score 87. Sunscore 62. Casita ships **a
number that decomposes into sentences you can check.**

Three things nobody else does starting from a listing:

**1. A rent-control verdict per listing.** 1,225 yes / 589 maybe / 642 no. A
pure decision tree over the assessor roll, and every branch ships its own prose:

> *"Built 1907, 97 units, not a condo. Meets the SF Rent Ordinance test for price
> control and just-cause eviction protection."*
>
> *"First occupied 1994, after the 13 June 1979 cutoff — so rent increases aren't
> capped. Just-cause eviction protection still does apply."*

**2. A deal auditor that cross-examines cheap listings** (`deal.js`). It doesn't
score cheapness — it asks whether the price hangs together, across three
ledgers: **concerns** (facts contradicting each other), **explanations**
(legitimate reasons the price could be low), **corroboration** (independent
evidence the place exists as described).

```js
const weight = high * 2 + med;                       // weighed, not counted
if (high >= 2 || weight >= 4)                       verdict = "suspect";
else if (cheap && weight >= 2)                      verdict = "check";
else if (cheap && !high && corroborates.length >= 3) verdict = "bargain";
```

The strongest single check is `below_building` — cheaper than 0.7× the median of
other same-bedroom units *at the same address*. Two concerns cite law directly:
pet deposit over one month's rent (CA Civil Code §1950.5 as amended by AB 12),
and wire/Zelle/crypto payment requests (FTC).

And the rule that makes it defensible:

> *"No photos, and the rent is 38% under the median for a 1-bed in this
> neighbourhood" is a finding. "This is a scam" is a legal conclusion about a
> person, and it is not ours.*

**3. A trust panel per listing** — "Address matches a real building on the city
parcel map" / "Photos are unique to this listing" / "Rent is in a normal range
for its size", plus warnings. 783 high / 1,693 medium / 113 low. Photo reuse is
the sharpest signal in it: *"the classic rental scam is stolen photography. Same
image on two different buildings is the single strongest signal available."*

**On virality:** the shareable object here is a *verdict*, not a listing. "This
$1,600 Nob Hill one-bed is rent-controlled, built 1907, and sits on a block in
the 96th percentile for encampment reports" is a screenshot people forward. A
listing card isn't. I'd measure share-per-detail-view before claiming more.

---

## 5. A few deliberate design choices

**The framing that makes this section land: I built the obvious version first,
and it failed.** `huntly.html` is in the repo — search box, six filter
dropdowns, a sort menu, a scrolling column of 2,547 listings, and a permanent
map with six layer toggles. Casita is the rewrite, and `build_pages.py` says why
it's a separate page rather than a restyle:

> *"It is a different product, not a different stylesheet: the quiz is the front
> door, the score exists to hide information rather than to rank a list, and the
> right-hand panel stops being a map whenever the question stops being
> geographic."*

And on the old build:

> *"It showed everything it knew, which is the same as deciding nothing."*

Everything below follows from that.

### Quiz first, and no search bar

> *"A new renter does not see apartments first. They see this. That is not a
> courtesy, it is the architecture: every number on the next screen is an answer
> to 'is this good for* you*', and until someone has said what they want, there
> is no 'you' to answer for."* — `quiz.js`

Huntly had the quiz behind a header button, so the default experience was *"a
generic list wearing a personal one's clothes."* In Casita the app shell is
`hidden` until the quiz completes. Moving it to the front door was the single
highest-leverage change.

Six screens: budget (comfortable + absolute max) → basics (beds, move-in, pets)
→ amenities (tap once = nice, twice = must) → **priorities (pick 3–5, rate each
nice / important / very important)** → life anchors (work, gym, grocery,
partner, school, favorite spot, + a commute ceiling) → tradeoffs (quiet↔lively,
location↔space, character↔newer).

Two hard constraints on what may be asked:

- **Only housing.** Never age, income bracket, household makeup, or anything
  standing in for a protected trait. *"'I want to be near the bars' is a housing
  preference; '24 and single' is a demographic proxy for the same answer, and it
  does not belong in a rental product."* That's a fair-housing hazard, not a
  style preference.
- **Nothing collected that isn't read.** *"The question that would be nice to
  have but changes nothing is the question that makes a quiz feel like a
  settings form."* One `derive()` function translates answers into the fields
  scoring reads, so a question can't be collected and quietly ignored.

Only amenities the sources can actually answer appear: *"There is no parking,
elevator or doorman field in any of the three sources, and a pill that can never
be confirmed is a promise the results page would have to break."*

**No search bar** because the quiz already collected the constraints. A text box
is a second, worse way to say the same thing, and it reintroduces exactly the
failure I removed. Hard limits (max budget, beds, commute ceiling) are walls,
not query strings.

**No infinite scroll.** `SHOW = 60`, one apartment on screen at a time, with a
finite filmstrip of alternatives. One unit per building, because *"five ads for
1222 Harrison St in a row is not a shortlist, it's the same decision five
times."*

### No price map

1. **49% of the corpus publishes only a neighborhood centroid.** Every listing
   carries `loc: {level, why, moved_m}` — `exact` 1,278, `neighbourhood` 1,268,
   `title_address` 37, `building_name` 6. A price map renders all of them as
   equally confident pins, and nothing on screen would say otherwise.
2. It ranks by the one number the listing is most confident about and the renter
   is least informed about.
3. It invites comparison across blocks that aren't comparable.

The map survives only where it's honest — routes, dog-walk loops, night-noise
surface, and four *separately named* street-incident layers. `mapkit.js`: *"This
is a map only some of the time… four of the five answers are not 'where is
it'."* The Residents and "Is it real?" tabs aren't maps at all. Cost lost its
panel entirely: *"the breakdown table was answering a question the card already
answers in one line."*

Related: the card **will not render an inferred address as a published one.** If
the pin is neighborhood-only it says "1-bed in Mission" — *"rendering an
inferred address in the same type as a published one is the most confident lie
this interface was telling."*

### Best match — how the fit score works

`factors.js`, five rules in the order scoring applies them:

1. **Hard requirements are walls, not weights** — but *unknown is not failure.*
   Requirements have three states, never two. A listing that never published its
   A/C status hasn't failed an A/C requirement; it needs verification. Scoring it
   as failure punishes the ads that published *more*.
2. **Percentiles against this renter's own search**, not absolute grades. "Quiet
   89" = quieter than 89% of what this person is actually choosing between.
   *Nobody gets to rent the abstract ideal.*
3. **Importance comes from the quiz and stays out of the interface** — never a
   weight, a percentage, or a slider labelled 0.35. Internally: `vhigh 3.2 /
   high 2.1 / nice 1.2`, unpicked `0.32`.
4. **Baseline quality still counts.** Someone who picked only gym and commute
   must not be handed a building with a wall of unresolved violations. Notably,
   the un-askable "is this listing real" factor carries **1.7** — *more than a
   nice-to-have quiz pick* — *"because nobody thinks to ask for it and everybody
   wants it."*
5. **Anomalies override the quiz**, surfaced with their source rather than
   silently priced into a number.

Underneath all five, **confidence**: `adj = c·pct + (1−c)·50`. Thin evidence is
pulled toward neutral rather than trusted or punished. *Missing data is missing,
not bad.* This costs the top of the field its ceiling, and it's worth it — the
alternative rewards the listings we know least about.

Three worked examples of that principle:

- **Ratings are Bayesian-shrunk** with a prior of 10 — only 23% of listings
  carry a rating at all.
- **Management** (DBI violations per unit) has confidence scaled by building
  size: a clean record on 4 units is trusted less than on 200.
- **Freshness is normalised out of the denominator** for Zillow rather than
  scored as stale, because Zillow publishes no date. *"Punishing Zillow for what
  Zillow declines to publish would quietly re-rank the whole list on a fact
  about the source."*

Dogs is the one all-or-nothing factor (2.4 or 0): *"for the people it applies to
it is most of the decision, and for everyone else it is noise."*

Two bugs worth telling, because they're what made the score usable:

- **The cost veto.** A good percentile can't be headlined as a strength if it's
  over budget — *"a listing $235 over the renter's own comfortable number was
  headlined as a reason to like it."*
- **Anchors beat proximity.** Gym and grocery score against the specific place
  you pinned, not the nearest one — *"a listing four minutes from a gym they will
  never go to, sitting next to a 127-minute line to the gym they will."*

### Crime and street conditions

Deliberately **not** a safety score. Four city datasets kept separate and named,
*"because those scores are routinely criticised for encoding bias, and they also
just tell you less — a block with car break-ins and a block with encampment
reports are different problems."*

```js
const crime  = 100 - (violent * 0.55 + break_in * 0.45);
const upkeep = 100 - (encampment * 0.7 + cleaning * 0.3);
return crime * 0.8 + upkeep * 0.2;
```

The 80/20 tilt is the part I'd defend hardest:

> *"A car break-in is a thing that happens TO you and costs you a window and a
> laptop; an encampment report is a 311 call about the condition of a street, and
> it is as often a report about someone else's hardship as about any risk to the
> person reporting it. Treating those as comparable overweighted the complaint
> and underweighted the theft."*

Plus a coverage correction: 5% of listings sit near fewer than ~90 reports
against a city median of 1,082, and *"swept the top of every safety-first
ranking purely by having nothing on file."* Thin blocks get pulled toward the
median.

### How I scraped — three sources, one paid

| Source | Technique | Cost |
| --- | --- | --- |
| **Craigslist** (1,493) | Its own JSON API, `sapi.craigslist.org/web/v8/postings/search/full` | **free** |
| **Zillow** (876) | `__NEXT_DATA__` off ordinary search pages | **free** |
| **Apartments.com** (498) | Apify actor `epctex/apartments-scraper-api` | **~$0.001/property** |

Each choice has a reason:

- **Zillow's JSON endpoint is behind PerimeterX, but its ordinary search pages
  embed the same listing data in `__NEXT_DATA__`.** Zillow caps a search at ~800
  results, so I recursively halve the price band until every band fits.
- **Craigslist:** the Apify actor stalled around 200 items per run because it
  crawls detail pages and gets throttled. The site's own API hard-caps a response
  at 360 but *reports the true total for any filter* — so bisect on price until
  every band fits under the cap. **Complete coverage, no cost.** The response is
  delta-encoded; decoding the posting timestamp correctly gave me the only real
  posting date any of the three sources publishes.
- **Apartments.com is the one thing I pay for, and the reason is the honest
  one:** *"That one worked, but it asked apartments.com for 477 pages at roughly
  one a second and **Akamai blocked the whole client** — including ordinary
  browsing. Paying an actor that maintains its own scraping infrastructure is the
  honest way to get this."*
- **Pet policy comes from the search *filter*, not the listing text** —
  `pets_dog=1` / `pets_cat=1` as three set sweeps, membership is the answer.
  *"Far more reliable than reading 'dogs ok' out of free text."*

### No LLM anywhere in the pipeline

Worth saying out loud, because it's the choice people expect me to have made the
other way. Zero calls to any language model. Every claim is regex, set
arithmetic, a spatial join, or a median — which is *why* every claim can name
its source record. Reviews are quoted, never summarized: *"These are people's own
words about a place they lived; summarising them into a verdict would put words
in their mouths."*

---

## 6. Demo, and how you run it yourself

```bash
cp .env.example .env           # APIFY_API_TOKEN=...
./research/refresh.sh          # scrape → merge → enrich → build
python3 research/serve.py      # http://127.0.0.1:8799
```

First run builds `city.sqlite` (91MB) from DataSF — free, ~5 minutes, no token,
no key.

Anything absent last run shows as **"New to you"**; anything cheaper than when
you last looked shows as a **price drop**. Both are computed in your browser
against what *you* actually saw, so neither is simulated.

---

## 7. Architecture

Two layers, and the split is the whole cost story.

**Offline Python pipeline** (`refresh.sh`, ~29 scripts): scrape 3 sources →
merge and dedup → enrich against a local `city.sqlite` built from **8 SF open
datasets** → emit one `app_data.json` (2,589 records, 7.1MB).

**Static client**: no server at runtime. `quiz.js` writes a profile to
`localStorage`; `factors.js` rebuilds the percentile tables and recomputes the
fit score **in the browser** against the current result set. That's why two
people open the same file and see different screens, and why there's no per-user
backend to run. No web fonts, no API keys in the page, works from `file://` —
*"a web font would be a request that fails on the one machine that matters."*

`serve.py` is a local proxy, not an app server, and exists for one reason:

> *"The RentCast key never reaches the browser, and the monthly cap is enforced
> here rather than in client code, so a bug in the page cannot run up an overage
> bill."*

Same reasoning gates paid refreshes behind `CASITA_ALLOW_PAID_REFRESH=1` — *"a
stray double-click must not be able to spend Apify credit."*

**Routing.** The upstream repo learned this the expensive way: an in-DB Routes
API cache that got discarded on every publish re-paid the full matrix each time
— **~$200 in 3 days**. So this build has no Google Maps at all. Basemap is CARTO
Positron (free, keyless). `build_walk_graph.py` pulls OSM footways once and
**contracts the city to its junctions** — *"routing only needs decisions, and a
decision only happens at a junction"* — taking ~500,000 vertices down to ~40,000,
quantised to uint16 offsets. One free fetch, shipped as a static file, then
unlimited A* in the browser at zero marginal cost.

### The cross-cutting theme I'd actually lead the architecture slide with

**A gap in the data must never be indistinguishable from a negative finding.**

Six independent scripts have an explicit refuse-to-write guard, each with a real
incident behind it:

| Script | The incident |
| --- | --- |
| `craigslist_pets.py` | A transient 503 must not become "this landlord won't take pets" — a partial sweep is discarded, not published |
| `add_places.py` | The park query 504'd, the script printed "park 0" and shipped **a city with no parks in it** |
| `add_street.py` / `add_street_stats.py` | A Socrata outage left an empty-but-present table, which became `street={}` on all 2,547 listings — *"silently, with a clean exit code"* |
| `atomicjson.py` | Five scripts rewrite `app_data.json` in place; `open(path,'w')` truncates immediately, and the only recovery is a re-scrape that costs money |
| `add_availability.py` | 803 Zillow listings carry no availability signal and are marked `unknown` — *"a green tick we did not earn is worse than an honest blank"* |

---

## 8. Could this run indefinitely?

| Line item | Cost |
| --- | --- |
| DataSF — 8 datasets, the whole city layer | **$0**, no app token |
| OSM places + walk graph (Overpass) | **$0**, keyless |
| CARTO basemap tiles | **$0**, keyless |
| Craigslist + Zillow ingestion | **$0** |
| Apartments.com via Apify | **~$0.001/property** — measured billed runs on 2026-08-09: **$0.11 and $0.40** |
| RentCast owner lookups | 50/mo free, $0.20 after — capped server-side, cached forever, never batched |

**Honest answer: yes at personal scale, no as a free public product.** A full
refresh costs well under a dollar; Apify's free tier ($5/mo recurring, no card)
covers a daily personal search. It does not cover full-market sweeps for
strangers.

That constraint is *why* the architecture looks like this — precompute offline,
ship a static file, do all personalization in the browser. **The cost ceiling
picked the design.**

**Known fragility:** Zumper. The only maintained Apify actor has **173 lifetime
runs and a 1.00★ rating**, so I budgeted for it failing and shipped without it.
(Also: trust `totalRuns`, not `modifiedAt` — Apify bumps that on any build, so it
proves "not abandoned," not "recently fixed.")

---

## 9. Testing — how do I know the ranking is right?

Lead with the honest framing: **there is no ground truth for "best apartment,"
so I can't test the ranking's correctness.** What I *can* test separates into
three things, and conflating them is how these products get into trouble.

### (a) Are the inputs joined correctly? — the real bugs live here

The trap I verified end to end:

> `blklot` is the **legal** lot — every condo unit gets its own. `mapblklot` is
> the **physical** parcel. DBI complaints, permits and violations are filed
> against the *physical* parcel.
>
> 1380 Greenwich St is a condo, legal lot `0501052`. Querying DBI complaints for
> `parcel_number='0501052'` returns **zero rows** — a spotless building. Its
> `mapblklot` is `0501038`; that query returns the building's **three real
> complaints.**

Getting this wrong doesn't error — it silently renders a clean bill of health.
Same class of bug, found and fixed:

- **`mark_fuzzy()`.** The Craigslist adapter hardcoded `mapAccuracy: 22`, so the
  `acc < 10` test downstream *could never fire* — **not a single listing was ever
  flagged, and half should have been.** A fuzzed pin was being matched to
  whichever building sat nearest the centroid, and that match then fed walking
  times, the 250m street statistics, and a green tick reading "Address matches a
  real building on the city parcel map." Replaced with two real tells; on a fresh
  sweep, **436 Craigslist rows** sit on a coordinate carrying 2+ distinct
  addresses, against **27** from Apartments.com.
- **Multi-lot buildings.** Geary Courtyard is 639 Geary St on *both* `0318021`
  (46 violations, units=1) and `0318022` (0 violations, units=164) — **and the
  tie broke toward clean.**
- **Wrong join key.** Building-level reviews keyed on parcel instead of address
  left the same building showing 3.9 on one ad and 3.1 on another.
- **Unsourced ratings.** 296 listings carried a flat 5★ while their Google score
  said otherwise.

### (b) Does the ranking do what I said it does?

Not "is #1 correct" — "does the model behave as specified." Two changes I made
because it didn't:

- **755 O'Farrell** scored 23rd percentile on street conditions — full
  confidence, all four city datasets reading "higher" — for a renter who called
  street conditions important, **and still ranked 97th.** One bad factor among
  fifteen barely moves a mean. *"That is the mean working as designed and the
  design being wrong."* Fix: a picked factor in the bottom third *multiplies* the
  score down, with the floor set by stated importance (`vhigh 0.55 / high 0.68 /
  nice 0.85`).
- **Then the fix was wrong too.** Multiplying *every* picked factor **fired on
  79% of the field** — with four priorities most listings are in the bottom third
  of at least one, and stacking three 0.9s is a 27% penalty for being
  unremarkable. Median composite collapsed **49 → 34**: *"a level shift rather
  than a distinction, which is the same defect as a check that is always true."*
  Final: only the single worst picked factor gates, nothing stacks, engages only
  below the 30th percentile.

### (c) Can every number be explained?

The actual acceptance criterion: *if a reason can't be stated in a sentence with
a number in it, it doesn't get to affect the score.* Testable by inspection on
any listing, and it's what the "Why this score?" modal exists to prove.

### The gap I'd name out loud

**There is no automated test suite for this pipeline.** In order, I'd write: the
`mapblklot` join test; the percentile function including the tied-run midpoint
(so identical blocks share a rank rather than one arbitrarily outranking the
other); and the deal-verdict thresholds against ~50 hand-labeled Craigslist
listings.

*(I used ChatGPT early to pressure-test which factors I was missing. Worth one
sentence, not a slide — it generated candidates, it didn't validate anything.)*

---

## 10. What I refused to build

- **"Your bedroom faces a major road."** Requires room orientation within a
  unit. That data doesn't exist publicly and floorplans are rarely posted. DBI
  complaints are building-level: I can say *"this building has 7
  water-intrusion complaints,"* not *"your bathroom."* Either scope to
  building-level claims or **you're inventing detail.** I scoped.
- **Per-building eviction history.** SF eviction notices and Rent Board
  petitions are published **block-redacted** — `"2000 Block Of Polk Street"` with
  a centroid. It's a block-level signal that can *never* be attributed to a
  specific building or owner. Rendering it per-building would have looked great
  and been false.
- **A blended safety score.** Four incomparable series. *"Adding them would
  manufacture a scientific-looking score out of four incomparable series."*
- **Nightlife from the city's own entertainment permits.** They don't mean what
  the name suggests — *"'Extended Hours Premises' is a licence to trade late,
  and it is held by Silvercrest Donuts, The Mosser Hotel and SOMArts Cultural
  Center as readily as by a club. Scoring a party block off those alone put
  donut shops in the numerator."* Switched to OSM: **"OSM says bar when it means
  bar."**
- **Landlord names in the public tree.** Owner lookups pull third-party personal
  data out of public records — lawfully public, but belonging to identifiable
  people who didn't opt in, and `ownership_name` is frequently a natural person
  rather than an LLC. I added a "Landlord and public-records data" section to
  `AGENTS.md` making owner names live-path-only behind env vars, requiring
  synthetic landlords in the demo fixture, and forbidding model-generated
  allegations about a named person. I also `.gitignore`d the built demo pages,
  because each inlines the full dataset including those names.
- **And I found the repo's own leak validator is weaker than it looks:**
  `scripts/validate_public.py`'s `PERSONAL_NAME_PATTERN` matches only two
  hardcoded names and **would not catch a real landlord name leaking into a
  fixture.**

Which brings it back to the First Street removal. A data-driven risk score got
pulled from the largest portal in the country for being wrong in California.
**Attribution and calibration aren't polish on this product — they're its
survival condition.** That's why every claim carries its source, why unknown
never counts as failure, and why the list above exists.

---

## Loose ends to close before presenting

Small, and better volunteered than discovered:

1. **`charVsNew` (Character ↔ Newer) and `moveIn` are collected and never
   read** — the one violation of the quiz's own "nothing collected that is not
   read" rule. Wire them or cut them.
2. **`router.js` is complete but not wired into any build.** Every distance in
   the shipped demo is still straight-line × 1.30. If asked to demo real
   routing, it won't. Either wire it or present it as in-progress.
3. **`refresh.sh --quick` is dead code** — `scrape_all.py` never reads the
   `QUICK` env var, so both invocations do identical work for identical money.
   And the "~$3–4" figure in the header is an estimate the measured runs
   ($0.11, $0.40) contradict. Fix the header before anyone reads it.
4. **Be ready to re-derive the numbers.** Several of the strongest lines here
   (79% of the field, 49→34, 296 flat-5 ratings, 436 shared coordinates) live in
   code comments. If an interviewer asks "how did you get that?", have the query
   ready — a claim you can't reproduce on the spot is worse than one you never
   made.
