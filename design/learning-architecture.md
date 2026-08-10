# Learning architecture — Algebra I, Level 1

Owner: **P03**. Binding for P16 (mastery engine), P17 (item bank), P18 (teaching director),
P19 (in-world verbs), P24 (progress UI) and P27 (session flow).

Every number in this document is also in `content/knowledge-graph.json` under `model`. **That
file is the single source of truth; this file is the argument for it.** P16 reads the JSON. If a
number here and a number there disagree, the JSON wins and this file is a bug.

Three scripts under `review/p03/` are the executable form of this document. They are the evidence,
not the summary:

| script | what it proves | evidence |
|---|---|---|
| `node review/p03/kg-validate.mjs` | the graph is a DAG, transitively reduced, fully standards-mapped, band-monotone, **closed under what its own items require** (§0), its misconceptions are separable and constructed-response, and its scorable **(form × phase)** set is what the identifiability caps actually derive | `review/p03/evidence/kg-validate.txt` |
| `node review/p03/signature-collide.mjs` | **PAIRWISE-SEPARATED**: an exhaustive scan of every node family whose misconception signatures share a stem, measuring how often two different wrong ideas collapse onto the same response — with a control arm that must flag 100% | `review/p03/evidence/signature-collide.txt` |
| `node review/p03/kp-trace.mjs` | the worked numeric trace, closed form, no randomness; and the guessing arithmetic on **both** axes, in the model's currency and in ground truth | `review/p03/evidence/kp-trace-eq-two-step.txt` |
| `node review/p03/mastery-sim.mjs` | L4 (median learner ≥ 80%) and L5 (a guesser fails), the latter against bots whose true success rate is **independent of the model's guess parameter** — including a bot that idles for the hint on every acquisition item | `review/p03/evidence/mastery-sim.txt` |

---

## 0. The shape of the thing

32 knowledge points, 48 prerequisite edges, two roots (`var-meaning`, `oo-numeric`), four leaves,
longest prerequisite chain 11 nodes. 354 minutes of scored-item time. Five strands:
reading and running an expression, words into algebra, rewriting without changing meaning, claims
you can solve, claims with room in them.

The prerequisite relation is **acyclic** and **transitively reduced**. Reduction is not cosmetic: the
frontier rule below reads "all direct prerequisites unlocked", and a redundant edge would make that
rule silently stricter than it looks. `kg-validate.mjs` fails the build if either property breaks.

### 0.1 The third property: the graph is closed under what its own items require

Acyclic and reduced are properties of the graph's *shape*. They can both hold while the graph is
still wrong in the only way that reaches a learner. Round 2 shipped exactly that:
`like-terms-id` was gated on `expr-anatomy` alone, so its whole ancestor closure was
{`var-meaning`, `expr-anatomy`} — and its third misconception, `exponent-ignored-in-matching`,
builds a **scored** item asking the learner to sort `a·x, b·x², c·x, d·x², e` into weld stacks.
Nothing upstream had ever said what an exponent on a letter means. The learner met `x²` for the
first time inside an item that punished them for misreading it, which falsifies §5 reason 1 —
"an item is never a wall built of an earlier gap" — on the node this document uses as its L5
exemplar. Worse, the graph already knew the rule: `distribute-variable` lists `oo-structure` as a
direct prerequisite for the identical `x²` reasoning in `variable-multiplied-as-well`.

So there is a third asserted property, and it is checked the same way the other two are:

> **Concept closure.** For every concept in `kg-validate.mjs`'s `conceptRequirements` table, a node
> whose misconception text uses that concept must either *be* the node that teaches it or have that
> node in its **transitive ancestor closure**.

A misconception is not documentation. P17 builds a scored item out of its `diagnosticSignature`, so
every mathematical object named there is an object the learner is about to be graded on. Four
concepts are declared today:

| concept | tokens fire on | must be taught by | fires on |
|---|---|---|---|
| variable exponent | a letter carrying a power, "exponent", "squared", "raised to", "same power" | `oo-structure` | 6 nodes |
| signed value | "negative *number/value/coefficient*", "by a negative", `= −v`, "double negative" | `eval-signed` | 4 nodes |
| distributive property | "distribut…" | `distribute-numeric` | 4 nodes |
| like terms | "like terms", "unlike terms" | `like-terms-id` | 3 nodes |

The patterns are narrow on purpose and carry **no exemptions except the teaching node itself**. The
loose form of the exponent rule over-fires — `oo-numeric` legitimately says the word "exponents"
while teaching 2³ — and a lint that flags a node it should not is a lint the next builder weakens
instead of the graph. So the exponent rule scans a node's own description only through a stricter
pattern that requires a *letter* carrying the power.

The check carries a **control arm**, for the same reason `mastery-sim.mjs` keeps the leaking legacy
rules running: a check that only ever reports zero cannot be told apart from a broken detector. On
every run, `kg-validate.mjs` re-injects the round-2 prerequisites into a copy of the graph and
asserts the lint finds exactly three gaps —
`variable-exponent/like-terms-id`, `variable-exponent/like-terms-combine`,
`signed-value/ineq-one-step` — and fails the build if it finds any other number.

**What that cost structurally: nothing.** Two edges moved and every count above is the count before.

| change | why | effect on the graph |
|---|---|---|
| `like-terms-id`: `expr-anatomy` → `oo-structure` | it asks whether `3x` and `5x²` are the same kind of thing | `expr-anatomy → like-terms-id` becomes transitively redundant and is dropped. `like-terms-combine` inherits `oo-structure` through it, with no second edit |
| `ineq-one-step`: `+ eval-signed`, and `ineq-negative-flip`: `− eval-signed` | `flip-because-a-negative-appeared` serves the stem `x + (−p) < q`; its own child `ineq-negative-flip` and its sibling `eq-two-step` both already demanded `eval-signed` | `eval-signed → ineq-negative-flip` becomes transitively implied through `ineq-one-step` and is dropped. Net edge count unchanged |

Still 32 nodes, 48 edges, 0 cycles, 0 redundant edges, 0 band inversions, 2 roots, 4 leaves,
longest chain 11, 354 estMinutes, band distribution `{1:3, 2:11, 3:8, 4:7, 5:3}`, and the same
descendant counts the selector's `Reach` term is normalised against (`expr-anatomy` 29,
`eval-substitute` 20, `props-equality` 11).

Difficulty band distribution: `{1: 3, 2: 11, 3: 8, 4: 7, 5: 3}` — front-loaded, because a learner who
bounces off the first twenty minutes never sees band 5. The graph is **band-monotone**: no node is
easier than any of its prerequisites, which is asserted rather than hoped, because a node sitting
behind a harder parent gets pitched at the wrong band centre and carries a prior set for a
population that has not met the parent.

---

## 1. The learner model

### 1.1 Bayesian knowledge tracing, per difficulty band

One BKT model per knowledge point. Parameters are not fitted per node — with a fresh title there is
no data to fit — they are assigned by the node's difficulty band and re-fitted from telemetry later.

| band | `prior` p(L₀) | `learn` p(T) | `slip` p(S) | `guess` p(G) | difficulty centre (logit) |
|---|---|---|---|---|---|
| 1 | 0.35 | 0.28 | 0.08 | 0.05 | −1.6 |
| 2 | 0.25 | 0.24 | 0.10 | 0.06 | −0.8 |
| 3 | 0.18 | 0.20 | 0.12 | 0.07 | 0.0 |
| 4 | 0.12 | 0.16 | 0.14 | 0.08 | +0.8 |
| 5 | 0.08 | 0.13 | 0.16 | 0.10 | +1.6 |

**Why the prior falls with band.** A learner arriving at Algebra I has had grade 6–7 exposure to the
band-1 material (order of operations, what a letter is). Roughly a third arrive already fluent
there; almost nobody arrives fluent at variables-on-both-sides or at reading an identity as
"every number works". 0.35 → 0.08 is that gradient. Setting the prior *low* is the conservative
choice: a wrong-high prior hands out mastery, a wrong-low prior only costs a few items, and M2
below caps the damage either way.

**Why the learn rate falls with band.** p(T) = 0.28 at band 1 means a learner who does not know it
has a 28% chance of acquiring it on each opportunity — about six opportunities to go from 0.35 to
above 0.95 on evidence alone. p(T) = 0.13 at band 5 means about fourteen. That is the honest ratio
between "what a coefficient is" and "solve px + q = r from a story". Published BKT fits for school
mathematics skills sit roughly in 0.05–0.35; these values live inside that range and are ordered
by step count, which is the thing that actually predicts difficulty in linear algebra.

**Why slip rises with band.** Slip is the probability of an error when the skill is genuinely held.
More steps means more places to drop a sign. 0.08 at one step, 0.16 at four. The hard cap is 0.16.

