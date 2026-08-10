#!/usr/bin/env node
/**
 * P15 — Strict KaTeX pipeline, DOM and in-world. Re-runnable proof.
 *
 *   node review/measure/P15.mjs                       # everything
 *   node review/measure/P15.mjs --offline             # no browser: the pure claims only
 *   node review/measure/P15.mjs --langs=en --sizes=1600x900
 *
 * Every claim is a number against a stated threshold, and the pixel claims are calibrated
 * against `reference/target-lowpoly.png` itself rather than against a threshold this piece
 * invented. The target's own mathematics measures: ink luminance 254.0, background 4 px from
 * the ink 188.8, background 16 px from the ink 184.7 — i.e. the sky right next to a glyph is
 * the same sky as everywhere else, which is what "no panel, no frame, no glow" looks like as
 * a measurement. C10-C13 hold our render to the reference's own numbers, and the reference
 * is measured on every run so the comparison cannot rot.
 *
 * Exit code 0 iff every claim passes.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SHOTS = path.join(ROOT, "review", "shots", "p15", "measure");

const argOf = (name, fallback = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => process.argv.slice(2).includes(`--${name}`);

const LANGS = (argOf("langs", "en,es,pl") || "").split(",").filter(Boolean);
const TIER = argOf("tier", "low");
const SIZES = (argOf("sizes", "1600x900,3840x2160") || "")
  .split(",")
  .filter(Boolean)
  .map((s) => {
    const [w, h] = s.split("x").map(Number);
    return { w, h, label: s };
  });

// Vite serves `app/` as its root, so this is the shipped module's URL on the dev server.
const TEX_PANEL_URL = "/src/math/TexPanel.js";

const claims = [];
const data = {};

function claim(id, what, threshold, value, pass, note) {
  claims.push({ id, claim: what, threshold, value, pass: !!pass, note: note ?? null });
}

// ---------------------------------------------------------------- PNG (read only)

function readPng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const chunkData = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = chunkData.readUInt32BE(0);
      h = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "IDAT") idat.push(chunkData);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${file}: bit depth ${bitDepth} unsupported`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error(`${file}: colour type ${colorType} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

// A minimal PNG writer, so the rasters can be composited onto a ground and actually looked
// at. A white-on-transparent texture opened in a viewer with a white page is a blank square,
// which is exactly how a broken raster gets signed off.
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ])
  );
}

/** Stack the rasters on a dusk-coloured ground, at 1:1, so a reviewer can read them. */
function contactSheet(file, images, ground = [214, 148, 84]) {
  const pad = 16;
  const w = Math.max(...images.map((i) => i.width)) + pad * 2;
  const h = images.reduce((s, i) => s + i.height + pad, pad);
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    out[i * 3] = ground[0];
    out[i * 3 + 1] = ground[1];
    out[i * 3 + 2] = ground[2];
  }
  let y0 = pad;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const si = (y * img.width + x) * img.channels;
        const a = img.channels === 4 ? img.data[si + 3] / 255 : 1;
        const di = ((y0 + y) * w + (pad + x)) * 3;
        for (let c = 0; c < 3; c++) out[di + c] = Math.round(img.data[si + c] * a + out[di + c] * (1 - a));
      }
    }
    y0 += img.height + pad;
  }
  writePng(file, w, h, out);
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Count near-white pixels in a rectangle — the claims are the only pure-white thing in the
 * frame. Deliberately the *same* rule (`min >= 232`, `max - min <= 14`) the critic's probe
 * used to measure 476 visible ink px against 651 real ones, so the before and after numbers
 * for the occlusion finding are the same measurement and not two similar ones.
 */
function inkPixels(img, rect) {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(img.width, Math.ceil(rect.x1));
  const y1 = Math.min(img.height, Math.ceil(rect.y1));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * img.channels;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      if (Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 14) n++;
    }
  }
  return n;
}

/**
 * Measure one rectangle of an image the way the reference was measured:
 * how bright the ink is, how far the sky next to the ink differs from the sky away from it,
 * and how many pixels the ink takes to stop being ink.
 */
function measureRegion(img, rect, { inkMin = 236, alpha = false } = {}) {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(img.width, Math.ceil(rect.x1));
  const y1 = Math.min(img.height, Math.ceil(rect.y1));
  const W = x1 - x0;
  const H = y1 - y0;
  if (W < 4 || H < 4) return null;
  // On a raster the ink lives in the alpha channel — the RGB of a half-covered white pixel is
  // still 255, so a luminance test would call every antialiased pixel solid ink and report a
  // perfectly sharp edge no matter how blurry the texture was.
  const at = alpha
    ? (x, y) => {
        const a = img.data[((y0 + y) * img.width + (x0 + x)) * img.channels + 3];
        return [a, a, a];
      }
    : (x, y) => {
        const i = ((y0 + y) * img.width + (x0 + x)) * img.channels;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };

  const ink = new Uint8Array(W * H);
  let inkCount = 0;
  let inkLum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = at(x, y);
      if (Math.min(r, g, b) >= inkMin) {
        ink[y * W + x] = 1;
        inkCount++;
        inkLum += lum(r, g, b);
      }
    }
  }
  if (inkCount < 40) return { inkCount, empty: true };

  // Chamfer distance from ink.
  const dist = new Int32Array(W * H).fill(9999);
  for (let i = 0; i < W * H; i++) if (ink[i]) dist[i] = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let d = dist[y * W + x];
        if (x > 0) d = Math.min(d, dist[y * W + x - 1] + 1);
        if (y > 0) d = Math.min(d, dist[(y - 1) * W + x] + 1);
        dist[y * W + x] = d;
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        let d = dist[y * W + x];
        if (x < W - 1) d = Math.min(d, dist[y * W + x + 1] + 1);
        if (y < H - 1) d = Math.min(d, dist[(y + 1) * W + x] + 1);
        dist[y * W + x] = d;
      }
  }

  const band = (lo, hi) => {
    let n = 0;
    let sum = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = dist[y * W + x];
        if (d < lo || d > hi) continue;
        const [r, g, b] = at(x, y);
        n++;
        sum += lum(r, g, b);
      }
    return n ? { n, mean: sum / n } : { n: 0, mean: null };
  };

  const inkMean = inkLum / inkCount;
  const near = band(3, 5);
  const far = band(12, 20);
  // A third band, purely as a control. A glow is a local thing: it decays, so it shows up
  // between "next to the ink" and "a little away" and not between "a little away" and
  // "further away still". A background *gradient* — a claim standing against a terrain edge
  // rather than against open sky — shows up in both, equally. Without this band there is no
  // way to tell the two apart from a single number, and the halo claim below inherits a
  // property of whatever the world happens to have put behind the mathematics.
  const veryFar = band(24, 40);
  const bg = far.mean ?? near.mean ?? 0;

  // Perimeter and the partial-coverage band, which together give a scale-free measure of how
  // many pixels an edge takes: 1 is a hard antialiased edge, 3+ is a blurred texture.
  let perimeter = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!ink[y * W + x]) continue;
      const open =
        (x === 0 || !ink[y * W + x - 1]) ||
        (x === W - 1 || !ink[y * W + x + 1]) ||
        (y === 0 || !ink[(y - 1) * W + x]) ||
        (y === H - 1 || !ink[(y + 1) * W + x]);
      if (open) perimeter++;
    }
  const loEdge = bg + 0.25 * (inkMean - bg);
  const hiEdge = bg + 0.75 * (inkMean - bg);
  let partial = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (ink[y * W + x]) continue;
      // Only pixels touching the ink. Wider than that and a cloud edge two pixels away lands
      // inside the partial-coverage band and gets counted as glyph blur — the ink/sky contrast
      // here is under 2:1, so the band is narrow and the sky wanders through it.
      if (dist[y * W + x] > 2) continue;
      const [r, g, b] = at(x, y);
      const L = lum(r, g, b);
      if (L > loEdge && L < hiEdge) partial++;
    }

  // WCAG relative-luminance contrast between ink and the sky it stands on.
  const chan = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  let ir = 0, ig = 0, ib = 0, br = 0, bg2 = 0, bb = 0, bn = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = dist[y * W + x];
      const [r, g, b] = at(x, y);
      if (d === 0) { ir += r; ig += g; ib += b; }
      else if (d >= 12 && d <= 20) { br += r; bg2 += g; bb += b; bn++; }
    }
  const relLum = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  const Li = relLum(ir / inkCount, ig / inkCount, ib / inkCount);
  const Lb = bn ? relLum(br / bn, bg2 / bn, bb / bn) : 0;
  const contrast = (Math.max(Li, Lb) + 0.05) / (Math.min(Li, Lb) + 0.05);

  return {
    box: [x0, y0, x1, y1],
    inkCount,
    inkCoverage: Number((inkCount / (W * H)).toFixed(4)),
    inkLuminance: Number(inkMean.toFixed(1)),
    nearBgLuminance: near.mean === null ? null : Number(near.mean.toFixed(1)),
    farBgLuminance: far.mean === null ? null : Number(far.mean.toFixed(1)),
    veryFarBgLuminance: veryFar.mean === null ? null : Number(veryFar.mean.toFixed(1)),
    haloDelta: near.mean !== null && far.mean !== null ? Number((near.mean - far.mean).toFixed(1)) : null,
    // The same statistic one band further out, where no glow could reach. Non-zero here means
    // the background is sloped and `haloDelta` is measuring the slope, not the mathematics.
    bgGradient: far.mean !== null && veryFar.mean !== null ? Number((far.mean - veryFar.mean).toFixed(1)) : null,
    perimeter,
    edgeWidthPx: perimeter ? Number((partial / perimeter).toFixed(2)) : null,
    contrastRatio: Number(contrast.toFixed(2)),
  };
}

// ---------------------------------------------------------------- A. offline claims

