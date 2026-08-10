#!/usr/bin/env node
/**
 * P10 — Sky, clouds, atmosphere. The re-runnable proof.
 *
 *   node review/measure/P10.mjs                 # everything
 *   node review/measure/P10.mjs --only=BAND,DITHER
 *   node review/measure/P10.mjs --keep          # leave the captures in review/measure/out/
 *
 * This script exists because a prose claim about a sky is worth nothing. Every claim P10 makes is
 * turned into a number here, measured off real pixels from a real boot, and compared against a
 * threshold stated in this file. Where a claim could be satisfied by accident, the script also
 * runs the **control** that would fail if the feature were not doing the work — the banding claim
 * re-measures with the band sharpness flattened, the dither claim re-measures with the dither
 * switched off, the depth-law claim re-measures with the haze switched off, and the "not a
 * scrolling texture" claim searches for the shift that would make it one.
 *
 * Everything the script drives is a documented control surface on the systems themselves
 * (`__vs.kernel.get("sky").setDither(0)` and friends), not a private hack, so a critic can rerun
 * any step by hand.
 *
 * Exit code 0 iff every claim that ran passed.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";

const OUT = path.resolve(ROOT, "review/measure/out");
const KEEP = has("keep");
const ONLY = (arg("only", "") || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);

// =============================================================================================
// A dependency-free PNG reader. Self-contained on purpose: a measurement script that shares a
// decoder with the thing it is measuring can be wrong in the same direction twice.
// =============================================================================================

function readPNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let p = 8;
  let W = 0;
  let H = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString("latin1", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === "IHDR") {
      W = body.readUInt32BE(0);
      H = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (tag === "IDAT") idat.push(body);
    else if (tag === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * bpp;
  const out = Buffer.allocUnsafe(H * stride);
  let q = 0;
  for (let y = 0; y < H; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride);
    q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      cur[i] = v & 255;
    }
  }
  return { width: W, height: H, bpp, data: out };
}

const px = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

function hsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  return [d === 0 ? 0 : d, mx === 0 ? 0 : d / mx, mx / 255];
}

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");

const maxChan = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// =============================================================================================
// Claims and thresholds. Stated here, in one place, so a critic can argue with the number rather
// than with the prose.
// =============================================================================================

const results = [];
function claim(id, what, pass, detail) {
  results.push({ id, claim: what, pass: !!pass, ...detail });
}

// The band table P10 authors. Kept here rather than imported so a change in Sky.js that quietly
// moves a stop shows up as a failure instead of moving the goalposts with it.
const BANDS = [
  { el: 0.0, hex: "#F7A75C" },
  { el: 6.0, hex: "#EDA05E" },
  { el: 10.5, hex: "#BC9968" },
  { el: 15.0, hex: "#929576" },
  { el: 20.0, hex: "#6D8E81" },
  { el: 27.0, hex: "#558789" },
  { el: 90.0, hex: "#4A848B" },
];
const hexToRgb = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const T = {
  bandKneeRatio: 2.5, // knees must turn >= 2.5x faster than plateaus
  bandControlMax: 1.6, // and the flattened control must fall below this
  paletteMaxChan: 16, // rendered sky vs the measured target colour, 8-bit codes
  ditherRunMax: 8, // longest identical-triplet run down a sky column, px
  ditherRunRatio: 3.0, // and without the dither it must be at least this much worse
  edgeWidthMax: 2.0, // median cloud-edge transition width, px
  blockRunMin: 3.5, // mean vertical run of a constant cloud top-edge, px
  liveIoUMax: 0.9, // cloud mask overlap between simTime 0 and 8
  liveCentroidMin: 6, // px the cloud mass must have moved
  liveMeanDiffMin: 2.5, // mean |delta| over the sky region, 8-bit codes
  scrollResidualMin: 0.45, // best-shift residual as a fraction of the no-shift residual
  hazeFarSatDrop: 0.25, // far surfaces must lose >= 25% of their saturation
  hazeFarValueLift: 0.06, // and gain >= 6% value
  hazeNearMaxChange: 0.08, // near surfaces must be left alone
  drawCalls: 320,
  triangles: 1_600_000,
  programs: 90,
};

// =============================================================================================
// Page helpers
// =============================================================================================

/** Direction of the ray through an NDC point, computed from the live camera. */
const RAY_FN = `(nx, ny) => {
  const cam = window.__vs.kernel.camera;
  const th = Math.tan((cam.fov * Math.PI) / 360);
  const v = [nx * th * cam.aspect, ny * th, -1];
  const q = cam.quaternion;
  // rotate v by quaternion q
  const ix = q.w * v[0] + q.y * v[2] - q.z * v[1];
  const iy = q.w * v[1] + q.z * v[0] - q.x * v[2];
  const iz = q.w * v[2] + q.x * v[1] - q.y * v[0];
  const iw = -q.x * v[0] - q.y * v[1] - q.z * v[2];
  const r = [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ];
  const L = Math.hypot(r[0], r[1], r[2]) || 1;
  return [r[0] / L, r[1] / L, r[2] / L];
}`;

