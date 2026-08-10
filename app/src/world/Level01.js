import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import {
  PAL,
  boxTris,
  clamp,
  clamp01,
  distToPolyline,
  facetGeometry,
  fbm,
  flatMaterial,
  hash2i,
  lerp,
  mergeFacets,
  pushTri,
  ridged,
  sceneRGB,
  shard,
  smoothstep,
  updateFlatShared,
} from "./Terrain.js";

/**
 * Level01 — Leaf Nine, composed.
 *
 * This is level design, not decoration. The leaf is six hundred metres of warm ochre stone tilted
 * seven degrees (world.md §10), and every metre of it is doing one of three jobs: framing, posing
 * a question, or being somewhere to stand on the way to one of the other two.
 *
 * **The arrival frame, which the whole layout is built backwards from.** The player spawns on the
 * brow at the head — the highest walkable ground on the leaf — facing down its length, and one
 * frame contains all of this: angular spires cutting the left edge inside forty metres; the
 * Standing House on its shelf at a hundred and eighty; three carries winding down the leaf and one
 * of them climbing back up; a ravine at four hundred that goes clean through the stone with sky
 * underneath it; the certainty field glowing on the far shard at five hundred and fifty; and
 * eleven kilometres out, across the Long Division, Vantis, with towers that stop in mid-air. Five
 * landmarks, five distance bands, five silhouettes that survive being shrunk to a thumbnail.
 *
 * **Down-leaf is world −Z, and that is a decision.** The camera rig's neutral yaw looks down −Z,
 * so authoring the leaf along that axis means the first frame a player ever controls is the
 * composed one — the level does not have to ask the camera for a favour to introduce itself. The
 * numbers below are written in *leaf space* (X down-leaf, Z across, matching how you would draw
 * the survey) and `W()` maps them to world, once, in one place.
 *
 * **The rules this file is held to.**
 *
 *  - *There is no ground underneath.* (world.md §2.3.) Below a leaf is not a lower level; it is
 *    the place where things stopped being true. The ravine is therefore a hole with sky in it, the
 *    lip is a fracture, and no geometry in this file is a valley floor.
 *  - *The Bollard and the Second Lip are the two ends of one body, six hundred metres apart, and
 *    no camera framing may ever contain both.* (§3, §12.) That is not enforced by a note in a
 *    document — it is enforced by the head brow, which stands between the head bowl and the rest
 *    of the leaf, and `review/measure/P09.mjs` sweeps every reachable camera to prove it.
 *  - *The far pan is measured, never authored.* (§2.1 rule 1.) This file digs the hole; the claim
 *    reads the geometry. The ravine's span anchors carry the gap that was *measured* off the
 *    finished terrain, so no other piece ever types a right-hand quantity.
 *
 * Anchors go out through the `level` probe rather than being hard-coded anywhere else, so P13,
 * P19, P23 and P26 can place a barge, a weir, a socket or a span without importing this file.
 */

// ---------------------------------------------------------------------------- leaf space

const TILT = Math.tan((7 * Math.PI) / 180); // world.md §10: "tilted about 7°"
const baseY = (aX) => 12 - TILT * aX;

/** Leaf space → world. Down-leaf (+X) becomes −Z; across (+Z) becomes +X, so −X is frame-left. */
const W = (aX, aZ) => [aZ, -aX];
/** World → leaf space. */
const A = (x, z) => [-z, x];

/** Soft-edged rectangle in leaf space — the level's only shaping primitive. */
function pad(aX, aZ, x0, x1, z0, z1, f) {
  return (
    smoothstep(x0 - f, x0 + f, aX) *
    (1 - smoothstep(x1 - f, x1 + f, aX)) *
    smoothstep(z0 - f, z0 + f, aZ) *
    (1 - smoothstep(z1 - f, z1 + f, aZ))
  );
}

/**
 * The carries. Rivers of unresolved value, luminous teal, flowing toward whatever is nearly true —
 * which is why the middle one runs *uphill*, from the east lip back up to the Standing House
 * claim. Nothing in the game explains that and nothing is allowed to.
 */
// Widths are large on purpose. A carry narrower than about four terrain cells cannot be *cut* by
// a six-metre heightfield — the trough averages away and the river ends up buried in the stone it
// is supposed to have carved. These are also the widest bright shapes in the frame, and in the
// reference the river is what walks the eye from the foreground to the horizon.
//
// **Three things about this list were wrong for a whole round and a critic found all of them.**
//
//  1. *None of them was in the arrival frame.* The comment above claimed the river walks the eye
//     from foreground to horizon; across three captures spanning more than 180° of look-around
//     there was not one teal pixel. `carry.low` ran at aZ ≈ −76 at the spawn's own down-leaf
//     station, which is behind the crest, and every other carry was either up-leaf, off to the
//     right shoulder, or past the ravine. `carry.spine` below is routed *along the corridor the
//     player is looking down*, from twenty-three metres in front of the brow to the east lip four
//     hundred metres away, and it is the subject of the frame.
//
//  2. *They ran through the raised pads.* `carry.low` crossed the crest (+54 m) and the knuckle
//     (+34 m), and the carve is `h = min(h, baseY − depth)` — so it did not run *over* those, it
//     cut a slot through them. A river at the bottom of a thirty-metre slot is exactly the thing
//     this file's own comment at `_composeCarries` says is invisible from anywhere but above it.
//     `carry.spine` is routed through open ground, and where it does cross a scarp it crosses it
//     square with a shallow cut and a wide shoulder, which makes a valley rather than a trench.
//
//  3. *The ribbon was authored against `baseY`, not against the ground.* A surface at
//     `baseY(aX) − 1.5` is under the terrace (which sits above `baseY`) and floating over the
//     field (which sits below it). `brim` is now a height above **the ground the terrain actually
//     built**, sampled at the ribbon's own corners — see `ribbonTris`. That is the number the
//     "is the river visible" claim in `review/measure/P09.mjs` reads back.
//
// `depth` is now a shallow carve whose only job is to give the river a bank and to switch the
// surface class; the visible surface is the ribbon, and the ribbon rides the ground.
export const CARRIES = [
  {
    // The subject of the arrival frame. Starts 23 m in front of the brow, low in frame and wide,
    // and runs 400 m down the leaf, narrowing, to pour off the east lip into open sky.
    id: "carry.spine",
    width: 34,
    depth: 1.6,
    brim: 0.45,
    hero: true,
    pts: [[-194, 16], [-152, 28], [-106, 18], [-58, 34], [-8, 46], [42, 66], [84, 100], [118, 138], [150, 178]],
  },
  {
    id: "carry.low",
    width: 30,
    depth: 1.8,
    brim: 0.45,
    pts: [[-268, -104], [-214, -96], [-150, -78], [-64, -58], [24, -40], [104, -22], [150, -10]],
  },
  {
    id: "carry.middle",
    width: 26,
    depth: 1.6,
    brim: 0.45,
    uphill: true,
    pts: [[172, 128], [104, 114], [36, 98], [-30, 78], [-92, 56], [-132, 32], [-150, 16]],
  },
  {
    id: "carry.high",
    width: 24,
    depth: 1.6,
    brim: 0.45,
    pts: [[-262, 112], [-186, 136], [-92, 146], [4, 138], [90, 124], [148, 108]],
  },
  {
    // Past the ravine, on the far shard: the eye picks the river back up beyond the hole and
    // carries on to the low rim. The ravine is the one break in the run and it is a break in the
    // *world*, not in the composition.
    id: "carry.field",
    width: 26,
    depth: 1.6,
    brim: 0.45,
    pts: [[210, 4], [248, 18], [286, 8], [322, 20]],
  },
];

