import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";

/**
 * CollisionWorld — capsule-vs-triangle-soup solver and spatial query service.
 *
 * Design notes that matter for feel, not just correctness:
 *
 *  1. **Depenetration, not stop-on-hit.** Movement is integrated in sub-steps no longer than
 *     half a capsule radius, and after every sub-step the capsule is pushed out of whatever it
 *     overlaps along the shortest axis. Removing only the penetrating component *is* wall
 *     sliding — you never lose the tangential part of your momentum on a graze, which is the
 *     difference between a world that guides you and a world that catches you.
 *
 *  2. **Ground is measured perpendicular to the surface.** A capsule resting on a 40° ramp is
 *     0.16 m above the ground *vertically* while touching it perpendicular. Testing the vertical
 *     gap makes a character flicker between grounded and airborne on every slope; testing
 *     `gap * normal.y` does not.
 *
 *  3. **Step-up is a movement retry, not a teleport.** When a horizontal sub-step loses more
 *     than half its progress to a wall-ish contact, the same sub-step is replayed from
 *     `stepHeight` higher, then settled by binary-searching the largest clear drop — a *capsule*
 *     clearance search, not a downward ray. A ray from the capsule's axis misses the tread edge
 *     while the body is still in front of the step, reports the floor it came from, and refuses
 *     every ledge taller than the bottom sphere can roll over unaided. Small ledges therefore
 *     cost nothing and large ones stay solid, with no "is this a stair" classification to get
 *     wrong. `out.stepRise` reports the height gained so the caller can budget it.
 *
 * Colliders arrive from other systems as `world:collider {id, mesh|geometry, matrix}`. Until a
 * real world registers one, a generated proving ground stands in so this piece is reviewable and
 * measurable on its own; it removes itself the moment an external collider appears.
 */

const SKIN = 0.0025;
const MAX_DEPEN_ITERS = 8;
const GRID_HALF = 32768;

// ---------------------------------------------------------------------------- scratch
// Every hot-path helper writes into module-scope buffers. The solver runs 60×/s inside the
// fixed step; allocating three Vector3s per triangle test would hand the GC a steady drip.
const _tA = new Float64Array(3);
const _tB = new Float64Array(3);
const _sA = new Float64Array(3);
const _sB = new Float64Array(3);
const _closeSeg = new Float64Array(3);
const _closeTri = new Float64Array(3);
const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _mat = new THREE.Matrix4();

function cellKey(ix, iz) {
  return (ix + GRID_HALF) * 65536 + (iz + GRID_HALF);
}

/** Closest point on triangle abc to point p (Ericson, Real-Time Collision Detection §5.1.5). */
function closestPtTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

/** Closest points between segment p1q1 and segment p2q2 (Ericson §5.1.9). */
function closestPtSegSeg(
  p1x, p1y, p1z, q1x, q1y, q1z,
  p2x, p2y, p2z, q2x, q2y, q2z,
  out1, out2
) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  const EPS = 1e-12;

  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  out1[0] = p1x + d1x * s; out1[1] = p1y + d1y * s; out1[2] = p1z + d1z * s;
  out2[0] = p2x + d2x * t; out2[1] = p2y + d2y * t; out2[2] = p2z + d2z * t;
}

function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Squared distance between segment p0p1 and triangle abc, with the witness points.
 *
 * The minimum is attained either at a segment endpoint against the triangle, or between the
 * segment and one of the three edges, or it is zero because the segment pierces the face. All
 * four cases are evaluated — the popular "project once and clamp" shortcut silently misses
 * grazing contacts, which shows up in game as a character sinking through a shallow ramp.
 * Returns the distance squared; sets `penetrated` on the returned record.
 */
