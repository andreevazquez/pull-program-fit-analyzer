// Unit tests for the policy engine (js/segment.js): classification and sizing rules on hand-built parts,
// so each rule is checked in isolation and at its boundaries. Rules: docs/METHODOLOGY.md.
// Usage: node test/policy.mjs   (exit code 0 = pass)
import { analyze, recommend, clonePolicy, DEFAULT_POLICY } from "../js/segment.js";

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const section = (t) => console.log(t);

const W = Array.from({ length: 26 }, (_, i) => "w" + String(i + 1).padStart(2, "0"));
// demand: number (flat), or array of 26 values
const part = (pn, o = {}) => {
  const d = Array.isArray(o.demand) ? o.demand : Array(26).fill(o.demand ?? 100);
  return {
    part_number: pn, description: "", commodity: "C", manufacturer: "M", supplier: o.supplier ?? "S",
    unit_cost_usd: String(o.cost ?? 1), lead_time_weeks: o.lt === undefined ? "10" : String(o.lt), moq: String(o.moq ?? 0),
    current_program: o.prog ?? "MRP", on_hand_qty: String(o.onHand ?? 0),
    ...Object.fromEntries(W.map((w, i) => [w, String(d[i])])),
  };
};
const one = (o, P) => analyze([part("P", o)], P).parts[0];
const byPn = (res) => Object.fromEntries(res.parts.map((p) => [p.part_number, p]));

/* ---------- ABC by annual spend ---------- */
section("ABC and Super A (cumulative share before the part)");
{
  // spends 80 / 15 / 5: cumulative-before 0, 0.80, 0.95 → exactly on the cutoffs
  const r = byPn(analyze([part("a", { cost: 80 }), part("b", { cost: 15 }), part("c", { cost: 5 })]));
  check("first part: cumulative-before 0 → A and Super A", r.a.abc === "A" && r.a.super_a && r.a.cum_before === 0);
  check("cumulative-before exactly 80% → B (A is strictly below the cutoff)", near(r.b.cum_before, 0.8) && r.b.abc === "B" && !r.b.super_a);
  check("cumulative-before exactly 95% → C", near(r.c.cum_before, 0.95) && r.c.abc === "C");
  check("annual spend = avg weekly × 52 × unit cost", near(r.a.annual_spend, 100 * 52 * 80));
  const r2 = byPn(analyze([part("a", { cost: 40 }), part("b", { cost: 35 }), part("c", { cost: 25 })]));
  check("Super A = cumulative-before < 50%: 0% and 40% yes, 75% no", r2.a.super_a && r2.b.super_a && !r2.c.super_a);
  const P = clonePolicy(); P.abc_a = 0.85;
  check("Policy: A cutoff 85% moves the 80% part into A", byPn(analyze([part("a", { cost: 80 }), part("b", { cost: 15 }), part("c", { cost: 5 })], P)).b.abc === "A");
}

/* ---------- XYZ ---------- */
section("XYZ by coefficient of variation and zero share");
{
  const alt = (lo, hi) => W.map((_, i) => (i % 2 ? hi : lo));
  check("flat demand: CV 0 → X", one({ demand: 100 }).xyz === "X");
  const y = one({ demand: alt(50, 150) });
  check("CV exactly 0.5 (population sd) → Y", near(y.cv, 0.5) && y.xyz === "Y");
  const x = one({ demand: alt(51, 149) });
  check("CV just under 0.5 → X", x.cv < 0.5 && x.xyz === "X");
  const spike = one({ demand: W.map((_, i) => (i === 0 ? 2000 : 10)) });
  check("CV ≥ 1.0 with no zero weeks → Z", spike.zero_share === 0 && spike.cv >= 1 && spike.xyz === "Z");
  const z7 = one({ demand: W.map((_, i) => (i < 7 ? 0 : 100)) }), z8 = one({ demand: W.map((_, i) => (i < 8 ? 0 : 100)) });
  check("7 zero weeks of 26 (26.9%) is not Z by zero share", near(z7.zero_share, 7 / 26) && z7.xyz === "Y");
  check("8 zero weeks of 26 (30.8%) → Z", z8.zero_share > 0.3 && z8.xyz === "Z");
  const P = clonePolicy(); P.cv_x = 0.6;
  check("Policy: X cutoff 0.6 turns the CV 0.5 part into X", one({ demand: alt(50, 150) }, P).xyz === "X");
}

