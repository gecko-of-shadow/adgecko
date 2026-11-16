const R="";
await import(R+"src/threat/psl.js");await import(R+"src/general/never-block-captcha.js");await import(R+"src/threat/protected-hosts.js");await import(R+"src/threat/compile.js");
const PH=globalThis.GeckoProtectedHosts,TC=globalThis.GeckoThreatCompile,PS=globalThis.GeckoPublicSuffix;
for (const h of ["www.facebook.com","cdn.jsdelivr.net","raw.githubusercontent.com","login.live.com","www.amazon.com","facebook.com","xn--55qx5d.cn","xn--mxtq1m.hk","us-west-1.compute.amazonaws.com","compute.amazonaws.com","attach.mail.daum.net"]) console.log(h.padEnd(36), PH.protectedReason(h), "| allow:", TC.userDomainReason(h).reason, "| icann:", PS.isIcannSuffix(h));
console.log(TC.userDomainReason("公司.cn"));
const c=TC.compileThreatRules(["www.facebook.com","cdn.jsdelivr.net","xn--55qx5d.cn","us-west-1.compute.amazonaws.com"]);console.log(c.accepted,c.rejected);
