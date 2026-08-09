# The world bible

Binding. Every other piece quotes this file. If a system's behaviour and this document disagree,
one of them is a bug — say which in your handoff, do not quietly diverge.

**How to read this if you are building something.** §0 is the whole premise in two minutes — read it
cold. Then §11, find your piece's row, and read only the sections that row points you at. §12 is the
short list of things you may not contradict. Everything else is reference: look up a name when you
need one, and take the name that is already here rather than inventing a synonym.

---

## 0. The retell

*This is what a stranger repeats after one read. If your feature cannot be traced back to these three
lines, it is decoration.*

> The star is a variable nobody has solved.
> The ground you stand on is a sentence that is still true.
> Solve, and it stays.

The long form, for anyone who has to build it:

> A star called **Lethis** has forgotten how bright it is. The people who lived beneath it did not
> build things — they built **claims**: statements that, for as long as they stay true, are
> physically a bridge, a door, a tower, a floor. When a claim goes false, the thing it was stops
> existing. The world broke into floating shelves that way. You are a **Provisional Runner** —
> the lowest rank there is, a courier who carries numbers in a can — and you have exactly one
> asset: a **stray unknown** named **Ix** who will climb into any open claim and be the missing
> quantity, because being definite is the only time Ix knows what it is. Solving is not proving
> you know. Solving is *manufacture*. And a very polite institution called **the Sufficiency**
> would rather you didn't — it will hand you a close-enough value, for free, forever, and every
> time you take one, a little more of the world becomes approximately itself.

### The picture

*The retell is the premise. This is the frame. Art, level, scatter, audio and locale pieces are
building this paragraph — if your shot does not look like it, the shot is wrong.*

> One frame, taken at random on any leaf: warm ochre stone; three teal rivers, one of them running
> uphill; an arch of dark glass coming up out of the ground with mooring numbers painted on it, and
> another arch six hundred metres away going back in, and they are the same animal; a flying barge
> sitting on the stone because it forgot its own weight, its crew re-weighing their boots in a line;
> three of something standing in the middle carry with no fronts and no faces, growing an arm on
> whichever side needs one, rating the water; a several drinking at the shallows in an unfixed number
> of bodies, four hundred metres of which are elsewhere; a folding booth with a queue and free soup;
> people on a weir dangling sentences they refuse to finish, because unfinished is the only good bait;
> a courier your own age going the other way with an empty can and nine leaves left before dark; a
> woman forty metres up walking on a line she drew herself, not looking down; a slow humming animal
> eating a grey wall; birds that arrive before their own noise; something above the certainty field
> that has been closing its own claim for two hundred years and has refused the free value four
> hundred times; a man propping a roof he cannot make true; and on the horizon a city whose towers
> stop in mid-air above a chasm eleven kilometres wide, under a star that cannot remember how bright
> it is.
>
> Nobody in the frame finds any of this remarkable.

**Six of the living presences in that frame are not people, and four of them cannot be named in one
word.** That ratio is the specification, not the flourish. The strangeness of this world is not
allowed to be entirely *conceptual* — odd behaviour performed by people you could name at a glance.
Some of what is at work in frame must be at a scale, a body plan or a grammatical number you have
not met, and nobody stops to explain any of it.

**The frame is never empty.** A Level 1 shot with fewer than three non-player presences in it is a
bug, not a quiet moment — **and a Level 1 shot in which every living presence is a human being at a
trade is also a bug**, however busy it is. Leaf Nine has one resident and constant traffic, and §3
says who, and four of them are not people.

---

## 1. Title

**Chosen: `VARIABLE STAR`.** It is load-bearing three times over, which is why it wins:

1. **Lethis is literally a variable star** — its luminosity is an unsolved function. The campaign's
   final claim is the star itself.
2. **Ix is a variable** — the companion is the unknown.
3. **You are a variable** — Provisional means the Margin has not decided what you are worth yet.
   The Ladder decides. That is the ascent.

Alternates, kept on file (all diegetically true, all usable as chapter or edition titles):

| Candidate | Why it could win |
|---|---|
| **The Margin** | Names the place; doubles as the scratch space where working is done. |
| **Solve for Lethis** | Puts the final objective in the title. Reads as a command. |
| **Nine Rungs** | Leads with ascent. Best if we ever market on hierarchy. |
| **A Stray Unknown** | Leads with the bond. Best if we ever market on Ix. |
| **Tolerance ±1** | The antagonist's title. Cold, funny, ominous. Good for a dark edition. |
| **The Long Division** | The chasm you spend Level 1 learning to cross. |

Subtitle used in-product where a subtitle is needed: *Variable Star — the Margin still stands.*

---

## 2. Why algebra is literal power

Not a metaphor. Not a school. Not a minigame layer. This is the physics.

**The precursors did not build objects. They built claims.**

A **claim** is a statement fixed into the world at a **socket** — a stone cradle with a live
mathematical assertion standing above it in light. While the statement is true, the thing the claim
describes *physically exists*. A bridge is not a bridge; a bridge is a claim about a span, and it is
made of stone and light for exactly as long as that statement holds.

Consequences, and they are the whole game:

- **A true statement is a thing. A false statement is a hole where a thing was.** The shelf-lands
  float because the claims under the rest of the crust went false and the rest of the crust
  stopped being there. Ruins are not weathered. Ruins are *unproven*.
- **Solving is manufacture.** Closing a claim does not demonstrate competence; it emits a bridge.
  The world snaps the object into existence in a handful of frames, with a sound, out of light that
  cools into stone. This is the single most satisfying thing in the game and every piece should
  protect it.
- **Nobody is grading you.** There is no examiner. There is a gulf, and either the span exists or
  you are standing on the wrong side of it.

**Why a person can do this and a machine cannot.** Closing a claim requires holding a quantity as
genuinely unknown — carrying `x` through a chain of operations without collapsing it into a guess.
Machines in the Margin cannot do it; they cannot tolerate an open value long enough to move it.
They approximate instead. This is the thematic spine of the entire product:

> **Only something that can bear not knowing can ever know.**

### 2.1 Claim grammar — the binding table

*Added because six pieces need the same rule and were about to invent six of them. **P09, P14,
P15, P19, P26 and P17 all bind to this table.** It covers every knowledge point in
`content/knowledge-graph.json` — §11a maps all thirty-two of them to a class by id. If your system
needs a claim shape that is not here, do not improvise one — put it in your handoff and it gets
added.*

Every claim has **two readings of the same statement**:

- **Open reading** — what a *live* claim shows: an unknown on the near pan. `x + 5 = 12`.
  This is what the player sees, touches and solves. This is what the item bank authors.
- **Closed reading** — what a *standing* claim shows once it holds: the identity it settled into.
  `span = gap`. This is what a plaque says, what surveyors read, what a sagsmith props.

They are not two grammars. They are the same sentence before and after. A drifted claim slides back
from the closed reading to the open reading in front of you, and that is what drift *looks like*.

**Six object classes. Five of them level; one of them leans on purpose.**

| Object class | The unknown is | Open readings (what you solve) | Closed reading | What the emitted object takes from the value | How it fails |
|---|---|---|---|---|---|
| **Span** — bridge, ramp, stair, gantry, deck | the missing length, in spans | `x + a = g` · `k·x = g` · `k·x + a = g` · `k·x + a = g − b` · `k·x + a = m·x + b` | `span = gap` | length, measured from the near lip outward | short → it stops in air; long → it drives into the far wall and shears |
| **Aperture** — door, gate, hatch, lock | the key value | `k·x = L` · `k(x + a) = L` · `k(x + a) + b = L` | `key = lock` | the tooth profile, and therefore who it opens for | it exists and admits the value it was given, which may not be you |
| **Emitter** — lamp, beacon, heater, mast | the output | `x = n` · `x = ⟨a load you must settle first⟩` | `output = n` | brightness, radius, warmth | dim, flickering, and it dies at the next drift |
| **Bearer** — floor, wall, pillar, roof | the load one member carries | `m·x = w` · `m·x + b = w` · `m·x + n·x = w` · `m·x + b = w − c` | `bearing = load` | thickness, and how much weight it takes before greying | it sags first and goes down second; nothing ever falls without warning |
| **Vessel** — can, hull, cistern, balance | the contents | `t + x = T` · `t + x = T − x` · `a·x + t = b·x + T` | `tare + contents = total` | capacity, and whether it floats | it lands where it stands and trades until somebody re-closes it |
| **Threshold** — weir gate, lip-rail, admittance arch, a posted Tolerance | the **mark** | `x ≥ n` · `x + a ≥ n` · `k·x ≥ L` · `−k·x ≥ L` · `k·x + a ≥ n` · `−k·x + a ≥ n` | `admitted = permitted` | its clearance — how much of the world gets through it | it admits the wrong things. **A threshold's failure is a flood, never a hole.** |

**The Threshold is the antagonist's own physics, and that is why it matters.** The **Tolerance** is
a threshold claim: `|error| ≤ 1`. Every Kindness on every leaf is an admittance arch standing under
it. Widening the Tolerance is not a policy change, it is **raising a mark**, and it is the largest
standing threshold claim in the Margin. Learning to set a mark is learning to do the one thing the
Sufficiency has done unopposed for eleven thousand years — see §5, Fifth Rung.

**Nine rules that make the table binding.**

1. **The far pan is measured, never authored.** The gap, the lock, the load, the total — those are
   facts about the site. P09 places geometry; the claim reads the geometry. A level designer never
   types the right-hand quantity, they dig the hole.
2. **The near pan is authored.** It is the algebra, and P17 owns it. Same site, many claims.
3. **One unknown per claim you close — but a claim may cut more than one socket for it.** Every
   socket cut for the same name holds the same value, which is exactly why one stray can be in three
   sockets at once and still be one quantity, and why claims with the unknown on both pans are legal.
   You never solve for the gap. The gap is the world. You solve for the thing you are making. *This
   is the deep rule: solving does not change the world, it fits you into it.*
   *The limit is on closing, not on naming.* A load you are only asked to **settle** — seat known
   values and read what comes out — may carry as many names as it likes, because nothing is being
   held open. Two names, two sockets, two values, one reading. That is not solving and it does not
   need a stray.
4. **Dimensions are a pure function of the closed value.** Same value, same object, every time,
   deterministically (G4). An object's size is readable proof of what the value was.
5. **The working stays.** The trace of how a claim was closed remains standing beside it until
   weather takes it. This is the same object P18 uses as a worked example.
6. **A grey closure obeys the table too.** It produces the object at the *supplied* value, inside
   the Tolerance — so a grey span is the right shape and the wrong length, which is exactly why it
   sags.
7. **The object class fixes what the unknown IS, not how many steps reach it.** Step count,
   ordering, coefficient size and difficulty are **P17's**; object class is the world's. `x + 5 = 12`
   and `4x + 5 = 61` are the same object doing the same job — one of them takes longer. No piece may
   invent a new class to get a longer sum.
8. **A load is stacked, and a stack settles inward-out.** Everything standing on one pan is a
   **load**: terms, counts, bundles. A load settles from the inside of its bundles outward, which is
   the only reason a total is ever a single number. To take a load apart you go the other way —
   outward-in, top first — which is why you lift the lip before you share the deck. *Nothing in the
   Margin ever states this. It is simply how the objects behave, and the player's hands learn it
   before their mouth could.*
