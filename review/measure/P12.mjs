#!/usr/bin/env node
/**
 * P12 — post-processing stack. The proof.
 *
 *   node review/measure/P12.mjs                 # every claim, PASS/FAIL, exit 1 on any failure
 *   node review/measure/P12.mjs --only=A,B      # one or more claim groups
 *   node review/measure/P12.mjs --width=1280 --height=720
 *   node review/measure/P12.mjs --json          # machine-readable only
 *
 * This script exists because the piece's whole risk is invisible in a summary. A post chain that
 * looks fine in a still is the single fastest way to lose `reference/target-lowpoly.png`: flat
 * shading lives on hard silhouettes and one-value facets, and bloom, a filmic shoulder, a soft
 * vignette or a lost MSAA resolve each destroy that quietly. So every claim below is either a
 * **delta between two real captures of the same frame** or a **synthetic plate pushed through the
 * shipped shaders on the GPU** — never an assertion about source code.
 *
 * Groups:
 *   A  the stack does not soften the picture           (real captures, post on vs off vs bare)
 *   B  the shaders do what they say                    (synthetic plates through the real chain)
 *   C  the tier ladder, including "free on potato"     (probes at every tier)
 *   D  4K correctness                                  (probe at 3840x2160)
 *
 * Every threshold is stated in the CLAIMS table with the line of `design/art-direction.md` it comes
 * from. Nothing here is graded on a curve: a claim either has a number or it is not a claim.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";
import { readPNG, lumPlane } from "../p02-png.mjs";

const WIDTH = Number(arg("width", "1920"));
const HEIGHT = Number(arg("height", "1080"));
const ONLY = (arg("only", "A,B,C,D") || "").split(",").map((s) => s.trim().toUpperCase());
const JSON_ONLY = has("json");
const OUT = path.join(ROOT, "review", "measure", "out", "P12");
fs.mkdirSync(OUT, { recursive: true });

// The framing every capture claim is made on. Deterministic: `advance()` is fixed-step, so the
// same script reaches the same simulation state in every session.
const SCRIPT = { look: [200, -60], settle: 1.0 };

/* --------------------------------------------------------------------------------- claims table */

const CLAIMS = [
  ["A0", "every capture this script measures is reviewable", "zero fatal errors, zero runtime errors, zero console errors in all three sessions"],
  ["A1", "composer with every effect off == no composer at all", "mean |Δcode| ≤ 1.5 and p99 |Δcode| ≤ 6 over the whole frame"],
  ["A2", "the shipped stack does not widen a hard edge", "median 10–90 edge width, full stack minus no composer, ≤ +0.25 px; and ≤ 3.0 px at 1920 (§13 row 2)"],
  ["A3", "bloom does not haze the frame", "mean ΔY over pixels ≥ 6% of frame height from any bright source ≤ 0.002 (§5.4, §12.10)"],
  ["A4", "bloom is not a no-op", "mean ΔY within 2% of frame height of a bright source ≥ 0.003"],
  ["A5", "post does not move the exposure", "|Δ frame Y p50| ≤ 0.01 (§7.4 budgets p50 at 0.18–0.32)"],
  ["A6", "post adds no per-frame noise", "two renders of the same simulation state, full stack on, differ by 0 codes (§11.6 budgets 0.2% of pixels moving > 0.05 Y; post's share must be none of it)"],
  ["B1", "bloom never touches a surface", "uniform scene-linear 0.95 plate, bloom on vs off: max |Δcode| ≤ 1"],
  ["B2", "bloom around an emitter is local", "mean ΔY beyond 15% of plate height from the emitter ≤ 0.003, and ≥ 0.02 next to it"],
  ["B3", "the grade is the identity", "256-step ramp through the real shader vs the CPU mirror of renderer.toneMapping: max |Δcode| ≤ 1.5"],
  ["B4", "the halo is the same size at every resolution", "half-intensity radius as a fraction of frame height agrees within 20% across 288 / 576 / 1152 rows, and ≤ 4% (§5.4)"],
  ["B5", "the dither works, and it is needed", "shallow ramp: longest constant-code run ≤ 6 rows with dither (§13 row 8) and > 6 without it"],
  ["B6", "the Bayer tile is a strict permutation", "64 distinct levels, each exactly once per 8x8 tile, no time term"],
  ["C1", "potato and low cost nothing", "kernel.composer null, 0 render targets, 0 post draw calls, 0 bytes"],
  ["C2", "medium builds bloom and vignette and nothing else", "effects == {bloom, vignette}"],
  ["C3", "high builds the whole chain", "effects == {bloom, sunGlow, grain, vignette}, post draw calls ≤ 16"],
  ["C4", "chromatic aberration is declined with a reason", "ultra reports ca in declined[] and does not build it"],
  ["D1", "the chain is correct at 3840x2160", "targets match the drawing buffer, bloom levels grow, halo fraction within 20% of 1080p"],
];

