// Pure helpers for scripts/update-twitch-vendor.mjs (no network, no file I/O).
// The upstream userscript is DATA here: it is read as text and never run.
// Tested by test/vendor-pin.test.js.

export const PIN_FILE = "scripts/vendor-pins.json";
export const VENDOR_FILE = "src/vendor/video-swap-new.user.js";
export const DEFAULT_REPO = "pixeltris/TwitchAdSolutions";
export const DEFAULT_PATH = "video-swap-new/video-swap-new.user.js";
export const MAX_BYTES = 2_000_000;

// The release gate (scripts/release-gate.sh) is NOT edited by the update
// script. These are the gate lines an upstream change can break; the script
// only reports them.
export const GATE_NOTES = {
  frozen: "section 1b: the file must match origin/main (any update fails until it is on main)",
  conflict: "section 6: the literal \"ourTwitchAdSolutionsVersion = <n>\" (line 774)",
  markers: ["AD_SIGNIFIER = 'stitched-ad'", "function reloadTwitchPlayer"],
};

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Commit messages and other upstream strings are printed, never interpreted.
export function printable(text, max = 100) {
  // deno-lint-ignore no-control-regex
  const clean = String(text ?? "").split("\n")[0].replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 3) + "..." : clean;
}

/** Checks that the bytes are a video-swap-new userscript and reads its two version numbers. */
export function inspectUserscript(bytes, { repo = DEFAULT_REPO } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error("inspectUserscript wants bytes");
  if (bytes.length === 0) throw new Error("upstream file is empty");
  if (bytes.length > MAX_BYTES) throw new Error("upstream file is larger than " + MAX_BYTES + " bytes");
  // .gitattributes stores every text file with LF. A CR would be normalised
  // by git, and the recorded SHA-256 would then not match a fresh checkout.
  if (bytes.includes(13)) throw new Error("upstream file contains CR bytes; the byte-for-byte pin cannot hold");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("upstream file is not valid UTF-8");
  }
  const header = /^\/\/ ==UserScript==\n([\s\S]*?)\n\/\/ ==\/UserScript==\n/.exec(text);
  if (!header) throw new Error("upstream file does not start with a ==UserScript== header");
  const field = (name) => new RegExp("^// @" + name + "\\s+(.+)$", "m").exec(header[1])?.[1].trim();
  if (field("name") !== "TwitchAdSolutions (video-swap-new)") throw new Error("unexpected @name: " + printable(field("name")));
  const version = field("version");
  if (!version || !/^\d+(\.\d+){0,3}$/.test(version)) throw new Error("unexpected @version: " + printable(version));
  const conflict = /\bconst ourTwitchAdSolutionsVersion = (\d+);/.exec(text);
  if (!conflict) throw new Error("ourTwitchAdSolutionsVersion not found");
  const warnings = [];
  const namespace = field("namespace");
  if (namespace !== "https://github.com/" + DEFAULT_REPO) {
    warnings.push("@namespace is " + printable(namespace) + " (test/playlist.test.js expects https://github.com/" + DEFAULT_REPO + ")");
  }
  if (repo !== DEFAULT_REPO) warnings.push("upstream repository is " + repo + ", not " + DEFAULT_REPO + "; review the code and the licence before release");
  return { text, version, conflictVersion: Number(conflict[1]), warnings };
}

const lineOf = (lines, needle) => {
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(needle)) hits.push(i + 1); });
  return hits;
};

/**
 * Text-only scan of the things the release gate and the store notes care
 * about. Nothing is executed. The gate allow-lists are never changed from
 * this result; a human reads it.
 */
