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
 *
 * ## Staying bounded — and what happens to a claim that will not fit
 *
 * "Size the texture from the ink" is the right idea and, on its own, an unbounded allocation:
 * the ink is a function of the content, so a long enough claim asks for an arbitrarily large
 * canvas and gets it. This file therefore never derives an allocation from content without a
 * cap in front of it. There are seven gates, cheapest first, each bounding a *different*
 * quantity, and the first two live in `Tex.js` because they have to run before this file is
 * reached at all:
 *
 *  1. **Source length** — `Tex.MAX_TEX_LENGTH`, checked before KaTeX runs.
 *  2. **Parse-tree depth** — `Tex.MAX_TEX_DEPTH`, checked between parsing and typesetting,
 *     because a 15-deep nested fraction crashes the renderer during layout and there is no
 *     result left to measure afterwards.
 *  3. **Ink extent, in ems** — `RASTER_CAPS.maxInkEms{Wide,Tall}`, checked after layout.
 *     Bounds the extent of the quad *in ems*, which the raster size does not: a claim scaled
 *     down to fit a texture still stands as many ems wide as it did.
 *  4. **Canvas size** — `RASTER_CAPS.maxEdge` and `maxPixels`, checked before `canvas.width`
 *     is assigned, and then again as an unconditional clamp on the assignment itself. Bounds
 *     the allocation.
 *  5. **World size per em** — `RASTER_CAPS.maxEmWorld`, clamped in the constructor. Gate 3
 *     bounds the claim in ems and `em` is the metres-per-em conversion, so without this the
 *     product is still unbounded: `math:show {tex:'x + 3 = 7', em:100000}` measured a quad of
 *     503776 x 104557 world units. A legible-but-300-metre billboard is not a claim, it is an
 *     attack with better manners, and it is gate 5 and not gate 3 that stops it.
 *  6. **Tick counts on a working** — `RASTER_CAPS.maxWorkingTicks`. `rasterizeWorking`'s
 *     `xTicks`/`yTicks` arrive from the same caller-controlled `math:show` payload the `tex`
 *     does, and they are loop bounds. Measured before the clamp, in the shipped game: 1e4
 *     ticks cost 11 ms, 1e5 cost 99.9 ms and 1e6 cost 2045.1 ms of frozen main thread —
 *     linear, so 1e8 is a ~200 s hang. The `tex` half of that signal was bounded and the
 *     `working` half was not.
 *  7. **Standing panels** — `MAX_PANELS`. Every individual raster can sit inside the cap while
 *     the *field* still breaks the frame budget: 400 distinct `math:show` ids measured 407
 *     panels, 32.3 MiB of texels, 408 textures and 494 draw calls, against
 *     `design/architecture.md`'s ceiling of 320 draw calls and 120 textures.
 *
 * Gate 4 first tries to **scale down**: re-lay the same expression out at a smaller font so
 * the whole of it survives at lower texel density. Only if even `minFontPx` will not fit does
 * it **refuse**, and refusing means the same hollow stand-in a malformed claim gets, plus a
 * line in `__vs.errors`.
 *
 * It does not truncate, and that is a deliberate rejection of the obvious option. Half of
 * `2x + 14 = 30` is `2x + 1`, which is not a fragment — it is a well-formed and *false*
 * statement, and a player who acts on it has been lied to by the renderer. A visible cut
 * marker does not fix that, because the claim is still readable and still wrong. So an
 * expression this pipeline cannot draw whole is one it declines to draw at all.
 *
 * In the shipped game the caps have roughly 35x headroom and never bite: the four standing
 * claims rasterize to 323x65, 239x164, 256x256 and 359x69 at 1600x900 (measured, see
 * `review/measure/P15.mjs` claim H6). Gates 3 and 4 exist for content that does not exist yet
 * and for anything that ever reaches `math:show` from outside this piece.
 *
 * ## The eighth way to truncate a claim: the world in front of it
 *
 * Seven gates make sure this pipeline never draws a fragment of a claim, and for one round
 * the compositor cheerfully did it anyway. In the shipped spawn frame, 26.9% of
 * `leaf9-share`'s ink was cut away by the avatar's arm and a rock spire — the entire
 * `\frac{1}{2}` denominator and two thirds of the fraction bar — so `\frac{1}{2}x = 4` read
 * on screen as `1 ⁻ x = 4`. The material was `depthTest:true` by default, and nothing in the
 * process knew or said so.
 *
 * Two things changed, and both were needed:
 *
 *  - **`depthTest:false`, with the existing `renderOrder = 5`.** Mathematics floats in front,
 *    which is the target's reading of ink standing unadorned in world space, and which makes
 *    "a claim is drawn whole or not at all" a property of the renderer rather than a hope
 *    about level layout. The alternative — keep depth and test occlusion every frame — was
 *    measured and rejected: a camera-to-ink ray against the shipped scene costs 1.20 ms
 *    (140 rays, 50 depth-writing meshes, 33.8k triangles), so a 35-sample check per panel is
 *    a 170 ms stall. That is not a per-frame budget; it is a probe.
 *  - **`occludedPct`, published per panel from `probe()`.** Floating in front hides bad
 *    placement rather than fixing it, so the placement is measured anyway, geometrically and
 *    independently of what the depth buffer did: rays from the camera to ink-weighted points
 *    on the quad, against every mesh in the scene that writes depth. `review/measure/P15.mjs`
 *    claim O1 fails the run if any standing claim reads above 0. A capture with a claim
 *    standing behind a spire now fails a gate instead of being signed off by eye.
 */