/* --------------------------------------------------------------------------------- image helpers */

function shoot(d, file, timeout = 180000) {
  return d.page.screenshot({ path: path.join(OUT, file), timeout });
}

/**
 * Retry a whole browser session.
 *
 * Not defensive padding: this project's harness drives Chromium on a software rasteriser, and a
 * 1080p frame there costs seconds. Under load the renderer process is occasionally killed
 * mid-`evaluate` ("Execution context was destroyed"), which is an artefact of the measuring
 * apparatus and not a fact about the game. A claim is allowed to be retried; it is not allowed to
 * be softened, so nothing below this line touches a threshold.
 */
async function withRetry(label, fn, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!JSON_ONLY) console.error(`  … ${label} attempt ${i}/${attempts} failed: ${String(err.message).split("\n")[0]}`);
    }
  }
  throw last;
}

const load = (file) => {
  const img = readPNG(path.join(OUT, file));
  return { img, L: lumPlane(img) };
};

/** Mean and p99 of |code difference| across every channel of two same-size PNGs. */
function codeDelta(a, b) {
  const { data: da, bpp: pa, width: W, height: H } = a;
  const { data: db, bpp: pb } = b;
  let sum = 0;
  let n = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) {
      const dv = Math.abs(da[i * pa + c] - db[i * pb + c]);
      sum += dv;
      hist[dv]++;
      n++;
    }
  }
  let acc = 0;
  let p99 = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.99) {
      p99 = v;
      break;
    }
  }
  return { mean: sum / n, p99, max: hist.findLastIndex((c) => c > 0) };
}

/**
 * Median 10–90 transition width of hard luminance steps, in pixels, measured on horizontal scans
 * across the lower 55% of frame — where §7.3 puts the near and mid bands and §13 row 2 does its
 * measurement. A step qualifies at ≥ 0.08 of luminance across ≤ 12 px.
 */
function edgeWidths(L, W, H) {
  const widths = [];
  const y0 = Math.floor(H * 0.42);
  const y1 = Math.floor(H * 0.97);
  for (let y = y0; y < y1; y += 2) {
    const row = y * W;
    for (let x = 8; x < W - 9; x++) {
      const g = Math.abs(L[row + x + 1] - L[row + x - 1]);
      if (g < 0.03) continue;
      // local extrema of the plateau either side, within a 12 px window
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = -6; k <= 6; k++) {
        const v = L[row + x + k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const step = hi - lo;
      if (step < 0.08) continue;
      // only accept a genuine monotone step: the two ends must sit at the two plateaus
      const left = L[row + x - 6];
      const right = L[row + x + 6];
      if (Math.abs(left - right) < step * 0.8) continue;
      const a = lo + step * 0.1;
      const b = hi - step * 0.1;
      let n = 0;
      for (let k = -6; k <= 6; k++) {
        const v = L[row + x + k];
        if (v > a && v < b) n++;
      }
      widths.push(n + 1);
      x += 6; // one measurement per edge
    }
  }
  widths.sort((p, q) => p - q);
  return {
    count: widths.length,
    median: widths.length ? widths[Math.floor(widths.length / 2)] : NaN,
    p90: widths.length ? widths[Math.floor(widths.length * 0.9)] : NaN,
  };
}

/**
 * Split the frame into "near a bright source" and "far from every bright source", using an 8x8
 * block grid dilated by a radius in blocks. Bright is the top 0.5% of the *reference* frame, which
 * is the population §5.4 lets bloom, and §7.4 measures at 0.69% of frame above Y 0.90.
 */
function proximityMasks(L, W, H) {
  const s = Float64Array.from(L).sort();
  const bright = Math.max(0.55, s[Math.floor(s.length * 0.995)]);
  const BS = 8;
  const bw = Math.ceil(W / BS);
  const bh = Math.ceil(H / BS);
  const blocks = new Uint8Array(bw * bh);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (L[y * W + x] >= bright) blocks[Math.floor(y / BS) * bw + Math.floor(x / BS)] = 1;
    }
  }
  const dilate = (src, r) => {
    const out = new Uint8Array(src.length);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        if (!src[by * bw + bx]) continue;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const ny = by + dy;
            const nx = bx + dx;
            if (ny >= 0 && ny < bh && nx >= 0 && nx < bw) out[ny * bw + nx] = 1;
          }
        }
      }
    }
    return out;
  };
  const nearR = Math.max(1, Math.round(H * 0.02 / BS));
  const farR = Math.max(2, Math.round(H * 0.06 / BS));
  const near = dilate(blocks, nearR);
  const excl = dilate(blocks, farR);
  return { bright, bw, bh, BS, near, excl, blocks };
}

