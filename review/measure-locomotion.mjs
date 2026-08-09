#!/usr/bin/env node
/**
 * P04 measurement rig — the numbers this piece is judged on.
 *
 *   node review/measure-locomotion.mjs [--json=review/shots/p04/measurements.json]
 *
 * Everything here is driven through the app's own fixed-step clock, one 60 Hz step at a time,
 * with synthetic keyboard events dispatched between steps. That gives frame-exact control of a
 * jump release or a buffered press, which real `page.keyboard` calls cannot: a Playwright key
 * press lands at some wall-clock moment, and wall-clock means nothing in a headless run where
 * software GL renders at a few frames a second.
 *
 * Trials reset the body with `player:spawn`, which Locomotion accepts as a teleport command —
 * no back door, just the signal the flow layer will use.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, arg, has, ROOT } from "../tools/lib/session.mjs";

const STEP = 1 / 60;
const DECK = 0.12;
const STAND = 0.92;                 // capsule centre above the surface it rests on
const deckAt = (x, z) => ({ x, y: DECK + STAND, z });

// Field indices in the compact sample rows the page returns.
const F = {
  px: 0, py: 1, pz: 2, vx: 3, vy: 4, vz: 5, speed: 6, grounded: 7, state: 8,
  slope: 9, sliding: 10, landImpact: 11, landAt: 12, jumpH: 13, jumpT: 14,
  lock: 15, squash: 16, coyote: 17, buffer: 18,
};

/** Runs one deterministic trial in the page and returns per-step samples. */
function trialFn({ spawn, steps, events }) {
  const vs = window.__vs;
  const S = vs.kernel.signals;
  const ALL = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space", "ControlLeft"];
  const key = (code, down) =>
    window.dispatchEvent(
      new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true, cancelable: true })
    );

  for (const c of ALL) key(c, false);
  vs.advance(1 / 60, { render: false });
  S.emit("player:spawn", { position: spawn });
  vs.advance(1 / 60, { render: false });

  const byStep = new Map();
  for (const e of events) {
    if (!byStep.has(e.step)) byStep.set(e.step, []);
    byStep.get(e.step).push(e);
  }

  const out = [];
  for (let i = 0; i < steps; i++) {
    const es = byStep.get(i);
    if (es) for (const e of es) key(e.code, e.down);
    vs.advance(1 / 60, { render: false });
    const p = vs.probe("locomotion");
    out.push([
      p.position[0], p.position[1], p.position[2],
      p.velocity[0], p.velocity[1], p.velocity[2],
      p.speed, p.grounded ? 1 : 0, p.state,
      p.slopeDeg, p.sliding ? 1 : 0,
      p.lastLand.impact, p.lastLand.at,
      p.lastJump.height, p.lastJump.airtime,
      p.landLock, p.squash, p.coyoteRemaining, p.bufferRemaining,
    ]);
  }
  for (const c of ALL) key(c, false);
  vs.advance(1 / 60, { render: false });
  return out;
}

const r = (v, n = 3) => Number(v.toFixed(n));
const hyp = (a, b) => Math.hypot(a, b);

