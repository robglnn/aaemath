import * as THREE from "three";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";

/**
 * TEMPORARY. A minimal lit ground plane so the render path, the deterministic clock and the
 * review harness are provable before the world pieces land.
 *
 * Delete this file the moment P09 (terrain) and P11 (lighting) are both mounted — it exists
 * only so early captures show a real render instead of a black frame.
 */
export default {
  id: "scaffold",
  order: 10,
  async setup(kernel) {
    if (kernel.byName.has("terrain")) return; // real world present; stand down

    kernel.scene.background = new THREE.Color(0x16222f);
    kernel.scene.fog = new THREE.Fog(0x2b3f52, 60, 620);
    kernel.scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x3a2a18, 1.0));

    const key = new THREE.DirectionalLight(0xffd7a8, 2.6);
    key.position.set(-70, 90, 55);
    key.castShadow = config.tier.shadows;
    key.shadow.mapSize.setScalar(Math.min(2048, config.tier.shadowResolution));
    key.shadow.camera.far = 320;
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    kernel.scene.add(key);

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(52, 40, 14, 10, 1),
      new THREE.MeshStandardMaterial({ color: 0xbd7442, roughness: 0.95 })
    );
    island.position.y = -7;
    island.receiveShadow = true;
    island.castShadow = true;

    const marker = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 1.05, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x2e7f8c, roughness: 0.4, metalness: 0.3 })
    );
    marker.position.y = 1.05;
    marker.castShadow = true;

    const root = new THREE.Group();
    root.add(island, marker);

    kernel.camera.position.set(4.2, 3.2, 8.6);
    kernel.camera.lookAt(0, 1.3, 0);

    kernel.mount("scaffold", {
      root,
      fixed(step, simTime) {
        // Deterministic motion: proves advance() really moves game time.
        marker.position.y = 1.05 + Math.sin(simTime * 1.6) * 0.12;
        marker.rotation.y = simTime * 0.55;
      },
    });

    publish("scaffold", () => ({
      markerY: Number(marker.position.y.toFixed(4)),
      markerSpin: Number(marker.rotation.y.toFixed(4)),
      temporary: true,
    }));
  },
};
