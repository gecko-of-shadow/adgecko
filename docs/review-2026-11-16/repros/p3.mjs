const R="";
await import(R+"src/threat/psl.js");await import(R+"src/general/never-block-captcha.js");await import(R+"src/threat/protected-hosts.js");await import(R+"src/threat/compile.js");
const PH=globalThis.GeckoProtectedHosts,TC=globalThis.GeckoThreatCompile;
const hs=["facebook.com","www.facebook.com","www.instagram.com","www.reddit.com","en.wikipedia.org","www.apple.com","www.microsoft.com","login.live.com","outlook.live.com","www.office.com","www.amazon.com","web.telegram.org","api.x.com","www.dropbox.com","cdn.jsdelivr.net","cdn.discordapp.com","raw.githubusercontent.com","dl.dropboxusercontent.com","mega.nz","www.mediafire.com","download2390.mediafire.com"];
const c=TC.compileThreatRules(hs,{});
console.log("rejected:",c.rejected.map(r=>r.host+" ("+r.reason+")").join("; "));
console.log("BLOCKED at",c.rules[0].priority,":",c.rules[0].condition.requestDomains.join(" "));
