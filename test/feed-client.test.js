// Block G: signed-feed client wiring (dormant until configured). Fake chrome
// storage / session rules / fetch; throwaway keys generated in memory.
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/feed/config.js";
import "../src/feed/keys.js";
import "../src/feed/canonical.js";
import "../src/feed/schema.js";
import "../src/feed/verify.js";
import "../src/feed/compile.js";
import "../src/feed/client.js";
import "../src/general/filter-options.js";
import "../src/threat/compile.js";
import "../src/general/update.js";
import snapshot from "../src/rules/threat-snapshot.json" with { type: "json" };
import threat from "../src/rules/threat-network.json" with { type: "json" };
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import { generateKeyPair, signBytes, isInside } from "../scripts/lib/feed-tools.mjs";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }
const FC = globalThis.GeckoFeedClient;
const C = globalThis.GeckoFeedCanonical;
const ORIGIN = "https://feed.example.test";
const feedPair = await generateKeyPair("feed-test", "feed");
const killPair = await generateKeyPair("kill-test", "kill");
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

function feedDoc(serial, hosts, over = {}) {
  return Object.assign({ format: 1, serial, createdAt: iso(NOW - 3600000), notBefore: iso(NOW - 3600000), notAfter: iso(NOW + 10 * DAY), dnr: hosts.map((h, i) => ({ id: i + 1, requestDomains: [h] })) }, over);
}
async function published(doc, pair = feedPair) {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  return { bytes, sig: await signBytes(bytes, pair.privateRecord) };
}

function world(opts = {}) {
  const store = {};
  let session = [];
  const calls = [];
  const w = {
    store, calls, get session() { return session; }, set session(v) { session = v; }, files: {}, t: NOW, updates: 0, failUpdate: false,
  };
  w.deps = {
    config: { FEED_ORIGIN: opts.origin === undefined ? ORIGIN : opts.origin, FEED_PATH: "/feed.json", SIG_PATH: "/feed.json.sig" },
    keys: { feedKeys: opts.noKey ? {} : { "feed-test": feedPair.publicKey }, killKeys: { "kill-test": killPair.publicKey } },
    manifest: () => ({ host_permissions: opts.noHost ? ["https://easylist.to/*"] : ["https://easylist.to/*", ORIGIN + "/*"] }),
    extensionVersion: "0.2.21",
    protectedReason: globalThis.GeckoProtectedHosts.protectedReason,
    timeoutMs: 50,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (opts.fetch) return opts.fetch(url, init);
      const f = w.files[new URL(url).pathname];
      if (f instanceof Error) throw f;
      if (!f) return new Response("nope", { status: 404 });
      return new Response(f, { status: 200 });
    },
    now: () => w.t,
    getState: async () => structuredClone(store.feedState || {}),
    setState: async (p) => { store.feedState = Object.assign({}, store.feedState || {}, structuredClone(p)); },
    getCache: async () => structuredClone(store.feedCache || {}),
    setCache: async (c) => { store.feedCache = structuredClone(c); },
    getPaused: async () => store.feedPaused === true,
    getSessionRules: async () => structuredClone(session),
    updateSessionRules: async ({ removeRuleIds, addRules }) => {
      if (w.failUpdate) throw new Error("MAX_NUMBER_OF_SESSION_RULES exceeded");
      w.updates++;
      session = session.filter((r) => !removeRuleIds.includes(r.id)).concat(structuredClone(addRules));
    },
    loadSnapshot: async () => structuredClone(snapshot),
  };
  return w;
}
async function publish(w, doc, pair) {
  const p = await published(doc, pair);
  w.files["/feed.json"] = p.bytes;
  w.files["/feed.json.sig"] = p.sig;
  return p;
}
const hostsOf = (w) => w.session.flatMap((r) => r.condition.requestDomains).sort();

