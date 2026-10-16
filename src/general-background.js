/**
 * General-list UI worker: icon glow, DNR enable/allow sync, manual Update signal.
 * Does not touch Twitch / YouTube / Kick playback scripts.
 * Filter lists: one quiet refresh ~5s after the worker starts (once per browser
 * session, at most every 12h, per-list expiry respected) and on popup Update.
 */
importScripts("general-settings.js", "general/update.js", "general/cosmetic-parse.js");
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
    chrome.storage.local.get(null, (stored) => {
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

async function applyGeneralState() {
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

const LIST_STATE_KEY = "generalListRefresh";

function cb(fn) {
  return new Promise((resolve, reject) => {
    fn(() => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

function listDeps() {
  const dnr = chrome.declarativeNetRequest;
  return {
    fetch: (url, init) => {
      if (!GU.isListUrl(url)) return Promise.reject(new Error("not a list host"));
      return fetch(url, init);
    },
    now: () => Date.now(),
    getState: () => new Promise((resolve) => {
      chrome.storage.local.get([LIST_STATE_KEY], (s) => {
        void chrome.runtime.lastError;
        resolve((s && s[LIST_STATE_KEY]) || {});
      });
    }),
    setState: (patch) => new Promise((resolve) => {
      chrome.storage.local.get([LIST_STATE_KEY], (s) => {
        void chrome.runtime.lastError;
        const next = Object.assign({}, (s && s[LIST_STATE_KEY]) || {}, patch);
        chrome.storage.local.set({ [LIST_STATE_KEY]: next }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    }),
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
  await cb((done) => chrome.storage.local.set(items, done));
  await cb((done) => chrome.storage.local.set({ [CP.KEY_META]: metaItem }, done));
  const keep = new Set(metaItem.keys);
  const stale = old.filter((k) => !keep.has(k));
  if (stale.length) await cb((done) => chrome.storage.local.remove(stale, done));
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

async function refreshLists(manual) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await ensureCosmetic();
    const settings = await getSettings();
    currentEnabled = settings.generalEnabled !== false;
    let result;
    try {
      result = await GU.refresh(listDeps(), { manual });
    } catch (e) {
      result = { ok: false, reason: String(e && e.message || e) };
    }
    const state = await listDeps().getState();
    const when = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "";
    const status = state.dynamicActive
      ? "Lists updated " + when + " (" + (state.domainCount || 0) + " domains)."
      : "Using packed lists" + (result.ok ? "." : " (refresh failed; will retry later).");
    await new Promise((resolve) => chrome.storage.local.set({
      [KEYS.listStatus]: status,
      [KEYS.listUpdatedAt]: state.updatedAt || null,
    }, () => {
      void chrome.runtime.lastError;
      resolve();
    }));
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

// One quiet refresh per browser session, ~5s after the worker starts.
function scheduleStartupRefresh() {
  setTimeout(() => {
    const session = chrome.storage && chrome.storage.session;
    if (!session) {
      refreshLists(false);
      return;
    }
    session.get(["listRefreshStarted"], (s) => {
      void chrome.runtime.lastError;
      if (s && s.listRefreshStarted) return;
      session.set({ listRefreshStarted: true }, () => {
        void chrome.runtime.lastError;
        refreshLists(false);
      });
    });
  }, GU.STARTUP_DELAY_MS);
}

scheduleStartupRefresh();

chrome.runtime.onInstalled.addListener(() => {
  ensureCosmetic();
  chrome.storage.local.get(null, (stored) => {
    void chrome.runtime.lastError;
    const patch = {};
    if (stored.generalEnabled === undefined) patch.generalEnabled = true;
    if (!Array.isArray(stored.generalAllowedOrigins)) patch.generalAllowedOrigins = [];
    if (Object.keys(patch).length) {
      chrome.storage.local.set(patch, () => {
        void chrome.runtime.lastError;
        applyGeneralState();
      });
    } else {
      applyGeneralState();
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  applyGeneralState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.generalEnabled || changes.generalAllowedOrigins) {
    applyGeneralState();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== "twitch-adblock-general") return;
  if (message.type === "applyGeneralState") {
    applyGeneralState().then(sendResponse);
    return true;
  }
  if (message.type === "updateLists") {
    updateLists(message.requestedAt).then(sendResponse);
    return true;
  }
});