**Why guess is so low.** Because the response is *constructed*, not selected. A Level 1 item asks the
learner to place a value, weld a beam, cut a span or build a rail — the answer space for a numeric
slot is the integers in [−20, 20] plus fraction forms, so blind success is a few per cent, not 25%.

### 1.1a Two different numbers, and never confusing them again

There are two per-form probabilities in this design and they are not the same thing.

- **`guessByForm`** is a **model belief**: a multiplier on the band's `guess`, giving the value the
  BKT update uses.
- **`trueGuessByForm`** is **ground truth**: the probability a responder with zero knowledge is
  correct, derived from the size of the form's answer space and owing nothing to BKT.

| form | model guess (band 1 → 5) | **true blind rate** | scored? |
|---|---|---|---|
| `construct` — build the answer | 0.050 → 0.100 | **0.03** (1 of 41 integer slots, and expression slots are far larger) | yes |
| `repair` — fix a broken build | 0.050 → 0.100 | **0.03** (find one of ~6 unmarked joints *and* correct it) | yes |
| `generate` — produce a case with a named property | 0.030 → 0.060 | **0.02** (many right answers, none reachable by luck) | yes |
| `select4` — pick one of four | 0.170 → 0.340 | **0.25** | **no** |
| `judge2` — yes/no | 0.300 → 0.600 | **0.50** | **no** |

**The rule that decides the last column.** A form is scorable iff, at *every* band:

1. `trueGuess ≤ maxTrueGuess` (0.30);
2. `trueGuess + maxSlip < maxSlipPlusGuess` (0.16 + true < 0.5), so BKT stays identifiable;
3. **conservatism** — the modelled guess is at least the true guess, so a correct response never
   moves `P(known)` further than the truth warrants;
4. the modelled guess itself respects `maxGuess` and `slip + guess < 0.5` **without being clamped**.

Run that over the five forms and it returns exactly `{construct, repair, generate}`.
`kg-validate.mjs` recomputes it on every run and fails if it disagrees with
`model.forms.scored` or `model.bkt.formsEligibleForMastery`, so the two arrays can never drift
away from the argument that produced them.

**The honest consequence, stated rather than softened.** `judge2` fails rules 1, 2 and 4 at once: a
coin flip is worth 0.50, the cap is 0.30, and 0.50 + 0.16 is deep inside the region where BKT stops
being identifiable. There is no multiplier that fixes it — reaching a modelled 0.50 breaks
`maxGuess` outright. **So `judge2` is excluded from the scored path entirely, not discouraged.**

`select4` fails rule 3 at bands 1–3 (modelled 0.170 / 0.204 / 0.238 against a true 0.25 — every
lucky quarter-chance credited as knowledge), and the failure is not repairable either: making it
conservative at band 1 needs a multiplier of at least 5.0, staying under `maxGuess` at band 5 needs
at most 3.0, and 5.0 > 3.0. **No assignment of `guessByForm` makes `select4` scorable across all
five bands.** It is out too.

Both forms remain *legal in the world* — inside a `model` phase, where the machine has just
performed the algebra in front of you and you confirm what you watched, and in narrative surfaces.
They produce a `learn:respond` with `scored: false` and buy exactly nothing: no posterior, no M2
count, no form count, no prerequisite credit, no θ movement.

**Identifiability caps (hard):** `slip ≤ 0.16`, `guess ≤ 0.30`, `slip + guess < 0.5`. Outside that
region BKT parameters stop being identifiable — different (slip, guess) pairs produce the same
likelihood, and the degenerate corner where slip and guess are both high makes "wrong" evidence
*for* mastery. **The caps are a rejection test on a form *and on a phase*, never a clamp on an observed rate.**
Clamping is specifically forbidden (`identifiabilityCaps.clampTrueRates: false`), because clamping a
yes/no item's real 0.50 down to 0.30 is precisely how a mastery gate gets handed to a coin: every
correct flip then moves `P(known)` further than the evidence supports, and it compounds.

**The floor nobody looks at.** `learn` puts a floor under the all-wrong BKT fixed point — a
responder who is never right still drifts upward, and the higher the learn rate the higher the
floor. Assert, at every band and in both learn-rate states, that **one** correct answer from that
floor never clears 0.95 — i.e. that at least **two corrects inside the recent window** are needed:

| band | normal `t` | all-wrong floor | +1 correct | relearn `t` | relearn floor | +1 correct |
|---|---|---|---|---|---|---|
| 1 | 0.280 | 0.3057 | 0.9209 | 0.320 | 0.3494 | 0.9375 |
| 2 | 0.240 | 0.2686 | 0.8832 | 0.320 | 0.3581 | 0.9274 |
| 3 | 0.200 | 0.2296 | 0.8315 | 0.320 | 0.3674 | 0.9181 |
| 4 | 0.160 | 0.1887 | 0.7600 | 0.256 | 0.3019 | 0.8683 |
| 5 | 0.130 | 0.1581 | 0.6625 | 0.208 | 0.2530 | 0.7940 |

This invariant is why `relearnLearnRateCap` is **0.32** and not the 0.45 of the first draft. At 0.45
the band-1 relearn floor sat at 0.489 and a *single* lucky answer reached 0.9704 — M1 cleared on one
coin flip. The simulation found it once the bot's true rate was decoupled from the model's belief;
nothing in the first draft could have.

**Read that invariant precisely, because P16 has to implement it and the loose reading is a
different mechanism.** The "+1 correct" column is a statement about the **all-wrong fixed point**,
which is the worst case and the only case the cap has to survive. It is *not* a claim that two
corrects must be consecutive in general. Away from the floor they need not be: starting from the
ordinary band prior, the response pattern **C, W, C** reaches

| band | prior | after C | after W | after C | clears 0.95? |
|---|---|---|---|---|---|
| 1 | 0.35 | 0.9340 | 0.6715 | **0.9814** | yes |
| 2 | 0.25 | 0.8733 | 0.5616 | **0.9624** | yes |
| 3 | 0.18 | 0.7872 | 0.4585 | 0.9313 | no |
| 4 | 0.12 | 0.6594 | 0.3511 | 0.8768 | no |
| 5 | 0.08 | 0.4972 | 0.2601 | 0.7799 | no |

— two corrects, not two in a row, and M1 is open at bands 1 and 2. That is correct behaviour, not a
leak: it is BKT doing what BKT does with a favourable prior, and M2 (six scored opportunities, three
at band), M3, consolidation and M4 are what stop it becoming a certification. **So do not build a
consecutive-run detector.** The gate reads `P(known)`, the counters and the form set; nothing in it
inspects the order of the responses. `kg-validate.mjs` prints this table next to the fixed-point
table on every run so the two can never be conflated again.

### 1.1b The same four rules, run over the *phase*

An item's price has two factors, not one. The **form** decides how big the answer space is. The
**teaching phase** decides how much of that space the world has already filled in — and a scaffold
shrinks an answer space in exactly the way a multiple choice does. Running the rules over forms only,
and then pricing a six-seatable-parts scaffold at one-in-thirty-three, is not a rule. It is a
preference wearing a rule's clothes.

So there is a second table, and it is read with the same four rules:

| phase | model guess (band 1 → 5) | **true blind rate** | scored? | counts for M2/M3? |
|---|---|---|---|---|
| `solo` — no help at all | 0.050 → 0.100 | **0.00**; the form's own rate stands alone | yes | **yes** |
| `guided-1` — the first step is already placed | 0.100 → 0.200 | **0.08** (about one in twelve of the completions that will seat) | yes | **no** |
| `guided-2` — the answer space is constrained to legal moves | — | **0.17** (about six seatable parts; 1/6) | **no** | no |
| `guided-3` — a hint surface names the next move after 12 s | — | **0.85** (reading it and doing what it says is the point of a hint) | **no** | no |
| `model` — the world just performed the identical act | — | **0.70** (copying what you watched thirty seconds ago) | **no** | no |

**`guided-2` is `select4` with different numerals, and it ends the same way.** Priced the round-3 way
— the form's multiplier, no phase term — it fails rule 3 at *every* band: 0.050 / 0.060 / 0.070 /
0.080 / 0.100 against a true 0.17, so five times in six a part that will not seat is refused by the
world and the sixth is credited to the learner as knowledge. And the failure is not repairable:
conservatism at band 1 needs a multiplier of at least **3.4**, staying under `maxGuess` at band 5
allows at most **3.0**, and 3.4 > 3.0. **No assignment of `guessByPhase` makes `guided-2` scorable
across all five bands.**

**`guided-3` is `judge2`, only worse.** A coin is 0.50; a hint that names the next move is 0.85. It
fails rule 1 (0.85 > 0.30), rule 2 (0.85 + 0.16 = 1.01, twice `maxSlipPlusGuess`) and rule 4 (no
multiplier reaches a modelled 0.85 under a 0.30 cap). `model`, at 0.70, fails the same three.

