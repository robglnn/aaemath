import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
const rj=(p)=>JSON.parse(readFileSync("C:/dev/math/aaemath/"+p,"utf8"));
const g=new Graph(rj("content/knowledge-graph.json"));
const t={ms:Date.UTC(2026,2,3,15,0,0)};
const m=new Mastery(g,{now:()=>t.ms/60000,storage:null,emit:()=>{},bankAudit:rj("app/src/learn/bank-audit.json")});
const sch=new Scheduler(m,{clock:{minutes:()=>t.ms/60000,advance(){},real:true},seed:7,sessionMinutes:25});
const learning={mastery:m,scheduler:sch,graph:g,next:()=>sch.next(),submit:(r,o)=>sch.submit(r,o),beginSession:()=>sch.beginSession(),endSession:()=>sch.endSession()};
let rr=12345; const rng=()=>{rr^=rr<<13;rr>>>=0;rr^=rr>>17;rr^=rr<<5;rr>>>=0;return rr/4294967296;};
let ses=null;
const seen=new Map();
for(let n=0;n<10;n++){
  t.ms += 20*3600*1000;
  ses=new Session({learning,now:()=>t.ms,emit:()=>{}}); ses.begin();
  for(let k=0;k<800;k++){ const req=ses.next(); if(!req)break;
    seen.set(req.kpId,(seen.get(req.kpId)??0)+1);
    const ms=8000; t.ms+=ms;
    ses.submit(req,{correct:true,latencyMs:ms,itemId:`${req.kpId}#${req.seq}`,hinted:req.hinted});
    t.ms+=4000;}
  if(ses.phase!=="closed") ses.close("g");
  const st={}; for(const id of g.ids){const s=m.status(id); st[s]=(st[s]??0)+1;}
  console.log(`sitting ${n+1}: ${ses.elapsedSeconds/60|0}min items=${ses.itemsServed} statuses=${JSON.stringify(st)} certified=${ses.tally.certified.length} set=${ses.tally.set.length} closing="${ses.closing.map(l=>l.source).join(' | ')}"`);
}
console.log("\nKPs ever served (perfect learner, 10 sittings):");
console.log([...seen.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  "));
console.log("total distinct:",seen.size,"of",g.ids.length);
const s0=[...seen.keys()][0];
console.log("\nstate of a served kp:",JSON.stringify(m.stateOf(s0)).slice(0,600));
console.log("\nmasteryFormsFor:", g.ids.map(id=>`${id}:${m.masteryFormsFor(id).length}`).join(" "));
