#!/usr/bin/env node
// How every agent reports in. Writes one status file for one piece and appends to the feed,
// then regenerates the live page.
//
//   node tools/status.mjs P04 building --round=1 --note="locomotion first pass"
//   node tools/status.mjs P04 critique --round=1 --gap="landings have no weight"
//   node tools/status.mjs P04 passed   --round=3 --evidence=review/shots/p04/run.png
//
// States: todo | building | critique | revising | passed | blocked
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const [id, state] = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (!id || !state) {
  console.error("usage: node tools/status.mjs <PIECE_ID> <state> [--round=N] [--gap=...] [--note=...] [--evidence=a,b]");
  process.exit(2);
}
const allowed = ["todo", "building", "critique", "revising", "passed", "blocked"];
if (!allowed.includes(state)) {
  console.error(`state must be one of: ${allowed.join(", ")}`);
  process.exit(2);
}

const dir = path.join(ROOT, "progress/status");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${id}.json`);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

const next = {
  ...prev,
  id,
  state,
  round: Number(flag("round", prev.round ?? 0)),
  gap: flag("gap", state === "passed" ? null : prev.gap ?? null),
  note: flag("note", prev.note ?? null),
  evidence: (flag("evidence", "") || "").split(",").filter(Boolean),
  updated: new Date().toISOString(),
};
fs.writeFileSync(file, JSON.stringify(next, null, 2));

const msg = flag("gap") ? `${state} — gap: ${flag("gap")}` : flag("note") ? `${state} — ${flag("note")}` : state;
fs.appendFileSync(
  path.join(ROOT, "progress/log.jsonl"),
  JSON.stringify({ t: new Date().toISOString(), piece: id, msg }) + "\n"
);

try {
  execFileSync(process.execPath, [path.join(ROOT, "tools/progress.mjs")], { stdio: "inherit" });
} catch {
  /* page regeneration is best-effort; the status file is the source of truth */
}
