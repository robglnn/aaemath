/**
 * CRITIC-OWNED, round 2 — the same zero-time A/B, but on the GAMEPLAY path rather than at spawn.
 * The builder's own script shows pressing E hands the field to the teaching presenter and a single
 * `teach-claim` accent lights. If that one is also worth zero pixels, the seam is inert everywhere a
 * player can put it, not only at spawn.
 *
 * usage: node review/measure/_critic-P36-r2-frame-e.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  await d.play(1.5);
  await d.page.keyboard.press("KeyE");
  await d.play(1.5);

  const out = await d.run(() => {
    const k = window.__vs.kernel;
    k.halt();
    const L = k.get("lighting");
    const gl = k.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const snap = () => {
      k.advance(0);
      const b = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    const diff = (a, b) => {
      let changed = 0;
      let maxd = 0;
      for (let i = 0; i < a.length; i += 4) {
        const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (m > 0) changed++;
        if (m > maxd) maxd = m;
      }
      return { pixelsChanged: changed, percentChanged: +((100 * changed) / (a.length / 4)).toFixed(4), maxChannelDelta: maxd };
    };

    const accents = window.__vs.probe("lighting")?.accents;
    const claims = [];
    k.scene.traverse((o) => {
      if (o.isPointLight && /^vs\.accent\./.test(o.name ?? "") && o.intensity > 0) {
        const p = o.getWorldPosition(new o.position.constructor());
        claims.push({ n: o.name, i: +o.intensity.toFixed(3), at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
      }
    });
    const pos = window.__vs.probe("locomotion")?.position ?? null;
    const col = k.get("collision");
    const below = claims.map((c) => {
      const g = col.groundAt(c.at[0], c.at[2]);
      return { light: c.n, metresAboveGround: g.hit ? +(c.at[1] - g.y).toFixed(2) : null };
    });

    const A0 = snap();
    const A1 = snap();
    const realAdd = L.addAccent;
    const had = L._accents.size;
    L.addAccent = () => {};
    L._accents.clear();
    const B = snap();
    L.addAccent = realAdd;

    return {
      accents,
      litLights: claims,
      playerAt: pos,
      below,
      had,
      control: diff(A0, A1),
      treatment: diff(A1, B),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  const rep = await d.report();
  console.log("errors:", rep.errors.length, "| warnings:", rep.warnings.length);
});
