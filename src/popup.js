(function () {
  // Gecko Adblock popup (design rules, update 2026-11-02): icon,
  // name and gear; the site; one status line; "Something broke? / Fix this
  // site"; Allow this site / Block again; a folded "Show more". Advanced
  // switches and the per-site list live on the settings page (the gear).
  // popup.html may only load this file, so the feature registry is reached
  // through the worker ("siteInfo"). Writes go to the small `settings` /
  // `siteOverrides` keys; the worker turns them into blocking rules and the legacy
  // generalEnabled / generalAllowedOrigins mirrors. No network calls here.
  const KEYS = {
    enabled: "generalEnabled",
    allowedOrigins: "generalAllowedOrigins",
    listUpdatedAt: "generalListUpdatedAt",
    listStatus: "generalListStatus",
    settings: "settings",
    overrides: "siteOverrides",
    fix: "popupFix", // { host, at, prev: { <feature id>: true | false | null } }
    welcomed: "popupWelcomed",
    theme: "uiTheme", // "auto" | "purple" | "contrast" (settings page)
  };
  const DEFAULTS = {
    generalEnabled: true,
    generalAllowedOrigins: [],
    generalListUpdatedAt: null,
    generalListStatus: "Packed lists (checked every 3 hours).",
  };
  const FIX_TTL_MS = 24 * 60 * 60 * 1000;
  const FEED_STATE_KEY = "feedState";
  const FEED_PAUSE_KEY = "feedPaused";

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

  const el = (id) => document.getElementById(id);
  const brandIcon = el("brand-icon");
  const siteHost = el("site-host");
  const siteStatus = el("site-status");
  const welcome = el("welcome");
  const welcomeClose = el("welcome-close");
  const fixSite = el("fix-site");
  const fixAsk = el("fix-ask");
  const fixYes = el("fix-yes");
  const fixNo = el("fix-no");
  const fixNote = el("fix-note");
  const allowSite = el("allow-site");
  const pageStatus = el("page-status");
  const openSettings = el("open-settings");
  const signalLine = el("signal-line");
  const listsStatus = el("lists-status");
  const feedStatus = el("feed-status");
  const versionLine = el("version-line");

  let activeTab = null;
  let pageChecked = false;
  let all = {}; // stored small keys
  let info = null; // worker's siteInfo answer for this page
  let saveError = "";
  let note = "";

  function packagedVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "";
    }
  }

  function applyTheme() {
    const t = all[KEYS.theme];
    try {
      const root = document.documentElement;
      if (!root) return;
      if (t === "purple" || t === "contrast") root.setAttribute("data-theme", t);
      else root.removeAttribute("data-theme");
    } catch {
      // fake DOM in tests
    }
  }

  function currentOrigin() {
    if (!activeTab) return null;
    // Without the "tabs" permission Chrome leaves tab.url out, so the page's
    // own content script (cosmetic.js, or settings/flags.js on stream sites)
    // reports its origin instead.
    return normalizeOrigin(activeTab.url || activeTab.pageOrigin || "");
  }

  function overridesCopy() {
    const o = all[KEYS.overrides];
    return o && typeof o === "object" ? JSON.parse(JSON.stringify(o)) : {};
  }

  function extensionOn() {
    const s = all[KEYS.settings];
    return !(s && typeof s === "object" && s.enabled === false);
  }

  // The site switch: this host's override says enabled:false. Before the
  // worker migrated, the legacy allowed-origins list still counts.
  function siteOff(origin) {
    const host = hostOfOrigin(origin);
    const o = all[KEYS.overrides];
    const key = info && info.host === host && info.overrideHost ? info.overrideHost : host;
    if (o && typeof o === "object" && o[key] && o[key].enabled === false) return true;
    if (info && info.host === host && info.siteEnabled === false) return true;
    const legacy = Array.isArray(all[KEYS.allowedOrigins]) ? all[KEYS.allowedOrigins] : [];
    return !all[KEYS.settings] && legacy.includes(origin);
  }

  // "Fix this site": the extra filters only - cosmetic hiding and the page
  // guards on ordinary sites, the hide-type helpers on YouTube and Twitch.
  // Never the lists, never the threat tier (not a per-site switch; its allow
  // box is on the settings page) and never what keeps streams playing (the
  // YouTube stuck-start reload, the Kick ad skip, the vendored players): that
  // stays baked in, so on Kick there is nothing to fix here.
  const FIXABLE = ["cosmetic", "guardClipboard", "guardPopups", "youtubeCosmetic", "twitchDisplay"];
  function fixIds() {
    const list = info && Array.isArray(info.features) ? info.features : [];
    return list.filter((f) => FIXABLE.includes(f.id) && f.perSite && f.available !== false && f.apply !== "always").map((f) => f.id);
  }

  function overrideKey(host) {
    return info && info.host === host && info.overrideHost ? info.overrideHost : host;
  }

  function pendingFix(host) {
    const f = all[KEYS.fix];
    if (!f || typeof f !== "object" || !host) return null;
    if (f.host !== overrideKey(host)) return null;
    if (typeof f.at !== "number" || Date.now() - f.at > FIX_TTL_MS) return null;
    return f;
  }

  function feedText() {
    if (all[FEED_PAUSE_KEY] === true) return "Threat feed: paused (packed threat list still on).";
    const st = all[FEED_STATE_KEY] || {};
    const base = st.text || "Threat feed: not set up (packed threat list in use).";
    if (st.status === "active" && st.source === "feed" && st.fetchedAt) {
      const mins = Math.max(0, Math.round((Date.now() - st.fetchedAt) / 60000));
      return base + (mins < 120 ? " Checked " + mins + " min ago." : " Checked " + Math.round(mins / 60) + " h ago.");
    }
    return base;
  }

  function listText() {
    const base = all[KEYS.listStatus] || DEFAULTS.generalListStatus;
    if (!all[KEYS.listUpdatedAt]) return base;
    try {
      return base + " Last update: " + new Date(all[KEYS.listUpdatedAt]).toLocaleString() + ".";
    } catch {
      return base;
    }
  }

  function render() {
    const on = extensionOn();
    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    const allowed = origin ? siteOff(origin) : false;
    if (brandIcon) {
      brandIcon.dataset.glow = on ? "on" : "off";
      brandIcon.src = on ? "../icons/icon48-working.png" : "../icons/icon48-off.png";
    }
    siteHost.textContent = host || (pageChecked ? "No web page" : "Checking this page…");

    // One status line, text first (never colour alone).
    if (!origin) siteStatus.textContent = "";
    else if (!on) siteStatus.textContent = "Off – turned off in settings";
    else if (allowed) siteStatus.textContent = "Allowed – not blocking here";
    else siteStatus.textContent = "✅ Protected";

    allowSite.disabled = !origin || !on;
    allowSite.setAttribute("aria-pressed", allowed ? "true" : "false");
    allowSite.textContent = allowed ? "Block again" : "Allow this site";
    if (!origin) {
      // Pages open from before the extension loaded have no content script to ask.
      pageStatus.textContent = pageChecked ? "Open a normal http(s) page to allow it. Already on one? Reload it." : "Checking this page…";
    } else {
      pageStatus.textContent = saveError;
    }

    const pending = pendingFix(host);
    const canFix = !!origin && on && !allowed && fixIds().length > 0;
    fixSite.hidden = !!pending;
    fixSite.disabled = !canFix;
    fixAsk.hidden = !pending;
    fixNote.textContent = note || (origin && allowed && !pending ? "Already allowed: nothing is blocked here." : "");

    if (listsStatus) listsStatus.textContent = listText();
    if (feedStatus) feedStatus.textContent = feedText();
    if (versionLine) versionLine.textContent = "Version " + packagedVersion();
  }

  function load() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(Object.keys(DEFAULTS).concat([KEYS.settings, KEYS.overrides, KEYS.fix, KEYS.welcomed, KEYS.theme, FEED_STATE_KEY, FEED_PAUSE_KEY]), (got) => {
          void chrome.runtime.lastError;
          all = Object.assign({}, DEFAULTS, got || {});
          resolve();
        });
      } catch {
        all = Object.assign({}, DEFAULTS);
        resolve();
      }
    });
  }

  // A failed write (quota, I/O) is shown instead of being dropped; the change
  // still applies for this popup session.
  function save(patch, removeKeys) {
    return new Promise((resolve) => {
      const done = (err) => {
        saveError = err ? "Could not save: " + (err.message || String(err)) + "." : "";
        Object.assign(all, patch);
        for (const k of removeKeys || []) delete all[k];
        resolve();
      };
      try {
        chrome.storage.local.set(patch, () => {
          const err = chrome.runtime.lastError;
          if (!removeKeys || !removeKeys.length || !chrome.storage.local.remove) return done(err);
          chrome.storage.local.remove(removeKeys, () => done(err || chrome.runtime.lastError));
        });
      } catch (e) {
        done(e);
      }
    });
  }

  function notifyBackground(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ source: "twitch-adblock-general", type }, extra || {}), (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function refreshInfo() {
    const res = await notifyBackground("siteInfo", { origin: currentOrigin() || "" });
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

  // Browser pages have no content script: no answer, no origin. Only the top
  // frame is asked.
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

  // The magenta dot: the worker says what a page guard blocked on this tab
  // and clears the dot (the visitor has now seen it).
  async function readSignal() {
    if (!activeTab || typeof activeTab.id !== "number" || !signalLine) return;
    const res = await notifyBackground("tabSignal", { tabId: activeTab.id });
    const kind = res && res.ok && res.signal ? res.signal.kind : "";
    signalLine.textContent = kind === "clipboard"
      ? "Blocked: this page tried to put a command into your clipboard."
      : kind === "popup" ? "Blocked a pop-up on this page." : "";
  }

  async function applyRules() {
    await notifyBackground("applyGeneralState");
  }

  allowSite.addEventListener("click", async () => {
    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    if (!host) return;
    const o = overridesCopy();
    const key = overrideKey(host);
    const entry = Object.assign({}, o[key]);
    if (siteOff(origin)) delete entry.enabled;
    else entry.enabled = false;
    if (Object.keys(entry).length) o[key] = entry;
    else delete o[key];
    note = "";
    await save({ [KEYS.overrides]: o }, [KEYS.fix]);
    await refreshInfo();
    render();
    await applyRules();
  });

  fixSite.addEventListener("click", async () => {
    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    const ids = fixIds();
    if (!host || !ids.length) return;
    const o = overridesCopy();
    const key = overrideKey(host);
    const entry = Object.assign({}, o[key]);
    const features = Object.assign({}, entry.features);
    const prev = {};
    for (const id of ids) {
      prev[id] = typeof features[id] === "boolean" ? features[id] : null;
      features[id] = false;
    }
    entry.features = features;
    o[key] = entry;
    note = "";
    await save({ [KEYS.overrides]: o, [KEYS.fix]: { host: key, at: Date.now(), prev } });
    await refreshInfo();
    render();
    await applyRules();
    try {
      fixYes.focus();
    } catch {
      // fake DOM
    }
  });

  fixYes.addEventListener("click", async () => {
    note = "";
    await save({}, [KEYS.fix]);
    render();
    try {
      if (typeof window !== "undefined" && window.close) window.close();
    } catch {
      // stays open
    }
  });

  // "No": put back exactly the switches Fix changed (a change made on the
  // settings page in between is kept), then point to Allow this site.
  fixNo.addEventListener("click", async () => {
    const f = all[KEYS.fix];
    const o = overridesCopy();
    if (f && typeof f === "object" && f.prev && o[f.host]) {
      const entry = Object.assign({}, o[f.host]);
      const features = Object.assign({}, entry.features);
      for (const id of Object.keys(f.prev)) {
        if (f.prev[id] === null) delete features[id];
        else features[id] = f.prev[id];
      }
      if (Object.keys(features).length) entry.features = features;
      else delete entry.features;
      if (Object.keys(entry).length) o[f.host] = entry;
      else delete o[f.host];
    }
    note = "Turned back on. If the site still breaks, use Allow this site.";
    await save({ [KEYS.overrides]: o }, [KEYS.fix]);
    await refreshInfo();
    render();
    await applyRules();
    try {
      allowSite.focus();
    } catch {
      // fake DOM
    }
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

  if (welcomeClose) {
    welcomeClose.addEventListener("click", () => {
      welcome.hidden = true;
    });
  }

  (async function init() {
    // A busy page answers late, so show the stored state before asking it.
    await load();
    applyTheme();
    // One small "You're protected" card on the very first open, never again.
    if (welcome && all[KEYS.welcomed] !== true) {
      welcome.hidden = false;
      await save({ [KEYS.welcomed]: true });
    }
    render();
    await queryActiveTab();
    pageChecked = true;
    await refreshInfo();
    render();
    await readSignal();
    await applyRules();
  })();
})();
