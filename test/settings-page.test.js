// Runs the real settings.js on a small fake page. The feature boxes must stay
// the same nodes when storage changes: rebuilding them threw keyboard focus back
// to the top of the page, so Tab, Space kept flipping the first switch. The
// theme switch must store the choice and change the page.
import "../src/settings/features.js";
import settingsHtml from "../src/settings.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeElement(tag) {
  const listeners = {};
  const e = {
    tag, textContent: "", className: "", type: "", value: "", checked: false, disabled: false,
    dataset: {}, children: [],
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    async fire(t) { for (const fn of listeners[t] || []) await fn({ type: t }); },
    querySelectorAll(sel) {
      assert(sel === "input[data-feature]", "fake page knows only this selector: " + sel);
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.tag === "input" && c.dataset.feature) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
  };
  return e;
}

async function openSettings(stored = {}) {
  const storage = structuredClone(stored);
  const changed = [];
  const chrome = {
    runtime: { lastError: undefined, sendMessage(_m, cb) { cb({ ok: true }); } },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) if (k in storage) out[k] = structuredClone(storage[k]); cb(out); },
        set(patch, cb) {
          Object.assign(storage, structuredClone(patch));
          cb();
          const changes = Object.fromEntries(Object.keys(patch).map((k) => [k, {}]));
          for (const fn of changed) fn(changes, "local");
        },
      },
      onChanged: { addListener(fn) { changed.push(fn); } },
    },
  };
  const elements = {};
  for (const m of settingsHtml.matchAll(/\bid="([^"]+)"/g)) elements[m[1]] = fakeElement("page");
  const rootAttrs = {};
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => fakeElement(tag),
    documentElement: { setAttribute: (k, v) => { rootAttrs[k] = v; }, removeAttribute: (k) => { delete rootAttrs[k]; } },
  };
  globalThis.GeckoThreatCompile = { userDomainReason: (v) => ({ domain: v }) };
  new Function("document", "chrome", settingsSource)(document, chrome);
  for (let i = 0; i < 4; i++) await settle();
  const boxes = () => elements.features.querySelectorAll("input[data-feature]");
  const box = (id) => boxes().find((b) => b.dataset.feature === id);
  return { el: elements, storage, rootAttrs, boxes, box, chrome, write: (patch) => chrome.storage.local.set(patch, () => {}) };
}

Deno.test("ticking a feature keeps every box, so keyboard focus stays where it was", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } });
  const before = p.boxes();
  assert(before.length > 5, "feature boxes built");
  const target = p.box("guardClipboard");
  target.checked = !target.checked;
  const value = target.checked;
  await target.fire("change");
  for (let i = 0; i < 4; i++) await settle();
  assert(p.storage.settings.features.guardClipboard === value, "saved");
  const after = p.boxes();
  assert(after.length === before.length && after.every((b, i) => b === before[i]), "boxes were rebuilt; the focused one was thrown away");
});

Deno.test("a background storage write leaves the boxes alone but still shows new values", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: { cosmetic: true } } });
  const target = p.box("cosmetic");
  p.write({ generalListStatus: "Lists updated." });
  for (let i = 0; i < 4; i++) await settle();
  assert(p.box("cosmetic") === target, "a list refresh rebuilt the boxes");
  p.write({ settings: { v: 1, enabled: true, features: { cosmetic: false } } });
  for (let i = 0; i < 4; i++) await settle();
  assert(p.box("cosmetic") === target && target.checked === false, "new value shown in place");
  p.write({ settings: { v: 1, enabled: false, features: {} } });
  for (let i = 0; i < 4; i++) await settle();
  assert(p.boxes().every((b) => b.disabled), "master off greys every box");
  p.write({ settings: { v: 1, enabled: true, features: {} } });
  for (let i = 0; i < 4; i++) await settle();
  assert(p.boxes().every((b) => !b.disabled), "master on again");
});

Deno.test("the theme switch offers three choices, stores the pick and changes the page", async () => {
  const select = settingsHtml.match(/<select[^>]*id="ui-theme"[^>]*>([\s\S]*?)<\/select>/);
  assert(select, "theme switch exists");
  const values = [...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(values) === JSON.stringify(["auto", "purple", "contrast"]), "options: " + values);

  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } });
  assert(p.el["ui-theme"].value === "auto" && !("data-theme" in p.rootAttrs), "starts automatic");
  for (const pick of ["contrast", "purple"]) {
    p.el["ui-theme"].value = pick;
    await p.el["ui-theme"].fire("change");
    assert(p.storage.uiTheme === pick, "stored under uiTheme: " + pick);
    assert(p.rootAttrs["data-theme"] === pick, "page wears " + pick);
  }
  p.el["ui-theme"].value = "auto";
  await p.el["ui-theme"].fire("change");
  assert(p.storage.uiTheme === "auto" && !("data-theme" in p.rootAttrs), "automatic drops the attribute");

  const back = await openSettings({ settings: { v: 1, enabled: true, features: {} }, uiTheme: "contrast" });
  assert(back.rootAttrs["data-theme"] === "contrast" && back.el["ui-theme"].value === "contrast", "applied on load");
});
