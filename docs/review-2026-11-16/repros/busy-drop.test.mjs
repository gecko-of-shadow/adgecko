import { openPopup, settle } from "./popup-harness.mjs";
Deno.test("No clicked while Fix still waits for applyGeneralState is silently dropped", async () => {
  const storage = { popupWelcomed: true, settings: { v: 1, enabled: true, features: {} } };
  const p = await openPopup(storage, "https://news.example.com/");
  p.holdApply.on = true; // worker DNR queue busy (list swap running)
  const fixDone = p.el["fix-site"].click();
  await settle();
  console.log("after Fix: fix-ask hidden =", p.el["fix-ask"].hidden, " fix-no disabled =", p.el["fix-no"].disabled, " focus =", p.doc.activeElement && p.doc.activeElement.id);
  await p.el["fix-no"].click();
  await settle();
  console.log("after No: overrides =", JSON.stringify(storage.siteOverrides), " note =", JSON.stringify(p.el["fix-note"].textContent), " popupFix present =", !!storage.popupFix);
  // Allow / Block again also dropped
  const before = JSON.stringify(storage.siteOverrides);
  await p.el["allow-site"].click(); await settle();
  console.log("Allow clicked while busy: overrides changed =", JSON.stringify(storage.siteOverrides) !== before, " allow disabled =", p.el["allow-site"].disabled);
  p.release(); await fixDone; await settle();
});
