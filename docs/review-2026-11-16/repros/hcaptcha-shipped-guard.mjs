// Repro: the two filter checks in test/hcaptcha-never-block.test.js:241-243
// ("shipped block rules name no hCaptcha host") copied verbatim. They are
// the last guard on the SHIPPED rulesets, but they miss real hCaptcha rules.
const ufCheck = (uf) => !/(^|\|\|)(\*\.)?hcaptcha\.com([\/^:*?]|$)/i.test(uf); // true = "passes"
const rfCheck = (rf) => !/(?<![a-z0-9])hcaptcha\\.com(?![a-z0-9.-])/i.test(rf.replace(/\\\./g, "."));

const regexCases = [
  String.raw`^https?://([a-z]+\.)?hcaptcha\.com/`, // same as merge test rule 5
  String.raw`hcaptcha\.com/1/api\.js`,
  String.raw`imgs\.hcaptcha\.com/captcha`,
  "hcaptcha.com",
];
for (const rf of regexCases) console.log("regexFilter", JSON.stringify(rf), "-> test passes (not caught):", rfCheck(rf));
const urlCases = ["||sentry.hcaptcha.com/1/api.js", "||stats.hcaptcha.com", "|https://hcaptcha.com/1/api.js", "||hcaptcha.com^"];
for (const uf of urlCases) console.log("urlFilter", JSON.stringify(uf), "-> test passes (not caught):", ufCheck(uf));
