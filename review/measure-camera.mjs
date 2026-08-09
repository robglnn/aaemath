#!/usr/bin/env node
// P05 scratch measurement rig. Not part of the game — it drives the real app through the
// review session driver and prints numbers a critic can re-derive.
//
//   node review/measure-camera.mjs project     where does the body actually land on screen
//   node review/measure-camera.mjs settle      step responses + frame-rate independence
//   node review/measure-camera.mjs collide     boom against geometry: clipping and jitter
//   node review/measure-camera.mjs shake       trauma curve, reduceMotion honesty
//   node review/measure-camera.mjs shots       the evidence captures
//   node review/measure-camera.mjs all

import { openGame } from "../tools/lib/session.mjs";

const cmd = process.argv[2] ?? "all";
const V = (n, d = 4) => Number(Number(n).toFixed(d));

/**
 * Plants a rock pillar exactly where the camera currently sits by cloning the island mesh.
 * Test geometry, never shipped — it exists so the boom has something real to be pressed into.
 * Returns the pillar's placement so the clipping check can be done analytically.
 */
async function plantPillar(d, { scale = 0.06, nudge = [0, 0] } = {}) {
  return d.run(([sx, sy, nx, nz]) => {
    const k = window.__vs.kernel;
    let src = null;
    k.scene.traverse((o) => {
      if (!src && o.isMesh && o.geometry.type === "CylinderGeometry") src = o;
    });
    if (!src) throw new Error("no cylinder mesh to clone");
    const coll = k.get("collision");
    const groundY = coll.groundAt(0, 0)?.y ?? 0;

    // Registering any real collider retires the world's fallback ground plane, so bring our
    // own floor at exactly the same height first — the test needs a wall, not a hole.
    const floor = src.clone();
    floor.scale.set(4, 0.02, 4);
    floor.position.set(0, groundY - 0.14, 0);
    floor.updateMatrixWorld(true);
    coll.registerCollider({ id: "test-floor", mesh: floor });

    const cam = k.camera;
    const w = src.clone();
    w.scale.set(sx, sy, sx);
    w.position.set(cam.position.x + nx, 4, cam.position.z + nz);
    w.name = "test-pillar";
    w.updateMatrixWorld(true);
    k.scene.add(w);
    coll.registerCollider({ id: "test-pillar", mesh: w });

    return {
      x: w.position.x, y: w.position.y, z: w.position.z, sx, sy,
      groundY,
      collision: window.__vs.probe("collision"),
    };
  }, [scale, 1.25, nudge[0], nudge[1]]);
}

const removePillar = (d) =>
  d.run(() => {
    const k = window.__vs.kernel;
    const w = k.scene.getObjectByName("test-pillar");
    if (w) k.scene.remove(w);
    k.get("collision").registerCollider({ id: "test-pillar", remove: true });
    return true;
  });

/**
 * Sample the camera probe once per rendered slice while advancing.
 *
 * `t` is elapsed *render* time (the clock the camera's after(dt) hook actually integrates),
 * not `simTime` — simTime is quantised to the 60 Hz sim step and would introduce up to 16 ms
 * of phase error, which at the steep part of a step response reads as a 1.6° "error" that is
 * purely an artefact of the measuring clock.
 */
const SAMPLER = `
  const [total, slice] = arguments[0];
  const out = [];
  const n = Math.max(1, Math.round(total / slice));
  for (let i = 0; i < n; i++) {
    window.__vs.advance(slice);
    const c = window.__vs.probe("camera");
    out.push({
      t: (i + 1) * slice,
      simT: window.__vs.stats().simTime,
      fov: c.fov, dist: c.distance, allowed: c.allowedDistance, desired: c.desiredDistance,
      err: c.followError, occ: c.occluded, trauma: c.trauma, shake: c.shake,
      pos: c.position, tgt: c.target, speed: c.speed, grounded: c.grounded,
      lift: c.pivotLift, dip: c.pivotDip,
    });
  }
  return out;
`;

