// Self-check design/palette.json for internal arithmetic and for agreement with
// design/art-direction.md. Everything a critic machine-checked in round 2, plus
// the round-3 additions.
//
//   node review/p02-r3-selfcheck.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = JSON.parse(readFileSync(path.join(ROOT, 'design', 'palette.json'), 'utf8'));
const DOC = readFileSync(path.join(ROOT, 'design', 'art-direction.md'), 'utf8');
const fails = [];
const ok = [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const hsvOf = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx / 255];
};

// ── every colour entry: hex vs rgb vs linear vs luminance vs hsv ─────────────
let n = 0;
const walk = (o, where) => {
  if (o && typeof o === 'object') {
    if (typeof o.hex === 'string' && Array.isArray(o.rgb)) {
      n++;
      const m = /^#([0-9A-Fa-f]{6})$/.exec(o.hex);
      if (!m) { fails.push(`${where}: bad hex ${o.hex}`); return; }
      const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
      if (o.rgb[0] !== r || o.rgb[1] !== g || o.rgb[2] !== b) fails.push(`${where}: rgb != hex`);
      const lin = [s2l(r), s2l(g), s2l(b)];
      if (Array.isArray(o.linear)) for (let i = 0; i < 3; i++) if (!near(o.linear[i], lin[i], 0.0006)) fails.push(`${where}: linear[${i}] ${o.linear[i]} vs ${lin[i].toFixed(4)}`);
      const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      if (typeof o.luminance === 'number' && !near(o.luminance, Y, 0.0006)) fails.push(`${where}: luminance ${o.luminance} vs ${Y.toFixed(4)}`);
      const hv = hsvOf(r, g, b);
      if (Array.isArray(o.hsv)) {
        if (!near(o.hsv[0], hv[0], 1.0) && !near(Math.abs(o.hsv[0] - hv[0]), 360, 1)) fails.push(`${where}: hue ${o.hsv[0]} vs ${hv[0].toFixed(1)}`);
        if (!near(o.hsv[1], hv[1], 0.002)) fails.push(`${where}: S ${o.hsv[1]} vs ${hv[1].toFixed(3)}`);
        if (!near(o.hsv[2], hv[2], 0.002)) fails.push(`${where}: V ${o.hsv[2]} vs ${hv[2].toFixed(3)}`);
      }
      // annotation fields used by the ramp tables
      if (typeof o.hue === 'number' && !near(o.hue, hv[0], 1.0)) fails.push(`${where}: ramp hue ${o.hue} vs ${hv[0].toFixed(1)}`);
      if (typeof o.S === 'number' && !near(o.S, hv[1], 0.006)) fails.push(`${where}: ramp S ${o.S} vs ${hv[1].toFixed(3)}`);
      if (typeof o.Y === 'number' && !near(o.Y, Y, 0.002)) fails.push(`${where}: ramp Y ${o.Y} vs ${Y.toFixed(3)}`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${where}.${k}`);
  }
};
walk(P.roles, 'roles');
walk(P.shadingRamps, 'shadingRamps');
ok.push(`${n} colour entries checked for hex/rgb/linear/luminance/hsv/ramp-annotation agreement`);

// ── hue partition tiles 0-360 with no gap and no overlap ────────────────────
{
  const cls = P.colourBudget.hueArcs.classes;
  const sat = ['warm', 'resonance', 'bridge', 'offLanguage'];
  const cover = new Array(360).fill(0);
  for (const k of sat) for (const [a, b] of cls[k].hue) for (let h = Math.round(a); h < Math.round(b); h++) cover[h % 360]++;
  const gaps = cover.filter(v => v === 0).length, overs = cover.filter(v => v > 1).length;
  if (gaps || overs) fails.push(`hue partition: ${gaps} uncovered degrees, ${overs} overlapping`);
  else ok.push('the four saturated arcs tile 0-360 exactly: no gap, no overlap');
  const inArc = (k, h) => cls[k].hue.some(([a, b]) => h >= a && h < b);
  if (!inArc('warm', 346)) fails.push('danger 346 is not inside the warm arc — the priority order is not load-bearing');
  if (!inArc('bridge', 107)) fails.push('success 107 is not inside the bridge arc');
  ok.push('danger 346 sits inside `warm`, success 107 inside `bridge`: priority order is load-bearing');
  // atmosphere gate agrees with the substance gate
  const sg = P.colourBudget.hueArcs.substanceGate;
  if (cls.atmosphere.minV !== sg.maxValueForPale) fails.push('atmosphere.minV != substanceGate.maxValueForPale');
  if (cls.atmosphere.maxS !== sg.minSaturationForBright) fails.push('atmosphere.maxS != substanceGate.minSaturationForBright');
  ok.push(`substance gate: V > ${sg.maxValueForPale} & S < ${sg.minSaturationForBright} => atmosphere, consistent with the class`);
  if (P.colourBudget.hueArcs.order[2] !== 'atmosphere' || P.colourBudget.hueArcs.order[3] !== 'muted') fails.push('priority order: atmosphere must precede muted');
}

// ── measured values sit inside their own targets ────────────────────────────
{
  const t = P.colourBudget.targets, m = P.colourBudget.measured;
  for (const [k, v] of Object.entries(m)) {
    if (!t[k]) continue;
    if (v < t[k][0] || v > t[k][1]) fails.push(`measured.${k} ${v} outside target ${JSON.stringify(t[k])}`);
  }
  ok.push('every colourBudget.measured value sits inside its own target band');
  const lh = P.luminanceHistogram;
  for (const [k, v] of Object.entries(lh.measured)) {
    const b = lh.percentileTargets[k];
    if (b && (v < b[0] || v > b[1])) fails.push(`luminance ${k} ${v} outside ${JSON.stringify(b)}`);
  }
  ok.push('every luminance percentile sits inside its target band');
}

// ── accessibility ratio is derived, not typed ───────────────────────────────
{
  const r = P.roles.success.luminance / P.roles.danger.luminance;
  if (!near(P.accessibility.stateLuminanceRatio, r, 0.01)) fails.push(`stateLuminanceRatio ${P.accessibility.stateLuminanceRatio} vs ${r.toFixed(3)}`);
  else ok.push(`accessibility.stateLuminanceRatio ${P.accessibility.stateLuminanceRatio} = success.luminance / danger.luminance = ${r.toFixed(3)}`);
}

// ── the veil fixed point IS the veil colour's luminance ─────────────────────
{
  const v = P.roles['holo.veil'];
  if (!near(v.fixedPointY, v.luminance, 0.005)) fails.push(`holo.veil.fixedPointY ${v.fixedPointY} vs its own luminance ${v.luminance}`);
  else ok.push(`holo.veil.fixedPointY ${v.fixedPointY} equals holo.veil.luminance ${v.luminance}`);
}

// ── round-3 reconciliations: one value per constant, in both files ──────────
{
  const ep = P.solvedConstants.emitterPeak;
  if (!near(ep.referenceValue.blownShareOfFrame, 0.00179, 0.00002)) fails.push('emitterPeak blown share is not the reconciled 0.00179');
  if (!DOC.includes('0.00179')) fails.push('art-direction.md does not carry the reconciled blown share 0.00179');
  else ok.push('blownShareOfFrame: one definition (Y>=0.90 AND hue 150-215), value 0.00179, in both files');
  const rw = P.solvedConstants.scrimTransmission.referenceValue.rampWidth;
  if (rw[0] !== 0.0825 || rw[1] !== 0.1325) fails.push(`scrim rampWidth ${JSON.stringify(rw)} != [0.0825, 0.1325]`);
  else if (!DOC.includes('0.0825 and 0.1325')) fails.push('art-direction.md does not quote the scrim ramps 0.0825 / 0.1325');
  else ok.push('scrim rampWidth [0.0825, 0.1325] agrees across JSON, prose and auditor output');
  const term = P.shadingRamps.curvedMetalAndSkin.stops[1];
  const armTerm = P.roles['hero.armour'].ramp[1];
  if (term.hex !== armTerm.hex) fails.push('terminator hex mismatch between shadingRamps and hero.armour.ramp');
  if (!near(term.hue, armTerm.hsv[0], 1) || !near(term.S, armTerm.hsv[1], 0.006)) fails.push(`terminator ${term.hue}/${term.S} vs hero.armour ${armTerm.hsv[0]}/${armTerm.hsv[1]}`);
  else ok.push(`terminator #68704F is hue ${term.hue} / S ${term.S} in BOTH places`);
  if (!P.shadingRamps.curvedMetalAndSkin.huePath.includes('75')) fails.push('huePath still prints the old terminator hue');
  if (!DOC.includes('185° → 75° → 32° → 35° → 58°')) fails.push('art-direction.md hue path not corrected');
}

// ── round-3 additions exist and are wired ───────────────────────────────────
{
  const MO = P.motion;
  for (const k of ['staticFrame', 'underMotion', 'ink', 'emitter', 'dither', 'specularAA', 'temporalAA', 'timeOfDay', 'skyProbeBox', 'heroSeparationFloor'])
    if (MO?.[k] === undefined) fails.push(`palette.motion.${k} missing`);
  if (MO && !near(MO.fixedStepSeconds, 1 / 60, 1e-9)) fails.push('motion.fixedStepSeconds is not the kernel step');
  if (MO) ok.push(`palette.motion present: static mean|dY| <= ${MO.staticFrame.meanDeltaY}, p99 <= ${MO.staticFrame.p99DeltaY}, pan hero area <= ${MO.underMotion.heroAreaStep}, ink <= ${MO.ink.p50StepPx} px`);
  if (!DOC.includes('## 15. Motion')) fails.push('art-direction.md has no §15 Motion');
  else ok.push('art-direction.md §15 Motion present');
  for (const id of ['M1a', 'M1b', 'M1c', 'M2', 'M3a', 'M3b', 'M4', 'M5', 'M6', 'M7'])
    if (!DOC.includes('`' + id + '`')) fails.push(`§15 does not name auditor check ${id}`);
  ok.push('all ten motion checks are named in the prose');
  for (const k of ['scene-referred', 'display-referred'])
    if (!DOC.includes(k)) fails.push(`art-direction.md never says "${k}"`);
  ok.push('pipeline stage vocabulary present');
  if (!P.solvedConstants.emitterPeak.searchBox) fails.push('emitterPeak.searchBox missing (B1a would have no box to declare)');
  if (!P.solvedConstants.emitterPeak.maxCoreAreaShare) fails.push('emitterPeak.maxCoreAreaShare missing (B1c)');
  ok.push('B1 has a declared search box and a component-area ceiling');
}

// ── §7 splits reference framing from invariant ──────────────────────────────
{
  if (!/### Reference framing/.test(DOC) || !/### Invariant/.test(DOC)) fails.push('§7 is not split into reference framing / invariant');
  else ok.push('§7 splits single-viewpoint facts from camera-independent rules');
}

console.log('PASS');
for (const s of ok) console.log('  ok   ' + s);
if (fails.length) {
  console.log('\nFAIL');
  for (const s of fails) console.log('  x    ' + s);
  process.exit(1);
}
console.log(`\n${ok.length} checks passed, 0 failed.`);
