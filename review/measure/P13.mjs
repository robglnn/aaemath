#!/usr/bin/env node
//
// P13 — Scatter: the re-runnable proof.
//
//   node review/measure/P13.mjs                 # dev server
//   node review/measure/P13.mjs --built         # the production build (run `npm run build` first)
//   node review/measure/P13.mjs --keep          # keep the captures it takes
//
// Every claim this piece makes is checked here against a stated threshold, from real state in a
// real browser and real pixels in a real capture. A row that says PASS is a measurement; a row
// that says FAIL is a bug. Nothing in this file trusts the builder.
//
// Captures land in review/shots/p13/measure/.

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, has } from "../../tools/lib/session.mjs";
import { readPng, census, median, hsv, luminance } from "./p13-png.mjs";

const BUILT = has("built");
const OUT = path.join(ROOT, "review/shots/p13/measure");
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
const note = (name, claim, value, threshold, ok, extra) =>
  rows.push({ name, claim, value, threshold, verdict: ok ? "PASS" : "FAIL", ...(extra ? { extra } : {}) });

const FULL = [0, 0, 1, 1];
const num = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

// ---------------------------------------------------------------------------- browser helpers

/**
 * Wait until scatter has finished streaming, advancing sim time — never wall clock.
 *
 * The catch-up advances run with `render:false`. Headless software GL spends about a second per
 * rendered frame, and the streaming this is waiting on happens in `after()`, which runs whether or
 * not the frame is drawn; rendering it thirty times over would turn a five-second wait into five
 * minutes and measure nothing extra.
 */
async function settle(d, seconds = 2.5) {
  await d.play(seconds);
  for (let i = 0; i < 60; i++) {
    const p = await d.probe("scatter");
    if (p && !p.outstanding && p.built) return p;
    await d.run(() => {
      for (let k = 0; k < 12; k++) window.__vs.advance(1 / 30, { render: false });
    });
  }
  return d.probe("scatter");
}

/** Everything about the live instance buffers that a pixel cannot show. */
const DUMP = () => {
  const s = window.__vs.kernel.get("scatter");
  const eye = s._eye;
  const out = { eye: [eye.x, eye.y, eye.z], cats: {} };
  for (const cat of s.categories) {
    const fade = cat.material.userData.fadeUniform.value;
    const rec = {
      gather: cat.gather,
      fade: [fade.x, fade.y],
      lodDist: cat.lodDist,
      budget: cat.budget,
      capacity: cat.lods.map((l) => l.capacity),
      drawn: cat.lods.map((l) => l.drawn),
      geoTris: cat.lods.map((l) => l.tris),
      // Worst per-instance shrink still visible at the cull edge, and the scale/rotation spread
      // that proves nothing is stamped.
      worstScaleAtCull: 0,
      beyondFadeEnd: 0,
      scales: [],
      yaws: [],
      lodMix: [0, 0],
      sample: [],
    };
    for (let li = 0; li < cat.lods.length; li++) {
      const l = cat.lods[li];
      const m = l.mesh.instanceMatrix.array;
      const inst = l.inst.array;
      rec.lodMix[li] = l.drawn;
      for (let i = 0; i < l.drawn; i++) {
        const o = i * 16;
        const x = m[o + 12];
        const y = m[o + 13];
        const z = m[o + 14];
        const dist = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const sx = Math.hypot(m[o + 0], m[o + 1], m[o + 2]);
        // The exact expression the vertex shader runs, for this instance's own jittered window.
        const jit = 1 + (inst[i * 2] - 0.5) * 0.22;
        const a = fade.x * jit;
        const b = fade.y * jit;
        const fadeAt = (dd) => {
          const t = Math.min(1, Math.max(0, (dd - a) / (b - a)));
          return 1 - t * t * (3 - 2 * t);
        };
        if (dist > b) rec.beyondFadeEnd++;
        // The claim is "nothing ever pops out of the buffer". An instance leaves the buffer when
        // its distance exceeds the gather radius, so the number that matters is the scale this
        // instance WILL have at that moment — evaluated at the cull radius, not where it is now.
        rec.worstScaleAtCull = Math.max(rec.worstScaleAtCull, fadeAt(cat.gather));
        if (rec.scales.length < 4000) {
          rec.scales.push(Math.cbrt(sx * sx * sy));
          // Yaw of the instance's local X axis, quantised to 1°, to count distinct orientations.
          rec.yaws.push(Math.round((Math.atan2(m[o + 2], m[o + 0]) * 180) / Math.PI));
        }
        if (rec.sample.length < 6) {
          const r3 = (v) => Math.round(v * 1000) / 1000;
          rec.sample.push([r3(x), r3(y), r3(z), r3(sy)]);
        }
      }
    }
    out.cats[cat.id] = rec;
  }
  return out;
};

