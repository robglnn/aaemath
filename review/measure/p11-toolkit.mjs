/**
 * P11 measurement toolkit — installed into the page by `review/measure/P11.mjs`.
 *
 * **Everything here reads the shipped world.** The previous revision of this toolkit was written
 * against `Materials.buildBoard()` — a private shelf with one of every substance on it, spawned by
 * the measurement itself. It had a `heightFn` in `userData`, exact world marks for a courier's boot
 * sole, and an occlusion test that walked thirteen hundred triangles because that was the whole
 * scene. Every number it produced was true of a scene no player could reach, and the one time
 * somebody measured the real frame instead, rock in shadow came back 160° of hue away from the
 * target. The board is deleted. There is nothing left to point at except Leaf Nine.
 *
 * That makes three problems real that the board did not have, and the three ideas below are the
 * answers:
 *
 *  1. **Which mesh painted this pixel?** There is no depth buffer to ask and 170 000 triangles is
 *     too many to raycast per sample. So: render the frame, hide one mesh, render again, and every
 *     pixel that changed is a pixel that mesh owned. Two extra renders, exact, and it costs nothing
 *     in reasoning — `own()`.
 *
 *  2. **Which facet is this, and where is the key relative to it?** `worldFaces()` walks a mesh's
 *     own triangles, in world space, through `instanceMatrix` when it is an `InstancedMesh` — which
 *     the entire scatter is. It reports the projected pixel area of each face so a caller can
 *     refuse to sample a facet smaller than the box it wants to take a median over.
 *
 *  3. **Did the sample land on one facet?** A facet is one colour (§3.3), so a sample box whose
 *     luminance spread is large straddled two of them, or two instances, or an edge. `patch()`
 *     returns the spread with the colour and every claim below throws the ragged ones away and
 *     reports how many it threw.
 *
 * Everything per-pixel happens in the page: a 1280x720 RGBA buffer is 3.7 M numbers and shipping it
 * across the bridge for every row would dominate the run.
 */