import * as THREE from "three";
import { introspect } from "../core/Introspect.js";
import { render, applyRecord, getLocale, refusedRecord } from "./Tex.js";

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

/**
 * The allocation ceiling, in one place so a reviewer can assert against the same numbers the
 * code enforces.
 *
 * `maxEdge` is 4096 because that is the texture edge every WebGL2 implementation this game
 * targets supports, and because the size ladder was already written against it. `maxPixels`
 * is 2048² — 16 MiB of RGBA — and is the tighter of the two for anything large in both axes;
 * a 4096² canvas would be 64 MiB for one claim, which is not a bound worth calling a bound.
 * `minFontPx` is where scaling-down gives up and refusal takes over.
 *
 * `maxEmWorld` is 4 metres per em, which is a claim about eight metres tall standing at the
 * cap — large enough for anything a level could want written on a cliff, and 25,000x smaller
 * than the 100,000 an unclamped `math:show` was measured producing. `minEmWorld` is 0.02 so a
 * zero or negative `em` cannot collapse a quad to nothing or invert it. `maxWorkingTicks`
 * bounds the two loops in `rasterizeWorking`; 64 ticks on a 4-em axis is already an
 * unreadable comb, so the cap costs the art nothing.
 */
export const RASTER_CAPS = Object.freeze({
  maxEdge: 4096,
  maxPixels: 2048 * 2048,
  maxInkEmsWide: 48,
  maxInkEmsTall: 24,
  minFontPx: 8,
  maxEmWorld: 4,
  minEmWorld: 0.02,
  maxWorkingTicks: 64,
});

/**
 * Every caller-controlled number in this file goes through here before it is used as a loop
 * bound, an allocation or a world size. `Number()` first so a string "1e9" is a number and not
 * a silently-passing NaN, and `Number.isFinite` so NaN and ±Infinity land on the fallback
 * instead of poisoning the arithmetic downstream.
 */
function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

const rasterStats = {
  rasters: 0,
  ms: 0,
  glyphs: 0,
  paths: 0,
  rules: 0,
  unsupportedSvg: 0,
  baselineResidual: 0,
  // The bound, as a measurement rather than a promise: the largest canvas this process has
  // ever allocated, and how many rasters had to be scaled down or refused to keep it there.
  maxCanvasWidth: 0,
  maxCanvasHeight: 0,
  maxCanvasPixels: 0,
  scaledDown: 0,
  refusedGeometry: 0,
};

export function rasterStatistics() {
  return {
    ...rasterStats,
    ms: Number(rasterStats.ms.toFixed(1)),
    baselineResidual: Number(rasterStats.baselineResidual.toFixed(3)),
    caps: { ...RASTER_CAPS },
  };
}

const padFor = (fontPx) => Math.max(2, Math.round(fontPx * 0.05));

/** The canvas this ink would need at this font size, before any cap is applied. */
function canvasSizeFor(ink, fontPx) {
  const pad = padFor(fontPx);
  return { w: Math.ceil(ink.width) + pad * 2, h: Math.ceil(ink.height) + pad * 2 };
}

/** 1 when it already fits; otherwise the factor the font must be multiplied by so it does. */
function fitScale(ink, fontPx) {
  const { w, h } = canvasSizeFor(ink, fontPx);
  if (w <= 0 || h <= 0) return 1;
  return Math.min(
    1,
    RASTER_CAPS.maxEdge / w,
    RASTER_CAPS.maxEdge / h,
    Math.sqrt(RASTER_CAPS.maxPixels / (w * h))
  );
}

/**
 * Lay one already-typeset expression out in the hidden host at a chosen pixel size and turn
 * it into paint instructions. Separated out because the cap may need to run it twice, at two
 * font sizes, and doing that by hand in two places is how the second one drifts.
 */
function attachTex(html, fontPx, color) {
  const h = host();
  h.textContent = "";
  const box = document.createElement("div");
  box.style.cssText = `display:inline-block;font-size:${fontPx}px;line-height:1.2;white-space:nowrap;color:${color};`;
  box.innerHTML = html;
  h.appendChild(box);
  return box;
}

function collectFrom(box) {
  const stats = { glyphs: 0, paths: 0, rules: 0, wrapped: 0, unsupportedSvg: 0, baselineResidual: 0 };
  const items = collect(box, stats);
  return { items, ink: inkBounds(items), stats };
}

function layoutTex(html, fontPx, color) {
  return collectFrom(attachTex(html, fontPx, color));
}

// A refusal is pushed to `__vs.errors` once per (locale, reason, source) and not once per
// size bucket: a panel that re-rasterizes as the player walks toward it must not turn one
// bad claim into an unbounded error log.
const reportedRefusals = new Set();

/** Gate 3, as a pure test, so the panel and the accessible register apply the same one. */
function extentBound(emsWide, emsTall) {
  if (emsWide <= RASTER_CAPS.maxInkEmsWide && emsTall <= RASTER_CAPS.maxInkEmsTall) return null;
  return {
    reason: "ink-extent",
    emsWide: Number(emsWide.toFixed(1)),
    emsTall: Number(emsTall.toFixed(1)),
  };
}

function extentError(bound) {
  return (
    `claim geometry out of bounds: ${bound.emsWide.toFixed(1)}x${bound.emsTall.toFixed(1)} ems, cap ` +
    `${RASTER_CAPS.maxInkEmsWide}x${RASTER_CAPS.maxInkEmsTall}`
  );
}

