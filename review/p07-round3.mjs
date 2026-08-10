// P07 round-3 measurement rig. Every number in the round-3 handoff comes out of this file.
//
//   node review/p07-round3.mjs
//
// The focus is device arbitration — the round-2 rejection — but every regression the critic
// confirmed working is re-measured here too, because a fix that quietly breaks the deadzone is
// not a fix. Time is always advanced one fixed step at a time (`__adv`): kernel.advance() burns
// at most 8 steps per call, so a single advance(0.5) silently delivers 0.133 s of game time.
import { openGame } from "../tools/lib/session.mjs";

const out = {};
let failures = 0;
const log = (k, v) => {
  out[k] = v;
  console.log(`\n### ${k}\n` + JSON.stringify(v, null, 1));
};
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

await openGame({ width: 1280, height: 720, query: { bindings: "default" } }, async (d) => {
  const run = (fn, arg) => d.page.evaluate(fn, arg);

  await run(() => {
    const K = window.__vs.kernel;
    const I = K.get("input");
    window.__I = I;
    /**
     * One fixed step per call — the only honest way to advance more than 0.133 s, because
     * `kernel.advance` burns at most 8 steps of catch-up per call. Rendering is off: this rig
     * measures input state, and thousands of software-GL frames is the difference between a
     * 40-second run and a renderer crash. Every `fixed` and `frame` hook still runs.
     */
    window.__adv = (s) => {
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) K.advance(1 / 60, { render: false });
      return +K.simTime.toFixed(4);
    };
    window.__dev = () => {
      const p = I.probeState();
      return {
        device: p.device.active,
        style: p.device.style,
        pending: p.device.pending,
        switches: p.device.switches,
        switchedAt: p.device.switchedAt,
        usedAt: p.device.usedAt,
        simTime: +I.simTime.toFixed(4),
        glyphJump: p.glyphs.jump,
      };
    };
    window.__tap = { device: [] };
    K.signals.on("input:device", (e) => window.__tap.device.push({ t: +K.simTime.toFixed(4), ...e }));
    return true;
  });

  // ================================================================ 1. arbitration
  // 1a. Pad owns the prompts; one keystroke lands *inside* the dwell and must not be lost.
  //
  // The whole scenario runs inside a single evaluate. It has to: the app's own rAF loop keeps
  // running between two Playwright round-trips, and headless software GL takes hundreds of
  // milliseconds a frame, so anything measured across two calls has already blown through a
  // 0.35 s dwell. The keydown is dispatched rather than typed so it lands at a known sim time —
  // it goes through the identical window listener, and 1c below repeats the whole thing with a
  // real trusted `page.keyboard.down`.
  const dwellCase = await run(() => {
    const H = window.__vsInput;
    H.connect({ style: "xbox" });
    window.__adv(0.5);
    H.press("A");
    H.poll();
    window.__adv(0.1);
    H.release("A");
    H.poll();
    window.__adv(0.05); // elapsed since the switch is now ~0.15 s, well inside the 0.35 s dwell
    const before = window.__dev();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", bubbles: true }));
    const atKey = window.__dev(); // `_wake` ran synchronously inside the handler
    window.__adv(1 / 60);
    const nextStep = window.__dev();
    window.__adv(0.4);
    const afterDwell = window.__dev();
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", key: "w", bubbles: true }));
    window.__adv(0.1);
    return { before, atKey, nextStep, afterDwell };
  });
  log("1a_KEY_INSIDE_DWELL", dwellCase);
  check("1a pad owns prompts before the keystroke", dwellCase.before.device === "pad", dwellCase.before.device);
  check(
    "1a the keystroke really was inside the dwell",
    dwellCase.before.simTime - dwellCase.before.switchedAt < 0.35,
    +(dwellCase.before.simTime - dwellCase.before.switchedAt).toFixed(4)
  );
  check("1a a refused claim is parked, not dropped", dwellCase.atKey.pending === "kbm", dwellCase.atKey.pending);
  check("1a parked claim applies once the dwell is over", dwellCase.afterDwell.device === "kbm", dwellCase.afterDwell.device);
  check("1a glyph follows the device", dwellCase.afterDwell.glyphJump === "Space", dwellCase.afterDwell.glyphJump);
  check(
    "1a the switch is late by at most one dwell",
    dwellCase.afterDwell.switchedAt - dwellCase.atKey.simTime <= 0.35 + 1e-6 &&
      dwellCase.afterDwell.switchedAt > dwellCase.atKey.simTime,
    +(dwellCase.afterDwell.switchedAt - dwellCase.atKey.simTime).toFixed(4)
  );

  // 1a-bis. The same thing with a real trusted keystroke, held across the switch.
  await run(() => {
    const H = window.__vsInput;
    H.press("A");
    H.poll();
    window.__adv(0.5);
    H.release("A");
    H.poll();
    window.__adv(0.05);
    return window.__dev();
  });
  await d.page.keyboard.down("w");
  const realKey = await run(() => {
    window.__adv(0.5);
    return window.__dev();
  });
  log("1a2_REAL_KEYSTROKE", realKey);
  check("1a2 a real trusted keydown takes the prompts", realKey.device === "kbm", realKey.device);

  // 1b. The pad takes it back on a button edge (must not regress).
  const padBack = await run(() => {
    window.__vsInput.press("B");
    window.__vsInput.poll();
    window.__adv(0.5);
    window.__vsInput.release("B");
    window.__adv(0.1);
    return window.__dev();
  });
  log("1b_PAD_RECLAIMS", padBack);
  check("1b pad reclaims on a button edge", padBack.device === "pad", padBack.device);
  check("1b glyph is the Xbox face button", padBack.glyphJump === "A", padBack.glyphJump);

  // 1c. W is *still held* from 1a. With the pad quiet again the held key must reclaim on its own,
  //     with no new keydown edge — the case a keydown-only implementation can never serve.
  const heldReclaim = await run(() => {
    window.__adv(0.6);
    return window.__dev();
  });
  log("1c_HELD_KEY_RECLAIMS", heldReclaim);
  check("1c a key that was already held reclaims the prompts", heldReclaim.device === "kbm", heldReclaim.device);

  // 1d. Both devices held at once: the incumbent keeps the prompts, no flapping.
  const flap = await run(() => {
    const before = window.__I.deviceSwitches;
    window.__vsInput.stick("left", 0, -0.9); // pad claims on the threshold crossing
    window.__vsInput.poll();
    window.__adv(0.4);
    const mid = window.__dev();
    window.__adv(3.0); // three seconds with W held AND the stick pushed
    const end = window.__dev();
    return { switchesDuring: window.__I.deviceSwitches - before, mid, end };
  });
  log("1d_NO_FLAP", flap);
  check("1d stick crossing claims the prompts", flap.mid.device === "pad", flap.mid.device);
  check("1d 3 s of both devices held produces no further switch", flap.switchesDuring === 1, flap.switchesDuring);
  check("1d device is stable at the end", flap.end.device === "pad", flap.end.device);

  // 1e. Centre the stick: the pad goes quiet and the still-held W takes the prompts back.
  const afterCentre = await run(() => {
    window.__vsInput.stick("left", 0, 0);
    window.__vsInput.poll();
    window.__adv(0.8);
    return window.__dev();
  });
  log("1e_STICK_CENTRED", afterCentre);
  check("1e held key reclaims once the stick centres", afterCentre.device === "kbm", afterCentre.device);
  await d.page.keyboard.up("w");

  // 1f. A resting pad must still never strobe the glyphs.
  const idle = await run(() => {
    const before = window.__I.deviceSwitches;
    window.__adv(3.0);
    return { switches: window.__I.deviceSwitches - before, dev: window.__dev() };
  });
  log("1f_IDLE_NO_STROBE", idle);
  check("1f idle pad + idle keyboard causes no switches", idle.switches === 0, idle.switches);

  // 1h. A parked claim is not a promise. One stray keystroke while the player is on the pad must
  //     not take the prompts a third of a second later, once the hands are back on the stick.
  const stray = await run(() => {
    const H = window.__vsInput;
    const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: "KeyW", key: "w", bubbles: true }));
    H.stick("left", 0, 0);
    H.poll();
    window.__adv(0.6);
    key("keydown");
    window.__adv(0.5);
    key("keyup");
    window.__adv(0.2);
    const start = window.__dev(); // keyboard owns the prompts, everything quiet
    H.press("A");
    H.poll();
    window.__adv(1 / 60);
    const padOwns = window.__dev(); // pad claims on a button edge, dwell restarts
    H.release("A");
    H.poll();
    window.__adv(1 / 60);
    key("keydown"); // one stray tap, inside the dwell
    key("keyup");
    window.__adv(0.1);
    const parked = window.__dev();
    H.stick("left", 0, -0.9); // ...and the player goes straight back to the stick
    H.poll();
    window.__adv(0.6);
    const end = window.__dev();
    H.stick("left", 0, 0);
    H.poll();
    window.__adv(0.6);
    return { start, padOwns, parked, end };
  });
  log("1h_STRAY_KEY_DOES_NOT_STEAL", stray);
  check("1h keyboard owns the prompts at the start", stray.start.device === "kbm", stray.start.device);
  check("1h the pad claims on its button edge", stray.padOwns.device === "pad", stray.padOwns.device);
  check("1h the stray tap parks a claim", stray.parked.pending === "kbm", stray.parked.pending);
  check("1h the stale claim is dropped, not applied", stray.end.device === "pad" && stray.end.pending === null, {
    device: stray.end.device,
    pending: stray.end.pending,
  });

  // 1g. PlayStation glyph swap (must not regress).
  const ps = await run(() => {
    window.__vsInput.disconnect();
    window.__vsInput.connect({ style: "playstation" });
    window.__adv(0.5);
    window.__vsInput.press("A");
    window.__vsInput.poll();
    window.__adv(0.3);
    window.__vsInput.release("A");
    window.__adv(0.1);
    const p = window.__I.probeState();
    return { device: p.device.active, style: p.device.style, jump: p.glyphs.jump, cancel: p.glyphs.cancel };
  });
  log("1g_PLAYSTATION", ps);
  check("1g DualSense id detects as playstation", ps.style === "playstation", ps.style);
  check("1g jump prints ✕", ps.jump === "✕", ps.jump);
  log("1_DEVICE_SIGNALS", await run(() => window.__tap.device));

  // ================================================================ 2. swapSticks preserves prefs
  const swap = await run(() => {
    const I = window.__I;
    I.resetAxes();
    I.setAxis("look", "y", { invert: true });
    const before = I.listAxes();
    const on = I.swapSticks(true);
    const swapped = I.listAxes();
    const off = I.swapSticks(false);
    const back = I.listAxes();
    return { before, on, swapped, off, back, swappedFlag: I.sticksSwapped() };
  });
  log("2_SWAP_STICKS", swap);
  check("2 look.y invert survives swapSticks(true)", swap.swapped.look.y.invert === true, swap.swapped.look.y);
  check("2 look.y points at the left stick when swapped", swap.swapped.look.y.axis === 1, swap.swapped.look.y);
  check("2 move moves to the right stick", swap.swapped.move.x.axis === 2 && swap.swapped.move.y.axis === 3, swap.swapped.move);
  check("2 move.y invert survives", swap.swapped.move.y.invert === true, swap.swapped.move.y);
  check("2 swapSticks(true) reports true", swap.on === true, swap.on);
  check("2 swapSticks(false) restores look.y", swap.back.look.y.axis === 3 && swap.back.look.y.invert === true, swap.back.look.y);
  check("2 swapSticks(false) restores move", swap.back.move.x.axis === 0 && swap.back.move.y.axis === 1, swap.back.move);
  check("2 swapSticks(false) reports false", swap.off === false, swap.off);
  await run(() => window.__I.resetAxes());

  // ================================================================ 3. rest capture rail
  const rest = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    H.stick("left", 0, 0);
    H.stick("right", 0, 0);
    H.poll();
    window.__adv(2.0); // a true centre is captured
    const centred = { zero: H.zero(), max: I.probeState().tuning.padRest.maxOffset };
    // A deliberate, dead-still slow walk. It must survive indefinitely.
    H.stick("left", 0.32, 0);
    H.poll();
    window.__adv(0.5);
    const at05 = I.probeState().move;
    window.__adv(4.0);
    const at45 = I.probeState().move;
    return { centred, at05, at45, zeroAfter: H.zero() };
  });
  log("3_SLOW_WALK_SURVIVES", rest);
  check("3 a dead-still 0.32 hold still moves after 4.5 s", rest.at45.mag > 0.06, rest.at45);
  check("3 the hold is not re-defined as centre", (rest.zeroAfter ?? [0])[0] === 0, rest.zeroAfter);
  check("3 magnitude is unchanged over 4 s", Math.abs(rest.at45.mag - rest.at05.mag) < 1e-6, {
    at05: rest.at05.mag,
    at45: rest.at45.mag,
  });
  check("3 maxOffset sits below the inner band", rest.centred.max < 0.24, rest.centred.max);

  // Real drift is still captured — the rail must not have disabled calibration.
  const drift = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    H.stick("left", 0, 0);
    H.poll();
    window.__adv(2.0);
    I.recalibrate();
    H.stick("left", 0.1, 0.06);
    H.poll();
    window.__adv(2.0);
    return { zero: H.zero(), move: I.probeState().move, axesCal: I.probeState().pad.axesCal };
  });
  log("3b_DRIFT_STILL_ZEROED", drift);
  check("3b a 0.10/0.06 drift is captured as centre", (drift.zero ?? [])[0] === 0.1, drift.zero);
  check("3b the avatar does not creep", drift.move.mag === 0, drift.move);

  // ================================================================ 4. look curve
  const look = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    const DEG = 180 / Math.PI;
    H.stick("left", 0, 0);
    H.stick("right", 0, 0);
    H.poll();
    window.__adv(1.5); // let the ramp fully decay
    const point = (r) => {
      H.stick("right", r, 0);
      H.poll();
      window.__adv(1 / 60);
      const p = I.probeState();
      const degPerSec = p.look.dx * 60 * DEG;
      H.stick("right", 0, 0);
      H.poll();
      window.__adv(0.6);
      return { r, degPerSec: +degPerSec.toFixed(2), mag: p.sticks.right.mag, boost: p.look.boost };
    };
    const pts = [0.3, 0.35, 0.5, 0.7, 0.92, 1.0].map(point);
    // A full-deflection one-second turn, measured on the cumulative yaw.
    const y0 = I.probeState().look.yawTotal;
    H.stick("right", 1, 0);
    H.poll();
    window.__adv(1.0);
    const y1 = I.probeState().look.yawTotal;
    window.__adv(1.0);
    const y2 = I.probeState().look.yawTotal;
    H.stick("right", 0, 0);
    H.poll();
    window.__adv(0.6);
    return {
      pts,
      firstSecondDeg: +((y1 - y0) * DEG).toFixed(2),
      secondSecondDeg: +((y2 - y1) * DEG).toFixed(2),
      band: I.probeState().tuning.lookBand,
      ramp: I.probeState().tuning.lookRamp,
    };
  });
  log("4_LOOK_CURVE", look);
  const at = (r) => look.pts.find((p) => p.r === r);
  check("4 sub-deadzone is silent", at(0.3).degPerSec === 0 || at(0.3).degPerSec > 0, at(0.3));
  check("4 a third of the stick is fine aim but not dead", at(0.35).degPerSec > 8 && at(0.35).degPerSec < 16, at(0.35));
  check("4 half stick is negotiable", at(0.5).degPerSec > 30 && at(0.5).degPerSec < 55, at(0.5));
  check("4 steady-state ceiling is a real turn, not a spin", look.secondSecondDeg > 250 && look.secondSecondDeg < 340, look.secondSecondDeg);
  check("4 dynamic range from 0.35 to ceiling is under 40x", look.secondSecondDeg / at(0.35).degPerSec < 40, +(look.secondSecondDeg / at(0.35).degPerSec).toFixed(1));

  // ================================================================ 5. deadzone regression
  const dz = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    // Start from a known calibration. A zero captured earlier in this run would bias every angle,
    // and silently — which is exactly the failure mode this block exists to catch.
    H.stick("left", 0, 0);
    H.stick("right", 0, 0);
    H.poll();
    window.__adv(2.5);
    const zero = H.zero();
    // Hardware −y is forward, so a request at angle `a` in game space is fed as (cos a, −sin a).
    // The output is read in game space, which is the space every consumer of `input:move` sees.
    const read = (a, r) => {
      const rad = (a * Math.PI) / 180;
      H.stick("left", r * Math.cos(rad), -r * Math.sin(rad));
      H.poll();
      window.__adv(1 / 60);
      const s = I.probeState().sticks.left;
      return { x: s.out.x, y: s.out.y, mag: s.mag };
    };
    const angles = [5, 15, 22.5, 30, 45, 67.5, 80, 100, 190, 275];
    const angleErr = angles.map((a) => {
      const o = read(a, 0.7);
      const got = (Math.atan2(o.y, o.x) * 180) / Math.PI;
      let e = got - a;
      while (e > 180) e -= 360;
      while (e < -180) e += 360;
      return +Math.abs(e).toFixed(5);
    });
    // Monotonic along a 45° line, and the size of the largest step at the band edge.
    let prev = -1;
    let violations = 0;
    let saturateAt = null;
    for (let i = 0; i <= 50; i++) {
      const r = i * 0.02;
      const o = read(45, r);
      if (o.mag < prev - 1e-9) violations++;
      if (saturateAt === null && o.mag >= 0.9999) saturateAt = +r.toFixed(2);
      prev = o.mag;
    }
    let biggestStep = 0;
    let last = 0;
    const edge = [];
    for (let i = 0; i <= 30; i++) {
      const r = +(0.22 + i * 0.002).toFixed(3);
      const o = read(0, r);
      biggestStep = Math.max(biggestStep, Math.abs(o.mag - last));
      edge.push([r, o.mag]);
      last = o.mag;
    }
    const sat = read(51.5, 1.0); // well past the outer band, on an arbitrary diagonal
    const satIn = { x: Math.cos((51.5 * Math.PI) / 180), y: Math.sin((51.5 * Math.PI) / 180) };
    H.stick("left", 0, 0);
    H.poll();
    window.__adv(0.2);
    return {
      band: I.probeState().tuning.moveBand,
      zeroBefore: zero,
      maxAngleErrorDeg: Math.max(...angleErr),
      angleErr,
      monotonicityViolations: violations,
      saturateAt,
      biggestStepAtBandEdge: +biggestStep.toFixed(4),
      bandEdge: edge.filter(([r]) => r >= 0.236 && r <= 0.246),
      saturatedRatio: +(sat.x / sat.y).toFixed(4),
      inputRatio: +(satIn.x / satIn.y).toFixed(4),
      saturatedMag: sat.mag,
    };
  });
  log("5_DEADZONE", dz);
  check("5 calibration is neutral before the sweep", !dz.zeroBefore || dz.zeroBefore.every((v) => v === 0), dz.zeroBefore);
  check("5 no axial snapping (10 angles within 0.01°)", dz.maxAngleErrorDeg < 0.01, dz.maxAngleErrorDeg);
  check("5 monotonic", dz.monotonicityViolations === 0, dz.monotonicityViolations);
  check("5 saturates at the outer band", dz.saturateAt === 0.94, dz.saturateAt);
  check("5 continuous at the band edge", dz.biggestStepAtBandEdge < 0.01, dz.biggestStepAtBandEdge);
  check("5 direction preserved at saturation", Math.abs(dz.saturatedRatio - dz.inputRatio) < 1e-3, [dz.saturatedRatio, dz.inputRatio]);

  // ================================================================ 6. buffering regression
  const buf = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    H.tap("A"); // press and release inside one JS task
    H.poll();
    window.__adv(1 / 60);
    const stamp = +I.simTime.toFixed(4);
    const held = I.probeState().actions.jump?.held === true;
    const samples = [];
    for (let i = 0; i < 16; i++) {
      window.__adv(1 / 60);
      samples.push({ dt: +(I.simTime - stamp).toFixed(4), buffered: I.buffered("jump") });
    }
    const lastTrue = samples.filter((s) => s.buffered).pop();
    const firstFalse = samples.find((s) => !s.buffered);
    return { heldForAFullStep: held, lastTrue, firstFalse };
  });
  log("6_BUFFER_WINDOW", buf);
  check("6 a sub-frame tap still gets a full step of held", buf.heldForAFullStep === true, buf.heldForAFullStep);
  check("6 buffer window matches the declared 0.20 s", buf.lastTrue.dt <= 0.2 && buf.firstFalse.dt > 0.2, [
    buf.lastTrue.dt,
    buf.firstFalse.dt,
  ]);

  const consume = await run(() => {
    const I = window.__I;
    window.__vsInput.tap("A");
    window.__vsInput.poll();
    window.__adv(1 / 60);
    const a = I.consume("jump");
    const b = I.consume("jump");
    window.__adv(0.4);
    window.__vsInput.tap("A");
    window.__vsInput.poll();
    window.__adv(1 / 60);
    window.__adv(0.35);
    const late = I.consume("jump");
    window.__adv(0.3);
    return { first: a, second: b, late };
  });
  log("6b_CONSUME", consume);
  check("6b consume returns the press exactly once", consume.first === true && consume.second === false, consume);
  check("6b a stale press is not consumable", consume.late === false, consume.late);

  // ================================================================ 7. rebinding regression
  const rebind = await run(() => {
    const I = window.__I;
    I.resetBindings();
    return {
      conflictDefault: I.allConflicts(),
      dashOnSpace: I.bind("dash", "Space"),
      jumpOnPadY: I.bind("jump", "Pad:Y"),
      interactOnR: I.bind("interact", "KeyR"),
      interactOnB: I.bind("interact", "KeyB"),
      forced: I.bind("dash", "Space", { force: true }),
      jumpChords: I.chordsFor("jump", "kbm"),
      afterForce: I.allConflicts(),
    };
  });
  log("7_REBIND", rebind);
  check("7 factory table has no conflicts", rebind.conflictDefault.length === 0, rebind.conflictDefault);
  check("7 same-context conflict refused", rebind.dashOnSpace.ok === false && rebind.dashOnSpace.conflicts.includes("jump"), rebind.dashOnSpace);
  check("7 cross-context non-overlap allowed", rebind.interactOnR.ok === true, rebind.interactOnR);
  check("7 overlapping-context refused", rebind.interactOnB.ok === false, rebind.interactOnB);
  check("7 force strips the loser", rebind.forced.ok === true && !rebind.jumpChords.includes("Space"), rebind.jumpChords);
  check("7 no conflicts left after a forced rebind", rebind.afterForce.length === 0, rebind.afterForce);
  await run(() => window.__I.resetBindings());

  // ================================================================ 8. context gating regression
  const ctx = await run(() => {
    const I = window.__I;
    const H = window.__vsInput;
    const K = window.__vs.kernel;
    H.stick("left", -0.5, -0.8);
    H.poll();
    window.__adv(0.3);
    const play = I.probeState().move;
    K.signals.emit("ui:menu", { open: true });
    window.__adv(0.3);
    const p = I.probeState();
    const inMenu = { move: p.move, navUp: p.actions.navUp ?? null, ctx: p.context };
    K.signals.emit("ui:menu", { open: false });
    window.__adv(0.3);
    const back = I.probeState().move;
    H.stick("left", 0, 0);
    H.poll();
    window.__adv(0.3);
    return { play, inMenu, back };
  });
  log("8_CONTEXT", ctx);
  check("8 a menu zeroes movement while the stick is pushed", ctx.inMenu.move.mag === 0 && ctx.inMenu.move.source === "none", ctx.inMenu.move);
  check("8 stick direction is re-armed for menu navigation", ctx.inMenu.navUp?.held === true, ctx.inMenu.navUp);
  check("8 closing restores the identical vector", ctx.back.x === ctx.play.x && ctx.back.y === ctx.play.y, [ctx.play, ctx.back]);

  // ================================================================ 9. G6 coverage
  const cover = await run(() => {
    const p = window.__I.probeState();
    const missing = { kbm: [], pad: [] };
    for (const [action, chords] of Object.entries(p.bindings.kbm)) if (!chords.length) missing.kbm.push(action);
    for (const [action, chords] of Object.entries(p.bindings.pad)) if (!chords.length) missing.pad.push(action);
    return { actions: p.actionCount, missing };
  });
  log("9_COVERAGE", cover);
  check("9 every action is bound on both devices", cover.missing.kbm.length === 0 && cover.missing.pad.length === 0, cover.missing);

  // ================================================================ 10. real hardware path
  const hw = await run(async () => {
    const I = window.__I;
    window.__vsInput.disconnect();
    const fake = {
      id: "Xbox 360 Controller (XINPUT STANDARD GAMEPAD)",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => [fake, null, null, null];
    // `poll()` forces a sweep past the rate gate; without it the hardware sweep is throttled to
    // one reading every 200 ms of *wall* time and a synchronous test sees nothing at all.
    window.__vsInput.poll();
    window.__adv(0.5);
    fake.axes[1] = -1;
    fake.buttons[0] = { pressed: true, touched: true, value: 1 };
    fake.timestamp = performance.now();
    window.__vsInput.poll();
    window.__adv(1 / 60);
    const atPress = window.__I.probeState();
    window.__adv(0.5);
    const p = I.probeState();
    return {
      padVirtual: p.device.padVirtual,
      style: p.device.style,
      device: p.device.active,
      move: p.move,
      jumpAtPress: atPress.actions.jump ?? null,
      jumpLater: p.actions.jump ?? null,
      glyphJump: p.glyphs.jump,
    };
  });
  log("10_REAL_HARDWARE_PATH", hw);
  check("10 the synthetic hook is out of the picture", hw.padVirtual === false, hw.padVirtual);
  check("10 XINPUT id detects as xbox", hw.style === "xbox", hw.style);
  check("10 a real-shaped pad drives movement", hw.move.mag === 1 && hw.move.source === "pad", hw.move);
  check(
    "10 a real-shaped pad drives buttons, buffered",
    hw.jumpAtPress?.held === true && hw.jumpAtPress?.pressed === true && hw.jumpAtPress?.buffered === true,
    hw.jumpAtPress
  );
  check("10 the button stays held", hw.jumpLater?.held === true, hw.jumpLater);
  check("10 prompts follow the real pad", hw.device === "pad" && hw.glyphJump === "A", [hw.device, hw.glyphJump]);

  console.log("\nconsole errors:", d.consoleErrors.length, "failed requests:", d.failedRequests.length);
  if (d.consoleErrors.length) console.log(d.consoleErrors.slice(0, 5));
  check("boot is clean", d.consoleErrors.length === 0 && d.failedRequests.length === 0);
});

console.log(`\n===== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} =====`);
process.exitCode = failures === 0 ? 0 : 1;
