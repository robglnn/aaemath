# Art direction — Variable Star

Binding for every builder who writes a shader, a material, a light, a post pass, a UI surface or a
camera framing. `design/palette.json` is the machine-readable half of this document; every colour and
every threshold named here lives there, and nowhere else.

> **Read §0 first.** §1–§15 answer one question — *how do I photograph `reference/brief-hero.png` in
> real time* — and they answer it with fifty-odd verified constants. §0 answers the other one: *what is
> in front of the camera*. It is the binding of `design/world.md` into this file, it is the section that
> decides whether two builders who both score 30/30 produce the same world, and where the painting and
> `design/world.md` disagree, **§0 says which one wins and it is never the painting.**
>
> **Read §15 second.** §1–§14 describe one instant. §15 describes what has to be true once anything
> moves, and `design/quality-bar.md` §1 ranks that *above* everything else in this file: "Readability
> under motion beats detail at rest. If it turns to noise while running, it is wrong." A frame that
> scores 30/30 here and fizzes when the player turns has failed the bar, not passed it.

## Three classes of number, and why the difference matters

This document contains three kinds of quantity and they do **not** carry the same weight of evidence.

- **Sampled** — read straight off `reference/brief-hero.png`: a hex, a census share, a percentile, a
  ramp stop. Anyone with a PNG decoder reproduces these exactly.
- **Solved** — recovered from a *fit*: the scrim's alpha, the hologram veil's compression, the
  key : fill ratio, the ink width percentiles, the emitter peak. These are the numbers a builder
  actually types into a plate or a shader, they are the ones that are hardest to measure, and they
  are the ones that were wrong in round 1.
- **Temporal** — budgets on the *difference between two frames*. **The reference is a single painted
  still and cannot be measured for any of them.** Every number in §15 is therefore *authored*, and
  §15 says so and gives the reasoning for each. They are checked on **our** captures, not on the
  painting, which is why §15 ships with a capture tool as well as a threshold.

Round 1's auditor checked twenty-seven frame-wide census statistics — that is, it re-checked only the
sampled half — and reported 27/27 while two of the three solved constants a critic re-derived by hand
were wrong. Round 2 added a section that re-derives every solved constant directly. Round 3 adds the
third section, because **all fifty-odd numbers in rounds 1 and 2 were computed on one PNG of one
camera position at one instant**, and none of them can see dither fizz, specular shimmer, ink crawl,
bloom pop or exposure pumping.

**You can check your work.**

```bash
# one frame
node review/art-audit.mjs <shot.png> --hero=x0,y0,x1,y1 [--holo=…] [--emitter=…] [--require-solved]

# a sequence, one fixed simulation step apart — this is the part that judges motion
node review/p02-motion-capture.mjs --mode=static --frames=6 --out=review/shots/<piece>/motion-static
node review/art-audit.mjs --seq=review/shots/<piece>/motion-static --hero=x0,y0,x1,y1 --require-motion
```

