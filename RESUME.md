# Variable Star — state of the build, and how to resume

**Repo:** https://github.com/robglnn/aaemath · **Live:** https://robglnn.github.io/aaemath/
**Local:** `npm install && npm run dev` → http://127.0.0.1:5173/
**Live progress board:** open `progress.html` in a browser (self-refreshes every 25 s).

Paused 2026-08-10 ~00:15 ET because the session budget ran out, not because a stage finished.
Two workflows were stopped mid-flight; nothing below is critic-passed unless it says so.

---

## 1. What this is

An adaptive Algebra I mastery game in Three.js. Browser, EN/ES/PL, strict KaTeX, knowledge-graph
driven. Feel is judged against Fortnite and Breath of the Wild; tone against Fourth Wing / Valerian /
Red Rising / Hitchhiker's Guide; **look against `reference/target-lowpoly.png`** (flat-shaded
low-poly). `reference/brief-hero.png` is mood only — where they conflict, the low-poly target wins.

Binding documents, read these first:
- `CLAUDE.md` — working rules. Rule 1: this folder is the entire world; never read anything outside
  it (`C:\dev\math\aacmath` is explicitly forbidden). All work here is original.
- `design/quality-bar.md` — 8 hard technical gates (G1–G8) + 7 learning gates (L1–L7).
- `design/architecture.md` — file ownership, system hooks, the signal vocabulary.
- `design/pieces.json` — the 29 pieces, who owns which paths, and how each is judged.

## 2. Honest status

| | |
|---|---|
| Critic-passed | **P07 input only.** |
| Substantial but rejected on last review | P01 world bible, P02 art direction, P03 learning architecture, P04 locomotion, P05 camera |
| Built, never judged (stopped mid-wave) | P09 terrain, P10 sky, P11 lighting/materials, P12 post, P13 scatter, P15 KaTeX, P16 mastery, P17 items, P20 i18n |
| Not started | P06 traversal, P08 avatar, P14 VFX, P18 teaching, P19 verbs, P21–P29 |

~36 builder/critic rounds burned. `progress/status/*.json` holds per-piece state; `progress/log.jsonl`
is the event feed. **The workflow's structured verdict governs, not the status file** — builders
sometimes logged `passed` while the critic returned `pass:false`, and the loop correctly continued.

## 3. What actually works right now

- Deterministic kernel: fixed 60 Hz simulation with render interpolation (`app/src/core/Kernel.js`).
  Gameplay goes in `fixed(step, simTime)`; only visual smoothing in `frame(dt, alpha)`.
- Movement, camera and input are real systems (`Locomotion.js` 60 KB, `CameraRig.js` 49 KB,
  `Input.js` 89 KB with full gamepad support, `CollisionWorld.js` 41 KB).
- The world renders in the target's language: banded dusk sky with hard-edged cloud slabs, floating
  islands receding into haze, distant city silhouettes, faceted cyan crystal, warm rock against cool
  shadow, and **bare white world-space KaTeX with no panel or frame**.
- Learning spine exists: 32 knowledge-point generator families, 8,663 KaTeX-clean TeX strings,
  three locale bundles at 338 strings each.
- Player avatar is still a blue capsule (P08 never started).

## 4. How to look at the game — the only sanctioned way

```bash
node tools/review.mjs shot review/shots/x.png --width=1920 --height=1080 --lang=es \
     --script="grip:KeyW:1.5;look:200:-60"
node tools/review.mjs verify --langs=en,es,pl    # boot + console + KaTeX + i18n gate
node tools/review.mjs tour review/shots/tour     # fixed framings for round-over-round comparison
node tools/review.mjs perf --seconds=6
node tools/ab.mjs --round=<label> --ours=<png> --other=reference/target-lowpoly.png
node tools/status.mjs <PIECE> building|critique|passed --round=N --gap="..."
node tools/progress.mjs                          # regenerate progress.html
```

Script verbs: `play:SEC` `hold:Key:SEC` `grip:Key:SEC` (stay held) `tap:Key` `look:DX:DY`
`click:X:Y` `eval:JS`.

