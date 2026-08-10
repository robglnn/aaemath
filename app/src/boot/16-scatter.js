import { Scatter } from "../world/Scatter.js";
import { publish } from "../core/Introspect.js";

/**
 * P13 — scatter: crystal, rock, flora, and the floating archipelago.
 *
 * Order 16: after the world (10), the sky (12) and the lighting rig (14), because every placement
 * in this piece is a terrain query and every material in it has to agree with a light rig that
 * already exists. It imports nothing but its own module and `core/*`; the surface it plants things
 * on is resolved at runtime from whatever is mounted, so it neither blocks on P09 nor breaks when
 * P09 lands.
 */
export default {
  id: "scatter",
  order: 16,
  async setup(kernel) {
    const scatter = kernel.mount("scatter", new Scatter(kernel));
    publish("scatter", () => scatter.probe());
  },
};
