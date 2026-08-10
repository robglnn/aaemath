/**
 * Mathematics — the strict KaTeX pipeline, and the claims standing in the world.
 *
 * Order 60: after the world, the camera and post, before anything that teaches. Everything
 * mathematical in the product goes through `math/Tex.js`; this module is the only place that
 * pulls in the stylesheet and the only place that mounts the world-space field.
 *
 * The claims standing at spawn are not a demo and not a debug label. `world.md` §2.1: a claim
 * is a live statement at a socket, and the Margin is *made* of them — a leaf with no claims
 * standing on it is a leaf that has already fallen. Two open readings and the working beside
 * them is the frame the art target draws. As soon as a learning system starts driving the
 * field (`learn:present`, or an explicit `math:show`), these stand down and the engine owns
 * the surface.
 */
import "katex/dist/katex.min.css";
import { publish, introspect } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import { setLocale, getLocale, texStats, texFailures } from "../math/Tex.js";
import { TexField, ensureMathFonts, setMaxAnisotropy } from "../math/TexPanel.js";

/**
 * Leaf Nine at the head of the level: two live claims and the working that closed the first
 * one. Open readings, per §2.1 — an unknown on the near pan, the site's own measurement on
 * the far pan. `kpId` ties each to `content/knowledge-graph.json` so a teaching director can
 * take these over rather than replace them.
 *
 * ## Where they stand, and why it is not a taste call
 *
 * These anchors used to put both claims at `right -2.7`, which at `forward 14` is straight
 * through the avatar's shoulder and the rock spire behind it. The result was measured, not
 * suspected: 26.9% of `leaf9-share`'s ink was cut away by world geometry, taking the whole
 * `\frac{1}{2}` denominator and most of the fraction bar with it, so the first mathematics a
 * player ever saw read `1 ⁻ x = 4` — a well-formed *false* statement produced by the
 * compositor. `TexPanel.js`'s header spends four gates making sure the rasterizer can never
 * do that to a claim; letting the world do it instead is the same lie with a different
 * mechanism.
 *
 * So the pair now stands to the *right* of the subject and above the horizon line, which is
 * where `reference/target-lowpoly.png` puts its equation block: entirely on the smooth upper
 * sky gradient, crossed by nothing. `leaf9-working` moves out with them to stay clear of the
 * wider column. The rule this encodes, and the one `review/measure/P15.mjs` claim O1 enforces
 * every run: **a standing claim's ink is 0.0% occluded.** Not "mostly visible" — a claim with
 * something in front of it is a claim that may be read wrong.
 *
 * The exact heights are a measurement too, not a nudge. The dusk sky is *banded* — hard-edged
 * cloud slabs and a step in the gradient — and a claim standing across one of those steps
 * reads in `P15.mjs` claim C16 as a negative halo: the sky 3–5 px from the ink measurably
 * darker than the sky 12–20 px away, which is the signature this piece exists to never
 * produce. It is the sky and not our raster (C16b measures our own alpha halo at 0), but a
 * claim fighting its background is still a claim fighting its background. Every height below
 * was chosen by taking a claim-free capture of this same frame, sliding each claim's real ink
 * mask up and down it a pixel at a time, and reading the C16 statistic out of the bare sky at
 * every offset. The numbers in the comments are from `review/measure/_skysweep` on the current
 * sky plate; when the sky changes, that sweep is the thing to re-run, not this paragraph.
 *
 * ## And the sizes are a measurement, not a taste call either
 *
 * `em` here is metres per em, and it decides — through the camera — how many device pixels a
 * stroke of this notation is drawn with. `TexPanel`'s gate 8 refuses to present a claim whose
 * thinnest stroke lands under 1.5 device px, which works out at 33.3 device px per em. G7
 * requires the game to be readable at 1280x720, so that is the size these have to clear, and
 * at 1280x720 the previous `em: 0.66` measured 30.1 px per em — under the floor, with the
 * `\ge` relation bar of `leaf9-mark` down at 0.65 px and read off the shipped capture by a
 * critic as `>`. The values below put every standing claim above the floor with margin at the
 * smallest size the bar names.
 */
