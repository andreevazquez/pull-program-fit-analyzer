// Checks for js/v2.js: V2_SPEC.md sections 1 (pipeline coverage), 3 (supplier scorecard),
// 4 (MOQ & LT opportunities) and the executive roll-up.
// Usage: node test/v2.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js";
import { insights } from "../js/insights.js?v=24";
import { freshness } from "../js/freshness.js?v=24";
import { pipeline, projectCoverage, scorecard, opportunities, valuePipeline, executive, cashBridge, VALUE_TYPES } from "../js/v2.js?v=24";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), fc = read("data/forecast.csv"), sup = read("data/suppliers.csv"), lots = read("data/inventory_lots.csv");
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

function run(label, tweak) {
  const P = clonePolicy(); tweak?.(P);
  const res = analyze(parts, P), I = insights(res, P), F = freshness(lots, sup, res.parts, P);
  const pipe = pipeline(res.parts, fc, P), score = scorecard(res, sup, F, P), opps = opportunities(res, P);
  const V = valuePipeline({ result: res, insights: I, fresh: F, pipe, score, opps, P }), E = executive({ result: res, insights: I, pipe, score });
  console.log(`${label}:`);

  // 1. Pipeline coverage
  check("every part with a forecast lands in exactly one coverage bucket",
    pipe.escalate.length + pipe.watch.length + pipe.covered.length + pipe.noLeadTime.length === pipe.checked);
  check("escalate = first short week within the lead time", pipe.escalate.every((r) => r.first_short_week <= r.lt && r.proj[r.first_short_week - 1] < 0));
  check("watch = short only after the lead time", pipe.watch.every((r) => r.first_short_week > r.lt && r.proj.slice(0, Math.min(r.lt, 13)).every((v) => v >= 0)));
  check("covered parts never go negative in 13 weeks", pipe.covered.every((r) => r.proj.every((v) => v >= 0)));
  check("escalations sorted by shortage value", pipe.escalate.every((r, i, a) => !i || (a[i - 1].short_value || 0) >= (r.short_value || 0)));
  check("forecast flags use the Policy thresholds", pipe.upside.every((r) => r.fc_ratio > P.fc_upside) && pipe.downside.every((r) => r.fc_ratio < P.fc_downside));

  // 3. Scorecard
  check("supplier spend adds up to annual spend", near(score.rows.reduce((t, g) => t + g.spend, 0), res.summary.annual_spend, 1));
  check("every VMI part without an agreement is flagged", score.noAgreementParts === res.analyzed.filter((p) => p.recommended_program === "VMI" && !score.rows.find((g) => g.supplier === p.supplier).vmi_agreement).length);
  check("open claims on the scorecard match freshness", score.rows.reduce((t, g) => t + g.claimsOpen, 0) === F.claimable.length);

  // 4. Opportunities
  check("MOQ opportunities only where MOQ > N weeks", opps.moq.every((o) => o.part.moq > P.moq_opp_weeks * o.part.avg_weekly && o.value > 0));
  check("MOQ value = (MOQ/2 − avg×R/2) × cost", opps.moq.every((o) => near(o.value, (o.part.moq / 2 - o.part.avg_weekly * o.R / 2) * o.part.unit_cost_usd, 0.001)));
  check("LT opportunities: A or Super A with LT above the threshold", opps.lt.every((o) => (o.part.abc === "A" || o.part.super_a) && o.L > P.lt_opp_min_weeks));
  check("LT cut never increases safety stock", opps.lt.every((o) => o.value >= 0 && o.ss2 <= o.ss));
  check("plant + supplier LT value = total", near(opps.ltPlantValue + opps.ltSupplierValue, opps.ltValue));

  // Executive
  check("turns × DIO = 365", near(E.turns_now * E.dio_now, 365, 1e-6) && near(E.turns_target * E.dio_target, 365, 1e-6));
  check("value pipeline keeps types apart (no grand total)", V.byType.length === VALUE_TYPES.length && !("total" in V));
  check("value pipeline waves = inventory now − target", near(V.lines.slice(0, 3).reduce((t, l) => t + l.value, 0), res.summary.inv_now - res.summary.inv_target, 1));
  // Cash bridge: the three one-time cash figures tie out step by step
  const B = cashBridge(res, I, opps);
  check("bridge: excess + tolerance band = gross release", near(B.excess + B.band, B.gross_release, 0.01) && B.band >= -0.01);
  check("bridge: gross release - build-up = net working capital (inventory now - target)", near(B.gross_release - B.build_up, res.summary.inv_now - res.summary.inv_target, 0.01));
  check("bridge: working capital + MOQ + LT (plant) = value pipeline one-time cash", near(B.pipeline_cash, V.byType.find((t) => t.type === "Cash, one-time").value, 0.01));
  check("bridge: executive working capital is the bridge's net figure", near(E.working_capital, B.working_capital, 0.01));
  return { pipe, score, opps, E, B };
}

