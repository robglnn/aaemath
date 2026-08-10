/**
 * TexPanel — mathematics standing in the world.
 *
 * The art target (`reference/target-lowpoly.png`) is unambiguous about what this must look
 * like, and it was measured rather than eyeballed. In the target's own pixels, the glyphs
 * are pure white (mean luminance 254) and the sky 4 px away from the ink is *identical* to
 * the sky 16 px away (188.8 vs 184.7). There is no panel, no glass, no frame, and — this is
 * the part that is easy to get wrong — no drop shadow, no dark rim and no glow either. The
 * mathematics reads because it is the only pure-white thing in the frame. So `rim` defaults
 * to 0 here, and `review/measure/P15.mjs` re-runs that same measurement against our capture
 * and against the reference, so "no panel" is a number rather than an opinion.
 *
 * ## Why the glyphs are drawn instead of screenshotted
 *
 * KaTeX produces HTML, and there is no supported way to get HTML onto a WebGL texture.
 * Wrapping it in an SVG `<foreignObject>` and loading it as an image does not work: images
 * load in a secure static mode with no access to external resources, so every KaTeX font
 * silently falls back and the equation rasterizes in Times New Roman.
 *
 * So this file lets the browser do the *layout* — which is the hard part, and the part KaTeX
 * exists for — and then does the *painting* itself. It lays the expression out in a hidden
 * host at a chosen pixel size, walks the resulting boxes, and re-draws every glyph run,
 * every rule (fraction bars, `\overline`) and every stretchy SVG onto a 2D canvas at the
 * exact position layout put it. The result is a real KaTeX render, at any resolution, with
 * an alpha channel.
 *
 * ## Staying sharp
 *
 * A fixed texture size is wrong at both ends: blurry when the player walks up to a claim,
 * wasteful at distance and at 4K. Each panel measures its own projected height in device
 * pixels every frame and re-rasterizes when it crosses a size bucket, with hysteresis and a
 * cooldown so it cannot thrash. Mip-maps plus anisotropy carry it at gameplay distance.
 */
import * as THREE from "three";
import { render, renderInto, getLocale } from "./Tex.js";

// ---------------------------------------------------------------- hidden layout host

const HOST_ID = "vs-tex-layout";
let hostEl = null;

/**
 * The layout surface. Deliberately attached to <body> and never to #overlay: the reviewer's
 * raw-TeX leak check reads `#overlay.innerText`, and a measuring host inside it would be a
 * false positive waiting to happen. It is off-screen rather than `display:none` because
 * `display:none` produces no layout, and layout is the entire reason it exists.
 */
function host() {
  if (hostEl && hostEl.isConnected) return hostEl;
  hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  hostEl.setAttribute("aria-hidden", "true");
  hostEl.style.cssText =
    "position:fixed;left:-32768px;top:0;width:auto;height:auto;margin:0;padding:0;" +
    "white-space:nowrap;pointer-events:none;user-select:none;color:#ffffff;z-index:-1;" +
    "contain:layout style;";
  document.body.appendChild(hostEl);
  return hostEl;
}

const FONT_FACES = [
  "normal 400 24px KaTeX_Main",
  "italic 400 24px KaTeX_Main",
  "normal 700 24px KaTeX_Main",
  "italic 400 24px KaTeX_Math",
  "normal 400 24px KaTeX_Size1",
  "normal 400 24px KaTeX_Size2",
  "normal 400 24px KaTeX_Size3",
  "normal 400 24px KaTeX_Size4",
  "normal 400 24px KaTeX_AMS",
];

const fontState = { ready: false, loaded: [], failed: [], ms: 0 };

/**
 * Rasterizing before the KaTeX faces are resolved paints the fallback font into a texture
 * that then never updates — a wrong render that looks like a deliberate one. So the boot
 * module waits for these, with a timeout so a slow font can never hang the game.
 */
