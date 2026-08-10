import * as THREE from "three";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";

/**
 * Scatter — everything on the ground that is not the ground.
 *
 * `design/world.md` §2.3 makes this piece a *survey instrument*, not decoration: "You can read a
 * leaf's health off its plants. **Oldtrue** grows only on a century of held truth; **abouts** grow
 * only on approximation." So the placement masks are the content. A player who never reads a word
 * of the bible can still see that the crystal field is on the low ground, that the pale lichen and
 * the creeping abouts never grow in the same place, and that the talus sits at the foot of the
 * steep faces.
 *
 * Seven categories, all GPU-instanced:
 *
 *   certainty  set crystal, the signature element. `certainty.*` — faceted, refracting, and by
 *              `design/art-direction.md` §0.3 **never emissive and never bloomed**: it does not
 *              glow because it does not drift.
 *   shard      broad blunt certainty splinters, the second silhouette inside every formation
 *   seam       live resonance crystal — unresolved quantity still standing in a crack. This is
 *              the one category that carries `resonance.core` and a blown `resonance.hot` core
 *              (§5, "every emitter has a blown core"), and it is deliberately rare because §0.2
 *              makes hot resonance a *live-claim budget*, not a decoration budget.
 *   abouts     the creeping plant that grows only on approximate things. Wind in the vertex
 *              shader. `world.foliage`, held under S 0.30 as §9 requires.
 *   oldtrue    pale lichen that grows only on claims that have held a hundred years.
 *   debris     rock chips and shards; a talus mask puts them at the foot of steep ground.
 *   fragment   precursor bone-stone: broken drums and cut blocks, with dormant `resonance.deep`
 *              inlays (never `resonance.core` — the claim in a ruin is *false*, not live).
 *
 * ## Four properties this module exists to guarantee
 *
 * **Deterministic.** Every position, rotation, scale, colour and shader seed is a pure function of
 * `(seed, category, tile, lattice index)`. No `Math.random`, no dependence on frame order, arrival
 * order or camera path. Two boots produce byte-identical placement, which is the only reason a
 * round-over-round capture comparison means anything.
 *
 * **Streamed, so it scales to a 600 m leaf.** Candidates are generated per 24 m tile on demand
 * around the viewer and evicted behind them, with a per-frame time budget so a new ring of tiles
 * never costs a hitch. Global pre-generation would have cost ~200k surface queries the moment P09
 * lands a real island.
 *
 * **Hard-budgeted.** Each category has an explicit per-LOD instance ceiling scaled by
 * `config.tier`. Tiles are consumed nearest-first, so when the ceiling binds it is always the
 * farthest instances that are dropped. `renderer.info` therefore has a *ceiling*, not a hope.
 *
 * **Pop-free.** Two things could pop and neither is allowed to. Distance culling is a smooth
 * shrink-to-zero in the vertex shader over a band that ends 14 m *inside* the streaming radius, so
 * an instance is always already invisible when it enters or leaves the buffer. LOD switching is a
 * geometry swap between two shapes that share a profile, at a distance jittered ±11% per instance,
 * so it can never read as a line sweeping across a field.
 *
 * ## Boundaries
 *
 * No sibling feature is imported. The surface is read through whatever is mounted — a `terrain`
 * system's height query if P09 has published one, otherwise `collision.groundAt`, otherwise a flat
 * stand-in — and the large solids are handed back to collision through the `world:collider` signal
 * that `CollisionWorld` already documents.
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

function smoothstep01(t) {
  return t * t * (3 - 2 * t);
}

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

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Rising ramp: 0 below `a`, 1 above `b`. */
const ramp = (t, a, b) => clamp01((t - a) / (b - a || 1e-6));
/** A soft band centred on `c` with half-width `w`, feathered over `f`. */
function band(t, c, w, f = w * 0.6) {
  const d = Math.abs(t - c);
  return 1 - clamp01((d - w) / (f || 1e-6));
}

// ---------------------------------------------------------------------------- surface adapter

const TERRAIN_HEIGHT_FNS = ["heightAt", "sampleHeight", "getHeight", "elevationAt", "groundHeight"];
const TERRAIN_NORMAL_FNS = ["normalAt", "sampleNormal", "getNormal"];

/**
 * The one place that knows how to ask "what is the ground at (x, z)?".
 *
 * P09 has not landed yet and P13 must not block on it, so this duck-types the sensible answers in
 * priority order and re-resolves whenever `world:ready` fires. `collision.groundAt` is the
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
      if (typeof t.sample === "function") {
        this._t = t;
        this._h = "sample";
        this._n = null;
        this.mode = "terrain-sample";
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
      out.ny = Math.abs(r.normal.y) < 1e-4 ? 1e-4 : Math.abs(r.normal.y);
      out.nz = r.normal.z;
      if (r.normal.y < 0) {
        out.nx = -out.nx;
        out.nz = -out.nz;
      }
      return out;
    }

    if (this.mode === "terrain" || this.mode === "terrain-sample") {
      let y;
      let n = null;
      if (this.mode === "terrain-sample") {
        const r = this._t.sample(x, z);
        if (r == null) return out;
        y = typeof r === "number" ? r : (r.height ?? r.y);
        n = r && typeof r === "object" ? r.normal : null;
      } else {
        y = this._t[this._h](x, z);
        if (this._n) n = this._t[this._n](x, z);
      }
      if (!Number.isFinite(y)) return out;
      out.hit = true;
      out.y = y;
      if (n && Number.isFinite(n.x)) {
        out.nx = n.x;
        out.ny = Math.max(1e-4, Math.abs(n.y));
        out.nz = n.z;
      } else {
        // Central difference. 0.4 m is small enough to follow a terrace lip and large enough not
        // to read quantisation noise out of a heightfield as slope.
        const e = 0.4;
        const hx = this._sampleH(x + e, z) - this._sampleH(x - e, z);
        const hz = this._sampleH(x, z + e) - this._sampleH(x, z - e);
        const len = Math.hypot(-hx, 2 * e, -hz) || 1;
        out.nx = -hx / len;
        out.ny = (2 * e) / len;
        out.nz = -hz / len;
      }
      return out;
    }

    // Flat stand-in: a disc, so a build before any world exists still has an edge.
    if (Math.hypot(x, z) > 54) return out;
    out.hit = true;
    out.y = 0.12;
    return out;
  }

  _sampleH(x, z) {
    if (this.mode === "terrain-sample") {
      const r = this._t.sample(x, z);
      return typeof r === "number" ? r : (r?.height ?? r?.y ?? 0);
    }
    const v = this._t[this._h](x, z);
    return Number.isFinite(v) ? v : 0;
  }
}

// ---------------------------------------------------------------------------- geometry authoring

/**
 * Rebuild a geometry as flat-shaded, non-indexed triangles with per-face normals.
 *
 * `art-direction.md` §4: "Rock has no terminator … the light/shadow boundary is a geometric edge."
 * Crystal wants the same thing for a different reason — a facet only reads as a facet if it has one
 * normal. Baking the flat normals into the buffer instead of setting `flatShading: true` keeps
 * `vNormal` a real varying, which is what the specular-AA term in the fragment shader differentiates.
 */
