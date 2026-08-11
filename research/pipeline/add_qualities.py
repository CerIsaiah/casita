#!/usr/bin/env python3
"""Read the qualities that decide a flat but never appear as a checkbox.

Amenity lists are the easy half. They tell you there is laundry and a
dishwasher, and nothing about whether the place is worth your evening. What
actually separates two flats at the same price is the shape of them: a
two-floor loft, a view worth sitting in front of, real square footage, a top
floor, light. And on the other side, the things an advert mentions because it
has to -- the manager living on the same landing, a ground-floor window onto
the street, a room with no window at all.

None of that is a structured field on any of the three sources. It is written
in prose, or not written anywhere.

Three rules this holds to, borrowed from the rest of the project:

  1. Quote the evidence. Every quality carries the sentence it came from, so a
     reader can disagree with the extractor rather than take its word. A claim
     with no quotable source is not made.

  2. Absence is not a verdict. A listing with no description is not a listing
     without a view; it is a listing we cannot read. Those come back empty and
     the interface says so, rather than scoring them as lacking.

  3. Say what the text says, not what it implies about the landlord. "The
     manager lives on site" is a fact from the advert. Whether that is good or
     bad depends entirely on the renter, so it is surfaced and left unweighted.

    python3 add_qualities.py        reads app_data.json, writes it back
"""
import json
import pathlib
import re

import atomicjson

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "app_data.json"

# Each quality: (key, label, pattern, polarity)
#   polarity  +1 a thing people pay for, -1 a thing they discount for,
#              0 genuinely depends on the reader
#
# Patterns stay narrow on purpose. "view" alone matches "viewing appointment"
# and "in view of the fact"; the discount for a false positive here is a claim
# about a flat that is not true, which costs more than a miss.
QUALITIES = [
    ("two_level", "Two levels", +1, re.compile(
        r"\b(two[- ]?(?:level|stor(?:y|ey)|floor)s?|2[- ]?(?:level|stor(?:y|ey))"
        r"|split[- ]level|mezzanine|loft(?:ed)?\s+(?:bedroom|space|style|area)"
        r"|spiral\s+stair|internal\s+stair|own\s+stair)\b", re.I)),

    ("view", "A view", +1, re.compile(
        r"\b((?:bay|city|ocean|water|bridge|skyline|park|golden\s+gate|downtown|"
        r"panoramic|sweeping|unobstructed)\s+views?"
        r"|views?\s+of\s+the\s+\w+"
        r"|views?\s+(?:of|over|across)\s+(?:the\s+)?(?:bay|city|ocean|park|bridge|skyline))\b", re.I)),

    ("light", "Good light", +1, re.compile(
        r"\b(floor[- ]to[- ]ceiling\s+windows?|wall\s+of\s+windows|skylights?"
        r"|sun[- ]?(?:drenched|filled|ny\s+(?:and|throughout))|south[- ]facing"
        r"|abundant\s+natural\s+light|flooded\s+with\s+light|bright\s+and\s+airy)\b", re.I)),

    ("top_floor", "Top floor", +1, re.compile(
        r"\b(top[- ]floor|penthouse|top\s+of\s+the\s+building)\b", re.I)),

    ("outdoor", "Private outdoor space", +1, re.compile(
        r"\b(private\s+(?:patio|deck|balcony|yard|garden|terrace|roof)"
        r"|own\s+(?:patio|deck|balcony|yard|garden)"
        r"|exclusive\s+use\s+(?:of\s+)?(?:the\s+)?(?:yard|garden|patio|deck))\b", re.I)),

    ("renovated", "Recently renovated", +1, re.compile(
        r"\b(newly\s+(?:renovated|remodell?ed|rebuilt)|just\s+renovated"
        r"|gut\s+renovat|fully\s+remodell?ed|brand[- ]new\s+kitchen)\b", re.I)),

    # The ones adverts mention because they must.
    ("onsite_manager", "Manager or owner on site", 0, re.compile(
        r"\b((?:owner|manager|landlord)\s+(?:lives?|resides?|occupies)"
        r"|owner[- ]occupied|live[- ]in\s+(?:manager|owner|super)"
        r"|manager\s+on[- ]?site|on[- ]?site\s+manager\s+lives)\b", re.I)),

    ("ground_floor", "Ground floor", -1, re.compile(
        r"\b(ground[- ]floor|garden\s+level|below\s+(?:street|grade)|basement\s+(?:unit|apartment)"
        r"|lower\s+level\s+unit)\b", re.I)),

    ("no_window", "A room without a window", -1, re.compile(
        r"\b(no\s+windows?|windowless|interior\s+bedroom|den\s+with\s+no\s+window)\b", re.I)),

    ("shared_bath", "Shared bathroom or kitchen", -1, re.compile(
        r"\b(shared\s+(?:bath|bathroom|kitchen)|bathroom\s+is\s+shared)\b", re.I)),
]