**`guided-1` is the one that is repairable, and it is repaired rather than waved through.** 0.08
needs at least ×1.6 at band 1 and at most ×3.0 at band 5, so the window `[1.6, 3.0]` is non-empty and
`guessByPhase["guided-1"] = 2.0` sits inside it: modelled 0.100 / 0.120 / 0.140 / 0.160 / 0.200
against a true 0.08, conservative at every band. At the round-3 price it failed rule 3 at bands 1–3.

**Scorable is not mastery-eligible, and that is a second gate, not a restatement of the first.**
`model.bkt.phasesEligibleForMastery` is `["solo"]`. `guided-1` may move `P(known)` — at an honest
price — and may never increment `scored`, `atBand` or the form set. A first step someone else placed
is evidence about the rest of the item; it is not an independent demonstration of the knowledge
point. So M2's six opportunities and M3's two distinct forms can only be filled from items where the
world contributed **nothing**, which `kg-validate.mjs` asserts by checking that every
mastery-eligible phase has a true blind rate of exactly 0.00 and an unhinted flag.

**The composed price, which is what P16 implements.** Both axes compose by `max`, never by product:

```
trueGuess(form, phase)         = max( trueGuessByForm[form], trueGuessByPhase[phase] )
modelledGuess(band, form, phase) = band.guess × max( guessByForm[form], guessByPhase[phase] )
```

`max` because a scaffold puts a **floor** under blind success — placing the first step cannot make an
item harder to fluke — and because a product would let `generate`'s ×0.6 undercut the scaffold floor
and quietly reintroduce the under-pricing this whole section exists to remove. `kg-validate.mjs`
evaluates all 25 cells of forms × phases on every run and asserts the scorable set is exactly
`{construct, repair, generate} × {solo, guided-1}` — 6 of 25 — of which
`{construct, repair, generate} × {solo}` — 3 of 25 — are mastery-eligible.

One guess, both directions. The same `(slip, guess)` pair prices a correct and a wrong response;
using a smaller guess on the down-update would be a second, quieter version of the clamping
forbidden below.

### 1.2 The update

On each scored opportunity, posterior then transition:

```
P⁺ = P(1−slip) / ( P(1−slip) + (1−P)·guess )        correct
P⁻ = P·slip    / ( P·slip    + (1−P)(1−guess) )      wrong
P  ← w · ( Pᵒ + (1−Pᵒ)·learn ) + (1−w) · P_before
```

`w` is the **credit weight**. `w = 1.0` for the item's primary knowledge point. `w = 0.5` for
**prerequisite credit**: an item tagged `exercises: [a, b]` also pays a half-weight update to each
listed prerequisite. Solving `3(x+4) = 27` really does exercise distribution and one-step equations,
and refusing to notice that is what makes tutors ask 400 questions to teach 30 things. Prerequisite
credit resets the prerequisite's spacing clock but **never** counts toward M2 below — you cannot be
certified on a skill you were only ever tested on incidentally.

### 1.3 The ability estimate

One ability estimate θ per learner across the whole graph, not per node — it is a global "how hard
should the next thing be" dial, and it is what makes the graph adaptive rather than merely gated.

Rasch model on the logit scale: `P(correct) = σ(θ − b)` where `b` is item difficulty.
Stochastic-approximation (Elo) update after every response:

```
θ ← θ + K · ( x − σ(θ − b) )
```

- `θ₀ = −0.8`. An entering Algebra I learner is below the median item; starting at 0 pitches the
  first ten minutes too hard, which is the single most expensive mistake an adaptive system makes.
- `K = 0.60` for the first 20 responses, `0.35` for responses 21–60, `0.20` thereafter. Provisional
  rating decay: converge fast, then stop twitching.
- Item difficulty `b` = the node's band centre + a variant offset from `{−0.6, −0.3, 0, +0.3, +0.6}`.
  P17 must produce five difficulty tiers per node; the offsets are the contract.

**Two pitches, and the difference matters.**

- **Acquisition pitch** — while `P(known) < 0.85`, target `b* = θ − 0.35`, i.e. `P(correct) ≈ 0.59`.
  Desirable difficulty: high enough to be worth doing, low enough not to be a wall.
- **Certification pitch** — once `P(known) ≥ 0.85`, target `b* = band centre + 0.3`. You **learn** at
  the edge of your ability and you **certify** at the difficulty the standard names.

This is not a detail. The first version of this design targeted `θ − 0.35` throughout, and the
simulation showed the consequence immediately: a learner below the band centre is served the easiest
variant forever, the gate's at-band requirement can never be satisfied, and *nothing is ever
certified*. Adaptive difficulty without a certification pitch measures comfort, not competence.

---

## 2. The mastery gate

A knowledge point is in exactly one of three states: `learning` → `provisional` → `mastered`.
Unlocking is **monotone**: once a node has reached `provisional`, it stays unlocked for its
dependents even if it later lapses. The world never re-locks behind a learner.

**`learning` → `provisional` requires all of:**

- **M1** `P(known) ≥ 0.95`. Corbett & Anderson's original mastery criterion, and it is the right one:
  at 0.95 the expected number of un-mastered skills certified across 32 nodes is 1.6, and every one
  of those is caught by M4.
- **M2** ≥ 6 **primary** scored opportunities on this node, of which ≥ 3 at or above the node's band
  centre. This is the number that stops a high prior from handing out mastery, and it is why the
  certification pitch exists.
- **M3** ≥ 2 distinct item **forms**.
- **M2 and M3 read two arrays, not one**, and an opportunity counts only if it clears *both*:
  `model.bkt.formsEligibleForMastery = [construct, repair, generate]` **and**
  `model.bkt.phasesEligibleForMastery = [solo]`. One exploitable interface affordance is not a
  skill, and neither is an item the world half-built for you. The reason both read as explicit
  arrays in the JSON rather than as sentences here is that each of them was once only a sentence:
  round 1 said the form rule in prose and an engineer implementing §8 faithfully would have
  satisfied M3 with `judge2` + `select4` — two forms and two coin flips — and round 3 never said the
  phase rule at all, so the same engineer would have satisfied M2's six opportunities with six
  scaffolded ones. `guided-1` is *scorable* and still may not count here (§1.1b); the gap between
  those two words is deliberate.
- **M5** no opportunity in the qualifying window scored upward from a sub-latency-floor response.

**M0, implied by all of the above and worth its own line.** Only a scored form **in a scored phase**
produces a BKT update at all. An item arriving in `judge2` or `select4` — which is what happens when
an item bank reads a closed question in a diagnostic signature and builds it literally — is answered,
is responded to in the world, and is then **discarded by the engine**. So is an item served at
`model`, `guided-2` or `guided-3`. Neither moves `P(known)`, neither increments `scored`, `atBand` or
the form set, and neither pays prerequisite credit. The one asymmetry in the design is not here: it
is `antiGuessing.hintedCorrectPolicy`, which refuses the *correct* side of a response the learner
chose to take help on while leaving the wrong side standing (§6.1).

**`provisional` → `mastered` requires:**

- a **consolidation pass** at +20 minutes in the same session: 2 items, unscaffolded, at band
  centre, forms from `spacing.consolidation.forms`. **"Pass" here means a pass over the material,
  not a passing score** — `spacing.consolidation.passAtLeast` is **0**, and it is written into the
  JSON rather than left implicit precisely because the word reads like a gate. The two items are
  scored normally, so getting them wrong pushes `P(known)` down and can strand the node below
  threshold when M4 arrives; but the transition to *awaiting retention* is not itself conditional on
  how many were right. Do not invent a requirement here: the §5.0 anti-guessing numbers were
  measured against exactly this shape, and a stricter consolidation would make them unreproducible;
- then **M4**, the retention check, which is a **conjunction and not a count**: **3 of 4 correct**
  (`retentionCheck.passAtLeast`) **and** `P(known) ≥ 0.95` still holding after all four have been
  scored (`retentionCheck.requiresThresholdAtCheck: true`), at least **12 hours** and at least **one
  intervening session** later, items sampled **uniformly across the whole variant pool**, forms from
  `spacing.retentionCheck.forms`, **never hinted**, never θ-targeted.

  Both halves of M4 are load-bearing. The count alone would certify a learner who got the first
  three right and then slipped hard enough on the fourth that the posterior fell back through the
  threshold. The posterior alone would let 2-of-4 through on a favourable prior. `mastery-sim.mjs`
  enforces the conjunction at both of its gates and the numbers in §5.0 are measured on it.

Consolidation, retention and review each carry their own explicit `forms` array. That is redundant
on purpose: these are the three places an engineer working from a checklist reaches for a quick
yes/no confirmation, and they are exactly the surfaces a guesser would farm.

