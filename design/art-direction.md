# Art direction — Variable Star

Binding for every builder who writes a shader, a material, a light, a post pass, a UI surface or a
camera framing. `design/palette.json` is the machine-readable half of this document; every colour and
every threshold named here lives there, and nowhere else.

## Two classes of number, and why the difference matters

This document contains two kinds of quantity and they do **not** carry the same weight of evidence.

- **Sampled** — read straight off `reference/brief-hero.png`: a hex, a census share, a percentile, a
  ramp stop. Anyone with a PNG decoder reproduces these exactly.
- **Solved** — recovered from a *fit*: the scrim's alpha, the hologram veil's compression, the
  key : fill ratio, the ink width percentiles, the emitter peak. These are the numbers a builder
  actually types into a plate or a shader, they are the ones that are hardest to measure, and they
  are the ones that were wrong in round 1.

Round 1's auditor checked twenty-seven frame-wide census statistics — that is, it re-checked only the
sampled half — and reported 27/27 while two of the three solved constants a critic re-derived by hand
were wrong. `review/art-audit.mjs` now has a **second section that re-derives every solved constant
directly**, and prints which of them could not be measured on a given frame rather than quietly
skipping them. Wherever a solved number is soft, this document says so and gives the spread.

**You can check your work.**

```bash
node review/art-audit.mjs <shot.png> --hero=x0,y0,x1,y1 [--holo=x0,y0,x1,y1] [--require-solved]
```

| frame | census | solved constants |
|---|---|---|
| `reference/brief-hero.png` | **27/27** | **10/10** |
| `review/p02-crops/negative-control.png` (synthetic, commits every anti-pattern in §12) | **12/27** | **2/10** |

Pieces that own a UI plate or the hologram **must** run with `--require-solved`, which turns
"could not measure" into a failure instead of a silent skip.

A rule the auditor cannot check is a rule this document states as prose and a critic checks by eye.
Both kinds are binding; only one of them is cheap.

---

## 1. What the reference actually is

A low sun off to camera-right, at the horizon. A boy in champagne-gold plate stands on an orange rock
promontory with his back to us, looking out over a canyon of flat-topped mesas. A green river of light
winds through it. A ruined megacity stands as a dark silhouette against the brightest part of the sky.
An aurora runs across the top. Floating in front of him, projected from a socket cut into the rock at
his feet, is a pane of glass with `(3x+5)/2 = y` on it in white, and a line graph in cyan.

Three structural facts do most of the work, and all three are sampled:

1. **The world is warm and the light that matters is cool.** Warm hues (0–60°, 320–360°) at
   S ≥ 0.30 are 30.9% of the frame; resonance cyan (150–215°) is 13.7%. A 2.25 : 1 split. The rock is
   the mass; the cyan is the meaning.
2. **Value falls and saturation rises as you come forward.** Row means: the sky third sits at
   S 0.1734, the middle third at 0.3165, the bottom third at 0.4499. Luminance runs the other way,
   peaking at Y 0.611 on the horizon band and falling to 0.19 at the bottom of frame.
3. **Shadow is a colour decision, not a multiplication.** Over half of the frame's mid-shadow pixels
   are *cool* (hue 185–320°): **50.6% cool against 23.4% warm** at the auditor's stride, 50.4% / 23.6%
   at full resolution. Nothing about that falls out of a renderer by default.

---

## 2. The light rig

One key, one hemisphere fill, one resonance kick, one warm bounce. Four lights. Anything past that is
you failing to commit.

| light | colour | CCT | intensity (key = 1.00) | azimuth (from camera forward) | elevation |
|---|---|---|---|---|---|
| **key** — the low sun | `sky.sun` `#FFE8A0` | ~3000 K, green-biased | 1.00 | **+62°** (camera right) | **+8°** |
| **fill** — sky hemisphere | `sky.zenith` `#8DACBC` | ~11000 K | 0.14 | up | — |
| **bounce** — lit rock | `#8A5B3E` | ~2200 K | 0.06 | down | −35° |
| **kick** — resonance | `resonance.core` `#2FE3D6` | not a blackbody | 0.08 | −120° (behind-left) | −15° |

