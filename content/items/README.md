# content/items — the item bank

Owned by **P17**. Serves `app/src/learn/ItemBank.js`, which serves P16's mastery engine and P18's
teaching director. Nothing here renders anything; nothing here knows what a frame is.

Run the audit before you believe any sentence below:

```bash
node review/measure/P17.mjs            # 22 claims, PASS/FAIL against stated thresholds
node review/measure/P17.mjs --json     # the same, machine-readable
node content/items/build-catalogue.mjs --per-kp=36   # rebuild the committed bank
```

---

## What is here

| file | what it is |
|---|---|
| `kit.mjs` | exact rationals, a small algebra parser, canonical forms, TeX builders. Shared by the generators and by the answer checker, so a stem that cannot be read back is a build failure. |
| `generators.mjs` | 60 parameterised stem families across the 32 knowledge points, the misconception responses each stem can discriminate, and the separation filter. |
| `strings.json` | every learner-facing string, in EN / ES / PL. Items carry `{ key, params }`; this is what those keys resolve to. |
| `build-catalogue.mjs` | materialises the committed bank. Deterministic in its seed. |
| `bank/<kpId>.json` | 32 files, 36 items each, the reviewable artefact. Read these. |
| `index.json` | counts per knowledge point, per form, per misconception. |
| `index.mjs` | **generated.** The same data inlined as one ESM module, which is what the app and the offline simulations import. |

**1152 committed items. 32 knowledge points. 36 items each.** Plus generators that never run dry.

## The shape of an item

```json
{
  "id": "eq-two-step.core/construct/gv0zhs",
  "kpId": "eq-two-step",  "family": "eq-two-step.core",
  "form": "construct",    "difficulty": 2,  "tier": "easy",
  "objectClass": "Span",
  "stem": "5x + 1 = 21",  "given": [],
  "ask":  { "key": "ask.value", "params": {…}, "text": "Close it." },
  "answerType": "rational",  "unknown": "x",
  "answer": { "canonical": "4", "tex": "4" },
  "distractors": [
    { "misconception": "divide-before-clearing-constant", "response": "16/5",
      "tex": "\\frac{16}{5}", "failKey": "fail.partial.divide" }, …
  ],
  "hints": [ { "key": "hint.look.Span", "params": {}, "text": "…" }, …3 rungs… ],
  "worldFraming": { "key": "frame.eq-two-step.1", "params": {}, "text": "…" },
  "standards": ["CCSS.7.EE.B.4a", …],
  "params": { "a": 5, "b": 1, "c": 21 }
}
```

`text` is an English snapshot for whoever opens the file. It is not a second source of truth —
C18 fails the build if a snapshot and `strings.json` ever disagree.

## Forms

`model.forms.scored` admits three, and every knowledge point carries all three.

- **construct** — build the value, the load, the claim, the mark, the partition.
- **repair** — a working is shown with one joint broken by a named misconception. Name the line
  and write what it should read. Both halves are required; the line number alone is not accepted.
- **generate** — produce a case with a declared property, which is *checked* rather than compared.
  Nine property kinds: `claimClosesAt`, `loadGathersTo`, `loadAuthor`, `loadReadsAt`, `loadShape`,
  `markAdmits`, `partitionWitness`, `namesDiffer`, and the reshape variant of `loadGathersTo`.

`select4` / `judge2` are **not generated**. `model.forms.unscored` allows them only inside a
`model` phase, and an item bank that can emit them is an item bank that will eventually emit one
into the scored path.

## Difficulty

Three tiers per family — `easy`, `core`, `stretch` — mapping to the node's band minus one, the
band, and the band plus one, clamped to 1–5. `ItemBank.select({difficulty})` narrows on the exact
band, then the nearest, then any. **The form is never relaxed**, because `model.forms.scored`
decides whether an item scores at all.

## What the answer checker accepts

Exhaustive, and asserted item by item in C13/C14. Everything is compared in exact rationals; no
response is ever decided in floating point.

