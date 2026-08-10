/**
 * CRITIC's OWN measurement of P32. Independent of review/measure/P32.mjs.
 * Rebuilds every number from the real modules + the real content + the real bank audit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, bktUpdate, PROPAGATION, TEST_OUT, REVIEW_LAPSE_BELOW } from "../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../app/src/learn/Scheduler.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KG = JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8"));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const G = new Graph(KG);
const M = G.model;
const TOTAL = G.ids.length;
const mk = (o = {}) => new Mastery(G, { bankAudit: AUDIT, storage: null, emit: () => {}, ...o });
const REF = mk();
const say = (...a) => console.log(...a);
const pct = (x) => `${(100 * x).toFixed(1)}%`;

say(`CRITIC P32 — graph ${TOTAL} nodes, audit v${AUDIT.version} fp ${AUDIT.fingerprint}, ${AUDIT.sampled} draws`);

// =================================================================================
say("\n### 1. TEST-OUT: independent per-node guesser probability, computed from bank-audit.json directly");
// =================================================================================
// Rebuild the family index myself, apply the caps myself, and price the probe myself.
const famIdx = {};
for (const [k, r] of Object.entries(AUDIT.families ?? {})) {
  const c = k.lastIndexOf("|");
  (famIdx[k.slice(0, c)] ??= []).push({ family: k.slice(c + 1), ...r });
}
const caps = M.bkt.identifiabilityCaps;
const masteryForms = M.bkt.formsEligibleForMastery;
const myPlan = {};
let worstShipped = 0, worstShippedId = null;
let worstIfFamiliesIgnored = 0, worstIgnoreId = null;
for (const id of G.ids) {
  const band = G.band(id);
  const rated = [];
  const ratedAll = [];
  for (const form of masteryForms) {
    const fams = famIdx[`${id}|${form}`];
    if (!fams?.length) continue;
    const kept = fams.filter((f) => {
      if (f.rate > caps.maxTrueGuess) return false;
      if (f.rate + caps.maxSlip >= caps.maxSlipPlusGuess) return false;
      const base = band.guess * (M.guessByForm[form] ?? 1);
      const modelled = Math.max(base, f.upper);
      if (modelled < Math.max(M.trueGuessByForm[form] ?? 0, f.rate)) return false;
      if (modelled > caps.maxGuess) return false;
      if (modelled + caps.maxSlip >= caps.maxSlipPlusGuess) return false;
      return true;
    });
    if (!kept.length) continue;
    rated.push({ form, rate: Math.max(...kept.map((f) => Math.max(f.rate, f.upper))) });
    ratedAll.push({ form, rate: Math.max(...fams.map((f) => Math.max(f.rate, f.upper))) });
  }
  if (!rated.length) { myPlan[id] = { eligible: false }; continue; }
  rated.sort((a, b) => a.rate - b.rate);
  ratedAll.sort((a, b) => a.rate - b.rate);
  let seq = [], bp = 1, ok = false;
  for (let i = 0; i < TEST_OUT.maxItems; i++) {
    seq.push(rated[i % rated.length]);
    bp *= rated[i % rated.length].rate;
    if (seq.length >= TEST_OUT.minItems && bp <= TEST_OUT.maxBlindPass) { ok = true; break; }
  }
  myPlan[id] = { eligible: ok, items: seq.length, blindPass: bp, forms: seq.map((s) => s.form) };
  if (ok) {
    if (bp > worstShipped) { worstShipped = bp; worstShippedId = id; }
    // What the SAME probe is worth if the presenter serves refused families too.
    let bad = 1;
    for (let i = 0; i < seq.length; i++) bad *= (ratedAll.find((r) => r.form === seq[i].form)?.rate ?? 1);
    if (bad > worstIfFamiliesIgnored) { worstIfFamiliesIgnored = bad; worstIgnoreId = id; }
  }
}
// cross-check against the engine
let disagree = 0;
for (const id of G.ids) {
  const p = REF.testOutPlan(id);
  const mine = myPlan[id];
  if (!!p.eligible !== !!mine.eligible) { disagree++; say(`  DISAGREE eligibility ${id}: engine ${p.eligible} mine ${mine.eligible}`); continue; }
  if (p.eligible && (p.items !== mine.items || Math.abs(p.blindPass - mine.blindPass) > 1e-6)) {
    disagree++; say(`  DISAGREE ${id}: engine ${p.items}/${p.blindPass} mine ${mine.items}/${mine.blindPass.toExponential(2)}`);
  }
}
say(`  independent re-derivation agrees with the engine on ${TOTAL - disagree}/${TOTAL} nodes`);
say(`  WORST guesser pass, shipped pricing:      ${worstShipped.toExponential(3)} on ${worstShippedId}  (bound ${TEST_OUT.maxBlindPass})`);
say(`  WORST guesser pass IF refused families are served: ${worstIfFamiliesIgnored.toExponential(3)} on ${worstIgnoreId}`);
const inelig = G.ids.filter((id) => !REF.testOutPlan(id).eligible);
say(`  ineligible: ${inelig.join(", ") || "none"}; named in issues: ${inelig.every((id) => REF.issues.some((i) => i.includes(`"${id}"`)))}`);
say(`  forms used across all probes: ${[...new Set(G.ids.flatMap((id) => REF.testOutPlan(id).forms ?? []))].join(", ")}`);
say(`  formsEligibleForMastery = ${masteryForms.join(", ")}; select/judge present in any probe: ${G.ids.some((id) => (REF.testOutPlan(id).forms ?? []).some((f) => !masteryForms.includes(f)))}`);
// per-item worst
const perItemWorst = Math.max(...G.ids.flatMap((id) => REF.masteryFormsFor(id).map((f) => REF.probeItemBlindRate(id, f))));
say(`  worst single probe item blind rate anywhere: ${perItemWorst.toFixed(3)} (design constant for construct: ${M.trueGuessByForm.construct})`);
say(`  coin-flip check: any probe passable at >= 0.5? ${G.ids.some((id) => (REF.testOutPlan(id).blindPass ?? 0) >= 0.5)}`);

// =================================================================================
say("\n### 2. PROPAGATION: adversarial orderings, my own exhaustive sweep");
// =================================================================================
// 2a. Random adversarial sequences: 400 runs, random node order, random correctness,
//     random forms/phases, and after each response verify no non-ancestor moved.
{
  const rng = mulberry32(0xC0FFEE);
  let violations = 0, moves = 0, descMoves = 0, ceilBreach = 0, counterBreach = 0;
  for (let run = 0; run < 300; run++) {
    const m = mk();
    for (let step = 0; step < 60; step++) {
      const id = G.ids[Math.floor(rng() * TOTAL)];
      const forms = m.masteryFormsFor(id);
      const form = forms.length ? forms[Math.floor(rng() * forms.length)] : "select4";
      const phase = ["solo", "guided-3", "guided-2", "model"][Math.floor(rng() * 4)];
      const before = G.ids.map((x) => m.p(x));
      const beforeCnt = G.ids.map((x) => { const s = m.stateOf(x); return `${s.scored}|${s.atBand}|${s.forms.length}`; });
      m.respond({ kpId: id, form, phase, mode: "acquire", correct: rng() < 0.8, latencyMs: 3000 + rng() * 12000, difficulty: G.centre(id) + rng() - 0.3 });
      const anc = G.ancestors(id), desc = G.descendants(id);
      G.ids.forEach((x, i) => {
        if (x === id) return;
        if (m.p(x) !== before[i]) {
          moves++;
          if (!anc.has(x)) violations++;
          if (desc.has(x)) descMoves++;
          if (m.p(x) > PROPAGATION.ceiling + 1e-9 && before[i] <= PROPAGATION.ceiling) ceilBreach++;
        }
        const s = m.stateOf(x);
        if (`${s.scored}|${s.atBand}|${s.forms.length}` !== beforeCnt[i]) counterBreach++;
      });
    }
  }
  say(`  300 adversarial runs x 60 random responses: ${moves} propagated moves`);
  say(`  moves onto a NON-ancestor: ${violations}   onto a DESCENDANT: ${descMoves}`);
  say(`  posterior pushed past ceiling ${PROPAGATION.ceiling} by propagation: ${ceilBreach}`);
  say(`  M2/M3 counter touched on a non-target node: ${counterBreach}`);
}

// 2b. THE REAL QUESTION: does propagation lower the OWN-EVIDENCE bar for certification?
//     Compare how many own correct answers a node needs to certify from prior vs from the ceiling.
{
  const rows = [];
  for (const id of G.ids) {
    const band = G.band(id);
    const forms = REF.masteryFormsFor(id);
    if (!forms.length) continue;
    const need = (start) => {
      // all-correct march from `start`, count items until M1 && M2 && M3
      let p = start, n = 0, atBand = 0;
      const seen = new Set();
      while (n < 40) {
        n++; atBand++; seen.add(forms[(n - 1) % forms.length]);
        const guess = Math.max(band.guess * (M.guessByForm[forms[(n - 1) % forms.length]] ?? 1), REF.cell(id, forms[(n - 1) % forms.length])?.blindUpper ?? 0);
        p = bktUpdate(p, true, band.slip, guess, band.learn, 1);
        if (p >= M.bkt.masteryThreshold && n >= M.bkt.minScoredOpportunities && atBand >= M.bkt.minAtBandOpportunities && seen.size >= REF.requiredDistinctForms(id)) return n;
      }
      return null;
    };
    rows.push({ id, fromPrior: need(band.prior), fromCeiling: need(PROPAGATION.ceiling) });
  }
  const same = rows.filter((r) => r.fromPrior === r.fromCeiling).length;
  say(`  own-evidence items needed to certify, from band prior vs from a propagation-preloaded 0.90:`);
  say(`    identical on ${same}/${rows.length} nodes (M2's 6-opportunity floor dominates M1 in both cases)`);
  const diff = rows.filter((r) => r.fromPrior !== r.fromCeiling);
  if (diff.length) say(`    differs on: ${diff.map((r) => `${r.id} ${r.fromPrior}->${r.fromCeiling}`).join(", ")}`);
}

// 2c. Worst-case adversarial ordering: maximise credit onto one target ancestor.
{
  // pick the node with the most descendants, hammer every descendant within distance 3.
  const target = G.ids.map((id) => ({ id, d: G.descendants(id).size })).sort((a, b) => b.d - a.d)[0].id;
  const m = mk();
  const donors = G.ids.filter((id) => G.ancestors(id).has(target) && G.distanceToAncestor(id, target) <= PROPAGATION.maxDistance);
  for (let round = 0; round < 500; round++) {
    for (const d of donors) {
      const f = m.masteryFormsFor(d)[0];
      if (!f) continue;
      m.respond({ kpId: d, form: f, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: G.centre(d) + 0.3 });
    }
  }
  const s = m.stateOf(target);
  say(`  saturation attack on "${target}" (${G.descendants(target).size} descendants, ${donors.length} in-range donors, 500 rounds):`);
  say(`    p=${m.p(target).toFixed(4)} status=${m.status(target)} scored=${s.scored} atBand=${s.atBand} forms=${s.forms.length} everUnlocked=${m.everUnlocked(target)}`);
  say(`    testOutOffered("${target}") after the attack: ${m.testOutOffered(target)}  (trigger ${m.testOutTrigger(target)})`);
  // then the attacker takes the probe blind
  const plan = REF.testOutPlan(target);
  say(`    -> that probe is ${plan.items} items, blind pass ${plan.blindPass?.toExponential(2)}`);
}

// =================================================================================
say("\n### 3. MY OWN ARCHETYPE SIMULATION (independent responder model)");
// =================================================================================
/**
 * My responder model, deliberately DIFFERENT from the builder's:
 *  - a holder answers correctly with prob (1 - slip) exactly, no ability inflation
 *  - a non-holder answers at the MEASURED blind rate of the served cell (not band.guess),
 *    which is strictly more generous to the engine's critics than band.guess
 *  - learning: a non-holder acquires with prob band.learn on any item whose phase teaches
 *  - the pure guesser holds nothing and never learns
 */
