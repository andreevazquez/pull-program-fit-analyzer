// Pull Program Fit Analyzer: segmentation logic.
// Port of reference/segment.py. If this file and the Python disagree, the Python wins.
// Pure functions, no DOM and no dependencies, so the same module runs in the browser and in Node tests.

import { INSIGHT_DEFAULTS } from "./insights.js?v=24";
import { SALES_DEFAULTS } from "./sales.js?v=24";
import { FRESHNESS_DEFAULTS } from "./freshness.js?v=24";
import { V2_DEFAULTS } from "./v2.js?v=24";
import { EXC_DEFAULTS } from "./exceptions.js?v=24";

export const PROGRAMS = ["VMI", "CRP", "Kanban", "MRP"];

export const DEFAULT_POLICY = Object.freeze({
  abc_a: 0.80, abc_b: 0.95, super_a: 0.50,
  cv_x: 0.5, cv_y: 1.0, zero_share_z: 0.30,
  trend_up: 1.5, trend_down: 0.5, trend_weeks: 8,
  vmi_lt_ax: 8, vmi_lt_ay: 12, kanban_max_cost: 1.0,
  z: { A: 1.65, B: 1.65, C: 2.05 },
  review: { VMI: 1, CRP: 1, Kanban: 2, MRP: 2 },
  exposure: { VMI: 2, CRP: 2, Kanban: 2, MRP: null }, // null = part lead time
  floor_days: { VMI: 14, CRP: 14, Kanban: 21, MRP: 21 },
  tolerance: 1.20,
  moq_weeks_flag: 8, consignment: true, lineside_days: 2,
  // Extensions for the director views (js/insights.js). Not in segment.py; they never change its outputs.
  ...INSIGHT_DEFAULTS,
  ...SALES_DEFAULTS,
  ...FRESHNESS_DEFAULTS,
  ...V2_DEFAULTS,
  ...EXC_DEFAULTS,
});

export const clonePolicy = (p = DEFAULT_POLICY) => JSON.parse(JSON.stringify(p));

// numpy-compatible rounding: rint(x * 10^d) / 10^d with round-half-to-even.
function rint(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
export function npRound(x, d = 0) {
  if (!Number.isFinite(x)) return x;
  const m = 10 ** d;
  return rint(x * m) / m;
}

const num = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  // Tolerate spreadsheet formatting: thousands separators, currency signs, spaces.
  const s = String(v).trim().replace(/[\s,$]/g, "");
  return s === "" ? NaN : Number(s);
};

// Map "kanban", "VMI/SMI", " mrp " etc. to the canonical program names; unknown values pass through.
const PROGRAM_ALIASES = { vmi: "VMI", smi: "VMI", "vmi/smi": "VMI", crp: "CRP", kanban: "Kanban", mrp: "MRP" };
const normProgram = (v) => { const s = String(v ?? "").trim(); return PROGRAM_ALIASES[s.toLowerCase()] ?? s; };

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function weekColumns(fields) {
  return fields.filter((c) => /^w\d+$/.test(c)).sort((a, b) => +a.slice(1) - +b.slice(1));
}

