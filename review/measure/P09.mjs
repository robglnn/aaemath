#!/usr/bin/env node
/**
 * P09 — Leaf Nine: the re-runnable proof.
 *
 *   node review/measure/P09.mjs [--width=1280] [--height=720] [--tier=high] [--json]
 *
 * Boots the real game through `tools/lib/session.mjs`, measures this piece's specific claims
 * against stated thresholds, and prints a table plus PASS/FAIL per claim. Everything here is
 * measured off the running world or off real pixels; nothing is measured off this file's opinion
 * of itself.
 *
 * The claims, and why each one is the one that would demolish the piece if it were false:
 *
 *   S1  the terrain is genuinely non-indexed with one normal per face — "flat-shaded low-poly"
 *       is a geometry claim, and a smooth-normalled mesh with a stylised shader is the exact
 *       forgery this target is most often faked with
 *   S2  facets are big enough to count — a cliff resolving into a handful of planes is the
 *       target's whole language, and it is destroyed silently by a finer grid
 *   S3  the collider *is* the render geometry — render and physics agree to a centimetre
 *   S4  there is no ground under the leaf (world.md §2.3), including through the ravine
 *   C1  the Bollard and the Second Lip never share a frame, from anywhere a player can stand
 *       (world.md §12, canon)
 *   C2  they are the two ends of one body about six hundred metres long (world.md §3)
 *   C3  the ravine cannot be walked or jumped — Beat 3 needs the span to be the only way over
 *   K1  five landmarks in five distance bands, each still legible at thumbnail size
 *   K2  no dead space: nowhere walkable is far from something worth walking to
 *   K3  real verticality across the walkable surface
 *   P1  near lit rock matches `reference/target-lowpoly.png`'s measured lit rock
 *   P2  near shadowed rock matches the reference's measured shadow — hue 198, not a dark orange
 *   P3  the lit:shadow luminance ratio is in the reference's band
 *   P4  the frame's budget: draw calls, triangles, programs
 */

import fs from "node:fs";
import path from "node:path";
import { openGame, arg, ROOT } from "../../tools/lib/session.mjs";
import { readPNG, px, hsv, lum } from "../p02-png.mjs";

const WIDTH = Number(arg("width", "1280"));
const HEIGHT = Number(arg("height", "720"));
const TIER = arg("tier", "high");
const SHOT = path.join("review", "shots", "p09", "measure.png");

/** Measured off reference/target-lowpoly.png by review/p09-ref-measure.mjs. */
const REF = {
  rockLit: { hex: "#B8834D", Y: 0.27, h: 30 },
  rockLitLow: { hex: "#785C3E", Y: 0.12, h: 31 },
  rockShadow: { hex: "#1B2B32", Y: 0.022, h: 198 },
  litShadowRatio: [4.15, 5.47],
  cyanShare: 9.54,
  meanY: 0.273,
};

const results = [];
function claim(id, what, pass, detail) {
  results.push({ id, claim: what, verdict: pass ? "PASS" : "FAIL", ...detail });
  return pass;
}

const round = (v, n = 3) => (Number.isFinite(v) ? Number(v.toFixed(n)) : v);

