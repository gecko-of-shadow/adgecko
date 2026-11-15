// Re-fetching the same, unchanged feed (same serial, same bytes) on the next
// 3-hourly check is the normal case. It must not be reported as a replay or
// rollback attack, and the time of the last check must move forward.
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/feed/config.js";
import "../src/feed/keys.js";
import "../src/feed/canonical.js";
import "../src/feed/schema.js";
import "../src/feed/verify.js";
import "../src/feed/compile.js";
import "../src/feed/client.js";
import snapshot from "../src/rules/threat-snapshot.json" with { type: "json" };
import { generateKeyPair, signBytes } from "../scripts/lib/feed-tools.mjs";

function assert(c, l) { if (!c) throw new Error(l); }
const FC = globalThis.GeckoFeedClient;
const ORIGIN = "https://feed.example.test";
const feedPair = await generateKeyPair("feed-test", "feed");
const killPair = await generateKeyPair("kill-test", "kill");
const DAY = 86400000;
const HOUR = 3600000;
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

function feedDoc(serial, hosts) {
  return { format: 1, serial, createdAt: iso(NOW - HOUR), notBefore: iso(NOW - HOUR), notAfter: iso(NOW + 10 * DAY), dnr: hosts.map((h, i) => ({ id: i + 1, requestDomains: [h] })) };
}

function world() {
  const store = {};
  let session = [];
  const w = { store, files: {}, t: NOW, get session() { return session; } };
  w.deps = {
    config: { FEED_ORIGIN: ORIGIN, FEED_PATH: "/feed.json", SIG_PATH: "/feed.json.sig" },
    keys: { feedKeys: { "feed-test": feedPair.publicKey }, killKeys: { "kill-test": killPair.publicKey } },
    manifest: () => ({ host_permissions: ["https://easylist.to/*", ORIGIN + "/*"] }),
    extensionVersion: "0.2.21",
    protectedReason: globalThis.GeckoProtectedHosts.protectedReason,
    timeoutMs: 50,
    fetch: async (url) => {
      const f = w.files[new URL(url).pathname];
      if (!f) return new Response("nope", { status: 404 });
      return new Response(f, { status: 200 });
    },
    now: () => w.t,
    getState: async () => structuredClone(store.feedState || {}),
    setState: async (p) => { store.feedState = Object.assign({}, store.feedState || {}, structuredClone(p)); },
    getCache: async () => structuredClone(store.feedCache || {}),
    setCache: async (c) => { store.feedCache = structuredClone(c); },
    getPaused: async () => false,
    getSessionRules: async () => structuredClone(session),
    updateSessionRules: async ({ removeRuleIds, addRules }) => {
      session = session.filter((r) => !removeRuleIds.includes(r.id)).concat(structuredClone(addRules));
    },
    loadSnapshot: async () => structuredClone(snapshot),
  };
  return w;
}

Deno.test("an unchanged feed re-fetched 3 hours later is not a replay attack, and the last-check time moves", async () => {
  const w = world();
  const bytes = new TextEncoder().encode(JSON.stringify(feedDoc(1, ["evil.example"])));
  w.files["/feed.json"] = bytes;
  w.files["/feed.json.sig"] = await signBytes(bytes, feedPair.privateRecord);

  const first = await FC.checkFeed(w.deps);
  assert(first.ok && first.mode === "applied", "first apply " + JSON.stringify(first));
  const firstFetchedAt = w.store.feedState.fetchedAt;
  assert(firstFetchedAt === NOW, "first fetchedAt " + firstFetchedAt);

  // Next 3-hourly alarm: the publisher still serves the same serial-1 file.
  w.t = NOW + 3 * HOUR;
  const second = await FC.checkFeed(w.deps);
  const st = w.store.feedState;
  const text = FC.statusText(st, false);

  assert(!/replay|rollback attack|not newer/.test(String(second.reason || "")), "unchanged feed reported as an attack: " + JSON.stringify(second));
  assert(!st.lastError, "lastError set for an unchanged feed: " + st.lastError);
  assert(!/attack/.test(text), "popup status shows an attack warning: " + text);
  assert(st.fetchedAt === NOW + 3 * HOUR, "fetchedAt (age shown in the popup) did not move: " + st.fetchedAt + " expected " + (NOW + 3 * HOUR));
  // Rules stay as they were.
  assert(st.serial === 1 && st.ruleCount === 1 && w.session.length === 1, "rules changed: " + JSON.stringify(st));
});
