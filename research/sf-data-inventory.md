# SF Apartment X-Ray — Data Source Inventory

Research notes for a proposed "paste a listing, see what it isn't telling you"
product for San Francisco. Compiled 2026-08-07 from parallel research agents.

**Status: research only. Nothing here is built.** This file is not part of the
zensical docs site and is not published.

Every dataset ID below was verified against a live API unless marked
`UNVERIFIED`. Contradictions between sources are flagged rather than resolved.

---

## The single biggest trap: `blklot` vs `mapblklot`

Verified end-to-end and it will silently produce wrong answers if you get it
wrong.

- `blklot` is the **legal** lot. Every condo unit gets its own.
- `mapblklot` is the **physical** parcel — the actual building.
- DBI complaints, permits, and violations are filed against the **physical**
  parcel.

Worked example: 1380 Greenwich St is a condo with legal lot `0501052`. The
assessor confirms it (built 1990, `Condominium`, 1 unit). Querying DBI
complaints for `parcel_number='0501052'` returns **zero rows**. Its
`mapblklot` is `0501038`; querying `block='0501' AND lot='038'` returns the
building's three real complaints.

Keying on the condo lot returns an empty result set that looks like a clean
building. Always resolve to `mapblklot` first.

**Second join gotcha:** lot zero-padding is inconsistent across datasets. DBI,
permits, NOV, and the assessor use 3-char padded lots with optional alpha
suffix (`001`, `010A`, `004D`). Soft-story uses unpadded (`20`). Normalize
before joining.

---

## Address → parcel resolution

**Canonical: SF Planning MAD_Parcel geocoder.** No token, no key, returns JSON.

```
https://sfplanninggis.org/arcgiswa/rest/services/Geocoder/MapServer/0/query
  ?where=ADDRESSSIMPLE='1380 GREENWICH ST'&outFields=*&f=json
```

270,742 rows. Fields: `ADDRESS` (with unit), `ADDRESSSIMPLE` (no unit),
`ADDRESSNOTY` (no street type), `unit_address`, `blklot`, `mapblklot`,
`block_num`, `lot_num`, `status`, `zipcode`.

The service root is `arcgiswa`, **not** `arcgiswebservices` — that path 404s.

**All-Socrata fallback** (no external dependency):

1. `acdm-wktn` — Parcels, Active and Retired (235,383 rows, daily). The better
   resolver: `blklot`, `mapblklot`, `from_address_num`/`to_address_num`,
   `street_name`, `street_type`, `active`, `centroid_lat/long`, `zoning_code`.
   Gotcha: `from/to_address_num` are **text**, so numeric range comparisons
   error. Cast or match exactly.
2. `3mea-di5p` — EAS Addresses (224,340). Has `parcel_number`, `eas_baseid`,
   lat/lon, but `parcel_number` is **null on ~5% of rows** (11,506), including
   1380 Greenwich. Not sufficient alone. (`ramy-di5m` is the with-units
   variant, 388,514 rows.)

---

## DataSF / Socrata datasets

API pattern: `https://data.sfgov.org/resource/<4x4>.json?$where=...&$limit=...`

**No app token required.** Anonymous works; `$limit=50000` returns 200 in ~5s.
A token only moves you out of the shared throttle pool. `UNVERIFIED`: the exact
anonymous throttle threshold — no `X-RateLimit` headers are returned.

