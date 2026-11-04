/**
 * General-list UI worker: icon glow, DNR enable/allow sync, manual Update signal.
 * Does not touch Twitch / YouTube / Kick playback scripts.
 * Filter lists: refreshed from the "gecko-refresh" alarm (every 3 h, at most
 * one real run per 12 h, per-list expiry respected) and on popup Update.
 */
importScripts("settings/features.js", "general-settings.js", "general/filter-options.js", "threat/psl.js", "threat/protected-hosts.js", "threat/compile.js", "general/update.js", "general/cosmetic-parse.js",
  "feed/config.js", "feed/keys.js", "feed/canonical.js", "feed/schema.js", "feed/verify.js", "feed/compile.js", "feed/client.js");
const TC = self.GeckoThreatCompile;
const FC = self.GeckoFeedClient;
const CP = self.GeneralCosmeticParse;
const GU = self.GeneralAdblockUpdate;

const GS = self.GeneralSettings;
const KEYS = GS.STORAGE_KEYS;

// Relative to this worker (src/). Bare "icons/..." fails in Chrome with "Failed
// to fetch"; a leading "/" works but the packager only follows relative paths.
const ICON_WORKING = {
  16: "../icons/icon16-working.png",
  48: "../icons/icon48-working.png",
  128: "../icons/icon128-working.png",
};
const ICON_OFF = {
  16: "../icons/icon16-off.png",
  48: "../icons/icon48-off.png",
  128: "../icons/icon128-off.png",
};

// Security review L-5: every DNR write (dynamic rules, enabled rulesets,
// session rules) goes through this one queue, one section at a time. Two
// writers that read the rules and then write the same id range (a list
// rebuild and the lists switch, two threat rebuilds, two "Allow this domain"
// syncs) used to interleave; the second write failed on duplicate ids and the
// refreshed lists fell back to the packed ones. Sections are short and local:
// list downloads and feed fetches run outside them.
// Not reentrant: code inside a section must never wait for another
// dnrExclusive() call (it would wait for itself). Engine calls made inside a
// section get listDeps() without `exclusive`; only refreshLists() passes it.
// Backstop: a section that has not settled DNR_SECTION_MAX_MS after it
// STARTED (a lost callback) stops holding the queue, so one stuck run cannot
// block every later DNR write until the worker restarts. The timer starts
// with the section, not when it is queued: sections queued together must
// still run one after another. Real sections take seconds. The caller then
// gets DNR_TIMED_OUT ({ok:false, reason, timedOut}), so its own chain
// (settings sync, refresh, revert) moves on too. A stuck section that wakes
// up after the backstop can still write next to the next one; no backstop
// can prevent that.
const DNR_SECTION_MAX_MS = 120000;
const DNR_TIMED_OUT = Object.freeze({ ok: false, reason: "DNR update timed out", error: "DNR update timed out", timedOut: true });
let dnrQueue = Promise.resolve();
function dnrExclusive(op) {
  let release;
  const slot = new Promise((resolve) => {
    release = resolve;
  });
  const prev = dnrQueue;
  dnrQueue = slot;
  return prev.then(() => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn("twitch-adblock: a DNR update took over " + DNR_SECTION_MAX_MS / 1000 + " s; not waiting for it any longer");
      release();
      resolve(DNR_TIMED_OUT);
    }, DNR_SECTION_MAX_MS);
    let run;
    try {
      run = Promise.resolve(op());
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then((value) => {
      clearTimeout(timer);
      release();
      resolve(value);
    }, (e) => {
      clearTimeout(timer);
      release();
      reject(e);
    });
  }));
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.keys(GS.DEFAULTS), (stored) => {
      void chrome.runtime.lastError;
      resolve(GS.withDefaults(stored));
    });
  });
}

function setIcon(enabled) {
  const path = enabled ? ICON_WORKING : ICON_OFF;
  try {
    chrome.action.setIcon({ path }, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn("twitch-adblock: toolbar icon not set:", err.message);
    });
    chrome.action.setTitle({
      title: enabled
        ? "twitch-adblock · lists on"
        : "twitch-adblock · lists off",
    });
  } catch {
    /* action API unavailable in tests */
  }
}

// Called inside a DNR queue section only (applyGeneralStateNow).
function enableRuleset(enabled) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateEnabledRulesets) {
    return Promise.resolve({ ok: false, error: "dnr-missing" });
  }
  const update = enabled
    ? { enableRulesetIds: [GS.RULESET_ID], disableRulesetIds: [] }
    : { enableRulesetIds: [], disableRulesetIds: [GS.RULESET_ID] };
  return new Promise((resolve) => {
    try {
      chrome.declarativeNetRequest.updateEnabledRulesets(update, () => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message || String(err) });
        else resolve({ ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e) });
    }
  });
}

