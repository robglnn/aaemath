/** Ground truth: what the REAL Scheduler serves, per (kp x form x family), vs cheap samplers. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, auditBlindGuessing, collectBankSample } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);
const { generateOne, TIERS } = await import(`file://${ROOT}/content/items/generators.mjs`);
const GRAPH = new Graph(JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")));
const bank = new ItemBank();
const AUDIT = auditBlindGuessing(
  collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) }),
  { mark: (i, r) => bank.check(i, r).correct === true, spell: (i) => bank.accepts(i)[0] }
);
const bandTierFor = (req) =>
  Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - GRAPH.centre(req.kpId)) / 0.3)));

function servedLog(seed, sessions = 22) {
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
      let item = null;
      for (let t = 0; t < 8; t += 1) {
        const sel = bank.select({
          kpId: req.kpId, form: req.form, difficulty: bandTierFor(req),
          misconception: t === 0 ? (req.targetMisconception ?? null) : null,
          seed: (seq * 2246822519 + 11 + t * 104729) >>> 0, exclude,
        });
        if (!sel) break;
        item = sel.item;
        if (!avoid.includes(sel.item.family)) { log.push({ kpId: req.kpId, form: req.form, item, source: sel.source }); break; }
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!item) break;
      if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      sched.submit(req, {
        correct: known.get(req.kpId) ? rng() > GRAPH.band(req.kpId).slip : false,
        latencyMs: 6000, itemId: item.id, family: item.family, response: "-",
      });
    }
    sched.endSession();
  }
  return log;
}

const RUNS = Number(process.argv[2] ?? 16);
const log = [];
for (let i = 0; i < RUNS; i += 1) log.push(...servedLog(20260810 + i * 7919));
const cat = log.filter((r) => r.source === "catalogue").length;
console.log(`SERVED: ${log.length} items over ${RUNS} runs; catalogue ${(100 * cat / log.length).toFixed(1)}%`);

const canonicalKey = (item) => {
  const a = item.answer ?? {};
  if (item.answerType === "repair" && a.line != null && a.canonical == null) return `${a.line}|${a.tex}`;
  return String(a.canonical ?? a.tex ?? "");
};

function famRates(rows, cap = 150) {
  const byCell = new Map();
  for (const r of rows) {
    if (!byCell.has(r.cell)) byCell.set(r.cell, []);
    byCell.get(r.cell).push(r);
  }
  const out = new Map();
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
    const byFam = new Map();
    for (const r of rs) {
      const f = r.item.family ?? "(none)";
      if (!byFam.has(f)) byFam.set(f, []);
      byFam.get(f).push(r.item);
    }
    for (const [fam, items] of byFam) {
      const marked = Math.min(items.length, cap);
      let best = 0;
      let bestS = null;
      for (const c of cands) {
        let h = 0;
        for (let i = 0; i < marked; i += 1) {
          if (h + (marked - i) <= best) break;
          try { if (bank.check(items[i], c).correct === true) h += 1; } catch { /**/ }
        }
        if (h > best) { best = h; bestS = c; }
      }
      out.set(`${cell}|${fam}`, { n: marked, rate: best / marked, s: bestS });
    }
    const marked = Math.min(rs.length, 400);
    let best = 0;
    let bestS = null;
    for (const c of cands) {
      let h = 0;
      for (let i = 0; i < marked; i += 1) {
        try { if (bank.check(rs[i].item, c).correct === true) h += 1; } catch { /**/ }
      }
      if (h > best) { best = h; bestS = c; }
    }
    out.set(`${cell}|*POOLED*`, { n: marked, rate: best / marked, s: bestS });
  }
  return out;
}

const served = famRates(log.map((r) => ({ cell: `${r.kpId}|${r.form}`, item: r.item })));

const enumRows = [];
for (const file of BANK)
  for (const it of file.items)
    if (["construct", "repair", "generate"].includes(it.form)) enumRows.push({ cell: `${file.kpId}|${it.form}`, item: it });
const enumerated = famRates(enumRows);

function blocked(perCell, block) {
  const cells = [];
  for (const kpId of GRAPH.ids) for (const form of ["construct", "repair", "generate"]) cells.push({ kpId, form, band: GRAPH.difficulty(kpId) });
  const rows = [];
  const recent = [];
  const exclude = new Set();
  let seq = 0;
  for (let round = 0; round * block < perCell; round += 1) {
    for (const c of cells) {
      for (let b = 0; b < block; b += 1) {
        const tier = Math.max(1, Math.min(5, c.band + (((round * block + b) % 5) - 2)));
        const sel = bank.select({ kpId: c.kpId, form: c.form, difficulty: tier, seed: (seq * 2654435761 + 17) >>> 0, exclude });
        seq += 1;
        if (!sel) continue;
        rows.push({ cell: `${c.kpId}|${c.form}`, item: sel.item, source: sel.source });
        recent.push(sel.item.id);
        exclude.add(sel.item.id);
        while (recent.length > 40) exclude.delete(recent.shift());
      }
    }
  }
  return rows;
}
const bRows = blocked(120, 6);
const bcat = bRows.filter((r) => r.source === "catalogue").length;
console.log(`BLOCKED sampler: ${bRows.length} items; catalogue ${(100 * bcat / bRows.length).toFixed(1)}%`);
const blockedR = famRates(bRows);

const keys = [...served.keys()].filter((k) => !k.endsWith("*POOLED*") && served.get(k).n >= 12);
let underE = 0;
let underB = 0;
const rows = [];
for (const k of keys) {
  const s = served.get(k).rate;
  const e = enumerated.get(k)?.rate ?? null;
  const b = blockedR.get(k)?.rate ?? null;
  if (e == null || e + 1e-9 < s) underE += 1;
  if (b == null || b + 1e-9 < s) underB += 1;
  rows.push({ k, s, e, b, n: served.get(k).n });
}
rows.sort((a, b) => b.s - (b.e ?? 0) - (a.s - (a.e ?? 0)));
console.log(`\n${keys.length} family groups with n>=12 served.`);
console.log(`enumeration UNDER-states served on ${underE}; blocked sampler under-states on ${underB}`);
console.log("\nworst under-statements (served > enumerated):");
for (const r of rows.slice(0, 18))
  console.log(`  served ${r.s.toFixed(3)} enum ${r.e == null ? "--" : r.e.toFixed(3)} blocked ${r.b == null ? "--" : r.b.toFixed(3)}  n=${r.n}  ${r.k}`);

console.log("\npooled served cell rate vs max family rate (enumeration):");
const pooled = [...served.entries()]
  .filter(([k]) => k.endsWith("*POOLED*"))
  .map(([k, v]) => ({ cell: k.replace("|*POOLED*", ""), ...v }))
  .sort((a, b) => b.rate - a.rate);
for (const p of pooled.slice(0, 16)) {
  const fams = [...enumerated.entries()].filter(([k]) => k.startsWith(p.cell + "|") && !k.endsWith("*POOLED*"));
  const mx = fams.length ? Math.max(...fams.map(([, v]) => v.rate)) : null;
  console.log(`  ${p.cell.padEnd(32)} pooled ${p.rate.toFixed(3)} n=${p.n}  maxFamily(enum) ${mx == null ? "--" : mx.toFixed(3)}  ${JSON.stringify(p.s)}`);
}
