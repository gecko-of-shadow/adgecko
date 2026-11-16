import { CP } from "./load.mjs";
import "src/settings/features.js";
const list = [
  "##.ad-banner",
  "@@||mail.google.com^$generichide",
  "@@||github.com^$generichide",
].join("\n");
const r = CP.parseCosmetic(list);
const stored = CP.toStorage(r, {});
for (const h of ["mail.google.com", "github.com", "example.com"]) console.log(h, JSON.stringify(CP.buildPageCss(h, stored)));
// real EasyList
const el = Deno.readTextFileSync("docs/review-2026-11-16/repros/lists/easylist.txt");
const rr = CP.parseCosmetic(el);
const st = CP.toStorage(rr, {});
for (const h of ["mail.google.com", "github.com", "docs.google.com", "claude.ai", "adsmanager.facebook.com"]) console.log(h, "rules:", CP.buildPageCss(h, st).split("\n").filter(Boolean).length);