const sample = (d, seconds, slice) => d.page.evaluate(new Function(SAMPLER), [seconds, slice]);

/**
 * Stop the app's realtime animation loop so game time only moves when we advance it.
 * Left running, it interleaves wall-clock frames between our evaluate() calls — in headless
 * software GL those are 100–300 ms each, which shows up as phase error in a step response
 * and looks exactly like a spring that is not frame-rate independent.
 */
const quiet = (d) => d.run(() => (window.__vs.kernel.halt(), true));

/** Time for |value - final| to fall under 5% of the step and stay there. */
function settle95(series, pick, start, final) {
  const span = Math.abs(final - start);
  if (span < 1e-6) return 0;
  let t = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Math.abs(pick(series[i]) - final) > span * 0.05) {
      t = series[Math.min(i + 1, series.length - 1)].t;
      break;
    }
  }
  return t === null ? series[0].t : t;
}

// ---------------------------------------------------------------- projection

async function project() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.6, { release: false });
    const info = await d.run(() => {
      const k = window.__vs.kernel;
      const cam = k.camera;
      const rows = [];
      k.scene.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.getWorldPosition(new o.position.constructor());
        const ndc = p.clone().project(cam);
        o.geometry.computeBoundingSphere();
        rows.push({
          name: o.name || o.geometry.type,
          world: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
          ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3), +ndc.z.toFixed(3)],
          px: [Math.round((ndc.x * 0.5 + 0.5) * 1600), Math.round((-ndc.y * 0.5 + 0.5) * 900)],
          radius: +o.geometry.boundingSphere.radius.toFixed(2),
          scale: [+o.scale.x.toFixed(2), +o.scale.y.toFixed(2), +o.scale.z.toFixed(2)],
        });
      });
      const c = window.__vs.probe("camera");
      return { rows, cam: { pos: c.position, target: c.target, fov: c.fov, dist: c.distance } };
    });
    console.log(JSON.stringify(info, null, 1));
  });
}

// ------------------------------------------------------------------- settling

async function settle() {
  const out = {};

  // (a) FOV spring step response — a clean externally-driven step through camera:fov.
  await openGame({ width: 960, height: 540 }, async (d) => {
    await quiet(d);
    await d.play(1.0);
    for (const slice of [1 / 24, 1 / 60, 1 / 120]) {
      await d.run(() => window.__vs.kernel.signals.emit("camera:fov", { target: 62, seconds: 0.36 }));
      await d.play(1.2, 1 / 60);
      const start = (await d.probe("camera")).fov;
      await d.run(() => window.__vs.kernel.signals.emit("camera:fov", { target: 84, seconds: 0.36 }));
      const s = await sample(d, 1.2, slice);
      const final = s.at(-1).fov;
      const t0 = s[0].t - slice;
      // The whole point of the closed-form spring: every sample, at every rate, must sit on
      // the same analytic curve x(t) = (x0 + (v0 + w·x0)·t)·e^(-w·t) with v0 = 0.
      const w = 4.744 / 0.36;
      let maxDev = 0;
      for (const row of s) {
        const tt = row.t - t0;
        const analytic = final - (final - start) * (1 + w * tt) * Math.exp(-w * tt);
        maxDev = Math.max(maxDev, Math.abs(row.fov - analytic));
      }
      out[`fovStep@${V(1 / slice, 0)}fps`] = {
        start: V(start, 3),
        final: V(final, 3),
        settle95s: V(settle95(s, (r) => r.fov, start, final) - t0, 3),
        maxDeviationFromAnalyticDeg: V(maxDev, 5),
      };
    }
  });

  // (b) Follow spring: trail while sprinting, then the step response of a hard stop.
  await openGame({ width: 960, height: 540 }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.page.keyboard.down("KeyW");
    const run = await sample(d, 1.8, 1 / 60);
    await d.page.keyboard.up("KeyW");
    const stop = await sample(d, 1.5, 1 / 60);
    const t0 = stop[0].t - 1 / 60;
    out.sprintTrailM = V(run.at(-1).err, 3);
    out.sprintSpeed = V(run.at(-1).speed, 3);
    out.sprintPeakSpeed = V(Math.max(...run.map((r) => r.speed)), 3);
    out.restFov = V(run[0].fov, 2);
    out.sprintFov = V(run.at(-1).fov, 2);
    out.sprintDistance = V(run.at(-1).dist, 3);
    out.stopSettle95s = V(settle95(stop, (r) => r.err, run.at(-1).err, 0) - t0, 3);
    out.stopOvershootM = V(Math.max(...stop.map((r) => r.err)) - run.at(-1).err, 4);
  });

  // (c) Jump: does the pivot lift and the landing dip read?
  await openGame({ width: 960, height: 540 }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    const ground = (await d.probe("camera")).target[1];
    await d.page.keyboard.press("Space");
    const air = await sample(d, 1.6, 1 / 60);
    const landIndex = air.findIndex((r, i) => i > 6 && r.grounded);
    const after = landIndex >= 0 ? air.slice(landIndex) : [];
    out.jump = {
      groundPivotY: V(ground, 3),
      peakAirLiftM: V(Math.max(...air.map((r) => r.lift)), 3),
      peakPivotY: V(Math.max(...air.map((r) => r.tgt[1])), 3),
      airborneSeconds: V(air.filter((r) => !r.grounded).length / 60, 3),
      landingDipM: V(Math.min(...after.map((r) => r.dip)), 4),
      dipRecoverySeconds: V(
        (after.findIndex((r, i) => i > 4 && r.dip > -0.005) + 1) / 60,
        3
      ),
    };
  });

  console.log(JSON.stringify(out, null, 1));
}

