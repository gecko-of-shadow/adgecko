// Security review L-5: every DNR writer in the worker (list refresh, lists
// switch / Allow, revert, threat switch, "Allow this domain", feed) runs
// through one queue. Two writers that read the rules and then write the same
// id range must never interleave (Chrome fails the second write: "Rule with
// id N does not have a unique ID."), and the queue must never be held across
// a list download.
import "../src/general/filter-options.js";
import { loadWorker, refreshedState, settle } from "./fixtures/fake-chrome-worker.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import packedThreat from "../src/rules/threat-network.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const APPLY = { source: "twitch-adblock-general", type: "applyGeneralState" };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const listRules = (w) => w.dnr.dynamic.filter((r) => U.isOurRule(r.id) && r.id < U.KEPT_RULE_ID_BASE).length;
const threatRules = (w) => w.dnr.dynamic.filter((r) => U.isThreatRule(r.id));
const threatAllowHosts = (w) => w.dnr.dynamic.filter((r) => r.id >= 950000 && r.id < 951000).map((r) => r.condition.requestDomains[0]).sort();
const set = (w, items) => new Promise((r) => w.chrome.storage.local.set(items, r));
// Waits until the queue is idle: an apply run queues behind everything
// already queued; the settles let storage.onChanged runs start first.
async function drain(w) {
  await settle(150);
  await w.send(APPLY);
  await settle(150);
  await w.send(APPLY);
}
// A promise that must settle within ms (a held queue shows up as "timeout").
const within = (p, ms) => Promise.race([p.then(() => "done"), tick(ms).then(() => "timeout")]);

// Synthetic list bodies: the ordinary lists get 30,000 made-up domains each;
// the three threat lists get hosts the packed threat ruleset already holds,
// so the per-refresh cap on new threat hosts never holds the rebuild.
const packedThreatHosts = packedThreat.flatMap((r) => r.condition.requestDomains || []);
const THREAT_BODY = {
  urlhaus_hosts: packedThreatHosts.slice(0, 600),
  ublock_badware: packedThreatHosts.slice(600, 1800),
  dandelion_antimalware: packedThreatHosts.slice(1800, 3800),
};
function bodyFor(url) {
  const src = U.SOURCES.find((s) => s.url === url || (s.mirrors || []).includes(url));
  const hosts = src && THREAT_BODY[src.name];
  if (hosts) return "! Expires: 4 days\n" + hosts.map((h) => "||" + h + "^").join("\n");
  const tag = new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12);
  return "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
}
const listResponse = (url) => new Response(bodyFor(url), { headers: { ETag: '"e"' } });

Deno.test("L-5: quick 'Allow this domain' changes and an install event never write the same ids twice", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] } });
  // Three changes in a row: three storage.onChanged runs start together.
  await Promise.all([
    set(w, { threatAllowDomains: ["a.example.com"] }),
    set(w, { threatAllowDomains: ["a.example.com", "b.example.com"] }),
    set(w, { threatAllowDomains: ["a.example.com", "b.example.com", "c.example.com"] }),
  ]);
  w.install();
  await drain(w);
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  const hosts = threatAllowHosts(w);
  assert(JSON.stringify(hosts) === '["a.example.com","b.example.com","c.example.com"]', "threat allow rules: " + JSON.stringify(hosts));
});

Deno.test("L-5: switching the threat tier off and on while a refresh swaps rules in leaves one clean threat rule set", async () => {
  let toggled = null;
  const listFetch = async (url) => {
    if (url.endsWith("src/rules/threat-network.json")) {
      // The swap's threat rebuild has read the current rules; the switch
      // flips off and on before it writes (the old code let both runs write).
      if (!toggled) {
        toggled = (async () => {
          await set(w, { settings: { v: 1, enabled: true, features: { threatTier: false } } });
          await tick(20);
          await set(w, { settings: { v: 1, enabled: true, features: { threatTier: true } } });
        })();
        await tick(150);
      }
      return new Response(JSON.stringify(packedThreat));
    }
    return listResponse(url);
  };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], settings: { v: 1, enabled: true, features: {} } }, listFetch });
  await settle(50);
  const res = await w.send({ source: "twitch-adblock-general", type: "updateLists" });
  assert(toggled, "precondition: the refresh rebuilt the threat rules");
  await toggled;
  await drain(w);
  assert(res && res.ok, "refresh: " + JSON.stringify(res && res.result));
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  const rules = threatRules(w);
  const ids = new Set(rules.map((r) => r.id));
  assert(rules.length > 0 && ids.size === rules.length, "threat rules: " + rules.length + " (" + ids.size + " ids)");
  const hosts = new Set(rules.flatMap((r) => r.condition.requestDomains));
  const want = new Set(Object.values(THREAT_BODY).flat());
  assert(hosts.size === want.size && [...want].every((h) => hosts.has(h)), "threat hosts " + hosts.size + " / " + want.size);
  assert(w.dnr.threatOn === true, "threat ruleset back on");
});

