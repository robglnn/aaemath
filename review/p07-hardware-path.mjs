// Proves the *hardware* branch: a plain Gamepad-shaped snapshot from navigator.getGamepads(),
// with no journal of any kind, read by the module's own 250 Hz timer.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 600, query: { bindings: "default" } }, async (d) => {
  const run = (fn, a) => d.page.evaluate(fn, a);
  const probe = () => run(() => window.__vs.probe("input"));

  await run(() => {
    window.__vsInput.disconnect(); // no virtual pad: everything below is the hardware path
    window.__hw = {
      id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => [window.__hw, null, null, null];
    window.__tap = [];
    window.__vs.kernel.signals.on("input:action", (e) => window.__tap.push(e.action + ":" + e.phase));
    window.__vs.kernel.signals.on("input:device", (e) => window.__tap.push("device:" + e.kind));
  });
  await new Promise((r) => setTimeout(r, 350)); // the idle sweep is 200 ms until a pad is ever seen
  await d.play(0.5);

  const seen1 = await probe();
  console.log("A. detected as hardware:", JSON.stringify({
    connected: seen1.pad.connected,
    virtual: seen1.device.padVirtual,
    id: seen1.device.padId,
    style: seen1.device.style,
    samples: seen1.pad.samples,
  }));

  // Does the module's own timer sample without any sim time passing at all?
  const s0 = (await probe()).pad.samples;
  await new Promise((r) => setTimeout(r, 300));
  const s1 = (await probe()).pad.samples;
  console.log("B. samples in 300 ms of wall time, zero sim time:", s1 - s0, "→ Hz ≈", Math.round(((s1 - s0) / 0.3)));

  // A press that begins and ends between two sim advances, delivered only by the timer.
  await run(() => (window.__tap.length = 0));
  await run(() => {
    window.__hw.buttons[0] = { pressed: true, touched: true, value: 1 };
    window.__hw.timestamp = performance.now();
  });
  await new Promise((r) => setTimeout(r, 40)); // ~10 timer samples, no sim time
  await run(() => {
    window.__hw.buttons[0] = { pressed: false, touched: false, value: 0 };
    window.__hw.timestamp = performance.now();
  });
  await d.play(0.3);
  console.log("C. hardware tap between advances:", JSON.stringify(await run(() => window.__tap)));

  // Now the harder one: press and release with NO wall time between them either — the case a
  // polled level genuinely cannot see. The latch cannot invent it; this documents the bound.
  await run(() => (window.__tap.length = 0));
  await run(() => {
    window.__hw.buttons[2] = { pressed: true, touched: true, value: 1 };
    window.__hw.buttons[2] = { pressed: false, touched: false, value: 0 };
  });
  await d.play(0.3);
  console.log("D. sub-sample hardware tap (expected: lost, bounded by 1/250 s):",
    JSON.stringify(await run(() => window.__tap)));

  // Analog stick through the hardware path, plus rest capture on hardware drift.
  await run(() => (window.__hw.axes = [0.28, -0.19, 0, 0]));
  await d.play(2.2);
  const cal = await probe();
  console.log("E. hardware drift 0.28/-0.19 after 2.2 s:", JSON.stringify({
    zero: cal.pad.zero,
    moveMag: cal.move.mag,
    axesRaw: cal.pad.axesRaw,
    axesCal: cal.pad.axesCal,
  }));

  await run(() => (window.__hw.axes = [0.28, -1, 0, 0]));
  await d.play(0.4);
  const push = await probe();
  console.log("F. hardware full forward after calibration:", JSON.stringify({ move: push.move, stick: push.sticks.left.out }));

  // Disconnect: a pad that vanishes while a button is held must emit the up edge.
  await run(() => {
    window.__hw.axes = [0, 0, 0, 0];
    window.__hw.buttons[10] = { pressed: true, touched: true, value: 1 }; // L3 = sprint
  });
  await d.play(0.4);
  const held = (await probe()).held;
  await run(() => (window.__tap.length = 0));
  await run(() => (navigator.getGamepads = () => [null, null, null, null]));
  await d.play(0.4);
  console.log("G. held before unplug:", JSON.stringify(held), "→ after:", JSON.stringify((await probe()).held),
    "events:", JSON.stringify(await run(() => window.__tap)));

  const rep = await d.report();
  console.log("H. health:", JSON.stringify({ ready: rep.ready, errors: rep.errors, console: d.consoleErrors, failed: d.failedRequests }));
});
