import { U, FO } from "./load.mjs";
const cases = [
 "||a.com^$~document", "||a.com^$~doc,third-party", "||a.com^$document,~third-party", "||a.com^$all,~document",
 "||a.com^$popup,script", "||a.com^$important,badfilter", "||a.com^$all,badfilter", "||a.com^$~script,~image",
 "||a.com^$domain=b.com|~c.b.com", "||a.com^$domain=b.com,document", "||a.com^$domain=b.com,~script",
 "||a.com^$denyallow=x.a.com", "||a.com^$method=POST", "||a.com^$~third-party,~first-party",
 "||a.com^$csp=script-src 'none'", "||a.com^$redirect=noopjs", "||a.com^$empty", "||a.com^$mp4",
 "||a.com^$xhr,~xhr", "||a.com^$script,~third-party,~first-party", "||a.com^$domain=b.com|~b.com",
 "||a.com^$from=b.com", "||a.com^$to=b.com", "||a.com^$strict3p", "||a.com^$popunder", "||a.com^$elemhide",
 "||a.com^$document,popup", "||a.com^$all,domain=b.com", "||a.com^$all,3p", "||a.com^$important,document",
 "||a.com^$domain=b.com|", "||a.com^$domain=", "||a.com^$domain=~b.com|c.com", "||a.com^$,", "||a.com^$match-case,script",
 "||a.com^$inline-script", "||a.com^$webrtc", "||a.com^$other", "||a.com^$~other", "||a.com^$object-subrequest",
 "||a.com^$genericblock", "||a.com^$1p,~doc", "||a.com^$domain=B.COM.", "||a.com^$domain=b.com|c.com,badfilter",
];
for (const c of cases) {
  const conv = FO.convertLine(c);
  const full = U.parseEntriesFull(c);
  console.log(c.padEnd(48), JSON.stringify(conv), conv && conv[1] ? JSON.stringify(FO.keyToCondition(conv[1])) : "", JSON.stringify(full));
}
