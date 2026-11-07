// The background worker's message handler: only the extension's own pages (the
// popup) may drive list refresh / DNR state; content scripts and other
// extensions are ignored.
import backgroundSource from "../src/general-background.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const EXT = "abcdefghijklmnopabcdefghijklmnop";

function loadWorker(rec = { badges: [], session: {} }) {
  const store = {};
  const listener = () => ({ addListener() {} });
  let onMessage = null;
  const chrome = {
    runtime: {
      id: EXT, lastError: undefined,
      getURL: (p) => "chrome-extension://" + EXT + "/" + p,
      onMessage: { addListener(f) { onMessage = f; } },
      onInstalled: listener(), onStartup: listener(),
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys || [])) if (k in store) out[k] = store[k]; cb(out); },
        set(items, cb) { Object.assign(store, items); if (cb) cb(); },
        remove(_k, cb) { if (cb) cb(); },
      },
      session: {
        get(k, cb) { const out = { listRefreshStarted: true }; for (const key of [].concat(k || [])) if (key in rec.session) out[key] = structuredClone(rec.session[key]); cb(out); },
        set(o, cb) { Object.assign(rec.session, structuredClone(o)); if (cb) cb(); },
      },
      onChanged: listener(),
    },
    declarativeNetRequest: {
      getDynamicRules(cb) { cb([]); },
      updateDynamicRules(_o, cb) { if (cb) cb(); },
      updateEnabledRulesets(_o, cb) { if (cb) cb(); },
    },
    action: {
      setIcon(_o, cb) { if (cb) cb(); }, setTitle() {},
      setBadgeText(o, cb) { rec.badges.push(["text", o.tabId, o.text]); (rec.shown = rec.shown || {})[o.tabId] = o.text; if (cb) cb(); },
      setBadgeBackgroundColor(o, cb) { rec.badges.push(["color", o.tabId, o.color]); if (cb) cb(); },
      getBadgeText(o, cb) { cb((rec.shown && rec.shown[o.tabId]) || ""); },
    },
  };
  const importScripts = (...names) => {
    for (const n of names) (0, eval)(Deno.readTextFileSync(new URL("../src/" + n, import.meta.url)));
  };
  const offline = () => Promise.reject(new TypeError("offline"));
  new Function("chrome", "importScripts", "setTimeout", "fetch", backgroundSource)(chrome, importScripts, () => 0, offline);
  return onMessage;
}

async function send(onMessage, message, sender) {
  let response;
  const keepOpen = onMessage(message, sender, (r) => { response = r; });
  await new Promise((r) => setTimeout(r, 50));
  return { keepOpen, response };
}

