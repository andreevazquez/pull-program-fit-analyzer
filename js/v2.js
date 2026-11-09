// V2_SPEC.md sections 1, 3 and 4, plus the executive roll-up (turns, DIO, value pipeline).
// Pure functions, no DOM. Built on analyze() results; never changes them.
import { ANALYSIS_DATE, parseDate, addMonths } from "./freshness.js?v=19";

export const V2_DEFAULTS = Object.freeze({
  fc_upside: 1.5,          // forecast flag: avg(f01..f13) ÷ avg(last N actual weeks) above this = upside
  fc_downside: 0.6,        // … below this = downside
  fc_hist_weeks: 8,        // N actual weeks compared against the forecast
  hub_warn_months: 6,      // flag hub/3PL contracts ending within this many months
  moq_opp_weeks: 4,        // MOQ opportunity when MOQ > this many weeks of avg demand
  lt_opp_min_weeks: 12,    // LT opportunity for A / Super A parts with lead time above this
  lt_cut_weeks: 4,         // lead-time reduction to evaluate
});

const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
const yes = (v) => /^(y|yes|true|1|si|sí)$/i.test(String(v ?? "").trim());
const FC_WEEKS = 13;

/* ---------- 1. Pipeline coverage ---------- */
// projected[k] = on_hand + open PO (from its due week) − cumulative forecast, k = 1..13
export function projectCoverage(onHand, forecast, poQty, poWeek) {
  const out = [];
  let p = onHand;
  for (let k = 1; k <= forecast.length; k++) {
    if (poWeek === k) p += poQty;
    p -= forecast[k - 1];
    out.push(p);
  }
  return out;
}

export function pipeline(parts, forecastRows, P) {
  const fc = new Map(forecastRows.map((r) => [String(r.part_number ?? "").trim(), r]));
  const escalate = [], watch = [], covered = [], noLeadTime = [], noForecast = [], upside = [], downside = [];
  for (const p of parts) {
    const r = fc.get(p.part_number);
    if (!r) { noForecast.push(p); continue; }
    const f = Array.from({ length: FC_WEEKS }, (_, i) => Math.max(0, num(r[`f${String(i + 1).padStart(2, "0")}`]) || 0));
    const poQty = num(r.open_po_qty) || 0;
    const poWeekRaw = String(r.open_po_due_week ?? "").trim();
    const poWeek = poWeekRaw === "" || !(poQty > 0) ? null : Math.round(num(poWeekRaw));
    const proj = projectCoverage(p.on_hand_qty, f, poQty, poWeek);
    const cost = p.unit_cost_usd > 0 ? p.unit_cost_usd : NaN;
    const row = { part: p, forecast: f, proj, po_qty: poWeek ? poQty : 0, po_week: poWeek, lt: p.lead_time_weeks, cost };

    // Forecast vs history (needs demand history)
    const nH = Math.min(P.fc_hist_weeks, p.demand.length);
    const hist = mean(p.demand.slice(-nH)), fAvg = mean(f);
    row.fc_avg = fAvg; row.hist_avg = hist;
    row.fc_ratio = hist > 0 ? fAvg / hist : (fAvg > 0 ? Infinity : NaN);
    if (row.fc_ratio > P.fc_upside) upside.push(row);
    else if (row.fc_ratio < P.fc_downside) downside.push(row);

    if (!(p.lead_time_weeks > 0)) { noLeadTime.push(row); continue; }
    const first = proj.findIndex((v) => v < 0);
    if (first < 0) { covered.push(row); continue; }
    row.first_short_week = first + 1;
    const lt = p.lead_time_weeks;
    if (row.first_short_week <= lt) {
      // can't be fixed by a new PO in time: worst shortfall inside the lead time
      row.short_qty = -Math.min(0, ...proj.slice(0, Math.min(lt, FC_WEEKS)));
      row.status = "Escalate";
      escalate.push(row);
    } else {
      row.short_qty = -Math.min(0, ...proj);
      // latest week to place a PO so it lands before the first short week
      row.order_by_week = Math.max(1, row.first_short_week - Math.ceil(lt));
      row.status = "Watch";
      watch.push(row);
    }
    row.short_value = row.short_qty * cost;
  }
  const byValue = (a, b) => (Number.isFinite(b.short_value) ? b.short_value : -1) - (Number.isFinite(a.short_value) ? a.short_value : -1);
  escalate.sort(byValue); watch.sort(byValue);
  const ratioKey = (a, b) => b.fc_ratio - a.fc_ratio;
  upside.sort(ratioKey); downside.sort((a, b) => a.fc_ratio - b.fc_ratio);
  const v = (a) => sum(a, (r) => (Number.isFinite(r.short_value) ? r.short_value : 0));
  const escValue = v(escalate);
  return {
    escalate, watch, covered, noLeadTime, noForecast, upside, downside,
    escalateValue: escValue, watchValue: v(watch),
    top3Share: escValue ? v(escalate.slice(0, 3)) / escValue : 0,
    checked: parts.length - noForecast.length,
  };
}

