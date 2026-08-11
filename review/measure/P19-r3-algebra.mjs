// P19 round 3 — the algebra layer, offline, over the real bank.
//
// Two questions this answers that a browser run cannot: which verb every committed item routes to,
// and whether the hands can actually close the shapes a new player is served.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import { parseChain, parseSystem, claimTex, chainTex, R } from "../../app/src/learn/verbs/Claim.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = [];
for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);

const openReading = (it) => ({
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
    let act = null;
    try {
      act = v.pose(ctx);
    } catch (e) {
      return { id: `${v.id}:threw`, err: String(e?.message || e) };
    }
    if (act) return { id: v.id, act };
  }
  return { id: null };
};

console.log("=== parser spot checks ===");
for (const t of ["8 + 5 \\cdot 4", "12 \\div 6 \\cdot 5", "9 - 2 + 3", "3x + 2x + 6", "7 - 9x", "7x + 7", "x + 5 = 12", "g", "3x^{2}"]) {
  const ch = parseChain(t);
  console.log(
    `${JSON.stringify(t).padEnd(22)} chain=${ch ? `${ch.parts.map((p) => R.canon(p.c) + (p.v ? `*${p.v}` : "")).join(",")} ops=${ch.ops.join("")}` : "null"}`
  );
}
const sys = parseSystem("x + y = 14,\\quad x - y = 0");
console.log(`system  -> ${sys ? sys.map(claimTex).join("  ||  ") : "null"}`);

