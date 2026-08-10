"""Public-release validation checks for Casita.

This is intentionally lightweight: it catches private operational strings and
fixture leaks without turning the interview repo into a fully tested project.
"""

from __future__ import annotations

import re
import sqlite3
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = [
    ROOT / "fixtures" / "demo.sqlite",
    ROOT / "src" / "casita" / "fixtures" / "demo.sqlite",
]

PRIVATE_PATTERNS = {
    "selected home": re.compile(r"Blithedale", re.IGNORECASE),
    "dog names": re.compile(r"Limoncello|Pancetta", re.IGNORECASE),
    "private infra": re.compile(r"casita-mb|openclaw-mb-state", re.IGNORECASE),
    "api key": re.compile(r"AIza[0-9A-Za-z_-]+"),
    "private email": re.compile(r"(matin@|mtamizi@|@imperfect\.)", re.IGNORECASE),
    "phone number": re.compile(
        r"(?<![\d.-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?![\d.-])"
    ),
    "private prompt detail": re.compile(r"Creative Director|MX plates", re.IGNORECASE),
}

PERSONAL_NAME_PATTERN = re.compile(r"\b(Matin|Bibiana|matin|bibiana)\b")

PUBLIC_PROJECT_REFERENCES = (
    "https://github.com/matin/casita",
    "https://matin.github.io/casita/",
    "https://matin.github.io/casita",
    "matin/casita",
)

TEXT_SUFFIXES = {
    ".md",
    ".py",
    ".toml",
    ".txt",
    ".example",
    ".envrc",
    ".gitignore",
    ".gitattributes",
    ".yml",
    ".yaml",
    # Data and markup were both missing, and that is precisely where a leak
    # ends up. This validator carried an `AIza…` pattern from the beginning and
    # still reported "public validation passed" on a committed .json holding a
    # live Google API key, because it had never been given a reason to open the
    # file. A check that cannot see the largest thing in the tree is not a
    # check. Committed data files are the highest-risk surface here, not the
    # lowest, so they are scanned first now.
    ".json",
    ".html",
    ".js",
    ".css",
}

def _is_text_path(path: Path) -> bool:
    return path.name in {"Makefile", "LICENSE"} or path.suffix in TEXT_SUFFIXES


# Runtime artefacts, all gitignored, none of them published. They are listed
# here because this validator asks "could a reader of the repo see this", and a
# directory that never ships cannot leak. `.chrome-profile` in particular is
# not merely noise: Chromium's Service Worker cache writes an `index.txt` that
# is binary, so scanning it crashed the validator outright the first time
# anyone ran `casita search` -- a leak check that dies on a cache file reports
# nothing at all, which is the one failure mode it cannot afford.
IGNORED_DIRS = {
    ".git", ".venv", ".cache", "site", "tmp",
    ".chrome-profile",       # persistent Playwright profile
    "node_modules", ".vercel", "__pycache__", ".pytest_cache", ".ruff_cache",
    "public",               # research/public: the generated deploy directory
}


def _published_paths() -> set[Path] | None:
    """Everything git would actually hand a reader: tracked, plus staged adds.

    The question this validator asks is "could someone who clones this see it",
    and git already knows the answer exactly. Deriving the set from .gitignore
    by hand drifts the moment an ignore rule changes -- which is how widening
    the suffix list turned up four *gitignored* scratch files and buried the
    one committed file that genuinely mattered.

    Returns None outside a git checkout, in which case the caller falls back to
    walking the tree.
    """
    try:
        out = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {ROOT / p for p in out.split("\0") if p}


def _iter_project_text() -> list[tuple[Path, str]]:
    out: list[tuple[Path, str]] = []
    published = _published_paths()
    for path in ROOT.rglob("*"):
        if path == Path(__file__).resolve():
            continue
        if published is not None and path not in published:
            continue
        if any(part in IGNORED_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if not path.is_file() or not _is_text_path(path):
            continue
        try:
            out.append((path, path.read_text(encoding="utf-8")))
        except UnicodeDecodeError:
            # A text-suffixed file that is not text. Scan the decodable parts
            # rather than skipping it: the patterns this looks for are ASCII,
            # so they survive the replacement, and silently passing over a file
            # is how a validator ends up green while a secret sits in the tree.
            out.append((path, path.read_text(encoding="utf-8", errors="replace")))
    return out


def _fixture_text(fixture: Path) -> str:
    if not fixture.exists():
        raise SystemExit(f"Missing fixture: {fixture}")
    chunks: list[str] = []
    with sqlite3.connect(fixture) as conn:
        conn.row_factory = sqlite3.Row
        tables = [
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            if not row["name"].startswith("sqlite_")
        ]
        for table in tables:
            columns = [
                row["name"]
                for row in conn.execute(f"PRAGMA table_info({table})")
                if row["type"].upper() in {"TEXT", "TIMESTAMP"} or not row["type"]
            ]
            if not columns:
                continue
            quoted = ", ".join(f'"{col}"' for col in columns)
            for row in conn.execute(f'SELECT {quoted} FROM "{table}"'):
                chunks.extend(str(value) for value in row if value is not None)
    return "\n".join(chunks)


def _without_public_project_references(text: str) -> str:
    for value in PUBLIC_PROJECT_REFERENCES:
        text = text.replace(value, "")
    return text


# Known collisions between a private-data pattern and legitimate public data.
#
# `places.json` is an OpenStreetMap point-of-interest index, and San Francisco
# contains a business called Limoncello. The "dog names" pattern is looking for
# a pet's name written into prose or config; a bar's name in a public gazetteer
# is a coincidence, not a leak.
#
# Exempted per file and per pattern rather than by weakening the pattern, so it
# still fires everywhere it should. Anything added here needs a reason written
# next to it.
ALLOWED_MATCHES = {
    ("research/pipeline/places.json", "dog names"),
}


def main() -> None:
    failures: list[str] = []
    for path, text in _iter_project_text():
        text = _without_public_project_references(text)
        patterns = PRIVATE_PATTERNS.copy()
        patterns["personal names"] = PERSONAL_NAME_PATTERN
        rel = path.relative_to(ROOT)
        for label, pattern in patterns.items():
            if (rel.as_posix(), label) in ALLOWED_MATCHES:
                continue
            if pattern.search(text):
                failures.append(f"{rel}: matched {label}")

    for fixture in FIXTURES:
        fixture_text = _without_public_project_references(_fixture_text(fixture))
        for label, pattern in {**PRIVATE_PATTERNS, "personal names": PERSONAL_NAME_PATTERN}.items():
            if pattern.search(fixture_text):
                failures.append(f"{fixture.relative_to(ROOT)}: matched {label}")

    if failures:
        raise SystemExit("Public validation failed:\n- " + "\n- ".join(failures))
    print("public validation passed")


if __name__ == "__main__":
    main()
