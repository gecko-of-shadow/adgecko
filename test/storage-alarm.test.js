// Block B: list state split from list payloads, migration from the old one-key
// layout, storage write errors surfaced, and the 3 h "gecko-refresh" alarm.
import { loadWorker, refreshedState, settle } from "./fixtures/fake-chrome-worker.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import cosmeticSource from "../src/cosmetic.js" with { type: "text" };
import cosmeticParseSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import kickSource from "../src/kick.js" with { type: "text" };
import directorySource from "../src/twitch-directory-ads.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const HOUR = 3600 * 1000;
const dataKeys = (store) => Object.keys(store).filter((k) => k.startsWith("listData:"));

// ---- alarm ----

Deno.test("worker start creates the gecko-refresh alarm when missing: 3 h period, first run 5-30 min, persistAcrossSessions", async () => {
  const w = loadWorker({ store: {} });
  await settle(50);
  assert(w.alarmCreates.length === 1, "created once: " + JSON.stringify(w.alarmCreates));
  const { name, info } = w.alarmCreates[0];
  assert(name === "gecko-refresh" && info.periodInMinutes === 180, JSON.stringify(info));
  assert(info.delayInMinutes >= 5 && info.delayInMinutes <= 30, "first fire " + info.delayInMinutes);
  assert(info.persistAcrossSessions === true, "asks to persist across sessions");
  // Two top-level onAlarm listeners: "gecko-refresh" and the one-shot
  // "gecko-refresh-retry" (review 2026-11-16 WP-16). No retry alarm at start.
  assert(w.alarmListenerCount === 2, "onAlarm registered at top level: " + w.alarmListenerCount);
});

Deno.test("an existing alarm is left alone (not reset) at worker start and on install; a missing one is recreated on install", async () => {
  const existing = { name: "gecko-refresh", periodInMinutes: 180, scheduledTime: 1 };
  const w = loadWorker({ store: {}, alarms: [existing] });
  await settle(50);
  w.install();
  await settle(50);
  assert(w.alarmCreates.length === 0, "existing alarm reset: " + JSON.stringify(w.alarmCreates));
  w.alarms.delete("gecko-refresh");
  w.install();
  await settle(50);
  assert(w.alarmCreates.length === 1 && w.alarms.has("gecko-refresh"), "missing alarm recreated on install");
});

Deno.test("Chrome without persistAcrossSessions support still gets the alarm", async () => {
  const w = loadWorker({ store: {}, strictAlarms: true });
  await settle(50);
  assert(w.alarms.has("gecko-refresh"), "alarm created");
  assert(!("persistAcrossSessions" in w.alarmCreates[0].info) && w.alarmCreates[0].info.periodInMinutes === 180, JSON.stringify(w.alarmCreates));
});

Deno.test("a worker without chrome.alarms still loads", async () => {
  const w = loadWorker({ store: {}, noAlarms: true });
  await settle(20);
  assert(w.alarmCreates.length === 0, "no alarm API, no alarm");
});

const listBody = (tag) => "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
// The worker also reads its own packed threat ruleset (the threat restore
// after a restart); the fixture leaves that file to listFetch, so serve it
// here without counting it as a list download.
function countingFetch(counter, fail) {
  return async (url) => {
    if (url.startsWith("chrome-extension://") && url.endsWith("/src/rules/threat-network.json")) {
      return new Response(Deno.readTextFileSync(new URL("../src/rules/threat-network.json", import.meta.url)));
    }
    counter.n++;
    if (fail) throw new TypeError("Failed to fetch");
    return new Response(listBody(new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12)), { headers: { ETag: '"e"' } });
  };
}

Deno.test("the alarm handler respects the 12 h floor and ignores other alarms", async () => {
  const counter = { n: 0 };
  const recent = { schema: 2, lastRunAt: Date.now() - 1 * HOUR, lists: {} };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: recent }, listFetch: countingFetch(counter) });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  await settle(200);
  assert(counter.n === 0, "refetched inside the 12 h floor: " + counter.n);
  w.fireAlarm("something-else");
  await settle(100);
  assert(counter.n === 0, "other alarm ran a refresh");
});

