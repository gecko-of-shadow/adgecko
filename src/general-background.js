/**
 * General-list UI worker: icon glow, DNR enable/allow sync, manual Update signal.
 * Does not touch Twitch / YouTube / Kick playback scripts.
 * No alarms / no auto list fetch — Update runs only when the popup asks.
 */
importScripts("general-settings.js");

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
  setIcon(enabled);
  const ruleset = await enableRuleset(enabled);
  const allows = enabled
    ? await syncAllowRules(settings.generalAllowedOrigins)
    : await syncAllowRules([]);
  return { ok: true, enabled, ruleset, allows };
}

/**
 * Manual Update only. Does not schedule fetches.
 * If a list engine registers self.GeneralListUpdater.update(), call it.
 * Otherwise flag storage for the lists/DNR agent and leave packed rules alone.
 */
async function updateLists(requestedAt) {
  const now = requestedAt || Date.now();
  if (typeof self.GeneralListUpdater === "object" && typeof self.GeneralListUpdater.update === "function") {
    try {
      const result = await self.GeneralListUpdater.update({ manual: true, requestedAt: now });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }
  await new Promise((resolve) => {
    chrome.storage.local.set({
      [KEYS.listUpdateRequestAt]: now,
      [KEYS.listStatus]: "Update queued (manual). No auto-fetch. List engine not registered yet.",
    }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  return { ok: false, pending: true };
}

chrome.runtime.onInstalled.addListener(() => {
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
