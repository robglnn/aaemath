import { CollisionWorld } from "../play/CollisionWorld.js";
import { Locomotion } from "../play/Locomotion.js";

/**
 * P04 — character controller & collision.
 *
 * Collision mounts first so its `fixed` hook rebuilds the broadphase before anything queries it
 * in the same step. Other pieces reach it as `kernel.get("collision")` (raycast / capsuleCast /
 * groundAt) and feed it geometry with the `world:collider {id, mesh|geometry, matrix}` signal —
 * no imports across feature boundaries either way.
 */
export default {
  id: "locomotion",
  order: 30,
  async setup(kernel) {
    const collision = kernel.mount("collision", new CollisionWorld(kernel));
    kernel.mount("locomotion", new Locomotion(kernel, { collision }));
  },
};