**Key direction, and how it was established.** Not from the art, from three independent measurements:
the hot gold rim sits on the hero's camera-right edge (a cut across him at y = 0.60 reaches Y 0.953 at
x = 0.400 and Y 0.062 at x = 0.379); shadows on the plinth run to lower-left; the brightest sky is at
x ≈ 0.93, y ≈ 0.335, i.e. at the horizon on the right, probably just off-frame. Low, three-quarter,
behind-right.

**The key is off the Planckian locus, deliberately.** `#FFE8A0` is R:G:B = 1.00 : 0.91 : 0.63. A true
3000 K blackbody in sRGB is nearer 1.00 : 0.78 : 0.55. The green is lifted. That lift is what holds lit
rock at hue 25–35° instead of letting it slide to red. Use the colour, not the temperature.

**Key : fill on rock is 6.2 : 1 — solved, on boxes that are recorded.** Auditor check `K1`.
Round 1 stated 7.0 ± 1.5 from a facet pair it did not write down. Measured on boxes that ship in
`palette.json → solvedConstants.keyToFill` and can be re-placed with `--lit` / `--shadow`:

| facet pair | lit | shadow | ratio |
|---|---|---|---|
| terrace top `[0.870,0.481,0.910,0.489]` vs sky-shadowed face `[0.872,0.598,0.902,0.612]` | Y 0.6592 `#FEC67D` | Y 0.1066 `#555661` | **6.18** ← the authored pair |
| terrace top vs **bounce**-shadowed face `[0.872,0.530,0.900,0.541]` | Y 0.6592 | Y 0.1367 `#855D6D` | 4.82 |
| second lit band `[0.870,0.554,0.902,0.562]` vs sky-shadowed face | Y 0.4664 `#FEA462` | Y 0.1066 | 4.38 |

That spread — 4.4 to 6.2 depending on which shadow family you land in (§3) — is the honest precision of
this measurement. Target **6.2 ± 1.6**. Calibrate exposure so that `rock.albedo` `#B4744C` facing the
key renders at Y 0.42 ± 0.05 and facing away under open sky at Y 0.07 ± 0.02.

**Skin is lit far flatter — 2.4 : 1.** Measured: lit `#FE964E` Y 0.434, shadow `#A4674B` Y 0.181. This
is why the face still reads when the body is in shadow. Do not light skin with the rock's ratio.

**Shadow length is authored, not derived.** The reference's shadows run about 3.5× object height,
which implies a sun elevation near 16°, not the 8° the sky says. The painting cheats and so should we.
Author cast-shadow length at **3.0–4.0× object height** for legibility and ignore what the visible sun
glow implies. Long shadows are also where shadow-map artefacts show first — see §12.20.

---

## 3. Shadow — three families

The single most important section in this document. There are three shadow families and they are
chosen by *situation*, not by material.

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
rotating it: **0.0% cool, 99.5% warm.** This is auditor check `X1` and it is the fastest way to know
whether the render has an art direction at all.

---

## 4. The two shading ramps

Smooth forms and cut planes do not share a shading model. That contrast is most of why the hero reads
as a character standing on a landscape rather than as another rock.

### Curved metal and skin — soft, hue travels FORWARD through olive

Measured across the hero at y = 0.60, x 0.372 → 0.415:

| stop | hex | hue | S | Y |
|---|---|---|---|---|
| shadow | `#34494C` | 185° | 0.32 | 0.062 |
| terminator | `#68704F` | 68° | 0.26 | 0.132 |
| mid | `#AB804F` | 32° | 0.54 | 0.247 |
| light | `#FDB755` | 35° | **0.67** | 0.556 |
| specular | `#FFFCA0` | 59° | **0.37** | 0.953 |

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

Implementing either ramp as an RGB lerp between a lit colour and a shadow colour produces the muddy
grey midtone that reads instantly as "shader default". Ramp through the hue path.

---

## 5. Material language

