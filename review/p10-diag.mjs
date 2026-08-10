// P10 scratch: find out what is actually happening at boot, with no screenshot in the way.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 480, height: 270, tier: "low" }, async (d) => {
  const t0 = Date.now();
  const state = await d.page.evaluate(() => ({
    ready: window.__vs?.ready,
    fatal: window.__vs?.fatal,
    errors: (window.__vs?.errors ?? []).slice(0, 6),
    warnings: (window.__vs?.warnings ?? []).slice(0, 10),
    bootOrder: window.__vs?.bootOrder,
    probes: window.__vs?.probeNames?.(),
  }));
  console.log("state after load (ms)", Date.now() - t0, JSON.stringify(state, null, 1));

  console.log("console errors:", d.consoleErrors.slice(0, 6));
  console.log("console warnings:", d.consoleWarnings.slice(0, 8));

  const t1 = Date.now();
  const one = await d.page.evaluate(() => {
    const a = performance.now();
    window.__vs.advance(1 / 60);
    return performance.now() - a;
  });
  console.log("one advance() ms:", one.toFixed(1), "wall", Date.now() - t1);

  const t2 = Date.now();
  const two = await d.page.evaluate(() => {
    const a = performance.now();
    window.__vs.advance(1 / 60);
    return performance.now() - a;
  });
  console.log("second advance() ms:", two.toFixed(1), "wall", Date.now() - t2);

  console.log("stats:", JSON.stringify(await d.page.evaluate(() => window.__vs.stats())));
  console.log("sky probe:", JSON.stringify(await d.probe("sky")).slice(0, 400));
  console.log("atmo probe:", JSON.stringify(await d.probe("atmosphere")).slice(0, 500));
});