function regionMeanDelta(La, Lb, W, H, masks, which) {
  const { bw, BS, near, excl } = masks;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y++) {
    const by = Math.floor(y / BS) * bw;
    for (let x = 0; x < W; x++) {
      const b = by + Math.floor(x / BS);
      const inside = which === "near" ? near[b] : !excl[b];
      if (!inside) continue;
      sum += La[y * W + x] - Lb[y * W + x];
      n++;
    }
  }
  return { mean: n ? sum / n : NaN, pixels: n, share: n / (W * H) };
}

function churn(La, Lb, W, H, t = 0.05) {
  let n = 0;
  for (let i = 0; i < W * H; i++) if (Math.abs(La[i] - Lb[i]) > t) n++;
  return n / (W * H);
}

function pct(L, q) {
  const s = Float64Array.from(L).sort();
  return s[Math.floor(q * (s.length - 1))];
}

/* --------------------------------------------------------------- in-page synthetic plate suite */

/**
 * Runs inside the browser, against the shipped `PostStack.processLinearRGB()`, which pushes a
 * caller-supplied scene-linear image through the real bright pass, the real bloom chain and the
 * real grade shader and hands back the 8-bit sRGB codes. Everything returned is a small number.
 */
function platesInPage() {
  const stack = window.__vs.kernel.get("post");
  if (!stack?.installed) return { error: "no composer installed" };
  const lum = (r, g, b) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const plate = (w, h, fill) => {
    const data = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = fill(x, y);
        const i = (y * w + x) * 3;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
    }
    return { width: w, height: h, data };
  };

  const out = {};

  // ---- B1: a uniform surface at the brightest luminance the art direction allows a surface to
  //          reach (§6.1 measures the hottest sky pixel at Y 0.8926) must produce no bloom at all.
  {
    const W = 192;
    const H = 192;
    const p = plate(W, H, () => [0.95, 0.95, 0.95]);
    const on = stack.processLinearRGB(p, { bloom: true });
    const off = stack.processLinearRGB(p, { bloom: false });
    let max = 0;
    for (let i = 0; i < W * H * 4; i++) {
      if (i % 4 === 3) continue;
      max = Math.max(max, Math.abs(on.data[i] - off.data[i]));
    }
    out.B1 = { plateValue: 0.95, maxCodeDelta: max };
  }

  // ---- B2: an emitter on the same surface. Bloom must be visible beside it and absent away from it.
  {
    const W = 256;
    const H = 256;
    const cx = 128;
    const cy = 128;
    const p = plate(W, H, (x, y) => {
      const inEmitter = Math.abs(x - cx) < 4 && Math.abs(y - cy) < 4;
      return inEmitter ? [3.0, 9.0, 7.5] : [0.42, 0.30, 0.16]; // §3.2's lit rock albedo, lit
    });
    const on = stack.processLinearRGB(p, { bloom: true });
    const off = stack.processLinearRGB(p, { bloom: false });
    let nearSum = 0;
    let nearN = 0;
    let farSum = 0;
    let farN = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - cx, y - cy);
        if (r < 6) continue; // the emitter itself
        const i = (y * W + x) * 4;
        const d =
          lum(on.data[i], on.data[i + 1], on.data[i + 2]) -
          lum(off.data[i], off.data[i + 1], off.data[i + 2]);
        if (r < H * 0.045) {
          nearSum += d;
          nearN++;
        } else if (r > H * 0.15) {
          farSum += d;
          farN++;
        }
      }
    }
    out.B2 = { near: nearSum / nearN, far: farSum / farN, nearN, farN };
  }

  // ---- B3: the grade against the CPU mirror of whatever `renderer.toneMapping` is set to.
  {
    const N = 256;
    const W = N;
    const H = 8;
    const p = plate(W, H, (x, y) => {
      const t = x / (N - 1);
      if (y < 2) return [t, t, t];
      if (y < 4) return [t, t * 0.55, t * 0.2]; // warm rock family
      if (y < 6) return [t * 0.5, t, t * 0.9]; // cyan accent family
      return [t * 1.6, t * 1.6, t * 1.6]; // over-range, to exercise the clip
    });
    const got = stack.processLinearRGB(p, { bloom: false });
    const mode = stack.displayMode;
    const exposure = window.__vs.kernel.renderer.toneMappingExposure;
    const cpu = window.__vsP12Cpu; // injected below
    let max = 0;
    let worst = null;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const want = cpu.encode(
          cpu.display(mode, [p.data[i], p.data[i + 1], p.data[i + 2]], { exposure })
        ).map((v) => v * 255);
        const j = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const dv = Math.abs(got.data[j + c] - want[c]);
          if (dv > max) {
            max = dv;
            worst = { x, y, c, got: got.data[j + c], want: Number(want[c].toFixed(2)) };
          }
        }
      }
    }
    out.B3 = { mode, exposure, maxCodeDelta: Number(max.toFixed(3)), worst };
  }

  // ---- B4: halo size as a fraction of frame height, at three resolutions.
  {
    const sizes = [
      [512, 288],
      [1024, 576],
      [2048, 1152],
    ];
    const rows = [];
    for (const [W, H] of sizes) {
      const cx = W >> 1;
      const cy = H >> 1;
      const p = plate(W, H, (x, y) =>
        Math.abs(x - cx) < 2 && Math.abs(y - cy) < 2 ? [40, 40, 40] : [0.02, 0.02, 0.02]
      );
      const on = stack.processLinearRGB(p, { bloom: true });
      const off = stack.processLinearRGB(p, { bloom: false });
      const levels = on.bloomLevels;
      const prof = [];
      for (let r = 4; r < H / 2 - 1; r++) {
        let s = 0;
        let n = 0;
        for (const [dx, dy] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
        ]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4;
          s +=
            lum(on.data[i], on.data[i + 1], on.data[i + 2]) -
            lum(off.data[i], off.data[i + 1], off.data[i + 2]);
          n++;
        }
        prof.push([r, n ? s / n : 0]);
      }
      const peak = prof[0][1];
      let half = null;
      for (const [r, v] of prof) {
        if (v <= peak * 0.5) {
          half = r;
          break;
        }
      }
      rows.push({
        size: [W, H],
        levels,
        peakDeltaY: Number(peak.toFixed(5)),
        halfRadiusPx: half,
        halfRadiusFraction: half === null ? null : Number((half / H).toFixed(4)),
      });
    }
    out.B4 = rows;
  }

  // ---- B5: the dither, and a control with it switched off.
  {
    const W = 64;
    const H = 512;
    const p = plate(W, H, (x, y) => {
      const t = 0.20 + (y / (H - 1)) * 0.045; // a shallow sky-like ramp, ~11 codes over 512 rows
      return [t, t, t];
    });
    const measure = (img) => {
      const seen = new Set();
      let run = 1;
      let best = 1;
      let prev = null;
      const x = 31;
      for (let y = 0; y < H; y++) {
        const i = (y * W + x) * 4;
        const k = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
        seen.add(k);
        if (k === prev) best = Math.max(best, ++run);
        else run = 1;
        prev = k;
      }
      return { distinct: seen.size, longestRun: best };
    };
    const withDither = measure(stack.processLinearRGB(p, { bloom: false }));
    stack.setLook({ ditherAmount: 0 });
    const without = measure(stack.processLinearRGB(p, { bloom: false }));
    stack.setLook({ ditherAmount: 0.5 });
    out.B5 = { withDither, without };
  }

  // ---- B6: the Bayer tile, evaluated by the same arithmetic the shader uses.
  {
    const b2 = (px, py) => {
      const x = Math.floor(px);
      const y = Math.floor(py);
      const v = x * 0.5 + y * y * 0.75;
      return v - Math.floor(v);
    };
    const b4 = (x, y) => b2(x * 0.5, y * 0.5) * 0.25 + b2(x, y);
    const b8 = (x, y) => b4(x * 0.5, y * 0.5) * 0.25 + b2(x, y);
    const vals = new Set();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.add(Math.round(b8(x, y) * 64));
    // and it must tile: the same screen pixel gets the same offset on every frame, forever
    let tiles = true;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (Math.abs(b8(x, y) - b8(x + 8, y + 8)) > 1e-6) tiles = false;
      }
    }
    out.B6 = { distinctLevels: vals.size, tiles };
  }

  return out;
}

