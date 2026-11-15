// The Twitch vendor pin (scripts/vendor-pins.json) and the update script's
// pure helpers (scripts/lib/twitch-vendor.mjs). No network: the pin is checked
// against the files in the checkout.
import pins from "../scripts/vendor-pins.json" with { type: "json" };
import {
  applyRules, inspectUserscript, lineDelta, makePin, pinJson, pinSites, printable, scanUserscript, sha256Hex, VENDOR_FILE,
} from "../scripts/lib/twitch-vendor.mjs";

const ROOT = new URL("..", import.meta.url);
const bytes = await Deno.readFile(new URL(VENDOR_FILE, ROOT));
const read = (rel) => Deno.readTextFile(new URL(rel, ROOT));
function assert(c, l) { if (!c) throw new Error(l || "assertion failed"); }
function throws(fn, part) {
  try { fn(); } catch (e) { assert(String(e.message).includes(part), "wrong error: " + e.message); return; }
  throw new Error("expected an error with: " + part);
}
const pin = pins.twitch;
const enc = (s) => new TextEncoder().encode(s);

Deno.test("vendored Twitch file is byte for byte the pinned upstream file", async () => {
  assert(pin.file === VENDOR_FILE, "pin names the vendored file");
  assert(bytes.length === pin.bytes, "size " + bytes.length + " != pin " + pin.bytes);
  assert(await sha256Hex(bytes) === pin.sha256, "SHA-256 differs from scripts/vendor-pins.json: the file was edited, or the pin is stale. Run scripts/update-twitch-vendor.mjs");
  const info = inspectUserscript(bytes, { repo: pin.repo });
  assert(info.version === pin.userscript_version, "userscript version");
  assert(info.conflictVersion === pin.conflict_version, "conflict version");
  assert(/^[0-9a-f]{40}$/.test(pin.commit) && /^\d{4}-\d\d-\d\dT[\d:]+Z$/.test(pin.commit_date), "commit and date recorded");
});

Deno.test("every pin site agrees with the pin (the update script would change nothing)", async () => {
  const { sites, manual } = pinSites(pin, scanUserscript(new TextDecoder().decode(bytes)));
  assert(manual.length === 0, "manual work pending: " + manual.join("; "));
  for (const site of sites) {
    const text = await read(site.file);
    assert(applyRules(site.file, text, site.rules) === text, site.file + " does not match the pin");
  }
  assert(pinJson(pin) === await read("scripts/vendor-pins.json"), "pin file is in the script's own format");
  // The release gate is not edited by the script; its literal must still agree.
  assert((await read("scripts/release-gate.sh")).includes('"ourTwitchAdSolutionsVersion = ' + pin.conflict_version + '"'), "release gate section 6 literal");
});

Deno.test("pin sites: a new version rewrites every site; a lost anchor stops the update", async () => {
  const next = makePin({ repo: "someone/Fork", path: "a/b.user.js", commit: "a".repeat(40), commitDate: "2027-01-02T03:04:05Z", version: "2.0", conflictVersion: 31, sha256: "0".repeat(64), bytes: 1 });
  const scan = { evalCalls: 1, evalWorkerLine: [180], getWasmWorkerJsLine: [222] };
  const { sites, manual } = pinSites(next, scan);
  assert(manual.length === 0, "no manual work");
  const out = {};
  for (const site of sites) out[site.file] = applyRules(site.file, await read(site.file), site.rules);
  assert(out["test/page.test.js"].includes('"// @version      2.0"), "userscript version 2.0"') && out["test/page.test.js"].includes("ourTwitchAdSolutionsVersion = 31"), "page test");
  for (const f of ["test/exclusions.test.js", "test/general-cosmetic-contract.test.js", "test/hardening.test.js"]) {
    assert(out[f].includes("ourTwitchAdSolutionsVersion = 31") && !out[f].includes("ourTwitchAdSolutionsVersion = " + pin.conflict_version), f);
  }
  assert(out["src/vendor/README.md"].includes("https://github.com/someone/Fork/blob/" + "a".repeat(40) + "/a/b.user.js") && out["src/vendor/README.md"].includes("(userscript v2.0, ourTwitchAdSolutionsVersion 31)"), "vendor README");
  assert(out["docs/STORE-REVIEW-NOTES.md"].includes("video-swap-new 2.0, vendored unchanged") && out["docs/STORE-REVIEW-NOTES.md"].includes("at line 180") && out["docs/STORE-REVIEW-NOTES.md"].includes("(line 222)"), "store notes");
  assert(out["docs/credits.md"].includes("video-swap-new v2.0, MIT") && out["docs/how-it-works.md"].includes(") v2.0, copied unmodified"), "docs");
  throws(() => applyRules("x.md", "no anchor here", sites[0].rules), "pin anchor not found in x.md");
  // A second eval call: the store notes are left for a human.
  const two = pinSites(next, { evalCalls: 2, evalWorkerLine: [1], getWasmWorkerJsLine: [2] });
  assert(two.manual.length === 1 && two.manual[0].includes("STORE-REVIEW-NOTES"), "manual note");
  assert(two.sites.at(-1).rules.length === 1, "line numbers not rewritten");
});

