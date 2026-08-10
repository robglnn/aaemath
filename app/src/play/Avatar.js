import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";
import { materials, flatten } from "../world/Materials.js";

/**
 * P08 — the player body.
 *
 * Built entirely from code. There is no loader, no glTF, no skeleton and no texture anywhere in
 * this file, because the target (`reference/target-lowpoly.png`) is not a model-viewer look: it is
 * *faceted solids under one warm key*, and a character that arrives as a smooth imported mesh reads
 * as a different game standing in the same frame. Every part here is a low-count extruded prism
 * whose rings are placed by hand, run through `flatten()` so each face carries its own normal, and
 * dressed in the `hero*` archetypes from `world/Materials.js` — the same factory the terrain, the
 * rock and the crystal ask for their substances. That is the whole reason the body sits in the
 * light rather than on top of it: it is lit by the identical shared uniform block, it takes §3.4's
 * chromatic blue on every face turned from the key, and it takes the same rim separator that keeps
 * a faceted silhouette off the sky.
 *
 * ## Why prisms and not boxes
 *
 * A box has four vertical faces; at any camera yaw at most two of them are visible and the shape
 * reads as a slab. A six- or eight-sided prism with per-ring radii costs a handful of triangles
 * more and gives the thing the target actually has: a **turning highlight**. As the body rotates,
 * facets cross the key one at a time and the armour ripples. `prism()` below is a lathe with an
 * explicit ring list, so a torso can be narrow at the waist and wide at the chest, a thigh can
 * taper, and a pauldron can flare — all from the same 40-line builder.
 *
 * ## Silhouette first
 *
 * The acceptance test is a 64 px thumbnail. That forces four decisions:
 *   - **shoulders wider than hips** — pauldrons flare past the arms, so the top of the figure is
 *     the widest thing in it and the shape is unmistakably a person from any angle;
 *   - **a real gap between the legs**, held open by narrow hips and a slight A-stance;
 *   - **a neck**, so the head is a separate value from the torso and does not melt into it;
 *   - **boots heavier than shins**, which puts weight at the bottom of the silhouette. A figure
 *     with thin ankles reads as a mannequin at any size.
 *
 * ## What this file does NOT do
 *
 * It does not move. `Animator.js` owns every joint angle; this file owns the joints' *existence*
 * and their rest pose. It also does not decide where the player is — it reads the interpolated
 * render position the locomotion system already computes (duck-typed via `kernel.get`, never an
 * import, per `design/architecture.md`), so the body and the camera target can never disagree by a
 * frame.
 */

const HERO_MAT = { owner: "avatar" }; // dedicated cache entries: the avatar alone gets to fade

/** Total height, metres. Matches Locomotion's 1.82 m capsule so the feet meet its ground plane. */
export const AVATAR_HEIGHT = 1.82;

// ---------------------------------------------------------------------------- geometry helpers

/**
 * A lathe with hard edges: `rings` are cross-sections up the Y axis, `sides` is how many facets
 * each cross-section has. Vertices are placed so a *face* — not an edge — points at +Z, which is
 * the direction the finished character faces; a plated chest wants a flat plane facing the camera
 * when the player runs away from it, not a corner.
 *
 * Each ring is `{ y, rx, rz, ox, oz }`: half-width, half-depth and an offset, which is what lets a
 * thigh lean inward or a hair cap sit back on the skull without a second mesh.
 */
