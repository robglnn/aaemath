#!/usr/bin/env node
// Throwaway diagnostic for P09 round 3: what paints the bottom of the arrival frame, and why do
// faces turned toward the key render as the shadow family. Not a claim harness.
import { openGame, arg } from "../../tools/lib/session.mjs";

const WIDTH = Number(arg("width", "1600"));
const HEIGHT = Number(arg("height", "900"));

await openGame({ width: WIDTH, height: HEIGHT, tier: "high" }, async (d) => {
  await d.play(1.2);
  const out = await d.run(() => {
    const K = window.__vs.kernel;
    const terrain = K.get("terrain");
    const cam = K.camera;
    cam.updateMatrixWorld();
    const W = K.renderer.domElement.clientWidth;
    const H = K.renderer.domElement.clientHeight;
    const ray = new (cam.position.constructor)();
    const rc = new (window.__vsTHREE?.Raycaster ?? Object)();

    // What object is under a screen pixel? Use three's own raycaster over the whole scene.
    const THREE_R = rc instanceof Object && rc.setFromCamera ? rc : null;
    const hits = [];
    if (THREE_R) {
      for (const [px, py] of [[300, 880], [800, 875], [1300, 870], [800, 700], [1500, 500]]) {
        THREE_R.setFromCamera({ x: (px / W) * 2 - 1, y: -((py / H) * 2 - 1) }, cam);
        const r = THREE_R.intersectObjects(K.scene.children, true).filter((h) => h.object.visible);
        hits.push({ px, py, top: r.slice(0, 3).map((h) => ({ name: h.object.name || h.object.type, d: Math.round(h.distance) })) });
      }
    }

    // Keel geometry: where does it project?
    const e = cam.matrixWorld.elements;
    const eye = [e[12], e[13], e[14]];
    const scr = (wx, wy, wz) => {
      ray.set(wx, wy, wz).project(cam);
      return [((ray.x + 1) / 2) * W, ((1 - ray.y) / 2) * H, ray.z];
    };
    let onScreen = 0;
    let minD = Infinity;
    let rows = [];
    const kp = terrain.keel?.geometry.getAttribute("position").array ?? [];
    for (let i = 0; i < kp.length; i += 9) {
      const cx = (kp[i] + kp[i + 3] + kp[i + 6]) / 3;
      const cy = (kp[i + 1] + kp[i + 4] + kp[i + 7]) / 3;
      const cz = (kp[i + 2] + kp[i + 5] + kp[i + 8]) / 3;
      const s = scr(cx, cy, cz);
      if (s[2] > 1 || s[0] < 0 || s[0] >= W || s[1] < 0 || s[1] >= H) continue;
      onScreen++;
      const dist = Math.hypot(cx - eye[0], cy - eye[1], cz - eye[2]);
      minD = Math.min(minD, dist);
      if (rows.length < 4000) rows.push([Math.round(s[1]), Math.round(dist)]);
    }
    rows.sort((a, b) => b[0] - a[0]);

    // The shadow rig, as the shader sees it.
    const dl = [];
    K.scene.traverse((o) => {
      if (o.isDirectionalLight) {
        dl.push({
          name: o.name, intensity: o.intensity, castShadow: o.castShadow,
          pos: o.position.toArray().map((v) => Math.round(v)),
          target: o.target?.position.toArray().map((v) => Math.round(v)),
          shadow: o.castShadow ? {
            mapSize: [o.shadow.mapSize.x, o.shadow.mapSize.y],
            bias: o.shadow.bias, normalBias: o.shadow.normalBias, radius: o.shadow.radius,
            cam: { l: o.shadow.camera.left, r: o.shadow.camera.right, t: o.shadow.camera.top, b: o.shadow.camera.bottom, n: o.shadow.camera.near, f: o.shadow.camera.far },
            intensity: o.shadow.intensity,
          } : null,
        });
      }
    });

    const meshes = [];
    K.scene.traverse((o) => {
      if (o.isMesh && o.visible) meshes.push({ name: o.name || o.material?.name, cast: o.castShadow, receive: o.receiveShadow, tris: (o.geometry.getAttribute("position")?.count ?? 0) / 3 });
    });

    return {
      viewport: [W, H],
      camera: { pos: eye.map((v) => Number(v.toFixed(2))), fov: cam.fov },
      pixelHits: hits,
      keel: { onScreen, minDistance: Number(minD.toFixed(1)), lowestRows: rows.slice(0, 12), rowsCounted: rows.length },
      directionalLights: dl,
      meshes: meshes.slice(0, 40),
    };
  });
  console.log(JSON.stringify(out, null, 1));
});
