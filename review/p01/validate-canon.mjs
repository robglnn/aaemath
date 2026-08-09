// P01 measurement scratch: prove design/world.md's canon against the files it claims to cover.
// Read-only. Exits non-zero on any failure so it can be trusted as evidence.
import { readFileSync } from "node:fs";

const world = readFileSync(new URL("../../design/world.md", import.meta.url), "utf8");
const voice = readFileSync(new URL("../../design/voice.md", import.meta.url), "utf8");
const kg = JSON.parse(readFileSync(new URL("../../content/knowledge-graph.json", import.meta.url), "utf8"));

const fails = [];
const ok = [];
const check = (cond, pass, fail) => (cond ? ok.push(pass) : fails.push(fail));

// --- 1. §2.1 declares exactly six object classes -------------------------------------------------
const classRows = [...world.matchAll(/^\| \*\*(Span|Aperture|Emitter|Bearer|Vessel|Threshold)\*\* — /gm)].map((m) => m[1]);
const CLASSES = ["Span", "Aperture", "Emitter", "Bearer", "Vessel", "Threshold"];
check(
  new Set(classRows).size === 6 && CLASSES.every((c) => classRows.includes(c)),
  `§2.1 declares all six object classes: ${classRows.join(", ")}`,
  `§2.1 object classes wrong: got ${JSON.stringify(classRows)}`
);

// --- 2. §11a maps every knowledge-graph node, once, to a declared class --------------------------
const section = world.slice(world.indexOf("### 11a."));
const mapped = new Map();
for (const m of section.matchAll(/^\| `([a-z0-9-]+)` \| \*\*([A-Za-z]+)\*\* \| /gm)) {
  if (mapped.has(m[1])) fails.push(`§11a maps ${m[1]} twice`);
  mapped.set(m[1], m[2]);
}
const nodeIds = kg.nodes.map((n) => n.id);
const missing = nodeIds.filter((id) => !mapped.has(id));
const extra = [...mapped.keys()].filter((id) => !nodeIds.includes(id));
const badClass = [...mapped].filter(([, c]) => !CLASSES.includes(c));
check(mapped.size === nodeIds.length, `§11a maps ${mapped.size} nodes; graph ships ${nodeIds.length}`, `§11a maps ${mapped.size}, graph ships ${nodeIds.length}`);
check(missing.length === 0, "§11a: zero unmapped nodes", `§11a unmapped: ${missing.join(", ")}`);
check(extra.length === 0, "§11a: zero phantom node ids", `§11a names nodes not in the graph: ${extra.join(", ")}`);
check(badClass.length === 0, "§11a: every class is one of the six", `§11a bad classes: ${JSON.stringify(badClass)}`);

// --- 3. the class-count sentence in §11a matches the table ---------------------------------------
const tally = {};
for (const c of mapped.values()) tally[c] = (tally[c] ?? 0) + 1;
const claimed = /Span (\d+), Bearer (\d+), Aperture (\d+), Threshold (\d+), Emitter (\d+),\s*\nVessel (\d+) — thirty-two/.exec(section);
check(!!claimed, "§11a states class counts", "§11a class-count sentence not found in expected form");
if (claimed) {
  const want = { Span: +claimed[1], Bearer: +claimed[2], Aperture: +claimed[3], Threshold: +claimed[4], Emitter: +claimed[5], Vessel: +claimed[6] };
  const good = CLASSES.every((c) => (tally[c] ?? 0) === want[c]);
  check(good, `§11a class counts are correct: ${JSON.stringify(tally)}`, `§11a class counts claimed ${JSON.stringify(want)} but table has ${JSON.stringify(tally)}`);
}

// --- 4. every solving/inequality node has a legal open reading in §2.1 ---------------------------
// The 14 the previous round could not express.
const solving = nodeIds.filter((id) => id.startsWith("eq-") || id.startsWith("ineq-") || id === "props-equality" || id === "translate-sentence" || id === "eq-model-context");
check(solving.every((id) => mapped.has(id)), `all ${solving.length} solving/inequality nodes have a class`, "solving nodes unmapped");
const ineq = nodeIds.filter((id) => id.startsWith("ineq-"));
check(ineq.every((id) => mapped.get(id) === "Threshold"), "every inequality node is a Threshold", `inequality nodes off Threshold: ${ineq.filter((i) => mapped.get(i) !== "Threshold")}`);