function buildAllowRules(origins) {
  const rules = [];
  let id = GS.ALLOW_RULE_ID_BASE;
  for (const origin of origins || []) {
    if (!origin || GS.isHardExcludedOrigin(origin)) continue;
    let host;
    try {
      host = new URL(origin).hostname;
    } catch {
      continue;
    }
    if (!host || GS.isHardExcludedHost(host)) continue;
    rules.push({
      id: id++,
      priority: 10000,
      action: { type: "allow" },
      condition: {
        initiatorDomains: [host],
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "stylesheet",
          "script",
          "image",
          "font",
          "object",
          "xmlhttprequest",
          "ping",
          "media",
          "websocket",
          "other",
        ],
      },
    });
  }
  return rules;
}

// Called inside a DNR queue section only (applyGeneralStateNow).
function syncAllowRules(origins) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return Promise.resolve({ ok: false, error: "dnr-missing" });
  }
  return new Promise((resolve) => {
    // Every path resolves (also a throw inside a callback): this runs in a
    // DNR queue section, and a promise that never settles would hold it.
    const fail = (e) => resolve({ ok: false, error: String(e && e.message || e) });
    try {
      chrome.declarativeNetRequest.getDynamicRules((existing) => {
        try {
          void chrome.runtime.lastError;
          const removeRuleIds = (existing || [])
            .filter((r) => r.id >= GS.ALLOW_RULE_ID_BASE && r.id < GS.ALLOW_RULE_ID_BASE + 10000)
            .map((r) => r.id);
          const addRules = buildAllowRules(origins);
          chrome.declarativeNetRequest.updateDynamicRules(
            { removeRuleIds, addRules },
            () => {
              const err = chrome.runtime.lastError;
              if (err) resolve({ ok: false, error: err.message || String(err) });
              else resolve({ ok: true, count: addRules.length });
            },
          );
        } catch (e) {
          fail(e);
        }
      });
    } catch (e) {
      fail(e);
    }
  });
}

// User "Allow this domain" override (priority 2,000,020, all resource types
// incl. main_frame): beats the threat tier and the priority-1 list rules, so it
// also opens a page the filter lists block from opening. Domains in storage key
// `threatAllowDomains`; the text box comes with the settings page.
const THREAT_ALLOW_KEY = "threatAllowDomains";
const THREAT_ALLOW_ID_BASE = 950000;
const THREAT_ALLOW_MAX = 1000;
// Install, startup and every change of the key each start one: queued, so
// two quick changes never both add the same ids. Each run reads the key when
// its turn comes, so the last run always writes the newest list.
function syncThreatAllowRules() {
  return dnrExclusive(syncThreatAllowRulesNow);
}

function syncThreatAllowRulesNow() {
  if (!TC || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return Promise.resolve({ ok: false, error: "dnr-missing" });
  }
  return new Promise((resolve) => {
    // Every path resolves (see syncAllowRules).
    const fail = (e) => resolve({ ok: false, error: String(e && e.message || e) });
    try {
      chrome.storage.local.get([THREAT_ALLOW_KEY], (s) => {
        try {
          void chrome.runtime.lastError;
          const domains = Array.isArray(s && s[THREAT_ALLOW_KEY]) ? s[THREAT_ALLOW_KEY] : [];
          chrome.declarativeNetRequest.getDynamicRules((existing) => {
            try {
              void chrome.runtime.lastError;
              const removeRuleIds = (existing || [])
                .filter((r) => r.id >= THREAT_ALLOW_ID_BASE && r.id < THREAT_ALLOW_ID_BASE + THREAT_ALLOW_MAX)
                .map((r) => r.id);
              const addRules = TC.buildUserAllowRules(domains, THREAT_ALLOW_ID_BASE, THREAT_ALLOW_MAX);
              chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }, () => {
                const err = chrome.runtime.lastError;
                resolve(err ? { ok: false, error: err.message || String(err) } : { ok: true, count: addRules.length });
              });
            } catch (e) {
              fail(e);
            }
          });
        } catch (e) {
          fail(e);
        }
      });
    } catch (e) {
      fail(e);
    }
  });
}

// ---- feature switches (src/settings/features.js) ----
// `settings` / `siteOverrides` are the source of truth (popup, settings page).
// The worker migrates the old keys once and keeps generalEnabled /
// generalAllowedOrigins as derived mirrors (the DNR list code and older
// content scripts read those), the `threat` ruleset on/off, and feedPaused.
const FEAT = self.GeckoFeatures;
let threatOn = null; // unknown until the first sync at worker start

async function migrateSettings() {
  const stored = await localGet(["settings", "siteOverrides", "generalEnabled", "generalAllowedOrigins"]).catch(() => ({}));
  const migrated = FEAT.migrateLegacy(stored);
  if (migrated) await localSet({ settings: migrated.settings, siteOverrides: migrated.siteOverrides }).catch(() => {});
}