Deno.test("L-5: an apply run that lands during 'Revert lists' cannot rebuild from half-removed lists", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], generalListRefresh: refreshedState(U.SOURCES) } });
  await w.send(APPLY);
  await settle();
  assert(listRules(w) > 0 && w.store.listState && w.store.listState.dynamicActive, "precondition: refreshed lists active");
  // The revert has just removed the stored lists when the popup's apply lands.
  const realRemove = w.chrome.storage.local.remove;
  let racer = null;
  w.chrome.storage.local.remove = (keys, cb) => {
    const r = realRemove(keys, cb);
    if (!racer && [].concat(keys).some((k) => String(k).startsWith("listData:"))) racer = w.send(APPLY);
    return r;
  };
  const res = await w.send({ source: "twitch-adblock-general", type: "revertLists" });
  assert(racer, "precondition: an apply ran during the revert");
  await racer;
  await drain(w);
  assert(res && res.ok, "revert: " + JSON.stringify(res));
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
  const st = w.store.listState;
  assert(listRules(w) === 0, "dynamic list rules after revert: " + listRules(w));
  assert(st.dynamicActive === false && Object.keys(st.lists || {}).length === 0, "state after revert: " + JSON.stringify({ dynamicActive: st.dynamicActive, lists: Object.keys(st.lists || {}) }));
  assert(w.dnr.staticOn, "packed lists on");
});

Deno.test("L-5: the queue is not held while lists download (a click during a refresh finishes at once)", async () => {
  let clickResult = null;
  let w = null;
  const listFetch = async (url) => {
    if (!clickResult && U.isListUrl(url)) {
      const click = set(w, { generalEnabled: false }).then(() => w.send(APPLY));
      clickResult = await within(click, 3000);
    }
    return listResponse(url);
  };
  w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch });
  const res = await w.send({ source: "twitch-adblock-general", type: "updateLists" });
  await drain(w);
  assert(clickResult === "done", "the lists switch waited for the download: " + clickResult);
  // The click finished during the downloads, so the refresh's check before
  // its swap already sees the switch off (the in-section re-check is the
  // next test).
  assert(res && res.result && res.result.reason === "lists off; cached", "refresh: " + JSON.stringify(res && res.result));
  assert(listRules(w) === 0 && !w.dnr.staticOn, `lists still blocking: listRules=${listRules(w)} staticOn=${w.dnr.staticOn}`);
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
});

Deno.test("L-5: a lists switch that lands after the refresh's own check is honoured inside its swap section", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch: async (url) => listResponse(url) });
  const local = w.chrome.storage.local;
  const realSet = local.set;
  const dnr = w.chrome.declarativeNetRequest;
  const realGet = dnr.getDynamicRules;
  const realUpdate = dnr.updateDynamicRules;
  let triggered = false;
  let slowNextGet = false;
  let listAddsAfter = 0;
  dnr.getDynamicRules = (cb) => {
    if (!slowNextGet) return realGet(cb);
    slowNextGet = false;
    return realGet((rules) => setTimeout(() => cb(rules), 300));
  };
  dnr.updateDynamicRules = (o, cb) => {
    if (triggered && (o.addRules || []).some((r) => r.id >= U.LIST_RULE_ID_BASE && r.id < U.KEPT_RULE_ID_BASE && !U.isThreatRule(r.id))) listAddsAfter++;
    return realUpdate(o, cb);
  };
  // The downloads are done (the refresh stores the list metadata). A slow
  // section ("Allow this domain" sync) holds the queue and the lists switch
  // goes off behind it: the refresh's check before its swap still sees the
  // switch on; only the check inside the swap section can see it off.
  local.set = (items, cb) => {
    const st = items.listState;
    if (!triggered && st && st.lists && Object.keys(st.lists).length && "lastRejected" in st) {
      triggered = true;
      slowNextGet = true;
      realSet({ threatAllowDomains: ["a.example.com"] }, () => {});
      realSet({ generalEnabled: false }, () => {});
      setTimeout(() => realSet(items, cb), 20);
      return;
    }
    return realSet(items, cb);
  };
  const res = await w.send({ source: "twitch-adblock-general", type: "updateLists" });
  await drain(w);
  assert(triggered, "precondition: the refresh stored its list metadata");
  assert(res && res.result && res.result.reason === "lists off; cached", "refresh: " + JSON.stringify(res && res.result));
  assert(listAddsAfter === 0, "list rules added after the switch went off: " + listAddsAfter + " update(s)");
  assert(listRules(w) === 0 && !w.dnr.staticOn, `lists still blocking: listRules=${listRules(w)} staticOn=${w.dnr.staticOn}`);
  assert(w.dnr.errors.length === 0, "DNR errors: " + w.dnr.errors.join("; "));
});

