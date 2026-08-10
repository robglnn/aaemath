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

let signalReport = null;
if (has("signals")) {
  const emits = new Map();
  const listens = new Map();
  const add = (map, name, f) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(rel(f));
  };
  for (const [f, src] of source) {
    for (const m of src.matchAll(/\.emit\(\s*["'`]([^"'`]+)["'`]/g)) add(emits, m[1], f);
    for (const m of src.matchAll(/\.on\(\s*["'`]([^"'`]+)["'`]/g)) add(listens, m[1], f);
  }
  signalReport = {
    emittedWithNoListener: [...emits.keys()].filter((n) => !listens.has(n)).sort(),
    listenedWithNoEmitter: [...listens.keys()].filter((n) => !emits.has(n)).sort(),
  };
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

if (has("check") && problems > 0) process.exit(1);
