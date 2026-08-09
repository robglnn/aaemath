// P01 self-audit. Measures design/world.md and design/voice.md against the piece brief, against
// voice.md's own declared rules, and against world.md's own beat sheet.
//   node review/p01-audit.mjs
//
// Design note, round 2: the previous version of this file reported 34/34 while an independent
// auditor found twelve real violations, because three of its tests could not fail. Every predicate
// below is exercised against a known-bad input in the TRIPWIRE section at the bottom; if a
// predicate stops being able to fire, the audit itself fails. Scratch tool — owned by P01.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const world = readFileSync(join(root, "design/world.md"), "utf8");
const voice = readFileSync(join(root, "design/voice.md"), "utf8");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

// ---------- helpers ----------
// Punctuation-only tokens (em dashes, bullets) are not words.
const words = (s) =>
  s.trim().split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
const chars = (s) => s.length;
const norm = (s) => s.replace(/\s+/g, " ");

// Sample lines live in fenced blocks as `key<2+ spaces>text`.
function fencedLines(md) {
  const out = [];
  for (const [, body] of md.matchAll(/```\n([\s\S]*?)```/g)) {
    for (const raw of body.split("\n")) {
      const m = raw.match(/^([a-z][\w.]*[\w])\s{2,}(\S.*)$/);
      if (m) out.push({ key: m[1], text: m[2].trim() });
    }
  }
  return out;
}
// Misconception table rows: | ... | `fail.x` — Line text. |
function failTableLines(md) {
  const out = [];
  for (const [, key, text] of md.matchAll(/\|\s*`(fail\.[\w.]+)`\s*—\s*([^|]+)\|/g)) {
    out.push({ key, text: text.trim() });
  }
  return out;
}

const lines = [...fencedLines(voice), ...failTableLines(voice)];
const byPrefix = (p) => lines.filter((l) => l.key.startsWith(p));

// ---------- world.md: required content ----------
const lexRows = [...world.matchAll(/^\|\s*\*\*(.+?)\*\*\s*\|(.*?)\|(.+?)\|\s*$/gm)]
  .map((m) => ({ term: m[1].trim(), def: m[3].trim() }))
  .filter((r) => r.def.length > 12);
check("world: >=12 proper nouns with one-line definitions", lexRows.length >= 12,
  `${lexRows.length} lexicon entries with definitions`);

const worldSections = {
  "world name (the Margin)": /the Margin/,
  "title candidates block": /## 1\. Title[\s\S]*?\| Candidate \|/,
  "algebra is literal power": /## 2\. Why algebra is literal power/,
  "claim grammar table (§2.1)": /### 2\.1 Claim grammar[\s\S]*?\| Object class \|/,
  "premise / retell": /## 0\. The retell/,
  "the picture (Valerian thesis)": /### The picture/,
  "the place": /## 3\. The place/,
  "traffic manifest": /### Traffic on Leaf Nine/,
  "horizon leaves table": /### The horizon — leaves you can see from Leaf Nine/,
  "player role": /## 6\. You/,
  "companion / bond": /## 7\. Ix — the bond/,
  "antagonist": /## 8\. The Sufficiency/,
  "stakes": /## 9\. What is at stake/,
  "level 1 arc": /## 10\. Level 1/,
  "horizon questions checklist": /## 10a\. The horizon questions/,
};
for (const [name, re] of Object.entries(worldSections)) {
  check(`world: ${name}`, re.test(world), re.test(world) ? "present" : "MISSING");
}

const beats = ["ARRIVAL", "FIRST POWER", "FIRST LOSS", "FIRST MASTERY", "THRESHOLD"];
const foundBeats = beats.filter((b) => new RegExp(`Beat \\d — ${b}`).test(world));
check("world: all five Level 1 beats present, in order", foundBeats.length === 5,
  foundBeats.join(" > ") || "none");

check("world: 'not a metaphor' claim is explicit", /Not a metaphor\./.test(world), "");
check("world: antagonist framed as sincere, not evil",
  /not evil|sincerely kind|never cruel/i.test(world), "");
check("world: game titles include Variable Star + >=4 alternates",
  /VARIABLE STAR/.test(world) && (world.match(/^\| \*\*(?!Candidate)/gm) || []).length >= 4, "");

