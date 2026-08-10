#!/usr/bin/env node
// P04 critic, pass 3 — sustained turning circle, a real wall, and frame-rate independence.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const OUT = "review/p04-critic-r2c.json";

const fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion");
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
  function intent(wx, wz) {
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    const y = basisYaw(), s = Math.sin(y), c = Math.cos(y);
    loco.moveX = wx * c - wz * s; loco.moveY = -wx * s - wz * c;
  }
  function step(n = 1, dir = null) {
    for (let i = 0; i < n; i++) { if (dir) intent(dir[0], dir[1]); K.advance(STEP, { render: false }); }
  }
  function reset(x, z, heading = [0, -1], y = STAND) {
    loco.moveX = 0; loco.moveY = 0; loco.sprintHeld = false; loco.walkHeld = false;
    loco.jumpHeld = false; loco.jumpBuffer = 0;
    loco.teleport(x, y, z, { heading });
    for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0); step(3);
  }
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);
  const out = {};

  // ---------------------------------------------------------------- A. sustained turning circle
  // Hold the stick permanently 90° to the right of the *current* heading — the input a player
  // uses to circle. The path is then a real arc and its radius is the turning circle.
  function circle(sprint) {
    reset(0, 0);
    loco.sprintHeld = sprint;
    step(150, [0, -1]);
    const v0 = sp();
    const path = [];
    let prev = Math.atan2(loco.heading.x, loco.heading.y), swept = 0, n = 0;
    const t90 = { t: null }, t180 = { t: null };
    while (Math.abs(swept) < 2 * Math.PI && n < 600) {
      // stick = heading rotated +90° in the heading's own frame
      const hx = loco.heading.x, hz = loco.heading.y;
      intent(-hz, hx);
      K.advance(STEP, { render: false });
      n++;
      const h = Math.atan2(loco.heading.x, loco.heading.y);
      let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      swept += d; prev = h;
      if (t90.t === null && Math.abs(swept) >= Math.PI / 2) t90.t = n / 60;
      if (t180.t === null && Math.abs(swept) >= Math.PI) t180.t = n / 60;
      path.push({ x: loco.position.x, z: loco.position.z, sp: sp(), deg: swept * 180 / Math.PI });
    }
    // radius from the full circle: fit centre by least squares over the last full lap
    const pts = path.slice(Math.max(0, path.length - Math.round(n * 0.9)));
    let sx = 0, sz = 0;
    for (const p of pts) { sx += p.x; sz += p.z; }
    const cx = sx / pts.length, cz = sz / pts.length;
    const radii = pts.map((p) => Math.hypot(p.x - cx, p.z - cz));
    const rMean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const speeds = pts.map((p) => p.sp);
    return {
      entrySpeed: R4(v0), stepsForFullCircle: n, timeFor360: R4(n / 60),
      timeFor90: t90.t && R4(t90.t), timeFor180: t180.t && R4(t180.t),
      fittedRadius: R4(rMean),
      radiusSpread: R4(Math.max(...radii) - Math.min(...radii)),
      sustainedSpeed: R4(speeds.reduce((a, b) => a + b, 0) / speeds.length),
      minSpeed: R4(Math.min(...speeds)), maxSpeed: R4(Math.max(...speeds)),
      theoreticalRadius: R4(v0 / (sprint ? T.turnRateFast : 0)),
      path: path.filter((_, i) => i % 6 === 0).map((p) => ({ x: R4(p.x), z: R4(p.z), deg: R4(p.deg) })),
    };
  }
  out.circleSprint = circle(true);
  out.circleRun = circle(false);

  // ---------------------------------------------------------------- B. 90° snap turn at sprint
  {
    reset(0, 0);
    loco.sprintHeld = true;
    step(150, [0, -1]);
    const v0 = sp();
    const x0 = loco.position.x, z0 = loco.position.z;
    let n = 0, done = null;
    while (n < 200) {
      step(1, [1, 0]); n++;
      const h = Math.atan2(loco.heading.x, loco.heading.y);
      // heading target is world +X → atan2(1,0) = 90°
      if (done === null && Math.abs(h - Math.PI / 2) < 0.02) { done = n / 60; break; }
    }
    out.snap90 = { entry: R4(v0), timeTo90: done && R4(done),
      arcLength: R4(Math.hypot(loco.position.x - x0, loco.position.z - z0)),
      speedAfter: R4(sp()) };
  }

  // ---------------------------------------------------------------- C. real wall charge
  // The 5 m block: x 26..36, z 24..34. Its -Z face is at z = 24. Charge it from z = 14.
  {
    reset(31, 14, [0, 1]);
    loco.sprintHeld = true;
    let maxZ = -Infinity, jitter = 0, prev = loco.position.z, climbed = 0;
    const y0 = loco.position.y;
    const rec = [];
    for (let i = 0; i < 300; i++) {
      step(1, [0, 1]);
      maxZ = Math.max(maxZ, loco.position.z);
      climbed = Math.max(climbed, loco.position.y - y0);
      const d = loco.position.z - prev; prev = loco.position.z;
      if (i > 120 && Math.abs(d) > 0.004) jitter++;
      if (i % 20 === 0) rec.push({ i, z: R4(loco.position.z), y: R4(loco.position.y), sp: R4(sp()), st: loco.state });
    }
    out.wallCharge = { maxZ: R4(maxZ), faceZ: 24, expectedStop: R4(24 - T.capsuleRadius),
      penetrated: maxZ > 24 - T.capsuleRadius + 0.02, climbed: R4(climbed),
      jitterAfterContact: jitter, finalSpeed: R4(sp()), state: loco.state, rec };
  }

  // ---------------------------------------------------------------- D. graze / wall slide
  {
    reset(31, 14, [0, 1]);
    loco.sprintHeld = true;
    // charge the same face at 20° off normal — a graze must keep the tangential speed
    let keep = 0;
    for (let i = 0; i < 200; i++) { step(1, [Math.sin(0.35), Math.cos(0.35)]); if (i > 120) keep = Math.max(keep, sp()); }
    out.wallGraze = { tangentialSpeedHeld: R4(keep), sprint: T.sprintSpeed,
      fraction: R4(keep / T.sprintSpeed), x: R4(loco.position.x), z: R4(loco.position.z) };
  }

  // ---------------------------------------------------------------- E. frame-rate independence
  // Identical *input* schedule, three different render cadences. Gameplay must land in the
  // same place: that is the whole point of a fixed step.
  function rateRun(sliceSteps) {
    reset(0, 10);
    loco.sprintHeld = true;
    const marks = [];
    const plan = [[[0, -1], 90], [[1, 0], 60], [[0, 1], 60], [[0, -1], 60]];
    let jumpedAt = 120;
    let total = 0;
    for (const [dir, n] of plan) {
      let left = n;
      while (left > 0) {
        const k = Math.min(sliceSteps, left);
        intent(dir[0], dir[1]);
        if (total <= jumpedAt && total + k > jumpedAt) loco._pressJump();
        K.advance(k * STEP, { render: false });
        left -= k; total += k;
      }
      const p = loco.position, v = loco.velocity;
      marks.push([R4(p.x), R4(p.y), R4(p.z), R4(v.x), R4(v.y), R4(v.z), loco.state]);
    }
    return marks;
  }
  out.rate1 = rateRun(1);
  out.rate4 = rateRun(4);
  out.rate8 = rateRun(8);
  out.rateMatch = {
    "1vs4": JSON.stringify(out.rate1) === JSON.stringify(out.rate4),
    "1vs8": JSON.stringify(out.rate1) === JSON.stringify(out.rate8),
  };

  // Same test again with the camera basis taken out of the loop, to isolate whether any
  // divergence comes from the controller or from reading a variable-dt camera inside fixed().
  function rateRunWorldBasis(sliceSteps) {
    const saved = K.byName;
    reset(0, 10);
    loco.sprintHeld = true;
    const marks = [];
    const plan = [[[0, -1], 90], [[1, 0], 60], [[0, 1], 60], [[0, -1], 60]];
    let total = 0;
    for (const [dir, n] of plan) {
      let left = n;
      while (left > 0) {
        const k = Math.min(sliceSteps, left);
        loco.moveX = dir[0]; loco.moveY = -dir[1]; // raw, no camera compensation
        if (total <= 120 && total + k > 120) loco._pressJump();
        K.advance(k * STEP, { render: false });
        left -= k; total += k;
      }
      const p = loco.position, v = loco.velocity;
      marks.push([R4(p.x), R4(p.y), R4(p.z), R4(v.x), R4(v.y), R4(v.z), loco.state]);
    }
    return marks;
  }
  out.raw1 = rateRunWorldBasis(1);
  out.raw8 = rateRunWorldBasis(8);
  out.rawMatch = JSON.stringify(out.raw1) === JSON.stringify(out.raw8);

  // ---------------------------------------------------------------- F. determinism signature
  function signature() {
    reset(0, 10);
    loco.sprintHeld = true;
    const plan = [[[0, -1], 80], [[1, 0], 50], [[0, 1], 70], [[0, -1], 50]];
    const marks = [];
    let total = 0;
    for (const [dir, n] of plan) {
      for (let i = 0; i < n; i++) {
        loco.moveX = dir[0]; loco.moveY = -dir[1];
        if (total === 100) loco._pressJump();
        K.advance(STEP, { render: false }); total++;
      }
      const p = loco.position, v = loco.velocity;
      marks.push([p.x, p.y, p.z, v.x, v.y, v.z, loco.heading.x, loco.heading.y, loco.state]);
    }
    return marks;
  }
  out.signatureA = signature();
  out.signatureB = signature();
  out.signatureStable = JSON.stringify(out.signatureA) === JSON.stringify(out.signatureB);
  return out;
};

