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

    publish("mathtex", () => field.probe());
    // Deliberately a probe of its own, and deliberately not folded into `mathtex`. It fires
    // one camera-to-ink ray per sample against every depth-writing mesh in the scene, which is
    // a couple of hundred milliseconds in the spawn frame — an instrument, not something
    // `__vs.report()` should pay for on every call. `review/measure/P15.mjs` claim O1 reads it
    // and fails the run if any standing claim has world geometry in front of its ink.
    publish("mathocclusion", () => field.occlusionReport());
    publish("tex", () => ({ ...texStats(), failures: texFailures() }));
  },
};