Only `mastered` counts toward the Level 1 mastery percentage. `provisional` unlocks the graph but
buys no credit — that is the whole difference between "I did it" and "I know it".

**Why 3 of 4 and not 3 of 3.** Computed, not guessed (`kp-trace.mjs`):

| | band-3 pass probability |
|---|---|
| learner who genuinely knows it (p = 1 − slip = 0.88) | **0.9268** |
| learner who does not, priced at the model's guess (0.07) | **0.0013** |
| learner who does not, priced at the **true** blind rate of a `construct` item (0.03) | **1.06 × 10⁻⁴** |
| the same check if `judge2` were scored (true rate 0.50) | **0.3125** |

3 of 3 would fail 32% of genuine masters. 3 of 4 fails 7.3%, and those learners lose time, not
credit — a failed check is a lapse and it is re-checked. The separation between knowing and
guessing is 700× in the model's own currency and **8700×** in ground truth. The fourth row is the
one that matters: a retention check served as yes/no questions is passed by a coin about a third of
the time, and no threshold, no spacing and no number of opportunities repairs that. The form list is
the repair.

---

## 3. Spacing

Time is measured in real elapsed time with a session floor, because a browser game is played
irregularly and "next lesson" means nothing here.

| event | when |
|---|---|
| consolidation | +20 min, same session, ≥ 1 intervening knowledge point |
| retention check (M4) | ≥ 12 h **and** ≥ 1 intervening session after `provisional` |
| review 1 | +1 day after `mastered` |
| review 2 | +2 days |
| review 3 | +5 days |
| review 4 | +11 days |
| review 5+ | +24 days, capped at 45 days |

Growth factor **2.2**, between SM-2's 2.5 and a conservative 2.0. A first spaced interval of one day
is where the expanding-retrieval literature puts the optimum for a retention horizon of about a
month, which is what "still knows it at the end of Level 1" means here.

A review is 2 items sampled uniformly from the variant pool, forms from `spacing.review.forms`.

**Lapse handling.** A review whose posterior lands below 0.90, or a failed retention check:

1. the node returns to `learning`, and loses `mastered` (it keeps `everUnlocked`);
2. its M2 counters are docked — `scored −3`, `atBand −2` — so it must re-earn the gate rather than
   walk back through it on one correct answer;
3. the interval ladder resets to the consolidation slot;
4. the learn rate for re-acquisition is boosted: `learn ← min(0.32, 1.6 × learn)`, **but only on a
   node that has genuinely been `mastered` at least once**
   (`spacing.relearnRequiresPriorMastery`). Relearning is faster than learning — savings is one of
   the oldest results in the field — and a model that ignores it makes lapses punishing enough to
   feel unfair. But savings is a property of re-acquiring something you *held*. A failed **first**
   retention check is not a lapse of knowledge; it is a failed first certification, and it earns the
   ordinary rate.

   Both halves of that sentence are load-bearing and neither is decoration. The learn rate sets a
   floor under the all-wrong BKT fixed point (§1.1a). With the boost at the first draft's cap of
   0.45 and no prior-mastery condition, a band-1 node that had failed one retention check sat at a
   floor of 0.489, from which **one** lucky answer reached 0.9704 and cleared M1 — and a bot fails
   its first retention check by definition, so every bot was holding that key. Capping at 0.32 and
   requiring prior mastery costs an honest relearner a few percent of learn rate at bands 1–2 and
   nothing at all at bands 3–5.
5. two lapses on the same node inside 7 days re-enters the teaching sequence at `guided-1`, **not**
   at `model` — do not re-lecture an adult about a sign error — **unless** `P(known)` has fallen
   below **0.30**, at which point the knowledge really has gone and a demonstration is the honest
   response. Round 3 asserted both halves of that in two different sections without the `unless`, so
   an implementer had to pick one; `phases.lapseReentry` now decides it in the JSON.

---

## 4. Item selection

The world asks the engine for the next learning opportunity. The engine answers in this order.

**1 — Due reviews.** Any node whose scheduled event has passed. Most overdue first.
Rate limit: review items may not exceed one third of a session **while acquisition work remains**.
Once the frontier is exhausted, the cap lifts — at that point review *is* the work.

If nothing is due and there is no acquisition work, **pull the soonest scheduled review forward**.
Shortening an interval is always safe. A `provisional` node's retention check still cannot run before
its 12-hour gate, so certification can never be bought with idle time.

### 4.1 Those two rules, measured

They are worth their own section because the simulation is unambiguous about what happens without
them — and because the previous draft got the attribution wrong and said so with a number.
Measured on 800 mixed-ability learners at identical seeds (`mastery-sim.mjs`, section 4.1 block):

| configuration | median learner certifies |
|---|---|
| both rules on (shipped) | **29 of 32** |
| rate-limit lift off, pull-forward on | 29 of 32 |
| rate-limit lift on, pull-forward off | 29 of 32 |
| **both off** | **17 of 32** |

The two rules are **redundant with each other, and jointly load-bearing**: either one alone recovers
the whole 12-knowledge-point difference, and dropping both costs 40% of Level 1 with a third of the
session budget unspent. So P16 must implement at least one, and the honest instruction is to
implement both, because they fail differently — the cap lift covers a learner whose frontier is
genuinely exhausted, and the pull-forward covers a learner whose frontier is momentarily empty
because everything on it is `provisional` and waiting on a clock.

Either way, the finding underneath is the same one, and it is the reason both rules exist: the
bottleneck in a mastery system is not teaching capacity, it is *certification* capacity.

**2 — Continuity.** Stay on the current node for a block of 3 items. Long enough to carry a
model→guided→solo arc, short enough that blocked practice does not manufacture a false sense of
fluency.

**3 — Frontier scoring.** Frontier = nodes whose every direct prerequisite is unlocked and which are
not yet `mastered`. At most **2** nodes may be in `learning` at once; if two already are, the
frontier is restricted to those two.

```
S(kp) = 0.40·Fit + 0.30·Reach + 0.15·Freshness + 0.15·Continuity

Fit        = exp( −(b_kp − (θ − 0.35))² / (2 · 0.7²) )
Reach      = |descendants(kp)| / max |descendants|
Freshness  = 1 − min(1, attempts(kp) / 12)
Continuity = 1 if kp is the node just left, else 0
```

Reach makes the engine prefer nodes that open the graph — `expr-anatomy` gates 29 descendants,
`eval-substitute` 20, `props-equality` 11, and all of them should be reached early. Freshness stops a
learner grinding one node forever when the real blocker is somewhere else.

**4 — Variant within the node.**

- teaching phase first (§6), which constrains the form;
- then difficulty: acquisition pitch or certification pitch (§1.3), nearest available tier;
- then form:

  ```
  form = P(known) < forms.cycleAbove (0.5)
       ? forms.beforeThreshold                       // "construct"
       : forms.order[ scoredCount % forms.order.length ]
  ```

  where `scoredCount` is **this node's cumulative count of scored opportunities so far — the same
  counter M2 reads — evaluated before the current response is scored**
  (`model.forms.cycleIndexedOn: "scoredCount"`). The cycle is a running index into a fixed list; it
  is **never restarted at `construct`** when `P` crosses `cycleAbove`.

  This is arithmetic, not style. The BKT update prices a `generate` item at `guess × 0.6`, so the
  choice changes the posterior: at item 3 of the §5.1 trace the running index serves `generate` and
  `P(known)` comes out **0.9920**, while a restarted cycle serves `construct` and it comes out
  **0.8256** — and nothing after it lines up. Both `kp-trace.mjs` and `mastery-sim.mjs` index on
  `scoredCount`;
- never repeat an exact item id within 40 items;
- **misconception targeting**: if the previous error on this node matched misconception *m*, the next
  item is drawn from variants whose distractor space contains *m*. Retrieval practice against the
  specific wrong idea is what kills it; a fresh unrelated item just lets it survive.

---

## 5. Why 80%+ is the overwhelmingly likely outcome, and why a guesser fails

`node review/p03/mastery-sim.mjs --learners=3000`. Full output in
`review/p03/evidence/mastery-sim.txt`. The run is seeded and deterministic — the same command
reproduces the same numbers byte for byte.

Budget: 18 sessions × 25 min = 576 scored opportunities at 46 s each.

| cohort | n | p10 | median | p90 | share ≥ 80% | peak KPs ever certified |
|---|---|---|---|---|---|---|
| mixed-ability population | 3000 | 65.6% | **93.8%** | 100% | 74.7% | 32 |
| median learner (ability 1.00) | 1500 | 81.3% | **93.8%** | 100% | 92.0% | 32 |
| patient guessing bot | 3000 | 0 | **0** | 0 | 0% | **0** |
| mashing bot | 3000 | 0 | **0** | 0 | 0% | **0** |
| form-hunting bot (served `judge2`/`select4` on every item) | 3000 | 0 | **0** | 0 | 0% | **0** |

