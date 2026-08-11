import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { parseClaim, parseChain, parseSystem, loadTex } from "../../app/src/learn/verbs/Claim.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = []; for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);
const rep = all.filter(i=>i.form==="repair");
const seen = new Map();
for (const it of rep) {
  const w = it.working ?? []; const src = w[it.answer.line-2]; if (src==null) continue;
  const c = parseClaim(src); const ch = parseChain(src); const sys = parseSystem(src);
  let shape = "?";
  if (sys) shape="system"; else if (c&&c.rel&&c.rel!=="=") shape="threshold"; else if (c&&c.rel==="=") shape="claim";
  else if (c&&!c.rel) shape = c.near.some(t=>t.bundle)?"bundle":(ch?"chain":"load"); else if (ch) shape="chain"; else shape="unreadable";
  if (shape!=="load") continue;
  const k = it.kpId;
  if (!seen.has(k)) seen.set(k, []);
  if (seen.get(k).length < 3) seen.get(k).push(`src=${JSON.stringify(src)} broke=${JSON.stringify(w[it.answer.line-1])} ans=${JSON.stringify(it.answer.canonical)} vk=${it.answer.valueKind} brokenBy=${it.brokenBy}`);
}
for (const [k,v] of seen) { console.log("---", k); for (const s of v) console.log("   ", s); }