async function main() {
  const outFile = arg("json", "review/shots/p04/measurements.json");
  const results = {};

  // Measure against the built bundle, not the dev server. A run takes minutes, other agents are
  // editing this repo the whole time, and one Vite HMR reload mid-run destroys the page context
  // and every number with it. `vite preview` watches nothing.
  if (!has("dev")) {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore", shell: true });
  }

  await openGame({ width: 1280, height: 720, built: !has("dev") }, async (d) => {
    await d.play(0.8);
    const tune = (await d.probe("locomotion")).tunables;
    const run = (spawn, steps, events = []) => d.run(trialFn, { spawn, steps, events });

    // ---------------------------------------------------------------- 1. acceleration + stop
    // 90 steps holding sprint from a standstill, then 60 with everything released.
    const accel = await run(deckAt(20, 6), 170, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
      { step: 100, code: "KeyW", down: false },
      { step: 100, code: "ShiftLeft", down: false },
    ]);
    const runAccel = await run(deckAt(20, 6), 170, [
      { step: 0, code: "KeyW", down: true },
      { step: 100, code: "KeyW", down: false },
    ]);

    const timeToFraction = (rows, top, frac) => {
      for (let i = 0; i < rows.length; i++) if (rows[i][F.speed] >= top * frac) return (i + 1) * STEP;
      return null;
    };
    const stopMetrics = (rows, releaseStep) => {
      const p0 = rows[releaseStep - 1];
      let i = releaseStep;
      while (i < rows.length && rows[i][F.speed] > 0.02) i++;
      const p1 = rows[Math.min(i, rows.length - 1)];
      return {
        fromSpeed: r(p0[F.speed]),
        distance: r(hyp(p1[F.px] - p0[F.px], p1[F.pz] - p0[F.pz])),
        seconds: r((i - releaseStep + 1) * STEP),
      };
    };

    results.acceleration = {
      sprintTop: r(tune.sprintSpeed),
      sprint90: r(timeToFraction(accel, tune.sprintSpeed, 0.9)),
      sprint99: r(timeToFraction(accel, tune.sprintSpeed, 0.99)),
      sprintDistanceTo90: r(
        hyp(
          accel[Math.round(timeToFraction(accel, tune.sprintSpeed, 0.9) / STEP) - 1][F.px] - accel[0][F.px],
          accel[Math.round(timeToFraction(accel, tune.sprintSpeed, 0.9) / STEP) - 1][F.pz] - deckAt(20, 6).z
        )
      ),
      runTop: r(tune.runSpeed),
      run90: r(timeToFraction(runAccel, tune.runSpeed, 0.9)),
      run99: r(timeToFraction(runAccel, tune.runSpeed, 0.99)),
    };
    results.stopping = {
      fromSprint: stopMetrics(accel, 100),
      fromRun: stopMetrics(runAccel, 100),
    };

    // ---------------------------------------------------------------- 2. jump shape
    const jumpTrial = async (holdSteps) => {
      const rows = await run(deckAt(20, 6), 110, [
        { step: 4, code: "Space", down: true },
        { step: 4 + holdSteps, code: "Space", down: false },
      ]);
      const y0 = rows[3][F.py];
      let apex = y0, airStart = -1, airEnd = -1;
      for (let i = 4; i < rows.length; i++) {
        if (rows[i][F.py] > apex) apex = rows[i][F.py];
        if (airStart < 0 && rows[i][F.grounded] === 0) airStart = i;
        if (airStart >= 0 && airEnd < 0 && rows[i][F.grounded] === 1) airEnd = i;
      }
      return {
        holdSeconds: r(holdSteps * STEP),
        apexHeight: r(apex - y0),
        airtime: r((airEnd - airStart + 1) * STEP),
        landImpact: r(rows[Math.min(airEnd + 1, rows.length - 1)][F.landImpact]),
        reportedHeight: r(rows[Math.min(airEnd + 2, rows.length - 1)][F.jumpH]),
      };
    };
    results.jump = {
      full: await jumpTrial(40),
      medium: await jumpTrial(8),
      tap: await jumpTrial(1),
    };

    // moving jump: does momentum survive the arc?
    const movingJump = await run(deckAt(20, 10), 190, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
      { step: 90, code: "Space", down: true },
      { step: 130, code: "Space", down: false },
    ]);
    {
      let airStart = -1, airEnd = -1, apex = 0;
      const y0 = movingJump[89][F.py];
      for (let i = 90; i < movingJump.length; i++) {
        if (movingJump[i][F.py] - y0 > apex) apex = movingJump[i][F.py] - y0;
        if (airStart < 0 && movingJump[i][F.grounded] === 0) airStart = i;
        if (airStart >= 0 && airEnd < 0 && movingJump[i][F.grounded] === 1) airEnd = i;
      }
      results.jump.sprinting = {
        takeoffSpeed: r(movingJump[airStart - 1][F.speed]),
        apexHeight: r(apex),
        airtime: r((airEnd - airStart + 1) * STEP),
        landingSpeed: r(movingJump[airEnd][F.speed]),
        speedKept: r(movingJump[airEnd][F.speed] / movingJump[airStart - 1][F.speed]),
        distance: r(hyp(movingJump[airEnd][F.px] - movingJump[airStart][F.px],
                        movingJump[airEnd][F.pz] - movingJump[airStart][F.pz])),
        landImpact: r(movingJump[Math.min(airEnd + 1, movingJump.length - 1)][F.landImpact]),
      };
    }

    // ---------------------------------------------------------------- 3. coyote window
    // Sprint off the deck rim, then press jump N steps after ground is lost.
    const rimRun = await run(deckAt(20, -38), 130, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
    ]);
    let leaveStep = rimRun.findIndex((s) => s[F.grounded] === 0);
    const coyoteTrials = [];
    for (let delay = 0; delay <= 14; delay++) {
      const rows = await run(deckAt(20, -38), leaveStep + delay + 14, [
        { step: 0, code: "KeyW", down: true },
        { step: 0, code: "ShiftLeft", down: true },
        { step: leaveStep + delay, code: "Space", down: true },
        { step: leaveStep + delay + 8, code: "Space", down: false },
      ]);
      const after = rows.slice(leaveStep + delay, leaveStep + delay + 4);
      const jumped = after.some((s) => s[F.vy] > 4);
      coyoteTrials.push({ delaySteps: delay, delaySeconds: r(delay * STEP), jumped });
    }
    const lastCoyote = [...coyoteTrials].reverse().find((t) => t.jumped);
    results.coyote = {
      tunable: tune.coyoteTime,
      groundLostAtStep: leaveStep,
      observedSeconds: lastCoyote ? lastCoyote.delaySeconds : 0,
      observedSteps: lastCoyote ? lastCoyote.delaySteps : 0,
      firstFailureSeconds: r((coyoteTrials.find((t) => !t.jumped)?.delaySteps ?? 15) * STEP),
      trials: coyoteTrials,
    };

    // ---------------------------------------------------------------- 4. buffered jump window
    const base = await run(deckAt(20, 6), 110, [
      { step: 4, code: "Space", down: true },
      { step: 44, code: "Space", down: false },
    ]);
    let land = -1;
    for (let i = 6; i < base.length; i++) if (base[i][F.grounded] === 1) { land = i; break; }
    const bufferTrials = [];
    for (let lead = 0; lead <= 16; lead++) {
      const press = land - lead;
      const rows = await run(deckAt(20, 6), land + 16, [
        { step: 4, code: "Space", down: true },
        { step: 44, code: "Space", down: false },
        { step: press, code: "Space", down: true },
        { step: press + 2, code: "Space", down: false },
      ]);
      const after = rows.slice(land, land + 8);
      const jumped = after.some((s) => s[F.vy] > 4);
      bufferTrials.push({ leadSteps: lead, leadSeconds: r(lead * STEP), jumped });
    }
    const lastBuffer = [...bufferTrials].reverse().find((t) => t.jumped);
    results.jumpBuffer = {
      tunable: tune.jumpBuffer,
      landingStep: land,
      observedSeconds: lastBuffer ? lastBuffer.leadSeconds : 0,
      observedSteps: lastBuffer ? lastBuffer.leadSteps : 0,
      trials: bufferTrials,
    };

    // ---------------------------------------------------------------- 5. turn radius at sprint
    const turn = await run(deckAt(20, -5), 200, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
      { step: 110, code: "KeyW", down: false },
      { step: 110, code: "KeyD", down: true },
    ]);
    {
      // Velocity heading in compass radians, so the sweep is measured on the thing the player
      // actually sees moving. The threshold is 85°, not 90°: the last degree of a carve is
      // asymptotic, and waiting for it would report every finite turn as "never finished".
      const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
      const dirs = turn.map((s) => Math.atan2(s[F.vx], -s[F.vz]));
      const d0 = dirs[109];
      const TARGET = (85 * Math.PI) / 180;
      let endIdx = -1;
      const radii = [];
      for (let i = 111; i < turn.length; i++) {
        const w = Math.abs(wrap(dirs[i] - dirs[i - 1])) / STEP;
        if (w > 0.4) radii.push(turn[i][F.speed] / w);
        if (endIdx < 0 && Math.abs(wrap(dirs[i] - d0)) >= TARGET) endIdx = i;
      }
      if (endIdx < 0) endIdx = turn.length - 1;
      radii.sort((a, b) => a - b);
      const arc = Math.abs(wrap(dirs[endIdx] - d0));
      const chord = hyp(turn[endIdx][F.px] - turn[109][F.px], turn[endIdx][F.pz] - turn[109][F.pz]);
      results.turn = {
        entrySpeed: r(turn[109][F.speed]),
        medianCurvatureRadius: r(radii[Math.floor(radii.length / 2)] ?? NaN),
        minCurvatureRadius: r(radii[0] ?? NaN),
        arcDeg: r((arc * 180) / Math.PI, 1),
        turn85Seconds: r((endIdx - 110) * STEP),
        chord: r(chord),
        chordRadius: r(chord / (2 * Math.sin(arc / 2))),
        exitSpeed: r(turn[endIdx][F.speed]),
        speedKeptThroughTurn: r(turn[endIdx][F.speed] / turn[109][F.speed]),
        peakSpeedInTurn: r(Math.max(...turn.slice(110, endIdx + 1).map((s) => s[F.speed]))),
      };
    }

    // 180° reversal — the pivot case
    const reverse = await run(deckAt(20, -5), 220, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
      { step: 110, code: "KeyW", down: false },
      { step: 110, code: "KeyS", down: true },
    ]);
    {
      let flip = -1;
      for (let i = 111; i < reverse.length; i++) {
        if (reverse[i][F.vz] > 0.5 && reverse[i][F.speed] > 1) { flip = i; break; }
      }
      let minSpeed = Infinity, minAt = -1;
      for (let i = 110; i < Math.min(reverse.length, 190); i++) {
        if (reverse[i][F.speed] < minSpeed) { minSpeed = reverse[i][F.speed]; minAt = i; }
      }
      results.reversal = {
        secondsToReverse: flip > 0 ? r((flip - 110) * STEP) : null,
        minSpeedDuringPivot: r(minSpeed),
        minSpeedAtSeconds: r((minAt - 110) * STEP),
        lateralExcursion: r(Math.abs(reverse[Math.min(flip + 20, reverse.length - 1)][F.px] - reverse[109][F.px])),
      };
    }

    // ---------------------------------------------------------------- 6. slopes
    const rampX = [-14.8, -7.4, 0, 7.4, 14.8];
    const rampDeg = [10, 20, 30, 40, 52];
    const rise = 3;
    results.slopes = [];
    for (let i = 0; i < rampDeg.length; i++) {
      const runLen = rise / Math.tan((rampDeg[i] * Math.PI) / 180);
      const baseZ = 30 - runLen;
      const rows = await run(deckAt(rampX[i], baseZ - 5), 190, [
        { step: 0, code: "KeyS", down: true },
        { step: 0, code: "ShiftLeft", down: true },
      ]);
      let maxSlope = 0, onSlopeSpeed = [], sawSlide = false, maxY = -Infinity;
      for (const s of rows) {
        if (s[F.slope] > maxSlope) maxSlope = s[F.slope];
        if (s[F.slope] > rampDeg[i] * 0.7) onSlopeSpeed.push(s[F.speed]);
        if (s[F.sliding] === 1) sawSlide = true;
        if (s[F.py] > maxY) maxY = s[F.py];
      }
      onSlopeSpeed.sort((a, b) => a - b);
      results.slopes.push({
        angleDeg: rampDeg[i],
        climbed: r(maxY - rows[0][F.py]),
        reachedTop: maxY - rows[0][F.py] > rise - 0.25,
        medianSpeedOnSlope: r(onSlopeSpeed[Math.floor(onSlopeSpeed.length / 2)] ?? 0),
        maxSlopeSeen: r(maxSlope, 1),
        slid: sawSlide,
      });
    }

    // ---------------------------------------------------------------- 7. step-up
    const flightZ = [-11.5, -4.5, 4.5, 11.5];
    const riser = [0.25, 0.5, 0.7, 0.9]; // must match PROVING_GROUND.stairRisers
    results.stepUp = [];
    for (let i = 0; i < riser.length; i++) {
      const rows = await run(deckAt(-19, flightZ[i]), 190, [{ step: 0, code: "KeyA", down: true }]);
      let maxY = -Infinity;
      for (const s of rows) if (s[F.py] > maxY) maxY = s[F.py];
      results.stepUp.push({
        riser: riser[i],
        climbed: r(maxY - rows[0][F.py]),
        stepsCleared: Math.round((maxY - rows[0][F.py]) / riser[i]),
      });
    }

    // ---------------------------------------------------------------- 8. landings
    results.landings = [];
    for (const h of [1.5, 3, 5, 8, 14]) {
      const rows = await run({ x: 20, y: DECK + STAND + h, z: -10 }, 120, []);
      let landAt = -1;
      for (let i = 2; i < rows.length; i++) if (rows[i][F.grounded] === 1) { landAt = i; break; }
      const s = rows[Math.min(landAt + 1, rows.length - 1)];
      results.landings.push({
        dropMetres: h,
        impact: r(s[F.landImpact]),
        landLock: r(s[F.lock]),
        squash: r(s[F.squash]),
        state: s[F.state],
      });
    }
    // sprinting into a hard landing: how much speed does it cost?
    const hardLand = await run({ x: 20, y: DECK + STAND + 7, z: -5 }, 160, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
    ]);
    {
      let landAt = -1;
      for (let i = 2; i < hardLand.length; i++) if (hardLand[i][F.grounded] === 1) { landAt = i; break; }
      results.landings.push({
        dropMetres: 7,
        moving: true,
        speedBefore: r(hardLand[landAt - 1][F.speed]),
        speedAfter: r(hardLand[landAt][F.speed]),
        impact: r(hardLand[landAt][F.landImpact]),
        landLock: r(hardLand[landAt][F.lock]),
        recoveredAfterSeconds: r(
          ((hardLand.findIndex((s, i) => i > landAt && s[F.lock] === 0) - landAt) || 0) * STEP
        ),
      });
    }

    // ---------------------------------------------------------------- 9. determinism / rate independence
    const seq = [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "ShiftLeft", down: true },
      { step: 30, code: "Space", down: true },
      { step: 42, code: "Space", down: false },
      { step: 60, code: "KeyD", down: true },
      { step: 90, code: "KeyW", down: false },
    ];
    const a1 = await run(deckAt(20, 6), 150, seq);
    const a2 = await run(deckAt(20, 6), 150, seq);
    const coarse = await d.run(({ spawn, events, steps }) => {
      const vs = window.__vs;
      const S = vs.kernel.signals;
      const ALL = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space", "ControlLeft"];
      const key = (code, down) =>
        window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true }));
      for (const c of ALL) key(c, false);
      vs.advance(1 / 60, { render: false });
      S.emit("player:spawn", { position: spawn });
      vs.advance(1 / 60, { render: false });
      const byStep = new Map();
      for (const e of events) {
        if (!byStep.has(e.step)) byStep.set(e.step, []);
        byStep.get(e.step).push(e);
      }
      // Two simulation steps per advance() — the same game time delivered in bigger slices.
      for (let i = 0; i < steps; i += 2) {
        for (const s of [i, i + 1]) {
          const es = byStep.get(s);
          if (es) for (const e of es) key(e.code, e.down);
        }
        vs.advance(2 / 60, { render: false });
      }
      const p = vs.probe("locomotion");
      for (const c of ALL) key(c, false);
      return p.position;
    }, { spawn: deckAt(20, 6), events: seq, steps: 150 });

    const endA = a1.at(-1), endB = a2.at(-1);
    results.determinism = {
      repeatIdentical: endA[F.px] === endB[F.px] && endA[F.py] === endB[F.py] && endA[F.pz] === endB[F.pz],
      position: [r(endA[F.px], 4), r(endA[F.py], 4), r(endA[F.pz], 4)],
      halfRateSlicesPosition: coarse.map((v) => r(v, 4)),
      halfRateDrift: r(
        Math.hypot(coarse[0] - endA[F.px], coarse[1] - endA[F.py], coarse[2] - endA[F.pz]), 5
      ),
    };

    // ---------------------------------------------------------------- 10. wall + corner sanity
    // Sprint straight into a 90° inside corner: the classic case where resolving one plane
    // re-penetrates the other. Success is "never inside either box, y never pops, speed is
    // spent against the wall rather than teleported away".
    const corner = await run(deckAt(-30, 30), 120, [
      { step: 0, code: "KeyW", down: true },
      { step: 0, code: "KeyA", down: true },
      { step: 0, code: "ShiftLeft", down: true },
    ]);
    {
      const boxes = [
        { x0: -40, x1: -31, z0: 24, z1: 25.2 },
        { x0: -40, x1: -38.8, z0: 24, z1: 33 },
      ];
      let worst = 0;
      for (const s of corner) {
        for (const b of boxes) {
          const dx = Math.min(s[F.px] - b.x0, b.x1 - s[F.px]);
          const dz = Math.min(s[F.pz] - b.z0, b.z1 - s[F.pz]);
          if (dx > 0 && dz > 0) worst = Math.max(worst, Math.min(dx, dz));
        }
      }
      const tail = corner.slice(-40);
      const last = corner.at(-1);
      results.corner = {
        finalPosition: [r(last[F.px]), r(last[F.py]), r(last[F.pz])],
        deepestPenetration: r(worst, 4),
        penetrated: worst > 0.02,
        finalSpeed: r(last[F.speed]),
        yRangeLast40: r(Math.max(...tail.map((s) => s[F.py])) - Math.min(...tail.map((s) => s[F.py])), 4),
        groundedThroughout: corner.every((s) => s[F.grounded] === 1),
      };
    }

    results.collision = await d.probe("collision");
    results.errors = d.consoleErrors.slice(0, 6);
  });

  const file = path.resolve(ROOT, outFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  report(results);
  console.log(`\nwrote ${outFile}`);
}

