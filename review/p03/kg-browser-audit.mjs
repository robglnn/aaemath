/**
 * P03 — prove the shipped content parses and audits correctly INSIDE the real app, in the real
 * browser, not just under node. Draws the audit as an overlay over the live render and captures it.
 *
 *   node review/p03/kg-browser-audit.mjs
 *
 * Round 2 adds the form-gate columns, because "the JSON parses" was never the interesting claim —
 * the interesting claim is that the fields P16 will read to refuse a judge2 item are actually
 * present in the bytes the browser loads.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

// vite's root is app/, so content/ is outside it and has to be reached through the /@fs/ escape.
const pageScript = `
  const BASE = ${JSON.stringify("/@fs/" + root.replace(/\\/g, "/"))};
  const done = (async () => {
    const kg = await (await fetch(BASE + '/content/knowledge-graph.json')).json();
    const st = await (await fetch(BASE + '/content/standards.json')).json();
    const M = kg.model;
    const byId = new Map(kg.nodes.map(n => [n.id, n]));
    let edges = 0, misc = 0, badPrereq = 0, badStandard = 0, noStandard = 0, inversions = 0;
    const sigs = new Set(); let dupSig = 0; let closedQuestion = 0;
    for (const n of kg.nodes) {
      edges += n.prerequisites.length;
      misc += n.misconceptions.length;
      for (const p of n.prerequisites) {
        if (!byId.has(p)) badPrereq++;
        else if (byId.get(p).difficulty > n.difficulty) inversions++;
      }
      if (!(n.standards && n.standards.length)) noStandard++;
      for (const c of (n.standards ?? [])) if (!st.codes[c]) badStandard++;
      for (const m of n.misconceptions) {
        if (sigs.has(m.diagnosticSignature)) dupSig++;
        sigs.add(m.diagnosticSignature);
        if (/response\\s*==\\s*(true|false)\\b/i.test(m.diagnosticSignature)) closedQuestion++;
        if (/item:\\s*'?(is|are|does|can)\\b/i.test(m.diagnosticSignature)) closedQuestion++;
      }
    }
    // Recompute the scorable form set from the caps, in the browser, from the shipped bytes.
    const caps = M.bkt.identifiabilityCaps;
    const derived = [];
    for (const [form, tg] of Object.entries(M.trueGuessByForm)) {
      if (typeof tg !== 'number') continue;
      const mult = M.guessByForm[form];
      let ok = tg <= caps.maxTrueGuess && tg + caps.maxSlip < caps.maxSlipPlusGuess;
      for (const b of M.bands) {
        const modelled = b.guess * mult;
        if (modelled < tg || modelled > caps.maxGuess || modelled + b.slip >= caps.maxSlipPlusGuess) ok = false;
      }
      if (ok) derived.push(form);
    }
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));

    const rows = [
      ['nodes', kg.nodes.length],
      ['prerequisiteEdges', edges],
      ['misconceptions', misc],
      ['duplicateSignatures', dupSig],
      ['closedQuestionSignatures', closedQuestion],
      ['standardsCodes', Object.keys(st.codes).length],
      ['frameworks', st.frameworks.length],
      ['nodesWithBadPrereq', badPrereq],
      ['nodesWithBadStandard', badStandard],
      ['nodesWithNoStandard', noStandard],
      ['bandInversions', inversions],
      ['codesNeedingVerification', Object.values(st.codes).filter(c => c.verification === 'NEEDS_VERIFICATION').length],
      ['estMinutesTotal', kg.nodes.reduce((a, n) => a + n.estMinutes, 0)],
      ['SEP', ''],
      ['masteryThreshold', M.bkt.masteryThreshold],
      ['minScored / atBand / forms', M.bkt.minScoredOpportunities + ' / ' + M.bkt.minAtBandOpportunities + ' / ' + M.bkt.minDistinctItemForms],
      ['forms.scored', M.forms.scored.join(', ')],
      ['forms.unscored (never scored)', M.forms.unscored.join(', ')],
      ['formsEligibleForMastery', M.bkt.formsEligibleForMastery.join(', ')],
      ['retentionCheck.forms', M.spacing.retentionCheck.forms.join(', ')],
      ['trueGuess judge2 / select4', M.trueGuessByForm.judge2 + ' / ' + M.trueGuessByForm.select4],
      ['clampTrueRates', String(caps.clampTrueRates)],
      ['relearn cap / requiresPriorMastery', M.spacing.relearnLearnRateCap + ' / ' + String(M.spacing.relearnRequiresPriorMastery)],
      ['scorable set derived in-browser', derived.join(', ')],
      ['derivation matches shipped arrays', String(same(derived, M.forms.scored) && same(derived, M.bkt.formsEligibleForMastery))],
    ];

    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:26px;top:22px;z-index:99999;background:rgba(6,14,26,0.94);' +
      'border:1px solid #6fb2ff;border-radius:10px;padding:22px 28px;color:#dceaff;' +
      "font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre;box-shadow:0 12px 40px rgba(0,0,0,.5)";
    el.textContent = 'P03 content audit  -  parsed by the real app, in the real browser\\n\\n' +
      rows.map(([k, v]) => (k === 'SEP' ? '' : k.padEnd(38) + String(v))).join('\\n');
    document.body.appendChild(el);
  })();
  return done;
`;

// review.mjs splits --script on "|", and the audit code needs || and regex alternation. Ship it
// base64-encoded (an alphabet with no pipe in it) and let the page decode it.
const b64 = Buffer.from(pageScript, "utf8").toString("base64");
const outPath = "review/p03/evidence/kg-audit-in-browser.png";
const r = spawnSync(
  process.execPath,
  [
    "tools/review.mjs",
    "shot",
    outPath,
    "--width=1400",
    "--height=900",
    `--script=eval:return (new Function(atob("${b64}")))();`,
  ],
  { cwd: root, encoding: "utf8" }
);
console.log(r.stdout || "");
console.error(r.stderr || "");
process.exit(r.status ?? 1);