function responder(kind, rng) {
  const holds = new Map();
  for (const id of G.ids) {
    if (kind === "guesser") holds.set(id, false);
    else if (kind === "strong") holds.set(id, true);
    else if (kind === "advancedOnly") holds.set(id, G.difficulty(id) >= 4);
    else holds.set(id, rng() < G.band(id).prior);
  }
  return {
    holds,
    answer(req) {
      const band = G.band(req.kpId);
      if (kind !== "guesser" && !holds.get(req.kpId) && rng() < band.learn) holds.set(req.kpId, true);
      const blind = Math.max(REF.probeItemBlindRate(req.kpId, req.form), M.trueGuessByPhase?.[req.phase] ?? 0);
      const correct = holds.get(req.kpId) ? rng() >= band.slip : rng() < blind;
      return { correct, latencyMs: 5000 + rng() * 8000, hinted: req.hinted, itemId: `${req.kpId}#${req.seq}` };
    },
  };
}
function run(kind, seed, sessions, arm = {}) {
  const clock = virtualClock(0);
  const m = mk({ now: () => clock.minutes(), ...arm });
  const sch = new Scheduler(m, { clock, rng: mulberry32(seed ^ 0x1234), sessionMinutes: 25 });
  const r = responder(kind, mulberry32(seed));
  let sec = 0, probeSec = 0, items = 0;
  const firstAt = [];
  for (let s = 0; s < sessions; s++) {
    clock.set(s * 1440);
    sch.beginSession();
    for (;;) {
      const req = sch.next();
      if (!req) break;
      items++;
      if (req.testOut) probeSec += req.seconds;
      sch.submit(req, r.answer(req));
    }
    sch.endSession();
    sec += sch.secondsSpent;
    firstAt.push({ s: s + 1, mastered: G.ids.filter((id) => m.status(id) === "mastered").length, min: sec / 60 });
  }
  const t = m.probe().testOut;
  return {
    m, items, minutes: sec / 60, probeMinutes: probeSec / 60,
    mastered: G.ids.filter((id) => m.status(id) === "mastered").length,
    offered: t.offered, passed: t.passed, failed: t.failed, itemsSpent: t.itemsSpent,
    trace: firstAt,
  };
}
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const N = 60, SESS = 26;
for (const kind of ["strong", "median", "struggler", "advancedOnly"]) {
  const rs = []; for (let i = 0; i < N; i++) rs.push(run(kind, 900 + i * 131, SESS));
  const need = Math.ceil(0.8 * TOTAL);
  const to80 = rs.map((r) => r.trace.find((t) => t.mastered >= need)?.min ?? null);
  const sess80 = rs.map((r) => r.trace.find((t) => t.mastered >= need)?.s ?? null);
  say(`  ${kind.padEnd(13)} mastered ${med(rs.map(r=>r.mastered))}/${TOTAL} (${pct(rs.reduce((a,r)=>a+r.mastered,0)/(N*TOTAL))})  ` +
      `min->80% ${med(to80)?.toFixed(0) ?? "never"}  sess->80% ${med(sess80) ?? "never"}  ` +
      `probes ${(rs.reduce((a,r)=>a+r.offered,0)/N).toFixed(1)} off / ${(rs.reduce((a,r)=>a+r.passed,0)/N).toFixed(1)} pass ` +
      `(${pct(rs.reduce((a,r)=>a+r.passed,0)/Math.max(1,rs.reduce((a,r)=>a+r.offered,0)))})  ` +
      `total ${med(rs.map(r=>r.minutes)).toFixed(0)} min / ${med(rs.map(r=>r.items))} items`);
}
// strong learner: shipped vs test-out disabled
{
  const a = [], b = [];
  for (let i = 0; i < N; i++) { a.push(run("strong", 900 + i * 131, SESS)); b.push(run("strong", 900 + i * 131, SESS, { testOut: { enabled: false } })); }
  say(`  strong shipped vs probe-OFF: ${med(a.map(r=>r.minutes)).toFixed(0)} vs ${med(b.map(r=>r.minutes)).toFixed(0)} total min; ` +
      `mastered ${med(a.map(r=>r.mastered))} vs ${med(b.map(r=>r.mastered))}`);
  const full = a.map(r => r.trace.find(t => t.mastered >= 31)?.min ?? null);
  const fullB = b.map(r => r.trace.find(t => t.mastered >= 31)?.min ?? null);
  const sesA = a.map(r => r.trace.find(t => t.mastered >= 31)?.s ?? null);
  const sesB = b.map(r => r.trace.find(t => t.mastered >= 31)?.s ?? null);
  say(`  strong to ALL 31: ${med(full)?.toFixed(0) ?? "never"} min / ${med(sesA) ?? "-"} sessions  vs  ${med(fullB)?.toFixed(0) ?? "never"} min / ${med(sesB) ?? "-"} sessions`);
}

