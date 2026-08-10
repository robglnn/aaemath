/** Why does a cell measure higher on the served stream than any of its audited families? */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, canonicalKey } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const GRAPH = new Graph(JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(fs.readFileSync(path.join(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const bank = new ItemBank();
const pricing = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });
const bandTierFor = (req) => Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - GRAPH.centre(req.kpId)) / 0.3)));

function stream(seed, sessions = 22) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
  const known = new Map();
  for (const id of GRAPH.ids) known.set(id, rng() < GRAPH.band(id).prior);
  const log = [];
  let seq = 0;
  for (let s = 0; s < sessions; s += 1) {
    clock.set(s * 1440);
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      const exclude = new Set(req.avoidItemIds ?? []);
      const avoid = req.avoidFamilies ?? [];
      let got = null;
      for (let t = 0; t < 10; t += 1) {
        const sel = bank.select({ kpId: req.kpId, form: req.form, difficulty: bandTierFor(req), misconception: t === 0 ? (req.targetMisconception ?? null) : null, seed: (seq * 2654435761 + 17 + t * 104729) >>> 0, exclude });
        if (!sel) break;
        got = sel;
        if (!avoid.includes(sel.item.family)) break;
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!got) break;
      log.push({ kpId: req.kpId, form: req.form, item: got.item, source: got.source });
      if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      sched.submit(req, { correct: known.get(req.kpId) ? rng() > GRAPH.band(req.kpId).slip : rng() < 0.1, latencyMs: 6000, itemId: got.item.id, family: got.item.family, response: "-" });
    }
    sched.endSession();
  }
  return log;
}
const RUNS = Number(process.argv[2] ?? 24);
const log = [];
for (let i = 0; i < RUNS; i += 1) log.push(...stream(20260810 + i * 7919));
console.log(`served ${log.length} items; catalogue ${(100 * log.filter((r) => r.source === "catalogue").length / log.length).toFixed(1)}%`);

const mark = (it, s) => { try { return bank.check(it, s).correct === true; } catch { return false; } };
const cands = (items) => {
  const c = new Map();
  for (const it of items) { const k = canonicalKey(it); const h = c.get(k); if (h) h.n += 1; else c.set(k, { n: 1, item: it }); }
  const out = new Set(["0", "1", "x", "x = 0", "always", "none"]);
  for (const [, rec] of [...c.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) { const a = bank.accepts(rec.item); if (a && a[0] != null) out.add(String(a[0])); }
  return [...out];
};
const bestOf = (items) => {
  let h = 0; let s = null;
  for (const c of cands(items)) { let k = 0; for (const it of items) if (mark(it, c)) k += 1; if (k > h) { h = k; s = c; } }
  return { n: items.length, hits: h, rate: items.length ? h / items.length : 0, s };
};

const byCell = new Map();
for (const r of log) {
  if (pricing.refusedFamilies(r.kpId, r.form).includes(r.item.family)) continue;
  const k = `${r.kpId}|${r.form}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(r);
}
const rows = [];
for (const [cell, rs] of byCell) {
  const [kpId, form] = cell.split("|");
  if (!pricing.isScorable(kpId, form, "solo")) continue;
  if (rs.length < 30) continue;
  const b = bestOf(rs.map((r) => r.item));
  const priced = pricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo");
  rows.push({ cell, ...b, priced, engine: pricing.bankBlindRate(kpId, form) });
}
rows.sort((a, b) => b.rate - b.priced - (a.rate - a.priced));
console.log("\ncell                              n   served  engine  priced  gap   string");
for (const r of rows.slice(0, 14))
  console.log(`${r.cell.padEnd(32)} ${String(r.n).padStart(4)} ${r.rate.toFixed(3).padStart(7)} ${r.engine.toFixed(3).padStart(7)} ${r.priced.toFixed(3).padStart(7)} ${(r.rate - r.priced).toFixed(3).padStart(6)}  ${JSON.stringify(r.s)}`);

// drill the worst one
const worst = rows[0];
{
  const [kpId, form] = worst.cell.split("|");
  const rs = byCell.get(worst.cell);
  const byFam = new Map();
  for (const r of rs) { const f = r.item.family; if (!byFam.has(f)) byFam.set(f, []); byFam.get(f).push(r); }
  console.log(`\ndrill ${worst.cell}: winner ${JSON.stringify(worst.s)}`);
  for (const [fam, items] of byFam) {
    let h = 0;
    for (const r of items) if (mark(r.item, worst.s)) h += 1;
    const cat = items.filter((r) => r.source === "catalogue");
    const distinctCat = new Set(cat.map((r) => r.item.id)).size;
    const rec = AUDIT.families[`${worst.cell}|${fam}`];
    console.log(
      `  ${fam.padEnd(28)} served n=${String(items.length).padStart(4)} winner hits ${(h / items.length).toFixed(3)}  ` +
        `catalogue ${cat.length} draws over ${distinctCat} distinct ids  |  AUDIT rate ${rec ? rec.rate.toFixed(3) : "--"} (${rec?.source}) n=${rec?.n} ans ${JSON.stringify(rec?.modalAnswer)}` +
        `  sources ${JSON.stringify(rec?.sources && Object.fromEntries(Object.entries(rec.sources).map(([k, v]) => [k, `${v.rate.toFixed(3)}/${v.n}`])))}`
    );
  }
}
