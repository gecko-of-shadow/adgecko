(function () {
  // popup.html may only load this file, so the feature registry
  // (src/settings/features.js) is reached through the worker ("siteInfo").
  // Writes go to the small `settings` / `siteOverrides` keys; the worker turns
  // them into DNR rules and the legacy generalEnabled / generalAllowedOrigins
  // mirrors.
  const KEYS = {
    enabled: "generalEnabled",
    allowedOrigins: "generalAllowedOrigins",
    listUpdatedAt: "generalListUpdatedAt",
    listStatus: "generalListStatus",
    listUpdateRequestAt: "generalListUpdateRequestAt",
    settings: "settings",
    overrides: "siteOverrides",
  };
  const DEFAULTS = {
    generalEnabled: true,
    generalAllowedOrigins: [],
    generalListUpdatedAt: null,
    generalListStatus: "Packed lists (checked every 3 hours).",
    generalListUpdateRequestAt: null,
  };

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
      return new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return "";
    }
  }

  const brandIcon = document.getElementById("brand-icon");
  const versionLine = document.getElementById("version-line");
  const generalEnabled = document.getElementById("general-enabled");
  const generalStatus = document.getElementById("general-status");
  const allowPage = document.getElementById("allow-page");
  const pageStatus = document.getElementById("page-status");
  const siteHost = document.getElementById("site-host");
  const featureList = document.getElementById("feature-list");
  const openSettings = document.getElementById("open-settings");
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
  let stored = {}; // raw settings / siteOverrides
  let info = null; // worker's siteInfo answer for this page

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
    // own content script (cosmetic.js, or settings/flags.js on stream sites)
    // reports its origin instead.
    return normalizeOrigin(activeTab.url || activeTab.pageOrigin || "");
  }

  // Lists on everywhere: the network feature (stored settings win over the
  // legacy mirror, which the worker derives from them).
  function networkOn() {
    const s = stored[KEYS.settings];
    if (s && typeof s === "object") return s.enabled !== false && !(s.features && s.features.network === false);
    return settings.generalEnabled !== false;
  }

  function overridesCopy() {
    const o = stored[KEYS.overrides];
    return o && typeof o === "object" ? JSON.parse(JSON.stringify(o)) : {};
  }

  // The site switch: this host's override says enabled:false. Before the
  // worker migrated, the legacy allowed-origins list still counts.
  function siteOff(origin) {
    const host = hostOfOrigin(origin);
    const o = stored[KEYS.overrides];
    if (o && typeof o === "object" && o[host] && o[host].enabled === false) return true;
    if (info && info.host === host && info.siteEnabled === false) return true;
    const legacy = Array.isArray(settings.generalAllowedOrigins) ? settings.generalAllowedOrigins : [];
    return !stored[KEYS.settings] && legacy.includes(origin);
  }

  function renderFeatures() {
    if (!featureList) return;
    const list = info && Array.isArray(info.features) ? info.features : null;
    try {
      while (featureList.firstChild) featureList.removeChild(featureList.firstChild);
    } catch {
      // fake DOM in tests
    }
    if (!list || typeof document.createElement !== "function") {
      featureList.textContent = list ? list.map((f) => f.label + ": " + (f.on ? "on" : "off")).join(" · ") : "";
      return;
    }
    for (const f of list) {
      if (!f.available) continue;
      if (f.apply === "always") {
        const p = document.createElement("p");
        p.className = "fixed";
        p.textContent = f.label + ": always on";
        featureList.appendChild(p);
        continue;
      }
      if (!f.perSite) {
        const p = document.createElement("p");
        p.className = "fixed";
        p.textContent = f.label + ": " + (f.on ? "on" : "off") + " (change in All settings)";
        featureList.appendChild(p);
        continue;
      }
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!f.on;
      box.disabled = !(info && info.siteEnabled) || !(info && info.enabled);
      box.addEventListener("change", () => setSiteFeature(f.id, box.checked));
      label.appendChild(box);
      label.appendChild(document.createTextNode(f.label));
      featureList.appendChild(label);
    }
  }

  function renderGeneral() {
    const on = networkOn();
    generalEnabled.checked = on;
    setGlow(on);
    generalStatus.textContent = on
      ? "List blocking is on for ordinary sites."
      : "List blocking is off. Stream filters still run.";

    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    const stream = !!(info && info.host === host && info.stream);
    if (siteHost) siteHost.textContent = host || (pageChecked ? "No web page" : "Checking this page…");

    if (!origin) {
      allowPage.disabled = true;
      allowPage.setAttribute("aria-pressed", "false");
      allowPage.textContent = "Allow this page";
      // Pages open from before the extension loaded have no content script to ask.
      pageStatus.textContent = pageChecked
        ? "Open a normal http(s) page to allow it. Already on one? Reload it."
        : "Checking this page…";
    } else {
      const off = siteOff(origin);
      allowPage.disabled = false;
      allowPage.setAttribute("aria-pressed", off ? "true" : "false");
      allowPage.textContent = off ? "Blocking this page" : "Allow this page";
      if (stream) {
        pageStatus.textContent = off
          ? "Our own helpers are off on " + host + ". The vendored Twitch/YouTube blockers and the threat tier stay on."
          : "Twitch / YouTube / Kick keep their own filters (lists never touch them).";
      } else if (!on) {
        pageStatus.textContent = off ? "Allowed for this site: " + origin : "List blocking is off everywhere; this switch still turns hide rules and page helpers off here.";
      } else {
        pageStatus.textContent = off
          ? "Allowed for this site: " + origin
          : "Lists apply on this page.";
      }
    }

    renderFeatures();
    listsStatus.textContent = formatListStatus(settings) + (saveError ? " " + saveError : "");
    renderFeed();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(Object.keys(DEFAULTS).concat([FEED_STATE_KEY, FEED_PAUSE_KEY, KEYS.settings, KEYS.overrides]), (got) => {
          void chrome.runtime.lastError;
          const all = got || {};
          feedState = all[FEED_STATE_KEY] || null;
          feedPaused = all[FEED_PAUSE_KEY] === true;
          stored = { [KEYS.settings]: all[KEYS.settings], [KEYS.overrides]: all[KEYS.overrides] };
          const own = {};
          for (const k of Object.keys(DEFAULTS)) if (k in all) own[k] = all[k];
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
          for (const k of [KEYS.settings, KEYS.overrides]) if (k in patch) stored[k] = patch[k];
          resolve();
        });
      } catch (e) {
        saveError = "Could not save setting: " + String(e && e.message || e) + ".";
        Object.assign(settings, patch);
        for (const k of [KEYS.settings, KEYS.overrides]) if (k in patch) stored[k] = patch[k];
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

  async function refreshInfo() {
    const origin = currentOrigin();
    const res = await notifyBackground("siteInfo", { origin: origin || "" });
    info = res && res.ok ? res : null;
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

  // Browser pages have no content script: no answer, no origin.
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

  function settingsCopy() {
    const s = stored[KEYS.settings];
    const out = s && typeof s === "object" ? JSON.parse(JSON.stringify(s)) : { v: 1, enabled: true, features: {} };
    if (!out.features || typeof out.features !== "object") out.features = {};
    return out;
  }

  async function setSiteFeature(id, on) {
    const host = hostOfOrigin(currentOrigin() || "");
    if (!host) return;
    const o = overridesCopy();
    const key = info && info.overrideHost ? info.overrideHost : host;
    const entry = o[key] || {};
    entry.features = Object.assign({}, entry.features, { [id]: on });
    o[key] = entry;
    await savePartial({ [KEYS.overrides]: o });
    await refreshInfo();
    renderGeneral();
  }

  generalEnabled.addEventListener("change", async () => {
    const on = generalEnabled.checked === true;
    const s = settingsCopy();
    s.features.network = on;
    await savePartial({ [KEYS.settings]: s });
    renderGeneral();
    const res = await notifyBackground("applyGeneralState");
    if (res && res.error) {
      generalStatus.textContent = "Saved, but rules engine is not ready yet.";
    }
  });

  // The site switch ("Allow this page"): turns every per-site feature off for
  // this host (lists, hide rules, page helpers). Never touches stream-site
  // allow rules, the threat tier or the vendored players.
  allowPage.addEventListener("click", async () => {
    const origin = currentOrigin();
    if (!origin) return;
    const host = hostOfOrigin(origin);
    if (!host) return;
    const o = overridesCopy();
    const key = info && info.overrideHost && info.host === host ? info.overrideHost : host;
    const entry = Object.assign({}, o[key]);
    if (siteOff(origin)) delete entry.enabled;
    else entry.enabled = false;
    if (Object.keys(entry).length) o[key] = entry;
    else delete o[key];
    await savePartial({ [KEYS.overrides]: o });
    await refreshInfo();
    renderGeneral();
    await notifyBackground("applyGeneralState");
  });

  if (openSettings) {
    openSettings.addEventListener("click", () => {
      try {
        chrome.runtime.openOptionsPage();
      } catch {
        // settings page unavailable
      }
    });
  }

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
    await refreshInfo();
    renderGeneral();
    await notifyBackground("applyGeneralState");
  })();
})();
