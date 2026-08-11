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
 *   6. THE FEET AND THE FIELD ARE REACHED BY NAME. `play/Locomotion.js` and `math/TexPanel.js`'s
 *      `TexField` are two other pieces' files and nothing under `learn/verbs/` imports either. They
 *      are read here as `kernel.get("locomotion")` and `kernel.get("mathtex")`, which is the access
 *      `boot/20-input.js`'s header names as the sanctioned alternative to a signal — "consumers do
 *      not import this module; they either listen to the signals or read the mounted system by
 *      name". What crosses the boundary is two verbs and two facts, documented at each call site.
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

    /**
     * PLANT THE FEET WHILE THE HANDS ARE ON A CLAIM.
     *
     * The round-2 critic, holding W through a verb: "within about a second and a half every single
     * thing I have just described was off the screen... I kept holding W, the counter kept climbing,
     * and I was performing algebra into an empty orange sky." Their first demanded action offers two
     * fixes and this is the one that removes the failure rather than compensating for it — the left
     * stick means one thing at a time, and taking a claim on is a stance.
     *
     * `moveX` / `moveY` are `Locomotion`'s declared intent, the two fields its own `--- intent` block
     * names, written by `_onMove` from `input:move` and read by its solver on the next fixed step.
     * Zeroing them is the same statement `input:move {x:0, y:0}` makes and it is made in the one place
     * this project allows two pieces to know about each other. Nothing else about the body is touched:
     * you can still look, still jump, still be pushed by the world. You cannot walk away from a claim
     * you are holding, which is the point.
     *
     * `externalInput` is deliberately left alone — it is the flag that keeps `Locomotion`'s standalone
     * keyboard fallback out of the way, and clearing it would hand the body back to a code path that
     * exists for reviewing that piece alone.
     */
    let planted = false;
    const plant = (on) => {
      const body = kernel.get("locomotion");
      if (!body) return;
      if (on) {
        body.moveX = 0;
        body.moveY = 0;
      }
      planted = !!on;
    };

    /**
     * MOVE THE PRESENTER'S COLUMN WITH THE HANDS' ONE.
     *
     * The critic's first action asks for BOTH columns to stay in frame, and the question, the given
     * and the entry slot are `learn/Teaching.js`'s rows: this piece may not lay them out and does not
     * try to. It reads where they ACTUALLY are — `TexField` is the only thing that knows, because a
     * row placed from a view anchor gets its world position a quarter of a second after the payload —
     * expresses each one in the frame the player was standing in when it was stood, and stands it
     * again at the same place in the frame they are standing in now. The layout is untouched; the
     * whole column is carried, rigidly, exactly as the verb's own column is.
     *
     * `math:hide` before `math:show` because `TexField.add()` ignores `position` for an id it already
     * holds — the fact that made round 2's restand a no-op in both columns. See `learn/verbs/Verbs.js`.
     */
    const rebase = (from, to) => {
      const field = kernel.get("mathtex");
      if (!field?.panels || !from || !to) return 0;
      let moved = 0;
      /**
       * SNAPSHOT FIRST, AND THIS IS NOT DEFENSIVE STYLE — IT IS A HANG.
       *
       * `math:hide` deletes the id from `TexField.panels` and `math:show` inserts it again, which in
       * a `Map` puts it at the END of the insertion order. Iterating the live map therefore hands the
       * re-inserted id back to the same loop, which hides and shows it again, forever. Measured: the
       * first restand of the first evidence run never returned.
       */
      for (const [id, panel] of [...field.panels.entries()]) {
        if (!id.startsWith("teach-")) continue;
        const w = panel.mesh?.position;
        if (!w) continue;
        const dx = w.x - from.o[0];
        const dz = w.z - from.o[2];
        const fwd = dx * from.f[0] + dz * from.f[1];
        const lat = dx * from.r[0] + dz * from.r[1];
        const at = [
          to.o[0] + to.f[0] * fwd + to.r[0] * lat,
          to.o[1] + (w.y - from.o[1]),
          to.o[2] + to.f[1] * fwd + to.r[1] * lat,
        ];
        const spec = { id, tex: panel.tex, kpId: panel.kpId ?? null, em: panel.em, billboard: panel.billboard ?? "yaw", display: panel.displayMode !== false, at };
        signals.emit("math:hide", { id });
        signals.emit("math:show", spec);
        moved += 1;
      }
      return moved;
    };

    const runtime = new VerbRuntime({
      emit: (name, value) => signals.emit(name, value),
      on: (name, fn) => signals.on(name, fn),
      basis,
      teaching: getTeaching,
      bank: itemBank,
      validateTex: (tex) => validate(tex, { locale: getLocale(), displayMode: true }).ok,
      plant,
      rebase,
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
        /**
         * The stance, read back off the body rather than off this module's own belief about it. A
         * `planted: true` beside a body that is still moving is the failure mode the whole fix has,
         * and it is a number a reviewer can check rather than a claim they have to take.
         */
        stance: {
          planted,
          intent: (() => {
            const b = kernel.get("locomotion");
            return b ? { x: Math.round((b.moveX ?? 0) * 100) / 100, y: Math.round((b.moveY ?? 0) * 100) / 100 } : null;
          })(),
          speed: (() => {
            const s = kernel.get("locomotion")?.snapshot?.();
            return Number.isFinite(s?.speed) ? Math.round(s.speed * 100) / 100 : null;
          })(),
        },
      };
    });

    if (!kernel.get("learning")) warn("verbs: no learning system is mounted — nothing will ever be posed");
  },
};
