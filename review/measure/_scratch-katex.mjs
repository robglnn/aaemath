import katex from "katex";

const strip = (n) => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === "object") {
    const o = {};
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      o[k] = strip(n[k]);
    }
    return o;
  }
  return n;
};

const cases = [
  String.raw`\le`,
  String.raw`\ge`,
  String.raw`\ne`,
  String.raw`\cdot`,
  String.raw`\times`,
  String.raw`\div`,
  String.raw`\frac{1}{2}`,
  String.raw`\left(x+1\right)`,
  String.raw`\text{hi}`,
  String.raw`\sqrt{9}`,
  String.raw`3{,}5`,
  String.raw`16\,004`,
  String.raw`\mathbin{:}`,
  String.raw`-\tfrac{3}{4}x \ge -12`,
  String.raw`\left|x\right|`,
  String.raw`\textcolor{red}{x}`,
];

for (const s of cases) {
  try {
    console.log(s.padEnd(26), JSON.stringify(strip(katex.__parse(s, { strict: "error", trust: false }))));
  } catch (e) {
    console.log(s.padEnd(26), "ERR", e.message);
  }
}

console.log("\n--- html sample ---");
console.log(katex.renderToString(String.raw`\frac{1}{2}x = 4`, { output: "html", throwOnError: true, strict: "error" }));
