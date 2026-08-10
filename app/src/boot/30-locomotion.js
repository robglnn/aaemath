import { signals } from "../core/Signals.js";
import { CollisionWorld } from "../play/CollisionWorld.js";
import { Locomotion } from "../play/Locomotion.js";

/**
 * P04 — character controller & collision.
 *
 * Collision mounts first so its `fixed` hook rebuilds the broadphase before anything queries it
 * in the same step. Other pieces reach it as `kernel.get("collision")` (raycast / capsuleCast /
 * groundAt) and feed it geometry with the `world:collider {id, mesh|geometry, matrix}` signal —
 * no imports across feature boundaries either way.
 *
 * ## `camera:probe` — the seam this module closes
 *
 * `play/CameraRig.js` asks a question before every boom cast: "how far can a sphere of this radius
 * travel from here along this direction?" It asks it on `camera:probe`, filling a reusable request
 * object and reading back `handled` / `hit` / `distance`. That is the right shape — a swept-sphere
 * query is exactly what a collision system is for, and asking over a signal is how a feature module
 * gets an answer from a sibling it may not import.
 *
 * Nobody answered. P36 drove the shipped app and counted **1123 `camera:probe` emits in eight
 * seconds of ordinary play, every one of them into an empty handler set** — the single highest-rate
 * signal in the game, above `kernel:frame`. The rig fell through to `kernel.get("collision")`, so
 * the picture was never wrong; the *declared* channel was simply decorative, and the only thing
 * holding the camera out of the rock was a duck-typed lookup by string name that nothing enforces.
 *
 * The answering code already existed and needed nothing written: `CollisionWorld.sphereCast` says
 * of itself that it is "the query a third-person camera boom needs". So this is three lines of
 * connection, not a feature. Same method, same numbers — `CameraRig.report().collisionSource`
 * flips from `"system"` to `"signal"` and `freeDistance` is unchanged, which is the proof that a
 * seam was closed rather than a behaviour changed.
 *
 * Registered here rather than inside `CollisionWorld` on purpose: the boot module is where this
 * project is allowed to know that two pieces exist at once.
 */
export default {
  id: "locomotion",
  order: 30,
  async setup(kernel) {
    const collision = kernel.mount("collision", new CollisionWorld(kernel));
    kernel.mount("locomotion", new Locomotion(kernel, { collision }));

    const off = signals.on("camera:probe", (req) => {
      // `handled` is the request protocol's claim flag: first answer wins, and an unanswered
      // request must be left exactly as it arrived so the asker's own fallbacks still run.
      if (!req || req.handled || !req.origin || !req.direction) return;
      const max = Number(req.maxDistance);
      const radius = Number(req.radius);
      if (!(max > 0) || !(radius > 0)) return;
      const r = collision.sphereCast(req.origin, req.direction, radius, max);
      req.hit = !!r?.hit;
      req.distance = req.hit ? r.distance : max;
      req.handled = true;
    });

    // Mounted rather than left dangling so the bridge is torn down with everything else. It has no
    // hooks, so it costs one optional-chain miss per frame and nothing else.
    kernel.mount("cameraProbe", { dispose: off });
  },
};
