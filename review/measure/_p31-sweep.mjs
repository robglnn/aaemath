#!/usr/bin/env node
/**
 * _p31-sweep.mjs — a deterministic fingerprint of WHAT THE BANK SERVES.
 *
 *   node review/measure/_p31-sweep.mjs <repo-root> [--json]
 *
 * Drives `ItemBank.select()` over a fixed grid of (knowledge point x form x difficulty x seed),
 * with and without a growing exclusion set, and hashes the id / source / relaxation of every
 * result. Two trees that produce the same digest serve the same items in the same order.
 *
 * It exists so P31's claim "splitting the catalogue changed the DELIVERY and nothing else" can be
 * measured rather than asserted: the digest is taken from the pre-split tree and committed, and
 * `review/measure/P31.mjs` re-derives it from the split tree on every run.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const { ItemBank } = await import(pathToFileURL(path.join(root, "app/src/learn/ItemBank.js")).href);

const bank = new ItemBank();
const kps = bank.knowledgePoints().slice().sort();
const forms = ["construct", "repair", "generate"];

const lines = [];
for (const kpId of kps) {
  const meta = bank.meta(kpId);
  for (const form of forms) {
    const exclude = new Set();
    for (let d = 1; d <= 5; d += 1) {
      for (let s = 0; s < 10; s += 1) {
        const seed = (s * 2654435761 + d * 7919) >>> 0;
        const sel = bank.select({ kpId, form, difficulty: d, seed, exclude: s % 3 === 0 ? exclude : null });
        lines.push(sel ? `${kpId}|${form}|${d}|${s}|${sel.item.id}|${sel.source}|${sel.relaxation}` : `${kpId}|${form}|${d}|${s}|NULL`);
        if (sel && s % 4 === 0) exclude.add(sel.item.id);
      }
    }
    // The misconception-targeted path, which relaxes in its own order.
    for (const m of meta.misconceptions) {
      const sel = bank.select({ kpId, form, difficulty: meta.band, misconception: m, seed: 4242 });
      lines.push(sel ? `${kpId}|${form}|M:${m}|${sel.item.id}|${sel.source}|${sel.relaxation}` : `${kpId}|${form}|M:${m}|NULL`);
    }
  }
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const body = lines.join("\n");
const out = {
  rows: lines.length,
  digest: fnv(body),
  catalogueRows: lines.filter((l) => l.includes("|catalogue|")).length,
  generatedRows: lines.filter((l) => l.includes("|generated|")).length,
  nullRows: lines.filter((l) => l.endsWith("|NULL")).length,
  sample: lines.slice(0, 3),
};
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