/* --------------------------------------------------------------------------------- the sessions */

const results = {};
const claims = new Map();
const record = (id, pass, detail) => claims.set(id, { pass, detail });

/**
 * All five variants come out of **one** browser session, at one simulation state.
 *
 * The first draft of this script booted three times and compared the results. That is wrong twice
 * over. It assumes the build does not change between boots — this repository has a dozen agents
 * writing to it, and it demonstrably does — and it assumes three independent `advance()` sequences
 * land on the same world state, which is a claim about somebody else's determinism, not about post.
 *
 * `kernel.advance(0)` runs zero fixed steps and renders once, so the same simulation state can be
 * re-rendered with the chain reconfigured between draws. Every A-group number below is therefore a
 * difference between two images of **the same frame of the same world**, and nothing except the
 * post chain changed between them.
 */
async function sessionCaptures() {
  const session = await withRetry("captures", () =>
    openGame({ width: WIDTH, height: HEIGHT }, async (d) => {
      await d.play(SCRIPT.settle);
      await d.look(SCRIPT.look[0], SCRIPT.look[1]);
      await d.play(0.25);

      const set = (js) => d.run(js);
      const EFFECTS = ["bloom", "sunGlow", "grain", "vignette"];

      // state S, full stack
      await set(() => window.__vs.advance(0));
      await shoot(d, "full-a.png");
      // state S again, nothing changed at all — the purity control
      await set(() => window.__vs.advance(0));
      await shoot(d, "full-a2.png");

      // state S, composer installed with every effect off
      await set(
        () => {
          const s = window.__vs.kernel.get("post");
          for (const e of ["bloom", "sunGlow", "grain", "vignette"]) s.setEffect(e, false);
          window.__vs.advance(0);
        }
      );
      await shoot(d, "bare-a.png");

      // state S, no composer at all
      await set(() => {
        window.__vs.kernel.get("post").setEnabled(false);
        window.__vs.advance(0);
      });
      await shoot(d, "off-a.png");

      // one fixed step forward, both ways, for the world-motion control
      await set(() => {
        window.__vs.advance(1 / 60);
      });
      await shoot(d, "off-b.png");
      await set(() => {
        const s = window.__vs.kernel.get("post");
        s.setEnabled(true);
        for (const e of ["bloom", "sunGlow", "grain", "vignette"]) s.setEffect(e, true);
        window.__vs.advance(0);
      });
      await shoot(d, "full-b.png");

      const report = await d.report();
      const plates = await d.run(
        ({ src, fn }) => {
          const s = window.__vs.kernel.get("post");
          // The plate suite measures the bright pass, the grade and the dither. Vignette and grain
          // are deliberate deviations from the identity and are measured by the A group instead, so
          // they come off here and go straight back on.
          s.setEffect("vignette", false);
          s.setEffect("grain", false);
          // The CPU mirror travels as source, so the browser-side comparison cannot drift from
          // app/src/render/passes/glsl.js.
          // eslint-disable-next-line no-new-func
          window.__vsP12Cpu = new Function(
            `${src}; return { display: displayTransformCPU, encode: encodeSRGBCPU };`
          )();
          // eslint-disable-next-line no-new-func
          const out = new Function(`return (${fn})()`)();
          s.setEffect("vignette", true);
          s.setEffect("grain", true);
          return out;
        },
        { src: CPU_SRC, fn: platesInPage.toString() }
      );

      return { report, probe: report.probes?.post ?? null, problems: verdict(report, d), plates };
    })
  );

  results.capture = {
    problems: session.problems,
    probe: session.probe,
    stats: session.report.stats,
    viewport: [WIDTH, HEIGHT],
  };
  record("A0", session.problems.length === 0, session.problems.length ? session.problems.slice(0, 4).join(" | ") : "clean");

  const A = load("full-a.png");
  const Apure = load("full-a2.png");
  const A2 = load("full-b.png");
  const B = load("off-a.png");
  const B2 = load("off-b.png");
  const C = load("bare-a.png");
  const W = A.img.width;
  const H = A.img.height;

  // A1 — transparency
  const t = codeDelta(C.img, B.img);
  results.A1 = { meanCodeDelta: Number(t.mean.toFixed(4)), p99: t.p99, max: t.max };
  record("A1", t.mean <= 1.5 && t.p99 <= 6, JSON.stringify(results.A1));

  // A2 — edges
  const eOn = edgeWidths(A.L, W, H);
  const eOff = edgeWidths(B.L, W, H);
  results.A2 = { fullStack: eOn, noComposer: eOff, delta: Number((eOn.median - eOff.median).toFixed(3)) };
  const at1920 = (v) => (v * 1920) / W;
  record(
    "A2",
    eOn.count > 200 && eOn.median - eOff.median <= 0.25 && at1920(eOn.median) <= 3.0,
    `median ${eOn.median} px (off ${eOff.median}), Δ ${results.A2.delta}, ${eOn.count} edges`
  );

  // A3 / A4 — bloom locality, measured against the bare composer so vignette, grain and the encode
  // are common-mode and only the effects remain.
  const masks = proximityMasks(B.L, W, H);
  const far = regionMeanDelta(A.L, C.L, W, H, masks, "far");
  const near = regionMeanDelta(A.L, C.L, W, H, masks, "near");
  results.A3 = { brightThreshold: Number(masks.bright.toFixed(4)), far, near };
  record("A3", Math.abs(far.mean) <= 0.002, `mean ΔY far = ${far.mean.toFixed(5)} over ${(far.share * 100).toFixed(1)}% of frame`);
  record("A4", near.mean >= 0.003, `mean ΔY near = ${near.mean.toFixed(5)} over ${(near.share * 100).toFixed(1)}% of frame`);

  // A5 — exposure
  const p50On = pct(A.L, 0.5);
  const p50Off = pct(B.L, 0.5);
  results.A5 = { p50PostOn: Number(p50On.toFixed(4)), p50PostOff: Number(p50Off.toFixed(4)) };
  record("A5", Math.abs(p50On - p50Off) <= 0.01, `p50 ${p50On.toFixed(4)} vs ${p50Off.toFixed(4)}`);

  // A6 — post is temporally pure. Two renders of the SAME simulation state, full stack on: the
  // dither tile, the grain hash and the vignette are all pure functions of gl_FragCoord, so the two
  // frames have to be identical to the byte. Anything else is a per-frame noise source, which §11.6
  // budgets to zero from post. The world-motion churn across one real fixed step is reported beside
  // it as context, not as a gate — that number belongs to whoever owns what is moving.
  const pure = codeDelta(A.img, Apure.img);
  const cOn = churn(A.L, A2.L, W, H);
  const cOff = churn(B.L, B2.L, W, H);
  results.A6 = {
    identicalStateMaxCodeDelta: pure.max,
    identicalStateMeanCodeDelta: Number(pure.mean.toFixed(5)),
    worldChurnPostOnPct: Number((cOn * 100).toFixed(4)),
    worldChurnPostOffPct: Number((cOff * 100).toFixed(4)),
  };
  record(
    "A6",
    pure.max === 0,
    `re-render of the same state differs by max ${pure.max} code (mean ${pure.mean.toFixed(5)}); world churn over one fixed step ${(cOn * 100).toFixed(2)}% on / ${(cOff * 100).toFixed(2)}% off`
  );

  // B — the plates
  const p = session.plates ?? {};
  results.plates = p;
  if (p.error) {
    for (const id of ["B1", "B2", "B3", "B4", "B5", "B6"]) record(id, false, p.error);
    return;
  }
  record("B1", p.B1.maxCodeDelta <= 1, `max |Δcode| = ${p.B1.maxCodeDelta} on a uniform 0.95 plate`);
  record(
    "B2",
    p.B2.far <= 0.003 && p.B2.near >= 0.02,
    `near ΔY ${p.B2.near.toFixed(4)}, far ΔY ${p.B2.far.toFixed(5)}`
  );
  record("B3", p.B3.maxCodeDelta <= 1.5, `max |Δcode| ${p.B3.maxCodeDelta} vs the CPU mirror (mode ${p.B3.mode})`);
  const fr = p.B4.map((r) => r.halfRadiusFraction).filter((v) => v !== null);
  const spread = fr.length === p.B4.length ? (Math.max(...fr) - Math.min(...fr)) / Math.max(...fr) : 1;
  record(
    "B4",
    fr.length === p.B4.length && spread <= 0.2 && Math.max(...fr) <= 0.04,
    `fractions ${fr.join(", ")} — spread ${(spread * 100).toFixed(1)}%`
  );
  record(
    "B5",
    p.B5.withDither.longestRun <= 6 && p.B5.without.longestRun > 6,
    `with dither: ${p.B5.withDither.longestRun} rows / ${p.B5.withDither.distinct} codes; without: ${p.B5.without.longestRun} rows / ${p.B5.without.distinct} codes`
  );
  record("B6", p.B6.distinctLevels === 64 && p.B6.tiles, `${p.B6.distinctLevels} levels, tiles=${p.B6.tiles}`);
}

