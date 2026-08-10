/** Scratch: prototype the served-population audit sampler and print its consequences. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);

const GRAPH = new Graph(JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")));
const bank = new ItemBank();
const FORMS = ["construct", "repair", "generate"];
const WINDOW = 40;
const PER = Number(process.argv[2] ?? 128);

const t0 = Date.now();
const cells = [];
for (const kpId of GRAPH.ids) for (const form of FORMS) cells.push({ kpId, form, band: GRAPH.difficulty(kpId) });

const sample = [];
const recent = [];
const exclude = new Set();
let seq = 0;
for (let d = 0; d < PER; d += 1) {
  for (const c of cells) {
    const tier = Math.max(1, Math.min(5, c.band + ((d % 5) - 2)));
    const sel = bank.select({ kpId: c.kpId, form: c.form, difficulty: tier, seed: (seq * 2654435761 + 17) >>> 0, exclude });
    seq += 1;
    if (!sel) continue;
    sample.push({ kpId: c.kpId, form: c.form, item: sel.item, source: sel.source });
    recent.push(sel.item.id);
    exclude.add(sel.item.id);
    while (recent.length > WINDOW) exclude.delete(recent.shift());
  }
}
const cat = sample.filter((r) => r.source === "catalogue").length;
console.log(`per=${PER}  sample=${sample.length}  catalogue=${cat} (${(100 * cat / sample.length).toFixed(1)}%)  draw ms=${Date.now() - t0}`);

// per (kp x form x family) best fixed string, EXECUTED with cell-wide candidates
const t1 = Date.now();
const byCell = new Map();
for (const r of sample) {
  const k = `${r.kpId}|${r.form}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(r);
}
const canonicalKey = (item) => {
  const a = item.answer ?? {};
  if (item.answerType === "repair" && a.line != null && a.canonical == null) return `${a.line}|${a.tex}`;
  return String(a.canonical ?? a.tex ?? "");
};
let checks = 0;
const famRows = [];
for (const [k, rows] of byCell) {
  // cell-wide candidate pool
  const counts = new Map();
  for (const r of rows) {
    const ck = canonicalKey(r.item);
    const hit = counts.get(ck);
    if (hit) hit.n += 1;
    else counts.set(ck, { n: 1, item: r.item });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const cands = new Set(["0", "x", "1", "always", "none"]);
  for (const [, rec] of ranked) {
    const acc = bank.accepts(rec.item);
    if (acc && acc[0] != null) cands.add(String(acc[0]));
  }
  const byFam = new Map();
  for (const r of rows) {
    const f = r.item.family ?? "(unfamilied)";
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f).push(r.item);
  }
  for (const [fam, items] of byFam) {
    const marked = Math.min(items.length, 96);
    let best = 0;
    let bestS = null;
    for (const c of cands) {
      let h = 0;
      for (let i = 0; i < marked; i += 1) {
        if (h + (marked - i) <= best) break;
        checks += 1;
        try { if (bank.check(items[i], c).correct === true) h += 1; } catch { /**/ }
      }
      if (h > best) { best = h; bestS = c; }
    }
    famRows.push({ cell: k, fam, n: marked, rate: best / marked, s: bestS });
  }
}
console.log(`families=${famRows.length}  checks=${checks}  mark ms=${Date.now() - t1}  TOTAL ms=${Date.now() - t0}`);

const over = famRows.filter((r) => r.rate > 0.30);
console.log(`\n${over.length} of ${famRows.length} family groups above maxTrueGuess 0.30`);
const cellSurv = new Map();
for (const r of famRows) {
  const c = cellSurv.get(r.cell) ?? { keep: 0, drop: 0, worstKept: 0 };
  if (r.rate > 0.30) c.drop += 1; else { c.keep += 1; c.worstKept = Math.max(c.worstKept, r.rate); }
  cellSurv.set(r.cell, c);
}
let dead = 0;
const deadCells = [];
for (const [c, v] of cellSurv) if (v.keep === 0) { dead += 1; deadCells.push(c); }
console.log(`cells with NO surviving family: ${dead} of ${cellSurv.size}`);
console.log(deadCells.join("\n"));

const kpDead = [];
const kpRelaxed = [];
for (const kpId of GRAPH.ids) {
  const have = ["construct", "repair", "generate"].filter((f) => (cellSurv.get(`${kpId}|${f}`)?.keep ?? 0) > 0);
  if (!have.length) kpDead.push(kpId);
  else if (have.length < 2) kpRelaxed.push(`${kpId}:${have.join(",")}`);
}
console.log(`\nunmasterable knowledge points: ${kpDead.length} ${JSON.stringify(kpDead)}`);
console.log(`relaxed (1 honest form): ${kpRelaxed.length} ${JSON.stringify(kpRelaxed)}`);
