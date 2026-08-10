import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { itemBank } from "../learn/ItemBank.js";

/**
 * P32 — put the sanctioned picker on the shipped path.
 *
 * ==============================================================================================
 * WHY THIS FILE EXISTS, IN ONE PARAGRAPH
 *
 * `Scheduler.serve()` is the only code in the project that honours `price.avoidFamilies` and
 * records which generator family it handed out. 24 of the bank's 96 (knowledge point x form) cells
 * contain at least one family the audit refuses — `expr-anatomy.coefficient` answers the same
 * string every time and measures 1.000 blind — and on those cells the engine will not score a
 * response whose family it was never told, because an unreported family cannot be told apart from
 * a refused one. Round 2 shipped that rule with NO CALLER: `boot/62-learning.js` went
 * `next()` -> `submit()` with no picker in between and no `outcome.family`, so every response on
 * those 24 cells was silently unscored. Measured: 8 sessions of perfect answers served
 * `var-meaning|construct` 228 times, all 228 unscored, M2 false forever, curriculum deadlocked on
 * the first knowledge point of Level 1.
 *
 * One line closes it. `Scheduler.attachBank(bank)` makes the Scheduler draw every item through
 * `serve()` itself inside `next()`, publish it as `req.item` / `req.family`, and declare to
 * `Mastery` that the family is reported — which is what lets the engine price those 24 cells and
 * what makes `expr-anatomy`, `eval-signed` and `props-operations` certifiable at all.
 *
 * It is a separate boot file, not an edit to `62-learning.js`, because that file belongs to P16
 * and this wiring belongs to P32. Order 63 is after both order-62 modules, so the engine and the
 * bank both exist. See `boot/README.md`.
 *
 * WHY THE BANK IS INJECTED AND NOT IMPORTED BY THE SCHEDULER. `app/src/learn/ItemBank.js` belongs
 * to P17/P31; a feature module never imports a sibling. A boot module is the assembly point where
 * two pieces are allowed to meet, which is the whole reason this directory exists.
 * ==============================================================================================
 */
export default {
  id: "learnserve",
  order: 63,

  async setup(kernel) {
    const learning = kernel.get("learning") ?? null;
    if (!learning?.scheduler) {
      // 62-learning failed to boot. Say so and stop — a missing engine is that module's failure to
      // report, and throwing here would turn one broken feature into two.
      warn("learnserve: no learning system is mounted, so Scheduler.serve() is not on the path");
      publish("learnserve", () => ({ attached: false, reason: "no-learning-system" }));
      return;
    }

    const { scheduler, mastery } = learning;

    /**
     * The delivery defect channel, subscribed rather than merely counted.
     *
     * `Mastery` refuses a response whose family went unreported on a filtered cell and, from round
     * 3, announces it. The shipped path cannot produce one now — every item is drawn through
     * `serve()` — so a line here means something bypassed the Scheduler, which is exactly the class
     * of bug that hid for a whole round. It lands in `__vs.report().warnings`, which
     * `tools/review.mjs verify` treats as a gate.
     */
    mastery.onDeliveryDefect = (detail, message) => {
      warn(`learnserve: ${message}`);
      signals.emit("learn:session", { phase: "defect", summary: detail });
    };

    // THE LINE. Everything above is commentary on it.
    const attached = scheduler.attachBank(itemBank) != null;
    if (!attached) warn("learnserve: the item bank was rejected by the Scheduler — no select() on it");

    for (const issue of mastery.issues.slice(mastery._staticIssues ?? 0)) warn(`learning: ${issue}`);

    publish("learnserve", () => ({
      attached,
      /** What the declaration bought, as a number a reviewer can read without answering an item. */
      familyReporting: mastery.familyReporting,
      familyReportingSource: mastery.familyReportingSource,
      uncertifiable: mastery.graph.ids.filter((id) => mastery.deliverableMasteryForms(id).length === 0),
      testOutEligible: mastery.graph.ids.filter((id) => mastery.testOutPlan(id).eligible).length,
      unreportedFamilyItems: mastery.stats.unreportedFamilyItems,
      serveMisses: scheduler.serveMisses,
    }));

    kernel.mount("learnserve", {
      /**
       * Draw one item for a request that was produced somewhere other than `next()`. The shipped
       * loop does not need it — `next()` already serves — but a presenter that re-rolls an item
       * (a locale switch, an accessibility swap) must go through the same filter, and this is the
       * only sanctioned way to do that.
       */
      draw: (req) => scheduler.serve(req, itemBank),
      dispose() {
        mastery.onDeliveryDefect = null;
      },
    });
  },
};
