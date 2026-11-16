const R="";
await import(R+"src/threat/psl.js");await import(R+"src/general/never-block-captcha.js");await import(R+"src/threat/protected-hosts.js");await import(R+"src/threat/compile.js");
const PH=globalThis.GeckoProtectedHosts,TC=globalThis.GeckoThreatCompile;
for (const h of Deno.args) console.log(h.padEnd(45), PH.protectedReason(h), "| allow-box:", TC.userDomainReason(h).reason);
