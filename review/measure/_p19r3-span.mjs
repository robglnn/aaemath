import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = []; for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);
const open = (it) => ({ itemId: it.id, kpId: it.kpId, form: it.form, stem: it.stem ?? "", given: it.given ?? [], working: it.working ?? [], unknown: it.unknown ?? "x", answerType: it.answerType ?? null, objectClass: it.objectClass ?? null });
const poseOf = (ctx) => { for (const v of VERBS) { let a=null; try{a=v.pose(ctx);}catch{a=null;} if(a) return v.id; } return null; };
const m = new Map(); const bump=(k)=>m.set(k,(m.get(k)??0)+1);
const samples = new Map();
for (const it of all) {
  if (poseOf(open(it)) !== "span") continue;
  const k = `${it.kpId}|${it.form}|${it.answerType}`;
  bump(k);
  if (!samples.has(k)) samples.set(k, `stem=${JSON.stringify(it.stem)} given=${JSON.stringify(it.given)} ans=${JSON.stringify(it.answer.canonical)}`);
}
for (const [k,n] of [...m.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${k.padEnd(46)} ${samples.get(k)}`);