| frame or sequence | invocation | census | solved | motion |
|---|---|---|---|---|
| `reference/brief-hero.png` | `--hero=0.276,0.276,0.425,0.960 --require-solved` | **29/30** | **11/11** | **n/a — it is a painting** |
| `review/p02-crops/negative-control.png` | `--hero=0.470,0.360,0.530,0.640 --holo=0.50,0.28,0.80,0.64` | **10/30** | **1/10** (+1 n/a) | — |
| `review/p02-crops/motion-good/` (synthetic, temporally clean) | `--seq=… --hero=0.288,0.280,0.415,0.955 --require-motion` | 13/30 | 6/9 (+2 n/a) | **10/10** |
| `review/p02-crops/motion-bad/` (synthetic, commits §15's temporal sins) | `--seq=… --hero=0.288,0.280,0.415,0.955 --require-motion` | 13/30 | 6/9 (+2 n/a) | **2/10** |

Those invocations are part of the record, not a detail: the negative control's census score is not
reproducible without its `--hero` box, and its `V1` result is not reproducible without its `--holo`
box. Round 2 published "12/27 and 2/10" with neither box written down; round 3 fixed the negative
control's row and published the two motion rows three lines later **with no `--hero` box recorded at
all**, so neither of them reproduced either. Both are recorded above, and the auditor now prints its
own `argv` into the first line of every saved report, so this particular failure cannot recur.
Boxes are arguments; arguments get recorded.

**The reference scores 29/30, not 30/30, and the one it fails is `C12`.** `C12` is the grey-material
budget §0.2 adds. `reference/brief-hero.png` carries 1.23% of frame in the grey class against a 2%
floor, because it is a beautiful hero vista of a world that had not been written yet — it has no grey
in it, no non-human presence in it, and a continuous canyon floor where this world has open sky. That
is the finding, it is deliberate, and §0 is what it is for. **A render that matches the painting
exactly also scores 29/30 and is also wrong.**

Pieces that own a UI plate or the hologram **must** run with `--require-solved`. Pieces that own a
material, a light, a post pass, an animation or a camera **must** run with `--require-motion`, which
turns "no sequence given" and "could not measure" into failures instead of silent skips.

A rule the auditor cannot check is a rule this document states as prose and a critic checks by eye.
Both kinds are binding; only one of them is cheap.

## Which side of the tonemap every number lives on

The document never used to say, and it matters more than any single constant. A **scene-referred**
number is an input to the renderer — an albedo, a light intensity, a roughness. A **display-referred**
number is a property of the finished 8-bit sRGB frame — a luminance, a census share, an alpha you can
measure, a percentile. §10 mandates a filmic curve with a soft shoulder, and that curve moves *every*
display-referred number. Typing a display-referred constant into a shader is the most expensive
mistake available in this file.

| section | stage | what that means for you |
|---|---|---|
| §2 light rig — colours, intensities, angles | **scene-referred** | shader inputs; feed `linear` triplets |
| §2 key : fill 6.2 : 1 (`K1`) | **display-referred** | measured on the final PNG. Through a soft shoulder this is a *much* larger scene ratio. Calibrate by capturing, not by dividing two light intensities |
| §3 shadow family multipliers | **display-referred** | the mechanism (hemisphere fill colour, bounce colour) is scene-referred; the ×0.28 / ×0.13 are what must come out |
| §4 both shading ramps | **display-referred** | pixels off the finished frame. Their albedos (`rock.albedo`, `hero.armour`) are scene-referred |
| §5 metalness, roughness, albedo | **scene-referred** | — |
| §5 ink width, blown-core share | **display-referred** | the ink is a post pass; it is applied *after* the curve |
| §6 silhouette, §7 composition | **screen-space** | fractions of frame; the tonemap does not move them |
| §8 veil `fixedPointY` 0.44 | **display-referred** | the quad composites in **linear, before** the curve. 0.44 is what must come out the other end. Verify with `V1` on a capture; never type 0.44 into a blend |
| §8 glyph white Y 1.000 | **display-referred** | see below |
| §9 colour budgets | **display-referred** | — |
| §10 percentiles, clipping, dither | **display-referred** | the dither is the **last** operation, after the curve, at 8-bit quantisation |
| §11 UI scrim alpha, 4.5 : 1 contrast | **display-referred** | **UI composites after the tonemap.** If the scrim goes through the curve, `alphaPeak` 0.91 is not the alpha the player sees and the contrast floor is not the contrast they get |
| §15 motion budgets | **display-referred** | differences between two final frames — the only place temporal noise exists |

**The one contradiction this resolves.** §10 requires a soft shoulder *and* requires that nothing clip
to pure white except emitter cores, the sun and KaTeX glyphs. §8 requires the glyphs at exactly
Y 1.000. Both are correct, and here is how they meet: **KaTeX glyphs are driven above 1.0 in linear and
clip *through* the curve.** Author the glyph layer's emissive at **≥ 4× the linear value that the curve
maps to Y 0.99** — with a soft shoulder that is what it takes to land on 1.000 rather than 0.97 — and
budget the result inside §10's clipping allowance: the reference's 1 925 pure-white pixels are
**0.046% of the frame** against a 2% ceiling. The alternative, permitted only for DOM KaTeX in the HUD,
is to composite the glyph layer *after* the curve, where it never meets the shoulder at all. What is
**not** permitted is a hard clamp before the curve, which is anti-pattern 15.

---

## 0. What this world is made of

`design/world.md` is the other binding document this file has to answer to, and §11 of it hands this
piece four named hooks. Rounds 1–3 inherited none of them: they answered *how do I photograph the
brief's hero illustration in real time* with fifty-odd verified constants and never once asked what
the world is. Two builders can follow a document like that perfectly and produce two worlds that share
a grade and share nothing else — and the world they will converge on is the illustration with a camera
in it, which is precisely the thing the quality bar exists to beat. §0 is the fix, and every rule in it
is a number or a gate.

The four hooks, verbatim from `world.md` §11:

> Warm ochre stone vs cool teal resonance is *diegetic*: stone is what cooled, teal is what has not
> resolved yet. Grey is a third material and must read as sad-but-functional — sagging, propped,
> overgrown with **abouts**. Certainties are the most beautiful object in any frame except a live
> claim. **Silhouette rule from §0: a frame whose every living silhouette is a human at a trade has
> failed, however busy it is.** Four of §3's presences are deliberately not human-shaped and at least
> one should be readable at thumbnail size in a hero shot.

They become §0.2, §0.3, §0.4 and §0.5. §0.1 is what has to be said before any of them.

### 0.1 The reference is a photometric target. It is not a content target.

`reference/brief-hero.png` is the authority on **how this world is lit, graded, composed and
coloured**, and nothing in §1–§15 is weakened here. It is *not* the authority on what is in it, and in
three specific places it contradicts `world.md`. In all three, `world.md` wins.

| # | what the painting shows | what `world.md` says | what we build |
|---|---|---|---|
| 1 | a continuous canyon floor: mesas standing on ground, a river running along the bottom of it | §2.3: "**There is no ground underneath.** … a piece that puts a distant valley floor under the clouds has broken the premise, not the art direction" | The midground is **leaves** — floating shelves, flat on top because that was the surface, ragged underneath because that is a fracture. Below them is **sky**. |
| 2 | one river, running downhill, reading as water | §3: carries are "rivers of unresolved value … running *uphill* as often as down, because they flow toward whatever is nearly true" | At least one carry in a Level-1 vista visibly climbs. A carry is not water; see §0.3. |
| 3 | exactly one living silhouette, and it is the player | §0: "a Level 1 shot in which every living presence is a human being at a trade is **also a bug**, however busy it is" | §0.5's gate. |

**Number 1 is the one that costs geometry, so here is exactly what it costs and exactly what it does
not.** Photometrically, almost nothing: a leaf's top surface is the same `rock.warm.*` at the same
key angle, §7's aerial perspective is unchanged, §7's three acutance planes are unchanged, and the
39% saturation carry from foreground to distance is unchanged. Pictorially it is the difference
between our world and a stock canyon:

- **`W1` — open sky below the horizon.** A Level-1 hero framing must contain **at least two separate
  regions of sky *below* the horizon line**, each ≥ 1% of frame area, seen between or under leaves.
  The reference contains zero. This is where a large part of §7's 28% negative-space budget should
  come from, and it is the single cheapest way to stop reading as a canyon.
- **`W2` — the deepest thing in frame is sky.** Trace the lowest visible surface in any downward
  sightline: it ends in sky or in a leaf's underside, **never in terrain**. There is no valley floor,
  no ground haze at the bottom of a gap, no distant plain. A gap between two leaves is lit from the
  *far* side and gets brighter as it goes down, not darker — which is the exact opposite of a canyon
  and is what sells it in one frame.
- **A leaf's underside is a readable material and it is not rock.** Ragged fracture, `rock.shadow`
  family with **`resonance.flow` veins** running through it — `world.md` §2.3: "the thick teal veins
  are the claims doing the work." Those veins are the only place cool light appears *below* a warm
  surface, and they are what makes an underside read as an argument rather than as a broken rock.
  Vein pixels count against §0.2's teal budget like everything else.

Both `W1` and `W2` are eye checks on a real capture, listed in §13.

### 0.2 Three materials, and each one means something

This is the hook that reorganises the whole colour section. **Warm stone, teal resonance and grey are
not three palettes; they are three states of the same substance**, and a player who cannot name the
rule can still read it in one frame.

| material | what it *is*, diegetically | roles | frame budget | check |
|---|---|---|---|---|
| **warm stone** | **what cooled.** A claim that closed, emitted its object, and settled. Everything you can stand on is a sentence somebody finished. | `rock.warm.*`, `rock.bone`, `rock.shadow*` | 0.18–0.29 substance | `C2` |
| **teal resonance** | **what has not resolved yet.** An open socket, a live claim, a carry, a hologram. Cool light is *unfinished quantity*, and that is why it is the identity colour. | `resonance.*`, `holo.*`, `hero.accent` | 0.09–0.17 substance, of which 0.02–0.05 hot | `C3` `C5` |
| **grey** | **what was answered instead of solved.** A claim shut with a supplied value. It works. It sags. It never sets. | `world.grey`, `world.grey.deep` | **0.02–0.08** | **`C12`** |

**The rule that makes the first two diegetic, and it is a hard one: `resonance.core` and
`resonance.hot` may only appear on something unresolved, and they must go out when it resolves.**

- An **open socket**, a **live claim**, a **carry** and a **hologram** carry cool light. Nothing else
  does.
- When a claim closes, `world.md` §4.2 says what happens: *snapping* — "light first, then stone",
  about eight frames. The art-direction consequence is the half nobody writes down: **the light has to
  leave.** The emitted object's emissive ramps to **zero** over the snap and what is standing
  afterwards is `rock.warm.*` with no glow, no bloom and no cyan rim. A closed span that keeps a cyan
  edge is a sentence the world is still saying — it is a *lie about game state* rendered in light, and
  it is worse than a wrong colour.
- Therefore `C5`'s hot-resonance budget of **0.02–0.05 of frame is a live-claim budget**. It rises
  when the player is standing in front of an open socket and falls when they close it, and a frame in
  which it does not move across a solve has not rendered the solve.
- `hero.accent` is the one exception and it is a deliberate one: the player is carrying raw value in a
  can, so the spine and slots stay lit. Its budget is separate and tight — ≤ 4% of the hero's own
  silhouette area (§6).

**Grey is the antagonist rendered as a surface, and it now has a budget instead of a shrug.** Until
round 4 §9's partition parked grey inside `muted` — 24.79% of the frame labelled "the quiet majority
of surfaces" and given no direction at all. `world.grey` `#7C7A72` (hue 48, S 0.081, Y 0.194) and
`world.grey.deep` `#4A4945` are measurably distinct from the two roles they would otherwise be
confused with — Δhue 33° / ΔS 0.125 / ΔY 0.108 from `rock.bone` `#AA9087`, and Δhue 147° / ΔY 0.110
from `rock.shadow` `#55505E`. How grey reads:

- **roughness 0.88–0.95, no rim, no specular worth authoring, no emissive, no bloom.** It is the only
  material in this file with nothing bright on it anywhere.
- **Grey does not take §3's shadow rotation.** Warm rock rotates to violet, skin holds its hue,
  resonance pulls its neighbours to teal — and grey does none of it: Δhue 0°, saturation ×0.84,
  luminance ×0.34. A hue rotation is what a surface does when a coloured world is lighting it; grey
  reads as a surface the world has partly stopped talking to. **A violet shadow on grey turns it back
  into rock**, and it is the fastest way to lose this material.
- **It sags, and the sag is geometry.** A greyed span is the right shape and the wrong length
  (`world.md` §2.1 rule 6), so it is authored with a visible droop — target **1.5–3% of its own span
  at mid-length** — and props under it. The props are *not* grey; the thing they are holding up is.
- **`abouts` grow on it.** `world.foliage` at the bottom of its saturation band, creeping, only ever
  on approximate things. Scatter is a survey instrument, so a grey object with no `abouts` on it is
  either new or wrong.
- **Grey gets ink in the foreground.** It is what the player is meant to notice.

**Grey is the reference's other missing material, and `C12` is the check that says so.** The reference
scores **0.0123** against a 0.02 floor. That is not a defect in the painting; it is the measurement of
how much of `world.md` the painting does not contain.

### 0.3 Teal is three different materials, and mixing them destroys the read

`world.md` puts cool light on three completely different things, and if they share a shader the
identity colour stops carrying information. They are separated by **emission, saturation and peak
luminance**, not by hue — all three sit at hue 160–180.

| | **live claim / open socket** | **a carry** | **a certainty** |
|---|---|---|---|
| what it is | quantity being resolved right now | raw quantity, unassigned, in bulk | a claim that has *set* and will not drift again |
| roles | `resonance.core` `resonance.hot` `resonance.bloom` | `resonance.flow` `#3FCFA0` | `certainty.facet` `#5AA5A0`, `certainty.rim` `#8FE8DF`, `certainty.deep` `#26514F` |
| emissive | **yes** | yes, weak | **never** |
| blown core (§5) | **mandatory** | never | **never** |
| bloom | yes, two lobes (§8) | a soft ½-strength halo, no tight core | **never** |
| roughness | n/a (unlit) | fluid, no facets | **0.06–0.14, faceted, refracts** |
| saturation | up to S 0.79 | S 0.70 | **never reaches S 0.55** |
| peak Y | ≥ 0.90 (`B1a`) | ≤ 0.80 | **≤ 0.72** |
| hue | 176 | **160** — greener by ~16°, so fluid and solid read as different substances | 176 |
| under motion | pulses, ≤ 3% energy per step (`M5`) | flows, and **may flow uphill** | still |

**A certainty does not glow, and that is the whole point of it.** It does not drift, so it never needs
re-closing, so it has nothing to say. It *refracts*: facets, a Fresnel rim in `certainty.rim`,
internal caustics, the highest specular density of any material in the world — and no emission at all.
That is what makes a certainty legible at a glance next to a live claim two metres away, and it is why
a field of certainties moves `C3` (resonance substance) without moving `C5` (hot resonance). **No
`certainty.*` role reaches S 0.55.** The hot-resonance budget belongs to live claims and carries
alone.

*Two consequences worth saying out loud.* `world.md`: "**They cannot be faked** — a grey closure never
crystallises." So a certainty must never be authorable in grey, must never be given a grey variant,
and must never be shaded with anything from `world.grey.*`. And: the crystals in the reference's right
foreground are the right *material* for a certainty and the wrong *state* — they are pale, blown and
bloomed, which is a live emitter. Author the field from `certainty.*`, not from the painting.

### 0.4 The two-tier beauty rule, made measurable

§8 says "the mathematics has to be the most beautiful object in the frame." `world.md` §11 says
something one notch more precise: **"Certainties are the most beautiful object in any frame except a
live claim."** Both are true and the ordering is binding:

> **1st — a live claim.** The hologram, its glyphs, its socket. Peak Y **1.000** on the glyphs (§8),
> emitter core **≥ 0.90** (`B1a`), the highest acutance in frame after the hero's face.
> **2nd — a certainty.** Peak Y **≤ 0.72**, which is **≥ 0.18 below** the live-claim floor. Highest
> specular density in the world, no emission.
> **3rd — everything else**, including the landscape, including the hero's armour, including the
> aurora.

That 0.18 gap is the rule in one number: **a live claim always out-brightens every certainty in frame
by at least 0.18 of luminance**, at every distance, on every backdrop. If a player ever has to look
twice to see which of two teal objects is the one they can solve, this has failed.

The corollary is a composition rule, not just a colour one: **in a frame that contains a live claim,
the live claim is the brightest thing that is not the sun.** Not the aurora, not a specular on the
armour, not a bloom halo. §10's clipping budget already reserves pure white for emitter cores, the sun
and KaTeX glyphs — §0.4 says which of those three wins when they are in frame together.

### 0.5 The frame is never empty, and it is never all human

`world.md` §0, and it is the hook that §6 was missing entirely:

> The frame is never empty. A Level 1 shot with fewer than three non-player presences in it is a bug,
> not a quiet moment — **and a Level 1 shot in which every living presence is a human being at a trade
> is also a bug**, however busy it is.

§6 spends sixty lines on the hero's silhouette and had no rule for anything else alive. It also sets a
64 px whole-frame element count of 4–7, and the reference resolves exactly five — hero, hologram,
river, city, aurora — **not one of which is alive**. So:

- **`W3` — the living-silhouette gate. In a Level-1 hero framing, at least three non-player presences
  must resolve at 128 px, and at least one of them must be non-human in silhouette.** Added to §6's
  gate list. The reference resolves **one** presence (the player) and **zero** non-human ones, and
  therefore fails `W3` as it fails `C12`.

**How to make a non-human silhouette read at 128 px without giving it a face.** `world.md` forbids
species names, codex entries and explanations for four of these presences, which means the *silhouette
is the only thing carrying them*. Four levers, and a presence needs at least two:

1. **A body axis that is not vertical.** A person is a vertical bar with a blob on top. Anything
   horizontal, coiled, arched or lying reads as not-a-person before any detail resolves.
2. **A limb count that is not two-and-two** — or a limb count that *changes*. The three rating the
   middle carry grow an arm on whichever side wants one and put it back; at 128 px that is a
   silhouette whose outline is asymmetric in a different place each time you look.
3. **A scale that is not 1–2 m.** Cart-sized (a hush), house-sized (the thing on the ridge), or
   six hundred metres long and only ever two arches (the Bollard and the Second Lip). A shape whose
   height is 4× or ¼× the hero's is read as non-human at thumbnail size instantly.
4. **A grammatical number the frame can show.** A several is one animal in an unfixed number of
   bodies. Two identical silhouettes drinking at two places, at the same moment, with one gait, is a
   thumbnail-legible joke that costs no exposition and never gets explained.

And two negative rules that follow straight from `world.md`: **no faces on the unnameables** ("they
never turn to face you, because there is no facing"), and **the Bollard and the Second Lip may never
both be in one framing** — if a camera can hold both arches, the level is laid out wrong, and that is
a P09 bug this document is allowed to report.

**Ix is a silhouette rule too, and it is a negative one.** `world.md` §2.3: "It should not read as a
creature. If a silhouette test makes Ix look like a fairy or a pet, the model is wrong. Ix is an open
bracket and a point that never settled — *unfinished notation with four small lights around it*." So:
**Ix's silhouette must not close.** No closed outline, no head, no wings, no face, no eyes. Exactly
four lights, and the count is the truth (P16 owns the number; we render it). Charm comes from
behaviour. Test it the same way as the hero — at 128 px, desaturated — and if a stranger names an
animal, it is wrong.

**And the hero is issued kit, not heroic plate.** `world.md` §6: "ochre-and-teal work armour with a
resonance spine, scuffed, slightly too big, the Ninth Circuit's number stencilled where it has been
half worn off." §5's measured ramp for `hero.armour` is unchanged — that is photometry — but the
dressing is not a hero's armour: scuffs and wear break the specular, the fit is loose at the joints,
and there is a **half-worn stencil**. The reference already agrees on the most important part without
knowing it: §6 measured **five spine chevrons** in `hero.accent`, and `world.md` calls that a
resonance spine. Keep them.

One addition to the silhouette itself: **the can.** The player carries a sealed vessel of raw carry;
it is heavy, it sloshes, and it is the first thing the game teaches their hands. It hangs at one hip
and it is **the one permitted violation of §6's monotone lower-body taper** — asymmetric, on one side
only, readable at 128 px as a mass that the shoulder line does not explain. A hero silhouette with no
can is a hero, and this character is a courier.

### 0.6 The horizon has to pose a question, and here is the shape of the answer

`quality-bar.md` §1: "BotW's real trick is that the horizon poses a question." A horizon can only pose
one if the art direction knows what is out there. `world.md` §3 does:

**Vantis, and the rule is the silhouette.** It is *half-existing*. Towers rise about four hundred
metres and **simply stop, mid-air, at the exact height where their claim went false.** So the skyline
is not a skyline: it is a set of vertical masses with **hard horizontal terminations at different
heights**, with **whole districts missing** between intact neighbours, and **one quarter — the
Remainder — perfectly complete**. Three readable facts, all silhouette, none needing detail. §7 is
right that "detail is not what makes a landmark read; value contrast against sky is" — and `D5` now
gives that a number (≤ 0.70×, §7). Vantis is the mass that gets it. Everything else on the horizon
recedes by haze.

**And it must be unreachable.** Between the player and Vantis is the Long Division, eleven kilometres
wide. Compositionally that means the frame must show the *gap* — sky, all the way down, between the
lip the player is standing on and the city — which is `W1` and `W2` doing pictorial work rather than
premise work.

**The rest of the sky is objects, not wallpaper**, and P10 owns them: a leaf that pulses on a beat
(Leaf Forty), a dark leaf with something enormous slung under it (Leaf One), three orange undersides
glowing from below (the Kiln Leaves), one perfectly level plate (Leaf Two Hundred and Six), and a
moving hole (the Errata). They obey §9's budgets like everything else, and the aurora stays a tint at
S ≤ 0.22.

### 0.7 What §0 does not change

Every measured constant in §1–§15 survives this section, and here is the check on that claim. The four
that look most at risk, and why they are not:

- **§9's budgets.** Grey is carved out of `muted`, which no check reads; `quiet` still counts
  atmosphere + muted + grey, so `C1` is untouched at 0.6384. `C2`, `C3`, `C5` and `C6` are unmoved:
  0.2296 / 0.1226 / 0.0311 / 1.872, exactly as round 3 published them.
- **§3's shadow families.** Grey is the one material that opts out, and it is a material that does not
  exist in the reference, so `X1` is unmoved at 0.5062.
- **§2's light rig.** §0 changes nothing about the key, the fill, the bounce or the kick. The only
  quantity §0 and §15.7 together allow to move is Lethis's **intensity**, and it is clamped by `K1`
  and `L1`, which are two of the constants themselves.
- **§7's composition.** `W1`/`W2` change what is *in* the midground, not how it is graded. The
  acutance planes, the aerial perspective and the negative-space budget are unchanged, and `D5` is a
  new number for a rule §7 already stated in words.

The one thing §0 *does* change is the pass mark: **`reference/brief-hero.png` is no longer a passing
frame.** It scores 29/30 and fails `C12`, and by eye it fails `W1`, `W2` and `W3`. A render that
reproduces it exactly reproduces its failures. That is the point of this section.

---

## 1. What the reference actually is

A low sun off to camera-right, at the horizon. A boy in champagne-gold plate stands on an orange rock
promontory with his back to us, looking out over a canyon of flat-topped mesas. A green river of light
winds through it. A ruined megacity stands as a dark silhouette against the brightest part of the sky.
An aurora runs across the top. Floating in front of him, projected from a socket cut into the rock at
his feet, is a pane of glass with `(3x+5)/2 = y` on it in white, and a line graph in cyan.

Three structural facts do most of the work, and all three are sampled:

1. **The world is warm and the light that matters is cool.** Warm *substance* — hue 0–60°, 320–360°,
   S ≥ 0.30, and not atmosphere (§9) — is 22.96% of the frame; resonance cyan is 12.26%. A 1.87 : 1
   split. The rock is the mass; the cyan is the meaning. *(Without §9's substance gate the same
   partition reads 30.92% / 13.73%, a 2.25 : 1 split. Both are correct arithmetic on the same frame;
   the gated numbers are the ones the auditor scores, and §9 explains why.)*
2. **Value falls and saturation rises as you come forward.** Row means: the sky third sits at
   S 0.1734, the middle third at 0.3165, the bottom third at 0.4499. Luminance runs the other way,
   peaking at Y 0.611 on the horizon band and falling to 0.19 at the bottom of frame.
3. **Shadow is a colour decision, not a multiplication.** Over half of the frame's mid-shadow pixels
   are *cool* (hue 185–320°): **50.6% cool against 23.4% warm** at the auditor's stride, 50.4% / 23.6%
   at full resolution. Nothing about that falls out of a renderer by default.

And one fact about the reference *as evidence*: it is a still. It says nothing about how any of this
behaves in motion, which is why §15 exists and why §15's numbers are authored rather than sampled.

---

## 2. The light rig

One key, one hemisphere fill, one resonance kick, one warm bounce. Four lights. Anything past that is
you failing to commit. **Scene-referred**, except where marked.

| light | colour | CCT (informational only) | intensity (key = 1.00) | azimuth | elevation |
|---|---|---|---|---|---|
| **key** — the low sun | `sky.sun` `#FFE8A0` | **4254 K**, green-lifted | 1.00 ± 0.12 (§15.7) | **fixed in world** (below) | **+8°** |
| **fill** — sky hemisphere | `sky.zenith` `#8DACBC` | **9647 K** | 0.14 | up | — |
| **bounce** — lit rock | `#8A5B3E` | **2833 K** | 0.06 | down | −35° |
| **kick** — resonance | `resonance.core` `#2FE3D6` | **not a blackbody** (11096 K is meaningless) | 0.08 | opposite the key, low | −15° |

> **The CCT column is informational and rounds 1–3 had it wrong in a way a builder would have acted
> on.** They printed ~3000 K / ~11000 K / ~2200 K. Recomputed from the linear triplets via CIE 1931
> xy and the McCamy cubic (`review/p02-r4-measure.mjs`, stable to ±1 K across two different sRGB→XYZ
> matrices): **4254 K, 9647 K, 2833 K.** The key was out by 1250 K, and the consequence is concrete —
> a standard kelvin→RGB helper at 3000 K returns **`#FFB16E`**, which drags lit rock out of the hue
> 25–35° band that the green-lift argument below exists to protect. **And the corrected number does
> not save you either:** the same helper at 4254 K returns `#FFD4B1`, which is still not `#FFE8A0`,
> because the key is deliberately off the Planckian locus. Type the hex. Never type the kelvin.

**The key is a world direction, not a camera-relative one, and round 2 stated it the wrong way round.**
Round 2 said "azimuth **+62°** (camera right)". Read literally, that is a light bolted to the camera
boom — it would swing the entire lighting of the world every time the player turns and would make every
shadow rule in §3 meaningless. What is actually true:

- **Invariant, from any camera:** the key sits at **elevation +8° ± 2°**, holds one colour, and holds
  one world bearing for the whole session (§15.7 permits ±8° of azimuth drift over 20 minutes, and
  nothing faster). `sky.sun` `#FFE8A0` is its colour; that is not negotiable and it is not a
  temperature.
- **Reference framing only:** in `brief-hero.png` the camera happens to look 62° off that bearing, so
  the sun sits camera-right, just off frame. **That number describes the shot, not the world.**
- **And the machine-readable half now says so too.** Round 3 corrected this prose and left
  `palette.json → motion.timeOfDay.keyAzimuthDeg: 62` untouched, in a file this document declares
  authoritative — "every colour and every threshold named here lives there, and nowhere else" — so a
  builder reading the JSON got round 2's bug back. The key is renamed
  **`keyAzimuthDegInReferenceFramingOnly`** and joined by **`keyBearingIsWorldFixed: true`**.
- **Intensity is the one quantity in this rig that moves**, on Lethis's aperiodic ±12% envelope, and
  it is clamped by `K1` and `L1`. See §15.7. Nothing else about the key varies — not its colour, not
  its temperature, not its bearing.

How the bearing was established — not from the art, from three independent measurements: the hot gold
rim sits on the hero's camera-right edge (a cut across him at y = 0.60 reaches Y 0.953 at x = 0.400 and
Y 0.062 at x = 0.379); shadows on the plinth run to lower-left; the brightest sky is at x ≈ 0.93,
y ≈ 0.335, i.e. at the horizon on the right, probably just off-frame. Low, three-quarter,
behind-right **of that camera**.

**The key is off the Planckian locus, deliberately.** `#FFE8A0` is R:G:B = 1.00 : 0.91 : 0.63. The
locus colour at its own measured 4254 K is `#FFD4B1` = 1.00 : 0.83 : 0.69, and at the 3000 K rounds
1–3 printed it is `#FFB16E` = 1.00 : 0.69 : 0.43. The green is lifted and the blue is cut relative to
both. That lift is what holds lit rock at hue 25–35° instead of letting it slide to red. **Use the
colour, not the temperature** — the CCT is in the table so that nobody has to guess it, not so that
anybody can use it.

**Key : fill on rock is 6.2 : 1 — solved, display-referred, on boxes that are recorded.** Auditor check
`K1`. Round 1 stated 7.0 ± 1.5 from a facet pair it did not write down. Measured on boxes that ship in
`palette.json → solvedConstants.keyToFill` and can be re-placed with `--lit` / `--shadow`:

| facet pair | lit | shadow | ratio |
|---|---|---|---|
| terrace top `[0.870,0.481,0.910,0.489]` vs sky-shadowed face `[0.872,0.598,0.902,0.612]` | Y 0.6592 `#FEC67D` | Y 0.1066 `#555661` | **6.18** ← the authored pair |
| terrace top vs **bounce**-shadowed face `[0.872,0.530,0.900,0.541]` | Y 0.6592 | Y 0.1367 `#855D6D` | 4.82 |
| second lit band `[0.870,0.554,0.902,0.562]` vs sky-shadowed face | Y 0.4664 `#FEA462` | Y 0.1066 | 4.38 |

That spread — 4.4 to 6.2 depending on which shadow family you land in (§3) — is the honest precision of
this measurement. Target **6.2 ± 1.6**. This is a ratio of *final-frame* luminances through the curve
of §10; do **not** obtain it by setting two light intensities to 6.2 : 1. Calibrate exposure so that
`rock.albedo` `#B4744C` facing the key renders at Y 0.42 ± 0.05 and facing away under open sky at
Y 0.07 ± 0.02, then measure.

**Skin is lit far flatter — 2.4 : 1.** Measured: lit `#FE964E` Y 0.434, shadow `#A4674B` Y 0.181. This
is why the face still reads when the body is in shadow. Do not light skin with the rock's ratio.

**Shadow length is authored, not derived.** The reference's shadows run about 3.5× object height,
which implies a sun elevation near 16°, not the 8° the sky says. The painting cheats and so should we.
Author cast-shadow length at **3.0–4.0× object height** for legibility and ignore what the visible sun
glow implies. Long shadows are also where shadow-map artefacts show first — see §12.20 and §15.6.

---

## 3. Shadow — three families

The single most important section in this document. There are three shadow families and they are
chosen by *situation*, not by material. The multipliers are **display-referred**: they are what has to
come out of the frame, not numbers to type into an ambient term.

### (a) Sky shadow
Surface faces away from the key, has open sky above it, no emitter within ~8 m.

- hue: **lit hue − 115…120°** (equivalently +240°; the ramp travels backwards, see §4)
- saturation: **× 0.28**
- luminance: **× 0.13**
- measured: terrace lit `#FFC87F` (34°, S 0.502, Y 0.641) → terrace shadow `#574F5C` (277°, S 0.141, Y 0.085)

### (b) Bounce shadow
Surface faces away from the key but sits within ~2 m of a strongly lit facet.

- hue: **unchanged** (Δ ≤ 5°)
- saturation: **× 0.47**
- luminance: **× 0.45**
- measured: plinth lit `#B47251` (20°, S 0.55, Y 0.223) → plinth shadow `#68554D` (18°, S 0.26, Y 0.0998)

### (c) Resonance shadow
Surface within ~6 m of an emitter.

- hue: **pulled to 178–190°** regardless of albedo
- saturation: **× 0.55**
- luminance: **× 0.15**
- measured: the hero's entire shadow band reads hue 180–189, S 0.18–0.32, Y 0.020–0.041 — the hero is
  standing in resonance light, so his shadows are teal while the rock two metres away is violet

**The check.** Over pixels with 0.02 ≤ Y ≤ 0.12 and S ≥ 0.10, **at least 38% must be cool (hue
185–320°)**. Reference: 50.6% cool, 23.4% warm. The negative control, which darkens albedo instead of
rotating it: **0.2% cool, 99.1% warm.** This is auditor check `X1` and it is the fastest way to know
whether the render has an art direction at all.

**Under motion this must not breathe.** Which family a surface is in changes when the player walks past
an emitter, and a hard switch between families is a visible colour pop. Blend family weights over
**≥ 0.25 s** on distance, never per-frame — §15.5.

---

## 4. The two shading ramps

Smooth forms and cut planes do not share a shading model. That contrast is most of why the hero reads
as a character standing on a landscape rather than as another rock. Both tables are
**display-referred**.

### Curved metal and skin — soft, hue travels FORWARD through olive

Measured across the hero at y = 0.60, x 0.372 → 0.415:

| stop | hex | hue | S | Y |
|---|---|---|---|---|
| shadow | `#34494C` | 185° | 0.32 | 0.062 |
| terminator | `#68704F` | **75°** | **0.295** | 0.151 |
| mid | `#AB804F` | 32° | 0.54 | 0.247 |
| light | `#FDB755` | 35° | **0.67** | 0.556 |
| specular | `#FFFCA0` | 58° | **0.373** | 0.953 |

Hue path: **185° → 75° → 32° → 35° → 58°**. *(Round 2 printed the terminator as hue 68 / S 0.26 here
and in `palette.json → shadingRamps`, while `palette.json → roles['hero.armour'].ramp` carried the
right numbers for the same hex. `#68704F` is hue 74.5, S 0.295, Y 0.1509. The law — forward through
olive — is unaffected; the typed number was not, and it is corrected in both files.)*

**Saturation peaks in the light band and drops in the specular** while value pins at 1.0. A highlight
that gets *more* saturated as it gets brighter is the signature of an untonemapped render. Transition
width ≈ 0.004–0.006 of frame width at hero scale.

### Faceted rock — hard, hue travels BACKWARD through rose into violet

Measured down the terrace face at x = 0.885, y 0.500 → 0.596:

| stop | hex | hue | S | Y |
|---|---|---|---|---|
| lit | `#FDA663` | 26° | 0.61 | 0.491 |
| turning | `#A96F62` | 11° | 0.42 | 0.207 |
| mid shadow | `#865E6D` | **338°** | 0.30 | 0.140 |
| deep shadow | `#585460` | **260°** | 0.13 | 0.093 |
| occlusion | `#1C151D` | 293° | 0.28 | 0.009 |

**Rock has no terminator.** Measured down the plinth at x = 0.66, luminance jumps Y 0.2302 → 0.4128 in
4.6 px — 0.18 of luminance across 0.003 of frame height. The light/shadow boundary is a geometric edge.
If your rock has a soft Lambert falloff across a facet, the facet is too smooth or the shading is too
soft; fix the geometry, not the shader.

> **This mandate has a cost, and §5 pays it.** A hard geometric light/shadow edge on a faceted surface
> is a specular-aliasing factory: one pixel of camera movement flips a facet's highlight on and off.
> Hard facets are permitted **only with** the specular-antialiasing rule in §5. Without it, §15's
> `M1c` fails and the rock crawls.

Implementing either ramp as an RGB lerp between a lit colour and a shadow colour produces the muddy
grey midtone that reads instantly as "shader default". Ramp through the hue path.

---

## 5. Material language

Metalness, roughness and albedo are **scene-referred**. Ink width and blown-core share are
**display-referred** — the ink is a post pass, applied after the tonemap.

| substance | metalness | roughness | specular AA | Fresnel rim | ink | notes |
|---|---|---|---|---|---|---|
| **rock / terrain** | 0.0 | 0.82–0.92 | **required** | **never** | foreground only | `rock.warm.*`; bright edges come from facet orientation, never from a rim term |
| **bone stone (ruins)** | 0.0 | 0.70–0.85 | required | never | foreground only | `rock.bone` `#AA9087` — a desaturated warm grey, *not* the orange of terrain. Cyan inlays are separate emissive strips, not a tint |
| **ground cover** | 0.0 | 0.70–0.90 | — | never | foreground only | `world.foliage` `#A2D7A6`, always below S 0.30 — see §9 |
| **live crystal / emitter** | 0.0 | 0.10–0.20 | **required** | yes, `resonance.bloom` | never | emissive; a blown white core is mandatory |
| **certainty** (set crystal) | 0.0 | **0.06–0.14** | **required** | yes, `certainty.rim`, exponent 3–5 | never | **never emissive, never bloomed, peak Y ≤ 0.72** — §0.3. It refracts; it does not glow |
| **grey** (a supplied closure) | 0.0 | **0.88–0.95** | — | **never** | foreground only | `world.grey`; no specular, no bloom, and the one material that does not take §3's shadow rotation — §0.2 |
| **plate metal** (hero, fittings) | 0.90–1.0 | 0.22–0.38, **floor 0.35 under motion** | **required** | yes, strong, key-side | yes on hero | two-lobe specular, numbers below. **Requires an environment map — see §12.18** |
| **matte metal** (inner panels) | 0.60–0.80 | 0.45–0.60 | required | weak | yes on hero | |
| **skin** | 0.0 | 0.45–0.55 | — | yes, warm, key-side | yes | shadow keeps its hue; 2.4 : 1 key:fill |
| **hair** | 0.0 | 0.35–0.50 | — | yes, hot gold | yes | the near-black core is what carries the thumbnail silhouette |
| **holographic light** | unlit | — | — | — | **never** | the veil is a compression, not an additive blend — see §8 |

### Plate metal's two lobes, with numbers

Rounds 1–3 said "a broad soft gradient plus a narrow hot streak on edges" and gave no lobe width, no
relative intensity and no definition of "edges", which is a description of a look rather than a
specification of one. It is authored (the reference is a painting; you cannot measure a lobe width off
it), and it lives in `palette.json → materials.plateMetal.specularTwoLobe`:

| lobe | roughness | intensity | gate |
|---|---|---|---|
| **broad** — reads the form | **0.45** | **0.25** | always on |
| **narrow** — the champagne streak | **0.12** | **1.00** | **N·V < 0.35**, feathered over 0.10 of N·V |

- The broad lobe is what makes a curved plate read as curved at any distance. It never switches.
- **"Edges" means N·V < 0.35** — the grazing band where the surface turns away from the viewer. That
  is what produces a *streak* along a silhouette rather than a blob in the middle of a panel, and it is
  why the reference's hottest armour sample (`#FFFCA0`, Y 0.953) sits on the hero's camera-right
  contour and not on his back.
- **Feather the gate over 0.10 of N·V.** A hard threshold on a continuous quantity is anti-pattern 27
  happening inside a shader: the streak would switch on as the player turns.
- **Both lobes obey the motion roughness floor.** Under camera or object movement the narrow lobe
  widens to 0.35 along with everything else (below). That is the price §4's hard facets charge, and it
  is cheaper than the sparkle.

### Specular antialiasing is not optional, and this document created the need for it

The two mandates above are together the classic shimmer case: §4 requires rock to have **no**
terminator — "the light/shadow boundary is a geometric edge" — and this table puts the hero in plate
metal at **metalness 0.90–1.0, roughness 0.22–0.38**. A hard-faceted surface with a narrow specular
lobe aliases badly at 1600×900, and round 2 did not acknowledge it anywhere.

- **Every material marked "required" above must use normal-variance-to-roughness** (Toksvig /
  geometric specular antialiasing): widen the roughness per pixel by the variance of the shading
  normal across that pixel, computed from the screen-space derivatives of the normal. This is a shader
  rule, not a post pass, and no amount of TAA substitutes for it.
- **Plate metal carries a roughness floor of 0.35 whenever the camera or the object is moving.** Below
  that the lobe is narrower than a pixel at 1600×900 and the highlight becomes a per-frame coin flip.
  Ramp to the floor over 0.15 s of movement and back out again; do not switch it.
- The check is §15's `M1c`: with the camera static, **no more than 0.2% of pixels may move by more than
  0.05 of luminance in one fixed step.** Sparkling metal blows this, and nothing in §1–§14 can see it.

**Rock never gets a Fresnel rim.** This is the rule people break. Rock in the reference has hot edges,
but they are facets that happen to face the key — a horizontal cut across the plinth's right edge goes
`#CB7C4D` (Y 0.277) → ink `#6C3415` (Y 0.057) → `#FBC255` (Y 0.598) in six pixels. That is geometry. A
Fresnel term on rock makes it read as wet plastic and it is visible immediately.

**Every emitter has a blown core.** `resonance.hot` `#E9FFFB`. **Solved on the socket:** the brightest
pixel inside the emissive mask (hue 150–215, or S ≤ 0.12 with Y > 0.60), searched inside the *declared*
emitter box `[0.54, 0.62, 0.74, 0.82]`, is **`#E7FEFD`, Y 0.9496, at (0.6344, 0.7038)**.

- **Blown share of frame — one definition, and it is this one: Y ≥ 0.90 AND hue 150–215, no saturation
  gate.** Reference **0.00179** (0.18%). Budget **0.0002 – 0.006**. *(Round 2 carried two values for
  this one constant: §5 and `palette.json` said 0.0018 while the auditor printed 0.0008, because the
  code additionally applied S ≥ 0.06 — which excludes exactly the near-white core pixels the rule is
  about. A builder aiming at 0.0018 was aiming at a different target from the one being scored. Fixed
  in both.)*
- **The peak must be a core, not a field.** The connected component of blown pixels containing the peak
  must be **≤ 0.4% of the frame**. Reference: **0.0058%** (58 blown components in all, the largest
  0.0495%).
- Auditor checks `B1a` (peak ≥ 0.90 inside the declared box), `B1b` (blown share), `B1c` (component
  area). *Round 2's `B1a` masked hue 150–215 at S ≥ 0.06 over the whole frame; on the reference that is
  34.8% of the frame — the sky is inside it — and the peak it reported was at x = 0.9993, the extreme
  right edge of frame, with only 2 of the mask's 200 brightest pixels falling inside the socket. It
  passed at 0.9692 on the negative control, a frame with no blown core anywhere. It was a null check
  and it is now three real ones.*
- Under motion, an emitter's screen energy may change by no more than **3% per fixed step** — §15.5.

### The ink line

A screen-space contour, and it is a real part of the look, not a stylisation bolted on.

- colour: `hero.ink` `#140D0A` — a warm near-black, **never `#000000`**. Measured samples across the
  hero contour: `#0C0403`, `#241812`, `#2A1812`, `#160101` — Y 0.0016–0.0056, every one warm.
- width is **threshold-dependent and is quoted with its threshold** (auditor `I1a`, at Y ≤ 0.012).
  Horizontal runs inside the hero box, normalised to a 2752-wide frame:

  | threshold | n | p25 | median | p75 | p90 |
  |---|---|---|---|---|---|
  | Y ≤ 0.006 | 6 690 | 2 | 3 | 4 | 6 |
  | **Y ≤ 0.012** | **8 255** | **2** | **3** | **4** | **7** |
  | Y ≤ 0.020 | 8 528 | 2 | 4 | 5 | 10 |

  Median 3 px at 2752 = 0.11% of frame width ≈ **1.7 px at 1600×900**, which is the number to author
  as **0.00189 of frame height** and multiply by the drawing buffer height at use — 1.7 px at
  1600×900, 4.1 px at 3840×2160. Typing `1.7` is anti-pattern 29 and it breaks `I1a` and `M3a` in
  opposite directions on the same display.
- **it tapers**, at every threshold: p90 is 2–2.5× the median. A uniform-width outline is wrong, and
  that is what auditor `I1b` checks, because the taper survives the choice of threshold and the
  absolute widths do not.
- **it must not crawl**, which is a different claim and needs a different check. `I1b` measures the
  taper on **one** frozen frame; a contour that alternates 3 px and 6 px scores a textbook taper on
  every individual frame and crawls visibly. §15.3 is the rule: **≤ 1 px of change in median width and
  ≤ 2 px in p90 between adjacent frames at 1600×900.** Derive the contour from depth and normal buffers
  at a width that is a fixed function of screen depth, with a hysteresed threshold — never from a
  per-frame random, never from a threshold on a temporally unstable buffer.
- **distance-gated**: pixels at Y ≤ 0.006 are 2.30% of a foreground band against 1.01% of a distant
  band. Ink is present on the hero, on foreground interactables and on foreground terrain silhouettes.
  Fade it out over the foreground/midground boundary; do not cut it off. The reason that fade is
  mandatory is temporal as much as pictorial — a hard distance cut pops (§15.6).

---

## 6. Silhouette

**The thumbnail test runs at 128 px, not 64.** Round 1 set it at 64 px and asserted that all five of
the hero's silhouette features survive there. They do not — *in the reference itself*. Rendered at a
true 64 px-tall frame the hero occupies 18 × 44 px, and at that size the crown reads as one asymmetric
dark cap rather than three spikes and only one of the two arm slots survives. At 128 px (hero 36 × 87 px)
everything below reads. The gate is now calibrated at a size the reference passes.
Evidence: `review/p02-crops/hero64.png` and `review/p02-crops/hero128.png`, both real box-filtered
downsamples of the reference, desaturated, then nearest-neighbour enlarged for inspection.

**The hero's silhouette must preserve at 128 px, in priority order:**

1. **An asymmetric hair crown, wider than the face** — crown 0.0745 of frame width at y = 0.34 against
   a face of 0.0440 at y = 0.42, a ratio of **1.7 : 1**. Not left-right symmetric.
2. **Pauldrons that read as the widest point of the upper body** — shoulder span 0.106 at y = 0.50,
   **2.4 : 1** against the face.
3. **A waist pinch.**
4. **Two negative-space slots** between the arms and the torso.
5. **The can** — added in round 4 from `world.md` §6, and it is the one feature the reference does not
   have because the reference does not know what this character does for a living. A sealed vessel of
   raw carry, hanging at **one** hip, **0.030–0.045 of frame width** of extra mass on that side at
   y ≈ 0.62–0.72. It is the **one permitted violation of the monotone lower-body taper** below, it
   must be on one side only — the asymmetry is the read — and it must be countable at 128 px as a mass
   the shoulder line does not explain. A courier whose silhouette is empty-handed is a hero, and this
   character is neither.

**There is no leg gap, and round 1's fifth feature was the wrong one.** Round 1 required "a gap between
the legs at rest". Measured at full resolution — the widest run inside the hero span whose hue is
within 12° and whose luminance is within 25% of the rock just outside the silhouette — the inter-leg
background gap is 0.019–0.022 of frame width over y 0.80–0.84 and **exactly zero at y 0.86 and below**,
because the forward boot crosses it. 0.020 of frame width is 2.3 px at a 64 px-tall frame and 4.6 px at
128 px, and it exists over only 0.04 of frame height. It is not a silhouette feature; it is a hole that
opens and shuts with the stance. Do not author poses around it. What the lower body must do instead is
**taper**: below the waist the silhouette narrows monotonically and never exceeds the shoulder span —
with the can at one hip as the single authorised exception, because a violation you can name is a
read and a violation you cannot is noise.

**The 64 px whole-frame element count, with "element" defined.** Render the frame at 64 px tall,
desaturate, and count **connected regions of the WORLD layer** whose area is ≥ 0.5% of the thumbnail
and whose mean luminance differs from their surround by ≥ 0.10. The reference resolves **five**: the
hero (dark mass with one cyan spot), the hologram (pale rectangle with a cyan edge), the river (a green
S-curve), the city (dark spires), the aurora (green bands). Target **4–7**. Fewer and the frame is
empty; more and it is noise. **HUD and overlay layers are counted separately and are excluded from that
five** — at 64 px the reference's portrait block, minimap and subtitle band each resolve as clearly as
any of the five, so a count that does not exclude them is a count of eight and means nothing. Evidence:
`review/p02-crops/thumb64.png`.

**And the element count is not enough on its own, because none of those five is alive.** Hero,
hologram, river, city, aurora: one player and four pieces of scenery. `world.md` §0 says a Level-1 shot
whose every living silhouette is a human at a trade is a bug *however busy it is*, so a count that a
diorama can pass is a count that measures the wrong thing. The second gate, from §0.5:

> **`W3` — at a 128 px-tall render of a Level-1 hero framing, at least three non-player presences must
> resolve, and at least one of them must be non-human in silhouette.**

Non-human in silhouette means at least two of §0.5's four levers: a body axis that is not vertical, a
limb count that is not two-and-two (or that changes), a scale that is not 1–2 m, or a grammatical
number the frame can show. **The reference resolves one presence and zero non-human ones and therefore
fails `W3`** — confirmed by eye on `review/p02-crops/thumb64x8.png` and `hero128.png`. This is an eye
check; it is in §13's list, and no number in this file can stand in for it.

**Measured proportions** (from a width profile traced along the ink contour, `review/p02-silhouette.mjs`):

| measure | value |
|---|---|
| figure height | y 0.280 → 0.955 = **0.675 of frame height** |
| figure width (arm to arm) | x 0.288 → 0.415 = **0.127 of frame width** |
| head height (crown to shoulder) | 0.16 of frame height |
| **stylisation** | **≈ 4.2 heads tall** — heroic-child proportion, not the 7.5–8 of a realistic adult |
| hair crown width | 0.0745 at y = 0.34 |
| face width | 0.0440 at y = 0.42 |
| **crown : face** | **1.7 : 1** — the spikes are structural, not decoration |
| shoulder span | 0.106 at y = 0.50 |
| **shoulder : face** | **2.4 : 1** |

The 4.2-head proportion and the 1.7 : 1 crown are what make this silhouette survive to 128 px. A more
realistic figure will not.

**Scale in frame.** He is big — 67% of frame height *in the reference framing*. The **invariant** is
the floor: a third-person camera that renders him smaller than **50% of frame height** loses the
silhouette and the accents together.

**Value separation.** Over the box `0.276,0.276,0.425,0.960`, hero mean Y 0.207 against a 4%-padded
surround at 0.313 — a delta of **0.107**. Floor: **0.10** (auditor `H1`). The hero is a *dark* mass
against a *light* background; the accents and the gold rim are what keep him from being a hole.

> **`H1` on one frame is not enough, and §15.2 says so.** The reference's 0.107 is 7% above the floor,
> and the thing that moves it is the *background*, which changes every frame the player walks. The
> separation must hold on **every** frame of a pan and of a run, not on the lucky one — auditor `M7`.
> On the current scaffold build (round-4 capture, `--hero=0.343,0.415,0.422,0.825`) it holds in one
> mode out of four: static **0.050**, panning **0.025** at worst, running **0.051** — and `settle`
> **0.110**, a pass, purely because that mode stops with the capsule in front of the dark sky instead
> of the orange ground. Same build, same avatar, 4.4× difference in separation depending on framing.
> That is a real, located defect for whoever owns the avatar and the lighting, and **no still-frame
> check in this document can report it** — see §15.9.

**Accent placement is by ZONE and by AREA, never by count.** `hero.accent` appears in: two
**shoulder-blade** slots (the reference is a *back* view — round 1 called these chest slots and
inferred a front pair that cannot be seen), five spine chevrons, one band per forearm, one strip per
shin, one strip per boot cuff. A connected-component census of the hero box at hue 150–215, S ≥ 0.45,
V ≥ 0.62 finds **61 components, 21 of them ≥ 90 px** — the count is entirely an artefact of where you
put the minimum-area threshold, which is exactly why round 1's "eleven elements" was wrong and why no
count is authored here. The binding number is the budget: **accent pixels ≤ 4% of the hero's silhouette
area** (reference: 4.09% at that threshold).

---

## 7. Composition

This section had the worst version of the problem round 3 exists to fix: it stated one painting's
framing as law. A horizon at y = 0.31 and a hero centre at x = 0.352 are facts about *that camera*.
Followed literally they produce a diorama that matches `brief-hero.png` from one viewpoint and has no
rule for any other — a reconstruction of the reference rather than its own world. So the numbers are
split, the way `depthCues.acutanceBoxes` already was: **reference framing** below, **invariant** after.

### Reference framing — facts about `brief-hero.png`, not constants of nature

Re-derive every one of these for any other camera. They are here so a critic can reproduce the
measurements in §6 and §8, and so the Level-1 hero vista has a target to hit. They are **not** rules
for the running game.

| measure | reference value |
|---|---|
| horizon | y = **0.31** |
| hero centre | x = **0.352** |
| head top / face / feet | y = 0.280 / 0.393 / 0.955 |
| hero height in frame | 0.675 |
| hologram quad, fitted corners | TL (0.498, 0.264) · TR (0.777, 0.242) · BL (0.493, 0.489) · BR (0.759, 0.542) |
| panel area | ≈ 0.28 × 0.27 of frame, ≈ 7% |
| panel's left edge clear of the hero | 0.068 of frame width |
| acutance boxes | `palette.json → depthCues.acutanceBoxes` |
| key : fill boxes | `palette.json → solvedConstants.keyToFill` |
| emitter box | `palette.json → solvedConstants.emitterPeak.searchBox` |

The horizon crossing the hero **at the shoulders**, so his head is silhouetted against sky, is the one
item on that list that is also a rule — see below.

### Invariant — must hold from ANY camera, at any moment of play

| # | rule | reference | check |
|---|---|---|---|
| 1 | **horizon within y 0.22 – 0.38** | 0.31 | eye |
| 2 | **hero ≥ 0.50 of frame height** | 0.675 | eye |
| 3 | **the horizon crosses the hero above the shoulder line**, so the head is against sky | yes | eye |
| 4 | **any mathematics panel keeps ≥ 0.05 of frame width clear of the hero's silhouette** | 0.068 | eye |
| 5 | **negative space ≥ 28% of frame** — quiet, and carrying nothing a player must read | 63.8% | `C1` |
| 6 | **dark framing mass in the outer 12% border ≥ 0.06** | 0.178 | `F1` |
| 7 | **the hero is never dead centre**: \|x_centre − 0.5\| ≥ 0.06 | 0.148 | eye |
| 8 | **at least three depth planes separate by acutance**, ratios in `depthCues.acutanceRatioTargets` | 4.3 / 3.6 | `D1` `D2` `D4` |
| 9 | **the read survives the framing changing** — the silhouette and the separation hold under a pan and a run | — | `M2` `M7` |
| 10 | **≥ 2 separate regions of open sky BELOW the horizon line**, each ≥ 1% of frame area (§0.1) | **0** | `W1`, eye |
| 11 | **the deepest visible surface in any downward sightline is sky or a leaf's underside, never terrain** (§0.1) | fails | `W2`, eye |
| 12 | **≥ 3 non-player presences at 128 px, ≥ 1 non-human in silhouette** (§0.5) | 1 / 0 | `W3`, eye |
| 13 | **exactly one distant mass reads as a silhouette**, at ≤ 0.70× the sky behind it | 0.592 | `D5` |

Rules 1–3 are what a camera rig must be *aimed* to satisfy; a rig that cannot hold them is the rig's
bug, not a licence to ignore them. **Rules 10–12 are the three the reference itself fails**, and they
are the difference between this world and the canyon in the painting — see §0.1 and §0.5.

- **Framing mass is geometry, not a vignette.** Measured 17.8% of the outer-12% border sits below
  Y 0.06 — dark foreground rock running off-frame at the corners. And the reference has essentially
  **no post vignette**: sky luminance across x is flat at 0.413–0.429 over x 0.20–0.425 **at rows
  y 0.01–0.03**, and at those rows the left edge is *brighter* than the centre, not darker; from y 0.08
  down the relationship reverses. (The row matters, and round 2 quoted the claim without it.) Cap any
  vignette at 6% corner falloff and never use it to fake composition.
- **Landmarks recede in three planes minimum, and exactly ONE of them is a silhouette.** Detail is not
  what makes a landmark read; value contrast against sky is — and that now has a number and a check.

  > **`D5` — a distant landmark that is meant to read as a silhouette must have a mean luminance
  > ≤ 0.70× the sky directly behind it.**

  Measured on the reference with recorded boxes (`palette.json → depthCues.landmarkContrast`, or pass
  `--landmark=` / `--skybehind=`): the city mass over `[0.700,0.120,0.860,0.300]` reads **Y 0.3398**
  against sky over `[0.860,0.120,0.960,0.300]` at **Y 0.5738** — a ratio of **0.592**. Against the sky
  directly *above* it the ratio is 0.693. Both clear the rule.

  **The counter-examples are the more useful half of this.** The left ruin cluster reads 0.4872
  against 0.6234 behind it (**0.782**) and the mid mesas read 0.3989 against 0.5234 above them
  (**0.762**). Both *fail* 0.70, and both are correct: they are not silhouettes, they are haze, and
  they are supposed to be. The rule is not "everything distant must be dark". It is that **a frame
  gets one silhouetted landmark and everything else recedes by aerial perspective** — otherwise the
  horizon is a row of equally interesting dark shapes and none of them poses a question. In the
  reference that one is the city. In Level 1 it is **Vantis**, and §0.6 says what its silhouette has
  to do.

**Aerial perspective.** Lerp toward `sky.horizon` in **linear** space, reaching **0.75 at the far
plane**. Measured: the top third of the frame averages S 0.1734 against the bottom third's 0.4499 — the
distance carries **39% of the foreground's saturation**. Bone stone and foliage albedos in
`palette.json` were sampled at mid distance and therefore already carry part of this wash; foreground
instances of both should be authored more saturated (see each role's `note`).

**Depth of field.** Focus plane on the hero. Acutance (mean |4·L − ΣL_neighbours|) measured on
comparable rock content at three depths:

| box | normalised box | acutance | ratio |
|---|---|---|---|
| hero core | `0.2984,0.4128,0.4027,0.8232` | **0.09612** | 4.30 × midground |
| foreground rock | `0.44,0.70,0.72,0.92` | **0.04617** | 3.57 × distance |
| midground valley | `0.06,0.52,0.30,0.68` | **0.02235** | — |
| mid crystals | `0.84,0.62,0.98,0.78` | 0.01452 | — |
| city, far | `0.70,0.12,0.86,0.30` | 0.02400 | — |
| distance ruins | `0.10,0.36,0.30,0.46` | **0.01295** | — |
| flat sky (noise floor) | `0.36,0.02,0.56,0.08` | **0.01315** | — |

**Every box in that table is now recorded, which was not true before, and two of the values moved when
they were.** Round 3 carried the hero at 0.1042 in `palette.json`, 0.0961 in this table and 0.09612
from the live auditor — three values for one measurement, which is the `rampWidth` defect one object
away. The auditor's is the one that is checkable, so it is the one that is recorded. And "flat sky
(noise floor) 0.0123" had no box at all: the obvious one (x 0.10–0.30, y 0.03–0.09) scores **0.082**,
because the HUD portrait and health bar sit inside it — a noise floor measured on the UI. The box above
is clean sky right of the HUD and above the aurora, and it lands at 0.01315.

Note the trap: a first draft of the auditor measured acutance in full-width screen bands and all three
came out at 0.033, because the hero, the hologram and the HUD text contaminated every band. Acutance is
only meaningful between boxes on comparable content. The boxes live in
`palette.json → depthCues.acutanceBoxes` and are arguments, not constants. **The focus distance must be
a smoothed follow of the hero's depth (time constant ≥ 0.3 s), not a per-frame solve** — a DOF plane
that snaps is §15.6.

---

## 8. The hologram and KaTeX

The mathematics has to be the most beautiful object in the frame. It gets its own rules.
**Pipeline stage: the quad composites in linear, before the tonemap; every number below is what must
come out after it** — which requires a half-float or better render target for every pass before the
curve (anti-pattern 30).

> **Two tiers, not one — §0.4.** `world.md` §11 is one notch more precise than "the mathematics is the
> most beautiful object in the frame": *certainties are the most beautiful object in any frame except a
> live claim*. A live claim (this panel, its glyphs, its socket) is first, at glyph Y **1.000** and
> emitter core **≥ 0.90**. A certainty is second, capped at Y **0.72**. Everything else is third. The
> **0.18 gap** between those two is the rule in one number, and it is what stops a player having to
> look twice to see which teal object is the one they can solve.

### The veil — the one rule that makes this work anywhere

The panel fill is **neither additive nor multiplicative. It compresses whatever is behind it toward a
fixed point at Y ≈ 0.44.**

```
Y_inside  ≈  slope · Y_behind  +  intercept        fixed point = intercept / (1 − slope)
```

**The law is verified; the coefficient is soft, and this document says which is which.** n = 116 paired
inside/outside samples taken normal to all four edges of the quad, over four different backgrounds
(bright sky above, hazy mesas left, the dark city right, the valley below), background range Y 0.19–0.79.
The background behind each interior sample is extrapolated across the edge from a four-sample line
outside it, so a sloped backdrop cannot masquerade as transmission. Five independent estimators:

| estimator | n | slope | fixed point | r² |
|---|---|---|---|---|
| four edges, interior offset 0.008 (best conditioned) | 116 | **0.462** | **0.446** | 0.896 |
| four edges, interior offset 0.012 | 116 | 0.423 | 0.434 | 0.834 |
| four edges, interior offset 0.018 | 102 | 0.335 | 0.417 | 0.685 |
| four edges, no gradient correction | 116 | 0.558 | 0.446 | 0.955 |
| `review/art-audit.mjs`'s own independent probe | 117 | 0.602 | 0.417 | 0.459 |
| left edge only, 11 pairs (an earlier hand solve) | 11 | 0.672 | 0.476 | — |

Slope ranges over 0.34–0.67; the **fixed point only ranges over 0.417–0.476**. So:

- **Author `holo.veil.fixedPointY = 0.44`** — that is the hard constant, and it is exactly the
  luminance of `holo.veil` `#6BBFC2` (Y 0.4428). The fixed point *is* the veil colour's luminance,
  whatever alpha you pick. **Display-referred**: verify it by capturing and running `V1`, never by
  typing 0.44 into a blend equation that then goes through §10's curve.
- **Author `holo.veil.alpha = 0.50 ± 0.08`**, applied in linear.
- Auditor `V1a`/`V1b` accept slope 0.30–0.72 and fixed point 0.40–0.50 — bounds every estimator above
  lands inside, and which an additive quad (slope ≈ 1) or a flat plate (slope ≈ 0) misses by a mile.
  `V1c` refuses to score the check at all unless there were ≥ 10 pairs, over ≥ 2 edges, spanning
  ≥ 0.20 of background luminance: a fit over one flat backdrop is not identifiable and must not be
  reported as a pass.

Measured deltas by side, which is the part a critic can see with their eyes: over the **bright sky**
above the panel the interior is **darker by 0.137**; over the hazy mesas to the left, darker by 0.030;
over the **dark city** to the right the interior is **lighter by 0.062**. That is the whole point: the
panel never blows out and never goes muddy, on any background, in front of any geometry — **including
when the background is sliding past it because the player is running**, which is the case a still
cannot show. An additive quad dies against a bright sky; a flat dark quad reads as a menu.

### White is the statement, cyan is the answer

- **Glyphs: `holo.glyph` `#FFFFFF`.** 1 925 pixels of exactly `#FFFFFF` inside the panel, peak Y 1.000
  — the mathematics is the brightest thing in the frame, and 0.046% of it. **Never tint the mathematics
  cyan.** A cyan equation on a cyan panel is the single most common way this genre fails to be legible.
  For *how* pure white survives a soft shoulder, see "Which side of the tonemap" above: drive the glyph
  emissive ≥ 4× above the curve's Y 0.99 point and let it clip through, or composite the glyph layer
  after the curve.
- **Plotted data: `holo.data` `#41FEEA`** (hue 174, S 0.744, Y 0.780). Independently re-found as the
  modal saturated cyan inside the panel: `#41FEE7` / `#43FEE7`. The curve whose *value* the player is
  reading.
- **Axes and ticks: white.** They belong to the statement, not the answer.
- Contrast is guaranteed by construction: white on a background compressed to Y ≈ 0.44 is ≥ 2.2 : 1
  everywhere, on every backdrop.
- **Glyph edges must not shimmer.** The panel is a 3-D quad, so its texels are minified in perspective
  and the equation will alias exactly where it matters most. Render the KaTeX layer at **≥ 2× the
  quad's on-screen pixel width**, with a full mip chain and **anisotropy ≥ 8**, and re-render it on a
  resolution change — never per frame. §15.3 measures the result.

### Chrome

- 1 px rounded-rect border in `holo.stroke` `#B4E1E0`, corner radius ≈ 2.5% of panel width.
- Four **inset corner brackets**, L-shaped, thinner than the border, set ~4% of panel width in from
  each corner. These are what make it read as an instrument rather than a dialog box.
- **The panel is a real 3-D quad in perspective.** Fitted edge slopes: top **−0.079**, bottom
  **+0.199**. Non-parallel, so this is a true perspective quad, not a screen-space overlay. A
  screen-space overlay is a different object and reads as UI, not as world.
- **Every panel is projected from a physical socket** with a visible light cone. The reference's socket
  is cut into the rock at the hero's feet, has a white-hot core (§5), casts a visible wedge of light
  across the rock, and spills cyan bounce onto the surrounding facets. A hologram with no emitter is a
  decal.

### Bloom

Emissive-mask only — **never a global luminance threshold**, or the sky and the sunlit rock bloom too
and the frame turns to soup. Two lobes, both **authored**: a tight core (σ ≈ 0.6% of frame height) and
a wide halo whose **half-intensity radius is 6% of frame height**.

*Round 1 published a measured falloff table (0.74 at r = 2% of frame height, 0.69 at 4.6%, 0.45 at 6.5%,
0.29 at 9%). It is withdrawn: it is not reproducible.* Annular means about the true socket centre
(0.6344, 0.7038) are essentially flat —

| r (frac. of frame height) | 0.5% | 1% | 2% | 3% | 4.6% | 6.5% | 9% | 12% |
|---|---|---|---|---|---|---|---|---|
| annular mean Y | 0.620 | 0.396 | 0.402 | 0.410 | 0.376 | 0.383 | 0.325 | 0.257 |

— because every annulus at this radius crosses lit rock, the light wedge and cast shadow as well as
glow. **A radial profile through a painted frame cannot isolate a bloom kernel.** The two-lobe spec
above is an authored decision; treat it as one.

**Bloom must not pop at the frame edge.** An emissive mask built only from visible pixels loses an
emitter the instant its last pixel leaves frame, and the halo it was feeding vanishes in one frame.
Build the mask on a **guard band of ≥ 8% of frame width beyond each edge**, or weight each emitter's
bloom contribution by a smoothstep over the outer 6% of frame. §15.5 measures it: **≤ 3% change in
emissive energy per fixed step.**

---

## 9. Colour discipline

The world uses **two hue arcs and one bridge**, two reserved arcs for state, and one **substance gate**
that separates surfaces from atmosphere. The partition below is generated from
`palette.json → colourBudget.hueArcs`, which is the same object `review/art-audit.mjs` classifies with,
so the prose and the auditor cannot drift apart. Re-generate with `node review/p02-sync-doc.mjs`;
`--check` fails if it is stale.

<!-- GENERATED: hue-partition — do not edit by hand; run node review/p02-sync-doc.mjs -->

| order | class | hue | gate | reference share of frame | what it is |
|---|---|---|---|---|---|
| 1 | `danger` | 330–355° | S ≥ 0.55, Y > 0.1 | 0.00% | reserved, transient only |
| 2 | `success` | 95–125° | S ≥ 0.45, Y > 0.45 | 0.00% | reserved, transient only |
| 3 | `atmosphere` | 0–360° | S < 0.45, V > 0.7 | 39.05% | sky, haze, aerial wash, bloom halo |
| 4 | `grey` | 20–80° | S < 0.14 | 1.23% | a claim closed with a supplied value |
| 5 | `muted` | 0–360° | S < 0.3 | 23.56% | surfaces that are neither warm, resonant nor grey |
| 6 | `warm` | 0–60° ∪ 320–360° | S ≥ 0.3 | 22.96% | warm rock — the mass of the world |
| 7 | `resonance` | 150–215° | S ≥ 0.3 | 12.26% | resonance cyan — mathematics is live here |
| 8 | `bridge` | 90–150° | S ≥ 0.3 | 0.69% | green bridge — river, foliage, ground cover |
| 9 | `offLanguage` | 60–90° ∪ 215–320° | S ≥ 0.3 | 0.25% | off-language — must stay empty |

**The order matters.** Classification is in priority order (danger, success, atmosphere, grey, muted, then the hue arcs), because `success` at 107° sits inside the bridge arc and must not be scored against the bridge budget. Each class carries its own saturation gate.

**The substance gate.** A pixel counts as SUBSTANCE only if S >= minSaturationForBright OR V <= maxValueForPale. A pale, bright pixel is ATMOSPHERE — sky, haze, aerial wash, bloom halo — whatever hue arc it sits in, and is scored in `atmosphere`, never in `warm`, `resonance` or `bridge`.

*Why:* Without it the identity-colour budget is a coin flip on sky saturation. 36.37% of the reference sits inside the resonance hue arc and only 13.75% clears S >= 0.30; 7.75% of the frame is parked at S 0.20-0.30, and 47.96% of the sky is inside the resonance arc (sky.zenith #8DACBC is hue 200, S 0.25 — 0.05 from the gate). Measured: with no gate, pushing sky saturation +0.10 moves resonance share 0.1375 -> 0.1755 and warm:resonance 2.25 -> 1.92, failing C3 and C6 with no art fault whatsoever. With this gate the same push moves resonance share 0.1227 -> 0.1247 and warm:resonance 1.871 -> 1.925. A nineteenfold reduction in the drift.

*Symmetry:* Applied to `warm` as well as `resonance`, on the argument §9 already makes: the sky carries hue, not saturation. The reference's own horizon (#F1C9A6, hue 28, S 0.311, V 0.945) is atmosphere that round 2 scored as `warm rock — the mass of the world`. It is not rock.

*Grey:* Grey is a MATERIAL, not a tint, and until round 4 §9 scored it as anonymous `muted` — 24.79% of the frame described as "the quiet majority of surfaces" and given no direction at all. world.md Law 5 makes grey the visible surface of the antagonist, so it gets a class and a budget of its own. The class is a strict subset of what `muted` already held (hue 20–80° at S < 0.14 is inside S < 0.30), so nothing else in the partition moves and `quiet` still counts atmosphere + muted + grey. Reference share 0.0123 — BELOW the 0.02 floor, and that is the finding: the reference is a hero vista of a world with no grey in it. C12 is the first check in this file that reference/brief-hero.png fails, and it fails it for a reason that is about what the world is made of rather than how it is photographed.

250–349° is 0.00% of the reference's saturated pixels; 70–119° is 0.78%. Those two emptinesses are what `danger` and `success` were placed in.

For the record, because these reproduce and were verified: WITHOUT the substance gate the same partition gives muted 0.5355, warm 0.3092, resonance 0.1373, bridge 0.0147, offLanguage 0.0033, warm:resonance 2.25. The gate moves the warm sky and the pale bloom halo out of `warm` and `resonance` and into `atmosphere`; nothing about the frame changed.

<!-- /GENERATED: hue-partition -->

Frame budgets (auditor checks `C1`–`C11`; reference value in brackets):

| budget | target | reference |
|---|---|---|
| quiet — muted + atmosphere | 0.56–0.72 | 0.638 |
| atmosphere — V > 0.70 and S < 0.45 | 0.15–0.55 | 0.391 |
| warm substance, S ≥ 0.30 | 0.18–0.29 | 0.230 |
| **grey substance** (hue 20–80, S < 0.14) | **0.02–0.08** | **0.012 — FAILS** |
| resonance substance, S ≥ 0.30 | 0.09–0.17 | 0.123 |
| **hot resonance, S ≥ 0.55** | **0.02–0.05** | **0.031** |
| all hot, S ≥ 0.55 | 0.08–0.16 | 0.117 |
| warm : resonance ratio | 1.4–2.4 | 1.87 |
| sky third quiet | 0.90–1.00 | 0.972 |
| bottom third resonance | 0.18–0.36 | 0.268 |
| off-language hue (60–90°, 215–320°) | ≤ 0.02 | 0.003 |
| danger / success | ≤ 0.005 each | 0 / 0 |

**Saturated resonance cyan is 3% of the frame.** Not 15%. The cyan works *because* it is rare and
because 23% of the frame is warm rock holding it up. And per §0.2, that 3% is a **live-claim** budget:
it rises in front of an open socket and falls when the claim closes, because the light leaves with the
solve.

**Grey is a class now, and `C12` is the one check the reference fails.** Round 3's partition scored
grey inside `muted` — 24.79% of the frame described as "the quiet majority of surfaces" and directed
nowhere. `world.md` Law 5 makes grey the visible surface of the antagonist, so it gets its own arc
(hue 20–80° at S < 0.14), its own roles (`world.grey`, `world.grey.deep`) and its own budget
(0.02–0.08). The arc is a strict **subset** of what `muted` already held, so nothing else in the
partition moved and `quiet` still counts atmosphere + muted + grey: `C1` is unchanged at 0.6384 and
`C2`/`C3`/`C5`/`C6` are unchanged at 0.2296 / 0.1226 / 0.0311 / 1.872. What did change is `muted`,
which drops from 0.2479 to **0.2356** — the 0.0123 that is now named. **That 0.0123 is below the 0.02
floor and the reference fails `C12`**, which is the correct result: it is a hero vista of a world that
had no grey in it. See §0.2 for what grey has to look like.

**Know which of these numbers is robust.** The **hot** resonance share at S ≥ 0.55 is a property of
real cyan; no sky can reach it, and that is why §13 ranks it above everything else in this section.
The plain resonance share at S ≥ 0.30 is the fragile one, and the substance gate exists because of it:
36.4% of the reference sits inside the resonance hue arc while only 13.7% clears S ≥ 0.30, 7.8% of the
frame is parked at S 0.20–0.30, and 47.96% of the *sky* is inside the arc. `sky.zenith` `#8DACBC` is
hue 200 at S 0.25 — five hundredths from the gate. Without the gate, a render whose sky is 0.05 more
saturated than the painting reports a different budget and a different ratio with no art fault
whatsoever. Measured, at +0.10 of sky saturation: without the gate, resonance share moves 0.1375 →
0.1755 and warm : resonance 2.25 → 1.92, failing two checks; with it, 0.1227 → 0.1247 and 1.871 →
1.925, failing none. A whole-*frame* +0.10 push — a genuinely over-saturated render, which *should*
fail — still fails `C5` at hot resonance 0.0656. The gate discriminates between the two.

**The sky carries hue, not saturation.** 97% of the top third is quiet. The aurora is `aurora.mint` at
S 0.175 — a *tint*, not a colour. Push it past S 0.30 and it becomes a screensaver.

**The sky must pass through a neutral pivot.** Measured down a clean sky column at x = 0.245: hue
200 → 205 → 190 → 172 → 159 → 146 → 133 (aurora, S 0.175) → 104 at S 0.070 → 37 at S 0.100 → 30 → 28 at
the horizon. That near-grey crossover at y 0.20–0.22 (`sky.pivot` `#C7C3B8`) is the single feature that
stops the sky reading as a two-colour lerp. A zenith→horizon gradient that never drops below S 0.14
looks like a shader default.

**State colours are separated from the world by SATURATION as much as by hue.** Two cases, and they
work the same way:

- **`danger` `#FF3E6B` (346°).** Rock in mid-shadow passes through hue 338–353° on its way to violet
  (measured: 353 → 343 → 338 at S 0.29–0.32). World rose-shadow never exceeds S 0.35, so danger must be
  drawn above **S 0.55** or it reads as a shadow.
- **`success` `#8AF06E` (107°).** This one is not optional and it is where round 1's partition broke.
  The world *already carries green in the success arc*: `world.foliage` reads hue 113–140 across the
  reference, with a clean sample at 117°. Hue 70–119° at S ≥ 0.06 is 4.0% of the frame (n = 42 428) and
  its saturation histogram is 28.5% below S 0.10, 42.8% in 0.10–0.20, 23.8% in 0.20–0.30, **only 4.8%
  above S 0.30**. So: **world green lives at S ≤ 0.30; success is S 0.542 and is only ever detected
  above S 0.45.** A success flash is unmistakable against ground cover because it is twice as saturated,
  not because it is a different green.
- A first draft put success at 146°, which collided with the river and the crystals (140–168°) and
  consumed 0.81% of the frame against a 0.5% budget. Moved to 107°.
- **Event vs record.** Success is the green *flash* of being right. The permanent record of an
  achievement is `reward.gold` `#F0BE45`, which is world-native — it is the armour highlight and the XP
  bar. Do not merge them.
- danger and success differ by **2.67 : 1 in luminance** (success Y 0.6885, danger Y 0.2577) and must
  *always* carry a second, non-colour cue. Colour alone never carries a learning outcome.
- **Both are transient, and a transient is a motion object.** A state flash rises in ≤ 0.08 s, holds
  ≤ 0.4 s and falls over ≥ 0.20 s. It never strobes, it never exceeds §15.5's 3%-per-step emissive
  budget, and nothing in this world flashes faster than 3 Hz. A one-frame flash at 60 Hz is invisible
  at 30 Hz and is a bug, not a style.

---

## 10. Exposure, grade and the sky

**Display-referred throughout, and the dither is the last operation in the frame.**

- **Linear workflow.** `THREE.ColorManagement.enabled = true`, `outputColorSpace = SRGBColorSpace`.
  Feed shaders the `linear` triplets from `palette.json`, never the hex. See §12.19 for the way this
  goes wrong silently.
- **Median frame luminance 0.35** (target 0.30–0.40). Mean 0.354 ± 0.05, mean saturation 0.313 ± 0.05.
- **Filmic curve with a soft shoulder.** Requirements, not a named curve:
  (a) the shoulder must **desaturate** as it compresses — measured, the armour's light band is S 0.67
  and its specular is S 0.373; (b) nothing clips to pure white except emitter cores, the sun and KaTeX
  glyphs (≤ 2% of pixels at Y ≥ 0.99; reference 0.12%); (c) the toe must not crush — 25% of the frame
  sits below Y 0.147 and still carries readable form (≤ 4% at Y ≤ 0.01; reference 1.5%).
- **The curve is a constant.** No auto-exposure, no eye adaptation, no per-frame histogram. If a piece
  ever needs adaptation it runs in `fixed()` at 60 Hz with a time constant ≥ 1.5 s and a hard rate
  limit, and it still has to pass §15.1: **median frame luminance may move ≤ 0.005 per fixed step with
  the camera static, ≤ 0.02 while panning.** An exposure that hunts is the most expensive kind of
  temporal noise, because it moves *every* pixel at once.
- **Forbidden:** whole-frame Reinhard, which flattens the mid plateau; and raw linear→sRGB with a hard
  clamp, which skews highlight hue instead of desaturating it.

### Dither the sky — and dither it with a *fixed* pattern

The reference's sky moves ~0.006 Y per 1% of frame height. Over a 1080p frame that is under one 8-bit
code value every three pixels — banding is guaranteed without dither. Measured: 21–45 distinct codes
per channel down a sky column, longest flat run **4 px**. The negative control, undithered: 4 codes,
longest run **38 px**. Auditor `S1`/`S2`.

That is the target. **This is the implementation, and it is binding:**

- **A fixed screen-space pattern: an 8 × 8 ordered Bayer matrix, or a fixed blue-noise tile.**
  Amplitude ±1 code value, applied after the tonemap, immediately before 8-bit quantisation.
- **Never per-frame random. Never re-seeded on camera motion, on frame index, or on time.** The same
  screen pixel gets the same offset on every frame, for as long as that pixel exists.
- Why this is a rule and not a preference: `S1` and `S2` are single-frame checks, and **a builder who
  hits 21–45 distinct codes with per-frame white noise passes both and ships a sky that fizzes.** The
  arithmetic is not close: one code step in the mid-tones is ≈ 0.0075 of luminance, so white-noise
  dither over the 31% of frame the sky occupies produces a whole-frame mean |ΔY| near **0.0023** —
  comfortably *inside* §15's 0.004 budget while every sky pixel crawls. `M4` is the check that sees it:
  **with the camera static, the 8-bit codes inside the sky probe box must be identical frame to frame**
  (≤ 2% of them may differ). Our synthetic control makes the point: the fixed-Bayer sequence scores
  `M4` = 0.000 and the per-frame-random sequence scores **0.609**.
- A dither that reseeds *only when the camera moves* looks perfect in a cold static capture and fizzes
  for a few frames every time the player turns. Capture it with `--mode=settle`, which pans hard,
  stops, and then takes a static pair.
- The same rule covers every other screen-space noise source in the frame — the AO kernel's rotation,
  any SSR jitter, volumetric step offsets. They all use the same fixed tile, or they all fizz.

Target luminance histogram: a broad, gently double-humped plateau. A dark lobe at Y 0.00–0.06 (14.2% —
ink, deep shadow, the framing foreground mass), a dip at Y 0.22–0.30, a wide mid plateau Y 0.31–0.66
(the lit world and the sky), then a fast decay above Y 0.70 with a thin tail to 1.0 carrying only
emitters, the sun and the glyphs. **Neither end spikes.** Percentile targets are in
`palette.json → luminanceHistogram.percentileTargets`.

---

## 11. UI surfaces

The UI is cool and dark so it never competes with the warm world. **The UI composites after the
tonemap.** Every number in this section is a property of the finished frame; a scrim that goes through
the curve does not deliver `alphaPeak` 0.91 and does not deliver the 4.5 : 1 contrast floor.

- **Panels** (minimap, bar tracks, menu cards): `ui.surface` `#2A3134` at **alpha 0.94**. Never fully
  opaque — the 6% of world showing through is what stops a panel looking pasted on.

### Scrims are graded plates, not bars — and this is a solved constant

The reference's subtitle band is **`ui.scrim` `#0B0B0B`, a neutral near-black plate with hard top and
bottom edges and an alpha that ramps to zero at both ends.** There is no single alpha for it, and the
file no longer offers one: `roles['ui.scrim']` carries `alphaPeak` and `alphaProfile`, and a builder
who wants one number has to notice that it isn't there.

```
band            y 0.8418 → 0.9577      (0.116 of frame height, hard edges)
plate extent    x 0.24 → 0.79          (0.55 of frame width)
alpha(x)        alphaPeak · clamp( min(x − x0, x1 − x) / 0.16 , 0, 1 )
alphaPeak       0.91                   (plateau, x 0.40 → 0.63)
plate colour    #0B0B0B, linear 0.0034 — neutral, not warm
```

**How it was solved.** Per column, at both band edges: samples 7 px inside and 7 px outside, with a
second outside sample at 15 px used only to veto columns where the underlying facet is not locally
smooth. Because the background varies only over Y 0.148–0.184 across the plateau, a regression *across
columns* cannot identify alpha — that is the trap. The identifiable regression is **across the three
channels of one column**, whose backgrounds differ by 4×: `in_ch = (1 − α)·bg_ch + α·p`. n = 146 column
solves over x 0.40–0.60 give median α **0.9077**, IQR 0.905–0.915, plate linear 0.0034, median
luminance transmission **0.110**. Both edges give the same profile independently.

**The witness that settles it.** Two columns, the same rock facet, the same four rows, 0.17 of frame
width apart:

| | above band (y 0.836) | inside (y 0.848) | inside (y 0.955) | below band (y 0.962) | transmission | alpha |
|---|---|---|---|---|---|---|
| **x = 0.30** | `#986448` Y 0.1626 | `#784D3B` Y 0.0962 | `#764D3C` Y 0.0949 | `#936552` Y 0.1612 | **0.59** | **0.41** |
| **x = 0.47** | `#9D6549` Y 0.1696 | `#32221A` Y 0.0190 | `#332018` Y 0.0180 | `#97654A` Y 0.1638 | **0.11** | **0.89** |

Both readings are correct. A single-alpha model of this surface is not — round 1 published 0.87 (the
plateau, measured on a partly unidentifiable region) and a later hand solve found 0.41 (the ramp at
x = 0.30), and the disagreement *was the finding*.

Transmission along the band, median-smoothed: 1.00 out to x 0.26, then 0.90 / 0.78 / 0.69 / 0.63 /
0.53 / 0.41 / 0.34 / 0.24 / 0.20 / 0.11 across x 0.2675 → 0.3625; plateau 0.107–0.124 over x 0.40 → 0.63;
then 0.15 / 0.27 / 0.44 / 0.45 / 0.52 / 0.95 across x 0.6425 → 0.795; 1.00 from x 0.80.

**The ramp is the whole reason it does not read as a black bar. The plate has no vertical edge anywhere
in frame.** Auditor `U1a` checks plateau transmission 0.06–0.20; `U1b` measures **ramp width** — the
distance in frame widths over which transmission climbs from plateau + 0.10 to 0.85 — and requires
≥ 0.05 at both ends. The auditor measures the reference's two ramps at **0.0825 and 0.1325**, and those
are the numbers now recorded in `palette.json`. *(Round 2's JSON said `[0.11, 0.15]` while the prose
said 0.08 and 0.13 and the auditor printed 0.0825 and 0.1325 — three values for one measurement.)* A
hard-edged rectangle scores 0.03 and fails.

**The scrim's warmth is transmitted rock, not paint.** From the same witness column at x = 0.30: inside
the band the rock reads `#784D3B` (hue 18, S 0.508) against `#986448` (hue 21, S 0.526) outside — hue
moves 3°, saturation moves 0.018. Only the value changes. Author a brown plate and it will fight every
other background it ever sits on.

**Scrims fade, they never cut.** A prompt band appears over ≥ 0.18 s and leaves over ≥ 0.25 s, easing
its `alphaPeak` and never its extent — an alpha that animates its *width* drags a vertical edge across
the world, which is anti-pattern 21 happening in time instead of in space.

### The rest of the UI

- **Stroke:** `ui.stroke` `#A8E0EC`, **0.00222 of frame height** — which is 2 px at 1600×900 and 4.8 px
  at 3840×2160 — with a soft outer glow. Every plate gets one. Author the *fraction*, multiply by the
  **drawing buffer** height, and never type the pixel count: anti-pattern 29 is what happens otherwise,
  and `quality-bar.md` G7 spans a 3× range of viewport on its own.
- **Ink:** `ui.ink` `#E8F1F0` primary, `ui.ink.dim` `#B5BEBD` secondary, and **one**
  `ui.ink.accent` `#9DEAF0` string per surface — the thing the player must read first. Never two.
- Minimum text contrast **4.5 : 1** against the composited surface, at every viewport size in the gate
  list.
- Meters are **segmented**, not smooth: the reference's health bar is 8 cells (7 filled) separated by
  visible gaps, each cell a two-band vertical gradient rather than a smooth one. The XP bar below it is
  thinner, unsegmented, and `reward.gold`. The portrait ring carries a pale-cyan stroke with a soft
  outer glow.
- **UI is drawn at whole DEVICE pixels.** A HUD element positioned at a fractional pixel and re-snapped
  every frame shimmers along its stroke. Round the composited position **in the drawing buffer**, not
  in CSS pixels — at DPR 2 a whole CSS pixel is two device pixels and rounding there rounds nothing.
  Animate opacity and scale rather than sub-pixel position.

---

## 12. Anti-patterns

Each of these is a specific way to look like a cheap WebGL demo. The negative control commits 1–17 and
22 and scores 10/30 census and 1/10 solved; the synthetic motion control commits 23–26 and scores
2/10 motion.

1. **Flat matte surfaces.** Lambert only, one directional light, no specular anywhere.
2. **Uniform ambient.** A constant ambient term instead of a hemisphere fill. Kills §3 outright.
3. **Shadow = albedo × 0.35.** Darkening instead of hue-rotating. Auditor `X1` goes to ~0.
4. **No contact shadow, no AO.** Objects float. Rounds 1–3 said "every object needs a dark contact
   where it meets ground" and gave no darkness, no radius and no falloff, which is not buildable and
   not checkable. The numbers (authored; `palette.json → materials.contactAO`): at the contact line
   the surface loses **≥ 45%** of its unoccluded linear luminance, recovering to zero over
   **0.35 m** for ordinary props and up to **1.2 m** under something the size of a grounded barge,
   on a smoothstep, applied **in linear before the tonemap**. Below ~30% the object still floats;
   above ~70% it reads as a painted shadow decal stuck to the ground. Judge it *at the contact*,
   never at the cast shadow's far end — that is anti-pattern 20's trap.
5. **Banded sky.** An 8-bit gradient with no dither. Auditor `S2`.
6. **Uncomposed frames.** Horizon at 0.5, hero dead centre, no dark framing mass, nothing off-frame.
7. **Global-threshold bloom.** Bloom on everything bright instead of an emissive mask. The sky blooms
   and the frame turns to soup.
8. **Emissives with no blown core.** Reads as a painted decal, not a light. Auditor `B1a`/`B1b`/`B1c`.
9. **Saturated cyan everywhere.** The identity colour spent until it means nothing.
10. **Grey fog.** Distance lerped toward grey instead of toward `sky.horizon` at the right hue.
11. **Uniform, aliased, crawling ink.** Constant width, pure black, no distance gate — and, the part a
    still frame cannot see, a width that changes frame to frame. Auditor `I1b` *and* `M3a`/`M3b`.
12. **Everything in focus.** No focus plane; auditor `D1`/`D4`.
13. **A post vignette used as composition.** Framing is geometry running off the edge of frame.
14. **UI painted in world colours.** Warm plates, orange text — it fights the rock and loses.
15. **Untonemapped output.** Linear clipped to sRGB: highlights skew hue instead of desaturating.
16. **A Fresnel rim on rock.** Instantly reads as wet plastic.
17. **Cyan mathematics.** The one thing on screen that must be legible, tinted into the background.
18. **`MeshStandardMaterial` at metalness 0.90–1.0 with no environment map.** A metal has no diffuse
    term; with no IBL it has nothing to reflect and renders near-black. §5 specs the hero's plate at
    metalness 0.90–1.0, so without an env map or a PMREM-processed scene environment the hero becomes a
    hole and `H1` fails — and it fails for a reason the auditor will report as a *composition* problem,
    which is how a whole review round gets spent looking in the wrong place. Set `scene.environment`
    (a PMREM of the sky) before you judge any metal.
19. **Double-encoded output.** `outputColorSpace = SRGBColorSpace` *and* a manual `pow(c, 1/2.2)` in a
    post pass, or an sRGB texture loaded without `SRGBColorSpace` set on it. The frame comes out washed
    or crushed and every colour in `palette.json` misses. Symptom: `L1` and `L4` are both off in the
    same direction while the hue census still passes.
20. **Shadow acne, or peter-panning from over-correcting it.** §2 authors cast shadows at 3.0–4.0×
    object height; long shadows need a large light frustum, which means low texel density, which means
    acne. The reflex fix — a big constant `shadow.bias` — detaches the contact shadow from the object
    and re-commits anti-pattern 4. Use a normal-offset bias plus a tight, fitted shadow camera, and
    check the *contact*, not the shadow's far end.
21. **A scrim with a vertical edge.** A UI plate that starts and stops abruptly reads as a black bar
    across the world. §11, auditor `U1b`.
22. **An additive hologram.** §8, auditor `V1a`/`V1b`.

And the five that exist only in motion — the ones round 2 had no vocabulary for:

23. **Per-frame random dither.** Passes `S1` and `S2` on every individual frame and fizzes on all of
    them. §10, auditor `M4`.
24. **A narrow specular lobe on a hard-faceted surface with no specular AA.** The highlight becomes a
    per-frame coin flip; the rock and the armour sparkle. §5, auditor `M1c`.
25. **Bloom that pops at the frame edge.** An emissive mask built only from visible pixels loses its
    emitter in one frame and the halo it was feeding vanishes. §8, auditor `M5`.
26. **A screen-space contour that crawls.** Width recomputed per frame from an unstable buffer. §5,
    auditor `M3a`/`M3b`.
27. **Anything that snaps on a threshold** — a shadow cascade, an LOD, an imposter, the DOF plane, the
    ink's distance gate, a streaming decision. §15.6.
28. **TAA used as a cover story.** A history weight above 0.95 passes every motion budget by smearing
    the frame, and produces the ghosting neither of our comparison games has. §15.8.

And the two that are specific to shipping this in a **browser** — the biggest one was missing entirely:

29. **Screen-space constants authored in CSS pixels and applied in device pixels.** This is the
    browser-specific trap this document had no entry for, and it silently breaks five of its own
    numbers at once. §5 quotes the ink as "1.7 px at 1600×900", §11 quotes the UI stroke as "2 px at
    1600×900", §15.3 and §15.4 budget ink crawl and dither churn in device pixels, and §8 budgets
    bloom σ as a % of frame height. On a 2× DPR display the drawing buffer is **3200×1800** while
    `window.innerWidth` still says 1600 — so an ink width typed as `1.7` is 0.85 CSS px (a
    sub-pixel line that crawls, `M3a`) or 3.4 device px (a fat outline that fails `I1a`), depending
    on which side of the boundary it landed. `quality-bar.md` G7 demands legibility at 1280×720
    *and* 3840×2160, which is a 3× range on its own. The rule
    (`palette.json → screenSpace`): **every screen-space width is a fixed fraction of frame
    HEIGHT**, multiplied by the *drawing buffer* height at use — ink `0.00189`, UI stroke `0.00222` —
    **the Bayer tile is applied in device pixels** (index `gl_FragCoord`, never a CSS-pixel UV, or
    the tile resamples and stops being fixed, which is anti-pattern 23 arriving through the back
    door), and **`renderer.setPixelRatio` is clamped at 2.0**.
30. **No half-float render target.** §8 requires the hologram quad and the bloom to composite **in
    linear, before the tonemap**, and "Which side of the tonemap" requires the KaTeX glyph layer to be
    driven ≥ 4× above the curve's Y 0.99 point and clip *through* the shoulder. An 8-bit unorm target
    quantises linear values in the toe and hard-clamps everything above 1.0, which makes both of those
    impossible: the glyphs land near 0.97 instead of 1.000, `V1` drifts, and the highlights skew hue
    instead of desaturating, which is anti-pattern 15 by another route. Every pass before the tonemap
    renders to **RGBA16F or better**.

And the four that are not about rendering at all — they are the ways a technically immaculate frame
still fails to be *this* world. §0 is the section; these are the symptoms:

31. **A valley floor.** Ground under the leaves, a distant plain, haze at the bottom of a gap. Below
    the leaves is where things stopped being true; there is nothing down there and there never will
    be. §0.1, `W1`/`W2`.
32. **A certainty that glows.** Set crystal given an emissive, a blown core or a bloom halo. It reads
    as a live claim, so the player cannot tell what they can solve from what they already have, and
    the two-tier rule collapses. §0.3, §0.4.
33. **Cyan left on a closed claim.** The emitted object keeps its glow after the snap. That is game
    state rendered wrong — the world is saying a finished sentence is still open. §0.2.
34. **A frame of humans at trades.** Busy, populated, beautifully lit, and every living silhouette is
    a person doing a job. `world.md` §0 calls that a bug however busy it is, and it is the failure the
    reference itself commits. §0.5, `W3`.

---

## 13. How to tell if we lost

Run this first, always — **both halves**:

```bash
node review/art-audit.mjs review/shots/<piece>/<name>.png --hero=x0,y0,x1,y1 --require-solved

node review/p02-motion-capture.mjs --mode=static --frames=6 --out=review/shots/<piece>/motion-static
node review/p02-motion-capture.mjs --mode=pan --degPerSec=60 --frames=6 --out=review/shots/<piece>/motion-pan
node review/art-audit.mjs --seq=review/shots/<piece>/motion-static --hero=x0,y0,x1,y1 --require-motion
node review/art-audit.mjs --seq=review/shots/<piece>/motion-pan    --hero=x0,y0,x1,y1 --require-motion
```

Any failing line is a concrete, located defect.

**Before the photometry, the five that say we built the wrong world.** These are new in round 4 and
they are first because a frame can score 29/29 on everything below and still be a transcription of
`reference/brief-hero.png` with a camera in it — which is exactly how this document lost a round.
**The reference itself fails four of the five**, which is what they are for.

| # | symptom | check | reference | what it means |
|---|---|---|---|---|
| W-1 | **grey share outside 0.02–0.08** | `C12` | **0.0123 — FAILS** | the antagonist has no surface. `world.md` Law 5 is not being rendered at all, and a quarter of the frame is undirected `muted` again. §0.2 |
| W-2 | **fewer than 2 regions of open sky below the horizon**, or any downward sightline ending in terrain | `W1` `W2`, eye | **fails — it is a canyon** | we have built a floating-island skin over a valley. `world.md` §2.3: there is no ground underneath, and a distant valley floor breaks the premise, not the art direction. §0.1 |
| W-3 | **fewer than 3 non-player presences at 128 px, or all of them human-shaped** | `W3`, eye | **1 presence, 0 non-human — FAILS** | the world is a diorama with a protagonist in it. `world.md` §0 calls this a bug however busy the frame is. §0.5 |
| W-4 | **a certainty that emits, blooms or exceeds Y 0.72; or a closed claim that still glows** | eye | n/a — the reference has neither object | the two-tier rule has collapsed and the player cannot tell what they can solve from what they already own. §0.3, §0.4, anti-patterns 32–33 |
| W-5 | **more than one distant mass silhouetted, or the one landmark above 0.70× its sky** | `D5` | 0.592 | the horizon has stopped posing a question and become a row of equally interesting dark shapes. §0.6, §7 |

**Then the photometry**, in the order it costs us the most:

| # | symptom | check | reference | what it means |
|---|---|---|---|---|
| 1 | **it turns to noise while running** — any `M` check fails | `M1`–`M7` | n/a (a still) | quality-bar.md §1's top line. Nothing below this matters if this fails |
| 2 | **shadow cool share < 0.38** | `X1` | 0.506 | shadows are being multiplied, not authored. The biggest still-frame tell |
| 3 | **hot resonance share > 0.05 or < 0.02** | `C5` | 0.031 | the cyan is either spent or absent; it has stopped meaning "mathematics is live" |
| 4 | **warm : resonance outside 1.4–2.4** | `C6` | 1.87 | the warm/cool division that carries the whole image has collapsed |
| 5 | **veil slope outside 0.30–0.72, or fixed point outside 0.40–0.50** | `V1a`/`V1b` | 0.60 / 0.42 | the hologram is additive or flat; it will be illegible on some backdrop. (These are the auditor's own probe values; §8 lists the five estimators and their spread) |
| 6 | **scrim plateau transmission outside 0.06–0.20, or ramp width < 0.05** | `U1a`/`U1b` | 0.108 / 0.0825 | a black bar across the world; the world stops reading through the prompt |
| 7 | **acutance hero/midground < 2.5** | `D4` | 4.3 | no focus plane; the frame is a flat diorama |
| 8 | **hero/surround separation < 0.10 on ANY frame** | `H1`, `M7` | 0.107 | the silhouette has dissolved into the background — check §12.18 before anything else |
| 9 | **emitter peak < 0.90 inside the declared box, blown share outside 0.0002–0.006, or the peak's component > 0.4% of frame** | `B1a`/`B1b`/`B1c` | 0.9496 / 0.00179 / 0.000058 | emissives are painted decals — or something that is not an emitter is being scored as one |
| 10 | **key : fill outside 6.2 ± 1.6 on the marked boxes** | `K1` | 6.18 | the light rig is not the light rig |
| 11 | **sky third quiet share < 0.90** | `C7` | 0.972 | the sky is over-saturated and has started competing with the world |
| 12 | **longest flat sky run > 8 px** | `S2` | 4 | banding; the ramp is not dithered |
| 13 | **sky 8-bit codes change with the camera still** | `M4` | n/a | the dither is per-frame random and the sky fizzes. `S1`/`S2` cannot see this |
| 14 | **median Y outside 0.30–0.40** | `L1` | 0.351 | exposure is wrong before any art question is worth asking |
| 15 | **> 2% of pixels at Y ≥ 0.99** | `L6` | 0.0012 | highlights clipping; the shoulder is missing |
| 16 | **ink p90 ≤ p50**, or ink width moving > 1 px between frames | `I1b`, `M3a` | +4 px / n/a | the outline is uniform width, or it crawls |
| 17 | **> 0.2% of pixels moving > 0.05 Y with the camera still** | `M1c` | n/a | specular sparkle: no normal-variance-to-roughness (§5) |
| 18 | **saturation does not rise with depth** | `D3` | +0.277 | no aerial perspective |
| 19 | **border dark share < 0.06** | `F1` | 0.178 | the frame is unframed — no geometry anchoring the corners |
| 20 | **off-language hue > 2%** | `C11` | 0.003 | colours have leaked outside the two arcs |
| 21 | **any `n/a` in the solved or motion section** | — | — | the check could not run. On a UI or hologram piece that is a failure (`--require-solved`); on a material, light, post, animation or camera piece, so is a missing motion sequence (`--require-motion`) |

And the five things the auditor cannot see, which a critic must check by eye against
`reference/brief-hero.png`:

22. **At 64 px the WORLD layer resolves fewer than 4 or more than 7 elements** (§6 defines "element"
    and excludes the HUD). Empty, or noise. And the count is not sufficient on its own — see `W3`
    above; five elements none of which is alive is a passing count and a failing frame.
23. **The hero's five silhouette features are not all countable at 128 px** (§6) — including the can,
    which the reference does not have. Not 64 px — the reference itself fails at 64. And **Ix's
    silhouette closes, or reads as an animal**: it is an open bracket and a drifting point with four
    lights, and if a stranger names a pet at 128 px the model is wrong (§0.5).
24. **Rock has a soft terminator, or a Fresnel rim.** It will read as plastic or clay, not stone.
25. **The hologram is legible on one background but not another.** Test it against the bright horizon
    *and* against the dark city in the same capture. `V1` catches the coefficient; only an eye catches
    a panel that is technically compressing and still unreadable.
26. **Watch a 60 °/s pan and a full-speed run at real speed, and say whether you can still read the
    hero, the horizon and the equation.** Every `M` check is a proxy for that question. A sequence can
    score 10/10 and still feel like soup, and that is the one judgement no number in this file makes.

---

## 14. Provenance

Every sampled number here came from `reference/brief-hero.png` (2752 × 1536, aspect 1.792) via scripts
left in `review/`. Every temporal number is authored, and its reasoning is in §15.

| script | what it produced |
|---|---|
| `review/p02-measure.mjs` | global census, hue histogram, luminance histogram, row/column profiles |
| `review/p02-crop.mjs`, `review/p02-crop2.mjs` | high-zoom crops; the 64 px and 128 px thumbnails and hero cut-outs |
| `review/p02-grid.mjs` | labelled normalised grids used to place every sample box by eye, not by guess |
| `review/p02-measure2.mjs` | region means, ink census, depth-band contrast, thumbnail + value study + saturation map |
| `review/p02-measure3.mjs` | region median/high/low triplets, sky ramp, aurora delta, lit-vs-shadow pairs |
| `review/p02-measure4.mjs` | DOF acutance, the hero rim cut |
| `review/p02-measure5.mjs` | disproved a rose aurora band |
| `review/p02-shadowcheck.mjs` | the shadow-chroma census behind §3 |
| `review/p02-terminator.mjs`, `review/p02-term2.mjs` | the two shading ramps in §4 |
| `review/p02-resolve.mjs` | round 2: every SOLVED constant — scrim alpha profile, veil compression with its sensitivity sweep, emitter peak, bloom annuli, key:fill, ink percentiles, accent component census, leg-gap segmentation, the two new albedo roles → `review/p02-solved.json` |
| **`review/p02-png.mjs`** | **round 3: a dependency-free PNG decoder (zlib + all five scanline filters), so nothing that judges a temporal claim shares a decoder with the census** |
| **`review/p02-r3-measure.mjs`** | **round 3: full-resolution re-derivation — census, the resonance-arc margin, the `B1` mask diagnosis, blown share under all three candidate definitions, the blown-component census, composition invariants** → `review/p02-r3-measurements.json` |
| **`review/p02-r3-sweep.mjs`, `review/p02-r3-sweep2.mjs`** | **round 3: ten and six candidate substance gates × five stress cases — where `V > 0.70 & S < 0.45` came from** |
| **`review/p02-motion-capture.mjs`** | **round 3: real frame sequences from the running app, exactly one fixed step apart, in four modes (static / pan / settle / run)** |
| **`review/p02-motion-control.mjs`** | **round 3: the synthetic clean and dirty sequences that prove the motion checks reject as well as accept** |
| **`review/p02-r4-measure.mjs`** | **round 4: the grey-class candidate sweep, the landmark : sky contrast with its boxes, the CCT re-derivation under two sRGB→XYZ matrices, the exact colour data for the new roles, and every acutance box re-derived at full resolution** → `review/p02-r4-measurements.json` |
| **`review/p02-r4-palette.mjs`** | **round 4: the in-place amendment of `design/palette.json` — new roles, the `grey` class, the Lethis envelope, the two renamed keys, the three stale-drift fixes, `materials.*` and `screenSpace.*`. Idempotent; `--check` fails if the file is not amended** |
| `review/p02-make-palette.mjs` | the **round-1 seed** generator. **Superseded — do not run it.** It predates the substance gate, the motion block, `solvedConstants` and everything round 4 added, and running it would silently revert them. `design/palette.json` is amended in place by dated scripts now, and each one ships a `--check` |
| `review/p02-sync-doc.mjs` | generates §9's hue-partition table from `palette.json` so prose and auditor cannot drift |
| `review/art-audit.mjs` | the auditor — **30** census checks (round 4 added `C12` grey and `D5` landmark), 11 solved-constant checks, 10 motion checks. Prints its own invocation |
| `review/p02-negative-control.mjs` | the synthetic bad frame that proves the auditor rejects as well as accepts |

Raw measurements are in `review/p02-reference-measurements*.json`, `review/p02-solved.json` and
`review/p02-r3-measurements.json`; inspection images in `review/p02-crops/`; saved auditor output in
`review/p02-audit-*.txt`.

**What round 2 changed.** Round 1's sampled numbers all reproduce; its solved numbers did not.
Corrected: `ui.scrim` (a single alpha replaced by a measured graded profile); `holo.veil` (a three-point
fit replaced by 116 pairs plus a sensitivity sweep, alpha 0.41 → 0.50, fixed point promoted to the
primary constant); the socket emitter peak (0.74 → 0.9496); the bloom falloff table (withdrawn as
non-reproducible); key : fill (7.0 → 6.2, on recorded boxes); ink percentiles (now quoted with their
threshold); `depthCues.saturationByThird`; the `accessibility` block; `hero.accent` (chest → shoulder
blade); the §6 thumbnail gate (64 px → 128 px, leg gap dropped); the hue partition (prose now generated
from the JSON). Added: `rock.bone`, `world.foliage`, `solvedConstants`, and checks `U1`, `V1`, `B1`,
`K1`, `I1`.

**What round 3 changed, and why each one was a real defect.**

1. **§15 exists.** Every number in rounds 1 and 2 was computed on one still of one camera at one
   instant, and the top line of the quality bar is about motion. Added a motion section with budgets,
   a capture tool, ten auditor checks and a synthetic control pair.
2. **§5 gained specular antialiasing.** §4 mandates hard-faceted rock and §5 mandates metalness
   0.90–1.0 at roughness 0.22–0.38; together those alias at 1600×900 and nothing acknowledged it.
3. **§10's dither gained a pattern and a temporal rule.** The published target (21–45 codes, longest
   run 4 px) is reachable with per-frame white noise, which passes `S1`/`S2` and fizzes.
4. **§7 was split** into "reference framing" and "invariant". A horizon at 0.31 and a hero centre at
   0.352 are facts about one camera; nine rules now say what must hold from any camera.
5. **§2's key was re-anchored to the world.** "azimuth +62° from camera forward" describes a light
   bolted to the camera boom.
6. **Every section now declares its pipeline stage,** and the §8/§10 contradiction over glyph white is
   resolved explicitly.
7. **`B1a` was a null check.** It masked hue 150–215 over the whole frame — 34.8% of the reference,
   with its peak at the extreme right edge — and it passed on the negative control. It is now a
   declared box plus a connected-component test, and it fails the negative control at 0.6894.
8. **`blownShareOfFrame` carried two values for one constant** (0.0018 in the prose, 0.0008 from the
   code, because the code applied an extra S ≥ 0.06 that excluded the very pixels the rule is about).
   One definition now, in both files: 0.00179.
9. **`scrimTransmission.referenceValue.rampWidth`** read `[0.11, 0.15]` against prose saying 0.08/0.13
   and an auditor printing 0.0825/0.1325. Set to the auditor's values.
10. **The `#68704F` terminator stop** was typed as hue 68 / S 0.26 in two places and hue 75 / S 0.295
    in a third, for the same hex. It is 74.5 / 0.295.
11. **The `resonance` class was a coin flip on sky saturation.** Added the substance gate (§9), which
    cuts the drift under a +0.10 sky push from 0.038 to 0.002 while still failing a genuinely
    over-saturated frame.
12. **The negative control's invocation is recorded**, because its score is not reproducible without
    its `--hero` and `--holo` boxes.

**What round 4 changed, and why each one was a real defect.**

1. **§0 exists, and it is the round's whole point.** `design/world.md` was written 47 minutes before
   round 3 of this file, is equally binding, and hands P02 four named hooks. This document inherited
   **none** of them: a grep of both owned files for `Leaf`, `Lethis`, `Margin`, `Certainty`,
   `Sufficiency` and `Ix` returned zero hits each. §0 binds all four to numbers — the diegetic
   stone/teal/grey split with a live-claim budget, grey as a third material class, the two-tier
   beauty rule with an 0.18 luminance gap, and the living-silhouette gate — and adds §0.1, which is
   the section that says the reference is a photometric target and not a content one.
2. **§15.7 forbade the mechanic the game is named after.** "There is no night, no noon, no
   colour-temperature cycle … a later piece that wants one must re-derive this document" stood in
   direct contradiction to `world.md` §11's brief for P10, "Lethis is a *character* — it swells and
   dims on no schedule and the sky must visibly not be on a loop." Replaced by an envelope: key
   intensity 1.00 ± 0.12 on an aperiodic sum-of-primes drive, rate-limited to 0.15% per fixed step,
   **clamped by `K1` and `L1`** so the swell is bounded by this file's own measurements instead of
   exempt from them. Every other constant is untouched.
3. **`grey` was 24.79% of the frame with no name.** §9's partition scored `world.md`'s third material
   as anonymous `muted`. It now has two roles, an arc, a budget (`C12`) and a material spec — and the
   reference fails `C12` at 0.0123, which is the correct answer.
4. **The two motion-control rows did not reproduce.** Round 3 published `13/28 · 6/9 · 10/10` and
   `13/28 · 6/9 · 2/10` with **no `--hero` box recorded**, three lines under its own footnote "boxes
   are arguments; arguments get recorded" and one round after it fixed exactly this for the negative
   control. Both invocations are now in the table at the top of this file, and **the auditor prints
   its own `argv` into the first line of every report**, so a saved audit carries its own arguments
   from here on.
5. **The saved motion evidence was measured on a different sky box from the one in force.**
   `review/p02-audit-motion-good.txt` was produced with `M4` sky box `[0.05,0.02,0.35,0.28]` while
   `palette.json → motion.skyProbeBox` had become `[0.05,0.02,0.35,0.14]`. All four control audits
   have been re-run and re-saved against the current file.
6. **The §2 CCT column was wrong by 1250 K on the key.** ~3000 K / ~11000 K / ~2200 K against a
   recomputed **4254 / 9647 / 2833**. It mattered: a kelvin→RGB helper at 3000 K returns `#FFB16E`,
   which drags lit rock out of the hue 25–35° band the green-lift argument protects. The column is now
   correct *and* explicitly marked informational, with the proof that even the corrected number does
   not reproduce `#FFE8A0`.
7. **`motion.timeOfDay.keyAzimuthDeg: 62` was the round-2 bug the prose said had been fixed.** The
   prose was corrected in round 3; the machine-readable half — which this document declares
   authoritative — was not. Renamed `keyAzimuthDegInReferenceFramingOnly`, with
   `keyBearingIsWorldFixed: true` beside it.
8. **`exposure.middleGrey.linearY: 0.35` named the wrong side of the tonemap.** The key said
   scene-referred linear (where the convention is 0.18) and its own note said "median frame
   luminance", which the pipeline-stage table puts on the display side. This file calls that "the most
   expensive mistake available". Renamed `medianFrameLuminanceDisplayY`, with an explicit
   `pipelineStage: "display-referred"`.
9. **Three stale-drift values of the class round 3 claimed to have eliminated.**
   `roles['hero.skin'].note` still cited rock's **7:1** key:fill, withdrawn in round 2 and replaced by
   `K1` = 6.2. `roles['rock.shadow'].note` said hue **+230…+245°** where −115…−120° is +240…+245° and
   §3 prints +240°. And `depthCues.acutanceMeasured.hero` read **0.1042** against §7's **0.0961** and
   the live auditor's **0.09612** — three values for one measurement. All three corrected; the whole
   acutance block re-derived at full resolution, **with every box recorded**, which exposed a fourth:
   the unrecorded "flat sky noise floor 0.0123" had been measured on a box containing the HUD.
10. **Three rules had no number and could not be built.** §5's two-lobe specular (now: broad lobe
    roughness 0.45 at 0.25 intensity, narrow 0.12 at 1.0, gated to N·V < 0.35 feathered over 0.10);
    §7's "value contrast against sky is what makes a landmark read" (now `D5`, ≤ 0.70×, with boxes and
    counter-examples); and §12.4's contact shadow (now ≥ 45% darkening over 0.35 m, smoothstep, in
    linear).
