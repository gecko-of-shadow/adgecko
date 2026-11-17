// Adgecko Shield data export (docs/android/PLAN.md sections 4.4 and 6.5, A3,
// A6). The export script has a pure builder, so this test needs no write
// permission and no child process.
//
// The counts are computed here from the packed JSON files with the same
// filter, so a repack changes the expected values automatically. A range
// check catches an empty or a broken output.
import { buildSamples, buildShieldData, loadModules, MANIFEST_FILE, OUTPUT_FILES } from "../scripts/export-android-data.mjs";
import { dnsDecision, isIpLiteral, prepareData, SELF_TEST_HOST } from "../scripts/lib/android-dns-policy.mjs";
import { evaluate } from "./fixtures/dnr-matcher.js";
import meta from "../src/rules/meta.json" with { type: "json" };
import general from "../src/rules/general-network.json" with { type: "json" };
import threatRules from "../src/rules/threat-network.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const ROOT = new URL("..", import.meta.url);
const dec = new TextDecoder();
const { U, PH } = await loadModules(ROOT);
const first = await buildShieldData(ROOT);
const text = (path) => dec.decode(first.files.get(path));
const listHosts = text("list-hosts.txt").split("\n").filter(Boolean);
const threatHosts = text("threat-hosts.txt").split("\n").filter(Boolean);
const listSet = new Set(listHosts);
const threatSet = new Set(threatHosts);
const neverBlock = JSON.parse(text("never-block.json"));
const manifest = JSON.parse(text(MANIFEST_FILE));
const samples = buildSamples(first.data);

Deno.test("android export: two builds give the same bytes", async () => {
  const second = await buildShieldData(ROOT);
  assert(first.files.size === second.files.size, `file count ${first.files.size} != ${second.files.size}`);
  for (const [path, bytes] of first.files) {
    const other = second.files.get(path);
    assert(other && other.length === bytes.length && other.every((b, i) => b === bytes[i]), `${path} differs between two builds`);
  }
  assert([...first.files.keys()].sort().join() === [...OUTPUT_FILES, MANIFEST_FILE].sort().join(), "unexpected output file set");
});

Deno.test("android export: list and threat counts equal the filter applied to the packed JSON", () => {
  const list = new Set();
  for (const r of general) {
    const keys = Object.keys(r.condition || {});
    if (r.action.type === "block" && keys.length === 1 && keys[0] === "requestDomains") for (const h of r.condition.requestDomains) list.add(h);
  }
  const expectedList = [...list].filter((h) => !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !U.isNeverBlock(h)).length;
  const threat = new Set(threatRules.flatMap((r) => r.condition.requestDomains));
  const expectedThreat = [...threat].filter((h) => !/^\d+\.\d+\.\d+\.\d+$/.test(h) && PH.protectedReason(h) === null).length;
  console.log(`android export: ${listHosts.length} list hosts, ${threatHosts.length} threat names`);
  assert(listHosts.length === expectedList, `list hosts ${listHosts.length} != ${expectedList}`);
  assert(threatHosts.length === expectedThreat, `threat names ${threatHosts.length} != ${expectedThreat}`);
  assert(listHosts.length >= 185000 && listHosts.length <= 205000, `list host count out of range: ${listHosts.length}`);
  assert(threatHosts.length >= 10000 && threatHosts.length <= 20000, `threat name count out of range: ${threatHosts.length}`);
  assert(listSet.size === listHosts.length && threatSet.size === threatHosts.length, "duplicate lines");
  for (const arr of [listHosts, threatHosts]) {
    for (let i = 1; i < arr.length; i++) assert(arr[i - 1] < arr[i], `not sorted at ${arr[i]}`);
  }
});

Deno.test("android export: host files are lower-case ASCII, LF, with no IP literal", () => {
  for (const path of ["list-hosts.txt", "threat-hosts.txt"]) {
    const t = text(path);
    assert(!t.includes("\r"), `${path} has CR`);
    assert(t.endsWith("\n"), `${path} has no final LF`);
    for (const h of t.split("\n").filter(Boolean)) {
      assert(/^[a-z0-9._-]+$/.test(h), `${path}: bad host line ${JSON.stringify(h)}`);
      assert(!isIpLiteral(h), `${path}: IP literal ${h}`);
    }
  }
});

Deno.test("android export: no threat name is a protected host", () => {
  const bad = threatHosts.filter((h) => PH.protectedReason(h) !== null);
  assert(bad.length === 0, `protected threat names: ${bad.slice(0, 5).join(", ")}`);
});