const GOOD = [
  { id: "span-one-add", tex: "x + 3 = 7" },
  { id: "share-half", tex: "\\frac{1}{2}x = 4" },
  { id: "mark-two-step", tex: "2x + 1 \\ge 9" },
  { id: "mark-negative", tex: "-3x \\le -12" },
  { id: "bundle", tex: "4(x + 2) = 20" },
  { id: "decimals", tex: "3.5x = 10.25" },
  { id: "big-number", tex: "16000 + x = 16004" },
  { id: "division", tex: "6 \\div 2 = 3" },
  { id: "product", tex: "5 \\times 4 = 20" },
  { id: "power", tex: "x^{2} + 1 = 10" },
  { id: "root", tex: "\\sqrt{9} = 3" },
  { id: "abs", tex: "\\left|x\\right| = 5" },
  { id: "both-pans", tex: "5x - 2 = 3x + 8" },
  { id: "gather", tex: "3x + 5x = 8x" },
  { id: "signed", tex: "-\\frac{3}{4}x + 2 = -7" },
];

const MALFORMED = [
  "\\frac{1}{",
  "\\notacommand{x}",
  "\\begin{matrix}",
  "x + }",
  "\\href{javascript:alert(1)}{x}",
  "",
  "\\sqrt[",
];

/**
 * Hostile input. Not malformed — every one of these is *legal* TeX that KaTeX typesets
 * without complaint, which is the point: the malformed fixtures above prove the parser
 * refuses nonsense, and these prove the pipeline refuses to allocate, lay out or draw from
 * content. Each attacks a different axis, and each is stopped by a different gate:
 *
 *   long20k     — 20,000 characters. The finding this round exists to close. Gate 1.
 *   deepFrac15  — 15 nested fractions. The measured point at which laying the result out
 *                 *crashes the Chromium renderer*: depth 14 lays out in under 2 ms, depth 15
 *                 kills the tab. This one is the regression test that matters most, because
 *                 without gate 2 the game does not degrade, it dies. Gate 2.
 *   deepFrac60  — the same attack past the point of any doubt. Gate 2.
 *   tallMatrix  — 150 rows, 220 ems tall. Shallow (parse depth 3) and long-but-legal, so it
 *                 gets past gates 1 and 2 and has to be stopped by geometry. Gate 3.
 *   wideLine    — 1,881 characters on one line, ~940 ems wide. Inside the length cap on
 *                 purpose. Gate 3.
 *
 * The last two are the ones that keep the suite honest: they prove the length and depth caps
 * are not quietly carrying the whole argument.
 */
const nestedFrac = (n) => "\\frac{1}{".repeat(n) + "2" + "}".repeat(n);

const HOSTILE = [
  { id: "long20k", tex: "x + x".repeat(4000), attacks: "source length", gate: "1 length" },
  { id: "deepFrac15", tex: nestedFrac(15), attacks: "parse depth — the measured renderer crash", gate: "2 depth" },
  { id: "deepFrac60", tex: nestedFrac(60), attacks: "parse depth", gate: "2 depth" },
  { id: "tallMatrix", tex: `\\begin{matrix}${"1 \\\\ ".repeat(149)}1\\end{matrix}`, attacks: "ink height", gate: "3 ink extent" },
  { id: "wideLine", tex: "1" + " + 1".repeat(470), attacks: "ink width", gate: "3 ink extent" },
];