function flatten(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    if (!Number.isFinite(n.x)) n.set(0, 1, 0);
    for (let k = 0; k < 3; k++) nrm.setXYZ(i + k, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  if (g !== geo) geo.dispose();
  return g;
}

function buildFromRings(rings, sides, radialJitter, seed) {
  // rings: [{ y, r }] bottom→top, last entry with r === 0 closes to an apex.
  const rj = [];
  for (let s = 0; s < sides; s++) rj.push(1 + (rnd(s, 17, seed) - 0.5) * 2 * radialJitter);

  const pts = [];
  for (let i = 0; i < rings.length; i++) {
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const r = ring.r === 0 ? 0 : rings[i].r * rj[s];
      ring.push(new THREE.Vector3(Math.cos(a) * r, rings[i].y, Math.sin(a) * r));
    }
    pts.push(ring);
  }

  const verts = [];
  const push = (v) => verts.push(v.x, v.y, v.z);

  for (let i = 0; i < rings.length - 1; i++) {
    const lo = pts[i];
    const hi = pts[i + 1];
    const apex = rings[i + 1].r === 0;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      if (apex) {
        const tip = new THREE.Vector3(0, rings[i + 1].y, 0);
        push(lo[s]);
        push(lo[s2]);
        push(tip);
      } else {
        push(lo[s]);
        push(lo[s2]);
        push(hi[s2]);
        push(lo[s]);
        push(hi[s2]);
        push(hi[s]);
      }
    }
  }
  // Base cap, wound downward.
  const base = pts[0];
  for (let s = 1; s < sides - 1; s++) {
    push(base[0]);
    push(base[s + 1]);
    push(base[s]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  return flatten(g);
}

/**
 * A certainty. Authored as a real crystal habit rather than a cone: a prism that swells slightly
 * above the base, holds its width, then takes a shoulder bevel into a blunt pyramidal termination.
 * Height is normalised to 1 so the vertex shader can use `position.y` directly as the shear ramp.
 */
function makeCertainty(detail, seed) {
  const sides = detail ? 9 : 6;
  const rings = detail
    ? [
        { y: 0.0, r: 0.94 },
        { y: 0.08, r: 1.0 },
        { y: 0.46, r: 0.96 },
        { y: 0.72, r: 0.86 },
        { y: 0.87, r: 0.48 },
        { y: 1.0, r: 0 },
      ]
    : [
        { y: 0.0, r: 0.96 },
        { y: 0.7, r: 0.9 },
        { y: 0.87, r: 0.48 },
        { y: 1.0, r: 0 },
      ];
  return buildFromRings(rings, sides, detail ? 0.14 : 0.1, seed);
}

/** The broad blunt habit that sits alongside the tall one so a formation is never one shape. */
function makeShard(detail, seed) {
  const sides = detail ? 7 : 5;
  const rings = detail
    ? [
        { y: 0.0, r: 1.0 },
        { y: 0.34, r: 0.92 },
        { y: 0.62, r: 0.7 },
        { y: 0.8, r: 0.44 },
        { y: 1.0, r: 0 },
      ]
    : [
        { y: 0.0, r: 1.0 },
        { y: 0.62, r: 0.72 },
        { y: 1.0, r: 0 },
      ];
  return buildFromRings(rings, sides, detail ? 0.22 : 0.16, seed);
}

/** An angular rock chip. Jittered octahedron / tetrahedron — no sphere ever reads as broken stone. */
function makeChip(detail, seed) {
  const g = detail ? new THREE.OctahedronGeometry(0.5, 0) : new THREE.TetrahedronGeometry(0.55, 0);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const j = (k) => (rnd(i, k, seed) - 0.5) * (detail ? 0.34 : 0.4);
    pos.setXYZ(i, pos.getX(i) * (1 + j(1)), pos.getY(i) * (1 + j(2)) * 0.62 + 0.3, pos.getZ(i) * (1 + j(3)));
  }
  pos.needsUpdate = true;
  return flatten(g);
}

/**
 * A precursor fragment: a cut drum with one face broken away. `aInlay` marks the band of vertices
 * that carry a dormant `resonance.deep` inlay, so the strip costs no extra draw call.
 */