const _segTriResult = { d2: 0, penetrated: false };
function segTriClosest(
  p0x, p0y, p0z, p1x, p1y, p1z,
  ax, ay, az, bx, by, bz, cx, cy, cz,
  nx, ny, nz
) {
  // Pierce test first: cheap, and it is the only case with an exact answer of zero.
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  const denom = nx * dx + ny * dy + nz * dz;
  if (Math.abs(denom) > 1e-12) {
    const t = (nx * (ax - p0x) + ny * (ay - p0y) + nz * (az - p0z)) / denom;
    if (t >= 0 && t <= 1) {
      const hx = p0x + dx * t, hy = p0y + dy * t, hz = p0z + dz * t;
      closestPtTri(hx, hy, hz, ax, ay, az, bx, by, bz, cx, cy, cz, _tA);
      const gx = hx - _tA[0], gy = hy - _tA[1], gz = hz - _tA[2];
      if (gx * gx + gy * gy + gz * gz < 1e-10) {
        _closeSeg[0] = hx; _closeSeg[1] = hy; _closeSeg[2] = hz;
        _closeTri[0] = hx; _closeTri[1] = hy; _closeTri[2] = hz;
        _segTriResult.d2 = 0;
        _segTriResult.penetrated = true;
        return _segTriResult;
      }
    }
  }

  let best = Infinity;
  _segTriResult.penetrated = false;

  closestPtTri(p0x, p0y, p0z, ax, ay, az, bx, by, bz, cx, cy, cz, _tA);
  _sA[0] = p0x; _sA[1] = p0y; _sA[2] = p0z;
  let d = dist2(_sA, _tA);
  if (d < best) { best = d; _closeSeg.set(_sA); _closeTri.set(_tA); }

  closestPtTri(p1x, p1y, p1z, ax, ay, az, bx, by, bz, cx, cy, cz, _tB);
  _sB[0] = p1x; _sB[1] = p1y; _sB[2] = p1z;
  d = dist2(_sB, _tB);
  if (d < best) { best = d; _closeSeg.set(_sB); _closeTri.set(_tB); }

  for (let e = 0; e < 3; e++) {
    const ex0 = e === 0 ? ax : e === 1 ? bx : cx;
    const ey0 = e === 0 ? ay : e === 1 ? by : cy;
    const ez0 = e === 0 ? az : e === 1 ? bz : cz;
    const ex1 = e === 0 ? bx : e === 1 ? cx : ax;
    const ey1 = e === 0 ? by : e === 1 ? cy : ay;
    const ez1 = e === 0 ? bz : e === 1 ? cz : az;
    closestPtSegSeg(p0x, p0y, p0z, p1x, p1y, p1z, ex0, ey0, ez0, ex1, ey1, ez1, _tA, _tB);
    d = dist2(_tA, _tB);
    if (d < best) { best = d; _closeSeg.set(_tA); _closeTri.set(_tB); }
  }

  _segTriResult.d2 = best;
  return _segTriResult;
}

/** Möller–Trumbore, two-sided. Returns t along the ray or -1. */
function rayTri(
  ox, oy, oz, dx, dy, dz,
  ax, ay, az, bx, by, bz, cx, cy, cz
) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// ---------------------------------------------------------------------------- the system

export class CollisionWorld {
  constructor(kernel, opts = {}) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "collision-proving-ground";

    this.cellSize = opts.cellSize ?? 2.5;
    this.colliders = new Map();

    this._dirty = false;
    this._triCount = 0;
    this._tri = new Float32Array(0);   // 9 floats per triangle, world space
    this._nrm = new Float32Array(0);   // 3 floats per triangle, unit
    this._minY = new Float32Array(0);
    this._maxY = new Float32Array(0);
    this._grid = new Map();            // cellKey -> number[] of triangle indices
    this._oversized = [];              // triangles spanning too many cells to bin
    this._stamp = new Int32Array(0);
    this._queryId = 0;
    this._cand = new Int32Array(2048);
    this._candCount = 0;

    this._fallback = null;
    this.counters = { depenetrations: 0, rays: 0, triTests: 0 };

    this._offCollider = signals.on("world:collider", (p) => this.registerCollider(p));

