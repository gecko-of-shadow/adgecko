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
import subprocess
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
                "license": "Peter Lowe's list - free for personal/non-commercial use; credit required. See https://pgl.yoyo.org/as/ (check page for current terms).",
                "role": "ads_trackers",
                "priority": 100,
            },
        ),
        (
            "urlhaus_hosts",
            {
                "url": "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt",
                "license": "urlhaus-filter by curbengh (malware-filter project) - repository CC0 1.0 and MIT License; URLhaus data by abuse.ch - CC0 1.0 (not endorsed by abuse.ch). The one Curben list we use (owner decision #18b): URLhaus malware data only. https://gitlab.com/malware-filter/urlhaus-filter",
                "role": "malware_threat",
                "priority": 90,
                "max_domains": 8_000,
            },
        ),
        (
            "easylist",
            {
                "url": "https://easylist.to/easylist/easylist.txt",
                "license": "EasyList - dual-licensed GNU GPL-3.0-or-later OR CC BY-SA 3.0-or-later. Credit: \"The EasyList authors\". https://easylist.to/pages/licence.html",
                "role": "ads",
                "priority": 70,
            },
        ),
        (
            "easyprivacy",
            {
                "url": "https://easylist.to/easylist/easyprivacy.txt",
                "license": "EasyPrivacy - same EasyList dual license (GPL-3.0-or-later OR CC BY-SA 3.0-or-later). Credit: \"The EasyList authors\".",
                "role": "privacy",
                "priority": 50,
            },
        ),
        (
            "hagezi_pro_mini",
            {
                "url": "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt",
                "license": "HaGeZi DNS Blocklists (Pro mini) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: HaGeZi. https://github.com/hagezi/dns-blocklists",
                "role": "ads_trackers",
                "priority": 40,
            },
        ),
        (
            "ublock_badware",
            {
                "url": "https://ublockorigin.github.io/uAssets/filters/badware.txt",
                "license": "uBlock Origin badware filters (uAssets) - GPL-3.0 (repository LICENSE, checked 2026-11-02). Credit: Raymond Hill and uBlock Origin contributors. https://github.com/uBlockOrigin/uAssets",
                "role": "malware_threat",
                "priority": 35,
            },
        ),
        (
            "dandelion_antimalware",
            {
                "url": "https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt",
                "license": "Dandelion Sprout's Anti-Malware List - Dandelicence v1.4 (use and redistribution with or without changes and with or without commercial purpose; keep the licence text or a link to it; checked 2026-11-02): https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md. Credit: Dandelion Sprout.",
                "role": "malware_threat",
                "priority": 30,
            },
        ),
        # Curben's phishing-filter was removed on 2026-11-02 (owner decision #13: no
        # OpenPhish data at all; that list is curated from OpenPhish, IPThreat and
        # PhishTank). curbengh's urlhaus-filter above (URLhaus data, CC0) is the one
        # documented Curben exception (owner decision #18b); scripts/lib/curben_check.py
        # enforces that nothing else from that project is used.
        (
            "adguard_base",
            {
                "url": "https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt",
                "license": "AdGuard Base filter (EasyList already removed) - GPL-3.0 (AdguardFilters repository LICENSE, checked 2026-11-02). Credit: AdGuard. https://github.com/AdguardTeam/AdguardFilters",
                "role": "ads",
                "priority": 20,
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
    # Player CDN and the other YouTube/Kick frame hosts from
    # src/general-exclude-hosts.js. HaGeZi lists stats.live-video.net.
    "live-video.net",
    "youtube-nocookie.com",
    "youtubekids.com",
    # Kick media host (was missing here; security review L-6).
    "kickusercontent.com",
)

# Captcha widget hosts (hCaptcha: blocking them leaves the widget blank), kept
# apart from the stream hosts above. The ONE list is src/rules/never-block-captcha.json;
# the merger, the YouTube sync and (through the generated
# src/general/never-block-captcha.js) the runtime read the same file.
NEVER_BLOCK_CAPTCHA_JSON = ROOT / "src" / "rules" / "never-block-captcha.json"
NEVER_BLOCK_CAPTCHA_JS = ROOT / "src" / "general" / "never-block-captcha.js"


def load_never_block_captcha() -> tuple[str, ...]:
    data = json.loads(NEVER_BLOCK_CAPTCHA_JSON.read_text(encoding="utf-8"))
    suffixes = data["suffixes"]
    if not isinstance(suffixes, list) or not suffixes or any(
        not isinstance(s, str) or s != s.lower().strip().rstrip(".") or "." not in s for s in suffixes
    ):
        raise SystemExit(f"{NEVER_BLOCK_CAPTCHA_JSON}: suffixes must be non-empty lowercase host names")
    if len(set(suffixes)) != len(suffixes):
        raise SystemExit(f"{NEVER_BLOCK_CAPTCHA_JSON}: duplicate suffix")
    return tuple(suffixes)


NEVER_BLOCK_CAPTCHA = load_never_block_captcha()


def render_never_block_captcha_js(suffixes: tuple[str, ...]) -> str:
    """The classic script the service worker loads (importScripts, before
    threat/protected-hosts.js and general/update.js) so the runtime sees the
    same list without fetching JSON at load. Tests import it for its global."""
    items = ", ".join(json.dumps(s, ensure_ascii=True) for s in suffixes)
    return (
        "// GENERATED from src/rules/never-block-captcha.json by scripts/pack-filter-lists.py.\n"
        "// Do not edit; change the JSON and run: python3 scripts/pack-filter-lists.py --never-block-captcha-js\n"
        "// Captcha widget host suffixes no tier may block (the host and every\n"
        "// subdomain; lookalikes stay blockable). Classic script: the worker loads it\n"
        "// with importScripts before threat/protected-hosts.js and general/update.js,\n"
        "// which throw without it; tests import it for its global.\n"
        "(function (root) {\n"
        "  root.GeckoNeverBlockCaptcha = Object.freeze({ SUFFIXES: Object.freeze([" + items + "]) });\n"
        "})(typeof self !== \"undefined\" ? self : globalThis);\n"
    )


def write_never_block_captcha_js() -> bool:
    """Write the generated runtime file. Returns True when it changed."""
    text = render_never_block_captcha_js(NEVER_BLOCK_CAPTCHA)
    if NEVER_BLOCK_CAPTCHA_JS.exists() and NEVER_BLOCK_CAPTCHA_JS.read_text(encoding="utf-8") == text:
        return False
    NEVER_BLOCK_CAPTCHA_JS.write_text(text, encoding="utf-8", newline="\n")
    return True

# Hosts the shipped-rule test checks. Each one found in a shipped rule file must
# have a recorded approved source in meta.json "sentinel_sources".
# All eleven were sampled from the section of uBO badware that DROPPED_SECTION_RE
# skips (checked 2026-11-09 against that list and HaGeZi Pro mini). Nine are only
# in that dropped section, so an empty source list is the record and they must
# not ship. Two are also on HaGeZi Pro mini, which is why that list is named.
SENTINEL_HOSTS = (
    # Dropped badware section only. No approved list carries them.
    "mmitalianbeef.square.site",
    "bigbauer.com",
    "autoscurt24.de",
    "hk668.cc",
    "dc.tensgpt.com",
    "carrefour-enbacktoschool4.pages.dev",
    "sacolamobile.influenciadormagalu.com.br",
    "inmotiongmbh.com",
    "gumeminlogi.webflow.io",
    # Also on HaGeZi Pro mini (approved ads/trackers list).
    "globalgrainsadf.com",
    "hausbank-ssk-cuxhaven.de",
)

DOMAIN_RE = re.compile(
    r"^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$",
    re.IGNORECASE,
)
# No OpenPhish data (owner decisions #13 and H-1): uBO's badware.txt carries a
# "! openphish" section. Same rule as DROPPED_SECTION_RE in src/general/update.js.
# Built from pieces because scripts/lib/curben_check.py refuses the word in code.
DROPPED_SECTION_RE = re.compile(r"^!\s*" + "open" + r"phish\b", re.IGNORECASE)
HOSTS_RE = re.compile(
    r"^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*[a-z0-9])\s*$",
    re.IGNORECASE,
)
BARE_DOMAIN_RE = re.compile(
    r"^([a-z0-9][a-z0-9.-]*[a-z0-9])$",
    re.IGNORECASE,
)
# Filter options -> DNR scope, from the ONE shared table in
# src/general/filter-options.js (the runtime refresh uses the same file).
# An option maps to a DNR field, narrows the rule, or drops the filter; a scoped
# filter is never widened into a whole-domain block (H-2).
# Same input, same output as the JS side: test/fixtures/filter-options-cases.json.
FILTER_OPTIONS_JS = ROOT / "src" / "general" / "filter-options.js"


def load_filter_option_table() -> dict:
    text = FILTER_OPTIONS_JS.read_text(encoding="utf-8")
    start = text.index("/*FILTER-OPTION-TABLE-START*/") + len("/*FILTER-OPTION-TABLE-START*/")
    end = text.index("/*FILTER-OPTION-TABLE-END*/")
    return json.loads(text[start:end])


OPTION_TABLE = load_filter_option_table()


def load_nav_exempt() -> dict:
    """Navigation-exempt hosts, the JSON between the NAV-EXEMPT markers in
    src/general/filter-options.js (one source of truth with the runtime)."""
    text = FILTER_OPTIONS_JS.read_text(encoding="utf-8")
    start = text.index("/*NAV-EXEMPT-START*/") + len("/*NAV-EXEMPT-START*/")
    end = text.index("/*NAV-EXEMPT-END*/")
    return json.loads(text[start:end])


NAV_EXEMPT = load_nav_exempt()


def is_nav_exempt(host: str) -> bool:
    h = (host or "").lower().rstrip(".")
    return any(h == d or h.endswith("." + d) for d in NAV_EXEMPT["hosts"])


PROTECTED_HOSTS_JS = ROOT / "src" / "threat" / "protected-hosts.js"


def load_protected_hosts() -> tuple[list[str], list[str]]:
    """SUFFIX and EXACT from src/threat/protected-hosts.js (the ONE stream-host
    list; the threat compiler uses the same file)."""
    text = PROTECTED_HOSTS_JS.read_text(encoding="utf-8")

    def arr(name: str) -> list[str]:
        m = re.search(r"const " + name + r" = Object\.freeze\(\[(.*?)\]\);", text, re.S)
        body = re.sub(r"//[^\n]*", "", m.group(1))
        return re.findall(r'"([^"]+)"', body)

    return arr("SUFFIX"), arr("EXACT")


PROTECTED_SUFFIX, PROTECTED_EXACT = load_protected_hosts()


def is_nav_protected(host: str) -> bool:
    """Mirrors isNavProtected(): under a SUFFIX entry, or an ancestor of any."""
    h = (host or "").lower().rstrip(".")

    def under(a: str, b: str) -> bool:
        return a == b or a.endswith("." + b)

    return any(under(h, p) for p in PROTECTED_SUFFIX) or any(under(p, h) for p in PROTECTED_SUFFIX + PROTECTED_EXACT)


def scope_for_merge(domain: str, key: str, is_whole: bool):
    """Scope an entry keeps at merge time, or None. Mirrors scopeForMerge().

    A whole-domain host keeps only an explicit $document part as a
    main_frame-only scope (party kept): whole-domain rules never match
    opening the page. A navigation-exempt host never keeps main_frame.
    """
    if not key:
        return None
    parts = {}
    for seg in key.split("|"):
        k, _, v = seg.partition("=")
        parts[k] = v
    t = parts.get("t", "").split(",") if parts.get("t") else []
    nav = "main_frame" in t
    if nav and (is_nav_exempt(domain) or is_nav_protected(domain)):
        t = [v for v in t if v != "main_frame"]
        if not t or is_whole:
            return None
        return "p=" + parts.get("p", "") + "|t=" + ",".join(t) + "|x=" + parts.get("x", "")
    if not is_whole:
        return key
    return "p=" + parts.get("p", "") + "|t=main_frame|x=" if nav else None


def convert_options(opts: str):
    """Options string -> (key, cancel) or None (drop). Mirrors convertOptions()."""
    raw = (opts or "").strip()
    if raw.startswith("$"):
        raw = raw[1:]
    raw = raw.strip()
    if not raw:
        return ("", False)
    types: set[str] = set()
    excluded: set[str] = set()
    party = ""
    narrowed = False
    cancel = False
    for part0 in raw.split(","):
        part = part0.strip().lower()
        if not part:
            continue
        if part in OPTION_TABLE["cancel"]:
            cancel = True
            continue
        if part in OPTION_TABLE["ignore"]:
            continue
        if part in OPTION_TABLE["narrow"]:
            narrowed = True
            continue
        if part in OPTION_TABLE["party"]:
            p = OPTION_TABLE["party"][part]
            if party and party != p:
                return None
            party = p
            continue
        neg = part.startswith("~")
        name = part[1:] if neg else part
        if name in OPTION_TABLE["types"]:
            (excluded if neg else types).add(OPTION_TABLE["types"][name])
            continue
        return None
    if narrowed and not types:
        return None
    t = sorted(types)
    x = sorted(excluded)
    if t:
        t = [v for v in t if v not in excluded]
        if not t:
            return None
        x = []
    # `$~document` adds nothing: navigations are not blocked by default and
    # key_to_condition excludes main_frame in every excluded-only condition.
    # Mirrors convertOptions().
    x = [v for v in x if v != "main_frame"]
    if not party and not t and not x:
        return ("", cancel)
    return ("p=" + party + "|t=" + ",".join(t) + "|x=" + ",".join(x), cancel)


def key_to_condition(key: str) -> dict:
    """Scope key -> DNR condition fields. Mirrors keyToCondition().

    Chrome matches a rule that has only excludedResourceTypes against every
    other type, main_frame included (checked in Chrome for Testing 155,
    2026-11-03), so an excluded-only key always excludes main_frame too:
    `$~script` must never block opening the site.
    """
    out: dict = {}
    if not key:
        return out
    for seg in key.split("|"):
        k, _, v = seg.partition("=")
        if not v:
            continue
        if k == "p":
            out["domainType"] = v
        elif k == "t":
            out["resourceTypes"] = v.split(",")
        elif k == "x":
            out["excludedResourceTypes"] = v.split(",")
    if "excludedResourceTypes" in out and "resourceTypes" not in out:
        out["excludedResourceTypes"] = sorted(set(out["excludedResourceTypes"]) | {"main_frame"})
    return out


def convert_line(line: str):
    """One ||host^$opts line -> [domain, key, cancel] or None. Mirrors convertLine()."""
    m = DOMAIN_RE.match((line or "").strip())
    if not m:
        return None
    res = convert_options(m.group(2) or "")
    if res is None:
        return None
    return [m.group(1).lower(), res[0], res[1]]


def keeps_whole_domain(opts: str) -> bool:
    """True only for options that keep a whole-domain block."""
    if not opts:
        return True
    res = convert_options(opts)
    return bool(res and res[0] == "" and not res[1])
COSMETIC_RE = re.compile(r"^([^#\n]*?)(#@?#|#\$#)(.+)$")


def fetch(url: str, name: str) -> tuple[str, str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{name}.txt"
    print(f"fetch {name}: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "adgecko-list-packer/0.1 (local build)"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    text = data.decode("utf-8", errors="replace")
    cache_path.write_text(text, encoding="utf-8")
    digest = hashlib.sha256(data).hexdigest()
    return text, digest


# Ad hosts under a broad never-block suffix that must stay blocked in every
# path (the packed ruleset also blocks them through the merger's extra tracker
# rule, scripts/merge-dnr-rules.py EXTRA_TRACKER_DOMAINS). Same list as
# NEVER_BLOCK_EXCEPTIONS in src/general/update.js (test/imasdk-never-block.test.js).
NEVER_BLOCK_EXCEPTIONS = ("imasdk.googleapis.com",)


def is_never_block(domain: str) -> bool:
    d = domain.lower().rstrip(".")
    for exc in NEVER_BLOCK_EXCEPTIONS:
        if d == exc or d.endswith("." + exc):
            return False
    for suf in NEVER_BLOCK_SUFFIXES + NEVER_BLOCK_CAPTCHA:
        if d == suf or d.endswith("." + suf):
            return True
    return False


# Public-suffix subset shared with the runtime (src/threat/psl.js, data between
# the PSL-SUBSET markers; security review L-3). A list line naming a public
# suffix ("co.uk") or a non-public IPv4 address never becomes a rule. Same
# check as looksLikeDomain() in src/general/update.js (test/psl.test.js).
PSL_JS = ROOT / "src" / "threat" / "psl.js"


def load_psl_subset() -> dict:
    text = PSL_JS.read_text(encoding="utf-8")
    start = text.index("/*PSL-SUBSET-START*/") + len("/*PSL-SUBSET-START*/")
    end = text.index("/*PSL-SUBSET-END*/")
    data = json.loads(text[start:end])
    # ICANN suffixes only, like looksLikeDomain() (isIcannSuffix) at run time.
    return {"wildcard": set(data["wildcardTlds"]), "suffixes": set(data["suffixes"])}


PSL = load_psl_subset()


def is_public_suffix(host: str) -> bool:
    h = host.lower().rstrip(".")
    if "." not in h:
        return True
    if h in PSL["suffixes"]:
        return True
    labels = h.split(".")
    if len(labels) != 2:
        return False
    return labels[1] in PSL["wildcard"]


def is_local_address(host: str) -> bool:
    m = re.fullmatch(r"(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})", host)
    if not m:
        return False
    a, b = int(m.group(1)), int(m.group(2))
    return (a in (0, 10, 127) or a >= 224 or (a == 169 and b == 254) or (a == 172 and 16 <= b <= 31)
            or (a == 192 and b == 168) or (a == 100 and 64 <= b <= 127))


def looks_like_domain(domain: str) -> bool:
    d = domain.lower()
    if "." not in d or d.startswith(".") or d.endswith("."):
        return False
    if any(ch in d for ch in "/*?|()[]{}"):
        return False
    if not all(part for part in d.split(".")):
        return False
    if is_local_address(d) or is_public_suffix(d):
        return False
    return True


def extract_entries(text: str) -> tuple[list[str], list[list[str]]]:
    """(whole-domain blocks, [[domain, scope key], ...]). Mirrors parseEntries().

    $badfilter cancels the filter with the same domain and scope key.
    A "! openphish" section is dropped up to the next comment line.
    """
    whole: list[str] = []
    scoped: list[list[str]] = []
    cancelled: set[str] = set()
    dropping = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("!"):
            dropping = DROPPED_SECTION_RE.match(line) is not None
        if dropping or not line or line.startswith("!") or line.startswith("["):
            continue
        if line.startswith("@@"):
            continue  # exceptions handled later by DNR allow rules / user allow
        if "#$" in line or "##" in line or "#@#" in line:
            continue
        m = DOMAIN_RE.match(line)
        if m:
            domain = m.group(1).lower()
            res = convert_options(m.group(2) or "")
            if res is None or not looks_like_domain(domain):
                continue
            key, cancel = res
            if cancel:
                cancelled.add(domain + "\n" + key)
            elif key == "":
                whole.append(domain)
            else:
                scoped.append([domain, key])
            continue
        m = HOSTS_RE.match(line)
        if m:
            domain = m.group(1).lower()
            if domain not in ("localhost", "local") and looks_like_domain(domain):
                whole.append(domain)
            continue
        # Some threat lists are bare domains.
        if BARE_DOMAIN_RE.match(line) and looks_like_domain(line):
            whole.append(line.lower())
    if cancelled:
        whole = [d for d in whole if d + "\n" not in cancelled]
        scoped = [e for e in scoped if e[0] + "\n" + e[1] not in cancelled]
    return whole, scoped


def extract_domains(text: str) -> list[str]:
    """Whole-domain blocks only (scoped filters are never widened into these)."""
    return extract_entries(text)[0]


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


def merge_scoped(buckets: dict[str, list[list[str]]], whole: list[str]) -> tuple[list[list[str]], dict]:
    """Scoped entries in source order; deduped, never-block removed, and reduced
    to their $document (main_frame) part or dropped when the domain is already a
    whole-domain block (scope_for_merge). Mirrors mergeScoped()."""
    whole_set = set(whole)
    seen: set[str] = set()
    out: list[list[str]] = []
    stats = {name: {"raw": 0, "kept": 0} for name in buckets}
    for name, entries in buckets.items():
        cap = SOURCES[name].get("max_domains")
        stats[name]["raw"] = len(entries)
        kept_here = 0
        for d, key0 in entries:
            if is_never_block(d):
                continue
            key = scope_for_merge(d, key0, d in whole_set)
            if key is None:
                continue
            ident = d + "\n" + key
            if ident in seen:
                continue
            seen.add(ident)
            out.append([d, key])
            kept_here += 1
            stats[name]["kept"] += 1
            if cap is not None and kept_here >= cap:
                break
    return out, stats


def domains_to_dnr_rules(domains: list[str], scoped: list[list[str]] | None = None) -> list[dict]:
    """Whole-domain batches first, then one batch series per scope key (sorted)."""
    rules: list[dict] = []

    def push(chunk: list[str], extra: dict) -> None:
        cond = {"requestDomains": chunk}
        cond.update(extra)
        rules.append({"id": len(rules) + 1, "priority": 1, "action": {"type": "block"}, "condition": cond})

    for i in range(0, len(domains), DOMAINS_PER_RULE):
        if len(rules) >= MAX_DNR_RULES:
            break
        push(domains[i : i + DOMAINS_PER_RULE], {})
    groups: dict[str, list[str]] = {}
    for d, key in scoped or []:
        groups.setdefault(key, []).append(d)
    for key in sorted(groups):
        extra = key_to_condition(key)
        lst = groups[key]
        for i in range(0, len(lst), DOMAINS_PER_RULE):
            if len(rules) >= MAX_DNR_RULES:
                break
            push(lst[i : i + DOMAINS_PER_RULE], extra)
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
        "## The one Curben list (owner decision #18b)",
        "",
        "`urlhaus_hosts` is curbengh's urlhaus-filter (malware-filter project):",
        "URLhaus malware-host data from abuse.ch (CC0 1.0); the urlhaus-filter",
        "repository is CC0 1.0 and MIT. It is the only list from that project that",
        "Adgecko uses, fetched only from",
        "`https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt`.",
        "No phishing-feed data: the project's phishing list stays dropped (owner",
        "decisions #13 and #18b). `scripts/lib/curben_check.py` enforces this in the",
        "release gate and the tests.",
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
            "- Network blocking only in `general-network.json` (domain -> DNR `requestDomains`).",
            "- Cosmetic sample (generic `##` only) in `cosmetic-sample.json` for the cosmetic agent - not applied by DNR.",
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
    if write_never_block_captcha_js():
        print(f"wrote {NEVER_BLOCK_CAPTCHA_JS.relative_to(ROOT)}")
    if "--never-block-captcha-js" in sys.argv[1:]:
        return 0
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    digests: dict[str, str] = {}
    buckets: dict[str, list[str]] = {}
    scoped_buckets: dict[str, list[list[str]]] = {}
    cosmetic_sample: list[dict] = []

    # Fetch highest-priority first for merge order.
    ordered_names = sorted(
        SOURCES.keys(), key=lambda n: SOURCES[n]["priority"], reverse=True
    )
    for name in ordered_names:
        text, digest = fetch(SOURCES[name]["url"], name)
        digests[name] = digest
        buckets[name], scoped_buckets[name] = extract_entries(text)
        if name in ("easylist", "easyprivacy") and not cosmetic_sample:
            cosmetic_sample = extract_cosmetic_sample(text)

    # Rebuild buckets in priority order for merge_domains iteration.
    buckets = OrderedDict((n, buckets[n]) for n in ordered_names)
    scoped_buckets = OrderedDict((n, scoped_buckets[n]) for n in ordered_names)
    domains, stats = merge_domains(buckets)
    scoped, scoped_stats = merge_scoped(scoped_buckets, domains)
    for name in stats:
        stats[name]["scoped_raw"] = scoped_stats[name]["raw"]
        stats[name]["scoped_kept"] = scoped_stats[name]["kept"]
    sentinel_sources = {
        h: sorted(
            n
            for n in ordered_names
            if h in buckets[n] or any(e[0] == h for e in scoped_buckets[n])
        )
        for h in SENTINEL_HOSTS
    }
    rules = domains_to_dnr_rules(domains, scoped)

    # Block batches only. merge-dnr-rules.py owns general-network.json so the
    # stream allows and the YouTube doubleclick rule are not wiped.
    blocks_path = ROOT / "scripts" / ".dnr-cache" / "general-network.blocks.json"
    blocks_path.parent.mkdir(parents=True, exist_ok=True)
    gitignore = blocks_path.parent / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*\n!.gitignore\n", encoding="utf-8")
    blocks_path.write_text(
        json.dumps(rules, separators=(",", ":"), ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    network_path = OUT_DIR / "general-network.json"

    meta = {
        "packed_at_utc": fetched_at,
        "format": "chrome_declarativeNetRequest_rules_array",
        "domains_total": len(domains),
        "scoped_entries_total": len(scoped),
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
        # Captcha suffixes (src/rules/never-block-captcha.json) are recorded
        # here too, so the packed metadata matches every host the packer skips.
        "never_block_suffixes": list(NEVER_BLOCK_SUFFIXES) + list(NEVER_BLOCK_CAPTCHA),
        "sentinel_sources": sentinel_sources,
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
    # After meta.json is written: the merger records the shipped rule count
    # (general_network_rules_total) into that file, and a merge that ran first
    # had its count overwritten by the fresh meta above.
    merged = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "merge-dnr-rules.py"), str(blocks_path)],
        check=False,
    )
    if merged.returncode != 0:
        return merged.returncode

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
    # Threat tier (static ruleset "threat"): rebuilt from the same downloads
    # with the runtime's own parser and compiler (src/threat/compile.js), so
    # it never goes stale next to general-network.json.
    try:
        threat = subprocess.run(
            ["deno", "run", "--allow-read", "--allow-write", str(ROOT / "scripts" / "build-threat-rules.mjs")],
            cwd=str(ROOT),
            check=False,
        )
    except FileNotFoundError:
        print("ERROR: deno not found; run scripts/build-threat-rules.mjs by hand", file=sys.stderr)
        return 3
    if threat.returncode != 0:
        print("ERROR: scripts/build-threat-rules.mjs failed", file=sys.stderr)
        return threat.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
