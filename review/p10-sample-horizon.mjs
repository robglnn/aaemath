// P10 scratch: where is the horizon, and how much do far silhouettes recede?
import { readPNG, px, hex, hsv, lum } from "./p02-png.mjs";

const img = readPNG("reference/target-lowpoly.png");
const W = img.width,
  H = img.height;

console.log("--- column x=56% deep scan (find the skyline)");
const x = Math.round(0.56 * W);
let prev = null;
for (let y = Math.round(0.28 * H); y < Math.round(0.5 * H); y += 4) {
  const [r, g, b] = px(img, x, y);
  const [h, s, v] = hsv(r, g, b);
  const tag = prev && Math.abs(v - prev) > 0.03 ? "  <== step" : "";
  console.log(`  y=${(y / H).toFixed(4)} (${y}) ${hex(r, g, b)} H${h.toFixed(0)} S${s.toFixed(3)} V${v.toFixed(3)}${tag}`);
  prev = v;
}

// Vantis city on the right: silhouette vs the sky immediately beside it.
console.log("\n--- distance recession: city towers vs adjacent sky");
const probes = [
  ["far city tower (right, tall)", 0.585, 0.283, 0.556, 0.283],
  ["far city mass (right)", 0.60, 0.30, 0.556, 0.30],
  ["mid city (left of centre)", 0.20, 0.285, 0.24, 0.285],
  ["near-right tower (dark blue)", 0.925, 0.40, 0.90, 0.36],
  ["far island underside", 0.72, 0.325, 0.70, 0.30],
];
for (const [name, fx, fy, sx, sy] of probes) {
  const [r, g, b] = px(img, Math.round(fx * W), Math.round(fy * H));
  const [r2, g2, b2] = px(img, Math.round(sx * W), Math.round(sy * H));
  const [h, s, v] = hsv(r, g, b);
  const [h2, s2, v2] = hsv(r2, g2, b2);
  console.log(
    `  ${name.padEnd(30)} obj ${hex(r, g, b)} H${h.toFixed(0)} S${s.toFixed(3)} V${v.toFixed(3)}  |  sky ${hex(r2, g2, b2)} S${s2.toFixed(3)} V${v2.toFixed(3)}  |  dV ${(v2 - v).toFixed(3)} dLum ${(lum(r2, g2, b2) - lum(r, g, b)).toFixed(4)}`
  );
}

// Near rock, for the two-value palette reference (lit vs shadow).
console.log("\n--- near rock two-value reference");
for (const [name, fx, fy] of [
  ["near spire lit", 0.145, 0.29],
  ["near spire shadow", 0.075, 0.29],
  ["foreground ground lit", 0.44, 0.72],
  ["foreground rock shadow", 0.30, 0.60],
]) {
  const [r, g, b] = px(img, Math.round(fx * W), Math.round(fy * H));
  const [h, s, v] = hsv(r, g, b);
  console.log(`  ${name.padEnd(24)} ${hex(r, g, b)} H${h.toFixed(0)} S${s.toFixed(3)} V${v.toFixed(3)}`);
}

// Cloud population census across the upper band: how many distinct cloud values?
console.log("\n--- cloud slab colour census (upper 20% of frame, warm pixels only)");
const buckets = new Map();
for (let y = 0; y < Math.round(0.2 * H); y += 2)
  for (let xx = Math.round(0.14 * W); xx < Math.round(0.86 * W); xx += 2) {
    const [r, g, b] = px(img, xx, y);
    const [h, s, v] = hsv(r, g, b);
    if (h > 20 && h < 60 && v > 0.7) {
      const k = `${Math.round(h / 4) * 4}/${(Math.round(s * 25) / 25).toFixed(2)}/${(Math.round(v * 25) / 25).toFixed(2)}`;
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
  }
const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [k, n] of top) console.log(`  H/S/V ${k}  n=${n}`);
