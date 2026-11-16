const R="";
await import(R+"src/threat/psl.js");await import(R+"src/general/never-block-captcha.js");await import(R+"src/threat/protected-hosts.js");await import(R+"src/threat/compile.js");
const PH=globalThis.GeckoProtectedHosts,TC=globalThis.GeckoThreatCompile;
for (const h of ["raw.githubusercontent.com","objects.githubusercontent.com","cdn.jsdelivr.net","cdn.discordapp.com","media.discordapp.net","firebasestorage.googleapis.com","dl.dropboxusercontent.com","lh3.googleusercontent.com","yt3.googleusercontent.com","jnn-pa.googleapis.com","www.googleapis.com","ajax.googleapis.com","challenges.cloudflare.com","www.recaptcha.net","recaptcha.net","js.stripe.com","login.microsoftonline.com","d2nvs31859zcd8.cloudfront.net","s3.amazonaws.com","github.com","api.github.com","www.dropbox.com","cdn.shopify.com","i.imgur.com","static.cloudflareinsights.com"])
  console.log(h.padEnd(34), PH.protectedReason(h), "| allow-box:", TC.userDomainReason(h).reason);
