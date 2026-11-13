// A manual "Update lists" click while the gecko-refresh alarm tick is still
// in flight must still fetch the lists (manual run), not return the alarm's
// throttled no-op result as success.
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const HOUR = 3600 * 1000;
const listBody = (tag) => "! Expires: 4 days\n" + Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
function countingFetch(counter) {
  return async (url) => {
    if (url.startsWith("chrome-extension://") && url.endsWith("/src/rules/threat-network.json")) {
      return new Response(Deno.readTextFileSync(new URL("../src/rules/threat-network.json", import.meta.url)));
    }
    counter.n++;
    return new Response(listBody(new URL(url).pathname.replace(/[^a-z0-9]/gi, "").slice(-12)), { headers: { ETag: '"e"' } });
  };
}

Deno.test("manual Update lists during an in-flight throttled alarm tick still fetches the lists", async () => {
  const counter = { n: 0 };
  // Lists refreshed 1 h ago: the alarm tick is throttled by the 12 h floor.
  const recent = { schema: 2, lastRunAt: Date.now() - 1 * HOUR, lists: {} };
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: recent }, listFetch: countingFetch(counter) });
  await settle(50);
  // Alarm tick starts refreshLists(false); the user clicks Update lists right after.
  w.fireAlarm("gecko-refresh");
  const res = await w.send({ source: "adgecko-general", type: "updateLists" });
  assert(!(res && res.result && res.result.ran === false),
    "manual click got the alarm's no-op result: " + JSON.stringify(res));
  assert(counter.n >= U.SOURCES.length, "manual Update lists fetched nothing: " + counter.n + " fetches, response " + JSON.stringify(res));
});
