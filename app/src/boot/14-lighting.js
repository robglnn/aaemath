import { Lighting } from "../world/Lighting.js";

/**
 * P11 — the light rig and the material language.
 *
 * Order 14: after the world (10) and the sky (12) so the rig can see what is already in the
 * scene, and before anything that mounts a mesh, so every surface built afterwards is handed a
 * material that already agrees with the light.
 */
export default {
  id: "lighting",
  order: 14,
  async setup(kernel) {
    kernel.mount("lighting", new Lighting(kernel));
  },
};