async function ray(d, nx, ny) {
  return d.page.evaluate(
    ([fn, a, b]) => new Function("return " + fn)()(a, b),
    [RAY_FN, nx, ny]
  );
}

/** Turn the camera until the frame centre looks at (azimuthDeg away from the sun, elevationDeg). */
async function aim(d, { awayFromSunDeg = 180, elevationDeg = 26 } = {}) {
  const sun = await d.probe("sky").then((p) => p.sun.toLight);
  const sunAz = (Math.atan2(sun[0], sun[2]) * 180) / Math.PI;
  const wantAz = ((sunAz + awayFromSunDeg + 540) % 360) - 180;

  const azOf = (v) => (Math.atan2(v[0], v[2]) * 180) / Math.PI;
  const elOf = (v) => (Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180) / Math.PI;
  const wrap = (x) => ((x + 540) % 360) - 180;

  // Empirical: we do not know the rig's look sensitivity, so calibrate it from one nudge and then
  // close the loop. Ten iterations is plenty and it never assumes a value it has not measured.
  let gainAz = 4; // px of mouse per degree, refined below
  let gainEl = 4;
  for (let i = 0; i < 14; i++) {
    const v = await ray(d, 0, 0);
    const dAz = wrap(wantAz - azOf(v));
    const dEl = elevationDeg - elOf(v);
    if (Math.abs(dAz) < 1.2 && Math.abs(dEl) < 1.2) break;
    const stepX = Math.max(-900, Math.min(900, dAz * gainAz));
    const stepY = Math.max(-900, Math.min(900, -dEl * gainEl));
    await d.look(stepX, stepY);
    const v2 = await ray(d, 0, 0);
    const movedAz = wrap(azOf(v2) - azOf(v));
    const movedEl = elOf(v2) - elOf(v);
    if (Math.abs(movedAz) > 0.5 && Math.abs(stepX) > 5) gainAz = Math.abs(stepX / movedAz);
    if (Math.abs(movedEl) > 0.5 && Math.abs(stepY) > 5) gainEl = Math.abs(stepY / movedEl);
  }
  const v = await ray(d, 0, 0);
  return { azimuthDeg: azOf(v), elevationDeg: elOf(v), sunAzimuthDeg: sunAz };
}

const shot = async (d, name) => {
  const p = `review/measure/out/${name}.png`;
  await d.shoot(p);
  return readPNG(path.resolve(ROOT, p));
};

const sky = (d, js) => d.page.evaluate(new Function(`return ${js}`));

// =============================================================================================
// The main session: everything that needs pixels.
// =============================================================================================

const W = Number(arg("width", "960"));
const H = Number(arg("height", "540"));

