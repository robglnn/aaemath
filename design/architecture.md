# Architecture & ownership

Two jobs: keep the codebase coherent, and keep many agents from writing the same file.

## Layout

```
app/
  index.html
  styles/base.css              tokens + shell (shared; edit surgically)
  src/
    main.js                    the only assembly point (shared; edit surgically)
    core/                      Kernel, Signals, Config, Introspect  (shared; change only with reason)
    play/                      Locomotion, CollisionWorld, CameraRig, Traversal, Input, Avatar, Animator
    world/                     Terrain, Level01, Sky, Atmosphere, Lighting, Materials, Scatter
    render/                    PostStack, passes/, Vfx
    math/                      Tex, TexPanel
    learn/                     Graph, Mastery, Scheduler, ItemBank, Teaching, verbs/
    i18n/                      I18n + runtime locale loading
    ui/                        hud/, menus/, progress/
    audio/                     AudioDirector + synth voices
    build/                     construction system
    flow/                      Title, Onboarding, Session, Save, Level01Flow
content/                       knowledge-graph.json, standards.json, items/, locales/
design/                        the bibles; quality-bar.md is binding
tools/                         review.mjs, status.mjs, progress.mjs, lib/
review/shots/                  real captures (gitignored)
progress/status/<PIECE>.json   per-piece status (one writer each)
reference/brief-hero.png       art direction reference from the brief
```

`design/pieces.json` lists which piece owns which paths. **Only the owning piece writes those
paths.** Shared files (`main.js`, `base.css`, `core/*`) take surgical edits: add your lines, do not
restructure someone else's.

## The rule that keeps this buildable

> A feature module may import `three`, `core/*`, and its own files. It may not import another
> feature module.

Everything crossing a boundary goes through `core/Signals.js`. That is why a piece can be rewritten
from scratch by a fresh agent without a cascade.

## System hooks

Register with `kernel.mount(name, system)`. Recognised methods:

| hook | when | use for |
|------|------|---------|
| `fixed(step, simTime)` | exactly 60 Hz, may run 0..8× per frame | movement, physics, timers, gameplay logic |
| `frame(dt, alpha)` | once per rendered frame | visual smoothing, UI, anything non-authoritative |
| `after(dt, alpha)` | after all `frame` hooks | camera, culling — things that must read final transforms |
| `resize(w, h)` | viewport change | render targets, UI layout |
| `dispose()` | teardown | listeners, GPU resources |

`alpha` is the interpolation factor between the last two simulation states. Render interpolated
positions with it; never advance gameplay in `frame`.

## Signal vocabulary

Add new names here when you introduce them; never invent a second name for an existing event.

**A name in this list is a claim that both ends exist.** Nothing in this codebase fails when the
string on the other end was never written — that is the price of glob registration and no sibling
imports, and it is how eighteen signals came to be emitted into an empty handler set while every
piece's own tests passed. `node tools/seams.mjs --signals` is the gate: it reports every name with
only one end, with `file:line` for each emit and each listener.

Where only one end is genuinely built today the entry below carries **⟨pending Pnn⟩**, naming the
piece that owes the other half. That makes it a known hole with an owner. An unmarked one-ended
name is a defect, and the audit is entitled to say so — **and it now does, mechanically.**
`tools/seams.mjs --signals` parses this section, and **exits non-zero if any one-ended name is
missing from it or present without a ⟨…⟩ marker.** That check is here because the round that wrote
the paragraph above still shipped `world:resonance` — one-ended, undocumented, and holding a whole
built lighting feature dark — past its own rule. A rule a human has to remember to apply is a rule
that survives exactly as long as attention does; the next twelve parallel agents will not remember
it, and now they do not have to.

**Input** (P07, `play/Input.js`) — `input:action {action, phase:"down"|"up", value}` ·
`input:look {dx,dy}` · `input:move {x,y}` · `input:device {kind:"kbm"|"pad", style, id}`
⟨pending P21⟩ · `input:focus {focused, reason}` ⟨pending P21/P23⟩ ·
`input:context {context}` ⟨pending P22⟩ · `input:rebind {action, device, chord, ...}` ⟨pending P22⟩ ·
`input:capture {action, phase, chord}` ⟨pending P22⟩ · `input:calibrate {zero, padId}` ⟨pending P22⟩

