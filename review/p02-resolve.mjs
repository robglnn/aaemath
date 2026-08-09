#!/usr/bin/env node
/**
 * P02 round-2 re-solve — the SOLVED constants.
 *
 *   node review/p02-resolve.mjs        →  review/p02-solved.json
 *
 * Round 1 measured census statistics correctly and then under-sampled every
 * constant that required a FIT. This script re-solves each of those over many
 * paired samples, records n / r² / the background range every time, and states
 * the rejection rule that produced the sample set. Where an estimate is soft it
 * reports a sensitivity sweep instead of a single digit.
 *
 * Compositing solves (scrim, veil) share one method:
 *   - locate the surface edge (per column for the scrim's horizontal edges, by a
 *     robust line fit per side for the hologram quad),
 *   - take FOUR samples outside the edge, least-squares a local line through them
 *     and extrapolate the background across the edge to the interior sample, so a
 *     sloped background cannot masquerade as a change in transmission,
 *   - reject a sample when the outside line does not fit (content not locally
 *     smooth), when the interior carries glyph ink, or when the background is too
 *     dark for transmission to be identifiable at all,
 *   - regress interior on background and report everything.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(path.join(ROOT, 'reference', 'brief-hero.png')).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const R = await page.evaluate(async ({ b64 }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const D = ctx.getImageData(0, 0, W, H).data;
  const LUT = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const px = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  const lin = (x, y) => { const p = px(x, y); return [LUT[p[0]], LUT[p[1]], LUT[p[2]]]; };
  const Yof = l => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const Y = (x, y) => Yof(lin(x, y));
  const hex = (x, y) => '#' + px(x, y).map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
  const hsvAt = (x, y) => {
    const [r, g, b] = px(x, y).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
    return [Math.round(h < 0 ? h + 360 : h), +(d / (mx || 1)).toFixed(3), +mx.toFixed(3)];
  };
  const NX = u => Math.min(W - 1, Math.max(0, Math.round(u * W)));
  const NY = v => Math.min(H - 1, Math.max(0, Math.round(v * H)));
  const box = (xc, yc, rx, ry) => {
    let a = 0, b2 = 0, c2 = 0, n = 0, mn = 9, mx = -9;
    for (let y = yc - ry; y <= yc + ry; y++) for (let x = xc - rx; x <= xc + rx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const l = lin(x, y); a += l[0]; b2 += l[1]; c2 += l[2]; n++;
      const yv = Yof(l); if (yv < mn) mn = yv; if (yv > mx) mx = yv;
    }
    const rgb = [a / n, b2 / n, c2 / n];
    return { rgb, Y: Yof(rgb), min: mn, max: mx };
  };
  const fit = (xs, ys) => {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const k = sxy / sxx;
    return { k, c: my - k * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, n };
  };
  const med = a => { const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
  const r4 = v => +v.toFixed(4);
  const out = { size: [W, H] };

  // ══════════════════════════════════════════════════════════════════════════
  // U1 · the subtitle scrim, which turns out to be a HORIZONTALLY GRADED plate
  // ══════════════════════════════════════════════════════════════════════════
  // Band edges: the median over x of Y(y+6)/Y(y-6) has a single deep minimum
  // (top edge) and, restricted to columns known to sit under the plate, a single
  // peak (bottom edge). Multiplicative, so scene content divides out.
  // Edge detector: median over x of the 6 px vertical difference, taken over
  // columns 0.40–0.60 where the plate is at full strength. The band's two edges
  // are the only full-width steps in the lower frame.
  const stepAt = (yy) => {
    const ds = [];
    for (let u = 0.40; u < 0.60; u += 0.002) { const x = NX(u); ds.push(Y(x, yy + 3) - Y(x, yy - 3)); }
    return med(ds);
  };
  let topY = 0, topV = 9, botY = 0, botV = -9;
  for (let yy = NY(0.83); yy < NY(0.86); yy++) { const d = stepAt(yy); if (d < topV) { topV = d; topY = yy; } }
  for (let yy = NY(0.948); yy < NY(0.970); yy++) { const d = stepAt(yy); if (d > botV) { botV = d; botY = yy; } }
  out.scrimBand = { topY: r4(topY / H), bottomY: r4(botY / H), heightFrac: r4((botY - topY) / H), topStep: r4(topV), bottomStep: r4(botV) };

  // Per-column transmission at both edges, sampled 7 px either side of the edge —
  // close enough that the underlying facet is the same pixel content, with a
  // second outside sample at 15 px used ONLY as a smoothness veto. A column with
  // no plate over it simply returns T ≈ 1, which is how the plate's extent is
  // recovered rather than assumed.
  const colT = [];
  for (let u = 0.005; u < 1; u += 0.0025) {
    const x = NX(u);
    const one = (edgeY, s) => {                       // s = +1 when interior is below edgeY
      const o1 = box(x, edgeY - s * 7, 3, 2), o2 = box(x, edgeY - s * 15, 3, 2);
      const inn = box(x, edgeY + s * 7, 3, 2);
      if (o1.Y < 0.05) return null;                                        // unidentifiable
      if (Math.abs(o1.Y - o2.Y) / Math.max(o1.Y, o2.Y) > 0.15) return null; // facet not smooth
      if (inn.max > 0.40) return null;                                      // caption glyph
      return { bg: o1.rgb, inn: inn.rgb, bgY: o1.Y, innY: inn.Y, t: inn.Y / o1.Y };
    };
    const a = one(topY, +1), b = one(botY, -1);
    colT.push({ u: r4(u), top: a ? r4(a.t) : null, bot: b ? r4(b.t) : null, _a: a, _b: b });
  }
  // Within the plateau the background barely varies (Y 0.16–0.18), so a
  // regression ACROSS columns cannot identify the slope — that is the trap round
  // one fell into. The identifiable regression is across the three CHANNELS of a
  // single column, whose backgrounds differ by 4×:
  //     in_ch = (1 − α)·bg_ch + α·P_ch,  with a neutral plate P_ch = p
  //          ⇒ in_ch = (1 − α)·bg_ch + (α·p)
  // i.e. a per-column line through 3 well-separated points. α is its slope
  // complement and p its intercept over α.
  const perColumn = [];
  for (const q of colT) {
    for (const s of [q._a, q._b]) {
      if (!s) continue;
      const f = fit(s.bg, s.inn);
      const alpha = 1 - f.k;
      if (alpha <= 0.02 || alpha > 1.0 || f.r2 < 0.985) continue;
      perColumn.push({ u: q.u, alpha, plate: f.c / alpha, t: s.t, bgY: s.bgY, r2: f.r2 });
    }
  }
  const plate = perColumn.filter(p => p.u >= 0.40 && p.u <= 0.60);
  const plateP = med(plate.map(p => p.plate));
  const plateAlpha = med(plate.map(p => p.alpha));
  const merged = colT.map(q => ({ u: q.u, t: q.top !== null && q.bot !== null ? (q.top + q.bot) / 2 : (q.top !== null ? q.top : q.bot) })).filter(q => q.t !== null);
  const smooth = merged.map((q, i) => ({ u: q.u, t: r4(med(merged.slice(Math.max(0, i - 4), i + 5).map(z => z.t))) }));
  // extent: a sustained crossing, not a single noisy column
  const sustained = (from, dir, thr, need) => {
    const arr = dir > 0 ? smooth : [...smooth].reverse();
    for (let i = 0; i < arr.length - need; i++) {
      if (arr.slice(i, i + need).every(q => q.t < thr)) return arr[i].u;
    }
    return null;
  };
  out.scrim = {
    method: 'paired samples 7 px either side of each band edge, per column; alpha and plate colour solved per column across the three channels',
    nColumnSolves: perColumn.length,
    plateau: {
      xRange: [0.40, 0.60], n: plate.length,
      medianAlpha: r4(plateAlpha),
      medianPlateLinear: +plateP.toFixed(5),
      plateSRGB: (() => { const v = Math.max(0, plateP); const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; const b = Math.round(s * 255); return '#' + [b, b, b].map(q => q.toString(16).padStart(2, '0').toUpperCase()).join(''); })(),
      medianTransmissionY: r4(med(plate.map(p => p.t))),
      alphaIQR: [r4(plate.map(p => p.alpha).sort((a, b) => a - b)[Math.floor(plate.length * 0.25)]), r4(plate.map(p => p.alpha).sort((a, b) => a - b)[Math.floor(plate.length * 0.75)])],
      bgRangeY: [r4(Math.min(...plate.map(p => p.bgY))), r4(Math.max(...plate.map(p => p.bgY)))]
    },
    rampWitness: perColumn.filter(p => p.u >= 0.28 && p.u <= 0.34).map(p => ({ u: p.u, alpha: r4(p.alpha), t: r4(p.t) })),
    extent: { leftEdge_T_below_0_85: sustained(0, +1, 0.85, 8), rightEdge_T_below_0_85: sustained(0, -1, 0.85, 8) },
    profile: smooth.filter((_, i) => i % 4 === 0)
  };
  out.scrimWitness = { atX030: [0.836, 0.842, 0.848, 0.940, 0.955, 0.962].map(v => ({ at: [0.30, v], Y: r4(Y(NX(0.30), NY(v))), hex: hex(NX(0.30), NY(v)), hsv: hsvAt(NX(0.30), NY(v)) })), atX047: [0.836, 0.842, 0.848, 0.940, 0.955, 0.962].map(v => ({ at: [0.47, v], Y: r4(Y(NX(0.47), NY(v))), hex: hex(NX(0.47), NY(v)), hsv: hsvAt(NX(0.47), NY(v)) })) };

  // ══════════════════════════════════════════════════════════════════════════
  // V1 · the hologram veil
  // ══════════════════════════════════════════════════════════════════════════
  const edgeScan = (fixed, isRow, a, b) => {
    let best = { g: 0, p: null };
    for (let t = a; t <= b; t += 0.0006) {
      const x = isRow ? NX(t) : NX(fixed), y = isRow ? NY(fixed) : NY(t);
      const g = isRow ? Math.abs(Y(x + 3, y) - Y(x - 3, y)) : Math.abs(Y(x, y + 3) - Y(x, y - 3));
      if (g > best.g) best = { g, p: t };
    }
    return best.p;
  };
  const robustLine = (ts, ps) => {
    let f = fit(ts, ps);
    const res = ps.map((p, i) => Math.abs(p - (f.k * ts[i] + f.c)));
    const cut = med(res) * 3 + 0.0015;
    const t2 = [], p2 = [];
    for (let i = 0; i < ts.length; i++) if (res[i] <= cut) { t2.push(ts[i]); p2.push(ps[i]); }
    const g = fit(t2, p2); return { k: g.k, c: g.c, kept: t2.length, of: ts.length };
  };
  const Lv = [], Ls = [], Rv = [], Rs = [], Tu = [], Ts = [], Bu = [], Bs = [];
  for (let v = 0.265; v <= 0.475; v += 0.004) { Lv.push(v); Ls.push(edgeScan(v, true, 0.470, 0.525)); Rv.push(v); Rs.push(edgeScan(v, true, 0.745, 0.795)); }
  for (let u = 0.515; u <= 0.755; u += 0.004) { Tu.push(u); Ts.push(edgeScan(u, false, 0.225, 0.292)); Bu.push(u); Bs.push(edgeScan(u, false, 0.470, 0.560)); }
  const Ln = robustLine(Lv, Ls), Rn = robustLine(Rv, Rs), Tn = robustLine(Tu, Ts), Bn = robustLine(Bu, Bs);
  const xL = v => Ln.k * v + Ln.c, xR = v => Rn.k * v + Rn.c, yT = u => Tn.k * u + Tn.c, yB = u => Bn.k * u + Bn.c;
  out.holoQuad = {
    left: { k: r4(Ln.k), c: r4(Ln.c), kept: `${Ln.kept}/${Ln.of}` }, right: { k: r4(Rn.k), c: r4(Rn.c), kept: `${Rn.kept}/${Rn.of}` },
    top: { k: r4(Tn.k), c: r4(Tn.c), kept: `${Tn.kept}/${Tn.of}` }, bottom: { k: r4(Bn.k), c: r4(Bn.c), kept: `${Bn.kept}/${Bn.of}` },
    corners: { TL: [r4(xL(yT(0.50))), r4(yT(0.498))], TR: [r4(xR(yT(0.77))), r4(yT(0.777))], BL: [r4(xL(yB(0.50))), r4(yB(0.493))], BR: [r4(xR(yB(0.77))), r4(yB(0.759))] },
    edgeSlopes: { top: r4(Tn.k), bottom: r4(Bn.k), left: r4(Ln.k), right: r4(Rn.k) },
    topBottomSlopeDifference: r4(Math.abs(Tn.k - Bn.k))
  };
  const veilSolve = (IN) => {
    const pairs = [], rej = { glyph: 0, rough: 0 };
    const add = (side, t, dir, ox, oy, dx, dy) => {        // dir: unit step outward
      const offs = [0.008, 0.014, 0.020, 0.026];
      const os = offs.map(d => box(NX(ox + dx * d), NY(oy + dy * d), 5, 5));
      const lf = fit(offs, os.map(o => o.Y));
      const resid = Math.sqrt(offs.reduce((a, d, i) => a + (os[i].Y - (lf.k * d + lf.c)) ** 2, 0) / 4);
      const inn = box(NX(ox - dx * IN), NY(oy - dy * IN), 5, 5);
      if (inn.max > 0.80) { rej.glyph++; return; }
      if (resid > 0.030) { rej.rough++; return; }
      const bg = lf.k * (-IN) + lf.c;
      if (bg <= 0.02) { rej.rough++; return; }
      pairs.push({ side, t: r4(t), bg: r4(bg), bgNaive: r4(os[0].Y), inn: r4(inn.Y) });
    };
    for (let v = 0.315; v <= 0.445; v += 0.005) {
      add('L·haze', v, 1, xL(v), v, -1, 0);
      add('R·city', v, 1, xR(v), v, +1, 0);
    }
    for (let u = 0.535; u <= 0.735; u += 0.005) {
      add('T·sky', u, 1, u, yT(u), 0, -1);
      add('B·valley', u, 1, u, yB(u), 0, +1);
    }
    const f = fit(pairs.map(p => p.bg), pairs.map(p => p.inn));
    return { IN, n: pairs.length, rejected: rej, slope: r4(f.k), intercept: r4(f.c), r2: r4(f.r2), alpha: r4(1 - f.k), fixedPointY: r4(f.c / (1 - f.k)), pairs };
  };
  const sweep = [0.008, 0.010, 0.012, 0.014, 0.018].map(veilSolve);
  const chosen = sweep.find(s => s.IN === 0.012);
  out.veil = {
    method: '4-sample outside line extrapolated across the edge; four panel edges = four backgrounds',
    sensitivitySweep: sweep.map(s => ({ interiorOffset: s.IN, n: s.n, slope: s.slope, intercept: s.intercept, r2: s.r2, fixedPointY: s.fixedPointY })),
    chosen: { interiorOffset: chosen.IN, n: chosen.n, rejected: chosen.rejected, slope: chosen.slope, intercept: chosen.intercept, r2: chosen.r2, alpha: chosen.alpha, fixedPointY: chosen.fixedPointY },
    slopeRange: [Math.min(...sweep.map(s => s.slope)), Math.max(...sweep.map(s => s.slope))],
    fixedPointRange: [Math.min(...sweep.map(s => s.fixedPointY)), Math.max(...sweep.map(s => s.fixedPointY))],
    bgRangeY: [r4(Math.min(...chosen.pairs.map(p => p.bg))), r4(Math.max(...chosen.pairs.map(p => p.bg)))],
    bySide: ['L·haze', 'R·city', 'T·sky', 'B·valley'].map(s => {
      const g = chosen.pairs.filter(p => p.side === s);
      return { side: s, n: g.length, meanBg: r4(g.reduce((a, p) => a + p.bg, 0) / g.length), meanDelta: r4(g.reduce((a, p) => a + (p.inn - p.bg), 0) / g.length) };
    }),
    darkeningOverBright: chosen.pairs.filter(p => p.bg > 0.60).map(p => r4(p.inn - p.bg)),
    lighteningOverDark: chosen.pairs.filter(p => p.bg < 0.35).map(p => r4(p.inn - p.bg)),
    pairs: chosen.pairs
  };
  out.veilColour = [[0.545, 0.290], [0.700, 0.470], [0.520, 0.470]].map(p => ({ at: p, hex: hex(NX(p[0]), NY(p[1])), hsv: hsvAt(NX(p[0]), NY(p[1])), Y: r4(Y(NX(p[0]), NY(p[1]))) }));
  let whiteN = 0, peakG = 0;
  for (let y = NY(0.26); y < NY(0.50); y++) for (let x = NX(0.50); x < NX(0.77); x++) {
    const p = px(x, y); if (p[0] === 255 && p[1] === 255 && p[2] === 255) whiteN++;
    const yv = Y(x, y); if (yv > peakG) peakG = yv;
  }
  out.holoGlyph = { pureWhitePixels: whiteN, peakY: r4(peakG), dataCyan: { at: [0.702, 0.395], hex: hex(NX(0.702), NY(0.395)), hsv: hsvAt(NX(0.702), NY(0.395)) } };

  // ══════════════════════════════════════════════════════════════════════════
  // B1 · emitter peak, blown-core budget, bloom falloff
  // ══════════════════════════════════════════════════════════════════════════
  let peak = { Y: -1 }, maskN = 0, blown = 0;
  for (let y = NY(0.62); y < NY(0.82); y++) for (let x = NX(0.54); x < NX(0.74); x++) {
    const yv = Y(x, y), [h, s] = hsvAt(x, y);
    if (!((h >= 150 && h <= 215) || (s <= 0.12 && yv > 0.60))) continue;
    maskN++; if (yv >= 0.90) blown++;
    if (yv > peak.Y) peak = { Y: r4(yv), x: r4(x / W), y: r4(y / H), hex: hex(x, y), hsv: hsvAt(x, y) };
  }
  out.emitter = { searchRegion: [0.54, 0.62, 0.74, 0.82], peak, maskPixels: maskN, blownPixels: blown };
  let hotN = 0, tot = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { tot++; if (Y(x, y) >= 0.90) { const h = hsvAt(x, y)[0]; if (h >= 150 && h <= 215) hotN++; } }
  out.blownResonanceShareOfFrame = +(hotN / tot).toFixed(5);
  const cx = peak.x * W, cy = peak.y * H;
  out.bloomAnnuli = [0.005, 0.01, 0.02, 0.03, 0.046, 0.065, 0.09, 0.12].map(rf => {
    const r = rf * H; let s = 0, n = 0, sm = 0, nm = 0;
    for (let a = 0; a < 720; a++) {
      const x = Math.round(cx + r * Math.cos(a * Math.PI / 360)), y = Math.round(cy + r * Math.sin(a * Math.PI / 360));
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const yv = Y(x, y); s += yv; n++;
      const h = hsvAt(x, y)[0]; if (h >= 150 && h <= 215) { sm += yv; nm++; }
    }
    return { rFracOfHeight: rf, annularMeanY: r4(s / n), resonanceOnlyMeanY: nm ? r4(sm / nm) : null, resonanceFraction: r4(nm / n) };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // K1 · key : fill on marked rock facets
  // ══════════════════════════════════════════════════════════════════════════
  const facet = b2 => { let s = 0, n = 0; for (let y = NY(b2[1]); y <= NY(b2[3]); y++) for (let x = NX(b2[0]); x <= NX(b2[2]); x++) { s += Y(x, y); n++; } return { Y: r4(s / n), n }; };
  const cands = {
    'terrace · lit top vs sky-shadowed face': { lit: [0.870, 0.481, 0.910, 0.489], shadow: [0.872, 0.598, 0.902, 0.612] },
    'terrace · lit top vs bounce-shadowed face': { lit: [0.870, 0.481, 0.910, 0.489], shadow: [0.872, 0.530, 0.900, 0.541] },
    'terrace · second lit band vs sky shadow': { lit: [0.870, 0.554, 0.902, 0.562], shadow: [0.872, 0.598, 0.902, 0.612] }
  };
  out.keyFill = {};
  for (const [k, v] of Object.entries(cands)) {
    const L2 = facet(v.lit), S2 = facet(v.shadow);
    const mid = b2 => [NX((b2[0] + b2[2]) / 2), NY((b2[1] + b2[3]) / 2)];
    out.keyFill[k] = { litBox: v.lit, shadowBox: v.shadow, litY: L2.Y, shadowY: S2.Y, ratio: +(L2.Y / S2.Y).toFixed(2), litHex: hex(...mid(v.lit)), litHsv: hsvAt(...mid(v.lit)), shadowHex: hex(...mid(v.shadow)), shadowHsv: hsvAt(...mid(v.shadow)) };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // I1 · ink width percentiles and the distance gate
  // ══════════════════════════════════════════════════════════════════════════
  const hb = [0.276, 0.276, 0.425, 0.960];
  out.ink = {
    heroBox: hb,
    byThreshold: [0.006, 0.012, 0.020].map(thr => {
      const runs = [];
      for (let y = NY(hb[1]); y < NY(hb[3]); y++) {
        let run = 0;
        for (let x = NX(hb[0]); x < NX(hb[2]); x++) { if (Y(x, y) <= thr) run++; else { if (run > 0 && run <= 40) runs.push(run); run = 0; } }
      }
      runs.sort((a, b) => a - b);
      const q = f => runs.length ? runs[Math.floor(runs.length * f)] : 0;
      return { threshold: thr, n: runs.length, p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90), p50FracOfWidth: +(q(0.50) / W).toFixed(5) };
    })
  };
  const density = (b2, thr) => { let n = 0, k = 0; for (let y = NY(b2[1]); y < NY(b2[3]); y += 2) for (let x = NX(b2[0]); x < NX(b2[2]); x += 2) { n++; if (Y(x, y) <= thr) k++; } return r4(k / n); };
  out.inkDistanceGate = { foregroundBand: density([0.02, 0.78, 0.98, 0.98], 0.006), distantBand: density([0.02, 0.33, 0.45, 0.42], 0.006) };
  out.inkColours = [[0.312, 0.470], [0.352, 0.283], [0.399, 0.735], [0.290, 0.905]].map(p => ({ at: p, hex: hex(NX(p[0]), NY(p[1])), hsv: hsvAt(NX(p[0]), NY(p[1])), Y: r4(Y(NX(p[0]), NY(p[1]))) }));

  // ══════════════════════════════════════════════════════════════════════════
  // albedo roles §5 / §9 assume but never define
  // ══════════════════════════════════════════════════════════════════════════
  const sample = (u, v) => ({ at: [u, v], hex: hex(NX(u), NY(v)), hsv: hsvAt(NX(u), NY(v)), Y: r4(Y(NX(u), NY(v))) });
  out.boneStone = [[0.148, 0.205], [0.163, 0.243], [0.196, 0.230], [0.128, 0.262], [0.243, 0.185], [0.180, 0.170]].map(p => sample(...p));
  out.foliage = [[0.170, 0.440], [0.500, 0.550], [0.088, 0.560], [0.352, 0.640], [0.640, 0.560], [0.240, 0.585]].map(p => sample(...p));
  let gN = 0, gSum = 0, gHi = 0, gMax = 0; const gHist = new Array(10).fill(0);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const [h, s] = hsvAt(x, y);
    if (h >= 70 && h < 120 && s >= 0.06) { gN++; gSum += s; gHist[Math.min(9, Math.floor(s * 10))]++; if (s > 0.30) gHi++; if (s > gMax) gMax = s; }
  }
  out.worldGreen = { hue70to119Pixels: gN, shareOfFrame: +(gN / (W * H / 4)).toFixed(5), meanS: r4(gSum / gN), maxS: +gMax.toFixed(3), shareAboveS030: r4(gHi / gN), sHistogram: gHist };

  out.satThird = [0, 1, 2].map(t => {
    let s = 0, n = 0;
    for (let y = Math.floor(t * H / 3); y < Math.floor((t + 1) * H / 3); y += 3) for (let x = 0; x < W; x += 3) { s += hsvAt(x, y)[1]; n++; }
    return r4(s / n);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // hero accent emitters · connected components, at a stated threshold
  // ══════════════════════════════════════════════════════════════════════════
  {
    const ax0 = NX(0.276), ax1 = NX(0.430), ay0 = NY(0.270), ay1 = NY(0.962);
    const aw = ax1 - ax0, ah = ay1 - ay0;
    const mask = new Uint8Array(aw * ah);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const [hh, ss, vv] = hsvAt(ax0 + x, ay0 + y);
      if (hh >= 150 && hh <= 215 && ss >= 0.45 && vv >= 0.62) mask[y * aw + x] = 1;
    }
    const lab = new Int32Array(aw * ah); let nc = 0; const comps = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || lab[i]) continue;
      nc++; const st = [i]; lab[i] = nc; let area = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
      while (st.length) {
        const j = st.pop(), jx = j % aw, jy = (j / aw) | 0;
        area++; mnx = Math.min(mnx, jx); mxx = Math.max(mxx, jx); mny = Math.min(mny, jy); mxy = Math.max(mxy, jy);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= aw || ny >= ah) continue;
          const k = ny * aw + nx; if (mask[k] && !lab[k]) { lab[k] = nc; st.push(k); }
        }
      }
      comps.push({ area, box: [r4((ax0 + mnx) / W), r4((ay0 + mny) / H), r4((ax0 + mxx) / W), r4((ay0 + mxy) / H)] });
    }
    comps.sort((a, b) => b.area - a.area);
    let heroArea = 0;
    for (let y = 0; y < ah; y++) {
      const bg = [];
      for (let k = 1; k <= 12; k++) { bg.push(hsvAt(ax0 - k, ay0 + y)[2]); bg.push(hsvAt(ax1 + k, ay0 + y)[2]); }
      const bv = med(bg);
      for (let x = 0; x < aw; x++) if (Math.abs(hsvAt(ax0 + x, ay0 + y)[2] - bv) > 0.12) heroArea++;
    }
    const big = comps.filter(q => q.area >= 90);
    out.heroAccent = {
      threshold: 'hue 150-215, S >= 0.45, V >= 0.62; components >= 90 px on a 2752-wide frame',
      components: comps.length, componentsOver90px: big.length,
      accentPixels: big.reduce((a, b) => a + b.area, 0), heroSilhouettePixels: heroArea,
      accentShareOfSilhouette: r4(big.reduce((a, b) => a + b.area, 0) / heroArea),
      top12: big.slice(0, 12)
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // silhouette · does a gap exist between the legs at all?
  // ══════════════════════════════════════════════════════════════════════════
  // Background match at full resolution: a run inside the hero span whose hue is
  // within 12° and whose Y is within 25% of the rock just outside the silhouette.
  out.legGap = [0.76, 0.78, 0.80, 0.82, 0.84, 0.86, 0.90, 0.94].map(v => {
    const y = NY(v);
    const bgs = [];
    for (let x = NX(0.24); x < NX(0.27); x++) bgs.push([Y(x, y), hsvAt(x, y)[0]]);
    for (let x = NX(0.44); x < NX(0.47); x++) bgs.push([Y(x, y), hsvAt(x, y)[0]]);
    const bY = med(bgs.map(b => b[0])), bH = med(bgs.map(b => b[1]));
    let best = 0, run = 0;
    for (let x = NX(0.30); x <= NX(0.41); x++) {
      const yv = Y(x, y), h = hsvAt(x, y)[0];
      const match = Math.abs(yv - bY) / Math.max(bY, 1e-3) < 0.25 && Math.abs(((h - bH + 540) % 360) - 180) < 12;
      if (match) run++; else { best = Math.max(best, run); run = 0; }
    }
    best = Math.max(best, run);
    return { y: v, bgY: r4(bY), bgHue: bH, widestBackgroundRunPx: best, fracOfFrameWidth: +(best / W).toFixed(4), pxAt64pxFrame: +(best / W * Math.round(W * 64 / H)).toFixed(2), pxAt128pxFrame: +(best / W * Math.round(W * 128 / H)).toFixed(2) };
  });
  return out;
}, { b64 });
await browser.close();

writeFileSync(path.join(ROOT, 'review', 'p02-solved.json'), JSON.stringify(R, null, 2));
const s = R.scrim, v = R.veil;
console.log(`\nU1 scrim  band y ${R.scrimBand.topY}..${R.scrimBand.bottomY} (h ${R.scrimBand.heightFrac})`);
console.log(`   plateau ${JSON.stringify(s.plateau)}`);
console.log(`   extent ${JSON.stringify(s.extent)}  ramp ${JSON.stringify(s.rampWitness)}`);
console.log('   profile ' + s.profile.map(p => `${p.u}:${p.t}`).join(' '));
console.log(`\nV1 veil   ${JSON.stringify(v.chosen)}`);
console.log(`   sweep   ${JSON.stringify(v.sensitivitySweep)}`);
console.log(`   sides   ${JSON.stringify(v.bySide)}`);
console.log(`   quad    ${JSON.stringify(R.holoQuad.edgeSlopes)} corners ${JSON.stringify(R.holoQuad.corners)}`);
console.log(`\nB1 peak ${R.emitter.peak.Y} ${R.emitter.peak.hex} @(${R.emitter.peak.x},${R.emitter.peak.y})  blownShare ${R.blownResonanceShareOfFrame}`);
console.log('   bloom ' + R.bloomAnnuli.map(b => `${b.rFracOfHeight}:${b.annularMeanY}`).join(' '));
console.log('\nK1 ' + Object.entries(R.keyFill).map(([k, o]) => `${k} = ${o.ratio} (${o.litY}/${o.shadowY}, ${o.litHex}→${o.shadowHex})`).join('\n   '));
console.log('I1 ' + JSON.stringify(R.ink.byThreshold) + ' ' + JSON.stringify(R.inkDistanceGate));
console.log('legGap ' + JSON.stringify(R.legGap));
console.log('satThird ' + JSON.stringify(R.satThird) + ' worldGreen ' + JSON.stringify(R.worldGreen));
console.log('bone ' + R.boneStone.map(b => b.hex + '/' + b.hsv[0] + '/' + b.hsv[1]).join(' '));
console.log('foliage ' + R.foliage.map(b => b.hex + '/' + b.hsv[0] + '/' + b.hsv[1]).join(' '));
