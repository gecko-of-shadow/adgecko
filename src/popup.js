(function () {
  const SOURCE = "twitch-adblock-debug";

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
    generalListStatus: "Packed lists (manual Update only).",
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
  const debugStatus = document.getElementById("debug-status");
  const onButton = document.getElementById("debug-on");
  const offButton = document.getElementById("debug-off");
  const copyButton = document.getElementById("copy-debug");

  let generation = 0;
  let latest = null;
  let activeTab = null;
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
    if (!activeTab || !activeTab.url) return null;
    return normalizeOrigin(activeTab.url);
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
      pageStatus.textContent = "Open a normal http(s) page to allow it.";
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

    listsStatus.textContent = formatListStatus(settings);
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(null, (stored) => {
          void chrome.runtime.lastError;
          settings = withDefaults(stored);
          resolve(settings);
        });
      } catch {
        settings = withDefaults(null);
        resolve(settings);
      }
    });
  }

  function savePartial(patch) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(patch, () => {
          void chrome.runtime.lastError;
          Object.assign(settings, patch);
          resolve();
        });
      } catch {
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
    });
  }

  function renderDebug(state) {
    latest = state;
    if (!state) {
      debugStatus.textContent = "Open a Twitch or YouTube tab, then try again.";
      onButton.setAttribute("aria-pressed", "false");
      offButton.setAttribute("aria-pressed", "true");
      return;
    }
    const where = state.host ? " on " + state.host : "";
    debugStatus.textContent = state.on
      ? "Debug is ON" + where + ". Copy keeps the log on this device."
      : "Debug is OFF" + where + ". Playback is unchanged.";
    onButton.setAttribute("aria-pressed", state.on ? "true" : "false");
    offButton.setAttribute("aria-pressed", state.on ? "false" : "true");
  }

  chrome.runtime.onMessage.addListener((message) => {
    try {
      if (!message || message.source !== SOURCE || message.type !== "state") return;
      if (message.gen !== generation) return;
      if (!latest || (message.text || "").length >= (latest.text || "").length) renderDebug(message);
    } catch {
      debugStatus.textContent = "Debug popup hit an error. Playback is unchanged.";
    }
  });

  function sendDebug(type, on) {
    const gen = ++generation;
    latest = null;
    debugStatus.textContent = "Checking this tab…";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) {
        if (gen === generation) renderDebug(null);
        return;
      }
      // Top frame only: the player lives there, and child frames keep their own rings.
      chrome.tabs.sendMessage(tab.id, { source: SOURCE, type, on: on === true, gen }, { frameId: 0 }, () => {
        void chrome.runtime.lastError;
      });
      setTimeout(() => {
        if (gen === generation && !latest) renderDebug(null);
      }, 400);
    });
  }

  function copyText() {
    if (latest && latest.text) return latest.text;
    return "twitch-adblock " + packagedVersion() + " debug\non=false\n(no events)";
  }

  function markCopied(ok) {
    debugStatus.textContent = ok ? "Copied debug log." : "Could not copy. Playback is unchanged.";
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
    listsStatus.textContent = "Update requested (manual only — no background fetch).";
    const now = Date.now();
    await savePartial({
      [KEYS.listUpdateRequestAt]: now,
      [KEYS.listStatus]: "Update requested. Waiting for the list engine.",
    });
    const res = await notifyBackground("updateLists", { requestedAt: now });
    await loadSettings();
    if (res && res.ok) {
      listsStatus.textContent = formatListStatus(settings);
    } else if (res && res.pending) {
      listsStatus.textContent = "Update queued. List packer will fetch only on this click path.";
    } else {
      listsStatus.textContent = "Update flagged in storage. List engine not loaded yet — no auto-fetch.";
    }
    updateLists.disabled = false;
    renderGeneral();
  });

  onButton.addEventListener("click", () => sendDebug("set", true));
  offButton.addEventListener("click", () => sendDebug("set", false));
  copyButton.addEventListener("click", () => {
    const text = copyText();
    const done = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject();
    done.then(() => markCopied(true)).catch(() => {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        markCopied(ok);
      } catch {
        markCopied(false);
      }
    });
  });

  // Keep the existing debug probe name used by tests.
  function send(type, on) {
    sendDebug(type, on);
  }

  (async function init() {
    await queryActiveTab();
    await loadSettings();
    renderGeneral();
    await notifyBackground("applyGeneralState");
    send("get");
  })();
})();