| answer type | accepted |
|---|---|
| numeric | `4` · `x = 4` · `4 = x` · `4.0` · `4,0` (ES/PL decimal comma) · `+4` · `8/2` · `\frac{8}{2}` · leading/trailing space · unicode minus `−4` |
| expression | any spelling of the same load: `2x+6` · `6 + 2x` · `2\cdot x + 6` · `2*x+6` · `2 x + 6` · `3(x+2)` · `x^{2}` or `x^2` or `x^-1` |
| equation | either pan first: `a = 3b` ≡ `3b = a` ≡ `a - 3b = 0` |
| inequality | either direction: `x > 3` ≡ `3 < x`; `\ge` · `>=` · `≥` |
| pair | `x=4; y=4` in any order, `;` or `,` separated |
| partition | groups separated by `|` or `;` or `\mid`, terms by `,`, both order-free |
| value set | `4, 7, -2` in any order, `,` `;` or space separated |
| closure | a value, or a word for *an always* / *a refusal* in **any** of the three locales (`always`/`siempre`/`zawsze`, `none`/`ninguno`/`żaden`), accents and Polish ł folded |
| repair | `3: x = 5` · `#3 x = 5` · `line 3 = x = 5` · `3 \| x = 5`. The corrected line is read as a claim, a mark, a load or a chained equality — whichever it is |
| construction (`generate`) | anything satisfying the declared property, checked |

**One documented asymmetry.** Inside a *list* a comma is a separator, never a decimal mark:
`4,7,-2` is three charges. Where a *single* value is expected, `4,5` is four-and-a-half. A list and
a decimal cannot both own the comma, and guessing which a learner meant is how a right answer gets
lost. Non-integer values inside a list are written as fractions.

`simplify-expression` additionally requires the response to be **gathered**: an answer that is
equivalent but still carries two like terms is marked wrong and diagnosed as
`stops-before-fully-simplified`, because that misconception is about the surface and canonical
equality cannot see it.

## Distractors and misconceptions

Every distractor is the response a named misconception from `content/knowledge-graph.json`
actually produces, recomputed in `review/measure/P17.mjs` from the `diagnosticSignature` text
rather than from the generator (C4: **825 of 825 re-derived, 0 mismatches**).

Four rules are enforced when a stem is drawn, not hoped for:

1. **DISCRIMINATING** — every declared misconception differs from the correct response.
2. **PAIRWISE-SEPARATED** — no two collapse onto the same response. A stem that violates this is
   rejected, never patched. Measured cost, worst family `eq-combine-side.core` at **13.5%** of
   drawn stems (build threshold is 25%).
3. **EXACT** — rational arithmetic throughout.
4. **READABLE-BACK** — every TeX string this bank authors is parsed back by `kit.mjs`.

A misconception whose two readings collapse on a stem is not served on that stem. `like-terms-id`
is the worked case: on an all-`x` stem, "all variable terms are alike" and "the power does not
matter" are the *same* response, so that stem declares only one of them and the `xy` stem carries
the other.

## Items per knowledge point

36 committed each, and the generator behind them is unbounded. The three misconception columns are
the graph's three, in `knowledge-graph.json` order.

