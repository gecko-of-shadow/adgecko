#!/usr/bin/env python3
"""The one list of files that make up the extension package.

Derived, not hand-kept, so a new script or ruleset cannot be left out of the
zip by accident (security review H-2):
  * manifest.json: background service worker, every content_scripts js/css,
    declarative_net_request rule_resources paths, action popup + icons,
    options_ui / options_page, top-level icons;
  * every importScripts(...) target in the service worker (string literals
    only; anything else is an error: no dynamic imports);
  * <script src>, <link href> and <img src> targets in the extension pages;
  * package-local paths named as string literals in packaged JS (files the
    worker or a page fetches with chrome.runtime.getURL, icon paths), followed
    to closure;
  * EXTRA below: licence / credit / provenance files, and the modules that
    are packed although nothing loads them (NEEDS OWNER, see BUILD-PROGRESS).

Usage:
  python3 scripts/lib/package_files.py --root DIR             print the list
  python3 scripts/lib/package_files.py --root DIR --check-zip Z
      the zip must hold exactly the list (every manifest / importScripts path
      included, nothing else)
Exit 0 = ok, 1 = a derived path is missing / the zip differs, 2 = usage.
Used by scripts/pack-zip.sh, scripts/release-gate.sh and test/packaging.test.js.
"""
from __future__ import annotations

import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path

# Always packed when present in the tree (licences, credits, provenance).
EXTRA_REQUIRED = [
    "src/LICENSE-EasyList.txt",
    "src/rules/CREDIT-EasyList.txt",
    "src/rules/LICENSES.md",
    "src/vendor/LICENSE-TwitchAdSolutions",
    "src/vendor/LICENSE-uBlock.md",
    "src/vendor/LICENSE-uBlock-GPLv3.txt",
    "src/vendor/README.md",
    # In the release gate's REQUIRED list; nothing loads it (dead module).
    "src/general-exclude-hosts.js",
]
EXTRA_OPTIONAL = [
    "src/rules/README.md",
    "src/rules/meta.json",
    "src/rules/threat-meta.json",
    "src/rules/cosmetic-sample.json",
    "src/vendor/ubo-youtube-meta.json",
    # Dead modules, packed before by a src/general/*.js glob. Not loaded by the
    # manifest or the worker; kept packed until the owner decides (NEEDS OWNER).
    "src/general/toggles.js",
    "src/general/exclusions.js",
    "src/general/cosmetic.js",
]

LOCAL_REF = re.compile(r"""["'`]((?:\.\./|\./)*(?:src|icons)/[A-Za-z0-9_./-]+\.(?:js|json|css|html|png|txt|md))["'`]""")
REL_REF = re.compile(r"""["'`]((?:\.\./)+icons/[A-Za-z0-9_./-]+\.png)["'`]""")
HTML_REF = re.compile(r"""<(?:script|img)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']""", re.I)
IMPORT_CALL = re.compile(r"\bimportScripts\s*\(", re.S)


def norm(base_dir: str, ref: str) -> str:
    if re.match(r"^[a-z]+:", ref) or ref.startswith("//"):
        raise ValueError(f"remote or scheme reference {ref!r}")
    if ref.startswith("/"):
        return posixpath.normpath(ref.lstrip("/"))
    return posixpath.normpath(posixpath.join(base_dir, ref))


def strip_js_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))


def import_targets(text: str) -> list[str]:
    """String-literal arguments of every importScripts(...) call."""
    out = []
    code = strip_js_comments(text)
    for m in IMPORT_CALL.finditer(code):
        depth, i = 1, m.end()
        while i < len(code) and depth:
            depth += {"(": 1, ")": -1}.get(code[i], 0)
            i += 1
        args = code[m.end():i - 1]
        lits = re.findall(r'"([^"\\]+)"|\'([^\'\\]+)\'', args)
        rest = re.sub(r'"[^"\\]*"|\'[^\'\\]*\'', "", args)
        if rest.replace(",", "").strip():
            raise ValueError(f"importScripts with a non-literal argument: {args.strip()[:80]!r}")
        out.extend(a or b for a, b in lits)
    return out