Deno.test("the alarm handler refreshes once 12 h have passed and then records lastRunAt", async () => {
  const counter = { n: 0 };
  const old = { schema: 2, lastRunAt: Date.now() - 13 * HOUR, lists: {} };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: old }, listFetch: countingFetch(counter) });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  for (let i = 0; i < 100 && !(w.store.listState.lastRunAt > old.lastRunAt); i++) await settle(100);
  assert(counter.n >= U.SOURCES.length, "lists fetched: " + counter.n);
  const st = w.store.listState;
  assert(st.lastRunAt > old.lastRunAt && st.lastAttemptAt >= old.lastRunAt, "run recorded " + JSON.stringify({ a: st.lastRunAt, b: st.lastAttemptAt }));
  assert(dataKeys(w.store).length === U.SOURCES.length, "one payload key per list");
  assert(!st.lists.easylist.domains && st.lists.easylist.count === 30000, "state holds counts, not domains");
  assert(JSON.stringify(st).length < 20000, "state key stays small: " + JSON.stringify(st).length);
});

Deno.test("a refresh that fails everywhere sets lastAttemptAt but not lastRunAt, so the next alarm retries", async () => {
  const counter = { n: 0 };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch: countingFetch(counter, true) });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  for (let i = 0; i < 50 && !(w.store.generalListStatus || "").includes("Problem"); i++) await settle(100);
  const st = w.store.listState;
  assert(st && st.lastAttemptAt > 0 && !st.lastRunAt, "attempt only: " + JSON.stringify({ a: st && st.lastAttemptAt, r: st && st.lastRunAt }));
  assert(U.shouldRun({ lastAttemptAt: st.lastAttemptAt }, st.lastAttemptAt + 3 * HOUR, false), "next 3 h alarm retries");
  assert(!U.shouldRun({ lastAttemptAt: st.lastAttemptAt }, st.lastAttemptAt + 60 * 1000, false), "not hammered right away");
});

// Review 2026-11-16 WP-16 item 1: the first "gecko-refresh" alarm comes 5 to
// 30 min after it is created, so after a failed install-time refresh it was
// always throttled, and the real retry came about 3 h later. A failed run
// (ran:true, ok:false) now creates one one-shot "gecko-refresh-retry" alarm
// 31 min later. The retry run does not create another one (no 31-min loop
// while the network stays down); the 3 h alarm takes over after it.
Deno.test("a failed run creates one retry alarm 31 min later; the retry runs a refresh and creates no new retry", async () => {
  const counter = { n: 0 };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch: countingFetch(counter, true) });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  for (let i = 0; i < 50 && !(w.store.generalListStatus || "").includes("Problem"); i++) await settle(100);
  await settle(100);
  const retries = () => w.alarmCreates.filter((a) => a.name === "gecko-refresh-retry");
  assert(retries().length === 1, "retry alarm created once: " + JSON.stringify(w.alarmCreates));
  const info = retries()[0].info;
  assert(info.delayInMinutes === 31 && !("periodInMinutes" in info), "one-shot, 31 min: " + JSON.stringify(info));
  assert(U.shouldRun({ lastAttemptAt: w.store.listState.lastAttemptAt }, w.store.listState.lastAttemptAt + 31 * 60 * 1000, false), "the retry passes the throttle");
  // The retry alarm fires 31 min later (move the stored attempt back by 31 min).
  w.store.listState = Object.assign({}, w.store.listState, { lastAttemptAt: w.store.listState.lastAttemptAt - 31 * 60 * 1000 });
  const before = counter.n;
  w.fireAlarm("gecko-refresh-retry");
  for (let i = 0; i < 50 && counter.n === before; i++) await settle(100);
  await settle(300);
  assert(counter.n > before, "the retry alarm ran a refresh");
  assert(retries().length === 1, "the failed retry did not create another retry: " + retries().length);
});

