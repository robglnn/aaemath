// P07 round-2 measurement rig. Every number in the handoff comes out of this file.
// Run:  node review/p07-round2.mjs
import { openGame } from "../tools/lib/session.mjs";

const out = {};
const log = (k, v) => {
  out[k] = v;
  console.log(`\n### ${k}\n` + JSON.stringify(v, null, 1));
};

await openGame({ width: 1280, height: 720, query: { bindings: "default" } }, async (d) => {
  const run = (fn, arg) => d.page.evaluate(fn, arg);

  // Signal tap installed once; every scenario reads and clears it.
  await run(() => {
    window.__tap = { device: [], action: [], move: [], look: [], calib: [] };
    const s = window.__vs.kernel.signals;
    s.on("input:device", (e) => window.__tap.device.push({ t: window.__vs.kernel.simTime, ...e }));
    s.on("input:action", (e) => window.__tap.action.push({ t: window.__vs.kernel.simTime, ...e }));
    s.on("input:move", (e) => window.__tap.move.push(e));
    s.on("input:look", (e) => window.__tap.look.push(e));
    s.on("input:calibrate", (e) => window.__tap.calib.push(e));
    window.__clear = () => {
      for (const k of Object.keys(window.__tap)) window.__tap[k].length = 0;
    };
  });

  const clear = () => run(() => window.__clear());
  const probe = () => run(() => window.__vs.probe("input"));
  const tap = () => run(() => JSON.parse(JSON.stringify(window.__tap)));

  // ---------------------------------------------------------------- 1. lost tap
  // Pad tap issued entirely between two 20 fps advances, vs the identical keyboard tap.
  await run(() => window.__vsInput.connect({ style: "xbox" }));
  await d.play(0.5);
  await clear();

  await d.advance(0.05);
  await run(() => {
    window.__vsInput.press("A");
    window.__vsInput.release("A");
  });
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await d.advance(0.05);
    seen.push(
      await run(() => {
        const p = window.__vs.probe("input");
        return {
          held: !!p.actions.jump?.held,
          pressed: !!p.actions.jump?.pressed,
          buffered: !!p.actions.jump?.buffered,
        };
      })
    );
  }
  const padTapEvents = (await tap()).action.filter((a) => a.action === "jump");

  await clear();
  await d.advance(0.05);
  await d.page.keyboard.down("Space");
  await d.page.keyboard.up("Space");
  const kbSeen = [];
  for (let i = 0; i < 4; i++) {
    await d.advance(0.05);
    kbSeen.push(
      await run(() => {
        const p = window.__vs.probe("input");
        return {
          held: !!p.actions.jump?.held,
          pressed: !!p.actions.jump?.pressed,
          buffered: !!p.actions.jump?.buffered,
        };
      })
    );
  }
  const kbTapEvents = (await tap()).action.filter((a) => a.action === "jump");
  log("1-lost-tap", {
    padFrames: seen,
    padJumpEvents: padTapEvents.map((e) => e.phase),
    kbdFrames: kbSeen,
    kbdJumpEvents: kbTapEvents.map((e) => e.phase),
  });

  // 1b. burst: 8 fixed steps in one advance must still see a mid-burst tap because the sampler
  // runs on its own timer between the two evaluate() round trips.
  await clear();
  await run(() => window.__vsInput.tap("X"));
  await d.advance(0.2);
  log(
    "1b-tap-helper",
    (await tap()).action.filter((a) => a.action === "interact").map((e) => e.phase)
  );

  // ---------------------------------------------------------------- 2. device thrash
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 }, buttons: { RT: 0 } }));
  await d.play(0.6);
  await run(() => window.__vsInput.set({ axes: { lx: 0.3 } })); // worn stick settles at 0.30
  await d.play(1.0);
  await clear();
  // Player types for 2 s while the pad idles at 0.30.
  for (let i = 0; i < 20; i++) {
    await d.page.keyboard.down("KeyW");
    await d.advance(0.05);
    await d.page.keyboard.up("KeyW");
    await d.advance(0.05);
  }
  const drift = await tap();
  const p2 = await probe();
  log("2-device-thrash-stick-0.30", {
    deviceEmissions: drift.device.length,
    devices: drift.device.map((e) => e.kind),
    finalDevice: p2.device.active,
    switchesTotal: p2.device.switches,
  });

  // Trigger resting at 0.16
  await run(() => window.__vsInput.set({ axes: { lx: 0 }, buttons: { RT: 0.16 } }));
  await d.play(1.0);
  await clear();
  for (let i = 0; i < 20; i++) {
    await d.page.keyboard.down("KeyW");
    await d.advance(0.05);
    await d.page.keyboard.up("KeyW");
    await d.advance(0.05);
  }
  log("2b-device-thrash-RT-0.16", {
    deviceEmissions: (await tap()).device.length,
    rtHeld: (await probe()).actions.primary?.held ?? false,
  });

  // ---------------------------------------------------------------- 3. drift walk
  await run(() => window.__vsInput.set({ buttons: { RT: 0 } }));
  const walk = {};
  for (const level of [0.15, 0.2, 0.25, 0.3]) {
    await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
    await run(() => window.__vsInput.recalibrate());
    await d.play(0.5);
    await run((v) => window.__vsInput.set({ axes: { ly: -v } }), level);
    await d.play(2.0); // > settleSeconds: the rest capture must take this as the new zero
    const before = await run(() => {
      const l = window.__vs.probe("locomotion");
      return { x: l.position[0], z: l.position[2] };
    });
    await d.play(5.0);
    const after = await run(() => {
      const l = window.__vs.probe("locomotion");
      return { x: l.position[0], z: l.position[2] };
    });
    const pr = await probe();
    walk[level] = {
      moveMag: pr.move.mag,
      zero: pr.pad.zero,
      metresIn5s: Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(4)),
    };
  }
  log("3-drift-walk", walk);

  // The stick still works after calibration: push past the drift and the avatar moves.
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: -1 } }));
  const pushBefore = await run(() => {
    const l = window.__vs.probe("locomotion");
    return { x: l.position[0], z: l.position[2] };
  });
  await d.play(1.5);
  const pushAfter = await run(() => {
    const l = window.__vs.probe("locomotion");
    return { x: l.position[0], z: l.position[2] };
  });
  log("3b-full-stick-still-moves", {
    metresIn1p5s: Number(Math.hypot(pushAfter.x - pushBefore.x, pushAfter.z - pushBefore.z).toFixed(4)),
    moveMag: (await probe()).move.mag,
  });

  // ---------------------------------------------------------------- 4. menu nav re-arm
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
  await d.play(0.5);
  // deflect FIRST, then open the menu
  await run(() => window.__vsInput.set({ axes: { ly: -0.9 } }));
  await d.play(0.3);
  await clear();
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: true }));
  await d.play(2.0);
  const preDeflect = (await tap()).action.filter((a) => a.action === "navUp" && a.phase === "down").length;
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: false }));
  await run(() => window.__vsInput.set({ axes: { ly: 0 } }));
  await d.play(0.5);

  // deflect AFTER the menu opens (the control that already worked)
  await clear();
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: true }));
  await d.advance(0.2);
  await run(() => window.__vsInput.set({ axes: { ly: -0.9 } }));
  await d.play(2.0);
  const postDeflect = (await tap()).action.filter((a) => a.action === "navUp" && a.phase === "down").length;
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: false }));
  await run(() => window.__vsInput.set({ axes: { ly: 0 } }));
  await d.play(0.5);

  // a button held across the context switch must NOT fire confirm
  await clear();
  await run(() => window.__vsInput.press("A"));
  await d.play(0.4);
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: true }));
  await d.play(0.5);
  const confirmFired = (await tap()).action.filter((a) => a.action === "confirm").length;
  await run(() => window.__vsInput.release("A"));
  await run(() => window.__vs.kernel.signals.emit("ui:menu", { id: "test", open: false }));
  await d.play(0.5);
  log("4-menu-nav", { navUpWhenDeflectedBeforeOpen: preDeflect, navUpWhenDeflectedAfterOpen: postDeflect, confirmFromHeldA: confirmFired });

  // ---------------------------------------------------------------- 4b. direction through the
  // *live* pipeline (not a re-implementation of radial): set the stick, advance, read the probe.
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0, rx: 0, ry: 0 } }));
  await run(() => window.__vsInput.recalibrate());
  await d.play(2.2); // let the rest capture settle back onto a clean zero
  const angles = [];
  for (const deg of [22.5, 30, 45, 60, 67.5]) {
    for (const r of [0.35, 0.6, 1.0]) {
      const a = (deg * Math.PI) / 180;
      await run(([x, y]) => window.__vsInput.set({ axes: { lx: x, ly: y } }), [
        Math.cos(a) * r,
        -Math.sin(a) * r,
      ]);
      await d.play(0.1);
      const s = (await probe()).sticks.left;
      angles.push({
        deg,
        r,
        outDeg: Number(((Math.atan2(s.out.y, s.out.x) * 180) / Math.PI).toFixed(4)),
        mag: s.mag,
      });
    }
  }
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
  await d.play(0.3);
  log("4b-direction-live", { zero: (await probe()).pad.zero, angles });

  // ---------------------------------------------------------------- 5. probe aliasing
  await run(() => window.__vsInput.set({ axes: { lx: 0.7071, ly: -0.7071 } }));
  await d.play(0.5);
  const captured = await run(() => {
    window.__cap = window.__vs.probe("input");
    return window.__cap.sticks.left.out;
  });
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
  await d.advance(0.2);
  const afterCap = await run(() => ({
    captured: window.__cap.sticks.left.out,
    live: window.__vs.probe("input").sticks.left.out,
  }));
  log("5-probe-copy", { atCapture: captured, ...afterCap });

  // ---------------------------------------------------------------- 6. rebindable axes
  const axesBefore = await run(() => window.__vsInput.axes());
  await run(() => window.__vsInput.swapSticks(true));
  await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0, rx: 0, ry: -1 } }));
  await d.play(0.6);
  const southpaw = await probe();
  await run(() => window.__vsInput.set({ axes: { rx: 0, ry: 0 } }));
  await run(() => window.__vsInput.swapSticks(false));
  await d.play(0.3);
  await run(() => window.__vsInput.setAxis("look", "y", { invert: true }));
  await run(() => window.__vsInput.set({ axes: { ry: 0.8 } }));
  await clear();
  await d.play(0.5);
  const invPitch = (await probe()).look.pitchTotal;
  await run(() => window.__vsInput.setAxis("look", "y", { invert: false }));
  await run(() => window.__vsInput.set({ axes: { ry: 0 } }));
  await d.play(0.3);
  log("6-axes", {
    defaults: axesBefore,
    southpawMove: southpaw.move,
    southpawAxes: southpaw.axes,
    padMoveChords: southpaw.bindings.pad.moveForward,
    invertedLookYPitchTotalSign: Math.sign(invPitch),
    conflicts: southpaw.conflicts,
  });

  // ---------------------------------------------------------------- 7. deadzone integrity
  const sweep = await run(() => {
    const p = window.__vs.probe("input");
    const b = p.tuning.moveBand;
    const rad = (x, y) => {
      const r = Math.hypot(x, y);
      if (!(r > b.inner)) return { x: 0, y: 0, mag: 0 };
      const t = Math.min(1, (r - b.inner) / Math.max(1e-6, b.outer - b.inner));
      const mag = Math.pow(t, b.exp);
      return { x: (x * mag) / r, y: (y * mag) / r, mag };
    };
    const rows = [];
    for (const deg of [22.5, 45, 67.5]) {
      const a = (deg * Math.PI) / 180;
      for (const r of [0.3, 0.5, 0.8, 1.0]) {
        const o = rad(Math.cos(a) * r, Math.sin(a) * r);
        rows.push({
          deg,
          r,
          outDeg: Number(((Math.atan2(o.y, o.x) * 180) / Math.PI).toFixed(4)),
          mag: Number(o.mag.toFixed(4)),
        });
      }
    }
    let maxJump = 0;
    let prev = 0;
    let firstNonZero = null;
    for (let i = 0; i <= 141; i++) {
      const r = i / 141;
      const o = rad(r * Math.SQRT1_2, r * Math.SQRT1_2);
      if (o.mag > 0 && firstNonZero === null) firstNonZero = { r: Number(r.toFixed(4)), mag: Number(o.mag.toFixed(5)) };
      maxJump = Math.max(maxJump, Math.abs(o.mag - prev));
      prev = o.mag;
    }
    return { band: b, angles: rows, firstNonZero, maxJump: Number(maxJump.toFixed(5)) };
  });
  log("7-deadzone", sweep);

  // ---------------------------------------------------------------- 8. no regressions
  const regress = await run(() => {
    const i = window.__vs.kernel.get("input");
    const r = {};
    r.conflictsDefault = i.allConflicts();
    r.bindDashSpace = i.bind("dash", "Space");
    r.spaceStillJump = i.chordsFor("jump", "kbm");
    r.bindConfirmF = i.bind("confirm", "KeyF");
    i.resetBindings();
    r.afterReset = { jump: i.chordsFor("jump", "kbm"), confirm: i.chordsFor("confirm", "kbm") };
    r.glyphXbox = { jump: i.glyph("jump", "pad").text, move: i.glyph("moveForward", "pad").text };
    r.buffers = {
      jump: window.__vs.probe("input").tuning.bufferDefault,
    };
    r.padChordsMove = i.chordsFor("moveForward", "pad");
    return r;
  });
  log("8-rebinding", regress);

  // trigger hysteresis unchanged
  const hyst = {};
  for (const v of [0.34, 0.36, 0.29, 0.27]) {
    await run((x) => window.__vsInput.set({ buttons: { RT: x } }), v);
    await d.advance(0.1);
    hyst[v] = (await probe()).actions.primary?.held ?? false;
  }
  await run(() => window.__vsInput.set({ buttons: { RT: 0 } }));
  await d.advance(0.2);
  log("8b-trigger-hysteresis", hyst);

  // buffer window still exactly 0.20 s for a pad press
  const buf = await (async () => {
    await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
    await d.play(0.3);
    await run(() => window.__vs.kernel.get("input").clearAllBuffers());
    await run(() => window.__vsInput.press("A"));
    await d.advance(1 / 60);
    const rows = [];
    for (let i = 0; i < 16; i++) {
      rows.push(await run(() => !!window.__vs.probe("input").actions.jump?.buffered));
      await d.advance(1 / 60);
    }
    await run(() => window.__vsInput.release("A"));
    await d.advance(0.2);
    const last = rows.lastIndexOf(true);
    return { stepsBuffered: last + 2, secondsBuffered: Number(((last + 2) / 60).toFixed(4)) };
  })();
  log("8c-buffer-window", buf);

  // consume() exactly once
  const consumeOnce = await (async () => {
    await run(() => window.__vsInput.press("A"));
    await d.advance(1 / 30);
    const a = await run(() => window.__vs.kernel.get("input").consume("jump"));
    const b = await run(() => window.__vs.kernel.get("input").consume("jump"));
    await run(() => window.__vsInput.release("A"));
    await d.play(0.3);
    return { first: a, second: b };
  })();
  log("8d-consume-once", consumeOnce);

  // PlayStation glyph swap still works
  await run(() => window.__vsInput.connect({ style: "playstation" }));
  await run(() => window.__vsInput.press("B"));
  await d.play(0.4);
  await run(() => window.__vsInput.release("B"));
  await d.advance(0.2);
  const ps = await probe();
  log("8e-playstation", {
    style: ps.device.style,
    jump: ps.glyphs.jump,
    crouch: ps.glyphs.crouch,
    menu: ps.glyphs.menu,
    device: ps.device.active,
  });

  // blur safety
  await run(() => window.__vsInput.connect({ style: "xbox" }));
  await d.page.keyboard.down("KeyW");
  await d.play(0.3);
  const heldBefore = (await probe()).held;
  await run(() => window.dispatchEvent(new Event("blur")));
  await d.advance(0.2);
  const heldAfter = await probe();
  await d.page.keyboard.up("KeyW");
  log("8f-blur", { before: heldBefore, after: heldAfter.held, move: heldAfter.move });

  // ---------------------------------------------------------------- 8g. determinism (G4)
  // Same scripted pad input twice from the same state must land in the same place.
  // Stop the realtime animation loop first: otherwise headless wall-clock frames inject extra
  // fixed steps between the scripted ones and the test measures the harness, not the module.
  await run(() => window.__vs.kernel.halt());
  const detRun = async () => {
    await run(() => {
      window.__vs.kernel.get("locomotion").teleport(4, 40, 14, { heading: [0, -1] });
      window.__vsInput.set({ axes: { lx: 0, ly: 0, rx: 0, ry: 0 } });
    });
    await d.play(1.0);
    await run(() => window.__vsInput.set({ axes: { lx: 0.5, ly: -0.75 } }));
    for (let i = 0; i < 45; i++) await d.advance(1 / 60);
    await run(() => window.__vsInput.set({ axes: { lx: 0, ly: 0 } }));
    const l = await run(() => window.__vs.probe("locomotion"));
    const p = await probe();
    return { pos: l.position, move: p.move, stick: p.sticks.left.out };
  };
  const detA = await detRun();
  const detB = await detRun();
  log("8g-determinism", { a: detA, b: detB, identical: JSON.stringify(detA) === JSON.stringify(detB) });

  const rep = await d.report();
  log("9-health", {
    ready: rep.ready,
    errors: rep.errors,
    consoleErrors: d.consoleErrors,
    failedRequests: d.failedRequests,
    katexFailed: rep.katex.failed,
    steps: rep.stats.steps,
    padSamples: (await probe()).pad.samples,
  });

});

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(out, null, 1).slice(0, 200) + " ...");