/** The ravine's centreline and half-width. It wanders, because a fracture is not a saw cut. */
const ravineCentre = (aZ) => 176 + 26 * Math.sin(aZ * 0.0122) + 13 * Math.sin(aZ * 0.031 + 2.0);
const ravineHalf = (aZ) => 12 + 4.5 * Math.sin(aZ * 0.0185 + 1.1) + 2.5 * Math.sin(aZ * 0.047);

export const LEAF = {
  id: "leaf-nine",
  bounds: { x0: -232, x1: 232, z0: -352, z1: 338 },
  cell: 6,
  seed: 90210,

  /**
   * The authored half of the terrain: base height, whether the leaf exists here, how much noise it
   * is allowed, and what class of surface it is. Terrain.js owns everything after this.
   */
  design(x, z, out) {
    const aX = -z;
    const aZ = x;

    let h = baseY(aX);
    let protect = 0;
    let rough = 1;
    let mat = 0;
    let thick = 1;

    // --- outline: an ellipse gone lumpy. A leaf is a fracture, not a plate. ------------
    const ang = Math.atan2(aZ, aX);
    const wob =
      fbm(Math.cos(ang) * 2.1, Math.sin(ang) * 2.1, 771, 4) * 46 +
      fbm(Math.cos(ang) * 5.4, Math.sin(ang) * 5.4, 913, 3) * 17;
    const rr = Math.hypot(aX / 322, aZ / 196);
    let mask = rr < 1 + wob / 330 ? 1 : 0;

    // --- the ravine: it goes clean through, and there is sky under it ------------------
    if (Math.abs(aX - ravineCentre(aZ)) < ravineHalf(aZ)) mask = 0;

    // --- the head: a bowl behind a brow -------------------------------------------------
    // The brow is the hero vantage AND the reason the Bollard is never in the same shot as the
    // Second Lip. It is load-bearing twice over.
    const bowl = pad(aX, aZ, -336, -264, -140, 165, 24);
    h = lerp(h, 40.5, bowl * 0.95);
    protect = Math.max(protect, bowl * 0.9);
    const brow = pad(aX, aZ, -260, -206, -170, 180, 20);
    h += brow * 12.5;
    protect = Math.max(protect, brow * 0.5);

    // --- the crest: the angular spires that frame the left of every arrival shot -------
    const crest = pad(aX, aZ, -300, -110, -172, -34, 30);
    h += crest * (10 + ridged(aX * 0.0195, aZ * 0.0195, 401, 3) * 44);
    rough = lerp(rough, 2.4, crest);

    // --- the Standing House shelf --------------------------------------------------------
    const shelf = pad(aX, aZ, -132, -48, -110, -20, 15);
    h = lerp(h, baseY(-90) + 2.0, shelf);
    protect = Math.max(protect, shelf);
    if (shelf > 0.5) mat = 4;

    // --- two scarps and a knuckle, so five hundred metres of ground is not one ramp ----
    // Each rises over about twenty metres and then falls away again, which puts a face
    // pointing back *up*-leaf — square into shadow, since Lethis sits down-leaf and right.
    // That is where the frame's value bands come from: light tread, dark riser, repeat.
    const scarp = (x0, x1, x2, x3, rise, wobble) =>
      rise *
      smoothstep(x0, x1, aX + wobble) *
      (1 - smoothstep(x2, x3, aX + wobble));
    const wob2 = Math.sin(aZ * 0.021) * 14 + Math.sin(aZ * 0.052 + 1.3) * 6;
    h += scarp(-136, -112, -74, -40, 11, wob2);
    h += scarp(120, 140, 150, 168, 8, wob2 * 0.6);
    const knuckle = pad(aX, aZ, 26, 106, -96, -8, 22);
    h += knuckle * (14 + ridged(aX * 0.026, aZ * 0.026, 517, 3) * 20);
    rough = lerp(rough, 1.9, knuckle);

    // --- the middle terrace: where the leaf opens out and the traffic crosses ----------
    const terrace = pad(aX, aZ, -30, 78, -40, 104, 24);
    h = lerp(h, baseY(24) - 1.2, terrace * 0.85);
    protect = Math.max(protect, terrace * 0.8);

    // --- a shoulder on the right, so the leaf has two sides ----------------------------
    const shoulder = pad(aX, aZ, -150, 30, 126, 214, 30);
    h += shoulder * 17;
    rough = lerp(rough, 1.5, shoulder);

    // --- the far shard: the certainty field, and the ridge that stands over it ---------
    const field = pad(aX, aZ, 206, 320, -104, 156, 28);
    h = lerp(h, baseY(262) - 4.5, field * 0.92);
    protect = Math.max(protect, field * 0.86);
    if (field > 0.4) mat = 3;
    const ridgeF = pad(aX, aZ, 214, 336, -218, -92, 26);
    h += ridgeF * 28;
    rough = lerp(rough, 1.7, ridgeF);
    const rim = pad(aX, aZ, 296, 352, -232, 232, 18);
    h += rim * 9;

    // --- the carries: troughs, protected so noise cannot break a river ----------------
    for (const c of CARRIES) {
      const { d } = distToPolyline(aX, aZ, c.pts);
      if (d > c.width * 2.0) continue;
      const w = 1 - smoothstep(c.width * 0.5, c.width * 1.8, d);
      const floor = baseY(aX) - c.depth;
      h = lerp(h, Math.min(h, floor), w);
      protect = Math.max(protect, w);
      if (w > 0.2) mat = 2;
      thick = lerp(thick, 0.72, w);
    }

    out.h = h;
    out.mask = mask;
    out.rough = rough;
    out.protect = protect;
    out.mat = mat;
    out.thick = thick;
  },
};