# Square footage written into the prose, which is the only place it appears for
# a lot of listings. Guarded hard: "1200" alone is a price, a street number or a
# postcode far more often than a floor area.
SQFT_RE = re.compile(r"\b([1-9]\d{2,3})\s*(?:\+\s*)?(?:sq\.?\s*(?:ft|feet)|sqft|square\s+feet)\b", re.I)


# Phrases that mean the match is about the building, not the flat. "Retail on
# the ground floor" is a fact about the shops downstairs; recording it as "this
# apartment is on the ground floor" is a claim about the flat that the advert
# never made, and it carried a penalty.
NOT_THE_UNIT = re.compile(
    r"\b(retail|commercial|lobby|shops?|restaurant|cafe|café|storefront|"
    r"parking|garage|amenit(?:y|ies)|gym|lounge|leasing\s+office|mail\s?room|rooftop|roof\s+deck|common\s+area|shared\s+(?:deck|terrace|roof))\b", re.I)


def about_the_unit(text, m, window=70):
    """False when the sentence is describing the building around the match."""
    near = text[max(0, m.start() - window):m.end() + window]
    return not NOT_THE_UNIT.search(near)


def sentence_around(text, m):
    """The clause the match sits in, always including the matched phrase.

    The first version anchored on the start of the sentence and truncated at a
    fixed length, which for a long marketing paragraph cut the quote off before
    the evidence -- a quotation that does not contain the thing it is quoting.
    The window is centred on the match instead.
    """
    start = max(text.rfind(".", 0, m.start()), text.rfind("!", 0, m.start()),
                text.rfind("\n", 0, m.start())) + 1
    end = min([x for x in (text.find(".", m.end()), text.find("!", m.end()),
                           text.find("\n", m.end())) if x != -1] or [len(text)])
    s = " ".join(text[start:end + 1].split())
    if len(s) <= 158:
        return s
    # Too long: centre on the matched phrase so it survives the trim.
    phrase = " ".join(text[m.start():m.end()].split())
    i = s.lower().find(phrase.lower())
    if i == -1:
        return s[:157] + "…"
    lo = max(0, i - 70)
    hi = min(len(s), i + len(phrase) + 70)
    return ("…" if lo else "") + s[lo:hi].strip() + ("…" if hi < len(s) else "")


def read(a):
    """Everything the listing wrote in words, in one blob."""
    parts = [a.get("name") or "", a.get("special") or ""]
    d = a.get("desc")
    if d and d != "None":
        parts.append(d)
    return "\n".join(p for p in parts if p).strip()


def main():
    data = json.load(open(DATA))
    found = {k: 0 for k, _, _, _ in QUALITIES}
    sqft_from_text = readable = 0

    for a in data:
        text = read(a)
        a.pop("qualities", None)
        a.pop("sqft_said", None)
        if not text:
            # Rule 2: nothing to read is not the same as nothing there.
            a["text_read"] = False
            continue
        a["text_read"] = True
        readable += 1

        out = []
        for key, label, polarity, pat in QUALITIES:
            m = pat.search(text)
            # Physical facts about the flat can be stated about the building
            # instead; the polarity-bearing ones are the ones worth guarding.
            while m and key in ("ground_floor", "top_floor", "outdoor", "no_window", "view") \
                    and not about_the_unit(text, m):
                m = pat.search(text, m.end())
            if not m:
                continue
            found[key] += 1
            out.append({"k": key, "label": label, "pol": polarity,
                        "quote": sentence_around(text, m)})
        if out:
            a["qualities"] = out

        # Only trust prose square footage when the record has none of its own,
        # and only when it is a plausible flat rather than a lot size.
        if not a.get("sqft"):
            m = SQFT_RE.search(text)
            if m and 150 <= int(m.group(1)) <= 6000:
                a["sqft_said"] = int(m.group(1))
                sqft_from_text += 1

    atomicjson.dump(data, str(DATA))
    print(f"  listings with readable text: {readable:,} of {len(data):,}")
    print(f"  square footage recovered from prose: {sqft_from_text:,}")
    for key, label, _, _ in QUALITIES:
        if found[key]:
            print(f"    {label:28} {found[key]:>5}")


if __name__ == "__main__":
    main()
