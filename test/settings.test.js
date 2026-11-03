// Block H: feature registry, settings / siteOverrides storage, migration,
// per-site switches, the worker's derived state, and the stream-site safety net.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import manifest from "../manifest.json" with { type: "json" };
import general from "../src/rules/general-network.json" with { type: "json" };
import uboYoutube from "../src/rules/ubo-youtube-network.json" with { type: "json" };
import threat from "../src/rules/threat-network.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";
import { loadWorker, settle, EXT } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const F = globalThis.GeckoFeatures;
const SRC = new URL("../src/", import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, SRC));

Deno.test("registry: the 13 features, each with layer, default, apply mode and per-site flag", () => {
  assert(eq(F.IDS, ["network", "threatTier", "threatFeed", "cosmetic", "twitchPlayer", "twitchDisplay", "youtubeScriptlets", "youtubeWatchdog", "youtubeCosmetic", "kick", "guardClipboard", "guardPopups", "guardMiners"]), F.IDS.join());
  for (const f of F.FEATURES) {
    assert(["dnr", "isolated", "main"].includes(f.layer) && typeof f.default === "boolean" && ["live", "next-load", "always"].includes(f.apply) && typeof f.perSite === "boolean", f.id);
    assert(Array.isArray(f.sites) && f.sites.length && typeof f.label === "string" && f.label, f.id + " sites/label");
  }
  // Owner decision D-3: the vendored Twitch swap and uBO scriptlets are always on.
  assert(F.byId("twitchPlayer").apply === "always" && F.byId("youtubeScriptlets").apply === "always", "vendored always on");
  assert(F.byId("guardPopups").default === false && F.byId("guardClipboard").default === true, "guard defaults (D-4)");
});

Deno.test("registry is consistent with the manifest content scripts", () => {
  const files = new Set(manifest.content_scripts.flatMap((c) => c.js));
  for (const f of F.FEATURES) for (const s of f.scripts || []) assert(files.has(s), f.id + " script not in manifest: " + s);
  const owned = [...files].filter((p) => !p.startsWith("src/vendor/"));
  const infra = ["src/settings/features.js", "src/settings/flags.js", "src/general/cosmetic-parse.js"];
  for (const p of owned) assert(infra.includes(p) || F.FEATURES.some((f) => (f.scripts || []).includes(p)), "content script without a feature: " + p);
  // The registry loads before every owned ISOLATED script that reads it.
  for (const cs of manifest.content_scripts) {
    if (cs.world === "MAIN") continue;
    const i = cs.js.indexOf("src/settings/features.js");
    for (const p of ["src/cosmetic.js", "src/twitch-directory-ads.js", "src/settings/flags.js"]) {
      if (cs.js.includes(p)) assert(i >= 0 && i < cs.js.indexOf(p), "features.js must come before " + p);
    }
  }
  assert(manifest.options_ui && manifest.options_ui.page === "src/settings.html", "settings page wired");
});

Deno.test("the stream-site list exists in exactly one place: manifest exclude_matches are generated from it", () => {
  const cosmetic = manifest.content_scripts.find((c) => c.js.includes("src/cosmetic.js"));
  assert(eq([...cosmetic.exclude_matches].sort(), F.streamExcludeMatches().sort()), "cosmetic exclude_matches != registry");
  // The former copies now ask the registry.
  for (const [file, src] of [["general-settings.js", read("general-settings.js")], ["popup.js", read("popup.js")], ["cosmetic.js", read("cosmetic.js")], ["general/cosmetic-parse.js", read("general/cosmetic-parse.js")], ["settings/flags.js", read("settings/flags.js")], ["settings.js", read("settings.js")]]) {
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const d of ["twitch.tv", "youtube.com", "kick.com", "kickusercontent.com", "googlevideo.com"]) {
      assert(!code.includes(d) && !code.includes(d.replace(/\./g, "\\.")), file + " still lists " + d);
    }
  }
  for (const d of ["twitch.tv", "ttvnw.net", "youtube.com", "youtu.be", "googlevideo.com", "kick.com", "kickusercontent.com"]) assert(F.isStreamHost("a." + d) && F.isStreamHost(d), d);
  assert(!F.isStreamHost("nottwitch.tv") && !F.isStreamHost("twitch.tv.evil.example") && !F.isStreamHost(""), "lookalikes");
});

