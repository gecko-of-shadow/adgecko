// The user's "Allow this domain" override (rule ids 950000+, priority
// 2,000,020) must be in place before the worker loads the packed ruleset
// for the packed exception allow rules (syncPackedAllows, about 40 ms in
// Chrome). Before this fix, onStartup queued the lists work first and the
// override write second, so a worker start left the override out until the
// packed load was done. applyGeneralState now writes the override first,
// inside the same DNR queue section.
// No timer: the check runs when the worker fetches general-network.json,
// which only syncPackedAllows does here.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";

function assert(c, l) { if (!c) throw new Error(l); }
const TC = globalThis.GeckoThreatCompile;
const OVERRIDES = ["blocked-but-wanted.example"];
const WANT = JSON.stringify(TC.buildUserAllowRules(OVERRIDES, 950000, 1000));

function watched(extra = {}) {
  const seen = [];
  let w;
  w = loadWorker({
    store: Object.assign({ generalEnabled: true, generalAllowedOrigins: [], threatAllowDomains: OVERRIDES.slice() }, extra),
    onFetch: (url) => {
      if (!url.endsWith("/src/rules/general-network.json")) return;
      seen.push(JSON.stringify(w.dnr.dynamic.filter((r) => r.id >= 950000 && r.id < 951000).sort((a, b) => a.id - b.id)));
    },
  });
  return { w, seen };
}

async function waitFor(cond, label) {
  const until = Date.now() + 10000;
  while (!cond() && Date.now() < until) await settle(10);
  assert(cond(), label);
}

Deno.test("applyGeneralState: the user override is written before the packed ruleset load", async () => {
  const { w, seen } = watched();
  await w.send({ source: "adgecko-general", type: "applyGeneralState" });
  await waitFor(() => seen.length > 0, "the packed ruleset was not loaded (syncPackedAllows did not run)");
  assert(seen[0] === WANT, "override not in place at the packed load: " + seen[0]);
});

// The task's case: the override is stored while the first apply runs. The
// store write is synchronous in the fake, and the apply reads the key after
// its first DNR write, so the read sees it. An override stored after that read
// still waits behind the lists work (its own queue section).
Deno.test("applyGeneralState: an override stored as the first apply starts is in place before the packed load", async () => {
  const { w, seen } = watched({ threatAllowDomains: [] });
  const applied = w.send({ source: "adgecko-general", type: "applyGeneralState" });
  w.chrome.storage.local.set({ threatAllowDomains: OVERRIDES.slice() });
  await waitFor(() => seen.length > 0, "the packed ruleset was not loaded (syncPackedAllows did not run)");
  assert(seen[0] === WANT, "override not in place at the packed load: " + seen[0]);
  await applied;
  await settle(100);
  assert(w.dnr.errors.length === 0, "DNR errors: " + JSON.stringify(w.dnr.errors));
});

Deno.test("onStartup: the user override is written before the packed ruleset load", async () => {
  const { w, seen } = watched();
  w.startup();
  await waitFor(() => seen.length > 0, "the packed ruleset was not loaded (syncPackedAllows did not run)");
  assert(seen[0] === WANT, "override not in place at the packed load: " + seen[0]);
  await settle(100);
  assert(w.dnr.errors.length === 0, "DNR errors: " + JSON.stringify(w.dnr.errors));
});

Deno.test("onInstalled: the user override is written before the packed ruleset load", async () => {
  const { w, seen } = watched();
  w.install({ reason: "update" });
  await waitFor(() => seen.length > 0, "the packed ruleset was not loaded (syncPackedAllows did not run)");
  assert(seen[0] === WANT, "override not in place at the packed load: " + seen[0]);
  await settle(100);
  assert(w.dnr.errors.length === 0, "DNR errors: " + JSON.stringify(w.dnr.errors));
});

Deno.test("lists switched off: applyGeneralState still writes the user override", async () => {
  const w = loadWorker({ store: { generalEnabled: false, generalAllowedOrigins: [], threatAllowDomains: OVERRIDES.slice() } });
  await w.send({ source: "adgecko-general", type: "applyGeneralState" });
  await waitFor(() => JSON.stringify(w.dnr.dynamic.filter((r) => r.id >= 950000 && r.id < 951000)) === WANT, "override missing with the lists off");
});
