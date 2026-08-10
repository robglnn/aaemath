import graphSource from "../../../content/knowledge-graph.json";
import { BANK } from "../../../content/items/index.mjs";
import { generateOne, TIERS } from "../../../content/items/generators.mjs";
import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { Graph } from "../learn/Graph.js";
import { itemBank } from "../learn/ItemBank.js";
import { Mastery, auditBlindGuessing, collectBankSample } from "../learn/Mastery.js";
import { Scheduler, realClock, virtualClock, mulberry32 } from "../learn/Scheduler.js";

/**
 * P16 — the mastery engine.
 *
 * Mounts the learner model and the scheduler, restores whatever the last session left behind, and
 * publishes the `mastery` probe. It renders nothing: the mathematics of what a learner knows has
 * no pixels of its own, and every surface that draws it (P21 HUD, P24 progress, P19 verbs) reads
 * the signals in `design/architecture.md` §Learning.
 *
 * **How other features talk to it.** Outbound is signals only — `learn:teach`, `learn:respond`,
 * `learn:mastery`, `learn:unlock`, `learn:session`. Inbound is the kernel registry:
 *
 * ```js
 * const learning = kernel.get("learning");
 * const req = learning.next();          // what should happen next: kp, phase, form, difficulty
 * learning.submit(req, { correct, latencyMs, hinted, itemId, misconception });
 * ```
 *
 * That is a runtime lookup, not an import, so no feature module ever depends on `learn/*` at
 * build time and this whole system can be replaced without touching a neighbour.
 *
 * `req.hinted` is only the phase's default. Whoever presents the item must report what the world
 * ACTUALLY did — if a hint surfaced, say so on `submit`. That single flag is the thing standing
 * between a UI decision and the mastery gate, and it is enforced all the way through the
 * CERTIFICATION surfaces: a hinted or sub-latency-floor correct answer on a retention item buys
 * nothing toward M4's 3-of-4, however the phase was labelled. `submit` returns the engine's own
 * verdict as `{ scored, masteryEligible, credited, reason }`; `credited` is the only thing any
 * gate counts.
 *
 * One `persist()` writes the WHOLE engine — the learner model and the scheduler's open work — so a
 * half-answered retention check resumes on reload instead of vanishing without a lapse.
 */