/* ---------- Trend ---------- */
section("Trend: mean of the last 8 weeks vs the first 8");
{
  const shape = (first, last) => W.map((_, i) => (i < 8 ? first : i >= 18 ? last : 100));
  const up = one({ demand: shape(100, 151) }), flatHi = one({ demand: shape(100, 150) });
  check("last/first 1.51 → Ramp", up.trend === "Ramp");
  check("last/first exactly 1.5 → Flat (Ramp is strictly above)", flatHi.trend === "Flat");
  check("last/first 0.49 → Declining", one({ demand: shape(100, 49) }).trend === "Declining");
  check("last/first exactly 0.5 → Flat", one({ demand: shape(100, 50) }).trend === "Flat");
  const sparse = one({ demand: W.map((_, i) => (i < 8 ? 100 : i % 2 ? 0 : 100)) });
  check("trend is not evaluated above 30% zero weeks (stays Flat)", sparse.zero_share > 0.3 && sparse.trend === "Flat");
  const P = clonePolicy(); P.trend_up = 1.4;
  check("Policy: Ramp threshold 1.4 catches a 1.45× part", one({ demand: shape(100, 145) }, P).trend === "Ramp");
}

/* ---------- Program assignment ---------- */
section("Program assignment (trend overrides the ABC × XYZ matrix)");
{
  const P = DEFAULT_POLICY;
  const rec = (abc, xyz, lt = 10, cost = 5, trend = "Flat") => recommend({ abc, xyz, lead_time_weeks: lt, unit_cost_usd: cost, trend }, P)[0];
  check("Ramp → MRP whatever the class", rec("A", "X", 20, 5, "Ramp") === "MRP");
  check("Declining → MRP whatever the class", rec("C", "X", 2, 0.1, "Declining") === "MRP");
  check("AX with LT 8 weeks → VMI; LT 7.9 → CRP", rec("A", "X", 8) === "VMI" && rec("A", "X", 7.9) === "CRP");
  check("AY with LT 12 weeks → VMI; LT 11 → CRP", rec("A", "Y", 12) === "VMI" && rec("A", "Y", 11) === "CRP");
  check("BX under $1 → Kanban; exactly $1 → CRP", rec("B", "X", 10, 0.99) === "Kanban" && rec("B", "X", 10, 1) === "CRP");
  check("BY → CRP", rec("B", "Y") === "CRP");
  check("CX and CY → Kanban", rec("C", "X") === "Kanban" && rec("C", "Y") === "Kanban");
  check("AZ, BZ, CZ → MRP", ["A", "B", "C"].every((a) => rec(a, "Z") === "MRP"));
  check("every recommendation carries a reason", recommend({ abc: "A", xyz: "X", lead_time_weeks: 9, unit_cost_usd: 1, trend: "Flat" }, P)[1].length > 10);
  const Q = clonePolicy(); Q.vmi_lt_ax = 12; Q.kanban_max_cost = 2;
  check("Policy: VMI LT 12 and Kanban cap $2 move the boundaries", recommend({ abc: "A", xyz: "X", lead_time_weeks: 10, unit_cost_usd: 5, trend: "Flat" }, Q)[0] === "CRP"
    && recommend({ abc: "B", xyz: "X", lead_time_weeks: 10, unit_cost_usd: 1.5, trend: "Flat" }, Q)[0] === "Kanban");
}

