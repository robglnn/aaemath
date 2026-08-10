// Scratch: A/B the frame cost and draw budget of P13 against the same frame without it.
import { openGame } from "../tools/lib/session.mjs";

async function run(label, query) {
  return openGame({ width: 1280, height: 720, tier: "medium", query }, async (d) => {
    await d.play(2.5);
    const samples = await d.run(() => {
      const out = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        window.__vs.advance(1 / 30);
        out.push(performance.now() - t0);
      }
      return out;
    });
    samples.sort((a, b) => a - b);
    const r = await d.report();
    return {
      label,
      medianMs: Number(samples[6].toFixed(1)),
      worstMs: Number(samples.at(-1).toFixed(1)),
      drawCalls: r.stats.drawCalls,
      triangles: r.stats.triangles,
      programs: r.stats.programs,
      scatter: r.probes.scatter && {
        instances: r.probes.scatter.instances,
        triangles: r.probes.scatter.triangles,
        meshes: r.probes.scatter.meshes,
        solids: r.probes.scatter.solids,
      },
      errors: r.errors.slice(0, 2),
    };
  });
}

console.log(JSON.stringify(await run("with scatter", {}), null, 1));
console.log(JSON.stringify(await run("without scatter", { scatter: "0" }), null, 1));
