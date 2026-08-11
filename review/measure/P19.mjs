/**
 * P19 — the in-world learning verbs, measured.
 *
 * ==================================================================================================
 * WHAT THIS SCRIPT IS FOR
 *
 * Round 3's critic did not disagree with the piece's description of itself. They ran the shipped
 * `VERBS` array over the shipped bank and found that "only 240 of 1152 items (20.8%) are answered by
 * an act that is itself algebra" and that "796 items (69.1%) pose NO verb at all". Every number in
 * this file is one of theirs, recomputed the same way, so the two rounds can be compared line for
 * line rather than argued about.
 *
 * Three parts, and the first one runs without a browser:
 *
 *   A. OFFLINE, over all 1,152 committed items — which verb poses each one, and whether a pair of
 *      hands can actually reach a reading the SHIPPED checker marks correct. The answer key is used
 *      only to mark what the hands produced; it is never an input to them, and `guards` below greps
 *      the whole verb folder to prove no verb can see it.
 *   B. LIVE, on a keyboard — the ordered signal trace off the shipped app. `learn:present` ->
 *      `math:show` -> `learn:respond` -> `learn:mastery`, repeating, with non-zero counts on all four.
 *      That trace is the deliverable; RESUME §6d's baseline was 1 / 11 / 0 / 0.
 *   C. LIVE, on a gamepad — the same cycle with no keyboard attached at all, because round 3's second
 *      action is that a pad player could not answer 69% of the content.
 *
 * Usage:  node review/measure/P19.mjs            all three
 *         node review/measure/P19.mjs offline    part A only, no browser
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import Forge from "../../app/src/learn/verbs/Forge.js";
import { ItemBank } from "../../app/src/learn/ItemBank.js";
import { isBundle, parseClaim } from "../../app/src/learn/verbs/Claim.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERB_DIR = path.join(ROOT, "app", "src", "learn", "verbs");
const which = (process.argv[2] ?? "all").toLowerCase();

const fails = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails.push(label);
  return ok;
};

/* ================================================================= A. offline, over the whole bank */

let all = [];
for (const f of fs.readdirSync(path.join(ROOT, "content", "items", "bank")))
  all = all.concat(JSON.parse(fs.readFileSync(path.join(ROOT, "content", "items", "bank", f), "utf8")).items);
const bank = new ItemBank();

const open = (it) => ({
  itemId: it.id,
  kpId: it.kpId,
  form: it.form,
  stem: it.stem ?? "",
  given: it.given ?? [],
  working: it.working ?? [],
  unknown: it.unknown ?? "x",
  answerType: it.answerType ?? null,
  objectClass: it.objectClass ?? null,
});

const poseOf = (ctx) => {
  for (const v of VERBS) {
    let a = null;
    try {
      a = v.pose(ctx);
    } catch {
      a = null;
    }
    if (a) return { id: v.id, verb: v, act: a };
  }
  return { id: null };
};

console.log("=== A1. which verb poses each of the 1,152 committed items ===");
const byVerb = new Map();
const unposed = new Map();
for (const it of all) {
  const { id } = poseOf(open(it));
  byVerb.set(id ?? "(none)", (byVerb.get(id ?? "(none)") ?? 0) + 1);
  if (!id) {
    const k = `${it.form}|${it.answerType}`;
    unposed.set(k, (unposed.get(k) ?? 0) + 1);
  }
}
for (const [k, n] of [...byVerb.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(n).padStart(4)}  ${((n / all.length) * 100).toFixed(1).padStart(5)}%  ${k}`);
const posed = all.length - (byVerb.get("(none)") ?? 0);
console.log(`   posed by a verb: ${posed} / ${all.length}  (${((posed / all.length) * 100).toFixed(1)}%)`);
console.log("   still unposed, by form|answerType:");
for (const [k, n] of [...unposed.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${k}`);

// Round 3's headline was 20.8% answered by an act that is itself algebra, 69.1% posing nothing.
check(posed >= 1000, "at least 1,000 of 1,152 committed items pose a verb", `${posed}`);
check((byVerb.get("repair") ?? 0) >= 300, "REPAIR poses the repair block", `${byVerb.get("repair") ?? 0} items`);
check((byVerb.get("forge") ?? 0) >= 280, "FORGE poses the generate block", `${byVerb.get("forge") ?? 0} items`);
check((byVerb.get("seat") ?? 0) >= 40, "SEAT poses the substitution block SPAN used to dial", `${byVerb.get("seat") ?? 0} items`);

