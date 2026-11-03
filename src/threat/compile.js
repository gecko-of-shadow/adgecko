// Threat tier: known-bad hosts -> DNR block rules at priority 2,000,010.
// Above the 2,000,000 stream-site allows (frame allowAllRequests on YouTube and
// Kick, the Twitch and player-CDN allows) and the 2,000,001 YouTube ad-host
// block (rule id 4), so a threat host is blocked on stream pages too; below the 3,000,000
// list-download allow. "Allow this page" (10,000) does not let threat hosts
// through; the user allow-domain override (2,000,020) does.
// Every host goes through GeckoProtectedHosts first (src/threat/protected-hosts.js).
// Classic script (worker importScripts; tests import it for its global).
(function (root) {
  const THREAT_PRIORITY = 2000010;
  const USER_ALLOW_PRIORITY = 2000020;
  const THREAT_TYPES = Object.freeze(["main_frame", "sub_frame", "script", "xmlhttprequest", "ping", "media", "websocket", "other"]);
  // Explicit (an omitted resourceTypes would leave out main_frame).
  const ALL_TYPES = Object.freeze(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"]);
  const HOSTS_PER_RULE = 80;
  // Public lists whose entries are known-bad hosts (role "malware_threat").
  // Curben's phishing-filter is gone for good (OpenPhish-derived, 2026-11-02).
  const THREAT_LISTS = Object.freeze(["urlhaus_hosts", "ublock_badware", "dandelion_antimalware"]);
  // Which parsed filter scopes count as "this host is bad": a whole-domain
  // block, or a $doc (navigation) block. Party- or type-limited filters stay
  // in the ordinary list tier with their own scope and are not promoted.
  const THREAT_SCOPES = Object.freeze(["", "p=|t=main_frame|x="]);

  function PH() {
    const ph = root.GeckoProtectedHosts;
    if (!ph) throw new Error("GeckoProtectedHosts not loaded");
    return ph;
  }

  // Parsed list entries ({domains, scoped} from general/update.js parseEntries)
  // -> threat host candidates, in order, deduped.
  function threatHostsFromEntries(parsed) {
    const out = [];
    const seen = new Set();
    const add = (d) => { if (!seen.has(d)) { seen.add(d); out.push(d); } };
    for (const d of (parsed && parsed.domains) || []) add(d);
    for (const [d, key] of (parsed && parsed.scoped) || []) if (THREAT_SCOPES.includes(key)) add(d);
    return out;
  }

  // hosts -> { rules, accepted, rejected: [{host, reason}], popupAccepted }.
  // opts: { idBase (first rule id), maxRules, popupHosts }
  // popupHosts: hosts the threat lists name only for pop-ups ($popup); they
  // get main_frame-only rules (after the full-type rules, skipping any host
  // already blocked for every type).
  function compileThreatRules(hosts, opts) {
    const ph = PH();
    const idBase = (opts && opts.idBase) || 1;
    const maxRules = opts && typeof opts.maxRules === "number" ? opts.maxRules : Infinity;
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    const take = (raw, into) => {
      const h = ph.normalizeHost(raw);
      if (seen.has(h)) return;
      seen.add(h);
      const why = ph.protectedReason(h);
      if (why) rejected.push({ host: h, reason: why });
      else into.push(h);
    };
    for (const raw of hosts || []) take(raw, accepted);
    const popupAccepted = [];
    for (const raw of (opts && opts.popupHosts) || []) take(raw, popupAccepted);
    const rules = [];
    const push = (list, types) => {
      let used = 0;
      for (let i = 0; i < list.length && rules.length < maxRules; i += HOSTS_PER_RULE) {
        const chunk = list.slice(i, i + HOSTS_PER_RULE);
        rules.push({
          id: idBase + rules.length,
          priority: THREAT_PRIORITY,
          action: { type: "block" },
          condition: { requestDomains: chunk, resourceTypes: types.slice() },
        });
        used += chunk.length;
      }
      return used;
    };
    const used = push(accepted, THREAT_TYPES);
    const popupUsed = push(popupAccepted, ["main_frame"]);
    return {
      rules, accepted: accepted.slice(0, used), rejected, popupAccepted: popupAccepted.slice(0, popupUsed),
      dropped: accepted.length - used + popupAccepted.length - popupUsed,
    };
  }

  // User "Allow this domain" override: one allow rule per domain at 2,000,020,
  // every resource type listed (main_frame included). DNR matches subdomains
  // too, so "example.test" also allows "www.example.test" (only ever allows more).
  // Same public-suffix / platform check as the threat hosts (src/threat/psl.js):
  // "github.io" or "co.uk" would let a whole platform or country through, so
  // they are refused (a site under them, e.g. "me.github.io", is fine).
  // Without the data loaded nothing is accepted.
  function userDomainReason(input) {
    let s = String(input == null ? "" : input).trim().toLowerCase();
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
    if (s.startsWith("*.")) s = s.slice(2);
    if (s.endsWith(".")) s = s.slice(0, -1);
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)) return { domain: null, reason: "not a domain name" };
    const ps = root.GeckoPublicSuffix;
    if (!ps) return { domain: null, reason: "public-suffix data not loaded" };
    const why = ps.suffixReason(s);
    return why ? { domain: null, reason: why } : { domain: s, reason: null };
  }

  function normalizeUserDomain(input) {
    return userDomainReason(input).domain;
  }

  function buildUserAllowRules(domains, idBase, max) {
    const rules = [];
    const seen = new Set();
    for (const raw of domains || []) {
      const d = normalizeUserDomain(raw);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      if (max && rules.length >= max) break;
      rules.push({
        id: idBase + rules.length,
        priority: USER_ALLOW_PRIORITY,
        action: { type: "allow" },
        condition: { requestDomains: [d], resourceTypes: ALL_TYPES.slice() },
      });
    }
    return rules;
  }

  root.GeckoThreatCompile = Object.freeze({
    THREAT_PRIORITY, USER_ALLOW_PRIORITY, THREAT_TYPES, ALL_TYPES, HOSTS_PER_RULE, THREAT_LISTS, THREAT_SCOPES,
    threatHostsFromEntries, compileThreatRules, normalizeUserDomain, userDomainReason, buildUserAllowRules,
  });
})(typeof self !== "undefined" ? self : globalThis);
