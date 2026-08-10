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


def scrub_text(s):
    """Free text currently carries no contacts. Enforce it rather than trust it."""
    if not isinstance(s, str):
        return s
    s = EMAIL.sub("[email removed]", s)
    return PHONE.sub("[phone removed]", s)


def main():
    data = json.load(open(SRC))
    names = phones = texts = 0

    for a in data:
        ll = a.get("landlord")
        if isinstance(ll, dict) and "name" in ll:
            del ll["name"]
            names += 1

        if a.get("phone"):
            a["has_phone"] = True
            del a["phone"]
            phones += 1

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
    leaks = {"email": len(EMAIL.findall(blob)), "phone": len(PHONE.findall(blob))}
    print(f"  owner names removed : {names:,}")
    print(f"  phone numbers removed: {phones:,}  (kept as has_phone)")
    print(f"  free-text scrubs     : {texts:,}")
    print(f"  wrote {OUT.name}  ({OUT.stat().st_size / 1e6:.1f} MB)")
    print(f"  residual in output   : {leaks}")
    if any(leaks.values()):
        raise SystemExit("refusing to ship: contact data still present")
    if "landlord" in blob and '"name"' in blob:
        # `name` is also the building name, which is fine; only flag if a
        # landlord object still carries one.
        for a in json.loads(blob):
            if isinstance(a.get("landlord"), dict) and a["landlord"].get("name"):
                raise SystemExit("refusing to ship: owner name still present")
    print("  clean")


if __name__ == "__main__":
    main()
