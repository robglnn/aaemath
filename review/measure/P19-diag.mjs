// P19 scratch: which stems the claim reader turns away, grouped, so the grammar is widened against
// evidence rather than against a hunch.
import fs from "node:fs";
import path from "node:path";
import { parseClaim, claimTex } from "../../app/src/learn/verbs/Claim.js";

const BANK = path.join(path.resolve(import.meta.dirname, "..", ".."), "content", "items", "bank");
const items = [];
for (const f of fs.readdirSync(BANK)) items.push(...JSON.parse(fs.readFileSync(path.join(BANK, f), "utf8")).items);

const fails = new Map();
let ok = 0;
const round = new Map();
for (const it of items) {
  const c = parseClaim(it.stem);
  if (!c) {
    const key = `${it.kpId}/${it.answerType}`;
    if (!fails.has(key)) fails.set(key, []);
    if (fails.get(key).length < 2) fails.get(key).push(it.stem);
    continue;
  }
  ok += 1;
  const back = claimTex(c);
  if (back.replace(/\s|\\left|\\right/g, "") !== String(it.stem).replace(/\s|\\left|\\right/g, "")) {
    const key = `roundtrip ${it.kpId}`;
    if (!round.has(key)) round.set(key, []);
    if (round.get(key).length < 2) round.get(key).push(`${it.stem}  ->  ${back}`);
  }
}
console.log(`parsed ${ok}/${items.length}`);
console.log("\nrefused:");
for (const [k, v] of [...fails.entries()].sort()) console.log(` ${k}\n    ${v.join("\n    ")}`);
console.log("\nround-trip differences (not necessarily wrong — spacing and sign spelling):");
for (const [k, v] of [...round.entries()].slice(0, 14)) console.log(` ${k}\n    ${v.join("\n    ")}`);
