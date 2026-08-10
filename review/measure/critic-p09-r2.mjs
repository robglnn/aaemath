/** Critic's own pixel audit of the shipped spawn capture. No builder code reused except the PNG reader. */
import { readPNG, px, hsv, lum, hex } from "../p02-png.mjs";

const file = process.argv[2];
const img = readPNG(file);
const W = img.width, H = img.height;
console.log(file, W + "x" + H);

// --- 1. saturated cyan/teal mask ---
const mask = new Uint8Array(W * H);
let cyanCount = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = px(img, x, y);
  const [h, s, v] = hsv(r, g, b);
  if (h >= 150 && h <= 205 && s >= 0.35 && v >= 0.30) { mask[y * W + x] = 1; cyanCount++; }
}
console.log("cyan px", cyanCount, "=", (100 * cyanCount / (W * H)).toFixed(2) + "%");

// connected components (4-way, iterative)
const lab = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = [];
for (let i = 0; i < W * H; i++) {
  if (!mask[i] || lab[i] >= 0) continue;
  const id = comps.length;
  let n = 0, y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
  stack.push(i); lab[i] = id;
  while (stack.length) {
    const p = stack.pop(); const py = (p / W) | 0, pxx = p % W;
    n++; if (py < y0) y0 = py; if (py > y1) y1 = py; if (pxx < x0) x0 = pxx; if (pxx > x1) x1 = pxx;
    if (pxx > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
    if (pxx < W - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
    if (py > 0 && mask[p - W] && lab[p - W] < 0) { lab[p - W] = id; stack.push(p - W); }
    if (py < H - 1 && mask[p + W] && lab[p + W] < 0) { lab[p + W] = id; stack.push(p + W); }
  }
  comps.push({ id, n, x0, x1, y0, y1 });
}
comps.sort((a, b) => b.n - a.n);
console.log("components >=500px:", comps.filter(c => c.n >= 500).length);
for (const c of comps.slice(0, 5))
  console.log(`  comp n=${c.n} box x[${c.x0},${c.x1}] y[${c.y0},${c.y1}] rows=${c.y1 - c.y0 + 1} (${((c.y1 - c.y0 + 1) / H * 100).toFixed(1)}% of frame height)`);

// does the biggest run reach from the lower third toward the horizon?
const big = comps[0];
if (big) {
  console.log(`LOWER-THIRD-TO-HORIZON: bottom row ${big.y1} (lower third starts ${Math.round(H * 2 / 3)}) top row ${big.y0}`);
}
// mean colour of the biggest component
if (big) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (lab[i] === big.id) { const p = px(img, i % W, (i / W) | 0); r += p[0]; g += p[1]; b += p[2]; n++; }
  const m = [r / n, g / n, b / n].map(Math.round);
  console.log("biggest carry mean", hex(...m), "hsv", hsv(...m).map(v => +v.toFixed(2)), "Y", lum(...m).toFixed(3));
}

// --- 2. value bands inside an arbitrary crop ---
const crop = process.argv[3];
if (crop) {
  const [cx, cy, cw, ch] = crop.split(",").map(Number);
  const bins = new Array(50).fill(0);
  let n = 0; const hues = [];
  for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) {
    const [r, g, b] = px(img, x, y);
    const Y = lum(r, g, b);
    bins[Math.min(49, Math.floor(Y * 50))]++; n++; hues.push(hsv(r, g, b)[0]);
  }
  const held = bins.map((v, i) => ({ i, share: v / n })).filter(o => o.share >= 0.05);
  console.log(`\nCROP ${crop}  n=${n}`);
  console.log("  2%-luminance bins holding >=5%:", held.length, held.map(o => `Y~${(o.i / 50).toFixed(2)}:${(o.share * 100).toFixed(0)}%`).join(" "));
  console.log("  largest single bin share", (Math.max(...bins) / n * 100).toFixed(1) + "%");
  const sorted = bins.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).slice(0, 8);
  console.log("  top bins:", sorted.map(o => `Y${(o.i / 50).toFixed(2)}=${(o.v / n * 100).toFixed(1)}%`).join(" "));
}

// --- 3. bottom-band / letterbox check ---
for (const row of [H - 1, H - 10, H - 25, H - 40, H - 60, H - 80]) {
  let r = 0, g = 0, b = 0;
  for (let x = 0; x < W; x++) { const p = px(img, x, row); r += p[0]; g += p[1]; b += p[2]; }
  const m = [r / W, g / W, b / W].map(Math.round);
  console.log(`row ${row} mean ${hex(...m)} Y=${lum(...m).toFixed(3)}`);
}

// --- 4. whole-frame census ---
let sum = 0, warmN = 0, warmY = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = px(img, x, y); sum += lum(r, g, b);
  const [h, s, v] = hsv(r, g, b);
  if (h >= 18 && h <= 45 && s >= 0.25 && v >= 0.20) { warmN++; warmY += lum(r, g, b); }
}
console.log("\nframe meanY", (sum / (W * H)).toFixed(3), "| warm-family px", warmN, "meanY", (warmY / Math.max(1, warmN)).toFixed(3));