// Called inside a DNR queue section only (syncFromSettings).
function setThreatRuleset(on) {
  return new Promise((resolve) => {
    try {
      chrome.declarativeNetRequest.updateEnabledRulesets(on ? { enableRulesetIds: ["threat"], disableRulesetIds: [] } : { enableRulesetIds: [], disableRulesetIds: ["threat"] }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

let settingsQueue = Promise.resolve();
function syncFromSettings() {
  const run = settingsQueue.then(async () => {
    await settingsReady;
    const stored = await localGet(["settings", "siteOverrides", "generalEnabled", "generalAllowedOrigins", "feedPaused"]).catch(() => ({}));
    if (!stored.settings) return;
    const s = FEAT.normalizeSettings(stored.settings);
    const mirror = FEAT.legacyMirror(stored.settings, stored.siteOverrides);
    const patch = {};
    if (stored.generalEnabled !== mirror.generalEnabled) patch.generalEnabled = mirror.generalEnabled;
    if (JSON.stringify(stored.generalAllowedOrigins || []) !== JSON.stringify(mirror.generalAllowedOrigins)) patch.generalAllowedOrigins = mirror.generalAllowedOrigins;
    const paused = !(s.enabled && s.features.threatFeed);
    if ((stored.feedPaused === true) !== paused) patch.feedPaused = paused;
    if (Object.keys(patch).length) await localSet(patch).catch(() => {});
    const nextThreat = s.enabled && s.features.threatTier;
    if (nextThreat !== threatOn) {
      // One DNR queue section: a list swap running now finishes first (and
      // used the old value); the next one sees the new value. The storage
      // patch above stays outside: it starts applyGeneralState, which queues.
      await dnrExclusive(async () => {
        const firstSync = threatOn === null;
        threatOn = nextThreat;
        await setThreatRuleset(nextThreat);
        // At worker start only the ruleset state is lined up (the refreshed
        // rules are already in place); a real switch rebuilds or removes them.
        if (!nextThreat) await GU.removeThreatRules(listDeps()).catch(() => {});
        else if (!firstSync) await GU.rebuildThreatRules(listDeps()).catch(() => {});
      });
    }
  });
  settingsQueue = run.catch(() => {});
  return run;
}

// Every worker start: migrate once, then line the derived state up.
const settingsReady = migrateSettings().catch(() => {});
syncFromSettings();

// ---- signed threat feed (dormant until configured; src/feed/) ----
function feedDeps() {
  const dnr = chrome.declarativeNetRequest;
  const getKey = (key) => new Promise((resolve) => chrome.storage.local.get([key], (s) => {
    void chrome.runtime.lastError;
    resolve(s ? s[key] : undefined);
  }));
  const manifest = () => {
    try {
      return chrome.runtime.getManifest() || {};
    } catch {
      return {};
    }
  };
  return {
    config: self.GeckoFeedConfig,
    keys: { feedKeys: self.GeckoFeedKeys.FEED_KEYS, killKeys: self.GeckoFeedKeys.KILL_KEYS },
    manifest,
    extensionVersion: manifest().version,
    protectedReason: self.GeckoProtectedHosts.protectedReason,
    fetch: (url, init) => {
      const origin = self.GeckoFeedConfig.FEED_ORIGIN;
      if (!origin || !url.startsWith(origin + "/")) return Promise.reject(new Error("not the feed host"));
      return fetch(url, init);
    },
    now: () => Date.now(),
    getState: async () => (await getKey(FC.STATE_KEY)) || {},
    setState: async (patch) => {
      const cur = (await getKey(FC.STATE_KEY)) || {};
      const next = Object.assign({}, cur, patch);
      next.text = FC.statusText(next, false);
      await localSet({ [FC.STATE_KEY]: next });
    },
    getCache: async () => (await getKey(FC.CACHE_KEY)) || {},
    setCache: (cache) => localSet({ [FC.CACHE_KEY]: cache }),
    getPaused: async () => (await getKey(FC.PAUSE_KEY)) === true,
    getSessionRules: () => new Promise((resolve) => dnr.getSessionRules((r) => {
      void chrome.runtime.lastError;
      resolve(r || []);
    })),
    // The write goes through the DNR queue like every other DNR write. The
    // read before it (feed rule ids) needs no lock: the feed is the only
    // writer of session rules and feedRun() runs one feed operation at a time.
    updateSessionRules: (opts) => dnrExclusive(() => cb((done) => dnr.updateSessionRules(opts, done))).then((r) => {
      if (r === DNR_TIMED_OUT) throw new Error(r.reason);
      return r;
    }),
    loadSnapshot: async () => (await fetch(chrome.runtime.getURL("src/rules/threat-snapshot.json"))).json(),
  };
}

// One feed operation at a time (alarm check, startup re-apply, pause switch).
let feedQueue = Promise.resolve();
function feedRun(op) {
  if (!FC || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return Promise.resolve({ ok: false, reason: "unavailable" });
  const run = feedQueue.then(() => op(feedDeps())).catch((e) => ({ ok: false, reason: String(e && e.message || e) }));
  feedQueue = run.catch(() => {});
  return run;
}
const applyCachedFeed = () => feedRun((d) => FC.applyCached(d));
const checkFeedNow = () => feedRun((d) => FC.checkFeed(d));

// Called inside a DNR queue section only (applyGeneralStateNow). Never rejects.
function ensureListAllowRule() {
  return new Promise((resolve) => {
    try {
      const feed = FC && FC.configured(feedDeps());
      const rule = GU.listAllowRule(chrome.runtime.id, feed && feed.ok ? [new URL(feed.origin).hostname] : []);
      chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [rule.id], addRules: [rule] }, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn("twitch-adblock: list allow rule:", err.message);
        resolve();
      });
    } catch (e) {
      console.warn("twitch-adblock: list allow rule:", e && e.message);
      resolve();
    }
  });
}

// The popup's switch and "Allow this page" both write storage (storage.onChanged)
// and message the worker, so each click starts two runs. Each run is one DNR
// queue section: two overlapping runs read the same rules and the second
// rebuild failed on duplicate rule ids, dropping refreshed lists back to the
// packed ones.
function applyGeneralState() {
  return dnrExclusive(applyGeneralStateNow);
}

async function applyGeneralStateNow() {
  await ensureListAllowRule();
  const settings = await getSettings();
  const enabled = settings.generalEnabled !== false;
  currentEnabled = enabled;
  setIcon(enabled);
  let ruleset;
  try {
    ruleset = await GU.applyEnabled(listDeps(), enabled);
  } catch (e) {
    ruleset = await enableRuleset(enabled);
  }
  const allows = enabled
    ? await syncAllowRules(settings.generalAllowedOrigins)
    : await syncAllowRules([]);
  return { ok: true, enabled, ruleset, allows };
}

// Storage layout (worker only; the popup and content scripts never read these):
//   listState            small run metadata (see general/update.js), < a few KB
//   listData:<list name> one list's parsed payload {domains, cosmetic?}
// Before this split everything sat in one ~6 MB "generalListRefresh" key that
// was re-read and rewritten 4 times per refresh, and write errors were dropped.
const LIST_STATE_KEY = "listState";
const LIST_DATA_PREFIX = "listData:";
const OLD_LIST_STATE_KEY = "generalListRefresh";

function cb(fn) {
  return new Promise((resolve, reject) => {
    fn(() => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

function localGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (s) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve(s || {});
    });
  });
}

// Every storage.local write in the worker goes through here: a failure (quota,
// I/O) is remembered and shown in the popup's list status instead of vanishing.
let lastWriteError = null;
async function localSet(items) {
  try {
    await cb((done) => chrome.storage.local.set(items, done));
  } catch (e) {
    recordWriteError(e, Object.keys(items));
    throw e;
  }
}
async function localRemove(keys) {
  try {
    await cb((done) => chrome.storage.local.remove(keys, done));
  } catch (e) {
    recordWriteError(e, keys);
    throw e;
  }
}
function recordWriteError(e, keys) {
  const record = { message: String(e && e.message || e), keys: [].concat(keys || []).slice(0, 3), at: Date.now() };
  lastWriteError = record;
  console.warn("twitch-adblock: storage write failed:", record.message);
  // Small key, so this usually still fits when a big payload write did not.
  // Raw set (no recursion into recordWriteError); same queue as setListState.
  const run = stateQueue.then(async () => {
    const cur = (await localGet([LIST_STATE_KEY]).catch(() => ({})))[LIST_STATE_KEY] || {};
    await new Promise((resolve) => {
      chrome.storage.local.set({ [LIST_STATE_KEY]: Object.assign({}, cur, { lastError: record }) }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  });
  stateQueue = run.catch(() => {});
}

// One-time move from the old single key. One list at a time, so peak storage
// is the old blob plus one list (the whole copy would not fit next to it):
// write the list's payload key, read it back and check it, then drop that
// list's arrays from the old blob. Resumable after a crash at any point; the
// old key is removed only once the new state key reads back.
async function migrateListStorage() {
  const s = await localGet([OLD_LIST_STATE_KEY]);
  const old = s[OLD_LIST_STATE_KEY];
  if (!old || typeof old !== "object") return { migrated: false };
  const lists = Object.assign({}, old.lists || {});
  for (const name of Object.keys(lists)) {
    const entry = lists[name];
    if (!entry || !Array.isArray(entry.domains)) continue; // moved already
    const payload = { domains: entry.domains };
    if (entry.cosmetic) payload.cosmetic = entry.cosmetic;
    const key = LIST_DATA_PREFIX + name;
    await localSet({ [key]: payload });
    const back = (await localGet([key]))[key];
    if (!back || !Array.isArray(back.domains) || back.domains.length !== entry.domains.length) {
      throw new Error("list storage migration: " + name + " did not read back");
    }
    lists[name] = Object.assign(GU.listMeta(entry), { count: entry.domains.length, cosmetic: !!entry.cosmetic });
    old.lists = lists;
    await localSet({ [OLD_LIST_STATE_KEY]: old });
  }
  const next = Object.assign({}, old, { lists, schema: 2 });
  await localSet({ [LIST_STATE_KEY]: next });
  const back = (await localGet([LIST_STATE_KEY]))[LIST_STATE_KEY];
  if (!back || back.schema !== 2) throw new Error("list storage migration: state did not read back");
  await localRemove([OLD_LIST_STATE_KEY]);
  return { migrated: true, lists: Object.keys(lists).length };
}

let migrationReady = null;
function storageReady() {
  if (!migrationReady) {
    migrationReady = migrateListStorage().catch((e) => {
      recordWriteError(e, [OLD_LIST_STATE_KEY]);
      return { migrated: false, error: String(e && e.message || e) };
    });
  }
  return migrationReady;
}

async function getListState() {
  await storageReady();
  return (await localGet([LIST_STATE_KEY]))[LIST_STATE_KEY] || {};
}

// Serialized so two patches never read the same old state.
let stateQueue = Promise.resolve();
function setListState(patch) {
  const run = stateQueue.then(async () => {
    await storageReady();
    const cur = (await localGet([LIST_STATE_KEY]))[LIST_STATE_KEY] || {};
    await localSet({ [LIST_STATE_KEY]: Object.assign({}, cur, patch, { schema: 2 }) });
  });
  stateQueue = run.catch(() => {});
  return run;
}

function listDeps() {
  const dnr = chrome.declarativeNetRequest;
  return {
    fetch: (url, init) => {
      if (!GU.isListUrl(url)) return Promise.reject(new Error("not a list host"));
      return fetch(url, init);
    },
    now: () => Date.now(),
    getState: getListState,
    setState: setListState,
    getListData: async (names) => {
      await storageReady();
      const got = await localGet(names.map((n) => LIST_DATA_PREFIX + n));
      const out = {};
      for (const n of names) if (got[LIST_DATA_PREFIX + n]) out[n] = got[LIST_DATA_PREFIX + n];
      return out;
    },
    setListData: async (name, payload) => {
      await storageReady();
      await localSet({ [LIST_DATA_PREFIX + name]: payload });
    },
    removeListData: async (names) => {
      await storageReady();
      await localRemove(names.map((n) => LIST_DATA_PREFIX + n));
    },
    // Size only, so checking for a payload does not read megabytes.
    listDataPresent: async (names) => {
      await storageReady();
      const local = chrome.storage.local;
      if (typeof local.getBytesInUse !== "function") {
        const got = await localGet(names.map((n) => LIST_DATA_PREFIX + n));
        return names.filter((n) => got[LIST_DATA_PREFIX + n]);
      }
      const out = [];
      for (const n of names) {
        const bytes = await new Promise((resolve) => local.getBytesInUse([LIST_DATA_PREFIX + n], (b) => {
          void chrome.runtime.lastError;
          resolve(b || 0);
        }));
        if (bytes > 0) out.push(n);
      }
      return out;
    },
    getDynamicRules: () => new Promise((resolve) => dnr.getDynamicRules((r) => {
      void chrome.runtime.lastError;
      resolve(r || []);
    })),
    updateDynamicRules: (opts) => cb((done) => dnr.updateDynamicRules(opts, done)),
    setStaticEnabled: (on) => cb((done) => dnr.updateEnabledRulesets(
      on ? { enableRulesetIds: [GS.RULESET_ID], disableRulesetIds: [] } : { enableRulesetIds: [], disableRulesetIds: [GS.RULESET_ID] },
      done,
    )),
    loadBundled: async () => {
      const res = await fetch(chrome.runtime.getURL("src/rules/general-network.json"));
      const meta = await fetch(chrome.runtime.getURL("src/rules/dnr-merge-meta.json")).then((r) => r.json()).catch(() => ({}));
      return { rules: await res.json(), extraIds: meta.extra_tracker_rule_id ? [meta.extra_tracker_rule_id] : [] };
    },
    // Baseline for the per-refresh cap on new threat hosts (first refresh only).
    loadPackedThreatRules: async () => (await fetch(chrome.runtime.getURL("src/rules/threat-network.json"))).json(),
    enabled: () => currentEnabled,
    threatEnabled: () => threatOn !== false,
    cosmeticParse: CP,
    writeCosmetic,
  };
}

// Cosmetic rules live in chrome.storage.local, one key per host (see
// general/cosmetic-parse.js) so each page reads only its own keys.
let bundledExtras = null;
async function loadBundledCosmetic() {
  const res = await fetch(chrome.runtime.getURL("src/rules/cosmetic-rules.json"));
  return res.json();
}

async function writeCosmetic(data, meta) {
  if (!bundledExtras) {
    try {
      bundledExtras = (await loadBundledCosmetic()).extras || [];
    } catch {
      bundledExtras = [];
    }
  }
  const merged = CP.mergeCosmetic([data, { generic: bundledExtras }]);
  const items = CP.toStorage(merged, meta);
  const old = await new Promise((resolve) => chrome.storage.local.get([CP.KEY_META], (s) => {
    void chrome.runtime.lastError;
    resolve((s && s[CP.KEY_META] && s[CP.KEY_META].keys) || []);
  }));
  const metaItem = items[CP.KEY_META];
  delete items[CP.KEY_META];
  await localSet(items);
  await localSet({ [CP.KEY_META]: metaItem });
  const keep = new Set(metaItem.keys);
  const stale = old.filter((k) => !keep.has(k));
  if (stale.length) await localRemove(stale);
}

// First run / new version: seed storage from the bundled snapshot unless a
// newer refreshed set is already there.
async function ensureCosmetic() {
  try {
    const bundled = await loadBundledCosmetic();
    const meta = await new Promise((resolve) => chrome.storage.local.get([CP.KEY_META], (s) => {
      void chrome.runtime.lastError;
      resolve(s && s[CP.KEY_META]);
    }));
    if (meta && (meta.source === "refresh" || meta.packedAt === bundled.packed_at_utc)) return;
    bundledExtras = bundled.extras || [];
    await writeCosmetic(bundled, { source: "bundled", packedAt: bundled.packed_at_utc });
  } catch {
    // Content script falls back to the bundled generic sheet.
  }
}

let currentEnabled = true;
let refreshing = null;

// Popup text for the list status (the popup reads only this short string).
function listStatusText(state, result, writeError) {
  const errs = Object.values(state.lastErrors || {});
  const notes = Object.values(state.lastNotes || {});
  if (notes.length) console.log("twitch-adblock: list mirrors used:", notes);
  if (errs.length || !result.ok) console.warn("twitch-adblock: list refresh problems:", errs.length ? errs : result.reason);
  else console.log("twitch-adblock: list refresh", result);
  const errText = errs.length ? " Problems: " + errs.join("; ") + "." : (!result.ok && result.reason ? " Problem: " + result.reason + "." : "");
  const werr = writeError || state.lastError;
  const storageText = werr && werr.message ? " Storage error: " + werr.message + "." : "";
  return (state.dynamicActive
    ? "Lists updated (" + (state.domainCount || 0) + " domains)."
    : "Using packed lists" + (result.ok ? "." : " (refresh failed; will retry later).")) + errText + storageText;
}

async function refreshLists(manual) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (reverting) {
      try {
        await reverting;
      } catch {
        // refresh anyway
      }
    }
    await ensureCosmetic();
    // Read the lists switch inside a DNR queue section: every other write of
    // currentEnabled is in one too (applyGeneralStateNow), so a slow read here
    // cannot overwrite a newer value. The refresh checks it again right
    // before its swap.
    await dnrExclusive(async () => {
      const settings = await getSettings();
      currentEnabled = settings.generalEnabled !== false;
    });
    let result;
    try {
      // A new attempt starts with a clean storage-error slate.
      lastWriteError = null;
      await setListState({ lastError: null }).catch(() => {});
      // Only the rule swap runs inside the DNR queue (deps.exclusive); the
      // downloads do not hold it.
      result = await GU.refresh(Object.assign(listDeps(), { exclusive: dnrExclusive }), { manual });
    } catch (e) {
      result = { ok: false, reason: String(e && e.message || e) };
    }
    // The switch may have flipped while the refresh was swapping rules in.
    await applyGeneralState();
    const state = await getListState().catch(() => ({}));
    const status = listStatusText(state, result, lastWriteError);
    try {
      await localSet({
        [KEYS.listStatus]: status,
        [KEYS.listUpdatedAt]: state.updatedAt || null,
      });
    } catch {
      // recorded by localSet; the popup falls back to its default text
    }
    return result;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function updateLists() {
  const result = await refreshLists(true);
  return { ok: !!result.ok, result };
}

// "Revert lists" (settings page): back to the packed lists and hide rules.
// Waits for a running refresh so the two never interleave.
let reverting = null;
async function revertLists() {
  if (reverting) return reverting;
  reverting = (async () => {
    if (refreshing) {
      try {
        await refreshing;
      } catch {
        // reverting anyway
      }
    }
    const deps = Object.assign(listDeps(), {
      revertCosmetic: async () => {
        const bundled = await loadBundledCosmetic();
        bundledExtras = bundled.extras || [];
        await writeCosmetic(bundled, { source: "bundled", packedAt: bundled.packed_at_utc });
      },
    });
    let result;
    try {
      // One DNR queue section (local work only: storage, rules, the packed
      // hide sheet), so an apply run cannot rebuild from half-removed lists.
      result = await dnrExclusive(() => GU.revertLists(deps));
    } catch (e) {
      result = { ok: false, reason: String(e && e.message || e) };
    }
    await applyGeneralState();
    try {
      await localSet({
        [KEYS.listStatus]: result.ok ? "Reverted to the packed lists. Automatic updates resume in 12 hours; Update lists fetches now." : "Revert failed: " + result.reason,
        [KEYS.listUpdatedAt]: null,
      });
    } catch {
      // recorded by localSet
    }
    return result;
  })();
  try {
    return await reverting;
  } finally {
    reverting = null;
  }
}

// Background refresh: the "gecko-refresh" alarm fires every 3 h (first one 5 to
// 30 min after it is created); GU.refresh skips the run unless 12 h passed since
// the last successful one. Chrome may drop alarms on browser restart (before
// Chrome 150 persistAcrossSessions is not honoured), so every worker start checks
// that the alarm exists and creates it only if missing: re-creating it on each
// start would reset the timer and a short-lived worker would never see it fire.
const REFRESH_ALARM = GU.REFRESH_ALARM;

function createRefreshAlarm() {
  const info = { delayInMinutes: 5 + Math.random() * 25, periodInMinutes: GU.ALARM_PERIOD_MINUTES };
  const done = () => { void chrome.runtime.lastError; };
  try {
    // Older Chrome rejects unknown keys ("Unexpected property"); retry without it.
    chrome.alarms.create(REFRESH_ALARM, Object.assign({ persistAcrossSessions: true }, info), done);
  } catch {
    try {
      chrome.alarms.create(REFRESH_ALARM, info, done);
    } catch (e) {
      console.warn("twitch-adblock: refresh alarm:", e && e.message);
    }
  }
}

function ensureRefreshAlarm() {
  if (!chrome.alarms || !chrome.alarms.get) return;
  try {
    chrome.alarms.get(REFRESH_ALARM, (alarm) => {
      void chrome.runtime.lastError;
      if (!alarm) createRefreshAlarm();
    });
  } catch (e) {
    console.warn("twitch-adblock: refresh alarm:", e && e.message);
  }
}

// Top level, so a worker woken by the alarm has the listener in place.
if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== REFRESH_ALARM) return;
    refreshLists(false);
    checkFeedNow();
  });
}

ensureRefreshAlarm();
storageReady();
// Session rules die with the browser and on extension update: put the feed
// rules back (from the verified cache, else the packed snapshot) on every start.
applyCachedFeed();

chrome.runtime.onInstalled.addListener(() => {
  ensureCosmetic();
  ensureRefreshAlarm();
  syncThreatAllowRules();
  applyCachedFeed();
  chrome.storage.local.get(Object.keys(GS.DEFAULTS), (stored) => {
    void chrome.runtime.lastError;
    const patch = {};
    if (stored.generalEnabled === undefined) patch.generalEnabled = true;
    if (!Array.isArray(stored.generalAllowedOrigins)) patch.generalAllowedOrigins = [];
    if (Object.keys(patch).length) {
      localSet(patch).catch(() => {}).then(() => applyGeneralState());
    } else {
      applyGeneralState();
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  applyGeneralState();
  syncThreatAllowRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.generalEnabled || changes.generalAllowedOrigins) {
    applyGeneralState();
  }
  if (changes[THREAT_ALLOW_KEY]) syncThreatAllowRules();
  // "Pause threat feed": drop the feed rules (cache kept) / put them back.
  if (FC && changes[FC.PAUSE_KEY]) applyCachedFeed();
  if (changes.settings || changes.siteOverrides) syncFromSettings();
});

// Popup: what applies on this page. The popup cannot load the registry
// (popup.html loads only popup.js), so the worker answers.
async function siteInfo(origin) {
  let host = "";
  try {
    host = origin ? FEAT.normalizeHost(new URL(origin).hostname) : "";
  } catch {
    host = "";
  }
  await settingsReady;
  const stored = await localGet(["settings", "siteOverrides"]).catch(() => ({}));
  const s = FEAT.normalizeSettings(stored.settings);
  const overrides = FEAT.normalizeOverrides(stored.siteOverrides);
  const effective = FEAT.resolve(stored.settings, stored.siteOverrides, host);
  const stream = !!host && FEAT.isStreamHost(host);
  const own = host ? FEAT.overrideFor(overrides, host) : null;
  const applies = (f) => f.sites.includes("all") || (f.sites.includes("ordinary") ? !stream : f.sites.some((d) => host === d || host.endsWith("." + d)));
  return {
    ok: true,
    host,
    stream,
    enabled: s.enabled,
    siteEnabled: !(own && own.entry.enabled === false),
    overrideHost: own ? own.host : host,
    features: FEAT.FEATURES.filter((f) => !host || applies(f)).map((f) => ({
      id: f.id, label: f.label, apply: f.apply, perSite: f.perSite, available: f.available !== false,
      global: f.apply === "always" ? true : s.features[f.id], on: effective[f.id],
      site: own && own.entry.features && typeof own.entry.features[f.id] === "boolean" ? own.entry.features[f.id] : null,
    })),
  };
}

// Quiet alerts (design rules): a small magenta dot on the toolbar icon of the
// tab where a page guard blocked something. The page guards report over their
// private port to src/settings/flags.js, which forwards only {kind} here.
// Per-tab badge through chrome.action (no permission); the last event per tab
// is kept in storage.session (trusted contexts only) so the popup can say what
// happened and clear the dot. Chrome clears a per-tab badge when the tab
// navigates (observed in Chrome for Testing 155, 2026-11-03), so the dot
// belongs to the page that caused it, and a stored event with no dot belongs to
// a page that is gone. No dot for DNR blocks: reading which rules matched needs
// declarativeNetRequestFeedback or activeTab, and this extension asks for neither.
const GUARD_KINDS = ["clipboard", "popup"];
const SIGNAL_KEY = "tabSignals";
const SIGNAL_TABS_MAX = 50;
const BADGE_COLOR = "#e81cd8"; // magenta
const lastSignalAt = new Map();

function sessionArea() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

function guardEvent(tabId, kind, documentId) {
  const now = Date.now();
  const burst = documentId || tabId; // a new page in the tab is a new burst
  if (now - (lastSignalAt.get(burst) || 0) < 2000) return; // coalesce bursts
  lastSignalAt.set(burst, now);
  if (lastSignalAt.size > SIGNAL_TABS_MAX) lastSignalAt.delete(lastSignalAt.keys().next().value);
  try {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }, () => void chrome.runtime.lastError);
    chrome.action.setBadgeText({ tabId, text: " " }, () => void chrome.runtime.lastError);
  } catch {
    // no dot; nothing else depends on it
  }
  const area = sessionArea();
  if (!area) return;
  try {
    area.get(SIGNAL_KEY, (got) => {
      void chrome.runtime.lastError;
      const signals = Object.assign({}, got && got[SIGNAL_KEY]);
      signals[tabId] = { kind, at: now };
      const ids = Object.keys(signals);
      if (ids.length > SIGNAL_TABS_MAX) {
        ids.sort((a, b) => signals[a].at - signals[b].at);
        for (const id of ids.slice(0, ids.length - SIGNAL_TABS_MAX)) delete signals[id];
      }
      area.set({ [SIGNAL_KEY]: signals }, () => void chrome.runtime.lastError);
    });
  } catch {
    // the dot is still shown
  }
}

// Popup: what was blocked on this tab, then clear the dot. The stored event is
// handed out only while the dot is up; either way it is dropped.
function takeTabSignal(tabId) {
  return new Promise((resolve) => {
    const take = (dotShown) => {
      try {
        chrome.action.setBadgeText({ tabId, text: "" }, () => void chrome.runtime.lastError);
      } catch {
        // nothing shown
      }
      const area = sessionArea();
      if (!area) return resolve({ ok: true, signal: null });
      try {
        area.get(SIGNAL_KEY, (got) => {
          void chrome.runtime.lastError;
          const signals = Object.assign({}, got && got[SIGNAL_KEY]);
          const signal = signals[tabId] || null;
          if (signal) {
            delete signals[tabId];
            area.set({ [SIGNAL_KEY]: signals }, () => void chrome.runtime.lastError);
          }
          resolve({ ok: true, signal: dotShown ? signal : null });
        });
      } catch {
        resolve({ ok: true, signal: null });
      }
    };
    try {
      chrome.action.getBadgeText({ tabId }, (text) => {
        void chrome.runtime.lastError;
        take(Boolean(text));
      });
    } catch {
      take(false);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== "twitch-adblock-general") return;
  // Popup and settings page only. A content-script sender carries a tab and
  // the page's URL; it must never trigger a refresh or a revert. The settings
  // page opens in a tab too, so it is recognised by its extension URL.
  if (!sender || sender.id !== chrome.runtime.id) return;
  // Read-only, for our own cosmetic content script: the packed fallback hide
  // sheet (no longer a web-accessible resource pages could probe).
  if (message.type === "cosmeticCss") {
    fetch(chrome.runtime.getURL("src/cosmetic-hide.css"))
      .then((r) => r.text())
      .then((css) => sendResponse({ css }), () => sendResponse({ css: null }));
    return true;
  }
  // Our ISOLATED content script (src/settings/flags.js) reports a page-guard
  // block: only a known kind, only for the sender's own tab, nothing returned.
  if (message.type === "guardEvent") {
    if (sender.tab && typeof sender.tab.id === "number" && GUARD_KINDS.includes(message.kind)) guardEvent(sender.tab.id, message.kind, sender.documentId);
    return;
  }
  if (sender.tab) {
    let settingsPage = "";
    try {
      settingsPage = chrome.runtime.getURL("src/settings.html");
    } catch {
      settingsPage = "";
    }
    if (!settingsPage || typeof sender.url !== "string" || sender.url.split(/[?#]/)[0] !== settingsPage) return;
  }
  if (message.type === "applyGeneralState") {
    applyGeneralState().then(sendResponse);
    return true;
  }
  if (message.type === "updateLists") {
    updateLists(message.requestedAt).then(sendResponse);
    return true;
  }
  if (message.type === "revertLists") {
    revertLists().then(sendResponse);
    return true;
  }
  if (message.type === "tabSignal") {
    if (typeof message.tabId !== "number") {
      sendResponse({ ok: false });
      return;
    }
    takeTabSignal(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === "siteInfo") {
    siteInfo(typeof message.origin === "string" ? message.origin : "").then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});