export const ESCALATION_COLUMNS = ["status", "part_number", "description", "supplier", "lead_time_weeks", "first_short_week",
  "short_qty", "short_value_usd", "on_hand_qty", "open_po_qty", "open_po_due_week", "order_by_week", "forecast_13wk", "forecast_vs_history"];
export const escalationRow = (r) => [r.status, r.part.part_number, r.part.description, r.part.supplier, r.lt, r.first_short_week,
  Math.round(r.short_qty), Number.isFinite(r.short_value) ? r.short_value.toFixed(2) : "", r.part.on_hand_qty, r.po_qty || "", r.po_week ?? "",
  r.order_by_week ?? "", Math.round(sum(r.forecast, (x) => x)), Number.isFinite(r.fc_ratio) ? r.fc_ratio.toFixed(2) : ""];

/* ---------- 3. Supplier scorecard ---------- */
const PULL = ["VMI", "CRP", "Kanban"];

// fresh: freshness() result; claimStatus(c) → "Open" | "Escalated" | "Closed"
export function scorecard(result, supplierRows, fresh, P, claimStatus = (c) => c.status) {
  const master = new Map(supplierRows.map((r) => [String(r.supplier ?? "").trim(), r]));
  const today = parseDate(ANALYSIS_DATE), warnBy = addMonths(today, P.hub_warn_months);
  const s = result.analyzed, total = sum(s, (p) => p.annual_spend);
  const by = new Map();
  for (const p of s) {
    const g = by.get(p.supplier) || { supplier: p.supplier, n: 0, spend: 0, pull_rec: 0, vmi_now: 0, vmi_rec: 0, lts: [], noAgreement: [], claimsOpen: 0, claimsOpenValue: 0 };
    g.n++; g.spend += p.annual_spend; g.lts.push(p.lead_time_weeks);
    if (PULL.includes(p.recommended_program)) g.pull_rec += p.annual_spend;
    if (p.current_program === "VMI") g.vmi_now += p.annual_spend;
    if (p.recommended_program === "VMI") g.vmi_rec += p.annual_spend;
    by.set(p.supplier, g);
  }
  for (const c of fresh?.claimable || []) {
    const g = by.get(c.supplier);
    if (g && claimStatus(c) !== "Closed") { g.claimsOpen++; g.claimsOpenValue += Number.isFinite(c.value) ? c.value : 0; }
  }
  const rows = [...by.values()].map((g) => {
    const m = master.get(g.supplier);
    const end = m ? parseDate(m.hub_contract_end) : null;
    const hub = m ? String(m.hub_3pl ?? "").trim() : "";
    const vmiAgreement = m ? yes(m.vmi_agreement) : false;
    const noAgreement = vmiAgreement ? [] : s.filter((p) => p.supplier === g.supplier && p.recommended_program === "VMI");
    return {
      ...g,
      in_master: !!m,
      edi: m ? yes(m.edi_enabled) : false,
      vmi_agreement: vmiAgreement,
      hub, hub_contract_end: end ? m.hub_contract_end : "",
      hub_ending: !!(hub && end && end <= warnBy),
      hub_expired: !!(hub && end && end < today),
      otd: m ? num(m.otd_pct) : NaN,
      terms: m ? num(m.payment_terms_days) : NaN,
      freshness_rule: m ? num(m.freshness_rule_months) : NaN,
      avg_lt: mean(g.lts.filter((x) => x > 0)),
      pull_rec_share: g.spend ? g.pull_rec / g.spend : 0,
      noAgreement,
      noAgreementSpend: sum(noAgreement, (p) => p.annual_spend),
    };
  }).sort((a, b) => b.spend - a.spend);
  const share = (f) => (total ? sum(rows.filter(f), (g) => g.spend) / total : 0);
  return {
    rows, total,
    edi_penetration: share((g) => g.edi),
    vmi_now: total ? sum(rows, (g) => g.vmi_now) / total : 0,
    vmi_rec: total ? sum(rows, (g) => g.vmi_rec) / total : 0,
    noAgreementSpend: sum(rows, (g) => g.noAgreementSpend),
    noAgreementParts: sum(rows, (g) => g.noAgreement.length),
    hubEnding: rows.filter((g) => g.hub_ending),
    missingMaster: rows.filter((g) => !g.in_master),
  };
}