`input:look` is in **radians**, already conditioned by the input layer: look sensitivity and axis
inversion are applied exactly once, there. A raw emitter opts out with `unit:"px"`.

The last six are the input layer's outbound notifications, and every one of them is live —
P36 drove the shipped app and watched `input:device {kind:"pad", style:"xbox"}` fire off a real
`gamepadconnected` and `input:focus` fire off a real `blur`/`focus` pair. Nothing listens, because
what listens to them is a HUD that swaps prompt glyphs (P21) and a settings screen that shows and
rebinds controls (P22), and neither piece has been built. `input:context` in particular is the
outbound half of the same pair as `ui:menu` below: nothing calls `Input.setContext` today, so it
cannot fire until P22 exists.

**Player** — `player:spawn {position}` · `player:state {grounded, speed, action}` ·
`player:jump {charged}` · `player:land {impact}` ·
`player:traverse {verb, phase:"start"|"cancel"|"end", height}` ⟨pending P06/P14/P25⟩

`player:traverse` brackets a committed traversal move. `play/Locomotion.js` already emits it around
every ledge step-up — a dozen times in a few seconds of ordinary play — and P06's traversal verbs
will emit it around mantle, climb, glide and dash. What listens is the VFX system (P14) and the
audio director (P25). Until one of those lands it is a bracket nobody reads.

**Camera** — `camera:shake {amount, seconds}` · `camera:fov {target, seconds}` ⟨pending P19/P23⟩ ·
`camera:focus {target, seconds}` ⟨pending P19/P23⟩ · `camera:mode {id, opacity}` ·
`camera:probe {origin, direction, radius, maxDistance → handled, hit, distance}` ·
`camera:target {object}`

`camera:probe` is the vocabulary's only **request** signal: the rig fills a reusable object, emits
it, and reads the answer back off the same object. A handler that answers must set `handled = true`;
one that cannot must leave the request untouched so the asker's own fallbacks still run. It is
answered by `boot/30-locomotion.js` from `CollisionWorld.sphereCast`. Any piece that owns better
collision information than the collision world may answer it instead.

`camera:fov` and `camera:focus` are inbound-only: the rig implements both and nothing sends either.
They are the handles a cutscene, a learning verb or a title sequence would pull (P19/P23), and they
stay because a rig that cannot be aimed is not a rig.

`camera:mode` is two-way. Inbound (`{id:"follow"|"locked"}`) puts the rig in a control mode.
Outbound the rig emits `{id:"follow"|"tight", opacity, source:"camera"}` when the boom collapses
against geometry: `opacity` is how visible the avatar should be so the camera never has to stand
inside a wall to keep it in shot. Listeners that only care about the inbound direction should
ignore payloads carrying `source:"camera"`.

**World** — `world:ready` · `world:region {id, entered}` · `world:interact {id, kind}` ·
`world:collider {id, mesh|geometry, matrix}` · `world:sun {toLight, direction, color, intensity, …}` ·
`world:resonance {id, position, radius, strength, active}`