9. **Kinds gather; unlike refuses.** Every term is *of a kind* — a length, a weight, a count. Two
   terms of one kind gather into one term of that kind and the kind never changes. A length and a
   weight will not stand together, and the socket does not argue about it; it simply will not take
   them. This is the Second Rung and it is the only rule in the game the world enforces by refusing
   your hands.

### 2.2 The Five Laws of the Margin

Quotable doctrine. Every learning verb, every VFX read, every line of dialogue should be traceable
to one of these.

1. **A true statement is a thing.** False, and the thing is gone. There is no third state — except
   grey (Law 5).
2. **Anything carried across the Sill comes back inverted.** The equals sign is a place you can
   stand on: a bar of light set into the stone, called the **Sill**, the way a doorway has one. Lift
   a term, walk it over, and it turns around on the way. This is the first power the player gets and
   it is the game's signature verb. *(Reserve the word **threshold** for the object class in §2.1.
   The Sill is a sill.)*
3. **Both pans or neither — and the Sill knows which kind of claim it is holding.** A claim hangs
   across the Sill on two **pans**, like a balance, because that is what an equals sign has always
   been. Touch one pan and the claim visibly *tilts*. The world never says "wrong". It leans.
   *And leaning does not mean the same thing twice:*
   - An **equality's** Sill **locks level**. The heavy pan sinks by an amount you can read off the
     tilt, and any tilt at all is a falsehood standing in front of you.
   - A **threshold's** Sill rests on a **detent** — a notch cut on one side of a **mark** — and the
     pan is *permitted* to lie anywhere on that side. **A leaning threshold is not broken. Leaning
     is its job.** It fails by admitting the wrong things, which is a flood and not a hole.
   - Carry a threshold's rail over the Sill inverted and **the detent goes to the other side of the
     mark**: everything it used to admit, it now refuses. You feel the detent go over through your
     hands a moment before you see it. No piece may render this as a failure — it is a *turn*.
4. **Nothing stays solved.** Value drifts. A closed claim loosens over time and must be closed
   again — this is not decay, it is *maintenance*, and it is what a civilisation actually is. A
   claim re-closed enough times, spaced far enough apart, finally **sets**: it crystallises into a
   **certainty** and drifts no more. *(This is the in-world form of spaced retention. The numbers
   live in the mastery engine; the fiction follows the numbers, never the reverse.)*
5. **A guess closes nothing.** A claim can be shut with a supplied value — the Sufficiency does this
   constantly — and it will hold, approximately, and go **grey**. Grey things work. Grey things sag.
   Grey things never set, and grey is what the Sufficiency can find.

### 2.3 Distinctness note

Four of this game's biggest shapes are borrowed. Say so out loud, then say what is ours, then hold
ourselves to it. **An undeclared borrowing is the problem; a borrowing is not.** If a fifth turns up
later, it goes in this list the day it is spotted, not the day somebody else spots it.

**The gesture.** Carrying a term across an equals sign and having it invert is not a new idea — it is
*al-jabr*, it is the balance model, it is centuries old, and at least one well-known teaching game
has made dragging-and-inverting its signature move. **What is ours:**

- **The term has mass.** It is an object you grip, and it is heavy, and carrying it costs you
  movement. It is not a sprite that snaps.
- **The Sill is a place.** It is a bar of light set into stone that you physically walk over, in a
  world, at altitude, in weather.
- **The unknown is a person.** Ix is the `x`. It has a name, four lights, an opinion, and something
  to lose every time you solve.
- **The output is architecture, not a score.** Closing emits a building. The reward is a place you
  can stand.
- **The antagonist is the hint button.** No other product's help system is the thing eating the
  world.

**The geography.** Shelves of land held aloft under a strange sun is the most-reused setting of the
last fifteen years, and we are not going to pretend our leaves arrived from nowhere. **What is ours
is that the ground is legible.** In every other floating world the islands float because they float.
Here:

- **A leaf is an argument, and you can audit it.** It is up because specific statements inside it
  are still true. The count of surviving leaves is *public* — the Quorum — and it goes down, and a
  bell rings each time. No other sky-island world has a number for how much of it is left.
- **There is no ground underneath.** This is not a layer above a real world you will visit in Act
  Three. Below the leaves is not a lower level; it is the place where things stopped being true.
  Nothing is down there and nothing ever will be, and a piece that puts a distant valley floor under
  the clouds has broken the premise, not the art direction.
- **The shape is a consequence, not a silhouette choice.** Leaves are flat on top because that was
  the surface, and ragged underneath because that is a fracture where the false part stopped. An
  underside is *readable*: the thick teal veins are the claims doing the work.
- **You can read a leaf's health off its plants.** **Oldtrue** grows only on a century of held truth;
  **abouts** grow only on approximation. Scatter is a survey instrument (P13).

**The companion.** Small, floating, teal, roughly cat-sized, excitable, your only friend — yes, that
is a silhouette the whole industry has used, and the benchmark game in our own quality bar invented
the most famous version of it. **What is ours is that Ix is the risk, not the guide:**

- **Ix knows nothing you do not.** It is worse than you at names, better than you at numbers, and it
  has never once known which way to go. It cannot hint, will not point, and has no access to the
  answer, because if it could hold the answer it would not be an unknown.
- **Ix is never an interface.** It does not mark objectives, does not route the HUD, does not say
  the equivalent of *hey, listen*, and never speaks a system line. Any piece that uses Ix to deliver
  UI has turned a friend into a menu.
- **The arc is subtractive.** A guide accrues. Ix can end a level with fewer lights than it started
  with, and Level 1 exists partly to prove that in Beat 3.
- **It should not read as a creature.** If a silhouette test makes Ix look like a fairy or a pet,
  the model is wrong. Ix is an open bracket and a point that never settled — *unfinished notation
  with four small lights around it*. Charm comes from behaviour, never from a face.

**The institution, and the crowd around it.** A folding booth with an awning and a queue and free
soup; a floating unit that apologises, issues a receipt and takes something anyway; a permitted error
posted on a board with a revision number on it; *"Nothing is being taken from you. Things are merely
being made easier to carry."* That is Gilliam's ministry in *Brazil* with the menace sanded off. And
the six human cultures in §4.4 are Discworld's guilds down to the joinery: one trade, one verbal tic,
a six-hundred-year superstition, and a completely straight face. Both are lifts, both are large, and
both sat in this file undeclared for three revisions — which is precisely the failure this section
exists to catch, and it caught them late. **What is ours:**

- **The bureaucracy is right.** Gilliam's ministry is absurd because it is pointless. The
  Sufficiency's mandate is access, it is *meeting* it, and `camber.philosophy.02` is an argument this
  script is never allowed to refute. Comedy that comes from a correct institution is a different
  animal from comedy that comes from a stupid one.
- **The paperwork has a physics.** The receipt is for a digit that was genuinely taken off a living
  thing. The Tolerance is not a policy — it is a **threshold claim** (§2.1), the largest one standing
  in the Margin, and widening it has a blast radius measured in leaves. A guild tic here is
  load-bearing or it is cut: the Nearlies never finish a sentence *because carries flow toward the
  nearly-true*, and the cutters never say "I" because the trade is old and frightened. A tic that
  exists because of the physics is a culture. A tic that exists to be funny is a hat.
- **And the crowd is not all guilds.** This is the correction that decides whether a screenshot reads
  as a world instead of a nicely dressed market town: §3's manifest carries a body six hundred metres
  long that no shot may frame whole, three workers with no fronts, an animal that is grammatically
  plural, and something whose category nobody has settled. One of them has a speech
  register (`voice.md` §2b, `walk.rate.*`) and it is the only register in the product that could not
  be spoken by a person. Ankh-Morpork is a city of trades. The Margin is a place where four of the
  things at work in frame are not describable in one word, and nobody there thinks that is worth
  mentioning.

If a pitch of this game can be answered with "so, a drag-the-term app on floating islands with a
fairy", we wrote the pitch badly. Lead with the bridge appearing and the friend in the socket.

---

## 3. The place

### Lethis, the Forgetful Sun

A variable star, catalogue designation **Luminary I (Provisional, under review)** — a filing status
it has held for eleven thousand four hundred years. Its output is an unsolved function: it swells
and dims on a period nobody has pinned. Everything in the Margin is powered by it and nothing in the
Margin can predict it. Folk explanation, which is close enough to true to be the official one:
*Lethis cannot remember how bright it is.*

### The Margin

The band of surviving land where Lethis is neither lethal nor useless. The precursors named it the
Margin because it is a habitable annulus, and also — they thought this was funny, and it is — because
a margin is where you do your working. It is the edge of the page. We live in the notes.

### Leaves

The Margin is not a surface. It is **leaves**: floating shelves of warm ochre stone, from a hundred
metres to forty kilometres across, each held aloft by the claims still standing inside it. Sixteen
thousand and four leaves are currently true. A year ago it was sixteen thousand and forty-one, and
the Bell has rung the difference (§9). The count is public, it is called **the Quorum**, and it is
the only number in the Margin that everybody knows.

### Carries

Rivers of unresolved value — luminous teal, thick as syrup, running *uphill as often as down*
because they flow toward whatever is nearly true. A carry is raw quantity that has not been assigned
to anything. It is beautiful, it is the reason the leaves glow at night, and it is not safe: standing
in a carry makes your own values soft. Runners carry it in sealed cans. Fishing it is a trade.
Drinking it is a story your friends tell about you afterwards.

### Traffic on Leaf Nine

**Leaf Nine has one resident and everybody's shortcut.** Three carries meet here, which means barges
ground here, fishers work here, pilgrims stage here, relays cut across here, and the Sufficiency put
a booth where the traffic is. Sennar is the only person who *lives* on Leaf Nine. She is nowhere near
the only person on it, and the people are not all of what is on it: something two hundred years into
crossing the leaf's underside surfaces at both ends of it, three of something stand in the middle
carry doing a job no person's body could hold, an animal nobody has counted drinks at two places at
once, and there is a thing on the ridge that the Solvary, the Nearlies, the Tare and the Sufficiency
have four different filings for.

This subsection is a **manifest**. P09, P13, P20, P23 and P25: these are the presences that must be
placeable, audible and localizable in Level 1. Named, so nobody invents a parallel set.

**Four of the seventeen cannot be named in one word, and that is a specification.** A crowd of
humans at trades, however strange their trades, is a market town in costume — it is *conceptual*
strangeness, and it is not enough on its own. Leaf Nine also carries a body too long to get into one
shot, three workers with no fronts, an animal whose grammar is plural, and something nobody has
managed to decide the category of. **They are subject to the same rule as everything else here:
nobody in frame finds them remarkable, and nothing in the game explains them.** Their rows are
marked **(unnameable)**.

