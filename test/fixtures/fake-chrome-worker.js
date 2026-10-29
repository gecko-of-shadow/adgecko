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
  const dnr = { dynamic: [], staticOn: true, updates: 0, errors: [] , gets: 0};
  let bytesRead = 0;
  const runtime = {
    id: EXT,
    get lastError() { return lastError; },
    getURL: (p) => "chrome-extension://" + EXT + "/" + p,
    onMessage: { addListener(f) { onMessage = f; } },
    onInstalled: { addListener() {} }, onStartup: { addListener() {} },
  };
  const withErr = (err, cb, ...args) => { lastError = err; try { cb && cb(...args); } finally { lastError = undefined; } };
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
        set(items, cb) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = structuredClone(v); }
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
      updateEnabledRulesets(o, cb) {
        if ((o.enableRulesetIds || []).includes("general")) dnr.staticOn = true;
        if ((o.disableRulesetIds || []).includes("general")) dnr.staticOn = false;
        later(() => withErr(undefined, cb));
      },
    },
    action: { setIcon(_o, cb) { if (cb) cb(); }, setTitle() {} },
  };
  const importScripts = (...names) => {
    for (const n of names) (0, eval)(Deno.readTextFileSync(new URL(n, SRC)));
  };
  const files = {
    "src/rules/general-network.json": () => Deno.readTextFileSync(new URL("rules/general-network.json", SRC)),
    "src/rules/dnr-merge-meta.json": () => Deno.readTextFileSync(new URL("rules/dnr-merge-meta.json", SRC)),
    "src/rules/cosmetic-rules.json": () => Deno.readTextFileSync(new URL("rules/cosmetic-rules.json", SRC)),
  };
  const fakeFetch = async (url, init) => {
    await tick(opts.fetchDelay || 2);
    if (opts.onFetch) opts.onFetch(url);
    const prefix = "chrome-extension://" + EXT + "/";
    if (url.startsWith(prefix) && files[url.slice(prefix.length)]) return new Response(files[url.slice(prefix.length)]());
    if (opts.listFetch) return opts.listFetch(url, init);
    throw new TypeError("Failed to fetch");
  };
  // Startup timer suppressed like the repo tests.
  new Function("chrome", "importScripts", "setTimeout", "fetch", backgroundSource)(chrome, importScripts, opts.setTimeout || (() => 0), fakeFetch);
  const send = (message) => new Promise((resolve) => {
    const keep = onMessage(message, { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" }, resolve);
    if (keep !== true) resolve(undefined);
  });
  return { chrome, store, dnr, send, get bytesRead() { return bytesRead; }, resetBytes() { bytesRead = 0; } };
}
export const settle = (ms = 400) => tick(ms);
// Synthetic refreshed state that passes swap()'s "not smaller than half the bundle" check.
export function refreshedState(SOURCES) {
  const lists = {};
  let n = 0;
  for (const s of SOURCES) lists[s.name] = { url: s.url, fetchedAt: 1, expiresMs: 86400000, domains: Array.from({ length: 30000 }, () => "d" + (n++) + ".example") };
  return { dynamicActive: true, updatedAt: 1, lists, lastRunAt: 1 };
}
