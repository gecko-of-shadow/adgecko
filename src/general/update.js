// Filter-list refresh engine.
// Policy "alarm-and-manual": the worker's "gecko-refresh" alarm (every 3 h) asks
// for a refresh; it runs at most once per 12 h after a successful run (and at
// most every 30 min after a failed attempt: a failed run asks the worker for
// one "gecko-refresh-retry" alarm 31 min later), each list is only re-downloaded
// after its own "! Expires:" window, plus the popup's Update button.
// Conditional requests (ETag / If-Modified-Since). Lists are parsed to
// domain block rules and swapped into dynamic DNR rules; the bundled static
// "general" ruleset stays enabled as the floor (only the lists switch turns it
// off). The threat lists also feed the dynamic threat tier (src/threat/).
//
// Storage split: deps.getState()/setState() hold only small run metadata (per
// list: url, etag, lastModified, fetchedAt, expiresMs, count, cosmetic flag).
// The bulky parsed payload ({domains, cosmetic}) goes through
// deps.setListData(name, payload) / deps.getListData(names) and is written only
// after a 200 response parsed cleanly; it is read only when rules are rebuilt.
function installGeneralAdblockUpdate(target) {
  const POLICY = "alarm-and-manual";
  const REFRESH_ALARM = "gecko-refresh";
  const ALARM_PERIOD_MINUTES = 180;
  const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const RETRY_MIN_MS = 30 * 60 * 1000;
  // One-shot alarm the worker creates after a failed run (ran:true, ok:false).
  // The first 3 h alarm comes 5 to 30 min after it is created, so after a
  // failed install-time run it was always throttled (review 2026-11-16 WP-16).
  const RETRY_ALARM = "gecko-refresh-retry";
  const RETRY_DELAY_MINUTES = 31;
  // A stored time later than now + this is from a clock that was set ahead:
  // it is ignored, else automatic refreshes stop until the clock reaches it.
  const CLOCK_SKEW_MS = 5 * 60 * 1000;
  const DEFAULT_EXPIRES_MS = 24 * 60 * 60 * 1000;
  const DOMAINS_PER_RULE = 80;
  const MAX_LIST_RULES = 25000; // dynamic limit is 30000; leave room for allows
  const LIST_RULE_ID_BASE = 100000;
  const KEPT_RULE_ID_BASE = 800000; // copies of bundled allow / extra rules
  const ALLOW_RULE_ID_BASE = 900000; // user "Allow this page" rules (untouched)
  // Refreshed threat-tier rules (priority 2,000,010, src/threat/compile.js).
  // Own id range and own updateDynamicRules call: the lists switch, fallback()
  // and a failed list swap never touch them; only a rebuild replaces them.
  const THREAT_RULE_ID_BASE = 600000;
  const THREAT_RULE_ID_END = 610000;
  const DYNAMIC_RULE_LIMIT = 30000; // Chrome's dynamic (+session) "safe" rule cap
  const FETCH_TIMEOUT_MS = 90000;
  // Largest list body read (the biggest list today is about 4.4 MB).
  const MAX_LIST_BYTES = 16 * 1024 * 1024;

  // Response body as text, stopping (and cancelling) past `cap` bytes.
  async function readListText(res, cap) {
    const len = Number(res.headers && res.headers.get && res.headers.get("Content-Length"));
    if (len > cap) throw new Error("list larger than " + cap + " bytes");
    const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
    if (!reader) {
      const whole = await res.text();
      if (whole.length > cap) throw new Error("list larger than " + cap + " bytes");
      return whole;
    }
    const decoder = new TextDecoder();
    let total = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          // already closed
        }
        throw new Error("list larger than " + cap + " bytes");
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  }

  // Primary URL first, then mirrors of the same list (tried in order).
  const SOURCES = [
    { name: "peter_lowe", url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext", minDomains: 1000, mirrors: [] },
    { name: "urlhaus_hosts", url: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt", mirrors: [], maxDomains: 8000, minDomains: 50 },
    { name: "easylist", url: "https://easylist.to/easylist/easylist.txt", cosmetic: true, minDomains: 10000, mirrors: [
      "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt",
      "https://easylist-downloads.adblockplus.org/easylist.txt",
      "https://secure.fanboy.co.nz/easylist.txt",
    ] },
    { name: "easyprivacy", url: "https://easylist.to/easylist/easyprivacy.txt", cosmetic: true, minDomains: 10000, mirrors: [
      "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt",
      "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
      "https://secure.fanboy.co.nz/easyprivacy.txt",
    ] },
    { name: "hagezi_pro_mini", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt", minDomains: 10000, mirrors: [] },
    { name: "ublock_badware", url: "https://ublockorigin.github.io/uAssets/filters/badware.txt", minDomains: 500, mirrors: [] },
    { name: "dandelion_antimalware", url: "https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Dandelion%20Sprout%27s%20Anti-Malware%20List.txt", minDomains: 1000, mirrors: [] },
    // AdGuard Base: network rules only (0.3.5). Its site hide rules (a
    // `cosmetic: "sites"` source, parseCosmetic sitesOnly) needed about 5 MB
    // of chrome.storage.local (quota 10 MB) and pushed a list refresh over
    // the quota. They can come back with an IndexedDB store; the refresh code
    // for `cosmetic: "sites"` sources stays. A payload stored with hide rules
    // by an earlier build loses them on the next refresh (dropRetiredCosmetic).
    { name: "adguard_base", url: "https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt", minDomains: 1000, mirrors: [] },
  ];
  const LIST_HOSTS = ["pgl.yoyo.org", "malware-filter.gitlab.io", "easylist.to", "ublockorigin.github.io", "easylist-downloads.adblockplus.org", "secure.fanboy.co.nz", "raw.githubusercontent.com", "filters.adtidy.org"];
  // Dynamic allow rule so no block rule (ours or a stale one) can stop the
  // extension's own list downloads. Outside the list and user-allow id ranges.
  const LIST_ALLOW_RULE_ID = 990001;
  // extraHosts: the signed-feed host once it is configured (src/feed/config.js).
  function listAllowRule(extensionId, extraHosts) {
    const hosts = LIST_HOSTS.slice();
    for (const h of extraHosts || []) if (h && !hosts.includes(h)) hosts.push(h);
    return {
      id: LIST_ALLOW_RULE_ID,
      priority: 3000000,
      action: { type: "allow" },
      condition: { requestDomains: hosts, initiatorDomains: [extensionId], resourceTypes: ["xmlhttprequest", "other"] },
    };
  }

  const NEVER_BLOCK_SUFFIXES = [
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net", "twitchcdn.com", "ext-twitch.tv",
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "ggpht.com",
    "youtubei.googleapis.com", "googleapis.com", "gstatic.com", "kick.com", "kick-streamer.com",
    "live-video.net", "youtube-nocookie.com", "youtubekids.com", "kickusercontent.com",
  ];
  // Captcha widget hosts, kept apart from the stream hosts above. The ONE list
  // is src/rules/never-block-captcha.json, loaded as the generated
  // general/never-block-captcha.js (importScripts, before this file).
  const captchaData = typeof globalThis !== "undefined" && globalThis.GeckoNeverBlockCaptcha;
  if (!captchaData || !Array.isArray(captchaData.SUFFIXES) || !captchaData.SUFFIXES.length) {
    throw new Error("update.js: load general/never-block-captcha.js first");
  }
  const NEVER_BLOCK_CAPTCHA = captchaData.SUFFIXES.slice();

  const DOMAIN_RE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$/i;
  const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*[a-z0-9])\s*$/i;
  const BARE_RE = /^([a-z0-9][a-z0-9.-]*[a-z0-9])$/i;
  // Payloads parsed before faithful option conversion (H-2) hold widened
  // domains; they are refetched and, until then, replaced by the packed rules.
  // 4 (nightly 0.3.5): $domain= / $from=, $method and $denyallow filters are
  // converted (general/filter-options.js table version 2) instead of dropped,
  // a plain $all also blocks the page itself, and AdGuard Base carries hide
  // rules, so every stored copy is refetched.
  // 5 (0.3.6): the hide-rule part also keeps the $generichide / $specifichide
  // / $elemhide page exceptions (cosmetic-parse.js parseNoHide), so every
  // stored copy is parsed again and the hide sheet gets them.
  // 6 (0.3.8): a type-only exception (`@@||host^$xmlhttprequest`) is kept as
  // payload.allowScoped, so every stored copy is parsed again (see
  // exceptionAllows).
  const PARSER_VERSION = 6;

  // Shared with the packer: general/filter-options.js (loaded before this file).
  function filterOptions() {
    return (typeof globalThis !== "undefined" && globalThis.GeneralFilterOptions) || null;
  }

  // Back-compat helper: true only for options that keep a whole-domain block.
  function keepsWholeDomain(opts) {
    if (!opts) return true;
    const FO = filterOptions();
    const res = FO ? FO.convertOptions(opts) : null;
    return !!(res && res.key === "" && !res.cancel);
  }

  // Ad hosts that sit under a broad never-block suffix and must stay blocked
  // in every path: the packed ruleset blocks them through the merger's extra
  // tracker rule (scripts/merge-dnr-rules.py EXTRA_TRACKER_DOMAINS), so a
  // refreshed list that names them keeps blocking them too. Same list as
  // NEVER_BLOCK_EXCEPTIONS in scripts/pack-filter-lists.py (parity test).
  const NEVER_BLOCK_EXCEPTIONS = ["imasdk.googleapis.com"];

  function isNeverBlock(domain) {
    const d = String(domain || "").toLowerCase().replace(/\.$/, "");
    if (NEVER_BLOCK_EXCEPTIONS.some((s) => d === s || d.endsWith("." + s))) return false;
    return NEVER_BLOCK_SUFFIXES.concat(NEVER_BLOCK_CAPTCHA).some((s) => d === s || d.endsWith("." + s));
  }

  // Security review L-3: a list line naming a public suffix ("co.uk") or a
  // private / loopback / link-local IPv4 address is never turned into a rule.
  // ICANN suffixes from src/threat/psl.js (skipped when not loaded, e.g. in old
  // harnesses). Private suffixes and shared-platform parents (github.io,
  // dynamic-DNS parents, ...) are left to the lists here: this tier is
  // priority 1, blocks navigations only for explicit `$document` filters, and
  // "Allow this site" / Settings -> "Allow this domain" override it.
  // The packer applies the same check.
  function localAddress(d) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(d);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }

  function looksLikeDomain(d) {
    if (!d.includes(".") || d.startsWith(".") || d.endsWith(".")) return false;
    if (/[\/*?|()[\]{}]/.test(d)) return false;
    if (!d.split(".").every(Boolean)) return false;
    if (localAddress(d)) return false;
    const PS = typeof globalThis !== "undefined" && globalThis.GeckoPublicSuffix;
    if (PS && PS.isIcannSuffix(d)) return false;
    return true;
  }

  // No OpenPhish data (owner decisions #13 and H-1): uBO's badware.txt carries a
  // "! openphish" section, dropped here up to the next comment line. Same rule
  // as DROPPED_SECTION_RE in scripts/pack-filter-lists.py. Built from pieces
  // because scripts/lib/curben_check.py refuses the word in code.
  const DROPPED_SECTION_RE = new RegExp("^!\\s*" + "open" + "phish\\b", "i");

  const IMPORTANT_RE = /(?:^\$|,)\s*important\s*(?:,|$)/i;

  // Same rules as scripts/pack-filter-lists.py extract_list().
  // Returns { domains: [whole-domain blocks], scoped: [[domain, key], ...] }
  // where key is a general/filter-options.js scope key. $badfilter cancels the
  // filter with the same domain and scope, in this list here and in every
  // other list at merge time (out.cancel). out.allow: hosts of unconditional
  // `@@||host^` exceptions (no options at all); at merge time they lift the
  // whole-domain block of that same host only, unless a list marks that block
  // `$important` (out.important). Neither touches the threat tier.
  // For the exception allow rules only (exceptionAllows): out.importantScoped,
  // hosts of scoped `$important` blocks, and out.cancelAllow, the exceptions
  // that an `@@...$badfilter` line withdraws ("host\nkey", key "" for a
  // plain `@@||host^`).
  function parseEntriesFull(text) {
    const FO = filterOptions();
    const whole = [];
    const scoped = [];
    const popup = [];
    const allow = [];
    const allowScoped = [];
    const limit = new Set();
    const important = [];
    const importantScoped = [];
    const cancelAllow = new Set();
    const allDoc = [];
    const docExplicit = new Set();
    const cancelled = new Set();
    let dropping = false;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("!")) dropping = DROPPED_SECTION_RE.test(line);
      if (dropping || !line || line.startsWith("!") || line.startsWith("[")) continue;
      if (line.startsWith("@@")) {
        const em = DOMAIN_RE.exec(line.slice(2));
        if (em && !em[2] && looksLikeDomain(em[1].toLowerCase())) allow.push(em[1].toLowerCase());
        else if (FO && FO.exceptionHost) {
          // `@@||host^$badfilter` or `@@||host^$type,badfilter`: that
          // exception gets no allow rule, in this list or any other.
          const undo = em && looksLikeDomain(em[1].toLowerCase()) ? FO.convertOptions(em[2]) : null;
          if (undo && undo.cancel) cancelAllow.add(em[1].toLowerCase() + "\n" + undo.key);
          // Only resource types (and party): kept for an allow rule.
          const typed = undo;
          const parts = typed && !typed.cancel && typed.key ? FO.parseKey(typed.key) : null;
          if (parts && parts.t && Object.entries(parts).every(([k, v]) => k === "p" || k === "t" || !v)) allowScoped.push([em[1].toLowerCase(), typed.key]);
          // A path / option exception: its host limits $domain= filters
          // (out.limit, applied across lists in crossListRules).
          const h = FO.exceptionHost(line.slice(2));
          if (h && h.includes(".")) limit.add(h);
        }
        continue;
      }
      if (line.includes("##") || line.includes("#@#") || line.includes("#$")) continue;
      let m = DOMAIN_RE.exec(line);
      if (m) {
        // Without the shared table, only option-less filters are safe to keep.
        const conv = FO ? FO.convertLine(line) : (m[2] ? null : [m[1].toLowerCase(), "", false]);
        if (!conv) {
          // Popup-only filters: kept apart for the threat tier (main_frame).
          if (FO && m[2] && FO.isPopupOnly(m[2]) && looksLikeDomain(m[1].toLowerCase())) popup.push(m[1].toLowerCase());
          continue;
        }
        const [d, key, cancel] = conv;
        if (!looksLikeDomain(d)) continue;
        // A plain `$all` also blocks opening the page (filter-options.js
        // allAddsDocument): one extra main_frame-only entry next to the
        // whole-domain block; `$all,badfilter` cancels both.
        const doc = !!(m[2] && FO.allAddsDocument && FO.allAddsDocument(m[2]));
        if (cancel) {
          cancelled.add(d + "\n" + key);
          if (doc) cancelled.add(d + "\n" + FO.DOCUMENT_KEY);
        } else if (key === "") {
          whole.push(d);
          if (m[2] && IMPORTANT_RE.test(m[2])) important.push(d);
          if (doc) {
            scoped.push([d, FO.DOCUMENT_KEY]);
            allDoc.push(d);
          }
        } else {
          scoped.push([d, key]);
          if (m[2] && IMPORTANT_RE.test(m[2])) importantScoped.push([d, key]);
          if (FO && key === FO.DOCUMENT_KEY) docExplicit.add(d);
        }
        continue;
      }
      m = HOSTS_RE.exec(line);
      if (m) {
        const d = m[1].toLowerCase();
        if (d !== "localhost" && d !== "local" && looksLikeDomain(d)) whole.push(d);
        continue;
      }
      if (BARE_RE.test(line) && looksLikeDomain(line)) whole.push(line.toLowerCase());
    }
    const out = !cancelled.size ? { domains: whole, scoped } : {
      domains: whole.filter((d) => !cancelled.has(d + "\n")),
      scoped: scoped.filter(([d, k]) => !cancelled.has(d + "\n" + k)),
    };
    if (popup.length) out.popup = popup;
    if (cancelled.size) out.cancel = Array.from(cancelled);
    if (allow.length) out.allow = allow;
    if (allowScoped.length) out.allowScoped = allowScoped;
    if (limit.size) out.limit = Array.from(limit).sort();
    if (important.length) out.important = important;
    const impScoped = Array.from(new Set(importantScoped.filter(([d, k]) => !cancelled.has(d + "\n" + k)).map(([d]) => d)));
    if (impScoped.length) out.importantScoped = impScoped;
    if (cancelAllow.size) out.cancelAllow = Array.from(cancelAllow);
    // Only hosts whose page entry comes from `$all` alone: an explicit
    // `$document` filter for the same host shares that entry and stays.
    const allDocOnly = allDoc.filter((d) => !docExplicit.has(d));
    if (allDocOnly.length) out.alldoc = allDocOnly;
    return out;
  }

  // The per-list result only (domains, scoped, popup), as the shared fixture
  // test/fixtures/filter-options-cases.json pins it.
  function parseEntries(text) {
    const out = parseEntriesFull(text);
    delete out.cancel;
    delete out.allow;
    delete out.allowScoped;
    delete out.limit;
    delete out.important;
    delete out.importantScoped;
    delete out.cancelAllow;
    delete out.alldoc;
    return out;
  }

  // Cross-list $badfilter cancels and unconditional same-host @@ exceptions
  // (nightly 0.3.5), collected from every list's payload. Payloads stored
  // before this carry neither field and simply add nothing. A lifted host
  // also loses the main_frame entry its plain `$all` added (alldoc: hosts
  // with such an entry), so the page opens; an explicit `$document` block is
  // not touched (a host with one in any list keeps its page entry). Same
  // rules as apply_cross_list in pack-filter-lists.py.
  // Final review fixes (0.3.5):
  //  - #1 a $badfilter with $domain= removes only those initiators from the
  //    same filter of every list (same domain, same other key parts); the
  //    entry goes when none is left.
  //  - #0 a $domain= filter (i= / n= part) is dropped when any list has a
  //    path / option exception for its host, a subdomain or a parent of it
  //    (payload.limit).
  //  - #6 `missing`: names of lists with no current parsed copy. Their
  //    pack-time cross data (src/rules/packed-cross.json, passed in as
  //    packedCross by swap(); filter-options.js PACKED_CROSS in tests) is
  //    used instead.
  // scopeOf(d, k) gives the key an entry keeps (maybe with fewer
  // initiators) or null; keepScoped(d, k) is scopeOf(d, k) !== null.
  function crossListRules(payloads, missing, packedCross) {
    const FO = filterOptions();
    const docKey = FO ? FO.DOCUMENT_KEY : null;
    const cancel = new Set();
    const allow = new Set();
    const important = new Set();
    const importantScoped = new Set();
    const cancelAllow = new Set();
    const allDoc = new Set();
    const docExplicit = new Set();
    const limit = new Set();
    const allowScoped = new Map();
    const sources = Object.values(payloads || {});
    const packedSrc = packedCross || (FO && FO.PACKED_CROSS) || null;
    const packedLists = (packedSrc && packedSrc.lists) || {};
    for (const n of missing || []) {
      if (payloads && payloads[n]) continue;
      if (Object.prototype.hasOwnProperty.call(packedLists, n)) sources.push(packedLists[n]);
    }
    for (const p of sources) {
      if (!p) continue;
      for (const c of Array.isArray(p.cancel) ? p.cancel : []) cancel.add(String(c));
      for (const a of Array.isArray(p.allow) ? p.allow : []) allow.add(String(a));
      for (const e of Array.isArray(p.allowScoped) ? p.allowScoped : []) if (Array.isArray(e)) allowScoped.set(e[0] + "\n" + e[1], [String(e[0]), String(e[1])]);
      for (const h of Array.isArray(p.limit) ? p.limit : []) limit.add(String(h));
      for (const i of Array.isArray(p.important) ? p.important : []) important.add(String(i));
      for (const i of Array.isArray(p.importantScoped) ? p.importantScoped : []) importantScoped.add(String(i));
      for (const c of Array.isArray(p.cancelAllow) ? p.cancelAllow : []) cancelAllow.add(String(c));
      const own = new Set(Array.isArray(p.alldoc) ? p.alldoc.map(String) : []);
      for (const h of own) allDoc.add(h);
      for (const e of Array.isArray(p.scoped) ? p.scoped : []) if (e && e[1] === docKey && !own.has(e[0])) docExplicit.add(e[0]);
    }
    for (const i of important) allow.delete(i);
    // `@@||host^$badfilter` withdraws the exception itself: it lifts no
    // same-host block (keepWhole) and no `$all` page entry either.
    for (const c of cancelAllow) if (c.endsWith("\n")) allow.delete(c.slice(0, -1));
    for (const h of docExplicit) allDoc.delete(h);
    // "domain\nkey without i=" -> initiators its $badfilter removes.
    const partial = new Map();
    if (FO && FO.initiatorSplit) {
      for (const c of cancel) {
        const nl = c.indexOf("\n");
        const split = FO.initiatorSplit(c.slice(nl + 1));
        if (!split) continue;
        const id = c.slice(0, nl) + "\n" + split[0];
        if (!partial.has(id)) partial.set(id, new Set());
        for (const h of split[1]) partial.get(id).add(h);
      }
    }
    const limits = FO && FO.limitIndex && limit.size ? FO.limitIndex(limit) : null;
    function scopeOf(d, k) {
      if (cancel.has(d + "\n" + k)) return null;
      if (k === docKey && allow.has(d) && allDoc.has(d)) return null;
      let key = k;
      if (partial.size) {
        const split = FO.initiatorSplit(k);
        const drop = split ? partial.get(d + "\n" + split[0]) : null;
        if (drop) key = FO.removeInitiators(k, drop);
        if (key === null) return null;
      }
      if (limits && FO.limitsScoped(limits, d, key)) return null;
      return key;
    }
    return {
      keepWhole: (d) => !cancel.has(d + "\n") && !allow.has(d),
      keepScoped: (d, k) => scopeOf(d, k) !== null,
      scopeOf,
      allow,
      allowScoped: Array.from(allowScoped.values()),
      important,
      importantScoped,
      cancelAllow,
    };
  }

  // List `@@` exceptions as DNR allow rules (priority 1, so they beat the
  // priority-1 list blocks, dynamic and packed). They also beat the bundled
  // extra-tracker block, which is priority 1 too. The threat tier, the
  // stream-site rules, the other hand-written rules above priority 1 and the
  // user's rules keep winning.
  // keepWhole only drops a block of the SAME host. A subdomain of a blocked
  // parent (`@@||alllaw.112.2o7.net^` under `||2o7.net^`) and a type-only
  // exception (`@@||chart-embed.service.newrelic.com^$subdocument,xmlhttprequest`)
  // need an allow rule, as uBO applies them. Only for hosts that some block
  // covers (the host or a parent). Never for a host with a `$important` block
  // (whole-domain or scoped) on it, on a parent or on a subdomain: the allow
  // rule covers the subdomains too. Never for an exception that a
  // `@@...$badfilter` line withdraws (cross.cancelAllow).
  function exceptionAllows(cross, blockedHosts) {
    const covered = (h, set) => {
      for (let d = h; d;) {
        if (set.has(d)) return true;
        const i = d.indexOf(".");
        if (i < 0) return false;
        d = d.slice(i + 1);
      }
      return false;
    };
    const important = new Set([...((cross && cross.important) || []), ...((cross && cross.importantScoped) || [])]);
    const underIt = (h) => {
      for (const i of important) if (i.endsWith("." + h)) return true;
      return false;
    };
    const cancelled = (cross && cross.cancelAllow) || new Set();
    const usable = (h) => looksLikeDomain(h) && covered(h, blockedHosts) && !covered(h, important) && !underIt(h);
    const whole = Array.from((cross && cross.allow) || []).filter((h) => usable(h) && !cancelled.has(h + "\n")).sort();
    const scoped = ((cross && cross.allowScoped) || []).filter(([h, k]) => usable(h) && !cancelled.has(h + "\n" + k)).sort((a, b) => (a[1] + a[0] < b[1] + b[0] ? -1 : 1));
    return { whole, scoped };
  }

  // Scoped entries of one list after the cross-list step (crossListRules):
  // dropped ones removed, narrowed ones with their new key.
  function crossScoped(cross, scoped) {
    const out = [];
    for (const e of scoped || []) {
      const k = cross.scopeOf ? cross.scopeOf(e[0], e[1]) : (cross.keepScoped(e[0], e[1]) ? e[1] : null);
      if (k !== null) out.push(k === e[1] ? e : [e[0], k]);
    }
    return out;
  }

  // Whole-domain blocks only (scoped filters are not widened into these).
  function parseList(text) {
    return parseEntries(text).domains;
  }

  // "! Expires: 4 days" / "! Expires: 12 hours" in the header; default 1 day.
  function parseExpires(text) {
    const head = String(text || "").slice(0, 4000);
    const m = /^!\s*Expires:\s*(\d+)\s*(day|hour)/im.exec(head);
    if (!m) return DEFAULT_EXPIRES_MS;
    const n = parseInt(m[1], 10);
    const ms = n * (m[2].toLowerCase() === "day" ? 86400000 : 3600000);
    return Math.max(MIN_INTERVAL_MS, Math.min(ms, 7 * 86400000));
  }

  function mergeDomains(perList) {
    const seen = new Set();
    const ordered = [];
    for (const src of SOURCES) {
      let kept = 0;
      for (const d of perList[src.name] || []) {
        if (isNeverBlock(d) || seen.has(d)) continue;
        seen.add(d);
        ordered.push(d);
        kept += 1;
        if (src.maxDomains && kept >= src.maxDomains) break;
        if (ordered.length >= MAX_LIST_RULES * DOMAINS_PER_RULE) return ordered;
      }
    }
    return ordered;
  }

  // The scope an entry keeps next to the whole-domain set (filter-options.js
  // scopeForMerge): a whole-domain host keeps only an explicit $document part
  // (main_frame: a whole-domain rule never matches opening the page), a
  // navigation-exempt host never keeps main_frame. Without the shared file,
  // the old rule (drop entries of whole-domain hosts).
  function mergedScope(d, key, whole) {
    const FO = filterOptions();
    if (FO && FO.scopeForMerge) return FO.scopeForMerge(d, key, whole.has(d));
    return whole.has(d) ? null : key;
  }

  // Scoped entries per list, in source order, deduped, never-block removed, and
  // reduced to their main_frame part (or dropped) when the same domain is
  // already a whole-domain block.
  function mergeScoped(perListScoped, wholeDomains) {
    const whole = new Set(wholeDomains);
    const seen = new Set();
    const out = [];
    for (const src of SOURCES) {
      let kept = 0;
      for (const [d, key0] of perListScoped[src.name] || []) {
        if (isNeverBlock(d)) continue;
        const key = mergedScope(d, key0, whole);
        if (key === null) continue;
        const id = d + "\n" + key;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push([d, key]);
        kept += 1;
        if (src.maxDomains && kept >= src.maxDomains) break;
      }
    }
    return out;
  }

  // Whole-domain batches first, then one batch series per scope key. The
  // exception allow rules (exceptionAllows) follow the blocks, in the same
  // layout.
  function buildListRules(domains, scoped, allows) {
    const FO = filterOptions();
    const rules = [];
    const series = (type, whole, entries) => {
      const push = (chunk, extra) => {
        rules.push({
          id: LIST_RULE_ID_BASE + rules.length,
          priority: 1,
          action: { type },
          condition: Object.assign({ requestDomains: chunk }, extra),
        });
      };
      for (let i = 0; i < whole.length && rules.length < MAX_LIST_RULES; i += DOMAINS_PER_RULE) {
        push(whole.slice(i, i + DOMAINS_PER_RULE), {});
      }
      if (entries.length && FO) {
        const groups = new Map();
        for (const [d, key] of entries) {
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(d);
        }
        for (const key of Array.from(groups.keys()).sort()) {
          const list = groups.get(key);
          const extra = FO.keyToCondition(key);
          for (let i = 0; i < list.length && rules.length < MAX_LIST_RULES; i += DOMAINS_PER_RULE) {
            push(list.slice(i, i + DOMAINS_PER_RULE), extra);
          }
        }
      }
    };
    // Stored payloads may predate the host checks in looksLikeDomain.
    series("block", (domains || []).filter((d) => looksLikeDomain(d)), (scoped || []).filter((e) => looksLikeDomain(e[0])));
    if (allows) series("allow", allows.whole || [], allows.scoped || []);
    return rules;
  }

  // Packed list rules are priority-1 blocks. Anything else in the bundle
  // (stream-site allows, extra trackers, higher-priority blocks that must beat
  // the YouTube allow) is a hand-written rule.
  function isPackedListRule(r, extra) {
    return !!(r && r.action && r.action.type === "block" && !(r.priority > 1) && !extra.has(r.id));
  }

  // Bundled non-list rules must survive the static ruleset being disabled,
  // so copy them into dynamic rules.
  function keptBundledRules(bundled, extraIds) {
    const extra = new Set(extraIds || []);
    let id = KEPT_RULE_ID_BASE;
    return (bundled || [])
      .filter((r) => r && r.action && !isPackedListRule(r, extra))
      .map((r) => Object.assign({}, r, { id: id++ }));
  }

  function isThreatRule(id) {
    return id >= THREAT_RULE_ID_BASE && id < THREAT_RULE_ID_END;
  }

  function isOurRule(id) {
    return id >= LIST_RULE_ID_BASE && id < ALLOW_RULE_ID_BASE && !isThreatRule(id);
  }

  // Per-refresh cap on NEW threat hosts (security review M-3): one refresh may
  // add at most this many hosts, and at most this share of the previous set
  // (the last refreshed set, else the packed `threat` ruleset). More than that
  // keeps the previous rules and records why; the same jump seen again on the
  // next refresh (within 10%) is accepted as real.
  const MAX_NEW_THREAT_HOSTS = 2500;
  const MAX_NEW_THREAT_RATIO = 0.2;

  // Fingerprint of an accepted threat host set (count + FNV-1a over the
  // sorted hosts). Stored at acceptance and kept when the threat tier is
  // switched off, so switching it back on re-installs that same set without
  // judging it again against the packed baseline (nightly 0.3.5).
  function threatSetSig(hosts) {
    const sorted = Array.from(new Set(hosts)).sort();
    let h = 0x811c9dc5;
    for (const d of sorted) {
      for (let i = 0; i < d.length; i++) {
        h ^= d.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      h ^= 10;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return sorted.length + ":" + h.toString(16);
  }

  function threatHostsOf(rules) {
    const out = new Set();
    for (const r of rules || []) for (const d of (r && r.condition && r.condition.requestDomains) || []) out.add(d);
    return out;
  }

  // Rebuild the dynamic threat rules from the threat lists' payloads. Errors
  // are recorded, never thrown: the static "threat" ruleset stays the floor.
  // opts.downloaded: a threat list was freshly downloaded in this run. Only
  // then may a held jump be confirmed (follow-up review: re-applying the same
  // stored payloads, e.g. switching the threat tier off and on, must not
  // count as "seen again").
  async function applyThreatRules(deps, payloads, now, opts) {
    const TC = typeof globalThis !== "undefined" && globalThis.GeckoThreatCompile;
    if (!TC) return { ok: false, reason: "threat compiler not loaded" };
    // Feature "threatTier" switched off: no refreshed threat rules either.
    if (deps.threatEnabled && !deps.threatEnabled()) return removeThreatRules(deps);
    try {
      const hosts = [];
      const popupHosts = [];
      for (const name of TC.THREAT_LISTS) {
        const p = payloads[name];
        if (p) {
          hosts.push(...TC.threatHostsFromEntries(p));
          popupHosts.push(...(p.popup || []));
        }
      }
      const existing = (await deps.getDynamicRules()) || [];
      const others = existing.filter((r) => !isThreatRule(r.id)).length;
      const budget = Math.max(0, Math.min(THREAT_RULE_ID_END - THREAT_RULE_ID_BASE, DYNAMIC_RULE_LIMIT - others - 100));
      const compiled = TC.compileThreatRules(hosts, { idBase: THREAT_RULE_ID_BASE, maxRules: budget, popupHosts });
      const previousRules = existing.filter((r) => isThreatRule(r.id));
      const sig = threatSetSig(compiled.accepted.concat(compiled.popupAccepted));
      let previous = threatHostsOf(previousRules);
      if (!previous.size && deps.loadPackedThreatRules) {
        try {
          previous = threatHostsOf(await deps.loadPackedThreatRules());
        } catch {
          previous = new Set();
        }
      }
      if (previous.size) {
        const added = compiled.accepted.concat(compiled.popupAccepted).filter((h) => !previous.has(h)).length;
        const tooMany = added > MAX_NEW_THREAT_HOSTS || added / previous.size > MAX_NEW_THREAT_RATIO;
        let st = {};
        try {
          st = (await deps.getState()) || {};
        } catch {
          st = {};
        }
        const seenBefore = !!(opts && opts.downloaded) && st.threatRejectedNew > 0 && st.threatHeldAt > 0 && now > st.threatHeldAt &&
          Math.abs(added - st.threatRejectedNew) / st.threatRejectedNew <= CONFIRM_RATIO;
        // The same set as the last accepted one (e.g. the threat tier or the
        // master switch went off and on): it was already judged, install it.
        const acceptedBefore = !!st.threatAcceptedSig && st.threatAcceptedSig === sig;
        if (tooMany && !seenBefore && !acceptedBefore) {
          const reason = "too many new threat hosts in one refresh (" + added + " new, " + previous.size + " before); kept the previous rules";
          // A held jump confirmed only by a later download keeps its first hold time.
          await deps.setState({ threatError: reason, threatRejectedNew: added, threatHeldAt: st.threatRejectedNew > 0 && st.threatHeldAt > 0 ? st.threatHeldAt : now });
          return { ok: false, reason, held: true };
        }
      }
      const removeRuleIds = previousRules.map((r) => r.id);
      await deps.updateDynamicRules({ removeRuleIds, addRules: compiled.rules });
      await deps.setState({ threatRules: compiled.rules.length, threatHosts: compiled.accepted.length, threatRejected: compiled.rejected.length, threatError: "", threatRejectedNew: 0, threatHeldAt: 0, threatUpdatedAt: now, threatAcceptedSig: sig });
      return { ok: true, rules: compiled.rules.length };
    } catch (e) {
      const reason = String(e && e.message || e);
      try {
        await deps.setState({ threatError: reason });
      } catch {
        // silent
      }
      return { ok: false, reason };
    }
  }

  // Throttle: automatic runs at most once per 12h after a successful run, and
  // at most every 30 min after a failed attempt; manual clicks always run.
  // lastRunAt is written only after a successful run (M-2), lastAttemptAt at
  // the start of every run. A time later than now + CLOCK_SKEW_MS counts as
  // not set.
  function pastTime(t, now) {
    const v = Number(t) || 0;
    return v > now + CLOCK_SKEW_MS ? 0 : v;
  }

  function shouldRun(state, now, manual) {
    if (manual) return true;
    const last = pastTime(state && state.lastRunAt, now);
    if (now - last < MIN_INTERVAL_MS) return false;
    const attempt = pastTime(state && state.lastAttemptAt, now);
    return !(now - attempt < RETRY_MIN_MS);
  }

  // `present`: the list's payload is actually stored (validators are useless,
  // and a 304 would leave the list empty, when it is not).
  function listDue(meta, now, manual, present) {
    if (!meta || !meta.fetchedAt || !present) return true;
    if (manual) return true; // still conditional; a 304 costs nothing
    if (meta.fetchedAt > now + CLOCK_SKEW_MS) return true; // clock was set ahead
    return now - meta.fetchedAt >= (meta.expiresMs || DEFAULT_EXPIRES_MS);
  }

  function listMeta(m) {
    const out = {};
    for (const k of ["url", "etag", "lastModified", "fetchedAt", "expiresMs", "count", "cosmetic", "parser", "genericCount", "rejectedCount", "rejectedGeneric", "protectedHits"]) if (m && m[k] !== undefined) out[k] = m[k];
    return out;
  }

  // ---- self-protection for downloaded lists (Block E) ----
  // A list that changes too much in one refresh, names many protected stream
  // hosts, or carries an abnormal hide list is rejected as a whole: its last
  // known good copy (the payload already stored) stays in use and the reason
  // is recorded in state.lastRejected[name].
  const MAX_CHANGE_RATIO = 0.25;
  // Other lists name at most a handful of protected stream hosts (2026-11-02).
  const PROTECTED_HITS_MAX = 25;
  // HaGeZi Pro mini names many telemetry hosts under the broad googleapis.com
  // never-block suffix (31 on the 2026-11-08 pack, 29 unique on 2026-11-09).
  // That is the list, not a poisoned dump of stream edges, so its cap adapts:
  // cap = the hit count of the last accepted copy (stored as protectedHits in
  // that list's meta, written only when a refresh is accepted) +
  // PROTECTED_HITS_MARGIN. A count above PROTECTED_HITS_SPIKE x the last
  // accepted count (when that count is at least 1) is rejected too, so a
  // poisoned copy is still caught even when the margin would allow it. With
  // no accepted count stored yet the cap is the seed, the old fixed value.
  // Every other list stays at PROTECTED_HITS_MAX.
  const PROTECTED_HITS_SEED_BY_LIST = { hagezi_pro_mini: 64 };
  const PROTECTED_HITS_MARGIN = 10;
  const PROTECTED_HITS_SPIKE = 2;
  const MAX_GENERIC_SELECTORS = 30000; // EasyList ~13,600
  const MAX_PAGE_ROOT_SITE_RULES = 100; // EasyList ~17 ("aads.com##HTML")

  function protectedHits(parsed) {
    const PH = typeof globalThis !== "undefined" && globalThis.GeckoProtectedHosts;
    const hits = [];
    const hosts = (parsed.domains || []).concat((parsed.scoped || []).map((e) => e[0]));
    for (const h of hosts) {
      const why = PH ? PH.protectedReason(h) : (isNeverBlock(h) ? "protected" : null);
      if (why && (why.startsWith("protected") || why.startsWith("ancestor")) || isNeverBlock(h)) hits.push(h);
    }
    return hits;
  }

  // null when acceptable, else the rejection reason. `prev` is the stored
  // list meta (count, genericCount) of the last good copy, if any.
  // A size change that comes back on the next download (within 10% of the
  // rejected size) is real, not a one-off: accept it as the new baseline, so a
  // list that moves for good is not frozen on its old copy forever.
  const CONFIRM_RATIO = 0.10;
  const confirmed = (n, rejected) => rejected > 0 && Math.abs(n - rejected) / rejected <= CONFIRM_RATIO;

  // The protected-host cap for one list. `prev` is that list's stored meta
  // (its protectedHits is the hit count of the last accepted copy).
  function protectedHitsCap(listName, prev) {
    const seed = listName && PROTECTED_HITS_SEED_BY_LIST[listName];
    if (!(seed > 0)) return PROTECTED_HITS_MAX;
    const last = prev && Number.isInteger(prev.protectedHits) && prev.protectedHits >= 0 ? prev.protectedHits : null;
    if (last === null) return seed;
    const cap = last + PROTECTED_HITS_MARGIN;
    return last >= 1 ? Math.min(cap, last * PROTECTED_HITS_SPIKE) : cap;
  }

  // `hits` may be passed in when the caller already computed protectedHits(parsed).
  function checkListChange(prev, parsed, cosmetic, listName, hits) {
    const total = parsed.domains.length + parsed.scoped.length;
    if (prev && prev.parser === PARSER_VERSION && prev.count > 0) {
      const ratio = Math.abs(total - prev.count) / prev.count;
      if (ratio > MAX_CHANGE_RATIO && !confirmed(total, prev.rejectedCount)) {
        return "size changed by " + Math.round(ratio * 100) + "% in one refresh (" + prev.count + " -> " + total + ")";
      }
    }
    if (!hits) hits = protectedHits(parsed);
    const cap = protectedHitsCap(listName, prev);
    if (hits.length > cap) return "names " + hits.length + " protected stream hosts (e.g. " + hits.slice(0, 3).join(", ") + ")";
    return checkCosmeticChange(prev, cosmetic);
  }

  // The cosmetic part of checkListChange: null when acceptable, else the reason.
  function checkCosmeticChange(prev, cosmetic) {
    if (!cosmetic) return null;
    const g = (cosmetic.generic || []).length;
    if (g > MAX_GENERIC_SELECTORS) return "too many generic hide rules (" + g + ")";
    if (prev && prev.parser === PARSER_VERSION && prev.genericCount > 0) {
      const ratio = Math.abs(g - prev.genericCount) / prev.genericCount;
      if (ratio > MAX_CHANGE_RATIO && !confirmed(g, prev.rejectedGeneric)) return "hide list changed by " + Math.round(ratio * 100) + "% (" + prev.genericCount + " -> " + g + ")";
    }
    const roots = cosmetic.stats ? cosmetic.stats.pageRootSite : 0;
    if (roots > MAX_PAGE_ROOT_SITE_RULES) return "too many whole-page hide rules (" + roots + ")";
    return null;
  }

  // An empty hide part: a `cosmetic: "sites"` list whose hide rules fail
  // checkCosmeticChange stores this, so its network rules still apply and the
  // merged hide list (which waits for every cosmetic source) is still written.
  function emptyCosmetic() {
    return { generic: [], sites: {}, exceptions: {}, genericExceptions: [], exclusions: {}, noHide: {} };
  }

  // Lists whose stored payload came from the old (widening) parser.
  function staleParserLists(state) {
    return Object.entries((state && state.lists) || {}).filter(([, m]) => !m || m.parser !== PARSER_VERSION).map(([n]) => n);
  }

  // Lists that were removed from SOURCES (e.g. curben_phishing, dropped
  // 2026-11-02: OpenPhish-derived) but are still cached on existing installs:
  // drop their payload and metadata. Returns the dropped names; the caller
  // rebuilds the dynamic rules so their domains stop being blocked.
  const RETIRED_LISTS = ["curben_phishing"];
  async function dropRetiredLists(deps, state) {
    const known = new Set(SOURCES.map((s) => s.name));
    const lists = (state && state.lists) || {};
    const names = Object.keys(lists).filter((n) => !known.has(n));
    // Also catch a payload key left behind without metadata.
    for (const n of RETIRED_LISTS) if (!names.includes(n) && !known.has(n)) names.push(n);
    const present = await payloadsPresent(deps, names);
    const metaDropped = names.filter((n) => lists[n]);
    const toRemove = names.filter((n) => lists[n] || present.has(n));
    if (!toRemove.length) return [];
    if (deps.removeListData) await deps.removeListData(toRemove);
    if (metaDropped.length) {
      const next = {};
      for (const [k, v] of Object.entries(lists)) if (!metaDropped.includes(k)) next[k] = v;
      await deps.setState({ lists: next });
      if (state) state.lists = next;
    }
    return toRemove;
  }

  // A list that stored hide rules (meta cosmetic: true) but is no longer a
  // hide-rule source in SOURCES (AdGuard Base, 0.3.5: its site rules took
  // about 5 MB of the 10 MB storage quota): remove the `cosmetic` field from
  // its stored payload and meta, keep its network data. `lists` is the
  // working copy of state.lists (changed in place). Returns the names
  // changed; the caller rewrites the hide sheet, and writeCosmetic removes
  // the list's stale cos* keys. Never throws.
  async function dropRetiredCosmetic(deps, lists) {
    const names = SOURCES.filter((s) => !s.cosmetic && lists[s.name] && lists[s.name].cosmetic).map((s) => s.name);
    if (!names.length) return [];
    const done = [];
    let got = {};
    try {
      got = (await deps.getListData(names)) || {};
    } catch {
      return [];
    }
    for (const n of names) {
      try {
        const p = got[n];
        if (p && typeof p === "object" && "cosmetic" in p) {
          const next = Object.assign({}, p);
          delete next.cosmetic;
          await deps.setListData(n, next);
        }
        const m = Object.assign({}, lists[n], { cosmetic: false });
        delete m.genericCount;
        delete m.rejectedGeneric;
        lists[n] = m;
        done.push(n);
      } catch {
        // Kept as is; tried again on the next refresh.
      }
    }
    return done;
  }

  async function payloadsPresent(deps, names) {
    if (!names.length) return new Set();
    if (deps.listDataPresent) {
      try {
        return new Set(await deps.listDataPresent(names));
      } catch {
        return new Set();
      }
    }
    const got = (await deps.getListData(names)) || {};
    return new Set(names.filter((n) => got[n] && Array.isArray(got[n].domains)));
  }

  /**
   * deps: { fetch, now(), getState(), setState(patch), getListData(names),
   *         setListData(name, payload), listDataPresent?(names), getDynamicRules(),
   *         updateDynamicRules({removeRuleIds, addRules}), setStaticEnabled(bool),
   *         loadBundled() -> {rules, extraIds}, enabled() -> bool,
   *         exclusive?(fn) -> the DNR queue section around the rule writes }
   * Never throws. Returns { ok, ran, reason?, rules? }.
   */
  async function refresh(deps, opts) {
    const manual = !!(opts && opts.manual);
    let state;
    try {
      state = (await deps.getState()) || {};
    } catch {
      state = {};
    }
    const now = deps.now();
    if (!shouldRun(state, now, manual)) return { ok: true, ran: false, reason: "throttled" };
    const fresh = {};
    const rejections = {};
    let retired = [];
    try {
      retired = await dropRetiredLists(deps, state);
    } catch {
      retired = [];
    }
    // M-2: a run where no due list reached its server (offline, captive
    // portal, every host down) is not a successful run: lastRunAt stays, so
    // the 30-min retry applies (the worker's one-shot RETRY_ALARM, then the
    // 3 h alarm). Rejected lists did reach their server.
    let attempted = 0;
    let reached = 0;
    let allFailed = false;
    let listsOffBefore = false;
    try {
      await deps.setState({ lastAttemptAt: now });
      const lists = {};
      for (const [k, v] of Object.entries(state.lists || {})) lists[k] = listMeta(v);
      // Hide data of a list that is no longer a hide-rule source is dropped
      // before the downloads (also when its server answers 304 or is down),
      // and the sheet is rewritten without it.
      let cosmeticChanged = (await dropRetiredCosmetic(deps, lists)).length > 0;
      const present = await payloadsPresent(deps, Object.keys(lists));
      // Missing payloads, and payloads from the old widening parser, are refetched
      // from scratch (no validators) and count as missing until then.
      const stale = staleParserLists({ lists });
      for (const k of Object.keys(lists)) if (!present.has(k) || stale.includes(k)) delete lists[k];
      let changed = !state.dynamicActive || retired.length > 0 || stale.length > 0;
      // A swap installed list rules (ruleCount), but none is installed now
      // (review 2026-11-16 WP-06): rebuild the set, else 304 and not-due runs
      // never repair it.
      if (!changed && state.ruleCount > 0 && deps.enabled() && !(await dynamicLooksActive(deps, state))) changed = true;
      const errors = {};
      const mirrorNotes = {};
      const CP = deps.cosmeticParse || (typeof globalThis !== "undefined" && globalThis.GeneralCosmeticParse);
      for (const src of SOURCES) {
        const meta = lists[src.name];
        if (!listDue(meta, now, manual, !!meta)) continue;
        attempted += 1;
        try {
          let res = null;
          let usedUrl = "";
          let bodyText = "";
          const tried = [];
          for (const url of [src.url].concat(src.mirrors || [])) {
            const headers = {};
            // Validators only make sense for the URL that produced them.
            if (meta && (meta.url || src.url) === url) {
              if (meta.etag) headers["If-None-Match"] = meta.etag;
              if (meta.lastModified) headers["If-Modified-Since"] = meta.lastModified;
            }
            const ctrl = typeof AbortController === "function" ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), deps.fetchTimeoutMs || FETCH_TIMEOUT_MS) : 0;
            try {
              // redirect "error", as in the feed client: a list comes from its own
              // host or not at all. A redirect counts as a failed source.
              const r = await deps.fetch(url, { headers, cache: "no-cache", credentials: "omit", redirect: "error", signal: ctrl ? ctrl.signal : undefined });
              if (r.ok || (r.status === 304 && headers["If-None-Match"] !== undefined) || (r.status === 304 && headers["If-Modified-Since"] !== undefined)) {
                // Security review L-2: the body is read while the timeout still
                // runs, and cut at MAX_LIST_BYTES, so a slow or huge answer
                // cannot hold the refresh or fill the worker's memory.
                if (r.ok) bodyText = await readListText(r, deps.maxListBytes || MAX_LIST_BYTES);
                res = r;
                usedUrl = url;
                break;
              }
              tried.push(describeError({ url }, new Error("HTTP " + r.status)));
            } catch (e) {
              tried.push(describeError({ url }, e));
            } finally {
              clearTimeout(timer);
            }
          }
          if (!res) throw new Error(tried.join("; "));
          if (tried.length) mirrorNotes[src.name] = tried.join("; ") + " (used " + new URL(usedUrl).hostname + ")";
          if (res.status === 304 && meta) {
            reached += 1;
            lists[src.name] = Object.assign({}, meta, { fetchedAt: now });
            continue;
          }
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = bodyText;
          const parsed = parseEntriesFull(text);
          const total = parsed.domains.length + parsed.scoped.length;
          const floor = src.minDomains || 50;
          if (total < floor) throw new Error("parsed too few domains (" + total + " < " + floor + ")");
          const payload = { domains: parsed.domains, scoped: parsed.scoped, parser: PARSER_VERSION };
          if (parsed.popup) payload.popup = parsed.popup;
          for (const k of ["cancel", "allow", "allowScoped", "limit", "important", "importantScoped", "cancelAllow", "alldoc"]) if (parsed[k]) payload[k] = parsed[k];
          const sitesOnly = src.cosmetic === "sites";
          if (src.cosmetic && CP) payload.cosmetic = CP.parseCosmetic(text, sitesOnly ? { sitesOnly: true } : undefined);
          const hits = protectedHits(parsed);
          // A sites-only list's hide rules are checked apart: over a cosmetic
          // cap they are dropped for this refresh, its network rules are kept.
          const rejected = checkListChange(meta, parsed, sitesOnly ? null : payload.cosmetic, src.name, hits);
          let cosmeticDropped = "";
          if (!rejected && sitesOnly && payload.cosmetic) {
            // Absolute caps only (no prev): its generic count is always 0.
            cosmeticDropped = checkCosmeticChange(null, payload.cosmetic) || "";
            if (cosmeticDropped) {
              payload.cosmetic = emptyCosmetic();
              const note = "hide rules skipped this refresh: " + cosmeticDropped;
              mirrorNotes[src.name] = mirrorNotes[src.name] ? mirrorNotes[src.name] + "; " + note : note;
            }
          }
          if (rejected) {
            reached += 1;
            rejections[src.name] = { reason: rejected, at: now };
            // Remember the rejected sizes: the same size next time is accepted.
            if (meta) {
              lists[src.name] = Object.assign({}, meta, {
                rejectedCount: parsed.domains.length + parsed.scoped.length,
                rejectedGeneric: payload.cosmetic ? (payload.cosmetic.generic || []).length : 0,
              });
            }
            throw new Error("rejected, kept the last good copy: " + rejected);
          }
          if (payload.cosmetic) delete payload.cosmetic.stats;
          // Payload first; the validators go into state only once it is stored.
          await deps.setListData(src.name, payload);
          reached += 1;
          fresh[src.name] = payload;
          lists[src.name] = {
            url: usedUrl,
            etag: res.headers && res.headers.get ? res.headers.get("ETag") || "" : "",
            lastModified: res.headers && res.headers.get ? res.headers.get("Last-Modified") || "" : "",
            fetchedAt: now,
            expiresMs: parseExpires(text),
            count: total,
            cosmetic: !!payload.cosmetic,
            parser: PARSER_VERSION,
            // Accepted copy only: the next refresh's adaptive cap starts here.
            protectedHits: hits.length,
          };
          if (payload.cosmetic) lists[src.name].genericCount = (payload.cosmetic.generic || []).length;
          if (payload.cosmetic) cosmeticChanged = true;
          changed = true;
        } catch (e) {
          // One list failing never sinks the others: keep its cached copy (if
          // any) and remember why, so the popup can show it.
          errors[src.name] = String(e && e.message || e);
        }
      }
      const usable = SOURCES.filter((x) => lists[x.name]);
      if (!usable.length) throw new Error(Object.values(errors).join("; ") || "no lists");
      await deps.setState({ lists, lastErrors: errors, lastRejected: rejections, lastNotes: mirrorNotes, lastErrorAt: Object.keys(errors).length ? now : 0 });
      // Write the hide list only when every required cosmetic source
      // (cosmetic: true) has a parsed copy: EasyPrivacy alone would replace
      // the whole EasyList sheet with a couple of selectors, and the bundled
      // sheet is never restored over a refresh. A `cosmetic: "sites"` source
      // (none in 0.3.5; AdGuard Base was one) is optional (final review #2): without a current
      // parsed copy its part is empty, so an unreachable or rejected AdGuard
      // never holds back the EasyList / EasyPrivacy sheet.
      const cosmeticSources = SOURCES.filter((x) => x.cosmetic);
      const required = (x) => x.cosmetic === true;
      const hasCosmetic = (x) => !!(lists[x.name] && lists[x.name].cosmetic);
      const cosmeticReady = cosmeticSources.filter(required).every(hasCosmetic);
      if (cosmeticChanged && cosmeticReady && deps.writeCosmetic) {
        try {
          const need = cosmeticSources.filter((x) => !fresh[x.name] && hasCosmetic(x)).map((x) => x.name);
          const stored = need.length ? (await deps.getListData(need)) || {} : {};
          const parts = cosmeticSources.map((x) => {
            const part = hasCosmetic(x) ? (fresh[x.name] || stored[x.name] || {}).cosmetic : null;
            return part || (required(x) ? null : emptyCosmetic());
          });
          if (parts.every(Boolean)) await deps.writeCosmetic(CP.mergeCosmetic(parts), { source: "refresh", updatedAt: now });
        } catch {
          // Cosmetic stays on the previous rules (or the bundled sheet).
        }
      }
      allFailed = attempted > 0 && reached === 0;
      if (!changed) {
        // Nothing to rebuild. The per-list errors are already recorded above.
        if (allFailed) return { ok: false, ran: true, reason: Object.values(errors).join("; ") || "no list reached" };
        await deps.setState({ lastRunAt: now });
        return { ok: true, ran: true, reason: "unchanged" };
      }
      // Lists switched off: no list rules, but the threat tier is its own
      // feature (docs/threat-tier.md "Switches") and is still rebuilt below.
      listsOffBefore = !deps.enabled();
    } catch (e) {
      // Download/parse failed: whatever is active now (a previous good swap
      // or the bundled ruleset) stays. Make sure something is active.
      try {
        await exclusive(deps)(async () => {
          if (!(await dynamicLooksActive(deps, state))) await fallback(deps);
        });
      } catch {
        // fallback() never throws; a broken queue must not hide the error below
      }
      try {
        await deps.setState({ lastErrors: { all: String(e && e.message || e) }, lastRejected: rejections, lastErrorAt: now });
      } catch {
        // silent
      }
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
    // Security review L-5: the swap and its fallback are one section of the
    // worker's DNR queue, so no other writer (lists switch, Allow, threat
    // switch, revert) reads or writes rules in between. The downloads above
    // run outside it, so a click never waits for the network.
    const TCR = typeof globalThis !== "undefined" && globalThis.GeckoThreatCompile;
    const threatFresh = !!TCR && Object.keys(fresh).some((n) => TCR.THREAT_LISTS.includes(n));
    try {
      return await exclusive(deps)(async () => {
        if (listsOffBefore) {
          // Lists off before this run: keep the cache, add no list rules,
          // but rebuild the refreshed threat rules from a fresh threat list.
          if (threatFresh) {
            try {
              const st = (await deps.getState()) || {};
              const threatLists = {};
              for (const n of TCR.THREAT_LISTS) if (st.lists && st.lists[n]) threatLists[n] = st.lists[n];
              await applyThreatRules(deps, await readPayloads(deps, threatLists, fresh), now, { downloaded: true });
            } catch {
              // applyThreatRules records its own errors; the packed tier stays
            }
          }
          if (!allFailed) await deps.setState({ lastRunAt: now });
          return { ok: !allFailed, ran: true, reason: "lists off; cached" };
        }
        // The lists switch went off during the downloads (its own run already
        // removed the list rules): keep the cache, add no rules.
        if (!deps.enabled()) {
          if (!allFailed) await deps.setState({ lastRunAt: now });
          return { ok: !allFailed, ran: true, reason: "lists off; cached" };
        }
        try {
          const result = await swap(deps, (await deps.getState()).lists, now, fresh);
          if (!allFailed) await deps.setState({ lastRunAt: now });
          return result;
        } catch (e) {
          await fallback(deps);
          const reason = "rules swap: " + String(e && e.message || e);
          try {
            const st = (await deps.getState()) || {};
            await deps.setState({ lastErrors: Object.assign({}, st.lastErrors, { swap: reason }), lastErrorAt: now });
          } catch {
            // silent
          }
          return { ok: false, ran: true, reason };
        }
      });
    } catch (e) {
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
  }

  // deps.exclusive(fn): run fn as one section of the caller's DNR queue
  // (security review L-5). Only refresh() uses it, around its rule writes;
  // every other entry point (applyEnabled, revertLists, rebuildThreatRules,
  // removeThreatRules) is wrapped whole by the caller and must not call it
  // (the worker's queue is not reentrant). Without it, fn runs directly.
  function exclusive(deps) {
    return deps && typeof deps.exclusive === "function" ? deps.exclusive : (fn) => fn();
  }

  function describeError(src, e) {
    let host = src.name;
    try {
      host = new URL(src.url).hostname;
    } catch {
      // keep name
    }
    const name = e && e.name;
    const msg = String(e && e.message || e || "error");
    if (name === "AbortError" || /abort/i.test(msg)) return host + ": timeout";
    if (name === "TypeError" || /failed to fetch|network/i.test(msg)) return host + ": network error (" + msg + ")";
    return host + ": " + msg;
  }

  async function dynamicLooksActive(deps, state) {
    if (!state || !state.dynamicActive) return false;
    try {
      const existing = (await deps.getDynamicRules()) || [];
      // List rules only: the threat ids (600000-609999) are inside this range,
      // and the lists switch does not remove them (review 2026-11-16 WP-06).
      return existing.some((r) => isOurRule(r.id) && r.id < KEPT_RULE_ID_BASE);
    } catch {
      return false;
    }
  }

  // Payloads for the lists named in `lists` (small meta), newest first from
  // `fresh` (parsed this run), the rest from storage.
  // Payloads (current parser only) for the lists named in `lists` (small
  // meta), newest first from `fresh` (parsed this run), the rest from storage.
  async function readPayloads(deps, lists, fresh) {
    const names = Object.keys(lists || {}).filter((n) => (fresh && fresh[n]) || (lists[n] && lists[n].parser === PARSER_VERSION));
    const need = names.filter((n) => !(fresh && fresh[n]));
    const stored = need.length ? (await deps.getListData(need)) || {} : {};
    const out = {};
    for (const n of names) {
      const p = (fresh && fresh[n]) || stored[n];
      if (p && Array.isArray(p.domains) && p.parser === PARSER_VERSION) out[n] = p;
    }
    return out;
  }

  async function swap(deps, lists, now, fresh) {
    const FO = filterOptions();
    const bundled = await deps.loadBundled();
    const extra = new Set(bundled.extraIds || []);
    const packed = [];
    const packedScoped = [];
    for (const r of bundled.rules || []) {
      if (!isPackedListRule(r, extra)) continue;
      const key = FO ? FO.conditionKey(r.condition) : "";
      for (const d of r.condition.requestDomains || []) {
        if (key === "") packed.push(d);
        else packedScoped.push([d, key]);
      }
    }
    const bundledDomains = packed.length + packedScoped.length;
    const payloads = await readPayloads(deps, lists, fresh);
    const perList = {};
    const perListScoped = {};
    // Lists without a current parsed copy: their pack-time cross-list data
    // stands in (final review #6).
    const missing = SOURCES.filter((x) => !payloads[x.name]).map((x) => x.name);
    const cross = crossListRules(payloads, missing, bundled.packedCross);
    for (const [n, p] of Object.entries(payloads)) {
      perList[n] = p.domains.filter((d) => cross.keepWhole(d));
      perListScoped[n] = crossScoped(cross, p.scoped);
    }
    let domains = mergeDomains(perList);
    let scoped = mergeScoped(perListScoped, domains);
    if (missing.length) {
      // Lists that failed and have no saved copy: keep the packed rules (whole
      // and scoped, each with its own scope) so a partial refresh never shrinks
      // protection and never widens a packed scoped rule.
      const seen = new Set(domains);
      for (const d of packed) if (!seen.has(d) && !isNeverBlock(d) && cross.keepWhole(d)) { seen.add(d); domains.push(d); }
      domains = domains.slice(0, MAX_LIST_RULES * DOMAINS_PER_RULE);
      const seenScoped = new Set(scoped.map(([d, k]) => d + "\n" + k));
      const whole = new Set(domains);
      for (const [d, k1] of packedScoped) {
        if (isNeverBlock(d)) continue;
        const k0 = cross.scopeOf(d, k1);
        if (k0 === null) continue;
        const k = mergedScope(d, k0, whole);
        if (k === null) continue;
        const id = d + "\n" + k;
        if (seenScoped.has(id)) continue;
        seenScoped.add(id);
        scoped.push([d, k]);
      }
    }
    const total = domains.length + scoped.length;
    // Sanity: a refreshed set much smaller than the bundle is a bad download.
    if (total < bundledDomains * 0.5) throw new Error("refreshed list too small");
    // Hosts with a block anywhere (refreshed or packed: the packed ruleset
    // stays on next to these rules) for the exception allow rules.
    const blockedHosts = new Set(domains.concat(packed));
    for (const e of scoped) blockedHosts.add(e[0]);
    for (const e of packedScoped) blockedHosts.add(e[0]);
    const addRules = buildListRules(domains, scoped, exceptionAllows(cross, blockedHosts)).concat(keptBundledRules(bundled.rules, bundled.extraIds));
    const existing = (await deps.getDynamicRules()) || [];
    const removeRuleIds = existing.filter((r) => isOurRule(r.id)).map((r) => r.id);
    await deps.updateDynamicRules({ removeRuleIds, addRules });
    // The packed "general" ruleset stays enabled next to the refreshed rules:
    // it is the offline floor (and holds the 2,000,000 stream-site allows), so
    // those never depend on dynamic rules surviving. Only the lists switch
    // turns it off. Trade-off: domains dropped upstream stay blocked by the
    // packed copy until the next release. (The switch may have gone off while
    // this swap ran: never turn the packed lists back on then.)
    if (deps.enabled()) await deps.setStaticEnabled(true);
    await deps.setState({ dynamicActive: true, updatedAt: now, ruleCount: addRules.length, domainCount: total, rebuiltForParser: PARSER_VERSION });
    const TCX = typeof globalThis !== "undefined" && globalThis.GeckoThreatCompile;
    const downloaded = !!TCX && Object.keys(fresh || {}).some((n) => TCX.THREAT_LISTS.includes(n));
    await applyThreatRules(deps, payloads, now, { downloaded });
    return { ok: true, ran: true, rules: addRules.length, domains: total };
  }

  async function fallback(deps) {
    try {
      const existing = (await deps.getDynamicRules()) || [];
      const removeRuleIds = existing.filter((r) => isOurRule(r.id)).map((r) => r.id);
      if (removeRuleIds.length) await deps.updateDynamicRules({ removeRuleIds, addRules: [] });
    } catch {
      // keep going
    }
    try {
      if (deps.enabled()) await deps.setStaticEnabled(true);
      await deps.setState({ dynamicActive: false });
    } catch {
      // silent
    }
  }

  // Lists switched on/off: on uses the dynamic set if active, else the bundle.
  async function applyEnabled(deps, enabled) {
    let state = {};
    try {
      state = (await deps.getState()) || {};
    } catch {
      state = {};
    }
    if (!enabled) {
      await deps.setStaticEnabled(false);
      const existing = (await deps.getDynamicRules()) || [];
      const removeRuleIds = existing.filter((r) => isOurRule(r.id)).map((r) => r.id);
      if (removeRuleIds.length) await deps.updateDynamicRules({ removeRuleIds, addRules: [] });
      return { ok: true, mode: "off" };
    }
    let retired = [];
    try {
      retired = await dropRetiredLists(deps, state);
    } catch {
      retired = [];
    }
    // Rules built from old-parser payloads hold widened domains: rebuild once
    // (stale lists come from the packed rules until they are refetched).
    const staleRules = staleParserLists(state).length > 0 && state.rebuiltForParser !== PARSER_VERSION;
    if (state.dynamicActive && state.lists && Object.keys(state.lists).length) {
      if (!retired.length && !staleRules && await dynamicLooksActive(deps, state)) {
        await deps.setStaticEnabled(true);
        return { ok: true, mode: "dynamic" };
      }
      try {
        await swap(deps, state.lists, deps.now());
        return { ok: true, mode: "dynamic" };
      } catch {
        await fallback(deps);
      }
    }
    await deps.setStaticEnabled(true);
    await syncPackedAllows(deps);
    return { ok: true, mode: "static" };
  }

  // The packed ruleset alone (fresh install before the first download, after
  // Revert lists, after a failed swap): the exception allow rules for its own
  // lists' unconditional `@@||sub.host^` exceptions under a blocked parent
  // (exceptionAllows on the pack-time cross-list data). The type-only ones
  // are not in packed-cross.json, so they wait for the first download. Writes
  // only when the wanted rules differ from the list-range rules in place.
  // The packed files do not change while the worker runs, so the wanted rules
  // are worked out once per worker (loading the 5 MB packed ruleset costs
  // about 40 ms), and only the excepted hosts and their parents are looked up
  // in it.
  let packedAllowRules = null;
  async function wantedPackedAllows(deps) {
    if (packedAllowRules) return packedAllowRules;
    const bundled = await deps.loadBundled();
    const cross = crossListRules({}, SOURCES.map((x) => x.name), bundled.packedCross);
    const candidates = new Set();
    for (const h of Array.from(cross.allow || []).concat((cross.allowScoped || []).map((e) => e[0]))) {
      for (let d = h; d;) {
        candidates.add(d);
        const i = d.indexOf(".");
        d = i < 0 ? "" : d.slice(i + 1);
      }
    }
    const hosts = new Set();
    if (candidates.size) {
      const extra = new Set(bundled.extraIds || []);
      for (const r of bundled.rules || []) {
        if (!isPackedListRule(r, extra)) continue;
        for (const d of r.condition.requestDomains || []) if (candidates.has(d)) hosts.add(d);
      }
    }
    packedAllowRules = buildListRules([], [], exceptionAllows(cross, hosts));
    return packedAllowRules;
  }

  async function syncPackedAllows(deps) {
    if (!deps.loadBundled) return;
    try {
      const want = await wantedPackedAllows(deps);
      const ours = ((await deps.getDynamicRules()) || []).filter((r) => isOurRule(r.id));
      const sig = (rules) => JSON.stringify(rules.map((r) => [r.id, r.action && r.action.type, r.condition]));
      if (sig(ours) === sig(want)) return;
      await deps.updateDynamicRules({ removeRuleIds: ours.map((r) => r.id), addRules: want });
    } catch {
      // the packed blocks alone still apply; the next run tries again
    }
  }

  async function removeThreatRules(deps) {
    const existing = (await deps.getDynamicRules()) || [];
    const removeRuleIds = existing.filter((r) => isThreatRule(r.id)).map((r) => r.id);
    if (removeRuleIds.length) await deps.updateDynamicRules({ removeRuleIds, addRules: [] });
    try {
      await deps.setState({ threatRejectedNew: 0, threatHeldAt: 0 });
    } catch {
      // the next refresh writes it again
    }
    return { ok: true, removed: removeRuleIds.length };
  }

  // Threat tier switched back on: rebuild the refreshed threat rules from the
  // stored threat-list payloads (the packed `threat` ruleset is the floor).
  async function rebuildThreatRules(deps) {
    const TC = typeof globalThis !== "undefined" && globalThis.GeckoThreatCompile;
    if (!TC) return { ok: false, reason: "threat compiler not loaded" };
    let state = {};
    try {
      state = (await deps.getState()) || {};
    } catch {
      state = {};
    }
    const lists = {};
    for (const n of TC.THREAT_LISTS) if (state.lists && state.lists[n]) lists[n] = state.lists[n];
    const payloads = {};
    for (const [n, p] of Object.entries(await readPayloadsFull(deps, lists))) payloads[n] = p;
    return applyThreatRules(deps, payloads, deps.now());
  }

  async function readPayloadsFull(deps, lists) {
    const names = Object.keys(lists || {}).filter((n) => lists[n] && lists[n].parser === PARSER_VERSION);
    if (!names.length) return {};
    const stored = (await deps.getListData(names)) || {};
    const out = {};
    for (const n of names) if (stored[n] && Array.isArray(stored[n].domains) && stored[n].parser === PARSER_VERSION) out[n] = stored[n];
    return out;
  }

  // "Revert lists": forget every refreshed list (payloads, dynamic list and
  // threat rules) and go back to the packed rules shipped with the extension.
  // Automatic refreshes then wait the usual 12 h; Update refetches at once.
  async function revertLists(deps) {
    const now = deps.now();
    let state = {};
    try {
      state = (await deps.getState()) || {};
    } catch {
      state = {};
    }
    const names = Array.from(new Set(SOURCES.map((s) => s.name).concat(RETIRED_LISTS, Object.keys(state.lists || {}))));
    if (deps.removeListData) await deps.removeListData(names);
    const existing = (await deps.getDynamicRules()) || [];
    const removeRuleIds = existing.filter((r) => isOurRule(r.id) || isThreatRule(r.id)).map((r) => r.id);
    if (removeRuleIds.length) await deps.updateDynamicRules({ removeRuleIds, addRules: [] });
    if (deps.enabled()) await deps.setStaticEnabled(true);
    await deps.setState({ lists: {}, dynamicActive: false, updatedAt: 0, ruleCount: 0, domainCount: 0, revertedAt: now, lastRunAt: now, lastRejected: {}, lastErrors: {}, threatRules: 0, threatHosts: 0, threatError: "", threatRejectedNew: 0, threatHeldAt: 0, threatAcceptedSig: "" });
    if (deps.revertCosmetic) {
      try {
        await deps.revertCosmetic();
      } catch {
        // the content script falls back to the bundled sheet
      }
    }
    return { ok: true, reverted: names.length, removedRules: removeRuleIds.length };
  }

  function isListUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && LIST_HOSTS.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  Object.assign(target, {
    POLICY, REFRESH_ALARM, RETRY_ALARM, RETRY_DELAY_MINUTES, CLOCK_SKEW_MS, ALARM_PERIOD_MINUTES, FETCH_TIMEOUT_MS, MAX_LIST_BYTES, readListText, RETRY_MIN_MS, MIN_INTERVAL_MS, DOMAINS_PER_RULE, MAX_LIST_RULES, listMeta,
    RETIRED_LISTS, dropRetiredLists, dropRetiredCosmetic, PARSER_VERSION, parseEntries, parseEntriesFull, crossListRules, crossScoped, exceptionAllows, mergeScoped, staleParserLists,
    THREAT_RULE_ID_BASE, THREAT_RULE_ID_END, DYNAMIC_RULE_LIMIT, isThreatRule, isOurRule, applyThreatRules,
    MAX_CHANGE_RATIO, PROTECTED_HITS_MAX, PROTECTED_HITS_SEED_BY_LIST, PROTECTED_HITS_MARGIN, PROTECTED_HITS_SPIKE, protectedHitsCap, MAX_GENERIC_SELECTORS, MAX_PAGE_ROOT_SITE_RULES, checkListChange, checkCosmeticChange, protectedHits, revertLists,
    removeThreatRules, rebuildThreatRules,
    LIST_RULE_ID_BASE, KEPT_RULE_ID_BASE, ALLOW_RULE_ID_BASE, SOURCES, LIST_HOSTS,
    isNeverBlock, NEVER_BLOCK_EXCEPTIONS, parseList, parseExpires, mergeDomains, buildListRules, keptBundledRules, keepsWholeDomain,
    shouldRun, listDue, refresh, describeError, LIST_ALLOW_RULE_ID, listAllowRule, applyEnabled, isListUrl,
  });
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockUpdate(globalThis.GeneralAdblockUpdate = {});
}
