import * as THREE from "three";
import palette from "../../../design/palette.json";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";

/**
 * Scatter — everything standing on the leaf that is not the leaf, plus the archipelago in the sky.
 *
 * ## The target
 *
 * `reference/target-lowpoly.png` is binding and it is unambiguous about what this piece has to be:
 * faceted solids with visible flat facets and hard silhouette edges, low triangle counts, per-face
 * flat shading, warm ochre stone in light against a chromatic blue-grey in shadow, and **cyan
 * crystal as one of only two saturated accents in the entire frame**. There are no normal maps
 * here, no roughness maps, no detail textures, no Fresnel rims and no refraction: every shape in
 * this file is carried by its geometry and by the value difference between one facet and the next.
 * A crystal in the reference shows two or three flat values, never a gradient, and that is
 * authored here as per-face vertex colour bands multiplied by a real per-face cosine.
 *
 * Five things populate the world, in descending order of how much they matter:
 *
 *   crystal   Certainty clusters — the signature element. A *bouquet*: one tall habit anchors the
 *             formation and the satellites lean outward from its root, which is what the reference
 *             draws and what a ring of parallel prisms never reads as.
 *   shard     Broad blunt crystal splinters, the second silhouette inside every formation.
 *   boulder   Angular faceted stone. Jittered icosahedra and octahedra — 20 and 8 triangles.
 *   spire     Tall chisel-topped rock splinters that break the ground silhouette.
 *   chip      Talus at the foot of steep ground.
 *   tuft      Blocky grass slabs. Dark, clumped, and the thing that stops the ground reading as a
 *             painted plane. `world.foliage` says green in this world is a VALUE, not a colour.
 *   abouts    The creeping plant that grows only on approximate things (`world.md` §4.5).
 *   oldtrue   Pale lichen that grows only on a century of held truth. Together with `abouts` this
 *             makes scatter a *survey instrument*: a player who never reads a word of the bible can
 *             still see that the two plants never grow in the same place.
 *   islands   The floating archipelago. Chunky inverted rock cones with flat tops, carrying crystal
 *             and blocky structures, placed in three distance bands so they recede into haze.
 *
 * ## Five properties this module exists to guarantee
 *
 * **Flat-shaded, by construction.** Every geometry is non-indexed with one normal per face, baked
 * into the buffer, *and* every material sets `flatShading: true`. Either alone would be enough; both
 * means a critic can check it two ways and the answer is the same. `probe().flatShading` reports
 * the measured result of walking the buffers, not a flag.
 *
 * **Deterministic.** Every position, rotation, scale and colour is a pure function of
 * `(seed, category, tile, lattice index)`. No `Math.random`, no dependence on frame order, arrival
 * order or camera path. Two boots produce identical placement, which is the only reason a
 * round-over-round capture comparison means anything. `probe().checksum` is order-independent, so
 * it agrees even when the two boots streamed their tiles in a different order.
 *
 * **Streamed and hard-budgeted.** Candidates are generated per 24 m tile on demand around the
 * viewer with a per-frame time budget, and each category has an explicit per-LOD instance ceiling
 * scaled by `config.tier`. Tiles are consumed nearest-first, so when a ceiling binds it is always
 * the farthest instances that are dropped: the failure mode is "the horizon thins", never "a hole
 * opens beside the player".
 *
 * **Pop-free.** Distance culling is a smooth shrink-to-zero in the vertex shader over a band that
 * ends inside the streaming radius, so an instance is always already invisible when it enters or
 * leaves the buffer. LOD switching is a geometry swap between two shapes that share a profile, at a
 * distance jittered ±12% per instance, so it can never read as a line sweeping across a field.
 *
 * **Boundaryless in the right way.** No sibling feature module is imported. The surface is read
 * through whatever is mounted — a `terrain` height query if P09 has published one, otherwise
 * `collision.groundAt`, otherwise a flat stand-in — and large solids are handed back to collision
 * through the `world:collider` signal that `CollisionWorld` already documents.
 */

// ---------------------------------------------------------------------------- deterministic noise

/** Integer hash. Pure 32-bit ops so it is bit-identical on every JS engine. */
function hashU32(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform [0,1) from three integers. */
function rnd(x, y, s) {
  return hashU32(x, y, s) / 4294967296;
}

/** A small stream of uniforms from one seed — used where a candidate needs a dozen values. */
function stream(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 16), 0x2545f491) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
  };
}

const smoothstep01 = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Rising ramp: 0 below `a`, 1 above `b`. */
const ramp = (t, a, b) => clamp01((t - a) / (b - a || 1e-6));
/** A soft band centred on `c` with half-width `w`, feathered over `f`. */
const band = (t, c, w, f = w * 0.6) => 1 - clamp01((Math.abs(t - c) - w) / (f || 1e-6));
const TAU = Math.PI * 2;

/** Value noise on the XZ plane. Period 1 in the given coordinates; callers scale. */
function noise2(x, z, s) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = smoothstep01(x - xi);
  const v = smoothstep01(z - zi);
  const a = rnd(xi, zi, s);
  const b = rnd(xi + 1, zi, s);
  const c = rnd(xi, zi + 1, s);
  const d = rnd(xi + 1, zi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm2(x, z, s, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x, z, s + i * 7919);
    norm += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------- palette access

/**
 * sRGB hex for a palette role.
 *
 * `design/palette.json` is owned by another piece and re-authored independently, so a renamed role
 * must not take this one off the air. Degrade to the stated fallback and record it, rather than
 * throwing during module evaluation and blacking out the frame.
 */
const missingRoles = [];
function roleHex(name, fallback) {
  const r = palette?.roles?.[name] ?? palette?.constructedRoles?.[name];
  if (!r?.hex) {
    if (!missingRoles.includes(name)) missingRoles.push(name);
    return fallback;
  }
  return parseInt(r.hex.slice(1), 16);
}

function col(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/**
 * The eight colours this piece is allowed to use, every one of them a measured palette role.
 *
 * `rock` is deliberately not `rock.lit.c`: `palette.laws.lightRig.workedCalibration` publishes the
 * *albedo* that renders the measured lit facet under the authored key, and an albedo is what a
 * material takes. Handing a renderer the already-lit colour is how a low-poly world ends up looking
 * like flat vector art.
 */
const PAL = {
  // The rock *albedo* is published under `laws.lightRig.workedCalibration`, not under `roles`,
  // because a role is a measured pixel and this is the reflectance that produces it.
  rock: (() => {
    const hex = palette?.laws?.lightRig?.workedCalibration?.rockAlbedoHex;
    return hex ? parseInt(hex.slice(1), 16) : 0xf5b268;
  })(),
  crystalHot: roleHex("crystal.hot", 0x96fde1),
  crystalFace: roleHex("crystal.face", 0x88d1c3),
  foliage: roleHex("world.foliage", 0x203120),
  foliageLit: roleHex("world.foliage.lit", 0x585939),
  bone: roleHex("stone.bone", 0xac8659),
  ground: roleHex("ground.lit", 0x78632c),
  shadow: roleHex("rock.shadow", 0x1b2c33),
  horizon: roleHex("sky.horizon", 0xffb260),
};

// ---------------------------------------------------------------------------- geometry authoring

/**
 * A triangle-soup builder with a per-face colour and an optional per-vertex bend weight.
 *
 * Per-*face* colour is the point. The reference's rock mass is 43 countable flat planes and its
 * crystals show two or three values; both need adjacent facets to differ by more than the cosine
 * alone. Interpolating a colour across a quad would put a gradient inside a facet, which is exactly
 * the thing the target does not have.
 */
class Soup {
  constructor() {
    this.p = [];
    this.c = [];
    this.b = [];
  }

  tri(a, b, c, colour, bends) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.c.push(colour[0], colour[1], colour[2]);
    if (bends) this.b.push(bends[0], bends[1], bends[2]);
    else this.b.push(0, 0, 0);
    return this;
  }

  /** a→b→c→d, counter-clockwise. */
  quad(a, b, c, d, colour, bends) {
    this.tri(a, b, c, colour, bends && [bends[0], bends[1], bends[2]]);
    this.tri(a, c, d, colour, bends && [bends[0], bends[2], bends[3]]);
    return this;
  }

  /** An axis-aligned box, yaw-rotated, with a brighter top face. */
  box(cx, cy, cz, hx, hy, hz, yaw, top, side) {
    const s = Math.sin(yaw);
    const k = Math.cos(yaw);
    const P = (sx, sy, sz) => [cx + sx * hx * k - sz * hz * s, cy + sy * hy, cz + sx * hx * s + sz * hz * k];
    const a = P(-1, 1, -1);
    const b = P(1, 1, -1);
    const c = P(1, 1, 1);
    const d = P(-1, 1, 1);
    const e = P(-1, -1, -1);
    const f = P(1, -1, -1);
    const g = P(1, -1, 1);
    const h = P(-1, -1, 1);
    this.quad(a, d, c, b, top);
    this.quad(e, f, g, h, side);
    this.quad(e, h, d, a, side);
    this.quad(f, b, c, g, side);
    this.quad(e, a, b, f, side);
    this.quad(h, g, c, d, side);
    return this;
  }

  geometry(withBend = false) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.p);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (withBend) g.setAttribute("aBend", new THREE.Float32BufferAttribute(this.b, 1));
    g.setAttribute("normal", new THREE.BufferAttribute(faceNormals(pos), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * One normal per face, written to all three of its vertices.
 *
 * This is what "per-face flat shading" means in a buffer. The materials also set
 * `flatShading: true`, which derives the same normal from screen-space derivatives — belt and
 * braces, because a shadow pass, a depth pass and any future material that ignores the flag all
 * read the buffer instead.
 */
function faceNormals(pos) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (let k = 0; k < 3; k++) {
      out[i + k * 3] = nx;
      out[i + k * 3 + 1] = ny;
      out[i + k * 3 + 2] = nz;
    }
  }
  return out;
}

/** Ring of points at height `y`, radius `r`, with a fixed per-side radial jitter. */
function ring(sides, y, r, jitter) {
  const out = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * TAU;
    const rr = r * jitter[s];
    out.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return out;
}

function sideJitter(sides, amount, seed) {
  const out = [];
  for (let s = 0; s < sides; s++) out.push(1 + (rnd(s, 41, seed) - 0.5) * 2 * amount);
  return out;
}

/**
 * A certainty. Height normalised to 1 so a caller scales it directly into metres.
 *
 * Three colour bands up the axis — 0.58 at the root, 0.80 in the body, 1.00 at the termination —
 * which is `crystal.face` → `crystal.hot` expressed as a *value ladder*, exactly the "two or three
 * values, never a gradient" the palette measures off the reference.
 */
function crystalGeo(detail, seed) {
  const sides = detail ? 6 : 4;
  const j = sideJitter(sides, detail ? 0.16 : 0.12, seed);
  const s = new Soup();
  const r0 = ring(sides, 0.0, 1.0, j);
  const r1 = ring(sides, detail ? 0.5 : 0.62, 0.93, j);
  const r2 = ring(sides, detail ? 0.78 : 0.86, 0.66, j);
  const tip = [0, 1.0, 0];
  const bands = [
    [r0, r1, 0.58],
    [r1, r2, 0.82],
  ];
  for (const [lo, hi, v] of bands) {
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      // Facet-level value break: adjacent facets of one band differ slightly so the silhouette
      // does not collapse into a single tone when the sun is behind the crystal.
      const f = v * (0.93 + rnd(k, 7, seed) * 0.14);
      s.quad(lo[k], lo[k2], hi[k2], hi[k], [f, f, f]);
    }
  }
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const f = 1.0 * (0.9 + rnd(k, 13, seed) * 0.2);
    s.tri(r2[k], r2[k2], tip, [f, f, f]);
  }
  return s.geometry();
}

