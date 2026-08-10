#!/usr/bin/env node
/**
 * build-index.mjs — split the shipped catalogue into per-knowledge-point groups, and write the
 * manifest and the eager index that point at them.
 *
 *   node content/items/build-index.mjs
 *
 * Owned by P31. `build-catalogue.mjs` still owns the ITEMS — it writes the readable, diffable
 * `bank/*.json` and `index.json` and then calls in here for the shipping layout. Nothing in this
 * file invents content; it only decides what is loaded when.
 *
 * WHY. Round 1 shipped the whole Algebra I catalogue as one 1.6 MB module, because
 * `ItemBank.js` imported `BANK` statically. It was the largest asset in the build by an order of
 * magnitude, and a 15–25 minute session touches two or three knowledge points of the thirty-two.
 * A school Chromebook on school wifi paid for all thirty-two before the first frame.
 *
 * WHAT IS WRITTEN
 *
 *   groups/<kpId>.mjs   one knowledge point's items. Loaded on demand, cached forever.
 *   groups/index.mjs    kpId -> () => import("./<kpId>.mjs"). Static specifiers, so the bundler
 *                       can see every chunk; a variable specifier would defeat code splitting.
 *   manifest.mjs        lessons, per-knowledge-point meta, and per-group byte costs. Eager, tiny.
 *   manifest.json       the same object, readable and diffable. review/measure/P31.mjs asserts
 *                       the two agree, so the shipped copy can never drift from the reviewable one.
 *   index.mjs           the eager barrel: locale strings, the manifest, and the IDENTITY SPINE.
 *
 * THE IDENTITY SPINE, and why it still ships eagerly.
 *
 * `app/src/boot/62-learning.js` (P16's file) fingerprints the whole catalogue on every page load
 * to decide whether `bank-audit.json` still describes the content it prices, and
 * `tools/bank-audit.mjs` and `review/measure/P16.mjs` lint the committed pools out of the same
 * export. Those five strings per item — id, form, family, difficulty, canonical answer — are all
 * any of them read. So `BANK` keeps exactly those and nothing else, encoded as one string and
 * decoded at module init. Everything the item needs to be PRESENTED — stem, givens, hints,
 * distractors, world framing — moved into the group chunk.
 *
 * The five strings are reconstructed byte for byte, in the original order, so
 * `bankAuditFingerprint(BANK)` returns the value it returned before the split and the committed
 * audit table stays valid. review/measure/P31.mjs asserts that against the committed fingerprint.
 *
 * WHAT IS STRIPPED FROM THE GROUPS, and why it is not a content change.
 *
 *   `text`         the English snapshot of a locale key. It is a convenience for whoever opens
 *                  `bank/*.json`; the game resolves every string through `STRINGS` and the
 *                  learner's locale, and rendering the snapshot would be a G3 violation.
 *   `kpId`         the group is one knowledge point. Re-attached on load.
 *   `objectClass`  a property of the knowledge point, repeated on every item. Re-attached on load.
 *   `standards`    likewise. `ItemBank.fresh()` already re-attaches these to generated items from
 *                  the knowledge point's meta; loaded items now go through the same door.
 *
 * The item object an `ItemBank` caller sees is therefore identical after loading; P31 asserts
 * that field by field against `bank/*.json`.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/** A lesson is capped at this many minutes of scored-item time (`estMinutes` in the graph). */
export const LESSON_MINUTES = 25;

/* ------------------------------------------------------------------ lessons */

/**
 * Lessons, derived from the knowledge graph rather than authored twice.
 *
 * A lesson is a run of knowledge points from ONE strand, taken in prerequisite order, whose
 * `estMinutes` sum to at most `LESSON_MINUTES`. That is not a filing convenience: the product
 * requirement is a session that fits a Pomodoro attention cycle, `estMinutes` is the graph's own
 * estimate of scored-item time for a median learner, and a lesson that cannot be finished inside
 * one sitting is a lesson a student abandons.
 *
 * Deterministic in the graph: same graph, same lessons, byte for byte.
 */
