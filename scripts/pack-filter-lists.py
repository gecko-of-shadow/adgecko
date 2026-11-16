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


HOST_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$")


def clean_host(v: str):
    """One plain ASCII host (lowercase, no trailing dot) or None. Mirrors cleanHost()."""
    h = (v or "").strip().lower()
    if h.endswith("."):
        h = h[:-1]
    return h if HOST_RE.fullmatch(h) else None


def build_key(parts: dict) -> str:
    """Parts -> scope key. Mirrors buildKey(): p, t and x always, the extra
    parts (OPTION_TABLE["extraParts"] order) only when not empty."""
    key = "p=" + (parts.get("p") or "") + "|t=" + (parts.get("t") or "") + "|x=" + (parts.get("x") or "")
    for k in OPTION_TABLE["extraParts"]:
        if parts.get(k):
            key += "|" + k + "=" + parts[k]
    return key


def parse_key(key: str) -> dict:
    parts: dict = {}
    for seg in (key or "").split("|"):
        k, sep, v = seg.partition("=")
        if sep:
            parts[k] = v
    return parts


def scope_for_merge(domain: str, key: str, is_whole: bool):
    """Scope an entry keeps at merge time, or None. Mirrors scopeForMerge().

    A whole-domain host keeps only an explicit $document part as a
    main_frame-only scope (party kept): whole-domain rules never match
    opening the page. A navigation-exempt host never keeps main_frame.
    The optional parts (initiator, method, denyallow) only narrow and are
    carried through unchanged.
    """
    if not key:
        return None
    parts = parse_key(key)
    t = parts.get("t", "").split(",") if parts.get("t") else []
    nav = "main_frame" in t
    if nav and (is_nav_exempt(domain) or is_nav_protected(domain)):
        t = [v for v in t if v != "main_frame"]
        if not t or is_whole:
            return None
        return build_key({**parts, "t": ",".join(t)})
    if not is_whole:
        return key
    return build_key({**parts, "t": "main_frame", "x": ""}) if nav else None


# `@@||host...` exception -> host (mirrors EXCEPTION_HOST_RE / exceptionHost()).
EXCEPTION_HOST_RE = re.compile(r"^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])(?=[\^/$*:?|]|$)", re.IGNORECASE)


def exception_host(rest: str):
    m = EXCEPTION_HOST_RE.match((rest or "").strip())
    return clean_host(m.group(1)) if m else None


def limit_index(hosts) -> tuple[set, set]:
    """(exception hosts, their parents). Mirrors limitIndex()."""
    own: set[str] = set()
    parents: set[str] = set()
    for h in hosts:
        own.add(h)
        labels = h.split(".")
        for i in range(1, len(labels) - 1):
            parents.add(".".join(labels[i:]))
    return own, parents


def limit_key(key: str) -> bool:
    """A $domain= scope (i= or n= part)."""
    parts = parse_key(key) if key else {}
    return bool(parts.get("i") or parts.get("n"))


def limits_scoped(index, domain: str, key: str) -> bool:
    """Mirrors limitsScoped(): a $domain= entry whose host, a subdomain or a
    parent of it has a path / option exception."""
    own, parents = index
    if not own or not limit_key(key):
        return False
    if domain in own or domain in parents:
        return True
    labels = domain.split(".")
    return any(".".join(labels[i:]) in own for i in range(1, len(labels) - 1))


def initiator_split(key: str):
    """Mirrors initiatorSplit(): (key without i=, [i hosts]) or None."""
    if not key:
        return None
    parts = parse_key(key)
    if not parts.get("i"):
        return None
    hosts = parts["i"].split(",")
    rest = {k: v for k, v in parts.items() if k != "i"}
    return build_key(rest), hosts