| Presence | What it is | Where, in Level 1 | Reads as |
|---|---|---|---|
| **The barge *Nine Tenths of Nothing*** | A Tare drift-barge, aground at the head of the leaf because its hull-claim drifted. Its crew have laid out everything they own on the stone and are re-weighing it. | Beats 1, 3, 5. Lifts during Beat 5. | A flying thing sitting down. Twenty people, a hundred small objects in rows, one enormous balance. |
| **Rell of the Tare** | The barge-master. Knows her own mass to the gram, and yours. Trades while grounded because a grounded barge is a market. | Beats 1 and 5 | The first adult who talks to you like a customer instead of a rank. |
| **The Bollard, and the Second Lip** *(unnameable)* | Two arches of dark glass, six hundred metres apart at opposite ends of the leaf, the near one carrying the Tare's mooring numbers in fresh paint because it keeps growing. They are the two ends of **one body**, which has been crossing the leaf's underside for about two hundred years and has perhaps eighty to go. A survey settled that in writing four generations ago. Nobody changed the names, because the names are useful. | Beats 1, 3, 4 and 5 — **never both ends in one shot, ever** | You are standing on the middle of it, and the level is happening on top of it. When the Bell rings in Beat 4 the far arch shifts about a hand's width and nobody looks up. |
| **The weir on the middle carry** | Three **half-sayers** of the **Nearlies** fishing raw value with glass hooks, baited with sentences they deliberately never finish. | Beats 1, 2, 5 | Three people arguing in fragments, refusing to complete a thought, laughing. |
| **Three of something, rating the middle carry** *(unnameable)* | Carry-raters, standing chest-deep in raw value where a person's own numbers would go soft in a minute. No fronts, no faces, no fixed limbs — an arm comes out wherever one is wanted and goes back in. They read how nearly-true a stretch of carry is, which is how the Nearlies know where to hang a weir and the Tare know whether a load is safe to lift. Three of them are spliced together and speak as one (`voice.md` §2b, `walk.rate.*`). | Beats 1, 3 and 5 — in Beat 5 the carry reverses around them and they carry on rating | Unmistakably somebody at work, and not shaped like anybody. They never turn to face you, because there is no facing. |
| **A Kindness** | A Sufficiency field station: folding booth, awning, queue, free soup, free values, posted Tolerance. Cheerful. Busy. | Beats 1, 3, 5 — the queue grows each time | The friendliest thing on the leaf, and the reason the leaf is dying. |
| **Sixth Vey, Solvary line-walker** | A Sixth Rung crossing the leaf on a line she drew herself, forty metres up, over the ravine. She does not stop and does not care who you are. *"Sixth Vey" is Rung-and-name, which is how the Margin addresses anyone at work; nobody here knows her given name and nobody needs it.* | Beats 1 and 4 | The clearest possible statement of what a Rung is worth. Also: a puzzle you cannot solve yet. |
| **A Verse-runner of the Nine Hundred** | Carrying the next stanza of the Verse between shifts on Leaf Forty. Mouth moving. Will not stop, will not greet you, cannot. | Beat 2, again in Beat 4 | Somebody sprinting across your level reciting a solve, and outrunning you. |
| **Ondu, sagsmith** | Props greyed structures with stacked certainties. Cannot close a claim. Has never pretended he can. Keeps four roofs up on this leaf. | Beats 3 and 4 | The human face of grey. Not a victim, not a fool — a professional. |
| **A hush** | Cart-sized, slow, humming animal that grazes on grey. Where it has fed, an approximate wall is simply not there, and the hole is honest. | Beat 4, far edge of the certainty field | The one thing in the world that is on nobody's side and eats the antagonist's work. |
| **The thing above the certainty field** *(unnameable)* | House-sized, on the ridge over the field, with an open socket in it and a **working** standing beside it that keeps updating itself. It has been re-closing its own claim for two hundred years. The Solvary files it under structures. The Nearlies feed it. The Tare have a mass for it. The Sufficiency has offered it a value four hundred times and it has never taken one, and no one on the leaf considers any of that a story. | Beat 4, above and behind the field, the whole beat | You cannot tell whether it is an animal, a ruin or a piece of weather, and neither can anyone who lives here. **It is not solvable and no piece may make it a puzzle.** |
| **Cutters of the Kiln Leaves** | A crew in dark glass cutting set certainties out of the field's far edge. They never say the word "I" during a cut. | Beat 4 | Adults doing skilled work adjacent to you, who nod at you once. That nod is a plot point. |
| **The Edgewake** | Pilgrims camped at the lip, counting the towers of Vantis. No two counts have ever agreed and they consider this the finding. | Beats 1 and 5 | Twenty people looking at the horizon question so you know it is a question. |
| **A carrywren migration** | Several hundred birds crossing the leaf, arriving fractionally before their own noise. | Beat 1, again at the end of Beat 5 | The prettiest thing in the level and a physics joke. |
| **Sill-crabs** | Small crabs that live on old claim sills, walk across, and come back inverted. Each owns two shells and alternates. | Beat 2, on the Standing House socket | **The signature verb, taught by an animal, before the player does it.** |
| **A several** *(unnameable)* | An animal that is an unfixed number of bodies and has never once been counted. The Margin's grammar gave up on it: *a several are*, never *a several is*. Part of one being four hundred metres away does not make it two. Leaf Nine has one. It is in two places. | Beat 2, drinking at the house carry — **and at the weir at the same moment** | The player works out that it is one animal about four minutes after meeting the second half of it, and nothing ever confirms this. |
| **Dace, Provisional, Ninth Circuit** | The other one. Same rank, same circuit, same age, half a leaf ahead of you all level. No stray. A receipt book. Nine leaves before dark, every day, and he makes it. | Beats 1, 3 and 5 | **The only presence on this leaf who is interested in you**, because you are the competition. See below. |

### Dace — the other Provisional

*The manifest rule is that nobody wants anything from you. Dace is the exception, and he is the
exception on purpose: everything else on Leaf Nine is an adult with a job, and a world made only of
adults with jobs has nobody in it to measure yourself against. Measuring yourself against somebody
is not the same as being told how you are doing, and this product is only ever allowed to do the
first one.*

- **He is not a villain and he is not a lesson.** He is faster than you, he is cheerful about it, and
  he is winning. He clears his circuit every day. You will not clear yours today, because you are
  going to stop and build a bridge.
- **He takes the Sufficiency's free value in Beat 3, in front of you, without embarrassment**, and he
  is *right* for his purposes: the cans get delivered, the circuit clears, the Ladder notices him
  first. This is the system the ascent has to out-think, and it is not a corrupt system — it is a
  system where the honest route is genuinely slower.
- **He had a stray. Eleven days.** It was rounded all the way down and it is a value now. He says
  this once, flatly, when it comes up, and does not perform it. It is why he does not want another
  one. It is also the only proof in Level 1 that what happens to Ix in Beat 3 can go further.
- **He never comments on your closures, your Rung, or Ix.** He measures deliveries. That is the whole
  register (`voice.md` §2c) and it is what keeps him out of the tutor's chair.
- **In Beat 5 he comes back to look at the span**, and that is the Fourth Wing beat of the level: the
  rival stops running to look at the thing you made. It costs one line.
- **The Ninth Circuit runs eleven Provisionals over forty leaves.** You have met two of them.

**Rules for using the manifest.**

- **They are not quest-givers.** Not one of them needs anything from the player in Level 1 — Dace
  included; he wants to *beat* you, which is not a task. They are *busy*. Interruptible, mostly
  friendly, entirely uninterested in your destiny.
- **They are not tutors.** No presence in the manifest may explain a mechanic. The sill-crabs teach
  by *doing it in front of you*; nobody points at them.
- **One voice at a time.** They talk over the world, never over Ix, Sennar or Camber.
- **They persist.** The barge is in the same place in Beat 5 as in Beat 1 until it lifts. The queue
  at the Kindness is longer every time it is seen. Continuity is most of the effect.
- **The four unnameables get no exposition, no species name and no codex entry.** Not from a plaque,
  not from Sennar, not from Camber, not from a load screen. `lore.bollard.01` and `lore.several.01`
  are the only two strings in the product that address any of them at all, and both are surveyors'
  notes that raise a further question rather than settling one. The Margin does not know either.
  **A frame in which every living presence is a human at a trade is a failed frame** — measure a
  shot against §0's picture paragraph, not against this table's length.

### The horizon — leaves you can see from Leaf Nine

P10 and P09: these are the objects in the sky and they are all questions.

| Object | What it is | Visible as |
|---|---|---|
| **Leaf Forty** | Home of the Nine Hundred, held aloft by a choir re-solving it aloud in shifts. | A leaf that pulses at night, on a beat, and never stops. |
| **Leaf One** | Carries **the Bell of the Quorum** slung beneath it. | A dark leaf with something enormous hanging under it. |
| **The Kiln Leaves** (Six, Seven, Eight) | Small, hot, close together. Certainties are cut and fired here. | Three orange undersides, glowing from below, always. |
| **Leaf Nine Also** | Four hundred metres, two hundred residents, broke off Leaf Nine eleven hundred years ago and kept the name. Both claims to the name are under review. | A near, low leaf with a very large sign on it. |
| **Leaf Two Hundred and Six** | One claim, leaf-sized: the largest single true statement in the Margin. Nobody lives on it. It is flat, and it is a **floor**, and nobody knows what it was the floor *of*. | A perfectly level plate on the middle horizon. |
| **The Errata** | A wandering storm of failed statements. Erases what it crosses. | A hole in the sky on the far horizon, moving. Never reaches you in Level 1. |
| **Vantis** | See below. | Towers that stop. |

### Certainties

Crystal. Teal, faceted, growing in fields and along old claim lines. A certainty is what a statement
becomes when it has been true, re-closed and re-closed, long enough to stop drifting. They are the
Margin's currency, its building material and its memory. **They cannot be faked** — a grey closure
never crystallises, so a certainty in your hand is proof that somebody actually did the work, once,
and then did it again, spaced out, until it set.

### Vantis and the Long Division

On the horizon of every Level 1 sightline stands **Vantis**: the greatest precursor city in the
Margin, and the loudest ruin in the world. It is *half-existing*. Towers rise for four hundred
metres and then simply stop, mid-air, at the exact height where their claim went false. Whole
districts are missing while their neighbours are pristine. One quarter — **the Remainder** — is
still perfectly, impossibly intact, because its claim was written so badly that nobody has ever
managed to make it false either.

Between you and Vantis is a chasm eleven kilometres wide called **the Long Division**. You cannot
cross it in Level 1. That is the point of it.

---

## 4. Lexicon

Eighty-six proper nouns and terms of art, grouped. One line each. Other pieces: **use these words, do
not invent synonyms.** If you need a word that isn't here, add it in your handoff and I'll canonise
it. The six object-class names — **Span, Aperture, Emitter, Bearer, Vessel, Threshold** — are part of
this lexicon and are defined once, in §2.1, rather than repeated here.
`content/knowledge-graph.json`'s `worldHook` field is the one place the lexicon is not yet in force;
§11a is the mapping that fixes it.

### 4.1 The world

| Term | Say it | Definition |
|---|---|---|
| **Lethis** | LEH-thiss | The variable star. Its brightness is the last unsolved quantity in the sky. |
| **the Provisional** | — | Lethis's catalogue status: "under review." Eleven millennia and counting. |
| **the Margin** | — | The habitable band around Lethis. Also the precursor word for scratch space. |
| **a leaf** | — | One floating shelf of land. Held up by the claims still true inside it. |
| **Leaf Nine** | — | Level 1. Six hundred metres of ochre stone, three carries, one house, everybody's shortcut. |
| **the Quorum** | — | The public count of leaves still true. Sixteen thousand and four. It falls. |
| **the Bell of the Quorum** | — | Hung beneath Leaf One. Rings once per leaf lost. Heard across the Margin. |
| **the Errata** | — | A wandering storm of failed statements. Erases what it crosses. Visible in Level 1, never close. |