// ------------------------------------------------------------------ collision

async function collide() {
  const out = {};
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    const before = await d.probe("camera");
    // Pillar centred exactly where the boom wants to sit.
    const pillar = await plantPillar(d);
    const s = await sample(d, 1.2, 1 / 60);
    const pressed = s.at(-1);

    // Two independent clipping checks.
    //  1. analytic: the injected pillar is a known cone, so compute the exact horizontal
    //     clearance between the camera position and its surface at the camera's height.
    //  2. empirical: ask the rig's own swept cast how far the nearest geometry is straight
    //     ahead of the camera. Anything closer than the near plane would be visibly clipped.
    const clearance = await d.run(([px, py, pz, sx, sy]) => {
      const k = window.__vs.kernel;
      const cam = k.camera;
      const rig = k.get("camera");
      // CylinderGeometry(52, 40, 14) scaled: radius lerps bottom→top over the height
      const h = 14 * sy;
      const y0 = py - h / 2;
      const f = Math.max(0, Math.min(1, (cam.position.y - y0) / h));
      const radius = (40 + (52 - 40) * f) * sx;
      const axial = Math.hypot(cam.position.x - px, cam.position.z - pz);
      const dir = cam.position.clone().set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      const ahead = rig._castFree(cam.position.clone(), dir, 60, 0.001, 5);
      const nearRadius = Math.hypot(
        Math.tan(((cam.fov / 2) * Math.PI) / 180) * cam.near,
        Math.tan(((cam.fov / 2) * Math.PI) / 180) * cam.near * cam.aspect
      );
      return {
        surfaceClearanceM: +(axial - radius).toFixed(4),
        aheadHitM: +ahead.toFixed(4),
        nearPlane: cam.near,
        nearPlaneRadiusM: +nearRadius.toFixed(4),
        insidePillar: axial < radius,
      };
    }, [pillar.x, pillar.y, pillar.z, pillar.sx, pillar.sy]);

    out.pressed = {
      distanceBefore: V(before.distance, 3),
      distanceAfter: V(pressed.dist, 3),
      allowed: V(pressed.allowed, 3),
      desired: V(pressed.desired, 3),
      occluded: pressed.occ,
      tightenFrames: s.findIndex((r) => r.dist < before.distance - 0.05),
      clearance,
      neverExceededAllowed: s.every((r) => r.dist <= r.allowed + 1e-6),
      colliders: pillar.collision.colliders,
      groundY: V(pillar.groundY, 3),
    };

    // Jitter: swap in a *thin* pillar set just off the boom, then sweep the yaw right across
    // its silhouette and back so the boom repeatedly crosses the occlusion boundary — the
    // exact place a naive rig oscillates.
    await removePillar(d);
    await d.play(1.5); // let the boom ease all the way back out first, or the next pillar
    await plantPillar(d, { scale: 0.018, nudge: [1.15, 0] }); // lands on top of the pivot
    await d.play(0.5);

    // Two look rates. The slow one is a brisk human mouse turn; the fast one is a whip that
    // moves the boom's tip a third of a metre per frame — worth reporting separately,
    // because "no jitter" and "no pop when geometry appears mid-boom" are different claims.
    out.graze = {};
    for (const [label, px, steps] of [
      ["slowSweep_90degPerSec", 24, 4],
      ["whip_250degPerSec", 66, 2],
    ]) {
      const jitter = [];
      for (let i = 0; i < 40; i++) {
        await d.look(i < 20 ? px : -px, 0, steps);
        jitter.push(...(await sample(d, 0.05, 1 / 60)));
      }
      let flips = 0;
      let maxStep = 0;
      const steps95 = [];
      for (let i = 2; i < jitter.length; i++) {
        const a = jitter[i].dist - jitter[i - 1].dist;
        const b = jitter[i - 1].dist - jitter[i - 2].dist;
        steps95.push(Math.abs(a));
        maxStep = Math.max(maxStep, Math.abs(a));
        if (a * b < -1e-6 && Math.abs(a) > 0.02) flips++;
      }
      steps95.sort((x, y) => x - y);
      out.graze[label] = {
        samples: jitter.length,
        occludedFrames: jitter.filter((r) => r.occ).length,
        distanceMin: V(Math.min(...jitter.map((r) => r.dist)), 3),
        distanceMax: V(Math.max(...jitter.map((r) => r.dist)), 3),
        medianFrameStepM: V(steps95[Math.floor(steps95.length * 0.5)], 4),
        p95FrameStepM: V(steps95[Math.floor(steps95.length * 0.95)], 4),
        maxFrameStepM: V(maxStep, 4),
        directionFlipsOver20mm: flips,
        neverExceededAllowed: jitter.every((r) => r.dist <= r.allowed + 1e-6),
        neverBelowMin: jitter.every((r) => r.dist >= 1.15 - 1e-6),
      };
    }

    // Release: press the boom fully home again, then take the obstacle away and time the
    // ease back out. Loosening must be slow, monotonic and free of bounce.
    await removePillar(d);
    await d.play(1.5);
    await plantPillar(d);
    await d.play(1.2);
    const held = (await d.probe("camera")).distance;
    await removePillar(d);
    const back = await sample(d, 2.0, 1 / 60);
    const t0 = back[0].t - 1 / 60;
    out.release = {
      fromM: V(held, 3),
      toM: V(back.at(-1).dist, 3),
      settle95s: V(settle95(back, (r) => r.dist, held, back.at(-1).dist) - t0, 3),
      monotonic: back.every((r, i) => i === 0 || r.dist >= back[i - 1].dist - 1e-6),
    };
  });
  console.log(JSON.stringify(out, null, 1));
}

