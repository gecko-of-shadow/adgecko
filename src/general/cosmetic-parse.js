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
  // Stream sites keep their own handlers; never store rules for them.
  const SKIP_HOST_RE = /(?:^|\.)(?:twitch\.tv|youtube\.com|youtu\.be|youtube-nocookie\.com|youtubekids\.com|kick\.com)$/i;

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

  function normalizeHost(h) {
    const host = String(h || "").trim().toLowerCase().replace(/\.$/, "");
    if (!host || host.length > 253) return "";
    if (!/^[a-z0-9*][a-z0-9.*-]*$/.test(host)) return "";
    if (host.includes("*") && !/^[a-z0-9.-]+\.\*$/.test(host)) return ""; // only "name.*"
    return host;
  }

  const LINE_RE = /^([^#]*)(#@#|##|#\?#|#@\?#)(.+)$/;

  // Returns { generic: [sel], sites: {host: [sel]}, exceptions: {host: [sel]},
  //           genericExceptions: [sel], stats }
  function parseCosmetic(text) {
    const genericSet = new Set();
    const sites = new Map();
    const exceptions = new Map();
    const genericExceptions = new Set();
    const stats = { lines: 0, kept: 0, skipped: 0 };
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
      stats.kept += 1;
      if (isException) {
        if (!included.length) genericExceptions.add(sel);
        for (const h of included) add(exceptions, h, sel);
        continue;
      }
      if (!included.length) genericSet.add(sel);
      for (const h of included) add(sites, h, sel);
      // "~a.com##x" / "b.com,~a.b.com##x": the excluded host gets an exception.
      for (const h of exclude) add(exceptions, h, sel);
    }
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
      stats,
    };
  }

  function mergeCosmetic(parts) {
    const generic = new Set();
    const sites = {};
    const exceptions = {};
    const into = (dst, src) => {
      for (const [h, sels] of Object.entries(src || {})) {
        const set = new Set(dst[h] || []);
        for (const s of sels) set.add(s);
        dst[h] = Array.from(set);
      }
    };
    for (const p of parts) {
      for (const s of p.generic || []) generic.add(s);
      into(sites, p.sites);
      into(exceptions, p.exceptions);
    }
    return { generic: Array.from(generic), sites, exceptions };
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
  const KEY_META = "cosMeta";
  const PREFIX_SITE = "cosS:";
  const PREFIX_EXC = "cosE:";

  function toStorage(data, meta) {
    const items = {};
    // Generic selectors stored newline-joined (no rule text) to keep the
    // per-page read small; buildPageCss turns them into rules.
    items[KEY_GENERIC] = (data.generic || []).join("\n");
    for (const [h, sels] of Object.entries(data.sites || {})) items[PREFIX_SITE + h] = sels;
    for (const [h, sels] of Object.entries(data.exceptions || {})) items[PREFIX_EXC + h] = sels;
    items[KEY_META] = Object.assign({ keys: Object.keys(items) }, meta || {});
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
      generic = list.replaceAll("\n", HIDE + "\n") + HIDE + "\n";
    } else if (fallbackGenericCss) {
      generic = fallbackGenericCss + "\n";
    }
    return generic + cssForSelectors(siteSels, exc);
  }

  root.GeneralCosmeticParse = {
    MAX_SELECTOR_LEN, KEY_GENERIC, KEY_META, PREFIX_SITE, PREFIX_EXC, HIDE,
    sanitizeSelector, normalizeHost, parseCosmetic, mergeCosmetic, candidateHosts,
    cssForSelectors, toStorage, keysForHost, buildPageCss,
  };
})(typeof self !== "undefined" ? self : globalThis);
