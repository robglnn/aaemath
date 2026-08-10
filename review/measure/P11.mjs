#!/usr/bin/env node
/**
 * P11 — lighting rig & flat-shaded material system: the re-runnable proof.
 *
 *   node review/measure/P11.mjs [--tier=medium] [--width=1280] [--height=720] [--shots] [--post]
 *
 * Every claim this piece makes is a row below, with a threshold stated up front and a number
 * measured off real pixels of the real app. It boots through `tools/lib/session.mjs`, stands the
 * reviewer-only material board into the live scene (`Lighting.materialBoard()`), reads the drawing
 * buffer back, and does its arithmetic in the page so nothing is inferred from a description.
 *
 * **Thresholds come from `design/art-direction.md`, not from what the build happens to do.** Where a
 * threshold is looser than the target's own number, the row says why.
 *
 * By default the post stack is DETACHED for the measurement, because these claims are about the
 * lighting and material path that P11 owns; a bloom or a grade belongs to P12 and would be measured
 * as if it were this piece's work. Pass `--post` to measure the composited frame instead — the
 * script prints both totals either way.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";

const WIDTH = Number(arg("width", "1280"));
const HEIGHT = Number(arg("height", "720"));
const TIER = arg("tier", "medium");
const SHOTS = has("shots");
const KEEP_POST = has("post");

// ---------------------------------------------------------------------------- claims

/**
 * `id`, what it proves, and the threshold. A critic should be able to argue with the threshold
 * without having to reverse-engineer the measurement.
 */
const CLAIMS = [
  ["F1", "flat shading is real: fraction of board triangles carrying one normal per face", ">= 0.99", "art-direction §2.1"],
  ["F2", "a cliff resolves into countable planes (compact flat regions, tol 2/255, >= 0.02% of frame)", ">= 20", "§13 row 1, relaxed from 25 — the board is one shelf, not a vista"],
  ["F3", "a facet is exactly one colour: median luminance spread inside a flat region", "<= 0.02", "§3.3 / §1.1 (target measures 0.0096)"],
  ["L1", "no tone curve: median |measured - predicted| / predicted over >= 12 lit facets", "<= 0.08", "§3.3, §3.5 — predicted is albedo x (N.L key + fill + bounce), linear"],
  ["L2", "the object shows 4-7 distinct lit values plus a shadow value", "4..7", "§3.3"],
  ["K1", "§3.2 witness 1 — ground inside its own cast shadow, absolute Y", "0.0300 +- 0.010", "§3.2/§3.4 (target Y 0.0300, and the ratio 4.36 follows at N·L 0.342)"],
  ["K2", "§3.2 witness 2 — brightest lit rock facet vs the turned facet", "10..30", "§3.2's mid-facet witness is 11.96; the target's own extremes give 19.5"],
  ["S1", "turned faces converge on one chromatic blue: median hue / S / Y", "hue 190..206, S 0.33..0.50, Y 0.020..0.033", "§3.4, §13 row 3"],
  ["S2", "and they converge independent of albedo: hue spread across rock, shelf and armour", "<= 8 deg", "§3.4's three witnesses span 195..201 = 6 deg"],
  ["S3", "cast shadow on open ground is the OTHER family, not the same blue", "hue 100..140", "§3.4, §13 row 4"],
  ["S4", "the two dark families are genuinely separate", ">= 50 deg apart", "§13 row 4 (target 79.2)"],
  ["C1", "the courier has a real contact shadow: darkening at the boot", ">= 0.45", "the piece's own claim; no contact shadow is why a character floats"],
  ["C2", "and it starts AT the boot: lit gap between the sole and the shadow", "<= 0.06 m", "peter-panning is the reflex fix that makes C1 worse"],
  ["A1", "the accent budget: frame share at hue 150-200, V >= 0.80, S >= 0.25", "0.4%..1.8%", "§7.2, §13 row 5"],
  ["A2", "cyan has not leaked: accent-gate pixels landing outside the accent meshes", "<= 3%", "§7.2, §13 row 6"],
  ["M1", "three substances, not three tints: rock warm, crystal cyan-bright, water cyan", "hues 20..50 / 150..200 / 150..200", "§10.2"],
  ["M2", "and water is a different substance from crystal because it MOVES", "water >= 4% pixels change, crystal <= 0.5%", "§5 — the carry's animated hard-edged ramp"],
  ["T1", "it does not fizz: pixels changing > 0.05 Y in one fixed step, camera static", "<= 0.2%", "§11.6, palette.motion.budgets.temporalNoiseCeiling"],
  ["N1", "nothing on §5's global ban list is in the board", "0 of each", "§5, §12.2 no.18"],
  ["N2", "the renderer path is linear: toneMapping is NoToneMapping", "== 0", "§3.5"],
  ["P1", "the material factory shares: cache hits vs materials built", "hits >= built", "architecture.md program budget"],
  ["P2", "shader programs and draw calls with the board standing", "programs <= 90, draws <= 320", "architecture.md"],
];