Deno.test("android export: the imasdk and ads.twitch.tv cases", () => {
  assert(listSet.has("imasdk.googleapis.com"), "imasdk.googleapis.com must be a list host");
  assert(!U.isNeverBlock("imasdk.googleapis.com"), "imasdk.googleapis.com must not be never-block");
  assert(!listSet.has("ads.twitch.tv"), "ads.twitch.tv must not be a list host (it follows isNeverBlock())");
  const d = prepareData({ ...first.data, userAllow: [] });
  const r = dnsDecision("imasdk.googleapis.com", d, { mode: "ads+threat", paused: false });
  assert(r.action === "BLOCK" && r.layer === "LIST", `imasdk decision ${JSON.stringify(r)}`);
  const y = dnsDecision("youtubei.googleapis.com", d, { mode: "ads+threat", paused: false });
  assert(y.action === "FORWARD" && y.layer === "NEVER_BLOCK", `youtubei decision ${JSON.stringify(y)}`);
});

Deno.test("android export: never-block.json equals meta.json and NEVER_BLOCK_EXCEPTIONS, and the model equals isNeverBlock()", () => {
  assert(JSON.stringify(neverBlock.suffixes) === JSON.stringify(meta.never_block_suffixes), "suffixes differ from meta.json");
  assert(neverBlock.suffixes.length === 21, `suffix count ${neverBlock.suffixes.length}`);
  assert(JSON.stringify(neverBlock.except) === JSON.stringify(U.NEVER_BLOCK_EXCEPTIONS), "except differs from NEVER_BLOCK_EXCEPTIONS");
  assert(neverBlock.except.includes("imasdk.googleapis.com"), "except must hold imasdk.googleapis.com");
  const d = prepareData({ list: [], threat: [], userAllow: [], neverBlock });
  let n = 0;
  for (const c of samples.cases) {
    if (c.mode !== "ads+threat" || c.paused) continue;
    const model = dnsDecision(c.host, d, { mode: "ads+threat", paused: false }).layer === "NEVER_BLOCK";
    assert(model === U.isNeverBlock(c.host), `never-block model differs from isNeverBlock() for ${c.host}`);
    n++;
  }
  assert(n > 5000, `too few sample hosts: ${n}`);
});

Deno.test("android export: the hosts of static rules 1 to 3 are below a never-block suffix", () => {
  const hosts = general.slice(0, 3).flatMap((r) => r.condition.requestDomains);
  assert(hosts.length === 13, `rules 1 to 3 have ${hosts.length} hosts, expected 13`);
  for (const h of hosts) assert(U.isNeverBlock(h), `${h} of rules 1 to 3 is not below a never-block suffix`);
});

Deno.test("android export: manifest fields equal meta.json and the file bytes", async () => {
  assert(manifest.format === 1 && manifest.kind === "adgecko-shield-data", "manifest kind");
  assert(manifest.packedAtUtc === meta.packed_at_utc, "packedAtUtc differs from meta.json");
  assert(String(manifest.serial) === meta.packed_at_utc.slice(0, 13).replace(/[-T]/g, ""), `serial ${manifest.serial}`);
  assert(manifest.parserVersion === U.PARSER_VERSION, "parserVersion");
  assert(manifest.projection === "whole-domain-v1", "projection");
  const ids = Object.keys(meta.sources).sort();
  assert(JSON.stringify(manifest.sources.map((s) => s.id)) === JSON.stringify(ids), "source ids");
  for (const s of manifest.sources) assert(s.sha256 === meta.sources[s.id].sha256, `sha256 of ${s.id}`);
  assert(manifest.files.length === OUTPUT_FILES.length, "manifest file count");
  for (const f of manifest.files) {
    const bytes = first.files.get(f.path);
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    assert(f.sha256 === hex && f.bytes === bytes.length, `manifest entry of ${f.path}`);
  }
  const lic = await Deno.readFile(new URL("LICENSE", ROOT));
  assert(first.files.get("licenses/LICENSE").length === lic.length, "LICENSE is not a byte copy");
  assert(text("licenses/PSL-NOTICE.txt").includes("Mozilla Public License 2.0"), "PSL notice has no MPL line");
});