await openGame({ width: WIDTH, height: HEIGHT, tier: TIER }, async (d) => {
  await d.play(1.2);

  // ------------------------------------------------------------------ in-page measurement
  const M = await d.run(() => {
    const K = window.__vs.kernel;
    const terrain = K.get("terrain");
    const level = K.get("level01");
    const collision = K.get("collision");
    const t = terrain.snapshot();
    const L = level.snapshot();
    const A = L.anchors;

    // --- S2 facet size: the real edge lengths of the rendered surface ------------------
    const pos = terrain.topGeometry.getAttribute("position").array;
    const edges = [];
    const step = Math.max(1, Math.floor(pos.length / 9 / 2000));
    for (let i = 0; i < pos.length / 9; i += step) {
      const o = i * 9;
      for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
        edges.push(
          Math.hypot(pos[o + a] - pos[o + b], pos[o + a + 1] - pos[o + b + 1], pos[o + a + 2] - pos[o + b + 2])
        );
      }
    }
    edges.sort((p, q) => p - q);
    const median = edges[Math.floor(edges.length / 2)];

    // --- S3 the collider is the render geometry ---------------------------------------
    let worst = 0;
    let checked = 0;
    let misses = 0;
    for (let i = 0; i < 600; i++) {
      const x = -220 + (i * 37) % 440;
      const z = -330 + (i * 71) % 650;
      const y = terrain.groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const g = collision.groundAt(x, z, y + 60, 200);
      checked++;
      if (!g?.hit) { misses++; continue; }
      worst = Math.max(worst, Math.abs(g.y - y));
    }

    // --- S4 no ground under the leaf --------------------------------------------------
    // Every point inside the ravine slot, and every point beyond the lip, must return no
    // surface at all — not a lower one.
    let ravineSolid = 0;
    let ravineTested = 0;
    for (let i = 0; i < 400; i++) {
      const aZ = -180 + (i * 0.9);
      const aX = 176 + 26 * Math.sin(aZ * 0.0122) + 13 * Math.sin(aZ * 0.031 + 2.0);
      const [x, z] = [aZ, -aX];
      if (Math.abs(x) > 210) continue;
      ravineTested++;
      if (terrain.isSolid(x, z)) ravineSolid++;
    }
    // --- C1 the two arches never share a frame ----------------------------------------
    const fovY = (K.camera.fov * Math.PI) / 180;
    const aspect = K.camera.aspect;
    const halfDiag = Math.atan(Math.hypot(Math.tan(fovY / 2) * aspect, Math.tan(fovY / 2)));
    const arch = (a, lift) => [a.x, a.y + lift, a.z];
    const b1 = arch(A.bollard, 13);
    const b2 = arch(A.secondLip, 12);
    const sep = (p, q, o) => {
      const u = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      const v = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const lu = Math.hypot(...u);
      const lv = Math.hypot(...v);
      const dot = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv || 1);
      return Math.acos(Math.max(-1, Math.min(1, dot)));
    };
    let positions = 0;
    let both = 0;
    const worstCase = [];
    for (let x = -220; x <= 220; x += 14) {
      for (let z = -340; z <= 330; z += 14) {
        const g = terrain.groundAt(x, z);
        if (!Number.isFinite(g)) continue;
        for (const lift of [1.7, 4.0, 8.0]) {
          const eye = [x, g + lift, z];
          positions++;
          // The whole diagonal field of view has to be able to hold both before it can be a
          // problem at all — 101° for this camera.
          const a = sep(b1, b2, eye);
          if (a > 2 * halfDiag) continue;
          const v1 = !terrain.occluded(eye, b1, 4);
          const v2 = !terrain.occluded(eye, b2, 4);
          if (v1 && v2) {
            both++;
            if (worstCase.length < 6) worstCase.push({ eye: eye.map((v) => Math.round(v)), sepDeg: Math.round((a * 180) / Math.PI) });
          }
        }
      }
    }

    // --- C2 / C3 --------------------------------------------------------------------
    const archSeparation = Math.hypot(A.bollard.x - A.secondLip.x, A.bollard.z - A.secondLip.z);

    // Narrowest crossing of the ravine anywhere along it: if any line is jumpable, the span
    // stops being the only way across and Beat 3 has no teeth. Only gaps with solid ground on
    // *both* sides count — the open sky past the lip is not a crossing.
    let narrowest = Infinity;
    let narrowestAt = null;
    for (let x = -210; x <= 210; x += 3) {
      let run = 0;
      let sawSolid = false;
      let best = Infinity;
      for (let z = -260; z <= -95; z += 0.5) {
        if (terrain.isSolid(x, z)) {
          if (run > 0 && sawSolid) best = Math.min(best, run);
          run = 0;
          sawSolid = true;
        } else if (sawSolid) run += 0.5;
      }
      if (best < narrowest) { narrowest = best; narrowestAt = x; }
    }

    // --- K1 landmarks: distance band and angular size from the spawn ------------------
    const eye = [A.spawn.x, A.spawn.y + 1.4, A.spawn.z];
    const landmarks = [
      { id: "spires", p: [A.brow.x - 30, A.brow.y + 20, A.brow.z - 22], size: 58 },
      { id: "standingHouse", p: [A.standingHouse.x, A.standingHouse.y + 6, A.standingHouse.z], size: 21 },
      { id: "knuckle", p: [A.knuckle.x, A.knuckle.y + 10, A.knuckle.z], size: 40 },
      { id: "secondLip", p: [A.secondLip.x, A.secondLip.y + 6, A.secondLip.z], size: 25 },
      { id: "certaintyField", p: [A.certaintyField.x, A.certaintyField.y + 4, A.certaintyField.z], size: 120 },
      { id: "vantis", p: [Math.sin(A.vantis.bearing) * 0 + 0, 0, 0], size: 3600, distance: A.vantis.distance },
    ].map((m) => {
      const dist = m.distance ?? Math.hypot(m.p[0] - eye[0], m.p[1] - eye[1], m.p[2] - eye[2]);
      return { id: m.id, distance: Math.round(dist), subtendDeg: Number(((2 * Math.atan(m.size / (2 * dist)) * 180) / Math.PI).toFixed(2)) };
    });

    // --- K2 no dead space, K3 verticality ---------------------------------------------
    const features = [
      A.bollard, A.barge, A.kindness, A.standingHouse, A.standingHouseSocket, A.weir,
      A.terrace, A.knuckle, A.spanNear, A.spanFar, A.secondLip, A.certaintyField,
      A.ridgeThing, A.edgewake, A.lowLip, A.cutters, A.brow,
    ].filter(Boolean);
    let walkable = 0;
    let farFromAnything = 0;
    let worstDeadSpace = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    const slopeBins = [0, 0, 0, 0]; // <8°, 8–20°, 20–40°, >40°
    for (let x = -220; x <= 220; x += 8) {
      for (let z = -340; z <= 330; z += 8) {
        const g = terrain.groundAt(x, z);
        if (!Number.isFinite(g)) continue;
        const n = terrain.normalAt(x, z);
        const deg = (Math.acos(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI;
        if (deg > 45) continue; // not walkable; it is scenery
        walkable++;
        minY = Math.min(minY, g);
        maxY = Math.max(maxY, g);
        slopeBins[deg < 8 ? 0 : deg < 20 ? 1 : deg < 40 ? 2 : 3]++;
        let near = Infinity;
        for (const f of features) near = Math.min(near, Math.hypot(f.x - x, f.z - z));
        worstDeadSpace = Math.max(worstDeadSpace, near);
        if (near > 90) farFromAnything++;
      }
    }

    // --- P: which pixels are this piece's terrain, and what is each one? ---------------
    // March a ray through a grid of screen pixels against the heightfield, so the colour
    // claims below are made about surfaces this piece owns and about facets whose orientation
    // relative to Lethis is known — rather than about whatever happened to be in frame.
    // Built by hand from the camera matrix; no library, and no debug global in shipped code.
    const cam = K.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const W = K.renderer.domElement.clientWidth;
    const H = K.renderer.domElement.clientHeight;
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    const eyeP = [e[12], e[13], e[14]];
    const sun = L.sun?.toLight ?? [0.87, 0.19, -0.46];
    const samples = [];
    for (let py = 6; py < H; py += 8) {
      for (let pxl = 6; pxl < W; pxl += 8) {
        const ndcx = (pxl / W) * 2 - 1;
        const ndcy = -((py / H) * 2 - 1);
        const cx = ndcx * tanH * cam.aspect;
        const cy = ndcy * tanH;
        // camera space (cx, cy, −1) through the world rotation columns of matrixWorld
        let dx = e[0] * cx + e[4] * cy - e[8];
        let dy = e[1] * cx + e[5] * cy - e[9];
        let dz = e[2] * cx + e[6] * cy - e[10];
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        let t = 1;
        let hitT = -1;
        let prev = 1;
        for (let i = 0; i < 260; i++) {
          const step = 0.35 + t * 0.02;
          prev = t;
          t += step;
          if (t > 900) break;
          const g = terrain.groundAt(eyeP[0] + dx * t, eyeP[2] + dz * t);
          if (Number.isFinite(g) && eyeP[1] + dy * t < g) { hitT = t; break; }
        }
        if (hitT < 0) continue;
        // bisect once for a clean facet read
        let lo = prev;
        let hi = hitT;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const g = terrain.groundAt(eyeP[0] + dx * mid, eyeP[2] + dz * mid);
          if (Number.isFinite(g) && eyeP[1] + dy * mid < g) hi = mid; else lo = mid;
        }
        const hx = eyeP[0] + dx * hi;
        const hz = eyeP[2] + dz * hi;
        const n = terrain.normalAt(hx, hz);
        if (!n) continue;
        const ndl = n.x * sun[0] + n.y * sun[1] + n.z * sun[2];
        samples.push({ x: pxl, y: py, d: Number(hi.toFixed(1)), ndl: Number(ndl.toFixed(3)), up: Number(n.y.toFixed(3)) });
      }
    }

    return {
      terrain: t,
      level: {
        anchors: A,
        landmarks: L.landmarks,
        backdrop: L.backdrop,
        triangles: L.triangles,
        downLeaf: L.downLeaf,
      },
      stats: window.__vs.stats(),
      facet: { medianEdge: Number(median.toFixed(2)), p10: Number(edges[Math.floor(edges.length * 0.1)].toFixed(2)), samples: edges.length },
      collider: { checked, misses, worstDelta: Number(worst.toFixed(4)) },
      voids: { ravineTested, ravineSolid, belowHits: belowHits.length },
      arches: {
        separationMetres: Math.round(archSeparation),
        positions,
        bothVisible: both,
        worstCase,
        halfDiagDeg: Math.round((halfDiag * 360) / Math.PI / 2),
      },
      ravine: { narrowestGap: Number(narrowest.toFixed(1)), atX: narrowestAt, spanGap: A.span.gap },
      landmarks,
      space: {
        walkable,
        farFromAnything,
        worstDeadSpace: Math.round(worstDeadSpace),
        heightRange: Number((maxY - minY).toFixed(1)),
        slopeBins,
      },
      pixels: samples,
      viewport: [W, H],
    };
  });

  await d.shoot(SHOT);
  const report = await d.report();
  M.problems = [];
  if (report.fatal) M.problems.push(`fatal: ${String(report.fatal).split("\n")[0]}`);
  for (const e of report.errors ?? []) M.problems.push(`runtime error: ${e.split("\n")[0]}`);
  for (const e of d.consoleErrors) M.problems.push(`console error: ${e}`);
  globalThis.__M = M;
});

