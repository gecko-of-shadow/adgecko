#!/usr/bin/env python3
"""Fetch public filter lists and pack trimmed MV3 declarativeNetRequest artifacts.

Outputs under src/rules/ for the beta zip. Does not edit playback scripts.
Target: stay well under Chrome's guaranteed 30k static rules; leave headroom
for stream-site allow rules owned by the DNR agent.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "rules"
CACHE_DIR = ROOT / "scripts" / ".list-cache"

# Leave headroom for allow/exception rules the DNR agent adds.
MAX_DNR_RULES = 28_000
# Batch domains per rule to keep the zip small (one-domain rules blow past 5 MB).
DOMAINS_PER_RULE = 80
# Soft cap on domains after priority merge (rule count = ceil(n / batch)).
MAX_DOMAINS = MAX_DNR_RULES * DOMAINS_PER_RULE

SOURCES = OrderedDict(
    [
        (
            "peter_lowe",
            {
                "url": "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
                "license": "Peter LoweΓÇÖs list ΓÇö free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).",
                "role": "ads_trackers",
                "priority": 100,
            },
        ),
        (
            "urlhaus_hosts",
            {
                "url": "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt",
                "license": "urlhaus-filter (curbengh / malware-filter) ΓÇö CC BY-NC-SA 4.0 for the filter packaging; URLhaus data from abuse.ch. Attribution required. https://gitlab.com/malware-filter/urlhaus-filter",
                "role": "malware_threat",
                "priority": 90,
                "max_domains": 8_000,
            },
        ),
        (
            "easylist",
            {
                "url": "https://easylist.to/easylist/easylist.txt",
                "license": "EasyList ΓÇö dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: ΓÇ£The EasyList authorsΓÇ¥. https://easylist.to/pages/licence.html",
                "role": "ads",
                "priority": 70,
            },
        ),
        (
            "easyprivacy",
            {
                "url": "https://easylist.to/easylist/easyprivacy.txt",
                "license": "EasyPrivacy ΓÇö same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: ΓÇ£The EasyList authorsΓÇ¥.",
                "role": "privacy",
                "priority": 50,
            },
        ),
    ]
)

# Never emit these as block targets (stream / player CDNs). DNR agent also adds allows.
NEVER_BLOCK_SUFFIXES = (
    "twitch.tv",
    "ttvnw.net",
    "jtvnw.net",
    "twitchcdn.net",
    "twitchcdn.com",
    "ext-twitch.tv",
    "youtube.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "youtubei.googleapis.com",
    "googleapis.com",  # broad; keep player API safe
    "gstatic.com",
    "kick.com",
    "kick-streamer.com",
)

DOMAIN_RE = re.compile(
    r"^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$",
    re.IGNORECASE,
)
HOSTS_RE = re.compile(
    r"^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*[a-z0-9])\s*$",
    re.IGNORECASE,
)
BARE_DOMAIN_RE = re.compile(
    r"^([a-z0-9][a-z0-9.-]*[a-z0-9])$",
    re.IGNORECASE,
)
COSMETIC_RE = re.compile(r"^([^#\n]*?)(#@?#|#\$#)(.+)$")


def fetch(url: str, name: str) -> tuple[str, str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{name}.txt"
    print(f"fetch {name}: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "twitch-adblock-list-packer/0.1 (local build)"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    text = data.decode("utf-8", errors="replace")
    cache_path.write_text(text, encoding="utf-8")
    digest = hashlib.sha256(data).hexdigest()
    return text, digest


def is_never_block(domain: str) -> bool:
    d = domain.lower().rstrip(".")
    for suf in NEVER_BLOCK_SUFFIXES:
        if d == suf or d.endswith("." + suf):
            return True
    return False


def looks_like_domain(domain: str) -> bool:
    d = domain.lower()
    if "." not in d or d.startswith(".") or d.endswith("."):
        return False
    if any(ch in d for ch in "/*?|()[]{}"):
        return False
    if d.count(".") >= 1 and all(part for part in d.split(".")):
        return True
    return False


def extract_domains(text: str) -> list[str]:
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        if line.startswith("@@"):
            continue  # exceptions handled later by DNR allow rules / user allow
        if "#$" in line or "##" in line or "#@#" in line:
            continue
        m = DOMAIN_RE.match(line)
        if m:
            domain = m.group(1).lower()
            opts = (m.group(2) or "").lower()
            # Skip narrow option filters that are not whole-domain blocks.
            if opts and any(
                k in opts
                for k in (
                    "domain=",
                    "sitekey=",
                    "csp=",
                    "rewrite=",
                    "header=",
                )
            ):
                continue
            if looks_like_domain(domain):
                out.append(domain)
            continue
        m = HOSTS_RE.match(line)
        if m:
            domain = m.group(1).lower()
            if domain not in ("localhost", "local") and looks_like_domain(domain):
                out.append(domain)
            continue
        # Some threat lists are bare domains.
        if BARE_DOMAIN_RE.match(line) and looks_like_domain(line):
            out.append(line.lower())
    return out


def extract_cosmetic_sample(text: str, limit: int = 2_000) -> list[dict]:
    """Small sample of generic element-hide rules for the cosmetic agent."""
    rows: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        m = COSMETIC_RE.match(line)
        if not m:
            continue
        domains, kind, body = m.group(1), m.group(2), m.group(3)
        if kind != "##":
            continue
        if domains.strip():
            continue  # generic only
        if body.startswith("+js") or body.startswith("script:"):
            continue
        rows.append({"selector": body, "source_line": line[:200]})
        if len(rows) >= limit:
            break
    return rows


def merge_domains(buckets: dict[str, list[str]]) -> tuple[list[str], dict]:
    """Priority-stable unique domain list with never-block removed."""
    seen: set[str] = set()
    ordered: list[str] = []
    stats = {name: {"raw": 0, "kept": 0, "skipped_never": 0} for name in buckets}
    # Higher priority sources first (already OrderedDict by priority in caller).
    for name, domains in buckets.items():
        cap = SOURCES[name].get("max_domains")
        stats[name]["raw"] = len(domains)
        kept_here = 0
        for d in domains:
            if is_never_block(d):
                stats[name]["skipped_never"] += 1
                continue
            if d in seen:
                continue
            seen.add(d)
            ordered.append(d)
            kept_here += 1
            stats[name]["kept"] += 1
            if cap is not None and kept_here >= cap:
                break
            if len(ordered) >= MAX_DOMAINS:
                break
        if len(ordered) >= MAX_DOMAINS:
            break
    return ordered, stats


def domains_to_dnr_rules(domains: list[str]) -> list[dict]:
    rules: list[dict] = []
    rid = 1
    for i in range(0, len(domains), DOMAINS_PER_RULE):
        chunk = domains[i : i + DOMAINS_PER_RULE]
        rules.append(
            {
                "id": rid,
                "priority": 1,
                "action": {"type": "block"},
                "condition": {"requestDomains": chunk},
            }
        )
        rid += 1
        if rid > MAX_DNR_RULES:
            break
    return rules


def write_licenses(digests: dict[str, str], fetched_at: str) -> str:
    lines = [
        "# Third-party filter list licenses",
        "",
        "This directory ships **trimmed / converted** copies of public filter lists",
        "for Chrome MV3 `declarativeNetRequest`. Full upstream lists are not reproduced.",
        "",
        f"Packed at: `{fetched_at}` (UTC).",
        "",
        "## Required credit",
        "",
        "> Filter lists derived from **The EasyList authors** (EasyList / EasyPrivacy).",
        "",
        "Additional credits: **Peter Lowe** (ad/tracking server list);",
        "**abuse.ch URLhaus** data via **urlhaus-filter** / malware-filter packaging.",
        "",
        "## Sources",
        "",
    ]
    for name, meta in SOURCES.items():
        lines.append(f"### {name}")
        lines.append("")
        lines.append(f"- URL: `{meta['url']}`")
        lines.append(f"- Role: `{meta['role']}`")
        lines.append(f"- SHA-256 of downloaded bytes: `{digests.get(name, 'n/a')}`")
        lines.append(f"- License / terms: {meta['license']}")
        lines.append("")
    lines.extend(
        [
            "## How we use them",
            "",
            "- Network blocking only in `general-network.json` (domain ΓåÆ DNR `requestDomains`).",
            "- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent ΓÇö not applied by DNR.",
            "- Twitch / YouTube / Kick (and related player hosts) are stripped from block targets here;",
            "  the DNR agent still must add higher-priority allow rules for those sites.",
            "",
            "## License choice for EasyList material",
            "",
            "Redistributed under **CC BY-SA 3.0-or-later** (EasyList dual-license option),",
            "with attribution to The EasyList authors. Modified (trimmed/converted) work.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    digests: dict[str, str] = {}
    buckets: dict[str, list[str]] = {}
    cosmetic_sample: list[dict] = []

    # Fetch highest-priority first for merge order.
    ordered_names = sorted(
        SOURCES.keys(), key=lambda n: SOURCES[n]["priority"], reverse=True
    )
    for name in ordered_names:
        text, digest = fetch(SOURCES[name]["url"], name)
        digests[name] = digest
        buckets[name] = extract_domains(text)
        if name in ("easylist", "easyprivacy") and not cosmetic_sample:
            cosmetic_sample = extract_cosmetic_sample(text)

    # Rebuild buckets in priority order for merge_domains iteration.
    buckets = OrderedDict((n, buckets[n]) for n in ordered_names)
    domains, stats = merge_domains(buckets)
    rules = domains_to_dnr_rules(domains)

    network_path = OUT_DIR / "general-network.json"
    network_path.write_text(
        json.dumps(rules, separators=(",", ":"), ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    meta = {
        "packed_at_utc": fetched_at,
        "format": "chrome_declarativeNetRequest_rules_array",
        "domains_total": len(domains),
        "dnr_rules_total": len(rules),
        "domains_per_rule": DOMAINS_PER_RULE,
        "max_dnr_rules_budget": MAX_DNR_RULES,
        "headroom_note": "Reserve remaining static rule quota for stream-site allow rules (DNR agent).",
        "sources": {
            name: {
                "url": SOURCES[name]["url"],
                "sha256": digests[name],
                "role": SOURCES[name]["role"],
                "priority": SOURCES[name]["priority"],
                **stats[name],
            }
            for name in ordered_names
        },
        "never_block_suffixes": list(NEVER_BLOCK_SUFFIXES),
        "manifest_hint": {
            "permissions": ["declarativeNetRequest"],
            "declarative_net_request": {
                "rule_resources": [
                    {
                        "id": "general_network",
                        "enabled": True,
                        "path": "src/rules/general-network.json",
                    }
                ]
            },
        },
    }
    (OUT_DIR / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )

    (OUT_DIR / "cosmetic-sample.json").write_text(
        json.dumps(
            {
                "note": "Generic EasyList ## selectors only (sample). Cosmetic agent owns application; DNR does not use this file.",
                "count": len(cosmetic_sample),
                "rules": cosmetic_sample,
            },
            indent=2,
            ensure_ascii=True,
        )
        + "\n",
        encoding="utf-8",
    )

    (OUT_DIR / "LICENSES.md").write_text(
        write_licenses(digests, fetched_at), encoding="utf-8"
    )
    (OUT_DIR / "README.md").write_text(
        "\n".join(
            [
                "# General adblock list artifacts (MV3)",
                "",
                "Built by `scripts/pack-filter-lists.py`.",
                "",
                "| File | Purpose |",
                "|------|---------|",
                "| `general-network.json` | Static DNR block rules (`requestDomains` batches) |",
                "| `meta.json` | Counts, source hashes, manifest hint for DNR agent |",
                "| `cosmetic-sample.json` | Sample generic cosmetics for cosmetic agent |",
                "| `LICENSES.md` | Attribution / license text |",
                "",
                "Do not edit Twitch/YouTube/Kick playback files when wiring these in.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    # Keep cache out of git if present
    gitignore = ROOT / "scripts" / ".list-cache" / ".gitignore"
    gitignore.parent.mkdir(parents=True, exist_ok=True)
    gitignore.write_text("*\n!.gitignore\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "domains": len(domains),
                "dnr_rules": len(rules),
                "network_bytes": network_path.stat().st_size,
                "stats": stats,
            },
            indent=2,
        )
    )
    if len(rules) > MAX_DNR_RULES:
        print("ERROR: exceeded DNR rule budget", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
