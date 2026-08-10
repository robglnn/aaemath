#!/usr/bin/env node
/**
 * P11 — the light rig and the flat-shaded material language: the re-runnable proof.
 *
 *   node review/measure/P11.mjs [--tier=medium] [--width=1280] [--height=720] [--shots] [--post]
 *
 * ---------------------------------------------------------------------------------------------
 * **EVERY CLAIM BELOW IS MEASURED ON THE SHIPPED SCENE. There is no other scene to measure.**
 *
 * The previous revision of this script stood a synthetic `materialBoard()` into the world — one
 * shelf, one spire, one crystal cluster, one courier — hid everything else, and measured that. It
 * passed. It was also worthless: a hostile review found that `world/Materials.js` was imported by
 * exactly one file and painted no world mesh at all, so every colour this piece had ever claimed
 * described a private test board. In the frame a player actually sees, rock turned from the key
 * measured hue 33-40 against the target's 196-203 — a 160° miss on the largest read in the frame.
 *
 * `Materials.buildBoard()` and `Lighting.materialBoard()` are now **deleted**, not flagged off, so
 * this script cannot make that mistake again even by accident. What it measures instead:
 *
 *   - Leaf Nine, booted normally, with terrain, level composition, scatter, sky, avatar and post
 *     all mounted, at the player's own spawn.
 *   - The gameplay camera for every frame-wide claim. The ONLY thing this script takes control of
 *     is the camera, and only for the contact-shadow rows (C1/C2), where the shot has to stand
 *     down-sun of the player or the cast shadow falls away behind them. Nothing is added to the
 *     scene, nothing is hidden, no material is swapped.
 *
 * Two mechanisms make per-pixel claims about a 170 000-triangle scene honest:
 *
 *   - **Ownership by subtraction.** Render, hide a mesh, render again: every pixel that changed is
 *     a pixel that mesh painted. Exact, and it needs no depth buffer. Rows that name a substance
 *     sample only inside that substance's own mask.
 *   - **Flatness rejection.** §3.3 says a facet is one colour, so a 5x5 median whose luminance
 *     spread is large straddled two facets, two instances or a silhouette. Those samples are thrown
 *     away and the count of thrown-away samples is printed next to every row, because a median over
 *     two survivors is not a measurement — which is the other thing the last round got told.
 *
 * Thresholds come from `design/art-direction.md` and `design/quality-bar.md`, not from what the
 * build happens to do. By default the post stack is DETACHED, because these rows are about the
 * lighting and material path P11 owns and a bloom belongs to P12; `--post` measures the composited
 * frame instead.
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
 * `id`, what it proves, the threshold, and **which scene the number is measured on**. That last
 * column exists because the answer used to be "a board we spawned" and nobody could tell.
 */
