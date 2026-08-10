#!/usr/bin/env node
/**
 * Precompute the bank audit — the third pricing axis — into a committed table.
 *
 * P16 prices every item on three factors, and the third one is a fact about `content/items`:
 * what a responder with no algebra actually gets on this (knowledge point x form) cell of the
 * bank the game ships. Measuring it means drawing thousands of items through `ItemBank.select()`
 * and marking them with the shipped checker, which costs ~20 s of pure arithmetic. That is a
 * property of the bank, identical on every machine and every page load, so it is computed here,
 * once, and read by `app/src/boot/62-learning.js` from `app/src/learn/bank-audit.json`.
 *
 *   node tools/bank-audit.mjs            # write the table
 *   node tools/bank-audit.mjs --check    # exit 1 if the committed table is stale
 *   node tools/bank-audit.mjs --lint     # exit 1 if any committed pool repeats one answer too often
 *
 * `--lint` is the millisecond version of the whole audit and it needs no simulation at all: count
 * the modal answer's share of each committed (kp x form x family) pool and fail above `maxTrueGuess`.
 * It is a gate that exists and is not yet wired into `npm run build`, because `content/items`
 * belongs to P17 and the shipped bank does not pass it — the engine REFUSES every pool it names
 * instead, and `review/measure/P16.mjs` U41 asserts exactly that. The day those pools grow more
 * distinct answers, this becomes a build step and the refusals revert on their own.
 *
 * The table carries a fingerprint over every committed item's identity and answer plus every
 * constant that changes what the audit means. `Mastery` refuses a table whose fingerprint does not
 * match the content it is being asked to price, and `review/measure/P16.mjs` recomputes the whole
 * thing from scratch and fails on any difference — so a stale table is loud in two places.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "app/src/learn/bank-audit.json");

const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const {
  auditBlindGuessing,
  collectBankSample,
  bankAuditFingerprint,
  canonicalKey,
  BANK_AUDIT_VERSION,
  BANK_AUDIT_PER_CELL,
  BANK_AUDIT_WINDOW,
} = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);

const graph = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const bank = new ItemBank();
const CAP = graph.model.bkt.identifiabilityCaps.maxTrueGuess;
const FORMS = graph.model.forms.scored;

/** Modal-answer share per committed (kp x form x family) pool. No simulation, no checker, no seeds. */
function lintCatalogue() {
  const over = [];
  const thin = [];
  for (const file of BANK) {
    const groups = new Map();
    for (const item of file.items ?? []) {
      if (!FORMS.includes(item.form)) continue;
      const key = `${file.kpId}|${item.form}|${item.family ?? "(unfamilied)"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [key, items] of groups) {
      const counts = new Map();
      for (const it of items) counts.set(canonicalKey(it), (counts.get(canonicalKey(it)) ?? 0) + 1);
      let modal = 0;
      let answer = null;
      for (const [k, n] of counts) if (n > modal) ((modal = n), (answer = k));
      const row = { key, n: items.length, distinct: counts.size, share: modal / items.length, modal, answer };
      // `modal >= 2` is what makes the rule mean anything: three items with three different
      // answers have a modal share of 0.333 and are as good as three items can be. Pools that thin
      // are a real defect too, and they are listed separately rather than folded in.
      if (modal >= 2 && row.share > CAP) over.push(row);
      else if (items.length < Math.ceil(1 / CAP)) thin.push(row);
    }
  }
  over.sort((a, b) => b.share - a.share);
  thin.sort((a, b) => a.n - b.n);
  return { over, thin };
}

if (process.argv.includes("--lint")) {
  const { over, thin } = lintCatalogue();
  for (const r of over)
    console.log(`  OVER ${r.share.toFixed(3)}  ${r.key}  ${r.modal}/${r.n} answer ${JSON.stringify(r.answer)} (${r.distinct} distinct)`);
  for (const r of thin) console.log(`  THIN n=${r.n}  ${r.key}  (fewer than ${Math.ceil(1 / CAP)} items, so no distribution clears ${CAP})`);
  console.log(
    `content/items lint: ${over.length} pools repeat one answer more than ${CAP} of the time, ${thin.length} are too thin to clear the cap at all`
  );
  process.exit(over.length ? 1 : 0);
}

const t0 = Date.now();
const sample = collectBankSample({
  select: (o) => bank.select(o),
  kpIds: graph.ids,
  bandOf: (id) => graph.difficulty(id),
});
const drawMs = Date.now() - t0;
const t1 = Date.now();
const audit = auditBlindGuessing(sample, {
  mark: (item, response) => bank.check(item, response).correct === true,
  spell: (item) => bank.accepts(item)[0],
});
const markMs = Date.now() - t1;

const table = {
  version: BANK_AUDIT_VERSION,
  fingerprint: bankAuditFingerprint({ bankFiles: BANK, model: graph.model }),
  perCell: BANK_AUDIT_PER_CELL,
  window: BANK_AUDIT_WINDOW,
  generatedAt: null, // deliberately absent: a timestamp would make the file churn on every run
  sampled: audit.sampled,
  mixture: audit.mixture,
  notExecuted: audit.notExecuted,
  families: audit.families,
  cells: audit.cells,
};
const json = JSON.stringify(table, null, 1) + "\n";

const check = process.argv.includes("--check");
const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
const same = existing === json;

const cat = audit.mixture.catalogue;
console.log(
  `bank audit: ${audit.sampled} items drawn through ItemBank.select() ` +
    `(${cat} catalogue / ${audit.sampled - cat} generated, ${(100 * cat / audit.sampled).toFixed(1)}% catalogue), ` +
    `${Object.keys(audit.families).length} families, ${Object.keys(audit.cells).length} cells`
);
console.log(`  draw ${drawMs} ms, mark ${markMs} ms, fingerprint ${table.fingerprint}`);
const lint = lintCatalogue();
console.log(
  `  content lint: ${lint.over.length} committed pools repeat one answer above ${CAP} (worst ` +
    `${lint.over.slice(0, 3).map((r) => `${r.key} ${r.share.toFixed(3)}`).join(", ") || "none"}); ` +
    `${lint.thin.length} pools hold fewer than ${Math.ceil(1 / CAP)} items. Run with --lint for the full list.`
);

if (check) {
  if (!existing) {
    console.error(`STALE: ${OUT} does not exist. Run: node tools/bank-audit.mjs`);
    process.exit(1);
  }
  if (!same) {
    console.error(`STALE: ${OUT} does not match a fresh audit of content/items. Run: node tools/bank-audit.mjs`);
    process.exit(1);
  }
  console.log("  committed table is current");
  process.exit(0);
}

writeFileSync(OUT, json);
console.log(`  ${same ? "unchanged" : "WROTE"} ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
