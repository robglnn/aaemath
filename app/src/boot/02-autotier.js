import { AutoTier } from "../core/AutoTier.js";

/**
 * P30 — measured quality tiering.
 *
 * Order 02, and it has to be 02 or lower. `AutoTier`'s constructor runs the first-frame hardware
 * heuristic and applies its result to `config` *before* anything reads the tier: `world` (10) sizes
 * its draw distance from it, `lighting` (14) builds its shadow cascades from
 * `tier.shadowResolution`, `scatter` (16) sizes its instance budget from `tier.grassDensity`, and
 * `post` (52) reads `tier.postStack` literally. Arriving after any of them would mean the first
 * decision had to tear down work that should never have been done — on precisely the machine that
 * could least afford to do it.
 *
 * It runs after nothing, because it depends on nothing but the renderer the kernel already built.
 */
export default {
  id: "autotier",
  order: 2,
  async setup(kernel) {
    kernel.mount("autotier", new AutoTier(kernel));
  },
};