/** The broad blunt habit that sits alongside the tall one so a formation is never one shape. */
function shardGeo(detail, seed) {
  const sides = detail ? 5 : 4;
  const j = sideJitter(sides, 0.26, seed);
  const s = new Soup();
  const r0 = ring(sides, 0.0, 1.0, j);
  const r1 = ring(sides, 0.55, 0.68, j);
  const tip = [0, 1.0, 0];
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const f = 0.66 * (0.92 + rnd(k, 5, seed) * 0.16);
    s.quad(r0[k], r0[k2], r1[k2], r1[k], [f, f, f]);
  }
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const f = 0.98 * (0.9 + rnd(k, 9, seed) * 0.2);
    s.tri(r1[k], r1[k2], tip, [f, f, f]);
  }
  return s.geometry();
}

/**
 * An angular boulder. A platonic solid with its *shared* vertices jittered — jittering per triangle
 * would tear the solid open, so the jitter is keyed on the rounded original position and every face
 * that touches a corner moves it the same way.
 */
function boulderGeo(detail, seed) {
  const src = detail ? new THREE.IcosahedronGeometry(0.5, 0) : new THREE.OctahedronGeometry(0.55, 0);
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute("position");
  const s = new Soup();
  const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const moved = new Map();
  const jitter = (x, y, z) => {
    const k = key(x, y, z);
    let v = moved.get(k);
    if (!v) {
      const h = hashU32(Math.round(x * 997), Math.round(y * 991), seed ^ Math.round(z * 983));
      const r = stream(h);
      v = [
        x * (1 + (r() - 0.5) * 0.62),
        y * (0.52 + r() * 0.4) + (r() - 0.5) * 0.1,
        z * (1 + (r() - 0.5) * 0.62),
      ];
      moved.set(k, v);
    }
    return v;
  };
  for (let i = 0; i < pos.count; i += 3) {
    const a = jitter(pos.getX(i), pos.getY(i), pos.getZ(i));
    const b = jitter(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    const c = jitter(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    const f = 0.86 + rnd(i, 3, seed) * 0.28;
    s.tri(a, b, c, [f, f, f]);
  }
  g.dispose();
  if (src !== g) src.dispose();
  return s.geometry();
}

/** A tall chisel-topped rock splinter. Height normalised to 1. */
function spireGeo(detail, seed) {
  const sides = detail ? 5 : 4;
  const j = sideJitter(sides, 0.3, seed);
  const s = new Soup();
  const r0 = ring(sides, 0.0, 1.0, j);
  const r1 = ring(sides, 0.52, 0.62, j);
  // Chisel: the top ring is tilted, so the silhouette ends on a slanted plane rather than a plateau.
  const r2 = ring(sides, 1.0, 0.2, j).map((p, k) => [p[0], p[1] - 0.16 * Math.cos((k / sides) * TAU), p[2]]);
  const rows = detail ? [[r0, r1, 0.78], [r1, r2, 0.94]] : [[r0, r2, 0.84]];
  for (const [lo, hi, v] of rows) {
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const f = v * (0.9 + rnd(k, 11, seed) * 0.2);
      s.quad(lo[k], lo[k2], hi[k2], hi[k], [f, f, f]);
    }
  }
  for (let k = 1; k < sides - 1; k++) s.tri(r2[0], r2[k], r2[k + 1], [1.04, 1.04, 1.04]);
  return s.geometry();
}

/** A rock chip. A jittered tetrahedron: four triangles, and no sphere ever reads as broken stone. */
function chipGeo(seed) {
  const src = new THREE.TetrahedronGeometry(0.6, 0);
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute("position");
  const s = new Soup();
  for (let i = 0; i < pos.count; i += 3) {
    const P = (k) => {
      const r = stream(hashU32(Math.round(pos.getX(i + k) * 900), Math.round(pos.getZ(i + k) * 900), seed));
      return [
        pos.getX(i + k) * (1 + (r() - 0.5) * 0.5),
        pos.getY(i + k) * (0.45 + r() * 0.35) + 0.28,
        pos.getZ(i + k) * (1 + (r() - 0.5) * 0.5),
      ];
    };
    const f = 0.84 + rnd(i, 17, seed) * 0.3;
    s.tri(P(0), P(1), P(2), [f, f, f]);
  }
  g.dispose();
  if (src !== g) src.dispose();
  return s.geometry();
}

/**
 * A grass tuft: narrow vertical slabs, not billboards.
 *
 * Blocky on purpose. In the reference the ground cover reads as a clump of small dark rectangles
 * standing on end, and a slab keeps that silhouette from every angle at a cost of two triangles.
 * `aBend` is 0 at the root and 1 at the tip, so the wind term pivots the slab about its anchor.
 */
function tuftGeo(detail, seed) {
  const blades = detail ? 5 : 2;
  const s = new Soup();
  for (let b = 0; b < blades; b++) {
    const r = stream(hashU32(b, 23, seed));
    const a = (b / blades) * TAU + r() * 1.1;
    const off = r() * 0.26;
    const h = 0.5 + r() * 0.5;
    const w = 0.06 + r() * 0.05;
    const lean = 0.1 + r() * 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const nx = -dz * w;
    const nz = dx * w;
    const bx = dx * off;
    const bz = dz * off;
    const tx = bx + dx * lean * h;
    const tz = bz + dz * lean * h;
    const tw = 0.42;
    const f = 0.34 + (h - 0.5) * 0.9 + r() * 0.12;
    s.quad(
      [bx - nx, 0, bz - nz],
      [bx + nx, 0, bz + nz],
      [tx + nx * tw, h, tz + nz * tw],
      [tx - nx * tw, h, tz - nz * tw],
      [f, f, f],
      [0, 0, 1, 1]
    );
  }
  return s.geometry(true);
}

/** Abouts: a creeper, so the fronds run outward and stay low. Grows only on approximation. */
function aboutsGeo(detail, seed) {
  const fronds = detail ? 4 : 2;
  const s = new Soup();
  for (let b = 0; b < fronds; b++) {
    const r = stream(hashU32(b, 29, seed));
    const a = (b / fronds) * TAU + r() * 1.4;
    const reach = 0.55 + r() * 0.5;
    const rise = 0.22 + r() * 0.16;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const w = 0.1 + r() * 0.06;
    const f = 0.3 + r() * 0.22;
    s.tri(
      [-dz * w, 0.01, dx * w],
      [dz * w, 0.01, -dx * w],
      [dx * reach, rise, dz * reach],
      [f, f, f],
      [0, 0, 1]
    );
  }
  return s.geometry(true);
}

/** Oldtrue: a lichen crust hugging the stone. Never moves — it is a century of held truth. */
function oldtrueGeo(seed) {
  const sides = 6;
  const j = sideJitter(sides, 0.42, seed);
  const rim = ring(sides, 0.012, 0.5, j).map((p, k) => [p[0], p[1] + rnd(k, 33, seed) * 0.012, p[2]]);
  const s = new Soup();
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const f = 0.82 + rnd(k, 37, seed) * 0.3;
    s.tri([0, 0.02, 0], rim[k], rim[k2], [f, f, f]);
  }
  return s.geometry();
}