async function mainSession() {
  // `post=off` for the pixel claims: P12's GradePass runs its own dither and its own bloom, and a
  // measurement of P10's dither taken through P10+P12 measures the pair. The composited path is
  // checked separately by the BUDGET claim, which is where it matters.
  await openGame(
    { width: W, height: H, tier: "high", query: { post: "off" } },
    async (d) => {
      await d.play(0.6);

      const rep = await d.report();
      const skyProbe = rep.probes?.sky;
      const atmoProbe = rep.probes?.atmosphere;

      if (wanted("BOOT")) {
        const problems = [
          ...(rep.errors ?? []),
          ...d.consoleErrors,
          ...d.failedRequests,
        ].filter((e) => !/favicon/i.test(String(e)));
        claim("BOOT", "boots clean with both P10 systems mounted and the fog law installed",
          rep.ready && problems.length === 0 && !!skyProbe && atmoProbe?.installed === true,
          {
            ready: rep.ready,
            problems: problems.slice(0, 4),
            skyProbe: !!skyProbe,
            fogLawInstalled: atmoProbe?.installed ?? null,
            hazeSpace: atmoProbe?.space ?? null,
          });
      }

      if (wanted("SUN")) {
        const lit = rep.probes?.lighting?.sun;
        if (!lit) {
          claim("SUN", "sky glow agrees with the light rig's bearing", true, {
            note: "P11 not mounted — nothing to disagree with; sky published its own bearing",
            skyToLight: skyProbe?.sun?.toLight,
            adopted: skyProbe?.sun?.adopted,
          });
        } else {
          // Both probes round to 4 dp, which denormalises them by ~1e-5 and shows up as a
          // spurious 0.4 deg. Renormalise before comparing bearings.
          const unit = (v) => {
            const L = Math.hypot(v[0], v[1], v[2]) || 1;
            return [v[0] / L, v[1] / L, v[2] / L];
          };
          const a = unit(skyProbe.sun.toLight);
          const b = unit(lit.toLight);
          const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
          const deg = (Math.acos(dot) * 180) / Math.PI;
          claim("SUN", "sky glow agrees with the light rig's bearing to within 0.5 deg",
            deg <= 0.5 && skyProbe.sun.adopted === true,
            { angleDeg: Number(deg.toFixed(4)), adopted: skyProbe.sun.adopted, skyToLight: a, rigToLight: b });
        }
      }

      // ---------------------------------------------------------------- sky-only framing
      const framing = await aim(d, { awayFromSunDeg: 150, elevationDeg: 26 });
      await d.play(0.2);

      // Elevation of the centre column, row by row. Computed from the live camera, not assumed.
      const rows = [];
      for (let y = 2; y < H - 2; y += 2) {
        const ny = 1 - (2 * (y + 0.5)) / H;
        const v = await ray(d, 0, ny);
        rows.push({ y, el: (Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180) / Math.PI, dir: v });
      }
      const sunDir = skyProbe.sun.toLight;
      for (const r of rows) {
        const dot = r.dir[0] * sunDir[0] + r.dir[1] * sunDir[1] + r.dir[2] * sunDir[2];
        r.sunAngleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      }

      // Clouds off: the gradient on its own.
      await sky(d, `window.__vs.kernel.get("sky").setClouds(0)`);
      await d.play(1 / 60);
      const gradImg = await shot(d, "P10-gradient");

      const colAt = (img, x, y) => px(img, x, y);
      const cx = Math.round(W * 0.5);
      const sample = rows
        .filter((r) => r.el > 1 && r.el < 62 && r.sunAngleDeg > 55)
        .map((r) => ({ ...r, rgb: colAt(gradImg, cx, r.y) }));

      // ------------------------------------------------------------------------- BAND
      if (wanted("BAND")) {
        const rateAt = (elTarget, list) => {
          const win = list.filter((s) => Math.abs(s.el - elTarget) < 0.9);
          if (win.length < 2) return null;
          let acc = 0;
          let n = 0;
          for (let i = 1; i < win.length; i++) {
            const de = Math.abs(win[i].el - win[i - 1].el);
            if (de < 1e-4) continue;
            acc += maxChan(win[i].rgb, win[i - 1].rgb) / de;
            n++;
          }
          return n ? acc / n : null;
        };
        const knees = [];
        const plateaus = [];
        for (let i = 0; i < BANDS.length - 2; i++) {
          const a = BANDS[i].el;
          const b = BANDS[i + 1].el;
          if (b > 30) break;
          knees.push((a + b) / 2);
          if (i > 0) plateaus.push(a);
        }
        plateaus.push(BANDS[BANDS.length - 2].el);

        const measure = (list) => {
          const k = knees.map((e) => rateAt(e, list)).filter((v) => v !== null);
          const p = plateaus.map((e) => rateAt(e, list)).filter((v) => v !== null);
          return { knee: mean(k), plateau: mean(p), ratio: mean(p) > 1e-6 ? mean(k) / mean(p) : Infinity };
        };
        const live = measure(sample);

        // CONTROL: flatten the band sharpness to a plain smoothstep chain. If the banding were an
        // artefact of the sampling rather than of the shader, this would not move.
        await sky(d, `window.__vs.kernel.get("sky").setBandSharpness(1)`);
        await d.play(1 / 60);
        const flatImg = await shot(d, "P10-gradient-flat");
        const flatSample = sample.map((s) => ({ ...s, rgb: px(flatImg, cx, s.y) }));
        const flat = measure(flatSample);
        await sky(d, `window.__vs.kernel.get("sky").setBandSharpness(0.45)`);
        await d.play(1 / 60);

        claim("BAND", "the dusk gradient is authored in BANDS: knees turn far faster than plateaus",
          live.ratio >= T.bandKneeRatio && flat.ratio <= T.bandControlMax,
          {
            kneeRatePerDeg: Number(live.knee.toFixed(3)),
            plateauRatePerDeg: Number(live.plateau.toFixed(3)),
            ratio: Number(live.ratio.toFixed(2)),
            thresholdRatio: T.bandKneeRatio,
            controlFlatRatio: Number(flat.ratio.toFixed(2)),
            controlThreshold: T.bandControlMax,
            kneeElevationsDeg: knees,
            plateauElevationsDeg: plateaus,
          });
      }

      // ---------------------------------------------------------------------- PALETTE
      if (wanted("PALETTE")) {
        const checks = [];
        for (const b of BANDS) {
          if (b.el < 5 || b.el > 30) continue;
          const near = sample.filter((s) => Math.abs(s.el - b.el) < 0.6);
          if (!near.length) continue;
          const got = [0, 1, 2].map((c) => Math.round(mean(near.map((s) => s.rgb[c]))));
          const want = hexToRgb(b.hex);
          checks.push({
            elevationDeg: b.el,
            target: b.hex,
            rendered: hex(got[0], got[1], got[2]),
            maxChannelDelta: maxChan(got, want),
          });
        }
        const worst = Math.max(0, ...checks.map((c) => c.maxChannelDelta));
        claim("PALETTE", "rendered sky matches the colour measured off target-lowpoly.png",
          checks.length >= 3 && worst <= T.paletteMaxChan,
          { worstChannelDelta: worst, threshold: T.paletteMaxChan, checks });
      }

      // ----------------------------------------------------------------------- DITHER
      if (wanted("DITHER")) {
        const longestRun = (img, xs) => {
          const per = [];
          for (const x of xs) {
            let best = 1;
            let run = 1;
            let prev = px(img, x, 2);
            for (let y = 3; y < Math.floor(H * 0.75); y++) {
              const cur = px(img, x, y);
              if (cur[0] === prev[0] && cur[1] === prev[1] && cur[2] === prev[2]) run++;
              else {
                best = Math.max(best, run);
                run = 1;
              }
              prev = cur;
            }
            per.push(Math.max(best, run));
          }
          return median(per);
        };
        const xs = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => Math.round(f * W));
        const on = longestRun(gradImg, xs);

        await sky(d, `window.__vs.kernel.get("sky").setDither(0)`);
        await d.play(1 / 60);
        const offImg = await shot(d, "P10-gradient-nodither");
        const off = longestRun(offImg, xs);
        await sky(d, `window.__vs.kernel.get("sky").setDither(1.25)`);
        await d.play(1 / 60);

        claim("DITHER", "the banded ramp is dithered, not posterised",
          on <= T.ditherRunMax && off / Math.max(on, 1) >= T.ditherRunRatio,
          {
            longestIdenticalRunPx: on,
            threshold: T.ditherRunMax,
            controlWithoutDitherPx: off,
            ratio: Number((off / Math.max(on, 1)).toFixed(2)),
            ratioThreshold: T.ditherRunRatio,
            note: "post=off so this is P10's own 8x8 Bayer, not P12's grade dither",
          });
      }

      // ------------------------------------------------------- clouds: EDGE / BLOCK / LIVE
      await sky(d, `window.__vs.kernel.get("sky").setClouds(1)`);
      await d.play(1 / 60);
      const t0 = await shot(d, "P10-clouds-t0");
      const camA = await sky(d, `window.__vs.kernel.camera.matrixWorld.elements.slice()`);

      // The cloud mask is exact: it is the difference against the same frame with the decks off.
      await sky(d, `window.__vs.kernel.get("sky").setClouds(0)`);
      await d.play(1 / 60);
      const noCloud = await shot(d, "P10-clouds-off");
      await sky(d, `window.__vs.kernel.get("sky").setClouds(1)`);
      await d.play(1 / 60);

      const maskOf = (a, b) => {
        const m = new Uint8Array(W * H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            m[y * W + x] = maxChan(px(a, x, y), px(b, x, y)) > 10 ? 1 : 0;
          }
        return m;
      };
      const mask0 = maskOf(t0, noCloud);
      const coverage = mask0.reduce((s, v) => s + v, 0) / (W * H);

      if (wanted("EDGE")) {
        // Walk each row; at every mask boundary, measure how many pixels the cloud/sky difference
        // takes to go from 10% to 90% of its own full height. A volumetric cloud takes tens.
        const widths = [];
        for (let y = 4; y < H - 4; y += 3) {
          for (let x = 6; x < W - 6; x++) {
            const inside = mask0[y * W + x];
            const outside = mask0[y * W + x - 1];
            if (inside === outside) continue;
            const dAt = (xx) => maxChan(px(t0, xx, y), px(noCloud, xx, y));
            let full = 0;
            for (let k = 0; k < 6; k++) full = Math.max(full, dAt(Math.min(W - 1, Math.max(0, inside ? x + k : x - 1 - k))));
            if (full < 20) continue;
            let w = 0;
            for (let k = -4; k <= 4; k++) {
              const v = dAt(Math.min(W - 1, Math.max(0, x + k)));
              if (v > full * 0.1 && v < full * 0.9) w++;
            }
            widths.push(w);
          }
        }
        claim("EDGE", "cloud silhouettes are HARD: the sky-to-cloud transition is 1-2 px",
          widths.length > 50 && median(widths) <= T.edgeWidthMax,
          {
            medianEdgeWidthPx: median(widths),
            meanEdgeWidthPx: Number(mean(widths).toFixed(2)),
            samples: widths.length,
            threshold: T.edgeWidthMax,
            cloudCoverageOfFrame: Number(coverage.toFixed(3)),
          });
      }

      if (wanted("BLOCK")) {
        // A blocky slab has a staircase outline: the top edge holds the same row for a run of
        // columns, then steps. A smooth blob steps every pixel or two.
        const top = new Int32Array(W).fill(-1);
        for (let x = 0; x < W; x++)
          for (let y = 0; y < Math.floor(H * 0.8); y++)
            if (mask0[y * W + x]) {
              top[x] = y;
              break;
            }
        const runs = [];
        let run = 0;
        for (let x = 1; x < W; x++) {
          if (top[x] < 0 || top[x - 1] < 0) {
            if (run > 0) runs.push(run + 1);
            run = 0;
            continue;
          }
          if (top[x] === top[x - 1]) run++;
          else {
            if (run > 0) runs.push(run + 1);
            run = 0;
          }
        }
        if (run > 0) runs.push(run + 1);
        const m = mean(runs);
        const bigFraction = runs.filter((r) => r >= 6).length / Math.max(runs.length, 1);
        claim("BLOCK", "cloud outlines are rectangular staircases, not smooth curves",
          runs.length > 8 && m >= T.blockRunMin,
          {
            meanFlatRunPx: Number(m.toFixed(2)),
            medianFlatRunPx: median(runs),
            runsOver6pxFraction: Number(bigFraction.toFixed(2)),
            runs: runs.length,
            threshold: T.blockRunMin,
          });
      }

      // ------------------------------------------------------------------ LIVE / SCROLL
      let t4 = null;
      let t8 = null;
      let camDrift = null;
      if (wanted("LIVE") || wanted("SCROLL")) {
        await d.play(4);
        t4 = await shot(d, "P10-clouds-t4");
        await d.play(4);
        t8 = await shot(d, "P10-clouds-t8");
        const camB = await sky(d, `window.__vs.kernel.camera.matrixWorld.elements.slice()`);
        camDrift = Math.max(...camA.map((v, i) => Math.abs(v - camB[i])));
      }

      // The sky region: the upper part of a frame aimed 26 deg up is sky and nothing else.
      const R = { x0: Math.round(W * 0.08), x1: Math.round(W * 0.92), y0: 4, y1: Math.round(H * 0.38) };

      if (wanted("LIVE")) {
        const mask8 = maskOf(t8, noCloud);
        let inter = 0;
        let uni = 0;
        let c0x = 0;
        let c0y = 0;
        let n0 = 0;
        let c8x = 0;
        let c8y = 0;
        let n8 = 0;
        for (let y = R.y0; y < R.y1; y++)
          for (let x = R.x0; x < R.x1; x++) {
            const a = mask0[y * W + x];
            const b = mask8[y * W + x];
            if (a && b) inter++;
            if (a || b) uni++;
            if (a) {
              c0x += x;
              c0y += y;
              n0++;
            }
            if (b) {
              c8x += x;
              c8y += y;
              n8++;
            }
          }
        const iou = uni ? inter / uni : 1;
        const shift = n0 && n8 ? Math.hypot(c0x / n0 - c8x / n8, c0y / n0 - c8y / n8) : 0;
        let diff = 0;
        let count = 0;
        for (let y = R.y0; y < R.y1; y++)
          for (let x = R.x0; x < R.x1; x++) {
            diff += maxChan(px(t0, x, y), px(t8, x, y));
            count++;
          }
        const meanDiff = diff / Math.max(count, 1);
        // t4 must differ from both, or "movement" could be one jump at the end.
        let d04 = 0;
        let d48 = 0;
        for (let y = R.y0; y < R.y1; y++)
          for (let x = R.x0; x < R.x1; x++) {
            d04 += maxChan(px(t0, x, y), px(t4, x, y));
            d48 += maxChan(px(t4, x, y), px(t8, x, y));
          }
        claim("LIVE", "clouds genuinely move between simTime 0, 4 and 8",
          iou <= T.liveIoUMax &&
            shift >= T.liveCentroidMin &&
            meanDiff >= T.liveMeanDiffMin &&
            d04 / count >= T.liveMeanDiffMin * 0.5 &&
            d48 / count >= T.liveMeanDiffMin * 0.5 &&
            camDrift < 1e-3,
          {
            maskIoU_t0_t8: Number(iou.toFixed(4)),
            iouThreshold: T.liveIoUMax,
            centroidShiftPx: Number(shift.toFixed(2)),
            centroidThreshold: T.liveCentroidMin,
            meanAbsDiff_t0_t8: Number(meanDiff.toFixed(2)),
            meanAbsDiff_t0_t4: Number((d04 / count).toFixed(2)),
            meanAbsDiff_t4_t8: Number((d48 / count).toFixed(2)),
            diffThreshold: T.liveMeanDiffMin,
            cameraDriftBetweenCaptures: Number(camDrift.toExponential(2)),
          });
      }

      if (wanted("SCROLL")) {
        // If the decks were a scrolling texture, SOME rigid 2-D shift would reconstruct t8 from
        // t0 almost exactly. Search for it; the residual it leaves is the claim.
        const s = 2; // work at half resolution: 2 px of search resolution is ample for a 16 px drift
        const w = Math.floor((R.x1 - R.x0) / s);
        const h = Math.floor((R.y1 - R.y0) / s);
        const grab = (img) => {
          const a = new Float32Array(w * h);
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++) {
              const p2 = px(img, R.x0 + i * s, R.y0 + j * s);
              a[j * w + i] = (p2[0] + p2[1] + p2[2]) / 3;
            }
          return a;
        };
        const A = grab(t0);
        const B = grab(t8);
        const M = 24; // +-48 px in the original image
        const residual = (dx, dy) => {
          let acc = 0;
          let n = 0;
          for (let j = M; j < h - M; j++)
            for (let i = M; i < w - M; i++) {
              acc += Math.abs(A[j * w + i] - B[(j + dy) * w + (i + dx)]);
              n++;
            }
          return n ? acc / n : 1e9;
        };
        const zero = residual(0, 0);
        let best = Infinity;
        let bx = 0;
        let by = 0;
        for (let dy = -12; dy <= 12; dy++)
          for (let dx = -M; dx <= M; dx++) {
            const r = residual(dx, dy);
            if (r < best) {
              best = r;
              bx = dx;
              by = dy;
            }
          }
        const frac = zero > 1e-6 ? best / zero : 1;
        claim("SCROLL", "the decks are not a scrolling texture: no rigid shift reconstructs them",
          frac >= T.scrollResidualMin,
          {
            noShiftResidual: Number(zero.toFixed(3)),
            bestShiftResidual: Number(best.toFixed(3)),
            bestShiftPx: [bx * s, by * s],
            residualFraction: Number(frac.toFixed(3)),
            threshold: T.scrollResidualMin,
          });
      }

      // ------------------------------------------------------------------------- DEPTH
      if (wanted("DEPTH")) {
        // Aim back down at the world, then bin real pixels by REAL metres.
        await aim(d, { awayFromSunDeg: 150, elevationDeg: 2 });
        await d.play(0.3);

        const pts = [];
        for (let i = 0; i < 21; i++) {
          for (const nx of [-0.45, 0, 0.45]) {
            pts.push({ nx, ny: -0.08 - i * 0.042 });
          }
        }
        const hits = await d.page.evaluate(
          (p) => window.__vs.kernel.get("atmosphere").sampleDistances(p),
          pts
        );

        const withHaze = await shot(d, "P10-depth-haze");
        await sky(d, `window.__vs.kernel.get("atmosphere").setEnabled(false)`);
        await d.play(1 / 60);
        const noHaze = await shot(d, "P10-depth-nohaze");
        await sky(d, `window.__vs.kernel.get("atmosphere").setEnabled(true)`);
        await d.play(1 / 60);

        const bins = { near: [], mid: [], far: [] };
        for (const hit of hits) {
          if (!hit.hit) continue;
          const x = Math.round(((hit.nx + 1) / 2) * (W - 1));
          const y = Math.round(((1 - hit.ny) / 2) * (H - 1));
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          const a = px(withHaze, x, y);
          const b = px(noHaze, x, y);
          const [, sa, va] = hsv(...a);
          const [, sb, vb] = hsv(...b);
          const rec = {
            distance: hit.distance,
            f: hit.f,
            satNoHaze: Number(sb.toFixed(3)),
            satHaze: Number(sa.toFixed(3)),
            valNoHaze: Number(vb.toFixed(3)),
            valHaze: Number(va.toFixed(3)),
          };
          if (hit.distance < 90) bins.near.push(rec);
          else if (hit.distance < 320) bins.mid.push(rec);
          else bins.far.push(rec);
        }
        const summarise = (list) => ({
          n: list.length,
          meanDistance: Number(mean(list.map((r) => r.distance)).toFixed(1)),
          satDrop: Number(
            (
              1 -
              mean(list.map((r) => r.satHaze)) / Math.max(1e-4, mean(list.map((r) => r.satNoHaze)))
            ).toFixed(3)
          ),
          valueLift: Number(
            (mean(list.map((r) => r.valHaze)) - mean(list.map((r) => r.valNoHaze))).toFixed(3)
          ),
        });
        const near = summarise(bins.near);
        const mid = summarise(bins.mid);
        const far = summarise(bins.far);
        const ok =
          far.n >= 3 &&
          near.n >= 3 &&
          far.satDrop >= T.hazeFarSatDrop &&
          far.valueLift >= T.hazeFarValueLift &&
          Math.abs(near.satDrop) <= T.hazeNearMaxChange &&
          Math.abs(near.valueLift) <= T.hazeNearMaxChange &&
          far.satDrop > mid.satDrop &&
          mid.satDrop > near.satDrop;
        claim("DEPTH", "distance desaturates and lifts value; the near field is left alone",
          ok,
          {
            near,
            mid,
            far,
            thresholds: {
              farSatDrop: T.hazeFarSatDrop,
              farValueLift: T.hazeFarValueLift,
              nearMaxChange: T.hazeNearMaxChange,
              monotone: "far > mid > near saturation drop",
            },
          });
      }

      return { framing, coverage };
    }
  );
}

