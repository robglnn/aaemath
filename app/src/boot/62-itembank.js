import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { itemBank, bankIssues } from "../learn/ItemBank.js";

/**
 * P17 — item bank. The loading half of this file is P31's.
 *
 * Order 62 is the learning slot in boot/README.md. The bank is a service, not a system: it owns
 * no frame, draws nothing and mounts no hook. It exists at boot so that (a) a reviewer can read
 * `probe --name=itembank` out of the running game rather than out of a builder's summary, and
 * (b) the mastery engine finds it already loaded and locale-correct on its first draw.
 *
 * ----------------------------------------------------------------------------------------------
 * P31 — WHERE THE PER-LESSON LOADER IS CALLED FROM. Four things happen below, in this order.
 * ----------------------------------------------------------------------------------------------
 *
 * 1. ONE LOCALE OF ITEM TEXT, AWAITED. The item locale table is now one chunk per language
 *    (`content/items/strings/items-<locale>.mjs`) instead of all three shipped to everyone. It is
 *    awaited here for the same reason `boot/05-i18n.js` awaits its UI bundle: `ItemBank.text()`
 *    and `present()` are synchronous and are called from the frame that draws an item, so the
 *    table has to be resident before anything can ask for a string. Two other boot modules mount
 *    at this order and neither draws an item, so this await costs the player nothing.
 *
 * 2. THE FAILURE CHANNEL GETS A SUBSCRIBER. `bankIssues.onIssue` was `null` in the shipped app, so
 *    a group that never arrived was honest only to a probe that a reviewer had to know to open.
 *    Now every issue is a `warn()` — which lands in `__vs.report().warnings` and in the console —
 *    and a `learn:session` signal with `phase: "bank"`, which is the declared vocabulary in
 *    design/architecture.md §Learning and is what a HUD (P21) will read to say it out loud.
 *
 * 3. THE FRONTIER LESSON IS WARMED, OFF THE CRITICAL PATH. `learning.frontier()[0]` is the
 *    knowledge point the engine says this learner is actually working on; the lesson containing it
 *    is what a 15-25 minute session will spend itself on. Warming it inside `requestIdleCallback`
 *    costs zero first-load bytes — the request goes out after boot has returned — and turns
 *    `prefetchAround` from documentation into behaviour, because `ensure()` chains it. Measured
 *    live: `ensureLesson('expressions-1')` pulls 3 chunks in about 12 ms.
 *
 *    It is fire-and-forget by construction. `setup()` does NOT await it: a learner must be able to
 *    move, look and reach the first item whether or not the catalogue arrived, and `select()`
 *    already degrades to a real generated item when it has not.
 *
 * 4. ROUND 4 — AND IT KEEPS WARMING, BECAUSE THE LEARNER MOVES. This is the round-3 gap, and it
 *    was the whole product goal: *"a student who already knows something TESTS OUT in ~2 minutes"*.
 *    Round 3 called `warm()` once inside `setup()` and never again, so the very learner the
 *    adaptive engine is built for — the one who clears `expressions-1` in two minutes — walked
 *    straight into a lesson nothing had warmed and met the generator instead of the catalogue on
 *    every first item of it.
 *
 *    So the warm now follows the frontier, by TWO independent routes, because one of them depends
 *    on another piece:
 *
 *      a. SIGNALS, for latency. `learn:mastery` fires on every scored item, unlock and lapse
 *         (`learn/Mastery.js`), and `learn:session` on every beat and sitting boundary
 *         (`flow/Session.js`). Both are declared vocabulary in design/architecture.md. On each one
 *         the lesson containing `frontier()[0]` is compared with the lesson last warmed; a change
 *         is one `warmFrontierWhenIdle` call and one lesson of chunks. In play the boundary is
 *         warm before the learner reaches it.
 *
 *      b. A BOUNDED IDLE RE-CHECK, for independence. A delivery mechanism must not depend on
 *         somebody else's emit — that is the failure this piece has now been rejected for twice.
 *         `learning.drive()` moves the frontier through a path that emits nothing the boot module
 *         can hear, and a future presenter could too. So the same comparison also runs on an idle
 *         timer, at most once every `RECHECK_MS`. Its whole cost is `frontier()` — one pass over
 *         thirty-two nodes — and a Map lookup; it starts no request unless the lesson actually
 *         changed.
 *
 *    What every warm did is in `probe().warm` and `probe().warmLog`, with the `trigger` that asked
 *    for it, so "the loader follows the learner" is a measurement from outside the page rather than
 *    a claim inside it.
 */

/**
 * The idle re-check period. Long enough that it is invisible next to a 20-40 second item, short
 * enough that a learner who tests out of a lesson in two minutes never reads a whole item on the
 * next lesson before its chunks are asked for.
 */
const RECHECK_MS = 5000;

