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
  BANK_AUDIT_VERSION,
  BANK_AUDIT_PER_CELL,
  BANK_AUDIT_WINDOW,
} = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);

const graph = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const bank = new ItemBank();

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