    publish("collision", () => ({
      colliders: this.colliders.size,
      triangles: this._triCount,
      cells: this._grid.size,
      oversized: this._oversized.length,
      cellSize: this.cellSize,
      fallbackGround: Boolean(this._fallback),
      counters: { ...this.counters },
    }));
  }

  // ------------------------------------------------------------------ registration

  /**
   * `world:collider {id, mesh|geometry, matrix}`. Triangles are baked into world space once at
   * registration — static colliders only, which is the contract this game's world needs and is
   * what makes a flat triangle array and a uniform grid the right structures.
   */
  registerCollider(payload) {
    if (!payload || !payload.id) return false;
    if (payload.remove) {
      if (this.colliders.delete(payload.id)) this._dirty = true;
      return true;
    }
    const geometry = payload.geometry ?? payload.mesh?.geometry;
    if (!geometry?.getAttribute?.("position")) return false;

    let matrix = payload.matrix;
    if (!matrix && payload.mesh) {
      payload.mesh.updateWorldMatrix(true, false);
      matrix = payload.mesh.matrixWorld;
    }
    _mat.identity();
    if (matrix) _mat.copy(matrix);

    const verts = this._bake(geometry, _mat);
    if (!verts.length) return false;

    this.colliders.set(payload.id, { id: payload.id, verts });
    this._dirty = true;

    // A real world has landed — the stand-in proving ground must not fight it.
    if (this._fallback && payload.id !== this._fallback.id) this._clearFallback();
    return true;
  }

  removeCollider(id) {
    if (this.colliders.delete(id)) this._dirty = true;
  }

  _bake(geometry, matrix) {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const n = index ? index.count : pos.count;
    const out = new Float32Array(Math.floor(n / 3) * 9);
    let w = 0;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(i + k) : i + k;
        _v3.fromBufferAttribute(pos, vi).applyMatrix4(matrix);
        out[w++] = _v3.x; out[w++] = _v3.y; out[w++] = _v3.z;
      }
    }
    return out.subarray(0, w);
  }

  _rebuild() {
    this._dirty = false;
    let total = 0;
    for (const c of this.colliders.values()) total += c.verts.length / 9;

    const tri = new Float32Array(total * 9);
    const nrm = new Float32Array(total * 3);
    const minY = new Float32Array(total);
    const maxY = new Float32Array(total);

    let t = 0;
    for (const c of this.colliders.values()) {
      for (let i = 0; i + 8 < c.verts.length; i += 9) {
        const ax = c.verts[i], ay = c.verts[i + 1], az = c.verts[i + 2];
        const bx = c.verts[i + 3], by = c.verts[i + 4], bz = c.verts[i + 5];
        const cx = c.verts[i + 6], cy = c.verts[i + 7], cz = c.verts[i + 8];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) continue; // degenerate — never contributes a contact
        nx /= len; ny /= len; nz /= len;

        const o = t * 9;
        tri[o] = ax; tri[o + 1] = ay; tri[o + 2] = az;
        tri[o + 3] = bx; tri[o + 4] = by; tri[o + 5] = bz;
        tri[o + 6] = cx; tri[o + 7] = cy; tri[o + 8] = cz;
        nrm[t * 3] = nx; nrm[t * 3 + 1] = ny; nrm[t * 3 + 2] = nz;
        minY[t] = Math.min(ay, by, cy);
        maxY[t] = Math.max(ay, by, cy);
        t++;
      }
    }

    this._triCount = t;
    this._tri = tri;
    this._nrm = nrm;
    this._minY = minY;
    this._maxY = maxY;
    this._stamp = new Int32Array(t);
    this._queryId = 0;

    // Uniform XZ grid. A BVH would win on a 2 M-triangle world; for terrain-shaped worlds a
    // flat grid is faster to build, allocation-free to query and trivial to prove correct.
    this._grid = new Map();
    this._oversized.length = 0;
    const cs = this.cellSize;
    for (let i = 0; i < t; i++) {
      const o = i * 9;
      const x0 = Math.min(tri[o], tri[o + 3], tri[o + 6]);
      const x1 = Math.max(tri[o], tri[o + 3], tri[o + 6]);
      const z0 = Math.min(tri[o + 2], tri[o + 5], tri[o + 8]);
      const z1 = Math.max(tri[o + 2], tri[o + 5], tri[o + 8]);
      const ix0 = Math.floor(x0 / cs), ix1 = Math.floor(x1 / cs);
      const iz0 = Math.floor(z0 / cs), iz1 = Math.floor(z1 / cs);
      if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > 96) { this._oversized.push(i); continue; }
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = cellKey(ix, iz);
          let list = this._grid.get(k);
          if (!list) this._grid.set(k, (list = []));
          list.push(i);
        }
      }
    }
  }

  ensureBuilt() {
    if (this._dirty) this._rebuild();
  }

  // ------------------------------------------------------------------ broadphase

  _gather(minX, minZ, maxX, maxZ, loY, hiY) {
    this.ensureBuilt();
    const cs = this.cellSize;
    const id = ++this._queryId;
    const stamp = this._stamp;
    let n = 0;
    const cand = this._cand;
    const ix0 = Math.floor(minX / cs), ix1 = Math.floor(maxX / cs);
    const iz0 = Math.floor(minZ / cs), iz1 = Math.floor(maxZ / cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this._grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const t = list[j];
          if (stamp[t] === id) continue;
          stamp[t] = id;
          if (this._maxY[t] < loY || this._minY[t] > hiY) continue;
          if (n < cand.length) cand[n++] = t;
        }
      }
    }
    for (let j = 0; j < this._oversized.length; j++) {
      const t = this._oversized[j];
      if (stamp[t] === id) continue;
      stamp[t] = id;
      if (this._maxY[t] < loY || this._minY[t] > hiY) continue;
      if (n < cand.length) cand[n++] = t;
    }
    this._candCount = n;
    return n;
  }

  // ------------------------------------------------------------------ capsule solving

  /**
   * Push `pos` (capsule centre) out of everything it overlaps.
   * @returns {{pushes:number, groundNy:number, gnx:number, gny:number, gnz:number,
   *            wall:boolean, wnx:number, wny:number, wnz:number, push:number}}
   */
  depenetrate(pos, radius, halfSeg, result = {}) {
    this.ensureBuilt();
    result.pushes = 0;
    result.gnx = 0; result.gny = -1; result.gnz = 0;
    result.wall = false; result.wnx = 0; result.wny = 0; result.wnz = 0;
    result.push = 0;
    if (this._triCount === 0) return result;

    const r2 = radius * radius;
    const tri = this._tri, nrm = this._nrm, cand = this._cand;

    for (let iter = 0; iter < MAX_DEPEN_ITERS; iter++) {
      const p0y = pos.y - halfSeg, p1y = pos.y + halfSeg;
      const n = this._gather(
        pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius,
        p0y - radius, p1y + radius
      );

      let bestDepth = 0, bx = 0, by = 0, bz = 0;
      for (let i = 0; i < n; i++) {
        const t = cand[i];
        const o = t * 9;
        this.counters.triTests++;
        const res = segTriClosest(
          pos.x, p0y, pos.z, pos.x, p1y, pos.z,
          tri[o], tri[o + 1], tri[o + 2],
          tri[o + 3], tri[o + 4], tri[o + 5],
          tri[o + 6], tri[o + 7], tri[o + 8],
          nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]
        );
        if (!res.penetrated && res.d2 >= r2) continue;

        let dx = _closeSeg[0] - _closeTri[0];
        let dy = _closeSeg[1] - _closeTri[1];
        let dz = _closeSeg[2] - _closeTri[2];
        let d = Math.hypot(dx, dy, dz);
        let depth;
        if (res.penetrated || d < 1e-6) {
          // Deep or exactly-on-surface: fall back to the face normal, oriented toward us.
          const nx = nrm[t * 3], ny = nrm[t * 3 + 1], nz = nrm[t * 3 + 2];
          const s = (pos.x - tri[o]) * nx + (pos.y - tri[o + 1]) * ny + (pos.z - tri[o + 2]) * nz;
          const sign = s >= 0 ? 1 : -1;
          dx = nx * sign; dy = ny * sign; dz = nz * sign;
          depth = radius;
        } else {
          dx /= d; dy /= d; dz /= d;
          depth = radius - d;
        }

        if (dy > result.gny) { result.gny = dy; result.gnx = dx; result.gnz = dz; }
        if (dy < 0.5 && depth > 1e-4) {
          result.wall = true;
          result.wnx = dx; result.wny = dy; result.wnz = dz;
        }
        if (depth > bestDepth) { bestDepth = depth; bx = dx; by = dy; bz = dz; }
      }

      if (bestDepth <= 1e-5) break;
      const move = bestDepth + SKIN;
      pos.x += bx * move; pos.y += by * move; pos.z += bz * move;
      result.push += move;
      result.pushes++;
      this.counters.depenetrations++;
    }
    if (result.gny === -1) { result.gny = 0; }
    return result;
  }

  /**
   * Downward probe from the capsule's bottom sphere. Five rays (centre + four inset corners) so
   * that standing with your toes over an edge still reports ground, which is what lets coyote
   * time feel generous instead of arbitrary.
   *
   * `gap` is the distance from the capsule surface straight down to the ground; multiply by
   * `normal.y` to get the perpendicular gap, which is the one that is slope-invariant.
   */
  groundProbe(pos, radius, halfSeg, maxDrop, out = {}) {
    this.ensureBuilt();
    out.hit = false; out.gap = Infinity; out.y = -Infinity;
    out.nx = 0; out.ny = 1; out.nz = 0;
    const off = radius * 0.6;
    const originY = pos.y - halfSeg;
    const reach = radius + maxDrop;
    for (let s = 0; s < 5; s++) {
      const ox = pos.x + (s === 1 ? off : s === 2 ? -off : 0);
      const oz = pos.z + (s === 3 ? off : s === 4 ? -off : 0);
      const r = this.raycast(ox, originY + 0.02, oz, 0, -1, 0, reach + 0.02, _rayOut);
      if (!r.hit) continue;
      const gap = r.t - 0.02 - radius;
      if (gap < out.gap) {
        out.hit = true;
        out.gap = Math.max(gap, -radius);
        out.y = r.y;
        out.nx = r.nx; out.ny = r.ny; out.nz = r.nz;
      }
    }
    return out;
  }

  /**
   * Move a capsule by `delta` with sub-stepped depenetration and optional step-up.
   * Mutates and returns `pos`.
   */
  moveCapsule(pos, delta, opts) {
    const radius = opts.radius;
    const halfSeg = opts.halfSeg;
    const stepHeight = opts.stepHeight ?? 0;
    const slopeCos = opts.slopeCos ?? 0.7;
    const canStep = Boolean(opts.grounded) && stepHeight > 0;
    const out = opts.out ?? {};
    out.blocked = false;
    out.stepped = false;
    out.stepRise = 0;
    out.wnx = 0; out.wny = 0; out.wnz = 0;
    out.groundNy = 0;

    const len = Math.hypot(delta.x, delta.y, delta.z);
    if (len < 1e-9) {
      const r = this.depenetrate(pos, radius, halfSeg, _depenOut);
      out.groundNy = r.gny;
      return pos;
    }
    const subs = Math.min(16, Math.max(1, Math.ceil(len / (radius * 0.5))));
    const ix = delta.x / subs, iy = delta.y / subs, iz = delta.z / subs;
    const wantLen = Math.hypot(ix, iz);
    let stepTries = 0;

    for (let s = 0; s < subs; s++) {
      const bx = pos.x, by = pos.y, bz = pos.z;
      pos.x += ix; pos.y += iy; pos.z += iz;
      const r = this.depenetrate(pos, radius, halfSeg, _depenOut);
      if (r.gny > out.groundNy) out.groundNy = r.gny;

      if (wantLen < 1e-6 || !r.wall) continue;
      const progressed = ((pos.x - bx) * ix + (pos.z - bz) * iz) / wantLen;
      if (progressed >= wantLen * 0.5) continue;

      out.blocked = true;
      out.wnx = r.wnx; out.wny = r.wny; out.wnz = r.wnz;
      if (!canStep || stepTries >= 2) continue;
      stepTries++;

      // --- step-up retry ---------------------------------------------------------------
      // Replay this sub-step from `stepHeight` higher, then settle back down by *binary
      // searching the largest clear drop* rather than casting a ray. A ray from the capsule's
      // axis misses the tread's top edge entirely when the body is still mostly in front of the
      // step, which reports "the floor is still down there" and refuses every ledge taller than
      // the bottom sphere can roll over on its own. Searching capsule clearance catches the edge
      // and lets a walk-speed step gain a few centimetres per frame until the body is over it.
      _stepSave.set(pos.x, pos.y, pos.z);
      const raisedY = by + stepHeight;
      pos.set(bx, raisedY, bz);
      this.depenetrate(pos, radius, halfSeg, _depenStep);
      const clearOverhead =
        pos.y >= raisedY - 0.05 &&
        Math.abs(pos.x - bx) < 0.05 && Math.abs(pos.z - bz) < 0.05;
      let accepted = false;
      if (clearOverhead) {
        pos.x += ix; pos.z += iz;
        this.depenetrate(pos, radius, halfSeg, _depenStep);
        const gained = ((pos.x - bx) * ix + (pos.z - bz) * iz) / wantLen;
        if (gained > progressed + 0.004) {
          const maxDrop = stepHeight + 0.08;
          let lo = 0, hi = maxDrop;
          if (!this._capsuleOverlaps(pos.x, pos.y - hi, pos.z, radius, halfSeg)) lo = hi;
          else {
            for (let k = 0; k < 8; k++) {
              const mid = (lo + hi) * 0.5;
              if (this._capsuleOverlaps(pos.x, pos.y - mid, pos.z, radius, halfSeg)) hi = mid;
              else lo = mid;
            }
          }
          const settled = pos.y - lo;
          if (settled > by + 0.004 && settled <= by + stepHeight + 0.02) {
            pos.y = settled;
            this.depenetrate(pos, radius, halfSeg, _depenStep);
            // Re-check after the settle push: a ledge just over the limit can shove the capsule
            // higher than the search found, and accepting that is how a "0.45 m step" quietly
            // becomes a 0.6 m one.
            accepted = pos.y > by + 0.002 && pos.y <= by + stepHeight + 0.02;
          }
        }
      }
      if (accepted) {
        out.stepped = true;
        out.stepRise += pos.y - by;
        out.blocked = false;
      } else {
        pos.copy(_stepSave);
      }
    }
    return pos;
  }

  /** Cheap boolean: does a capsule at this pose touch anything? */
  _capsuleOverlaps(px, py, pz, radius, halfSeg) {
    const p0y = py - halfSeg, p1y = py + halfSeg;
    const n = this._gather(
      px - radius, pz - radius, px + radius, pz + radius, p0y - radius, p1y + radius
    );
    const r2 = radius * radius;
    const tri = this._tri, nrm = this._nrm, cand = this._cand;
    for (let i = 0; i < n; i++) {
      const t = cand[i];
      const o = t * 9;
      const res = segTriClosest(
        px, p0y, pz, px, p1y, pz,
        tri[o], tri[o + 1], tri[o + 2],
        tri[o + 3], tri[o + 4], tri[o + 5],
        tri[o + 6], tri[o + 7], tri[o + 8],
        nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]
      );
      if (res.penetrated || res.d2 < r2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ queries

  /**
   * Raycast against the triangle soup. 2-D DDA over the XZ grid; near-vertical rays collapse to
   * a single column walk. Writes into `out` to stay allocation-free in the fixed step.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 1000, out = {}) {
    this.ensureBuilt();
    this.counters.rays++;
    out.hit = false; out.t = maxDist; out.x = 0; out.y = 0; out.z = 0;
    out.nx = 0; out.ny = 1; out.nz = 0; out.tri = -1;
    if (this._triCount === 0) return out;

    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-12) return out;
    dx /= dl; dy /= dl; dz /= dl;

    const cs = this.cellSize;
    const tri = this._tri;
    let bestT = maxDist;
    let bestTri = -1;

    const id = ++this._queryId;
    const stamp = this._stamp;

    const test = (ix, iz) => {
      const list = this._grid.get(cellKey(ix, iz));
      if (!list) return;
      for (let j = 0; j < list.length; j++) {
        const t = list[j];
        if (stamp[t] === id) continue;
        stamp[t] = id;
        const o = t * 9;
        this.counters.triTests++;
        const hitT = rayTri(
          ox, oy, oz, dx, dy, dz,
          tri[o], tri[o + 1], tri[o + 2],
          tri[o + 3], tri[o + 4], tri[o + 5],
          tri[o + 6], tri[o + 7], tri[o + 8]
        );
        if (hitT >= 0 && hitT < bestT) { bestT = hitT; bestTri = t; }
      }
    };

    for (let j = 0; j < this._oversized.length; j++) {
      const t = this._oversized[j];
      if (stamp[t] === id) continue;
      stamp[t] = id;
      const o = t * 9;
      const hitT = rayTri(
        ox, oy, oz, dx, dy, dz,
        tri[o], tri[o + 1], tri[o + 2],
        tri[o + 3], tri[o + 4], tri[o + 5],
        tri[o + 6], tri[o + 7], tri[o + 8]
      );
      if (hitT >= 0 && hitT < bestT) { bestT = hitT; bestTri = t; }
    }

    let ix = Math.floor(ox / cs);
    let iz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(cs / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(cs / dz) : Infinity;
    let tMaxX = stepX !== 0 ? (((stepX > 0 ? ix + 1 : ix) * cs) - ox) / dx : Infinity;
    let tMaxZ = stepZ !== 0 ? (((stepZ > 0 ? iz + 1 : iz) * cs) - oz) / dz : Infinity;

    let travelled = 0;
    let guard = 4096;
    for (;;) {
      test(ix, iz);
      if (bestT <= travelled) break;
      if (travelled > maxDist || guard-- <= 0) break;
      if (tMaxX < tMaxZ) { travelled = tMaxX; ix += stepX; tMaxX += tDeltaX; }
      else { travelled = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
      if (!isFinite(travelled)) break;
    }

    if (bestTri >= 0 && bestT <= maxDist) {
      out.hit = true;
      out.t = bestT;
      out.x = ox + dx * bestT;
      out.y = oy + dy * bestT;
      out.z = oz + dz * bestT;
      let nx = this._nrm[bestTri * 3], ny = this._nrm[bestTri * 3 + 1], nz = this._nrm[bestTri * 3 + 2];
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // face the ray
      out.nx = nx; out.ny = ny; out.nz = nz;
      out.tri = bestTri;
    }
    return out;
  }

  /** Height of the world under (x, z), searching downward from `fromY`. */
  groundAt(x, z, fromY = 500, maxDist = 1200) {
    const r = this.raycast(x, fromY, z, 0, -1, 0, maxDist, _rayOut2);
    return r.hit
      ? { hit: true, y: r.y, normal: { x: r.nx, y: r.ny, z: r.nz }, distance: r.t }
      : { hit: false, y: -Infinity, normal: { x: 0, y: 1, z: 0 }, distance: Infinity };
  }

  /**
   * Swept sphere along a direction. This is the query a third-person camera boom needs, and
   * answering it here is far cheaper and far more accurate than a rig raycasting every mesh in
   * the scene. Coarse sampling then a binary refine: the answer is within ~radius/64.
   */
  sphereCast(origin, dir, radius, maxDist) {
    this.ensureBuilt();
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;
    const steps = Math.min(64, Math.max(2, Math.ceil(maxDist / (radius * 0.5))));
    let lastFree = 0;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      if (this._sphereOverlaps(origin.x + dx * t, origin.y + dy * t, origin.z + dz * t, radius)) {
        let lo = lastFree, hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          if (this._sphereOverlaps(origin.x + dx * mid, origin.y + dy * mid, origin.z + dz * mid, radius)) hi = mid;
          else lo = mid;
        }
        return { hit: true, distance: lo, normal: { x: 0, y: 1, z: 0 } };
      }
      lastFree = t;
    }
    return { hit: false, distance: maxDist, normal: { x: 0, y: 1, z: 0 } };
  }

  _sphereOverlaps(x, y, z, radius) {
    const n = this._gather(x - radius, z - radius, x + radius, z + radius, y - radius, y + radius);
    const r2 = radius * radius;
    const tri = this._tri, cand = this._cand;
    for (let i = 0; i < n; i++) {
      const o = cand[i] * 9;
      closestPtTri(
        x, y, z,
        tri[o], tri[o + 1], tri[o + 2],
        tri[o + 3], tri[o + 4], tri[o + 5],
        tri[o + 6], tri[o + 7], tri[o + 8],
        _tA
      );
      const ddx = x - _tA[0], ddy = y - _tA[1], ddz = z - _tA[2];
      if (ddx * ddx + ddy * ddy + ddz * ddz < r2) return true;
    }
    return false;
  }

  /**
   * Sweep a capsule from `from` to `to`. Conservative sampling at half-radius increments —
   * exact enough for traversal probes (ledge grabs, dash targets) and honest about being a
   * sampled sweep rather than an analytic one.
   */
  capsuleCast(from, to, radius, halfSeg) {
    this.ensureBuilt();
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.min(64, Math.max(1, Math.ceil(len / (radius * 0.5))));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      _v3b.set(from.x + dx * t, from.y + dy * t, from.z + dz * t);
      const probe = _v3.copy(_v3b);
      const r = this.depenetrate(probe, radius, halfSeg, _depenCast);
      if (r.pushes > 0) {
        return {
          hit: true,
          t,
          position: { x: _v3b.x, y: _v3b.y, z: _v3b.z },
          normal: { x: r.gnx, y: r.gny, z: r.gnz },
          distance: len * t,
        };
      }
    }
    return { hit: false, t: 1, position: { x: to.x, y: to.y, z: to.z }, normal: { x: 0, y: 1, z: 0 }, distance: len };
  }

  // ------------------------------------------------------------------ lifecycle

  fixed() {
    if (this._dirty) this._rebuild();
  }

  /** Build the stand-in proving ground unless a real world already registered colliders. */
  ensureFallbackGround() {
    if (this._fallback || this.colliders.size > 0) return null;
    const built = buildProvingGround();
    this.root.add(built.mesh);
    this._fallback = { id: "p04:proving-ground", mesh: built.mesh, spawn: built.spawn };
    this.registerCollider({ id: "p04:proving-ground", geometry: built.mesh.geometry });
    return this._fallback;
  }

  get fallbackSpawn() {
    return this._fallback?.spawn ?? null;
  }

  _clearFallback() {
    if (!this._fallback) return;
    this.colliders.delete(this._fallback.id);
    this.root.remove(this._fallback.mesh);
    this._fallback.mesh.geometry.dispose();
    this._fallback.mesh.material.dispose();
    this._fallback = null;
    this._dirty = true;
  }

  dispose() {
    this._offCollider?.();
    this._clearFallback();
  }
}