Deno.test("migration from generalEnabled / generalAllowedOrigins is complete and idempotent", () => {
  const m = F.migrateLegacy({ generalEnabled: false, generalAllowedOrigins: ["https://news.example", "http://shop.example:8080", "https://www.youtube.com", "not a url"] });
  assert(m.settings.features.network === false && m.settings.enabled === true, JSON.stringify(m.settings));
  assert(eq(m.siteOverrides, { "news.example": { enabled: false }, "shop.example": { enabled: false } }), JSON.stringify(m.siteOverrides));
  assert(F.migrateLegacy({ settings: m.settings, generalEnabled: true }) === null, "already migrated: untouched");
  const fresh = F.migrateLegacy({});
  assert(fresh.settings.features.network === true && eq(fresh.siteOverrides, {}), "fresh install");
  for (const f of F.FEATURES) assert(fresh.settings.features[f.id] === f.default, "default " + f.id);
});

Deno.test("per-site overrides: site switch, per-feature override, parent domains, master switch, always-on and unavailable features", () => {
  const settings = { v: 1, enabled: true, features: { cosmetic: true, network: true, guardPopups: false } };
  const overrides = { "example.com": { enabled: false }, "news.example": { features: { cosmetic: false } } };
  const off = F.resolve(settings, overrides, "www.example.com");
  assert(!off.network && !off.cosmetic && off.threatTier && off.twitchPlayer && off.youtubeScriptlets, "site off: per-site features off, threat + vendored stay " + JSON.stringify(off));
  const news = F.resolve(settings, overrides, "news.example");
  assert(news.network && !news.cosmetic, "one feature off " + JSON.stringify(news));
  const other = F.resolve(settings, overrides, "other.example");
  assert(other.network && other.cosmetic && !other.guardPopups && !other.guardMiners, "defaults elsewhere");
  const master = F.resolve({ enabled: false }, {}, "other.example");
  assert(Object.entries(master).every(([id, on]) => (F.byId(id).apply === "always" ? on : !on)), "master off " + JSON.stringify(master));
  assert(F.resolve({ features: { twitchPlayer: false } }, {}, "www.twitch.tv").twitchPlayer === true, "always-on cannot be switched off");
  assert(eq(F.normalizeOverrides({ "A.Example.": { enabled: false, features: { threatTier: false, cosmetic: false, bogus: true } } }), { "a.example": { enabled: false, features: { cosmetic: false } } }), "only per-site features stored");
});

Deno.test("the site switch on a stream site turns our own helpers off there (vendored ones and the threat tier stay on)", () => {
  const s = { v: 1, enabled: true, features: {} };
  const o = { "www.youtube.com": { enabled: false }, "kick.com": { enabled: false }, "twitch.tv": { enabled: false } };
  const yt = F.resolve(s, o, "www.youtube.com");
  assert(!yt.youtubeWatchdog && !yt.youtubeCosmetic && yt.youtubeScriptlets && yt.threatTier, JSON.stringify(yt));
  assert(!F.resolve(s, o, "kick.com").kick && F.resolve(s, {}, "kick.com").kick, "kick");
  const tw = F.resolve(s, o, "www.twitch.tv");
  assert(!tw.twitchDisplay && tw.twitchPlayer, "twitch: display off, vendored swap stays");
  // One helper off on one site via the popup's feature list.
  assert(!F.resolve(s, { "www.youtube.com": { features: { youtubeWatchdog: false } } }, "www.youtube.com").youtubeWatchdog, "per-feature on a stream site");
  for (const id of ["twitchDisplay", "youtubeWatchdog", "youtubeCosmetic", "kick"]) assert(F.byId(id).perSite, id + " per-site");
});