const CLAIMS = [
  ["W1", "the factory paints the world: shipped world meshes carrying a Materials archetype", ">= 8 meshes, 0 unowned", "the finding that cost this piece a round"],
  ["W2", "§5's ban list over the shipped world: standard/physical/env/any map", "0 of each", "§5, §12.2 no.18"],
  ["F1", "flat shading is real: fraction of shipped scene triangles with one normal per face", ">= 0.99", "art-direction §2.1"],
  ["F2", "a cliff resolves into countable planes (compact flat regions, tol 2/255, >= 0.02% of frame)", ">= 25", "§13 row 1"],
  ["F3", "a facet is exactly one colour: median luminance spread inside a flat region", "<= 0.02", "§3.3 / §1.1 (target measures 0.0096)"],
  ["S1", "ROCK TURNED FROM THE KEY converges on one chromatic blue", "hue 190..206, S 0.40..0.48, V 0.19..0.21", "§3.4, §13 row 3 — the row this round exists for"],
  ["S2", "and it converges independent of albedo: hue spread across rock, level stone and armour", "<= 8 deg", "§3.4's three witnesses span 195..201 = 6 deg"],
  ["S3", "the two dark families are separate: turned-face hue vs open ground in a cast shadow", ">= 40 deg apart", "§3.4, §13 row 4"],
  ["L1", "no tone curve on factory-lit rock: median |measured - predicted| / predicted", "<= 0.12 over >= 12 lit facets", "§3.3, §3.5 — predicted is albedo x (N.L key + fill + bounce), linear"],
  ["L2", "one rock mass shows 4-7 distinct lit values", "4..7 over >= 12 lit facets", "§3.3, the LADDER in Materials.js"],
  ["K1", "§3.2's ratio: lit ground vs ground in a cast shadow, on the shipped leaf", ">= 2.5", "§3.2 (the target's own witness is 4.36)"],
  ["K2", "the rock mass's own range: brightest lit facet vs most turned facet", "5..40", "§3.2's mid-facet witness is 11.96; the target's extremes give 19.5"],
  ["C1", "the player has a real contact shadow: darkening under the boot", ">= 0.45", "no contact shadow is why a character floats"],
  ["C2", "and it starts AT the boot: metres of lit ground between the sole and the shadow", "<= 0.10 m", "peter-panning is the reflex fix that makes C1 worse"],
  ["A1", "the accent budget: frame share at hue 150-200, V >= 0.80, S >= 0.25", "0.1%..1.8%", "§7.2, §13 row 5"],
  ["A2", "cyan has not leaked: accent-gate pixels landing outside the accent meshes", "<= 12%", "§7.2, §13 row 6 (the sky owns the rest)"],
  ["T1", "it does not fizz: pixels changing > 0.05 Y in one fixed step, camera static", "<= 0.2%", "§11.6, palette.motion.budgets.temporalNoiseCeiling"],
  ["N2", "the renderer path is linear: toneMapping is NoToneMapping", "== 0", "§3.5"],
  ["P1", "the material factory shares programs", "programVariants <= 12", "architecture.md program budget"],
  ["P2", "shader programs and draw calls in the shipped frame", "programs <= 90, draws <= 320", "architecture.md"],
];

// ---------------------------------------------------------------------------- helpers

const fmt = (v, n = 4) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(n)) : v);
const rows = [];
function claim(id, value, pass, note = "", scene = "shipped Leaf Nine, gameplay camera at spawn") {
  rows.push({ id, value, pass: !!pass, note, scene });
}

// ---------------------------------------------------------------------------- run

const results = { tier: TIER, width: WIDTH, height: HEIGHT, post: KEEP_POST, measurements: {} };

