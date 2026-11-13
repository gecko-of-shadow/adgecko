// Remove / Reset buttons must survive re-renders so keyboard focus is not thrown to the page start.
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

const buttons = (ul) => {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (c.tag === "button") out.push(c); walk(c); } };
  walk(ul);
  return out;
};

Deno.test("an unrelated storage write keeps the Remove / Reset buttons, so keyboard focus stays", async () => {
  const p = await openSettings({
    settings: { v: 1, enabled: true, features: {} },
    threatAllowDomains: ["a.example", "b.example"],
    siteOverrides: { "news.example": { enabled: false }, "shop.example": { enabled: false } },
  });
  const allowBefore = buttons(p.el["allow-list"]);
  const siteBefore = buttons(p.el["site-list"]);
  assert(allowBefore.length === 2 && siteBefore.length === 2, "lists built: " + allowBefore.length + "/" + siteBefore.length);
  p.write({ generalListStatus: "Lists updated." });
  p.write({ feedState: { text: "Threat feed: up to date." } });
  for (let i = 0; i < 6; i++) await settle();
  const allowAfter = buttons(p.el["allow-list"]);
  const siteAfter = buttons(p.el["site-list"]);
  assert(allowAfter.length === 2 && allowAfter.every((b, i) => b === allowBefore[i]),
    "a list-status write rebuilt the Allow this domain list; the focused Remove button was thrown away");
  assert(siteAfter.length === 2 && siteAfter.every((b, i) => b === siteBefore[i]),
    "a list-status write rebuilt the Per-site switches list; the focused Reset button was thrown away");
});

Deno.test("Reset on one site keeps the other site's Reset button (focus can move to it)", async () => {
  const p = await openSettings({
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: { "news.example": { enabled: false }, "shop.example": { enabled: false } },
  });
  const [news, shop] = buttons(p.el["site-list"]);
  await news.fire("click");
  for (let i = 0; i < 6; i++) await settle();
  assert(!("news.example" in (p.storage.siteOverrides || {})), "entry removed");
  const after = buttons(p.el["site-list"]);
  assert(after.length === 1 && after[0] === shop, "Reset rebuilt the whole list; the next entry's button is a new node and focus went to the page start");
});
