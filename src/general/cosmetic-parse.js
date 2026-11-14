// Cosmetic (element-hiding) filter parsing + lookup. Pure functions, no DOM,
// no eval. Shared by the background worker (list refresh), the content script
// (src/cosmetic.js, which loads it first) and scripts/pack-cosmetic.mjs.
//
// Only plain CSS selectors are kept: EasyList "##" / "#@#", plus "#?#" rules
// whose body uses nothing beyond native CSS (:has). Procedural / scriptlet
// rules (+js, :has-text, :xpath, :-abp-*, :upward, :remove, :style, ...) are
// skipped. Every selector becomes its own CSS rule, so one the browser cannot
// parse is dropped alone and never disables the others.
(function (root) {
  const MAX_SELECTOR_LEN = 600;
  const PROCEDURAL_RE = /:(?:-abp-[a-z-]+|has-text|xpath|upward|remove|remove-attr|remove-class|style|matches-css(?:-before|-after)?|matches-attr|matches-path|matches-media|matches-prop|min-text-length|watch-attr|others|if|if-not|contains|nth-ancestor|properties|shadow)\(/i;
  // Stream sites keep their own handlers; never store rules for them. The one
  // list is src/settings/features.js (loaded first wherever this file runs).
  const SKIP_HOST_RE = { test: (h) => {
    const F = root.GeckoFeatures || (typeof globalThis !== "undefined" && globalThis.GeckoFeatures);
    return !!(F && F.isStreamHost(h));
  } };

  // Structural check: a selector can never close or open a rule block, start a
  // comment, or carry unbalanced quotes/brackets/parens. Anything that could
  // break out of "<selector>{display:none!important}" is rejected.
  function sanitizeSelector(raw) {
    const sel = String(raw || "").trim();
    if (!sel || sel.length > MAX_SELECTOR_LEN) return "";
    if (/[{}]/.test(sel) || sel.includes("/*") || sel.includes("*/") || sel.includes("@")) return "";
    if (/[\u0000-\u001f\u007f]/.test(sel)) return "";
    if (/^[>+~,]/.test(sel) || /[,>+~]\s*$/.test(sel)) return "";
    if (PROCEDURAL_RE.test(sel) || sel.startsWith("+js(") || sel.startsWith("^")) return "";
    let paren = 0;
    let bracket = 0;
    let quote = "";
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      else if (ch === "[") bracket += 1;
      else if (ch === "]") bracket -= 1;
      if (paren < 0 || bracket < 0) return "";
    }
    if (quote || paren || bracket) return "";
    if (sel.endsWith("\\")) return "";
    return sel;
  }

  // A generic (all-sites) selector that names no class, id, attribute or custom
  // element ("*", "body", "div", "html *", "*:not(.x)") would hide whole pages
  // everywhere: a poisoned or broken list. Such generic rules are dropped.
  // (Site-specific rules may hide a whole page on purpose, e.g. EasyList's
  // "aads.com##HTML"; those are only counted, see pageRootSelector.)
  // Every top-level branch of a selector list must be scoped on its own. A
  // class inside :not/:lang/:dir/:nth-* does not scope the element. A class
  // inside :is/:where/:matches/:-webkit-any/:-moz-any does, but only when every
  // argument branch is scoped ("div:is(.a, .b)" is kept, "html:is(.a, html)"
  // is not). A branch whose subject is html/body/:root/* needs its own class,
  // id or attribute ("body:has(.x)" still hides the whole page).
  const NON_SCOPING_PSEUDO_RE = /^:(?:not|lang|dir|nth-[a-z-]+)$/i;
  const LIST_PSEUDO_RE = /^:(?:is|where|matches|-webkit-any|-moz-any)$/i;
  const CUSTOM_ELEMENT_RE = /(?:^|[\s>+~(])[a-z][a-z0-9]*-[a-z0-9-]*/i;

  // Masks escapes, quoted strings and attribute-selector contents, so that
  // "a[title='x :root, y']" or "a\,b" cannot fake a combinator, comma or
  // pseudo-class. "[...]" becomes "[_]", an escaped char becomes "_".
  function maskSelector(sel) {
    let out = "";
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === "\\") {
        out += "_";
        i += 1;
      } else if (ch === '"' || ch === "'") {
        const end = sel.indexOf(ch, i + 1);
        i = end < 0 ? sel.length : end;
        out += "_";
      } else if (ch === "[") {
        let quote = "";
        let j = i + 1;
        for (; j < sel.length; j++) {
          const c = sel[j];
          if (c === "\\") j += 1;
          else if (quote) { if (c === quote) quote = ""; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === "]") break;
        }
        out += "[_]";
        i = j;
      } else {
        out += ch;
      }
    }
    return out;
  }

  // Splits masked text at depth 0 on the given separator test.
  function splitTop(text, isSep) {
    const out = [];
    let cur = "";
    let depth = 0;
    for (const ch of text) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (!depth && isSep(ch)) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  const isScopedText = (t) => /[.#[]/.test(t) || CUSTOM_ELEMENT_RE.test(t);

  // Reduces masked text to the parts that can scope an element. Arguments of
  // :not/:lang/:dir/:nth-* are dropped; :is-like arguments are kept only when
  // every argument branch is scoped. Other arguments (:has(), procedural
  // filters) are kept, except with forSubject, where they say nothing about
  // the subject element itself.
  function reduceSelector(m, forSubject) {
    let out = "";
    for (let i = 0; i < m.length; i++) {
      const ch = m[i];
      if (ch !== "(") {
        out += ch;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      for (; j < m.length && depth; j++) {
        if (m[j] === "(") depth += 1;
        else if (m[j] === ")") depth -= 1;
      }
      const args = m.slice(i + 1, depth ? j : j - 1);
      i = j - 1;
      const name = (/:[a-z-]+$/i.exec(out) || [""])[0];
      if (NON_SCOPING_PSEUDO_RE.test(name)) continue;
      if (LIST_PSEUDO_RE.test(name)) {
        const ok = splitTop(args, (c) => c === ",").every((b) => isScopedText(reduceSelector(b, false)));
        if (ok) out += "(" + reduceSelector(args, forSubject) + ")";
        continue;
      }
      if (!forSubject) out += "(" + reduceSelector(args, false) + ")";
    }
    return out;
  }

  function isUnscopedBranch(m) {
    // Subject = last compound of the branch.
    const compounds = splitTop(reduceSelector(m, true), (c) => /[\s>+~]/.test(c)).filter(Boolean);
    const subject = compounds[compounds.length - 1] || "";
    if (!/[.#[]/.test(subject)) {
      const type = subject.replace(/:[a-z-]+/gi, "").toLowerCase();
      if (type === "html" || type === "body" || /:root\b/i.test(subject)) return true;
      if ((type === "" || type === "*") && compounds.length === 1) return true;
    }
    return !isScopedText(reduceSelector(m, false));
  }

  function isUnscopedSelector(sel) {
    return splitTop(maskSelector(String(sel || "")), (c) => c === ",").some(isUnscopedBranch);
  }

  function isPageRootSelector(sel) {
    return /^\s*(?:\*|html|body|:root)\s*$/i.test(String(sel || ""));
  }

  // Unicode (IDN) host -> punycode, as location.hostname reports it. A
  // trailing ".*" (any-TLD form) is kept apart from the conversion.
  function toAsciiHost(host) {
    if (!/[^\x00-\x7f]/.test(host)) return host;
    // Only host characters: never let "ü@evil.com" or "ü/x" parse as a URL.
    if (!/^[a-z0-9.*\u0080-￿-]+$/.test(host)) return "";
    const any = host.endsWith(".*");
    const base = any ? host.slice(0, -2) : host;
    try {
      const ascii = new URL("http://" + base + "/").hostname;
      return ascii ? ascii + (any ? ".*" : "") : "";
    } catch {
      return "";
    }
  }

  function normalizeHost(h) {
    const host = toAsciiHost(String(h || "").trim().toLowerCase().replace(/\.$/, ""));
    if (!host || host.length > 253) return "";
    if (!/^[a-z0-9*][a-z0-9.*-]*$/.test(host)) return "";
    if (host.includes("*") && !/^[a-z0-9.-]+\.\*$/.test(host)) return ""; // only "name.*"
    return host;
  }

  const LINE_RE = /^([^#]*)(#@#|##|#\?#|#@\?#)(.+)$/;

  // Returns { generic: [sel], sites: {host: [sel]}, exceptions: {host: [sel]},
  //           genericExceptions: [sel], stats }
  // opts.sitesOnly (AdGuard Base, `cosmetic: "sites"` in update.js SOURCES):
  // keep only rules scoped to a site (site.com##x, site.com#@#x). Generic
  // "##x", "~a.com##x" and "#@#x" are dropped, because the parser does not
  // support AdGuard's `$generichide` / `$elemhide` page exceptions, so its
  // generic selectors would hide things on sites AdGuard exempts.
  function parseCosmetic(text, opts) {
    const sitesOnly = !!(opts && opts.sitesOnly);
    const genericSet = new Set();
    const sites = new Map();
    const exceptions = new Map();
    const genericExceptions = new Set();
    // "~host" exclusions on hide rules. They only stop that one rule, so they
    // become exceptions only after the loop, when no other rule hides the
    // same selector on that host. genericExcl: sel -> hosts every generic
    // rule for sel excludes (null = some generic rule has no exclusion).
    const genericExcl = new Map();
    const siteExcl = [];
    const cleanSites = new Map();
    const stats = { lines: 0, kept: 0, skipped: 0, unscopedGeneric: 0, pageRootSite: 0, genericDropped: 0 };
    const add = (map, host, sel) => {
      let set = map.get(host);
      if (!set) map.set(host, (set = new Set()));
      set.add(sel);
    };
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === "!" || line[0] === "[") continue;
      const m = LINE_RE.exec(line);
      if (!m) continue;
      stats.lines += 1;
      const isException = m[2] === "#@#" || m[2] === "#@?#";
      const procedural = m[2] === "#?#" || m[2] === "#@?#";
      const sel = sanitizeSelector(m[3]);
      if (!sel || (procedural && PROCEDURAL_RE.test(m[3]))) {
        stats.skipped += 1;
        continue;
      }
      const include = [];
      const exclude = [];
      let bad = false;
      for (const part of m[1].split(",")) {
        if (!part.trim()) continue;
        const neg = part.trim().startsWith("~");
        const host = normalizeHost(neg ? part.trim().slice(1) : part);
        if (!host) {
          bad = true;
          break;
        }
        (neg ? exclude : include).push(host);
      }
      if (bad) {
        stats.skipped += 1;
        continue;
      }
      const included = include.filter((h) => !SKIP_HOST_RE.test(h));
      if (include.length && !included.length) {
        stats.skipped += 1;
        continue;
      }
      if (sitesOnly && !included.length) {
        stats.genericDropped += 1;
        stats.skipped += 1;
        continue;
      }
      if (!isException && !included.length && isUnscopedSelector(sel)) {
        stats.unscopedGeneric += 1;
        stats.skipped += 1;
        continue;
      }
      // "~a.com#@#x" means "exception everywhere except a.com". It must not
      // become a global exception that also removes the hide on a.com.
      if (isException && !included.length && exclude.length) {
        stats.skipped += 1;
        continue;
      }
      stats.kept += 1;
      if (isException) {
        if (!included.length) genericExceptions.add(sel);
        for (const h of included) add(exceptions, h, sel);
        continue;
      }
      if (included.length && isPageRootSelector(sel)) stats.pageRootSite += included.length;
      if (!included.length) genericSet.add(sel);
      for (const h of included) add(sites, h, sel);
      if (!included.length) {
        const prev = genericExcl.get(sel);
        if (!exclude.length || prev === null) genericExcl.set(sel, null);
        else genericExcl.set(sel, prev ? new Set(exclude.filter((h) => prev.has(h))) : new Set(exclude));
      } else if (exclude.length) {
        for (const h of exclude) siteExcl.push([h, sel]);
      } else {
        for (const h of included) add(cleanSites, h, sel);
      }
    }
    // "~a.com##x" / "b.com,~a.b.com##x": the excluded host gets an exception,
    // unless another rule (an unconditional generic one, a generic one that
    // does not exclude the host, or a plain site rule) hides x there.
    const hiddenElsewhere = (h, sel) => {
      const g = genericExcl.get(sel);
      if (g === null || (g && !g.has(h))) return true;
      return candidateHosts(h).some((c) => cleanSites.has(c) && cleanSites.get(c).has(sel));
    };
    // Exclusion-derived entries also go to "exclusions", so mergeCosmetic can
    // drop them when another list hides the selector on that host.
    const exclusions = new Map();
    const exclude = (h, sel) => {
      if (hiddenElsewhere(h, sel)) return;
      add(exceptions, h, sel);
      add(exclusions, h, sel);
    };
    for (const [sel, hosts] of genericExcl) for (const h of hosts || []) exclude(h, sel);
    for (const [h, sel] of siteExcl) exclude(h, sel);
    for (const sel of genericExceptions) genericSet.delete(sel);
    const toObj = (map) => {
      const out = {};
      for (const [k, v] of map) out[k] = Array.from(v);
      return out;
    };
    return {
      generic: Array.from(genericSet),
      sites: toObj(sites),
      exceptions: toObj(exceptions),
      genericExceptions: Array.from(genericExceptions),
      exclusions: toObj(exclusions),
      stats,
    };
  }

  // A generic "#@#x" from one list also cancels "##x" from the other lists.
  // The exceptions are used up here and not passed on, so a later merge (the
  // owner's bundled extras in writeCosmetic) is not affected.
  // A "~host" exclusion entry (p.exclusions) of one list is dropped when
  // another part hides the same selector on that host without excluding it.
  function mergeCosmetic(parts) {
    const generic = new Set();
    const genericExceptions = new Set();
    const sites = {};
    const exceptions = {};
    const exclusions = {};
    const pending = [];
    const has = (obj, h, sel) => !!(obj && obj[h] && obj[h].includes(sel));
    const into = (dst, src, skip) => {
      for (const [h, sels] of Object.entries(src || {})) {
        const set = new Set(dst[h] || []);
        for (const s of sels) {
          if (skip && skip(h, s)) continue;
          set.add(s);
        }
        if (set.size) dst[h] = Array.from(set);
      }
    };
    parts.forEach((p, i) => {
      for (const s of p.generic || []) generic.add(s);
      for (const s of p.genericExceptions || []) genericExceptions.add(s);
      into(sites, p.sites);
      into(exceptions, p.exceptions, (h, s) => {
        if (!has(p.exclusions, h, s)) return false;
        pending.push([h, s, i]);
        return true;
      });
    });
    for (const s of genericExceptions) generic.delete(s);
    for (const [h, s, i] of pending) {
      const hiddenByOther = parts.some((q, j) => j !== i && !has(q.exclusions, h, s) &&
        ((q.generic || []).includes(s) || candidateHosts(h).some((c) => has(q.sites, c, s))));
      if (hiddenByOther) continue;
      into(exceptions, { [h]: [s] });
      into(exclusions, { [h]: [s] });
    }
    return { generic: Array.from(generic), sites, exceptions, exclusions };
  }

  // Lookup keys for a page host: itself, each parent domain, and "name.*"
  // forms (EasyList's any-TLD entries, e.g. "xhamster3.*").
  function candidateHosts(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    const labels = host.split(".").filter(Boolean);
    const out = [];
    for (let i = 0; i < labels.length - 1; i++) {
      const suffix = labels.slice(i).join(".");
      out.push(suffix);
      for (let t = 1; t <= 2 && labels.length - i - t >= 1; t++) {
        out.push(labels.slice(i, labels.length - t).join(".") + ".*");
      }
    }
    return Array.from(new Set(out));
  }

  const HIDE = "{display:none!important}";

  function cssForSelectors(selectors, skip) {
    let css = "";
    for (const sel of selectors || []) {
      if (skip && skip.has(sel)) continue;
      css += sel + HIDE + "\n";
    }
    return css;
  }

  // Storage layout (chrome.storage.local): one key per host, so a page reads
  // only its own few keys plus the generic sheet.
  const KEY_GENERIC = "cosG";
  // cosMeta stays small: every frame reads it (it gates the stored sheet, and
  // a change to it re-runs the content script). The full key list (about
  // 8,300 names) lives in cosKeys, which only the worker reads, for stale-key
  // cleanup. Before 0.3.5 the list was cosMeta.keys; the worker still reads it.
  const KEY_META = "cosMeta";
  const KEY_INDEX = "cosKeys";
  const PREFIX_SITE = "cosS:";
  const PREFIX_EXC = "cosE:";

  function toStorage(data, meta) {
    const items = {};
    // Generic selectors stored newline-joined (no rule text) to keep the
    // per-page read small; buildPageCss turns them into rules.
    items[KEY_GENERIC] = (data.generic || []).join("\n");
    for (const [h, sels] of Object.entries(data.sites || {})) items[PREFIX_SITE + h] = sels;
    for (const [h, sels] of Object.entries(data.exceptions || {})) items[PREFIX_EXC + h] = sels;
    const m = Object.assign({}, meta || {});
    delete m.keys;
    items[KEY_META] = Object.assign({ count: Object.keys(items).length }, m);
    items[KEY_INDEX] = Object.keys(items).concat(KEY_INDEX);
    return items;
  }

  function keysForHost(hostname, withGeneric) {
    const keys = withGeneric === false ? [KEY_META] : [KEY_GENERIC, KEY_META];
    for (const h of candidateHosts(hostname)) keys.push(PREFIX_SITE + h, PREFIX_EXC + h);
    return keys;
  }

  // Build the page's stylesheet from what storage returned for keysForHost().
  function buildPageCss(hostname, stored, fallbackGenericCss) {
    const exc = new Set();
    const siteSels = [];
    for (const h of candidateHosts(hostname)) {
      for (const s of stored[PREFIX_EXC + h] || []) exc.add(s);
      for (const s of stored[PREFIX_SITE + h] || []) siteSels.push(s);
    }
    let generic = "";
    if (typeof stored[KEY_GENERIC] === "string" && stored[KEY_GENERIC]) {
      let list = stored[KEY_GENERIC];
      if (exc.size) list = list.split("\n").filter((sel) => !exc.has(sel)).join("\n");
      if (list) generic = list.replaceAll("\n", HIDE + "\n") + HIDE + "\n";
    } else if (fallbackGenericCss) {
      generic = fallbackGenericCss + "\n";
    }
    return generic + cssForSelectors(siteSels, exc);
  }

  root.GeneralCosmeticParse = {
    MAX_SELECTOR_LEN, KEY_GENERIC, KEY_META, KEY_INDEX, PREFIX_SITE, PREFIX_EXC, HIDE,
    sanitizeSelector, normalizeHost, isUnscopedSelector, isPageRootSelector, parseCosmetic, mergeCosmetic, candidateHosts,
    cssForSelectors, toStorage, keysForHost, buildPageCss,
  };
})(typeof self !== "undefined" ? self : globalThis);