| Dataset | 4x4 | Rows | Cadence | Address join |
| --- | --- | --- | --- | --- |
| DBI Complaints (All Divisions) | `gm2e-bten` | 334,143 | Daily | `block`+`lot`+`parcel_number`, street parts, `point` |
| Notices of Violation (DBI) | `nbtm-fbw5` | 515,853 | Daily | `block`+`lot`, street parts, `location` |
| Building Permits | `i98e-djp9` | 1,293,402 | Daily | `block`+`lot`, street parts, `location` |
| 311 Cases | `vw6y-z8j6` | 8,820,143 | Daily | address string + `lat`/`long` only — **no block/lot** |
| Eviction Notices | `5cei-gny5` | 48,799 | Monthly | **block-redacted** + centroid `shape` |
| Petitions to the Rent Board | `6swy-cmkq` | 59,591 | Monthly | **block-redacted** |
| Buyout Agreements | `wmam-7g8d` | 8,445 | — | **exact addresses** + `geocoding_confidence` |
| Rent Board Housing Inventory | `gdc7-dmcn` | 548,737 | Daily | **block-redacted**, banded rent |
| Fire Violations | `4zuq-2cbe` | 53,392 | Daily | `eas_id`, `eas_street_no`, `location` |
| Fire Inspections | `wb4c-6hwj` | 441,325 | Daily | address string + zip only — no geo |
| Fire Safety Complaints | `2wsq-7wmv` | — | — | not inspected |
| Assessor Historical Secured Rolls | `wv5m-vpq2` | 3,934,467 | **Annual** | `block`+`lot`+`parcel_number`, `the_geom` |
| Registered Business Locations | `g8m3-pdis` | 365,064 | Daily | `full_business_address`, `location` |
| Active Entertainment Permits | `86e8-rfem` | — | Daily | `dba_name`, lat/lon |
| Soft-Story Properties | `beah-shgi` | 4,945 | — | `tier`, retrofit `status` |
| Parcels – Active and Retired | `acdm-wktn` | 235,383 | Daily | see above |
| EAS Addresses | `3mea-di5p` | 224,340 | — | see above |
| Taxable Commercial Spaces | `rzkk-54yv` | — | Daily | `block`/`lot` + `entity` owner name, **commercial only** |
| Annual Allowable Rent Increase | `hsxb-ci7b` | — | — | reference |

All PDDL (public domain) where checked.

### Notes

**DBI.** There is no standalone "housing inspections" dataset — housing is a
division inside the two above. Filter `assigned_division='Housing Inspection
Services'` (183,690 of 334,143 complaints). NOV severity from
`nov_category_description`: building section (139k), interior surfaces (70k),
fire section (62k), security requirements (19k), smoke detection (15k),
sanitation (13k), lead (1.4k).

**Permits.** Active construction near an address = filter `status` +
`filed_date`/`issued_date`/`last_permit_activity_date`, then radius-search on
`location`. Also carries `existing_units`/`proposed_units`, `estimated_cost`,
`number_of_proposed_stories`. `tyz3-vt28` (PermitSF) is the replacement system
but has only 3,794 rows — not yet usable.

**311 noise.** Two `service_name` values from different eras — you must query
both: `Noise Report` (62,018) and `Noise` (31,662). The usable taxonomy is
`service_subtype`, shared across both:

`other_excessive_noise` (24.6k), `entertainment` (11.2k),
`construction_private_property` (8.8k), `amplified_sound_electronics` (8.0k),
`mechanical_equipment` (4.4k), `garbage_recycling_collection` (3.3k),
`major_event_venue` (2.7k), plus `traffic`, `vehicle_car_alarm`,
`delivery_service_business`, `sirens`, `protest_speech_bullhorns`.

No parcel key — joining to a building means a lat/lon radius query.

**Assessor — the rent-control oracle.** One row per parcel *per roll year*, so
always filter `closed_roll_year=2025` (latest, ~211k rows/yr). Gives
`year_property_built`, `number_of_units`, `property_class_code_definition`
(`"Condominium"`), `use_definition`, `number_of_stories`, `zoning_code`, and
`the_geom` — so no geocoding round-trip for the parcel itself. Annual cadence
means the 2025 roll reflects a Jan 2025 lien date.

**Fire is asymmetric.** Violations (`4zuq-2cbe`) has `eas_id` + point geometry
and joins cleanly. Inspections (`wb4c-6hwj`) has only a raw address string with
dirty values (samples include `"1 Mobile Caterers"`, zip `00000`) — needs fuzzy
geocoding.

**Rent Board data is block-level only.** Evictions and petitions are redacted to
`"2000 Block Of Polk Street"` with block-centroid coordinates. This is a
block-level risk signal and can **never** be attributed to a specific building
or owner. Buyout Agreements is the exception — it has exact addresses.

### SF Planning hazard layers

Same ArcGIS server, keyed by plain `block`+`lot`, `PlanningData/MapServer`:

- Layer 39 — Seismic Hazard Liquefaction
- Layer 40 — Landslide
- Layer 41 — FEMA Flood Hazard
- Layer 37 — Air Pollution Exposure Zone 2025
- Plus Historic Resources, zoning/height districts, Maher (contaminated soil),
  Cortese

Combined with `beah-shgi` (soft-story), this is strong X-ray material that
requires no vendor.

---

## CA ABC liquor licenses — bulk CSV, no API

No Socrata presence; data.ca.gov has only COVID-era leftovers.

```
https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip
```