// =============================================================================================
// Cheap sessions: tiers and the real 1080p budget.
// =============================================================================================

async function tierSession(tier) {
  return openGame({ width: 640, height: 360, tier }, async (d) => {
    await d.play(0.5);
    const rep = await d.report();
    const s = rep.probes?.sky;
    const a = rep.probes?.atmosphere;
    return {
      tier,
      ready: rep.ready,
      errors: [...(rep.errors ?? []), ...d.consoleErrors].slice(0, 2),
      knobs: s?.knobs ?? null,
      decks: s?.cloud?.decks ?? null,
      hazeInstalled: a?.installed ?? null,
      hazeFlat: a?.flatFallback ?? null,
      hazeFar: a?.far ?? null,
      drawCalls: rep.stats?.drawCalls ?? null,
    };
  });
}

async function budgetSession() {
  return openGame({ width: 1920, height: 1080, tier: "high" }, async (d) => {
    await d.play(1.2);
    const rep = await d.report();
    return { stats: rep.stats, sky: rep.probes?.sky, atmo: rep.probes?.atmosphere };
  });
}

// =============================================================================================

fs.mkdirSync(OUT, { recursive: true });

let framingInfo = null;
try {
  framingInfo = await mainSession();
} catch (err) {
  claim("BOOT", "the pixel session completed", false, { error: String(err?.message || err) });
}

