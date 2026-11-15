#!/usr/bin/env -S deno run --allow-net=api.github.com,raw.githubusercontent.com --allow-read=. --allow-write=.
// Replace src/vendor/video-swap-new.user.js with a copy from upstream.
//
//   deno run --allow-net=api.github.com,raw.githubusercontent.com --allow-read=. --allow-write=. scripts/update-twitch-vendor.mjs [options]
//
//   --check          report only; write nothing. Exit 1 when upstream differs.
//   --ref <ref>      branch, tag or commit to take the file from (default: the default branch)
//   --repo <o/n>     another upstream repository (default: the one in scripts/vendor-pins.json)
//   --path <path>    path of the userscript in that repository
//
// What it does:
//   1. finds the newest upstream commit that changed the file (at or before --ref);
//   2. downloads the file at that exact commit and checks that it is the userscript;
//   3. writes it byte for byte, and records commit, version and SHA-256 in scripts/vendor-pins.json;
//   4. updates the version text in the tests and docs listed in scripts/lib/twitch-vendor.mjs;
//   5. prints what changed.
// The downloaded file is untrusted data. This script reads it as text. It
// never imports, evals or runs it. It does not edit scripts/release-gate.sh,
// TODO.md or CHANGELOG.md.
// Exit codes: 0 done / up to date, 1 --check found a difference, 2 error (the message says if files were written),
// 3 written, but manual work is listed.
import {
  applyRules, DEFAULT_PATH, DEFAULT_REPO, GATE_NOTES, inspectUserscript, lineDelta, makePin, MAX_BYTES,
  PIN_FILE, pinJson, pinSites, printable, scanDelta, scanUserscript, sha256Hex, VENDOR_FILE,
} from "./lib/twitch-vendor.mjs";

const ROOT = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const KNOWN = new Set(["--check", "--ref", "--repo", "--path"]);
const args = Deno.args;
for (let i = 0; i < args.length; i++) {
  if (!KNOWN.has(args[i])) { console.error("Unknown option: " + args[i]); Deno.exit(2); }
  if (args[i] !== "--check") i++;
}
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const CHECK = args.includes("--check");
const written = []; // files written so far, for the error report

const readText = async (rel) => { try { return await Deno.readTextFile(ROOT + rel); } catch { return null; } };
const readBytes = async (rel) => { try { return await Deno.readFile(ROOT + rel); } catch { return null; } };

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { "User-Agent": "vendor-update-script", "Accept": accept },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error("GET " + url + " -> HTTP " + res.status);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("response too large: " + url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("response too large: " + url);
  return bytes;
}
const getJson = async (url) => JSON.parse(new TextDecoder().decode(await get(url, "application/vnd.github+json")));

