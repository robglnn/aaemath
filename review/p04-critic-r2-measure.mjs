#!/usr/bin/env node
// P04 round-2 CRITIC measurement rig. Written from scratch; shares no code with the builder's
// review/p04-feel.mjs. Everything is measured step-by-step through the app's own fixed clock.
//
//   node review/p04-critic-r2-measure.mjs
//
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const OUT = "review/p04-critic-r2.json";

const page_fn = async () => {
  // ---------------------------------------------------------------- page-side harness
  const vs = window.__vs;
  const K = vs.kernel;
  const loco = K.get("locomotion");
  const col = K.get("collision");
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STEP = 1 / 60;

  // Yaw of the camera forward axis — computed exactly the way Locomotion._basisYaw does, and
  // read BEFORE advancing, so it is the same value the coming fixed step will use.
  function basisYaw() {
    const has = K.byName.has("camera") || K.byName.has("camerarig") || K.byName.has("cameraRig");
    if (!has) return 0;
    const cam = K.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    if (Math.hypot(fx, fz) < 1e-4) return loco._lastBasisYaw ?? 0;
    return Math.atan2(-fx, -fz);
  }

  // Set the *world-space* intent direction, compensating the camera basis so a straight line
  // stays a straight line no matter what the camera is doing behind us.
  function intentWorld(wx, wz, mag = 1) {
    const l = Math.hypot(wx, wz);
    if (l < 1e-9) { loco.moveX = 0; loco.moveY = 0; return; }
    wx /= l; wz /= l;
    const y = basisYaw();
    const s = Math.sin(y), c = Math.cos(y);
    // inverse of: worldX = mx*c - my*s ; worldZ = -mx*s - my*c
    const mx = wx * c - wz * s;
    const my = -wx * s - wz * c;
    loco.moveX = mx * mag;
    loco.moveY = my * mag;
  }

  function step(n = 1, dir = null, mag = 1) {
    for (let i = 0; i < n; i++) {
      if (dir) intentWorld(dir[0], dir[1], mag);
      K.advance(STEP, { render: false });
    }
  }

  function snap() {
    const p = loco.position, v = loco.velocity;
    return {
      t: R4(loco.simTime),
      x: R4(p.x), y: R4(p.y), z: R4(p.z),
      vx: R4(v.x), vy: R4(v.y), vz: R4(v.z),
      sp: R4(Math.hypot(v.x, v.z)),
      grounded: loco.grounded, state: loco.state,
      hx: R4(loco.heading.x), hz: R4(loco.heading.y),
      braking: loco.braking, airtime: R4(loco.airtime),
      coyote: R4(loco.coyote), buf: R4(loco.jumpBuffer),
    };
  }

  function reset(x, y, z, heading = [0, -1]) {
    loco.moveX = 0; loco.moveY = 0;
    loco.sprintHeld = false; loco.walkHeld = false; loco.jumpHeld = false;
    loco.jumpBuffer = 0;
    loco.teleport(x, y, z, { heading });
    // settle onto the ground
    step(20);
    loco.velocity.set(0, 0, 0);
    step(2);
  }

  const T = loco.tune;
  const deck = 0.12;
  const standY = deck + T.capsuleHeight / 2 + 0.4;
  const out = { tune: T, tests: {} };

  // ================================================================ 1. acceleration
  function accel(sprint, walk = false) {
    reset(0, standY, 20);
    loco.sprintHeld = sprint; loco.walkHeld = walk;
    const trace = [];
    const t0 = loco.simTime;
    const p0x = loco.position.x, p0z = loco.position.z;
    for (let i = 0; i < 240; i++) {
      step(1, [0, -1]);
      trace.push({ t: R4(loco.simTime - t0), sp: R4(Math.hypot(loco.velocity.x, loco.velocity.z)),
        d: R4(Math.hypot(loco.position.x - p0x, loco.position.z - p0z)) });
    }
    const vmax = Math.max(...trace.map((s) => s.sp));
    const find = (frac) => {
      const target = vmax * frac;
      for (const s of trace) if (s.sp >= target) return s;
      return null;
    };
    return {
      vmax: R4(vmax),
      t50: find(0.5), t90: find(0.9), t99: find(0.99),
      trace: trace.slice(0, 90),
    };
  }
  out.tests.accelSprint = accel(true);
  out.tests.accelRun = accel(false);
  out.tests.accelWalk = accel(false, true);

  // ================================================================ 2. stopping
  function stop() {
    reset(0, standY, 30);
    loco.sprintHeld = true;
    step(120, [0, -1]);
    const v0 = Math.hypot(loco.velocity.x, loco.velocity.z);
    const x0 = loco.position.x, z0 = loco.position.z;
    loco.moveX = 0; loco.moveY = 0;
    let steps = 0;
    const trace = [];
    while (Math.hypot(loco.velocity.x, loco.velocity.z) > 0.05 && steps < 240) {
      step(1); steps++;
      trace.push(R4(Math.hypot(loco.velocity.x, loco.velocity.z)));
    }
    return {
      v0: R4(v0), timeToStop: R4(steps / 60),
      distance: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)),
      trace: trace.slice(0, 40),
    };
  }
  out.tests.stopSprint = stop();

  // ================================================================ 3. jumps
  function jump(sprint, holdFull = true) {
    reset(0, standY, 34);
    loco.sprintHeld = sprint;
    if (sprint) step(120, [0, -1]);
    const y0 = loco.position.y;
    const x0 = loco.position.x, z0 = loco.position.z;
    const v0 = Math.hypot(loco.velocity.x, loco.velocity.z);
    loco._pressJump();
    let apex = y0, air = 0, released = false;
    const trace = [];
    for (let i = 0; i < 300; i++) {
      if (!holdFull && loco.airtime > 0.08 && !released) { loco.jumpHeld = false; released = true; }
      step(1, sprint ? [0, -1] : null);
      trace.push({ t: R4(loco.airtime), y: R4(loco.position.y - y0), vy: R4(loco.velocity.vy ?? loco.velocity.y),
        g: loco.grounded, sp: R4(Math.hypot(loco.velocity.x, loco.velocity.z)) });
      if (!loco.grounded) { apex = Math.max(apex, loco.position.y); air = loco.airtime; }
      else if (i > 3) break;
    }
    return {
      takeoffSpeed: R4(v0),
      height: R4(apex - y0),
      airtime: R4(air),
      distance: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)),
      landSpeed: R4(Math.hypot(loco.velocity.x, loco.velocity.z)),
      lastJump: loco.lastJump,
      lastLand: loco.lastLand,
      trace: trace.filter((_, i) => i % 3 === 0).slice(0, 30),
    };
  }
  out.tests.jumpStand = jump(false, true);
  out.tests.jumpStandTap = jump(false, false);
  out.tests.jumpSprint = jump(true, true);

  // ================================================================ 4. coyote window
  // Run off the 5 m block at x 26..36, z 24..34, top y = 0.12 + 5.
  function runOffBlock(pressAfterSteps) {
    reset(31, 5.12 + T.capsuleHeight / 2 + 0.4, 33.0, [0, 1]);
    loco.sprintHeld = false;
    // run toward +z (the block's far edge at z = 34)
    let guard = 0;
    while (loco.grounded && guard++ < 300) step(1, [0, 1]);
    if (guard >= 300) return { error: "never left the block" };
    // step 0 = the first airborne step already happened above
    let airSteps = 1;
    let jumped = false;
    const jumpAtBefore = loco.lastJump.at;
    while (airSteps < pressAfterSteps) { step(1, [0, 1]); airSteps++; }
    loco._pressJump();
    step(1, [0, 1]);
    jumped = loco.lastJump.at !== jumpAtBefore && loco.velocity.y > 0;
    return { pressAfterSteps, jumped, vy: R4(loco.velocity.y) };
  }
  const coyote = [];
  for (let n = 1; n <= 16; n++) coyote.push(runOffBlock(n));
  const lastGood = coyote.filter((c) => c.jumped).pop();
  out.tests.coyote = {
    sweep: coyote.map((c) => (c.jumped ? 1 : 0)),
    monotonic: coyote.every((c, i) => (i === 0 ? true : !(c.jumped && !coyote[i - 1].jumped))),
    windowSteps: lastGood ? lastGood.pressAfterSteps : 0,
    windowSeconds: lastGood ? R4(lastGood.pressAfterSteps / 60) : 0,
    tuned: T.coyoteTime,
  };

  // ================================================================ 5. jump buffer
  // Fall off the same block; press jump N steps before touchdown, see if it fires on landing.
  function bufferTrial(pressBeforeSteps) {
    // first find how many airborne steps a plain fall takes
    reset(31, 5.12 + T.capsuleHeight / 2 + 0.4, 33.0, [0, 1]);
    let guard = 0;
    while (loco.grounded && guard++ < 300) step(1, [0, 1]);
    let air = 1;
    while (!loco.grounded && air < 400) { step(1, [0, 1]); air++; }
    const total = air;
    // replay, pressing `pressBeforeSteps` steps before touchdown
    reset(31, 5.12 + T.capsuleHeight / 2 + 0.4, 33.0, [0, 1]);
    guard = 0;
    while (loco.grounded && guard++ < 300) step(1, [0, 1]);
    const pressAt = total - pressBeforeSteps;
    let i = 1;
    const before = loco.lastJump.at;
    while (i < pressAt) { step(1, [0, 1]); i++; }
    loco._pressJump();
    let fired = false;
    for (let k = 0; k < pressBeforeSteps + 6; k++) {
      step(1, [0, 1]);
      if (loco.lastJump.at !== before) { fired = true; break; }
    }
    return { pressBeforeSteps, fired, totalAirSteps: total };
  }
  const buf = [];
  for (let n = 1; n <= 16; n++) buf.push(bufferTrial(n));
  const lastBuf = buf.filter((b) => b.fired).pop();
  out.tests.buffer = {
    sweep: buf.map((b) => (b.fired ? 1 : 0)),
    monotonic: buf.every((b, i) => (i === 0 ? true : !(b.fired && !buf[i - 1].fired))),
    windowSteps: lastBuf ? lastBuf.pressBeforeSteps : 0,
    windowSeconds: lastBuf ? R4(lastBuf.pressBeforeSteps / 60) : 0,
    tuned: T.jumpBuffer,
  };

  // ================================================================ 6. sprint turn radius
  function turn(sprint) {
    reset(0, standY, 40, [0, -1]);
    loco.sprintHeld = sprint;
    step(150, [0, -1]);
    const v0 = Math.hypot(loco.velocity.x, loco.velocity.z);
    const path = [];
    const h0 = Math.atan2(loco.heading.x, loco.heading.y);
    let swept = 0, prev = h0;
    let steps = 0;
    while (Math.abs(swept) < Math.PI && steps < 400) {
      step(1, [1, 0]); // hard right, world +X
      steps++;
      const h = Math.atan2(loco.heading.x, loco.heading.y);
      let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      swept += d; prev = h;
      path.push({ x: R4(loco.position.x), z: R4(loco.position.z),
        sp: R4(Math.hypot(loco.velocity.x, loco.velocity.z)), sweptDeg: R4(swept * 180 / Math.PI) });
    }
    // 180° of heading change: the straight-line offset between entry and exit is the diameter
    const a = path[0], b = path[path.length - 1];
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    // max lateral excursion from the entry direction (entry travel was world -Z)
    let maxLat = 0;
    for (const p of path) maxLat = Math.max(maxLat, Math.abs(p.x - a.x));
    const speeds = path.map((p) => p.sp);
    return {
      entrySpeed: R4(v0),
      degSwept: R4(swept * 180 / Math.PI),
      timeFor180: R4(steps / 60),
      diameterChord: R4(chord),
      radius: R4(chord / 2),
      lateralExcursion: R4(maxLat),
      minSpeedInTurn: R4(Math.min(...speeds)),
      maxSpeedInTurn: R4(Math.max(...speeds)),
      path: path.filter((_, i) => i % 4 === 0),
    };
  }
  out.tests.turnSprint = turn(true);
  out.tests.turnRun = turn(false);

  // ================================================================ 7. reversal (skid)
  function reversal() {
    reset(0, standY, 45, [0, -1]);
    loco.sprintHeld = true;
    step(150, [0, -1]);
    const v0 = Math.hypot(loco.velocity.x, loco.velocity.z);
    const z0 = loco.position.z;
    let minZ = z0, steps = 0, skidSteps = 0;
    let tReverse = null, tFull = null;
    while (steps < 200) {
      step(1, [0, 1]); steps++;
      if (loco.braking) skidSteps++;
      minZ = Math.min(minZ, loco.position.z);
      const along = loco.velocity.z; // +z is the new wanted direction
      if (tReverse === null && along > 0.2) tReverse = steps / 60;
      if (tFull === null && along > v0 * 0.9) { tFull = steps / 60; break; }
    }
    return {
      v0: R4(v0), overshoot: R4(z0 - minZ), skidSteps,
      timeToReverse: tReverse ? R4(tReverse) : null,
      timeToFullSpeed: tFull ? R4(tFull) : null,
    };
  }
  out.tests.reversal = reversal();

  // ================================================================ 8. break it
  const breaks = {};

  // 8a. sprint straight into the terrace wall (box -20..20 x, z 30..46, 3 m tall)
  {
    reset(0, standY, 20, [0, -1]);
    loco.sprintHeld = true;
    let maxPush = 0, jitter = 0, prevZ = loco.position.z, stuckInside = false;
    for (let i = 0; i < 240; i++) {
      step(1, [0, -1]);
      const dz = loco.position.z - prevZ; prevZ = loco.position.z;
      if (i > 120 && Math.abs(dz) > 0.02) jitter++;
      if (loco.position.z < 29.5 && loco.position.y < 3.0) stuckInside = true;
      maxPush = Math.max(maxPush, Math.abs(loco.velocity.y));
    }
    breaks.wallCharge = {
      finalZ: R4(loco.position.z), finalY: R4(loco.position.y),
      penetratedWall: stuckInside, jitterSteps: jitter,
      speedAtWall: R4(Math.hypot(loco.velocity.x, loco.velocity.z)),
      state: loco.state, grounded: loco.grounded,
    };
  }

  // 8b. inside corner (walls at x -40..-31 z 24..25.2 and x -40..-38.8 z 24..33)
  {
    reset(-35, standY, 29, [-1, 0]);
    loco.sprintHeld = true;
    let escaped = false, maxSpeed = 0, nanSeen = false;
    for (let i = 0; i < 300; i++) {
      // drive into the corner diagonally
      step(1, [-1, -1]);
      const p = loco.position;
      if (!Number.isFinite(p.x + p.y + p.z)) nanSeen = true;
      maxSpeed = Math.max(maxSpeed, Math.hypot(loco.velocity.x, loco.velocity.z));
      if (p.x < -41 || p.z < 23) escaped = true;
    }
    breaks.insideCorner = {
      pos: [R4(loco.position.x), R4(loco.position.y), R4(loco.position.z)],
      escapedThroughWall: escaped, nan: nanSeen, maxSpeed: R4(maxSpeed),
      pushes: col.counters.depenetrations,
    };
  }

  // 8c. jump at the lip of the 52° ramp / 54° cone crown, then spam jump
  {
    reset(-14, 12, -26, [1, 0]); // above the cone crown; falls onto it
    let slid = false, stuck = 0, prevP = [loco.position.x, loco.position.z], jitterFlips = 0;
    let lastSign = 0;
    for (let i = 0; i < 400; i++) {
      loco._pressJump();          // spam jump every single step
      step(1, [1, 0]);
      if (loco.sliding) slid = true;
      const dx = loco.position.x - prevP[0];
      const sign = Math.sign(dx);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) jitterFlips++;
      if (sign !== 0) lastSign = sign;
      if (Math.hypot(dx, loco.position.z - prevP[1]) < 1e-4) stuck++;
      prevP = [loco.position.x, loco.position.z];
    }
    breaks.slopeSpam = {
      pos: [R4(loco.position.x), R4(loco.position.y), R4(loco.position.z)],
      sawSliding: slid, stuckSteps: stuck, directionFlips: jitterFlips,
      grounded: loco.grounded, state: loco.state,
    };
  }

  // 8d. stair flights: which riser heights are walkable
  {
    const risers = [0.25, 0.5, 0.7, 0.9];
    const flightZ = [[-14, -9], [-7, -2], [2, 7], [9, 14]];
    breaks.stairs = risers.map((h, f) => {
      const zMid = (flightZ[f][0] + flightZ[f][1]) / 2;
      reset(-18, standY, zMid, [-1, 0]);
      const y0 = loco.position.y;
      for (let i = 0; i < 420; i++) step(1, [-1, 0]);
      return { riser: h, climbed: R4(loco.position.y - y0), x: R4(loco.position.x),
        expectedTop: R4(4 * h), grounded: loco.grounded };
    });
  }

  // 8e. spam intent reversal every step at sprint (input thrash)
  {
    reset(0, standY, 46, [0, -1]);
    loco.sprintHeld = true;
    step(150, [0, -1]);
    let nan = false, maxSp = 0, stateFlips = 0, prevState = loco.state;
    for (let i = 0; i < 300; i++) {
      step(1, i % 2 === 0 ? [0, 1] : [0, -1]);
      if (!Number.isFinite(loco.position.x + loco.position.z)) nan = true;
      maxSp = Math.max(maxSp, Math.hypot(loco.velocity.x, loco.velocity.z));
      if (loco.state !== prevState) { stateFlips++; prevState = loco.state; }
    }
    breaks.inputThrash = { nan, maxSpeed: R4(maxSp), stateFlips, cap: T.sprintSpeed,
      finalSpeed: R4(Math.hypot(loco.velocity.x, loco.velocity.z)) };
  }

  // 8f. high fall onto the deck from 40 m — tunnelling check
  {
    reset(0, 45, 10);
    loco.velocity.set(0, 0, 0);
    let minY = 45, landed = false;
    for (let i = 0; i < 600; i++) {
      step(1);
      minY = Math.min(minY, loco.position.y);
      if (loco.grounded) { landed = true; break; }
    }
    breaks.highFall = {
      landed, minY: R4(minY), finalY: R4(loco.position.y),
      impact: loco.lastLand, tunnelled: minY < -1,
    };
  }

  out.tests.breaks = breaks;
  out.probeAfter = vs.probe("locomotion");
  out.collision = vs.probe("collision");
  return out;
};

