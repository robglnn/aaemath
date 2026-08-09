// P04 CRITIC round 2 — same rig, but the kernel's realtime animation loop is HALTED first so
// that the only thing moving game time is my own advance() calls. Round 1 showed identical
// input scripts producing different results; this isolates whether that is P04 or the harness.

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg } from "../tools/lib/session.mjs";

const OUT = arg("out", "review/shots/p04-critic/measure2.json");

const PRELUDE = `(() => {
  const K = window.__vs.kernel;
  K.halt();                                  // no more rAF-driven realtime steps
  const L = K.get("locomotion"), C = K.get("collision"), I = K.get("input");
  const S = 1/60;
  const snap = () => { const p=L.position, v=L.velocity; return {
    t:+L.simTime.toFixed(6), x:+p.x.toFixed(6), y:+p.y.toFixed(6), z:+p.z.toFixed(6),
    vx:+v.x.toFixed(6), vy:+v.y.toFixed(6), vz:+v.z.toFixed(6), sp:+Math.hypot(v.x,v.z).toFixed(6),
    g:L.grounded, sl:L.sliding, st:L.state, hx:+L.heading.x.toFixed(6), hz:+L.heading.y.toFixed(6),
    coy:+L.coyote.toFixed(5), buf:+L.jumpBuffer.toFixed(5), air:+L.airtime.toFixed(5),
    lock:+L.landLock.toFixed(5), slope:+L.slopeDeg.toFixed(3),
    byaw:+(L._lastBasisYaw*180/Math.PI).toFixed(4), jumpAt:L.lastJump.at,
    landAt:L.lastLand.at, landImp:L.lastLand.impact, steps:K.stepCount };
  };
  window.__crit = {
    snap,
    mode: () => K.mode,
    step(n=1, rec=false){ const o=[]; for(let i=0;i<n;i++){ K.advance(S,{render:false}); if(rec) o.push(snap()); } return o; },
    reset(x,y,z,hx,hz){ L.teleport(x,y,z,{heading:[hx,hz]}); },
    groundY(x,z){ const g=C.groundAt(x,z,400); return g.hit? g.y : null; },
    // Direct-intent driver: bypasses P07 entirely so P04 can be judged on its own.
    intent(x,y,{sprint=false,walk=false}={}){ L.externalInput=true; L.moveX=x; L.moveY=y; L.sprintHeld=sprint; L.walkHeld=walk; },
    pressJump(){ L._pressJump(); },
    releaseJump(){ L.jumpHeld=false; },
  };
  return K.mode;
})()`;

