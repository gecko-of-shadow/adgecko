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
  // Parenthesis nesting limit. EasyList and EasyPrivacy use depth 2 at most
  // (2026-11). Deeper nesting has no use and only costs parse time.
  const MAX_SELECTOR_DEPTH = 8;
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
      else if (ch === "(") {
        paren += 1;
        if (paren > MAX_SELECTOR_DEPTH) return "";
      } else if (ch === ")") paren -= 1;
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
  // The memo (one per checked branch) keeps the cost linear in the nesting
  // depth: each :is-like level reduces its arguments for the scope check and
  // again for the output, which without the memo is 2^depth calls.
  function reduceSelector(m, forSubject, memo) {
    const key = (forSubject ? "1" : "0") + m;
    if (memo && memo.has(key)) return memo.get(key);
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
        const ok = splitTop(args, (c) => c === ",").every((b) => isScopedText(reduceSelector(b, false, memo)));
        if (ok) out += "(" + reduceSelector(args, forSubject, memo) + ")";
        continue;
      }
      if (!forSubject) out += "(" + reduceSelector(args, false, memo) + ")";
    }
    if (memo) memo.set(key, out);
    return out;
  }

  function isUnscopedBranch(m) {
    const memo = new Map();
    // Subject = last compound of the branch.
    // A namespace prefix ("*|html", "svg|body") does not change the element,
    // and "&" at the top level is :root. Both are normalized first.
    const compounds = splitTop(reduceSelector(m, true, memo), (c) => /[\s>+~]/.test(c)).filter(Boolean)
      .map((c) => c.replace(/^[^|:.#[]*\|/, "").replace(/&/g, ":root"));
    const subject = compounds[compounds.length - 1] || "";
    const ownScope = (c) => /[.#[]/.test(c) || CUSTOM_ELEMENT_RE.test(c);
    const isPageRoot = (c) => {
      const type = c.replace(/:[a-z-]+/gi, "").toLowerCase();
      return type === "html" || type === "body" || /:root\b/i.test(c);
    };
    if (!/[.#[]/.test(subject)) {
      const type = subject.replace(/:[a-z-]+/gi, "").toLowerCase();
      if (isPageRoot(subject)) return true;
      if ((type === "" || type === "*") && compounds.length === 1) return true;
    }
    // "html:has(.x) > *", ":root:has(.x) *": a branch that starts at the page
    // root needs a later part that is scoped itself (its own class, id or
    // attribute, also inside its own :has()/:is()). (".ad *" and
    // "div:has(.x) > *" stay: they start below the page root.)
    if (compounds.length > 1 && isPageRoot(compounds[0]) && !ownScope(compounds[0])) {
      const full = splitTop(reduceSelector(m, false, memo), (c) => /[\s>+~]/.test(c)).filter(Boolean);
      if (!full.slice(1).some(isScopedText)) return true;
    }
    return !isScopedText(reduceSelector(m, false, memo));
  }

  function isUnscopedSelector(sel) {
    return splitTop(maskSelector(String(sel || "")), (c) => c === ",").some(isUnscopedBranch);
  }

  function isPageRootSelector(sel) {
    return /^\s*(?:\*|html|body|:root)\s*$/i.test(String(sel || ""));
  }

  // "~a.com" also excludes every subdomain of a.com. Two generic rules with
  // the same selector both leave a host alone only when an exclusion of each
  // covers it: keep every host of either set that the other set covers.
  function intersectCoverage(prev, next) {
    const covers = (set, h) => [...set].some((p) => h === p || h.endsWith("." + p));
    const nextSet = new Set(next);
    const out = new Set();
    for (const h of nextSet) if (covers(prev, h)) out.add(h);
    for (const h of prev) if (covers(nextSet, h)) out.add(h);
    return out;
  }

  // Unicode (IDN) host -> punycode, as location.hostname reports it. A
  // trailing ".*" (any-TLD form) is kept apart from the conversion.
  function toAsciiHost(host) {
    if (!/[^\x00-\x7f]/.test(host)) return host;
    // Only host characters: never let "ü@evil.com" or "ü/x" parse as a URL.
    if (!/^[a-z0-9.*\u0080-\uffff-]+$/.test(host)) return "";
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

  // Page exceptions for element hiding (network exception syntax):
  //   @@||host^$generichide   (also $ghide)   no generic hide rules
  //   @@||host^$specifichide  (also $shide)   no site hide rules
  //   @@||host^$elemhide      (also $ehide)   neither
  // Kept forms: "||host^", "||host/", "://host/", "|http://host/", the
  // "://host:" port form, the "://192.168." IPv4 prefix form, and
  // "@@$generichide,domain=a.com|b.com". A path, a regex or any other option
  // makes the line one this parser does not model: it is ignored (the page
  // then keeps its hide rules, as before). Value per host: a bit mask.
  const NO_HIDE_GENERIC = 1;
  const NO_HIDE_SITE = 2;
  const NO_HIDE_OPTS = { generichide: 1, ghide: 1, specifichide: 2, shide: 2, elemhide: 3, ehide: 3 };
  // A list with more page exceptions than this is broken: the rest are ignored
  // (EasyList has about 170 in 2026-11).
  const MAX_NO_HIDE_HOSTS = 2000;
  const IPV4_PREFIX_RE = /^(?:\d{1,3}\.){1,3}$/;
  const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  // The host (or IPv4 prefix "a.b.") of a page-exception pattern, or "".
  function noHidePatternHost(pat) {
    let rest;
    if (pat.startsWith("||")) rest = pat.slice(2);
    else {
      const m = /^\|?(?:https?|\*)?:\/\/(.*)$/i.exec(pat);
      if (!m) return "";
      rest = m[1];
    }
    const m = /^([a-z0-9.*\u0080-\uffff-]+)(.*)$/i.exec(rest);
    if (!m) return "";
    const tail = m[2];
    if (IPV4_PREFIX_RE.test(m[1])) return tail === "" || tail === "*" ? m[1] : "";
    if (!/^(?::[0-9*]*)?[\^/|]*$/.test(tail)) return "";
    return normalizeHost(m[1]);
  }

  // { flags, hosts } for a page-exception line, else null.
  function parseNoHide(line) {
    if (!line.startsWith("@@")) return null;
    const at = line.lastIndexOf("$");
    if (at < 2) return null;
    let flags = 0;
    const domains = [];
    for (const raw of line.slice(at + 1).split(",")) {
      const opt = raw.trim().toLowerCase();
      if (NO_HIDE_OPTS[opt]) flags |= NO_HIDE_OPTS[opt];
      else if (opt.startsWith("domain=")) {
        for (const d of opt.slice(7).split("|")) {
          if (!d || d.startsWith("~")) continue;
          const h = normalizeHost(d);
          if (!h) return null;
          domains.push(h);
        }
      } else return null;
    }
    if (!flags) return null;
    const pat = line.slice(2, at);
    if (!pat) return domains.length ? { flags, hosts: domains } : null;
    if (domains.length) return null;
    const host = noHidePatternHost(pat);
    return host ? { flags, hosts: [host] } : null;
  }

  // Returns { generic: [sel], sites: {host: [sel]}, exceptions: {host: [sel]},
  //           genericExceptions: [sel], exclusions: {host: [sel]},
  //           noHide: {host: NO_HIDE_* mask}, stats }
  // opts.sitesOnly (AdGuard Base, `cosmetic: "sites"` in update.js SOURCES):
  // keep only rules scoped to a site (site.com##x, site.com#@#x). Generic
  // "##x", "~a.com##x" and "#@#x" are dropped. Reason: this parser models
  // only the host forms of the `$generichide` / `$elemhide` page exceptions
  // (see parseNoHide), not all of AdGuard's forms, so AdGuard's generic
  // selectors could hide things on sites AdGuard exempts. Page exceptions
  // (noHide) are kept for every list: they only remove hide rules.
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
    const noHide = new Map();
    const stats = { lines: 0, kept: 0, skipped: 0, unscopedGeneric: 0, pageRootSite: 0, genericDropped: 0, noHide: 0, noHideDropped: 0 };
    const add = (map, host, sel) => {
      let set = map.get(host);
      if (!set) map.set(host, (set = new Set()));
      set.add(sel);
    };
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === "!" || line[0] === "[") continue;
      const nh = line[0] === "@" ? parseNoHide(line) : null;
      if (nh) {
        for (const h of nh.hosts) {
          if (SKIP_HOST_RE.test(h)) continue;
          if (!noHide.has(h) && noHide.size >= MAX_NO_HIDE_HOSTS) {
            stats.noHideDropped += 1;
            continue;
          }
          noHide.set(h, (noHide.get(h) || 0) | nh.flags);
        }
        stats.noHide += 1;
        continue;
      }
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
        else genericExcl.set(sel, prev ? intersectCoverage(prev, exclude) : new Set(exclude));
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
      noHide: Object.fromEntries(noHide),
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
    const noHide = {};
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
      for (const [h, f] of Object.entries(p.noHide || {})) noHide[h] = (noHide[h] | 0) | (f | 0);
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
    return { generic: Array.from(generic), sites, exceptions, exclusions, noHide };
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

  // Lookup keys for page exceptions: candidateHosts, the host itself (also a
  // one-label host such as "localhost") and, for an IPv4 host, its prefixes
  // ("192.", "192.168.", "192.168.1.").
  function noHideHosts(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    const out = new Set(candidateHosts(host));
    if (host) out.add(host);
    if (IPV4_RE.test(host)) {
      const p = host.split(".");
      for (let i = 1; i <= 3; i++) out.add(p.slice(0, i).join(".") + ".");
    }
    return Array.from(out);
  }

  const HIDE = "{display:none!important}";

  // Grouped form (group > 1): up to `group` selectors share one rule, joined
  // by GROUP_SEP. Chrome parses the 13,635 packed generics about 3 times
  // faster that way (4.8 ms -> 1.7 ms, 535 KB -> 214 KB of CSS). One invalid
  // selector drops its whole rule, so the content script checks the rule
  // count and splits a dropped group back (cosmetic.js fillSheet). A tab can
  // never be part of a selector (sanitizeSelector rejects control
  // characters), so ",\t" marks the joins exactly. Without `group`: one rule
  // per selector, as before.
  const GROUP_SEP = ",\t";

  function cssForSelectors(selectors, skip, group) {
    let css = "";
    let n = 0;
    for (const sel of selectors || []) {
      if (skip && skip.has(sel)) continue;
      if (group > 1) {
        css += (n % group ? GROUP_SEP : (n ? HIDE + "\n" : "")) + sel;
        n += 1;
      } else {
        css += sel + HIDE + "\n";
      }
    }
    return n ? css + HIDE + "\n" : css;
  }

  // Storage layout (chrome.storage.local): one key per host, so a page reads
  // only its own few keys plus the generic sheet.
  const KEY_GENERIC = "cosG";
  // Compact generic sheet for child frames: simple #id / .class selectors
  // no longer than FRAME_GENERIC_MAX_LEN. The full 13,635-selector sheet in
  // every frame doubled renderer CPU on a 40-frame page.
  const KEY_GENERIC_FRAME = "cosGF";
  const FRAME_GENERIC_MAX_LEN = 10;

  function frameGenericList(generic) {
    const out = [];
    for (const s of generic || []) {
      if (s.length > FRAME_GENERIC_MAX_LEN) continue;
      if ((s.charAt(0) === "#" || s.charAt(0) === ".") && /^[#.][A-Za-z_][\w-]*$/.test(s)) out.push(s);
    }
    return out;
  }

  // cosMeta stays small: every frame reads it (it gates the stored sheet, and
  // a change to it re-runs the content script). The full key list (about
  // 8,300 names) lives in cosKeys, which only the worker reads, for stale-key
  // cleanup. Before 0.3.5 the list was cosMeta.keys; the worker still reads it.
  const KEY_META = "cosMeta";
  const KEY_INDEX = "cosKeys";
  const PREFIX_SITE = "cosS:";
  const PREFIX_EXC = "cosE:";
  // Page exceptions ($generichide / $specifichide / $elemhide): one small key
  // per listed host, value = the NO_HIDE_* bit mask.
  const PREFIX_NO_HIDE = "cosNoG:";

  function toStorage(data, meta) {
    const items = {};
    // Generic selectors stored newline-joined (no rule text) to keep the
    // per-page read small; buildPageCss turns them into rules.
    items[KEY_GENERIC] = (data.generic || []).join("\n");
    const frameList = frameGenericList(data.generic);
    if (frameList.length) items[KEY_GENERIC_FRAME] = frameList.join("\n");
    for (const [h, sels] of Object.entries(data.sites || {})) items[PREFIX_SITE + h] = sels;
    for (const [h, sels] of Object.entries(data.exceptions || {})) items[PREFIX_EXC + h] = sels;
    for (const [h, f] of Object.entries(data.noHide || {})) if (f | 0) items[PREFIX_NO_HIDE + h] = f | 0;
    const m = Object.assign({}, meta || {});
    delete m.keys;
    items[KEY_META] = Object.assign({ count: Object.keys(items).length }, m);
    items[KEY_INDEX] = Object.keys(items).concat(KEY_INDEX);
    return items;
  }

  // topHost: in a child frame, the top site. Its page exceptions are read
  // too, so its $generichide can turn the frame sheet off.
  function keysForHost(hostname, withGeneric, topHost) {
    const keys = withGeneric === false ? [KEY_META, KEY_GENERIC_FRAME] : [KEY_GENERIC, KEY_META];
    for (const h of candidateHosts(hostname)) keys.push(PREFIX_SITE + h, PREFIX_EXC + h);
    const noHide = new Set(noHideHosts(hostname));
    if (withGeneric === false && topHost) for (const h of noHideHosts(topHost)) noHide.add(h);
    for (const h of noHide) keys.push(PREFIX_NO_HIDE + h);
    return keys;
  }

  // The NO_HIDE_* bits that apply to a host, from what storage returned.
  function noHideFlags(hostname, stored) {
    let noHide = 0;
    for (const h of noHideHosts(hostname)) noHide |= stored[PREFIX_NO_HIDE + h] | 0;
    return noHide;
  }

  // Build the page's stylesheet from what storage returned for keysForHost().
  function buildPageCss(hostname, stored, fallbackGenericCss, group) {
    const noHide = noHideFlags(hostname, stored);
    const exc = new Set();
    const siteSels = [];
    for (const h of candidateHosts(hostname)) {
      for (const s of stored[PREFIX_EXC + h] || []) exc.add(s);
      for (const s of stored[PREFIX_SITE + h] || []) siteSels.push(s);
    }
    let generic = "";
    if (noHide & NO_HIDE_GENERIC) {
      // $generichide: no generic rule, and no fallback sheet either.
    } else if (typeof stored[KEY_GENERIC] === "string" && stored[KEY_GENERIC]) {
      let list = stored[KEY_GENERIC];
      if (group > 1) {
        generic = cssForSelectors(list.split("\n").filter(Boolean), exc.size ? exc : null, group);
      } else {
        if (exc.size) list = list.split("\n").filter((sel) => !exc.has(sel)).join("\n");
        if (list) generic = list.replaceAll("\n", HIDE + "\n") + HIDE + "\n";
      }
    } else if (typeof stored[KEY_GENERIC_FRAME] === "string" && stored[KEY_GENERIC_FRAME]) {
      generic = cssForSelectors(stored[KEY_GENERIC_FRAME].split("\n").filter(Boolean), exc.size ? exc : null, group);
    } else if (fallbackGenericCss) {
      generic = fallbackGenericCss + "\n";
    }
    return generic + (noHide & NO_HIDE_SITE ? "" : cssForSelectors(siteSels, exc, group));
  }

  root.GeneralCosmeticParse = {
    MAX_SELECTOR_LEN, MAX_SELECTOR_DEPTH, KEY_GENERIC, KEY_GENERIC_FRAME, KEY_META, KEY_INDEX, PREFIX_SITE, PREFIX_EXC, PREFIX_NO_HIDE, HIDE,
    FRAME_GENERIC_MAX_LEN, frameGenericList,
    NO_HIDE_GENERIC, NO_HIDE_SITE, MAX_NO_HIDE_HOSTS, GROUP_SEP,
    sanitizeSelector, normalizeHost, isUnscopedSelector, isPageRootSelector, parseCosmetic, mergeCosmetic, candidateHosts, noHideHosts,
    cssForSelectors, toStorage, keysForHost, noHideFlags, buildPageCss,
  };
})(typeof self !== "undefined" ? self : globalThis);
