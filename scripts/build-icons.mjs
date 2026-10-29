#!/usr/bin/env node
// Render the gecko icon PNGs in icons/ from the SVG sources in icons/source/.
//
//   node scripts/build-icons.mjs
//
// gecko.svg draws the 48 and 128 icons, gecko-16.svg is the pixel-grid toolbar cut.
// Each SVG carries data-state="normal|working|off" on its root; this script flips it
// and writes icon{16,48,128}{,-working,-off}.png. Needs Playwright with Chromium
// (npm i -g playwright && npx playwright install chromium) for the rasterising.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.cwd(), "package.json"));
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
}

const STATES = { normal: "", working: "-working", off: "-off" };
const SIZES = [16, 48, 128];

function svgFor(size, state) {
  const file = size === 16 ? "gecko-16.svg" : "gecko.svg";
  const src = fs.readFileSync(path.join(ROOT, "icons/source", file), "utf8");
  return src
    .replace(/(<svg\b[^>]*?)\sdata-state="[^"]*"/, `$1 data-state="${state}"`)
    .replace(/(<svg\b[^>]*?)\swidth="\d+"\s+height="\d+"/, `$1 width="${size}" height="${size}"`);
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    for (const [state, suffix] of Object.entries(STATES)) {
      await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svgFor(size, state)}</body>`);
      const out = path.join(ROOT, "icons", `icon${size}${suffix}.png`);
      await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log("wrote", path.relative(ROOT, out));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
