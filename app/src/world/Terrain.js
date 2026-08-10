import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";

/**
 * Terrain — the heightfield engine Leaf Nine is cut out of.
 *
 * There is no noise library in here and no imported mesh. Everything below is authored:
 * a hashed value-noise basis, fBm and ridged-multifractal stacks built on it, a domain warp,
 * two erosion models, a chunked level-of-detail mesh, and a heightfield query fast enough to
 * be called from a fixed step.
 *
 * Four decisions carry most of the quality, and each of them exists because of a specific
 * failure it prevents:
 *
 *  1. **One grid is the truth.** The visual mesh, the collision mesh, `groundAt()` and every
 *     other system's height query all read the same `Float32Array`. A terrain whose renderer
 *     and whose physics evaluate the same noise function *separately* drifts apart by a few
 *     centimetres of floating-point and the player floats or sinks — visibly, and only on some
 *     machines. Sampling one baked grid makes that class of bug impossible.
 *
 *  2. **Erosion is what makes rock read as rock.** Layered noise alone produces blobs: smooth
 *     hills with rounded tops, because every octave is symmetric. Real ridges are asymmetric —
 *     a sharp crest, a talus slope that stands at the material's angle of repose, and debris
 *     fanning out at the bottom. `_thermal()` moves material downhill wherever the local slope
 *     exceeds a talus angle, which produces exactly that; `_hydraulic()` runs droplets that
 *     carry sediment and cut the gullies that tell you which way is down. Neither is decoration:
 *     without them the leaf reads as sand dunes.
 *
 *  3. **Authored ground is protected from both.** A level is not a noise field. Every pad,
 *     terrace, court and route the composition needs carries `protect = 1`, which zeroes the
 *     noise amplitude, zeroes the erosion weight and blends the final height back to exactly
 *     what the design asked for. Erosion is allowed to attack the *wild* parts and only those.
 *
 *  4. **High-frequency detail is slope-gated.** Small bumps on walkable ground are a movement
 *     bug wearing a texture: they make the collision mesh disagree with the render mesh at any
 *     collider resolution you can afford, and they make a run across a flat plain feel like
 *     driving over cobbles. Detail amplitude scales with slope, so cliffs get crunchy and decks
 *     stay honest — which is what lets the collider run at 2 m and still be truthful.
 *
 * The level supplies a `design(x, z, out)` callback: base height, whether the leaf exists at
 * all here, how protected the ground is, how rough, how thick the leaf is underneath, and a
 * material class. Terrain owns everything after that.
 */

// ---------------------------------------------------------------------------- noise basis

/** 32-bit integer hash → [0,1). Deterministic on every platform; no Math.random anywhere. */
export function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise with a quintic fade — C² continuous, so the derived normals never crease. */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  const t = a + (b - a) * ux;
  const u = c + (d - c) * ux;
  return t + (u - t) * uz;
}

/** Signed fractal Brownian motion in [-1, 1]. */
export function fbm(x, z, seed, octaves = 5, lacunarity = 2.017, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * freq, z * freq, seed + o * 1013) * 2 - 1) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/**
 * Ridged multifractal in [0, 1]. The absolute-value fold turns every zero crossing into a
 * crest, and weighting each octave by the previous one keeps the crests *connected* into
 * ridge lines instead of scattering them — that connectedness is the difference between a
 * mountain and a heap of gravel.
 */
export function ridged(x, z, seed, octaves = 5, lacunarity = 2.031, gain = 0.52, sharpness = 2.0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + o * 7717) * 2 - 1);
    n = Math.pow(n, sharpness);
    n *= weight;
    weight = Math.min(1, n * 1.9);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a || 1e-6), 0, 1);
  return x * x * (3 - 2 * x);
};
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------- mesh builder

/**
 * A tiny non-indexed geometry accumulator. Written here rather than pulled from three's
 * examples because merging is three lines of arithmetic and an extra dependency in a build
 * that reviewers run headless is a real cost.
 */
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
  }

  get triangles() {
    return this.pos.length / 9;
  }

  tri(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const c1 = cb ?? ca, c2 = cc ?? ca;
    this.col.push(ca[0], ca[1], ca[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]);
  }

  quad(a, b, c, d, ca, cb, cc, cd) {
    this.tri(a, b, c, ca, cb ?? ca, cc ?? ca);
    this.tri(a, c, d, ca, cc ?? ca, cd ?? ca);
  }

  /** Axis-aligned box. `top` colours the +Y face, `side` everything else. */
  box(x0, y0, z0, x1, y1, z1, top, side) {
    const s = side ?? top;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    this.quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], s);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], s);
    this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], s);
    this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], s);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], s);
  }

  /** A box rotated about Y — the one transform level architecture actually needs. */
  boxY(cx, cy, cz, hx, hy, hz, yaw, top, side) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const p = (dx, dy, dz) => [cx + dx * c - dz * s, cy + dy, cz + dx * s + dz * c];
    const a = p(-hx, +hy, -hz), b = p(-hx, +hy, +hz), d = p(+hx, +hy, +hz), e = p(+hx, +hy, -hz);
    const A = p(-hx, -hy, -hz), B = p(-hx, -hy, +hz), D = p(+hx, -hy, +hz), E = p(+hx, -hy, -hz);
    const sd = side ?? top;
    this.quad(a, b, d, e, top);
    this.quad(B, A, E, D, sd);
    this.quad(A, a, e, E, sd);
    this.quad(D, d, b, B, sd);
    this.quad(B, b, a, A, sd);
    this.quad(E, e, d, D, sd);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------- palette

