# Casita - an apartment hunter that understands you

**[Live demo →](https://casita-henna.vercel.app)**

Casita reads every rental listing in San Francisco it can reach - about 2,600 at
a time from Craigslist, Zillow, and Apartments.com - and cross-references each
one against the city's own records: police incidents, 311 reports, and building
violations filed against that exact building complex. Additionally, it seeks to simplify the home search to only factors that YOU care about. If nightlife is important to you, it will show you places as close to nightlife as possible, while budget constraints will work to get you the perfect place containing the most amenities and safest area in the meantime. Apartment hunters in san francisco are also constantly confronted with scams. Thats why I have a system that scans each booking and cross examines things like building rules, whether contact information present and common other factors that appear if a listing is fake. Not sure if your landlord is correct on things like craiglists listings?  I implemented a 50 quota, “look up you landlord feature” that finds and validates if the person selling you the house is actually authorized to be selling you the house. 


---
## My general appraoch to creating or improving any product

1. Find an actual problem
2. Market Research
3. Determine marketability
4. Determine how I could actually create this (bottom since ai is amazing)

## The problem

I scraped Reddit for what people complain about when they hunt for apartments in
San Francisco, pulled out the twenty complaints that came up most, and then went
narrower and over the weekend talked to my girlfriend and a few friends who'd searched recently.
The forum posts tell you what people complain about publicly. The conversations
tell you what actually made them give up on a listing.

Four things kept surfacing:

- **Looking at price comes at a cost** whether its more incidents, less amenties or just a bad location filtering for this info often takes multiple    visits to other sites.
- **You can't tell what a block is like from a listing.** Every rental site
  shows you the inside of the apartment and nothing about the two hundred feet
  outside its door.
- **Half of what you find is already gone.** People email about places that were
  rented weeks ago and hear nothing back, which is indistinguishable from being
  ignored.
- **Scam stories are everywhere.** Or knows someone who does. And the tells are
  learnable, but only after you've been burned once.


## What's different about my tool

- **The city's own data, per listing.** SFPD assaults and robberies, car
  break-ins, 311 encampment reports, street-cleaning requests, and DBI
  violations against the parcel. I used public city records to actually find and display these details on the map
- **Only the factors you picked.** The quiz takes one to five priorities and the
  ranking is built around them. Someone who picks nightlife and someone who
  picks quiet will get different answers on thier best match
- **A scam auditor on every listing.** Each one is cross-examined against the
  rest of the data set: price against comparable units, address against the
  city parcel map, whether anyone can actually be reached. 
- **Landlord verification.** A capped lookup that checks whether whoever is
  renting you the place is the registered owner of it.

---

## How I approached it

### 1. Find an actual problem

First I scraped san franscisco subreddit and found the top 20 most problems people have finding apartments in sf. 
Additionally over the weekend i spoke with several friends about issues they’ve had in the past 

Top 20 issues found on reddit
Repair stonewalling - ~40
Speed beats everything / listings disappear fast - ~34
Off-hours noise - ~31
Roommate / master-tenant traps - ~30
Eviction pressure / retaliation - ~26
Landlord reputation is hard to research - ~25
Concealed physical defects - ~23
Scams / phantom listings - ~23
Rent-control status unclear - ~22
Effective rent is higher than listed rent - ~22
Lease-structure traps - ~20
Parking availability is misleading - ~19
Utility metering / billing is opaque - ~19
Pet restrictions / pet fees disqualify renters - ~16
Security claims don’t match reality - ~14
Lack of short-term / sub-12-month leases - ~14
Screening barriers / unclear approval requirements - ~13
Substandard housing at market prices - ~13
Deposit / move-out fee extraction - ~11
Unpermitted / questionable units - ~9

### 2. Market research

Then I went looking for what already exists, because the useful question isn't
"has anyone built this" - someone always has - it's "what did they decide not to
do, and was that a good call?"

Two that shaped my thinking:

- **[openigloo.com](https://openigloo.com)** - landlord reviews and building
  violation history. Strong on the building, thin on whether the place fits
  *you*.
- **[localize.city](https://localize.city)** - neighborhood intelligence layered
  on listings. Closest to what I wanted, and it convinced me the data layer was
  the right bet.

### 3. Determine marketability

If I could see a creator filming the quiz and the reveal - thirty seconds of
answering five questions, then the top match with its safety layers switched on
and the block lighting up underneath it. The hook writes itself: *the stuff
apartment sites won't show you.*

That format works because the payoff is visual and the input is short. Most
rental tools can't be demoed in a clip, because using them is the boring part.

### 4. Determine how I could actually build it

The demo is a single static page with no framework and no build step, so hosting
is free and stays free. The costs are all on the data side, and they're one-off
per refresh rather than per visitor:

| | |
|---|---|
| Apify actor (Apartments.com) | a few cents per full sweep |
| RentCast (owner lookups) | 50 free/month, then $0.20/request |
| Everything else | free |

The largest cost I designed out. Routing every listing to every place you care
about through the Google Routes API would have been the biggest recurring bill
in the project, so instead I pulled an OpenStreetMap extract of the city and run
AI over it in the browser. A full refresh took about an hour. After that the site costs nothing to serve.

---

## Design decisions

**No search bar.** A search bar assumes you already know what you're looking
for. The whole premise is that you mostly don't, and that the fatigue comes from
having to invent your own filters. Thats the point of the quiz.

**No price map.** A map coloured by price answers "where is it cheap," but renters want to know how that price that cheapness comes  
at; whether its more incidents, less amenties or just a bad location for things you care about. Simplifying to a score that takes the 
things you care about and the minimum and maximum price u care about, simplifies that whole process for users. Additionally, u can use the 
heatmap to look at all the stuff happening around your area, to find out if youd like living there

**The quiz comes first.** Nothing renders until you've answered. That was a
deliberate risk: it's a wall between the visitor and the content. But it means
the first thing you see is already sorted for you rather than a generic list you
have to go to work on, and it means the score on each card has something to
mean.

**One to five priorities that you care about on the quiz.** Find the things people really care about and match based on that. max of 5 since no home can have everything, everywhere at once.

**Best match is about you, not about price.** The score answers "how well does
this fit *you*." It scores your priorities separately from a baseline of things
nobody should have to ask for - is it real, is the block safe, is the building
maintained - then blends them, so a stated priority actually moves the number. 
How much the extra amenties and other factors scales with how much of your budget the place eats for the things important to you

---

## How it works

### Scraping and mapping listings notes

Three sources.

- **Craigslist**  Craigslist also fuzzes its map pins, so listings that only give a
  circle, I choose get their address recovered from the post text where possible - and
  flagged as scams or not as good of a deal as thought if the text reveals its in a worse neighbor than what someone looking at the circle might think (cuz most people would want to gamble that its in a decent part of the city)
- **Zillow** availabilty and results come from the search feed and from building unit tables
- **Apartments.com** scraping goes through an Apify actor

### The city data

Four street layers on a rolling twelve-month window, plus building history:

| layer | source |
|---|---|
| Assaults, robberies, homicides, sex offenses | SFPD incident reports |
| Car break-ins and vehicle theft | SFPD incident reports |
| Encampment reports | SF 311 |
| Street & sidewalk cleaning requests | SF 311 |
| Violations, complaints, City Attorney referrals | SF DBI, keyed to the parcel |

Counts are converted to percentiles against the rest of the search, in order to know if something like
"forty incidents"  is good or bad.

### Routing

Straight-line distance with a fudge factor is wrong in exactly the places a
renter cares about - a hill with no through street, a block cut off by a
freeway, a park you have to walk around. So Casita routes on the real network:
**63,743 junctions and 102,048 edges**, of which 43,134 are drivable. Walking
routes use the pedestrian network, driving routes use roads only, and transit
returns nothing rather than guessing, because a pedestrian graph cannot answer a
transit question.

### The stack

No framework, no build step, no dependencies at runtime. Python for the
pipeline, vanilla JavaScript for the interface, canvas for the maps, SQLite in
between. The whole site is one self-contained HTML file plus a routing graph.

---

## Run it 

**To just look at it, use the [live demo](https://casita-henna.vercel.app).**
Nothing to install, nothing to key.

To run the real thing locally, on the real data, with no credentials at all:

```bash
git clone https://github.com/CerIsaiah/casita && cd casita
uv sync
cd research
python3 pipeline/build_pages.py --new
python3 serve.py             # http://127.0.0.1:8799/casita-demo.html
```

That works on a clean checkout because the sanitised data set is committed: all
2,589 listings, the street heatmap grid, the places index, and the 102,048-edge
routing graph. What is *not* committed is the raw scrape, which carries phone
numbers and owner names read out of public property records. Those are stripped
before anything reaches the repo, and a check in `sanitize_public.py` fails the
build if a single one survives.

A clone gets everything the product reasons about and nothing that belongs to a
person.

### Refreshing the data

Listings go stale fast, which is the whole premise of the availability feature.
To re-scrape:

```bash
cp .env.example .env         # APIFY_API_TOKEN for Apartments.com
cd research && ./refresh.sh  # full sweep, ~1 hour
```

Craigslist and Zillow need no key. Owner lookups need `RENTCAST_API_KEY` and are
capped at 50 a month in code, because the API costs $0.20 a request past that
and a loop should not be able to spend real money. Everything paid is opt-in.

---

## Honest limits

- **It's San Francisco only.** Neighborhood boundaries, the 90 areas rolled into
  8 districts, the city datasets, and the routing graph are all hand-fitted to
  one city.
- **The data is a snapshot.** - refreshes need to be done manually for now whenever someone is looking
- **Craigslist locations are sometimes approximate.** When the pin is fuzzed and
  the post text doesn't name a street, the listing is placed on a block rather
  than a building, and it says so.
- **The scam auditor finds inconsistencies, not fraud.** It can tell you a
  listing is priced 40% under comparable units with no contact information and
  one photograph. It cannot tell you who posted it or what they intend, and it
  deliberately doesn't try.
- **Owner lookups are capped at 50/month** by default, as afterwords because the API is $0.20.
- **Redfin and Zumper scrapers exist** and work, but aren't wired into this
  pipeline yet - the three sources above are what the numbers on this page
  reflect.

---

## What this is built on

This is a fork of [matin/casita](https://github.com/matin/casita), a personal
rental-search tool published as an open interview project. The seed repo scrapes
listings into SQLite, enriches them with Gemini, and renders a static site; that
codebase still lives here under `src/casita/` and its own docs are in `docs/`.

Everything in `research/` is mine: the rebuild described above, its scoring
model, the city-data layer, the scam auditor, the routing graph, and the
interface. Where I changed the original I said why in the commit.

The seed project's own demo still runs, credentials-free, off a sanitised
fixture:

```bash
uv run casita demo          # http://127.0.0.1:8765/
make check                  # compile, tests, leak validator, docs, package
```

Contributions to the upstream project: read `CONTRIBUTING.md` there.