const STANDING_CLAIMS = [
  {
    id: "leaf9-span",
    kpId: "eq-one-add",
    tex: "x + 3 = 7",
    anchor: { right: 1.44, up: 2.86, forward: 14 },
    em: 0.88,
  },
  {
    id: "leaf9-share",
    kpId: "eq-one-mult",
    tex: "\\frac{1}{2}x = 4",
    anchor: { right: 1.44, up: 0.66, forward: 14 },
    em: 0.88,
  },
  {
    id: "leaf9-working",
    anchor: { right: 6.3, up: 1.76, forward: 14 },
    em: 0.73,
    working: { slope: 0.62, intercept: 0.02, xTicks: 10, yTicks: 8 },
  },
  {
    // Standing a long way off, and well clear of the others on screen, so "readable at
    // gameplay distance" is a thing a reviewer can look at rather than a thing this file
    // claims. It used to stand at `forward: 42, em: 1.1`, which is where "a long way off"
    // stopped being a composition idea and became an illegible claim: 16.8 device px per em
    // at 1600x900 and 13.4 at 1280x720, against gate 8's floor of 33.3. Halving the distance
    // and doubling the metres-per-em keeps it the furthest claim in the frame — nearly twice
    // the distance of the pair — and puts it over the floor at every size the bar names.
    id: "leaf9-mark",
    kpId: "ineq-one-step",
    tex: "2x + 1 \\ge 9",
    anchor: { right: 20.5, up: 4.2, forward: 26 },
    em: 2.1,
  },
];

