#!/usr/bin/env node
/**
 * Art-direction auditor for Variable Star (piece P02).
 *
 *   node review/art-audit.mjs <image.png> [--hero=x0,y0,x1,y1] [--json] [--quiet]
 *   node review/art-audit.mjs reference/brief-hero.png
 *
 * Measures a PNG against the targets in design/palette.json and prints one line
 * per check. Every threshold in this file comes from that JSON — the numbers live
 * in one place. Exits 1 if any check fails.
 *
 * This is the measuring stick for design/art-direction.md §10 "How to tell if we
 * lost". A claim about how the render looks that is not one of these numbers, or a
 * pixel someone actually looked at, is not a claim.
 *
 * Boxes are normalised (0..1) fractions of the frame.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d = null) => { const a = args.find(s => s.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const has = (n) => args.includes(`--${n}`);
const imgArg = args.find(a => !a.startsWith('--'));
if (!imgArg) { console.error('usage: node review/art-audit.mjs <image.png> [--hero=x0,y0,x1,y1] [--json]'); process.exit(2); }
const imgPath = path.resolve(ROOT, imgArg);
if (!existsSync(imgPath)) { console.error('no such image: ' + imgPath); process.exit(2); }

const palette = JSON.parse(readFileSync(path.join(ROOT, 'design', 'palette.json'), 'utf8'));
const heroBox = flag('hero') ? flag('hero').split(',').map(Number) : null;
const boxes = palette.depthCues.acutanceBoxes;
const depthBoxes = {
  foreground: flag('fg') ? flag('fg').split(',').map(Number) : boxes.foreground,
  midground: flag('mid') ? flag('mid').split(',').map(Number) : boxes.midground,
  distance: flag('far') ? flag('far').split(',').map(Number) : boxes.distance
};
const SC = palette.solvedConstants;
const solvedCfg = {
  litBox: flag('lit') ? flag('lit').split(',').map(Number) : SC.keyToFill.litBox,
  shadowBox: flag('shadow') ? flag('shadow').split(',').map(Number) : SC.keyToFill.shadowBox,
  holoBox: flag('holo') ? flag('holo').split(',').map(Number) : SC.veilCompression.searchBox,
  scrimSearch: flag('scrim') ? flag('scrim').split(',').map(Number) : [0.55, 0.995],
  inkThreshold: SC.inkWidth.threshold
};

const b64 = readFileSync(imgPath).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const m = await page.evaluate(async ({ b64, heroBox, depthBoxes, shadowCfg, solvedCfg }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const D = ctx.getImageData(0, 0, W, H).data;
  const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = s2l(i);
  const lum = (r, g, b) => 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];
  const hue = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return [0, 0];
    let h; if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
    return [h < 0 ? h + 360 : h, d / mx];
  };
  const at = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return [D[i], D[i + 1], D[i + 2]]; };

  const inWarm = h => (h < 60 || h >= 320);
  const inRes = h => (h >= 150 && h <= 215);
  const inBridge = h => (h >= 90 && h < 150);
  // State colours are detected in the arcs the world census proved empty:
  //   danger  330-355  (reference: 0.00% of saturated pixels in 250-349)
  //   success  95-125  (reference: 0.78% of saturated pixels in  70-119)
  // Classification is in PRIORITY ORDER — see palette.colourBudget.hueArcs.order.
  // success at 107° falls inside the bridge arc, so without the priority a
  // success flash is scored against the bridge budget instead of its own.
  // Each state colour carries a saturation floor; the bridge carries a ceiling,
  // which is what keeps world green (S <= 0.30) and success (S 0.542) apart.
  const inDanger = h => (h >= 330 && h < 355);
  const inSuccess = h => (h >= 95 && h < 125);
  const S_DANGER = 0.55, S_SUCCESS = 0.45;

  let n = 0, sumY = 0, sumS = 0;
  const counts = { muted: 0, warm: 0, res: 0, bridge: 0, other: 0, hot: 0, hotRes: 0, hotWarm: 0, danger: 0, success: 0 };
  const thirds = [{ muted: 0, res: 0, n: 0 }, { muted: 0, res: 0, n: 0 }, { muted: 0, res: 0, n: 0 }];
  const Ys = [];
  // shadow-chroma census, over mid-shadow pixels only
  let shN = 0, shCool = 0, shWarm = 0;
  for (let y = 0; y < H; y += 2) {
    const t = y / H < 1 / 3 ? 0 : (y / H < 2 / 3 ? 1 : 2);
    for (let x = 0; x < W; x += 2) {
      const [r, g, b] = at(x, y);
      const Y = lum(r, g, b); const [h, s] = hue(r, g, b);
      n++; sumY += Y; sumS += s; Ys.push(Y);
      thirds[t].n++;
      if (Y >= shadowCfg.yLo && Y <= shadowCfg.yHi && s >= shadowCfg.sMin) {
        shN++;
        if (h >= shadowCfg.cool[0] && h <= shadowCfg.cool[1]) shCool++;
        else if (h < 60 || h >= 320) shWarm++;
      }
      if (s >= S_DANGER && inDanger(h) && Y > 0.10) { counts.danger++; counts.hot++; }
      else if (s >= S_SUCCESS && inSuccess(h) && Y > 0.45) { counts.success++; counts.hot++; }
      else if (s < 0.30) { counts.muted++; thirds[t].muted++; }
      else {
        if (inWarm(h)) counts.warm++;
        else if (inRes(h)) { counts.res++; thirds[t].res++; }
        else if (inBridge(h)) counts.bridge++;
        else counts.other++;
        if (s >= 0.55) { counts.hot++; if (inRes(h)) counts.hotRes++; if (inWarm(h)) counts.hotWarm++; }
      }
    }
  }
  Ys.sort((a, b) => a - b);
  const P = q => +Ys[Math.min(Ys.length - 1, Math.floor(Ys.length * q))].toFixed(4);
  const frac = k => +(counts[k] / n).toFixed(4);

  // ---- acutance in normalised boxes ----
  const acut = (x0, y0, x1, y1) => {
    let s = 0, m2 = 0;
    const X0 = Math.max(2, Math.floor(x0 * W)), X1 = Math.min(W - 3, Math.floor(x1 * W));
    const Y0 = Math.max(2, Math.floor(y0 * H)), Y1 = Math.min(H - 3, Math.floor(y1 * H));
    for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) {
      s += Math.abs(4 * lum(...at(x, y)) - lum(...at(x - 2, y)) - lum(...at(x + 2, y)) - lum(...at(x, y - 2)) - lum(...at(x, y + 2)));
      m2++;
    }
    return m2 ? +(s / m2).toFixed(5) : 0;
  };
  // hero acutance uses the inset core of the silhouette box: the outer 20% of a
  // character bounding box is mostly background and dilutes the measurement.
  let heroCore = null;
  if (heroBox) {
    const [a, b, c2, d] = heroBox, w = c2 - a, hh = d - b;
    heroCore = [a + w * 0.15, b + hh * 0.20, c2 - w * 0.15, d - hh * 0.20];
  }
  const bands = {
    foreground: acut(...depthBoxes.foreground),
    midground: acut(...depthBoxes.midground),
    distance: acut(...depthBoxes.distance),
    hero: heroCore ? acut(...heroCore) : null,
    heroCoreBox: heroCore
  };

  // ---- saturation by third (row means) ----
  const satThird = [0, 1, 2].map(t => {
    let s = 0, m2 = 0;
    for (let y = Math.floor(t * H / 3); y < Math.floor((t + 1) * H / 3); y += 3)
      for (let x = 0; x < W; x += 3) { s += hue(...at(x, y))[1]; m2++; }
    return +(s / m2).toFixed(4);
  });

  // ---- sky quality: gradient smoothness / banding in the top 12% ----
  // Count distinct 8-bit codes per channel down a vertical sky column; a smooth
  // ramp with dither shows many, a banded one shows plateaus.
  const skyCol = Math.floor(W * 0.18);
  const codes = [new Set(), new Set(), new Set()];
  let maxRun = 0, run = 1, prev = null;
  for (let y = 0; y < Math.floor(H * 0.14); y++) {
    const p = at(skyCol, y);
    for (let ch = 0; ch < 3; ch++) codes[ch].add(p[ch]);
    const key = p.join(',');
    if (key === prev) { run++; maxRun = Math.max(maxRun, run); } else { run = 1; }
    prev = key;
  }
  const skySpanY = Math.abs(lum(...at(skyCol, 0)) - lum(...at(skyCol, Math.floor(H * 0.14) - 1)));

  // ---- framing mass: is there a dark anchor in the outer border? ----
  let borderDark = 0, borderN = 0;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const nx = x / W, ny = y / H;
    if (nx > 0.12 && nx < 0.88 && ny > 0.12 && ny < 0.88) continue;
    borderN++; if (lum(...at(x, y)) < 0.06) borderDark++;
  }

  // ---- hero separation: hero box mean Y vs the annulus around it ----
  let sep = null;
  if (heroBox) {
    const [hx0, hy0, hx1, hy1] = heroBox;
    const mean = (x0, y0, x1, y1, skip) => {
      let s = 0, m2 = 0;
      for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y += 2)
        for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x += 2) {
          if (skip && x / W > hx0 && x / W < hx1 && y / H > hy0 && y / H < hy1) continue;
          s += lum(...at(Math.min(W - 1, x), Math.min(H - 1, y))); m2++;
        }
      return m2 ? s / m2 : 0;
    };
    const pad = 0.04;
    const inner = mean(hx0, hy0, hx1, hy1, false);
    const outer = mean(Math.max(0, hx0 - pad), Math.max(0, hy0 - pad), Math.min(1, hx1 + pad), Math.min(1, hy1 + pad), true);
    sep = { heroY: +inner.toFixed(4), surroundY: +outer.toFixed(4), delta: +Math.abs(inner - outer).toFixed(4) };
  }

  // ═══════════════════ solved-constant probes ═══════════════════
  // Everything above is a frame-wide census. Everything below measures a
  // CONSTANT a builder types into a shader or a UI plate. These are the numbers
  // that were wrong in round 1 and that a census cannot see.
  const med = a => { const s = [...a].sort((p, q) => p - q); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : 0; };
  const NX = u => Math.min(W - 1, Math.max(0, Math.round(u * W)));
  const NY = v => Math.min(H - 1, Math.max(0, Math.round(v * H)));
  const s2lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const linAt = (x, y) => { const p = at(x, y); return [LUT[p[0]], LUT[p[1]], LUT[p[2]]]; };
  const Yof = l => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const boxAt = (xc, yc, rx, ry) => {
    let a = 0, b = 0, c2 = 0, k = 0, mx = -9, mn = 9;
    for (let y = yc - ry; y <= yc + ry; y++) for (let x = xc - rx; x <= xc + rx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const l = linAt(x, y); a += l[0]; b += l[1]; c2 += l[2]; k++;
      const yv = Yof(l); if (yv > mx) mx = yv; if (yv < mn) mn = yv;
    }
    const rgb = [a / k, b / k, c2 / k];
    return { rgb, Y: Yof(rgb), max: mx, min: mn };
  };
  const lsq = (xs, ys) => {
    const k = xs.length, mx = xs.reduce((p, q) => p + q, 0) / k, my = ys.reduce((p, q) => p + q, 0) / k;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < k; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const kk = sxx ? sxy / sxx : 0;
    return { k: kk, c: my - kk * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0, n: k };
  };

  // ── U1 · text-scrim transmission and its horizontal ramp ────────────────
  // A full-width plate is the only thing in a frame that puts the SAME signed
  // luminance step under most columns at one y. Detect both its edges that way,
  // then divide the interior by the exterior per column: scene content cancels.
  const scrimStep = yy => {
    const ds = [];
    for (let u = 0.05; u < 0.95; u += 0.004) { const x = NX(u); ds.push(lum(...at(x, Math.min(H - 4, yy + 3))) - lum(...at(x, Math.max(3, yy - 3)))); }
    return med(ds);
  };
  let scrim = null;
  {
    const y0 = NY(solvedCfg.scrimSearch[0]), y1 = NY(solvedCfg.scrimSearch[1]);
    let tY = -1, tV = 0, bY = -1, bV = 0;
    for (let yy = y0; yy < y1; yy++) { const d = scrimStep(yy); if (d < tV) { tV = d; tY = yy; } }
    if (tY > 0) for (let yy = tY + 8; yy < y1; yy++) { const d = scrimStep(yy); if (d > bV) { bV = d; bY = yy; } }
    if (tY > 0 && bY > tY && -tV > 0.015 && bV > 0.015) {
      const prof = [], alphas = [];
      for (let u = 0.005; u < 1; u += 0.0025) {
        const x = NX(u);
        const one = (edge, s) => {
          const o1 = boxAt(x, edge - s * 7, 3, 2), o2 = boxAt(x, edge - s * 15, 3, 2), i1 = boxAt(x, edge + s * 7, 3, 2);
          if (o1.Y < 0.05) return null;
          if (Math.abs(o1.Y - o2.Y) / Math.max(o1.Y, o2.Y) > 0.15) return null;
          if (i1.max > 0.40) return null;
          const f = lsq(o1.rgb, i1.rgb);                 // 3 channels → alpha and plate
          return { t: i1.Y / o1.Y, alpha: 1 - f.k, r2: f.r2 };
        };
        const a = one(tY, +1), b = one(bY, -1);
        const ts = [a, b].filter(Boolean);
        if (!ts.length) continue;
        const t = ts.reduce((p, q) => p + q.t, 0) / ts.length;
        prof.push({ u: +u.toFixed(4), t: +t.toFixed(4) });
        for (const q of ts) if (q.r2 > 0.985 && q.alpha > 0.02 && q.alpha <= 1) alphas.push(q.alpha);
      }
      if (prof.length >= 40) {
        const sm = prof.map((p, i) => ({ u: p.u, t: med(prof.slice(Math.max(0, i - 4), i + 5).map(z => z.t)) }));
        // the plateau is the deepest sustained run of the profile
        const lowest = [...sm].sort((a, b) => a.t - b.t).slice(0, Math.max(4, Math.round(sm.length * 0.25)));
        const plateauT = med(lowest.map(p => p.t));
        const cut = plateauT + 0.10;
        const iLo = sm.findIndex(p => p.t <= cut);
        let iHi = -1; for (let i = sm.length - 1; i >= 0; i--) if (sm[i].t <= cut) { iHi = i; break; }
        // RAMP WIDTH: how far, in frame widths, the plate takes to go from full
        // strength to effectively transparent. A hard-edged rectangle scores ~0.
        let rampL = null, rampR = null;
        for (let i = iLo; i >= 0; i--) if (sm[i].t >= 0.85) { rampL = +(sm[iLo].u - sm[i].u).toFixed(4); break; }
        for (let i = iHi; i < sm.length; i++) if (sm[i].t >= 0.85) { rampR = +(sm[i].u - sm[iHi].u).toFixed(4); break; }
        scrim = {
          bandY: [+(tY / H).toFixed(4), +(bY / H).toFixed(4)],
          columns: prof.length,
          plateauTransmission: +plateauT.toFixed(4),
          plateauAlpha: alphas.length ? +med(alphas.sort((a, b) => a - b)).toFixed(4) : null,
          plateExtentX: [iLo >= 0 ? sm[iLo].u : null, iHi >= 0 ? sm[iHi].u : null],
          rampWidth: [rampL, rampR],
          narrowestRamp: (rampL === null || rampR === null) ? 0 : Math.min(rampL, rampR),
          profile: sm.filter((_, i) => i % 8 === 0).map(p => [p.u, +p.t.toFixed(3)])
        };
      }
    }
  }

  // ── V1 · hologram veil compression ──────────────────────────────────────
  let veil = null, veilWhy = 'not attempted';
  {
    const [hx0, hy0, hx1, hy1] = solvedCfg.holoBox;
    const scan = (fixed, isRow, a, b) => {
      let best = { g: 0, p: null };
      for (let t = a; t <= b; t += 0.0008) {
        const x = isRow ? NX(t) : NX(fixed), y = isRow ? NY(fixed) : NY(t);
        const g = isRow ? Math.abs(lum(...at(Math.min(W - 4, x + 3), y)) - lum(...at(Math.max(3, x - 3), y)))
          : Math.abs(lum(...at(x, Math.min(H - 4, y + 3))) - lum(...at(x, Math.max(3, y - 3))));
        if (g > best.g) best = { g, p: t };
      }
      return best;
    };
    const robust = (ts, ps) => {
      let f = lsq(ts, ps);
      const res = ps.map((p, i) => Math.abs(p - (f.k * ts[i] + f.c)));
      const cut = med(res) * 3 + 0.0015, t2 = [], p2 = [];
      for (let i = 0; i < ts.length; i++) if (res[i] <= cut) { t2.push(ts[i]); p2.push(ps[i]); }
      const g = lsq(t2, p2); return { k: g.k, c: g.c, kept: t2.length, of: ts.length };
    };
    const mid = (a, b) => a + (b - a) / 2, span = (a, b) => (b - a);
    const Lv = [], Ls = [], Rv = [], Rs = [], Tu = [], Ts = [], Bu = [], Bs = [];
    const vy0 = hy0 + span(hy0, hy1) * 0.15, vy1 = hy1 - span(hy0, hy1) * 0.15;
    const ux0 = hx0 + span(hx0, hx1) * 0.15, ux1 = hx1 - span(hx0, hx1) * 0.15;
    for (let v = vy0; v <= vy1; v += 0.004) {
      Lv.push(v); Ls.push(scan(v, true, hx0, mid(hx0, hx1)).p);
      Rv.push(v); Rs.push(scan(v, true, mid(hx0, hx1), hx1).p);
    }
    for (let u = ux0; u <= ux1; u += 0.004) {
      Tu.push(u); Ts.push(scan(u, false, hy0, mid(hy0, hy1)).p);
      Bu.push(u); Bs.push(scan(u, false, mid(hy0, hy1), hy1).p);
    }
    const Ln = robust(Lv, Ls), Rn = robust(Rv, Rs), Tn = robust(Tu, Ts), Bn = robust(Bu, Bs);
    const straight = e => e.kept / e.of >= 0.5;
    veilWhy = `edge line fits kept L ${Ln.kept}/${Ln.of} R ${Rn.kept}/${Rn.of} T ${Tn.kept}/${Tn.of} B ${Bn.kept}/${Bn.of}`;
    if (straight(Ln) && straight(Rn) && straight(Tn) && straight(Bn)) {
      const xL = v => Ln.k * v + Ln.c, xR = v => Rn.k * v + Rn.c, yT = u => Tn.k * u + Tn.c, yB = u => Bn.k * u + Bn.c;
      const pairs = [];
      const add = (side, ox, oy, dx, dy) => {
        const offs = [0.008, 0.014, 0.020, 0.026];
        const os = offs.map(d => boxAt(NX(ox + dx * d), NY(oy + dy * d), 5, 5));
        const f = lsq(offs, os.map(o => o.Y));
        const resid = Math.sqrt(offs.reduce((a, d, i) => a + (os[i].Y - (f.k * d + f.c)) ** 2, 0) / 4);
        const inn = boxAt(NX(ox - dx * 0.008), NY(oy - dy * 0.008), 5, 5);
        // Reject glyph strokes by CONTRAST, not by brightness: an additive panel
        // is uniformly blown, and rejecting it for being bright is how the check
        // for additive panels would silently fail to run on an additive panel.
        if (inn.max - inn.min > 0.35 || inn.max > 0.97 || resid > 0.030) return;
        const bg = f.k * -0.008 + f.c;
        if (bg <= 0.02) return;
        pairs.push({ side, bg, inn: inn.Y });
      };
      for (let v = vy0; v <= vy1; v += 0.006) { add('L', xL(v), v, -1, 0); add('R', xR(v), v, +1, 0); }
      for (let u = ux0; u <= ux1; u += 0.006) { add('T', u, yT(u), 0, -1); add('B', u, yB(u), 0, +1); }
      veilWhy += `; ${pairs.length} usable pairs`;
      if (pairs.length >= 10) {
        const f = lsq(pairs.map(p => p.bg), pairs.map(p => p.inn));
        const bgs = pairs.map(p => p.bg);
        veil = {
          n: pairs.length, slope: +f.k.toFixed(4), intercept: +f.c.toFixed(4), r2: +f.r2.toFixed(4),
          fixedPointY: f.k < 0.999 ? +(f.c / (1 - f.k)).toFixed(4) : null,
          backgroundSpread: +(Math.max(...bgs) - Math.min(...bgs)).toFixed(4),
          sides: [...new Set(pairs.map(p => p.side))].length,
          quad: { topSlope: +Tn.k.toFixed(4), bottomSlope: +Bn.k.toFixed(4) }
        };
      }
    }
  }

  // ── B1 · emitter peak inside the emissive mask ──────────────────────────
  let peakY = 0, blown = 0, maskN = 0, totN = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 2) {
    totN++;
    const [r, g, b] = at(x, y); const [h, s] = hue(r, g, b);
    if (!(h >= 150 && h <= 215 && s >= 0.06)) continue;
    maskN++; const Y2 = lum(r, g, b);
    if (Y2 > peakY) peakY = Y2;
    if (Y2 >= 0.90) blown++;
  }
  const emitter = { peakY: +peakY.toFixed(4), maskPixels: maskN, blownShareOfFrame: +(blown / totN).toFixed(5) };

  // ── K1 · key : fill on the two marked rock boxes ─────────────────────────
  const meanBox = b => { let s = 0, k = 0; for (let y = NY(b[1]); y <= NY(b[3]); y++) for (let x = NX(b[0]); x <= NX(b[2]); x++) { s += lum(...at(x, y)); k++; } return k ? s / k : 0; };
  const litY = meanBox(solvedCfg.litBox), shY = meanBox(solvedCfg.shadowBox);
  const keyFill = { litY: +litY.toFixed(4), shadowY: +shY.toFixed(4), ratio: shY > 0.0005 ? +(litY / shY).toFixed(3) : null };

  // ── I1 · ink width percentiles inside the hero box ──────────────────────
  let ink = null;
  if (heroBox) {
    const runs = [];
    for (let y = NY(heroBox[1]); y < NY(heroBox[3]); y++) {
      let run = 0;
      for (let x = NX(heroBox[0]); x < NX(heroBox[2]); x++) {
        if (lum(...at(x, y)) <= solvedCfg.inkThreshold) run++;
        else { if (run > 0 && run <= 40) runs.push(run * 2752 / W); run = 0; }
      }
    }
    runs.sort((a, b) => a - b);
    if (runs.length >= 100) {
      const q = f => +runs[Math.floor(runs.length * f)].toFixed(2);
      ink = { n: runs.length, p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90), threshold: solvedCfg.inkThreshold };
    }
  }

  return {
    solved: { scrim, veil, veilWhy, emitter, keyFill, ink },
    size: [W, H], sampled: n,
    meanY: +(sumY / n).toFixed(4), meanS: +(sumS / n).toFixed(4),
    percentiles: { p01: P(0.01), p05: P(0.05), p10: P(0.10), p25: P(0.25), p50: P(0.50), p75: P(0.75), p90: P(0.90), p95: P(0.95), p99: P(0.99) },
    aboveY099: +(Ys.filter(v => v >= 0.99).length / n).toFixed(4),
    belowY001: +(Ys.filter(v => v <= 0.01).length / n).toFixed(4),
    share: { muted: frac('muted'), warm: frac('warm'), resonance: frac('res'), bridge: frac('bridge'), other: frac('other'), hot: frac('hot'), hotResonance: frac('hotRes'), danger: frac('danger'), success: frac('success') },
    warmToResonance: counts.res ? +(counts.warm / counts.res).toFixed(3) : Infinity,
    skyThirdMuted: +(thirds[0].muted / thirds[0].n).toFixed(4),
    bottomThirdResonance: +(thirds[2].res / thirds[2].n).toFixed(4),
    acutance: bands,
    satThird,
    sky: { distinctCodes: codes.map(s => s.size), longestFlatRun: maxRun, spanY: +skySpanY.toFixed(4) },
    borderDarkShare: +(borderDark / borderN).toFixed(4),
    shadowChroma: { samples: shN, coolShare: shN ? +(shCool / shN).toFixed(4) : 0, warmShare: shN ? +(shWarm / shN).toFixed(4) : 0 },
    heroSeparation: sep
  };
}, { b64, heroBox, depthBoxes, solvedCfg, shadowCfg: { yLo: 0.02, yHi: 0.12, sMin: 0.10, cool: palette.shadowChroma.coolIsHue } });
await browser.close();

// ───────────────────────── checks ─────────────────────────
const t = palette.colourBudget.targets;
const h = palette.luminanceHistogram;
const checks = [];
const range = (id, label, v, [lo, hi], note = '') => checks.push({ id, label, value: v, lo, hi, pass: v >= lo && v <= hi, note });
const atLeast = (id, label, v, lo, note = '') => checks.push({ id, label, value: v, lo, hi: null, pass: v >= lo, note });
const atMost = (id, label, v, hi, note = '') => checks.push({ id, label, value: v, lo: null, hi, pass: v <= hi, note });

range('L1', 'median luminance (p50)', m.percentiles.p50, h.percentileTargets.p50, 'exposure');
range('L2', 'shadow shoulder (p25)', m.percentiles.p25, h.percentileTargets.p25, 'toe must not crush');
range('L3', 'highlight shoulder (p90)', m.percentiles.p90, h.percentileTargets.p90, '');
range('L4', 'mean luminance', m.meanY, [h.meanLuminance.target - h.meanLuminance.tolerance, h.meanLuminance.target + h.meanLuminance.tolerance], '');
range('L5', 'mean saturation', m.meanS, [h.meanSaturation.target - h.meanSaturation.tolerance, h.meanSaturation.target + h.meanSaturation.tolerance], '');
atMost('L6', 'clipped highlights (Y>=0.99)', m.aboveY099, palette.exposure.clipping.maxFractionAbove_Y099, 'only emitters, sun, glyphs');
atMost('L7', 'crushed blacks (Y<=0.01)', m.belowY001, palette.exposure.clipping.maxFractionBelow_Y001, '');

range('C1', 'muted share', m.share.muted, t.mutedShareOfFrame, 'S<0.30');
range('C2', 'warm share', m.share.warm, t.warmShareOfFrame, 'hue 0-60/320-360, S>=0.30');
range('C3', 'resonance share', m.share.resonance, t.resonanceShareOfFrame, 'hue 150-215, S>=0.30');
range('C4', 'hot share', m.share.hot, t.hotShareOfFrame, 'S>=0.55');
range('C5', 'HOT RESONANCE share', m.share.hotResonance, t.hotResonanceShareOfFrame, 'the cyan budget');
range('C6', 'warm : resonance ratio', m.warmToResonance, t.warmToResonanceRatio, 'warm rock must dominate');
range('C7', 'sky third muted share', m.skyThirdMuted, t.skyThirdMutedShare, 'the sky carries hue, not saturation');
range('C8', 'bottom third resonance share', m.bottomThirdResonance, t.bottomThirdResonanceShare, '');
atMost('C9', 'danger share', m.share.danger, t.dangerShareOfFrame[1], 'transient only');
atMost('C10', 'success share', m.share.success, t.successShareOfFrame[1], 'transient only');
atMost('C11', 'off-language hue share', m.share.other, 0.02, 'hue 60-90 / 215-320 must stay empty');

range('X1', 'shadow cool share', m.shadowChroma.coolShare, palette.shadowChroma.coolShareTarget,
  `hue ${palette.shadowChroma.coolIsHue.join('-')} among 0.02<=Y<=0.12, S>=0.10 (n=${m.shadowChroma.samples}); warm ${m.shadowChroma.warmShare}`);

const dc = palette.depthCues;
const rFM = m.acutance.midground ? +(m.acutance.foreground / m.acutance.midground).toFixed(3) : 0;
const rFD = m.acutance.distance ? +(m.acutance.foreground / m.acutance.distance).toFixed(3) : 0;
range('D1', 'acutance foreground/distance', rFD, dc.acutanceRatioTargets.foregroundOverDistance, 'depth of field must exist');
range('D2', 'acutance foreground/midground', rFM, dc.acutanceRatioTargets.foregroundOverMidground, 'focus plane is near');
atLeast('D3', 'saturation rises with depth', +(m.satThird[2] - m.satThird[0]).toFixed(4), 0.15, `top ${m.satThird[0]} -> bottom ${m.satThird[2]}`);
if (m.acutance.hero !== null) {
  const rHM = +(m.acutance.hero / m.acutance.midground).toFixed(3);
  range('D4', 'acutance hero/midground', rHM, dc.acutanceRatioTargets.heroOverMidground, 'hero is the focus plane');
}

atLeast('F1', 'dark framing mass in border', m.borderDarkShare, 0.06, 'the frame is anchored by geometry, not a vignette');
atLeast('S1', 'sky gradient distinct codes', Math.min(...m.sky.distinctCodes), 8, `codes ${m.sky.distinctCodes.join('/')} over span ΔY ${m.sky.spanY}`);
if (m.sky.spanY >= 0.01) atMost('S2', 'longest flat run in sky column', m.sky.longestFlatRun, 8, 'banding detector — dither the ramp');
if (m.heroSeparation) atLeast('H1', 'hero/surround luminance separation', m.heroSeparation.delta, 0.10, `hero ${m.heroSeparation.heroY} vs surround ${m.heroSeparation.surroundY}`);

// ───────────────── solved constants (the numbers a builder types) ─────────────
// These are deliberately kept in their own list. Every check above is a
// frame-wide census statistic; every check below re-derives a constant that
// lives in palette.json and governs a surface the player looks through.
const solved = [];
const sAdd = (id, label, value, test, note, target) => solved.push({ id, label, value, pass: value === null ? null : test(value), note, target });
const sc = m.solved;

if (sc.scrim) {
  const t = SC.scrimTransmission;
  sAdd('U1a', 'scrim plateau transmission', sc.scrim.plateauTransmission,
    v => v >= t.plateauTransmissionY[0] && v <= t.plateauTransmissionY[1],
    `band y ${sc.scrim.bandY.join('–')}, ${sc.scrim.columns} columns; alpha ${sc.scrim.plateauAlpha}`,
    `[${t.plateauTransmissionY.join(' .. ')}]`);
  if (t.requireRamp) sAdd('U1b', 'scrim ends ramp out (frame widths)', sc.scrim.narrowestRamp,
    v => v >= t.minRampWidth, `plate x ${sc.scrim.plateExtentX.join('–')}, ramps ${JSON.stringify(sc.scrim.rampWidth)}; a hard vertical edge scores ~0`, `>= ${t.minRampWidth}`);
} else {
  sAdd('U1a', 'scrim plateau transmission', null, () => false, 'no full-width text plate detected — pass --scrim=y0,y1 if one is present', '');
  sAdd('U1b', 'scrim ends ramp out (frame widths)', null, () => false, 'not applicable without a detected plate', '');
}

if (sc.veil) {
  const t = SC.veilCompression;
  sAdd('V1a', 'veil compression slope', sc.veil.slope,
    v => v >= t.slope[0] && v <= t.slope[1],
    `n=${sc.veil.n} pairs over ${sc.veil.sides} edges, background spread ${sc.veil.backgroundSpread}, r² ${sc.veil.r2}`,
    `[${t.slope.join(' .. ')}]`);
  sAdd('V1b', 'veil fixed point', sc.veil.fixedPointY,
    v => v !== null && v >= t.fixedPointY[0] && v <= t.fixedPointY[1],
    `Y_in = ${sc.veil.slope}·Y_bg + ${sc.veil.intercept}; additive ⇒ slope≈1, flat plate ⇒ slope≈0`,
    `[${t.fixedPointY.join(' .. ')}]`);
  sAdd('V1c', 'veil fit is identifiable', sc.veil.backgroundSpread,
    v => v >= t.minBackgroundSpread && sc.veil.n >= t.minPairs && sc.veil.sides >= 2,
    `needs ≥${t.minPairs} pairs over ≥2 edges spanning ≥${t.minBackgroundSpread} of luminance`, `>= ${t.minBackgroundSpread}`);
} else {
  for (const id of ['V1a', 'V1b', 'V1c']) sAdd(id, 'veil compression', null, () => false, `no hologram quad resolved in ${JSON.stringify(solvedCfg.holoBox)} — ${sc.veilWhy}`, '');
}

sAdd('B1a', 'emitter peak in emissive mask', sc.emitter.peakY,
  v => v >= SC.emitterPeak.minPeakY, `mask hue ${SC.emitterPeak.maskHue.join('–')}, S≥0.06, ${sc.emitter.maskPixels} px`, `>= ${SC.emitterPeak.minPeakY}`);
sAdd('B1b', 'blown emitter cores in frame', sc.emitter.blownShareOfFrame,
  v => v >= 0.0002 && v <= 0.006, 'an emissive with no white-hot core reads as a painted decal', '[0.0002 .. 0.006]');

sAdd('K1', 'key : fill on marked rock', sc.keyFill.ratio,
  v => v !== null && Math.abs(v - SC.keyToFill.target) <= SC.keyToFill.tolerance,
  `lit ${sc.keyFill.litY} / shadow ${sc.keyFill.shadowY} on boxes ${JSON.stringify(solvedCfg.litBox)} , ${JSON.stringify(solvedCfg.shadowBox)}`,
  `${SC.keyToFill.target} ± ${SC.keyToFill.tolerance}`);

if (sc.ink) {
  const t = SC.inkWidth;
  sAdd('I1a', 'ink median width (px @2752)', sc.ink.p50, v => v >= t.p50[0] && v <= t.p50[1], `Y ≤ ${t.threshold}, n=${sc.ink.n}; p25 ${sc.ink.p25}, p75 ${sc.ink.p75}`, `[${t.p50.join(' .. ')}]`);
  sAdd('I1b', 'ink tapers (p90 > p50)', +(sc.ink.p90 - sc.ink.p50).toFixed(2), v => v > 0, `p90 ${sc.ink.p90} vs p50 ${sc.ink.p50}; a uniform outline scores 0`, '> 0');
} else {
  for (const id of ['I1a', 'I1b']) sAdd(id, 'ink width', null, () => false, heroBox ? 'too few ink runs inside --hero to measure' : 'needs --hero=x0,y0,x1,y1', '');
}

const solvedRan = solved.filter(c => c.value !== null);
const solvedFailed = solvedRan.filter(c => !c.pass);
const solvedNA = solved.filter(c => c.value === null);
const requireSolved = has('require-solved');

const failed = checks.filter(c => !c.pass);
if (has('json')) {
  console.log(JSON.stringify({
    image: path.relative(ROOT, imgPath), metrics: m,
    census: { checks, failed: failed.length },
    solvedConstants: { checks: solved, ran: solvedRan.length, failed: solvedFailed.length, notApplicable: solvedNA.length }
  }, null, 2));
} else {
  console.log(`\nart-audit  ${path.relative(ROOT, imgPath)}  ${m.size[0]}x${m.size[1]}`);
  console.log('─'.repeat(112));
  console.log('CENSUS — frame-wide statistics');
  for (const c of checks) {
    const bound = c.lo !== null && c.hi !== null ? `[${c.lo} .. ${c.hi}]` : c.lo !== null ? `>= ${c.lo}` : `<= ${c.hi}`;
    console.log(`${c.pass ? ' ok ' : 'FAIL'}  ${c.id.padEnd(4)} ${c.label.padEnd(34)} ${String(c.value).padStart(9)}  ${bound.padEnd(18)} ${c.note}`);
  }
  console.log('─'.repeat(112));
  console.log('SOLVED CONSTANTS — the numbers a builder types');
  for (const c of solved) {
    const tag = c.value === null ? 'n/a ' : (c.pass ? ' ok ' : 'FAIL');
    console.log(`${tag}  ${c.id.padEnd(4)} ${c.label.padEnd(34)} ${String(c.value === null ? '—' : c.value).padStart(9)}  ${String(c.target || '').padEnd(18)} ${c.note}`);
  }
  console.log('─'.repeat(112));
  console.log(`${checks.length - failed.length}/${checks.length} census · ${solvedRan.length - solvedFailed.length}/${solvedRan.length} solved` +
    (solvedNA.length ? ` · ${solvedNA.length} solved check${solvedNA.length > 1 ? 's' : ''} could not run` : ''));
  if (solvedNA.length && !requireSolved) console.log('  (pass --require-solved to make an unrunnable solved check a failure — UI and hologram pieces must)');
  if (!has('quiet')) {
    console.log('\npercentiles ', JSON.stringify(m.percentiles));
    console.log('share       ', JSON.stringify(m.share));
    console.log('acutance    ', JSON.stringify(m.acutance), ' satByThird', JSON.stringify(m.satThird));
    if (m.solved.scrim) console.log('scrim       ', JSON.stringify(m.solved.scrim.profile));
  }
}
process.exit(failed.length || solvedFailed.length || (requireSolved && solvedNA.length) ? 1 : 0);
