// P07 critic — instrumented device-arbitration trace (the pad reclaiming the prompts).
import { openGame } from "../tools/lib/session.mjs";
const log = (...a) => console.log(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.run(() => {
    const I = window.__vs.kernel.get("input");
    window.__trace = [];
    const orig = I._wake.bind(I);
    I._wake = function (kind) {
      window.__trace.push({
        kind,
        device: I.device,
        simTime: +I.simTime.toFixed(4),
        deviceAt: +I._deviceAt.toFixed(4),
        gap: +(I.simTime - I._deviceAt).toFixed(4),
        dwell: 0.35,
      });
      return orig(kind);
    };
    window.__snap = () => ({
      device: I.device,
      simTime: +I.simTime.toFixed(4),
      deviceAt: +I._deviceAt.toFixed(4),
      edges: I._padEdges,
      latchB: I._padLatch.B === true,
      latchA: I._padLatch.A === true,
    });
    return true;
  });

  // 1. pad claims
  await d.run(() => {
    const K = window.__vs.kernel, H = window.__vsInput;
    H.connect({ style: "xbox" });
    H.press("A"); H.poll(); K.advance(0.3); H.release("A"); K.advance(0.5);
    return true;
  });
  log("1_PAD", await d.run(() => window.__snap()));

  // 2. real key takes over
  await d.page.keyboard.down("w");
  await d.run(() => window.__vs.kernel.advance(0.5));
  await d.page.keyboard.up("w");
  await d.run(() => window.__vs.kernel.advance(0.5));
  log("2_KEY", await d.run(() => window.__snap()));

  // 3. pad presses a button again — should reclaim after the dwell
  await d.run(() => {
    const K = window.__vs.kernel, H = window.__vsInput;
    H.press("B"); H.poll(); K.advance(0.5); H.release("B"); K.advance(0.5);
    return true;
  });
  log("3_PAD_AGAIN", await d.run(() => window.__snap()));

  // 4. pad moves a stick a long way — should also reclaim
  await d.run(() => {
    const K = window.__vs.kernel, H = window.__vsInput;
    H.stick("left", 0, -0.9); H.poll(); K.advance(0.5);
    H.stick("left", 0, 0); H.poll(); K.advance(0.5);
    return true;
  });
  log("4_PAD_STICK", await d.run(() => window.__snap()));

  log("TRACE", await d.run(() => window.__trace));
});
console.log("\n===== END C =====");