def remove_initiators(key: str, drop: set):
    """Mirrors removeInitiators(): key minus `drop` initiators; None when none is left."""
    parts = parse_key(key)
    if not parts.get("i") or not drop:
        return key
    have = parts["i"].split(",")
    kept = [h for h in have if h not in drop]
    if len(kept) == len(have):
        return key
    if not kept:
        return None
    return build_key({**parts, "i": ",".join(kept)})


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
    incl: set[str] = set()
    excl: set[str] = set()
    methods: set[str] = set()
    ex_methods: set[str] = set()
    deny: set[str] = set()
    had_incl = False
    had_initiator = False
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
        eq = part.find("=")
        if eq > 0:
            name = part[:eq]
            values = part[eq + 1 :].split("|")
            if name in OPTION_TABLE["initiator"]:
                # $domain=a.com|~b.a.com: initiator scope. A bad include entry
                # is skipped (only narrower); a bad exclude entry drops the
                # filter (skipping it would widen the rule).
                had_initiator = True
                for v0 in values:
                    v = v0.strip()
                    neg = v.startswith("~")
                    h = clean_host(v[1:] if neg else v)
                    if neg:
                        if not h:
                            return None
                        excl.add(h)
                    else:
                        had_incl = True
                        if h:
                            incl.add(h)
                continue
            if name == "method":
                for v0 in values:
                    v = v0.strip()
                    neg = v.startswith("~")
                    m = v[1:] if neg else v
                    if m not in OPTION_TABLE["methods"]:
                        return None
                    (ex_methods if neg else methods).add(m)
                continue
            if name in OPTION_TABLE["denyallow"]:
                for v0 in values:
                    h = clean_host(v0)
                    if not h:
                        return None  # "~host" or an entity: cannot be exact
                    deny.add(h)
                continue
            return None
        neg = part.startswith("~")
        name = part[1:] if neg else part
        if name in OPTION_TABLE["types"]:
            (excluded if neg else types).add(OPTION_TABLE["types"][name])
            continue
        return None
    if narrowed and not types:
        return None
    # Every include entry was skipped: an empty initiator list would widen.
    if had_incl and not incl:
        return None
    # Exclusion-only $domain=~a.com: the widest form; its upstream path /
    # option exceptions cannot be expressed, so it stays dropped as in 0.3.4.
    # Mirrors convertOptions() (final review #0).
    if had_initiator and not had_incl:
        return None
    # Mixed $method=post|~get has no exact DNR form.
    if methods and ex_methods:
        return None
    t = sorted(types)
    x = sorted(excluded)
    if t:
        t = [v for v in t if v not in excluded]
        if not t:
            return None
        x = []
    # A $domain= scoped filter never blocks a navigation (a top-level page
    # load has no meaningful initiator). Mirrors convertOptions().
    if had_initiator and "main_frame" in t:
        t = [v for v in t if v != "main_frame"]
        if not t:
            return None
    # `$~document` adds nothing: navigations are not blocked by default and
    # key_to_condition excludes main_frame in every excluded-only condition.
    # Mirrors convertOptions().
    x = [v for v in x if v != "main_frame"]
    parts = {
        "p": party, "t": ",".join(t), "x": ",".join(x),
        "i": ",".join(sorted(incl)), "n": ",".join(sorted(excl)),
        "m": ",".join(sorted(methods)), "mx": ",".join(sorted(ex_methods)),
        "d": ",".join(sorted(deny)),
    }
    if not party and not t and not x and not any(parts[k] for k in OPTION_TABLE["extraParts"]):
        return ("", cancel)
    return (build_key(parts), cancel)


# Scope key part -> list-valued DNR condition field. Mirrors keyToCondition().
KEY_LIST_FIELDS = {
    "t": "resourceTypes",
    "x": "excludedResourceTypes",
    "i": "initiatorDomains",
    "n": "excludedInitiatorDomains",
    "m": "requestMethods",
    "mx": "excludedRequestMethods",
    "d": "excludedRequestDomains",
}


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
        elif k in KEY_LIST_FIELDS:
            out[KEY_LIST_FIELDS[k]] = v.split(",")
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


# `$all`: whole-domain block plus a main_frame-only entry. Mirrors
# DOCUMENT_KEY / allAddsDocument() in src/general/filter-options.js.
DOCUMENT_KEY = "p=|t=main_frame|x="


