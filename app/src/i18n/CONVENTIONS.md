# Localization decisions — EN / ES / PL

Owner: **P20**. Binding for anyone who edits `content/locales/*.json`.

`design/voice.md` §8 says the tone survives translation only if a list of things hold. This file is
the record of *how* they were made to hold, one decision at a time, so a later editor changes a word
on purpose rather than by accident. Every claim here is measured by `review/measure/P20.mjs`.

---

## 0. The rule this file exists to enforce

> A translation replaces English words. A localization replaces English *conventions*.

Three conventions are load-bearing in a product about algebra, and all three are invisible to a
spell-check: the decimal mark, the plural system, and which physical noun a mathematical idea is
allowed to be called. They are §2, §3 and §4 below.

---

## 1. Loading, fallback, and why there is no fallback

`app/src/i18n/I18n.js` never falls back to English. A key the active locale does not have renders as
`‹key›` and is reported by the `i18n` probe, which fails `review.mjs verify`.

The usual design — fall back to the reference locale — is exactly the mechanism that puts an English
sentence on a Polish player's screen and then hides it from every automated check, because from the
runtime's point of view nothing went wrong. G3 forbids a visible English fallback, so the runtime
must not have one. A sentinel cannot ship, because the gate it breaks is the gate a build has to pass.

The reference bundle is loaded alongside the active one at boot and the two are compared key by key:
presence, shape (string vs plural bundle), plural categories, and `{placeholder}` parity. That audit
is what makes `missing: []` mean something *before* any UI exists to ask for a string.

---

## 2. Numbers

| | EN | ES | PL |
|---|---|---|---|
| decimal separator | `.` | `,` | `,` |
| thousands separator | `,` | no-break space `U+00A0` | no-break space `U+00A0` |
| grouping starts at | 1,000 (4 digits) | 10 000 (5 digits) | 10 000 (5 digits) |
| minus | `−` U+2212 | `−` U+2212 | `−` U+2212 |
| percent | `80%` | `80 %` | `80 %` |
| list conjunction | `a, b and c` | `a, b y c` (`e` before i-/hi-) | `a, b i c` |

**Why a space and not a full stop in Spanish.** The RAE prescribes a fixed space for groups of three
and explicitly rejects both the comma and — as of the current *Ortografía* — the full stop that older
Spanish typography used. A no-break space is used so a number can never wrap across a group.

**Why four-digit numbers are not grouped in ES and PL.** Both conventions write `4111`, not `4 111`.
This is not academic: `sign.kindness.02` paints a revision number on a board on Leaf Nine, and it
reads `REVISION 4,111` in English and `REVISIÓN 4111` / `WERSJA 4111` in the other two.

**Why `Intl.NumberFormat` is not used.** Its output depends on the host's ICU build — Spanish grouping
in particular has changed separator between ICU releases — and this project fails a piece whose
numbers a reviewer cannot reproduce. `app/src/i18n/numbers.js` is pure and deterministic.

### 2.1 Numbers inside KaTeX — the one that silently breaks

`formatNumber()` output must **never** be interpolated into TeX. Use `tex()` / `texNumber()`.

In math mode a bare comma is punctuation and takes a trailing space, so a Spanish or Polish decimal
handed to KaTeX unbraced typesets as `1, 5`, and a grouped thousand as `16, 004`. The idiomatic
TeX forms are a braced comma and a thin space:

| value | EN | ES / PL |
|---|---|---|
| `1.5` | `1.5` | `1{,}5` |
| `16004` | `16{,}004` | `16\,004` |
| `16004.5` | `16{,}004.5` | `16\,004{,}5` |

P15 (`math/Tex.js`) consumes `i18n().tex(value)`. Nothing else in the codebase should build a numeral
for a claim.

**Variables stay Latin in all three locales.** `x`, `y`, `n`. Spanish and Polish school mathematics
both use Latin letters for unknowns; there is nothing to localize, and transliterating would break
the fiction, since Ix *is* the letter.

### 2.2 "Solve for x", deliberately not used