Deno.test("L-5: a DNR call that throws inside a callback does not hold the queue", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] } });
  await drain(w);
  const dnr = w.chrome.declarativeNetRequest;
  const realGet = dnr.getDynamicRules;
  let thrown = 0;
  dnr.getDynamicRules = (cb) => {
    if (!thrown) {
      thrown++;
      throw new Error("simulated API failure");
    }
    return realGet(cb);
  };
  // syncThreatAllowRules hits the throw inside its storage callback.
  await set(w, { threatAllowDomains: ["a.example.com"] });
  await settle(50);
  assert(thrown === 1, "precondition: the throw happened");
  assert((await within(w.send(APPLY), 2000)) === "done", "the queue is held after a throw in a callback");
  // The next change goes through.
  await set(w, { threatAllowDomains: ["b.example.com"] });
  await drain(w);
  assert(JSON.stringify(threatAllowHosts(w)) === '["b.example.com"]', "threat allow rules: " + JSON.stringify(threatAllowHosts(w)));
});

// The queue's backstop, lifted from the worker source with a short limit.
import backgroundSource from "../src/general-background.js" with { type: "text" };
function loadQueue(maxMs) {
  const m = /const DNR_SECTION_MAX_MS = \d+;\r?\n[\s\S]*?\nfunction dnrExclusive\(op\) \{[\s\S]*?\n\}\r?\n/.exec(backgroundSource);
  assert(m, "dnrExclusive block not found in src/general-background.js");
  const block = m[0].replace(/const DNR_SECTION_MAX_MS = \d+;/, "const DNR_SECTION_MAX_MS = " + maxMs + ";");
  const warnings = [];
  const dnrExclusive = new Function("setTimeout", "clearTimeout", "console", `${block}\nreturn dnrExclusive;`)(setTimeout, clearTimeout, { warn: (...a) => warnings.push(a.join(" ")) });
  return { dnrExclusive, warnings };
}
// A section that records how many sections run at once.
function tracked(log, name, ms) {
  return async () => {
    log.active++;
    log.maxActive = Math.max(log.maxActive, log.active);
    log.order.push(name + "+");
    await tick(ms);
    log.order.push(name + "-");
    log.active--;
  };
}

Deno.test("L-5: the backstop timer starts with each section, so sections queued together still run one at a time", async () => {
  const { dnrExclusive, warnings } = loadQueue(100);
  // No stall: together longer than the limit, each well under it.
  const log = { active: 0, maxActive: 0, order: [] };
  await Promise.all([dnrExclusive(tracked(log, "a", 60)), dnrExclusive(tracked(log, "b", 50)), dnrExclusive(tracked(log, "c", 40))]);
  assert(log.maxActive === 1 && log.order.join(" ") === "a+ a- b+ b- c+ c-", "overlap without a stall: " + log.order.join(" "));
  assert(warnings.length === 0, "backstop fired without a stall: " + warnings.join("; "));

  // A stuck head: after the limit the next section runs, and the one after it
  // still waits for that one (only the stuck head may overlap).
  const log2 = { active: 0, maxActive: 0, order: [] };
  const stuck = dnrExclusive(() => new Promise(() => {})); // never settles
  const b = dnrExclusive(tracked(log2, "b", 40));
  const c = dnrExclusive(tracked(log2, "c", 40));
  assert((await within(Promise.all([b, c]), 2000)) === "done", "queue held by a stuck section");
  assert(log2.maxActive === 1 && log2.order.join(" ") === "b+ b- c+ c-", "sections overlapped after the backstop: " + log2.order.join(" "));
  assert(warnings.length === 1, "one backstop warning: " + warnings.length);
  // The stuck section's own caller moves on too (its chain is not held).
  const got = await within(stuck.then((r) => { stuckResult = r; }), 500);
  assert(got === "done" && stuckResult && stuckResult.ok === false && stuckResult.timedOut === true, "stuck caller: " + JSON.stringify(stuckResult));
});
let stuckResult = null;

