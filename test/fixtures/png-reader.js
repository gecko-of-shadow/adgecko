// Minimal PNG reader for the icon tests: 8-bit RGBA, non-interlaced (what
// scripts/build-icons.mjs writes). Throws on anything else.
function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

export async function readPng(url, label = String(url)) {
  const bytes = await Deno.readFile(url);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0) === 0x89504e47, `${label} is not a PNG`);
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
  assert(depth === 8 && color === 6 && interlace === 0, `${label} must be 8-bit RGBA, not interlaced`);
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
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  return { width, height, px, at };
}

// The lit pixel "ad": very light lilac / white, only drawn in the working state.
export const isLit = ([r, g, b, a]) => a > 200 && r >= 200 && g >= 170 && b >= 225;

// The pixel "ad" sits right of the crest, at the tongue's tip.
export function adRegion(size) {
  return { x0: Math.floor(size * 0.72), x1: size, y0: Math.floor(size * 0.4), y1: Math.ceil(size * 0.72) };
}

export function countIn(img, region, pred) {
  let n = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) if (pred(img.at(x, y))) n++;
  }
  return n;
}

export function maxSpread(img) {
  let worst = 0;
  for (let i = 0; i < img.px.length; i += 4) {
    if (img.px[i + 3] <= 200) continue;
    const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
    worst = Math.max(worst, Math.max(r, g, b) - Math.min(r, g, b));
  }
  return worst;
}
