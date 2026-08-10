"""Write JSON without the chance of destroying what was already there.

Five scripts in this pipeline rewrite app_data.json in place, and `open(path,"w")`
truncates the moment it is called. A crash, a kill, or a full disk part-way
through `json.dump` therefore leaves a half-written 5.8 MB file and no copy of
the good one anywhere in the tree -- the only recovery is a full re-scrape, which
costs Apify credit.

Writing to a sibling temp file and renaming makes the swap atomic on POSIX: the
old file stays intact and complete until the new one is whole.
"""
import json, os


def dump(obj, path, **kw):
    kw.setdefault("separators", (",", ":"))
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, **kw)
        os.replace(tmp, path)          # atomic; never a partial `path`
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