export default {
  id: "mathtex",
  order: 60,

  async setup(kernel) {
    setLocale(config.get("locale"));
    setMaxAnisotropy(kernel.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);

    // Rasterizing before the faces resolve would bake a Times New Roman equation into a
    // texture that never updates. Bounded, so a slow font cannot hold up the boot.
    const fonts = await ensureMathFonts(3000);
    if (fonts.failed?.length) {
      introspect.warnings.push(`math: ${fonts.failed.length} KaTeX face(s) did not resolve: ${fonts.failed.join(", ")}`);
    }

    const field = new TexField(kernel);
    kernel.mount("mathtex", field);
    field.resize(innerWidth, innerHeight);

    const standDown = () => {
      if (field.driven) return;
      field.driven = true;
      for (const spec of STANDING_CLAIMS) field.remove(spec.id);
    };

    for (const spec of STANDING_CLAIMS) field.add(spec);

    signals.on("ui:locale", (payload) => {
      const next = payload?.locale ?? payload;
      setLocale(next);
      field.setLocale(getLocale());
    });

    // math:show / math:hide — the vocabulary any system uses to put an expression in the
    // world. See design/architecture.md § "Math".
    signals.on("math:show", (spec) => {
      if (!spec?.id) return;
      standDown();
      field.add({
        id: spec.id,
        kpId: spec.kpId ?? null,
        tex: spec.tex ?? "",
        position: spec.at ?? spec.position ?? [0, 2, 0],
        anchor: spec.anchor ?? null,
        em: spec.em ?? 0.6,
        billboard: spec.billboard ?? "yaw",
        displayMode: spec.display !== false,
        working: spec.working ?? null,
      });
    });
    signals.on("math:hide", (spec) => {
      if (spec?.id) field.remove(spec.id);
      else field.clear();
    });

    // A learning engine driving the surface owns it outright.
    signals.on("learn:present", standDown);

    // ------------------------------------------------------------------ world:resonance
    /**
     * **A standing claim is an emitter, so it has to spill.**
     *
     * `art-direction.md` §5.4 lists KaTeX in the accent class and states the rule in one line:
     * "Every emitter carries a real `PointLight` so it spills onto the ground, and the spill is
     * the proof it is a light rather than a painted decal." `world/Lighting.js` implements the
     * receiving half in full — `addAccent(id, position, {radius, strength})` puts a claim into a
     * fixed-size pool that is re-assigned by distance every frame, so the point-light count never
     * changes and no program is ever recompiled. It listens on `world:resonance`.
     *
     * Nothing in the repository emitted that name. The rule was in the bible, the light rig was
     * built, the pool was allocated at boot — and every accent light in the game sat at intensity
     * 0 forever, because the one string that reaches them was never written. This is the emitter.
     *
     * It reconciles off `field.panels` rather than off the `math:show` payload, for two reasons
     * that are the same reason: **only the panel knows where the claim really stands.** The four
     * claims standing at spawn arrive with a view-relative `anchor` and no world position at all —
     * `TexField._resolveAnchors` turns that into a world point a quarter of a simulated second
     * later, against the settled camera — and the field evicts a claim on its own when the
     * thirty-second one arrives. Mirroring the payload would light a claim that stood somewhere
     * else, and would keep lighting one that had already stood down.
     *
     * Reconciled in `after()`, after every `frame()` hook, so the transform read is the one that
     * was rendered. Emits only on a change: appear, move more than 5 cm, or disappear.
     *
     * ## The light goes at the socket, not at the ink — and that cost a round to learn
     *
     * The first version of this bridge sent the ink's own world position, which is the obvious
     * thing to send and is worth **exactly zero pixels**. Every claim at spawn stands 10.7 – 21.2 m
     * above the ground beneath it, because P15 stands claims on bare sky so their ink is 0.0%
     * occluded (`review/measure/P15.mjs` claim O1), and §5.4 caps an accent at 6 m so it marks the
     * world rather than lighting it. Sphere-cast 26 directions out of an accent parked at the ink
     * and *nothing is inside its falloff in any direction*. A critic measured the consequence the
     * only way it can honestly be measured — halt the loop, render twice at `advance(0)`, read the
     * drawing buffer — and deleting all four accents in place changed 0 of 518,400 pixels, while
     * the same rig with one accent a metre above the ground moved 7,491. The receiving half was
     * never the problem. §5.4's own sentence is "**the spill** is the proof it is a light rather
     * than a painted decal", and anti-pattern 15 is "an emitter with no spill is a painted decal":
     * a `PointLight` in clear air 11 m up satisfies the letter of the rule and fails the rule.
     *
     * So the position this sends is the claim's **socket** — `collision.groundAt(x, z)` under the
     * ink, lifted `groundLift` so the falloff sphere cuts the surface instead of grazing it. That
     * is not a workaround for the cap, it is what `world.md` §2.1 already says a claim *is*: a live
     * statement standing at a socket. The socket is on the ground; the resonance pools there. The
     * ink keeps its measured height and its 0.0% occlusion, the light lands on rock, and neither
     * rule has to move.
     *
     * The ray is cast downward **from the ink**, so the surface found is always the one beneath
     * that claim rather than whatever roof happens to be over it. It is re-cast only when the ink
     * moves — four raycasts once, at the quarter-second where `TexField._resolveAnchors` places
     * the standing claims, and none thereafter.
     *
     * ## What it is worth, measured, including the part that is still small
     *
     * Same instrument, same session, after the change (`review/measure/P36-r3.mjs`):
     *
     *   control (two renders, nothing touched)      0 px          — the instrument resolves one code value
     *   treatment (every accent removed in place)   412 px, Δ22   — what the seam is worth in the spawn frame
     *   reach (26 sphere casts per accent)          9–12 of 26 hit, nearest surface 0.73–0.95 m
     *
     * The reach line is the one that matters most: the identical cast in round 2 found *no surface
     * in any direction from any accent*. Every accent now has world inside its falloff.
     *
     * All 412 of those pixels come from one accent — `leaf9-mark`, whose socket lands 0.95 m from a
     * drawn boulder. The other three sockets sit on open, near-horizontal ground 15 m from the lens
     * and are worth under one code value each, which is not a wiring fault either: a point light a
     * metre above a flat plane lights a small disc at grazing incidence, and §5.4's cap decides how
     * bright that disc may be. `review/measure/P36-r3-sweep.mjs` prices exactly that — one accent, a
     * metre above the ground, walked out from the body: 255 px at 1.2 m, 13 px at 3.6 m, 0 past
     * 4.8 m. A standing rock beside the light is a far better receiver than the floor under it.
     *
     * The cap is not being cheated to get the number. In the delivered frame the facet this
     * brightens most moves from Y 0.103 to Y 0.152 — an accent contribution of 0.049 against the
     * Y 0.10 §5.4 allows a facet one metre out.
     *
     * On the gameplay path (`review/measure/P36-r3-play.mjs`) the same A/B reads 366 px at spawn and
     * **0 px after E**: pressing E stands the four claims down and leaves one teaching claim, whose
     * socket is on that same open ground. The seam is still live there and says so as a state delta
     * rather than a pixel one — `probe("lighting").accents.registered` goes 4 → 1 → 2 as this block
     * retires three accents with `{active:false}` and registers the teaching claim's.
     *
     * One trail deliberately left marked, because it cost three browser runs: a `THREE.Raycaster`
     * cast straight down finds no drawn triangle at any of these sockets, which reads exactly like
     * "the renderer draws nothing there". It is an instrument fault — `vs.terrain.surface` is not
     * raycastable at all, and the identical cast two metres from the body, over ground the avatar is
     * demonstrably standing on, also finds only the keel 80 m below (`review/measure/P36-r3-drawn.mjs`
     * is that control). Do not conclude anything about drawn geometry from that cast.
     *
     * The 412 is recorded in `review/measure/seam-effects.json`, which `tools/seams.mjs` reads as a
     * gate: a seam this project calls closed has to carry a measured effect, because string pairing
     * is exactly what round 2 satisfied while lighting nothing.
     */
    const RESONANCE = {
      // §5.4 caps accent radius at 6 m; a claim is ink, not a crystal core, so it stands under that.
      radius: 5,
      // Full budget, not a fraction of it. `Lighting._assignAccents` turns this into
      // `intensity = strength * 0.58`, and the 0.58 is itself §5.4's cap — the value at which a
      // rock facet one metre away sits exactly at the Y 0.10 that separates *marking* the world
      // from *lighting* it. Round 2 sent 0.6 "because a claim is ink, not a crystal core", which
      // spent 40% of the only budget this feature has on nothing: `review/measure/P36-r3-sweep.mjs`
      // parks a 0.6 accent a metre above the ground at ten points out from the body and measures
      // the ground it lights moving by **one code value** — 255 px at 1.2 m, 13 px at 3.6 m, zero
      // beyond 4.8 m. At the cap the brightest pixel any accent moves is 22/255, and the facet it
      // moves goes from Y 0.103 to Y 0.152 — an accent contribution of 0.049 against §5.4's 0.10.
      strength: 1,
      // Below this, a re-emit is noise: `math:show` is idempotent and a claim that has resolved
      // its anchor does not move again.
      moveEpsilon: 0.05,
      // How far above the surface the accent sits. A point light *on* the plane it lights spills
      // over a vanishing area; one metre up is the height the critic's own diagnostic used and it
      // puts a ~4.9 m radius of ground inside a 5 m falloff.
      groundLift: 1.0,
    };
    const litClaims = new Map(); // panel id -> { ink: [x,y,z], at: [x,y,z] }
    const claimPosition = (panel) => {
      const mesh = panel?.mesh;
      if (!mesh) return null;
      // The world transform, not the local one: the field's root is at the origin today and
      // reading `mesh.position` would agree, but a claim parented to anything that moves would
      // then light the wrong rock and nothing would say so.
      mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    /**
     * The claim's socket: straight down from the ink to the first surface, lifted clear of it.
     * Falls back to the ink itself when there is no collision world yet or nothing below — an
     * accent that lights nothing is still better than a claim that silently stops resonating,
     * and `__vs.probe("mathtex")` reports which case each claim is in.
     */
    const spillPoint = (ink) => {
      const g = kernel.get("collision")?.groundAt?.(ink[0], ink[2], ink[1] + 0.05);
      if (!g?.hit) return { at: ink, grounded: false, drop: 0 };
      return {
        at: [ink[0], g.y + RESONANCE.groundLift, ink[2]],
        grounded: true,
        drop: ink[1] - g.y,
      };
    };
    kernel.mount("mathresonance", {
      after() {
        const standing = new Set();
        for (const [id, panel] of field.panels) {
          // A view anchor that has not resolved yet has no world position worth lighting: the
          // mesh is still at the field's origin and would pool light on whatever stands there.
          if (panel?.anchor) continue;
          const ink = claimPosition(panel);
          if (!ink) continue;
          standing.add(id);
          const was = litClaims.get(id);
          if (
            was &&
            Math.abs(was.ink[0] - ink[0]) < RESONANCE.moveEpsilon &&
            Math.abs(was.ink[1] - ink[1]) < RESONANCE.moveEpsilon &&
            Math.abs(was.ink[2] - ink[2]) < RESONANCE.moveEpsilon
          ) {
            continue;
          }
          const spill = spillPoint(ink);
          litClaims.set(id, { ink, at: spill.at, grounded: spill.grounded, drop: spill.drop });
          signals.emit("world:resonance", {
            id,
            position: spill.at,
            radius: RESONANCE.radius,
            strength: RESONANCE.strength,
            active: true,
          });
        }
        for (const id of [...litClaims.keys()]) {
          if (standing.has(id)) continue;
          litClaims.delete(id);
          signals.emit("world:resonance", { id, active: false });
        }
      },
      dispose() {
        for (const id of [...litClaims.keys()]) signals.emit("world:resonance", { id, active: false });
        litClaims.clear();
      },
    });

    publish("mathtex", () => field.probe());
    // What `world:resonance` is actually asking for, per claim: where the ink is, where its socket
    // is, and how far the light had to fall to reach a surface. `grounded:false` means the claim is
    // standing over nothing and its accent is back at the ink, lighting air — the exact state this
    // whole block exists to make visible rather than silent.
    publish("mathresonance", () => ({
      claims: [...litClaims.entries()].map(([id, e]) => ({
        id,
        ink: e.ink.map((v) => +v.toFixed(2)),
        socket: e.at.map((v) => +v.toFixed(2)),
        drop: +(e.drop ?? 0).toFixed(2),
        grounded: !!e.grounded,
      })),
      radius: RESONANCE.radius,
      strength: RESONANCE.strength,
      groundLift: RESONANCE.groundLift,
    }));
    // Deliberately a probe of its own, and deliberately not folded into `mathtex`. It fires
    // one camera-to-ink ray per sample against every depth-writing mesh in the scene, which is
    // a couple of hundred milliseconds in the spawn frame — an instrument, not something
    // `__vs.report()` should pay for on every call. `review/measure/P15.mjs` claim O1 reads it
    // and fails the run if any standing claim has world geometry in front of its ink.
    publish("mathocclusion", () => field.occlusionReport());
    publish("tex", () => ({ ...texStats(), failures: texFailures() }));
  },
};
