/** Critic's independent budget + sun-direction probe on the shipped spawn frame. */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 1600, height: 900, tier: "high" }, async (d) => {
  await d.play(1.2);
  const out = await d.run(() => {
    const vs = window.__vs;
    const K = vs.kernel;
    const renderer = K.renderer, scene = K.scene, camera = K.camera;
    const info = renderer ? JSON.parse(JSON.stringify(renderer.info.render)) : null;
    const mem = renderer ? JSON.parse(JSON.stringify(renderer.info.memory)) : null;
    // sun direction from the lighting rig
    const lights = [];
    if (scene) scene.traverse((o) => {
      if (o.isDirectionalLight) {
        const p = o.getWorldPosition(new (o.position.constructor)());
        lights.push({ type: "dir", intensity: o.intensity, pos: [p.x, p.y, p.z].map(v => +v.toFixed(1)), color: o.color.getHexString() });
      } else if (o.isHemisphereLight || o.isAmbientLight) {
        lights.push({ type: o.isHemisphereLight ? "hemi" : "amb", intensity: o.intensity });
      }
    });
    const cam = camera ? { pos: [camera.position.x, camera.position.y, camera.position.z].map(v => +v.toFixed(1)), fov: camera.fov } : null;
    // count meshes actually in the frame
    let meshes = 0, tri = 0;
    if (scene) scene.traverse((o) => {
      if (o.isMesh && o.visible) {
        meshes++;
        const g = o.geometry;
        if (g && g.index) tri += g.index.count / 3; else if (g && g.attributes.position) tri += g.attributes.position.count / 3;
      }
    });
    return { info, mem, lights, cam, meshes, sceneTri: Math.round(tri), keys: K.keys ? K.keys() : Object.keys(K.modules || {}) };
  });
  console.log(JSON.stringify(out, null, 1));
});
