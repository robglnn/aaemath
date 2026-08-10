/**
 * P36 round 3 — WHY a spill is or is not in the frame.
 *
 * The zero-time A/B says how many pixels the accents are worth. When that number is small the only
 * honest follow-up is: where did the light land, is that point in the frame at all, and is anything
 * standing between the lens and it. This projects every socket to screen space and casts the
 * camera's own ray at it.
 *
 * usage: node review/measure/P36-r3-where.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

const WHERE = () => {
  const k = window.__vs.kernel;
  const col = k.get("collision");
  const cam = k.camera;
  const res = window.__vs.probe("mathresonance");
  const gl = k.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  cam.updateMatrixWorld();
  const V = cam.position;
  const rows = (res?.claims ?? []).map((c) => {
    const p = new cam.position.constructor(c.socket[0], c.socket[1], c.socket[2]);
    const ndc = p.clone().project(cam);
    const inFrame = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z > -1 && ndc.z < 1;
    const dx = c.socket[0] - V.x;
    const dy = c.socket[1] - V.y;
    const dz = c.socket[2] - V.z;
    const dist = Math.hypot(dx, dy, dz);
    const r = col.sphereCast(
      { x: V.x, y: V.y, z: V.z },
      { x: dx / dist, y: dy / dist, z: dz / dist },
      0.05,
      dist
    );
    return {
      id: c.id,
      ink: c.ink,
      socket: c.socket,
      drop: c.drop,
      grounded: c.grounded,
      metresFromLens: +dist.toFixed(2),
      screenPx: [Math.round(((ndc.x + 1) / 2) * w), Math.round(((1 - ndc.y) / 2) * h)],
      inFrame,
      lineOfSightBlockedAt: r?.hit && r.distance < dist - 0.25 ? +r.distance.toFixed(2) : null,
    };
  });
  return {
    simTime: +k.simTime.toFixed(3),
    lens: [+V.x.toFixed(2), +V.y.toFixed(2), +V.z.toFixed(2)],
    frame: [w, h],
    claims: rows,
  };
};

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  const out = {};
  await d.play(2);
  out.spawn = await d.run(WHERE);

  await d.page.keyboard.down("KeyE");
  await d.play(0.2);
  await d.page.keyboard.up("KeyE");
  await d.play(1);
  out.afterE = await d.run(WHERE);

  console.log(JSON.stringify(out, null, 2));
});
