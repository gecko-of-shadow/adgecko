// Final review (0.3.5) storage budget: a real-list refresh needed 12.9 MB of
// chrome.storage.local (quota 10,485,760; no unlimitedStorage permission), 5.19 MB
// of it from AdGuard Base hide rules, so the merged hide sheet write failed
// with "QUOTA_BYTES quota exceeded" on every refresh. Fix: AdGuard Base gives
// network rules only.
//
// This test runs a fresh-install refresh of the REAL lists through the worker
// model (test/fixtures/fake-chrome-worker.js) with Chrome's quota enforced. It
// reads the packer's cache, scripts/.list-cache/<name>.txt (git-ignored), and
// is skipped when the cache does not hold every list (CI has no cache).
// Peak bytes must stay <= 9,000,000: about 1.4 MB headroom for list growth.
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import { loadWorker } from "./fixtures/fake-chrome-worker.js";
import source from "../src/general/update.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);

const QUOTA = 10485760;
const PEAK_LIMIT = 9000000;
const CACHE = new URL("../scripts/.list-cache/", import.meta.url);
const cached = (name) => {
  try {
    return Deno.statSync(new URL(name + ".txt", CACHE)).isFile;
  } catch {
    return false;
  }
};
const haveCache = U.SOURCES.every((s) => cached(s.name));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

Deno.test({
  name: "storage budget: fresh-install refresh of the real lists fits the 10 MB quota with headroom",
  ignore: !haveCache,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const urlToName = new Map();
    for (const s of U.SOURCES) for (const u of [s.url].concat(s.mirrors || [])) urlToName.set(u, s.name);
    const listFetch = async (url) => {
      const name = urlToName.get(url);
      if (!name) throw new TypeError("Failed to fetch (not a list URL: " + url + ")");
      // Chrome receives LF line endings from the list servers.
      const text = Deno.readTextFileSync(new URL(name + ".txt", CACHE)).replace(/\r\n/g, "\n");
      return new Response(text, { headers: { ETag: '"' + name + '"' } });
    };
    const w = loadWorker({ store: {}, listFetch, captureWarnings: true, quotaBytes: QUOTA });
    await tick(200);
    w.install({ reason: "install" });
    for (let i = 0; i < 1200 && !(w.store.listState && w.store.listState.lastRunAt); i++) await tick(250);
    // Let the trailing writes settle.
    let last = -1;
    for (let i = 0; i < 60; i++) {
      await tick(250);
      const t = w.totalBytes();
      if (t === last) break;
      last = t;
    }
    const st = w.store.listState || {};
    const peak = w.peakBytes;
    console.log("storage budget: peak " + peak + " bytes, final " + w.totalBytes() + " bytes, " + Object.keys(w.store).length + " keys (quota " + QUOTA + ", limit " + PEAK_LIMIT + ")");
    assert(st.lastRunAt > 0, "refresh finished: " + JSON.stringify({ lastErrors: st.lastErrors, lastError: st.lastError }));
    assert(!st.lastError, "no storage error: " + JSON.stringify(st.lastError));
    assert(!/Storage error/.test(JSON.stringify(w.store.generalListStatus || "")), "status: " + JSON.stringify(w.store.generalListStatus));
    assert(!w.warnings.some((x) => /QUOTA_BYTES/.test(x)), "no quota warning: " + w.warnings.join(" | "));
    assert(Object.keys(st.lastErrors || {}).length === 0, "every list parsed: " + JSON.stringify(st.lastErrors));
    const meta = w.store.cosMeta;
    assert(meta && meta.source === "refresh", "hide sheet written from the refresh: " + JSON.stringify(meta && { source: meta.source, count: meta.count }));
    const ag = w.store["listData:adguard_base"];
    assert(ag && Array.isArray(ag.domains) && ag.domains.length > 0, "AdGuard network data stored");
    assert(!("cosmetic" in ag), "AdGuard payload carries no hide data");
    assert(st.dynamicActive === true, "list rules active");
    assert(peak <= PEAK_LIMIT, "peak " + peak + " bytes > " + PEAK_LIMIT);
  },
});
