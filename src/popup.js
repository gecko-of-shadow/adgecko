(function () {
  // Mirrored in general-settings.js for the service worker (popup.html may only load popup.js).
  const KEYS = {
    enabled: "generalEnabled",
    allowedOrigins: "generalAllowedOrigins",
    listUpdatedAt: "generalListUpdatedAt",
    listStatus: "generalListStatus",
    listUpdateRequestAt: "generalListUpdateRequestAt",
  };
  const DEFAULTS = {
    generalEnabled: true,
    generalAllowedOrigins: [],
    generalListUpdatedAt: null,
    generalListStatus: "Packed lists (auto refresh after startup).",
    generalListUpdateRequestAt: null,
  };
  const HARD_EXCLUDE_HOST_RE = /(?:^|\.)((?:twitch\.tv)|(youtube\.com)|(youtu\.be)|(youtube-nocookie\.com)|(youtubekids\.com)|(googlevideo\.com)|(kick\.com)|(kickusercontent\.com))$/i;

  function withDefaults(stored) {
    return Object.assign({}, DEFAULTS, stored || {});
  }
  function normalizeOrigin(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch {
      return null;
    }
  }
  function hostOfOrigin(origin) {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
  function isHardExcludedOrigin(origin) {
    const h = hostOfOrigin(origin).replace(/\.$/, "");
    return !!h && HARD_EXCLUDE_HOST_RE.test(h);
  }

  const brandIcon = document.getElementById("brand-icon");
  const versionLine = document.getElementById("version-line");
  const generalEnabled = document.getElementById("general-enabled");
  const generalStatus = document.getElementById("general-status");
  const allowPage = document.getElementById("allow-page");
  const pageStatus = document.getElementById("page-status");
  const updateLists = document.getElementById("update-lists");
  const listsStatus = document.getElementById("lists-status");
  const feedStatus = document.getElementById("feed-status");

  // Threat feed status: the worker stores the sentence in feedState.text
  // (src/feed/client.js statusText); the popup adds how long ago it checked.
  // Small keys only: never the feed cache.
  const FEED_STATE_KEY = "feedState";
  const FEED_PAUSE_KEY = "feedPaused";
  let feedState = null;
  let feedPaused = false;
  function feedStatusText(state, paused, now) {
    if (paused) return "Threat feed: paused (packed threat list still on).";
    const st = state || {};
    const base = st.text || "Threat feed: not set up (packed threat list in use).";
    if (st.status === "active" && st.source === "feed" && st.fetchedAt) {
      const mins = Math.max(0, Math.round((now - st.fetchedAt) / 60000));
      return base + (mins < 120 ? " Checked " + mins + " min ago." : " Checked " + Math.round(mins / 60) + " h ago.");
    }
    return base;
  }
  function renderFeed() {
    if (feedStatus) feedStatus.textContent = feedStatusText(feedState, feedPaused, Date.now());
  }

  let activeTab = null;
  let pageChecked = false;
  let settings = withDefaults(null);

  function packagedVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "";
    }
  }

  const title = document.querySelector("h1");
  if (title) title.textContent = "twitch-adblock " + packagedVersion();
  if (versionLine) {
    versionLine.textContent = "v" + packagedVersion() + " · general lists · streams unchanged";
  }

  function setGlow(on) {
    const working = on === true;
    brandIcon.dataset.glow = working ? "on" : "off";
    brandIcon.src = working
      ? "../icons/icon48-working.png"
      : "../icons/icon48-off.png";
  }

  function formatListStatus(state) {
    const base = state.generalListStatus || DEFAULTS.generalListStatus;
    if (!state.generalListUpdatedAt) return base;
    try {
      const when = new Date(state.generalListUpdatedAt).toLocaleString();
      return base + " Last update: " + when + ".";
    } catch {
      return base;
    }
  }

  function currentOrigin() {
    if (!activeTab) return null;
    // Without the "tabs" permission Chrome leaves tab.url out, so the page's
    // own content script (cosmetic.js) reports its origin instead.
    return normalizeOrigin(activeTab.url || activeTab.pageOrigin || "");
  }

  function renderGeneral() {
    const on = settings.generalEnabled !== false;
    generalEnabled.checked = on;
    setGlow(on);
    generalStatus.textContent = on
      ? "List blocking is on for ordinary sites."
      : "List blocking is off. Stream filters still run.";

    const origin = currentOrigin();
    const allowed = Array.isArray(settings.generalAllowedOrigins)
      ? settings.generalAllowedOrigins
      : [];

    if (!origin) {
      allowPage.disabled = true;
      allowPage.setAttribute("aria-pressed", "false");
      allowPage.textContent = "Allow this page";
      // Pages open from before the extension loaded have no content script to ask.
      pageStatus.textContent = pageChecked
        ? "Open a normal http(s) page to allow it. Already on one? Reload it."
        : "Checking this page…";
    } else if (isHardExcludedOrigin(origin)) {
      allowPage.disabled = true;
      allowPage.setAttribute("aria-pressed", "false");
      allowPage.textContent = "Allow this page";
      pageStatus.textContent = "Twitch / YouTube / Kick stay on their own filters (lists never touch them).";
    } else if (!on) {
      allowPage.disabled = true;
      allowPage.setAttribute("aria-pressed", allowed.includes(origin) ? "true" : "false");
      allowPage.textContent = allowed.includes(origin) ? "Blocking this page" : "Allow this page";
      pageStatus.textContent = "Turn general blocking on to change page allows.";
    } else {
      const isAllowed = allowed.includes(origin);
      allowPage.disabled = false;
      allowPage.setAttribute("aria-pressed", isAllowed ? "true" : "false");
      allowPage.textContent = isAllowed ? "Blocking this page" : "Allow this page";
      pageStatus.textContent = isAllowed
        ? "Allowed for this site: " + origin
        : "Lists apply on this page.";
    }

    listsStatus.textContent = formatListStatus(settings) + (saveError ? " " + saveError : "");
    renderFeed();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(Object.keys(DEFAULTS).concat([FEED_STATE_KEY, FEED_PAUSE_KEY]), (stored) => {
          void chrome.runtime.lastError;
          feedState = stored ? stored[FEED_STATE_KEY] || null : null;
          feedPaused = !!(stored && stored[FEED_PAUSE_KEY] === true);
          const own = Object.assign({}, stored || {});
          delete own[FEED_STATE_KEY];
          delete own[FEED_PAUSE_KEY];
          settings = withDefaults(own);
          resolve(settings);
        });
      } catch {
        settings = withDefaults(null);
        resolve(settings);
      }
    });
  }

  // A failed write (quota, I/O) is shown in the list status line instead of
  // being dropped; the setting still applies for this popup session.
  let saveError = "";
  function savePartial(patch) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(patch, () => {
          const err = chrome.runtime.lastError;
          saveError = err ? "Could not save setting: " + (err.message || String(err)) + "." : "";
          Object.assign(settings, patch);
          resolve();
        });
      } catch (e) {
        saveError = "Could not save setting: " + String(e && e.message || e) + ".";
        Object.assign(settings, patch);
        resolve();
      }
    });
  }

  function notifyBackground(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          Object.assign({ source: "twitch-adblock-general", type }, extra || {}),
          (response) => {
            void chrome.runtime.lastError;
            resolve(response || null);
          },
        );
      } catch {
        resolve(null);
      }
    });
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        void chrome.runtime.lastError;
        activeTab = tabs && tabs[0] ? tabs[0] : null;
        resolve(activeTab);
      });
    }).then(askPageOrigin);
  }

  // Stream sites and browser pages have no cosmetic script: no answer, no origin.
  function askPageOrigin(tab) {
    if (!tab || tab.url || typeof tab.id !== "number") return tab;
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type: "pageOrigin" }, { frameId: 0 }, (response) => {
          void chrome.runtime.lastError;
          if (response && typeof response.origin === "string") tab.pageOrigin = response.origin;
          resolve(tab);
        });
      } catch {
        resolve(tab);
      }
    });
  }

  generalEnabled.addEventListener("change", async () => {
    const on = generalEnabled.checked === true;
    await savePartial({ [KEYS.enabled]: on });
    renderGeneral();
    const res = await notifyBackground("applyGeneralState");
    if (res && res.error) {
      generalStatus.textContent = "Saved, but rules engine is not ready yet.";
    }
  });

  allowPage.addEventListener("click", async () => {
    const origin = currentOrigin();
    if (!origin || isHardExcludedOrigin(origin)) return;
    const allowed = Array.isArray(settings.generalAllowedOrigins)
      ? settings.generalAllowedOrigins.slice()
      : [];
    const idx = allowed.indexOf(origin);
    if (idx >= 0) allowed.splice(idx, 1);
    else allowed.push(origin);
    await savePartial({ [KEYS.allowedOrigins]: allowed });
    renderGeneral();
    await notifyBackground("applyGeneralState");
  });

  updateLists.addEventListener("click", async () => {
    updateLists.disabled = true;
    listsStatus.textContent = "Checking filter lists…";
    const now = Date.now();
    await savePartial({
      [KEYS.listUpdateRequestAt]: now,
      [KEYS.listStatus]: "Checking filter lists…",
    });
    const res = await notifyBackground("updateLists", { requestedAt: now });
    await loadSettings();
    if (res && res.ok) {
      listsStatus.textContent = formatListStatus(settings);
    } else {
      listsStatus.textContent = (settings[KEYS.listStatus] || "Update failed.") + " Packed lists still active.";
    }
    updateLists.disabled = false;
    renderGeneral();
  });

  (async function init() {
    // A busy page answers late, so show the stored settings before asking it.
    await loadSettings();
    renderGeneral();
    await queryActiveTab();
    pageChecked = true;
    renderGeneral();
    await notifyBackground("applyGeneralState");
  })();
})();
