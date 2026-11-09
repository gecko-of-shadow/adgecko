#!/usr/bin/env python3
"""Merge stream-exclusion allows + list-pack block rules into general-network.json.

Uses the same domain lists as src/general-exclude-hosts.js (buildDnrExclusionRules).
Renumbers list-pack block ids so they never collide with exclusion ids 1–2.
Does not edit playback files.
"""
from __future__ import annotations

import json
import re
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
    frame_allow_all = [domain for domain in SITE_DOMAINS if domain != "twitch.tv"]
    return [
        {
            "id": EXCLUSION_ID_START,
            "priority": EXCLUSION_PRIORITY,
            "action": {"type": "allowAllRequests"},
            "condition": {
                "requestDomains": frame_allow_all,
                "resourceTypes": ["main_frame", "sub_frame"],
            },
        },
        {
            "id": EXCLUSION_ID_START + 1,
            "priority": EXCLUSION_PRIORITY,
            "action": {"type": "allow"},
            "condition": {
                "requestDomains": ["twitch.tv"],
                "excludedRequestDomains": ["ads.twitch.tv"],
            },
        },
        {
            "id": EXCLUSION_ID_START + 2,
            "priority": EXCLUSION_PRIORITY,
            "action": {"type": "allow"},
            "condition": {"requestDomains": list(VIDEO_CDN_DOMAINS)},
        },
    ]


# YouTube-only ad host block (uMatrix-style: doubleclick off, google/googlevideo on).
# Must outrank the YouTube allowAllRequests frame rule, and is scoped by
# initiatorDomains so doubleclick on other sites is left to the lists.
YT_AD_BLOCK_ID = 4
YT_AD_BLOCK_PRIORITY = EXCLUSION_PRIORITY + 1
YT_INITIATORS = ["youtube.com", "youtube-nocookie.com", "youtubekids.com"]
YT_AD_HOSTS = ["doubleclick.net"]

# Captcha widget hosts no block rule may name: the ONE list in
# src/rules/never-block-captcha.json (the packer's NEVER_BLOCK_CAPTCHA reads it too).
CAPTCHA_SUFFIXES = tuple(
    json.loads((ROOT / "src" / "rules" / "never-block-captcha.json").read_text(encoding="utf-8"))["suffixes"]
)


def drop_hcaptcha(blocks: list[dict]) -> tuple[list[dict], int]:
    """Remove hCaptcha hosts from every block rule's requestDomains; drop a rule
    left with no domains. Returns (rules, number of hosts removed)."""
    out: list[dict] = []
    removed = 0
    for rule in blocks:
        if rule.get("action", {}).get("type") != "block":
            out.append(rule)
            continue
        domains = rule.get("condition", {}).get("requestDomains", [])
        kept = []
        for d in domains:
            h = d.lower().rstrip(".")
            if any(h == suf or h.endswith("." + suf) for suf in CAPTCHA_SUFFIXES):
                removed += 1
            else:
                kept.append(d)
        if domains and not kept:
            continue
        if len(kept) != len(domains):
            rule = {**rule, "condition": {**rule["condition"], "requestDomains": kept}}
        out.append(rule)
    return out, removed


# Every captcha suffix, bare and under the widget subdomains hCaptcha uses.
_HC_PROBE_URLS = [
    scheme + "://" + (label + "." if label else "") + suf + path
    for scheme in ("http", "https")
    for suf in CAPTCHA_SUFFIXES
    for label in ("", "a", "sentry", "stats", "widget", "imgs")
    for path in ("/", "/1/api.js", "/captcha")
]
# Anchored urlFilter host: ||host, |https://host, optional *. and a trailing port.
_URLFILTER_ANCHOR_RE = re.compile(r"(?i)^(?:\|\||\|https?://)(\*\.)?([^/^*|?#]+)")
# A regex that names a captcha host, not a lookalike (nothcaptcha.com, hcaptcha.com.evil).
_REGEX_HCAPTCHA_RE = re.compile(
    r"(?<![a-z0-9])(?:[a-z0-9-]+\.)*(?:" + "|".join(re.escape(s) for s in CAPTCHA_SUFFIXES) + r")(?![a-z0-9.-])", re.I
)


def _is_hcaptcha_host(host: str) -> bool:
    h = host.lower().rstrip(".")
    if ":" in h:
        name, _, port = h.rpartition(":")
        if port.isdigit():
            h = name
    return any(h == suf or h.endswith("." + suf) for suf in CAPTCHA_SUFFIXES)


