// Throwaway diagnostic: parse-tree depth of the fixtures, the attacks, and the shipped bank.
import katex from "katex";
import fs from "node:fs";
import path from "node:path";

const CHILD = ["body", "numer", "denom", "base", "sub", "sup", "index", "mathml", "html"];
function shape(n, d = 0, a = { depth: 0, nodes: 0 }) {
  if (n == null) return a;
  if (Array.isArray(n)) {
    for (const x of n) shape(x, d, a);
    return a;
  }
  if (typeof n !== "object") return a;
  a.nodes++;
  a.depth = Math.max(a.depth, d);
  for (const k of CHILD) if (n[k] != null && typeof n[k] === "object") shape(n[k], d + 1, a);
  return a;
}
const S = { displayMode: true, output: "html", throwOnError: true, strict: "error", trust: false, macros: {}, maxSize: 12, maxExpand: 200, minRuleThickness: 0.055 };
const dep = (tex) => {
  try {
    return shape(katex.__parse(tex, S));
  } catch (e) {
    return { err: String(e.message).slice(0, 50) };
  }
};
const frac = (n) => "\\frac{1}{".repeat(n) + "2" + "}".repeat(n);

console.log("nested fractions (Blink layout crashes at 15):");
for (const n of [1, 2, 3, 4, 6, 8, 10, 12, 14, 15, 20, 60]) console.log("  frac", n, JSON.stringify(dep(frac(n))));
console.log("fixtures:");
for (const t of ["x + 3 = 7", "\\frac{1}{2}x = 4", "-\\frac{3}{4}x + 2 = -7", "\\left|x\\right| = 5", "\\sqrt{9} = 3", "\\frac{\\frac{1}{2}}{\\frac{3}{4}}", "\\sqrt{\\frac{x^{2}+1}{2}}"])
  console.log("  ", JSON.stringify(t), JSON.stringify(dep(t)));
console.log("matrix 150:", JSON.stringify(dep(`\\begin{matrix}${"1 \\\\ ".repeat(149)}1\\end{matrix}`)));
console.log("wide 471:", JSON.stringify(dep("1" + " + 1".repeat(470))));

const dir = path.resolve(import.meta.dirname, "..", "..", "content", "items", "bank");
let worst = { depth: -1 };
let worstNodes = { nodes: -1 };
let n = 0;
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  JSON.stringify(j, (k, v) => {
    if (k === "tex" && typeof v === "string") {
      n++;
      const s = dep(v);
      if (!s.err) {
        if (s.depth > worst.depth) worst = { ...s, tex: v };
        if (s.nodes > worstNodes.nodes) worstNodes = { ...s, tex: v };
      }
    }
    return v;
  });
}
console.log(`shipped bank: ${n} expressions`);
console.log("  deepest:", JSON.stringify(worst));
console.log("  most nodes:", JSON.stringify(worstNodes));