function prism(rings, sides = 6, { capTop = true, capBottom = true } = {}) {
  const pos = [];
  const ang = (i) => ((i + 0.5) / sides) * Math.PI * 2;
  // `ox`/`oz` are optional per ring — defaulted here rather than at the call sites, because a
  // missing offset silently becomes NaN in a Float32 attribute and takes the bounding sphere with it.
  const pt = (r, i) => [
    (r.ox || 0) + Math.sin(ang(i)) * r.rx,
    r.y,
    (r.oz || 0) + Math.cos(ang(i)) * r.rz,
  ];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);

  for (let s = 0; s < rings.length - 1; s++) {
    const lo = rings[s];
    const hi = rings[s + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = pt(lo, i);
      const b = pt(lo, j);
      const c = pt(hi, j);
      const d = pt(hi, i);
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  const cap = (ring, up) => {
    const centre = [ring.ox || 0, ring.y, ring.oz || 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = pt(ring, i);
      const b = pt(ring, j);
      up ? tri(centre, a, b) : tri(centre, b, a);
    }
  };
  if (capBottom) cap(rings[0], false);
  if (capTop) cap(rings[rings.length - 1], true);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // already non-indexed: this is exactly a per-face normal
  g.userData.vsFlat = true;
  return g;
}

/** A slab with independent top and bottom footprints — belts, plates, boot soles. */
function wedge(y0, y1, w0, d0, w1, d1, oz0 = 0, oz1 = 0) {
  return prism(
    [
      { y: y0, rx: w0, rz: d0, ox: 0, oz: oz0 },
      { y: y1, rx: w1, rz: d1, ox: 0, oz: oz1 },
    ],
    4
  );
}

// ---------------------------------------------------------------------------- the body

export class Avatar {
  constructor(kernel) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "vs.avatar";

    /** The node everything hangs off. Yaw/lean live here; the Animator writes `joints`. */
    this.body = new THREE.Group();
    this.body.name = "vs.avatar.body";
    this.body.rotation.order = "YXZ"; // bank and pitch inside the yaw, never as world-axis tilts
    this.root.add(this.body);

    this.joints = {};
    this.meshes = [];
    this._mats = new Set();

    this._build();

    // --- transform sources -------------------------------------------------
    this._pos = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._havePos = false;
    this._yaw = 0;
    this._visLean = 0;
    this._visPush = 0;
    this.travelled = 0; // metres of ground distance — the Animator's phase clock
    this.groundSpeed = 0;

    // --- camera fade -------------------------------------------------------
    this._opacity = 1;
    this._opacityTarget = 1;

    this._offs = [
      signals.on("player:spawn", (p) => {
        if (!p?.position) return;
        this._pos.set(p.position.x, p.position.y, p.position.z);
        this._prev.copy(this._pos);
        this._havePos = true;
      }),
      // The rig's outbound handshake: when the boom collapses against geometry it asks the body to
      // get out of the way rather than putting the lens inside a wall. Inbound `camera:mode`
      // (someone *setting* a control mode) carries no `source`, and must not touch opacity.
      signals.on("camera:mode", (p) => {
        if (!p || p.source !== "camera") return;
        if (typeof p.opacity === "number") {
          this._opacityTarget = THREE.MathUtils.clamp(p.opacity, 0, 1);
        }
      }),
    ];

    publish("avatar", () => ({
      visible: this.root.visible,
      height: AVATAR_HEIGHT,
      meshes: this.meshes.length,
      triangles: this.triangles,
      materials: this._mats.size,
      castShadow: this.meshes.every((m) => m.castShadow),
      position: {
        x: Number(this._pos.x.toFixed(3)),
        y: Number(this._pos.y.toFixed(3)),
        z: Number(this._pos.z.toFixed(3)),
      },
      yawDeg: Number(((this._yaw * 180) / Math.PI).toFixed(1)),
      speed: Number(this.groundSpeed.toFixed(3)),
      travelled: Number(this.travelled.toFixed(2)),
      opacity: Number(this._opacity.toFixed(3)),
      joints: Object.keys(this.joints),
      placeholderHidden: this._proxyHidden === true,
    }));
  }

  // -------------------------------------------------------------------- build

  _mat(name) {
    const m = materials.get(name, HERO_MAT);
    this._mats.add(m);
    return m;
  }

  _part(parent, geometry, material, name) {
    const mesh = new THREE.Mesh(geometry.userData.vsFlat ? geometry : flatten(geometry), material);
    mesh.name = name;
    mesh.castShadow = true; // a character without a contact shadow is a sticker, not a body
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // rest-pose parts never move relative to their joint
    mesh.updateMatrix();
    parent.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _joint(parent, name, x, y, z) {
    const j = new THREE.Group();
    j.name = `vs.avatar.${name}`;
    j.rotation.order = "YXZ";
    j.position.set(x, y, z);
    parent.add(j);
    this.joints[name] = j;
    return j;
  }

  _build() {
    const plate = this._mat("heroPlate");
    const dark = this._mat("heroDark");
    const skin = this._mat("heroSkin");
    const hair = this._mat("heroHair");
    const metal = this._mat("metal");

    // ---- hips: the root of the whole figure, at 0.94 m -----------------------
    const hips = this._joint(this.body, "hips", 0, 0.94, 0);

    // pelvis block — dark, so the light chest plate above it reads as a separate armour piece
    this._part(
      hips,
      prism(
        [
          { y: -0.14, rx: 0.115, rz: 0.105 },
          { y: -0.02, rx: 0.132, rz: 0.115 },
          { y: 0.08, rx: 0.121, rz: 0.106 },
        ],
        6
      ),
      dark,
      "avatar.pelvis"
    );

    // ---- spine / chest ------------------------------------------------------
    const chest = this._joint(hips, "chest", 0, 0.08, 0);
    this._part(
      chest,
      prism(
        [
          { y: 0, rx: 0.118, rz: 0.098 }, // waist — the pinch that makes shoulders read
          { y: 0.12, rx: 0.142, rz: 0.112 },
          { y: 0.3, rx: 0.171, rz: 0.124 }, // ribcage
          { y: 0.42, rx: 0.166, rz: 0.116 },
          { y: 0.48, rx: 0.132, rz: 0.098 }, // clavicle shelf
        ],
        8
      ),
      plate,
      "avatar.torso"
    );
    // front chest panel: a raised plate, half a centimetre proud, catching the key on its own bevel
    this._part(chest, wedge(0.13, 0.4, 0.108, 0.026, 0.126, 0.026, 0.104, 0.116), plate, "avatar.chestPlate");
    // belt and the two straps that cross it — §10.4's cool near-black, the only dark on the trunk
    this._part(chest, wedge(-0.03, 0.04, 0.128, 0.108, 0.128, 0.108), dark, "avatar.belt");
    this._part(chest, wedge(0.05, 0.44, 0.036, 0.02, 0.03, 0.02, 0.108, 0.116), dark, "avatar.strap");
    this._part(chest, wedge(-0.03, 0.03, 0.05, 0.03, 0.05, 0.03, -0.108, -0.108), metal, "avatar.buckle");

    // ---- neck + head --------------------------------------------------------
    const neck = this._joint(chest, "neck", 0, 0.48, 0);
    this._part(neck, prism([{ y: 0, rx: 0.052, rz: 0.05 }, { y: 0.07, rx: 0.046, rz: 0.045 }], 6), skin, "avatar.neck");
    const head = this._joint(neck, "head", 0, 0.07, 0);
    this._part(
      head,
      prism(
        [
          { y: 0, rx: 0.055, rz: 0.06, oz: 0.004 }, // jaw
          { y: 0.045, rx: 0.079, rz: 0.086, oz: 0.006 },
          { y: 0.13, rx: 0.086, rz: 0.092, oz: 0.002 }, // cheek / brow
          { y: 0.2, rx: 0.072, rz: 0.078, oz: -0.004 },
        ],
        6
      ),
      skin,
      "avatar.head"
    );
    // hair sits back and slightly over: the brow edge is what makes a face read at thumbnail size
    this._part(
      head,
      prism(
        [
          { y: 0.1, rx: 0.09, rz: 0.096, oz: -0.014 },
          { y: 0.17, rx: 0.098, rz: 0.104, oz: -0.012 },
          { y: 0.235, rx: 0.062, rz: 0.07, oz: -0.014 },
        ],
        6
      ),
      hair,
      "avatar.hair"
    );

    // ---- arms ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const tag = side < 0 ? "L" : "R";
      const shoulder = this._joint(chest, `shoulder${tag}`, side * 0.152, 0.415, 0);
      // pauldron: the widest thing on the figure, and the reason the silhouette is not a bottle
      this._part(
        shoulder,
        prism(
          [
            { y: -0.1, rx: 0.062, rz: 0.062 },
            { y: -0.02, rx: 0.084, rz: 0.082, ox: side * 0.012 },
            { y: 0.05, rx: 0.072, rz: 0.07, ox: side * 0.016 },
          ],
          6
        ),
        plate,
        `avatar.pauldron${tag}`
      );
      this._part(
        shoulder,
        prism(
          [
            { y: -0.245, rx: 0.043, rz: 0.043 },
            { y: -0.13, rx: 0.052, rz: 0.052 },
            { y: -0.04, rx: 0.056, rz: 0.056 },
          ],
          6
        ),
        plate,
        `avatar.upperArm${tag}`
      );
      const elbow = this._joint(shoulder, `elbow${tag}`, 0, -0.25, 0);
      this._part(
        elbow,
        prism(
          [
            { y: -0.2, rx: 0.036, rz: 0.036 },
            { y: -0.09, rx: 0.046, rz: 0.046 },
            { y: 0, rx: 0.044, rz: 0.044 },
          ],
          6
        ),
        plate,
        `avatar.forearm${tag}`
      );
      this._part(
        elbow,
        prism([{ y: -0.29, rx: 0.041, rz: 0.048 }, { y: -0.2, rx: 0.045, rz: 0.05 }], 6),
        dark,
        `avatar.hand${tag}`
      );
    }

    // ---- legs ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const tag = side < 0 ? "L" : "R";
      const hip = this._joint(hips, `hip${tag}`, side * 0.088, -0.1, 0);
      this._part(
        hip,
        prism(
          [
            { y: -0.4, rx: 0.055, rz: 0.058 },
            { y: -0.2, rx: 0.07, rz: 0.073 },
            { y: -0.02, rx: 0.083, rz: 0.084 },
          ],
          6
        ),
        plate,
        `avatar.thigh${tag}`
      );
      this._part(hip, wedge(-0.3, -0.22, 0.062, 0.062, 0.058, 0.06), dark, `avatar.thighStrap${tag}`);
      const knee = this._joint(hip, `knee${tag}`, 0, -0.42, 0);
      this._part(
        knee,
        prism(
          [
            { y: -0.38, rx: 0.046, rz: 0.05 },
            { y: -0.22, rx: 0.055, rz: 0.06 },
            { y: -0.06, rx: 0.062, rz: 0.064 },
            { y: 0.005, rx: 0.056, rz: 0.058 },
          ],
          6
        ),
        plate,
        `avatar.shin${tag}`
      );
      const ankle = this._joint(knee, `ankle${tag}`, 0, -0.4, 0);
      // boot: heavier than the shin above it, so the bottom of the silhouette carries weight
      this._part(
        ankle,
        prism(
          [
            { y: 0, rx: 0.062, rz: 0.07, oz: 0.008 },
            { y: 0.05, rx: 0.07, rz: 0.078, oz: 0.006 },
            { y: 0.115, rx: 0.062, rz: 0.066 },
          ],
          6
        ),
        dark,
        `avatar.boot${tag}`
      );
      this._part(ankle, wedge(0, 0.036, 0.058, 0.098, 0.062, 0.104, 0.036, 0.03), dark, `avatar.sole${tag}`);
    }

    // rest pose: a slight A-stance and relaxed elbows. A dead-straight T is the single loudest
    // "this is a placeholder" signal a character can send, and it costs two lines to not send it.
    this.joints.shoulderL.rotation.z = 0.13;
    this.joints.shoulderR.rotation.z = -0.13;
    this.joints.elbowL.rotation.x = -0.16;
    this.joints.elbowR.rotation.x = -0.16;

    let tris = 0;
    for (const m of this.meshes) tris += m.geometry.attributes.position.count / 3;
    this.triangles = tris;
  }

  // -------------------------------------------------------------------- frame

  /** Duck-typed, never imported: whatever system can hand us an interpolated player transform. */
  _source() {
    if (this._src !== undefined) return this._src;
    const loco = this.kernel.get?.("locomotion");
    this._src = loco && typeof loco.getCameraTarget === "function" ? loco : null;
    return this._src;
  }

  frame(dt) {
    const src = this._source();
    if (src) {
      const node = src.getCameraTarget();
      if (node) {
        this._pos.copy(node.position);
        this._havePos = true;
      }
      // Heading is a plain readable field on the controller, the same way `collision` exposes
      // `groundAt`. No import crosses the boundary; if it is ever gone, the fallback below still
      // produces a facing from where the body actually went.
      const h = src.heading;
      // CORRECT AS WRITTEN. Measured: heading (0,-1) gives yaw = atan2(0,-1) = pi, which maps the
      // model's authored front (local +Z, see `prism`) onto world -z — exactly the velocity. The
      // body's +Z axis then dots to +1 against motion.
      //
      // This line was "fixed" twice on bad evidence and both attempts made it worse, so the trail is
      // worth keeping:
      //   * `atan2(h.x, -h.y)` is a MIRROR, not a rotation. It matches a half turn only when
      //     h.x === 0 (running dead ahead) and diverges the moment you strafe.
      //   * `atan2(-h.x, -h.y)` is a real half turn, and wrong here for the same reason: there was
      //     nothing to turn.
      // Both were chased on a facing measurement that read `avatar.root` — which carries position
      // only and never rotates — so it reported the same answer whatever this line said. Verify
      // with review/measure/facing-dump.mjs, which prints heading, velocity and the body's own axes
      // side by side and infers nothing.
      if (h && (h.x || h.y)) this._yaw = Math.atan2(h.x, h.y);
      this._leanSrc = src.lean ?? 0;
      this._pushSrc = src.push ?? 0;
      this._squash = src.squash ?? 0;
    }
    if (!this._havePos) return;

    // Distance travelled is the animation clock. Measuring it here — from the *rendered* position,
    // after interpolation — is what makes a foot plant land on the ground the body is actually
    // over. A phase advanced by time skates the moment acceleration changes.
    const step = Math.hypot(this._pos.x - this._prev.x, this._pos.z - this._prev.z);
    this.travelled += step;
    const sdt = Math.max(dt, 1e-4);
    this.groundSpeed += (step / sdt - this.groundSpeed) * Math.min(1, sdt * 12);
    this._prev.copy(this._pos);

    this.root.position.copy(this._pos);

    if (!src) this._yaw = this._yaw; // keep last facing when nothing can tell us
    const k = 1 - Math.exp(-Math.max(dt, 0) * 18);
    this._visLean += ((this._leanSrc ?? 0) - this._visLean) * k;
    this._visPush += ((this._pushSrc ?? 0) - this._visPush) * k;
    this.body.rotation.set(0, this._yaw, -this._visLean * 0.22, "YXZ");

    // Camera fade. Materials are avatar-owned cache entries (`{owner:"avatar"}`), so writing
    // opacity here can never reach a rock.
    this._opacity += (this._opacityTarget - this._opacity) * (1 - Math.exp(-Math.max(dt, 0) * 14));
    if (Math.abs(this._opacity - this._opacityTarget) < 0.004) this._opacity = this._opacityTarget;
    this._applyOpacity();
  }

  _applyOpacity() {
    const o = this._opacity;
    if (o === this._appliedOpacity) return;
    this._appliedOpacity = o;
    const clear = o > 0.995;
    for (const m of this._mats) {
      m.opacity = o;
      m.transparent = !clear;
      m.depthWrite = clear;
    }
    this.root.visible = o > 0.02;
    for (const m of this.meshes) m.castShadow = o > 0.35; // a ghost must not cast a solid shadow
  }

  /** Read by the Animator; also what `player:state` describes. */
  get visualLean() {
    return this._visLean;
  }

  dispose() {
    for (const off of this._offs) off?.();
    for (const m of this.meshes) m.geometry.dispose();
  }
}