console.log("\n=== routing over the whole committed bank ===");
const byVerb = new Map();
const byCell = new Map();
for (const it of all) {
  const { id } = poseOf(openReading(it));
  byVerb.set(id, (byVerb.get(id) ?? 0) + 1);
  const cell = `${it.kpId}|${it.form}|${it.answerType}`;
  if (!byCell.has(cell)) byCell.set(cell, new Map());
  const m = byCell.get(cell);
  m.set(id, (m.get(id) ?? 0) + 1);
}
for (const [k, n] of [...byVerb.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k)}  ${n}`);

console.log("\n=== the two knowledge points a level-1 player is actually served ===");
for (const [cell, m] of [...byCell.entries()].sort()) {
  if (!/^var-meaning|^oo-numeric/.test(cell)) continue;
  console.log(`  ${cell.padEnd(42)} ${[...m.entries()].map(([k, n]) => `${k}:${n}`).join(" ")}`);
}

console.log("\n=== can the hands close it? (drive each level-1 shape to a response) ===");
const drive = (it, plan) => {
  const { id, act } = poseOf(openReading(it));
  if (!act) return { verb: id, response: null, note: "not posed" };
  for (const step of plan) {
    if (typeof step === "number") {
      for (let i = 0; i < step; i += 1) act.act("stepNext", { held: new Set() });
    } else act.act(step, { held: new Set() });
  }
  let r = null;
  try {
    r = act.response();
  } catch (e) {
    r = `threw: ${e?.message || e}`;
  }
  return { verb: id, response: r };
};

const first = (p) => all.find(p);

const { itemBank } = await import("../../app/src/learn/ItemBank.js");
await itemBank.setLocale?.("en");
const itemsText = (key) => {
  if (!key) return null;
  try {
    return itemBank.text(key, {});
  } catch {
    return null;
  }
};

// oo-numeric: close the tight join first, then the loose one.
const oo = first((i) => i.kpId === "oo-numeric" && i.family === "oo-numeric.addmul" && i.form === "construct");
console.log(`  ${oo.stem}  ans=${oo.answer.canonical}`);
console.log(`     right order (join 2 then join 1):`, drive(oo, [1, "take", "take"]));
console.log(`     left to right (join 1 then join 2):`, drive(oo, ["take", "take"]));

const dm = first((i) => i.family === "oo-numeric.divmul" && i.form === "construct");
console.log(`  ${dm.stem}  ans=${dm.answer.canonical}`);
console.log(`     as they stand:`, drive(dm, ["take", "take"]));
console.log(`     mult first:   `, drive(dm, [1, "take", "take"]));

// var-meaning.twin: carry, seat, gather, share.
const tw = first((i) => i.family === "var-meaning.twin" && i.form === "construct");
console.log(`  ${tw.stem}  ans=${tw.answer.canonical}`);
{
  const { id, act } = poseOf(openReading(tw));
  const log = [];
  const step = (name, times = 1) => {
    for (let i = 0; i < times; i += 1) act.act(name, { held: new Set() });
    log.push(`${name}${times > 1 ? `x${times}` : ""} -> ${act.state().claims.join(" || ")}`);
  };
  const dialTo = (n) => {
    while (act.dial !== n) act.fixed(1 / 60, { move: { x: 0, y: Math.sign(n - act.dial) }, held: new Set() });
    log.push(`dial ${act.dial}`);
  };
  const walkTo = (want) => {
    for (let i = 0; i < 24 && act.state().holding !== want; i += 1) act.act("stepNext", { held: new Set() });
    log.push(`walk to ${act.state().holding}`);
  };
  // The grip row runs [x, y, sill, 14] then [x, -y, sill, 0]: two Sills, side by side.
  walkTo("1:near:1"); // the `-y` standing on the second claim's near pan
  step("take"); //   carry it over that Sill: x = y
  walkTo("sill:0"); //  stand at the first claim's Sill
  step("hold"); //   SEAT the second core where the first one sits: y + y = 14
  walkTo("0:near:0");
  step("take"); //   gather the pan: 2y = 14
  walkTo("sill:0");
  dialTo(2);
  step("take"); //   share both pans by 2: y = 7
  walkTo("sill:1");
  step("hold"); //   seat it back: x = 7
  console.log(`     verb=${id}`);
  for (const l of log) console.log(`       ${l}`);
  console.log(`     response=${JSON.stringify(act.response())}`);
}

/**
 * Round-2 action 4: "verify it by carrying a term over the Sill without letting it turn and quoting
 * what the world says." Round 2 could not: `carry()` always turned, so `moved-without-inverting` —
 * 124 committed items, tagged `fail.sill.sign` — was a misconception no pair of hands could commit.
 * The second grip, away from a Sill, now shoves a term over flat.
 */
console.log("\n=== carrying a term over the Sill WITHOUT letting it turn ===");
const both = first((i) => i.kpId === "eq-both-sides" && i.form === "construct" && i.answerType === "rational");
{
  const { id, act } = poseOf(openReading(both));
  const weight = { held: new Set(["crouch"]) };
  const empty = { held: new Set() };
  const walkTo = (want, hand) => {
    for (let i = 0; i < 24 && act.state().holding !== want; i += 1) act.act("stepNext", hand);
  };
  console.log(`  ${both.stem}   verb=${id}   ans=${both.answer.canonical}`);
  walkTo("0:far:0", empty);
  act.act("take", weight); // shove the far pan's `4x` across without lifting it
  console.log(`     shoved:  ${act.state().claims.join("")}   flatCarries=${act.state().flatCarries}`);
  console.log(`     the world's read: ${JSON.stringify(act.read(null))}`);
  const line = itemsText(act.read(null)?.key);
  console.log(`     which says: ${JSON.stringify(line)}`);
}

console.log("\n=== does the SHIPPED checker tag what the hands can build? ===");
const mark = (it, response) => {
  const m = itemBank.check(it, response);
  let line = "";
  try {
    line = m.failKey ? itemBank.text(m.failKey, {}) : "";
  } catch {
    line = "";
  }
  console.log(
    `  ${String(it.stem).padEnd(28)} ${JSON.stringify(response).padEnd(18)} correct=${String(m.correct).padEnd(5)} misconception=${String(m.misconception).padEnd(26)} failKey=${String(m.failKey).padEnd(22)} ${JSON.stringify(line)}`
  );
  return m;
};
mark(oo, "28");
mark(oo, "52");
mark(dm, "10");
mark(dm, "2/5");
mark(tw, "x = 7, y = 7");
mark(tw, "x = 3, y = 11");

