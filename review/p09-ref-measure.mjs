// Scratch: measure reference/target-lowpoly.png so P09's palette and value structure come from
// pixels rather than from memory. Sample points were located by cropping the reference and
// looking at the crops (review/p09-crops/*). Prints sky bands, named patches, and a census.
import { readPNG, px, hex, hsv, lum } from './p02-png.mjs';

const img = readPNG('reference/target-lowpoly.png');
const W = img.width, H = img.height;
console.log(`reference ${W}x${H}`);

function patch(x, y, r = 5) {
  let R = 0, G = 0, B = 0, n = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const p = px(img, Math.min(W - 1, Math.max(0, x + i)), Math.min(H - 1, Math.max(0, y + j)));
    R += p[0]; G += p[1]; B += p[2]; n++;
  }
  return [R / n, G / n, B / n].map(Math.round);
}
function show(name, x, y, r) {
  const c = patch(x, y, r);
  const [h, s, v] = hsv(...c);
  const Y = lum(...c);
  console.log(`  ${name.padEnd(26)} (${String(x).padStart(4)},${String(y).padStart(4)}) ${hex(...c)}  H${h.toFixed(0).padStart(3)} S${s.toFixed(2)} V${v.toFixed(2)} Y=${Y.toFixed(3)}`);
  return { name, hex: hex(...c), h, s, v, Y };
}

console.log('\n# sky vertical bands (x = 0.45W, pure sky)');
for (let yf = 0.02; yf <= 0.34; yf += 0.02) {
  const y = Math.round(yf * H);
  show(`sky y=${yf.toFixed(2)}`, Math.round(0.455 * W), y, 6);
}

console.log('\n# named patches');
const near = {
  'spire lit (big)': [447, 508],
  'spire shadow (big)': [260, 508],
  'spire deep shadow': [265, 248],
  'rock lit (right)': [822, 820],
  'rock shadow (right)': [764, 758],
  'talus lit': [560, 900],
  'foreground deck lit': [1240, 1180],
  'foreground grass blade': [676, 1080],
};
const mid = {
  'island grass top': [1010, 827],
  'island rock underside': [1034, 888],
  'crystal bright facet': [1120, 729],
  'crystal dark facet': [1089, 791],
  'mid plain lit': [1584, 705],
  'far ridge': [1462, 699],
  'river cyan': [1756, 791],
};
const far = {
  'distant city (left)': [728, 539],
  'sky just above horizon': [1682, 485],
  'cloud slab': [634, 227],
  'sun glow': [1700, 560],
};
const rows = {};
for (const [k, [x, y]] of Object.entries(near)) rows[k] = show(k, x, y, 5);
console.log('');
for (const [k, [x, y]] of Object.entries(mid)) rows[k] = show(k, x, y, 4);
console.log('');
for (const [k, [x, y]] of Object.entries(far)) rows[k] = show(k, x, y, 5);

console.log('\n# derived');
const ratio = (a, b) => (rows[a].Y / Math.max(rows[b].Y, 1e-4)).toFixed(2);
console.log(`  near rock lit:shadow luminance ratio  = ${ratio('spire lit (big)', 'spire shadow (big)')}`);
console.log(`  right rock lit:shadow                 = ${ratio('rock lit (right)', 'rock shadow (right)')}`);
console.log(`  lit rock : distant city               = ${ratio('spire lit (big)', 'distant city (left)')}`);
console.log(`  distant city vs sky above it (Y)      = ${rows['distant city (left)'].Y.toFixed(3)} vs ${rows['sky just above horizon'].Y.toFixed(3)}`);

// --- global census ---------------------------------------------------------------
let cyan = 0, warm = 0, dark = 0, sumY = 0;
const total = W * H;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = px(img, x, y);
  const [h, s] = hsv(r, g, b);
  const Y = lum(r, g, b); sumY += Y;
  if (s >= 0.30 && h >= 150 && h <= 200) cyan++;
  if (s >= 0.20 && h >= 15 && h <= 60) warm++;
  if (Y < 0.05) dark++;
}
console.log(`\n# census  cyan(S>=.30,H150-200)=${(100 * cyan / total).toFixed(2)}%  warm(H15-60,S>=.20)=${(100 * warm / total).toFixed(2)}%  dark(Y<0.05)=${(100 * dark / total).toFixed(2)}%  meanY=${(sumY / total).toFixed(3)}`);
