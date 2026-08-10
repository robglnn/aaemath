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
 *   strings/items-<l>.mjs  ONE locale's item text. Loaded on demand, one per learner.
 *   spine.mjs           the identity spine. Loaded only when the committed audit table is stale.
 *   manifest.mjs        lessons, per-knowledge-point meta, and per-group byte costs. Eager, tiny.
 *   manifest.json       the same object, readable and diffable. review/measure/P31.mjs asserts
 *                       the two agree, so the shipped copy can never drift from the reviewable one.
 *   index.mjs           the eager barrel: the manifest, the loaders, and the fingerprint SCALAR.
 *
 * ROUND 3 — WHAT LEFT THE EAGER BARREL, AND WHY IT WAS SAFE TO MOVE.
 *
 * Round 2 split the ITEMS out and stopped. The critic then measured what was left and found two
 * things in it that no learner needs before their first item:
 *
 *   1. THE LOCALE TABLE shipped all three languages of all 281 keys to every learner, when a
 *      learner reads exactly one. `app/src/boot/05-i18n.js` had already established the shape for
 *      the UI half of this — one bundle per locale, dynamically imported, awaited once at boot so
 *      every lookup afterwards is synchronous. The item half now does the same thing, key for key
 *      and locale for locale, with `strings/items-<locale>.mjs`.
 *
 *   2. THE IDENTITY SPINE — id, difficulty and canonical answer for all 1152 committed items —
 *      existed so `app/src/boot/62-learning.js` could recompute `bankAuditFingerprint` at runtime
 *      and decide whether `bank-audit.json` still prices the content we ship. That is a comparison
 *      against a value that is FULLY DETERMINED AT BUILD TIME, so the build now computes it and
 *      exports the eight-character scalar instead of the data it is computed from.
 *
 * THE FINGERPRINT SCALAR, and the hole it must not open.
 *
 * `bankAuditFingerprint` folds two things together: audit constants that live in
 * `app/src/learn/Mastery.js` plus the graph's identifiability caps, and then the bank. If the
 * build baked the scalar and a later edit changed one of those CONSTANTS, a stale scalar would
 * agree with a stale table and the engine would score on a price that no longer describes it —
 * which is the exact defect the fingerprint exists to catch, reintroduced one level up.
 *
 * So the build exports the scalar AND `BANK_FINGERPRINT_BASIS`, the constants it folded in, as a
 * plain string. `62-learning.js` recomputes that basis from the LIVE constants and the LIVE graph
 * on every page load — it is a dozen numbers, not a catalogue — and only trusts the scalar when
 * the two agree. When they do not, it pulls `spine.mjs` and computes the fingerprint the old way:
 * slower, loud, and correct. The bank half is covered by the fact that this file writes the scalar
 * and the groups in the same pass from the same `bankFiles`, and `review/measure/P31.mjs` D1
 * recomputes the whole fingerprint from `bank/*.json` and fails if it differs by one character.
 *
 * `BANK` itself is still exported and still eager IN NODE, where there is no bandwidth to save and
 * `tools/bank-audit.mjs`, `review/measure/P16.mjs` and four critic scripts read it synchronously.
 * In the browser it is `null` and the spine chunk is never requested.
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
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/**
 * The audit half of `app/src/learn/Mastery.js`, loaded once at module init so `writeSplitIndex`
 * can stay SYNCHRONOUS — `build-catalogue.mjs` (P17's tool) calls it that way and reads its return
 * value directly, and turning that call into a promise would print `{}` in somebody else's build
 * log for no gain.
 *
 * Guarded, because a content build must not fail because an app module moved. When it is missing
 * the barrel exports a null fingerprint and the app does exactly what it did before this change:
 * pull `spine.mjs` and compute the fingerprint live. Slower, never wrong, and `review/measure/P31.mjs`
 * E3 fails loudly so nobody ships that state by accident.
 */
let MASTERY = null;
try {
  MASTERY = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Mastery.js")).href);
} catch (err) {
  console.warn(`build-index: Mastery.js unavailable (${err.message}); the bank fingerprint will be computed at runtime.`);
}

/** A lesson is capped at this many minutes of scored-item time (`estMinutes` in the graph). */
export const LESSON_MINUTES = 25;

/** The locales `content/items/strings.json` carries. One chunk each; a learner pulls one. */
export const SHIPPED_LOCALES = ["en", "es", "pl"];

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

