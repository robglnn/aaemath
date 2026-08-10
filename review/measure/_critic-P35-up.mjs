/**
 * CRITIC round 1, part 5 — the UP direction of the apply path, in a live browser.
 *
 * Every live run in P35 (the builder's and mine) only ever walks DOWN: SwiftShader never produces
 * headroom, so `_onDecision` has never fired with direction "recover" in a real browser and the
 * renderer has never been asked to grow a shadow map back or RE-INSTALL the post composer.
 * `PostStack`'s own constructor comment warns that a later `setEnabled(true)` can rebuild the chain
 * to the wrong shape, so "up" is not the trivial inverse of "down".
 *
 * `AutoTier._standDown()` runs the identical apply code (`kernel.resize` + `_applyShadows` +
 * `_applyPost` -> `quality:tier`) in the up direction, and it is reachable by a real player action:
 * opening settings and choosing a tier. So: let auto-tiering walk the spoofed Chromebook down to
 * potato on real frames, then have the player pick `ultra`, and read the raw THREE state back.
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
    window.__vs.kernel.signals.on("quality:tier", (p) => window.__critic.push({ tier: p.tier, dir: p.direction, post: p.postStack, shadows: p.shadows }));
  });

  const raw = () => d.page.evaluate(() => {
    const k = window.__vs.kernel, r = k.renderer;
    let m = 0, n = 0, needs = 0;
    k.scene.traverse((o) => { if (o.castShadow && o.shadow?.mapSize) { m = Math.max(m, o.shadow.mapSize.x); n++; if (o.shadow.map === null) needs++; } });
    return { pixelRatio: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], shadowEnabled: r.shadowMap.enabled, shadowMapSize: m, casters: n, mapsAwaitingRealloc: needs };
  });

  // walk down on real frames
  const start = Date.now();
  while (Date.now() - start < 200000) {
    const p = await d.probe("autotier");
    if ((p?.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied).length >= 2) break;
    await d.page.waitForTimeout(1000);
  }
  const bottom = { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") };

  // …now the player opens settings and picks ultra. Shipped `Config.set` path.
  await d.page.evaluate(() => window.__vs.config.set("tier", "ultra"));
  await d.page.waitForTimeout(8000);
  const after = { probe: await d.probe("autotier"), raw: await raw(), post: await d.probe("post") };

  return { bottom, after, spy: await d.page.evaluate(() => window.__critic), errors: d.consoleErrors.slice(0, 8) };
});

const { bottom, after, spy } = out;
console.log(`autotier walked the spoofed UHD 600 down to: ${bottom.probe.tier}`);
console.log(`  raw: pixelRatio ${bottom.raw.pixelRatio}, canvas ${JSON.stringify(bottom.raw.canvas)}, shadowMap.enabled ${bottom.raw.shadowEnabled}, shadow map ${bottom.raw.shadowMapSize}, post installed ${bottom.post.installed}, passes ${bottom.post.postDrawCalls}`);
console.log(`\nplayer chose "ultra" via config.set -> standDown ${JSON.stringify(after.probe.standDown)}`);
console.log(`  enabled ${bottom.probe.enabled} -> ${after.probe.enabled}; autoTierSetting ${after.probe.autoTierSetting}; tier ${after.probe.tier}`);
console.log(`  raw: pixelRatio ${after.raw.pixelRatio}, canvas ${JSON.stringify(after.raw.canvas)}, shadowMap.enabled ${after.raw.shadowEnabled}, shadow map ${after.raw.shadowMapSize} (${after.raw.mapsAwaitingRealloc} awaiting realloc), post installed ${after.post.installed}, passes ${after.post.postDrawCalls}`);
console.log(`  post effects ${JSON.stringify(bottom.post.effects)} -> ${JSON.stringify(after.post.effects)}`);
console.log(`  PostStack.tierApplied: ${JSON.stringify(after.post.tierSignal.applied)}`);
console.log(`  spy payloads: ${JSON.stringify(spy)}`);

const grewShadow = after.raw.shadowMapSize > bottom.raw.shadowMapSize;
const grewBuffer = after.raw.canvas[0] > bottom.raw.canvas[0];
const rebuiltPost = after.post.installed && after.post.postDrawCalls > bottom.post.postDrawCalls;
console.log(`\nUP-PATH: shadow map grew=${grewShadow}  drawing buffer grew=${grewBuffer}  post composer rebuilt=${rebuiltPost}  shadows re-enabled=${after.raw.shadowEnabled}`);
console.log(`console errors: ${out.errors.length ? JSON.stringify(out.errors) : "none"}`);
