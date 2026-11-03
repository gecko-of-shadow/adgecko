/**
 * General-list UI worker: icon glow, DNR enable/allow sync, manual Update signal.
 * Does not touch Twitch / YouTube / Kick playback scripts.
 * Filter lists: refreshed from the "gecko-refresh" alarm (every 3 h, at most
 * one real run per 12 h, per-list expiry respected) and on popup Update.
 */
importScripts("general-settings.js", "general/filter-options.js", "threat/protected-hosts.js", "threat/compile.js", "general/update.js", "general/cosmetic-parse.js");
const TC = self.GeckoThreatCompile;
const CP = self.GeneralCosmeticParse;
const GU = self.GeneralAdblockUpdate;

const GS = self.GeneralSettings;
const KEYS = GS.STORAGE_KEYS;

const ICON_WORKING = {
  16: "icons/icon16-working.png",
  48: "icons/icon48-working.png",
  128: "icons/icon128-working.png",
};
const ICON_OFF = {
  16: "icons/icon16-off.png",
  48: "icons/icon48-off.png",
  128: "icons/icon128-off.png",
};

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
      void chrome.runtime.lastError;
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

function syncAllowRules(origins) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return Promise.resolve({ ok: false, error: "dnr-missing" });
  }
  return new Promise((resolve) => {
    try {
      chrome.declarativeNetRequest.getDynamicRules((existing) => {
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
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e) });
    }
  });
}

// User "Allow this domain" override for the threat tier (priority 2,000,020,
// all resource types incl. main_frame). Domains in storage key
// `threatAllowDomains`; the text box comes with the settings page.
const THREAT_ALLOW_KEY = "threatAllowDomains";
const THREAT_ALLOW_ID_BASE = 950000;
const THREAT_ALLOW_MAX = 1000;
function syncThreatAllowRules() {
  if (!TC || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return Promise.resolve({ ok: false, error: "dnr-missing" });
  }
  return new Promise((resolve) => {
    chrome.storage.local.get([THREAT_ALLOW_KEY], (s) => {
      void chrome.runtime.lastError;
      const domains = Array.isArray(s && s[THREAT_ALLOW_KEY]) ? s[THREAT_ALLOW_KEY] : [];
      chrome.declarativeNetRequest.getDynamicRules((existing) => {
        void chrome.runtime.lastError;
        const removeRuleIds = (existing || [])
          .filter((r) => r.id >= THREAT_ALLOW_ID_BASE && r.id < THREAT_ALLOW_ID_BASE + THREAT_ALLOW_MAX)
          .map((r) => r.id);
        const addRules = TC.buildUserAllowRules(domains, THREAT_ALLOW_ID_BASE, THREAT_ALLOW_MAX);
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }, () => {
          const err = chrome.runtime.lastError;
          resolve(err ? { ok: false, error: err.message || String(err) } : { ok: true, count: addRules.length });
        });
      });
    });
  });
}

function ensureListAllowRule() {
  try {
    const rule = GU.listAllowRule(chrome.runtime.id);
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [rule.id], addRules: [rule] }, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn("twitch-adblock: list allow rule:", err.message);
    });
  } catch (e) {
    console.warn("twitch-adblock: list allow rule:", e && e.message);
  }
}

// The popup's switch and "Allow this page" both write storage (storage.onChanged)
// and message the worker, so each click starts two runs. Run them one at a time:
// two overlapping runs read the same rules and the second rebuild failed on
// duplicate rule ids, dropping refreshed lists back to the packed ones.
let applyQueue = Promise.resolve();
function applyGeneralState() {
  const run = applyQueue.then(applyGeneralStateNow, applyGeneralStateNow);
  applyQueue = run.catch(() => {});
  return run;
}

async function applyGeneralStateNow() {
  ensureListAllowRule();
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
    enabled: () => currentEnabled,
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
  const when = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "";
  const errs = Object.values(state.lastErrors || {});
  const notes = Object.values(state.lastNotes || {});
  if (notes.length) console.log("twitch-adblock: list mirrors used:", notes);
  if (errs.length || !result.ok) console.warn("twitch-adblock: list refresh problems:", errs.length ? errs : result.reason);
  else console.log("twitch-adblock: list refresh", result);
  const errText = errs.length ? " Problems: " + errs.join("; ") + "." : (!result.ok && result.reason ? " Problem: " + result.reason + "." : "");
  const werr = writeError || state.lastError;
  const storageText = werr && werr.message ? " Storage error: " + werr.message + "." : "";
  return (state.dynamicActive
    ? "Lists updated " + when + " (" + (state.domainCount || 0) + " domains)."
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
    const settings = await getSettings();
    currentEnabled = settings.generalEnabled !== false;
    let result;
    try {
      // A new attempt starts with a clean storage-error slate.
      lastWriteError = null;
      await setListState({ lastError: null }).catch(() => {});
      result = await GU.refresh(listDeps(), { manual });
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
      result = await GU.revertLists(deps);
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
  });
}

ensureRefreshAlarm();
storageReady();

chrome.runtime.onInstalled.addListener(() => {
  ensureCosmetic();
  ensureRefreshAlarm();
  syncThreatAllowRules();
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
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== "twitch-adblock-general") return;
  // Popup only. A content-script sender carries a tab; it must never trigger a manual refresh.
  if (!sender || sender.id !== chrome.runtime.id || sender.tab) return;
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
});