function refuseOnce(tex, locale, displayMode, error) {
  const key = `${locale}|${error}|${String(tex).slice(0, 80)}`;
  const first = !reportedRefusals.has(key);
  if (first) {
    if (reportedRefusals.size > 200) reportedRefusals.clear();
    reportedRefusals.add(key);
  }
  return refusedRecord(tex, { locale, displayMode, error, report: first });
}

/**
 * Lay one expression out at `fontPx` and paint it onto a fresh canvas.
 * Returns the canvas plus the ink box, so the caller knows the aspect it must give the quad.
 */
export function rasterizeTex(tex, { locale = getLocale(), displayMode = true, fontPx = 256, rim = 0, color = "#ffffff" } = {}) {
  const t0 = performance.now();
  // Gates 1 and 2 already ran: an over-length or over-deep source never reaches a layout,
  // because `render` refused it and handed back the stand-in instead.
  let record = render(tex, { locale, displayMode });

  let usedFontPx = Math.max(RASTER_CAPS.minFontPx, Math.round(fontPx) || RASTER_CAPS.minFontPx);
  let box = attachTex(record.html, usedFontPx, color);
  let bound = null;

  // Gate 3 — the extent of the laid-out box in ems, which the raster size does not bound.
  // This is what keeps a claim from standing hundreds of metres wide in the world.
  //
  // Measured on the *box* and not on the collected ink, and that is a performance decision
  // with a number behind it. Collecting the ink means a `getComputedStyle` and a
  // `getBoundingClientRect` for every node, and the whole point of a hostile claim is that it
  // has a lot of nodes: gating after the walk cost 554 ms on the 1,881-character attack, which
  // is a visible stall rather than a hitch. The box is one rect read, it is a superset of the
  // ink by construction, and at a cap of 48 ems against real content of 14 the difference
  // between the two never decides anything.
  {
    const r = box.getBoundingClientRect();
    bound = extentBound(r.width / usedFontPx, r.height / usedFontPx);
    if (bound) {
      rasterStats.refusedGeometry++;
      record = refuseOnce(tex, record.locale, displayMode, extentError(bound));
      box = attachTex(record.html, usedFontPx, color);
    }
  }

  let pass = collectFrom(box);

  // Gate 4 — the allocation. Scale down first so the whole expression survives; refuse only
  // when even `minFontPx` will not fit it. Never truncate: see the file header.
  if (pass.ink) {
    if (fitScale(pass.ink, usedFontPx) < 1) {
      const fromFontPx = usedFontPx;
      // Iterated, not one-shot: the padding is a fixed fraction of the font so the shrink is
      // very nearly linear, but "very nearly" lands a few pixels over the edge often enough
      // that a single pass would refuse claims it should have fitted. Bounded at three.
      for (let attempt = 0; attempt < 3 && fitScale(pass.ink, usedFontPx) < 1; attempt++) {
        const next = Math.max(RASTER_CAPS.minFontPx, Math.floor(usedFontPx * fitScale(pass.ink, usedFontPx)));
        if (next >= usedFontPx) break;
        const retry = layoutTex(record.html, next, color);
        if (!retry.ink) break;
        usedFontPx = next;
        pass = retry;
      }
      if (usedFontPx < fromFontPx) {
        bound = { reason: "scaled", fromFontPx, toFontPx: usedFontPx };
        rasterStats.scaledDown++;
      }
      if (fitScale(pass.ink, usedFontPx) < 1) {
        const { w, h } = canvasSizeFor(pass.ink, usedFontPx);
        bound = { reason: "raster-size", wantedWidth: w, wantedHeight: h };
        rasterStats.refusedGeometry++;
        record = refuseOnce(
          tex,
          record.locale,
          displayMode,
          `raster out of bounds: ${w}x${h} px at the smallest legible size, cap ` +
            `${RASTER_CAPS.maxEdge} per axis / ${RASTER_CAPS.maxPixels} total`
        );
        pass = layoutTex(record.html, usedFontPx, color);
      }
    }
  }

  const { items, ink, stats } = pass;
  const canvas = document.createElement("canvas");
  if (!ink || ink.width < 1 || ink.height < 1) {
    host().textContent = "";
    canvas.width = 4;
    canvas.height = 4;
    noteCanvas(canvas);
    return {
      canvas,
      record,
      ink: { width: 4, height: 4 },
      fontPx: usedFontPx,
      emsWide: 4 / usedFontPx,
      emsTall: 4 / usedFontPx,
      stats,
      bound,
      ok: false,
    };
  }

  // A little breathing room so antialiasing and the outermost mip level never clip.
  const pad = padFor(usedFontPx);
  // The unconditional clamp. Everything above should have made it a no-op, and it is written
  // anyway: this is the one line that has to be true for the allocation to be bounded, so it
  // does not depend on the reasoning above being right.
  const want = canvasSizeFor(ink, usedFontPx);
  let cw = Math.min(want.w, RASTER_CAPS.maxEdge);
  let ch = Math.min(want.h, RASTER_CAPS.maxEdge);
  if (cw * ch > RASTER_CAPS.maxPixels) {
    const s = Math.sqrt(RASTER_CAPS.maxPixels / (cw * ch));
    cw = Math.max(4, Math.floor(cw * s));
    ch = Math.max(4, Math.floor(ch * s));
  }
  canvas.width = cw;
  canvas.height = ch;
  noteCanvas(canvas);
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

  host().textContent = "";

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
    // The font size actually used, which is not the one asked for when gate 3 scaled it down.
    // The panel sizes its quad from this, so a scaled raster still stands the right size in
    // the world and still reports an honest texels-per-pixel.
    fontPx: usedFontPx,
    // The ink measured in ems, which is scale-free: this is what the size ladder needs in
    // order to pick a bucket whose canvas fits, rather than discovering it afterwards.
    emsWide: (Math.ceil(ink.width) + pad * 2) / usedFontPx,
    emsTall: (Math.ceil(ink.height) + pad * 2) / usedFontPx,
    stats,
    bound,
    ok: record.ok,
  };
}

