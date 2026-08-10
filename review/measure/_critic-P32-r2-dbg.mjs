import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { virtualClock } from "../../app/src/learn/Scheduler.js";
const R="C:/dev/math/aaemath/";
const GRAPH=new Graph(JSON.parse(readFileSync(R+"content/knowledge-graph.json","utf8")));
const AUDIT=JSON.parse(readFileSync(R+"app/src/learn/bank-audit.json","utf8"));
const clock=virtualClock(0);
const m=new Mastery(GRAPH,{bankAudit:AUDIT,storage:null,now:()=>clock.minutes()});
const src="eq-both-sides";
console.log("band",GRAPH.difficulty(src),"prereqs",JSON.stringify(GRAPH.prerequisites(src)),"cone",JSON.stringify([...GRAPH.ancestorDistances(src)]));
const forms=m.deliverableMasteryForms(src); console.log("forms",forms);
const fam=Object.entries(m.cell(src,forms[0])?.families??{}).find(([,r])=>r.priceable)?.[0];
for(let i=0;i<4;i++){
 clock.set(3*(i+1));
 const out=m.respond({kpId:src,form:forms[0],phase:"solo",difficulty:GRAPH.centre(src)+0.3,mode:"acquire"},{correct:true,latencyMs:6000,hinted:false,family:fam});
 console.log(i,"scored",out.scored,"credited",out.credited,"reason",out.reason,"p",out.p,"propagated",JSON.stringify(out.propagated));
}
console.log("stats",JSON.stringify(m.stats.creditsByDistance),"prereqCredits",m.stats.prerequisiteCredits);
console.log("_exercised default for band4:",JSON.stringify(m._exercised({},{id:src,prerequisites:GRAPH.prerequisites(src)})));
console.log("\nmasteryForms",[...m.pricing.masteryForms],"masteryPhases",[...m.pricing.masteryPhases],"scoredPhases",[...m.pricing.scoredPhases]);
console.log("fam used:",fam,"cellPriceable",m.isCellPriceable(src,forms[0]),"famPriceable",m.isFamilyPriceable(src,forms[0],fam));
console.log("isMasteryEligible solo:",m.isMasteryEligible(src,forms[0],"solo",fam));
console.log("modelledGuess:",m.modelledGuess(src,GRAPH.band(src),forms[0],"solo",fam),"band",JSON.stringify(GRAPH.band(src)));
console.log("cell:",JSON.stringify(m.cell(src,forms[0])));
