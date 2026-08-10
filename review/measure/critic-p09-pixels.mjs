/**
 * Critic-owned pixel harness for P09 round 1.
 *
 * Decodes a captured PNG in a real Chromium canvas and answers three questions the
 * builder's own script does not answer in the critic's own terms:
 *
 *   1. Is there a CONNECTED teal run reaching from the lower third of the frame
 *      toward the horizon?  (subject test)
 *   2. How many distinct value bands does the largest spire hold inside a crop?
 *      (single-plane-cutout test)
 *   3. What is the hue/value split of lit vs shadowed rock in the near field?
 *
 * Usage: node review/measure/critic-p09-pixels.mjs <png> [--crop=x,y,w,h]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const file = process.argv[2];
if (!file) { console.error("need a png path"); process.exit(2); }
const cropArg = (process.argv.find((a) => a.startsWith("--crop=")) || "").slice(7);
const crop = cropArg ? cropArg.split(",").map(Number) : null;
const abs = path.resolve(file);
const b64 = fs.readFileSync(abs).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
const mode = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=accent").slice(7);
await page.setContent("<canvas id=c></canvas>");
await page.evaluate((m) => { window.__mode = m; }, mode);

const out = await page.evaluate(async ({ b64, crop }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById("c");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const D = g.getImageData(0, 0, W, H).data;

  const px = (x, y) => { const i = (y * W + x) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  const hsv = ([r, gg, b]) => {
    r /= 255; gg /= 255; b /= 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
    let h = 0;
    if (d > 1e-6) {
      if (mx === r) h = 60 * (((gg - b) / d) % 6);
      else if (mx === gg) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - gg) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: mx === 0 ? 0 : d / mx, v: mx };
  };
  const lum = ([r, gg, b]) => 0.2126 * (r / 255) + 0.7152 * (gg / 255) + 0.0722 * (b / 255);

  // ---- 1. cyan / teal mask + connected components ------------------------
  // teal: hue 150-215, saturation >= 0.25, value >= 0.20 (water & crystal accents)
  // ACCENT cyan only: bright + saturated. The blue-grey shadow rock in this build sits at
  // hue ~191 sat ~0.41 value ~0.19, so a value floor is the only thing that separates
  // "water/crystal accent" from "rock in shadow".
  const MODE = window.__mode || "accent";
  const isTeal = (x, y) => {
    const c = hsv(px(x, y));
    if (MODE === "shadow") return c.h >= 150 && c.h <= 220 && c.s >= 0.2 && c.v < 0.35;
    return c.h >= 150 && c.h <= 215 && c.s >= 0.3 && c.v >= 0.5;
  };
  const mask = new Uint8Array(W * H);
  let tealCount = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isTeal(x, y)) { mask[y * W + x] = 1; tealCount++; }
  }
  // 8-connected flood fill
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = comps.length;
    let n = 0, minY = H, maxY = 0, minX = W, maxX = 0, sx = 0, sy = 0;
    stack.push(s); lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const y = (p / W) | 0, x = p % W;
      n++; sx += x; sy += y;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] && lab[q] < 0) { lab[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, n, minX, maxX, minY, maxY, cx: Math.round(sx / n), cy: Math.round(sy / n) });
  }
  comps.sort((a, b) => b.n - a.n);

  // ---- 2. horizon row: the row where sky stops --------------------------
  // sky = high value, hue 20-60 (dusk) or 170-210 (upper band); find per-column the
  // lowest row that is still "sky-like" and take the median.
  // Sky is the contiguous run from the top of the frame. Walk each column down until the
  // first pixel that is not sky-bright; the median of those first-hit rows is the skyline.
  const skyish = (x, y) => { const c = hsv(px(x, y)); return c.v > 0.55 && lum(px(x, y)) > 0.30; };
  const cols = [];
  for (let x = 0; x < W; x += 4) {
    let first = H;
    for (let y = 0; y < H; y++) if (!skyish(x, y)) { first = y; break; }
    cols.push(first);
  }
  const sorted = [...cols].sort((a, b) => a - b);
  const horizonRow = sorted[Math.floor(sorted.length / 2)];

  // ---- 3. crop band analysis --------------------------------------------
  let bands = null;
  if (crop) {
    const [cx0, cy0, cw, ch] = crop;
    const hist = new Array(64).fill(0);
    const hueAcc = [];
    let n = 0;
    for (let y = cy0; y < cy0 + ch; y++) for (let x = cx0; x < cx0 + cw; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = px(x, y);
      const L = lum(p);
      hist[Math.min(63, Math.floor(L * 64))]++;
      hueAcc.push(hsv(p));
      n++;
    }
    // a "band" = a histogram peak holding >= 1.5% of crop pixels, separated by >= 2 bins
    const peaks = [];
    for (let i = 0; i < 64; i++) {
      if (hist[i] < n * 0.015) continue;
      const isPeak = (i === 0 || hist[i] >= hist[i - 1]) && (i === 63 || hist[i] >= hist[i + 1]);
      if (isPeak) {
        if (peaks.length && i - peaks[peaks.length - 1].bin < 2) {
          if (hist[i] > peaks[peaks.length - 1].count) peaks[peaks.length - 1] = { bin: i, count: hist[i] };
        } else peaks.push({ bin: i, count: hist[i] });
      }
    }
    const lums = hueAcc.map((_, i) => i);
    const sortedL = [];
    for (let i = 0; i < 64; i++) for (let k = 0; k < hist[i]; k++) sortedL.push(i / 64);
    const q = (p) => sortedL[Math.floor(sortedL.length * p)];
    const hueSorted = hueAcc.map((c) => c.h).sort((a, b) => a - b);
    const satSorted = hueAcc.map((c) => c.s).sort((a, b) => a - b);
    bands = {
      cropPixels: n,
      distinctBands: peaks.length,
      peaks: peaks.map((p) => ({ luminance: +(p.bin / 64).toFixed(3), pctOfCrop: +(100 * p.count / n).toFixed(1) })),
      lumP05: +q(0.05).toFixed(3), lumP50: +q(0.5).toFixed(3), lumP95: +q(0.95).toFixed(3),
      lumSpread: +(q(0.95) - q(0.05)).toFixed(3),
      medianHue: +hueSorted[Math.floor(hueSorted.length / 2)].toFixed(1),
      medianSat: +satSorted[Math.floor(satSorted.length / 2)].toFixed(3),
    };
  }

  // ---- 4. whole frame census -------------------------------------------
  let sumY = 0, dark = 0, warmLit = 0, coolShadow = 0, rock = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const p = px(x, y); const L = lum(p); const c = hsv(p);
    sumY += L;
    if (L < 0.08) dark++;
    if (y > horizonRow) {
      rock++;
      if (L > 0.18 && c.h >= 15 && c.h <= 50) warmLit++;
      if (L <= 0.18 && c.h >= 170 && c.h <= 220) coolShadow++;
    }
  }
  const sampled = Math.ceil(H / 2) * Math.ceil(W / 2);

  return {
    size: [W, H],
    horizonRow,
    lowerThirdStartsAt: Math.round(H * 2 / 3),
    tealPixels: tealCount,
    tealPct: +(100 * tealCount / (W * H)).toFixed(2),
    componentCount: comps.length,
    topComponents: comps.slice(0, 8).map((c) => ({
      pixels: c.n, bboxX: [c.minX, c.maxX], bboxY: [c.minY, c.maxY],
      heightRows: c.maxY - c.minY, centroid: [c.cx, c.cy],
    })),
    // the subject test: a component that starts below 2/3 H and reaches within 15% H of horizon
    subjectComponents: comps.filter((c) => c.maxY >= H * 2 / 3 && c.minY <= horizonRow + H * 0.15 && c.n >= 200)
      .map((c) => ({ pixels: c.n, bboxY: [c.minY, c.maxY] })),
    bands,
    census: {
      meanY: +(sumY / sampled).toFixed(3),
      nearBlackPct: +(100 * dark / sampled).toFixed(1),
      belowHorizonSamples: rock,
      warmLitPctOfGround: +(100 * warmLit / Math.max(1, rock)).toFixed(1),
      coolShadowPctOfGround: +(100 * coolShadow / Math.max(1, rock)).toFixed(1),
    },
  };
}, { b64, crop });

console.log(JSON.stringify(out, null, 2));
await browser.close();
