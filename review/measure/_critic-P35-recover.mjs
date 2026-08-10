/**
 * CRITIC round 1, part 6 — does a RECOVERY ever execute in a real browser?
 *
 * Recovery is the entire subject of round 3 ("a 4.8 s boot storm must not decide the session"), and
 * across the builder's C group and all of my live runs the shipped app has only ever walked DOWN.
 * `_onDecision` has never fired with direction "recover" in a browser, which means the up-half of the
 * apply path — `config.applyTier` upward, `kernel.resize()` growing the drawing buffer,
 * `_applyShadows()` growing a disposed shadow map back, and `PostStack.applyTierStack` RE-INSTALLING
 * a composer it had uninstalled — is entirely unexercised outside Node.
 *
 * No injection: the policy is never touched. The machine is simply made genuinely fast, the way a
 * boot storm ending makes it fast — by shrinking the window so SwiftShader's fill cost collapses.
 * That is a real browser event (a window resize), not a synthetic sample.
 */
import { openGame } from "../../tools/lib/session.mjs";

const SPOOF = `ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0)`;

const out = await openGame({ width: 480, height: 270, scale: 2, built: true, query: { autotier: "force" } }, async (d) => {
  await d.page.addInitScript((name) => {
    const UR = 0x9246, UV = 0x9245, R = 0x1f01;
    for (const P of [self.WebGLRenderingContext?.prototype, self.WebGL2RenderingContext?.prototype]) {
      if (!P) continue;
      const gp = P.getParameter, ge = P.getExtension;
      P.getParameter = function (p) { if (p === R || p === UR) return name; if (p === UV) return "Google Inc. (Intel)"; return gp.call(this, p); };
      P.getExtension = function (n) { if (n === "WEBGL_debug_renderer_info") return { UNMASKED_RENDERER_WEBGL: UR, UNMASKED_VENDOR_WEBGL: UV }; return ge.call(this, n); };
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

  // 1. let the spoofed Chromebook walk down on real frames
  let t = Date.now();
  while (Date.now() - t < 150000) {
    const p = await d.probe("autotier");
    if ((p?.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied).length >= 1) break;
    await d.page.waitForTimeout(1000);
  }
  const bottom = { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") };

  // 2. the storm ends: the machine really is fast now. A window resize, nothing else.
  await d.page.setViewportSize({ width: 64, height: 48 });

  const trail = [];
  t = Date.now();
  let recovered = null;
  while (Date.now() - t < 260000) {
    const p = await d.probe("autotier");
    trail.push({ s: Math.round((Date.now() - t) / 1000), median: p?.measured?.medianMs, gate: p?.provisional?.gate, quiet: p?.provisional?.quietForMs, tier: p.tier });
    const r = (p?.changes ?? []).find((c) => c.direction === "recover");
    if (r) { recovered = { change: r, probe: p }; break; }
    await d.page.waitForTimeout(2000);
  }
  await d.page.waitForTimeout(3000);
  return {
    bottom, recovered, trail: trail.filter((_, i) => i % 3 === 0).slice(-14),
    end: { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") },
    spy: await d.page.evaluate(() => window.__critic),
    errors: d.consoleErrors.slice(0, 8),
  };
});

const { bottom, recovered, end, spy, trail } = out;
console.log(`walked down to ${bottom.probe.tier} on real frames; descent ${JSON.stringify(bottom.probe.provisional.descent)}`);
console.log(`  raw at the bottom: pixelRatio ${bottom.raw.pixelRatio}, canvas ${JSON.stringify(bottom.raw.canvas)}, shadowEnabled ${bottom.raw.shadowEnabled}, shadowMap ${bottom.raw.shadowMapSize}, post installed ${bottom.post.installed}, passes ${bottom.post.postDrawCalls}`);
console.log(`\nthe machine went quiet (viewport 64x48). trail:`);
trail.forEach((r) => console.log(`  +${String(r.s).padStart(3)}s tier=${r.tier} median=${r.median} ms quietForMs=${r.quiet} gate="${r.gate}"`));
console.log(`\nRECOVERY IN A REAL BROWSER: ${recovered ? "YES" : "NO"}`);
if (recovered) console.log(`  ${(recovered.change.at / 1000).toFixed(1)}s ${recovered.change.from} -> ${recovered.change.to} (${recovered.change.rungs} rung, applied=${recovered.change.applied}, post=${recovered.change.post})\n  why: ${recovered.change.why}`);
console.log(`\nfinal tier ${end.probe.tier}`);
console.log(`  raw: pixelRatio ${end.raw.pixelRatio}, canvas ${JSON.stringify(end.raw.canvas)}, shadowEnabled ${end.raw.shadowEnabled}, shadowMap ${end.raw.shadowMapSize}, post installed ${end.post.installed}, passes ${end.post.postDrawCalls}, effects ${JSON.stringify(end.post.effects)}`);
console.log(`  spy payloads: ${JSON.stringify(spy)}`);
console.log(`  gate at end: ${end.probe.provisional.gate}`);
console.log(`console errors: ${out.errors.length ? JSON.stringify(out.errors) : "none"}`);
