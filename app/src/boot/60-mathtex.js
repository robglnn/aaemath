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
 */
const STANDING_CLAIMS = [
  {
    id: "leaf9-span",
    kpId: "eq-one-add",
    tex: "x + 3 = 7",
    position: [2.6, 5.15, 1.0],
    em: 0.62,
  },
  {
    id: "leaf9-share",
    kpId: "eq-one-mult",
    tex: "\\frac{1}{2}x = 4",
    position: [2.6, 3.85, 1.0],
    em: 0.62,
  },
  {
    id: "leaf9-working",
    position: [9.2, 4.5, 1.0],
    em: 0.55,
    working: { slope: 0.62, intercept: 0.02, xTicks: 10, yTicks: 8 },
  },
  {
    // Standing a long way off, so "readable at gameplay distance" is a thing a reviewer can
    // look at rather than a thing this file claims.
    id: "leaf9-mark",
    kpId: "ineq-one-step",
    tex: "2x + 1 \\ge 9",
    position: [-19.0, 8.0, -34.0],
    em: 1.15,
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
        height: spec.height ?? 1,
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
    publish("tex", () => ({ ...texStats(), failures: texFailures() }));
  },
};