function makeFragment(detail, seed) {
  const sides = detail ? 9 : 6;
  const verts = [];
  const inlay = [];
  const top = [];
  const bot = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    const r = 0.5 * (1 + (rnd(s, 3, seed) - 0.5) * 0.16);
    // A break plane: one side of the drum is sheared away.
    const h = 1.0 - 0.55 * clamp01((Math.cos(a - 1.1) + 0.2) * 0.9) - rnd(s, 9, seed) * 0.12;
    top.push(new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r));
    bot.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const bandLo = 0.34;
  const bandHi = 0.46;
  const push = (v, isInlay) => {
    verts.push(v.x, v.y, v.z);
    inlay.push(isInlay ? 1 : 0);
  };
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    // Split the side wall into three bands so the middle one can carry the inlay.
    const cuts = [0, bandLo, bandHi, 1];
    for (let c = 0; c < 3; c++) {
      const t0 = cuts[c];
      const t1 = cuts[c + 1];
      const isInlay = c === 1;
      const p = (i, t) => new THREE.Vector3().lerpVectors(bot[i], top[i], t);
      const a0 = p(s, t0);
      const a1 = p(s2, t0);
      const b0 = p(s, t1);
      const b1 = p(s2, t1);
      push(a0, isInlay);
      push(a1, isInlay);
      push(b1, isInlay);
      push(a0, isInlay);
      push(b1, isInlay);
      push(b0, isInlay);
    }
  }
  for (let s = 1; s < sides - 1; s++) {
    push(top[0], false);
    push(top[s], false);
    push(top[s + 1], false);
    push(bot[0], false);
    push(bot[s + 1], false);
    push(bot[s], false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const out = flatten(g);
  out.setAttribute("aInlay", new THREE.Float32BufferAttribute(inlay, 1));
  return out;
}

/**
 * Abouts: a creeping plant, so the blades arc outward from the root rather than standing up.
 * `aBend` is 0 at the root and 1 at the tip; it is the only thing the wind term multiplies by, so
 * a blade pivots about its anchor and never slides.
 */
function makeAbouts(detail, seed) {
  const blades = detail ? 4 : 2;
  const segs = detail ? 3 : 2;
  const verts = [];
  const bends = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd(b, 5, seed) * 1.4;
    const reach = 0.55 + rnd(b, 6, seed) * 0.45;
    const rise = 0.65 + rnd(b, 7, seed) * 0.5;
    const w0 = 0.085 + rnd(b, 8, seed) * 0.03;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const at = (t) => {
      // Arc: rises, then leans over — a runner, not a grass blade.
      const y = Math.sin(t * 1.9) * rise;
      const r = t * t * reach + t * 0.18;
      return new THREE.Vector3(dx * r, y, dz * r);
    };
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const p0 = at(t0);
      const p1 = at(t1);
      const w = (t) => w0 * (1 - t * 0.82);
      const nx = -dz;
      const nz = dx;
      const q = [
        [p0.x - nx * w(t0), p0.y, p0.z - nz * w(t0), t0],
        [p0.x + nx * w(t0), p0.y, p0.z + nz * w(t0), t0],
        [p1.x + nx * w(t1), p1.y, p1.z + nz * w(t1), t1],
        [p1.x - nx * w(t1), p1.y, p1.z - nz * w(t1), t1],
      ];
      const tri = [0, 1, 2, 0, 2, 3];
      for (const i of tri) {
        verts.push(q[i][0], q[i][1], q[i][2]);
        bends.push(q[i][3]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  g.setAttribute("aBend", new THREE.Float32BufferAttribute(bends, 1));
  return g;
}

/** Oldtrue: a lichen crust. Flat, scalloped, hugging the stone. `aBend` is zero — it never moves. */
function makeOldtrue(seed) {
  const sides = 9;
  const verts = [];
  const centre = new THREE.Vector3(0, 0.012, 0);
  const rim = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    const r = 0.5 * (0.62 + rnd(s, 21, seed) * 0.62);
    rim.push(new THREE.Vector3(Math.cos(a) * r, 0.002 + rnd(s, 22, seed) * 0.01, Math.sin(a) * r));
  }
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    verts.push(centre.x, centre.y, centre.z, rim[s].x, rim[s].y, rim[s].z, rim[s2].x, rim[s2].y, rim[s2].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const out = flatten(g);
  out.setAttribute("aBend", new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute("position").count), 1));
  return out;
}

function triCount(g) {
  const p = g.getAttribute("position");
  return Math.floor((g.index ? g.index.count : p.count) / 3);
}

// ---------------------------------------------------------------------------- shaders

const VERT_PARS = /* glsl */ `
  attribute vec4 aScatter;
  uniform vec3 uEye;
  uniform vec2 uFade;
  uniform float uTime;
  uniform vec3 uWind;
  varying float vFade;
  varying float vEyeDist;
`;

const VERT_PARS_FULL = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vLocalNrm;
  varying vec3 vLocalView;
  varying float vSeed;
`;

/** Shared head: distance to the viewer, the per-instance fade, and the shrink it drives. */
function vertBody({ shear = false, wind = false, full = true }) {
  return /* glsl */ `
  vec4 vsInstOrigin = modelMatrix * instanceMatrix[3];
  vEyeDist = distance(uEye, vsInstOrigin.xyz);
  // ±11% per-instance jitter on the fade window: a field must never dissolve along a circle.
  float vsFadeJit = 1.0 + (aScatter.w - 0.5) * 0.22;
  vFade = 1.0 - smoothstep(uFade.x * vsFadeJit, uFade.y * vsFadeJit, vEyeDist);
  ${
    shear
      ? `
  // Per-instance lean. Two crystals from the same geometry never stand the same way.
  float vsAng = aScatter.x * 6.2831853;
  float vsH = max(transformed.y, 0.0);
  transformed.x += cos(vsAng) * aScatter.y * vsH * vsH;
  transformed.z += sin(vsAng) * aScatter.y * vsH * vsH;`
      : ""
  }
  ${
    wind
      ? `
  // Wind. Driven by simulation time, so an advance() sequence reproduces the same frame.
  float vsW = sin(uTime * 1.30 + vsInstOrigin.x * 0.31 + vsInstOrigin.z * 0.19)
            + 0.45 * sin(uTime * 2.35 + vsInstOrigin.x * 0.77 - vsInstOrigin.z * 0.41);
  float vsAmp = uWind.z * (0.55 + aScatter.y) * aBend * aBend;
  transformed.x += uWind.x * vsW * vsAmp;
  transformed.z += uWind.y * vsW * vsAmp;`
      : ""
  }
  transformed *= vFade;
  ${
    full
      ? `
  vLocalPos = transformed;
  vSeed = aScatter.x;
  mat3 vsM = mat3(modelMatrix) * mat3(instanceMatrix);
  vec3 vsW3 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vLocalView = normalize(transpose(vsM) * normalize(vsW3 - uEye));`
      : ""
  }
`;
}

/**
 * Attach a shader extension to a material.
 *
 * `customProgramCacheKey` is not optional here. Three's default key is the *source text* of
 * `onBeforeCompile`, and every material built by this factory shares that text — differing only in
 * closed-over strings. Without an explicit key, the crystal, the flora and the rock would silently
 * share one compiled program and two of them would render as the third.
 */
function extend(material, key, parts) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, parts.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${parts.vertexPars ?? ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${parts.vertexBody ?? ""}`);
    if (parts.normalBody) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>\n${parts.normalBody}`
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n${parts.fragmentPars ?? ""}`
    );
    if (parts.roughnessBody) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n${parts.roughnessBody}`
      );
    }
    if (parts.lightBody) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n${parts.lightBody}`
      );
    }
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ---------------------------------------------------------------------------- palette

