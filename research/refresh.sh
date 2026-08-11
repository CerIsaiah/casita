#!/usr/bin/env bash
# Re-scrape SF listings, re-enrich from the city database, rebuild the page.
#
# Anything absent last run shows as "New to you"; anything cheaper than when you
# last looked shows as a price drop. Both are computed in your browser against
# what you actually saw, so neither is simulated.
#
#   ./refresh.sh          full run, all three sources   (~$3-4 of Apify credit)
#   ./refresh.sh --quick  Apartments.com + Zillow only  (~$2, much faster)
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/pipeline"

if [[ ! -f ../../.env ]]; then
  echo "No .env found at repo root (needs APIFY_API_TOKEN=...)" >&2; exit 1
fi
if [[ ! -f city.sqlite ]]; then
  echo "==> city database missing, building it (free, ~5 min)"
  python3 build_city.py
  python3 add_landlord.py
  python3 landlord_check.py
fi

echo "==> 1/4  scraping listings"
QUICK="${1:-}" python3 scrape_all.py

echo "==> 2/4  merging + deduping across sources"
python3 merge.py listings_raw.json

echo "==> 3/4  enriching from the city database"
python3 export_app.py
python3 add_trust.py
python3 add_street_stats.py
python3 fix_data.py            # multi-lot buildings, ratings that name their source
python3 merge_apify_reviews.py # Apartments.com renter reviews (paid actor)
python3 merge_units.py         # per-unit price, amenities, walk/sound scores, pet fees
python3 craigslist_pets.py     # pets_dog / pets_cat filter sweep (free, ~2 min)
python3 merge_pets.py          # attach those flags alongside the fee data
python3 add_availability.py    # is it still rentable — reuses the sweep above
# Zillow has no free liveness field, so its availability is rebuilt separately:
# presence in today's search feed, then the unit table on building pages. These
# were run by hand after every refresh until now, which is why a fresh scrape
# kept coming back with a thousand listings marked "unknown" - the pipeline
# wiped the field and nothing put it back.
python3 zillow_presence.py     # still in today's feed?  (free)
python3 add_zillow_avail.py --plain   # unit tables on building pages (free)
python3 locate.py              # recover addresses Craigslist hid, from the listing text
python3 add_descriptions.py    # craigslist posting bodies (free)
python3 add_zillow_apify.py    # zillow prose + floor area (~$3, the only paid description step)
python3 add_qualities.py       # view, two levels, top floor, on-site manager, from the prose
# What the pictures show and the advert does not: light, a blocked outlook,
# tired fittings, and which "photos" are floor plans rather than rooms. About
# $1.60 for the full set and five minutes, so it runs after the prose steps
# rather than instead of them - they are free and they cover different ground.
uv run --with pillow --with google-genai python add_photo_review.py

# One builder, not two. This step used to inline its own copy of the page
# assembly, which predated build_pages.py and had drifted: it knew nothing about
# the redesign, so a full re-scrape refreshed the old page and left the new one
# showing yesterday's listings with today's timestamp.
echo "==> 4/4  rebuilding the pages"
python3 build_pages.py

echo
echo "Done. Reload the page."
echo "New listings sit at the top marked 'New to you'; price drops are flagged."