// ---------------------------------------------------------------------------- geometry helpers

/** A faceted arch of dark glass, coming up out of the stone and going back into it. */
function archTris(out, { x, y, z, span, height, thick, depth, rot = 0, segs = 9, sink = 9 }) {
  const ux = Math.cos(rot);
  const uz = Math.sin(rot);
  const wx = -Math.sin(rot);
  const wz = Math.cos(rot);
  const station = (s) => {
    const t = clamp(s, -1, 1);
    const rise = height * Math.pow(Math.max(0, 1 - t * t), 0.55);
    return [x + ux * (t * span * 0.5), y + rise, z + uz * (t * span * 0.5)];
  };
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const s = -1 + (2 * i) / segs;
    const p = station(s);
    const pPrev = station(s - 0.02);
    const pNext = station(s + 0.02);
    let tx = pNext[0] - pPrev[0];
    let ty = pNext[1] - pPrev[1];
    let tz = pNext[2] - pPrev[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // In-plane normal = tangent × depth axis (the depth axis is horizontal, so its y is 0).
    let nx2 = ty * wz;
    let ny2 = tz * wx - tx * wz;
    let nz2 = -ty * wx;
    const nl = Math.hypot(nx2, ny2, nz2) || 1;
    nx2 /= nl; ny2 /= nl; nz2 /= nl;
    const ht = thick * 0.5;
    const hd = depth * 0.5;
    const drop = i === 0 || i === segs ? sink : 0;
    rings.push([
      [p[0] + nx2 * ht + wx * hd, p[1] + ny2 * ht - drop, p[2] + nz2 * ht + wz * hd],
      [p[0] + nx2 * ht - wx * hd, p[1] + ny2 * ht - drop, p[2] + nz2 * ht - wz * hd],
      [p[0] - nx2 * ht - wx * hd, p[1] - ny2 * ht - drop, p[2] - nz2 * ht - wz * hd],
      [p[0] - nx2 * ht + wx * hd, p[1] - ny2 * ht - drop, p[2] - nz2 * ht + wz * hd],
    ]);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < 4; k++) {
      const l = (k + 1) % 4;
      pushTri(out, a[k], a[l], b[k]);
      pushTri(out, a[l], b[l], b[k]);
    }
  }
  const cap = (r, flip) => {
    if (flip) { pushTri(out, r[0], r[2], r[1]); pushTri(out, r[0], r[3], r[2]); }
    else { pushTri(out, r[0], r[1], r[2]); pushTri(out, r[0], r[2], r[3]); }
  };
  cap(rings[0], true);
  cap(rings[rings.length - 1], false);
  return out;
}

/** A ribbon of faceted quads along a leaf-space polyline — a carry's surface. */
function ribbonTris(out, pts, widthAt, yAt, along = 5) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const steps = Math.max(6, Math.round(total / along));
  const samples = [];
  for (let s = 0; s <= steps; s++) {
    const d = (s / steps) * total;
    let acc = 0;
    let px = pts[0][0];
    let pz = pts[0][1];
    let dx = 1;
    let dz = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= acc + seg || i === pts.length - 1) {
        const u = clamp01((d - acc) / (seg || 1));
        px = lerp(pts[i - 1][0], pts[i][0], u);
        pz = lerp(pts[i - 1][1], pts[i][1], u);
        dx = (pts[i][0] - pts[i - 1][0]) / (seg || 1);
        dz = (pts[i][1] - pts[i - 1][1]) / (seg || 1);
        break;
      }
      acc += seg;
    }
    const w = widthAt(s / steps) * 0.5;
    samples.push({ px, pz, nx: -dz * w, nz: dx * w, t: s / steps });
  }
  for (let s = 0; s < samples.length - 1; s++) {
    const a = samples[s];
    const b = samples[s + 1];
    const side = (p, sign) => {
      const aX = p.px + p.nx * sign;
      const aZ = p.pz + p.nz * sign;
      const w = W(aX, aZ);
      return [w[0], yAt(p.px, p.t), w[1]];
    };
    const a0 = side(a, -1);
    const a1 = side(a, 1);
    const b0 = side(b, -1);
    const b1 = side(b, 1);
    const am = [(a0[0] + a1[0]) / 2, a0[1] + 0.12, (a0[2] + a1[2]) / 2];
    const bm = [(b0[0] + b1[0]) / 2, b0[1] + 0.12, (b0[2] + b1[2]) / 2];
    // Split down the middle so a carry has a bright core lane and two cooler banks.
    pushTri(out, a0, b0, am);
    pushTri(out, b0, bm, am);
    pushTri(out, am, bm, a1);
    pushTri(out, bm, b1, a1);
  }
  return out;
}

// ---------------------------------------------------------------------------- the level

