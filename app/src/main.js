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
const modules = import.meta.glob("./boot/*.js", { eager: true });

async function boot() {
  const canvas = document.getElementById("stage");
  const kernel = new Kernel(canvas);
  attach(kernel);

  const entries = Object.entries(modules)
    .map(([path, mod]) => ({ path, def: mod.default }))
    .filter((e) => e.def && typeof e.def.setup === "function")
    .sort((a, b) => (a.def.order ?? 100) - (b.def.order ?? 100));

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