Deno.test("dormant when unconfigured: no fetch, no session rules (each of the three conditions)", async () => {
  assert(globalThis.GeckoFeedConfig.FEED_ORIGIN === "", "shipped FEED_ORIGIN must stay empty");
  assert(Object.keys(globalThis.GeckoFeedKeys.FEED_KEYS).length === 0, "shipped keys empty");
  for (const opts of [{ origin: "" }, { noKey: true }, { noHost: true }, { origin: "http://feed.example.test" }, { origin: ORIGIN + "/path" }]) {
    const w = world(opts);
    await publish(w, feedDoc(1, ["evil.example"]));
    const r = await FC.checkFeed(w.deps);
    assert(r.ran === false && /dormant/.test(r.reason) && w.calls.length === 0, JSON.stringify(opts) + " " + JSON.stringify(r));
    const a = await FC.applyCached(w.deps);
    assert(a.mode === "dormant" && w.session.length === 0 && w.store.feedState.status === "dormant", JSON.stringify(a));
  }
});

Deno.test("apply: fetches the signature first, then the feed, https/no-store/no-redirect/no-cookies; rules at 2,000,010; cache stored", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["evil.example", "bad.example"]));
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "applied" && r.rules === 2, JSON.stringify(r));
  assert(w.calls[0].url === ORIGIN + "/feed.json.sig" && w.calls[1].url === ORIGIN + "/feed.json", "order " + w.calls.map((c) => c.url));
  for (const c of w.calls) assert(c.init.cache === "no-store" && c.init.credentials === "omit" && c.init.redirect === "error", JSON.stringify(c.init));
  assert(JSON.stringify(hostsOf(w)) === JSON.stringify(["bad.example", "evil.example"]) && w.session.every((x) => x.priority === 2000010), "rules");
  assert(w.store.feedState.serial === 1 && w.store.feedCache.current.serial === 1 && !w.store.feedCache.previous, JSON.stringify(w.store.feedState));
});

Deno.test("replace is one atomic session-rule update; previous payload kept for rollback; rollbackTo re-applies it", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["one.example"]));
  await FC.checkFeed(w.deps);
  await publish(w, feedDoc(2, ["two.example", "three.example"]));
  const before = w.updates;
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && w.updates === before + 1, "one update call");
  assert(JSON.stringify(hostsOf(w)) === JSON.stringify(["three.example", "two.example"]), "replaced " + hostsOf(w));
  assert(w.store.feedCache.current.serial === 2 && w.store.feedCache.previous.serial === 1, "two cached");
  await publish(w, feedDoc(3, [], { rollbackTo: 1 }));
  const rb = await FC.checkFeed(w.deps);
  assert(rb.ok && rb.mode === "rollback" && JSON.stringify(hostsOf(w)) === JSON.stringify(["one.example"]), JSON.stringify(rb) + hostsOf(w));
  assert(w.store.feedState.serial === 3 && w.store.feedState.appliedSerial === 1, JSON.stringify(w.store.feedState));
  // Rolling forward again to the other stored payload works too.
  await publish(w, feedDoc(4, [], { rollbackTo: 2 }));
  await FC.checkFeed(w.deps);
  assert(JSON.stringify(hostsOf(w)) === JSON.stringify(["three.example", "two.example"]), "back to serial 2");
  // A rollback to a serial that is not stored (4 was a rollback document) is ignored: rules stay.
  const keep = hostsOf(w).join();
  await publish(w, feedDoc(6, [], { rollbackTo: 4 }));
  const ign = await FC.checkFeed(w.deps);
  assert(!ign.ok && /not stored/.test(w.store.feedState.lastError) && hostsOf(w).join() === keep, "ignored rollback " + JSON.stringify(ign));
});