async function offlineClaims() {
  const Tex = await import(pathToFileURL(path.join(ROOT, "app/src/math/Tex.js")).href);
  const { validate, render, localizeTex, lintTexBank, texStats, texFailures, resetTex, LOCALES } = Tex;

  // C1 — every shipped-shape expression typesets in every locale.
  const lint = lintTexBank(GOOD, { locales: LOCALES });
  claim("C1", "every fixture expression typesets in en/es/pl", "0 failures", lint.failures.length, lint.failures.length === 0,
    lint.failures.slice(0, 3).map((f) => `${f.id}/${f.locale}: ${f.error}`).join(" | ") || null);

  // C2 — malformed input is refused, and the refusal never carries the source.
  let refused = 0;
  let leaked = 0;
  const fallbackSamples = [];
  for (const bad of MALFORMED) {
    for (const locale of LOCALES) {
      const v = validate(bad, { locale });
      if (!v.ok) refused++;
      const r = render(bad, { locale });
      if (r.ok) continue;
      if (bad && r.html.includes(bad)) leaked++;
      if (/\\[a-zA-Z]/.test(r.html.replace(/&[a-z]+;/g, ""))) leaked++;
      if (/\\[a-zA-Z]/.test(r.speech)) leaked++;
      if (r.html.includes("katex-error")) leaked++;
      fallbackSamples.push({ locale, speech: r.speech });
    }
  }
  claim("C2a", "malformed TeX is refused by validate()", `${MALFORMED.length * LOCALES.length} refusals`, refused,
    refused === MALFORMED.length * LOCALES.length);
  claim("C2b", "a refused expression never returns its source, a katex-error node, or raw TeX", "0 leaks", leaked, leaked === 0);

  // C3 — accessible text alternative exists everywhere and is never notation.
  let noSpeech = 0;
  let texInSpeech = 0;
  const speechRows = [];
  for (const g of GOOD) {
    for (const locale of LOCALES) {
      const r = render(g.tex, { locale });
      if (!r.speech || r.speech.length < 2) noSpeech++;
      if (/[\\{}^_]/.test(r.speech)) texInSpeech++;
      if (g.id === "signed" || g.id === "share-half" || g.id === "decimals") {
        speechRows.push({ id: g.id, locale, speech: r.speech });
      }
    }
  }
  claim("C3a", "every expression has a spoken form in every locale", "0 missing", noSpeech, noSpeech === 0);
  claim("C3b", "no spoken form contains TeX notation", "0 with \\ { } ^ _", texInSpeech, texInSpeech === 0);
  data.speechSamples = speechRows;

  // C4 — the mathematics is localized, not only the words.
  const conv = [];
  const push = (id, tex, locale, expect, forbid) => {
    const out = localizeTex(tex, locale);
    conv.push({ id, locale, out, ok: out.includes(expect) && (!forbid || !out.includes(forbid)) });
  };
  push("decimal-en", "3.5", "en", "3.5");
  push("decimal-es", "3.5", "es", "3{,}5", "3.5");
  push("decimal-pl", "3.5", "pl", "3{,}5", "3.5");
  push("times-en", "5 \\times 4", "en", "\\times");
  push("times-es", "5 \\times 4", "es", "\\cdot", "\\times");
  push("times-pl", "5 \\times 4", "pl", "\\cdot", "\\times");
  push("div-pl", "6 \\div 2", "pl", "\\mathbin{:}", "\\div");
  push("group-en", "16000", "en", "16{,}000");
  push("group-es", "16000", "es", "16\\,000");
  push("verbatim-text", "\\text{3.5 spans}", "es", "\\text{3.5 spans}");
  const convBad = conv.filter((c) => !c.ok);
  claim("C4", "ES/PL take a decimal comma, a centre dot and (PL) a colon for division", "0 wrong", convBad.length, convBad.length === 0,
    convBad.map((c) => `${c.id} -> ${c.out}`).join(" | ") || null);
  data.conventions = conv;

  // C5 — the canonical comparison text is locale-neutral, so an answer check cannot depend
  // on which language the player is reading in.
  let drift = 0;
  for (const g of GOOD) {
    const texts = new Set(LOCALES.map((l) => validate(g.tex, { locale: l }).text));
    if (texts.size !== 1) drift++;
  }
  claim("C5", "the plain comparison text is identical in every locale", "0 divergent", drift, drift === 0);

  // C6 — nothing this piece can put in front of a player uses classroom vocabulary.
  // The relation readings are the declared exception and are listed rather than hidden:
  // an accessible name for `\ge` has to say what `\ge` says, or a screen-reader user is
  // locked out of the game. Nothing else on voice.md's list is allowed through.
  const ALLOWED_RELATION_READINGS = [
    "is less than", "is greater than", "is less than or equal to", "is greater than or equal to",
    "menor que", "mayor que", "menor o igual que", "mayor o igual que",
    "mniejsze od", "większe od", "mniejsze lub równe", "większe lub równe",
  ];
  const BANNED = [
    "problem", "question", "exercise", "answer", "solution", "correct", "incorrect", "wrong",
    "try again", "good job", "well done", "lesson", "tutorial", "practice", "homework", "drill",
    "score", "points", "streak", "combo", "hint", "student", "player", "user",
    "math", "mathematics", "equation", "algebra", "inequality", "expression", "variable",
    "substitute", "simplify",
    "ejercicio", "respuesta", "muy bien", "problema", "ecuación", "álgebra", "matemáticas",
    "desigualdad", "expresión", "variable",
    "zadanie", "odpowiedź", "brawo", "równanie", "algebra", "matematyka", "nierówność",
    "zmienna", "wyrażenie",
  ];
  const strings = [];
  for (const g of [...GOOD, { id: "bad", tex: "\\frac{1}{" }]) {
    for (const locale of LOCALES) strings.push(render(g.tex, { locale }).speech);
  }
  const hits = [];
  for (let s of strings) {
    let scrub = s.toLowerCase();
    for (const ok of ALLOWED_RELATION_READINGS) scrub = scrub.split(ok).join(" ");
    for (const b of BANNED) if (new RegExp(`(^|\\W)${b}(\\W|$)`, "i").test(scrub)) hits.push(`${b} in "${s}"`);
  }
  claim("C6", "no banned classroom vocabulary in any player-facing string this piece emits",
    "0 hits (relation readings declared)", hits.length, hits.length === 0, hits.slice(0, 3).join(" | ") || null);
  data.declaredVocabularyExceptions = ALLOWED_RELATION_READINGS;

  // C7 — caching. Rendering the same expression a thousand times must typeset it once.
  resetTex();
  for (let i = 0; i < 1000; i++) render("x + 3 = 7", { locale: "en" });
  const st = texStats();
  claim("C7", "1000 renders of one expression typeset it exactly once", "typesets == 1", st.typesets, st.typesets === 1,
    `hits=${st.hits} misses=${st.misses}`);
  resetTex();

  // ---- H0 — the two gates that live in `validate()` and therefore run in Node, which is what
  // lets a content lint catch a bad expression in CI before anybody plays it. Gates 3 and 4
  // are geometry and need a real layout; they are H1-H8, measured in the shipped game below.
  const { MAX_TEX_LENGTH, MAX_TEX_DEPTH } = Tex;
  const byId = (id) => HOSTILE.find((h) => h.id === id);
  const long = byId("long20k");
  const wide = byId("wideLine");

  let refusedLong = 0;
  const t0 = process.hrtime.bigint();
  for (const locale of LOCALES) if (!validate(long.tex, { locale }).ok) refusedLong++;
  const longMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // The control: a string 10x shorter that the gate lets through, actually typeset. If the
  // long one really is being refused before the parser, it must cost a small fraction of this.
  const t1 = process.hrtime.bigint();
  for (const locale of LOCALES) validate(wide.tex, { locale });
  const wideMs = Number(process.hrtime.bigint() - t1) / 1e6;

  claim("H0a", `a ${long.tex.length}-character claim is refused in every locale`, `${LOCALES.length} refusals`,
    refusedLong, refusedLong === LOCALES.length, `cap is ${MAX_TEX_LENGTH} characters`);
  claim("H0b", "the over-length claim never reaches the parser",
    "cost < 20% of typesetting a 1,881-char claim",
    `${longMs.toFixed(2)} ms vs ${wideMs.toFixed(1)} ms`, longMs < wideMs * 0.2);

  // The refusal must not become the place the attack string lives.
  const longRec = render(long.tex, { locale: "en" });
  const failureLens = texFailures().map((f) => f.tex.length);
  claim("H0c", "a refused over-length claim is not retained anywhere in the pipeline",
    "record and failure log <= 200 chars",
    `record ${longRec.tex.length}, worst failure row ${failureLens.length ? Math.max(...failureLens) : 0}`,
    longRec.tex.length <= 200 && (failureLens.length === 0 || Math.max(...failureLens) <= 200));
  claim("H0d", "the refusal shows the stand-in and says so, without notation",
    "ok:false, speech has no \\ { }", `ok=${longRec.ok} speech="${longRec.speech}"`,
    longRec.ok === false && !!longRec.speech && !/[\\{}^_]/.test(longRec.speech));

  // ---- the depth gate. Its whole justification is that the browser cannot survive laying
  // out the input, so the refusal must happen before any HTML exists. Both nesting depths
  // that crash Blink are refused, in every locale, and neither produces markup.
  const deepRows = ["deepFrac15", "deepFrac60"].map((id) => {
    const h = byId(id);
    const perLocale = LOCALES.map((locale) => validate(h.tex, { locale }));
    const rendered = LOCALES.map((locale) => render(h.tex, { locale }));
    return {
      id,
      depth: perLocale[0].depth,
      refused: perLocale.filter((v) => !v.ok).length,
      errors: [...new Set(perLocale.map((v) => v.error))],
      // The tell that no fraction markup was ever built. `.mfrac` is what a nested fraction
      // emits; the refused record carries only the hollow stand-in, which is two orders of
      // magnitude smaller than the 13 KB the real thing produces.
      fracMarkup: rendered.filter((r) => /mfrac/.test(r.html)).length,
      htmlBytes: Math.max(...rendered.map((r) => r.html.length)),
    };
  });
  claim("H0e", "the nesting that crashes the renderer is refused before any HTML is built",
    `refused in all ${LOCALES.length} locales, 0 fraction markup, < 2 KB of HTML`,
    deepRows.map((r) => `${r.id} depth ${r.depth}: ${r.refused}/${LOCALES.length} refused, ${r.fracMarkup} frac markup, ${r.htmlBytes} B`).join(" | "),
    deepRows.every((r) => r.refused === LOCALES.length && r.fracMarkup === 0 && r.htmlBytes < 2000),
    `cap is depth ${MAX_TEX_DEPTH}; Blink crashes laying out depth 30`);

  // ...and the cap must not be eating real mathematics. These are more elaborate than
  // anything Algebra I asks for and all of them must still typeset.
  const REAL_DEEP = ["\\frac{\\frac{1}{2}}{\\frac{3}{4}}", "\\sqrt{\\frac{x^{2}+1}{2}}", "\\frac{-3}{4}x + 2 = -7", "\\left|\\frac{x}{2}\\right| = 5"];
  const realRows = REAL_DEEP.map((tex) => ({ tex, ...validate(tex, { locale: "en" }) }));
  claim("H0f", "the depth cap does not reach real mathematics",
    `all typeset, worst depth well under ${MAX_TEX_DEPTH}`,
    realRows.map((r) => `${r.depth}`).join("/") + ` of ${MAX_TEX_DEPTH}`,
    realRows.every((r) => r.ok) && Math.max(...realRows.map((r) => r.depth)) <= MAX_TEX_DEPTH / 2,
    realRows.filter((r) => !r.ok).map((r) => `${r.tex}: ${r.error}`).join(" | ") || null);

  // The whole shipped bank, through every offline gate, in every locale. If a cap added this
  // round were too tight for the content the game actually serves, this is where it shows.
  const bankDir = path.join(ROOT, "content", "items", "bank");
  const bank = [];
  for (const f of fs.readdirSync(bankDir).filter((f) => f.endsWith(".json"))) {
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(bankDir, f), "utf8")), (k, v) => {
      if (k === "tex" && typeof v === "string") bank.push({ id: `${f}:${bank.length}`, tex: v });
      return v;
    });
  }
  const tBank = process.hrtime.bigint();
  const bankLint = lintTexBank(bank, { locales: LOCALES });
  const bankMs = Number(process.hrtime.bigint() - tBank) / 1e6;
  const bankShape = bank.map((b) => validate(b.tex, { locale: "en" }));
  const bankDepth = Math.max(0, ...bankShape.map((v) => v.depth ?? 0));
  const bankChars = Math.max(0, ...bank.map((b) => b.tex.length));
  claim("H0g", "every expression in the shipped bank passes every offline gate, in every locale",
    "0 failures", `${bankLint.failures.length} of ${bankLint.checked} checks (${bank.length} expressions, ${bankMs.toFixed(0)} ms)`,
    bank.length > 100 && bankLint.failures.length === 0,
    bankLint.failures.slice(0, 3).map((f) => `${f.id}/${f.locale}: ${f.error}`).join(" | ") || null);
  claim("H0h", "the caps have real headroom over the content the game actually serves",
    ">= 5x on both length and depth",
    `length ${bankChars}/${MAX_TEX_LENGTH}, depth ${bankDepth}/${MAX_TEX_DEPTH}`,
    bankChars > 0 && MAX_TEX_LENGTH / bankChars >= 5 && MAX_TEX_DEPTH / Math.max(1, bankDepth) >= 5);

  // And the two geometry attacks must NOT be caught here — otherwise the length and depth
  // caps would be carrying the whole argument and the browser claims below would prove nothing.
  const geometryIds = ["tallMatrix", "wideLine"];
  const geometryRows = geometryIds.map((id) => ({ id, ...validate(byId(id).tex, { locale: "en" }) }));
  claim("H0i", "the geometry attacks get past every offline gate, so the browser has to stop them",
    `${geometryIds.length} of ${geometryIds.length} typeset offline`,
    geometryRows.map((r) => `${r.id} depth ${r.depth} nodes ${r.nodes} ok=${r.ok}`).join(" | "),
    geometryRows.every((r) => r.ok));

  data.hostileOffline = {
    caps: { MAX_TEX_LENGTH, MAX_TEX_DEPTH },
    longChars: long.tex.length,
    longRefuseMs: Number(longMs.toFixed(3)),
    wideTypesetMs: Number(wideMs.toFixed(1)),
    deep: deepRows,
    realDeep: realRows.map((r) => ({ tex: r.tex, ok: r.ok, depth: r.depth })),
    bank: { expressions: bank.length, checks: bankLint.checked, failures: bankLint.failures.length, maxChars: bankChars, maxDepth: bankDepth, ms: Number(bankMs.toFixed(0)) },
    attacks: HOSTILE.map((h) => ({ id: h.id, chars: h.tex.length, attacks: h.attacks, gate: h.gate })),
  };
  resetTex();
}

// ---------------------------------------------------------------- B. in-browser claims

const PROBE_RECTS = function () {
  const k = window.__vs.kernel;
  const cam = k.camera;
  cam.updateMatrixWorld(true);
  const out = [];
  k.scene.traverse((o) => {
    if (!o.name || !o.name.startsWith("tex:")) return;
    o.updateMatrixWorld(true);
    const v = cam.position.clone();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let behind = false;
    for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      v.set(lx, ly, 0);
      o.localToWorld(v);
      v.project(cam);
      if (v.z > 1) behind = true;
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    out.push({ id: o.name.slice(4), behind, x0, y0, x1, y1 });
  });
  return out;
};

/**
 * Pull every panel's texture out of the live scene. This is the render itself, before the
 * world touches it, which makes it the honest place to ask whether the KaTeX raster is sharp:
 * a composited frame also carries tone mapping, mip selection and whatever post is running.
 */
const PROBE_TEXTURES = function () {
  const k = window.__vs.kernel;
  const out = [];
  k.scene.traverse((o) => {
    const img = o?.material?.map?.image;
    if (!o.name || !o.name.startsWith("tex:") || !img || !img.toDataURL) return;
    out.push({ id: o.name.slice(4), width: img.width, height: img.height, png: img.toDataURL("image/png") });
  });
  return out;
};

const PROBE_A11Y = function () {
  const nodes = [...document.querySelectorAll('[data-vs-tex]')];
  return {
    count: nodes.length,
    rows: nodes.map((n) => ({
      state: n.getAttribute("data-vs-tex"),
      role: n.getAttribute("role"),
      label: n.getAttribute("aria-label"),
      lang: n.getAttribute("lang"),
      innerHidden: !!n.querySelector('[aria-hidden="true"]'),
      textHasBackslash: /\\/.test(n.innerText || ""),
    })),
    katexNodes: document.querySelectorAll(".katex").length,
    katexErrors: document.querySelectorAll(".katex-error").length,
    overlayText: (document.getElementById("overlay")?.innerText ?? "").slice(0, 400),
  };
};

