// P19 scratch: what shapes does the shipped bank actually put in front of a verb?
// Not a proof script — a survey, so the parser is sized against real stems rather than guesses.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "..", "content", "items", "bank");
let all = [];
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  all = all.concat(j.items);
}

const macros = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
for (const it of all) {
  const texts = [it.stem, ...(it.given ?? []), ...(it.working ?? [])];
  for (const t of texts) for (const m of String(t ?? "").matchAll(/\\[a-zA-Z]+/g)) bump(macros, m[0]);
}
console.log("macros:", [...macros.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" "));

const byClass = new Map();
for (const it of all) {
  const k = `${it.objectClass}|${it.form}|${it.answerType}`;
  bump(byClass, k);
}
console.log("\ncells:");
for (const [k, n] of [...byClass.entries()].sort()) console.log(" ", k, n);

console.log("\nsample stems by class:");
for (const cls of ["Span", "Bearer", "Aperture", "Vessel", "Threshold", "Emitter"]) {
  const rows = all.filter((i) => i.objectClass === cls && i.form === "construct").slice(0, 6);
  console.log(`--- ${cls}`);
  for (const it of rows)
    console.log(`   ${it.kpId}/${it.answerType}  stem=${JSON.stringify(it.stem)} given=${JSON.stringify(it.given)} unk=${it.unknown} ans=${JSON.stringify(it.answer.canonical)}`);
}
