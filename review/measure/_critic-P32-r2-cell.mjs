import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";
const R="C:/dev/math/aaemath/";
const GRAPH=new Graph(JSON.parse(readFileSync(R+"content/knowledge-graph.json","utf8")));
const AUDIT=JSON.parse(readFileSync(R+"app/src/learn/bank-audit.json","utf8"));
const clock=virtualClock(0);
const m=new Mastery(GRAPH,{bankAudit:AUDIT,storage:null,now:()=>clock.minutes()});
const sch=new Scheduler(m,{clock,rng:mulberry32(7),sessionMinutes:25,bank:itemBank});
const mark=(i,r)=>{try{return itemBank.check(i,r).correct===true;}catch{return false;}};
const spell=(i)=>{try{return itemBank.accepts(i)[0];}catch{return null;}};
let seq=1;
for (const [kp,form] of [["distribute-variable","construct"],["distribute-variable","repair"],["simplify-expression","construct"],["ineq-negative-flip","construct"]]) {
  const cell=m.cell(kp,form);
  console.log(`\n=== ${kp}|${form} ===`);
  console.log("AUDIT cell: blind",cell.blind,"blindUpper",cell.blindUpper,"n",cell.n,"distinct",cell.distinct,"refused",JSON.stringify(cell.refusedFamilies));
  for(const [f,r] of Object.entries(cell.families)) console.log(`   fam ${f.padEnd(34)} blind=${r.blind} upper=${r.blindUpper} n=${r.n} priceable=${r.priceable} modal=${JSON.stringify(r.modalAnswer)}`);
  console.log("probeItemBlindRate:",m.probeItemBlindRate(kp,form));
  for(const d of [m.testOutDifficulty(kp), GRAPH.difficulty(kp), null]){
    const ex=new Set(); const items=[]; const fams=new Map(); const tiers=new Map(); const srcs=new Map();
    for(let i=0;i<120;i++){const s=sch.serve({kpId:kp,form,difficulty:d,seq:seq++,avoidFamilies:m.refusedFamilies(kp,form),avoidItemIds:[...ex]},itemBank,{dry:true}); if(!s)break; items.push(s.item); ex.add(s.item.id);
      fams.set(s.family,(fams.get(s.family)??0)+1); tiers.set(s.item.difficulty,(tiers.get(s.item.difficulty)??0)+1); srcs.set(s.source,(srcs.get(s.source)??0)+1);}
    const cand=new Set(["0","1","x","always","none"]); for(const it of items){const s=spell(it); if(s!=null)cand.add(String(s));}
    let best=0,ans=null; for(const c of cand){let h=0;for(const it of items)if(mark(it,c))h++; if(h>best){best=h;ans=c;}}
    // per-family measured rate of that single best string
    const perFam=new Map();
    for(const it of items){const f=it.family; const o=perFam.get(f)??{n:0,h:0}; o.n++; if(mark(it,ans))o.h++; perFam.set(f,o);}
    console.log(`  served@difficulty=${d==null?"null":d}: n=${items.length} bestString=${JSON.stringify(ans)} rate=${(best/items.length).toFixed(3)} tiers=${JSON.stringify([...tiers])} src=${JSON.stringify([...srcs])}`);
    console.log(`     families served: ${JSON.stringify([...fams])}`);
    console.log(`     that string per family: ${[...perFam].map(([f,o])=>`${f}:${o.h}/${o.n}`).join(" ")}`);
  }
}