`world:resonance` is how anything unresolved standing in the world — a live claim, an open socket, a
carry — asks the light rig for its spill. `world/Lighting.js` holds a fixed-size `PointLight` pool
allocated once at boot (`art-direction.md` §5.4: "Every emitter carries a real `PointLight` so it
spills onto the ground, and the spill is the proof it is a light rather than a painted decal"), and
re-assigns it by distance to the camera every frame, so the point-light count never changes and no
shader program is recompiled mid-play. `active:false` — or the payload `{id, active:false}` on its
own — retires one. `radius` is capped at 6 m and `strength` is a 0..1 fraction of the intensity cap
that keeps the spill from lifting a neighbouring rock facet above Y 0.10.

Emitted by `boot/60-mathtex.js`, which reconciles the claims actually standing in the field once per
frame, in `after()`, so the position it sends is the transform that was rendered rather than the one
a payload asked for. Read the result at `__vs.probe("lighting").accents`: `registered` is what this
signal put in the map, `lit` is how many pool lights carry non-zero intensity as a consequence.

Known and measured (`review/measure/P36-spill.mjs`): the accents are live, but **at spawn nothing is
inside their falloff.** Every standing claim is 10.7 – 21.2 m above the ground beneath it and the
closest a lit accent came to the body in 14 s of running was 6.61 m, against a 6 m cap. P15 stands
claims on bare sky so their ink is 0.0% occluded; §5.4 caps an accent at 6 m so it marks the world
rather than lighting it. Both rules are right and together they mean a claim's spill lands on
nothing at the distances this level uses. The signal is not the open question — the composition is.

**Learning** — `learn:present {itemId, kpId, form}` · `learn:respond {itemId, correct, latencyMs, response}` ·
`learn:mastery {kpId, p, delta}` · `learn:teach {kpId, phase:"model"|"guided"|"solo"}` ·
`learn:unlock {kpId}` · `learn:session {phase, summary}`

**Math** (P15) — `math:show {id, tex, at, em, billboard, display, kpId, working}` ·
`math:hide {id}`

`math:show` stands one expression in world space and is idempotent on `id` — sending it again
with new `tex` re-typesets that claim in place. `at` is a world position, `em` is the glyph
size in world units (not the overall height: a fraction is taller than a one-line claim at the
same `em`, which is what "the same size writing" means). `working: {slope, intercept, xTicks,
yTicks}` draws a plotted axis instead of an expression. `math:hide` with no `id` clears the
field. The first `math:show` or `learn:present` retires the claims standing at spawn, so a
learning system takes the surface over rather than fighting it.

**UI** — `ui:locale {locale}` · `ui:menu {id, open}` ⟨pending P22 emitter⟩ ·
`ui:prompt {key, params}` ⟨pending P21⟩ · `ui:toast {key, tone}` ⟨pending P21⟩

`ui:menu` is one of three names still listened for and never sent — the others are `camera:fov` and
`camera:focus` above. `play/Input.js` counts menu depth from it and swaps the action context, so
opening a menu mid-sprint cannot leave a key stuck down behind it. The receiving half is built and
proven; the menus that would open (P22) are not. `ui:prompt` and `ui:toast` have neither end and
exist here as P21's reserved names.

**Audio** — `audio:cue {id, params}` ⟨pending P25⟩ · `audio:mood {id, intensity}` ⟨pending P25⟩

`play/Locomotion.js` emits `audio:cue` for step, skid, step-up, jump, land and wall impact — forty
or more per minute of ordinary play, all of it into nothing, because `app/src/audio` (P25) does not
exist yet. The controller is not at fault: it is doing exactly what a controller should, which is
report what happened and let the mixer decide what it sounds like.

**Kernel** — `kernel:frame {dt, alpha, simTime}` ⟨no subscriber⟩ ·
`kernel:resize {width, height}` ⟨no subscriber⟩

Both are broadcasts for code that is **not** a mounted system, and nothing in `app/src` subscribes
to either — a mounted system gets the same information from its `frame(dt, alpha)` and
`resize(w, h)` hooks, which is always the right channel for a system. `kernel:frame` is emitted once
per rendered frame (1115 times in the P36 evidence run) and `kernel:resize` on every viewport
change. Keep them only as long as something outside the hook table wants them; a future audit
finding them still unsubscribed should delete them from `core/Kernel.js` rather than re-explain them.

**Quality** (P30) — `quality:tier {tier, direction, why, source, postStack, shadows, shadowResolution,
maxPixelRatio, drawDistance, grassDensity, particleBudget}`

Emitted by `core/AutoTier.js` whenever the measured tier changes, once at boot if the first-frame
hardware heuristic lowered it, and once more if the player makes an explicit choice mid-session and
auto-tiering hands the picture back. `direction` is `"heuristic" | "down" | "up" | "player"`.
The payload carries the whole tier row so a listener never has to import `Config`. Any system whose
cost scales with the tier should subscribe rather than sample `config.tier` once at setup.

## Reviewer contract

Every system publishes a probe: `publish("locomotion", () => ({ ...readable state }))`. Probes must
be cheap, JSON-safe and honest. `__vs.report()` aggregates them. If a claim about the game cannot be
checked through a probe or a pixel, it is not a claim — it is a hope.

## Performance budget (Level 1, `--tier=high`, 1080p)

| metric | budget |
|--------|--------|
| draw calls | ≤ 320 |
| triangles | ≤ 1.6 M |
| shader programs | ≤ 90 |
| textures | ≤ 120 |
| main-thread frame cost | ≤ 8 ms of JS at 60 Hz on mid hardware |

`node tools/review.mjs perf` reports headless numbers. They are a *relative* regression signal —
software GL is not real hardware — but the draw/triangle/program counts are exact.