Deno.test("inspectUserscript: only a real video-swap-new userscript passes, as text", () => {
  const good = "// ==UserScript==\n// @name         TwitchAdSolutions (video-swap-new)\n// @namespace    https://github.com/pixeltris/TwitchAdSolutions\n// @version      9.1\n// ==/UserScript==\n(function() {\n    const ourTwitchAdSolutionsVersion = 40;\n})();\n";
  const info = inspectUserscript(enc(good));
  assert(info.version === "9.1" && info.conflictVersion === 40 && info.warnings.length === 0, "parsed");
  throws(() => inspectUserscript(enc(good.replace(/\n/g, "\r\n"))), "CR bytes");
  throws(() => inspectUserscript(enc("<html>404</html>")), "==UserScript== header");
  throws(() => inspectUserscript(enc(good.replace("(video-swap-new)", "(vaft)"))), "unexpected @name");
  throws(() => inspectUserscript(enc(good.replace("9.1", "9.1; evil"))), "unexpected @version");
  throws(() => inspectUserscript(enc(good.replace("ourTwitchAdSolutionsVersion = 40", "x = 1"))), "ourTwitchAdSolutionsVersion not found");
  throws(() => inspectUserscript(new Uint8Array([0x2f, 0x2f, 0xff, 0xfe])), "not valid UTF-8");
  throws(() => inspectUserscript(new Uint8Array(0)), "empty");
  assert(inspectUserscript(enc(good), { repo: "someone/Fork" }).warnings.length === 1, "other upstream is a warning");
  assert(inspectUserscript(enc(good.replace("pixeltris", "someone"))).warnings.length === 1, "other namespace is a warning");
  throws(() => makePin({ repo: "a/b", path: "p", commit: "master", commitDate: "", version: "1", conflictVersion: 1, sha256: "", bytes: 0 }), "40-hex");
});

Deno.test("scanUserscript: the shipped file has exactly the two shapes the gate allows", () => {
  const scan = scanUserscript(new TextDecoder().decode(bytes));
  assert(scan.evalCalls === 1 && scan.evalNotAllowed.length === 0, "one allowed eval");
  assert(scan.innerHtmlWrites === 1 && scan.innerHtmlNotAllowed.length === 0, "one allowed innerHTML write");
  assert(scan.newFunction === 0 && scan.documentWrite === 0 && scan.importScripts === 0 && scan.extensionApi === 0 && scan.beaconRtcGeo === 0, "no other gated API");
  assert(scan.gateMarkersMissing.length === 0, "gate markers present");
  assert(scan.hosts.every((h) => /(^|\.)(twitch\.tv|ttvnw\.net)$/.test(h)), "hosts: " + scan.hosts.join(","));
  const bad = scanUserscript("eval(x);\nel.innerHTML = y;\nnew Function(z);\n// eval(workerString) in a comment still counts\nfetch('https://evil.example/a');\n");
  assert(bad.evalNotAllowed.join() === "1" && bad.innerHtmlNotAllowed.join() === "2" && bad.newFunction === 1, "flagged lines");
  assert(bad.hosts.join() === "evil.example" && bad.gateMarkersMissing.length === 2, "hosts and markers");
  const d = lineDelta("a\nb\nb\nc", "a\nb\nd");
  assert(d.removed === 2 && d.added === 1, "line delta");
  assert(printable("fix‮ bug\u0007\nsecond line") === "fix  bug" && printable("x".repeat(200)).length === 100, "printable");
});
