// Wave 2, group ux: the popup's Reload page buttons, the way out of Chrome's
// "blocked by an extension" page, and a kept Fix shown with Undo fix.
// Runs the real popup.js on a fake page with a fake Chrome that has no "tabs"
// permission (tabs.query leaves tab.url out).
import "../src/settings/features.js";
import popupSource from "../src/popup.js" with { type: "text" };
import popupHtml from "../src/popup.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l || "assert failed"); }
function assertEquals(a, b, l) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((l || "expected equal") + "\n" + x + "\n" + y);
}
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeElement(hidden) {
  const listeners = {};
  return {
    textContent: "", hidden, disabled: false, dataset: {}, attrs: {}, src: "", open: false, focused: 0,
    focus() { this.focused++; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    async fire(t) { for (const fn of listeners[t] || []) await fn({ type: t }); for (let i = 0; i < 4; i++) await settle(); },
  };
}

// pageHref null: a page with no content script (Chrome's error page, a new tab).
// tabId null: no tab id at all.
async function openPopup({ pageHref = "https://news.example.com/a", tabId = 7, storage = {}, createFails = false } = {}) {
  const F = globalThis.GeckoFeatures;
  const calls = { reload: [], create: [], options: 0, background: [] };
  const siteInfo = (origin) => {
    let host = "";
    try { host = new URL(origin).hostname; } catch { return { ok: true, host: "", features: [] }; }
    const o = storage.siteOverrides || {};
    const own = o[host] || null;
    const features = F.FEATURES.filter((f) => f.sites.includes("all") || f.sites.includes("ordinary"))
      .map((f) => ({ id: f.id, perSite: f.perSite, apply: f.apply, available: f.id !== "guardMiners",
        site: own && own.features && typeof own.features[f.id] === "boolean" ? own.features[f.id] : null }));
    return { ok: true, host, overrideHost: host, stream: false, siteEnabled: !(own && own.enabled === false), enabled: true, features };
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      getURL: (p) => "chrome-extension://test/" + p,
      sendMessage(msg, cb) {
        calls.background.push(msg);
        if (msg.type === "siteInfo") return cb(siteInfo(msg.origin));
        cb({ ok: true });
      },
      openOptionsPage() { calls.options++; },
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
        set(patch, cb) { Object.assign(storage, structuredClone(patch)); cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; cb(); },
      },
    },
    tabs: {
      query(_q, cb) { cb([tabId === null ? { windowId: 1, active: true } : { id: tabId, windowId: 1, active: true }]); },
      sendMessage(_id, msg, _opt, cb) {
        if (pageHref && msg.type === "pageOrigin") return cb({ origin: new URL(pageHref).origin });
        chrome.runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        cb(undefined);
        chrome.runtime.lastError = undefined;
      },
      reload(id, props, cb) { calls.reload.push({ id, props }); if (cb) cb(); },
      create(props, cb) {
        calls.create.push(props);
        if (createFails) chrome.runtime.lastError = { message: "no" };
        cb && cb({ id: 99 });
        chrome.runtime.lastError = undefined;
      },
    },
  };
  const elements = {};
  for (const m of popupHtml.matchAll(/<(\w+)\s+id="([^"]+)"([^>]*)>/g)) elements[m[2]] = fakeElement(/\shidden(\s|$|>)/.test(m[3] + " "));
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  new Function("document", "chrome", popupSource)(document, chrome);
  for (let i = 0; i < 6; i++) await settle();
  return { el: elements, storage, calls, status: elements["site-status"] };
}

const FIXED = { cosmetic: false, guardClipboard: false, guardPopups: false };

// ---- 1. Reload page ----

