// Checks for js/exceptions.js: the exceptions inbox (docs/specs/V3_SPEC.md).
// Usage: node test/exceptions.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js";
import { insights } from "../js/insights.js?v=25";
import { freshness } from "../js/freshness.js?v=25";
import { pipeline, scorecard } from "../js/v2.js?v=25";
import { exceptions, severityOf, EXC_TYPES, VALUE_KINDS, SEVERITIES } from "../js/exceptions.js?v=25";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), fc = read("data/forecast.csv"), sup = read("data/suppliers.csv"), lots = read("data/inventory_lots.csv"), events = read("data/supply_events.csv");
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };

function run(label, tweak, statusOf, claimStatus) {
  const P = clonePolicy(); tweak?.(P);
  const res = analyze(parts, P), I = insights(res, P), F = freshness(lots, sup, res.parts, P);
  const pipe = pipeline(res.parts, fc, P), score = scorecard(res, sup, F, P);
  const X = exceptions({ result: res, insights: I, pipe, fresh: F, score, events, P, statusOf, claimStatus });
  console.log(`${label}:`);
  const n = (t) => X.items.filter((x) => x.type === t).length;
  check("one shortage exception per pipeline escalation", n("shortage") === pipe.escalate.length);
  check("one Place PO exception per pipeline watch", n("po") === pipe.watch.length);
  check("one below-safety exception per critical part", n("safety") === I.critical.length);
  check("one freshness exception per claimable lot", n("claim") === F.claimable.length);
  check("every item has a known type, severity, owner and SLA", X.items.every((x) => EXC_TYPES[x.type] && SEVERITIES[x.sev] === x.severity && ["Planner", "Manager"].includes(x.owner) && x.sla >= 0));
  check("value kinds come from the list; no grand total", X.items.every((x) => x.kind === null || VALUE_KINDS.includes(x.kind)) && !("total" in X) && X.byKind.length === VALUE_KINDS.length);
  check("ids are unique", new Set(X.items.map((x) => x.id)).size === X.items.length);
  check("sorted: severity, then past SLA, then value", X.items.every((x, i, a) => !i || a[i - 1].sev < x.sev || (a[i - 1].sev === x.sev && (a[i - 1].pastSla > x.pastSla || (a[i - 1].pastSla === x.pastSla && a[i - 1].value >= x.value)))));
  check("past SLA = open and older than the SLA", X.items.every((x) => x.pastSla === (x.open && x.age > x.sla)));
  check("escalation ladder: manager past SLA → Executive; planner → Manager, or Executive past 2× SLA",
    X.items.every((x) => !x.pastSla ? !x.escalatedTo : x.escalatedTo === (x.owner === "Manager" || x.age > 2 * x.sla ? "Executive" : "Manager")));
  check("executive list = escalated to Executive, or critical with the manager", X.executive.every((x) => x.open && (x.escalatedTo === "Executive" || (x.sev === 0 && x.owner === "Manager"))));
  check("open by kind adds up item by item", X.byKind.every((k) => Math.abs(k.value - X.open.filter((x) => x.kind === k.kind).reduce((t, x) => t + x.value, 0)) < 1e-6));
  return { X, P, pipe };
}

const base = run("Default policy").X;
const tight = run("Price threshold 16%, LT jump 1 week", (P) => { P.exc_price_pct = 0.16; P.exc_lt_jump_weeks = 1; }).X;
const done = run("With statuses", null, (id) => (id === "ev:EV-018" ? { status: "Resolved", resolution: "PO pulled in" } : id === "ev:EV-001" ? { status: "In progress" } : null),
  (c) => "Closed").X;

console.log("Spec values and hand checks:");
check(`sample: 157 exceptions, 11 critical, 18 past SLA (got ${base.items.length}, ${base.counts.Critical}, ${base.pastSla.length})`, base.items.length === 157 && base.counts.Critical === 11 && base.pastSla.length === 18);
check("events: 32 rows, 29 valid, 3 invalid (EV-030 unknown part, EV-031 bad date, EV-032 unknown type)",
  base.events.total === 32 && base.events.valid === 29 && base.events.invalid.map((e) => e.row.event_id).join() === "EV-030,EV-031,EV-032");
check("below threshold, logged but not raised: EV-015 (8% price), EV-020 (+2 weeks LT)", base.events.belowThreshold.map((e) => e.id).join() === "EV-015,EV-020");
check("Policy moves the thresholds: price 16% keeps only EV-016; LT +1 week raises EV-020",
  tight.items.filter((x) => x.type === "price").map((x) => x.id).join() === "ev:EV-016" && tight.items.some((x) => x.id === "ev:EV-020"));
const get = (id) => base.items.find((x) => x.id === id);
check("allocation EV-006: 70% of a 23,600 PO adds 7,080 units short", /7,080 more units short/.test(get("ev:EV-006").detail) && get("ev:EV-006").kind === "Supply at risk");
check("tariff EV-010: 25% of FX-POW-1791 spend per year", Math.abs(get("ev:EV-010").value - 0.25 * 1987383) < 5 && get("ev:EV-010").kind === "Cost increase / yr");
check("EOL EV-001: last order inside the lead time and > $100k → Critical", get("ev:EV-001").severity === "Critical" && get("ev:EV-001").wti <= get("ev:EV-001").lt);
check("delay that keeps the part covered → Low, no value", get("ev:EV-025").severity === "Low" && get("ev:EV-025").value === 0);
check("resolved items leave the open list; In progress stays open", !done.open.some((x) => x.id === "ev:EV-018") && done.open.some((x) => x.id === "ev:EV-001") && done.items.find((x) => x.id === "ev:EV-018").resolution === "PO pulled in");
check("freshness exceptions follow the claim status (Closed → Resolved, locked)", done.items.filter((x) => x.type === "claim").every((x) => x.status === "Resolved" && x.locked));

const P = clonePolicy();
const sev = (o) => SEVERITIES[severityOf(o, P)];
check("severity: supply hit within 2 weeks → Critical", sev({ value: 500, wti: 1, lt: 10, kind: "Supply at risk" }) === "Critical");
check("severity: inside LT and ≥ $100k → Critical; inside LT and small → High", sev({ value: 2e5, wti: 6, lt: 10, kind: "Supply at risk" }) === "Critical" && sev({ value: 5e3, wti: 6, lt: 10, kind: "Supply at risk" }) === "High");
check("severity: after LT, small → Medium; no money → Low", sev({ value: 5e3, wti: 12, lt: 10, kind: "Supply at risk" }) === "Medium" && sev({ value: 0, wti: null, lt: 10, kind: null }) === "Low");
check("severity: cost increases ignore urgency (≥ $100k/yr → High, never Critical)", sev({ value: 5e5, wti: 0, lt: 10, kind: "Cost increase / yr" }) === "High");
check("cap: Place PO is at most High", sev({ value: 5e5, wti: 1, lt: 0, kind: "Supply at risk", cap: 1 }) === "High");

console.log(`\nSample: ${base.items.length} exceptions (${Object.entries(base.counts).map(([k, v]) => `${k} ${v}`).join(", ")}), past SLA ${base.pastSla.length}, for a director ${base.executive.length}, repeat parts ${base.repeatParts.length}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nAll exception checks passed");
process.exit(failures ? 1 : 0);
