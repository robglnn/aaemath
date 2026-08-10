#!/usr/bin/env node
// P04 round 3 — the feel table, re-measured.
//
// The realtime loop is HALTED first, so the only thing advancing game time is this script and
// two identical input scripts land in exactly the same place. Everything below is per fixed
// step; nothing waits on wall clock. Every loop is capped — a movement rig that can hang is a
// rig that will hang on the one build you most needed it for.
//
//   node review/p04-r3-feel.mjs
//
// Focus of this round: the turning ladder across all three speed bands, what a held curve costs
// in each of them, that the reversal commitment survived the fix, the jump taken out of a hard
// landing, walls as events, and frame-rate independence measured with the input schedule
// aligned to a shared slice boundary so the test cannot move the jump between cadences.

import fs from "node:fs";
import { openGame } from "../tools/lib/session.mjs";

const OUT = "review/p04-r3-feel.json";

const fn = async () => {
  const K = window.__vs.kernel;
  K.halt();
  const L = K.get("locomotion");
  const T = L.tune;
  const STEP = 1 / 60;
  const R = (v, n = 4) => (v === null || v === undefined ? v : Math.round(v * 10 ** n) / 10 ** n);
  const DECK = 0.12;
  const STAND = DECK + T.capsuleHeight / 2 + 0.35;
  const BLOCK_TOP = DECK + 5;                       // the 5 m block, x 26..36, z 24..34
  const sp = () => Math.hypot(L.velocity.x, L.velocity.z);
  let jumps = 0;
  window.__sig.on("player:jump", () => jumps++);

  function intent(wx, wz, o = {}) {
    const l = Math.hypot(wx, wz) || 1;
    L.externalInput = true;
    L.moveX = wx / l; L.moveY = -wz / l;   // world basis: no camera rig is mounted in this rig
    L.sprintHeld = !!o.sprint; L.walkHeld = !!o.walk;
  }
  const band = (b) => ({ sprint: b === "sprint", walk: b === "walk" });
  const go = (n, wx, wz, o) => {
    for (let i = 0; i < n; i++) { intent(wx, wz, o); K.advance(STEP, { render: false }); }
  };
  function place(x, y, z, heading = [0, -1]) {
    L.moveX = 0; L.moveY = 0; L.sprintHeld = false; L.walkHeld = false;
    L.jumpHeld = false; L.jumpBuffer = 0;
    L.teleport(x, y, z, { heading });
    go(45, 0, 0);
    L.velocity.set(0, 0, 0);
    go(3, 0, 0);
  }
  const reset = (x = 0, z = 0, heading = [0, -1]) => place(x, STAND, z, heading);
  /** Settle on the deck, then lift straight up `h` metres and let go. `place` would advance
   *  the fall away inside its own settle loop, which silently capped every drop at 45 steps. */
  function dropFrom(h) {
    reset(0, 0);
    L.teleport(0, STAND + h, 0, { heading: [0, -1] });
    let n = 0;
    while (!L.grounded && n < 900) { intent(0, 0); K.advance(STEP, { render: false }); n++; }
    return n;
  }
  const cruise = (b, n = 170) => go(n, 0, -1, band(b));
  const out = { tune: JSON.parse(JSON.stringify(T)) };

  // ---------------------------------------------------------------- A. straight line
  out.straight = [];
  for (const b of ["walk", "run", "sprint"]) {
    reset();
    const top = b === "walk" ? T.walkSpeed : b === "run" ? T.runSpeed : T.sprintSpeed;
    let t50 = null, t90 = null, t99 = null, d90 = 0;
    const x0 = L.position.x, z0 = L.position.z;
    for (let i = 1; i <= 300; i++) {
      intent(0, -1, band(b)); K.advance(STEP, { render: false });
      const s = sp();
      if (t50 === null && s >= 0.5 * top) t50 = R(i / 60, 3);
      if (t90 === null && s >= 0.9 * top) {
        t90 = R(i / 60, 3); d90 = Math.hypot(L.position.x - x0, L.position.z - z0);
      }
      if (t99 === null && s >= 0.99 * top) { t99 = R(i / 60, 3); break; }
    }
    const vTop = sp();
    const sx = L.position.x, sz = L.position.z;
    let stopT = null;
    for (let i = 1; i <= 300; i++) {
      intent(0, 0, band(b)); K.advance(STEP, { render: false });
      if (sp() < 0.05) { stopT = R(i / 60, 3); break; }
    }
    out.straight.push({
      band: b, vmax: R(vTop), to50: t50, to90: t90, to99: t99, distTo90: R(d90),
      stopSeconds: stopT, stopDistance: R(Math.hypot(L.position.x - sx, L.position.z - sz)),
    });
  }

  // ---------------------------------------------------------------- B. the turning ladder
  // Stick held permanently 90° right of the *current* heading — the input a player uses to
  // circle a landmark. The path is an arc and its fitted radius is the turning circle.
  out.circles = [];
  for (const b of ["walk", "run", "sprint"]) {
    reset(); cruise(b);
    const v0 = sp();
    let swept = 0, prev = Math.atan2(L.heading.x, L.heading.y), n = 0;
    const path = []; let brakeSteps = 0; const states = new Set();
    let minS = Infinity, maxS = 0, sumS = 0, sumLag = 0;
    while (Math.abs(swept) < 2 * Math.PI && n < 900) {
      const hx = L.heading.x, hz = L.heading.y;
      intent(-hz, hx, band(b));
      K.advance(STEP, { render: false });
      n++;
      if (L.braking) brakeSteps++;
      states.add(L.state);
      const h = Math.atan2(L.heading.x, L.heading.y);
      let d = h - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      swept += d; prev = h;
      const s = sp();
      minS = Math.min(minS, s); maxS = Math.max(maxS, s); sumS += s;
      sumLag += (s > 0.01
        ? Math.acos(Math.max(-1, Math.min(1,
          (L.velocity.x * L.heading.x + L.velocity.z * L.heading.y) / s)))
        : 0) * 180 / Math.PI;
      path.push([L.position.x, L.position.z]);
    }
    const pts = path.slice(Math.round(n * 0.15));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz));
    out.circles.push({
      band: b, entrySpeed: R(v0), seconds360: R(n / 60, 3),
      radius: R(radii.reduce((a, r) => a + r, 0) / radii.length),
      radiusSpread: R(Math.max(...radii) - Math.min(...radii)),
      sustained: R(sumS / n), minSpeed: R(minS), maxSpeed: R(maxS),
      keptPct: R(100 * (sumS / n) / v0, 1),
      meanLagDeg: R(sumLag / n, 2), brakeSteps, states: [...states].join("+"),
    });
  }

  // ---------------------------------------------------------------- C. discrete corners
  out.corners = [];
  for (const b of ["walk", "run", "sprint"]) {
    for (const deg of [45, 90, 135, 180]) {
      reset(); cruise(b);
      const v0 = sp();
      const a = deg * Math.PI / 180;
      const tx = Math.sin(a), tz = -Math.cos(a);
      let n = 0, minS = v0, faced = null, skid = 0;
      while (n < 400) {
        intent(tx, tz, band(b)); K.advance(STEP, { render: false }); n++;
        if (L.braking) skid++;
        minS = Math.min(minS, sp());
        let d = Math.atan2(L.heading.x, L.heading.y) - Math.atan2(tx, tz);
        while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (faced === null && Math.abs(d) < 0.02) faced = R(n / 60, 3);
        if (faced !== null && sp() >= v0 * 0.98) break;
      }
      out.corners.push({
        band: b, deg, v0: R(v0), faceSeconds: faced, minSpeed: R(minS),
        minPct: R(100 * minS / v0, 1), recoverSeconds: R(n / 60, 3), skidSteps: skid,
      });
    }
  }

  // ---------------------------------------------------------------- D. the reversal
  {
    reset(); cruise("sprint");
    const v0 = sp(), z0 = L.position.z;
    let skid = 0, reverseAt = null, fullAt = null, minZ = z0;
    for (let i = 1; i <= 400; i++) {
      intent(0, 1, { sprint: true }); K.advance(STEP, { render: false });
      if (L.braking) skid++;
      minZ = Math.min(minZ, L.position.z);
      if (reverseAt === null && L.velocity.z > 0.05) reverseAt = R(i / 60, 3);
      if (reverseAt !== null && fullAt === null && sp() >= v0 * 0.98) { fullAt = R(i / 60, 3); break; }
    }
    out.reversal = {
      v0: R(v0), skidSteps: skid, skidSeconds: R(skid / 60, 3),
      overshootMetres: R(z0 - minZ), secondsToReverse: reverseAt, secondsToFullSpeed: fullAt,
    };
  }

  // ---------------------------------------------------------------- E. jump
  {
    const arc = (setup) => {
      reset(); setup();
      const y0 = L.position.y, x0 = L.position.x, z0 = L.position.z;
      let apex = y0, hang = 0, airborne = 0;
      for (let i = 0; i < 300; i++) {
        setup.tick ? setup.tick() : intent(0, 0);
        K.advance(STEP, { render: false });
        if (!L.grounded) { airborne++; if (Math.abs(L.velocity.y) < T.apexSpeed) hang++; }
        apex = Math.max(apex, L.position.y);
        if (i > 3 && L.grounded) break;
      }
      return {
        height: R(apex - y0), airtime: R(L.lastJump.airtime), hangSteps: hang,
        airborneSteps: airborne, travel: R(Math.hypot(L.position.x - x0, L.position.z - z0)),
        landingSpeed: R(sp()),
      };
    };
    const hold = () => { L._pressJump(); L.jumpHeld = true; };
    out.jumpHold = arc(hold);

    reset();
    hold();
    go(5, 0, 0);
    L.jumpHeld = false;
    let apex2 = L.position.y;
    for (let i = 0; i < 300; i++) {
      intent(0, 0); K.advance(STEP, { render: false });
      apex2 = Math.max(apex2, L.position.y);
      if (i > 3 && L.grounded) break;
    }
    out.jumpTap = { height: R(apex2 - STAND), airtime: R(L.lastJump.airtime) };

    reset(); cruise("sprint");
    {
      const x0 = L.position.x, z0 = L.position.z, v0 = sp();
      hold();
      for (let i = 0; i < 300; i++) {
        intent(0, -1, { sprint: true }); K.advance(STEP, { render: false });
        if (i > 3 && L.grounded) break;
      }
      out.jumpSprint = {
        takeoff: R(v0), travel: R(Math.hypot(L.position.x - x0, L.position.z - z0)),
        landingSpeed: R(sp()),
      };
    }
    reset(); cruise("sprint");
    {
      const x0 = L.position.x, z0 = L.position.z;
      hold();
      for (let i = 0; i < 300; i++) {
        intent(0, 1, { sprint: true }); K.advance(STEP, { render: false }); // full reverse in flight
        if (i > 3 && L.grounded) break;
      }
      out.jumpAirFence = {
        travel: R(Math.hypot(L.position.x - x0, L.position.z - z0)),
        landingSpeed: R(sp()), landingVz: R(L.velocity.z),
      };
    }
  }

  // ---------------------------------------------------------------- F. coyote & buffer sweeps
  // Trial by trial. Both report the window a player really gets, not the constant.
  {
    const coyote = [];
    for (let delay = 0; delay <= 18; delay++) {
      place(31, BLOCK_TOP + T.capsuleHeight / 2 + 0.35, 33, [0, -1]);
      let n = 0;
      // Sprint at the -Z edge and stop the instant the ground is gone, so every trial starts on
      // the exact step the character left it.
      while (L.grounded && n < 300) {
        intent(0, -1, { sprint: true }); K.advance(STEP, { render: false }); n++;
      }
      go(delay, 0, -1, { sprint: true });
      const before = jumps;
      L._pressJump(); L.jumpHeld = true;
      go(1, 0, -1, { sprint: true });
      coyote.push(jumps > before ? 1 : 0);
    }
    out.coyoteSweep = coyote.join("");
    out.coyoteSteps = coyote.indexOf(0) < 0 ? coyote.length : coyote.indexOf(0);
    out.coyoteSeconds = R(out.coyoteSteps / 60, 4);
    out.coyoteMonotonic = coyote.join("").replace(/^1*/, "").indexOf("1") < 0;

    // A 3 m drop: hard enough to be a real landing, soft enough that the landing gate does not
    // attenuate the jump, so the sweep measures the buffer and nothing else.
    const fallSteps = dropFrom(3);
    const buf = [];
    for (let lead = 0; lead <= 18; lead++) {
      reset(0, 0);
      L.teleport(0, STAND + 3, 0, { heading: [0, -1] });
      const before = jumps;
      for (let i = 0; i < fallSteps + 8; i++) {
        if (i === fallSteps - lead) { L._pressJump(); L.jumpHeld = true; }
        intent(0, 0); K.advance(STEP, { render: false });
      }
      buf.push(jumps > before ? 1 : 0);
    }
    out.bufferSweep = buf.join("");
    out.bufferSteps = buf.indexOf(0) < 0 ? buf.length : buf.indexOf(0);
    out.bufferSeconds = R(out.bufferSteps / 60, 4);
    out.bufferMonotonic = buf.join("").replace(/^1*/, "").indexOf("1") < 0;
    out.fallSteps = fallSteps;
  }

  // ---------------------------------------------------------------- G. landings, and the gate
  {
    out.landings = [];
    for (const drop of [1, 3, 6, 12, 25]) {
      // A — take the landing and sprint out of it on the ground
      dropFrom(drop);
      const land = { ...L.lastLand };
      const lock = L.landLockTotal;
      let tGround = null;
      for (let i = 1; i <= 400; i++) {
        intent(0, -1, { sprint: true }); K.advance(STEP, { render: false });
        if (sp() >= T.sprintSpeed * 0.99) { tGround = R(i / 60, 3); break; }
      }
      // B — same landing, but try to buy out of it with a buffered jump. Time is counted from
      // the same instant (touchdown) and *includes* the escape arc, or the comparison is a lie.
      dropFrom(drop);
      L._pressJump(); L.jumpHeld = true;
      const y0 = L.position.y;
      intent(0, -1, { sprint: true }); K.advance(STEP, { render: false });
      const launch = L.velocity.y;
      let apex = L.position.y, steps = 1, top = null;
      for (let i = 0; i < 500; i++) {
        intent(0, -1, { sprint: true }); K.advance(STEP, { render: false }); steps++;
        apex = Math.max(apex, L.position.y);
        if (top === null && L.grounded && sp() >= T.sprintSpeed * 0.99) { top = steps; break; }
      }
      out.landings.push({
        drop, impact: land.impact, severity: land.severity, hard: land.hard,
        lockSeconds: R(lock), launchFromLanding: R(launch), escapeHeight: R(apex - y0),
        secondsToTopStayingDown: tGround, secondsToTopViaJump: top === null ? null : R(top / 60, 3),
      });
    }
  }

  // ---------------------------------------------------------------- H. walls
  // Three cases: a head-on stop, a shallow graze that must keep its tangential momentum, and
  // the 90° inside corner that a depenetration solver has to converge in.
  {
    out.walls = [];
    const inBlock = () => {
      const p = L.position, r = T.capsuleRadius;
      return p.x > 26 + r && p.x < 36 - r && p.z > 24 + r && p.z < 34 - r && p.y < BLOCK_TOP + 0.5;
    };
    // 1. head-on into the 5 m block's -Z face at z = 24
    {
      reset(31, 12, [0, 1]);
      let shakes = 0, cues = 0, blockedSteps = 0, jitter = 0, maxZ = -Infinity;
      let contact = -1, pen = false;
      const offA = window.__sig.on("camera:shake", () => shakes++);
      const offB = window.__sig.on("audio:cue", (q) => { if (q.id === "impact") cues++; });
      let prevZ = L.position.z;
      for (let i = 0; i < 300; i++) {
        intent(0, 1, { sprint: true }); K.advance(STEP, { render: false });
        if (L.state === "blocked") blockedSteps++;
        if (contact < 0 && L._moveOut.blocked) contact = i;
        if (inBlock()) pen = true;
        maxZ = Math.max(maxZ, L.position.z);
        if (contact >= 0 && i > contact + 20 && Math.abs(L.position.z - prevZ) > 0.004) jitter++;
        prevZ = L.position.z;
      }
      offA(); offB();
      out.walls.push({
        test: "head-on", stoppedAtZ: R(maxZ), expected: R(24 - T.capsuleRadius), penetrated: pen,
        jitterSteps: jitter, speedAfter: R(sp()), shakes, impactCues: cues,
        blockedStateSteps: blockedSteps, state: L.state,
      });
    }
    // 2. shallow graze along the 9 m corner wall (x -40..-31, its -Z face at z = 24), pressed
    // into it at 20° off the surface. A graze must not be a block: the solver removes only the
    // component pointing into the wall, so the tangential momentum has to survive intact.
    {
      reset(-42, 22.4, [1, 0]);
      const a = 70 * Math.PI / 180;           // 70° off the face normal = 20° off the surface
      let n = 0, sum = 0, minS = Infinity, maxS = 0, shakes = 0, blocks = 0;
      const offA = window.__sig.on("camera:shake", () => shakes++);
      for (let i = 0; i < 260; i++) {
        intent(Math.sin(a), Math.cos(a), { sprint: true }); K.advance(STEP, { render: false });
        const p = L.position;
        // inside the contact corridor: alongside the face, pressed against it
        if (p.x > -38 && p.x < -32 && p.z > 23.2) {
          const s = sp(); sum += s; n++;
          minS = Math.min(minS, s); maxS = Math.max(maxS, s);
          if (L._moveOut.blocked) blocks++;
        } else if (p.x >= -32) break;   // past the wall; anything after this is another surface
      }
      offA();
      out.walls.push({
        test: "graze 20 deg off the surface", contactSteps: n,
        meanSpeed: R(n ? sum / n : 0), minSpeed: R(n ? minS : 0), maxSpeed: R(maxS),
        fractionOfSprint: R((n ? sum / n : 0) / T.sprintSpeed, 3),
        blockedSteps: blocks, shakes,
      });
    }
    // 3. the 90° inside corner — two walls meeting at a concave right angle, the classic
    // depenetration trap. Charge it diagonally and hold: the solver has to converge, not
    // oscillate, and must never push the body through into the solid side.
    {
      reset(-30, 32, [-0.7, -0.7]);
      let nan = false, inside = false, jitter = 0, minX = Infinity, minZ = Infinity;
      let prevX = L.position.x, prevZ = L.position.z, contact = -1;
      for (let i = 0; i < 300; i++) {
        intent(-0.7, -0.7, { sprint: true }); K.advance(STEP, { render: false });
        const p = L.position, r = T.capsuleRadius;
        if (!Number.isFinite(p.x + p.y + p.z + L.velocity.x + L.velocity.z)) nan = true;
        // inside either box of the L, by more than the skin
        if ((p.x > -40 + r && p.x < -31 - r && p.z > 24 + r && p.z < 25.2 - r) ||
            (p.x > -40 + r && p.x < -38.8 - r && p.z > 24 + r && p.z < 33 - r)) inside = true;
        if (contact < 0 && L._moveOut.blocked) contact = i;
        if (contact >= 0 && i > contact + 25) {
          if (Math.hypot(p.x - prevX, p.z - prevZ) > 0.004) jitter++;
        }
        minX = Math.min(minX, p.x); minZ = Math.min(minZ, p.z);
        prevX = p.x; prevZ = p.z;
      }
      out.walls.push({
        test: "inside corner", nan, penetrated: inside, contactStep: contact,
        jitterSteps: jitter, restX: R(L.position.x), restZ: R(L.position.z),
        cornerX: -38.8, cornerZ: 25.2, speedAfter: R(sp()), state: L.state,
      });
    }
  }

  // ---------------------------------------------------------------- I. slopes
  {
    out.slopes = [];
    const slotW = 6, gap = 1.4, angles = [10, 20, 30, 40, 52];
    const spanX = angles.length * slotW + (angles.length - 1) * gap;
    angles.forEach((deg, i) => {
      const cx = -spanX / 2 + i * (slotW + gap) + slotW / 2;
      const run = 3 / Math.tan(deg * Math.PI / 180);
      reset(cx, 30 - run - 3, [0, 1]);
      const y0 = L.position.y;
      let maxY = y0, onSlopeSum = 0, onSlopeN = 0, slidSteps = 0;
      for (let k = 0; k < 320; k++) {
        intent(0, 1, { sprint: true }); K.advance(STEP, { render: false });
        maxY = Math.max(maxY, L.position.y);
        if (L.sliding) slidSteps++;
        if (L.slopeDeg > deg - 3) { onSlopeSum += sp(); onSlopeN++; }
      }
      const onSlope = onSlopeN ? onSlopeSum / onSlopeN : 0;
      out.slopes.push({
        deg, climbed: R(maxY - y0), expected: 3, slidSteps,
        speedOnSlope: R(onSlope), endSlopeDeg: R(L.slopeDeg, 1),
      });
    });
    // the cone: 45° apron you can run up, 54° crown you cannot
    reset(-14, -14, [0, -1]);
    let coneMax = L.position.y, coneSlid = 0;
    for (let k = 0; k < 400; k++) {
      intent(0, -1, { sprint: true }); K.advance(STEP, { render: false });
      coneMax = Math.max(coneMax, L.position.y);
      if (L.sliding) coneSlid++;
    }
    out.cone = { maxY: R(coneMax), slidSteps: coneSlid, crownY: R(0.12 + 10.6), apronTopY: R(0.12 + 4) };
  }

  // ---------------------------------------------------------------- J. frame-rate independence
  // Identical input schedule with every transition on a multiple of 8 steps, so the schedule is
  // representable at 1, 2, 4 and 8 simulation steps per rendered frame. If the marks differ, the
  // controller reads something that is not the fixed step.
  {
    const plan = [[[0, -1], 88], [[1, 0], 56], [[0, 1], 56], [[0, -1], 56]];
    const jumpAt = 120;
    const run = (slice) => {
      reset(0, 10);
      const marks = [];
      let total = 0;
      for (const [dir, n] of plan) {
        let left = n;
        while (left > 0) {
          const k = Math.min(slice, left);
          intent(dir[0], dir[1], { sprint: true });
          if (total === jumpAt) { L._pressJump(); L.jumpHeld = true; }
          K.advance(k * STEP, { render: false });
          left -= k; total += k;
        }
        const p = L.position, v = L.velocity;
        marks.push([R(p.x, 6), R(p.y, 6), R(p.z, 6), R(v.x, 6), R(v.y, 6), R(v.z, 6), L.state]);
      }
      return marks;
    };
    const s1 = run(1), s2 = run(2), s4 = run(4), s8 = run(8);
    out.frameRate = {
      marks: s1,
      "1vs2": JSON.stringify(s1) === JSON.stringify(s2),
      "1vs4": JSON.stringify(s1) === JSON.stringify(s4),
      "1vs8": JSON.stringify(s1) === JSON.stringify(s8),
    };
    out.determinism = JSON.stringify(run(1)) === JSON.stringify(run(1));
  }

  return out;
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.run(async () => { window.__sig = (await import("/src/core/Signals.js")).signals; });
  return { errors: d.consoleErrors, out: await d.run(fn) };
});
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
const o = res.out;
const P = (s, n) => String(s).padEnd(n);
console.log("console errors:", res.errors.length);