Deno.test("kill: the kill-key document latches until the next extension version; a feed-key document cannot revive it (M-4)", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w.deps);
  await publish(w, { format: 1, kill: true, serial: 1, createdAt: iso(NOW) }, killPair);
  const k = await FC.checkFeed(w.deps);
  assert(k.ok && k.mode === "killed" && w.session.length === 0 && w.store.feedState.killed === true && w.store.feedState.killLatch === true, JSON.stringify(k));
  w.session = [];
  const a = await FC.applyCached(w.deps);
  assert(a.mode === "killed" && w.session.length === 0, "restart stays killed");
  // A (possibly stolen) feed key signs a newer document: refused, not even fetched.
  await publish(w, feedDoc(2, ["back.example"]));
  const calls = w.calls.length;
  const refused = await FC.checkFeed(w.deps);
  assert(refused.ran === false && /next extension version/.test(refused.reason) && w.calls.length === calls && w.session.length === 0, JSON.stringify(refused));
  // The extension is updated (new pinned keys would ship with it): the latch is released.
  assert(!w.store.feedCache.current && !w.store.feedCache.previous, "the killed feed's saved files are dropped");
  w.deps.extensionVersion = "0.2.22";
  await FC.applyCached(w.deps);
  assert(w.store.feedState.killLatch === false && /released by an extension update/.test(w.store.feedState.lastError), JSON.stringify(w.store.feedState));
  assert(!hostsOf(w).includes("evil.example") && w.store.feedState.source === "snapshot", "after the update only the packed snapshot applies, not the killed feed");
  await FC.checkFeed(w.deps);
  assert(hostsOf(w).join() === "back.example" && w.store.feedState.killed === false, "re-enabled after the update");
  // killFeed in a normal feed does the same.
  await publish(w, feedDoc(3, ["x.example"], { killFeed: true }));
  await FC.checkFeed(w.deps);
  assert(w.session.length === 0 && w.store.feedState.status === "killed", "killFeed");
});

Deno.test("pause: no fetch, feed rules removed, cache kept; unpausing re-applies the cache", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w.deps);
  w.store.feedPaused = true;
  const calls = w.calls.length;
  const r = await FC.checkFeed(w.deps);
  assert(r.reason === "paused" && w.calls.length === calls && w.session.length === 0 && w.store.feedCache.current.serial === 1, JSON.stringify(r));
  w.store.feedPaused = false;
  const a = await FC.applyCached(w.deps);
  assert(a.mode === "cache" && hostsOf(w).join() === "evil.example", JSON.stringify(a));
});

Deno.test("offline start re-applies the verified cache; an expired cache falls back to the packed snapshot", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w.deps);
  w.session = []; // browser restart / extension update cleared session rules
  w.files = {}; // offline
  const a = await FC.applyCached(w.deps);
  assert(a.mode === "cache" && hostsOf(w).join() === "evil.example" && w.calls.length === 2, JSON.stringify(a));
  w.t = NOW + 11 * DAY; // past notAfter
  w.session = [];
  const b = await FC.applyCached(w.deps);
  assert(b.mode === "snapshot" && w.session.length === snapshot.dnr.length && w.store.feedState.source === "snapshot", JSON.stringify(b));
  const snapHosts = new Set(threat.flatMap((r) => r.condition.requestDomains));
  assert(hostsOf(w).every((h) => snapHosts.has(h)) && hostsOf(w).length === snapHosts.size, "snapshot = packed threat set");
  // A tampered cache does not verify either.
  const w2 = world();
  await publish(w2, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w2.deps);
  const bytes = C.base64ToBytes(w2.store.feedCache.current.bytes); bytes[5] ^= 1;
  w2.store.feedCache.current.bytes = C.bytesToBase64(bytes);
  assert((await FC.applyCached(w2.deps)).mode === "snapshot", "tampered cache rejected");
});