export async function ensureMathFonts(timeoutMs = 3000) {
  if (fontState.ready) return fontState;
  const t0 = performance.now();
  if (typeof document === "undefined" || !document.fonts) {
    fontState.ready = true;
    return fontState;
  }
  const load = Promise.all(
    FONT_FACES.map((spec) =>
      document.fonts
        .load(spec, "x")
        .then((faces) => {
          if (faces.length) fontState.loaded.push(spec);
          else fontState.failed.push(spec);
        })
        .catch(() => fontState.failed.push(spec))
    )
  ).then(() => document.fonts.ready);

  await Promise.race([load, new Promise((r) => setTimeout(r, timeoutMs))]);
  fontState.ready = true;
  fontState.ms = Number((performance.now() - t0).toFixed(1));
  return fontState;
}

export function mathFontState() {
  return { ...fontState, loaded: fontState.loaded.length, failed: [...fontState.failed] };
}

// ---------------------------------------------------------------- font metrics

const metricCache = new Map();
let metricCtx = null;

function fontMetrics(fontString) {
  const hit = metricCache.get(fontString);
  if (hit) return hit;
  if (!metricCtx) metricCtx = document.createElement("canvas").getContext("2d");
  metricCtx.font = fontString;
  const m = metricCtx.measureText("Mgxy0");
  const asc = m.fontBoundingBoxAscent || 0;
  const desc = m.fontBoundingBoxDescent || 0;
  const rec = { ascent: asc, descent: desc, sum: asc + desc };
  metricCache.set(fontString, rec);
  return rec;
}

function fontStringOf(cs) {
  return `${cs.fontStyle || "normal"} ${cs.fontWeight || 400} ${cs.fontSize} ${cs.fontFamily}`;
}

function alphaOf(color) {
  if (!color) return 0;
  if (color === "transparent") return 0;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return 1;
  const parts = m[1].split(",").map((s) => parseFloat(s));
  return parts.length > 3 ? parts[3] : 1;
}

// ---------------------------------------------------------------- box collection

const VISIBLE_TEXT = /[^\s\u200B\u00A0\uFEFF]/;

function intersect(a, b) {
  if (!a) return b;
  if (!b) return a;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Walk the laid-out KaTeX tree and turn it into flat paint instructions in viewport
 * coordinates. Three kinds come out: glyph runs, filled rectangles (every rule in KaTeX is a
 * CSS border — the fraction bar, `\overline`, `\rule`) and stretchy SVG paths.
 */
function collect(root, stats) {
  const items = [];

  const visit = (el, clip) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
    const rect = el.getBoundingClientRect();
    let childClip = clip;
    if (cs.overflow !== "visible" && cs.overflow !== "") childClip = intersect(clip, rect);

    if (el.tagName === "svg" || el.tagName === "SVG") {
      collectSvg(el, rect, clip, items, stats);
      return;
    }

    const bg = cs.backgroundColor;
    if (alphaOf(bg) > 0.01 && rect.width > 0 && rect.height > 0) {
      items.push({ kind: "rect", color: bg, x: rect.left, y: rect.top, w: rect.width, h: rect.height, clip });
    }
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const wpx = parseFloat(cs[`border${side}Width`]) || 0;
      const color = cs[`border${side}Color`];
      if (wpx <= 0.02 || alphaOf(color) <= 0.01) continue;
      const box =
        side === "Top"
          ? { x: rect.left, y: rect.top, w: rect.width, h: wpx }
          : side === "Bottom"
            ? { x: rect.left, y: rect.bottom - wpx, w: rect.width, h: wpx }
            : side === "Left"
              ? { x: rect.left, y: rect.top, w: wpx, h: rect.height }
              : { x: rect.right - wpx, y: rect.top, w: wpx, h: rect.height };
      items.push({ kind: "rect", color, ...box, clip });
      stats.rules++;
    }

    const kids = [...el.childNodes];
    const onlyText = kids.length === 1 && kids[0].nodeType === 3;
    for (const node of kids) {
      if (node.nodeType === 1) {
        visit(node, childClip);
        continue;
      }
      if (node.nodeType !== 3 || !VISIBLE_TEXT.test(node.data)) continue;
      // A KaTeX leaf is a span with exactly one text child, so its own border box *is* the
      // text box. Anything else gets wrapped so it becomes one; the host is disposable, so
      // mutating it costs nothing and keeps a single measurement path.
      let holder = el;
      if (!onlyText) {
        holder = document.createElement("span");
        node.parentNode.insertBefore(holder, node);
        holder.appendChild(node);
        stats.wrapped++;
      }
      pushText(holder, node.data, childClip, items, stats);
    }
  };

  visit(root, null);
  return items;
}

