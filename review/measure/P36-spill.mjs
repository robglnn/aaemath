/**
 * P36 round 2 — does the accent this seam feeds actually LAND on anything?
 *
 * `art-direction.md` §5.4 does not say an emitter carries a light; it says "the spill is the proof
 * it is a light rather than a painted decal". `world:resonance` is wired and the pool is lit
 * (`P36-resonance.mjs` proves both), so the honest next question is whether any surface is inside
 * the falloff. Asking it is the difference between "the signal arrives" and "the feature does
 * something", and this file exists so the answer is a measurement rather than an assumption.
 *
 * Two legs, both on the shipped app, neither emitting anything:
 *   1. at spawn — from every lit accent, straight down to whatever the collision world finds;
 *   2. during play — closest approach between a lit accent and the body, sampled EVERY fixed step.
 *      The first version of leg 2 sampled every 0.5 s and could have walked the body clean through
 *      a light between samples; twelve samples cannot report a closest approach.
 *
 *   node review/measure/P36-spill.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 1280, height: 720 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }

  // ---------------------------------------------------------------- leg 1: the ground below
  const spawn = await d.run(() => {
    const k = window.__vs.kernel;
    for (let i = 0; i < 60; i++) k.advance(1 / 60, { render: false });
    const col = k.get("collision");
    const rows = [];
    k.scene.traverse((o) => {
      if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "") || o.intensity <= 0) return;
      const p = new o.position.constructor();
      o.getWorldPosition(p);
      const g = col.groundAt(p.x, p.z);
      rows.push({
        name: o.name,
        intensity: +o.intensity.toFixed(4),
        falloff: o.distance,
        at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        groundY: g.hit ? +g.y.toFixed(2) : null,
      });
    });
    return rows;
  });
  console.log("=== at spawn: every lit accent, and the ground beneath it ===");
  for (const r of spawn) {
    const drop = r.groundY == null ? null : +(r.at[1] - r.groundY).toFixed(2);
    console.log(JSON.stringify({ ...r, metresAboveGround: drop, reachesGround: drop != null && drop < r.falloff }));
  }

  // ---------------------------------------------------------------- leg 2: closest approach
  await d.page.keyboard.down("KeyW");
  const run = await d.run(() => {
    const k = window.__vs.kernel;
    let best = Infinity;
    let bestName = null;
    let bestStep = null;
    let falloff = null;
    const track = [];
    for (let i = 0; i < 60 * 14; i++) {
      k.advance(1 / 60, { render: false });
      const pos = window.__vs.probe("locomotion")?.position;
      if (!pos) continue;
      const [px, py, pz] = pos;
      k.scene.traverse((o) => {
        if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "") || o.intensity <= 0) return;
        const p = new o.position.constructor();
        o.getWorldPosition(p);
        // Nearest point on the body, treated as a 1.7 m segment with its feet at `py`.
        const cy = Math.min(py + 1.7, Math.max(py, p.y));
        const dist = Math.hypot(p.x - px, p.y - cy, p.z - pz);
        if (dist < best) {
          best = dist;
          bestName = o.name;
          bestStep = k.stepCount;
          falloff = o.distance;
        }
      });
      if (i % 60 === 0) track.push({ s: Math.round(i / 60), closest: +best.toFixed(2) });
    }
    return { best: +best.toFixed(2), bestName, bestStep, falloff, track };
  });
  await d.page.keyboard.up("KeyW");

  console.log("\n=== 14 s of running forward: closest a lit accent ever came to the body ===");
  console.log(
    JSON.stringify({
      closestMetres: run.best,
      light: run.bestName,
      falloffMetres: run.falloff,
      atStep: run.bestStep,
      insideFalloff: run.best < run.falloff,
    })
  );
  console.log("per second:", JSON.stringify(run.track));

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
});
