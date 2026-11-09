// Runs js/segment.js on sample_parts.csv with the default policy and compares every
// per-part value against reference/expected_results.csv, plus the CLAUDE.md acceptance totals.
// Usage: node test/check.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, resultRow, RESULT_COLUMNS, DEFAULT_POLICY } from "../js/segment.js";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const input = parseCSV(readFileSync(join(root, "data", "sample_parts.csv"), "utf8"));
const expected = parseCSV(readFileSync(join(root, "reference", "expected_results.csv"), "utf8"));
const res = analyze(input, DEFAULT_POLICY);
const got = new Map(res.parts.map((p) => [p.part_number, resultRow(p)]));

let failures = 0, checked = 0;
const fail = (msg) => { failures++; if (failures <= 40) console.log("  FAIL", msg); };

if (expected.length !== res.parts.length) fail(`row count: expected ${expected.length}, got ${res.parts.length}`);

for (const e of expected) {
  const g = got.get(e.part_number);
  if (!g) { fail(`${e.part_number}: missing`); continue; }
  for (const c of RESULT_COLUMNS) {
    checked++;
    const ev = e[c], gv = g[c];
    const en = Number(ev), gn = Number(gv);
    if (ev !== "" && gv !== "" && Number.isFinite(en) && Number.isFinite(gn)) {
      if (Math.abs(en - gn) > 1e-6 * Math.max(1, Math.abs(en))) fail(`${e.part_number}.${c}: expected ${ev}, got ${gv}`);
    } else if (String(ev) !== String(gv)) fail(`${e.part_number}.${c}: expected "${ev}", got "${gv}"`);
  }
}

// Acceptance totals from CLAUDE.md
const S = res.summary;
const m = (k) => S.matrix[k].count;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const acceptance = [
  ["parts 150", S.parts === 150],
  ["analyzable 143", S.analyzed === 143],
  ["blocked 7", S.blocked === 7],
  ["with any issue 9", S.with_issue === 9],
  ["A X/Y/Z 18/7/3", m("AX") === 18 && m("AY") === 7 && m("AZ") === 3],
  ["B X/Y/Z 28/4/11", m("BX") === 28 && m("BY") === 4 && m("BZ") === 11],
  ["C X/Y/Z 51/9/12", m("CX") === 51 && m("CY") === 9 && m("CZ") === 12],
  ["Super A 8", S.super_a === 8],
  ["Trend Flat 126 / Declining 9 / Ramp 8", S.trend.Flat === 126 && S.trend.Declining === 9 && S.trend.Ramp === 8],
  ["Recommended Kanban 70 / MRP 43 / VMI 19 / CRP 11",
    S.recommended.Kanban === 70 && S.recommended.MRP === 43 && S.recommended.VMI === 19 && S.recommended.CRP === 11],
  ["program changes 106", S.program_changes === 106],
  ["annual spend ≈ 34,652,985", near(S.annual_spend, 34652985)],
  ["inventory now ≈ 4,737,299", near(S.inv_now, 4737299)],
  ["inventory target ≈ 2,466,113", near(S.inv_target, 2466113)],
  ["excess ≈ 2,664,467", near(S.excess, 2664467)],
  ["consignment transfer ≈ 838,601", near(S.consignment, 838601)],
];
console.log("Acceptance:");
for (const [label, ok] of acceptance) { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; }

console.log(`Per-part: ${checked} values checked across ${expected.length} parts.`);
console.log(`Totals: spend ${S.annual_spend.toFixed(0)} | inv now ${S.inv_now.toFixed(0)} | target ${S.inv_target.toFixed(0)} | excess ${S.excess.toFixed(0)} | consignment ${S.consignment.toFixed(0)}`);
console.log(failures ? `FAILED (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
