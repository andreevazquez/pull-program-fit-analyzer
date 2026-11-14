// Checks for js/whatif.js: supplier delay what-if.
// Usage: node test/whatif.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js?v=24";
import { delayCandidates, delayScenario, IMPACTS, WHATIF_COLUMNS, whatifRow } from "../js/whatif.js?v=24";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), fc = read("data/forecast.csv");
let failures = 0;
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures++; };

const P = clonePolicy();
const res = analyze(parts, P);

console.log("Candidates:");
const cands = delayCandidates(res.analyzed, fc);
check("there are suppliers with open POs in the horizon", cands.length > 0, `${cands.length}`);
check("sorted by open-PO value", cands.every((c, i, a) => !i || a[i - 1].po_value >= c.po_value));

console.log("Sample scenarios:");
for (const c of cands) {
  const zero = delayScenario(res.analyzed, fc, P, { supplier: c.supplier, weeks: 0 });
  if (zero.rows.some((r) => r.impact !== "No change") || zero.addedValue !== 0) { check(`${c.supplier}: 0 weeks changes nothing`, false); break; }
  let prev = -1, ok = true;
  for (let w = 0; w <= 10; w++) {
    const s = delayScenario(res.analyzed, fc, P, { supplier: c.supplier, weeks: w });
    if (s.addedValue + 1e-6 < prev) ok = false;
    prev = s.addedValue;
    if (s.rows.length !== c.parts.length) ok = false;
    if (!s.rows.every((r) => IMPACTS.includes(r.impact) && r.added_value >= 0)) ok = false;
    if (!s.rows.every((r) => r.impact !== "New expedite" || (r.after === "Escalate" && r.before !== "Escalate"))) ok = false;
  }
  if (!ok) { check(`${c.supplier}: a longer delay never lowers the value at risk`, false); break; }
}
check("for every supplier: 0 weeks changes nothing, value at risk never falls as the delay grows, every part classified", failures === 0);

const top = cands[0];
const s4 = delayScenario(res.analyzed, fc, P, { supplier: top.supplier, weeks: 4 });
check("rows ranked worst impact first", s4.rows.every((r, i, a) => !i || IMPACTS.indexOf(a[i - 1].impact) <= IMPACTS.indexOf(r.impact)));
check("only the chosen supplier's parts", s4.rows.every((r) => r.part.supplier === top.supplier));
const one = delayScenario(res.analyzed, fc, P, { supplier: top.supplier, part: top.parts[0].part_number, weeks: 4 });
check("narrowing to one part keeps only that part", one.rows.length === 1 && one.rows[0].part.part_number === top.parts[0].part_number);
check("CSV row has one value per column", s4.rows.every((r) => whatifRow(r).length === WHATIF_COLUMNS.length));
console.log(`    ${top.supplier}, 4 weeks: ${s4.parts} parts with open POs · ${s4.newExpedite} new expedites · ${s4.deeper} deeper · ${s4.orderNow} order now · +$${Math.round(s4.addedValue).toLocaleString("en-US")} at risk`);

console.log("Hand-built part:");
// 100 on hand, 50/week, PO of 1,000 due week 2, LT 4 weeks, $2 each.
const row = { part_number: "T-1", description: "test", commodity: "MLCC Capacitor", manufacturer: "m", supplier: "S", unit_cost_usd: "2",
  lead_time_weeks: "4", moq: "1", current_program: "MRP", on_hand_qty: "100",
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`w${String(i + 1).padStart(2, "0")}`, "50"])) };
const fcRow = { part_number: "T-1", open_po_qty: "1000", open_po_due_week: "2", ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${String(i + 1).padStart(2, "0")}`, "50"])) };
const hb = analyze([row], P).analyzed;
const base = delayScenario(hb, [fcRow], P, { supplier: "S", weeks: 0 }).rows[0];
check("on time: covered", base.before === "Covered" && base.impact === "No change");
const d3 = delayScenario(hb, [fcRow], P, { supplier: "S", weeks: 3 }).rows[0];
// PO lands week 5: projected 50, 0, −50, −100 → short from week 3, inside the 4-week LT; worst inside LT = 100 units = $200
check("3 weeks late: new expedite, short from week 3, $200 at risk", d3.impact === "New expedite" && d3.first_short_after === 3 && d3.added_value === 200,
  `${d3.impact}, week ${d3.first_short_after}, $${d3.added_value}`);
const d20 = delayScenario(hb, [fcRow], P, { supplier: "S", weeks: 20 }).rows[0];
check("a PO pushed past week 13 leaves the horizon", d20.po_week_after > 13 && d20.after === "Escalate");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll what-if checks passed");
process.exit(failures ? 1 : 0);
