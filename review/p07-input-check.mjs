#!/usr/bin/env node
// P07 measurement battery. Drives the real app in a real browser and reports numbers, not vibes.
//
//   node review/p07-input-check.mjs [--out=review/shots/p07/input-report.json]
//
// Everything here runs against the mounted `input` system through the same public surface a
// gameplay module would use, plus the documented `window.__vsInput` test hook for the gamepad
// paths Playwright cannot reach with real hardware.

import fs from "node:fs";
import path from "node:path";
import { openGame, arg, ROOT } from "../tools/lib/session.mjs";

const OUT = arg("out", "review/shots/p07/input-report.json");

/** Installed once per page: a signal tape so we can prove what was emitted, not just what is true. */
const TAPE = () => {
  const g = globalThis;
  g.__p07 = { yaw: 0, pitch: 0, look: 0, move: [], actions: [], devices: [] };
  const s = g.__vs.kernel.signals;
  s.on("input:look", (e) => {
    g.__p07.yaw += e.dx;
    g.__p07.pitch += e.dy;
    g.__p07.look++;
  });
  s.on("input:move", (e) => g.__p07.move.push([e.x, e.y, e.device]));
  s.on("input:action", (e) => g.__p07.actions.push(`${e.action}:${e.phase}${e.repeat ? ":rep" : ""}`));
  s.on("input:device", (e) => g.__p07.devices.push(`${e.kind}/${e.style}`));
  return true;
};

const reset = () => {
  const g = globalThis;
  g.__p07.yaw = 0;
  g.__p07.pitch = 0;
  g.__p07.look = 0;
  g.__p07.move.length = 0;
  g.__p07.actions.length = 0;
  g.__p07.devices.length = 0;
  return true;
};

