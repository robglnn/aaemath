#!/usr/bin/env node
/** Scratch: cost of a camera->quad raycast occlusion sample in the SHIPPED spawn scene. */
import { openGame, arg } from "../../tools/lib/session.mjs";

const LANG = arg("lang", "en");

await openGame({ width: 1600, height: 900, lang: LANG, tier: "low" }, async (d) => {
  await d.play(1.2);
  const out = await d.run(async () => {
    const THREE = await import("/@fs/C:/dev/math/aaemath/node_modules/three/build/three.module.js");
    const k = window.__vs.kernel;
    const cam = k.camera;
    cam.updateMatrixWorld(true);
    const occluders = [];
    k.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if ((o.name || "").startsWith("tex:")) return;
      const m = o.material;
      const one = Array.isArray(m) ? m[0] : m;
      if (!one || one.depthWrite === false) return;
      occluders.push(o);
    });
    const tris = occluders.reduce((s, o) => s + (o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count ?? 0) / 3), 0);

    const panels = [];
    k.scene.traverse((o) => { if ((o.name || "").startsWith("tex:")) panels.push(o); });

    const ray = new THREE.Raycaster();
    ray.firstHitOnly = true;
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const rows = [];
    let totalMs = 0;
    let rays = 0;
    for (const o of panels) {
      o.updateMatrixWorld(true);
      let blocked = 0;
      let n = 0;
      const t0 = performance.now();
      for (let iy = 0; iy < 5; iy++) {
        for (let ix = 0; ix < 7; ix++) {
          p.set(-0.5 + (ix + 0.5) / 7, -0.5 + (iy + 0.5) / 5, 0);
          o.localToWorld(p);
          dir.copy(p).sub(cam.position);
          const dist = dir.length();
          ray.set(cam.position, dir.normalize());
          ray.far = dist - 0.02;
          ray.near = 0.01;
          n++;
          rays++;
          if (ray.intersectObjects(occluders, false).length) blocked++;
        }
      }
      const ms = performance.now() - t0;
      totalMs += ms;
      rows.push({ id: o.name.slice(4), n, blocked, pct: Number(((blocked / n) * 100).toFixed(1)), ms: Number(ms.toFixed(2)) });
    }
    return { occluders: occluders.length, tris, rows, totalMs: Number(totalMs.toFixed(2)), rays, msPerRay: Number((totalMs / rays).toFixed(3)) };
  });
  console.log(JSON.stringify(out, null, 1));
});
