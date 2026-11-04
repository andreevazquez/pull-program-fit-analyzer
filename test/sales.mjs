// Invariant checks for js/sales.js (Sales view). No Python reference exists, so the test asserts
// the accounting identity behind the view on the sample and under policy changes:
//   sell-in = sell-through − stock drawdown + stock build-up
// Usage: node test/sales.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js";
import { sellIn, projectPart } from "../js/sales.js?v=11";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = parseCSV(readFileSync(join(root, "sample_parts.csv"), "utf8"));
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const sum = (a) => a.reduce((t, x) => t + x, 0);

function run(label, tweak) {
  const P = clonePolicy(); tweak?.(P);
  const res = analyze(rows, P), X = sellIn(res, P), T = X.totals;
  console.log(`${label}:`);
  check("sell-through run-rate = annual spend / 52", near(T.through_week * 52, res.summary.annual_spend, 1));
  check("sell-in − sell-through over the horizon = build-up − drawdown", near(T.sellin_h - T.through_h, T.build - T.dip, 1));
  check("suppliers add up to the totals", near(sum(X.suppliers.map((g) => g.net)), T.net, 1)
    && near(sum(X.suppliers.map((g) => g.through_annual)), res.summary.annual_spend, 1));
  check("weekly sell-in is never negative", X.sellin.every((v) => v >= -1e-9));
  check("supplier inventory adds up to inventory now", near(sum(X.suppliers.map((g) => g.inv_now)), res.summary.inv_now, 1));
  const fullBurn = res.analyzed.every((p) => projectPart(p, X.D, X.H).weeks_to_target <= X.H);
  check("when every excess clears inside the horizon, drawdown = inventory above target",
    !fullBurn || near(T.dip, res.analyzed.reduce((t, p) => t + Math.max(0, p.on_hand_qty - p.target_qty) * p.unit_cost_usd, 0), 1));
  check("history has one value per input week", X.history.length === res.weeks.length);
  check("consignment matches the summary when on, 0 when off", near(T.consignment, P.consignment ? res.summary.consignment : 0, 0.01));
  return { res, X };
}

const base = run("Default policy");
run("Faster destock (4 weeks)", (P) => { P.destock_weeks = 4; });
run("Short horizon (8 weeks), consignment off", (P) => { P.sales_horizon_weeks = 8; P.consignment = false; });
run("Tighter excess tolerance", (P) => { P.tolerance = 1.0; P.z.C = 1.65; });

// Hand-checked single part: 100/wk consumption, 700 on hand, target 400, 4-week destock.
console.log("Single part by hand:");
const pr = projectPart({ avg_weekly: 100, on_hand_qty: 700, target_qty: 400 }, 4, 6);
check("burns 75/wk for 4 weeks, then back to run-rate", JSON.stringify(pr.units) === JSON.stringify([25, 25, 25, 25, 100, 100]));
const pr2 = projectPart({ avg_weekly: 100, on_hand_qty: 1000, target_qty: 200 }, 4, 10);
check("excess faster than consumption stops sell-in and takes longer", pr2.units.slice(0, 8).every((u) => u === 0) && pr2.units[8] === 100 && pr2.weeks_to_target === 8);
const pr3 = projectPart({ avg_weekly: 100, on_hand_qty: 100, target_qty: 300 }, 4, 6);
check("shortfall builds up at under/D on top of run-rate", JSON.stringify(pr3.units) === JSON.stringify([150, 150, 150, 150, 100, 100]));

const T = base.X.totals;
console.log(`\nSample: sell-through ${(T.through_week).toFixed(0)}/wk, cover ${T.cover_now.toFixed(1)} → ${T.cover_target.toFixed(1)} wks, first ${base.X.D} wks ${(T.dip_window_pct * 100).toFixed(1)}%, recover wk ${T.recover_week}, dip ${T.dip.toFixed(0)}, build ${T.build.toFixed(0)}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nAll sales checks passed");
process.exit(failures ? 1 : 0);