def _urlfilter_host(url_filter: str) -> str | None:
    m = _URLFILTER_ANCHOR_RE.match(url_filter.strip())
    if not m:
        return None
    return m.group(2)


def _regex_names_hcaptcha(pattern: str) -> bool:
    text = pattern.replace("\\.", ".")
    return _REGEX_HCAPTCHA_RE.search(text) is not None


def drop_hcaptcha_filter_rules(blocks: list[dict]) -> tuple[list[dict], int]:
    """Drop block rules whose urlFilter is anchored on an hCaptcha host, or whose
    regexFilter names an hCaptcha host or matches an hCaptcha probe URL.
    Allow and other non-block rules are kept. Returns (rules, number dropped)."""
    out: list[dict] = []
    dropped = 0
    for rule in blocks:
        if rule.get("action", {}).get("type") == "block":
            cond = rule.get("condition", {})
            hit = False
            uf = cond.get("urlFilter")
            if isinstance(uf, str):
                host = _urlfilter_host(uf)
                if host and _is_hcaptcha_host(host):
                    hit = True
            rf = cond.get("regexFilter")
            if not hit and isinstance(rf, str):
                if _regex_names_hcaptcha(rf):
                    hit = True
                else:
                    try:
                        rx = re.compile(rf)
                        hit = any(rx.search(u) for u in _HC_PROBE_URLS)
                    except re.error:
                        hit = False
            if hit:
                dropped += 1
                continue
        out.append(rule)
    return out, dropped

# Ordinary-site trackers that sit under a never-block parent (googleapis.com)
# or that we keep even when a list drops them. Not stream hosts.
EXTRA_TRACKER_DOMAINS = [
    "facebook.net",
    "fundingchoicesmessages.google.com",
    "imasdk.googleapis.com",
]


def build_youtube_ad_block_rules() -> list[dict]:
    return [
        {
            "id": YT_AD_BLOCK_ID,
            "priority": YT_AD_BLOCK_PRIORITY,
            "action": {"type": "block"},
            "condition": {
                "requestDomains": list(YT_AD_HOSTS),
                "initiatorDomains": list(YT_INITIATORS),
            },
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
    blocks, hcaptcha_removed = drop_hcaptcha(blocks)
    print(f"removed {hcaptcha_removed} hCaptcha host(s) from block rules")
    blocks, hcaptcha_dropped = drop_hcaptcha_filter_rules(blocks)
    print(f"dropped {hcaptcha_dropped} hCaptcha block rule(s) by urlFilter/regexFilter")

    renumbered = []
    rid = BLOCK_ID_START
    for rule in blocks:
        if rule.get("action", {}).get("type") != "block":
            # List-pack should be blocks only; skip stray allows from older stubs.
            continue
        # Copy the whole condition: scoped list rules carry resourceTypes /
        # excludedResourceTypes / domainType, and dropping them would widen the
        # rule into a whole-domain block (H-2).
        cond = {"requestDomains": list(rule["condition"]["requestDomains"])}
        for key in ("resourceTypes", "excludedResourceTypes", "domainType"):
            if key in rule["condition"]:
                value = rule["condition"][key]
                cond[key] = list(value) if isinstance(value, list) else value
        next_rule = {
            "id": rid,
            "priority": BLOCK_PRIORITY,
            "action": {"type": "block"},
            "condition": cond,
        }
        renumbered.append(next_rule)
        rid += 1

    allows = build_exclusion_rules()
    yt_blocks = build_youtube_ad_block_rules()
    extra_id = rid
    extra_tracker = {
        "id": extra_id,
        "priority": BLOCK_PRIORITY,
        "action": {"type": "block"},
        "condition": {"requestDomains": list(EXTRA_TRACKER_DOMAINS)},
    }
    merged = allows + yt_blocks + renumbered + [extra_tracker]
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
        "block_rules": len(renumbered) + 1,
        "youtube_ad_block_rules": len(yt_blocks),
        "rule_count": len(merged),
        "exclusion_priority": EXCLUSION_PRIORITY,
        "site_domains": SITE_DOMAINS,
        "video_cdn_domains": VIDEO_CDN_DOMAINS,
        "block_id_start": BLOCK_ID_START,
        "source_blocks": "scripts/pack-filter-lists.py",
        "extra_tracker_rule_id": extra_id,
        "extra_tracker_domains": list(EXTRA_TRACKER_DOMAINS),
    }
    META_OUT.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
