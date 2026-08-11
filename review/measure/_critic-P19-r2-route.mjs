// Independent routing audit: for every item in the shipped bank, which verb poses?
// Runs the SHIPPED VERBS array, not a reimplementation.
import fs from "node:fs";
import path from "node:path";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");

const counts = {};
const byKp = {};
const nullExamples = [];
let total = 0;

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const kp = j.kpId ?? f.replace(/\.json$/, "");
  const items = [];
  const collect = (o) => {
    if (Array.isArray(o)) return o.forEach(collect);
    if (o && typeof o === "object") {
      if (o.stem != null && (o.answerType != null || o.answer != null)) items.push(o);
      else Object.values(o).forEach(collect);
    }
  };
  collect(j);

  for (const raw of items) {
    total += 1;
    const ctx = {
      itemId: raw.id ?? null,
      kpId: kp,
      form: raw.form ?? null,
      stem: raw.stem ?? "",
      given: Array.isArray(raw.given) ? raw.given : [],
      working: Array.isArray(raw.working) ? raw.working : [],
      unknown: raw.unknown ?? "x",
      answerType: raw.answerType ?? null,
      objectClass: raw.objectClass ?? null,
    };
    let id = null;
    for (const v of VERBS) {
      let act = null;
      try { act = v.pose(ctx); } catch { act = null; }
      if (act) { id = v.id; break; }
    }
    counts[id ?? "NULL(typed entry)"] = (counts[id ?? "NULL(typed entry)"] ?? 0) + 1;
    const key = `${kp}|${ctx.form}|${ctx.answerType}`;
    byKp[key] = byKp[key] ?? {};
    byKp[key][id ?? "NULL"] = (byKp[key][id ?? "NULL"] ?? 0) + 1;
    if (!id && nullExamples.length < 12) nullExamples.push({ kp, form: ctx.form, answerType: ctx.answerType, stem: String(ctx.stem).slice(0, 50) });
  }
}

console.log("TOTAL ITEMS:", total);
console.log("\n=== which verb poses, whole shipped bank ===");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(22)} ${v}  (${((v / total) * 100).toFixed(1)}%)`);

console.log("\n=== items with NO verb — the player TYPES these ===");
for (const e of nullExamples) console.log("  ", JSON.stringify(e));

console.log("\n=== per kp|form|answerType ===");
for (const [k, v] of Object.entries(byKp).sort()) console.log(`  ${k.padEnd(48)} ${JSON.stringify(v)}`);