11. **The biggest browser-specific anti-pattern was missing.** Device pixel ratio silently rescales
    every screen-space constant in this file — the ink, the UI stroke, the dither tile, the bloom σ —
    while `quality-bar.md` G7 demands legibility across a 3× viewport range. Anti-pattern 29, plus a
    `screenSpace` block that expresses all of them as fractions of frame height. Anti-pattern 30 adds
    the half-float render target without which §8's "composites in linear, before the tonemap" is not
    physically possible.

**Honest limits.** The reference is a painted illustration, and four things follow. Its shadow lengths
imply a sun 8° higher than its sky does; its rock shadows are hue-rotated further than any ambient
could push them; its depth of field is stronger than a game camera would produce at that framing; and
**it has no second frame, so it can say nothing at all about §15**. The first three are reproduced here
as *authored* rules with numbers, because they are what makes the image look the way it does. The
fourth is why §15's numbers are argued rather than sampled, and why they are checked against our own
captures instead. Where this document says "authored", do not go looking for a physical justification —
there isn't one, and chasing it will make the render worse.

---

## 15. Motion

`design/quality-bar.md` §1: *"Readability under motion beats detail at rest. If it turns to noise while
running, it is wrong."* That sentence outranks every number in §1–§14. This section is the part of the
art direction that has a number for it.