Deno.test("legacy mirror: lists switch and allowed origins come from settings, never a stream site", () => {
  const m = F.legacyMirror({ enabled: true, features: { network: true } }, { "news.example": { enabled: false }, "www.youtube.com": { enabled: false }, "kick.com": { features: { network: false } }, "shop.example": { features: { network: false } }, "blog.example": { features: { cosmetic: false } } });
  assert(m.generalEnabled === true && eq(m.generalAllowedOrigins, ["http://news.example", "http://shop.example", "https://news.example", "https://shop.example"]), JSON.stringify(m));
  assert(F.legacyMirror({ enabled: false, features: {} }, {}).generalEnabled === false, "master off = lists off");
});

async function worker(store) {
  const w = loadWorker({ store });
  await settle(250);
  return w;
}

Deno.test("worker: migrates the old keys at start and derives the old keys back from new settings", async () => {
  const w = await worker({ generalEnabled: true, generalAllowedOrigins: ["https://news.example"] });
  assert(w.store.settings && w.store.siteOverrides && w.store.siteOverrides["news.example"].enabled === false, JSON.stringify(w.store.siteOverrides));
  assert(eq(w.store.generalAllowedOrigins, ["http://news.example", "https://news.example"]), "mirror " + JSON.stringify(w.store.generalAllowedOrigins));
  await new Promise((r) => w.chrome.storage.local.set({ siteOverrides: { "shop.example": { enabled: false } } }, r));
  await settle(250);
  assert(eq(w.store.generalAllowedOrigins, ["http://shop.example", "https://shop.example"]), JSON.stringify(w.store.generalAllowedOrigins));
  const allows = w.dnr.dynamic.filter((r) => r.priority === 10000).map((r) => r.condition.initiatorDomains[0]);
  assert(allows.includes("shop.example") && !allows.includes("news.example"), "allow rules follow: " + allows);
  await new Promise((r) => w.chrome.storage.local.set({ settings: { v: 1, enabled: true, features: { network: false } } }, r));
  await settle(300);
  assert(w.store.generalEnabled === false && !w.dnr.staticOn, "lists switch follows settings");
});

Deno.test("worker: threatTier off disables the threat ruleset and removes refreshed threat rules; threatFeed off pauses the feed", async () => {
  const w = await worker({ settings: { v: 1, enabled: true, features: {} } });
  w.dnr.dynamic.push({ id: 600000, priority: 2000010, action: { type: "block" }, condition: { requestDomains: ["t.example"] } });
  assert(w.dnr.threatOn === true, "on by default");
  await new Promise((r) => w.chrome.storage.local.set({ settings: { v: 1, enabled: true, features: { threatTier: false, threatFeed: false } } }, r));
  await settle(300);
  assert(w.dnr.threatOn === false && !w.dnr.dynamic.some((r) => r.id === 600000), "threat tier off");
  assert(w.store.feedPaused === true, "feed paused");
  await new Promise((r) => w.chrome.storage.local.set({ settings: { v: 1, enabled: true, features: {} } }, r));
  await settle(300);
  assert(w.dnr.threatOn === true && w.store.feedPaused === false, "back on");
});

Deno.test("worker: siteInfo answers the popup; the settings page may message the worker, content scripts may not", async () => {
  const w = await worker({ settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "news.example": { features: { cosmetic: false } } } });
  const info = await w.send({ source: "twitch-adblock-general", type: "siteInfo", origin: "https://news.example" });
  assert(info.ok && info.host === "news.example" && !info.stream && info.siteEnabled, JSON.stringify(info));
  const cos = info.features.find((f) => f.id === "cosmetic");
  assert(cos && cos.on === false && cos.site === false && cos.perSite, JSON.stringify(cos));
  assert(!info.features.some((f) => f.id === "kick" || f.id === "youtubeWatchdog"), "only features for this site");
  const yt = await w.send({ source: "twitch-adblock-general", type: "siteInfo", origin: "https://www.youtube.com" });
  assert(yt.stream && yt.features.some((f) => f.id === "youtubeWatchdog") && !yt.features.some((f) => f.id === "cosmetic"), JSON.stringify(yt.features.map((f) => f.id)));
  const page = await w.send({ source: "twitch-adblock-general", type: "siteInfo", origin: "https://news.example" }, { id: EXT, tab: { id: 3 }, url: "chrome-extension://" + EXT + "/src/settings.html" });
  assert(page && page.ok, "settings page tab accepted");
  const cs = await w.send({ source: "twitch-adblock-general", type: "revertLists" }, { id: EXT, tab: { id: 3 }, url: "https://evil.example/src/settings.html" });
  assert(cs === undefined, "content script refused");
});

