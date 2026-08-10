#!/usr/bin/env node
/**
 * Critic probe, part B: the AUTHORED shipped frame, untouched.
 * Nothing is emitted, nothing is hidden. Boot, settle, audit, capture.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const { openGame } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);

const argOf = (n, d = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const LANGS = (argOf("langs", "en") || "").split(",").filter(Boolean);
const SIZES = (argOf("sizes", "1600x900") || "").split(",").map((s) => {
  const [w, h] = s.split("x").map(Number);
  return { w, h, label: s };
});

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

// ------- minimal PNG reader so the capture is measured, not admired -------
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
    const cd = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = cd.readUInt32BE(0);
      h = cd.readUInt32BE(4);
      bitDepth = cd[8];
      colorType = cd[9];
    } else if (type === "IDAT") idat.push(cd);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      switch (f) {
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
        default: break;
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
const px = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Ink / halo audit over a screen rect: find bright near-white pixels (the glyphs), then
 * compare the ring 3-5 px around them against the ring 12-20 px away. A panel, a glass card
 * or a drop shadow shows up as a systematic difference between those two rings.
 */
function inkAudit(img, rect) {
  const ink = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const [r, g, b] = px(img, x, y);
      const L = lum(r, g, b);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (L > 235 && sat < 22) ink.push([x, y, L]);
    }
  }
  if (!ink.length) return { inkPx: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumL = 0;
  for (const [x, y, L] of ink) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumL += L;
  }
  const isInk = new Set(ink.map(([x, y]) => y * img.w + x));
  const near = [];
  const far = [];
  const step = 1;
  for (let y = rect.y; y < rect.y + rect.h; y += step) {
    for (let x = rect.x; x < rect.x + rect.w; x += step) {
      if (isInk.has(y * img.w + x)) continue;
      // distance to nearest ink, cheap: scan a window
      let d2 = Infinity;
      for (const [ix, iy] of ink) {
        const dd = (ix - x) * (ix - x) + (iy - y) * (iy - y);
        if (dd < d2) d2 = dd;
        if (d2 <= 9) break;
      }
      const d = Math.sqrt(d2);
      const [r, g, b] = px(img, x, y);
      if (d >= 3 && d <= 5) near.push(lum(r, g, b));
      else if (d >= 12 && d <= 20) far.push(lum(r, g, b));
    }
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    inkPx: ink.length,
    inkLum: Number((sumL / ink.length).toFixed(1)),
    box: [minX, minY, maxX, maxY],
    bgNear: near.length ? Number(avg(near).toFixed(1)) : null,
    bgFar: far.length ? Number(avg(far).toFixed(1)) : null,
    halo: near.length && far.length ? Number((avg(near) - avg(far)).toFixed(1)) : null,
  };
}