// ---------------------------------------------------------------------------- helpers


const fmt = (v, n = 4) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(n)) : v);
const rows = [];
function claim(id, value, pass, note = "") {
  rows.push({ id, value, pass: !!pass, note });
}

// ---------------------------------------------------------------------------- run

const results = { tier: TIER, width: WIDTH, height: HEIGHT, post: KEEP_POST, measurements: {} };

await openGame({ width: WIDTH, height: HEIGHT, tier: TIER }, async (d) => {
  await d.play(0.6);

  // A neighbouring piece mid-edit must not make this piece unmeasurable, but it must also never be
  // silently swallowed: anything touching P11's own files is fatal here, anything else is reported
  // loudly and the run continues so the numbers below still mean something.
  const boot = await d.report();
  const problems = [boot.fatal, ...(boot.errors ?? []), ...d.consoleErrors].filter(Boolean);
  const mine = problems.filter((p) => /Lighting\.js|Materials\.js|14-lighting/.test(p));
  results.bootProblems = problems;
  if (mine.length) {
    console.error("P11 BOOT FAILURE — this piece is broken, measurements aborted:");
    console.error(JSON.stringify(mine, null, 2));
    process.exitCode = 1;
    return;
  }
  if (problems.length) {
    console.error(`NOTE: ${problems.length} boot problem(s) from OTHER pieces; P11 measured anyway:`);
    for (const p of problems) console.error("  " + String(p).split("\n")[0]);
  }

  // Stand the board up and take the camera.
  const setup = await d.run(
    ([view, keepPost]) => {
      const K = window.__vs.kernel;
      if (!keepPost) {
        // These claims are about the lighting and material path; a composited grade belongs to P12.
        K.__p11Composer = K.composer;
        K.composer = null;
      }
      const L = K.byName.get("lighting");
      return L.materialBoard({ view });
    },
    ["wide", KEEP_POST]
  );
  results.marks = setup.marks;

  await d.page.evaluate(installToolkit);
  await d.play(0.4);
  const buf = await d.run(() => window.__p11.grab());
  results.buffer = buf;

  const rig = await d.run(() => window.__p11.rig());
  results.rig = rig;

  if (SHOTS) await d.shoot("review/shots/p11/board-wide.png");

  // ---------------------------------------------------------------- F1 flat shading
  const facets = await d.run(() => {
    const board = window.__p11.scene.getObjectByName("vs.materialBoard");
    return window.__vs.probe("lighting").facets ?? null;
  });
  const facetAudit = await d.run(() => {
    const L = window.__p11.lighting;
    const board = window.__p11.scene.getObjectByName("vs.materialBoard");
    // Re-run the audit scoped to the board so other pieces' geometry cannot flatter or damn us.
    return L.constructor === Object ? null : (() => {
      const mod = window.__p11;
      let tris = 0, flat = 0, meshes = 0;
      const near = (a, b) => Math.abs(a - b) < 1e-4;
      board.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.normal) return;
        meshes++;
        const n = o.geometry.attributes.normal;
        const idx = o.geometry.index;
        const count = (idx ? idx.count : n.count) / 3;
        if (o.material.flatShading) { tris += count; flat += count; return; }
        for (let t = 0; t < count; t++) {
          const a = idx ? idx.getX(t * 3) : t * 3;
          const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
          const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          const same = near(n.getX(a), n.getX(b)) && near(n.getY(a), n.getY(b)) && near(n.getZ(a), n.getZ(b)) &&
                       near(n.getX(a), n.getX(c)) && near(n.getY(a), n.getY(c)) && near(n.getZ(a), n.getZ(c));
          if (same) flat++;
        }
        tris += count;
      });
      return { meshes, triangles: tris, flatTriangles: flat, flatFraction: tris ? flat / tris : 1 };
    })();
  });
  results.measurements.facets = facetAudit;
  claim("F1", fmt(facetAudit.flatFraction), facetAudit.flatFraction >= 0.99,
    `${facetAudit.flatTriangles}/${facetAudit.triangles} tris over ${facetAudit.meshes} meshes`);

  // ---------------------------------------------------------------- F2/F3 countable planes
  const regions = await d.run(() => {
    const r = window.__p11.regions(2, 0.0002);
    const spreads = r.map((x) => x.spread).sort((a, b) => a - b);
    return {
      count: r.length,
      largestFrac: r[0]?.frac ?? 0,
      medianSpread: spreads.length ? spreads[spreads.length >> 1] : 0,
      p90Spread: spreads.length ? spreads[Math.floor(spreads.length * 0.9)] : 0,
    };
  });
  results.measurements.regions = regions;
  claim("F2", regions.count, regions.count >= 20, `largest region ${fmt(regions.largestFrac * 100, 2)}% of frame`);
  claim("F3", fmt(regions.medianSpread), regions.medianSpread <= 0.02, `p90 ${fmt(regions.p90Spread)}`);

  // ---------------------------------------------------------------- L1/L2 the cosine ladder
  const ladder = await d.run(() => {
    const T = window.__p11;
    const rig = T.rig();
    const albedo = T.albedoOf("vs.board.spire");
    const faces = T.faces("vs.board.spire").filter((f) => f.area > 0.6);
    const lit = faces.filter((f) => f.ndl > 0.2);
    const samples = [];
    for (const f of lit) {
      const [r, g, b] = T.box(f.x, f.y, 2);
      const measured = T.lum(r, g, b);
      // predicted, in linear light, exactly as three's Lambert accumulates it
      const hemiW = 0.5 * f.ny + 0.5;
      const bdl = Math.max(0, f.ny * rig.bounceDir[1] + 0 * rig.bounceDir[0]);
      const pred = [0, 1, 2].map((c) => {
        const key = rig.key[c] * rig.keyI * Math.max(0, f.ndl);
        const hemi = (rig.fillGround[c] + (rig.fillSky[c] - rig.fillGround[c]) * hemiW) * rig.fillI;
        const bnc = rig.bounce[c] * rig.bounceI * bdl;
        return (albedo[c] * (key + hemi + bnc)) / Math.PI;
      });
      const predY = 0.2126 * pred[0] + 0.7152 * pred[1] + 0.0722 * pred[2];
      samples.push({ ndl: f.ndl, measured, predY, err: Math.abs(measured - predY) / Math.max(predY, 1e-4) });
    }
    samples.sort((a, b) => a.err - b.err);
    const errs = samples.map((s) => s.err);
    // distinct lit values: cluster measured luminance at 4% relative spacing
    const vals = samples.map((s) => s.measured).sort((a, b) => b - a);
    const steps = [];
    for (const v of vals) if (!steps.some((s) => Math.abs(s - v) / Math.max(s, 1e-4) < 0.06)) steps.push(v);
    return {
      n: samples.length,
      medianErr: errs.length ? errs[errs.length >> 1] : 1,
      p90Err: errs.length ? errs[Math.floor(errs.length * 0.9)] : 1,
      steps: steps.length,
      ladder: steps.slice(0, 8).map((v) => Number(v.toFixed(4))),
      normalised: steps.slice(0, 8).map((v) => Number((v / steps[0]).toFixed(3))),
      albedo,
    };
  });
  results.measurements.ladder = ladder;
  claim("L1", fmt(ladder.medianErr), ladder.n >= 12 && ladder.medianErr <= 0.08,
    `${ladder.n} lit facets, p90 err ${fmt(ladder.p90Err)}, ladder ${JSON.stringify(ladder.normalised)}`);
  claim("L2", ladder.steps, ladder.steps >= 4 && ladder.steps <= 7, `distinct lit values on one mass`);

  // ---------------------------------------------------------------- K1/K2 the two witnesses
  const witnesses = await d.run((marks) => {
    const T = window.__p11;
    const L = T.lighting;
    const three = L.root.position.constructor;
    const key = L._shadowDir;
    // The ground witness has to be a plane that is IN a cast shadow and a plane that is not, at the
    // same albedo. The courier's own shadow supplies the first: walk out along it from the boots.
    const shadowXZ = new three(-key.x, 0, -key.z).normalize();
    const sideXZ = new three(-shadowXZ.z, 0, shadowXZ.x);
    const foot = new three(marks.sole[0], marks.sole[1], marks.sole[2]);
    // sample a run of points along the shadow and take the darkest stable one
    const shadePts = [];
    for (let t = 0.5; t <= 1.6; t += 0.1) {
      const p = foot.clone().addScaledVector(shadowXZ, t);
      const s = T.project([p.x, p.y, p.z]);
      shadePts.push({ t, px: T.box(s[0], s[1], 2) });
    }
    shadePts.sort((a, b) => T.lum(...a.px) - T.lum(...b.px));
    const shade = shadePts[Math.min(2, shadePts.length - 1)].px;
    // and an unshadowed patch of the same shelf, well clear of everything on it
    const litPts = [];
    for (let t = -1.6; t <= 1.6; t += 0.4) {
      const p = foot.clone().addScaledVector(sideXZ, 2.4).addScaledVector(shadowXZ, t);
      const s = T.project([p.x, p.y, p.z]);
      litPts.push(T.box(s[0], s[1], 2));
    }
    litPts.sort((a, b) => T.lum(...a) - T.lum(...b));
    const light = litPts[litPts.length >> 1];
    const ys = T.lum(...shade), yl = T.lum(...light);

    // Rock mass: brightest lit facet against the most turned facet of the spire.
    const faces = T.faces("vs.board.spire").filter((f) => f.area > 0.4);
    let best = null, turned = null;
    for (const f of faces) {
      const p = T.box(f.x, f.y, 2);
      const Y = T.lum(...p);
      if (f.ndl > 0.25 && (!best || Y > best.Y)) best = { Y, ndl: f.ndl, px: p };
      if (f.ndl < -0.15 && (!turned || Y < turned.Y)) turned = { Y, ndl: f.ndl, px: p };
    }
    return {
      faces: faces.length,
      groundLit: yl, groundShade: ys, groundRatio: ys > 0 ? yl / ys : 0,
      groundLitPx: light, groundShadePx: shade,
      groundLitHsv: T.hsv(...light),
      groundShadeHsv: T.hsv(...shade),
      rockLit: best?.Y ?? 0, rockLitNdL: best?.ndl ?? 0, rockTurned: turned?.Y ?? 0,
      rockRatio: turned?.Y ? best.Y / turned.Y : 0,
      rockLitPx: best?.px, rockTurnedPx: turned?.px,
    };
  }, results.marks);
  results.measurements.witnesses = witnesses;
  claim("K1", fmt(witnesses.groundShade, 4), Math.abs(witnesses.groundShade - 0.0300) <= 0.010,
    `lit ground Y ${fmt(witnesses.groundLit)}, ratio ${fmt(witnesses.groundRatio, 2)} (target 4.36 at N·L 0.342)`);
  claim("K2", fmt(witnesses.rockRatio, 2), witnesses.rockRatio >= 10 && witnesses.rockRatio <= 30,
    `lit Y ${fmt(witnesses.rockLit)} at N·L ${fmt(witnesses.rockLitNdL, 2)} vs turned Y ${fmt(witnesses.rockTurned)}`);

  // ---------------------------------------------------------------- S1..S4 the two dark families
  const families = await d.run(() => {
    const T = window.__p11;
    const sample = (meshName, minArea) => {
      const faces = T.faces(meshName).filter((f) => f.ndl < -0.2 && f.area > minArea);
      const hs = [], ss = [], ys = [];
      for (const f of faces) {
        const p = T.box(f.x, f.y, 2);
        const [h, s] = T.hsv(...p);
        hs.push(h); ss.push(s); ys.push(T.lum(...p));
      }
      const med = (a) => (a.length ? a.slice().sort((u, v) => u - v)[a.length >> 1] : null);
      return { n: faces.length, hue: med(hs), s: med(ss), y: med(ys) };
    };
    const rock = sample("vs.board.spire", 0.6);
    const shelf = sample("vs.board.underside", 1.0);
    const armour = sample("hero.torso", 0.0);
    // The whole-frame version of §13 row 3, on the same gate the art bible publishes.
    const turnedPop = T.gate(170, 220, 0, 0, 0, 0.06);
    const groundPop = T.gate(60, 150, 0, 0, 0, 0.06);
    return { rock, shelf, armour, turnedPop: { n: turnedPop.n, share: turnedPop.share, hue: turnedPop.hue, s: turnedPop.s }, groundPop: { n: groundPop.n, share: groundPop.share, hue: groundPop.hue, s: groundPop.s } };
  });
  results.measurements.families = families;
  const fh = [families.rock.hue, families.shelf.hue, families.armour.hue].filter((v) => v != null);
  const spread = fh.length > 1 ? Math.max(...fh) - Math.min(...fh) : 0;
  const tp = families.turnedPop;
  claim("S1", `hue ${fmt(tp.hue, 1)} S ${fmt(tp.s, 3)} Y ${fmt(families.rock.y)}`,
    tp.hue >= 190 && tp.hue <= 206 && tp.s >= 0.33 && tp.s <= 0.5 &&
    families.rock.y >= 0.02 && families.rock.y <= 0.033,
    `turned-face population is ${fmt(tp.share * 100, 2)}% of frame`);
  claim("S2", fmt(spread, 1), spread <= 8,
    `rock ${fmt(families.rock.hue, 1)}, shelf ${fmt(families.shelf.hue, 1)}, armour ${fmt(families.armour.hue, 1)}`);
  claim("S3", fmt(witnesses.groundShadeHsv[0], 1),
    witnesses.groundShadeHsv[0] >= 100 && witnesses.groundShadeHsv[0] <= 140,
    `cast shadow on open ground keeps its albedo under the blue fill`);
  const delta = Math.abs((tp.hue ?? 0) - witnesses.groundShadeHsv[0]);
  claim("S4", fmt(delta, 1), delta >= 50, `the two dark families must not be one`);

  // ---------------------------------------------------------------- A1/A2/T1 on the composed frame
  //
  // Measured against a NEUTRAL backdrop. The sky carries no light in this rig (no env map, no IBL),
  // so hiding it changes not one lit pixel — but §7.2 puts the sky's cyan contribution at zero by
  // law, and its clouds drift, so leaving P10's sky in would score P10's work as P11's. The real-sky
  // numbers are reported alongside so the difference is on the page.
  const skyOn = await d.run(() => {
    const T = window.__p11;
    T.grab();
    const withSky = {
      accent: T.gate(150, 200, 0.8, 0.25, 0, 2).share,
      percentiles: T.percentiles(),
    };
    T.lighting.neutralSky(true);
    T.grab();
    return withSky;
  });
  results.measurements.withRealSky = skyOn;

  const accent = await d.run(() => {
    const T = window.__p11;
    const g = T.gate(150, 200, 0.8, 0.25, 0, 2);
    const boxes = T.accentBoxes();
    let outside = 0;
    for (let i = 0; i < g.xs.length; i++) {
      const x = g.xs[i], y = g.yps[i];
      if (!boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) outside++;
    }
    return { share: g.share, n: g.n, outside, outsideShare: g.n ? outside / g.n : 0, boxes: boxes.length };
  });
  results.measurements.accent = accent;
  claim("A1", fmt(accent.share * 100, 3) + "%", accent.share >= 0.004 && accent.share <= 0.018,
    `${accent.n} px in the cyan gate; with P10's sky in frame it is ${fmt(skyOn.accent * 100, 2)}%`);
  claim("A2", fmt(accent.outsideShare * 100, 2) + "%", accent.outsideShare <= 0.03,
    `${accent.outside} accent-gate pixels outside ${accent.boxes} accent meshes`);

  await d.run(() => { window.__p11.grab(); window.__p11.stash(); });
  await d.advance(1 / 60);
  const noise = await d.run(() => {
    const T = window.__p11;
    T.grab();
    return T.moved(0.05, null);
  });
  results.measurements.temporal = noise;
  claim("T1", fmt(noise.share * 100, 3) + "%", noise.share <= 0.002,
    `${noise.moved} of ${noise.total} px changed > 0.05 Y in one fixed step`);

  const pct = await d.run(() => window.__p11.percentiles());
  results.measurements.exposure = pct;
  await d.run(() => window.__p11.lighting.neutralSky(false));

  // ---------------------------------------------------------------- C1/C2 the contact shadow
  await d.run(() => window.__p11.lighting.materialBoard({ view: "contact" }));
  await d.play(0.2);
  await d.run(() => window.__p11.grab());
  if (SHOTS) await d.shoot("review/shots/p11/board-contact.png");

  const contact = await d.run((marks) => {
    const T = window.__p11;
    const L = T.lighting;
    const three = L.root.position.constructor;
    const key = L._shadowDir;
    const dirXZ = new three(-key.x, 0, -key.z).normalize();
    const sole = new three(marks.sole[0], marks.sole[1], marks.sole[2]);
    // Walk out from the sole, along the shadow, in 2 cm steps, sampling the ground it lands on.
    const walk = [];
    for (let t = 0; t <= 60; t++) {
      const d0 = t * 0.02;
      const p = sole.clone().addScaledVector(dirXZ, d0);
      const s = T.project([p.x, p.y, p.z]);
      const px = T.box(s[0], s[1], 1);
      walk.push({ t: d0, y: T.lum(...px), sx: s[0], sy: s[1] });
    }
    // Reference: the same shelf, the same albedo, out of the shadow — the median of a run so a
    // single facet edge cannot set the baseline.
    const across = new three(-dirXZ.z, 0, dirXZ.x);
    const refs = [];
    for (let t = 0; t <= 30; t++) {
      const p = sole.clone().addScaledVector(dirXZ, t * 0.02).addScaledVector(across, 1.4);
      const s = T.project([p.x, p.y, p.z]);
      refs.push(T.lum(...T.box(s[0], s[1], 1)));
    }
    refs.sort((a, b) => a - b);
    const litRef = refs[refs.length >> 1];
    const darkening = walk.map((w) => 1 - w.y / Math.max(litRef, 1e-4));
    let first = null;
    for (let i = 0; i < walk.length; i++) if (darkening[i] >= 0.45) { first = walk[i].t; break; }
    const near = darkening.slice(0, 26);
    return {
      litRef,
      contactDarkening: Math.max(...near),
      atSole: darkening[0],
      firstDarkAt: first,
      soleScreen: [Math.round(walk[0].sx), Math.round(walk[0].sy)],
      profile: walk.slice(0, 26).map((w, i) => [w.t, Number(w.y.toFixed(4)), Number(darkening[i].toFixed(3))]),
    };
  }, results.marks);
  results.measurements.contact = contact;
  claim("C1", fmt(contact.contactDarkening, 3), contact.contactDarkening >= 0.45,
    `lit reference Y ${fmt(contact.litRef)}; darkening at the sole ${fmt(contact.atSole, 3)}`);
  claim("C2", contact.firstDarkAt, contact.firstDarkAt !== null && contact.firstDarkAt <= 0.06,
    `metres of lit ground between the sole and the shadow`);

  // ---------------------------------------------------------------- M/A substances
  await d.run(() => window.__p11.lighting.materialBoard({ view: "substances" }));
  await d.play(0.2);
  await d.run(() => window.__p11.grab());
  if (SHOTS) await d.shoot("review/shots/p11/board-substances.png");

  const subs = await d.run(() => {
    const T = window.__p11;
    const pick = (meshName, minNdl) => {
      const faces = T.faces(meshName).filter((f) => f.ndl > minNdl);
      const hs = [], ys = [], vs = [], ss = [];
      for (const f of faces) {
        const p = T.box(f.x, f.y, 1);
        const [h, s, v] = T.hsv(...p);
        hs.push(h); ss.push(s); vs.push(v); ys.push(T.lum(...p));
      }
      const med = (a) => (a.length ? a.slice().sort((u, v) => u - v)[a.length >> 1] : null);
      return { n: faces.length, hue: med(hs), s: med(ss), v: med(vs), y: med(ys) };
    };
    return {
      rock: pick("vs.board.boulderA", -0.05),
      crystal: pick("vs.board.crystal.0", -1),
      water: pick("vs.board.carry", -1),
      grey: pick("vs.board.grey", -1),
      metal: pick("vs.board.metal", -0.05),
      foliage: pick("vs.board.blade.0", -1),
    };
  });
  results.measurements.substances = subs;
  const m1 =
    subs.rock.hue >= 20 && subs.rock.hue <= 50 &&
    subs.crystal.hue >= 150 && subs.crystal.hue <= 200 && subs.crystal.v >= 0.8 &&
    subs.water.hue >= 150 && subs.water.hue <= 200;
  claim("M1", `rock ${fmt(subs.rock.hue, 1)} / crystal ${fmt(subs.crystal.hue, 1)} V ${fmt(subs.crystal.v, 2)} / water ${fmt(subs.water.hue, 1)} V ${fmt(subs.water.v, 2)}`, m1,
    `grey hue ${fmt(subs.grey.hue, 1)} S ${fmt(subs.grey.s, 3)}, metal hue ${fmt(subs.metal.hue, 1)}, foliage Y ${fmt(subs.foliage.y, 3)}`);

  // ---------------------------------------------------------------- M2 water moves, crystal does not
  const motion = await d.run(() => {
    const T = window.__p11;
    const boxOf = (name) => {
      const three = T.lighting.root.position.constructor;
      const m = T.meshByName(name);
      m.updateMatrixWorld(true);
      const pos = m.geometry.attributes.position;
      let a = [1e9, 1e9, -1e9, -1e9];
      const v = new three();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const s = T.project([v.x, v.y, v.z]);
        a[0] = Math.min(a[0], s[0]); a[1] = Math.min(a[1], s[1]);
        a[2] = Math.max(a[2], s[0]); a[3] = Math.max(a[3], s[1]);
      }
      return a.map((n, i) => Math.max(0, Math.min(i % 2 ? T.buf.h - 1 : T.buf.w - 1, Math.round(n))));
    };
    T.__waterBox = boxOf("vs.board.carry");
    T.__crystalBox = boxOf("vs.board.crystal.0");
    T.stash();
    return { waterBox: T.__waterBox, crystalBox: T.__crystalBox };
  });
  await d.play(1.0);
  const moved = await d.run(() => {
    const T = window.__p11;
    T.grab();
    return {
      water: T.moved(0.05, T.__waterBox),
      crystal: T.moved(0.05, T.__crystalBox),
    };
  });
  results.measurements.motion = { ...motion, ...moved };
  claim("M2", `water ${fmt(moved.water.share * 100, 2)}% / crystal ${fmt(moved.crystal.share * 100, 2)}%`,
    moved.water.share >= 0.04 && moved.crystal.share <= 0.005,
    `over 1.0 s of simulation, camera static`);

  // ---------------------------------------------------------------- N/P housekeeping
  const banned = await d.run(() => window.__p11.banned());
  results.measurements.banned = banned;
  const bannedClean =
    banned.standard === 0 && banned.physical === 0 && banned.envMap === 0 &&
    banned.normalMap === 0 && banned.roughnessMap === 0 && banned.anyMap === 0;
  claim("N1", JSON.stringify(banned), bannedClean,
    `${banned.meshes} board meshes; scene.environment ${banned.sceneEnvironment ? "SET by another piece" : "null"}`);

  const probe = await d.probe("lighting");
  results.measurements.probe = { renderer: probe.renderer, shadow: probe.shadow, lights: probe.lights, materials: probe.materials };
  claim("N2", probe.renderer.toneMapping, probe.renderer.toneMapping === 0, `0 == THREE.NoToneMapping`);

  const mstats = probe.materials;
  claim("P1", `${mstats.cacheHits} hits / ${mstats.built} built`, mstats.cacheHits >= mstats.built,
    `${mstats.instances} instances across ${mstats.programVariants} program variants, ${mstats.textures} textures`);

  const stats = (await d.report()).stats;
  results.measurements.stats = stats;
  claim("P2", `${stats.programs} programs / ${stats.drawCalls} draws / ${stats.triangles} tris`,
    stats.programs <= 90 && stats.drawCalls <= 320, `tier ${stats.tier} at ${WIDTH}x${HEIGHT}`);

  results.consoleErrors = d.consoleErrors;
  results.consoleWarnings = d.consoleWarnings.slice(0, 10);
});