Deno.test("safety net: no switch state removes a stream site's allows or blocks its hosts on its own pages", async () => {
  const STREAM = ["www.twitch.tv", "usher.ttvnw.net", "video-edge-x.abc.hls.ttvnw.net", "static-cdn.jtvnw.net", "www.youtube.com", "rr1---sn-x.googlevideo.com", "i.ytimg.com", "yt3.ggpht.com", "youtubei.googleapis.com", "kick.com", "files.kick.com", "cdn.kickusercontent.com", "x.live-video.net"];
  const pages = { youtube: ["www.youtube.com"], embed: ["news.example", "www.youtube-nocookie.com"], kick: ["kick.com"], twitch: ["www.twitch.tv"] };
  const states = [
    { settings: { v: 1, enabled: true, features: {} } },
    { settings: { v: 1, enabled: true, features: { network: false } } },
    { settings: { v: 1, enabled: false, features: {} } },
    { settings: { v: 1, enabled: true, features: { threatTier: false } } },
    { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "www.youtube.com": { enabled: false }, "kick.com": { enabled: false }, "twitch.tv": { enabled: false }, "googlevideo.com": { features: { network: false } } } },
  ];
  for (const st of states) {
    const w = await worker(Object.assign({}, st));
    await w.send({ source: "twitch-adblock-general", type: "applyGeneralState" });
    await settle(200);
    const rules = (w.dnr.staticOn ? general : []).concat(uboYoutube, w.dnr.threatOn ? threat : [], w.dnr.dynamic, w.dnr.session);
    assert(!w.dnr.dynamic.some((r) => r.priority === 10000 && F.isStreamHost(r.condition.initiatorDomains[0])), "allow-page rule for a stream host");
    for (const h of STREAM) for (const [name, frames] of Object.entries(pages)) for (const type of ["script", "xmlhttprequest", "media", "sub_frame", "image", "websocket"]) {
      const v = evaluate(rules, { url: "https://" + h + "/x", type, frames });
      assert(v.action !== "block", `${JSON.stringify(st)}: ${h} ${type} on ${name} blocked by ${v.rule && v.rule.id}`);
    }
  }
});

