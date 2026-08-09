// P01 independent cross-check. Deliberately NOT the same code as p01-audit.mjs.
//   node review/p01-crosscheck.mjs
//
// Different parser (raw line scan, no fence scoping), and the length caps are read out of
// voice.md §7's own markdown table rather than hardcoded — so the doc is checked against the
// numbers it publishes, not against numbers this script believes. Also hunts orphan proper nouns:
// any capitalised name used in a shippable line that world.md never defines.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const world = readFileSync(join(root, "design/world.md"), "utf8");
const voice = readFileSync(join(root, "design/voice.md"), "utf8");

let problems = 0;
const bad = (msg) => { problems++; console.log("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);

// ---- 1. raw line scan (no fence awareness at all) ----
const keyed = [];
for (const raw of voice.split("\n")) {
  const m = raw.match(/^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s{2,}(\S.*?)\s*$/);
  if (m) keyed.push({ key: m[1], text: m[2] });
}
console.log(`\n[1] raw scan found ${keyed.length} keyed lines`);
if (keyed.length < 150) bad(`expected >=150 keyed lines, got ${keyed.length}`); else ok("line count");

// ---- 2. caps parsed out of voice.md §7's own table ----
const capsSection = (voice.match(/## 7\. Shipping constraints([\s\S]*?)\n\n\| Pacing/) || [, ""])[1];
const capRules = [];
for (const row of capsSection.split("\n")) {
  const cells = row.split("|").map((c) => c.trim());
  if (cells.length < 6) continue;
  const prefixCell = cells[2];
  if (!/`/.test(prefixCell)) continue;
  const pats = [...prefixCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const maxW = (cells[3].match(/\d+/) || [])[0];
  const maxC = (cells[4].match(/\d+/) || [])[0];
  const exempt = /exempt/i.test(cells[3]);
  capRules.push({ pats, maxW: maxW ? Number(maxW) : null, maxC: maxC ? Number(maxC) : null, exempt });
}
console.log(`\n[2] parsed ${capRules.length} cap rules straight out of voice.md §7`);
for (const r of capRules) console.log(`      ${r.pats.join(" ")} -> ${r.exempt ? "exempt" : `${r.maxW}w / ${r.maxC ?? "—"}ch`}`);

const patToRe = (p) => new RegExp("^" + p.replace(/\*/g, "[a-z0-9]*").replace(/\./g, "\\.") + (p.endsWith("*") ? "" : "\\b"));
const ruleFor = (key) => {
  // Barks first: "*.bark.*" must beat "ix.*".
  const ordered = [...capRules].sort((a, b) => (b.pats.join().includes("bark") ? 1 : 0) - (a.pats.join().includes("bark") ? 1 : 0));
  for (const r of ordered) for (const p of r.pats) if (patToRe(p).test(key)) return r;
  return null;
};
const wordCount = (s) => s.trim().split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
let capFails = 0, capped = 0;
for (const l of keyed) {
  const r = ruleFor(l.key);
  if (!r) { bad(`${l.key}: §7 declares no cap rule for this prefix`); continue; }
  if (r.exempt) continue;
  capped++;
  if (r.maxW && wordCount(l.text) > r.maxW) { bad(`${l.key}: ${wordCount(l.text)}w > ${r.maxW}w`); capFails++; }
  if (r.maxC && l.text.length > r.maxC) { bad(`${l.key}: ${l.text.length}ch > ${r.maxC}ch`); capFails++; }
}
if (!capFails) ok(`${capped} capped lines all inside the caps the document publishes`);

// ---- 3. banned vocabulary, EN + the ES/PL equivalents §8 says count the same ----
const BANNED = [
  /\bproblems?\b/i, /\bquestions?\b/i, /\bexercises?\b/i, /\banswers?\b/i, /\bsolutions?\b/i,
  /\bcorrect\b/i, /\bincorrect\b/i, /\bwrong\b/i, /\bright\b/i, /\btry again\b/i, /\bgood job\b/i,
  /\bwell done\b/i, /\bnice work\b/i, /\bgreat\b/i, /\blessons?\b/i, /\btutorial\b/i,
  /\bpractice\b/i, /\bstudy\b/i, /\bhomework\b/i, /\bdrill\b/i, /\blearn/i, /\bteach/i,
  /\bskills?\b/i, /\blevel up\b/i, /\bscores?\b/i, /\bpoints\b/i, /\bXP\b/, /\bstreak\b/i,
  /\bhints?\b/i, /\bstudents?\b/i, /\bmath/i, /\bequations?\b/i, /\balgebra\b/i, /\bjust\b/i,
  /\byou should\b/i, /\bremember to\b/i, /\bdon'?t forget\b/i,
  /\bejercicio\b/i, /\brespuesta\b/i, /\bmuy bien\b/i, /\bzadanie\b/i, /\bodpowied/i, /\bbrawo\b/i,
];
console.log(`\n[3] banned vocabulary across ${keyed.length} lines (EN + ES/PL equivalents)`);
let bv = 0;
for (const l of keyed) for (const re of BANNED) if (re.test(l.text)) { bad(`${l.key}: /${re.source}/ in "${l.text}"`); bv++; }
if (!bv) ok("clean");

// ---- 4. orphan proper nouns: capitalised names in lines that world.md never defines ----
// A proper noun is a capitalised word that is NOT the first word of its sentence. That single
// rule replaces a stop-list, and it is what makes this test meaningful rather than noisy.
const defined = new Set();
for (const w of world.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)) {
  if (!w) continue;
  defined.add(w.toLowerCase());
  for (const part of w.split("-")) if (part) defined.add(part.toLowerCase());
}
console.log("\n[4] orphan proper nouns used in shippable lines but never in world.md");
console.log("      (a proper noun = a capitalised word that does not open its sentence)");
const orphans = new Map();
for (const l of keyed) {
  if (/^sign\./.test(l.key)) continue; // signage is set in all caps by definition
  // Drop the opening token of every sentence, then look at what is still capitalised.
  const midSentence = l.text
    .split(/(?<=[.?!:;—])\s+|^/)
    .map((s) => s.trim().split(/\s+/).slice(1).join(" "))
    .join(" ");
  for (const m of midSentence.matchAll(/\b([A-Z][a-zA-Z]{2,})\b/g)) {
    const w = m[1];
    if (defined.has(w.toLowerCase())) continue;
    if (w === w.toUpperCase()) continue; // Ix's shouted emphasis: SEVEN, HERE, LINE
    orphans.set(w, (orphans.get(w) || 0) + 1);
  }
}
if (orphans.size) { for (const [w, n] of orphans) bad(`"${w}" used ${n}× in voice.md, absent from world.md`); }
else ok("every proper noun spoken in the product is defined in the world bible");

// ---- 5. the Valerian ledger, recomputed ----
const per = {};
for (const l of keyed) { const p = l.key.split(".")[0]; per[p] = (per[p] || 0) + 1; }
const val = (per.amb || 0) + (per.sign || 0) + (per.lore || 0) + (per.walk || 0);
const speakers = { ix: per.ix || 0, sennar: per.sennar || 0, camber: per.camber || 0 };
console.log("\n[5] register ledger");
console.log("      " + JSON.stringify(per));
console.log(`      Valerian (amb+sign+lore+walk) = ${val}; largest single speaker = ${Math.max(...Object.values(speakers))}`);
if (val < 25) bad(`Valerian register is ${val} lines, brief demands >=25`); else ok(`Valerian register = ${val} lines`);
if (val <= Math.max(...Object.values(speakers))) bad("Valerian register does not out-number the largest speaker");
else ok("Valerian register out-numbers every single speaker");

// ---- 6. self-contradiction sweep on the numbers both files repeat ----
console.log("\n[6] cross-file number agreement");
const facts = [
  ["Quorum start 16 004", /Sixteen thousand and four|sixteen thousand and four|16 004/, world, true],
  ["Quorum after the Bell 16 003", /Sixteen thousand and three/, voice, true],
  ["Tolerance ±1 during the level", /±1/, world, true],
  ["Tolerance ±2 in the closing notice", /±2/, voice, true],
  ["Ix ends Level 1 at four", /ends Level 1\s*\n?\s*at four/, world, true],
  ["voice.md agrees: two light-changes", /exactly twice in Level 1/, voice, true],
  ["no 'ends at five' left anywhere", /ends at five/, world, false],
  ["no 'about to be five' left in the beats", /about to be five/, world, false],
  ["no 'twice in Level 1' digit-return budget left", /digit-return moment/, voice, false],
];
for (const [name, re, src, want] of facts) {
  const got = re.test(src);
  if (got === want) ok(name); else bad(`${name} — expected ${want ? "present" : "absent"}, was ${got ? "present" : "absent"}`);
}

// ---- 7. the three lines the last critic named, confirmed gone ----
console.log("\n[7] round-1 rejected lines are gone");
const gone = [
  ["ix.reassure.01 (meta-commentary on learning)", /You're allowed to not know yet/],
  ["ix.bark.idle.07 old text ('Careful. That carry's fast today.')", /Careful\. That carry's fast today/],
  ["sys.claim.drift.01 second sentence ('Close it again.')", /drifted\. Close it again/],
];
for (const [name, re] of gone) { if (re.test(voice)) bad(`${name} still present`); else ok(name); }

console.log(`\n${problems === 0 ? "CROSS-CHECK CLEAN" : problems + " PROBLEM(S)"}`);
process.exit(problems ? 1 : 0);
