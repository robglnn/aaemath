/**
 * P11 measurement toolkit — installed into the page by `review/measure/P11.mjs`.
 *
 * It lives in its own module so the same code can be loaded by an ad-hoc debug script without
 * running the whole proof, and so `page.evaluate` gets one self-contained function with no closure
 * over anything in Node. Everything per-pixel happens here: a 1280x720 RGBA buffer is 3.7 M numbers
 * and shipping it across the bridge for every row would dominate the run.
 */
export function installToolkit() {
  const K = window.__vs.kernel;
  const T = {};
  window.__p11 = T;

  T.lighting = K.byName.get("lighting");
  T.scene = K.scene;
  T.camera = K.camera;

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

  // --- drawing-buffer readback. Done in the same task as the render, so `preserveDrawingBuffer`
  //     can stay false: the buffer is still intact until the browser composites.
  const scratch = document.createElement("canvas");
  T.grab = () => {
    K.advance(0); // render once, right here
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
  T.box = (x, y, r = 2) => {
    const rs = [], gs = [], bs = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const p = T.px(x + dx, y + dy);
        rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
      }
    const med = (a) => a.sort((u, v) => u - v)[a.length >> 1];
    return [med(rs), med(gs), med(bs)];
  };

  T.project = (p) => {
    const v = new (T.scene.constructor === Object ? Object : Object)();
    const V = K.camera;
    const vec = { x: p[0], y: p[1], z: p[2] };
    // Use three through an object we already own rather than importing it.
    const three = T.lighting.root.position.constructor; // THREE.Vector3
    const w = new three(vec.x, vec.y, vec.z).project(V);
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

  /**
   * Every front-facing triangle of a mesh, with its world normal, its N.L against the key, and where
   * its centroid lands on screen. This is what makes the "the steps sit on a cosine" claim testable
   * rather than assertable.
   */
  T.faces = (meshName) => {
    const m = T.meshByName(meshName);
    if (!m) return [];
    const three = T.lighting.root.position.constructor;
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = (idx ? idx.count : pos.count) / 3;
    const key = T.lighting._keyDir;
    const camPos = K.camera.position;
    const out = [];
    m.updateMatrixWorld(true);
    const a = new three(), b = new three(), c = new three();
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      const ab = b.clone().sub(a);
      const ac = c.clone().sub(a);
      const nrm = ab.cross(ac).normalize();
      const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const toCam = camPos.clone().sub(centroid).normalize();
      if (nrm.dot(toCam) <= 0.15) continue; // back-facing or edge-on: its pixels are unreliable
      const scr = T.project([centroid.x, centroid.y, centroid.z]);
      if (scr[0] < 4 || scr[1] < 4 || scr[0] > T.buf.w - 5 || scr[1] > T.buf.h - 5) continue;
      const area = ab.length() * ac.length() * 0.5;
      out.push({
        ndl: nrm.dot(key),
        ny: nrm.y,
        x: scr[0],
        y: scr[1],
        area,
        world: [centroid.x, centroid.y, centroid.z],
      });
    }
    return out;
  };

  /** The rig, in the linear numbers the shader actually works in. */
  T.rig = () => {
    const L = T.lighting;
    return {
      key: [L.key.color.r, L.key.color.g, L.key.color.b],
      keyI: L.key.intensity,
      keyDir: [L._keyDir.x, L._keyDir.y, L._keyDir.z],
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

  /** §13 row 1: compact flat regions at tol 2/255. Seed-based flood fill, 4-connected. */
  T.regions = (tol, minFrac) => {
    const { w, h, d } = T.buf;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    const step = 1;
    for (let sy = 0; sy < h; sy += step) {
      for (let sx = 0; sx < w; sx += step) {
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

  /** Frame share and median hue/S/Y of everything passing a gate. */
  T.gate = (hueLo, hueHi, vLo, sLo, yLo, yHi) => {
    const { w, h, d } = T.buf;
    let n = 0;
    const hues = [], sats = [], ys = [], xs = [], yps = [];
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const [hu, sa, va] = T.hsv(d[i], d[i + 1], d[i + 2]);
      if (hu < hueLo || hu > hueHi) continue;
      if (va < vLo || sa < sLo) continue;
      const Y = T.lum(d[i], d[i + 1], d[i + 2]);
      if (Y < yLo || Y > yHi) continue;
      n++;
      hues.push(hu); sats.push(sa); ys.push(Y);
      xs.push(p % w); yps.push((p / w) | 0);
    }
    const med = (a) => (a.length ? a.slice().sort((u, v) => u - v)[a.length >> 1] : null);
    return { n, share: n / (w * h), hue: med(hues), s: med(sats), y: med(ys), xs, yps };
  };

  /** Frame luminance percentiles, for the exposure budget. */
  T.percentiles = () => {
    const { d } = T.buf;
    const a = new Float32Array(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) a[j] = T.lum(d[i], d[i + 1], d[i + 2]);
    a.sort();
    const at = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    return { p05: at(0.05), p50: at(0.5), p95: at(0.95), hi: (() => {
      let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.9) n++; return n / a.length;
    })(), lo: (() => {
      let n = 0; for (let i = 0; i < a.length; i++) if (a[i] <= 0.004) n++; return n / a.length;
    })() };
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
    const three = T.lighting.root.position.constructor;
    const boxes = [];
    T.scene.traverse((o) => {
      if (!o.isMesh || !o.material?.userData?.vsAccent) return;
      o.updateMatrixWorld(true);
      const pos = o.geometry.attributes.position;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      const v = new three();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const s = T.project([v.x, v.y, v.z]);
        if (s[2] > 1) continue;
        minX = Math.min(minX, s[0]); maxX = Math.max(maxX, s[0]);
        minY = Math.min(minY, s[1]); maxY = Math.max(maxY, s[1]);
      }
      if (maxX > minX) boxes.push([minX - 3, minY - 3, maxX + 3, maxY + 3]);
    });
    return boxes;
  };

  T.banned = () => {
    const board = T.scene.getObjectByName("vs.materialBoard");
    const bad = { standard: 0, physical: 0, envMap: 0, normalMap: 0, roughnessMap: 0, anyMap: 0, meshes: 0, smoothNormals: 0 };
    if (!board) return bad;
    board.traverse((o) => {
      if (!o.isMesh) return;
      bad.meshes++;
      const m = o.material;
      if (m.isMeshStandardMaterial) bad.standard++;
      if (m.isMeshPhysicalMaterial) bad.physical++;
      if (m.envMap) bad.envMap++;
      if (m.normalMap) bad.normalMap++;
      if (m.roughnessMap) bad.roughnessMap++;
      for (const k of ["map", "bumpMap", "displacementMap", "aoMap", "metalnessMap", "alphaMap", "emissiveMap", "lightMap", "specularMap"])
        if (m[k]) bad.anyMap++;
    });
    bad.sceneEnvironment = T.scene.environment ? 1 : 0;
    return bad;
  };

  return true;
}
