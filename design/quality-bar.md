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

**Art — `reference/brief-hero.png`.** Stylized, painterly, saturated. Warm rock against cool
resonance light, an aurora sky doing real work, silhouettes readable at thumbnail size,
holographic mathematics that looks like the most beautiful object in the frame.

Honest framing: that reference is a painted illustration. A real-time browser render beating it
outright is a stretch target. The *gap list* a blind comparison produces is the real deliverable —
but do not let that become an excuse. Close the gaps.

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
