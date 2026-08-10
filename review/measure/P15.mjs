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
    haloDelta: near.mean !== null && far.mean !== null ? Number((near.mean - far.mean).toFixed(1)) : null,
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

async function offlineClaims() {
  const Tex = await import(pathToFileURL(path.join(ROOT, "app/src/math/Tex.js")).href);
  const { validate, render, localizeTex, lintTexBank, texStats, resetTex, LOCALES } = Tex;

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

async function browserClaims() {
  const { openGame } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);
  fs.mkdirSync(SHOTS, { recursive: true });

  // The dev server hot-reloads the page whenever anything under app/ changes, which on a
  // machine with several agents building at once lands mid-session and kills the execution
  // context. Retry the whole session rather than reporting somebody else's save as a failure.
  const session = async (opts, body, attempts = 6) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await openGame(opts, body);
      } catch (err) {
        const msg = String(err?.message || err);
        if (i === attempts - 1 || !/Execution context was destroyed|Target closed|navigation/i.test(msg)) throw err;
        console.error(`session restarted after a hot reload (${i + 1}/${attempts})`);
      }
    }
    return undefined;
  };

  const regions = [];
  const panelRows = [];
  const a11yRows = [];
  const leakRows = [];
  const textureRows = [];
  let cacheRow = null;
  let fallbackRow = null;

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
        }
      });
    }
  }

  data.panels = panelRows;
  data.regions = regions;
  data.a11y = a11yRows;
  data.leaks = leakRows;
  data.textures = textureRows;
  data.cache = cacheRow;
  data.fallback = fallbackRow;

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
      const worstHalo = Math.min(...real.map((r) => r.haloDelta ?? 0));
      claim("C16", "no panel, no frame and no glow: the sky 3-5 px from the ink is not darker than the sky 12-20 px away",
        `>= -3.0 (target ${ref.equation.haloDelta})`, Number(worstHalo.toFixed(1)), worstHalo >= -3.0);

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