def derive(root: Path) -> tuple[list[str], list[str]]:
    """Returns (paths, problems)."""
    problems: list[str] = []
    files: set[str] = {"manifest.json"}
    m = json.loads((root / "manifest.json").read_text(encoding="utf-8"))

    def add(p: str, why: str) -> None:
        if p not in files:
            files.add(p)
            if not (root / p).is_file():
                problems.append(f"missing {p} ({why})")

    worker = (m.get("background") or {}).get("service_worker")
    if worker:
        add(worker, "background.service_worker")
    for cs in m.get("content_scripts") or []:
        for p in (cs.get("js") or []) + (cs.get("css") or []):
            add(p, "content_scripts")
    for r in ((m.get("declarative_net_request") or {}).get("rule_resources") or []):
        add(r.get("path", ""), "rule_resources " + str(r.get("id")))
    action = m.get("action") or {}
    pages = []
    if action.get("default_popup"):
        pages.append(action["default_popup"])
    for key in ("options_page",):
        if m.get(key):
            pages.append(m[key])
    if (m.get("options_ui") or {}).get("page"):
        pages.append(m["options_ui"]["page"])
    for p in pages:
        add(p, "extension page")
    icons = dict(m.get("icons") or {})
    di = action.get("default_icon")
    for v in (di.values() if isinstance(di, dict) else [di] if di else []):
        add(v, "action.default_icon")
    for v in icons.values():
        add(v, "icons")

    if worker and (root / worker).is_file():
        wdir = posixpath.dirname(worker)
        try:
            for t in import_targets((root / worker).read_text(encoding="utf-8")):
                add(norm(wdir, t), "importScripts in " + worker)
        except ValueError as e:
            problems.append(f"{worker}: {e}")

    for p in pages:
        if not (root / p).is_file():
            continue
        html = (root / p).read_text(encoding="utf-8")
        for a, b in HTML_REF.findall(html):
            try:
                add(norm(posixpath.dirname(p), a or b), "referenced by " + p)
            except ValueError as e:
                problems.append(f"{p}: {e}")

    # Package-local string literals in packaged JS, to closure. Paths named
    # relative to an extension page (popup.js: "../icons/...") resolve against
    # that page's directory (all pages live in src/).
    seen: set[str] = set()
    while True:
        todo = sorted(f for f in files if f.endswith(".js") and f not in seen and (root / f).is_file())
        if not todo:
            break
        for f in todo:
            seen.add(f)
            code = strip_js_comments((root / f).read_text(encoding="utf-8", errors="replace"))
            for ref in LOCAL_REF.findall(code):
                if ref.startswith("."):
                    continue  # handled by REL_REF below
                add(posixpath.normpath(ref), "string literal in " + f)
            for ref in REL_REF.findall(code):
                add(norm("src", ref), "string literal in " + f)

    for p in EXTRA_REQUIRED:
        add(p, "licence / credit / gate REQUIRED")
    for p in EXTRA_OPTIONAL:
        if (root / p).is_file():
            files.add(p)
    for p in sorted(files):
        if p.startswith("../") or p.startswith("/") or ".." in p.split("/"):
            problems.append(f"path escapes the package: {p}")
    return sorted(files), problems


def main(argv: list[str]) -> int:
    root, zip_path = None, None
    it = iter(argv)
    for a in it:
        if a == "--root":
            root = next(it, None)
        elif a == "--check-zip":
            zip_path = next(it, None)
        else:
            print(f"usage: unknown argument {a!r}", file=sys.stderr)
            return 2
    if not root:
        print("usage: package_files.py --root DIR [--check-zip ZIP]", file=sys.stderr)
        return 2
    files, problems = derive(Path(root))
    if problems:
        for p in problems:
            print("FAIL  " + p)
        return 1
    if zip_path:
        with zipfile.ZipFile(zip_path) as z:
            names = {n.replace("\\", "/").lstrip("./") for n in z.namelist() if not n.endswith("/")}
        missing = sorted(set(files) - names)
        extra = sorted(names - set(files))
        for p in missing:
            print("FAIL  not in zip: " + p)
        for p in extra:
            print("FAIL  unexpected in zip: " + p)
        if missing or extra:
            return 1
        print(f"PASS  zip holds exactly the {len(files)} derived package files")
        return 0
    print("\n".join(files))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
