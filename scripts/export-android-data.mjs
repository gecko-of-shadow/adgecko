#!/usr/bin/env -S deno run --no-lock --allow-read
// Export the Adgecko Shield data (docs/android/PLAN.md section 4.4) from the
// packed rules in src/rules/ and the real modules of src/.
//
//   deno run --no-lock --allow-read=<repo> --allow-write=<out> scripts/export-android-data.mjs --out <dir>
//   deno run --no-lock --allow-read=<repo> --allow-write=<file> scripts/export-android-data.mjs --samples <file>
//
// Offline: no network permission is necessary, and the script fetches
// nothing. Nothing that it writes is committed: Gradle writes it below
// android/**/build/ (ignored) and adds it to the APK assets.
//
// Two parts:
//   - buildShieldData(rootUrl): a pure builder. It returns a Map from output
//     path to bytes and writes nothing. test/android-data.test.js imports it
//     (the Deno suite has no write permission).
//   - a small CLI that writes the map (--out) or the real-data parity samples
//     (--samples) for the JVM tests of android/shield-core.
//
// The list filter has the meaning of the extension list tier (plan OD-10 (a)):
// whole-domain block rules (condition with requestDomains only), minus IP
// literals, minus the hosts that isNeverBlock() rejects. protectedReason() is
// not applied to list hosts, because the list tier leaves shared platforms to
// the lists (comment above localAddress() in src/general/update.js).
// The threat names are all threat rule hosts, minus IP literals, minus the
// hosts that protectedReason() rejects (0 today; a second check).
import { dnsDecision, formatCaseFile, isIpLiteral, prepareData, seededRandom, SELF_TEST_HOST } from "./lib/android-dns-policy.mjs";

export const OUTPUT_FILES = Object.freeze([
  "list-hosts.txt",
  "threat-hosts.txt",
  "never-block.json",
  "psl.json",
  "licenses/LICENSE",
  "licenses/LICENSES.md",
  "licenses/LICENSE-EasyList.txt",
  "licenses/CREDIT-EasyList.txt",
  "licenses/PSL-NOTICE.txt",
  "licenses/KOTLIN-NOTICE.txt",
]);
export const MANIFEST_FILE = "shield-manifest.json";
export const PROJECTION = "whole-domain-v1";

const KOTLIN_NOTICE = [
  "Kotlin Standard Library",
  "",
  "This app contains the Kotlin Standard Library (kotlin-stdlib).",
  "Copyright 2010-2026 JetBrains s.r.o. and Kotlin Programming Language contributors.",
  "",
  "Licensed under the Apache License, Version 2.0 (the \"License\");",
  "you may not use this file except in compliance with the License.",
  "You may obtain a copy of the License at",
  "",
  "    https://www.apache.org/licenses/LICENSE-2.0",
  "",
  "Unless required by applicable law or agreed to in writing, software",
  "distributed under the License is distributed on an \"AS IS\" BASIS,",
  "WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.",
  "See the License for the specific language governing permissions and",
  "limitations under the License.",
  "",
].join("\n");

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

// Load the real modules in the order of scripts/build-threat-rules.mjs. Each
// one sets a global. A second call imports nothing new.
export async function loadModules(rootUrl) {
  for (const p of [
    "src/threat/psl.js",
    "src/general/filter-options.js",
    "src/general/never-block-captcha.js",
    "src/general/update.js",
    "src/threat/protected-hosts.js",
    "src/threat/compile.js",
  ]) await import(new URL(p, rootUrl).href);
  const g = globalThis;
  if (!g.GeneralAdblockUpdate || !g.GeckoProtectedHosts || !g.GeckoPublicSuffix || !g.GeckoThreatCompile) {
    throw new Error("export-android-data: a src/ module did not load");
  }
  return { U: g.GeneralAdblockUpdate, PH: g.GeckoProtectedHosts, PS: g.GeckoPublicSuffix, TC: g.GeckoThreatCompile };
}

async function readText(rootUrl, path) {
  return dec.decode(await Deno.readFile(new URL(path, rootUrl)));
}

async function readJson(rootUrl, path) {
  return JSON.parse(await readText(rootUrl, path));
}

