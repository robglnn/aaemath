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
 * **The frame.** The player arrives at the head and spawns on the brow — the highest walkable
 * point — looking down the whole length of the leaf. From there, in one frame: angular spires
 * cutting the left edge at twenty metres; the Standing House on its shelf at a hundred and sixty;
 * three carries winding down and one of them climbing back up; a ravine at three hundred and
 * eighty that goes clean through the leaf, with sky underneath it; the certainty field glowing on
 * the far shard at five hundred; and eleven kilometres out, across the Long Division, Vantis, with
 * towers that stop in mid-air. Five landmarks, five distance bands, five silhouettes that survive
 * being shrunk to a thumbnail.
 *
 * **The rules this file is held to.**
 *
 *  - *There is no ground underneath.* (world.md §2.3.) Below a leaf is not a lower level; it is
 *    the place where things stopped being true. The ravine is therefore a hole with sky in it, the
 *    lip is a fracture, and no piece of geometry in this file is a valley floor.
 *  - *The Bollard and the Second Lip are the two ends of one body, six hundred metres apart, and
 *    no camera framing may ever contain both.* (§3, §12.) That is not enforced by a rule in a
 *    document — it is enforced by the head brow, which stands between the head bowl and the rest
 *    of the leaf, and `review/measure/P09.mjs` sweeps every reachable camera to prove it.
 *  - *The far pan is measured, never authored.* (§2.1 rule 1.) This file digs the hole; the claim
 *    reads the geometry. Every gap a claim will be asked to span is published as an anchor pair
 *    with its measured distance, so no other piece ever types a right-hand quantity.
 *
 * Anchors are published through the `level` probe rather than hard-coded anywhere else, so P13,
 * P19, P23 and P26 can place a barge, a weir, a socket or a span without importing this file or
 * agreeing a magic number with it.
 */

// ---------------------------------------------------------------------------- the leaf's shape

const TILT = Math.tan((7 * Math.PI) / 180); // world.md §10: "tilted about 7°"
const baseY = (x) => 12 - TILT * x;

/** Soft-edged rectangle in XZ — the level's only shaping primitive, used for every pad and brow. */
function pad(x, z, x0, x1, z0, z1, f) {
  return (
    smoothstep(x0 - f, x0 + f, x) *
    (1 - smoothstep(x1 - f, x1 + f, x)) *
    smoothstep(z0 - f, z0 + f, z) *
    (1 - smoothstep(z1 - f, z1 + f, z))
  );
}

/**
 * The three carries. Rivers of unresolved value, luminous teal, flowing toward whatever is nearly
 * true — which is why the middle one runs *uphill*, from the east lip up to the Standing House
 * claim. Nothing in the game explains that and nothing is allowed to.
 */
export const CARRIES = [
  {
    id: "carry.low",
    width: 15,
    depth: 4.6,
    pts: [[-306, -92], [-232, -74], [-150, -58], [-64, -40], [24, -24], [104, -8], [152, 2]],
  },
  {
    id: "carry.middle",
    width: 13,
    depth: 3.8,
    uphill: true,
    pts: [[168, 132], [96, 116], [30, 98], [-36, 76], [-96, 54], [-134, 30], [-152, 16]],
  },
  {
    id: "carry.high",
    width: 12,
    depth: 4.0,
    pts: [[-268, 108], [-190, 134], [-96, 144], [0, 136], [86, 122], [148, 106]],
  },
  {
    id: "carry.field",
    width: 11,
    depth: 3.4,
    pts: [[202, 58], [238, 84], [274, 116], [312, 152]],
  },
];

/** Where the ravine's centreline sits at a given z. It wanders, because a fracture is not a saw cut. */
const ravineCentre = (z) => 158 + 30 * Math.sin(z * 0.0122) + 15 * Math.sin(z * 0.031 + 2.0);
const ravineHalf = (z) => 22 + 9 * Math.sin(z * 0.0185 + 1.1) + 5 * Math.sin(z * 0.047);

