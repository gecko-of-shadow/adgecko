import { CP } from "./load.mjs";
import "src/settings/features.js";
const cases = ["html > *", "body:has(.x)", "html:has(.adsbygoogle) > *", ":root:has(.x) > *", "html:has(.x) > body > *", "body > :is(.a, *)", "*:has(> .x) > *", ":is(.a, .b) ~ *",  "[class]", "html[lang]", "body[class]", "div:not(.a)", "html:not(.a) > body"];
for (const c of cases) {
  const r = CP.parseCosmetic("##" + c);
  console.log(JSON.stringify(c).padEnd(36), "unscoped:", CP.isUnscopedSelector(c), "kept generic:", r.generic.includes(c));
}
// Real list: kept generic selectors whose subject compound is unscoped
const el = Deno.readTextFileSync("docs/review-2026-11-16/repros/lists/easylist.txt") + "\n" + Deno.readTextFileSync("docs/review-2026-11-16/repros/lists/easyprivacy.txt");
const rr = CP.parseCosmetic(el);
const sus = rr.generic.filter(s => /(^|[\s>+~])(\*|html|body|:root)?:has\(/.test(s) && /[>\s~+]\s*\*?\s*$/.test(s.replace(/\)[^)]*$/, ")")));
console.log("generic :has() selectors:", rr.generic.filter(s=>s.includes(":has(")).length);
console.log(rr.generic.filter(s=>/^(\*|html|body|:root)/i.test(s)).slice(0,20));