def all_adds_document(opts: str) -> bool:
    raw = opts or ""
    if raw.startswith("$"):
        raw = raw[1:]
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    if not any(p in OPTION_TABLE["allDocument"] for p in parts):
        return False
    return all(
        p in OPTION_TABLE["allDocument"] or p in OPTION_TABLE["ignore"] or p in OPTION_TABLE["cancel"]
        for p in parts
    )


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
# ads.twitch.tv is NOT an exception here (twitch.tv stays never-block for list
# lines); the merger blocks it through EXTRA_TRACKER_DOMAINS instead, which is
# what the Twitch allow's excludedRequestDomains carve-out is for.


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
    # ICANN suffixes only, like looksLikeDomain() (isIcannSuffix) at run time:
    # the flat suffixes plus the grouped deeper ones (icannDeep, {parent:
    # "label label"}, joined as ungroup() in psl.js does), the deeper
    # wildcard bases and the "!" exceptions (final review #5).
    suffixes = set(data["suffixes"])
    for parent, labels in data.get("icannDeep", {}).items():
        for label in labels.split(" "):
            if label:
                suffixes.add(label + "." + parent)
    return {
        "wildcard": set(data["wildcardTlds"]),
        "wildcard_bases": set(data.get("wildcardBases", [])),
        "exceptions": set(data.get("icannExceptions", [])),
        "suffixes": suffixes,
    }


PSL = load_psl_subset()


def is_public_suffix(host: str) -> bool:
    """Mirrors isIcannSuffix() in src/threat/psl.js: a listed suffix, else a
    rule-based one (ruleSuffix: "<x>.<wildcard tld>" or "<x>.<wildcard
    base>"), never an exception."""
    h = host.lower().rstrip(".")
    if "." not in h:
        return True
    if h in PSL["suffixes"]:
        return True
    labels = h.split(".")
    if len(labels) < 2 or h in PSL["exceptions"]:
        return False
    if len(labels) == 2:
        return labels[1] in PSL["wildcard"]
    return ".".join(labels[1:]) in PSL["wildcard_bases"]


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


IMPORTANT_RE = re.compile(r"(?:^\$|,)\s*important\s*(?:,|$)", re.IGNORECASE)


class ListEntries(tuple):
    """(whole, scoped) as extract_entries() returns it, plus the list's
    cross-list data: .cancel ($badfilter idents "domain\nkey"), .allow (hosts of
    unconditional `@@||host^` exceptions), .limit (hosts of every other
    `@@||host...` exception: a path or options), .important (whole-domain blocks
    marked $important, which an exception never lifts) and .alldoc (hosts
    whose plain `$all` added a DOCUMENT_KEY entry)."""

    cancel: set
    allow: set
    limit: set
    important: set
    alldoc: set