Deno.test("android samples: at least 20,000 cases with a fixed selection", () => {
  assert(samples.cases.length >= 20000, `samples ${samples.cases.length}`);
  const again = buildSamples(first.data);
  assert(JSON.stringify(again) === JSON.stringify(samples), "the sample selection is not fixed");
  const layers = new Set(samples.cases.map((c) => c.layer));
  for (const l of ["SELF_TEST", "USER_ALLOW", "THREAT", "NEVER_BLOCK", "LIST", "NONE"]) assert(layers.has(l), `no sample in layer ${l}`);
});

// Plan 6.5 cross-check: dnsDecision() against the DNR meaning on a projected
// rule set. State {ads+threat, not paused}, no Self-test marker: the DNR
// projection has no mode, no pause and no marker.
Deno.test("android cross-check: BLOCK in dnsDecision() equals a DNR block on the projected rules (400 samples)", () => {
  const rules = general.slice(0, 3).map((r) => structuredClone(r));
  let id = 100;
  for (let i = 0; i < listHosts.length; i += 80) {
    rules.push({ id: id++, priority: 1, action: { type: "block" }, condition: { requestDomains: listHosts.slice(i, i + 80) } });
  }
  for (const r of threatRules) rules.push({ ...structuredClone(r), id: id++ });
  rules.push({ id: id++, priority: 2000020, action: { type: "allow" }, condition: { requestDomains: samples.userAllow } });
  const d = prepareData({ ...first.data, userAllow: samples.userAllow });
  const pool = samples.cases.filter((c) => c.mode === "ads+threat" && !c.paused && !c.host.endsWith(SELF_TEST_HOST));
  const step = Math.max(1, Math.floor(pool.length / 400));
  let n = 0;
  let blocks = 0;
  for (let i = 0; i < pool.length && n < 400; i += step, n++) {
    const host = pool[i].host;
    const dns = dnsDecision(host, d, { mode: "ads+threat", paused: false }).action === "BLOCK";
    const dnr = evaluate(rules, { url: `https://${host}/`, type: "xmlhttprequest", frames: [] }).action === "block";
    assert(dns === dnr, `cross-check differs for ${host}: dns ${dns}, dnr ${dnr}`);
    if (dns) blocks++;
  }
  assert(n >= 400 && blocks > 50, `cross-check ran ${n} samples with ${blocks} blocks`);
  // Documented difference (plan section 3, risk 21): rule 1 frame allow.
  const kick = evaluate(rules, { url: "https://imasdk.googleapis.com/x.js", type: "script", frames: ["kick.com"] });
  assert(kick.action === "allow", "the kick.com frame allow is expected to let imasdk through in DNR");
  assert(dnsDecision("imasdk.googleapis.com", d, { mode: "ads+threat", paused: false }).action === "BLOCK", "DNS blocks imasdk with no frame context");
  console.log(`android cross-check: ${n} samples, ${blocks} blocks, kick.com frame difference documented`);
});

Deno.test("android cross-check: each DNS block of the list and threat layers is in the packed block rules", () => {
  const blocked = new Set();
  for (const r of general.concat(threatRules)) if (r.action.type === "block") for (const h of r.condition.requestDomains || []) blocked.add(h);
  for (const h of listHosts) assert(blocked.has(h), `list host ${h} is in no packed block rule`);
  for (const h of threatHosts) assert(blocked.has(h), `threat name ${h} is in no packed block rule`);
  // Samples that DNS forwards but the full packed rules block for a script on
  // a news page: these are the scoped entries that stay in the browser.
  const all = general.concat(threatRules);
  const d = prepareData({ ...first.data, userAllow: [] });
  const pool = samples.cases.filter((c) => c.mode === "ads+threat" && !c.paused && !c.host.endsWith(SELF_TEST_HOST));
  let scopedOnly = 0;
  let dnsOnly = 0;
  let n = 0;
  for (let i = 0; i < pool.length && n < 300; i += Math.floor(pool.length / 300), n++) {
    const host = pool[i].host;
    const dns = dnsDecision(host, d, { mode: "ads+threat", paused: false }).action === "BLOCK";
    const dnr = evaluate(all, { url: `https://${host}/`, type: "script", initiator: "news.example", frames: ["news.example"] }).action === "block";
    if (dnr && !dns) scopedOnly++;
    if (dns && !dnr) dnsOnly++;
  }
  console.log(`android one-direction check: ${n} samples; ${scopedOnly} blocked only by DNR rules, ${dnsOnly} blocked only by DNS`);
});
