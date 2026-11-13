// Nightly verifier: the ytd-popup-container :has() rules in src/youtube-ads.css
// (manifest CSS, always on) and INTERRUPTIONS_TOAST_CSS in src/youtube.js hide
// the WHOLE ytd-popup-container while the interruptions toast is in it. The
// toast is kept in the page on purpose (removeInterruptionsToast hides it in
// place), so the :has() stays true and every later popup that YouTube renders
// inside ytd-popup-container (the "..." action menu dropdown, Share, Save to
// playlist dialogs) is display:none + pointer-events:none until a reload.
import source from "../src/youtube.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const api = {};
const installYoutubeAdblock = new Function(`${unwrapMain(source)}\nreturn installYoutubeAdblock;`)();
installYoutubeAdblock(api);

// ---- tiny CSS selector engine for the grammar these rules use ----
// compound := tag? ('#'id)? ('[' attr '*=' "v" ']')* (':has(' compound ')')?
function parseCompound(text) {
  const re = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\[[\w-]+\*="[^"]*"\])*)(?::has\(([\s\S]+)\))?$/;
  const m = re.exec(text.trim());
  if (!m) return null;
  const attrs = [];
  for (const a of (m[3] || "").matchAll(/\[([\w-]+)\*="([^"]*)"\]/g)) attrs.push({ name: a[1], value: a[2] });
  let has = null;
  if (m[4] !== undefined) {
    has = parseCompound(m[4]);
    if (!has) return null;
  }
  return { tag: m[1] || null, id: m[2] ? m[2].slice(1) : null, attrs, has };
}

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function matchCompound(node, sel) {
  if (sel.tag && node.tagName !== sel.tag) return false;
  if (sel.id && node.id !== sel.id) return false;
  for (const a of sel.attrs) {
    const v = node.attributes[a.name];
    if (typeof v !== "string" || !v.includes(a.value)) return false;
  }
  if (sel.has && !descendants(node).some((d) => matchCompound(d, sel.has))) return false;
  return true;
}

function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

// Rules from youtube-ads.css that hide (display:none) something.
function hidingSelectorsFromCss(css) {
  const out = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/display\s*:\s*none/.test(m[2])) continue;
    for (const sel of splitTopLevel(m[1])) out.push(sel);
  }
  return out;
}

// ---- minimal element model ----
function el(tagName, { id = "", attrs = {}, text = "", children = [] } = {}) {
  const node = { nodeType: 1, tagName, id, attributes: { ...attrs }, ownText: text, children, parent: null };
  for (const c of children) c.parent = node;
  Object.defineProperty(node, "textContent", {
    get() {
      return node.ownText + node.children.map((c) => c.textContent).join("");
    },
  });
  const matchesList = (n, list) => splitTopLevel(list).some((s) => {
    // support "tag#id.class" forms used by youtube.js
    const cleaned = s.replace(/\.[\w-]+/g, "");
    const sel = parseCompound(cleaned);
    if (!sel) return false;
    if (/\.toast-button/.test(s) && !(n.attributes.class || "").includes("toast-button")) return false;
    return matchCompound(n, sel);
  });
  node.matches = (s) => matchesList(node, s);
  node.closest = (s) => {
    for (let cur = node; cur; cur = cur.parent) if (cur.matches(s)) return cur;
    return null;
  };
  node.querySelectorAll = (s) => descendants(node).filter((d) => matchesList(d, s));
  node.querySelector = (s) => node.querySelectorAll(s)[0] || null;
  node.hidden = false;
  node.style = { setProperty(name, value) { this[name] = value; } };
  return node;
}

function buildPage() {
  const toast = el("yt-notification-action-renderer", {
    children: [
      el("tp-yt-paper-toast", {
        id: "toast",
        children: [
          el("yt-formatted-string", {
            attrs: { "split-lines": "Experiencing interruptions?" },
            text: "Experiencing interruptions?",
          }),
          el("a", { attrs: { href: "https://support.google.com/youtube/answer/3037019" }, text: "Find out why" }),
        ],
      }),
    ],
  });
  const menuItem = el("ytd-menu-service-item-renderer", { text: "Save to Watch later" });
  const menu = el("tp-yt-iron-dropdown", {
    children: [el("ytd-menu-popup-renderer", { children: [menuItem] })],
  });
  const shareDialog = el("tp-yt-paper-dialog", {
    children: [el("ytd-unified-share-panel-renderer", { text: "Share" })],
  });
  const popupContainer = el("ytd-popup-container", { children: [toast, menu, shareDialog] });
  const app = el("ytd-app", { children: [popupContainer] });
  return { app, popupContainer, toast, menu, menuItem, shareDialog };
}

function hiddenBy(node, selectors) {
  for (let cur = node; cur; cur = cur.parent) {
    for (const s of selectors) {
      const sel = parseCompound(s);
      if (sel && matchCompound(cur, sel)) return { element: cur.tagName, selector: s };
    }
  }
  return null;
}

const css = await Deno.readTextFile(new URL("../src/youtube-ads.css", import.meta.url));
const manifestCssSelectors = hidingSelectorsFromCss(css);
const injectedSelectors = splitTopLevel(api.INTERRUPTIONS_TOAST_CSS);

Deno.test("sanity: the interruptions toast itself is hidden by both stylesheets", () => {
  const page = buildPage();
  assert(hiddenBy(page.toast, manifestCssSelectors), "manifest CSS hides the toast");
  assert(hiddenBy(page.toast, injectedSelectors), "INTERRUPTIONS_TOAST_CSS hides the toast");
});

Deno.test("removeInterruptionsToast keeps the toast node in ytd-popup-container", () => {
  const page = buildPage();
  api.removeInterruptionsToast(page.app);
  assert(page.toast.hidden === true, "toast hidden in place");
  assert(page.popupContainer.children.includes(page.toast), "toast node still inside ytd-popup-container");
});

Deno.test("youtube-ads.css: an action menu opened after the toast is not hidden", () => {
  const page = buildPage();
  api.removeInterruptionsToast(page.app);
  const hit = hiddenBy(page.menuItem, manifestCssSelectors);
  assert(!hit, "the action-menu item inside tp-yt-iron-dropdown is display:none via " + JSON.stringify(hit));
  const hitDialog = hiddenBy(page.shareDialog, manifestCssSelectors);
  assert(!hitDialog, "the Share dialog (tp-yt-paper-dialog) is display:none via " + JSON.stringify(hitDialog));
});

Deno.test("INTERRUPTIONS_TOAST_CSS: an action menu opened after the toast is not hidden", () => {
  const page = buildPage();
  api.removeInterruptionsToast(page.app);
  const hit = hiddenBy(page.menuItem, injectedSelectors);
  assert(!hit, "the action-menu item inside tp-yt-iron-dropdown is display:none via " + JSON.stringify(hit));
});