export function buildLessons(kg) {
  const byId = new Map(kg.nodes.map((n) => [n.id, n]));

  // Prerequisite order, with a stable tiebreak so the walk never depends on Map iteration luck.
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const p of byId.get(id).prerequisites) visit(p);
    order.push(id);
  };
  const seeds = kg.nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.difficulty - b.n.difficulty || a.i - b.i);
  for (const { n } of seeds) visit(n.id);

  const lessons = [];
  for (const strand of kg.strands) {
    const ids = order.filter((id) => byId.get(id).strand === strand.id);
    let cur = null;
    for (const id of ids) {
      const est = byId.get(id).estMinutes;
      if (cur && cur.estMinutes + est > LESSON_MINUTES) cur = null;
      if (!cur) {
        cur = {
          id: `${strand.id}-${lessons.filter((l) => l.strand === strand.id).length + 1}`,
          strand: strand.id,
          strandTitle: strand.title,
          title: null,
          kpIds: [],
          estMinutes: 0,
        };
        lessons.push(cur);
      }
      cur.kpIds.push(id);
      cur.estMinutes += est;
    }
  }
  for (const l of lessons) l.title = l.kpIds.map((id) => byId.get(id).shortTitle || byId.get(id).title).join(" · ");
  return lessons;
}

/* ------------------------------------------------------------------ the split */

const STRIP_ITEM_FIELDS = ["kpId", "objectClass", "standards"];

/** Drop every `text` snapshot, wherever it sits, without touching anything else. */
function stripText(value) {
  if (Array.isArray(value)) return value.map(stripText);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "text" && typeof v === "string") continue;
      out[k] = stripText(v);
    }
    return out;
  }
  return value;
}

function leanItem(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (STRIP_ITEM_FIELDS.includes(k)) continue;
    out[k] = stripText(v);
  }
  return out;
}

/**
 * The five strings `bankAuditFingerprint` and the committed-pool lints read, per item.
 *
 * `form` and `family` are not stored: an item id is `${family}/${form}/${hash}` by construction
 * (`content/items/generators.mjs`), so both are slices of the id. The builder asserts that on
 * every item rather than trusting it, because if it ever stopped being true the fingerprint would
 * change silently and the audit table would start pricing a bank nobody ships.
 */
function spineLine(item) {
  const a = item.answer ?? {};
  const canonical =
    item.answerType === "repair" && a.line != null && a.canonical == null
      ? `${a.line}|${a.tex}`
      : String(a.canonical ?? a.tex ?? "");
  const [family, form] = item.id.split("/");
  if (family !== item.family || form !== item.form) {
    throw new Error(`item id does not encode family/form: ${item.id} (${item.family}, ${item.form})`);
  }
  for (const [name, s] of [["id", item.id], ["canonical", canonical]]) {
    if (/[\t\n\u0000]/.test(s)) throw new Error(`${name} contains a spine separator: ${JSON.stringify(s)}`);
  }
  return `${item.id}\t${item.difficulty}\t${canonical}`;
}

const gzBytes = (s) => zlib.gzipSync(Buffer.from(s, "utf8")).length;

/**
 * Write groups, manifest and index. `index` is the object `build-catalogue.mjs` just wrote to
 * `index.json`; it comes back extended with `lessons` and per-knowledge-point group costs.
 */