Deno.test("failures keep the old rules and record feedLastError: offline, 404, bad signature, lower serial, protected host, oversize, other origin, timeout, rule-update quota", async () => {
  const w = world();
  await publish(w, feedDoc(5, ["keep.example"]));
  await FC.checkFeed(w.deps);
  const good = JSON.stringify(w.session);
  const attempts = [
    async () => { w.files["/feed.json.sig"] = new TypeError("Failed to fetch"); },
    async () => { delete w.files["/feed.json"]; w.files["/feed.json.sig"] = "keyId=feed-test\n" + "A".repeat(86) + "==\n"; },
    async () => { const p = await published(feedDoc(6, ["x.example"])); w.files["/feed.json"] = p.bytes; w.files["/feed.json.sig"] = (await published(feedDoc(7, ["y.example"]))).sig; },
    async () => { await publish(w, feedDoc(4, ["older.example"])); },
    async () => { await publish(w, feedDoc(8, ["cdn.youtube.com"])); },
    async () => { await publish(w, feedDoc(9, Array.from({ length: 4000 }, (_, i) => "h" + i + "-paddingpaddingpaddingpaddingpadding.example").slice(0, 4000))); w.files["/feed.json"] = new Uint8Array(600 * 1024).fill(32); },
  ];
  for (const [i, prep] of attempts.entries()) {
    await prep();
    const r = await FC.checkFeed(w.deps);
    assert(!r.ok && JSON.stringify(w.session) === good && w.store.feedState.serial === 5 && w.store.feedState.lastError, "attempt " + i + ": " + JSON.stringify(r) + " " + w.store.feedState.lastError);
  }
  const other = world({ fetch: async (url) => Object.defineProperty(new Response("x"), "url", { value: "https://evil.example/feed.json" }) });
  assert(/another origin/.test((await FC.checkFeed(other.deps)).reason), "other origin");
  const slow = world({ fetch: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert(/timeout/.test((await FC.checkFeed(slow.deps)).reason), "timeout");
  const big = world({ fetch: async () => new Response("x", { headers: { "Content-Length": String(10 * 1024 * 1024) } }) });
  assert(/larger than/.test((await FC.checkFeed(big.deps)).reason), "content-length cap");
  await publish(w, feedDoc(10, ["new.example"]));
  w.failUpdate = true;
  const q = await FC.checkFeed(w.deps);
  assert(!q.ok && w.store.feedState.serial === 5 && w.store.feedCache.current.serial === 5 && /apply/.test(w.store.feedState.lastError), "quota: serial not advanced " + JSON.stringify(w.store.feedState));
});

Deno.test("status text: dormant, paused, killed, snapshot, active (popup adds the age)", () => {
  assert(/not set up/.test(FC.statusText({ status: "dormant" })), "dormant");
  assert(/paused/.test(FC.statusText({ status: "active" }, true)), "paused");
  assert(/switched off by its publisher/.test(FC.statusText({ status: "killed" })), "killed");
  assert(/packed snapshot \(200 rules\)/.test(FC.statusText({ status: "active", source: "snapshot", ruleCount: 200 })), "snapshot");
  assert(FC.statusText({ status: "active", source: "feed", appliedSerial: 7, ruleCount: 3, lastError: "fetch: timeout" }) === "Threat feed: serial 7, 3 rules. Last problem: fetch: timeout.", "active");
  assert(popupHtml.includes('id="feed-status"') && popupSource.includes('const FEED_STATE_KEY = "feedState"'), "popup line");
  assert(!popupSource.includes("feedCache"), "popup never reads the feed cache");
});

Deno.test("worker: dormant feed at start writes only a small status and adds no session rules; the alarm does not reach any feed host", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: { schema: 2, lastRunAt: Date.now(), lists: {} } } });
  await settle(100);
  assert(w.store.feedState && w.store.feedState.status === "dormant" && /not set up/.test(w.store.feedState.text), JSON.stringify(w.store.feedState));
  assert(w.dnr.session.length === 0, "no session rules while dormant");
  w.fireAlarm("gecko-refresh");
  await settle(200);
  assert(!w.fetched.some((u) => /feed/.test(u)), "fetched " + w.fetched);
  assert(!("feedCache" in w.store), "no cache");
});

Deno.test("list-download allow adds the feed host only when given", () => {
  const G = globalThis.GeneralAdblockUpdate;
  assert(!G.listAllowRule("abc").condition.requestDomains.includes("feed.example.test"), "dormant");
  const r = G.listAllowRule("abc", ["feed.example.test"]);
  assert(r.priority === 3000000 && r.condition.requestDomains.includes("feed.example.test") && r.condition.initiatorDomains[0] === "abc", "configured");
});

