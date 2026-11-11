// The worker's state across restarts and throttled alarm ticks: the threat
// switch waking a new worker, a recorded storage error, and the status after
// "Revert lists".
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import packedThreat from "../src/rules/threat-network.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const threatRules = (w) => w.dnr.dynamic.filter((r) => U.isThreatRule(r.id));
const set = (w, items) => new Promise((r) => w.chrome.storage.local.set(items, r));
const packedThreatHosts = packedThreat.flatMap((r) => r.condition.requestDomains || []);
const THREAT_BODY = { urlhaus_hosts: packedThreatHosts.slice(0, 600), ublock_badware: packedThreatHosts.slice(600, 1800), dandelion_antimalware: packedThreatHosts.slice(1800, 3800) };
function bodyFor(url) {
  const src = U.SOURCES.find((s) => s.url === url || (s.mirrors || []).includes(url));
  const hosts = src && THREAT_BODY[src.name];
  if (hosts) return "! Expires: 4 days\n" + hosts.map((h) => "||" + h + "^").join("\n");
  const tag = new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12);
  return "! Expires: 4 days\nexample.org##.ad-box\n##.adsbygoogle\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
}
const listFetch = async (url) => {
  if (url.endsWith("src/rules/threat-network.json")) return new Response(JSON.stringify(packedThreat));
  return new Response(bodyFor(url), { headers: { ETag: '"e"' } });
};
const ON = { v: 1, enabled: true, features: {} };
const OFF = { v: 1, enabled: true, features: { threatTier: false } };
const START = { generalEnabled: true, generalAllowedOrigins: [], settings: ON };
const send = (w, type) => w.send({ source: "adgecko-general", type });

Deno.test("threat tier switched back on in a new worker rebuilds the refreshed threat rules", async () => {
  const w1 = loadWorker({ store: START, listFetch });
  await settle(50);
  assert((await send(w1, "updateLists")).ok, "refresh");
  await settle(300);
  const refreshed = threatRules(w1).length;
  assert(refreshed > 0, "refreshed threat rules installed");
  await set(w1, { settings: OFF });
  await settle(400);
  assert(threatRules(w1).length === 0 && w1.dnr.threatOn === false, "off removes them");
  // The worker dies; the "on" click wakes a new one that already reads "on".
  const store = structuredClone(w1.store);
  store.settings = ON;
  const w2 = loadWorker({ store, listFetch });
  w2.dnr.dynamic = structuredClone(w1.dnr.dynamic);
  w2.dnr.threatOn = false;
  w2.dnr.staticOn = w1.dnr.staticOn;
  await set(w2, { settings: ON });
  await settle(800);
  assert(w2.dnr.threatOn === true, "packed threat ruleset back on");
  assert(threatRules(w2).length === refreshed, "refreshed threat rules back: " + threatRules(w2).length + " of " + refreshed);
  // An ordinary restart with the rules in place does not rebuild them.
  const w3 = loadWorker({ store: structuredClone(w2.store), listFetch });
  w3.dnr.dynamic = structuredClone(w2.dnr.dynamic);
  await settle(400);
  const updates = w3.dnr.updates;
  await settle(400);
  assert(threatRules(w3).length === refreshed && w3.dnr.updates === updates, "no rebuild on a plain restart");
});

Deno.test("a throttled alarm tick keeps a recorded storage error in the list status", async () => {
  let failCos = false;
  const w = loadWorker({ store: START, listFetch, captureWarnings: true, setError: (items) => (failCos && "cosG" in items ? "QUOTA_BYTES quota exceeded" : null) });
  await settle(300);
  failCos = true;
  await send(w, "updateLists");
  await settle(300);
  assert(/Storage error: QUOTA_BYTES/.test(w.store.generalListStatus), "error shown: " + w.store.generalListStatus);
  w.fireAlarm("gecko-refresh");
  await settle(800);
  assert(/Storage error: QUOTA_BYTES/.test(w.store.generalListStatus), "still shown after a throttled tick: " + w.store.generalListStatus);
  assert(w.store.listState.lastError && w.store.listState.lastError.message, "recorded error kept");
  // A real attempt clears it.
  failCos = false;
  await send(w, "updateLists");
  await settle(300);
  assert(!/Storage error/.test(w.store.generalListStatus), "cleared by a real run: " + w.store.generalListStatus);
});

Deno.test("after Revert lists a throttled alarm tick does not bring back the old update time", async () => {
  const w = loadWorker({ store: START, listFetch });
  await settle(300);
  await send(w, "updateLists");
  await settle(300);
  assert(w.store.generalListUpdatedAt > 0, "update time set");
  assert((await send(w, "revertLists")).ok, "revert");
  await settle(300);
  assert(w.store.generalListUpdatedAt === null && /^Reverted/.test(w.store.generalListStatus), "reverted status");
  assert(!w.store.listState.updatedAt, "state forgets the old refresh time");
  w.fireAlarm("gecko-refresh");
  await settle(800);
  assert(w.store.generalListUpdatedAt === null && /^Reverted/.test(w.store.generalListStatus), "kept after a throttled tick: " + w.store.generalListStatus + " / " + w.store.generalListUpdatedAt);
});
