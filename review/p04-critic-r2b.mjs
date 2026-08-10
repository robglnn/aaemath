#!/usr/bin/env node
// P04 critic, pass 2 — corrected test geography.
// Clear lane on the proving ground: x = 25, z from +12 running toward -Z. Ramps live in
// x -17.8..17.8 / z 13..30, the terrace in x -20..20 / z 30..46, the 5 m block in
// x 26..36 / z 24..34, the cone at (-14,-26) r 9, the stairs at x < -22. x = 25 with z < 20
// is open deck all the way to the rim at r = 54.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const OUT = "review/p04-critic-r2b.json";

const fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion"), col = K.get("collision");
  const T = loco.tune;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STEP = 1 / 60;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;

  function basisYaw() {
    const cam = K.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    if (Math.hypot(fx, fz) < 1e-4) return loco._lastBasisYaw ?? 0;
    return Math.atan2(-fx, -fz);
  }
  function intent(wx, wz, mag = 1) {
    const l = Math.hypot(wx, wz);
    if (l < 1e-9) { loco.moveX = 0; loco.moveY = 0; return; }
    wx /= l; wz /= l;
    const y = basisYaw(), s = Math.sin(y), c = Math.cos(y);
    loco.moveX = (wx * c - wz * s) * mag;
    loco.moveY = (-wx * s - wz * c) * mag;
  }
  function step(n = 1, dir = null, mag = 1) {
    for (let i = 0; i < n; i++) {
      if (dir) intent(dir[0], dir[1], mag); else if (dir === null) { /* leave as-is */ }
      K.advance(STEP, { render: false });
    }
  }
  function zero() { loco.moveX = 0; loco.moveY = 0; }
  function reset(x, z, heading = [0, -1], y = STAND) {
    zero(); loco.sprintHeld = false; loco.walkHeld = false; loco.jumpHeld = false; loco.jumpBuffer = 0;
    loco.teleport(x, y, z, { heading });
    for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0);
    step(3);
    return loco.grounded;
  }
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);
  const out = { tests: {} };

  // ---------------------------------------------------------------- 1. stopping
  function stopTest(sprint) {
    const ok = reset(25, 12);
    loco.sprintHeld = sprint;
    step(150, [0, -1]);
    const v0 = sp(), z0 = loco.position.z, x0 = loco.position.x;
    zero();
    let n = 0; const trace = [];
    while (sp() > 0.05 && n < 240) { step(1); n++; trace.push(R4(sp())); }
    return { grounded: ok, v0: R4(v0), timeToStop: R4(n / 60),
      distance: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)),
      trace: trace.slice(0, 30) };
  }
  out.tests.stopSprint = stopTest(true);
  out.tests.stopRun = stopTest(false);

  // ---------------------------------------------------------------- 2. jumps
  function jumpTest({ sprint = false, tap = false, reverseInAir = false } = {}) {
    reset(25, 12);
    loco.sprintHeld = sprint;
    if (sprint) step(150, [0, -1]);
    const y0 = loco.position.y, x0 = loco.position.x, z0 = loco.position.z;
    const v0 = sp();
    loco._pressJump();
    let apex = y0, air = 0, rise = 0, fall = 0, released = false;
    let vyAtApexTime = 0;
    const trace = [];
    for (let i = 0; i < 240; i++) {
      if (tap && !released && loco.airtime > 0.06) { loco.jumpHeld = false; released = true; }
      step(1, reverseInAir && loco.airtime > 0.05 ? [0, 1] : (sprint ? [0, -1] : null));
      if (!loco.grounded) {
        air = loco.airtime;
        if (loco.position.y > apex) { apex = loco.position.y; rise = air; }
        trace.push({ t: R4(air), dy: R4(loco.position.y - y0), vy: R4(loco.velocity.y), sp: R4(sp()) });
      } else if (i > 2) break;
    }
    fall = air - rise;
    return { takeoff: R4(v0), height: R4(apex - y0), airtime: R4(air), rise: R4(rise), fall: R4(fall),
      dist: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)),
      landSpeed: R4(sp()), impact: loco.lastLand.impact, severity: loco.lastLand.severity,
      trace: trace.filter((_, i) => i % 2 === 0) };
  }
  out.tests.jumpStandHold = jumpTest({});
  out.tests.jumpStandTap = jumpTest({ tap: true });
  out.tests.jumpSprint = jumpTest({ sprint: true });
  out.tests.jumpSprintReverse = jumpTest({ sprint: true, reverseInAir: true });

  // ---------------------------------------------------------------- 3. turn radius
  function turnTest(sprint) {
    reset(25, 14);
    loco.sprintHeld = sprint;
    step(150, [0, -1]);
    const v0 = sp();
    const a = { x: loco.position.x, z: loco.position.z };
    let prev = Math.atan2(loco.heading.x, loco.heading.y), swept = 0, n = 0;
    const path = [], speeds = [];
    while (Math.abs(swept) < Math.PI - 0.02 && n < 400) {
      step(1, [1, 0]); n++;
      const h = Math.atan2(loco.heading.x, loco.heading.y);
      let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      swept += d; prev = h;
      path.push({ x: R4(loco.position.x), z: R4(loco.position.z), deg: R4(swept * 180 / Math.PI), sp: R4(sp()) });
      speeds.push(sp());
    }
    const b = path[path.length - 1] ?? a;
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    return { entry: R4(v0), degSwept: R4(swept * 180 / Math.PI), time180: R4(n / 60),
      diameter: R4(chord), radius: R4(chord / 2),
      minSpeed: R4(Math.min(...speeds)), maxSpeed: R4(Math.max(...speeds)),
      peakTurnRateDegPerSec: R4(180 / (n / 60)),
      path: path.filter((_, i) => i % 3 === 0) };
  }
  out.tests.turnSprint = turnTest(true);
  out.tests.turnRun = turnTest(false);

  // ---------------------------------------------------------------- 4. reversal / skid
  function reversalTest() {
    reset(25, 14);
    loco.sprintHeld = true;
    step(150, [0, -1]);
    const v0 = sp(), z0 = loco.position.z;
    let minZ = z0, skid = 0, n = 0, tRev = null, tFull = null, tStopped = null;
    while (n < 240) {
      step(1, [0, 1]); n++;
      if (loco.braking) skid++;
      minZ = Math.min(minZ, loco.position.z);
      if (tStopped === null && sp() < 0.2) tStopped = n / 60;
      if (tRev === null && loco.velocity.z > 0.2) tRev = n / 60;
      if (tRev !== null && tFull === null && loco.velocity.z > v0 * 0.9) { tFull = n / 60; break; }
    }
    return { v0: R4(v0), skidSteps: skid, skidSeconds: R4(skid / 60),
      overshootMetres: R4(z0 - minZ), timeToReverse: tRev && R4(tRev),
      timeToFullSpeedBack: tFull && R4(tFull) };
  }
  out.tests.reversal = reversalTest();

  // ---------------------------------------------------------------- 5. wall charge (terrace)
  // Terrace front face is at z = 30, top y = 3.12. Sprint into it from z = 22.
  {
    reset(0, 20, [0, 1]);
    loco.sprintHeld = true;
    let maxZ = loco.position.z, jitter = 0, prev = loco.position.z, penetrated = false, climbed = 0;
    const y0 = loco.position.y;
    for (let i = 0; i < 300; i++) {
      step(1, [0, 1]);
      maxZ = Math.max(maxZ, loco.position.z);
      if (loco.position.z > 30.1) penetrated = true;
      climbed = Math.max(climbed, loco.position.y - y0);
      const d = loco.position.z - prev; prev = loco.position.z;
      if (i > 90 && Math.abs(d) > 0.005) jitter++;
    }
    out.tests.wallCharge = { maxZ: R4(maxZ), stoppedAt: R4(loco.position.z), expectedFace: 30 - T.capsuleRadius,
      penetrated, jitterStepsAfterContact: jitter, climbed: R4(climbed),
      finalSpeed: R4(sp()), state: loco.state, grounded: loco.grounded };
  }

  // ---------------------------------------------------------------- 6. slope edge jump
  // 52° ramp is the last slot: x from -17.8 + 4*7.4 = 11.8 to 17.8, z from 30 - 3/tan52 = 27.66 to 30.
  {
    reset(14.8, 24, [0, 1]);
    loco.sprintHeld = true;
    const rec = [];
    let sawSlide = false, maxSlope = 0, stuck = 0, prev = { x: 0, z: 0 };
    for (let i = 0; i < 240; i++) {
      if (i === 60) loco._pressJump();       // jump right as the ramp lip arrives
      step(1, [0, 1]);
      if (loco.sliding) sawSlide = true;
      maxSlope = Math.max(maxSlope, loco.slopeDeg);
      const d = Math.hypot(loco.position.x - prev.x, loco.position.z - prev.z);
      if (i > 5 && d < 1e-5) stuck++;
      prev = { x: loco.position.x, z: loco.position.z };
      if (i % 10 === 0) rec.push({ i, y: R4(loco.position.y), z: R4(loco.position.z),
        slope: R4(loco.slopeDeg), g: loco.grounded, s: loco.state });
    }
    out.tests.slopeEdgeJump = { sawSlide, maxSlope: R4(maxSlope), stuckSteps: stuck,
      finalY: R4(loco.position.y), rec };
  }

  // ---------------------------------------------------------------- 7. steps / ledges
  {
    const risers = [0.25, 0.5, 0.7, 0.9];
    const flightZ = [[-14, -9], [-7, -2], [2, 7], [9, 14]];
    out.tests.stairs = risers.map((h, f) => {
      const zMid = (flightZ[f][0] + flightZ[f][1]) / 2;
      reset(-18, zMid, [-1, 0]);
      const y0 = loco.position.y;
      let maxY = y0, stuck = 0;
      let prevX = loco.position.x;
      for (let i = 0; i < 240; i++) {
        step(1, [-1, 0]);
        maxY = Math.max(maxY, loco.position.y);
        if (Math.abs(loco.position.x - prevX) < 1e-4) stuck++;
        prevX = loco.position.x;
        if (loco.position.x < -26) break;
      }
      return { riser: h, gained: R4(maxY - y0), expectedFlightTop: R4(4 * h),
        climbedAll: maxY - y0 > 4 * h - 0.15, stalledSteps: stuck, x: R4(loco.position.x) };
    });
  }

  // ---------------------------------------------------------------- 8. slope walk / limit
  // Cone at (-14,-26): 45° apron r 9→5, 54° crown. Slope limit is 47°.
  {
    reset(-14, -14, [0, -1]); // north of the cone, walk south into it
    loco.sprintHeld = true;
    let maxY = loco.position.y, sawSlide = false, maxSlope = 0;
    for (let i = 0; i < 420; i++) {
      step(1, [0, -1]);
      maxY = Math.max(maxY, loco.position.y);
      if (loco.sliding) sawSlide = true;
      maxSlope = Math.max(maxSlope, loco.slopeDeg);
    }
    out.tests.coneClimb = { maxY: R4(maxY), apronTop: R4(0.12 + 4), crownTop: R4(0.12 + 10.6),
      sawSlide, maxSlope: R4(maxSlope), finalY: R4(loco.position.y),
      pos: [R4(loco.position.x), R4(loco.position.z)] };
  }

  // ---------------------------------------------------------------- 9. ramps: uphill/downhill
  {
    const angles = [10, 20, 30, 40, 52];
    const slotW = 6, gap = 1.4;
    const spanX = angles.length * slotW + (angles.length - 1) * gap;
    out.tests.ramps = angles.map((deg, i) => {
      const x = -spanX / 2 + i * (slotW + gap) + slotW / 2;
      const run = 3 / Math.tan(deg * Math.PI / 180);
      reset(x, 30 - run - 4, [0, 1]);
      loco.sprintHeld = true;
      let maxY = loco.position.y, sawSlide = false, maxSpeed = 0, slopeSeen = 0;
      for (let i2 = 0; i2 < 300; i2++) {
        step(1, [0, 1]);
        maxY = Math.max(maxY, loco.position.y);
        if (loco.sliding) sawSlide = true;
        maxSpeed = Math.max(maxSpeed, sp());
        slopeSeen = Math.max(slopeSeen, loco.slopeDeg);
      }
      return { deg, gained: R4(maxY - (0.12 + T.capsuleHeight / 2)), reachedTerrace: maxY > 3.0,
        sawSlide, slopeSeen: R4(slopeSeen), topSpeed: R4(maxSpeed) };
    });
  }

  // ---------------------------------------------------------------- 10. thrash
  {
    reset(25, 14);
    loco.sprintHeld = true;
    step(150, [0, -1]);
    const v0 = sp();
    let nan = false, maxSp = 0, flips = 0, prevState = loco.state;
    for (let i = 0; i < 300; i++) {
      if (i % 3 === 0) loco._pressJump();
      step(1, i % 2 === 0 ? [0, 1] : [0, -1]);
      if (!Number.isFinite(loco.position.x + loco.position.y + loco.position.z)) nan = true;
      maxSp = Math.max(maxSp, sp());
      if (loco.state !== prevState) { flips++; prevState = loco.state; }
    }
    out.tests.thrash = { v0: R4(v0), nan, maxSpeed: R4(maxSp), cap: T.sprintSpeed,
      stateFlips: flips, finalSpeed: R4(sp()), finalState: loco.state, grounded: loco.grounded };
  }

  out.collision = vs.probe("collision");
  return out;
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => ({
  errors: d.consoleErrors, failed: d.failedRequests, out: await d.run(fn),
}));

fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
const t = res.out.tests;
const L = (k, v) => console.log(String(k).padEnd(22), v);
console.log("console errors:", res.errors.length, " failed requests:", res.failed.length);
console.log("\n-- stopping --");
L("sprint", JSON.stringify({ ...t.stopSprint, trace: undefined }));
L("run", JSON.stringify({ ...t.stopRun, trace: undefined }));
console.log("\n-- jumps --");
for (const k of ["jumpStandHold", "jumpStandTap", "jumpSprint", "jumpSprintReverse"]) {
  L(k, JSON.stringify({ ...t[k], trace: undefined }));
}
console.log("\n-- turning --");
L("sprint", JSON.stringify({ ...t.turnSprint, path: undefined }));
L("run", JSON.stringify({ ...t.turnRun, path: undefined }));
console.log("\n-- reversal --"); L("skid", JSON.stringify(t.reversal));
console.log("\n-- world --");
L("wallCharge", JSON.stringify(t.wallCharge));
L("slopeEdgeJump", JSON.stringify({ ...t.slopeEdgeJump, rec: undefined }));
L("stairs", JSON.stringify(t.stairs));
L("coneClimb", JSON.stringify(t.coneClimb));
L("ramps", JSON.stringify(t.ramps));
L("thrash", JSON.stringify(t.thrash));
console.log("\nwrote", OUT);
