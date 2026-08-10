# boot/

One file per feature. `main.js` glob-imports this directory, so **adding a feature never edits a
shared file** — which is the only reason many agents can build in parallel without conflicts.

```js
// app/src/boot/30-locomotion.js
import { Locomotion } from "../play/Locomotion.js";

export default {
  id: "locomotion",
  order: 30,
  async setup(kernel) {
    kernel.mount("locomotion", new Locomotion(kernel));
  },
};
```

A module that throws is logged to `__vs.errors` and skipped; the rest of the game still boots.
That keeps an unfinished feature from blacking out a review capture.

## Order table

Claim your slot here so ordering stays predictable. Lower runs first.

| order | id | piece | why it sits there |
|-------|----|-------|-------------------|
| 02 | autotier | P30 | picks the quality tier before any system reads `config.tier` |
| 05 | i18n | P20 | strings must exist before any UI reads them |
| 10 | world | P09 | terrain and colliders before anything stands on them |
| 12 | sky | P10 | background before lighting samples it |
| 14 | lighting | P11 | lights before materials are finalized |
| 16 | scatter | P13 | needs terrain height queries |
| 20 | input | P07 | before anything that reads intent |
| 30 | locomotion | P04 | needs input + colliders |
| 32 | avatar | P08 | needs locomotion state |
| 34 | traversal | P06 | extends locomotion via signals |
| 40 | camera | P05 | after the player exists |
| 50 | vfx | P14 | after the world |
| 52 | post | P12 | wraps the whole render, must be late |
| 60 | mathtex | P15 | before learning UI |
| 62 | learning | P16/P17/P18 | engine + bank + teaching |
| 64 | verbs | P19 | learning interactions in the world |
| 66 | build | P26 | construction |
| 70 | hud | P21 | after everything it reports on |
| 72 | progressui | P24 | |
| 74 | menus | P22 | |
| 80 | audio | P25 | last of the systems |
| 90 | flow | P23/P27 | title, onboarding, session — drives the rest |
