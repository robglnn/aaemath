#!/usr/bin/env node
/**
 * Independent critic probe for P15, round 2.
 *
 * Everything here runs against the SHIPPED GAME: `tools/lib/session.mjs` boots the real dev
 * server, the real `app/src/main.js`, the real `app/src/boot/60-mathtex.js` and the real
 * standing claims. No synthetic scene is spawned; hostile claims are pushed through the same
 * `math:show` signal a teaching system would use, and read back through `window.__vs`.
 *
 *   node review/measure/critic-p15-r2.mjs --langs=en,es,pl
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const { openGame } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);

const argOf = (n, d = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const LANGS = (argOf("langs", "en") || "").split(",").filter(Boolean);
const OUT = path.join(ROOT, "review", "measure", "out");
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

const results = {};

for (const lang of LANGS) {
  say(`\n================ LANG ${lang} ================`);
  // eslint-disable-next-line no-await-in-loop
  results[lang] = await openGame({ width: 1600, height: 900, lang, tier: "low" }, async (d) => {
    const boot = await d.report();
    say(`boot: ready=${boot.ready} fatal=${boot.fatal ?? null} errors=${(boot.errors ?? []).length}`);

    const before = await d.run(() => ({
      raster: window.__vs.probe("mathtex").raster,
      errors: window.__vs.errors.length,
      panels: window.__vs.probe("mathtex").panels.length,
    }));
    say(`baseline raster stats: ${JSON.stringify(before.raster)}`);

    // ---- (1) the 20,000-character claim, through the shipped signal ----
    const hostile = await d.run(() => {
      const k = window.__vs.kernel;
      const mk = (n) => {
        // A genuinely long, genuinely valid expression: 1 + 1 + 1 + ... padded to length.
        let s = "1";
        while (s.length < n) s += " + 1";
        return s.slice(0, n);
      };
      const tex20k = mk(20000);
      const t0 = performance.now();
      k.signals.emit("math:show", {
        id: "critic-20k",
        tex: tex20k,
        anchor: { right: 0, up: 2.0, forward: 12 },
        em: 0.66,
      });
      // force the panel to rasterize this frame
      window.__vs.advance(1 / 60);
      const emitMs = performance.now() - t0;
      const field = window.__vs.probe("mathtex");
      const panel = field.panels.find((p) => p.id === "critic-20k") ?? null;
      return {
        srcLength: tex20k.length,
        emitMs,
        panel,
        raster: field.raster,
        errors: window.__vs.errors.slice(-4),
        rawSourceLeak: window.__vs.report().katex.rawSourceLeak,
        katex: window.__vs.report().katex,
        // does the source string appear anywhere in the live DOM?
        domHasSource: document.body.innerText.includes("1 + 1 + 1 + 1 + 1 + 1"),
        katexErrorNodes: document.querySelectorAll(".katex-error").length,
      };
    });
    say(`(1) 20,000-char claim through math:show`);
    say(`    source length      : ${hostile.srcLength}`);
    say(`    emit+raster wall ms: ${hostile.emitMs.toFixed(1)}`);
    say(`    panel              : ${JSON.stringify(hostile.panel)}`);
    say(`    rasterStats        : ${JSON.stringify(hostile.raster)}`);
    say(`    rawSourceLeak      : ${hostile.rawSourceLeak}`);
    say(`    .katex-error nodes : ${hostile.katexErrorNodes}`);
    say(`    source in DOM text : ${hostile.domHasSource}`);
    say(`    last errors        : ${JSON.stringify(hostile.errors, null, 1)}`);

    // ---- (1b) the same length pushed straight at the rasterizer ----
    const raw = await d.run(async () => {
      const m = await import("/src/math/TexPanel.js");
      const mk = (n) => {
        let s = "1";
        while (s.length < n) s += " + 1";
        return s.slice(0, n);
      };
      const out = {};
      for (const [name, tex] of [
        ["len20000", mk(20000)],
        ["len2001", mk(2001)],
        ["len1999", mk(1999)],
        ["len600", mk(600)],
        ["deep", `${"\\frac{1}{".repeat(64)}x${"}".repeat(64)}`],
        ["wide", `\\underbrace{${"x+".repeat(400)}x}_{n}`],
      ]) {
        const t0 = performance.now();
        let r;
        try {
          r = m.rasterizeTex(tex, { fontPx: 256, displayMode: true });
        } catch (err) {
          out[name] = { threw: String(err?.message || err) };
          continue;
        }
        out[name] = {
          ms: Number((performance.now() - t0).toFixed(1)),
          w: r.canvas.width,
          h: r.canvas.height,
          px: r.canvas.width * r.canvas.height,
          fontPx: r.fontPx,
          ok: r.ok,
          bound: r.bound,
          err: r.record?.error ?? null,
          htmlHasSource: /1 \+ 1 \+ 1/.test(r.record?.html ?? "") || /katex-error/.test(r.record?.html ?? ""),
        };
      }
      out.caps = m.RASTER_CAPS;
      out.stats = m.rasterStatistics();
      return out;
    });
    say(`(1b) direct rasterizeTex on the shipped module:`);
    for (const [k, v] of Object.entries(raw)) {
      if (k === "caps" || k === "stats") continue;
      say(`    ${k.padEnd(10)} ${JSON.stringify(v)}`);
    }
    say(`    CAPS ${JSON.stringify(raw.caps)}`);
    say(`    STATS ${JSON.stringify(raw.stats)}`);

    // ---- (1c) hostile numeric payloads: em, ticks, panel flood ----
    const numeric = await d.run(() => {
      const k = window.__vs.kernel;
      k.signals.emit("math:show", {
        id: "critic-em",
        tex: "x=1",
        anchor: { right: 6, up: 3, forward: 20 },
        em: 1e9,
      });
      k.signals.emit("math:show", {
        id: "critic-ticks",
        anchor: { right: -6, up: 3, forward: 20 },
        em: 0.5,
        working: { slope: 1e9, intercept: 1e9, xTicks: 1e6, yTicks: 1e6, stroke: 1e9 },
      });
      window.__vs.advance(1 / 60);
      const f = window.__vs.probe("mathtex");
      return {
        em: f.panels.find((p) => p.id === "critic-em") ?? null,
        ticks: f.panels.find((p) => p.id === "critic-ticks") ?? null,
        raster: f.raster,
      };
    });
    say(`(1c) hostile numbers: em=1e9 -> ${JSON.stringify(numeric.em)}`);
    say(`     ticks=1e6        -> ${JSON.stringify(numeric.ticks)}`);
    say(`     raster after     -> ${JSON.stringify(numeric.raster)}`);

    const flood = await d.run(() => {
      const k = window.__vs.kernel;
      const t0 = performance.now();
      for (let i = 0; i < 400; i++) {
        k.signals.emit("math:show", {
          id: `flood-${i}`,
          tex: `x + ${i} = ${i + 3}`,
          anchor: { right: (i % 20) - 10, up: 1 + (i % 7) * 0.4, forward: 18 },
          em: 0.4,
        });
      }
      window.__vs.advance(1 / 60);
      const ms = performance.now() - t0;
      const info = window.__vs.kernel.renderer.info;
      const f = window.__vs.probe("mathtex");
      return {
        ms: Number(ms.toFixed(0)),
        panels: f.panels.length,
        evictions: f.evictions ?? null,
        textures: info.memory.textures,
        calls: info.render.calls,
        triangles: info.render.triangles,
        raster: f.raster,
      };
    });
    say(`(1d) 400 distinct math:show ids -> ${JSON.stringify(flood)}`);

    // ---- clean up hostile claims, restore the authored frame ----
    await d.run(() => {
      const k = window.__vs.kernel;
      k.signals.emit("math:hide", {});
    });
    await d.advance(0.2);

    // ---- (3) leak audit over the authored frame in this locale ----
    const leak = await d.run(() => {
      const r = window.__vs.report();
      const reg = document.getElementById("vs-claim-register");
      return {
        katex: r.katex,
        rawSourceLeak: r.katex.rawSourceLeak,
        katexErrorNodes: document.querySelectorAll(".katex-error").length,
        annotationLeak: [...document.querySelectorAll("annotation")].filter(
          (a) => a.offsetParent !== null
        ).length,
        registerEntries: reg ? reg.children.length : 0,
        registerText: reg ? reg.innerText.slice(0, 400) : null,
        panels: window.__vs.probe("mathtex").panels.map((p) => ({
          id: p.id,
          ok: p.ok,
          w: p.canvasWidth ?? p.canvas?.w ?? null,
          h: p.canvasHeight ?? p.canvas?.h ?? null,
          bound: p.bound ?? null,
        })),
        texProbe: window.__vs.probe("tex"),
        warnings: (r.warnings ?? []).filter((w) => /math|katex|CONTENT/i.test(w)),
        errors: (r.errors ?? []).slice(0, 8),
      };
    });
    say(`(3) leak audit ${lang}: rawSourceLeak=${leak.rawSourceLeak} katexErrorNodes=${leak.katexErrorNodes} visibleAnnotations=${leak.annotationLeak}`);
    say(`    katex probe: ${JSON.stringify(leak.katex)}`);
    say(`    tex probe  : ${JSON.stringify(leak.texProbe)}`);
    say(`    register(${leak.registerEntries}): ${JSON.stringify(leak.registerText)}`);
    say(`    panels     : ${JSON.stringify(leak.panels)}`);
    say(`    warnings   : ${JSON.stringify(leak.warnings)}`);
    say(`    errors     : ${JSON.stringify(leak.errors)}`);
    say(`    consoleErrors: ${JSON.stringify(d.consoleErrors.slice(0, 6))}`);
    say(`    failedRequests: ${JSON.stringify(d.failedRequests.slice(0, 6))}`);

    // ---- (4) capture the authored frame for the art comparison ----
    const shot = `review/shots/p15/critic-r2-${lang}.png`;
    await d.shoot(shot);
    say(`(4) captured ${shot}`);

    // ---- perf: frame cost with and without the field ----
    const perf = await d.run(() => {
      const k = window.__vs.kernel;
      const sample = () => {
        const t0 = performance.now();
        for (let i = 0; i < 6; i++) window.__vs.advance(1 / 60);
        return (performance.now() - t0) / 6;
      };
      const withField = sample();
      k.signals.emit("math:hide", {});
      window.__vs.advance(1 / 60);
      const without = sample();
      return { withField: Number(withField.toFixed(1)), without: Number(without.toFixed(1)) };
    });
    say(`perf: ms/frame with claims ${perf.withField}, after math:hide ${perf.without}`);

    return { boot, hostile, raw, numeric, flood, leak, perf };
  });
}

fs.writeFileSync(path.join(OUT, "critic-p15-r2.txt"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "critic-p15-r2.json"), JSON.stringify(results, null, 1));
say(`\nwrote ${path.join(OUT, "critic-p15-r2.txt")}`);
