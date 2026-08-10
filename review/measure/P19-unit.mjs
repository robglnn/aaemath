/**
 * P19 · the verbs, driven over the shipped item bank, offline.
 *
 * This is NOT the deliverable — `review/measure/P19.mjs` is, and it drives the real app in a real
 * browser. This runs first and answers the question that would otherwise only be answerable one item
 * at a time in a headless capture: **can a player who knows the algebra actually close these claims
 * with their hands, and does the shipped checker agree?**
 *
 * The harness plays the part of a learner. It drives the verb through the SAME acts a controller
 * emits — `take`, `stepNext`, `back`, and a forward push on the stick — and never reaches inside the
 * act to set a value. Two scripts run against every posed item:
 *
 *   - **the competent script**, which performs the algebra correctly and must be marked `correct`;
 *   - **the misconception script**, which performs a specific, tagged, real Algebra I error and must
 *     be marked wrong AND diagnosed with the misconception the bank tagged for it (gate L7).
 *
 * Where the competent script needs a number it does not derive — SPAN's deck length — it is allowed
 * to read `item.answer`, because IT is the player and the player knows. **The verb is never told.**
 * The last section of this file greps `app/src/learn/verbs/` to prove that.
 */
import fs from "node:fs";
import path from "node:path";
import { itemBank } from "../../app/src/learn/ItemBank.js";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import { R, isBundle, isolated, rat, settle } from "../../app/src/learn/verbs/Claim.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BANK = path.join(ROOT, "content", "items", "bank");

const items = [];
for (const f of fs.readdirSync(BANK)) items.push(...JSON.parse(fs.readFileSync(path.join(BANK, f), "utf8")).items);

const ctxOf = (item) => ({
  itemId: item.id,
  kpId: item.kpId,
  form: item.form,
  stem: item.stem ?? "",
  given: item.given ?? [],
  working: item.working ?? [],
  unknown: item.unknown ?? "x",
  answerType: item.answerType ?? null,
  objectClass: item.objectClass ?? null,
});

function pose(ctx) {
  for (const v of VERBS) {
    let a = null;
    try {
      a = v.pose(ctx);
    } catch (err) {
      return { error: String(err.message || err), verb: v.id };
    }
    if (a) return { act: a, verb: v.id };
  }
  return null;
}

/** One simulated step of the stick held forward, exactly as `input:move {y:1}` arrives. */
const push = (act, seconds = 1, y = 1) => {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) act.fixed(1 / 60, { move: { x: 0, y }, held: new Set() });
};
const idle = (act, seconds = 0.3) => {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) act.fixed(1 / 60, { move: { x: 0, y: 0 }, held: new Set() });
};

// ------------------------------------------------------------------ the competent learner

function playSpan(act, item) {
  const target = String(item.answer?.canonical ?? "");
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(target);
  const want = m ? rat(Number(m[1]), m[2] ? Number(m[2]) : 1) : null;
  if (act.mode === "one") {
    if (!want) return false;
    if (want.d !== 1) {
      act.act("hold");
      for (let i = 1; i < want.d; i += 1) act.act("take");
      act.act("release");
    }
    const n = want.n;
    for (let i = 0; i < Math.abs(n); i += 1) act.act(n > 0 ? "take" : "back");
    if (n === 0) act.act("take"), act.act("back");
    return true;
  }
  if (act.mode === "pair" || act.mode === "cut") {
    // The answer is a set of `name = value` pairs; the learner charges each socket to its own.
    const pairs = new Map();
    for (const part of String(item.answer?.canonical ?? "").split(/[;,]/)) {
      const p = /^\s*([a-zA-Z])\s*=\s*(-?\d+)/.exec(part);
      if (p) pairs.set(p[1], Number(p[2]));
    }
    for (let s = 0; s < act.sockets.length; s += 1) {
      act.grip = s;
      const v = pairs.get(act.sockets[s].name) ?? [...pairs.values()][0] ?? 0;
      for (let i = 0; i < Math.abs(v); i += 1) act.act(v > 0 ? "take" : "back");
      if (v === 0) act.act("take"), act.act("back");
    }
    return true;
  }
  if (act.mode === "ratio") {
    // The bank states a relation claim in its canonical `1*a + -3*b = 0` form; a learner reads
    // "three of yours for one of mine" off the said claim and cranks the rating to 3.
    const p = /^\s*(-?\d+)\*([a-zA-Z])\s*\+\s*(-?\d+)\*([a-zA-Z])\s*=\s*0\s*$/.exec(String(item.answer?.canonical ?? ""));
    if (!p) return false;
    const head = Number(p[1]) === 1 ? p[2] : p[4];
    const ratio = Number(p[1]) === 1 ? -Number(p[3]) : -Number(p[1]);
    for (let i = 0; i < 4 && act.sockets[act.head].name !== head; i += 1) act.act("stepNext");
    const k = ratio;
    for (let i = 0; i < Math.abs(k); i += 1) act.act(k > 0 ? "take" : "back");
    return true;
  }
  return false;
}

