#!/usr/bin/env node
// TEMPORARY diagnostic — delete before handoff. Where are the written texels in cascade 0's map?
import { openGame, arg } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";

const TIER = arg("tier", "medium");

await openGame({ width: 1280, height: 720, tier: TIER }, async (d) => {
  await d.page.route("**/@vite/client*", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "export const createHotContext = () => ({ on(){}, send(){}, accept(){}, dispose(){}, prune(){}, invalidate(){}, decline(){} }); export const injectQuery = (u) => u; export const removeStyle = () => {}; export const updateStyle = () => {};" })
  );
  await d.page.reload({ waitUntil: "load", timeout: 90000 });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
  for (let i = 0; i < 30; i++) {
    await d.play(0.3);
    const s = await d.probe("scatter");
    const l = await d.probe("locomotion");
    if (s?.built && s.outstanding === false && l?.grounded) break;
  }
  await d.play(0.5);
  await d.page.evaluate(installToolkit);

  const out = await d.run(() => {
    const K = window.__vs.kernel;
    const T = window.__p11;
    const L = K.byName.get("lighting");
    const p = T.player();
    const gy = T.groundY(p.x, p.z);
    const res = [];
    for (const c of L.cascades) {
      const map = c.light.shadow.map;
      const w = map.width, h = map.height;
      const buf = new Uint8Array(w * h * 4);
      K.renderer.readRenderTargetPixels(map, 0, 0, w, h, buf);
      const unpack = (i) => (buf[i] + buf[i + 1] / 255 + buf[i + 2] / 65025 + buf[i + 3] / 16581375) / 255;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0;
      // 32x32 coarse occupancy map
      const cell = 32, occ = [];
      for (let cy = 0; cy < cell; cy++) {
        let row = "";
        for (let cx = 0; cx < cell; cx++) {
          let hit = 0, tot = 0;
          for (let y = (cy * h) / cell; y < ((cy + 1) * h) / cell; y += 4)
            for (let x = (cx * w) / cell; x < ((cx + 1) * w) / cell; x += 4) {
              const dp = unpack(((y | 0) * w + (x | 0)) * 4);
              tot++;
              if (dp < 0.999) hit++;
            }
          row += hit === 0 ? "." : hit / tot > 0.5 ? "#" : hit / tot > 0.15 ? "+" : "-";
        }
        occ.push(row);
      }
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          if (unpack((y * w + x) * 4) < 0.999) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      // the shadow-map UV of the player's foot
      c.light.updateMatrixWorld(true); c.light.target.updateMatrixWorld(true);
      c.light.shadow.updateMatrices(c.light);
      const e = c.light.shadow.matrix.elements;
      const proj = (x, y, z) => {
        const X = e[0] * x + e[4] * y + e[8] * z + e[12];
        const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
        const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
        const W = e[3] * x + e[7] * y + e[11] * z + e[15];
        return [X / W, Y / W, Z / W];
      };
      const footUV = proj(p.x, gy, p.z);
      const headUV = proj(p.x, gy + 1.8, p.z);
      const readAt = (uv) => {
        const x = Math.round(uv[0] * w), y = Math.round(uv[1] * h);
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        return +unpack((y * w + x) * 4).toFixed(5);
      };
      res.push({
        name: c.light.name,
        writtenBBox: n ? { minX, maxX, minY, maxY, pct: [+(minX / w).toFixed(3), +(maxX / w).toFixed(3), +(minY / h).toFixed(3), +(maxY / h).toFixed(3)] } : null,
        writtenSamples: n,
        foot: { uv: footUV.map((v) => +v.toFixed(4)), depthInMap: readAt(footUV) },
        head: { uv: headUV.map((v) => +v.toFixed(4)), depthInMap: readAt(headUV) },
        occupancy: occ,
      });
    }
    return { player: [p.x, gy, p.z], res };
  });
  console.log(JSON.stringify(out, null, 2).replace(/\\"/g, '"'));
  for (const r of out.res) {
    console.log("\n=== " + r.name + " occupancy (32x32, . = untouched) ===");
    for (const row of r.occupancy) console.log(row);
  }
});