if (wanted("TIERS")) {
  const tiers = [];
  for (const t of ["potato", "low", "medium", "high", "ultra"]) {
    try {
      tiers.push(await tierSession(t));
    } catch (err) {
      tiers.push({ tier: t, error: String(err?.message || err) });
    }
  }
  const allBoot = tiers.every((t) => t.ready && (t.errors ?? []).length === 0);
  const octaves = tiers.map((t) => t.knobs?.lowOct ?? -1);
  const monotone = octaves.every((v, i) => i === 0 || v >= octaves[i - 1]);
  const potato = tiers.find((t) => t.tier === "potato");
  claim("TIERS", "scales down cleanly: every tier boots and the sky gets cheaper as it drops",
    allBoot && monotone && potato?.decks === 1 && potato?.hazeFlat === true,
    { lowDeckOctavesByTier: octaves, tiers });
}

if (wanted("BUDGET")) {
  try {
    const b = await budgetSession();
    const ok =
      b.stats.drawCalls <= T.drawCalls &&
      b.stats.triangles <= T.triangles &&
      b.stats.programs <= T.programs &&
      b.sky?.drawCalls === 1 &&
      b.sky?.triangles === 1;
    claim("BUDGET", "1080p tier=high stays inside the budget; the sky itself is 1 draw / 1 triangle",
      ok,
      {
        drawCalls: b.stats.drawCalls,
        drawCallBudget: T.drawCalls,
        triangles: b.stats.triangles,
        triangleBudget: T.triangles,
        programs: b.stats.programs,
        programBudget: T.programs,
        skyDrawCalls: b.sky?.drawCalls,
        skyTriangles: b.sky?.triangles,
        hazeSpace: b.atmo?.space,
        hazeBakes: b.atmo?.bakes,
      });
  } catch (err) {
    claim("BUDGET", "1080p tier=high stays inside the budget", false, {
      error: String(err?.message || err),
    });
  }
}

// =============================================================================================
// Report
// =============================================================================================

const passed = results.filter((r) => r.pass).length;
const table = results.map((r) => ({
  claim: r.id,
  verdict: r.pass ? "PASS" : "FAIL",
  what: r.claim,
  ...Object.fromEntries(Object.entries(r).filter(([k]) => !["id", "pass", "claim"].includes(k))),
}));

console.log(
  JSON.stringify(
    {
      piece: "P10",
      what: "sky, hard-edged cloud slabs, dithered banded gradient, distance haze",
      viewport: `${W}x${H}`,
      framing: framingInfo?.framing ?? null,
      captures: KEEP ? OUT : `${OUT} (deleted; pass --keep to retain)`,
      passed,
      total: results.length,
      verdict: passed === results.length ? "ALL PASS" : "FAIL",
      claims: table,
    },
    null,
    2
  )
);

if (!KEEP) fs.rmSync(OUT, { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