| knowledge point | band | class | items | c/r/g | items per misconception |
|---|---|---|---|---|---|
| `var-meaning` | 1 | Emitter | 36 | 14/17/5 | 11 / 9 / 16 |
| `oo-numeric` | 1 | Bearer | 36 | 15/16/5 | 12 / 8 / 11 |
| `expr-anatomy` | 1 | Bearer | 36 | 16/15/5 | 11 / 10 / 10 |
| `oo-structure` | 2 | Aperture | 36 | 14/10/12 | 8 / 9 / 7 |
| `eval-substitute` | 2 | Emitter | 36 | 13/12/11 | 9 / 8 / 8 |
| `eval-signed` | 3 | Emitter | 36 | 12/13/11 | 7 / 9 / 9 |
| `eval-formula` | 3 | Span | 36 | 13/13/10 | 26 / 26 / 26 |
| `translate-phrase` | 2 | Vessel | 36 | 13/16/7 | 14 / 29 / 15 |
| `translate-order` | 3 | Threshold | 36 | 17/14/5 | 10 / 10 / 11 |
| `props-operations` | 2 | Bearer | 36 | 12/12/12 | 8 / 8 / 8 |
| `like-terms-id` | 2 | Bearer | 36 | 12/12/12 | 24 / 24 / 12 |
| `like-terms-combine` | 3 | Bearer | 36 | 12/12/12 | 24 / 24 / 24 |
| `distribute-numeric` | 2 | Aperture | 36 | 15/14/7 | 15 / 15 / 14 |
| `distribute-variable` | 3 | Aperture | 36 | 12/12/12 | 24 / 24 / 24 |
| `distribute-negative` | 4 | Aperture | 36 | 16/13/7 | 29 / 29 / 15 |
| `simplify-expression` | 4 | Span | 36 | 12/13/11 | 16 / 21 / 12 |
| `equivalent-expressions` | 4 | Span | 36 | 11/13/12 | 36 / 12 / 12 |
| `eq-meaning` | 2 | Span | 36 | 12/12/12 | 12 / 21 / 3 |
| `props-equality` | 2 | Vessel | 36 | 15/14/7 | 16 / 16 / 13 |
| `eq-one-add` | 2 | Span | 36 | 13/16/7 | 15 / 15 / 14 |
| `eq-one-mult` | 2 | Bearer | 36 | 15/14/7 | 13 / 13 / 16 |
| `eq-two-step` | 3 | Span | 36 | 11/13/12 | 17 / 18 / 17 |
| `eq-combine-side` | 4 | Bearer | 36 | 10/12/14 | 22 / 22 / 22 |
| `eq-distribute` | 4 | Aperture | 36 | 12/12/12 | 22 / 22 / 14 |
| `eq-both-sides` | 4 | Vessel | 36 | 10/14/12 | 24 / 24 / 24 |
| `eq-special-cases` | 5 | Span | 36 | 16/7/13 | 23 / 8 / 8 |
| `translate-sentence` | 3 | Span | 36 | 12/11/13 | 23 / 23 / 23 |
| `eq-model-context` | 5 | Span | 36 | 15/14/7 | 9 / 27 / 14 |
| `ineq-meaning` | 2 | Threshold | 36 | 14/12/10 | 26 / 26 / 14 |
| `ineq-one-step` | 3 | Threshold | 36 | 16/13/7 | 14 / 16 / 15 |
| `ineq-negative-flip` | 4 | Threshold | 36 | 15/14/7 | 15 / 15 / 14 |
| `ineq-two-step` | 5 | Threshold | 36 | 15/14/7 | 11 / 21 / 12 |

**Never repeats inside a session, measured**: 80 consecutive draws on a single knowledge point,
for all 32 of them, produce 80 distinct item ids — the catalogue first, then generated items — and
none runs dry (C16). A 25-minute session is about 32 items *in total*, and §4's `Freshness` term
caps a node at 12 attempts, so 80 is well past anything a session can ask for.

**Targeted retrieval never repeats either**: for all 96 (knowledge point × misconception) pairs the
selector can serve 12 distinct items carrying that misconception (C2b). A targeted request is
exhausted — catalogue *and* generator — before the target is dropped, because an engine that
quietly serves an untargeted item has stopped doing what §4 asked while still reporting that it did.

## Localization

Every learner-facing string exists in EN, ES and PL — 281 keys, no English fallback anywhere (C10).
Items never carry a sentence; they carry a key and parameters.

Lexicon decisions this piece made, for P20 and P01 to adopt or overrule (all from `design/world.md`
§4 and `design/voice.md` §8):

| EN | ES | PL | why |
|---|---|---|---|
| the Sill | el Umbral | Próg | a doorsill you step over |
| a Threshold *(object class)* | el arco | łuk | kept distinct from the Sill, which in EN is a different word already |
| a pan | el platillo | szalka | the pan of a balance |
| a socket | el encaje | gniazdo | what a bolt seats into |
| a load | la carga | ładunek | what is on a pallet |
| a bundle | el fardo | wiązka | tied with string |
| a ward | el guarda | przegroda | the locksmith's word |
| a detent | el trinquete | zapadka | the machinist's word |
| a mark | la marca | znacznik | a painted line on a gate |
| a stretch | el tramo | odcinek | what a threshold admits |
| to seat | asentar | osadzić | what you do to a bolt |
| a count | la cuenta | krotność | stamped on the collar |
| a span *(bridge)* | el vano | przęsło | |
| a deck | el tablero | pomost | |
| a certainty | la certeza | pewnik | |

The **translation strand** is the localization risk `learning-architecture.md` §7.1 names, and it is
handled with per-locale *phrasings*, not per-locale translations of an English phrase. Each spoken
line was re-derived in the target language so that the order-reversal the node teaches actually
happens there:

| shape | EN | ES | PL |
|---|---|---|---|
| `lessthan` | "{a} less than the count you are holding" | "{a} menos que la cuenta que llevas" | "o {a} mniej niż liczba, którą trzymasz" |
| `subtractfrom` | "Take your count off {a}" | "Resta tu cuenta de {a}" | "Odejmij swoją liczbę od {a}" |
| `dividedinto` | "How many times does your count go into {a}" | "Cuántas veces cabe tu cuenta en {a}" | "Ile razy twoja liczba mieści się w {a}" |