// --- 5. words that must appear / must not appear -------------------------------------------------
const worldCount = (re) => (world.match(re) ?? []).length;
check(worldCount(/inequalit/gi) > 0, `world.md says "inequalit*" ${worldCount(/inequalit/gi)} times`, 'world.md never says "inequality"');
check(!/Best pun in the file/.test(world), "world.md: 'Best pun in the file' removed", "world.md still self-congratulates");
check(!/That last part is the style/.test(world), "world.md §0: meta-explanation removed", "world.md §0 still explains its own style");
check(!/players are eleven/.test(world), "world.md: eleven-year-old target removed", "world.md still writes for eleven");
check(!/eleven-year-old/.test(voice), "voice.md: eleven-year-old target removed", "voice.md still writes for eleven");
check(/thirteen to fifteen/.test(world), "world.md pins the register at 13–15", "world.md does not state the age target");
for (const gone of ["Divider", "Collector", "Substitute"]) {
  check(!new RegExp(`\\b${gone}\\b`).test(world) && !new RegExp(`\\b${gone}\\b`).test(voice), `Rung title "${gone}" is gone from both bibles`, `"${gone}" survives`);
}
for (const line of ["amb.tare.weigh.01", "That crab keeps changing shells", "So do I."]) {
  check(!voice.includes(line), `voice.md: cut "${line}"`, `voice.md still contains "${line}"`);
}

// --- 6. Ladder titles agree between §5 and §12 ---------------------------------------------------
const ladder = [...world.matchAll(/^\| \d+ \| \*\*([A-Za-z]+)\*\* \|/gm)].map((m) => m[1]);
const guard = /Provisional, Carrier,\s*\n?\s*Binder, Sharer, Opener, Warden, Walker, Factor, Broker, Solver/.test(world);
check(ladder.join(",") === "Provisional,Carrier,Binder,Sharer,Opener,Warden,Walker,Factor,Broker,Solver", `§5 Ladder: ${ladder.join(" → ")}`, `§5 Ladder unexpected: ${ladder.join(",")}`);
check(guard, "§12 canon guard lists the same ten titles", "§12 canon guard titles disagree with §5");

// --- 7. every world.md-named voice key actually exists in voice.md -------------------------------
const referenced = new Set([...world.matchAll(/`((?:ix|sennar|camber|dace|walk|sys|amb|sign|lore|fail|mastery)\.[a-z0-9.]+)`/g)].map((m) => m[1]));
const referencedV = new Set([...voice.matchAll(/`((?:ix|sennar|camber|dace|walk)\.[a-z0-9.]+)`/g)].map((m) => m[1]));
const defined = new Set([...voice.matchAll(/^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s+\S/gm)].map((m) => m[1]));
const dangling = [...new Set([...referenced, ...referencedV])].filter((k) => !defined.has(k));
check(dangling.length === 0, "every voice key cited in prose is defined", `dangling keys: ${dangling.join(", ")}`);

// --- 8. numeric canon: the Quorum arithmetic and the two Quorum states ---------------------------
// The clean run of the previous round is why these exist: a passing script that checks no numbers
// is not evidence about numbers.
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const numFromWords = (s) => {
  let total = 0, cur = 0;
  for (const w of s.toLowerCase().replace(/-/g, " ").split(/[\s,]+/).filter(Boolean)) {
    if (w === "and") continue;
    if (w in UNITS) cur += UNITS[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === "hundred") cur *= 100;
    else if (w === "thousand") { total += cur * 1000; cur = 0; }
    else return NaN;
  }
  return total + cur;
};
const nowM = /([A-Z][a-z-]+(?:\s+[a-z-]+)*)\s+leaves are currently true/.exec(world);
const thenM = /A year ago it was ([a-z-]+(?:\s+[a-z-]+)*),/.exec(world);
const ringM = /It has rung ([a-z-]+(?:\s+[a-z-]+)*)\s+times this year/.exec(world);
const ringV = /It has rung ([a-z-]+(?:\s+[a-z-]+)*)\s+times this year/.exec(voice);
check(!!ringV && numFromWords(ringV[1]) === numFromWords(ringM?.[1] ?? "zero"), "lore.bell.01's ring count agrees with world.md §9", `lore.bell.01 says ${ringV?.[1]}, world.md §9 says ${ringM?.[1]}`);
check(!!(nowM && thenM && ringM), "§3/§9 state the Quorum, the prior-year count and the ring count", "§3/§9 Quorum sentences not in the expected form");
if (nowM && thenM && ringM) {
  const now = numFromWords(nowM[1]), then = numFromWords(thenM[1]), rings = numFromWords(ringM[1]);
  check(now === 16004, `§3 Quorum is ${now}`, `§3 Quorum is ${now}, canon says 16004`);
  check(then - rings === now, `Quorum arithmetic holds: ${then} − ${rings} = ${now}`, `Quorum arithmetic broken: ${then} − ${rings} = ${then - rings}, but §3 says ${now}`);
}
// Both Quorum states must exist as strings, and the painted sign must be the pre-Bell one.
const vLine = (key) => (new RegExp(`^${key.replace(/\./g, "\\.")}\\s+(.+?)\\s*$`, "m").exec(voice) ?? [])[1];
check(/16 004/.test(vLine("sign.quorum.01") ?? ""), `sign.quorum.01 is the pre-Bell state: "${vLine("sign.quorum.01")}"`, `sign.quorum.01 must read 16 004 (a painted sign is static; the Bell rings in Beat 4): "${vLine("sign.quorum.01")}"`);
check(/^Sixteen thousand and four leaves are true\.$/.test(vLine("sys.quorum.00") ?? ""), "sys.quorum.00 exists and carries Beats 1–3", "sys.quorum.00 missing: Beats 1–3 have no Quorum readout");
check(/three/.test(vLine("sys.quorum.01") ?? ""), "sys.quorum.01 is the post-Bell state", "sys.quorum.01 is not the post-Bell state");
check(/three/.test(vLine("amb.quorum.01") ?? ""), "amb.quorum.01 is the post-Bell state", "amb.quorum.01 is not the post-Bell state");

