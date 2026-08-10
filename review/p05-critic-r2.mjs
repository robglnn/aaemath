// P05 critic, round 2. My own harness — nothing here reuses the builder's measure script.
//
// Drives the real app through Playwright, advances only through __vs.advance(), and reads
// camera state out of the probe plus an INDEPENDENT geometric check: the proving ground's
// box list is re-declared here from CollisionWorld's own exported constants so "is the lens
// inside a wall" is answered by my arithmetic, not by the rig's `penetrating` flag.

import { openGame, arg } from "../tools/lib/session.mjs";
import fs from "node:fs";
import path from "node:path";

const MODE = arg("mode", "shots");
const OUT = path.resolve(import.meta.dirname, "shots", "p05-critic-r2");
fs.mkdirSync(OUT, { recursive: true });

const DECK = 0.12;
const SUNK = 0.5;
// Boxes copied from PROVING_GROUND's builder (buildProvingGround) — solid AABBs the lens must
// never enter. y0 is the sunk bottom, y1 the top.
const BOXES = [
  { id: "terrace", x0: -20, y0: DECK - SUNK, z0: 30, x1: 20, y1: DECK + 3, z1: 46 },
  { id: "cornerA", x0: -40, y0: DECK - SUNK, z0: 24, x1: -31, y1: DECK + 3, z1: 25.2 },
  { id: "cornerB", x0: -40, y0: DECK - SUNK, z0: 24, x1: -38.8, y1: DECK + 3, z1: 33 },
  { id: "block5", x0: 26, y0: DECK - SUNK, z0: 24, x1: 36, y1: DECK + 5, z1: 34 },
];

function insideBoxes(p, pad = 0) {
  for (const b of BOXES) {
    if (
      p[0] > b.x0 - pad && p[0] < b.x1 + pad &&
      p[1] > b.y0 - pad && p[1] < b.y1 + pad &&
      p[2] > b.z0 - pad && p[2] < b.z1 + pad
    ) return b.id;
  }
  return null;
}
// signed distance from point to the outside of the nearest box (negative = inside)
function boxClearance(p) {
  let best = Infinity;
  for (const b of BOXES) {
    const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
    const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
    const dz = Math.max(b.z0 - p[2], 0, p[2] - b.z1);
    const outside = Math.hypot(dx, dy, dz);
    const inside = Math.min(
      p[0] - b.x0, b.x1 - p[0],
      p[1] - b.y0, b.y1 - p[1],
      p[2] - b.z0, b.z1 - p[2]
    );
    const d = outside > 0 ? outside : -inside;
    if (d < best) best = d;
  }
  // the deck plane itself (y = DECK, everywhere inside r=54) — lens must stay above it
  const deckGap = p[1] - DECK;
  return Math.min(best, deckGap);
}

const log = [];
const say = (...a) => { const s = a.join(" "); log.push(s); console.log(s); };

async function lock(d) {
  // Stop the real-time rAF loop. Otherwise wall-clock time spent taking a screenshot in
  // software GL keeps stepping the sim, and every "0.3 s" measurement is really 4 s.
  await d.run(() => window.__vs.kernel.halt());
  await d.run(() => window.__vsInput?.pointerLock(true));
}
async function mouse(d, dx, dy) {
  await d.run(([x, y]) => window.__vsInput?.mouse(x, y), [dx, dy]);
}
/** Advance `seconds` in `slice`-sized frames, injecting `dxTotal` of mouse across them. */
async function run(d, seconds, { slice = 1 / 60, dxTotal = 0, dyTotal = 0, render = true } = {}) {
  const n = Math.max(1, Math.round(seconds / slice));
  await d.run(
    ([sec, sl, dx, dy, count, rnd]) => {
      for (let i = 0; i < count; i++) {
        if (dx || dy) window.__vsInput?.mouse(dx / count, dy / count);
        window.__vs.advance(sl, { render: rnd });
      }
    },
    [seconds, slice, dxTotal, dyTotal, n, render]
  );
}
const cam = (d) => d.probe("camera");
const loco = (d) => d.probe("locomotion");

