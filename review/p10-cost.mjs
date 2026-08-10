// P10 scratch: where is the frame time going? Software GL, so relative only.
import { openGame, arg } from "../tools/lib/session.mjs";

const W = Number(arg("width", "960"));
const H = Number(arg("height", "540"));
const tier = arg("tier", "high");

async function timeIt(label, query) {
  await openGame({ width: W, height: H, tier, query }, async (d) => {
    // Warm the pipeline: first frames compile shaders.
    await d.page.evaluate(() => {
      for (let i = 0; i < 3; i++) window.__vs.advance(1 / 60);
    });
    const ms = await d.page.evaluate(() => {
      const t = [];
      for (let i = 0; i < 6; i++) {
        const a = performance.now();
        window.__vs.advance(1 / 60);
        t.push(performance.now() - a);
      }
      t.sort((x, y) => x - y);
      return t[Math.floor(t.length / 2)];
    });
    const stats = await d.page.evaluate(() => window.__vs.stats());
    console.log(
      `${label.padEnd(28)} median ${ms.toFixed(1).padStart(7)} ms   draws ${stats.drawCalls} tris ${stats.triangles} progs ${stats.programs}`
    );
  });
}

console.log(`${W}x${H} tier=${tier}`);
await timeIt("full", {});
await timeIt("clouds off", { skyClouds: "0" });
await timeIt("haze off", { haze: "0" });
await timeIt("clouds+haze off", { skyClouds: "0", haze: "0" });
