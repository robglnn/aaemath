#!/usr/bin/env node
// P04 critic, pass 5 — the corner test. What a normal 45°/90°/135° change of direction costs
// you in each speed band. This is the most common act in the game and it is where the model's
// non-monotonicity shows up.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion");
  const T = loco.tune, STEP = 1 / 60;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);
  function intent(wx, wz) {
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    const cam = K.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const y = Math.atan2(e[8], e[10]);
    const s = Math.sin(y), c = Math.cos(y);
    loco.moveX = wx * c - wz * s; loco.moveY = -wx * s - wz * c;
  }
  function reset(x, z) {
    loco.moveX = 0; loco.moveY = 0; loco.sprintHeld = false; loco.walkHeld = false;
    loco.jumpHeld = false; loco.jumpBuffer = 0;
    loco.teleport(x, STAND, z, { heading: [0, -1] });
    for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0);
    for (let i = 0; i < 3; i++) K.advance(STEP, { render: false });
  }
  const out = [];
  for (const band of ["walk", "run", "sprint"]) {
    for (const deg of [45, 90, 135]) {
      reset(0, 6);
      loco.sprintHeld = band === "sprint"; loco.walkHeld = band === "walk";
      for (let i = 0; i < 150; i++) { intent(0, -1); K.advance(STEP, { render: false }); }
      const v0 = sp();
      const a = deg * Math.PI / 180;
      // target world direction: rotate (0,-1) by `deg` to the right
      const tx = Math.sin(a), tz = -Math.cos(a);
      let n = 0, minSpeed = v0, done = null, speedAtArrive = null;
      const x0 = loco.position.x, z0 = loco.position.z;
      while (n < 300) {
        intent(tx, tz); K.advance(STEP, { render: false }); n++;
        minSpeed = Math.min(minSpeed, sp());
        const h = Math.atan2(loco.heading.x, loco.heading.y);
        const want = Math.atan2(tx, tz);
        let d = h - want; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (done === null && Math.abs(d) < 0.02) { done = n / 60; speedAtArrive = sp(); break; }
      }
      // then hold the new direction and see how long until speed is restored
      let recover = null;
      for (let i = 0; i < 300; i++) {
        intent(tx, tz); K.advance(STEP, { render: false });
        if (sp() >= v0 * 0.98) { recover = (i + 1) / 60; break; }
      }
      out.push({ band, deg, v0: R4(v0), timeToFaceNew: done && R4(done),
        speedAtArrive: R4(speedAtArrive ?? 0), minSpeed: R4(minSpeed),
        speedKeptPct: R4(100 * (speedAtArrive ?? 0) / v0),
        recoverSeconds: recover && R4(recover),
        stateAtArrive: loco.state,
        arcLength: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)) });
    }
  }
  return out;
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => ({
  errors: d.consoleErrors, rows: await d.run(fn),
}));
fs.writeFileSync("review/p04-critic-r2e.json", JSON.stringify(res, null, 2));
console.log("errors:", res.errors.length);
console.log("band   deg  v0    face(s)  speedAtArrive  kept%   min    recover(s)  state");
for (const r of res.rows) {
  console.log(
    String(r.band).padEnd(7), String(r.deg).padEnd(4), String(r.v0).padEnd(6),
    String(r.timeToFaceNew).padEnd(8), String(r.speedAtArrive).padEnd(14),
    String(r.speedKeptPct).padEnd(7), String(r.minSpeed).padEnd(7),
    String(r.recoverSeconds).padEnd(11), r.stateAtArrive
  );
}