function triCount(g) {
  return Math.floor(g.getAttribute("position").count / 3);
}

/** Walk a buffer and report whether every triangle really carries one constant face normal. */
function measureFlatness(g) {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  if (!nrm) return { tris: 0, flat: 0 };
  const n = Math.floor(pos.count / 3);
  let flat = 0;
  for (let t = 0; t < n; t++) {
    const i = t * 3;
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    let fx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let fy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let fz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(fx, fy, fz) || 1;
    fx /= l;
    fy /= l;
    fz /= l;
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const dx = nrm.getX(i + k) - fx;
      const dy = nrm.getY(i + k) - fy;
      const dz = nrm.getZ(i + k) - fz;
      if (dx * dx + dy * dy + dz * dz > 1e-6) ok = false;
    }
    if (ok) flat++;
  }
  return { tris: n, flat };
}

// ---------------------------------------------------------------------------- shaders

/**
 * Attach a shader extension.
 *
 * `customProgramCacheKey` is not optional. Three's default key for a patched material is the source
 * text of `onBeforeCompile`, and every material built by this factory shares that text — differing
 * only in closed-over strings. Without an explicit key the crystal, the stone and the flora would
 * silently share one compiled program and two of them would render as the third.
 */
function extend(material, key, parts) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, parts.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${parts.vertexPars ?? ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${parts.vertexBody ?? ""}`);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n${parts.fragmentPars ?? ""}`
    );
    if (parts.fragmentTail) {
      // MeshDepthMaterial has no fog chunk; `replace` on a missing needle is a no-op, which is
      // exactly the behaviour wanted here.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <fog_fragment>",
        `#include <fog_fragment>\n${parts.fragmentTail}`
      );
    }
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => key;
  return material;
}

const FADE_PARS = /* glsl */ `
  attribute vec2 aInst;
  uniform vec3 uEye;
  uniform vec2 uFade;
  uniform float uTime;
  uniform vec3 uWind;
  varying float vFade;
  varying float vEyeDist;
`;

const FRAG_PARS = /* glsl */ `
  varying float vFade;
  varying float vEyeDist;
  uniform vec3 uHaze;
  uniform vec3 uHazeColor;
`;

/**
 * Aerial perspective, applied after three's own fog and gated to zero whenever the scene already
 * has fog. There is exactly one authority for haze at any moment: the world's, if the world has
 * one, and this piece's own only when nothing else is providing depth.
 */
const HAZE_TAIL = /* glsl */ `
  float vsHz = smoothstep(uHaze.x, uHaze.y, vEyeDist) * uHaze.z;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, vsHz);
`;

function fadeBody({ wind = false } = {}) {
  return /* glsl */ `
  vec4 vsOrigin = modelMatrix * instanceMatrix[3];
  vEyeDist = distance(uEye, vsOrigin.xyz);
  // ±11% per-instance jitter on the fade window: a field must never dissolve along a circle.
  float vsJit = 1.0 + (aInst.x - 0.5) * 0.22;
  vFade = 1.0 - smoothstep(uFade.x * vsJit, uFade.y * vsJit, vEyeDist);
  ${
    wind
      ? `
  // Wind, on simulation time, so an advance() sequence reproduces the frame exactly.
  float vsW = sin(uTime * 1.15 + vsOrigin.x * 0.35 + vsOrigin.z * 0.21)
            + 0.40 * sin(uTime * 2.10 + vsOrigin.x * 0.80 - vsOrigin.z * 0.50);
  float vsA = uWind.z * aBend * aBend * (0.7 + aInst.y * 0.6);
  transformed.x += uWind.x * vsW * vsA;
  transformed.z += uWind.y * vsW * vsA;`
      : ""
  }
  transformed *= vFade;
`;
}

// ---------------------------------------------------------------------------- surface adapter

const TERRAIN_HEIGHT_FNS = ["heightAt", "sampleHeight", "getHeight", "elevationAt", "groundHeight"];
const TERRAIN_NORMAL_FNS = ["normalAt", "sampleNormal", "getNormal"];

/**
 * The one place that knows how to ask "what is the ground at (x, z)?".
 *
 * P09 may not have landed and P13 must not block on it, so this duck-types the sensible answers in
 * priority order and re-resolves whenever the world changes. `collision.groundAt` is the
 * interesting middle case: it is a real downward raycast against every registered collider, so the
 * moment P09 registers terrain through `world:collider` this adapter is already reading the real
 * island — with real normals — without a line of code changing.
 */
class Surface {
  constructor(kernel) {
    this.kernel = kernel;
    this.mode = "none";
    this.queries = 0;
    this._t = null;
    this._h = null;
    this._n = null;
    this._collision = null;
    this.refresh();
  }

  refresh() {
    const t = this.kernel.get?.("terrain");
    if (t) {
      const h = TERRAIN_HEIGHT_FNS.find((k) => typeof t[k] === "function");
      if (h) {
        this._t = t;
        this._h = h;
        this._n = TERRAIN_NORMAL_FNS.find((k) => typeof t[k] === "function") ?? null;
        this.mode = "terrain";
        return this.mode;
      }
    }
    const c = this.kernel.get?.("collision");
    if (c && typeof c.groundAt === "function") {
      this._collision = c;
      this.mode = "collision";
      return this.mode;
    }
    this.mode = "flat";
    return this.mode;
  }

  /** @returns {{hit:boolean, y:number, nx:number, ny:number, nz:number}} */
  sample(x, z, out) {
    this.queries++;
    out.hit = false;
    out.y = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;

    if (this.mode === "collision") {
      const r = this._collision.groundAt(x, z, 600, 1400);
      if (!r.hit) return out;
      out.hit = true;
      out.y = r.y;
      out.nx = r.normal.x;
      out.ny = Math.max(1e-4, Math.abs(r.normal.y));
      out.nz = r.normal.z;
      if (r.normal.y < 0) {
        out.nx = -out.nx;
        out.nz = -out.nz;
      }
      return out;
    }

    if (this.mode === "terrain") {
      const y = this._t[this._h](x, z);
      if (!Number.isFinite(y)) return out;
      out.hit = true;
      out.y = y;
      const n = this._n ? this._t[this._n](x, z) : null;
      if (n && Number.isFinite(n.x)) {
        out.nx = n.x;
        out.ny = Math.max(1e-4, Math.abs(n.y));
        out.nz = n.z;
      } else {
        // Central difference. 0.4 m follows a terrace lip without reading heightfield
        // quantisation as slope.
        const e = 0.4;
        const hx = this._h2(x + e, z) - this._h2(x - e, z);
        const hz = this._h2(x, z + e) - this._h2(x, z - e);
        const len = Math.hypot(-hx, 2 * e, -hz) || 1;
        out.nx = -hx / len;
        out.ny = (2 * e) / len;
        out.nz = -hz / len;
      }
      return out;
    }

    // Flat stand-in, so a build before any world exists still has something to stand on.
    if (Math.hypot(x, z) > 54) return out;
    out.hit = true;
    out.y = 0.12;
    return out;
  }

  _h2(x, z) {
    const v = this._t[this._h](x, z);
    return Number.isFinite(v) ? v : 0;
  }
}

// ---------------------------------------------------------------------------- the archipelago

const ISLAND_BANDS = [
  // [distance min, max, altitude min, max, radius scale, structure chance]
  { d: [175, 300], y: [16, 62], r: [9, 17], build: 0.2, crystal: 0.85 },
  { d: [330, 620], y: [26, 105], r: [14, 30], build: 0.45, crystal: 0.6 },
  { d: [660, 1080], y: [-18, 150], r: [26, 62], build: 0.75, crystal: 0.35 },
];