/**
 * Terrain albedo, straight out of `design/palette.json`, converted to linear once. These are
 * *albedos* fed to a lit material, never final pixels — the shading ramps in
 * `design/art-direction.md` §4 are what has to come out of the frame, and they come out of the
 * light rig acting on these.
 */
function srgbToLinear(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [f(r), f(g), f(b)];
}

export const ALBEDO = {
  rockLit: srgbToLinear(0xc9834f),      // rock.warm.lit, pulled back — a lit facet, not a light
  rockMid: srgbToLinear(0xb4744c),      // rock.albedo — the colour a player would name
  rockLow: srgbToLinear(0x8c5a3e),      // rock.warm.low
  rockShadow: srgbToLinear(0x55505e),   // rock.shadow
  rockDeep: srgbToLinear(0x2b2431),     // rock.shadow.deep
  bone: srgbToLinear(0xaa9087),         // rock.bone — cut stone, ruins, pads
  foliage: srgbToLinear(0x7e9a80),      // world.foliage held under S 0.30
  grey: srgbToLinear(0x7c7a72),         // world.grey — a supplied closure
  greyDeep: srgbToLinear(0x4a4945),
  flow: srgbToLinear(0x3fcfa0),         // resonance.flow — a carry
  flowDeep: srgbToLinear(0x0e5f63),     // resonance.deep — a carry bed
  certFacet: srgbToLinear(0x5aa5a0),
  certDeep: srgbToLinear(0x26514f),
  glass: srgbToLinear(0x241f2c),        // dark glass — the arches
};

/** Material classes the level's `design()` can ask for. */
export const MAT = {
  ROCK: 0,
  PAD: 1,      // cut stone: courts, terraces, the market flat
  FIELD: 2,    // the certainty field's crystal-seamed ground
  CARRY: 3,    // a carry bed
  GREY: 4,     // approximate ground under a grey object
  RIDGE: 5,    // the wild ridge — more ridged noise, more erosion
};

// ---------------------------------------------------------------------------- the system

export class Terrain {
  constructor(kernel, opts = {}) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "leaf-terrain";

    this.seed = opts.seed ?? 90210;
    this.x0 = opts.x0 ?? -200;
    this.z0 = opts.z0 ?? -620;
    this.x1 = opts.x1 ?? 200;
    this.z1 = opts.z1 ?? 100;
    this.spacing = opts.spacing ?? 1;
    this.chunkCells = opts.chunkCells ?? 100;
    this.lodSteps = opts.lodSteps ?? [1, 2, 5, 10];
    this.lodDistances = opts.lodDistances ?? [95, 210, 430];
    this.colliderStep = opts.colliderStep ?? 2;
    this.design = opts.design ?? ((x, z, out) => { out.h = 0; out.solid = 1; });

    this.nx = Math.round((this.x1 - this.x0) / this.spacing) + 1;
    this.nz = Math.round((this.z1 - this.z0) / this.spacing) + 1;
    const n = this.nx * this.nz;

    this.h = new Float32Array(n);        // top surface height
    this.b = new Float32Array(n);        // underside height
    this.solid = new Uint8Array(n);      // 1 where the leaf exists
    this.protect = new Float32Array(n);  // 1 = authored, untouchable
    this.rough = new Float32Array(n);
    this.mat = new Uint8Array(n);
    this.designH = new Float32Array(n);

    this.chunks = [];
    this._geomCache = new Map();
    this.stats = { generateMs: 0, meshMs: 0, colliderTris: 0, meshTris: 0, chunks: 0, droplets: 0 };

    this._camXZ = new THREE.Vector3();
    this._lodChanges = 0;

