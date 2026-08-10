/**
 * P36 round 3 — the same zero-time A/B, but on the gameplay path rather than the spawn frame.
 *
 * At spawn three of the four claims stand out past the rim of the leaf, so their sockets are on
 * real rock that the spawn camera cannot see: the spill is there, the view is not. That is a
 * composition fact, not a wiring one, and the honest way to price it is to walk to where a player
 * walks and re-run the identical measurement.
 *
 *   stage 1  spawn                         (the frame the critic priced at 0 px)
 *   stage 2  after E                       (the interaction path)
 *   stage 3  after walking forward         (down the slope the claims stand over)
 *
 * Each stage halts the loop, renders twice at `advance(0)`, and diffs the drawing buffer with the
 * accents live against the same frame with every accent removed in place. Control is the two-render
 * noise floor and must be 0 for the number under it to mean anything.
 *
 * usage: node review/measure/P36-r3-play.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

const INSTRUMENT = () => {
  const k = window.__vs.kernel;
  const L = k.get("lighting");
  const gl = k.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  // Halt once and stay halted: `advance()` steps the world regardless of mode, so every later
  // stage still plays — it just never advances behind a readPixels.
  k.halt();

  const snap = () => {
    k.advance(0);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const diff = (a, b) => {
    let changed = 0;
    let maxd = 0;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      const m = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2])
      );
      if (m > 0) changed++;
      if (m > maxd) maxd = m;
      sum += m;
    }
    const px = a.length / 4;
    return {
      pixelsChanged: changed,
      percentChanged: +((100 * changed) / px).toFixed(4),
      maxChannelDelta: maxd,
      meanChannelDelta: +(sum / px).toFixed(5),
    };
  };

  const A0 = snap();
  const A1 = snap();
  const saved = new Map(L._accents);
  const realAdd = L.addAccent;
  L.addAccent = () => {};
  L._accents.clear();
  const B = snap();
  const treatment = diff(A1, B);
  L.addAccent = realAdd;
  for (const [id, e] of saved) L._accents.set(id, e);
  snap();

  const pos = window.__vs.probe("locomotion")?.position ?? [0, 0, 0];
  const near = [];
  k.scene.traverse((o) => {
    if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "") || o.intensity <= 0) return;
    const p = o.getWorldPosition(new o.position.constructor());
    near.push({
      light: o.name,
      metresFromBody: +Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]).toFixed(2),
      falloff: o.distance,
    });
  });
  near.sort((a, b) => a.metresFromBody - b.metresFromBody);

  return {
    simTime: +k.simTime.toFixed(3),
    body: pos.map((v) => +v.toFixed(2)),
    accents: window.__vs.probe("lighting")?.accents,
    closestAccent: near[0] ?? null,
    control: diff(A0, A1),
    treatment,
  };
};

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  const stages = {};

  await d.play(2);
  stages.spawn = await d.run(INSTRUMENT);

  await d.page.keyboard.down("KeyE");
  await d.play(0.2);
  await d.page.keyboard.up("KeyE");
  await d.play(1);
  stages.afterE = await d.run(INSTRUMENT);

  await d.hold("KeyW", 3.5);
  await d.play(0.5);
  stages.walked = await d.run(INSTRUMENT);

  console.log(JSON.stringify(stages, null, 2));
  const rep = await d.report();
  console.log("errors:", rep.errors.length, "| warnings:", rep.warnings.length);
});