export class Level01 {
  constructor(kernel, terrain) {
    this.kernel = kernel;
    this.terrain = terrain;
    this.root = new THREE.Group();
    this.root.name = "vs.level01";

    // The compressed backdrop. Everything past the archipelago is authored at its true distance
    // and rendered at 1/k of it, at 1/k scale — a projective identity, so bearing, angular size
    // and parallax are all exactly right while the geometry sits comfortably inside the far
    // plane. `uVsDist` multiplies the distance back up so the haze curve sees the real number.
    const drawDistance = config.tier.drawDistance;
    this.farK = Math.max(3, 11400 / (drawDistance * 0.8));
    this.nearScale = clamp(drawDistance / 1400, 0.35, 1);

    this.far = new THREE.Group();
    this.far.name = "vs.level01.backdrop";
    this.root.add(this.far);

    this.anchors = {};
    this._spawned = false;

    this._composeGround();
    this._composeCarries();
    this._composeStructures();
    this._composeCertainties();
    this._composeArchipelago();
    this._composeBackdrop();
    this._setAnchors();

    publish("level", () => this.snapshot());
    signals.emit("world:ready", { id: LEAF.id });

    this._offSun = signals.on("world:sun", (s) => {
      this._sun = s;
      this._pushLight();
    });
    this._pushLight();
  }

  _pushLight() {
    updateFlatShared({
      sun: this._sun?.toLight,
      level: this._sun?.relativeIntensity ?? 1,
      exposure: this.kernel.renderer.toneMappingExposure,
    });
  }

  // -------------------------------------------------------------------------- helpers

  /** Ground height at a leaf-space point; falls back to the design surface over a hole. */
  groundA(aX, aZ) {
    const [x, z] = W(aX, aZ);
    const y = this.terrain.groundAt(x, z);
    return Number.isFinite(y) ? y : baseY(aX);
  }

  // -------------------------------------------------------------------------- rock

  /**
   * The crest, three hero shards inside forty metres of the spawn, and boulders across the leaf.
   * All of it is `shard()`: big planes meeting at hard edges, which is the only vocabulary the
   * reference draws rock in.
   */
  _composeGround() {
    const spires = [];
    const rock = [];

    // Three shards standing free, close enough to the brow to cut the left edge of the arrival
    // frame. Without a hard silhouette inside forty metres the shot is a landscape photograph
    // and not a place someone is standing in.
    // The first two are inside twenty-five metres of the brow and they are what makes the
    // arrival a *place* rather than a viewpoint: a hard black edge at the left of frame with
    // five hundred metres of lit leaf running out past it. Lethis is down-leaf and to the right,
    // so the faces these turn toward the camera are all shadow side, which is the contrast the
    // reference builds its whole foreground out of.
    const hero = [
      [-190, -26, 16, 64, 71],
      [-208, -46, 10, 40, 72],
      [-166, -50, 8.5, 30, 73],
      [-226, -70, 11, 34, 74],
      [-186, 42, 7, 22, 75],
      [-160, 60, 5, 15, 76],
    ];
    for (const [aX, aZ, r, h, s] of hero) {
      const [x, z] = W(aX, aZ);
      spires.push(
        ...shard({
          x, y: this.groundA(aX, aZ) - 4, z,
          radius: r, height: h, sides: 5, taper: 0.11,
          lean: [-4, -5], rings: [[0.46, 0.86], [0.78, 0.52]], seed: s, jag: 0.4,
        })
      );
    }

    // The crest behind them: eleven more, in three depth ranks, so the left edge has overlap.
    const crestLine = [
      [-282, -140, 28, 58], [-258, -112, 20, 40], [-244, -152, 24, 72],
      [-222, -96, 15, 32], [-208, -132, 22, 60], [-190, -158, 18, 46],
      [-172, -104, 13, 26], [-158, -138, 17, 42], [-140, -164, 15, 34],
      [-126, -108, 11, 22], [-108, -142, 13, 28],
    ];
    crestLine.forEach(([aX, aZ, r, h], i) => {
      const [x, z] = W(aX, aZ);
      spires.push(
        ...shard({
          x, y: this.groundA(aX, aZ) - 5, z,
          radius: r, height: h,
          sides: 5 + (i % 3),
          taper: 0.1 + (i % 4) * 0.06,
          lean: [-3 + (i % 3) * 3, -4 - (i % 5) * 2],
          rings: [[0.42, 0.86], [0.74, 0.5]],
          seed: 200 + i,
          jag: 0.36,
        })
      );
    });

    // A counterweight on the right so the arrival frame is not lopsided, and a marker on the
    // knuckle so the mid-leaf has something to aim at.
    for (const [aX, aZ, r, h, s] of [[-206, 92, 10, 26, 81], [-176, 128, 7, 18, 82], [70, -54, 13, 30, 83], [88, -30, 8, 19, 84]]) {
      const [x, z] = W(aX, aZ);
      spires.push(...shard({ x, y: this.groundA(aX, aZ) - 4, z, radius: r, height: h, sides: 6, taper: 0.14, lean: [3, 4], rings: [[0.5, 0.82]], seed: s, jag: 0.38 }));
    }

    // Boulders. Fewer and bigger than the first pass: at gameplay distance a hundred small
    // shards read as confetti, and the reference's ground is big confident shapes with talus
    // gathered where rock has actually come off a face.
    let placed = 0;
    for (let i = 0; i < 3600 && placed < 62; i++) {
      const aX = -330 + hash2i(i, 1, 5501) * 660;
      const aZ = -226 + hash2i(i, 2, 5502) * 452;
      const [x, z] = W(aX, aZ);
      const y = this.terrain.groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const n = this.terrain.normalAt(x, z);
      const slope = 1 - (n ? n.y : 1);
      // Talus gathers under a face and nowhere else. Sprinkling rock evenly over open ground is
      // the fastest way to turn five hundred metres of readable recession into a gravel pit.
      if (slope < 0.09) continue;
      if (hash2i(i, 3, 5503) > slope * 1.6) continue;
      const r = 1.8 + hash2i(i, 4, 5504) * (2.6 + slope * 9);
      rock.push(
        ...shard({
          x, y: y - r * 0.5, z,
          radius: r,
          height: r * (1.0 + hash2i(i, 5, 5505) * 1.4),
          sides: 4 + (i % 3),
          taper: 0.24 + hash2i(i, 6, 5506) * 0.42,
          lean: [(hash2i(i, 7, 5507) - 0.5) * r, (hash2i(i, 8, 5508) - 0.5) * r],
          seed: 900 + i,
          jag: 0.44,
        })
      );
      placed++;
    }
    this.boulderCount = placed;
    this.spireCount = hero.length + crestLine.length + 4;

    const geo = mergeFacets([
      facetGeometry(new Float32Array(spires), (cx, cy, cz, nx, ny, nz, ti) => this._rockColor(ny, ti)),
      facetGeometry(new Float32Array(rock), (cx, cy, cz, nx, ny, nz, ti) => this._rockColor(ny, ti + 7)),
    ]);
    const mesh = new THREE.Mesh(geo, flatMaterial("level.rock", { litFloor: 0.4 }));
    mesh.name = "vs.level.rock";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.rockMesh = mesh;
    signals.emit("world:collider", { id: "p09:rock", geometry: geo });
  }

