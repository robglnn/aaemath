import { Terrain } from "../world/Terrain.js";
import { Level01, LEAF } from "../world/Level01.js";

/**
 * P09 — Leaf Nine: the terrain and the composition.
 *
 * Order 10, ahead of everything: the collider has to exist before anything tries to stand on it,
 * and the lighting rig (14) reads what is already in the scene.
 *
 * Terrain owns the heightfield and the flat-shading material language. Level01 owns the
 * composition — what stands where, what frames the arrival, what the horizon is asking — and
 * publishes its anchor points through the `level` probe so no other piece has to agree a
 * coordinate with this file.
 */
export default {
  id: "world",
  order: 10,
  async setup(kernel) {
    const terrain = new Terrain(kernel, LEAF);
    kernel.mount("terrain", terrain);
    kernel.mount("level01", new Level01(kernel, terrain));
  },
};
