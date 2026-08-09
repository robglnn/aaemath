// P05 measurement rig — numbers only, no pixels. Every measurement runs inside a single
// page.evaluate so no wall-clock await can contaminate game time, and the kernel is halted
// first so nothing but the explicit advance() calls moves the world.
//
//   node review/p05-measure.mjs framerate
//   node review/p05-measure.mjs speed
//   node review/p05-measure.mjs corner
//   node review/p05-measure.mjs settle
//   node review/p05-measure.mjs reduce
//   node review/p05-measure.mjs framing

import { openGame } from "../tools/lib/session.mjs";

const which = process.argv[2] ?? "all";
const out = (label, value) => console.log(label + " " + JSON.stringify(value, null, 2));

// --------------------------------------------------------------------------- framerate

async function framerate() {
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    const r = await d.run(() => {
      const k = window.__vs.kernel;
      k.halt();
      const rig = k.get("camera");
      const obj = new k.scene.constructor(); // a bare Object3D the rig can follow
      rig._targetObject = obj;

      const V = 8;
      const RUN = 3.0; // seconds of constant-velocity motion
      const HOLD = 2.0; // seconds parked, to compare the settled pose
      const rates = [15, 30, 60, 144, 240];
      const res = {};

      for (const fps of rates) {
        const dt = 1 / fps;
        obj.position.set(0, 1.02, 0);
        rig._primed = false;
        rig._hasLastTarget = false;
        rig._speedValid = false;
        rig.yaw = 0;
        rig.pitch = -0.11;
        rig.distSpring.snap(rig.distanceBase);
        rig.fovSpring.snap(62);
        rig.follow[0].snap(0);
        rig.follow[1].snap(0);
        rig.follow[2].snap(0);

        const n = Math.round(RUN / dt);
        const trail = [];
        const jump = [];
        let px = null, py = null, pz = null;
        for (let i = 0; i < n; i++) {
          obj.position.x += V * dt;
          rig.after(dt);
          if (i > n * 0.6) {
            trail.push(rig._followError);
            const c = rig.camera.position;
            if (px !== null) jump.push(Math.hypot(c.x - px, c.y - py, c.z - pz) / dt);
            px = c.x; py = c.y; pz = c.z;
          }
        }
        const mean = trail.reduce((a, b) => a + b, 0) / trail.length;
        const jm = jump.reduce((a, b) => a + b, 0) / jump.length;
        const jsd = Math.sqrt(jump.reduce((a, b) => a + (b - jm) * (b - jm), 0) / jump.length);

        // parked: the settled pose must be identical at every rate
        const m = Math.round(HOLD / dt);
        for (let i = 0; i < m; i++) rig.after(dt);
        const c = rig.camera.position;

        res[fps] = {
          trail: Number(mean.toFixed(4)),
          camSpeedMean: Number(jm.toFixed(4)),
          camSpeedSd: Number(jsd.toFixed(6)),
          settledRel: [
            Number((c.x - obj.position.x).toFixed(4)),
            Number((c.y - obj.position.y).toFixed(4)),
            Number((c.z - obj.position.z).toFixed(4)),
          ],
          settledBoom: Number(rig.distSpring.value.toFixed(4)),
          settledFov: Number(rig.camera.fov.toFixed(4)),
        };
      }
      const trails = rates.map((f) => res[f].trail);
      return {
        ideal2vOverW: Number((2 * V / (4.744 / 0.2)).toFixed(4)),
        perRate: res,
        trailSpread: Number((Math.max(...trails) - Math.min(...trails)).toFixed(4)),
      };
    });
    out("FRAMERATE", r);
  });
}

// --------------------------------------------------------------------------- speed

async function speed() {
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    await d.run(() => window.__vs.kernel.halt());
    await d.page.keyboard.down("ShiftLeft");
    await d.page.keyboard.down("KeyW");
    const r = await d.run(() => {
      for (let i = 0; i < 300; i++) window.__vs.advance(1 / 60);
      const loco = window.__vs.probe("locomotion");
      const cam = window.__vs.probe("camera");
      return {
        realSpeed: Math.hypot(loco.velocity[0], loco.velocity[2]),
        rigSpeed: cam.speed,
        speedMeasured: cam.speedMeasured,
        speedSignal: cam.speedSignal,
        speedSignalAge: cam.speedSignalAge,
        fov: cam.fov,
        boom: cam.distance,
        desired: cam.desiredDistance,
      };
    });
    await d.page.keyboard.up("KeyW");
    await d.page.keyboard.up("ShiftLeft");
    out("SPEED", r);
  });
}

