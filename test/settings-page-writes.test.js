// WP-23 (review 2026-11-16), settings page: two changes that overlap a slow
// storage write must both be kept (item 3), and each list row button names
// its domain (item 8). Runs the real settings.js on a small fake page.
import "../src/settings/features.js";
import settingsHtml from "../src/settings.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await wait(0); };

function fakeElement(tag) {
  const listeners = {};
  return {
    tag, textContent: "", className: "", type: "", value: "", checked: false, disabled: false,
    dataset: {}, children: [], attrs: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    fire(t) { return Promise.all((listeners[t] || []).map((fn) => fn({ type: t }))); },
    querySelectorAll() {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.tag === "input" && c.dataset.feature) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
  };
}

// setMs: how long one storage.local.set takes (the worker writes big list
// data at the same time, for example during Update lists).
async function openSettings(stored, setMs = 0) {
  const storage = structuredClone(stored);
  const changed = [];
  const chrome = {
    runtime: { lastError: undefined, sendMessage(_m, cb) { cb({ ok: true }); } },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); setTimeout(() => cb(out), 0); },
        set(patch, cb) {
          setTimeout(() => {
            Object.assign(storage, structuredClone(patch));
            cb();
            const changes = Object.fromEntries(Object.keys(patch).map((k) => [k, {}]));
            for (const fn of changed) fn(changes, "local");
          }, setMs);
        },
      },
      onChanged: { addListener(fn) { changed.push(fn); } },
    },
  };
  const elements = {};
  for (const m of settingsHtml.matchAll(/\bid="([^"]+)"/g)) elements[m[1]] = fakeElement("page");
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => fakeElement(tag),
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  globalThis.GeckoThreatCompile = { userDomainReason: (v) => ({ domain: v }) };
  new Function("document", "chrome", settingsSource)(document, chrome);
  await settle();
  const box = (id) => elements.features.querySelectorAll().find((b) => b.dataset.feature === id);
  const buttons = (listId) => elements[listId].children.map((li) => li.children && li.children[1]).filter(Boolean);
  return { el: elements, storage, box, buttons };
}

Deno.test("WP-23.3: two quick switch changes during a slow write are both kept", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } }, 30);
  const a = p.box("guardClipboard"), b = p.box("cosmetic");
  assert(a.checked === true && b.checked === true, "both on at the start");
  a.checked = false;
  const pa = a.fire("change");
  await wait(10); // the second click, 10 ms later
  b.checked = false;
  const pb = b.fire("change");
  await Promise.all([pa, pb]);
  await wait(150);
  await settle();
  const f = p.storage.settings.features;
  assert(f.guardClipboard === false, "first change lost: guardClipboard = " + f.guardClipboard);
  assert(f.cosmetic === false, "second change lost: cosmetic = " + f.cosmetic);
  assert(a.checked === false && b.checked === false, "the boxes show what is stored");
});

Deno.test("WP-23.3: two quick Remove clicks on the allow list both remove", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} }, threatAllowDomains: ["a.com", "b.com", "c.com"] }, 30);
  const [ra, rb] = p.buttons("allow-list");
  const one = ra.fire("click");
  await wait(10);
  const two = rb.fire("click");
  await Promise.all([one, two]);
  await wait(150);
  await settle();
  assert(JSON.stringify(p.storage.threatAllowDomains) === '["c.com"]', "allow list: " + JSON.stringify(p.storage.threatAllowDomains));
});

Deno.test("WP-23.8: each list button names its domain", async () => {
  const p = await openSettings({
    settings: { v: 1, enabled: true, features: {} },
    threatAllowDomains: ["a.com", "b.com"],
    siteOverrides: { "x.com": { enabled: false }, "y.com": { features: { cosmetic: false, guardClipboard: false, guardPopups: false } }, "z.com": { features: { guardPopups: true } } },
  });
  const allow = p.buttons("allow-list").map((b) => b.attrs["aria-label"]);
  assert(JSON.stringify(allow) === '["Remove a.com","Remove b.com"]', "allow list names: " + JSON.stringify(allow));
  const sites = p.buttons("site-list").map((b) => b.attrs["aria-label"]);
  assert(JSON.stringify(sites) === '["Block again x.com","Undo fix y.com","Reset z.com"]', "site list names: " + JSON.stringify(sites));
  // Same row, new words: the name follows (Undo fix turns into Block again).
  const yRow = p.buttons("site-list")[1];
  await yRow.fire("click"); // Undo fix: y.com has no switches left, its row goes
  await settle();
  const after = p.buttons("site-list").map((b) => b.attrs["aria-label"]);
  assert(JSON.stringify(after) === '["Block again x.com","Reset z.com"]', "after Undo fix: " + JSON.stringify(after));
});