// Security review M-1: flags travel over a private MessagePort that flags.js
// hands each page-world script at document_start (synchronous events), never
// over window.postMessage. Real EventTarget / MessageChannel / MessageEvent.
Deno.test({
  name: "flag port: flags.js hands each page-world script its own private port; no window channel, no late probe",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = read("settings/flags.js");
    const listeners = {};
    const store = { settings: { v: 1, enabled: true, features: { youtubeWatchdog: false } }, siteOverrides: { "www.youtube.com": { enabled: false } } };
    const changed = [];
    const chrome = {
      runtime: { lastError: undefined, onMessage: { addListener(f) { listeners.msg = f; } } },
      storage: { local: { get(_k, cb) { cb(structuredClone(store)); } }, onChanged: { addListener(f) { changed.push(f); } } },
    };
    const win = new EventTarget();
    win.top = win;
    const posted = [];
    win.postMessage = (...a) => posted.push(a);
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const open = [];
    const watch = (port, into) => { open.push(port); port.onmessage = (m) => into.push(m.data); };

    // A page-world script injected BEFORE flags.js (youtube.js / kick.js come
    // first in the manifest): it listens, flags.js hands it a port at once.
    let earlyPort = null;
    win.addEventListener("gk-p1", (e) => { if (!earlyPort) earlyPort = e.ports[0]; }, true);
    new Function("chrome", "window", "location", "globalThis", src)(chrome, win, { hostname: "www.youtube.com", origin: "https://www.youtube.com" }, globalThis);
    assert(earlyPort instanceof MessagePort, "early script got a port synchronously");
    // A page-world script injected AFTER flags.js (the guards) asks synchronously.
    let latePort = null;
    win.addEventListener("gk-p1", (e) => { if (!latePort) latePort = e.ports[0]; }, true);
    win.dispatchEvent(new Event("gk-r1"));
    assert(latePort instanceof MessagePort && latePort !== earlyPort, "late script got its own port synchronously");
    const early = [], late = [];
    watch(earlyPort, early);
    watch(latePort, late);
    await tick();
    // Site switch for www.youtube.com is off: every per-site helper is off there.
    const off = { f: { youtubeWatchdog: false, youtubeCosmetic: false, kick: false, guardClipboard: false, guardPopups: false } };
    assert(eq(early[0], off) && eq(late[0], off), JSON.stringify([early, late]));

    // After document_start (first task) a page script asking gets no port.
    let pagePort = null;
    win.addEventListener("gk-p1", (e) => { pagePort = e.ports[0]; });
    win.dispatchEvent(new Event("gk-r1"));
    assert(pagePort === null, "late request answered: the page could read the settings");
    // The old window channel is gone: a "?" probe or forged flags do nothing.
    win.dispatchEvent(new MessageEvent("message", { data: { "gk-f1": "?" }, source: win }));
    win.dispatchEvent(new MessageEvent("message", { data: { "gk-f1": { guardClipboard: false } }, source: win }));
    assert(posted.length === 0, "flags.js never uses window.postMessage");

    // Live update over the same ports.
    store.siteOverrides = {};
    changed[0]({ siteOverrides: { newValue: {} } }, "local");
    await tick();
    const on = { f: { youtubeWatchdog: false, youtubeCosmetic: true, kick: true, guardClipboard: true, guardPopups: false } };
    assert(eq(early.at(-1), on) && eq(late.at(-1), on), JSON.stringify([early, late]));

    let origin = null;
    listeners.msg({ type: "pageOrigin" }, {}, (r) => { origin = r.origin; });
    assert(origin === "https://www.youtube.com", "answers the popup on stream sites");
    for (const p of open) p.close();

    // Every page-world consumer takes the port and never listens to window
    // messages or posts the old probe.
    for (const f of ["youtube.js", "kick.js", "guards/clipboard.js", "guards/popups.js"]) {
      const s = read(f);
      assert(s.includes('const PORT_EVENT = "gk-p1"') && s.includes('new Event("gk-r1")'), f + " takes the flag port");
      assert(/window\.removeEventListener\(PORT_EVENT, take, true\)/.test(s), f + " stops listening after the first port");
      assert(!s.includes("gk-f1") && !/window\.postMessage\(/.test(s), f + " still uses the window channel");
    }
    assert(!/window\.postMessage\(|addEventListener\("message"/.test(src), "flags.js window channel");
    const yt = read("youtube.js");
    assert(/FLAGS\[id\] !== false/.test(yt), "youtube.js fails open");
    for (const v of ["src/vendor/video-swap-new.user.js", "src/vendor/ubo-youtube.js", "src/vendor/ubo-youtube-isolated.js"]) {
      const t = Deno.readTextFileSync(new URL("../" + v, import.meta.url));
      assert(!t.includes("gk-p1") && !t.includes("gk-f1"), "no flag checks in vendored " + v);
    }
    // Every frame a page-world consumer runs in also gets flags.js.
    const flagFrames = manifest.content_scripts.filter((c) => c.js.includes("src/settings/flags.js"));
    for (const cs of manifest.content_scripts.filter((c) => c.world === "MAIN" && c.js.some((j) => !j.startsWith("src/vendor/")))) {
      const covering = flagFrames.filter((fl) => cs.matches.every((m) => fl.matches.includes(m)));
      assert(covering.length && covering.every((fl) => (!cs.all_frames || fl.all_frames) && (!cs.match_about_blank || fl.match_about_blank) && (!cs.match_origin_as_fallback || fl.match_origin_as_fallback)) &&
        covering.every((fl) => JSON.stringify((fl.exclude_matches || []).slice().sort()) === JSON.stringify((cs.exclude_matches || []).slice().sort())),
        "flags.js does not run in every frame of " + cs.js.join());
    }
  },
});
