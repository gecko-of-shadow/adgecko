// CONCERNS M4: storage key strings are repeated in several files. popup.html
// may load only popup.js, so the popup keeps its own copy of the keys. A
// typing error in one file gives a silent read of `undefined`: the feature
// then uses its default, and no error shows. This test reads the source
// files, finds each storage key literal and checks it against the one known
// list below. `.planning/codebase/ARCHITECTURE.md` section 9 describes each
// key. Put a new key in KNOWN (or KNOWN_PREFIXES) and in that table.
function assert(c, l) { if (!c) throw new Error(l); }
const SRC = new URL("../src/", import.meta.url);

// chrome.storage.local, and `tabSignals` in chrome.storage.session.
const KNOWN = Object.freeze([
  "settings", "siteOverrides", "generalEnabled", "generalAllowedOrigins", "threatAllowDomains",
  "listState", "generalListRefresh", "generalListStatus", "generalListUpdatedAt", "generalListUpdateRequestAt",
  "cosG", "cosGF", "cosMeta", "ytStartTimes", "cosKeys", "feedState", "feedCache", "feedPaused",
  "popupFix", "popupWelcomed", "uiTheme", "tabSignals",
]);
// Keys with a variable part: listData:<list>, cosS:<host>, cosE:<host>, cosNoG:<host>.
const KNOWN_PREFIXES = Object.freeze(["listData:", "cosS:", "cosE:", "cosNoG:"]);

// Constants with a key-like name that hold no storage key.
const NOT_STORAGE = Object.freeze({
  "youtube.js WATCH_AD_KEYS": "fields of a YouTube player response",
  "general/filter-options.js DOCUMENT_KEY": "a rule signature",
  "feed/schema.js ENTRY_KEYS": "fields of a feed entry",
  "feed/schema.js KILL_KEYS": "fields of a kill document",
});

// ---- the scanner ----
// A line comment starts at "//" after a space or at the line start, so a
// URL in a string ("https://") stays.
const dropLineComments = (text) => text.split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

