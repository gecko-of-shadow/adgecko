// Chrome refuses to load an extension when a content script or other file is
// not "UTF-8" by its own check (base::IsStringUTF8), which also rejects
// Unicode noncharacters (U+FDD0..U+FDEF, U+xFFFE/U+xFFFF) and unpaired
// surrogates. 0.3.5 candidate had a raw U+FFFF in a regex in
// src/general/cosmetic-parse.js; Chrome said "Could not load file ... It isn't
// UTF-8 encoded." Write such characters as \uXXXX escapes.
function assert(c, l) { if (!c) throw new Error(l); }
const root = new URL("../src/", import.meta.url);
function* walk(dir) {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) yield* walk(u);
    else if (/\.(js|css|html|json)$/.test(e.name)) yield u;
  }
}
Deno.test("every shipped text file passes Chrome's UTF-8 check (no noncharacters, no lone surrogates)", () => {
  const bad = [];
  const dec = new TextDecoder("utf-8", { fatal: true });
  for (const u of walk(root)) {
    let s;
    try { s = dec.decode(Deno.readFileSync(u)); } catch { bad.push(u.pathname + ": invalid UTF-8"); continue; }
    for (let i = 0; i < s.length; i++) {
      const c = s.codePointAt(i);
      if (c > 0xffff) i++;
      const nonchar = (c >= 0xfdd0 && c <= 0xfdef) || (c & 0xfffe) === 0xfffe;
      const lone = c >= 0xd800 && c <= 0xdfff;
      if (nonchar || lone) { bad.push(u.pathname + " at " + i + ": U+" + c.toString(16)); break; }
    }
  }
  assert(bad.length === 0, bad.join("\n"));
});