/* ---------- 4. MOQ & LT opportunities ---------- */
export function opportunities(result, P) {
  const s = result.analyzed;
  const moq = s.filter((p) => p.moq > P.moq_opp_weeks * p.avg_weekly).map((p) => {
    const R = p.calc.R;
    const qty = Math.max(0, p.moq / 2 - (p.avg_weekly * R) / 2);
    return { part: p, R, moq_weeks: p.moq / p.avg_weekly, qty, value: qty * p.unit_cost_usd };
  }).filter((o) => o.value > 0).sort((a, b) => b.value - a.value);

  const cut = P.lt_cut_weeks;
  const lt = s.filter((p) => (p.abc === "A" || p.super_a) && p.lead_time_weeks > P.lt_opp_min_weeks).map((p) => {
    // Safety stock that covers the lead time: z × sd × √(R + LT). Who holds it depends on the program:
    // under MRP the plant does (it is in the target); under VMI/CRP/Kanban the plant's exposure is fixed
    // (L in Policy), so the supplier's pipeline carries it.
    const { R, z } = p.calc;
    const L = p.lead_time_weeks, L2 = Math.max(0, L - cut);
    const ss = z * p.sd_weekly * Math.sqrt(R + L), ss2 = z * p.sd_weekly * Math.sqrt(R + L2);
    const plantHolds = p.calc.L === L;
    const vmiRule = p.xyz === "X" ? P.vmi_lt_ax : p.xyz === "Y" ? P.vmi_lt_ay : null;
    const crossesVmi = p.recommended_program === "VMI" && vmiRule != null && L2 < vmiRule;
    return { part: p, L, L2, ss, ss2, qty: ss - ss2, value: (ss - ss2) * p.unit_cost_usd, holder: plantHolds ? "Plant" : "Supplier", crossesVmi, vmiRule };
  }).sort((a, b) => b.value - a.value);

  return {
    moq, moqValue: sum(moq, (o) => o.value),
    lt, ltValue: sum(lt, (o) => o.value),
    ltPlantValue: sum(lt.filter((o) => o.holder === "Plant"), (o) => o.value),
    ltSupplierValue: sum(lt.filter((o) => o.holder === "Supplier"), (o) => o.value),
  };
}

/* ---------- Executive roll-up ---------- */
export function turns(annualSpend, inv) { return inv > 0 ? annualSpend / inv : NaN; }
export function dio(annualSpend, inv) { return annualSpend > 0 ? inv / (annualSpend / 365) : NaN; }

// Each line keeps its own type. Types are never added into one total (see CLAUDE.md: excess vs consignment).
export const VALUE_TYPES = ["Cash, one-time", "P&L, per year", "Recovery", "Ownership transfer", "Risk to manage"];

