import fs from "node:fs";
import path from "node:path";
const SRC = "C:/dev/math/aaemath/app/src";
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".js") ? [p] : [];
  });
const RE = /(?<![\w$])((?:[\w$]+\s*\.\s*)?)(on|emit)\(\s*["'`]([a-z][\w-]*:[\w:-]+)["'`]/g;
const byRecv = new Map();
for (const f of walk(SRC)) {
  const s = fs.readFileSync(f, "utf8");
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(s))) {
    const key = `${m[2]} via ${(m[1] || "(bare)").trim() || "(bare)"}`;
    if (!byRecv.has(key)) byRecv.set(key, new Set());
    byRecv.get(key).add(`${path.relative(SRC, f).replace(/\\/g, "/")}  ${m[3]}`);
  }
}
for (const k of [...byRecv.keys()].sort()) {
  console.log(`\n${k}  -> ${byRecv.get(k).size} distinct sites`);
  [...byRecv.get(k)].sort().slice(0, 40).forEach((x) => console.log("   ", x));
}
