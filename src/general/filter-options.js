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
    t.sort();
    x.sort();
    if (!party && !t.length && !x.length) return { key: "", cancel };
    return { key: "p=" + party + "|t=" + t.join(",") + "|x=" + x.join(","), cancel };
  }

  // Key -> DNR condition fields (merged into { requestDomains }).
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
    return out;
  }

  // DNR condition -> key (inverse of keyToCondition; requestDomains ignored).
  function conditionKey(cond) {
    const c = cond || {};
    const p = c.domainType || "";
    const t = (c.resourceTypes || []).slice().sort();
    const x = (c.excludedResourceTypes || []).slice().sort();
    if (!p && !t.length && !x.length) return "";
    return "p=" + p + "|t=" + t.join(",") + "|x=" + x.join(",");
  }

  // One `||host^$opts` line -> [domain, key, cancel] or null (not this form / dropped).
  function convertLine(line) {
    const m = DOMAIN_RE.exec(String(line || "").trim());
    if (!m) return null;
    const res = convertOptions(m[2] || "");
    if (!res) return null;
    return [m[1].toLowerCase(), res.key, res.cancel];
  }

  root.GeneralFilterOptions = { TABLE, DOMAIN_RE, convertOptions, keyToCondition, conditionKey, convertLine };
})(typeof self !== "undefined" ? self : globalThis);