The bots draw their responses from `trueGuessByForm`, not from the model's `guess`. That single
change is the difference between this table and the one in the previous draft, and it is the
difference between a measurement and a restatement.

Level 1 is gated by mastery, not by a clock, so the honest question is not "how much in 18 sessions"
but "how long to 80%":

| by session | hours of play | share of the population at ≥ 80% mastery |
|---|---|---|
| 12 | 5.0 | 0.0% |
| 16 | 6.7 | 44.8% |
| 18 | 7.5 | 71.6% |
| 20 | 8.3 | 85.5% |
| 24 | 10.0 | **97.7%** |
| 28 | 11.7 | 99.6% |
| 34 | 14.2 | 100% |

Sessions to 80%: p25 15, **median 17**, p75 19, p90 21. Nobody in 1200 simulated learners failed to
reach 80% eventually.

The 0% floor at session 12 is structural, not motivational, and the arithmetic is short. 80% of
Level 1 is 26 certifications. Each certification costs 6 items that are neither acquisition nor
optional — 2 consolidation and 4 retention — so 156 review items minimum. While acquisition work
remains, review is capped at one third of a session, i.e. 10.7 of 32 items. 156 / 10.7 = **15
sessions before the first learner can possibly be at 80%**, however good they are. On top of that
every one of those 26 retention checks needs a 12-hour gap and an intervening session, so they
cannot be stacked. That is the design working. Speed-running mastery is the thing we are refusing to
sell.

**The four reasons the median learner gets there.**

1. Every item a learner sees is one they have the components for. The frontier only offers nodes
   whose prerequisites are unlocked, so an item is never a wall built of an earlier gap. **That
   sentence is only true if the prerequisites are the right ones**, which is why §0.1 exists and is
   asserted by a lint with a control arm rather than believed: in round 2 this claim was false for
   `like-terms-id`, the node this document uses as its L5 exemplar.
2. Difficulty tracks ability continuously. The acquisition pitch holds success near 0.59; the
   learner is never bored and never drowning.
3. Prerequisite credit means a band-4 item pays down band-2 debt. 34 of the graph's 48 edges hang off
   a band-3-or-harder node, so 71% of the prerequisite structure is working for the learner
   every time they solve something hard.
4. Certification capacity is not rationed once the frontier is exhausted (§4.1), so the last third of
   Level 1 is spent converting `provisional` to `mastered` rather than idling.

### 5.0 Why a guesser does not get there — measured, not assumed

The previous draft argued this from closed form and then "confirmed" it with a simulation whose
bot succeeded at exactly the rate the model already believed guessing was worth
(`correct = rng() < guess`). That is not a test. It is the assumption, restated, wearing a number.

`mastery-sim.mjs` now runs the gate against bots whose success rate comes from
`trueGuessByForm` and never from `guessByForm`, and it serves the selected-response forms on
purpose. To prove the harness can *see* a leak rather than merely fail to find one, it also runs
the round-1 rules — every form scored, an over-cap guess clamped down to `maxGuess` — as a
control arm. If that control does not leak, the harness is measuring nothing and the run fails.

**The isolated gate, one knowledge point (`like-terms-id`, band 2), 20 000 bots per cell.**
Full gate: M1, M2, M3, the 2-item consolidation, M4 at 3-of-4, and revocation at the +1 day review.

| arm | 1 retention try | 2 | 5 | 11 | survives +1 d |
|---|---|---|---|---|---|
| **legacy rules**, bot served `judge2`+`select4` | 13.84% | 25.88% | 51.78% | **79.96%** | 69.52% |
| **legacy rules**, bot served `judge2` only | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| **current rules**, bot served `judge2`+`select4` | 0.00% | 0.00% | 0.00% | **0.00%** | 0.00% |
| **current rules**, bot served the scored forms | 0.00% | 0.01% | 0.01% | **0.03%** | 0.03% |

Read the four rows in order, because each one says something different.

1. **Row 1 is the leak, and it was real.** Under the round-1 rules a coin-flipping bot certified a
   knowledge point 80% of the time given the retries a bored player gets, and 70% of those
   certifications survived the +1 day review. The design's claimed per-node figure was 6.4 × 10⁻⁶.
   Four to five orders of magnitude, on the one number the whole architecture exists to defend.
2. **Row 2 shows M3 was doing real work all along.** `judge2` alone never satisfies "≥ 2 distinct
   forms", so a single-form exploit was already blocked. The hole was `judge2` **plus** `select4` —
   two forms, both coin-adjacent, and M3 counted them.
3. **Row 3 is the fix.** Same hostile item server, same bot, same patience: zero. The engine never
   opens the gate at all, because a form outside `model.forms.scored` produces no BKT update and no
   M2 opportunity. The bot answers 2 200 items and accumulates nothing. Gate ever opened: 0.00%.
4. **Row 4 is the honest residual** — what a blind bot achieves against the legitimate constructed
   forms at their true rates (0.03 / 0.03 / 0.02). 0.03% per knowledge point, and only with
   patience no player has.

**What that patience actually costs**, current rules, scored forms, 11 retention attempts:

| acquisition items per retry | hours grinding one knowledge point | certified |
|---|---|---|
| 12 | 1.7 | **< 0.015%** (0 of 20 000) |
| 40 | 5.6 | 0.005% |
| 100 | 14.1 | 0.015% |
| 200 | 28.1 | 0.035% |
| 400 | 56.2 | 0.035% |

Twelve is not an arbitrary row. It is the design's own `Freshness` cutoff in §4: past twelve
attempts the selector actively pushes the learner off the node. Twelve is the patience a bot inside
the real session loop gets, and there the answer is zero out of twenty thousand.

Which is why the full-session cohorts certify nothing at all: **0 of 3000** patient guessing bots,
**0 of 3000** mashing bots and **0 of 3000** form-hunting bots ever certified a single knowledge
point across 18 sessions. The form-hunting bot answers all 576 items in its budget and the engine
refuses to score every one of them — time spent, nothing bought.

**The closed form, restated in three currencies** (`kp-trace.mjs`, band 3, 3-of-4 retention):

| currency | per-node certification bound |
|---|---|
| the model's own `guess` (0.07) — what round 1 quoted | 6.4 × 10⁻⁶ |
| **true** blind rate of the best scored form (0.03) | **9.5 × 10⁻⁸** |
| true blind rate of a yes/no item (0.50) — if `judge2` were scored | **7.8 × 10⁻²** |

Expected knowledge points certified by guessing across all 32 of Level 1, honest currency:
**3.0 × 10⁻⁶**. The third row is what the number degrades to on any node whose items are served as
closed questions, and it is the reason `model.forms.scored` is a hard list the engine enforces
rather than a paragraph in a design document.

**And the reason every diagnostic signature in the graph is constructed-response.** The item bank
builds items from those signatures. Round 1 wrote three of `like-terms-id`'s misconceptions as
*"are a·x and b·y like terms?"*, and `equivalent-expressions` as *"response == equivalent"* — an
item bank obeying P03's own data would have served both nodes as `judge2`, exactly the surface row 1
prices. They are now a **sort-the-beams-into-weld-stacks partition** over five terms (Bell(5) = 52
possible answers) and a **produce-the-separating-value** construction. `kg-validate.mjs` lints every
signature for closed-question shape and fails the build on one.

**Anti-guessing rules, stated for implementation.**

- Constructed response, and nothing else, in the scored path. `select4` and `judge2` exist as
  unscored world surfaces — a `model`-phase confirmation, a narrative beat — and produce
  `learn:respond { scored: false }`. They cannot satisfy M3, cannot move `P(known)`, and cannot
  appear in a consolidation, retention or review item.
- **Latency floor** = 900 ms + 120 ms per token of the prompt. A response under the floor that is
  **correct** is not scored upward and does not count toward M2. A response under the floor that is
  **wrong** is scored normally. Speed can hurt you and cannot help you.
- Retention checks are uniform over the variant pool, unhinted, and not θ-targeted: there is no easy
  tail to hide in.
- No exact item id repeats within 40 items, and every item is procedurally parameterised, so
  memorising an answer is not a strategy.

### 5.1 Worked trace of one learner through one knowledge point

`node review/p03/kp-trace.mjs` — `eq-two-step`, band 3 (prior 0.18, learn 0.20, slip 0.12,
guess 0.07). Learner enters mid-Level-1 at θ = −0.30. Response pattern W, C, C, W, C, C.

