#!/usr/bin/env node
// Render the gecko icon PNGs in icons/ from the SVG sources in icons/source/.
//
//   node scripts/build-icons.mjs
//   $env:CHROME_PATH = 'C:\path\to\chrome.exe'; node scripts/build-icons.mjs   (PowerShell)
//
// gecko.svg draws the 48 and 128 icons, gecko-16.svg is the pixel-grid toolbar cut.
// Each SVG carries data-state="normal|working|off" on its root; this script flips it
// and writes icon{16,48,128}{,-working,-off}.png (8-bit RGBA, transparent outside the tile).
// Rasterising: with CHROME_PATH set, a local Chrome / Chrome for Testing is driven over the
// DevTools protocol (scripts/lib/chrome-shot.mjs, nothing to install). Otherwise Playwright
// with Chromium is used if it is installed (npm i playwright && npx playwright install chromium).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STATES = { normal: "", working: "-working", off: "-off" };
const SIZES = [16, 48, 128];

export function svgFor(size, state) {
  const file = size === 16 ? "gecko-16.svg" : "gecko.svg";
  const src = fs.readFileSync(path.join(ROOT, "icons/source", file), "utf8");
  return src
    .replace(/(<svg\b[^>]*?)\sdata-state="[^"]*"/, `$1 data-state="${state}"`)
    .replace(/(<svg\b[^>]*?)\swidth="\d+"\s+height="\d+"/, `$1 width="${size}" height="${size}"`);
}

const page = (size, state) =>
  `<!doctype html><body style="margin:0;background:transparent">${svgFor(size, state)}</body>`;

async function withChrome(executablePath) {
  const { openChrome } = await import("./lib/chrome-shot.mjs");
  const chrome = await openChrome(executablePath);
  try {
    for (const size of SIZES) {
      for (const [state, suffix] of Object.entries(STATES)) {
        const png = await chrome.render(page(size, state), { width: size, height: size, transparent: true });
        const out = path.join(ROOT, "icons", `icon${size}${suffix}.png`);
        fs.writeFileSync(out, png);
        console.log("wrote", path.relative(ROOT, out));
      }
    }
  } finally {
    await chrome.close();
  }
}

async function withPlaywright() {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  }
  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      for (const [state, suffix] of Object.entries(STATES)) {
        await p.setContent(page(size, state));
        const out = path.join(ROOT, "icons", `icon${size}${suffix}.png`);
        await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        console.log("wrote", path.relative(ROOT, out));
      }
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.CHROME_PATH) await withChrome(process.env.CHROME_PATH);
  else await withPlaywright();
}