export function installToolkit() {
  const K = window.__vs.kernel;
  const T = {};
  window.__p11 = T;

  T.lighting = K.byName.get("lighting");
  T.scene = K.scene;
  T.camera = K.camera;
  T.sys = (n) => K.byName.get(n);

  // Three's classes, reached through objects we already own rather than by importing a second copy
  // of three into the page (which would be a different module instance and a different registry).
  const V3 = T.lighting.root.position.constructor;
  const M4 = T.lighting.root.matrixWorld.constructor;
  T.V3 = V3;

  const s2l = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    s2l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  T.s2l = s2l;
  T.lum = (r, g, b) => 0.2126 * s2l[r] + 0.7152 * s2l[g] + 0.0722 * s2l[b];
  T.hsv = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d + 6) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, mx === 0 ? 0 : d / mx, mx / 255];
  };
  const med = (a) => (a.length ? a.slice().sort((u, v) => u - v)[a.length >> 1] : null);
  T.med = med;

  // --- drawing-buffer readback. Done in the same task as the render, so `preserveDrawingBuffer`
  //     can stay false: the buffer is still intact until the browser composites.
  const scratch = document.createElement("canvas");
  T.renders = 0;
  T.grab = () => {
    K.advance(0); // render once, right here — no simulation step, so this is idempotent
    T.renders++;
    const gl = K.renderer.domElement;
    scratch.width = gl.width;
    scratch.height = gl.height;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(gl, 0, 0);
    const img = ctx.getImageData(0, 0, gl.width, gl.height);
    T.buf = { w: img.width, h: img.height, d: img.data };
    return { w: img.width, h: img.height };
  };
  T.stash = () => {
    T.prev = new Uint8ClampedArray(T.buf.d);
    return T.buf.d.length;
  };

  T.px = (x, y) => {
    const { w, h, d } = T.buf;
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    const i = (yi * w + xi) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };

  /** Median of a box — one bad pixel on a facet edge must not decide a row. */
  T.box = (x, y, r = 2) => T.patch(x, y, r).rgb;

  /**
   * Median colour of a box **plus how uniform it was**.
   *
   * §3.3: a facet is exactly one colour. So the luminance spread inside a small box is a direct
   * test of whether the sample landed on one facet or straddled two — which, in a frame with a
   * hundred thousand instanced rocks in it, is the difference between measuring rock and measuring
   * an edge between rock and sky.
   */
  T.patch = (x, y, r = 2) => {
    const rs = [], gs = [], bs = [], ys = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const p = T.px(x + dx, y + dy);
        rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
        ys.push(T.lum(p[0], p[1], p[2]));
      }
    const rgb = [med(rs), med(gs), med(bs)];
    return { rgb, y: T.lum(...rgb), spread: Math.max(...ys) - Math.min(...ys) };
  };

  T.project = (p) => {
    const w = new V3(p[0], p[1], p[2]).project(K.camera);
    const el = K.renderer.domElement;
    return [((w.x + 1) / 2) * el.width, ((1 - w.y) / 2) * el.height, w.z];
  };

  T.meshByName = (name) => {
    let hit = null;
    T.scene.traverse((o) => {
      if (!hit && o.isMesh && o.name === name) hit = o;
    });
    return hit;
  };

  /** Every mesh under the named systems' roots, with its archetype. The world, as it ships. */
  T.worldMeshes = (systems = ["terrain", "level01", "scatter", "avatar"]) => {
    const out = [];
    for (const name of systems) {
      const root = T.sys(name)?.root;
      if (!root) continue;
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        out.push({
          system: name,
          name: o.name || o.type,
          instanced: !!o.isInstancedMesh,
          count: o.isInstancedMesh ? o.count : 1,
          visible: o.visible && o.parent?.visible !== false,
          archetype: o.material.userData?.vsArchetype ?? null,
          material: o.material.name || o.material.type,
          type: o.material.type,
          castShadow: !!o.castShadow,
          receiveShadow: !!o.receiveShadow,
        });
      });
    }
    return out;
  };

  /**
   * **Which pixels did these meshes paint?**
   *
   * Render, hide them, render again, diff. A pixel that changed is a pixel where one of these meshes
   * was the front-most visible surface; a pixel that did not is either behind something or was never
   * theirs. Exact, and it needs no depth buffer, no raycast and no guess about what is in front of
   * what. Restores the frame into `T.buf` before returning, so a caller can sample immediately.
   *
   * Hidden by **layer mask, not by `visible`**, and that is not a style choice: `Scatter.after()`
   * writes `mesh.visible = drawn > 0` on every streamed LOD, so a mesh hidden the obvious way is
   * back on screen by the time the second render happens and the diff comes out empty. Nothing in
   * this project uses layers, so a zero mask is a hiding place nobody else will reach into.
   */
  T.own = (names) => {
    const meshes = (Array.isArray(names) ? names : [names]).map((n) => T.meshByName(n)).filter(Boolean);
    if (!meshes.length) return { mask: null, n: 0, meshes: 0 };
    T.grab();
    const full = new Uint8ClampedArray(T.buf.d);
    const was = meshes.map((m) => m.layers.mask);
    meshes.forEach((m) => (m.layers.mask = 0));
    T.grab();
    const without = T.buf.d;
    const mask = new Uint8Array(full.length / 4);
    let n = 0;
    for (let i = 0, p = 0; i < full.length; i += 4, p++) {
      if (full[i] !== without[i] || full[i + 1] !== without[i + 1] || full[i + 2] !== without[i + 2]) {
        mask[p] = 1;
        n++;
      }
    }
    meshes.forEach((m, i) => (m.layers.mask = was[i]));
    T.grab(); // put the real frame back so the caller samples the composed image
    return { mask, n, share: n / mask.length, meshes: meshes.length };
  };

  T.maskAt = (mask, x, y) => {
    if (!mask) return true;
    const xi = Math.max(0, Math.min(T.buf.w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(T.buf.h - 1, Math.round(y)));
    return mask[yi * T.buf.w + xi] === 1;
  };

  /** Is every pixel of the r-box owned by the mask? Refuses samples that straddle a silhouette. */
  T.maskBox = (mask, x, y, r) => {
    if (!mask) return true;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (!T.maskAt(mask, x + dx, y + dy)) return false;
    return true;
  };

  /**
   * Front-facing world triangles of a mesh — **including every instance of an `InstancedMesh`**,
   * which is what the whole scatter is and what the previous toolkit could not see at all.
   *
   * Each face carries its world normal's N·L against the key, its screen centroid, and its projected
   * area in PIXELS rather than in square metres. Pixels are the unit that matters: a facet six
   * metres across at four hundred metres is three pixels wide and a 5x5 median over it is a median
   * over its neighbours.
   */
  T.worldFaces = (meshName, opts = {}) => {
    const { maxInstances = 40, minAreaPx = 150, maxFaces = 6000 } = opts;
    const m = T.meshByName(meshName);
    if (!m) return [];
    m.updateMatrixWorld(true);
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const key = T.lighting._keyDir;
    const cam = K.camera.position;

    // Which instances to walk: nearest first, and never more than `maxInstances`, because a
    // hundred thousand rocks times twenty faces is a measurement that never returns.
    const transforms = [];
    if (m.isInstancedMesh) {
      const mat = new M4();
      const origin = new V3();
      const list = [];
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        origin.setFromMatrixPosition(mat).applyMatrix4(m.matrixWorld);
        list.push({ i, d: origin.distanceTo(cam) });
      }
      list.sort((a, b) => a.d - b.d);
      for (const hit of list.slice(0, maxInstances)) {
        const t = new M4();
        m.getMatrixAt(hit.i, t);
        transforms.push({ id: hit.i, m: t.premultiply(m.matrixWorld) });
      }
    } else {
      transforms.push({ id: 0, m: m.matrixWorld.clone() });
    }

    const out = [];
    const a = new V3(), b = new V3(), c = new V3();
    for (const t of transforms) {
      for (let f = 0; f < triCount && out.length < maxFaces; f++) {
        const i0 = idx ? idx.getX(f * 3) : f * 3;
        const i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1;
        const i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(t.m);
        b.fromBufferAttribute(pos, i1).applyMatrix4(t.m);
        c.fromBufferAttribute(pos, i2).applyMatrix4(t.m);
        const ab = b.clone().sub(a);
        const ac = c.clone().sub(a);
        const nrm = ab.clone().cross(ac).normalize();
        const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const toCam = cam.clone().sub(centroid).normalize();
        if (nrm.dot(toCam) <= 0.2) continue; // back-facing or edge-on: its pixels are unreliable
        const s0 = T.project([a.x, a.y, a.z]);
        const s1 = T.project([b.x, b.y, b.z]);
        const s2 = T.project([c.x, c.y, c.z]);
        if (s0[2] > 1 || s1[2] > 1 || s2[2] > 1) continue; // behind the camera
        const areaPx = Math.abs((s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1])) / 2;
        if (areaPx < minAreaPx) continue;
        const cx = (s0[0] + s1[0] + s2[0]) / 3;
        const cy = (s0[1] + s1[1] + s2[1]) / 3;
        if (cx < 6 || cy < 6 || cx > T.buf.w - 7 || cy > T.buf.h - 7) continue;
        out.push({
          mesh: meshName,
          instance: t.id,
          ndl: nrm.dot(key),
          ny: nrm.y,
          x: cx,
          y: cy,
          areaPx,
          dist: centroid.distanceTo(cam),
          world: [centroid.x, centroid.y, centroid.z],
        });
      }
    }
    return out;
  };

  /**
   * Sample a population of faces, keeping only the ones that (a) the mesh demonstrably owns on
   * screen and (b) came back as one flat colour. Returns medians and, just as importantly, the
   * rejection counts — a row measured on four surviving samples is not a measurement.
   */
  T.sampleFaces = (faces, { mask = null, r = 2, maxSpread = 0.02, limit = 400 } = {}) => {
    const hs = [], ss = [], vs = [], ys = [], px = [];
    let rejectedMask = 0, rejectedSpread = 0;
    for (const f of faces) {
      if (px.length >= limit) break;
      if (mask && !T.maskBox(mask, f.x, f.y, r)) { rejectedMask++; continue; }
      const p = T.patch(f.x, f.y, r);
      if (p.spread > maxSpread) { rejectedSpread++; continue; }
      const [h, s, v] = T.hsv(...p.rgb);
      hs.push(h); ss.push(s); vs.push(v); ys.push(p.y);
      px.push({ rgb: p.rgb, ndl: f.ndl, areaPx: f.areaPx, dist: f.dist, x: f.x, y: f.y });
    }
    return {
      n: px.length,
      rejectedMask,
      rejectedSpread,
      hue: med(hs), s: med(ss), v: med(vs), y: med(ys),
      hueSpread: hs.length ? Math.max(...hs) - Math.min(...hs) : 0,
      samples: px.slice(0, 12),
    };
  };

  /** §13 row 1: compact flat regions at tol 2/255. Seed-based flood fill, 4-connected. */
  T.regions = (tol, minFrac) => {
    const { w, h, d } = T.buf;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const s = sy * w + sx;
        if (seen[s]) continue;
        const si = s * 4;
        const r0 = d[si], g0 = d[si + 1], b0 = d[si + 2];
        let sp = 0;
        stack[sp++] = s;
        seen[s] = 1;
        let count = 0, minX = sx, maxX = sx, minY = sy, maxY = sy;
        let ymin = 2, ymax = -1;
        while (sp > 0) {
          const p = stack[--sp];
          const px = p % w, py = (p / w) | 0;
          count++;
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
          const L = T.lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
          if (L < ymin) ymin = L; if (L > ymax) ymax = L;
          const nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
          for (const q of nb) {
            if (q < 0 || seen[q]) continue;
            const qi = q * 4;
            if (Math.abs(d[qi] - r0) <= tol && Math.abs(d[qi + 1] - g0) <= tol && Math.abs(d[qi + 2] - b0) <= tol) {
              seen[q] = 1;
              stack[sp++] = q;
            }
          }
        }
        const frac = count / (w * h);
        if (frac < minFrac) continue;
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const fill = count / (bw * bh);
        const aspect = Math.max(bw / bh, bh / bw);
        if (fill < 0.25 || aspect > 6) continue;
        out.push({ frac, spread: ymax - ymin, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
      }
    }
    out.sort((a, b) => b.frac - a.frac);
    return out;
  };

  /** Frame share and median hue/S/Y of everything passing a gate, optionally inside a mask. */
  T.gate = (hueLo, hueHi, vLo, sLo, yLo, yHi, mask = null) => {
    const { w, h, d } = T.buf;
    let n = 0, considered = 0;
    const hues = [], sats = [], ys = [], vs = [], xs = [], yps = [];
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (mask && !mask[p]) continue;
      considered++;
      const [hu, sa, va] = T.hsv(d[i], d[i + 1], d[i + 2]);
      if (hu < hueLo || hu > hueHi) continue;
      if (va < vLo || sa < sLo) continue;
      const Y = T.lum(d[i], d[i + 1], d[i + 2]);
      if (Y < yLo || Y > yHi) continue;
      n++;
      hues.push(hu); sats.push(sa); ys.push(Y); vs.push(va);
      xs.push(p % w); yps.push((p / w) | 0);
    }
    return {
      n,
      considered,
      share: n / (w * h),
      shareOfMask: considered ? n / considered : 0,
      hue: med(hues), s: med(sats), v: med(vs), y: med(ys),
      xs, yps,
    };
  };

  /** Frame luminance percentiles, for the exposure budget. */
  T.percentiles = () => {
    const { d } = T.buf;
    const a = new Float32Array(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) a[j] = T.lum(d[i], d[i + 1], d[i + 2]);
    a.sort();
    const at = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    let hi = 0, lo = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] >= 0.9) hi++;
      if (a[i] <= 0.004) lo++;
    }
    return { p05: at(0.05), p50: at(0.5), p95: at(0.95), hi: hi / a.length, lo: lo / a.length };
  };

  /** Pixels that moved since `stash()`, optionally restricted to a screen-space box. */
  T.moved = (delta, box) => {
    const { w, h, d } = T.buf;
    const prev = T.prev;
    let n = 0, total = 0;
    const x0 = box ? box[0] : 0, y0 = box ? box[1] : 0;
    const x1 = box ? box[2] : w - 1, y1 = box ? box[3] : h - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        total++;
        const a = T.lum(d[i], d[i + 1], d[i + 2]);
        const b = T.lum(prev[i], prev[i + 1], prev[i + 2]);
        if (Math.abs(a - b) > delta) n++;
      }
    }
    return { moved: n, total, share: total ? n / total : 0 };
  };

  /** Screen-space bounding box of every mesh whose material is an accent (crystal, carry, veins). */
  T.accentBoxes = () => {
    const boxes = [];
    T.scene.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.material?.userData?.vsAccent) return;
      o.updateMatrixWorld(true);
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 400));
      const push = (mat) => {
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, any = false;
        const v = new V3();
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mat);
          const s = T.project([v.x, v.y, v.z]);
          if (s[2] > 1) continue;
          any = true;
          minX = Math.min(minX, s[0]); maxX = Math.max(maxX, s[0]);
          minY = Math.min(minY, s[1]); maxY = Math.max(maxY, s[1]);
        }
        if (any && maxX > minX) boxes.push([minX - 4, minY - 4, maxX + 4, maxY + 4]);
      };
      if (o.isInstancedMesh) {
        const t = new M4();
        const lim = Math.min(o.count, 600);
        for (let i = 0; i < lim; i++) {
          o.getMatrixAt(i, t);
          push(t.clone().premultiply(o.matrixWorld));
        }
      } else {
        push(o.matrixWorld);
      }
    });
    return boxes;
  };

  /**
   * §5's global ban list, over the **whole shipped scene** rather than over a board we built. Also
   * reports which archetype painted each mesh, and — the row that matters — which lit world meshes
   * carry no factory archetype at all.
   */
  T.banned = (systems) => {
    const audit = T.lighting.audit ? T.lighting.audit() : null;
    const meshes = T.worldMeshes(systems);
    const bad = { standard: 0, physical: 0, envMap: 0, normalMap: 0, roughnessMap: 0, anyMap: 0, meshes: 0 };
    const byArchetype = {};
    const unowned = [];
    const seen = new Set();
    for (const name of ["terrain", "level01", "scatter", "avatar"]) {
      const root = T.sys(name)?.root;
      if (!root) continue;
      root.traverse((o) => {
        if (!o.isMesh || !o.material || seen.has(o.uuid)) return;
        seen.add(o.uuid);
        bad.meshes++;
        const m = o.material;
        if (m.isMeshStandardMaterial) bad.standard++;
        if (m.isMeshPhysicalMaterial) bad.physical++;
        if (m.envMap) bad.envMap++;
        if (m.normalMap) bad.normalMap++;
        if (m.roughnessMap) bad.roughnessMap++;
        for (const k of ["map", "bumpMap", "displacementMap", "aoMap", "metalnessMap", "alphaMap", "emissiveMap", "lightMap", "specularMap"])
          if (m[k]) bad.anyMap++;
        const a = m.userData?.vsArchetype;
        if (a) byArchetype[a] = (byArchetype[a] ?? 0) + 1;
        else unowned.push(`${o.name || o.type}:${m.type}`);
      });
    }
    return {
      ...bad,
      byArchetype,
      unowned: unowned.slice(0, 20),
      unownedCount: unowned.length,
      sceneEnvironment: T.scene.environment ? 1 : 0,
      wholeScene: audit,
      worldMeshes: meshes.filter((m) => m.visible).length,
    };
  };

  /** The rig, in the linear numbers the shader actually works in. */
  T.rig = () => {
    const L = T.lighting;
    return {
      key: [L.key.color.r, L.key.color.g, L.key.color.b],
      keyI: L.key.intensity,
      keyDir: [L._keyDir.x, L._keyDir.y, L._keyDir.z],
      shadowDir: [L._shadowDir.x, L._shadowDir.y, L._shadowDir.z],
      fillSky: [L.fill.color.r, L.fill.color.g, L.fill.color.b],
      fillGround: [L.fill.groundColor.r, L.fill.groundColor.g, L.fill.groundColor.b],
      fillI: L.fill.intensity,
      bounce: [L.bounce.color.r, L.bounce.color.g, L.bounce.color.b],
      bounceI: L.bounce.intensity,
      bounceDir: (() => {
        const p = L.bounce.position.clone().normalize();
        return [p.x, p.y, p.z];
      })(),
      rimDir: [L._rimDir.x, L._rimDir.y, L._rimDir.z],
      rimGain: L.sun().rim.gain,
      shadowTint: [L._shadowTint.r, L._shadowTint.g, L._shadowTint.b],
    };
  };

  T.albedoOf = (meshName) => {
    const m = T.meshByName(meshName);
    if (!m) return null;
    return [m.material.color.r, m.material.color.g, m.material.color.b];
  };

  // --- the shipped ground, queried through the system that owns it -------------------------
  T.groundY = (x, z) => T.sys("terrain")?.groundAt(x, z);
  T.groundNormal = (x, z) => {
    const n = T.sys("terrain")?.normalAt(x, z);
    return n ? [n.x, n.y, n.z] : null;
  };
  T.groundNdL = (x, z) => {
    const n = T.groundNormal(x, z);
    if (!n) return null;
    const k = T.lighting._keyDir;
    return n[0] * k.x + n[1] * k.y + n[2] * k.z;
  };

  /** Where the player actually is, read from the shipped avatar rather than assumed. */
  T.player = () => {
    const a = window.__vs.probe("avatar");
    if (a?.position) return { x: a.position.x, y: a.position.y, z: a.position.z, height: a.height, castShadow: a.castShadow };
    const l = window.__vs.probe("locomotion");
    const p = l?.position;
    return p ? { x: p.x ?? p[0], y: p.y ?? p[1], z: p.z ?? p[2], height: 1.8, castShadow: null } : null;
  };

  return true;
}
