/** Critic's independent light-sign test on the SHIPPED spawn frame.
 *
 * Method (no hand-rolled ray builder, no synthetic scene):
 *   - take the SHIPPED scene's real meshes,
 *   - for every triangle, compute the world-space FACE normal from the world-transformed vertices,
 *   - project the three world vertices through the SHIPPED camera's own projectionMatrix *
 *     matrixWorldInverse (and prove the projector round-trips by re-projecting a known point),
 *   - keep only FRONT-FACING triangles (normal . viewDir < 0) with a screen area over 300 px,
 *     which for the near convex shards means "actually visible",
 *   - sample the shipped capture at the projected centroid,
 *   - correlate N.L against rendered luminance.
 */
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";
import { readPNG, px, hsv, lum } from "../p02-png.mjs";

const W = 1600, H = 900;
const SHOT = path.join("review", "shots", "critic-P09-r2-sun.png");

await openGame({ width: W, height: H, tier: "high" }, async (d) => {
  await d.play(1.2);
  await d.shoot(SHOT);
  const M = await d.run(({ W, H }) => {
    const K = window.__vs.kernel;
    const scene = K.scene, camera = K.camera;
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    let key = null;
    scene.traverse(o => { if (o.isDirectionalLight && (!key || o.intensity > key.intensity)) key = o; });
    const kp = key.getWorldPosition(key.position.clone());
    key.target.updateMatrixWorld(true);
    const kt = key.target.getWorldPosition(key.position.clone());
    let Lx = kp.x - kt.x, Ly = kp.y - kt.y, Lz = kp.z - kt.z;
    const Ln = Math.hypot(Lx, Ly, Lz); Lx /= Ln; Ly /= Ln; Lz /= Ln;

    const vp = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const e = vp.elements;
    const project = (x, y, z) => {
      const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) return null;
      return [((cx / cw) * 0.5 + 0.5) * W, (1 - ((cy / cw) * 0.5 + 0.5)) * H];
    };
    // round-trip proof: the camera's own position + forward must land at frame centre
    const fwd = new (camera.position.constructor)(0, 0, -1).applyQuaternion(camera.quaternion);
    const probe = project(camera.position.x + fwd.x * 50, camera.position.y + fwd.y * 50, camera.position.z + fwd.z * 50);
    const roundTripPx = probe ? Math.hypot(probe[0] - W / 2, probe[1] - H / 2) : 9999;

    const cam = camera.position;
    const tris = [];
    const objCount = {};
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let p = o.parent, vis = true;
      while (p) { if (!p.visible) vis = false; p = p.parent; }
      if (!vis) return;
      const g = o.geometry; const pos = g && g.attributes && g.attributes.position;
      if (!pos) return;
      const idx = g.index ? g.index.array : null;
      const n = idx ? idx.length : pos.count;
      if (n > 400000) return;
      const m = o.matrixWorld.elements;
      const tx = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const label = o.name || (o.material && o.material.name) || "unnamed";
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
        const A = tx(pos.getX(a), pos.getY(a), pos.getZ(a));
        const B = tx(pos.getX(b), pos.getY(b), pos.getZ(b));
        const C = tx(pos.getX(c), pos.getY(c), pos.getZ(c));
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const nl = Math.hypot(nx, ny, nz); if (nl < 1e-9) continue;
        nx /= nl; ny /= nl; nz /= nl;
        const cx3 = (A[0] + B[0] + C[0]) / 3, cy3 = (A[1] + B[1] + C[1]) / 3, cz3 = (A[2] + B[2] + C[2]) / 3;
        const dx = cx3 - cam.x, dy = cy3 - cam.y, dz = cz3 - cam.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 200) continue;
        if ((nx * dx + ny * dy + nz * dz) > 0) continue;          // back-facing
        const pA = project(...A), pB = project(...B), pC = project(...C);
        if (!pA || !pB || !pC) continue;
        const area = Math.abs((pB[0] - pA[0]) * (pC[1] - pA[1]) - (pC[0] - pA[0]) * (pB[1] - pA[1])) / 2;
        if (area < 300) continue;
        const sx = Math.round((pA[0] + pB[0] + pC[0]) / 3), sy = Math.round((pA[1] + pB[1] + pC[1]) / 3);
        if (sx < 2 || sy < 2 || sx >= W - 2 || sy >= H - 2) continue;
        objCount[label] = (objCount[label] || 0) + 1;
        tris.push({ sx, sy, ndl: +(nx * Lx + ny * Ly + nz * Lz).toFixed(4), dist: +dist.toFixed(1), area: Math.round(area), label });
      }
    });
    return { L: [Lx, Ly, Lz].map(v => +v.toFixed(3)), keyPos: [kp.x, kp.y, kp.z].map(v => +v.toFixed(1)), keyTgt: [kt.x, kt.y, kt.z].map(v => +v.toFixed(1)), keyI: key.intensity, roundTripPx: +roundTripPx.toFixed(2), tris, objCount };
  }, { W, H });

  console.log("key light dir (toward light) =", M.L, " pos", M.keyPos, "target", M.keyTgt, "intensity", M.keyI.toFixed(2));
  console.log("projector round-trip error:", M.roundTripPx, "px (must be < 1)");
  console.log("front-facing tris >300px within 200 m:", M.tris.length);
  console.log("by object:", Object.entries(M.objCount).sort((a, b) => b[1] - a[1]).slice(0, 12).map(a => `${a[0]}=${a[1]}`).join("  "));

  const img = readPNG(path.join(ROOT, SHOT));
  const rows = [];
  for (const t of M.tris) {
    const [r, g, b] = px(img, t.sx, t.sy);
    const [hu, s] = hsv(r, g, b);
    if (hu >= 150 && hu <= 205 && s >= 0.35) continue;   // cyan carry — another read
    if (hu >= 60 && hu < 150) continue;                  // foliage
    rows.push({ ...t, Y: lum(r, g, b), hue: hu, sat: s });
  }
  console.log("rock-family samples:", rows.length);
  const stat = (a) => a.length ? { n: a.length, Y: +(a.reduce((s, r) => s + r.Y, 0) / a.length).toFixed(4), hue: +(a.reduce((s, r) => s + r.hue, 0) / a.length).toFixed(1), sat: +(a.reduce((s, r) => s + r.sat, 0) / a.length).toFixed(2) } : { n: 0 };
  const toward = rows.filter(r => r.ndl > 0.12), away = rows.filter(r => r.ndl < -0.08);
  console.log("  N.L > +0.12 turned TOWARD key:", JSON.stringify(stat(toward)));
  console.log("  N.L < -0.08 turned AWAY  key:", JSON.stringify(stat(away)));
  const t = stat(toward), a = stat(away);
  if (t.n && a.n) console.log("  Y(toward)/Y(away) =", (t.Y / a.Y).toFixed(2), t.Y > a.Y * 1.5 ? "(correct)" : "*** LIGHT SIGN IS INVERTED ON THE SHIPPED ROCK ***");
  for (const label of ["vs.level.rock", "vs.terrain.surface", "vs.terrain.keel"]) {
    const sub = rows.filter(r => r.label === label);
    if (!sub.length) continue;
    console.log(`\n--- ${label} (n=${sub.length}) ---`);
    for (const [lo, hi] of [[-1, -0.5], [-0.5, -0.2], [-0.2, 0], [0, 0.2], [0.2, 0.5], [0.5, 1.01]]) {
      const g = sub.filter(r => r.ndl >= lo && r.ndl < hi);
      const s = stat(g);
      const warm = g.filter(r => r.hue < 60 || r.hue > 330).length;
      console.log(`    N.L [${lo}, ${hi})  n=${String(s.n).padStart(4)}  Y=${s.n ? s.Y : "-"}  warmShare=${g.length ? (warm / g.length).toFixed(2) : "-"}`);
    }
    const t2 = stat(sub.filter(r => r.ndl > 0.12)), a2 = stat(sub.filter(r => r.ndl < -0.08));
    console.log(`    toward n=${t2.n} Y=${t2.Y}   away n=${a2.n} Y=${a2.Y}   ratio=${t2.n && a2.n ? (t2.Y / a2.Y).toFixed(2) : "-"}`);
  }
});