7.0 MB, one CSV, 128,931 statewide rows, 26 columns, updated weekdays ~7am PT.
Fixed-width variant at `DailyExport.zip`.

- SF filter: `Prem County = 'SAN FRANCISCO'` or `Geo Code = 3800` → **5,533
  rows, 5,188 active**.
- Format quirk: line 0 is a timestamp banner, line 1 is the header, data starts
  line 2. Latin-1 encoded.
- Columns: `License Type`, `Type Status`, `Primary Name`, `DBA Name`,
  `Prem Addr 1/2`, `Prem City/Zip`, `Prem Census Tract #`.
- **No coordinates** — budget for geocoding 5.5k SF addresses.

**Bar vs restaurant is fully determinable.** "Public premises" types are the bar
signal; "eating place" types are restaurants.

| Type | Meaning | SF count |
| --- | --- | --- |
| 41 | on-sale beer/wine, eating place | 1,729 |
| 47 | on-sale general, eating place | 1,091 |
| 21 | off-sale general | 672 |
| 58 | caterer's | 544 |
| 48 | on-sale general, **public premises** (bar/nightclub, no minors) | 441 |
| 42 | beer/wine **public premises** | 63 |
| 90 | music venue | 32 |

`UNVERIFIED`: type-code semantics for 23/58/90 came from a summary page, not the
official record layout. Also unverified whether ABC's license-lookup form has an
undocumented JSON endpoint — only the bulk export was confirmed.

---

## Rent control — the legal decision tree

Fully verified against primary sources (sf.gov codified Chapter 37, signed
Ordinance 296-19 PDF, leginfo).

**The structural fact most tools get wrong:** rent control and eviction control
were split by **Ordinance 296-19, effective January 20, 2020**. Post-1979 units
are now "rental units" under § 37.2(r) → **§ 37.9 just cause applies** → but
§ 37.3(g) lifts the price cap.

1. Entirely exempt (hotel <32 days, co-op, dorm, care facility,
   government-regulated)? → no local protection at all.
2. Otherwise it is a "rental unit" → **just cause always applies**. Rent Board
   fee owed.
3. Price control applies **unless**: first C-of-O after **June 13, 1979** with
   no prior residential use (§ 37.3(g)); or Rent-Board-certified substantial
   rehabilitation; or Costa-Hawkins SFH/condo with tenancy commenced on/after
   **January 1, 1996** (§ 37.3(d)).
4. The Costa-Hawkins SFH exemption **fails** if: a legal or illegal in-law unit
   is present (unless rented as one tenancy), another residential structure is
   on the lot, rooms are rented boarding-house style, the condo is unsold by the
   subdivider, there is a 6-month unabated serious code citation, or the prior
   tenancy ended by §1946.1/§827 notice.
5. The new-construction exemption **fails** for § 37.2(r)(4)(D) unit types
   (waiver ADUs, HOME-SF, density-exception units, regulatory-agreement units,
   replacement units).
6. If locally price-exempt → **AB 1482** caps increases at min(5% + Bay Area
   CPI, 10%), unless C-of-O within the last 15 years (rolling), or SFH/condo
   with a non-corporate owner who gave the statutory notice, or an owner-occupied
   duplex. Just cause remains SF's § 37.9, not § 1946.2.

**Current numbers:** SF allowable annual increase **1.6%** (3/1/2026–2/28/2027);
prior year 1.4%. Formula is 60% of published CPI increase, hard-capped at 7%.
AB 1482 sunsets **January 1, 2030** — AB 1157 (which would have removed the
sunset) **died February 2, 2026**.

The June 13, 1979 date is frozen by Costa-Hawkins § 1954.52(a)(2) and can only
move (up to June 13, 1994) if state law changes. Prop 33 failed Nov 5, 2024.

---

## Landlord identity — the hard part

**No SF dataset exposes a parcel-level residential owner name.** The Assessor's
public roll (`wv5m-vpq2`) has no owner, assessee, taxpayer, or mailing-address
field. Its description says it contains "all *legally disclosable* information."
SF Planning's Property Information Map does not show owner name either.

The name **is** a public record (R&TC §602 requires the roll to show assessee
name and mailing address) — SF just doesn't publish it online or in open data.
The Assessor says so verbatim:

> "Due to State Law, our office is not allowed to post ownership information
> online. However, this information is available for purchase or access for free
> at our main office."
> — sf.gov/resource--secured-property-tax-data

So the name is free, in person, one at a time. It will never come over HTTP from
the City.

