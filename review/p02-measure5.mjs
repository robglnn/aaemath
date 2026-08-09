#!/usr/bin/env node
/** P02 scratch pass 5 — solve the UI banner plate colour+alpha from paired samples across its edge. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
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
  const l2s = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
  const at = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  const meanLin = (x0, x1, y0, y1) => {
    const a = [0, 0, 0]; let m = 0;
    for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x++) {
      const p = at(x, y); a[0] += s2l(p[0]); a[1] += s2l(p[1]); a[2] += s2l(p[2]); m++;
    }
    return a.map(v => v / m);
  };
  // find the banner's top edge by scanning for the luminance step at x=0.62
  const edge = [];
  for (let yn = 0.82; yn < 0.88; yn += 0.002) {
    const p = at(Math.floor(0.62 * W), Math.floor(yn * H));
    edge.push({ y: +yn.toFixed(3), hex: '#' + p.map(z => z.toString(16).padStart(2, '0')).join('') });
  }
  // paired samples over three different backgrounds, above vs below the banner edge
  const pairs = {};
  for (const [nm, x0, x1] of [['brightRock', 0.615, 0.635], ['midRock', 0.545, 0.565], ['darkRock', 0.705, 0.720]]) {
    const above = meanLin(x0, x1, 0.828, 0.840);
    const below = meanLin(x0, x1, 0.852, 0.864);
    pairs[nm] = { aboveLin: above.map(v => +v.toFixed(4)), belowLin: below.map(v => +v.toFixed(4)),
      aboveHex: '#' + above.map(v => l2s(v).toString(16).padStart(2, '0')).join(''),
      belowHex: '#' + below.map(v => l2s(v).toString(16).padStart(2, '0')).join('') };
  }
  // least-squares over the three pairs for a single (alpha, plateLinear)
  let best = null;
  for (let a = 0.30; a <= 0.98; a += 0.005) {
    let err = 0; const plate = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      const ts = Object.values(pairs).map(p => (p.belowLin[ch] - p.aboveLin[ch] * (1 - a)) / a);
      const mu = ts.reduce((s, v) => s + v, 0) / ts.length;
      plate[ch] = mu;
      err += ts.reduce((s, v) => s + (v - mu) ** 2, 0);
    }
    if (plate.some(v => v < -0.02 || v > 0.5)) continue;
    if (!best || err < best.err) best = { alpha: +a.toFixed(3), plateLin: plate.map(v => +v.toFixed(4)), err: +err.toFixed(7), plateHex: '#' + plate.map(v => l2s(v).toString(16).padStart(2, '0')).join('') };
  }
  // the faint left-sky aurora band: hunt for max chroma away from neutral in the left sky
  let bestRose = null;
  for (let yn = 0.06; yn < 0.24; yn += 0.006) for (let xn = 0.04; xn < 0.26; xn += 0.006) {
    const p = at(Math.floor(xn * W), Math.floor(yn * H));
    const mx = Math.max(...p), mn = Math.min(...p);
    // want R and B up, G down  => magenta-violet cast
    const cast = (p[0] + p[2]) / 2 - p[1];
    if (mx - mn < 3) continue;
    if (!bestRose || cast > bestRose.cast) bestRose = { xn: +xn.toFixed(3), yn: +yn.toFixed(3), cast, hex: '#' + p.map(z => z.toString(16).padStart(2, '0')).join('') };
  }
  return { edge, pairs, best, bestRose };
}, { b64 });
await browser.close();
console.log('EDGE SCAN'); for (const e of out.edge) console.log(' ', e.y, e.hex);
console.log('\nPAIRS'); for (const [k, v] of Object.entries(out.pairs)) console.log(' ', k, 'above', v.aboveHex, JSON.stringify(v.aboveLin), '-> below', v.belowHex, JSON.stringify(v.belowLin));
console.log('\nSOLVED PLATE', JSON.stringify(out.best));
console.log('\nMOST MAGENTA-CAST SKY SAMPLE', JSON.stringify(out.bestRose));
