import { itemBank } from "../../../app/src/learn/ItemBank.js";
const r = itemBank.select({ kpId: "expr-anatomy", form: "construct", difficulty: 3, seed: 7 });
console.log("ok", r && r.item ? { id: r.item.id, family: r.item.family, form: r.item.form, source: r.source } : r);
const r2 = itemBank.select({ kpId: "eq-special-cases", form: "construct", difficulty: 3, seed: 9 });
console.log("ok2", r2 && r2.item ? { id: r2.item.id, family: r2.item.family } : r2);