/** Gather, open, carry, share — the acts the Ladder's first four Rungs are permissions for. */
function playSill(act) {
  const unknown = act.unknown;
  for (let guard = 0; guard < 40; guard += 1) {
    const c = act.claim;
    if (isolated(c, unknown)) return true;
    const row = act.row;
    // 1. open anything still bundled, outward-in.
    const b = row.findIndex((g) => g.kind === "term" && isBundle(g.t));
    if (b >= 0) {
      act.grip = b;
      act.act("take");
      continue;
    }
    // 2. gather like kinds before lifting anything (§11a, eq-combine-side).
    let gathered = false;
    for (const side of ["near", "far"]) {
      const load = side === "near" ? c.near : c.far ?? [];
      for (let i = 0; i < load.length && !gathered; i += 1)
        for (let j = i + 1; j < load.length && !gathered; j += 1)
          if (!isBundle(load[i]) && !isBundle(load[j]) && (load[i].v ?? null) === (load[j].v ?? null)) {
            act.grip = row.findIndex((g) => g.kind === "term" && g.side === side && g.index === i);
            act.act("take");
            gathered = true;
          }
    }
    if (gathered) continue;
    // 3. the unknown belongs on the near pan and fixed weight on the far one.
    const strayFar = (c.far ?? []).findIndex((t) => !isBundle(t) && t.v === unknown);
    if (strayFar >= 0) {
      act.grip = row.findIndex((g) => g.kind === "term" && g.side === "far" && g.index === strayFar);
      act.act("take");
      continue;
    }
    const strayNear = c.near.findIndex((t) => !isBundle(t) && t.v == null);
    if (strayNear >= 0) {
      act.grip = row.findIndex((g) => g.kind === "term" && g.side === "near" && g.index === strayNear);
      act.act("take");
      continue;
    }
    // 4. nothing left to move: the near pan is one term of the unknown. Share both pans by its count.
    const n = settle(c.near);
    if (n.length !== 1 || n[0].v !== unknown) {
      // The unknown is not on the near pan at all — walk round the Sill and read it from there.
      const sill = act.row.findIndex((g) => g.kind === "sill");
      act.grip = sill;
      act.dial = 1;
      act.act("take");
      continue;
    }
    if (R.eq(n[0].c, R.one)) return true;
    const sill = act.row.findIndex((g) => g.kind === "sill");
    act.grip = sill;
    if (n[0].c.d !== 1) {
      // The near pan is already shared into parts. Gather both pans by the same count — the second
      // grip at the Sill — until one whole thing is standing there.
      act.dial = n[0].c.d;
      if (!act.act("hold")) return false;
      continue;
    }
    act.dial = n[0].c.n;
    act.act("take");
  }
  return false;
}

function playCombine(act) {
  for (let guard = 0; guard < 24; guard += 1) {
    const load = act.load;
    let pair = null;
    for (let i = 0; i < load.length && !pair; i += 1)
      for (let j = i + 1; j < load.length && !pair; j += 1) if ((load[i].v ?? null) === (load[j].v ?? null)) pair = [i, j];
    if (!pair) return true;
    act.grip = pair[0];
    // Push toward the mate; the load slides past whatever will not take it until they are adjacent.
    for (let n = 0; n < 8 && act.grip !== pair[1] - 1 && act.grip < load.length - 1; n += 1) act.act("take");
    act.act("take");
  }
  return false;
}

function playDistribute(act) {
  for (let i = 0; i < 8; i += 1) if (!act.act("take")) break;
  return true;
}

// ------------------------------------------------------------------ the misconception scripts

/** DISTRIBUTE: drive the value into the first ward and stop. `distributed-to-first-only`. */
function missDistribute(act) {
  act.act("take");
  return act.bundleTerm?.reached === 1 && act.wards > 1;
}

/** BALANCE: take a term off the near pan and put it nowhere. `fail.onesided`. */
function missOneSided(act) {
  const i = act.row.findIndex((g) => g.kind === "term" && g.side === "near" && !isBundle(g.t) && g.t.v == null);
  if (i < 0) return false;
  act.grip = i;
  push(act, 0.7, -1);
  return act.oneSided === true;
}

/** TILT: turn the rail and leave the mark where it was. `fail.mark.unturned`. */
function missUnturnedMark(act) {
  act.act("hold");
  return act.railTurns === 1;
}