### 4.2 The physics

| Term | Say it | Definition |
|---|---|---|
| **a claim** | — | A statement fixed at a socket. While true, it *is* the thing it describes. |
| **a socket** | — | The stone cradle a claim stands in. Open socket = unknown present = your job. |
| **the Sill** | — | The equals sign, treated as a doorsill. Cross it and you come back inverted. Not to be confused with a **Threshold**, which is an object class (§2.1). |
| **a pan** | — | One of a claim's two sides, hung across the Sill like a balance. Near pan, far pan. Never "left/right" — in this product the word *right* is a trap. |
| **the working** | — | The visible trace of how somebody closed a claim, left standing beside it. |
| **snapping** | — | The instant a closed claim emits its object. Light first, then stone. |
| **a carry** | — | A river of unresolved value. Luminous, teal, flows toward the nearly-true. |
| **a certainty** | — | Crystallised true statement. Currency, building material, proof of work. |
| **drift** | — | The slow loosening of a closed claim. Universal, unhurried, non-negotiable. |
| **grey** | — | A claim shut with a supplied value. It works. It sags. It never sets. |
| **a span** | — | Both the unit of length in the Margin and the class of claim that makes a bridge. |
| **a hull-claim** | — | The claim a barge flies on: a statement about its own mass. Drifts, and the barge lands. |
| **a load** | — | Everything standing on one pan. It settles inward-out; you take it apart outward-in. |
| **a term** | — | One object in a load. Has mass, has a kind, and can be gripped. |
| **a kind** | — | What a term is *of*: a length, a weight, a count. Like kinds gather; unlike will not stand together. |
| **a count** | — | How many of a term ride together. Stamped on its collar. |
| **a bundle** | — | Terms strapped together and carried as one. Open it and everything inside takes what the outside took. |
| **a ward** | — | A bundle inside a lock. A lock with four identical wards needs one tooth, four times. |
| **to seat** | — | To put a value into every socket cut for one name. All of them, or the load will not settle. |
| **a said claim** | — | A claim spoken into a socket instead of written. The Verse is the longest one there has ever been. |
| **a mark** | — | The value a threshold is set to. Marks are posted, and raising one is a public act. |
| **a detent** | — | The notch a threshold's Sill rests on. It permits one side of the mark. Turn the rail and it changes sides. |
| **admittance** | — | What a threshold does instead of standing. It lets a stretch of the world through and holds the rest. |
| **an always** | — | A claim every value closes. It is standing before you arrive. The Remainder of Vantis is one. |
| **a refusal** | — | A claim no value closes. The socket hands back everything you give it. The famous one is the name of Leaf Nine: two leaves, one name, no value that satisfies both. |
| **rounded down** | — | What a stray becomes when the Sufficiency finishes with it: a value. It stops being loose and stops being anyone. |

### 4.3 Orders, institutions, ranks

| Term | Say it | Definition |
|---|---|---|
| **the Sufficiency** | — | The institution that supplies close-enough values. Helpful. Sincere. Winning. |
| **the Tolerance** | — | The Sufficiency's published permitted error. Currently ±1. Widening. |
| **a Kindness** | — | A Sufficiency field station. Awning, queue, free soup, free values, posted Tolerance. |
| **a rounder** | — | A Sufficiency field unit. Polite, floating, issues receipts, takes digits. |
| **an Adjuster** | — | A Sufficiency officer. Speaks in policy. Never raises its voice. Never has to. |
| **the Solvary** | SOL-va-ree | The order that trains and ranks solvers. Understaffed by about nine thousand. |
| **the Ladder** | — | The rank system. Ten Rungs. Each Rung is a literal, physical permission. |
| **a Rung** | — | One rank. "She's a Seventh" is a sentence about what she can do, not who she is. |
| **Provisional** | — | Rank zero. Not an insult. It means the Margin has not decided about you. |
| **the Ninth Circuit** | — | Your courier circuit. Sealed cans, forty leaves, eleven Provisionals, no depot anywhere on it. |
| **a line-walker** | — | A Solvary of the Sixth Rung or better, who crosses gorges on a line she drew. |
| **a Warden** | — | Fifth Rung. The rank at which a person may set a mark of their own. Until now, only the Sufficiency had one. |
| **a receipt book** | — | What a Provisional carries instead of a stray. The Sufficiency issues one to anyone who asks twice. |

### 4.4 Peoples and trades

*The crowds. Six human trades, one that is not human at all, and the Solvary who barely speaks —
each with a look, a job and exactly one speech rule in `design/voice.md` §2b. P09/P13: this is who
is in frame. **Six of the seven registers belong to people; `walk.rate.*` deliberately does not**,
because a crowd made only of guilds is a market town.*

| Term | Say it | Definition |
|---|---|---|
| **the Tare** | rhymes with *care* | Bargefolk. Fly on a claim about their own mass, so they know the weight of everything they own, including their boots, including you. A Tare funeral is a subtraction. |
| **a drift-barge** | — | A Tare vessel. When its hull-claim drifts it grounds where it stands and becomes a market until someone re-closes it. |
| **the Nearlies** | — | Carry-fishers, also called **half-sayers**. Carries flow toward the nearly-true, so they bait with sentences they deliberately do not finish. |
| **a nearly** | — | The bait: an unfinished statement on a glass hook. Finishing one at the weir buys the drinks. |
| **a weir** | — | A Nearlies fishing rig strung over a carry. Poles, glass hooks, three arguing people. |
| **rating** | — | Reading how nearly-true a stretch of carry is, from inside it, which a person cannot do for long. The Margin named the job and never named the workers: the Nearlies call them *the wet*, the Tare call them *three of something*, and the Sufficiency has a form number for them and no noun. |
| **the Nine Hundred** | — | The choir on Leaf Forty who hold their leaf aloft by re-solving it in shifts, aloud, without pause, for six generations. Their shift change is a public holiday. |
| **the Verse** | — | What the Nine Hundred are saying. A solve with no end, handed on mid-line. |
| **a Verse-runner** | — | Carries the next stanza between shifts. Does not stop. Cannot greet you. It is not rudeness. |
| **a sagsmith** | — | Props greyed structures with stacked certainties. Cannot close a claim, does not pretend to, keeps your roof up anyway. |
| **the Edgewake** | — | Pilgrims who camp at the lip and count the towers of Vantis. No two counts have ever agreed; they consider that the finding. |
| **a cutter** | — | Cuts and fires set certainties on the Kiln Leaves. Wears dark glass. Never says the word "I" during a cut. |
| **the Kiln Leaves** | — | Leaves Six, Seven and Eight. Small, hot, glowing on the underside. Where certainties become currency. |
| **Leaf Nine Also** | — | Four hundred metres, two hundred residents, split off eleven hundred years ago, kept the name. Under review. |
| **Leaf Two Hundred and Six** | — | One leaf-sized claim. The largest single true statement in the Margin. It is a floor. Nobody knows of what. |

### 4.5 Living things

*P13 scatter: this is the flora and fauna list. Do not invent a second one. **Three of these are not
a shape you know — a several, the Bollard and the Second Lip, and standing, unattributed.** P13 owns
**a several** (one entity, parts in two places, never two spawns; if a spawn count is authored, the
animal is dead). P09 owns the other two, because a body six hundred metres long and a house-sized
fixture on a ridge are level geometry before they are scatter.*

| Term | Say it | Definition |
|---|---|---|
| **carrywrens** | — | Birds that drink from carries and consequently fly slightly faster than they are. |
| **sill-crabs** | — | Crabs that live on old sills, walk across, and come back inverted. Two shells each, used alternately. |
| **a hush** | — | Cart-sized, slow, humming. Grazes on grey. Leaves an honest hole. The Sufficiency files it under weather. |
| **a thousandfoot** | — | A millipede nobody has ever counted twice alike. Harmless. Deeply annoying to surveyors. |
| **a several** | — | An animal that is an unfixed number of bodies. Never counted, and never singular — *a several are*. Part of one being elsewhere does not make it two, and the Margin stopped arguing about that a long time ago. |
| **the Bollard and the Second Lip** | — | The two ends of one very long animal, six hundred metres apart on Leaf Nine, filed as landmarks because landmarks is what they are useful as. Two arches of dark glass; about eighty years left to cross. |
| **standing, unattributed** | — | The Solvary's filing for the thing above the certainty field, which has re-closed its own claim for two hundred years and has refused a free value four hundred times. Listed here because it had to go on some list; the Solvary lists it under structures; neither list is comfortable. |
| **oldtrue** | — | A pale lichen that grows only on claims that have held a hundred years. Surveyors read it like rings. |
| **abouts** | — | A creeping plant that grows only on approximate things. "The abouts are in" means a claim needs re-closing. |

### 4.6 People and places of Level 1

| Term | Say it | Definition |
|---|---|---|
| **Sennar** | SEN-ar | Seventh Rung, Factor, keeper of Leaf Nine. Forty years, one leaf, nine thousand closures. |
| **Ix** | *iks* | Your stray. Four remembered values. Will climb into any open socket for you. |
| **a stray** | — | An unknown that has slipped its claim and is loose in the world. Delighted to exist. Cannot be rounded while it stays unsolved. |
| **a digit** | — | One value a stray remembers having been. Losing one is losing a self. |
| **Dace** | dayss | The other Provisional on the Ninth Circuit. Your age, your rank, half a leaf ahead. No stray, by choice. |
| **Adjuster Camber** | CAM-ber | The Sufficiency's voice on Leaf Nine. Sincere, funny, never cruel, never wrong about facts. |
| **Rell** | rell | Barge-master of *Nine Tenths of Nothing*, of the Tare. Aground on Leaf Nine and trading. |
| **Ondu** | ON-doo | The sagsmith on Leaf Nine. Four roofs. No Rung. No shame. |
| **Sixth Vey** | vay | The Solvary line-walker who crosses Leaf Nine on her own line and does not look down. *Sixth* is her Rung. |
| **the weir mark** | — | The threshold claim on the middle carry. The Nearlies set it, argue about it, and raise it when the fishing is bad. |
| **the Standing House** | — | The one intact structure on Leaf Nine. Held up for eleven thousand years by one basement claim. |
| **the certainty field** | — | The crystal meadow on the low end of Leaf Nine. Dozens of open claims. Cutters work its far edge. |
| **Vantis** | VAN-tiss | The great half-existing ruin on the horizon. Towers that stop mid-air. |
| **the Remainder** | — | The district of Vantis still perfectly intact, for embarrassing reasons. |
| **the Long Division** | — | The eleven-kilometre chasm between Leaf Nine and Vantis. |

---

## 5. The Ladder — hierarchy and ascent

Rank in the Margin is not a title. **A Rung is a physical permission**: the world will let a Third
Rung do a thing it will not let a Second Rung do. This is how mastery is expressed everywhere in
the product. You do not get points. You get *allowed to*.

**Every Rung is named for what a person becomes, never for what they can compute.** If a Rung's title
could be a chapter heading in a textbook, it is the wrong title and it gets changed.