function report(m) {
  const row = (k, v, note = "") => console.log(`| ${k.padEnd(34)} | ${String(v).padStart(12)} | ${note}`);
  console.log("\n=== P04 movement, measured ===");
  row("time to 90% sprint (8.3 m/s)", `${m.acceleration.sprint90} s`);
  row("time to 99% sprint", `${m.acceleration.sprint99} s`);
  row("time to 90% run (5.6 m/s)", `${m.acceleration.run90} s`);
  row("stop from sprint — distance", `${m.stopping.fromSprint.distance} m`, `${m.stopping.fromSprint.seconds} s`);
  row("stop from run — distance", `${m.stopping.fromRun.distance} m`, `${m.stopping.fromRun.seconds} s`);
  row("jump apex (full hold)", `${m.jump.full.apexHeight} m`, `airtime ${m.jump.full.airtime} s`);
  row("jump apex (8-frame hold)", `${m.jump.medium.apexHeight} m`, `airtime ${m.jump.medium.airtime} s`);
  row("jump apex (1-frame tap)", `${m.jump.tap.apexHeight} m`, `airtime ${m.jump.tap.airtime} s`);
  row("sprint jump distance", `${m.jump.sprinting.distance} m`, `speed kept ${m.jump.sprinting.speedKept}`);
  row("coyote window observed", `${m.coyote.observedSeconds} s`, `tunable ${m.coyote.tunable} s`);
  row("buffered jump observed", `${m.jumpBuffer.observedSeconds} s`, `tunable ${m.jumpBuffer.tunable} s`);
  row("turn radius (curvature)", `${m.turn.medianCurvatureRadius} m`, `chord fit ${m.turn.chordRadius} m`);
  row("85° turn time at sprint", `${m.turn.turn85Seconds} s`, `speed kept ${m.turn.speedKeptThroughTurn}`);
  row("180° reversal", `${m.reversal.secondsToReverse} s`, `min speed ${m.reversal.minSpeedDuringPivot} m/s`);
  console.log("\n-- slopes --");
  for (const s of m.slopes) {
    row(`${s.angleDeg}° ramp`, s.reachedTop ? "climbed" : s.slid ? "slid" : "stalled",
      `${s.medianSpeedOnSlope} m/s, rose ${s.climbed} m`);
  }
  console.log("\n-- step-up (assisted lift 0.5 m) --");
  for (const s of m.stepUp) row(`${s.riser} m riser`, `${s.climbed} m`, `${s.stepsCleared} steps`);
  console.log("\n-- landings --");
  for (const l of m.landings) {
    if (l.moving) row(`${l.dropMetres} m drop, sprinting`, `${l.speedBefore}→${l.speedAfter} m/s`, `lock ${l.landLock}s`);
    else row(`${l.dropMetres} m drop`, `impact ${l.impact}`, `lock ${l.landLock}s squash ${l.squash} (${l.state})`);
  }
  console.log("\n-- determinism --");
  row("repeat run identical", m.determinism.repeatIdentical);
  row("drift at 2× slice size", `${m.determinism.halfRateDrift} m`);
  row("inside corner penetration", `${m.corner.deepestPenetration} m`, `y range ${m.corner.yRangeLast40} m, grounded ${m.corner.groundedThroughout}`);
  row("collider triangles", m.collision.triangles, `${m.collision.cells} grid cells`);
  if (m.errors?.length) console.log("\nCONSOLE ERRORS:", m.errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
