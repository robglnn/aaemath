// Round-3 measurements: the numbers behind the resonance-class hardening, the
// B1 emissive-mask fix, and the blown-share reconciliation. Full resolution,
// no stride, decoded by review/p02-png.mjs (not by the auditor's canvas path).
//
//   node review/p02-r3-measure.mjs

import { readPNG, lum, hsv, hex, px } from './p02-png.mjs';

const img = readPNG(new URL('../reference/brief-hero.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { width: W, height: H } = img;
const out = {};
console.log(`reference ${W}x${H}  (${W * H} px)`);

// ── frame census at full resolution, plus the V distribution per class ───────
const cls = { danger: 0, success: 0, muted: 0, warm: 0, resonance: 0, bridge: 0, off: 0 };
let n = 0, sumY = 0, sumS = 0;
const resV = [], resS = [], skyResV = [];
// resonance-arc pixels by saturation band, to size the margin
let arcAll = 0, arcS20_30 = 0, arcS30 = 0;
// sky = above the horizon at y 0.31
const HORIZON = 0.31;
let skyN = 0, skyArc = 0;
// candidate discriminators
let resWithVcap = 0, resBelowHorizon = 0, resAboveHorizon = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = px(img, x, y);
    const Y = lum(r, g, b); const [h, s, v] = hsv(r, g, b);
    n++; sumY += Y; sumS += s;
    const above = y / H < HORIZON;
    if (above) skyN++;
    const inArc = h >= 150 && h <= 215;
    if (inArc) { arcAll++; if (above) skyArc++; if (s >= 0.20 && s < 0.30) arcS20_30++; if (s >= 0.30) arcS30++; }
    if (s >= 0.55 && h >= 330 && h < 355 && Y > 0.10) cls.danger++;
    else if (s >= 0.45 && h >= 95 && h < 125 && Y > 0.45) cls.success++;
    else if (s < 0.30) cls.muted++;
    else if (h < 60 || h >= 320) cls.warm++;
    else if (inArc) {
      cls.resonance++; resV.push(v); resS.push(s);
      if (above) { resAboveHorizon++; skyResV.push(v); } else resBelowHorizon++;
      if (v <= 0.85) resWithVcap++;
    }
    else if (h >= 90 && h < 150) cls.bridge++;
    else cls.off++;
  }
}
const f = k => +(cls[k] / n).toFixed(4);
out.census = { muted: f('muted'), warm: f('warm'), resonance: f('resonance'), bridge: f('bridge'), off: f('off'), meanY: +(sumY / n).toFixed(4), meanS: +(sumS / n).toFixed(4) };
out.census.warmToResonance = +(cls.warm / cls.resonance).toFixed(3);
console.log('census', out.census);

const pct = (a, q) => { const s = [...a].sort((p, r) => p - r); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(4); };
out.resonanceArc = {
  shareOfFrameInArc: +(arcAll / n).toFixed(4),
  shareParkedAtS20to30: +(arcS20_30 / n).toFixed(4),
  shareAboveS30: +(arcS30 / n).toFixed(4),
  skyFractionInsideArc: +(skyArc / skyN).toFixed(4)
};
console.log('resonance arc', out.resonanceArc);

out.resonanceClassV = { p05: pct(resV, 0.05), p25: pct(resV, 0.25), p50: pct(resV, 0.5), p75: pct(resV, 0.75), p95: pct(resV, 0.95) };
out.resonanceClassS = { p05: pct(resS, 0.05), p25: pct(resS, 0.25), p50: pct(resS, 0.5), p75: pct(resS, 0.75), p95: pct(resS, 0.95) };
out.skyResonanceV = skyResV.length ? { n: skyResV.length, p05: pct(skyResV, 0.05), p50: pct(skyResV, 0.5), p95: pct(skyResV, 0.95) } : null;
out.resonanceSplit = {
  aboveHorizon: +(resAboveHorizon / cls.resonance).toFixed(4),
  belowHorizon: +(resBelowHorizon / cls.resonance).toFixed(4),
  withVcap085: +(resWithVcap / n).toFixed(4)
};
console.log('resonance V', out.resonanceClassV, 'S', out.resonanceClassS);
console.log('split', out.resonanceSplit, 'skyResV', out.skyResonanceV);

