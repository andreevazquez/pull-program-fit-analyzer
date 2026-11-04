// Edge cases from real spreadsheets: formatted numbers, program spelling, duplicates, blank cost.
// Usage: node test/robustness.mjs   (exit code 0 = pass)
import { analyze } from "../js/segment.js";

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };

const weeks = Array.from({ length: 26 }, (_, i) => "w" + String(i + 1).padStart(2, "0"));
const row = (o = {}) => ({
  part_number: "P1", description: "", commodity: "C", manufacturer: "M", supplier: "S",
  unit_cost_usd: "1.50", lead_time_weeks: "10", moq: "100", current_program: "MRP", on_hand_qty: "500",
  ...Object.fromEntries(weeks.map((w) => [w, "100"])), ...o,
});

const a = analyze([row({ unit_cost_usd: "$1.50", on_hand_qty: "1,500", w01: "1,000" })]).parts[0];
check('"$1.50" parses as 1.5', a.unit_cost_usd === 1.5);
check('"1,500" parses as 1500', a.on_hand_qty === 1500);
check('"1,000" in a week counts as 1000 demand, not 0', a.demand[0] === 1000);

const progs = analyze(["kanban", " vmi ", "VMI/SMI", "Crp", "mrp", "Consignment"].map((c, i) => row({ part_number: "P" + i, current_program: c }))).parts.map((p) => p.current_program);
check("program names are normalized (kanban → Kanban, VMI/SMI → VMI, …)", JSON.stringify(progs.slice(0, 5)) === JSON.stringify(["Kanban", "VMI", "VMI", "CRP", "MRP"]));
check("unknown program names pass through unchanged", progs[5] === "Consignment");

const dup = analyze([row(), row()]);
check("duplicate part numbers are flagged", dup.parts.every((p) => p.issues.includes("Duplicate part number")));
check("duplicates are a warning, not a block", dup.parts.every((p) => !p.blocking && p.analyzed));

const blank = analyze([row({ unit_cost_usd: "" }), row({ part_number: "P2" })]).parts[0];
check("blank cost blocks the part", blank.blocking && blank.issues.includes("Zero/blank cost"));

console.log(failures ? `FAILED (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