console.log("\n== straight line ==");
console.log(P("band", 8), P("vmax", 7), P("0→50%", 7), P("0→90%", 7), P("0→99%", 7), P("dist@90%", 9), P("stop s", 8), "stop m");
for (const r of o.straight) console.log(P(r.band, 8), P(r.vmax, 7), P(r.to50, 7), P(r.to90, 7), P(r.to99, 7), P(r.distTo90, 9), P(r.stopSeconds, 8), r.stopDistance);

console.log("\n== sustained turning circle (stick held 90° off the heading) ==");
console.log(P("band", 8), P("radius", 8), P("spread", 8), P("360° s", 8), P("entry", 7), P("held", 7), P("kept%", 7), P("lag°", 6), P("skid", 5), "states");
for (const r of o.circles) console.log(P(r.band, 8), P(r.radius, 8), P(r.radiusSpread, 8), P(r.seconds360, 8), P(r.entrySpeed, 7), P(r.sustained, 7), P(r.keptPct, 7), P(r.meanLagDeg, 6), P(r.brakeSteps, 5), r.states);

console.log("\n== discrete corners ==");
console.log(P("band", 8), P("deg", 5), P("v0", 6), P("face s", 8), P("min", 7), P("min%", 7), P("recover s", 10), "skid steps");
for (const r of o.corners) console.log(P(r.band, 8), P(r.deg, 5), P(r.v0, 6), P(r.faceSeconds, 8), P(r.minSpeed, 7), P(r.minPct, 7), P(r.recoverSeconds, 10), r.skidSteps);