async function sessionTiers() {
  const rows = {};
  for (const tier of ["potato", "low", "medium", "high", "ultra"]) {
    // 640x360 on purpose: the tier ladder is a question about what gets *built*, not about how it
    // looks, and this machine's software rasteriser is shared with whatever else is running.
    await openGame({ width: 640, height: 360, tier }, async (d) => {
      await d.play(0.5);
      let composerNull = null;
      try {
        composerNull = await d.run(() => window.__vs.kernel.composer === null);
      } catch {
        composerNull = "unreadable";
      }
      const rep = await d.report();
      rows[tier] = {
        probe: rep.probes?.post ?? null,
        composerNull,
        problems: verdict(rep, d),
      };
    });
  }
  results.tiers = rows;

  const free = ["potato", "low"].every((t) => {
    const r = rows[t];
    return r?.probe?.installed === false && r.composerNull && r.probe.targets === 0 && r.probe.postDrawCalls === 0 && r.probe.targetBytes === 0;
  });
  record(
    "C1",
    free,
    ["potato", "low"]
      .map((t) => `${t}: installed=${rows[t]?.probe?.installed} composerNull=${rows[t]?.composerNull} targets=${rows[t]?.probe?.targets} draws=${rows[t]?.probe?.postDrawCalls}`)
      .join(" | ")
  );

  const m = rows.medium?.probe?.effects ?? {};
  record(
    "C2",
    m.bloom === true && m.vignette === true && m.grain === false && m.sunGlow === false,
    JSON.stringify(m)
  );

  const h = rows.high?.probe ?? {};
  record(
    "C3",
    h.effects?.bloom && h.effects?.sunGlow && h.effects?.grain && h.effects?.vignette && h.postDrawCalls <= 16,
    `${JSON.stringify(h.effects)} draws=${h.postDrawCalls}`
  );

  const u = rows.ultra?.probe ?? {};
  record(
    "C4",
    Array.isArray(u.declined) && u.declined.some((x) => x.id === "ca"),
    JSON.stringify(u.declined)
  );
}

