(function () {
  // Adgecko popup (design rules, update 2026-11-02): icon,
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
    // { host, at, prev: { <feature id>: true | false | null }, others?: { <host>: { at, prev } } }
    // The newest unanswered Fix at the top level; earlier ones (other sites)
    // under `others`, so a Fix on a second site does not drop the first question.
    fix: "popupFix",
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
  const fixReload = el("fix-reload");
  const undoFixButton = el("undo-fix");
  const reloadPage = el("reload-page");
  const openAllowDomain = el("open-allow-domain");

  let activeTab = null;
  let pageChecked = false;
  let all = {}; // stored small keys
  let info = null; // worker's siteInfo answer for this page
  let saveError = "";
  let note = "";
  let busy = false; // a button's save / worker round trip is still running
  // Set only by a click on Allow this site / Block again / Undo fix in this
  // popup: then the Reload page button shows. Nothing reloads by itself (a
  // reload can lose what was typed into a form).
  let offerReload = false;

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

  // The threat tier is on for this page (worker's siteInfo).
  function threatHere() {
    const list = info && Array.isArray(info.features) ? info.features : [];
    return list.some((f) => f.id === "threatTier" && f.on === true);
  }

  function overrideKey(host) {
    return info && info.host === host && info.overrideHost ? info.overrideHost : host;
  }

  // Every unanswered Fix still inside its TTL, by host.
  function fixMap() {
    const f = all[KEYS.fix];
    const out = {};
    if (!f || typeof f !== "object") return out;
    const add = (host, e) => {
      if (typeof host !== "string" || !host || !e || typeof e !== "object") return;
      if (typeof e.at !== "number" || Date.now() - e.at > FIX_TTL_MS) return;
      if (!out[host] || out[host].at < e.at) out[host] = { at: e.at, prev: e.prev && typeof e.prev === "object" ? e.prev : {} };
    };
    if (f.others && typeof f.others === "object") for (const [h, e] of Object.entries(f.others)) add(h, e);
    add(f.host, f);
    return out;
  }

  // fixMap() -> [patch, removeKeys] for save(): the newest entry at the top
  // level, the rest under `others`; no entries -> the key is removed.
  function fixWrite(map, patch) {
    const hosts = Object.keys(map).sort((a, b) => map[b].at - map[a].at);
    if (!hosts.length) return [patch, [KEYS.fix]];
    const [top, ...rest] = hosts;
    const value = { host: top, at: map[top].at, prev: map[top].prev };
    if (rest.length) {
      value.others = {};
      for (const h of rest) value.others[h] = map[h];
    }
    return [Object.assign({}, patch, { [KEYS.fix]: value }), []];
  }

  // A Fix that was kept (Yes, or the question timed out): this host's own
  // entry still has an extra filter switched off. Only the own entry, because
  // Fix and Undo fix write only that one.
  function fixedHere(host) {
    if (!host) return false;
    const o = all[KEYS.overrides];
    const entry = o && typeof o === "object" ? o[host] : null;
    const features = entry && entry.features && typeof entry.features === "object" ? entry.features : null;
    if (!features) return false;
    return fixIds().some((id) => features[id] === false);
  }

  function pendingFix(host) {
    if (!host) return null;
    const e = fixMap()[host];
    return e ? Object.assign({ host }, e) : null;
  }

  // Puts back exactly the switches one Fix changed (a change made on the
  // settings page in between is kept). Returns true when a switch changed.
  function undoFix(o, host, prev) {
    if (!prev || !o[host]) return false;
    let changed = false;
    const entry = Object.assign({}, o[host]);
    const features = Object.assign({}, entry.features);
    for (const id of Object.keys(prev)) {
      const before = features[id];
      if (prev[id] === null) delete features[id];
      else features[id] = prev[id];
      if (features[id] !== before) changed = true;
    }
    if (Object.keys(features).length) entry.features = features;
    else delete entry.features;
    if (Object.keys(entry).length) o[host] = entry;
    else delete o[host];
    return changed;
  }

  function feedText() {
    if (!extensionOn()) return "Threat feed: off (extension turned off, packed threat list off too).";
    const s = all[KEYS.settings];
    // The stored feed text assumes the packed list is on.
    const tell = (t) => (s && s.features && s.features.threatTier === false ? t.replace(/packed threat list (still on|in use)/, "packed threat list off too") : t);
    if (all[FEED_PAUSE_KEY] === true) return tell("Threat feed: paused (packed threat list still on).");
    const st = all[FEED_STATE_KEY] || {};
    const base = tell(st.text || "Threat feed: not set up (packed threat list in use).");
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
    // A stream-family host without our scripts (worker's siteInfo): there is
    // nothing to allow or fix, so the popup says what does apply.
    const limited = !!(origin && info && info.host === host && info.limited === true);
    const pending = pendingFix(host);
    const fixed = !!origin && on && !allowed && !limited && !pending && fixedHere(host);
    if (brandIcon) {
      // Same trigger as the toolbar icon: the master switch and list blocking.
      const blocking = on && all[KEYS.enabled] !== false;
      brandIcon.dataset.glow = blocking ? "on" : "off";
      brandIcon.src = blocking ? "../icons/icon48-working.png" : "../icons/icon48-off.png";
    }
    siteHost.textContent = host || (pageChecked ? "No web page" : "Checking this page…");

    // One status line, text first (never colour alone).
    if (!origin) siteStatus.textContent = "";
    else if (!on) siteStatus.textContent = "Off – turned off in settings";
    else if (limited) siteStatus.textContent = threatHere() ? "Malware blocking only – ad scripts don't run on this site" : "Nothing runs on this site";
    else if (allowed) siteStatus.textContent = "Allowed – not blocking here";
    else if (fixed) siteStatus.textContent = "Protected – some filters off here (Fix this site)";
    else siteStatus.textContent = "✅ Protected";

    allowSite.disabled = !origin || !on || limited;
    allowSite.setAttribute("aria-pressed", allowed ? "true" : "false");
    allowSite.textContent = allowed ? "Block again" : "Allow this site";
    if (!origin) {
      // Pages open from before the extension loaded have no content script to ask.
      pageStatus.textContent = pageChecked ? "Open a normal http(s) page to allow it. Already on one? Reload it." : "Checking this page…";
    } else {
      pageStatus.textContent = saveError;
    }
    // Chrome's own "blocked by an extension" page has no address the popup
    // can read, so the way out (settings > Allow this domain) is offered on
    // every page without one.
    if (openAllowDomain) openAllowDomain.hidden = !!origin || !pageChecked;
    if (reloadPage) reloadPage.hidden = !(offerReload && origin && tabId() !== null);

    const canFix = !!origin && on && !allowed && fixIds().length > 0;
    fixSite.hidden = !!pending || fixed;
    fixSite.disabled = !canFix || busy;
    if (undoFixButton) {
      undoFixButton.hidden = !fixed;
      undoFixButton.disabled = busy;
    }
    fixAsk.hidden = !pending;
    fixNote.textContent = note;

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

  // A failed write (quota, I/O) changes nothing: `all` keeps what storage holds
  // and the visitor is told. Resolves true when everything was saved.
  function save(patch, removeKeys) {
    return new Promise((resolve) => {
      const done = (err, patchStored) => {
        saveError = err ? "Could not save. Try again." : "";
        if (patchStored) Object.assign(all, patch);
        if (!err) for (const k of removeKeys || []) delete all[k];
        resolve(!err);
      };
      try {
        chrome.storage.local.set(patch, () => {
          const err = chrome.runtime.lastError;
          if (err || !removeKeys || !removeKeys.length || !chrome.storage.local.remove) return done(err, !err);
          chrome.storage.local.remove(removeKeys, () => done(chrome.runtime.lastError, true));
        });
      } catch (e) {
        done(e, false);
      }
    });
  }

  function notifyBackground(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ source: "adgecko-general", type }, extra || {}), (response) => {
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
    const reason = kind === "clipboard"
      ? "Blocked: this page tried to put a command into your clipboard."
      : kind === "popup" ? "Blocked a pop-up on this page." : "";
    signalLine.textContent = reason;
    // The dot is already gone, so this is the one chance to read why.
    const more = el("more");
    if (reason && more) more.open = true;
  }

  function tabId() {
    return activeTab && typeof activeTab.id === "number" ? activeTab.id : null;
  }

  // Reload only on a click. tabs.reload needs no "tabs" permission.
  function reloadTab() {
    const id = tabId();
    if (id === null) return;
    try {
      chrome.tabs.reload(id, {}, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // tab gone or API missing
    }
  }

  async function applyRules() {
    await notifyBackground("applyGeneralState");
  }

  // A double click must not run a handler twice on stale state: the second
  // click would read what the first one just wrote.
  function guarded(fn) {
    return async () => {
      if (busy) return;
      busy = true;
      fixSite.disabled = true;
      try {
        await fn();
      } finally {
        busy = false;
        render();
      }
    };
  }

  // Allow writes this page's own host (other addresses of the same site count
  // separately). Block again edits the entry that holds the Allow, which can
  // be a parent domain. An unanswered Fix on this host is undone first: Allow
  // keeps the clipboard guard on, and Block again must not bring back a Fix
  // the visitor never confirmed.
  allowSite.addEventListener("click", guarded(async () => {
    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    if (!host) return;
    const o = overridesCopy();
    const off = siteOff(origin);
    const key = off ? overrideKey(host) : host;
    const fixes = fixMap();
    if (!off && fixes[host]) {
      undoFix(o, host, fixes[host].prev);
      delete fixes[host];
    }
    const entry = Object.assign({}, o[key]);
    if (off) delete entry.enabled;
    else entry.enabled = false;
    if (Object.keys(entry).length) o[key] = entry;
    else delete o[key];
    note = "";
    if (await save(...fixWrite(fixes, { [KEYS.overrides]: o }))) offerReload = true;
    await refreshInfo();
    render();
    await applyRules();
  }));

  // Fix writes this page's own host only, never a parent domain's entry.
  fixSite.addEventListener("click", guarded(async () => {
    const origin = currentOrigin();
    const host = origin ? hostOfOrigin(origin) : "";
    const ids = fixIds();
    if (!host || !ids.length) return;
    const o = overridesCopy();
    const entry = Object.assign({}, o[host]);
    const features = Object.assign({}, entry.features);
    const fixes = fixMap();
    // An unanswered Fix on this host keeps what was there before it.
    const prev = Object.assign({}, fixes[host] && fixes[host].prev);
    for (const id of ids) {
      if (!(id in prev)) prev[id] = typeof features[id] === "boolean" ? features[id] : null;
      features[id] = false;
    }
    entry.features = features;
    o[host] = entry;
    fixes[host] = { at: Date.now(), prev };
    note = "";
    await save(...fixWrite(fixes, { [KEYS.overrides]: o }));
    await refreshInfo();
    render();
    await applyRules();
    try {
      fixYes.focus();
    } catch {
      // fake DOM
    }
  }));

  function pageHost() {
    const origin = currentOrigin();
    return origin ? hostOfOrigin(origin) : "";
  }

  fixYes.addEventListener("click", async () => {
    note = "";
    const fixes = fixMap();
    delete fixes[pageHost()];
    const saved = await save(...fixWrite(fixes, {}));
    render();
    if (!saved) return;
    try {
      if (typeof window !== "undefined" && window.close) window.close();
    } catch {
      // stays open
    }
  });

  // "No": put back exactly the switches Fix changed (a change made on the
  // settings page in between is kept), then point to Allow this site.
  fixNo.addEventListener("click", guarded(async () => {
    const host = pageHost();
    const fixes = fixMap();
    const o = overridesCopy();
    const changed = fixes[host] ? undoFix(o, host, fixes[host].prev) : false;
    delete fixes[host];
    const saved = await save(...fixWrite(fixes, { [KEYS.overrides]: o }));
    note = saved && changed ? "Turned back on. If the site still breaks, use Allow this site." : "";
    // The filters are back on: the page needs another reload to show it.
    if (saved && changed) offerReload = true;
    await refreshInfo();
    render();
    await applyRules();
    try {
      allowSite.focus();
    } catch {
      // fake DOM
    }
  }));

  // "Undo fix": turns back on the extra filters a kept Fix switched off on
  // this host (its own entry only; an Allow on the entry stays).
  if (undoFixButton) {
    undoFixButton.addEventListener("click", guarded(async () => {
      const host = pageHost();
      if (!host || !fixedHere(host)) return;
      const o = overridesCopy();
      const prev = {};
      const features = (o[host] && o[host].features) || {};
      for (const id of FIXABLE) if (features[id] === false) prev[id] = null;
      undoFix(o, host, prev);
      note = "";
      if (await save({ [KEYS.overrides]: o })) offerReload = true;
      await refreshInfo();
      render();
      await applyRules();
      try {
        fixSite.focus();
      } catch {
        // fake DOM
      }
    }));
  }

  if (fixReload) fixReload.addEventListener("click", reloadTab);
  if (reloadPage) reloadPage.addEventListener("click", reloadTab);

  // Opens the settings page at the Allow this domain box. tabs.create needs no
  // "tabs" permission; openOptionsPage is the fallback (no jump to the box).
  if (openAllowDomain) {
    const fallback = () => {
      try {
        chrome.runtime.openOptionsPage();
      } catch {
        // settings page unavailable
      }
    };
    openAllowDomain.addEventListener("click", () => {
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL("src/settings.html#allow") }, () => {
          if (chrome.runtime.lastError) fallback();
        });
      } catch {
        fallback();
      }
    });
  }

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
    if (welcome && all[KEYS.welcomed] !== true && extensionOn()) {
      welcome.hidden = false;
      await save({ [KEYS.welcomed]: true });
      saveError = ""; // nothing the visitor did or can retry
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