export function writeSplitIndex({ kg, strings, bankFiles, index }) {
  const groupsDir = path.join(HERE, "groups");
  fs.rmSync(groupsDir, { recursive: true, force: true });
  fs.mkdirSync(groupsDir, { recursive: true });

  const lessons = buildLessons(kg);
  const lessonOf = new Map();
  for (const l of lessons) for (const id of l.kpIds) lessonOf.set(id, l.id);

  const spineBlocks = [];
  const kpMeta = {};

  for (const file of bankFiles) {
    const group = { kpId: file.kpId, items: file.items.map(leanItem) };
    const body = `/* GENERATED by content/items/build-index.mjs — do not hand-edit. */\nexport default ${JSON.stringify(group)};\n`;
    fs.writeFileSync(path.join(groupsDir, `${file.kpId}.mjs`), body);

    spineBlocks.push([file.kpId, ...file.items.map(spineLine)].join("\n"));

    // Everything `ItemBank.stats()` reports about a knowledge point it has NOT loaded. Without
    // these three the reviewer surface would silently narrow to whatever happened to be resident,
    // and `probe().minItemsPerMisconception` — a coverage gate — would read as passing because
    // the thin knowledge point was not in memory.
    // Counted PER DISTRACTOR, which is what `ItemBank`'s misconception index does (an item with
    // two distractors naming the same misconception appears twice in that pool) and what
    // `index.json` already reported. Counting per item here would have quietly changed a number
    // a reviewer compares round over round.
    const byMisc = {};
    for (const m of file.misconceptions) byMisc[m] = 0;
    for (const it of file.items) for (const d of it.distractors) byMisc[d.misconception] = (byMisc[d.misconception] ?? 0) + 1;

    kpMeta[file.kpId] = {
      kpId: file.kpId,
      title: file.title,
      strand: file.strand,
      band: file.band,
      objectClass: file.objectClass,
      standards: file.standards,
      misconceptions: file.misconceptions,
      count: file.items.length,
      forms: {
        construct: file.items.filter((i) => i.form === "construct").length,
        repair: file.items.filter((i) => i.form === "repair").length,
        generate: file.items.filter((i) => i.form === "generate").length,
      },
      bands: [...new Set(file.items.map((i) => i.difficulty))].sort(),
      itemsPerMisconception: byMisc,
      lesson: lessonOf.get(file.kpId) ?? null,
      estMinutes: kg.nodes.find((n) => n.id === file.kpId)?.estMinutes ?? null,
      // SOURCE bytes of the group module, before the bundler minifies it. A build-time estimate,
      // kept for tooling; review/measure/P31.mjs measures the SHIPPED chunk instead and reports that.
      sourceBytes: { raw: body.length, gzip: gzBytes(body) },
    };
    if (index.kps[file.kpId]) {
      index.kps[file.kpId].lesson = kpMeta[file.kpId].lesson;
      index.kps[file.kpId].sourceBytes = kpMeta[file.kpId].sourceBytes;
    }
  }

  const ids = bankFiles.map((f) => f.kpId);
  const loaders = `/* GENERATED by content/items/build-index.mjs — do not hand-edit. */
export const GROUP_IDS = ${JSON.stringify(ids)};

/**
 * One static specifier per group, so the bundler emits one chunk per knowledge point. A computed
 * specifier — \`import(\`./\${kpId}.mjs\`)\` — would either be left alone by the bundler (and 404 in
 * production) or swept into a glob that pulls the whole catalogue back into one chunk.
 */
export const GROUP_LOADERS = {
${ids.map((id) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(`./${id}.mjs`)}),`).join("\n")}
};
`;
  fs.writeFileSync(path.join(groupsDir, "index.mjs"), loaders);

  for (const l of lessons) {
    l.sourceBytes = l.kpIds.reduce(
      (acc, id) => ({ raw: acc.raw + kpMeta[id].sourceBytes.raw, gzip: acc.gzip + kpMeta[id].sourceBytes.gzip }),
      { raw: 0, gzip: 0 }
    );
    l.items = l.kpIds.reduce((a, id) => a + kpMeta[id].count, 0);
  }

  index.lessons = lessons;
  index.groups = { count: ids.length, granularity: "knowledge-point" };
  fs.writeFileSync(path.join(HERE, "index.json"), JSON.stringify(index, null, 1) + "\n");

  const manifest = {
    schemaVersion: 1,
    generated: index.generated,
    perKp: index.perKp,
    seed: index.seed,
    granularity: "knowledge-point",
    lessonMinutes: LESSON_MINUTES,
    lessons,
    kps: kpMeta,
  };
  fs.writeFileSync(path.join(HERE, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  fs.writeFileSync(
    path.join(HERE, "manifest.mjs"),
    `/**
 * manifest.mjs — what belongs to which lesson, and what each group costs.
 *
 * GENERATED by content/items/build-index.mjs — do not hand-edit. \`manifest.json\` is the same
 * object, readable; review/measure/P31.mjs fails if the two ever disagree.
 *
 * This is the ONLY catalogue metadata that is eager. It carries no items: every knowledge point's
 * band, standards, misconceptions and item count are here, so \`ItemBank.meta()\`, \`knowledgePoints()\`
 * and the generator fallback all work with zero groups resident.
 */
