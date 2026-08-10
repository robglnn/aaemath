#!/usr/bin/env node
/**
 * Diagnostic for a PRE-EXISTING P16 failure found while closing P34, not a proof of P34.
 *
 * `review/measure/P16.mjs` U16 ("snapshot -> restore reproduces the probe byte for byte") fails on the
 * current tree, while U17 (determinism over `snapshot()`) and U18 (localStorage round trip) both pass.
 * That pattern says the divergence is in a field `probe()` publishes and `snapshot()` does not carry.
 * This names the field, so whoever owns P16/P32 does not have to re-derive it.
 *
 *   node review/measure/_p34-u16-diag.mjs
 */
import graphSource from "../../content/knowledge-graph.json" with { type: "json" };
import bankAudit from "../../app/src/learn/bank-audit.json" with { type: "json" };
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";

const graph = new Graph(graphSource);
const mk = () => new Mastery(graph, { bankAudit, now: () => 0, emit: () => {}, storage: null });

const a = mk();
// A cell that holds a refused family, answered by a presenter that did not report which family it
// served — the round-2 delivery shape. This is what populates `deliveryDefects`.
a.declareFamilyReporting(false, "diagnostic-no-reporter");
a.respond({ kpId: "expr-anatomy", form: "construct", phase: "solo", mode: "acquire", correct: true, latencyMs: 5000, difficulty: 1 });

const snap = JSON.parse(JSON.stringify(a.snapshot()));
const b = mk();
b.restore(snap);

const pa = a.probe();
const pb = b.probe();
const differ = [];
const walk = (x, y, path) => {
  const sx = JSON.stringify(x);
  const sy = JSON.stringify(y);
  if (sx === sy) return;
  if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
    return;
  }
  differ.push({ path, a: sx?.slice(0, 90) ?? "undefined", b: sy?.slice(0, 90) ?? "undefined" });
};
walk(pa, pb, "");

console.log(`probe fields that differ across snapshot -> restore: ${differ.length}`);
for (const d of differ) console.log(`  ${d.path}\n     live    ${d.a}\n     restored ${d.b}`);
console.log("");
console.log(`snapshot() carries "deliveryDefects": ${Object.keys(a.snapshot()).includes("deliveryDefects")}`);
console.log(`probe()    publishes delivery.defects: ${Array.isArray(pa.delivery?.defects)} (live ${pa.delivery?.defects?.length}, restored ${pb.delivery?.defects?.length})`);