| substance | metalness | roughness | Fresnel rim | ink | notes |
|---|---|---|---|---|---|
| **rock / terrain** | 0.0 | 0.82–0.92 | **never** | foreground only | `rock.warm.*`; bright edges come from facet orientation, never from a rim term |
| **bone stone (ruins)** | 0.0 | 0.70–0.85 | never | foreground only | `rock.bone` `#AA9087` — a desaturated warm grey, *not* the orange of terrain. Cyan inlays are separate emissive strips, not a tint |
| **ground cover** | 0.0 | 0.70–0.90 | never | foreground only | `world.foliage` `#A2D7A6`, always below S 0.30 — see §9 |
| **crystal** | 0.0 | 0.10–0.20 | yes, `resonance.bloom` | never | emissive; a blown white core is mandatory |
| **plate metal** (hero, fittings) | 0.90–1.0 | 0.22–0.38 | yes, strong, key-side | yes on hero | two-lobe specular: a broad soft gradient plus a narrow hot streak on edges. **Requires an environment map — see §12.18** |
| **matte metal** (inner panels) | 0.60–0.80 | 0.45–0.60 | weak | yes on hero | |
| **skin** | 0.0 | 0.45–0.55 | yes, warm, key-side | yes | shadow keeps its hue; 2.4 : 1 key:fill |
| **hair** | 0.0 | 0.35–0.50 | yes, hot gold | yes | the near-black core is what carries the thumbnail silhouette |
| **holographic light** | unlit | — | — | **never** | the veil is a compression, not an additive blend — see §8 |

**Rock never gets a Fresnel rim.** This is the rule people break. Rock in the reference has hot edges,
but they are facets that happen to face the key — a horizontal cut across the plinth's right edge goes
`#CB7C4D` (Y 0.277) → ink `#6C3415` (Y 0.057) → `#FBC255` (Y 0.598) in six pixels. That is geometry. A
Fresnel term on rock makes it read as wet plastic and it is visible immediately.

**Every emitter has a blown core.** `resonance.hot` `#E9FFFB`, ≤ 0.4% of the frame. An emissive with no
white-hot centre reads as a painted decal, not as a light. **Solved on the socket:** the brightest pixel
inside the emissive mask (hue 150–215, or S ≤ 0.12 with Y > 0.60, searched over x 0.54–0.74,
y 0.62–0.82) is **`#E7FEFD`, Y 0.9496, at (0.6344, 0.7038)**. Blown resonance across the whole frame
(Y ≥ 0.90, hue 150–215) is **0.18%**, inside the 0.4% budget. Auditor checks `B1a` (peak ≥ 0.90) and
`B1b` (blown share 0.0002–0.006). *Round 1 cited "peak Y 0.74 at r = 2% of frame height" as the
evidence for this rule — a number that contradicts the rule it was supporting, and that came from a
radial profile, not from a peak. It is withdrawn.*

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

  Median 3 px at 2752 = 0.11% of frame width ≈ **1.7 px at 1600×900**.
- **it tapers**, at every threshold: p90 is 2–2.5× the median. A uniform-width outline is wrong, and
  that is what auditor `I1b` checks, because the taper survives the choice of threshold and the
  absolute widths do not.
- **distance-gated**: pixels at Y ≤ 0.006 are 2.30% of a foreground band against 1.01% of a distant
  band. Ink is present on the hero, on foreground interactables and on foreground terrain
  silhouettes. Fade it out over the foreground/midground boundary; do not cut it off.

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

**There is no fifth feature, and specifically there is no leg gap.** Round 1 required "a gap between
the legs at rest". Measured at full resolution — the widest run inside the hero span whose hue is
within 12° and whose luminance is within 25% of the rock just outside the silhouette — the inter-leg
background gap is 0.019–0.022 of frame width over y 0.80–0.84 and **exactly zero at y 0.86 and below**,
because the forward boot crosses it. 0.020 of frame width is 2.3 px at a 64 px-tall frame and 4.6 px at
128 px, and it exists over only 0.04 of frame height. It is not a silhouette feature; it is a hole that
opens and shuts with the stance. Do not author poses around it. What the lower body must do instead is
**taper**: below the waist the silhouette narrows monotonically and never exceeds the shoulder span.

