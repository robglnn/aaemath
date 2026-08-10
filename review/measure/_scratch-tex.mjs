import { validate, localizeTex, render, texStats, lintTexBank } from "../../app/src/math/Tex.js";

const cases = [
  "x + 3 = 7",
  "\\frac{1}{2}x = 4",
  "2x + 1 \\ge 9",
  "-3x \\le -12",
  "4(x + 2) = 20",
  "3.5x = 10.25",
  "16000 + x = 16004",
  "6 \\div 2 = 3",
  "5 \\times 4 = 20",
  "x^{2} + 1",
  "\\sqrt{9} = 3",
  "\\left|x\\right| = 5",
  "\\text{Leaf Nine}",
  "y = -\\frac{3}{4}x",
];

for (const locale of ["en", "es", "pl"]) {
  console.log("=== " + locale);
  for (const t of cases) {
    const v = validate(t, { locale });
    console.log(
      (v.ok ? "ok " : "FAIL"),
      JSON.stringify(t).padEnd(28),
      "|", v.localizedTex.padEnd(28),
      "|", v.text.padEnd(20),
      "|", v.speech,
      v.error ? "  ERR " + v.error : ""
    );
  }
}

console.log("\n=== malformed");
for (const bad of ["\\frac{1}{", "\\notacommand{x}", "x ≤ 5", "", "\\begin{matrix}", "\\href{javascript:x}{a}"]) {
  const v = validate(bad, { locale: "en" });
  console.log(JSON.stringify(bad).padEnd(26), v.ok ? "ok(!)" : "refused: " + v.error);
}

console.log("\n=== render fallback");
const r = render("\\frac{1}{", { locale: "pl" });
console.log({ ok: r.ok, speech: r.speech, htmlHasSource: r.html.includes("frac") });
console.log(texStats());

console.log("\n=== lint");
console.log(JSON.stringify(lintTexBank(cases.map((t, i) => ({ id: "c" + i, tex: t }))).failures, null, 1));
