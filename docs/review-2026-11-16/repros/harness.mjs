// Block G: signed-feed client wiring (dormant until configured). Fake chrome
// storage / session rules / fetch; throwaway keys generated in memory.
import "src/threat/psl.js";
import "src/general/never-block-captcha.js";
import "src/threat/protected-hosts.js";
import "src/feed/config.js";
import "src/feed/keys.js";
import "src/feed/canonical.js";
import "src/feed/schema.js";
import "src/feed/verify.js";
import "src/feed/compile.js";
import "src/feed/client.js";
import "src/general/filter-options.js";
import "src/threat/compile.js";
import "src/general/update.js";
import snapshot from "src/rules/threat-snapshot.json" with { type: "json" };
import threat from "src/rules/threat-network.json" with { type: "json" };
import { generateKeyPair, signBytes, isInside } from "scripts/lib/feed-tools.mjs";
export function assert(c, l) { if (!c) throw new Error(l); }
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

export { FC, C, NOW, DAY, iso, feedDoc, published, world, publish, hostsOf, feedPair, killPair, generateKeyPair, signBytes };