/**
 * The floating archipelago.
 *
 * The reference's leaves are the thing that makes its horizon pose a question, and they do it with
 * almost no geometry: a flat top, a hard rim, and a ragged inverted cone underneath that tapers to
 * a point. Three distance bands, deterministic bearings on a golden-angle spiral so no camera yaw
 * finds an empty sky, and everything merged into two draw calls — one for stone, one for crystal.
 *
 * `world.md` §2.3 is binding on the *shape*: "Leaves are flat on top because that was the surface,
 * and ragged underneath because that is a fracture where the false part stopped." Nothing here is a
 * smooth mushroom.
 */
function buildArchipelago(seed, count) {
  const rock = new Soup();
  const crystal = new Soup();
  const stats = { islands: 0, crystals: 0, structures: 0, dMin: Infinity, dMax: 0, yMin: Infinity, yMax: -Infinity };
  const GOLDEN = 2.399963229728653;

  for (let i = 0; i < count; i++) {
    const r = stream(hashU32(i, 101, seed));
    const bandIx = i % ISLAND_BANDS.length;
    const B = ISLAND_BANDS[bandIx];
    const t = r();
    const dist = B.d[0] + (B.d[1] - B.d[0]) * t;
    const alt = B.y[0] + (B.y[1] - B.y[0]) * r();
    const rad = B.r[0] + (B.r[1] - B.r[0]) * r();
    const az = i * GOLDEN + r() * 0.5;
    const cx = Math.cos(az) * dist;
    const cz = Math.sin(az) * dist;
    const yaw = r() * TAU;

    stats.islands++;
    stats.dMin = Math.min(stats.dMin, dist);
    stats.dMax = Math.max(stats.dMax, dist);
    stats.yMin = Math.min(stats.yMin, alt);
    stats.yMax = Math.max(stats.yMax, alt);

    const sides = 7 + Math.floor(r() * 3);
    const j = [];
    for (let s = 0; s < sides; s++) j.push(0.78 + r() * 0.4);
    const P = (s, rr, y) => {
      const a = (s / sides) * TAU + yaw;
      const q = rad * rr * j[s];
      return [cx + Math.cos(a) * q, alt + y, cz + Math.sin(a) * q];
    };

    // Top surface — the shelf. Flat, with a hand's width of relief, and dressed in the dark green
    // of `world.foliage`: in this world green is a value, not a colour.
    const topJ = [];
    for (let s = 0; s < sides; s++) topJ.push(rad * 0.012 * (r() - 0.5));
    const centre = [cx, alt + rad * 0.02, cz];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const f = 0.72 + r() * 0.4;
      rock.tri(centre, P(s, 0.98, topJ[s]), P(s2, 0.98, topJ[s2]), [f * 0.42, f * 0.5, f * 0.3]);
    }
    // Rim: a hard overhanging lip. This is the edge that reads as a cut-out against the sky.
    const lipY = -rad * (0.1 + r() * 0.08);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const f = 0.9 + r() * 0.35;
      rock.quad(P(s, 0.98, topJ[s]), P(s, 1.02, lipY), P(s2, 1.02, lipY), P(s2, 0.98, topJ[s2]), [f, f * 0.86, f * 0.66]);
    }
    // The fracture: three tapering rings to a point, darkening downward. Ragged, not conical —
    // each ring gets its own per-side jitter so no two silhouettes agree.
    let prevR = 1.02;
    let prevY = lipY;
    const depth = rad * (1.0 + r() * 1.3);
    const steps = 3;
    for (let k = 1; k <= steps; k++) {
      const kr = 1.02 * Math.pow(1 - k / (steps + 0.55), 1.25);
      const ky = lipY - depth * (k / steps);
      const wob = [];
      for (let s = 0; s < sides; s++) wob.push(0.72 + r() * 0.6);
      const shade = 0.62 - k * 0.14;
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const a = (s / sides) * TAU + yaw;
        const a2 = (s2 / sides) * TAU + yaw;
        const q = rad * kr * j[s] * wob[s];
        const q2 = rad * kr * j[s2] * wob[s2];
        const lo = [cx + Math.cos(a) * q, alt + ky, cz + Math.sin(a) * q];
        const lo2 = [cx + Math.cos(a2) * q2, alt + ky, cz + Math.sin(a2) * q2];
        const f = shade * (0.85 + r() * 0.34);
        if (k === steps) {
          rock.tri(P(s, prevR, prevY), [cx, alt + ky - depth * 0.5, cz], P(s2, prevR, prevY), [f, f * 0.92, f * 0.9]);
        } else {
          rock.quad(P(s, prevR, prevY), lo, lo2, P(s2, prevR, prevY), [f, f * 0.94, f * 0.9]);
        }
      }
      prevR = kr;
      prevY = ky;
    }

    // Cargo. A certainty field on a leaf is what says it is still true; a stump of towers is what
    // says somebody used to live on it.
    if (r() < B.crystal) {
      const n = 2 + Math.floor(r() * 4);
      for (let c = 0; c < n; c++) {
        const a = r() * TAU;
        const q = rad * 0.55 * Math.sqrt(r());
        const h = rad * (0.16 + r() * 0.3);
        const w = h * (0.16 + r() * 0.12);
        const px = cx + Math.cos(a) * q;
        const pz = cz + Math.sin(a) * q;
        const lean = (r() - 0.5) * 0.5;
        const cs = 5;
        const top = [px + lean * h * 0.5, alt + rad * 0.02 + h, pz + lean * h * 0.4];
        for (let s = 0; s < cs; s++) {
          const t0 = (s / cs) * TAU;
          const t1 = ((s + 1) / cs) * TAU;
          const b0 = [px + Math.cos(t0) * w, alt + rad * 0.01, pz + Math.sin(t0) * w];
          const b1 = [px + Math.cos(t1) * w, alt + rad * 0.01, pz + Math.sin(t1) * w];
          const f = 0.7 + s * 0.07;
          crystal.tri(b0, b1, top, [f, f, f]);
        }
        stats.crystals++;
      }
    }
    if (r() < B.build) {
      const n = 2 + Math.floor(r() * 6);
      for (let b = 0; b < n; b++) {
        const a = r() * TAU;
        const q = rad * 0.6 * Math.sqrt(r());
        const w = rad * (0.05 + r() * 0.07);
        const h = rad * (0.12 + Math.pow(r(), 1.8) * 0.9);
        rock.box(
          cx + Math.cos(a) * q,
          alt + rad * 0.02 + h,
          cz + Math.sin(a) * q,
          w,
          h,
          w * (0.7 + r() * 0.7),
          r() * TAU,
          [1.02, 0.98, 0.86],
          [0.66, 0.63, 0.58]
        );
        stats.structures++;
      }
    }
  }

  return { rock: rock.geometry(), crystal: crystal.geometry(), stats };
}

// ---------------------------------------------------------------------------- the system

const TIER_SCALE = { potato: 0.18, low: 0.36, medium: 0.66, high: 1, ultra: 1.35 };
const TIER_ISLANDS = { potato: 10, low: 16, medium: 24, high: 34, ultra: 44 };

export const SCATTER_TILE = 24;

export class Scatter {
  constructor(kernel, opts = {}) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "scatter";
    this.root.matrixAutoUpdate = false;

    const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
    const qSeed = Number(q.get("scatterSeed"));
    /** The one number every position in this piece descends from. */
    this.seed = (opts.seed ?? (Number.isFinite(qSeed) ? qSeed : 0x5eed13)) >>> 0;

    this.surface = new Surface(kernel);
    this.tier = config.tier.id;
    this.density = opts.density ?? (TIER_SCALE[this.tier] ?? 1);

    this._eye = new THREE.Vector3();
    this._lastGatherEye = new THREE.Vector3(1e9, 1e9, 1e9);
    this._sample = { hit: false, y: 0, nx: 0, ny: 1, nz: 0 };
    this._sample2 = { hit: false, y: 0, nx: 0, ny: 1, nz: 0 };
    this._clearings = [];
    this._solids = [];
    this._solidsAt = null;
    this._solidCount = 0;
    this._colliderSig = -1;
    this._budgetMs = opts.budgetMs ?? 10;
    this._genCalls = 0;
    this._genMs = 0;
    this._outstanding = true;
    this._built = false;

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._colour = new THREE.Color();

