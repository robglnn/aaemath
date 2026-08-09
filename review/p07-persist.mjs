// Persistence across a REAL page reload: chords and the analog axis map, plus the Config contract.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 600 }, async (d) => {
  const run = (fn, a) => d.page.evaluate(fn, a);

  await run(() => {
    const i = window.__vs.kernel.get("input");
    i.resetBindings();
    i.bind("jump", "KeyJ");
    i.setAxis("look", "y", { invert: true });
    i.setAxis("move", "x", { axis: 2 });
  });
  const before = await run(() => {
    const i = window.__vs.kernel.get("input");
    return { jump: i.chordsFor("jump", "kbm"), axes: i.listAxes(), raw: localStorage.getItem("variable-star/bindings/1") };
  });
  console.log("before reload:", JSON.stringify(before));

  await d.page.reload({ waitUntil: "load" });
  await d.page.waitForFunction(() => window.__vs && window.__vs.ready, { timeout: 90000 });

  const after = await run(() => {
    const i = window.__vs.kernel.get("input");
    return { jump: i.chordsFor("jump", "kbm"), axes: i.listAxes(), swapped: i.sticksSwapped() };
  });
  console.log("after  reload:", JSON.stringify(after));

  // The rebound key really works after the reload.
  await d.page.keyboard.down("KeyJ");
  await d.play(0.15);
  const heldJ = await run(() => window.__vs.probe("input").actions.jump?.held === true);
  await d.page.keyboard.up("KeyJ");
  await d.play(0.2);
  console.log("KeyJ jumps after reload:", heldJ);

  // Config contract for the ten keys P22 needs.
  const cfg = await run(() => {
    const c = window.__vs.kernel.config;
    const keys = [
      "lookSensitivityMouse", "lookSensitivityPad", "invertX", "rumble", "swapSticks",
      "stickMoveInner", "stickMoveOuter", "stickMoveExp", "stickLookInner", "stickLookOuter", "stickLookExp",
    ];
    const declared = Object.fromEntries(keys.map((k) => [k, c.get(k)]));
    c.set("stickMoveInner", 0.4);
    const raised = window.__vs.probe("input").tuning.moveBand.inner;
    c.reset();
    const afterReset = Object.fromEntries(keys.map((k) => [k, c.get(k)]));
    return { declared, raisedInnerAfterConfigSet: raised, afterReset };
  });
  console.log("config:", JSON.stringify(cfg));

  // resetBindings() restores both tables.
  const reset = await run(() => {
    const i = window.__vs.kernel.get("input");
    i.resetBindings();
    return { jump: i.chordsFor("jump", "kbm"), axes: i.listAxes(), conflicts: i.allConflicts() };
  });
  console.log("after resetBindings:", JSON.stringify(reset));

  const rep = await d.report();
  console.log("health:", JSON.stringify({ ready: rep.ready, errors: rep.errors, console: d.consoleErrors }));
});
