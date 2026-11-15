// Per-site allow rules: legacyMirror emits https:// and http:// for each allowed
// host, so buildAllowRules makes two rules per host with ids from 900000 up and no
// upper bound, while syncAllowRules only removes ids 900000-909999. With 5,001
// allowed hosts the ids reach 910001; the next sync re-adds 910000/910001 without
// removing them, the DNR update fails on duplicate ids and "Block again" never
// removes an allow rule.
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }

const MSG = { source: "adgecko-general", type: "applyGeneralState" };
const ALLOW_BASE = 900000;
const allowRules = (w) => w.dnr.dynamic.filter((r) => r.id >= ALLOW_BASE && r.id < 950000);

async function write(w, patch) {
  await new Promise((r) => w.chrome.storage.local.set(patch, r));
  return w.send(MSG);
}

Deno.test("5,001 allowed sites: 'Block again' on one still removes its allow rule", async () => {
  const overrides = {};
  for (let i = 0; i < 5001; i++) overrides["site" + i + ".example"] = { enabled: false };
  const w = loadWorker({ store: { settings: { v: 1, enabled: true, features: {} }, siteOverrides: overrides } });
  await w.send(MSG);
  await settle(800);
  assert(w.store.generalAllowedOrigins && w.store.generalAllowedOrigins.length === 10002,
    "precondition: mirror holds 10,002 origins, got " + (w.store.generalAllowedOrigins || []).length);
  // Force a sync with the full list in place.
  await w.send(MSG);
  await settle(800);
  const hostsBefore = new Set(allowRules(w).map((r) => r.condition.initiatorDomains[0]));
  assert(hostsBefore.has("site0.example"), "precondition: site0.example allowed");

  // "Block again" on site0.example.
  const next = structuredClone(overrides);
  delete next["site0.example"];
  await write(w, { siteOverrides: next });
  await settle(1500);
  await w.send(MSG);
  await settle(800);

  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.slice(0, 3).join("; "));
  const hosts = allowRules(w).map((r) => r.condition.initiatorDomains[0]);
  assert(!hosts.includes("site0.example"), "allow rule for site0.example left behind after Block again");
});
