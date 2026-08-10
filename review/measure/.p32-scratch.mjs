import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";

const ROOT = resolve(process.cwd());
const GRAPH = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const M = GRAPH.model;
const caps = M.bkt.identifiabilityCaps;
const scoredForms = ["construct", "repair", "generate"];
const scoredPhases = ["solo", "guided-1"];
const multByForm = M.guessByForm;
const multByPhase = M.guessByPhase;
const trueByForm = M.trueGuessByForm;
const trueByPhase = M.trueGuessByPhase;

function refuseReason(band, form, blind, blindUpper) {
  if (blind > caps.maxTrueGuess) return `blind>${caps.maxTrueGuess}`;
  if (blind + caps.maxSlip >= caps.maxSlipPlusGuess) return `blind+slip`;
  for (const phase of scoredPhases) {
    const base = band.guess * Math.max(multByForm[form] ?? 1, multByPhase[phase] ?? 1);
    const modelled = Math.max(base, blindUpper);
    const trueRate = Math.max(trueByForm[form] ?? 0, trueByPhase[phase] ?? 0, blind);
    if (modelled < trueRate) return `modelled<true@${phase}`;
    if (modelled > caps.maxGuess) return `modelled ${modelled.toFixed(3)}>maxGuess@${phase}`;
    if (modelled + caps.maxSlip >= caps.maxSlipPlusGuess) return `price+slip@${phase}`;
  }
  return null;
}

function run(mode) {
  const familyIndex = {};
  for (const [key, rec] of Object.entries(AUDIT.families)) {
    const cut = key.lastIndexOf("|");
    const rate = mode === "now" ? rec.rate : Math.max(...Object.values(rec.sources).map((s) => s.rate), rec.rate);
    const upper = mode === "now" ? rec.upper : Math.max(...Object.values(rec.sources).map((s) => s.upper), rec.upper);
    (familyIndex[key.slice(0, cut)] ??= []).push({ family: key.slice(cut + 1), rate, upper, n: rec.n });
  }
  const cells = {};
  let refusedCount = 0;
  for (const kpId of GRAPH.ids) {
    const band = GRAPH.band(kpId);
    for (const form of scoredForms) {
      const cell = `${kpId}|${form}`;
      const fams = familyIndex[cell];
      if (!fams) { cells[cell] = { priceable: false }; continue; }
      const kept = [];
      const refused = [];
      for (const f of fams) {
        const r = refuseReason(band, form, f.rate, f.upper);
        if (r) { refused.push(f.family); refusedCount++; } else kept.push(f);
      }
      cells[cell] = {
        priceable: kept.length > 0,
        blind: kept.length ? Math.max(...kept.map((x) => x.rate)) : 1,
        blindUpper: kept.length ? Math.max(...kept.map((x) => x.upper)) : 1,
        refused: refused.length,
        total: fams.length,
      };
    }
  }
  const unmasterable = GRAPH.ids.filter((id) => !scoredForms.some((f) => cells[`${id}|${f}`]?.priceable));
  const oneForm = GRAPH.ids.filter((id) => scoredForms.filter((f) => cells[`${id}|${f}`]?.priceable).length === 1);
  return { cells, refusedCount, unmasterable, oneForm };
}

for (const mode of ["now", "max"]) {
  const r = run(mode);
  console.log(`${mode}: refusedFamilies ${r.refusedCount}/161  unmasterable [${r.unmasterable.join(",")}]  single-form [${r.oneForm.join(",")}]`);
}

// probe length under each mode
function probeLen(cells, id) {
  const forms = scoredForms.filter((f) => cells[`${id}|${f}`]?.priceable && ["construct", "repair", "generate"].includes(f));
  if (!forms.length) return null;
  const rated = forms
    .map((f) => ({ f, rate: Math.max(trueByForm[f] ?? 0, trueByPhase.solo ?? 0, Math.max(cells[`${id}|${f}`].blind, cells[`${id}|${f}`].blindUpper)) }))
    .sort((a, b) => a.rate - b.rate);
  let bp = 1;
  for (let i = 0; i < 6; i++) {
    bp *= rated[i % rated.length].rate;
    if (i + 1 >= 3 && bp <= 1e-3) return { items: i + 1, bp };
  }
  return null;
}
for (const mode of ["now", "max"]) {
  const { cells } = run(mode);
  const plans = GRAPH.ids.map((id) => ({ id, p: probeLen(cells, id) }));
  const el = plans.filter((x) => x.p);
  const lens = el.map((x) => x.p.items).sort((a, b) => a - b);
  console.log(`${mode}: eligible ${el.length}/32 lens min ${lens[0]} median ${lens[Math.floor(lens.length / 2)]} max ${lens[lens.length - 1]}`);
}
