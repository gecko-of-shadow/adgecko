import { FC, world } from "./harness.mjs";
Deno.test("H: applyCached cost per worker start (no cache -> snapshot)", async () => {
  const w = world();
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) await FC.applyCached(w.deps);
  console.log("ms per applyCached", ((performance.now() - t0) / 20).toFixed(1), "session updates", w.updates);
});
