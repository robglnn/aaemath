#!/usr/bin/env node
// P04 round 3 — the step-up ladder. Walks every flight in the proving ground and reports how
// much of the flight was climbed, how much of that came from an accepted step-up versus from
// the free ride a rounded capsule bottom gets over an edge, and how much momentum the climb
// cost. The point is to pin the real walk-up limit, not to assert it.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const fn = async () => {
  const K = window.__vs.kernel, loco = K.get("locomotion");
  const T = loco.tune, STEP = 1 / 60;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;
  function intent(wx, wz) {
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    const c = K.camera; c.updateMatrixWorld();
    const e = c.matrixWorld.elements; const y = Math.atan2(e[8], e[10]);
    const s = Math.sin(y), co = Math.cos(y);
    loco.moveX = wx * co - wz * s; loco.moveY = -wx * s - wz * co;
  }
  const zRows = [-11.5, -4.5, 4.5, 11.5];
  const banks = [
    { risers: T._pgCoarse, x: -19, dir: -1 },
    { risers: T._pgFine, x: 19, dir: 1 },
  ];
  const rows = [];
  for (const bank of banks) {
    bank.risers.forEach((riser, f) => {
      loco.moveX = 0; loco.moveY = 0; loco.sprintHeld = false; loco.walkHeld = false;
      loco.teleport(bank.x, STAND, zRows[f], { heading: [bank.dir, 0] });
      for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
      loco.velocity.set(0, 0, 0);
      const y0 = loco.position.y;
      let maxY = y0, stepRise = 0, rideRise = 0, stalled = 0, stepped = 0;
      let cruise = 0, minSpeed = Infinity, traverses = 0;
      const off = window.__sig.on("player:traverse", (p) => {
        if (p.verb === "step" && p.phase === "end") traverses++;
      });
      for (let i = 0; i < 260; i++) {
        intent(bank.dir, 0);
        const yb = loco.position.y, xb = loco.position.x;
        K.advance(STEP, { render: false });
        const dy = loco.position.y - yb;
        const sr = loco._moveOut.stepped ? loco._moveOut.stepRise : 0;
        if (loco._moveOut.stepped) stepped++;
        stepRise += sr;
        if (dy > 0.002) rideRise += Math.max(0, dy - sr);
        if (Math.abs(loco.position.x - xb) < 0.0015) stalled++;
        maxY = Math.max(maxY, loco.position.y);
        const s = Math.hypot(loco.velocity.x, loco.velocity.z);
        if (i > 20) { cruise = Math.max(cruise, s); minSpeed = Math.min(minSpeed, s); }
      }
      off();
      const expected = riser * 4;
      rows.push({
        riser, expected: R4(expected), climbed: R4(maxY - y0),
        climbedPct: R4(100 * (maxY - y0) / expected),
        byStepUp: R4(stepRise), byRide: R4(rideRise), steppedFrames: stepped,
        stalledSteps: stalled, traverseEvents: traverses,
        cruise: R4(cruise), minSpeed: R4(minSpeed === Infinity ? 0 : minSpeed),
      });
    });
  }
  return { stepHeight: T.stepHeight, rows };
};

const res = await openGame({ width: 900, height: 600 }, async (d) => {
  await d.run(async () => {
    const K = window.__vs.kernel, loco = K.get("locomotion");
    const mod = await import("/src/play/CollisionWorld.js");
    loco.tune._pgCoarse = mod.PROVING_GROUND.stairRisers;
    loco.tune._pgFine = mod.PROVING_GROUND.stairRisersFine;
    window.__sig = (await import("/src/core/Signals.js")).signals;
  });
  return { errors: d.consoleErrors, out: await d.run(fn) };
});
fs.writeFileSync("review/p04-r3-stairs.json", JSON.stringify(res, null, 2));
console.log("errors:", res.errors.length, " stepHeight:", res.out.stepHeight);
console.log("riser  climbed/expected   %      byStepUp byRide  stepped stalled traverse cruise min");
for (const r of res.out.rows) {
  console.log(
    String(r.riser).padEnd(6), `${r.climbed}/${r.expected}`.padEnd(18),
    String(r.climbedPct).padEnd(6), String(r.byStepUp).padEnd(8),
    String(r.byRide).padEnd(7), String(r.steppedFrames).padEnd(7),
    String(r.stalledSteps).padEnd(7), String(r.traverseEvents).padEnd(8),
    String(r.cruise).padEnd(6), r.minSpeed
  );
}
