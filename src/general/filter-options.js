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
// (empty parts allowed), or null when the filter must be dropped.
// Same input, same output in JS and Python: test/fixtures/filter-options-cases.json.
(function (root) {
  const TABLE = /*FILTER-OPTION-TABLE-START*/{
    "version": 1,
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
    "cancel": ["badfilter"]
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
      "adtraction.com": "affiliate"
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

  // Options string (with or without the leading "$") -> { key, cancel } or null.
  function convertOptions(opts) {
    const raw = String(opts || "").replace(/^\$/, "").trim();
    if (!raw) return { key: "", cancel: false };
    const types = new Set();
    const excluded = new Set();
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
    let t = Array.from(types);
    let x = Array.from(excluded);
    if (t.length) {
      t = t.filter((v) => !excluded.has(v));
      if (!t.length) return null;
      x = [];
    }
    // `$~document`: navigations are never blocked unless a filter asks for
    // them, so a negated main_frame adds nothing (keyToCondition puts it back
    // into every excluded-only condition). With nothing else left the filter is
    // the plain whole-domain (or party-only) block it means.
    x = x.filter((v) => v !== "main_frame");
    t.sort();
    x.sort();
    if (!party && !t.length && !x.length) return { key: "", cancel };
    return { key: "p=" + party + "|t=" + t.join(",") + "|x=" + x.join(","), cancel };
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
    if (!p && !t.length && !x.length) return "";
    return "p=" + p + "|t=" + t.join(",") + "|x=" + x.join(",");
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
    const parts = {};
    for (const seg of key.split("|")) {
      const i = seg.indexOf("=");
      parts[seg.slice(0, i)] = seg.slice(i + 1);
    }
    let t = parts.t ? parts.t.split(",") : [];
    const nav = t.includes("main_frame");
    if (nav && (isNavExempt(domain) || isNavProtected(domain))) {
      t = t.filter((v) => v !== "main_frame");
      if (!t.length || isWhole) return null;
      return "p=" + (parts.p || "") + "|t=" + t.join(",") + "|x=" + (parts.x || "");
    }
    if (!isWhole) return key;
    return nav ? "p=" + (parts.p || "") + "|t=main_frame|x=" : null;
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

  root.GeneralFilterOptions = { TABLE, NAV_EXEMPT, DOMAIN_RE, convertOptions, keyToCondition, conditionKey, convertLine, isPopupOnly, isNavExempt, isNavProtected, scopeForMerge };
})(typeof self !== "undefined" ? self : globalThis);
