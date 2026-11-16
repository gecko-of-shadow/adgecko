import { unwrapMain } from "test/fixtures/main-source.mjs";
const src = await Deno.readTextFile("src/youtube.js");
const install = new Function(unwrapMain(src) + "\nreturn installYoutubeAdblock;")();
const api = {}; install(api);
const serverNow = Date.UTC(2026, 10, 16, 12) / 1000;
const real = "https://rr2---sn-abc.googlevideo.com/videoplayback?expire=" + (serverNow + 6 * 3600) + "&ei=x&sabr=1";
for (const skewH of [0, 20, 31, -24 * 7]) {
  console.log("local clock " + (skewH >= 0 ? "+" : "") + skewH + "h:", "isDecoyStreamUrl(real url) =", api.isDecoyStreamUrl(real, (serverNow + skewH * 3600) * 1000));
}