// --------------------------------------------------------------------------- corner

/**
 * Drive the body into the proving ground's inside corner with movement input only, then sweep
 * the camera a full turn and, at every sample, ask the geometry directly whether the lens is
 * inside a wall. Two independent tests:
 *   inBox      — exact containment in the two corner colliders (catches deep penetration)
 *   nearClear  — nothing within the near-plane corner radius of the lens (catches any clip)
 */
async function corner() {
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    // Placed 2.7 m out on the corner's diagonal, then *walked* in: the jam itself is movement
    // plus the collision solver, not a teleport into the geometry.
    await d.run(() => {
      window.__vs.kernel.halt();
      window.__vs.kernel.get("locomotion").teleport(-36.5, 1.05, 27.5, { heading: [-0.707, -0.707] });
      window.__vs.kernel.get("camera").yaw = Math.PI / 4;
      for (let i = 0; i < 60; i++) window.__vs.advance(1 / 60);
    });
    await d.page.keyboard.down("KeyW");
    await d.run(() => {
      for (let i = 0; i < 150; i++) window.__vs.advance(1 / 60);
    });
    const jammed = await d.run(() => window.__vs.probe("locomotion").position);
    await d.page.keyboard.up("KeyW");
    await d.run(() => {
      for (let i = 0; i < 40; i++) window.__vs.advance(1 / 60);
    });

    // Now sweep a full turn with the real look path while the body stays in the corner.
    const sweep = await d.run(() => {
      const k = window.__vs.kernel;
      const col = k.get("collision");
      const cam = k.camera;
      const BOXES = [
        { x0: -40, x1: -31, y0: -0.38, y1: 3.12, z0: 24, z1: 25.2 },
        { x0: -40, x1: -38.8, y0: -0.38, y1: 3.12, z0: 24, z1: 33 },
      ];
      const depth = (p) => {
        let worst = 0;
        for (const b of BOXES) {
          const dx = Math.min(p.x - b.x0, b.x1 - p.x);
          const dy = Math.min(p.y - b.y0, b.y1 - p.y);
          const dz = Math.min(p.z - b.z0, b.z1 - p.z);
          if (dx > 0 && dy > 0 && dz > 0) worst = Math.max(worst, Math.min(dx, dy, dz));
        }
        return worst;
      };
      const rows = [];
      const STEPS = 64;
      for (let i = 0; i < STEPS; i++) {
        k.signals.emit("input:look", { dx: -(Math.PI * 2) / STEPS, dy: 0 });
        for (let s = 0; s < 12; s++) window.__vs.advance(1 / 60);
        const c = window.__vs.probe("camera");
        const half = Math.tan((cam.fov * Math.PI) / 360) * cam.near;
        const nearR = Math.hypot(half, half * cam.aspect);
        rows.push({
          i,
          yaw: c.yaw,
          boom: c.distance,
          free: c.freeDistance,
          allowed: c.allowedDistance,
          penetrating: c.penetrating,
          opacity: c.avatarOpacity,
          framing: c.framing,
          inBoxDepth: Number(depth(cam.position).toFixed(4)),
          nearBlocked: col._sphereOverlaps(cam.position.x, cam.position.y, cam.position.z, nearR),
          nearR: Number(nearR.toFixed(4)),
          pos: [
            Number(cam.position.x.toFixed(3)),
            Number(cam.position.y.toFixed(3)),
            Number(cam.position.z.toFixed(3)),
          ],
        });
      }
      const bad = rows.filter((r) => r.inBoxDepth > 0 || r.nearBlocked || r.penetrating);
      const minBoom = Math.min(...rows.map((r) => r.boom));
      return {
        player: window.__vs.probe("locomotion").position,
        samples: rows.length,
        insideWallSamples: bad.length,
        worstInBoxDepth: Math.max(...rows.map((r) => r.inBoxDepth)),
        anyNearBlocked: rows.some((r) => r.nearBlocked),
        anyPenetrating: rows.some((r) => r.penetrating),
        minBoom: Number(minBoom.toFixed(4)),
        booms: rows.map((r) => Number(r.boom.toFixed(2))),
        frees: rows.map((r) => Number(r.free.toFixed(2))),
        minOpacity: Number(Math.min(...rows.map((r) => r.opacity)).toFixed(3)),
        tightSamples: rows.filter((r) => r.framing === "tight").length,
        worstRows: rows
          .slice()
          .sort((a, b) => a.boom - b.boom)
          .slice(0, 5),
      };
    });
    // Occlusion recovery: walk back out of the corner and watch the boom ease out. A pop shows
    // up as a camera world speed far above the body's own, or as the boom oscillating.
    await d.page.keyboard.down("KeyW");
    const recovery = await d.run(() => {
      const k = window.__vs.kernel;
      // Turn around the way a player does — over a fifth of a second, through input:look —
      // so the measurement is of the rig recovering, not of an instantaneous yaw teleport.
      for (let i = 0; i < 12; i++) {
        k.signals.emit("input:look", { dx: -Math.PI / 12, dy: 0 });
        window.__vs.advance(1 / 60);
      }
      const rows = [];
      let prev = k.camera.position.clone();
      for (let i = 0; i < 150; i++) {
        window.__vs.advance(1 / 60);
        const c = window.__vs.probe("camera");
        const now = k.camera.position;
        rows.push({
          t: (i + 1) / 60,
          boom: c.distance,
          free: c.freeDistance,
          camSpeed: prev.distanceTo(now) * 60,
          penetrating: c.penetrating,
        });
        prev = now.clone();
      }
      let flips = 0;
      for (let i = 2; i < rows.length; i++) {
        const a = rows[i].boom - rows[i - 1].boom;
        const b = rows[i - 1].boom - rows[i - 2].boom;
        if (a * b < 0 && Math.abs(a) > 0.002 && Math.abs(b) > 0.002) flips++;
      }
      const settled = rows.find((r, i) => rows.slice(i).every((q) => q.boom > 4.5));
      return {
        boomStart: Number(rows[0].boom.toFixed(4)),
        boomEnd: Number(rows[rows.length - 1].boom.toFixed(4)),
        secondsToFullBoom: settled ? settled.t : null,
        maxCamSpeed: Number(Math.max(...rows.map((r) => r.camSpeed)).toFixed(3)),
        directionFlips: flips,
        anyPenetrating: rows.some((r) => r.penetrating),
      };
    });
    await d.page.keyboard.up("KeyW");
    out("CORNER", { jammed, sweep, recovery });
  });
}