**Where these numbers come from.** Not from the reference — it is one painted frame and has no second
frame to difference against. They are **authored**, from three arguments: what the mandates in §4, §5,
§8 and §10 will do if left unconstrained; what a 60 Hz fixed step makes visible; and what our own
captures actually produce. Each budget below says which. They are checked against **our** frames, by
the `MOTION` section of `review/art-audit.mjs`, on sequences captured by
`review/p02-motion-capture.mjs` whose frames are **exactly one 1/60 s simulation step apart**.

> **Why a capture tool exists at all.** A headless screenshot costs seconds of wall-clock. If the
> realtime loop kept running between two captures, the frames would be *seconds* of game time apart
> while claiming to be one step apart — the exact measurement artefact `CLAUDE.md` warns about, and it
> would bias every number here in the direction of "everything looks stable". The tool halts the
> kernel's animation loop and advances `simTime` by hand, and it fails the sequence if the measured
> step deltas are not 0.01667 each. Pan mode calibrates itself: it measures the yaw the rig actually
> produces for a trial mouse delta, solves for the pixels per step that give 60 °/s, and reports what
> it achieved (58.99 °/s on the current build). Nothing here assumes a sensitivity constant that a
> later piece is free to change.

### 15.1 The temporal stability budget

**With the camera static and the simulation advanced exactly one fixed step, almost nothing should
change.** The player is not looking at anything that moves; a difference here is noise.