const _rayOut = {};
const _rayOut2 = {};
const _depenOut = {};
const _depenStep = {};
const _depenCast = {};
const _stepSave = new THREE.Vector3();

// ---------------------------------------------------------------------------- proving ground

export const PROVING_GROUND = {
  deckY: 0.12,
  deckRadius: 54,
  spawn: { x: 4, y: 0.12, z: 14 },
  rampAnglesDeg: [10, 20, 30, 40, 52],
  rampRise: 3,
  // Two banks that bracket the step-up limit from both sides. The coarse bank spans the whole
  // question; the fine bank sits on the far side of the deck and pins the crossover to ±0.05 m,
  // because "how tall a ledge can I walk up" is a number P06's mantle and P09's level geometry
  // are both designed against and it has to be measured, not asserted.
  stairRisers: [0.25, 0.5, 0.7, 0.9],
  stairRisersFine: [0.45, 0.55, 0.6, 0.65],
  terraceHeight: 3,
  blockHeight: 5,
  cone: [-14, -26],       // 45° apron, 54° crown — brackets the 47° slope limit in open ground
};

/**
 * A deliberately *measurable* landscape: a flat disc long enough to time an acceleration curve
 * and a stop, a bank of ramps that brackets the slope limit from both sides, four stair flights
 * that bracket the step height, an inside corner to prove depenetration converges, and drops of
 * three and five metres for landings. It is a stand-in — the moment a real world registers a
 * collider it deletes itself — but it is the reason the numbers in this piece's handoff exist.
 */
