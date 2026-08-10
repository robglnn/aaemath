import * as THREE from "three";
import { Avatar } from "../play/Avatar.js";
import { Animator } from "../play/Animator.js";

/**
 * P08 — the player body and its procedural animation.
 *
 * Order 32: after locomotion (30), which is where the interpolated render transform is computed,
 * and before the camera (40), which must frame a body that has already been placed this frame.
 * Both systems mount here because the Animator is not a feature of its own — it is the half of P08
 * that moves the half of P08 that exists. The boot file is the only place allowed to hand one to
 * the other; neither reaches across a feature boundary to find it.
 *
 * Mounting under the name **"avatar"** is itself load-bearing. `Locomotion._buildProxy()` stands up
 * a blue capsule so the game is lookable-at before this piece exists, and stands it down again with
 * `this._proxy.visible = !this.kernel.byName.has("avatar")`. Registering that name is therefore the
 * handshake that retires the placeholder — but a handshake that depends on another piece keeping a
 * line of code is a handshake worth backing up, so `_standDownPlaceholders()` below also sweeps the
 * scene for a capsule-shaped stand-in and hides it directly. Two independent routes, because the
 * failure mode (two player bodies in the same frame) is the most conspicuous bug this piece could
 * ship.
 */
export default {
  id: "avatar",
  order: 32,

  async setup(kernel) {
    const avatar = kernel.mount("avatar", new Avatar(kernel));
    kernel.mount("animator", new Animator(kernel, { avatar }));

    // Run once on the next frame rather than now: `10-scaffold.js` (the temporary rig that keeps
    // early captures lit) and Locomotion's proxy both build during their own setup, and a sweep
    // that runs during ours can miss anything mounted after us.
    let swept = false;
    kernel.mount("avatar:sweep", {
      frame() {
        if (swept) return;
        swept = true;
        avatar._proxyHidden = standDownPlaceholders(kernel);
      },
    });
  },
};

/**
 * Hide anything that was standing in for the player. A stand-in is identified two ways: by name
 * (`scaffold` / `placeholder` / `proxy` markers, which is what `boot/10-scaffold.js` leaves behind
 * when terrain is present) and by shape — a lone capsule mesh parented under the locomotion system's
 * root is a player proxy and nothing else in this project builds one.
 */
function standDownPlaceholders(kernel) {
  let hidden = 0;
  const loco = kernel.get?.("locomotion");
  const roots = [];
  if (loco?.root) roots.push(loco.root);
  const scaffold = kernel.get?.("scaffold");
  if (scaffold?.root) roots.push(scaffold.root);

  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const type = o.geometry?.type || "";
      const marked = /placeholder|proxy|scaffold|capsule/i.test(o.name || "");
      if (type === "CapsuleGeometry" || marked) {
        // Hiding the mesh's parent group would take the camera target with it on some layouts;
        // hide the mesh itself, which is exactly the thing being replaced.
        o.visible = false;
        hidden++;
      }
    });
  }
  // Locomotion's own proxy is a Group of a capsule plus a cone nose; the capsule sweep above
  // catches the capsule, this catches the nose that came with it.
  if (loco?._proxy instanceof THREE.Object3D && hidden > 0) {
    loco._proxy.visible = false;
    hidden++;
  }
  return hidden > 0;
}
