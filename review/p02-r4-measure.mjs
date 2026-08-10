#!/usr/bin/env node
/**
 * P02 round 4 — the measurements this round's changes rest on.
 *
 * Uses review/p02-png.mjs (the dependency-free decoder written in round 3) so
 * nothing here shares a decoder with the browser-canvas census path.
 *
 *   node review/p02-r4-measure.mjs           # prints, and writes the JSON
 *
 * Produces review/p02-r4-measurements.json:
 *   grey        — candidate `grey` classes for §9's partition, at full res
 *   landmark    — the city-mass vs sky-behind contrast §7 was missing a number for
 *   cct         — CIE xy + McCamy correlated colour temperature of the light rig
 *   roles       — exact hex/linear/hsv/Y for the roles round 4 adds
 *   acutance    — the auditor's own boxes, re-derived, to settle three drifted values
 */
import { readPNG, lum, hsv } from './p02-png.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = readPNG(path.join(ROOT, 'reference', 'brief-hero.png'));
const { width: W, height: H, bpp, data } = img;
const at = (x, y) => { const i = (y * W + x) * bpp; return [data[i], data[i + 1], data[i + 2]]; };
const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const out = { image: 'reference/brief-hero.png', size: [W, H] };

// ── 1. candidate `grey` classes ────────────────────────────────────────────
// Grey is world.md §2.2 Law 5: a claim shut with a supplied value. It is a
// MATERIAL, and §9's partition currently scores it as anonymous `muted`.
// The class has to be (a) a subset of what `muted` already holds, so nothing
// else in the partition moves, and (b) narrow enough that ordinary warm rock
// shadow does not fall into it.
const SUB = { maxValueForPale: 0.70, minSaturationForBright: 0.45 };
const substance = (s, v) => !(v > SUB.maxValueForPale && s < SUB.minSaturationForBright);
const candidates = [
  { name: 'hue20-80 S<0.14', hue: [20, 80], maxS: 0.14, yLo: 0.02, yHi: 0.55 },
  { name: 'hue20-80 S<0.12', hue: [20, 80], maxS: 0.12, yLo: 0.02, yHi: 0.55 },
  { name: 'hue20-80 S<0.16', hue: [20, 80], maxS: 0.16, yLo: 0.02, yHi: 0.55 },
  { name: 'hue0-90  S<0.14', hue: [0, 90], maxS: 0.14, yLo: 0.02, yHi: 0.55 },
  { name: 'hue20-80 S<0.14 noY', hue: [20, 80], maxS: 0.14, yLo: 0, yHi: 1 }
];
const greyCounts = candidates.map(() => 0);
let n = 0, mutedN = 0;
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const [r, g, b] = at(x, y);
  const [h, s, v] = hsv(r, g, b);
  const Y = lum(r, g, b);
  n++;
  if (!substance(s, v) || s >= 0.30) continue;
  mutedN++;
  candidates.forEach((c, i) => {
    if (h >= c.hue[0] && h < c.hue[1] && s < c.maxS && Y >= c.yLo && Y <= c.yHi) greyCounts[i]++;
  });
}
out.grey = {
  sampledPixels: n,
  mutedShare: +(mutedN / n).toFixed(4),
  candidates: candidates.map((c, i) => ({ ...c, share: +(greyCounts[i] / n).toFixed(4) }))
};

