/**
 * P36 round 2 — `world:resonance`, proved on the shipped app.
 *
 * The seam: `world/Lighting.js:624` subscribed to `world:resonance` and NOTHING in the repository
 * emitted it. Its two handler bodies (`addAccent` / `removeAccent`) had no other caller, so the
 * accent pool — six `PointLight`s allocated at boot on the `high` tier, the only saturated light
 * `art-direction.md` §5.4 permits in this world — sat at intensity 0 for the life of the project.
 *
 * ## The measurement trap this file is built around
 *
 * The warning in this wave's brief was earned by a probe attached to a node that never rotates.
 * The same trap is live here: `Lighting.report()` could report an accent count that agrees with a
 * `Map` while every actual light stayed dark, and nobody would know. So every number below is read
 * TWICE, from two different places:
 *
 *   * the derived side — `__vs.probe("lighting").accents`, Lighting's own bookkeeping;
 *   * the raw side — a walk of `kernel.scene` collecting every `PointLight` named `vs.accent.N`,
 *     printing `intensity`, `distance` and world position straight off the Object3D the renderer
 *     draws with.
 *
 * If those two ever disagree, the derived number is the one that is lying.
 *
 * ## Nothing here emits a gameplay signal
 *
 * Every `world:resonance` counted below was produced by `boot/60-mathtex.js` in response to the
 * game standing a claim in the world — four at spawn, and the presenter's own when the player
 * presses E. The harness only subscribes and reads transforms. The one thing it CALLS is
 * `dispose()` on the bridge, which is the A/B: same session, same pose, the emitter removed and
 * nothing else changed.
 *
 *   node review/measure/P36-resonance.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

const j = (v) => JSON.stringify(v);

/** Installed in the page. Reads the raw lights and the derived probe in the same tick. */
const INSTALL = () => {
  const k = window.__vs.kernel;
  const S = k.signals;

  const resonance = [];
  S.on("world:resonance", (e) =>
    resonance.push({
      step: k.stepCount,
      id: e?.id ?? null,
      active: e?.active !== false,
      position: e?.position ? e.position.map((v) => Number(v.toFixed(2))) : null,
      radius: e?.radius ?? null,
      strength: e?.strength ?? null,
    })
  );

  const rawLights = () => {
    const out = [];
    k.scene.traverse((o) => {
      if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "")) return;
      const p = new o.position.constructor();
      o.getWorldPosition(p);
      out.push({
        name: o.name,
        intensity: Number(o.intensity.toFixed(4)),
        distance: Number(o.distance.toFixed(2)),
        at: [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))],
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };

  window.__p36r = {
    resonance: () => resonance.slice(),
    rawLights,
    lit: () => rawLights().filter((l) => l.intensity > 0),
    derived: () => window.__vs.probe("lighting").accents,
    claims: () => window.__vs.probe("mathtex").panels.map((p) => ({ id: p.id, at: p.position })),
    step: (n) => {
      for (let i = 0; i < n; i++) k.advance(1 / 60, { render: false });
    },
    snapshot: () => ({
      derived: window.__p36r.derived(),
      raw: rawLights(),
      claims: window.__p36r.claims(),
    }),
  };
};