Deno.test("L-5: a section that throws or rejects does not hold the queue, and its caller sees the error", async () => {
  const { dnrExclusive, warnings } = loadQueue(1000);
  const sync = dnrExclusive(() => { throw new Error("sync"); });
  const rejected = dnrExclusive(() => Promise.reject(new Error("async")));
  const after = dnrExclusive(async () => "ran");
  const all = Promise.allSettled([sync, rejected, after]);
  // Well under the 1 s backstop: the slots were released by the throw and
  // the rejection themselves, not by the timer.
  assert((await within(all, 200)) === "done", "the queue waited for the backstop after a throw or rejection");
  const got = await all;
  assert(got[0].status === "rejected" && got[0].reason.message === "sync", "sync throw reaches the caller");
  assert(got[1].status === "rejected" && got[1].reason.message === "async", "rejection reaches the caller");
  assert(got[2].status === "fulfilled" && got[2].value === "ran", "the next section still runs");
  assert(warnings.length === 0, "backstop fired: " + warnings.join("; "));
});

// Engine side: refresh() takes the section only around its rule writes.
function engineDeps({ fetchFails = false, offInside = false } = {}) {
  const state = {};
  let dynamic = [];
  const data = {};
  const log = { violations: [], sections: 0, fetches: 0, updates: 0 };
  let inLock = false;
  const dnrCall = (what) => { if (!inLock) log.violations.push(what + " outside the DNR section"); };
  const deps = {
    log, get dynamic() { return dynamic; },
    exclusive: async (fn) => {
      if (inLock) log.violations.push("nested section");
      inLock = true;
      log.sections++;
      try {
        return await fn();
      } finally {
        inLock = false;
      }
    },
    fetch: async (url) => {
      if (inLock) log.violations.push("download inside the DNR section: " + url);
      log.fetches++;
      if (fetchFails) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, headers: new Headers({ ETag: '"e"' }), text: async () => bodyFor(url) };
    },
    now: () => 1e12,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (name, payload) => { data[name] = structuredClone(payload); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => { dnrCall("getDynamicRules"); return dynamic.slice(); },
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dnrCall("updateDynamicRules");
      log.updates++;
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async () => { dnrCall("setStaticEnabled"); },
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
    enabled: () => !(offInside && inLock),
  };
  return deps;
}

Deno.test("L-5 engine: refresh writes rules only inside deps.exclusive and downloads outside it", async () => {
  const d = engineDeps();
  const r = await U.refresh(d, { manual: true });
  assert(r.ok && r.rules > 0, JSON.stringify(r));
  assert(d.log.violations.length === 0, d.log.violations.join("; "));
  assert(d.log.sections === 1 && d.log.fetches === U.SOURCES.length && d.log.updates > 0, JSON.stringify(d.log));

  const failing = engineDeps({ fetchFails: true });
  const rf = await U.refresh(failing, { manual: true });
  assert(!rf.ok, "failed downloads report a failure");
  assert(failing.log.violations.length === 0 && failing.log.sections === 1, JSON.stringify(failing.log));

  // The switch went off between the downloads and the section: nothing added.
  const off = engineDeps({ offInside: true });
  const ro = await U.refresh(off, { manual: true });
  assert(ro.ok && ro.reason === "lists off; cached", JSON.stringify(ro));
  assert(off.log.updates === 0 && off.dynamic.length === 0 && off.log.violations.length === 0, JSON.stringify(off.log));
});

Deno.test("L-5 engine: entry points the worker wraps whole never take the section themselves (no self-deadlock)", async () => {
  const d = engineDeps();
  await U.refresh(d, { manual: true });
  let calls = 0;
  const deps = Object.assign(d, { exclusive: async (fn) => { calls++; return fn(); } });
  await U.applyEnabled(deps, true);
  await U.applyEnabled(deps, false);
  await U.rebuildThreatRules(deps);
  await U.removeThreatRules(deps);
  await U.revertLists(deps);
  assert(calls === 0, "exclusive called " + calls + " time(s) from a wrapped entry point");
});
