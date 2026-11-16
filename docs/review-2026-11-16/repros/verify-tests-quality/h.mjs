const rfs=["^https?://([a-z]+\\.)?hcaptcha\\.com/","hcaptcha\\.com"];
for(const rf of rfs) console.log(rf, "caught:", /(?<![a-z0-9])hcaptcha\\.com(?![a-z0-9.-])/i.test(rf.replace(/\\\./g, ".")));
for(const uf of ["||hcaptcha.com^","||sentry.hcaptcha.com/1/api.js","|https://hcaptcha.com/"]) console.log(uf,"caught:",/(^|\|\|)(\*\.)?hcaptcha\.com([\/^:*?]|$)/i.test(uf));