// ==================================================================== session 1: the spawn claims
await openGame({ width: 1280, height: 720 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready", boot.errors?.slice(0, 3));
    process.exitCode = 1;
    return;
  }
  await d.run(INSTALL);

  console.log("=== world:resonance — boot/60-mathtex.js (NEW emitter) -> world/Lighting.js:624 ===");
  console.log("Four claims stand at spawn; their view anchors resolve at simTime 0.25.\n");

  const cold = await d.run(() => window.__p36r.snapshot());
  console.log("at install (pre-roll) ", j({ derived: cold.derived, litLights: cold.raw.filter((l) => l.intensity > 0).length }));

  const settled = await d.run(() => {
    window.__p36r.step(60);
    return window.__p36r.snapshot();
  });
  console.log("\nDERIVED  probe('lighting').accents", j(settled.derived));
  console.log("CLAIMS   probe('mathtex').panels  ", j(settled.claims));
  console.log("RAW      accent PointLights, straight off the scene graph:");
  for (const l of settled.raw) console.log("        ", j(l));

  /**
   * A/B — same session, same pose, the emitter taken out and nothing else touched.
   *
   * The bridge has to leave `kernel.systems` as well as run its `dispose()`: `Kernel.mount` keeps
   * the system in the frame list forever, so calling `dispose()` alone retires the four accents and
   * then the very next `after()` puts them straight back. The first run of this harness did exactly
   * that and reported "no change", which would have read as "the accents were never coming from
   * here" — the same false negative this whole wave exists to stop.
   */
  console.log("\n=== A/B: same session, same pose, the emitter removed ===");
  const ab = await d.run(() => {
    const k = window.__vs.kernel;
    const before = { derived: window.__p36r.derived(), lit: window.__p36r.lit() };
    const bridge = k.get("mathresonance");
    k.systems.splice(k.systems.indexOf(bridge), 1);
    bridge.dispose();
    window.__p36r.step(12);
    const after = { derived: window.__p36r.derived(), lit: window.__p36r.lit() };
    return { before, after, claimsStillStanding: window.__p36r.claims().map((c) => c.id) };
  });
  console.log("emitter mounted   ", j({ accents: ab.before.derived, litLights: ab.before.lit.length, peak: ab.before.lit[0]?.intensity ?? 0 }));
  console.log("emitter removed   ", j({ accents: ab.after.derived, litLights: ab.after.lit.length, peak: ab.after.lit[0]?.intensity ?? 0 }));
  console.log("claims unchanged  ", j(ab.claimsStillStanding), "— the mathematics is still standing; only the spill went out");

  const emits = await d.run(() => window.__p36r.resonance());
  console.log("\nworld:resonance payloads this harness observed on the bus:");
  for (const e of emits) console.log("        ", j(e));
  console.log(
    emits.length
      ? ""
      : "        (none — the four spawn claims stood before this harness could subscribe; see session 2)"
  );

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
  if (rep.errors.length) console.log(rep.errors.slice(0, 5));
});

// ==================================================================== session 2: the learning path
await openGame({ width: 1280, height: 720 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED (teaching leg)", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  await d.run(INSTALL);
  await d.run(() => window.__p36r.step(60));

  console.log("\n=== the same seam on the gameplay path: press E, the presenter takes the field ===");
  const before = await d.run(() => window.__p36r.snapshot());
  console.log("before E  ", j({ accents: before.derived, claims: before.claims.map((c) => c.id) }));

  // A real key press through the real Input layer: KeyE -> `input:action {interact}` ->
  // boot/92-teaching.js -> Teaching.begin() -> `math:show` -> the field -> `world:resonance`.
  await d.hold("KeyE", 0.3);
  await d.run(() => window.__p36r.step(120));

  const after = await d.run(() => window.__p36r.snapshot());
  console.log("after  E  ", j({ accents: after.derived, claims: after.claims.map((c) => c.id) }));
  console.log("RAW accent PointLights once the presenter owns the field:");
  for (const l of after.raw) console.log("        ", j(l));

  const emits = await d.run(() => window.__p36r.resonance());
  const stood = [...new Set(emits.filter((e) => e.active).map((e) => e.id))];
  const retired = [...new Set(emits.filter((e) => !e.active).map((e) => e.id))];
  console.log("\nresonance emits:", emits.length, "\n  stood  :", j(stood), "\n  retired:", j(retired));
  console.log("full payloads, every one of them emitted by boot/60-mathtex.js and by nothing else:");
  for (const e of emits) console.log("        ", j(e));

  const teaching = await d.probe("teaching");
  console.log("teaching probe    ", j({ open: teaching?.open ?? null, phase: teaching?.phase ?? null, shows: teaching?.stats?.shows ?? null }));

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
  if (rep.errors.length) console.log(rep.errors.slice(0, 5));
});