/**
 * Headless SwiftShader has to read a whole software-rasterized frame back before Playwright
 * can hand over a PNG, and on a machine running several review sessions at once that read
 * can miss its window. That is contention, not a render bug, so it is retried rather than
 * reported as a failure — and the kernel is halted first each time so the main thread is not
 * competing with the capture for the rasterizer.
 */
async function shootRetry(d, relPath, { attempts = 3, timeout = 240000, clip = null } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await d.run(() => window.__vs?.kernel?.halt?.());
      await d.shoot(relPath, clip ? { timeout, clip } : { timeout });
      return true;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      // A hot reload is a different animal from a slow read-back: let the session retry.
      if (/Execution context was destroyed|Target closed|navigation/i.test(msg)) throw err;
      await d.run(() => window.__vs?.advance?.(1 / 30)).catch(() => {});
    }
  }
  console.error(`capture failed after ${attempts} attempts: ${String(lastErr).slice(0, 140)}`);
  return false;
}

/**
 * The hostile inputs, driven into the *shipped* world through the shipped `math:show` signal,
 * on the same page and the same scene every other in-browser claim here is measured on. No
 * test board is spawned and no module is stubbed: this is Leaf Nine with four attacks emitted
 * into it, which is exactly what would happen if a content bug or a hostile item reached the
 * teaching director.
 */
async function hostileClaims(d, shots) {
  const rows = [];
  const t0 = Date.now();
  // The module URL is passed in rather than written inline so that no bundler or linter tries
  // to resolve a browser path from Node. `TEX_PANEL_URL` is the dev server's path to the
  // shipped module — the same instance the running game holds, not a second copy.
  const caps = await d.run(async (url) => (await import(url)).RASTER_CAPS, TEX_PANEL_URL);
  const simBefore = await d.run(() => window.__vs.stats().simTime ?? window.__vs.kernel.simTime);

  for (let i = 0; i < HOSTILE.length; i++) {
    const h = HOSTILE[i];
    // Named on stderr before it is emitted, because the failure mode this suite is looking for
    // is one that takes the page down with it — and a crash with no name in the log is a
    // finding you have to reproduce from scratch.
    console.error(`  hostile ${i + 1}/${HOSTILE.length}: ${h.id} (${h.tex.length} chars, attacks ${h.attacks})`);
    const before = await d.run(() => ({
      raster: window.__vs.probe("mathtex").raster,
      errors: window.__vs.errors.length,
    }));

    const wall0 = Date.now();
    await d.run(
      ([id, tex, index]) => {
        const k = window.__vs.kernel;
        const fwd = k.camera.position.clone();
        k.camera.getWorldDirection(fwd);
        const up = k.camera.position.clone().set(0, 1, 0);
        const right = k.camera.position.clone().crossVectors(fwd, up).normalize();
        const at = k.camera.position
          .clone()
          .addScaledVector(fwd, 10)
          .addScaledVector(right, (index - 1.5) * 2.2);
        at.y = k.camera.position.y + 0.3;
        k.signals.emit("math:show", { id, tex, at: [at.x, at.y, at.z], em: 0.6 });
      },
      [h.id, h.tex, i]
    );
    await d.play(0.6);
    const wallMs = Date.now() - wall0;

    const after = await d.run(
      ([id, needle]) => {
        const field = window.__vs.probe("mathtex");
        return {
          panel: field.panels.find((p) => p.id === id) ?? null,
          raster: field.raster,
          errors: window.__vs.errors.length,
          lastError: window.__vs.errors.at(-1) ?? null,
          // A prefix check is strictly stronger than a whole-string check and does not put a
          // 20,000-character needle through the document on every call.
          sourceInDom: document.documentElement.innerHTML.includes(needle),
          katexErrors: document.querySelectorAll(".katex-error").length,
          fatal: window.__vs.fatal,
        };
      },
      [h.id, h.tex.slice(0, 200)]
    );

    rows.push({
      id: h.id,
      attacks: h.attacks,
      chars: h.tex.length,
      panel: after.panel,
      textureSize: after.panel?.textureSize ?? null,
      bound: after.panel?.bound ?? null,
      ok: after.panel?.ok ?? null,
      speech: after.panel?.speech ?? null,
      rasters: after.raster.rasters - before.raster.rasters,
      rasterMs: Number((after.raster.ms - before.raster.ms).toFixed(1)),
      wallMs,
      newErrors: after.errors - before.errors,
      lastError: after.lastError,
      sourceInDom: after.sourceInDom,
      katexErrors: after.katexErrors,
      fatal: after.fatal,
    });
  }

  // The frame, after all four are standing in it. A capture that still reads is the difference
  // between "bounded" and "bounded, and the game is still there".
  const shot = path.join(shots, "hostile.png");
  const shotOk = await shootRetry(d, path.relative(ROOT, shot).replace(/\\/g, "/"));
  let frameInk = null;
  if (shotOk) {
    const img = readPng(shot);
    frameInk = measureRegion(img, { x0: 0, y0: 0, x1: img.width, y1: img.height });
  }

  // Gate 3 in isolation. The panel path cannot reach it — the size ladder and the ink-extent
  // gate between them mean no claim ever asks for a canvas over the cap (H7 proves that as
  // arithmetic) — so it is exercised by calling the shipped module, in the shipped page, with
  // a font size no panel would ever request. Stated plainly because it is the one claim in
  // this file not measured through the in-world panel.
  const scaleDown = await d.run(async (url) => {
    const m = await import(url);
    const t = performance.now();
    const out = m.rasterizeTex("x + 3 = 7", { locale: "en", displayMode: true, fontPx: 3000 });
    return {
      ms: Number((performance.now() - t).toFixed(1)),
      width: out.canvas.width,
      height: out.canvas.height,
      fontPx: out.fontPx,
      bound: out.bound,
      ok: out.ok,
    };
  }, TEX_PANEL_URL);

  // The depth cap is calibrated against nested fractions, because that is the shape that was
  // measured crashing the renderer. It would be a poor cap if it were only safe for that one
  // shape — so every nesting shape this curriculum could plausibly produce is taken to the
  // deepest instance the cap *admits* and laid out for real. If any of these crashed or
  // stalled, the cap would be too loose for that shape.
  const { validate: validateNode } = await import(pathToFileURL(path.join(ROOT, "app/src/math/Tex.js")).href);
  const SHAPES = {
    frac: (n) => "\\frac{1}{".repeat(n) + "2" + "}".repeat(n),
    sqrt: (n) => "\\sqrt{".repeat(n) + "9" + "}".repeat(n),
    paren: (n) => "\\left(".repeat(n) + "x" + "\\right)".repeat(n),
    power: (n) => "x" + "^{x".repeat(n) + "}".repeat(n),
    abs: (n) => "\\left|".repeat(n) + "x" + "\\right|".repeat(n),
    mixed: (n) => "\\sqrt{\\frac{1}{".repeat(n) + "2" + "}}".repeat(n),
    overline: (n) => "\\overline{".repeat(n) + "x" + "}".repeat(n),
  };
  const shapes = [];
  for (const [name, make] of Object.entries(SHAPES)) {
    let deepest = null;
    for (let n = 1; n <= 60; n++) {
      const v = validateNode(make(n), { locale: "en", displayMode: true });
      if (!v.ok) break;
      deepest = { n, depth: v.depth, tex: make(n) };
    }
    if (!deepest) continue;
    const out = await d.run(
      async ([tex, url]) => {
        const m = await import(url);
        const t = performance.now();
        const r = m.rasterizeTex(tex, { locale: "en", displayMode: true, fontPx: 96 });
        return { ms: Number((performance.now() - t).toFixed(1)), width: r.canvas.width, height: r.canvas.height, ok: r.ok };
      },
      [deepest.tex, TEX_PANEL_URL]
    );
    shapes.push({ name, nesting: deepest.n, depth: deepest.depth, ...out });
  }

  await d.run(() => window.__vs.kernel.signals.emit("math:hide", {}));
  await d.play(1.0);
  const alive = await d.run(() => {
    const r = window.__vs.report();
    return {
      simTime: window.__vs.stats().simTime ?? window.__vs.kernel.simTime,
      frames: window.__vs.stats().frames ?? null,
      fatal: r.fatal,
      ready: r.ready,
      raster: window.__vs.probe("mathtex").raster,
      // Everything in the error log that is not one of our deliberate refusals.
      unexpectedErrors: window.__vs.errors.filter((e) => !/KaTeX refused a claim/.test(String(e))),
    };
  });

  return {
    caps,
    rows,
    shapes,
    scaleDown,
    frameInk,
    shot: shotOk ? path.relative(ROOT, shot) : null,
    simBefore,
    alive,
    totalWallMs: Date.now() - t0,
  };
}

/**
 * The four quantities a critic found still unbounded, driven in the SHIPPED game through the
 * SHIPPED `math:show` signal — the same public vocabulary `design/architecture.md` publishes
 * and therefore the same reach any other piece has. Nothing is stubbed and no scene is
 * spawned; this is Leaf Nine with hostile payloads emitted into it.
 *
 * Run after `hostileClaims`, because the panel-count attack deliberately fills the field and
 * evicts whatever was standing.
 */