Deno.test("keygen/sign helpers: a signed file verifies with the printed public key; the private key never goes in the repo", async () => {
  const pair = await generateKeyPair("feed-x", "feed");
  assert(pair.privateRecord.pkcs8 && !JSON.stringify(pair.publicKey).includes(pair.privateRecord.pkcs8), "public/private distinct");
  const bytes = new TextEncoder().encode(JSON.stringify(feedDoc(1, ["evil.example"])));
  const sig = await signBytes(bytes, pair.privateRecord);
  const r = await globalThis.GeckoFeedVerify.verifyFeed(bytes, sig, { feedKeys: { "feed-x": pair.publicKey }, killKeys: {}, now: NOW, storedSerial: 0 });
  assert(r.ok, JSON.stringify(r));
  assert(isInside("D:/My Code/twitch-adblock/keys/k.json", "D:/My Code/twitch-adblock") && !isInside("G:/other/k.json", "D:/My Code/twitch-adblock"), "isInside");
  // The CLI refuses an output path inside the repo (nothing is generated).
  const target = new URL("../scripts/should-not-exist.key.json", import.meta.url);
  const out = await new Deno.Command("deno", { args: ["run", "--allow-read", "--allow-write", "scripts/feed-keygen.mjs", "--key-id", "t-1", "--out", "scripts/should-not-exist.key.json"], cwd: new URL("..", import.meta.url) }).output();
  assert(out.code === 2 && /outside the repository/.test(new TextDecoder().decode(out.stderr)), "keygen refused " + out.code);
  let exists = true;
  try { await Deno.lstat(target); } catch { exists = false; }
  assert(!exists, "a key file was written inside the repo");
  for (const f of ["feed-keygen.mjs", "feed-sign.mjs", "lib/feed-tools.mjs"]) {
    const src = await Deno.readTextFile(new URL("../scripts/" + f, import.meta.url));
    assert(!/console\.(log|error)\([^)]*(pkcs8|privateRecord|privateKey)/.test(src), f + " prints private key material");
  }
});

// Security review L-8: a body without Content-Length is read as a stream and
// cut at the cap; I-6: a rollback to a killFeed document reports "killed".
Deno.test("streamed size cap: a chunked body over the cap is refused and reading stops early", async () => {
  let pulled = 0;
  const big = () => new ReadableStream({
    pull(ctrl) {
      pulled++;
      if (pulled > 200) { ctrl.close(); return; }
      ctrl.enqueue(new Uint8Array(64 * 1024));
    },
  });
  const w = world({ fetch: async (url) => new URL(url).pathname.endsWith(".sig") ? new Response("keyId=feed-test\nAAAA\n") : new Response(big(), { status: 200 }) });
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && /larger than/.test(r.reason) && pulled < 20, JSON.stringify(r) + " pulled " + pulled);
  const small = await FC.fetchCapped({ fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } })) }, ORIGIN, "/x", 10);
  assert(small.join() === "1,2,3", "chunks joined");
});

Deno.test("rollback to a stored killFeed document reports killed, not active (I-6)", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["a.example"], { killFeed: true }));
  await FC.checkFeed(w.deps);
  await publish(w, feedDoc(2, ["b.example"]));
  await FC.checkFeed(w.deps);
  await publish(w, feedDoc(3, [], { rollbackTo: 1 }));
  const rb = await FC.checkFeed(w.deps);
  assert(rb.mode === "rollback" && w.store.feedState.status === "killed" && w.session.length === 0, JSON.stringify(w.store.feedState));
});

Deno.test("feed-keygen refuses a key path that really lands in the repo ('..', missing folder) (L-9)", async () => {
  const { keyTargetProblem, repoRoot } = await import("../scripts/lib/feed-tools.mjs");
  assert(/outside the repository/.test(await keyTargetProblem(repoRoot() + "/scripts/../k.json")), "dot-dot into the repo root");
  assert(/outside the repository/.test(await keyTargetProblem(repoRoot() + "/scripts/lib/../../test/k.json")), "dot-dot into a repo folder");
  assert(/must already exist/.test(await keyTargetProblem(repoRoot() + "-nonexistent-folder-x/k.json")), "missing folder");
  const parent = repoRoot().replace(/\/[^/]+$/, "");
  assert(await keyTargetProblem(parent + "/gecko-test-key.json") === null, "the folder above the repo is fine");
});

Deno.test("build-threat-rules refuses cached lists whose bytes differ from meta.json (L-10)", async () => {
  // Run WITHOUT --allow-write: if the check failed, writing would throw instead of touching the repo.
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-lock", "--allow-read", "scripts/build-threat-rules.mjs", "--cache", new URL("fixtures/threat-cache-mismatch/", import.meta.url).href],
    cwd: new URL("..", import.meta.url), stdout: "piped", stderr: "piped",
  }).output();
  const err = new TextDecoder().decode(out.stderr);
  assert(out.code === 5 && /do not match src\/rules\/meta\.json/.test(err), out.code + " " + err);
});
