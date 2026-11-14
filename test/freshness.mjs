// Checks for js/freshness.js (V2_SPEC.md section 2, freshness claims).
// Usage: node test/freshness.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js";
import { freshness, parseDateCode, isoWeeksInYear, addMonths, parseDate, iso } from "../js/freshness.js?v=25";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), lots = read("data/inventory_lots.csv"), suppliers = read("data/suppliers.csv");
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };

console.log("Date codes:");
check("2501 → Monday 2024-12-30 (ISO week 1 of 2025 starts in December)", iso(parseDateCode("2501").date) === "2024-12-30");
check("2442 → Monday 2024-10-14", iso(parseDateCode("2442").date) === "2024-10-14");
check("2053 → 2020-12-28 (2020 has 53 ISO weeks)", isoWeeksInYear(2020) === 53 && iso(parseDateCode("2053").date) === "2020-12-28");
check("2453 rejected (2024 has 52 ISO weeks)", !!parseDateCode("2453").error);
check("2400, 2454, 24A1, 123, 24015 and blank rejected", ["2400", "2454", "24A1", "123", "24015", ""].every((c) => parseDateCode(c).error));
check("calendar months clamp at month end (Jan 31 + 1 = Feb 28)", iso(addMonths(parseDate("2025-01-31"), 1)) === "2025-02-28");

const P = clonePolicy();
const res = analyze(parts, P);
const F = freshness(lots, suppliers, res.parts, P);
console.log("Sample (V2_SPEC.md expected values):");
check(`304 lots (got ${F.lots})`, F.lots === 304);
check(`25 claimable (got ${F.claimable.length})`, F.claimable.length === 25);
check(`18 internal aging (got ${F.aging.length})`, F.aging.length === 18);
check(`no invalid date codes in the sample (got ${F.invalid.length})`, F.invalid.length === 0);
check("every lot lands in exactly one bucket", F.claimable.length + F.aging.length + F.invalid.length + F.ok.length === F.lots
  && new Set([...F.claimable, ...F.aging, ...F.ok, ...F.invalid].map((l) => l.lot_id)).size === F.lots);
check("claimable = age at receipt over the rule", F.claimable.every((c) => c.age_receipt > c.rule - 0.05));
check("internal aging = fresh at receipt, over the rule today", F.aging.every((c) => c.age_receipt <= c.rule + 0.05 && c.age_today > c.rule - 0.05));
check("claim text names lot, part, date code, ages, rule, qty and value", F.claimable.every((c) =>
  [c.lot_id, c.part_number, c.date_code, c.age_receipt.toFixed(1), `${c.rule}-month`, new Intl.NumberFormat("en-US").format(c.qty)].every((s) => c.claim_text.includes(String(s)))
  && (Number.isFinite(c.value) ? c.claim_text.includes("$") : c.claim_text.includes("value pending"))));
const v = (c) => (Number.isFinite(c.value) ? c.value : -1);
check("claims sorted by value, descending; lots without a cost last", F.claimable.every((c, i, a) => !i || v(a[i - 1]) >= v(c)));
check("claims by supplier add up", Math.abs(F.bySupplier.reduce((t, g) => t + g.value, 0) - F.claimValue) < 0.01);

console.log("Policy and bad rows:");
const P2 = clonePolicy(); P2.fresh_grace_months = 6;
const F2 = freshness(lots, suppliers, res.parts, P2);
check("a 6-month grace closes some claims, and they move to internal aging", F2.claimable.length < F.claimable.length
  && F2.claimable.length + F2.aging.length === F.claimable.length + F.aging.length);
const l0 = lots[0];
const bad = [
  { lot_id: "B1", part_number: l0.part_number, supplier: l0.supplier, qty: "10", date_code: "2499", received_date: "2025-01-10" },
  { lot_id: "B2", part_number: l0.part_number, supplier: l0.supplier, qty: "10", date_code: "2650", received_date: "2025-01-10" },
  { lot_id: "B3", part_number: "NOPE-1", supplier: l0.supplier, qty: "10", date_code: "2401", received_date: "2025-01-10" },
  { lot_id: "B4", part_number: l0.part_number, supplier: "Unknown Co", qty: "1,000", date_code: "2001", received_date: "2024-06-01" },
];
const F3 = freshness(bad, suppliers, res.parts, P);
check("invalid week, date code after receipt and unknown part are flagged", F3.invalid.map((l) => l.lot_id).join() === "B1,B2,B3");
check("a supplier without a rule falls back to the Policy default", F3.claimable.length === 1
  && F3.claimable[0].rule === P.fresh_default_rule_months && F3.claimable[0].rule_source === "default");
check("formatted quantities are read (1,000)", F3.claimable[0]?.qty === 1000);

console.log(`\nSample: claimable ${F.claimable.length} lots $${F.claimValue.toFixed(0)}, internal aging ${F.aging.length} lots $${F.agingValue.toFixed(0)}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nAll freshness checks passed");
process.exit(failures ? 1 : 0);