console.log("\n=== A2. can the hands reach a reading the shipped checker marks correct? ===");
console.log("   (a mechanical driver over the DISCRETE acts only — a lower bound, not a ceiling)");
const BARE = { held: new Set() };
const FINE = { held: new Set(["crouch"]) };
const ACTIONS = ["take", "stepNext", "stepPrev", "back", "take5", "take10", "dial"];

function reachable(verb, ctx, item, maxStates = 3000) {
  const seen = new Set();
  const queue = [[]];
  let states = 0;
  while (queue.length && states < maxStates) {
    const seq = queue.shift();
    let act = null;
    try {
      act = verb.pose(ctx);
    } catch {
      return false;
    }
    if (!act) return false;
    let ok = true;
    for (const s of seq) {
      try {
        if (s.fine) act.act("hold", FINE);
        if (s.name === "take5" || s.name === "take10") {
          const n = s.name === "take5" ? 5 : 10;
          for (let i = 0; i < n; i += 1) act.act("take", s.fine ? FINE : BARE);
        } else if (s.name === "dial") {
          for (let i = 0; i < 24; i += 1) act.fixed?.(1 / 60, { move: { x: 0, y: 1 }, held: new Set() });
        } else act.act(s.name, s.fine ? FINE : BARE);
        if (s.fine) act.act("release", BARE);
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    states += 1;
    let sig = null;
    try {
      sig = JSON.stringify(act.state?.() ?? seq.length);
    } catch {
      sig = String(seq.length);
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    try {
      const r = act.response?.();
      if (r && bank.check(item, r)?.correct) return true;
    } catch {
      /* a response the checker cannot read is not a correct one */
    }
    if (seq.length >= 8) continue;
    for (const name of ACTIONS) queue.push([...seq, { name }]);
    if (seq.length < 4) queue.push([...seq, { name: "take", fine: true }]);
  }
  return false;
}

const reachByVerb = new Map();
const poseByVerb = new Map();
for (const it of all) {
  const ctx = open(it);
  const { id, verb } = poseOf(ctx);
  if (!id) continue;
  poseByVerb.set(id, (poseByVerb.get(id) ?? 0) + 1);
  // FORGE is a builder with a continuous count axis; a discrete search cannot walk a dial to 35, so
  // it gets the constructive proof in A3 instead of the search.
  if (id === "forge") continue;
  if (reachable(verb, ctx, it)) reachByVerb.set(id, (reachByVerb.get(id) ?? 0) + 1);
}
let closed = 0;
let closable = 0;
for (const [id, n] of [...poseByVerb.entries()].sort()) {
  if (id === "forge") continue;
  const r = reachByVerb.get(id) ?? 0;
  closed += r;
  closable += n;
  console.log(`   ${id.padEnd(11)} ${String(r).padStart(4)} / ${String(n).padEnd(4)}  ${((r / n) * 100).toFixed(1)}%`);
}
console.log(`   closing verbs overall: ${closed} / ${closable}  (${((closed / closable) * 100).toFixed(1)}%)`);
check(closed / closable >= 0.85, "a correct reading is reachable by hand on 85%+ of the closing verbs' items");
check((reachByVerb.get("repair") ?? 0) / (poseByVerb.get("repair") ?? 1) >= 0.9, "REPAIR: 90%+ of its items are closable by hand");

console.log("\n=== A3. can FORGE actually build what the bank asks for? ===");
console.log("   (the item's own committed witness, replayed through the act's PUBLIC input surface)");
const tap = (act, dir, fine) => {
  if (fine) act.act("hold", FINE);
  act.fixed(1 / 60, { move: { x: 0, y: dir }, held: fine ? FINE.held : BARE.held });
  act.fixed(1 / 60, { move: { x: 0, y: 0 }, held: BARE.held });
  if (fine) act.act("release", BARE);
};
const dialTo = (act, n, d) => {
  // The distance is measured ONCE. `act.blank.n` is moving under this loop, so re-reading it in the
  // bound makes the counter and the target meet halfway — which is a bug in the harness that reads
  // exactly like a bug in the verb, and did for one run of this script.
  const dir = n > act.blank.n ? 1 : -1;
  const steps = Math.min(220, Math.abs(n - act.blank.n));
  for (let i = 0; i < steps; i += 1) tap(act, dir, false);
  for (let i = 1; i < d && i < 14; i += 1) tap(act, 1, true);
};
const setKind = (act, v) => {
  const want = act.kinds.indexOf(v ?? null);
  if (want < 0) return false;
  let guard = 0;
  while (act.blank.kind % act.kinds.length !== want && guard++ < 20) act.act("stepNext", FINE);
  return true;
};
const place = (act, t) => {
  if (isBundle(t)) {
    dialTo(act, t.k.n, t.k.d);
    act.act("take", FINE);
    for (const w of t.inner) place(act, w);
    act.act("take", FINE);
    return;
  }
  if (!setKind(act, t.v)) return;
  dialTo(act, t.c.n, t.c.d);
  act.act("take", BARE);
};
const walk = (act, to) => {
  let guard = 0;
  while (act.station !== to && guard++ < 8) act.act("stepNext", BARE);
};
let forgeN = 0;
let forgeOk = 0;
for (const it of all) {
  const { id, act } = poseOf(open(it));
  if (id !== "forge") continue;
  forgeN += 1;
  const claim = parseClaim(it.answer?.tex ?? it.answer?.canonical ?? "");
  if (!claim) continue;
  walk(act, 1);
  const want = claim.rel ? { "=": "=", ">=": ">=", "<=": "<=", ">": ">", "<": "<" }[claim.rel] : null;
  let guard = 0;
  while (act.rel !== want && guard++ < 8) act.act("take", BARE);
  walk(act, 0);
  for (const t of claim.near) place(act, t);
  if (claim.far) {
    walk(act, 2);
    for (const t of claim.far) place(act, t);
  }
  let r = null;
  try {
    r = act.response();
  } catch {
    r = null;
  }
  try {
    if (r && bank.check(it, r)?.correct) forgeOk += 1;
  } catch {
    /* not built */
  }
}
console.log(`   forge ${forgeOk} / ${forgeN}  (${((forgeOk / forgeN) * 100).toFixed(1)}%) of committed witnesses are buildable by hand`);
check(forgeOk / forgeN >= 0.85, "FORGE can build 85%+ of the committed witnesses");

console.log("\n=== A4. the guards ===");
const files = fs.readdirSync(VERB_DIR).filter((f) => f.endsWith(".js"));
const source = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(VERB_DIR, f), "utf8")]));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const answerLeak = files.filter((f) => /\bitem\.answer\b|\.distractors\b|\bitem\.check\b|\.brokenBy\b/.test(strip(source[f])));
check(answerLeak.length === 0, "no verb reads the answer, the distractors, the check spec or brokenBy", answerLeak.join(" "));
const imports = files.filter((f) => /from\s+"\.\.\/(?!\.)/.test(strip(source[f])));
check(imports.length === 0, "no verb imports a sibling feature module", imports.join(" "));
const emitters = files.filter((f) => /emit\(\s*["']learn:respond/.test(strip(source[f])));
check(emitters.length === 0, "no verb emits learn:respond itself — it commits through Teaching", emitters.join(" "));
check(
  VERBS.every((v) => typeof v.pose === "function" && typeof v.id === "string"),
  "every registered verb has an id and a pose"
);
console.log(`   registry: ${VERBS.map((v) => v.id).join(", ")}`);

if (which === "offline") {
  console.log(fails.length ? `\nFAILED: ${fails.join(" · ")}` : "\nOFFLINE CHECKS PASSED");
  process.exit(fails.length ? 1 : 0);
}

/* ============================================================================ B and C: the shipped app */

const { openGame } = await import("../../tools/lib/session.mjs");

/**
 * Wait until a claim is actually in the player's hands.
 *
 * The presenter holds a marked claim for `TEACH.feedbackSeconds` and then waits `gapSeconds` before
 * standing the next one, so an `interact` pressed on a fixed clock lands in the gap about half the
 * time — and an `interact` that arrives one frame after a claim is posed sets it straight back down
 * with nothing done to it. The first run of this script did exactly that and reported one cycle in
 * fourteen turns, which is a measurement of the harness rather than of the game.
 */
async function untilHolding(d, tries = 24) {
  for (let i = 0; i < tries; i += 1) {
    const v = await d.probe("verbs");
    if (v?.phase === "performing" && v?.verb) return v;
    if (v?.phase === "idle") await d.page.keyboard.press("KeyE");
    await d.play(0.35);
  }
  return await d.probe("verbs");
}

/** One turn at a claim, on the keyboard: take it on, work it, set it down. */
async function keyboardTurn(d, i, onMid = null) {
  const before = await untilHolding(d);
  if (before?.phase !== "performing") return before;
  // Work it with the acts every verb shares. The mix varies per turn so the trace is not one act
  // repeated: a strike, a drive, a walk of the grip, a second-grip strap.
  for (let k = 0; k < 3 + (i % 3); k += 1) {
    await d.page.mouse.down({ button: "left" });
    await d.play(0.12);
    await d.page.mouse.up({ button: "left" });
    await d.play(0.1);
  }
  if (i % 2 === 0) {
    await d.page.keyboard.press("BracketRight");
    await d.play(0.15);
    await d.page.mouse.down({ button: "left" });
    await d.play(0.12);
    await d.page.mouse.up({ button: "left" });
  }
  await d.hold("KeyW", 0.5);
  await d.play(0.3);
  // Mid-performance: the hands are still on the claim and nothing has been marked.
  if (onMid) await onMid(await d.probe("verbs"));
  await d.page.keyboard.press("KeyE"); // interact — set it down
  // Long enough to clear the presenter's feedback window AND its gap, so the next turn's `interact`
  // cannot land on a claim that was posed a frame ago.
  await d.play(3.0);
  return before;
}

async function live() {
  console.log("\n=== B. the shipped app, on a keyboard ===");
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    await d.run(() => {
      window.__trace = [];
      const k = window.__vs.kernel;
      for (const n of ["learn:present", "math:show", "learn:respond", "learn:mastery"])
        k.signals.on(n, (v) =>
          window.__trace.push({ n, t: Number(k.simTime.toFixed(2)), d: v?.itemId ?? v?.id ?? v?.kpId ?? "" })
        );
      return true;
    });

    const verbsSeen = new Set();
    const shot = new Set();
    for (let i = 0; i < 16; i += 1) {
      const before = await keyboardTurn(d, i, async (mid) => {
        // One capture per verb, taken WHILE the hands are on it and before anything is marked. A
        // capture of a verb nobody was performing is a still life, not evidence.
        if (!mid?.verb || shot.has(mid.verb)) return;
        shot.add(mid.verb);
        console.log(`   [capture] ${mid.verb} · ${mid.item?.itemId} · ${JSON.stringify(mid.state).slice(0, 200)}`);
        await d.shoot(`review/shots/P19-r4/mid-${mid.verb}.png`);
      });
      if (before?.verb) verbsSeen.add(before.verb);
    }

    const trace = await d.run(() => window.__trace);
    const counts = {};
    for (const e of trace) counts[e.n] = (counts[e.n] ?? 0) + 1;
    console.log(
      `   learn:present ${counts["learn:present"] ?? 0} · math:show ${counts["math:show"] ?? 0} · ` +
        `learn:respond ${counts["learn:respond"] ?? 0} · learn:mastery ${counts["learn:mastery"] ?? 0}`
    );
    // The ORDER, not just the counts: how many times the full cycle ran end to end.
    let cycles = 0;
    let stage = 0;
    for (const e of trace) {
      if (stage === 0 && e.n === "learn:present") stage = 1;
      else if (stage === 1 && e.n === "math:show") stage = 2;
      else if (stage === 2 && e.n === "learn:respond") stage = 3;
      else if (stage === 3 && e.n === "learn:mastery") {
        cycles += 1;
        stage = 0;
      }
    }
    console.log(`   complete present -> show -> respond -> mastery cycles, in order: ${cycles}`);
    console.log(`   verbs that actually posed in play: ${[...verbsSeen].join(", ") || "(none)"}`);

    const v = await d.probe("verbs");
    console.log(`   probe("verbs").stats: ${JSON.stringify(v?.stats)}`);
    console.log(`   drop=${v?.drop} drops=${v?.drops} veiled=${v?.veiled} restands=${v?.restands} letGos=${v?.letGos}`);
    console.log(`   lastResponse: ${JSON.stringify(v?.lastResponse)}`);

    check((counts["learn:present"] ?? 0) > 0, "learn:present fires");
    check((counts["math:show"] ?? 0) > 0, "math:show fires");
    check((counts["learn:respond"] ?? 0) > 0, "learn:respond fires — RESUME §6d's baseline was 0");
    check((counts["learn:mastery"] ?? 0) > 0, "learn:mastery fires — RESUME §6d's baseline was 0");
    check(cycles >= 3, "the whole cycle runs, in order, more than once", `${cycles} cycles`);
    check(verbsSeen.size >= 2, "more than one verb poses in a single sitting", [...verbsSeen].join(","));
    check((v?.stats?.commitMismatch ?? 1) === 0, "no commit ever carried anything but what the hands built");
    check(
      (v?.stats?.familyOnWire ?? 0) >= (v?.stats?.respondHeard ?? 1),
      "every response reached Mastery with its family",
      `${v?.stats?.familyOnWire}/${v?.stats?.respondHeard}`
    );
    check((v?.stats?.refusedChars ?? 1) === 0, "the entry grammar refused nothing the hands built");
  });
}

async function pad() {
  console.log("\n=== C. the shipped app, on a gamepad, with no keyboard used at all ===");
  await openGame({ width: 1280, height: 720 }, async (d) => {
    await d.play(1.0);
    await d.run(() => window.__vsInput.connect({ style: "xbox" }));
    await d.play(0.5);
    await d.run(() => {
      window.__trace = [];
      const k = window.__vs.kernel;
      for (const n of ["learn:present", "math:show", "learn:respond", "learn:mastery"])
        k.signals.on(n, (v) => window.__trace.push({ n, t: Number(k.simTime.toFixed(2)) }));
      return true;
    });
    const verbsSeen = new Set();
    for (let i = 0; i < 10; i += 1) {
      await d.run(() => window.__vsInput.tap("X")); // interact — take it on
      await d.play(0.6);
      const before = await d.probe("verbs");
      if (before?.verb) verbsSeen.add(before.verb);
      for (let k = 0; k < 3 + (i % 3); k += 1) {
        await d.run(() => window.__vsInput.press("RT", 1)); // primary
        await d.play(0.12);
        await d.run(() => window.__vsInput.release("RT"));
        await d.play(0.1);
      }
      if (i % 2 === 0) {
        await d.run(() => window.__vsInput.tap("RB")); // cycleNext
        await d.play(0.15);
        await d.run(() => window.__vsInput.press("RT", 1));
        await d.play(0.12);
        await d.run(() => window.__vsInput.release("RT"));
      }
      await d.run(() => window.__vsInput.stick("left", 0, -1));
      await d.play(0.5);
      await d.run(() => window.__vsInput.stick("left", 0, 0));
      await d.play(0.2);
      await d.run(() => window.__vsInput.tap("X")); // interact — set it down
      await d.play(2.2);
      if (i === 3) await d.shoot("review/shots/P19-r4/pad-mid.png");
    }
    const trace = await d.run(() => window.__trace);
    const counts = {};
    for (const e of trace) counts[e.n] = (counts[e.n] ?? 0) + 1;
    const v = await d.probe("verbs");
    console.log(
      `   learn:present ${counts["learn:present"] ?? 0} · math:show ${counts["math:show"] ?? 0} · ` +
        `learn:respond ${counts["learn:respond"] ?? 0} · learn:mastery ${counts["learn:mastery"] ?? 0}`
    );
    console.log(`   device: ${JSON.stringify(v?.pad)}`);
    console.log(`   verbs posed on the pad: ${[...verbsSeen].join(", ") || "(none)"}`);
    console.log(`   probe("verbs").stats: ${JSON.stringify(v?.stats)}`);
    check(v?.pad?.device === "pad", "the game believes it is being played on a pad", String(v?.pad?.device));
    check((counts["learn:respond"] ?? 0) > 0, "a pad player can answer — learn:respond fires with no keyboard");
    check((counts["learn:mastery"] ?? 0) > 0, "a pad player earns mastery");
  });
}

if (which === "all" || which === "live") await live();
if (which === "all" || which === "pad") await pad();

console.log(fails.length ? `\nFAILED: ${fails.join(" · ")}` : "\nP19 CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
