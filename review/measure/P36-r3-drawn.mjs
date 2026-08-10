/**
 * P36 round 3 — control for the "the renderer draws nothing under three of the claims" finding.
 *
 * A downward `THREE.Raycaster` from a claim's ink meets no drawn triangle until the world's keel
 * 90 m below, while `collision.groundAt` and `terrain.groundAt` both answer 51.18 there. Before
 * that is reported as a hole in the drawn terrain it has to be shown that the same cast DOES find
 * drawn ground where drawn ground certainly exists — under the body the avatar is standing on.
 *
 * usage: node review/measure/P36-r3-drawn.mjs
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
    const field = k.get("mathtex");
    const rc = field._raycaster;
    const V3 = k.camera.position.constructor;
    const castDown = (x, y, z) => {
      rc.set(new V3(x, y, z), new V3(0, -1, 0));
      rc.near = 0;
      rc.far = 400;
      return rc
        .intersectObject(k.scene, true)
        .filter((h) => h.object?.visible !== false && h.object?.material?.depthWrite !== false)
        .slice(0, 2)
        .map((h) => ({ object: h.object.name || h.object.type, y: +h.point.y.toFixed(2), metres: +h.distance.toFixed(2) }));
    };

    const body = window.__vs.probe("locomotion").position;
    const socket = window.__vs.probe("mathresonance").claims[0].socket;
    // The control and the map in one: walk from beside the body out to the socket, casting down
    // from 3 m up at each step. Started 2 m to the side so the avatar's own head is not the answer.
    const along = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = body[0] + 2 + (socket[0] - body[0]) * t;
      const z = body[2] + (socket[2] - body[2]) * t;
      const g = col.groundAt(x, z, 500);
      along.push({
        t,
        xz: [+x.toFixed(2), +z.toFixed(2)],
        collisionGroundY: g.hit ? +g.y.toFixed(2) : null,
        drawn: castDown(x, (g.hit ? g.y : body[1]) + 40, z),
      });
    }
    const rows = {
      along,
      overSockets: (window.__vs.probe("mathresonance").claims ?? []).map((c) => ({
        id: c.id,
        from: c.ink,
        collisionGroundY: c.socket[1] - 1,
        drawn: castDown(c.ink[0], c.ink[1], c.ink[2]),
      })),
    };

    // every drawn mesh whose name starts vs.terrain, with its world-space Y extent
    const terrain = [];
    k.scene.traverse((o) => {
      if (!o.isMesh || !/^vs\.terrain/.test(o.name ?? "")) return;
      o.geometry.computeBoundingBox?.();
      const b = o.geometry.boundingBox;
      terrain.push({
        name: o.name,
        triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
        bboxY: b ? [+b.min.y.toFixed(1), +b.max.y.toFixed(1)] : null,
        bboxXZ: b ? [+b.min.x.toFixed(1), +b.min.z.toFixed(1), +b.max.x.toFixed(1), +b.max.z.toFixed(1)] : null,
        side: o.material?.side,
      });
    });
    return { ...rows, terrain };
  });
  console.log(JSON.stringify(out, null, 2));
});
