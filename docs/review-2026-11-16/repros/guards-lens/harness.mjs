import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright-core");
const EXT = "docs/review-2026-11-16/repros/guards-lens/ext";
export async function start(pages, { settings } = {}) {
  const server = http.createServer((req, res) => {
    const p = pages[req.url.split("?")[0]] ?? null;
    if (p === null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end(p);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const ctx = await chromium.launchPersistentContext("", {
    executablePath: "/usr/bin/google-chrome", headless: true,
    args: ["--headless=new", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  await new Promise((r) => setTimeout(r, 1500));
  if (settings) await sw.evaluate(async (s) => { const cur = (await chrome.storage.local.get("settings")).settings; const n = JSON.parse(JSON.stringify(cur)); Object.assign(n.features, s); await chrome.storage.local.set({ settings: n }); }, settings);
  return { ctx, sw, port, base: `http://127.0.0.1:${port}`, close: async () => { await ctx.close(); server.close(); } };
}
