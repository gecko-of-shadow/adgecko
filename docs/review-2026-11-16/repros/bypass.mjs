import { CP } from "./load.mjs";
import "src/settings/features.js";
const sels = ["&:has(.adsbygoogle)", "*|html:has(.adsbygoogle)", "|html:has(.adsbygoogle)", "*|body:has(.adsbygoogle)", "html:has(.adsbygoogle) > *", ":root:has(.adsbygoogle) > *", "html:has(.adsbygoogle)", "body:has(.adsbygoogle)"];
const r = CP.parseCosmetic(sels.map(s => "##" + s).join("\n"));
const kept = sels.filter(s => r.generic.includes(s));
console.log("kept generic:", kept);
Deno.writeTextFileSync("docs/review-2026-11-16/repros/bypass.json", JSON.stringify(kept));