### Free workaround: Registered Business Locations (`g8m3-pdis`)

SF law treats "a lessor of residential real estate ... as a separate person with
respect to each individual building." So each 4+ unit rental building gets its
own registration: `full_business_address` ≈ the building, `ownership_name` ≈ the
owner.

**Coverage gap:** landlords of a single structure with **fewer than 4 units**,
or one condo, are exempt. This is a registry of 4+ unit buildings, not all
rentals.

Measured on the NAICS 5311* slice:

| Measure | Value |
| --- | --- |
| Rows | 15,791 |
| Active (no `location_end_date`) | 12,510 |
| `ownership_name` containing "LLC" | 3,501 (28.0%) |
| Entity-looking name (LLC/INC/LP/TRUST/PARTNERS) | 6,376 (51.0%) |
| Distinct owner names | 8,637 |
| Owners at >1 distinct address | **1,638** |
| Mailing addresses shared by >2 owner names | **428** |

> **CONTRADICTION — resolve before building.** One agent measured the above by
> filtering `self_reported_naics_code` on `g8m3-pdis`. Another agent reports
> NAICS codes were **removed** from the live feed and frozen into `83tt-3c36`
> ([Archive], 363,256 rows, pre-2024 snapshot), joinable via
> `g8m3-pdis.ttxid ↔ 83tt-3c36.location_id`, with partial coverage even there.
> These cannot both be current. Re-run the NAICS query before trusting the
> table above.

### The clustering technique works — with two required guardrails

Clustering active registrations on normalized `mailing_address_1`, inspected by
hand:

- **1717 Powell St Ste 300 — true portfolio.** Francesca Apartments LP, Gaylord
  Associates LP, Panhandle Oak Apartments LP, Elizabeth Court LP, Haight &
  Fillmore Associates LP, Geary Manor Associates LLC. Every building wrapped in
  its own single-asset LP, all mailing to one suite. Address clustering defeats
  the shell pattern cleanly.
- **3475 California St — false positive.** 97 unrelated "owners" (family LLCs,
  living trusts, natural persons). The address belongs to **Chandler
  Properties**, a property *manager*. Same failure mode as CT Corporation
  collapsing thousands of unrelated LLCs.

Required guardrails:

1. **Manager/agent-address blocklist.** Otherwise property managers and
   registered agents create enormous phantom portfolios.
2. **Junk sentinel filter.** `0000 UNDELIVERABLE MAIL` alone collapsed 116
   owners.
3. **Fuzzy name matching is mandatory.** `DEL CAMP INVESTMENTS INC` (35
   buildings) and `DELCAMP INVESTMENTS INC` (24) are the same owner.

The discriminator between a real portfolio and a manager address is **name
morphology** — systematically-named single-asset entities (`<Street> Associates
LP`) vs. a heterogeneous mix including trusts and natural persons. Note that
`SF MULTIFAMILY POOL 23 B OWNER LLC` and `SF MULTIFAMILY POOL 5 C OWNER LLC` are
obviously the same sponsor but share no name token — pattern rules needed.

LightBox's own docs warn about exactly this: *"Owner names come in many
different variations ... These nuances make the owner name an unreliable
attribute for this identification."*

### Dead ends, confirmed

- **Building Permits Contacts (`3pee-9qhc`)** has `first_name`/`last_name`/
  `role`, but **there is no "owner" role**. Verified twice by independent
  enumeration: contractor 583,207 · authorized agent-others 147,743 · architect
  97,045 · engineer 71,177 · lessee 42,512 · payor 33,371 · pmt consultant
  26,082 · designer 15,852 · project contact 11,374 · attorney 571 ·
  subcontractor 158. `payor` and `lessee` are weak proxies at best.
- **Rent Board Housing Inventory** collects owner and property-manager names by
  ordinance but publishes neither, citing the bar on operating a "rental
  registry" under Civil Code §§ 1947.7–1947.8.
- **FinCEN beneficial ownership** — FinCEN's March 26, 2025 interim final rule
  exempts all US-formed entities from BOI reporting. It was never a public
  registry regardless.
- **CA Secretary of State bizfile** — free entity search and free filing images,
  and the Statement of Information (LLC-12) does carry manager/member names. But
  scripted access returns **Incapsula 403** for both the search API and image
  URLs. Needs a real browser session, not `requests`.

### SF Recorder — free, name-searchable, not bulk

