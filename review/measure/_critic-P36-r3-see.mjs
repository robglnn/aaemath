/**
 * CRITIC P36 round 3 — would a real player SEE world:resonance?
 *
 * Independent of the builder's script. Differences on purpose:
 *   * accents are retired through the DOCUMENTED signal (`world:resonance {id, active:false}`),
 *     not by deleting entries out of Lighting's private `_accents` map. If the signal cannot turn
 *     its own feature off, the seam is not the thing being measured.
 *   * the diff is reported at perceptual thresholds, not just "any non-zero channel".
 *   * real PNG frames are written for both arms so a human can look.
 *   * the gameplay path is measured at the pose a player is actually in, and while walking
 *     toward the claims, not only at the spawn framing.
 *
 * usage: node review/measure/_critic-P36-r3-see.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

const OUT = "review/measure/_p36crit/r3";

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready", boot.errors?.slice(0, 3));
    process.exitCode = 1;
    return;
  }

  // instrument the bus WITHOUT emitting anything ourselves
  await d.run(() => {
    const S = window.__vs.kernel.signals;
    const raw = S.emit.bind(S);
    const log = [];
    S.emit = (n, v) => {
      if (n === "world:resonance") log.push(JSON.parse(JSON.stringify(v ?? null)));
      return raw(n, v);
    };
    window.__crit = { resonanceLog: () => log, raw };
  });

  await d.play(2);

  const harness = () => {
    const k = window.__vs.kernel;
    const gl = k.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const snap = () => {
      k.advance(0);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    const diff = (a, b) => {
      const px = a.length / 4;
      const buckets = { any: 0, ge2: 0, ge4: 0, ge8: 0, ge16: 0 };
      let maxd = 0;
      let sum = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let i = 0; i < a.length; i += 4) {
        const m = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2])
        );
        if (m > maxd) maxd = m;
        sum += m;
        if (m > 0) {
          buckets.any++;
          if (m >= 2) buckets.ge2++;
          if (m >= 4) buckets.ge4++;
          if (m >= 8) buckets.ge8++;
          if (m >= 16) buckets.ge16++;
          const p = i / 4, x = p % w, y = Math.floor(p / w);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return {
        of: px,
        ...buckets,
        pctAny: +((100 * buckets.any) / px).toFixed(4),
        pctGe8: +((100 * buckets.ge8) / px).toFixed(4),
        maxChannelDelta: maxd,
        meanChannelDelta: +(sum / px).toFixed(5),
        // buffer y is measured from the BOTTOM; convert to top-left screen coords too
        boxBuf: buckets.any ? [minX, minY, maxX, maxY] : null,
        boxScreenTopLeft: buckets.any ? [minX, h - 1 - maxY, maxX, h - 1 - minY] : null,
      };
    };
    return { w, h, snap, diff };
  };

  const measure = async (label) => {
    const r = await d.run((fnSrc) => {
      const k = window.__vs.kernel;
      k.halt();
      // eslint-disable-next-line no-new-func
      const { snap, diff, w, h } = new Function("return (" + fnSrc + ")")()();
      const S = k.signals;
      const L = k.get("lighting");
      const before = window.__vs.probe("lighting")?.accents;
      const ids = [...(before?.ids ?? [])];

      const A0 = snap();
      const A1 = snap();
      const control = diff(A0, A1);

      // retire every accent through the PUBLIC signal
      for (const id of ids) window.__crit.raw("world:resonance", { id, active: false });
      const B = snap();
      const off = window.__vs.probe("lighting")?.accents;
      const treatment = diff(A1, B);

      return {
        w, h,
        simTime: +k.simTime.toFixed(3),
        camera: window.__vs.probe("camera")?.position,
        accentsBefore: before,
        accentsAfterRetire: off,
        control,
        treatment,
        signalCanRetire: (off?.lit ?? -1) === 0 && (off?.registered ?? -1) === 0,
      };
    }, harness.toString());
    console.log("\n### " + label);
    console.log(JSON.stringify(r, null, 1));
    return r;
  };

  // ---------------- spawn framing
  const spawn = await measure("spawn framing (halted, zero-time A/B, retired via signal)");
  console.log("world:resonance payloads seen on the bus:",
    JSON.stringify(await d.run(() => window.__crit.resonanceLog()), null, 1));

  // frames for the eye
  await d.run(() => {
    const k = window.__vs.kernel;
    k.advance(0);
  });
  await d.shoot(OUT + "-off.png");
  await d.run(() => {
    // put them back the way the emitter does, then let the emitter re-reconcile
    const k = window.__vs.kernel;
    k.resume?.();
  });
  await d.play(0.5);
  await d.run(() => window.__vs.kernel.halt());
  await d.shoot(OUT + "-on.png");
  const backOn = await d.run(() => window.__vs.probe("lighting")?.accents);
  console.log("\naccents after resume+0.5s (emitter re-reconciles?):", JSON.stringify(backOn));

  // ---------------- gameplay path: press E, then walk toward the claims
  await d.run(() => window.__vs.kernel.resume?.());
  await d.hold("KeyE", 0.15);
  await d.play(1.2);
  const afterE = await measure("after pressing E (the state a player is actually in)");

  await d.run(() => window.__vs.kernel.resume?.());
  await d.hold("KeyW", 4);
  await d.play(0.5);
  const walked = await measure("after walking 4 s forward");

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
  if (rep.errors.length) console.log(rep.errors.slice(0, 5));

  console.log("\nSUMMARY");
  for (const [k, v] of [["spawn", spawn], ["afterE", afterE], ["walked", walked]]) {
    console.log(
      k.padEnd(8),
      "control", String(v.control.any).padStart(6),
      "| treatment any", String(v.treatment.any).padStart(6),
      "ge8", String(v.treatment.ge8).padStart(6),
      "ge16", String(v.treatment.ge16).padStart(6),
      "| max", String(v.treatment.maxChannelDelta).padStart(4),
      "| signalCanRetire", v.signalCanRetire
    );
  }
});