function pushText(el, text, clip, items, stats) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  const font = fontStringOf(cs);
  const fm = fontMetrics(font);
  // Place the baseline proportionally inside the measured box. When the inline box height
  // equals ascent+descent (which is what Chromium gives an inline non-replaced element) this
  // is exactly `top + ascent`; expressing it as a ratio means an engine that folds
  // line-height into the box still lands on the right line instead of drifting.
  const ratio = fm.sum > 0 ? fm.ascent / fm.sum : 0.8;
  const baseline = rect.top + rect.height * ratio;
  if (fm.sum > 0) stats.baselineResidual = Math.max(stats.baselineResidual, Math.abs(rect.height - fm.sum));
  items.push({
    kind: "text",
    text,
    font,
    color: cs.color,
    x: rect.left,
    baseline,
    ascent: fm.ascent,
    descent: fm.descent,
    width: rect.width,
    clip,
  });
  stats.glyphs++;
}

function collectSvg(svg, rect, clip, items, stats) {
  const vb = svg.viewBox?.baseVal;
  const paths = [...svg.querySelectorAll("path")];
  if (!vb || !vb.width || !vb.height || !paths.length) {
    stats.unsupportedSvg++;
    return;
  }
  const par = (svg.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim().split(/\s+/);
  const align = par[0] || "xMidYMid";
  const slice = par[1] === "slice";
  const sx = rect.width / vb.width;
  const sy = rect.height / vb.height;
  let scaleX = sx;
  let scaleY = sy;
  let tx = 0;
  let ty = 0;
  if (align !== "none") {
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    scaleX = s;
    scaleY = s;
    const slack = { x: rect.width - vb.width * s, y: rect.height - vb.height * s };
    if (align.includes("xMid")) tx = slack.x / 2;
    else if (align.includes("xMax")) tx = slack.x;
    if (align.includes("YMid")) ty = slack.y / 2;
    else if (align.includes("YMax")) ty = slack.y;
  }
  for (const p of paths) {
    const d = p.getAttribute("d");
    if (!d) continue;
    const pcs = getComputedStyle(p);
    let fill = pcs.fill;
    if (!fill || fill === "none" || alphaOf(fill) < 0.01) fill = getComputedStyle(svg).color;
    items.push({
      kind: "path",
      d,
      color: fill,
      x: rect.left + tx - vb.x * scaleX,
      y: rect.top + ty - vb.y * scaleY,
      scaleX,
      scaleY,
      // The visible extent of a stretchy glyph is its (possibly clipped) box; KaTeX draws
      // a surd far wider than the slot and lets `overflow:hidden` cut the tail off.
      box: intersect(clip, rect),
      clip: intersect(clip, rect),
    });
    stats.paths++;
  }
}

// ---------------------------------------------------------------- rasterizer

const pathCache = new Map();
function path2d(d) {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (pathCache.size > 200) pathCache.clear();
    pathCache.set(d, p);
  }
  return p;
}