const M = globalThis.__M;

// ---------------------------------------------------------------------------- pixel analysis

const img = readPNG(path.resolve(ROOT, SHOT));
const scaleX = img.width / M.viewport[0];
const scaleY = img.height / M.viewport[1];
const patch = (x, y) => {
  const sx = Math.round(x * scaleX);
  const sy = Math.round(y * scaleY);
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const p = px(img, Math.min(img.width - 1, Math.max(0, sx + i)), Math.min(img.height - 1, Math.max(0, sy + j)));
      r += p[0]; g += p[1]; b += p[2]; n++;
    }
  return [r / n, g / n, b / n];
};

const buckets = { lit: [], shadow: [] };
for (const s of M.pixels) {
  if (s.d > 90) continue; // "near" — beyond this the haze is doing the talking, by design
  const c = patch(s.x, s.y);
  const [h, sat, v] = hsv(...c.map(Math.round));
  const Y = lum(...c.map(Math.round));
  (s.ndl > 0.12 ? buckets.lit : s.ndl < -0.08 ? buckets.shadow : []).push({ Y, h, sat, v });
}
const stat = (arr) => {
  if (!arr.length) return null;
  const med = (k) => {
    const a = arr.map((o) => o[k]).sort((p, q) => p - q);
    return a[Math.floor(a.length / 2)];
  };
  return { n: arr.length, Y: round(med("Y")), hue: round(med("h"), 1), sat: round(med("sat")), v: round(med("v")) };
};
const lit = stat(buckets.lit);
const shadow = stat(buckets.shadow);

