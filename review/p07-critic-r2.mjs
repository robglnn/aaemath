// P07 critic, round 2 — independent verification. Written by the critic, not the builder.
// Every number here is regenerated from the live page; nothing is taken from a summary.
import { openGame } from "../tools/lib/session.mjs";

const out = [];
const log = (...a) => {
  const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  out.push(s);
  console.log(s);
};

await openGame({ width: 1280, height: 720 }, async (d) => {
  // ---------------------------------------------------------------- preflight
  const pre = await d.run(() => ({
    hasHook: typeof window.__vsInput === "object" && window.__vsInput !== null,
    hookKeys: Object.keys(window.__vsInput ?? {}),
    probeNames: window.__vs.probeNames(),
    systems: [...window.__vs.kernel.byName.keys()],
  }));
  log("PRE", pre);

  // ------------------------------------------------- T1 gamepad actually drives
  const t1 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const loco = () => window.__vs.probe("locomotion");
    const cam = () => window.__vs.probe("camera");
    H.connect({ style: "xbox" });
    H.poll();
    K.advance(0.2);
    const p0 = loco();
    const c0 = cam();
    // full forward on the left stick (standard gamepad: up = -1 on axis 1)
    H.stick("left", 0, -1);
    for (let i = 0; i < 120; i++) K.advance(1 / 60);
    const p1 = loco();
    const inp1 = window.__vs.probe("input");
    H.stick("left", 0, 0);
    // full right on the right stick
    H.stick("right", 1, 0);
    for (let i = 0; i < 60; i++) K.advance(1 / 60);
    const c1 = cam();
    const inp2 = window.__vs.probe("input");
    H.stick("right", 0, 0);
    return {
      posBefore: p0?.position ?? p0?.pos ?? null,
      posAfter: p1?.position ?? p1?.pos ?? null,
      locoKeys: p0 ? Object.keys(p0) : null,
      speedAfter: p1?.speed ?? null,
      inputSource: p1?.inputSource ?? null,
      moveProbe: inp1.move,
      yawBefore: c0?.yaw ?? null,
      yawAfter: c1?.yaw ?? null,
      camKeys: c0 ? Object.keys(c0) : null,
      lookProbe: inp2.look,
      device: inp2.device,
    };
  });
  log("T1_PAD_DRIVES", t1);

  // ---------------------------------------------------- T2 deadzone arithmetic
  const t2 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    H.recalibrate();
    const rows = [];
    // radial sweep along a 45-degree line, magnitude r
    for (let r = 0; r <= 1.0001; r += 0.02) {
      const c = Math.SQRT1_2 * r;
      H.stick("left", c, -c);
      H.poll();
      K.advance(1 / 60);
      const p = window.__vs.probe("input");
      rows.push({
        r: +r.toFixed(3),
        mag: p.move.mag,
        x: p.move.x,
        y: p.move.y,
        angleDeg: +((Math.atan2(p.move.y, p.move.x) * 180) / Math.PI).toFixed(3),
        zero: p.pad.zero,
      });
    }
    // fine sweep around the inner band edge
    const fine = [];
    for (let r = 0.22; r <= 0.28; r += 0.002) {
      const c = Math.SQRT1_2 * r;
      H.stick("left", c, -c);
      H.poll();
      K.advance(1 / 60);
      const p = window.__vs.probe("input");
      fine.push({ r: +r.toFixed(4), mag: p.move.mag });
    }
    // arbitrary shallow angles: does direction survive?
    const angles = [];
    for (const deg of [5, 15, 22.5, 30, 45, 67.5, 80, 100, 190, 275]) {
      const a = (deg * Math.PI) / 180;
      const r = 0.7;
      H.stick("left", Math.cos(a) * r, -Math.sin(a) * r);
      H.poll();
      K.advance(1 / 60);
      const p = window.__vs.probe("input");
      angles.push({
        want: deg,
        got: +((((Math.atan2(p.move.y, p.move.x) * 180) / Math.PI) + 360) % 360).toFixed(3),
        mag: p.move.mag,
      });
    }
    H.stick("left", 0, 0);
    H.poll();
    K.advance(1 / 60);
    return { rows, fine, angles, band: window.__vs.probe("input").tuning.moveBand };
  });
  const jumps = [];
  for (let i = 1; i < t2.rows.length; i++) {
    const dm = t2.rows[i].mag - t2.rows[i - 1].mag;
    if (dm < -1e-6) jumps.push({ kind: "non-monotonic", at: t2.rows[i].r, dm });
  }
  const fineJump = Math.max(...t2.fine.slice(1).map((f, i) => f.mag - t2.fine[i].mag));
  log("T2_BAND", t2.band);
  log("T2_SWEEP", t2.rows.filter((r, i) => i % 5 === 0 || r.r > 0.9));
  log("T2_FINE_EDGE", t2.fine);
  log("T2_FINE_MAX_STEP", fineJump.toFixed(6));
  log("T2_MONOTONIC_VIOLATIONS", jumps);
  log("T2_ANGLES", t2.angles);

  // ------------------------------------------------------ T3 buffering window
  const t3 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const input = K.get("input");
    // pad tap: press and release inside a single JS task, no advance between
    H.press("A");
    H.release("A");
    const trace = [];
    let heldSteps = 0;
    let firstConsumeAt = null;
    let lastBufferedAt = null;
    const t0 = K.simTime;
    for (let i = 0; i < 40; i++) {
      K.advance(1 / 60);
      const b = input.buffered("jump");
      if (input.held("jump")) heldSteps++;
      if (b) lastBufferedAt = K.simTime - t0;
      trace.push({ t: +(K.simTime - t0).toFixed(4), held: input.held("jump"), buf: b });
    }
    // second tap, consume immediately and check it only fires once
    H.press("A");
    H.release("A");
    K.advance(1 / 60);
    const c1 = input.consume("jump");
    const c2 = input.consume("jump");
    // third: consume after a delay longer than the window
    H.press("A");
    H.release("A");
    for (let i = 0; i < 20; i++) K.advance(1 / 60); // 0.333 s > 0.20
    const cLate = input.consume("jump");
    // keyboard equivalent for comparison
    return {
      heldStepsFromInstantTap: heldSteps,
      lastBufferedAt,
      declaredWindow: 0.2,
      consumeTwice: [c1, c2],
      consumeLate: cLate,
      trace: trace.slice(0, 16),
    };
  });
  log("T3_BUFFER", t3);

  // ------------------------------------------------- T4 rebinding + conflicts
  const t4a = await d.run(() => {
    const K = window.__vs.kernel;
    const input = K.get("input");
    const r = {};
    r.conflictRefuse = input.bind("dash", "Space"); // Space is jump, both live in play
    r.conflictList = input.conflictsFor("dash", "Space");
    r.crossContextOk = input.bind("buildRotate", "Mouse0"); // primary is play-only, buildRotate build-only
    r.rebindJump = input.bind("jump", "KeyJ");
    r.forced = input.bind("dash", "Space", { force: true });
    r.jumpChordsAfterForce = input.chordsFor("jump", "kbm");
    r.allConflicts = input.allConflicts();
    r.stored = JSON.parse(localStorage.getItem("variable-star/bindings/1") || "null");
    r.padSwap = input.bind("jump", "Pad:Y");
    r.axis = input.setAxis("look", "y", { invert: true });
    r.southpaw = input.swapSticks(true);
    return r;
  });
  log("T4_REBIND", t4a);

  await d.page.reload({ waitUntil: "load" });
  await d.page.waitForFunction(() => window.__vs && window.__vs.ready, { timeout: 60000 });
  const t4b = await d.run(() => {
    const K = window.__vs.kernel;
    const input = K.get("input");
    return {
      jumpKbm: input.chordsFor("jump", "kbm"),
      jumpPad: input.chordsFor("jump", "pad"),
      dashKbm: input.chordsFor("dash", "kbm"),
      buildRotate: input.chordsFor("buildRotate", "kbm"),
      axes: input.listAxes(),
      swapped: input.sticksSwapped(),
      conflicts: input.allConflicts(),
    };
  });
  log("T4_AFTER_RELOAD", t4b);

  // does the rebound key actually jump?
  await d.page.keyboard.down("j");
  await d.run(() => window.__vs.kernel.advance(1 / 60));
  const t4c = await d.run(() => window.__vs.probe("input").actions.jump ?? null);
  await d.page.keyboard.up("j");
  log("T4_REBOUND_KEY_LIVE", t4c);

  // restore factory before the rest
  await d.run(() => {
    const input = window.__vs.kernel.get("input");
    input.resetBindings();
    input.resetAxes();
    return true;
  });

  // -------------------------------------------------- T5 device switch emits
  const t5 = await d.run(async () => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const seen = [];
    const off = K.signals.on("input:device", (e) => seen.push({ ...e, t: +K.simTime.toFixed(3) }));
    K.advance(0.5);
    H.connect({ style: "playstation" });
    H.press("A");
    H.poll();
    K.advance(0.2);
    H.release("A");
    K.advance(0.5);
    const afterPad = { device: window.__vs.probe("input").device, glyphJump: window.__vs.probe("input").glyphs.jump };
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    K.advance(0.5);
    const afterKbd = { device: window.__vs.probe("input").device, glyphJump: window.__vs.probe("input").glyphs.jump };
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
    // xbox style check
    H.connect({ style: "xbox" });
    H.press("B");
    H.poll();
    K.advance(0.6);
    H.release("B");
    K.advance(0.2);
    const afterXbox = { device: window.__vs.probe("input").device, glyphJump: window.__vs.probe("input").glyphs.jump };
    off?.();
    return { seen, afterPad, afterKbd, afterXbox };
  });
  log("T5_DEVICE", t5);

  // -------------------------------------- T6 pad plays the whole game (G6)
  const t6 = await d.run(() => {
    const input = window.__vs.kernel.get("input");
    const b = input.listBindings();
    const missing = { kbm: [], pad: [] };
    for (const [a, chords] of Object.entries(b.kbm)) if (!chords.length) missing.kbm.push(a);
    for (const [a, chords] of Object.entries(b.pad)) if (!chords.length) missing.pad.push(a);
    return { missing, actionCount: Object.keys(b.pad).length };
  });
  log("T6_COVERAGE", t6);

  // ------------------------------- T7 drift / calibration and hostile cases
  const t7 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const input = K.get("input");
    H.connect({ style: "xbox" });
    H.recalibrate();
    // a worn stick resting at 0.30 on LX
    H.set({ axes: { lx: 0.3, ly: 0.0 } });
    H.poll();
    const creep = [];
    for (let i = 0; i < 180; i++) {
      K.advance(1 / 60);
      if (i % 20 === 0) {
        const p = window.__vs.probe("input");
        creep.push({ t: +(i / 60).toFixed(2), mag: p.move.mag, zero: p.pad.zero, x: p.move.x });
      }
    }
    const zeroed = window.__vs.probe("input");
    // now a deliberate 0.30 hold, perfectly still — is a real intent eaten?
    H.recalibrate();
    H.set({ axes: { lx: 0.0, ly: 0.0 } });
    H.poll();
    for (let i = 0; i < 120; i++) K.advance(1 / 60); // let it zero at true centre
    H.set({ axes: { lx: 0.32, ly: 0.0 } }); // deliberate gentle push, dead still
    H.poll();
    const hold = [];
    for (let i = 0; i < 240; i++) {
      K.advance(1 / 60);
      if (i % 40 === 0) {
        const p = window.__vs.probe("input");
        hold.push({ t: +(i / 60).toFixed(2), mag: p.move.mag, zero: p.pad.zero });
      }
    }
    H.set({ axes: { lx: 0, ly: 0 } });
    H.poll();
    K.advance(1 / 60);
    return { creep, zeroAfterDrift: zeroed.pad.zero, deliberateHold: hold };
  });
  log("T7_CALIBRATION", t7);

  // ------------------------- T8 stress: rapid taps, one per fixed step or faster
  const t8 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const input = K.get("input");
    let downs = 0;
    const off = K.signals.on("input:action", (e) => {
      if (e.action === "jump" && e.phase === "down") downs++;
    });
    for (let i = 0; i < 10; i++) {
      H.press("A");
      H.release("A");
      K.advance(1 / 60);
      K.advance(1 / 60);
    }
    K.advance(0.5);
    off?.();
    // 5 taps inside ONE fixed step (queue depth test)
    let downs2 = 0;
    const off2 = K.signals.on("input:action", (e) => {
      if (e.action === "jump" && e.phase === "down") downs2++;
    });
    for (let i = 0; i < 5; i++) {
      H.press("A");
      H.release("A");
    }
    for (let i = 0; i < 40; i++) K.advance(1 / 60);
    off2?.();
    return { tenTapsSeen: downs, fiveTapsInOneStepSeen: downs2 };
  });
  log("T8_TAP_STRESS", t8);

  // ----------------------------------------------------- T9 look rate measured
  const t9 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const p0 = window.__vs.probe("input").look.yawTotal;
    H.stick("right", 1, 0);
    H.poll();
    // 1 second of full deflection, no ramp reset
    for (let i = 0; i < 60; i++) K.advance(1 / 60);
    const p1 = window.__vs.probe("input");
    H.stick("right", 0, 0);
    H.poll();
    K.advance(1 / 60);
    // small deflection just past the deadzone
    const p2a = window.__vs.probe("input").look.yawTotal;
    H.stick("right", 0.35, 0);
    H.poll();
    for (let i = 0; i < 60; i++) K.advance(1 / 60);
    const p2 = window.__vs.probe("input");
    H.stick("right", 0, 0);
    H.poll();
    K.advance(1 / 60);
    return {
      fullDegPerSec: +(((p1.look.yawTotal - p0) * 180) / Math.PI).toFixed(2),
      boostAtEnd: p1.look.boost,
      smallDegPerSec: +(((p2.look.yawTotal - p2a) * 180) / Math.PI).toFixed(2),
      lookBand: p1.tuning.lookBand,
    };
  });
  log("T9_LOOK_RATE", t9);

  // ------------------------------------------- T10 context gating & menu re-arm
  const t10 = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const input = K.get("input");
    H.stick("left", 0, -1); // stick already pushed forward
    H.poll();
    K.advance(1 / 60);
    const inPlay = window.__vs.probe("input").move;
    K.signals.emit("ui:menu", { id: "pause", open: true });
    K.advance(1 / 60);
    const inMenu = window.__vs.probe("input");
    K.signals.emit("ui:menu", { id: "pause", open: false });
    K.advance(1 / 60);
    const back = window.__vs.probe("input").move;
    H.stick("left", 0, 0);
    H.poll();
    K.advance(1 / 60);
    return {
      inPlayMove: inPlay,
      inMenuMove: inMenu.move,
      navUpHeldInMenu: inMenu.actions.navUp ?? null,
      contextInMenu: inMenu.context,
      afterClose: back,
    };
  });
  log("T10_CONTEXT", t10);

  const rep = await d.report();
  log("CONSOLE_ERRORS", d.consoleErrors);
  log("FAILED_REQUESTS", d.failedRequests);
  log("READY", rep.ready, "KATEX_FAILED", rep.katex.failed);
});

console.log("\n===== END =====");
