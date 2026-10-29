// src/youtube.js in-process on a virtual clock (fixtures/youtube-sim.mjs).
import { load } from "./fixtures/youtube-sim.mjs";
function assert(c, l) { if (!c) throw new Error(l); }

const A = "AAAAAAAAAAA";
const B = "BBBBBBBBBBB";
const C = "CCCCCCCCCCC";

// Default config (uBO layer present). Video A plays, the user moves on (to B, or to
// the home page), then comes back to `backTo` and that start sticks at 0:00.
async function stuckReturn(backTo, { via = B } = {}) {
  const h = load({ ubo: true });
  try {
    const { fire, video, state, advanceTo } = h;
    const play = () => { video.currentTime = 0.5; video.readyState = 4; video.paused = false; fire("playing", {}, video); };
    const stop = () => { video.currentTime = 0; video.readyState = 1; video.paused = true; };
    state.videoId = A;
    fire("yt-navigate-start", { url: "/watch?v=" + A });
    fire("yt-navigate-finish", {});
    await advanceTo(1000);
    play();
    await advanceTo(4000);
    stop();
    if (via) {
      state.videoId = via;
      fire("yt-navigate-start", { url: "/watch?v=" + via });
      fire("yt-navigate-finish", {});
      await advanceTo(6000);
      play();
    } else {
      fire("yt-navigate-start", { url: "/" });
      fire("yt-navigate-finish", {});
    }
    await advanceTo(9000);
    stop();
    state.videoId = backTo;
    await advanceTo(10000);
    fire("yt-navigate-start", { url: "/watch?v=" + backTo });
    fire("yt-navigate-finish", {});
    await advanceTo(45000);
    return h.reloads.map((r) => r.id);
  } finally {
    h.restore();
  }
}

Deno.test("a stuck start of a never-played video gets the gentle reload (control)", async () => {
  const ids = await stuckReturn(C);
  assert(ids.includes(C), "no reload for C: " + ids);
});

Deno.test("Back to a video that played earlier: its stuck start is still reloaded", async () => {
  const ids = await stuckReturn(A);
  assert(ids.includes(A), "no reload for A after A -> B -> A: " + ids);
});

Deno.test("Home and back to a video that played earlier: its stuck start is still reloaded", async () => {
  const ids = await stuckReturn(A, { via: null });
  assert(ids.includes(A), "no reload for A after A -> home -> A: " + ids);
});

// Hooks on (no uBO layer): the fetch hook itself.
const PLAYER = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const adBody = () => JSON.stringify({
  videoDetails: { videoId: "abcdefghijk" }, streamingData: { formats: [] }, playabilityStatus: { status: "OK" },
  adPlacements: [{ adPlacementRenderer: { kind: "START" } }],
});
const json = (body) => () => Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));

Deno.test("fetch hook strips ads whether the url is a string or a URL object", async () => {
  for (const input of [PLAYER, new URL(PLAYER)]) {
    const h = load({ fetchImpl: json(adBody()) });
    try {
      const text = await (await h.window.fetch(input, { method: "POST", body: "{}" })).text();
      assert(!text.includes("adPlacementRenderer"), `ads kept for ${typeof input === "string" ? "string" : "URL"} input`);
      assert(text.includes("streamingData"), "playback kept");
    } finally {
      h.restore();
    }
  }
});

Deno.test("a failed youtubei request is sent once, and the page sees the failure", async () => {
  let calls = 0;
  const h = load({ fetchImpl: () => { calls++; return Promise.reject(new TypeError("Failed to fetch")); } });
  try {
    let error = null;
    await h.window.fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", { method: "POST", body: "{}" })
      .catch((e) => { error = e; });
    assert(error instanceof TypeError, "rejection reaches the page");
    assert(calls === 1, "native fetch called " + calls + " times for one page fetch");
  } finally {
    h.restore();
  }
});