const P = { W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD", SP: "Space", SH: "Shift" };

async function main() {
  const R = {};
  await openGame({ width: 1280, height: 720 }, async (d) => {
    R.mode = await d.run(PRELUDE);
    const step = (n, rec = false) => d.run(([n, rec]) => window.__crit.step(n, rec), [n, rec]);
    const snap = () => d.run(() => window.__crit.snap());
    const reset = (x, y, z, hx = 0, hz = -1) =>
      d.run(([x, y, z, hx, hz]) => window.__crit.reset(x, y, z, hx, hz), [x, y, z, hx, hz]);
    const gy = (x, z) => d.run(([x, z]) => window.__crit.groundY(x, z), [x, z]);
    const intent = (x, y, o = {}) => d.run(([x, y, o]) => window.__crit.intent(x, y, o), [x, y, o]);
    const pressJump = () => d.run(() => window.__crit.pressJump());
    const releaseJump = () => d.run(() => window.__crit.releaseJump());

    const deck = await gy(0, 0);
    const startY = deck + 0.93;

    // ---------------------------------------------------------------- D1 determinism, direct intent
    // Identical scripted sequence, three times, no keyboard, no realtime loop.
    async function scriptedDirect() {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0);
      await step(12);
      await intent(0, 1, { sprint: true });
      await step(45);
      await pressJump();
      await step(4);
      await releaseJump();
      await step(40);
      await intent(-1, 0, { sprint: true });
      await step(50);
      await intent(0, 0);
      await step(60);
      const s = await snap();
      delete s.t; delete s.steps; delete s.jumpAt; delete s.landAt;
      return s;
    }
    R.determinismDirect = [await scriptedDirect(), await scriptedDirect(), await scriptedDirect()];
    R.determinismDirectIdentical =
      JSON.stringify(R.determinismDirect[0]) === JSON.stringify(R.determinismDirect[1]) &&
      JSON.stringify(R.determinismDirect[1]) === JSON.stringify(R.determinismDirect[2]);

    // ---------------------------------------------------------------- D2 determinism through P07 keyboard
    async function scriptedKeys() {
      await reset(0, startY, 12, 0, -1);
      await d.run(() => { const L = window.__vs.kernel.get("locomotion"); L.moveX = 0; L.moveY = 0; L.sprintHeld = false; });
      await step(12);
      await d.page.keyboard.down(P.SH); await d.page.keyboard.down(P.W);
      await step(45);
      await d.page.keyboard.down(P.SP);
      await step(4);
      await d.page.keyboard.up(P.SP);
      await step(40);
      await d.page.keyboard.down(P.A);
      await step(50);
      await d.page.keyboard.up(P.A); await d.page.keyboard.up(P.W); await d.page.keyboard.up(P.SH);
      await step(60);
      const s = await snap();
      delete s.t; delete s.steps; delete s.jumpAt; delete s.landAt;
      return s;
    }
    R.determinismKeys = [await scriptedKeys(), await scriptedKeys(), await scriptedKeys()];
    R.determinismKeysIdentical =
      JSON.stringify(R.determinismKeys[0]) === JSON.stringify(R.determinismKeys[1]) &&
      JSON.stringify(R.determinismKeys[1]) === JSON.stringify(R.determinismKeys[2]);

    // ---------------------------------------------------------------- J1 jump arc trace
    async function jumpTrace(sprint) {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0);
      await step(12);
      if (sprint) { await intent(0, 1, { sprint: true }); await step(180); }
      const t0 = await snap();
      await pressJump();
      const tr = await step(120, true);
      await intent(0, 0);
      const lift = tr.findIndex((s) => !s.g);
      let land = -1;
      for (let i = lift + 1; i < tr.length; i++) if (tr[i].g) { land = i; break; }
      const seg = tr.slice(lift, land + 1);
      const apexIdx = seg.reduce((b, s, i) => (s.y > seg[b].y ? i : b), 0);
      return {
        startY: t0.y, takeoffSpeed: t0.sp,
        apexY: seg[apexIdx].y, height: +(seg[apexIdx].y - t0.y).toFixed(4),
        riseSteps: apexIdx + 1, fallSteps: seg.length - apexIdx - 1,
        riseSeconds: +((apexIdx + 1) / 60).toFixed(4),
        fallSeconds: +((seg.length - apexIdx - 1) / 60).toFixed(4),
        airtimeSeconds: +(seg.length / 60).toFixed(4),
        landingImpactSpeed: tr[land].landImp,
        landY: tr[land].y,
        distance: +Math.hypot(tr[land].x - t0.x, tr[land].z - t0.z).toFixed(3),
        vyTrace: seg.filter((_, i) => i % 3 === 0).map((s) => s.vy),
        yTrace: seg.filter((_, i) => i % 3 === 0).map((s) => +(s.y - t0.y).toFixed(3)),
      };
    }
    R.jumpStand = await jumpTrace(false);
    R.jumpSprint = await jumpTrace(true);

    // variable-height family: release after N steps
    R.jumpVariable = [];
    for (const hold of [1, 2, 3, 4, 6, 8, 12, 20, 40]) {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0); await step(12);
      const t0 = await snap();
      await pressJump();
      await step(hold);
      await releaseJump();
      const tr = await step(140, true);
      const lift = tr.findIndex((s) => !s.g);
      let land = -1; for (let i = lift + 1; i < tr.length; i++) if (tr[i].g) { land = i; break; }
      const seg = tr.slice(lift, land + 1);
      R.jumpVariable.push({
        holdSteps: hold, holdSeconds: +(hold / 60).toFixed(4),
        height: +(Math.max(...seg.map((s) => s.y)) - t0.y).toFixed(3),
        airtime: +(seg.length / 60).toFixed(4),
      });
    }

    // ---------------------------------------------------------------- W1 coyote window, direct
    const blockTop = await gy(31, 28);
    R.coyote = { trials: [] };
    for (let k = 0; k <= 12; k++) {
      await reset(31, blockTop + 0.95, 30, 0, -1);
      await intent(0, 0); await step(10);
      await intent(0, 1, { sprint: false });
      let left = -1;
      for (let i = 0; i < 400; i++) { const s = (await step(1, true))[0]; if (!s.g) { left = i; break; } }
      await step(k);
      await pressJump();
      const t = await step(2, true);
      await releaseJump(); await intent(0, 0);
      R.coyote.trials.push({ k, seconds: +((k + 1) / 60).toFixed(4), jumped: t.some((s) => s.vy > 5) });
    }
    const cmax = R.coyote.trials.filter((t) => t.jumped).map((t) => t.k).pop();
    R.coyote.windowSeconds = cmax === undefined ? 0 : +((cmax + 1) / 60).toFixed(4);
    R.coyote.monotonic = R.coyote.trials.every((t, i, a) => i === 0 || !(t.jumped && !a[i - 1].jumped));

    // ---------------------------------------------------------------- W2 buffer window, direct
    await reset(0, startY, 12, 0, -1); await intent(0, 0); await step(12);
    await pressJump(); await step(3); await releaseJump();
    const base = await step(200, true);
    const landStep = base.findIndex((s, i) => i > 5 && s.g);
    R.buffer = { landStep, trials: [] };
    for (let k = 0; k <= 14; k++) {
      await reset(0, startY, 12, 0, -1); await intent(0, 0); await step(12);
      await pressJump(); await step(3); await releaseJump();
      await step(Math.max(0, landStep - k));
      await pressJump();
      const tr = await step(k + 8, true);
      await releaseJump();
      R.buffer.trials.push({ k, leadSeconds: +(k / 60).toFixed(4), relaunched: tr.some((s) => s.vy > 5) });
    }
    const bmax = R.buffer.trials.filter((t) => t.relaunched).map((t) => t.k).pop();
    R.buffer.windowSeconds = bmax === undefined ? 0 : +(bmax / 60).toFixed(4);
    R.buffer.monotonic = R.buffer.trials.every((t, i, a) => i === 0 || !(t.relaunched && !a[i - 1].relaunched));

    // ---------------------------------------------------------------- S1 slope speed penalty (mid-ramp)
    R.slopeSpeeds = {};
    for (const [name, x] of [["flat", 25], ["10deg", -15], ["20deg", -7.6], ["30deg", -0.4], ["40deg", 7.0]]) {
      await reset(x, startY, name === "flat" ? 0 : 10, 0, 1);
      await intent(0, -1, { sprint: true });   // -Y = backward = world +Z with camera yaw 0
      const tr = await step(240, true);
      await intent(0, 0);
      const onRamp = tr.filter((s) => s.slope > 3 && s.slope < 50);
      R.slopeSpeeds[name] = {
        flatSpeed: +tr[100].sp.toFixed(3),
        onRampSamples: onRamp.length,
        meanRampSpeed: onRamp.length ? +(onRamp.reduce((a, s) => a + s.sp, 0) / onRamp.length).toFixed(3) : null,
        meanRampSlopeDeg: onRamp.length ? +(onRamp.reduce((a, s) => a + s.slope, 0) / onRamp.length).toFixed(1) : null,
        maxSlopeSeen: +Math.max(...tr.map((s) => s.slope)).toFixed(1),
        topY: +Math.max(...tr.map((s) => s.y)).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- S2 standing on a 54 deg flank
    const flankY = await gy(-11.5, -26);
    R.coneFlank = { probeY: flankY };
    if (flankY !== null) {
      await reset(-11.5, flankY + 0.95, -26, 0, -1);
      await intent(0, 0);
      const tr = await step(180, true);
      R.coneFlank.slidingSeen = tr.some((s) => s.sl);
      R.coneFlank.slopeDeg = tr[5].slope;
      R.coneFlank.slidDistance = +Math.hypot(tr.at(-1).x + 11.5, tr.at(-1).z + 26).toFixed(3);
      R.coneFlank.maxSpeed = +Math.max(...tr.map((s) => s.sp)).toFixed(3);
      R.coneFlank.endY = tr.at(-1).y;
    }
    // apex needle
    const tipY = await gy(-14, -26);
    await reset(-14, tipY + 0.95, -26, 0, -1);
    await intent(0, 0);
    const tipTr = await step(180, true);
    R.coneTip = {
      probeY: tipY, slopeSeen: tipTr[5].slope, sliding: tipTr.some((s) => s.sl),
      moved: +Math.hypot(tipTr.at(-1).x + 14, tipTr.at(-1).z + 26).toFixed(3),
      grounded: tipTr.at(-1).g,
    };

    // ---------------------------------------------------------------- T1 hard reversal / braking
    // Sprint, then slam full reverse. Does anything brake?
    await reset(0, startY, 20, 0, -1);
    await intent(0, 1, { sprint: true });
    await step(180);
    const entry = await snap();
    await intent(0, -1, { sprint: true });
    const rev = await step(150, true);
    await intent(0, 0);
    R.reversal = {
      entrySpeed: entry.sp,
      minSpeed: +Math.min(...rev.map((s) => s.sp)).toFixed(3),
      speedAtSteps: [5, 10, 20, 30, 45, 60].map((i) => +rev[i].sp.toFixed(3)),
      headingDegOverTime: [10, 20, 30, 45, 60].map((i) => +(Math.atan2(rev[i].hx, -rev[i].hz) * 180 / Math.PI).toFixed(1)),
      displacementFromEntry: +Math.hypot(rev.at(-1).x - entry.x, rev.at(-1).z - entry.z).toFixed(3),
      overshootDistanceBeforeReversingZ: +(Math.min(...rev.map((s) => s.z)) - entry.z).toFixed(3),
    };

    // ---------------------------------------------------------------- T2 rate-of-turn vs speed
    R.turnRates = {};
    for (const [name, opts, warm] of [["sprint", { sprint: true }, 180], ["run", {}, 120], ["walk", { walk: true }, 120]]) {
      await reset(0, startY, 20, 0, -1);
      await intent(0, 1, opts);
      await step(warm);
      const e = await snap();
      await intent(-1, 0, opts);
      const tr = await step(120, true);
      await intent(0, 0);
      let acc = 0, prev = Math.atan2(e.hx, -e.hz);
      const un = tr.map((s) => { const a = Math.atan2(s.hx, -s.hz); let dd = a - prev; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; acc += dd; prev = a; return acc; });
      const i90 = un.findIndex((a) => Math.abs(a) >= Math.PI / 2);
      let arc = 0; for (let i = 1; i <= Math.max(i90, 1); i++) arc += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
      R.turnRates[name] = {
        entrySpeed: e.sp,
        degPerSec: +(Math.abs(un[5]) * 180 / Math.PI / (6 / 60)).toFixed(1),
        timeTo90: i90 >= 0 ? +((i90 + 1) / 60).toFixed(4) : null,
        radius90: i90 > 0 ? +(arc / (Math.PI / 2)).toFixed(3) : null,
        speedAt90: i90 >= 0 ? +tr[i90].sp.toFixed(3) : null,
        peakSpeedDuringTurn: +Math.max(...tr.map((s) => s.sp)).toFixed(3),
        minSpeedDuringTurn: +Math.min(...tr.map((s) => s.sp)).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- F1 frame-rate independence
    async function paced(slice, steps) {
      await reset(0, startY, 12, 0, -1);
      await intent(0, 0);
      await step(12);
      await intent(0, 1, { sprint: true });
      const before = await d.run(() => window.__vs.kernel.stepCount);
      await d.run(([sl, n]) => { for (let i = 0; i < n; i++) window.__vs.kernel.advance(sl, { render: false }); }, [slice, Math.round(3 / slice)]);
      const s = await snap();
      await intent(0, 0);
      return { slice: +slice.toFixed(6), stepsRun: s.steps - before, x: s.x, y: s.y, z: s.z, sp: s.sp };
    }
    R.pacing = [];
    for (const sl of [1 / 60, 1 / 30, 1 / 15, 1 / 144, 0.0237, 0.25]) R.pacing.push(await paced(sl, 3));
    // normalise: distance per fixed step should be identical regardless of pacing
    R.pacingNormalised = R.pacing.map((p) => ({
      slice: p.slice, stepsRun: p.stepsRun,
      metresPerStep: +((12 - -p.z) / p.stepsRun).toFixed(6),
    }));

    // ---------------------------------------------------------------- B1 spawn ground-snap argument order
    R.spawnGroundAt = await d.run(() => {
      const C = window.__vs.kernel.get("collision");
      return {
        asCalledByLocomotion: (() => { const g = C.groundAt(4, 400, 14); return { hit: g.hit, y: g.y }; })(),
        correctOrder: (() => { const g = C.groundAt(4, 14, 400); return { hit: g.hit, y: g.y }; })(),
      };
    });

    R.finalErrors = (await d.report()).errors;
    R.consoleErrors = d.consoleErrors.slice(0, 10);
  });

  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(R, null, 2));
  console.log("written", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