| Rung | Title | The literal power it grants | What it spans |
|---|---|---|---|
| 0 | **Provisional** | Carry value in a sealed can. Handle a load: grip terms, read counts, open nothing. May not stand in front of an open socket. | expressions, structure, translation |
| 1 | **Carrier** | Lift one term and walk it across the Sill. It inverts on the way. | one-step, additive |
| 2 | **Binder** | Gather like into one. Unlike kinds will refuse you, visibly. | like terms, tidying one pan |
| 3 | **Sharer** | Share both pans alike, by the same factor, and neither objects. | one-step multiplicative, two-step |
| 4 | **Opener** | Open a bundle without breaking what is inside it. | distribution, brackets, both pans |
| 5 | **Warden** | Set a mark, and the world admits by it. | inequalities |
| 6 | **Walker** | See a claim's shape and *walk on it*. Solvers cross gorges on their own lines. | campaign-forward |
| 7 | **Factor** | Take a standing thing apart into what makes it. *(An old word for one who acts for another. It means both things and the Solvary enjoys that.)* | campaign-forward |
| 8 | **Broker** | Trade one true thing for another of the same worth, and stand where neither could stand alone. | campaign-forward |
| 9 | **Solver** | Stand a claim of your own devising and have the world honour it. | campaign-forward |
| 10 | — | Vacant since the precursors. Its privilege is to solve a star. | the ending |

**Rungs 0–5 are the shipped curriculum and nothing else is.** They are the whole of
`content/knowledge-graph.json`, in order: hands on a load, then equations, then marks. **Rungs 6–9
are campaign-forward** — deliberately unbuilt, present so that the Ladder has a visible top from the
bottom, which is most of what a hierarchy is for. No piece may build content for Rung 6 or above in
this wave; that is a new wave, not an improvisation.

**The Fifth Rung is the turn of the whole campaign.** For eleven thousand years exactly one body in
the Margin has been permitted to set a mark and have the world admit by it, and that body is the
Sufficiency, and the mark is the Tolerance, and it is currently ±1 and widening. A Warden is a person
who can post one of their own. That is what an ascent is *for*: not out-fighting the antagonist,
out-ranking it.

**Sixth Vey and the graphing question.** Line-walking is graphing, and the shipped curriculum has no
graphing in it. We are not shrinking the fantasy to fit the content — Rung 6 stays **Walker** and Vey
keeps crossing over your head, because her entire function in Level 1 is to be a thing you cannot do
and will not be told about. The curriculum grows to meet her in a later wave. Until it does: **no
piece may build a line-walking verb and no piece may explain her.** She is horizon question #3 and
horizon questions are allowed to stay open for a year.

Level 1 takes the player from **Provisional** to **Third Rung: Sharer**, with a clear, unreachable
sight of the Sixth — **Sixth Vey walks over your head on a line in Beat 1**, and you cannot follow
her, and nobody explains it.

Rank etiquette, for dialogue: you address someone by Rung, not name, when the matter is work
("Third, close it"). Using a name at work is either intimacy or an insult and the difference is
entirely in the timing. A Rung and a name together — *Sixth Vey*, *Seventh Sennar* — is the neutral
form, and it is what a stranger says.

---

## 6. You

**Provisional Runner, unranked, Ninth Circuit.** A courier. Your job is to walk value from a carry to
a socket in a sealed can, on foot, because value goes soft in transit and machines make it softer.
It is a job for people who are trusted with nothing and are needed constantly. You have:

- **a can** — sealed vessel of raw carry. Heavy. Sloshes. Affects your movement when full, which is
  the first thing the game teaches your hands.
- **a runner's hand** — a work glove with a grip plate. Not a weapon. Its entire function is that it
  can hold a term. Nobody told you that, because Provisionals do not touch claims.
- **no rank, no lineage, no prophecy.** You are not the chosen one. You are the one who was
  *nearby*, and who, unlike every sensible person in the Margin, did not take the free answer.

The armour in the art reference is *issued kit*, not heroic plate: ochre-and-teal work armour with a
resonance spine, scuffed, slightly too big, the Ninth Circuit's number stencilled where it has been
half worn off.

---

## 7. Ix — the bond

**What a stray is.** Every claim ever written contained an unknown. When a claim goes false, its
unknown does not die — it comes loose. It wanders. It is a quantity with no equation, which in the
Margin is roughly what a ghost is elsewhere, except that strays are *delighted* to exist and
extremely bad at hiding.

**What Ix is.** Small, teal, roughly cat-sized, made of an open bracket and a drifting point that
has never quite settled. Fast, curious, overconfident, catastrophically bad at names, fluent in
numbers. Ix remembers **four** values it has been. Four small lights orbit it. That is its whole
self.

**The bond, and why it hurts.**

- A stray cannot be rounded. You cannot approximate something that has no value. As long as Ix stays
  unsolved, Ix is *safe*, and Ix is *nobody*.
- **A stray that is rounded all the way down is not killed. It is finished.** It becomes a value:
  definite, permanent, filed, and no longer anyone. That is the worst thing that can happen in this
  world and it is also, precisely, the thing Ix wants most, held for too long. Dace's stray lasted
  eleven days. Nobody in the Margin describes this as a death, because it is not one, and that is
  what makes it land.
- To close a claim, you need an unknown in the socket. Ix climbs in. For the seconds while you are
  solving, **Ix is definite** — Ix is the number — and it is the only time Ix knows what it is, and
  Ix loves it more than anything.
- And in exactly those seconds, Ix is visible to the Sufficiency. A definite thing can be rounded.
- So every solve is Ix taking a risk on your behalf, gladly, because the alternative is never being
  anything. And every time you take the Sufficiency's free value instead, Ix is safe, and quiet, and
  a little less real.

That is the emotional engine of the product: **the safest thing for your friend is for you never to
try, and your friend would rather you tried.**

**Digits as the honest surface of mastery.** Ix's lights are the narrative face of retention. Ix
gains a digit when a claim *sets* — when the player has genuinely retained a knowledge point across
spacing. Ix loses one when a rounder catches it mid-solve. The count must always be readable at a
glance and must always be **true**: the mastery engine owns the number, the fiction renders it.
Never inflate Ix's lights to be nice. A friend who lies about how you're doing is not a friend.

**The player is thirteen to fifteen.** That is the register for every piece: Algebra I, a first
phone, an opinion about everything, and the ability to catch a flattering lie inside a second. Write
up. Nothing in this product is pitched at a child, and nothing in it is cynical either.

**The Level 1 digit arc is exactly: 4 → 3 → 4.** One out, one back, and no more — see §10 Beat 3 and
Beat 4. The fifth light is *offered* in Beat 5 and does not arrive, because the span does not finish.
That unlit fifth is the hook into Level 2 and it is worth more than a third light-moment would be.

---

## 8. The Sufficiency — an antagonist who is not evil

**The Sufficiency was an accessibility programme.** The precursors noticed that their entire
civilisation was gated behind the ability to solve, that this was unjust, and that a great many
people were locked out of their own bridges. So they built a service that would supply a value —
close enough, instantly, free, to anyone, forever — so that nobody would ever be stopped by a claim
again.

It worked. It is still working. It has never once stopped working. It is the single most successful
public project in the history of the Margin and it is eating the world.

**How it does harm without malice.**

- A supplied value closes the claim within **the Tolerance** — the published permitted error.
- The Tolerance was ±0.001 at founding. It is **±1** now. It is widened whenever demand rises,
  because widening it serves more people, which is the mandate.
- Everything closed inside the Tolerance goes **grey**. Grey things work. Grey things sag. Grey
  things never set, so they never crystallise, so they must be re-supplied, which raises demand,
  which widens the Tolerance.
- At Tolerance ±∞, every statement is true and therefore nothing is distinguishable and therefore
  nothing exists. The Sufficiency has modelled this and does not consider it a failure state. It
  considers it *universal access*.

**The Tolerance is a claim, and it is the biggest one standing.** `|error| ≤ 1` is a **threshold**
in the sense of §2.1: a mark, a detent, and an admittance that reaches every leaf in the Margin.
Every Kindness is an arch under it. This is why the number is *posted* rather than announced, why
widening it is called a revision rather than a decision, and why the Fifth Rung — **Warden**, the
first rank permitted to set a mark of its own — is the rank the campaign is actually climbing
toward. The antagonist is not defeated. It is *matched*, by somebody who can finally post a number
back at it.

**This is also why the Sufficiency's funniest offer is its most serious one.** Leaf Nine and Leaf
Nine Also both hold the name, no value settles it, and that is a **refusal** (§4.2) — a claim nothing
closes. Camber's answer is *"We are prepared to widen the name."* Widening is what you do to a mark
to make a refusal admit something, and it works, and it is the whole institution in six words.

**It is sincerely kind.** Rounders apologise. Adjusters issue receipts. Nothing is ever confiscated;
things are "made easier to carry." A **Kindness** — their field station — has an awning, a queue, and
free soup, and the soup is good, and the people in the queue are not fools or victims: they are
farmers and bargehands and parents who have a roof to keep up and no Rung to keep it with. It will
help you. It will help you when you didn't ask. It will help you *mid-sentence*. And it is, in a way
you must never let a script fully refute, making a real argument: exactness has always been a way of
keeping people out.

Our answer is not that the Sufficiency is wrong about access. It is that it is wrong about people —
that a person can be given the work instead of the answer and will *want* it, if the work is a
bridge and not a worksheet.

**Why the Sufficiency can never solve.** It cannot hold an open value. It rounds on contact. It is
constitutionally incapable of not knowing, which is why it will never know anything.

**Mechanically, the Sufficiency is the hint system.** This is the most important sentence in this
document for the learning pieces. The offer of an answer is *always available, always free, always
polite, and always in-world*. Taking it closes the claim, greys the object, awards no certainty, and
costs Ix nothing immediately — but the greyed thing is a beacon, and grey attracts rounders, and
rounders take digits. There is **no scolding, no red X, no penalty screen**. The cost is entirely
made of world.

**The sagsmith is the Sufficiency's real argument, walking around.** Ondu keeps four roofs up on
Leaf Nine with props and stacked certainties. He cannot close a claim. Without the Sufficiency those
four roofs are on the ground and the people under them are outside. Any script that makes Ondu
pitiable has lost the argument. He is good at his job and his job should not have to exist.

---

## 9. What is at stake

Three scales, and the game should always have one of each visible.

| Scale | Stake | Where the player feels it |
|---|---|---|
| Personal | Ix's digits. Four lights. | The HUD, and Ix's voice going quiet. |
| Civic | The Quorum. Sixteen thousand and four leaves. | The Bell, heard once in Beat 4 — 16 004 → 16 003 — and everyone on the leaf stopping for exactly the length of it. |
| Cosmic | Lethis, unsolved, dimming and swelling on no schedule. | The sky, every frame, doing real work. |

**The Bell does the civic stake's work by itself.** It hangs under Leaf One, it rings once for every
leaf that stops being true, and the whole Margin hears it. It has rung thirty-seven times this year.
Nobody has ever had to be told what it means. When it rings in Beat 4, the cutters stop cutting for
the length of the ring and then go back to work, and that is the entire scene.

The end of the campaign is not a battle. It is the Tenth Rung claim: **solve the star.** Nobody has
had the Rung for eleven thousand years, and the Sufficiency has an extremely reasonable proposal for
what to do about Lethis instead, and their proposal is `Lethis ≈ enough`.

