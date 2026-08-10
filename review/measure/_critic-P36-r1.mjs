/**
 * CRITIC P36 round 1 — independent re-measurement. Drives the shipped app (real Vite, real boot
 * glob). Nothing here emits a gameplay signal; every observation is a passive listener registered
 * AFTER the shipped one, reading the request object the rig and the boot bridge already mutated.
 */
import { openGame } from "../../tools/lib/session.mjs";

const j = (v) => JSON.stringify(v);

await openGame({ width: 1280, height: 720 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }

  // Passive tap: registered after boot, so the shipped handler has already run when we read.
  await d.run(() => {
    const S = window.__vs.kernel.signals;
    const log = [];
    S.on("camera:probe", (req) => {
      log.push({
        handled: !!req.handled,
        hit: !!req.hit,
        distance: req.distance,
        maxDistance: req.maxDistance,
      });
      if (log.length > 4000) log.shift();
    });
    window.__crit = {
      probeLog: () => log.slice(),
      clear: () => (log.length = 0),
      cam: () => window.__vs.probe("camera"),
      lens: () => {
        const c = window.__vs.kernel.camera;
        return { px: c.position.x, py: c.position.y, pz: c.position.z, roll: c.rotation.z };
      },
      handlerCount: (n) => {
        const S = window.__vs.kernel.signals;
        const m = S._handlers ?? S.handlers ?? S._map ?? null;
        const set = m && typeof m.get === "function" ? m.get(n) : null;
        return set ? set.size : "unknown";
      },
    };
  });

  console.log("=== 1. camera:probe is answered by the shipped boot bridge ===");
  const step1 = await d.run(() => {
    const k = window.__vs.kernel;
    for (let i = 0; i < 60 * 4; i++) k.advance(1 / 60, { render: false });
    window.__crit.clear();
    for (let i = 0; i < 6; i++) k.advance(1 / 60, { render: false });
    const rows = window.__crit.probeLog();
    const c = window.__crit.cam();
    return {
      probeHandlerSetSize: window.__crit.handlerCount("camera:probe"),
      lastProbes: rows.slice(-4),
      anyHandled: rows.every((r) => r.handled),
      anyHit: rows.filter((r) => r.hit).length,
      of: rows.length,
      report: { source: c.collisionSource, free: c.freeDistance, allowed: c.allowedDistance, dist: c.distance },
    };
  });
  console.log(j(step1));

  console.log("\n=== 2. is the settled A/B pose actually a COLLIDING pose? ===");
  console.log("   (free < maxDistance on the probe request means the sphereCast really hit)");
  const step2 = await d.run(() => {
    const rows = window.__crit.probeLog().slice(-10);
    return rows.map((r) => ({ hit: r.hit, dist: Number(r.distance?.toFixed?.(4)), max: Number(r.maxDistance?.toFixed?.(4)) }));
  });
  console.log(j(step2));

  console.log("\n=== 3. drive: walk + look, count hits answered over the signal route ===");
  await d.run(() => window.__crit.clear());
  await d.hold("KeyW", 2.0);
  await d.look(500, 220);
  await d.hold(["KeyS"], 1.2);
  await d.look(-700, -120);
  const step3 = await d.run(() => {
    const rows = window.__crit.probeLog();
    const hits = rows.filter((r) => r.hit);
    const unhandled = rows.filter((r) => !r.handled);
    const dists = hits.map((r) => r.distance);
    return {
      probes: rows.length,
      handled: rows.length - unhandled.length,
      unhandled: unhandled.length,
      hits: hits.length,
      minHitDistance: dists.length ? Number(Math.min(...dists).toFixed(4)) : null,
      maxHitDistance: dists.length ? Number(Math.max(...dists).toFixed(4)) : null,
      source: window.__crit.cam().collisionSource,
    };
  });
  console.log(j(step3));

  console.log("\n=== 4. A/B at a COLLIDING pose: signal route vs duck-typed fallback ===");
  const step4 = await d.run(() => {
    const k = window.__vs.kernel;
    // Park somewhere the boom is genuinely blocked, then settle.
    for (let i = 0; i < 60 * 3; i++) k.advance(1 / 60, { render: false });
    const before = window.__crit.cam();
    window.__crit.clear();
    for (let i = 0; i < 4; i++) k.advance(1 / 60, { render: false });
    const wiredProbes = window.__crit.probeLog().slice(-4);
    k.get("cameraProbe").dispose();
    for (let i = 0; i < 12; i++) k.advance(1 / 60, { render: false });
    const after = window.__crit.cam();
    window.__crit.clear();
    for (let i = 0; i < 4; i++) k.advance(1 / 60, { render: false });
    const fallbackProbes = window.__crit.probeLog().slice(-4);
    return {
      wired: { src: before.collisionSource, free: before.freeDistance, allowed: before.allowedDistance, pos: before.position },
      fallback: { src: after.collisionSource, free: after.freeDistance, allowed: after.allowedDistance, pos: after.position },
      wiredProbeSample: wiredProbes.map((r) => ({ handled: r.handled, hit: r.hit, d: Number(r.distance?.toFixed?.(4)) })),
      fallbackProbeSample: fallbackProbes.map((r) => ({ handled: r.handled, hit: r.hit, d: Number(r.distance?.toFixed?.(4)) })),
    };
  });
  console.log(j(step4));

  console.log("\n=== 5. world:resonance — listener exists, emitter does not ===");
  const step5 = await d.run(() => {
    const S = window.__vs.kernel.signals;
    const lit = window.__vs.probe?.("lighting");
    return {
      inBootListenerSet: S.names().includes("world:resonance"),
      lightingProbeKeys: lit ? Object.keys(lit) : null,
      accents: lit?.accents ?? lit?.accentCount ?? null,
    };
  });
  console.log(j(step5));

  console.log("\n=== 6. camera:shake magnitude a player would actually see ===");
  const step6 = await d.run(() => {
    const k = window.__vs.kernel;
    const S = k.signals;
    let fired = null;
    const off = S.on("camera:shake", (e) => { if (!fired) fired = { ...e }; });
    const before = window.__crit.lens();
    let maxRoll = 0, maxPosJump = 0;
    let prev = before;
    for (let i = 0; i < 60 * 15; i++) {
      k.advance(1 / 60, { render: false });
      const L = window.__crit.lens();
      if (fired) {
        maxRoll = Math.max(maxRoll, Math.abs(L.roll));
        maxPosJump = Math.max(maxPosJump, Math.hypot(L.px - prev.px, L.py - prev.py, L.pz - prev.pz));
      }
      prev = L;
    }
    off();
    return { fired, maxRollRad: maxRoll, maxRollDeg: (maxRoll * 180) / Math.PI, maxPosJumpM: maxPosJump };
  });
  console.log(j(step6));

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "warnings:", rep.warnings.length);
  if (rep.errors.length) console.log(rep.errors.slice(0, 4));
});