async function session4K() {
  await openGame({ width: 3840, height: 2160, tier: "high" }, async (d) => {
    await d.play(0.6);
    const rep = await d.report();
    const p = rep.probes?.post ?? {};
    const plates = await d.run(() => {
      const stack = window.__vs.kernel.get("post");
      return { size: stack.size.toArray(), levels: stack.bloom.levels, mips: stack.bloom.stats().mipSizes };
    });
    results.fourK = { probe: p, ...plates, problems: verdict(rep, d) };
    const ref = results.plates?.B4?.find((r) => r.size[1] === 1152)?.halfRadiusFraction ?? null;
    const ok =
      p.installed === true &&
      p.size?.[0] === 3840 &&
      p.size?.[1] === 2160 &&
      plates.levels > (results.capture?.probe?.bloom?.levels ?? 0) &&
      Math.abs((p.bloom?.radiusFractionOfHeight ?? 0) - (results.capture?.probe?.bloom?.radiusFractionOfHeight ?? 0)) <=
        0.2 * (results.capture?.probe?.bloom?.radiusFractionOfHeight ?? 1);
    record(
      "D1",
      ok,
      `size ${p.size} levels ${plates.levels} (1080p: ${results.capture?.probe?.bloom?.levels}) radiusFraction ${p.bloom?.radiusFractionOfHeight} vs ${results.capture?.probe?.bloom?.radiusFractionOfHeight}${ref === null ? "" : ` (plate ref ${ref})`}`
    );
  });
}