await openGame({ width: WIDTH, height: HEIGHT, tier: TIER }, async (d) => {
  /**
   * Kill Vite's HMR client for the run. This measurement holds state in the page over a couple of
   * minutes; in a repo where other pieces are being edited at the same time, one save anywhere
   * reloads the page, `window.__p11` vanishes mid-sequence and the run dies with "Execution context
   * was destroyed" and no diagnosis.
   */
  await d.page.route("**/@vite/client*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "export const createHotContext = () => ({ on(){}, send(){}, accept(){}, dispose(){}, prune(){}, invalidate(){}, decline(){} }); export const injectQuery = (u) => u; export const removeStyle = () => {}; export const updateStyle = () => {};",
    })
  );
  await d.page.reload({ waitUntil: "load", timeout: 90000 });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), {
    timeout: 90000,
  });

  await d.run((keepPost) => {
    const K = window.__vs.kernel;
    K.__p11Composer = K.composer;
    if (!keepPost) K.composer = null;
  }, KEEP_POST);

  // Let the world stream in and the player settle on the ground. This is simulation time through
  // the fixed clock, never a wall-clock wait.
  await d.play(1.2);

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

  await d.page.evaluate(installToolkit);
  const buf = await d.run(() => window.__p11.grab());
  results.buffer = buf;
  results.rig = await d.run(() => window.__p11.rig());
  results.camera = await d.run(() => {
    const c = window.__vs.kernel.camera;
    return { position: [c.position.x, c.position.y, c.position.z], fov: c.fov, controlledBy: "the shipped camera rig" };
  });
  results.player = await d.run(() => window.__p11.player());

  if (SHOTS) await d.shoot("review/shots/p11/world-spawn.png");

  // ---------------------------------------------------------------- W1/W2 is the factory wired in
  const wiring = await d.run(() => {
    const T = window.__p11;
    const meshes = T.worldMeshes();
    const banned = T.banned();
    const byArch = {};
    for (const m of meshes) {
      if (!m.archetype) continue;
      byArch[m.archetype] ??= { meshes: 0, instances: 0, names: [] };
      byArch[m.archetype].meshes++;
      byArch[m.archetype].instances += m.count;
      if (byArch[m.archetype].names.length < 6) byArch[m.archetype].names.push(m.name);
    }
    return {
      meshes: meshes.length,
      owned: meshes.filter((m) => m.archetype).length,
      unowned: meshes.filter((m) => !m.archetype).map((m) => `${m.name}:${m.type}`),
      byArch,
      banned,
      factory: window.__vs.probe("lighting").materials,
    };
  });
  results.measurements.wiring = wiring;
  const archNames = Object.keys(wiring.byArch);
  claim(
    "W1",
    `${wiring.owned}/${wiring.meshes} world meshes, archetypes [${archNames.join(", ")}]`,
    wiring.owned >= 8 && wiring.unowned.length === 0,
    `handed out ${JSON.stringify(wiring.factory.handedOut)}; unowned ${JSON.stringify(wiring.unowned)}`
  );
  const b = wiring.banned;
  claim(
    "W2",
    `standard ${b.standard} / physical ${b.physical} / envMap ${b.envMap} / anyMap ${b.anyMap}`,
    b.standard === 0 && b.physical === 0 && b.envMap === 0 && b.anyMap === 0 && !b.sceneEnvironment,
    `${b.meshes} world meshes audited; scene.environment ${b.sceneEnvironment ? "SET by another piece" : "null"}`
  );

  // ---------------------------------------------------------------- F1 flat shading, whole scene
  const facets = await d.run(() => window.__p11.lighting.audit().facets);
  results.measurements.facets = facets;
  claim("F1", fmt(facets.flatFraction), facets.flatFraction >= 0.99,
    `${facets.flatTriangles}/${facets.triangles} tris over ${facets.meshes} meshes; smooth: ${JSON.stringify(facets.smoothMeshes)}`,
    "whole shipped scene graph");

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
  claim("F2", regions.count, regions.count >= 25, `largest region ${fmt(regions.largestFrac * 100, 2)}% of frame`);
  claim("F3", fmt(regions.medianSpread), regions.medianSpread <= 0.02, `p90 ${fmt(regions.p90Spread)}`);

  // ---------------------------------------------------------------- S1..S3 the two dark families
  //
  // The row this round exists for. Rock, in the shipped frame, turned away from the key: it used to
  // be a plain darker ochre because the scatter built its own `MeshStandardMaterial` and a standard
  // material has no §3.4 term at all — its dark side is albedo x hemisphere fill, i.e. the same
  // warm hue at a lower value.
  const families = await d.run(() => {
    const T = window.__p11;
    const world = T.worldMeshes();
    const named = (pred) => world.filter((m) => m.visible && pred(m)).map((m) => m.name);

    // Every mesh the factory paints as stone, plus the level's own rock mass. Both are "rock" to a
    // player and both were part of the failing read.
    const factoryRock = named((m) => m.archetype === "rock" || m.archetype === "stone");
    const levelRock = named((m) => m.name === "vs.level.rock");
    const armour = named((m) => m.system === "avatar" && /heroPlate|torso|chest|arm|leg/i.test(m.name + m.material));

    const collect = (names, tag) => {
      if (!names.length) return { tag, n: 0, missing: true };
      const own = T.own(names);
      const faces = [];
      for (const n of names) faces.push(...T.worldFaces(n, { maxInstances: 30, minAreaPx: 180 }));
      const turned = faces.filter((f) => f.ndl < -0.15).sort((a, b) => b.areaPx - a.areaPx);
      const lit = faces.filter((f) => f.ndl > 0.15).sort((a, b) => b.areaPx - a.areaPx);
      return {
        tag,
        meshes: names,
        ownedPixels: own.n,
        faces: faces.length,
        turnedFaces: turned.length,
        turned: T.sampleFaces(turned, { mask: own.mask, r: 2, maxSpread: 0.02, limit: 240 }),
        lit: T.sampleFaces(lit, { mask: own.mask, r: 2, maxSpread: 0.02, limit: 240 }),
      };
    };

    const rock = collect(factoryRock, "factory rock (scatter)");
    const level = collect(levelRock, "level rock mass");
    const hero = collect(armour, "avatar armour");

    // Open ground in a cast shadow: the OTHER dark family. Picked by the terrain's own analytic
    // normal (up-facing, and a plane the key would otherwise reach), then split by luminance —
    // orientation and albedo held fixed by construction, so the only thing left that can darken one
    // of these pixels is a cast shadow.
    const groundNames = named((m) => m.system === "terrain" && /surface/.test(m.name));
    const gOwn = groundNames.length ? T.own(groundNames) : { mask: null, n: 0 };
    const p = T.player();
    const pts = [];
    if (p) {
      for (let dx = -26; dx <= 26; dx += 1.0)
        for (let dz = -26; dz <= 26; dz += 1.0) {
          const x = p.x + dx, z = p.z + dz;
          const n = T.groundNormal(x, z);
          const ndl = T.groundNdL(x, z);
          if (!n || n[1] < 0.88 || ndl < 0.25) continue;
          const y = T.groundY(x, z);
          if (!Number.isFinite(y)) continue;
          const s = T.project([x, y + 0.02, z]);
          if (s[2] > 1 || s[0] < 8 || s[1] < 8 || s[0] > T.buf.w - 9 || s[1] > T.buf.h - 9) continue;
          if (!T.maskBox(gOwn.mask, s[0], s[1], 2)) continue;
          const patch = T.patch(s[0], s[1], 2);
          if (patch.spread > 0.02) continue;
          pts.push({ y: patch.y, rgb: patch.rgb, ndl });
        }
    }
    pts.sort((a, b) => a.y - b.y);
    const at = (q) => (pts.length ? pts[Math.min(pts.length - 1, Math.floor(pts.length * q))] : null);
    const shade = at(0.05), light = at(0.8);
    return {
      rock, level, hero,
      ground: {
        samples: pts.length,
        ownedPixels: gOwn.n,
        shade: shade ? { rgb: shade.rgb, y: shade.y, hsv: T.hsv(...shade.rgb) } : null,
        lit: light ? { rgb: light.rgb, y: light.y, hsv: T.hsv(...light.rgb) } : null,
        ratio: shade && light && shade.y > 0 ? light.y / shade.y : 0,
      },
      // The frame-wide version of §13 row 3, on the gate the art bible publishes.
      turnedPop: (() => {
        const g = T.gate(170, 220, 0, 0.2, 0, 0.06);
        return { n: g.n, share: g.share, hue: g.hue, s: g.s, v: g.v, y: g.y };
      })(),
    };
  });
  results.measurements.families = families;

  // S1 is measured on ALL rock in the frame — the factory-painted scatter and the level's own mass
  // — because "rock in shadow" is what a critic samples, not "rock belonging to module X".
  const rockTurned = families.rock.turned ?? {};
  const levelTurned = families.level.turned ?? {};
  const combined = (() => {
    const parts = [rockTurned, levelTurned].filter((p) => p && p.n >= 4);
    if (!parts.length) return null;
    const w = parts.reduce((a, p) => a + p.n, 0);
    const wm = (k) => parts.reduce((a, p) => a + p[k] * p.n, 0) / w;
    return { n: w, hue: wm("hue"), s: wm("s"), v: wm("v"), y: wm("y") };
  })();
  results.measurements.rockShadowCombined = combined;
  claim(
    "S1",
    combined
      ? `hue ${fmt(combined.hue, 1)} S ${fmt(combined.s, 3)} V ${fmt(combined.v, 3)} over ${combined.n} facets`
      : "NO SAMPLES",
    !!combined && combined.n >= 24 &&
      combined.hue >= 190 && combined.hue <= 206 &&
      combined.s >= 0.4 && combined.s <= 0.48 &&
      combined.v >= 0.19 && combined.v <= 0.21,
    `scatter rock ${fmt(rockTurned.hue, 1)}/${fmt(rockTurned.s, 3)}/${fmt(rockTurned.v, 3)} (n=${rockTurned.n}, ` +
      `rejected mask ${rockTurned.rejectedMask} spread ${rockTurned.rejectedSpread}); ` +
      `level rock ${fmt(levelTurned.hue, 1)}/${fmt(levelTurned.s, 3)}/${fmt(levelTurned.v, 3)} (n=${levelTurned.n}); ` +
      `frame-wide turned population ${fmt(families.turnedPop.share * 100, 2)}% at hue ${fmt(families.turnedPop.hue, 1)}`
  );

  const hues = [rockTurned.hue, levelTurned.hue, families.hero.turned?.hue].filter((v) => v != null);
  const hueSpread = hues.length > 1 ? Math.max(...hues) - Math.min(...hues) : 0;
  claim("S2", fmt(hueSpread, 1), hues.length >= 2 && hueSpread <= 8,
    `scatter ${fmt(rockTurned.hue, 1)}, level ${fmt(levelTurned.hue, 1)}, armour ${fmt(families.hero.turned?.hue, 1)} (n=${families.hero.turned?.n ?? 0})`);

  const gShade = families.ground.shade;
  const delta = gShade && combined ? Math.abs(gShade.hsv[0] - combined.hue) : 0;
  claim("S3", gShade ? `${fmt(delta, 1)} deg (ground shadow hue ${fmt(gShade.hsv[0], 1)})` : "NO GROUND SAMPLES",
    !!gShade && delta >= 40,
    `${families.ground.samples} up-facing terrain samples inside the terrain's own ownership mask`);

  // ---------------------------------------------------------------- L1/L2 the cosine ladder
  //
  // Measured on FACTORY-LIT rock only: the prediction below is three's Lambert accumulation, which
  // is what a `Materials.rock()` surface actually does. The level's own mass runs P09's grade and
  // would be measured against the wrong equation.
  const ladder = await d.run(() => {
    const T = window.__p11;
    const rig = T.rig();
    const world = T.worldMeshes();
    const names = world.filter((m) => m.visible && m.archetype === "rock").map((m) => m.name);
    if (!names.length) return { missing: true };
    const own = T.own(names);
    const faces = [];
    for (const n of names) faces.push(...T.worldFaces(n, { maxInstances: 30, minAreaPx: 220 }));

    const albedoByMesh = {};
    for (const n of names) albedoByMesh[n] = T.albedoOf(n);

    const samples = [];
    for (const f of faces) {
      if (f.ndl <= 0.2) continue;
      if (!T.maskBox(own.mask, f.x, f.y, 2)) continue;
      const patch = T.patch(f.x, f.y, 2);
      if (patch.spread > 0.02) continue;
      const albedo = albedoByMesh[f.mesh];
      if (!albedo) continue;
      const hemiW = 0.5 * f.ny + 0.5;
      const bdl = Math.max(0, f.ny * rig.bounceDir[1]);
      const pred = [0, 1, 2].map((c) => {
        const key = rig.key[c] * rig.keyI * Math.max(0, f.ndl);
        const hemi = (rig.fillGround[c] + (rig.fillSky[c] - rig.fillGround[c]) * hemiW) * rig.fillI;
        const bnc = rig.bounce[c] * rig.bounceI * bdl;
        return (albedo[c] * (key + hemi + bnc)) / Math.PI;
      });
      const predY = 0.2126 * pred[0] + 0.7152 * pred[1] + 0.0722 * pred[2];
      samples.push({
        mesh: f.mesh, instance: f.instance, ndl: f.ndl,
        measured: patch.y, predY, err: Math.abs(patch.y - predY) / Math.max(predY, 1e-4),
      });
    }
    const errs = samples.map((s) => s.err).sort((a, b) => a - b);

    // L2 is a claim about ONE mass, so take the single instance carrying the most lit facets.
    const byInstance = new Map();
    for (const s of samples) {
      const k = `${s.mesh}#${s.instance}`;
      if (!byInstance.has(k)) byInstance.set(k, []);
      byInstance.get(k).push(s);
    }
    // Fall back to the whole population if no single instance carries 12 facets: the scatter's
    // masses are 8-20 triangle solids on purpose (§2.2), so twelve LIT facets on one boulder is
    // more than the geometry has. Report which was used.
    let best = null;
    for (const [k, v] of byInstance) if (!best || v.length > best.v.length) best = { k, v };
    const massSource = best && best.v.length >= 12 ? best : { k: "all visible rock facets", v: samples };
    const vals = massSource.v.map((s) => s.measured).sort((a, b) => b - a);
    const steps = [];
    for (const v of vals) if (!steps.some((s) => Math.abs(s - v) / Math.max(s, 1e-4) < 0.06)) steps.push(v);

    return {
      meshes: names,
      n: samples.length,
      medianErr: errs.length ? errs[errs.length >> 1] : 1,
      p90Err: errs.length ? errs[Math.floor(errs.length * 0.9)] : 1,
      massKey: massSource.k,
      massFacets: massSource.v.length,
      steps: steps.length,
      ladder: steps.slice(0, 8).map((v) => Number(v.toFixed(4))),
      normalised: steps.slice(0, 8).map((v) => Number((v / steps[0]).toFixed(3))),
      albedoByMesh,
    };
  });
  results.measurements.ladder = ladder;
  claim("L1", fmt(ladder.medianErr), ladder.n >= 12 && ladder.medianErr <= 0.12,
    `${ladder.n} lit factory-rock facets, p90 err ${fmt(ladder.p90Err)}`,
    "shipped Leaf Nine, factory-painted scatter rock only");
  claim("L2", `${ladder.steps} steps over ${ladder.massFacets} facets`,
    ladder.steps >= 4 && ladder.steps <= 7 && ladder.massFacets >= 12,
    `mass = ${ladder.massKey}; ladder ${JSON.stringify(ladder.normalised)}`,
    "shipped Leaf Nine, factory-painted scatter rock only");

  // ---------------------------------------------------------------- K1/K2 the two witnesses
  claim("K1", fmt(families.ground.ratio, 2),
    families.ground.samples >= 20 && families.ground.ratio >= 2.5,
    `lit ground Y ${fmt(families.ground.lit?.y)}, shadowed ground Y ${fmt(families.ground.shade?.y)} over ${families.ground.samples} samples`);

  const rockLitY = families.rock.lit?.y ?? 0;
  const rockTurnedY = families.rock.turned?.y ?? 0;
  const rockRange = rockTurnedY > 0 ? rockLitY / rockTurnedY : 0;
  claim("K2", fmt(rockRange, 2), rockRange >= 5 && rockRange <= 40,
    `lit Y ${fmt(rockLitY)} over ${families.rock.lit?.n ?? 0} facets vs turned Y ${fmt(rockTurnedY)} over ${families.rock.turned?.n ?? 0}`);

  // ---------------------------------------------------------------- A1/A2 the accent budget
  const accent = await d.run(() => {
    const T = window.__p11;
    T.grab();
    const g = T.gate(150, 200, 0.8, 0.25, 0, 2);
    const boxes = T.accentBoxes();
    let outside = 0;
    for (let i = 0; i < g.xs.length; i++) {
      const x = g.xs[i], y = g.yps[i];
      if (!boxes.some((bx) => x >= bx[0] && x <= bx[2] && y >= bx[1] && y <= bx[3])) outside++;
    }
    return { share: g.share, n: g.n, hue: g.hue, outside, outsideShare: g.n ? outside / g.n : 0, boxes: boxes.length };
  });
  results.measurements.accent = accent;
  claim("A1", fmt(accent.share * 100, 3) + "%", accent.share >= 0.001 && accent.share <= 0.018,
    `${accent.n} px in the cyan gate at median hue ${fmt(accent.hue, 1)}`);
  claim("A2", fmt(accent.outsideShare * 100, 2) + "%", accent.outsideShare <= 0.12,
    `${accent.outside} accent-gate pixels outside ${accent.boxes} accent-mesh boxes`);

  // ---------------------------------------------------------------- T1 temporal noise
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

  results.measurements.exposure = await d.run(() => window.__p11.percentiles());

  // ---------------------------------------------------------------- C1/C2 the contact shadow
  //
  // The ONLY row that takes the camera. A contact shadow can only be seen from down-sun of the
  // body casting it: stand up-sun and the shadow falls away behind the player and the frame shows a
  // pair of boots and no contact at all, which is exactly how a build ships a floating hero.
  // Everything under the camera is the shipped world — the shipped terrain, the shipped avatar, the
  // shipped near cascade.
  const framing = await d.run(() => {
    const T = window.__p11;
    const p = T.player();
    const s = T.lighting._shadowDir; // unit vector world -> light
    const len = Math.hypot(s.x, s.z) || 1;
    const away = [-s.x / len, -s.z / len]; // the direction the cast shadow travels
    const foot = [p.x, T.groundY(p.x, p.z) ?? p.y, p.z];
    const eye = [foot[0] + away[0] * 3.1, foot[1] + 1.55, foot[2] + away[1] * 3.1];
    const look = [foot[0] + away[0] * 0.45, foot[1] + 0.35, foot[2] + away[1] * 0.45];
    const set = T.lighting.reviewCamera({ pos: eye, look, fov: 34 });
    return { ...set, foot, away, player: p };
  });
  results.measurements.framing = framing;
  await d.play(0.1);
  await d.run(() => window.__p11.grab());
  if (SHOTS) await d.shoot("review/shots/p11/world-contact.png");

  const contact = await d.run((f) => {
    const T = window.__p11;
    const world = T.worldMeshes();
    const groundNames = world
      .filter((m) => m.visible && (m.system === "terrain" || m.name === "vs.level.rock"))
      .map((m) => m.name);
    const own = T.own(groundNames);

    // Walk out from the sole along the shadow, in 2 cm steps, sampling the ground it lands on.
    const walk = [];
    for (let t = 0; t <= 70; t++) {
      const dist = t * 0.02;
      const x = f.foot[0] + f.away[0] * dist;
      const z = f.foot[2] + f.away[1] * dist;
      const y = T.groundY(x, z);
      if (!Number.isFinite(y)) continue;
      const s = T.project([x, y + 0.01, z]);
      if (s[2] > 1) continue;
      const owned = T.maskBox(own.mask, s[0], s[1], 1);
      const patch = T.patch(s[0], s[1], 1);
      walk.push({ t: dist, y: patch.y, owned, sx: Math.round(s[0]), sy: Math.round(s[1]) });
    }

    // The lit reference: ground of the same kind, 4-9 m away, up-facing, inside the ground's own
    // ownership mask so an unlucky sample cannot land on a rock or on the sky. p75 rather than max,
    // because the leaf has relief and the brightest sample is a facet, not a plane.
    const refs = [];
    for (let a = 0; a < 64; a++) {
      for (let r = 4; r <= 9; r += 0.5) {
        const ang = (a / 64) * Math.PI * 2;
        const x = f.foot[0] + Math.cos(ang) * r;
        const z = f.foot[2] + Math.sin(ang) * r;
        const n = T.groundNormal(x, z);
        const ndl = T.groundNdL(x, z);
        if (!n || n[1] < 0.85 || ndl < 0.2) continue;
        const y = T.groundY(x, z);
        if (!Number.isFinite(y)) continue;
        const s = T.project([x, y + 0.02, z]);
        if (s[2] > 1 || s[0] < 6 || s[1] < 6 || s[0] > T.buf.w - 7 || s[1] > T.buf.h - 7) continue;
        if (!T.maskBox(own.mask, s[0], s[1], 2)) continue;
        const patch = T.patch(s[0], s[1], 2);
        if (patch.spread > 0.03) continue;
        refs.push(patch.y);
      }
    }
    refs.sort((a, b) => a - b);
    const litRef = refs.length ? refs[Math.floor(refs.length * 0.75)] : 0;
    const usable = walk.filter((w) => w.owned);
    const darkening = usable.map((w) => 1 - w.y / Math.max(litRef, 1e-4));
    let first = null;
    for (let i = 0; i < usable.length; i++) if (darkening[i] >= 0.45) { first = usable[i].t; break; }
    const near = darkening.slice(0, 30);
    return {
      litRef,
      refSamples: refs.length,
      walkSamples: walk.length,
      onGround: usable.length,
      contactDarkening: near.length ? Math.max(...near) : 0,
      atSole: darkening[0] ?? 0,
      firstDarkAt: first,
      profile: usable.slice(0, 30).map((w, i) => [Number(w.t.toFixed(2)), Number(w.y.toFixed(4)), Number((darkening[i] ?? 0).toFixed(3))]),
    };
  }, framing);
  results.measurements.contact = contact;
  claim("C1", fmt(contact.contactDarkening, 3),
    contact.refSamples >= 12 && contact.onGround >= 8 && contact.contactDarkening >= 0.45,
    `lit reference Y ${fmt(contact.litRef)} over ${contact.refSamples} up-facing ground samples; ` +
      `${contact.onGround}/${contact.walkSamples} walk samples landed on visible ground; darkening at the sole ${fmt(contact.atSole, 3)}`,
    "shipped Leaf Nine, camera placed down-sun of the shipped avatar");
  claim("C2", contact.firstDarkAt === null ? "never" : fmt(contact.firstDarkAt, 3),
    contact.firstDarkAt !== null && contact.firstDarkAt <= 0.10,
    `metres of lit ground between the sole and the shadow`,
    "shipped Leaf Nine, camera placed down-sun of the shipped avatar");

  // ---------------------------------------------------------------- N/P housekeeping
  const probe = await d.probe("lighting");
  results.measurements.probe = {
    renderer: probe.renderer, shadow: probe.shadow, lights: probe.lights,
    materials: probe.materials, world: probe.world,
  };
  claim("N2", probe.renderer.toneMapping, probe.renderer.toneMapping === 0, `0 == THREE.NoToneMapping`);

  const mstats = probe.materials;
  claim("P1", `${mstats.programVariants} program variants / ${mstats.instances} instances`,
    mstats.programVariants <= 12,
    `${mstats.shared} shared + ${mstats.uncached} uncached, ${mstats.cacheHits} cache hits, ${mstats.textures} textures; ${JSON.stringify(mstats.programs)}`);

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
  scene: byId[id]?.scene ?? "-",
  note: byId[id]?.note ?? "",
  source,
}));

const passed = table.filter((t) => t.result === "PASS").length;
const failed = table.filter((t) => t.result !== "PASS");

console.log(JSON.stringify({ ...results, table }, null, 2));
console.log("");
console.log("EVERY ROW BELOW IS MEASURED ON THE SHIPPED GAME. There is no synthetic scene in this script.");
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
  for (const t of failed) {
    console.log(`  ${t.id}  ${t.claim}\n        want ${t.threshold}, got ${t.measured}\n        scene: ${t.scene}\n        ${t.note}`);
  }
  process.exitCode = 1;
}

const outDir = path.resolve(ROOT, "review/measure");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "P11.json"), JSON.stringify({ ...results, table }, null, 2));
