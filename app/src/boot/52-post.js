import { PostStack } from "../render/PostStack.js";

/**
 * P12 — the post-processing chain.
 *
 * Order 52: after the world, the sky, the lighting, the avatar, the camera and the VFX (50), and
 * before anything that draws into the DOM overlay. It has to be the last thing that touches the 3D
 * frame, because from here on `kernel.composer` owns the path from scene-linear light to the
 * canvas.
 *
 * Mounted even on the tiers that ask for no effects. `PostStack` decides for itself whether to
 * install a composer — on potato and low it installs none at all, allocates no render target and
 * leaves `kernel.composer` null — and it still publishes its probe, so a reviewer can read
 * `__vs.probe("post")` on every tier and see what was and was not built instead of inferring it
 * from a missing key.
 */
export default {
  id: "post",
  order: 52,
  async setup(kernel) {
    kernel.mount("post", new PostStack(kernel));
  },
};