export default {
  id: "learning",
  order: 62,

  async setup(kernel) {
    const graph = new Graph(graphSource); // throws loudly on a cyclic or unmappable graph

    /**
     * Price the bank we actually ship, not the bank the content file describes.
     *
     * `model.trueGuessByForm` says a `construct` item is flukeable at 0.03 because a numeric slot
     * accepts about forty values. `content/items` disagrees on eight knowledge points: the whole
     * `eq-special-cases` construct pool answers `always` or `none` (measured 0.53 blind) and every
     * one of its repair items answers `3|0 = 0` (measured 1.00). This audit is what lets the
     * engine see that, and it is deliberately computed here from the SAME content the item bank
     * is built from, rather than reaching into P17's module — the numbers are then identical to
     * the ones `review/measure/P16.mjs` proves against, because both call the same function on
     * the same data with the same fixed seeds.
     *
     * `mark` and `spell` are the SHIPPED checker. They are needed because `generate` items are
     * marked against a PROPERTY, not against a string: counting distinct canonical answers says
     * `expr-anatomy|generate` is flukeable at 0.011, and running the real checker says one
     * three-term expression satisfies 93% of that pool. This is the composition root, and wiring
     * two features together is the one thing a boot module is for — `Mastery.js` itself never
     * imports the item bank, it is handed two functions.
     *
     * Cost is roughly a second of pure arithmetic inside an async setup, once, and it is paid
     * before the first item can be priced on purpose: a table that arrives late is a table that
     * priced the first session wrong.
     */
    const bankAudit = auditBlindGuessing(
      collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => graph.difficulty(id) }),
      {
        mark: (item, response) => itemBank.check(item, response).correct === true,
        spell: (item) => itemBank.accepts(item)[0],
      }
    );

    const mastery = new Mastery(graph, { now: () => Date.now() / 60000, bankAudit });
    const scheduler = new Scheduler(mastery, { clock: realClock(), seed: 0x5eed, sessionMinutes: 25 });

    for (const issue of mastery.issues) warn(`learning: ${issue}`);

    const resumed = mastery.hydrate();
    scheduler.beginSession();

    const system = {
      mastery,
      scheduler,
      graph,
      resumed,
      next: () => system.scheduler.next(),
      submit: (req, outcome) => system.scheduler.submit(req, outcome),
      beginSession: () => system.scheduler.beginSession(),
      endSession: () => system.scheduler.endSession(),
      /**
       * Drop the open multi-item event. A retention check that has already been served items and
       * is then walked away from lapses the node — otherwise "leave when it is going badly and
       * come back for a fresh check" is a strategy. Consolidation and review just clear.
       */
      abandonEvent: (reason) => system.scheduler.abandonEvent(reason),
      price: (kpId, form, phase) => system.mastery.price(kpId, form, phase),
      frontier: () => system.mastery.frontier(),

      /**
       * Deterministic self-drive, for the review harness only — gameplay never calls it.
       *
       * §8 requirement 12 says the same seed and the same response sequence must reproduce every
       * value in the probe exactly, and that has to be checkable from OUTSIDE the page. This runs
       * a seeded synthetic learner through the real engine on a virtual clock (so eighteen days of
       * spacing take no wall-clock time) and swaps the result in, so:
       *
       *   node tools/review.mjs shot review/shots/p16/drive.png \
       *        --script="eval:window.__vs.kernel.get('learning').drive(400, 7)"
       *
       * prints a `probes.mastery` block that must be byte-identical between two runs.
       */
      drive(items = 400, seed = 7) {
        const clock = virtualClock(0);
        const m = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit });
        const s = new Scheduler(m, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
        const rng = mulberry32(seed);
        let served = 0;
        for (let session = 0; served < items && session < 60; session += 1) {
          clock.set(session * 1440);
          s.beginSession();
          for (;;) {
            if (served >= items) break;
            const req = s.next();
            if (!req) break;
            // A plain Rasch responder at a fixed true ability, floored by whatever the scaffold
            // gives away. Not a claim about learners — a fixed, reproducible response sequence.
            const base = 1 / (1 + Math.exp(-(0.9 - req.difficulty)));
            // Floored by what the WORLD gives away on this exact item: the scaffold the phase
            // surfaces, and the bank's own measured blind rate for this knowledge point and form.
            const floor = m.trueGuess(req.kpId, req.form, req.phase);
            s.submit(req, {
              correct: rng() < base + (1 - base) * floor,
              latencyMs: 4000,
              itemId: `${req.kpId}#${req.seq}`,
            });
            served += 1;
          }
          s.endSession();
        }
        system.mastery = m;
        system.scheduler = s;
        return { items: served, sessions: m.session };
      },

      dispose() {
        system.mastery.persist();
      },
    };

    kernel.mount("learning", system);

    // P17 may present an item without going through submit(); record the id either way so the
    // "no exact repeat within 40 items" rule holds however the bank is wired.
    signals.on("learn:present", (e) => {
      if (!e?.itemId) return;
      const ids = system.scheduler.recentItemIds;
      ids.push(e.itemId);
      const cap = system.mastery.M.antiGuessing.noRepeatWithinItems ?? 40;
      while (ids.length > cap) ids.shift();
    });

    // A browser game is closed, not exited. Persist on the way out so a session resumes.
    const flush = () => system.mastery.persist();
    addEventListener("pagehide", flush);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    publish("mastery", () => ({ ...system.mastery.probe(), resumed, scheduler: system.scheduler.probe() }));
  },
};
