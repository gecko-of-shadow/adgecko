import manifest from "../manifest.json" with { type: "json" };
import popupHtml from "../src/popup.html" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

const ROOT = new URL("../", import.meta.url);
const STATES = ["", "-working", "-off"];
const SIZES = [16, 48, 128];

// Minimal PNG reader: 8-bit RGBA, non-interlaced (what scripts/build-icons.mjs writes).
async function readPng(rel) {
  const bytes = await Deno.readFile(new URL(rel, ROOT));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0) === 0x89504e47, `${rel} is not a PNG`);
  let off = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (off < bytes.length) {
    const len = view.getUint32(off);
    const type = new TextDecoder().decode(bytes.subarray(off + 4, off + 8));
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = d.getUint32(0);
      height = d.getUint32(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  assert(depth === 8 && color === 6 && interlace === 0, `${rel} must be 8-bit RGBA, not interlaced`);
  const raw = new Uint8Array(await new Response(
    new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate")),
  ).arrayBuffer());
  const stride = width * 4;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { width, height, px };
}

function* opaque({ px }) {
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) yield [px[i], px[i + 1], px[i + 2]];
}

// Bright amber: the glowing-eye colour.
function amberCount(img) {
  let n = 0;
  for (const [r, g, b] of opaque(img)) if (r > 220 && g > 150 && g < 225 && b < 110) n++;
  return n;
}

Deno.test("every icon path the extension references exists at its declared size", async () => {
  const refs = new Map();
  for (const [size, path] of Object.entries(manifest.icons)) refs.set(path, Number(size));
  for (const [size, path] of Object.entries(manifest.action.default_icon)) refs.set(path, Number(size));
  for (const m of backgroundSource.matchAll(/(\d+): "(icons\/[^"]+\.png)"/g)) refs.set(m[2], Number(m[1]));
  for (const m of (popupHtml + popupSource).matchAll(/\.\.\/(icons\/icon(\d+)[^"]*\.png)/g)) refs.set(m[1], Number(m[2]));
  assert(refs.size === 9, `expected the 9 icon files to be referenced, got ${[...refs.keys()]}`);
  for (const [path, size] of refs) {
    const img = await readPng(path);
    assert(img.width === size && img.height === size, `${path} is ${img.width}x${img.height}, want ${size}x${size}`);
  }
});

Deno.test("icons are round: corners are transparent and the centre is opaque", async () => {
  for (const size of SIZES) {
    for (const s of STATES) {
      const img = await readPng(`icons/icon${size}${s}.png`);
      const alpha = (x, y) => img.px[(y * size + x) * 4 + 3];
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
        assert(alpha(x, y) === 0, `icon${size}${s} corner ${x},${y} should be transparent`);
      }
      assert(alpha(size >> 1, size >> 1) === 255, `icon${size}${s} centre should be opaque`);
    }
  }
});

Deno.test("off icons are greyed out at every size", async () => {
  for (const size of SIZES) {
    const img = await readPng(`icons/icon${size}-off.png`);
    let worst = 0;
    for (const [r, g, b] of opaque(img)) worst = Math.max(worst, Math.max(r, g, b) - Math.min(r, g, b));
    assert(worst <= 6, `icon${size}-off has colour (max channel spread ${worst})`);
  }
});

Deno.test("working icons have glowing eyes the normal icons lack", async () => {
  for (const size of SIZES) {
    const normal = amberCount(await readPng(`icons/icon${size}.png`));
    const working = amberCount(await readPng(`icons/icon${size}-working.png`));
    assert(normal === 0, `icon${size} should not glow (amber px ${normal})`);
    assert(working >= 6, `icon${size}-working eye glow too small (amber px ${working})`);
  }
});
