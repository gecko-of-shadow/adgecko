import "src/settings/features.js";
import "src/general/cosmetic-parse.js";
const b = JSON.parse(await Deno.readTextFile("src/rules/cosmetic-rules.json"));
const g = b.generic.concat(b.extras || []);
const has = g.filter(s => /:has\(/.test(s));
console.log("generic", g.length, "with :has", has.length);
console.log(has.slice(0, 15).join("\n"));
const sub = has.filter(s => /^[^.#\[]*:has\(/.test(s) || /^(div|a|li|span|section|aside|p)\s*:has|^(div|a|li|section|aside|span|p):has/.test(s));
console.log("subject is a bare type with :has:", sub.length, sub.slice(0,10));
