#!/usr/bin/env node
/**
 * critic-P31-break.mjs — INDEPENDENT failure injection for P31.
 *
 * P31's own C1 breaks a group with the bank's own `__faultGroup` hook, which rejects inside
 * `loadGroup` before the module system is ever asked for the chunk. That proves the catch block,
 * not the delivery. This script breaks the chunk ITSELF — the file a browser would 404 on — in a
 * copy of the tree, and drives a whole session through the real Scheduler and the real Mastery
 * engine against it.
 *
 *   node review/measure/critic-P31-break.mjs <root>
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(process.argv[2]);
const REAL = path.resolve(process.argv[3] ?? "C:/dev/math/aaemath");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;

const { ItemBank, bankIssues } = await import(u("app/src/learn/ItemBank.js"));
const { Graph } = await import(u("app/src/learn/Graph.js"));
const { Mastery } = await import(u("app/src/learn/Mastery.js"));
const { Scheduler, virtualClock, mulberry32 } = await import(u("app/src/learn/Scheduler.js"));

const kg = JSON.parse(fs.readFileSync(path.join(REAL, "content/knowledge-graph.json"), "utf8"));
const bankAudit = JSON.parse(fs.readFileSync(path.join(REAL, "app/src/learn/bank-audit.json"), "utf8"));

const issues = [];
bankIssues.onIssue = (i) => issues.push(i);

const bank = new ItemBank();
const graph = new Graph(kg);
const clock = virtualClock(0);
const mastery = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit });
const sched = new Scheduler(mastery, { clock, rng: mulberry32(31), sessionMinutes: 25 });
const rng = mulberry32(1031);

const VICTIM = "eq-two-step";

// Force the session onto the broken knowledge point: ask the bank directly, 40 times, exactly the
// way a verb would while a learner works through that node.
const rows = [];
let blanks = 0;
let threw = 0;
for (let i = 0; i < 40; i += 1) {
  let sel = null;
  try {
    sel = bank.select({ kpId: VICTIM, form: "construct", difficulty: 3, seed: i });
  } catch (err) {
    threw += 1;
  }
  if (!sel || !sel.item) {
    blanks += 1;
    continue;
  }
  const marked = bank.check(sel.item, bank.accepts(sel.item)[0]);
  rows.push({ id: sel.item.id, source: sel.source, relaxation: sel.relaxation, ok: marked.correct, kp: sel.item.kpId, std: sel.item.standards });
  await new Promise((r) => setTimeout(r, 0));
}

// And a full scheduler-driven session on the same bank, so "the game keeps running" is measured
// through the shipped scheduler rather than asserted.
sched.beginSession();
let served = 0;
let sessBlanks = 0;
let steps = 0;
for (;;) {
  steps += 1;
  if (steps > 3000) break;
  const req = sched.next();
  if (!req) break;
  const sel = bank.select({
    kpId: req.kpId,
    form: req.form,
    difficulty: req.difficulty,
    misconception: req.misconception ?? null,
    exclude: req.avoidItemIds,
  });
  if (!sel || !sel.item) {
    sessBlanks += 1;
    sched.submit(req, { correct: false, latencyMs: 20000, itemId: `blank#${steps}` });
    continue;
  }
  const right = rng() < 0.72;
  const verdict = bank.check(sel.item, right ? bank.accepts(sel.item)[0] : `${bank.accepts(sel.item)[0]}zz`);
  sched.submit(req, { correct: verdict.correct, latencyMs: 20000, itemId: sel.item.id, misconception: verdict.misconception });
  served += 1;
}
sched.endSession();

const probe = bank.probe();
const res = bank.residency();
const uniq = new Set(rows.map((r) => r.id));

console.log(
  JSON.stringify(
    {
      victim: VICTIM,
      selectCalls: 40,
      returned: rows.length,
      blanks,
      threw,
      sources: [...new Set(rows.map((r) => r.source))],
      relaxations: [...new Set(rows.map((r) => r.relaxation))],
      allMarkCorrect: rows.every((r) => r.ok),
      distinctItems: uniq.size,
      standardsTagged: rows.every((r) => Array.isArray(r.std) && r.std.length > 0),
      kpTagged: rows.every((r) => r.kp === VICTIM),
      residentGroups: res.resident.length,
      failedGroups: Object.keys(res.failed),
      failureText: Object.values(res.failed).map((f) => f.error),
      probeDegraded: probe.degraded,
      issues,
      session: { served, blanks: sessBlanks, steps },
    },
    null,
    1
  )
);