async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function checkAsciiHost(h, where) {
  if (!/^[\x21-\x7e]+$/.test(h)) throw new Error(`export-android-data: non-ASCII host in ${where} (IDN hosts need M2)`);
  return h.toLowerCase();
}

const lines = (arr) => (arr.length ? arr.join("\n") + "\n" : "");
const lineCount = (text) => (text.match(/\n/g) || []).length;

// Whole-domain list hosts: block rules whose condition has only requestDomains.
export function projectListHosts(generalRules, U) {
  const all = new Set();
  for (const r of generalRules) {
    if (!r || !r.action || r.action.type !== "block") continue;
    const keys = Object.keys(r.condition || {});
    if (keys.length !== 1 || keys[0] !== "requestDomains") continue;
    for (const h of r.condition.requestDomains) all.add(checkAsciiHost(h, "general-network.json"));
  }
  const out = [];
  for (const h of all) {
    if (isIpLiteral(h)) continue;
    if (U.isNeverBlock(h)) continue;
    out.push(h);
  }
  return out.sort();
}

export function projectThreatHosts(threatRules, PH) {
  const all = new Set();
  for (const r of threatRules) {
    if (!r || !r.action || r.action.type !== "block") continue;
    for (const h of (r.condition && r.condition.requestDomains) || []) all.add(checkAsciiHost(h, "threat-network.json"));
  }
  const out = [];
  for (const h of all) {
    if (isIpLiteral(h)) continue;
    if (PH.protectedReason(h) !== null) continue;
    out.push(h);
  }
  return out.sort();
}

// The header of src/threat/psl.js names the source, the licence and the
// version of the Public Suffix List data.
export function pslNotice(pslSource) {
  const head = [];
  for (const line of pslSource.split("\n")) {
    if (!line.startsWith("//")) break;
    head.push(line.replace(/^\/\/ ?/, ""));
  }
  const keep = head.filter((l) => /Public Suffix List|Mozilla Public License|VERSION|COMMIT/.test(l));
  return [
    "Public Suffix List data (subset)",
    "",
    ...keep,
    "",
    "The subset is in psl.json. It comes from src/threat/psl.js of the Adgecko",
    "source, which scripts/build-psl-subset.mjs generates.",
    "",
  ].join("\n");
}

function serialOf(packedAtUtc) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(String(packedAtUtc || ""));
  if (!m) throw new Error("export-android-data: meta.json packed_at_utc has no date");
  return Number(m[1] + m[2] + m[3] + m[4]);
}

// rootUrl: a file: URL of the repository root, with a trailing slash.
// Returns {files: Map<path, Uint8Array>, data: {list, threat, neverBlock}}.
export async function buildShieldData(rootUrl) {
  const { U, PH, PS } = await loadModules(rootUrl);
  const meta = await readJson(rootUrl, "src/rules/meta.json");
  const general = await readJson(rootUrl, "src/rules/general-network.json");
  const threatRules = await readJson(rootUrl, "src/rules/threat-network.json");

  const list = projectListHosts(general, U);
  const threat = projectThreatHosts(threatRules, PH);
  const neverBlock = { suffixes: meta.never_block_suffixes.slice(), except: U.NEVER_BLOCK_EXCEPTIONS.slice() };

  const files = new Map();
  files.set("list-hosts.txt", enc.encode(lines(list)));
  files.set("threat-hosts.txt", enc.encode(lines(threat)));
  files.set("never-block.json", enc.encode(JSON.stringify(neverBlock, null, 2) + "\n"));
  files.set("psl.json", enc.encode(JSON.stringify(PS.DATA) + "\n"));
  files.set("licenses/LICENSE", await Deno.readFile(new URL("LICENSE", rootUrl)));
  files.set("licenses/LICENSES.md", await Deno.readFile(new URL("src/rules/LICENSES.md", rootUrl)));
  files.set("licenses/LICENSE-EasyList.txt", await Deno.readFile(new URL("src/LICENSE-EasyList.txt", rootUrl)));
  files.set("licenses/CREDIT-EasyList.txt", await Deno.readFile(new URL("src/rules/CREDIT-EasyList.txt", rootUrl)));
  files.set("licenses/PSL-NOTICE.txt", enc.encode(pslNotice(await readText(rootUrl, "src/threat/psl.js"))));
  files.set("licenses/KOTLIN-NOTICE.txt", enc.encode(KOTLIN_NOTICE));

  const entries = [];
  for (const path of OUTPUT_FILES) {
    const bytes = files.get(path);
    entries.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.length, lines: lineCount(dec.decode(bytes)) });
  }
  const sources = Object.keys(meta.sources || {}).sort().map((id) => ({ id, sha256: meta.sources[id].sha256 }));
  const manifest = {
    format: 1,
    kind: "adgecko-shield-data",
    serial: serialOf(meta.packed_at_utc),
    packedAtUtc: meta.packed_at_utc,
    parserVersion: U.PARSER_VERSION,
    projection: PROJECTION,
    sources,
    files: entries,
  };
  files.set(MANIFEST_FILE, enc.encode(JSON.stringify(manifest, null, 2) + "\n"));
  return { files, data: { list, threat, neverBlock } };
}