Three things about this harness that were learned the hard way:
1. **Game time advances through `__vs.advance(seconds)`, never wall-clock.** Headless SwiftShader
   runs at ~2 fps; any wall-clock wait measures nothing and makes movement look like a physics bug.
2. **A shot report with a non-empty `problems` array is not reviewable.** A black frame is a bug, not
   art direction.
3. **Captures queue for 3 slots** (`review/.slots/`). Parallel SwiftShader renders thrash rather than
   parallelise. Screenshot timeout is 180 s; a 30 s timeout is contention, not a hang.

## 5. Infrastructure decisions worth not re-litigating

- **Features self-register** by dropping one file in `app/src/boot/` (Vite lazy directory glob). That
  is why a dozen agents build in parallel without ever editing a shared file. `main.js` is never
  edited. See `app/src/boot/README.md` for the order table.
- **The glob is lazy on purpose.** An eager glob evaluates every boot module during `main.js`'s own
  evaluation, so one feature throwing at import time blanks the whole build before the kernel or
  `window.__vs` exist — the reviewer then sees a blank page and no error. Each module now imports
  inside try/catch and failures are isolated and named.
- **`window.__vs` is published at module-evaluation time**, before anything can throw, so a reviewer
  always has something to read.
- **Palette access goes through `app/src/core/paletteCompat.js`** and unknown roles render debug
  magenta with a warning instead of throwing. `design/palette.json` is owned by the art piece and
  rewritten independently; a renamed colour once took the entire lighting rig off the air.
- **Feature modules never import sibling feature modules** — everything crosses through
  `core/Signals.js` using the vocabulary in `design/architecture.md`.

## 6. Resume here

Run these as builder→hostile-critic loops (up to 3 rounds each, critic must inspect real pixels and
real probe state, never the builder's summary). Workflow scripts are reusable:

- `%TEMP%\claude\C--dev-math-aaemath\<session>\scratchpad\wave-lowpoly.js` — art re-aim + world
- `...\wave-learn.js` — KaTeX, mastery, items, i18n, then teaching + verbs

**Priority order:**
1. **Judge the unjudged.** P09–P13 and P15/P16/P17/P20 have never faced a critic. Do this before
   building anything new.
2. **P02 art direction** — last critic: *"claims camera framing in its own scope line and specifies
   zero composition: no FOV, no horizon-height law."* Composition weakness downstream traces to this.
3. **P08 avatar** — the player is a capsule; it is the most visible remaining gap in every frame.
4. **P18 teaching + P19 in-world verbs** — the pieces that make the maths a *mechanic*. P19's test:
   a critic must describe what they did with their hands, and it must have been algebra. Any modal
   quiz box is an automatic fail.
5. **Blind A/B** against `target-lowpoly.png` via `tools/ab.mjs`: two judges, opposite orders, not
   told which is ours, forbidden from opening `KEY.txt`; a resolver decodes and attributes gaps.
6. Then P06 traversal, P14 VFX, P21–P29 (HUD, menus, onboarding, progress viz, audio, building,
   session/save, coherence, delivery).

## 7. Learning-integrity findings that must not regress

Critics found three separate routes by which scaffolded practice could be laundered into unearned
mastery. All three must stay closed, and any new mastery code must be checked against them:

1. Hinted/scaffolded items credited at the **same guess parameter** as unconstrained items, so
   hint-abuse buys mastery.
2. A guessing-bot proof that was **circular** — the simulation set the bot's true success rate equal
   to the model's own guess parameter, and never served the item form that made it trivial. A real
   proof derives the bot's success rate from the item forms actually served.
3. The M4 retention count read raw `outcome.correct` in `Scheduler.submit`, **ignoring the scaffold
   discount** the engine had already applied.

Gate L5 is the standard: simulate a median learner (must reach ≥80% mastery), a coin-flip guesser and
a hint-abuser (neither may reach mastery), and report real numbers.