// =================================================================================
say("\n### 4. PURE GUESSER, my own bot, through the real Scheduler");
// =================================================================================
{
  const NB = 1500;
  let offered = 0, passed = 0, certified = 0, botsCert = 0, unlockedViaProbe = 0;
  for (let i = 0; i < NB; i++) {
    const r = run("guesser", 40000 + i * 977, SESS);
    offered += r.offered; passed += r.passed; certified += r.mastered;
    if (r.mastered > 0) botsCert++;
    unlockedViaProbe += G.ids.filter((id) => r.m.stateOf(id).unlockedVia === "test-out").length;
  }
  say(`  ${NB} pure guessers x ${SESS} sessions: ${offered} probes offered, ${passed} passed (${(passed/Math.max(1,offered)).toExponential(2)} vs bound ${TEST_OUT.maxBlindPass})`);
  say(`  probe-unlocked nodes: ${unlockedViaProbe};  KPs certified total ${certified} (mean ${(certified/NB).toFixed(4)}), bots certifying anything: ${botsCert}/${NB}`);
}

// =================================================================================
say("\n### 5. GENUINE-MASTER FALSE-NEGATIVE RATE (the cost of all-correct)");
// =================================================================================
{
  const rows = G.ids.filter((id) => REF.testOutPlan(id).eligible).map((id) => {
    const plan = REF.testOutPlan(id);
    const slip = G.band(id).slip;
    // the probe sits +0.3 above centre; use the plain slip (generous to the design)
    return { id, band: G.difficulty(id), items: plan.items, pass: (1 - slip) ** plan.items, minutes: plan.items * 46 / 60 };
  });
  const mean = rows.reduce((a, r) => a + r.pass, 0) / rows.length;
  say(`  a learner who genuinely holds the skill passes their own probe ${pct(mean)} of the time (mean over ${rows.length} nodes)`);
  say(`  by band: ${[1,2,3,4,5].map(b=>{const s=rows.filter(r=>r.band===b);return s.length?`${b}:${pct(s.reduce((a,r)=>a+r.pass,0)/s.length)}`:`${b}:-`}).join("  ")}`);
  say(`  probe MINUTES: min ${Math.min(...rows.map(r=>r.minutes)).toFixed(1)}  median ${rows.map(r=>r.minutes).sort((a,b)=>a-b)[Math.floor(rows.length/2)].toFixed(1)}  max ${Math.max(...rows.map(r=>r.minutes)).toFixed(1)}`);
  say(`  nodes whose probe is <= 2.0 min: ${rows.filter(r=>r.minutes<=2.0).length}/${rows.length}`);
  say(`  EXPECTED minutes for a genuine master to test out of one node, incl. re-teach on failure:`);
  const reteach = (4 + M.bkt.minScoredOpportunities) * 46 / 60;
  const exp = rows.reduce((a, r) => a + (r.pass * r.minutes + (1 - r.pass) * (r.minutes / 2 + reteach)), 0) / rows.length;
  say(`    ${exp.toFixed(1)} min/node (probe ${(rows.reduce((a,r)=>a+r.minutes,0)/rows.length).toFixed(1)} min, re-teach fallback ${reteach.toFixed(1)} min, no retry ever)`);
}
