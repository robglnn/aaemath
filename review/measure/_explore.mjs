#!/usr/bin/env node
/**
 * Throwaway exploration for P15 round 3. Measures the SHIPPED game (Leaf Nine spawn frame),
 * never a spawned board. Deleted before handoff.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "review", "shots", "p15", "explore");
fs.mkdirSync(OUT, { recursive: true });

const { openGame } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);

const W = Number(process.argv.find((a) => a.startsWith("--w="))?.slice(4) ?? 1600);
const H = Number(process.argv.find((a) => a.startsWith("--h="))?.slice(4) ?? 900);

const TEX_PANEL_URL = "/src/math/TexPanel.js";

const result = {};

await openGame({ width: W, height: H, lang: "en", tier: "low" }, async (d) => {
  await d.play(1.2);

  result.cam = await d.run(() => {
    const k = window.__vs.kernel;
    const c = k.camera;
    c.updateMatrixWorld(true);
    const fwd = new (c.position.constructor)();
    c.getWorldDirection(fwd);
    const flat = fwd.clone();
    flat.y = 0;
    flat.normalize();
    return {
      fov: c.fov,
      aspect: c.aspect,
      pos: c.position.toArray(),
      dir: fwd.toArray(),
      flat: flat.toArray(),
      pixelRatio: k.renderer.getPixelRatio(),
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    };
  });

  result.panelsBefore = (await d.probe("mathtex")).panels;
  result.occlusionBefore = await d.probe("mathocclusion");

  // ---- the ≥ bar, measured off the shipped rasterizer at a big font size.
  result.geBar = await d.run(async (url) => {
    const m = await import(url);
    const out = {};
    for (const [name, tex] of [["ge", "\\ge"], ["plus", "+"], ["frac", "\\frac{1}{2}"], ["mark", "2x + 1 \\ge 9"]]) {
      const r = m.rasterizeTex(tex, { locale: "en", displayMode: true, fontPx: 512 });
      const c = r.canvas;
      const ctx = c.getContext("2d");
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      // rows: count of alpha>=128 per row
      const rows = [];
      for (let y = 0; y < c.height; y++) {
        let n = 0;
        let x0 = -1;
        let x1 = -1;
        for (let x = 0; x < c.width; x++) {
          if (img[(y * c.width + x) * 4 + 3] >= 128) {
            n++;
            if (x0 < 0) x0 = x;
            x1 = x;
          }
        }
        rows.push({ y, n, x0, x1 });
      }
      out[name] = { width: c.width, height: c.height, fontPx: r.fontPx, rows };
    }
    return out;
  }, TEX_PANEL_URL);

  // ---- the fallback stand-in, both glyphs, as rasters.
  result.standIn = await d.run(async (url) => {
    const m = await import(url);
    const out = {};
    for (const [name, tex] of [["square", "\\square"], ["blacksquare", "\\blacksquare"]]) {
      const r = m.rasterizeTex(tex, { locale: "en", displayMode: true, fontPx: 128 });
      const c = r.canvas;
      const ctx = c.getContext("2d");
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let solid = 0;
      let any = 0;
      for (let i = 3; i < img.length; i += 4) {
        if (img[i] >= 200) solid++;
        if (img[i] >= 24) any++;
      }
      out[name] = {
        w: c.width,
        h: c.height,
        fontPx: r.fontPx,
        ok: r.ok,
        solid,
        any,
        coverage: Number((solid / (c.width * c.height)).toFixed(3)),
        png: c.toDataURL("image/png"),
      };
    }
    return out;
  }, TEX_PANEL_URL);
  for (const [name, v] of Object.entries(result.standIn)) {
    fs.writeFileSync(path.join(OUT, `standin-${name}.png`), Buffer.from(v.png.split(",")[1], "base64"));
    delete v.png;
  }

  // ---- shipped frame, then the same frame with no claims standing (the sky plate).
  await d.run(() => window.__vs?.kernel?.halt?.());
  await d.shoot(path.relative(ROOT, path.join(OUT, "shipped.png")).replace(/\\/g, "/"), { timeout: 240000 });
  const rects = await d.run(function () {
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
  });
  result.rects = rects;

  await d.run(() => window.__vs.kernel.signals.emit("math:hide", {}));
  await d.play(0.2);
  await d.run(() => window.__vs?.kernel?.halt?.());
  await d.shoot(path.relative(ROOT, path.join(OUT, "sky.png")).replace(/\\/g, "/"), { timeout: 240000 });

  // ---- leaf9-mark candidate sweep, on the shipped scene, with the field now empty.
  const sweep = await d.run(
    async ([cands]) => {
      const THREE_pos = window.__vs.kernel.camera.position;
      const k = window.__vs.kernel;
      const cam = k.camera;
      cam.updateMatrixWorld(true);
      const fwd = THREE_pos.clone();
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const up = THREE_pos.clone().set(0, 1, 0);
      const right = THREE_pos.clone().crossVectors(fwd, up).normalize();
      const made = [];
      for (const c of cands) {
        const at = cam.position.clone().addScaledVector(fwd, c.forward).addScaledVector(right, c.right);
        at.y = cam.position.y + c.up;
        k.signals.emit("math:show", {
          id: c.id,
          tex: "2x + 1 \\ge 9",
          at: [at.x, at.y, at.z],
          em: c.em,
        });
        made.push({ ...c, at: at.toArray() });
      }
      return made;
    },
    [
      (() => {
        const list = [];
        let i = 0;
        for (const forward of [21, 26, 32, 42]) {
          for (const upv of [1.47, 2.6, 3.8, 5.2, 7.0]) {
            list.push({ id: `cand-${i++}`, forward, right: Number((forward * 0.652).toFixed(2)), up: upv, em: 1 });
          }
        }
        return list;
      })(),
    ]
  );
  await d.play(0.5);
  const sweepPanels = await d.probe("mathtex");
  const sweepOccl = await d.probe("mathocclusion");
  result.sweep = sweep.map((c) => {
    const p = sweepPanels.panels.find((x) => x.id === c.id);
    const o = sweepOccl.panels.find((x) => x.id === c.id);
    return { ...c, emScreenPx: p?.emScreenPx ?? null, worldSize: p?.worldSize ?? null, occludedPct: o?.occludedPct ?? null, samples: o?.samples ?? null };
  });

  await d.run(() => window.__vs.kernel.signals.emit("math:hide", {}));
  await d.play(0.2);

  // ---- the malformed claim, and what its raster actually contains.
  const fb = await d.run(() => {
    const k = window.__vs.kernel;
    const fwd = k.camera.position.clone();
    k.camera.getWorldDirection(fwd);
    const at = k.camera.position.clone().addScaledVector(fwd, 9);
    at.y = k.camera.position.y + 0.4;
    k.signals.emit("math:show", { id: "p15-malformed", tex: "\\frac{1}{", at: [at.x, at.y, at.z], em: 0.75 });
    return at.toArray();
  });
  await d.play(0.8);
  result.malformed = await d.run(() => {
    const field = window.__vs.probe("mathtex");
    const panel = field.panels.find((p) => p.id === "p15-malformed") ?? null;
    let tex = null;
    window.__vs.kernel.scene.traverse((o) => {
      if (o.name !== "tex:p15-malformed") return;
      const img = o.material?.map?.image;
      if (img?.toDataURL) tex = { w: img.width, h: img.height, png: img.toDataURL("image/png") };
    });
    return { panel, tex, at: null };
  });
  result.malformed.at = fb;
  if (result.malformed.tex) {
    fs.writeFileSync(path.join(OUT, "malformed-tex.png"), Buffer.from(result.malformed.tex.png.split(",")[1], "base64"));
    delete result.malformed.tex.png;
  }
  await d.run(() => window.__vs?.kernel?.halt?.());
  await d.shoot(path.relative(ROOT, path.join(OUT, "malformed.png")).replace(/\\/g, "/"), { timeout: 240000 });
  result.malformedRect = await d.run(function () {
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
  });
});

fs.writeFileSync(path.join(OUT, "explore.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ cam: result.cam, sweep: result.sweep, standIn: result.standIn, malformed: { panel: result.malformed?.panel, tex: result.malformed?.tex, rect: result.malformedRect } }, null, 1));
