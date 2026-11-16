import { openPopup, settle } from "./popup-harness.mjs";
Deno.test("Undo fix moves focus to a disabled Fix button", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} },
    siteOverrides: { "news.example.com": { features: { cosmetic: false, guardClipboard: false, guardPopups: false } } } };
  const p = await openPopup(storage, "https://news.example.com/");
  const undo = p.el["undo-fix"];
  console.log("undo hidden =", undo.hidden, " status =", p.el["site-status"].textContent);
  undo.focus();
  await undo.click(); await settle();
  console.log("after Undo fix: activeElement =", p.doc.activeElement && p.doc.activeElement.id, " undo hidden =", undo.hidden, " fix-site disabled now =", p.el["fix-site"].disabled);
});
