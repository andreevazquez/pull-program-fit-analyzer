// VMI / CRP proposal draft per supplier: the parts the policy moves to VMI or CRP at that supplier,
// with min/max levels taken from the same safety-stock and cycle numbers as the target, and the
// asks that come from the scorecard (agreement, EDI, consignment, lead time, OTD, hub).
// It is a draft for the manager to review before anything goes to the supplier.
// Pure functions, no DOM. Built on analyze(), scorecard() and opportunities(); never changes them.

export const PROPOSAL_STATUSES = ["Draft", "Reviewed", "Sent"];
export const ASKS = ["vmi_agreement", "edi", "consignment", "lead_time", "otd", "hub"];
const PULL = ["VMI", "CRP"];
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

// Suppliers with at least one part recommended for VMI or CRP, largest VMI/CRP spend first.
export function proposalCandidates(result) {
  const by = new Map();
  for (const p of result.analyzed) {
    if (!PULL.includes(p.recommended_program)) continue;
    const g = by.get(p.supplier) || { supplier: p.supplier, n: 0, spend: 0 };
    g.n++; g.spend += p.annual_spend; by.set(p.supplier, g);
  }
  return [...by.values()].sort((a, b) => b.spend - a.spend || a.supplier.localeCompare(b.supplier));
}

export function proposal(result, score, opps, P, supplier) {
  const parts = result.analyzed.filter((p) => p.supplier === supplier && PULL.includes(p.recommended_program))
    .sort((a, b) => b.annual_spend - a.annual_spend || a.part_number.localeCompare(b.part_number));
  const lines = parts.map((p) => {
    const c = p.calc, daily = c.daily;
    const min = Math.round(c.ss);
    const max = Math.max(Math.round(c.ss + c.cycleBase), p.target_qty);
    return {
      part: p, program: p.recommended_program, change: p.current_program !== p.recommended_program,
      weekly: p.avg_weekly, annual_qty: p.avg_weekly * 52, annual_spend: p.annual_spend,
      review_weeks: c.R, exposure_weeks: c.L, min_qty: min, max_qty: max, target_qty: p.target_qty,
      min_days: daily > 0 ? min / daily : NaN, max_days: daily > 0 ? max / daily : NaN,
      on_hand: p.on_hand_qty, above_max: Math.max(0, p.on_hand_qty - max),
      consignment: p.recommended_program === "VMI" && !!P.consignment, consignment_value: p.consignment_transfer_value,
    };
  });
  const g = score.rows.find((r) => r.supplier === supplier);
  const vmi = lines.filter((l) => l.program === "VMI"), crp = lines.filter((l) => l.program === "CRP");
  const lt = opps.lt.filter((o) => o.part.supplier === supplier && o.holder === "Supplier");
  const asks = [];
  if (vmi.length && !g?.vmi_agreement) asks.push({ code: "vmi_agreement", n: vmi.length, value: sum(vmi, (l) => l.annual_spend) });
  if (!g?.edi) asks.push({ code: "edi", n: lines.length });
  if (vmi.length && P.consignment) asks.push({ code: "consignment", n: vmi.length, value: sum(vmi, (l) => l.consignment_value) });
  if (lt.length) asks.push({ code: "lead_time", n: lt.length, weeks: P.lt_cut_weeks, parts: lt.map((o) => o.part.part_number) });
  if (Number.isFinite(g?.otd) && g.otd < P.exc_otd_min) asks.push({ code: "otd", otd: g.otd, target: P.exc_otd_min });
  if (g?.hub_ending) asks.push({ code: "hub", hub: g.hub, end: g.hub_contract_end, expired: g.hub_expired });
  return {
    supplier, lines, asks, inMaster: !!g?.in_master,
    vmiN: vmi.length, crpN: crp.length, changes: lines.filter((l) => l.change).length,
    annual_spend: sum(lines, (l) => l.annual_spend),
    inv_now: sum(lines, (l) => l.part.inv_value_current), inv_target: sum(lines, (l) => l.part.inv_value_target),
    consignment_value: sum(vmi, (l) => (P.consignment ? l.consignment_value : 0)),
    above_max_value: sum(lines, (l) => l.above_max * l.part.unit_cost_usd),
  };
}

export const PROPOSAL_COLUMNS = ["supplier", "part_number", "description", "manufacturer", "current_program", "proposed_program",
  "avg_weekly_qty", "annual_qty", "annual_spend_usd", "review_weeks", "min_qty", "max_qty", "target_qty", "min_days", "max_days",
  "on_hand_qty", "on_hand_above_max_qty", "consignment", "unit_cost_usd", "lead_time_weeks", "moq"];
export const proposalRow = (l) => [l.part.supplier, l.part.part_number, l.part.description, l.part.manufacturer, l.part.current_program, l.program,
  Math.round(l.weekly), Math.round(l.annual_qty), l.annual_spend.toFixed(2), l.review_weeks, l.min_qty, l.max_qty, l.target_qty,
  Number.isFinite(l.min_days) ? l.min_days.toFixed(1) : "", Number.isFinite(l.max_days) ? l.max_days.toFixed(1) : "",
  l.on_hand, Math.round(l.above_max), l.consignment ? "yes" : "no", l.part.unit_cost_usd, l.part.lead_time_weeks, l.part.moq];
