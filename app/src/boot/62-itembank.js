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
 * It listens to `ui:locale` only. That is an existing signal in design/architecture.md and it is
 * the one fact about the world the bank needs: which of the three locales the item text should
 * come back in.
 *
 * ----------------------------------------------------------------------------------------------
 * P31 — WHERE THE PER-LESSON LOADER IS CALLED FROM. Three things happen below, in this order.
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
 * 3. THE FRONTIER LESSON IS WARMED, OFF THE CRITICAL PATH. This is the caller round 2 did not
 *    have. `learning.frontier()[0]` is the knowledge point the engine says this learner is
 *    actually working on; the lesson containing it is what a 15-25 minute session will spend
 *    itself on. Warming it inside `requestIdleCallback` costs zero first-load bytes — the request
 *    goes out after boot has returned — and turns `prefetchAround` from documentation into
 *    behaviour, because `ensure()` chains it. Measured live: `ensureLesson('expressions-1')`
 *    pulls 3 chunks in about 12 ms.
 *
 *    It is fire-and-forget by construction. `setup()` does NOT await it: a learner must be able to
 *    move, look and reach the first item whether or not the catalogue arrived, and `select()`
 *    already degrades to a real generated item when it has not. What the warm did is reported in
 *    `probe().warm`, so "the shipped game calls the loader" is measurable from outside the page.
 */
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
    let warming = null;
    const warm = () => {
      warming = itemBank.warmFrontierWhenIdle(() => kernel.get?.("learning") ?? null);
      return warming;
    };
    warm();

    kernel.mount("itembank", {
      /** For the review harness: re-run the warm and wait for it. Gameplay never calls this. */
      warm,
      warmed: () => warming,
      dispose() {
        bankIssues.onIssue = null;
      },
    });
  },
};