// Real-data parity samples for the JVM tests (never committed: they contain
// list hosts). A fixed seed selects them. Each host runs in the three states.
export function buildSamples(data, seed = 20261117) {
  const rnd = seededRandom(seed);
  const pick = (arr, n) => {
    const out = [];
    for (let i = 0; i < n && arr.length; i++) out.push(arr[Math.floor(rnd() * arr.length)]);
    return out;
  };
  const parentOf = (h) => (h.split(".").length > 2 ? h.slice(h.indexOf(".") + 1) : h);
  const userAllow = [...new Set([...pick(data.list, 50), ...pick(data.threat, 5)])].sort();
  const hosts = new Set([SELF_TEST_HOST, "x." + SELF_TEST_HOST, "imasdk.googleapis.com", "a.imasdk.googleapis.com"]);
  let n = 0;
  for (const h of pick(data.list, 3000)) {
    hosts.add(h);
    hosts.add(parentOf(h));
    hosts.add(`c${n++}.${h}`);
  }
  for (const h of pick(data.threat, 1200)) {
    hosts.add(h);
    hosts.add(`t${n++}.${h}`);
  }
  for (const s of data.neverBlock.suffixes) {
    hosts.add(s);
    hosts.add(`n${n++}.${s}`);
    hosts.add(`x${s}`);
  }
  for (const h of pick(data.list, 600)) hosts.add(`x${h}`);
  for (const h of pick(data.threat, 200)) hosts.add(`x${h}`);
  for (let i = 0; i < 300; i++) hosts.add(`neg${i}.shield.test`);
  for (const h of userAllow) {
    hosts.add(h);
    hosts.add(`u${n++}.${h}`);
  }
  const prepared = prepareData({ ...data, userAllow });
  const states = [
    { mode: "ads+threat", paused: false },
    { mode: "ads+threat", paused: true },
    { mode: "threat-only", paused: false },
  ];
  const cases = [];
  for (const host of [...hosts].sort()) {
    for (const state of states) {
      const r = dnsDecision(host, prepared, state);
      cases.push({ host, mode: state.mode, paused: state.paused, action: r.action, layer: r.layer });
    }
  }
  return { format: 1, kind: "adgecko-shield-samples", seed, userAllow, cases };
}

function arg(args, k) {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
}

if (import.meta.main) {
  const args = Deno.args;
  const out = arg(args, "--out");
  const samples = arg(args, "--samples");
  if (!out && !samples) {
    console.error("usage: export-android-data.mjs [--out <dir>] [--samples <file>]");
    Deno.exit(2);
  }
  const rootUrl = new URL("..", import.meta.url);
  const built = await buildShieldData(rootUrl);
  if (out) {
    const dir = out.replace(/\\/g, "/").replace(/\/?$/, "/");
    for (const [path, bytes] of built.files) {
      const full = dir + path;
      await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
      await Deno.writeFile(full, bytes);
    }
    console.log(`export-android-data: ${built.files.size} files, ${built.data.list.length} list hosts, ${built.data.threat.length} threat names`);
  }
  if (samples) {
    const s = buildSamples(built.data);
    const p = samples.replace(/\\/g, "/");
    if (p.includes("/")) await Deno.mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(p, formatCaseFile(s));
    console.log(`export-android-data: ${s.cases.length} samples`);
  }
}
