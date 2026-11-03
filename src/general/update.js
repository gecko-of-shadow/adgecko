// Filter-list refresh engine.
// Policy "alarm-and-manual": the worker's "gecko-refresh" alarm (every 3 h) asks
// for a refresh; it runs at most once per 12 h after a successful run (and at
// most every 30 min after a failed attempt), each list is only re-downloaded
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
    "live-video.net", "youtube-nocookie.com", "youtubekids.com",
  ];

  const DOMAIN_RE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$/i;
  const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*[a-z0-9])\s*$/i;
  const BARE_RE = /^([a-z0-9][a-z0-9.-]*[a-z0-9])$/i;
  // Payloads parsed before faithful option conversion (H-2) hold widened
  // domains; they are refetched and, until then, replaced by the packed rules.
  const PARSER_VERSION = 2;

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

  function isNeverBlock(domain) {
    const d = String(domain || "").toLowerCase().replace(/\.$/, "");
    return NEVER_BLOCK_SUFFIXES.some((s) => d === s || d.endsWith("." + s));
  }

  function looksLikeDomain(d) {
    if (!d.includes(".") || d.startsWith(".") || d.endsWith(".")) return false;
    if (/[\/*?|()[\]{}]/.test(d)) return false;
    return d.split(".").every(Boolean);
  }

  // Same rules as scripts/pack-filter-lists.py extract_entries().
  // Returns { domains: [whole-domain blocks], scoped: [[domain, key], ...] }
  // where key is a general/filter-options.js scope key. $badfilter cancels the
  // filter with the same domain and scope.
  function parseEntries(text) {
    const FO = filterOptions();
    const whole = [];
    const scoped = [];
    const cancelled = new Set();
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("!") || line.startsWith("[") || line.startsWith("@@")) continue;
      if (line.includes("##") || line.includes("#@#") || line.includes("#$")) continue;
      let m = DOMAIN_RE.exec(line);
      if (m) {
        // Without the shared table, only option-less filters are safe to keep.
        const conv = FO ? FO.convertLine(line) : (m[2] ? null : [m[1].toLowerCase(), "", false]);
        if (!conv) continue;
        const [d, key, cancel] = conv;
        if (!looksLikeDomain(d)) continue;
        if (cancel) cancelled.add(d + "\n" + key);
        else if (key === "") whole.push(d);
        else scoped.push([d, key]);
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
    if (!cancelled.size) return { domains: whole, scoped };
    return {
      domains: whole.filter((d) => !cancelled.has(d + "\n")),
      scoped: scoped.filter(([d, k]) => !cancelled.has(d + "\n" + k)),
    };
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

  // Scoped entries per list, in source order, deduped, never-block removed, and
  // dropped when the same domain is already a whole-domain block.
  function mergeScoped(perListScoped, wholeDomains) {
    const whole = new Set(wholeDomains);
    const seen = new Set();
    const out = [];
    for (const src of SOURCES) {
      let kept = 0;
      for (const [d, key] of perListScoped[src.name] || []) {
        const id = d + "\n" + key;
        if (whole.has(d) || isNeverBlock(d) || seen.has(id)) continue;
        seen.add(id);
        out.push([d, key]);
        kept += 1;
        if (src.maxDomains && kept >= src.maxDomains) break;
      }
    }
    return out;
  }

  // Whole-domain batches first, then one batch series per scope key.
  function buildListRules(domains, scoped) {
    const FO = filterOptions();
    const rules = [];
    const push = (chunk, extra) => {
      rules.push({
        id: LIST_RULE_ID_BASE + rules.length,
        priority: 1,
        action: { type: "block" },
        condition: Object.assign({ requestDomains: chunk }, extra),
      });
    };
    for (let i = 0; i < domains.length && rules.length < MAX_LIST_RULES; i += DOMAINS_PER_RULE) {
      push(domains.slice(i, i + DOMAINS_PER_RULE), {});
    }
    if (scoped && scoped.length && FO) {
      const groups = new Map();
      for (const [d, key] of scoped) {
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

  // Rebuild the dynamic threat rules from the threat lists' payloads. Errors
  // are recorded, never thrown: the static "threat" ruleset stays the floor.
  async function applyThreatRules(deps, payloads, now) {
    const TC = typeof globalThis !== "undefined" && globalThis.GeckoThreatCompile;
    if (!TC) return { ok: false, reason: "threat compiler not loaded" };
    try {
      const hosts = [];
      for (const name of TC.THREAT_LISTS) {
        const p = payloads[name];
        if (p) hosts.push(...TC.threatHostsFromEntries(p));
      }
      const existing = (await deps.getDynamicRules()) || [];
      const others = existing.filter((r) => !isThreatRule(r.id)).length;
      const budget = Math.max(0, Math.min(THREAT_RULE_ID_END - THREAT_RULE_ID_BASE, DYNAMIC_RULE_LIMIT - others - 100));
      const compiled = TC.compileThreatRules(hosts, { idBase: THREAT_RULE_ID_BASE, maxRules: budget });
      const removeRuleIds = existing.filter((r) => isThreatRule(r.id)).map((r) => r.id);
      await deps.updateDynamicRules({ removeRuleIds, addRules: compiled.rules });
      await deps.setState({ threatRules: compiled.rules.length, threatHosts: compiled.accepted.length, threatRejected: compiled.rejected.length, threatError: "", threatUpdatedAt: now });
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
  // the start of every run.
  function shouldRun(state, now, manual) {
    if (manual) return true;
    const last = state && state.lastRunAt || 0;
    if (now - last < MIN_INTERVAL_MS) return false;
    const attempt = state && state.lastAttemptAt || 0;
    return !(now - attempt < RETRY_MIN_MS);
  }

  // `present`: the list's payload is actually stored (validators are useless,
  // and a 304 would leave the list empty, when it is not).
  function listDue(meta, now, manual, present) {
    if (!meta || !meta.fetchedAt || !present) return true;
    if (manual) return true; // still conditional; a 304 costs nothing
    return now - meta.fetchedAt >= (meta.expiresMs || DEFAULT_EXPIRES_MS);
  }

  function listMeta(m) {
    const out = {};
    for (const k of ["url", "etag", "lastModified", "fetchedAt", "expiresMs", "count", "cosmetic", "parser", "genericCount"]) if (m && m[k] !== undefined) out[k] = m[k];
    return out;
  }

  // ---- self-protection for downloaded lists (Block E) ----
  // A list that changes too much in one refresh, names many protected stream
  // hosts, or carries an abnormal hide list is rejected as a whole: its last
  // known good copy (the payload already stored) stays in use and the reason
  // is recorded in state.lastRejected[name].
  const MAX_CHANGE_RATIO = 0.25;
  const PROTECTED_HITS_MAX = 25; // real lists name at most ~6 (2026-11-02)
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
  function checkListChange(prev, parsed, cosmetic) {
    const total = parsed.domains.length + parsed.scoped.length;
    if (prev && prev.parser === PARSER_VERSION && prev.count > 0) {
      const ratio = Math.abs(total - prev.count) / prev.count;
      if (ratio > MAX_CHANGE_RATIO) {
        return "size changed by " + Math.round(ratio * 100) + "% in one refresh (" + prev.count + " -> " + total + ")";
      }
    }
    const hits = protectedHits(parsed);
    if (hits.length > PROTECTED_HITS_MAX) return "names " + hits.length + " protected stream hosts (e.g. " + hits.slice(0, 3).join(", ") + ")";
    if (cosmetic) {
      const g = (cosmetic.generic || []).length;
      if (g > MAX_GENERIC_SELECTORS) return "too many generic hide rules (" + g + ")";
      if (prev && prev.parser === PARSER_VERSION && prev.genericCount > 0) {
        const ratio = Math.abs(g - prev.genericCount) / prev.genericCount;
        if (ratio > MAX_CHANGE_RATIO) return "hide list changed by " + Math.round(ratio * 100) + "% (" + prev.genericCount + " -> " + g + ")";
      }
      const roots = cosmetic.stats ? cosmetic.stats.pageRootSite : 0;
      if (roots > MAX_PAGE_ROOT_SITE_RULES) return "too many whole-page hide rules (" + roots + ")";
    }
    return null;
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
   *         loadBundled() -> {rules, extraIds}, enabled() -> bool }
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
    try {
      await deps.setState({ lastAttemptAt: now });
      const lists = {};
      for (const [k, v] of Object.entries(state.lists || {})) lists[k] = listMeta(v);
      const present = await payloadsPresent(deps, Object.keys(lists));
      // Missing payloads, and payloads from the old widening parser, are refetched
      // from scratch (no validators) and count as missing until then.
      const stale = staleParserLists({ lists });
      for (const k of Object.keys(lists)) if (!present.has(k) || stale.includes(k)) delete lists[k];
      let changed = !state.dynamicActive || retired.length > 0 || stale.length > 0;
      let cosmeticChanged = false;
      const errors = {};
      const mirrorNotes = {};
      const CP = deps.cosmeticParse || (typeof globalThis !== "undefined" && globalThis.GeneralCosmeticParse);
      for (const src of SOURCES) {
        const meta = lists[src.name];
        if (!listDue(meta, now, manual, !!meta)) continue;
        try {
          let res = null;
          let usedUrl = "";
          const tried = [];
          for (const url of [src.url].concat(src.mirrors || [])) {
            const headers = {};
            // Validators only make sense for the URL that produced them.
            if (meta && (meta.url || src.url) === url) {
              if (meta.etag) headers["If-None-Match"] = meta.etag;
              if (meta.lastModified) headers["If-Modified-Since"] = meta.lastModified;
            }
            const ctrl = typeof AbortController === "function" ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : 0;
            try {
              const r = await deps.fetch(url, { headers, cache: "no-cache", credentials: "omit", signal: ctrl ? ctrl.signal : undefined });
              if (r.ok || (r.status === 304 && headers["If-None-Match"] !== undefined) || (r.status === 304 && headers["If-Modified-Since"] !== undefined)) {
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
            lists[src.name] = Object.assign({}, meta, { fetchedAt: now });
            continue;
          }
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          const parsed = parseEntries(text);
          const total = parsed.domains.length + parsed.scoped.length;
          const floor = src.minDomains || 50;
          if (total < floor) throw new Error("parsed too few domains (" + total + " < " + floor + ")");
          const payload = { domains: parsed.domains, scoped: parsed.scoped, parser: PARSER_VERSION };
          if (src.cosmetic && CP) payload.cosmetic = CP.parseCosmetic(text);
          const rejected = checkListChange(meta, parsed, payload.cosmetic);
          if (rejected) {
            rejections[src.name] = { reason: rejected, at: now };
            throw new Error("rejected, kept the last good copy: " + rejected);
          }
          if (payload.cosmetic) delete payload.cosmetic.stats;
          // Payload first; the validators go into state only once it is stored.
          await deps.setListData(src.name, payload);
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
      // Write the hide list only when every cosmetic source has a parsed copy:
      // EasyPrivacy alone would replace the whole EasyList sheet with a couple
      // of selectors, and the bundled sheet is never restored over a refresh.
      const cosmeticSources = SOURCES.filter((x) => x.cosmetic);
      const cosmeticReady = cosmeticSources.every((x) => lists[x.name] && lists[x.name].cosmetic);
      if (cosmeticChanged && cosmeticReady && deps.writeCosmetic) {
        try {
          const need = cosmeticSources.filter((x) => !fresh[x.name]).map((x) => x.name);
          const stored = need.length ? (await deps.getListData(need)) || {} : {};
          const parts = cosmeticSources.map((x) => (fresh[x.name] || stored[x.name] || {}).cosmetic);
          if (parts.every(Boolean)) await deps.writeCosmetic(CP.mergeCosmetic(parts), { source: "refresh", updatedAt: now });
        } catch {
          // Cosmetic stays on the previous rules (or the bundled sheet).
        }
      }
      if (!changed) {
        await deps.setState({ lastRunAt: now });
        return { ok: true, ran: true, reason: "unchanged" };
      }
      if (!deps.enabled()) {
        await deps.setState({ lastRunAt: now });
        return { ok: true, ran: true, reason: "lists off; cached" };
      }
    } catch (e) {
      // Download/parse failed: whatever is active now (a previous good swap
      // or the bundled ruleset) stays. Make sure something is active.
      if (!(await dynamicLooksActive(deps, state))) await fallback(deps);
      try {
        await deps.setState({ lastErrors: { all: String(e && e.message || e) }, lastRejected: rejections, lastErrorAt: now });
      } catch {
        // silent
      }
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
    try {
      const result = await swap(deps, (await deps.getState()).lists, now, fresh);
      await deps.setState({ lastRunAt: now });
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
      return existing.some((r) => r.id >= LIST_RULE_ID_BASE && r.id < KEPT_RULE_ID_BASE);
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
    for (const [n, p] of Object.entries(payloads)) {
      perList[n] = p.domains;
      perListScoped[n] = p.scoped || [];
    }
    const missing = SOURCES.filter((x) => !perList[x.name]).map((x) => x.name);
    let domains = mergeDomains(perList);
    let scoped = mergeScoped(perListScoped, domains);
    if (missing.length) {
      // Lists that failed and have no saved copy: keep the packed rules (whole
      // and scoped, each with its own scope) so a partial refresh never shrinks
      // protection and never widens a packed scoped rule.
      const seen = new Set(domains);
      for (const d of packed) if (!seen.has(d) && !isNeverBlock(d)) { seen.add(d); domains.push(d); }
      domains = domains.slice(0, MAX_LIST_RULES * DOMAINS_PER_RULE);
      const seenScoped = new Set(scoped.map(([d, k]) => d + "\n" + k));
      const whole = new Set(domains);
      for (const [d, k] of packedScoped) {
        const id = d + "\n" + k;
        if (whole.has(d) || seenScoped.has(id) || isNeverBlock(d)) continue;
        seenScoped.add(id);
        scoped.push([d, k]);
      }
    }
    const total = domains.length + scoped.length;
    // Sanity: a refreshed set much smaller than the bundle is a bad download.
    if (total < bundledDomains * 0.5) throw new Error("refreshed list too small");
    const addRules = buildListRules(domains, scoped).concat(keptBundledRules(bundled.rules, bundled.extraIds));
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
    await applyThreatRules(deps, payloads, now);
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
    return { ok: true, mode: "static" };
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
    await deps.setState({ lists: {}, dynamicActive: false, revertedAt: now, lastRunAt: now, lastRejected: {}, lastErrors: {}, threatRules: 0, threatHosts: 0, threatError: "" });
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
    POLICY, REFRESH_ALARM, ALARM_PERIOD_MINUTES, RETRY_MIN_MS, MIN_INTERVAL_MS, DOMAINS_PER_RULE, MAX_LIST_RULES, listMeta,
    RETIRED_LISTS, dropRetiredLists, PARSER_VERSION, parseEntries, mergeScoped, staleParserLists,
    THREAT_RULE_ID_BASE, THREAT_RULE_ID_END, DYNAMIC_RULE_LIMIT, isThreatRule, isOurRule, applyThreatRules,
    MAX_CHANGE_RATIO, PROTECTED_HITS_MAX, MAX_GENERIC_SELECTORS, MAX_PAGE_ROOT_SITE_RULES, checkListChange, protectedHits, revertLists,
    LIST_RULE_ID_BASE, KEPT_RULE_ID_BASE, ALLOW_RULE_ID_BASE, SOURCES, LIST_HOSTS,
    isNeverBlock, parseList, parseExpires, mergeDomains, buildListRules, keptBundledRules, keepsWholeDomain,
    shouldRun, listDue, refresh, describeError, LIST_ALLOW_RULE_ID, listAllowRule, applyEnabled, isListUrl,
  });
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockUpdate(globalThis.GeneralAdblockUpdate = {});
}