/* ---------- Target sizing ---------- */
section("Target inventory: safety + cycle, with a days-of-supply floor");
{
  // One part = 100% of spend → A, Super A. Flat demand → X; LT 10 ≥ 8 → VMI (R 1, L 2, floor 14 days).
  const v = one({ demand: 100, lt: 10, cost: 2, onHand: 1000 });
  check("flat A part with LT 10 → VMI, R 1, L 2, z 1.65", v.recommended_program === "VMI" && v.calc.R === 1 && v.calc.L === 2 && v.calc.z === 1.65);
  check("sd 0 → safety stock 0", v.calc.ss === 0);
  check("cycle = max(avg × R, MOQ) / 2 = 50", v.calc.cycle === 50);
  check("floor binds: 14 days × 100/7 = 200 > 0 + 50", v.calc.floorBinds && v.target_qty === 200);
  check("DOS now = on hand ÷ (avg / 7) = 70 days; target 14 days", v.dos_current === 70 && v.dos_target === 14);
  check("excess = max(0, 1000 − 200 × 1.20) × $2 = $1,520", v.excess_value === 1520);
  check("consignment = max(0, 200 − 2 days × 100/7) × $2", near(v.consignment_transfer_value, Math.round((200 - (2 * 100) / 7) * 2 * 100) / 100));
  const m = one({ demand: 100, lt: 10, moq: 1000 });
  check("MOQ 1,000 sets the cycle stock: 500, above the floor", m.calc.cycle === 500 && m.target_qty === 500 && !m.calc.floorBinds);

  // Variable demand: safety = z × sd × √(R + L)
  const d = W.map((_, i) => (i % 2 ? 140 : 60));
  const y = one({ demand: d, lt: 10 });
  check("safety = z × sd × √(R + L) with the population sd", near(y.calc.ss, 1.65 * y.sd_weekly * Math.sqrt(1 + 2)) && near(y.sd_weekly, 40));
  check("target = max(safety + cycle, floor), rounded to a unit", y.target_qty === Math.round(Math.max(y.calc.ss + y.calc.cycle, y.calc.floorQty)));

  // MRP: exposure is the part's own lead time, R 2, floor 21 days
  const ramp = one({ demand: W.map((_, i) => (i < 8 ? 100 : i >= 18 ? 200 : 150)), lt: 16 });
  check("MRP (Ramp) uses R 2, L = lead time 16, floor 21 days", ramp.recommended_program === "MRP" && ramp.calc.R === 2 && ramp.calc.L === 16 && ramp.calc.floorDays === 21);
  const k = byPn(analyze([part("big", { cost: 100 }), part("tail", { cost: 1 })])).tail;
  check("C part uses z 2.05; Kanban R 2, L 2, floor 21 days", k.abc === "C" && k.calc.z === 2.05 && k.recommended_program === "Kanban" && k.calc.R === 2 && k.calc.L === 2 && k.calc.floorDays === 21);

  const P = clonePolicy(); P.tolerance = 1.5; P.consignment = false; P.floor_days.VMI = 7;
  const q = one({ demand: 100, lt: 10, cost: 2, onHand: 1000 }, P);
  check("Policy: floor 7 days, tolerance 1.5, consignment off", q.target_qty === 100 && q.excess_value === (1000 - 150) * 2 && q.consignment_transfer_value === 0);
}

/* ---------- Data integrity ---------- */
section("Data integrity: three blockers and a warning");
{
  const r = byPn(analyze([
    part("ok", {}), part("noLT", { lt: "" }), part("zero", { cost: 0 }), part("blank", { cost: "" }),
    part("nodemand", { demand: 0 }), part("moq", { moq: 900 }),
  ]));
  check("missing lead time blocks", r.noLT.blocking && !r.noLT.analyzed && r.noLT.issues.includes("Missing lead time"));
  check("cost 0 blocks; blank cost blocks", r.zero.blocking && r.blank.blocking);
  check("no demand in 26 weeks blocks", r.nodemand.blocking && r.nodemand.issues.includes("No demand in 26 wks"));
  check("MOQ above 8 weeks of demand warns but is analyzed", !r.moq.blocking && r.moq.analyzed && r.moq.issues.some((s) => s.startsWith("MOQ >")));
  check("blocked parts are left out of the spend ranking", analyze([part("ok", {}), part("noLT", { lt: "" })]).summary.analyzed === 1);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll policy engine checks passed");
process.exit(failures ? 1 : 0);
