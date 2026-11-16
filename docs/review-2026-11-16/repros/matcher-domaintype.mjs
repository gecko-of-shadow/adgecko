// Repro: test/fixtures/dnr-matcher.js treats "site" as the last two labels, so
// two different registrable domains under a multi-label public suffix count as
// first-party. Chrome uses the registrable domain (eTLD+1) for domainType.
import { evaluate } from "test/fixtures/dnr-matcher.js";

const rule = { id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["tracker.co.uk"], domainType: "thirdParty", resourceTypes: ["script"] } };
const req = { url: "https://tracker.co.uk/t.js", type: "script", frames: ["news.co.uk"] };
const r1 = evaluate([rule], req);
console.log("third-party $third-party block, tracker.co.uk from news.co.uk ->", r1.action, "(Chrome: block)");

const fp = { id: 2, priority: 1, action: { type: "block" }, condition: { requestDomains: ["cdn.example.com"], domainType: "thirdParty", resourceTypes: ["script"] } };
const r2 = evaluate([fp], { url: "https://cdn.example.com/a.js", type: "script", frames: ["www.example.com"] });
console.log("control, cdn.example.com from www.example.com ->", r2.action, "(Chrome: none)");

// regexFilter is case-sensitive in the matcher; Chrome's default (isUrlFilterCaseSensitive false) is case-insensitive.
const rx = { id: 3, priority: 1, action: { type: "block" }, condition: { regexFilter: "^https://ads\\.example\\.com/banner", resourceTypes: ["image"] } };
const r3 = evaluate([rx], { url: "https://ads.example.com/BANNER.png", type: "image", frames: ["news.example"] });
console.log("regexFilter case, /BANNER.png ->", r3.action, "(Chrome default: block)");
