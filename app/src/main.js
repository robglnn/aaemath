import { Kernel } from "./core/Kernel.js";
import { attach, introspect } from "./core/Introspect.js";

/**
 * Assembly point.
 *
 * Features are not listed here. Every feature ships one file in `src/boot/`, and Vite's
 * directory glob picks it up automatically — so a dozen features can be built in parallel
 * without ever touching a shared file. A boot module exports:
 *
 *   export default {
 *     id: "locomotion",
 *     order: 30,                 // lower runs first; see the ORDER table in boot/README.md
 *     async setup(kernel) { ... }
 *   }
 *
 * A boot module that throws is reported and skipped; the rest of the game still comes up, so
 * one unfinished feature can never black out the whole build during review.
 */
// Lazy glob, deliberately. An eager glob evaluates every boot module while `main.js` itself is
// still being evaluated, so a single feature that throws at import time takes down the whole file
// before the kernel or the introspection surface exist — the reviewer then sees a blank page with
// no error to read. Importing them one at a time, inside try/catch, is what actually delivers the
// isolation this directory promises.
const modules = import.meta.glob("./boot/*.js");

async function boot() {
  const canvas = document.getElementById("stage");
  const kernel = new Kernel(canvas);
  attach(kernel);

  const loaded = [];
  for (const [path, load] of Object.entries(modules)) {
    try {
      const mod = await load();
      if (mod?.default && typeof mod.default.setup === "function") {
        loaded.push({ path, def: mod.default });
      } else {
        introspect.warnings.push(`boot module "${path}" has no default.setup()`);
      }
    } catch (err) {
      const detail = `boot module "${path}" failed to import: ${String(err?.stack || err)}`;
      introspect.errors.push(detail);
      console.error(detail);
    }
  }

  const entries = loaded.sort((a, b) => (a.def.order ?? 100) - (b.def.order ?? 100));

  introspect.bootOrder = entries.map((e) => `${e.def.order ?? 100}:${e.def.id ?? e.path}`);

  for (const { path, def } of entries) {
    try {
      await def.setup(kernel);
    } catch (err) {
      const detail = `boot module "${def.id ?? path}" failed: ${String(err?.stack || err)}`;
      introspect.errors.push(detail);
      console.error(detail);
    }
  }

  if (entries.length === 0) {
    introspect.warnings.push("no boot modules found — the scene will be empty");
  }

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
  panel.innerHTML = "<h1>BOOT FAILED</h1>";
  panel.appendChild(document.createTextNode(detail));
  document.body.appendChild(panel);
});
