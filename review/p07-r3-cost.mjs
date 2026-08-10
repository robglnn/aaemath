// P07 — per-fixed-step cost of the input layer, repeated so the noise floor is visible.
// The round-2 script measures this once; a single sample on a machine that is also running
// software GL is not a number anybody should act on.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 600, query: { bindings: "default" } }, async (d) => {
  const rows = await d.page.evaluate(() => {
    const i = window.__vs.kernel.get("input");
    const H = window.__vsInput;
    const bench = (n) => {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) i.fixed(1 / 60, i.simTime + 1 / 60);
      return ((performance.now() - t0) / n) * 1000;
    };
    const out = [];
    for (let pass = 0; pass < 5; pass++) {
      H.connect({ style: "xbox" });
      H.set({ axes: { lx: 0.6, ly: -0.6, rx: 0.9 }, buttons: { RT: 0.9, A: 1 } });
      window.__vs.kernel.advance(1 / 60, { render: false });
      bench(500); // warm the JIT
      const busy = bench(4000);
      H.disconnect();
      window.__vs.kernel.advance(1 / 60, { render: false });
      bench(500);
      const idle = bench(4000);
      out.push({ pass, busyUs: +busy.toFixed(2), idleUs: +idle.toFixed(2) });
    }
    return out;
  });
  console.log(JSON.stringify(rows, null, 1));
  const busy = rows.map((r) => r.busyUs).sort((a, b) => a - b);
  const idle = rows.map((r) => r.idleUs).sort((a, b) => a - b);
  console.log("median busy µs/step:", busy[2], " median idle µs/step:", idle[2]);
  console.log("budget at 60 Hz is 16667 µs/frame");
});
