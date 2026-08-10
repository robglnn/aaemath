/**
 * P36 round 3 — three different answers to "what is under this claim".
 *
 * `collision.groundAt` finds the first COLLIDABLE surface. The renderer draws a different set: a
 * back-facing triangle (the underside of a keel) collides and is culled, and a scatter boulder is
 * drawn and may not collide. An accent on a surface of the first kind lights nothing a player can
 * ever see, which is the whole failure this piece is fixing — so before choosing a source, print
 * all three side by side.
 *
 *   collision.groundAt(x, z, inkY)      the shipped emitter's current source
 *   terrain.groundAt(x, z)              the drawn heightfield's own answer
 *   Raycaster down the scene            the first FRONT-FACING drawn triangle, which is what a
 *                                       camera above can actually see lit
 *
 * usage: node review/measure/P36-r3-ground.mjs
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
    const terrain = k.byName.get("terrain");
    const field = k.get("mathtex");
    const rc = field._raycaster;
    const V3 = k.camera.position.constructor;
    const rows = [];
    for (const [id, panel] of field.panels) {
      const m = panel.mesh;
      m.updateWorldMatrix(true, false);
      const e = m.matrixWorld.elements;
      const ink = [e[12], e[13], e[14]];

      const c = col.groundAt(ink[0], ink[2], ink[1] + 0.05);
      const t = terrain?.groundAt?.(ink[0], ink[2]);

      rc.set(new V3(ink[0], ink[1], ink[2]), new V3(0, -1, 0));
      rc.far = 400;
      rc.near = 0;
      const drawn = rc
        .intersectObject(k.scene, true)
        .filter((h) => h.object?.visible !== false && h.object?.material?.depthWrite !== false)
        .slice(0, 3)
        .map((h) => ({
          object: h.object.name || h.object.type,
          y: +h.point.y.toFixed(2),
          metresBelowInk: +h.distance.toFixed(2),
          material: h.object.material?.name || h.object.material?.type,
          // THREE respects material.side, so a hit here is a triangle the camera can also see lit.
          side: h.object.material?.side,
        }));

      rows.push({
        id,
        ink: ink.map((v) => +v.toFixed(2)),
        collisionGroundY: c?.hit ? +c.y.toFixed(2) : null,
        terrainGroundY: typeof t === "number" ? +t.toFixed(2) : t?.y ?? null,
        drawnBelow: drawn,
      });
    }
    return rows;
  });
  console.log(JSON.stringify(out, null, 2));
});
