#!/usr/bin/env node
// Find code that exists and is reached by nothing.
//
// This project's dominant defect is not incorrect work — it is DISCONNECTED work. Six separate
// critics found six separate pieces that were built well, measured well, and wired to nothing:
// a 49 KB material factory imported only by one file, a per-lesson loader with no caller on the
// gameplay path, a guess guard the shipped path never fed, a leverage ranking ignored 44% of the
// time. Each was invisible in isolation because each piece's own tests passed.
//
// That is a predictable consequence of how the codebase is organised: one file per feature, glob
// registration, no shared edits, and a rule that feature modules must never import one another.
// Excellent for building twelve things in parallel; excellent at producing twelve things that never
// touch. This makes the seams countable.
//
//   node tools/seams.mjs            report every export with no importer
//   node tools/seams.mjs --signals  also audit signal names emitted with no listener, and vice versa
//   node tools/seams.mjs --check    exit non-zero if anything is unreached (for gates)
//
// `--signals` exits non-zero on its own for ONE class of finding: a one-ended signal name that
// `design/architecture.md` does not document, or documents without a ⟨pending Pnn⟩ marker. See
// `vocabulary()` below for why that check is machine-run and not a review habit.
//
// Static analysis only — deliberately. A runtime trace proves a path ran on ONE playthrough; this
// proves nobody ever wrote the call at all, which is the failure actually being made here.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "app/src");
const has = (f) => process.argv.slice(2).includes(`--${f}`);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

const files = walk(SRC);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const source = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

// ---------------------------------------------------------------- exports and imports

const EXPORT_RE =
  /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{([^}]+)\}/gm;
const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s*["']([^"']+)["']/g;

const exportsBy = new Map(); // file -> Set(name)
for (const [f, src] of source) {
  const set = new Set();
  for (const m of src.matchAll(EXPORT_RE)) set.add(m[1]);
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    for (const piece of m[1].split(",")) {
      const name = piece.split(/\s+as\s+/).pop().trim();
      if (name) set.add(name);
    }
  }
  if (/export\s+default/.test(src)) set.add("default");
  exportsBy.set(f, set);
}

const importedNames = new Map(); // resolved file -> Set(name)
const importerCount = new Map(); // resolved file -> Set(importing file)

for (const [f, src] of source) {
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[5];
    if (!spec.startsWith(".")) continue;
    let target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) {
      if (fs.existsSync(target + ".js")) target += ".js";
      else if (fs.existsSync(path.join(target, "index.js"))) target = path.join(target, "index.js");
      else continue;
    }
    if (!importerCount.has(target)) importerCount.set(target, new Set());
    importerCount.get(target).add(f);

    if (!importedNames.has(target)) importedNames.set(target, new Set());
    const bag = importedNames.get(target);
    if (m[1]) bag.add("default");
    if (m[4]) bag.add("default");
    if (m[3]) bag.add("*");
    if (m[2]) {
      for (const piece of m[2].split(",")) {
        const name = piece.split(/\s+as\s+/)[0].trim();
        if (name) bag.add(name);
      }
    }
  }
}

// A boot module is reached by main.js's directory glob, not by an import statement.
const isBoot = (f) => rel(f).includes("app/src/boot/");

const deadFiles = [];
const deadExports = [];

for (const [f, names] of exportsBy) {
  if (isBoot(f)) continue;
  if (rel(f).endsWith("app/src/main.js")) continue;

  const importers = importerCount.get(f);
  if (!importers || importers.size === 0) {
    if (names.size) deadFiles.push({ file: rel(f), exports: [...names] });
    continue;
  }
  const used = importedNames.get(f) ?? new Set();
  if (used.has("*")) continue;
  const unused = [...names].filter((n) => !used.has(n));
  if (unused.length) {
    deadExports.push({
      file: rel(f),
      importedBy: importers.size,
      neverImported: unused,
    });
  }
}

// ---------------------------------------------------------------- signals