/** `design/palette.json`. Authoring hexes decoded as sRGB, which is what the file mandates. */
function col(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

const PAL = {
  certaintyFacet: 0x5aa5a0,
  certaintyRim: 0x8fe8df,
  certaintyDeep: 0x26514f,
  resonanceCore: 0x2fe3d6,
  resonanceHot: 0xe9fffb,
  resonanceDeep: 0x0e5f63,
  foliage: 0xa2d7a6,
  bone: 0xaa9087,
  rockAlbedo: 0xb4744c,
  rockLow: 0x9e6244,
};

// ---------------------------------------------------------------------------- the system

const TIER_SCALE = { potato: 0, low: 0.3, medium: 0.6, high: 1, ultra: 1.35 };

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
    this._time = 0;
    this._sample = { hit: false, y: 0, nx: 0, ny: 1, nz: 0 };
    this._clearings = [];
    this._solids = [];
    this._solidsSent = false;
    this._budgetMs = opts.budgetMs ?? 6;
    this._genCalls = 0;
    this._genMs = 0;

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._colour = new THREE.Color();

    this.categories = this._buildCategories();
    for (const cat of this.categories) for (const l of cat.lods) this.root.add(l.mesh);

    this._offReady = signals.on("world:ready", () => this.rebuild());
    this._offSpawn = signals.on("player:spawn", (p) => {
      if (!p?.position) return;
      this._clearings.push({ x: p.position.x, z: p.position.z, r: 3.2 });
      this.rebuild();
    });
  }

  // ------------------------------------------------------------------ categories

  _mkFadeUniforms(start, end) {
    return {
      uEye: { value: this._eye },
      uFade: { value: new THREE.Vector2(start, end) },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(0.82, 0.57, 0) },
    };
  }

  _crystalMaterial(key, { facet, rim, deep, inner, core, coreStrength, emissive, roughness, fade }) {
    const uniforms = {
      ...this._mkFadeUniforms(fade[0], fade[1]),
      uRimColor: { value: col(rim) },
      uInnerA: { value: col(deep) },
      uInnerB: { value: col(inner) },
      uCoreColor: { value: col(core) },
      // x rim strength · y rim exponent · z internal caustic strength · w core strength
      uCrystal: { value: new THREE.Vector4(0.42, 4.0, 0.30, coreStrength) },
      uSpecAA: { value: new THREE.Vector2(0.55, 0.30) },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: col(facet),
      roughness,
      metalness: 0.0,
      emissive: col(emissive),
      emissiveIntensity: 1,
      dithering: true,
    });
    return extend(mat, key, {
      uniforms,
      vertexPars: VERT_PARS + VERT_PARS_FULL,
      vertexBody: vertBody({ shear: true, full: true }),
      normalBody: "vLocalNrm = objectNormal;",
      fragmentPars:
        VERT_PARS_FULL.replace(/varying/g, "varying") +
        /* glsl */ `
        varying float vFade;
        varying float vEyeDist;
        uniform vec3 uRimColor;
        uniform vec3 uInnerA;
        uniform vec3 uInnerB;
        uniform vec3 uCoreColor;
        uniform vec4 uCrystal;
        uniform vec2 uSpecAA;
      `,
      roughnessBody: /* glsl */ `
        // Specular antialiasing (art-direction.md §5, "required"). Two terms: normal variance
        // inside the pixel, which catches facet edges, and a distance ramp, which catches the
        // point where a whole facet is smaller than a pixel and the highlight becomes a coin flip.
        roughnessFactor = clamp(
          roughnessFactor
            + uSpecAA.x * min(1.0, length(fwidth(vLocalNrm)) * 3.2)
            + uSpecAA.y * smoothstep(18.0, 90.0, vEyeDist),
          0.04, 1.0);
      `,
      lightBody: /* glsl */ `
        vec3 csN = normalize(normal);
        vec3 csV = normalize(vViewPosition);
        float csF = pow(clamp(1.0 - dot(csN, csV), 0.0, 1.0), uCrystal.y);

        // Fake refraction. The view ray is bent through the facet normal in the crystal's own
        // space and marched a little way in; the interference pattern it samples therefore slides
        // as the camera moves, which is the only cue that says "this is solid and transmissive"
        // at gameplay distance. A static texture cannot do it and a real transmission pass costs
        // a second render target this piece has no budget for.
        vec3 csR = refract(normalize(vLocalView), normalize(vLocalNrm), 0.62);
        vec3 csP = vLocalPos + csR * 0.85;
        float csB = sin(csP.y * 11.0 + csP.x * 6.0 + vSeed * 39.0)
                  * sin(csP.z * 8.5 - csP.x * 4.5 + vSeed * 17.0);
        float csBand = 0.5 + 0.5 * csB;
        csBand *= csBand;
        vec3 csInner = mix(uInnerA, uInnerB, csBand) * uCrystal.z * (0.35 + 0.65 * csBand);

        float csAxial = 1.0 - smoothstep(0.05, 0.40, length(csP.xz));
        float csCore = csAxial * (1.0 - smoothstep(0.10, 0.90, csP.y));
        totalEmissiveRadiance +=
          (csInner + uRimColor * csF * uCrystal.x + uCoreColor * csCore * uCrystal.w) * vFade;
      `,
    });
  }

  _floraMaterial(key, { colour, roughness, fade, wind }) {
    const uniforms = this._mkFadeUniforms(fade[0], fade[1]);
    uniforms.uWind.value.set(0.82, 0.57, wind);
    const mat = new THREE.MeshStandardMaterial({
      color: col(colour),
      roughness,
      metalness: 0,
      side: THREE.DoubleSide,
      dithering: true,
    });
    return extend(mat, key, {
      uniforms,
      vertexPars: VERT_PARS + "attribute float aBend;",
      vertexBody: vertBody({ wind: true, full: false }),
      fragmentPars: "varying float vFade;\nvarying float vEyeDist;",
    });
  }

  _stoneMaterial(key, { colour, roughness, fade, inlay }) {
    const uniforms = this._mkFadeUniforms(fade[0], fade[1]);
    uniforms.uInlay = { value: col(inlay ?? 0x000000) };
    uniforms.uInlayStrength = { value: inlay ? 1 : 0 };
    const mat = new THREE.MeshStandardMaterial({
      color: col(colour),
      roughness,
      metalness: 0,
      dithering: true,
    });
    return extend(mat, key, {
      uniforms,
      vertexPars: VERT_PARS + "attribute float aInlay;\nvarying float vInlay;",
      vertexBody: vertBody({ full: false }) + "\nvInlay = aInlay;",
      fragmentPars:
        "varying float vFade;\nvarying float vEyeDist;\nvarying float vInlay;\nuniform vec3 uInlay;\nuniform float uInlayStrength;",
      lightBody: /* glsl */ `
        // Dormant inlay. resonance.deep only: a ruin's claim is false, not live, and
        // art-direction.md §0.2 reserves resonance.core for something actually unresolved.
        totalEmissiveRadiance += uInlay * (vInlay * uInlayStrength * 0.85) * vFade;
      `,
    });
  }

  _buildCategories() {
    const seed = this.seed;
    const d = this.density;
    const cap = (n) => Math.max(0, Math.round(n * d));

    const crystalGeo = [makeCertainty(true, seed ^ 0x11), makeCertainty(false, seed ^ 0x11)];
    const shardGeo = [makeShard(true, seed ^ 0x22), makeShard(false, seed ^ 0x22)];
    const chipGeo = [makeChip(true, seed ^ 0x33), makeChip(false, seed ^ 0x33)];
    const fragGeo = [makeFragment(true, seed ^ 0x44), makeFragment(false, seed ^ 0x44)];
    const aboutGeo = [makeAbouts(true, seed ^ 0x55), makeAbouts(false, seed ^ 0x55)];
    const lichenGeo = [makeOldtrue(seed ^ 0x66)];

    const matCertainty = this._crystalMaterial("p13:crystal", {
      facet: PAL.certaintyFacet,
      rim: PAL.certaintyRim,
      deep: PAL.certaintyDeep,
      inner: PAL.certaintyRim,
      core: PAL.certaintyRim,
      coreStrength: 0.34,
      emissive: 0x000000,
      roughness: 0.1,
      fade: [150, 190],
    });
    const matSeam = this._crystalMaterial("p13:crystal", {
      facet: PAL.resonanceDeep,
      rim: PAL.resonanceBloom ?? 0x9ef3f0,
      deep: PAL.resonanceDeep,
      inner: PAL.resonanceCore,
      core: PAL.resonanceHot,
      coreStrength: 5.2,
      emissive: PAL.resonanceDeep,
      roughness: 0.14,
      fade: [230, 275],
    });
    // A live claim is an emitter: §5 makes a blown white core mandatory and §0.4 makes it the
    // brightest thing in frame that is not the sun. A certainty gets neither.
    matSeam.emissiveIntensity = 1.35;
    matSeam.userData.live = true;

    const matAbouts = this._floraMaterial("p13:flora", {
      colour: PAL.foliage,
      roughness: 0.82,
      fade: [46, 62],
      wind: 0.085,
    });
    const matOldtrue = this._floraMaterial("p13:flora", {
      colour: 0xb9c4ae,
      roughness: 0.9,
      fade: [58, 76],
      wind: 0,
    });
    const matDebris = this._stoneMaterial("p13:stone", {
      colour: PAL.rockLow,
      roughness: 0.88,
      fade: [88, 112],
      inlay: null,
    });
    const matFragment = this._stoneMaterial("p13:stone", {
      colour: PAL.bone,
      roughness: 0.78,
      fade: [200, 250],
      inlay: PAL.resonanceDeep,
    });

    const specs = [
      {
        id: "certainty",
        geo: crystalGeo,
        material: matCertainty,
        budget: [cap(190), cap(430)],
        lodDist: 52,
        gather: 204,
        spacing: 7.2,
        clustered: true,
        shadow: true,
        solid: true,
      },
      {
        id: "shard",
        geo: shardGeo,
        material: matCertainty,
        budget: [cap(320), cap(700)],
        lodDist: 34,
        gather: 126,
        spacing: 7.2,
        clustered: true,
        shadow: true,
      },
      {
        id: "seam",
        geo: crystalGeo,
        material: matSeam,
        budget: [cap(18), cap(30)],
        lodDist: 70,
        gather: 290,
        spacing: 27,
        clustered: true,
        shadow: false,
      },
      {
        id: "abouts",
        geo: aboutGeo,
        material: matAbouts,
        budget: [cap(1500), cap(2100)],
        lodDist: 22,
        gather: 66,
        spacing: 1.15,
        shadow: false,
      },
      {
        id: "oldtrue",
        geo: lichenGeo,
        material: matOldtrue,
        budget: [cap(1300), 0],
        lodDist: 1e9,
        gather: 80,
        spacing: 1.7,
        shadow: false,
      },
      {
        id: "debris",
        geo: chipGeo,
        material: matDebris,
        budget: [cap(420), cap(900)],
        lodDist: 30,
        gather: 116,
        spacing: 1.5,
        shadow: true,
      },
      {
        id: "fragment",
        geo: fragGeo,
        material: matFragment,
        budget: [cap(60), cap(120)],
        lodDist: 66,
        gather: 254,
        spacing: 11,
        shadow: true,
        solid: true,
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
        const par = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
        par.setUsage(THREE.DynamicDrawUsage);
        // Instanced attributes live on the geometry, and both LODs of a category own their own
        // geometry, so this never collides.
        geo.setAttribute("aScatter", par);
        if (s.shadow) mesh.customDepthMaterial = this._depthMaterial(s);
        return { mesh, geo, par, colour, tris: triCount(geo), drawn: 0, capacity: count };
      });
      return {
        ...s,
        index,
        lods,
        tiles: new Map(),
        pending: [],
        candidates: 0,
        rejected: 0,
        checksum: 0,
      };
    });
  }

  /**
   * Shadow casters need the same vertex program as the colour pass or the fade and the wind
   * desynchronise — a crystal that has shrunk to nothing keeps a full-size shadow, and grass casts
   * a still shadow while it moves. Note `uEye`, not `cameraPosition`: during a shadow pass
   * `cameraPosition` is the *light's* position and every distance in this file would be wrong.
   */
  _depthMaterial(spec) {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const isFlora = spec.id === "abouts" || spec.id === "oldtrue";
    const isCrystal = spec.id === "certainty" || spec.id === "shard" || spec.id === "seam";
    const src = spec.material.userData;
    return extend(mat, `p13:depth:${spec.id}`, {
      uniforms: {
        uEye: { value: this._eye },
        uFade: { value: new THREE.Vector2(1e6, 1e6 + 1) },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3(0.82, 0.57, 0) },
      },
      vertexPars: VERT_PARS + (isFlora ? "attribute float aBend;" : ""),
      vertexBody: vertBody({ shear: isCrystal, wind: isFlora, full: false }),
      fragmentPars: "varying float vFade;\nvarying float vEyeDist;",
      _src: src,
    });
  }

  // ------------------------------------------------------------------ placement masks

  /**
   * The survey. Every mask below is a pure function of world position and the sampled surface, so
   * a critic can re-derive any single instance by hand from (seed, x, z).
   *
   * `held` is the field the world bible describes: how long the claims under this patch of ground
   * have stood. Oldtrue reads high values of it and abouts read low ones, which is why the two
   * plants are mutually exclusive by construction rather than by tuning.
   */
  _held(x, z) {
    return fbm2(x * 0.0125, z * 0.0125, this.seed ^ 0x7a11, 3);
  }

  /** The certainty field: big soft blobs, biased to low ground (`world.md` §9, "the low end"). */
  _certaintyField(x, z, hNorm) {
    const blob = fbm2(x * 0.0165 + 11.3, z * 0.0165 - 4.7, this.seed ^ 0x1c1c, 3);
    // Old claim lines: a ridged band, so crystal also runs in seams across open ground.
    const line = 1 - Math.abs(noise2(x * 0.021 - 3.1, z * 0.021 + 8.4, this.seed ^ 0x2d2d) * 2 - 1);
    const lines = Math.pow(clamp01(line), 6);
    return clamp01(ramp(blob, 0.46, 0.78) * (0.55 + 0.45 * (1 - hNorm)) + lines * 0.85);
  }

  _mask(cat, x, z, s, hNorm) {
    const slope = Math.acos(clamp01(s.ny)) * (180 / Math.PI);
    switch (cat.id) {
      case "certainty":
      case "shard": {
        if (slope > 34) return 0;
        return this._certaintyField(x, z, hNorm) * band(slope, 6, 12, 16);
      }
      case "seam": {
        if (slope > 38) return 0;
        const line = 1 - Math.abs(noise2(x * 0.021 - 3.1, z * 0.021 + 8.4, this.seed ^ 0x2d2d) * 2 - 1);
        return Math.pow(clamp01(line), 14);
      }
      case "abouts": {
        if (slope > 36) return 0;
        // Only on approximation. `world.md` §4.5.
        const approx = 1 - this._held(x, z);
        return ramp(approx, 0.56, 0.80) * band(slope, 4, 14, 18);
      }
      case "oldtrue": {
        // Only on a century of held truth — and lichen prefers a face to a floor.
        const held = this._held(x, z);
        return ramp(held, 0.56, 0.80) * (0.35 + 0.65 * ramp(slope, 6, 34));
      }
      case "debris": {
        if (slope > 32) return 0;
        // Talus: flat-ish ground that has something steep standing over it.
        const steep = this._steepNear(x, z);
        return clamp01(ramp(steep, 26, 46) * 1.15) * band(slope, 10, 14, 14);
      }
      case "fragment": {
        if (slope > 20) return 0;
        const ruin = fbm2(x * 0.019 - 21.7, z * 0.019 + 5.2, this.seed ^ 0x3f3f, 2);
        return ramp(ruin, 0.54, 0.76);
      }
      default:
        return 0;
    }
  }

  /** Max slope within 3 m — four samples, which is enough to find the foot of a face. */
  _steepNear(x, z) {
    let worst = 0;
    const tmp = this._sample;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.7;
      const r = this.surface.sample(x + Math.cos(a) * 3, z + Math.sin(a) * 3, { ...tmp });
      if (!r.hit) continue;
      const slope = Math.acos(clamp01(r.ny)) * (180 / Math.PI);
      if (slope > worst) worst = slope;
    }
    return worst;
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

    const mats = [];
    const cols = [];
    const pars = [];
    const lodJ = [];
    const solids = [];
    let rejected = 0;

    const s = this._sample;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        // Lattice index in absolute world cells so tile borders are invisible.
        const gx = tx * n + ix;
        const gz = tz * n + iz;
        const h0 = hashU32(gx, gz, catSeed);
        const rr = stream(h0);
        const px = x0 + (ix + 0.15 + rr() * 0.7) * spacing;
        const pz = z0 + (iz + 0.15 + rr() * 0.7) * spacing;

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

        if (cat.clustered) {
          this._emitCluster(cat, px, pz, s, rr, mats, cols, pars, lodJ, solids);
        } else {
          this._emitOne(cat, px, s.y, pz, s, rr, mats, cols, pars, lodJ, solids);
        }
      }
    }

    const count = lodJ.length;
    const tile = {
      tx,
      tz,
      count,
      mat: Float32Array.from(mats),
      col: Float32Array.from(cols),
      par: Float32Array.from(pars),
      lod: Float32Array.from(lodJ),
      cx: x0 + SCATTER_TILE * 0.5,
      cz: z0 + SCATTER_TILE * 0.5,
    };
    cat.tiles.set(this._tileKey(tx, tz), tile);
    cat.candidates += count;
    cat.rejected += rejected;
    // Order-independent checksum: two runs that load tiles in different orders still agree.
    let sum = cat.checksum >>> 0;
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      sum =
        (sum +
          hashU32(
            Math.round(tile.mat[o + 12] * 64),
            Math.round(tile.mat[o + 14] * 64),
            Math.round(tile.mat[o + 13] * 64) ^ cat.index
          )) >>>
        0;
    }
    cat.checksum = sum;
    if (solids.length) this._solids.push(...solids);
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
   * A formation, not a sprinkle. One tall habit anchors it, satellites ring it at decreasing
   * height, and every one of them leans a different way — which is what stops an instanced field
   * from reading as a stamp.
   */
  _emitCluster(cat, cx, cz, s, rr, mats, cols, pars, lodJ, solids) {
    const isSeam = cat.id === "seam";
    const kids = isSeam ? 1 + Math.floor(rr() * 2) : cat.id === "shard" ? 4 + Math.floor(rr() * 6) : 3 + Math.floor(rr() * 5);
    const spread = cat.id === "shard" ? 2.6 : 1.9;
    const tmp = { hit: false, y: 0, nx: 0, ny: 1, nz: 0 };
    for (let k = 0; k < kids; k++) {
      const a = rr() * Math.PI * 2;
      const r = k === 0 ? 0 : Math.pow(rr(), 0.6) * spread;
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      this.surface.sample(px, pz, tmp);
      if (!tmp.hit) continue;
      this._emitOne(cat, px, tmp.y, pz, tmp, rr, mats, cols, pars, lodJ, solids, k === 0);
    }
  }

  _emitOne(cat, x, y, z, s, rr, mats, cols, pars, lodJ, solids, hero = false) {
    const m4 = this._m4;
    const q = this._q;
    const q2 = this._q2;
    const v = this._v;

    // Growth axis: mostly the surface normal, pulled toward world up so nothing lies down a slope.
    const up = v.set(s.nx, s.ny, s.nz).normalize().lerp(this._up, cat.id === "oldtrue" ? 0 : 0.45).normalize();
    q.setFromUnitVectors(this._up, up);
    // A free tilt on top, so a formation is never a bundle of parallel sticks.
    const tiltAmt = cat.id === "oldtrue" ? 0 : (cat.id === "abouts" ? 0.14 : 0.30) * rr();
    const tiltAz = rr() * Math.PI * 2;
    q2.setFromAxisAngle(v.set(Math.cos(tiltAz), 0, Math.sin(tiltAz)), tiltAmt);
    q.multiply(q2);
    q2.setFromAxisAngle(this._up, rr() * Math.PI * 2);
    q.multiply(q2);

    let sx;
    let sy;
    switch (cat.id) {
      case "certainty":
        sy = (hero ? 1.5 + rr() * 1.85 : 0.5 + rr() * 1.15) * (0.85 + rr() * 0.3);
        sx = sy * (0.14 + rr() * 0.1);
        break;
      case "shard":
        sy = hero ? 0.55 + rr() * 0.7 : 0.16 + rr() * 0.42;
        sx = sy * (0.42 + rr() * 0.4);
        break;
      case "seam":
        sy = hero ? 1.1 + rr() * 1.1 : 0.45 + rr() * 0.6;
        sx = sy * (0.15 + rr() * 0.08);
        break;
      case "abouts":
        sy = 0.20 + rr() * 0.26;
        sx = sy * (1.5 + rr() * 1.0);
        break;
      case "oldtrue":
        sy = 1;
        sx = 0.34 + rr() * 0.62;
        break;
      case "debris":
        sy = 0.13 + Math.pow(rr(), 2.1) * 0.52;
        sx = sy * (0.9 + rr() * 1.5);
        break;
      case "fragment":
        sy = 0.7 + Math.pow(rr(), 1.5) * 1.9;
        sx = sy * (0.55 + rr() * 0.6);
        break;
      default:
        sy = 1;
        sx = 1;
    }
    const sz = sx * (0.8 + rr() * 0.45);
    // Sink the base a little so nothing hovers on a slope the normal did not predict.
    const sink = cat.id === "oldtrue" ? 0 : sy * 0.06 + 0.015;
    m4.compose(v.set(x, y - sink, z), q, this._v2 ?? (this._v2 = new THREE.Vector3()).set(sx, sy, sz));
    // `compose` consumed the scratch vector, so rewrite it explicitly for clarity.
    m4.compose(new THREE.Vector3(x, y - sink, z), q, new THREE.Vector3(sx, sy, sz));

    const base = mats.length;
    m4.toArray(mats, base);

    // Per-instance colour. Hue and value drift only — saturation is budgeted by the art direction
    // and a scatter field is exactly where an unwatched ±0.2 would eat the frame.
    const c = this._colour;
    switch (cat.id) {
      case "certainty":
      case "shard":
        c.setHex(PAL.certaintyFacet, THREE.SRGBColorSpace);
        break;
      case "seam":
        c.setHex(PAL.resonanceCore, THREE.SRGBColorSpace);
        break;
      case "abouts":
        c.setHex(PAL.foliage, THREE.SRGBColorSpace);
        break;
      case "oldtrue":
        c.setHex(0xd6dccb, THREE.SRGBColorSpace);
        break;
      case "debris":
        c.setHex(PAL.rockAlbedo, THREE.SRGBColorSpace);
        break;
      default:
        c.setHex(PAL.bone, THREE.SRGBColorSpace);
    }
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const spread = cat.id === "abouts" ? 0.018 : 0.012;
    c.setHSL(
      (hsl.h + (rr() - 0.5) * spread + 1) % 1,
      clamp01(hsl.s * (0.86 + rr() * 0.24)),
      clamp01(hsl.l * (0.74 + rr() * 0.5))
    );
    cols.push(c.r, c.g, c.b);

    // aScatter: x seed, y shear/stiffness, z spare, w fade jitter.
    const shear = cat.id === "certainty" ? 0.02 + rr() * 0.10 : cat.id === "seam" ? 0.02 + rr() * 0.07 : rr() * 0.5;
    pars.push(rr(), shear, rr(), rr());

    lodJ.push(cat.lodDist * (0.88 + rr() * 0.24));

    if (cat.solid && sy > (cat.id === "fragment" ? 1.1 : 1.7)) {
      solids.push({ cat: cat.id, m: mats.slice(base, base + 16) });
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
    this._solidsSent = false;
    this._lastGatherEye.set(1e9, 1e9, 1e9);
    this._built = false;
  }

  frame(dt) {
    // Wind runs on simulation time so `advance()` reproduces the frame exactly.
    this._time = this.kernel.simTime;
    for (const cat of this.categories) {
      const sh = cat.material.userData.shader;
      if (sh) sh.uniforms.uTime.value = this._time;
      for (const l of cat.lods) {
        const ds = l.mesh.customDepthMaterial?.userData?.shader;
        if (ds) {
          ds.uniforms.uTime.value = this._time;
          ds.uniforms.uFade.value.copy(cat.material.userData.shader?.uniforms.uFade.value ?? ds.uniforms.uFade.value);
          ds.uniforms.uWind.value.copy(cat.material.userData.shader?.uniforms.uWind.value ?? ds.uniforms.uWind.value);
        }
      }
    }
  }

  after() {
    this.kernel.camera.getWorldPosition(this._eye);
    if (this.surface.mode === "flat" || this.surface.mode === "none") {
      const before = this.surface.mode;
      if (this.surface.refresh() !== before) this.rebuild();
    }

    const moved = this._eye.distanceToSquared(this._lastGatherEye);
    const need = this._streamTiles();
    if (!need && moved < 9 && this._built) return;

    this._lastGatherEye.copy(this._eye);
    this._gather();
    this._built = true;
    if (!this._solidsSent && !need) this._publishSolids();
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
      for (let dz = -rings; dz <= rings; dz++) {
        for (let dx = -rings; dx <= rings; dx++) {
          const tx = ex + dx;
          const tz = ez + dz;
          const cx = (tx + 0.5) * SCATTER_TILE - this._eye.x;
          const cz = (tz + 0.5) * SCATTER_TILE - this._eye.z;
          if (cx * cx + cz * cz > (cat.gather + SCATTER_TILE) ** 2) continue;
          if (cat.tiles.has(this._tileKey(tx, tz))) continue;
          if (performance.now() - t0 > this._budgetMs) {
            outstanding = true;
            break;
          }
          this._generateTile(cat, tx, tz);
        }
        if (outstanding) break;
      }
      // Evict what is well behind us; regeneration is deterministic so nothing is lost.
      if (cat.tiles.size > 400) {
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
   * Nearest-first is the whole reason the budget is safe to state as a number: when a ceiling
   * binds it always bites the farthest instances, so the failure mode is "the horizon thins",
   * never "a hole opens beside the player".
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

      for (const t of order) {
        if (t._d > (cat.gather + SCATTER_TILE) ** 2) continue;
        for (let i = 0; i < t.count; i++) {
          const o = i * 16;
          const px = t.mat[o + 12];
          const py = t.mat[o + 13];
          const pz = t.mat[o + 14];
          const ddx = px - eye.x;
          const ddy = py - eye.y;
          const ddz = pz - eye.z;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > g2) continue;
          const li = cat.lods.length > 1 && d2 > t.lod[i] * t.lod[i] ? 1 : 0;
          const l = cat.lods[li];
          if (!l || l.drawn >= l.capacity) continue;
          const w = l.drawn++;
          l.mesh.instanceMatrix.array.set(t.mat.subarray(o, o + 16), w * 16);
          l.colour.array.set(t.col.subarray(i * 3, i * 3 + 3), w * 3);
          l.par.array.set(t.par.subarray(i * 4, i * 4 + 4), w * 4);
        }
      }

      for (const l of cat.lods) {
        l.mesh.count = l.drawn;
        l.mesh.visible = l.drawn > 0;
        l.mesh.instanceMatrix.needsUpdate = true;
        l.colour.needsUpdate = true;
        l.par.needsUpdate = true;
      }
    }
  }

  /**
   * Hand the big solids to collision as one merged, world-space collider. Only the objects a
   * player could actually walk into are included — a field of 0.2 m chips in the broadphase would
   * cost far more than it buys.
   */
  _publishSolids() {
    this._solidsSent = true;
    const collision = this.kernel.get?.("collision");
    if (!collision || typeof collision.registerCollider !== "function") return;
    if (!this._solids.length) return;

    const positions = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const byCat = new Map();
    for (const cat of this.categories) byCat.set(cat.id, cat.lods[cat.lods.length - 1].geo);

    let used = 0;
    for (const solid of this._solids) {
      if (used >= 260) break;
      const geo = byCat.get(solid.cat);
      if (!geo) continue;
      m.fromArray(solid.m);
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        positions.push(v.x, v.y, v.z);
      }
      used++;
    }
    if (!positions.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this._solidGeo?.dispose();
    this._solidGeo = geo;
    signals.emit("world:collider", { id: "p13:scatter-solids", geometry: geo });
    if (!collision.colliders?.has?.("p13:scatter-solids")) {
      collision.registerCollider({ id: "p13:scatter-solids", geometry: geo });
    }
    this._solidCount = used;
  }

  // ------------------------------------------------------------------ reviewer contract

  probe() {
    let instances = 0;
    let triangles = 0;
    let draws = 0;
    const cats = {};
    for (const cat of this.categories) {
      const per = { budget: cat.budget.slice(), drawn: [], tris: 0, candidates: cat.candidates, tiles: cat.tiles.size };
      for (const l of cat.lods) {
        per.drawn.push(l.drawn);
        per.tris += l.drawn * l.tris;
        if (l.mesh.visible) draws++;
      }
      per.geoTris = cat.lods.map((l) => l.tris);
      per.checksum = cat.checksum;
      instances += per.drawn.reduce((a, b) => a + b, 0);
      triangles += per.tris;
      cats[cat.id] = per;
    }
    return {
      seed: this.seed,
      tier: this.tier,
      density: Number(this.density.toFixed(3)),
      surface: this.surface.mode,
      surfaceQueries: this.surface.queries,
      built: Boolean(this._built),
      streaming: this.categories.reduce((a, c) => a + c.tiles.size, 0),
      genCalls: this._genCalls,
      genMsTotal: Number(this._genMs.toFixed(2)),
      instances,
      triangles,
      meshes: draws,
      solids: this._solidCount ?? 0,
      eye: [
        Number(this._eye.x.toFixed(2)),
        Number(this._eye.y.toFixed(2)),
        Number(this._eye.z.toFixed(2)),
      ],
      checksum: this.categories.reduce((a, c) => (a + c.checksum) >>> 0, 0) >>> 0,
      categories: cats,
    };
  }

  dispose() {
    this._offReady?.();
    this._offSpawn?.();
    const seen = new Set();
    for (const cat of this.categories) {
      for (const l of cat.lods) {
        l.geo.dispose();
        l.mesh.customDepthMaterial?.dispose();
      }
      if (!seen.has(cat.material)) {
        seen.add(cat.material);
        cat.material.dispose();
      }
    }
    this._solidGeo?.dispose();
    this.kernel.get?.("collision")?.removeCollider?.("p13:scatter-solids");
  }
}