Deno.test("a successful run and a throttled run create no retry alarm", async () => {
  const counter = { n: 0 };
  const old = { schema: 2, lastRunAt: Date.now() - 13 * HOUR, lists: {} };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: old }, listFetch: countingFetch(counter) });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  for (let i = 0; i < 100 && !(w.store.listState.lastRunAt > old.lastRunAt); i++) await settle(100);
  w.fireAlarm("gecko-refresh");
  await settle(200);
  assert(!w.alarmCreates.some((a) => a.name === "gecko-refresh-retry"), "retry after success: " + JSON.stringify(w.alarmCreates));
});

// Review 2026-11-16 WP-16 item 2: a stored time far in the future (the clock
// was once set ahead) must not stop automatic refreshes until that time.
Deno.test("stored times later than now + 5 min do not throttle (clock skew)", () => {
  const now = Date.UTC(2026, 10, 16);
  const year = 365 * 24 * HOUR;
  assert(U.shouldRun({ lastRunAt: now + year }, now, false), "lastRunAt in the future");
  assert(U.shouldRun({ lastAttemptAt: now + year }, now, false), "lastAttemptAt in the future");
  assert(U.shouldRun({ lastRunAt: now + year, lastAttemptAt: now + year }, now, false), "both in the future");
  assert(U.listDue({ fetchedAt: now + year, expiresMs: 4 * 24 * HOUR }, now, false, true), "fetchedAt in the future");
  // Small differences stay as they are (the throttle still applies).
  assert(!U.shouldRun({ lastRunAt: now + 60 * 1000 }, now, false), "lastRunAt 1 min ahead still throttles");
  assert(!U.shouldRun({ lastRunAt: now - 13 * HOUR, lastAttemptAt: now + 60 * 1000 }, now, false), "lastAttemptAt 1 min ahead still throttles");
  assert(!U.listDue({ fetchedAt: now + 60 * 1000, expiresMs: 4 * 24 * HOUR }, now, false, true), "fetchedAt 1 min ahead is not due");
  assert(!U.shouldRun({ lastRunAt: now - HOUR }, now, false) && !U.listDue({ fetchedAt: now - HOUR, expiresMs: 4 * 24 * HOUR }, now, false, true), "normal times unchanged");
});

// ---- migration ----

function seedOld() {
  return { generalEnabled: true, generalAllowedOrigins: [], generalListRefresh: refreshedState(U.SOURCES) };
}

Deno.test("migration moves each list to its own key, verifies, then removes the old key", async () => {
  const seed = seedOld();
  const w = loadWorker({ store: seed });
  for (let i = 0; i < 50 && "generalListRefresh" in w.store; i++) await settle(100);
  assert(!("generalListRefresh" in w.store), "old key removed");
  const st = w.store.listState;
  assert(st.schema === 2 && st.dynamicActive && st.lastRunAt === 1, "scalars kept " + JSON.stringify({ s: st.schema, d: st.dynamicActive }));
  for (const src of U.SOURCES) {
    const d = w.store["listData:" + src.name];
    assert(d && d.domains.length === 30000 && d.domains[0] === seed.generalListRefresh.lists[src.name].domains[0], src.name + " payload");
    assert(st.lists[src.name].count === 30000 && !st.lists[src.name].domains, src.name + " meta");
  }
});

Deno.test("migration is idempotent: a second worker start on migrated storage changes nothing", async () => {
  const w = loadWorker({ store: seedOld() });
  for (let i = 0; i < 50 && "generalListRefresh" in w.store; i++) await settle(100);
  const snapshot = JSON.stringify(w.store);
  const w2 = loadWorker({ store: JSON.parse(snapshot) });
  await settle(300);
  assert(JSON.stringify(w2.store) === snapshot, "second run changed storage");
});