| # | budget | value | what it catches |
|---|---|---|---|
| `M1a` | mean \|ΔY\| per fixed step | **≤ 0.004** | fizz, shimmer and pop, in one number |
| `M1b` | p99 \|ΔY\| per fixed step | **≤ 0.02** | the noisiest 1% of frame |
| `M1c` | share of pixels moving > 0.05 Y | **≤ 0.002** | specular sparkle — see below |
| `M6` | median frame Y step | **≤ 0.005** | exposure pumping, unstable tonemap |
| `M2` | hero silhouette area step | **≤ 0.01** | an edge eating itself |

**Three numbers and not one, and here is the arithmetic that forces it.** One 8-bit code step in the
mid-tones is ≈ 0.0075 of luminance. Per-frame-random sky dither over the 31% of frame the sky occupies
produces a mean |ΔY| of about **0.0023** — *inside* the 0.004 budget, while every sky pixel crawls. And
900 two-pixel specular sparkles are 0.25% of a 1600×900 frame, which barely moves a p99. So `M1a` alone
is not enough: `M1c` counts the sparkles and `M4` checks the sky's actual code values. Our synthetic
controls, six frames each: the clean sequence scores `M1a` 0.00006 / `M1b` 0.0022 / `M1c` 0.00008; the
dirty one scores 0.00753 / 0.10614 / 0.0192.

