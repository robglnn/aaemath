/** Does the probe rotate the difficulty tier? The audit's census price says it must. */
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
console.log("First-encounter concentration: 400 independent FIRST probe items per cell (exclusion empty, as at attempts=0)\n");
console.log("kp|form".padEnd(38)+"auditPrice  distinctIds  topItemShare  bestString  measuredRate");
const cells=[["distribute-variable","construct"],["distribute-variable","repair"],["distribute-variable","generate"],
 ["simplify-expression","construct"],["ineq-negative-flip","construct"],["var-meaning","construct"],["expr-anatomy","construct"],["eq-distribute","construct"]];
for(const [kp,form] of cells){
  const d=m.testOutDifficulty(kp);
  const items=[]; const ids=new Map();
  for(let i=0;i<400;i++){const s=sch.serve({kpId:kp,form,difficulty:d,seq:seq++,avoidFamilies:m.refusedFamilies(kp,form),avoidItemIds:[]},itemBank,{dry:true}); if(!s)break; items.push(s.item); ids.set(s.item.id,(ids.get(s.item.id)??0)+1);}
  const cand=new Set(["0","1","x","always","none"]); for(const it of items){const s=spell(it); if(s!=null)cand.add(String(s));}
  let best=0,ans=null; for(const c of cand){let h=0;for(const it of items)if(mark(it,c))h++; if(h>best){best=h;ans=c;}}
  const top=Math.max(...ids.values())/items.length;
  console.log(`${(kp+"|"+form).padEnd(38)}${m.probeItemBlindRate(kp,form).toFixed(4).padEnd(12)}${String(ids.size).padEnd(13)}${top.toFixed(3).padEnd(14)}${JSON.stringify(ans).padEnd(22)}${(best/items.length).toFixed(3)}`);
}