  _rockColor(ny, ti) {
    const slope = 1 - clamp01(ny);
    const hex = slope > 0.66 ? PAL.rockSun : slope > 0.3 ? PAL.rockLit : PAL.rockWarm;
    const c = sceneRGB(hex);
    const j = 1 + (hash2i(ti, 3, 77) - 0.5) * 0.13;
    return [c.r * j, c.g * j, c.b * j];
  }

  // -------------------------------------------------------------------------- carries

  _composeCarries() {
    const tris = [];
    for (const c of CARRIES) {
      ribbonTris(
        tris,
        c.pts,
        (t) => c.width * (0.72 + 0.13 * Math.sin(t * 9.1) + 0.07 * Math.sin(t * 21)),
        // The surface sits high in its channel — a carry is syrup-thick and brimming, and a
        // river sunk five metres into a slot is invisible from anywhere but directly above it.
        (aX) => baseY(aX) - 1.5,
        7
      );
    }
    const core = sceneRGB(PAL.carryCore);
    const body = sceneRGB(PAL.carry);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      // A carry is raw quantity. It is its own light source and never takes the key.
      const t = ti % 4 < 2 ? 1 : 0;
      const j = 1 + (hash2i(ti, 11, 313) - 0.5) * 0.1;
      return [lerp(body.r, core.r, t) * j, lerp(body.g, core.g, t) * j, lerp(body.b, core.b, t) * j];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.carry", { unlit: 1 }));
    mesh.name = "vs.level.carries";
    this.root.add(mesh);
    this.carryMesh = mesh;
  }

  // -------------------------------------------------------------------------- structures

  _composeStructures() {
    const bone = [];
    const glass = [];
    const grey = [];

    // --- the Standing House: the one intact structure on Leaf Nine -------------------
    const [hx, hz] = W(-90, -66);
    const hy = this.groundA(-90, -66);
    boxTris(hx, hy - 1.2, hz, 14, 9.5, 21, bone);
    boxTris(hx, hy + 8.3, hz - 1.5, 11, 3.2, 17, bone);
    boxTris(hx, hy + 11.5, hz - 2.5, 7, 2.2, 11, bone);
    boxTris(hx + 4, hy - 1.2, hz - 13, 8, 4.4, 7, bone); // the wing still standing
    // The collapsed wing: unproven, not weathered — blocks lying where the claim stopped.
    for (let i = 0; i < 11; i++) {
      const aX = -76 + hash2i(i, 1, 8801) * 18;
      const aZ = -56 + hash2i(i, 2, 8802) * 16;
      const [bx, bz] = W(aX, aZ);
      boxTris(bx, this.groundA(aX, aZ) - 0.4, bz, 2 + hash2i(i, 3, 8803) * 3.2, 1.2 + hash2i(i, 4, 8804) * 2.6, 2 + hash2i(i, 5, 8805) * 3.2, bone);
    }
    // The socket: a stone cradle with the claim standing above it. P19 fills the air; the
    // cradle is level geometry, because a socket is a place.
    const [sx0, sz0] = W(-104, -63);
    const sy0 = this.groundA(-104, -63);
    boxTris(sx0, sy0 - 0.6, sz0, 5.5, 1.5, 5.5, bone);
    boxTris(sx0, sy0 + 0.9, sz0, 3.4, 0.7, 3.4, bone);

    // --- the Bollard, in the head bowl: one end of a body six hundred metres long ------
    const [bx1, bz1] = W(-300, 34);
    archTris(glass, { x: bx1, y: this.groundA(-300, 34) - 1.5, z: bz1, span: 28, height: 14, thick: 4.4, depth: 5.8, rot: 1.9, segs: 9 });

    // --- the Second Lip, past the ravine: the other end of the same body ---------------
    const [bx2, bz2] = W(268, 26);
    archTris(glass, { x: bx2, y: this.groundA(268, 26) - 1.5, z: bz2, span: 25, height: 13, thick: 4.1, depth: 5.4, rot: 1.2, segs: 9 });

    // --- the thing above the certainty field --------------------------------------------
    // House-sized, on the ridge, with an open socket in it and a working standing beside it.
    // Not a puzzle, not an animal, not a ruin, and nobody on the leaf finds it worth mentioning.
    for (const [dX, dZ, r, h, sd] of [[0, 0, 8, 13, 41], [5, 5, 5.4, 9, 42], [-6, 4, 4.6, 10, 43], [2, -7, 6, 7, 44]]) {
      const [tx, tz] = W(268 + dX, -150 + dZ);
      glass.push(...shard({ x: tx, y: this.groundA(268 + dX, -150 + dZ) - 2, z: tz, radius: r, height: h, sides: 6, taper: 0.42, lean: [2, -1], rings: [[0.55, 0.9]], seed: sd, jag: 0.3 }));
    }

    // --- Ondu's props: four greyed roofs kept up with stacked certainties --------------
    for (const [aX, aZ, w] of [[-40, 46, 6], [-4, 64, 5], [42, 34, 5.5], [16, -28, 4.5]]) {
      const [px, pz] = W(aX, aZ);
      const py = this.groundA(aX, aZ);
      boxTris(px, py - 0.4, pz, w, 0.7, w * 0.8, grey);
      boxTris(px, py + 3.4, pz, w * 1.15, 0.9, w * 0.95, grey);
      boxTris(px - w * 0.35, py, pz, 0.7, 3.4, 0.7, grey);
      boxTris(px + w * 0.35, py, pz, 0.7, 3.4, 0.7, grey);
    }

    const geo = mergeFacets([
      facetGeometry(new Float32Array(bone), (cx, cy, cz, nx, ny, nz, ti) => this._tinted(PAL.bone, PAL.boneDark, ny, ti)),
      facetGeometry(new Float32Array(glass), (cx, cy, cz, nx, ny, nz, ti) => this._tinted(PAL.glass, 0x141b21, ny, ti)),
      facetGeometry(new Float32Array(grey), (cx, cy, cz, nx, ny, nz, ti) => this._tinted(PAL.greyProp, 0x3d3d38, ny, ti)),
    ]);
    const mesh = new THREE.Mesh(geo, flatMaterial("level.built", { litFloor: 0.46 }));
    mesh.name = "vs.level.built";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.builtMesh = mesh;
    signals.emit("world:collider", { id: "p09:built", geometry: geo });
  }