/** The decode the shipped barrel performs, run here so the build fingerprints the SAME objects. */
function decodeSpine(spine) {
  return spine.split("\u0000").map((block) => {
    const lines = block.split("\n");
    const items = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const t1 = line.indexOf("\t");
      const t2 = line.indexOf("\t", t1 + 1);
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
}

/**
 * The fingerprint, and the constants it was folded over, computed at build time.
 *
 * Imported dynamically and guarded: `build-catalogue.mjs` (P17's tool) calls into this file, and a
 * content build must not fail because an app module moved. When it cannot be computed the barrel
 * exports `null`, and `62-learning.js` then does exactly what it did before this change — pull the
 * spine and compute it live. Slower, never wrong.
 */
function buildFingerprint(bankFiles, kg) {
  if (!MASTERY) return { fingerprint: null, version: null, basis: null };
  const M = MASTERY;
  return {
    fingerprint: M.bankAuditFingerprint({ bankFiles, model: kg.model }),
    version: M.BANK_AUDIT_VERSION,
    basis: BASIS_FN({
      version: M.BANK_AUDIT_VERSION,
      perCell: M.BANK_AUDIT_PER_CELL,
      window: M.BANK_AUDIT_WINDOW,
      candidates: M.EXECUTED_CANDIDATES,
      sampleCap: M.EXECUTED_SAMPLE_CAP,
      forms: M.EXECUTED_FORMS,
      caps: kg.model?.bkt?.identifiabilityCaps ?? {},
    }),
  };
}

/**
 * The basis key, as SOURCE, so the build and the shipped barrel run the same function rather than
 * two implementations that agree until one of them is edited. `writeSplitIndex` inlines this text
 * into `index.mjs`; the build evaluates it here. `review/measure/P31.mjs` E4 recomputes the key
 * through the SHIPPED copy and fails if it does not reproduce the constant the build wrote, which
 * is what makes the two-copies arrangement checkable rather than hopeful.
 *
 * It hashes rather than concatenates because one of the identifiability caps is a 900-character
 * prose note, and shipping 900 characters of documentation to every learner to compare eight
 * characters of fingerprint would be exactly the kind of thing this piece exists to stop.
 */
const BASIS_SOURCE = `export function bankFingerprintBasis({ version, perCell, window, candidates, sampleCap, forms, caps }) {
  const parts = [
    "v" + version,
    perCell,
    window,
    candidates,
    sampleCap,
    (forms || []).join(","),
    ...Object.keys(caps || {}).sort().map((k) => k + "=" + caps[k]),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i += 1) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}`;
const BASIS_FN = new Function(`${BASIS_SOURCE.replace(/^export /, "")}; return bankFingerprintBasis;`)();

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

  /* ---------------------------------------------------------------- one locale per chunk */

  const stringsDir = path.join(HERE, "strings");
  fs.rmSync(stringsDir, { recursive: true, force: true });
  fs.mkdirSync(stringsDir, { recursive: true });

  const localeBytes = {};
  for (const locale of SHIPPED_LOCALES) {
    // The SAME key order as strings.json, in every locale, so reassembling the three tables in
    // Node reproduces `strings.json` key for key — which is what P17's C-claim compares against.
    const table = {};
    for (const [key, entry] of Object.entries(strings)) {
      if (typeof entry[locale] !== "string") {
        throw new Error(`content/items/strings.json: key "${key}" has no "${locale}" string`);
      }
      table[key] = entry[locale];
    }
    const body = `/* GENERATED by content/items/build-index.mjs — do not hand-edit.
 *
 * ONE LOCALE of the item text. A learner reads exactly one of these and the other two are never
 * requested — the same split, for the same reason, as content/locales/<locale>.json is for the UI.
 */
export default ${JSON.stringify(table)};
`;
    fs.writeFileSync(path.join(stringsDir, `items-${locale}.mjs`), body);
    localeBytes[locale] = { raw: body.length, gzip: gzBytes(body) };
  }

  const spine = spineBlocks.join("\u0000");
  const spineBody = `/* GENERATED by content/items/build-index.mjs — do not hand-edit.
 *
 * The identity spine: id, difficulty and canonical answer for every committed item, in the
 * committed order. \`index.mjs\` decodes it into the round-1 \`BANK\` shape.
 *
 * LAZY ON PURPOSE. The only thing the running game ever did with it was recompute
 * \`bankAuditFingerprint\`, and \`index.mjs\` now exports that value as an eight-character scalar
 * computed at build time. This chunk is pulled only when the live audit constants no longer match
 * the ones the scalar was computed over — i.e. only when the answer would actually be different.
 */
export const SPINE = ${JSON.stringify(spine)};
export default SPINE;
`;
  fs.writeFileSync(path.join(HERE, "spine.mjs"), spineBody);

  const fp = buildFingerprint(decodeSpine(spine), kg);

  const barrel = `/**
 * index.mjs — the EAGER half of the shipped item bank.
 *
 * GENERATED by content/items/build-index.mjs — do not hand-edit.
 *
 * NOTHING WITH A PER-ITEM OR PER-LOCALE COST IS IN HERE. What a page load pays for, in full: the
 * manifest (lessons and per-knowledge-point meta, no items), three loader tables, and one
 * eight-character fingerprint. Everything with a size is behind an \`import()\`:
 *
 *   groups/<kpId>.mjs        the items, one chunk per knowledge point, pulled per lesson.
 *   strings/items-<l>.mjs    the item text, one chunk per locale, one pulled per learner.
 *   spine.mjs                the identity spine, pulled only when the fingerprint basis moved.
 *
 * In NODE all of it is pulled eagerly at module init — \`tools/bank-audit.mjs\`,
 * \`review/measure/P16.mjs\`, \`review/measure/P17.mjs\` and four critic scripts read \`BANK\` and
 * \`STRINGS\` synchronously, there is no bandwidth to save offline, and a DELIVERY decision must not
 * change a single measured value. In the BROWSER both are \`null\` and neither chunk is requested:
 * \`ItemBank\` reaches the locale table through \`STRING_LOADERS\`, and nothing in the running game
 * reads the spine at all.
 *
 * \`form\` and \`family\` are slices of the id, which is \`\${family}/\${form}/\${hash}\` by construction.
 */
export const LOCALES = ${JSON.stringify(SHIPPED_LOCALES)};

export { MANIFEST, LESSONS, KP_META } from "./manifest.mjs";
export { GROUP_IDS, GROUP_LOADERS } from "./groups/index.mjs";

import { MANIFEST as _M } from "./manifest.mjs";
/** The build-time index, kept under its round-1 name because P17's stats surface reads it. */
export const BANK_INDEX = _M;

/**
 * One static specifier per locale, for the same reason \`groups/index.mjs\` has one per knowledge
 * point: a computed specifier is either left alone by the bundler and 404s in production, or swept
 * into a glob that pulls all three languages back into one chunk.
 */
export const STRING_LOADERS = {
${SHIPPED_LOCALES.map((l) => `  ${JSON.stringify(l)}: () => import(${JSON.stringify(`./strings/items-${l}.mjs`)}),`).join("\n")}
};

/** One locale's item text as \`{ key: string }\`. \`null\` for a locale we do not ship. */
export async function loadItemStrings(locale) {
  const loader = STRING_LOADERS[locale];
  if (!loader) return null;
  const mod = await loader();
  return mod.default ?? mod;
}

/**
 * \`bankAuditFingerprint({ bankFiles: BANK, model })\`, computed at BUILD time over the spine.
 *
 * \`BANK_FINGERPRINT_BASIS\` keys the audit constants that value was folded over — the Mastery audit
 * version and its sampling constants, plus the graph's identifiability caps.
 * \`app/src/boot/62-learning.js\` recomputes the key from the LIVE constants on every page load and
 * only trusts the scalar when the two agree, so a constant that changed without a rebuild falls
 * back to the spine instead of silently validating a stale price table.
 */
export const BANK_FINGERPRINT = ${JSON.stringify(fp.fingerprint)};
export const BANK_FINGERPRINT_BASIS = ${JSON.stringify(fp.basis)};
export const BANK_AUDIT_VERSION_AT_BUILD = ${JSON.stringify(fp.version)};

${BASIS_SOURCE}

/** Decode the spine. 1152 items, one pass, no allocation beyond the objects themselves. */
export function decodeSpine(spine) {
  return spine.split("\\u0000").map((block) => {
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
}

/** The round-1 \`BANK\` shape, pulled on demand. The stale-audit branch is the only caller. */
export async function loadBankSpine() {
  const mod = await import("./spine.mjs");
  return decodeSpine(mod.SPINE ?? mod.default);
}

const IS_NODE =
  typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";

/** Every locale of every key, \`{ key: { en, es, pl } }\` — the round-1 shape. NODE ONLY. */
async function assembleStrings() {
  const tables = await Promise.all(LOCALES.map((l) => loadItemStrings(l)));
  const out = {};
  LOCALES.forEach((locale, i) => {
    for (const [key, text] of Object.entries(tables[i])) (out[key] ??= {})[locale] = text;
  });
  return out;
}

export const BANK = IS_NODE ? await loadBankSpine() : null;
export const STRINGS = IS_NODE ? await assembleStrings() : null;
`;
  fs.writeFileSync(path.join(HERE, "index.mjs"), barrel);

  return {
    groups: ids.length,
    lessons: lessons.length,
    fingerprint: fp,
    spine: { raw: spineBody.length, gzip: gzBytes(spineBody) },
    strings: { raw: JSON.stringify(strings).length, gzip: gzBytes(JSON.stringify(strings)) },
    localeBytes,
    barrel: { raw: barrel.length, gzip: gzBytes(barrel) },
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
        fingerprint: out.fingerprint,
        eager: { barrel: out.barrel, manifest: out.manifest },
        lazy: { spine: out.spine, locales: out.localeBytes, groupsTotal: totalGroup },
      },
      null,
      2
    )
  );
}
