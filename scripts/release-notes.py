#!/usr/bin/env python3
"""Print the CHANGELOG.md section for one version, for the GitHub release body.

    python3 -I scripts/release-notes.py 0.3.4 [CHANGELOG.md]

The section runs from its "## <version> (" heading up to the next "## "
heading; its "### " subsections (rollback steps) are kept. Exits 1 when the
version has no section, so a release is never published with empty notes.
"""
import sys
from pathlib import Path


def section(text: str, version: str) -> str:
    out = []
    inside = False
    for line in text.splitlines():
        if line.startswith("## "):
            if inside:
                break
            inside = line.startswith(f"## {version} (")
        if inside:
            out.append(line)
    return "\n".join(out).strip() + "\n" if out else ""


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    version = argv[1]
    path = Path(argv[2]) if len(argv) == 3 else Path(__file__).resolve().parent.parent / "CHANGELOG.md"
    notes = section(path.read_text(encoding="utf-8"), version)
    if not notes:
        print(f"ERROR: {path} has no '## {version} (' section", file=sys.stderr)
        return 1
    sys.stdout.write(notes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