`https://recorder.sfgov.org/` — search by grantor/grantee name, document number,
type, or APN. **No address search.** 1990–present; pre-1990 in person only. Free
to search and preview, $1.81 per official copy. No public API (AngularJS SPA, no
JSON endpoint found). Best free tool for confirming a cluster actually holds
title, but one name at a time.

---

## Commercial owner-name APIs

| Provider | Free tier | Owner name | Verdict |
| --- | --- | --- | --- |
| **RentCast** | **50 req/mo, recurring** | `owner.names[]`, `owner.type`, `owner.mailingAddress`, `ownerOccupied` | **Best fit, by a wide margin.** See below. $74/mo → 1,000 req. 20 req/sec. |
| **Regrid** | **API: 30-day sandbox only** | owner names, mailing addresses, deeded ownership | **No free API tier** — Standard **$375/mo** (2,000 records), Premium $500/mo, $0.10–0.15/record overage. The $0 "Starter" is the *web app*, no bulk owner export. |
| **Zillow Bridge** | none | not stated | **Unusable.** All ~20 Zillow Group APIs are **invite-only**; the public ZWSID API retired 2021-09-30. |
| **LightBox** | 2,000 calls / 3 weeks | `owner.names.fullName`, `ownerNameStd` | Eval only. All 58 CA counties confirmed. **No credit-card production path** — sales-gated. Sources the annual assessor roll. |
| **ATTOM** | 30-day trial | assessor + deed + mortgage | Quote pricing. |
| **Reonomy** | None | markets LLC-shell resolution | ~$400/mo/user, commercial-focused. |
| **PropMix** | 50 calls / 15 days, no card | product copy only — **no field-level confirmation** | $79/mo → 1,000 calls (~$0.079/call), month-to-month. Docs subdomain is **NXDOMAIN**; no public schema. |
| **HouseCanary** | test keys, **whitelisted addresses only** | **`sales_history[].grantee_1` + `grantee_1_forenames`** — recorded deeds | Full public OpenAPI spec. But endpoint→price-tier mapping is unpublished: **$0.30–$6.00/call**, a 20× range. Cannot test an arbitrary SF parcel before paying. |
| **Datafiniti** | 2-week/1K trial only | `mostRecentOwnerFirstName/LastName` | $119/mo for 1K — ~1.6× RentCast. |
| **Estated** | — | `owner.name` | **Dead for new integrations.** ATTOM acquired Aug 2022; registration page 404s. Docs useful as schema reference only. |
| **Cherre** | None | unknown | **Disqualified.** No public docs (`developer.cherre.com` and `docs.cherre.com` are NXDOMAIN), GraphQL, six-figure enterprise contracts. |

### RentCast — the redisplay question is RESOLVED

The **API terms** (rentcast.io/terms-api, distinct from the platform ToS) grant
the right to "use and/or store the API Data," create derivative works, and
"sublicense, disclose, display, resell and distribute the API Data to third
parties," and to retain data obtained before termination. Prohibited: unsolicited
commercial email, scraping, and violating consumer-reporting laws or laws
restricting use of public information for marketing.

Do not confuse this with the *platform* ToS (rentcast.io/terms), which bars using
"the Application" — the web app, not the API — for revenue-generating purposes.

**The free tier is much larger than the request count suggests.** Paginated
endpoints return **up to 500 records per request**, so 50 requests/month ≈
**25,000 rows/month** — more than SF's entire active rental inventory. An SF demo
is effectively free.

Remaining caveat is judgment, not licensing: owner name + mailing address is
skip-trace-adjacent data. Publishing it on a public site is a privacy/CCPA
decision regardless of what the ToS permits. See the `AGENTS.md` rules.

**Debunked:** a claim circulating in search results that California Government
Code § 7928.205 "broadly restricts owner name and mailing address from public
REST endpoints across California" does not survive checking. That section
concerns home addresses of elected and appointed officials, and it binds
government agencies rather than commercial data vendors. Treat as misapplied.

**Still unknown for every vendor:** none of the eight publishes a California or
San Francisco coverage statement, so SF owner-name **fill rate** is unmeasured
across the board. The cheap way to settle it is RentCast's recurring free tier
or PropMix's 50-call trial — run the same 20 SF addresses through both.

---

## Environment / neighborhood layers

**HowLoud** — alive, not acquired (domain renewed through 2028). FHWA traffic
noise model plus SF's own commissioned city noise map, so it's meaningfully
better than free alternatives at address level.