The idiomatic phrasings are ES **despejar x** and PL **wyznaczyć x**. Neither appears in the product,
and neither does the English one, because the Margin's verb for the act is **close it** — ES
*cerrarlo*, PL *domknąć / zamknąć*. The idioms are recorded here so a future editor knows they were
rejected rather than missed. The one place a plain verb for solving is allowed is Adjuster Camber,
who is an institution and speaks policy: ES *resolver*, PL *rozwiązywać*.

---

## 3. Plurals

CLDR categories, hand-written in `app/src/i18n/plurals.js`.

| locale | required categories | why |
|---|---|---|
| en | `one`, `other` | |
| es | `one`, `other` | CLDR's `many` for Spanish fires only on compact millions, which this product never prints |
| pl | `one`, `few`, `many`, `other` | below |

Polish, in full, with the noun the HUD actually uses:

| category | fires on | example |
|---|---|---|
| `one` | 1 | `1 liść` |
| `few` | 2–4, 22–24, 32–34 … | `2 liście` |
| `many` | 0, 5–21, 25–31 … | `5 liści`, `11 liści`, `21 liści` |
| `other` | anything with a visible fraction | `1,5 liścia` |

Two traps, both of which a hand-rolled "if (n === 1)" walks into:

1. **`many` is the genitive-plural slot, not "a lot".** It swallows zero, every teen, and every
   number *ending* in 1 that is not 1 — `21 liści`, never `21 liść`.
2. **`other` is the fraction slot and is the one implementations skip.** Skipping it makes
   `1,5 liść`, which is the tell that a Polish localization was built with an English plural
   function. It matters here because the mastery UI shows spacing intervals and the fall reads carry
   `{n}` values that are not always integers.

A plural bundle in a locale file is an object whose keys are all CLDR category names **and whose
values are all strings**. The third condition is not pedantry: `amb.stray.other.01` nests an `other`
under an ordinary branch, and without it the audit reads that branch as a plural bundle.

---

## 4. The lexicon — physical nouns, never mathematical ones

`voice.md` §8: if a translator reaches for the mathematical term, the world has turned back into a
classroom. Every row below chose the concrete word.

### 4.1 The physics

