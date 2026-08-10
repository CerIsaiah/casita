#!/usr/bin/env python3
"""Strip third-party personal data out of the data set before it is published.

A built page inlines the whole scraped corpus. That is fine on a laptop and not
fine on a public URL, because two fields in it describe identifiable people who
never opted into this project:

  landlord.name   570 owner entities read out of SF public property records.
                  Most are LLCs; about 76 are plainly individuals -- "Chris
                  Dittenhafer", "Carmelita Botelho". Lawfully public, one
                  parcel at a time, at a courthouse. Republished as a
                  searchable list attached to a rental site, it is a different
                  object than the record it came from.

  phone           731 numbers scraped off Craigslist and apartments.com ads.
                  The advertiser published them to field calls about one
                  apartment, not to seed a phone list.

Neither is load-bearing.

The Casita interface never renders an owner name -- `landlord` reaches it only
as `.conf`, the registration-confidence flag that feeds scoring and the fraud
audit. (The old huntly.html dashboard did render names, which is the other
reason built pages have always been gitignored.) So the name simply goes, and
every score, gate and audit verdict is bit-for-bit identical without it.

The phone number is rendered, but what the product actually reasons about is
whether a number was published at all -- a listing with no way to contact
anyone is the strongest single fraud signal this thing has, and the reason 677
Castro St got flagged. That survives as a boolean. The digits do not ship.

    python3 sanitize_public.py            app_data.json -> app_data.public.json
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "app_data.json"
OUT = HERE / "app_data.public.json"

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
PHONE = re.compile(r"\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b")

# Credentials that arrive *inside* scraped content.
#
# Three Zillow listings carried their hero image as a Google static-map URL
# with an API key in the query string. Zillow's key, not ours -- we never held
# one -- but scraping it verbatim and committing it republished somebody else's
# credential to a public repo, which GitHub's secret scanner noticed before we
# did.
#
# The lesson is narrower than "check for secrets": data pulled off another
# site can contain anything that site put in it, including its own keys, and a
# sanitiser that only looks for the personal data *we* went out and collected
# will miss it every time.
CREDENTIAL = re.compile(
    r"(?:AIza[0-9A-Za-z_\-]{10,}"          # Google
    r"|sk-[A-Za-z0-9]{20,}"                # OpenAI-style
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"       # Slack
    r"|gh[pousr]_[A-Za-z0-9]{20,}"         # GitHub
    r"|(?:api[_-]?key|access[_-]?token|secret)=[A-Za-z0-9_\-]{16,})",
    re.I,
)


def scrub_text(s):
    """Free text currently carries no contacts. Enforce it rather than trust it."""
    if not isinstance(s, str):
        return s
    s = EMAIL.sub("[email removed]", s)
    return PHONE.sub("[phone removed]", s)


def main():
    data = json.load(open(SRC))
    names = phones = texts = creds = 0

    for a in data:
        ll = a.get("landlord")
        if isinstance(ll, dict):
            if "name" in ll:
                names += 1
            # Reduced to the registration flag and nothing else.
            #
            # Dropping the name alone left `since` and `portfolio` behind, and
            # those are still products of an owner-name lookup -- an
            # acquisition date and a portfolio count, attached to a specific
            # address, is most of the way back to the person. AGENTS.md says
            # not to commit a fixture built from those lookups, and this file
            # now writes a committed fixture, so it has to mean it.
            #
            # Nothing is lost. Casita reads `landlord.conf` in exactly two
            # places -- the scam auditor's corroboration list and one scoring
            # bump -- and never touches the other fields. They were only ever
            # rendered by the old huntly dashboard.
            a["landlord"] = {"conf": ll.get("conf")} if ll.get("conf") else None
            if a["landlord"] is None:
                del a["landlord"]

        if a.get("phone"):
            a["has_phone"] = True
            del a["phone"]
            phones += 1

        # Drop, rather than redact, any image whose URL carries a credential.
        # Redacting the key would leave a URL that 403s, and every one of these
        # was a satellite static-map standing in for a photograph anyway -- not
        # a picture of the unit, and not something the photo count should have
        # been treating as evidence that the listing showed you anything.
        if a.get("photos"):
            kept = [u for u in a["photos"] if not CREDENTIAL.search(u or "")]
            if len(kept) != len(a["photos"]):
                creds += len(a["photos"]) - len(kept)
                a["photos"] = kept
        if a.get("photo") and CREDENTIAL.search(a["photo"]):
            a["photo"] = a["photos"][0] if a.get("photos") else None
            if a["photo"] is None:
                del a["photo"]

        for f in ("desc", "special", "shared_why", "rc_why", "name"):
            if isinstance(a.get(f), str):
                clean = scrub_text(a[f])
                if clean != a[f]:
                    a[f] = clean
                    texts += 1

    OUT.write_text(json.dumps(data, separators=(",", ":")))

    # Prove it, rather than asserting it. A sanitiser that silently stopped
    # working would look exactly like a sanitiser that had nothing to do.
    blob = OUT.read_text()
    leaks = {"email": len(EMAIL.findall(blob)), "phone": len(PHONE.findall(blob)),
             "credential": len(CREDENTIAL.findall(blob))}
    print(f"  owner names removed : {names:,}")
    print(f"  phone numbers removed: {phones:,}  (kept as has_phone)")
    print(f"  free-text scrubs     : {texts:,}")
    print(f"  credentialed images  : {creds:,}  (dropped)")
    print(f"  wrote {OUT.name}  ({OUT.stat().st_size / 1e6:.1f} MB)")
    print(f"  residual in output   : {leaks}")
    if any(leaks.values()):
        raise SystemExit("refusing to ship: contact data still present")
    # `name` is also the building name, which is fine, so this checks the
    # landlord objects themselves rather than grepping the blob. Anything on a
    # landlord other than `conf` is a leak by the rule above, so the assertion
    # is exact rather than a list of fields to remember to add to.
    for a in json.loads(blob):
        ll = a.get("landlord")
        if isinstance(ll, dict) and set(ll) - {"conf"}:
            raise SystemExit(
                f"refusing to ship: landlord carries {sorted(set(ll) - {'conf'})}")
    print("  clean")


if __name__ == "__main__":
    main()