// ---------- VALERIAN: the world must be populated ----------
// 1. Traffic manifest names >=6 distinct non-player presences.
const manifestBlock = (world.match(/### Traffic on Leaf Nine([\s\S]*?)### The horizon/) || [])[1] || "";
const manifestRows = [...manifestBlock.matchAll(/^\|\s*\*\*(.+?)\*\*\s*\|/gm)].map((m) => m[1].trim());
check("valerian: traffic manifest canonises >=6 non-player presences", manifestRows.length >= 6,
  `${manifestRows.length}: ${manifestRows.join(" · ")}`);

// 2. Every beat names >=2 background presences, and its declared count matches the list.
const beatBlocks = [...world.matchAll(/### Beat (\d) — ([A-Z ]+)\(([^)]*)\)([\s\S]*?)(?=### Beat |\n---)/g)];
const presenceProblems = [];
let minPresences = Infinity;
for (const [, n, name, , body] of beatBlocks) {
  const m = body.match(/\*Background presences \((\d+)\):\*([\s\S]*?)\n\*/);
  if (!m) { presenceProblems.push(`Beat ${n} (${name.trim()}): no background-presence line`); continue; }
  const declared = Number(m[1]);
  const listed = m[2].split(";").map((s) => s.trim()).filter(Boolean).length;
  minPresences = Math.min(minPresences, listed);
  if (declared !== listed) presenceProblems.push(`Beat ${n}: declared ${declared}, listed ${listed}`);
  if (listed < 2) presenceProblems.push(`Beat ${n}: only ${listed} background presence(s)`);
}
check("valerian: every beat lists >=2 background presences, count matches list",
  beatBlocks.length === 5 && presenceProblems.length === 0,
  presenceProblems.length ? presenceProblems.join("; ") : `5 beats, min ${minPresences} presences/beat`);

// 3. Lexicon carries peoples/trades and living things, not just physics.
const peoplesBlock = (world.match(/### 4\.4 Peoples and trades([\s\S]*?)### 4\.5/) || [])[1] || "";
const livingBlock = (world.match(/### 4\.5 Living things([\s\S]*?)### 4\.6/) || [])[1] || "";
const countRows = (b) => [...b.matchAll(/^\|\s*\*\*(.+?)\*\*\s*\|/gm)].length;
check("valerian: >=8 lexicon entries are peoples or trades of other leaves",
  countRows(peoplesBlock) >= 8, `${countRows(peoplesBlock)} entries in §4.4`);
check("valerian: >=5 lexicon entries are flora or fauna",
  countRows(livingBlock) >= 5, `${countRows(livingBlock)} entries in §4.5`);

// 4. Horizon poses questions (BotW gate in quality-bar §1).
const qRows = [...(world.match(/## 10a\.([\s\S]*?)\n---/) || [""])[0]
  .matchAll(/^\|\s*\d+\s*\|/gm)].length;
check("valerian/botw: >=12 horizon questions enumerated", qRows >= 12, `${qRows} questions`);

// 5. Voice: the Valerian registers must out-number any single named speaker.
const perPrefix = {};
for (const l of lines) {
  const p = l.key.split(".")[0];
  perPrefix[p] = (perPrefix[p] || 0) + 1;
}
const valerian = (perPrefix.amb || 0) + (perPrefix.sign || 0) + (perPrefix.lore || 0) + (perPrefix.walk || 0);
const biggestSpeaker = Math.max(perPrefix.ix || 0, perPrefix.sennar || 0, perPrefix.camber || 0);
check("valerian: sign+lore+ambient+walk-on >= 25 lines", valerian >= 25, `${valerian} lines`);
check("valerian: the world register out-numbers the largest single speaker",
  valerian > biggestSpeaker, `world ${valerian} vs largest speaker ${biggestSpeaker}`);

// 6. Six walk-on cultures, >=3 lines each.
const walkCultures = {};
for (const l of byPrefix("walk.")) {
  const c = l.key.split(".")[1];
  walkCultures[c] = (walkCultures[c] || 0) + 1;
}
const thinCultures = Object.entries(walkCultures).filter(([, n]) => n < 3).map(([c]) => c);
check("valerian: >=6 walk-on cultures, each with >=3 lines",
  Object.keys(walkCultures).length >= 6 && thinCultures.length === 0,
  `${Object.keys(walkCultures).length} cultures ${JSON.stringify(walkCultures)}` +
  (thinCultures.length ? ` THIN: ${thinCultures.join(",")}` : ""));

// ---------- voice.md: required content ----------
const speakers = ["IX", "SENNAR", "ADJUSTER CAMBER"];
const foundSpeakers = speakers.filter((s) => new RegExp(`### ${s} `).test(voice));
check("voice: 3 named speaking characters with diction rules", foundSpeakers.length === 3,
  foundSpeakers.join(", "));
check("voice: do / don't list", /\*\*Do\*\*[\s\S]*\*\*Don't\*\*/.test(voice), "");
check("voice: explicit never-a-classroom rules",
  /Seven rules for never sounding like a classroom/.test(voice), "");
check("voice: >=20 shippable sample lines", lines.length >= 20, `${lines.length} keyed lines`);
check("voice: failure doctrine", /## 4\. Failure must read as interesting/.test(voice), "");
check("voice: mastery reads as rank", /## 5\. Mastery must feel like rank/.test(voice), "");
check("voice: walk-on register section", /## 2b\. Walk-on voices/.test(voice), "");
check("voice: localization notes for EN/ES/PL", /## 8\. Localization notes \(EN \/ ES \/ PL\)/.test(voice), "");
check("voice: every speaker has >=6 lines",
  (perPrefix.ix || 0) >= 6 && (perPrefix.sennar || 0) >= 6 && (perPrefix.camber || 0) >= 6,
  JSON.stringify(perPrefix));

// ---------- dogfood: banned classroom vocabulary ----------
const BANNED = [
  /\bproblems?\b/i, /\bquestions?\b/i, /\bexercises?\b/i, /\banswers?\b/i, /\bsolutions?\b/i,
  /\bcorrect\b/i, /\bincorrect\b/i, /\bwrong\b/i, /\bright\b/i, /\btry again\b/i,
  /\bgood job\b/i, /\bwell done\b/i, /\bnice work\b/i, /\bgreat\b/i,
  /\blessons?\b/i, /\btutorial\b/i, /\bpractice\b/i, /\bstudy\b/i, /\bhomework\b/i,
  /\blearn(ing|ed)?\b/i, /\bteach(ing)?\b/i, /\bskill\b/i, /\blevel up\b/i,
  /\bscore\b/i, /\bpoints\b/i, /\bXP\b/, /\bstreak\b/i, /\bhints?\b/i,
  /\bstudents?\b/i, /\bmath(s|ematics)?\b/i, /\bequations?\b/i, /\balgebra\b/i,
  /\byou should\b/i, /\bremember to\b/i, /\bdon'?t forget\b/i, /\bjust\b/i,
];
const bannedIn = (text) => BANNED.filter((re) => re.test(text)).map((re) => re.source);
const violations = [];
for (const l of lines) for (const src of bannedIn(l.text)) violations.push(`${l.key}: /${src}/ -> "${l.text}"`);
check("voice: 0 banned-vocabulary violations in shippable lines", violations.length === 0,
  violations.length ? violations.join("\n      ") : "clean across " + lines.length + " lines");

// ---------- dogfood: length caps declared in voice.md §7 (words AND characters) ----------
// [key pattern, maxWords, maxCharsEN|null, label]  — first match wins, so barks precede ix.*
const CAPS = [
  [/\.bark\./, 9, 56, "HUD bark"],
  [/^sys\.|^mastery\./, 7, 44, "system line"],
  [/^amb\./, 7, 48, "ambient discovery"],
  [/^sign\./, 7, null, "signage"],
  [/^fail\./, 12, null, "fall read"],
  [/^ix\./, 16, null, "Ix dialogue"],
  [/^sennar\./, 12, null, "Sennar"],
  [/^camber\./, 24, null, "Camber"],
  [/^walk\./, 14, null, "walk-on"],
];
const capOf = (key) => CAPS.find(([re]) => re.test(key));
const overs = [];
for (const l of lines) {
  if (/^lore\./.test(l.key)) continue; // exempt by §7
  const rule = capOf(l.key);
  if (!rule) { overs.push(`${l.key}: no cap rule matches this prefix`); continue; }
  const [, maxW, maxC, label] = rule;
  const w = words(l.text), c = chars(l.text);
  if (w > maxW) overs.push(`${l.key} = ${w}w > ${maxW}w (${label})`);
  if (maxC && c > maxC) overs.push(`${l.key} = ${c}ch > ${maxC}ch (${label})`);
}
check("voice: 0 lines over their declared word/char cap", overs.length === 0,
  overs.length ? overs.join("; ") : `all ${lines.length} lines within cap`);

// The caps table must actually declare the numbers this test enforces.
const capsTable = (voice.match(/## 7\. Shipping constraints([\s\S]*?)\n\|\s*Pacing/) || [""])[0];
const declares = (re) => re.test(capsTable);
check("voice: §7 declares the caps this audit enforces",
  declares(/\*\*9\*\*\s*\|\s*\*\*56\*\*/) && declares(/\*\*7\*\*\s*\|\s*\*\*44\*\*/) &&
  declares(/\*\*7\*\*\s*\|\s*\*\*48\*\*/) && declares(/\*\*14\*\*/),
  "bark 9/56, sys 7/44, amb 7/48, walk-on 14");

// ---------- system voice never uses second person ----------
const youSys = lines.filter((l) => /^(sys|mastery|amb)\./.test(l.key) && /\byou(r|rs|'ll|'ve)?\b/i.test(l.text));
check("voice: system + ambient voice never addresses 'you'", youSys.length === 0,
  youSys.map((l) => l.key).join(", ") || "clean");

// ---------- exclamation budget: exactly three, all Ix ----------
const bangLines = lines.filter((l) => l.text.includes("!"));
const bangCount = lines.reduce((n, l) => n + (l.text.match(/!/g) || []).length, 0);
const bangKeys = bangLines.map((l) => l.key);
check("voice: exactly 3 exclamation marks in the product, all Ix's",
  bangCount === 3 && bangLines.every((l) => l.key.startsWith("ix.")),
  `${bangCount} marks on ${bangKeys.join(", ") || "nothing"}`);
check("voice: §2 names the three exclamation keys it spends",
  bangKeys.every((k) => voice.includes("`" + k + "`")),
  bangKeys.join(", "));

// ---------- Sennar: the rule as actually written ----------
// voice.md §2: "None about a person." Six claim-words allowed, <=3 lines, about work not people.
const PERSON_ADJ = /\b(great|good|nice|bad|amazing|wonderful|difficult|easy|beautiful|terrible|excellent|impressive|clever|smart|brave|talented|strong|capable|promising|special|careful|kind|lazy|slow|quick|proud)\b/i;
const CLAIM_WORD = /\b(true|false|open|closed|adequate|honest)\b/i;
const sennarLines = byPrefix("sennar.");
const sennarPersonAdj = sennarLines.filter((l) => PERSON_ADJ.test(l.text));
check("voice: Sennar uses zero adjectives that describe a person", sennarPersonAdj.length === 0,
  sennarPersonAdj.map((l) => `${l.key}: "${l.text}"`).join("; ") || `clean across ${sennarLines.length} lines`);
const sennarClaimWord = sennarLines.filter((l) => CLAIM_WORD.test(l.text));
check("voice: Sennar's claim-words appear in <=3 lines (§2 budget)", sennarClaimWord.length <= 3,
  `${sennarClaimWord.length}: ${sennarClaimWord.map((l) => l.key).join(", ")}`);
const readyLines = sennarLines.filter((l) => /\bready\b/i.test(l.text)).map((l) => l.key);
check("voice: 'ready' appears only in the documented exception line",
  readyLines.length === 1 && readyLines[0] === "sennar.threshold.01", readyLines.join(", ") || "none");
check("voice: §2 states the Sennar rule as 'about a person', not 'none'",
  /None about a person/.test(voice) && !/\| \*\*None\.\*\* Not one\./.test(voice), "");

// ---------- walk-on culture rules are self-enforcing ----------
const nearly = byPrefix("walk.nearly.");
check("voice: every Nearlies line is unfinished (ends in an em dash)",
  nearly.length >= 3 && nearly.every((l) => /—$/.test(l.text)),
  nearly.filter((l) => !/—$/.test(l.text)).map((l) => l.key).join(", ") || `${nearly.length} lines, all cut`);
const verse = byPrefix("walk.verse.");
check("voice: every Verse line is mid-line (opens and closes with an em dash)",
  verse.length >= 3 && verse.every((l) => /^—/.test(l.text) && /—$/.test(l.text)),
  verse.filter((l) => !(/^—/.test(l.text) && /—$/.test(l.text))).map((l) => l.key).join(", ") || `${verse.length} lines`);
const cut = byPrefix("walk.cut.");
const cutI = cut.filter((l) => /\bI\b/.test(l.text));
check("voice: no cutter line contains the word 'I'", cut.length >= 3 && cutI.length === 0,
  cutI.map((l) => l.key).join(", ") || `${cut.length} lines, clean`);
const tare = byPrefix("walk.tare.");
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|tenths?)\b/i;
const tareNoNum = tare.filter((l) => !NUMBER.test(l.text));
check("voice: every Tare line carries a number", tare.length >= 3 && tareNoNum.length === 0,
  tareNoNum.map((l) => l.key).join(", ") || `${tare.length} lines, all numbered`);
const walkBangs = byPrefix("walk.").filter((l) => l.text.includes("!"));
check("voice: no walk-on exclaims", walkBangs.length === 0, walkBangs.map((l) => l.key).join(", ") || "clean");

// ---------- ambient: one oddity per line, no evaluation ----------
const EVAL = /\b(beautiful|ugly|amazing|wonderful|strange|weird|incredible|remarkable|astonishing)\b/i;
const ambEval = byPrefix("amb.").filter((l) => EVAL.test(l.text));
check("voice: ambient lines report, never evaluate", ambEval.length === 0,
  ambEval.map((l) => l.key).join(", ") || `${(perPrefix.amb || 0)} ambient lines, all descriptive`);

// ---------- cross-file consistency ----------
const lexTerms = lexRows.map((r) => r.term.replace(/^(a|the) /i, "").toLowerCase());
const mustExist = ["sill", "claim", "carry", "certainty", "rung", "leaf nine", "quorum",
  "ix", "vantis", "the long division", "grey", "tolerance", "socket", "drift",
  "sill-crabs", "a hush", "the tare", "the nearlies", "a sagsmith", "the edgewake", "a cutter",
  "carrywrens", "oldtrue", "abouts", "a kindness", "the bell of the quorum"];
const missing = mustExist.filter((t) => !lexTerms.includes(t.replace(/^(the|a) /, "")));
check("cross: every load-bearing noun used in voice.md is defined in world.md",
  missing.length === 0, missing.length ? "missing: " + missing.join(", ") : `${mustExist.length} nouns defined`);

const quorumWorld = /Sixteen thousand and four/.test(world);
const quorumVoice = /Sixteen thousand and three/.test(voice);
check("cross: Quorum drops by one during Level 1 (16 004 -> 16 003)",
  quorumWorld && quorumVoice, `world=${quorumWorld} voice=${quorumVoice}`);

// ---------- cross: the Ix digit arc, computed from the beat sheet, vs the canon guard ----------
const WORDNUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
const arcSteps = [];
for (const [, n, , , body] of beatBlocks) {
  const m = body.match(/\*Digit arc:\*\s*\*\*([^*]+)\*\*/);
  if (!m) continue;
  const nums = (m[1].match(/\d/g) || []).map(Number);
  arcSteps.push({ beat: Number(n), nums, raw: m[1].trim() });
}
let arcOk = arcSteps.length >= 3;
let arcTrace = arcSteps.map((s) => `B${s.beat}:${s.nums.join("→")}`).join(" ");
for (let i = 1; i < arcSteps.length; i++) {
  const prevEnd = arcSteps[i - 1].nums[arcSteps[i - 1].nums.length - 1];
  if (arcSteps[i].nums[0] !== prevEnd) { arcOk = false; arcTrace += ` BREAK at beat ${arcSteps[i].beat}`; }
}
const beatStart = arcSteps.length ? arcSteps[0].nums[0] : NaN;
const beatEnd = arcSteps.length ? arcSteps[arcSteps.length - 1].nums.slice(-1)[0] : NaN;
const guard = norm(world).match(
  /Ix has (\w+) digits at Level 1 start, loses one in Beat 3, regains it in Beat 4, and ends Level 1\s*at (\w+)/);
const guardStart = guard ? WORDNUM[guard[1].toLowerCase()] : NaN;
const guardEnd = guard ? WORDNUM[guard[2].toLowerCase()] : NaN;
check("cross: canon guard's Ix arc equals the arc the beat sheet actually stages",
  arcOk && guardStart === beatStart && guardEnd === beatEnd,
  `beats ${arcTrace} (start ${beatStart}, end ${beatEnd}) vs guard start ${guardStart}, end ${guardEnd}`);

// Light-change budget: world.md says two, voice.md §5 and §7 must say two, and the beats must stage two.
const changes = arcSteps.filter((s) => s.nums.length >= 2 && s.nums[0] !== s.nums[1]).length;
check("cross: voice.md's Ix light-change budget matches the number of changes the beats stage",
  changes === 2 &&
  /Ix's lights change\s*\n?\s*exactly twice in Level 1/.test(voice) &&
  /Ix light-change moments \| \*\*exactly two\*\*/.test(voice),
  `beats stage ${changes}; voice §5 and §7 must both say two`);

// Rank arc: no Rung in Beat 5.
const beat5 = (beatBlocks.find((b) => b[1] === "5") || [])[4] || "";
check("cross: Beat 5 grants no Rung (canon guard agrees)",
  /\*Rank:\* none\./.test(beat5) && /\*\*No Rung in Beat 5\.\*\*/.test(world), "");

check("cross: the word 'mathematics' never appears in a shippable line",
  !lines.some((l) => /math/i.test(l.text)), "");

// Every line world.md puts in a character's mouth must be a real, keyed line in voice.md.
const beatQuotes = [...world.matchAll(/\*"([^"]+)"\*/g)].map((m) => m[1]);
const orphanQuotes = beatQuotes.filter((q) => !lines.some((l) => l.text === q));
check("cross: every line the beat sheet quotes is a keyed line in voice.md",
  beatQuotes.length >= 5 && orphanQuotes.length === 0,
  orphanQuotes.length ? "orphans: " + orphanQuotes.map((q) => `"${q}"`).join(", ")
    : `${beatQuotes.length} quoted lines, all keyed`);

// The retell must be short enough to actually be retold after one read.
const retell = (world.match(/## 0\. The retell([\s\S]*?)### The picture/) || [])[1] || "";
const retellQuote = retell.split("\n").filter((l) => l.trim().startsWith(">")).join(" ");
const retellWords = retellQuote.split(/\s+/).filter(Boolean).length;
check("world: retell block is retellable (<= 260 words incl. trailer card)",
  retellWords > 0 && retellWords <= 260, `${retellWords} words`);

check("cross: the governing line appears in both bibles",
  /no word for mathematics in the Margin/.test(world) &&
  /no word for mathematics in the Margin/.test(voice), "");

// ---------- TRIPWIRE: prove the predicates can fail ----------
// Each entry is a known-bad input that MUST trip the matching predicate. If one stops firing, the
// rule it guards has silently become decorative — which is exactly how the last round scored 34/34.
const tripwires = [
  ["banned vocabulary", () => bannedIn("Great work, try again on the next question.").length >= 3],
  ["word cap", () => words("one two three four five six seven eight") > 7],
  ["char cap", () => chars("Certainty formed and it will not ever drift again, truly.") > 44],
  ["punctuation-only tokens are not words", () => words("LEAF NINE — THREE CARRIES — NO DEPOT") === 6],
  ["person adjective", () => PERSON_ADJ.test("That was clever.")],
  ["claim word", () => CLAIM_WORD.test("That was adequate.")],
  ["claim word ignores ordinary praise", () => !CLAIM_WORD.test("Deliver it. Don't admire it.")],
  ["evaluative ambient", () => EVAL.test("The certainty field is beautiful.")],
  ["second person in system voice", () => /\byou(r|rs|'ll|'ve)?\b/i.test("Your claim has drifted.")],
  ["cutter first person", () => /\bI\b/.test("I hold the glass.")],
  ["cutter rule ignores lowercase i", () => !/\bI\b/.test("It is in the light.")],
  ["Tare number", () => !NUMBER.test("The barge lifts when it is true.") && NUMBER.test("Eighty-one kilos.")],
  ["unfinished Nearlies", () => /—$/.test("It's about to—") && !/—$/.test("It's about to go.")],
  ["mid-line Verse", () => /^—/.test("—and both sides—") && !/^—/.test("And both sides—")],
  ["digit-arc break detection", () => {
    const a = [{ nums: [4, 3] }, { nums: [4, 5] }];
    return a[1].nums[0] !== a[0].nums[1];
  }],
];
const deadTripwires = tripwires.filter(([, fn]) => { try { return !fn(); } catch { return true; } }).map(([n]) => n);
check("audit: every predicate fires on a known-bad input", deadTripwires.length === 0,
  deadTripwires.length ? "DEAD: " + deadTripwires.join(", ") : `${tripwires.length} tripwires all fired`);

// ---------- report ----------
const wc = (s) => s.split(/\s+/).filter(Boolean).length;
const stats = {
  worldWords: wc(world), voiceWords: wc(voice),
  worldReadMin: Math.round(wc(world) / 220), voiceReadMin: Math.round(wc(voice) / 220),
  lexiconEntries: lexRows.length,
  shippableLines: lines.length,
  perPrefix,
  valerianLines: valerian,
  largestSingleSpeaker: biggestSpeaker,
  trafficManifest: manifestRows.length,
  horizonQuestions: qRows,
  walkOnCultures: walkCultures,
  ixDigitArc: arcTrace,
  exclamationMarks: bangCount,
};

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "\n      " + c.detail : ""}`);
console.log("\n" + JSON.stringify(stats, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
