// The extension's own MAIN-world files (src/youtube.js, src/kick.js,
// src/guards/*.js) are wrapped in one `(() => { ... })();` so they add no
// globals to the page (security review L-18). Tests that reach the inner
// functions (`new Function(src + "return installX;")`) remove that wrapper
// first: the line `(() => {` and the last line `})();`. The body is not
// re-indented, so slices by marker text keep working.
export function unwrapMain(src) {
  const lines = String(src).split(/\r?\n/);
  const open = lines.indexOf("(() => {");
  let close = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === "})();") {
      close = i;
      break;
    }
  }
  if (open < 0 || close <= open) throw new Error("MAIN-world IIFE wrapper not found");
  return [...lines.slice(0, open), ...lines.slice(open + 1, close), ...lines.slice(close + 1)].join("\n");
}