/** Movement-only reproduction of the original failure: back into the corner, camera leading. */
async function backin() {
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    await d.run(() => {
      window.__vs.kernel.halt();
      window.__vs.kernel.get("locomotion").teleport(-36.0, 1.05, 28.0, { heading: [0.707, 0.707] });
      // Camera faces away from the corner, so the boom leads the body straight into it.
      window.__vs.kernel.get("camera").yaw = Math.PI / 4 + Math.PI;
      for (let i = 0; i < 60; i++) window.__vs.advance(1 / 60);
    });
    await d.page.keyboard.down("KeyS");
    const r = await d.run(() => {
      const k = window.__vs.kernel;
      const col = k.get("collision");
      const cam = k.camera;
      const BOXES = [
        { x0: -40, x1: -31, y0: -0.38, y1: 3.12, z0: 24, z1: 25.2 },
        { x0: -40, x1: -38.8, y0: -0.38, y1: 3.12, z0: 24, z1: 33 },
      ];
      const depth = (p) => {
        let worst = 0;
        for (const b of BOXES) {
          const dx = Math.min(p.x - b.x0, b.x1 - p.x);
          const dy = Math.min(p.y - b.y0, b.y1 - p.y);
          const dz = Math.min(p.z - b.z0, b.z1 - p.z);
          if (dx > 0 && dy > 0 && dz > 0) worst = Math.max(worst, Math.min(dx, dy, dz));
        }
        return worst;
      };
      let worst = 0;
      let blocked = 0;
      let pen = 0;
      for (let i = 0; i < 240; i++) {
        window.__vs.advance(1 / 60);
        const c = window.__vs.probe("camera");
        const half = Math.tan((cam.fov * Math.PI) / 360) * cam.near;
        const nearR = Math.hypot(half, half * cam.aspect);
        worst = Math.max(worst, depth(cam.position));
        if (col._sphereOverlaps(cam.position.x, cam.position.y, cam.position.z, nearR)) blocked++;
        if (c.penetrating) pen++;
      }
      const c = window.__vs.probe("camera");
      return {
        player: window.__vs.probe("locomotion").position,
        camera: c.position,
        boom: c.distance,
        free: c.freeDistance,
        allowed: c.allowedDistance,
        avatarOpacity: c.avatarOpacity,
        framing: c.framing,
        worstInBoxDepth: Number(worst.toFixed(4)),
        nearBlockedFrames: blocked,
        penetratingFrames: pen,
        frames: 240,
      };
    });
    await d.page.keyboard.up("KeyS");
    out("BACKIN", r);
  });
}