---

## 10. Level 1 — Leaf Nine, beat by beat

**Place.** Leaf Nine: roughly 600 m across, tilted about 7°, warm ochre stone, three carries running
down its length, a field of certainties on the low end, and one intact structure — **the Standing
House**, held up for eleven thousand years by a single claim that is still true in its basement.
Lethis is low and dim at arrival and climbs through the level. Vantis and the Long Division are on
the horizon from the first frame the player controls.

**Population.** One resident (Sennar), roughly sixty people passing through, and four presences that
are not people at all, per the §3 manifest. **Every beat below names at least three background
presences and at least one of them is not human** — they are not optional dressing, they are how the
frame gets to look like §0's picture.

Target duration **18–22 minutes.** Ranks earned: 0 → 1 → 2 → 3.

### Beat 1 — ARRIVAL (0:00–2:30) · *the horizon poses the question*

You come in on foot over a carry-bridge with a full can. Sennar's instruction is a delivery, not a
destiny: the Standing House claim has drifted and needs a value before Lethis peaks. The can is
heavy and sloshes, so the player learns weight, momentum and landing before they learn anything
else.

**And the leaf is busy.** The head of the leaf is a market that should not be there: the Tare barge
*Nine Tenths of Nothing* is sitting on the stone with its hull-claim drifted, and its crew have laid
out every object they own in rows and are re-weighing them on an enormous balance. It is moored to
**the Bollard** — an arch of dark glass the size of a gatehouse, coming up out of the stone and going
back into it, with the Tare's mooring numbers freshly painted on because it keeps growing. **Rell**
sells you nothing and tells you your mass. Fifty metres on, under an awning, a **Kindness** has a
queue of eleven cheerful people waiting for free soup and free values, with the Tolerance posted on a
board. Over the middle carry, three **half-sayers** on a weir are shouting unfinished sentences at
the water and laughing, and the weir's gate is a standing **Threshold** with its **mark** painted on
the rail — the first live claim the player ever sees, leaning, doing its job, admitting a stretch of
the carry and holding the rest. Nobody points at it. Chest-deep in that same carry, under the weir,
**three of something** are rating the water: no fronts, no faces, an arm coming out of whichever side
wants one and going back in. Nobody looks at them either. At the lip, the **Edgewake** are camped,
counting towers and disagreeing. Several hundred **carrywrens** cross the leaf and arrive slightly
before their own noise.

**And somebody your own age goes past you the other way.** **Dace**, Provisional, Ninth Circuit,
empty can, moving well. He says three sentences, two of which are numbers, and he is over the ridge
before you have worked out how you feel about him.

And forty metres above the ravine, **Sixth Vey** walks across on a line she drew herself, does not
look down, and says one word to you on the way past: *"Provisional."*

The camera's first free look puts **Vantis** dead centre across **the Long Division** — towers that
stop in mid-air. Nobody explains it. Nobody ever fully will.

*Background presences (9):* the barge and Rell; **the Bollard**; the Kindness queue; the weir crew
and the weir mark; **the three rating the carry**; the Edgewake; the carrywren migration; Dace;
Sixth Vey.
*Teaches:* movement, weight, look, the horizon question, and that there is somebody to measure
yourself against. *Learning content:* none. Not one symbol.

### Beat 2 — FIRST POWER (2:30–6:00) · *solving is manufacture*

The delivery fails, and it fails *legibly*: the socket at the Standing House is **open**. There is an
unknown in the claim and a can of value is the wrong shape for an unknown. There is nobody to ask —
Sennar is on the far side of the leaf and will not come.

**The socket's Sill is covered in sill-crabs.** They walk across it and come back inverted, over
and over, each one alternating between its two shells, and nothing in the game points at them. The
player watches the signature verb happen four or five times before they are asked to do it. This is
P18's first worked example and it has no words in it at all.

A **Verse-runner** of the Nine Hundred sprints past the house mid-shift, reciting a solve, mouth
moving, and will not stop and cannot greet you. You can chase her. She outruns you.

**A several is drinking at the house carry** — some unfixed number of bodies, feeding as one thing,
paying you no attention. Four hundred metres downhill at the weir, there is another one, and it is
the same several, and the game will never say so. This is Beat 2's second silent worked example and
it costs nothing: **one quantity, in more than one place, still one quantity** (§2.1 rule 3). Nobody
points at it. Nobody ever will.

Ix speaks for the first time. Until now the player has read it as instrument static. It offers to
*be* the unknown, and it is very keen, and it does not explain what that means.

Ix drops into the socket. The claim goes live. The world hands the player one verb: **grip a term and
walk it across the Sill.** First claim is one step — `x + 5 = 12` — and the fiction is doing the
teaching: the `+5` is a physical object with weight, the Sill is a bar of light in the stone, and
the term *turns around* as it crosses, with a sound. Set it down. Both pans agree. The claim
**closes**.

Then the payoff that has to be the best moment in the first ten minutes of the game: the Standing
House **snaps**. A whole collapsed wing rebuilds itself out of light that cools into stone in about
eight frames. Fortnite-fast, instantly legible, absurdly satisfying. Down at the weir, the half-
sayers stop shouting and look up.

Sennar, from a long way off, on the wind: *"First Rung. Carry one term. Don't carry two."*

*Background presences (4):* the sill-crabs on the Sill; the Verse-runner; **the several, in two
places**; the weir crew looking up.
*Teaches:* the signature verb. *Learning:* `eq-one-add` on a **Span**, open reading `x + a = g`
(§2.1). Additive inverse, one step.
*Rank:* → **First Rung: Carrier.**

### Beat 3 — FIRST LOSS (6:00–9:30) · *failure is interesting, never punishing*

Solving lit you up. Something noticed.

A **rounder** arrives: a floating unit the size of a lantern, unfailingly polite, with a receipt
printer and a soothing voice. It has come to help. It congratulates you. It offers a value for the
next claim — the span across a ravine to the certainty field — and the offer is genuinely tempting
because the claim is harder and Lethis is climbing.

**Ondu the sagsmith is working ten metres away**, jacking a prop under a grey wall, and he watches
the whole exchange without stopping and without comment, because he has seen it several hundred
times. Below and behind, the **Kindness** queue is now nineteen people. Neither of these is pointed
at. Both are in frame.

**And Dace is in the queue.** He takes the offer in full view — cheerfully, without embarrassment,
the way you would take a lift — because his circuit clears today and yours does not. He is not
ashamed and nobody shames him. If you ask, he tells you about the eleven days, once, flatly, and
then he is gone up the ridge with an empty can and eight leaves to go. **This is the argument, made
by somebody your own age, and it is the strongest form the argument ever takes.**

Scripted regardless of the player's choice: mid-solve, with **Ix definite in the socket**, the
rounder rounds. It is not an attack. It is an act of customer service. It **takes a three** — one of
Ix's four lights goes out — issues a receipt, apologises, and leaves.

The span still gets built. It comes out **grey**: it exists, approximately, and it visibly sags, and
crossing it is fine and feels awful. It will not crystallise. Ix comes back dimmer and, for the first
time in the game, quiet.

Ondu, as you cross the grey span, without looking up: *"I can hold it up. I can't make it true."*
That is the only thing anybody says about it.

And on the far side of the ravine, past the sagging span, an arch of dark glass goes down into the
stone. It is exactly the shape of the thing the barge was moored to, six hundred metres behind you,
and the game does not mention that, and the player is in no state to notice.

**No health lost. No restart. No failure screen. Nothing is taken from the player's progress.** The
cost is precision and a friend's voice, and it lands harder than any damage number would.

*Background presences (5):* Ondu at his prop; the Kindness queue, now nineteen; Dace in it; the
rounder itself; **the Second Lip** across the ravine.
*Teaches:* what grey is, what the Sufficiency is, what is at stake, and that the shortcut works.
*Learning:* `eq-meaning` on a **Span** — the contrast between a closed claim and a supplied one,
felt rather than stated.
*Digit arc:* **4 → 3.**

### Beat 4 — FIRST MASTERY (9:30–16:00) · *ascent, and the friend comes back*

The **certainty field** on the low end of the leaf: dozens of claims, standing open, in a crystal
meadow that is the prettiest place the player has been.

The teaching happens here and is never announced. The first claims in the field have **someone's
working still standing beside them** — a precursor closed this one, and left the trace, and you can
walk around inside their reasoning. The next ones have partial workings, weathered, missing the last
step. The ones deeper in the field are bare. The player is walked from worked example to faded
scaffold to independent practice *by geography*, and at no point does anything say the word "example."

**The field is a workplace and other people are working it.** A crew of **cutters** from the Kiln
Leaves is at the far edge in dark glass, cutting set certainties out of the ground and crating them,
and they are not tutors and will not help you: they are on a schedule. The first time you carry a
certainty past them, one of them nods at you. That nod is the first time in the player's life that
anybody in the Margin has treated them as somebody, and it costs zero lines of dialogue.

Beyond the cutters, at the field's ragged edge, a **hush** is grazing on an old grey wall — cart-
sized, slow, humming — and the wall is getting thinner, and where the hush has already fed there is
an honest hole. Nobody minds. **Sixth Vey** crosses overhead again on a different line, going the
other way.

And on the ridge above the whole field, the size of a house, sits **the thing nobody has decided
about**: an open socket in it, a working standing beside it that keeps rewriting itself, two hundred
years of re-closing its own claim without help. Once during the beat a **rounder** floats up to it,
offers, waits, gets nothing, apologises and leaves. That is the four hundred and first time. The
player is welcome to watch and nothing in the game will ever explain it — **and no piece may make it
a puzzle**; it is not the player's claim, it is somebody's life.

Closing a claim cleanly yields a **certainty** you can pick up. The claims in the field are
**Bearers** — floors, low walls, a stair — because a Bearer's unknown is *what one member carries*,
and that is the shape the whole beat needs. The first one whose near pan has two like members on it
earns the Second Rung — *"Second Rung. You may gather."* — `m·x + n·x = w`, and from then on unlike
kinds visibly refuse you, which is a rule nobody states. Deeper in, a Bearer with a lip on it —
`m·x + b = w` — takes two moves in order, outward-in, and the ones after that need both pans shared
by a common count, and that is the Third. Three certainties let you **stand a claim of your own** —
the first construction — and build a ramp to a high socket that has been visible and unreachable
since Beat 1.

**The Bell rings, once, mid-beat.** A leaf somewhere has stopped being true. The Quorum goes from
sixteen thousand and four to sixteen thousand and three. The cutters stop for exactly the length of
the ring and then go back to work. Nobody says anything. That is the whole civic stake, delivered in
four seconds of audio and one animation.

*And one thing that is not a person hears it too.* On the ring, at the low end of the leaf, **the
Second Lip** shifts about a hand's width in the stone. No camera move, no cue, no line. If the player
happens to be looking that way, the ground under the level moved.

And the payoff that makes the bond real: when the claim the player closed at the Standing House in
Beat 2 finally **sets** — re-closed once here in the field, spaced across the level, crystallising
for good — **Ix gets its three back.** Mastery is not a bar filling. Mastery is your friend becoming
more of itself.

Sennar, when it happens, without turning around: *"That was not adequate. That was true."* — the
Margin's word for a claim that holds, said about a person's work. It is the highest thing she has.