Deno.test("migration resumes after a crash halfway (some lists already moved)", async () => {
  const seed = seedOld();
  const old = seed.generalListRefresh;
  const moved = U.SOURCES.slice(0, 3).map((s) => s.name);
  for (const n of moved) {
    seed["listData:" + n] = { domains: old.lists[n].domains };
    old.lists[n] = Object.assign(U.listMeta(old.lists[n]), { count: old.lists[n].domains.length });
  }
  const w = loadWorker({ store: seed });
  for (let i = 0; i < 50 && "generalListRefresh" in w.store; i++) await settle(100);
  assert(!("generalListRefresh" in w.store) && dataKeys(w.store).length === U.SOURCES.length, "finished");
  for (const n of moved) assert(w.store.listState.lists[n].count === 30000, n + " kept");
});

Deno.test("migration fits next to the old data (peak = old blob + one list) and never deletes unverified data", async () => {
  const seed = seedOld();
  const total = Object.entries(seed).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
  const oneList = Math.max(...U.SOURCES.map((s) => JSON.stringify({ domains: seed.generalListRefresh.lists[s.name].domains }).length + 40));
  const quota = total + oneList + 20000;
  const w = loadWorker({ store: seed, quotaBytes: quota });
  for (let i = 0; i < 80 && "generalListRefresh" in w.store; i++) await settle(100);
  assert(!("generalListRefresh" in w.store), "migrated under quota " + quota + ", peak " + w.peakBytes);
  assert(w.peakBytes <= quota, "peak over quota");
  // Too tight even for one list: nothing is lost and the error is recorded.
  const tight = loadWorker({ store: seedOld(), quotaBytes: total + 5000, captureWarnings: true });
  await settle(800);
  const oldBlob = tight.store.generalListRefresh;
  assert(oldBlob && U.SOURCES.every((s) => Array.isArray(oldBlob.lists[s.name].domains) && oldBlob.lists[s.name].domains.length === 30000), "old data intact");
  assert(tight.store.listState && /quota/i.test(tight.store.listState.lastError.message), "error recorded: " + JSON.stringify(tight.store.listState));
  // The production warning fires for the intentional quota failure (captured, not printed).
  assert(tight.warnings.length > 0 && tight.warnings.every((t) => /storage write failed: QUOTA_BYTES quota exceeded/.test(t)), "quota warnings: " + JSON.stringify(tight.warnings));
});

Deno.test("refresh after migration rebuilds the same rules from the per-list keys", async () => {
  const w = loadWorker({ store: seedOld() });
  await w.send({ source: "adgecko-general", type: "applyGeneralState" });
  await settle(300);
  const listRules = w.dnr.dynamic.filter((r) => r.id >= U.LIST_RULE_ID_BASE && r.id < U.KEPT_RULE_ID_BASE).length;
  assert(listRules > 0 && w.dnr.staticOn && w.dnr.errors.length === 0, "dynamic lists active: " + listRules);
});

// ---- fresh install ----

Deno.test("a fresh install fetches the lists from onInstalled without a click; an update waits for the alarm", async () => {
  const counter = { n: 0 };
  const w = loadWorker({ store: {}, listFetch: countingFetch(counter) });
  await settle(50);
  assert(counter.n === 0 && dataKeys(w.store).length === 0, "nothing fetched before install");
  w.install({ reason: "install" });
  for (let i = 0; i < 80 && !(w.store.listState && w.store.listState.lastRunAt); i++) await settle(100);
  assert(counter.n >= U.SOURCES.length, "every list fetched on install: " + counter.n);
  assert(dataKeys(w.store).length === U.SOURCES.length, "payloads stored: " + dataKeys(w.store).length);
  assert(w.store.listState && w.store.listState.dynamicActive && w.store.listState.lastRunAt, "refresh ran: " + JSON.stringify(w.store.listState && w.store.listState.lastRunAt));
  assert(w.store.generalEnabled === true, "defaults written too");
  const upd = { n: 0 };
  const w2 = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: refreshedState(U.SOURCES) }, listFetch: countingFetch(upd) });
  await settle(50);
  w2.install({ reason: "update" });
  await settle(600);
  assert(upd.n === 0, "an update does not refetch outside the alarm: " + upd.n);
});

