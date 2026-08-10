/**
 * CRITIC round 1, part 7 — the up-half of the listener, in isolation.
 *
 * NOT a connectedness proof (the wire is already proven by parts 4-6, where AutoTier emitted and an
 * independent spy caught the payload). This asks a narrower question the harness cannot otherwise
 * reach: once auto-tiering has UNINSTALLED the post composer at `potato` and shrunk the shadow maps,
 * does the listener rebuild correctly when a higher tier arrives? That is the branch a recovery
 * would take, and no browser has ever run it.
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

  const t = Date.now();
  while (Date.now() - t < 180000) {
    const p = await d.probe("autotier");
    if ((p?.changes ?? []).filter((c) => c.direction !== "heuristic" && c.applied).length >= 2) break;
    await d.page.waitForTimeout(1000);
  }
  const down = { probe: await d.probe("autotier"), post: await d.probe("post") };

  await d.page.evaluate(() =>
    window.__vs.kernel.signals.emit("quality:tier", {
      tier: "high", direction: "recover", source: "critic-probe",
      postStack: ["bloom", "godrays", "tonemap", "grain", "vignette"],
      shadows: true, shadowResolution: 2048, maxPixelRatio: 1.5,
    })
  );
  await d.page.waitForTimeout(6000);
  return { down, up: await d.probe("post"), errors: d.consoleErrors.slice(0, 8), report: await d.report() };
});

const { down, up } = out;
console.log(`autotier reached ${down.probe.tier}: post installed=${down.post.installed} passes=${down.post.postDrawCalls} targets=${down.post.targets} MB=${down.post.megabytes} effects=${JSON.stringify(down.post.effects)}`);
console.log(`after a "high" payload arrives on quality:tier:`);
console.log(`  installed=${up.installed} passes=${up.postDrawCalls} targets=${up.targets} MB=${up.megabytes} size=${JSON.stringify(up.size)} samples=${up.samples}`);
console.log(`  effects=${JSON.stringify(up.effects)} requested=${JSON.stringify(up.requested)} declined=${JSON.stringify(up.declined)} unknown=${JSON.stringify(up.unknown)}`);
console.log(`  tierApplied=${JSON.stringify(up.tierSignal.applied)}`);
console.log(`  bloom=${JSON.stringify(up.bloom)}`);
console.log(`REBUILT: ${up.installed && up.postDrawCalls > down.post.postDrawCalls}`);
console.log(`console errors: ${out.errors.length ? JSON.stringify(out.errors) : "none"}`);
console.log(`page errors: ${JSON.stringify((out.report.errors ?? []).slice(0, 5))}`);