// --------------------------------------------------------------------- shake

async function shake() {
  const out = {};
  await openGame({ width: 960, height: 540 }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    const base = (await d.probe("camera")).position;
    await d.run(() => window.__vs.kernel.signals.emit("camera:shake", { amount: 1, seconds: 0.9 }));
    const s = await sample(d, 1.4, 1 / 60);
    const offsets = s.map((r) => Math.hypot(r.pos[0] - base[0], r.pos[1] - base[1], r.pos[2] - base[2]));
    out.normal = {
      peakTrauma: V(Math.max(...s.map((r) => r.trauma)), 3),
      peakOffsetM: V(Math.max(...offsets), 4),
      offsetAt: {
        "0.0s": V(offsets[0], 4),
        "0.45s": V(offsets[Math.round(0.45 * 60)], 4),
        "0.9s": V(offsets[Math.round(0.9 * 60)] ?? 0, 4),
      },
      zeroAfterS: V(s.find((r) => r.trauma === 0)?.t - s[0].t + 1 / 60 || 0, 3),
      // Quadratic falloff, checked exactly rather than by eye: the published shake amplitude
      // must equal trauma² at every sample, so small trauma is genuinely invisible.
      maxDeviationFromTraumaSquared: V(
        Math.max(...s.map((r) => Math.abs(r.shake - r.trauma * r.trauma))),
        6
      ),
      // Peak offset per unit amplitude, i.e. the noise envelope. Should match shakePos.
      peakOffsetPerUnitShakeM: V(
        Math.max(...s.map((r, i) => (r.shake > 0.2 ? offsets[i] / r.shake : 0))),
        4
      ),
    };
  });

  await openGame({ width: 960, height: 540, query: { reduceMotion: "1" } }, async (d) => {
    await quiet(d);
    await d.play(0.8);
    const base = (await d.probe("camera")).position;
    await d.run(() => window.__vs.kernel.signals.emit("camera:shake", { amount: 1, seconds: 0.9 }));
    const s = await sample(d, 1.0, 1 / 60);
    const offsets = s.map((r) => Math.hypot(r.pos[0] - base[0], r.pos[1] - base[1], r.pos[2] - base[2]));
    const probe = await d.probe("camera");
    out.reduceMotion = {
      reported: probe.reduceMotion,
      shakeEnabled: probe.shakeEnabled,
      peakTrauma: V(Math.max(...s.map((r) => r.trauma)), 6),
      peakOffsetM: V(Math.max(...offsets), 6),
    };
    // and the speed-FOV swing must be gentler, not absent
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.6, { release: false });
    out.reduceMotion.sprintFov = V((await d.probe("camera")).fov, 2);
  });

  console.log(JSON.stringify(out, null, 1));
}

