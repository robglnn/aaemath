/**
 * review/measure/_p31-distkey.mjs — identity of a built tree, in one line of JSON.
 *
 * P31's live claims are measured in a browser against `dist`, and `dist` is rebuilt by whichever
 * piece is building in parallel. Round 3's P31.mjs read a cached browser probe and printed 22/22
 * PASS while **all eighteen JS chunk names inside that probe were absent from `dist/assets`** — it
 * was reporting on a build that no longer existed. This is the fix: the probe records the identity
 * of the tree it measured, `P31.mjs` recomputes it, and a mismatch re-runs the probe rather than
 * reporting on a ghost.
 *
 * Vite content-hashes every chunk name, so the set of names IS the identity of the build: any
 * change to any module changes at least one name.
 */
import fs from "node:fs";
import path from "node:path";

export function distKey(dir) {
  const assets = path.join(dir, "assets");
  if (!fs.existsSync(assets)) return null;
  const names = fs
    .readdirSync(assets)
    .filter((f) => /\.(js|css)$/.test(f))
    .sort();
  let h = 2166136261;
  for (const s of names.join("|")) {
    h ^= s.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return { files: names.length, key: (h >>> 0).toString(16) };
}