// rows: array of objects keyed by CSV header (string or number values).
export function analyze(rows, policy = DEFAULT_POLICY) {
  const P = policy;
  if (!rows.length) return emptyResult();
  const wk = weekColumns(Object.keys(rows[0]));
  const nT = Math.max(1, Math.min(Math.round(P.trend_weeks), wk.length));

  const parts = rows.map((r, idx) => {
    const demand = wk.map((c) => { const v = num(r[c]); return Number.isFinite(v) ? v : 0; });
    const avg = mean(demand);
    const sd = Math.sqrt(mean(demand.map((x) => (x - avg) ** 2)));
    const cost = num(r.unit_cost_usd);
    const lt = num(r.lead_time_weeks);
    const moq = num(r.moq) || 0;
    const onHand = num(r.on_hand_qty) || 0;
    const p = {
      idx,
      part_number: String(r.part_number ?? "").trim(),
      description: r.description ?? "", commodity: r.commodity ?? "",
      manufacturer: r.manufacturer ?? "", supplier: r.supplier ?? "",
      unit_cost_usd: cost, lead_time_weeks: lt, moq, on_hand_qty: onHand,
      current_program: normProgram(r.current_program),
      demand, avg_weekly: avg, sd_weekly: sd,
      cv: avg > 0 ? sd / avg : NaN,
      zero_share: demand.filter((x) => x === 0).length / demand.length,
      issues: [], blocking: false, analyzed: false,
    };
    if (!Number.isFinite(lt)) p.issues.push("Missing lead time");
    // Python: cost <= 0 (a blank cost reads as NaN there and is not caught); we also block blanks.
    if (!(cost > 0)) p.issues.push("Zero/blank cost");
    if (avg === 0) p.issues.push("No demand in 26 wks");
    p.blocking = p.issues.length > 0;
    if (avg > 0 && moq > P.moq_weeks_flag * avg) p.issues.push(`MOQ > ${P.moq_weeks_flag} wks of demand`);
    return p;
  });
  // Duplicate part numbers would collide in the drawer, filters and export: warn (not in segment.py).
  const seen = new Map();
  for (const p of parts) seen.set(p.part_number, (seen.get(p.part_number) || 0) + 1);
  for (const p of parts) {
    if (seen.get(p.part_number) > 1) p.issues.push("Duplicate part number");
    p.data_issues = p.issues.join("; ");
  }

  const s = parts.filter((p) => !p.blocking);
  s.forEach((p) => { p.annual_spend = p.avg_weekly * 52 * p.unit_cost_usd; });
  const sorted = [...s].sort((a, b) => b.annual_spend - a.annual_spend);
  const total = sorted.reduce((t, p) => t + p.annual_spend, 0);
  let cum = 0;
  sorted.forEach((p, i) => {
    cum += p.annual_spend;
    p.cum_before = (cum - p.annual_spend) / total;
    p.spend_rank = i + 1;
  });

  for (const p of s) {
    p.analyzed = true;
    p.abc = p.cum_before < P.abc_a ? "A" : p.cum_before < P.abc_b ? "B" : "C";
    p.super_a = p.cum_before < P.super_a;
    p.xyz = (p.zero_share > P.zero_share_z || p.cv >= P.cv_y) ? "Z" : p.cv >= P.cv_x ? "Y" : "X";
    p.trend_first = mean(p.demand.slice(0, nT));
    p.trend_last = mean(p.demand.slice(-nT));
    const trendOk = p.zero_share <= P.zero_share_z;
    p.trend = trendOk && p.trend_last > P.trend_up * p.trend_first ? "Ramp"
      : trendOk && p.trend_last < P.trend_down * p.trend_first ? "Declining" : "Flat";
    [p.recommended_program, p.reason] = recommend(p, P);
    computeTarget(p, P);
    p.program_change = p.recommended_program !== p.current_program;
  }

  return { parts, analyzed: s, weeks: wk, summary: summarize(parts, s) };
}

export function recommend(r, P) {
  if (r.trend === "Ramp") return ["MRP", "Ramp-up: demand not stable yet, keep in MRP and revisit"];
  if (r.trend === "Declining") return ["MRP", "Declining/EOL risk: don't commit a supplier to buffer it"];
  const k = r.abc + r.xyz;
  if (k === "AX") return r.lead_time_weeks >= P.vmi_lt_ax ? ["VMI", "High spend, stable demand, long LT"] : ["CRP", "High spend, stable, short LT"];
  if (k === "AY") return r.lead_time_weeks >= P.vmi_lt_ay ? ["VMI", `High spend, moderate variability, LT >= ${P.vmi_lt_ay} wks`] : ["CRP", "High spend, moderate variability"];
  if (k === "BX") return r.unit_cost_usd < P.kanban_max_cost ? ["Kanban", "Mid spend, stable, low unit cost"] : ["CRP", "Mid spend, stable, higher unit cost"];
  if (k === "BY") return ["CRP", "Mid spend, moderate variability"];
  if (k === "CX" || k === "CY") return ["Kanban", "Low spend: simplest control, two-bin"];
  return ["MRP", "Erratic/intermittent demand: pull would hide risk"];
}

