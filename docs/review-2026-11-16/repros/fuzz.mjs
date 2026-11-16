import { CP } from "./load.mjs";
const cands = [".a\\", "url(x", ".a<!--", ".a-->", ".a\\\"", ".a\\'", ".a[x=\"]", "a[x='\\']", ".a\\7B", ".a\\7d .b", "div:not(.a", ".a /x", ".a/**/", ".a\\/\\*", "a[x=\"\\\"]\"]", ".a:is(.b,.c", "!important", ".a !important", ".a;", ".a ; .b", "\\", "'", ".a'b'", "a[href=\"x\"", ".a[href", "*|*", "|a", "ns|a", ".a::before", ".a::-webkit-scrollbar", "@media", ".a:has(", ".a:nth-child(2n+1)", "::slotted(.a)", ":host(.a)", ":host", ":root .a", ".a:where()", ".a:is()", "&.a", "& .a", ".a &", ".a{", "a[x=\"{\"]", "a[x='}']", ".\\{", ".a\\\\", "a[title='x\\\\']"];
const out = [];
for (const c of cands) { const s = CP.sanitizeSelector(c); if (s) out.push(s); }
Deno.writeTextFileSync("docs/review-2026-11-16/repros/fuzz.json", JSON.stringify(out));
console.log(out);
