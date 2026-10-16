// Filter-list refresh engine.
// Policy "startup-and-manual": one quiet refresh ~5s after the background worker
// starts (skipped if a refresh ran in the last 12h, and each list is only
// re-downloaded after its own "! Expires:" window), plus the popup's Update
// button. Conditional requests (ETag / If-Modified-Since). Lists are parsed to
// domain block rules and swapped into dynamic DNR rules; the bundled static
// ruleset is disabled only after a successful swap and is restored on any error.
function installGeneralAdblockUpdate(target) {
  const POLICY = "startup-and-manual";
  const STARTUP_DELAY_MS = 5000;
  const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const DEFAULT_EXPIRES_MS = 24 * 60 * 60 * 1000;
  const DOMAINS_PER_RULE = 80;
  const MAX_LIST_RULES = 25000; // dynamic limit is 30000; leave room for allows
  const LIST_RULE_ID_BASE = 100000;
  const KEPT_RULE_ID_BASE = 800000; // copies of bundled allow / extra rules
  const ALLOW_RULE_ID_BASE = 900000; // user "Allow this page" rules (untouched)
  const FETCH_TIMEOUT_MS = 90000;

  // Primary URL first, then mirrors of the same list (tried in order).
  const SOURCES = [
    { name: "peter_lowe", url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext", mirrors: [] },
    { name: "urlhaus_hosts", url: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt", mirrors: [], maxDomains: 8000 },
    { name: "easylist", url: "https://easylist.to/easylist/easylist.txt", cosmetic: true, mirrors: [
      "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt",
      "https://easylist-downloads.adblockplus.org/easylist.txt",
      "https://secure.fanboy.co.nz/easylist.txt",
    ] },
    { name: "easyprivacy", url: "https://easylist.to/easylist/easyprivacy.txt", cosmetic: true, mirrors: [
      "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt",
      "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
      "https://secure.fanboy.co.nz/easyprivacy.txt",
    ] },
  ];
  const LIST_HOSTS = ["pgl.yoyo.org", "malware-filter.gitlab.io", "easylist.to", "ublockorigin.github.io", "easylist-downloads.adblockplus.org", "secure.fanboy.co.nz"];
  // Dynamic allow rule so no block rule (ours or a stale one) can stop the
  // extension's own list downloads. Outside the list and user-allow id ranges.
  const LIST_ALLOW_RULE_ID = 990001;
  function listAllowRule(extensionId) {
    return {
      id: LIST_ALLOW_RULE_ID,
      priority: 3000000,
      action: { type: "allow" },
      condition: { requestDomains: LIST_HOSTS.slice(), initiatorDomains: [extensionId], resourceTypes: ["xmlhttprequest", "other"] },
    };
  }

  const NEVER_BLOCK_SUFFIXES = [
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net", "twitchcdn.com", "ext-twitch.tv",
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "ggpht.com",
    "youtubei.googleapis.com", "googleapis.com", "gstatic.com", "kick.com", "kick-streamer.com",
  ];

  const DOMAIN_RE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$/i;
  const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*[a-z0-9])\s*$/i;
  const BARE_RE = /^([a-z0-9][a-z0-9.-]*[a-z0-9])$/i;
  const SKIP_OPTS = ["domain=", "sitekey=", "csp=", "rewrite=", "header="];

  function isNeverBlock(domain) {
    const d = String(domain || "").toLowerCase().replace(/\.$/, "");
    return NEVER_BLOCK_SUFFIXES.some((s) => d === s || d.endsWith("." + s));
  }

  function looksLikeDomain(d) {
    if (!d.includes(".") || d.startsWith(".") || d.endsWith(".")) return false;
    if (/[\/*?|()[\]{}]/.test(d)) return false;
    return d.split(".").every(Boolean);
  }

  // Same rules as scripts/pack-filter-lists.py extract_domains().
  function parseList(text) {
    const out = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("!") || line.startsWith("[") || line.startsWith("@@")) continue;
      if (line.includes("##") || line.includes("#@#") || line.includes("#$")) continue;
      let m = DOMAIN_RE.exec(line);
      if (m) {
        const opts = (m[2] || "").toLowerCase();
        if (opts && SKIP_OPTS.some((k) => opts.includes(k))) continue;
        const d = m[1].toLowerCase();
        if (looksLikeDomain(d)) out.push(d);
        continue;
      }
      m = HOSTS_RE.exec(line);
      if (m) {
        const d = m[1].toLowerCase();
        if (d !== "localhost" && d !== "local" && looksLikeDomain(d)) out.push(d);
        continue;
      }
      if (BARE_RE.test(line) && looksLikeDomain(line)) out.push(line.toLowerCase());
    }
    return out;
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

  function buildListRules(domains) {
    const rules = [];
    for (let i = 0; i < domains.length && rules.length < MAX_LIST_RULES; i += DOMAINS_PER_RULE) {
      rules.push({
        id: LIST_RULE_ID_BASE + rules.length,
        priority: 1,
        action: { type: "block" },
        condition: { requestDomains: domains.slice(i, i + DOMAINS_PER_RULE) },
      });
    }
    return rules;
  }

  // Bundled non-list rules (stream-site allows, extra trackers) must survive
  // the static ruleset being disabled, so copy them into dynamic rules.
  function keptBundledRules(bundled, extraIds) {
    const extra = new Set(extraIds || []);
    let id = KEPT_RULE_ID_BASE;
    return (bundled || [])
      .filter((r) => r && r.action && (r.action.type !== "block" || extra.has(r.id)))
      .map((r) => Object.assign({}, r, { id: id++ }));
  }

  function isOurRule(id) {
    return id >= LIST_RULE_ID_BASE && id < ALLOW_RULE_ID_BASE;
  }

  // Throttle: startup runs at most once per 12h; manual clicks always run.
  function shouldRun(state, now, manual) {
    if (manual) return true;
    const last = state && state.lastRunAt || 0;
    return !(now - last < MIN_INTERVAL_MS);
  }

  function listDue(meta, now, manual) {
    if (!meta || !meta.fetchedAt || !Array.isArray(meta.domains)) return true;
    if (manual) return true; // still conditional; a 304 costs nothing
    return now - meta.fetchedAt >= (meta.expiresMs || DEFAULT_EXPIRES_MS);
  }

  /**
   * deps: { fetch, now(), getState(), setState(patch), getDynamicRules(),
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
    try {
      await deps.setState({ lastRunAt: now });
      const lists = Object.assign({}, state.lists || {});
      let changed = !state.dynamicActive;
      let cosmeticChanged = false;
      const errors = {};
      const mirrorNotes = {};
      const CP = deps.cosmeticParse || (typeof globalThis !== "undefined" && globalThis.GeneralCosmeticParse);
      for (const src of SOURCES) {
        const meta = lists[src.name];
        if (!listDue(meta, now, manual)) continue;
        try {
          let res = null;
          let usedUrl = "";
          const tried = [];
          for (const url of [src.url].concat(src.mirrors || [])) {
            const headers = {};
            // Validators only make sense for the URL that produced them.
            if (meta && Array.isArray(meta.domains) && (meta.url || src.url) === url) {
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
          if (res.status === 304 && meta && Array.isArray(meta.domains)) {
            lists[src.name] = Object.assign({}, meta, { fetchedAt: now });
            continue;
          }
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          const domains = parseList(text);
          if (domains.length < 50) throw new Error("parsed too few domains (" + domains.length + ")");
          lists[src.name] = {
            url: usedUrl,
            etag: res.headers && res.headers.get ? res.headers.get("ETag") || "" : "",
            lastModified: res.headers && res.headers.get ? res.headers.get("Last-Modified") || "" : "",
            fetchedAt: now,
            expiresMs: parseExpires(text),
            domains,
          };
          if (src.cosmetic && CP) {
            lists[src.name].cosmetic = CP.parseCosmetic(text);
            delete lists[src.name].cosmetic.stats;
            cosmeticChanged = true;
          }
          changed = true;
        } catch (e) {
          // One list failing never sinks the others: keep its cached copy (if
          // any) and remember why, so the popup can show it.
          errors[src.name] = String(e && e.message || e);
        }
      }
      const usable = SOURCES.filter((x) => lists[x.name] && Array.isArray(lists[x.name].domains));
      if (!usable.length) throw new Error(Object.values(errors).join("; ") || "no lists");
      await deps.setState({ lastErrors: errors, lastNotes: mirrorNotes, lastErrorAt: Object.keys(errors).length ? now : 0 });

      await deps.setState({ lists });
      if (cosmeticChanged && deps.writeCosmetic) {
        try {
          const parts = SOURCES.filter((x) => x.cosmetic && lists[x.name] && lists[x.name].cosmetic).map((x) => lists[x.name].cosmetic);
          await deps.writeCosmetic(CP.mergeCosmetic(parts), { source: "refresh", updatedAt: now });
        } catch {
          // Cosmetic stays on the previous rules (or the bundled sheet).
        }
      }
      if (!changed) return { ok: true, ran: true, reason: "unchanged" };
      if (!deps.enabled()) return { ok: true, ran: true, reason: "lists off; cached" };
    } catch (e) {
      // Download/parse failed: whatever is active now (a previous good swap
      // or the bundled ruleset) stays. Make sure something is active.
      if (!(await dynamicLooksActive(deps, state))) await fallback(deps);
      try {
        await deps.setState({ lastErrors: { all: String(e && e.message || e) }, lastErrorAt: now });
      } catch {
        // silent
      }
      return { ok: false, ran: true, reason: String(e && e.message || e) };
    }
    try {
      return await swap(deps, (await deps.getState()).lists, now);
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

  async function swap(deps, lists, now) {
    const bundled = await deps.loadBundled();
    const extra = new Set(bundled.extraIds || []);
    const packed = [];
    for (const r of bundled.rules || []) {
      if (r.action && r.action.type === "block" && !extra.has(r.id)) packed.push(...(r.condition.requestDomains || []));
    }
    const bundledDomains = packed.length;
    const perList = Object.fromEntries(Object.entries(lists || {}).filter(([, v]) => v && Array.isArray(v.domains)).map(([k, v]) => [k, v.domains]));
    const missing = SOURCES.filter((x) => !perList[x.name]).map((x) => x.name);
    let domains = mergeDomains(perList);
    if (missing.length) {
      // Lists that failed and have no saved copy: keep the packed domains so a
      // partial refresh never shrinks protection.
      const seen = new Set(domains);
      for (const d of packed) if (!seen.has(d) && !isNeverBlock(d)) { seen.add(d); domains.push(d); }
      domains = domains.slice(0, MAX_LIST_RULES * DOMAINS_PER_RULE);
    }
    // Sanity: a refreshed set much smaller than the bundle is a bad download.
    if (domains.length < bundledDomains * 0.5) throw new Error("refreshed list too small");
    const addRules = buildListRules(domains).concat(keptBundledRules(bundled.rules, bundled.extraIds));
    const existing = (await deps.getDynamicRules()) || [];
    const removeRuleIds = existing.filter((r) => isOurRule(r.id)).map((r) => r.id);
    await deps.updateDynamicRules({ removeRuleIds, addRules });
    await deps.setStaticEnabled(false);
    await deps.setState({ dynamicActive: true, updatedAt: now, ruleCount: addRules.length, domainCount: domains.length });
    return { ok: true, ran: true, rules: addRules.length, domains: domains.length };
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
    if (state.dynamicActive && state.lists) {
      if (await dynamicLooksActive(deps, state)) {
        await deps.setStaticEnabled(false);
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

  function isListUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && LIST_HOSTS.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  Object.assign(target, {
    POLICY, STARTUP_DELAY_MS, MIN_INTERVAL_MS, DOMAINS_PER_RULE, MAX_LIST_RULES,
    LIST_RULE_ID_BASE, KEPT_RULE_ID_BASE, ALLOW_RULE_ID_BASE, SOURCES, LIST_HOSTS,
    isNeverBlock, parseList, parseExpires, mergeDomains, buildListRules, keptBundledRules,
    shouldRun, listDue, refresh, describeError, LIST_ALLOW_RULE_ID, listAllowRule, applyEnabled, isListUrl,
  });
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockUpdate(globalThis.GeneralAdblockUpdate = {});
}