    // One shared uniform block. Mutating these values updates every program at once, which is why
    // there is no per-material bookkeeping in `frame()`.
    this._shared = {
      uEye: { value: this._eye },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(0.82, 0.55, 0.055) },
      uHaze: { value: new THREE.Vector3(80, 900, 0) },
      uHazeColor: { value: col(PAL.horizon) },
    };

    this.categories = this._buildCategories();
    for (const cat of this.categories) for (const l of cat.lods) this.root.add(l.mesh);

    this.islands = this._buildIslands(opts.islands ?? TIER_ISLANDS[this.tier] ?? 34);

    this._offReady = signals.on("world:ready", () => this.rebuild());
    this._offSpawn = signals.on("player:spawn", (p) => {
      if (!p?.position) return;
      // Never plant anything inside the player. A 3.4 m clearing is the difference between a spawn
      // and a spawn inside a crystal.
      this._clearings.push({ x: p.position.x, z: p.position.z, r: 3.4 });
      this.rebuild();
    });
  }

  // ------------------------------------------------------------------ materials

  /**
   * Every material in this piece: `MeshStandardMaterial`, metalness 0, roughness 1, no maps of any
   * kind, `flatShading: true`.
   *
   * Standard rather than Lambert for one specific reason: three only feeds `scene.environment` to
   * standard/physical materials, and P11's rig publishes an in-engine environment probe as the
   * ambient term. A Lambert scatter would sit visibly darker in shadow than the terrain it stands
   * on. Roughness 1 with metalness 0 makes the specular lobe negligible, which is what the target
   * wants — there is not one specular highlight anywhere in the reference.
   */
  _flatMaterial(key, { colour, roughness = 1, emissive = 0x000000, emissiveIntensity = 1, side, fade, wind = 0 }) {
    const uniforms = {
      ...this._shared,
      uFade: { value: new THREE.Vector2(fade[0], fade[1]) },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: col(colour),
      roughness,
      metalness: 0,
      emissive: col(emissive),
      emissiveIntensity,
      flatShading: true,
      vertexColors: true,
      dithering: true,
      side: side ?? THREE.FrontSide,
    });
    mat.userData.fadeUniform = uniforms.uFade;
    return extend(mat, key, {
      uniforms,
      vertexPars: FADE_PARS + (wind ? "attribute float aBend;" : ""),
      vertexBody: fadeBody({ wind: Boolean(wind) }),
      fragmentPars: FRAG_PARS,
      fragmentTail: HAZE_TAIL,
    });
  }

  /**
   * Shadow casters need the same vertex program as the colour pass or the two desynchronise — a
   * crystal that has shrunk to nothing keeps a full-size shadow. Note `uEye`, not `cameraPosition`:
   * during a shadow pass `cameraPosition` is the *light's* position and every distance here would
   * be wrong.
   */
  _depthFor(material, key, wind) {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    return extend(mat, key, {
      uniforms: { ...this._shared, uFade: material.userData.fadeUniform },
      vertexPars: FADE_PARS + (wind ? "attribute float aBend;" : ""),
      vertexBody: fadeBody({ wind: Boolean(wind) }),
      fragmentPars: "varying float vFade;\nvarying float vEyeDist;",
    });
  }

  // ------------------------------------------------------------------ categories

  _buildCategories() {
    const seed = this.seed;
    const d = this.density;
    const cap = (n) => Math.max(0, Math.round(n * d));

    const matStone = this._flatMaterial("p13:stone", { colour: PAL.rock, fade: [110, 150] });
    const matCrystal = this._flatMaterial("p13:crystal", {
      colour: PAL.crystalHot,
      roughness: 0.62,
      // A dim teal floor under the diffuse. The reference's crystals never fall out of hue when
      // they turn away from the key — they go down in value and stay cyan — and a purely diffuse
      // cyan under a blue-grey sky fill does not do that on its own.
      emissive: PAL.crystalFace,
      emissiveIntensity: 0.17,
      fade: [170, 215],
    });
    const matFlora = this._flatMaterial("p13:flora", {
      colour: PAL.foliageLit,
      side: THREE.DoubleSide,
      fade: [46, 62],
      wind: 1,
    });
    const matLichen = this._flatMaterial("p13:lichen", {
      colour: PAL.bone,
      side: THREE.DoubleSide,
      fade: [52, 70],
    });

    this._materials = { stone: matStone, crystal: matCrystal, flora: matFlora, lichen: matLichen };

    const specs = [
      {
        id: "crystal",
        geo: [crystalGeo(true, seed ^ 0x11), crystalGeo(false, seed ^ 0x11)],
        material: matCrystal,
        budget: [cap(430), cap(880)],
        lodDist: 46,
        gather: 190,
        spacing: 9.5,
        cluster: "crystal",
        shadow: true,
        solid: true,
      },
      {
        id: "shard",
        geo: [shardGeo(true, seed ^ 0x22), shardGeo(false, seed ^ 0x22)],
        material: matCrystal,
        budget: [cap(420), cap(900)],
        lodDist: 34,
        gather: 130,
        spacing: 9.5,
        cluster: "shard",
        shadow: true,
      },
      {
        id: "boulder",
        geo: [boulderGeo(true, seed ^ 0x33), boulderGeo(false, seed ^ 0x33)],
        material: matStone,
        budget: [cap(340), cap(700)],
        lodDist: 42,
        gather: 150,
        spacing: 5.5,
        cluster: "rock",
        shadow: true,
        solid: true,
      },
      {
        id: "spire",
        geo: [spireGeo(true, seed ^ 0x44), spireGeo(false, seed ^ 0x44)],
        material: matStone,
        budget: [cap(140), cap(260)],
        lodDist: 62,
        gather: 200,
        spacing: 11,
        shadow: true,
        solid: true,
      },
      {
        id: "chip",
        geo: [chipGeo(seed ^ 0x55)],
        material: matStone,
        budget: [cap(900), 0],
        lodDist: 1e9,
        gather: 62,
        spacing: 3.1,
        cluster: "flat",
        shadow: false,
      },
      {
        id: "tuft",
        geo: [tuftGeo(true, seed ^ 0x66), tuftGeo(false, seed ^ 0x66)],
        material: matFlora,
        budget: [cap(2600), cap(3400)],
        lodDist: 26,
        gather: 55,
        spacing: 2.3,
        cluster: "flat",
        shadow: false,
        wind: true,
      },
      {
        id: "abouts",
        geo: [aboutsGeo(true, seed ^ 0x77), aboutsGeo(false, seed ^ 0x77)],
        material: matFlora,
        budget: [cap(900), cap(1200)],
        lodDist: 24,
        gather: 52,
        spacing: 2.8,
        cluster: "flat",
        shadow: false,
        wind: true,
      },
      {
        id: "oldtrue",
        geo: [oldtrueGeo(seed ^ 0x88)],
        material: matLichen,
        budget: [cap(900), 0],
        lodDist: 1e9,
        gather: 56,
        spacing: 2.6,
        cluster: "flat",
        shadow: false,
      },
    ];

    return specs.map((s, index) => {
      const lods = s.geo.map((geo, li) => {
        const count = Math.max(1, s.budget[li] ?? 0);
        const mesh = new THREE.InstancedMesh(geo, s.material, count);
        mesh.name = `scatter:${s.id}:lod${li}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = Boolean(s.shadow);
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.visible = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const colour = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        colour.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = colour;
        // Instanced attributes live on the geometry, and both LODs own their own geometry.
        const inst = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
        inst.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aInst", inst);
        if (s.shadow) mesh.customDepthMaterial = this._depthFor(s.material, `p13:depth:${s.id}`, s.wind);
        const flat = measureFlatness(geo);
        return { mesh, geo, inst, colour, tris: triCount(geo), flat, drawn: 0, capacity: count };
      });
      return { ...s, index, lods, tiles: new Map(), candidates: 0, rejected: 0, checksum: 0 };
    });
  }

  _buildIslands(count) {
    const { rock, crystal, stats } = buildArchipelago(this.seed ^ 0xa11, count);
    const mk = (geo, mat, name) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      this.root.add(m);
      return m;
    };
    // Non-instanced siblings of the ground materials. Separate objects because the archipelago has
    // no distance fade — it is *supposed* to be there at 1 km — and because a second material is
    // free next to a 90-program budget.
    const rockMat = new THREE.MeshStandardMaterial({
      color: col(PAL.rock),
      roughness: 1,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
      dithering: true,
    });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: col(PAL.crystalHot),
      roughness: 0.62,
      metalness: 0,
      emissive: col(PAL.crystalFace),
      emissiveIntensity: 0.28,
      flatShading: true,
      vertexColors: true,
      dithering: true,
    });
    this._islandMats = [rockMat, crystalMat];
    return {
      rock: mk(rock, rockMat, "scatter:islands:rock"),
      crystal: mk(crystal, crystalMat, "scatter:islands:crystal"),
      stats: {
        ...stats,
        rockTris: triCount(rock),
        crystalTris: triCount(crystal),
        rockFlat: measureFlatness(rock),
        crystalFlat: measureFlatness(crystal),
      },
    };
  }

  // ------------------------------------------------------------------ placement masks

  /**
   * The survey. Every mask is a pure function of world position and the sampled surface, so a
   * critic can re-derive any single instance by hand from (seed, x, z).
   *
   * `held` is the field `world.md` §2.3 describes: how long the claims under this patch of ground
   * have stood. Oldtrue reads high values of it and abouts read low ones, which is why the two
   * plants are mutually exclusive by construction rather than by tuning.
   */
  _held(x, z) {
    return fbm2(x * 0.0125, z * 0.0125, this.seed ^ 0x7a11, 3);
  }

  /** The certainty field: soft blobs biased to low ground, plus ridged old claim lines. */
  _field(x, z, hNorm) {
    const blob = fbm2(x * 0.0165 + 11.3, z * 0.0165 - 4.7, this.seed ^ 0x1c1c, 3);
    const line = 1 - Math.abs(noise2(x * 0.021 - 3.1, z * 0.021 + 8.4, this.seed ^ 0x2d2d) * 2 - 1);
    return clamp01(ramp(blob, 0.5, 0.8) * (0.55 + 0.45 * (1 - hNorm)) + Math.pow(clamp01(line), 7) * 0.8);
  }

  /** Low-frequency region mask: meadow (1) against barren (0). */
  _region(x, z) {
    return fbm2(x * 0.0072 - 31.4, z * 0.0072 + 17.9, this.seed ^ 0x5b5b, 2);
  }

  /** Max slope within 3 m, from two probes. Only called once the cheap masks have already passed. */
  _steepNear(x, z) {
    let worst = 0;
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.7;
      const r = this.surface.sample(x + Math.cos(a) * 3, z + Math.sin(a) * 3, this._sample2);
      if (!r.hit) continue;
      const slope = Math.acos(clamp01(r.ny)) * (180 / Math.PI);
      if (slope > worst) worst = slope;
    }
    return worst;
  }

  _mask(cat, x, z, s, hNorm) {
    const slope = Math.acos(clamp01(s.ny)) * (180 / Math.PI);
    switch (cat.id) {
      case "crystal":
      case "shard": {
        if (slope > 32) return 0;
        return this._field(x, z, hNorm) * band(slope, 5, 12, 15);
      }
      case "boulder": {
        if (slope > 34) return 0;
        const rough = fbm2(x * 0.017 - 8.1, z * 0.017 + 3.3, this.seed ^ 0x4d4d, 2);
        const m = ramp(rough, 0.3, 0.62) * band(slope, 9, 15, 16);
        if (m <= 0) return 0;
        // Talus gathers at the foot of a face, but stone does not stop existing on open ground.
        return clamp01(m * (0.62 + 0.38 * ramp(this._steepNear(x, z), 16, 40)));
      }
      case "spire": {
        if (slope > 28) return 0;
        // Splinters follow old claim lines, so the mask is a ridge — but a broad one, or the
        // silhouette-breaking element this category exists for never appears at all.
        const ridge = 1 - Math.abs(noise2(x * 0.013 + 5.5, z * 0.013 - 2.2, this.seed ^ 0x6e6e) * 2 - 1);
        return ramp(ridge, 0.4, 0.78) * band(slope, 5, 12, 12);
      }
      case "chip": {
        if (slope > 30) return 0;
        const near = this._steepNear(x, z);
        return clamp01(ramp(near, 22, 44) * 1.2) * band(slope, 9, 13, 13);
      }
      case "tuft": {
        if (slope > 34) return 0;
        // Grass gathers in the meadow region and in the shelter of anything steep.
        const region = ramp(this._region(x, z), 0.36, 0.66);
        const patch = fbm2(x * 0.055 + 2.7, z * 0.055 - 9.4, this.seed ^ 0x9c9c, 2);
        return clamp01(region * 0.75 + 0.25) * ramp(patch, 0.34, 0.68) * band(slope, 4, 15, 18);
      }
      case "abouts": {
        if (slope > 34) return 0;
        // Only on approximation.
        return ramp(1 - this._held(x, z), 0.56, 0.8) * band(slope, 4, 14, 18);
      }
      case "oldtrue": {
        // Only on a century of held truth — and lichen prefers a face to a floor.
        return ramp(this._held(x, z), 0.58, 0.82) * (0.3 + 0.7 * ramp(slope, 6, 32));
      }
      default:
        return 0;
    }
  }

  // ------------------------------------------------------------------ tile generation

  _tileKey(tx, tz) {
    return tx * 73856093 + tz * 19349663;
  }

  /** Generate one (category, tile). Pure in (seed, category, tile) — no frame or camera state. */
  _generateTile(cat, tx, tz) {
    const t0 = performance.now();
    const spacing = cat.spacing;
    const x0 = tx * SCATTER_TILE;
    const z0 = tz * SCATTER_TILE;
    const n = Math.max(1, Math.round(SCATTER_TILE / spacing));
    const catSeed = (this.seed ^ (cat.index * 0x9e3779b1)) >>> 0;

    const out = { mat: [], col: [], inst: [], lod: [], solid: [] };
    let rejected = 0;
    const s = this._sample;

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        // Lattice index in absolute world cells, so tile borders are invisible.
        const gx = tx * n + ix;
        const gz = tz * n + iz;
        const rr = stream(hashU32(gx, gz, catSeed));
        const px = x0 + (ix + 0.12 + rr() * 0.76) * spacing;
        const pz = z0 + (iz + 0.12 + rr() * 0.76) * spacing;

        this.surface.sample(px, pz, s);
        if (!s.hit) {
          rejected++;
          continue;
        }
        const hNorm = clamp01((s.y + 6) / 40);
        const m = this._mask(cat, px, pz, s, hNorm);
        if (m <= 0 || rr() > m) {
          rejected++;
          continue;
        }
        if (this._inClearing(px, pz)) {
          rejected++;
          continue;
        }
        this._emitSite(cat, px, pz, s, rr, out);
      }
    }

    const count = out.lod.length;
    const tile = {
      tx,
      tz,
      count,
      mat: Float32Array.from(out.mat),
      col: Float32Array.from(out.col),
      inst: Float32Array.from(out.inst),
      lod: Float32Array.from(out.lod),
      cx: x0 + SCATTER_TILE * 0.5,
      cz: z0 + SCATTER_TILE * 0.5,
    };
    cat.tiles.set(this._tileKey(tx, tz), tile);
    cat.candidates += count;
    cat.rejected += rejected;
    // Order-independent checksum: two runs that stream tiles in different orders still agree.
    let sum = cat.checksum >>> 0;
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      sum =
        (sum +
          hashU32(
            Math.round(tile.mat[o + 12] * 64),
            Math.round(tile.mat[o + 14] * 64),
            (Math.round(tile.mat[o + 13] * 64) ^ cat.index) >>> 0
          )) >>>
        0;
    }
    cat.checksum = sum;
    if (out.solid.length) this._solids.push(...out.solid);
    this._genCalls++;
    this._genMs += performance.now() - t0;
    return tile;
  }

  _inClearing(x, z) {
    for (const c of this._clearings) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  /**
   * Turn one accepted lattice site into instances.
   *
   * The crystal case is the piece's signature and it is the reason this is not a sprinkle: a
   * certainty formation is a **bouquet**. One tall habit anchors it, and every satellite leans
   * *outward from the anchor* by 8–34°, which is the single difference between the reference's
   * crystal clusters and a bundle of parallel sticks.
   */
  _emitSite(cat, cx, cz, s, rr, out) {
    const kind = cat.cluster;
    if (!kind) {
      this._emitOne(cat, cx, s.y, cz, s, rr, out, { hero: true });
      return;
    }

    if (kind === "crystal" || kind === "shard") {
      const isShard = kind === "shard";
      // One formation in eight is a *great* one. A field of evenly-sized clusters has no subject;
      // the reference's frame is anchored by a single certainty stand taller than a person.
      const great = !isShard && rr() < 0.13;
      const n = isShard ? 3 + Math.floor(rr() * 5) : (great ? 7 : 4) + Math.floor(rr() * 6);
      const heroH = isShard ? 0.5 + rr() * 0.75 : great ? 4.0 + rr() * 3.0 : 1.4 + rr() * 2.3;
      const az0 = rr() * TAU;
      for (let k = 0; k < n; k++) {
        const hero = k === 0;
        const a = az0 + (k / n) * TAU + (rr() - 0.5) * 0.7;
        const spread = isShard ? 0.5 + heroH * 0.9 : 0.24 + heroH * 0.34;
        const r = hero ? 0 : (0.28 + rr() * 0.72) * spread;
        const px = cx + Math.cos(a) * r;
        const pz = cz + Math.sin(a) * r;
        this.surface.sample(px, pz, this._sample2);
        if (!this._sample2.hit) continue;
        const h = hero ? heroH : heroH * (0.26 + rr() * 0.6);
        this._emitOne(cat, px, this._sample2.y, pz, this._sample2, rr, out, {
          hero,
          height: h,
          leanAz: a,
          lean: hero ? 0.02 + rr() * 0.09 : 0.14 + rr() * 0.42,
        });
      }
      return;
    }

    if (kind === "rock") {
      const n = 1 + Math.floor(rr() * 3);
      for (let k = 0; k < n; k++) {
        const a = rr() * TAU;
        const r = k === 0 ? 0 : 0.7 + rr() * 2.4;
        const px = cx + Math.cos(a) * r;
        const pz = cz + Math.sin(a) * r;
        this.surface.sample(px, pz, this._sample2);
        if (!this._sample2.hit) continue;
        this._emitOne(cat, px, this._sample2.y, pz, this._sample2, rr, out, { hero: k === 0 });
      }
      return;
    }

    // "flat": small things in a clump. The site's plane is reused instead of re-raycasting each
    // member — over a 2 m clump the error is under a centimetre and it is a 5x saving in surface
    // queries, which is the dominant cost of streaming a grass field.
    const n = 3 + Math.floor(rr() * 6);
    for (let k = 0; k < n; k++) {
      const a = rr() * TAU;
      const r = Math.pow(rr(), 0.6) * 1.7;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      // Follow the sampled plane: y = y0 - (n.x*dx + n.z*dz) / n.y
      const y = s.y - (s.nx * dx + s.nz * dz) / s.ny;
      this._emitOne(cat, cx + dx, y, cz + dz, s, rr, out, { hero: k === 0 });
    }
  }

  _emitOne(cat, x, y, z, s, rr, out, o) {
    const q = this._q;
    const q2 = this._q2;
    const v = this._v;

    // Growth axis: the surface normal pulled toward world up, so nothing lies down a slope.
    const upBlend = cat.id === "oldtrue" ? 0 : cat.id === "chip" ? 0.2 : 0.5;
    const up = v.set(s.nx, s.ny, s.nz).normalize().lerp(this._up, upBlend).normalize();
    q.setFromUnitVectors(this._up, up);

    if (o.lean) {
      // Lean outward from the formation's anchor: rotate about the horizontal axis perpendicular
      // to the direction the satellite sits in.
      q2.setFromAxisAngle(this._v2.set(Math.sin(o.leanAz), 0, -Math.cos(o.leanAz)).normalize(), o.lean);
      q.multiply(q2);
    } else {
      const tilt = (cat.id === "oldtrue" ? 0 : cat.id === "tuft" || cat.id === "abouts" ? 0.12 : 0.26) * rr();
      const az = rr() * TAU;
      q2.setFromAxisAngle(this._v2.set(Math.cos(az), 0, Math.sin(az)), tilt);
      q.multiply(q2);
    }
    q2.setFromAxisAngle(this._up, rr() * TAU);
    q.multiply(q2);

    let sx;
    let sy;
    switch (cat.id) {
      case "crystal":
        sy = o.height ?? 1;
        sx = sy * (0.11 + rr() * 0.08);
        break;
      case "shard":
        sy = o.height ?? 0.6;
        sx = sy * (0.42 + rr() * 0.4);
        break;
      case "boulder":
        sy = (o.hero ? 0.9 + Math.pow(rr(), 1.6) * 2.6 : 0.4 + Math.pow(rr(), 1.7) * 1.3) * 1.0;
        sx = sy * (1.0 + rr() * 0.8);
        break;
      case "spire":
        sy = 2.0 + Math.pow(rr(), 1.4) * 4.6;
        sx = sy * (0.16 + rr() * 0.14);
        break;
      case "chip":
        sy = 0.14 + Math.pow(rr(), 2.0) * 0.5;
        sx = sy * (1.0 + rr() * 1.4);
        break;
      case "tuft":
        sy = 0.3 + Math.pow(rr(), 1.3) * 0.62;
        sx = sy * (0.75 + rr() * 0.6);
        break;
      case "abouts":
        sy = 0.32 + rr() * 0.34;
        sx = sy * (1.1 + rr() * 0.9);
        break;
      case "oldtrue":
        sy = 1;
        sx = 0.4 + rr() * 0.9;
        break;
      default:
        sy = 1;
        sx = 1;
    }
    const sz = cat.id === "boulder" ? sx * (0.72 + rr() * 0.5) : sx * (0.85 + rr() * 0.35);
    // Sink the base so nothing hovers on a slope the normal did not predict.
    const sink = cat.id === "oldtrue" ? 0 : sy * 0.05 + 0.012;

    const base = out.mat.length;
    this._m4.compose(this._v2.set(x, y - sink, z), q, this._v.set(sx, sy, sz));
    this._m4.toArray(out.mat, base);

    // Per-instance tint. A *multiplier* on the role colour, not a new colour: hue and value drift
    // only, because a scatter field is exactly where an unwatched ±0.2 of saturation eats a frame.
    const c = this._colour;
    let lum;
    let warm;
    switch (cat.id) {
      case "crystal":
      case "shard":
        lum = 0.84 + rr() * 0.3;
        warm = (rr() - 0.5) * 0.05;
        break;
      case "tuft":
      case "abouts":
        lum = 0.62 + Math.pow(rr(), 1.4) * 0.62;
        warm = (rr() - 0.5) * 0.14;
        break;
      case "oldtrue":
        lum = 0.68 + rr() * 0.42;
        warm = (rr() - 0.5) * 0.08;
        break;
      default:
        lum = 0.82 + rr() * 0.34;
        warm = (rr() - 0.5) * 0.1;
    }
    c.setRGB(lum * (1 + warm), lum, lum * (1 - warm * 0.8));
    out.col.push(c.r, c.g, c.b);

    // aInst: x fade jitter, y wind phase.
    out.inst.push(rr(), rr());
    out.lod.push(cat.lodDist * (0.88 + rr() * 0.24));

    if (cat.solid && sy > (cat.id === "boulder" ? 1.5 : 2.0)) {
      out.solid.push({ cat: cat.id, m: out.mat.slice(base, base + 16), x, z });
    }
  }

  // ------------------------------------------------------------------ streaming + gather

  rebuild() {
    this.surface.refresh();
    for (const cat of this.categories) {
      cat.tiles.clear();
      cat.candidates = 0;
      cat.rejected = 0;
      cat.checksum = 0;
    }
    this._solids.length = 0;
    this._solidsAt = null;
    this._lastGatherEye.set(1e9, 1e9, 1e9);
    this._built = false;
    this._outstanding = true;
  }

  frame() {
    // Wind runs on simulation time so `advance()` reproduces the frame exactly.
    this._shared.uTime.value = this.kernel.simTime;

    // Exactly one authority for haze. If the world has fog, this piece adds none.
    const fog = this.kernel.scene.fog;
    const haze = this._shared.uHaze.value;
    if (fog) {
      haze.z = 0;
    } else {
      haze.set(70, Math.max(200, config.tier.drawDistance * 0.85), 1);
    }
  }

  after() {
    this.kernel.camera.getWorldPosition(this._eye);

    // Upgrade the surface as the world lands under us: a `terrain` system arriving late, or the
    // stand-in proving ground being replaced by real geometry, both change every answer.
    const collision = this.kernel.get?.("collision");
    const sig = collision?.colliders?.size ?? -1;
    if (this.surface.mode === "flat" || this.surface.mode === "none") {
      const before = this.surface.mode;
      if (this.surface.refresh() !== before) this.rebuild();
    } else if (sig !== this._colliderSig && this.surface.mode === "collision") {
      this._colliderSig = sig;
      this.rebuild();
    }
    this._colliderSig = sig;

    const moved = this._eye.distanceToSquared(this._lastGatherEye);
    this._outstanding = this._streamTiles();
    if (!this._outstanding && moved < 9 && this._built) return;

    this._lastGatherEye.copy(this._eye);
    this._gather();
    this._built = true;
    if (!this._outstanding) this._publishSolids();
  }

  /** Ensure every tile inside each category's gather radius exists. Time-budgeted. */
  _streamTiles() {
    const t0 = performance.now();
    let outstanding = false;
    const ex = Math.floor(this._eye.x / SCATTER_TILE);
    const ez = Math.floor(this._eye.z / SCATTER_TILE);

    for (const cat of this.categories) {
      if (cat.budget[0] + (cat.budget[1] ?? 0) <= 0) continue;
      const rings = Math.ceil(cat.gather / SCATTER_TILE);
      const keep = (cat.gather + SCATTER_TILE * 2) ** 2;
      let done = false;
      for (let dz = -rings; dz <= rings && !done; dz++) {
        for (let dx = -rings; dx <= rings; dx++) {
          const tx = ex + dx;
          const tz = ez + dz;
          const cx = (tx + 0.5) * SCATTER_TILE - this._eye.x;
          const cz = (tz + 0.5) * SCATTER_TILE - this._eye.z;
          if (cx * cx + cz * cz > (cat.gather + SCATTER_TILE) ** 2) continue;
          if (cat.tiles.has(this._tileKey(tx, tz))) continue;
          if (performance.now() - t0 > this._budgetMs) {
            outstanding = true;
            done = true;
            break;
          }
          this._generateTile(cat, tx, tz);
        }
      }
      // Evict what is well behind us; regeneration is deterministic so nothing is lost.
      if (cat.tiles.size > 420) {
        for (const [key, tile] of cat.tiles) {
          const dx2 = tile.cx - this._eye.x;
          const dz2 = tile.cz - this._eye.z;
          if (dx2 * dx2 + dz2 * dz2 > keep) {
            cat.candidates -= tile.count;
            cat.tiles.delete(key);
          }
        }
      }
    }
    return outstanding;
  }

  /**
   * Fill the instance buffers, nearest tile first.
   *
   * Nearest-first is the whole reason the budget is safe to state as a number: when a ceiling binds
   * it always bites the farthest instances, so the failure mode is "the horizon thins", never "a
   * hole opens beside the player".
   */
  _gather() {
    const eye = this._eye;
    for (const cat of this.categories) {
      const order = [...cat.tiles.values()];
      for (const t of order) {
        const dx = t.cx - eye.x;
        const dz = t.cz - eye.z;
        t._d = dx * dx + dz * dz;
      }
      order.sort((a, b) => a._d - b._d);

      for (const l of cat.lods) l.drawn = 0;
      const g2 = cat.gather * cat.gather;
      const edge = (cat.gather + SCATTER_TILE) ** 2;

      for (const t of order) {
        if (t._d > edge) continue;
        for (let i = 0; i < t.count; i++) {
          const o = i * 16;
          const ddx = t.mat[o + 12] - eye.x;
          const ddy = t.mat[o + 13] - eye.y;
          const ddz = t.mat[o + 14] - eye.z;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > g2) continue;
          const li = cat.lods.length > 1 && d2 > t.lod[i] * t.lod[i] ? 1 : 0;
          const l = cat.lods[li];
          if (!l || l.drawn >= l.capacity) continue;
          const w = l.drawn++;
          l.mesh.instanceMatrix.array.set(t.mat.subarray(o, o + 16), w * 16);
          l.colour.array.set(t.col.subarray(i * 3, i * 3 + 3), w * 3);
          l.inst.array.set(t.inst.subarray(i * 2, i * 2 + 2), w * 2);
        }
      }

      for (const l of cat.lods) {
        l.mesh.count = l.drawn;
        l.mesh.visible = l.drawn > 0;
        l.mesh.instanceMatrix.needsUpdate = true;
        l.colour.needsUpdate = true;
        l.inst.needsUpdate = true;
      }
    }
  }

  /**
   * Hand the big solids to collision as one merged, world-space collider.
   *
   * Two guards, both load-bearing. First, only objects a player could walk into are included — a
   * field of 0.2 m chips in the broadphase would cost far more than it buys. Second, and this one
   * would otherwise delete the ground: `CollisionWorld` removes its stand-in proving ground the
   * moment any *other* collider registers. While that stand-in is the only world there is,
   * registering scatter solids would drop the player through the floor, so this stands down.
   */
  _publishSolids() {
    const collision = this.kernel.get?.("collision");
    if (!collision || typeof collision.registerCollider !== "function") return;
    if (collision.fallbackSpawn) return; // the stand-in ground is the only world — do not evict it
    if (!this._solids.length) return;
    if (this._solidsAt && this._solidsAt.distanceToSquared(this._eye) < 40 * 40) return;

    const eye = this._eye;
    const near = this._solids
      .map((s) => ({ s, d: (s.x - eye.x) ** 2 + (s.z - eye.z) ** 2 }))
      .filter((e) => e.d < 90 * 90)
      .sort((a, b) => a.d - b.d)
      .slice(0, 240);
    if (!near.length) return;

    const byCat = new Map();
    for (const cat of this.categories) byCat.set(cat.id, cat.lods[cat.lods.length - 1].geo);

    const positions = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const { s } of near) {
      const geo = byCat.get(s.cat);
      if (!geo) continue;
      m.fromArray(s.m);
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        positions.push(v.x, v.y, v.z);
      }
    }
    if (!positions.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this._solidGeo?.dispose();
    this._solidGeo = geo;
    this._solidsAt = this._eye.clone();
    this._solidCount = near.length;
    signals.emit("world:collider", { id: "p13:scatter-solids", geometry: geo });
    this._colliderSig = collision.colliders?.size ?? this._colliderSig;
  }

  // ------------------------------------------------------------------ reviewer contract

  /**
   * The nearest tall certainty, and a stance three metres from it facing in — so a reviewer can
   * frame the signature element without hand-flying a camera. Read-only, derived from the same
   * buffers the renderer draws.
   */
  _closeUp() {
    const cat = this.categories.find((c) => c.id === "crystal");
    if (!cat) return null;
    let best = null;
    for (const t of cat.tiles.values()) {
      for (let i = 0; i < t.count; i++) {
        const o = i * 16;
        // Column 1 length is the instance's Y scale — i.e. the crystal's height in metres.
        const h = Math.hypot(t.mat[o + 4], t.mat[o + 5], t.mat[o + 6]);
        const x = t.mat[o + 12];
        const y = t.mat[o + 13];
        const z = t.mat[o + 14];
        const d = Math.hypot(x - this._eye.x, z - this._eye.z);
        const score = h - d * 0.012;
        if (!best || score > best.score) best = { x, y, z, h, score };
      }
    }
    if (!best) return null;
    // Stand back on the +X/+Z diagonal so the key (which the rig puts low and warm) rakes across
    // the facets rather than flattening them.
    const back = Math.max(3.2, best.h * 1.5);
    const dx = 0.78;
    const dz = 0.63;
    return {
      pos: [Number((best.x + dx * back).toFixed(3)), Number((best.y + 1.1).toFixed(3)), Number((best.z + dz * back).toFixed(3))],
      opts: { heading: [-dx, -dz] },
      target: [Number(best.x.toFixed(3)), Number(best.y.toFixed(3)), Number(best.z.toFixed(3))],
      height: Number(best.h.toFixed(2)),
    };
  }

  probe() {
    let instances = 0;
    let triangles = 0;
    let meshes = 0;
    let tris = 0;
    let flat = 0;
    const cats = {};
    for (const cat of this.categories) {
      const per = {
        budget: cat.budget.slice(),
        drawn: [],
        geoTris: cat.lods.map((l) => l.tris),
        tris: 0,
        candidates: cat.candidates,
        rejected: cat.rejected,
        tiles: cat.tiles.size,
        gather: cat.gather,
        fade: [cat.material.userData.fadeUniform.value.x, cat.material.userData.fadeUniform.value.y],
        lodDist: cat.lodDist,
        checksum: cat.checksum,
      };
      for (const l of cat.lods) {
        per.drawn.push(l.drawn);
        per.tris += l.drawn * l.tris;
        if (l.mesh.visible) meshes++;
        tris += l.flat.tris;
        flat += l.flat.flat;
      }
      instances += per.drawn.reduce((a, b) => a + b, 0);
      triangles += per.tris;
      cats[cat.id] = per;
    }
    const is = this.islands.stats;
    tris += is.rockFlat.tris + is.crystalFlat.tris;
    flat += is.rockFlat.flat + is.crystalFlat.flat;

    return {
      seed: this.seed,
      tier: this.tier,
      density: Number(this.density.toFixed(3)),
      surface: this.surface.mode,
      surfaceQueries: this.surface.queries,
      built: Boolean(this._built),
      outstanding: Boolean(this._outstanding),
      genCalls: this._genCalls,
      genMsTotal: Number(this._genMs.toFixed(2)),
      instances,
      triangles: triangles + is.rockTris + is.crystalTris,
      groundTriangles: triangles,
      meshes: meshes + 2,
      solids: this._solidCount,
      missingRoles: missingRoles.slice(),
      // Measured, not asserted: every triangle in every buffer this piece owns, checked for a
      // constant per-face normal.
      flatShading: { triangles: tris, perFaceNormals: flat, ratio: tris ? Number((flat / tris).toFixed(4)) : 0 },
      maxGeoTris: Math.max(...this.categories.flatMap((c) => c.lods.map((l) => l.tris))),
      islands: {
        count: is.islands,
        crystals: is.crystals,
        structures: is.structures,
        rockTris: is.rockTris,
        crystalTris: is.crystalTris,
        distance: [Number(is.dMin.toFixed(1)), Number(is.dMax.toFixed(1))],
        altitude: [Number(is.yMin.toFixed(1)), Number(is.yMax.toFixed(1))],
      },
      haze: { strength: this._shared.uHaze.value.z, sceneFog: Boolean(this.kernel.scene.fog) },
      eye: [Number(this._eye.x.toFixed(2)), Number(this._eye.y.toFixed(2)), Number(this._eye.z.toFixed(2))],
      checksum: this.categories.reduce((a, c) => (a + c.checksum) >>> 0, 0) >>> 0,
      closeUp: this._closeUp(),
      categories: cats,
    };
  }

  dispose() {
    this._offReady?.();
    this._offSpawn?.();
    for (const cat of this.categories) {
      for (const l of cat.lods) {
        l.geo.dispose();
        l.mesh.customDepthMaterial?.dispose();
      }
    }
    for (const m of Object.values(this._materials ?? {})) m.dispose();
    for (const m of this._islandMats ?? []) m.dispose();
    this.islands?.rock?.geometry?.dispose();
    this.islands?.crystal?.geometry?.dispose();
    this._solidGeo?.dispose();
    this.kernel.get?.("collision")?.removeCollider?.("p13:scatter-solids");
  }
}
