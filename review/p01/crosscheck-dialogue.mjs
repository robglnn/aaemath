// P01 measurement scratch: every sentence world.md puts in a character's mouth must exist, word for
// word, in voice.md's string bank. Round 3's validator only checked that cited *keys* existed, which
// is not the same claim. Read-only; exits non-zero on drift.
import { readFileSync } from "node:fs";

const world = readFileSync(new URL("../../design/world.md", import.meta.url), "utf8");
const voice = readFileSync(new URL("../../design/voice.md", import.meta.url), "utf8");

// Every shippable string, fenced blocks and the §4 misconception table alike.
const bank = new Map();
let fenced = false;
for (const line of voice.split(/\r?\n/)) {
  if (/^```/.test(line)) { fenced = !fenced; continue; }
  if (fenced) {
    const m = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s+(.+?)\s*$/.exec(line);
    if (m) bank.set(m[1], m[2]);
  } else {
    const t = /^\| .+? \| `(fail\.[a-z.]+)` — (.+?) \|$/.exec(line);
    if (t) bank.set(t[1], t[2]);
  }
}

// world.md quotes dialogue as *"…"* — italicised and double-quoted; markdown may wrap it mid-line,
// so whitespace is collapsed before comparing.
const quotes = [...world.matchAll(/\*"([^"]+)"\*/g)].map((m) => m[1]);
const texts = [...bank.values()];
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

const orphans = [];
for (const q of quotes) {
  const n = norm(q);
  const hit = texts.find((t) => norm(t) === n || norm(t).includes(n));
  if (!hit) orphans.push(q);
}

console.log(`voice.md string bank: ${bank.size} shippable strings`);
console.log(`world.md quoted dialogue: ${quotes.length} lines`);
for (const q of quotes) {
  const n = norm(q);
  const key = [...bank].find(([, t]) => norm(t) === n || norm(t).includes(n))?.[0];
  console.log(`  ${key ? "ok  " : "FAIL"} ${key ?? "(no source)"}  "${q}"`);
}
if (orphans.length) {
  console.log(`\n${orphans.length} quoted line(s) with no string in voice.md`);
  process.exit(1);
}
console.log(`\n${quotes.length}/${quotes.length} quoted lines trace to a shipped string`);
