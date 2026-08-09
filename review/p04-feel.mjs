// P04 — the feel measurement rig.
//
// Everything this piece claims about movement is measured here, per fixed step, with the
// kernel's realtime loop HALTED first so that the only thing moving game time is this script.
// Without the halt, stray rAF frames inject extra fixed steps between advance() calls and two
// identical input scripts land in different places — which looks exactly like a determinism
// bug in the controller and is not one.
//
//   node review/p04-feel.mjs [--out=review/shots/p04/feel.json]
//
// Prints a table. Writes the raw traces to JSON so a claim can be re-checked without re-running.

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg, has } from "../tools/lib/session.mjs";

const OUT = arg("out", "review/shots/p04/feel.json");

const PRELUDE = `(() => {
  const K = window.__vs.kernel;
  K.halt();
  const L = K.get("locomotion"), C = K.get("collision");
  const snap = () => { const p = L.position, v = L.velocity; return {
    t:+L.simTime.toFixed(6), x:+p.x.toFixed(6), y:+p.y.toFixed(6), z:+p.z.toFixed(6),
    vx:+v.x.toFixed(6), vy:+v.y.toFixed(6), vz:+v.z.toFixed(6),
    sp:+Math.hypot(v.x,v.z).toFixed(6), g:L.grounded, sl:L.sliding, br:L.braking,
    piv:+L.pivot.toFixed(5), st:L.state, hx:+L.heading.x.toFixed(6), hz:+L.heading.y.toFixed(6),
    tos:+L.takeoffSpeed.toFixed(4), lean:+L.lean.toFixed(4), push:+L.push.toFixed(4),
    coy:+L.coyote.toFixed(5), buf:+L.jumpBuffer.toFixed(5), air:+L.airtime.toFixed(5),
    lock:+L.landLock.toFixed(5), slope:+L.slopeDeg.toFixed(3),
    landImp:L.lastLand.impact, steps:K.stepCount };
  };
  window.__p4 = {
    snap,
    tune: () => L.tune,
    step(n=1, rec=false){ const o=[]; for(let i=0;i<n;i++){ K.advance(1/60,{render:false}); if(rec) o.push(snap()); } return o; },
    reset(x,y,z,hx,hz){ L.teleport(x,y,z,{heading:[hx,hz]}); },
    vel(vx,vy,vz){ L.velocity.set(vx,vy,vz); L._setTakeoff(); },
    // Duck-typed stand-in for a P09 terrain collider: a flat plateau at y = 40. Registering it
    // deletes the stand-in proving ground, which is the only way to prove the spawn ground-snap
    // is real rather than accidentally right.
    fakeTerrain(y){
      const q=[[-60,y,-60],[60,y,-60],[60,y,60],[-60,y,60]];
      const v=[].concat(q[0],q[1],q[2], q[0],q[2],q[3]);
      const attr={count:v.length/3,getX:i=>v[i*3],getY:i=>v[i*3+1],getZ:i=>v[i*3+2]};
      return C.registerCollider({id:"fake-p09",geometry:{getAttribute:n=>n==="position"?attr:null,getIndex:()=>null}});
    },
    dropTerrain(){ C.removeCollider("fake-p09"); C.ensureBuilt(); C.ensureFallbackGround(); },
    respawn(){ L._spawnPoint=null; L._spawn(); return snap(); },
    groundY(x,z){ const g=C.groundAt(x,z,400); return g.hit? g.y : null; },
    intent(x,y,o){ o=o||{}; L.externalInput=true; L.moveX=x; L.moveY=y; L.sprintHeld=!!o.sprint; L.walkHeld=!!o.walk; },
    pressJump(){ L._pressJump(); },
    releaseJump(){ L.jumpHeld=false; },
  };
  // Sibling pieces are being rewritten by other agents while this runs. A neighbour that throws
  // out of its own fixed() would abort every advance() and look like a P04 failure, so probe
  // one step first and quarantine anything that faults. Quarantined systems are reported, not
  // hidden — a run with a neighbour missing is a weaker run and the reader has to know.
  const quarantined = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    try { K.advance(1/60, {render:false}); break; }
    catch (err) {
      const at = String(err && err.stack || err);
      const bad = K.systems.find(s => s.__name && s.__name !== "locomotion" && s.__name !== "collision"
        && at.includes("/" + s.constructor.name + ".js"));
      if (!bad) throw err;
      K.systems.splice(K.systems.indexOf(bad), 1);
      K.byName.delete(bad.__name);
      quarantined.push(bad.__name + " (" + at.split("\\n")[0] + ")");
    }
  }
  return { mode: K.mode, tune: L.tune, quarantined };
})()`;