/**
 * Round 1 of this audit reported `camera:shake`, `camera:target` and `input:look` as emitted into
 * the void. All three had a live subscriber, and P36 proved it by driving the shipped app: the
 * camera really shakes, really follows the body, really turns with the mouse. The audit had missed
 * them because both `play/CameraRig.js` and `world/Lighting.js` register through a one-line alias —
 *
 *     const on = (name, fn) => this._off.push(signals.on(name, fn));
 *
 * — so the call site reads `on("camera:shake", ...)`, with no receiver for `/\.on\(/` to match.
 * Three of the eighteen headline orphans were the tool's own blind spot, which is the worst thing a
 * gate can be: confidently wrong in the direction of extra work. The receiver is now optional, which
 * also picks up the injected `this.emit(...)` used by `flow/Session.js` and `learn/Mastery.js`.
 *
 * Making the receiver optional would match unrelated event APIs (`server.on("error")`,
 * `page.on("console")`), so a name must look like a signal: this project's vocabulary is
 * `domain:event` throughout and `design/architecture.md` is written that way. Requiring the colon
 * costs nothing real and removes the whole class.
 *
 * Sites are reported with file:line. The previous shape gave a bare list of names, and every agent
 * reading it burned its first tool call re-deriving where they were.
 */
const EMIT_SITE_RE = /(?<![\w$])(?:[\w$]+\s*\.\s*)?emit\(\s*["'`]([^"'`]+)["'`]/g;
const LISTEN_SITE_RE = /(?<![\w$])(?:[\w$]+\s*\.\s*)?on\(\s*["'`]([^"'`]+)["'`]/g;
const SIGNAL_NAME_RE = /^[a-z][\w-]*:[\w:-]+$/;

/**
 * The signal vocabulary as `design/architecture.md` states it: name -> was it marked ⟨…⟩.
 *
 * ## Why this is a machine check and not a review habit
 *
 * The round that introduced the ⟨pending Pnn⟩ convention wrote the rule down — "an unmarked
 * one-ended name is a defect, and the audit is entitled to say so" — and in the same edit shipped
 * `world:resonance`: subscribed by `world/Lighting.js`, emitted by nothing, absent from the
 * document, and holding the entire accent-light feature dark. The name was sitting in this tool's
 * own `listenedWithNoEmitter` output at the time. A convention that depends on somebody reading
 * their own audit output to the end lasts exactly as long as attention does.
 *
 * ## What counts as documented
 *
 * Only **entry blocks** — a paragraph whose first line is a bold one-word domain followed by an em
 * dash (`**Camera** — …`). The prose paragraphs between entries discuss the same names in backticks
 * while explaining them, and counting those would let an undocumented name pass because somebody
 * wrote a sentence about it. Within a block, entries are separated by `·`, so a marker binds to the
 * name it follows, and a name is the leading `domain:event` token inside a backtick span — the rest
 * of the span is the payload shape, which may itself contain colons (`phase:"start"`).
 *
 * ## And what counts as a MARKER
 *
 * Not "any ⟨…⟩". `kernel:frame` and `kernel:resize` carried ⟨no subscriber⟩, which passed this gate
 * while restating the finding and naming nobody: an unsubscribed broadcast that nobody owes the
 * other half of is a different thing from a hole with an owner, and the document has to say which.
 * So a marker must be one of exactly two shapes:
 *
 *   ⟨pending Pnn⟩            a hole. Names at least one piece that owes the other end.
 *   ⟨broadcast — no owner⟩   deliberate. Nobody owes anything; the name exists for code outside the
 *                            hook table, and an audit finding it still unsubscribed should delete it.
 *
 * Anything else in angle brackets is treated as unmarked, and says so by name.
 */
const MARKER_RE = /⟨([^⟩]*)⟩/g;
const PENDING_RE = /pending\s+P\d/i;
const BROADCAST_RE = /broadcast/i;
const DOC = path.join(ROOT, "design/architecture.md");

function vocabulary() {
  if (!fs.existsSync(DOC)) return null;
  const text = fs.readFileSync(DOC, "utf8");
  const start = text.indexOf("## Signal vocabulary");
  if (start < 0) return null;
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end < 0 ? text.length : end);

  const entries = new Map();
  for (const block of section.split(/\r?\n\s*\r?\n/)) {
    const first = block.split(/\r?\n/)[0];
    if (!/^\*\*[A-Z][A-Za-z]*\*\*[^—\n]*—/.test(first)) continue;
    for (const chunk of block.replace(/\r?\n/g, " ").split("·")) {
      const markers = [...chunk.matchAll(MARKER_RE)].map((m) => m[1]);
      const kind = markers.some((m) => PENDING_RE.test(m))
        ? "pending"
        : markers.some((m) => BROADCAST_RE.test(m))
          ? "broadcast"
          : markers.length
            ? "unrecognised"
            : null;
      for (const span of chunk.matchAll(/`([^`]+)`/g)) {
        const name = span[1].match(/^([a-z][\w-]*:[\w:-]+)/)?.[1];
        if (!name || !SIGNAL_NAME_RE.test(name)) continue;
        const was = entries.get(name);
        entries.set(name, {
          kind: kind ?? was?.kind ?? null,
          marker: markers[0] ?? was?.marker ?? null,
          marked: kind === "pending" || kind === "broadcast" || was?.marked === true,
        });
      }
    }
  }
  return entries;
}

/**
 * The other half of the gate: `review/measure/seam-effects.json`.
 *
 * The vocabulary check above is about names with ONE end. Nothing re-examines a name once it has
 * two, which is precisely how P36 round 2 passed: `world:resonance` emitted, heard, lighting four
 * real `PointLight`s, and worth exactly 0 of 518,400 pixels because every one of them hung in clear
 * air. A tool that measures string pairing will call that closed forever.
 *
 * So a name that was one-ended when this wave opened and is two-ended now has to carry a record of
 * what closing it was worth, measured the only way that resolves a single code value: halt the
 * realtime loop, render twice at `advance(0)`, diff the drawing buffer with the thing under test
 * present and absent. The ledger's own header states the rules for each `kind`; this validates them.
 *
 * `owed` is deliberately allowed and deliberately loud. Pieces close seams mid-wave and pricing one
 * costs a browser run; a record naming the owner is the same bargain the vocabulary makes with
 * ⟨pending Pnn⟩, and it means no piece can quietly benefit from another piece's unpriced closure.
 */
const LEDGER = path.join(ROOT, "review/measure/seam-effects.json");

function effects(emits, listens) {
  if (!fs.existsSync(LEDGER)) {
    return { read: false, why: `${rel(LEDGER)} is missing; every closed seam is unpriced` };
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch (e) {
    return { read: false, why: `${rel(LEDGER)} is not valid JSON: ${e.message}` };
  }
  const baseline = doc.baseline?.oneEnded ?? [];
  const rows = doc.effects ?? {};
  const closed = baseline.filter((n) => emits.has(n) && listens.has(n)).sort();
  const priced = [];
  const owed = [];
  const invalid = [];
  const missing = [];
  for (const name of closed) {
    const e = rows[name];
    if (!e) {
      missing.push(name);
      continue;
    }
    const bad = (why) => invalid.push(`${name} — ${why}`);
    const fileHere = (p) => p && fs.existsSync(path.join(ROOT, p));
    switch (e.kind) {
      case "pixels":
      case "state":
        if (!fileHere(e.script)) bad(`kind "${e.kind}" with no runnable script (${e.script ?? "none"})`);
        else if (e.control !== 0) bad(`control is ${e.control}, not 0 — the instrument cannot resolve one code value`);
        else if (!(Number(e.treatment) > 0)) bad(`treatment is ${e.treatment}; a closed seam worth nothing observable is not closed`);
        else priced.push(`${name} — ${e.kind} ${e.control} → ${e.treatment} (${e.closedBy ?? "?"})`);
        break;
      case "hygiene":
        if (!e.identical) bad(`kind "hygiene" must say what the two paths measured identically`);
        else priced.push(`${name} — hygiene, no behavioural difference (${e.closedBy ?? "?"})`);
        break;
      case "blindspot":
        if (!e.listenerAt) bad(`kind "blindspot" must give the listener's file:line`);
        else priced.push(`${name} — never one-ended; listener at ${e.listenerAt}`);
        break;
      case "owed":
        if (!e.owner) bad(`kind "owed" must name the piece that owes the measurement`);
        else owed.push(`${name} — owed by ${e.owner}`);
        break;
      default:
        bad(`unknown kind "${e.kind ?? "none"}"`);
    }
  }
  return { read: rel(LEDGER), closedSinceBaseline: closed.length, priced, owed, invalid, missing };
}

let signalReport = null;
if (has("signals")) {
  const emits = new Map();
  const listens = new Map();
  const add = (map, name, f, line) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(`${rel(f)}:${line}`);
  };
  for (const [f, src] of source) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(EMIT_SITE_RE)) {
        if (SIGNAL_NAME_RE.test(m[1])) add(emits, m[1], f, i + 1);
      }
      for (const m of lines[i].matchAll(LISTEN_SITE_RE)) {
        if (SIGNAL_NAME_RE.test(m[1])) add(listens, m[1], f, i + 1);
      }
    }
  }
  // Sorted by file then by line NUMBER — a lexical sort puts 1031 above 651 and reads as noise.
  const lineOf = (s) => Number(s.slice(s.lastIndexOf(":") + 1));
  const fileOf = (s) => s.slice(0, s.lastIndexOf(":"));
  const sites = (map, name) =>
    [...(map.get(name) ?? [])].sort(
      (a, b) => fileOf(a).localeCompare(fileOf(b)) || lineOf(a) - lineOf(b)
    );
  const orphanEmits = [...emits.keys()].filter((n) => !listens.has(n)).sort();
  const orphanListens = [...listens.keys()].filter((n) => !emits.has(n)).sort();
  signalReport = {
    // Kept as plain sorted name lists: earlier rounds saved these as snapshots to diff against,
    // and a gate whose output shape moves under its callers is a gate nobody re-runs.
    emittedWithNoListener: orphanEmits,
    listenedWithNoEmitter: orphanListens,
    // Where each orphan lives, so the next agent's first tool call is a fix and not a grep.
    orphanSites: Object.fromEntries([
      ...orphanEmits.map((n) => [n, { emittedAt: sites(emits, n) }]),
      ...orphanListens.map((n) => [n, { listenedAt: sites(listens, n) }]),
    ]),
  };

  // ------------------------------------------------------------ the vocabulary gate
  const vocab = vocabulary();
  const orphans = [...orphanEmits, ...orphanListens];
  if (!vocab) {
    signalReport.vocabulary = { read: false, why: `${rel(DOC)} has no "## Signal vocabulary" section` };
  } else {
    const undocumented = orphans.filter((n) => !vocab.has(n)).sort();
    const unmarked = orphans.filter((n) => vocab.has(n) && !vocab.get(n).marked).sort();
    const allNames = [...new Set([...emits.keys(), ...listens.keys()])].sort();
    signalReport.vocabulary = {
      read: rel(DOC),
      documented: vocab.size,
      // FATAL. A one-ended name the document does not carry is an accident nobody owns; a
      // one-ended name it carries without ⟨…⟩ is a claim that both ends exist, and it is false.
      undocumented,
      unmarked,
      // Informational. A name whose other end has since been written but which still reads as a
      // known hole — the document is now describing a seam that was closed.
      staleMarkers: [...vocab.keys()]
        .filter((n) => vocab.get(n).marked && emits.has(n) && listens.has(n))
        .sort(),
      // Informational. Two-ended names nobody added to the vocabulary. Not a seam, but the
      // document is the only place the shape of a payload is written down.
      notInVocabulary: allNames.filter((n) => !vocab.has(n)),
      // A marker the gate does not recognise is worse than none: it reads as an owner and names
      // nobody. Reported separately so the fix is obvious.
      unrecognisedMarkers: [...vocab.keys()].filter((n) => vocab.get(n).kind === "unrecognised"),
      // What each failing entry actually says in angle brackets, so the FAIL line can quote it back
      // instead of asserting there is no marker when there plainly is one.
      markerText: Object.fromEntries(unmarked.map((n) => [n, vocab.get(n).marker ?? null])),
    };
  }

  signalReport.effects = effects(emits, listens);
}