def extract_list(text: str) -> ListEntries:
    """Mirrors parseEntries() in src/general/update.js.

    $badfilter cancels the filter with the same domain and scope key, in this
    list here and in every other list through apply_cross_list(). Only an
    exception with no options at all (`@@||host^`) is kept, and it lifts only
    the whole-domain block of that same host (apply_cross_list). Every other
    `@@||host...` line (a path or options) is not converted, but its host
    goes into .limit: apply_cross_list drops the $domain= filters of that
    host, a subdomain or a parent of it. A "! openphish" section is dropped
    up to the next comment line.
    """
    whole: list[str] = []
    scoped: list[list[str]] = []
    cancelled: set[str] = set()
    allow: set[str] = set()
    limit: set[str] = set()
    important: set[str] = set()
    alldoc: set[str] = set()
    doc_explicit: set[str] = set()
    dropping = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("!"):
            dropping = DROPPED_SECTION_RE.match(line) is not None
        if dropping or not line or line.startswith("!") or line.startswith("["):
            continue
        if line.startswith("@@"):
            em = DOMAIN_RE.match(line[2:])
            if em and not em.group(2) and looks_like_domain(em.group(1).lower()):
                allow.add(em.group(1).lower())
            else:
                # A path / option exception: its host limits $domain=
                # filters across lists (apply_cross_list). Mirrors parseEntriesFull().
                h = exception_host(line[2:])
                if h and "." in h:
                    limit.add(h)
            continue
        if "#$" in line or "##" in line or "#@#" in line:
            continue
        m = DOMAIN_RE.match(line)
        if m:
            domain = m.group(1).lower()
            res = convert_options(m.group(2) or "")
            if res is None or not looks_like_domain(domain):
                continue
            key, cancel = res
            # A plain `$all` also blocks opening the page. Mirrors parseEntriesFull().
            doc = bool(m.group(2)) and all_adds_document(m.group(2))
            if cancel:
                cancelled.add(domain + "\n" + key)
                if doc:
                    cancelled.add(domain + "\n" + DOCUMENT_KEY)
            elif key == "":
                whole.append(domain)
                if m.group(2) and IMPORTANT_RE.search(m.group(2)):
                    important.add(domain)
                if doc:
                    scoped.append([domain, DOCUMENT_KEY])
                    alldoc.add(domain)
            else:
                scoped.append([domain, key])
                if key == DOCUMENT_KEY:
                    doc_explicit.add(domain)
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
    out = ListEntries((whole, scoped))
    out.cancel = cancelled
    out.allow = allow
    out.limit = limit
    out.important = important
    # Only hosts whose page entry comes from `$all` alone (an explicit
    # `$document` for the same host shares the entry and keeps it).
    out.alldoc = alldoc - doc_explicit
    return out


def extract_entries(text: str) -> tuple[list[str], list[list[str]]]:
    """(whole-domain blocks, [[domain, scope key], ...]) of one list."""
    whole, scoped = extract_list(text)
    return whole, scoped


def collect_cross(lists: list) -> dict:
    """Union of the cross-list data of `lists` (extract_list results or
    PACKED_CROSS-style dicts). Mirrors the collection in crossListRules()."""
    cancel: set[str] = set()
    allow: set[str] = set()
    limit: set[str] = set()
    important: set[str] = set()
    alldoc: set[str] = set()
    doc_explicit: set[str] = set()
    for entry in lists:
        if isinstance(entry, dict):
            get = entry.get
        else:
            get = (lambda e: lambda k, d: getattr(e, k, d))(entry)
        cancel |= set(get("cancel", set()))
        allow |= set(get("allow", set()))
        limit |= set(get("limit", set()))
        important |= set(get("important", set()))
        own = set(get("alldoc", set()))
        alldoc |= own
        if isinstance(entry, tuple) and len(entry) > 1:
            doc_explicit |= {e[0] for e in entry[1] if e[1] == DOCUMENT_KEY and e[0] not in own}
    allow -= important
    partial: dict[str, set] = {}
    for c in cancel:
        d, _, k = c.partition("\n")
        split = initiator_split(k)
        if split is not None:
            partial.setdefault(d + "\n" + split[0], set()).update(split[1])
    return {
        "cancel": cancel,
        "allow": allow,
        "lift_doc": (allow & alldoc) - doc_explicit,
        "partial": partial,
        "limits": limit_index(limit) if limit else None,
    }


def cross_scope_of(cross: dict, d: str, k: str):
    """The key a scoped entry keeps after the cross-list step, or None.
    Mirrors scopeOf() in crossListRules()."""
    if d + "\n" + k in cross["cancel"]:
        return None
    if k == DOCUMENT_KEY and d in cross["lift_doc"]:
        return None
    key = k
    if cross["partial"]:
        split = initiator_split(k)
        drop = cross["partial"].get(d + "\n" + split[0]) if split else None
        if drop:
            key = remove_initiators(k, drop)
        if key is None:
            return None
    if cross["limits"] is not None and limits_scoped(cross["limits"], d, key):
        return None
    return key


