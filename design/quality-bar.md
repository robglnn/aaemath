# The bar

Binding for every builder and every critic. A piece is not done when it works; it is done when a
hostile reviewer, looking at real pixels and real state, cannot name a gap that matters.

## 1. What we are being compared to

**Feel — *Fortnite* and *Zelda: Breath of the Wild*.** Not their content; their *dynamics*.

- Movement reads as weight moving through space: acceleration, momentum, a landing that costs
  something, a turn that has a radius. Never a camera sliding on rails.
- Every action has a start, a commitment and a recovery. Input during recovery is buffered, not
  swallowed.
- The world answers you. Slopes slow you, edges catch you, heights invite a jump, distant
  silhouettes pull you toward them. BotW's real trick is that the horizon poses a question.
- Fortnite's real trick is that construction is *fast* — the verb resolves in a few frames and the
  result is legible instantly.
- Readability under motion beats detail at rest. If it turns to noise while running, it is wrong.

**Tone — optimistic sci-fi wonder.**

- *Fourth Wing*: a bond you earn, stakes that are personal, a rite that changes you.
- *Valerian*: overwhelming, generous, colourful strangeness — a thousand cultures in one frame.
- *Red Rising*: hierarchy, ascent, a protagonist who out-thinks the system.
- *Hitchhiker's*: dry wit, gleeful absurdity, the universe as a slightly badly-run institution.
- The blend is *hopeful*. No grimdark, no lecture, no cynicism about learning.

**Art — `reference/target-lowpoly.png`. This is THE target and it is binding.**

Flat-shaded low-poly, in the lineage of PS1-era geometry rendered with modern lighting. Read the
image before you touch a shader. What it actually specifies:

- **Faceted everything.** Rock, terrain and props are low-triangle solids with visible flat facets
  and hard edges. No smooth-shaded organic blobs, no normal maps, no high-frequency surface detail.
  Geometry carries the form; shading only reveals it.
- **Per-face flat shading**, not smooth vertex normals. A cliff should read as a handful of distinct
  planes each holding one value.
- **Banded, painterly sky** — a warm dusk gradient with hard-edged stylised cloud slabs, not
  volumetric cloud. Big, simple, confident shapes.
- **Two-value palette discipline**: warm ochre/sand rock in light, desaturated blue-grey in shadow.
  Cyan crystal and cyan water are the only saturated accents and they carry all the eye-attention.
- **Silhouette over detail.** Spires, floating islands and distant city towers read as clean
  cut-outs against the sky. Distance is carried by value and haze, not by more polygons.
- **Hard-edged UI**: chunky bars, a pixel/blocky typeface, a compass disc, an item bar. Confident
  and game-like, never a web dashboard.
- **The mathematics floats unadorned in world space** — clean white KaTeX and a simple plotted axis
  hovering in air, no panel chrome, no glass frame. It is legible because it is bright and simple.

This target is *achievable in real time*, which means the excuse of "the reference is a painting"
is gone. We are expected to match it and then beat it. Beating it looks like: better composition,
better light, motion and life the still cannot have.

`reference/brief-hero.png` is retained only as a **mood/tone** artefact — colour feeling and sense of
wonder. It is NOT the render target. Where the two conflict, `target-lowpoly.png` wins.

## 2. Testable minimums

Any of these failing is an automatic fail, no argument:

| # | Gate | How it is checked |
|---|------|-------------------|
| G1 | Boots clean in EN, ES and PL | `review.mjs verify --langs=en,es,pl` — zero console errors, zero failed requests |
| G2 | No KaTeX failures, no raw TeX visible to a player | `report().katex.failed === 0 && rawSourceLeak === false` |
| G3 | Every string localized; no English fallback visible in ES/PL | i18n probe reports zero missing keys |
| G4 | Simulation is deterministic and frame-rate independent | same `advance()` sequence reproduces the same probe values |
| G5 | Frame cost does not regress | `review.mjs perf` median within 15% of the previous pass |
| G6 | Keyboard+mouse *and* gamepad both play the whole game | input probe reports both paths bound |
| G7 | Readable at 1280×720 and at 3840×2160 | shots at both sizes |
| G8 | No placeholder art, lorem text or debug labels in a player-visible frame | visual review |

## 3. Learning gates

| # | Gate | How it is checked |
|---|------|-------------------|
| L1 | Every learning interaction is a *game verb*, not a quiz popup | a critic plays it and says what they did with their hands |
| L2 | Explicit teaching is present but never announced — worked example, faded scaffold, then independent practice | trace one knowledge point end to end |
| L3 | Every item is tagged to a knowledge point, and every knowledge point to a standard | data audit |
| L4 | The adaptive engine drives ≥80% mastery for a simulated median learner | offline simulation over the real item bank, reported with numbers |
| L5 | Mastery is *earned*, not given: retention-checked, spaced, not passable by guessing | simulate a guessing bot; it must fail |
| L6 | ES and PL are real localizations — math conventions, not just translated words | native-level review of decimal marks, variable names, phrasing |
| L7 | Feedback is immediate, specific to the misconception, and in-world | inspect the wrong-answer path for at least 3 misconceptions |

## 4. How a critic must work

1. Run the game yourself. Real pixels, real state, both `--lang=es` and `--lang=pl`, at least two
   viewport sizes.
2. Never quote the builder's summary as evidence. If the only proof of a claim is that the builder
   said so, the claim is unproven and the piece fails.
3. Compare side by side against the reference and against your memory of the named games. Say which
   is better. If ours loses, name **the single biggest gap** — one gap, the one that would move the
   most if fixed.
4. Be specific enough to act on: which file, which value, which pixel region.
5. Do not pass a piece to be kind. Do not fail a piece for something already gated elsewhere.
6. State what you actually verified and what you did not.

## 5. Definition of done for a piece

- All applicable gates in §2 and §3 pass, with evidence.
- A critic who did not build it has looked at real output and can name no gap that matters.
- It composes: the integrator can run the whole game and this piece does not fight its neighbours.