// ---------------------------------------------------------------- report

const report = {
  scanned: files.length,
  filesImportedByNothing: deadFiles.sort((a, b) => b.exports.length - a.exports.length),
  exportsNeverImported: deadExports.sort((a, b) => b.neverImported.length - a.neverImported.length),
  ...(signalReport ? { signals: signalReport } : {}),
};

console.log(JSON.stringify(report, null, 2));

const problems =
  report.filesImportedByNothing.length +
  report.exportsNeverImported.length +
  (signalReport?.emittedWithNoListener.length ?? 0) +
  (signalReport?.listenedWithNoEmitter.length ?? 0);

console.error(
  `\n${report.filesImportedByNothing.length} file(s) imported by nothing, ` +
    `${report.exportsNeverImported.length} file(s) with never-imported exports` +
    (signalReport
      ? `, ${signalReport.emittedWithNoListener.length} signal(s) with no listener, ` +
        `${signalReport.listenedWithNoEmitter.length} listener(s) with no emitter`
      : "")
);
console.error(
  "A file imported by nothing is not necessarily dead — it may be reached by the boot glob or be a\n" +
    "genuine leaf. But every entry here is a seam somebody has to justify out loud."
);

const v = signalReport?.vocabulary;
const undeclared = (v?.undocumented?.length ?? 0) + (v?.unmarked?.length ?? 0);
if (undeclared) {
  console.error(`\nFAIL — ${undeclared} one-ended signal name(s) the vocabulary does not own:`);
  for (const n of v.undocumented) {
    console.error(`  ${n}  — absent from design/architecture.md's signal vocabulary entirely`);
  }
  for (const n of v.unmarked) {
    const marker = v.markerText?.[n];
    console.error(
      marker
        ? `  ${n}  — marked ⟨${marker}⟩, which names no owner and is not ⟨broadcast — no owner⟩ either`
        : `  ${n}  — listed there with no marker at all, so the document claims both ends exist`
    );
  }
  console.error(
    "Do one of these to each: WIRE the other end, REMOVE the name from code and document, mark it\n" +
      "⟨pending Pnn⟩ naming the piece that owes the other half, or — only if nobody ever will —\n" +
      "⟨broadcast — no owner⟩."
  );
}

