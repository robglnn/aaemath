# Variable Star — working rules

An adaptive Algebra I mastery game that has to hold up next to *Fortnite* and *Zelda: Breath of
the Wild* on feel, and next to *Fourth Wing*, *Valerian*, *Red Rising* and *The Hitchhiker's Guide
to the Galaxy* on tone. Browser, Three.js, EN/ES/PL, strict KaTeX.

## Absolute rules

1. **This folder is the entire world.** Never read, copy, reference or take inspiration from any
   file outside `C:\dev\math\aaemath`. Sibling directories on this machine are off-limits — in
   particular `C:\dev\math\aacmath`. Everything here is original to this project. If you think you
   need something from outside, write it yourself instead.
2. **No web scraping of game assets or code.** Original work only. Researching *facts* (a standards
   code, a pedagogy result, a KaTeX API) is fine; lifting implementations is not.
3. **Never trust a description of the game — look at it.** Judgements about how it looks, feels,
   reads or teaches must come from `node tools/review.mjs`, which boots the real app in a real
   browser and captures real pixels and real state.
4. **A screenshot with `problems` in its report is not reviewable.** Fix the boot/console/KaTeX
   failure first; a black frame is a bug, not an art choice.
5. **Own your files.** Each piece has an explicit file list in `design/architecture.md`. Do not edit
   files owned by another piece. If you need a change there, emit a signal or note it in your
   handoff. `app/src/main.js` is the shared assembly point — edit surgically, never rewrite.
6. **Feature modules never import sibling feature modules.** Talk through `core/Signals.js`.
   Kernel and `core/*` helpers are the only permitted shared imports.

## Commands

```bash
npm run dev                      # local dev server
npm run build                    # production build to dist/
node tools/review.mjs shot review/shots/x.png --lang=es --script="grip:KeyW:1.5"
node tools/review.mjs verify --langs=en,es,pl     # hard gate: boot, console, KaTeX, i18n
node tools/review.mjs tour review/shots/tour      # fixed framings for round-over-round comparison
node tools/review.mjs perf --seconds=8            # relative frame-cost regression signal
node tools/progress.mjs                           # regenerate the live progress page
```

## Determinism

The kernel runs simulation at a fixed 60 Hz (`app/src/core/Kernel.js`). Gameplay code goes in
`fixed(step, simTime)`; only visual smoothing and UI go in `frame(dt, alpha)`. Never scale gameplay
by a variable frame delta — it is the reason browser games feel different on different machines,
and it makes automated review meaningless.

Reviewers advance time with `__vs.advance(seconds)`. Headless software GL renders at a few frames
per second, so **wall-clock waits measure nothing**. Anything that looks like sluggish movement in a
headless capture is a measurement artefact until proven otherwise with `simTime`.

## Quality bar

`design/quality-bar.md` is binding. `reference/brief-hero.png` is the art-direction reference from
the brief. Critics compare our real render against it side by side, blind, and name the single
biggest gap when we lose.

## Learning is not a layer on top

The math is the mechanic. A player should be exercising an Algebra I knowledge point *by playing*,
not by stopping the game to answer a quiz. Explicit teaching happens — it is just never announced.