// ── the stress test: what does a +0.05 sky saturation shift do? ──────────────
// Only pixels ABOVE the horizon are pushed; everything else is untouched.
function stress(dS, opts) {
  const c = { muted: 0, warm: 0, res: 0, bridge: 0, off: 0, danger: 0, success: 0 };
  let m = 0, worldN = 0, worldRes = 0, worldWarm = 0;
  for (let y = 0; y < H; y++) {
    const above = y / H < HORIZON;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(img, x, y);
      let [h, s, v] = hsv(r, g, b);
      if (above) s = Math.min(1, s + dS);
      const Y = lum(r, g, b);
      m++;
      if (!above) worldN++;
      let k;
      if (s >= 0.55 && h >= 330 && h < 355 && Y > 0.10) k = 'danger';
      else if (s >= 0.45 && h >= 95 && h < 125 && Y > 0.45) k = 'success';
      else if (s < 0.30) k = 'muted';
      else if (h < 60 || h >= 320) k = 'warm';
      else if (h >= 150 && h <= 215) k = (opts && opts.vCap && v > opts.vCap) ? 'muted' : 'res';
      else if (h >= 90 && h < 150) k = 'bridge';
      else k = 'off';
      c[k]++;
      if (!above) { if (k === 'res') worldRes++; if (k === 'warm') worldWarm++; }
    }
  }
  return {
    resonanceShare: +(c.res / m).toFixed(4),
    warmShare: +(c.warm / m).toFixed(4),
    warmToResonance: +(c.warm / c.res).toFixed(3),
    worldResonanceShare: +(worldRes / worldN).toFixed(4),
    worldWarmToResonance: +(worldWarm / worldRes).toFixed(3)
  };
}
out.stress = {
  baseline: stress(0, null),
  skyPlus005: stress(0.05, null),
  skyPlus010: stress(0.10, null),
  baseline_vcap085: stress(0, { vCap: 0.85 }),
  skyPlus005_vcap085: stress(0.05, { vCap: 0.85 }),
  skyPlus010_vcap085: stress(0.10, { vCap: 0.85 }),
  baseline_vcap078: stress(0, { vCap: 0.78 }),
  skyPlus005_vcap078: stress(0.05, { vCap: 0.78 }),
  skyPlus010_vcap078: stress(0.10, { vCap: 0.78 }),
  baseline_vcap072: stress(0, { vCap: 0.72 }),
  skyPlus005_vcap072: stress(0.05, { vCap: 0.72 }),
  skyPlus010_vcap072: stress(0.10, { vCap: 0.72 })
};
console.log('\nstress test (sky saturation pushed above the horizon):');
for (const [k, v] of Object.entries(out.stress)) console.log('  ' + k.padEnd(22), JSON.stringify(v));

// ── B1: what does the current whole-frame mask actually find? ────────────────
{
  const socket = [0.54, 0.62, 0.74, 0.82];
  let maskN = 0, peak = 0, peakAt = null, aboveHorizonMask = 0;
  const bright = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 2) {
    const [r, g, b] = px(img, x, y); const [h, s] = hsv(r, g, b);
    if (!(h >= 150 && h <= 215 && s >= 0.06)) continue;
    maskN++; if (y / H < HORIZON) aboveHorizonMask++;
    const Y = lum(r, g, b);
    if (Y > peak) { peak = Y; peakAt = [x / W, y / H]; }
    bright.push([Y, x / W, y / H]);
  }
  bright.sort((a, b) => b[0] - a[0]);
  const top200 = bright.slice(0, 200);
  const inSocket = top200.filter(p => p[1] >= socket[0] && p[1] <= socket[2] && p[2] >= socket[1] && p[2] <= socket[3]).length;
  out.b1Current = {
    maskPixels: maskN, sampled: Math.ceil(W / 2) * H,
    maskShareOfSampled: +(maskN / (Math.ceil(W / 2) * H)).toFixed(4),
    aboveHorizonShareOfMask: +(aboveHorizonMask / maskN).toFixed(4),
    peak: +peak.toFixed(4), peakAt: peakAt.map(v => +v.toFixed(4)),
    top200InsideSocketBox: inSocket
  };
  console.log('\nB1 as currently implemented:', out.b1Current);
}