/**
 * The record a claim is going to get, decided before anything is drawn.
 *
 * This exists because of a divergence a critic read straight out of the live DOM. A
 * 2,000-character claim that the world refuses on ink extent — `bound {reason:'ink-extent',
 * emsWide:2082.8}`, hollow stand-in shown, source withheld — still had its full spoken form,
 * `"1 plus 1 plus 1 plus…"`, sitting in the accessible register, because the register was
 * built from `Tex.render` alone and `render` only knows gates 1 and 2. `Tex.js`'s own opening
 * promise is that the screen-reader user receives exactly what the sighted player receives.
 * A claim refused for its geometry and read aloud in full is that promise broken.
 *
 * So the extent gate moves in front of both consumers, and both ask this. It is measured at a
 * fixed `GATE_FONT_PX` because ems are scale-free, and cached on (locale, mode, source),
 * because a field re-syncing its register on a locale change must not re-lay-out every claim.
 */
const GATE_FONT_PX = 64;
const extentDecisions = new Map();

export function resolveRecord(tex, { locale = getLocale(), displayMode = true } = {}) {
  const record = render(tex, { locale, displayMode });
  // Gates 1 and 2 already refused it; there is nothing left to lay out.
  if (!record.ok) return record;
  const src = String(tex ?? "");
  const key = `${record.locale}|${displayMode ? "d" : "i"}|${src.length}|${src.slice(0, 160)}`;
  let ems = extentDecisions.get(key);
  if (!ems) {
    const r = attachTex(record.html, GATE_FONT_PX, "#ffffff").getBoundingClientRect();
    ems = { wide: r.width / GATE_FONT_PX, tall: r.height / GATE_FONT_PX };
    host().textContent = "";
    if (extentDecisions.size > 400) extentDecisions.clear();
    extentDecisions.set(key, ems);
  }
  const bound = extentBound(ems.wide, ems.tall);
  if (!bound) return record;
  return refuseOnce(tex, record.locale, displayMode, extentError(bound));
}