**The 64 px whole-frame element count, with "element" defined.** Render the frame at 64 px tall,
desaturate, and count **connected regions of the WORLD layer** whose area is ≥ 0.5% of the thumbnail
and whose mean luminance differs from their surround by ≥ 0.10. The reference resolves **five**: the
hero (dark mass with one cyan spot), the hologram (pale rectangle with a cyan edge), the river (a green
S-curve), the city (dark spires), the aurora (green bands). Target **4–7**. Fewer and the frame is
empty; more and it is noise. **HUD and overlay layers are counted separately and are excluded from
that five** — at 64 px the reference's portrait block, minimap and subtitle band each resolve as
clearly as any of the five, so a count that does not exclude them is a count of eight and means
nothing. Evidence: `review/p02-crops/thumb64.png`.

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

**Scale in frame.** He is big — 67% of frame height. A third-person camera that renders him smaller
than ~50% of frame height loses the silhouette and the accents together.

**Value separation.** Over the box `0.276,0.276,0.425,0.960`, hero mean Y 0.207 against a 4%-padded
surround at 0.313 — a delta of **0.107**. Floor: **0.10** (auditor `H1`). The hero is a *dark* mass
against a *light* background; the accents and the gold rim are what keep him from being a hole.

**Accent placement is by ZONE and by AREA, never by count.** `hero.accent` appears in: two
**shoulder-blade** slots (the reference is a *back* view — round 1 called these chest slots and
inferred a front pair that cannot be seen), five spine chevrons, one band per forearm, one strip per
shin, one strip per boot cuff. A connected-component census of the hero box at hue 150–215, S ≥ 0.45,
V ≥ 0.62 finds **61 components, 21 of them ≥ 90 px** — the count is entirely an artefact of where you
put the minimum-area threshold, which is exactly why round 1's "eleven elements" was wrong and why no
count is authored here. The binding number is the budget: **accent pixels ≤ 4% of the hero's
silhouette area** (reference: 4.09% at that threshold).

---

## 7. Composition

- **Horizon at y = 0.31**, the upper third. Never 0.5.
- **The horizon crosses the hero at the shoulders**, so his head is silhouetted against sky. This is
  why the character reads. Head top at y = 0.280, face at y = 0.393, horizon at 0.31.
- **Hero centre at x = 0.352**, just right of the left third line. Feet at y = 0.955 — he stands on the
  bottom edge of frame, with the foreground rock running off it.
- **Hologram quad, fitted corners:** TL (0.498, 0.264), TR (0.777, 0.242), BL (0.493, 0.489),
  BR (0.759, 0.542). Roughly 0.28 × 0.27 of frame, ≈ 7% of area. Its left edge is **0.068 of frame
  width clear of the hero's right edge**. The panel never touches the hero and never crosses the
  horizon's most interesting stretch.
- **Negative-space budget: ≥ 28% of the frame must be quiet** — below S 0.30 and carrying nothing a
  player must read. Measured: everything above the horizon is 31% of the frame, the top third is 89%
  below S 0.30, and the only things in it a player reads are the city silhouette and the aurora.
- **Framing mass is geometry, not a vignette.** Measured 17.8% of the outer-12% border sits below
  Y 0.06 — dark foreground rock running off-frame at the corners. Floor: 6% (auditor `F1`). And the
  reference has essentially **no post vignette**: sky luminance across x is flat at 0.413–0.429 over
  x 0.20–0.425, and the left edge is *brighter* than the centre, not darker. Cap any vignette at 6%
  corner falloff and never use it to fake composition.
- **Landmarks recede in three planes minimum.** Distant landmarks read as *dark silhouettes against the
  brightest part of the sky* — that is the city's entire trick. Detail is not what makes a landmark
  read; value contrast against sky is.

