// Generated from js/whatif.js by scripts/build-skill.mjs. Edit the source, not this copy.
// Supplier delay what-if: "this supplier's open POs slip N weeks: which parts go short inside their
// lead time, how much value is at risk, what to do first". Re-runs pipeline() (js/v2.js) on the
// affected parts with their open-PO due week pushed out. Pure functions, no DOM.
import { pipeline } from "./v2.js";

const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };
const val = (r) => (r && Number.isFinite(r.short_value) ? r.short_value : 0);
const FC_WEEKS = 13;

// Status of one part in a pipeline() result: Escalate | Watch | Covered | No LT
function statusIndex(pipe) {
  const m = new Map();
  for (const [list, s] of [[pipe.escalate, "Escalate"], [pipe.watch, "Watch"], [pipe.covered, "Covered"], [pipe.noLeadTime, "No LT"]])
    for (const r of list) m.set(r.part.part_number, { s, r });
  return m;
}

// Impact of the delay on one part, worst first.
export const IMPACTS = ["New expedite", "Deeper shortage", "Order now", "Shorter cover", "No change"];

// Suppliers that have open POs inside the 13-week horizon, by open-PO value (largest first).
export function delayCandidates(parts, forecastRows) {
  const fc = new Map(forecastRows.map((r) => [String(r.part_number ?? "").trim(), r]));
  const bySup = new Map();
  for (const p of parts) {
    const r = fc.get(p.part_number);
    const q = num(r?.open_po_qty), w = num(r?.open_po_due_week);
    if (!(q > 0) || !(w >= 1 && w <= FC_WEEKS)) continue;
    const g = bySup.get(p.supplier) || { supplier: p.supplier, parts: [], po_value: 0 };
    g.parts.push(p);
    g.po_value += q * (p.unit_cost_usd > 0 ? p.unit_cost_usd : 0);
    bySup.set(p.supplier, g);
  }
  return [...bySup.values()].sort((a, b) => b.po_value - a.po_value || a.supplier.localeCompare(b.supplier));
}

// scenario: { supplier, part?, weeks }. part narrows the delay to one part of that supplier.
export function delayScenario(parts, forecastRows, P, scenario) {
  const weeks = Math.max(0, Math.round(num(scenario.weeks) || 0));
  const fc = new Map(forecastRows.map((r) => [String(r.part_number ?? "").trim(), r]));
  const hit = parts.filter((p) => p.supplier === scenario.supplier && (!scenario.part || p.part_number === scenario.part)
    && num(fc.get(p.part_number)?.open_po_qty) > 0 && num(fc.get(p.part_number)?.open_po_due_week) >= 1
    && num(fc.get(p.part_number)?.open_po_due_week) <= FC_WEEKS);
  const delayedRows = hit.map((p) => {
    const r = fc.get(p.part_number);
    return { ...r, open_po_due_week: num(r.open_po_due_week) + weeks }; // past week 13 = the PO leaves the horizon
  });
  const before = statusIndex(pipeline(hit, hit.map((p) => fc.get(p.part_number)), P));
  const after = statusIndex(pipeline(hit, delayedRows, P));

  const rows = hit.map((p) => {
    const b = before.get(p.part_number), a = after.get(p.part_number);
    const added = Math.max(0, val(a.r) - val(b.r));
    let impact = "No change";
    if (a.s === "Escalate" && b.s !== "Escalate") impact = "New expedite";
    else if (a.s === "Escalate" && added > 0) impact = "Deeper shortage";
    else if (a.s === "Watch" && b.s === "Covered") impact = "Order now";
    else if (a.s === "Watch" && b.s === "Watch" && a.r.first_short_week < b.r.first_short_week) impact = "Shorter cover";
    return {
      part: p, impact, before: b.s, after: a.s,
      po_qty: a.r.po_qty || num(fc.get(p.part_number).open_po_qty), po_week_before: num(fc.get(p.part_number).open_po_due_week),
      po_week_after: num(fc.get(p.part_number).open_po_due_week) + weeks,
      first_short_before: b.r.first_short_week ?? null, first_short_after: a.r.first_short_week ?? null,
      value_before: val(b.r), value_after: val(a.r), added_value: added,
      order_by_week: a.r.order_by_week ?? null, row: a.r,
    };
  });
  const rank = (x) => IMPACTS.indexOf(x.impact);
  rows.sort((x, y) => rank(x) - rank(y) || y.added_value - x.added_value || x.part.part_number.localeCompare(y.part.part_number));
  const count = (k) => rows.filter((r) => r.impact === k).length;
  const escalated = rows.filter((r) => r.after === "Escalate");
  const firstHit = escalated.map((r) => r.first_short_after).filter((w) => w != null);
  return {
    supplier: scenario.supplier, part: scenario.part || "", weeks, rows,
    parts: rows.length,
    newExpedite: count("New expedite"), deeper: count("Deeper shortage"), orderNow: count("Order now"), shorter: count("Shorter cover"),
    unaffected: count("No change"),
    addedValue: rows.reduce((t, r) => t + r.added_value, 0),
    valueAfter: escalated.reduce((t, r) => t + r.value_after, 0),
    firstShortWeek: firstHit.length ? Math.min(...firstHit) : null,
  };
}

export const WHATIF_COLUMNS = ["supplier", "part_number", "description", "commodity", "impact", "status_before", "status_after",
  "open_po_qty", "po_due_week_before", "po_due_week_after", "lead_time_weeks", "first_short_week_before", "first_short_week_after",
  "short_value_before_usd", "short_value_after_usd", "added_value_at_risk_usd", "order_by_week"];
export const whatifRow = (r) => [r.part.supplier, r.part.part_number, r.part.description, r.part.commodity, r.impact, r.before, r.after,
  r.po_qty, r.po_week_before, r.po_week_after, r.part.lead_time_weeks, r.first_short_before ?? "", r.first_short_after ?? "",
  r.value_before.toFixed(2), r.value_after.toFixed(2), r.added_value.toFixed(2), r.order_by_week ?? ""];
