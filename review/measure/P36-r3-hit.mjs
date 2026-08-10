/**
 * P36 round 3 — what is actually drawn at the pixel a socket projects to?
 *
 * The sockets are in frame and the collision world says nothing stands between the lens and them,
 * yet three of the four are worth 0 pixels. Collision geometry and rendered geometry are not the
 * same set, so the only way to settle it is to ask the renderer's own scene graph: cast a
 * `THREE.Raycaster` through the socket's screen NDC and report the first drawn thing it meets, its
 * distance, and its material type — a material that does not sample point lights cannot show a
 * spill however bright it is.
 *
 * usage: node review/measure/P36-r3-hit.mjs
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
    const cam = k.camera;
    cam.updateMatrixWorld();
    const res = window.__vs.probe("mathresonance");
    // No THREE handle on the page; borrow the field's own raycaster instance (it is a real
    // THREE.Raycaster, used by `TexField.occlusionReport`).
    const rc = k.get("mathtex")._raycaster;
    const V3 = cam.position.constructor;
    const rows = [];
    for (const c of res?.claims ?? []) {
      const p = new V3(c.socket[0], c.socket[1], c.socket[2]);
      const ndc = p.clone().project(cam);
      rc.setFromCamera({ x: ndc.x, y: ndc.y }, cam);
      rc.far = 4000;
      const hits = rc.intersectObject(k.scene, true).filter((hh) => {
        const m = hh.object?.material;
        return hh.object?.visible !== false && m && m.depthWrite !== false;
      });
      const dist = p.distanceTo(cam.position);
      rows.push({
        id: c.id,
        socket: c.socket,
        socketMetresFromLens: +dist.toFixed(2),
        drawnHere: hits.slice(0, 3).map((hh) => ({
          object: hh.object.name || hh.object.type,
          metres: +hh.distance.toFixed(2),
          material: hh.object.material?.type,
          materialName: hh.object.material?.name || null,
        })),
        // Positive = something is drawn NEARER than the socket, so the spill is behind it.
        nearestDrawnMinusSocket: hits.length ? +(hits[0].distance - dist).toFixed(2) : null,
      });
    }
    return { lens: cam.position.toArray().map((v) => +v.toFixed(2)), rows };
  });
  console.log(JSON.stringify(out, null, 2));
});