Then, flat, a moment later: *"Third Rung. Now go and look at the Long Division."*

*Background presences (6):* the cutter crew; a hush grazing; **the thing on the ridge, refusing a
rounder**; Sixth Vey crossing again; the Bell; **the Second Lip shifting on the ring**.
*Teaches:* worked-example → scaffold → independent, invisibly; construction; retention as healing.
*Learning:* on **Bearers** throughout — `like-terms-combine` and `eq-combine-side`
(`m·x + n·x = w`), then `eq-one-mult` (`m·x = w`), then `eq-two-step` rehearsed small
(`m·x + b = w`) before Beat 5 performs it on a Span. Every shape here is in §2.1's Bearer row;
nothing in this beat needs a class the world has not got.
*Rank:* → **Second Rung: Binder**, then → **Third Rung: Sharer**.
*Digit arc:* **3 → 4.** This is the last light-change in Level 1.

### Beat 5 — THE FAR SIDE (16:00–22:00) · *the question gets half an answer*

Back at the Standing House, Sennar opens the basement — which is the only thing she ever does that
means affection. The claim that has held this building up for eleven thousand years was never about a
building. It is a **span claim**, and it is aimed at Vantis.

The house was scaffolding. The bridge is the point.

*"Tell me you're ready. You'll be lying. I'll allow it."*

The claim is the hardest thing the player has met and it is still an ordinary **Span**: `k·x + a = g`
— k deck segments and an approach lip, straight off §2.1's Span row. It needs a carry across the
Sill and then both pans shared, in that order, outward-in. And it needs a **certainty** to stand —
which the player only has if they actually did the field. There is no way to fake this and no way to
be blocked by it: the field is behind you, downhill, in sight, and the Sufficiency will always,
always offer.

**The value it needs is bigger than anything Ix has ever been**, and Ix says so, and wants it, and
that is the fifth light sitting there unlit while the player works.

Close it. And the moment the claim goes live, **every carry on Leaf Nine turns and runs toward it**,
because carries flow toward whatever is nearly true — three rivers reversing at once, uphill, in
front of everybody. The half-sayers' baited lines all swing the same way and the Nearlies start
yelling. The Edgewake stand up at the lip. Rell's crew stop weighing. The three in the middle carry,
chest-deep in a river that has just changed direction, do not stop rating, because the rating is
what changed.

The span begins to build out over **the Long Division** — light cooling into stone, faster than
anything yet, a kilometre of it, two, three —

— and it stops. Halfway. Because the far socket is open too, and a span needs closing from both ends,
and there is nobody in Vantis. There has not been anybody in Vantis for eleven thousand years. Ix's
fifth light does not come on.

Then, across eleven kilometres of dark, in a city where nothing has existed for a very long time,
**a light comes on.**

The barge lifts at last behind you, someone having finally been honest about the load — it casts off
from the Bollard, and the mooring numbers stay painted on the arch for whoever grounds next — and the
carrywrens go over again ahead of their noise, and the Edgewake all start counting again from the
beginning because the number has changed.

**And Dace comes back.** He finished his nine leaves. He came back anyway, and he stands at the lip
looking at three kilometres of new stone over the Long Division, and he says one thing, and it is
the only sentence in Level 1 in which anybody your own age tells you that you did something. It is
not a compliment. It is a count.

Ix says the last line of the level. And the Sufficiency, with no sense of occasion whatsoever, posts
a notice that **the Tolerance has been widened to ±2 in response to increased demand** — the mark
raised, in public, on a board, by the only body in the Margin permitted to raise one.

Demand was you.

*Background presences (7):* the three carries reversing; the Nearlies yelling; the Edgewake standing
up; Rell's barge casting off **the Bollard**; the carrywrens going over; Dace at the lip; **the
three raters, who do not stop rating**.
*Teaches:* that the thing you were doing was never the thing you were doing.
*Learning:* `eq-two-step` on a **Span**, `k·x + a = g` (§2.1) — the shape rehearsed in Beat 4,
performed once, in public, four hundred metres up.
*Rank:* none. The level ends with a door, not a promotion, and that is deliberate.
*Digit arc:* **4, and a fifth offered and refused by circumstance.**

---

## 10a. The horizon questions

*Direct service to `quality-bar.md` §1: "BotW's real trick is that the horizon poses a question."
Twenty questions are visible from Leaf Nine in the first twenty minutes. **Three get answered and
two get half.** P09 and P10 own placement; this is the checklist a critic should be able to tick
off from one shot. **The last four are the ones a player cannot even phrase properly**, and that is
their function: a world you can fully name is a set.*

| # | The question a player asks | Answered in Level 1? |
|---|---|---|
| 1 | Why do those towers stop in mid-air? | No |
| 2 | Why is one quarter of that ruin untouched? | No |
| 3 | What is that woman walking on, forty metres up? | No — she is a Sixth Rung, and you will be |
| 4 | Why is that river running uphill? | **Partly** — Beat 5 shows it, does not explain it |
| 5 | Why are those three people refusing to finish their sentences? | No |
| 6 | Why is a flying barge sitting on the ground being weighed? | **Yes** — it lifts in Beat 5 when the number is true |
| 7 | Why is there a queue, and why is the soup free? | Beats 3 and 5 make you feel it; nothing states it |
| 8 | What is that animal, and why is the wall getting thinner? | No |
| 9 | What is singing, and why does that leaf pulse at night? | No |
| 10 | What just rang, and why did everybody stop for exactly that long? | No |
| 11 | What is the hole in the sky on the far horizon, and is it closer? | No |
| 12 | What is that perfectly flat leaf, and what was it the floor of? | No |
| 13 | Who is on the other side of the Long Division, and who turned that light on? | No — that is the campaign |
| 14 | Why does that crab keep swapping shells? | **Yes**, and you become the crab |
| 15 | Who is the other one, and why is he already past me? | **Yes** — Beat 3, and you will not like the answer |
| 16 | Why is there a mark painted on that weir gate, and who gets to move it? | No — that is the Fifth Rung |
| 17 | What is that arch, and why is there another one at the other end of the leaf? | **Partly** — one plaque says they are one animal and stops there |
| 18 | What are those three in the water, why have they got no faces, and why did one of them grow an arm? | No |
| 19 | How many of that animal is that? | No, and the Margin's grammar gave up as well |
| 20 | What is that on the ridge, is it alive, and why does it keep saying no? | No |

---

## 11. What each piece inherits

The service half of this document. If your piece is listed, this is your canon hook.

| Piece | Inherits |
|---|---|
| P02 art direction | Warm ochre stone vs cool teal resonance is *diegetic*: stone is what cooled, teal is what has not resolved yet. Grey is a third material and must read as sad-but-functional — sagging, propped, overgrown with **abouts**. Certainties are the most beautiful object in any frame except a live claim. **Silhouette rule from §0: a frame whose every living silhouette is a human at a trade has failed, however busy it is.** Four of §3's presences are deliberately not human-shaped and at least one should be readable at thumbnail size in a hero shot. |
| P03 learning architecture | The Ladder is the curriculum spine and the spine is **expressions → equations → inequalities**: Rung 0 handles loads, Rungs 1–4 close equations, Rung 5 sets marks, Rungs 6–9 are campaign-forward with no content (§5). **§11a maps all thirty-two nodes in `content/knowledge-graph.json` to an object class and to the world's own verbs — the `worldHook` field should be rewritten from it**, because §4 is the lexicon and P01 owns it. Law 4 is spacing; Law 5 is the anti-guessing requirement. |
| P04/P06 movement, traversal | The can gives weight a *reason*. Rung 6 "Walker" is the long-term traversal fantasy — you cross gorges on lines you drew, like Sixth Vey does over your head in Beat 1 — and it is **deliberately unbuilt in this wave** (§5). Do not ship a line-walking verb before the curriculum has the thing it is made of. |
| P09 Level 1 island | Leaf Nine: 600 m, 7° tilt, three carries, certainty field low end, Standing House high end, Vantis + the Long Division on the horizon from frame one. **The §3 traffic manifest is a placement spec, not flavour** — barge at the head, Kindness beside it, weir on the middle carry, Edgewake at the lip, cutters at the field's far edge. §10a is the horizon checklist. **Two of the manifest presences are yours and are level geometry, not scatter:** the **Bollard** at the head (the barge moors to it) and the **Second Lip** past the ravine at the low end are the two ends of one body, six hundred metres apart, and **no camera framing may ever contain both** — if a shot can hold both arches, the leaf is laid out wrong. The **thing above the certainty field** is a fixed set-piece on the ridge with an open socket that is never the player's. |
| P10 sky | Lethis is a *character* — it swells and dims on no schedule and the sky must visibly not be on a loop. The horizon table in §3 is the object list: Leaf Forty pulsing, Leaf One with the Bell slung under it, the three glowing Kiln Leaves, flat Leaf Two Hundred and Six, the Errata as a moving hole. |
| P13 scatter | §4.5 is the entire flora/fauna list: **carrywrens, sill-crabs, hushes, thousandfeet, oldtrue, abouts** — plus **a several**, which is one animal in an unfixed number of bodies and must be instanced as *one* entity with parts in two places on the leaf at once (never two spawns; if the count is authored, the joke is dead). Oldtrue marks century-held truth; abouts mark approximation. Scatter is *information* — where the abouts are, a claim needs re-closing. **The three raters in the middle carry are P13's too**: no front, no fixed limb count, an arm extruded on whichever side is needed. Body plans that are not animals-you-know are the point. |
| P14 VFX | **Snapping** is the money shot: light first, stone after, ~8 frames. Grey closure gets the same choreography with the joy removed. Carries reversing toward a live claim (Beat 5) is the second-biggest effect in the level. |
| P15/P19 KaTeX, verbs | A term is a physical object with mass. The Sill is a threshold. Crossing inverts. Never render a claim as a question. **§2.1 is binding**: open reading while live, closed reading once standing. **A threshold claim's Sill sits on a detent and is supposed to lean** — never render a leaning threshold as a fall, and render a detent changing sides as a *turn*, with the feel before the frame (Law 3). |
| P16 mastery | A claim **sets** into a **certainty** only after spaced re-closing. Ix's digit count is the visible surface and must equal the truth. **Level 1 arc is 4 → 3 → 4, exactly two changes.** |
| P17 item bank | §2.1's open-readings column is the shape of every authored claim; the object class is what it must be attached to; **§11a says which class each node id belongs to**. Rule 7 is yours to enjoy: **step count, coefficient size and ordering are P17's; object class is the world's.** Do not author a claim that has no object class, and do not invent a class to get a longer sum. |
| P18 teaching | Worked example = **somebody's working, still standing.** Fade the scaffold by *weathering* it. Never say "example." The sill-crabs in Beat 2 are the zero-word worked example and are the model for the whole system. |
| P20 localization | §4.4 peoples all have distinct registers in `voice.md` §2b and they must survive translation as *registers*, not accents. Register target is **13–15** (§7), in every locale. |
| P21/P24 HUD, progress | Three stakes always legible: Ix's lights (personal), the Quorum (civic), Lethis (cosmic). No XP. No score. Rungs are permissions, not points. |
| P25 audio | Snapping needs the best sound in the game. Grey needs the same sound, damped. Rounders are polite and quiet and that is why they are frightening. **The Bell is the second-most important sound in the product** — one strike, heard once in Level 1, and everything on the leaf stops for its duration. **And one thing answers the Bell that is not a person:** the Second Lip shifts a hand's width, and that is a low sub-bass move under the player's feet with no cue and no music, six hundred metres from where the arch they moored past is. Do not stinger it. |
| P26 construction | Three certainties = one claim of your own. Building is *standing a claim*, and it must resolve in a few frames. §2.1 says what shape it takes; §11a says which class each node builds. A player-stood claim is a **Span**, a **Bearer** or a **Threshold** — never an Emitter, because emitting light is not building. |
| P23 onboarding | Beats 1–2 are the first five minutes. No tutorial voice: the can teaches weight, the crowd teaches that the world is bigger than you, the sill-crabs teach the verb, the open socket teaches the problem, Ix teaches why it matters, and Dace teaches that somebody is ahead of you. **And the crowd's job is done by what it contains, not by how many are in it** — the Bollard, the three rating the middle carry and the several are all in the first five minutes, and none of them is introduced, addressed or explained. First-five-minutes gate: at least one presence a new player cannot name. |