### 15.2 Under motion — a 60 °/s pan, and a full-speed run

At 60 °/s one fixed step is one degree of yaw and most pixels change a great deal, so a whole-frame
difference means nothing. **What must not change is the read.**

| # | budget | value |
|---|---|---|
| `M2` | hero silhouette area, frame to frame | **≤ 3%** |
| `M7` | hero/surround separation, worst frame | **≥ 0.10** |
| `M6` | median frame Y step | **≤ 0.02** |
| `M3a`/`M3b` | ink width step | **≤ 1 px / ≤ 2 px at 1600×900** |
| `M5` | emissive energy step | **≤ 3%** |

Silhouette area is measured as the **largest connected component** of the hero's segmentation inside a
padded hero box, not as a pixel count inside a fixed rectangle — a rectangle would score the hero
*walking across the box* as though his silhouette were changing size. On the current build a 60 °/s pan
gives `M2` = 0.00242 against the 0.03 budget and a full-speed run gives 0.00766 (round-4 capture,
`--hero=0.343,0.415,0.422,0.825`).

Capture `--mode=run` as well as `--mode=pan`: the run cycle is its own source of silhouette
instability, and a rig that holds under a pan can still lose the hero when he is moving *and* the
camera is chasing him. `M7` is the check that matters most here, and §6 explains why one still frame
can never stand in for it.

