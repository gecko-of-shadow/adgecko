// Block F: signed-feed verification, strict schema and compiler. Every key
// here is a throwaway pair generated in memory for the test run.
import "../src/threat/protected-hosts.js";
import "../src/feed/canonical.js";
import "../src/feed/schema.js";
import "../src/feed/verify.js";
import "../src/feed/compile.js";
import "../src/feed/keys.js";
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const C = globalThis.GeckoFeedCanonical;
const S = globalThis.GeckoFeedSchema;
const V = globalThis.GeckoFeedVerify;
const K = globalThis.GeckoFeedCompile;

async function keyPair() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = C.bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  return { kp, pub };
}
const feedKey = await keyPair();
const killKey = await keyPair();
const otherKey = await keyPair();
const KEYS = { feedKeys: { "feed-test": feedKey.pub }, killKeys: { "kill-test": killKey.pub } };

const enc = (obj) => new TextEncoder().encode(typeof obj === "string" ? obj : JSON.stringify(obj));
async function sign(bytes, kp, keyId) {
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, bytes));
  return C.formatSigFile(keyId, sig);
}
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const DAY = 86400000;
function feed(over = {}) {
  return Object.assign({
    format: 1, serial: 10, createdAt: iso(NOW - 3600000), notBefore: iso(NOW - 3600000), notAfter: iso(NOW + 13 * DAY),
    minExtension: "0.2.0", maxExtension: null, killFeed: false, dropRuleIds: [], rollbackTo: null,
    dnr: [{ id: 1, requestDomains: ["evil.example", "cdn.evil.example"] }, { id: 2, requestDomains: ["bucket-x.storage.googleapis.com"], resourceTypes: ["script", "main_frame"], action: "block" }],
    cosmetic: [], tactics: [],
  }, over);
}
const OPTS = (over = {}) => Object.assign({}, KEYS, { now: NOW, storedSerial: 5, storedKillSerial: 0, extensionVersion: "0.2.21" }, over);
async function check(doc, opts, kp = feedKey.kp, keyId = "feed-test") {
  const bytes = enc(doc);
  return V.verifyFeed(bytes, await sign(bytes, kp, keyId), OPTS(opts));
}

Deno.test("a valid signed feed is accepted and compiles to 2,000,010 session rules in the feed id range", async () => {
  const r = await check(feed());
  assert(r.ok && r.kind === "feed" && r.keyId === "feed-test", JSON.stringify(r));
  const { rules, killed } = K.compileFeed(r.doc);
  assert(!killed && rules.length === 2, JSON.stringify(rules));
  assert(rules[0].id === 700001 && rules[1].id === 700002 && rules.every((x) => x.priority === 2000010 && x.action.type === "block" && K.isFeedRuleId(x.id)), "ids/priority");
  assert(rules[0].condition.resourceTypes.join() === S.THREAT_TYPES.join() && rules[1].condition.resourceTypes.join() === "script,main_frame", "types");
  assert(!K.isFeedRuleId(600000) && !K.isFeedRuleId(700000) && !K.isFeedRuleId(704501), "id range bounds");
});

Deno.test("tampered byte, wrong key, wrong keyId, unknown key and a bad signature file are all rejected", async () => {
  const bytes = enc(feed());
  const sig = await sign(bytes, feedKey.kp, "feed-test");
  const tampered = bytes.slice();
  tampered[20] ^= 1;
  assert(!(await V.verifyFeed(tampered, sig, OPTS())).ok, "tampered byte");
  const appended = new Uint8Array(bytes.length + 1); appended.set(bytes); appended[bytes.length] = 0x20;
  assert(!(await V.verifyFeed(appended, sig, OPTS())).ok, "extra byte");
  assert(!(await V.verifyFeed(bytes, await sign(bytes, otherKey.kp, "feed-test"), OPTS())).ok, "wrong key");
  const r1 = await V.verifyFeed(bytes, sig.replace("keyId=feed-test", "keyId=feed-other"), OPTS());
  assert(!r1.ok && /unknown key id/.test(r1.error), "unknown keyId " + r1.error);
  const r2 = await V.verifyFeed(bytes, sig.replace("keyId=feed-test", "keyId=kill-test"), OPTS());
  assert(!r2.ok && /bad signature/.test(r2.error), "keyId of the other key " + r2.error);
  const empty = await V.verifyFeed(bytes, sig, Object.assign(OPTS(), { feedKeys: {}, killKeys: {} }));
  assert(!empty.ok, "no pinned keys: nothing verifies");
  for (const badSig of ["", "keyId=feed-test\n", "keyId=feed-test\n!!!\n", "keyId=feed test\n" + sig.split("\n")[1] + "\n", sig + "extra\n"]) {
    assert(!(await V.verifyFeed(bytes, badSig, OPTS())).ok, "bad sig file accepted: " + JSON.stringify(badSig));
  }
});

