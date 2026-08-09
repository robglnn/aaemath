#!/usr/bin/env node
// Blind side-by-side setup.
//
// A judge who knows which image is ours grades ours. This copies two images to neutral names in a
// round-specific folder, with the A/B assignment derived from a hash of the round label so the
// ordering varies between rounds and the judge cannot learn a rule from one review to the next.
//
//   node tools/ab.mjs --round=w2r3 --ours=review/shots/vista.png --other=reference/brief-hero.png
//
// Prints the folder to hand the judge. The answer key is written to <folder>/KEY.txt — a judge that
// opens it has invalidated their own review and must say so.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const flag = (n, d = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const round = flag("round");
const ours = flag("ours");
const other = flag("other", "reference/brief-hero.png");
if (!round || !ours) {
  console.error("usage: node tools/ab.mjs --round=<label> --ours=<path> [--other=<path>]");
  process.exit(2);
}

for (const p of [ours, other]) {
  if (!fs.existsSync(path.resolve(ROOT, p))) {
    console.error(`missing image: ${p}`);
    process.exit(1);
  }
}

// Cheap deterministic hash of the round label decides the assignment.
let h = 0;
for (const ch of round) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
const oursIsA = (h & 1) === 0;

const dir = path.join(ROOT, "review/ab", round);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const aSrc = oursIsA ? ours : other;
const bSrc = oursIsA ? other : ours;
fs.copyFileSync(path.resolve(ROOT, aSrc), path.join(dir, "A.png"));
fs.copyFileSync(path.resolve(ROOT, bSrc), path.join(dir, "B.png"));
fs.writeFileSync(
  path.join(dir, "KEY.txt"),
  `A = ${aSrc}\nB = ${bSrc}\n\nIf you are the judge and you are reading this, your review is void. Say so.\n`
);

console.log(
  JSON.stringify(
    {
      folder: path.relative(ROOT, dir).replace(/\\/g, "/"),
      images: ["A.png", "B.png"].map((f) => `${path.relative(ROOT, dir).replace(/\\/g, "/")}/${f}`),
      instruction:
        "Open both images. Judge which is the better-looking game frame and why. Do not open KEY.txt.",
    },
    null,
    2
  )
);