export const LEAF = {
  id: "leaf-nine",
  bounds: { x0: -336, x1: 350, z0: -232, z1: 232 },
  cell: 6,
  seed: 90210,

  /**
   * The authored half of the terrain: base height, whether the leaf exists here, how much noise it
   * is allowed, and what class of surface it is. Terrain.js owns everything after this.
   */
  design(x, z, out) {
    let h = baseY(x);
    let protect = 0;
    let rough = 1;
    let mat = 0;
    let thick = 1;

    // --- outline: an ellipse gone lumpy. A leaf is a fracture, not a plate. ------------
    const ang = Math.atan2(z, x);
    const wob =
      fbm(Math.cos(ang) * 2.1, Math.sin(ang) * 2.1, 771, 4) * 46 +
      fbm(Math.cos(ang) * 5.4, Math.sin(ang) * 5.4, 913, 3) * 17;
    const rr = Math.hypot(x / 320, z / 198);
    let mask = rr < 1 + wob / 330 ? 1 : 0;

    // --- the ravine: it goes clean through, and there is sky under it -----------------
    if (Math.abs(x - ravineCentre(z)) < ravineHalf(z)) mask = 0;

    // --- the head: a bowl behind a brow ------------------------------------------------
    // The brow is the hero vantage AND the reason the Bollard is never in the same shot as
    // the Second Lip. It is load-bearing twice over.
    const bowl = pad(x, z, -336, -262, -140, 165, 24);
    h = lerp(h, 40.5, bowl * 0.95);
    protect = Math.max(protect, bowl * 0.9);
    const brow = pad(x, z, -258, -204, -160, 172, 20);
    h += brow * 12.5;
    protect = Math.max(protect, brow * 0.5);

    // --- the crest: the angular spires that frame the left of every arrival shot -------
    const crest = pad(x, z, -304, -118, -218, -74, 32);
    h += crest * (10 + ridged(x * 0.0195, z * 0.0195, 401, 3) * 46);
    rough = lerp(rough, 2.4, crest);

    // --- the Standing House shelf --------------------------------------------------------
    const shelf = pad(x, z, -130, -50, -114, -28, 15);
    h = lerp(h, baseY(-90) + 2.0, shelf);
    protect = Math.max(protect, shelf);
    if (shelf > 0.5) mat = 4;

    // --- the middle terrace: where the leaf opens out and the traffic crosses ----------
    const terrace = pad(x, z, -34, 74, -74, 96, 24);
    h = lerp(h, baseY(20) - 1.2, terrace * 0.85);
    protect = Math.max(protect, terrace * 0.8);

    // --- a shoulder on the right, so the leaf is not a ramp -----------------------------
    const shoulder = pad(x, z, -140, 40, 120, 210, 30);
    h += shoulder * 16;
    rough = lerp(rough, 1.5, shoulder);

    // --- the far shard: the certainty field, and the ridge that stands over it ---------
    const field = pad(x, z, 190, 322, -100, 158, 28);
    h = lerp(h, baseY(258) - 4.5, field * 0.92);
    protect = Math.max(protect, field * 0.86);
    if (field > 0.4) mat = 3;
    const ridgeF = pad(x, z, 206, 336, -216, -86, 26);
    h += ridgeF * 27;
    rough = lerp(rough, 1.7, ridgeF);
    const rim = pad(x, z, 296, 352, -232, 232, 18);
    h += rim * 9;

    // --- the carries: troughs, protected so noise cannot break a river ----------------
    for (const c of CARRIES) {
      const { d } = distToPolyline(x, z, c.pts);
      if (d > c.width * 2.4) continue;
      const w = 1 - smoothstep(c.width * 0.65, c.width * 2.1, d);
      const floor = baseY(x) - c.depth;
      h = lerp(h, Math.min(h, floor), w * 0.95);
      protect = Math.max(protect, w * 0.9);
      if (w > 0.25) mat = 2;
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
    // In-plane normal = tangent × depth axis.
    let nx2 = ty * wz - tz * 0;
    let ny2 = tz * wx - tx * wz;
    let nz2 = tx * 0 - ty * wx;
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

/** A ribbon of faceted quads along a polyline — a carry's surface. */
function ribbonTris(out, pts, widthAt, yAt, along = 5) {
  const samples = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const steps = Math.max(6, Math.round(total / along));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const d = t * total;
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
    const w = widthAt(t) * 0.5;
    samples.push({ px, pz, nx: -dz * w, nz: dx * w, t });
  }
  for (let s = 0; s < samples.length - 1; s++) {
    const a = samples[s];
    const b = samples[s + 1];
    const mid = (p, sign) => [p.px + p.nx * sign, yAt(p.px, p.pz, p.t), p.pz + p.nz * sign];
    const a0 = mid(a, -1);
    const a1 = mid(a, 1);
    const b0 = mid(b, -1);
    const b1 = mid(b, 1);
    // Split down the middle so the ribbon has a lit core stripe and two darker banks.
    const am = [(a0[0] + a1[0]) / 2, a0[1] + 0.12, (a0[2] + a1[2]) / 2];
    const bm = [(b0[0] + b1[0]) / 2, b0[1] + 0.12, (b0[2] + b1[2]) / 2];
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
    this.farK = Math.max(3, 11000 / (drawDistance * 0.78));
    this.nearScale = clamp(drawDistance / 1400, 0.35, 1);

    this.far = new THREE.Group();
    this.far.name = "vs.level01.backdrop";
    this.far.matrixAutoUpdate = true;
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
      updateFlatShared({ sun: s?.toLight, level: s?.relativeIntensity ?? 1, exposure: kernel.renderer.toneMappingExposure });
    });
  }

  // -------------------------------------------------------------------------- ground furniture

  /** Height of the leaf at (x,z); falls back to the design surface where the mesh has a hole. */
  ground(x, z) {
    const y = this.terrain.groundAt(x, z);
    return Number.isFinite(y) ? y : baseY(x);
  }

  /**
   * The crest, the talus below it, and boulders across the whole leaf. All of it is `shard()`:
   * big planes meeting at hard edges, which is the only vocabulary the reference draws rock in.
   */
  _composeGround() {
    const spires = [];
    const rock = [];

    // The crest — fourteen shards along the left of the head, in three depth ranks so the
    // silhouette has overlap and the frame has a foreground, not a wall.
    const crestLine = [
      [-286, -186, 30, 62], [-262, -160, 22, 44], [-246, -196, 26, 78],
      [-224, -142, 17, 36], [-212, -178, 24, 66], [-196, -206, 20, 50],
      [-186, -150, 14, 29], [-172, -182, 19, 46], [-158, -134, 12, 24],
      [-150, -172, 16, 38], [-134, -196, 18, 44], [-126, -146, 11, 22],
      [-108, -170, 13, 27], [-96, -198, 15, 33],
    ];
    crestLine.forEach(([x, z, r, h], i) => {
      const g = this.ground(x, z);
      spires.push(
        ...shard({
          x, y: g - 4, z,
          radius: r,
          height: h,
          sides: 5 + (i % 3),
          taper: 0.1 + (i % 4) * 0.06,
          lean: [4 + (i % 5) * 2.5, -3 + (i % 3) * 3],
          rings: [[0.42, 0.86], [0.74, 0.5]],
          seed: 200 + i,
          jag: 0.36,
        })
      );
    });

    // Two hero shards standing free of the ridge, close to the spawn, so the arrival frame has
    // something with a hard edge inside twenty-five metres. Without these the composition has no
    // foreground and every shot reads as a landscape photograph.
    for (const [x, z, r, h, s] of [[-236, -104, 12, 44, 61], [-220, -126, 8, 27, 62], [-252, -86, 6, 17, 63]]) {
      spires.push(
        ...shard({ x, y: this.ground(x, z) - 3, z, radius: r, height: h, sides: 5, taper: 0.12, lean: [5, -6], rings: [[0.5, 0.8]], seed: s, jag: 0.4 })
      );
    }

    // Boulders and talus. Density follows slope: debris gathers where rock has come off.
    let placed = 0;
    for (let i = 0; i < 1400 && placed < 230; i++) {
      const x = -330 + hash2i(i, 1, 5501) * 676;
      const z = -228 + hash2i(i, 2, 5502) * 456;
      const y = this.terrain.groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const n = this.terrain.normalAt(x, z);
      const slope = 1 - (n ? n.y : 1);
      const keep = hash2i(i, 3, 5503) < 0.16 + slope * 2.4;
      if (!keep) continue;
      const r = 0.9 + hash2i(i, 4, 5504) * (2.4 + slope * 7);
      rock.push(
        ...shard({
          x, y: y - r * 0.45, z,
          radius: r,
          height: r * (1.1 + hash2i(i, 5, 5505) * 1.5),
          sides: 4 + (i % 3),
          taper: 0.25 + hash2i(i, 6, 5506) * 0.4,
          lean: [(hash2i(i, 7, 5507) - 0.5) * r, (hash2i(i, 8, 5508) - 0.5) * r],
          seed: 900 + i,
          jag: 0.42,
        })
      );
      placed++;
    }
    this.boulderCount = placed;

    const geo = mergeFacets([
      facetGeometry(new Float32Array(spires), (cx, cy, cz, nx, ny) => this._rockColor(cx, cy, cz, ny, 3)),
      facetGeometry(new Float32Array(rock), (cx, cy, cz, nx, ny, nz, ti) => this._rockColor(cx, cy, cz, ny, ti)),
    ]);
    const mesh = new THREE.Mesh(geo, flatMaterial("level.rock", { litFloor: 0.4 }));
    mesh.name = "vs.level.rock";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.rockMesh = mesh;
  }

  _rockColor(x, y, z, ny, ti) {
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
        (t) => c.width * (0.62 + 0.3 * Math.sin(t * 9.1) * 0.5 + 0.15 * Math.sin(t * 21)),
        (x, z) => baseY(x) - c.depth + 1.15,
        5.5
      );
    }
    const core = sceneRGB(PAL.carryCore);
    const body = sceneRGB(PAL.carry);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      // Alternating facets along the ribbon: a bright core lane and cooler banks. A carry is
      // raw quantity, so it is its own light source and never takes the key.
      const t = ti % 4 < 2 ? 1 : 0;
      const j = 1 + (hash2i(ti, 11, 313) - 0.5) * 0.1;
      return [
        lerp(body.r, core.r, t) * j,
        lerp(body.g, core.g, t) * j,
        lerp(body.b, core.b, t) * j,
      ];
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
    const hx = -90;
    const hz = -72;
    const hy = this.ground(hx, hz);
    boxTris(hx, hy - 1.2, hz, 21, 9.5, 14, bone);
    boxTris(hx - 1.5, hy + 8.3, hz, 17, 3.2, 11, bone);
    boxTris(hx - 2.5, hy + 11.5, hz, 11, 2.2, 7, bone);
    boxTris(hx + 13, hy - 1.2, hz + 4, 7, 4.4, 8, bone); // the wing that is still standing
    // The collapsed wing: unproven, not weathered. Blocks lying where the claim stopped.
    for (let i = 0; i < 9; i++) {
      const bx = hx + 12 + hash2i(i, 1, 8801) * 16;
      const bz = hz - 12 - hash2i(i, 2, 8802) * 12;
      boxTris(bx, this.ground(bx, bz) - 0.4, bz, 2 + hash2i(i, 3, 8803) * 3, 1.2 + hash2i(i, 4, 8804) * 2.4, 2 + hash2i(i, 5, 8805) * 3, bone);
    }
    // The socket: a stone cradle with the claim standing above it. P19 fills the air; the
    // cradle is level geometry because a socket is a place.
    boxTris(hx - 14, hy - 0.6, hz + 3, 5.5, 1.5, 5.5, bone);
    boxTris(hx - 14, hy + 0.9, hz + 3, 3.4, 0.7, 3.4, bone);

    // --- the Bollard, in the head bowl: one end of a body six hundred metres long ------
    const bx = -300;
    const bz = 34;
    const by = this.ground(bx, bz);
    archTris(glass, { x: bx, y: by - 1.5, z: bz, span: 26, height: 13.5, thick: 4.2, depth: 5.6, rot: 0.5, segs: 9 });

    // --- the Second Lip, past the ravine: the other end of the same body ---------------
    const sx = 268;
    const sz = 26;
    const sy = this.ground(sx, sz);
    archTris(glass, { x: sx, y: sy - 1.5, z: sz, span: 24, height: 12.5, thick: 4.0, depth: 5.2, rot: -0.35, segs: 9 });

    // --- the thing above the certainty field --------------------------------------------
    // House-sized, on the ridge, with an open socket in it and a working standing beside it.
    // Not a puzzle, not an animal, not a ruin, and nobody on the leaf finds it worth mentioning.
    const tx = 268;
    const tz = -152;
    const ty = this.ground(tx, tz);
    for (const [dx, dz, r, h, sd] of [[0, 0, 7.5, 12, 41], [5, 4, 5, 8.5, 42], [-6, 3, 4.4, 9.5, 43], [1, -6, 5.6, 6.5, 44]]) {
      glass.push(...shard({ x: tx + dx, y: ty - 2, z: tz + dz, radius: r, height: h, sides: 6, taper: 0.42, lean: [2, -1], rings: [[0.55, 0.9]], seed: sd, jag: 0.3 }));
    }

    // --- Ondu's props: four greyed roofs kept up with stacked certainties --------------
    for (const [px, pz, w] of [[-46, 44, 6], [-8, 62, 5], [36, 30, 5.5], [12, -32, 4.5]]) {
      const py = this.ground(px, pz);
      boxTris(px, py - 0.4, pz, w, 0.7, w * 0.8, grey);
      boxTris(px, py + 3.4, pz, w * 1.15, 0.9, w * 0.95, grey);
      boxTris(px - w * 0.35, py, pz, 0.7, 3.4, 0.7, grey);
      boxTris(px + w * 0.35, py, pz, 0.7, 3.4, 0.7, grey);
    }

    const geo = mergeFacets([
      facetGeometry(new Float32Array(bone), (cx, cy, cz, nx, ny, nz, ti) => this._tintedColor(PAL.bone, PAL.boneDark, ny, ti)),
      facetGeometry(new Float32Array(glass), (cx, cy, cz, nx, ny, nz, ti) => this._tintedColor(PAL.glass, 0x141b21, ny, ti)),
      facetGeometry(new Float32Array(grey), (cx, cy, cz, nx, ny, nz, ti) => this._tintedColor(PAL.greyProp, 0x3d3d38, ny, ti)),
    ]);
    const mesh = new THREE.Mesh(geo, flatMaterial("level.built", { litFloor: 0.46 }));
    mesh.name = "vs.level.built";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.builtMesh = mesh;

    signals.emit("world:collider", { id: "p09:built", geometry: geo });
  }

  _tintedColor(litHex, darkHex, ny, ti) {
    const a = sceneRGB(litHex);
    const b = sceneRGB(darkHex);
    const t = clamp01(0.5 - ny * 0.5);
    const j = 1 + (hash2i(ti, 5, 611) - 0.5) * 0.1;
    return [lerp(a.r, b.r, t) * j, lerp(a.g, b.g, t) * j, lerp(a.b, b.b, t) * j];
  }

  // -------------------------------------------------------------------------- certainties

  /**
   * The certainty field: the crystal meadow on the low end, and the prettiest place the player
   * has been. Cyan is the only saturated accent in this world and it is what carries the eye, so
   * it is spent here and at the carries and nowhere else.
   */
  _composeCertainties() {
    const tris = [];
    let clusters = 0;
    for (let i = 0; i < 900 && clusters < 210; i++) {
      const x = 196 + hash2i(i, 1, 7001) * 126;
      const z = -92 + hash2i(i, 2, 7002) * 244;
      const y = this.terrain.groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const n = this.terrain.normalAt(x, z);
      if (!n || n.y < 0.82) continue;
      const big = hash2i(i, 3, 7003);
      const count = 2 + Math.floor(hash2i(i, 4, 7004) * 4);
      for (let k = 0; k < count; k++) {
        const r = 0.35 + hash2i(i, 10 + k, 7005) * (0.5 + big * 1.5);
        const h = r * (3.2 + hash2i(i, 20 + k, 7006) * 4.5);
        tris.push(
          ...shard({
            x: x + (hash2i(i, 30 + k, 7007) - 0.5) * 4.2,
            y: y - r * 0.4,
            z: z + (hash2i(i, 40 + k, 7008) - 0.5) * 4.2,
            radius: r,
            height: h,
            sides: 5,
            taper: 0.14,
            lean: [(hash2i(i, 50 + k, 7009) - 0.5) * h * 0.35, (hash2i(i, 60 + k, 7010) - 0.5) * h * 0.35],
            seed: 3000 + i * 7 + k,
            jag: 0.1,
          })
        );
      }
      clusters++;
    }
    // A few certainties standing along the old claim lines up-leaf, so the field is a place the
    // horizon has been promising rather than a surprise.
    for (const [x, z, r, h] of [[-40, -18, 1.5, 7], [26, 8, 1.2, 5.5], [-118, 24, 1.1, 4.6], [96, -44, 1.6, 8]]) {
      const y = this.ground(x, z);
      tris.push(...shard({ x, y: y - 0.6, z, radius: r, height: h, sides: 5, taper: 0.15, lean: [0.4, -0.3], seed: 5100 + x, jag: 0.12 }));
    }
    this.certaintyClusters = clusters;

    const hot = sceneRGB(PAL.crystalHot);
    const face = sceneRGB(PAL.crystal);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      const t = clamp01(0.25 + ny * 0.75) * (0.55 + hash2i(ti, 9, 431) * 0.45);
      return [lerp(face.r, hot.r, t), lerp(face.g, hot.g, t), lerp(face.b, hot.b, t)];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.certainty", { unlit: 0.78, litFloor: 0.7 }));
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
    const midRing = top.map((p, i) => {
      const t = 0.42;
      return [
        lerp(p[0], keel[0], t),
        lerp(p[1], keel[1], t * 0.55) - thick * 0.12,
        lerp(p[2], keel[2], t),
      ];
    });
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      pushTri(out, centreTop, top[i], top[j]);
      pushTri(out, top[i], midRing[i], top[j]);
      pushTri(out, top[j], midRing[i], midRing[j]);
      pushTri(out, midRing[i], keel, midRing[j]);
    }
    return out;
  }

  _composeArchipelago() {
    const tris = [];
    const s = this.nearScale;
    // Distance band, bearing, radius, thickness, height. Read as: what the leaf poses, and from
    // where. Leaf Nine Also is near and low and keeps the name; the rest recede into haze.
    const leaves = [
      [430, -0.32, 62, 46, 30, "leaf.nine.also"],
      [560, 0.22, 44, 34, 84, "leaf.small.a"],
      [640, -0.72, 92, 70, -34, "leaf.small.b"],
      [720, 0.62, 58, 44, 128, "leaf.small.c"],
      [830, -0.1, 130, 96, 62, "leaf.forty"],
      [880, 0.95, 76, 58, -12, "leaf.small.d"],
      [960, -0.52, 104, 82, 150, "leaf.small.e"],
      [1020, 0.36, 88, 64, 24, "leaf.small.f"],
    ];
    this.nearLeaves = [];
    leaves.forEach(([dist, bearing, radius, thick, height, id], i) => {
      const d = dist * s;
      const x = 40 + Math.cos(bearing) * d;
      const z = Math.sin(bearing) * d * 1.1;
      const y = baseY(x) + height * s;
      this._leafSolid(tris, { x, y, z, radius: radius * s, thick: thick * s, sides: 8 + (i % 3), seed: 400 + i });
      this.nearLeaves.push({ id, x: Math.round(x), y: Math.round(y), z: Math.round(z), radius: Math.round(radius * s) });
      // Two of them carry a certainty crest, so the archipelago is not eight grey pebbles.
      if (i % 3 === 0) {
        for (let k = 0; k < 4; k++) {
          const cr = radius * s * 0.06;
          tris.push(...shard({
            x: x + (hash2i(i, k, 611) - 0.5) * radius * s,
            y,
            z: z + (hash2i(i, k, 612) - 0.5) * radius * s,
            radius: cr, height: cr * 5.5, sides: 5, taper: 0.15, seed: 700 + i * 4 + k, jag: 0.1,
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
    const k = this.farK;
    const tris = [];

    // --- Vantis. Towers rise four hundred metres and then simply stop, at the exact height
    //     where their claim went false. One quarter — the Remainder — is untouched, for
    //     embarrassing reasons.
    const vd = 10600; // the Long Division is eleven kilometres wide and you cannot cross it
    const vx = vd * 0.985;
    const vz = -vd * 0.17;
    const plateY = baseY(0) - 120;
    this._leafSolid(tris, { x: vx, y: plateY, z: vz, radius: 2400, thick: 900, sides: 11, seed: 31 });
    let vantisTowers = 0;
    for (let i = 0; i < 96; i++) {
      const u = hash2i(i, 1, 9101);
      const v = hash2i(i, 2, 9102);
      const remainder = u > 0.78;
      const tx2 = vx + (u - 0.5) * 3600;
      const tz2 = vz + (v - 0.5) * 2200;
      const w = 46 + hash2i(i, 3, 9103) * 110;
      const stops = hash2i(i, 4, 9104);
      const h = remainder ? 240 + stops * 300 : 120 + stops * 470;
      if (!remainder && hash2i(i, 7, 9107) < 0.16) continue; // a district that is simply missing
      boxTris(tx2, plateY + 40, tz2, w, h, w * (0.7 + hash2i(i, 5, 9105) * 0.6), tris);
      vantisTowers++;
    }
    this.vantisTowers = vantisTowers;

    // --- the named horizon leaves (world.md §3) -------------------------------------------
    const horizon = [
      ["leaf.twohundredsix", 9200, 0.62, 900, 150, 240], // one leaf-sized claim, and it is a floor
      ["kiln.six", 9800, -0.62, 300, 210, 420],
      ["kiln.seven", 10100, -0.70, 250, 180, 350],
      ["kiln.eight", 10400, -0.55, 220, 160, 470],
      ["leaf.one", 11200, 0.15, 620, 420, 700],
      ["leaf.small.far", 8600, 1.15, 420, 300, 180],
      ["leaf.small.far2", 9400, -1.25, 380, 260, 300],
    ];
    this.horizonLeaves = [];
    horizon.forEach(([id, dist, bearing, radius, thick, height], i) => {
      const x = Math.cos(bearing) * dist;
      const z = Math.sin(bearing) * dist;
      const y = baseY(0) + height;
      this._leafSolid(tris, { x, y, z, radius, thick, sides: 9 + (i % 3), seed: 500 + i, sag: id === "leaf.twohundredsix" ? 0.35 : 1 });
      this.horizonLeaves.push({ id, dist, bearing: Number(bearing.toFixed(2)) });
    });
    // The Bell of the Quorum, slung under Leaf One. It rings once in Beat 4 and the whole Margin
    // hears it; from here it is a dark mass hanging under a dark leaf, and that is enough.
    const b1 = Math.cos(0.15) * 11200;
    const b3 = Math.sin(0.15) * 11200;
    boxTris(b1, baseY(0) + height0(-520), b3, 180, 300, 180, tris);

    const stone = sceneRGB(PAL.vantis);
    const under = sceneRGB(0x8a7154);
    const geo = facetGeometry(new Float32Array(tris), (cx, cy, cz, nx, ny, nz, ti) => {
      const t = clamp01(0.5 - ny * 0.5);
      const j = 1 + (hash2i(ti, 17, 911) - 0.5) * 0.08;
      return [lerp(stone.r, under.r, t) * j, lerp(stone.g, under.g, t) * j, lerp(stone.b, under.b, t) * j];
    });
    const mesh = new THREE.Mesh(geo, flatMaterial("level.backdrop", { litFloor: 0.62, shade: 0.5, distance: k, hazeBias: 0.05 }));
    mesh.name = "vs.level.vantis";
    this.far.add(mesh);
    this.backdropMesh = mesh;
    this.far.scale.setScalar(1 / k);
  }

  // -------------------------------------------------------------------------- anchors

  /**
   * Anchor points, published rather than hard-coded elsewhere. §2.1 rule 1: the far pan is
   * measured, never authored — so every gap carries its own measured span and no other piece
   * ever types the right-hand quantity of a claim.
   */
  _setAnchors() {
    const at = (x, z, lift = 0) => ({ x: Math.round(x * 100) / 100, y: Math.round((this.ground(x, z) + lift) * 100) / 100, z: Math.round(z * 100) / 100 });

    // The span the level is built around: across the ravine, from the near lip to the far one.
    const spanZ = 20;
    let nearX = 100;
    for (let x = 100; x < 200; x += 0.5) if (!this.terrain.isSolid(x, spanZ)) { nearX = x - 0.5; break; }
    let farX = nearX + 8;
    for (let x = nearX + 4; x < 280; x += 0.5) if (this.terrain.isSolid(x, spanZ)) { farX = x; break; }

    this.anchors = {
      spawn: at(-232, 8, 1.6),
      brow: at(-232, 8),
      bollard: at(-300, 34),
      barge: at(-296, 74),
      kindness: at(-268, 118),
      standingHouse: at(-90, -72),
      standingHouseSocket: at(-104, -69, 1.6),
      weir: at(-36, 76),
      terrace: at(20, 10),
      spanNear: at(nearX - 2, spanZ),
      spanFar: at(farX + 2, spanZ),
      secondLip: at(268, 26),
      certaintyField: at(258, 30),
      ridgeThing: at(268, -152),
      edgewake: at(300, 110),
      lowLip: at(322, 40),
      cutters: at(300, -60),
    };
    this.anchors.span = {
      near: this.anchors.spanNear,
      far: this.anchors.spanFar,
      // The gap, measured off the terrain. A level designer digs the hole; the claim reads it.
      gap: Number(Math.hypot(this.anchors.spanFar.x - this.anchors.spanNear.x, this.anchors.spanFar.z - this.anchors.spanNear.z).toFixed(2)),
    };
    this.anchors.vantis = { bearing: Number(Math.atan2(-10600 * 0.17, 10600 * 0.985).toFixed(3)), distance: 10600 };
  }

  // -------------------------------------------------------------------------- kernel hooks

  fixed() {
    if (this._spawned) return;
    // Locomotion mounts after the world (boot order 30 vs 10), so it has already run its own
    // spawn search by now and landed wherever the ring search found ground. Placing the player
    // is level design, not a fallback: the arrival frame is authored, and it is this one.
    this._spawned = true;
    const s = this.anchors.spawn;
    signals.emit("player:spawn", { position: { x: s.x, y: s.y, z: s.z }, heading: [1, 0] });
  }

  after() {
    // Keep the compressed backdrop projectively identical to its true position, whatever the
    // camera does. `p_render = cam + (p_true − cam)/k` for every point, exactly.
    const c = this.kernel.camera.position;
    const f = 1 - 1 / this.farK;
    this.far.position.set(c.x * f, c.y * f, c.z * f);
    updateFlatShared({
      sun: this._sun?.toLight,
      level: this._sun?.relativeIntensity ?? 1,
      exposure: this.kernel.renderer.toneMappingExposure,
    });
  }

  snapshot() {
    const geoTris = (m) => (m ? m.geometry.getAttribute("position").count / 3 : 0);
    return {
      id: LEAF.id,
      anchors: this.anchors,
      carries: CARRIES.map((c) => ({ id: c.id, uphill: !!c.uphill })),
      landmarks: {
        spires: 17,
        boulders: this.boulderCount,
        certaintyClusters: this.certaintyClusters,
        vantisTowers: this.vantisTowers,
        nearLeaves: this.nearLeaves.length,
        horizonLeaves: this.horizonLeaves.length,
      },
      backdrop: { compression: Number(this.farK.toFixed(2)), nearScale: Number(this.nearScale.toFixed(3)) },
      triangles: {
        rock: geoTris(this.rockMesh),
        carries: geoTris(this.carryMesh),
        built: geoTris(this.builtMesh),
        certainties: geoTris(this.certaintyMesh),
        archipelago: geoTris(this.archipelagoMesh),
        backdrop: geoTris(this.backdropMesh),
      },
      sun: this._sun ? { toLight: this._sun.toLight, level: this._sun.relativeIntensity } : null,
    };
  }

  dispose() {
    this._offSun?.();
    for (const m of [this.rockMesh, this.carryMesh, this.builtMesh, this.certaintyMesh, this.archipelagoMesh, this.backdropMesh]) {
      m?.geometry.dispose();
    }
  }
}

/** Height of a thing slung *under* a leaf, relative to that leaf's plate. */
function height0(drop) {
  return 700 + drop;
}
