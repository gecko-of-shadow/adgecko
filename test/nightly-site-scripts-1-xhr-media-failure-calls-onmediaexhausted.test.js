// A failed SABR XHR with a fallback host must not take the "all media hosts
// failed" path (onMediaExhausted); only a failure with no next host may.
import source from "../src/youtube.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

const start = source.indexOf("  function watchXhrFailure(xhr) {");
const end = source.indexOf("  if (HOOKS) XMLHttpRequest.prototype.open", start);
assert(start > 0 && end > start, "watchXhrFailure found in youtube.js");
const block = source.slice(start, end);

function run({ diagOn, fallbacks, status }) {
  const calls = { exhausted: 0, remembered: [] };
  const api = {
    isRetryableStatus: (s) => s >= 500,
    isDecoyStreamUrl: () => false,
    STEALTH: { failoverOn403: true },
    googlevideoFallbacks: () => fallbacks,
    rememberBadHost: (u, n) => calls.remembered.push([u, n]),
  };
  const f = new Function("env", `
    const api = env.api, OPTS = { diag: env.diagOn };
    const xs = new WeakMap(); const X = (o) => { if (!xs.has(o)) xs.set(o, {}); return xs.get(o); };
    const onDecoyUrl = () => {}, logFallback = () => {};
    const onMediaExhausted = () => { env.calls.exhausted++; };
    const console = { log() {} };
    ${block}
    return { watchXhrFailure, X };`);
  const mod = f({ api, diagOn, calls });
  const listeners = {};
  const xhr = { status, addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } };
  mod.X(xhr).url = "https://rr3---sn-abc.googlevideo.com/videoplayback?sabr=1";
  mod.watchXhrFailure(xhr);
  for (const t of ["loadstart", "loadend"]) for (const fn of listeners[t] || []) fn();
  return calls;
}

Deno.test("xhr failure with a fallback host does not report all hosts failed (diag off, default)", () => {
  for (const status of [0, 503]) {
    const c = run({ diagOn: false, fallbacks: ["https://rr3---sn-def.googlevideo.com/videoplayback?sabr=1"], status });
    assert(c.remembered.length === 1 && c.remembered[0][1], "bad host mapped to fallback");
    assert(c.exhausted === 0, "status " + status + ": onMediaExhausted called " + c.exhausted + "x although a fallback host exists");
  }
});
Deno.test("xhr failure with a fallback host, diag on: no exhausted", () => {
  const c = run({ diagOn: true, fallbacks: ["https://rr3---sn-def.googlevideo.com/videoplayback?sabr=1"], status: 0 });
  assert(c.exhausted === 0, "exhausted " + c.exhausted);
});
Deno.test("xhr failure with no fallback host reports all hosts failed", () => {
  const c = run({ diagOn: false, fallbacks: [], status: 0 });
  assert(c.exhausted === 1, "exhausted " + c.exhausted);
});
