#!/usr/bin/env python3
"""Curben / OpenPhish source rule (owner decisions #13 and #18b, 2026-11-02).

The ONE list from Curben's project (curbengh / malware-filter) that Gecko
Adblock may use is urlhaus-filter: URLhaus data (abuse.ch, CC0), source id
`urlhaus_hosts`, fetched only from

    https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt

Every other list of that project (its phishing list in particular, which is
curated from phishing feeds) and every OpenPhish source is refused.

What is checked (text, no code is run):
  * manifest.json, every src/**/*.js (comment lines skipped; the update.js
    RETIRED_LISTS line is skipped because it names the dropped list on purpose
    so old installs can purge it), src/rules/{meta,threat-meta,dnr-merge-meta}.json,
    src/rules/LICENSES.md, src/rules/README.md, and, when passed, the packer's
    SOURCES block and the release gate;
  * no banned word (BANNED below) anywhere in those texts;
  * every host or URL naming Curben's project is one of ALLOWED_REFS;
  * runtime (update.js) and packer SOURCES: the only Curben source is
    `urlhaus_hosts` at ALLOWED_URL, present exactly once; meta.json likewise.

Usage:
  python3 scripts/lib/curben_check.py --root DIR [--gate FILE] [--packer FILE] [--overrides-stdin]
Exit 0 = clean, 1 = violation (each one printed), 2 = usage / missing input.
Used by scripts/release-gate.sh (section 2c) and test/no-openphish.test.js.
--overrides-stdin (tests only): a JSON object on stdin replaces file contents
in memory, keyed by path relative to --root, or "@gate" / "@packer". Nothing
is written to disk.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ALLOWED_URL = "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt"
ALLOWED_HOST = "malware-filter.gitlab.io"
# Host-or-URL references to Curben's project that are allowed: the bare host
# (gate allow-lists), the manifest host permission, the one list URL and the
# list's own project page (attribution in LICENSES.md).
ALLOWED_REFS = {
    ALLOWED_HOST,
    ALLOWED_HOST + "/*",
    ALLOWED_URL.split("://", 1)[1],
    "gitlab.com/malware-filter/urlhaus-filter",
}
SOURCE_ID = "urlhaus_hosts"
# Words that must not appear at all in the checked texts.
BANNED = re.compile(r"open[\s_-]?phish|phishing[-_]filter|curben[-_]phishing", re.I)
# A host or URL that names Curben's project (any mirror or path).
CURBEN_REF = re.compile(
    r"(?:https?://)?(?:[a-z0-9-]+\.)*[a-z0-9-]*(?:malware-filter|curbengh|curben)[a-z0-9-]*"
    r"(?:\.[a-z0-9-]+)+(?:/[^\s\"'`)<>\],;]*)?"
    r"|(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}/[^\s\"'`)<>\],;]*(?:malware-filter|curbengh|curben)[^\s\"'`)<>\],;]*",
    re.I,
)
URL_RE = re.compile(r"https?://[^\s\"'`)<>\]]+", re.I)
OVERRIDES: dict[str, str] = {}


def read(key: str, path: Path) -> str:
    if key in OVERRIDES:
        return OVERRIDES[key]
    return path.read_text(encoding="utf-8", errors="replace")


def norm_ref(ref: str) -> str:
    r = re.sub(r"^https?://", "", ref.strip(), flags=re.I).lower()
    return r.rstrip(".").rstrip("/") if not r.endswith("/*") else r


def strip_comments(text: str, hash_comments: bool = False) -> str:
    out = []
    for line in text.splitlines():
        s = line.lstrip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        if hash_comments and s.startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


class Checker:
    def __init__(self) -> None:
        self.bad: list[str] = []

    def fail(self, where: str, what: str) -> None:
        self.bad.append(f"{where}: {what}")

    def scan_text(self, where: str, text: str) -> None:
        for m in BANNED.finditer(text):
            self.fail(where, f"banned word {m.group(0)!r}")
        for m in CURBEN_REF.finditer(text):
            if norm_ref(m.group(0)) not in ALLOWED_REFS:
                self.fail(where, f"Curben reference other than the one urlhaus-filter list: {m.group(0)!r}")

    def check_source_urls(self, where: str, entries: list[tuple[str, list[str]]]) -> None:
        """entries: (source id, [every URL in that source's definition])."""
        hits = 0
        for name, urls in entries:
            if BANNED.search(name):
                self.fail(where, f"banned source id {name!r}")
            for u in urls:
                if not CURBEN_REF.search(u):
                    continue
                if norm_ref(u) == norm_ref(ALLOWED_URL) and name == SOURCE_ID:
                    hits += 1
                elif norm_ref(u) == "gitlab.com/malware-filter/urlhaus-filter" and name == SOURCE_ID:
                    pass  # attribution link inside the licence string
                else:
                    self.fail(where, f"source {name!r} uses a Curben URL other than the urlhaus-filter list: {u!r}")
        if hits != 1:
            self.fail(where, f"expected exactly one {SOURCE_ID} source at {ALLOWED_URL}, found {hits}")


def runtime_sources(text: str) -> list[tuple[str, list[str]]]:
    start = text.find("const SOURCES = [")
    end = text.find("];", start)
    if start < 0 or end < 0:
        return []
    block = strip_comments(text[start:end])
    parts = re.split(r"\{\s*name:\s*\"", block)[1:]
    out = []
    for p in parts:
        name = p.split('"', 1)[0]
        out.append((name, URL_RE.findall(p)))
    return out


def packer_sources(text: str) -> tuple[str, list[tuple[str, list[str]]]]:
    start = text.find("SOURCES = OrderedDict(")
    end = text.find("NEVER_BLOCK_SUFFIXES", start)
    if start < 0 or end < 0:
        return "", []
    block = strip_comments(text[start:end], hash_comments=True)
    out = []
    for m in re.finditer(r"\(\s*\"([A-Za-z0-9_]+)\",\s*\{(.*?)\}\s*,?\s*\)", block, re.S):
        out.append((m.group(1), URL_RE.findall(m.group(2))))
    return block, out


def main(argv: list[str]) -> int:
    args = {"--root": None, "--gate": None, "--packer": None}
    it = iter(argv)
    for a in it:
        if a == "--overrides-stdin":
            OVERRIDES.update(json.loads(sys.stdin.read() or "{}"))
            continue
        if a not in args:
            print(f"usage: unknown argument {a!r}", file=sys.stderr)
            return 2
        args[a] = next(it, None)
    if not args["--root"]:
        print("usage: curben_check.py --root DIR [--gate FILE] [--packer FILE]", file=sys.stderr)
        return 2
    root = Path(args["--root"])
    c = Checker()

    required = ["manifest.json", "src/general/update.js", "src/rules/LICENSES.md"]
    for rel in required:
        if not (root / rel).is_file():
            print(f"missing input: {rel}", file=sys.stderr)
            return 2

    manifest_text = read("manifest.json", root / "manifest.json")
    c.scan_text("manifest.json", manifest_text)
    try:
        manifest = json.loads(manifest_text)
    except ValueError as e:
        c.fail("manifest.json", f"not JSON ({e})")
        manifest = {}
    for h in (manifest.get("host_permissions") or []) + (manifest.get("optional_host_permissions") or []):
        if CURBEN_REF.search(h) and norm_ref(h) != ALLOWED_HOST + "/*":
            c.fail("manifest.json", f"host permission {h!r}")

    for path in sorted((root / "src").rglob("*.js")):
        rel = path.relative_to(root).as_posix()
        text = read(rel, path)
        if rel == "src/general/update.js":
            text = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("const RETIRED_LISTS"))
        c.scan_text(rel, strip_comments(text))

    update_text = read("src/general/update.js", root / "src/general/update.js")
    c.check_source_urls("src/general/update.js SOURCES", runtime_sources(update_text))

    for rel in ("src/rules/meta.json", "src/rules/threat-meta.json", "src/rules/dnr-merge-meta.json"):
        p = root / rel
        if not p.is_file():
            continue
        text = read(rel, p)
        c.scan_text(rel, text)
        try:
            data = json.loads(text)
        except ValueError as e:
            c.fail(rel, f"not JSON ({e})")
            continue
        sources = data.get("sources") if isinstance(data, dict) else None
        if isinstance(sources, dict):
            entries = [(k, [v.get("url", "")] if isinstance(v, dict) and v.get("url") else []) for k, v in sources.items()]
            if rel == "src/rules/meta.json":
                c.check_source_urls(rel + " sources", entries)
            else:
                for k, _ in entries:
                    if BANNED.search(k) or (CURBEN_REF.search(k) and k != SOURCE_ID):
                        c.fail(rel, f"banned source id {k!r}")

    for rel in ("src/rules/LICENSES.md", "src/rules/README.md"):
        p = root / rel
        if p.is_file():
            c.scan_text(rel, read(rel, p))

    if args["--packer"]:
        p = Path(args["--packer"])
        if not p.is_file():
            print(f"missing input: {p}", file=sys.stderr)
            return 2
        block, entries = packer_sources(read("@packer", p))
        if not entries:
            c.fail("packer", "SOURCES block not found")
        c.scan_text("packer SOURCES", block)
        c.check_source_urls("packer SOURCES", entries)

    if args["--gate"]:
        p = Path(args["--gate"])
        if not p.is_file():
            print(f"missing input: {p}", file=sys.stderr)
            return 2
        gate = read("@gate", p)
        c.scan_text("release gate", gate)
        if "curben_check.py" not in gate:
            c.fail("release gate", "does not run scripts/lib/curben_check.py")

    if c.bad:
        print("FAIL  Curben/OpenPhish rule (only urlhaus-filter from malware-filter.gitlab.io is allowed):")
        for b in c.bad:
            print("  " + b)
        return 1
    print("PASS  Curben/OpenPhish rule: only urlhaus-filter (URLhaus data) from malware-filter.gitlab.io")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
