import { Sky } from "../world/Sky.js";
import { Atmosphere } from "../world/Atmosphere.js";

/**
 * P10 — the sky, its cloud slabs, and the depth law that stands behind everything else.
 *
 * Order 12: after the world (10), because `Atmosphere` replaces three's fog shader chunks and
 * wants to mark already-created materials for recompilation; and before the light rig (14),
 * because `Lighting` stands its own placeholder dome down the moment it finds a system named
 * `sky` mounted, and because the rig's `world:sun` then arrives to be adopted by both of these.
 *
 * Sky first, Atmosphere second: `Atmosphere` reads `Sky`'s measured band table so the haze in
 * front of a distant silhouette and the sky beside it are the same function.
 */
export default {
  id: "sky",
  order: 12,
  async setup(kernel) {
    kernel.mount("sky", new Sky(kernel));
    kernel.mount("atmosphere", new Atmosphere(kernel));
  },
};