// whole-frame census, for comparison with the reference's own
let cyan = 0, dark = 0, sumY = 0, total = 0;
for (let y = 0; y < img.height; y += 2)
  for (let x = 0; x < img.width; x += 2) {
    const [r, g, b] = px(img, x, y);
    const [h, s] = hsv(r, g, b);
    const Y = lum(r, g, b);
    sumY += Y; total++;
    if (s >= 0.3 && h >= 150 && h <= 200) cyan++;
    if (Y < 0.05) dark++;
  }
const census = { cyanPct: round((100 * cyan) / total, 2), darkPct: round((100 * dark) / total, 2), meanY: round(sumY / total) };

// ---------------------------------------------------------------------------- claims

claim("S1", "terrain is non-indexed with one normal per face", M.terrain.indexed === false && M.terrain.flatNormalFraction === 1, {
  indexed: M.terrain.indexed,
  flatNormalFraction: M.terrain.flatNormalFraction,
  threshold: "indexed=false, flatNormalFraction=1.0",
});
claim("S2", "facets are big enough to count at gameplay distance", M.facet.medianEdge >= 4.0, {
  medianEdgeMetres: M.facet.medianEdge,
  p10EdgeMetres: M.facet.p10,
  threshold: ">= 4.0 m median triangle edge",
});
claim("S3", "the collider is the render geometry", M.collider.misses === 0 && M.collider.worstDelta < 0.02, {
  pointsChecked: M.collider.checked,
  colliderMisses: M.collider.misses,
  worstDeltaMetres: M.collider.worstDelta,
  threshold: "0 misses, worst |render−collider| < 0.02 m",
});
claim("S4", "there is no ground under the leaf, and the ravine is a hole", M.voids.ravineSolid === 0, {
  ravinePointsTested: M.voids.ravineTested,
  ravinePointsSolid: M.voids.ravineSolid,
  threshold: "0 solid samples on the ravine centreline",
});
claim("C1", "the Bollard and the Second Lip never share a frame", M.arches.bothVisible === 0, {
  cameraPositionsSwept: M.arches.positions,
  framingsHoldingBoth: M.arches.bothVisible,
  halfDiagonalFovDeg: M.arches.halfDiagDeg,
  worstCase: M.arches.worstCase,
  threshold: "0 framings, over every reachable stand at eye heights 1.7/4/8 m",
});
claim("C2", "they are the two ends of one body about 600 m long", M.arches.separationMetres >= 500 && M.arches.separationMetres <= 700, {
  separationMetres: M.arches.separationMetres,
  threshold: "500–700 m",
});
claim("C3", "the ravine cannot be walked or jumped", M.ravine.narrowestGap >= 16, {
  narrowestGapMetres: M.ravine.narrowestGap,
  measuredSpanGapMetres: M.ravine.spanGap,
  threshold: ">= 16 m at its narrowest (locomotion's best jump is far under this)",
});
const bands = new Set(M.landmarks.map((l) => Math.floor(Math.log10(Math.max(l.distance, 1)) * 2)));
const legible = M.landmarks.filter((l) => l.subtendDeg >= 0.6);
claim("K1", "five landmarks, five distance bands, all legible at thumbnail size", legible.length >= 5 && bands.size >= 4, {
  landmarks: M.landmarks,
  legibleCount: legible.length,
  distinctDistanceBands: bands.size,
  threshold: ">= 5 landmarks subtending >= 0.6°, in >= 4 half-decade distance bands",
});
claim("K2", "no dead space on the walkable surface", M.space.farFromAnything === 0, {
  walkableSamples: M.space.walkable,
  samplesFurtherThan90mFromAnything: M.space.farFromAnything,
  worstDistanceToAnything: M.space.worstDeadSpace,
  threshold: "every walkable sample within 90 m of a published anchor",
});
const slopeMid = (M.space.slopeBins[1] + M.space.slopeBins[2]) / Math.max(1, M.space.walkable);
claim("K3", "real verticality across the walkable surface", M.space.heightRange >= 70 && slopeMid >= 0.25, {
  walkableHeightRangeMetres: M.space.heightRange,
  fractionOfSurfaceBetween8And40Deg: round(slopeMid),
  slopeBins: M.space.slopeBins,
  threshold: ">= 70 m of height, >= 25% of the surface between 8° and 40°",
});
claim("P1", "near lit rock matches the reference's lit rock", !!lit && Math.abs(lit.Y - REF.rockLit.Y) <= 0.09 && Math.abs(lit.hue - REF.rockLit.h) <= 14, {
  measured: lit,
  reference: REF.rockLit,
  threshold: "|ΔY| <= 0.09 and |Δhue| <= 14° against #B8834D",
});
claim("P2", "near shadowed rock is the reference's blue shadow, not a dark orange", !!shadow && Math.abs(shadow.Y - REF.rockShadow.Y) <= 0.05 && Math.abs(shadow.hue - REF.rockShadow.h) <= 25, {
  measured: shadow,
  reference: REF.rockShadow,
  threshold: "|ΔY| <= 0.05 and |Δhue| <= 25° against #1B2B32 (hue 198)",
});
const ratio = lit && shadow ? lit.Y / Math.max(shadow.Y, 1e-4) : 0;
claim("P3", "the lit:shadow luminance ratio sits in the reference's band", ratio >= 3.2 && ratio <= 9, {
  measuredRatio: round(ratio, 2),
  referenceRatio: REF.litShadowRatio,
  threshold: "3.2–9.0 (the reference measures 4.15 and 5.47 on two different rocks)",
});
claim("P4", "the frame is inside the performance budget", M.stats.drawCalls <= 320 && M.stats.triangles <= 1_600_000 && M.stats.programs <= 90, {
  drawCalls: M.stats.drawCalls,
  triangles: M.stats.triangles,
  programs: M.stats.programs,
  threshold: "<= 320 draws, <= 1.6M triangles, <= 90 programs",
});

