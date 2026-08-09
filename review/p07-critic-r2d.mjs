// P07 critic — the REAL hardware path: no virtual bypass, only navigator.getGamepads().
import { openGame } from "../tools/lib/session.mjs";
const log = (...a) => console.log(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.run(() => {
    // make sure the synthetic pad is NOT in play
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
    window.__fake = fake;
    navigator.getGamepads = () => [fake, null, null, null];
    window.dispatchEvent(new Event("gamepadconnected"));
    return true;
  });

  // the module polls on a 250 Hz *wall-clock* timer, so give it real milliseconds
  await new Promise((r) => setTimeout(r, 200));
  await d.run(() => window.__vs.kernel.advance(0.2));
  log("HW_SEEN", await d.run(() => window.__vs.probe("input").pad));

  // stick full forward through the hardware object only
  await d.run(() => {
    window.__fake.axes[1] = -1;
    window.__fake.timestamp = performance.now();
    return true;
  });
  await new Promise((r) => setTimeout(r, 120));
  await d.run(() => {
    for (let i = 0; i < 60; i++) window.__vs.kernel.advance(1 / 60);
    return true;
  });
  log("HW_MOVE", await d.run(() => ({
    move: window.__vs.probe("input").move,
    device: window.__vs.probe("input").device,
    speed: window.__vs.probe("locomotion").speed,
    glyphJump: window.__vs.probe("input").glyphs.jump,
  })));

  // a button, pressed and released across real polls
  await d.run(() => {
    window.__fake.axes[1] = 0;
    window.__fake.buttons[0] = { pressed: true, touched: true, value: 1 };
    return true;
  });
  await new Promise((r) => setTimeout(r, 60));
  await d.run(() => window.__vs.kernel.advance(0.1));
  const down = await d.run(() => window.__vs.probe("input").actions.jump ?? null);
  await d.run(() => {
    window.__fake.buttons[0] = { pressed: false, touched: false, value: 0 };
    return true;
  });
  await new Promise((r) => setTimeout(r, 60));
  await d.run(() => window.__vs.kernel.advance(0.1));
  const up = await d.run(() => ({ jump: window.__vs.probe("input").actions.jump ?? null, edges: window.__vs.probe("input").pad.edges }));
  log("HW_BUTTON_DOWN", down);
  log("HW_BUTTON_AFTER_RELEASE", up);

  // a sub-frame tap that only the 250 Hz timer can catch: down then up 8 ms apart
  await d.run(() => {
    window.__fake.buttons[0] = { pressed: true, touched: true, value: 1 };
    setTimeout(() => {
      window.__fake.buttons[0] = { pressed: false, touched: false, value: 0 };
    }, 8);
    return true;
  });
  await new Promise((r) => setTimeout(r, 150));
  const tap = await d.run(() => {
    const I = window.__vs.kernel.get("input");
    window.__vs.kernel.advance(1 / 60);
    const held1 = I.held("jump");
    const buf = I.buffered("jump");
    window.__vs.kernel.advance(1 / 60);
    return { heldOnFirstStep: held1, bufferedAfterSubFrameTap: buf, edges: window.__vs.probe("input").pad.edges };
  });
  log("HW_SUBFRAME_TAP", tap);
  log("CONSOLE_ERRORS", d.consoleErrors);
});
console.log("\n===== END D =====");
