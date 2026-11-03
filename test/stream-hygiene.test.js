// Block K: Twitch directory sweep throttled and limited to directory pages
// (M-5); Kick MediaTailor listener wrapper supports removeEventListener (M-16).
import directorySource from "../src/twitch-directory-ads.js" with { type: "text" };
import kickSource from "../src/kick.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

function loadDirectory() {
  const api = {};
  new Function(`${directorySource}\nreturn installTwitchDirectoryAds;`)()(api);
  return api;
}

Deno.test("directory sweep runs only on directory/home pages", () => {
  const api = loadDirectory();
  for (const p of ["/", "/directory", "/directory/category/just-chatting", "/directory/following"]) assert(api.isDirectoryPage(p), p);
  for (const p of ["/somechannel", "/videos/123", "/somechannel/clip/x", "/directoryx", "/settings"]) assert(!api.isDirectoryPage(p), p);
});

Deno.test("directory sweep is throttled: a burst of mutations runs at most one sweep per 250 ms, none on channel pages or when off", () => {
  const api = loadDirectory();
  let now = 0;
  const timers = [];
  let sweeps = 0;
  let path = "/directory";
  let on = true;
  const root = { querySelectorAll: () => { sweeps++; return []; } };
  const schedule = api.makeScheduler({
    on: () => on, pathname: () => path, now: () => now,
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; },
    root: () => root,
  });
  const run = (until) => {
    while (now < until) {
      now += 10;
      for (const t of timers.filter((x) => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
  };
  for (let i = 0; i < 100; i++) { schedule(); run(now + 10); } // a mutation batch every 10 ms for 1 s
  run(now + 300);
  const passes = sweeps / 3; // one sweep = three querySelectorAll calls
  assert(passes >= 3 && passes <= 6, "throttled passes: " + passes);
  sweeps = 0;
  path = "/somechannel";
  for (let i = 0; i < 50; i++) { schedule(); run(now + 10); }
  run(now + 300);
  assert(sweeps === 0, "no sweep on a channel page: " + sweeps);
  path = "/directory";
  on = false;
  for (let i = 0; i < 50; i++) { schedule(); run(now + 10); }
  run(now + 300);
  assert(sweeps === 0, "no sweep when switched off");
});

Deno.test("kick MediaTailor session: listeners can be removed again, and adding the same one twice fires once", async () => {
  const api = {};
  new Function(`${kickSource}\nreturn installKickAdblock;`)()(api);
  const listeners = new Map();
  const session = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
    dispatch(type, ev) { for (const fn of listeners.get(type) || []) fn.call(session, ev); },
  };
  const media = { createSession: () => Promise.resolve(session) };
  const details = [];
  api.wrapMediaTailor(media, (d) => details.push(d));
  const s = await media.createSession({});
  let calls = 0;
  const listener = () => { calls++; };
  s.addEventListener("ad", listener);
  s.addEventListener("ad", listener);
  s.dispatch("ad", { detail: { x: 1 } });
  assert(calls === 1 && details.length === 1, "added twice fires once: " + calls);
  s.removeEventListener("ad", listener);
  s.dispatch("ad", { detail: { x: 2 } });
  assert(calls === 1 && (listeners.get("ad") || new Set()).size === 0, "removed: " + calls + " left " + (listeners.get("ad") || new Set()).size);
});