// -------------------------------------------------------------------- determinism run
const det_fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion");
  const STEP = 1 / 60;
  function basisYaw() {
    const cam = K.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    if (Math.hypot(fx, fz) < 1e-4) return loco._lastBasisYaw ?? 0;
    return Math.atan2(-fx, -fz);
  }
  function intent(wx, wz) {
    const y = basisYaw(), s = Math.sin(y), c = Math.cos(y);
    loco.moveX = wx * c - wz * s; loco.moveY = -wx * s - wz * c;
  }
  const script = [
    ["run", [0, -1], 60], ["sprint", [0, -1], 90], ["jump", null, 0],
    ["turn", [1, 0], 70], ["rev", [0, 1], 80], ["jump", null, 0], ["idle", [0, 0], 40],
  ];
  function run() {
    loco.teleport(0, 0.12 + 1.82 / 2 + 0.4, 20, { heading: [0, -1] });
    loco.sprintHeld = false; loco.jumpHeld = false; loco.jumpBuffer = 0;
    for (let i = 0; i < 20; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0);
    const marks = [];
    for (const [kind, dir, n] of script) {
      if (kind === "sprint") loco.sprintHeld = true;
      if (kind === "jump") { loco._pressJump(); }
      for (let i = 0; i < n; i++) {
        if (dir) intent(dir[0], dir[1]); else { loco.moveX = 0; loco.moveY = 0; }
        K.advance(STEP, { render: false });
      }
      const p = loco.position, v = loco.velocity;
      marks.push([kind, p.x, p.y, p.z, v.x, v.y, v.z, loco.heading.x, loco.heading.y, loco.state]);
    }
    return marks;
  }
  const a = run();
  const b = run();
  return { a, b, identical: JSON.stringify(a) === JSON.stringify(b) };
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => {
  const measured = await d.run(page_fn);
  const det = await d.run(det_fn);
  return {
    consoleErrors: d.consoleErrors,
    failedRequests: d.failedRequests,
    warnings: d.consoleWarnings.slice(0, 10),
    measured,
    determinismSameSession: det,
  };
});