export function scanUserscript(text) {
  const lines = text.split("\n");
  const count = (re) => lines.reduce((n, l) => n + (re.test(l) ? 1 : 0), 0);
  const code = lines.filter((l) => !l.trimStart().startsWith("//"));
  const hosts = new Set();
  for (const l of code) for (const m of l.matchAll(/https?:\/\/[^\s"'`]+/g)) hosts.add(m[0].replace(/^https?:\/\//, "").split("/")[0].toLowerCase());
  const evalLines = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\beval\s*\(/.test(l));
  const htmlLines = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\.innerHTML\s*=/.test(l));
  return {
    lines: lines.length,
    evalCalls: evalLines.length,
    // The gate allows exactly these two shapes in this file (section 3).
    evalNotAllowed: evalLines.filter(([, l]) => !l.includes("eval(workerString)")).map(([n]) => n),
    innerHtmlWrites: htmlLines.length,
    innerHtmlNotAllowed: htmlLines.filter(([, l]) => !l.includes("adBlockDiv.innerHTML = ")).map(([n]) => n),
    newFunction: count(/new Function\s*\(/),
    documentWrite: count(/document\.write\s*\(/),
    importScripts: count(/importScripts\s*\(/),
    extensionApi: count(/\bchrome\.|\bbrowser\./),
    beaconRtcGeo: count(/navigator\.sendBeacon|geolocation|RTCPeerConnection/),
    hosts: [...hosts].sort(),
    evalWorkerLine: lineOf(lines, "eval(workerString)"),
    getWasmWorkerJsLine: lineOf(lines, "function getWasmWorkerJs("),
    gateMarkersMissing: GATE_NOTES.markers.filter((m) => !text.includes(m)),
  };
}

/** Lines only in the old text and lines only in the new text (by content). */
export function lineDelta(oldText, newText) {
  const bag = (t) => { const m = new Map(); for (const l of t.split("\n")) m.set(l, (m.get(l) || 0) + 1); return m; };
  const a = bag(oldText), b = bag(newText);
  let removed = 0, added = 0;
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0));
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0));
  return { removed, added };
}

export function scanDelta(before, after) {
  const out = [];
  for (const k of ["lines", "evalCalls", "innerHtmlWrites", "newFunction", "documentWrite", "importScripts", "extensionApi", "beaconRtcGeo"]) {
    out.push({ item: k, before: before[k], after: after[k], changed: before[k] !== after[k] });
  }
  const hostsAdded = after.hosts.filter((h) => !before.hosts.includes(h));
  const hostsRemoved = before.hosts.filter((h) => !after.hosts.includes(h));
  return { rows: out, hostsAdded, hostsRemoved };
}

// Every place outside the vendored file that names the version, the commit or
// a line number. Each rule MUST match, or the update stops before any file is
// written: a missing anchor means the pin site changed and needs a human.
// TODO.md and CHANGELOG.md are left alone on purpose (history / other work).
export function pinSites(pin, scan) {
  const conflict = [/ourTwitchAdSolutionsVersion = \d+/, "ourTwitchAdSolutionsVersion = " + pin.conflict_version];
  const sites = [
    { file: "test/page.test.js", rules: [
      [/\/\/ @version      [\w.]+"\), "userscript version [\w.]+"/, `// @version      ${pin.userscript_version}"), "userscript version ${pin.userscript_version}"`],
      conflict,
    ] },
    { file: "test/exclusions.test.js", rules: [conflict] },
    { file: "test/general-cosmetic-contract.test.js", rules: [conflict] },
    { file: "test/hardening.test.js", rules: [conflict] },
    { file: "src/vendor/README.md", rules: [
      [/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{40}\/\S+/, `https://github.com/${pin.repo}/blob/${pin.commit}/${pin.path}`],
      [/\(userscript v[\w.]+, ourTwitchAdSolutionsVersion \d+\)/, `(userscript v${pin.userscript_version}, ourTwitchAdSolutionsVersion ${pin.conflict_version})`],
    ] },
    { file: "docs/credits.md", rules: [[/video-swap-new v[\w.]+, MIT/, `video-swap-new v${pin.userscript_version}, MIT`]] },
    { file: "docs/how-it-works.md", rules: [[/\) v[\w.]+, copied unmodified/, `) v${pin.userscript_version}, copied unmodified`]] },
  ];
  const manual = [];
  const store = { file: "docs/STORE-REVIEW-NOTES.md", rules: [
    [/video-swap-new [\w.]+, vendored unchanged/, `video-swap-new ${pin.userscript_version}, vendored unchanged`],
  ] };
  // The store notes describe ONE eval call and where it is. Line numbers are
  // only rewritten while that description is still true.
  if (scan.evalCalls === 1 && scan.evalWorkerLine.length === 1 && scan.getWasmWorkerJsLine.length === 1) {
    store.rules.push([/call that runs, at line \d+/, "call that runs, at line " + scan.evalWorkerLine[0]]);
    store.rules.push([/`getWasmWorkerJs` \(line \d+\)/, "`getWasmWorkerJs` (line " + scan.getWasmWorkerJsLine[0] + ")"]);
  } else {
    manual.push("docs/STORE-REVIEW-NOTES.md: the eval description no longer fits (eval calls: " + scan.evalCalls + "); rewrite that section by hand");
  }
  sites.push(store);
  return { sites, manual };
}

/** Applies one site's rules to its text. Throws when a rule finds no anchor. */
export function applyRules(file, text, rules) {
  let out = text;
  for (const [re, to] of rules) {
    if (!re.test(out)) throw new Error("pin anchor not found in " + file + ": " + re.source);
    out = out.replace(re, () => to);
  }
  return out;
}

export function makePin({ repo, path, commit, commitDate, version, conflictVersion, sha256, bytes }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("commit must be a full 40-hex SHA");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo must be owner/name");
  return {
    file: VENDOR_FILE,
    repo,
    path,
    commit,
    commit_date: commitDate,
    userscript_version: version,
    conflict_version: conflictVersion,
    sha256,
    bytes,
  };
}

export const pinJson = (twitch) => JSON.stringify({
  _comment: "Written by scripts/update-twitch-vendor.mjs. Do not edit by hand. Checked by test/vendor-pin.test.js.",
  twitch,
}, null, 2) + "\n";
