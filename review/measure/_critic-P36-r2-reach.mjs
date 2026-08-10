/**
 * CRITIC-OWNED, round 2 — closes the last loophole in the pixel verdict.
 *
 * The zero-time A/B says removing every accent changes no pixel IN THE FRAME. A fair reading has to
 * rule out "it lights something behind the camera". So: from each lit accent, sphere-cast in 26
 * directions out to its own falloff and see whether ANY surface in the world is inside it, in view
 * or not. Uses the collision world the camera boom itself trusts; emits nothing.
 *
 * usage: node review/measure/_critic-P36-r2-reach.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 640, height: 360 }, async (d) => {
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
    const dirs = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      if (!x && !y && !z) continue;
      const l = Math.hypot(x, y, z);
      dirs.push([x / l, y / l, z / l]);
    }
    const rows = [];
    k.scene.traverse((o) => {
      if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "") || o.intensity <= 0) return;
      const p = o.getWorldPosition(new o.position.constructor());
      let nearest = Infinity;
      let hits = 0;
      for (const [dx, dy, dz] of dirs) {
        const r = col.sphereCast?.(
          { x: p.x, y: p.y, z: p.z },
          { x: dx, y: dy, z: dz },
          0.05,
          o.distance
        );
        const dist = typeof r === "number" ? r : r?.distance;
        const hit = typeof r === "number" ? r < o.distance - 1e-3 : r?.hit === true;
        if (hit && typeof dist === "number") {
          hits++;
          if (dist < nearest) nearest = dist;
        }
      }
      rows.push({
        light: o.name,
        falloff: o.distance,
        at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        directionsHit: hits,
        ofDirections: dirs.length,
        nearestSurfaceMetres: nearest === Infinity ? null : +nearest.toFixed(2),
      });
    });
    // sanity: the same cast from the player's own position must find the ground
    const pos = window.__vs.probe("locomotion")?.position ?? [0, 0, 0];
    const down = col.sphereCast?.({ x: pos[0], y: pos[1] + 1, z: pos[2] }, { x: 0, y: -1, z: 0 }, 0.05, 5);
    return { rows, sanityDownFromPlayer: typeof down === "number" ? down : down };
  });
  console.log(JSON.stringify(out, null, 2));
});