Deno.test("the signature is checked before the body is parsed (garbage signed with a wrong key never reaches JSON.parse)", async () => {
  const realParse = JSON.parse;
  let parsed = 0;
  JSON.parse = (...a) => { parsed++; return realParse(...a); };
  try {
    const bytes = enc("{not json at all");
    const r = await V.verifyFeed(bytes, await sign(bytes, otherKey.kp, "feed-test"), OPTS());
    assert(!r.ok && /bad signature/.test(r.error) && parsed === 0, "parsed before verify: " + parsed + " " + r.error);
    const r2 = await V.verifyFeed(bytes, await sign(bytes, feedKey.kp, "feed-test"), OPTS());
    assert(!r2.ok && /not valid JSON/.test(r2.error), r2.error);
  } finally {
    JSON.parse = realParse;
  }
});

Deno.test("replayed or lower serial, expired, not-yet-valid, too long a lifetime and version range are rejected", async () => {
  const cases = [
    [feed({ serial: 5 }), /not newer/],
    [feed({ serial: 4 }), /not newer/],
    [feed({ notAfter: iso(NOW - 1000), notBefore: iso(NOW - DAY), createdAt: iso(NOW - DAY) }), /expired/],
    [feed({ notBefore: iso(NOW + 3600000) }), /not valid yet/],
    [feed({ notAfter: iso(NOW + 15 * DAY) }), /more than 14 days/],
    [feed({ minExtension: "0.3.0" }), /older than minExtension/],
    [feed({ maxExtension: "0.2.20" }), /newer than maxExtension/],
    [feed({ createdAt: "2026-11-02 12:00" }), /ISO-8601/],
  ];
  for (const [doc, re] of cases) {
    const r = await check(doc);
    assert(!r.ok && re.test(r.error), re + " -> " + JSON.stringify(r));
  }
  assert(S.MAX_LIFETIME_MS === 14 * DAY, "14-day constant");
});

Deno.test("oversize, BOM, unknown keys, priority, allow actions, protected hosts, non-empty cosmetic/tactics and duplicate ids are rejected", async () => {
  const big = feed({ dnr: Array.from({ length: 4500 }, (_, i) => ({ id: i + 1, requestDomains: Array.from({ length: 4 }, (_, j) => `h${i}-${j}-padpadpadpadpadpad.example`) })) });
  assert(enc(big).length > C.MAX_FEED_BYTES, "fixture is oversize");
  const rBig = await check(big);
  assert(!rBig.ok && /larger than 512 KB/.test(rBig.error), rBig.error);
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(feed())]);
  assert(!(await V.verifyFeed(bom, await sign(bom, feedKey.kp, "feed-test"), OPTS())).ok, "BOM");
  const cases = [
    [feed({ extra: 1 }), /unknown key "extra"/],
    [feed({ format: 2 }), /unsupported format/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example"], priority: 1 }] }), /unknown key "priority"/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example"], action: "allow" }] }), /must be "block"/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example"], initiatorDomains: ["b.example"] }] }), /unknown key "initiatorDomains"/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example", "www.youtube.com"] }] }), /protected: youtube.com/],
    [feed({ dnr: [{ id: 1, requestDomains: ["googleapis.com"] }] }), /ancestor of protected/],
    [feed({ dnr: [{ id: 1, requestDomains: ["google.com"] }] }), /ancestor of protected/],
    [feed({ dnr: [{ id: 1, requestDomains: ["edge.ttvnw.net"] }] }), /protected: ttvnw.net/],
    [feed({ dnr: [{ id: 1, requestDomains: ["Evil.Example"] }] }), /lower-case/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example"], resourceTypes: ["image"] }] }), /may only use/],
    [feed({ dnr: [{ id: 1, requestDomains: [] }] }), /1\.\.80/],
    [feed({ dnr: [{ id: 1, requestDomains: Array.from({ length: 81 }, (_, i) => "h" + i + ".example") }] }), /1\.\.80/],
    [feed({ dnr: [{ id: 4501, requestDomains: ["a.example"] }] }), /1\.\.4500/],
    [feed({ dnr: [{ id: 1, requestDomains: ["a.example"] }, { id: 1, requestDomains: ["b.example"] }] }), /duplicate dnr id 1/],
    [feed({ cosmetic: [{ hosts: ["a.example"], select: ["#x"] }] }), /cosmetic is reserved/],
    [feed({ tactics: [{}] }), /tactics is reserved/],
    [feed({ dropRuleIds: [0] }), /dropRuleIds/],
    [feed({ killFeed: "yes" }), /killFeed must be a boolean/],
    [feed({ dnr: undefined }), /missing dnr/],
  ];
  for (const [doc, re] of cases) {
    if (doc.dnr === undefined) delete doc.dnr;
    const r = await check(doc);
    assert(!r.ok && re.test(r.error), re + " -> " + JSON.stringify(r).slice(0, 300));
  }
});