async function sample(d, label, opts = {}) {
  const c = await cam(d);
  const l = await loco(d);
  const clear = boxClearance(c.position);
  const inb = insideBoxes(c.position);
  say(
    `${label.padEnd(22)} pos=[${c.position.map((v) => v.toFixed(2)).join(",")}] ` +
    `dist=${c.distance.toFixed(3)} free=${c.freeDistance.toFixed(3)} desired=${c.desiredDistance.toFixed(3)} ` +
    `fov=${c.fov.toFixed(2)} pen=${c.penetrating} framing=${c.framing} op=${c.avatarOpacity.toFixed(2)} ` +
    `roll=${(opts.roll ?? 0).toFixed(4)} spd=${c.speed.toFixed(2)} lag=${c.followLag.toFixed(3)} ` +
    `| geomClear=${clear.toFixed(3)} insideBox=${inb ?? "-"}`
  );
  return { label, c, l, clear, inb };
}

// ---------------------------------------------------------------- modes

async function shots() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    const rows = [];
    await lock(d);
    await run(d, 0.6);
    say("--- boot report ---");
    say(JSON.stringify((await d.report()).stats));
    say("collision: " + JSON.stringify(await d.probe("collision")));
    rows.push(await sample(d, "idle"));
    await d.shoot(`review/shots/p05-critic-r2/01-idle.png`);

    // 1. sprint straight
    await d.page.keyboard.down("KeyW");
    await d.page.keyboard.down("ShiftLeft");
    await run(d, 3.0);
    rows.push(await sample(d, "sprint-3s"));
    await d.shoot(`review/shots/p05-critic-r2/02-sprint.png`);

    // 2. hard turn under sprint: 170 deg of yaw in 0.30 s while still holding forward
    const before = (await cam(d)).yaw;
    await run(d, 0.30, { dxTotal: -1236 }); // ~2.97 rad at 0.0024 rad/px
    const mid = await sample(d, "hard-turn-instant");
    await d.shoot(`review/shots/p05-critic-r2/03-hard-turn.png`);
    say(`  yaw ${before.toFixed(3)} -> ${mid.c.yaw.toFixed(3)}`);
    await run(d, 0.5);
    rows.push(await sample(d, "hard-turn+0.5s"));
    await d.shoot(`review/shots/p05-critic-r2/04-hard-turn-settled.png`);

    // 3. jump at sprint
    await d.page.keyboard.down("Space");
    await run(d, 1 / 60);
    await d.page.keyboard.up("Space");
    await run(d, 0.28);
    rows.push(await sample(d, "jump-apex"));
    await d.shoot(`review/shots/p05-critic-r2/05-jump-apex.png`);
    await run(d, 0.9);
    rows.push(await sample(d, "post-landing"));
    await d.shoot(`review/shots/p05-critic-r2/06-landing.png`);
    await d.page.keyboard.up("KeyW");
    await d.page.keyboard.up("ShiftLeft");
    await run(d, 1.0);

    fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(rows, null, 2));
  });
}

