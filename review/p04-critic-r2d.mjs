#!/usr/bin/env node
// P04 critic, pass 4 — frame-rate independence done properly (every input transition is aligned
// to a slice boundary shared by all cadences), plus run-speed turn behaviour and wall feedback.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const OUT = "review/p04-critic-r2d.json";

const fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion");
  const T = loco.tune;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STEP = 1 / 60;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);

  function reset(x, z, heading = [0, -1]) {
    loco.moveX = 0; loco.moveY = 0; loco.sprintHeld = false; loco.walkHeld = false;
    loco.jumpHeld = false; loco.jumpBuffer = 0;
    loco.teleport(x, STAND, z, { heading });
    for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0);
    for (let i = 0; i < 3; i++) K.advance(STEP, { render: false });
  }

  const out = {};

  // ------------------------------------------------------- A. frame-rate independence, aligned
  // Segments are all multiples of 24 steps, so slices of 1, 2, 3, 4, 6, 8 all land every input
  // transition on exactly the same simulation step. Any divergence left is the engine's.
  const PLAN = [
    { dir: [0, -1], steps: 96, jump: false },
    { dir: [0, -1], steps: 24, jump: true },   // jump fires on the first step of this segment
    { dir: [1, 0], steps: 72, jump: false },
    { dir: [0, 1], steps: 72, jump: false },
    { dir: [0, -1], steps: 48, jump: false },
  ];
  function rateRun(slice, useCamera) {
    reset(0, 12);
    loco.sprintHeld = true;
    const marks = [];
    for (const seg of PLAN) {
      let left = seg.steps;
      let first = true;
      while (left > 0) {
        const k = Math.min(slice, left);
        if (useCamera) {
          const cam = K.camera; cam.updateMatrixWorld();
          const e = cam.matrixWorld.elements;
          const y = Math.atan2(e[8], e[10]);
          const s = Math.sin(y), c = Math.cos(y);
          loco.moveX = seg.dir[0] * c - seg.dir[1] * s;
          loco.moveY = -seg.dir[0] * s - seg.dir[1] * c;
        } else { loco.moveX = seg.dir[0]; loco.moveY = -seg.dir[1]; }
        if (first && seg.jump) { loco._pressJump(); first = false; }
        K.advance(k * STEP, { render: false });
        left -= k;
      }
      const p = loco.position, v = loco.velocity;
      marks.push([R4(p.x), R4(p.y), R4(p.z), R4(v.x), R4(v.y), R4(v.z), loco.state]);
    }
    return marks;
  }
  out.raw = {};
  for (const k of [1, 2, 4, 8]) out.raw[`slice${k}`] = rateRun(k, false);
  out.rawMatch = Object.fromEntries([2, 4, 8].map((k) =>
    [`1vs${k}`, JSON.stringify(out.raw.slice1) === JSON.stringify(out.raw[`slice${k}`])]));

  out.cam = {};
  for (const k of [1, 2, 4, 8]) out.cam[`slice${k}`] = rateRun(k, true);
  out.camMatch = Object.fromEntries([2, 4, 8].map((k) =>
    [`1vs${k}`, JSON.stringify(out.cam.slice1) === JSON.stringify(out.cam[`slice${k}`])]));

  // ------------------------------------------------------- B. turn rate vs speed
  function yawRateAt(band) {
    reset(0, 8);
    loco.sprintHeld = band === "sprint"; loco.walkHeld = band === "walk";
    loco.moveX = 0; loco.moveY = 1;
    for (let i = 0; i < 150; i++) K.advance(STEP, { render: false });
    const v0 = sp();
    // hold hard-right relative to heading, sample the yaw rate over 12 steps
    const h0 = Math.atan2(loco.heading.x, loco.heading.y);
    let prev = h0, swept = 0;
    const speeds = [];
    for (let i = 0; i < 12; i++) {
      const hx = loco.heading.x, hz = loco.heading.y;
      loco.moveX = 0; loco.moveY = 0;
      // world direction 90° right of heading, expressed in the camera basis
      const wx = -hz, wz = hx;
      const cam = K.camera; cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      const y = Math.atan2(e[8], e[10]);
      const s = Math.sin(y), c = Math.cos(y);
      loco.moveX = wx * c - wz * s; loco.moveY = -wx * s - wz * c;
      K.advance(STEP, { render: false });
      const h = Math.atan2(loco.heading.x, loco.heading.y);
      let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      swept += d; prev = h;
      speeds.push(sp());
    }
    const rate = Math.abs(swept) / (12 / 60);
    return { band, entrySpeed: R4(v0), yawRateRadPerSec: R4(rate),
      yawRateDegPerSec: R4(rate * 180 / Math.PI),
      impliedRadius: R4(v0 / rate),
      speedAfter12: R4(speeds[speeds.length - 1]),
      speedLost: R4(v0 - speeds[speeds.length - 1]) };
  }
  out.yawRate = ["walk", "run", "sprint"].map(yawRateAt);

  // ------------------------------------------------------- C. what happens when you hit a wall
  // Signals emitted while sprinting head-on into the 5 m block.
  {
    const seen = [];
    const orig = loco.constructor;
    // tap the signal bus by monkey-patching the emit path we can reach: listen on the kernel
    const sig = K.signals;
    const names = ["player:land", "camera:shake", "audio:cue", "player:state"];
    const offs = names.map((n) => sig.on(n, (p) => seen.push([n, JSON.stringify(p).slice(0, 90)])));
    reset(31, 14, [0, 1]);
    loco.sprintHeld = true;
    loco.moveX = 0; loco.moveY = 1;
    for (let i = 0; i < 120; i++) K.advance(STEP, { render: false });
    const atWall = seen.slice(-8);
    for (const o of offs) o();
    out.wallFeedback = { finalSpeed: R4(sp()), state: loco.state, signalTail: atWall,
      sawShake: seen.some((s) => s[0] === "camera:shake"),
      sawImpactCue: seen.some((s) => s[0] === "audio:cue" && /impact|bump|thud/.test(s[1])) };
  }

  // ------------------------------------------------------- D. jump apex hang share
  {
    reset(0, 8);
    loco._pressJump();
    let apexSteps = 0, air = 0;
    for (let i = 0; i < 200; i++) {
      K.advance(STEP, { render: false });
      if (!loco.grounded) { air++; if (Math.abs(loco.velocity.y) < T.apexSpeed) apexSteps++; }
      else if (i > 3) break;
    }
    out.apex = { airSteps: air, hangSteps: apexSteps, hangFraction: R4(apexSteps / air) };
  }

  // ------------------------------------------------------- E. landing cost sweep
  {
    const drops = [1, 3, 6, 12, 25];
    out.landings = drops.map((h) => {
      reset(0, 8);
      loco.teleport(0, STAND + h, 8, { heading: [0, -1] });
      for (let i = 0; i < 400; i++) { K.advance(STEP, { render: false }); if (loco.grounded && i > 2) break; }
      return { dropM: h, impact: loco.lastLand.impact, severity: loco.lastLand.severity,
        hard: loco.lastLand.hard, landLock: R4(loco.landLock), squash: R4(loco.squash) };
    });
  }

  return out;
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => ({
  errors: d.consoleErrors, out: await d.run(fn),
}));
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
const o = res.out;
const L = (k, v) => console.log(String(k).padEnd(22), v);
console.log("console errors:", res.errors.length);
console.log("\n-- frame-rate independence (aligned inputs, world basis) --");
L("match", JSON.stringify(o.rawMatch));
for (const k of ["slice1", "slice2", "slice4", "slice8"]) L(k, JSON.stringify(o.raw[k]));
console.log("\n-- same, but movement basis read from the camera --");
L("match", JSON.stringify(o.camMatch));
for (const k of ["slice1", "slice8"]) L(k, JSON.stringify(o.cam[k]));
console.log("\n-- turn rate by speed band --");
for (const y of o.yawRate) L(y.band, JSON.stringify(y));
console.log("\n-- wall feedback --"); L("", JSON.stringify(o.wallFeedback));
console.log("\n-- apex --"); L("", JSON.stringify(o.apex));
console.log("\n-- landings --"); for (const l of o.landings) L(l.dropM + " m", JSON.stringify(l));
console.log("\nwrote", OUT);
