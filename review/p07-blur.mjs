#!/usr/bin/env node
// P07 round 4 — the blur/focus contract, measured.
//
//   node review/p07-blur.mjs
//
// Every case here is run with ZERO manual polls: no `__vsInput.poll()`, no `set()` after the
// event. Time is advanced one fixed step at a time inside a single `page.evaluate`, so no timer
// can fire in the gap — the only thing sampling the pad is `Input.fixed()`, which calls
// `_samplePad()` at the top of every step. That is precisely the path that used to re-latch the
// pad after a blur.
//
// Note on the clock: `kernel.advance(seconds)` caps its catch-up burst at 8 fixed steps
// (0.1333 s) so a hitch cannot spiral, so `advance(3)` does NOT advance three seconds. Long
// windows here are therefore loops of `advance(1/60)`.

import { openGame } from "../tools/lib/session.mjs";

/** Advance real game seconds: one fixed step per call, all inside one page task. */
const adv = (d, seconds) => d.play(seconds, 1 / 60);

const out = [];
const fails = [];
const eq = (label, got, want, tol = 0) => {
  const ok = typeof want === "number" ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  out.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
  if (!ok) fails.push(label);
  return ok;
};
const note = (label, v) => out.push(`      ${label}: ${JSON.stringify(v)}`);

/**
 * Advance `seconds` one fixed step at a time and report what INPUT did over the window.
 *
 * Position is the wrong instrument for this: this game has weight, and an avatar released at
 * 5.6 m/s keeps going for a moment and then settles on the slope it is standing on — with zero
 * input, on either device. `lookIntent` (the module's own cumulative `lookTotal.yaw`) and the
 * per-step maximum of `move.mag` are input-side numbers, so they are exactly zero or they are not.
 */
const window_ = (d, seconds) =>
  d.run((s) => {
    const p = () => window.__vs.probe("input");
    const start = p();
    const l0 = window.__vs.probe("locomotion").position;
    let maxMove = 0;
    let maxSpeed = 0;
    const n = Math.round(s * 60);
    for (let i = 0; i < n; i++) {
      window.__vs.advance(1 / 60);
      const q = p();
      if (q.move.mag > maxMove) maxMove = q.move.mag;
      const sp = window.__vs.probe("locomotion").speed;
      if (sp > maxSpeed) maxSpeed = sp;
    }
    const end = p();
    const l1 = window.__vs.probe("locomotion").position;
    return {
      maxMoveMag: maxMove,
      lookIntent: Number((end.look.yawTotal - start.look.yawTotal).toFixed(9)),
      pitchIntent: Number((end.look.pitchTotal - start.look.pitchTotal).toFixed(9)),
      edges: end.pad.edges - start.pad.edges,
      samples: end.pad.samples - start.pad.samples,
      held: end.held,
      maxSpeed: Number(maxSpeed.toFixed(4)),
      distance: Number(Math.hypot(l1[0] - l0[0], l1[2] - l0[2]).toFixed(4)),
    };
  }, seconds);