// ── 2. §7's missing number: a distant landmark's value against the sky ──────
// "Detail is not what makes a landmark read; value contrast against sky is."
// The rule needs a ratio and a pair of boxes. Boxes are arguments; recorded.
const meanBox = (b) => {
  let s = 0, k = 0;
  for (let y = Math.round(b[1] * H); y < Math.round(b[3] * H); y++)
    for (let x = Math.round(b[0] * W); x < Math.round(b[2] * W); x++) { s += lum(...at(x, y)); k++; }
  return { mean: +(s / k).toFixed(4), px: k };
};
const landmarkBoxes = {
  cityMass: [0.700, 0.120, 0.860, 0.300],
  skyBehindCity: [0.860, 0.120, 0.960, 0.300],
  skyAboveCity: [0.700, 0.030, 0.860, 0.100],
  ruinLeft: [0.135, 0.150, 0.245, 0.290],
  skyBehindRuinLeft: [0.260, 0.150, 0.360, 0.290],
  mesaMid: [0.030, 0.330, 0.200, 0.400],
  skyAboveMesaMid: [0.030, 0.250, 0.200, 0.300]
};
out.landmark = {};
for (const [k, b] of Object.entries(landmarkBoxes)) out.landmark[k] = { box: b, ...meanBox(b) };
out.landmark.ratios = {
  cityOverSkyBehind: +(out.landmark.cityMass.mean / out.landmark.skyBehindCity.mean).toFixed(4),
  cityOverSkyAbove: +(out.landmark.cityMass.mean / out.landmark.skyAboveCity.mean).toFixed(4),
  ruinOverSkyBehind: +(out.landmark.ruinLeft.mean / out.landmark.skyBehindRuinLeft.mean).toFixed(4),
  mesaOverSkyAbove: +(out.landmark.mesaMid.mean / out.landmark.skyAboveMesaMid.mean).toFixed(4)
};

// ── 3. correlated colour temperature of the light rig, via McCamy ───────────
// The §2 table's CCT column has to be right or a builder feeding a kelvin→RGB
// helper gets a different colour from the one the rest of the document protects.
// Two sRGB→XYZ matrices, because the third digit of a CCT is a property of the
// matrix and not of the colour, and a number that moves when you change matrix
// must be quoted with the sensitivity.
const M_IEC = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];
const M_LIN = [[0.4124000, 0.3576000, 0.1805000], [0.2126000, 0.7152000, 0.0722000], [0.0193000, 0.1192000, 0.9505000]];
const cctWith = (hex, M) => {
  const N = parseInt(hex.slice(1), 16);
  const c = [s2l((N >> 16) & 255), s2l((N >> 8) & 255), s2l(N & 255)];
  const X = M[0][0] * c[0] + M[0][1] * c[1] + M[0][2] * c[2];
  const Y = M[1][0] * c[0] + M[1][1] * c[1] + M[1][2] * c[2];
  const Z = M[2][0] * c[0] + M[2][1] * c[1] + M[2][2] * c[2];
  const sum = X + Y + Z, x = X / sum, y = Y / sum;
  const nn = (x - 0.3320) / (0.1858 - y);
  return { xy: [+x.toFixed(4), +y.toFixed(4)], n: +nn.toFixed(4), cctK: Math.round(449 * nn ** 3 + 3525 * nn ** 2 + 6823.3 * nn + 5520.33), Y: +Y.toFixed(4) };
};
const cct = (hex) => {
  const a = cctWith(hex, M_IEC), b = cctWith(hex, M_LIN);
  return { hex, xy: a.xy, n: a.n, cctK: a.cctK, cctK_altMatrix: b.cctK, Y: a.Y };
};
out.cct = {
  key: cct('#FFE8A0'),
  fill: cct('#8DACBC'),
  bounce: cct('#8A5B3E'),
  kick: cct('#2FE3D6'),
  note: 'McCamy 1992 cubic on CIE 1931 xy from the linear sRGB triplet. The kick is not a blackbody and its number is meaningless; it is printed only to show that.'
};
// what a naive kelvin→RGB helper emits at the numbers round 3 printed
const kelvinToRGB = (K) => {           // Tanner Helland's widely-reproduced fit
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [c(r), c(g), c(b)].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
};
out.cct.helperOutput = { at3000K: kelvinToRGB(3000), at4247K: kelvinToRGB(4247), at2200K: kelvinToRGB(2200), at2833K: kelvinToRGB(2833) };