// --------------------------------------------------------------------- shots

async function shots() {
  const results = [];
  const cap = async (name, opts, body) => {
    // NB: no quiet() here. Screenshots need the compositor ticking; with the animation loop
    // halted, page.screenshot() waits forever for a frame that never gets committed.
    await openGame({ width: 1600, height: 900, ...opts }, async (d) => {
      await d.play(0.8);
      await body(d);
      try {
        await d.shoot(`review/shots/p05/${name}.png`);
      } catch {
        // Software GL occasionally misses a compositor frame; nudge it and try once more.
        await d.play(0.2);
        await d.shoot(`review/shots/p05/${name}.png`);
      }
      const rep = await d.report();
      const c = rep.probes.camera ?? {};
      results.push({
        name,
        problems: [
          ...(rep.errors ?? []),
          ...d.consoleErrors,
          ...d.failedRequests,
          ...(rep.ready ? [] : ["not ready"]),
        ],
        camera: {
          pos: c.position, target: c.target, dist: c.distance, allowed: c.allowedDistance,
          fov: c.fov, occluded: c.occluded, trauma: c.trauma, shake: c.shake,
          speed: c.speed, grounded: c.grounded, lift: c.pivotLift, dip: c.pivotDip,
          yaw: c.yaw, pitch: c.pitch, focus: c.focus,
        },
      });
      // Printed per capture, not at the end: a late timeout must not lose the earlier rows.
      console.log(JSON.stringify(results.at(-1)));
    });
  };

  await cap("10-sprint", {}, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.8, { release: false });
  });

  await cap("11-hard-turn", {}, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.2, { release: false });
    await d.look(520, -30, 10);
    await d.play(0.28);
  });

  await cap("12-jump", {}, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.0, { release: false });
    await d.page.keyboard.press("Space");
    await d.play(0.34);
  });

  await cap("13-landing", {}, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.0, { release: false });
    await d.page.keyboard.press("Space");
    await d.play(0.92);
  });

  await cap("14-wall-press", {}, async (d) => {
    await plantPillar(d);
    await d.play(1.0);
  });

  // A tighter press: the pillar surface sits ~2 m behind the pivot, so the boom is squeezed
  // to roughly a third of its length without the camera ever entering the rock.
  await cap("15-wall-press-close", {}, async (d) => {
    await plantPillar(d, { scale: 0.03, nudge: [0, -1.15] });
    await d.play(1.2);
  });

  await cap("16-focus", {}, async (d) => {
    // A stand-in for a learning object: the framing claim is that the target reads *and*
    // the player stays readable, which needs something in the world to frame.
    await d.run(() => {
      const k = window.__vs.kernel;
      let src = null;
      k.scene.traverse((o) => {
        if (!src && o.isMesh && o.geometry.type === "CylinderGeometry") src = o;
      });
      const p = k.get("locomotion").getCameraTarget().getWorldPosition(k.camera.position.clone());
      const prop = src.clone();
      prop.scale.set(0.02, 0.16, 0.02);
      prop.position.set(p.x - 6.5, p.y + 1.4, p.z - 7.5);
      prop.name = "focus-prop";
      prop.updateMatrixWorld(true);
      k.scene.add(prop);
      k.signals.emit("camera:focus", {
        target: { x: prop.position.x, y: prop.position.y + 0.6, z: prop.position.z },
        seconds: 0.8,
      });
      return true;
    });
    await d.play(1.8);
  });

  await cap("17-shake", {}, async (d) => {
    await d.run(() => {
      window.__vs.kernel.signals.emit("camera:shake", { amount: 1, seconds: 6 });
      return true;
    });
    await d.play(0.18);
  });

  // Pitch fully up drives the boom down into the terrain: the ground is the most common
  // occluder in the game and the one a rig is most likely to sink through.
  await cap("18-pitch-into-ground", {}, async (d) => {
    await d.look(0, -700, 14);
    await d.play(0.9);
  });

  await cap("19-sprint-2560", { width: 2560, height: 1440 }, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.8, { release: false });
  });

  await cap("20-sprint-720p", { width: 1280, height: 720 }, async (d) => {
    await d.hold("ShiftLeft", 0.05, { release: false });
    await d.hold("KeyW", 1.8, { release: false });
  });

}