const results = {};
const failures = [];
const near = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures.push(`${label}: got ${got}, want ${want} ±${tol}`);
  return ok;
};
const truth = (label, ok) => {
  if (!ok) failures.push(label);
  return ok;
};

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(0.5);
  await d.run(TAPE);

  // ------------------------------------------------------------------ 1. keyboard move vector
  await d.page.keyboard.down("KeyW");
  await d.play(0.2);
  const fwd = await d.run(() => {
    const i = __vs.kernel.get("input");
    return { x: i.move.x, y: i.move.y, mag: i.moveMag, src: i.moveSource };
  });
  await d.page.keyboard.down("KeyD");
  await d.play(0.2);
  const diag = await d.run(() => {
    const i = __vs.kernel.get("input");
    return { x: i.move.x, y: i.move.y, mag: i.moveMag };
  });
  await d.page.keyboard.up("KeyW");
  await d.page.keyboard.up("KeyD");
  await d.play(0.2);
  const idle = await d.run(() => ({ mag: __vs.kernel.get("input").moveMag }));

  results.keyboardMove = { forward: fwd, diagonal: diag, released: idle };
  near("kbm forward y", fwd.y, 1, 1e-6);
  near("kbm forward x", fwd.x, 0, 1e-6);
  near("kbm diagonal x", diag.x, Math.SQRT1_2, 1e-4);
  near("kbm diagonal magnitude (must not be 1.41x)", diag.mag, 1, 1e-4);
  near("kbm released", idle.mag, 0, 1e-9);

  // ------------------------------------------------------------------ 2. tap survives one frame
  await d.run(reset);
  // Two harness hazards to defuse before a frame-exact measurement of a *trusted* key press:
  //
  //   1. The app is in realtime mode, so its own animation loop is advancing the simulation in
  //      the background. Any wall-clock gap between the press and our sampling loop would let
  //      that loop consume the press first and we would be measuring the harness, not the game.
  //      `halt()` stops the loop; `advance()` still drives the fixed clock by hand.
  //   2. Playwright's input pipeline is not ordered against Runtime.evaluate, so we wait for the
  //      page to actually observe the keyup before sampling.
  await d.run(() => {
    __vs.kernel.halt();
    globalThis.__p07.keySeen = 0;
    window.addEventListener("keyup", (e) => e.code === "Space" && globalThis.__p07.keySeen++, { once: true });
    return true;
  });
  await d.page.keyboard.press("Space"); // down and up land in the same rendered frame
  await d.page.waitForFunction(() => globalThis.__p07.keySeen > 0, { timeout: 15000 });
  const tap = await d.run(() => {
    const i = __vs.kernel.get("input");
    const rows = [];
    for (let n = 0; n < 12; n++) {
      __vs.advance(1 / 60);
      rows.push({
        held: i.held("jump"),
        pressed: i.pressed("jump"),
        released: i.released("jump"),
        buffered: i.buffered("jump"),
      });
    }
    return { rows, tape: globalThis.__p07.actions.slice() };
  });
  await d.run(() => {
    __vs.kernel.run();
    return true;
  });
  const heldSteps = tap.rows.filter((r) => r.held).length;
  const pressSteps = tap.rows.filter((r) => r.pressed).length;
  const bufferedSteps = tap.rows.filter((r) => r.buffered).length;
  results.tap = { heldSteps, pressSteps, bufferedSteps, tape: tap.tape };
  truth("a press+release inside one frame must still produce a held step", heldSteps >= 1);
  truth("a press+release inside one frame must produce exactly one press edge", pressSteps === 1);
  truth("jump buffer must survive ~12 steps (0.20 s)", bufferedSteps >= 11);

  // ------------------------------------------------------------------ 3. buffering + consumption
  await d.run(reset);
  const buffer = await d.run(() => {
    const i = __vs.kernel.get("input");
    const step = (n) => {
      for (let k = 0; k < n; k++) __vs.advance(1 / 60);
    };
    const fire = () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    };
    const out = {};
    // Pressed during someone else's recovery, consumed 8 steps later: must still fire.
    fire();
    step(8);
    out.lateConsume = i.consume("jump");
    out.doubleConsume = i.consume("jump"); // a press may only be spent once
    // Pressed and left to expire past the window: must NOT fire.
    fire();
    step(20);
    out.expiredConsume = i.consume("jump");
    // Explicit window override, for a verb with a longer recovery than the default.
    fire();
    step(20);
    out.wideWindowConsume = i.consume("jump", 0.5);
    return out;
  });
  results.buffering = buffer;
  truth("a press 0.13 s old is still consumable", buffer.lateConsume === true);
  truth("a consumed press cannot be consumed twice", buffer.doubleConsume === false);
  truth("a press older than the window is gone", buffer.expiredConsume === false);
  truth("an explicit window widens the buffer", buffer.wideWindowConsume === true);

  // ------------------------------------------------------------------ 4. stick response curve
  await d.run(reset);
  const curve = await d.run(() => {
    const i = __vs.kernel.get("input");
    const rows = [];
    for (const r of [0, 0.05, 0.11, 0.12, 0.13, 0.2, 0.35, 0.5, 0.7, 0.85, 0.94, 1]) {
      __vsInput.set({ axes: { lx: r, ly: 0 } });
      __vs.advance(1 / 60);
      rows.push({ r, out: Number(i.moveMag.toFixed(4)), source: i.moveSource });
    }
    __vsInput.clear();
    __vs.advance(1 / 60);
    return rows;
  });
  results.deadzoneCurve = curve;
  const at = (r) => curve.find((c) => c.r === r)?.out;
  truth("inner deadzone is silent", at(0.11) === 0 && at(0.05) === 0);
  truth("just past the inner band the stick answers", at(0.13) > 0);
  near("outer band saturates at 1", at(0.94), 1, 1e-6);
  near("full deflection stays at 1", at(1), 1, 1e-6);

  // ------------------------------------------------------------------ 5. no axial snapping
  const angles = await d.run(() => {
    const i = __vs.kernel.get("input");
    const rows = [];
    for (const deg of [5, 15, 22.5, 30, 45, 60, 75, 85]) {
      const a = (deg * Math.PI) / 180;
      // 0.7 magnitude: mid-throw, where a per-axis deadzone would do the most damage.
      __vsInput.set({ axes: { lx: Math.cos(a) * 0.7, ly: -Math.sin(a) * 0.7 } });
      __vs.advance(1 / 60);
      const outDeg = (Math.atan2(i.move.y, i.move.x) * 180) / Math.PI;
      rows.push({ deg, outDeg: Number(outDeg.toFixed(4)), errDeg: Number((outDeg - deg).toFixed(6)) });
    }
    __vsInput.clear();
    __vs.advance(1 / 60);
    return rows;
  });
  results.diagonalPurity = angles;
  const worst = Math.max(...angles.map((a) => Math.abs(a.errDeg)));
  results.diagonalWorstErrorDeg = worst;
  truth(`direction must survive the deadzone (worst error ${worst}°)`, worst < 1e-3);

  // ------------------------------------------------------------------ 6. pad look + ramp
  await d.run(reset);
  const look = await d.run(() => {
    const i = __vs.kernel.get("input");
    __vsInput.stick("right", 1, 0);
    const marks = [];
    let yaw = 0;
    let firstDegPerSec = 0;
    for (let n = 0; n < 60; n++) {
      __vs.advance(1 / 60);
      yaw += i.look.dx;
      if (n === 0) firstDegPerSec = Number(((i.look.dx * 60 * 180) / Math.PI).toFixed(1));
      if ((n + 1) % 10 === 0) {
        marks.push({
          t: Number(((n + 1) / 60).toFixed(3)),
          boost: Number(i.lookBoost.toFixed(3)),
          degPerSec: Number(((i.look.dx * 60 * 180) / Math.PI).toFixed(1)),
        });
      }
    }
    // Half stick: the squared curve must make it far slower than half speed.
    __vsInput.stick("right", 0, 0);
    for (let n = 0; n < 40; n++) __vs.advance(1 / 60);
    __vsInput.stick("right", 0.5, 0);
    __vs.advance(1 / 60);
    const half = (i.look.dx * 60 * 180) / Math.PI;
    // Pitch must be slower than yaw, and inversion must be honoured.
    __vsInput.stick("right", 0, 1);
    __vs.advance(1 / 60);
    const pitchDown = i.look.dy;
    __vsInput.clear();
    __vs.advance(1 / 60);
    return {
      totalYawDeg: Number(((yaw * 180) / Math.PI).toFixed(2)),
      firstStepDegPerSec: firstDegPerSec,
      marks,
      halfStickDegPerSec: Number(half.toFixed(1)),
      pitchDownSign: Math.sign(pitchDown),
    };
  });
  results.padLook = look;
  truth("look ramps up while the stick is pinned", look.marks[0].degPerSec < look.marks.at(-1).degPerSec);
  near("look starts at the unboosted base rate", look.firstStepDegPerSec, 186, 3);
  near("look tops out near base × boost", look.marks.at(-1).degPerSec, 410, 25);
  truth("half stick is well under half speed (squared curve)", look.halfStickDegPerSec < 90);
  truth("stick down pitches down", look.pitchDownSign === 1);

  // ------------------------------------------------------------------ 7. mouse look, both paths
  // Unlocked first, on purpose: the "auto" look mode stops honouring an unlocked pointer once a
  // real lock has ever happened, so simulating a lock would poison this measurement.
  await d.run(reset);
  await d.look(200, 0);
  const mouseUnlocked = await d.run(() => ({
    yawRad: Number(globalThis.__p07.yaw.toFixed(5)),
    events: globalThis.__p07.look,
    device: __vs.kernel.get("input").device,
    lockedPath: false,
  }));
  results.mouseLookUnlocked = mouseUnlocked;
  near("200 px of unlocked pointer = 0.44 rad of yaw", mouseUnlocked.yawRad, 0.44, 0.02);
  truth("unlocked mouse look emits input:look", mouseUnlocked.events > 0);

  await d.run(reset);
  const mouseLocked = await d.run(() => {
    const i = __vs.kernel.get("input");
    __vsInput.pointerLock(true);
    __vsInput.mouse(100, 0); // movementX path, the one a locked pointer really uses
    __vs.advance(1 / 60);
    const dx = i.look.dx;
    __vsInput.mouse(0, 60);
    __vs.advance(1 / 60);
    const dy = i.look.dy;
    const out = { dxRad: Number(dx.toFixed(6)), dyRad: Number(dy.toFixed(6)), lockedPath: true };
    // Inversion is a preference, not a code path: flip it and the same gesture must mirror.
    __vs.kernel.config.set("invertY", true);
    __vsInput.mouse(0, 60);
    __vs.advance(1 / 60);
    out.invertedDyRad = Number(i.look.dy.toFixed(6));
    __vs.kernel.config.set("invertY", false);
    __vs.kernel.config.set("lookSensitivity", 2);
    __vsInput.mouse(100, 0);
    __vs.advance(1 / 60);
    out.doubleSensDxRad = Number(i.look.dx.toFixed(6));
    __vs.kernel.config.set("lookSensitivity", 1);
    __vsInput.pointerLock(false);
    return out;
  });
  results.mouseLookLocked = mouseLocked;
  near("100 px of locked mouse = 0.22 rad of yaw", mouseLocked.dxRad, 0.22, 1e-6);
  near("60 px of locked mouse = 0.132 rad of pitch", mouseLocked.dyRad, 0.132, 1e-6);
  near("invertY mirrors pitch", mouseLocked.invertedDyRad, -0.132, 1e-6);
  near("sensitivity 2 doubles the yaw", mouseLocked.doubleSensDxRad, 0.44, 1e-6);

  // ------------------------------------------------------------------ 8. device switching
  await d.run(reset);
  const device = await d.run(() => {
    const i = __vs.kernel.get("input");
    const out = { start: i.device };
    __vsInput.connect({ style: "playstation" });
    __vsInput.press("A");
    __vs.advance(1 / 60);
    out.afterPad = i.device;
    out.padStyle = i.padStyle;
    out.jumpGlyph = i.glyph("jump").text;
    out.padJumpHeld = i.held("jump");
    __vsInput.release("A");
    __vs.advance(1 / 60);
    __vsInput.connect({ style: "xbox" });
    __vsInput.press("A");
    __vs.advance(1 / 60);
    out.xboxGlyph = i.glyph("jump").text;
    __vsInput.release("A");
    __vs.advance(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    __vs.advance(1 / 60);
    out.afterKey = i.device;
    out.kbmJumpGlyph = i.glyph("jump").text;
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    __vs.advance(1 / 60);
    __vsInput.disconnect();
    __vs.advance(1 / 60);
    out.tape = globalThis.__p07.devices.slice();
    return out;
  });
  results.deviceSwitch = device;
  truth("first pad input switches the active device", device.afterPad === "pad");
  truth("a pad button really presses the action", device.padJumpHeld === true);
  truth("PlayStation pad shows a cross for jump", device.jumpGlyph === "✕");
  truth("Xbox pad shows A for jump", device.xboxGlyph === "A");
  truth("a keystroke switches back", device.afterKey === "kbm");
  truth("input:device was emitted for both", device.tape.length >= 2);

  // ------------------------------------------------------------------ 9. contexts
  await d.run(reset);
  const context = await d.run(() => {
    const i = __vs.kernel.get("input");
    const out = {};
    __vsInput.connect({ style: "xbox" });
    __vsInput.press("RT");
    __vs.advance(1 / 60);
    out.playPrimary = i.held("primary");
    out.playBuildPlace = i.held("buildPlace");
    out.triggerValue = Number(i.value("primary").toFixed(3));
    __vsInput.release("RT");
    __vs.advance(1 / 60);
    i.setContext("build");
    __vsInput.press("RT");
    __vs.advance(1 / 60);
    out.buildPrimary = i.held("primary");
    out.buildPlace = i.held("buildPlace");
    __vsInput.release("RT");
    __vs.advance(1 / 60);
    // Holding a play action and then opening a menu must not strand it.
    i.setContext("play");
    __vsInput.stick("left", 0, -1);
    __vsInput.press("A");
    __vs.advance(1 / 60);
    out.beforeMenu = { jump: i.held("jump"), confirm: i.held("confirm") };
    __vs.kernel.signals.emit("ui:menu", { id: "test", open: true });
    __vs.advance(1 / 60);
    out.contextInMenu = i.context;
    out.strandedJump = i.held("jump");
    out.menuMove = Number(i.moveMag.toFixed(3));
    out.menuStickStillDeflected = i.sticks.left.mag > 0.9;
    // A pad is polled, so release and press need a poll between them — exactly as on hardware.
    __vsInput.release("A");
    __vs.advance(1 / 60);
    __vsInput.press("A");
    __vs.advance(1 / 60);
    out.menuConfirm = i.held("confirm");
    __vsInput.release("A");
    __vs.kernel.signals.emit("ui:menu", { id: "test", open: false });
    __vsInput.clear();
    __vs.advance(1 / 60);
    out.contextAfter = i.context;
    return out;
  });
  results.contexts = context;
  truth("RT is primary in play", context.playPrimary === true && context.playBuildPlace === false);
  truth("RT is place in build", context.buildPlace === true && context.buildPrimary === false);
  near("trigger reports its analog value", context.triggerValue, 1, 1e-6);
  truth("opening a menu releases the held play action", context.strandedJump === false);
  truth("movement is dead while a menu is open", context.menuMove === 0);
  truth("the probe still reports the real stick while movement is gated", context.menuStickStillDeflected === true);
  truth("the bottom face button confirms in a menu", context.menuConfirm === true);
  truth("closing the menu restores play", context.contextAfter === "play");

  // ------------------------------------------------------------------ 10. menu nav auto-repeat
  await d.run(reset);
  const repeat = await d.run(() => {
    const i = __vs.kernel.get("input");
    i.setContext("menu");
    __vsInput.connect({ style: "xbox" });
    __vsInput.stick("left", 0, -1); // stick promoted to a d-pad press
    let edges = 0;
    for (let n = 0; n < 90; n++) {
      __vs.advance(1 / 60);
      if (i.pressed("navUp")) edges++;
    }
    __vsInput.clear();
    __vs.advance(1 / 60);
    i.setContext("play");
    return { edgesIn1_5s: edges };
  });
  results.menuRepeat = repeat;
  truth("the left stick drives menu navigation with auto-repeat", repeat.edgesIn1_5s >= 8 && repeat.edgesIn1_5s <= 14);

  // ------------------------------------------------------------------ 11. gamepad reachability
  const coverage = await d.run(() => {
    const i = __vs.kernel.get("input");
    const table = i.listBindings();
    const gaps = [];
    for (const [action, chords] of Object.entries(table.pad)) {
      if (chords.length) continue;
      if (/^move(Forward|Back|Left|Right)$/.test(action)) continue; // the left stick covers these
      gaps.push(action);
    }
    return { gaps, padActions: Object.keys(table.pad).length, conflicts: i.allConflicts() };
  });
  results.padCoverage = coverage;
  truth(`every action is reachable on a pad (gaps: ${coverage.gaps.join(", ") || "none"})`, coverage.gaps.length === 0);
  truth("default bindings contain no context-overlapping conflicts", coverage.conflicts.length === 0);

  // ------------------------------------------------------------------ 12. rebinding + persistence
  const rebind = await d.run(() => {
    const i = __vs.kernel.get("input");
    const out = {};
    out.refused = i.bind("jump", "KeyE"); // KeyE is `interact`, and both are live in play
    out.jumpAfterRefusal = i.chordsFor("jump", "kbm");
    out.contextualOk = i.bind("buildRotate", "KeyE"); // build-only: not a real clash
    i.resetBindings("buildRotate");
    out.forced = i.bind("jump", "KeyE", { force: true });
    out.interactAfterForce = i.chordsFor("interact", "kbm");
    i.resetBindings();
    out.afterReset = i.chordsFor("jump", "kbm");
    out.padRebind = i.bind("dash", "Pad:LB", { force: true });
    out.dashPad = i.chordsFor("dash", "pad");
    return out;
  });
  results.rebinding = rebind;
  truth("a real conflict is refused", rebind.refused.ok === false && rebind.refused.conflicts.includes("interact"));
  truth("the refused bind changed nothing", !rebind.jumpAfterRefusal.includes("KeyE"));
  truth("a context-disjoint bind is allowed", rebind.contextualOk.ok === true);
  truth("forcing steals the chord from the loser", rebind.interactAfterForce.includes("KeyE") === false);
  truth("reset restores the factory table", rebind.afterReset.join() === "Space");
  truth("pad chords rebind too", rebind.dashPad.includes("Pad:LB"));

  // survives a reload
  await d.page.reload({ waitUntil: "load" });
  await d.page.waitForFunction(() => window.__vs && window.__vs.ready, { timeout: 60000 });
  const persisted = await d.run(() => {
    const i = __vs.kernel.get("input");
    const out = { dashPad: i.chordsFor("dash", "pad"), jump: i.chordsFor("jump", "kbm") };
    i.resetBindings();
    return out;
  });
  await d.run(TAPE); // the reload took the signal tape with it
  results.persistence = persisted;
  truth("a rebind survives a reload", persisted.dashPad.includes("Pad:LB"));
  truth("untouched actions come back at factory", persisted.jump.join() === "Space");

  // ------------------------------------------------------------------ 13. multi-chord holds
  const multi = await d.run(() => {
    const i = __vs.kernel.get("input");
    const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const step = () => __vs.advance(1 / 60);
    const out = {};
    key("ShiftLeft", "keydown");
    step();
    key("ShiftRight", "keydown");
    step();
    out.bothDown = i.held("sprint");
    key("ShiftLeft", "keyup");
    step();
    out.stillHeldOnOneRelease = i.held("sprint"); // the other shift is still down
    key("ShiftRight", "keyup");
    step();
    out.releasedOnLast = i.held("sprint");
    return out;
  });
  results.multiChord = multi;
  truth("two chords on one action: releasing one keeps it held", multi.stillHeldOnOneRelease === true);
  truth("releasing the last chord releases the action", multi.releasedOnLast === false);

  // ------------------------------------------------------------------ 14. raw edges, no reinterpretation
  // The input layer must report the hand, not the meaning. `holdToSprint` is a verb-level
  // preference owned by Locomotion; if this layer latched it too, the second tap would cancel
  // the first and sprint would stick on forever.
  await d.run(reset);
  const rawEdges = await d.run(() => {
    const i = __vs.kernel.get("input");
    const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const tap = () => {
      key("ShiftLeft", "keydown");
      __vs.advance(1 / 60);
      const down = i.held("sprint");
      key("ShiftLeft", "keyup");
      __vs.advance(1 / 60);
      return { down, up: i.held("sprint") };
    };
    const out = {};
    __vs.kernel.config.set("holdToSprint", false);
    out.toggleModeTap1 = tap();
    out.toggleModeTap2 = tap();
    __vs.kernel.config.set("holdToSprint", true);
    out.holdModeTap = tap();
    out.emitted = globalThis.__p07.actions.filter((a) => a.startsWith("sprint"));
    return out;
  });
  results.rawEdges = rawEdges;
  truth(
    "sprint reports the physical edges in both preference modes",
    rawEdges.toggleModeTap1.down === true &&
      rawEdges.toggleModeTap1.up === false &&
      rawEdges.toggleModeTap2.down === true &&
      rawEdges.toggleModeTap2.up === false &&
      rawEdges.holdModeTap.down === true &&
      rawEdges.holdModeTap.up === false
  );
  truth("every physical edge reaches the signal bus", rawEdges.emitted.length === 6);

  // ------------------------------------------------------------------ 14b. it composes
  // The real proof that this piece plays: drive the mounted neighbours through input alone.
  const composed = await d.run(() => {
    const before = __vs.probe("locomotion");
    __vsInput.connect({ style: "xbox" });
    __vsInput.stick("left", 0, -1); // full forward on the pad, no keyboard involved
    for (let n = 0; n < 90; n++) __vs.advance(1 / 60);
    const running = __vs.probe("locomotion");
    __vsInput.press("A"); // jump
    for (let n = 0; n < 12; n++) __vs.advance(1 / 60);
    const jumped = __vs.probe("locomotion");
    __vsInput.clear();
    for (let n = 0; n < 60; n++) __vs.advance(1 / 60);
    const camBefore = __vs.probe("camera")?.yawDeg ?? __vs.probe("camera")?.yaw ?? null;
    __vsInput.stick("right", 1, 0); // pad look
    for (let n = 0; n < 30; n++) __vs.advance(1 / 60);
    const camAfter = __vs.probe("camera")?.yawDeg ?? __vs.probe("camera")?.yaw ?? null;
    __vsInput.disconnect();
    __vs.advance(1 / 60);
    return {
      startSpeed: before?.speed ?? null,
      runSpeed: running?.speed ?? null,
      travelled: before && running ? Number(Math.hypot(running.position[0] - before.position[0], running.position[2] - before.position[2]).toFixed(2)) : null,
      airborneAfterJump: jumped ? jumped.grounded === false || jumped.verticalSpeed > 0 : null,
      camBefore,
      camAfter,
    };
  });
  results.composition = composed;
  truth("a gamepad stick alone drives the character controller", (composed.runSpeed ?? 0) > 1);
  truth("the character actually travels", (composed.travelled ?? 0) > 2);
  truth("the pad's bottom face button jumps", composed.airborneAfterJump === true);
  if (composed.camBefore !== null && composed.camAfter !== null) {
    truth("the pad's right stick turns the camera", Math.abs(composed.camAfter - composed.camBefore) > 0.5);
  }

  // ------------------------------------------------------------------ 15. per-step cost
  const cost = await d.run(() => {
    const i = __vs.kernel.get("input");
    __vsInput.connect({ style: "xbox" });
    __vsInput.set({ axes: { lx: 0.6, ly: -0.6, rx: 0.9 }, buttons: { RT: 0.9, A: 1 } });
    __vs.advance(1 / 60);
    const N = 4000;
    const t0 = performance.now();
    for (let n = 0; n < N; n++) i.fixed(1 / 60, i.simTime + 1 / 60);
    const busy = (performance.now() - t0) / N;
    __vsInput.disconnect();
    __vs.advance(1 / 60);
    const t1 = performance.now();
    for (let n = 0; n < N; n++) i.fixed(1 / 60, i.simTime + 1 / 60);
    const idle = (performance.now() - t1) / N;
    return { busyUsPerStep: Number((busy * 1000).toFixed(2)), idleUsPerStep: Number((idle * 1000).toFixed(2)) };
  });
  results.stepCost = cost;
  truth(`input costs well under the frame budget (${cost.busyUsPerStep} µs/step under load)`, cost.busyUsPerStep < 60);

  // ------------------------------------------------------------------ 16. tunable from Config
  const tunable = await d.run(() => {
    const i = __vs.kernel.get("input");
    const cfg = __vs.kernel.config;
    const out = {};
    __vsInput.connect({ style: "xbox" });
    cfg.set("stickMoveInner", 0.35);
    cfg.set("stickMoveExp", 1);
    __vsInput.set({ axes: { lx: 0.3, ly: 0 } });
    __vs.advance(1 / 60);
    out.insideWiderDeadzone = i.moveMag;
    __vsInput.set({ axes: { lx: 0.6, ly: 0 } });
    __vs.advance(1 / 60);
    out.linearAt0_6 = Number(i.moveMag.toFixed(4));
    out.band = i.probeState().tuning.moveBand;
    cfg.set("stickMoveInner", 0.12);
    cfg.set("stickMoveExp", 1.25);
    __vsInput.clear();
    __vs.advance(1 / 60);
    return out;
  });
  results.configTuning = tunable;
  truth("a wider deadzone from Config really widens it", tunable.insideWiderDeadzone === 0);
  near("exponent 1 gives a linear response", tunable.linearAt0_6, (0.6 - 0.35) / (0.94 - 0.35), 1e-3);

  // ------------------------------------------------------------------ 17. signal vocabulary
  await d.run(reset);
  const vocab = await d.run(() => {
    const i = __vs.kernel.get("input");
    __vsInput.connect({ style: "xbox" });
    __vsInput.set({ axes: { lx: 0.8, ly: -0.4 }, buttons: { A: 1 } });
    for (let n = 0; n < 6; n++) __vs.advance(1 / 60);
    __vsInput.set({ axes: { lx: 0, ly: 0 }, buttons: { A: 0 } });
    for (let n = 0; n < 6; n++) __vs.advance(1 / 60);
    __vsInput.disconnect();
    __vs.advance(1 / 60);
    const t = globalThis.__p07;
    return { moves: t.move.length, looks: t.look, actions: t.actions.slice(), firstMove: t.move[0], lastMove: t.move.at(-1) };
  });
  results.signals = vocab;
  truth("input:move is emitted on change and on return to rest", vocab.moves >= 2 && vocab.lastMove[0] === 0);
  truth("input:action carries both edges", vocab.actions.includes("jump:down") && vocab.actions.includes("jump:up"));

  // ------------------------------------------------------------------ report
  const report = await d.report();
  results.consoleErrors = d.consoleErrors;
  results.runtimeErrors = report.errors ?? [];
  truth("no console errors during the whole battery", d.consoleErrors.length === 0);
  truth("no runtime errors during the whole battery", (report.errors ?? []).length === 0);
});

const payload = { when: new Date().toISOString(), failures, results };
const outPath = path.resolve(ROOT, OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(JSON.stringify({ failures, out: OUT, checks: Object.keys(results).length }, null, 2));
if (failures.length) {
  console.error(`\nP07 CHECK FAILED — ${failures.length} problem(s)`);
  for (const f of failures) console.error("  x " + f);
  process.exit(1);
}
console.log("\nP07 CHECK PASSED");
