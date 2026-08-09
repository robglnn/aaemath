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
| `node review/p03/kg-validate.mjs` | the graph is a DAG, transitively reduced, fully standards-mapped, band-monotone, its misconceptions are separable and constructed-response, and its scorable form set is what the identifiability caps actually derive | `review/p03/evidence/kg-validate.txt` |
| `node review/p03/kp-trace.mjs` | the worked numeric trace, closed form, no randomness; and the per-form guessing arithmetic in both the model's currency and ground truth | `review/p03/evidence/kp-trace-eq-two-step.txt` |
| `node review/p03/mastery-sim.mjs` | L4 (median learner ≥ 80%) and L5 (a guesser fails), the latter against bots whose true success rate is **independent of the model's guess parameter** | `review/p03/evidence/mastery-sim.txt` |

---

## 0. The shape of the thing

32 knowledge points, 48 prerequisite edges, two roots (`var-meaning`, `oo-numeric`), four leaves,
longest prerequisite chain 11 nodes. 354 minutes of scored-item time. Five strands:
reading and running an expression, words into algebra, rewriting without changing meaning, claims
you can solve, claims with room in them.

The prerequisite relation is **acyclic** and **transitively reduced**. Reduction is not cosmetic: the
frontier rule below reads "all direct prerequisites unlocked", and a redundant edge would make that
rule silently stricter than it looks. `kg-validate.mjs` fails the build if either property breaks.

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
*for* mastery. **The caps are a rejection test on a form, never a clamp on an observed rate.**
Clamping is specifically forbidden (`identifiabilityCaps.clampTrueRates: false`), because clamping a
yes/no item's real 0.50 down to 0.30 is precisely how a mastery gate gets handed to a coin: every
correct flip then moves `P(known)` further than the evidence supports, and it compounds.

**The floor nobody looks at.** `learn` puts a floor under the all-wrong BKT fixed point — a
responder who is never right still drifts upward, and the higher the learn rate the higher the
floor. Assert, at every band and in both learn-rate states, that **two** consecutive correct answers
are needed from that floor to clear 0.95:

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
- **M3** ≥ 2 distinct item **forms**, counted **only over
  `model.bkt.formsEligibleForMastery = [construct, repair, generate]`**. One exploitable interface
  affordance is not a skill — and the reason this reads as an explicit array in the JSON rather than
  a sentence in this document is that the first draft said it only in prose. An engineer
  implementing §8 faithfully would have satisfied M3 with `judge2` + `select4`, which is two forms
  and two coin flips.
- **M5** no opportunity in the qualifying window scored upward from a sub-latency-floor response.

**M0, implied by all of the above and worth its own line.** Only a scored form produces a BKT
update at all. An item arriving in `judge2` or `select4` — which is what happens when an item bank
reads a closed question in a diagnostic signature and builds it literally — is answered, is
responded to in the world, and is then **discarded by the engine**. It does not move `P(known)`, it
does not increment `scored`, `atBand` or the form set, and it does not pay prerequisite credit.

**`provisional` → `mastered` requires:**

- a **consolidation pass** at +20 minutes in the same session: 2 items, unscaffolded, at band
  centre, forms from `spacing.consolidation.forms`;
- then **M4**, the retention check: **3 of 4 correct**, at least **12 hours** and at least **one
  intervening session** later, items sampled **uniformly across the whole variant pool**, forms from
  `spacing.retentionCheck.forms`, **never hinted**, never θ-targeted.

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
5. two lapses on the same node inside 7 days re-enters the teaching sequence at `guided`, **not** at
   `model`. Do not re-lecture an adult about a sign error.

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
- then form: `construct` while `P < 0.5`, then cycling `construct → repair → generate`;
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
| mixed-ability population | 3000 | 65.6% | **93.8%** | 100% | 74.9% | 32 |
| median learner (ability 1.00) | 1500 | 81.3% | **93.8%** | 100% | 92.2% | 32 |
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
| 16 | 6.7 | 45.9% |
| 18 | 7.5 | 71.9% |
| 20 | 8.3 | 86.3% |
| 24 | 10.0 | **98.0%** |
| 28 | 11.7 | 99.8% |
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
   whose prerequisites are unlocked, so an item is never a wall built of an earlier gap.
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
nothing after it lines up. The form itself is chosen by the rule in §4: `construct` while
`P < 0.5`, then cycling `construct → repair → generate` on the scored count. All eighteen numbers
in the table follow from those two facts plus §1.2 and §1.3, and `kp-trace.mjs` prints them.

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

### 6.1 The three phases

**`model` — the world performs the act and you finish it.**
A construct in the world does the algebra physically, at speed, in front of you; the last move is
missing and you make it. This is a worked example in the Sweller sense, and worked examples beat
unguided problem solving for novices by a margin nobody seriously disputes. What makes it invisible
is that the demonstrator is a thing in the world doing its job, not a tutorial.

Triggered when:
- first encounter with the node **and** `P(known) < 0.40`; **or**
- even the easiest variant is out of reach — `band centre − 0.6 > θ + 0.6` — so the learner would fail
  the gentlest item available; **or**
- two consecutive errors on this node matching the **same** misconception id; **or**
- the node has lapsed twice inside 7 days **and** `P(known) < 0.30`.

Hard cap: **2 `model` events per node per session**. Past that the problem is not explanation.

`model` is the one place `select4` and `judge2` legitimately live: *"the machine just moved the
ballast before the bolts — did it have to?"* is a fine beat immediately after you watched it happen,
and it is worthless as evidence, which is exactly why it is unscored. It emits
`learn:respond { scored: false }` and touches nothing in §2.

**`guided` — the world constrains what you can do wrong.**
Three fading levels, stepping **down** one level per correct response and **up** one per error:

| level | scaffold |
|---|---|
| guided-1 | the first step is already placed; you do the rest |
| guided-2 | the answer space is constrained to legal moves — illegal parts will not seat |
| guided-3 | no constraint, but a hint surface appears after 12 s of no input |

Fading beats abrupt removal: a scaffold that vanishes all at once reproduces the failure it was
preventing. Triggered immediately after a `model` event, or when `0.40 ≤ P(known) < 0.75`, or when
the previous response on this node was wrong.

**`solo` — the world does nothing.**
Full answer space, no hint surface, no pre-placement. Triggered when `P(known) ≥ 0.75` and the
previous response was correct. Consolidation, retention checks and reviews are **always** `solo`.

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
thinnest deliberately. TEKS grade 6 has no standard about the *parts* of an expression — terms,
coefficients, constants — and none about what a variable is on its own; `TEKS.6.7B` is
*"distinguish between expressions and equations verbally, numerically, and algebraically"*, which is
neither of those things and now hangs on `eq-meaning`, where it belongs. Two nodes carrying no TEKS
code is the honest reading of a framework that does not cover them, and padding it with the nearest
adjacent code would make the mapping worthless for anyone actually teaching to TEKS.

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
6. Gate M1–M5 exactly as §2, including the M2 counter dock on lapse.
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
- **No affect model.** Frustration, boredom and gaming-the-system are modelled only through the
  latency floor and the acquisition pitch. A real detector belongs in a later level.
- **`estMinutes` is scored-item time only.** It excludes traversal, narrative and review-inside-later-
  nodes. P27 should not budget a session from these numbers directly; budget from §5.