All three reverse in all three languages, which is the property the misconception depends on. A
literal translation of the English would have destroyed the knowledge point in ES and PL.

Numbers: integers and fractions render identically in all three locales, so no decimal mark appears
in any hint. Where one ever does, `ItemBank.text()` writes a comma in ES and PL.

## Voice

`design/voice.md` §1's banned vocabulary is checked mechanically over every string in every locale
(C11: **0 hits**), in English, Spanish and Polish, with accents and `ł` folded so *ecuación* and
*równanie* are caught by the same test as *equation*.

Failure lines reuse the sixteen rows of `design/voice.md` §4 verbatim. Twenty more were added,
which §4 explicitly asks item authors to do rather than inventing phrasings at the call site. They
are listed in the P17 handoff for the voice owner to adopt or replace:

`fail.label` · `fail.twin` · `fail.seat.wrongvalue` · `fail.seat.wrongsocket` · `fail.term.count` ·
`fail.kind.changed` · `fail.said.flat` · `fail.said.nosocket` · `fail.said.order` ·
`fail.said.wrongquantity` · `fail.deck.onevalue` · `fail.deck.shape` · `fail.sill.chain` ·
`fail.sill.missing` · `fail.sill.zero` · `fail.socket.gone` · `fail.always` · `fail.refusal` ·
`fail.mark.side` · `fail.viable`

**The faded ladder.** Every item carries exactly three rungs, and no rung ever prints the value
being asked for (C12: 3456 rungs, 0 leaks):

1. **look** — orients you in the class of object and names no move. One per object class, six total.
2. **move** — names the next act and no number. Per family.
3. **state** — where the load has got to, one step short of the value. Per family.

A stem whose hint template would print its own answer is refused at generation. Which parameters
each string prints is tracked in `generators.mjs`'s `HINT_PRINTS`, regenerated from `strings.json`
and asserted against it (C21), so the filter cannot go stale.

## Blind-success rates, measured

`learning-architecture.md` §9 asks P17 for these before the bank is trusted, because
`model.trueGuessByForm` is arithmetic over an answer space P17 had not built yet. A bot with no
knowledge, given the shapes a response can take, over the whole committed bank:

| form | measured | priced at | verdict |
|---|---|---|---|
| `construct` | **0.0209** | 0.03 | inside |
| `repair` | **0.0020** | 0.03 | inside, by an order of magnitude |
| `generate` | **0.0018** | 0.02 | inside |

Two generate properties were **redesigned** because the first versions failed this test, and that
is what the measurement is for:

- *"find a value where these two decks disagree"* had a blind success rate of **39 in 41** — for a
  pair that agrees only at 0 and 1, almost every integer in the slot is correct. Replaced by
  *build the other deck*, which is the act the node is about and is checked.
- *"seat a value that makes the load read more than T"* is satisfied by about half of all integers.
  Replaced by *stack a load that reads T when the socket holds v*, whose answer space is enormous
  and whose satisfying subset is tiny.
- `claimClosesAt` now requires a lip on the pan carrying the socket, so a blind `x = 4` cannot
  satisfy "author a claim that closes at 4".

## Determinism

The committed bank is a pure function of `--seed` (20260809) and `--per-kp` (36). Re-running the
builder reproduces it exactly, and C19 asserts it on every audit run. Each knowledge point draws
from a seed derived from its own id, so adding a node never reshuffles another one's items.

## Known gaps

- `eq-meaning`'s `equals-means-compute-now` is carried by 3 committed items — the fewest of the 96
  pairs. It only lives on the repair form (a chained equality is a shape, not a value, so it cannot
  be a construct distractor), and only half the repair items on that node break at that joint. The
  generator covers it: C2b serves 12 distinct targeted items for that pair.
- `select4` and `judge2` are not generated at all. When P18 needs a `model`-phase beat it will have
  to ask for one, and this bank will need a form that is explicitly refused entry to the scored path.
- The bank ships as ~1.3 MB of JSON, ~120 KB gzipped, in its own lazily-imported chunk. If that
  becomes a load-time problem the `text` snapshots are the first 40% to go, and they are
  review-time convenience rather than runtime data.
- Object-class framings are per knowledge point (two each), not per family. A block of three items
  on one node reads as two different sentences rather than three.