function buildProvingGround() {
  const pos = [];
  const col = [];
  const DECK = PROVING_GROUND.deckY;
  const R = PROVING_GROUND.deckRadius;

  // Two nearly-identical rock tones, alternated by ring only. A per-wedge alternation turns the
  // disc into a radial pinwheel that reads as a rendering artefact in every capture.
  const C_DECK_A = [0.356, 0.228, 0.152];
  const C_DECK_B = [0.334, 0.214, 0.146];
  const C_RAMP = [0.455, 0.290, 0.180];
  const C_STAIR = [0.400, 0.262, 0.176];
  const C_TERRACE = [0.180, 0.372, 0.408];
  const C_SIDE = [0.145, 0.180, 0.216];
  const C_SKIRT = [0.230, 0.150, 0.104];

  const tri = (a, b, c, cc) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) col.push(cc[0], cc[1], cc[2]);
  };
  const quad = (a, b, c, d, cc) => { tri(a, b, c, cc); tri(a, c, d, cc); };
  // Box bottoms sit below the deck plane on purpose: a face exactly coplanar with the deck
  // z-fights, and a z-fighting stand-in reads as a rendering bug in every review capture.
  const SUNK = 0.5;
  const box = (x0, y0, z0, x1, y1, z1, cTop, cSide) => {
    const yb = y0 - SUNK;
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], cTop);
    quad([x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1], cSide);
    quad([x0, yb, z0], [x0, y1, z0], [x1, y1, z0], [x1, yb, z0], cSide);
    quad([x1, yb, z1], [x1, y1, z1], [x0, y1, z1], [x0, yb, z1], cSide);
    quad([x0, yb, z1], [x0, y1, z1], [x0, y1, z0], [x0, yb, z0], cSide);
    quad([x1, yb, z0], [x1, y1, z0], [x1, y1, z1], [x1, yb, z1], cSide);
  };

  // --- deck: concentric rings so the broadphase gets small, well-shaped triangles
  const rings = [0, 8, 18, 28, 38, 46, R];
  const SEG = 48;
  for (let r = 0; r < rings.length - 1; r++) {
    const r0 = rings[r], r1 = rings[r + 1];
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2;
      const a1 = ((s + 1) / SEG) * Math.PI * 2;
      const cc = r % 2 === 0 ? C_DECK_A : C_DECK_B;
      const p00 = [Math.cos(a0) * r0, DECK, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, DECK, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, DECK, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, DECK, Math.sin(a1) * r1];
      if (r0 === 0) tri(p00, p11, p10, cc);
      else quad(p00, p01, p11, p10, cc);
    }
  }
  // --- skirt so the rim reads as a lip rather than a paper edge
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * Math.PI * 2;
    const a1 = ((s + 1) / SEG) * Math.PI * 2;
    const o0 = [Math.cos(a0) * R, DECK, Math.sin(a0) * R];
    const o1 = [Math.cos(a1) * R, DECK, Math.sin(a1) * R];
    const i0 = [Math.cos(a0) * (R - 3), -1.9, Math.sin(a0) * (R - 3)];
    const i1 = [Math.cos(a1) * (R - 3), -1.9, Math.sin(a1) * (R - 3)];
    quad(o0, i0, i1, o1, C_SKIRT);
  }

  // --- ramp bank: 10° / 20° / 30° / 40° / 52°, all rising 3 m to a shared terrace
  const rise = PROVING_GROUND.rampRise;
  const topZ = 30;
  const slotW = 6, gap = 1.4;
  const spanX = PROVING_GROUND.rampAnglesDeg.length * slotW + (PROVING_GROUND.rampAnglesDeg.length - 1) * gap;
  let x = -spanX / 2;
  for (const deg of PROVING_GROUND.rampAnglesDeg) {
    const run = rise / Math.tan((deg * Math.PI) / 180);
    const z0 = topZ - run, z1 = topZ;
    const y0 = DECK, y1 = DECK + rise;
    const x0 = x, x1 = x + slotW;
    // Running surface only — the solver is two-sided, so a wedge needs no underside, and an
    // underside coplanar with the deck would z-fight. The terrace closes the high end.
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z1], [x1, y1, z1], C_RAMP);
    tri([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], C_SIDE);
    tri([x1, y0, z1], [x1, y0, z0], [x1, y1, z1], C_SIDE);
    x += slotW + gap;
  }
  // terrace the ramps deliver you onto, with a 3 m drop off its far edge
  box(-20, DECK, topZ, 20, DECK + PROVING_GROUND.terraceHeight, 46, C_TERRACE, C_SIDE);

  // --- stair flights bracketing the step height, coarse bank west and fine bank east
  const tread = 0.9;
  const flightZ = [[-14, -9], [-7, -2], [2, 7], [9, 14]];
  const flight = (xStart, dir, z0, z1, h) => {
    for (let i = 0; i < 4; i++) {
      const a = xStart + dir * (i + 1) * tread, b = xStart + dir * i * tread;
      box(Math.min(a, b), DECK, z0, Math.max(a, b), DECK + (i + 1) * h, z1, C_STAIR, C_SIDE);
    }
    const a = xStart + dir * (4 * tread + 4), b = xStart + dir * 4 * tread;
    box(Math.min(a, b), DECK, z0, Math.max(a, b), DECK + 4 * h, z1, C_STAIR, C_SIDE);
  };
  PROVING_GROUND.stairRisers.forEach((h, f) => flight(-22, -1, flightZ[f][0], flightZ[f][1], h));
  PROVING_GROUND.stairRisersFine.forEach((h, f) => flight(22, 1, flightZ[f][0], flightZ[f][1], h));

  // --- inside corner: two walls meeting at 90°, the classic depenetration trap
  box(-40, DECK, 24, -31, DECK + 3, 25.2, C_TERRACE, C_SIDE);
  box(-40, DECK, 24, -38.8, DECK + 3, 33, C_TERRACE, C_SIDE);

  // --- a 5 m block to fall off, for hard-landing impact values
  box(26, DECK, 24, 36, DECK + PROVING_GROUND.blockHeight, 34, C_TERRACE, C_SIDE);

  // --- a two-stage cone: a 45° apron you can run up, capped by a 54.5° crown you cannot.
  // The slope limit becomes something you can see from across the deck and feel under your feet,
  // and it stands in open ground so a camera behind you has a clear line on the slide.
  {
    const [cx, cz] = PROVING_GROUND.cone;
    const SEGS = 32;
    const stages = [
      { r0: 9, y0: DECK, r1: 5, y1: DECK + 4, c: C_RAMP },        // atan(4/4) = 45°
      { r0: 5, y0: DECK + 4, r1: 0.2, y1: DECK + 10.6, c: C_TERRACE }, // atan(6.6/4.8) = 54°
    ];
    for (const st of stages) {
      for (let s = 0; s < SEGS; s++) {
        const a0 = (s / SEGS) * Math.PI * 2;
        const a1 = ((s + 1) / SEGS) * Math.PI * 2;
        const p00 = [cx + Math.cos(a0) * st.r0, st.y0, cz + Math.sin(a0) * st.r0];
        const p01 = [cx + Math.cos(a1) * st.r0, st.y0, cz + Math.sin(a1) * st.r0];
        const p10 = [cx + Math.cos(a0) * st.r1, st.y1, cz + Math.sin(a0) * st.r1];
        const p11 = [cx + Math.cos(a1) * st.r1, st.y1, cz + Math.sin(a1) * st.r1];
        quad(p00, p01, p11, p10, st.c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
      // Two-sided to match the solver: a stand-in must never show a hole because one wedge
      // face was wound the wrong way.
      side: THREE.DoubleSide,
    })
  );
  mesh.name = "proving-ground";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return { mesh, spawn: { ...PROVING_GROUND.spawn } };
}
