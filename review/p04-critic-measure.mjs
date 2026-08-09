// P04 CRITIC's independent measurement rig. Written by the critic, not the builder.
// Everything here drives the REAL app through the REAL input path (Playwright key events ->
// P07 Input -> signals -> P04 Locomotion) and advances time only through the fixed-step clock.
//
// node review/p04-critic-measure.mjs [--out=review/shots/p04-critic/measure.json]

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg } from "../tools/lib/session.mjs";

const OUT = arg("out", "review/shots/p04-critic/measure.json");

// ---------------------------------------------------------------- page-side helpers
const PRELUDE = `(() => {
  window.__crit = (() => {
    const K = window.__vs.kernel;
    const L = K.get("locomotion");
    const C = K.get("collision");
    const S = 1/60;
    const snap = () => {
      const p = L.position, v = L.velocity;
      return { t:+L.simTime.toFixed(6), x:+p.x.toFixed(6), y:+p.y.toFixed(6), z:+p.z.toFixed(6),
               vx:+v.x.toFixed(6), vy:+v.y.toFixed(6), vz:+v.z.toFixed(6),
               sp:+Math.hypot(v.x,v.z).toFixed(6), g:L.grounded, sl:L.sliding, st:L.state,
               hx:+L.heading.x.toFixed(6), hz:+L.heading.y.toFixed(6),
               coy:+L.coyote.toFixed(5), buf:+L.jumpBuffer.toFixed(5),
               air:+L.airtime.toFixed(5), lock:+L.landLock.toFixed(5),
               byaw:+(L._lastBasisYaw*180/Math.PI).toFixed(4),
               jumpAt:L.lastJump.at, landAt:L.lastLand.at, landImp:L.lastLand.impact };
    };
    return {
      L, C, K, snap,
      step(n=1, rec=false){ const out=[]; for(let i=0;i<n;i++){ K.advance(S,{render:false}); if(rec) out.push(snap()); } return out; },
      reset(x,y,z,hx,hz){ L.teleport(x,y,z,{heading:[hx,hz]}); },
      groundY(x,z){ const g=C.groundAt(x,z,400); return g.hit? g.y : null; },
    };
  })();
  return "ok";
})()`;