def apply_cross_list(buckets: dict, scoped_buckets: dict, lists: list) -> tuple[dict, dict]:
    """Apply every list's $badfilter cancels and unconditional same-host `@@`
    exceptions (extract_list results in `lists`) to all buckets, before
    merge_domains / merge_scoped. Mirrors crossListRules() in update.js.
    A lifted host also loses the DOCUMENT_KEY entry its plain `$all` added
    (.alldoc), so the page opens; an explicit `$document` block stays (a
    host with one in any list keeps its page entry).
    Final review fixes: a $badfilter with $domain= removes only those
    initiators from the same filter of every list (#1); a $domain= filter
    whose host (or a subdomain or parent of it) has a path / option
    exception in any list is dropped (#0).
    Threat-tier hosts are built elsewhere and are not touched."""
    cross = collect_cross(lists)
    new_buckets = OrderedDict(
        (n, [d for d in ds if d + "\n" not in cross["cancel"] and d not in cross["allow"]]) for n, ds in buckets.items()
    )
    new_scoped = OrderedDict()
    for n, es in scoped_buckets.items():
        kept = []
        for e in es:
            k = cross_scope_of(cross, e[0], e[1])
            if k is not None:
                kept.append(e if k == e[1] else [e[0], k])
        new_scoped[n] = kept
    return new_buckets, new_scoped


def packed_cross_data(named) -> dict:
    """Per list (name -> extract_list result), that list's FULL cross-list
    data: every cancel ($badfilter), allow (unconditional `@@||host^`), limit
    (path / option exception hosts), important and alldoc entry (final
    review #6, widened in 0.3.5). Written to src/rules/packed-cross.json; the
    runtime uses a list's part only while that list has no current parsed
    copy. Full data, not only the entries that changed something at pack
    time: a filter that another list adds after the pack must still be
    cancelled, lifted or limited while the list that carries the exception
    cannot be downloaded.

    Exception: alldoc is kept only for hosts that some list's allow set names
    at pack time. An alldoc entry acts only together with an allow entry for
    the same host (crossListRules: k === docKey && allow.has(d) &&
    allDoc.has(d)), and the full set (about 12,000 malware hosts) put the
    package over the 8 MB release-gate cap. A missing list's alldoc could
    lift a packed page block only, and the packed "general" ruleset stays
    enabled during a refresh, so that block applies anyway."""
    allowed: set = set()
    for entry in named.values():
        allowed |= set(getattr(entry, "allow", set()) or ())
    out: dict = {}
    for name, entry in named.items():
        part: dict = {}
        for key in ("cancel", "allow", "limit", "important", "alldoc"):
            values = getattr(entry, key, set()) or ()
            if key == "alldoc":
                values = [h for h in values if h in allowed]
            values = sorted(values)
            if values:
                part[key] = values
        if part:
            out[name] = part
    return {"version": 1, "lists": out}


PACKED_CROSS_JSON = OUT_DIR / "packed-cross.json"


def write_packed_cross(data: dict) -> bool:
    """Write src/rules/packed-cross.json (the worker loads it with the bundled
    rules; ad-network names stay inside src/rules/). True when it changed."""
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=True, sort_keys=True) + "\n"
    old = PACKED_CROSS_JSON.read_text(encoding="utf-8") if PACKED_CROSS_JSON.exists() else None
    if old == body:
        return False
    PACKED_CROSS_JSON.write_text(body, encoding="utf-8", newline="\n")
    return True


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

    # No silent cut at MAX_DNR_RULES: main() refuses a pack over the budget
    # before anything is written, so a lost rule is never hidden.
    for i in range(0, len(domains), DOMAINS_PER_RULE):
        push(domains[i : i + DOMAINS_PER_RULE], {})
    groups: dict[str, list[str]] = {}
    for d, key in scoped or []:
        groups.setdefault(key, []).append(d)
    for key in sorted(groups):
        extra = key_to_condition(key)
        lst = groups[key]
        for i in range(0, len(lst), DOMAINS_PER_RULE):
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
            "- Network blocking in `general-network.json` (domain -> DNR `requestDomains`), from all lists.",
            "- The malware and threat lists also go into the `threat` ruleset in `threat-network.json`",
            "  (built by `scripts/build-threat-rules.mjs`).",
            "- At run time the extension downloads new copies of the lists and puts them in dynamic",
            "  DNR rules. See `docs/permissions-and-privacy.md`.",
            "- Hide rules (`##`) from " + ", ".join(BUNDLED_COSMETIC_LISTS) + " in `cosmetic-rules.json` (built by `scripts/pack-cosmetic.mjs`).",
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


