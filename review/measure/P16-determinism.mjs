/**
 * P16 — requirement 12, checked in the real browser.
 *
 *   node review/measure/P16-determinism.mjs
 *
 * "Given a seed and a response sequence, every value in the `mastery` probe must reproduce
 * exactly." So this boots the actual game twice, in two independent browser sessions, runs the
 * identical seeded self-drive through the shipped engine in each, and byte-compares the probe.
 *
 * It does NOT take a screenshot. The determinism of the learner model has nothing to do with
 * pixels, and in this environment the headless GL screenshot path is flaky enough that folding it
 * in would turn a clean measurement into a coin flip.
 */
import { createHash } from "node:crypto";
import { openGame } from "../../tools/lib/session.mjs";

const RUNS = 2;
const ITEMS = Number(process.argv.find((a) => a.startsWith("--items="))?.split("=")[1] ?? 400);
const SEED = Number(process.argv.find((a) => a.startsWith("--seed="))?.split("=")[1] ?? 7);

const results = [];
for (let i = 0; i < RUNS; i++) {
  // eslint-disable-next-line no-await-in-loop
  await openGame({ width: 800, height: 450 }, async (d) => {
    await d.play(0.6);
    const probe = await d.page.evaluate(
      ({ items, seed }) => {
        const learning = window.__vs.kernel.get("learning");
        if (!learning) return { error: "learning system not mounted" };
        const drive = learning.drive(items, seed);
        return { drive, probe: window.__vs.probe("mastery") };
      },
      { items: ITEMS, seed: SEED }
    );
    results.push(probe);
  });
}

const text = results.map((r) => JSON.stringify(r, null, 1));
const hash = text.map((t) => createHash("sha256").update(t).digest("hex").slice(0, 24));
const identical = text.every((t) => t === text[0]);

const first = results[0];
console.log("P16 determinism — the shipped engine, in the real browser, twice");
console.log("=".repeat(84));
if (first.error) {
  console.log(`FAIL  ${first.error}`);
  process.exit(1);
}
console.log(`drive: ${ITEMS} items, seed ${SEED} -> ${first.drive.items} served across ${first.drive.sessions} sessions`);
console.log(
  `state after: theta ${first.probe.theta}, unlocked ${first.probe.unlocked}, provisional ${first.probe.provisional}, ` +
    `mastered ${first.probe.mastered} (${first.probe.level1Percent}% of Level 1), dueNow ${first.probe.dueNow}`
);
console.log(`engine gate: scorable ${first.probe.scorablePairs.scorable}; mastery-eligible ${first.probe.scorablePairs.masteryEligible}`);
console.log(`stats: ${JSON.stringify(first.probe.stats)}`);
console.log(`content issues reported by the engine: ${first.probe.issues.length ? JSON.stringify(first.probe.issues) : "none"}`);
console.log("");
hash.forEach((h, i) => console.log(`  run ${i + 1}: ${text[i].length} bytes  sha256 ${h}`));
console.log("");
console.log(`RESULT: ${identical ? "PASS" : "FAIL"} — the mastery probe is ${identical ? "byte-identical" : "NOT identical"} across runs`);
process.exitCode = identical ? 0 : 1;
