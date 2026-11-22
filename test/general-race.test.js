// Overlapping background work on the general lists. The popup's switch and "Allow
// this page" both write storage (storage.onChanged -> applyGeneralState) and send an
// "applyGeneralState" message, so every click starts two runs at once.
import { loadWorker, refreshedState, settle } from "./fixtures/fake-chrome-worker.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
// List rules only: the dynamic threat tier (its own id range) stays on when lists go off.
const listRules = (w) => w.dnr.dynamic.filter((r) => U.isOurRule(r.id) && r.id < U.KEPT_RULE_ID_BASE).length;
const allowHosts = (w) => w.dnr.dynamic.filter((r) => r.id >= U.ALLOW_RULE_ID_BASE && r.id < U.ALLOW_RULE_ID_BASE + 10000)
  .map((r) => r.condition.initiatorDomains[0]);
const MSG = { source: "adgecko-general", type: "applyGeneralState" };

// What popup.js does on a click: save the setting, then message the worker.
async function popupWrite(w, patch) {
  await new Promise((r) => w.chrome.storage.local.set(patch, r));
  return w.send(MSG);
}
// The lists switch and "Allow this site" as the popup and the settings page
// write them (`settings`, `siteOverrides`). The worker reads these keys; the
// generalEnabled / generalAllowedOrigins mirrors are only its change signal
// (CONCERNS M3).
const LISTS_OFF = { settings: { v: 1, enabled: true, features: { network: false } } };
const LISTS_ON = { settings: { v: 1, enabled: true, features: {} } };

Deno.test("lists off then on keeps the refreshed rule set (no duplicate-id rebuild)", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], generalListRefresh: refreshedState(U.SOURCES) } });
  await w.send(MSG);
  await settle();
  const before = listRules(w);
  assert(before > 0 && w.dnr.staticOn, "precondition: refreshed lists active, got " + before);
  await popupWrite(w, LISTS_OFF);
  await settle();
  assert(listRules(w) === 0 && !w.dnr.staticOn, "off removes every list rule");
  await popupWrite(w, LISTS_ON);
  await settle(800);
  // Seeded in the old one-key layout; the worker migrates it to listState + listData:*.
  const st = w.store.listState;
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  assert(listRules(w) === before && w.dnr.staticOn && st.dynamicActive,
    `refreshed lists dropped: listRules=${listRules(w)} staticOn=${w.dnr.staticOn} dynamicActive=${st.dynamicActive}`);
});

Deno.test("allow then quick undo leaves the allow rules matching the setting", async () => {
  // Migrated already (settings stored): the worker's first-start migration
  // writes siteOverrides and would race the click below.
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], settings: LISTS_ON.settings, siteOverrides: {} } });
  // The undo click lands while the allow click's runs are still reading DNR.
  const dnr = w.chrome.declarativeNetRequest;
  const realGet = dnr.getDynamicRules;
  let undo = null;
  dnr.getDynamicRules = (cb) => {
    if (!undo && Object.keys(w.store.siteOverrides || {}).length) undo = popupWrite(w, { siteOverrides: {} });
    return realGet(cb);
  };
  await popupWrite(w, { siteOverrides: { "news.example": { enabled: false } } });
  assert(undo, "precondition: the undo click landed during the allow click's runs");
  await undo;
  await settle(300);
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  assert(allowHosts(w).length === 0, "allow rule left behind after undo: " + allowHosts(w));
});

Deno.test("switching lists off while a list refresh swaps rules in leaves lists off", async () => {
  const body = (tag) => "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
  const listFetch = async (url) => new Response(body(new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12)), { headers: { ETag: '"e"' } });
  // The refresh has passed its "lists on?" check and its swap is reading the
  // current rules. The off click lands in that gap.
  let swapping = false;
  const onFetch = (url) => { if (url.endsWith("src/rules/general-network.json")) swapping = true; };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch, onFetch });
  const dnr = w.chrome.declarativeNetRequest;
  const realGet = dnr.getDynamicRules;
  const realUpdate = dnr.updateDynamicRules;
  let off = null;
  let offDone = false;
  let listAddsAfter = 0;
  dnr.updateDynamicRules = (o, cb) => {
    if (offDone && (o.addRules || []).some((r) => U.isOurRule(r.id) && r.id < U.KEPT_RULE_ID_BASE)) listAddsAfter++;
    return realUpdate(o, cb);
  };
  dnr.getDynamicRules = (cb) => {
    if (!swapping || off) return realGet(cb);
    // The off click lands while the swap is reading the rules, and the read
    // is answered only after the click's runs finished or 300 ms passed. With
    // the L-5 queue the click's runs wait for the swap's section, so the
    // bounded wait runs out (an unbounded wait would wait for itself). A swap
    // outside the queue would let them finish first and then write its stale
    // list rules with the switch off: the trailing apply removes them again,
    // so that window is caught by counting list-rule writes after the click.
    off = popupWrite(w, LISTS_OFF);
    off.then(() => { offDone = true; });
    return realGet((rules) => Promise.race([off, new Promise((r) => setTimeout(r, 300))]).then(() => cb(rules)));
  };
  await w.send({ source: "adgecko-general", type: "updateLists" });
  assert(off, "precondition: the refresh swapped list rules in");
  await off;
  await settle(300);
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  assert(listAddsAfter === 0, "list rules written after the switch went off: " + listAddsAfter + " update(s)");
  assert(listRules(w) === 0 && !w.dnr.staticOn, `lists still blocking after switch-off: listRules=${listRules(w)} staticOn=${w.dnr.staticOn}`);
});
