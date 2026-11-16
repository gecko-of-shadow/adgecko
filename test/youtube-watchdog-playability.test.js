// Gentle watchdog under the uBO layer: a watch page that is not meant to play
// (upcoming live or premiere, sign-in, age check, unplayable, error) is not
// reloaded. The whole youtube.js runs on a virtual clock
// (fixtures/youtube-clock-run.mjs, "no-reply" scenario: the start stays at 0:00).
function assert(c, l) { if (!c) throw new Error(l); }

async function clock(playability) {
  const out = await new Deno.Command(Deno.execPath(), {
    env: { SCENARIO: "no-reply", PLAYABILITY: playability },
    args: ["run", "-A", new URL("./fixtures/youtube-clock-run.mjs", import.meta.url).href],
    stdout: "piped", stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout).trim().split("\n").pop());
}

const NOT_PLAYABLE = ["LIVE_STREAM_OFFLINE", "LOGIN_REQUIRED", "UNPLAYABLE", "ERROR", "AGE_CHECK_REQUIRED", "OFFLINE_SLATE"];
const PLAYABLE = ["", "OK", "OTHER_VIDEO:LOGIN_REQUIRED"];
const results = {};
// Two at a time: the machine is shared.
const all = [...NOT_PLAYABLE, ...PLAYABLE];
for (let i = 0; i < all.length; i += 2) {
  const pair = all.slice(i, i + 2);
  const got = await Promise.all(pair.map(clock));
  pair.forEach((p, j) => { results[p] = got[j]; });
}

for (const p of NOT_PLAYABLE) {
  Deno.test("gentle watchdog: no reload when the player response says " + p, () => {
    const r = results[p];
    assert(r.reloads.length === 0, p + ": reloads " + JSON.stringify(r.reloads) + " " + JSON.stringify(r.lines));
    assert(!r.lines.some((l) => l.includes("reloading the video")), p + ": reload line logged");
  });
}

Deno.test("gentle watchdog: a playable or unknown status keeps the one reload of a stalled start", () => {
  for (const p of PLAYABLE) {
    const r = results[p];
    assert(r.reloads.length === 1, (p || "no getPlayerResponse") + ": expected 1 reload, got " + JSON.stringify(r.reloads));
  }
});
