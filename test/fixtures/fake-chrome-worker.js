// Async Chrome model for src/general-background.js (used by test/general-race.test.js): callbacks fire on a later
// macrotask (like real extension APIs), DNR updates are serialized and atomic,
// a non-unique rule id makes the whole update fail (Chrome: "Rule with id N
// does not have a unique ID."), removing a missing id is ignored.
import backgroundSource from "../../src/general-background.js" with { type: "text" };
const SRC = new URL("../../src/", import.meta.url);
export const EXT = "abcdefghijklmnopabcdefghijklmnop";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export function loadWorker(opts = {}) {
  const store = structuredClone(opts.store || {});
  const changeListeners = [];
  let onMessage = null;
  let lastError;
  const later = (fn, ms = 1) => setTimeout(fn, opts.jitter ? Math.floor(Math.random() * opts.jitter) : ms);
  const dnr = { dynamic: [], session: [], staticOn: true, threatOn: true, updates: 0, errors: [] , gets: 0};
  const fetched = [];
  const iconCalls = [];
  let bytesRead = 0;
  const runtime = {
    id: EXT,
    get lastError() { return lastError; },
    getURL: (p) => "chrome-extension://" + EXT + "/" + p,
    getManifest: () => JSON.parse(Deno.readTextFileSync(new URL("../../manifest.json", import.meta.url))),
    onMessage: { addListener(f) { onMessage = f; } },
    onInstalled: { addListener(f) { installListeners.push(f); } }, onStartup: { addListener() {} },
  };
  const installListeners = [];
  const withErr = (err, cb, ...args) => { lastError = err; try { cb && cb(...args); } finally { lastError = undefined; } };
  // Storage size like Chrome counts it (key + JSON value). opts.quotaBytes makes a
  // set that would exceed it fail with Chrome's quota message; opts.setError(items)
  // may return a message to fail any set.
  const sizeOf = (k, v) => k.length + JSON.stringify(v).length;
  const totalBytes = () => Object.entries(store).reduce((n, [k, v]) => n + sizeOf(k, v), 0);
  let peakBytes = totalBytes();
  const alarms = new Map();
  const alarmListeners = [];
  const alarmCreates = [];
  const chrome = {
    runtime,
    storage: {
      local: {
        get(keys, cb) {
          const snap = {};
          for (const k of [].concat(keys || [])) if (k in store) snap[k] = structuredClone(store[k]);
          bytesRead += JSON.stringify(snap).length;
          later(() => withErr(undefined, cb, snap));
        },
        getBytesInUse(keys, cb) {
          let n = 0;
          for (const k of [].concat(keys || [])) if (k in store) n += sizeOf(k, store[k]);
          later(() => withErr(undefined, cb, n));
        },
        set(items, cb) {
          let msg = opts.setError ? opts.setError(items) : null;
          if (!msg && opts.quotaBytes) {
            let after = totalBytes();
            for (const [k, v] of Object.entries(items)) after += sizeOf(k, v) - (k in store ? sizeOf(k, store[k]) : 0);
            if (after > opts.quotaBytes) msg = "QUOTA_BYTES quota exceeded";
          }
          if (msg) { later(() => withErr({ message: msg }, cb)); return; }
          const changes = {};
          for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = structuredClone(v); }
          peakBytes = Math.max(peakBytes, totalBytes());
          later(() => { withErr(undefined, cb); for (const l of changeListeners) l(changes, "local"); });
        },
        remove(keys, cb) { for (const k of [].concat(keys)) delete store[k]; later(() => withErr(undefined, cb)); },
      },
      session: { get(_k, cb) { cb({ listRefreshStarted: opts.sessionStarted !== false }); }, set(_o, cb) { if (cb) cb(); } },
      onChanged: { addListener(f) { changeListeners.push(f); } },
    },
    declarativeNetRequest: {
      getDynamicRules(cb) { dnr.gets++; const snap = structuredClone(dnr.dynamic); later(() => withErr(undefined, cb, snap)); },
      updateDynamicRules(o, cb) {
        // Applied in call order (Chrome queues them), atomically.
        const rm = new Set(o.removeRuleIds || []);
        const next = dnr.dynamic.filter((r) => !rm.has(r.id));
        const ids = new Set(next.map((r) => r.id));
        let err;
        for (const r of o.addRules || []) { if (ids.has(r.id)) { err = { message: "Rule with id " + r.id + " does not have a unique ID." }; break; } ids.add(r.id); }
        if (!err) { dnr.dynamic = next.concat(structuredClone(o.addRules || [])); dnr.updates++; } else dnr.errors.push(err.message);
        later(() => withErr(err, cb), opts.updateDelay || 5);
      },
      getSessionRules(cb) { const snap = structuredClone(dnr.session); later(() => withErr(undefined, cb, snap)); },
      updateSessionRules(o, cb) {
        const rm = new Set(o.removeRuleIds || []);
        dnr.session = dnr.session.filter((r) => !rm.has(r.id)).concat(structuredClone(o.addRules || []));
        later(() => withErr(undefined, cb));
      },
      updateEnabledRulesets(o, cb) {
        if ((o.enableRulesetIds || []).includes("general")) dnr.staticOn = true;
        if ((o.disableRulesetIds || []).includes("general")) dnr.staticOn = false;
        if ((o.enableRulesetIds || []).includes("threat")) dnr.threatOn = true;
        if ((o.disableRulesetIds || []).includes("threat")) dnr.threatOn = false;
        later(() => withErr(undefined, cb));
      },
    },
    action: { setIcon(o, cb) { iconCalls.push(o); if (cb) cb(); }, setTitle() {} },
    // Like Chrome before 150 when opts.strictAlarms: unknown keys throw.
    alarms: opts.noAlarms ? undefined : {
      create(name, info, cb) {
        const known = ["when", "delayInMinutes", "periodInMinutes"].concat(opts.strictAlarms ? [] : ["persistAcrossSessions"]);
        for (const k of Object.keys(info || {})) if (!known.includes(k)) throw new TypeError("Error in invocation of alarms.create: Unexpected property: '" + k + "'.");
        alarmCreates.push({ name, info: structuredClone(info) });
        alarms.set(name, { name, periodInMinutes: info.periodInMinutes, scheduledTime: Date.now() + (info.delayInMinutes || 0) * 60000 });
        if (cb) later(() => withErr(undefined, cb));
      },
      get(name, cb) { const a = alarms.get(name); later(() => withErr(undefined, cb, a ? structuredClone(a) : undefined)); },
      clear(name, cb) { const had = alarms.delete(name); if (cb) later(() => withErr(undefined, cb, had)); },
      onAlarm: { addListener(f) { alarmListeners.push(f); } },
    },
  };
  if (opts.alarms) for (const a of opts.alarms) alarms.set(a.name, a);
  const importScripts = (...names) => {
    for (const n of names) (0, eval)(Deno.readTextFileSync(new URL(n, SRC)));
  };
  const files = {
    "src/rules/general-network.json": () => Deno.readTextFileSync(new URL("rules/general-network.json", SRC)),
    "src/rules/dnr-merge-meta.json": () => Deno.readTextFileSync(new URL("rules/dnr-merge-meta.json", SRC)),
    "src/rules/cosmetic-rules.json": () => Deno.readTextFileSync(new URL("rules/cosmetic-rules.json", SRC)),
    "src/rules/threat-snapshot.json": () => Deno.readTextFileSync(new URL("rules/threat-snapshot.json", SRC)),
  };
  const fakeFetch = async (url, init) => {
    await tick(opts.fetchDelay || 2);
    fetched.push(url);
    if (opts.onFetch) opts.onFetch(url);
    const prefix = "chrome-extension://" + EXT + "/";
    if (url.startsWith(prefix) && files[url.slice(prefix.length)]) return new Response(files[url.slice(prefix.length)]());
    if (opts.listFetch) return opts.listFetch(url, init);
    throw new TypeError("Failed to fetch");
  };
  // opts.captureWarnings: the worker's console.warn calls are collected in
  // `warnings` (joined as text) instead of printed, so a test that provokes a
  // write failure on purpose can assert the warning instead of spamming the
  // run; every other console method still prints.
  const warnings = [];
  const workerConsole = opts.captureWarnings
    ? Object.assign(Object.create(console), { warn: (...args) => { warnings.push(args.map(String).join(" ")); } })
    : console;
  // Startup timer suppressed like the repo tests.
  new Function("chrome", "importScripts", "setTimeout", "fetch", "console", backgroundSource)(chrome, importScripts, opts.setTimeout || (() => 0), fakeFetch, workerConsole);
  const send = (message, sender) => new Promise((resolve) => {
    const keep = onMessage(message, sender || { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" }, resolve);
    if (keep !== true) resolve(undefined);
  });
  const fireAlarm = (name) => { for (const f of alarmListeners) f({ name, scheduledTime: Date.now() }); };
  const install = (details = { reason: "update" }) => { for (const f of installListeners) f(details); };
  return {
    chrome, store, dnr, send, iconCalls, alarms, alarmCreates, fireAlarm, install, fetched, warnings,
    get alarmListenerCount() { return alarmListeners.length; },
    get bytesRead() { return bytesRead; }, resetBytes() { bytesRead = 0; },
    get peakBytes() { return peakBytes; }, totalBytes,
  };
}
export const settle = (ms = 400) => tick(ms);
// Synthetic refreshed state that passes swap()'s "not smaller than half the bundle" check.
// Old (pre-split) layout: everything in one "generalListRefresh" value.
export function refreshedState(SOURCES) {
  const lists = {};
  let n = 0;
  for (const s of SOURCES) lists[s.name] = { url: s.url, fetchedAt: 1, expiresMs: 86400000, domains: Array.from({ length: 30000 }, () => "d" + (n++) + ".example") };
  return { dynamicActive: true, updatedAt: 1, lists, lastRunAt: 1 };
}