Deno.test("Reload page in Did that fix it? reloads the active tab once and keeps the question up", async () => {
  const p = await openPopup({ storage: { popupWelcomed: true } });
  assertEquals(p.calls.reload.length, 0, "opening the popup reloads nothing");
  await p.el["fix-site"].fire("click");
  assertEquals(p.el["fix-ask"].hidden, false, "question showing");
  assert(popupHtml.indexOf('id="fix-reload"') > popupHtml.indexOf('id="fix-ask"') && popupHtml.indexOf('id="fix-reload"') < popupHtml.indexOf('id="fix-yes"'), "Reload page sits in the question, above Yes / No");
  assertEquals(p.calls.reload.length, 0, "Fix alone reloads nothing");
  await p.el["fix-reload"].fire("click");
  assertEquals(p.calls.reload, [{ id: 7, props: {} }], "one reload of the active tab");
  assertEquals(p.el["fix-ask"].hidden, false, "question still showing");
});

Deno.test("Reload page under Allow shows only after Allow / Block again, and reloads on a click", async () => {
  const p = await openPopup({ storage: { popupWelcomed: true } });
  assertEquals(p.el["reload-page"].hidden, true, "hidden before any click");
  await p.el["allow-site"].fire("click");
  assertEquals(p.status.textContent, "Allowed – not blocking here");
  assertEquals(p.calls.reload.length, 0, "Allow does not reload by itself");
  assertEquals(p.el["reload-page"].hidden, false, "shown after Allow");
  await p.el["reload-page"].fire("click");
  assertEquals(p.calls.reload, [{ id: 7, props: {} }]);
  await p.el["allow-site"].fire("click"); // Block again
  assertEquals(p.el["reload-page"].hidden, false, "still shown after Block again");
  assertEquals(p.calls.reload.length, 1, "Block again does not reload by itself");
  // A fresh popup on an allowed site: no click yet, no button.
  const q = await openPopup({ storage: { popupWelcomed: true, siteOverrides: { "news.example.com": { enabled: false } } } });
  assertEquals(q.el["reload-page"].hidden, true, "not shown just because the site is allowed");
});

Deno.test("Reload page with no tab id does not throw and does not reload", async () => {
  const p = await openPopup({ tabId: null, pageHref: null, storage: { popupWelcomed: true } });
  await p.el["fix-reload"].fire("click");
  await p.el["reload-page"].fire("click");
  assertEquals(p.calls.reload.length, 0);
  assertEquals(p.el["reload-page"].hidden, true);
});

Deno.test("no new permissions: no tabs, no all-sites host access", () => {
  assert(!manifest.permissions.includes("tabs"), "tabs permission");
  for (const h of manifest.host_permissions || []) assert(h !== "<all_urls>" && h !== "*://*/*", "all-sites host permission: " + h);
});

// ---- 2. Chrome's "blocked by an extension" page ----

Deno.test("a page with no address offers Allow its domain, which opens settings at #allow", async () => {
  const p = await openPopup({ pageHref: null, storage: { popupWelcomed: true } });
  assertEquals(p.el["site-host"].textContent, "No web page");
  assertEquals(p.el["open-allow-domain"].hidden, false, "button shown");
  assert(p.el["page-status"].textContent.startsWith("Open a normal http(s) page"), "old explanation kept");
  await p.el["open-allow-domain"].fire("click");
  assertEquals(p.calls.create.length, 1, "one tab opened");
  assert(p.calls.create[0].url.endsWith("src/settings.html#allow"), "opens " + p.calls.create[0].url);
  assertEquals(p.calls.options, 0, "no fallback needed");
});

Deno.test("Allow its domain falls back to the options page when tabs.create fails", async () => {
  const p = await openPopup({ pageHref: null, createFails: true, storage: { popupWelcomed: true } });
  await p.el["open-allow-domain"].fire("click");
  assertEquals(p.calls.options, 1);
});

Deno.test("on a normal https page the Allow its domain button is hidden", async () => {
  const p = await openPopup({ storage: { popupWelcomed: true } });
  assertEquals(p.el["open-allow-domain"].hidden, true);
});

// ---- 3. A kept Fix: truthful status and Undo fix ----