function verdict(report, d) {
  const problems = [];
  if (report.fatal) problems.push(`FATAL: ${String(report.fatal).split("\n")[0]}`);
  if (!report.ready) problems.push("app never reported ready");
  for (const e of report.errors ?? []) problems.push(`runtime error: ${String(e).split("\n")[0]}`);
  for (const e of d.consoleErrors) problems.push(`console error: ${e}`);
  return problems;
}

/* --------------------------------------------------------------------------------- CPU mirror */

// Shipped straight out of the module the shader shares, so the browser-side comparison in B3 can
// never drift from what `app/src/render/passes/glsl.js` actually does.
const CPU_SRC = fs
  .readFileSync(path.join(ROOT, "app", "src", "render", "passes", "glsl.js"), "utf8")
  .replace(/^export\s+/gm, "")
  .replace(/^import[^\n]*\n/gm, "");

/* --------------------------------------------------------------------------------- main */

const t0 = Date.now();
if (ONLY.includes("A") || ONLY.includes("B")) await sessionCaptures();
if (ONLY.includes("C")) await sessionTiers();
if (ONLY.includes("D")) await session4K();

const table = CLAIMS.filter(([id]) => claims.has(id)).map(([id, what, threshold]) => ({
  claim: id,
  what,
  threshold,
  result: claims.get(id).pass ? "PASS" : "FAIL",
  detail: claims.get(id).detail,
}));
const failed = table.filter((r) => r.result === "FAIL");

if (JSON_ONLY) {
  console.log(JSON.stringify({ table, results, seconds: (Date.now() - t0) / 1000 }, null, 2));
} else {
  console.log(JSON.stringify(results, null, 2));
  console.log("\n" + "=".repeat(112));
  console.log("P12 — post-processing stack");
  console.log("=".repeat(112));
  for (const r of table) {
    console.log(`${r.result === "PASS" ? "PASS" : "FAIL"}  ${r.claim}  ${r.what}`);
    console.log(`        want: ${r.threshold}`);
    console.log(`        got : ${r.detail}`);
  }
  console.log("=".repeat(112));
  console.log(
    `${table.length - failed.length}/${table.length} claims pass — ${((Date.now() - t0) / 1000).toFixed(0)}s, images in review/measure/out/P12/`
  );
}

process.exit(failed.length ? 1 : 0);