async function stressClaims(d) {
  // ---- gate 6: the working's tick counts, which are loop bounds.
  //
  // Called on the shipped module in the shipped page — the same instance the running game
  // holds — because a `math:show` round trip measures a frame, and what is under test is one
  // function's cost. The signal path is exercised straight afterwards.
  const ticks = await d.run(async (url) => {
    const m = await import(url);
    const rows = [];
    for (const n of [10, 1e4, 1e5, 1e6]) {
      const t0 = performance.now();
      const r = m.rasterizeWorking({ pixels: 256, xTicks: n, yTicks: n });
      rows.push({ n, ms: Number((performance.now() - t0).toFixed(1)), w: r.canvas.width, h: r.canvas.height });
    }
    return rows;
  }, TEX_PANEL_URL);

  const emit = (id, spec) =>
    d.run(
      ([panelId, payload]) => {
        const k = window.__vs.kernel;
        const fwd = k.camera.position.clone();
        k.camera.getWorldDirection(fwd);
        const at = k.camera.position.clone().addScaledVector(fwd, 12);
        at.y = k.camera.position.y + 1;
        k.signals.emit("math:show", { id: panelId, at: [at.x, at.y, at.z], ...payload });
      },
      [id, spec]
    );

  const wall0 = Date.now();
  await emit("p15-ticks", { em: 0.5, working: { slope: 0.6, xTicks: 1e6, yTicks: 1e6 } });
  await d.play(0.6);
  const ticksWallMs = Date.now() - wall0;
  const ticksPanel = await d.run(() => window.__vs.probe("mathtex").panels.find((p) => p.id === "p15-ticks") ?? null);

  // ---- gate 5: `em`, the metres-per-em conversion.
  await emit("p15-em", { tex: "x + 3 = 7", em: 100000 });
  await d.play(0.6);
  const emPanel = await d.run(() => window.__vs.probe("mathtex").panels.find((p) => p.id === "p15-em") ?? null);

  // ---- the a11y divergence: refused by the world, still read out in full to a screen reader.
  //
  // 1,601 characters, so it is well *inside* `MAX_TEX_LENGTH` and gates 1 and 2 pass it. It is
  // the ink-extent gate that refuses it, and that gate used to live only on the world side.
  const wideTex = `${"1 + ".repeat(400)}1`;
  await emit("p15-a11y", { tex: wideTex, em: 0.6 });
  await d.play(0.6);
  const a11yRow = await d.run(
    ([id, needle]) => {
      const panel = window.__vs.probe("mathtex").panels.find((p) => p.id === id) ?? null;
      const el = document.querySelector(`#vs-claim-register [data-claim="${id}"]`);
      const label = el?.getAttribute("aria-label") ?? null;
      return {
        panel,
        label,
        state: el?.getAttribute("data-vs-tex") ?? null,
        present: !!el,
        labelChars: label ? label.length : 0,
        labelReadsSource: !!label && label.includes(needle),
        registerText: (el?.innerText ?? "").slice(0, 80),
      };
    },
    ["p15-a11y", "plus 1 plus 1 plus"]
  );

  // ---- gate 7: how many claims may stand at once.
  const budget = await d.run(async (url) => {
    const m = await import(url);
    const k = window.__vs.kernel;
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) {
      k.signals.emit("math:show", {
        id: `p15-flood-${i}`,
        tex: "x + 3 = 7",
        at: [k.camera.position.x + (i % 20) * 0.6, k.camera.position.y + 1, k.camera.position.z - 8 - Math.floor(i / 20)],
        em: 0.35,
      });
    }
    return { emitMs: Number((performance.now() - t0).toFixed(1)), cap: m.MAX_PANELS };
  }, TEX_PANEL_URL);
  await d.play(0.8);
  const flood = await d.run(() => {
    const field = window.__vs.probe("mathtex");
    const info = window.__vs.kernel.renderer.info;
    let texels = 0;
    for (const p of field.panels) if (p.textureSize) texels += p.textureSize[0] * p.textureSize[1];
    return {
      panels: field.panels.length,
      maxPanels: field.maxPanels,
      evictions: field.evictions,
      registered: field.registered,
      texels,
      mib: Number(((texels * 4) / (1024 * 1024)).toFixed(2)),
      textures: info.memory.textures,
      calls: info.render.calls,
      triangles: info.render.triangles,
    };
  });

  await d.run(() => window.__vs.kernel.signals.emit("math:hide", {}));
  await d.play(1.0);
  const alive = await d.run(() => {
    const r = window.__vs.report();
    return {
      simTime: window.__vs.stats().simTime ?? window.__vs.kernel.simTime,
      fatal: r.fatal,
      ready: r.ready,
      unexpectedErrors: window.__vs.errors.filter((e) => !/KaTeX refused a claim/.test(String(e))),
    };
  });

  return { ticks, ticksWallMs, ticksPanel, emPanel, a11y: a11yRow, budget, flood, alive };
}