Deno.test("a kept Fix shows its own status and Undo fix in place of Fix this site", async () => {
  const p = await openPopup({ storage: { popupWelcomed: true, siteOverrides: { "news.example.com": { features: FIXED } } } });
  assertEquals(p.status.textContent, "Protected – some filters off here (Fix this site)");
  assertEquals(p.el["undo-fix"].hidden, false, "Undo fix shown");
  assertEquals(p.el["fix-site"].hidden, true, "Fix this site hidden");
  assertEquals(p.el["fix-ask"].hidden, true, "no question");
});

Deno.test("Undo fix removes only this host's Fix switches, then shows Protected and Reload page", async () => {
  const storage = { popupWelcomed: true, siteOverrides: { "news.example.com": { features: FIXED }, "other.example": { features: FIXED } } };
  const p = await openPopup({ storage });
  await p.el["undo-fix"].fire("click");
  assertEquals(storage.siteOverrides, { "other.example": { features: FIXED } }, "only this host's entry removed");
  assertEquals(p.status.textContent, "✅ Protected");
  assertEquals(p.el["undo-fix"].hidden, true);
  assertEquals(p.el["fix-site"].hidden, false);
  assert(p.el["fix-site"].focused > 0, "keyboard focus moves to Fix this site");
  assertEquals(p.el["reload-page"].hidden, false, "Reload page offered");
  assertEquals(p.calls.reload.length, 0, "no reload by itself");
  assert(p.calls.background.some((m) => m.type === "applyGeneralState"), "rules re-applied");
});

Deno.test("Undo fix keeps a switch the Fix did not turn off", async () => {
  const storage = { popupWelcomed: true, siteOverrides: { "news.example.com": { features: { cosmetic: false, guardPopups: true } } } };
  const p = await openPopup({ storage });
  await p.el["undo-fix"].fire("click");
  assertEquals(storage.siteOverrides, { "news.example.com": { features: { guardPopups: true } } });
});

Deno.test("an allowed site with Fix switches still says Allowed, with no Undo fix", async () => {
  const p = await openPopup({ storage: { popupWelcomed: true, siteOverrides: { "news.example.com": { enabled: false, features: FIXED } } } });
  assertEquals(p.status.textContent, "Allowed – not blocking here");
  assertEquals(p.el["undo-fix"].hidden, true);
});

Deno.test("No turns the filters back on and offers Reload page, without reloading by itself", async () => {
  const storage = { popupWelcomed: true };
  const p = await openPopup({ storage });
  assertEquals(p.el["reload-page"].hidden, true, "hidden before any click");
  await p.el["fix-site"].fire("click");
  await p.el["fix-no"].fire("click");
  assertEquals(p.el["reload-page"].hidden, false, "Reload page offered after No");
  assertEquals(p.calls.reload.length, 0, "No does not reload by itself");
});

Deno.test("Yes keeps the Fix: the next popup shows the fixed status", async () => {
  const storage = { popupWelcomed: true };
  const p = await openPopup({ storage });
  await p.el["fix-site"].fire("click");
  await p.el["fix-yes"].fire("click");
  const q = await openPopup({ storage });
  assertEquals(q.status.textContent, "Protected – some filters off here (Fix this site)");
  assertEquals(q.el["undo-fix"].hidden, false);
});

Deno.test("plain words: new strings in the popup, no jargon, FIXABLE lists agree", () => {
  for (const s of ["Reload page", "Undo fix", "Chrome says the page is blocked? Allow its domain"]) assert(popupHtml.includes(s), "missing: " + s);
  assert(popupSource.includes("Protected – some filters off here (Fix this site)"), "status text");
  const list = (src) => src.match(/const FIXABLE = (\[[^\]]*\]);/)[1];
  assertEquals(list(settingsSource), list(popupSource), "settings.js and popup.js agree on the Fix switches");
  assertEquals([...popupSource.matchAll(/chrome\.tabs\.reload\(/g)].length, 1, "one reload call, inside reloadTab()");
});