for (const lang of LANGS) {
  for (const size of SIZES) {
    say(`\n============ ${lang} @ ${size.label} (authored frame, untouched) ============`);
    // eslint-disable-next-line no-await-in-loop
    await openGame({ width: size.w, height: size.h, lang, tier: "low" }, async (d) => {
      await d.advance(1.0);
      const rep = await d.report();
      say(`boot ready=${rep.ready} fatal=${rep.fatal ?? null} errors=${(rep.errors ?? []).length} katex=${JSON.stringify(rep.katex)}`);
      say(`consoleErrors=${JSON.stringify(d.consoleErrors.slice(0, 5))} failedRequests=${JSON.stringify(d.failedRequests.slice(0, 5))}`);

      const occ = await d.run(() => window.__vs.probe("mathocclusion"));
      say(`occlusion probe: ${JSON.stringify(occ)}`);

      const state = await d.run(() => {
        const f = window.__vs.probe("mathtex");
        const reg = document.getElementById("vs-claim-register");
        const overlay = document.getElementById("overlay");
        return {
          panels: f.panels.map((p) => ({
            id: p.id,
            tex: p.tex,
            ok: p.ok,
            speech: p.speech,
            locale: p.locale,
            textureSize: p.textureSize,
            fontPx: p.fontPx,
            occludedPct: p.occludedPct,
            depthTest: p.depthTest,
            texelsPerPixel: p.texelsPerPixel,
            emScreenPx: p.emScreenPx,
            bound: p.bound,
          })),
          raster: f.raster,
          registerHtml: reg ? reg.innerHTML.slice(0, 600) : null,
          registerText: reg ? reg.innerText : null,
          overlayText: overlay ? overlay.innerText.slice(0, 400) : null,
          bodyHasBackslash: /\\frac|\\cdot|\\times|\\left/.test(document.body.innerText),
          katexErrorNodes: document.querySelectorAll(".katex-error").length,
          visibleAnnotations: [...document.querySelectorAll("annotation, .katex-mathml")].filter(
            (a) => a.getBoundingClientRect().width > 1 && a.getBoundingClientRect().height > 1
          ).length,
          rawSourceLeak: window.__vs.report().katex.rawSourceLeak,
          tex: window.__vs.probe("tex"),
        };
      });
      say(`panels: ${JSON.stringify(state.panels, null, 1)}`);
      say(`raster: ${JSON.stringify(state.raster)}`);
      say(`register text: ${JSON.stringify(state.registerText)}`);
      say(`overlay text : ${JSON.stringify(state.overlayText)}`);
      say(`bodyHasRawTeXCommands=${state.bodyHasBackslash} katexErrorNodes=${state.katexErrorNodes} visibleAnnotations=${state.visibleAnnotations} rawSourceLeak=${state.rawSourceLeak}`);
      say(`tex probe: ${JSON.stringify(state.tex)}`);

      // where the claims are on screen, from the game itself
      const rects = await d.run(() => {
        const k = window.__vs.kernel;
        const cam = k.camera;
        const out = [];
        const field = k.scene.getObjectByName("mathtex");
        if (!field) return out;
        const Vec3 = k.scene.position.constructor; // THREE.Vector3, without importing three
        field.traverse((o) => {
          if (!o.isMesh) return;
          const corners = [
            [-0.5, -0.5],
            [0.5, -0.5],
            [-0.5, 0.5],
            [0.5, 0.5],
          ].map(([lx, ly]) => {
            const v = new Vec3(lx, ly, 0);
            o.localToWorld(v);
            v.project(cam);
            return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
          });
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          out.push({
            name: o.parent?.name ?? o.name,
            x: Math.round(Math.min(...xs)),
            y: Math.round(Math.min(...ys)),
            w: Math.round(Math.max(...xs) - Math.min(...xs)),
            h: Math.round(Math.max(...ys) - Math.min(...ys)),
          });
        });
        return out;
      }).catch((e) => ({ err: String(e) }));
      say(`claim screen rects: ${JSON.stringify(rects)}`);

      const out = `review/shots/p15/criticB-${lang}-${size.label}.png`;
      await d.shoot(out);
      say(`captured ${out}`);

      const img = readPng(path.join(ROOT, out));
      if (Array.isArray(rects)) {
        for (const r of rects) {
          const pad = 24;
          const rect = {
            x: Math.max(0, r.x - pad),
            y: Math.max(0, r.y - pad),
            w: Math.min(img.w - Math.max(0, r.x - pad), r.w + pad * 2),
            h: Math.min(img.h - Math.max(0, r.y - pad), r.h + pad * 2),
          };
          if (rect.w <= 2 || rect.h <= 2) continue;
          say(`  ink audit ${r.name} rect=${JSON.stringify(rect)} -> ${JSON.stringify(inkAudit(img, rect))}`);
        }
      }
      return null;
    });
  }
}

fs.writeFileSync(path.join(ROOT, "review", "measure", "out", "critic-p15-r2b.txt"), lines.join("\n"));
say("done");