Deno.test("background messages: the popup is answered", async () => {
  const onMessage = loadWorker();
  const r = await send(onMessage, { source: "adgecko-general", type: "applyGeneralState" }, { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" });
  assert(r.keepOpen === true && r.response && r.response.ok, "popup answered: " + JSON.stringify(r));
});

Deno.test("background messages: content scripts and other extensions are ignored", async () => {
  const onMessage = loadWorker();
  for (const sender of [
    { id: EXT, tab: { id: 7 }, frameId: 0, url: "https://ads.example/" },
    { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html" },
    undefined,
  ]) {
    for (const type of ["updateLists", "applyGeneralState"]) {
      const r = await send(onMessage, { source: "adgecko-general", type }, sender);
      assert(r.keepOpen === undefined && r.response === undefined, type + " from " + JSON.stringify(sender) + " was handled");
    }
  }
});

// Design rules: a quiet magenta dot on the tab where a page guard blocked
// something. Content scripts may only report {kind} for their own tab.
Deno.test("background messages: a guard event from our content script sets that tab's dot; the popup reads and clears it", async () => {
  const rec = { badges: [], session: {} };
  const onMessage = loadWorker(rec);
  const tabSender = { id: EXT, tab: { id: 7 }, frameId: 0, url: "https://news.example/" };
  let r = await send(onMessage, { source: "adgecko-general", type: "guardEvent", kind: "clipboard" }, tabSender);
  assert(r.keepOpen === undefined && r.response === undefined, "no answer to a content script");
  assert(rec.badges.some((b) => b[0] === "text" && b[1] === 7 && b[2] === " ") && rec.badges.some((b) => b[0] === "color" && b[1] === 7 && b[2] === "#e81cd8"), JSON.stringify(rec.badges));
  assert(rec.session.tabSignals && rec.session.tabSignals[7].kind === "clipboard", "remembered for the popup");
  // Narrow: unknown kinds, no tab, other extensions: nothing.
  const before = rec.badges.length;
  await send(onMessage, { source: "adgecko-general", type: "guardEvent", kind: "flags" }, { id: EXT, tab: { id: 8 } });
  await send(onMessage, { source: "adgecko-general", type: "guardEvent", kind: "popup" }, { id: EXT });
  await send(onMessage, { source: "adgecko-general", type: "guardEvent", kind: "popup" }, { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", tab: { id: 9 } });
  assert(rec.badges.length === before, "ignored: " + JSON.stringify(rec.badges.slice(before)));
  // A content script cannot read or clear signals.
  r = await send(onMessage, { source: "adgecko-general", type: "tabSignal", tabId: 7 }, tabSender);
  assert(r.response === undefined, "tabSignal answered a content script");
  // The popup reads it once and the dot is cleared.
  r = await send(onMessage, { source: "adgecko-general", type: "tabSignal", tabId: 7 }, { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" });
  assert(r.response && r.response.ok && r.response.signal.kind === "clipboard", JSON.stringify(r));
  assert(rec.badges.at(-1)[0] === "text" && rec.badges.at(-1)[1] === 7 && rec.badges.at(-1)[2] === "", "dot cleared");
  r = await send(onMessage, { source: "adgecko-general", type: "tabSignal", tabId: 7 }, { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" });
  assert(r.response.signal === null, "read once");
});

// The popup and settings page add "Last update: <date>" themselves.
Deno.test("the list status text carries no date of its own", () => {
  const fn = backgroundSource.match(/function listStatusText[\s\S]*?\r?\n}\r?\n/);
  assert(fn, "listStatusText found");
  const listStatusText = new Function(fn[0] + "; return listStatusText;")();
  const when = new Date(0).toLocaleString();
  const text = listStatusText({ dynamicActive: true, updatedAt: 0, domainCount: 5 }, { ok: true });
  assert(text === "Lists updated (5 domains).", "got: " + text);
  assert(!listStatusText({ dynamicActive: true, updatedAt: 0, domainCount: 5, lastErrors: { a: "x" } }, { ok: true }).includes(when), "date repeated");
});

const popupSender = { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" };
const guard = (documentId) => ({ id: EXT, tab: { id: 7 }, frameId: 0, documentId, url: "https://news.example/" });
const ping = { source: "adgecko-general", type: "guardEvent", kind: "clipboard" };

// Chrome clears a tab's badge when the tab navigates, but the stored signal
// stays, so the popup used to blame the next page for the last page's block.
Deno.test("background messages: with no dot on the tab the popup gets no message, and the stale one is dropped", async () => {
  const rec = { badges: [], session: {} };
  const onMessage = loadWorker(rec);
  await send(onMessage, ping, guard("doc-1"));
  assert(rec.session.tabSignals[7], "remembered");
  rec.shown[7] = ""; // the tab navigated
  const r = await send(onMessage, { source: "adgecko-general", type: "tabSignal", tabId: 7 }, popupSender);
  assert(r.response.ok && r.response.signal === null, "stale signal handed out: " + JSON.stringify(r.response));
  assert(!rec.session.tabSignals[7], "stale signal kept");
});

Deno.test("background messages: bursts are per page, so a block right after navigating still gets its dot", async () => {
  const rec = { badges: [], session: {} };
  const onMessage = loadWorker(rec);
  await send(onMessage, ping, guard("doc-1"));
  const dots = () => rec.badges.filter((b) => b[0] === "text" && b[2] === " ").length;
  assert(dots() === 1, "first block");
  await send(onMessage, ping, guard("doc-1"));
  assert(dots() === 1, "same page: still one burst");
  rec.shown[7] = ""; // navigated
  await send(onMessage, ping, guard("doc-2"));
  assert(dots() === 2 && rec.shown[7] === " ", "new page, same tab: dot again");
});
