import fs from "node:fs";
const p = process.argv[2];
let s = fs.readFileSync(p, "utf8");
const nul = String.fromCharCode(0);
const n = s.split(nul).length - 1;
s = s.split(nul).join("\\u0000");
fs.writeFileSync(p, s);
console.log("replaced", n, "NUL chars in", p);
