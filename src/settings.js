// Settings page (options_ui). Lists every feature from src/settings/features.js,
// the threat feed status with "Pause threat feed", "Revert lists", the
// threat-tier "Allow this domain" box and the per-site switches. Writes only
// the small keys settings / siteOverrides / threatAllowDomains; the worker does
// the rest. No remote code, no eval, text only (no innerHTML).
(function () {
  const F = globalThis.GeckoFeatures;
  const TC = globalThis.GeckoThreatCompile;
  const $ = (id) => document.getElementById(id);
  const KEYS = ["settings", "siteOverrides", "threatAllowDomains", "feedState", "generalListStatus", "generalListUpdatedAt"];
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
      chrome.runtime.sendMessage({ source: "twitch-adblock-general", type }, (r) => {
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

  async function saveSettings(mutate) {
    const s = currentSettings();
    mutate(s);
    await set({ settings: s });
    await load();
  }

  function renderFeatures() {
    const s = currentSettings();
    $("master").checked = s.enabled;
    const box = $("features");
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
      input.addEventListener("change", () => saveSettings((x) => { x.features[f.id] = input.checked; }));
      label.appendChild(input);
      label.appendChild(el("span", f.label + " (" + (f.apply === "live" ? "live" : "next page load") + (f.perSite ? ", can be changed per site" : "") + ")"));
      box.appendChild(label);
    }
  }

  function renderFeed() {
    const st = stored.feedState || {};
    const s = currentSettings();
    const paused = !(s.enabled && s.features.threatFeed);
    $("feed-status").textContent = paused ? "Threat feed: paused (packed threat list still on)." : (st.text || "Threat feed: not set up (packed threat list in use).");
    $("pause-feed").checked = !s.features.threatFeed;
    let lists = stored.generalListStatus || "Packed lists.";
    if (stored.generalListUpdatedAt) lists += " Last update: " + new Date(stored.generalListUpdatedAt).toLocaleString() + ".";
    $("lists-status").textContent = lists;
  }

  function renderAllow() {
    const ul = $("allow-list");
    clear(ul);
    const list = Array.isArray(stored.threatAllowDomains) ? stored.threatAllowDomains : [];
    if (!list.length) ul.appendChild(el("li", "No domains allowed."));
    for (const d of list) {
      const li = el("li", d + " ");
      const rm = el("button", "Remove");
      rm.type = "button";
      rm.addEventListener("click", async () => {
        await set({ threatAllowDomains: list.filter((x) => x !== d) });
        await load();
      });
      li.appendChild(rm);
      ul.appendChild(li);
    }
  }

  function renderSites() {
    const ul = $("site-list");
    clear(ul);
    const o = F.normalizeOverrides(stored.siteOverrides);
    const hosts = Object.keys(o).sort();
    if (!hosts.length) ul.appendChild(el("li", "No per-site switches. Use the popup on a site to add one."));
    for (const h of hosts) {
      const e = o[h];
      const parts = [];
      if (e.enabled === false) parts.push("site switched off");
      for (const [id, on] of Object.entries(e.features || {})) parts.push((F.byId(id) || { label: id }).label + " " + (on ? "on" : "off"));
      const li = el("li", h + ": " + parts.join(", ") + " ");
      const rm = el("button", "Reset");
      rm.type = "button";
      rm.addEventListener("click", async () => {
        const next = F.normalizeOverrides(stored.siteOverrides);
        delete next[h];
        await set({ siteOverrides: next });
        await load();
      });
      li.appendChild(rm);
      ul.appendChild(li);
    }
  }

  async function load() {
    stored = await get();
    renderFeatures();
    renderFeed();
    renderAllow();
    renderSites();
  }

  $("master").addEventListener("change", () => saveSettings((s) => { s.enabled = $("master").checked; }));
  $("pause-feed").addEventListener("change", () => saveSettings((s) => { s.features.threatFeed = !$("pause-feed").checked; }));
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
  $("allow-add").addEventListener("click", async () => {
    const checked = TC.userDomainReason($("allow-domain").value);
    const d = checked.domain;
    if (!d) {
      $("status").textContent = checked.reason === "not a domain name"
        ? "That is not a domain name (example: example.com)."
        : "That name is shared by many sites (" + checked.reason + "). Allow the one site instead, for example name.github.io.";
      return;
    }
    const list = Array.isArray(stored.threatAllowDomains) ? stored.threatAllowDomains.slice() : [];
    if (!list.includes(d)) list.push(d);
    await set({ threatAllowDomains: list });
    $("allow-domain").value = "";
    await load();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (KEYS.some((k) => changes[k])) load();
  });
  load();
})();