function computeTarget(p, P) {
  const prog = p.recommended_program;
  const R = P.review[prog];
  const L = P.exposure[prog] || p.lead_time_weeks; // mirrors Python `or`
  const z = P.z[p.abc];
  const ss = z * p.sd_weekly * Math.sqrt(R + L);
  const cycleBase = Math.max(p.avg_weekly * R, p.moq);
  const cycle = cycleBase / 2;
  const floorQty = P.floor_days[prog] * p.avg_weekly / 7;
  const raw = Math.max(ss + cycle, floorQty);
  const daily = p.avg_weekly / 7;
  const target = npRound(raw, 0);
  p.calc = { R, L, z, ss, cycleBase, cycle, floorDays: P.floor_days[prog], floorQty, raw, floorBinds: floorQty > ss + cycle, daily };
  p.target_qty = target;
  p.dos_current = npRound(p.on_hand_qty / daily, 1);
  p.dos_target = npRound(target / daily, 1);
  p.inv_value_current = npRound(p.on_hand_qty * p.unit_cost_usd, 2);
  p.inv_value_target = npRound(target * p.unit_cost_usd, 2);
  p.excess_threshold = target * P.tolerance;
  p.excess_value = npRound(Math.max(0, p.on_hand_qty - p.excess_threshold) * p.unit_cost_usd, 2);
  p.consignment_transfer_value = prog === "VMI" && P.consignment
    ? npRound(Math.max(0, target - daily * P.lineside_days) * p.unit_cost_usd, 2) : 0;
}

const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

function summarize(parts, s) {
  const count = (key) => s.reduce((m, p) => ((m[p[key]] = (m[p[key]] || 0) + 1), m), {});
  const matrix = {};
  for (const a of "ABC") for (const x of "XYZ") matrix[a + x] = { count: 0, spend: 0, programs: {} };
  for (const p of s) {
    const c = matrix[p.abc + p.xyz];
    c.count++; c.spend += p.annual_spend;
    c.programs[p.recommended_program] = (c.programs[p.recommended_program] || 0) + 1;
  }
  const spend = sum(s, (p) => p.annual_spend);
  const pull = (key) => sum(s.filter((p) => p[key] !== "MRP"), (p) => p.annual_spend);
  return {
    parts: parts.length,
    analyzed: s.length,
    blocked: parts.filter((p) => p.blocking).length,
    with_issue: parts.filter((p) => p.issues.length).length,
    super_a: s.filter((p) => p.super_a).length,
    trend: count("trend"),
    recommended: count("recommended_program"),
    program_changes: s.filter((p) => p.program_change).length,
    annual_spend: spend,
    inv_now: sum(s, (p) => p.inv_value_current),
    inv_target: sum(s, (p) => p.inv_value_target),
    excess: sum(s, (p) => p.excess_value),
    consignment: sum(s, (p) => p.consignment_transfer_value),
    pull_share_now: spend ? pull("current_program") / spend : 0,
    pull_share_rec: spend ? pull("recommended_program") / spend : 0,
    matrix,
  };
}

function emptyResult() {
  return { parts: [], analyzed: [], weeks: [], summary: summarize([], []) };
}

// Columns exactly as reference/expected_results.csv, values rounded like the Python (round(4) at export).
export const RESULT_COLUMNS = ["part_number", "data_issues", "abc", "super_a", "xyz", "trend", "cv", "zero_share",
  "annual_spend", "current_program", "recommended_program", "reason", "program_change", "target_qty",
  "dos_current", "dos_target", "inv_value_current", "inv_value_target", "excess_value", "consignment_transfer_value"];

export function resultRow(p) {
  const row = { part_number: p.part_number, data_issues: p.data_issues };
  if (!p.analyzed) { for (const c of RESULT_COLUMNS.slice(2)) row[c] = ""; return row; }
  for (const c of RESULT_COLUMNS.slice(2)) {
    const v = p[c];
    row[c] = typeof v === "number" ? npRound(v, 4) : typeof v === "boolean" ? (v ? "True" : "False") : v;
  }
  return row;
}