// --------------------------------------------------------------------------- settle

async function settle() {
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    await d.run(() => window.__vs.kernel.halt());
    await d.page.keyboard.down("ShiftLeft");
    await d.page.keyboard.down("KeyW");
    await d.run(() => {
      for (let i = 0; i < 300; i++) window.__vs.advance(1 / 60);
    });
    await d.page.keyboard.up("KeyW");
    await d.page.keyboard.up("ShiftLeft");
    const r = await d.run(() => {
      const rows = [];
      for (let i = 0; i < 240; i++) {
        window.__vs.advance(1 / 60);
        const c = window.__vs.probe("camera");
        rows.push({ t: (i + 1) / 60, err: c.followError, boom: c.distance, fov: c.fov });
      }
      const last = rows[rows.length - 1];
      const firstBelow = (key, tol, target) =>
        rows.find((r, i) => rows.slice(i).every((q) => Math.abs(q[key] - target) < tol))?.t ?? null;
      return {
        followSettle1cm: firstBelow("err", 0.01, 0),
        boomSettle2cm: firstBelow("boom", 0.02, last.boom),
        fovSettle0p2deg: firstBelow("fov", 0.2, last.fov),
        final: last,
      };
    });
    out("SETTLE", r);
  });
}

// --------------------------------------------------------------------------- reduceMotion

async function reduce() {
  for (const rm of [false, true]) {
    await openGame(
      { width: 1280, height: 720, query: rm ? { reduceMotion: "1" } : {} },
      async (d) => {
        await d.play(1.0);
        const r = await d.run(() => {
          const k = window.__vs.kernel;
          k.halt();
          k.signals.emit("camera:shake", { amount: 1, seconds: 0.8 });
          k.signals.emit("player:land", { impact: 9, severity: 1 });
          let peakShake = 0;
          let peakTrauma = 0;
          let peakDip = 0;
          let peakRoll = 0;
          for (let i = 0; i < 48; i++) {
            window.__vs.advance(1 / 60);
            const c = window.__vs.probe("camera");
            peakShake = Math.max(peakShake, c.shake);
            peakTrauma = Math.max(peakTrauma, c.trauma);
            peakDip = Math.max(peakDip, Math.abs(c.pivotDip));
            peakRoll = Math.max(peakRoll, Math.abs(k.camera.rotation.z));
          }
          const c = window.__vs.probe("camera");
          return {
            reduceMotion: c.reduceMotion,
            peakShake,
            peakTrauma,
            peakDip,
            peakRoll: Number(peakRoll.toFixed(6)),
            restRoll: Number(k.camera.rotation.z.toFixed(8)),
          };
        });
        out(rm ? "REDUCE_ON" : "REDUCE_OFF", r);
      }
    );
  }
}

// --------------------------------------------------------------------------- framing

async function framing() {
  for (const [w, h] of [[1600, 900], [1280, 720], [3840, 2160]]) {
    await openGame({ width: w, height: h }, async (d) => {
      await d.play(1.2);
      const r = await d.run(([vw, vh]) => {
        const k = window.__vs.kernel;
        const cam = k.camera;
        const loco = window.__vs.probe("locomotion");
        const V = new k.camera.position.constructor();
        const project = (x, y, z) => {
          V.set(x, y, z).project(cam);
          return [Number((((V.x + 1) / 2) * vw).toFixed(1)), Number((((1 - V.y) / 2) * vh).toFixed(1))];
        };
        const p = loco.position;
        return {
          viewport: [vw, vh],
          capsuleCentrePx: project(p[0], p[1], p[2]),
          headPx: project(p[0], p[1] + 0.91, p[2]),
          feetPx: project(p[0], p[1] - 0.91, p[2]),
          fov: cam.fov,
          boom: window.__vs.probe("camera").distance,
          shoulderNdcX: Number(V.x.toFixed(4)),
        };
      }, [w, h]);
      out("FRAMING", r);
    });
  }
}

const table = { framerate, speed, corner, backin, settle, reduce, framing };
if (which === "all") {
  for (const fn of Object.values(table)) await fn();
} else if (table[which]) {
  await table[which]();
} else {
  console.error("unknown: " + which);
  process.exit(2);
}
