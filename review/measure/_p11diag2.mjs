#!/usr/bin/env node
// TEMPORARY diagnostic — where is the sole, really?
import { openGame } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";

await openGame({ width: 640, height: 360, tier: "medium" }, async (d) => {
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
  await d.play(0.6);
  await d.page.evaluate(installToolkit);
  const out = await d.run(() => {
    const K = window.__vs.kernel;
    const T = window.__p11;
    const av = K.byName.get("avatar");
    const loco = K.byName.get("locomotion");
    const box = new (K.scene.constructor === Object ? Object : Object)();
    let minY = Infinity;
    const v = new (K.camera.position.constructor)();
    if (av) {
      av.root.updateMatrixWorld(true);
      for (const m of av.meshes) {
        const g = m.geometry;
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
          v.fromBufferAttribute(p, i);
          m.localToWorld(v);
          if (v.y < minY) minY = v.y;
        }
      }
    }
    const lp = loco?.position;
    return {
      avatarRootY: av ? +av.root.position.y.toFixed(3) : null,
      avatarLowestVertexY: Number.isFinite(minY) ? +minY.toFixed(3) : null,
      locoPositionY: lp ? +lp.y.toFixed(3) : null,
      groundAt: +(T.groundY(lp.x, lp.z) ?? NaN).toFixed(3),
      capsuleHeight: loco?.tune?.capsuleHeight,
      capsuleRadius: loco?.tune?.capsuleRadius,
      grounded: loco?.grounded,
      contact: window.__vs.probe("lighting").contact,
    };
  });
  console.log(JSON.stringify(out, null, 2));
});