// ── B1 fixed: peak inside a declared emitter box, and its component area ─────
{
  const box = [0.54, 0.62, 0.74, 0.82];
  let peak = 0, peakAt = null, peakHex = null;
  const X0 = Math.round(box[0] * W), X1 = Math.round(box[2] * W), Y0 = Math.round(box[1] * H), Y1 = Math.round(box[3] * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const [r, g, b] = px(img, x, y); const [h, s] = hsv(r, g, b);
    const Y = lum(r, g, b);
    const emissive = (h >= 150 && h <= 215) || (s <= 0.12 && Y > 0.60);
    if (!emissive) continue;
    if (Y > peak) { peak = Y; peakAt = [x / W, y / H]; peakHex = hex(r, g, b); }
  }
  out.b1Fixed = { box, peak: +peak.toFixed(4), peakAt: peakAt.map(v => +v.toFixed(4)), hex: peakHex };
  console.log('B1 inside the declared emitter box:', out.b1Fixed);
}

// ── the connected component containing the peak, at Y >= 0.90 ────────────────
{
  const seen = new Uint8Array(W * H);
  const isCore = (x, y) => { const [r, g, b] = px(img, x, y); const [h, s] = hsv(r, g, b); const Y = lum(r, g, b); return Y >= 0.90 && ((h >= 150 && h <= 215) || (s <= 0.12)); };
  const comps = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (seen[i] || !isCore(x, y)) { seen[i] = 1; continue; }
    let area = 0, sx = 0, sy = 0; const st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop(); const jx = j % W, jy = (j / W) | 0;
      area++; sx += jx; sy += jy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (seen[k]) continue;
        seen[k] = 1;
        if (isCore(nx, ny)) st.push(k);
      }
    }
    if (area >= 8) comps.push({ area, areaFrac: +(area / (W * H)).toFixed(6), at: [+(sx / area / W).toFixed(4), +(sy / area / H).toFixed(4)] });
  }
  comps.sort((a, b) => b.area - a.area);
  out.blownComponents = { count: comps.length, largest: comps.slice(0, 8) };
  console.log('blown-core components (Y>=0.90, cyan or near-neutral, area>=8):', comps.length);
  console.log('  largest:', JSON.stringify(comps.slice(0, 6)));
}

// ── blown share, both definitions ────────────────────────────────────────────
{
  let a = 0, b2 = 0, c = 0, tot = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    tot++;
    const [r, g, b] = px(img, x, y); const [h, s] = hsv(r, g, b); const Y = lum(r, g, b);
    if (Y >= 0.90 && h >= 150 && h <= 215) a++;                 // doc §5 / palette
    if (Y >= 0.90 && h >= 150 && h <= 215 && s >= 0.06) b2++;   // what B1b computes
    if (Y >= 0.90 && ((h >= 150 && h <= 215) || s <= 0.12)) c++; // emissive-mask definition
  }
  out.blownShare = { hueOnly: +(a / tot).toFixed(5), hueAndS06: +(b2 / tot).toFixed(5), emissiveMask: +(c / tot).toFixed(5) };
  console.log('blown share definitions:', out.blownShare);
}

// ── the terminator stop the doc mis-typed ───────────────────────────────────
{
  const s = hsv(0x68, 0x70, 0x4f);
  out.terminator = { hex: '#68704F', hue: +s[0].toFixed(1), S: +s[1].toFixed(3), V: +s[2].toFixed(3), Y: +lum(0x68, 0x70, 0x4f).toFixed(4) };
  const spec = hsv(0xff, 0xfc, 0xa0);
  out.specular = { hex: '#FFFCA0', hue: +spec[0].toFixed(1), S: +spec[1].toFixed(3) };
  console.log('terminator', out.terminator, 'specular', out.specular);
}

// ── composition invariants measured on the reference ─────────────────────────
{
  // negative space: S < 0.30 share
  let quiet = 0, tot = 0, borderDark = 0, borderN = 0;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const [r, g, b] = px(img, x, y); const [, s] = hsv(r, g, b);
    tot++; if (s < 0.30) quiet++;
    const nx = x / W, ny = y / H;
    if (nx > 0.12 && nx < 0.88 && ny > 0.12 && ny < 0.88) continue;
    borderN++; if (lum(r, g, b) < 0.06) borderDark++;
  }
  out.composition = { quietShare: +(quiet / tot).toFixed(4), borderDarkShare: +(borderDark / borderN).toFixed(4) };
  console.log('composition', out.composition);
}

console.log('\n' + JSON.stringify(out, null, 2).slice(0, 0));
import('node:fs').then(fs => fs.writeFileSync(new URL('./p02-r3-measurements.json', import.meta.url), JSON.stringify(out, null, 2)));