// --- 9. the Valerian gate: strangeness in kind, not in line count --------------------------------
// §0 of voice.md defends the dial with a count; this is the half a count cannot prove.
const manifest = world.slice(world.indexOf("This subsection is a **manifest**"), world.indexOf("### Dace — the other Provisional"));
const rows = [...manifest.matchAll(/^\| \*\*(.+?)\*\*/gm)].map((m) => m[1]);
const unnameable = [...manifest.matchAll(/^\| \*\*(.+?)\*\* \*\(unnameable\)\*/gm)].map((m) => m[1]);
check(rows.length >= 13, `§3 manifest has ${rows.length} presences`, `§3 manifest shrank to ${rows.length}`);
check(unnameable.length >= 4, `§3 manifest: ${unnameable.length} presences unnameable in one word — ${unnameable.join("; ")}`, `§3 manifest has only ${unnameable.length} unnameable presences; the Valerian gate needs 4`);
for (const must of ["The Bollard, and the Second Lip", "Three of something, rating the middle carry", "A several", "The thing above the certainty field"]) {
  check(unnameable.includes(must), `§3 keeps "${must}"`, `§3 lost the unnameable presence "${must}"`);
}
// Each unnameable must be placeable: a lexicon row in §4.4 or §4.5.
const lex44 = world.slice(world.indexOf("### 4.4 Peoples and trades"), world.indexOf("### 4.6"));
for (const term of ["rating", "a several", "the Bollard and the Second Lip", "standing, unattributed"]) {
  check(lex44.includes(`| **${term}** |`), `§4.4/§4.5 defines "${term}" so P09/P13 can place it`, `"${term}" has no lexicon row`);
}
// One walk-on register must not be a human trade.
const walkRules = [...voice.matchAll(/^### (?:The |And one who barely speaks — )?(.+?) \*\(rule: (.+?)\)\*/gm)];
const walkKeys = new Set([...voice.matchAll(/^walk\.([a-z]+)\./gm)].map((m) => m[1]));
check(walkKeys.size === 8, `voice.md §2b has ${walkKeys.size} walk-on key families (7 registers + Sixth Vey): ${[...walkKeys].join(", ")}`, `voice.md §2b has ${walkKeys.size} walk-on key families, expected 8`);
check(walkKeys.has("rate"), "voice.md §2b carries the non-human register walk.rate.*", "voice.md §2b lost walk.rate.* — the Valerian gate's second half is gone");
check(walkRules.length >= 7, `§2b states ${walkRules.length} one-line register rules`, `§2b states only ${walkRules.length} register rules`);
// walk.rate.* must never use the first-person singular, and every line must name a part of the body.
const rateLines = [...voice.matchAll(/^walk\.rate\.\d+\s+(.+?)\s*$/gm)].map((m) => m[1]);
check(rateLines.length === 5, `walk.rate.* ships ${rateLines.length} lines`, `walk.rate.* ships ${rateLines.length} lines, expected 5`);
check(rateLines.every((l) => /\b(wet|dry|far|near|this one)\b/i.test(l)), "every walk.rate line names which part of it is speaking", `walk.rate lines missing a body part: ${rateLines.filter((l) => !/\b(wet|dry|far|near|this one)\b/i.test(l)).join(" | ")}`);
check(rateLines.every((l) => !/\bI\b|\bI'm\b|\bI've\b/.test(l)), "no walk.rate line uses the first-person singular", "a walk.rate line uses I");

// --- 9b. voice.md §0's blend table must match the string bank, digit for digit --------------------
// §0 says its numbers are regenerated, never estimated. This is the assertion that makes that true.
const bank = new Map();
{
  let inFence = false;
  for (const line of voice.split(/\r?\n/)) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (!inFence) continue;
    const m = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s+(.+?)\s*$/.exec(line);
    if (m) bank.set(m[1], m[2]);
  }
}
const grp = (p) => [...bank.keys()].filter((k) => k.startsWith(p + ".")).length;
const solv = [...bank.keys()].filter((k) => k.startsWith("walk.solv.")).length;
const tableFails = [...voice.matchAll(/^\| .+? \| `(fail\.[a-z.]+)` — .+? \|$/gm)].length;
const zero = voice.slice(voice.indexOf("## 0. The blend"), voice.indexOf("## 1. The one rule"));
const expect = [
  [`**Ix** (${grp("ix")}), and **Dace** (${grp("dace")})`, "Fourth Wing row speakers"],
  [`| **${grp("ix") + grp("dace")}** |`, "Fourth Wing row total"],
  [`**Sennar** (${grp("sennar")}); **Sixth Vey** (${solv})`, "Red Rising row speakers"],
  [`**Adjuster Camber** (${grp("camber")}) and the signage (${grp("sign")})`, "Hitchhiker's row speakers"],
  [`| **${grp("camber") + grp("sign")}** |`, "Hitchhiker's row total"],
  [`seven walk-on registers (${grp("walk") - solv}, §2b)`, "Valerian walk-on count"],
  [`ambient discovery (${grp("amb")}), signage (${grp("sign")}), plaques (${grp("lore")})`, "Valerian world registers"],
  [`**${grp("walk") - solv + grp("amb") + grp("sign") + grp("lore")}**, *and the count is not the evidence*`, "Valerian row total"],
  [`**${bank.size + tableFails} shippable strings**: ${bank.size} in the fenced blocks`, "grand total incl. the §4 fail.* table"],
  [`Currently ${grp("walk") + grp("amb") + grp("sign") + grp("lore")} against ${Math.max(grp("ix"), grp("sennar"), grp("camber"), grp("dace"))}.`, "standing budget"],
];
for (const [needle, what] of expect) {
  check(zero.includes(needle), `§0 ${what} matches the string bank: ${needle.replace(/\*/g, "")}`, `§0 ${what} is stale — the bank says "${needle.replace(/\*/g, "")}"`);
}
check(zero.includes("The Valerian gate."), "§0 states the Valerian gate beside the count", "§0 defends the Valerian dial with a line count alone");

// --- 10. the §0 picture paragraph is the binding composition spec ---------------------------------
const picture = world.slice(world.indexOf("### The picture"), world.indexOf("## 1. Title"));
const nonHuman = ["they are the same animal", "no fronts and no faces", "a several drinking", "slow humming animal", "birds that arrive before their own noise", "closing its own claim for"];
const presentNH = nonHuman.filter((p) => picture.includes(p));
check(presentNH.length >= 5, `§0 picture paragraph carries ${presentNH.length} non-human living presences`, `§0 picture paragraph carries only ${presentNH.length} non-human presences; ≥4 required`);
check(/failed frame|is also a bug/.test(picture), "§0 states the all-human-frame failure rule", "§0 no longer forbids an all-human frame");

// --- 11. lexicon count in §4's header matches the tables ------------------------------------------
const lexSection = world.slice(world.indexOf("## 4. Lexicon"), world.indexOf("## 5. The Ladder"));
const lexRows = [...lexSection.matchAll(/^\| \*\*(.+?)\*\* \| .*? \| .+? \|$/gm)].length;
const lexClaim = numFromWords((/^([A-Za-z-]+(?: [a-z-]+)*) proper nouns and terms of art/m.exec(lexSection) ?? [])[1] ?? "zero");
check(lexClaim === lexRows, `§4 header claims ${lexClaim} terms and the tables hold ${lexRows}`, `§4 header claims ${lexClaim} terms but the tables hold ${lexRows}`);

console.log(ok.map((s) => `  ok   ${s}`).join("\n"));
if (fails.length) {
  console.log("\n" + fails.map((s) => `  FAIL ${s}`).join("\n"));
  console.log(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`\n${ok.length} checks passed, 0 failures`);