// ------------------------------------------------------------------ run

const stats = { total: items.length, posed: 0, byVerb: {}, unposed: {}, closed: {}, wrong: {}, errors: [] };
const misses = { distribute: { n: 0, tagged: 0, keys: {} }, balance: { n: 0, tagged: 0, keys: {} }, tilt: { n: 0, tagged: 0, keys: {} } };
const samples = [];

for (const item of items) {
  const ctx = ctxOf(item);
  const posed = pose(ctx);
  if (posed?.error) {
    stats.errors.push(`${item.id}: ${posed.error}`);
    continue;
  }
  if (!posed) {
    const k = `${ctx.objectClass}/${ctx.form}/${ctx.answerType}`;
    stats.unposed[k] = (stats.unposed[k] ?? 0) + 1;
    continue;
  }
  stats.posed += 1;
  stats.byVerb[posed.verb] = (stats.byVerb[posed.verb] ?? 0) + 1;

  const { act, verb } = posed;
  let ok = false;
  try {
    if (verb === "span") ok = playSpan(act, item);
    else if (verb === "balance" || verb === "tilt") ok = playSill(act);
    else if (verb === "combine") ok = playCombine(act);
    else if (verb === "distribute") ok = playDistribute(act);
  } catch (err) {
    stats.errors.push(`${item.id} (${verb}) play: ${String(err.message || err)}`);
    continue;
  }
  idle(act, 0.2);
  let response = null;
  try {
    response = act.response();
  } catch (err) {
    stats.errors.push(`${item.id} (${verb}) response: ${String(err.message || err)}`);
    continue;
  }
  const marked = response ? itemBank.check(item, response) : { correct: false, reason: "no-response" };
  const bucket = marked.correct ? stats.closed : stats.wrong;
  bucket[verb] = (bucket[verb] ?? 0) + 1;
  if (!marked.correct && samples.filter((s) => s.verb === verb && !s.correct).length < 3)
    samples.push({ verb, id: item.id, stem: item.stem, want: item.answer?.canonical, got: response, reason: marked.reason, ok });

  // ---- the misconception run, on a fresh act
  const again = pose(ctx);
  if (!again?.act) continue;
  const b = again.act;
  let did = false;
  let which = null;
  if (verb === "distribute") (did = missDistribute(b)), (which = "distribute");
  else if (verb === "balance") (did = missOneSided(b)), (which = "balance");
  else if (verb === "tilt") (did = missUnturnedMark(b)), (which = "tilt");
  if (!did || !which) continue;
  misses[which].n += 1;
  const r2 = b.response();
  const m2 = r2 ? itemBank.check(item, r2) : { correct: false };
  const read = b.read(m2);
  if (m2.correct === false && read?.key) {
    misses[which].tagged += 1;
    misses[which].keys[read.key] = (misses[which].keys[read.key] ?? 0) + 1;
  }
}

// ------------------------------------------------------------------ the no-answer-key check

const verbDir = path.join(ROOT, "app", "src", "learn", "verbs");
const leaks = [];
for (const f of fs.readdirSync(verbDir)) {
  const src = fs.readFileSync(path.join(verbDir, f), "utf8");
  // Strip block comments: the headers discuss the rule they enforce.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // `.answer` but never `.answerType`: the shape of the response is the open reading, the value is
  // the key. Likewise `distractors`, the item's own `check` closure, and the acceptance set.
  for (const [label, re] of [
    [".answer", /\.answer\b(?!Type)/],
    ["distractors", /\bdistractors\b/],
    ["item.check", /\bitem\.check\b/],
    ["accepts(", /\baccepts\s*\(/],
  ])
    if (re.test(code)) leaks.push(`${f}: ${label}`);
}

console.log(JSON.stringify({ stats, misses, samples: samples.slice(0, 18), leaks }, null, 1));

const closed = Object.values(stats.closed).reduce((a, b) => a + b, 0);
const wrong = Object.values(stats.wrong).reduce((a, b) => a + b, 0);
console.log(
  `\nposed ${stats.posed}/${stats.total} · a competent pair of hands closed ${closed}, missed ${wrong}` +
    ` · verbs ${JSON.stringify(stats.byVerb)}`
);
console.log(
  `misconception runs: ` +
    Object.entries(misses)
      .map(([k, v]) => `${k} ${v.tagged}/${v.n} ${JSON.stringify(v.keys)}`)
      .join(" · ")
);
console.log(leaks.length ? `ANSWER-KEY LEAK: ${leaks.join(", ")}` : "no verb file reads an answer, a distractor or a check");
if (stats.errors.length) console.log(`errors (${stats.errors.length}):\n  ${stats.errors.slice(0, 10).join("\n  ")}`);