/** Walk to the terrace wall, face away, and let the boom press into it. */
async function wall() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await lock(d);
    await run(d, 0.5);
    const rows = [];
    // Stand just south of the 5 m block (x 26..36, z 24..34) facing away from it, so the boom
    // — not the body — is the thing driven into solid rock.
    await d.run(() => {
      window.__vs.kernel.get("locomotion").teleport(30, 1.2, 21.5, { heading: [0, -1] });
      const c = window.__vs.kernel.get("camera");
      c.yaw = 0; c.pitch = -0.11;
    });
    await run(d, 1.0);
    rows.push(await sample(d, "before-approach"));
    await d.shoot(`review/shots/p05-critic-r2/07-before-wall.png`);

    await d.page.keyboard.down("KeyS"); // backpedal into the rock face
    for (let i = 0; i < 6; i++) {
      await run(d, 0.4);
      rows.push(await sample(d, `pressing+${((i + 1) * 0.4).toFixed(1)}s`));
    }
    await d.page.keyboard.up("KeyS");
    await run(d, 0.3);
    rows.push(await sample(d, "backed-into-wall"));
    await d.shoot(`review/shots/p05-critic-r2/08-boom-in-wall.png`);
    say("player: " + JSON.stringify((await loco(d)).position));

    // sweep the yaw a full turn pressed against the wall, watching for pops / penetration
    let worst = { clear: Infinity }, popMax = 0, prevDist = (await cam(d)).distance;
    const trace = [];
    for (let i = 0; i < 72; i++) {
      await run(d, 1 / 30, { dxTotal: 36.4 }); // 5 deg per sample
      const c = await cam(d);
      const clear = boxClearance(c.position);
      const dd = Math.abs(c.distance - prevDist);
      if (dd > popMax) popMax = dd;
      prevDist = c.distance;
      trace.push({ i, yaw: +c.yaw.toFixed(3), dist: +c.distance.toFixed(3), free: +c.freeDistance.toFixed(3), pen: c.penetrating, clear: +clear.toFixed(3), op: +c.avatarOpacity.toFixed(3), pos: c.position });
      if (clear < worst.clear) worst = { clear, i, yaw: c.yaw, pos: c.position, dist: c.distance };
    }
    say(`wall yaw sweep: worst geometric clearance = ${worst.clear.toFixed(4)} m at yaw ${worst.yaw?.toFixed(3)} pos ${JSON.stringify(worst.pos)}`);
    say(`wall yaw sweep: max |Δdistance| between 1/30 s samples = ${popMax.toFixed(4)} m`);
    say(`wall yaw sweep: penetrating samples = ${trace.filter((t) => t.pen).length}/72`);
    await d.shoot(`review/shots/p05-critic-r2/10-wall-sweep-end.png`);

    // release: run away from the wall and look for a pop as occlusion clears
    const rel = [];
    await d.run(() => { const c = window.__vs.kernel.get("camera"); c.yaw = 0; });
    await run(d, 0.5);
    await d.page.keyboard.down("KeyW");
    for (let i = 0; i < 60; i++) {
      await run(d, 1 / 60);
      const c = await cam(d);
      rel.push(+c.distance.toFixed(4));
    }
    await d.page.keyboard.up("KeyW");
    let maxRate = 0;
    for (let i = 1; i < rel.length; i++) maxRate = Math.max(maxRate, Math.abs(rel[i] - rel[i - 1]) * 60);
    say(`occlusion release: distance ${rel[0]} -> ${rel[rel.length - 1]}, max rate ${maxRate.toFixed(2)} m/s`);
    say(`occlusion release trace: ${rel.slice(0, 40).join(" ")}`);
    await d.shoot(`review/shots/p05-critic-r2/11-release.png`);

    fs.writeFileSync(path.join(OUT, "wall.json"), JSON.stringify({ rows, trace, rel }, null, 2));
  });
}

/** Inside corner — the classic camera trap. */
async function corner() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await lock(d);
    await run(d, 0.4);
    // teleport near the inside corner using the public spawn signal, then settle
    await d.run(() => {
      window.__vs.kernel.get("locomotion").teleport(-36.4, 1.1, 27.4, { heading: [1, 1] });
    });
    await run(d, 1.2);
    const rows = [];
    rows.push(await sample(d, "corner-arrive"));
    // face out of the corner (+x,+z) so the boom is driven into the corner apex
    await d.run(() => { const c = window.__vs.kernel.get("camera"); c.yaw = -2.356; c.pitch = -0.11; });
    await run(d, 0.5);
    // press into the corner
    await d.page.keyboard.down("KeyS");
    await run(d, 1.6);
    await d.page.keyboard.up("KeyS");
    await run(d, 0.6);
    rows.push(await sample(d, "corner-pressed"));
    await d.shoot(`review/shots/p05-critic-r2/12-corner-pressed.png`);
    say("loco pos: " + JSON.stringify((await loco(d)).position ?? (await loco(d))));

    const trace = [];
    let worst = { clear: Infinity };
    for (let i = 0; i < 72; i++) {
      await run(d, 1 / 30, { dxTotal: 36.4 });
      const c = await cam(d);
      const clear = boxClearance(c.position);
      trace.push({ yaw: +c.yaw.toFixed(3), dist: +c.distance.toFixed(3), pen: c.penetrating, clear: +clear.toFixed(3), op: +c.avatarOpacity.toFixed(3), pos: c.position });
      if (clear < worst.clear) worst = { clear, yaw: c.yaw, pos: c.position, dist: c.distance, op: c.avatarOpacity };
    }
    say(`corner sweep: worst clearance ${worst.clear.toFixed(4)} m at yaw ${worst.yaw?.toFixed(3)} dist ${worst.dist?.toFixed(3)} opacity ${worst.op}`);
    say(`corner sweep: penetrating = ${trace.filter((t) => t.pen).length}/72, min opacity ${Math.min(...trace.map((t) => t.op)).toFixed(3)}`);
    await d.shoot(`review/shots/p05-critic-r2/13-corner-sweep.png`);

    // steep look-up while jammed in the corner — boom under the body
    await d.run(() => { const c = window.__vs.kernel.get("camera"); c.pitch = 1.0; });
    await run(d, 0.6);
    rows.push(await sample(d, "corner-look-up"));
    await d.shoot(`review/shots/p05-critic-r2/14-corner-lookup.png`);
    fs.writeFileSync(path.join(OUT, "corner.json"), JSON.stringify({ rows, trace }, null, 2));
  });
}