const snap = (d) =>
  d.run(() => {
    const i = window.__vs.probe("input");
    const c = window.__vs.probe("camera");
    const l = window.__vs.probe("locomotion");
    return {
      held: i.held,
      move: i.move,
      look: { yawTotal: i.look.yawTotal, source: i.look.source },
      sticks: { left: i.sticks.left.mag, right: i.sticks.right.mag },
      pad: { edges: i.pad.edges, samples: i.pad.samples, axesCal: i.pad.axesCal, latched: i.pad.latched, sticksDown: i.pad.sticksDown },
      focus: i.focus,
      device: { active: i.device.active, switches: i.device.switches },
      yaw: c.yaw,
      pos: l.position,
      speed: l.speed,
    };
  });

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);

  // ---------------------------------------------------------------- 1. pad, window blur
  await d.run(() => {
    window.__vsInput.connect({ style: "playstation" });
    window.__vsInput.stick("left", 0, -1); // full forward
    window.__vsInput.press("A");
    window.__vsInput.stick("right", 1, 0); // full right turn
  });
  await adv(d, 1.0);
  const before = await snap(d);
  note("1. before blur", { held: before.held, moveMag: before.move.mag, yaw: before.yaw, pos: before.pos });
  eq("1a. pad is driving before the blur", before.move.source, "pad");
  eq("1b. pad actions held before the blur", before.held.includes("moveForward") && before.held.includes("jump"), true);

  await d.run(() => window.dispatchEvent(new Event("blur")));
  const atBlur = await snap(d); // the probe on the very step of the blur, before any re-poll
  eq("1c. move zeroed on the blur step itself", atBlur.move.mag, 0);
  eq("1d. move source cleared on the blur step", atBlur.move.source, "none");
  eq("1e. held empty on the blur step", atBlur.held, []);
  eq("1f. focused flag false", atBlur.focus.focused, false);
  eq("1g. left stick view zeroed", atBlur.sticks.left, 0);
  eq("1h. right stick view zeroed", atBlur.sticks.right, 0);
  eq("1i. calibrated axes zeroed", atBlur.pad.axesCal, [0, 0, 0, 0]);
  eq("1j. pad latches cleared", atBlur.pad.latched, []);

  // 180 fixed steps, 180 `_samplePad` calls, zero manual polls: `fixed()` calls the sweep at the
  // top of every step, which is exactly the path that used to re-latch the pad.
  const padWindow = await window_(d, 3.0);
  note("1. the 3 s blurred window", padWindow);
  eq("1k. zero move intent at every one of 180 steps", padWindow.maxMoveMag, 0);
  eq("1l. zero look intent across the window", padWindow.lookIntent, 0);
  eq("1m. zero pitch intent across the window", padWindow.pitchIntent, 0);
  eq("1n. no pad edge was born", padWindow.edges, 0);
  eq("1o. the pad sweep never ran at all", padWindow.samples, 0);
  eq("1p. nothing held at the end", padWindow.held, []);
  const quiet1 = await snap(d);
  eq("1q. camera yaw is where the blur left it", Math.abs(quiet1.yaw - atBlur.yaw), 0, 1e-9);
  const padTotal = {
    travelled: Number(Math.hypot(quiet1.pos[0] - before.pos[0], quiet1.pos[2] - before.pos[2]).toFixed(4)),
    yawed: Number(Math.abs(quiet1.yaw - before.yaw).toFixed(4)),
  };
  note("1. total displacement over the whole blur (momentum + terrain settle, no input)", padTotal);

  // ---------------------------------------------------------------- 2. regaining focus
  const after3 = quiet1;
  const swBefore = after3.device.switches;
  await d.run(() => window.dispatchEvent(new Event("focus")));
  await adv(d, 0.05);
  const back = await snap(d);
  eq("2a. focus restored", back.focus.focused, true);
  eq("2b. still-held stick re-observed as move", back.move.mag > 0.9, true);
  eq("2c. still-held A re-latched exactly once", back.pad.latched, ["A"]);
  eq("2d. jump held again", back.held.includes("jump"), true);
  note("2. edges spent on the return", back.pad.edges - after3.pad.edges);
  note("2. device switches on the return", back.device.switches - swBefore);
  const resumed = await window_(d, 0.8);
  note("2. the 0.8 s after the return", resumed);
  eq("2e. move intent is back at full deflection", resumed.maxMoveMag > 0.99, true);
  eq("2f. the avatar is under power again", resumed.maxSpeed > 2, true);
  eq("2g. and is covering ground", resumed.distance > 0.4, true);

  // ---------------------------------------------------------------- 3. visibilitychange route
  await d.run(() => {
    window.__vsInput.stick("left", 0, -1);
    window.__vsInput.stick("right", 1, 0);
    window.__vsInput.press("A");
  });
  await adv(d, 0.5);
  const vBefore = await snap(d);
  eq("3a. pad driving again before hide", vBefore.move.mag > 0.9 && vBefore.move.source === "pad", true);
  await d.run(() => window.__vsInput.hidden(true));
  const vAt = await snap(d);
  eq("3b. hidden: held empty", vAt.held, []);
  eq("3c. hidden: move zero", vAt.move.mag, 0);
  const vWindow = await window_(d, 3.0);
  note("3. the 3 s hidden window", vWindow);
  eq("3d. hidden: zero move intent at every step", vWindow.maxMoveMag, 0);
  eq("3e. hidden: zero look intent", vWindow.lookIntent, 0);
  eq("3f. hidden: no pad edge was born", vWindow.edges, 0);
  eq("3g. hidden: the pad sweep never ran", vWindow.samples, 0);
  eq("3h. hidden: nothing held at the end", vWindow.held, []);
  const vAfter = await snap(d);
  eq("3i. hidden: camera yaw is where the hide left it", Math.abs(vAfter.yaw - vAt.yaw), 0, 1e-9);
  await d.run(() => window.__vsInput.hidden(false));
  await adv(d, 0.05);
  eq("3j. visible again restores the pad", (await snap(d)).move.mag > 0.9, true);

  // ---------------------------------------------------------------- 4. keyboard control case
  await d.run(() => {
    window.__vsInput.clear();
    window.__vsInput.stick("left", 0, 0);
    window.__vsInput.stick("right", 0, 0);
  });
  await adv(d, 0.4);
  await d.page.keyboard.down("KeyW");
  await adv(d, 1.0);
  const kBefore = await snap(d);
  eq("4a. keyboard held before blur", kBefore.held.includes("moveForward"), true);
  await d.run(() => window.dispatchEvent(new Event("blur")));
  const kWindow = await window_(d, 3.0);
  note("4. the 3 s blurred window, keyboard", kWindow);
  const kAfter = await snap(d);
  eq("4b. keyboard released by blur and stays released", kAfter.held, []);
  eq("4c. keyboard move zero", kAfter.move.mag, 0);
  eq("4d. keyboard: zero move intent at every step", kWindow.maxMoveMag, 0);
  eq("4e. keyboard: zero look intent", kWindow.lookIntent, 0);
  // The control that makes the pad numbers mean something: the pad's post-blur residual has to be
  // the same weight-and-terrain settle the keyboard has always had for the identical gesture, and
  // both have to be input-silent. The critic measured 11.2 m of pad travel here.
  const kbmTotal = Number(Math.hypot(kAfter.pos[0] - kBefore.pos[0], kAfter.pos[2] - kBefore.pos[2]).toFixed(4));
  note("4. keyboard total displacement over the same blur", kbmTotal);
  note("4. pad total displacement, for comparison", padTotal.travelled);
  eq("4f. pad and keyboard blur behave alike", Math.abs(padTotal.travelled - kbmTotal) < 1.5, true);
  await d.page.keyboard.up("KeyW");
  await d.run(() => window.dispatchEvent(new Event("focus")));
  await adv(d, 0.2);

  // ---------------------------------------------------------------- 5. mouse look while blurred
  await d.run(() => window.__vsInput.pointerLock(true));
  await adv(d, 0.1);
  const mBase = await snap(d);
  await d.run(() => window.__vsInput.mouse(400, 0));
  await adv(d, 0.1);
  const mMoved = await snap(d);
  eq("5a. locked mouse turns the camera", Math.abs(mMoved.yaw - mBase.yaw) > 0.5, true);
  await d.run(() => window.dispatchEvent(new Event("blur")));
  await d.run(() => window.__vsInput.mouse(400, 0));
  await adv(d, 0.2);
  const mBlur = await snap(d);
  eq("5b. blurred mouse move is ignored", Math.abs(mBlur.yaw - mMoved.yaw), 0, 1e-9);
  await d.run(() => window.dispatchEvent(new Event("focus")));

  // ---------------------------------------------------------------- 6. bind() capacity + unbound
  const rebind = await d.run(() => {
    const I = window.__vsInput;
    I.reset(); // factory table
    const a = I.bind("dash", "KeyJ"); // dash has 1 slot -> ok
    const b = I.bind("dash", "KeyK");
    const c = I.bind("dash", "KeyL"); // now 3 slots: KeyF, KeyJ, KeyK... plus KeyL?
    const full = I.bind("dash", "KeyM"); // 4th -> must be refused
    const after = window.__vs.probe("input").bindings.kbm.dash;
    const evicted = I.bind("dash", "KeyM", { evict: true });
    const slotted = I.bind("dash", "KeyN", { slot: 0 });
    return { a, b, c, full, after, chords: window.__vs.probe("input").bindings.kbm.dash, evicted, slotted };
  });
  note("6. dash after three binds", rebind.after);
  eq("6a. 4th chord refused", rebind.full.ok, false);
  eq("6b. refusal names the reason", rebind.full.reason, "slots-full");
  eq("6c. refusal reports the slot count", rebind.full.slots, 3);
  eq("6d. refusal changed nothing", rebind.after.includes("KeyM"), false);
  eq("6e. explicit evict succeeds", rebind.evicted.ok, true);
  eq("6f. evict dropped the oldest and kept 3", rebind.chords.length, 3);
  eq("6g. slot replace succeeds", rebind.slotted.ok, true);

  const unbound = await d.run(() => {
    const I = window.__vsInput;
    I.reset();
    const clean = window.__vs.probe("input").unbound;
    const forced = I.bind("dash", "Space", { force: true });
    const p = window.__vs.probe("input");
    return {
      clean,
      forced,
      unbound: p.unbound,
      jumpChords: p.bindings.kbm.jump,
      jumpGlyph: p.glyphs.jump,
      conflicts: p.conflicts,
    };
  });
  eq("7a. factory table has no unbound action", unbound.clean, []);
  eq("7b. force-bind reports what it stranded", unbound.forced.stranded, ["jump"]);
  eq("7c. probe surfaces the stranded action", unbound.unbound.some((u) => u.action === "jump" && u.device === "kbm"), true);
  eq("7d. and says it is not stranded on both devices", unbound.unbound.find((u) => u.action === "jump").both, false);
  eq("7e. conflicts is still empty (this is the other failure)", unbound.conflicts, []);
  note("7. jump on kbm after the force-bind", { chords: unbound.jumpChords, glyph: unbound.jumpGlyph });
  await d.run(() => window.__vsInput.reset());

  // ---------------------------------------------------------------- 8. regressions the critic confirmed
  const reg = await d.run(() => {
    const I = window.__vsInput;
    const probe = () => window.__vs.probe("input");
    // `sticks` is written by `_updateMove`, which runs in `fixed` — so every sample here polls the
    // pad and then advances exactly one simulation step before reading.
    const step = () => {
      I.poll();
      window.__vs.advance(1 / 60);
      return probe();
    };
    // radial deadzone: direction preservation at R = 0.75
    const angles = [0, 22.5, 45, 67.5, 90, 135, 180, 225, 300];
    const dirs = angles.map((deg) => {
      const r = (deg * Math.PI) / 180;
      I.stick("left", 0.75 * Math.cos(r), -0.75 * Math.sin(r));
      // `out` is already in move space (+y forward), which is the space the input angle was
      // written in, so this is a straight atan2 with no sign flip.
      const s = step().sticks.left.out;
      let a = (Math.atan2(s.y, s.x) * 180) / Math.PI;
      if (a < 0) a += 360;
      return { in: deg, out: Number(a.toFixed(4)), mag: Number(Math.hypot(s.x, s.y).toFixed(4)) };
    });
    // inner-band sweep
    const sweep = [];
    for (let r = 0.2; r <= 0.3001; r += 0.005) {
      I.stick("left", r, 0);
      sweep.push({ r: Number(r.toFixed(3)), mag: step().sticks.left.out.x });
    }
    I.stick("left", 0, 0);
    step();
    // trigger hysteresis
    const trig = [];
    for (const v of [0.3, 0.35, 0.3, 0.28, 0.25]) {
      I.press("RT", v);
      const st = step().actions.primary;
      trig.push({ v, held: !!st?.held, value: st?.value ?? 0 });
    }
    I.release("RT");
    step();
    return { dirs, sweep, trig, maxSlots: probe().tuning.maxSlots, triggerTuning: probe().tuning.trigger };
  });
  const worstAngle = Math.max(...reg.dirs.map((r) => Math.abs(((r.out - r.in + 540) % 360) - 180)));
  const mags = reg.dirs.map((r) => r.mag);
  eq("8a. direction preserved at every angle (deg error)", worstAngle, 0, 0.01);
  eq("8b. magnitude constant across angles", Math.max(...mags) - Math.min(...mags), 0, 1e-4);
  note("8. constant magnitude at R=0.75", mags[0]);
  const firstLive = reg.sweep.find((s) => s.mag > 0);
  eq("8c. deadzone is silent below the inner band", reg.sweep.filter((s) => s.r <= 0.24).every((s) => s.mag === 0), true);
  eq("8d. no step discontinuity at the band edge", firstLive.mag < 0.01, true);
  note("8. first live sample", firstLive);
  eq("8e. trigger latches at 0.35", reg.trig[1].held, true);
  eq("8f. trigger holds at 0.30 (hysteresis)", reg.trig[2].held, true);
  eq("8g. trigger releases below 0.28", reg.trig[4].held, false);
  note("8. trigger analog pass-through", reg.trig.map((t) => t.value));

  // buffering window, on the pad, step by step
  const buf = await d.run(async () => {
    const I = window.__vsInput;
    I.tap("A");
    window.__vs.advance(1 / 60);
    const first = window.__vs.probe("input").actions.jump;
    const marks = [];
    for (let i = 1; i <= 16; i++) {
      window.__vs.advance(1 / 60);
      const st = window.__vs.probe("input").actions.jump;
      marks.push({ t: Number((i / 60).toFixed(4)), buffered: !!st?.buffered });
    }
    return { first, marks };
  });
  const lastBuffered = buf.marks.filter((m) => m.buffered).at(-1);
  const firstNot = buf.marks.find((m) => !m.buffered);
  eq("9a. tap produced a press", !!buf.first?.pressed, true);
  note("9. buffer last true / first false", { lastBuffered, firstNot });
  // The window is 0.200 s and the simulation is quantized to 1/60 s, so the true boundary can only
  // ever be located to within one step; the transition must straddle 0.200, not land on it.
  eq("9b. buffer expires at 0.20 s (+/- one fixed step)", firstNot.t >= 0.2 - 1e-9 && firstNot.t <= 0.2 + 2 / 60, true);
  eq("9b'. and is still live just before it", lastBuffered.t < 0.2 + 1 / 60, true);
  const consumed = await d.run(() => {
    const inp = window.__vs.kernel?.get?.("input") ?? null;
    if (!inp) return null;
    window.__vsInput.tap("A");
    window.__vs.advance(1 / 60);
    return [inp.consume("jump"), inp.consume("jump")];
  });
  if (consumed) eq("9c. consume() returns true exactly once", consumed, [true, false]);

  // device arbitration: no strobe under a held stick
  const strobe = await d.run(() => {
    const I = window.__vsInput;
    I.stick("left", 0, -1);
    const before = window.__vs.probe("input").device.switches;
    for (let i = 0; i < 180; i++) {
      I.poll();
      window.__vs.advance(1 / 60);
    }
    const after = window.__vs.probe("input").device;
    I.stick("left", 0, 0);
    I.poll();
    return { delta: after.switches - before, device: after.active, style: after.style };
  });
  eq("10a. no device strobe under a held stick (180 polls)", strobe.delta, 0);
  note("10. device after the hold", strobe);

  // disconnect mid-hold
  const disc = await d.run(() => {
    const I = window.__vsInput;
    I.stick("left", 0, -1);
    I.press("A");
    I.poll();
    window.__vs.advance(1 / 30);
    const held = window.__vs.probe("input").held;
    I.disconnect();
    window.__vs.advance(1 / 30);
    const p = window.__vs.probe("input");
    return { held, after: p.held, move: p.move.mag };
  });
  eq("11a. held before disconnect", disc.held.length > 0, true);
  eq("11b. disconnect releases everything", disc.after, []);
  eq("11c. disconnect zeroes move", disc.move, 0);

  // ------------------------------------------------- 12. glyphs, southpaw, menus, context
  const ui = await d.run(() => {
    const I = window.__vsInput;
    const P = () => window.__vs.probe("input");
    // `advance` caps at 8 fixed steps per call, so real seconds have to be stepped.
    const sim = (s) => {
      for (let i = 0, n = Math.round(s * 60); i < n; i++) window.__vs.advance(1 / 60);
    };
    I.clear();
    I.stick("left", 0, 0);
    I.stick("right", 0, 0);
    I.poll();
    sim(0.5);
    const seen = [];
    const off = window.__vs.kernel.signals.on("input:device", (e) => seen.push(e));
    I.connect({ style: "playstation" });
    I.press("A");
    sim(0.1);
    I.release("A");
    sim(0.5);
    const padGlyphs = { jump: P().glyphs.jump, interact: P().glyphs.interact, menu: P().glyphs.menu };
    const padDevice = P().device.active;
    // menu auto-repeat on the stick
    I.context("menu");
    I.stick("left", 0, -1);
    I.poll();
    let repeats = 0;
    const offAct = window.__vs.kernel.signals.on("input:action", (e) => {
      if (e.action === "navUp" && e.phase === "down") repeats++;
    });
    sim(1.33);
    offAct();
    I.stick("left", 0, 0);
    I.poll();
    I.context("play");
    // southpaw + invert
    const sw = I.swapSticks(true);
    const axes = I.axes();
    I.swapSticks(false);
    const inv = I.setAxis("look", "y", { invert: true });
    I.setAxis("look", "y", { invert: false });
    off();
    return {
      deviceEvents: seen.length,
      lastDevice: seen.at(-1),
      padGlyphs,
      padDevice,
      repeats,
      swapped: sw,
      swappedAxes: [axes.move.x.axis, axes.move.y.axis, axes.look.x.axis, axes.look.y.axis],
      invert: inv,
    };
  });
  note("12. device events / glyphs", { events: ui.deviceEvents, last: ui.lastDevice, glyphs: ui.padGlyphs });
  eq("12a. pad claims the prompts", ui.padDevice, "pad");
  eq("12b. PlayStation glyphs", ui.padGlyphs, { jump: "✕", interact: "▢", menu: "Options" });
  eq("12c. stick auto-repeats in a menu", ui.repeats >= 6, true);
  note("12. navUp downs in 1.33 s", ui.repeats);
  eq("12d. southpaw permutes the axis map", ui.swappedAxes, [2, 3, 0, 1]);
  eq("12e. per-stick invert applies", ui.invert.map.invert, true);

  // ------------------------------------------------- 13. rebind survives a real reload
  await d.run(() => {
    window.__vsInput.reset();
    window.__vsInput.bind("dash", "KeyG");
  });
  await d.page.reload({ waitUntil: "load", timeout: 120000 });
  await d.page.waitForFunction(() => window.__vs && window.__vs.ready, { timeout: 90000 });
  await d.play(1.0);
  const persisted = await d.run(() => window.__vs.probe("input").bindings.kbm.dash);
  eq("13a. rebind survived a real page reload", persisted, ["KeyF", "KeyG"]);
  await d.page.keyboard.down("KeyG");
  await adv(d, 0.1);
  const dashHeld = await d.run(() => window.__vs.probe("input").held);
  await d.page.keyboard.up("KeyG");
  eq("13b. the persisted chord actually drives the action", dashHeld.includes("dash"), true);
  await d.run(() => window.__vsInput.reset());

  // ------------------------------------------------- 14. the return must not steal the prompts
  //
  // The case `_padRefInit = false` on focus gain exists for: a pad lying on the desk with a stick
  // resting at 0.30 — above `padWakeAxisDelta` (0.12) and above `padRest.maxOffset` (0.18), so it
  // is never auto-calibrated away — while the player is on the keyboard. Alt-tab and back must not
  // hand the glyphs to a controller nobody has touched.
  const drift = await d.run(() => {
    const I = window.__vsInput;
    const P = () => window.__vs.probe("input");
    const sim = (s) => {
      for (let i = 0, n = Math.round(s * 60); i < n; i++) window.__vs.advance(1 / 60);
    };
    I.disconnect();
    I.connect({ style: "xbox" });
    I.stick("left", 0.3, 0.0); // resting drift, nobody's thumb on it
    sim(0.5);
    // Put the keyboard in charge the way a player would.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    sim(0.6);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
    sim(0.4);
    const before = { device: P().device.active, switches: P().device.switches, glyph: P().glyphs.jump };
    window.dispatchEvent(new Event("blur"));
    sim(0.5);
    const blurred = { focused: P().focus.focused, samples: P().pad.samples };
    const forced = I.poll(); // an explicit forced poll while blurred must still do nothing
    const afterForce = P().pad.samples;
    window.dispatchEvent(new Event("focus"));
    sim(1.0);
    const after = { device: P().device.active, switches: P().device.switches, glyph: P().glyphs.jump };
    const wake = P().pad;
    I.stick("left", 0, 0);
    I.disconnect();
    return { before, blurred, forcedSamples: afterForce - blurred.samples, forced, after, axesRaw: wake.axesRaw };
  });
  note("14. before / after the alt-tab", drift);
  eq("14a. keyboard owned the prompts before", drift.before.device, "kbm");
  eq("14b. a forced poll while blurred samples nothing", drift.forcedSamples, 0);
  eq("14c. a drifting pad does not steal the prompts on return", drift.after.device, "kbm");
  eq("14d. and no switch was spent", drift.after.switches - drift.before.switches, 0);
  eq("14e. prompts still read as keyboard", drift.after.glyph, "Space");

  // ------------------------------------------------- 15. the focus signal
  const sig = await d.run(() => {
    const seen = [];
    const off = window.__vs.kernel.signals.on("input:focus", (e) => seen.push(e));
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur")); // idempotent: a second blur is not a second event
    window.dispatchEvent(new Event("focus"));
    off();
    return seen;
  });
  eq("15a. input:focus emits once per real transition", sig.length, 2);
  eq("15b. and names the direction", [sig[0].focused, sig[1].focused], [false, true]);
  note("15. input:focus payloads", sig);

  // ------------------------------------------------- 16. the 250 Hz timer path, across real tasks
  //
  // Everything above advances inside a single `page.evaluate`, so `setInterval` cannot fire — that
  // isolates `fixed()`'s sweep, but it also means the module's own 250 Hz timer was never given a
  // chance to walk through the gate. `d.play` issues one `evaluate` per 1/60 s, so the browser
  // gets ~120 real task boundaries here and the timer runs for its own reasons, unobserved.
  await d.run(() => {
    window.__vsInput.disconnect();
    window.__vsInput.connect({ style: "xbox" });
    window.__vsInput.stick("left", 0, -1);
    window.__vsInput.press("A");
  });
  await adv(d, 0.5);
  const tBefore = await snap(d);
  eq("16a. pad driving before the blur", tBefore.move.mag > 0.9, true);
  await d.run(() => window.dispatchEvent(new Event("blur")));
  const tAt = await snap(d);
  await d.play(2.0, 1 / 60); // 120 separate JS tasks; the real interval timer fires between them
  const tAfter = await snap(d);
  note("16. across ~120 real task boundaries", {
    samples: tAfter.pad.samples - tAt.pad.samples,
    edges: tAfter.pad.edges - tAt.pad.edges,
    held: tAfter.held,
    move: tAfter.move,
  });
  eq("16b. the timer's own sweeps are gated too", tAfter.pad.samples - tAt.pad.samples, 0);
  eq("16c. no edge across real task boundaries", tAfter.pad.edges - tAt.pad.edges, 0);
  eq("16d. still nothing held", tAfter.held, []);
  eq("16e. still no move", tAfter.move.mag, 0);
  await d.run(() => {
    window.dispatchEvent(new Event("focus"));
    window.__vsInput.disconnect();
  });
  await adv(d, 0.3);

  const report = await d.report();
  const problems = [];
  if (!report.ready) problems.push("app not ready");
  for (const e of report.errors ?? []) problems.push(`runtime error: ${e.split("\n")[0]}`);
  for (const e of d.consoleErrors) problems.push(`console error: ${e}`);
  for (const f of d.failedRequests) problems.push(`request failed: ${f}`);
  eq("17. clean console and no failed requests", problems, []);
});

console.log(out.join("\n"));
console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(", ")}` : "ALL PASS"}`);
process.exitCode = fails.length ? 1 : 0;