async function browserClaims() {
  const { openGame } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);
  fs.mkdirSync(SHOTS, { recursive: true });

  // The dev server hot-reloads the page whenever anything under app/ changes, which on a
  // machine with several agents building at once lands mid-session and kills the execution
  // context. Retry the whole session rather than reporting somebody else's save as a failure.
  //
  // A reload has two tells, not one. The obvious one is "Execution context was destroyed".
  // The other is a probe running against a page that has reloaded and is *part way through
  // booting*, where `window.__vs` exists but the kernel does not yet — that surfaces as a
  // TypeError about reading a property of undefined, and it cost this script a whole run
  // before it was in the list.
  const RELOADED = /Execution context was destroyed|Target closed|navigation|Cannot read properties of undefined|__vs is not defined/i;
  const session = async (opts, body, attempts = 6) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await openGame(opts, body);
      } catch (err) {
        const msg = String(err?.message || err);
        if (i === attempts - 1 || !RELOADED.test(msg)) throw err;
        console.error(`session restarted after a hot reload (${i + 1}/${attempts}): ${msg.split("\n")[0].slice(0, 80)}`);
      }
    }
    return undefined;
  };

  const regions = [];
  const occlusionRows = [];
  const panelRows = [];
  const a11yRows = [];
  const leakRows = [];
  const textureRows = [];
  let cacheRow = null;
  let fallbackRow = null;
  let hostileRows = null;
  let stressRows = null;

  for (const size of SIZES) {
    for (const lang of LANGS) {
      const label = `${lang}-${size.label}`;
      // `low` and not `high`, for a reason that is measurement and not preference: headless
      // SwiftShader cannot read back a frame of the full post stack at 1600x900 inside
      // Playwright's screenshot window, let alone at 4K (measured: potato 7.3 s, low 14.9 s,
      // medium and high both time out at 25 s). Nothing in this piece is tier-dependent — the
      // claim material is `toneMapped:false` and takes no post pass of its own — so the tier
      // changes the sky behind the mathematics and nothing about the mathematics.
      await session({ width: size.w, height: size.h, lang, tier: TIER }, async (d) => {
        await d.play(1.2);

        // Take the occlusion measurement first, so the `mathtex` probe read a line below
        // carries a fresh number rather than a null. It is its own probe because it costs
        // ~190 ms of raycasting — see `TexPanel.measureOcclusion`.
        const occlusion = await d.probe("mathocclusion");
        occlusionRows.push({ label, ...occlusion });

        const report = await d.report();
        const mathtex = report.probes?.mathtex ?? null;
        const a11y = await d.run(PROBE_A11Y);
        const rects = await d.run(PROBE_RECTS);

        // The rasters themselves — cheap, exact, and independent of how slow the world is.
        const sheet = [];
        for (const t of await d.run(PROBE_TEXTURES)) {
          const file = path.join(SHOTS, `tex-${label}-${t.id}.png`);
          fs.writeFileSync(file, Buffer.from(t.png.split(",")[1], "base64"));
          const img = readPng(file);
          sheet.push(img);
          const m = measureRegion(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }, { alpha: true });
          textureRows.push({ label, id: t.id, width: t.width, height: t.height, file: path.relative(ROOT, file), ...(m ?? {}) });
        }
        if (sheet.length) contactSheet(path.join(SHOTS, `sheet-${label}.png`), sheet);

        // Above about 2560 px wide, SwiftShader cannot read a whole frame back inside any
        // sane window, so the 4K capture is clipped to the region under test. It is the same
        // 3840x2160 render — the renderer knows nothing about the crop — and it is the exact
        // rectangle the sharpness numbers are computed from.
        let clip = null;
        if (size.w > 2560 && rects.length) {
          const visible = rects.filter((r) => !r.behind);
          if (visible.length) {
            const m = 80;
            const x0 = Math.max(0, Math.min(...visible.map((r) => r.x0)) - m);
            const y0 = Math.max(0, Math.min(...visible.map((r) => r.y0)) - m);
            const x1 = Math.min(size.w, Math.max(...visible.map((r) => r.x1)) + m);
            const y1 = Math.min(size.h, Math.max(...visible.map((r) => r.y1)) + m);
            if (x1 - x0 > 32 && y1 - y0 > 32) clip = { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) };
          }
        }
        const shot = path.join(SHOTS, `${label}.png`);
        const shotOk = await shootRetry(d, path.relative(ROOT, shot).replace(/\\/g, "/"), { clip });

        a11yRows.push({ label, ...a11y, overlayText: undefined });
        leakRows.push({
          label,
          katexFailed: report.katex?.failed ?? null,
          rawSourceLeak: report.katex?.rawSourceLeak ?? null,
          katexRendered: report.katex?.rendered ?? null,
          katexErrors: a11y.katexErrors,
          bootProblems: (report.errors ?? []).filter((e) => !/mathtex|KaTeX refused/i.test(e)).length,
        });

        for (const p of mathtex?.panels ?? []) panelRows.push({ label, ...p });

        // Pixel work, per panel, inside its own projected rectangle plus a margin so the
        // "sky away from the ink" band exists.
        const img = shotOk ? readPng(shot) : null;
        const ox = clip ? clip.x : 0;
        const oy = clip ? clip.y : 0;
        for (const r of img ? rects : []) {
          if (r.behind) continue;
          const margin = Math.max(24, (r.x1 - r.x0) * 0.12);
          const region = measureRegion(img, {
            x0: r.x0 - margin - ox, y0: r.y0 - margin - oy, x1: r.x1 + margin - ox, y1: r.y1 + margin - oy,
          });
          if (!region || region.empty) {
            regions.push({ label, id: r.id, empty: true, inkCount: region?.inkCount ?? 0 });
            continue;
          }
          regions.push({ label, id: r.id, ...region });
        }

        // ---- the occlusion proof, in pixels, on the shipped spawn frame.
        //
        // The claim material is `depthTest:false`, so a critic's "turn depth off and see what
        // appears" probe now measures nothing by construction — which would be gaming the
        // instrument if that were the whole answer. This is the inverse and strictly stronger
        // test: put the depth test *back*, re-render the same spawn frame, and count the ink.
        // If the placement is genuinely clear of the world, the two frames carry the same ink
        // and the material flag is belt to the anchors' braces. If a claim is standing through
        // a spire, restoring depth eats it and this number says by how much.
        if (lang === LANGS[0] && size === SIZES[0] && img && !clip) {
          const flipped = await d.run(() => {
            let n = 0;
            window.__vs.kernel.scene.traverse((o) => {
              if (!(o.name || "").startsWith("tex:")) return;
              o.material.depthTest = true;
              o.material.needsUpdate = true;
              n++;
            });
            return n;
          });
          await d.play(1 / 30);
          const depthShot = path.join(SHOTS, "depth-restored.png");
          const depthOk = await shootRetry(d, path.relative(ROOT, depthShot).replace(/\\/g, "/"));
          await d.run(() => {
            window.__vs.kernel.scene.traverse((o) => {
              if (!(o.name || "").startsWith("tex:")) return;
              o.material.depthTest = false;
              o.material.needsUpdate = true;
            });
          });
          if (depthOk) {
            const img2 = readPng(depthShot);
            const rows = [];
            for (const r of rects) {
              if (r.behind) continue;
              const box = { x0: r.x0 - 2, y0: r.y0 - 2, x1: r.x1 + 2, y1: r.y1 + 2 };
              const shipped = inkPixels(img, box);
              const depthOn = inkPixels(img2, box);
              rows.push({
                id: r.id,
                shipped,
                depthOn,
                eatenPct: shipped > 0 ? Number((((shipped - depthOn) / shipped) * 100).toFixed(1)) : 0,
              });
            }
            data.occlusionPixels = {
              meshesFlipped: flipped,
              shippedShot: path.relative(ROOT, shot),
              depthShot: path.relative(ROOT, depthShot),
              rows,
            };
          }
        }

        // Cache + fallback are done once, on the smallest EN run, and after the pictures.
        if (lang === LANGS[0] && size === SIZES[0]) {
          const before = await d.run(() => ({
            tex: window.__vs.probe("tex"),
            raster: window.__vs.probe("mathtex").raster,
          }));
          await d.play(4);
          const after = await d.run(() => ({
            tex: window.__vs.probe("tex"),
            raster: window.__vs.probe("mathtex").raster,
          }));
          cacheRow = {
            framesAdvanced: 120,
            typesetsBefore: before.tex.typesets,
            typesetsAfter: after.tex.typesets,
            rastersBefore: before.raster.rasters,
            rastersAfter: after.raster.rasters,
          };

          // The deliberate malformed claim. Emitted through the real signal, into the real
          // world, so the fallback is proved on the shipped path and not in a unit test.
          const fb = await d.run(() => {
            const k = window.__vs.kernel;
            const errorsBefore = window.__vs.errors.length;
            const source = "\\frac{1}{";
            // Straight ahead of the camera, in whatever direction that is — a world axis is
            // not a direction the player is looking in.
            const fwd = k.camera.position.clone();
            k.camera.getWorldDirection(fwd);
            const at = k.camera.position.clone().addScaledVector(fwd, 9);
            at.y = k.camera.position.y + 0.4;
            k.signals.emit("math:show", {
              id: "p15-malformed",
              tex: source,
              at: [at.x, at.y, at.z],
              em: 0.75,
            });
            return { errorsBefore, source };
          });
          await d.play(0.8);
          const fbAfter = await d.run((source) => {
            const field = window.__vs.probe("mathtex");
            const panel = field.panels.find((p) => p.id === "p15-malformed");
            const html = document.documentElement.innerHTML;
            return {
              panel,
              katexErrors: document.querySelectorAll(".katex-error").length,
              sourceInDom: html.includes(source),
              overlayHasBackslash: /\\/.test(document.getElementById("overlay")?.innerText ?? ""),
              errorsAfter: window.__vs.errors.length,
              lastError: window.__vs.errors.at(-1) ?? null,
              rawSourceLeak: window.__vs.report().katex.rawSourceLeak,
            };
          }, fb.source);
          const fbShot = path.join(SHOTS, "fallback.png");
          const fbShotOk = await shootRetry(d, path.relative(ROOT, fbShot).replace(/\\/g, "/"));
          const fbRects = await d.run(PROBE_RECTS);
          const fbRect = fbRects.find((r) => r.id === "p15-malformed");
          let fbInk = null;
          if (fbShotOk && fbRect && !fbRect.behind) {
            const img2 = readPng(fbShot);
            fbInk = measureRegion(img2, {
              x0: fbRect.x0 - 20, y0: fbRect.y0 - 20, x1: fbRect.x1 + 20, y1: fbRect.y1 + 20,
            });
          }
          fallbackRow = { ...fb, ...fbAfter, ink: fbInk };

          hostileRows = await hostileClaims(d, SHOTS);
          stressRows = await stressClaims(d);
        }
      });
    }
  }

  data.stress = stressRows;
  data.occlusion = occlusionRows;
  data.panels = panelRows;
  data.regions = regions;
  data.a11y = a11yRows;
  data.leaks = leakRows;
  data.textures = textureRows;
  data.cache = cacheRow;
  data.fallback = fallbackRow;
  data.hostile = hostileRows;

  // ---- the raster itself
  const claimTextures = textureRows.filter((t) => t.inkCount > 200 && !t.empty);
  const worstRasterEdge = claimTextures.length ? Math.max(...claimTextures.map((t) => t.edgeWidthPx ?? 99)) : null;
  claim("C7b", "the KaTeX raster is a hard-edged alpha mask, not a blurred one",
    "partial-alpha band <= 1.3 px", worstRasterEdge === null ? "n/a" : Number(worstRasterEdge.toFixed(2)),
    worstRasterEdge !== null && worstRasterEdge <= 1.3,
    claimTextures.length ? null : "no textures captured");
  const biggest = claimTextures.length ? Math.max(...claimTextures.map((t) => t.height)) : 0;
  claim("C7c", "a raster is produced at a real working resolution", ">= 64 px tall", biggest, biggest >= 64);

  // ---- G2: no KaTeX failure, no raw TeX, in any locale at any size.
  const failedTotal = leakRows.reduce((s, r) => s + (r.katexFailed || 0) + (r.katexErrors || 0), 0);
  const leakTotal = leakRows.filter((r) => r.rawSourceLeak).length;
  claim("C8a", "zero KaTeX failures in every locale and size", "0", failedTotal, failedTotal === 0);
  claim("C8b", "zero raw-TeX leaks into visible UI", "0 runs leaking", leakTotal, leakTotal === 0);
  const rendered = Math.min(...leakRows.map((r) => r.katexRendered ?? 0));
  claim("C8c", "KaTeX really ran (DOM nodes present in every run)", ">= 3", rendered, rendered >= 3);

  // ---- a11y
  const a11yBad = a11yRows.filter(
    (r) => r.count < 3 || r.rows.some((x) => !x.label || x.role !== "math" || /[\\{}^_]/.test(x.label) || !x.innerHidden || x.textHasBackslash)
  );
  claim("C9", "every claim carries role=math with a localized, notation-free aria-label",
    "0 bad rows", a11yBad.length, a11yBad.length === 0,
    a11yBad.length ? JSON.stringify(a11yBad[0].rows?.[0] ?? null) : null);

  const langsSeen = new Set(a11yRows.flatMap((r) => r.rows.map((x) => x.lang)));
  claim("C9b", "the aria-label language follows the requested locale", `has ${LANGS.join(",")}`,
    [...langsSeen].join(","), LANGS.every((l) => langsSeen.has(l)));

  // ---- resolution
  const withTex = panelRows.filter((p) => p.texelsPerPixel > 0);
  const worstTpp = withTex.length ? Math.min(...withTex.map((p) => p.texelsPerPixel)) : 0;
  claim("C10", "no panel is ever magnified: >= 1 texel per device pixel, at 900p and at 4K",
    ">= 1.00", Number(worstTpp.toFixed(2)), worstTpp >= 1.0,
    withTex.length ? `worst: ${withTex.reduce((a, b) => (a.texelsPerPixel <= b.texelsPerPixel ? a : b)).id}` : "no panels");

  const uhd = panelRows.filter((p) => p.label.endsWith("3840x2160"));
  const uhdGrew = uhd.length ? Math.max(...uhd.map((p) => p.texturePx)) : 0;
  const hd = panelRows.filter((p) => p.label.endsWith("1600x900"));
  const hdMax = hd.length ? Math.max(...hd.map((p) => p.texturePx)) : 0;
  if (uhd.length && hd.length) {
    claim("C11", "the raster grows with the viewport instead of staying fixed",
      "4K bucket > 900p bucket", `${uhdGrew} vs ${hdMax}`, uhdGrew > hdMax);
  }

  const distant = panelRows.filter((p) => p.id === "leaf9-mark");
  const worstEm = distant.length ? Math.min(...distant.map((p) => p.emScreenPx)) : 0;
  claim("C12", "the claim standing ~38 m away is still drawn at a legible size",
    "em >= 12 device px", Number(worstEm.toFixed(1)), worstEm >= 12);

  // ---- caching under load
  if (cacheRow) {
    const ok = cacheRow.typesetsAfter === cacheRow.typesetsBefore && cacheRow.rastersAfter === cacheRow.rastersBefore;
    claim("C13", "120 frames of play cause no re-typeset and no re-raster",
      "0 new typesets, 0 new rasters",
      `${cacheRow.typesetsAfter - cacheRow.typesetsBefore} / ${cacheRow.rastersAfter - cacheRow.rastersBefore}`, ok);
  }

  // ---- the malformed claim, on the shipped path
  if (fallbackRow) {
    claim("C14a", "a malformed claim never produces a katex-error node", "0", fallbackRow.katexErrors, fallbackRow.katexErrors === 0);
    claim("C14b", "the malformed source appears nowhere in the document", "false", fallbackRow.sourceInDom, fallbackRow.sourceInDom === false);
    claim("C14c", "no raw TeX reaches the visible UI when a claim is refused", "false",
      fallbackRow.rawSourceLeak || fallbackRow.overlayHasBackslash, !fallbackRow.rawSourceLeak && !fallbackRow.overlayHasBackslash);
    claim("C14d", "the refusal is logged to __vs.errors so a build cannot ship it quietly",
      ">= 1 new error naming the refusal",
      `${fallbackRow.errorsAfter - fallbackRow.errorsBefore}: ${String(fallbackRow.lastError).slice(0, 60)}`,
      fallbackRow.errorsAfter > fallbackRow.errorsBefore && /KaTeX refused/.test(String(fallbackRow.lastError)));
    claim("C14e", "the player sees a typeset stand-in, not an empty space",
      "ink present in the panel's rectangle", fallbackRow.ink?.inkCount ?? 0, (fallbackRow.ink?.inkCount ?? 0) > 40);
    claim("C14f", "the stand-in announces itself as unreadable rather than reading out notation",
      "localized fallback phrase", fallbackRow.panel?.speech ?? null,
      !!fallbackRow.panel && fallbackRow.panel.ok === false && !/[\\{}]/.test(fallbackRow.panel.speech || "x"));
  }

  // ---- O1-O3 — is the mathematics reaching the player whole?
  //
  // Measured on the SHIPPED spawn frame of Leaf Nine, in every locale and at both sizes: the
  // real dev-server page, the real boot modules, the real `leaf9-*` claims placed by
  // `app/src/boot/60-mathtex.js`, the real terrain, scatter and avatar. Nothing is spawned.
  const standing = occlusionRows.flatMap((r) =>
    (r.panels ?? []).filter((p) => p.id.startsWith("leaf9-")).map((p) => ({ label: r.label, ...p }))
  );
  const unmeasured = standing.filter((p) => p.occludedPct === null || p.samples < 8);
  const worstOccl = standing.length ? Math.max(...standing.map((p) => p.occludedPct ?? 100)) : null;
  claim("O1", "no standing claim has world geometry in front of its ink, in any locale or size",
    "0.0% occluded, every claim really sampled",
    worstOccl === null ? "not measured" : `${worstOccl}% worst of ${standing.length} panel-runs, ${standing[0]?.samples ?? 0} ink samples each`,
    standing.length >= 4 * LANGS.length * SIZES.length && worstOccl === 0 && unmeasured.length === 0,
    standing.filter((p) => (p.occludedPct ?? 100) > 0).map((p) => `${p.label} ${p.id} ${p.occludedPct}%`).join(" | ") ||
      (unmeasured.length ? `unsampled: ${unmeasured.map((p) => `${p.label} ${p.id}`).join(", ")}` : null));

  // The same number, read back off the cheap probe, so `mathtex.panels[].occludedPct` is
  // proved to carry the measurement rather than merely to have a key for it.
  const carried = panelRows.filter((p) => p.id.startsWith("leaf9-") && p.occludedPct !== null).length;
  claim("O1b", "the per-panel probe carries the occlusion number, not just a field for it",
    `${4 * LANGS.length * SIZES.length} panel-runs report a number`, carried,
    carried >= 4 * LANGS.length * SIZES.length);

  const occl = data.occlusionPixels;
  if (occl) {
    const worstEaten = occl.rows.length ? Math.max(...occl.rows.map((r) => r.eatenPct)) : null;
    claim("O2", "restoring the depth test to the shipped frame changes no claim's ink: the anchors are clear, not just the material",
      "<= 1.0% of ink lost with depth on",
      occl.rows.map((r) => `${r.id} ${r.shipped}->${r.depthOn} px (${r.eatenPct}%)`).join(", "),
      occl.rows.length >= 4 && worstEaten !== null && worstEaten <= 1.0,
      `${occl.shippedShot} vs ${occl.depthShot}`);
  }

  const floaty = panelRows.filter((p) => p.depthTest === false).length;
  claim("O3", "the claim material never lets a nearer mesh amputate a claim mid-glyph",
    "depthTest false on every panel", `${floaty}/${panelRows.length}`, panelRows.length > 0 && floaty === panelRows.length);

  // ---- T1-T5 — the caller-controlled numbers that were not bounded, in the shipped game.
  if (stressRows) {
    const { ticks, ticksPanel, emPanel, a11y, flood, alive: stressAlive } = stressRows;
    const worstTickMs = Math.max(...ticks.map((t) => t.ms));
    const tickSizesEqual = ticks.every((t) => t.w === ticks[0].w && t.h === ticks[0].h);
    claim("T1a", "a working's tick counts no longer set the loop bound: 1e6 ticks costs what 10 ticks costs",
      "<= 20 ms at every count, same canvas",
      ticks.map((t) => `${t.n}:${t.ms}ms ${t.w}x${t.h}`).join(" "),
      worstTickMs <= 20 && tickSizesEqual,
      "before the clamp, measured by the critic on this same scene: 1e4 11 ms, 1e5 99.9 ms, 1e6 2045.1 ms");
    claim("T1b", "the same attack through the shipped math:show signal leaves a bounded working standing",
      "panel present, texture inside the cap, frame not stalled",
      ticksPanel
        ? `${ticksPanel.textureSize?.join("x")} texture, ${stressRows.ticksWallMs} ms wall for emit+36 frames`
        : "no panel",
      !!ticksPanel && !!ticksPanel.textureSize && ticksPanel.textureSize[0] <= 4096 && ticksPanel.textureSize[1] <= 4096);

    claim("T2", "em is metres per em and is bounded, so 48 bounded ems cannot make an unbounded billboard",
      "em <= 4, quad <= 192 x 96 m",
      emPanel ? `asked ${emPanel.emRequested}, got ${emPanel.em}, quad ${emPanel.worldSize?.join(" x ")} m` : "no panel",
      !!emPanel && emPanel.em <= 4 && emPanel.emClamped === true &&
        emPanel.worldSize[0] <= 192 && emPanel.worldSize[1] <= 96,
      "before the clamp: em 100000 produced a 503776.042 x 104557.292 m quad");

    claim("T3a", "the field itself is bounded, not only each raster in it",
      `<= ${flood.maxPanels} panels after 400 distinct math:show ids`,
      `${flood.panels} panels, ${flood.evictions} evictions, ${flood.registered} register entries`,
      flood.panels <= flood.maxPanels && flood.evictions > 0);
    claim("T3b", "the flooded field stays inside architecture.md's frame budget",
      "<= 320 draw calls, <= 120 textures",
      `${flood.calls} calls, ${flood.textures} textures, ${flood.mib} MiB of claim texels`,
      flood.calls <= 320 && flood.textures <= 120,
      "before the cap: 407 panels, 494 calls, 408 textures, 32.3 MiB");

    claim("T4", "a claim the world refuses is refused to the screen-reader user too",
      "register reads the fallback, never the source",
      a11y.panel
        ? `panel ok=${a11y.panel.ok} bound=${a11y.panel.bound?.reason ?? null} | register "${a11y.label}" (${a11y.labelChars} chars, state ${a11y.state})`
        : "no panel",
      !!a11y.panel && a11y.panel.ok === false && a11y.present === true &&
        a11y.state === "fallback" && a11y.labelReadsSource === false && a11y.labelChars <= 60 &&
        a11y.label === a11y.panel.speech,
      "before: bound {reason:'ink-extent', emsWide:2082.8} in the world, aria-label '1 plus 1 plus 1 plus…' in the DOM");

    claim("T5", "the game survives the four bound attacks: clock advancing, no crash, no error but the refusals",
      "fatal null, ready, 0 unexpected errors",
      `fatal=${stressAlive.fatal} ready=${stressAlive.ready} sim=${stressAlive.simTime?.toFixed?.(2)} unexpected=${stressAlive.unexpectedErrors.length}`,
      !stressAlive.fatal && stressAlive.ready && stressAlive.unexpectedErrors.length === 0,
      stressAlive.unexpectedErrors.slice(0, 2).join(" | ") || null);
  }

  // ---- H1-H8 — the hostile inputs, in the shipped world (Leaf Nine, EN, 1600x900).
  if (hostileRows) {
    const { caps, rows, shapes, scaleDown, alive, frameInk } = hostileRows;
    const inCap = (w, h) => w > 0 && h > 0 && w <= caps.maxEdge && h <= caps.maxEdge && w * h <= caps.maxPixels;

    const sized = rows.filter((r) => r.textureSize);
    const overCap = sized.filter((r) => !inCap(r.textureSize[0], r.textureSize[1]));
    claim("H1", "no hostile claim's texture exceeds the cap in either axis or in area",
      `<= ${caps.maxEdge} px per axis, <= ${caps.maxPixels} px total`,
      sized.map((r) => `${r.id} ${r.textureSize[0]}x${r.textureSize[1]}`).join(", ") || "no panels",
      sized.length === HOSTILE.length && overCap.length === 0,
      overCap.length ? `over cap: ${overCap.map((r) => r.id).join(", ")}` : null);

    // The invariant over every raster the session ever made, standing claims and attacks
    // alike — not only the four this block happened to sample.
    const peak = alive.raster;
    claim("H2", "the largest canvas allocated anywhere in the session is inside the cap",
      `<= ${caps.maxEdge} px per axis, <= ${caps.maxPixels} px total, over ${peak.rasters} rasters`,
      `${peak.maxCanvasWidth}x${peak.maxCanvasHeight} = ${peak.maxCanvasPixels} px`,
      inCap(peak.maxCanvasWidth, peak.maxCanvasHeight) && peak.rasters > 0);

    const worstMs = rows.length ? Math.max(...rows.map((r) => r.rasterMs)) : null;
    claim("H3", "no hostile claim stalls the game: rasterizing one costs a hitch, not a hang",
      "<= 400 ms of raster time", worstMs === null ? "n/a" : worstMs,
      worstMs !== null && worstMs <= 400,
      rows.map((r) => `${r.id} ${r.rasterMs}ms/${r.rasters}r`).join(" "));

    const stillAlive =
      !alive.fatal && alive.ready && alive.simTime > hostileRows.simBefore && alive.unexpectedErrors.length === 0;
    claim("H4", "the game survives all four: no crash, clock still advancing, no error but the refusals",
      "fatal null, simTime advanced, 0 unexpected errors",
      `fatal=${alive.fatal} sim ${hostileRows.simBefore?.toFixed?.(2)}->${alive.simTime?.toFixed?.(2)} unexpected=${alive.unexpectedErrors.length}`,
      stillAlive, alive.unexpectedErrors.slice(0, 2).join(" | ") || null);
    claim("H4b", "the frame still renders with the attacks standing in it",
      "ink present in the capture", frameInk?.inkCount ?? 0, (frameInk?.inkCount ?? 0) > 40,
      hostileRows.shot);

    const bad = rows.filter(
      (r) => r.ok !== false || !r.speech || /[\\{}^_]/.test(r.speech) || r.sourceInDom || r.katexErrors > 0 || r.newErrors < 1
    );
    claim("H5", "every hostile claim is refused visibly, logged, and never shows its source",
      "0 bad rows", `${rows.length - bad.length}/${rows.length} clean`, bad.length === 0,
      bad.length ? JSON.stringify({ id: bad[0].id, ok: bad[0].ok, speech: bad[0].speech, dom: bad[0].sourceInDom, errs: bad[0].newErrors }) : null);
    claim("H5b", "each refusal names the bound it broke, so a build cannot ship it quietly",
      "every row logs a 'KaTeX refused' line",
      rows.map((r) => `${r.id}: ${String(r.lastError).slice(0, 46)}`).join(" | "),
      rows.every((r) => /KaTeX refused a claim/.test(String(r.lastError))));

    // Headroom, on the shipped standing claims, measured in the same run as the attacks.
    const shipped = textureRows.filter((t) => t.label === `${LANGS[0]}-${SIZES[0].label}`);
    const worstShipped = shipped.length ? Math.max(...shipped.map((t) => t.width * t.height)) : 0;
    claim("H6", "the cap has real headroom: the shipped claims are nowhere near it",
      ">= 10x spare area", worstShipped ? `${(caps.maxPixels / worstShipped).toFixed(0)}x (worst shipped raster ${worstShipped} px)` : "n/a",
      worstShipped > 0 && caps.maxPixels / worstShipped >= 10);

    // Why the raster-size refusal branch cannot fire once the ink-extent gate holds: the
    // smallest font the ladder can pick, times the widest ink the ink gate admits, is inside
    // the cap. This is arithmetic on the shipped constants, not an opinion about them.
    const wCorner = caps.maxInkEmsWide * caps.minFontPx;
    const hCorner = caps.maxInkEmsTall * caps.minFontPx;
    claim("H7", "no claim the ink-extent gate admits can ever be refused for raster size",
      `${caps.maxInkEmsWide}x${caps.maxInkEmsTall} ems at ${caps.minFontPx} px fits the cap`,
      `${wCorner}x${hCorner} px`, inCap(wCorner, hCorner));

    // The depth cap was calibrated on one shape. This checks it holds for seven.
    const shapeBad = shapes.filter((s) => !s.ok || !inCap(s.width, s.height) || s.ms > 400);
    claim("H9", "every nesting shape, at the deepest the cap admits, lays out safely and inside the cap",
      `${shapes.length} shapes, all ok, <= 400 ms, inside the cap`,
      shapes.map((s) => `${s.name} n=${s.nesting}/d=${s.depth} ${s.width}x${s.height} ${s.ms}ms`).join(" "),
      shapes.length >= 7 && shapeBad.length === 0,
      shapeBad.length ? `bad: ${shapeBad.map((s) => s.name).join(", ")}` : null);

    claim("H8", "asked for a raster 3000 px per em, the pipeline scales it down and keeps the whole claim",
      "inside the cap, ok:true, bound=scaled",
      `${scaleDown.width}x${scaleDown.height} at ${scaleDown.fontPx}px, bound=${scaleDown.bound?.reason}, ok=${scaleDown.ok}, ${scaleDown.ms}ms`,
      inCap(scaleDown.width, scaleDown.height) && scaleDown.ok === true && scaleDown.bound?.reason === "scaled");
  }
}