  _tinted(litHex, darkHex, ny, ti) {
    const a = sceneRGB(litHex);
    const b = sceneRGB(darkHex);
    const t = clamp01(0.5 - ny * 0.5);
    const j = 1 + (hash2i(ti, 5, 611) - 0.5) * 0.1;
    return [lerp(a.r, b.r, t) * j, lerp(a.g, b.g, t) * j, lerp(a.b, b.b, t) * j];
  }

  // -------------------------------------------------------------------------- certainties

  /**
   * The certainty field: the crystal meadow on the low end, and the prettiest place the player
   * has been. Cyan is the only saturated accent in this world, so it is spent here, on the
   * carries, and nowhere else.
   */
  _composeCertainties() {
    const tris = [];
    let clusters = 0;
    for (let i = 0; i < 1200 && clusters < 90; i++) {
      const aX = 202 + hash2i(i, 1, 7001) * 122;
      const aZ = -96 + hash2i(i, 2, 7002) * 252;
      const [x, z] = W(aX, aZ);
      const y = this.terrain.groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const n = this.terrain.normalAt(x, z);
      if (!n || n.y < 0.8) continue;
      const big = hash2i(i, 3, 7003);
      const count = 2 + Math.floor(hash2i(i, 4, 7004) * 4);
      for (let k = 0; k < count; k++) {
        // Person-sized, not building-sized. A certainty is the most beautiful object in the
        // world and the only saturated accent in the palette, and thirty-metre ones turn the
        // low end of the leaf into a fence.
        const r = 0.32 + hash2i(i, 10 + k, 7005) * (0.5 + big * 0.85);
        const h = r * (2.6 + hash2i(i, 20 + k, 7006) * 3.0);
        const [cx, cz] = W(aX + (hash2i(i, 30 + k, 7007) - 0.5) * 6, aZ + (hash2i(i, 40 + k, 7008) - 0.5) * 6);
        tris.push(
          ...shard({
            x: cx, y: y - r * 0.4, z: cz,
            radius: r, height: h, sides: 5, taper: 0.14,
            lean: [(hash2i(i, 50 + k, 7009) - 0.5) * h * 0.3, (hash2i(i, 60 + k, 7010) - 0.5) * h * 0.3],
            seed: 3000 + i * 7 + k, jag: 0.1,
          })
        );
      }
      clusters++;
    }
    // A few certainties standing on the old claim lines up-leaf, so the field is something the
    // horizon has been promising for four hundred metres rather than a surprise.
    for (const [aX, aZ, r, h] of [[-38, -20, 1.4, 6], [30, 10, 1.1, 4.6], [-116, 26, 1.0, 4], [98, -46, 1.5, 6.4], [-186, 66, 0.9, 3.6]]) {
      const [x, z] = W(aX, aZ);
      tris.push(...shard({ x, y: this.groundA(aX, aZ) - 0.8, z, radius: r, height: h, sides: 5, taper: 0.15, lean: [0.6, -0.4], seed: 5100 + Math.abs(aX), jag: 0.12 }));
    }
    this.certaintyClusters = clusters;

    const hot = sceneRGB(PAL.crystalHot);
    const face = sceneRGB(PAL.crystal);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      const t = clamp01(0.25 + ny * 0.75) * (0.55 + hash2i(ti, 9, 431) * 0.45);
      return [lerp(face.r, hot.r, t), lerp(face.g, hot.g, t), lerp(face.b, hot.b, t)];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.certainty", { unlit: 0.76, litFloor: 0.7 }));
    mesh.name = "vs.level.certainties";
    this.root.add(mesh);
    this.certaintyMesh = mesh;
  }

  // -------------------------------------------------------------------------- archipelago

