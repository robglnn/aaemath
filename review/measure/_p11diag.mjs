#!/usr/bin/env node
// TEMPORARY diagnostic — delete before handoff. Is there a shadow now?
import { openGame, arg } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";

const TIER = arg("tier", "medium");

await openGame({ width: 1280, height: 720, tier: TIER }, async (d) => {
  await d.page.route("**/@vite/client*", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "export const createHotContext = () => ({ on(){}, send(){}, accept(){}, dispose(){}, prune(){}, invalidate(){}, decline(){} }); export const injectQuery = (u) => u; export const removeStyle = () => {}; export const updateStyle = () => {};" })
  );
  await d.page.reload({ waitUntil: "load", timeout: 90000 });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
  for (let i = 0; i < 30; i++) {
    await d.play(0.3);
    const s = await d.probe("scatter");
    const l = await d.probe("locomotion");
    if (s?.built && s.outstanding === false && l?.grounded) break;
  }
  await d.play(0.5);
  await d.page.evaluate(installToolkit);

  const probe = await d.probe("lighting");
  console.log("SHADOW RIG", JSON.stringify({ shadow: probe.shadow, contact: probe.contact, byArch: probe.world.byArchetype, unowned: probe.world.unowned }, null, 2));

  // walk to genuinely lit ground: march along the sun ray from the player until an up-facing patch
  // the key reaches is found, then teleport there.
  const site = await d.run(() => {
    const T = window.__p11;
    const p = T.player();
    const g = T.groundSamples({ around: [p.x, p.y, p.z], radius: 110, step: 2 });
    const out = [];
    for (const b of g.pts.slice(-60).reverse()) {
      const y = T.groundY(b.x, b.z);
      if (!Number.isFinite(y)) continue;
      const n = T.groundNormal(b.x, b.z);
      if (!n || n[1] < 0.9) continue;
      if (!T.sunClear?.([b.x, y, b.z])) { /* keep going, sunClear may not exist */ }
      let flat = true;
      for (let t = 0.8; t <= 4 && flat; t += 0.8)
        for (let a = 0; a < 8; a++) {
          const gy = T.groundY(b.x + Math.cos((a / 8) * 6.283) * t, b.z + Math.sin((a / 8) * 6.283) * t);
          if (!Number.isFinite(gy) || Math.abs(gy - y) > 0.9) { flat = false; break; }
        }
      if (flat) out.push({ x: b.x, y, z: b.z, ndl: b.ndl, pixY: b.y });
      if (out.length >= 6) break;
    }
    return { n: g.n, out };
  });
  console.log("SITES", JSON.stringify(site.out.slice(0, 6)));

  let best = null;
  for (const c of site.out.slice(0, 5)) {
    await d.run((s) => window.__p11.sys("locomotion")?.teleport?.(s.x, s.y + 0.8, s.z, { yaw: 0 }), c);
    await d.play(1.2);
    const f = await d.run(() => {
      const T = window.__p11;
      const p = T.player();
      const s = T.lighting._shadowDir;
      const len = Math.hypot(s.x, s.z) || 1;
      const away = [-s.x / len, -s.z / len];
      const foot = [p.x, T.groundY(p.x, p.z) ?? p.y, p.z];
      // stand across the shadow, not on top of it: 90 degrees off the sun bearing, raised.
      const perp = [-away[1], away[0]];
      const eye = [foot[0] + perp[0] * 5.5 + away[0] * 2.2, foot[1] + 3.4, foot[2] + perp[1] * 5.5 + away[1] * 2.2];
      const look = [foot[0] + away[0] * 2.2, foot[1] + 0.5, foot[2] + away[1] * 2.2];
      T.lighting.reviewCamera({ pos: eye, look, fov: 52, detach: ["camera"] });
      T.grab();
      const at = (dx, dz) => {
        const x = foot[0] + dx, z = foot[2] + dz;
        const y = T.groundY(x, z);
        const sp = T.project([x, y + 0.02, z]);
        if (sp[2] > 1) return null;
        const q = T.patch(sp[0], sp[1], 2);
        return { px: [Math.round(sp[0]), Math.round(sp[1])], y: +q.y.toFixed(4), hsv: T.hsv(...q.rgb).map((v) => +v.toFixed(2)) };
      };
      const along = [0, 0.3, 0.6, 1, 1.6, 2.4, 3.4, 4.6, 6].map((t) => ({ t, ...(at(away[0] * t, away[1] * t) ?? {}) }));
      const side = [2, 3].map((t) => ({ t, ...(at(perp[0] * t, perp[1] * t) ?? {}) }));
      return { foot, away, along, side };
    });
    const lit = f.side.map((s) => s.y ?? 0).sort((a, b) => b - a)[0] ?? 0;
    if (!best || lit > best.lit) best = { ...f, lit, site: c };
    if (lit > 0.06) break;
  }
  console.log("CONTACT", JSON.stringify(best, null, 2));
  await d.shoot("review/shots/p11/r3-contact.png");
});