// ---------------------------------------------------------------- C. the reference control

function referenceControl() {
  const ref = path.join(ROOT, "reference", "target-lowpoly.png");
  if (!fs.existsSync(ref)) return null;
  const img = readPng(ref);
  // The equation and the plotted working, in the target's own pixels.
  const eq = measureRegion(img, { x0: 1100, y0: 380, x1: 1500, y1: 680 });
  const plot = measureRegion(img, { x0: 1500, y0: 350, x1: 1900, y1: 690 });
  return { equation: eq, working: plot };
}

// ---------------------------------------------------------------- run

async function main() {
  await offlineClaims();

  const ref = referenceControl();
  data.reference = ref;

  if (!hasFlag("offline")) {
    await browserClaims();

    const real = data.regions.filter((r) => !r.empty && r.inkCount >= 60);
    if (real.length && ref?.equation) {
      const worstInk = Math.min(...real.map((r) => r.inkLuminance));
      claim("C15", "the ink is pure white, as it is in the target",
        `>= ${(ref.equation.inkLuminance - 6).toFixed(1)} (target ${ref.equation.inkLuminance})`,
        Number(worstInk.toFixed(1)), worstInk >= ref.equation.inkLuminance - 6);

      // No panel, no frame, no glow: the sky beside a glyph must not be darkened. The target's
      // own signed delta is the bar, with a small allowance for a different sky gradient.
      // The same property, measured where a glow would actually live: this piece's own alpha
      // raster, before the world is anywhere near it. C16 below reads a *composited* frame, so
      // it inherits whatever the world put behind the mathematics — a claim standing against a
      // terrain edge rather than open sky has a sloped background and the slope lands in the
      // number. This one cannot: the texture is white-on-transparent and nothing else is in
      // it, so a rim, shadow or glow drawn by this pipeline would be the only thing there.
      const alphaHalo = data.textures.filter((t) => t.inkCount > 200 && !t.empty);
      const worstAlphaHalo = alphaHalo.length ? Math.max(...alphaHalo.map((t) => Math.abs(t.haloDelta ?? 99))) : null;
      claim("C16b", "the raster this piece draws has no rim, no shadow and no glow of its own",
        "|halo| <= 0.5 in the texture's own alpha", worstAlphaHalo === null ? "n/a" : worstAlphaHalo,
        worstAlphaHalo !== null && worstAlphaHalo <= 0.5,
        alphaHalo.length ? null : "no textures captured");

      const worstHalo = Math.min(...real.map((r) => r.haloDelta ?? 0));
      claim("C16", "no panel, no frame and no glow: the sky 3-5 px from the ink is not darker than the sky 12-20 px away",
        `>= -3.0 (target ${ref.equation.haloDelta})`, Number(worstHalo.toFixed(1)), worstHalo >= -3.0,
        // Attribution, in the failure line itself, so a critic does not have to take anyone's
        // word for where a negative number came from. The material is untone-mapped white
        // under normal alpha blending, which can only ever brighten what is behind it; if
        // C16b is 0 and this is negative, the darkening is in the background, and
        // `bgGradient` says whether the background is sloped where it was sampled.
        `our own raster's alpha halo: ${worstAlphaHalo} | ` +
          real.map((r) => `${r.id} halo ${r.haloDelta} bgGradient ${r.bgGradient} bg ${r.farBgLuminance}`).join(" | "));

      const worstEdge = Math.max(...real.map((r) => r.edgeWidthPx ?? 99));
      claim("C17", "glyph edges are hard: the partial-coverage band is about one pixel wide",
        `<= 2.0 px (target ${ref.equation.edgeWidthPx})`, Number(worstEdge.toFixed(2)), worstEdge <= 2.0);

      const uhdRegions = real.filter((r) => r.label.endsWith("3840x2160"));
      if (uhdRegions.length) {
        const uhdEdge = Math.max(...uhdRegions.map((r) => r.edgeWidthPx ?? 99));
        claim("C18", "still hard-edged at 3840x2160 (no upscaled texture)", "<= 2.0 px",
          Number(uhdEdge.toFixed(2)), uhdEdge <= 2.0);
      }

      // Contrast is a property of the sky a claim happens to stand against, so the bar is the
      // target's own figure with a 10% allowance rather than an invented absolute.
      const worstContrast = Math.min(...real.map((r) => r.contrastRatio ?? 0));
      const bar = ref.equation.contrastRatio * 0.9;
      claim("C19", "the ink stands out at least as well as it does in the target",
        `>= ${bar.toFixed(2)} (target ${ref.equation.contrastRatio})`, Number(worstContrast.toFixed(2)),
        worstContrast >= bar);
    } else {
      claim("C15", "ink measured in a capture", "regions with ink", real.length, false, "no ink regions found");
    }
  }

  const passed = claims.filter((c) => c.pass).length;
  const out = {
    piece: "P15",
    when: new Date().toISOString(),
    langs: LANGS,
    sizes: SIZES.map((s) => s.label),
    summary: { claims: claims.length, passed, failed: claims.length - passed },
    claims,
    data,
  };
  console.log(JSON.stringify(out, null, 1));

  console.error("");
  console.error("P15 — strict KaTeX pipeline, DOM and in-world");
  console.error("─".repeat(96));
  for (const c of claims) {
    console.error(
      `${c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(6)} ${String(c.claim).slice(0, 62).padEnd(63)} ` +
        `${String(c.threshold).padEnd(22)} got ${String(c.value)}`
    );
    if (!c.pass && c.note) console.error(`                ${c.note}`);
  }
  console.error("─".repeat(96));
  console.error(`${passed}/${claims.length} claims passed`);
  process.exit(passed === claims.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
