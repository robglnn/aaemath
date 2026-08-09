#!/usr/bin/env node
/** P02 scratch pass 4 — hologram veil maths, vignette isolation, DOF-by-depth, bloom falloff. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(path.join(root, 'reference', 'brief-hero.png')).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({ b64 }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const D = ctx.getImageData(0, 0, W, H).data;
  const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
  const hsv = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); } if (h < 0) h += 360; return [h, mx === 0 ? 0 : d / mx, mx]; };
  const at = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  const hex = p => '#' + p.map(z => Math.round(z).toString(16).padStart(2, '0')).join('');
  const box = (x0, y0, x1, y1, q = 0.5) => {
    const L = [];
    for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) { const p = at(x, y); L.push([lum(...p), ...p]); }
    L.sort((a, b) => a[0] - b[0]); const s = L[Math.min(L.length - 1, Math.floor(L.length * q))];
    return { hex: hex(s.slice(1)), rgb: s.slice(1).map(Math.round), hsv: hsv(...s.slice(1)).map((v, i) => i === 0 ? Math.round(v) : +v.toFixed(3)), Y: +s[0].toFixed(4), linear: s.slice(1).map(v => +s2l(v).toFixed(4)) };
  };

  // --- hologram: paired inside/outside samples over the SAME background content ---
  const holo = {
    glyphWhite:      box(0.5400, 0.3480, 0.5470, 0.3560, 0.97),
    glyphWhite2:     box(0.5300, 0.3450, 0.5360, 0.3520, 0.97),
    stroke:          box(0.4950, 0.3600, 0.4968, 0.3820, 0.95),
    strokeTop:       box(0.5600, 0.1900, 0.5900, 0.1930, 0.92),
    corner:          box(0.5010, 0.2740, 0.5060, 0.2830, 0.92),
    plotLine:        box(0.6880, 0.3840, 0.6930, 0.3910, 0.90),
    axisWhite:       box(0.6640, 0.4300, 0.6680, 0.4360, 0.92),
    fillOverSky_in:  box(0.5380, 0.2830, 0.5490, 0.2930),
    fillOverSky_out: box(0.5380, 0.2450, 0.5490, 0.2550),
    fillOverCity_in: box(0.7240, 0.2680, 0.7310, 0.2760),
    fillOverCity_out:box(0.7240, 0.2150, 0.7310, 0.2230),
    fillLowLeft_in:  box(0.5100, 0.4400, 0.5200, 0.4500),
    fillLowLeft_out: box(0.4800, 0.4400, 0.4900, 0.4500)
  };
  // solve inside = out*(1-a) + tint*a per channel, assuming a common alpha; grid search
  const solve = (inn, out2) => {
    let best = null;
    for (let a = 0.02; a <= 0.95; a += 0.005) {
      const tint = [0, 1, 2].map(i => (inn.linear[i] - out2.linear[i] * (1 - a)) / a);
      if (tint.some(t => t < 0 || t > 1.4)) continue;
      const spread = Math.max(...tint) - Math.min(...tint);
      const score = Math.abs(spread - 0.14); // prefer a mildly cyan tint
      if (!best || score < best.score) best = { alpha: +a.toFixed(3), tintLinear: tint.map(t => +t.toFixed(3)), score };
    }
    return best;
  };
  holo.veilSolveSky = solve(holo.fillOverSky_in, holo.fillOverSky_out);
  holo.veilSolveCity = solve(holo.fillOverCity_in, holo.fillOverCity_out);
  holo.veilLift = {
    skyDeltaY: +(holo.fillOverSky_in.Y - holo.fillOverSky_out.Y).toFixed(4),
    cityDeltaY: +(holo.fillOverCity_in.Y - holo.fillOverCity_out.Y).toFixed(4)
  };

  // --- vignette isolated in the sky band (content is a smooth gradient there) ---
  const skyRow = [];
  for (let x = 0; x < W; x += Math.floor(W / 40)) {
    let s = 0, m = 0;
    for (let y = Math.floor(0.02 * H); y < Math.floor(0.06 * H); y += 2) { s += lum(...at(x, y)); m++; }
    skyRow.push({ x: +(x / W).toFixed(3), Y: +(s / m).toFixed(4) });
  }
  const bottomRow = [];
  for (let x = 0; x < W; x += Math.floor(W / 40)) {
    let s = 0, m = 0;
    for (let y = Math.floor(0.96 * H); y < Math.floor(0.995 * H); y += 2) { s += lum(...at(x, y)); m++; }
    bottomRow.push({ x: +(x / W).toFixed(3), Y: +(s / m).toFixed(4) });
  }

  // --- DOF: high-frequency energy (mean |laplacian|) per depth band on comparable content ---
  const hf = (x0, y0, x1, y1) => {
    let s = 0, m = 0;
    for (let y = Math.floor(y0 * H) + 2; y < Math.floor(y1 * H) - 2; y += 2)
      for (let x = Math.floor(x0 * W) + 2; x < Math.floor(x1 * W) - 2; x += 2) {
        const l = lum(...at(x, y));
        s += Math.abs(4 * l - lum(...at(x - 2, y)) - lum(...at(x + 2, y)) - lum(...at(x, y - 2)) - lum(...at(x, y + 2)));
        m++;
      }
    return +(s / m).toFixed(5);
  };
  const sharpness = {
    hero:            hf(0.30, 0.44, 0.42, 0.70),
    foregroundRock:  hf(0.44, 0.70, 0.72, 0.92),
    midgroundValley: hf(0.06, 0.52, 0.30, 0.68),
    midCrystals:     hf(0.84, 0.58, 0.99, 0.78),
    distanceRuins:   hf(0.10, 0.36, 0.30, 0.46),
    cityFar:         hf(0.68, 0.10, 0.85, 0.30),
    skyFlat:         hf(0.20, 0.02, 0.40, 0.10)
  };

  // --- bloom falloff around the socket emitter ---
  const cx = Math.floor(0.600 * W), cy = Math.floor(0.688 * H);
  const bloom = [];
  for (let r = 0; r <= 160; r += 10) {
    let s = 0, m = 0;
    for (let a = 0; a < 360; a += 15) {
      const x = cx + r * Math.cos(a * Math.PI / 180), y = cy + r * Math.sin(a * Math.PI / 180) * 0.55;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = at(x, y); s += lum(...p); m++;
    }
    bloom.push({ rPx: r, rPctH: +(r / H).toFixed(4), Y: +(s / m).toFixed(4) });
  }

  // --- hero cast shadow: colour and strength on the plinth ---
  const shadow = {
    litGround:   box(0.455, 0.905, 0.475, 0.925),
    castShadow:  box(0.400, 0.905, 0.420, 0.925),
    contact:     box(0.362, 0.887, 0.372, 0.895)
  };

  // --- rim light: sample a horizontal cut across the hero's right arm ---
  const cut = [];
  const yCut = Math.floor(0.60 * H);
  for (let x = Math.floor(0.372 * W); x < Math.floor(0.415 * W); x += 2) {
    const p = at(x, yCut);
    cut.push({ x: +(x / W).toFixed(4), hex: hex(p), Y: +lum(...p).toFixed(4), hsv: hsv(...p).map((v, i) => i === 0 ? Math.round(v) : +v.toFixed(2)) });
  }

  // --- corrected strays ---
  const fix = {
    rock_mid_shadow: box(0.055, 0.545, 0.075, 0.565),
    rock_arch_shadow: box(0.150, 0.500, 0.170, 0.520),
    hero_armour_hot: box(0.3930, 0.6350, 0.3960, 0.6420, 0.85),
    hero_armour_gold: box(0.4020, 0.6100, 0.4050, 0.6180, 0.80),
    hero_armour_champagne: box(0.3480, 0.4680, 0.3540, 0.4760),
    hero_armour_undersuit: box(0.3280, 0.6150, 0.3330, 0.6250),
    river_bright: box(0.205, 0.660, 0.220, 0.670, 0.85),
    river_glow: box(0.170, 0.700, 0.190, 0.712, 0.85),
    aurora_violet: box(0.060, 0.060, 0.090, 0.090),
    sky_violet_band: box(0.140, 0.150, 0.170, 0.170)
  };
  return { holo, skyRow, bottomRow, sharpness, bloom, shadow, cut, fix };
}, { b64 });
await browser.close();
writeFileSync(path.join(root, 'review', 'p02-reference-measurements-4.json'), JSON.stringify(out, null, 2));
console.log('HOLOGRAM');
for (const [k, v] of Object.entries(out.holo)) console.log('  ' + k.padEnd(18), JSON.stringify(v));
console.log('\nSHARPNESS (mean |laplacian|)', JSON.stringify(out.sharpness));
console.log('\nBLOOM', JSON.stringify(out.bloom));
console.log('\nSHADOW'); for (const [k, v] of Object.entries(out.shadow)) console.log('  ' + k.padEnd(12), JSON.stringify(v));
console.log('\nFIX'); for (const [k, v] of Object.entries(out.fix)) console.log('  ' + k.padEnd(24), v.hex, JSON.stringify(v.hsv), 'Y', v.Y, 'lin', JSON.stringify(v.linear));
console.log('\nSKY ROW Y', JSON.stringify(out.skyRow.map(r => r.Y)));
console.log('BOTTOM ROW Y', JSON.stringify(out.bottomRow.map(r => r.Y)));
console.log('\nRIM CUT'); for (const p of out.cut) console.log('  ', p.x, p.hex, 'Y', p.Y, JSON.stringify(p.hsv));
