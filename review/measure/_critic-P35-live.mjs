/**
 * CRITIC's own live run against the SHIPPED build. Deliberately different from the builder's C group:
 *
 *  - NO window knobs. The shipped firstWindowMs=6000 / windowMs=12000 / cooldown=4000 are used as
 *    they ship. SwiftShader renders ~7 fps, so 6 s of *rendered* time is ~42 frames — reachable.
 *    The builder compressed the windows to 4000 ms; that is the one shipped constant the round is
 *    about, so it is measured here uncompressed.
 *  - Raw renderer transforms are read straight off THREE, side by side with the probe's numbers,
 *    so a probe that lies is caught.
 *  - The PostStack listener is checked by counting handler invocations on the live signal bus, not
 *    by reading PostStack's own `subscribed:true` literal.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const W = 480, H = 270;
execFileSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit", shell: true });

const out = await openGame({ width: W, height: H, scale: 2, built: true, query: { autotier: "force" } }, async (d) => {
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });

  // Independent listener census: count the live subscribers on the bus, and install our own spy so
  // we can prove the payload really travels.
  const wire = await d.page.evaluate(() => {
    const s = window.__vs.kernel.signals;
    window.__critic = { seen: [] };
    s.on("quality:tier", (p) => window.__critic.seen.push({ tier: p.tier, dir: p.direction, post: p.postStack, at: performance.now() }));
    return { names: s.names(), hasQualityTier: s.names().includes("quality:tier") };
  });

  /** Raw THREE state, read directly — not through AutoTier.rendererState(). */
  const raw = () =>
    d.page.evaluate(() => {
      const k = window.__vs.kernel;
      const r = k.renderer;
      let maxShadow = 0, casters = 0;
      k.scene.traverse((o) => { if (o.castShadow && o.shadow?.mapSize) { maxShadow = Math.max(maxShadow, o.shadow.mapSize.x); casters++; } });
      return {
        rawPixelRatio: r.getPixelRatio(),
        rawCanvas: [r.domElement.width, r.domElement.height],
        rawShadowEnabled: r.shadowMap.enabled,
        rawShadowMapSize: maxShadow,
        rawCasters: casters,
        rawToneMapping: r.toneMapping,
      };
    });

  const t0 = { probe: await d.probe("autotier"), post: await d.probe("post"), raw: await raw() };

  // Wait, in wall clock, for two applied changes under the SHIPPED windows.
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 240000) {
    last = await d.probe("autotier");
    const applied = (last?.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied);
    if (applied.length >= 2) break;
    await d.page.waitForTimeout(1000);
  }
  await d.page.waitForTimeout(3000);

  const t1 = { probe: await d.probe("autotier"), post: await d.probe("post"), raw: await raw() };
  const spy = await d.page.evaluate(() => window.__critic.seen);

  // ---- second load: ?tier=low must stand the module down completely
  const u = new URL(d.url);
  u.search = "?tier=low";
  await d.page.goto(u.toString(), { waitUntil: "load", timeout: 90000 });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
  await d.page.waitForTimeout(20000);
  const low = { probe: await d.probe("autotier"), post: await d.probe("post"), raw: await raw() };

  return { wire, t0, t1, spy, low, errors: d.consoleErrors.slice(0, 8) };
});

fs.writeFileSync(path.join(ROOT, "review", "measure", "out", "critic-P35-live.json"), JSON.stringify(out, null, 2));

const { t0, t1, spy, low, wire } = out;
const applied = (t1.probe.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied);

console.log("== WIRE");
console.log(`  live signal registry has quality:tier : ${wire.hasQualityTier}`);
console.log(`  payloads observed on the bus by an independent spy: ${spy.length}`);
spy.forEach((s) => console.log(`    tier=${s.tier} dir=${s.dir} postStack=[${(s.post ?? []).join(",")}]`));

console.log("\n== SHIPPED WINDOWS (no compression knobs)");
console.log(`  firstWindowMs=${t1.probe.thresholds.firstWindowMs} windowMs=${t1.probe.thresholds.windowMs} cooldownMs=${t1.probe.thresholds.cooldownMs} downMs=${t1.probe.thresholds.downMs}`);
console.log(`  heuristic: start=${t1.probe.startTier} ceiling=${t1.probe.ceiling} (${t1.probe.ceilingSource}) predicted=${t1.probe.prediction.predictedTier}`);
console.log(`  GPU: ${t1.probe.heuristic.env.renderer}`);

console.log("\n== TIER TIMELINE (applied)");
applied.forEach((c) => console.log(`  ${(c.at / 1000).toFixed(1)}s  ${c.from} -> ${c.to}  (${c.direction}, ${c.rungs} rung, median ${c.medianMs} ms over ${c.frames} frames / ${(c.spanMs / 1000).toFixed(1)} s rendered, post route=${c.post}, corroborated=${c.corroborated})`));
console.log(`  final tier ${t1.probe.tier}; maxLeap in stream = ${Math.max(0, ...applied.map((c) => c.rungs))}`);

console.log("\n== RENDERER, RAW vs PROBE");
const cmp = (label, a, b) => console.log(`  ${label.padEnd(22)} ${JSON.stringify(a).padEnd(18)} -> ${JSON.stringify(b)}`);
cmp("raw pixelRatio", t0.raw.rawPixelRatio, t1.raw.rawPixelRatio);
cmp("probe pixelRatio", t0.probe.renderer.pixelRatio, t1.probe.renderer.pixelRatio);
cmp("raw canvas px", t0.raw.rawCanvas, t1.raw.rawCanvas);
cmp("raw shadowMap.enabled", t0.raw.rawShadowEnabled, t1.raw.rawShadowEnabled);
cmp("raw shadow map size", t0.raw.rawShadowMapSize, t1.raw.rawShadowMapSize);
cmp("raw shadow casters", t0.raw.rawCasters, t1.raw.rawCasters);
cmp("post installed", t0.post.installed, t1.post.installed);
cmp("post draw calls", t0.post.postDrawCalls, t1.post.postDrawCalls);
cmp("post effects", t0.post.effects, t1.post.effects);
console.log(`  PostStack.tierApplied: ${JSON.stringify(t1.post.tierSignal.applied)}`);

console.log("\n== ?tier=low");
console.log(`  enabled=${low.probe.enabled} autoTierSetting=${low.probe.autoTierSetting} tier=${low.probe.tier} frames=${low.probe.frames} changes=${(low.probe.changes ?? []).length}`);
console.log(`  reason: ${low.probe.reason}`);
console.log(`  raw renderer at ?tier=low: pixelRatio ${low.raw.rawPixelRatio}, canvas ${JSON.stringify(low.raw.rawCanvas)}, shadowEnabled ${low.raw.rawShadowEnabled}, shadowMap ${low.raw.rawShadowMapSize}, post installed ${low.post.installed}, passes ${low.post.postDrawCalls}`);
console.log(`  policy samples accepted=${low.probe.samples.accepted} rejected=${low.probe.samples.rejected}`);
console.log(`\nconsole errors: ${out.errors.length ? JSON.stringify(out.errors) : "none"}`);