// ---- write errors ----

Deno.test("a failed payload write is recorded in state and shown in the list status text", async () => {
  const counter = { n: 0 };
  const setError = (items) => (Object.keys(items).some((k) => k.startsWith("listData:")) ? "QUOTA_BYTES quota exceeded" : null);
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [] }, listFetch: countingFetch(counter), setError, captureWarnings: true });
  await settle(50);
  const res = await w.send({ source: "adgecko-general", type: "updateLists" });
  assert(res && res.ok === false, "refresh reports failure " + JSON.stringify(res));
  // One production warning per failed payload write, plus the refresh-problems summary; nothing else.
  const quotaWarns = w.warnings.filter((t) => /storage write failed: QUOTA_BYTES quota exceeded/.test(t));
  assert(quotaWarns.length === U.SOURCES.length, "one warning per list write: " + quotaWarns.length + " of " + U.SOURCES.length);
  assert(w.warnings.every((t) => /QUOTA_BYTES quota exceeded|list refresh problems/.test(t)), "unexpected warnings: " + JSON.stringify(w.warnings));
  const st = w.store.listState;
  assert(st.lastError && /quota/i.test(st.lastError.message), "lastError in state: " + JSON.stringify(st.lastError));
  assert(/Storage error: QUOTA_BYTES quota exceeded/.test(w.store.generalListStatus), "status: " + w.store.generalListStatus);
  assert(!st.lastRunAt, "a failed run does not count as a run");
  assert(dataKeys(w.store).length === 0, "no payload stored");
  assert(w.dnr.staticOn, "packed lists still active");
});

Deno.test("popup shows a failed settings write instead of dropping it", () => {
  assert(/saveError = err \? "Could not save\. Try again\."/.test(popupSource) && /const err = chrome\.runtime\.lastError;/.test(popupSource), "save() checks lastError");
  assert(popupSource.includes("pageStatus.textContent = saveError;"), "shown under the Allow button");
});

// ---- who reads what ----

Deno.test("content scripts and the popup never read the list state or payload keys", async () => {
  const featuresSource = await Deno.readTextFile(new URL("../src/settings/features.js", import.meta.url));
  const flagsSource = await Deno.readTextFile(new URL("../src/settings/flags.js", import.meta.url));
  const clipSource = await Deno.readTextFile(new URL("../src/guards/clipboard.js", import.meta.url));
  const popGuardSource = await Deno.readTextFile(new URL("../src/guards/popups.js", import.meta.url));
  const pageSide = { popupSource, cosmeticSource, cosmeticParseSource, youtubeSource, kickSource, directorySource, featuresSource, flagsSource, clipSource, popGuardSource };
  for (const [name, src] of Object.entries(pageSide)) {
    for (const key of ["generalListRefresh", "listData:", "listState"]) assert(!src.includes(key), name + " mentions " + key);
  }
  // Every content script file in the manifest is one of the checked ones or vendored.
  for (const cs of manifest.content_scripts) for (const f of cs.js) {
    assert(f.startsWith("src/vendor/") || ["src/cosmetic.js", "src/general/cosmetic-parse.js", "src/youtube.js", "src/kick.js", "src/twitch-directory-ads.js", "src/settings/features.js", "src/settings/flags.js", "src/guards/clipboard.js", "src/guards/popups.js"].includes(f), "unchecked content script " + f);
  }
  // The cosmetic content script reacts only to its own small keys (Block H
  // added the settings / siteOverrides switches).
  assert(/if \(!changes \|\| \(!changes\[STORAGE_KEY\] && !changes\[ALLOWED_ORIGINS_KEY\] && !changes\.cosMeta && !changes\[SETTINGS_KEY\] && !changes\[OVERRIDES_KEY\]\)\) return;/.test(cosmeticSource), "onChanged filtered by key");
});
