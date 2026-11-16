import { openPopup, settle } from "./popup-harness.mjs";
Deno.test("filter lists switched off: status still says Protected", async () => {
  const storage = { popupWelcomed: true, generalEnabled: false, settings: { v: 1, enabled: true, features: { network: false } } };
  const p = await openPopup(storage, "https://news.example.com/");
  console.log("status =", JSON.stringify(p.el["site-status"].textContent), " icon glow =", p.el["brand-icon"].dataset.glow);
});
Deno.test("Allow on www.youtube.com says not blocking", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "www.youtube.com": { enabled: false } } };
  const p = await openPopup(storage, "https://www.youtube.com/watch?v=x");
  console.log("status =", JSON.stringify(p.el["site-status"].textContent));
});
Deno.test("settings-page Undo fix leaves the popup question", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} }, popupFix: { host: "news.example.com", at: Date.now(), prev: { cosmetic: null, guardClipboard: null, guardPopups: null } } };
  const p = await openPopup(storage, "https://news.example.com/");
  console.log("fix-ask hidden =", p.el["fix-ask"].hidden, " status =", JSON.stringify(p.el["site-status"].textContent), " fix-site hidden=", p.el["fix-site"].hidden);
});
