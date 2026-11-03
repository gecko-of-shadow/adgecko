// Signed threat feed: validated document -> DNR session rules. Pure code.
// Rules are blocks at the threat-tier priority (2,000,010), ids offset into
// 700001..704500 so they never collide with other rule ids (dynamic lists
// 100000+, threat refresh 600000+, kept 800000+, page allows 900000+,
// domain overrides 950000+, list-download allow 990001).
(function (root) {
  const FEED_RULE_ID_BASE = 700000;
  const FEED_RULE_ID_END = FEED_RULE_ID_BASE + 4501;
  const THREAT_PRIORITY = 2000010;

  function isFeedRuleId(id) {
    return id > FEED_RULE_ID_BASE && id < FEED_RULE_ID_END;
  }

  // doc: output of GeckoFeedSchema.validateFeed. -> { rules, killed }
  function compileFeed(doc) {
    const S = root.GeckoFeedSchema;
    if (doc.killFeed) return { rules: [], killed: true };
    const drop = new Set(doc.dropRuleIds || []);
    const rules = [];
    for (const e of doc.dnr || []) {
      if (drop.has(e.id)) continue;
      rules.push({
        id: FEED_RULE_ID_BASE + e.id,
        priority: THREAT_PRIORITY,
        action: { type: "block" },
        condition: {
          requestDomains: e.requestDomains.slice(),
          resourceTypes: (e.resourceTypes || S.THREAT_TYPES).slice(),
        },
      });
    }
    return { rules, killed: false };
  }

  // A rollback document names an earlier serial. Pick that payload from the
  // cache ({ current, previous }, each { serial, doc }); null when it is not
  // stored (then the rollback is ignored and the current rules stay).
  function resolveRollback(doc, cache) {
    if (!doc || doc.rollbackTo == null) return null;
    for (const slot of ["current", "previous"]) {
      const c = cache && cache[slot];
      if (c && c.serial === doc.rollbackTo && c.doc) return c;
    }
    return null;
  }

  root.GeckoFeedCompile = Object.freeze({ FEED_RULE_ID_BASE, FEED_RULE_ID_END, THREAT_PRIORITY, isFeedRuleId, compileFeed, resolveRollback });
})(typeof self !== "undefined" ? self : globalThis);