const P = { W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD", SP: "Space", SH: "Shift" };

async function main() {
  const results = {};
  await openGame({ width: 1280, height: 720 }, async (d) => {
    const boot = await d.report();
    results.boot = {
      ready: boot.ready, fatal: boot.fatal,
      errors: boot.errors, consoleErrors: d.consoleErrors.slice(0, 10),
      probes: Object.keys(boot.probes || {}),
      collision: boot.probes?.collision,
      simHzCheck: null,
    };

    await d.run(PRELUDE);

    const step = (n, rec = false) => d.run(([n, rec]) => window.__crit.step(n, rec), [n, rec]);
    const snap = () => d.run(() => window.__crit.snap());
    const reset = (x, y, z, hx = 0, hz = -1) =>
      d.run(([x, y, z, hx, hz]) => window.__crit.reset(x, y, z, hx, hz), [x, y, z, hx, hz]);
    const gy = (x, z) => d.run(([x, z]) => window.__crit.groundY(x, z), [x, z]);

    // ---------- sanity: where is the ground on my runway?
    const deck = await gy(0, 0);
    results.runway = { deckY: deck, samples: {} };
    for (const z of [12, 6, 0, -6, -12, -20, -30, -40, -48]) {
      results.runway.samples[`z=${z}`] = await gy(0, z);
    }

    const startY = deck + 0.91 + 0.02; // halfSeg(0.55) + radius(0.36)

    // ---------------------------------------------------------------- M1 acceleration
    async function accelRun(sprint, seconds = 4) {
      await reset(0, startY, 12, 0, -1);
      await step(12); // settle onto ground
      const t0 = await snap();
      if (sprint) await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.W);
      const trace = await step(Math.round(seconds * 60), true);
      await d.page.keyboard.up(P.W);
      if (sprint) await d.page.keyboard.up(P.SH);
      return { t0, trace };
    }

    function accelStats(t0, trace) {
      const vmax = Math.max(...trace.map((s) => s.sp));
      const find = (frac) => {
        const target = vmax * frac;
        for (let i = 0; i < trace.length; i++) if (trace[i].sp >= target) return (i + 1) / 60;
        return null;
      };
      const dist = Math.hypot(trace.at(-1).x - t0.x, trace.at(-1).z - t0.z);
      return {
        vmax: +vmax.toFixed(3),
        t50: find(0.5), t63: find(0.63), t90: find(0.9), t95: find(0.95), t99: find(0.99),
        distTo90: (() => {
          const target = vmax * 0.9;
          for (const s of trace) if (s.sp >= target) return +Math.hypot(s.x - t0.x, s.z - t0.z).toFixed(3);
          return null;
        })(),
        firstStepSpeed: trace[0].sp,
        speedAt: {
          "0.10s": trace[5]?.sp, "0.25s": trace[14]?.sp, "0.50s": trace[29]?.sp,
          "1.00s": trace[59]?.sp, "2.00s": trace[119]?.sp, "4.00s": trace.at(-1).sp,
        },
        basisYawDrift: +(Math.max(...trace.map((s) => Math.abs(s.byaw))) ).toFixed(4),
        endState: trace.at(-1).st,
        dist4s: +dist.toFixed(3),
      };
    }

    const sprintRun = await accelRun(true, 4);
    results.accelSprint = accelStats(sprintRun.t0, sprintRun.trace);
    const runRun = await accelRun(false, 4);
    results.accelRun = accelStats(runRun.t0, runRun.trace);

    // ---------------------------------------------------------------- M2 stopping
    async function stopRun(sprint) {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      if (sprint) await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.W);
      await step(180); // reach terminal speed
      const at = await snap();
      await d.page.keyboard.up(P.W);
      if (sprint) await d.page.keyboard.up(P.SH);
      const trace = await step(120, true);
      let stopIdx = trace.findIndex((s) => s.sp < 0.05);
      if (stopIdx < 0) stopIdx = trace.length - 1;
      const s = trace[stopIdx];
      return {
        entrySpeed: +at.sp.toFixed(3),
        stopTime: +((stopIdx + 1) / 60).toFixed(4),
        stopDistance: +Math.hypot(s.x - at.x, s.z - at.z).toFixed(3),
        speedTrace: trace.slice(0, 20).map((r) => +r.sp.toFixed(3)),
      };
    }
    results.stopSprint = await stopRun(true);
    results.stopRun = await stopRun(false);

    // ---------------------------------------------------------------- M3 jump
    async function jumpRun({ holdSteps = 200, moving = false, sprint = false }) {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      if (moving) {
        if (sprint) await d.page.keyboard.down(P.SH);
        await d.page.keyboard.down(P.W);
        await step(180);
      }
      const t0 = await snap();
      await d.page.keyboard.down(P.SP);
      const a = await step(Math.min(holdSteps, 2), true);
      if (holdSteps <= 2) await d.page.keyboard.up(P.SP);
      const b = await step(Math.max(0, holdSteps - 2), true);
      if (holdSteps > 2) await d.page.keyboard.up(P.SP);
      const c = await step(200, true);
      const trace = [...a, ...b, ...c];
      if (moving) {
        await d.page.keyboard.up(P.W);
        if (sprint) await d.page.keyboard.up(P.SH);
      }
      // airborne window
      const liftIdx = trace.findIndex((s) => !s.g);
      let landIdx = -1;
      for (let i = liftIdx + 1; i < trace.length; i++) if (trace[i].g) { landIdx = i; break; }
      const seg = trace.slice(liftIdx, landIdx < 0 ? trace.length : landIdx + 1);
      const apex = Math.max(...seg.map((s) => s.y));
      const riseTime = (seg.findIndex((s) => s.y === apex) + 1) / 60;
      return {
        takeoffSpeed: +t0.sp.toFixed(3),
        height: +(apex - t0.y).toFixed(3),
        airtime: landIdx < 0 ? null : +((landIdx - liftIdx + 1) / 60).toFixed(4),
        riseTime: +riseTime.toFixed(4),
        fallTime: landIdx < 0 ? null : +((landIdx - liftIdx + 1) / 60 - riseTime).toFixed(4),
        landingImpact: landIdx < 0 ? null : trace[landIdx].landImp,
        landLock: landIdx < 0 ? null : Math.max(...trace.slice(landIdx, landIdx + 20).map((s) => s.lock)),
        horizontalDistance: landIdx < 0 ? null :
          +Math.hypot(trace[landIdx].x - t0.x, trace[landIdx].z - t0.z).toFixed(3),
        speedKeptThroughLanding: landIdx < 0 ? null :
          +(trace[landIdx].sp / Math.max(t0.sp, 1e-6)).toFixed(3),
      };
    }
    results.jumpStandFullHold = await jumpRun({ holdSteps: 200 });
    results.jumpStandTap = await jumpRun({ holdSteps: 1 });
    results.jumpStandTap3 = await jumpRun({ holdSteps: 3 });
    results.jumpSprintHold = await jumpRun({ holdSteps: 200, moving: true, sprint: true });

    // ---------------------------------------------------------------- M4 coyote
    // Run off the 5 m block (x 26..36, z 24..34, top y = deck+5) and press jump k steps late.
    const blockTop = await gy(31, 28);
    results.coyote = { blockTopY: blockTop, trials: [] };
    async function coyoteTrial(k) {
      await reset(31, blockTop + 0.93, 30, 0, -1);
      await step(10);
      await d.page.keyboard.down(P.W);
      // walk to the -Z edge
      let leftGround = -1;
      for (let i = 0; i < 400; i++) {
        const s = (await step(1, true))[0];
        if (!s.g) { leftGround = i; break; }
      }
      if (leftGround < 0) { await d.page.keyboard.up(P.W); return null; }
      await step(k);
      await d.page.keyboard.down(P.SP);
      const t = await step(2, true);
      await d.page.keyboard.up(P.SP);
      await d.page.keyboard.up(P.W);
      const jumped = t.some((s) => s.vy > 5);
      return { k, delaySeconds: +((k + 1) / 60).toFixed(4), jumped };
    }
    let coyoteMax = -1;
    for (let k = 0; k <= 14; k++) {
      const r = await coyoteTrial(k);
      results.coyote.trials.push(r);
      if (r?.jumped) coyoteMax = k;
    }
    results.coyote.measuredWindowSeconds = coyoteMax >= 0 ? +((coyoteMax + 1) / 60).toFixed(4) : 0;
    results.coyote.tunedValue = 0.14;

    // ---------------------------------------------------------------- M5 jump buffer
    // Jump, then press jump again k steps BEFORE touchdown; does it re-launch on landing?
    async function bufferBaseline() {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.SP);
      await step(3);
      await d.page.keyboard.up(P.SP);
      const tr = await step(200, true);
      const landIdx = tr.findIndex((s, i) => i > 5 && s.g);
      return landIdx;
    }
    const landAt = await bufferBaseline();
    results.buffer = { baselineLandStep: landAt, trials: [] };
    async function bufferTrial(k) {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.SP);
      await step(3);
      await d.page.keyboard.up(P.SP);
      const pre = Math.max(0, landAt - k);
      await step(pre);
      await d.page.keyboard.down(P.SP);
      const tr = await step(k + 6, true);
      await d.page.keyboard.up(P.SP);
      const relaunched = tr.some((s) => s.vy > 5);
      return { k, leadSeconds: +(k / 60).toFixed(4), relaunched };
    }
    let bufMax = -1;
    for (let k = 0; k <= 16; k++) {
      const r = await bufferTrial(k);
      results.buffer.trials.push(r);
      if (r.relaunched) bufMax = k;
    }
    results.buffer.measuredWindowSeconds = bufMax >= 0 ? +(bufMax / 60).toFixed(4) : 0;
    results.buffer.tunedValue = 0.17;

    // ---------------------------------------------------------------- M6 sprint turn radius
    async function turnRun(keys, seconds = 1.6) {
      await reset(0, startY, 20, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.W);
      await step(180);
      const entry = await snap();
      await d.page.keyboard.up(P.W);
      for (const k of keys) await d.page.keyboard.down(k);
      const tr = await step(Math.round(seconds * 60), true);
      for (const k of keys) await d.page.keyboard.up(k);
      await d.page.keyboard.up(P.SH);
      // heading angle over time
      const ang = tr.map((s) => Math.atan2(s.hx, -s.hz));
      const unwrap = [];
      let acc = 0, prev = Math.atan2(entry.hx, -entry.hz);
      for (const a of ang) { let d2 = a - prev; while (d2 > Math.PI) d2 -= 2 * Math.PI; while (d2 < -Math.PI) d2 += 2 * Math.PI; acc += d2; prev = a; unwrap.push(acc); }
      // time to turn 90 deg, and the lateral offset / path radius at that point
      const i90 = unwrap.findIndex((a) => Math.abs(a) >= Math.PI / 2);
      let radius = null, arcLen = 0;
      if (i90 >= 0) {
        for (let i = 1; i <= i90; i++) arcLen += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
        radius = arcLen / (Math.PI / 2);
      }
      const chord = i90 >= 0 ? Math.hypot(tr[i90].x - entry.x, tr[i90].z - entry.z) : null;
      return {
        entrySpeed: +entry.sp.toFixed(3),
        turnRateDegPerSec: +(((unwrap[9] ?? 0) - 0) * 180 / Math.PI / (10 / 60)).toFixed(1),
        timeTo90deg: i90 >= 0 ? +((i90 + 1) / 60).toFixed(4) : null,
        arcRadius90: radius === null ? null : +radius.toFixed(3),
        chordAt90: chord === null ? null : +chord.toFixed(3),
        speedAt90: i90 >= 0 ? +tr[i90].sp.toFixed(3) : null,
        minSpeedDuringTurn: +Math.min(...tr.map((s) => s.sp)).toFixed(3),
        totalTurnDeg: +(unwrap.at(-1) * 180 / Math.PI).toFixed(1),
        // maximum lateral deviation from the entry heading line (the "does it drift" test)
        maxLateral: +Math.max(...tr.map((s) => Math.abs((s.x - entry.x)))).toFixed(3),
      };
    }
    results.turnSprintLeft = await turnRun([P.A]);
    results.turnSprintReverse = await turnRun([P.S], 2.0);
    results.turnWalkLeft = await (async () => {
      await reset(0, startY, 20, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.W);
      await step(90);
      const entry = await snap();
      await d.page.keyboard.up(P.W);
      await d.page.keyboard.down(P.A);
      const tr = await step(90, true);
      await d.page.keyboard.up(P.A);
      let acc = 0, prev = Math.atan2(entry.hx, -entry.hz);
      const un = tr.map((s) => { const a = Math.atan2(s.hx, -s.hz); let dd = a - prev; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; acc += dd; prev = a; return acc; });
      const i90 = un.findIndex((a) => Math.abs(a) >= Math.PI / 2);
      let arc = 0; for (let i = 1; i <= Math.max(i90, 0); i++) arc += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
      return { entrySpeed: +entry.sp.toFixed(3), timeTo90deg: i90 >= 0 ? +((i90 + 1) / 60).toFixed(4) : null, arcRadius90: i90 > 0 ? +(arc / (Math.PI / 2)).toFixed(3) : null };
    })();

    // ---------------------------------------------------------------- M7 slopes
    results.slopes = {};
    for (const [name, x] of [["10deg", -15], ["20deg", -7.6], ["30deg", -0.4], ["40deg", 7.0], ["52deg", 14.4]]) {
      await reset(x, startY, 10, 0, 1);
      await step(12);
      await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.S); // camera yaw 0 -> KeyS pushes toward +Z, up the ramps
      const tr = await step(300, true);
      await d.page.keyboard.up(P.S);
      await d.page.keyboard.up(P.SH);
      const last = tr.at(-1);
      results.slopes[name] = {
        climbedTo: +last.y.toFixed(3),
        finalSpeed: +last.sp.toFixed(3),
        slid: tr.some((s) => s.sl),
        maxY: +Math.max(...tr.map((s) => s.y)).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- M8 abuse
    results.abuse = {};

    // (a) sprint into the terrace wall head-on: tunnelling / jitter / stuck
    {
      await reset(31, startY, 12, 0, 1); // face +Z, 12 m of runway into the 5 m block wall at z=24
      await step(12);
      await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.S); // move backwards = toward +Z with camera yaw 0
      const tr = await step(300, true);
      await d.page.keyboard.up(P.S);
      await d.page.keyboard.up(P.SH);
      const last = tr.at(-1);
      let maxJitter = 0;
      for (let i = 20; i < tr.length; i++) {
        const j = Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y, tr[i].z - tr[i - 1].z);
        if (j > maxJitter) maxJitter = j;
      }
      results.abuse.wallCharge = {
        finalPos: [last.x, last.y, last.z], finalSpeed: +last.sp.toFixed(3),
        grounded: last.g, state: last.st, insideGeometry: last.y < -1,
        maxSingleStepMove: +maxJitter.toFixed(4),
      };
    }

    // (b) inside corner: charge into the 90-degree trap
    {
      await reset(-36, startY, 29, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.SH);
      await d.page.keyboard.down(P.A);
      await d.page.keyboard.down(P.W);
      const tr = await step(240, true);
      await d.page.keyboard.up(P.A); await d.page.keyboard.up(P.W); await d.page.keyboard.up(P.SH);
      const last = tr.at(-1);
      let maxJitter = 0;
      for (let i = 30; i < tr.length; i++) {
        const j = Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y, tr[i].z - tr[i - 1].z);
        if (j > maxJitter) maxJitter = j;
      }
      const yOsc = tr.slice(60).map((s) => s.y);
      results.abuse.insideCorner = {
        finalPos: [last.x, last.y, last.z], grounded: last.g,
        maxSingleStepMove: +maxJitter.toFixed(4),
        yRangeAfterSettle: +(Math.max(...yOsc) - Math.min(...yOsc)).toFixed(4),
        escaped: last.x > -30 || last.z < 20,
      };
    }

    // (c) spam jump every other step for 5 s while sprinting
    {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      await d.page.keyboard.down(P.SH); await d.page.keyboard.down(P.W);
      const all = [];
      for (let i = 0; i < 150; i++) {
        await d.page.keyboard.down(P.SP);
        all.push(...await step(1, true));
        await d.page.keyboard.up(P.SP);
        all.push(...await step(1, true));
      }
      await d.page.keyboard.up(P.W); await d.page.keyboard.up(P.SH);
      const jumps = new Set(all.map((s) => s.jumpAt)).size;
      results.abuse.jumpSpam = {
        jumpsIn5s: jumps, finalY: all.at(-1).y, finalState: all.at(-1).st,
        maxY: +Math.max(...all.map((s) => s.y)).toFixed(3),
        stuckAirborne: all.slice(-30).every((s) => !s.g),
      };
    }

    // (d) stair walk-up: which risers are climbable
    results.abuse.stairs = {};
    const risers = [[0.25, -11.5], [0.5, -4.5], [0.7, 4.5], [0.9, 11.5]];
    for (const [h, z] of risers) {
      await reset(-18, startY, z, -1, 0);
      await step(12);
      await d.page.keyboard.down(P.A);
      const tr = await step(300, true);
      await d.page.keyboard.up(P.A);
      results.abuse.stairs[`riser_${h}`] = {
        gainedHeight: +(Math.max(...tr.map((s) => s.y)) - tr[0].y).toFixed(3),
        finalX: tr.at(-1).x, grounded: tr.at(-1).g,
      };
    }

    // (e) jump at a slope edge (cone crown, 54 deg) — slide behaviour
    {
      await reset(-14, (await gy(-14, -26)) + 0.95, -26, 0, -1);
      await step(6);
      const tr = await step(240, true);
      results.abuse.coneCrown = {
        sliding: tr.some((s) => s.sl),
        endedGrounded: tr.at(-1).g,
        slidDistance: +Math.hypot(tr.at(-1).x + 14, tr.at(-1).z + 26).toFixed(3),
        maxSlideSpeed: +Math.max(...tr.map((s) => s.sp)).toFixed(3),
      };
    }

    // ---------------------------------------------------------------- M9 frame-rate independence
    // Same total game time, different slice sizes. A fixed-step sim must land on the same value.
    async function paced(slice, total) {
      await reset(0, startY, 12, 0, -1);
      await d.run(([sl]) => { for (let i = 0; i < 12; i++) window.__vs.kernel.advance(1 / 60, { render: false }); }, [slice]);
      await d.page.keyboard.down(P.SH); await d.page.keyboard.down(P.W);
      await d.run(([sl, tot]) => {
        const n = Math.round(tot / sl);
        for (let i = 0; i < n; i++) window.__vs.kernel.advance(sl, { render: false });
      }, [slice, total]);
      const s = await snap();
      await d.page.keyboard.up(P.W); await d.page.keyboard.up(P.SH);
      return { slice, x: s.x, y: s.y, z: s.z, sp: s.sp };
    }
    results.frameRateIndependence = [
      await paced(1 / 60, 3),
      await paced(1 / 30, 3),
      await paced(1 / 15, 3),
      await paced(1 / 144, 3),
      await paced(0.0237, 3),
    ];

    // ---------------------------------------------------------------- M10 determinism inside one page
    async function scripted() {
      await reset(0, startY, 12, 0, -1);
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
      return await snap();
    }
    results.determinismSamePage = [await scripted(), await scripted(), await scripted()];

    // ---------------------------------------------------------------- M11 camera basis contamination
    // Does gameplay direction depend on the camera (a variable-dt system)?
    {
      await reset(0, startY, 12, 0, -1);
      await step(12);
      const before = await snap();
      // force a hard landing from height to trigger camera:shake, then sample basis yaw
      await d.run(() => window.__crit.L.teleport(0, 22, 12, { heading: [0, -1] }));
      const tr = await step(160, true);
      const post = tr.filter((s) => s.landAt > 0);
      results.cameraBasis = {
        yawBeforeAnyEvent: before.byaw,
        landImpact: tr.find((s) => s.landAt > 0)?.landImp ?? null,
        basisYawRangeAfterLanding: post.length
          ? +(Math.max(...post.map((s) => s.byaw)) - Math.min(...post.map((s) => s.byaw))).toFixed(4)
          : null,
        basisYawSamples: post.slice(0, 25).map((s) => s.byaw),
      };
    }

    results.finalReport = {
      errors: (await d.report()).errors,
      consoleErrors: d.consoleErrors.slice(0, 10),
      failedRequests: d.failedRequests.slice(0, 10),
    };
  });

  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
