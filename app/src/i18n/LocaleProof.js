/**
 * LocaleProof — a measurement surface, not a feature.
 *
 * The claim "longer Spanish and Polish strings do not break the layout" is only worth making if
 * something measures it, and nothing in this build renders a string yet: the HUD (P21) and the
 * menus (P22) are later pieces. So this file lays the *worst case* string of every register into
 * boxes at the widths those pieces will have to live inside, and reports, in pixels, how much
 * each one overflows.
 *
 * It is **off unless `?i18nproof=1`** is in the URL. `review.mjs verify`, `shot` and `tour` never
 * set it, so it can never appear in a player-visible frame (G8); `review/measure/P20.mjs` sets it
 * deliberately and reads the numbers back out.
 *
 * The widths below are not decoration. They are the constraint the later pieces inherit, and
 * they are stated in the handoff so P21 and P22 can argue with them rather than discover them.
 */

/** Register → the box it has to survive, in CSS px, and whether it must hold one line. */
export const BOXES = [
  { id: "hud-label", prefix: "ui.hud.", width: 168, single: true, label: "HUD LABEL" },
  { id: "hud-count", prefix: "ui.count.", width: 168, single: true, label: "HUD COUNT" },
  { id: "menu", prefix: "ui.menu.", width: 240, single: true, label: "MENU" },
  { id: "setting", prefix: "ui.setting.", width: 240, single: true, label: "KIT" },
  { id: "action", prefix: "ui.action.", width: 260, single: true, label: "VERB" },
  { id: "system", prefix: "sys.", width: 340, single: true, label: "SYSTEM" },
  { id: "mastery", prefix: "mastery.", width: 340, single: true, label: "RANK" },
  { id: "ambient", prefix: "amb.", width: 400, single: true, label: "AMBIENT" },
  { id: "bark", prefix: "ix.bark.", width: 440, single: true, label: "BARK" },
  { id: "fall", prefix: "fail.", width: 440, single: true, label: "FALL READ" },
  { id: "sign", prefix: "sign.", width: 400, single: true, label: "SIGNAGE" },
  { id: "walkon", prefix: "walk.", width: 520, single: true, label: "WALK-ON" },
  { id: "sennar", prefix: "sennar.", width: 520, single: true, label: "SENNAR" },
  { id: "dace", prefix: "dace.", width: 520, single: true, label: "DACE" },
  { id: "camber", prefix: "camber.", width: 520, single: false, maxHeight: 132, label: "CAMBER" },
];

const CSS = `
.vs-i18nproof{position:fixed;inset:0;padding:20px;display:flex;flex-wrap:wrap;gap:14px;
  align-content:flex-start;font-family:var(--vs-face);color:var(--vs-parchment);
  background:#0a1219;overflow:hidden}
.vs-i18nproof .cell{background:#111d27;border:2px solid #2c4553;padding:8px 10px}
.vs-i18nproof .tag{font-size:10px;letter-spacing:.18em;color:#6f93a3;margin-bottom:4px}
.vs-i18nproof .fit{font-size:15px;line-height:1.28;color:#e9f7fa}
.vs-i18nproof .fit.one{white-space:nowrap;overflow:hidden}
.vs-i18nproof .fit.many{overflow:hidden}
.vs-i18nproof .head{width:100%;font-size:13px;letter-spacing:.2em;color:#79f0e4}
.vs-i18nproof .nums{width:100%;font-size:14px;color:#ffb15e;letter-spacing:.04em}
`;

export function mountLocaleProof(i18n) {
  const overlay = document.getElementById("overlay");
  if (!overlay) return null;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "vs-i18nproof";

  const head = document.createElement("div");
  head.className = "head";
  head.textContent = `${i18n.locale.toUpperCase()} — ${i18n.report().keys} KEYS — ${i18n.missing().length} MISSING`;
  root.appendChild(head);

  const cells = [];
  for (const box of BOXES) {
    const worst = i18n.longest(box.prefix);
    if (!worst) continue;
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.width = `${box.width}px`;

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = `${box.label} · ${box.width}px`;

    const fit = document.createElement("div");
    fit.className = `fit ${box.single ? "one" : "many"}`;
    if (!box.single && box.maxHeight) fit.style.maxHeight = `${box.maxHeight}px`;
    fit.textContent = worst.text;

    cell.append(tag, fit);
    root.appendChild(cell);
    cells.push({ box, worst, fit, cell });
  }

  // Numbers, in the locale's own convention, rendered rather than described.
  const nums = document.createElement("div");
  nums.className = "nums";
  nums.textContent = [
    i18n.n(16004),
    i18n.n(4111),
    i18n.n(1.5),
    i18n.n(-2.25),
    i18n.percent(80),
    i18n.t("ui.count.leaves", { n: 1 }),
    i18n.t("ui.count.leaves", { n: 2 }),
    i18n.t("ui.count.leaves", { n: 5 }),
    i18n.t("ui.count.leaves", { n: 22 }),
    i18n.t("ui.count.leaves", { n: 1.5 }),
    i18n.t("fail.tilt.near", { n: 1.5 }),
  ].join("   ·   ");
  root.appendChild(nums);

  overlay.appendChild(root);

  /** Overflow, in real laid-out pixels, for every box on screen. */
  function measure() {
    const vw = window.innerWidth;
    return cells.map(({ box, worst, fit, cell }) => {
      const rect = cell.getBoundingClientRect();
      return {
        id: box.id,
        key: worst.key,
        chars: worst.text.length,
        boxWidth: box.width,
        overflowX: Math.max(0, fit.scrollWidth - fit.clientWidth),
        overflowY: box.single ? 0 : Math.max(0, fit.scrollHeight - fit.clientHeight),
        offViewport: Math.max(0, Math.round(rect.right - vw)),
      };
    });
  }

  return { root, measure, cells };
}
