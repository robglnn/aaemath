// P01 measurement scratch: recount every shippable string in design/voice.md by key prefix,
// and re-run the word/character caps in §7 over all of them. Nothing here ships.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../design/voice.md", import.meta.url), "utf8");
const lines = src.split(/\r?\n/);

// Collect only lines inside fenced code blocks that look like `key   text`.
const strings = [];
let fenced = false;
for (const line of lines) {
  if (/^```/.test(line)) { fenced = !fenced; continue; }
  if (!fenced) continue;
  const m = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s+(.+?)\s*$/.exec(line);
  if (m) strings.push({ key: m[1], text: m[2] });
}

// The 16 misconception rows in §4 live in a table, not a fence, but they ship. Count them too, so
// the total in §0 is regenerated rather than hand-added — the previous round's total excluded them
// silently.
const tableFails = [...src.matchAll(/^\| .+? \| `(fail\.[a-z.]+)` — (.+?) \|$/gm)].map((m) => ({ key: m[1], text: m[2] }));

const groups = new Map();
for (const s of strings) {
  const g = s.key.split(".")[0];
  groups.set(g, (groups.get(g) ?? 0) + 1);
}

// walk.* splits: Sixth Vey (walk.solv.*) is counted under Red Rising, the rest under Valerian.
const walkSolv = strings.filter((s) => s.key.startsWith("walk.solv.")).length;
const walk = groups.get("walk") ?? 0;

const g = (k) => groups.get(k) ?? 0;
const dials = {
  "Fourth Wing (ix)": g("ix"),
  "Red Rising (sennar + walk.solv + dace)": g("sennar") + walkSolv + g("dace"),
  "Hitchhiker's (camber + sign)": g("camber") + g("sign"),
  "Valerian (walk minus solv + amb + sign + lore)": walk - walkSolv + g("amb") + g("sign") + g("lore"),
};
const standing = walk + g("amb") + g("sign") + g("lore");
const largestNamed = Math.max(g("ix"), g("sennar"), g("camber"), g("dace"));

// §7 caps, measured on EN.
const caps = [
  { test: (k) => /\.bark\./.test(k), words: 9, chars: 56, name: "HUD bark" },
  { test: (k) => k.startsWith("sys.") || k.startsWith("mastery."), words: 7, chars: 44, name: "system" },
  { test: (k) => k.startsWith("amb."), words: 7, chars: 48, name: "ambient" },
  { test: (k) => k.startsWith("fail."), words: 12, chars: null, name: "fall read" },
  { test: (k) => k.startsWith("ix."), words: 16, chars: null, name: "Ix dialogue" },
  { test: (k) => k.startsWith("sennar."), words: 12, chars: null, name: "Sennar" },
  { test: (k) => k.startsWith("camber."), words: 24, chars: null, name: "Camber" },
  { test: (k) => k.startsWith("dace."), words: 16, chars: null, name: "Dace" },
  { test: (k) => k.startsWith("walk."), words: 14, chars: null, name: "walk-on" },
  { test: (k) => k.startsWith("sign."), words: 7, chars: null, name: "signage" },
];
// A word is a token containing at least one letter or digit; bare punctuation (— , . ±) is not a word.
const words = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const violations = [];
for (const s of strings) {
  if (s.key.startsWith("lore.")) continue; // length-exempt by §7
  const cap = caps.find((c) => c.test(s.key));
  if (!cap) continue;
  if (words(s.text) > cap.words) violations.push(`${s.key}: ${words(s.text)} words > ${cap.words} (${cap.name})`);
  if (cap.chars && s.text.length > cap.chars) violations.push(`${s.key}: ${s.text.length} chars > ${cap.chars} (${cap.name})`);
}

const bangs = [...strings, ...tableFails].filter((s) => s.text.includes("!"));

// §1's hard ban, swept over every shippable string including the §4 table.
const BANNED = /\b(problems?|questions?|exercises?|answers?|solutions?|correct|incorrect|wrong|homework|drills?|tutorials?|lessons?|practice|study|studying|learn|learns|learning|teach|teaches|teaching|master|mastered|mastering|skills?|score|scores|points|xp|streak|combo|hints?|helps?|student|students|user|users|math|maths|mathematics|equations?|algebra|inequality|inequalities|expression|expressions|variables?|substitute|distribute|expand|simplify|collect|just)\b/i;
const banned = [...strings, ...tableFails].filter((s) => BANNED.test(s.text));

console.log("--- group counts ---");
for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(10)} ${v}`);
console.log(`fenced     ${strings.length}`);
console.log(`§4 table   ${tableFails.length}  (fail.* misconception rows — they ship)`);
console.log(`SHIPPABLE  ${strings.length + tableFails.length}`);
console.log("\n--- tone dials ---");
for (const [k, v] of Object.entries(dials)) console.log(`${k}: ${v}`);
console.log(`\nstanding budget: ambient+signage+walk-on+lore = ${standing} vs largest named speaker = ${largestNamed} -> ${standing > largestNamed ? "HOLDS" : "BROKEN"}`);
console.log("\n--- walk-on registers (Valerian gate, second half) ---");
const walkFamilies = [...new Set(strings.filter((s) => s.key.startsWith("walk.")).map((s) => s.key.split(".")[1]))];
console.log(`${walkFamilies.length} key families: ${walkFamilies.join(", ")}  (walk.rate = the non-human register)`);
console.log("\n--- exclamation marks ---");
console.log(bangs.length ? bangs.map((b) => `${b.key}  ${b.text}`).join("\n") : "none");
console.log("\n--- banned vocabulary (§1) ---");
console.log(banned.length ? banned.map((b) => `${b.key}  ${b.text}`).join("\n") : "none");
console.log("\n--- cap violations ---");
console.log(violations.length ? violations.join("\n") : "none");
