#!/usr/bin/env node
/**
 * How much of the SHIPPED BANK can a player answer from what the presenter puts on screen?
 *
 *   node review/measure/P34-reader-coverage.mjs [en|es|pl]
 *
 * `review/measure/P34.mjs` drives the real build and proves the loop closes without the answer key,
 * but a session only ever meets thirty-odd items. This runs the same screen reader over all 1,152
 * committed items, standing exactly the rows `learn/Teaching.js` `_display()` stands, and marks every
 * response with the shipped `ItemBank.check`. It is offline on purpose: it is a property of the
 * content and the presentation, identical on every machine.
 *
 * It is a legibility measurement, not a pass/fail gate. `answered` is what the reader could make
 * anything of; `correct` is what the shipped checker took. The gap between them, and the per-ask
 * breakdown, is the honest map of where an item is still under-specified on screen.
 *
 * Round 3, all three locales: 948 answered, 760 correct (66.0%) — the same numbers in en, es and pl,
 * which is itself the claim that the localized sentences carry the same information.
 */
import fs from "node:fs";
import { ItemBank } from "../../app/src/learn/ItemBank.js";
import { TEACH } from "../../app/src/learn/Teaching.js";
import { answerFromScreen } from "./lib/reader.mjs";

const LOCALE = process.argv[2] ?? "en";
const table = (await import(`../../content/items/strings/items-${LOCALE}.mjs`)).default;
const bank = new ItemBank();
bank.locale = LOCALE;

const escape = (s) => String(s ?? "").replace(/[\\{}$&#_%^~]/g, (c) => ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#", _: "\\_", "%": "\\%", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" }[c]));
const wrap = (t, max) => {
  const w = String(t ?? "").trim().split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for (const x of w) {
    if (!line) line = x;
    else if (line.length + 1 + x.length <= max) line += ` ${x}`;
    else { out.push(line); line = x; }
  }
  if (line) out.push(line);
  return out;
};

/** Exactly the rows `learn/Teaching.js` `_display()` stands, as `probe("mathtex").panels` would show. */
function panelsFor(item) {
  const p = bank.present(item);
  const panels = [];
  let ask = wrap(p.ask, TEACH.wrapChars);
  if (ask.length > TEACH.maxAskLines) ask = wrap(p.ask, TEACH.wrapWide);
  ask.slice(0, TEACH.maxAskLines).forEach((l, i) => panels.push({ id: `teach-ask-${i}`, tex: `\\text{${escape(l)}}` }));
  panels.push({ id: "teach-claim", tex: p.tex.stem });
  if (p.spoken) wrap(p.spoken, TEACH.wrapChars).slice(0, TEACH.maxSaidLines).forEach((l, i) => panels.push({ id: `teach-said-${i}`, tex: `\\text{${escape(l)}}` }));
  (p.tex.given ?? []).forEach((g, i) => panels.push({ id: `teach-given-${i}`, tex: g }));
  (item.working ?? []).forEach((w, i) => panels.push({ id: `teach-working-${i}`, tex: `${i + 1})\\;${w}` }));
  panels.push({ id: "teach-entry", tex: "\\rule{2.4em}{0.06em}" });
  return panels;
}

const DIR = new URL("../../content/items/groups/", import.meta.url);
const stat = {};
const bump = (k, ok) => {
  stat[k] = stat[k] ?? { n: 0, answered: 0, correct: 0 };
  stat[k].n += 1;
  if (ok.response != null) stat[k].answered += 1;
  if (ok.correct) stat[k].correct += 1;
};
let n = 0, answered = 0, correct = 0, ungrammatical = 0;
const misses = {};
for (const f of fs.readdirSync(DIR)) {
  if (f === "index.mjs") continue;
  const m = await import(new URL(f, DIR));
  for (const item of m.default.items) {
    n += 1;
    const r = answerFromScreen({ panels: panelsFor(item), table });
    let mark = { correct: false };
    if (r.response != null) {
      if (!/^[0-9a-zA-Z+\-*/=<>.,()|:; ]*$/.test(r.response)) ungrammatical += 1;
      mark = bank.check(item, r.response);
    }
    if (r.response != null) answered += 1;
    if (mark.correct) correct += 1;
    else {
      const k = `${r.askKey ?? "?"} | ${r.strategy}`;
      misses[k] = misses[k] ?? { n: 0, ex: null };
      misses[k].n += 1;
      if (!misses[k].ex) misses[k].ex = { id: item.id, typed: r.response, want: item.answer.canonical };
    }
    bump(`${r.askKey ?? "?"}`, { response: r.response, correct: mark.correct });
  }
}
console.log(`locale ${LOCALE}: items ${n}  answered ${answered}  CORRECT ${correct} (${((correct / n) * 100).toFixed(1)}%)  outside grammar ${ungrammatical}`);
console.log("by ask key:");
for (const [k, v] of Object.entries(stat).sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${k.padEnd(28)} n=${String(v.n).padStart(4)} answered=${String(v.answered).padStart(4)} correct=${String(v.correct).padStart(4)}`);
console.log("misses:");
for (const [k, v] of Object.entries(misses).sort((a, b) => b[1].n - a[1].n).slice(0, 14))
  console.log(`  ${String(v.n).padStart(4)}  ${k}   e.g. ${JSON.stringify(v.ex)}`);
