#!/usr/bin/env python3
"""Merge stream-exclusion allows + list-pack block rules into general-network.json.

Uses the same domain lists as src/general-exclude-hosts.js (buildDnrExclusionRules).
Renumbers list-pack block ids so they never collide with exclusion ids 1–2.
Does not edit playback files.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "rules" / "general-network.json"
META_OUT = ROOT / "src" / "rules" / "dnr-merge-meta.json"
LIST_BLOCKS = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else ROOT / "scripts" / ".dnr-cache" / "general-network.blocks.json"
)

# Keep in sync with src/general-exclude-hosts.js
SITE_DOMAINS = [
    "twitch.tv",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "youtubekids.com",
    "kick.com",
]
VIDEO_CDN_DOMAINS = [
    "ttvnw.net",
    "jtvnw.net",
    "twitchcdn.net",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "live-video.net",
]

EXCLUSION_ID_START = 1
EXCLUSION_PRIORITY = 2_000_000
BLOCK_ID_START = 100
BLOCK_PRIORITY = 1


def build_exclusion_rules() -> list[dict]:
    return [
        {
            "id": EXCLUSION_ID_START,
            "priority": EXCLUSION_PRIORITY,
            "action": {"type": "allowAllRequests"},
            "condition": {
                "requestDomains": list(SITE_DOMAINS),
                "resourceTypes": ["main_frame", "sub_frame"],
            },
        },
        {
            "id": EXCLUSION_ID_START + 1,
            "priority": EXCLUSION_PRIORITY,
            "action": {"type": "allow"},
            "condition": {"requestDomains": list(VIDEO_CDN_DOMAINS)},
        },
    ]


def main() -> int:
    if not LIST_BLOCKS.is_file():
        print(f"missing block rules: {LIST_BLOCKS}", file=sys.stderr)
        return 2
    blocks = json.loads(LIST_BLOCKS.read_text(encoding="utf-8"))
    if not isinstance(blocks, list):
        print("block rules must be a JSON array", file=sys.stderr)
        return 2

    renumbered = []
    rid = BLOCK_ID_START
    for rule in blocks:
        if rule.get("action", {}).get("type") != "block":
            # List-pack should be blocks only; skip stray allows from older stubs.
            continue
        next_rule = {
            "id": rid,
            "priority": BLOCK_PRIORITY,
            "action": {"type": "block"},
            "condition": {"requestDomains": list(rule["condition"]["requestDomains"])},
        }
        renumbered.append(next_rule)
        rid += 1

    allows = build_exclusion_rules()
    merged = allows + renumbered
    ids = [r["id"] for r in merged]
    if len(ids) != len(set(ids)):
        print("duplicate rule ids after merge", file=sys.stderr)
        return 2
    if len(merged) > 30000:
        print(f"rule count {len(merged)} exceeds 30000", file=sys.stderr)
        return 2

    OUT.write_text(json.dumps(merged, separators=(",", ":")), encoding="utf-8")
    meta = {
        "merged_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ruleset_id": "general",
        "path": "src/rules/general-network.json",
        "allow_rules": len(allows),
        "block_rules": len(renumbered),
        "rule_count": len(merged),
        "exclusion_priority": EXCLUSION_PRIORITY,
        "site_domains": SITE_DOMAINS,
        "video_cdn_domains": VIDEO_CDN_DOMAINS,
        "block_id_start": BLOCK_ID_START,
        "source_blocks": str(LIST_BLOCKS),
    }
    META_OUT.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