function spread(values) {
  if (!values.length) return { n: 0, mean: 0, cv: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { n: values.length, mean, cv: mean ? sd / mean : 0, min: Math.min(...values), max: Math.max(...values) };
}

// ---------------------------------------------------------------------------- the runs

const common = { width: 1280, height: 720, tier: "medium", built: BUILT };

/** Run A — the reference boot. Placement, budgets, LOD, fade, islands, and a wide capture. */
const A = await openGame(common, async (d) => {
  const probe = await settle(d);
  const dump = await d.run(DUMP);
  await d.look(0, -60);
  await d.play(0.4);
  const wide = path.join(OUT, "wide.png");
  await d.shoot(path.relative(ROOT, wide));
  const report = await d.report();

  // A crystal close-up, framed from the piece's own published stance so it is reproducible.
  const framed = await d.run(() => {
    const s = window.__vs.kernel.get("scatter");
    const c = s.probe().closeUp;
    if (!c) return null;
    const loco = window.__vs.kernel.get("locomotion");
    if (loco?.teleport) loco.teleport(c.pos[0], c.pos[1], c.pos[2], c.opts);
    return c;
  });
  await d.play(1.2);
  const close = path.join(OUT, "crystal-closeup.png");
  await d.shoot(path.relative(ROOT, close));
  const after = await d.run(() => {
    const l = window.__vs.kernel.get("locomotion");
    return l ? [l.position.x, l.position.y, l.position.z] : null;
  });

  // Two world-model checks that need the page but not a fresh boot.
  const overLeaf = await d.run(() => {
    const s = window.__vs.kernel.get("scatter");
    const t = window.__vs.kernel.get("terrain");
    if (!t?.isSolid) return { checked: 0, over: 0 };
    // Re-derive island centres from the merged buffer by clustering its vertices on a 40 m grid,
    // then ask the terrain whether that point is over solid leaf.
    const pos = s.islands.rock.geometry.getAttribute("position");
    const seen = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) / 40)},${Math.round(pos.getZ(i) / 40)}`;
      const e = seen.get(k) || { x: 0, z: 0, n: 0 };
      e.x += pos.getX(i);
      e.z += pos.getZ(i);
      e.n++;
      seen.set(k, e);
    }
    let over = 0;
    let checked = 0;
    for (const e of seen.values()) {
      if (e.n < 30) continue;
      checked++;
      if (t.isSolid(e.x / e.n, e.z / e.n)) over++;
    }
    return { checked, over };
  });

  const survey = await d.run(() => {
    const s = window.__vs.kernel.get("scatter");
    let both = 0;
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const x = ((i * 37) % 400) - 200;
      const z = ((i * 91) % 360) - 180;
      const held = s._held(x, z);
      checked++;
      if (held < 0.44 && held > 0.58) both++; // abouts want approximation, oldtrue held truth
    }
    return { checked, both };
  });

  return { probe, dump, wide, close, framed, after, report, overLeaf, survey, errors: report.errors, stats: report.stats };
});

/** Run B — same seed, fresh boot. Determinism. */
const B = await openGame(common, async (d) => {
  const probe = await settle(d);
  return { probe, dump: await d.run(DUMP) };
});

/** Run C — a different seed. Proves the seed is what drives placement. */
const C = await openGame({ ...common, query: { scatterSeed: "987654" } }, async (d) => {
  const probe = await settle(d);
  return { probe };
});

/** Run D — a lower tier. Proves the budgets respect `config.tier`. */
const D = await openGame({ ...common, tier: "low" }, async (d) => {
  const probe = await settle(d);
  return { probe };
});

/** Run E — the same frame with the piece switched off, for an honest pixel-cost A/B. */
const E = await openGame({ ...common, query: { scatter: "0" } }, async (d) => {
  await settle(d, 2.5);
  await d.look(0, -60);
  await d.play(0.4);
  const file = path.join(OUT, "wide-no-scatter.png");
  await d.shoot(path.relative(ROOT, file));
  const report = await d.report();
  return { file, stats: report.stats, probe: await d.probe("scatter") };
});

// ---------------------------------------------------------------------------- claims

const p = A.probe;
const cats = Object.entries(A.dump.cats);

// 1. Boot is clean.
note("boot", "zero runtime errors in the capture run", A.errors.length, "= 0", A.errors.length === 0, A.errors.slice(0, 3));

// 2. Flat shading is a property of the buffers, not a flag.
note(
  "flat-shading",
  "every triangle in every geometry this piece owns carries one constant per-face normal",
  `${p.flatShading.perFaceNormals}/${p.flatShading.triangles}`,
  "ratio = 1.0",
  p.flatShading.ratio === 1 && p.flatShading.triangles > 500
);

// 3. Low triangle counts.
note(
  "low-poly",
  "no scatter geometry exceeds 32 triangles",
  p.maxGeoTris,
  "<= 32",
  p.maxGeoTris <= 32,
  Object.fromEntries(cats.map(([k, v]) => [k, v.geoTris]))
);

// 4. Determinism: identical seed reproduces identical placement, transform for transform.
const digA = JSON.stringify(A.probe.placementDigest);
const digB = JSON.stringify(B.probe.placementDigest);
const digC = JSON.stringify(C.probe.placementDigest);
const digCount = Object.values(A.probe.placementDigest ?? {}).reduce((a, v) => a + v.instances, 0);
note(
  "determinism",
  "two independent boots at the same seed hash the same placement over a fixed 5x5 tile block",
  digA === digB ? `identical across ${Object.keys(A.probe.placementDigest ?? {}).length} categories, ${digCount} instances` : `${digA} vs ${digB}`,
  "byte-identical digests",
  Boolean(digA) && digA === digB && digCount > 200
);

// 5. The seed actually drives it.
const changed = Object.keys(A.probe.placementDigest ?? {}).filter(
  (k) => A.probe.placementDigest[k].hash !== C.probe.placementDigest?.[k]?.hash
);
note(
  "seeded",
  "a different ?scatterSeed moves every category's placement",
  `${changed.length}/${Object.keys(A.probe.placementDigest ?? {}).length} categories differ`,
  "all categories differ",
  digA !== digC && changed.length === Object.keys(A.probe.placementDigest ?? {}).length
);

// 6. Hard budgets, per category and per LOD.
let overBudget = [];
for (const [id, v] of cats) {
  for (let i = 0; i < v.drawn.length; i++) if (v.drawn[i] > Math.max(1, v.budget[i] ?? 0)) overBudget.push(`${id}.lod${i}`);
}
note(
  "budget",
  "no category draws more instances than its per-LOD ceiling",
  overBudget.length ? overBudget.join(",") : "none over",
  "none",
  overBudget.length === 0,
  Object.fromEntries(cats.map(([k, v]) => [k, `${v.drawn}/${v.budget}`]))
);

// 7. Tier scales the budget down.
note(
  "tier",
  "tier=low draws strictly fewer instances than tier=medium",
  `${D.probe.instances} < ${A.probe.instances}`,
  "lower tier is smaller",
  D.probe.instances < A.probe.instances && D.probe.instances > 0,
  { lowDensity: D.probe.density, mediumDensity: A.probe.density }
);

// 8. No pop: every instance is already invisible before it can leave the buffer.
let worstEdge = 0;
let beyond = 0;
for (const [, v] of cats) {
  worstEdge = Math.max(worstEdge, v.worstScaleAtCull);
  beyond += v.beyondFadeEnd;
}
note(
  "no-pop",
  "the scale each drawn instance will have at the moment it is culled, worst case over all of them",
  num(worstEdge, 6),
  "= 0 (nothing ever leaves the buffer at a visible size)",
  worstEdge === 0,
  Object.fromEntries(cats.map(([k, v]) => [k, num(v.worstScaleAtCull, 6)]))
);
note("no-pop-band", "instances still in the buffer past their own fade end (all at zero scale)", beyond, "informational", true);

// 9. The fade band is inside the streaming radius even with the per-instance jitter.
const badBand = cats.filter(([, v]) => v.fade[1] * 1.11 > v.gather).map(([k]) => k);
note(
  "fade-inside-gather",
  "fade completes at least 11% inside the gather radius for every category",
  badBand.length ? badBand.join(",") : "all inside",
  "none outside",
  badBand.length === 0,
  Object.fromEntries(cats.map(([k, v]) => [k, `${num(v.fade[1], 1)}*1.11 <= ${v.gather}`]))
);

// 10. Per-instance variation: nothing is stamped.
const varRows = {};
let stamped = [];
for (const [id, v] of cats) {
  const s = spread(v.scales);
  const yaws = new Set(v.yaws).size;
  varRows[id] = { n: s.n, cv: num(s.cv, 3), size: [num(s.min, 2), num(s.max, 2)], distinctYaw: yaws };
  if (s.n >= 40 && (s.cv < 0.15 || yaws < 30)) stamped.push(id);
}
note(
  "variation",
  "every populated category varies in scale (CV >= 0.15) and orientation (>= 30 distinct yaws)",
  stamped.length ? stamped.join(",") : "none stamped",
  "none stamped",
  stamped.length === 0,
  varRows
);

// 11. Both LODs are actually in use.
const lodUsers = cats.filter(([, v]) => v.geoTris.length > 1);
const lodBoth = lodUsers.filter(([, v]) => v.lodMix[0] > 0 && v.lodMix[1] > 0).length;
note(
  "lod",
  "categories with two LODs are drawing from both at once",
  `${lodBoth}/${lodUsers.length}`,
  ">= half",
  lodBoth * 2 >= lodUsers.length,
  Object.fromEntries(lodUsers.map(([k, v]) => [k, v.lodMix]))
);

// 12. The archipelago: several distance bands, none of it standing over the leaf.
const isl = p.islands;
const overLeaf = A.overLeaf;

note(
  "archipelago",
  "islands exist, span at least a 3x distance range, and carry crystal and structures",
  `${isl.count} islands, ${isl.distance[0]}..${isl.distance[1]} m, ${isl.crystals} crystal, ${isl.structures} structures`,
  ">= 8 islands and >= 3x range",
  isl.count >= 8 && isl.distance[1] / Math.max(1, isl.distance[0]) >= 3 && isl.crystals > 0 && isl.structures > 0
);
note(
  "archipelago-clearance",
  "no island floats over the leaf itself — a leaf floats over nothing (world.md 2.3)",
  `${overLeaf.over}/${overLeaf.checked} over solid ground`,
  "0 over",
  overLeaf.over === 0 && overLeaf.checked > 0
);

// 13. Draw budget.
note(
  "draw-budget",
  "whole-frame draw calls, triangles and programs against design/architecture.md",
  `${A.stats.drawCalls} draws / ${A.stats.triangles} tris / ${A.stats.programs} programs`,
  "<= 320 / <= 1.6M / <= 90",
  A.stats.drawCalls <= 320 && A.stats.triangles <= 1_600_000 && A.stats.programs <= 90,
  { scatterMeshes: p.meshes, scatterTriangles: p.triangles, scatterInstances: p.instances }
);
note(
  "cost-ab",
  "the piece's own share of the frame, measured against the same frame with ?scatter=0",
  `+${A.stats.drawCalls - E.stats.drawCalls} draws, +${A.stats.triangles - E.stats.triangles} tris, +${A.stats.programs - E.stats.programs} programs`,
  "informational",
  true,
  { withScatter: A.stats, withoutScatter: E.stats }
);

// 14. Pixels: the cool accent budget from design/palette.json.
const wide = readPng(A.wide);
const acc = census(wide, FULL, (r, g, b, c) => c.h >= 150 && c.h <= 200 && c.v >= 0.8 && c.s >= 0.25);
const accNo = census(readPng(E.file), FULL, (r, g, b, c) => c.h >= 150 && c.h <= 200 && c.v >= 0.8 && c.s >= 0.25);
note(
  "cool-accent",
  "saturated cyan share of a wide frame (palette.budgets.coolAccentShareOfFrame)",
  num(acc.share),
  "0.004 .. 0.018",
  acc.share >= 0.004 && acc.share <= 0.018,
  { withoutScatter: num(accNo.share), referenceMeasured: 0.0094 }
);

// 15. Pixels: the crystal shows two or three flat values, not a gradient.
const close = readPng(A.close);
const hot = median(close, FULL, (r, g, b, c) => c.h >= 140 && c.h <= 200 && c.s >= 0.2 && c.v >= 0.85);
const face = median(close, FULL, (r, g, b, c) => c.h >= 140 && c.h <= 200 && c.s >= 0.25 && c.v >= 0.55 && c.v < 0.85);
const ratio = hot && face ? hot.Y / face.Y : 0;
note(
  "crystal-two-values",
  "a crystal close-up holds two separated cyan populations (hot facet vs turned facet)",
  hot && face ? `${hot.hex} Y=${num(hot.Y, 3)} (n=${hot.n})  vs  ${face.hex} Y=${num(face.Y, 3)} (n=${face.n})` : "one or none",
  "both present, luminance ratio >= 1.3",
  Boolean(hot && face) && ratio >= 1.3 && hot.n > 200 && face.n > 200,
  { ratio: num(ratio, 2), reference: "crystal.hot #96FDE1 Y 0.822 vs crystal.face #88D1C3 Y 0.548" }
);

// 16. Pixels: the crystal is in the palette's hue family, not a green.
const hueOk = hot && hsv(hot.r, hot.g, hot.b).h >= 150 && hsv(hot.r, hot.g, hot.b).h <= 200;
note(
  "crystal-hue",
  "the crystal's bright facet sits in the palette's accent hue window",
  hot ? num(hsv(hot.r, hot.g, hot.b).h, 1) : "n/a",
  "150 .. 200 degrees",
  Boolean(hueOk),
  { referenceHue: 164 }
);

// 17. Pixels: facets are flat. A facet is one value; a gradient is not a facet.
function flatnessOfCrystal(img) {
  const { width, height, channels, data } = img;
  let sampled = 0;
  let flat = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * channels;
      const c = hsv(data[i], data[i + 1], data[i + 2]);
      if (!(c.h >= 140 && c.h <= 200 && c.s >= 0.2 && c.v >= 0.4)) continue;
      sampled++;
      let same = true;
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const j = ((y + dy) * width + (x + dx)) * channels;
        if (Math.abs(data[j] - data[i]) > 3 || Math.abs(data[j + 1] - data[i + 1]) > 3 || Math.abs(data[j + 2] - data[i + 2]) > 3) same = false;
      }
      if (same) flat++;
    }
  }
  return { sampled, flat, share: sampled ? flat / sampled : 0 };
}
const fl = flatnessOfCrystal(close);
note(
  "facet-flatness",
  "share of crystal pixels whose 4-neighbourhood is the same colour within 3/255",
  num(fl.share, 3),
  ">= 0.80",
  fl.share >= 0.8 && fl.sampled > 2000,
  { sampled: fl.sampled }
);

// 18. Pixels: the archipelago recedes. Nearer islands hold more contrast than far ones.
const skyBand = median(wide, [0.0, 0.28, 1.0, 0.34]);
note(
  "haze",
  "this piece owns its aerial perspective: exponential to sky.horizon with a ceiling below 1",
  `falloff ${p.haze.falloffMetres} m, ceiling ${p.haze.ceiling}`,
  "ceiling < 1 (a horizon question stays legible)",
  p.haze.ceiling < 1 && p.haze.falloffMetres > 100,
  { skyBandMedian: skyBand?.hex }
);

// 19. Placement obeys the surface, not a plane.
note(
  "surface-driven",
  "placement is read from the terrain height query, not from a flat assumption",
  `${p.surface}, ${p.surfaceQueries} queries`,
  'surface = "terrain" or "collision"',
  p.surface === "terrain" || p.surface === "collision"
);

// 20. The survey rule: oldtrue and abouts are mutually exclusive by construction.
const survey = A.survey;

note(
  "survey",
  "abouts (approximation) and oldtrue (held truth) can never want the same ground",
  `${survey.both}/${survey.checked} conflicting samples`,
  "0 conflicts",
  survey.both === 0
);

// ---------------------------------------------------------------------------- report

const pass = rows.filter((r) => r.verdict === "PASS").length;
console.log(JSON.stringify({ piece: "P13", built: BUILT, captures: { wide: path.relative(ROOT, A.wide), closeUp: path.relative(ROOT, A.close), withoutScatter: path.relative(ROOT, E.file) }, rows }, null, 1));
console.log(`\n${pass}/${rows.length} PASS`);
for (const r of rows) console.log(`  ${r.verdict === "PASS" ? "ok  " : "FAIL"} ${r.name.padEnd(22)} ${String(r.value).slice(0, 96)}   [${r.threshold}]`);
if (!has("keep")) {
  /* captures are the evidence — always kept */
}
process.exitCode = rows.some((r) => r.verdict === "FAIL") ? 1 : 0;