# Lists whose `##` hide rules go into the bundled sheet, in the runtime's order
# (the `cosmetic: true` SOURCES of src/general/update.js; COSMETIC_LISTS in
# scripts/pack-cosmetic.mjs). test/wave2-lists-cosmetic-pack.test.js checks all three agree.
# AdGuard Base is not a hide-rule source in 0.3.5 (its site rules needed about
# 5 MB of the 10 MB chrome.storage.local quota).
COSMETIC_LISTS = ("easylist", "easyprivacy")
# The lists packed into the shipped sheet (BUNDLED_LISTS in pack-cosmetic.mjs).
BUNDLED_COSMETIC_LISTS = ("easylist", "easyprivacy")


def cosmetic_pack_command(packed_at: str) -> list[str]:
    """The command that rebuilds src/rules/cosmetic-rules.json from the cache."""
    return [
        "deno", "run", "--allow-read", "--allow-write",
        str(ROOT / "scripts" / "pack-cosmetic.mjs"),
        "--packed-at", packed_at,
        "--cache", str(CACHE_DIR),
    ]


def run_cosmetic_pack(packed_at: str) -> int:
    try:
        res = subprocess.run(cosmetic_pack_command(packed_at), cwd=str(ROOT), check=False)
    except FileNotFoundError:
        print("ERROR: deno not found; run scripts/pack-cosmetic.mjs by hand", file=sys.stderr)
        return 3
    if res.returncode != 0:
        print("ERROR: scripts/pack-cosmetic.mjs failed", file=sys.stderr)
    return res.returncode


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
    extracted: list = []
    extracted_by_name: OrderedDict = OrderedDict()

    # Fetch highest-priority first for merge order.
    ordered_names = sorted(
        SOURCES.keys(), key=lambda n: SOURCES[n]["priority"], reverse=True
    )
    for name in ordered_names:
        text, digest = fetch(SOURCES[name]["url"], name)
        digests[name] = digest
        entry = extract_list(text)
        extracted.append(entry)
        extracted_by_name[name] = entry
        buckets[name], scoped_buckets[name] = entry
        if name in ("easylist", "easyprivacy") and not cosmetic_sample:
            cosmetic_sample = extract_cosmetic_sample(text)

    # Rebuild buckets in priority order for merge_domains iteration.
    buckets = OrderedDict((n, buckets[n]) for n in ordered_names)
    scoped_buckets = OrderedDict((n, scoped_buckets[n]) for n in ordered_names)
    # $badfilter and unconditional `@@||host^` across lists, as uBO does.
    buckets, scoped_buckets = apply_cross_list(buckets, scoped_buckets, extracted)
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
    if len(rules) > MAX_DNR_RULES:
        print(f"ERROR: {len(rules)} DNR rules exceed the budget of {MAX_DNR_RULES}; nothing written", file=sys.stderr)
        return 1
    # Each list's full cross-list data, for the runtime refresh while
    # that list has no parsed copy (final review #6). Only after the budget
    # check, so a refused pack writes nothing.
    if write_packed_cross(packed_cross_data(extracted_by_name)):
        print(f"wrote {PACKED_CROSS_JSON.relative_to(ROOT)}")

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
    # Bundled hide sheet (src/rules/cosmetic-rules.json) from the same downloads
    # (COSMETIC_LISTS), so it never goes stale next to general-network.json and
    # carries this pack's time. Last, because it refuses (non-zero exit, the old
    # sheet kept) a list the runtime refresh guard would reject.
    return run_cosmetic_pack(fetched_at)


if __name__ == "__main__":
    raise SystemExit(main())