| EN | ES | PL | the reasoning |
|---|---|---|---|
| a claim | **afirmación** | **stwierdzenie** | an everyday assertion. Explicitly not *ecuación* / *twierdzenie* (which is "theorem") |
| the Sill | **el Umbral** | **Próg** | a doorsill you step over — both are the word for the board under a door |
| a pan | **platillo** | **szalka** | the exact word for a balance pan in both |
| near / far pan | *cercano / lejano* | *bliższa / dalsza* | never left/right — in a product about solving, "right" is a trap in three languages |
| a socket | **la cuna** | **gniazdo** | a stone cradle; PL *gniazdo* is a socket, a nest and a machine seat at once |
| to seat | **asentar** | **osadzić** | what you do to a bolt, in both |
| a load | **la carga** | **ładunek** | what is on a pallet |
| a bundle | **el atado** | **wiązka** | tied with string |
| a term | **el bulto** | **człon** | ES: a freight item dockworkers count. PL: a member of a structure. Neither is *término*/*wyraz* |
| a carry | **la llevada** | **przenos** | ES keeps the arithmetic pun (*me llevo una*); PL *przenos* is the carry bit and a real technical noun |
| a certainty | **certeza** | **pewnik** | a countable crystal object, not an abstract noun |
| a mark | **la marca** | **kreska** | a painted line on a gate. Never *desigualdad* / *nierówność* |
| a detent | **el retén** | **zapadka** | the machinist's word for the notch a latch rests in, in both |
| drift | **deriva** | **dryf** | nautical, physical |
| grey | **gris** | **szarość** | |
| the working | **el rastro** | **ślad** | a trace left standing beside the claim |
| a stray | **un suelto** | **zbieg** | ES: loose, as in loose change. PL: a runaway |
| an unknown | **la incógnita** | **niewiadoma** | and both are **feminine** — see §5.1 |
| rounded down | **redondeado** | **zaokrąglony** | |
| a refusal | **una negativa** | **odmowa** | |
| an always | **un siempre** | **zawsze** | |

### 4.2 The six object classes (`world.md` §2.1)

The Sill and the Threshold collide in translation and had to be pulled apart: `voice.md` gives the
Sill *umbral* / *próg*, which are also the obvious words for "threshold". The object class therefore
takes the hydraulic word instead, which is more accurate anyway — a Threshold in this world is a weir
gate, and both languages have a trade word for one.

| EN | ES | PL |
|---|---|---|
| Span | **Vano** (a bridge span) | **Przęsło** (a bridge span) |
| Aperture | **Abertura** | **Przejście** |
| Emitter | **Emisor** | **Promiennik** (a radiant heater) |
| Bearer | **Soporte** | **Dźwigar** (a girder) |
| Vessel | **Recipiente** | **Naczynie** |
| Threshold | **Compuerta** (a sluice gate) | **Zastawka** (a weir board) |

### 4.3 Institutions, ranks and peoples

| EN | ES | PL | note |
|---|---|---|---|
| the Margin | **el Margen** | **Margines** | the page pun survives intact in both |
| a leaf | **una hoja** | **liść** | ES keeps leaf+page; PL keeps only the plant. Accepted — see §6 |
| the Quorum | **el Quórum** | **Kworum** | |
| the Sufficiency | **la Suficiencia** | **Wystarczalność** | PL avoids *dostateczność*, which is a school grade |
| the Tolerance | **la Tolerancia** | **Tolerancja** | engineering tolerance in both |
| a Kindness | **una Gentileza** | **Uprzejmość** | |
| a Rung / the Ladder | **Peldaño / la Escala** | **Szczebel / Drabina** | a physical rung of a ladder |
| Provisional | **Provisional** | **Tymczasowy** | |
| Runner | **Corredor** | **Goniec** | PL *goniec* is a courier and always has been |
| the Ninth Circuit | **Noveno Circuito** | **Dziewiąty Obwód** | judicial-circuit flavour in both |
| a can | **el bidón** | **kanister** | a jerrycan |
| Carrier / Binder / Sharer | **Porteador / Amarrador / Repartidor** | **Tragarz / Wiązacz / Rozdzielca** | Rungs 1–3, the only titles Level 1 ships |
| the Tare | **los Tare** | **Tare** | invariable proper noun |
| the Nearlies / half-sayers | **los Casi / mediadichos** | **Prawiaki / półmówcy** | |
| a sagsmith | **apuntalador** | **stemplarz** | ES: one who shores. PL: from *stempel*, a mine prop |
| the Edgewake | **la Vigilia del Borde** | **Czuwający** | a wake kept at the lip |
| a cutter | **cortador** | **krajacz** | |
| a weir | **el azud** | **jaz** | the exact word for a river weir in both |
| a hush | **un silencio** | **cisza** | |
| a several | **un varios** | **kilkoro** | see §5.2 |
| abouts (the plant) | **los aproximos** | **okołki** | coined from *aproximado* / *około* |
| oldtrue (the lichen) | **viejocierto** | **prawdziwek** | PL *prawdziwek* is already a folk plant name meaning "the true one" |
| sill-crabs | **cangrejos de umbral** | **kraby progowe** | |
| a thousandfoot | **milpiés** | **tysiąconóg** | ES *milpiés* is literally "thousand-feet" already |
| carrywrens | **chochines de llevada** | **strzyżyki przenosowe** | |

---

## 5. Register decisions

These are the places where translating the words correctly would have lost the character.

### 5.1 Ix is grammatically feminine in ES and PL

A stray is an unknown, and an unknown is **la incógnita** and **niewiadoma** — feminine in both.
Ix therefore speaks in feminine forms (*Byłam siódemką*, *Fui un siete*). This is grammar, not
characterization: Ix is "it" in English and the neuter Polish forms would read as an error rather
than as strangeness. `voice.md` §8 also forbids stacking diminutives on Ix in either language —
*siedmiuszek*, *sietecito* and their relatives would turn a friend in danger into a mascot. None are
used.

### 5.2 The three grammatical jokes, kept as grammar

- **A several is plural.** EN breaks agreement (*a several are*). ES does it with the article:
  *un varios beben*. PL has no articles, so the break is carried by the verb: *kilkoro piją*, where
  correct Polish would be *kilkoro pije*. **Exactly one deliberate break per string** — two reads as
  bad Polish rather than as changed grammar.
- **The cutters never say "I".** ES and PL both drop subject pronouns routinely, so the English rule
  is nearly invisible in them. Those locales carry it with impersonal and passive constructions
  instead — *nie podnosi się wzroku*, *uno no levanta la vista* — never *yo* / *ja*, and never a
  first-person verb where an impersonal one exists. `lore.cutters.01` states the rule in the form the
  locale actually observes, because a plaque that says "they do not say the word I" is not true of a
  language that never says it anyway.
- **The Verse-runner's lines open and close with em dashes** in all three locales, and are never
  punctuated into sentences.

### 5.3 Camber's agentlessness

Polish reaches it more cleanly than English: the impersonal `-no/-to` forms (*wydano*, *pobrano*,
*odnotowano*, *zaklasyfikowano*) are agentless by construction. Spanish uses *se* constructions
(*se ha suministrado*, *se agradece*). Formal address is **Państwa** in PL and **usted** in ES —
the Sufficiency has never once been familiar with anybody.

### 5.4 Sennar keeps her six words

*true, false, open, closed, adequate, honest* → ES *cierto, falso, abierto, cerrado, adecuado,
honesto* / PL *prawdziwe, fałszywe, otwarte, zamknięte, wystarczające, uczciwy*. She still applies
none of them to a person in any locale. `sennar.praise.high` is the pivot and it is about the work:
*Eso no fue adecuado. Eso fue cierto.* / *To nie było wystarczające. To było prawdziwe.*

### 5.5 The `walk.rate.*` register survives because it is a noun phrase

"The wet of us" is a *part of a body*, not a pronoun and not a verb inflection, so nothing about it
depends on a language having or dropping "we": ES *la parte mojada de nosotros*, PL *mokra z nas*.
Flattening either to a plain first-person plural turns the only non-human speaker in the product into
a committee, and is the single edit this file most wants a future translator not to make.

### 5.6 The exclamation budget

Exactly three exclamation marks in Level 1, all Ix's: `ix.first.solve.01`, `ix.bark.walker.01`,
`ix.mastery.digit.01`. Spanish opens an exclamation with `¡`, so the budget is counted on the
**closing** `!` only — otherwise correct Spanish punctuation would read as six. `review/measure/P20.mjs`
counts it that way and asserts three per locale.

### 5.7 The banned-word list is about meaning, not spelling

ES *ejercicio, respuesta, problema, correcto, incorrecto, ¡muy bien!, nota, alumno, deberes* and PL
*zadanie, odpowiedź, poprawnie, błędnie, brawo, ocena, uczeń, lekcja, ćwiczenie* are the same
violation as their English counterparts. `review/measure/P20.mjs` sweeps all three locales for them.

---

## 6. Untranslatable by design

`voice.md` §8 permits a pun to be dropped rather than forced. Three were.

| thing | what is lost | what was done |
|---|---|---|
| **the Long Division** | the arithmetic pun | localized as a *name that sounds like a canyon*: ES **el Tajo Largo** (*tajo* is a deep cut), PL **Długi Rozłam** (*rozłam* is a rift). Neither forces "division"; both keep the shape of a gash eleven kilometres wide |
| **Nine Tenths of Nothing** | nothing — the shape survives | ES **Nueve Décimos de Nada**, PL **Dziewięć Dziesiątych Niczego**. Still a self-deprecating fraction, still a mass joke |
| **leaf** | the plant/page double meaning, in Polish only | PL **liść** keeps the plant, which is what the floating shelves look like; the page half of the joke is carried by **Margines**, which survives whole |

And one thing that was *not* dropped: the title. **ESTRELLA VARIABLE** and **GWIAZDA ZMIENNA** are
the real astronomical terms for a variable star in each language, so all three of the title's
meanings (`world.md` §1 — the star, Ix, the player) survive intact.
