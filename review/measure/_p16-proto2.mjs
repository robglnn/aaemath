import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const GRAPH = new Graph(JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")));
const bank = new ItemBank();
// enumerate catalogue only, exactly
const BANKF = (await import(`file://${ROOT}/content/items/index.mjs`)).BANK;
const canonicalKey = (item) => { const a = item.answer ?? {}; if (item.answerType === "repair" && a.line != null && a.canonical == null) return `${a.line}|${a.tex}`; return String(a.canonical ?? a.tex ?? ""); };
const rows=[];
for (const file of BANKF) {
  const byCell = new Map();
  for (const it of file.items) { if(!["construct","repair","generate"].includes(it.form)) continue; const k=`${file.kpId}|${it.form}`; if(!byCell.has(k)) byCell.set(k,[]); byCell.get(k).push(it); }
  for (const [k, items] of byCell) {
    const counts=new Map();
    for(const it of items){const ck=canonicalKey(it); const h=counts.get(ck); if(h)h.n+=1; else counts.set(ck,{n:1,item:it});}
    const ranked=[...counts.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,8);
    const cands=new Set(["0","x","1","always","none"]);
    for(const [,rec] of ranked){const acc=bank.accepts(rec.item); if(acc&&acc[0]!=null)cands.add(String(acc[0]));}
    const byFam=new Map();
    for(const it of items){const f=it.family??"(none)"; if(!byFam.has(f))byFam.set(f,[]); byFam.get(f).push(it);}
    for(const [fam,its] of byFam){
      let best=0,bestS=null;
      for(const c of cands){let h=0; for(const it of its){try{if(bank.check(it,c).correct===true)h+=1;}catch{}} if(h>best){best=h;bestS=c;}}
      // also canonical-modal
      const cc=new Map(); for(const it of its){const ck=canonicalKey(it); cc.set(ck,(cc.get(ck)||0)+1);}
      const modal=Math.max(...cc.values());
      rows.push({cell:k,fam,n:its.length,exec:best/its.length,canon:modal/its.length,s:bestS});
    }
  }
}
rows.sort((a,b)=>b.exec-a.exec);
console.log("exec  canon   n  cell|family   winning-string");
for(const r of rows.slice(0,45)) console.log(`${r.exec.toFixed(3)} ${r.canon.toFixed(3)} ${String(r.n).padStart(3)}  ${r.cell}|${r.fam}  ${JSON.stringify(r.s)}`);
console.log("---");
console.log(rows.filter(r=>r.exec>0.30).length, "of", rows.length, "family groups over 0.30 by EXECUTED marking");
console.log(rows.filter(r=>r.canon>0.30).length, "of", rows.length, "over 0.30 by CANONICAL modal");
const infl=rows.filter(r=>r.exec>r.canon+0.001).sort((a,b)=>(b.exec-b.canon)-(a.exec-a.canon));
console.log("\nbiggest exec-over-canonical gaps (checker leniency):");
for(const r of infl.slice(0,20)) console.log(`  +${(r.exec-r.canon).toFixed(3)}  ${r.cell}|${r.fam} n=${r.n} exec ${r.exec.toFixed(3)} canon ${r.canon.toFixed(3)} ${JSON.stringify(r.s)}`);
