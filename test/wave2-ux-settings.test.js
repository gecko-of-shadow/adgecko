// Wave 2, group ux: the settings page opened at #allow puts the cursor in the
// Allow this domain box; a pasted address keeps only its domain; the per-site
// list uses plain words with Block again / Undo fix / Reset.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import settingsHtml from "../src/settings.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }
function assertEquals(a, b, l) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((l || "expected equal") + "\n" + x + "\n" + y);
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const REAL_TC = globalThis.GeckoThreatCompile;

function fakeElement(tag, doc) {
  const listeners = {};
  return {
    tag, textContent: "", className: "", type: "", value: "", checked: false, disabled: false,
    dataset: {}, children: [], scrolled: 0,
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    async fire(t) { for (const fn of listeners[t] || []) await fn({ type: t }); for (let i = 0; i < 6; i++) await settle(); },
    focus() { doc.activeElement = this; },
    scrollIntoView() { this.scrolled++; },
    querySelectorAll(sel) {
      const out = [];
      if (sel !== "input[data-feature]") return out;
      const walk = (n) => { for (const c of n.children) { if (c.tag === "input" && c.dataset.feature) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
  };
}

async function openSettings(stored = {}, hash = "") {
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
  const document = {
    activeElement: null,
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => fakeElement(tag, document),
    documentElement: { setAttribute() {}, removeAttribute() {} },
  };
  for (const m of settingsHtml.matchAll(/\bid="([^"]+)"/g)) elements[m[1]] = fakeElement("page", document);
  globalThis.GeckoThreatCompile = REAL_TC;
  new Function("document", "chrome", "location", "addEventListener", settingsSource)(document, chrome, { hash }, () => {});
  for (let i = 0; i < 6; i++) await settle();
  return { el: elements, storage, document };
}

const rows = (ul) => ul.children.filter((li) => li.children.length === 2).map((li) => ({ text: li.children[0].textContent.trim(), button: li.children[1] }));

Deno.test("settings.html#allow focuses the Allow this domain box and scrolls it into view", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } }, "#allow");
  assert(p.document.activeElement === p.el["allow-domain"], "cursor in the box");
  assert(p.el["allow-domain"].scrolled > 0, "scrolled into view");
});

Deno.test("without #allow nothing takes focus, and a later storage write does not move it", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } }, "");
  assertEquals(p.document.activeElement, null, "no focus without the hash");
  const q = await openSettings({ settings: { v: 1, enabled: true, features: {} } }, "#allow");
  q.document.activeElement = q.el["ui-theme"];
  await q.el["update-lists"].fire("click"); // triggers load() again
  assert(q.document.activeElement === q.el["ui-theme"], "a reload of the lists stole focus");
});

Deno.test("a pasted full address is stored as its domain", async () => {
  const p = await openSettings({ settings: { v: 1, enabled: true, features: {} } });
  p.el["allow-domain"].value = "https://example.com/path?q=1";
  await p.el["allow-add"].fire("click");
  assertEquals(p.storage.threatAllowDomains, ["example.com"]);
  assert(/placeholder="example\.com or paste the address"/.test(settingsHtml), "placeholder says an address can be pasted");
});

Deno.test("per-site list: plain words and the right button for each row", async () => {
  const p = await openSettings({
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: {
      "allowed.example": { enabled: false },
      "fixed.example": { features: { cosmetic: false, guardClipboard: false, guardPopups: false } },
      "other.example": { features: { network: false } },
    },
  });
  const r = rows(p.el["site-list"]);
  assertEquals(r.map((x) => x.text), [
    "allowed.example: Allowed – not blocking here",
    "fixed.example: Fixed – hidden ad boxes and page guards off",
    "other.example: Block ads and trackers (filter lists) off",
  ]);
  assertEquals(r.map((x) => x.button.textContent), ["Block again", "Undo fix", "Reset"]);
});

Deno.test("Undo fix and Block again in the settings list remove only that host's change", async () => {
  const p = await openSettings({
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: {
      "allowed.example": { enabled: false },
      "fixed.example": { features: { cosmetic: false, guardClipboard: false } },
      "both.example": { enabled: false, features: { cosmetic: false } },
    },
  });
  const byHost = () => Object.fromEntries(rows(p.el["site-list"]).map((x) => [x.text.split(":")[0], x.button]));
  const before = byHost();
  await before["fixed.example"].fire("click");
  assertEquals(p.storage.siteOverrides, { "allowed.example": { enabled: false }, "both.example": { enabled: false, features: { cosmetic: false } } }, "Undo fix");
  await before["both.example"].fire("click"); // Block again keeps the Fix switch
  assertEquals(p.storage.siteOverrides, { "allowed.example": { enabled: false }, "both.example": { features: { cosmetic: false } } }, "Block again");
  const after = byHost();
  assert(after["both.example"] === before["both.example"], "same button node (keyboard focus stays)");
  assertEquals(after["both.example"].textContent, "Undo fix", "the row now says what the next click does");
  await after["allowed.example"].fire("click");
  assertEquals(p.storage.siteOverrides, { "both.example": { features: { cosmetic: false } } });
});