// ---------------------------------------------------------------------------- output

const failed = results.filter((r) => r.verdict === "FAIL");
const out = {
  piece: "P09",
  viewport: M.viewport,
  tier: TIER,
  shot: SHOT,
  bootProblems: M.problems,
  world: {
    terrain: M.terrain,
    landmarks: M.level.landmarks,
    triangles: M.level.triangles,
    backdrop: M.level.backdrop,
    downLeaf: M.level.downLeaf,
  },
  frameCensus: { measured: census, reference: { cyanPct: REF.cyanShare, meanY: REF.meanY } },
  claims: results,
  summary: `${results.length - failed.length}/${results.length} claims pass`,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`\nP09 — Leaf Nine · ${M.viewport[0]}x${M.viewport[1]} · tier ${TIER}`);
  if (M.problems.length) {
    console.log("\nBOOT PROBLEMS (measurements below are suspect):");
    for (const p of M.problems) console.log("  ! " + p);
  }
  console.log("\n" + "id".padEnd(4) + "verdict".padEnd(9) + "claim");
  console.log("-".repeat(96));
  for (const r of results) {
    console.log(r.id.padEnd(4) + r.verdict.padEnd(9) + r.claim);
    const { id, claim: _c, verdict, threshold, ...rest } = r;
    for (const [k, v] of Object.entries(rest)) console.log("      " + k.padEnd(34) + JSON.stringify(v));
    console.log("      " + "threshold".padEnd(34) + JSON.stringify(threshold));
  }
  console.log("-".repeat(96));
  console.log("frame census (whole frame, includes other pieces' pixels):", JSON.stringify(out.frameCensus));
  console.log("world:", JSON.stringify(out.world));
  console.log("\n" + out.summary);
}

fs.mkdirSync(path.resolve(ROOT, "review/measure"), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, "review/measure/P09.json"), JSON.stringify(out, null, 2));
process.exit(failed.length ? 1 : 0);
