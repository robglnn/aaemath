#!/usr/bin/env node
/**
 * CRITIC probe for P15, round 1 — how much of each standing claim actually reaches the eye.
 *
 * Measured on the SHIPPED GAME at spawn: the real dev-server page, the real boot modules, the
 * real `leaf9-*` claims placed by `app/src/boot/60-mathtex.js`, the real terrain and scatter.
 * Nothing is spawned and no module is stubbed.
 *
 * Method: capture the spawn frame twice — once as shipped, once with `depthTest` turned off on
 * the claim meshes only (so the world cannot eat them) — and count ink pixels in each. The
 * difference is exactly the ink the world geometry is cutting out of the mathematics, in real
 * pixels. The second capture is a measuring instrument, not a proposal; the shipped material
 * is restored before the run ends.
 */
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { openGame, ROOT, arg } from "../../tools/lib/session.mjs";

const LANG = arg("lang", "en");
const W = Number(arg("width", "1600"));
const H = Number(arg("height", "900"));
const OUT = path.join(ROOT, "review", "shots", "p15", "critic");
fs.mkdirSync(OUT, { recursive: true });

function readPng(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const cd = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = cd.readUInt32BE(0); h = cd.readUInt32BE(4); bd = cd[8]; ct = cd[9]; }
    else if (type === "IDAT") idat.push(cd);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

/** Near-white ink: the claims are the only pure-white thing in the frame (target: 254). */
function inkMask(img, box) {
  const { data, channels, width } = img;
  let n = 0;
  const set = new Uint8Array(img.width * img.height);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      if (mn >= 232 && mx - mn <= 14) { set[y * width + x] = 1; n++; }
    }
  }
  return { set, n };
}

await openGame({ width: W, height: H, lang: LANG, tier: "low" }, async (d) => {
  await d.play(1.0);
  const rects = await d.run(() => {
    const k = window.__vs.kernel;
    const cam = k.camera;
    cam.updateMatrixWorld(true);
    const out = [];
    k.scene.traverse((o) => {
      if (!(o.name || "").startsWith("tex:")) return;
      o.updateMatrixWorld(true);
      const v = cam.position.clone();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        v.set(lx, ly, 0);
        o.localToWorld(v);
        v.project(cam);
        x0 = Math.min(x0, (v.x * 0.5 + 0.5) * innerWidth);
        x1 = Math.max(x1, (v.x * 0.5 + 0.5) * innerWidth);
        y0 = Math.min(y0, (-v.y * 0.5 + 0.5) * innerHeight);
        y1 = Math.max(y1, (-v.y * 0.5 + 0.5) * innerHeight);
      }
      out.push({
        id: o.name.slice(4),
        x0: Math.max(0, Math.floor(x0) - 2), y0: Math.max(0, Math.floor(y0) - 2),
        x1: Math.min(innerWidth, Math.ceil(x1) + 2), y1: Math.min(innerHeight, Math.ceil(y1) + 2),
        depthTest: o.material.depthTest, depthWrite: o.material.depthWrite, renderOrder: o.renderOrder,
        texture: o.material.map ? [o.material.map.image.width, o.material.map.image.height] : null,
      });
    });
    return out;
  });

  // NB: `kernel.halt()` freezes the render loop, so a capture taken after it shows the frame
  // that was already on the buffer. Both captures here therefore advance a frame first.
  const shipped = path.join(OUT, `occl-shipped-${LANG}.png`);
  await d.play(1 / 30);
  await d.page.screenshot({ path: shipped, timeout: 240000 });

  // instrument: let the claims through the world, capture, then put it back
  await d.run(() => {
    window.__vs.kernel.scene.traverse((o) => {
      if ((o.name || "").startsWith("tex:")) { o.material.depthTest = false; o.material.needsUpdate = true; }
    });
  });
  await d.play(1 / 30);
  const free = path.join(OUT, `occl-nodepth-${LANG}.png`);
  await d.page.screenshot({ path: free, timeout: 240000 });
  await d.run(() => {
    window.__vs.kernel.scene.traverse((o) => {
      if ((o.name || "").startsWith("tex:")) { o.material.depthTest = true; o.material.needsUpdate = true; }
    });
  });

  const A = readPng(shipped);
  const B = readPng(free);
  console.log(`# ink reaching the player — SHIPPED spawn frame, lang=${LANG}, ${W}x${H}`);
  console.log(`# shipped capture ${path.relative(ROOT, shipped)} | instrumented ${path.relative(ROOT, free)}`);
  let totA = 0, totB = 0;
  for (const r of rects) {
    const box = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
    const a = inkMask(A, box).n;
    const b = inkMask(B, box).n;
    totA += a; totB += b;
    const eaten = b > 0 ? ((b - a) / b) * 100 : 0;
    console.log(
      `  ${r.id.padEnd(15)} screen ${String(r.x1 - r.x0).padStart(4)}x${String(r.y1 - r.y0).padStart(3)} px  texture ${JSON.stringify(r.texture)}  ` +
      `ink visible ${String(a).padStart(5)} px, ink the claim actually has ${String(b).padStart(5)} px  ` +
      `=> ${eaten.toFixed(1)}% of this claim's ink is cut away by world geometry   (depthTest=${r.depthTest})`
    );
  }
  console.log(`  ALL CLAIMS      visible ${totA} px of ${totB} px  => ${(((totB - totA) / totB) * 100).toFixed(1)}% of the mathematics in the spawn frame is eaten by the world`);
});