const fx = signalReport?.effects;
const unpriced = (fx?.missing?.length ?? 0) + (fx?.invalid?.length ?? 0) + (fx?.read === false ? 1 : 0);
if (fx) {
  if (fx.read === false) console.error(`\nFAIL — ${fx.why}`);
  if (fx.missing?.length) {
    console.error(
      `\nFAIL — ${fx.missing.length} seam(s) closed during this wave with no measured effect on record:`
    );
    for (const n of fx.missing) console.error(`  ${n}  — add an entry to review/measure/seam-effects.json`);
    console.error(
      "String pairing is not closure. Drive the shipped app, halt the loop, render twice at\n" +
        "advance(0), and record control vs treatment — or record it `owed` with your piece's name on it."
    );
  }
  for (const n of fx.invalid ?? []) console.error(`FAIL — ${n}`);
  if (fx.owed?.length) {
    console.error(`\n${fx.owed.length} closed seam(s) still unpriced, by declaration:`);
    for (const n of fx.owed) console.error(`  ${n}`);
  }
  if (fx.priced?.length) {
    console.error(`\n${fx.priced.length} closed seam(s) with an effect on record:`);
    for (const n of fx.priced) console.error(`  ${n}`);
  }
}

if (undeclared || unpriced || (has("check") && problems > 0)) process.exit(1);
