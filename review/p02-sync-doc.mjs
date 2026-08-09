#!/usr/bin/env node
/**
 * Generate the §9 hue-partition table in design/art-direction.md FROM
 * design/palette.json, so the prose and the auditor cannot disagree about the
 * partition. Round 1 had prose saying 10–39 / 150–209 / 120–149 / 70–119 /
 * 250–349 while the JSON the auditor read said warm [0,60,320,360], resonance
 * [150,215], bridge [90,150] — with `success` at 107° landing inside the bridge
 * arc and being scored against the bridge budget.
 *
 *   node review/p02-sync-doc.mjs        # rewrites the marked block in place
 *   node review/p02-sync-doc.mjs --check  # exits 1 if the block is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = JSON.parse(readFileSync(path.join(ROOT, 'design', 'palette.json'), 'utf8'));
const DOC = path.join(ROOT, 'design', 'art-direction.md');
const START = '<!-- GENERATED: hue-partition — do not edit by hand; run node review/p02-sync-doc.mjs -->';
const END = '<!-- /GENERATED: hue-partition -->';

const arcs = P.colourBudget.hueArcs;
const gate = c => {
  const bits = [];
  if (c.minS !== undefined) bits.push(`S ≥ ${c.minS}`);
  if (c.maxS !== undefined) bits.push(`S < ${c.maxS}`);
  if (c.minY !== undefined) bits.push(`Y > ${c.minY}`);
  return bits.length ? bits.join(', ') : '—';
};
const hueStr = h => h.map(([a, b]) => `${a}–${b}°`).join(' ∪ ');

const rows = arcs.order.map((k, i) => {
  const c = arcs.classes[k];
  return `| ${i + 1} | \`${k}\` | ${hueStr(c.hue)} | ${gate(c)} | ${(c.referenceShare * 100).toFixed(2)}% | ${c.label.replace(/^[a-z]+ — /, '')} |`;
});

const block = [
  START,
  '',
  '| order | class | hue | gate | reference share of frame | what it is |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  '**The order matters.** ' + arcs.note.split('Classification is in ')[1].replace(/^PRIORITY ORDER/, 'Classification is in priority order'),
  '',
  `${arcs.emptyArcs}`,
  '',
  END
].join('\n');

const src = readFileSync(DOC, 'utf8');
const i0 = src.indexOf(START), i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error('marker block not found in ' + DOC); process.exit(2); }
const next = src.slice(0, i0) + block + src.slice(i1 + END.length);
if (process.argv.includes('--check')) {
  if (next !== src) { console.error('design/art-direction.md §9 hue table is STALE — run node review/p02-sync-doc.mjs'); process.exit(1); }
  console.log('hue table in sync'); process.exit(0);
}
writeFileSync(DOC, next);
console.log('synced §9 hue partition into ' + path.relative(ROOT, DOC));
