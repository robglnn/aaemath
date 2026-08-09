import * as THREE from "three";
import { Kernel } from "./core/Kernel.js";
import { attach, introspect, publish } from "./core/Introspect.js";
import { config } from "./core/Config.js";

/**
 * Assembly point. Every subsystem is constructed and wired here and nowhere else, so each
 * feature module stays importable on its own and can be rebuilt without its neighbours.
 */
async function boot() {
  const canvas = document.getElementById("stage");
  const kernel = new Kernel(canvas);
  attach(kernel);

  // ---------------------------------------------------------------------------
  // Scaffold scene. Every element below is a placeholder owned by a feature module
  // that has not landed yet; it exists so the render path, the review harness and the
  // determinism contract are provable from the first commit.
  // ---------------------------------------------------------------------------
  kernel.scene.background = new THREE.Color(0x16222f);
  kernel.scene.fog = new THREE.Fog(0x2b3f52, 60, 620);

  kernel.scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x3a2a18, 1.0));

  const key = new THREE.DirectionalLight(0xffd7a8, 2.6);
  key.position.set(-70, 90, 55);
  key.castShadow = config.tier.shadows;
  key.shadow.mapSize.setScalar(config.tier.shadowResolution);
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
  kernel.scene.add(island);

  const marker = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 1.05, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x2e7f8c, roughness: 0.4, metalness: 0.3 })
  );
  marker.position.y = 1.05;
  marker.castShadow = true;
  kernel.scene.add(marker);

  kernel.camera.position.set(4.2, 3.2, 8.6);
  kernel.camera.lookAt(0, 1.3, 0);

  // A deterministic, obviously-moving element: proves `advance()` really moves game time
  // and lets the harness assert that simulation and render are wired to the same clock.
  kernel.mount("scaffold", {
    root: new THREE.Group(),
    fixed(step, simTime) {
      marker.position.y = 1.05 + Math.sin(simTime * 1.6) * 0.12;
      marker.rotation.y = simTime * 0.55;
    },
  });
  publish("scaffold", () => ({
    markerY: Number(marker.position.y.toFixed(4)),
    markerSpin: Number(marker.rotation.y.toFixed(4)),
  }));
  // ---------------------------------------------------------------------------

  kernel.run();
  introspect.ready = true;
  return kernel;
}

boot().catch((err) => {
  const detail = String(err?.stack || err);
  introspect.fatal = detail;
  console.error(err);
  const panel = document.createElement("div");
  panel.className = "vs-fatal";
  panel.innerHTML = `<h1>BOOT FAILED</h1>`;
  panel.appendChild(document.createTextNode(detail));
  document.body.appendChild(panel);
});
