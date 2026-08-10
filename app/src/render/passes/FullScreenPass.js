import * as THREE from "three";
import { FULLSCREEN_VERT } from "./glsl.js";

/**
 * The plumbing every pass in the chain shares.
 *
 * One triangle, not two. A full-screen quad splits into two triangles whose shared diagonal
 * is rasterised twice and breaks 2x2 quad coherence along it; a single oversized triangle
 * clipped to the viewport covers the same pixels with one primitive and no seam. At 4K, where
 * this chain runs sixteen-odd full-screen passes, that is not a micro-optimisation — it is the
 * difference between 16 and 32 primitives and a measurable amount of overdraw on the diagonal.
 *
 * The geometry and the camera are module-level singletons: every pass in every PostStack
 * instance draws the same three vertices, so there is exactly one buffer on the GPU for the
 * entire post chain.
 */
const geometry = new THREE.BufferGeometry();
geometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
);
geometry.setAttribute(
  "uv",
  new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2)
);
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
   * `autoClear` is forced off and the clear is explicit, because two passes in this chain
   * (the bloom upsample and the no-bloom suppression pass) deliberately accumulate into a
   * target that already holds something.
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
 * A nearest-sampled copy. Used only by the measurement seam in `PostStack.processRGBAF32`,
 * to move a caller-supplied float image into the chain's half-float scene target so that
 * everything downstream is sampling the exact texture format production sampling uses.
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
 * A half-float colour target. RGBA16F is not a nicety here: §12.30 makes it binding, because
 * the hologram veil composites in linear *before* the curve and the KaTeX glyph layer is
 * driven ≥ 4x above the curve's Y 0.99 point and has to clip *through* the shoulder. An 8-bit
 * unorm target hard-clamps at 1.0, which lands the glyphs near 0.97 and skews highlight hue
 * instead of desaturating it — anti-pattern 15 by another route.
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