| # | phase | item b | P(correct) | resp | P(known) after | θ after | scored/atBand/forms | form |
|---|---|---|---|---|---|---|---|---|
| 1 | model | −0.60 | 0.5744 | wrong | 0.2220 | −0.50 | 1/0/1 | construct |
| 2 | guided | −0.60 | 0.5247 | ok | 0.8256 | −0.33 | 2/0/1 | construct |
| 3 | solo | −0.60 | 0.5659 | ok | 0.9920 | −0.18 | 3/0/2 | generate |
| 4 | solo | +0.30 | 0.3816 | wrong | 0.9530 | −0.32 | 4/1/2 | construct |
| 5 | guided | +0.30 | 0.3506 | ok | 0.9969 | −0.09 | 5/2/3 | repair |
| 6 | solo | +0.30 | 0.4039 | ok | 0.9999 | +0.12 | 6/3/3 | generate |

**Reproducing the table by hand.** The `form` column is not decoration — it changes the arithmetic.
The BKT update uses `guess = band.guess × guessByForm[form]`, so items 3 and 6 use
**0.07 × 0.6 = 0.042**, not 0.07. Without that, item 3 comes out 0.9868 instead of 0.9920 and
nothing after it lines up.

The form itself comes from §4 step 4, and the indexing rule there is the part you have to get
right: `construct` while `P < 0.5`, then `forms.order[scoredCount % 3]` where `scoredCount` is the
node's **cumulative** scored count before this response — **not** a cycle restarted at `construct`
when `P` crosses 0.5. Item 3 is the item that shows the difference. Entering it, `scored = 2`, so
the running index gives `order[2] = generate` and `P(known)` lands at 0.9920; a restarted cycle
gives `construct` and it lands at **0.8256** instead. Item 6 is the same story: `scored = 5`,
`order[5 % 3] = generate`.

All eighteen numbers in the table follow from those three facts — the per-form guess multiplier, the
`scoredCount` indexing, and §1.2 plus §1.3 — and `kp-trace.mjs` prints them.

Read the mechanism off the table:

- **Item 1** is wrong; P falls to 0.028 on the posterior and the learn transition lifts it to 0.222.
  P(known) < 0.40 on a first encounter, so the director opens with `model`.
- **Item 3** takes P over 0.95 — but the gate does **not** open. M2 wants 6 scored opportunities and
  3 at band, and this learner has 3 and 0.
- **Item 4** is where the certification pitch fires: P ≥ 0.85, so the target jumps from θ − 0.35 to
  band centre + 0.3. The item gets harder, the learner's error matches `inverse-order-inverted`
  ("undoes the addition and then multiplies instead of dividing"), P drops to 0.9530 and θ falls.
  This is the system doing its job — the learner had not shown it at the standard's difficulty yet.
- **Item 5** is drawn from the same misconception's variant pool — a same-trap item, not a fresh one
  — and the phase steps back to `guided` because the previous response was wrong.
- **Item 6** is at band, unscaffolded, clean. After 6 opportunities: P = 0.9999, scored 6, at band 3,
  forms 3. **Gate opens; status becomes `provisional`.**
- Then +20 min consolidation (2 items), then a retention check no sooner than +12 h and not in this
  session. Pass 3 of 4 → `mastered`, ladder starts at +1 day.

Total cost: 6 acquisition + 2 consolidation + 4 retention = **12 scored items**, ≈ 9 minutes at 46 s,
against `estMinutes: 14` for this node — the 5-minute margin is the errors a real learner adds.

A second trace at band 4 (`node review/p03/kp-trace.mjs --kp=ineq-negative-flip`) is in
`review/p03/evidence/kp-trace-ineq-negative-flip.txt`.

---

## 6. Invisible explicit teaching

Explicit teaching happens on every node. It is never announced. There is no modal, no "Lesson 3", no
narrator saying *now let's learn about the distributive property*. The three phases are three
different amounts of help the **world** gives you, and the world does not explain that it is helping.

### 6.1 The three phases, and what each one is worth

A phase is not a presentation choice. It changes the size of the answer space the learner is working
in, which changes what a correct answer is evidence *of*, which changes what the engine is allowed to
do with it. §1.1a runs the four scorability rules over this axis exactly as it runs them over forms,
and the answer comes out of the arithmetic rather than out of preference:

