/**
 * CRITIC-OWNED pixel sampler for the P11 re-judgement.
 * Decodes a REAL capture of the shipped game (no scene is spawned here) and reports
 * median HSV over named rectangles plus a frame-wide dark-population hue histogram.
 *
 * usage: node review/measure/critic-p11-r2-pixels.mjs <png> "name:x,y,w,h" ...
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [, , src, ...rectArgs] = process.argv;
const b64 = fs.readFileSync(path.resolve(src)).toString("base64");
const rects = rectArgs.map((a) => {
  const [name, nums] = a.split(":");
  const [x, y, w, h] = nums.split(",").map(Number);
  return { name, x, y, w, h };
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.setContent("<canvas id=c></canvas>");
const out = await page.evaluate(async ({ b64, rects }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const all = g.getImageData(0, 0, img.width, img.height).data;

  const rgb2hsv = (r, gg, b) => {
    r /= 255; gg /= 255; b /= 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
    let h = 0;
    if (d > 1e-9) {
      if (mx === r) h = 60 * (((gg - b) / d) % 6);
      else if (mx === gg) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - gg) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, mx <= 0 ? 0 : d / mx, mx];
  };
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  // circular median for hue
  const hmed = (a) => {
    if (!a.length) return null;
    let bx = 0, by = 0;
    for (const h of a) { bx += Math.cos(h * Math.PI / 180); by += Math.sin(h * Math.PI / 180); }
    let m = Math.atan2(by / a.length, bx / a.length) * 180 / Math.PI;
    if (m < 0) m += 360;
    return m;
  };

  const results = [];
  for (const r of rects) {
    const H = [], S = [], V = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * img.width + x) * 4;
        const [h, s, v] = rgb2hsv(all[i], all[i + 1], all[i + 2]);
        H.push(h); S.push(s); V.push(v);
      }
    }
    // sample the exact centre pixel too so a reader can verify by eye
    const ci = ((r.y + (r.h >> 1)) * img.width + (r.x + (r.w >> 1))) * 4;
    results.push({
      name: r.name, rect: [r.x, r.y, r.w, r.h], n: H.length,
      hue: +hmed(H).toFixed(1), sat: +med(S).toFixed(3), val: +med(V).toFixed(3),
      centreRGB: [all[ci], all[ci + 1], all[ci + 2]],
      hueSpread: +(Math.max(...H) - Math.min(...H)).toFixed(1),
    });
  }

  // frame-wide census of dark non-cyan pixels (the "shadow read")
  const bins = new Array(36).fill(0);
  let dark = 0, cyan = 0, total = img.width * img.height;
  const darkH = [], darkS = [], darkV = [];
  for (let i = 0; i < all.length; i += 4) {
    const [h, s, v] = rgb2hsv(all[i], all[i + 1], all[i + 2]);
    if (v >= 0.8 && s >= 0.25 && h >= 150 && h <= 200) cyan++;
    if (v < 0.32 && s > 0.08) {
      dark++; bins[Math.floor(h / 10)]++; darkH.push(h); darkS.push(s); darkV.push(v);
    }
  }
  return {
    size: [img.width, img.height], results,
    dark: {
      pct: +(100 * dark / total).toFixed(2), n: dark,
      hue: +hmed(darkH).toFixed(1), sat: +med(darkS).toFixed(3), val: +med(darkV).toFixed(3),
      topBins: bins.map((c, i) => ({ hue: i * 10 + "-" + (i * 10 + 10), pct: +(100 * c / Math.max(1, dark)).toFixed(1) }))
        .filter((b) => b.pct >= 3).sort((a, b) => b.pct - a.pct),
    },
    accentPct: +(100 * cyan / total).toFixed(3),
  };
}, { b64, rects });
await browser.close();
console.log(JSON.stringify(out, null, 2));