    publish("terrain", () => this.snapshot());
  }

  // ------------------------------------------------------------------ indexing

  idx(ix, iz) {
    return iz * this.nx + ix;
  }

  /** Grid coordinates of a world position, unclamped. */
  gx(x) {
    return (x - this.x0) / this.spacing;
  }
  gz(z) {
    return (z - this.z0) / this.spacing;
  }

  // ------------------------------------------------------------------ generation

  build() {
    const t0 = performance.now();
    this._compose();
    this._detail();
    this._thermal(this._thermalPasses ?? 26);
    this._hydraulic();
    this._settle();
    this._underside();
    this.stats.generateMs = Number((performance.now() - t0).toFixed(1));

    const t1 = performance.now();
    this._buildChunks();
    this._buildShell();
    this.stats.meshMs = Number((performance.now() - t1).toFixed(1));
    return this;
  }

  /** Pass 1 — ask the level what it wants, before any noise touches it. */
  _compose() {
    const out = { h: 0, solid: 1, protect: 0, rough: 1, mat: MAT.ROCK, thickness: 26 };
    this._thickness = new Float32Array(this.nx * this.nz);
    for (let iz = 0; iz < this.nz; iz++) {
      const z = this.z0 + iz * this.spacing;
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.x0 + ix * this.spacing;
        out.h = 0; out.solid = 1; out.protect = 0; out.rough = 1;
        out.mat = MAT.ROCK; out.thickness = 26;
        this.design(x, z, out);
        const i = iz * this.nx + ix;
        this.h[i] = out.h;
        this.designH[i] = out.h;
        this.solid[i] = out.solid ? 1 : 0;
        this.protect[i] = clamp(out.protect, 0, 1);
        this.rough[i] = Math.max(0, out.rough);
        this.mat[i] = out.mat;
        this._thickness[i] = out.thickness;
      }
    }
  }

  /**
   * Pass 2 — the noise. Three stacks doing three different jobs:
   *
   *   * a **warp** field, so nothing that follows lies on a grid;
   *   * a **ridged** stack for the structural rock — this is what makes crests;
   *   * an **fBm** stack for the broad undulation the ridges sit in.
   *
   * All three are scaled by `rough` and by `1 - protect`, and the fine octaves are additionally
   * scaled by local slope so that walkable ground stays walkable. See the class comment.
   */
  _detail() {
    const S = this.seed;
    const nx = this.nx, nz = this.nz, sp = this.spacing;
    // Slope of the composed design, used to gate fine detail. Computed before detail is added
    // so a cliff authored by the level gets crunch and a deck authored flat does not.
    const slope = new Float32Array(nx * nz);
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        const dx = (this.h[i + 1] - this.h[i - 1]) / (2 * sp);
        const dz = (this.h[i + nx] - this.h[i - nx]) / (2 * sp);
        slope[i] = Math.hypot(dx, dz);
      }
    }

    for (let iz = 0; iz < nz; iz++) {
      const z = this.z0 + iz * sp;
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        if (!this.solid[i]) continue;
        const k = this.rough[i] * (1 - this.protect[i]);
        if (k <= 0.0005) continue;
        const x = this.x0 + ix * sp;

        // Domain warp: two low-frequency fBm channels displace the sample point. Without it
        // every ridge line in the level runs parallel to the noise grid and the eye finds it.
        const wx = fbm(x * 0.0042, z * 0.0042, S + 11, 3) * 34;
        const wz = fbm(x * 0.0042 + 5.7, z * 0.0042 - 3.1, S + 29, 3) * 34;
        const px = x + wx, pz = z + wz;

        const rock = this.mat[i] === MAT.RIDGE ? 1.0 : 0.55;
        // Structural ridges — the thing the level's silhouette is actually made of.
        const r1 = ridged(px * 0.0062, pz * 0.0062, S + 101, 4, 2.03, 0.5, 1.9) - 0.42;
        // Broad undulation.
        const f1 = fbm(px * 0.0075, pz * 0.0075, S + 211, 4);
        // Medium break-up: what stops a slope reading as one plane.
        const f2 = fbm(px * 0.031, pz * 0.031, S + 307, 3);
        // Fine crunch, slope-gated.
        const gate = smoothstep(0.12, 0.55, slope[i]);
        const f3 = fbm(px * 0.135, pz * 0.135, S + 401, 2);

        this.h[i] +=
          k * (r1 * 15.5 * rock + f1 * 5.2 + f2 * 1.35 + f3 * (0.12 + 1.55 * gate));
      }
    }
  }

  /**
   * Thermal erosion. Material standing steeper than the talus angle slides to its downhill
   * neighbours. Run enough passes and every unprotected slope in the world settles at the same
   * angle of repose, which is precisely why a real hillside reads as *rock*: the crest stays
   * sharp because it has no material above it to shed, and the flanks go straight.
   */
  _thermal(passes) {
    const nx = this.nx, nz = this.nz, sp = this.spacing;
    const talus = Math.tan((37 * Math.PI) / 180) * sp; // max height difference per cell
    const talusDiag = talus * Math.SQRT2;
    const h = this.h;
    const delta = new Float32Array(nx * nz);
    const NB = [
      [1, 0, talus], [-1, 0, talus], [0, 1, talus], [0, -1, talus],
      [1, 1, talusDiag], [-1, 1, talusDiag], [1, -1, talusDiag], [-1, -1, talusDiag],
    ];

    for (let p = 0; p < passes; p++) {
      delta.fill(0);
      for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
          const i = iz * nx + ix;
          if (!this.solid[i]) continue;
          const w = 1 - this.protect[i];
          if (w <= 0.02) continue;
          let total = 0;
          let maxExcess = 0;
          for (let k = 0; k < 8; k++) {
            const j = i + NB[k][0] + NB[k][1] * nx;
            if (!this.solid[j]) continue;
            const d = h[i] - h[j] - NB[k][2];
            if (d > 0) { total += d; if (d > maxExcess) maxExcess = d; }
          }
          if (total <= 0) continue;
          // Move half the largest excess, shared out in proportion. Half rather than all so
          // the field converges instead of ringing between two cells forever.
          const move = maxExcess * 0.5 * w;
          delta[i] -= move;
          for (let k = 0; k < 8; k++) {
            const j = i + NB[k][0] + NB[k][1] * nx;
            if (!this.solid[j]) continue;
            const d = h[i] - h[j] - NB[k][2];
            if (d > 0) delta[j] += (move * d) / total;
          }
        }
      }
      for (let i = 0; i < delta.length; i++) h[i] += delta[i];
    }
  }

  /**
   * Hydraulic erosion, droplet model. Each droplet follows the gradient, accumulates speed,
   * carries sediment up to a capacity set by how fast it is going and how steep the ground is,
   * and swaps between cutting and dropping as that capacity changes. What it buys is *legibility*:
   * gullies converge, so a player who cannot see the bottom of a slope can still read which way
   * water went, and therefore which way is down. Noise alone never gives you that.
   */
  _hydraulic() {
    const nx = this.nx, nz = this.nz;
    const h = this.h;
    const count = this._dropletCount ?? 26000;
    const LIFETIME = 34;
    const INERTIA = 0.06;
    const CAPACITY = 3.6;
    const MIN_SLOPE = 0.02;
    const ERODE = 0.28;
    const DEPOSIT = 0.22;
    const EVAPORATE = 0.022;
    const GRAVITY = 6;
    const RADIUS = 2;

    // Precompute the brush the droplet cuts with, so an eroded pit is a dish rather than a spike.
    const brush = [];
    let brushSum = 0;
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > RADIUS) continue;
        const w = 1 - d / (RADIUS + 1);
        brush.push([dx, dz, w]);
        brushSum += w;
      }
    }
    for (const bq of brush) bq[2] /= brushSum;

    let s = (this.seed ^ 0x5bf03635) >>> 0;
    const rnd = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };

    let launched = 0;
    for (let d = 0; d < count; d++) {
      let px = 2 + rnd() * (nx - 5);
      let pz = 2 + rnd() * (nz - 5);
      let i0 = (pz | 0) * nx + (px | 0);
      if (!this.solid[i0] || this.protect[i0] > 0.5) continue;
      launched++;

      let dirX = 0, dirZ = 0, speed = 1, water = 1, sediment = 0;
      for (let life = 0; life < LIFETIME; life++) {
        const cx = px | 0, cz = pz | 0;
        if (cx < 2 || cz < 2 || cx >= nx - 3 || cz >= nz - 3) break;
        const i = cz * nx + cx;
        if (!this.solid[i]) break;
        const fx = px - cx, fz = pz - cz;

        const h00 = h[i], h10 = h[i + 1], h01 = h[i + nx], h11 = h[i + nx + 1];
        const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
        const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const hOld = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;

        dirX = dirX * INERTIA - gx * (1 - INERTIA);
        dirZ = dirZ * INERTIA - gz * (1 - INERTIA);
        const dl = Math.hypot(dirX, dirZ);
        if (dl < 1e-5) break;
        dirX /= dl; dirZ /= dl;
        px += dirX;
        pz += dirZ;

        const ncx = px | 0, ncz = pz | 0;
        if (ncx < 2 || ncz < 2 || ncx >= nx - 3 || ncz >= nz - 3) break;
        const ni = ncz * nx + ncx;
        if (!this.solid[ni]) break;
        const nfx = px - ncx, nfz = pz - ncz;
        const n00 = h[ni], n10 = h[ni + 1], n01 = h[ni + nx], n11 = h[ni + nx + 1];
        const hNew =
          n00 * (1 - nfx) * (1 - nfz) + n10 * nfx * (1 - nfz) + n01 * (1 - nfx) * nfz + n11 * nfx * nfz;
        const dh = hNew - hOld;

        const capacity = Math.max(-dh, MIN_SLOPE) * speed * water * CAPACITY;
        if (sediment > capacity || dh > 0) {
          // Uphill or over-loaded: drop. Filling a pit exactly to its brim (never past it) is
          // what keeps a deposit from becoming a new bump the next droplet has to climb.
          const drop = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * DEPOSIT;
          sediment -= drop;
          const w = 1 - this.protect[i];
          h[i] += drop * (1 - fx) * (1 - fz) * w;
          h[i + 1] += drop * fx * (1 - fz) * w;
          h[i + nx] += drop * (1 - fx) * fz * w;
          h[i + nx + 1] += drop * fx * fz * w;
        } else {
          const cut = Math.min((capacity - sediment) * ERODE, -dh);
          for (let k = 0; k < brush.length; k++) {
            const bx = cx + brush[k][0], bz = cz + brush[k][1];
            const bi = bz * nx + bx;
            if (!this.solid[bi]) continue;
            const take = cut * brush[k][2] * (1 - this.protect[bi]);
            h[bi] -= take;
            sediment += take;
          }
        }

        speed = Math.sqrt(Math.max(0, speed * speed + -dh * GRAVITY));
        water *= 1 - EVAPORATE;
        if (water < 0.02) break;
      }
    }
    this.stats.droplets = launched;
  }

  /**
   * Pass 5 — put the level back. Erosion is allowed to shape the wild; it is not allowed to
   * move a pad the composition depends on, and a partially protected cell gets the design
   * height back in proportion. A final 3×3 smoothing on protected ground removes the one-cell
   * step that the boundary between protected and free cells otherwise leaves behind.
   */
  _settle() {
    const nx = this.nx, nz = this.nz;
    const h = this.h;
    for (let i = 0; i < h.length; i++) {
      const p = this.protect[i];
      if (p > 0) h[i] = mix(h[i], this.designH[i], p);
    }
    const tmp = new Float32Array(h);
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (!this.solid[i]) continue;
        const w = clamp(this.protect[i] * 1.4, 0, 1);
        if (w <= 0.02) continue;
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dx + dz * nx;
            if (!this.solid[j]) continue;
            sum += tmp[j]; n++;
          }
        }
        if (n) h[i] = mix(h[i], sum / n, w * 0.55);
      }
    }
  }

  /**
   * The underside. `design/art-direction.md` §0.1: a leaf is "flat on top because that was the
   * surface, ragged underneath because that is a fracture where the false part stopped". So the
   * bottom is not a mirrored top — it is a separate, sharper field: ridged noise at high
   * sharpness, biting *upward* into the leaf, thinning to nothing at the rim.
   */
  _underside() {
    const nx = this.nx, nz = this.nz;
    for (let iz = 0; iz < nz; iz++) {
      const z = this.z0 + iz * this.spacing;
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        if (!this.solid[i]) { this.b[i] = this.h[i]; continue; }
        const x = this.x0 + ix * this.spacing;
        const edge = this._edgeFalloff(ix, iz);
        const frac = ridged(x * 0.011, z * 0.011, this.seed + 907, 4, 2.05, 0.55, 2.6);
        const lump = fbm(x * 0.0055, z * 0.0055, this.seed + 1201, 3);
        const t = this._thickness[i] * edge * (0.42 + 0.58 * frac) * (1 + lump * 0.35);
        this.b[i] = this.h[i] - Math.max(2.2, t);
      }
    }
  }

  /** Distance-to-rim falloff in [0,1]; 0 at the boundary, 1 well inside. Cheap chamfer search. */
  _edgeFalloff(ix, iz) {
    const nx = this.nx, nz = this.nz;
    const R = 22;
    for (let r = 2; r <= R; r += 4) {
      const a = ix - r, b = ix + r, c = iz - r, d = iz + r;
      if (a < 0 || c < 0 || b >= nx || d >= nz) return smoothstep(0, R, r);
      if (!this.solid[iz * nx + a] || !this.solid[iz * nx + b] ||
          !this.solid[c * nx + ix] || !this.solid[d * nx + ix]) {
        return smoothstep(0, R, r);
      }
    }
    return 1;
  }

  // ------------------------------------------------------------------ queries

  /**
   * Bilinear height at a world position. This is the query every other system uses — scatter
   * placement, prop seating, anchor resolution — and it must stay allocation-free.
   * Returns NaN outside the leaf so callers cannot mistake "nothing here" for "sea level".
   */
  heightAt(x, z) {
    const fx = this.gx(x), fz = this.gz(z);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.nx - 1 || iz >= this.nz - 1) return NaN;
    const i = iz * this.nx + ix;
    if (!this.solid[i] || !this.solid[i + 1] || !this.solid[i + this.nx] || !this.solid[i + this.nx + 1]) {
      return NaN;
    }
    const tx = fx - ix, tz = fz - iz;
    const a = this.h[i], b = this.h[i + 1], c = this.h[i + this.nx], d = this.h[i + this.nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** `{ hit, y, slopeDeg }` — the shape a caller that has to decide something wants. */
  groundAt(x, z) {
    const y = this.heightAt(x, z);
    if (Number.isNaN(y)) return { hit: false, y: 0, slopeDeg: 90 };
    const n = this.normalAt(x, z, _n);
    return { hit: true, y, slopeDeg: (Math.acos(clamp(n.y, -1, 1)) * 180) / Math.PI };
  }

  /** Surface normal by central difference on the same grid the mesh was built from. */
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const s = this.spacing;
    const hl = this.heightAt(x - s, z), hr = this.heightAt(x + s, z);
    const hd = this.heightAt(x, z - s), hu = this.heightAt(x, z + s);
    const dx = Number.isNaN(hl) || Number.isNaN(hr) ? 0 : (hr - hl) / (2 * s);
    const dz = Number.isNaN(hd) || Number.isNaN(hu) ? 0 : (hu - hd) / (2 * s);
    const len = Math.hypot(dx, 1, dz) || 1;
    out.x = -dx / len;
    out.y = 1 / len;
    out.z = -dz / len;
    return out;
  }

  /** True where the leaf exists at all — used by scatter and by the level's own placement. */
  isSolid(x, z) {
    const ix = Math.round(this.gx(x)), iz = Math.round(this.gz(z));
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    return this.solid[iz * this.nx + ix] === 1;
  }

  // ------------------------------------------------------------------ colouring

  /**
   * Albedo by slope and height. Four blends, in the order they matter:
   *   * slope decides rock family — flat ground keeps `rock.warm.mid`, faces go to `rock.warm.low`
   *     and then to `rock.shadow` in the near-vertical band, which is what stops a cliff reading
   *     as the same paint as the deck;
   *   * height adds a slow warm-to-cool drift down the leaf, so the low end reads colder;
   *   * the level's material class overrides for pads, carry beds, grey and the field;
   *   * a low-amplitude noise breaks up the banding that any two-stop ramp produces.
   */
  colorAt(x, z, i, out) {
    const s = this.spacing;
    const nx = this.nx;
    const dx = (this.h[i + 1] - this.h[i - 1]) / (2 * s);
    const dz = (this.h[i + nx] - this.h[i - nx]) / (2 * s);
    const slope = Math.hypot(dx, dz);
    const steep = smoothstep(0.35, 1.35, slope);
    const cliff = smoothstep(1.15, 2.6, slope);

    const grain = fbm(x * 0.052, z * 0.052, this.seed + 555, 2) * 0.5 + 0.5;
    const band = fbm(x * 0.011, z * 0.011, this.seed + 666, 3) * 0.5 + 0.5;

    let r = mix(ALBEDO.rockMid[0], ALBEDO.rockLit[0], band * 0.55);
    let g = mix(ALBEDO.rockMid[1], ALBEDO.rockLit[1], band * 0.55);
    let bl = mix(ALBEDO.rockMid[2], ALBEDO.rockLit[2], band * 0.55);

    r = mix(r, ALBEDO.rockLow[0], steep);
    g = mix(g, ALBEDO.rockLow[1], steep);
    bl = mix(bl, ALBEDO.rockLow[2], steep);
    r = mix(r, ALBEDO.rockShadow[0], cliff * 0.62);
    g = mix(g, ALBEDO.rockShadow[1], cliff * 0.62);
    bl = mix(bl, ALBEDO.rockShadow[2], cliff * 0.62);

    const m = this.mat[i];
    if (m === MAT.PAD) {
      const k = 0.72 * (1 - steep);
      r = mix(r, ALBEDO.bone[0], k); g = mix(g, ALBEDO.bone[1], k); bl = mix(bl, ALBEDO.bone[2], k);
    } else if (m === MAT.FIELD) {
      const k = 0.5 * (1 - steep) * (0.35 + 0.65 * grain);
      r = mix(r, ALBEDO.certDeep[0], k); g = mix(g, ALBEDO.certDeep[1], k); bl = mix(bl, ALBEDO.certDeep[2], k);
    } else if (m === MAT.CARRY) {
      const k = 0.8;
      r = mix(r, ALBEDO.flowDeep[0], k); g = mix(g, ALBEDO.flowDeep[1], k); bl = mix(bl, ALBEDO.flowDeep[2], k);
    } else if (m === MAT.GREY) {
      const k = 0.8 * (1 - steep * 0.5);
      r = mix(r, ALBEDO.grey[0], k); g = mix(g, ALBEDO.grey[1], k); bl = mix(bl, ALBEDO.grey[2], k);
    }

    // Oldtrue: the pale lichen that only grows where a claim has held. Flat, sheltered, old
    // ground only — so it reads as information rather than as a texture.
    if (m !== MAT.CARRY && m !== MAT.GREY) {
      const old = (1 - steep) * smoothstep(0.55, 0.85, grain) * 0.3;
      r = mix(r, ALBEDO.foliage[0], old);
      g = mix(g, ALBEDO.foliage[1], old);
      bl = mix(bl, ALBEDO.foliage[2], old);
    }

    const v = 0.88 + grain * 0.24;
    out[0] = r * v;
    out[1] = g * v;
    out[2] = bl * v;
    return out;
  }

  // ------------------------------------------------------------------ meshing

  material() {
    if (!this._mat) {
      this._mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.0,
        dithering: true,
      });
      this._mat.name = "terrain";
    }
    return this._mat;
  }

  _buildChunks() {
    const cc = this.chunkCells;
    const cx = Math.ceil((this.nx - 1) / cc);
    const cz = Math.ceil((this.nz - 1) / cc);
    let tris = 0;
    for (let j = 0; j < cz; j++) {
      for (let i = 0; i < cx; i++) {
        const ix0 = i * cc, iz0 = j * cc;
        const ix1 = Math.min(ix0 + cc, this.nx - 1);
        const iz1 = Math.min(iz0 + cc, this.nz - 1);
        let any = false;
        for (let z = iz0; z <= iz1 && !any; z++) {
          for (let x = ix0; x <= ix1; x++) {
            if (this.solid[z * this.nx + x]) { any = true; break; }
          }
        }
        if (!any) continue;
        const geo = this._chunkGeometry(ix0, iz0, ix1, iz1, this.lodSteps.at(-1));
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, this.material());
        mesh.name = `leaf-chunk-${i}-${j}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.root.add(mesh);
        const centre = new THREE.Vector3(
          this.x0 + ((ix0 + ix1) / 2) * this.spacing,
          0,
          this.z0 + ((iz0 + iz1) / 2) * this.spacing
        );
        centre.y = geo.boundingSphere ? geo.boundingSphere.center.y : 0;
        this.chunks.push({ ix0, iz0, ix1, iz1, mesh, centre, lod: this.lodSteps.length - 1 });
        tris += geo.getAttribute("position").count / 3;
      }
    }
    this.stats.chunks = this.chunks.length;
    this.stats.meshTris = tris;
  }

  /**
   * One chunk at one detail step, with a skirt on any border that has leaf on the far side.
   * The skirt is what makes level-of-detail invisible: two neighbouring chunks at different
   * steps disagree along their shared edge by up to half the coarser step's curvature, and a
   * 2.5 m curtain hanging off each border hides that without any stitching bookkeeping.
   */
  _chunkGeometry(ix0, iz0, ix1, iz1, step) {
    const key = `${ix0},${iz0},${step}`;
    const cached = this._geomCache.get(key);
    if (cached) return cached;

    const mb = new MeshBuilder();
    const sp = this.spacing;
    const cA = [0, 0, 0], cB = [0, 0, 0], cC = [0, 0, 0], cD = [0, 0, 0];
    const P = (ix, iz) => [this.x0 + ix * sp, this.h[iz * this.nx + ix], this.z0 + iz * sp];
    const solidQuad = (a, b, c, d) => this.solid[a] && this.solid[b] && this.solid[c] && this.solid[d];

    for (let iz = iz0; iz < iz1; iz += step) {
      const iz2 = Math.min(iz + step, iz1);
      for (let ix = ix0; ix < ix1; ix += step) {
        const ix2 = Math.min(ix + step, ix1);
        const iA = iz * this.nx + ix, iB = iz * this.nx + ix2;
        const iC = iz2 * this.nx + ix2, iD = iz2 * this.nx + ix;
        if (!solidQuad(iA, iB, iC, iD)) continue;
        const x = this.x0 + ix * sp, z = this.z0 + iz * sp;
        this.colorAt(this.x0 + ix * sp, this.z0 + iz * sp, this._safe(iA), cA);
        this.colorAt(this.x0 + ix2 * sp, this.z0 + iz * sp, this._safe(iB), cB);
        this.colorAt(this.x0 + ix2 * sp, this.z0 + iz2 * sp, this._safe(iC), cC);
        this.colorAt(this.x0 + ix * sp, this.z0 + iz2 * sp, this._safe(iD), cD);
        void x; void z;
        mb.quad(P(ix, iz), P(ix2, iz), P(ix2, iz2), P(ix, iz2), cA, cB, cC, cD);
      }
    }

    // --- skirts on internal borders only. The leaf's own rim gets a real cliff from the shell.
    const SKIRT = 2.6;
    const skirtRun = (fixed, from, to, axis, outward) => {
      for (let t = from; t < to; t += step) {
        const t2 = Math.min(t + step, to);
        const iA = axis === 0 ? fixed * this.nx + t : t * this.nx + fixed;
        const iB = axis === 0 ? fixed * this.nx + t2 : t2 * this.nx + fixed;
        const nA = axis === 0 ? iA + outward * this.nx : iA + outward;
        const nB = axis === 0 ? iB + outward * this.nx : iB + outward;
        if (!this.solid[iA] || !this.solid[iB]) continue;
        if (nA < 0 || nB < 0 || nA >= this.solid.length || nB >= this.solid.length) continue;
        if (!this.solid[nA] || !this.solid[nB]) continue;
        const a = axis === 0 ? P(t, fixed) : P(fixed, t);
        const b = axis === 0 ? P(t2, fixed) : P(fixed, t2);
        const a2 = [a[0], a[1] - SKIRT, a[2]];
        const b2 = [b[0], b[1] - SKIRT, b[2]];
        this.colorAt(a[0], a[2], this._safe(iA), cA);
        this.colorAt(b[0], b[2], this._safe(iB), cB);
        const dim = [cA[0] * 0.68, cA[1] * 0.68, cA[2] * 0.68];
        mb.quad(a, b, b2, a2, cA, cB, dim, dim);
        mb.quad(a2, b2, b, a, dim, dim, cB, cA);
      }
    };
    if (iz0 > 0) skirtRun(iz0, ix0, ix1, 0, -1);
    if (iz1 < this.nz - 1) skirtRun(iz1, ix0, ix1, 0, 1);
    if (ix0 > 0) skirtRun(ix0, iz0, iz1, 1, -1);
    if (ix1 < this.nx - 1) skirtRun(ix1, iz0, iz1, 1, 1);

    if (!mb.triangles) return null;
    const geo = mb.geometry();
    this._geomCache.set(key, geo);
    return geo;
  }

  /** Clamp an index away from the grid border so `colorAt`'s central difference is in range. */
  _safe(i) {
    const nx = this.nx;
    const ix = i % nx;
    const iz = (i / nx) | 0;
    return clamp(iz, 1, this.nz - 2) * nx + clamp(ix, 1, nx - 2);
  }

  /**
   * The shell: the rim cliff and the underside, merged into one mesh because they are one
   * object — the fracture the leaf broke along. The rim runs at full grid resolution so its top
   * edge matches the deck exactly; the underside runs coarse and is deliberately allowed to
   * overlap the rim's foot, because a seam you can hide with 3 m of overlap is not worth 40 000
   * triangles of stitching.
   */
  _buildShell() {
    const mb = new MeshBuilder();
    const nx = this.nx, nz = this.nz, sp = this.spacing;
    const warm = [ALBEDO.rockLow[0], ALBEDO.rockLow[1], ALBEDO.rockLow[2]];
    const dark = [ALBEDO.rockShadow[0] * 0.85, ALBEDO.rockShadow[1] * 0.85, ALBEDO.rockShadow[2] * 0.9];
    const deep = [ALBEDO.rockDeep[0], ALBEDO.rockDeep[1], ALBEDO.rockDeep[2]];

    // --- rim cliff
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (!this.solid[i]) continue;
        const x = this.x0 + ix * sp, z = this.z0 + iz * sp;
        for (let k = 0; k < 4; k++) {
          const dx = k === 0 ? 1 : k === 1 ? -1 : 0;
          const dz = k === 2 ? 1 : k === 3 ? -1 : 0;
          const j = i + dx + dz * nx;
          if (this.solid[j]) continue;
          // The wall runs along the cell edge perpendicular to (dx,dz).
          const ex = dz !== 0 ? sp * 0.5 : 0;
          const ez = dx !== 0 ? sp * 0.5 : 0;
          const ox = (dx * sp) / 2, oz = (dz * sp) / 2;
          const top = this.h[i];
          const bot = this.b[i] - 3.2;
          const a = [x + ox - ex, top, z + oz - ez];
          const b = [x + ox + ex, top, z + oz + ez];
          const c = [x + ox + ex, bot, z + oz + ez];
          const d = [x + ox - ex, bot, z + oz - ez];
          const streak = fbm(x * 0.09, z * 0.09, this.seed + 88, 2) * 0.5 + 0.5;
          const topC = [
            mix(warm[0], ALBEDO.rockMid[0], streak),
            mix(warm[1], ALBEDO.rockMid[1], streak),
            mix(warm[2], ALBEDO.rockMid[2], streak),
          ];
          mb.quad(a, b, c, d, topC, topC, dark, dark);
          mb.quad(d, c, b, a, dark, dark, topC, topC);
        }
      }
    }

    // --- underside, coarse, dilated outward so it hides behind the rim's foot
    const step = 4;
    const solidD = (ix, iz) => {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          if (this.solid[jz * nx + jx]) return true;
        }
      }
      return false;
    };
    const bAt = (ix, iz) => {
      const i = clamp(iz, 0, nz - 1) * nx + clamp(ix, 0, nx - 1);
      if (this.solid[i]) return this.b[i];
      // Outside the leaf: fall away fast, so the dilated skin reads as a fracture lip.
      let best = -Infinity;
      for (let r = 1; r <= 4; r++) {
        for (let k = 0; k < 4; k++) {
          const jx = ix + (k === 0 ? r : k === 1 ? -r : 0);
          const jz = iz + (k === 2 ? r : k === 3 ? -r : 0);
          const j = clamp(jz, 0, nz - 1) * nx + clamp(jx, 0, nx - 1);
          if (this.solid[j]) best = Math.max(best, this.b[j] - r * 1.4);
        }
        if (best > -Infinity) break;
      }
      return best > -Infinity ? best : 0;
    };
    const PB = (ix, iz) => [this.x0 + ix * sp, bAt(ix, iz), this.z0 + iz * sp];
    for (let iz = 0; iz < nz - step; iz += step) {
      for (let ix = 0; ix < nx - step; ix += step) {
        if (!solidD(ix, iz) && !solidD(ix + step, iz + step)) continue;
        if (!solidD(ix, iz) || !solidD(ix + step, iz) || !solidD(ix, iz + step) || !solidD(ix + step, iz + step)) {
          continue;
        }
        const a = PB(ix, iz), b = PB(ix + step, iz), c = PB(ix + step, iz + step), d = PB(ix, iz + step);
        const x = this.x0 + ix * sp, z = this.z0 + iz * sp;
        const v = fbm(x * 0.02, z * 0.02, this.seed + 133, 3) * 0.5 + 0.5;
        const col = [mix(deep[0], dark[0], v), mix(deep[1], dark[1], v), mix(deep[2], dark[2], v)];
        // Wound the other way: the underside is seen from below.
        mb.quad(d, c, b, a, col, col, col, col);
      }
    }

    const geo = mb.geometry();
    const mesh = new THREE.Mesh(geo, this.material());
    mesh.name = "leaf-shell";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    this.shell = mesh;
    this.stats.meshTris += geo.getAttribute("position").count / 3;
  }

  // ------------------------------------------------------------------ collider

  /**
   * The collision surface. Decimated to `colliderStep` metres, which is affordable because
   * §4 of this file's header keeps walkable ground smooth: the largest disagreement between
   * this mesh and the rendered one on any ground a player can stand on is a couple of
   * centimetres, and it is measured rather than asserted (`review/measure/P09.mjs`).
   *
   * Architecture — ledges, stairs, terraces, the causeway — is *not* in here. A 0.55 m ledge
   * sampled every 2 m is a 15° ramp, which is a mantle the player never gets to make. Sharp
   * features are separate collider geometry, registered by the level.
   */
  colliderGeometry() {
    const st = this.colliderStep;
    const mb = new MeshBuilder();
    const sp = this.spacing;
    const flat = [0.5, 0.5, 0.5];
    const P = (ix, iz) => [this.x0 + ix * sp, this.h[iz * this.nx + ix], this.z0 + iz * sp];
    for (let iz = 0; iz + st < this.nz; iz += st) {
      for (let ix = 0; ix + st < this.nx; ix += st) {
        const iA = iz * this.nx + ix;
        const iB = iz * this.nx + ix + st;
        const iC = (iz + st) * this.nx + ix + st;
        const iD = (iz + st) * this.nx + ix;
        if (!this.solid[iA] || !this.solid[iB] || !this.solid[iC] || !this.solid[iD]) continue;
        mb.quad(P(ix, iz), P(ix + st, iz), P(ix + st, iz + st), P(ix, iz + st), flat);
      }
    }
    this.stats.colliderTris = mb.triangles;
    return mb.geometry();
  }

  /** Register with the character controller. Terrain is static, so this happens exactly once. */
  publishCollider(id = "p09:leaf-nine") {
    const geo = this.colliderGeometry();
    signals.emit("world:collider", { id, geometry: geo });
    this._colliderGeo = geo;
    return geo;
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Level of detail. Chunk selection runs on the rendered frame rather than the fixed step
   * because it is not gameplay: a chunk that swaps a frame late is invisible, and a chunk that
   * swaps 60 times a second on a still camera is a stutter. Hysteresis on the distance bands
   * keeps a chunk from oscillating when the player stands exactly on a boundary.
   */
  frame() {
    const cam = this.kernel.camera;
    this._camXZ.set(cam.position.x, cam.position.y, cam.position.z);
    const scale = config.tier.id === "potato" ? 0.55 : config.tier.id === "low" ? 0.72 : 1;
    for (const c of this.chunks) {
      const dx = this._camXZ.x - c.centre.x;
      const dz = this._camXZ.z - c.centre.z;
      const dy = this._camXZ.y - c.centre.y;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.35);
      let lod = this.lodSteps.length - 1;
      for (let k = 0; k < this.lodDistances.length; k++) {
        const bound = this.lodDistances[k] * scale * (c.lod <= k ? 1.12 : 1);
        if (d < bound) { lod = k; break; }
      }
      if (lod === c.lod) continue;
      const geo = this._chunkGeometry(c.ix0, c.iz0, c.ix1, c.iz1, this.lodSteps[lod]);
      if (!geo) continue;
      c.mesh.geometry = geo;
      c.lod = lod;
      this._lodChanges++;
    }
  }

  snapshot() {
    const lods = this.lodSteps.map(() => 0);
    for (const c of this.chunks) lods[c.lod]++;
    return {
      bounds: [this.x0, this.z0, this.x1, this.z1],
      spacing: this.spacing,
      grid: [this.nx, this.nz],
      seed: this.seed,
      chunks: this.chunks.length,
      lodOccupancy: lods,
      lodChanges: this._lodChanges,
      colliderStep: this.colliderStep,
      ...this.stats,
    };
  }

  dispose() {
    for (const g of this._geomCache.values()) g.dispose();
    this._geomCache.clear();
    this.shell?.geometry.dispose();
    this._mat?.dispose();
    this._colliderGeo?.dispose();
    signals.emit("world:collider", { id: "p09:leaf-nine", remove: true });
  }
}

const _n = { x: 0, y: 1, z: 0 };
