// Signed threat feed: strict v1 schema. Pure code, no chrome.*.
// Runs only on bytes whose signature already verified (src/feed/verify.js).
// Any violation rejects the WHOLE document (the client keeps its previous
// feed). Unknown keys are rejected at every level: new fields need format 2.
//
// Feed document (signed by a FEED key):
//   format       1 (required)
//   serial       integer >= 1, greater than the stored serial (required)
//   createdAt    ISO-8601 UTC time (required)
//   notBefore    ISO time; not valid before it (required)
//   notAfter     ISO time; expired after it; at most 14 days after createdAt (required)
//   minExtension dotted version or null; maxExtension dotted version or null
//   killFeed     boolean (default false): drop every feed rule
//   dropRuleIds  integers 1..4500 to leave out of the compiled set
//   rollbackTo   serial of a stored earlier payload to re-apply, or null
//   dnr          array (required) of block-only entries:
//                  { id: 1..4500 unique, requestDomains: 1..80 hosts,
//                    resourceTypes?: subset of the threat types, action?: "block" }
//                priority is fixed (2,000,010) and may not be sent
//   cosmetic     reserved: must be an empty array (or absent) in v1
//   tactics      reserved: must be an empty array (or absent) in v1
// A host that is protected (src/threat/protected-hosts.js) rejects the feed.
//
// Kill document (signed by a KILL key, nothing else accepted from that key):
//   { format: 1, kill: true, serial, createdAt }
(function (root) {
  const FORMAT = 1;
  const MAX_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // notAfter - createdAt (D-7)
  const MAX_RULE_ID = 4500;
  const MAX_HOSTS_PER_ENTRY = 80;
  const THREAT_TYPES = Object.freeze(["main_frame", "sub_frame", "script", "xmlhttprequest", "ping", "media", "websocket", "other"]);
  const FEED_KEYS_ALLOWED = Object.freeze(["format", "serial", "createdAt", "notBefore", "notAfter", "minExtension", "maxExtension", "killFeed", "dropRuleIds", "rollbackTo", "dnr", "cosmetic", "tactics"]);
  const FEED_KEYS_REQUIRED = Object.freeze(["format", "serial", "createdAt", "notBefore", "notAfter", "dnr"]);
  const ENTRY_KEYS = Object.freeze(["id", "requestDomains", "resourceTypes", "action"]);
  const KILL_KEYS = Object.freeze(["format", "kill", "serial", "createdAt"]);
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  const VERSION_RE = /^\d{1,5}(?:\.\d{1,5}){0,3}$/;

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isPosInt = (v) => Number.isSafeInteger(v) && v >= 1;
  function fail(msg) {
    const e = new Error(msg);
    e.feedReject = true;
    throw e;
  }

  function parseTime(v, name) {
    if (typeof v !== "string" || !ISO_RE.test(v)) fail(name + " must be an ISO-8601 UTC time");
    const t = Date.parse(v);
    if (!Number.isFinite(t)) fail(name + " is not a valid time");
    return t;
  }

  function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function onlyKeys(obj, allowed, where) {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail("unknown key " + JSON.stringify(k) + " in " + where);
  }

  // ctx: { now (ms), storedSerial (number|0), extensionVersion (string),
  //        protectedReason(host) -> null|string }
  // Returns the document (normalised defaults) or throws { feedReject }.
  function validateFeed(doc, ctx) {
    const c = ctx || {};
    if (!isObj(doc)) fail("feed must be a JSON object");
    onlyKeys(doc, FEED_KEYS_ALLOWED, "feed");
    for (const k of FEED_KEYS_REQUIRED) if (!(k in doc)) fail("missing " + k);
    if (doc.format !== FORMAT) fail("unsupported format " + JSON.stringify(doc.format));
    if (!isPosInt(doc.serial)) fail("serial must be a positive integer");
    if (doc.serial <= (c.storedSerial || 0)) fail("serial " + doc.serial + " is not newer than " + (c.storedSerial || 0) + " (replay or rollback attack)");
    const created = parseTime(doc.createdAt, "createdAt");
    const notBefore = parseTime(doc.notBefore, "notBefore");
    const notAfter = parseTime(doc.notAfter, "notAfter");
    if (notAfter <= notBefore) fail("notAfter must be after notBefore");
    if (notAfter - created > MAX_LIFETIME_MS) fail("notAfter is more than 14 days after createdAt");
    const now = typeof c.now === "number" ? c.now : Date.now();
    if (now < notBefore) fail("feed not valid yet (notBefore " + doc.notBefore + ")");
    if (now >= notAfter) fail("feed expired (notAfter " + doc.notAfter + ")");
    for (const k of ["minExtension", "maxExtension"]) {
      if (doc[k] != null && (typeof doc[k] !== "string" || !VERSION_RE.test(doc[k]))) fail(k + " must be a dotted version or null");
    }
    if (c.extensionVersion) {
      if (doc.minExtension && compareVersions(c.extensionVersion, doc.minExtension) < 0) fail("extension " + c.extensionVersion + " older than minExtension " + doc.minExtension);
      if (doc.maxExtension && compareVersions(c.extensionVersion, doc.maxExtension) > 0) fail("extension " + c.extensionVersion + " newer than maxExtension " + doc.maxExtension);
    }
    if ("killFeed" in doc && typeof doc.killFeed !== "boolean") fail("killFeed must be a boolean");
    if ("dropRuleIds" in doc) {
      if (!Array.isArray(doc.dropRuleIds) || doc.dropRuleIds.length > MAX_RULE_ID) fail("dropRuleIds must be an array");
      for (const id of doc.dropRuleIds) if (!isPosInt(id) || id > MAX_RULE_ID) fail("dropRuleIds entries must be 1.." + MAX_RULE_ID);
    }
    if ("rollbackTo" in doc && doc.rollbackTo !== null && !isPosInt(doc.rollbackTo)) fail("rollbackTo must be a serial or null");
    if (doc.rollbackTo != null && doc.rollbackTo >= doc.serial) fail("rollbackTo must name an earlier serial");
    for (const k of ["cosmetic", "tactics"]) {
      if (k in doc && (!Array.isArray(doc[k]) || doc[k].length)) fail(k + " is reserved and must be empty in format 1");
    }
    if (!Array.isArray(doc.dnr)) fail("dnr must be an array");
    if (doc.dnr.length > MAX_RULE_ID) fail("too many dnr entries");
    if (doc.rollbackTo != null && doc.dnr.length) fail("a rollback document carries no dnr entries");
    const ids = new Set();
    const protectedReason = c.protectedReason || ((root.GeckoProtectedHosts && root.GeckoProtectedHosts.protectedReason) || null);
    if (!protectedReason) fail("protected host check not available");
    for (const [i, e] of doc.dnr.entries()) {
      const where = "dnr[" + i + "]";
      if (!isObj(e)) fail(where + " must be an object");
      onlyKeys(e, ENTRY_KEYS, where);
      if (!isPosInt(e.id) || e.id > MAX_RULE_ID) fail(where + ".id must be 1.." + MAX_RULE_ID);
      if (ids.has(e.id)) fail("duplicate dnr id " + e.id);
      ids.add(e.id);
      if ("action" in e && e.action !== "block") fail(where + ".action must be \"block\"");
      if (!Array.isArray(e.requestDomains) || e.requestDomains.length < 1 || e.requestDomains.length > MAX_HOSTS_PER_ENTRY) fail(where + ".requestDomains must hold 1.." + MAX_HOSTS_PER_ENTRY + " hosts");
      const seen = new Set();
      for (const h of e.requestDomains) {
        if (typeof h !== "string" || h !== h.trim().toLowerCase() || h.endsWith(".")) fail(where + " host " + JSON.stringify(h) + " must be a lower-case host name");
        if (seen.has(h)) fail(where + " repeats " + h);
        seen.add(h);
        const why = protectedReason(h);
        if (why) fail(where + " host " + h + " rejected: " + why);
      }
      if ("resourceTypes" in e) {
        if (!Array.isArray(e.resourceTypes) || !e.resourceTypes.length) fail(where + ".resourceTypes must be a non-empty array");
        const t = new Set();
        for (const v of e.resourceTypes) {
          if (!THREAT_TYPES.includes(v)) fail(where + ".resourceTypes may only use " + THREAT_TYPES.join(", "));
          if (t.has(v)) fail(where + ".resourceTypes repeats " + v);
          t.add(v);
        }
      }
    }
    return Object.assign({ minExtension: null, maxExtension: null, killFeed: false, dropRuleIds: [], rollbackTo: null, cosmetic: [], tactics: [] }, doc);
  }

  // ctx: { storedKillSerial }
  function validateKill(doc, ctx) {
    const c = ctx || {};
    if (!isObj(doc)) fail("kill document must be a JSON object");
    onlyKeys(doc, KILL_KEYS, "kill document");
    for (const k of KILL_KEYS) if (!(k in doc)) fail("kill document missing " + k);
    if (doc.format !== FORMAT || doc.kill !== true) fail("not a format-1 kill document");
    if (!isPosInt(doc.serial)) fail("kill serial must be a positive integer");
    if (doc.serial <= (c.storedKillSerial || 0)) fail("kill serial " + doc.serial + " is not newer than " + (c.storedKillSerial || 0));
    parseTime(doc.createdAt, "createdAt");
    return doc;
  }

  root.GeckoFeedSchema = Object.freeze({
    FORMAT, MAX_LIFETIME_MS, MAX_RULE_ID, MAX_HOSTS_PER_ENTRY, THREAT_TYPES,
    validateFeed, validateKill, compareVersions,
  });
})(typeof self !== "undefined" ? self : globalThis);
