// Scratch diagnostic: where do a median learner's items actually go?
import { readFileSync } from "node:fs";
const g = JSON.parse(readFileSync("content/knowledge-graph.json","utf8"));
const M=g.model;
console.log("soloThreshold",M.phases.soloThreshold,"modelThresh",M.phases.modelPhaseThreshold);
// P after one correct guided-1 from the band prior
for(const b of M.bands){
  const guess=b.guess*Math.max(1,M.guessByPhase["guided-1"]);
  const post=(b.prior*(1-b.slip))/(b.prior*(1-b.slip)+(1-b.prior)*guess);
  const p=post+(1-post)*b.learn;
  const guessSolo=b.guess;
  const postS=(b.prior*(1-b.slip))/(b.prior*(1-b.slip)+(1-b.prior)*guessSolo);
  const pS=postS+(1-postS)*b.learn;
  console.log("band",b.difficulty,"P after 1 correct guided-1:",p.toFixed(4),"  solo:",pS.toFixed(4),"  shortcut fires:",p>=M.phases.soloThreshold);
}
