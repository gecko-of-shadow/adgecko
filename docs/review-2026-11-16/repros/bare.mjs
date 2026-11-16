import { U, FO } from "./load.mjs";
const dir = "docs/review-2026-11-16/repros/lists/";
for (const n of ["easylist","easyprivacy","adguard_base","badware","dandelion"]) {
  const text = Deno.readTextFileSync(dir + n + ".txt");
  const BARE = /^([a-z0-9][a-z0-9.-]*[a-z0-9])$/i;
  const bare = text.split(/\r?\n/).map(s=>s.trim()).filter(l=>BARE.test(l));
  const out = U.parseEntriesFull(text);
  const whole = new Set(out.domains);
  console.log(n, "bare lines:", bare.length, "kept as whole:", bare.filter(b=>whole.has(b.toLowerCase())).slice(0,40));
}