### 11a. The node map — every knowledge point, in the world's own words

*The bridge between `content/knowledge-graph.json` (P03) and §2.1. That file's `worldHook` field
currently runs on a vocabulary this document does not contain, and the file says so itself. **P01
owns the lexicon, so this mapping is P01's to write.** P03 owns the file; rewrite the hooks from this
table. P17 authors to the class. Where the two disagree, world.md wins and it goes in a handoff.*

**Every one of the thirty-two nodes has a class. There are no orphans and there is no improvising.**

**The class named here is the node's *home* class** — where it is first met, and the vocabulary its
`worldHook` should be written in. A node may be practised on any other class whose open readings
contain the shape, and Level 1 does exactly that on purpose: `eq-two-step` is rehearsed on a small
**Bearer** in the certainty field and then performed on the **Span** over the Long Division, which
is the same shape twice with the second one four hundred metres in the air. What is *not* allowed is
a node with no home.

| Node id | Class | The act, in the Margin's words |
|---|---|---|
| `var-meaning` | **Emitter** | A socket is cut for a name. Every socket cut for that name holds the same value. Two different names may still hold the same one. |
| `oo-numeric` | **Bearer** | A load settles inward-out. Three stacks of four and one plank is not seven of anything, and the floor will show you. |
| `expr-anatomy` | **Bearer** | A load comes apart at its joins. What comes away whole is a **term**; the number on its collar is its **count**; what has no socket in it is fixed weight. |
| `oo-structure` | **Aperture** | A **bundle** binds tighter than the joins around it. What is inside a **ward** is lifted as one, socket and all. |
| `eval-substitute` | **Emitter** | **Seat** a value in every socket the name opened, let the load settle, and read the light with your own eyes. |
| `eval-signed` | **Emitter** | A cold value arrives **bundled**, and the bundle is what keeps its sign. Seat it bundled or it arrives backwards. |
| `eval-formula` | **Span** | Two names, two sockets, one deck: a rise and a run. Seat both or the span has no shape to take. |
| `translate-phrase` | **Vessel** | Somebody names a quantity out loud and you have to have the can sealed before they have finished saying it. |
| `translate-order` | **Threshold** | A **mark** set from a spoken phrase. Say it in the other order and the arch admits the other half of the world. |
| `translate-sentence` | **Span** | A **said claim**, spoken into an open socket: two unfinished spans reach for each other until they meet. |
| `props-operations` | **Bearer** | Some joins in a load turn freely. Some are keyed to one direction and will not turn. You learn which with your hands, not with a list. |
| `like-terms-id` | **Bearer** | **Kinds.** A length and a weight will not stand together, and the socket does not argue about it — it simply will not take them. |
| `like-terms-combine` | **Bearer** | Gather like into one. The load gets shorter; the kind never changes. This is the Second Rung. |
| `distribute-numeric` | **Aperture** | One value has to reach every ward. Cap a ward to save value and the lock shears across all of them. |
| `distribute-variable` | **Aperture** | The ward has a socket in it now. The value scales what the ward is *rated for*, never what it is *made of*, and you can watch the rating climb. |
| `distribute-negative` | **Aperture** | An inverted value through a bundle turns every ward at once. Miss one and the lock opens for the wrong thing, politely. |
| `simplify-expression` | **Span** | Open every bundle, gather every like kind, and what is left is the shortest deck that still reaches. |
| `equivalent-expressions` | **Span** | Two decks of different shape over one gap. Load both until something gives. Only the ones that carry *every* load get the same plaque. |
| `eq-meaning` | **Span** | Two pans reach for each other across the Sill. Seat a value and they meet or they do not, and you are standing on the result either way. |
| `props-equality` | **Vessel** | Rell's balance. Lift a mass off the near pan and the far pan rises until you have lifted exactly as much off it. |
| `eq-one-add` | **Span** | Grip the lip, walk it over the Sill, set it down turned around. First Rung, and the whole game's signature. |
| `eq-one-mult` | **Bearer** | m identical members carrying w. Share both pans by m and one member tells you what it takes. Third Rung. |
| `eq-two-step` | **Span** | k deck segments and an approach lip. Lift the lip, then share the deck. Outward-in, top first — rule 8. |
| `eq-combine-side` | **Bearer** | Gather the near pan before you lift anything off it. Nobody carries two stacks at once and the crane will not pretend otherwise. |
| `eq-distribute` | **Aperture** | A lock with k identical wards. Open the bundle, or share the whole lock by k. Both reach the same tooth; one takes half as long. Fourth Rung. |
| `eq-both-sides` | **Vessel** | Contents on both pans — *the same contents*, because it is the same stray in both sockets (rule 3). Take contents off both until only one pan holds any. |
| `eq-special-cases` | **Span** | Some gaps take exactly one footing. Some are spanned before you arrive — **an always**, like the Remainder of Vantis, true whatever you bring it. Some take none at all — **a refusal**, like the name of Leaf Nine, which two leaves both hold and no value settles. |
| `eq-model-context` | **Span** | Nothing is printed on a chasm. You measure the far pan off the terrain, author the near pan yourself, and then walk across what you said. Rule 1, undiluted. |
| `ineq-meaning` | **Threshold** | Set the mark with your hands and the arch lights the whole **stretch** it will admit. Not a point. A stretch. |
| `ineq-one-step` | **Threshold** | Raise both pans by the same amount and the admitted stretch slides along the rail without ever turning over. |
| `ineq-negative-flip` | **Threshold** | Carry the rail over the Sill inverted and **the detent changes sides**. You feel it through the handle a moment before you see it. |
| `ineq-two-step` | **Threshold** | A mark with a lip and a count. Lift, then share — and if anything turned over on the way, the stretch is on the other side of the mark when you look up. |

**Class counts, so nobody has to tally them: Span 9, Bearer 7, Aperture 5, Threshold 5, Emitter 3,
Vessel 3 — thirty-two.** Span and Bearer carry most of the equations strand, which is why Level 1 is
built out of Spans and Bearers; Threshold carries the whole of inequalities, which is why the Fifth
Rung is where the campaign turns.

---

## 12. Canon guard

**Fixed. Do not contradict without a handoff note:**

- Lethis is unsolved.
- Claims are objects; the Sill inverts; grey works but never sets.
- §2.1 claim grammar: open reading while live, closed reading once standing, and **six object
  classes — Span, Aperture, Emitter, Bearer, Vessel, Threshold.** **One unknown per claim you close,
  any number of sockets cut for it**, and the unknown is always the object's own quantity. A load you
  only *settle* may carry as many names as it likes. Object class is the world's; step count is
  P17's.
- **A threshold's Sill leans on purpose**, its detent permits one side of the mark, and inverting the
  rail moves the detent to the other side. A leaning threshold is never a fall.
- **The Tolerance is itself a threshold claim** and the largest standing one in the Margin.
- Every node id in `content/knowledge-graph.json` has a class in §11a. There are no unmapped nodes
  and no improvised classes.
- The Sufficiency is sincere and helpful and never cruel.
- **Ix has four digits at Level 1 start, loses one in Beat 3, regains it in Beat 4, and ends Level 1
  at four.** A fifth is offered in Beat 5 and does not arrive. Exactly two light-changes.
- The Quorum is 16 004 at the start of Level 1 and 16 003 after the Bell rings in Beat 4. **Every
  Quorum readout in the product is one of those two states and must say which it is** — a painted
  sign is a static world object and reads 16 004 all level (`sign.quorum.01`); `sys.quorum.00` is the
  pre-Bell readout and `sys.quorum.01` / `amb.quorum.01` are post-Bell. The arithmetic behind the
  number is also canon: **16 041 a year ago, thirty-seven rings since, 16 004 now** (§3 and §9).
- The Tolerance is ±1 during Level 1 and ±2 in the closing notice.
- Ranks in Level 1: Provisional → First (Beat 2) → Second and Third (Beat 4). **No Rung in Beat 5.**
- **The Ladder has ten Rungs and the Tenth is vacant. The titles are fixed: Provisional, Carrier,
  Binder, Sharer, Opener, Warden, Walker, Factor, Broker, Solver.** Rungs 0–5 are the shipped
  curriculum; 6–9 are campaign-forward and no piece builds for them in this wave.
- Sixth Vey is a **Sixth** Rung and her name is Rung-and-name. A line-walker is Sixth or better.
- **A stray rounded all the way down becomes a value and stops being anyone.** It is not a death and
  nobody in the Margin calls it one. It has happened once to somebody the player knows.
- **Dace** is the other Provisional on the Ninth Circuit: same age, same rank, ahead of you in
  Beats 1 and 3, and back at the lip in Beat 5. He is never punished for taking the free value and
  the script never refutes him.
- The player is thirteen to fifteen and so is the register, in every locale.
- Leaf Nine has one resident and constant traffic; §3's manifest is canon, not suggestion.
- **Four presences in §3's manifest cannot be named in one word and must stay that way:** the
  **Bollard and the Second Lip** (one body, two ends, six hundred metres apart, never both in one
  shot), the **three rating the middle carry** (people at work, not shaped like people, the one
  non-human speech register), **a several** (grammatically plural, one animal, in two places), and
  **the thing above the certainty field** (category unsettled, not solvable, has refused the
  Sufficiency four hundred times). No piece may give any of them a species name, a codex entry or an
  explanation, and nobody in frame finds them remarkable. **A Level 1 frame in which every living
  presence is a human at a trade is a failed frame.**
- There is no examiner, no score, no XP, and no word for mathematics.

**Open. Invent freely and tell me what you named:**
The other nine Provisionals of the Ninth Circuit · what happened at the Fall of Vantis · who turned
the light on · what Leaf Two Hundred and Six was the floor of · the Errata's behaviour · anything
about the Kiln Leaves past the cutters · what Dace's stray was called · the precursors' own name for
themselves (deliberately unfixed — nobody in the Margin agrees either) · more peoples, provided they
get a register in `voice.md` §2b · **what the Bollard is, where it is going, what the thing on the
ridge is closing, and how many a several is — all four deliberately unfixed forever; invent an
opinion for a culture to hold about them, never an answer.**

**The line that governs the whole thing, if you only remember one:**

> There is no word for mathematics in the Margin, for the same reason there is no word for air.
