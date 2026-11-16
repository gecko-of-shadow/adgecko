// Shared fake world for the signed-feed client tests: fake chrome storage,
// session rules and fetch, and throwaway Ed25519 keys made in memory.
// The same model as the inline harness in test/feed-client.test.js.
import "../../src/threat/psl.js";
import "../../src/general/never-block-captcha.js";
import "../../src/threat/protected-hosts.js";
import "../../src/feed/config.js";
import "../../src/feed/keys.js";
import "../../src/feed/canonical.js";
import "../../src/feed/schema.js";
import "../../src/feed/verify.js";
import "../../src/feed/compile.js";
import "../../src/feed/client.js";
import snapshot from "../../src/rules/threat-snapshot.json" with { type: "json" };
import { generateKeyPair, signBytes } from "../../scripts/lib/feed-tools.mjs";

export { generateKeyPair, snapshot };
export function assert(c, l) { if (!c) throw new Error(l); }
export const FC = globalThis.GeckoFeedClient;
export const ORIGIN = "https://feed.example.test";
export const H = 3600000;
export const DAY = 86400000;
export const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
export const MAX_SERIAL = 2147483647;
export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
export const feedPair = await generateKeyPair("feed-test", "feed");
export const killPair = await generateKeyPair("kill-test", "kill");

// A feed document. `at` is the time it is made (default NOW); `life` its
// lifetime from notBefore (default 10 days).
export function feedDoc(serial, hosts, over = {}, at = NOW, life = 10 * DAY) {
  return Object.assign({ format: 1, serial, createdAt: iso(at - H), notBefore: iso(at - H), notAfter: iso(at - H + life), dnr: hosts.map((h, i) => ({ id: i + 1, requestDomains: [h] })) }, over);
}
export const killDoc = (serial, at = NOW) => ({ format: 1, kill: true, serial, createdAt: iso(at) });

export function world(opts = {}) {
  const store = {};
  let session = [];
  const w = { store, calls: [], files: {}, t: NOW, updates: 0, stateWrites: 0, get session() { return session; }, set session(v) { session = v; } };
  w.deps = {
    config: { FEED_ORIGIN: ORIGIN, FEED_PATH: "/feed.json", SIG_PATH: "/feed.json.sig" },
    keys: { feedKeys: { "feed-test": feedPair.publicKey }, killKeys: { "kill-test": killPair.publicKey } },
    manifest: () => ({ host_permissions: [ORIGIN + "/*"] }),
    extensionVersion: "0.3.6",
    protectedReason: globalThis.GeckoProtectedHosts.protectedReason,
    timeoutMs: 50,
    fetch: async (url, init) => {
      w.calls.push({ url, init });
      const f = w.files[new URL(url).pathname];
      if (f instanceof Error) throw f;
      if (!f) return new Response("nope", { status: 404 });
      return new Response(f, { status: 200 });
    },
    now: () => w.t,
    getState: async () => structuredClone(store.feedState || {}),
    setState: async (p) => { w.stateWrites++; store.feedState = Object.assign({}, store.feedState || {}, structuredClone(p)); },
    getCache: async () => structuredClone(store.feedCache || {}),
    setCache: async (c) => { store.feedCache = structuredClone(c); },
    getPaused: async () => store.feedPaused === true,
    getSessionRules: async () => structuredClone(session),
    updateSessionRules: async ({ removeRuleIds, addRules }) => {
      w.updates++;
      session = session.filter((r) => !removeRuleIds.includes(r.id)).concat(structuredClone(addRules));
    },
    loadSnapshot: async () => { w.snapshotLoads = (w.snapshotLoads || 0) + 1; return structuredClone(snapshot); },
  };
  return w;
}

export async function publish(w, doc, pair = feedPair) {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  w.files["/feed.json"] = bytes;
  w.files["/feed.json.sig"] = await signBytes(bytes, pair.privateRecord);
}
export const hostsOf = (w) => w.session.flatMap((r) => r.condition.requestDomains).sort();