### 15.3 The ink line must not crawl

**≤ 1 px of change in median contour width and ≤ 2 px in p90, between adjacent frames, at 1600×900.**

Anti-pattern 11 has always named crawling ink, but the only check for it, `I1b`, measures the *taper*
(p90 7 vs p50 3 on the reference) on **one frozen frame** — and a contour that alternates 3 px and 6 px
scores a textbook taper on every individual frame while crawling visibly. Our dirty control does
exactly that: `I1a` and `I1b` are satisfied frame by frame, and `M3a` reports a 3 px step, `M3b` a 4 px
step.

The implementation rule that follows: derive the contour from **depth and normal buffers**, at a width
that is a fixed function of screen depth, with a hysteresed threshold. Never from a per-frame random,
never from a threshold on a temporally unstable buffer, never at sub-pixel widths that round
differently each frame. The same argument applies to the KaTeX glyph edges in §8.

### 15.4 Dither is a fixed screen-space pattern

**8 × 8 ordered Bayer, or a fixed blue-noise tile. ±1 code. Applied last, after the tonemap, before
8-bit quantisation. Never per-frame random. Never re-seeded on camera motion, frame index or time.**

`M4`: with the camera static, **≤ 2% of the 8-bit codes inside the sky probe box may differ between
adjacent frames.** Fixed Bayer scores 0.000; per-frame white noise scores 0.609. The full argument,
including why `S1`/`S2` cannot see this, is in §10.