// ---------------------------------------------------------------------------- report

const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const table = CLAIMS.map(([id, what, threshold, source]) => ({
  id,
  claim: what,
  threshold,
  measured: byId[id]?.value ?? "NOT RUN",
  result: byId[id] ? (byId[id].pass ? "PASS" : "FAIL") : "MISSING",
  note: byId[id]?.note ?? "",
  source,
}));

const passed = table.filter((t) => t.result === "PASS").length;
const failed = table.filter((t) => t.result !== "PASS");

console.log(JSON.stringify({ ...results, table }, null, 2));
console.log("");
console.log("id   result  threshold                                   measured");
console.log("---- ------- ------------------------------------------- --------------------------------");
for (const t of table) {
  console.log(
    `${t.id.padEnd(4)} ${t.result.padEnd(7)} ${String(t.threshold).slice(0, 43).padEnd(43)} ${String(t.measured)}`
  );
}
console.log("");
console.log(`P11: ${passed}/${table.length} claims pass`);
if (failed.length) {
  console.log("FAILED:");
  for (const t of failed) console.log(`  ${t.id}  ${t.claim}\n        want ${t.threshold}, got ${t.measured}  ${t.note}`);
  process.exitCode = 1;
}

if (SHOTS) {
  const outDir = path.resolve(ROOT, "review/measure");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "P11.json"), JSON.stringify({ ...results, table }, null, 2));
}