| Tier | Price | Quota | Caching |
| --- | --- | --- | --- |
| Free | $0 | 2,500/mo | **forbidden** |
| Basic | $25/mo | 5,000/mo | allowed |
| Premium | $100/mo | 50,000/mo | allowed |

The free tier's no-caching clause is a **hard blocker** for a scrape-and-store
pipeline. $25/mo lifts it.

**BTS National Transportation Noise Map** — public domain, free, unrestricted
use. Latest is 2022 but those are **tiles-only** (pre-rendered PNG, no dB value
at a point). The queryable ImageServices are 2020 vintage, 30 m raster:

```
https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/
  USA_Transportation_Noise___Rail_Road_and_Aviation_2020/ImageServer
```

BTS disclaims per-location use in writing: *"should not be used to evaluate
noise levels in individual locations."* Right choice for a credentials-free demo
path; wrong basis for a claim about a specific unit.

**Walk Score** (Redfin-owned) — one call returns Walk + Transit + Bike. Free
tier is 5,000 views/day and includes all three scores. Results snap to a ~500 ft
grid, so per-snapped-coordinate caching is efficient and legitimate. US/Canada
only, server-side calls only, branding display mandatory.

⚠️ **"Offline use" and "subscription/fee-based services" are Enterprise-only.**
A statically-rendered site is a genuine gray area, not a technicality.

Open-source alternative: `kcredit/Walkable-Accessibility-Score` (15★, MIT-ish,
last push 2025-09-15).

---

## Prior art — and what's already occupied

**Both halves of the strongest scene already exist as shipped products.**

- **rentcontrolchecker.com** — live, on Vercel. Page source cites `wv5m-vpq2`,
  the exact dataset above. Closed source. Self-declares the same gaps we
  identified (1996+ condo conversions, substantial rehab, Costa-Hawkins).
- **Evictorbook** (Anti-Eviction Mapping Project) — live in 2026, both
  `evictorbook.com` and `sf.evictorbook.com` return 200. Combines SF Assessor
  ownership records + CA SOS corporate filings + Rent Board eviction data to
  surface shell webs. Reported portfolios: Veritas 499 associated businesses,
  Mosser 263, Wedgewood 237. **Sources owner names from the Assessor directly,
  not DataSF** — independent confirmation that the open-data route can't reach
  them. Code was promised open-source in a docs repo last touched 2023-08-06;
  never shipped.

Neither starts from a pasted listing, and neither does the X-ray UX.

**"Am I Rent Controlled" never existed.** Both domains are NXDOMAIN;
`amirentcontrolled.com` has three Wayback snapshots from 2018, all empty stubs.
Tenants Together publishes only a static list of which *cities* have ordinances.

### Localize.city — shut down Aug 2024, and never covered SF

The closest thing to this product that has ever existed. **Ceased US operations
19 Aug 2024** — not acquired. Company statement blamed interest rates and a
"two-decade low" US real estate market. ~$70M raised; sister company Madlan
continues in Israel. The site still renders but is frozen: every listing
timestamp is May–June 2024.

**It only ever covered NYC and Chicago.** Verified — zero hits for "san
francisco" or "california" across archived and live pages. The one path segment
is `nyc`. (Naming collision to avoid: `localize.com` is an unrelated SF
translation-software company.)

**Its internal insight taxonomy**, extracted from the live SSR payload
(`window.__SSR_HYDRATED_CONTEXT__`) — this is the actual schema, not marketing:

| Category | Insight types |
| --- | --- |
| `nuisances` | `noise`, `truck-routes`, `railway-proximity`, `indoor-air-quality` |
| `planning` | `historic-landmarks`, `new-development-jobs-area`, `protected-streets`, `blocked-view` |
| `safety` | `crime`, `flood-hazards`, `hurricane-hazards` |
| `transportation` | `connectivity`, `bikes`, `bike-commute` |
| `livability` | `demographics`, `open-spaces-new` |
| `prices` | `prices`, `price-trends-new` |
| `education` | `school-grid` |
| own bucket | `natural-light` |
| `analyst-insight/*` | human-written, across all categories |

Badge taglines: `NOISY BARS` · `CONSTRUCTION COMING` · `VIEW TO BE BLOCKED` ·
`OPEN LIENS IN BLDG` · `ON A TRUCK ROUTE` · `ON TRAIN TRACKS` · `FLOOD ZONE` ·
`LESS NATURAL LIGHT` · `ROAD SAFETY ISSUE` · `PRICE OPPORTUNITY` · `RARE AMENITY`.

