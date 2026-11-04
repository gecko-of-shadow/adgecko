// Icon contract for the concept E art (docs/design/README.md): a gecko on a dark
// rounded-square tile; "working" lights the pixel "ad" at the tongue tip; "off" is grey.
import manifest from "../manifest.json" with { type: "json" };
import popupHtml from "../src/popup.html" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };
import { adRegion, maxSpread, readPng } from "./fixtures/png-reader.js";

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

const ROOT = new URL("../", import.meta.url);
const STATES = ["", "-working", "-off"];
const SIZES = [16, 48, 128];
const png = (rel) => readPng(new URL(rel, ROOT), rel);

// Brightest "light" pixel in the pixel-"ad" area: the smallest channel of the
// lightest pixel (white / pale lilac score high, saturated purple scores low).
function regionStats(img, size) {
  const r = adRegion(size);
  let sum = 0, light = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const [R, G, B, A] = img.at(x, y);
      if (A <= 200) continue;
      sum += (R + G + B) / 3;
      light = Math.max(light, Math.min(R, G, B));
    }
  }
  return { sum, light };
}

Deno.test("every icon path the extension references exists at its declared size", async () => {
  const refs = new Map();
  for (const [size, path] of Object.entries(manifest.icons)) refs.set(path, Number(size));
  for (const [size, path] of Object.entries(manifest.action.default_icon)) refs.set(path, Number(size));
  for (const m of backgroundSource.matchAll(/(\d+): "(?:\.\.\/)?(icons\/[^"]+\.png)"/g)) refs.set(m[2], Number(m[1]));
  for (const m of (popupHtml + popupSource).matchAll(/\.\.\/(icons\/icon(\d+)[^"]*\.png)/g)) refs.set(m[1], Number(m[2]));
  assert(refs.size === 9, `expected the 9 icon files to be referenced, got ${[...refs.keys()]}`);
  for (const [path, size] of refs) {
    const img = await png(path);
    assert(img.width === size && img.height === size, `${path} is ${img.width}x${img.height}, want ${size}x${size}`);
  }
});

// A relative setIcon path resolves against the worker's own folder, not the
// extension root. Bare "icons/..." pointed at src/icons/ and every call failed
// in real Chrome ("Failed to fetch"), while the fakes in the tests accepted it.
// A leading "/" works in Chrome but scripts/lib/package_files.py cannot see it.
Deno.test("the worker's setIcon paths reach icons/ from where the worker runs", async () => {
  const paths = [...backgroundSource.matchAll(/\d+: "([^"]+\.png)"/g)].map((m) => m[1]);
  assert(paths.length === 6, `expected 3 working and 3 off paths, got ${paths}`);
  for (const p of paths) {
    const { pathname } = new URL(p, `chrome-extension://id/${manifest.background.service_worker}`);
    assert(pathname.startsWith("/icons/"), `${p} resolves to ${pathname} from the worker`);
    assert(p.startsWith("../"), `${p}: use ../icons/ (the packager reads relative paths only)`);
    await Deno.stat(new URL(pathname.slice(1), ROOT));
  }
});

Deno.test("icons are 8-bit RGBA, not interlaced (the reader refuses anything else)", async () => {
  for (const size of SIZES) for (const s of STATES) await png(`icons/icon${size}${s}.png`);
});

Deno.test("icons are a rounded square: corners transparent, centre, edges and near-corner opaque", async () => {
  for (const size of SIZES) {
    for (const s of STATES) {
      const img = await png(`icons/icon${size}${s}.png`);
      const alpha = (x, y) => img.at(x, y)[3];
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
        assert(alpha(x, y) === 0, `icon${size}${s} corner ${x},${y} should be transparent`);
      }
      assert(alpha(size >> 1, size >> 1) === 255, `icon${size}${s} centre should be opaque`);
      // A circle would leave these transparent; the tile is a rounded square.
      const n = Math.round(size * 0.11), t = Math.round(size * 0.06);
      for (const [x, y] of [[n, n], [size - 1 - n, n], [n, size - 1 - n], [size - 1 - n, size - 1 - n]]) {
        assert(alpha(x, y) === 255, `icon${size}${s} near-corner ${x},${y} should be opaque (rounded square, not a circle)`);
      }
      for (const [x, y] of [[size >> 1, t], [t, size >> 1], [size >> 1, size - 1 - t], [size - 1 - t, size >> 1]]) {
        assert(alpha(x, y) === 255, `icon${size}${s} edge ${x},${y} should be opaque`);
      }
    }
  }
});

Deno.test("the tile is dark and the art is purple (normal and working)", async () => {
  for (const size of SIZES) {
    for (const s of ["", "-working"]) {
      const img = await png(`icons/icon${size}${s}.png`);
      const [r, g, b] = img.at(Math.round(size * 0.2), Math.round(size * 0.85));
      assert(Math.max(r, g, b) < 60, `icon${size}${s} tile should be near-black, got ${r},${g},${b}`);
      let purple = 0;
      for (let i = 0; i < img.px.length; i += 4) {
        const [R, G, B, A] = img.px.subarray(i, i + 4);
        if (A > 200 && B > 200 && R > 120 && R < 200 && G < 140) purple++;
      }
      assert(purple >= size * size * 0.04, `icon${size}${s} should be mostly purple line art (${purple} purple px)`);
    }
  }
});

// Spread <= 4: the grey filter makes R = G = B; 4 allows rounding at antialiased edges.
Deno.test("off icons are greyed out and their pixel 'ad' is not lit", async () => {
  for (const size of SIZES) {
    const img = await png(`icons/icon${size}-off.png`);
    const spread = maxSpread(img);
    assert(spread <= 4, `icon${size}-off has colour (max channel spread ${spread})`);
    const { light } = regionStats(img, size);
    assert(light < 150, `icon${size}-off pixel "ad" is lit (lightest ${light})`);
  }
});

// Measured on the built art (2026-11-03): normal lightest 92-110, working 187-255;
// working brighter by 110-297 (per 16x16-equivalent area). Old green gecko: delta 0.
Deno.test("working icons light the pixel 'ad' the normal icons keep unlit", async () => {
  for (const size of SIZES) {
    const normal = regionStats(await png(`icons/icon${size}.png`), size);
    const working = regionStats(await png(`icons/icon${size}-working.png`), size);
    assert(normal.light < 150, `icon${size} pixel "ad" should not be lit (lightest ${normal.light})`);
    assert(working.light >= 180, `icon${size}-working pixel "ad" not lit (lightest ${working.light})`);
    const delta = (working.sum - normal.sum) / (size * size / 256);
    assert(delta >= 60, `icon${size}-working should be clearly brighter in the "ad" area (delta ${delta.toFixed(0)})`);
  }
});

Deno.test("the icon sources are hand-written vectors with the three states", async () => {
  for (const file of ["gecko.svg", "gecko-16.svg"]) {
    const src = await Deno.readTextFile(new URL(`icons/source/${file}`, ROOT));
    assert(/<svg\b[^>]*\sdata-state="normal"/.test(src), `${file}: root needs data-state="normal"`);
    assert(!/<image\b|data:image|href="[^#"]/.test(src), `${file}: no embedded or linked pictures`);
    assert(/data-state="working"\]/.test(src) && /data-state="off"\]/.test(src), `${file}: working and off styles`);
  }
  const small = await Deno.readTextFile(new URL("icons/source/gecko-16.svg", ROOT));
  assert(/shape-rendering="crispEdges"/.test(small) && !/feGaussianBlur|stroke-width/.test(small), "gecko-16.svg: whole pixels, no blur, no strokes");
});