const base = run("Default policy");
run("Tighter thresholds", (P) => { P.fc_upside = 1.2; P.fc_downside = 0.8; P.moq_opp_weeks = 2; P.lt_opp_min_weeks = 8; P.lt_cut_weeks = 6; });
run("Consignment off, longer hub warning", (P) => { P.consignment = false; P.hub_warn_months = 12; });

console.log("Spec values and hand checks:");
check(`EDI penetration ≈ 71.9% of spend (got ${(base.score.edi_penetration * 100).toFixed(2)}%)`, Math.abs(base.score.edi_penetration - 0.719) < 0.0005);
check("projection: 100 on hand, PO 50 in week 2, 40/wk → 60, 70, 30, −10", JSON.stringify(projectCoverage(100, [40, 40, 40, 40], 50, 2)) === JSON.stringify([60, 70, 30, -10]));
const P = clonePolicy();
const one = (lt, po, week) => pipeline([{ part_number: "T", lead_time_weeks: lt, on_hand_qty: 100, unit_cost_usd: 2, demand: Array(26).fill(40) }],
  [{ part_number: "T", open_po_qty: po, open_po_due_week: week, ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${String(i + 1).padStart(2, "0")}`, 40])) }], P);
const e = one(4, 0, "");
check("short in week 3 with LT 4 → Escalate, shortage 60 units ($120) inside the LT", e.escalate.length === 1 && e.escalate[0].first_short_week === 3 && e.escalate[0].short_qty === 60 && e.escalate[0].short_value === 120);
const w = one(2, 0, "");
check("short in week 3 with LT 2 → Watch, order by week 1", w.watch.length === 1 && w.watch[0].order_by_week === 1);
check("blank PO week means no PO", one(4, 500, "").escalate.length === 1);
check("Distribuidor Norte hub contract (2027-03-31) ends within 6 months", base.score.hubEnding.some((g) => g.supplier.startsWith("Distribuidor Norte")));

const S = base.pipe, O = base.opps, E = base.E;
console.log(`\nSample: escalate ${S.escalate.length} ($${S.escalateValue.toFixed(0)}, top 3 = ${(S.top3Share * 100).toFixed(0)}%), watch ${S.watch.length}, covered ${S.covered.length}, no LT ${S.noLeadTime.length}, upside ${S.upside.length}, downside ${S.downside.length}`);
console.log(`MOQ ${O.moq.length} parts $${O.moqValue.toFixed(0)}; LT ${O.lt.length} parts $${O.ltValue.toFixed(0)} (plant $${O.ltPlantValue.toFixed(0)}); turns ${E.turns_now.toFixed(1)} → ${E.turns_target.toFixed(1)}, DIO ${E.dio_now.toFixed(0)} → ${E.dio_target.toFixed(0)}`);
check(`sample: 12 escalations, 6 Place PO (got ${S.escalate.length}, ${S.watch.length})`, S.escalate.length === 12 && S.watch.length === 6);
const B = base.B;
console.log(`Cash bridge: excess $${B.excess.toFixed(0)} + band $${B.band.toFixed(0)} = gross $${B.gross_release.toFixed(0)} - build $${B.build_up.toFixed(0)} = WC $${B.working_capital.toFixed(0)} + MOQ/LT $${(B.moq + B.lt_plant).toFixed(0)} = pipeline $${B.pipeline_cash.toFixed(0)}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nAll v2 checks passed");
process.exit(failures ? 1 : 0);
