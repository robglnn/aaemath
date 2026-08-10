#!/usr/bin/env node
/**
 * CRITIC probe for P15, round 1. Written by the critic, not the builder.
 * Everything here is measured on the SHIPPED GAME: the real dev-server page, the real boot
 * modules, the real `math:show` signal. No synthetic scene is spawned; the only module import
 * is of the same live instance the running game holds, and it is used only where a claim is
 * explicitly about a function the panel path cannot reach.
 */
import path from "node:path";
import fs from "node:fs";
import { openGame, ROOT, arg } from "../../tools/lib/session.mjs";

const OUT = path.join(ROOT, "review", "shots", "p15", "critic");
fs.mkdirSync(OUT, { recursive: true });
const LANG = arg("lang", "en");
const W = Number(arg("width", "1600"));
const H = Number(arg("height", "900"));
const MOD = "/src/math/TexPanel.js";

const line = (...a) => console.log(...a);

await openGame({ width: W, height: H, lang: LANG, tier: "low" }, async (d) => {
  const rep = await d.report();
  line(`# boot lang=${LANG} ${W}x${H}  ready=${rep.ready} fatal=${rep.fatal ?? null}`);
  line(`# console errors at boot: ${d.consoleErrors.length}`);
  if (d.consoleErrors.length) line(d.consoleErrors.slice(0, 3).join("\n"));

  const caps = await d.run(async (url) => (await import(url)).RASTER_CAPS, MOD);
  line(`# RASTER_CAPS ${JSON.stringify(caps)}`);

  // ---- baseline: the shipped standing claims, untouched
  const base = await d.probe("mathtex");
  line("\n## shipped standing claims (no attack yet)");
  for (const p of base.panels) {
    line(`  ${p.id.padEnd(16)} ${p.kind.padEnd(8)} tex=${JSON.stringify(p.tex)} texture=${JSON.stringify(p.textureSize)} ok=${p.ok} bound=${JSON.stringify(p.bound)} em=${p.em} world=${JSON.stringify(p.worldSize)} t/px=${p.texelsPerPixel}`);
  }
  line(`  raster: ${JSON.stringify(base.raster)}`);

  // ---- (1) the 20,000-character claim, straight into the shipped signal
  const BIG = "1+".repeat(10000).slice(0, 20000);
  line(`\n## ATTACK A: math:show with a ${BIG.length}-character claim`);
  const A = await d.run(
    async ([tex]) => {
      const k = window.__vs.kernel;
      const before = window.__vs.probe("mathtex").raster;
      const errBefore = window.__vs.errors.length;
      const heapBefore = performance.memory?.usedJSHeapSize ?? null;
      const t0 = performance.now();
      k.signals.emit("math:show", { id: "critic-20k", tex, at: [0, 2, 0], em: 0.6 });
      const emitMs = performance.now() - t0;
      // force the raster synchronously through the shipped frame hook
      const t1 = performance.now();
      window.__vs.advance(1 / 60);
      const frameMs = performance.now() - t1;
      const t2 = performance.now();
      window.__vs.advance(1 / 60);
      const nextFrameMs = performance.now() - t2;
      const field = window.__vs.probe("mathtex");
      return {
        emitMs: +emitMs.toFixed(1),
        frameMs: +frameMs.toFixed(1),
        nextFrameMs: +nextFrameMs.toFixed(1),
        panel: field.panels.find((p) => p.id === "critic-20k") ?? null,
        raster: field.raster,
        rasterMsDelta: +(field.raster.ms - before.ms).toFixed(1),
        newErrors: window.__vs.errors.slice(errBefore),
        heapDelta: heapBefore != null ? (performance.memory.usedJSHeapSize - heapBefore) : null,
        katexErrorNodes: document.querySelectorAll(".katex-error").length,
        sourceInDom: document.documentElement.innerHTML.includes("1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1"),
        overlayText: (document.getElementById("overlay")?.innerText ?? "").slice(0, 300),
        fatal: window.__vs.fatal,
      };
    },
    [BIG]
  );
  line(`  emit+first-frame: emit ${A.emitMs} ms, frame ${A.frameMs} ms, next frame ${A.nextFrameMs} ms`);
  line(`  canvas allocated for it: ${JSON.stringify(A.panel?.textureSize)}  world quad ${JSON.stringify(A.panel?.worldSize)}`);
  line(`  bound=${JSON.stringify(A.panel?.bound)}  ok=${A.panel?.ok}  speech=${JSON.stringify(A.panel?.speech)}  tex-in-probe=${JSON.stringify(String(A.panel?.tex).length)} chars`);
  line(`  session max canvas: ${A.raster.maxCanvasWidth}x${A.raster.maxCanvasHeight} = ${A.raster.maxCanvasPixels} px (cap ${caps.maxPixels})`);
  line(`  heapDelta=${A.heapDelta}  katex-error nodes=${A.katexErrorNodes}  sourceInDom=${A.sourceInDom}  fatal=${A.fatal}`);
  line(`  new __vs.errors: ${JSON.stringify(A.newErrors)}`);
  line(`  overlay text: ${JSON.stringify(A.overlayText)}`);

  // ---- (1b) the biggest claim the LENGTH gate actually admits: 2000 chars, one line
  const ATCAP = "1+".repeat(1000).slice(0, 1999) + "2";
  line(`\n## ATTACK B: the worst case the length cap ADMITS — ${ATCAP.length} chars, one line`);
  const B = await d.run(
    async ([tex]) => {
      const k = window.__vs.kernel;
      const t0 = performance.now();
      k.signals.emit("math:show", { id: "critic-atcap", tex, at: [0, 2, 0], em: 0.6 });
      window.__vs.advance(1 / 60);
      const ms = performance.now() - t0;
      const f = window.__vs.probe("mathtex");
      return { ms: +ms.toFixed(1), panel: f.panels.find((p) => p.id === "critic-atcap") ?? null, raster: f.raster };
    },
    [ATCAP]
  );
  line(`  ${B.ms} ms  texture=${JSON.stringify(B.panel?.textureSize)} bound=${JSON.stringify(B.panel?.bound)} ok=${B.panel?.ok} world=${JSON.stringify(B.panel?.worldSize)}`);
  line(`  session max canvas now ${B.raster.maxCanvasWidth}x${B.raster.maxCanvasHeight}`);

  // ---- (1c) tiny source, enormous ink: \rule is 21 characters and asks for a wall
  line(`\n## ATTACK C: \\rule{900em}{900em} — 20 characters, colossal ink, depth 1`);
  const C = await d.run(async () => {
    const k = window.__vs.kernel;
    const t0 = performance.now();
    k.signals.emit("math:show", { id: "critic-rule", tex: "\\rule{900em}{900em}", at: [0, 2, 0], em: 0.6 });
    window.__vs.advance(1 / 60);
    const ms = performance.now() - t0;
    const f = window.__vs.probe("mathtex");
    return { ms: +ms.toFixed(1), panel: f.panels.find((p) => p.id === "critic-rule") ?? null, raster: f.raster, err: window.__vs.errors.at(-1) };
  });
  line(`  ${C.ms} ms  texture=${JSON.stringify(C.panel?.textureSize)} bound=${JSON.stringify(C.panel?.bound)} ok=${C.panel?.ok} world=${JSON.stringify(C.panel?.worldSize)}`);
  line(`  last error: ${JSON.stringify(C.err)}`);
  line(`  session max canvas now ${C.raster.maxCanvasWidth}x${C.raster.maxCanvasHeight}`);

  // ---- (1d) the em knob: `math:show` takes world units per em straight from the caller
  line(`\n## ATTACK D: math:show with em = 100000 (world size, and the size ladder)`);
  const D = await d.run(async () => {
    const k = window.__vs.kernel;
    const t0 = performance.now();
    k.signals.emit("math:show", { id: "critic-em", tex: "x + 3 = 7", at: [0, 2, 0], em: 100000 });
    window.__vs.advance(1 / 60);
    window.__vs.advance(1 / 60);
    const ms = performance.now() - t0;
    const f = window.__vs.probe("mathtex");
    return { ms: +ms.toFixed(1), panel: f.panels.find((p) => p.id === "critic-em") ?? null, raster: f.raster };
  });
  line(`  ${D.ms} ms  texture=${JSON.stringify(D.panel?.textureSize)} world=${JSON.stringify(D.panel?.worldSize)} bound=${JSON.stringify(D.panel?.bound)} t/px=${D.panel?.texelsPerPixel}`);

  // ---- (1e) the OTHER half of the math:show contract: `working`
  // design/architecture.md publishes `working: {slope, intercept, xTicks, yTicks}` as part of
  // the signal, so xTicks/yTicks are caller-controlled exactly as `tex` is.
  line(`\n## ATTACK E: math:show working with large xTicks/yTicks (the plotted-axis path)`);
  for (const n of [1e4, 1e5, 1e6]) {
    const E = await d.run(async (ticks) => {
      const k = window.__vs.kernel;
      const t0 = performance.now();
      k.signals.emit("math:show", { id: `critic-work-${ticks}`, working: { slope: 0.6, intercept: 0, xTicks: ticks, yTicks: ticks }, at: [0, 2, 0], em: 0.6 });
      window.__vs.advance(1 / 60);
      return { ms: +(performance.now() - t0).toFixed(1) };
    }, n);
    line(`  xTicks=yTicks=${n}: ${E.ms} ms of main thread`);
  }

  // ---- (1f) how many claims may stand at once
  line(`\n## ATTACK F: 400 distinct math:show ids (per-claim raster is bounded; is the field?)`);
  const F = await d.run(async () => {
    const k = window.__vs.kernel;
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) {
      k.signals.emit("math:show", { id: `critic-many-${i}`, tex: "x + 3 = 7", at: [(i % 20) * 2, 2, Math.floor(i / 20) * 2], em: 0.6 });
    }
    window.__vs.advance(1 / 60);
    window.__vs.advance(1 / 60);
    const ms = performance.now() - t0;
    const f = window.__vs.probe("mathtex");
    let texels = 0;
    for (const p of f.panels) if (p.textureSize) texels += p.textureSize[0] * p.textureSize[1];
    const info = window.__vs.kernel.renderer?.info ?? null;
    return {
      ms: +ms.toFixed(1),
      panels: f.panels.length,
      texels,
      mib: +((texels * 4) / 1048576).toFixed(1),
      textures: info?.memory?.textures ?? null,
      calls: info?.render?.calls ?? null,
      tris: info?.render?.triangles ?? null,
    };
  });
  line(`  ${F.ms} ms; ${F.panels} panels standing; ${F.texels} texels = ${F.mib} MiB of RGBA; GPU textures=${F.textures} drawCalls=${F.calls} tris=${F.tris}`);

  // ---- (3) leak audit, with all the attacks still standing
  const leak = await d.run(() => {
    const overlay = document.getElementById("overlay");
    const bodyText = document.body.innerText || "";
    return {
      katexErrorNodes: document.querySelectorAll(".katex-error").length,
      katexNodes: document.querySelectorAll(".katex").length,
      annotationNodes: document.querySelectorAll("annotation").length,
      overlayHasBackslash: /\\/.test(overlay?.innerText ?? ""),
      bodyHasBackslash: /\\/.test(bodyText),
      bodyBackslashSample: (bodyText.match(/.{0,40}\\.{0,40}/) ?? [null])[0],
      registerCount: document.querySelectorAll("[data-claim]").length,
      registerFallbacks: [...document.querySelectorAll("[data-vs-tex]")].filter((n) => n.getAttribute("data-vs-tex") === "fallback").length,
      labels: [...document.querySelectorAll("[data-vs-tex]")].slice(0, 6).map((n) => [n.getAttribute("data-vs-tex"), n.getAttribute("lang"), n.getAttribute("aria-label")]),
      texProbe: window.__vs.probe("tex"),
      errors: window.__vs.errors.length,
      unexpected: window.__vs.errors.filter((e) => !/KaTeX refused a claim/.test(String(e))),
      fatal: window.__vs.fatal,
      simTime: window.__vs.kernel.simTime,
    };
  });
  line(`\n## LEAK AUDIT with every attack standing (lang=${LANG})`);
  line(`  .katex-error nodes: ${leak.katexErrorNodes}   .katex nodes: ${leak.katexNodes}   <annotation>: ${leak.annotationNodes}`);
  line(`  overlay contains backslash: ${leak.overlayHasBackslash}   body: ${leak.bodyHasBackslash} ${JSON.stringify(leak.bodyBackslashSample)}`);
  line(`  a11y register: ${leak.registerCount} claims, ${leak.registerFallbacks} showing the stand-in`);
  line(`  sample labels: ${JSON.stringify(leak.labels)}`);
  line(`  tex stats: ${JSON.stringify({ requests: leak.texProbe.requests, hits: leak.texProbe.hits, typesets: leak.texProbe.typesets, failures: leak.texProbe.failures, cacheSize: leak.texProbe.cacheSize })}`);
  line(`  __vs.errors ${leak.errors} total, ${leak.unexpected.length} not a deliberate refusal: ${JSON.stringify(leak.unexpected.slice(0, 3))}`);
  line(`  fatal=${leak.fatal} simTime=${leak.simTime.toFixed(2)} (clock still advancing => no hang)`);

  // ---- clear the field and capture the shipped frame for the art comparison
  await d.run(() => window.__vs.kernel.signals.emit("math:hide", {}));
  await d.play(0.5);
  const after = await d.probe("mathtex");
  line(`\n## after math:hide — panels standing: ${after.panels.length}; session max canvas ${after.raster.maxCanvasWidth}x${after.raster.maxCanvasHeight}`);
  line(`  raster totals: ${JSON.stringify(after.raster)}`);
});
