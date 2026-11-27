// Settings page (options_ui). Lists every feature from src/settings/features.js,
// the threat feed status with "Pause threat feed", "Revert lists", the
// "Allow this domain" box (threat tier and filter lists) and the per-site switches. Writes only
// the small keys settings / siteOverrides / threatAllowDomains; the worker does
// the rest. No remote code, no eval, text only (no innerHTML).
(function () {
  const F = globalThis.GeckoFeatures;
  const TC = globalThis.GeckoThreatCompile;
  const $ = (id) => document.getElementById(id);
  const KEYS = ["settings", "siteOverrides", "threatAllowDomains", "feedState", "generalListStatus", "generalListUpdatedAt", "uiTheme"];
  const THEMES = ["auto", "purple", "contrast"];
  let stored = {};

  const get = () => new Promise((resolve) => chrome.storage.local.get(KEYS, (s) => {
    void chrome.runtime.lastError;
    resolve(s || {});
  }));
  const set = (patch) => new Promise((resolve) => chrome.storage.local.set(patch, () => {
    const err = chrome.runtime.lastError;
    $("status").textContent = err ? "Could not save: " + (err.message || String(err)) : "Saved.";
    resolve(!err);
  }));
  const send = (type) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ source: "adgecko-general", type }, (r) => {
        void chrome.runtime.lastError;
        resolve(r || null);
      });
    } catch {
      resolve(null);
    }
  });
  const el = (tag, text) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    return e;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

  function currentSettings() {
    return F.normalizeSettings(stored.settings);
  }

  // Every read-modify-write runs in one queue and reads fresh storage first.
  // Two changes that overlap a slow write (the worker writes big list data
  // at the same time) then both stay; before, the second one was built from
  // the old snapshot and wrote the first one away.
  let writes = Promise.resolve();
  function queued(step) {
    const run = writes.then(async () => {
      stored = await get();
      await step();
      await load();
    });
    writes = run.catch(() => {});
    return run;
  }

  // The caller reads the control's value at click time: a re-render from an
  // earlier write can change the box before this step runs.
  function saveSettings(mutate) {
    return queued(async () => {
      const s = currentSettings();
      mutate(s);
      await set({ settings: s });
    });
  }

  function renderFeatures() {
    const s = currentSettings();
    $("master").checked = s.enabled;
    const box = $("features");
    // Update in place. Every save and every storage write ends up here, and a
    // rebuild would throw keyboard focus back to the top of the page.
    const built = box.querySelectorAll("input[data-feature]");
    if (built.length) {
      for (const input of built) {
        input.checked = !!s.features[input.dataset.feature];
        input.disabled = !s.enabled;
      }
      return;
    }
    clear(box);
    for (const f of F.FEATURES) {
      if (f.available === false) {
        box.appendChild(el("p", f.label + ": not available in this version.")).className = "fixed";
        continue;
      }
      if (f.apply === "always") {
        box.appendChild(el("p", f.label + ": always on (see above).")).className = "fixed";
        continue;
      }
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.checked = !!s.features[f.id];
      input.disabled = !s.enabled;
      input.dataset.feature = f.id;
      input.addEventListener("change", () => {
        const on = input.checked;
        return saveSettings((x) => { x.features[f.id] = on; });
      });
      label.appendChild(input);
      label.appendChild(el("span", f.label + " (" + (f.apply === "live" ? "live" : "next page load") + (f.perSite ? ", can be changed per site" : "") + ")"));
      box.appendChild(label);
    }
  }

  function renderFeed() {
    const st = stored.feedState || {};
    const s = currentSettings();
    const tell = (t) => (s.features.threatTier ? t : t.replace(/packed threat list (still on|in use)/, "packed threat list off too"));
    $("feed-status").textContent = !s.enabled ? "Threat feed: off (extension turned off, packed threat list off too)."
      : tell(!s.features.threatFeed ? "Threat feed: paused (packed threat list still on)." : (st.text || "Threat feed: not set up (packed threat list in use)."));
    $("pause-feed").checked = !s.features.threatFeed;
    let lists = stored.generalListStatus || "Packed lists.";
    if (stored.generalListUpdatedAt) lists += " Last update: " + new Date(stored.generalListUpdatedAt).toLocaleString() + ".";
    $("lists-status").textContent = lists;
  }

  const focused = () => {
    try {
      return document.activeElement || null;
    } catch {
      return null;
    }
  };
  const focus = (node) => {
    try {
      if (node && node.focus) node.focus();
    } catch {
      // fake DOM in tests
    }
  };

  // Keyed list: rows are reused by key and only their label text changes, so
  // a storage write never replaces the button that has keyboard focus. When the
  // focused row goes away, focus moves to the next row's button (or the
  // previous one when it was the last row).
  function syncList(ul, items, emptyText, buttonText, onClick) {
    if (!ul._rows) {
      clear(ul);
      ul._rows = new Map();
    }
    const rows = ul._rows;
    const keys = items.map((i) => i.key);
    const active = focused();
    const oldKeys = [...rows.keys()];
    let refocus = null;
    let lost = false; // the focused row is gone
    for (const [i, k] of oldKeys.entries()) {
      if (keys.includes(k)) continue;
      const row = rows.get(k);
      if (active && row.button === active) {
        const after = oldKeys.slice(i + 1).find((x) => keys.includes(x));
        const before = oldKeys.slice(0, i).reverse().find((x) => keys.includes(x));
        refocus = after || before || null;
        lost = true;
      }
      ul.removeChild(row.li);
      rows.delete(k);
    }
    for (const item of items) {
      let row = rows.get(item.key);
      if (!row) {
        const li = el("li");
        const label = el("span");
        const button = el("button", item.button || buttonText);
        button.type = "button";
        const key = item.key;
        button.addEventListener("click", () => onClick(key, rows.get(key) && rows.get(key).kind));
        li.appendChild(label);
        li.appendChild(button);
        row = { li, label, button };
        rows.set(key, row);
        ul.appendChild(li);
      }
      row.kind = item.kind;
      if (row.label.textContent !== item.text) row.label.textContent = item.text;
      // Same node, new words: a row can turn from Allowed into Fixed.
      const words = item.button || buttonText;
      if (row.button.textContent !== words) row.button.textContent = words;
      // The name says which domain: "Remove example.com", not five "Remove".
      const name = words + " " + item.key;
      if (row.name !== name) {
        row.name = name;
        try {
          row.button.setAttribute("aria-label", name);
        } catch {
          // fake DOM in tests
        }
      }
    }
    // Keep the order; move rows only when it is wrong (a move can drop focus).
    const order = [...ul.children || []].filter((n) => n !== ul._empty);
    const want = keys.map((k) => rows.get(k).li);
    if (order.length === want.length && order.some((n, i) => n !== want[i])) {
      const keep = focused();
      for (const li of want) {
        ul.removeChild(li);
        ul.appendChild(li);
      }
      if (keep && keep !== focused()) focus(keep);
    }
    if (!keys.length && !ul._empty) {
      ul._empty = ul.appendChild(el("li", emptyText));
      ul._empty.tabIndex = -1; // focus target when the last row goes
    }
    else if (keys.length && ul._empty) {
      ul.removeChild(ul._empty);
      ul._empty = null;
    }
    if (refocus) focus(rows.get(refocus).button);
    else if (lost && ul._empty) focus(ul._empty);
  }

  function renderAllow() {
    const list = Array.isArray(stored.threatAllowDomains) ? stored.threatAllowDomains : [];
    const items = [...new Set(list)].map((d) => ({ key: d, text: d + " " }));
    syncList($("allow-list"), items, "No domains allowed.", "Remove", (d) => queued(async () => {
      const now = Array.isArray(stored.threatAllowDomains) ? stored.threatAllowDomains : [];
      await set({ threatAllowDomains: now.filter((x) => x !== d) });
    }));
  }

  // The switches "Fix this site" in the popup turns off (same list as popup.js).
  const FIXABLE = ["cosmetic", "guardClipboard", "guardPopups", "youtubeCosmetic", "twitchDisplay"];

  // Each row in plain words, and a button that undoes what the popup did:
  // Block again for an Allow, Undo fix for a Fix, Reset for anything else.
  function siteRow(h, e) {
    const feats = Object.entries(e.features || {});
    if (e.enabled === false) return { key: h, kind: "allowed", button: "Block again", text: h + ": Allowed – not blocking here " };
    if (feats.length && feats.every(([id, on]) => FIXABLE.includes(id) && on === false)) {
      return { key: h, kind: "fixed", button: "Undo fix", text: h + ": Fixed – hidden ad boxes and page guards off " };
    }
    const parts = feats.map(([id, on]) => (F.byId(id) || { label: id }).label + " " + (on ? "on" : "off"));
    return { key: h, kind: "other", button: "Reset", text: h + ": " + parts.join(", ") + " " };
  }

  function renderSites() {
    const o = F.normalizeOverrides(stored.siteOverrides);
    const items = Object.keys(o).sort().map((h) => siteRow(h, o[h]));
    // `kind` is the row's kind at click time; the step reads fresh storage.
    syncList($("site-list"), items, "No per-site switches. Use the popup on a site to add one.", "Reset", (h, kind) => queued(async () => {
      const next = F.normalizeOverrides(stored.siteOverrides);
      const e = next[h];
      if (!e) return;
      if (kind === "allowed") delete e.enabled;
      else if (kind === "fixed" && e.features) {
        for (const id of FIXABLE) if (e.features[id] === false) delete e.features[id];
        if (!Object.keys(e.features).length) delete e.features;
      } else delete next[h];
      if (next[h] && !Object.keys(next[h]).length) delete next[h];
      await set({ siteOverrides: next });
    }));
  }

  async function load() {
    stored = await get();
    renderFeatures();
    renderFeed();
    renderAllow();
    renderSites();
    if ($("ui-theme")) $("ui-theme").value = THEMES.includes(stored.uiTheme) ? stored.uiTheme : "auto";
    applyTheme(stored.uiTheme);
  }

  // The settings page wears the same theme as the popup ("auto" = no attribute:
  // purple, or high contrast when the system asks for it).
  function applyTheme(t) {
    try {
      const root = document.documentElement;
      if (t === "purple" || t === "contrast") root.setAttribute("data-theme", t);
      else root.removeAttribute("data-theme");
    } catch {
      // fake DOM in tests
    }
  }

  // Popup theme (design rules): automatic, the purple theme, or high contrast.
  if ($("ui-theme")) {
    $("ui-theme").addEventListener("change", async () => {
      const v = $("ui-theme").value;
      const theme = THEMES.includes(v) ? v : "auto";
      applyTheme(theme);
      await set({ uiTheme: theme });
    });
  }

  $("master").addEventListener("change", () => {
    const on = $("master").checked;
    return saveSettings((s) => { s.enabled = on; });
  });
  $("pause-feed").addEventListener("change", () => {
    const paused = $("pause-feed").checked;
    return saveSettings((s) => { s.features.threatFeed = !paused; });
  });
  $("update-lists").addEventListener("click", async () => {
    $("status").textContent = "Checking filter lists…";
    const r = await send("updateLists");
    $("status").textContent = r && r.ok ? "Lists updated." : "Update failed; the previous lists stay in use.";
    await load();
  });
  $("revert-lists").addEventListener("click", async () => {
    $("status").textContent = "Reverting…";
    const r = await send("revertLists");
    $("status").textContent = r && r.ok ? "Reverted to the packed lists." : "Revert failed.";
    await load();
  });
  async function allowDomain() {
    const checked = TC.userDomainReason($("allow-domain").value);
    const d = checked.domain;
    if (!d) {
      $("status").textContent = checked.reason === "not a domain name"
        ? "That is not a domain name (example: example.com)."
        : "That name is shared by many sites (" + checked.reason + "). Allow the one site instead, for example name.github.io.";
      return;
    }
    $("allow-domain").value = "";
    await queued(async () => {
      const list = Array.isArray(stored.threatAllowDomains) ? stored.threatAllowDomains.slice() : [];
      if (!list.includes(d)) list.push(d);
      await set({ threatAllowDomains: list });
    });
  }
  $("allow-add").addEventListener("click", allowDomain);
  // Enter in the box adds the domain too (the box is not in a form). Not
  // while an input method is still composing the text.
  $("allow-domain").addEventListener("keydown", (e) => {
    if (e && e.key === "Enter" && !e.isComposing) return allowDomain();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (KEYS.some((k) => changes[k])) load();
  });
  // settings.html#allow (the popup's "Chrome says the page is blocked?"):
  // bring the Allow this domain box into view and put the cursor in it. Once,
  // after the first load: later loads come from storage writes and must not
  // move focus.
  function hashAllow() {
    try {
      return typeof location !== "undefined" && location && location.hash === "#allow";
    } catch {
      return false;
    }
  }
  function goToAllow() {
    const input = $("allow-domain");
    if (!input) return;
    try {
      if (input.scrollIntoView) input.scrollIntoView({ block: "center" });
    } catch {
      // fake DOM in tests
    }
    focus(input);
  }
  load().then(() => {
    if (hashAllow()) goToAllow();
  });
  try {
    if (typeof addEventListener === "function") addEventListener("hashchange", () => { if (hashAllow()) goToAllow(); });
  } catch {
    // no window (tests)
  }
})();