export function valuePipeline({ result, insights, fresh, pipe, score, opps, P, claimStatus = (c) => c.status }) {
  const S = result.summary, W = insights.waves, C = insights.carrying;
  const claims = fresh?.claimable || [];
  const cv = (f) => sum(claims.filter(f), (c) => (Number.isFinite(c.value) ? c.value : 0));
  const lines = [
    { type: "Cash, one-time", initiative: "Wave 1: right-size in place, Kanban and back to MRP", owner: "Manager + planners", when: W[0].when, status: "Ready: no supplier agreement needed", value: W[0].net, layer: "manager", tab: "waves" },
    { type: "Cash, one-time", initiative: `Wave 2: VMI/CRP with ${W[1].suppliers.length ? W[1].suppliers.map((x) => x.supplier).join(", ") : "no supplier"}`, owner: "Manager", when: W[1].when, status: "Needs supplier agreement", value: W[1].net, layer: "manager", tab: "waves" },
    { type: "Cash, one-time", initiative: `Wave 3: VMI/CRP with the remaining ${W[2].suppliers.length} supplier${W[2].suppliers.length === 1 ? "" : "s"}`, owner: "Manager", when: W[2].when, status: "Needs supplier agreement", value: W[2].net, layer: "manager", tab: "waves" },
    { type: "Cash, one-time", initiative: `MOQ reduction: ${opps.moq.length} part${opps.moq.length === 1 ? "" : "s"} carrying stock only because of MOQ`, owner: "Manager", when: "Next supplier review", status: "Identified", value: opps.moqValue, layer: "manager", tab: "opps" },
    { type: "Cash, one-time", initiative: `LT reduction: ${P.lt_cut_weeks} weeks on ${opps.lt.filter((o) => o.holder === "Plant").length} A part${opps.lt.filter((o) => o.holder === "Plant").length === 1 ? "" : "s"} where the plant holds the lead-time buffer`, owner: "Manager", when: "Next supplier review", status: "Identified", value: opps.ltPlantValue, layer: "manager", tab: "opps" },
    { type: "P&L, per year", initiative: "Carrying cost avoided at target inventory", owner: "Manager", when: "As waves land", status: `At ${Math.round(P.carrying_rate * 100)}% carrying rate`, value: C.avoided, layer: "manager", tab: "parts" },
    { type: "Recovery", initiative: `Freshness claims open or escalated (${claims.filter((c) => claimStatus(c) !== "Closed").length} lots)`, owner: "Planners → Manager", when: "Now", status: "With suppliers", value: cv((c) => claimStatus(c) !== "Closed"), layer: "manager", tab: "freshness" },
    { type: "Recovery", initiative: `Freshness claims closed (${claims.filter((c) => claimStatus(c) === "Closed").length} lots)`, owner: "Manager", when: "Done", status: "Closed", value: cv((c) => claimStatus(c) === "Closed"), layer: "manager", tab: "freshness" },
    { type: "Ownership transfer", initiative: "VMI on consignment: stock moves to supplier ownership", owner: "Manager", when: "With Waves 2–3", status: P.consignment ? `Needs VMI agreements: ${score.noAgreementParts} VMI parts have none` : "Consignment off in Policy", value: P.consignment ? S.consignment : 0, layer: "manager", tab: "suppliers" },
    { type: "Risk to manage", initiative: `Shortages to escalate: ${pipe.escalate.length} parts short inside their lead time`, owner: "Planners", when: "This week", status: "Escalate", value: pipe.escalateValue, layer: "planner", tab: "escalations" },
    { type: "Risk to manage", initiative: `E&O exposure on ${insights.eo.length} declining or slow part${insights.eo.length === 1 ? "" : "s"}`, owner: "Manager", when: "Next E&O review", status: "Disposition", value: insights.eoValue, layer: "manager", tab: "risk" },
    { type: "Risk to manage", initiative: `Internal aging: ${fresh?.aging.length || 0} lots past the freshness rule, not claimable`, owner: "Planners", when: "Use first or reserve", status: "Ours", value: fresh?.agingValue || 0, layer: "manager", tab: "freshness" },
  ];
  const byType = VALUE_TYPES.map((type) => ({ type, value: sum(lines.filter((l) => l.type === type), (l) => l.value), n: lines.filter((l) => l.type === type).length }));
  return { lines, byType };
}

// How the three cash figures tie together. Excess is gross (only stock above target × tolerance);
// working capital is net (every part to target, build-ups included); the value pipeline adds the
// MOQ and LT projects, which lower the target itself.
//   excess + tolerance band = gross release;  gross release − build-up = working capital;
//   working capital + MOQ + LT (plant) = value pipeline one-time cash.
export function cashBridge(result, insights, opps) {
  const S = result.summary, W = insights.waves;
  const gross = sum(W, (w) => w.released), build = sum(W, (w) => w.built);
  const wc = S.inv_now - S.inv_target;
  return {
    excess: S.excess,
    band: gross - S.excess,
    gross_release: gross,
    build_up: build,
    working_capital: wc,
    moq: opps.moqValue,
    lt_plant: opps.ltPlantValue,
    pipeline_cash: wc + opps.moqValue + opps.ltPlantValue,
  };
}

export function executive({ result, insights, pipe, score }) {
  const S = result.summary;
  return {
    turns_now: turns(S.annual_spend, S.inv_now), turns_target: turns(S.annual_spend, S.inv_target),
    dio_now: dio(S.annual_spend, S.inv_now), dio_target: dio(S.annual_spend, S.inv_target),
    working_capital: S.inv_now - S.inv_target,
    carrying_avoided: insights.carrying.avoided,
    escalations: pipe.escalate.length, escalation_value: pipe.escalateValue,
    critical: insights.critical.length,
    edi: score.edi_penetration, vmi_now: score.vmi_now, vmi_rec: score.vmi_rec,
    pull_now: S.pull_share_now, pull_rec: S.pull_share_rec,
  };
}