// ---------------------------------------------------------------------- cost

/** What the rig costs per frame on its own, separated from the rest of the frame. */
async function cost() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await quiet(d);
    await d.play(1.0);
    const r = await d.run(() => {
      const rig = window.__vs.kernel.get("camera");
      const bench = (n) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) rig.after(1 / 60);
        return (performance.now() - t0) / n;
      };
      bench(200); // warm
      const withCollision = bench(2000);
      const casts = [];
      const orig = rig._castFree.bind(rig);
      rig._castFree = (o, dd, m) => (casts.push(1), m);
      const withoutCollision = bench(2000);
      rig._castFree = orig;
      return {
        msPerFrame: +withCollision.toFixed(4),
        msPerFrameWithoutCasts: +withoutCollision.toFixed(4),
        castsPerFrame: casts.length / 2000,
      };
    });
    console.log(JSON.stringify(r, null, 1));
  });
}

const table = { project, settle, collide, shake, cost, shots };
if (cmd === "all") {
  for (const k of Object.keys(table)) {
    console.log(`\n===== ${k} =====`);
    await table[k]();
  }
} else if (table[cmd]) {
  await table[cmd]();
} else {
  console.error(`unknown: ${cmd}. try ${Object.keys(table).join(", ")}`);
  process.exit(2);
}