  /** One floating leaf: flat on top because that was the surface, ragged under because that is a fracture. */
  _leafSolid(out, { x, y, z, radius, thick, sides = 9, seed = 1, sag = 1 }) {
    const top = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const r = radius * (0.72 + hash2i(i, 1, seed) * 0.46);
      top.push([x + Math.cos(a) * r, y + (hash2i(i, 2, seed) - 0.5) * radius * 0.05, z + Math.sin(a) * r]);
    }
    const centreTop = [x, y + radius * 0.03, z];
    const keel = [x + (hash2i(0, 9, seed) - 0.5) * radius * 0.3, y - thick * sag, z + (hash2i(1, 9, seed) - 0.5) * radius * 0.3];
    const mid = top.map((p) => [
      lerp(p[0], keel[0], 0.42),
      lerp(p[1], keel[1], 0.23) - thick * 0.12,
      lerp(p[2], keel[2], 0.42),
    ]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      pushTri(out, centreTop, top[i], top[j]);
      pushTri(out, top[i], mid[i], top[j]);
      pushTri(out, top[j], mid[i], mid[j]);
      pushTri(out, mid[i], keel, mid[j]);
    }
    return out;
  }

  _composeArchipelago() {
    const tris = [];
    const s = this.nearScale;
    // Distance, bearing off down-leaf, radius, thickness, height above the leaf's own plane.
    // Distance, bearing, radius, thickness, height, id, keel sag. The sag column is what stops
    // eight floating leaves reading as eight identical flying saucers: a thin plate, a blunt
    // wedge and a deep keel are three different silhouettes at thumbnail size.
    const leaves = [
      [430, -0.34, 62, 46, 40, "leaf.nine.also", 1.0],
      [560, 0.24, 44, 26, 96, "leaf.small.a", 0.35],
      [640, -0.74, 92, 88, -20, "leaf.small.b", 1.25],
      [720, 0.66, 58, 40, 140, "leaf.small.c", 0.6],
      [830, -0.12, 130, 84, 74, "leaf.forty", 1.15],
      [880, 0.98, 76, 40, 4, "leaf.small.d", 0.3],
      [960, -0.55, 104, 96, 162, "leaf.small.e", 1.3],
      [1020, 0.38, 88, 52, 36, "leaf.small.f", 0.7],
    ];
    this.nearLeaves = [];
    leaves.forEach(([dist, bearing, radius, thick, height, id, sag], i) => {
      const d = dist * s;
      const aX = 60 + Math.cos(bearing) * d;
      const aZ = Math.sin(bearing) * d * 1.1;
      const [x, z] = W(aX, aZ);
      const y = baseY(aX) + height * s;
      this._leafSolid(tris, { x, y, z, radius: radius * s, thick: thick * s, sides: 7 + (i % 4), seed: 400 + i, sag });
      this.nearLeaves.push({ id, x: Math.round(x), y: Math.round(y), z: Math.round(z), radius: Math.round(radius * s) });
      // Two of them carry a certainty crest, so the archipelago is not eight grey pebbles.
      if (i % 3 === 0) {
        for (let k = 0; k < 5; k++) {
          const cr = radius * s * 0.07;
          tris.push(...shard({
            x: x + (hash2i(i, k, 611) - 0.5) * radius * s,
            y,
            z: z + (hash2i(i, k, 612) - 0.5) * radius * s,
            radius: cr, height: cr * 5.5, sides: 5, taper: 0.15, seed: 700 + i * 5 + k, jag: 0.1,
          }));
        }
      }
    });

    const stone = sceneRGB(PAL.farStone);
    const under = sceneRGB(PAL.underLit);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      const t = clamp01(0.5 - ny * 0.5);
      const j = 1 + (hash2i(ti, 13, 811) - 0.5) * 0.1;
      return [lerp(stone.r, under.r, t) * j, lerp(stone.g, under.g, t) * j, lerp(stone.b, under.b, t) * j];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.archipelago", { litFloor: 0.5, shade: 0.7 }));
    mesh.name = "vs.level.archipelago";
    this.root.add(mesh);
    this.archipelagoMesh = mesh;
  }

  // -------------------------------------------------------------------------- the horizon

  /**
   * Everything past the archipelago: Vantis across the Long Division, and the named leaves from
   * world.md §3's horizon table. All of it is a question and none of it is answered in Level 1.
   */
  _composeBackdrop() {
    const tris = [];

    // --- Vantis. Towers rise four hundred metres and then simply stop, at the exact height
    //     where their claim went false. One quarter — the Remainder — is untouched, for
    //     embarrassing reasons. Between it and you is eleven kilometres of Long Division.
    const vd = 10800;
    const [vx, vz] = W(vd * 0.985, -vd * 0.16);
    const plateY = baseY(0) - 150;
    this._leafSolid(tris, { x: vx, y: plateY, z: vz, radius: 2500, thick: 950, sides: 11, seed: 31 });
    let vantisTowers = 0;
    for (let i = 0; i < 110; i++) {
      const u = hash2i(i, 1, 9101);
      const v = hash2i(i, 2, 9102);
      const remainder = u > 0.8;
      if (!remainder && hash2i(i, 7, 9107) < 0.17) continue; // a district that is simply missing
      const w = 46 + hash2i(i, 3, 9103) * 120;
      const stops = hash2i(i, 4, 9104);
      const h = remainder ? 260 + stops * 320 : 130 + stops * 500;
      boxTris(vx + (u - 0.5) * 2400, plateY + 60, vz + (v - 0.5) * 3400, w, h, w * (0.7 + hash2i(i, 5, 9105) * 0.6), tris);
      vantisTowers++;
    }
    this.vantisTowers = vantisTowers;

    // --- the named horizon leaves (world.md §3) -------------------------------------------
    const horizon = [
      ["leaf.twohundredsix", 9400, 0.60, 920, 150, 280, 0.3],
      ["kiln.six", 9900, -0.60, 300, 210, 470, 1],
      ["kiln.seven", 10200, -0.70, 250, 180, 400, 1],
      ["kiln.eight", 10500, -0.52, 220, 160, 520, 1],
      ["leaf.one", 11300, 0.14, 640, 430, 760, 1],
      ["leaf.far.a", 8700, 1.18, 430, 300, 220, 1],
      ["leaf.far.b", 9500, -1.28, 380, 260, 340, 1],
    ];
    this.horizonLeaves = [];
    horizon.forEach(([id, dist, bearing, radius, thick, height, sag], i) => {
      const [x, z] = W(Math.cos(bearing) * dist, Math.sin(bearing) * dist);
      const y = baseY(0) + height;
      this._leafSolid(tris, { x, y, z, radius, thick, sides: 9 + (i % 3), seed: 500 + i, sag });
      this.horizonLeaves.push({ id, dist, bearing: Number(bearing.toFixed(2)) });
    });
    // The Bell of the Quorum, slung under Leaf One. It rings once in Beat 4 and the whole Margin
    // hears it; from here it is a dark mass hanging under a dark leaf, and that is enough.
    const [b1, b3] = W(Math.cos(0.14) * 11300, Math.sin(0.14) * 11300);
    boxTris(b1, baseY(0) + 760 - 700, b3, 190, 300, 190, tris);

    const stone = sceneRGB(PAL.vantis);
    const under = sceneRGB(0x8a7154);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      const t = clamp01(0.5 - ny * 0.5);
      const j = 1 + (hash2i(ti, 17, 911) - 0.5) * 0.08;
      return [lerp(stone.r, under.r, t) * j, lerp(stone.g, under.g, t) * j, lerp(stone.b, under.b, t) * j];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.backdrop", { litFloor: 0.62, shade: 0.5, distance: this.farK, hazeBias: 0.04 }));
    mesh.name = "vs.level.vantis";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.far.add(mesh);
    this.backdropMesh = mesh;
    this.far.scale.setScalar(1 / this.farK);
  }

  // -------------------------------------------------------------------------- anchors

  /**
   * Anchor points, published rather than hard-coded elsewhere. §2.1 rule 1: the far pan is
   * measured, never authored — so the span's gap is read off the finished terrain here and no
   * other piece ever types the right-hand quantity of a claim.
   */
  _setAnchors() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const at = (aX, aZ, lift = 0) => {
      const [x, z] = W(aX, aZ);
      return { x: r2(x), y: r2(this.groundA(aX, aZ) + lift), z: r2(z), leaf: [aX, aZ] };
    };

    // The span the level is built around: across the ravine, near lip to far lip, measured.
    const spanZ = 20;
    let nearX = 120;
    for (let aX = 120; aX < 230; aX += 0.4) {
      const [x, z] = W(aX, spanZ);
      if (!this.terrain.isSolid(x, z)) { nearX = aX - 0.4; break; }
    }
    let farX = nearX + 10;
    for (let aX = nearX + 3; aX < 300; aX += 0.4) {
      const [x, z] = W(aX, spanZ);
      if (this.terrain.isSolid(x, z)) { farX = aX; break; }
    }

    this.anchors = {
      spawn: at(-216, 10, 1.7),
      brow: at(-216, 10),
      bollard: at(-300, 34),
      barge: at(-296, 74),
      kindness: at(-266, 116),
      standingHouse: at(-90, -66),
      standingHouseSocket: at(-104, -63, 1.6),
      weir: at(-30, 78),
      terrace: at(24, 20),
      knuckle: at(66, -52),
      spanNear: at(nearX - 1.5, spanZ),
      spanFar: at(farX + 1.5, spanZ),
      secondLip: at(268, 26),
      certaintyField: at(258, 30),
      ridgeThing: at(268, -150),
      edgewake: at(298, 110),
      lowLip: at(318, 40),
      cutters: at(296, -66),
    };
    const near = this.anchors.spanNear;
    const far = this.anchors.spanFar;
    this.anchors.span = {
      near,
      far,
      // Measured off the terrain, not typed. A level designer digs the hole; the claim reads it.
      gap: r2(Math.hypot(far.x - near.x, far.z - near.z)),
      drop: r2(far.y - near.y),
    };
    this.anchors.vantis = { bearing: r2(Math.atan2(-10800 * 0.16, 10800 * 0.985)), distance: 10800 };
  }

  // -------------------------------------------------------------------------- kernel hooks

  fixed() {
    if (this._spawned) return;
    this._spawned = true;
    // Re-send the solid props' colliders now that every system exists — see Terrain._emitCollider
    // for why a collider emitted at boot order 10 is a collider nobody hears.
    if (this.rockMesh) signals.emit("world:collider", { id: "p09:rock", geometry: this.rockMesh.geometry });
    if (this.builtMesh) signals.emit("world:collider", { id: "p09:built", geometry: this.builtMesh.geometry });
    // Locomotion mounts after the world and has already run its own ring search by now. Placing
    // the player is level design, not a fallback: the arrival frame is authored, and it is the brow.
    const s = this.anchors.spawn;
    signals.emit("player:spawn", { position: { x: s.x, y: s.y, z: s.z }, heading: [0, -1] });
  }

  after() {
    // Keep the compressed backdrop projectively identical to its true position, whatever the
    // camera does: p_render = cam + (p_true − cam)/k, for every point, exactly.
    const c = this.kernel.camera.position;
    const f = 1 - 1 / this.farK;
    this.far.position.set(c.x * f, c.y * f, c.z * f);
    this._pushLight();
  }

  snapshot() {
    const tris = (m) => (m ? m.geometry.getAttribute("position").count / 3 : 0);
    return {
      id: LEAF.id,
      downLeaf: [0, 0, -1],
      anchors: this.anchors,
      carries: CARRIES.map((c) => ({ id: c.id, uphill: !!c.uphill })),
      landmarks: {
        spires: this.spireCount,
        boulders: this.boulderCount,
        certaintyClusters: this.certaintyClusters,
        vantisTowers: this.vantisTowers,
        nearLeaves: this.nearLeaves.length,
        horizonLeaves: this.horizonLeaves.length,
      },
      backdrop: { compression: Number(this.farK.toFixed(2)), nearScale: Number(this.nearScale.toFixed(3)) },
      triangles: {
        rock: tris(this.rockMesh),
        carries: tris(this.carryMesh),
        built: tris(this.builtMesh),
        certainties: tris(this.certaintyMesh),
        archipelago: tris(this.archipelagoMesh),
        backdrop: tris(this.backdropMesh),
      },
      sun: this._sun ? { toLight: this._sun.toLight, level: this._sun.relativeIntensity } : null,
    };
  }

  dispose() {
    this._offSun?.();
    signals.emit("world:collider", { id: "p09:rock", remove: true });
    signals.emit("world:collider", { id: "p09:built", remove: true });
    for (const m of [this.rockMesh, this.carryMesh, this.builtMesh, this.certaintyMesh, this.archipelagoMesh, this.backdropMesh]) {
      m?.geometry.dispose();
    }
  }
}

export { W as leafToWorld, A as worldToLeaf, baseY as leafBaseHeight };