export const MANIFEST = ${JSON.stringify(manifest)};
export const LESSONS = MANIFEST.lessons;
export const KP_META = MANIFEST.kps;
export default MANIFEST;
`
  );

  const spine = spineBlocks.join("\u0000");
  const barrel = `/**
 * index.mjs — the EAGER half of the shipped item bank.
 *
 * GENERATED by content/items/build-index.mjs — do not hand-edit.
 *
 * The items are NOT here. They live one chunk per knowledge point under \`groups/\`, and
 * \`app/src/learn/ItemBank.js\` pulls a group the first time a session needs it. What is here is
 * only what every page load genuinely needs before the first item is drawn:
 *
 *   STRINGS    every locale key. A generated item can name any of them, so this cannot be split
 *              by knowledge point; it could be split by LOCALE, which is a separate piece of work.
 *   MANIFEST   lessons, and per-knowledge-point meta with no items in it.
 *   BANK       the identity spine — id, form, family, difficulty, canonical answer, per item.
 *              \`app/src/boot/62-learning.js\` folds it into the fingerprint that decides whether
 *              \`bank-audit.json\` still prices the content we ship, and \`tools/bank-audit.mjs\` and
 *              \`review/measure/P16.mjs\` lint the committed pools out of it. Those five strings are
 *              everything any of them read, and they are reconstructed here in the original order,
 *              so the fingerprint is the same value it was before the catalogue was split.
 *
 * \`form\` and \`family\` are slices of the id, which is \`\${family}/\${form}/\${hash}\` by construction.
 */
export const STRINGS = ${JSON.stringify(strings)};
export const LOCALES = ["en", "es", "pl"];

export { MANIFEST, LESSONS, KP_META } from "./manifest.mjs";
export { GROUP_IDS, GROUP_LOADERS } from "./groups/index.mjs";

import { MANIFEST as _M } from "./manifest.mjs";
/** The build-time index, kept under its round-1 name because P17's stats surface reads it. */
export const BANK_INDEX = _M;

const SPINE = ${JSON.stringify(spine)};

/** Decode the spine. 1152 items, one pass, no allocation beyond the objects themselves. */
export const BANK = SPINE.split("\\u0000").map((block) => {
  const lines = block.split("\\n");
  const items = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const t1 = line.indexOf("\\t");
    const t2 = line.indexOf("\\t", t1 + 1);
    const id = line.slice(0, t1);
    const s1 = id.indexOf("/");
    const s2 = id.indexOf("/", s1 + 1);
    items.push({
      id,
      family: id.slice(0, s1),
      form: id.slice(s1 + 1, s2),
      difficulty: Number(line.slice(t1 + 1, t2)),
      answer: { canonical: line.slice(t2 + 1) },
    });
  }
  return { kpId: lines[0], items };
});
`;
  fs.writeFileSync(path.join(HERE, "index.mjs"), barrel);

  return {
    groups: ids.length,
    lessons: lessons.length,
    spine: { raw: spine.length, gzip: gzBytes(spine) },
    strings: { raw: JSON.stringify(strings).length, gzip: gzBytes(JSON.stringify(strings)) },
    manifest: { raw: JSON.stringify(manifest).length, gzip: gzBytes(JSON.stringify(manifest)) },
    groupBytes: Object.fromEntries(Object.entries(kpMeta).map(([k, v]) => [k, v.sourceBytes])),
  };
}

/* ------------------------------------------------------------------ CLI */

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  const kg = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
  const strings = JSON.parse(fs.readFileSync(path.join(HERE, "strings.json"), "utf8")).keys;
  const index = JSON.parse(fs.readFileSync(path.join(HERE, "index.json"), "utf8"));
  const bankFiles = kg.nodes.map((n) =>
    JSON.parse(fs.readFileSync(path.join(HERE, "bank", `${n.id}.json`), "utf8"))
  );
  const out = writeSplitIndex({ kg, strings, bankFiles, index });
  const totalGroup = Object.values(out.groupBytes).reduce(
    (a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip }),
    { raw: 0, gzip: 0 }
  );
  console.log(
    JSON.stringify(
      {
        groups: out.groups,
        lessons: out.lessons,
        eager: { spine: out.spine, strings: out.strings, manifest: out.manifest },
        lazyTotal: totalGroup,
      },
      null,
      2
    )
  );
}