console.log("\n== reversal (sprint, full 180°) ==", JSON.stringify(o.reversal));
console.log("\n== jump ==");
console.log(" hold  :", JSON.stringify(o.jumpHold));
console.log(" tap   :", JSON.stringify(o.jumpTap));
console.log(" sprint:", JSON.stringify(o.jumpSprint));
console.log(" air fence (full reverse held in flight):", JSON.stringify(o.jumpAirFence));
console.log(` coyote sweep ${o.coyoteSweep} → ${o.coyoteSteps} steps / ${o.coyoteSeconds}s (tuned ${o.tune.coyoteTime}) monotonic=${o.coyoteMonotonic}`);
console.log(` buffer sweep ${o.bufferSweep} → ${o.bufferSteps} steps / ${o.bufferSeconds}s (tuned ${o.tune.jumpBuffer}) monotonic=${o.bufferMonotonic}`);

console.log("\n== landings, and the jump taken out of one ==");
console.log(P("drop", 6), P("impact", 8), P("sev", 7), P("hard", 6), P("lock s", 8), P("launch", 8), P("escape m", 9), P("→top down", 10), "→top via jump");
for (const r of o.landings) console.log(P(r.drop, 6), P(r.impact, 8), P(r.severity, 7), P(r.hard, 6), P(r.lockSeconds, 8), P(r.launchFromLanding, 8), P(r.escapeHeight, 9), P(r.secondsToTopStayingDown, 10), r.secondsToTopViaJump);

console.log("\n== walls ==");
for (const r of o.walls) console.log(" ", JSON.stringify(r));

console.log("\n== slopes ==");
for (const r of o.slopes) console.log(" ", JSON.stringify(r));
console.log("  cone:", JSON.stringify(o.cone));

console.log("\n== frame-rate independence & determinism ==");
console.log(" 1vs2", o.frameRate["1vs2"], " 1vs4", o.frameRate["1vs4"], " 1vs8", o.frameRate["1vs8"], " same script twice:", o.determinism);
console.log("\nwrote", OUT);