export default {
  id: "itembank",
  order: 62,
  async setup(kernel) {
    const initial = document.documentElement.lang || "en";
    await itemBank.loadLocale(initial);

    signals.on("ui:locale", (payload) => {
      if (payload?.locale) itemBank.setLocale(payload.locale);
    });

    // A degraded bank is a fact about the learner's session, not a debug detail. Say it in the
    // three places something can hear it: the warning channel `verify` reads, the signal bus a
    // HUD reads, and the probe a reviewer reads.
    bankIssues.onIssue = (issue) => {
      const where = issue.kpId ?? issue.locale ?? "bank";
      warn(`itembank: ${issue.kind} on "${where}" — ${issue.error ?? "no error given"}`);
      signals.emit("learn:session", { phase: "bank", summary: issue });
    };

    publish("itembank", () => itemBank.probe());

    /**
     * The per-lesson loader's caller. Deferred, not awaited, and defensive about the learning
     * system: `62-learning.js` mounts at the same order, so on a page where it failed to boot the
     * registry lookup returns undefined and the warm records `no-learning-system` rather than
     * throwing inside an idle callback where nothing would ever see it.
     */
    const getLearning = () => kernel.get?.("learning") ?? null;

    /** The lesson the last warm actually opened. `null` means "warm again at the first chance". */
    let lastWarmedLesson = null;
    let warming = null;
    let inFlight = false;

    const warm = (trigger) => {
      inFlight = true;
      warming = itemBank.warmFrontierWhenIdle(getLearning, { trigger }).then((record) => {
        inFlight = false;
        /**
         * A lesson that was reached counts as warmed even when one of its chunks did not arrive.
         * Retrying it from HERE would be a retry storm: `learn:mastery` fires once per item, and
         * `ensureLesson` does not honour the bank's 30 s give-up window — it would re-run three
         * network attempts per answered question, forever. The bank already owns that recovery:
         * `touch()` retries a failed group after `RETRY_AFTER_MS` on the next `select()` for it,
         * which is the path `review/measure/P31.mjs` C3 measures.
         */
        lastWarmedLesson = record.lesson ?? null;
        return record;
      });
      return warming;
    };
    warm("boot");

    /**
     * The comparison, in one place, used by both routes. It reads the engine and the manifest and
     * starts nothing unless the answer changed, so it is safe to call on a signal that fires once
     * per item.
     */
    /** The lesson whose successor has already been queued, so the lookahead runs once per lesson. */
    let lookedAheadFrom = null;
    const followFrontier = (trigger) => {
      if (inFlight) return null;
      const learning = getLearning();
      let head = null;
      try {
        head = learning?.frontier?.()?.[0] ?? null;
      } catch {
        return null; // an engine mid-rebuild is not this module's failure to report
      }
      if (!head) return null;
      const lesson = itemBank.lessonFor(head)?.id ?? null;
      if (!lesson) return null;
      if (lesson !== lastWarmedLesson) return warm(trigger);

      /**
       * Same lesson, so nothing to warm — but this is where the 50% lookahead has to be evaluated.
       * At the moment a warm happens the learner has just ENTERED the lesson and is 0% through it,
       * so a lookahead computed only inside `warmFrontier` could never fire. Here it is checked as
       * the learner advances, and `prefetchLesson` filters everything already resident, so the cost
       * of the check is `frontier()` plus a Map lookup and the cost of the hit is one lesson.
       */
      if (lookedAheadFrom !== lesson) {
        const ahead = itemBank.lookaheadFrom(lesson, learning);
        if (ahead.nextLesson) lookedAheadFrom = lesson;
      }
      return null;
    };

    /**
     * Route (a): the engine's own vocabulary. `phase: "bank"` and `phase: "defect"` are skipped
     * because the first is emitted by the handler above — re-entering on our own announcement
     * would be a loop — and neither says anything about where the learner is.
     */
    signals.on("learn:mastery", () => followFrontier("mastery-signal"));
    signals.on("learn:session", (payload) => {
      const phase = payload?.phase;
      if (phase === "bank" || phase === "defect") return;
      followFrontier("session-signal");
    });

    // Route (b): the backstop. One `frontier()` pass every RECHECK_MS, in idle time.
    let recheck = null;
    const scheduleRecheck = () => {
      recheck = setTimeout(() => {
        const run = () => {
          followFrontier("idle-recheck");
          scheduleRecheck();
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1000 });
        else run();
      }, RECHECK_MS);
    };
    scheduleRecheck();

    kernel.mount("itembank", {
      /** For the review harness: re-run the warm and wait for it. Gameplay never calls this. */
      warm,
      warmed: () => warming,
      /** What the shipped module thinks it has warmed. Read by review/measure/_p31-live.mjs. */
      warmState: () => ({ lastWarmedLesson, lookedAheadFrom, inFlight, recheckMs: RECHECK_MS }),

      /**
       * REVIEW HARNESS ONLY — the cold-select degradation window, measured in the page.
       *
       * `review/measure/P31.mjs` can only measure this in Node, where every group is resident
       * before the first statement runs, so a "cold" `loadGroup` there costs one already-resolved
       * microtask and the answer is an artefact. Here the chunk is a real dynamic import over a
       * real connection, so this reports how many items a learner would actually be served from
       * the generator before the catalogue arrives, at a stated gap between items.
       *
       * Gameplay never calls this: it draws items through `Scheduler.serve()`.
       */
      async coldSelectWindow(kpId, { tries = 12, gapMs = 0 } = {}) {
        const t0 = performance.now();
        const rows = [];
        for (let i = 0; i < tries; i += 1) {
          const sel = itemBank.select({ kpId, form: "construct", difficulty: 3, seed: 100 + i });
          rows.push({
            i,
            atMs: Math.round((performance.now() - t0) * 10) / 10,
            source: sel?.source ?? null,
            relaxation: sel?.relaxation ?? null,
            checkable: sel ? itemBank.check(sel.item, itemBank.accepts(sel.item)[0]).correct === true : false,
          });
          if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
          else await new Promise((r) => requestAnimationFrame(() => r()));
        }
        const degraded = rows.filter((r) => String(r.relaxation).startsWith("generated-group-"));
        return {
          kpId,
          gapMs,
          tries,
          degraded: degraded.length,
          blanks: rows.filter((r) => r.source === null).length,
          uncheckable: rows.filter((r) => !r.checkable).length,
          msToCatalogue: rows.find((r) => r.source === "catalogue")?.atMs ?? null,
          rows,
        };
      },

      dispose() {
        bankIssues.onIssue = null;
        if (recheck) clearTimeout(recheck);
      },
    });
  },
};