async function main() {
  const oldPinText = await readText(PIN_FILE);
  const oldPin = oldPinText ? JSON.parse(oldPinText).twitch : null;
  const repo = opt("--repo") || oldPin?.repo || DEFAULT_REPO;
  const path = opt("--path") || oldPin?.path || DEFAULT_PATH;
  const ref = opt("--ref");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("--repo must be owner/name");
  if (!/^[\w./-]+$/.test(path) || path.includes("..")) throw new Error("--path has unexpected characters");
  if (ref !== undefined && !/^[\w./-]+$/.test(ref)) throw new Error("--ref has unexpected characters");

  // 1. Newest commit that changed the file. A ref is resolved to a full SHA
  //    first, so the download below is of one fixed commit.
  const q = new URLSearchParams({ path, per_page: "100" });
  if (ref) q.set("sha", ref);
  const commits = await getJson(`https://api.github.com/repos/${repo}/commits?${q}`);
  if (!Array.isArray(commits) || commits.length === 0) throw new Error("no upstream commit found for " + path);
  const commit = String(commits[0].sha);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("upstream returned a bad commit id");
  const commitDate = String(commits[0].commit?.committer?.date || "");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(commitDate)) throw new Error("upstream returned a bad commit date");
  let archived = null;
  try { archived = (await getJson(`https://api.github.com/repos/${repo}`)).archived === true; } catch { /* report as unknown */ }

  // 2. Download at that commit; validate as text only.
  const bytes = await get(`https://raw.githubusercontent.com/${repo}/${commit}/${path}`, "text/plain");
  const info = inspectUserscript(bytes, { repo });
  const sha256 = await sha256Hex(bytes);
  const scan = scanUserscript(info.text);
  const pin = makePin({ repo, path, commit, commitDate, version: info.version, conflictVersion: info.conflictVersion, sha256, bytes: bytes.length });

  const oldBytes = await readBytes(VENDOR_FILE);
  const oldSha = oldBytes ? await sha256Hex(oldBytes) : null;
  const oldInfo = oldBytes ? (() => { try { return inspectUserscript(oldBytes, { repo: DEFAULT_REPO }); } catch { return null; } })() : null;
  const oldScan = oldInfo ? scanUserscript(oldInfo.text) : null;
  const sameFile = oldSha === sha256;

  // 3 + 4. Work out every file's new content first; write only at the end.
  const { sites, manual } = pinSites(pin, scan);
  const writes = [];
  for (const site of sites) {
    const text = await readText(site.file);
    if (text === null) throw new Error("pin site is missing: " + site.file);
    const next = applyRules(site.file, text, site.rules);
    if (next !== text) writes.push({ file: site.file, text: next });
  }
  if (pinJson(pin) !== oldPinText) writes.push({ file: PIN_FILE, text: pinJson(pin) });

  // Licence: compared, never overwritten.
  try {
    const lic = new TextDecoder().decode(await get(`https://raw.githubusercontent.com/${repo}/${commit}/LICENSE`, "text/plain")).replace(/\r\n/g, "\n").trim();
    const ours = ((await readText("src/vendor/LICENSE-TwitchAdSolutions")) || "").replace(/\r\n/g, "\n").trim();
    if (lic !== ours) manual.push("src/vendor/LICENSE-TwitchAdSolutions differs from the upstream LICENSE at this commit; review it and copy it by hand");
  } catch (e) {
    manual.push("could not compare the upstream LICENSE (" + printable(e.message, 80) + "); check the licence by hand");
  }
  // Gate lines this script must not touch.
  const gateNotes = [];
  if (!sameFile) gateNotes.push(GATE_NOTES.frozen);
  if (oldPin && oldPin.conflict_version !== pin.conflict_version || (!oldPin && oldInfo && oldInfo.conflictVersion !== pin.conflict_version)) {
    gateNotes.push(GATE_NOTES.conflict + " now needs " + pin.conflict_version);
  }
  if (scan.gateMarkersMissing.length) gateNotes.push("section 6: marker text missing in the new file: " + scan.gateMarkersMissing.join(" | "));
  if (scan.evalNotAllowed.length) gateNotes.push("section 3: eval call(s) the gate does not allow, at line " + scan.evalNotAllowed.join(", "));
  if (scan.innerHtmlNotAllowed.length) gateNotes.push("section 3: innerHTML write(s) the gate does not allow, at line " + scan.innerHtmlNotAllowed.join(", "));
  for (const k of ["newFunction", "documentWrite", "importScripts", "extensionApi", "beaconRtcGeo"]) {
    if (scan[k]) gateNotes.push("sections 3/4: " + k + " = " + scan[k] + " (the gate wants 0)");
  }

  // 5. Report.
  const say = (s = "") => console.log(s);
  say("Twitch vendor file: " + VENDOR_FILE);
  say("  upstream   : https://github.com/" + repo + (archived === true ? "  (ARCHIVED: read-only, no more fixes)" : archived === null ? "  (archive state not known)" : ""));
  say("  vendored   : version " + (oldInfo?.version ?? "?") + ", conflict version " + (oldInfo?.conflictVersion ?? "?") + ", commit " + (oldPin?.commit ?? "not recorded"));
  say("             : sha256 " + (oldSha ?? "no file"));
  say("  upstream   : version " + pin.userscript_version + ", conflict version " + pin.conflict_version + ", commit " + commit + " (" + commitDate + ")");
  say("             : sha256 " + sha256 + ", " + bytes.length + " bytes");
  say("  result     : " + (sameFile ? "SAME BYTES (vendored copy is the upstream copy)" : "DIFFERENT"));
  if (!sameFile && oldInfo) {
    const d = lineDelta(oldInfo.text, info.text);
    say("  lines      : " + d.removed + " removed, " + d.added + " added (by content)");
    const sd = scanDelta(oldScan, scan);
    say("  text scan (old -> new; nothing was run):");
    for (const r of sd.rows) say("    " + r.item.padEnd(16) + String(r.before).padStart(5) + " -> " + String(r.after).padEnd(5) + (r.changed ? "  CHANGED" : ""));
    say("    hosts added    : " + (sd.hostsAdded.join(", ") || "none"));
    say("    hosts removed  : " + (sd.hostsRemoved.join(", ") || "none"));
    const at = oldPin ? commits.findIndex((c) => c.sha === oldPin.commit) : -1;
    const between = at > 0 ? commits.slice(0, at) : at === 0 ? [] : commits.slice(0, 10);
    say("  upstream commits " + (at >= 0 ? "since the recorded commit" : "(newest 10; the recorded commit is not an ancestor in this list)") + ":");
    for (const c of between) say("    " + String(c.sha).slice(0, 10) + " " + String(c.commit?.committer?.date || "").slice(0, 10) + " " + printable(c.commit?.message));
    if (!between.length) say("    none");
  }
  for (const w of info.warnings) say("  WARNING    : " + w);

  if (CHECK) {
    say();
    say(sameFile && writes.length === 0 ? "CHECK: up to date. Nothing to do." : "CHECK: " + (sameFile ? "the file is current, but " + writes.length + " pin text(s) are stale" : "upstream differs") + ". Nothing was written.");
    if (gateNotes.length) { say("Release gate lines an update would hit:"); for (const g of gateNotes) say("  - " + g); }
    return sameFile && writes.length === 0 ? 0 : 1;
  }

  if (!sameFile) { await Deno.writeFile(ROOT + VENDOR_FILE, bytes); written.push(VENDOR_FILE); }
  for (const w of writes) { await Deno.writeTextFile(ROOT + w.file, w.text); written.push(w.file); }
  say();
  if (sameFile && writes.length === 0) { say("Up to date. Nothing was written."); return 0; }
  say("Written:");
  if (!sameFile) say("  " + VENDOR_FILE);
  for (const w of writes) say("  " + w.file);
  if (gateNotes.length) {
    say();
    say("OWNER DECISION (scripts/release-gate.sh is not edited by this script):");
    for (const g of gateNotes) say("  - " + g);
  }
  if (manual.length) {
    say();
    say("MANUAL WORK:");
    for (const m of manual) say("  - " + m);
  }
  say();
  say("Next: run the tests and the release gate (docs/UPDATING-DEPENDENCIES.md). Tests that read the");
  say("vendored code (test/page.test.js, swap, bug, memory, reload, fixtures, playlist) can fail on a");
  say("real upstream change. Read each failure; do not edit the vendored file.");
  return manual.length ? 3 : 0;
}

try {
  Deno.exit(await main());
} catch (e) {
  if (written.length === 0) {
    console.error("ERROR (nothing was written): " + printable(e?.message ?? e, 300));
  } else {
    console.error("ERROR (INCOMPLETE UPDATE): " + printable(e?.message ?? e, 300));
    console.error("These files were already written: " + written.join(", "));
    console.error("The checkout is in a mixed state. Correct the cause and run the script again, or restore the files with git.");
  }
  Deno.exit(2);
}
