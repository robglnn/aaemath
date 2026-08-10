// Scratch diagnostic: does the rendered value on the hero shard correlate with N.L, and which
// N and which L is the renderer actually using?
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";
import { readPNG, px, hsv, lum } from "../p02-png.mjs";

const SHOT = path.join("review", "shots", "p09", "sunprobe.png");

await openGame({ width: 1600, height: 900, tier: "high" }, async (d) => {
  await d.play(1.2);
  const M = await d.run(() => {
    const K = window.__vs.kernel;
    const level = K.get("level01");
    const collision = K.get("collision");
    const L = level.snapshot();
    const cam = K.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const W = K.renderer.domElement.clientWidth;
    const H = K.renderer.domElement.clientHeight;
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    const eyeP = [e[12], e[13], e[14]];
    const mat = level.rockMesh.material;
    const uni = mat.userData.vsShader?.uniforms ?? {};
    const uSun = uni.uVsSun?.value ? [uni.uVsSun.value.x, uni.uVsSun.value.y, uni.uVsSun.value.z] : null;
    const sh = (L.heroShards ?? [])[0];
    const out = [];
    const hit = {};
    for (let py = 40; py < H; py += 6) {
      for (let pxl = 180; pxl < 700; pxl += 6) {
        const rv = cam.position.clone();
        rv.set((pxl / W) * 2 - 1, -((py / H) * 2 - 1), 0.5).unproject(cam);
        rv.sub(cam.position).normalize();
        const dx = rv.x, dy = rv.y, dz = rv.z;
        const r = collision.raycast(eyeP[0], eyeP[1], eyeP[2], dx, dy, dz, 200, hit);
        if (!r.hit) continue;
        const f = Math.max(0, Math.min(1, (r.y - sh.y) / sh.height));
        const axX = sh.x + sh.lean[0] * f;
        const axZ = sh.z + sh.lean[1] * f;
        const rad = Math.hypot(r.x - axX, r.z - axZ);
        if (rad > sh.radius * 1.35 || rad < sh.radius * 0.4 || r.y < sh.y + 10 || r.y > sh.y + sh.height) continue;
        // radially outward normal in XZ, the unambiguous "outside of the spire" direction
        const ox = (r.x - axX) / (rad || 1);
        const oz = (r.z - axZ) / (rad || 1);
        out.push({
          x: pxl, y: py,
          n: [+r.nx.toFixed(3), +r.ny.toFixed(3), +r.nz.toFixed(3)],
          radialDot: +(r.nx * ox + r.nz * oz).toFixed(3),
          d: +r.t.toFixed(1),
        });
      }
    }
    return { sun: L.sun, uSun, shard: sh, samples: out, viewport: [W, H] };
  });
  await d.shoot(SHOT);
  globalThis.__M = M;
});

const M = globalThis.__M;
const img = readPNG(path.resolve(ROOT, SHOT));
console.log("sun (level snapshot):", JSON.stringify(M.sun));
console.log("uVsSun on vs.level.rock:", JSON.stringify(M.uSun));
console.log("shard:", JSON.stringify(M.shard));
const sun = M.uSun ?? M.sun?.toLight ?? [0.87, 0.19, -0.46];
const bins = new Map();
let inward = 0;
for (const s of M.samples) {
  if (s.radialDot < 0) inward++;
  const ndl = s.n[0] * sun[0] + s.n[1] * sun[1] + s.n[2] * sun[2];
  const [r, g, b] = px(img, s.x, s.y);
  const key = Math.round(ndl * 5) / 5;
  const arr = bins.get(key) ?? [];
  arr.push({ Y: lum(r, g, b), h: hsv(r, g, b)[0] });
  bins.set(key, arr);
}
console.log(`samples ${M.samples.length}, with collision normal pointing INTO the spire: ${inward}`);
console.log("N.L bucket | n | median Y | median hue");
for (const k of [...bins.keys()].sort((a, b) => a - b)) {
  const a = bins.get(k);
  const ys = a.map((o) => o.Y).sort((p, q) => p - q);
  const hs = a.map((o) => o.h).sort((p, q) => p - q);
  console.log(
    String(k).padStart(6), String(a.length).padStart(6),
    ys[Math.floor(ys.length / 2)].toFixed(4).padStart(9),
    hs[Math.floor(hs.length / 2)].toFixed(1).padStart(8)
  );
}
