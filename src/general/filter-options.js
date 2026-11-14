// Faithful conversion of `||host^$options` network filters to DNR condition
// scopes, shared by the runtime list refresh (general/update.js) and the packer
// (scripts/pack-filter-lists.py reads the table below as JSON).
//
// Rule: an option either maps to a DNR field, narrows the rule, or the whole
// filter is DROPPED. A scoped filter is never widened into a whole-domain block
// (H-2: `||soundcloud.com^$ping` used to block all of soundcloud.com).
//
// Output per filter: [domain, key] where key "" is a whole-domain block and
// otherwise "p=<domainType>|t=<types,sorted>|x=<excluded types,sorted>"
// (empty parts allowed), or null when the filter must be dropped. Optional
// parts follow in this fixed order, each only when it is not empty (so a key
// without them is byte-identical to the version 1 key):
//   |i=<initiator hosts>   $domain= / $from= hosts   -> initiatorDomains
//   |n=<initiator hosts>   $domain=~host entries      -> excludedInitiatorDomains
//   |m=<methods>           $method=post|get           -> requestMethods
//   |mx=<methods>          $method=~get               -> excludedRequestMethods
//   |d=<request hosts>     $denyallow= hosts          -> excludedRequestDomains
// Values are sorted, deduped and comma-separated.
// Same input, same output in JS and Python: test/fixtures/filter-options-cases.json.
(function (root) {
  const TABLE = /*FILTER-OPTION-TABLE-START*/{
    "version": 2,
    "types": {
      "script": "script",
      "image": "image",
      "stylesheet": "stylesheet",
      "css": "stylesheet",
      "subdocument": "sub_frame",
      "frame": "sub_frame",
      "xmlhttprequest": "xmlhttprequest",
      "xhr": "xmlhttprequest",
      "media": "media",
      "font": "font",
      "object": "object",
      "ping": "ping",
      "beacon": "ping",
      "websocket": "websocket",
      "other": "other",
      "document": "main_frame",
      "doc": "main_frame"
    },
    "party": {
      "third-party": "thirdParty",
      "3p": "thirdParty",
      "~first-party": "thirdParty",
      "~1p": "thirdParty",
      "first-party": "firstParty",
      "1p": "firstParty",
      "~third-party": "firstParty",
      "~3p": "firstParty"
    },
    "ignore": ["important", "match-case", "all"],
    "narrow": ["popup", "popunder"],
    "cancel": ["badfilter"],
    "initiator": ["domain", "from"],
    "methods": ["connect", "delete", "get", "head", "options", "patch", "post", "put"],
    "denyallow": ["denyallow"],
    "extraParts": ["i", "n", "m", "mx", "d"],
    "allDocument": ["all"]
  }/*FILTER-OPTION-TABLE-END*/;

  // Hosts people open on purpose (an affiliate link in an article, a shop
  // deal): never a navigation (main_frame) block from the ordinary lists, even
  // when a list asks for `$document`. Their other rules stay. One entry per
  // registrable host (subdomains included), each with a one-word reason;
  // evidence in BUILD-PROGRESS "NEXT BUILD 2" BLOCK 5. The threat tier does not
  // read this. The packer reads the JSON between the markers.
  const NAV_EXEMPT = /*NAV-EXEMPT-START*/{
    "version": 1,
    "hosts": {
      "redirectingat.com": "affiliate",
      "ojrq.net": "affiliate",
      "invol.co": "affiliate",
      "adtraction.com": "affiliate",
      "linksprf.com": "deals"
    }
  }/*NAV-EXEMPT-END*/;

  function isNavExempt(host) {
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    for (const d of Object.keys(NAV_EXEMPT.hosts)) if (h === d || h.endsWith("." + d)) return true;
    return false;
  }

  // Stream / player hosts (the ONE list in src/threat/protected-hosts.js,
  // loaded before update.js in the worker): never a navigation block either.
  // Same host relation as protectedReason(): under a SUFFIX entry, or an
  // ancestor of (or equal to) any entry. The packer reads the same arrays.
  const under = (h, d) => h === d || h.endsWith("." + d);
  function isNavProtected(host) {
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    const PH = root.GeckoProtectedHosts;
    if (!PH) return false;
    return PH.SUFFIX.some((p) => under(h, p)) || PH.ALL.some((p) => under(p, h));
  }

  const DOMAIN_RE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(\$[^#]*)?$/i;

  // One plain ASCII host name (lowercase, no trailing dot). Entities
  // ("name.*"), regexes, wildcards, IDN text and empty labels fail: DNR rejects
  // a whole rule set update for one bad initiatorDomains entry.
  const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
  function cleanHost(v) {
    const h = String(v || "").trim().toLowerCase().replace(/\.$/, "");
    return HOST_RE.test(h) ? h : null;
  }

  // Sorted, deduped values of a Set.
  const sortedOf = (set) => Array.from(set).sort();

  // Parts object -> key. p, t and x are always written; the extra parts only
  // when not empty, in TABLE.extraParts order.
  function buildKey(parts) {
    let key = "p=" + (parts.p || "") + "|t=" + (parts.t || "") + "|x=" + (parts.x || "");
    for (const k of TABLE.extraParts) if (parts[k]) key += "|" + k + "=" + parts[k];
    return key;
  }

  function parseKey(key) {
    const parts = {};
    for (const seg of String(key || "").split("|")) {
      const i = seg.indexOf("=");
      if (i < 0) continue;
      parts[seg.slice(0, i)] = seg.slice(i + 1);
    }
    return parts;
  }

  // Options string (with or without the leading "$") -> { key, cancel } or null.
  function convertOptions(opts) {
    const raw = String(opts || "").replace(/^\$/, "").trim();
    if (!raw) return { key: "", cancel: false };
    const types = new Set();
    const excluded = new Set();
    const incl = new Set();
    const excl = new Set();
    const methods = new Set();
    const exMethods = new Set();
    const deny = new Set();
    let hadIncl = false;
    let hadInitiator = false;
    let party = "";
    let narrowed = false;
    let cancel = false;
    for (const part0 of raw.split(",")) {
      const part = part0.trim().toLowerCase();
      if (!part) continue;
      if (TABLE.cancel.includes(part)) { cancel = true; continue; }
      if (TABLE.ignore.includes(part)) continue;
      if (TABLE.narrow.includes(part)) { narrowed = true; continue; }
      if (Object.prototype.hasOwnProperty.call(TABLE.party, part)) {
        const p = TABLE.party[part];
        if (party && party !== p) return null; // contradictory
        party = p;
        continue;
      }
      const eq = part.indexOf("=");
      if (eq > 0) {
        const name = part.slice(0, eq);
        const values = part.slice(eq + 1).split("|");
        if (TABLE.initiator.includes(name)) {
          // $domain=a.com|~b.a.com: initiator scope. A bad include entry is
          // skipped (the rule only gets narrower); a bad exclude entry drops
          // the filter (skipping it would widen the rule).
          hadInitiator = true;
          for (const v0 of values) {
            const v = v0.trim();
            const neg = v.startsWith("~");
            const h = cleanHost(neg ? v.slice(1) : v);
            if (neg) {
              if (!h) return null;
              excl.add(h);
            } else {
              hadIncl = true;
              if (h) incl.add(h);
            }
          }
          continue;
        }
        if (name === "method") {
          for (const v0 of values) {
            const v = v0.trim();
            const neg = v.startsWith("~");
            const m = neg ? v.slice(1) : v;
            if (!TABLE.methods.includes(m)) return null;
            (neg ? exMethods : methods).add(m);
          }
          continue;
        }
        if (TABLE.denyallow.includes(name)) {
          for (const v0 of values) {
            const h = cleanHost(v0);
            if (!h) return null; // "~host" or an entity: cannot be exact
            deny.add(h);
          }
          continue;
        }
        return null;
      }
      const neg = part.startsWith("~");
      const name = neg ? part.slice(1) : part;
      if (Object.prototype.hasOwnProperty.call(TABLE.types, name)) {
        (neg ? excluded : types).add(TABLE.types[name]);
        continue;
      }
      return null; // anything we cannot represent: drop the filter
    }
    // Popups are not a request type: they narrow a type list, and a filter that
    // was only about popups (or popups plus a party) has nothing left to block.
    if (narrowed && !types.size) return null;
    // Every include entry was skipped: an empty initiator list would widen.
    if (hadIncl && !incl.size) return null;
    // Mixed $method=post|~get has no exact DNR form.
    if (methods.size && exMethods.size) return null;
    let t = Array.from(types);
    let x = Array.from(excluded);
    if (t.length) {
      t = t.filter((v) => !excluded.has(v));
      if (!t.length) return null;
      x = [];
    }
    // A $domain= scoped filter never blocks a navigation: a top-level page
    // load has no meaningful initiator. With nothing else left, drop it (an
    // empty type list would mean every type).
    if (hadInitiator && t.includes("main_frame")) {
      t = t.filter((v) => v !== "main_frame");
      if (!t.length) return null;
    }
    // `$~document`: navigations are never blocked unless a filter asks for
    // them, so a negated main_frame adds nothing (keyToCondition puts it back
    // into every excluded-only condition). With nothing else left the filter is
    // the plain whole-domain (or party-only) block it means.
    x = x.filter((v) => v !== "main_frame");
    t.sort();
    x.sort();
    const parts = {
      p: party, t: t.join(","), x: x.join(","),
      i: sortedOf(incl).join(","), n: sortedOf(excl).join(","),
      m: sortedOf(methods).join(","), mx: sortedOf(exMethods).join(","),
      d: sortedOf(deny).join(","),
    };
    if (!party && !t.length && !x.length && !TABLE.extraParts.some((k) => parts[k])) return { key: "", cancel };
    return { key: buildKey(parts), cancel };
  }

  // Key -> DNR condition fields (merged into { requestDomains }).
  // Chrome: a rule without resourceTypes matches every type except main_frame,
  // but a rule with only excludedResourceTypes matches every type it does not
  // exclude, main_frame included (checked in Chrome for Testing 155,
  // 2026-11-03: `excludedResourceTypes: ["script"]` blocked typed and clicked
  // navigations). `$~script` means "everything but scripts" in a page, never
  // "block opening the site", so an excluded-only key always excludes
  // main_frame too. The key itself is unchanged (conditionKey strips it).
  function keyToCondition(key) {
    const out = {};
    if (!key) return out;
    for (const seg of key.split("|")) {
      const i = seg.indexOf("=");
      const k = seg.slice(0, i);
      const v = seg.slice(i + 1);
      if (!v) continue;
      if (k === "p") out.domainType = v;
      if (k === "t") out.resourceTypes = v.split(",");
      if (k === "x") out.excludedResourceTypes = v.split(",");
      if (k === "i") out.initiatorDomains = v.split(",");
      if (k === "n") out.excludedInitiatorDomains = v.split(",");
      if (k === "m") out.requestMethods = v.split(",");
      if (k === "mx") out.excludedRequestMethods = v.split(",");
      if (k === "d") out.excludedRequestDomains = v.split(",");
    }
    if (out.excludedResourceTypes && !out.resourceTypes) {
      out.excludedResourceTypes = Array.from(new Set(out.excludedResourceTypes.concat("main_frame"))).sort();
    }
    return out;
  }

  // DNR condition -> key (inverse of keyToCondition; requestDomains ignored).
  // The main_frame that keyToCondition adds to an excluded-only condition is
  // dropped again, so packed rules from before and after that change give the
  // same key.
  function conditionKey(cond) {
    const c = cond || {};
    const p = c.domainType || "";
    const t = (c.resourceTypes || []).slice().sort();
    let x = (c.excludedResourceTypes || []).slice().sort();
    if (!t.length) x = x.filter((v) => v !== "main_frame");
    const s = (a) => Array.from(new Set(a || [])).sort().join(",");
    const parts = {
      p, t: t.join(","), x: x.join(","),
      i: s(c.initiatorDomains), n: s(c.excludedInitiatorDomains),
      m: s(c.requestMethods), mx: s(c.excludedRequestMethods),
      d: s(c.excludedRequestDomains),
    };
    if (!p && !t.length && !x.length && !TABLE.extraParts.some((k) => parts[k])) return "";
    return buildKey(parts);
  }

  // The scope a list entry keeps when the rules are merged (update.js
  // mergeScoped / swap fallback, packer merge_scoped), or null to drop it.
  //  - A host that is also a whole-domain block: its page parts are covered by
  //    that block, but a whole-domain rule never matches opening the page, so
  //    an explicit `$document` part is kept as a main_frame-only scope (party
  //    kept). Everything else is dropped as before.
  //  - A navigation-exempt or stream-protected host never keeps main_frame
  //    (the rest stays).
  function scopeForMerge(domain, key, isWhole) {
    if (!key) return null;
    const parts = parseKey(key);
    let t = parts.t ? parts.t.split(",") : [];
    const nav = t.includes("main_frame");
    // The optional parts (initiator, method, denyallow) only narrow, so they
    // are carried through unchanged.
    if (nav && (isNavExempt(domain) || isNavProtected(domain))) {
      t = t.filter((v) => v !== "main_frame");
      if (!t.length || isWhole) return null;
      return buildKey(Object.assign({}, parts, { t: t.join(",") }));
    }
    if (!isWhole) return key;
    return nav ? buildKey(Object.assign({}, parts, { t: "main_frame", x: "" })) : null;
  }

  // One `||host^$opts` line -> [domain, key, cancel] or null (not this form / dropped).
  function convertLine(line) {
    const m = DOMAIN_RE.exec(String(line || "").trim());
    if (!m) return null;
    const res = convertOptions(m[2] || "");
    if (!res) return null;
    return [m[1].toLowerCase(), res.key, res.cancel];
  }

  // `$popup` / `$popunder` with nothing else that scopes it (ignored options
  // allowed). Such filters are dropped from the ordinary lists, but threat
  // lists use them for known-bad pop-up destinations: the threat tier turns
  // them into main_frame-only rules (a pop-up is a new top-level page).
  function isPopupOnly(opts) {
    const parts = String(opts || "").replace(/^\$/, "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return false;
    let popup = false;
    for (const p of parts) {
      if (TABLE.narrow.includes(p)) popup = true;
      else if (!TABLE.ignore.includes(p)) return false;
    }
    return popup;
  }

  // `$all` means every request type, the page itself included. Its key stays
  // "" (a whole-domain block: the threat tier promotes exactly that key), and
  // a list parser adds a second entry with DOCUMENT_KEY for the navigation
  // part. Only for a plain `$all` (with `important`, `match-case` or
  // `badfilter` at most): with a party, a type or a `domain=` the filter is
  // converted by convertOptions alone and never blocks a navigation from here.
  const DOCUMENT_KEY = "p=|t=main_frame|x=";
  function allAddsDocument(opts) {
    const parts = String(opts || "").replace(/^\$/, "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.some((p) => TABLE.allDocument.includes(p))) return false;
    return parts.every((p) => TABLE.allDocument.includes(p) || TABLE.ignore.includes(p) || TABLE.cancel.includes(p));
  }

  root.GeneralFilterOptions = { TABLE, NAV_EXEMPT, DOMAIN_RE, DOCUMENT_KEY, allAddsDocument, cleanHost, buildKey, convertOptions, keyToCondition, conditionKey, convertLine, isPopupOnly, isNavExempt, isNavProtected, scopeForMerge };
})(typeof self !== "undefined" ? self : globalThis);