// The text from `open` (the index of "[" or "{") to its matching bracket.
function block(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("[{(".includes(c)) depth++;
    else if ("]})".includes(c) && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

// The comma-separated parts of a block, at its own level only.
function parts(blockText) {
  const inner = blockText.slice(1, -1);
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("[{(".includes(c)) depth++;
    else if ("]})".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((p) => p.trim()).filter(Boolean);
}

const strings = (text) => [...text.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map((m) => m[1] ?? m[2]);
// The property name of an object part: `key: v`, `"key": v` or shorthand
// `key`. Computed (`[KEYS.x]: v`) and spread parts give null: their keys
// come from constants, which this scanner reads too.
function propName(part) {
  const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(part);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

// Every storage key in one source file: [{ key, prefix, where }].
function storageKeys(file, source) {
  const text = dropLineComments(source);
  const found = [];
  const line = (i) => file + ":" + text.slice(0, i).split("\n").length;
  const add = (key, i, prefix = false) => found.push({ key, prefix, where: line(i) });
  // Key constants: NAME_KEY, NAME_KEYS, KEYS, KEY_NAME, NAME_PREFIX, PREFIX_NAME.
  for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(?:Object\.freeze\(\s*)?(["'[{])/g)) {
    const name = m[1];
    if (!/(^|_)KEYS?$|_PREFIX$|^PREFIX_|^KEY_/.test(name) || NOT_STORAGE[file + " " + name]) continue;
    const i = m.index + m[0].length - 1;
    const prefix = /_PREFIX$|^PREFIX_/.test(name);
    if (m[2] === "[") for (const s of strings(block(text, i))) add(s, i, prefix);
    else if (m[2] === "{") {
      for (const p of parts(block(text, i))) {
        const v = /:\s*(?:"([^"]*)"|'([^']*)')$/.exec(p);
        if (v) add(v[1] ?? v[2], i, prefix);
      }
    } else add(/^(?:"([^"]*)"|'([^']*)')/.exec(text.slice(i)).slice(1).find((x) => x !== undefined), i, prefix);
  }
  // The default values: each property name is a key.
  for (const m of text.matchAll(/\bconst\s+DEFAULTS\s*=\s*\{/g)) {
    const i = m.index + m[0].length - 1;
    for (const p of parts(block(text, i))) {
      const k = propName(p);
      if (k) add(k, i);
    }
  }
  // Reads and removes with a literal list.
  for (const m of text.matchAll(/\b(?:get|localGet|remove|localRemove)\(\s*\[/g)) {
    const i = m.index + m[0].length - 1;
    for (const s of strings(block(text, i))) add(s, i);
  }
  // Writes with a literal object.
  for (const m of text.matchAll(/\b(?:set|localSet|save)\(\s*\{/g)) {
    const i = m.index + m[0].length - 1;
    for (const p of parts(block(text, i))) {
      const k = propName(p);
      if (k) add(k, i);
    }
  }
  // storage.onChanged records: changes.key, changes["key"].
  for (const m of text.matchAll(/\bchanges(?:\.([A-Za-z_$][\w$]*)|\[\s*(?:"([^"]+)"|'([^']+)')\s*\])/g)) {
    add(m[1] ?? m[2] ?? m[3], m.index);
  }
  return found;
}

function unknown(found) {
  return found.filter(({ key, prefix }) => (prefix ? !KNOWN_PREFIXES.includes(key) : !KNOWN.includes(key) && !KNOWN_PREFIXES.some((p) => key.startsWith(p))));
}

function sourceFiles(dir = SRC, rel = "") {
  const out = [];
  for (const e of Deno.readDirSync(dir)) {
    const r = rel + e.name;
    if (e.isDirectory) {
      if (r !== "vendor") out.push(...sourceFiles(new URL(e.name + "/", dir), r + "/"));
    } else if (e.name.endsWith(".js")) out.push(r);
  }
  return out.sort();
}

function scanAll() {
  const all = [];
  for (const f of sourceFiles()) all.push(...storageKeys(f, Deno.readTextFileSync(new URL(f, SRC))));
  return all;
}

Deno.test("storage keys: each key literal in src/ is in the one known list", () => {
  const found = scanAll();
  const bad = unknown(found);
  assert(!bad.length, "unknown storage keys (a typing error, or add the key to KNOWN and to ARCHITECTURE.md section 9): " + bad.map((b) => b.key + " at " + b.where).join(", "));
  // The scanner reads every place that names a key: the popup's own copy,
  // the settings page, the worker, the content scripts and the shared tables.
  const files = new Set(found.map((f) => f.where.split(":")[0]));
  for (const f of ["popup.js", "settings.js", "general-background.js", "cosmetic.js", "settings/flags.js", "twitch-directory-ads.js", "general-settings.js", "general/cosmetic-parse.js", "feed/client.js"]) {
    assert(files.has(f), "the scanner found no key in " + f);
  }
});

Deno.test("storage keys: each known key is still used (no stale entry in the list)", () => {
  const found = scanAll();
  const keys = new Set(found.filter((f) => !f.prefix).map((f) => f.key));
  const prefixes = new Set(found.filter((f) => f.prefix).map((f) => f.key));
  const stale = KNOWN.filter((k) => !keys.has(k)).concat(KNOWN_PREFIXES.filter((p) => !prefixes.has(p)));
  assert(!stale.length, "known keys that no source file names: " + stale.join(", "));
});

Deno.test("storage keys: the scanner finds a typing error in each form", () => {
  const sample = [
    'const LIST_STATE_KEY = "listSate";',
    'const KEYS = { overrides: "siteOverride" }; // "settinsg" in a comment is not code',
    'const OTHER_KEYS = Object.freeze(["uiTheem"]);',
    "const PREFIX_SITE = 'cosX:';",
    "const DEFAULTS = { generalListStatsu: '' };",
    'chrome.storage.local.get(["setings"], () => {});',
    'await localRemove(["feedCahce"]);',
    "chrome.storage.local.set({ popupFixx: 1, [KEYS.theme]: 2 });",
    "await localSet({ threatAllowDomain });",
    'if (changes.generalEnable || changes["cosMta"]) apply();',
  ].join("\n");
  const bad = unknown(storageKeys("sample.js", sample)).map((b) => b.key);
  assert(JSON.stringify(bad) === JSON.stringify(["listSate", "siteOverride", "uiTheem", "cosX:", "generalListStatsu", "setings", "feedCahce", "popupFixx", "threatAllowDomain", "generalEnable", "cosMta"]), JSON.stringify(bad));
  const good = 'const KEYS = { settings: "settings" }; chrome.storage.local.get(["siteOverrides", "listData:easylist"]); if (changes.cosMeta) x();';
  assert(unknown(storageKeys("good.js", good)).length === 0, "known keys and a known prefix pass");
});
