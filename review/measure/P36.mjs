/**
 * P36 — orphaned-signal evidence.
 *
 * Drives the SHIPPED app (real Vite server, real browser, real boot glob) and records every signal
 * that actually crosses the bus during ordinary play, next to whether anything was listening. A
 * static audit can only say "nobody wrote the call"; this says "the call ran 1754 times and landed
 * nowhere", which is the only evidence RESUME.md §6b accepts.
 *
 * Nothing here emits a gameplay signal. Every signal counted below was produced by the game's own
 * code in response to a real key press, a real mouse move or a real gamepad event — a proof built
 * on a signal the test fired would prove only that `Signals.emit` works.
 *
 * Two measurement traps this file is deliberately built around:
 *
 *   * `Signals.names()` is NOT "has a live listener". `on()` returns an unsubscribe that empties
 *     the handler Set but leaves the key in the Map, so a name answers `true` forever once anything
 *     has ever listened — including this harness's own probes. The listener set is therefore
 *     snapshotted at boot, before the harness registers anything.
 *   * The camera rig's own `report()` is not proof that the camera moved. `trauma` is a number the
 *     shake handler sets; the question is whether the lens turned. So the shake test reads
 *     `kernel.camera.rotation` straight off the Object3D the renderer draws with, and keys on ROLL,
 *     which `CameraRig` writes as exactly `shakeRoll` and nothing else ever touches. Roll is zero
 *     on every frame of this game unless a shake is live.
 *
 *   node review/measure/P36.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

const j = (v) => JSON.stringify(v);
const round = (n, k = 4) => (n == null ? null : Number(Number(n).toFixed(k)));

await openGame({ width: 1280, height: 720 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready", boot.errors?.slice(0, 3));
    process.exitCode = 1;
    return;
  }

  await d.run(() => {
    const S = window.__vs.kernel.signals;
    const bootListeners = new Set(S.names()); // snapshot BEFORE this harness registers anything
    const counts = new Map();
    const raw = S.emit.bind(S);
    S.emit = (name, value) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return raw(name, value);
    };
    window.__p36 = {
      bootListeners: () => [...bootListeners].sort(),
      dump: () =>
        Object.fromEntries(
          [...counts.entries()].sort().map(([n, c]) => [n, { emits: c, heardAtBoot: bootListeners.has(n) }])
        ),
      camera: () => window.__vs.probe("camera"),
      lens: () => {
        const c = window.__vs.kernel.camera;
        return { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.rotation.x, yaw: c.rotation.y, roll: c.rotation.z };
      },
    };
  });

  // ================================================================ camera:probe (WIRED by P36)
  console.log("=== camera:probe — CameraRig.js:650 -> boot/30-locomotion.js (NEW) ===");
  const probeAB = await d.run(() => {
    const k = window.__vs.kernel;
    const cam = () => window.__vs.probe("camera");
    // Settle every spring first. A boom still easing out of its spawn framing gives two different
    // numbers for two different reasons, and the whole point of this A/B is that only the route
    // changes.
    for (let i = 0; i < 60 * 4; i++) k.advance(1 / 60, { render: false });
    const wired = cam();
    // Tear the bridge down and let the rig fall through to its duck-typed authority, at the same
    // settled pose, in the same session. The same number arriving by a different route is the
    // proof that this was a disconnected channel and not a behaviour change.
    k.get("cameraProbe").dispose();
    for (let i = 0; i < 12; i++) k.advance(1 / 60, { render: false });
    const fallback = cam();
    return {
      wired: { source: wired.collisionSource, free: wired.freeDistance, allowed: wired.allowedDistance, cam: wired.position },
      fallback: { source: fallback.collisionSource, free: fallback.freeDistance, allowed: fallback.allowedDistance, cam: fallback.position },
    };
  });
  console.log("bridge mounted      ", j(probeAB.wired));
  console.log("bridge disposed     ", j(probeAB.fallback));

  // ================================================================ input:look
  console.log("\n=== input:look — Input.js:827 -> CameraRig.js:420 ===");
  const yaw0 = (await d.run(() => window.__p36.lens())).yaw;
  await d.look(400, 0);
  const yaw1 = (await d.run(() => window.__p36.lens())).yaw;
  console.log("mouse dx +400 px    ", j({ rawLensYawBefore: round(yaw0), rawLensYawAfter: round(yaw1), delta: round(yaw1 - yaw0) }));

  // ================================================================ camera:target
  console.log("\n=== camera:target — Locomotion.js:1187 -> CameraRig.js:518 / Lighting.js:639 ===");
  await d.hold("KeyW", 1.5);
  const camRun = await d.run(() => window.__p36.camera());
  console.log("after 1.5 s running ", j({ targetSource: camRun.targetSource, followsPlayerAt: camRun.player }));

  // ================================================================ camera:shake
  console.log("\n=== camera:shake — Locomotion.js:898/1103 -> CameraRig.js:472 ===");
  const shake = await d.run(() => {
    const k = window.__vs.kernel;
    const S = k.signals;
    const lens = window.__p36.lens;

    let fired = null;
    const off = S.on("camera:shake", (e) => {
      if (!fired) fired = { ...e, atStep: k.stepCount };
    });

    // Control: 30 steps of ordinary running, no landing. Roll must be identically zero.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    let controlRoll = 0;
    let controlYawStep = 0;
    let prevYaw = lens().yaw;
    for (let i = 0; i < 30; i++) {
      k.advance(1 / 60, { render: false });
      const L = lens();
      controlRoll = Math.max(controlRoll, Math.abs(L.roll));
      controlYawStep = Math.max(controlYawStep, Math.abs(L.yaw - prevYaw));
      prevYaw = L.yaw;
    }

    // Keep running off the plateau; the fall does the rest. Sample every step until a shake is
    // reported, then keep sampling through its whole decay.
    const rows = [];
    let sinceFire = -1;
    for (let i = 0; i < 60 * 20; i++) {
      k.advance(1 / 60, { render: false });
      const L = lens();
      if (fired && sinceFire < 0) sinceFire = 0;
      if (sinceFire >= 0) {
        rows.push({ step: sinceFire, roll: L.roll, yaw: L.yaw, trauma: window.__vs.probe("camera").trauma });
        sinceFire++;
        if (sinceFire > 30) break;
      }
    }
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
    off();

    let maxRoll = 0;
    let maxYawStep = 0;
    for (let i = 0; i < rows.length; i++) {
      maxRoll = Math.max(maxRoll, Math.abs(rows[i].roll));
      if (i) maxYawStep = Math.max(maxYawStep, Math.abs(rows[i].yaw - rows[i - 1].yaw));
    }
    return {
      emitted: fired,
      controlMaxRollRad: controlRoll,
      controlMaxYawStepRad: controlYawStep,
      shakenMaxRollRad: maxRoll,
      shakenMaxYawStepRad: maxYawStep,
      firstSixSteps: rows.slice(0, 6).map((r) => ({ step: r.step, roll: Number(r.roll.toFixed(6)), trauma: Number(r.trauma.toFixed(4)) })),
      shakeEnabled: window.__vs.probe("camera").shakeEnabled,
    };
  });
  console.log("Locomotion emitted  ", j(shake.emitted));
  console.log("control window      ", j({ maxRollRad: round(shake.controlMaxRollRad, 8), maxYawStepRad: round(shake.controlMaxYawStepRad, 6) }));
  console.log("shake window        ", j({ maxRollRad: round(shake.shakenMaxRollRad, 8), maxYawStepRad: round(shake.shakenMaxYawStepRad, 6), shakeEnabled: shake.shakeEnabled }));
  console.log("per-step trace      ", j(shake.firstSixSteps));

  // ================================================================ live emitters, no consumer
  console.log("\n=== input:device / input:focus — live emitters awaiting P21/P22 ===");
  const inputEvents = await d.run(() => {
    const S = window.__vs.kernel.signals;
    const seen = [];
    const offs = ["input:device", "input:focus", "input:context", "input:rebind", "input:capture", "input:calibrate"].map((n) =>
      S.on(n, (e) => seen.push({ signal: n, ...e }))
    );
    const hook = window.__vsInput;
    hook.connect({ id: "Xbox Wireless Controller (STANDARD GAMEPAD)" });
    hook.stick("left", 0.9, 0);
    for (let i = 0; i < 30; i++) window.__vs.kernel.advance(1 / 60, { render: false });
    hook.stick("left", 0, 0);
    hook.blur();
    for (let i = 0; i < 6; i++) window.__vs.kernel.advance(1 / 60, { render: false });
    hook.focus();
    for (let i = 0; i < 6; i++) window.__vs.kernel.advance(1 / 60, { render: false });
    hook.disconnect();
    for (let i = 0; i < 6; i++) window.__vs.kernel.advance(1 / 60, { render: false });
    for (const off of offs) off();
    return seen;
  });
  for (const e of inputEvents) console.log("  ", j(e));

  // ================================================================ tally
  const counts = await d.run(() => window.__p36.dump());
  console.log("\n=== every signal that crossed the bus, and whether anything was listening at boot ===");
  for (const [name, c] of Object.entries(counts)) {
    console.log(`${c.heardAtBoot ? "HEARD  " : "UNHEARD"} ${name.padEnd(18)} x${String(c.emits).padStart(5)}`);
  }
  console.log("\nboot listener set:", (await d.run(() => window.__p36.bootListeners())).join(", "));

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
  if (rep.errors.length) console.log(rep.errors.slice(0, 5));
});
