import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
const rj=(p)=>JSON.parse(readFileSync(new URL("../../"+p,import.meta.url),"utf8"));
const g=new Graph(rj("content/knowledge-graph.json"));
const t={ms:Date.UTC(2026,2,3,15,0,0)};
const m=new Mastery(g,{now:()=>t.ms/60000,storage:null,emit:()=>{},bankAudit:rj("app/src/learn/bank-audit.json")});
const sch=new Scheduler(m,{clock:{minutes:()=>t.ms/60000,advance(){},real:true},seed:7,sessionMinutes:25});
const seen=new Map(); const reasons=new Map();
for(let n=0;n<10;n++){ t.ms+=20*3600*1000; sch.beginSession();
  for(let k=0;k<800;k++){ const req=sch.next(); if(!req)break;
    seen.set(req.kpId,(seen.get(req.kpId)??0)+1); t.ms+=45000;
    const res=sch.submit(req,{correct:true,latencyMs:45000,itemId:`${req.kpId}#${req.seq}`,hinted:req.hinted});
    if(res && res.scored===false) reasons.set(res.reason??res.why??JSON.stringify(Object.keys(res)),(reasons.get(res.reason??res.why??JSON.stringify(Object.keys(res)))??0)+1);
    t.ms+=4000;}
  sch.endSession(); }
const st={}; for(const id of g.ids){const s=m.status(id); st[s]=(st[s]??0)+1;}
console.log("BASELINE (no Session layer), perfect learner, 10 sittings");
console.log("statuses:",JSON.stringify(st));
console.log("distinct kps served:",seen.size,"of",g.ids.length,"->",[...seen.entries()].map(([k,v])=>`${k}:${v}`).join("  "));
console.log("unscored reasons:",[...reasons.entries()].map(([k,v])=>`${k}=${v}`).join("  "));
const s=m.stateOf([...seen.keys()][0]);
console.log("first kp scored/unscored:",s.scored,"/",s.unscored,"attempts",s.attempts,"p",s.p);