| phase | what the world does | **true blind rate** | seconds | hinted | scored? | counts for M2/M3? |
|---|---|---|---|---|---|---|
| `model` | performs the whole act; you make the last move | **0.70** | 22 | **yes** | **no — inert** | no |
| `guided-1` | places the first step; you do the rest | **0.08** | 34 | no | yes, at `guess × 2.0` | **no** |
| `guided-2` | constrains the answer space to legal moves — illegal parts will not seat | **0.17** | 40 | no | **no — inert** | no |
| `guided-3` | nothing, but a hint surface naming the next move appears after 12 s of no input | **0.85** | 46 | **yes** | **no — inert** | no |
| `solo` | nothing at all | **0.00** (the form's own rate stands) | 46 | no | yes | **yes** |

Read the third column before anything else. `guided-2` is a four-option multiple choice wearing a
workshop — about six parts will seat and the rest fall off, so 1/6 blind. `guided-3` is a hint that
names the next move; reading it and doing what it says works most of the time, which is what makes it
a good hint and what makes it worthless as evidence. Round 3 priced every one of these at
`band.guess × guessByForm[form]` — 0.05 to 0.10 — and counted them toward M2 and M3.

**What that cost, measured.** Under the round-3 rules a bot that idles 12 s on every acquisition
item, reads the hint, types what it says, and answers the retention check blind reached
`provisional` on **35.2%** of runs inside the patience a real player gets (§4's `Freshness` cutoff of
12 attempts). Under these rules it reaches it on **0.00%**. The bot never certified either way — the
retention check is pinned to `solo`/unhinted and it is what stops certification — but M1, M2 and M3
filled on evidence the design's own rule rejects, the certification pitch fired, and the world told
that learner it nearly had it. §5.0 has the table.

**The two policies, and they are different on purpose.**

- **What the *director* chose is inert, in both directions.** `model`, `guided-2` and `guided-3`
  produce no posterior movement up *or* down, no counters, no prerequisite credit, no θ movement, and
  `learn:respond { scored: false }`. A scaffolded item measures learner-plus-scaffold, which is not
  the quantity `P(known)` is about. The symmetry matters: an earlier draft of this round scored the
  *wrong* answers in those phases on the argument that failing a half-done item is strong evidence,
  and it cost the median simulated learner **34 percentage points** of Level 1 mastery, because a
  learner who needs a scaffold is wrong on most scaffolded items and their posterior could then only
  ever fall. **Never punish a learner for being taught.**
- **What the *learner* chose is refused upward only.** A response committed under the latency floor,
  or committed after the learner idled past `antiGuessing.hintSurfaceMs` and read the help, is
  `not-scored-upward`: correct buys nothing, wrong is scored normally. There the item *was* a
  measurement and the help only inflates the correct side of it.

That second rule is why `hintedCorrectPolicy` exists and why `hinted` is a **per-response fact**
rather than a phase name. P16 must set it from what the world actually did on that item. If P18 ever
surfaces help inside `solo` — for an accessibility reason, or by accident — the arm that models that
bug opens the gate on **98.9%** of hint-abusing runs. The flag is the only thing standing between a
UI decision and the mastery gate.

**`model` — the world performs the act and you finish it.**
A construct in the world does the algebra physically, at speed, in front of you; the last move is
missing and you make it. This is a worked example in the Sweller sense, and worked examples beat
unguided problem solving for novices by a margin nobody seriously disputes. What makes it invisible
is that the demonstrator is a thing in the world doing its job, not a tutorial.

Triggered when:
- first encounter with the node **and** `P(known) < 0.40`; **or**
- even the easiest variant is out of reach — `band centre − 0.6 > θ + 0.6` — **and** `P(known) < 0.40`;
  **or**
- two consecutive errors on this node matching the **same** misconception id; **or**
- the node has lapsed twice inside 7 days **and** `P(known) < 0.30` (§3); **or**
- a retreat off the front of the fade ladder.

Hard cap: **2 `model` events per node per session**. Past that the problem is not explanation.

The `P(known) < 0.40` clause on the second trigger is new in round 4 and it is not cosmetic. Without
it the trigger reads only the *global* ability estimate, so a learner who is doing fine on a band-5
node gets re-lectured on it every session merely because θ is still low somewhere else; in simulation
that fired 1.7 model events per node and burned 9% of the session budget on demonstrations nobody
needed.

`model` is the one place `select4` and `judge2` legitimately live: *"the machine just moved the
ballast before the bolts — did it have to?"* is a fine beat immediately after you watched it happen,
and it is worthless as evidence, which is exactly why it is unscored. Both axes agree on that item:
the form is out and the phase is out.

**`guided` — the world constrains what you can do wrong.**
Three fading levels. **`fadeOrder` is listed most-help-first and the words "up" and "down" are banned
from this design**, because round 3 used them and an implementer could read them either way:

```
fadeOrder = [ guided-1, guided-2, guided-3 ]        most help ────────────> least help

correct   → ADVANCE one position; advancing past the last position promotes to `solo`
error     → RETREAT one position, but only after `retreatAfterConsecutiveErrors` (2) consecutive
            errors; retreating before the first position enters `model`, subject to the 2-per-session
            cap, and holds at guided-1 once that budget is spent
shortcut  → `P(known) ≥ 0.75` with the previous response correct promotes to `solo` from anywhere
```

Fading beats abrupt removal: a scaffold that vanishes all at once reproduces the failure it was
preventing. The ladder is entered immediately after a `model` event, or on the first item of a visit
while `P(known) < 0.75`.

**A single error never adds help.** `retreatAfterConsecutiveErrors` is **2**. One wrong answer is
exactly what the `slip` parameter is *for* — 8% to 16% of responses from a learner who genuinely
holds the skill are wrong — and scaffolding a slip is both insulting and expensive: at 1 it cost a
further 3 percentage points of median mastery and produced 3.5 `guided-1` items per node.

**`solo` — the world does nothing.**
Full answer space, no hint surface, no pre-placement. Triggered when `P(known) ≥ 0.75` and the
previous response was correct, or by advancing off the end of the fade ladder. Consolidation,
retention checks and reviews are **always** `solo`, always unhinted, and say so in their own JSON
blocks (`spacing.*.phase`) rather than by inheritance.

**The session is a time box, not an item count.** A scaffolded item does not cost what an
unscaffolded one costs, and charging 46 s for a 22 s demonstration would make the teaching sequence
look twice as expensive as it is. `phases.secondsPerItemByPhase` is the contract: 22 / 34 / 40 / 46 /
46 seconds, and everything outside acquisition is 46 s. The 12 s a hint-abuser spends idling comes
out of that same 46 s, which is part of why idling is expensive rather than free.
### 6.2 Feedback on a wrong answer

Immediate, specific to the misconception, and in-world. Every node carries 2–3 misconceptions with a
`diagnosticSignature` the item bank can evaluate from item parameters and the learner's response. When
a response matches signature *m*:

1. the thing you built **fails in the way that misconception predicts** — a lattice welded from
   `3x + 2y = 5xy` collapses because the two beams were never the same profile, and you watch it
   collapse;
2. `learn:respond` carries `{ correct: false, misconception: m }` so P18, P24 and P25 can respond;
3. the next item on this node is drawn from variants whose distractor space contains *m*;
4. two consecutive same-*m* errors escalate to `model`.

No text panel says "common error". The world's physics is the feedback.

### 6.3 Signals

Existing vocabulary from `design/architecture.md`, no new names:

```
learn:teach    { kpId, phase: "model" | "guided" | "solo" }
learn:present  { itemId, kpId, form }
learn:respond  { itemId, correct, latencyMs, response, form, scored }  + misconception when matched
learn:mastery  { kpId, p, delta }                          on every update
learn:unlock   { kpId }                                    on learning -> provisional
learn:session  { phase, summary }
```

`learn:mastery` should also carry `status` (`learning` | `provisional` | `mastered`) so P24 can draw
the honest three-state picture rather than a single bar. That is an additive field on an existing
signal, not a new signal. Likewise `scored` on `learn:respond`: P24 must not draw progress from an
unscored response, and a reviewer needs to be able to see the form gate firing from outside the
engine. Both are additive fields; no new signal names are introduced.

---

## 7. Standards

`content/standards.json`. 73 codes across four frameworks; 62 are cited by a node, the remaining 11
are registered and verified for P17 to use on individual items.

- **CCSS** — 6.EE, 7.EE, 8.EE, HSA-SSE, HSA-CED, HSA-REI.
- **TEKS** (Texas, 19 TAC ch. 111) — 6.7, 6.9, 6.10, 7.10, 7.11, 8.8, A.5.
- **Florida B.E.S.T.** — MA.6.AR, MA.7.AR, MA.8.AR, MA.912.AR.
- **Virginia SOL 2023** — 6.PFA, 7.PFA, 8.PFA, A.EO, A.EI. Note the 2023 revision renumbered
  everything; the old 6.13 / 7.12 / 8.17 codes are dead and must not be cited.

Three of the four are genuinely non-CCSS frameworks, as required. Every node maps to at least one
code; `kg-validate.mjs` fails if any does not, or if a node cites a code that is not registered.

Per-framework node coverage: CCSS 32/32, Florida 31/32, Virginia 31/32, **TEKS 25/32**. TEKS is the
thinnest deliberately, and the gap is **seven nodes**, all in the two strands where TEKS simply
does not legislate. Named, with the reason for each, because "the framework does not cover it" is a
claim a Texas teacher can check:

| node | why no TEKS code |
|---|---|
| `var-meaning` | TEKS grades 6–8 contain no student expectation about what a variable *is*. The nearest, `TEKS.6.7B`, is *"distinguish between expressions and equations verbally, numerically, and algebraically"* — a different act, and it hangs on `eq-meaning`, where it belongs |
| `expr-anatomy` | no TEKS SE names the *parts* of an expression — term, coefficient, constant, factor. `TEKS.6.7D` is about generating equivalent expressions using the properties of operations, which is `props-operations` |
| `eval-substitute` | TEKS has no "evaluate an expression for a given value of the variable" SE in grades 6–8. Its two nearest, `TEKS.6.10B` and `TEKS.7.11B`, are *"determine if the given value(s) make(s) one-variable … equations or inequalities true"* — substitution into an **equation** to test a candidate solution, which answers true/false, not a value. `TEKS.6.10B` is already tagged on `eq-meaning`, which is the node that actually does that. TEKS's own evaluation expectation arrives in Algebra I expressed in **function notation** (`A.12B`), which Level 1 does not reach and therefore does not tag |
| `eval-signed` | same hole, plus the signed arithmetic itself, which TEKS files under Number and Operations in grade 6 rather than under Expressions, Equations and Relationships — a different strand from the one this graph maps to |
| `eval-formula` | TEKS attaches formula work to the particular figure inside its geometry and measurement strands, never as a general "evaluate a formula in two variables" expectation in the algebra strand |
| `translate-phrase` | every TEKS *writing* expectation is equation-shaped or inequality-shaped, never expression-shaped: `6.9A`, `7.10A` and `8.8A` all read *"write one-variable … equations and inequalities"*. Words into an **expression** has no TEKS home |
| `translate-order` | same reason, and this node's whole content — the order-reversing phrase, *"five less than n"* — is a level of detail no TEKS SE reaches |

Padding these with the nearest adjacent code would make the mapping worthless for anyone actually
teaching to TEKS, which is the only reason to publish a mapping at all. All seven are covered by
CCSS and by Florida; six of the seven are covered by Virginia (`expr-anatomy` is the exception, and
it is also the one node Virginia's 2023 revision leaves uncovered). The other two per-framework
holes are single nodes and are named here for the same reason: Florida does not cover `oo-structure`
and Virginia does not cover `expr-anatomy`. `kg-validate.mjs` prints per-framework coverage on every
run, so these four counts cannot drift away from this paragraph unnoticed.

Each code carries a `verification` marker: `verbatim-checked` (full text retrieved from a primary or
authoritative source during compilation), `stem-checked` (opening clause retrieved, remaining clause
reproduced from the published standard and consistent with every source consulted), or
`NEEDS_VERIFICATION`. **There are currently zero codes marked `NEEDS_VERIFICATION`** — nothing here is
guessed. 58 are `verbatim-checked` and 15 are `stem-checked`; the latter should be re-confirmed
against the issuing authority's PDF before any learner-facing surface prints standard text verbatim.
`kg-validate.mjs` prints the `NEEDS_VERIFICATION` list on every run so it cannot drift unnoticed.

---

## 7.1 Localization contract (for P20)

Every learner-facing string in `knowledge-graph.json` is **EN source text for a locale key**, not the
string that ships. Key shape:

```
kp.<id>.title          kp.<id>.short          kp.<id>.description
kp.<id>.hook           misconception.<id>.description
```

ES and PL must localise the **mathematics**, not only the words:

- decimal comma, not decimal point, in both ES and PL;
- multiplication as a centre dot, not a cross;
- `translate-order` is the node most at risk. "Five less than n" survives translation only if the
  translator re-derives the *order-reversing* phrase in the target language — Spanish
  "cinco menos que n" and Polish "o pięć mniej niż n" reverse differently from English. A literal
  translation destroys the knowledge point. The same applies to `divided into` in `translate-order`
  and to every keyword misconception in `translate-phrase`;
- variable letters: `n` for "a number" is an English convention. ES commonly uses `n`, PL commonly
  uses `x` or `n`; pick per locale and keep it consistent inside an item family.

Two nodes — `translate-phrase` and `translate-order` — need per-locale **item generators**, not
per-locale strings, because the misconception space itself is language-specific. That is a P17/P20
dependency, and it is the single largest localization risk in Level 1.

---

## 8. What P16 has to build

A conformance checklist. Each line is checkable.

1. Load `content/knowledge-graph.json`; read all parameters from `model`. No duplicated constants.
2. Per-node state: `{ p, status, everUnlocked, everMastered, scored, atBand, forms, consolidated, ladder, lapses, nextEventAt, provisionalAt, relearn }`.
3. Per-learner state: `{ theta, responses }`.
4. BKT update with credit weight, §1.2. **Do not clamp.** On load, assert the identifiability caps
   and *reject* any form that violates them (`identifiabilityCaps.onFormExceedingCaps`); a clamp is
   the leak §5.0 measures at 80%.
5. **The form gate, and treat it as the first thing you write, not the last.**
   - `model.forms.scored` decides whether an item produces a BKT update **at all**. An item in any
     other form is answered in the world and then discarded by the engine: no posterior, no
     counters, no prerequisite credit, no θ movement. Emit `learn:respond { scored: false }`.
   - `model.bkt.formsEligibleForMastery` decides what M2 and M3 may count. Never infer it from
     `forms.order`.
   - Consolidation, retention and review draw forms from their own arrays in `model.spacing`.
     Never hard-code `"construct"`, and never let a caller pass a form into these three.
   - A unit test that serves the engine a `judge2` item and asserts `scored`, `atBand`, `forms.size`
     and `p` are all **unchanged** is the single highest-value test in P16.
   - Acquisition form selection is `forms.order[scoredCount % 3]` above `forms.cycleAbove`, indexed
     on the node's **cumulative** scored count (`model.forms.cycleIndexedOn: "scoredCount"`). Do not
     restart the cycle when `P` crosses the threshold: §5.1 item 3 is 0.9920 with the running index
     and 0.8256 without it.
6. Gate M1–M5 exactly as §2, including the M2 counter dock on lapse. Two fields decide the shape of
   the gate and both are in the JSON: `spacing.consolidation.passAtLeast` is **0** (consolidation is
   a practice pass, not a second gate — do not invent a score requirement there), and
   `spacing.retentionCheck.requiresThresholdAtCheck` is **true** (M4 is `right ≥ passAtLeast` **and**
   `P(known) ≥ masteryThreshold`, evaluated after all four items have been scored).
7. Spacing ladder and lapse handling exactly as §3, **including `relearnRequiresPriorMastery`**: the
   learn-rate boost applies only to a node that has previously been `mastered`. Skipping that line
   raises the all-wrong BKT floor far enough that one lucky answer clears M1 (§1.1a).
8. Selection pipeline exactly as §4, **including** the rate-limit lift on an exhausted frontier and
   the pull-forward rule. They are redundant with each other and jointly worth 12 knowledge points;
   dropping both costs 40% of Level 1. Numbers in §4.1.
9. Two pitches, §1.3. Do not ship acquisition pitch alone — the sim shows what that costs.
10. Emit the signals in §6.3, one per update, cheap and JSON-safe.
11. Publish a probe named `mastery`:
    `{ theta, unlocked, learning, provisional, mastered, level1Percent, dueNow, inFlight[], unscoredItems }`.
    `unscoredItems` exists so a reviewer can see the form gate firing from outside.
12. Determinism: given a seed and a response sequence, every value above must reproduce exactly.
    `review.mjs probe --name=mastery` after a fixed script must be byte-identical across runs.
13. Run `node review/p03/kg-validate.mjs` in CI on the content file. It exits non-zero on a cycle, a
    redundant edge, a band inversion, an unmapped node, a leaked closed-question signature, a form
    scorability drift, an under-specified gate field, **and on a concept-closure gap (§0.1)** — the
    class of error that reaches a learner as an item they had no way to answer.

**Conformance target.** Re-running `review/p03/mastery-sim.mjs` against the real engine (same
parameters, same gate, same schedule, same RNG discipline) must land inside these bands:

| metric | target |
|---|---|
| median learner, mastered % at 18 sessions | 90–96% |
| mixed population, share ≥ 80% at 24 sessions | ≥ 95% |
| retention check pass rate, real learners | 85–92% |
| patient guessing bot, mean KPs certified | < 0.01 of 32 |
| **bot served `judge2`/`select4` on every item, KPs certified** | **exactly 0, and `scored` must never increment** |
| median scored opportunities to 80% mastery | 480–600 |

---

## 9. Known gaps

Stated rather than hidden.

- **Parameters are assigned, not fitted.** Band-level BKT parameters are argued from the literature
  and from step count, not from this game's telemetry, which does not exist yet. First real cohort,
  refit per node and update `model.bands`. The gate is deliberately conservative enough that a
  mis-set prior costs items rather than credit.
- **`worldHook` nouns are provisional.** `design/world.md` (P01) did not exist when this was written.
  The *verbs* are the contract — grip, weld, cut, pour, invert, strip, cross — and they are chosen to
  survive whatever nouns P01 lands on. The nouns should be reconciled in a later round.
- **15 standards codes are `stem-checked`, not `verbatim-checked`**: `CCSS.6.EE.A.2a`,
  `CCSS.6.EE.A.2b`, `CCSS.6.EE.A.4`, `CCSS.6.EE.B.5`, `CCSS.6.EE.B.6`, `CCSS.6.EE.B.8`,
  `CCSS.7.EE.A.2`, `CCSS.7.EE.B.3`, `CCSS.7.EE.B.4`, `CCSS.7.EE.B.4b`, `CCSS.HSA-SSE.A.2`,
  `CCSS.HSA-CED.A.3`, `FL.MA.7.AR.2.1`, `FL.MA.8.AR.2.2`, `FL.MA.912.AR.1.1`. The opening clause of
  each was retrieved; the trailing clause was reproduced from the published standard and matched
  every secondary source consulted. Accurate enough to tag content, not yet good enough to print
  verbatim to a learner — re-confirm against the issuing authority's PDF first.
  `thecorestandards.org` and `fldoe.org` both served HTTP 403 to the compilation run, which is why
  those 15 stopped at stem level.
- **The simulation's item model is a model.** Assumptions A1–A8 are listed at the top of
  `mastery-sim.mjs`. The one most likely to flatter the design is A3 (which items pay prerequisite
  credit). If P17's real items exercise fewer prerequisites than assumed, the item budget tightens
  and the session count in §5 moves right.
- **`trueGuessByForm` is arithmetic over an answer space P17 has not built yet.** `construct` at
  0.03 assumes a numeric slot accepting the integers in [−20, 20]; `repair` at 0.03 assumes about
  six candidate joints with no signposting; `generate` at 0.02 assumes the named property is
  actually checked. **If P17 ships a form with a smaller answer space than that, this table is the
  first thing that has to change, and §5.0 has to be re-run.** Two specific tripwires: a numeric
  slot that only accepts 1–10 is worth 0.10, not 0.03; and a `repair` item that highlights the
  broken joint is worth 0.17 or more, which fails conservatism at bands 1–3 exactly the way
  `select4` does. P17 owes P03 a measured blind-success rate per generator family before the item
  bank is considered done.
- **The residual 0.025% is real, and it is per node, not per learner.** At absurd patience — 2 200
  items on one knowledge point, 28 hours — a blind bot certifies `like-terms-id` 5 times in 20 000.
  In the real session loop the `Freshness` term pushes a learner off a node after 12 attempts and
  the measured rate there is 0 of 20 000 (95% upper bound 0.015%), but the residual is not
  structurally zero and claiming it is would be the same kind of overclaim this round exists to fix.
- **The concept-closure lint is a token lint, not a prover.** §0.1 checks four declared concepts by
  pattern-matching misconception text. It cannot see a prerequisite a misconception needs but never
  names — a signature that says "the learner rebuilds the stem" is invisible to it. It is a floor
  under the class of error that shipped in round 2, not a proof that no such error remains. Two
  things follow. First, **the table grows when P17 writes items**: the moment an item generator
  needs a concept the signature does not spell out, that concept goes in the table. Second, when a
  node's items and its prerequisites disagree, **the prerequisites are what move** — weakening a
  pattern to make the lint quiet is the failure mode this whole section exists to prevent, which is
  why the check keeps a control arm that fails the build if it stops detecting the round-2 gaps.
- **No affect model.** Frustration, boredom and gaming-the-system are modelled only through the
  latency floor and the acquisition pitch. A real detector belongs in a later level.
- **`estMinutes` is scored-item time only.** It excludes traversal, narrative and review-inside-later-
  nodes. P27 should not budget a session from these numbers directly; budget from §5.