A dither that reseeds *only* when the camera moves is the nastiest version, because it is invisible in
a cold static capture. Capture it with `--mode=settle`, which pans hard for half a second, stops, and
then takes a static pair — the frames are static, but the camera stopped one step ago.

### 15.5 Emitters and bloom change slowly

**An emitter's screen energy — luminance summed over the emissive mask — may change by no more than
3% per fixed step**, i.e. 86% per second. `M5`.

Four failures share that one number:

- **Bloom popping at the frame edge.** An emissive mask built only from visible pixels loses its
  emitter the instant its last pixel leaves frame, and the halo it was feeding vanishes in one frame.
  Build the mask on a guard band of ≥ 8% of frame width beyond each edge, or weight each emitter by a
  smoothstep over the outer 6%. At 60 °/s and a 62° FOV an emitter takes about a second to cross the
  frame, so a smooth exit is ≲ 2% per step and a pop is 100%.
- **Strobing.** 3% per step is also the fastest an emitter may flash before it reads as a strobe rather
  than a beat, and it is the accessibility floor: nothing in this world flashes faster than 3 Hz.
- **A shadow family switching.** §3 chooses a family by *situation*; a hard switch as the player walks
  past an emitter is a visible colour pop. Blend family weights over ≥ 0.25 s on distance.
- **A state flash.** §9's rise/hold/fall envelope is the same budget seen from the UI side.

An authored 2-second pulse at 10% amplitude changes about 0.5% per step, so this leaves plenty of room
for things to feel alive. Our clean control measures 0.0005; the dirty one, whose core radius jumps 40%
every other frame, measures 0.0397.

### 15.6 Nothing may snap on a threshold

Any per-frame decision made by comparing a continuous quantity to a threshold is a pop waiting for the
player to stand at the wrong distance. Every one of these needs hysteresis, a blend band, or both:

- **shadow cascades** — snap the cascade's texel grid to whole texels in *world* space so the shadow
  does not swim when the camera moves, and overlap cascade bands by ≥ 10% with a blend. §2's 3.0–4.0×
  shadow length makes this harder, not easier: a long shadow needs a large frustum and a large frustum
  has low texel density (§12.20).
- **LODs and imposters** — cross-fade over ≥ 0.15 s or a ≥ 15% distance band; never switch on a frame.
- **the depth-of-field plane** — a smoothed follow of the hero's depth, time constant ≥ 0.3 s, not a
  per-frame solve (§7).
- **the ink's distance gate** — fade across the foreground/midground boundary; §5 already says so and
  the reason is temporal.
- **any culling or streaming decision** that changes what is drawn.

### 15.7 One hour, held — and a star that will not hold still

**The world is a long dusk and it stays one.** Key elevation +8°, one world bearing, `sky.sun`
`#FFE8A0`, for the whole session. The key may drift **±3° of elevation and ±8° of azimuth over a
20-minute period**, so a returning player feels time pass. That is 0.00011° per fixed step — far below
anything a frame pair can resolve, and slow enough that no shadow ever sweeps visibly.

**And the star itself varies, because the game is named after it.** Round 3 wrote "there is no night,
no noon, no colour-temperature cycle" and then, one sentence later, "a later piece that wants one must
re-derive this document, not extend it" — which pre-emptively forbade the one thing `world.md` §11
hands P10:

> Lethis is a *character* — it swells and dims on no schedule and the sky must visibly not be on a
> loop. *(`world.md` §3: "Its output is an unsolved function: it swells and dims on a period nobody
> has pinned." §9: the cosmic stake is "the sky, every frame, doing real work.")*

Those two documents were in direct contradiction and this file was the one in the wrong. **The ban is
replaced by an envelope**, and the envelope is built so that every constant measured in this document
survives it untouched. It lives in `palette.json → motion.timeOfDay.lethisVariability`.

| | |
|---|---|
| **what varies** | the key light's **intensity**, and nothing else |
| **mean / swing** | **1.00 ± 0.12** |
| **rate limit** | **≤ 0.0015 of full intensity per fixed step** (0.15% per step, 9%/s at the fastest) |
| **drive** | a sum of **≥ 4 sinusoids on mutually prime periods, none shorter than 40 s** — e.g. 41 / 67 / 113 / 269 / 617 s — normalised to unit peak, evaluated in `fixed()` from `simTime` |
| **held exactly** | `sky.sun` `#FFE8A0` · elevation +8° ± 3° · the key's world bearing · the sky gradient · every colour in `palette.json` |
| **clamped by** | **`K1`** key : fill on the marked rock boxes stays inside **6.2 ± 1.6**, and **`L1`** median frame luminance stays inside **0.30–0.40** |

**The clamps are the point.** `K1` and `L1` are two of this document's own measured constants, so the
swell is not an exemption from the measurements — it is a quantity *bounded by* them. A swing that
pushes either out of band is too big, whatever the sky looks like, and that is what makes the star's
variability **measurable rather than a re-derivation of this file**.

**Why those numbers.** ±12% at ≤ 0.15% per step means a full excursion takes at least 1.6 s and in
practice much longer, which sits comfortably under `M5` (emissive energy ≤ 3% per step) and under
`M6` (median frame Y ≤ 0.005 per step with the camera static) — so §15.1's and §15.5's budgets still
pass with the swell running, and §15.1's arithmetic about a fizzing sky is unaffected. It is far below
the 3 Hz accessibility floor. And ±12% of key intensity moves the display-referred median by well under
0.05 through §10's shoulder, which is why `L1`'s 0.10-wide band can hold it.

**Aperiodic is a requirement, not a flourish.** `world.md` has had Lethis under review for eleven
thousand four hundred years *precisely because nobody has pinned its period*. A single sine is the one
implementation that contradicts the fiction — a player with a stopwatch would solve in ninety seconds
the thing the campaign's final claim is about. A sum of mutually prime periods does not repeat inside
a session, and it still runs in `fixed()` from `simTime`, so it is deterministic and G4-safe.

**What is still forbidden: night, noon, and a colour-temperature cycle.** Every constant in this file
was measured at this hour — §3's shadow families, §9's budgets, §10's histogram, §2's ratio are all
properties of a low sun in a warm sky. A day/night cycle is not a feature this art direction can absorb
without being re-measured end to end; a later piece that wants one must re-derive this document, not
extend it. **Brightness is the exception, and it is the exception because it is clamped.**

What *else* is allowed to change with time: the aurora's band positions and intensities (slowly —
15.5), the emitters' pulses, the drift of distant haze. The sky's *gradient* is fixed; its *level*
breathes with Lethis.

### 15.8 Temporal antialiasing, if used

TAA is permitted and it is allowed to help these budgets. It is **not** allowed to be how they are met.

- fixed 8-sample Halton jitter, reset on a camera cut
- velocity-rejected history, clamped to the 3 × 3 neighbourhood of the current frame
- **history weight ≤ 0.95.** Above that, TAA passes every check in this section by smearing the frame,
  and produces the ghosting neither *BotW* nor *Fortnite* has.
- **it does not excuse §15.4 or §5's specular AA.** TAA over per-frame-random dither is a blur; TAA
  over an aliasing specular lobe is a smear that still sparkles wherever the velocity buffer is wrong.
  Fix the source.
- with TAA on, `M2` and `M7` still have to pass under a 60 °/s pan and a full-speed run, which is where
  too heavy a history shows up as a hero lagging his own outline.

### 15.9 The motion auditor, and what it currently says about us

```bash
node review/p02-motion-capture.mjs --mode=static --frames=6 --out=review/shots/<piece>/motion-static
node review/p02-motion-capture.mjs --mode=pan --degPerSec=60 --frames=6 --out=review/shots/<piece>/motion-pan
node review/p02-motion-capture.mjs --mode=settle --frames=4 --out=review/shots/<piece>/motion-settle
node review/p02-motion-capture.mjs --mode=run    --frames=6 --out=review/shots/<piece>/motion-run
node review/art-audit.mjs --seq=review/shots/<piece>/motion-static --hero=x0,y0,x1,y1 --require-motion
```

The controls, which is how we know the checks reject as well as accept:

| check | budget | clean control | dirty control |
|---|---|---|---|
| `M1a` mean \|ΔY\| | ≤ 0.004 | 0.00006 | **0.00753** |
| `M1b` p99 \|ΔY\| | ≤ 0.02 | 0.0022 | **0.10614** |
| `M1c` share moving > 0.05 Y | ≤ 0.002 | 0.00008 | **0.0192** |
| `M4` sky code churn | ≤ 0.02 | 0.000 | **0.609** |
| `M2` silhouette area step | ≤ 0.01 static | 0.000 | 0.0034 |
| `M3a` ink p50 step | ≤ 1 px | 0.0 | **3.0** |
| `M3b` ink p90 step | ≤ 2 px | 0.0 | **4.0** |
| `M5` emissive energy step | ≤ 0.03 | 0.0005 | **0.0397** |
| `M6` median Y step | ≤ 0.005 static | 0.000 | **0.00723** |
| `M7` separation, worst frame | ≥ 0.10 | 0.154 | 0.153 |
| | | **10/10** | **2/10** |

**And what it says about the build as it stands.** The current app is a W1 scaffold — a pale-blue
capsule on an orange plane, no world art — so its census scores mean nothing yet. Its *motion* scores
already mean something. Re-captured and re-audited in round 4, with the invocation recorded:

```bash
node review/art-audit.mjs --seq=review/shots/p02/motion-<mode> \
     --hero=0.343,0.415,0.422,0.825 --require-motion
```

*(That `--hero` box is the capsule's actual extent in the round-4 capture, read off the frame rather
than guessed. Round 3 published this table with no box written down at all, which is why none of its
numbers reproduce — see provenance change #4.)*

| mode | achieved | result |
|---|---|---|
| `static` | step deltas 0.01667 × 5 | 7/8 · `M1a` 0 · `M4` 0 · `M2` 0.00004 · `M6` 0 · **`M7` 0.0504 FAIL** |
| `pan` | **58.99 °/s** measured | 3/4 · `M2` 0.00242 · `M6` 0.00494 · **`M7` 0.0245 FAIL** |
| `settle` | pan → stop → static pair | **8/8** · `M4` 0 · `M7` 0.1104 **pass** |
| `run` | full speed, camera chasing | 3/4 · `M2` 0.00766 · **`M7` 0.0512 FAIL** |

`M7` fails in three of the four modes, and the fourth is the most useful result in the table. The
scaffold's pale-blue capsule against orange ground has essentially no value separation — 0.050 static,
falling to **0.025** across six frames of a pan as the background brightens. In `settle` it *passes*
at 0.110, because that mode pans hard and stops with the capsule in front of the dark upper sky
instead of the ground. **Same avatar, same lighting, same build: one framing scores 0.110 and another
scores 0.025, and only one of them is a screenshot somebody would choose.** That is a real, located
defect for whoever owns the avatar (§6, §12.18) and the lighting, and **no still-frame check in this
document can report it**, because a single well-chosen still is always allowed to be the lucky frame.
That is the argument for this whole section, in one number — and it is now also the argument for §0,
one level up: a document can be right about every pixel and still be measuring the wrong world.

Saved output: `review/p02-audit-app-static.txt`, `-pan.txt`, `-settle.txt`, `-run.txt`,
`review/p02-audit-motion-good.txt`, `review/p02-audit-motion-bad.txt`,
`review/p02-audit-reference.txt`, `review/p02-audit-negative.txt`.
