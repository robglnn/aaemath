import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import { parseClaim, parseChain, parseSystem } from "../../app/src/learn/verbs/Claim.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = [];
for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);

const open = (it) => ({
  itemId: it.id, kpId: it.kpId, form: it.form, stem: it.stem ?? "", given: it.given ?? [],
  working: it.working ?? [], unknown: it.unknown ?? "x", answerType: it.answerType ?? null,
  objectClass: it.objectClass ?? null,
});
const poseOf = (ctx) => { for (const v of VERBS) { let a = null; try { a = v.pose(ctx); } catch { a = null; } if (a) return v.id; } return null; };

const byVerb = new Map();
const unposed = new Map();
for (const it of all) {
  const id = poseOf(open(it));
  byVerb.set(id, (byVerb.get(id) ?? 0) + 1);
  if (!id) { const k = `${it.form}|${it.answerType}|${it.objectClass}`; unposed.set(k, (unposed.get(k) ?? 0) + 1); }
}
console.log("=== routing now ===");
for (const [k,n] of [...byVerb.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(k).padEnd(12)} ${n}`);
console.log("=== unposed cells ===");
for (const [k,n] of [...unposed.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(40)} ${n}`);

// --- repair: how readable are the SOURCE lines?
const rep = all.filter(i=>i.form==="repair");
const kinds = new Map();
const bump=(m,k)=>m.set(k,(m.get(k)??0)+1);
let ansLineIsLast = 0, ansLineOther = 0;
const vkByShape = new Map();
for (const it of rep) {
  const w = it.working ?? [];
  const line = it.answer.line;
  if (line === w.length) ansLineIsLast += 1; else ansLineOther += 1;
  const src = w[line-2];
  let shape = "none";
  if (src != null) {
    const c = parseClaim(src);
    const ch = parseChain(src);
    const sys = parseSystem(src);
    if (sys) shape = "system";
    else if (c && c.rel && c.rel !== "=") shape = "threshold";
    else if (c && c.rel === "=") shape = "claim";
    else if (c && !c.rel) {
      const hasBundle = c.near.some(t=>t.bundle);
      shape = hasBundle ? "bundle" : (ch ? "chain" : "load");
    } else if (ch) shape = "chain";
    else shape = "unreadable";
  }
  bump(kinds, shape);
  bump(vkByShape, `${shape}|${it.answer.valueKind}`);
}
console.log(`\n=== repair (${rep.length}) ===  answer line == last: ${ansLineIsLast}, other: ${ansLineOther}`);
console.log("source-line shapes:");
for (const [k,n] of [...kinds.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(12)} ${n}`);
console.log("shape|valueKind:");
for (const [k,n] of [...vkByShape.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(24)} ${n}`);
console.log("\nunreadable/none samples:");
let shown=0;
for (const it of rep) {
  const w = it.working ?? []; const src = w[it.answer.line-2];
  if (src == null) { console.log(`  [none] ${it.id} working=${JSON.stringify(w)} line=${it.answer.line}`); shown++; }
  else if (!parseClaim(src) && !parseChain(src) && !parseSystem(src)) { console.log(`  [unread] ${it.kpId} src=${JSON.stringify(src)} ans=${JSON.stringify(it.answer.canonical)}`); shown++; }
  if (shown>24) break;
}
console.log("\nworking lengths:", JSON.stringify([...rep.reduce((m,i)=>{const n=(i.working??[]).length;m.set(n,(m.get(n)??0)+1);return m;},new Map()).entries()].sort()));