/** Frame-rate independence: identical input, different slice sizes. */
async function fps() {
  const results = {};
  for (const slice of [1 / 240, 1 / 60, 1 / 15]) {
    await openGame({ width: 640, height: 360 }, async (d) => {
      await lock(d);
      await run(d, 0.5, { slice, render: false });
      await d.page.keyboard.down("KeyW");
      await d.page.keyboard.down("ShiftLeft");
      await run(d, 3.0, { slice, render: false });
      const a = await cam(d);
      // hard turn
      await run(d, 0.4, { slice, dxTotal: -1236, render: false });
      const b = await cam(d);
      // jump
      await d.page.keyboard.down("Space");
      await run(d, slice, { slice, render: false });
      await d.page.keyboard.up("Space");
      await run(d, 0.30, { slice, render: false });
      const c = await cam(d);
      await run(d, 1.2, { slice, render: false });
      const e = await cam(d);
      await d.page.keyboard.up("KeyW");
      await d.page.keyboard.up("ShiftLeft");
      results[slice.toFixed(5)] = { sprint: a, turn: b, apex: c, land: e };
    });
  }
  const keys = Object.keys(results);
  const base = results[keys[1]];
  for (const k of keys) {
    for (const phase of ["sprint", "turn", "apex", "land"]) {
      const r = results[k][phase], b = base[phase];
      const dPos = Math.hypot(r.position[0] - b.position[0], r.position[1] - b.position[1], r.position[2] - b.position[2]);
      const dPlayer = Math.hypot(r.player[0] - b.player[0], r.player[1] - b.player[1], r.player[2] - b.player[2]);
      say(
        `slice=${k} ${phase.padEnd(7)} camPos=[${r.position.map((v) => v.toFixed(3)).join(",")}] ` +
        `player=[${r.player.map((v) => v.toFixed(3)).join(",")}] lag=${r.followLag.toFixed(4)} ` +
        `dist=${r.distance.toFixed(4)} fov=${r.fov.toFixed(3)} | ΔcamPos_vs_60=${dPos.toFixed(4)} Δplayer=${dPlayer.toFixed(4)}`
      );
    }
  }
  // the honest metric: camera-relative-to-player offset, which is what the player sees
  for (const k of keys) {
    for (const phase of ["sprint", "turn", "apex", "land"]) {
      const r = results[k][phase], b = base[phase];
      const ro = [r.position[0] - r.player[0], r.position[1] - r.player[1], r.position[2] - r.player[2]];
      const bo = [b.position[0] - b.player[0], b.position[1] - b.player[1], b.position[2] - b.player[2]];
      say(`slice=${k} ${phase.padEnd(7)} relOffset=[${ro.map((v) => v.toFixed(3)).join(",")}] Δrel_vs_60=${Math.hypot(ro[0] - bo[0], ro[1] - bo[1], ro[2] - bo[2]).toFixed(4)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, "fps.json"), JSON.stringify(results, null, 2));
}

/** reduceMotion must genuinely kill shake, and shake must exist without it. */
async function reduce() {
  for (const [label, query] of [["shake-on", {}], ["reduceMotion", { reduceMotion: "1" }]]) {
    await openGame({ width: 1600, height: 900, query }, async (d) => {
      await lock(d);
      await run(d, 0.6);
      const cfg = await d.run(async () => {
        const { config } = await import("/src/core/Config.js");
        return { reduceMotion: config.get("reduceMotion"), cameraShake: config.get("cameraShake") };
      });
      say(`${label}: config ${JSON.stringify(cfg)}`);
      await d.run(async () => {
        const { signals } = await import("/src/core/Signals.js");
        signals.emit("camera:shake", { amount: 1, seconds: 1.2 });
      });
      const samples = [];
      for (let i = 0; i < 24; i++) {
        await run(d, 1 / 60, { render: i === 6 });
        const c = await cam(d);
        const rot = await d.run(() => {
          const r = window.__vs.kernel.camera.rotation;
          return [r.x, r.y, r.z];
        });
        samples.push({ trauma: c.trauma, shake: c.shake, roll: rot[2], pos: c.position });
        if (i === 6) await d.shoot(`review/shots/p05-critic-r2/${label === "shake-on" ? "15-shake" : "16-reduce-motion"}.png`);
      }
      const maxRoll = Math.max(...samples.map((s) => Math.abs(s.roll)));
      const maxShake = Math.max(...samples.map((s) => s.shake));
      const maxTrauma = Math.max(...samples.map((s) => s.trauma));
      say(`${label}: maxTrauma=${maxTrauma.toFixed(4)} maxShakeMag=${maxShake.toFixed(4)} maxAbsRoll=${maxRoll.toFixed(5)} rad (${(maxRoll * 57.3).toFixed(2)} deg)`);
      // landing dip / fov breathing under reduceMotion
      await d.page.keyboard.down("KeyW");
      await d.page.keyboard.down("ShiftLeft");
      await run(d, 2.5);
      const c2 = await cam(d);
      say(`${label}: sprint fov=${c2.fov.toFixed(2)} dist=${c2.distance.toFixed(3)} speed=${c2.speed.toFixed(2)}`);
      await d.page.keyboard.up("KeyW");
      await d.page.keyboard.up("ShiftLeft");
      fs.writeFileSync(path.join(OUT, `reduce-${label}.json`), JSON.stringify(samples, null, 2));
    });
  }
}

/** Framing geometry: where does the body land in the frame, in NDC? */
async function framing() {
  for (const [w, h, tag] of [[1600, 900, "1600x900"], [1280, 720, "1280x720"], [3840, 2160, "3840x2160"]]) {
    await openGame({ width: w, height: h }, async (d) => {
      await lock(d);
      await run(d, 0.8);
      const proj = await d.run(() => {
        const k = window.__vs.kernel;
        const l = k.get("locomotion");
        const t = l.getCameraTarget();
        const v = t.position.clone();
        const head = v.clone(); head.y += 0.9;
        const feet = v.clone(); feet.y -= 0.9;
        const out = [v, head, feet].map((q) => { const c = q.clone().project(k.camera); return [+c.x.toFixed(4), +c.y.toFixed(4)]; });
        return { centre: out[0], head: out[1], feet: out[2], fov: k.camera.fov, aspect: k.camera.aspect, near: k.camera.near };
      });
      say(`${tag} idle: bodyNDC centre=${JSON.stringify(proj.centre)} head=${JSON.stringify(proj.head)} feet=${JSON.stringify(proj.feet)} fov=${proj.fov.toFixed(2)} near=${proj.near}`);
      await d.shoot(`review/shots/p05-critic-r2/frame-${tag}-idle.png`);
      await d.page.keyboard.down("KeyW");
      await d.page.keyboard.down("ShiftLeft");
      await run(d, 3.0);
      const proj2 = await d.run(() => {
        const k = window.__vs.kernel;
        const t = k.get("locomotion").getCameraTarget();
        const v = t.position.clone();
        const head = v.clone(); head.y += 0.9;
        const feet = v.clone(); feet.y -= 0.9;
        const out = [v, head, feet].map((q) => { const c = q.clone().project(k.camera); return [+c.x.toFixed(4), +c.y.toFixed(4)]; });
        return { centre: out[0], head: out[1], feet: out[2], fov: k.camera.fov };
      });
      say(`${tag} sprint: bodyNDC centre=${JSON.stringify(proj2.centre)} head=${JSON.stringify(proj2.head)} feet=${JSON.stringify(proj2.feet)} fov=${proj2.fov.toFixed(2)}`);
      await d.shoot(`review/shots/p05-critic-r2/frame-${tag}-sprint.png`);
      await d.page.keyboard.up("KeyW");
      await d.page.keyboard.up("ShiftLeft");
    });
  }
}

/** Is the yaw the rig ends up with a function of the frame rate, for identical total input? */
async function look() {
  for (const slice of [1 / 240, 1 / 60, 1 / 15]) {
    await openGame({ width: 640, height: 360 }, async (d) => {
      await lock(d);
      await run(d, 0.5, { slice, render: false });
      const y0 = (await cam(d)).yaw;
      await run(d, 0.4, { slice, dxTotal: -1236, render: false });
      const c = await cam(d);
      const inp = await d.probe("input");
      say(
        `slice=${slice.toFixed(5)} yaw ${y0.toFixed(5)} -> ${c.yaw.toFixed(5)} (Δ=${(c.yaw - y0).toFixed(5)} rad) ` +
        `lookUnit=${c.lookUnit} sens=${c.sensitivity}`
      );
      say(`   input.look = ${JSON.stringify(inp?.look ?? inp?.mouse ?? null)}`);
      // now with no rig involvement: pure vertical, and a pure-rig injection bypassing Input
      await d.run(async () => {
        const { signals } = await import("/src/core/Signals.js");
        for (let i = 0; i < 100; i++) signals.emit("input:look", { dx: 0.01, dy: 0 });
      });
      await run(d, slice, { slice, render: false });
      const c2 = await cam(d);
      say(`   direct signal 100x0.01 rad -> Δyaw = ${(c2.yaw - c.yaw).toFixed(5)}`);
    });
  }
}

/**
 * Clean frame-rate independence for the RIG alone: yaw/pitch are set directly (so P07's
 * look-input path cannot contaminate the result) and the only input is a held key, so the
 * 60 Hz simulation is bit-identical across slice sizes. Anything that differs is the rig.
 */
async function fps2() {
  const marks = [0.5, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  const out = {};
  for (const slice of [1 / 240, 1 / 60, 1 / 15]) {
    await openGame({ width: 640, height: 360 }, async (d) => {
      await lock(d);
      await d.run(() => {
        window.__vs.kernel.get("locomotion").teleport(31, 6.2, 27, { heading: [0, 1] });
        const c = window.__vs.kernel.get("camera");
        c.yaw = Math.PI; c.pitch = -0.11;
      });
      await run(d, 0.5, { slice, render: false });
      await d.page.keyboard.down("KeyW");
      await d.page.keyboard.down("ShiftLeft");
      const rows = [];
      let t = 0;
      for (const m of marks) {
        await run(d, m - t, { slice, render: false });
        t = m;
        // re-assert orientation identically every mark so drift cannot accumulate from input
        await d.run(() => { const c = window.__vs.kernel.get("camera"); c.yaw = Math.PI; c.pitch = -0.11; });
        const c = await cam(d);
        rows.push({
          t: m,
          rel: [c.position[0] - c.player[0], c.position[1] - c.player[1], c.position[2] - c.player[2]],
          dist: c.distance, fov: c.fov, lift: c.pivotLift, dip: c.pivotDip,
          player: c.player, grounded: c.grounded, speed: c.speed,
        });
      }
      await d.page.keyboard.up("KeyW");
      await d.page.keyboard.up("ShiftLeft");
      out[slice.toFixed(5)] = rows;
    });
  }
  const keys = Object.keys(out);
  const base = out[keys[1]];
  for (const k of keys) {
    out[k].forEach((r, i) => {
      const b = base[i];
      const dRel = Math.hypot(r.rel[0] - b.rel[0], r.rel[1] - b.rel[1], r.rel[2] - b.rel[2]);
      const dPlayer = Math.hypot(r.player[0] - b.player[0], r.player[1] - b.player[1], r.player[2] - b.player[2]);
      say(
        `slice=${k} t=${r.t.toFixed(2)} rel=[${r.rel.map((v) => v.toFixed(4)).join(",")}] ` +
        `dist=${r.dist.toFixed(4)} fov=${r.fov.toFixed(3)} lift=${r.lift.toFixed(4)} dip=${r.dip.toFixed(4)} ` +
        `grounded=${r.grounded} | Δrel_vs_60fps=${dRel.toFixed(4)} Δplayer=${dPlayer.toFixed(4)}`
      );
    });
  }
  fs.writeFileSync(path.join(OUT, "fps2.json"), JSON.stringify(out, null, 2));
}

/**
 * Pure-rig transients with a static simulation: the player never moves, so nothing but the
 * rig's own springs can differ. This is where a zero-order-hold spring shows its frame-rate
 * spread if it has one.
 */
async function rigfps() {
  const out = {};
  for (const slice of [1 / 240, 1 / 60, 1 / 15]) {
    await openGame({ width: 640, height: 360 }, async (d) => {
      await lock(d);
      await run(d, 1.0, { slice, render: false });
      const rows = [];
      await d.run(async () => {
        const { signals } = await import("/src/core/Signals.js");
        signals.emit("camera:fov", { target: 100, seconds: 0.4 });
        signals.emit("camera:shake", { amount: 1, seconds: 1.2 });
        signals.emit("camera:focus", { target: { x: 10, y: 3, z: 20 }, seconds: 0.5 });
      });
      for (const m of [0.1, 0.2, 0.3, 0.5, 0.8]) {
        await run(d, m - (rows.length ? rows[rows.length - 1].t : 0), { slice, render: false });
        const c = await cam(d);
        rows.push({ t: m, fov: c.fov, trauma: c.trauma, shake: c.shake, fw: c.focus.weight, dist: c.distance, pos: c.position, yaw: c.yaw, pitch: c.pitch });
      }
      out[slice.toFixed(5)] = rows;
    });
  }
  const keys = Object.keys(out);
  const base = out[keys[1]];
  for (const k of keys) {
    out[k].forEach((r, i) => {
      const b = base[i];
      say(
        `slice=${k} t=${r.t.toFixed(2)} fov=${r.fov.toFixed(4)} (Δ${(r.fov - b.fov).toFixed(4)}) ` +
        `trauma=${r.trauma.toFixed(4)} (Δ${(r.trauma - b.trauma).toFixed(4)}) ` +
        `focusW=${r.fw.toFixed(4)} (Δ${(r.fw - b.fw).toFixed(4)}) dist=${r.dist.toFixed(4)} (Δ${(r.dist - b.dist).toFixed(4)}) ` +
        `camΔ=${Math.hypot(r.pos[0] - b.pos[0], r.pos[1] - b.pos[1], r.pos[2] - b.pos[2]).toFixed(4)}`
      );
    });
  }
  fs.writeFileSync(path.join(OUT, "rigfps.json"), JSON.stringify(out, null, 2));
}

/** Steep look-up on open ground: does the boom drive the lens under the deck? */
async function ground() {
  await openGame({ width: 1600, height: 900 }, async (d) => {
    await lock(d);
    await run(d, 0.6);
    const rows = [];
    for (const p of [-1.16, -0.6, -0.11, 0.4, 0.7, 0.9, 1.02]) {
      await d.run((v) => { const c = window.__vs.kernel.get("camera"); c.pitch = v; }, p);
      await run(d, 0.8);
      const c = await cam(d);
      rows.push({ pitch: p, y: c.position[1], dist: c.distance, free: c.freeDistance, op: c.avatarOpacity, pen: c.penetrating });
      say(`pitch=${p.toFixed(2)} camY=${c.position[1].toFixed(3)} (deck y=0.12) dist=${c.distance.toFixed(3)} free=${c.freeDistance.toFixed(3)} opacity=${c.avatarOpacity.toFixed(2)} pen=${c.penetrating}`);
      if (p === 1.02 || p === -1.16) await d.shoot(`review/shots/p05-critic-r2/${p > 0 ? "17-pitch-max" : "18-pitch-min"}.png`);
    }
    fs.writeFileSync(path.join(OUT, "ground.json"), JSON.stringify(rows, null, 2));
  });
}

const modes = { shots, wall, corner, fps, fps2, rigfps, reduce, framing, look, ground };
const fn = modes[MODE];
if (!fn) { console.error("unknown mode", MODE); process.exit(1); }
await fn();
fs.writeFileSync(path.join(OUT, `${MODE}.log.txt`), log.join("\n"));
console.log("\n--- done:", MODE);
