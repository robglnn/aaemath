#!/usr/bin/env node
/**
 * build-catalogue.mjs — materialise the shipped item bank.
 *
 *   node content/items/build-catalogue.mjs [--per-kp=24] [--seed=20260809]
 *
 * The generators in `generators.mjs` can emit items forever; `content/items/bank/*.json` is a
 * deterministic, committed, diffable snapshot of them, one file per knowledge point, so that the
 * bank a learner meets can be read by a person and reviewed line by line rather than taken on
 * trust. Re-running with the same seed reproduces the files byte for byte (G4).
 *
 * The English text is snapshotted into each item next to its locale key. That is a convenience
 * for whoever opens the file, not a second source of truth: `review/measure/P17.mjs` fails the
 * build if a snapshot and `strings.json` ever disagree.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateForKp, NODE_CLASS } from "./generators.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
};

const PER_KP = Number(arg("per-kp", "30"));
const SEED = Number(arg("seed", "20260809"));

const kg = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
const strings = JSON.parse(fs.readFileSync(path.join(HERE, "strings.json"), "utf8")).keys;

function en(key, params = {}) {
  const entry = strings[key];
  if (!entry) throw new Error(`no locale entry for "${key}"`);
  return entry.en.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] === undefined ? m : String(params[name])
  );
}

const bankDir = path.join(HERE, "bank");
fs.mkdirSync(bankDir, { recursive: true });

const index = { generated: null, perKp: PER_KP, seed: SEED, kps: {} };
let total = 0;

// A distinct seed per node, derived from the node id, so adding a node never reshuffles another.
function seedFor(id) {
  let h = SEED >>> 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h || 1;
}

for (const node of kg.nodes) {
  const items = generateForKp(node.id, {
    count: PER_KP,
    seed: seedFor(node.id),
    band: node.difficulty,
  });
  if (items.length < PER_KP) {
    throw new Error(`${node.id}: only ${items.length} of ${PER_KP} items could be drawn`);
  }
  const out = items.map((it) => ({
    id: it.id,
    kpId: it.kpId,
    family: it.family,
    form: it.form,
    difficulty: it.difficulty,
    tier: it.tier,
    objectClass: it.objectClass,
    stem: it.stem,
    given: it.given,
    ...(it.spoken ? { spoken: { ...it.spoken, text: en(it.spoken.key, it.spoken.params) } } : {}),
    ...(it.story ? { story: { ...it.story, text: en(it.story.key, it.story.params) } } : {}),
    ...(it.working ? { working: it.working, brokenBy: it.brokenBy } : {}),
    ask: { key: it.ask, params: it.hintParams, text: en(it.ask, it.hintParams) },
    answerType: it.answerType,
    unknown: it.unknown,
    answer: it.answer,
    ...(it.requiresGathered ? { requiresGathered: true } : {}),
    ...(it.check ? { check: it.check } : {}),
    distractors: it.distractors,
    hints: it.hints.map((h) => ({ ...h, text: en(h.key, h.params) })),
    worldFraming: {
      ...it.worldFraming,
      text: en(it.worldFraming.key, it.worldFraming.params),
    },
    standards: node.standards,
    params: it.params,
  }));

  const file = {
    kpId: node.id,
    title: node.title,
    strand: node.strand,
    band: node.difficulty,
    objectClass: NODE_CLASS[node.id],
    standards: node.standards,
    misconceptions: node.misconceptions.map((m) => m.id),
    count: out.length,
    items: out,
  };
  fs.writeFileSync(path.join(bankDir, `${node.id}.json`), JSON.stringify(file, null, 1) + "\n");
  total += out.length;

  const byMisc = {};
  for (const it of out) for (const d of it.distractors) byMisc[d.misconception] = (byMisc[d.misconception] || 0) + 1;
  index.kps[node.id] = {
    band: node.difficulty,
    objectClass: NODE_CLASS[node.id],
    standards: node.standards,
    misconceptions: node.misconceptions.map((m) => m.id),
    count: out.length,
    forms: {
      construct: out.filter((i) => i.form === "construct").length,
      repair: out.filter((i) => i.form === "repair").length,
      generate: out.filter((i) => i.form === "generate").length,
    },
    itemsPerMisconception: byMisc,
  };
}

index.generated = `${total} items across ${Object.keys(index.kps).length} knowledge points`;
fs.writeFileSync(path.join(HERE, "index.json"), JSON.stringify(index, null, 1) + "\n");

/**
 * The shipped layout. Data is inlined into ESM rather than imported as JSON on purpose: a plain
 * ESM module loads identically under Node (the offline simulations and review/measure/P17.mjs)
 * and under Vite (the game), with no import-attribute dialect in between. The per-knowledge-point
 * files under `bank/` stay as the readable, reviewable artefact; `review/measure/P17.mjs`
 * asserts the shipped copy is the same data, so "inlined" can never drift into "different".
 *
 * WHAT SHIPS WHERE IS P31'S, NOT THIS FILE'S. Round 1 wrote the whole catalogue into one
 * `index.mjs`, which became a 1.6 MB / 147 kB-gzipped chunk that every page load paid for before
 * the first item was drawn. `build-index.mjs` splits it one chunk per knowledge point and writes
 * the manifest that says which knowledge points make up which lesson. This file still owns the
 * ITEMS; it hands them over and lets the split decide the layout.
 */
const ids = kg.nodes.map((n) => n.id);
const files = ids.map((id) => JSON.parse(fs.readFileSync(path.join(bankDir, `${id}.json`), "utf8")));
const { writeSplitIndex } = await import("./build-index.mjs");
const split = writeSplitIndex({ kg, strings, bankFiles: files, index });

console.log(
  JSON.stringify(
    {
      wrote: `${total} items`,
      knowledgePoints: Object.keys(index.kps).length,
      perKp: PER_KP,
      seed: SEED,
      bankDir: path.relative(ROOT, bankDir),
      groups: split.groups,
      lessons: split.lessons,
      eagerGzip: split.spine.gzip + split.strings.gzip + split.manifest.gzip,
    },
    null,
    2
  )
);
