import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { itemBank } from "../learn/ItemBank.js";
import { VerbRuntime, HAND, VERBS } from "../learn/verbs/Verbs.js";
import { validate, getLocale } from "../math/Tex.js";

/**
 * P19 — the in-world learning verbs, mounted. Slot 64, claimed in `boot/README.md` since the order
 * table was written.
 *
 * ==================================================================================================
 * WHY 64 AND NOT 93
 *
 * The presenter is at 92 and this runs at 64, so `kernel.get("teaching")` is null when `setup()`
 * runs. That is on purpose and it is not a workaround: the verbs are a PLAY system — they read the
 * stick, they run in `fixed()`, they stand objects in the world — and a play system that mounted
 * after the flow layer would be the only one in the game that did. The presenter is resolved lazily,
 * once, on the first claim that reaches the verbs, which is strictly later than boot in every
 * possible ordering because nothing presents before the player takes a claim on.
 *
 * ==================================================================================================
 * FIVE THINGS ARE WIRED HERE AND NOWHERE ELSE, BECAUSE EACH CROSSES A BOUNDARY
 *
 *   1. THE BANK IS INJECTED. `learn/ItemBank.js` is P17/P31's; nothing under `learn/verbs/` imports
 *      it. Same reason and same shape as `boot/92-teaching.js` and `boot/63-learnserve.js`. The verb
 *      layer uses exactly two of its methods — `check`, to learn which misconception a fallen claim
 *      matched, and `text`, to say the world's read in the player's own language — and it never
 *      touches `item.answer`. `review/measure/P19.mjs` greps the whole folder for that and fails the
 *      run if it ever appears.
 *   2. THE PRESENTER IS INJECTED, AS A GETTER. `learn/Teaching.js` is P18/P34's. The verbs commit
 *      through it (`type` then `commit`) so the response goes down the path `Mastery` already
 *      audits, family and all — see `learn/verbs/Verbs.js`'s header for why the verbs do not emit
 *      `learn:respond` themselves.
 *   3. THE CAMERA BASIS IS SAMPLED HERE. The boot module is where `kernel` is in scope. The
 *      arithmetic is deliberately identical to `boot/92-teaching.js`'s `place()` so the hands and
 *      the claim share one frame of reference, and the SAMPLE is handed over rather than the camera:
 *      the runtime takes one basis per claim and never asks again, so its rows stand still in the
 *      world while the player walks around them.
 *   4. THE STRICT PIPELINE GATES THE READ. `math/Tex.js` is a sibling piece. The one prose row these
 *      verbs stand — the misconception line — is typeset here first, in the LIVE locale, and a
 *      sentence KaTeX will not set is refused whole rather than standing as a hollow mark beside a
 *      claim that just fell.
 *   5. NO NEW SIGNAL NAMES. The verbs listen to `learn:present`, `input:move`, `input:action`,
 *      `learn:respond` and `learn:mastery`, and emit `math:show` and `math:hide`. Every one of those
 *      already has both ends, so `node tools/seams.mjs --signals` reports the same orphan counts
 *      after this piece as before it. That is a requirement of the brief and it is checked.
 */
export default {
  id: "verbs",
  order: 64,

  async setup(kernel) {
    /**
     * The camera frame, flattened onto the ground plane. Columns 0/1/2 of a camera's world matrix
     * are its right, up and BACKWARD axes, so forward is the negation of column 2 and the
     * translation is column 3. No `three` import: a basis is three vectors.
     */
    const basis = () => {
      const cam = kernel.camera;
      if (!cam?.matrixWorld) return null;
      cam.updateMatrixWorld();
      const m = cam.matrixWorld.elements;
      let fx = -m[8];
      let fz = -m[10];
      const len = Math.hypot(fx, fz);
      if (len < 1e-6) {
        fx = 0;
        fz = -1;
      } else {
        fx /= len;
        fz /= len;
      }
      // right = forward x worldUp, for a forward flattened onto the ground plane.
      return { o: [m[12], m[13], m[14]], f: [fx, fz], r: [-fz, fx] };
    };

    let teaching = null;
    const getTeaching = () => {
      if (!teaching) teaching = kernel.get("teaching") ?? null;
      return teaching;
    };

    const runtime = new VerbRuntime({
      emit: (name, value) => signals.emit(name, value),
      on: (name, fn) => signals.on(name, fn),
      basis,
      teaching: getTeaching,
      bank: itemBank,
      validateTex: (tex) => validate(tex, { locale: getLocale(), displayMode: true }).ok,
    }).attach();

    kernel.mount("verbs", runtime);

    publish("verbs", () => {
      const p = runtime.probe();
      return {
        ...p,
        /**
         * The presenter this runtime commits through, read back rather than assumed. A null here
         * with `posed > 0` is the whole of `RESUME.md` §6b in one field: verbs performing beautifully
         * into nothing. `review/measure/P19.mjs` fails the run on it.
         */
        presenter: getTeaching() ? { open: getTeaching().open === true, phase: getTeaching().phase } : null,
        hand: { ...p.hand, column: { right: HAND.right, forward: HAND.forward, em: HAND.em } },
        registry: VERBS.map((v) => v.id),
      };
    });

    if (!kernel.get("learning")) warn("verbs: no learning system is mounted — nothing will ever be posed");
  },
};