const f = (v, n = 3) => (v === null || v === undefined ? "—" : Number(v).toFixed(n));

async function main() {
  const R = { generated: new Date().toISOString() };
  // `--built` serves dist/ instead of the dev server. Worth knowing about: a 90-second run
  // against Vite dev dies the moment any agent saves any file, because HMR reloads the page
  // out from under the measurement. Against a build the code is frozen for the whole run.
  await openGame({ width: 1280, height: 720, built: has("built") }, async (d) => {
    const boot = await d.run(PRELUDE);
    R.kernelMode = boot.mode;
    R.tune = boot.tune;
    R.quarantined = boot.quarantined;

    const step = (n, rec = false) => d.run(([n, rec]) => window.__p4.step(n, rec), [n, rec]);
    const snap = () => d.run(() => window.__p4.snap());
    const reset = (x, y, z, hx = 0, hz = -1) =>
      d.run(([x, y, z, hx, hz]) => window.__p4.reset(x, y, z, hx, hz), [x, y, z, hx, hz]);
    const gy = (x, z) => d.run(([x, z]) => window.__p4.groundY(x, z), [x, z]);
    const intent = (x, y, o = {}) => d.run(([x, y, o]) => window.__p4.intent(x, y, o), [x, y, o]);
    const pressJump = () => d.run(() => window.__p4.pressJump());
    const releaseJump = () => d.run(() => window.__p4.releaseJump());

    const T = R.tune;
    const deck = await gy(0, 0);
    const startY = deck + 0.93;

    // ---------------------------------------------------------------- 0. spawn correctness
    R.spawn = await d.run(() => {
      const L = window.__vs.kernel.get("locomotion");
      const C = window.__vs.kernel.get("collision");
      const p = L.snapshot();
      return {
        probeSpawnPoint: p.spawnPoint,
        voidLimit: p.voidLimit,
        position: p.position,
        groundAtCorrectOrder: (() => { const g = C.groundAt(4, 14, 400); return { hit: g.hit, y: +g.y.toFixed(4) }; })(),
        groundAtWrongOrder: (() => { const g = C.groundAt(4, 400, 14); return { hit: g.hit }; })(),
      };
    });

    // ---------------------------------------------------------------- 1. acceleration
    async function accel(band) {
      await reset(0, startY, 20, 0, -1);
      await intent(0, 0); await step(6);
      await intent(0, 1, band.opts);
      const tr = await step(90, true);
      await intent(0, 0);
      const top = band.top;
      const at = (frac) => {
        const i = tr.findIndex((s) => s.sp >= top * frac - 1e-6);
        return i < 0 ? null : { seconds: +((i + 1) / 60).toFixed(4), metres: +Math.abs(tr[i].z - 20).toFixed(4) };
      };
      return {
        band: band.name, top,
        to90: at(0.9), to95: at(0.95), to100: at(0.999),
        firstStepSpeed: tr[0].sp,
        peak: +Math.max(...tr.map((s) => s.sp)).toFixed(4),
        speedTrace: tr.slice(0, 30).map((s) => s.sp),
      };
    }
    R.acceleration = [
      await accel({ name: "sprint", opts: { sprint: true }, top: T.sprintSpeed }),
      await accel({ name: "run", opts: {}, top: T.runSpeed }),
      await accel({ name: "walk", opts: { walk: true }, top: T.walkSpeed }),
    ];

    // ---------------------------------------------------------------- 2. stopping (release)
    async function stopRelease(band) {
      await reset(0, startY, 20, 0, -1);
      await intent(0, 1, band.opts); await step(200);
      const e = await snap();
      await intent(0, 0);
      const tr = await step(90, true);
      const i = tr.findIndex((s) => s.sp < 1e-4);
      return {
        band: band.name, entrySpeed: e.sp,
        seconds: i < 0 ? null : +((i + 1) / 60).toFixed(4),
        metres: i < 0 ? null : +Math.abs(tr[i].z - e.z).toFixed(4),
      };
    }
    R.stopRelease = [
      await stopRelease({ name: "sprint", opts: { sprint: true } }),
      await stopRelease({ name: "run", opts: {} }),
    ];

    // ---------------------------------------------------------------- 3. THE REVERSAL
    // Sprint, then slam the stick to full reverse. What does momentum cost?
    async function reversal(band) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 1, band.opts); await step(200);
      const e = await snap();
      await intent(0, -1, band.opts);
      const tr = await step(180, true);
      await intent(0, 0);
      // "reversed" = velocity now points opposite the entry velocity
      const ex = e.vx / e.sp, ez = e.vz / e.sp;
      const iRev = tr.findIndex((s) => s.sp > 0.2 && (s.vx * ex + s.vz * ez) < 0);
      const iBack = tr.findIndex((s) => (s.vx * ex + s.vz * ez) < -e.sp * 0.9);
      let travel = 0;
      for (let i = 1; i <= (iRev < 0 ? tr.length - 1 : iRev); i++) {
        travel += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
      }
      const overshoot = Math.max(...tr.map((s) => (s.x - e.x) * ex + (s.z - e.z) * ez));
      return {
        band: band.name,
        entrySpeed: e.sp,
        minSpeed: +Math.min(...tr.map((s) => s.sp)).toFixed(4),
        skidSteps: tr.filter((s) => s.br).length,
        secondsToReverse: iRev < 0 ? null : +((iRev + 1) / 60).toFixed(4),
        metresTravelledWhileReversing: +travel.toFixed(4),
        overshootMetres: +overshoot.toFixed(4),
        secondsBackToFullSpeed: iBack < 0 ? null : +((iBack + 1) / 60).toFixed(4),
        speedTrace: tr.slice(0, 40).map((s) => s.sp),
        stateTrace: [...new Set(tr.slice(0, 60).map((s) => s.st))],
      };
    }
    R.reversal = [
      await reversal({ name: "sprint", opts: { sprint: true } }),
      await reversal({ name: "run", opts: {} }),
    ];

    // 3b. the brake must not fire on an ordinary carve
    R.carveDoesNotBrake = {};
    for (const [name, deg] of [["90deg", 90], ["135deg", 135], ["180deg", 180]]) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 1, { sprint: true }); await step(200);
      // intent (x, y) maps to world (x, −y) at basis yaw 0, so a world direction `deg` off
      // forward is (sin deg, cos deg) in intent space.
      await intent(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), { sprint: true });
      const tr = await step(90, true);
      await intent(0, 0);
      R.carveDoesNotBrake[name] = {
        braked: tr.some((s) => s.br),
        minSpeed: +Math.min(...tr.map((s) => s.sp)).toFixed(4),
        peakSpeed: +Math.max(...tr.map((s) => s.sp)).toFixed(4),
      };
    }

    // ---------------------------------------------------------------- 4. turn radius + speed cap
    R.turns = {};
    for (const [name, opts, warm, cap] of [
      ["sprint", { sprint: true }, 200, T.sprintSpeed],
      ["run", {}, 150, T.runSpeed],
      ["walk", { walk: true }, 150, T.walkSpeed],
    ]) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 1, opts); await step(warm);
      const e = await snap();
      await intent(-1, 0, opts);
      const tr = await step(120, true);
      await intent(0, 0);
      let acc = 0, prev = Math.atan2(e.hx, -e.hz);
      const un = tr.map((s) => {
        const a = Math.atan2(s.hx, -s.hz);
        let dd = a - prev; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
        acc += dd; prev = a; return acc;
      });
      const i90 = un.findIndex((a) => Math.abs(a) >= Math.PI / 2);
      let arc = 0;
      for (let i = 1; i <= Math.max(i90, 1); i++) arc += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
      R.turns[name] = {
        entrySpeed: e.sp, bandCap: cap,
        degPerSec: +((Math.abs(un[5]) * 180) / Math.PI / (6 / 60)).toFixed(1),
        timeTo90: i90 >= 0 ? +((i90 + 1) / 60).toFixed(4) : null,
        radius90: i90 > 0 ? +(arc / (Math.PI / 2)).toFixed(4) : null,
        peakSpeedDuringTurn: +Math.max(...tr.map((s) => s.sp)).toFixed(4),
        overCapBy: +(Math.max(...tr.map((s) => s.sp)) - cap).toFixed(4),
        peakLean: +Math.max(...tr.map((s) => Math.abs(s.lean))).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- 5. jump arc
    async function jumpTrace(mode) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 0); await step(8);
      if (mode === "sprint") { await intent(0, 1, { sprint: true }); await step(200); }
      const t0 = await snap();
      await pressJump();
      const tr = await step(140, true);
      await intent(0, 0); await releaseJump();
      const lift = tr.findIndex((s) => !s.g);
      let land = -1; for (let i = lift + 1; i < tr.length; i++) if (tr[i].g) { land = i; break; }
      const seg = tr.slice(lift, land + 1);
      const apexIdx = seg.reduce((b, s, i) => (s.y > seg[b].y ? i : b), 0);
      return {
        mode, takeoffSpeed: t0.sp,
        height: +(seg[apexIdx].y - t0.y).toFixed(4),
        bodyHeights: +((seg[apexIdx].y - t0.y) / T.capsuleHeight).toFixed(3),
        riseSeconds: +((apexIdx + 1) / 60).toFixed(4),
        fallSeconds: +((seg.length - apexIdx - 1) / 60).toFixed(4),
        airtimeSeconds: +(seg.length / 60).toFixed(4),
        hangSteps: seg.filter((s) => Math.abs(s.vy) < T.apexSpeed).length,
        landingSpeed: tr[land].landImp,
        distance: +Math.hypot(tr[land].x - t0.x, tr[land].z - t0.z).toFixed(4),
      };
    }
    R.jumpStand = await jumpTrace("stand");
    R.jumpSprint = await jumpTrace("sprint");

    R.jumpVariable = [];
    for (const hold of [1, 2, 4, 6, 8, 12, 20, 40]) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 0); await step(8);
      const t0 = await snap();
      // Record from the press, not from the release: a hold longer than the airtime otherwise
      // starts the trace after the apex and reports a jump shorter than a tap.
      await pressJump();
      const held = await step(hold, true);
      await releaseJump();
      const tr = held.concat(await step(150, true));
      const lift = tr.findIndex((s) => !s.g);
      let land = -1; for (let i = lift + 1; i < tr.length; i++) if (tr[i].g) { land = i; break; }
      const seg = tr.slice(lift, land + 1);
      R.jumpVariable.push({
        holdSteps: hold,
        height: +(Math.max(...seg.map((s) => s.y)) - t0.y).toFixed(4),
        airtime: +(seg.length / 60).toFixed(4),
      });
    }

    // ---------------------------------------------------------------- 6. air commitment
    // (a) sprint jump then full reverse: must NOT land travelling the other way
    await reset(0, startY, 24, 0, -1);
    await intent(0, 1, { sprint: true }); await step(200);
    const airEntry = await snap();
    await pressJump();
    await step(4);
    await intent(0, -1, { sprint: true });
    const airTr = await step(150, true);
    await intent(0, 0); await releaseJump();
    const airLand = airTr.findIndex((s, i) => i > 4 && s.g);
    R.airReversal = {
      entryVz: airEntry.vz,
      takeoffSpeed: airTr[2].tos,
      landingVz: airTr[airLand].vz,
      landingSpeed: airTr[airLand].sp,
      reversed: airTr[airLand].vz > 0,
      minAlongTakeoff: +Math.min(...airTr.slice(0, airLand).map((s) => -s.vz)).toFixed(4),
      airtime: +((airLand + 1) / 60).toFixed(4),
    };

    // (b) standing jump + full air input vs running jump: reach must differ
    async function reach(mode) {
      await reset(0, startY, 24, 0, -1);
      await intent(0, 0); await step(8);
      if (mode === "run") { await intent(0, 1, { sprint: true }); await step(200); }
      const t0 = await snap();
      await pressJump();
      await step(3);
      await intent(0, 1, { sprint: true });
      const tr = await step(150, true);
      await intent(0, 0); await releaseJump();
      const land = tr.findIndex((s, i) => i > 4 && s.g);
      return {
        mode,
        distance: +Math.hypot(tr[land].x - t0.x, tr[land].z - t0.z).toFixed(4),
        peakAirSpeed: +Math.max(...tr.slice(0, land).map((s) => s.sp)).toFixed(4),
      };
    }
    R.jumpReach = [await reach("stand"), await reach("run")];

    // ---------------------------------------------------------------- 7. coyote window
    const blockTop = await gy(31, 28);
    R.coyote = { trials: [] };
    for (let k = 0; k <= 14; k++) {
      await reset(31, blockTop + 0.95, 30, 0, -1);
      await intent(0, 0); await step(10);
      await intent(0, 1, {});
      for (let i = 0; i < 400; i++) { const s = (await step(1, true))[0]; if (!s.g) break; }
      await step(k);
      await pressJump();
      const t = await step(2, true);
      await releaseJump(); await intent(0, 0);
      R.coyote.trials.push({ k, seconds: +((k + 1) / 60).toFixed(4), jumped: t.some((s) => s.vy > 5) });
    }
    const cmax = R.coyote.trials.filter((t) => t.jumped).map((t) => t.k).pop();
    R.coyote.windowSeconds = cmax === undefined ? 0 : +((cmax + 1) / 60).toFixed(4);
    R.coyote.monotonic = R.coyote.trials.every((t, i, a) => i === 0 || !(t.jumped && !a[i - 1].jumped));

    // ---------------------------------------------------------------- 8. jump buffer window
    await reset(0, startY, 24, 0, -1); await intent(0, 0); await step(10);
    await pressJump(); await step(3); await releaseJump();
    const base = await step(200, true);
    const landStep = base.findIndex((s, i) => i > 5 && s.g);
    R.buffer = { landStep, trials: [] };
    for (let k = 0; k <= 16; k++) {
      await reset(0, startY, 24, 0, -1); await intent(0, 0); await step(10);
      await pressJump(); await step(3); await releaseJump();
      await step(Math.max(0, landStep - k));
      await pressJump();
      const tr = await step(k + 10, true);
      await releaseJump();
      R.buffer.trials.push({ k, leadSeconds: +(k / 60).toFixed(4), relaunched: tr.some((s) => s.vy > 5) });
    }
    const bmax = R.buffer.trials.filter((t) => t.relaunched).map((t) => t.k).pop();
    R.buffer.windowSeconds = bmax === undefined ? 0 : +(bmax / 60).toFixed(4);
    R.buffer.monotonic = R.buffer.trials.every((t, i, a) => i === 0 || !(t.relaunched && !a[i - 1].relaunched));

    // ---------------------------------------------------------------- 9. slopes
    R.slopes = {};
    for (const [name, x] of [["flat", 25], ["10deg", -15], ["20deg", -7.6], ["30deg", -0.4], ["40deg", 7.0], ["52deg", 14.4]]) {
      await reset(x, startY, name === "flat" ? 0 : 10, 0, 1);
      await intent(0, -1, { sprint: true });
      const tr = await step(240, true);
      await intent(0, 0);
      const onRamp = tr.filter((s) => s.slope > 3 && s.slope < 50);
      R.slopes[name] = {
        meanRampSpeed: onRamp.length ? +(onRamp.reduce((a, s) => a + s.sp, 0) / onRamp.length).toFixed(3) : null,
        meanRampSlopeDeg: onRamp.length ? +(onRamp.reduce((a, s) => a + s.slope, 0) / onRamp.length).toFixed(1) : null,
        flatSpeed: +tr[120].sp.toFixed(3),
        maxSlopeSeen: +Math.max(...tr.map((s) => s.slope)).toFixed(1),
        slidingSeen: tr.some((s) => s.sl),
        topY: +Math.max(...tr.map((s) => s.y)).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- 10. landings
    R.landings = [];
    for (const h of [1, 3, 6, 12]) {
      await reset(0, deck + h, 24, 0, -1);
      // Enter the fall at full sprint, so the bite the landing takes out of horizontal speed
      // is measurable at all. Air control is fenced about this takeoff, which is the point.
      await d.run(([vx, vy, vz]) => window.__p4.vel(vx, vy, vz), [0, 0, -T.sprintSpeed]);
      await intent(0, 1, { sprint: true });
      const tr = await step(220, true);
      await intent(0, 0);
      const land = tr.findIndex((s, i) => i > 2 && s.g);
      const post = tr.slice(land, land + 60);
      R.landings.push({
        dropMetres: h,
        impactSpeed: tr[land].landImp,
        lockSeconds: +Math.max(...post.map((s) => s.lock)).toFixed(4),
        speedBefore: +tr[Math.max(0, land - 1)].sp.toFixed(3),
        speedAfter: +tr[land].sp.toFixed(3),
        recoveredWithin: (() => { const i = post.findIndex((s) => s.sp > T.sprintSpeed * 0.99); return i < 0 ? null : +(i / 60).toFixed(4); })(),
      });
    }

    // ---------------------------------------------------------------- 11. determinism
    async function scripted() {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0); await step(12);
      await intent(0, 1, { sprint: true }); await step(45);
      await pressJump(); await step(4); await releaseJump(); await step(40);
      await intent(0, -1, { sprint: true }); await step(50);
      await intent(-1, 0, { sprint: true }); await step(40);
      await intent(0, 0); await step(60);
      const s = await snap();
      delete s.t; delete s.steps;
      return s;
    }
    R.determinism = [await scripted(), await scripted(), await scripted()];
    R.determinismIdentical =
      JSON.stringify(R.determinism[0]) === JSON.stringify(R.determinism[1]) &&
      JSON.stringify(R.determinism[1]) === JSON.stringify(R.determinism[2]);

    // pacing independence
    R.pacing = [];
    for (const sl of [1 / 60, 1 / 30, 1 / 15, 1 / 144]) {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0); await step(12);
      await intent(0, 1, { sprint: true });
      const before = await d.run(() => window.__vs.kernel.stepCount);
      await d.run(([s, n]) => { for (let i = 0; i < n; i++) window.__vs.kernel.advance(s, { render: false }); },
        [sl, Math.round(3 / sl)]);
      const s = await snap();
      await intent(0, 0);
      R.pacing.push({ slice: +sl.toFixed(6), steps: s.steps - before, z: s.z, sp: s.sp });
    }

    // ---------------------------------------------------------------- 11c. regression guard
    // The previous round's collision behaviour was verified good by a critic. None of it is
    // supposed to have moved, so measure it again rather than asserting it.
    R.robust = {};
    {
      // sprint head-on into the 5 m block (x 26..36, z 24..34): must stop at face − radius
      await reset(31, startY, 14, 0, 1);
      await intent(0, -1, { sprint: true });
      const tr = await step(180, true);
      await intent(0, 0);
      let maxStep = 0;
      for (let i = 1; i < tr.length; i++) maxStep = Math.max(maxStep, Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z));
      R.robust.wall = {
        finalZ: +tr.at(-1).z.toFixed(4), expectedZ: +(24 - T.capsuleRadius).toFixed(4),
        finalSpeed: +tr.at(-1).sp.toFixed(4),
        maxSingleStepMetres: +maxStep.toFixed(4), tunnelled: tr.at(-1).z > 24,
      };
      // inside 90° corner: depenetration must converge, not oscillate
      await reset(-36, startY, 28, 0, -1);
      await intent(-0.707, 0.707, { sprint: true });
      const c = await step(180, true);
      await intent(0, 0);
      const ys = c.slice(30).map((s) => s.y);
      R.robust.corner = {
        yRange: +(Math.max(...ys) - Math.min(...ys)).toFixed(5),
        grounded: c.at(-1).g,
        reachedCorner: [+c.at(-1).x.toFixed(3), +c.at(-1).z.toFixed(3)],
        travelled: +Math.hypot(c.at(-1).x + 36, c.at(-1).z - 28).toFixed(3),
      };
      // stairs: 0.25 / 0.5 / 0.7 climb, 0.9 is a wall
      R.robust.stairs = [];
      const flights = [[0.25, -11.5], [0.5, -4.5], [0.7, 4.5], [0.9, 11.5]];
      for (const [riser, z] of flights) {
        await reset(-18, startY, z, -1, 0);
        await intent(-1, 0, {});
        const t = await step(300, true);
        await intent(0, 0);
        R.robust.stairs.push({ riser, gained: +(Math.max(...t.map((s) => s.y)) - startY).toFixed(3), finalX: +t.at(-1).x.toFixed(2) });
      }
      // jump spam: no height accumulation, no stuck-airborne
      await reset(0, startY, 24, 0, -1);
      await intent(0, 1, { sprint: true });
      let jumps = 0, maxY = -Infinity, prevVy = 0;
      for (let i = 0; i < 300; i++) {
        if (i % 2 === 0) await pressJump(); else await releaseJump();
        const s = (await step(1, true))[0];
        if (s.vy > 5 && prevVy <= 5) jumps++;   // count launches, not steps spent above 5 m/s
        prevVy = s.vy;
        maxY = Math.max(maxY, s.y);
      }
      await releaseJump(); await intent(0, 0);
      const tail = await step(120, true);
      R.robust.jumpSpam = { jumps, maxY: +maxY.toFixed(3), endedGrounded: tail.at(-1).g };
    }

    // ---------------------------------------------------------------- 11b. the real key path
    // Everything above drives intent directly so P04 is judged alone. This one goes through
    // Playwright key events → P07 → `input:move`, with whatever camera rig is mounted supplying
    // the movement basis, because a brake that only exists for a test harness is not a brake.
    {
      await d.run(() => { const L = window.__vs.kernel.get("locomotion"); L.moveX = 0; L.moveY = 0; L.sprintHeld = false; L.walkHeld = false; });
      await reset(0, startY, 24, 0, -1);
      await d.page.keyboard.down("Shift");
      await d.page.keyboard.down("KeyW");
      await step(200);
      const e = await snap();
      await d.page.keyboard.up("KeyW");
      await d.page.keyboard.down("KeyS");
      const tr = await step(150, true);
      await d.page.keyboard.up("KeyS");
      await d.page.keyboard.up("Shift");
      const ex = e.sp > 0.01 ? e.vx / e.sp : 0, ez = e.sp > 0.01 ? e.vz / e.sp : -1;
      const iRev = tr.findIndex((s) => s.sp > 0.2 && (s.vx * ex + s.vz * ez) < 0);
      let travel = 0;
      for (let i = 1; i <= (iRev < 0 ? tr.length - 1 : iRev); i++) {
        travel += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
      }
      R.keyboardReversal = {
        intentSource: (await d.probe("locomotion"))?.inputSource,
        cameraBasis: (await d.probe("locomotion"))?.cameraBasis,
        entrySpeed: e.sp,
        skidSteps: tr.filter((s) => s.br).length,
        sawSkidState: tr.some((s) => s.st === "skid"),
        minSpeed: +Math.min(...tr.map((s) => s.sp)).toFixed(4),
        secondsToReverse: iRev < 0 ? null : +((iRev + 1) / 60).toFixed(4),
        metresTravelledWhileReversing: +travel.toFixed(4),
      };
    }

    // ---------------------------------------------------------------- 12. spawn onto a foreign
    // collider. Registering any external collider deletes the stand-in proving ground, taking
    // `fallbackSpawn` with it — so this is the only test that can tell a working ground-snap
    // apart from a hard-coded guess that happens to match the stand-in.
    R.foreignSpawn = { registered: await d.run(() => window.__p4.fakeTerrain(40)) };
    R.foreignSpawn.afterRespawn = await d.run(() => window.__p4.respawn());
    R.foreignSpawn.after2s = (await step(120, true)).at(-1);
    R.foreignSpawn.landedOnPlateau =
      Math.abs(R.foreignSpawn.after2s.y - (40 + T.capsuleHeight / 2)) < 0.15 && R.foreignSpawn.after2s.g;
    await d.run(() => window.__p4.dropTerrain());
    await d.run(() => window.__p4.respawn());

    R.reportErrors = (await d.report()).errors;
    R.consoleErrors = d.consoleErrors.slice(0, 10);
    R.consoleWarnings = d.consoleWarnings.slice(0, 10);
  });

  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(R, null, 2));

  // ------------------------------------------------------------------ table
  const L = [];
  L.push(`kernel mode during measurement: ${R.kernelMode}  (must be "idle")`);
  L.push(`quarantined neighbours: ${R.quarantined?.length ? R.quarantined.join(", ") : "none"}`);
  L.push("");
  L.push("ACCELERATION            top     0→90%          0→100%       peak");
  for (const a of R.acceleration) {
    L.push(`  ${a.band.padEnd(8)}  ${f(a.top, 2).padStart(8)}  ${f(a.to90?.seconds)} s / ${f(a.to90?.metres)} m   ${f(a.to100?.seconds)} s   ${f(a.peak)}`);
  }
  L.push("");
  L.push("STOPPING (release)      entry     time      distance");
  for (const s of R.stopRelease) L.push(`  ${s.band.padEnd(8)}  ${f(s.entrySpeed).padStart(8)}  ${f(s.seconds)} s  ${f(s.metres)} m`);
  L.push("");
  L.push("REVERSAL (slam back)    entry    min spd  skid  to reverse   travel   overshoot  back to top");
  for (const r of R.reversal) {
    L.push(`  ${r.band.padEnd(8)}  ${f(r.entrySpeed).padStart(8)} ${f(r.minSpeed).padStart(8)}  ${String(r.skidSteps).padStart(3)}   ${f(r.secondsToReverse)} s   ${f(r.metresTravelledWhileReversing)} m  ${f(r.overshootMetres)} m   ${f(r.secondsBackToFullSpeed)} s`);
  }
  L.push(`  carve braked? 90°=${R.carveDoesNotBrake["90deg"].braked}  135°=${R.carveDoesNotBrake["135deg"].braked}  180°=${R.carveDoesNotBrake["180deg"].braked}`);
  const kr = R.keyboardReversal;
  L.push(`  real key path (Shift+W → S, source=${kr.intentSource}, cameraBasis=${kr.cameraBasis}): entry ${f(kr.entrySpeed)} → min ${f(kr.minSpeed)}, ${kr.skidSteps} skid steps, state seen=${kr.sawSkidState}, reverse in ${f(kr.secondsToReverse)} s / ${f(kr.metresTravelledWhileReversing)} m`);
  L.push("");
  L.push("TURNS                   entry    cap     deg/s   90° in    radius   peak spd  over cap  lean");
  for (const k of Object.keys(R.turns)) {
    const t = R.turns[k];
    L.push(`  ${k.padEnd(8)}  ${f(t.entrySpeed).padStart(8)} ${f(t.bandCap, 2).padStart(6)} ${f(t.degPerSec, 1).padStart(8)}  ${f(t.timeTo90)} s  ${f(t.radius90)} m  ${f(t.peakSpeedDuringTurn)}  ${f(t.overCapBy)}  ${f(t.peakLean, 2)}`);
  }
  L.push("");
  L.push("JUMP                   height  bodyH   rise    fall    airtime  hangSteps  land spd  distance");
  for (const j of [R.jumpStand, R.jumpSprint]) {
    L.push(`  ${j.mode.padEnd(8)} ${f(j.height).padStart(8)} ${f(j.bodyHeights, 2).padStart(6)} ${f(j.riseSeconds)} ${f(j.fallSeconds)} ${f(j.airtimeSeconds).padStart(8)} ${String(j.hangSteps).padStart(9)}  ${f(j.landingSpeed).padStart(8)}  ${f(j.distance)}`);
  }
  L.push(`  variable height: ${R.jumpVariable.map((v) => `${v.holdSteps}→${f(v.height, 2)}`).join("  ")}`);
  L.push("");
  L.push("AIR COMMITMENT");
  L.push(`  sprint jump + full reverse: entry vz ${f(R.airReversal.entryVz)} → landing vz ${f(R.airReversal.landingVz)}  reversed=${R.airReversal.reversed}  (must be false)`);
  L.push(`  reach: standing jump ${f(R.jumpReach[0].distance)} m (peak air ${f(R.jumpReach[0].peakAirSpeed)}) vs running jump ${f(R.jumpReach[1].distance)} m`);
  L.push("");
  L.push(`COYOTE  window ${f(R.coyote.windowSeconds)} s   monotonic=${R.coyote.monotonic}   (constant ${R.tune.coyoteTime})`);
  L.push(`BUFFER  window ${f(R.buffer.windowSeconds)} s   monotonic=${R.buffer.monotonic}   (constant ${R.tune.jumpBuffer})`);
  L.push("");
  L.push("SLOPES        mean speed on ramp   slope    sliding");
  for (const k of Object.keys(R.slopes)) {
    const s = R.slopes[k];
    L.push(`  ${k.padEnd(8)}  ${f(s.meanRampSpeed ?? s.flatSpeed).padStart(8)}   ${f(s.meanRampSlopeDeg ?? s.maxSlopeSeen, 1).padStart(6)}°   ${s.slidingSeen}`);
  }
  L.push("");
  L.push("LANDINGS      impact   lock     speed before→after   recovered");
  for (const l of R.landings) {
    L.push(`  ${String(l.dropMetres).padStart(3)} m  ${f(l.impactSpeed).padStart(8)}  ${f(l.lockSeconds)} s  ${f(l.speedBefore)} → ${f(l.speedAfter)}   ${f(l.recoveredWithin)} s`);
  }
  L.push("");
  L.push("REGRESSION GUARD (collision, unchanged this round)");
  L.push(`  wall: stopped at z=${f(R.robust.wall.finalZ)} (expected ${f(R.robust.wall.expectedZ)}), speed ${f(R.robust.wall.finalSpeed)}, max step ${f(R.robust.wall.maxSingleStepMetres)} m, tunnelled=${R.robust.wall.tunnelled}`);
  L.push(`  inside corner: travelled ${f(R.robust.corner.travelled)} m to (${R.robust.corner.reachedCorner}), y range over 2.5 s = ${f(R.robust.corner.yRange, 5)} m, grounded=${R.robust.corner.grounded}`);
  L.push(`  stairs: ${R.robust.stairs.map((s) => `${s.riser}m→${f(s.gained, 2)}m`).join("  ")}`);
  L.push(`  jump spam: ${R.robust.jumpSpam.jumps} jumps in 5 s, maxY ${f(R.robust.jumpSpam.maxY)}, ended grounded=${R.robust.jumpSpam.endedGrounded}`);
  L.push("");
  L.push("SPAWN");
  L.push(`  groundAt(4,14,400) hit=${R.spawn.groundAtCorrectOrder.hit} y=${f(R.spawn.groundAtCorrectOrder.y)}   groundAt(4,400,14) hit=${R.spawn.groundAtWrongOrder.hit}`);
  L.push(`  spawn point ${JSON.stringify(R.spawn.probeSpawnPoint)}  voidLimit ${f(R.spawn.voidLimit)}`);
  L.push(`  foreign collider (plateau y=40): after 2 s y=${f(R.foreignSpawn.after2s.y)} grounded=${R.foreignSpawn.after2s.g} → landedOnPlateau=${R.foreignSpawn.landedOnPlateau}`);
  L.push("");
  L.push(`DETERMINISM  three identical runs byte-identical: ${R.determinismIdentical}`);
  // Metres per fixed step is the frame-rate-independence number. Raw step counts differ by ±1
  // between pacings because the kernel's accumulator carries a remainder, which is a property
  // of the clock, not of the controller.
  L.push(`PACING       ${R.pacing.map((p) => `${(1 / p.slice).toFixed(0)}fps ${p.steps}st ${((12 - p.z) / p.steps).toFixed(5)} m/step`).join("   ")}`);
  L.push(`ERRORS       report=${R.reportErrors?.length ?? 0}  console=${R.consoleErrors.length}  warnings=${R.consoleWarnings.length}`);
  if (R.consoleWarnings.length) L.push(`  warnings: ${R.consoleWarnings.join(" | ")}`);

  const table = L.join("\n");
  console.log(table);
  fs.writeFileSync(outPath.replace(/\.json$/, ".txt"), table);
  console.log(`\nwritten ${OUT} and ${OUT.replace(/\.json$/, ".txt")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