Three design decisions worth stealing:

1. **The page header was literally "The truth you should know."** Same thesis as
   "show me what this listing isn't telling you."
2. **Insights were two-sided.** Each carried a `tradeoff` object with
   `goodTradeoff: true|false` — `BRIGHT & SUNNY` alongside `LESS NATURAL LIGHT`.
   Not a pure negativity engine.
3. **~8 insights surfaced per listing** out of 20–30 computed. They already
   solved the "don't show a 20-score dashboard" problem by ranking and
   truncating.

Sunlight method (the most documented piece): computed the **azimuth of every
outward-facing façade** in all five boroughs, overlaid shadow maps on existing
3D building models, and recorded whether each point on a wall fell in shadow
across time. Explicitly **not LiDAR**.

No engineering blog, no GitHub org, no public methodology page. Everything above
is reverse-engineered from SSR payloads and press.

### The 2026 competitive landscape is fragmented single-signal vendors

- **Redfin Sunscore** — launched **11 May 2026** with Shadowmap, exclusive to
  Redfin, on all for-sale homes. 0–100 property-level light score. **Covers SF.**
- **Shadowmap** (shadowmap.org) — global 3D sun/shadow simulation, has an API,
  works anywhere including SF.
- **HowLoud** — noise, syndicated into Apartments.com, Homes.com, several MLSs.
- **Local Logic** — 18 location scores, syndicated via MLSs and portals.
- **First Street** — climate risk. **Cautionary tale: Zillow removed First
  Street scores from listings in mid-Nov 2025** after CRMLS challenged accuracy,
  its CEO saying the "future predictions ended up being very wrong" on
  California flooding. Redfin and Realtor.com still display it.

That First Street removal is the clearest warning available for this product
category: a data-driven risk score got pulled from the largest portal in the
country for being wrong in California. Attribution and calibration are not
polish — they are the product's survival condition.

**Confirmed gap: nothing in 2026 assembles a Localize-style unified layer for
San Francisco.** Per-building permits/violations, 311 complaints, view
obstruction from approved-but-unbuilt development, truck routes, and narrative
insights all exist as public SF data, and no consumer product combines them.

### Licensing — matters for an MIT repo

| Repo | ★ | License | Note |
| --- | --- | --- | --- |
| `nycdb/nycdb` | 262 | **AGPL-3.0** | Canonical "messy municipal datasets → one schema." Read it; don't copy it. |
| `JustFixNYC/who-owns-what` | 210 | **GPL-3.0** | The landlord-portfolio graph technique. |
| `talos/nyc-stabilization-unit-counts` | 93 | none | Scrapes DOF tax bills — the hack that made NYC stabilization data real. |
| `clhenrick/am-i-rent-stabilized` | 43 | **none** | Closest shape to an SF version. All rights reserved. |
| **`writingdeveloper/rentrights`** | 0 | **MIT** | LA renter protections from an address. Created 2026-06-04. **Closest analogue that is safely reusable.** |
| `EvictionLab/eviction-maps` | 29 | **MIT** | National viz tool, stale. |
| AEMP repos (`sfownership`, `corporate-ownership-map`, `sf-llc-data-prep`) | — | **none** | 91-repo org, nearly all unlicensed. Readable for method, not vendorable. |

JustFix's method, for reference: take each building's registered entity business
addresses plus contact names, treat each owner name as a node, **draw an edge
between any two names sharing a business address**, take connected components as
the portfolio. Fuzzy matching handles misspellings. Rebuilt nightly across
~170,000 buildings.

---

## Feasibility verdict by scene

**Scene 3 (The Deal) — strongest, but occupied.** Rent control is a genuinely
computable decision tree off one free dataset. Landlord portfolios work with the
guardrails above. Both already shipped by someone else, neither from a listing.

**Scene 2 (Outside) — feasible, mostly free.** 311 noise subtypes, ABC license
types for bar-vs-restaurant, entertainment permits, active permits as a
construction proxy, Planning hazard layers. Noise scoring at address level wants
HowLoud Basic ($25/mo); BTS is the free fallback.

**Scene 1 (Inside) — the weak link.** "Your bedroom faces a major road" requires
room orientation within the unit. That data does not exist publicly and
floorplans are rarely posted. DBI complaints are building-level: you can say
"this building has 7 water-intrusion complaints," not "your bathroom." Either
scope Scene 1 to building-level claims shown over the building exterior, or
you're inventing detail.

