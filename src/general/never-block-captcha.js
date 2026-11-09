// GENERATED from src/rules/never-block-captcha.json by scripts/pack-filter-lists.py.
// Do not edit; change the JSON and run: python3 scripts/pack-filter-lists.py --never-block-captcha-js
// Captcha widget host suffixes no tier may block (the host and every
// subdomain; lookalikes stay blockable). Classic script: the worker loads it
// with importScripts before threat/protected-hosts.js and general/update.js,
// which throw without it; tests import it for its global.
(function (root) {
  root.GeckoNeverBlockCaptcha = Object.freeze({ SUFFIXES: Object.freeze(["hcaptcha.com"]) });
})(typeof self !== "undefined" ? self : globalThis);
