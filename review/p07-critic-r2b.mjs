// P07 critic round 2 — focused isolation of the anomalies found in pass A.
import { openGame } from "../tools/lib/session.mjs";

const log = (...a) => console.log(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

await openGame({ width: 1280, height: 720 }, async (d) => {
  // ---------- A. tap stress from a completely clean page --------------------
  const a = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    const all = [];
    const off = K.signals.on("input:action", (e) => all.push({ a: e.action, p: e.phase, t: +K.simTime.toFixed(4) }));
    H.connect({ style: "xbox" });
    H.poll();
    K.advance(0.2);
    const ctx0 = window.__vs.probe("input").context;
    let n = 0;
    for (let i = 0; i < 10; i++) {
      H.press("A");
      H.release("A");
      K.advance(1 / 60);
      K.advance(1 / 60);
      n++;
    }
    K.advance(0.3);
    off();
    return { ctx0, jumps: all.filter((e) => e.a === "jump" && e.p === "down").length, all: all.slice(0, 12), total: all.length };
  });
  log("A_TAPS_CLEAN", a);

  // ---------- B. five taps inside ONE fixed step ----------------------------
  const b = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    let downs = 0;
    const off = K.signals.on("input:action", (e) => {
      if (e.action === "jump" && e.phase === "down") downs++;
    });
    for (let i = 0; i < 5; i++) {
      H.press("A");
      H.release("A");
    }
    for (let i = 0; i < 60; i++) K.advance(1 / 60);
    off();
    return { downsSeenFromFiveInstantTaps: downs };
  });
  log("B_FIVE_IN_ONE_STEP", b);

  // ---------- C. device arbitration with REAL trusted key events ------------
  const armed = await d.run(() => {
    window.__devLog = [];
    window.__devOff = window.__vs.kernel.signals.on("input:device", (e) =>
      window.__devLog.push({ kind: e.kind, style: e.style, t: +window.__vs.kernel.simTime.toFixed(3) })
    );
    return window.__vs.probe("input").device.active;
  });
  log("C_START_DEVICE", armed);

  await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    H.connect({ style: "playstation" });
    H.press("A");
    H.poll();
    K.advance(0.3);
    H.release("A");
    K.advance(0.6);
    return true;
  });
  const cPad = await d.run(() => ({
    device: window.__vs.probe("input").device.active,
    glyph: window.__vs.probe("input").glyphs.jump,
    log: window.__devLog,
  }));
  log("C_AFTER_PAD", cPad);

  // real, trusted key press through the browser
  await d.page.keyboard.down("w");
  await d.run(() => window.__vs.kernel.advance(0.6));
  await d.page.keyboard.up("w");
  const cKbd = await d.run(() => ({
    device: window.__vs.probe("input").device.active,
    glyph: window.__vs.probe("input").glyphs.jump,
    log: window.__devLog,
    deviceProbe: window.__vs.probe("input").device,
  }));
  log("C_AFTER_REAL_KEY", cKbd);

  // real mouse movement
  await d.page.mouse.move(400, 300);
  await d.page.mouse.move(700, 300);
  await d.run(() => window.__vs.kernel.advance(0.4));
  const cMouse = await d.run(() => ({
    device: window.__vs.probe("input").device.active,
    log: window.__devLog,
  }));
  log("C_AFTER_MOUSE", cMouse);

  // pad takes it back
  await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    H.press("B");
    H.poll();
    K.advance(0.4);
    H.release("B");
    K.advance(0.4);
    return true;
  });
  const cBack = await d.run(() => ({
    device: window.__vs.probe("input").device.active,
    glyph: window.__vs.probe("input").glyphs.jump,
    log: window.__devLog,
  }));
  log("C_PAD_TAKES_BACK", cBack);

  // ---------- D. swapSticks vs a custom invert -----------------------------
  const dd = await d.run(() => {
    const input = window.__vs.kernel.get("input");
    input.resetAxes();
    const before = input.setAxis("look", "y", { invert: true });
    const mid = JSON.parse(JSON.stringify(input.listAxes()));
    input.swapSticks(true);
    const after = JSON.parse(JSON.stringify(input.listAxes()));
    input.swapSticks(false);
    const restored = JSON.parse(JSON.stringify(input.listAxes()));
    input.resetAxes();
    return { setInvert: before.ok, mid: mid.look.y, afterSouthpaw: after.look, afterSouthpawOff: restored.look };
  });
  log("D_SWAP_VS_INVERT", dd);

  // ---------- E. deliberate gentle hold gets zeroed, then inverts ----------
  const e = await d.run(() => {
    const K = window.__vs.kernel;
    const H = window.__vsInput;
    H.connect({ style: "xbox" });
    H.recalibrate();
    H.set({ axes: { lx: 0, ly: 0 } });
    H.poll();
    for (let i = 0; i < 150; i++) K.advance(1 / 60); // let it zero honestly at centre
    const zeroAtCentre = window.__vs.probe("input").pad.zero;
    // player pushes the stick gently and holds it dead still (hall-effect stick, no noise)
    H.set({ axes: { lx: 0.45, ly: 0 } });
    H.poll();
    const t = [];
    for (let i = 0; i < 200; i++) {
      K.advance(1 / 60);
      if (i % 25 === 0) t.push({ t: +(i / 60).toFixed(2), mag: window.__vs.probe("input").move.mag });
    }
    const zeroAfter = window.__vs.probe("input").pad.zero;
    // player lets go — stick truly centred
    H.set({ axes: { lx: 0, ly: 0 } });
    H.poll();
    K.advance(1 / 60);
    const onRelease = window.__vs.probe("input").move;
    const drift = [];
    for (let i = 0; i < 150; i++) {
      K.advance(1 / 60);
      if (i % 25 === 0) drift.push({ t: +(i / 60).toFixed(2), x: window.__vs.probe("input").move.x, mag: window.__vs.probe("input").move.mag });
    }
    return { zeroAtCentre, holdTrace: t, zeroAfterHold: zeroAfter, onRelease, driftAfterRelease: drift };
  });
  log("E_DELIBERATE_HOLD", e);

  // ---------- F. cross-context binding that should be legal ---------------
  const f = await d.run(() => {
    const input = window.__vs.kernel.get("input");
    input.resetBindings();
    return {
      playOnlyOntoBuildOnly: input.bind("interact", "KeyR"), // interact=play, buildRotate=build
      sameContext: input.bind("interact", "KeyE2" in {} ? "x" : "KeyB"), // buildToggle is play+build -> overlap
      reset: input.resetBindings() && true,
    };
  });
  log("F_CONTEXT_CONFLICTS", f);

  // ---------- G. keyboard + mouse still plays (regression check) ----------
  await d.page.keyboard.down("w");
  await d.run(() => window.__vs.kernel.advance(1.2));
  const g1 = await d.run(() => ({ move: window.__vs.probe("input").move, loco: window.__vs.probe("locomotion").speed }));
  await d.page.keyboard.up("w");
  log("G_KBM", g1);

  log("CONSOLE_ERRORS", d.consoleErrors);
});
console.log("\n===== END B =====");
