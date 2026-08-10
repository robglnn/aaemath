import * as THREE from "three";
import { FULLSCREEN_VERT } from "./glsl.js";

/**
 * The plumbing every pass in the chain shares.
 *
 * One triangle, not two. A full-screen quad splits into two triangles whose shared diagonal is
 * rasterised twice and breaks 2x2 quad coherence along it; a single oversized triangle clipped to
 * the viewport covers the same pixels with one primitive and no seam. At 3840x2160, where this
 * chain runs a dozen full-screen passes, that is not a micro-optimisation.
 *
 * The geometry and the camera are module-level singletons: every pass in every PostStack instance
 * draws the same three vertices, so there is exactly one buffer on the GPU for the whole chain.
 */
const geometry = new THREE.BufferGeometry();
geometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
);
geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** A full-screen draw: one material, one target, one triangle. */
export class Blit {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  get uniforms() {
    return this.material.uniforms;
  }

  /**
   * Draw into `target` (or the canvas when target is null).
   *
   * `autoClear` is forced off and the clear is explicit, because the bloom upsample deliberately
   * accumulates into a target that already holds something.
   */
  render(renderer, target, { clear = true } = {}) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target ?? null);
    if (clear) renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.material.dispose();
  }
}

/** Shared uniform-free vertex stage; every pass fragment shader gets `varying vec2 vUv`. */
export const VERTEX = FULLSCREEN_VERT;

/**
 * A nearest-sampled copy. Used by `PostStack.processLinearRGB()`, the measurement seam that pushes
 * a caller-supplied float image through the *real* chain, so a claim about the bright pass is made
 * against the shipped shader rather than against a re-implementation of it.
 */
export function makeCopyMaterial() {
  return new THREE.ShaderMaterial({
    name: "vs.post.copy",
    uniforms: { tSrc: { value: null } },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * A half-float colour target.
 *
 * RGBA16F is not a nicety, it is the whole reason the bright pass can act as `design/art-direction
 * .md` §5.4's class mask. Three.js renders scene materials into a render target with
 * `NoToneMapping` forced, so the texture holds **scene-linear radiance**, and §5.4's distinction
 * between "a lit surface" and "an emitter" is exactly the distinction between values under 1.0 and
 * values over it. An 8-bit unorm target clamps at 1.0, every emitter and every lit rock facet in
 * the sun would arrive at the bright pass indistinguishable, and the only available bloom would be
 * §12.10's "bloom that touches everything".
 *
 * `samples` matters just as much. `WebGLRenderer({ antialias: true })` antialiases the *canvas*
 * drawing buffer and does nothing at all once the scene is rendered into a target, so a composer
 * that allocated a single-sampled target would silently turn the MSAA off. §4 measures the target's
 * facet-edge transition at 1.4 px at 1920 and §13 row 2 fails above 3 px: on this art direction,
 * losing MSAA is not a softening, it is a jaggedness, and both are wrong.
 */
export function makeTarget(width, height, { depth = false, samples = 0, name = "" } = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
    samples,
  });
  rt.texture.name = name;
  return rt;
}

/** Bytes a half-float RGBA target occupies, counting its MSAA sample buffer. */
export function targetBytes(rt) {
  if (!rt) return 0;
  const resolve = rt.width * rt.height * 8;
  const ms = (rt.samples || 0) > 0 ? resolve * rt.samples : 0;
  const depth = rt.depthBuffer ? rt.width * rt.height * 4 * Math.max(1, rt.samples || 1) : 0;
  return resolve + ms + depth;
}
