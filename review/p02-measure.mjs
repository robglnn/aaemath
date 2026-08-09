#!/usr/bin/env node
/**
 * P02 scratch measurement tool.
 * Decodes reference/brief-hero.png in headless chromium and reports real numbers:
 * luminance histogram, hue/saturation census, warm/cool split, named-region means.
 * Not shipped; measurement only.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reference', 'brief-hero.png');
const outPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'review', 'p02-reference-measurements.json');

const b64 = readFileSync(imgPath).toString('base64');

// Named regions in NORMALISED coords (x0,y0,x1,y1) of the reference frame.
// Picked by eye from the full-size read, then verified by the means this script prints.
const REGIONS = {
  'sky.zenith':          [0.34, 0.005, 0.52, 0.035],
  'sky.upper':           [0.10, 0.02,  0.22, 0.07 ],
  'sky.horizon.warm':    [0.40, 0.345, 0.52, 0.375],
  'sky.horizon.right':   [0.86, 0.34,  0.95, 0.375],
  'aurora.green.core':   [0.44, 0.085, 0.52, 0.115],
  'aurora.green.mid':    [0.56, 0.10,  0.64, 0.135],
  'aurora.violet':       [0.145,0.10,  0.20, 0.155],
  'rock.foreground.lit': [0.62, 0.855, 0.70, 0.90 ],
  'rock.plinth.lit':     [0.60, 0.735, 0.66, 0.775],
  'rock.plinth.top':     [0.55, 0.695, 0.60, 0.72 ],
  'rock.shadow.fg':      [0.10, 0.90,  0.20, 0.96 ],
  'rock.shadow.cliff':   [0.455,0.755, 0.49, 0.80 ],
  'rock.mid.warm':       [0.02, 0.44,  0.09, 0.48 ],
  'rock.far.haze':       [0.17, 0.20,  0.23, 0.26 ],
  'resonance.river':     [0.50, 0.575, 0.545,0.60 ],
  'resonance.crystal':   [0.92, 0.60,  0.96, 0.65 ],
  'resonance.socket':    [0.585,0.695, 0.62, 0.715],
  'hologram.panel':      [0.545,0.20,  0.60, 0.245],
  'hologram.glyph':      [0.525,0.185, 0.545,0.215],
  'hologram.edge':       [0.492,0.145, 0.50, 0.26 ],
  'hero.armour.lit':     [0.352,0.395, 0.372,0.425],
  'hero.armour.shadow':  [0.30,  0.40, 0.315,0.44 ],
  'hero.accent.cyan':    [0.343,0.415, 0.352,0.44 ],
  'hero.hair':           [0.345,0.235, 0.375,0.26 ],
  'hero.skin':           [0.365,0.30,  0.378,0.325],
  'ui.bar.fill':         [0.075,0.048, 0.145,0.062],
  'ui.bar.track':        [0.148,0.048, 0.16, 0.062],
  'ui.bar.xp':           [0.068,0.078, 0.105,0.09 ],
  'ui.banner':           [0.30,  0.86, 0.36, 0.885],
  'ui.text.cyan':        [0.415,0.875, 0.425,0.89 ],
  'minimap.field':       [0.905,0.045, 0.925,0.075]
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const result = await page.evaluate(async ({ b64, REGIONS }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
  const hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, mx === 0 ? 0 : d / mx, mx];
  };

  // ---------- global census ----------
  const NB = 32;
  const histL = new Array(NB).fill(0);        // luminance (linear) histogram
  const histV = new Array(NB).fill(0);        // value (sRGB max channel) histogram
  const hueSat = new Array(36).fill(0);       // hue census for pixels with S>0.25
  let n = 0, satPixels = 0, sumS = 0, sumL = 0, warm = 0, cool = 0, neutral = 0;
  let cyanStrong = 0, cyanAny = 0, greenGlow = 0, orangeRock = 0;
  let maxL = 0, over95 = 0, under05 = 0;
  const step = 2; // sample every 2nd pixel each axis => quarter of pixels, ~1.05M samples
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = lum(r, g, b);
      const [h, s, v] = hsv(r, g, b);
      n++; sumS += s; sumL += L;
      if (L > maxL) maxL = L;
      if (v >= 0.95) over95++;
      if (v <= 0.05) under05++;
      histL[Math.min(NB - 1, Math.floor(L * NB))]++;
      histV[Math.min(NB - 1, Math.floor(v * NB))]++;
      if (s > 0.25) { satPixels++; hueSat[Math.floor(h / 10) % 36]++; }
      if (s < 0.12) neutral++;
      else if (h < 75 || h >= 330) warm++;
      else cool++;
      // resonance cyan: hue 160..205, decent saturation & value
      if (h >= 155 && h <= 205 && s >= 0.30 && v >= 0.45) cyanStrong++;
      if (h >= 150 && h <= 210 && s >= 0.15) cyanAny++;
      if (h > 95 && h < 155 && s >= 0.25) greenGlow++;
      if (h >= 15 && h <= 45 && s >= 0.30 && v >= 0.40) orangeRock++;
    }
  }

  // ---------- horizon detection: row-mean luminance profile ----------
  const rowL = [];
  for (let y = 0; y < H; y += 4) {
    let acc = 0, m = 0;
    for (let x = 0; x < W; x += 8) { const i = (y * W + x) * 4; acc += lum(data[i], data[i + 1], data[i + 2]); m++; }
    rowL.push({ y: +(y / H).toFixed(4), L: +(acc / m).toFixed(4) });
  }
  // biggest downward step in row luminance = sky/ground boundary
  let bestDrop = 0, bestY = 0;
  for (let k = 4; k < rowL.length - 4; k++) {
    const d = rowL[k - 4].L - rowL[k + 4].L;
    if (d > bestDrop) { bestDrop = d; bestY = rowL[k].y; }
  }

  // ---------- column census: where the saturated cyan lives ----------
  const colCyan = [];
  for (let x = 0; x < W; x += Math.floor(W / 32)) {
    let cy = 0, m = 0;
    for (let y = 0; y < H; y += 4) {
      const i = (y * W + x) * 4;
      const [h, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
      if (h >= 155 && h <= 205 && s >= 0.30 && v >= 0.45) cy++;
      m++;
    }
    colCyan.push(+(cy / m).toFixed(3));
  }

  // ---------- named region means ----------
  const regions = {};
  for (const [name, [x0, y0, x1, y1] ] of Object.entries(REGIONS)) {
    const X0 = Math.floor(x0 * W), X1 = Math.ceil(x1 * W), Y0 = Math.floor(y0 * H), Y1 = Math.ceil(y1 * H);
    let R = 0, G = 0, B = 0, m = 0;
    let lr = 0, lg = 0, lb = 0;
    const px = [];
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = (y * W + x) * 4;
      R += data[i]; G += data[i + 1]; B += data[i + 2];
      lr += s2l(data[i]); lg += s2l(data[i + 1]); lb += s2l(data[i + 2]);
      m++;
      px.push(lum(data[i], data[i + 1], data[i + 2]));
    }
    px.sort((a, b2) => a - b2);
    // also take the modal-ish colour: median pixel by luminance
    const mr = Math.round(R / m), mg = Math.round(G / m), mb = Math.round(B / m);
    const [h, s, v] = hsv(mr, mg, mb);
    regions[name] = {
      rgb: [mr, mg, mb],
      hex: '#' + [mr, mg, mb].map(z => z.toString(16).padStart(2, '0')).join(''),
      linear: [+(lr / m).toFixed(4), +(lg / m).toFixed(4), +(lb / m).toFixed(4)],
      hsv: [Math.round(h), +s.toFixed(3), +v.toFixed(3)],
      luminance: +(lum(mr, mg, mb).toFixed(4)),
      lumP10: +px[Math.floor(m * 0.1)].toFixed(4),
      lumP90: +px[Math.floor(m * 0.9)].toFixed(4),
      samples: m
    };
  }

  // percentiles of luminance
  const flat = [];
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
    const i = (y * W + x) * 4; flat.push(lum(data[i], data[i + 1], data[i + 2]));
  }
  flat.sort((a, b2) => a - b2);
  const P = (q) => +flat[Math.floor(flat.length * q)].toFixed(4);

  return {
    size: [W, H],
    aspect: +(W / H).toFixed(3),
    sampled: n,
    global: {
      meanLuminance: +(sumL / n).toFixed(4),
      meanSaturation: +(sumS / n).toFixed(4),
      maxLuminance: +maxL.toFixed(4),
      pctValueOver95: +(100 * over95 / n).toFixed(2),
      pctValueUnder05: +(100 * under05 / n).toFixed(2),
      pctWarmHue: +(100 * warm / n).toFixed(2),
      pctCoolHue: +(100 * cool / n).toFixed(2),
      pctNeutral: +(100 * neutral / n).toFixed(2),
      pctCyanStrong: +(100 * cyanStrong / n).toFixed(2),
      pctCyanAny: +(100 * cyanAny / n).toFixed(2),
      pctGreenGlow: +(100 * greenGlow / n).toFixed(2),
      pctOrangeRock: +(100 * orangeRock / n).toFixed(2)
    },
    luminancePercentiles: { p01: P(0.01), p05: P(0.05), p10: P(0.10), p25: P(0.25), p50: P(0.50), p75: P(0.75), p90: P(0.90), p95: P(0.95), p99: P(0.99) },
    histLuminance32: histL.map(v => +(100 * v / n).toFixed(2)),
    histValue32: histV.map(v => +(100 * v / n).toFixed(2)),
    hueCensus10deg: hueSat.map(v => +(100 * v / Math.max(1, satPixels)).toFixed(2)),
    horizon: { estimatedY: bestY, dropStrength: +bestDrop.toFixed(4) },
    rowLuminance: rowL.filter((_, k) => k % 4 === 0),
    colCyanFraction: colCyan,
    regions
  };
}, { b64, REGIONS });

await browser.close();
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log('wrote', outPath);
console.log('size', result.size, 'aspect', result.aspect);
console.log('global', JSON.stringify(result.global, null, 1));
console.log('lum percentiles', JSON.stringify(result.luminancePercentiles));
console.log('horizon', JSON.stringify(result.horizon));
for (const [k, v] of Object.entries(result.regions)) {
  console.log(k.padEnd(22), v.hex, 'hsv', JSON.stringify(v.hsv), 'Y', v.luminance, 'lin', JSON.stringify(v.linear));
}