fs.writeFileSync(OUT, JSON.stringify(res, null, 2));

const m = res.measured.tests;
const line = (k, v) => console.log(k.padEnd(30), v);
console.log("=== console ===", res.consoleErrors.length, "errors,", res.failedRequests.length, "failed requests");
console.log("\n=== acceleration ===");
for (const [k, a] of [["sprint", m.accelSprint], ["run", m.accelRun], ["walk", m.accelWalk]]) {
  line(k, `vmax ${a.vmax}  t50 ${a.t50?.t} (${a.t50?.d} m)  t90 ${a.t90?.t}s (${a.t90?.d} m)  t99 ${a.t99?.t}s`);
}
console.log("\n=== stopping ===");
line("sprint stop", `v0 ${m.stopSprint.v0}  t ${m.stopSprint.timeToStop}s  d ${m.stopSprint.distance} m`);
console.log("\n=== jumps ===");
for (const [k, j] of [["stand(hold)", m.jumpStand], ["stand(tap)", m.jumpStandTap], ["sprint", m.jumpSprint]]) {
  line(k, `h ${j.height} m  air ${j.airtime}s  dist ${j.distance} m  land@ ${j.landSpeed} m/s  impact ${j.lastLand?.impact}`);
}
console.log("\n=== windows ===");
line("coyote", `${m.coyote.windowSteps} steps = ${m.coyote.windowSeconds}s (tuned ${m.coyote.tuned}) monotonic=${m.coyote.monotonic} sweep=${m.coyote.sweep.join("")}`);
line("buffer", `${m.buffer.windowSteps} steps = ${m.buffer.windowSeconds}s (tuned ${m.buffer.tuned}) monotonic=${m.buffer.monotonic} sweep=${m.buffer.sweep.join("")}`);
console.log("\n=== turning ===");
for (const [k, t] of [["sprint", m.turnSprint], ["run", m.turnRun]]) {
  line(k, `entry ${t.entrySpeed}  180° in ${t.timeFor180}s  radius ${t.radius} m  lat ${t.lateralExcursion} m  speed ${t.minSpeedInTurn}..${t.maxSpeedInTurn}`);
}
console.log("\n=== reversal ===");
line("sprint reversal", JSON.stringify(m.reversal));
console.log("\n=== breaks ===");
for (const [k, v] of Object.entries(m.breaks)) line(k, JSON.stringify(v));
console.log("\n=== determinism (same session, two identical runs) ===");
line("identical", String(res.determinismSameSession.identical));
if (!res.determinismSameSession.identical) {
  console.log(JSON.stringify(res.determinismSameSession.a, null, 1));
  console.log(JSON.stringify(res.determinismSameSession.b, null, 1));
}
console.log("\nwrote", OUT);