**Aerial perspective.** Lerp toward `sky.horizon` in **linear** space, reaching **0.75 at the far
plane**. Measured: the top third of the frame averages S 0.1734 against the bottom third's 0.4499 — the
distance carries **39% of the foreground's saturation**. Bone stone and foliage albedos in
`palette.json` were sampled at mid distance and therefore already carry part of this wash; foreground
instances of both should be authored more saturated (see each role's `note`).

**Depth of field.** Focus plane on the hero. Acutance (mean |4·L − ΣL_neighbours|) measured on
comparable rock content at three depths:

| box | acutance | ratio |
|---|---|---|
| hero core | 0.0961 | 4.3 × midground |
| foreground rock | 0.0462 | 3.6 × distance |
| midground valley | 0.0224 | — |
| distance ruins | 0.0130 | — |
| flat sky (noise floor) | 0.0123 | — |

Note the trap: a first draft of the auditor measured acutance in full-width screen bands and all three
came out at 0.033, because the hero, the hologram and the HUD text contaminated every band. Acutance is
only meaningful between boxes on comparable content. The boxes live in
`palette.json → depthCues.acutanceBoxes` and are arguments, not constants.

---

## 8. The hologram and KaTeX

The mathematics has to be the most beautiful object in the frame. It gets its own rules.

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
  whatever alpha you pick.
- **Author `holo.veil.alpha = 0.50 ± 0.08.**
- Auditor `V1a`/`V1b` accept slope 0.30–0.72 and fixed point 0.40–0.50 — bounds every estimator above
  lands inside, and which an additive quad (slope ≈ 1) or a flat plate (slope ≈ 0) misses by a mile.
  `V1c` refuses to score the check at all unless there were ≥ 10 pairs, over ≥ 2 edges, spanning
  ≥ 0.20 of background luminance: a fit over one flat backdrop is not identifiable and must not be
  reported as a pass.

Measured deltas by side, which is the part a critic can see with their eyes: over the **bright sky**
above the panel the interior is **darker by 0.137**; over the hazy mesas to the left, darker by 0.030;
over the **dark city** to the right the interior is **lighter by 0.062**. That is the whole point: the
panel never blows out and never goes muddy, on any background, at any time of day, in front of any
geometry. An additive quad dies against a bright sky; a flat dark quad reads as a menu.

### White is the statement, cyan is the answer

- **Glyphs: `holo.glyph` `#FFFFFF`.** 1 925 pixels of exactly `#FFFFFF` inside the panel, peak Y 1.000
  — the mathematics is the brightest thing in the frame. **Never tint the mathematics cyan.** A cyan
  equation on a cyan panel is the single most common way this genre fails to be legible.
- **Plotted data: `holo.data` `#41FEEA`** (hue 174, S 0.744, Y 0.780). Independently re-found as the
  modal saturated cyan inside the panel: `#41FEE7` / `#43FEE7`. The curve whose *value* the player is
  reading.
- **Axes and ticks: white.** They belong to the statement, not the answer.
- Contrast is guaranteed by construction: white on a background compressed to Y ≈ 0.44 is ≥ 2.2 : 1
  everywhere, on every backdrop.

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

---

## 9. Colour discipline

The world uses **two hue arcs and one bridge**, and two reserved arcs for state. The partition below is
generated from `palette.json → colourBudget.hueArcs`, which is the same object `review/art-audit.mjs`
classifies with, so the prose and the auditor cannot drift apart. Re-generate with
`node review/p02-sync-doc.mjs`; `--check` fails if it is stale.

<!-- GENERATED: hue-partition — do not edit by hand; run node review/p02-sync-doc.mjs -->

| order | class | hue | gate | reference share of frame | what it is |
|---|---|---|---|---|---|
| 1 | `danger` | 330–355° | S ≥ 0.55, Y > 0.1 | 0.00% | reserved, transient only |
| 2 | `success` | 95–125° | S ≥ 0.45, Y > 0.45 | 0.00% | reserved, transient only |
| 3 | `muted` | 0–360° | S < 0.3 | 53.55% | the quiet majority of the frame |
| 4 | `warm` | 0–60° ∪ 320–360° | S ≥ 0.3 | 30.92% | warm rock — the mass of the world |
| 5 | `resonance` | 150–215° | S ≥ 0.3 | 13.73% | resonance cyan — mathematics is live here |
| 6 | `bridge` | 90–150° | S ≥ 0.3 | 1.47% | green bridge — river, foliage, ground cover |
| 7 | `offLanguage` | 60–90° ∪ 215–320° | S ≥ 0.3 | 0.33% | off-language — must stay empty |

**The order matters.** Classification is in priority order (danger, success, muted, then the hue arcs), because `success` at 107° sits inside the bridge arc and must not be scored against the bridge budget. Each class carries its own saturation gate.

250–349° is 0.00% of the reference's saturated pixels; 70–119° is 0.78%. Those two emptinesses are what `danger` and `success` were placed in.

<!-- /GENERATED: hue-partition -->

Frame budgets (auditor checks `C1`–`C11`; reference value in brackets):

| budget | target | reference |
|---|---|---|
| muted (S < 0.30) | 0.46–0.62 | 0.535 |
| warm, S ≥ 0.30 | 0.26–0.36 | 0.309 |
| resonance, S ≥ 0.30 | 0.10–0.18 | 0.137 |
| **hot resonance, S ≥ 0.55** | **0.02–0.05** | **0.031** |
| all hot, S ≥ 0.55 | 0.08–0.16 | 0.117 |
| warm : resonance ratio | 1.8–2.6 | 2.25 |
| sky third muted | 0.85–1.00 | 0.891 |
| bottom third resonance | 0.18–0.36 | 0.281 |
| off-language hue (60–90°, 215–320°) | ≤ 0.02 | 0.003 |
| danger / success | ≤ 0.005 each | 0 / 0 |

**Saturated resonance cyan is 3% of the frame.** Not 15%. The cyan works *because* it is rare and
because 31% of the frame is warm rock holding it up.

**The sky carries hue, not saturation.** 89% of the top third is below S 0.30. The aurora is
`aurora.mint` at S 0.175 — a *tint*, not a colour. Push it past S 0.30 and it becomes a screensaver.

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

---

## 10. Exposure, grade and the sky

- **Linear workflow.** `THREE.ColorManagement.enabled = true`, `outputColorSpace = SRGBColorSpace`.
  Feed shaders the `linear` triplets from `palette.json`, never the hex. See §12.19 for the way this
  goes wrong silently.
- **Median frame luminance 0.35** (target 0.30–0.40). Mean 0.354 ± 0.05, mean saturation 0.313 ± 0.05.
- **Filmic curve with a soft shoulder.** Requirements, not a named curve:
  (a) the shoulder must **desaturate** as it compresses — measured, the armour's light band is S 0.67
  and its specular is S 0.37; (b) nothing clips to pure white except emitter cores, the sun and KaTeX
  glyphs (≤ 2% of pixels at Y ≥ 0.99; reference 0.12%); (c) the toe must not crush — 25% of the frame
  sits below Y 0.147 and still carries readable form (≤ 4% at Y ≤ 0.01; reference 1.5%).
- **Forbidden:** whole-frame Reinhard, which flattens the mid plateau; and raw linear→sRGB with a hard
  clamp, which skews highlight hue instead of desaturating it.
- **Dither the sky.** The reference's sky moves ~0.006 Y per 1% of frame height. Over a 1080p frame
  that is under one 8-bit code value every three pixels — banding is guaranteed without dither.
  Measured: 21–45 distinct codes per channel down a sky column, longest flat run **4 px**. The
  negative control, undithered: 4 codes, longest run **38 px**. Auditor `S1`/`S2`.

Target luminance histogram: a broad, gently double-humped plateau. A dark lobe at Y 0.00–0.06 (14.2% —
ink, deep shadow, the framing foreground mass), a dip at Y 0.22–0.30, a wide mid plateau Y 0.31–0.66
(the lit world and the sky), then a fast decay above Y 0.70 with a thin tail to 1.0 carrying only
emitters, the sun and the glyphs. **Neither end spikes.** Percentile targets are in
`palette.json → luminanceHistogram.percentileTargets`.

---

## 11. UI surfaces

The UI is cool and dark so it never competes with the warm world.

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
≥ 0.05 at both ends. Reference: 0.08 and 0.13. A hard-edged rectangle scores 0.03 and fails.

**The scrim's warmth is transmitted rock, not paint.** From the same witness column at x = 0.30: inside
the band the rock reads `#784D3B` (hue 18, S 0.508) against `#986448` (hue 21, S 0.526) outside — hue
moves 3°, saturation moves 0.018. Only the value changes. Author a brown plate and it will fight every
other background it ever sits on.

### The rest of the UI

- **Stroke:** `ui.stroke` `#A8E0EC`, 2 px at 1600×900, scaling with viewport height, with a soft outer
  glow. Every plate gets one.
- **Ink:** `ui.ink` `#E8F1F0` primary, `ui.ink.dim` `#B5BEBD` secondary, and **one**
  `ui.ink.accent` `#9DEAF0` string per surface — the thing the player must read first. Never two.
- Minimum text contrast **4.5 : 1** against the composited surface, at every viewport size in the gate
  list.
- Meters are **segmented**, not smooth: the reference's health bar is 8 cells (7 filled) separated by
  visible gaps, each cell a two-band vertical gradient rather than a smooth one. The XP bar below it is
  thinner, unsegmented, and `reward.gold`. The portrait ring carries a pale-cyan stroke with a soft
  outer glow.

---

## 12. Anti-patterns

Each of these is a specific way to look like a cheap WebGL demo. The negative control commits them and
scores 12/27 census and 2/10 solved.

1. **Flat matte surfaces.** Lambert only, one directional light, no specular anywhere.
2. **Uniform ambient.** A constant ambient term instead of a hemisphere fill. Kills §3 outright.
3. **Shadow = albedo × 0.35.** Darkening instead of hue-rotating. Auditor `X1` goes to 0.00.
4. **No contact shadow, no AO.** Objects float. Every object needs a dark contact where it meets ground.
5. **Banded sky.** An 8-bit gradient with no dither. Auditor `S2`.
6. **Uncomposed frames.** Horizon at 0.5, hero dead centre, no dark framing mass, nothing off-frame.
7. **Global-threshold bloom.** Bloom on everything bright instead of an emissive mask. The sky blooms
   and the frame turns to soup.
8. **Emissives with no blown core.** Reads as a painted decal, not a light. Auditor `B1a`/`B1b`.
9. **Saturated cyan everywhere.** The identity colour spent until it means nothing.
10. **Grey fog.** Distance lerped toward grey instead of toward `sky.horizon` at the right hue.
11. **Uniform, aliased, crawling ink.** Constant width, pure black, no distance gate. Auditor `I1b`.
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
    which is how a whole review round gets spent looking in the wrong place. Set
    `scene.environment` (a PMREM of the sky) before you judge any metal.
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

---

## 13. How to tell if we lost

Run this first, always:

```bash
node review/art-audit.mjs review/shots/<piece>/<name>.png --hero=x0,y0,x1,y1 --require-solved
```

Any failing line is a concrete, located defect. The symptoms, in the order they cost us the most:

| # | symptom | check | reference | what it means |
|---|---|---|---|---|
| 1 | **shadow cool share < 0.38** | `X1` | 0.506 | shadows are being multiplied, not authored. The single biggest tell. |
| 2 | **hot resonance share > 0.05 or < 0.02** | `C5` | 0.031 | the cyan is either spent or absent; it has stopped meaning "mathematics is live" |
| 3 | **warm : resonance outside 1.8–2.6** | `C6` | 2.25 | the warm/cool division that carries the whole image has collapsed |
| 4 | **veil slope outside 0.30–0.72, or fixed point outside 0.40–0.50** | `V1a`/`V1b` | 0.60 / 0.42 | the hologram is additive or flat; it will be illegible on some backdrop. (These are the auditor's own probe values on the reference; §8 lists the five estimators and their spread.) |
| 5 | **scrim plateau transmission outside 0.06–0.20, or ramp width < 0.05** | `U1a`/`U1b` | 0.11 / 0.08 | a black bar across the world; the world stops reading through the prompt |
| 6 | **acutance hero/midground < 2.5** | `D4` | 4.3 | no focus plane; the frame is a flat diorama |
| 7 | **hero/surround separation < 0.10** | `H1` | 0.107 | the silhouette has dissolved into the background — check §12.18 before anything else |
| 8 | **emitter peak < 0.90, or blown share outside 0.0002–0.006** | `B1a`/`B1b` | 0.95 / 0.0008 | emissives are painted decals |
| 9 | **key : fill outside 6.2 ± 1.6 on the marked boxes** | `K1` | 6.18 | the light rig is not the light rig |
| 10 | **sky third muted share < 0.85** | `C7` | 0.891 | the sky is over-saturated and has started competing with the world |
| 11 | **longest flat sky run > 8 px** | `S2` | 4 | banding; the ramp is not dithered |
| 12 | **median Y outside 0.30–0.40** | `L1` | 0.351 | exposure is wrong before any art question is worth asking |
| 13 | **> 2% of pixels at Y ≥ 0.99** | `L6` | 0.0012 | highlights clipping; the shoulder is missing |
| 14 | **ink p90 ≤ p50** | `I1b` | +4 px | the outline is uniform width; it will crawl |
| 15 | **saturation does not rise with depth** | `D3` | +0.277 | no aerial perspective |
| 16 | **border dark share < 0.06** | `F1` | 0.178 | the frame is unframed — no geometry anchoring the corners |
| 17 | **off-language hue > 2%** | `C11` | 0.003 | colours have leaked outside the two arcs |
| 18 | **any `n/a` in the solved section** | — | — | the check could not run. On a UI or hologram piece that is a failure, not a pass — run with `--require-solved`. |

And the four things the auditor cannot see, which a critic must check by eye against
`reference/brief-hero.png`:

19. **At 64 px the WORLD layer resolves fewer than 4 or more than 7 elements** (§6 defines "element"
    and excludes the HUD). Empty, or noise.
20. **The hero's four silhouette features are not all countable at 128 px** (§6). Not 64 — the
    reference itself fails at 64.
21. **Rock has a soft terminator, or a Fresnel rim.** It will read as plastic or clay, not stone.
22. **The hologram is legible on one background but not another.** Test it against the bright horizon
    *and* against the dark city in the same capture. `V1` catches the coefficient; only an eye catches
    a panel that is technically compressing and still unreadable.

---

## 14. Provenance

Every number here came from `reference/brief-hero.png` (2752 × 1536, aspect 1.792) via scripts left in
`review/`:

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
| **`review/p02-resolve.mjs`** | **round 2: every SOLVED constant — scrim alpha profile, veil compression with its sensitivity sweep, emitter peak, bloom annuli, key:fill, ink percentiles, accent component census, leg-gap segmentation, the two new albedo roles** → `review/p02-solved.json` |
| `review/p02-make-palette.mjs` | generates `design/palette.json` with exact linear triplets |
| `review/p02-sync-doc.mjs` | generates §9's hue-partition table from `palette.json` so prose and auditor cannot drift |
| `review/art-audit.mjs` | the auditor — 27 census checks and 10 solved-constant checks |
| `review/p02-negative-control.mjs` | the synthetic bad frame that proves the auditor rejects as well as accepts |

Raw measurements are in `review/p02-reference-measurements*.json` and `review/p02-solved.json`;
inspection images in `review/p02-crops/`.

**What round 2 changed, and why it is listed here.** Round 1's sampled numbers all reproduce; its
solved numbers did not. Corrected: `ui.scrim` (a single alpha replaced by a measured graded profile);
`holo.veil` (three-point fit replaced by 116 pairs plus a sensitivity sweep, alpha 0.41 → 0.50, fixed
point promoted to the primary constant); the socket emitter peak (0.74 → 0.9496); the bloom falloff
table (withdrawn as non-reproducible); key : fill (7.0 → 6.2, on recorded boxes); ink percentiles (now
quoted with their threshold); `depthCues.saturationByThird` (0.15/0.32/0.47 → 0.1734/0.3165/0.4499);
the `accessibility` block (success 146° → 107°, 3.07 : 1 → 2.67 : 1); `hero.accent` (chest → shoulder
blade, count removed in favour of an area budget); the §6 thumbnail gate (64 px → 128 px, leg gap
dropped); the hue partition (prose now generated from the JSON). Added: `rock.bone`, `world.foliage`,
`solvedConstants`, and auditor checks `U1`, `V1`, `B1`, `K1`, `I1`.

**Honest limits.** The reference is a painted illustration, and three things in it are not physical:
its shadow lengths imply a sun 8° higher than its sky does; its rock shadows are hue-rotated further
than any ambient could push them; and its depth of field is stronger than a game camera would produce
at that framing. All three are reproduced here as *authored* rules with numbers, because they are what
makes the image look the way it does. Where this document says "authored", do not go looking for a
physical justification — there isn't one, and chasing it will make the render worse.
