import { CameraRig } from "../play/CameraRig.js";

/**
 * P05 — third-person camera rig.
 *
 * Mounted at 40 so the player already exists: the rig resolves what to follow from signals
 * (`camera:target`, `player:state`) and, failing those, by asking the kernel at runtime for a
 * system that can name a camera target. It imports nothing but its own module and `core/*`.
 */
export default {
  id: "camera",
  order: 40,

  async setup(kernel) {
    kernel.mount("camera", new CameraRig(kernel));
  },
};