---

## Listing ingestion

**Every official feed is a dead end.** Zillow Group's Rentals Feed is **inbound
only** — it exists so property managers can syndicate *into* Zillow, not so you
can pull out. Everything else on their developer index is MLS/broker/mortgage,
gated behind Bridge Interactive approval. Rentberry has no API
(`/api` and `/developers` both 404). Realtor.com and Rent. are the same shape:
inbound syndication for property managers.

So the realistic paths are managed scrapers or scraping infrastructure.

### Apify — cheapest credible shortcut

Free tier is **$5/mo of credit, recurring, no card**. At blended actor rates
that buys roughly **3,000–4,000 listings/month** across all four sources —
workable for a daily personal search, not for full-market sweeps. Realistic paid
floor is Starter at **$29/mo → ~20,000 results/month**.

| Source | Actor | Price | Total runs | Health |
| --- | --- | --- | --- | --- |
| Zillow (search) | `maxcopell/zillow-scraper` | $1.30/1k | 503,849 | 4.92★, Apify-maintained |
| Zillow (detail) | `maxcopell/zillow-detail-scraper` | $3.00/1k | **3,797,642** | 4.35★, battle-tested |
| Craigslist | `memo23/craigslist-scraper` | $1.50/1k | 30,922 | **5.00★** |
| Redfin | `tri_angle/redfin-search` | $0.50/1k | 36,520 | cheapest of the set |
| Apartments.com | `epctex/apartments-scraper-api` | ~$0.01/list-page | 733,295 | PPE event pricing |
| Apartments.com | `memo23/apartments-cheerio-ppe` | $1.30/1k | — | cheapest |
| **Zumper** | `memo23/zumper-cheerio` | $2.50/1k | **173** | **1.00★ — weak link** |

**Zumper is the risk.** The only maintained actor has 173 lifetime runs and a
1-star rating. Budget for it failing.

Caveat on Apify freshness signals: every top actor shows `modifiedAt` within the
last few days, but Apify bumps that on any build or metadata change. It proves
"not abandoned," not "recently fixed." **Trust `totalRuns` instead.**

### Alternatives

- **HasData** — best drop-in if you want a maintained HTTP endpoint rather than
  an actor. Zillow API **$0.37/1k at volume** ($1.02/1k on the $49 entry plan);
  Redfin $0.37/1k. Free tier is a **one-time** 1,000 credits ≈ 200 Zillow
  requests, not recurring.
- **ScraperAPI** — structured real-estate endpoints are **Redfin only**
  (`/structured/redfin/forrent` etc.). No Zillow, Craigslist, Zumper, or
  Apartments.com. 7-day/5,000-credit trial, then $49/mo. Credits don't roll over.
- **ScrapFly** — 1,000 signup credits, no card, no expiry, but a JS-rendered
  anti-bot Zillow page costs a multiple of one credit, so it's prototype-only.
  $30/mo for 200k credits.
- **Bright Data** — out. **$250 minimum order**, and the Zillow datasets are
  for-sale property records rather than live rental inventory.
- **RapidAPI** — plan quotas are fetched client-side and the GraphQL gateway
  refuses introspection, so per-API pricing is `UNVERIFIED`. One vendor site did
  verify: OpenWeb Ninja's Real-Time Zillow Data offers **100 req/mo free (hard
  limit)**, then $25/mo → 10,000.

---

## Still unresearched

- Health of the existing scrapers in `src/casita/` (`zillow.py`,
  `craigslist.py`, `zumper.py`, `redfin.py`) against 2026 bot protection.
- Localize.city's fate and any public writeup of its data model.
- Address-string normalization strategy for joining ABC / 311 / business
  records that carry no parcel key.
- Whether a Sunshine Ordinance / CPRA request to the Rent Board would yield
  owner-name + full-address columns in bulk, given their FAQ states submissions
  are public. Highest-leverage unknown for the landlord layer.
- Whether RentCast's ToS permits publicly redisplaying owner names.

---

## Privacy note

Landlord clustering assembles names of identifiable individuals — `ownership_name`
is frequently a natural person, not an LLC. See the "Landlord and public-records
data" section of `AGENTS.md`. Note that `scripts/validate_public.py`'s
`PERSONAL_NAME_PATTERN` only matches two hardcoded names and will **not** catch a
real landlord name leaking into a fixture.
