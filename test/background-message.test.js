// The background worker's message handler: only the extension's own pages (the
// popup) may drive list refresh / DNR state; content scripts and other
// extensions are ignored.
import backgroundSource from "../src/general-background.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const EXT = "abcdefghijklmnopabcdefghijklmnop";

function loadWorker() {
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
      session: { get(_k, cb) { cb({ listRefreshStarted: true }); }, set(_o, cb) { if (cb) cb(); } },
      onChanged: listener(),
    },
    declarativeNetRequest: {
      getDynamicRules(cb) { cb([]); },
      updateDynamicRules(_o, cb) { if (cb) cb(); },
      updateEnabledRulesets(_o, cb) { if (cb) cb(); },
    },
    action: { setIcon(_o, cb) { if (cb) cb(); }, setTitle() {} },
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
  const r = await send(onMessage, { source: "twitch-adblock-general", type: "applyGeneralState" }, { id: EXT, url: "chrome-extension://" + EXT + "/src/popup.html" });
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
      const r = await send(onMessage, { source: "twitch-adblock-general", type }, sender);
      assert(r.keepOpen === undefined && r.response === undefined, type + " from " + JSON.stringify(sender) + " was handled");
    }
  }
});
