/**
 * Proto 4 — the proposed audit: per (kp x form x family), blind = max(catalogue census, generator draw).
 * Prints cell/knowledge-point survival so the cost to the curriculum is visible before anything ships.
 */
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
const PER = Number(process.argv[2] ?? 160);
const WINDOW = 40;

const t0 = Date.now();
const rows = [];
for (const kpId of GRAPH.ids) {
  const band = GRAPH.difficulty(kpId);
  for (const form of FORMS) {
    const recent = [];
    const exclude = new Set();
    for (let d = 0; d < PER; d += 1) {
      const tier = Math.max(1, Math.min(5, band + ((d % 5) - 2)));
      const sel = bank.select({ kpId, form, difficulty: tier, seed: (d * 2654435761 + 17) >>> 0, exclude });
      if (!sel) continue;
      rows.push({ kpId, form, item: sel.item, source: sel.source });
      recent.push(sel.item.id);
      exclude.add(sel.item.id);
      while (recent.length > WINDOW) exclude.delete(recent.shift());
    }
  }
}
const cat = rows.filter((r) => r.source === "catalogue").length;
console.log(`draw: ${rows.length} rows, catalogue ${cat} (${(100 * cat / rows.length).toFixed(1)}%), ms ${Date.now() - t0}`);

const canonicalKey = (item) => {
  const a = item.answer ?? {};
  if (item.answerType === "repair" && a.line != null && a.canonical == null) return `${a.line}|${a.tex}`;
  return String(a.canonical ?? a.tex ?? "");
};
const wilsonUpper = (h, n) => {
  if (!n) return 1;
  const z = 1.959964, p = h / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (c + s) / d);
};

const t1 = Date.now();
const byCell = new Map();
for (const r of rows) {
  const k = `${r.kpId}|${r.form}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(r);
}
let checks = 0;
const fam = [];
for (const [cell, rs] of byCell) {
  const counts = new Map();
  for (const r of rs) {
    const ck = canonicalKey(r.item);
    const h = counts.get(ck);
    if (h) h.n += 1;
    else counts.set(ck, { n: 1, item: r.item });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const cands = new Set(["0", "x", "1", "always", "none"]);
  for (const [, rec] of ranked) {
    const acc = bank.accepts(rec.item);
    if (acc && acc[0] != null) cands.add(String(acc[0]));
  }
  const groups = new Map();
  for (const r of rs) {
    const seen = new Set();
    const key = `${r.item.family ?? "(none)"}|${r.source}`;
    if (!groups.has(key)) groups.set(key, { items: [], ids: new Set() });
    const g = groups.get(key);
    if (r.source === "catalogue" && g.ids.has(r.item.id)) continue; // census: each committed item once
    g.ids.add(r.item.id);
    g.items.push(r.item);
    void seen;
  }
  const best = new Map();
  for (const [key, g] of groups) {
    const marked = Math.min(g.items.length, 120);
    let h = 0;
    let s = null;
    for (const c of cands) {
      let k = 0;
      for (let i = 0; i < marked; i += 1) {
        if (k + (marked - i) <= h) break;
        checks += 1;
        try { if (bank.check(g.items[i], c).correct === true) k += 1; } catch { /**/ }
      }
      if (k > h) { h = k; s = c; }
    }
    const [family, source] = key.split("|");
    const rate = marked ? h / marked : 0;
    const upper = source === "catalogue" ? rate : wilsonUpper(h, marked);
    const cur = best.get(`${cell}|${family}`);
    const rec = { cell, family, n: marked, rate, upper, s, source };
    if (!cur || rate > cur.rate) best.set(`${cell}|${family}`, rec);
  }
  for (const rec of best.values()) fam.push(rec);
}
console.log(`families ${fam.length}, checks ${checks}, mark ms ${Date.now() - t1}, total ms ${Date.now() - t0}`);

const CAP = 0.30;
const over = fam.filter((r) => r.rate > CAP || r.upper > CAP);
console.log(`\n${over.length} of ${fam.length} family groups refused (rate>${CAP} or upper>${CAP})`);
over.sort((a, b) => b.rate - a.rate);
for (const r of over.slice(0, 60))
  console.log(`  ${r.rate.toFixed(3)} up ${r.upper.toFixed(3)} n=${String(r.n).padStart(3)} ${r.source.padEnd(9)} ${r.cell}|${r.family} ${JSON.stringify(r.s)}`);

const cellKeep = new Map();
for (const r of fam) {
  const c = cellKeep.get(r.cell) ?? { keep: [], drop: [] };
  if (r.rate > CAP || r.upper > CAP) c.drop.push(r.family);
  else c.keep.push(r.family);
  cellKeep.set(r.cell, c);
}
const dead = [...cellKeep].filter(([, v]) => !v.keep.length).map(([c]) => c);
console.log(`\ncells with no surviving family: ${dead.length} of ${cellKeep.size}`);
console.log("  " + dead.join("\n  "));
const kpDead = [];
const kpRelaxed = [];
for (const kpId of GRAPH.ids) {
  const have = FORMS.filter((f) => (cellKeep.get(`${kpId}|${f}`)?.keep.length ?? 0) > 0);
  if (!have.length) kpDead.push(kpId);
  else if (have.length < 2) kpRelaxed.push(`${kpId}:${have.join(",")}`);
}
console.log(`\nunmasterable: ${kpDead.length} ${JSON.stringify(kpDead)}`);
console.log(`relaxed to one form: ${kpRelaxed.length} ${JSON.stringify(kpRelaxed)}`);
for (const id of kpDead) console.log(`  ${id} blocks ${GRAPH.descendants(id).size} knowledge points`);
