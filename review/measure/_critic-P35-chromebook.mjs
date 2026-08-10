/**
 * CRITIC round 1, part 4 — the round-2 machine, in the SHIPPED app.
 *
 * The builder's C group proves the wire, but on SwiftShader the heuristic stands down to the
 * configured ceiling and answers "high": the *capped Chromebook* — the entire subject of the round-2
 * finding — never once executes in a live browser anywhere in P35.mjs.
 *
 * So: patch WebGL's renderer string before the app's first line runs, so `inspectDevice` reads a
 * genuine Intel UHD 600, `isSoftwareRaster` is false, the heuristic caps at `medium` and
 * `predictedTier` is `medium`. Everything after that is the shipped path, unmodified: the real
 * AutoTier, the real windows, the real `config.applyTier`, the real `quality:tier` listener.
 *
 * Round 2 on this exact machine: corroborated=true, one 3-rung leap medium->potato, recoveriesLeft 0
 * for the session. This run reports what the shipped code does instead.
 */
import { openGame } from "../../tools/lib/session.mjs";

const SPOOF = `ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0)`;

const out = await openGame({ width: 480, height: 270, scale: 2, built: true, query: { autotier: "force" } }, async (d) => {
  await d.page.addInitScript((name) => {
    const UNMASKED_RENDERER = 0x9246, UNMASKED_VENDOR = 0x9245, RENDERER = 0x1f01;
    for (const P of [self.WebGLRenderingContext?.prototype, self.WebGL2RenderingContext?.prototype]) {
      if (!P) continue;
      const gp = P.getParameter, ge = P.getExtension;
      P.getParameter = function (p) {
        if (p === RENDERER || p === UNMASKED_RENDERER) return name;
        if (p === UNMASKED_VENDOR) return "Google Inc. (Intel)";
        return gp.call(this, p);
      };
      P.getExtension = function (n) {
        if (n === "WEBGL_debug_renderer_info")
          return { UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER, UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR };
        return ge.call(this, n);
      };
    }
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 4 });
  }, SPOOF);

  await d.page.goto(d.url, { waitUntil: "load", timeout: 90000 });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });

  await d.page.evaluate(() => {
    window.__critic = [];
    window.__vs.kernel.signals.on("quality:tier", (p) => window.__critic.push({ tier: p.tier, dir: p.direction, post: p.postStack }));
  });

  const raw = () => d.page.evaluate(() => {
    const k = window.__vs.kernel, r = k.renderer;
    let m = 0, n = 0;
    k.scene.traverse((o) => { if (o.castShadow && o.shadow?.mapSize) { m = Math.max(m, o.shadow.mapSize.x); n++; } });
    return { pixelRatio: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], shadowEnabled: r.shadowMap.enabled, shadowMapSize: m, casters: n };
  });

  const first = { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") };
  const start = Date.now();
  let p = first.probe;
  while (Date.now() - start < 200000) {
    p = await d.probe("autotier");
    if ((p?.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied).length >= 2) break;
    await d.page.waitForTimeout(1000);
  }
  await d.page.waitForTimeout(4000);
  return { first, last: { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") }, spy: await d.page.evaluate(() => window.__critic), errors: d.consoleErrors.slice(0, 8) };
});

const { first, last, spy } = out;
console.log("== the machine the app thinks it is on");
console.log(`  renderer string read by inspectDevice: ${last.probe.heuristic.env.renderer}`);
console.log(`  cores ${last.probe.heuristic.env.cores}, memory ${last.probe.heuristic.env.memoryGB} GB, maxTextureSize ${last.probe.heuristic.env.maxTextureSize}, webgl2 ${last.probe.heuristic.env.webgl2}`);
console.log(`  heuristic caps: ${JSON.stringify(last.probe.heuristic.caps)}  standDown=${last.probe.heuristic.standDown}  dry=${last.probe.dry}`);
console.log(`  notes: ${last.probe.heuristic.notes.join(" | ")}`);
console.log(`  bootTier ${last.probe.bootTier} -> startTier ${last.probe.startTier}; ceiling ${last.probe.ceiling} (${last.probe.ceilingSource}); PREDICTED ${last.probe.prediction.predictedTier}`);

console.log("\n== tier timeline, shipped windows, real measured frames");
(last.probe.changes ?? []).forEach((c) =>
  console.log(`  ${(c.at / 1000).toFixed(1)}s  ${c.from} -> ${c.to} (${c.direction}, ${c.rungs} rung, median ${c.medianMs ?? "-"} ms, applied=${c.applied}, corroborated=${c.corroborated}, post=${c.post})`)
);
console.log(`  final tier ${last.probe.tier}; max rungs in stream = ${Math.max(0, ...(last.probe.changes ?? []).map((c) => c.rungs ?? 0))}`);

console.log("\n== the round-2 verdict, on the round-2 machine");
console.log(`  descent: ${JSON.stringify(last.probe.provisional.descent)}`);
console.log(`  corroboratesHere (a miss at ${last.probe.policyTier} vs predicted ${last.probe.prediction.predictedTier}): ${last.probe.prediction.corroboratesHere}`);
console.log(`  budget: ${JSON.stringify(last.probe.budget)}`);
console.log(`  revocation gate now: ${last.probe.provisional.gate}`);

console.log("\n== renderer, raw THREE");
console.log(`  pixelRatio ${first.raw.pixelRatio} -> ${last.raw.pixelRatio}; canvas ${JSON.stringify(first.raw.canvas)} -> ${JSON.stringify(last.raw.canvas)}`);
console.log(`  shadowMap.enabled ${first.raw.shadowEnabled} -> ${last.raw.shadowEnabled}; shadow map ${first.raw.shadowMapSize} -> ${last.raw.shadowMapSize} across ${last.raw.casters} casters`);
console.log(`  post installed ${first.post.installed} -> ${last.post.installed}; passes ${first.post.postDrawCalls} -> ${last.post.postDrawCalls}; effects ${JSON.stringify(first.post.effects)} -> ${JSON.stringify(last.post.effects)}`);
console.log(`  independent spy saw ${spy.length} quality:tier payload(s): ${JSON.stringify(spy)}`);
console.log(`\nconsole errors: ${out.errors.length ? JSON.stringify(out.errors) : "none"}`);
