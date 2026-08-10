/* hoods.js — what a neighbourhood is known for, and where it stops.
   ============================================================
   Two problems with the neighbourhood labels that arrive in the data.

   First, they are bare names. "Nob Hill" tells a renter who already knows San
   Francisco everything and a renter moving from Chicago nothing, and the
   second renter is the one who needs a rental product.

   Second, and more usefully wrong: they are flat. Lower Nob Hill and the crest
   of Nob Hill are one label in the data and two different places to live —
   different rents, different blocks after dark, different walk to a train.
   Same for the Haight, the Mission and the Richmond. So a handful of the
   neighbourhoods that genuinely split get a dividing line here, drawn on the
   street everyone already uses as the boundary.

   Only the ones worth splitting are split. There are 91 labels in the data and
   inventing sub-areas for all of them would be fiction; these are the divisions
   locals actually name, and each says which street it is drawn on so a reader
   can disagree with it.

   The blurbs describe what a place is known for, in the flat register the rest
   of the product uses. They are editorial, they say so, and they never carry a
   claim about the people who live there — only about streets, transport, hills
   and what is open at night. */

const HOODS = (() => {
  "use strict";

  /* A split is: the axis to compare on, the threshold, and what each side is
     called. `lat` splits north/south, `lon` splits east/west. */
  const SPLITS = {
    "Nob Hill": {
      axis: "lat", at: 37.7925, above: "Upper Nob Hill", below: "Lower Nob Hill",
      on: "roughly Pine Street",
      note: {
        "Upper Nob Hill": "The crest - cable-car lines, grand pre-war buildings, quiet after dark and a steep walk home from anywhere.",
        "Lower Nob Hill": "The flat blocks toward the Tenderloin. Cheaper, busier, closer to transit, and the street feels markedly different after 10 PM.",
      },
    },
    "Haight Ashbury": {
      axis: "lon", at: -122.4445, above: "Lower Haight", below: "Upper Haight",
      on: "roughly Divisadero",
      note: {
        "Upper Haight": "Tourist Haight - Golden Gate Park at the end of the street, Victorian flats, busy shopfronts by day.",
        "Lower Haight": "Smaller, more residential, better bars, an easier walk to Hayes Valley and the Wiggle.",
      },
    },
    "Mission": {
      axis: "lat", at: 37.7585, above: "North Mission", below: "Outer Mission edge",
      on: "roughly 22nd Street",
      note: {
        "North Mission": "Valencia and 16th - the densest concentration of restaurants and bars in the city, and the noise that comes with it.",
        "Outer Mission edge": "Quieter, more families, cheaper per square foot, longer walk to BART.",
      },
    },
    "Richmond District": {
      axis: "lon", at: -122.4830, above: "Inner Richmond", below: "Outer Richmond",
      on: "roughly Park Presidio",
      note: {
        "Inner Richmond": "Clement Street - food-dense, walkable, close to the Presidio and Golden Gate Park.",
        "Outer Richmond": "Foggier, quieter, cheaper, and a long trip downtown. Ocean Beach at the end of the road.",
      },
    },
    "Sunset/Parkside": {
      axis: "lon", at: -122.4870, above: "Inner Sunset", below: "Outer Sunset",
      on: "roughly 19th Avenue",
      note: {
        "Inner Sunset": "Irving Street, UCSF, and the park on your doorstep. The best-connected part of the west side.",
        "Outer Sunset": "Fog, surf, quiet residential blocks and the longest commute in the city.",
      },
    },
  };

  /* What each neighbourhood is known for. Deliberately short — one sentence a
     newcomer can act on, not a guidebook entry. */
  const NOTES = {
    "Tenderloin": "Central, cheap and very walkable, with the most concentrated street conditions in the city. Read the Street tab before deciding.",
    "SoMa": "Warehouses turned flats, close to Caltrain and the ballpark. Quiet on Sundays, thin on groceries.",
    "South of Market": "Warehouses turned flats, close to Caltrain and the ballpark. Quiet on Sundays, thin on groceries.",
    "Mission Bay": "New construction, wide pavements, hospitals and the arena. Purpose-built and still filling in.",
    "Pacific Heights": "Expensive, quiet, well-kept, and steep. Fillmore Street for shops, long walk to a train.",
    "Marina": "Flat, sunny, waterfront running, and a young after-work bar scene on Chestnut.",
    "Russian Hill": "Hilltop residential with Polk Street below it. Beautiful, steep, and quiet at night.",
    "Hayes Valley": "Small, central and walkable - the theatre district's neighbourhood, with good food and no supermarket.",
    "North Beach": "Italian North Beach: cafés, late bars, tight streets and difficult parking.",
    "Chinatown": "The densest blocks in the city, superb groceries, very central, very little quiet.",
    "Castro": "Historic and social, with a strong late-night scene and easy Muni Metro access.",
    "Noe Valley": "Family-heavy, sunny, quiet, and a hill away from the nearest train.",
    "Potrero Hill": "Sunny, steep and residential, with warehouse blocks below and a car-shaped commute.",
    "Dogpatch": "Former shipyard blocks, breweries and galleries, T-line to downtown, still industrial in patches.",
    "Bernal Heights": "Village-ish, sunny, dog-heavy, with a park on top and a long trip to anywhere else.",
    "Glen Park": "A small village centre around a BART station - unusually well connected for how quiet it is.",
    "Civic Center": "Government buildings and transit interchange. Extremely central; street conditions are the trade.",
    "Financial District": "Weekday city. Superb transit, thin on evening life, and quiet at weekends.",
    "Nob Hill": "Steep, central and residential, with cable cars over the top and the Tenderloin at the bottom.",
    "Japantown": "Compact and central, built around the mall and Peace Plaza, well served by buses.",
    "Excelsior": "Quiet, residential, and among the more affordable parts of the city. Mission Street for buses.",
    "Bayview": "Sunniest part of San Francisco, industrial in places, cheapest per square foot, thinnest transit.",
    "Presidio": "A national park you can live in. Quiet, green, expensive, and reliant on a car or a shuttle.",
    "West Portal": "A high street with a Muni tunnel under it - suburban feel, direct ride downtown.",
    "Inner Richmond": "Clement Street - food-dense, walkable, close to the Presidio and Golden Gate Park.",
    "Outer Richmond": "Foggier, quieter, cheaper, and a long trip downtown. Ocean Beach at the end of the road.",
    "Inner Sunset": "Irving Street, UCSF, and the park on your doorstep. The best-connected part of the west side.",
    "Outer Sunset": "Fog, surf, quiet residential blocks and the longest commute in the city.",
  };

  /* ---------- districts ----------
     Forty-odd neighbourhood names in a dropdown is a list, not a choice. San
     Franciscans do not think in forty units either — they think in about seven
     parts of town, and only get specific once they have picked one. So the
     filter asks the easy question first and the precise one second, and most
     people never need the second.

     Anything unlisted falls into "Elsewhere" rather than being dropped, so the
     districts never silently hide inventory. */
  const DISTRICTS = [
    ["Downtown & SoMa", "downtown", ["SoMa", "South of Market", "Financial District", "Civic Center",
      "Tenderloin", "Union Square", "Mission Bay", "Yerba Buena", "Rincon Hill", "South Beach",
      "Financial District/South Beach", "Rincon", "Transbay", "Cathedral Hill/Intermission"]],
    ["North", "north", ["North Beach", "Russian Hill", "Nob Hill", "Upper Nob Hill", "Lower Nob Hill",
      "Chinatown", "Telegraph Hill", "Embarcadero", "Polk Gulch", "Lower Nob"]],
    ["Marina & Heights", "heights", ["Marina", "Pacific Heights", "Cow Hollow", "Presidio",
      "Presidio Heights", "Laurel Heights", "Japantown", "Lower Pacific Heights",
      "Lone Mountain/USF"]],
    ["Castro & Mission", "grid", ["Castro/Upper Market", "Castro", "Mission", "North Mission",
      "Outer Mission edge", "Noe Valley", "Duboce Triangle", "Eureka Valley", "Dolores Heights",
      "Mission Dolores"]],
    ["Haight & Hayes", "park", ["Hayes Valley", "Haight Ashbury", "Upper Haight", "Lower Haight",
      "Cole Valley", "NoPa", "Western Addition", "Alamo Square"]],
    ["The Avenues", "avenues", ["Inner Richmond", "Outer Richmond", "Richmond District",
      "Inner Sunset", "Outer Sunset", "Sunset/Parkside", "Seacliff", "Lakeshore", "West Portal",
      "Central Sunset", "Stonestown", "Westlake", "Forest Knolls"]],
    ["South & East", "hills", ["Bernal Heights", "Potrero Hill", "Dogpatch", "Glen Park", "Excelsior",
      "Bayview", "Visitacion Valley", "Portola", "Ingleside", "Sunnyside", "Twin Peaks",
      "West of Twin Peaks", "Outer Mission", "Bayview Hunters Point", "Potrero",
      "Oceanview/Merced/Ingleside", "Diamond Heights", "Mission Terrace", "Treasure Island"]],
  ];

  const districtOf = (area) => {
    const hit = DISTRICTS.find(([, , list]) => list.includes(area));
    return hit ? hit[0] : "Elsewhere";
  };

  // Districts present in the data, with counts, plus the areas inside one.
  function districts(all) {
    const n = new Map();
    for (const a of all) {
      const d = districtOf(areaOf(a));
      n.set(d, (n.get(d) || 0) + 1);
    }
    return DISTRICTS.map(([name, icon]) => ({ name, icon, n: n.get(name) || 0 }))
      .filter((d) => d.n >= 5)
      .concat(n.get("Elsewhere") >= 5 ? [{ name: "Elsewhere", icon: "pin", n: n.get("Elsewhere") }] : []);
  }

  function areasIn(all, district) {
    const n = new Map();
    for (const a of all) {
      const k = areaOf(a);
      if (districtOf(k) !== district) continue;
      n.set(k, (n.get(k) || 0) + 1);
    }
    // Only the areas with real inventory, and only a handful of them: eleven
    // chips is the dropdown again in a different costume. Anything smaller
    // stays reachable through "Whole district".
    return [...n.entries()].filter(([, c]) => c >= 12)
      .sort((x, y) => y[1] - x[1]).slice(0, 5);
  }

  // Where a listing sits, once the splits are applied.
  function areaOf(a) {
    const base = a.hood || "San Francisco";
    const s = SPLITS[base];
    if (!s) return base;
    const v = s.axis === "lat" ? a.lat : a.lon;
    return v >= s.at ? s.above : s.below;
  }

  function noteFor(area, base) {
    const s = SPLITS[base];
    if (s && s.note[area]) return s.note[area];
    return NOTES[area] || NOTES[base] || null;
  }

  // "Lower Nob Hill · split from Nob Hill at roughly Pine Street"
  function splitNote(base) {
    const s = SPLITS[base];
    return s ? `Casita splits ${base} at ${s.on}; the two halves rent and feel differently.` : null;
  }

  // Every area present in the current data, with a count, for the filter.
  function index(all) {
    const n = new Map();
    for (const a of all) {
      const k = areaOf(a);
      n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n.entries()].filter(([, c]) => c >= 3).sort((x, y) => y[1] - x[1]);
  }

  return { areaOf, noteFor, splitNote, index, districts, areasIn, districtOf,
           SPLITS, NOTES };
})();
