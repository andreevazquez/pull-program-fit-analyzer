// Checks for js/proposal.js: VMI / CRP proposal drafts per supplier.
// Usage: node test/proposal.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js?v=25";
import { freshness } from "../js/freshness.js?v=25";
import { scorecard, opportunities } from "../js/v2.js?v=25";
import { proposalCandidates, proposal, PROPOSAL_COLUMNS, proposalRow, ASKS } from "../js/proposal.js?v=25";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), sup = read("data/suppliers.csv"), lots = read("data/inventory_lots.csv");
let failures = 0;
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures++; };

function run(label, tweak) {
  const P = clonePolicy(); tweak?.(P);
  const res = analyze(parts, P), F = freshness(lots, sup, res.parts, P), S = scorecard(res, sup, F, P), O = opportunities(res, P);
  console.log(`${label}:`);
  const cands = proposalCandidates(res);
  const pull = res.analyzed.filter((p) => p.recommended_program === "VMI" || p.recommended_program === "CRP");
  check("every VMI/CRP part is in exactly one supplier's proposal", cands.reduce((t, c) => t + c.n, 0) === pull.length);
  check("suppliers ranked by VMI/CRP spend", cands.every((c, i, a) => !i || a[i - 1].spend >= c.spend));
  for (const c of cands) {
    const X = proposal(res, S, O, P, c.supplier);
    const g = S.rows.find((r) => r.supplier === c.supplier);
    const codes = X.asks.map((a) => a.code);
    const tests = [
      ["lines are that supplier's VMI/CRP parts", X.lines.length === c.n && X.lines.every((l) => l.part.supplier === c.supplier && ["VMI", "CRP"].includes(l.program))],
      ["min = safety stock ≤ target ≤ max", X.lines.every((l) => l.min_qty === Math.round(l.part.calc.ss) && l.min_qty <= l.target_qty && l.target_qty <= l.max_qty)],
      ["max = safety stock + one review cycle or the MOQ (or the target when the floor binds)", X.lines.every((l) => l.max_qty === Math.max(Math.round(l.part.calc.ss + Math.max(l.weekly * l.review_weeks, l.part.moq)), l.target_qty))],
      ["VMI agreement asked only when VMI parts and no agreement", codes.includes("vmi_agreement") === (X.vmiN > 0 && !g.vmi_agreement)],
      ["EDI asked only when the supplier has no EDI", codes.includes("edi") === !g.edi],
      ["consignment asked only for VMI parts with consignment on", codes.includes("consignment") === (X.vmiN > 0 && !!P.consignment)],
      ["OTD asked only below the Policy minimum", codes.includes("otd") === (Number.isFinite(g.otd) && g.otd < P.exc_otd_min)],
      ["every ask is a known code", codes.every((k) => ASKS.includes(k))],
      ["CSV rows have one value per column", X.lines.every((l) => proposalRow(l).length === PROPOSAL_COLUMNS.length)],
    ];
    const bad = tests.filter(([, ok]) => !ok);
    if (bad.length) { for (const [name] of bad) check(`${c.supplier}: ${name}`, false); return; }
  }
  check(`all ${cands.length} suppliers: lines, min ≤ target ≤ max, asks match the scorecard, CSV shape`, true);
  return { res, S, O, P, cands };
}

const base = run("Default policy");
const top = proposal(base.res, base.S, base.O, base.P, base.cands[0].supplier);
console.log(`    ${top.supplier}: ${top.lines.length} parts (${top.vmiN} VMI, ${top.crpN} CRP), $${Math.round(top.annual_spend).toLocaleString("en-US")}/yr, asks: ${top.asks.map((a) => a.code).join(", ")}`);
const off = run("Consignment off", (P) => { P.consignment = false; });
check("consignment off: no consignment ask and no consignment value", off.cands.every((c) => { const X = proposal(off.res, off.S, off.O, off.P, c.supplier); return !X.asks.some((a) => a.code === "consignment") && X.consignment_value === 0; }));
run("VMI at 4+ weeks lead time", (P) => { P.vmi_lt_ax = 4; P.vmi_lt_ay = 4; });

console.log(failures ? `\n${failures} check(s) failed` : "\nAll proposal checks passed");
process.exit(failures ? 1 : 0);