const runOnce = () => openGame({ width: 1280, height: 720 }, async (d) => ({
  errors: d.consoleErrors, out: await d.run(fn),
}));

const a = await runOnce();
const b = await runOnce();
const crossSession = JSON.stringify(a.out.signatureA) === JSON.stringify(b.out.signatureA);

fs.writeFileSync(OUT, JSON.stringify({ a, b: { signatureA: b.out.signatureA }, crossSession }, null, 2));
const o = a.out;
const L = (k, v) => console.log(String(k).padEnd(20), v);
console.log("console errors:", a.errors.length);
console.log("\n-- turning circle --");
L("sprint", JSON.stringify({ ...o.circleSprint, path: undefined }));
L("run", JSON.stringify({ ...o.circleRun, path: undefined }));
L("snap90", JSON.stringify(o.snap90));
console.log("\n-- world --");
L("wallCharge", JSON.stringify({ ...o.wallCharge, rec: undefined }));
L("wallCharge rec", JSON.stringify(o.wallCharge.rec));
L("wallGraze", JSON.stringify(o.wallGraze));
console.log("\n-- frame-rate independence --");
L("rateMatch", JSON.stringify(o.rateMatch));
L("rate1", JSON.stringify(o.rate1));
L("rate4", JSON.stringify(o.rate4));
L("rate8", JSON.stringify(o.rate8));
L("rawMatch(no camera)", String(o.rawMatch));
L("raw1", JSON.stringify(o.raw1));
L("raw8", JSON.stringify(o.raw8));
console.log("\n-- determinism --");
L("same session", String(o.signatureStable));
L("cross session", String(crossSession));
console.log("\nwrote", OUT);
