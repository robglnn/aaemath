import { Lighting } from "../world/Lighting.js";

/**
 * P11 — the light rig and the flat-shaded material language.
 *
 * Order 14: after the world (10) and the sky (12) so the rig can see what is already in the scene
 * and stand its own backdrop down when P10's sky is mounted, and before anything that mounts a mesh,
 * so every surface built afterwards is handed a material that already agrees with the light.
 *
 * `world/Materials.js` is a module-level singleton (`import { materials } from "../world/Materials.js"`)
 * and needs no boot step of its own: a feature asks it for a substance and gets a shared, cached
 * material back. The rig writes the shared uniform block those materials read, once per frame.
 */
export default {
  id: "lighting",
  order: 14,
  async setup(kernel) {
    kernel.mount("lighting", new Lighting(kernel));
  },
};
