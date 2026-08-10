// Adversarial propagation: can any answer sequence hand credit to a NON-ancestor,
// or lift any node to M1/unlock/mastery it did not earn?
import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);

function anc(id) { return new Set([...g.ancestorDistances(id).keys()]); }

// ---- 1. honest sweep: every node, 400 correct answers, record who moved
let violations = [], overCeiling = [], crossedM1 = [];
for (const id of g.ids) {
  const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0, priceUnreportedFamilies: true });
  const before = Object.fromEntries(g.ids.map((x) => [x, m.p(x)]));
  const A = anc(id);
  for (let i = 0; i < 400; i++) {
    for (const f of ["construct", "repair", "generate"]) {
      m.respond({ kpId: id, form: f, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: g.centre(id) });
    }
  }
  for (const x of g.ids) {
    if (x === id) continue;
    if (Math.abs(m.p(x) - before[x]) > 1e-12) {
      if (!A.has(x)) violations.push(`${id} -> ${x} (NOT an ancestor) delta ${(m.p(x)-before[x]).toFixed(4)}`);
      if (m.p(x) > 0.9 + 1e-9) overCeiling.push(`${id} -> ${x} p=${m.p(x).toFixed(4)}`);
      if (m.p(x) >= m.M.bkt.masteryThreshold) crossedM1.push(`${id} -> ${x} p=${m.p(x).toFixed(4)}`);
    }
    if (m.status(x) !== "learning" && x !== id) violations.push(`${id} -> ${x} STATUS ${m.status(x)}`);
  }
}
console.log("honest sweep: non-ancestor credits:", violations.length, "over ceiling:", overCeiling.length, "crossed M1:", crossedM1.length);
violations.slice(0,5).forEach((v)=>console.log("  ",v));

// ---- 2. HOSTILE: a caller declares exercises: [descendant] (the case the code comments say is impossible)
const m2 = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0, priceUnreportedFamilies: true });
const src = "var-meaning";               // band 1 leaf-most node
const target = "eq-two-step";            // a DESCENDANT of var-meaning, far downstream
const A2 = anc(src);
console.log("\nis", target, "an ancestor of", src, "?", A2.has(target));
const p0 = m2.p(target);
for (let i = 0; i < 600; i++) {
  m2.respond({ kpId: src, form: "construct", phase: "solo", mode: "acquire", correct: true, latencyMs: 9000,
               difficulty: g.centre(src), exercises: [target] });
}
console.log(`exercises:[${target}] on ${src}: p ${p0.toFixed(3)} -> ${m2.p(target).toFixed(4)} status=${m2.status(target)} scored=${m2.stateOf(target).scored} forms=${[...m2.stateOf(target).forms].join("/")}`);
console.log("credits by distance:", JSON.stringify(m2.stats.creditsByDistance));

// ---- 3. HOSTILE: declare EVERY node as exercised, from the easiest node
const m3 = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0, priceUnreportedFamilies: true });
for (let i = 0; i < 800; i++) {
  m3.respond({ kpId: src, form: "generate", phase: "solo", mode: "acquire", correct: true, latencyMs: 9000,
               difficulty: g.centre(src), exercises: g.ids.filter((x) => x !== src) });
}
const lifted = g.ids.filter((x) => x !== src && m3.p(x) > 0.5);
const gated = g.ids.filter((x) => x !== src && m3.gateReached(x));
console.log(`\nexercises:[ALL 31 nodes] x800: nodes lifted over 0.5 = ${lifted.length}; max p = ${Math.max(...g.ids.filter(x=>x!==src).map(x=>m3.p(x))).toFixed(4)}; gateReached elsewhere = ${gated.length}; mastered elsewhere = ${g.ids.filter(x=>x!==src&&m3.status(x)==="mastered").length}`);
const sc = g.ids.filter((x) => x !== src && (m3.stateOf(x).scored > 0 || m3.stateOf(x).atBand > 0 || m3.stateOf(x).forms.length > 0));
console.log("nodes with M2/M3 counters touched by propagation:", sc.length);
// does it unlock a test-out offer on a node whose real prerequisites are unmet?
const offers = g.ids.filter((x) => x !== src && m3.testOutOffered(x));
console.log("test-out offers created by pure propagation:", offers.length, offers.slice(0,6).join(","));