// ── 4. exact colour data for the roles round 4 adds ─────────────────────────
const role = (hex) => {
  const N = parseInt(hex.slice(1), 16);
  const rgb = [(N >> 16) & 255, (N >> 8) & 255, N & 255];
  const linear = rgb.map(v => +s2l(v).toFixed(4));
  const [h, s, v] = hsv(...rgb);
  return { hex, rgb, linear, hsv: [Math.round(h), +s.toFixed(3), +v.toFixed(3)], luminance: +(0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]).toFixed(4) };
};
out.roles = {};
for (const hex of ['#7C7A72', '#4A4945', '#AA9087', '#55505E', '#8FE8DF', '#D8FBF4', '#2FE3D6', '#3FCFA0', '#1D6E6A'])
  out.roles[hex] = role(hex);
// distance of the proposed grey from the two roles it must not be confused with
const dHSV = (a, b) => {
  let dh = Math.abs(a.hsv[0] - b.hsv[0]); if (dh > 180) dh = 360 - dh;
  return { dHue: dh, dS: +(b.hsv[1] - a.hsv[1]).toFixed(3), dY: +(b.luminance - a.luminance).toFixed(4) };
};
out.greySeparation = {
  vsRockBone: dHSV(out.roles['#7C7A72'], out.roles['#AA9087']),
  vsRockShadow: dHSV(out.roles['#7C7A72'], out.roles['#55505E'])
};

// ── 5. acutance, on the auditor's own boxes, at full resolution ─────────────
// Three values in the file disagree for one measurement. Re-derive with the
// auditor's algorithm (stride 2, |4L − ΣL(±2)|) on the boxes it actually uses.
const acut = (b) => {
  let s = 0, k = 0;
  const X0 = Math.max(2, Math.floor(b[0] * W)), X1 = Math.min(W - 3, Math.floor(b[2] * W));
  const Y0 = Math.max(2, Math.floor(b[1] * H)), Y1 = Math.min(H - 3, Math.floor(b[3] * H));
  for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) {
    s += Math.abs(4 * lum(...at(x, y)) - lum(...at(x - 2, y)) - lum(...at(x + 2, y)) - lum(...at(x, y - 2)) - lum(...at(x, y + 2)));
    k++;
  }
  return +(s / k).toFixed(5);
};
const heroBox = [0.276, 0.276, 0.425, 0.960];
const hw = heroBox[2] - heroBox[0], hh = heroBox[3] - heroBox[1];
const heroCore = [heroBox[0] + hw * 0.15, heroBox[1] + hh * 0.20, heroBox[2] - hw * 0.15, heroBox[3] - hh * 0.20];
const acutBoxes = {
  heroCore,
  foreground: [0.44, 0.70, 0.72, 0.92],
  midground: [0.06, 0.52, 0.30, 0.68],
  distance: [0.10, 0.36, 0.30, 0.46],
  midCrystals: [0.84, 0.62, 0.98, 0.78],
  cityFar: [0.70, 0.12, 0.86, 0.30],
  // Round 1–3 quoted a skyFlat noise floor of 0.0123 with no box recorded. The
  // obvious box (x 0.10–0.30, y 0.03–0.09) scores 0.082 because the HUD portrait
  // and health bar live there — a "flat sky" measurement contaminated by UI. This
  // box is clean sky, right of the HUD and above the aurora.
  skyFlat: [0.36, 0.02, 0.56, 0.08]
};
out.acutance = {};
for (const [k, b] of Object.entries(acutBoxes)) out.acutance[k] = { box: b.map(v => +v.toFixed(4)), value: acut(b) };
out.acutance.ratios = {
  heroOverMidground: +(out.acutance.heroCore.value / out.acutance.midground.value).toFixed(3),
  foregroundOverDistance: +(out.acutance.foreground.value / out.acutance.distance.value).toFixed(3),
  foregroundOverMidground: +(out.acutance.foreground.value / out.acutance.midground.value).toFixed(3)
};

writeFileSync(path.join(ROOT, 'review', 'p02-r4-measurements.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