Deno.test("kill document: accepted only when signed by the kill key; a kill key cannot sign a feed and vice versa", async () => {
  const kill = { format: 1, kill: true, serial: 3, createdAt: iso(NOW) };
  const ok = await check(kill, {}, killKey.kp, "kill-test");
  assert(ok.ok && ok.kind === "kill" && ok.doc.serial === 3, JSON.stringify(ok));
  const byFeedKey = await check(kill, {}, feedKey.kp, "feed-test");
  assert(!byFeedKey.ok && /kill key/.test(byFeedKey.error), byFeedKey.error);
  const feedByKill = await check(feed(), {}, killKey.kp, "kill-test");
  assert(!feedByKill.ok && /unknown key|kill document/.test(feedByKill.error), feedByKill.error);
  const withDnr = await check(Object.assign({ dnr: [] }, kill), {}, killKey.kp, "kill-test");
  assert(!withDnr.ok, "kill document with extra keys");
  const replay = await check(kill, { storedKillSerial: 3 }, killKey.kp, "kill-test");
  assert(!replay.ok && /not newer/.test(replay.error), replay.error);
  const both = await check(feed(), { killKeys: { "feed-test": feedKey.pub } });
  assert(!both.ok && /both feed and kill/.test(both.error), both.error);
});

Deno.test("killFeed and dropRuleIds: compile to no rules / leave dropped ids out", async () => {
  const k = await check(feed({ killFeed: true }));
  assert(k.ok && K.compileFeed(k.doc).killed && K.compileFeed(k.doc).rules.length === 0, "killFeed");
  const d = await check(feed({ dropRuleIds: [1] }));
  const rules = K.compileFeed(d.doc).rules;
  assert(rules.length === 1 && rules[0].id === 700002, JSON.stringify(rules));
});

Deno.test("rollbackTo selects the stored previous payload (and nothing else)", async () => {
  const prev = { serial: 8, doc: feed({ serial: 8 }) };
  const cur = { serial: 9, doc: feed({ serial: 9, dnr: [{ id: 3, requestDomains: ["bad-update.example"] }] }) };
  const rb = await check(feed({ serial: 10, rollbackTo: 8, dnr: [] }));
  assert(rb.ok, JSON.stringify(rb));
  const picked = K.resolveRollback(rb.doc, { current: cur, previous: prev });
  assert(picked === prev, "picked " + JSON.stringify(picked && picked.serial));
  assert(K.resolveRollback(Object.assign({}, rb.doc, { rollbackTo: 7 }), { current: cur, previous: prev }) === null, "unknown serial ignored");
  assert(K.resolveRollback(feed(), { current: cur, previous: prev }) === null, "no rollback requested");
  const withBody = await check(feed({ serial: 10, rollbackTo: 8 }));
  assert(!withBody.ok && /carries no dnr/.test(withBody.error), withBody.error);
  const forward = await check(feed({ serial: 10, rollbackTo: 11, dnr: [] }));
  assert(!forward.ok && /earlier serial/.test(forward.error), forward.error);
});

Deno.test("pinned key lists ship empty (dormant), and the manifest requires Chrome 137 for Ed25519", () => {
  const K2 = globalThis.GeckoFeedKeys;
  assert(Object.keys(K2.FEED_KEYS).length === 0 && Object.keys(K2.KILL_KEYS).length === 0, "keys must stay empty until the owner adds them");
  assert(manifest.minimum_chrome_version === "137", "minimum_chrome_version");
});

Deno.test("feed library is data-only: no eval, Function, remote code or chrome.* in src/feed", async () => {
  for (const f of ["canonical.js", "schema.js", "verify.js", "compile.js", "keys.js"]) {
    const src = await Deno.readTextFile(new URL("../src/feed/" + f, import.meta.url));
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert(!/\beval\s*\(|new Function|importScripts|\bimport\s*\(|chrome\./.test(code), f + " has forbidden code");
    assert(!/-----BEGIN|PRIVATE KEY/.test(src), f + " holds key material");
  }
});