function inkBounds(items) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  if (!metricCtx) metricCtx = document.createElement("canvas").getContext("2d");
  for (const it of items) {
    let l;
    let t;
    let r;
    let b;
    if (it.kind === "text") {
      metricCtx.font = it.font;
      const m = metricCtx.measureText(it.text);
      // actualBoundingBox* is the real ink, not the em box: a row of digits should not
      // reserve descender space it never uses.
      const aL = Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : 0;
      const aR = Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : it.width;
      const aA = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : it.ascent;
      const aD = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : it.descent;
      l = it.x - aL;
      r = it.x + aR;
      t = it.baseline - aA;
      b = it.baseline + aD;
    } else if (it.kind === "rect") {
      l = it.x;
      t = it.y;
      r = it.x + it.w;
      b = it.y + it.h;
    } else {
      const box = it.box;
      if (!box) continue;
      l = box.left;
      t = box.top;
      r = box.right;
      b = box.bottom;
    }
    if (it.clip) {
      l = Math.max(l, it.clip.left);
      t = Math.max(t, it.clip.top);
      r = Math.min(r, it.clip.right);
      b = Math.min(b, it.clip.bottom);
    }
    if (!(r > l) || !(b > t)) continue;
    left = Math.min(left, l);
    top = Math.min(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const rasterStats = { rasters: 0, ms: 0, glyphs: 0, paths: 0, rules: 0, unsupportedSvg: 0, baselineResidual: 0 };

export function rasterStatistics() {
  return { ...rasterStats, ms: Number(rasterStats.ms.toFixed(1)), baselineResidual: Number(rasterStats.baselineResidual.toFixed(3)) };
}

/**
 * Lay one expression out at `fontPx` and paint it onto a fresh canvas.
 * Returns the canvas plus the ink box, so the caller knows the aspect it must give the quad.
 */
export function rasterizeTex(tex, { locale = getLocale(), displayMode = true, fontPx = 256, rim = 0, color = "#ffffff" } = {}) {
  const t0 = performance.now();
  const record = render(tex, { locale, displayMode });

  const h = host();
  h.textContent = "";
  const box = document.createElement("div");
  box.style.cssText = `display:inline-block;font-size:${fontPx}px;line-height:1.2;white-space:nowrap;color:${color};`;
  box.innerHTML = record.html;
  h.appendChild(box);

  const stats = { glyphs: 0, paths: 0, rules: 0, wrapped: 0, unsupportedSvg: 0, baselineResidual: 0 };
  const items = collect(box, stats);
  const ink = inkBounds(items);

  const canvas = document.createElement("canvas");
  if (!ink || ink.width < 1 || ink.height < 1) {
    h.textContent = "";
    canvas.width = 4;
    canvas.height = 4;
    return { canvas, record, ink: { width: 4, height: 4 }, fontPx, stats, ok: false };
  }

  // A little breathing room so antialiasing and the outermost mip level never clip.
  const pad = Math.max(2, Math.round(fontPx * 0.05));
  canvas.width = Math.ceil(ink.width) + pad * 2;
  canvas.height = Math.ceil(ink.height) + pad * 2;
  const ctx = canvas.getContext("2d");
  const ox = ink.left - pad;
  const oy = ink.top - pad;

  const paint = () => {
    for (const it of items) {
      ctx.save();
      if (it.clip && it.clip.width > 0 && it.clip.height > 0) {
        ctx.beginPath();
        ctx.rect(it.clip.left - ox, it.clip.top - oy, it.clip.width, it.clip.height);
        ctx.clip();
      }
      if (it.kind === "text") {
        ctx.font = it.font;
        ctx.fillStyle = it.color;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillText(it.text, it.x - ox, it.baseline - oy);
      } else if (it.kind === "rect") {
        ctx.fillStyle = it.color;
        ctx.fillRect(it.x - ox, it.y - oy, it.w, it.h);
      } else {
        ctx.fillStyle = it.color;
        ctx.translate(it.x - ox, it.y - oy);
        ctx.scale(it.scaleX, it.scaleY);
        ctx.fill(path2d(it.d));
      }
      ctx.restore();
    }
  };

  // `rim` exists for a surface the target does not cover (dark-on-white, a future menu).
  // It is 0 in the world because the target measures 0 there — see the file header.
  if (rim > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(4, 8, 13, ${Math.min(0.85, rim)})`;
    ctx.shadowBlur = pad * 1.2;
    paint();
    ctx.restore();
  }
  paint();

  h.textContent = "";

  rasterStats.rasters++;
  rasterStats.ms += performance.now() - t0;
  rasterStats.glyphs = stats.glyphs;
  rasterStats.paths = stats.paths;
  rasterStats.rules = stats.rules;
  rasterStats.unsupportedSvg += stats.unsupportedSvg;
  rasterStats.baselineResidual = Math.max(rasterStats.baselineResidual, stats.baselineResidual);

  return {
    canvas,
    record,
    ink: { width: ink.width, height: ink.height, pad },
    fontPx,
    stats,
    ok: record.ok,
  };
}

// ---------------------------------------------------------------- the working (plotted axes)

/**
 * "The working" — `world.md` §2.1 rule 5: the trace of how a claim was closed stays standing
 * beside it. Drawn in the same flat white language as the claim, and drawn exactly the way
 * the art target draws it: axes with ticks that cross the line, and a plotted rise that is
 * *quantized into steps* rather than smoothed. The reference's diagonal is a visible
 * staircase; that is the blocky UI idiom of the target, not an artefact, so it is
 * reproduced rather than corrected.
 *
 * No numerals, no axis labels, no function notation — nothing here states a claim, so
 * nothing here needs translating, and it stays clear of curriculum this level does not teach.
 */
export function rasterizeWorking({
  pixels = 512,
  color = "#ffffff",
  xTicks = 10,
  yTicks = 8,
  slope = 0.62,
  intercept = 0.02,
  stroke = 0.016,
  step = 0.0,
} = {}) {
  const size = Math.max(64, Math.round(pixels));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;

  const sw = Math.max(2, Math.round(size * stroke));
  const stepPx = Math.max(sw, Math.round(step > 0 ? size * step : sw * 1.6));
  const pad = Math.round(size * 0.07);
  const ox = pad + sw * 2; // origin
  const oy = size - pad - sw * 2;
  const axisTop = pad;
  const axisRight = size - pad;

  const bar = (x, y, w, h) => ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

  // Axes, with the small overshoot past the origin the target has.
  bar(ox - sw / 2, axisTop, sw, oy - axisTop + sw * 2.4);
  bar(ox - sw * 2.4, oy - sw / 2, axisRight - ox + sw * 2.4, sw);

  // Ticks cross the axis rather than hang off it.
  const tick = Math.round(sw * 2.4);
  const tickW = Math.round(sw * 1.35);
  for (let i = 1; i <= yTicks; i++) {
    const y = oy - ((oy - axisTop) * i) / (yTicks + 0.35);
    bar(ox - tick, y - tickW / 2, tick * 2, tickW);
  }
  for (let i = 1; i <= xTicks; i++) {
    const x = ox + ((axisRight - ox) * i) / (xTicks + 0.35);
    bar(x - tickW / 2, oy - tick, tickW, tick * 2);
  }

  // The rise, as hard steps.
  const x0 = ox;
  const y0 = oy - intercept * (oy - axisTop);
  const x1 = axisRight - sw;
  const y1 = Math.max(axisTop, y0 - slope * (x1 - x0));
  const steps = Math.max(2, Math.round((x1 - x0) / stepPx));
  let prevY = y0;
  for (let i = 0; i < steps; i++) {
    const xa = x0 + ((x1 - x0) * i) / steps;
    const ya = y0 + ((y1 - y0) * (i + 1)) / steps;
    bar(xa, ya, stepPx + sw, sw); // the tread
    if (i > 0) bar(xa, Math.min(prevY, ya), sw, Math.abs(prevY - ya) + sw); // the riser
    prevY = ya;
  }

  return { canvas, ink: { width: size, height: size } };
}

// ---------------------------------------------------------------- the panel

/**
 * The size ladder, and it is fine on purpose.
 *
 * A coarse ladder (64, 96, 128, …) looks harmless and is not, because of how the GPU picks a
 * mip level: it takes `lod = log2(texels per screen pixel)`, and a trilinear filter then
 * *blends* the two levels either side. Overshooting to 1.85 texels per pixel puts lod at 0.89,
 * which is 89% of the way to the half-resolution mip — a visibly soft glyph produced by a
 * perfectly sharp texture. Steps of about 1.12× keep the ratio inside [1.02, 1.15], so lod
 * stays under 0.2 and the sampler sits on mip 0 where the crisp pixels are.
 */
const BUCKETS = [
  48, 54, 60, 68, 76, 86, 96, 108, 120, 136, 152, 172, 192, 216, 240, 272, 304, 344, 384, 432,
  480, 544, 608, 688, 768, 864, 960, 1088, 1216, 1376, 1536, 1728, 1920, 2048,
];
const MAX_TEXTURE_EDGE = 4096;

function bucketFor(needed, aspect) {
  for (const b of BUCKETS) {
    if (b >= needed && b * Math.max(1, aspect) <= MAX_TEXTURE_EDGE) return b;
  }
  // Too wide to grow further: take the largest that still fits.
  for (let i = BUCKETS.length - 1; i >= 0; i--) {
    if (BUCKETS[i] * Math.max(1, aspect) <= MAX_TEXTURE_EDGE) return BUCKETS[i];
  }
  return BUCKETS[0];
}

let panelSeq = 0;

/**
 * One expression standing in world space.
 *
 * `em` is the size control, not the overall height, and that is a deliberate correction of
 * the obvious design. Sizing by total height makes `\frac{1}{2}x = 4` render its glyphs at
 * roughly half the size of `x + 3 = 7` standing next to it, because a fraction spends its
 * height on a numerator, a bar and a denominator. The art target puts both lines at the same
 * glyph size and lets the fraction be physically taller, which is also what a person means
 * by "the same size writing". So `em` is world units per em and the quad's dimensions fall
 * out of the ink.
 */
export class TexPanel {
  constructor({
    id = null,
    tex = "",
    kpId = null,
    locale = getLocale(),
    em = 0.55,
    position = [0, 0, 0],
    anchor = null,
    billboard = "yaw",
    displayMode = true,
    working = null,
    rim = 0,
    fadeIn = 0.45,
  } = {}) {
    this.id = id ?? `claim-${++panelSeq}`;
    this.kpId = kpId;
    this.tex = tex;
    this.locale = locale;
    this.em = em;
    // A view anchor, in metres right / up / ahead of where the player arrives. Level geometry
    // owns socket positions, and until it hands them over, hard world coordinates are a bet on
    // somebody else's terrain — one that this piece has already lost once, when the world was
    // rewritten underneath it and every claim ended up behind the camera.
    this.anchor = anchor;
    this.billboard = billboard;
    this.displayMode = displayMode;
    this.working = working;
    this.rim = rim;
    this.fadeIn = fadeIn;

    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      // ACES would pull pure white down to a grey; the target's ink is 254/255 and stays
      // there. Tone mapping is for the world, not for the notation standing in it.
      toneMapped: false,
      side: THREE.FrontSide,
      opacity: fadeIn > 0 ? 0 : 1,
    });
    this.mesh = new THREE.Mesh(UNIT_PLANE(), this.material);
    this.mesh.position.fromArray(position);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = true;
    this.mesh.name = `tex:${this.id}`;
    this.mesh.userData.vsTex = { id: this.id, kpId };

    this._bucket = 0;
    this._texture = null;
    this._widthPerEm = 4; // refined after the first raster
    this._texPerBucket = 5; // texture width per bucket unit; caps how far we may grow
    this._heightPerEm = 1.2;
    this._cooldown = 0;
    this._age = 0;
    this._emScreenPx = 0;
    this._rasters = 0;
    this._texelsPerPixel = 0;
    this.record = null;
    this.speech = "";
    this.ok = false;
  }

  get object3D() {
    return this.mesh;
  }

  setTex(tex, { kpId } = {}) {
    if (tex === this.tex && kpId === this.kpId) return;
    this.tex = tex;
    if (kpId !== undefined) this.kpId = kpId;
    this._bucket = 0;
    this._cooldown = 0;
  }

  setLocale(locale) {
    if (locale === this.locale) return;
    this.locale = locale;
    this._bucket = 0;
    this._cooldown = 0;
  }

  _rasterize(bucket) {
    // A "working" is square by construction, so its em is its whole side.
    const out = this.working
      ? rasterizeWorking({ ...this.working, pixels: Math.round(bucket * 4) })
      : rasterizeTex(this.tex, {
          locale: this.locale,
          displayMode: this.displayMode,
          fontPx: bucket,
          rim: this.rim,
        });

    const tex = new THREE.CanvasTexture(out.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = MAX_ANISO;
    tex.needsUpdate = true;

    const old = this._texture;
    this._texture = tex;
    this.material.map = tex;
    this.material.needsUpdate = true;
    if (old) old.dispose();

    // One em is `bucket` texels, for a claim and for a working alike — which is what makes a
    // working four ems to a side in the world, matching the target, where the plotted axes
    // stand about four line-heights tall beside the equation.
    const pxPerEm = bucket;
    this._widthPerEm = out.canvas.width / pxPerEm;
    this._heightPerEm = out.canvas.height / pxPerEm;
    this._texPerBucket = out.canvas.width / bucket;
    this._bucket = bucket;
    this._rasters++;
    this.record = out.record ?? null;
    this.ok = this.working ? true : !!out.record?.ok;
    this.speech = out.record?.speech ?? "";
    // One texel of the raster covers exactly one em/bucket of world, so the quad is the ink.
    this.mesh.scale.set(this.em * this._widthPerEm, this.em * this._heightPerEm, 1);
    // The accessible name rides on the object so a HUD or a caption system can read it off
    // the scene graph without going near the source string.
    this.mesh.userData.vsTex = { id: this.id, kpId: this.kpId, speech: this.speech, ok: this.ok };
  }

  /** Called once per rendered frame by the field. */
  update(dt, camera, viewportHeightPx, pixelRatio) {
    this._cooldown -= dt;
    const dist = Math.max(0.001, camera.position.distanceTo(this.mesh.position));
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist) / (viewportHeightPx * pixelRatio);
    // How many device pixels one em covers on screen right now. This, and not the total
    // height, is what decides whether the texture is sharp: it is the size the glyphs are
    // actually being drawn at.
    const needed = this.em / worldPerPx;
    this._emScreenPx = needed;
    this._texelsPerPixel = needed > 0 ? this._bucket / needed : 0;

    const want = Math.max(BUCKETS[0], needed * 1.02);
    if (!this._bucket) {
      this._rasterize(bucketFor(want, this._texPerBucket));
      this._cooldown = 0.4;
    } else if (this._cooldown <= 0) {
      // Hysteresis: grow as soon as the texture would be magnified, shrink only when it is
      // wasting half its resolution. A player walking a circle around a claim must not make
      // it re-lay-out every frame, and the cooldown caps the churn either way.
      const grow = want > this._bucket && this._bucket < BUCKETS.at(-1);
      const shrink = needed * 1.9 < this._bucket && this._bucket > BUCKETS[0];
      if (grow || shrink) {
        const next = bucketFor(want, this._texPerBucket);
        if (next !== this._bucket) {
          this._rasterize(next);
          this._cooldown = 0.5;
        }
      }
    }

    if (this.billboard === "yaw") {
      this.mesh.rotation.set(
        0,
        Math.atan2(camera.position.x - this.mesh.position.x, camera.position.z - this.mesh.position.z),
        0
      );
    } else if (this.billboard === "full") {
      this.mesh.quaternion.copy(camera.quaternion);
    }

    if (this.fadeIn > 0 && this.material.opacity < 1) {
      this._age += dt;
      this.material.opacity = Math.min(1, this._age / this.fadeIn);
    }
  }

  probe() {
    return {
      id: this.id,
      kpId: this.kpId,
      kind: this.working ? "working" : "claim",
      tex: this.working ? null : this.tex,
      ok: this.ok,
      speech: this.speech,
      locale: this.locale,
      em: Number(this.em.toFixed(3)),
      worldSize: [Number(this.mesh.scale.x.toFixed(3)), Number(this.mesh.scale.y.toFixed(3))],
      texturePx: this._bucket,
      textureSize: this._texture ? [this._texture.image.width, this._texture.image.height] : null,
      emScreenPx: Number(this._emScreenPx.toFixed(1)),
      texelsPerPixel: Number(this._texelsPerPixel.toFixed(2)),
      rasters: this._rasters,
      position: this.mesh.position.toArray().map((v) => Number(v.toFixed(2))),
    };
  }

  dispose() {
    this._texture?.dispose();
    this.material.dispose();
  }
}

let unitPlane = null;
function UNIT_PLANE() {
  if (!unitPlane) unitPlane = new THREE.PlaneGeometry(1, 1);
  return unitPlane;
}

let MAX_ANISO = 1;
export function setMaxAnisotropy(value) {
  MAX_ANISO = Math.max(1, value || 1);
}

// ---------------------------------------------------------------- the field

/**
 * The mounted system: a bag of standing claims, a locale, and the two signals the rest of
 * the game uses to put mathematics into the world.
 */
export class TexField {
  constructor(kernel) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "mathtex";
    this.panels = new Map();
    this.locale = getLocale();
    this.viewportHeight = typeof innerHeight === "number" ? innerHeight : 1080;
    this.pixelRatio = kernel?.renderer?.getPixelRatio?.() ?? 1;
    this.driven = false;
    this.anchored = false;
    this.register = null;
  }

  /**
   * A claim painted into a texture is invisible to assistive technology — a canvas has no
   * accessibility tree. So every standing claim also exists as a real `role="math"` element,
   * visually hidden but present to a screen reader, carrying the localized spoken form. It
   * is the same `Tex.renderInto` path a HUD would use, which is why the DOM half of this
   * pipeline is exercised by the shipped game rather than only by a test.
   */
  _register() {
    if (this.register && this.register.isConnected) return this.register;
    const el = document.createElement("div");
    el.id = "vs-claim-register";
    el.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;" +
      "overflow:hidden;clip-path:inset(50%);white-space:nowrap;";
    (document.getElementById("overlay") ?? document.body).appendChild(el);
    this.register = el;
    return el;
  }

  _syncRegister(panel) {
    if (panel.working) return;
    const parent = this._register();
    let el = parent.querySelector(`[data-claim="${CSS.escape(panel.id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.setAttribute("data-claim", panel.id);
      parent.appendChild(el);
    }
    renderInto(el, panel.tex, { locale: panel.locale, displayMode: panel.displayMode });
  }

  add(spec) {
    const existing = this.panels.get(spec.id);
    if (existing) {
      existing.setTex(spec.tex, { kpId: spec.kpId });
      existing.setLocale(spec.locale ?? this.locale);
      this._syncRegister(existing);
      return existing;
    }
    const panel = new TexPanel({ ...spec, locale: spec.locale ?? this.locale });
    this.panels.set(panel.id, panel);
    this.root.add(panel.object3D);
    this._syncRegister(panel);
    return panel;
  }

  remove(id) {
    const panel = this.panels.get(id);
    if (!panel) return false;
    this.root.remove(panel.object3D);
    panel.dispose();
    this.panels.delete(id);
    this.register?.querySelector(`[data-claim="${CSS.escape(id)}"]`)?.remove();
    return true;
  }

  clear() {
    for (const id of [...this.panels.keys()]) this.remove(id);
  }

  setLocale(locale) {
    this.locale = locale;
    for (const panel of this.panels.values()) {
      panel.setLocale(locale);
      this._syncRegister(panel);
    }
  }

  /**
   * Resolve view anchors once the camera rig has settled. Frame 0 is not it — the rig starts
   * at its default and snaps to the player during the first steps — so this waits a quarter
   * of a simulated second, which is deterministic under `advance()` and therefore identical
   * in a review capture and in play.
   */
  _resolveAnchors(camera) {
    if (this.anchored || (this.kernel?.simTime ?? 0) < 0.25) return;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    for (const panel of this.panels.values()) {
      if (!panel.anchor) continue;
      const a = panel.anchor;
      panel.mesh.position
        .copy(camera.position)
        .addScaledVector(fwd, a.forward ?? 12)
        .addScaledVector(right, a.right ?? 0);
      panel.mesh.position.y = camera.position.y + (a.up ?? 0);
      panel.anchor = null;
    }
    this.anchored = true;
  }

  frame(dt) {
    const camera = this.kernel?.camera;
    if (!camera) return;
    this._resolveAnchors(camera);
    const step = Math.min(dt, 0.1);
    for (const panel of this.panels.values()) {
      panel.update(step, camera, this.viewportHeight, this.pixelRatio);
    }
  }

  resize(w, h) {
    this.viewportHeight = h;
    this.pixelRatio = this.kernel?.renderer?.getPixelRatio?.() ?? 1;
    // Force a re-fit at the new resolution rather than waiting for the player to move.
    for (const panel of this.panels.values()) panel._cooldown = 0;
  }

  dispose() {
    this.clear();
    this.register?.remove();
    this.register = null;
  }

  probe() {
    return {
      locale: this.locale,
      driven: this.driven,
      registered: this.register ? this.register.children.length : 0,
      panels: [...this.panels.values()].map((p) => p.probe()),
      fonts: mathFontState(),
      raster: rasterStatistics(),
    };
  }
}