/** Record the largest canvas this process has ever allocated, so the cap is measurable. */
function noteCanvas(canvas) {
  rasterStats.maxCanvasWidth = Math.max(rasterStats.maxCanvasWidth, canvas.width);
  rasterStats.maxCanvasHeight = Math.max(rasterStats.maxCanvasHeight, canvas.height);
  rasterStats.maxCanvasPixels = Math.max(rasterStats.maxCanvasPixels, canvas.width * canvas.height);
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
  xTicks: xTicksIn = 10,
  yTicks: yTicksIn = 8,
  slope: slopeIn = 0.62,
  intercept: interceptIn = 0.02,
  stroke: strokeIn = 0.016,
  step: stepIn = 0.0,
} = {}) {
  // Every one of these arrives from the caller-controlled `working` half of a `math:show`
  // payload, and the two tick counts are loop bounds. `pixels` was clamped and they were not,
  // which made the same public signal that cannot allocate an unbounded canvas able to spin
  // an unbounded loop instead: 1e6 ticks measured 2045.1 ms of frozen main thread.
  const xTicks = Math.round(clampNum(xTicksIn, 0, RASTER_CAPS.maxWorkingTicks, 10));
  const yTicks = Math.round(clampNum(yTicksIn, 0, RASTER_CAPS.maxWorkingTicks, 8));
  // The rest cannot hang the loop, but they can push every rectangle off the canvas and leave
  // a blank square that looks like a broken raster rather than a bad argument.
  const slope = clampNum(slopeIn, -8, 8, 0.62);
  const intercept = clampNum(interceptIn, -1, 1, 0.02);
  const stroke = clampNum(strokeIn, 0.002, 0.2, 0.016);
  const step = clampNum(stepIn, 0, 1, 0);
  // Square by construction, so the area cap binds before the edge cap does: 2048² is the
  // largest working this may allocate however large a `pixels` a caller asks for.
  const squareCap = Math.min(RASTER_CAPS.maxEdge, Math.floor(Math.sqrt(RASTER_CAPS.maxPixels)));
  const size = Math.min(squareCap, Math.max(64, Math.round(clampNum(pixels, 64, squareCap, 512))));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  noteCanvas(canvas);
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

  // `fontPx` here is the working's own em — it is four ems to a side by definition — so a
  // clamped working still reports the right world size and the right texels-per-pixel.
  return { canvas, ink: { width: size, height: size }, fontPx: size / 4, emsWide: 4, emsTall: 4 };
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
/**
 * Pick the smallest bucket that is sharp enough *and* whose canvas is inside the cap.
 *
 * `emsWide`/`emsTall` are the ink's extent in ems, which is what makes this checkable up
 * front: a bucket of `b` texels per em produces a `b·emsWide` by `b·emsTall` canvas. Doing
 * the arithmetic here rather than letting `rasterizeTex` clamp afterwards is the difference
 * between a ladder that never asks for something it cannot have and one that keeps asking and
 * keeps being refused.
 */
function bucketFor(needed, emsWide, emsTall) {
  const w = Math.max(1, emsWide || 1);
  const h = Math.max(1, emsTall || 1);
  const fits = (b) =>
    b * w <= RASTER_CAPS.maxEdge && b * h <= RASTER_CAPS.maxEdge && b * w * b * h <= RASTER_CAPS.maxPixels;
  for (const b of BUCKETS) if (b >= needed && fits(b)) return b;
  // Too big to grow further: take the largest that still fits.
  for (let i = BUCKETS.length - 1; i >= 0; i--) if (fits(BUCKETS[i])) return BUCKETS[i];
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
    // Gate 5. `em` is world metres per em and it arrives from `math:show` like everything
    // else here, so the quad's world size is `em` times an ems extent that gate 3 bounds —
    // a product, and a product with one unbounded factor is unbounded. Unclamped, an
    // `em:100000` was measured standing 503,776 x 104,557 metres.
    this.em = clampNum(em, RASTER_CAPS.minEmWorld, RASTER_CAPS.maxEmWorld, 0.55);
    this.emRequested = Number(em);
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
      // A depth-tested claim is a claim any nearer mesh may amputate mid-glyph, and half of
      // `\frac{1}{2}x = 4` is `1 ⁻ x = 4` — well-formed, false, and drawn by us. Seven gates
      // in this file exist so the rasterizer can never do that; this is the line that stops
      // the compositor doing it instead. See the file header.
      depthTest: false,
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
    this._fontPx = 0; // the size actually rasterized at; differs from the bucket only if capped
    this._texture = null;
    this._widthPerEm = 4; // refined after the first raster
    // The ink's extent in ems, which is what tells the ladder how far it may grow. Seeded with
    // a typical two-line claim and replaced by the measurement after the first raster.
    this._emsWide = 5;
    this._emsTall = 1.4;
    this._heightPerEm = 1.2;
    this._bound = null;
    this._cooldown = 0;
    this._age = 0;
    this._emScreenPx = 0;
    this._rasters = 0;
    this._texelsPerPixel = 0;
    // The occlusion measurement, filled in by `measureOcclusion`; null until something asks.
    this._occlusion = null;
    this._inkSamples = null;
    this._inkSamplesAt = -1;
    this.record = null;
    this.speech = "";
    this.ok = false;
    this._resolve();
  }

  get object3D() {
    return this.mesh;
  }

  /**
   * Decide what this claim *is* before it is ever drawn, so the world, the spoken form and the
   * accessible register cannot disagree about it. A working states nothing, so it has no
   * record and nothing to say.
   */
  _resolve() {
    if (this.working) {
      this.record = null;
      this.ok = true;
      this.speech = "";
      return;
    }
    this.record = resolveRecord(this.tex, { locale: this.locale, displayMode: this.displayMode });
    this.ok = this.record.ok;
    this.speech = this.record.speech;
    this.mesh.userData.vsTex = { id: this.id, kpId: this.kpId, speech: this.speech, ok: this.ok };
  }

  setTex(tex, { kpId } = {}) {
    if (tex === this.tex && kpId === this.kpId) return;
    this.tex = tex;
    if (kpId !== undefined) this.kpId = kpId;
    this._bucket = 0;
    this._cooldown = 0;
    this._resolve();
  }

  setLocale(locale) {
    if (locale === this.locale) return;
    this.locale = locale;
    this._bucket = 0;
    this._cooldown = 0;
    this._resolve();
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

    // One em is `fontPx` texels, for a claim and for a working alike — which is what makes a
    // working four ems to a side in the world, matching the target, where the plotted axes
    // stand about four line-heights tall beside the equation. `out.fontPx` and not `bucket`,
    // because a capped raster was laid out smaller than it was asked for and the quad has to
    // follow the ink, not the request.
    const pxPerEm = out.fontPx || bucket;
    this._widthPerEm = out.canvas.width / pxPerEm;
    this._heightPerEm = out.canvas.height / pxPerEm;
    this._emsWide = out.emsWide || this._widthPerEm;
    this._emsTall = out.emsTall || this._heightPerEm;
    this._bound = out.bound ?? null;
    this._fontPx = pxPerEm;
    this._bucket = bucket;
    this._rasters++;
    // `_resolve` already ran every gate this claim can meet, so this normally confirms what
    // the panel and its register already agree on. If it ever does not — a raster-size
    // refusal, which H7 argues is unreachable while the ink gate holds — the register is told,
    // rather than being left describing a claim the world stopped showing.
    const rec = out.record ?? null;
    const changed = !this.working && rec && (rec.ok !== this.ok || rec.speech !== this.speech);
    this.record = this.working ? null : rec;
    this.ok = this.working ? true : !!rec?.ok;
    this.speech = rec?.speech ?? "";
    if (changed) this.onRecord?.(this);
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
    // Measured against the size the texture was really laid out at, so a capped raster reports
    // itself as the softer thing it is rather than as the bucket it was denied.
    this._texelsPerPixel = needed > 0 ? (this._fontPx || this._bucket) / needed : 0;

    const want = Math.max(BUCKETS[0], needed * 1.02);
    if (!this._bucket) {
      this._rasterize(bucketFor(want, this._emsWide, this._emsTall));
      this._cooldown = 0.4;
    } else if (this._cooldown <= 0) {
      // Hysteresis: grow as soon as the texture would be magnified, shrink only when it is
      // wasting half its resolution. A player walking a circle around a claim must not make
      // it re-lay-out every frame, and the cooldown caps the churn either way.
      const grow = want > this._bucket && this._bucket < BUCKETS.at(-1);
      const shrink = needed * 1.9 < this._bucket && this._bucket > BUCKETS[0];
      if (grow || shrink) {
        const next = bucketFor(want, this._emsWide, this._emsTall);
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

  /**
   * Where the ink actually is on this quad, as points in local space.
   *
   * The claim is white on transparent, so the alpha channel *is* the ink. The texture is
   * downsampled into a small fixed grid once per raster — `drawImage` into a 24x12 canvas,
   * one `getImageData` of 288 pixels, rather than reading back up to 16 MiB — and the cells
   * that carry ink become the sample set. Ink-weighted and not uniform on purpose: a claim is
   * mostly empty quad, and "40% of the rectangle is behind a rock" says nothing about whether
   * the mathematics is readable. The critic's pixel measurement counted ink; so does this.
   *
   * The threshold is relative to the strongest cell rather than absolute, because a thin
   * glyph downsampled a hundred to one covers a cell far below any fixed alpha you would pick.
   */
  _samplePoints() {
    if (this._inkSamples && this._inkSamplesAt === this._rasters) return this._inkSamples;
    const img = this._texture?.image;
    if (!img || !img.width || !img.height) return null;
    const out = [];
    try {
      const c = inkScratch();
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, INK_GRID_W, INK_GRID_H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(img, 0, 0, INK_GRID_W, INK_GRID_H);
      const px = ctx.getImageData(0, 0, INK_GRID_W, INK_GRID_H).data;
      let peak = 0;
      for (let i = 3; i < px.length; i += 4) peak = Math.max(peak, px[i]);
      const floor = Math.max(4, peak * 0.25);
      for (let y = 0; y < INK_GRID_H; y++) {
        for (let x = 0; x < INK_GRID_W; x++) {
          if (px[(y * INK_GRID_W + x) * 4 + 3] < floor) continue;
          // Local space on a unit plane: +x right, +y up, and the texture's y runs down.
          out.push([(x + 0.5) / INK_GRID_W - 0.5, 0.5 - (y + 0.5) / INK_GRID_H]);
        }
      }
    } catch {
      // A tainted or zero-sized canvas: fall through to the uniform grid below rather than
      // reporting "no occlusion" for a claim nobody measured.
    }
    let points = out;
    if (!points.length) {
      points = [];
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) points.push([(x + 0.5) / 7 - 0.5, (y + 0.5) / 5 - 0.5]);
      }
    }
    // Bounded work per probe: an even stride through the ink cells, never more than the cap.
    if (points.length > MAX_OCCLUSION_SAMPLES) {
      const stride = points.length / MAX_OCCLUSION_SAMPLES;
      const thinned = [];
      for (let i = 0; i < MAX_OCCLUSION_SAMPLES; i++) thinned.push(points[Math.floor(i * stride)]);
      points = thinned;
    }
    this._inkSamples = points;
    this._inkSamplesAt = this._rasters;
    return points;
  }

  /**
   * How much of this claim's ink has world geometry in front of it, in percent.
   *
   * Geometric and not pixel-based, which matters: the material is `depthTest:false`, so the
   * depth buffer no longer eats a badly-placed claim and a pixel diff would read 0 whatever
   * the level did. This asks the question the depth buffer stopped asking — is there anything
   * between the camera and the mathematics — and answers it in the shipped scene.
   *
   * Called from `probe()` and never from `frame()`. Measured on this machine, in the shipped
   * spawn scene: 1.20 ms per ray against 50 depth-writing meshes and 33.8k triangles. That is
   * a measuring instrument, not a frame budget, and pretending otherwise is how a piece ships
   * a 170 ms stall to buy a number nobody reads during play.
   */
  measureOcclusion(camera, occluders, raycaster) {
    const points = this._samplePoints();
    if (!points || !points.length || !occluders.length) {
      this._occlusion = null;
      return null;
    }
    this.mesh.updateMatrixWorld(true);
    // Cull once per panel instead of once per ray. Every ray in this loop runs down the same
    // short corridor — from the camera to a quad a few metres across — so a mesh whose
    // bounding sphere misses that corridor cannot be hit by any of them. `design/
    // architecture.md` requires probes to be cheap, and a ray against all 50 depth-writing
    // meshes in the spawn scene costs 1.20 ms where a ray against the handful that are
    // actually near the corridor costs a fraction of that.
    const centre = _v3c.copy(this.mesh.position);
    const reach = 0.5 * Math.hypot(this.mesh.scale.x, this.mesh.scale.y);
    const near = [];
    for (const o of occluders) {
      if (distanceToSegment(o.c, camera.position, centre) <= o.r + reach) near.push(o.obj);
    }
    if (!near.length) {
      this._occlusion = { pct: 0, blocked: 0, samples: points.length };
      return this._occlusion;
    }
    const p = _v3a;
    const dir = _v3b;
    let blocked = 0;
    for (const [lx, ly] of points) {
      p.set(lx, ly, 0);
      this.mesh.localToWorld(p);
      dir.copy(p).sub(camera.position);
      const dist = dir.length();
      if (dist < 0.05) continue;
      raycaster.set(camera.position, dir.divideScalar(dist));
      raycaster.near = 0.01;
      // Stop short of the quad itself so a mesh coplanar with it is not counted as in front.
      raycaster.far = dist - 0.02;
      if (raycaster.intersectObjects(near, false).length) blocked++;
    }
    this._occlusion = {
      pct: Number(((blocked / points.length) * 100).toFixed(1)),
      blocked,
      samples: points.length,
      candidates: near.length,
    };
    return this._occlusion;
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
      // What the caller asked for, beside what gate 5 allowed, so a clamped `em` is visible
      // rather than silently different from the payload that produced it.
      emRequested: Number.isFinite(this.emRequested) ? this.emRequested : null,
      emClamped: Number.isFinite(this.emRequested) ? this.emRequested !== this.em : true,
      // The share of this claim's ink with world geometry in front of it, as of the last
      // measurement. `null` means nothing has measured it yet — never read that as zero.
      occludedPct: this._occlusion ? this._occlusion.pct : null,
      occlusionSamples: this._occlusion ? this._occlusion.samples : 0,
      depthTest: this.material.depthTest,
      worldSize: [Number(this.mesh.scale.x.toFixed(3)), Number(this.mesh.scale.y.toFixed(3))],
      texturePx: this._bucket,
      fontPx: this._fontPx,
      textureSize: this._texture ? [this._texture.image.width, this._texture.image.height] : null,
      // null in normal play; names the gate when a claim's geometry had to be bounded.
      bound: this._bound,
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

// The occlusion probe's working set. Module-level and reused: a measurement that allocates
// per sample is a measurement that changes what it is measuring.
const INK_GRID_W = 24;
const INK_GRID_H = 12;
const MAX_OCCLUSION_SAMPLES = 24;
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v3d = new THREE.Vector3();
const _v3e = new THREE.Vector3();

/** Shortest distance from a point to the segment [a,b]. Used to cull the occlusion probe. */
function distanceToSegment(p, a, b) {
  const ab = _v3d.copy(b).sub(a);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _v3e.copy(p).sub(a).dot(ab) / len2)) : 0;
  return _v3e.copy(a).addScaledVector(ab, t).distanceTo(p);
}
let inkScratchCanvas = null;
function inkScratch() {
  if (!inkScratchCanvas) {
    inkScratchCanvas = document.createElement("canvas");
    inkScratchCanvas.width = INK_GRID_W;
    inkScratchCanvas.height = INK_GRID_H;
  }
  return inkScratchCanvas;
}

let MAX_ANISO = 1;
export function setMaxAnisotropy(value) {
  MAX_ANISO = Math.max(1, value || 1);
}

// ---------------------------------------------------------------- the field

/**
 * The most claims that may stand at once. Gate 7 — see the file header. Thirty-two is roughly
 * ten times the densest authored scene (Leaf Nine stands four) and leaves the field's whole
 * contribution to the frame at 32 draw calls and 32 textures against
 * `design/architecture.md`'s 320 and 120.
 */
export const MAX_PANELS = 32;

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
    this._shownSeq = 0;
    this.evictions = 0;
    this._warnedEvictions = false;
    this._raycaster = new THREE.Raycaster();
    this._occlusionAt = -Infinity;
    this._occlusionMs = 0;
    this._occluderCount = 0;
  }

  /**
   * A claim painted into a texture is invisible to assistive technology — a canvas has no
   * accessibility tree. So every standing claim also exists as a real `role="math"` element,
   * visually hidden but present to a screen reader, carrying the localized spoken form. It
   * is the same `Tex.applyRecord` path a HUD would use, which is why the DOM half of this
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

  /**
   * The register entry for a panel is written from *the panel's own record*, which is the
   * record the world is showing — never from the source string again. `TexPanel._resolve`
   * runs every gate this pipeline has before the panel is even added, so a claim refused for
   * its geometry says "unreadable claim" here exactly as it does in the world, and a claim
   * that stands says what it stands for.
   */
  _syncRegister(panel) {
    if (panel.working || !panel.record) return;
    const parent = this._register();
    let el = parent.querySelector(`[data-claim="${CSS.escape(panel.id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.setAttribute("data-claim", panel.id);
      parent.appendChild(el);
    }
    applyRecord(el, panel.record);
  }

  add(spec) {
    const existing = this.panels.get(spec.id);
    if (existing) {
      existing.setTex(spec.tex, { kpId: spec.kpId });
      existing.setLocale(spec.locale ?? this.locale);
      existing.shownAt = ++this._shownSeq;
      this._syncRegister(existing);
      return existing;
    }
    // Gate 7. Every raster can be inside its own cap while the field as a whole is not:
    // 400 ids measured 407 panels, 408 GPU textures and 494 draw calls against
    // `design/architecture.md`'s 120 and 320. A standing claim is a thing the player reads,
    // and thirty-two unread claims are not a teaching surface, they are a leak — so the
    // least-recently-shown one stands down to make room, the same stand-down a learning
    // engine taking over the field performs.
    while (this.panels.size >= MAX_PANELS) {
      let oldest = null;
      for (const p of this.panels.values()) if (!oldest || p.shownAt < oldest.shownAt) oldest = p;
      if (!oldest) break;
      this.evictions++;
      this.remove(oldest.id);
    }
    const panel = new TexPanel({ ...spec, locale: spec.locale ?? this.locale });
    panel.shownAt = ++this._shownSeq;
    panel.onRecord = (p) => this._syncRegister(p);
    this.panels.set(panel.id, panel);
    this.root.add(panel.object3D);
    this._syncRegister(panel);
    // Warned once, not thrown and not once per eviction: dropping a claim is a level-design
    // or content bug worth a line in the report, and a warning per drop would be the same
    // unbounded growth one function up. The running total lives in `probe().evictions`.
    if (this.evictions && !this._warnedEvictions) {
      this._warnedEvictions = true;
      introspect.warnings.push(
        `math: the field stands at most ${MAX_PANELS} claims at once; the least-recently-shown claim stood down to make room (see probe evictions)`
      );
    }
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

  /**
   * Everything in the scene that could stand between the camera and a claim: a mesh that is
   * visible and writes depth. A mesh with `depthWrite:false` cannot amputate a depth-tested
   * claim and is not counted — which is the same criterion the depth buffer itself uses, so
   * the number means what a reader of it will assume it means. Our own quads are excluded,
   * since a claim occluding a claim is a layout question, not a world one.
   */
  _occluders() {
    const scene = this.kernel?.scene;
    if (!scene) return [];
    scene.updateMatrixWorld();
    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (typeof o.name === "string" && o.name.startsWith("tex:")) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.depthWrite === false || m.colorWrite === false) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      // Three.js skips its local-space AABB reject entirely when `boundingBox` is null, and
      // nothing else in the engine computes one — the renderer only ever needs the sphere for
      // frustum culling. So without this line every ray that passes a terrain chunk's
      // bounding *sphere* goes on to test all of its triangles, which is the difference
      // between a 232 ms probe and a 4 ms one, measured on the shipped spawn scene.
      if (!g.boundingBox) g.computeBoundingBox();
      const s = g.boundingSphere;
      if (!s || !Number.isFinite(s.radius)) return;
      // The world-space bounding sphere, computed once per measurement rather than once per
      // ray, so the per-panel cull below is a handful of dot products.
      out.push({
        obj: o,
        c: s.center.clone().applyMatrix4(o.matrixWorld),
        r: s.radius * o.matrixWorld.getMaxScaleOnAxis(),
      });
    });
    return out;
  }

  /**
   * Measure every panel's occlusion against the world, at most once per `interval` simulated
   * seconds.
   *
   * Never called from `frame()` and — after the cost was measured rather than guessed — never
   * from `probe()` either. A camera-to-ink ray against the shipped spawn scene costs 2.58 ms,
   * and the two terrain meshes are 1.6 ms of that on their own (`vs.terrain.surface` 9,443
   * triangles at 0.86 ms, `vs.terrain.keel` 10,253 at 0.75 ms); Three's own bounding-sphere
   * and bounding-box rejects cannot help, because the corridor from the eye to a claim
   * fourteen metres ahead is inside the terrain's bounds by construction. Twenty-four samples
   * across four panels is therefore ~190 ms, and `design/architecture.md` says probes must be
   * cheap. So this is an instrument with its own name — `__vs.probe("mathocclusion")` — and
   * `probe()` reports what it last measured without paying for it again.
   */
  measureOcclusion({ force = false, interval = 0.4 } = {}) {
    const camera = this.kernel?.camera;
    if (!camera) return null;
    const t = this.kernel?.simTime ?? 0;
    if (!force && t - this._occlusionAt < interval) return this._occlusionAt;
    this._occlusionAt = t;
    const t0 = performance.now();
    camera.updateMatrixWorld(true);
    const occluders = this._occluders();
    for (const panel of this.panels.values()) panel.measureOcclusion(camera, occluders, this._raycaster);
    // Published, because "probes must be cheap" is a rule this one has to keep rather than
    // assert: if this number ever grows into a frame, the probe is the thing that says so.
    this._occlusionMs = Number((performance.now() - t0).toFixed(1));
    this._occluderCount = occluders.length;
    return t;
  }

  /**
   * The expensive one, published separately as `mathocclusion` so that nothing reads it by
   * accident. This is the gate: every standing claim must read 0.0, and `P15.mjs` claim O1
   * fails the run if any does not.
   */
  occlusionReport() {
    this.measureOcclusion({ force: true });
    const panels = [...this.panels.values()].map((p) => ({
      id: p.id,
      kind: p.working ? "working" : "claim",
      occludedPct: p._occlusion ? p._occlusion.pct : null,
      samples: p._occlusion ? p._occlusion.samples : 0,
      candidates: p._occlusion ? (p._occlusion.candidates ?? 0) : 0,
      position: p.mesh.position.toArray().map((v) => Number(v.toFixed(2))),
    }));
    const measured = panels.filter((p) => p.occludedPct !== null);
    return {
      at: Number.isFinite(this._occlusionAt) ? Number(this._occlusionAt.toFixed(2)) : null,
      ms: this._occlusionMs,
      occluders: this._occluderCount,
      worstOccludedPct: measured.length ? Math.max(...measured.map((p) => p.occludedPct)) : null,
      panels,
    };
  }

  probe() {
    // Reports the last occlusion measurement; deliberately does not take one. See
    // `measureOcclusion` for the milliseconds behind that sentence, and read a `null`
    // `occludedPct` as "nobody has measured this yet" — never as zero.
    const panels = [...this.panels.values()].map((p) => p.probe());
    const measured = panels.filter((p) => p.occludedPct !== null);
    return {
      locale: this.locale,
      driven: this.driven,
      registered: this.register ? this.register.children.length : 0,
      panels,
      maxPanels: MAX_PANELS,
      evictions: this.evictions,
      // The headline: the worst-occluded claim standing in the world right now. A gate can
      // read this one number and refuse a frame where mathematics is being cut in half.
      worstOccludedPct: measured.length ? Math.max(...measured.map((p) => p.occludedPct)) : null,
      occlusionAt: Number.isFinite(this._occlusionAt) ? Number(this._occlusionAt.toFixed(2)) : null,
      occlusionMs: this._occlusionMs,
      occluders: this._occluderCount,
      // Where the number comes from, named in the probe itself, so a reader who finds
      // `occludedPct: null` knows what to call rather than assuming zero.
      occlusionProbe: "mathocclusion",
      fonts: mathFontState(),
      raster: rasterStatistics(),
    };
  }
}
