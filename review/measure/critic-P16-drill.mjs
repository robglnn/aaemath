/**
 * CRITIC drill-down: WHY does my measured blind rate on the served pool differ from the rate the
 * shipped engine's own audit prices the same cell at? Per family, per source, on the SHIPPED bank.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, auditBlindGuessing, collectBankSample } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);
const { generateOne, TIERS } = await import(`file://${ROOT}/content/items/generators.mjs`);

const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
const GRAPH = new Graph(SRC);
const bank = new ItemBank();
const AUDIT = auditBlindGuessing(
  collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) }),
  { mark: (i, r) => bank.check(i, r).correct === true, spell: (i) => bank.accepts(i)[0] }
);
const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });

const TARGETS = [
  ["expr-anatomy", "construct", "-8x"],
  ["eq-both-sides", "construct", "3"],
  ["eq-model-context", "construct", "9"],
  ["expr-anatomy", "repair", "2: -9x"],
  ["eq-both-sides", "generate", "7x + 5 = 3x + 17"],
];

for (const [kpId, form, cand] of TARGETS) {
  console.log("=".repeat(90));
  const cell = mastery.cell(kpId, form);
  console.log(`${kpId} | ${form}   engine: blind ${cell.blind.toFixed(3)} upper ${cell.blindUpper.toFixed(3)} priceable ${cell.priceable} refused[${cell.refusedFamilies.join(",")}]`);
  console.log(`  engine per-family: ${Object.entries(cell.families).map(([f, r]) => `${f}=${r.blind.toFixed(3)}${r.priceable ? "" : "(REFUSED)"}`).join("  ")}`);

  // The pool a player is served, through the shipped select path, refusals honoured.
  const avoid = new Set(cell.refusedFamilies);
  const centre = GRAPH.difficulty(kpId);
  const exclude = new Set();
  const pool = [];
  for (let i = 0; i < 400; i += 1) {
    const difficulty = Math.max(1, Math.min(5, centre + ((i % 5) - 2)));
    for (let t = 0; t < 8; t += 1) {
      const sel = bank.select({ kpId, form, difficulty, seed: (i * 2654435761 + t * 104729 + 7) >>> 0, exclude });
      if (!sel) break;
      if (avoid.has(sel.item.family)) { exclude.add(sel.item.id); continue; }
      pool.push({ ...sel, item: sel.item });
      break;
    }
  }
  const byFam = new Map();
  for (const p of pool) {
    const k = `${p.item.family ?? "(unfamilied)"}/${p.source}`;
    if (!byFam.has(k)) byFam.set(k, []);
    byFam.get(k).push(p.item);
  }
  console.log(`  my served pool: ${pool.length} draws, ${new Set(pool.map((p) => p.item.id)).size} distinct ids`);
  let tot = 0;
  let hit = 0;
  for (const [k, items] of [...byFam].sort((a, b) => b[1].length - a[1].length)) {
    let h = 0;
    for (const it of items) { try { if (bank.check(it, cand).correct) h += 1; } catch { /**/ } }
    tot += items.length;
    hit += h;
    console.log(`    ${k.padEnd(40)} n=${String(items.length).padStart(4)}  "${cand}" hits ${String(h).padStart(4)} = ${(h / items.length).toFixed(3)}`);
  }
  console.log(`  >>> one fixed string "${cand}" on the served pool: ${hit}/${tot} = ${(hit / tot).toFixed(3)}   (engine prices the cell's blind at ${cell.blind.toFixed(3)}, modelledGuess ${mastery.modelledGuess(kpId, GRAPH.band(kpId), form, "solo").toFixed(3)}, maxTrueGuess ${GRAPH.model.bkt.identifiabilityCaps.maxTrueGuess})`);

  // And the SAME string against the engine's own audit sample, so the difference is isolated to
  // the population rather than to the marking.
  const auditSample = collectBankSample({
    bankFiles: BANK.filter((f) => f.kpId === kpId), generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id), forms: [form],
  }).filter((r) => !avoid.has(r.item.family));
  let ah = 0;
  for (const r of auditSample) { try { if (bank.check(r.item, cand).correct) ah += 1; } catch { /**/ } }
  console.log(`  >>> same string on the ENGINE'S OWN audit sample (surviving families): ${ah}/${auditSample.length} = ${(ah / auditSample.length).toFixed(3)}`);
}
