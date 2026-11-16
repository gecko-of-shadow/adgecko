import "src/general/filter-options.js";
import "src/general/never-block-captcha.js";
import "src/general/update.js";
const U = globalThis.GeneralAdblockUpdate;
const H = 3600e3, M = 60e3;
Deno.test("offline install: first alarm (5-30 min) is throttled, next try 3 h later", () => {
  const T0 = 1e12; // install-time manual refresh failed offline
  const st = { lastAttemptAt: T0 };
  for (const d of [5, 15, 29]) console.log("alarm at +" + d + " min ->", U.shouldRun(st, T0 + d * M, false));
  console.log("ALARM_PERIOD_MINUTES", U.ALARM_PERIOD_MINUTES, "-> next alarm +" + (29 + U.ALARM_PERIOD_MINUTES) + " min:", U.shouldRun(st, T0 + (29 + U.ALARM_PERIOD_MINUTES) * M, false));
});
Deno.test("clock once ahead: automatic refresh frozen until the clock passes it", () => {
  const now = Date.UTC(2026, 10, 16);
  const st = { lastRunAt: Date.UTC(2027, 10, 16), lastAttemptAt: Date.UTC(2027, 10, 16) };
  console.log("now-lastRunAt days", (now - st.lastRunAt) / 86400e3, "shouldRun:", U.shouldRun(st, now, false));
  console.log("listDue for fetchedAt in the future:", U.listDue({ fetchedAt: st.lastRunAt, expiresMs: 86400e3 }, now, false, true));
});
