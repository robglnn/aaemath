/**
 * P36 round 3 — line of sight to each socket, with the EXACT triangle raycast rather than a
 * swept sphere.
 *
 * `CollisionWorld.sphereCast` samples along the ray at `radius/2` and refines; with a 0.05 m probe
 * over 15 m that is a sample every 24 cm, which walks straight through a thin terrain shell. It is
 * the right query for a camera boom and the wrong one for "is anything between the lens and this
 * point". `raycast()` is a DDA over the real triangles and does not tunnel.
 *
 * usage: node review/measure/P36-r3-los.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  await d.play(2);
  const out = await d.run(() => {
    const k = window.__vs.kernel;
    const col = k.get("collision");
    const cam = k.camera;
    cam.updateMatrixWorld();
    const V = cam.position;
    const res = window.__vs.probe("mathresonance");
    return (res?.claims ?? []).map((c) => {
      const dx = c.socket[0] - V.x;
      const dy = c.socket[1] - V.y;
      const dz = c.socket[2] - V.z;
      const dist = Math.hypot(dx, dy, dz);
      const r = col.raycast(V.x, V.y, V.z, dx / dist, dy / dist, dz / dist, dist + 1, {});
      return {
        id: c.id,
        socket: c.socket,
        metresFromLens: +dist.toFixed(2),
        firstSurfaceAt: r?.hit ? +r.t.toFixed(2) : null,
        firstSurfacePoint: r?.hit ? [+r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2)] : null,
        occluded: !!(r?.hit && r.t < dist - 0.5),
      };
    });
  });
  console.log(JSON.stringify(out, null, 2));
});
