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

**Input** — `input:action {action, phase:"down"|"up", value}` · `input:look {dx,dy}` ·
`input:move {x,y}` · `input:device {kind:"kbm"|"pad"}`

**Player** — `player:spawn {position}` · `player:state {grounded, speed, action}` ·
`player:jump {charged}` · `player:land {impact}` · `player:traverse {verb, phase}`

**Camera** — `camera:shake {amount, seconds}` · `camera:fov {target, seconds}` ·
`camera:focus {target, seconds}` · `camera:mode {id, opacity}`

`camera:mode` is two-way. Inbound (`{id:"follow"|"locked"}`) puts the rig in a control mode.
Outbound the rig emits `{id:"follow"|"tight", opacity, source:"camera"}` when the boom collapses
against geometry: `opacity` is how visible the avatar should be so the camera never has to stand
inside a wall to keep it in shot. Listeners that only care about the inbound direction should
ignore payloads carrying `source:"camera"`.

**World** — `world:ready` · `world:region {id, entered}` · `world:interact {id, kind}`

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

**UI** — `ui:prompt {key, params}` · `ui:toast {key, tone}` · `ui:menu {id, open}` ·
`ui:locale {locale}`

**Audio** — `audio:cue {id, params}` · `audio:mood {id, intensity}`

**Kernel** — `kernel:frame {dt, alpha, simTime}` · `kernel:resize {width, height}`

**Quality** (P30) — `quality:tier {tier, direction, why, source, postStack, shadows, shadowResolution,
maxPixelRatio, drawDistance, grassDensity, particleBudget}`

Emitted by `core/AutoTier.js` whenever the measured tier changes, and once at boot if the
first-frame hardware heuristic lowered it. `direction` is `"heuristic" | "down" | "up" | "tier"`.
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
