/**
 * Palette compatibility shim.
 *
 * `design/palette.json` is authored by the art-direction piece and imported directly by the world
 * and render modules. Those are owned by different pieces and revised by different agents, so the
 * data file's shape can change underneath code that reads it — which is exactly what happened when
 * the palette was re-authored for the low-poly target and `materials` / `motion` were restructured
 * away. The symptom was brutal out of proportion to the cause: a top-level `palette.materials.x`
 * threw during module evaluation, which took down every feature in the build at once.
 *
 * This module is the seam. Read optional palette sections through `section()` and a missing one
 * degrades to a documented default with a warning, instead of destroying the boot.
 *
 * These defaults are AUTHORED FALLBACKS, not art direction. `design/palette.json` is always the
 * source of truth when it defines the section. When the low-poly material pass lands and defines
 * its own material constants, the corresponding fallback here becomes dead and should be deleted.
 */
import { warn } from "./Introspect.js";

const FALLBACK = {
  materials: {
    note: "Fallback only — superseded the moment design/palette.json defines `materials`.",
    plateMetal: {
      metalness: [0.9, 1],
      roughness: [0.22, 0.38],
      roughnessFloorUnderMotion: 0.35,
      specularTwoLobe: {
        broad: { roughness: 0.45, intensity: 0.25 },
        narrow: { roughness: 0.12, intensity: 1, gate: "N·V < 0.35", gateFeatherWidth: 0.1 },
      },
    },
    certainty: { metalness: 0, roughness: [0.06, 0.14], emissive: false, bloom: false },
    grey: { metalness: 0, roughness: [0.88, 0.95], emissive: false, bloom: false, rim: false },
    contactAO: { minDarkening: 0.45, radiusMetres: 0.35, falloff: "smoothstep" },
  },
  motion: {
    note: "Fallback only — superseded the moment design/palette.json defines `motion`.",
    fixedStepSeconds: 1 / 60,
    timeOfDay: { dawn: 0.18, day: 0.5, dusk: 0.78, night: 0.95 },
  },
};

const warned = new Set();

/**
 * Read a top-level palette section, falling back if the palette does not define it.
 * @param {object} palette the imported design/palette.json
 * @param {string} name section name, e.g. "materials"
 */
export function section(palette, name) {
  const found = palette?.[name];
  if (found) return found;
  if (!warned.has(name)) {
    warned.add(name);
    warn(`palette.json has no "${name}" section — using the compatibility fallback in core/paletteCompat.js`);
  }
  return FALLBACK[name] ?? {};
}

/** Safe dotted lookup with an explicit default: `pick(palette, "materials.contactAO", {})`. */
export function pick(palette, path, fallback) {
  const parts = path.split(".");
  let node = parts[0] in (palette ?? {}) ? palette : { [parts[0]]: section(palette, parts[0]) };
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) return fallback;
  }
  return node;
}
