// Role layers. Executive: the portfolio in money, service and plan. Planner: what to do this week,
// part by part. Also the Manager tabs added in v2 (pipeline coverage, supplier scorecard, MOQ & LT).
// Render functions return HTML strings; js/app.js wires events. No computation beyond presentation.
import { esc, fmtN, fmtUSD, fmtM, fmtPct, fmtCost } from "./format.js?v=18";
import { VALUE_TYPES } from "./v2.js?v=18";

const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };
const badge = (prog) => (prog ? `<span class="badge" style="--c: var(${PVAR[prog] || "--mrp"})">${esc(prog)}</span>` : `<span class="muted">—</span>`);
const money = (v) => (Number.isFinite(v) ? fmtUSD(v) : `<span class="muted" title="No valid unit cost">—</span>`);
const dash = `<span class="muted">—</span>`;
const yn = (b) => (b ? "Yes" : `<span class="issue-warn">No</span>`);
const hero = (label, value, sub, cls = "") => `<div class="hero ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const arrow = `<span class="arrow">→</span>`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const TYPE_CLS = { "Cash, one-time": "t-cash", "P&L, per year": "t-pl", Recovery: "t-rec", "Ownership transfer": "t-own", "Risk to manage": "t-risk" };

/* ================= Executive ================= */
export function renderExecTop({ E, V, pipe, score, S, P, X, B }) {
  const typeRows = VALUE_TYPES.map((type) => {
    const lines = V.lines.filter((l) => l.type === type);
    const sub = V.byType.find((t) => t.type === type);
    return `<tr class="vp-type"><th colspan="4"><span class="vp-dot ${TYPE_CLS[type]}"></span>${esc(type)}</th><th class="n">${fmtM(sub.value)}${type === "P&L, per year" ? "/yr" : ""}</th></tr>` +
      lines.map((l) => `<tr class="clickable" tabindex="0" data-goto="${l.layer}:${l.tab}">
        <td>${esc(l.initiative)}</td><td class="muted">${esc(l.owner)}</td><td class="muted">${esc(l.when)}</td><td>${esc(l.status)}</td>
        <td class="n"><b>${fmtM(l.value)}</b></td></tr>`).join("");
  }).join("");
  const top = pipe.escalate[0];
  return `
    <div class="story-hero exec-hero">
      ${hero("Inventory turns", `${fmtN(E.turns_now, 1)}${arrow}${fmtN(E.turns_target, 1)}`, "annual material spend ÷ inventory, now vs target")}
      ${hero("Days of inventory", `${fmtN(E.dio_now, 0)}${arrow}${fmtN(E.dio_target, 0)}<span class="unit">days</span>`, `${fmtM(S.inv_now)} → ${fmtM(S.inv_target)}`)}
      ${hero("Net working capital to release", fmtM(E.working_capital), `now − target, net of build-ups · gross excess ${fmtM(S.excess)}`, "excess")}
      ${hero("Service risk", `${E.escalations}<span class="unit">parts</span>`, `short inside lead time · ${fmtM(E.escalation_value)}`, "risk")}
      ${hero("Pull, VMI, EDI", `${fmtPct(E.pull_now)}${arrow}${fmtPct(E.pull_rec)}`, `spend under pull · VMI ${fmtPct(E.vmi_now)} → ${fmtPct(E.vmi_rec)} · EDI ${fmtPct(E.edi, 1)}`)}
    </div>
    <div class="story-grid">
      <article class="card story-card wide">
        <div class="story-card-head"><div class="eyebrow">Value pipeline</div></div>
        <h2 class="headline">${fmtM(V.byType[0].value)} of one-time cash and ${fmtM(V.byType[1].value)}/yr of P&L, with ${fmtM(V.byType[4].value)} of risk to manage on the way</h2>
        <p class="hint">Every initiative from the analysis, with owner, timing and status. Types are kept apart on purpose: cash, P&L, claim recovery, ownership transfer and risk are different money and are never added into one number. Click a line to open the detail.</p>
        <div class="table-wrap story-table"><table class="grid vp"><thead><tr><th>Initiative</th><th>Owner</th><th>When</th><th>Status</th><th class="n">Value</th></tr></thead>
          <tbody>${typeRows}</tbody></table></div>
        ${B ? cashBridgeTable(B, P) : ""}
      </article>
      ${X ? renderExecExceptions(X) : ""}
      <article class="card story-card">
        <div class="story-card-head"><div class="eyebrow">Will we ship?</div></div>
        <h2 class="headline">${pipe.escalate.length ? `${plural(pipe.escalate.length, "part")} run short inside their lead time; the top 3 carry ${fmtPct(pipe.top3Share)} of the ${fmtM(pipe.escalateValue)} at risk` : "No part runs short inside its lead time"}</h2>
        <p class="hint">On hand plus the open PO, against the next 13 weeks of forecast. A shortage inside the lead time cannot be fixed with a normal PO: it needs expediting or an allocation call.${top ? ` Largest: ${esc(top.part.part_number)} (${esc(top.part.supplier)}), short from week ${top.first_short_week}, ${fmtM(top.short_value)}.` : ""} Another ${plural(pipe.watch.length, "part")} go short later and only need a PO now. Forecast is ${pipe.upside.length} up and ${pipe.downside.length} down against history.</p>
        <p class="exec-link"><a href="#planner" data-goto="planner:escalations">Open the planners' escalation list</a></p>
      </article>
      <article class="card story-card">
        <div class="story-card-head"><div class="eyebrow">Supplier base</div></div>
        <h2 class="headline">${fmtPct(score.edi_penetration, 1)} of spend runs on EDI; VMI goes from ${fmtPct(score.vmi_now)} to ${fmtPct(score.vmi_rec)} of spend</h2>
        <p class="hint">${score.noAgreementParts ? `${plural(score.noAgreementParts, "part")} recommended for VMI (${fmtM(score.noAgreementSpend)} a year) sit with suppliers that have no VMI agreement yet: negotiate the agreement first. ` : "Every VMI-recommended part has a supplier with a VMI agreement. "}${score.hubEnding.length ? `Hub contract${score.hubEnding.length === 1 ? "" : "s"} ending within ${P.hub_warn_months} months: ${score.hubEnding.map((g) => `${esc(g.hub)} (${esc(g.supplier)}, ${g.hub_contract_end})`).join("; ")}.` : ""}</p>
        <p class="exec-link"><a href="#" data-goto="analysis:suppliers">Open the supplier scorecard</a></p>
      </article>
    </div>`;
}

// Reconciliation of the three cash figures shown across the app (v2.js cashBridge).
export function cashBridgeTable(B, P) {
  const row = (op, label, v, note, cls = "") => `<tr class="${cls}"><td class="nowrap">${op}</td><td>${label}</td><td class="n">${fmtM(v)}</td><td class="muted small">${note}</td></tr>`;
  return `<h3>How the cash numbers tie</h3>
    <p class="hint">Three one-time cash figures appear in the app. They are not competing estimates; each adds one step to the one before.</p>
    <div class="table-wrap story-table"><table class="grid bridge"><thead><tr><th></th><th>Step</th><th class="n">Value</th><th>What it is</th></tr></thead><tbody>
      ${row("", "<b>Excess</b> (Manager, Planner)", B.excess, `stock above target × ${P.tolerance.toFixed(2)}: the part to push out or cancel first`)}
      ${row("+", "Tolerance band", B.band, "stock between target and the tolerance on overstocked parts")}
      ${row("=", "Gross release", B.gross_release, "every overstocked part brought to target", "sub")}
      ${row("−", "Build-up", B.build_up, "stock to buy for parts below target")}
      ${row("=", "<b>Net working capital</b> (Executive)", B.working_capital, "inventory now − target; the Wave 1–3 lines of the value pipeline", "sub")}
      ${row("+", "MOQ and LT projects", B.moq + B.lt_plant, "lower the target itself; need supplier negotiation")}
      ${row("=", "<b>Value pipeline, one-time cash</b>", B.pipeline_cash, "subtotal above", "sub")}
    </tbody></table></div>`;
}

/* ================= Planner ================= */
// One row per part with a reason to act, highest priority first.
export const ACTIONS = [
  { key: "expedite", label: "Expedite", cls: "issue-block" },
  { key: "fix", label: "Fix data", cls: "issue-block" },
  { key: "build", label: "Below safety stock", cls: "issue-warn" },
  { key: "po", label: "Place PO", cls: "issue-warn" },
  { key: "claim", label: "Validate freshness claim", cls: "issue-warn" },
  { key: "forecast", label: "Check forecast", cls: "" },
  { key: "aging", label: "Use first (aged lot)", cls: "" },
  { key: "excess", label: "Push out / cancel", cls: "" },
];

export function plannerActions({ result, insights, pipe, fresh }) {
  const map = new Map();
  const add = (p, key, detail, weight = 0) => {
    const g = map.get(p.part_number) || { part: p, actions: [], weight: 0 };
    g.actions.push({ key, detail });
    g.weight = Math.max(g.weight, weight);
    map.set(p.part_number, g);
  };
  const W = Object.fromEntries(ACTIONS.map((a, i) => [a.key, (ACTIONS.length - i) * 1e12]));
  for (const r of pipe.escalate) add(r.part, "expedite", `Short from week ${r.first_short_week}, inside the ${r.lt}-week lead time: ${fmtN(r.short_qty)} units (${fmtM(r.short_value)})${r.po_week ? `; open PO ${fmtN(r.po_qty)} due week ${r.po_week}` : "; no open PO"}`, W.expedite + (r.short_value || 0));
  for (const p of result.parts) if (p.blocking || p.issues.length) add(p, "fix", p.issues.join("; "), W.fix);
  for (const l of fresh?.invalid || []) { const p = result.parts.find((x) => x.part_number === l.part_number); if (p) add(p, "fix", `Lot ${l.lot_id}: ${l.errors.join("; ")}`, W.fix); }
  for (const r of insights.critical) add(r.part, "build", `On hand ${fmtN(r.part.on_hand_qty)} < safety stock ${fmtN(r.safety)}; build ${fmtN(r.build_qty)} to target`, W.build + (r.build_value || 0));
  for (const r of pipe.watch) add(r.part, "po", `Short from week ${r.first_short_week}; place a PO by week ${r.order_by_week} (${r.lt}-week lead time) for at least ${fmtN(r.short_qty)}`, W.po + (r.short_value || 0));
  for (const c of fresh?.claimable || []) { const p = result.parts.find((x) => x.part_number === c.part_number); if (p) add(p, "claim", `Lot ${c.lot_id}, date code ${c.date_code}: ${fmtN(c.age_receipt, 1)} months old at receipt vs a ${c.rule}-month rule`, W.claim + (c.value || 0)); }
  for (const r of [...pipe.upside, ...pipe.downside]) add(r.part, "forecast", `Next 13 weeks average ${fmtN(r.fc_avg)} vs ${fmtN(r.hist_avg)} actual (${Number.isFinite(r.fc_ratio) ? `${fmtN(r.fc_ratio, 2)}×` : "no history"}): confirm with the customer`, W.forecast);
  for (const l of fresh?.aging || []) { const p = result.parts.find((x) => x.part_number === l.part_number); if (p) add(p, "aging", `Lot ${l.lot_id} passed its ${l.rule}-month rule on ${l.expires}: consume first or reserve`, W.aging + (l.value || 0)); }
  // Excess is measured on today's stock against the 26-week average; a shortage comes from the 13-week
  // forecast. When a part has both, say which is when, so nobody cancels the order that covers the shortage.
  const short = new Map([...pipe.escalate, ...pipe.watch].map((r) => [r.part.part_number, r]));
  for (const p of result.analyzed) {
    if (!(p.excess_value > 0)) continue;
    const r = short.get(p.part_number);
    const detail = r
      ? `Timing split: on hand covers ${fmtN(p.on_hand_qty / Math.max(1e-9, r.fc_avg), 1)} weeks of forecast; the ${p.recommended_program} target is ${fmtN(p.target_qty / p.avg_weekly, 1)} weeks because it assumes replenishment every ${p.calc.R} week${p.calc.R === 1 ? "" : "s"}${p.program_change ? " once the program change is live" : ""}. Today's supply plan has ${r.po_week ? `the open PO in week ${r.po_week}` : "no open PO"}${r.fc_ratio > 1.2 ? ` and a forecast ${fmtPct(r.fc_ratio - 1)} above history` : ""}, so stock runs out in week ${r.first_short_week}. The ${fmtM(p.excess_value)} excess is releasable only after replenishment runs at target; until then do not cancel: ${r.status === "Escalate" ? "expedite" : "place the PO"}.`
      : `${fmtM(p.excess_value)} above target × tolerance: push out or cancel open orders`;
    add(p, "excess", detail, W.excess + p.excess_value);
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

export function renderPlanner({ rows, pipe, insights, fresh, result, filters, tab, X, xfilters, lib }) {
  const count = (k) => rows.filter((r) => r.actions.some((a) => a.key === k)).length;
  const fixes = result.parts.filter((p) => p.issues.length).length + (fresh?.invalid.length || 0);
  const kpis = `<div class="kpis planner-kpis">
    ${kpi("Expedite", `${pipe.escalate.length} · ${fmtM(pipe.escalateValue)}`, "short inside the lead time", "claim")}
    ${kpi("Place a PO", fmtN(pipe.watch.length), "short after the lead time: a normal PO fixes it", "aging")}
    ${kpi("Below safety stock", fmtN(insights.critical.length), `${fmtM(insights.criticalBuild)} to build up`, "aging")}
    ${kpi("Check forecast", `${pipe.upside.length} up · ${pipe.downside.length} down`, "next 13 weeks vs recent actuals")}
    ${kpi("Freshness to validate", fmtN(fresh?.claimable.length || 0), `${fresh?.aging.length || 0} aged lots to use first`)}
    ${kpi("Data to fix", fmtN(fixes), "part master and lot records")}
  </div>`;
  const mineCrit = X ? X.open.filter((x) => x.owner === "Planner" && x.sev === 0).length : 0;
  const tabs = [["actions", "This week"], ["exceptions", `Exceptions${mineCrit ? ` <span class="pill" title="Critical open exceptions the planner owns">${mineCrit}</span>` : ""}`], ["escalations", "Escalations"], ["forecast", "Forecast flags"], ["fixes", "Data fixes"]];
  const tabBar = `<div class="tabs" role="tablist" aria-label="Planner">${tabs.map(([k, l]) => `<button role="tab" class="tab" data-ptab="${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (tab === "actions") {
    const suppliers = [...new Set(rows.map((r) => r.part.supplier))].sort();
    const shown = rows.filter((r) => (!filters.action || r.actions.some((a) => a.key === filters.action))
      && (!filters.supplier || r.part.supplier === filters.supplier)
      && (!filters.search || `${r.part.part_number} ${r.part.description}`.toLowerCase().includes(filters.search.toLowerCase())));
    const actLabel = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));
    body = `<div class="filters planner-filters">
        <input type="search" placeholder="Search part" data-pf="search" value="${esc(filters.search)}" aria-label="Search part">
        <select data-pf="action" aria-label="Action"><option value="">All actions</option>${ACTIONS.map((a) => `<option value="${a.key}"${filters.action === a.key ? " selected" : ""}>${a.label} (${count(a.key)})</option>`).join("")}</select>
        <select data-pf="supplier" aria-label="Supplier"><option value="">All suppliers</option>${suppliers.map((s) => `<option${filters.supplier === s ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <span class="muted">${shown.length} part${shown.length === 1 ? "" : "s"} shown, of ${rows.length} with an action out of ${result.parts.length} · most urgent first, then by value</span>
      </div>
      <div class="table-wrap"><table class="grid planner-table"><thead><tr><th>Part</th><th>Supplier</th><th>Program</th><th class="n">On hand</th><th class="n">DOS now</th><th class="n">DOS target</th><th>Action</th><th>Detail</th></tr></thead><tbody>
      ${shown.map((r) => {
        const p = r.part, [first, ...more] = r.actions, a = actLabel[first.key];
        return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td class="pn">${esc(p.part_number)}<div class="muted small">${esc(p.description)}</div></td><td>${esc(p.supplier)}</td>
          <td>${p.analyzed ? badge(p.recommended_program) : `<span class="badge blocked">Blocked</span>`}</td><td class="n">${fmtN(p.on_hand_qty)}</td>
          <td class="n">${p.analyzed ? fmtN(p.dos_current, 0) : dash}</td><td class="n">${p.analyzed ? fmtN(p.dos_target, 0) : dash}</td>
          <td class="nowrap"><span class="${a.cls}">${a.label}</span>${more.length ? `<div class="muted small">+ ${more.map((m) => actLabel[m.key].label.toLowerCase()).filter((v, i, x) => x.indexOf(v) === i).join(", ")}</div>` : ""}</td>
          <td class="detail">${esc(first.detail)}${more.length ? more.map((m) => `<div class="muted small">${esc(m.detail)}</div>`).join("") : ""}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="muted">Nothing to do for this filter.</td></tr>`}
      </tbody></table></div>`;
  } else if (tab === "escalations") {
    body = `<div class="fresh-src"><span class="muted">On hand + open PO (in its due week) − cumulative forecast, 13 weeks. Escalate: short inside the lead time. Place PO: short only after it.</span>
        <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="forecast" hidden>Upload forecast CSV</label>
        <button class="btn" type="button" data-export="escalations">Export escalation list</button></div>
      ${coverageTable(pipe.escalate, "Escalate", "No part runs short inside its lead time.", true)}
      <h3>Place a PO: short after the lead time</h3>
      ${coverageTable(pipe.watch, "Place PO", "No part goes short after its lead time either.", true)}
      ${pipe.noLeadTime.length ? `<p class="hint">${plural(pipe.noLeadTime.length, "part")} without a lead time can't be classified: ${pipe.noLeadTime.map((r) => esc(r.part.part_number)).join(", ")}. Fix the master data first.</p>` : ""}`;
  } else if (tab === "exceptions") {
    body = X ? renderPlannerExceptions(X, xfilters, lib) : "";
  } else if (tab === "forecast") {
    body = forecastTable(pipe);
  } else {
    body = `<h3>Part master</h3>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Part</th><th>Supplier</th><th>Issue</th><th>Effect</th></tr></thead><tbody>
      ${result.parts.filter((p) => p.issues.length).map((p) => `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td class="pn">${esc(p.part_number)}</td><td>${esc(p.supplier)}</td><td>${esc(p.issues.join("; "))}</td><td class="muted">${p.blocking ? "Kept out of the analysis until fixed" : "Analyzed; review"}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No part master issues.</td></tr>`}
      </tbody></table></div>
      <h3>Lot records</h3>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Lot</th><th>Part</th><th class="n">Date code</th><th class="n">Received</th><th>Problem</th></tr></thead><tbody>
      ${(fresh?.invalid || []).map((l) => `<tr><td class="nowrap">${esc(l.lot_id)}</td><td class="pn">${esc(l.part_number)}</td><td class="n">${esc(l.date_code)}</td><td class="n">${esc(l.received_date)}</td><td class="issue-warn">${esc(l.errors.join("; "))}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Every lot has a valid date code and received date.</td></tr>`}
      </tbody></table></div>`;
  }
  return `<div class="card planner-card">
      <div class="card-head"><h2>Planner</h2><span class="hint">What to do this week, part by part. Policy is set by the manager; this layer only shows the actions it creates. Click a part for its numbers. Counts: This week has one row per part with its actions merged; Exceptions has one item per rule broken, so a part can appear there more than once.</span></div>
      ${kpis}${tabBar}<div class="tabpanel">${body}</div></div>`;
}

function coverageTable(list, label, empty, detail) {
  return `<div class="table-wrap"><table class="grid"><thead><tr><th>Status</th><th>Part</th><th>Supplier</th><th class="n">LT (wks)</th><th class="n">On hand</th><th class="n">Open PO</th>
      <th class="n">First short week</th><th class="n">Short qty</th><th class="n">Short value</th>${detail ? `<th class="n">Order by</th><th>13 weeks projected</th>` : ""}</tr></thead><tbody>
    ${list.map((r) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td><span class="${r.status === "Escalate" ? "issue-block" : "issue-warn"}">${label}</span></td>
      <td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td><td class="n">${r.lt}</td><td class="n">${fmtN(r.part.on_hand_qty)}</td>
      <td class="n">${r.po_week ? `${fmtN(r.po_qty)} <span class="muted">wk ${r.po_week}</span>` : dash}</td><td class="n"><b>${r.first_short_week}</b></td>
      <td class="n">${fmtN(r.short_qty)}</td><td class="n">${money(r.short_value)}</td>
      ${detail ? `<td class="n">${r.order_by_week ? `wk ${r.order_by_week}` : `<span class="muted">too late</span>`}</td><td>${spark(r.proj)}</td>` : ""}</tr>`).join("")
      || `<tr><td colspan="${detail ? 11 : 9}" class="muted">${empty}</td></tr>`}
    </tbody></table></div>`;
}

// 13 tiny bars: positive = covered, negative = short.
function spark(proj) {
  const max = Math.max(1, ...proj.map((v) => Math.abs(v)));
  return `<span class="spark" aria-label="Projected stock by week: ${proj.map((v) => fmtN(v)).join(", ")}">${proj.map((v) =>
    `<i class="${v < 0 ? "neg" : ""}" style="height:${Math.max(2, Math.round((Math.abs(v) / max) * 18))}px"></i>`).join("")}</span>`;
}

function forecastTable(pipe) {
  const rows = [...pipe.upside.map((r) => ["Upside", r]), ...pipe.downside.map((r) => ["Downside", r])];
  return `<p class="hint">Average of the next 13 forecast weeks against the recent actual run-rate. Upside: confirm the customer's ramp and the supplier's capacity before it becomes an escalation. Downside: hold or push out open orders before it becomes excess.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Flag</th><th>Part</th><th>Supplier</th><th class="n">Forecast avg / wk</th><th class="n">Actual avg / wk</th><th class="n">Ratio</th><th class="n">On hand</th></tr></thead><tbody>
    ${rows.map(([flag, r]) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td><span class="${flag === "Upside" ? "issue-warn" : ""}">${flag}</span></td><td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td>
      <td class="n">${fmtN(r.fc_avg)}</td><td class="n">${fmtN(r.hist_avg)}</td><td class="n"><b>${Number.isFinite(r.fc_ratio) ? `${fmtN(r.fc_ratio, 2)}×` : "new"}</b></td><td class="n">${fmtN(r.part.on_hand_qty)}</td></tr>`).join("")
      || `<tr><td colspan="7" class="muted">Forecast is in line with history on every part.</td></tr>`}
    </tbody></table></div>`;
}

/* ================= Manager tabs (v2) ================= */
export function renderPipelineTab(pipe, P) {
  const bySup = new Map();
  for (const r of pipe.escalate) {
    const g = bySup.get(r.part.supplier) || { supplier: r.part.supplier, n: 0, value: 0 };
    g.n++; g.value += r.short_value || 0; bySup.set(r.part.supplier, g);
  }
  const sup = [...bySup.values()].sort((a, b) => b.value - a.value);
  return `<div class="fresh-src"><span class="muted">13 weeks of forecast against on hand and the open PO. Escalate = short inside the lead time; Place PO = short after it. Thresholds in Policy → Pipeline coverage.</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="forecast" hidden>Upload forecast CSV</label>
      <button class="btn" type="button" data-export="escalations">Export escalation list</button></div>
    <div class="kpis fresh-kpis">
      ${kpi("Escalate", `${pipe.escalate.length} · ${fmtM(pipe.escalateValue)}`, `top 3 parts carry ${fmtPct(pipe.top3Share)} of the value`, "claim")}
      ${kpi("Place PO", `${pipe.watch.length} · ${fmtM(pipe.watchValue)}`, "short after the lead time", "aging")}
      ${kpi("Covered 13 weeks", fmtN(pipe.covered.length), `${pipe.noLeadTime.length} without lead time`)}
      ${kpi("Forecast vs history", `${pipe.upside.length} up · ${pipe.downside.length} down`, `> ${P.fc_upside}× or < ${P.fc_downside}× the last ${P.fc_hist_weeks} weeks`)}
    </div>
    <h3>Escalations by supplier</h3>
    <p class="hint">${sup.map((g) => `${esc(g.supplier)} ${g.n} (${fmtM(g.value)})`).join(" · ") || "None."}</p>
    <h3>Escalation list</h3>
    ${coverageTable(pipe.escalate.slice(0, 25), "Escalate", "No part runs short inside its lead time.", false)}
    ${pipe.escalate.length > 25 ? `<p class="hint">Top 25 of ${pipe.escalate.length} by value. The full list, week by week, is in the Planner layer and in the export.</p>` : ""}
    <h3>Forecast vs history</h3>${forecastTable(pipe)}`;
}

export function renderScorecard(score, P) {
  return `<h3>Supplier scorecard</h3>
    <div class="kpis fresh-kpis">
      ${kpi("EDI penetration", fmtPct(score.edi_penetration, 1), "of annual spend with EDI-enabled suppliers")}
      ${kpi("VMI penetration", `${fmtPct(score.vmi_now)}${arrow}${fmtPct(score.vmi_rec)}`, "of spend, current vs recommended")}
      ${kpi("VMI without agreement", `${score.noAgreementParts} · ${fmtM(score.noAgreementSpend)}`, "recommended for VMI: negotiate the agreement first", score.noAgreementParts ? "aging" : "")}
      ${kpi("Hub contracts ending", fmtN(score.hubEnding.length), `within ${P.hub_warn_months} months`, score.hubEnding.length ? "aging" : "")}
    </div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Supplier</th><th class="n">Spend</th><th class="n">Pull (rec.)</th><th>EDI</th><th>VMI agreement</th><th>Hub / 3PL</th><th class="n">Contract end</th>
      <th class="n">OTD</th><th class="n">Terms</th><th class="n">Avg LT</th><th class="n">Open claims</th><th>Flags</th></tr></thead><tbody>
    ${score.rows.map((g) => {
      const flags = [
        g.noAgreement.length ? `<span class="issue-warn">Negotiate VMI agreement first (${g.noAgreement.length} part${g.noAgreement.length === 1 ? "" : "s"}, ${fmtM(g.noAgreementSpend)})</span>` : "",
        g.hub_ending ? `<span class="issue-warn">Hub contract ${g.hub_expired ? "expired" : "ends"} ${g.hub_contract_end}</span>` : "",
        !g.in_master ? `<span class="issue-warn">Not in suppliers.csv</span>` : "",
      ].filter(Boolean).join("<br>");
      return `<tr class="clickable" tabindex="0" data-supplier="${esc(g.supplier)}"><td class="pn">${esc(g.supplier)}</td><td class="n">${fmtM(g.spend)}</td><td class="n">${fmtPct(g.pull_rec_share)}</td>
        <td>${yn(g.edi)}</td><td>${yn(g.vmi_agreement)}</td><td>${g.hub ? esc(g.hub) : dash}</td><td class="n">${g.hub_contract_end || dash}</td>
        <td class="n">${Number.isFinite(g.otd) ? `${fmtN(g.otd, 1)}%` : dash}</td><td class="n">${Number.isFinite(g.terms) ? `${g.terms} d` : dash}</td><td class="n">${fmtN(g.avg_lt, 1)} wk</td>
        <td class="n">${g.claimsOpen ? `${g.claimsOpen} · ${fmtM(g.claimsOpenValue)}` : dash}</td><td>${flags || dash}</td></tr>`;
    }).join("")}
    </tbody></table></div>`;
}

export function renderOppsTab(opps, P) {
  return `<p class="hint">Projects to take to suppliers, ranked by the inventory they free. Thresholds in Policy → MOQ &amp; LT opportunities.</p>
    <h3>MOQ reduction: stock carried only because of the MOQ</h3>
    <p class="hint">Parts with MOQ above ${P.moq_opp_weeks} weeks of demand. Value = (MOQ ÷ 2 − avg × R ÷ 2) × cost: the cycle stock the MOQ adds over ordering every review period. ${plural(opps.moq.length, "part")}, ${fmtM(opps.moqValue)}.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Part</th><th>Supplier</th><th>Program</th><th class="n">MOQ</th><th class="n">Avg / wk</th><th class="n">MOQ in weeks</th><th class="n">R (wks)</th><th class="n">Unit cost</th><th class="n">Carried by MOQ</th></tr></thead><tbody>
    ${opps.moq.map((o) => `<tr class="clickable" tabindex="0" data-part="${esc(o.part.part_number)}"><td class="pn">${esc(o.part.part_number)}</td><td>${esc(o.part.supplier)}</td><td>${badge(o.part.recommended_program)}</td>
      <td class="n">${fmtN(o.part.moq)}</td><td class="n">${fmtN(o.part.avg_weekly)}</td><td class="n"><b>${fmtN(o.moq_weeks, 1)}</b></td><td class="n">${o.R}</td><td class="n">${fmtCost(o.part.unit_cost_usd)}</td><td class="n"><b>${fmtUSD(o.value)}</b></td></tr>`).join("")
      || `<tr><td colspan="9" class="muted">No MOQ above ${P.moq_opp_weeks} weeks of demand.</td></tr>`}
    </tbody></table></div>
    <h3>LT reduction: ${P.lt_cut_weeks} weeks off A and Super A parts above ${P.lt_opp_min_weeks} weeks</h3>
    <p class="hint">Safety stock that covers the lead time, z × sd × √(R + LT), recomputed with LT − ${P.lt_cut_weeks}. Under MRP the plant holds that buffer, so the cut frees plant inventory (${fmtM(opps.ltPlantValue)}). Under VMI or CRP the plant's exposure is already ${P.exposure.VMI} weeks and the supplier holds it (${fmtM(opps.ltSupplierValue)}): a negotiating point, not plant cash.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Part</th><th>Supplier</th><th>Class</th><th>Program</th><th class="n">LT now → after</th><th class="n">Safety stock now → after</th><th>Buffer held by</th><th class="n">Value freed</th><th>Note</th></tr></thead><tbody>
    ${opps.lt.map((o) => `<tr class="clickable" tabindex="0" data-part="${esc(o.part.part_number)}"><td class="pn">${esc(o.part.part_number)}</td><td>${esc(o.part.supplier)}</td><td>${o.part.abc}${o.part.super_a ? " · Super A" : ""}</td><td>${badge(o.part.recommended_program)}</td>
      <td class="n">${o.L} → ${o.L2}</td><td class="n">${fmtN(o.ss)} → ${fmtN(o.ss2)}</td><td>${o.holder}</td><td class="n"><b>${fmtUSD(o.value)}</b></td>
      <td class="muted">${o.crossesVmi ? `Drops below the ${o.vmiRule}-week VMI rule: would move to CRP` : ""}</td></tr>`).join("")
      || `<tr><td colspan="9" class="muted">No A part with a lead time above ${P.lt_opp_min_weeks} weeks.</td></tr>`}
    </tbody></table></div>`;
}

// Drawer section: the 13-week projection for one part.
export function drawerCoverage(r) {
  if (!r) return "";
  return `<h3>Next 13 weeks</h3>
    <p class="hint">On hand ${fmtN(r.part.on_hand_qty)}${r.po_week ? ` + open PO ${fmtN(r.po_qty)} in week ${r.po_week}` : ", no open PO"} − forecast. Lead time ${r.lt || "missing"} weeks.${r.status ? ` <b>${r.status === "Escalate" ? "Escalate" : "Place PO"}</b>: short from week ${r.first_short_week}.` : ""}</p>
    <div class="table-wrap"><table class="grid cov13"><thead><tr><th>Week</th>${r.forecast.map((_, i) => `<th class="n">${i + 1}</th>`).join("")}</tr></thead><tbody>
      <tr><td>Forecast</td>${r.forecast.map((v) => `<td class="n">${fmtN(v)}</td>`).join("")}</tr>
      <tr><td>Projected</td>${r.proj.map((v, i) => `<td class="n ${v < 0 ? "issue-block" : ""}${r.lt && i + 1 === Math.min(13, Math.ceil(r.lt)) ? " lt-edge" : ""}">${fmtN(v)}</td>`).join("")}</tr>
    </tbody></table></div>`;
}

/* ================= Exceptions inbox ================= */
const SEV_CLS = ["sev-crit", "sev-high", "sev-med", "sev-low"];
const sevTag = (x) => `<span class="sev ${SEV_CLS[x.sev]}">${x.severity}</span>`;
const impact = (x) => (x.kind && x.value ? `<b>${fmtM(x.value)}</b><div class="muted small">${esc(x.kind)}</div>` : dash);
const owners = ["Planner", "Manager"];

// filters: { search, sev, cat, owner, status: "open" | "all" | one of STATUSES, supplier }; fixedOwner hides the owner filter.
export function renderInbox(X, filters, { STATUSES, SEVERITIES, CATEGORIES, resolutionCodes }, fixedOwner = null) {
  const owner = fixedOwner || filters.owner;
  const base = X.items.filter((x) => !owner || x.owner === owner);
  const shown = base.filter((x) => (filters.status === "all" || (filters.status === "open" ? x.open : x.status === filters.status))
    && (filters.sev === "" || x.severity === filters.sev) && (!filters.cat || x.cat === filters.cat) && (!filters.supplier || x.supplier === filters.supplier)
    && (!filters.search || `${x.part?.part_number || ""} ${x.part?.description || ""} ${x.supplier} ${x.label} ${x.detail}`.toLowerCase().includes(filters.search.toLowerCase())));
  const suppliers = [...new Set(base.map((x) => x.supplier).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`;
  const LIMIT = 150, rows = shown.slice(0, filters.all ? shown.length : LIMIT);
  return `<div class="filters planner-filters">
      <input type="search" placeholder="Search part, supplier, text" data-xf="search" value="${esc(filters.search)}" aria-label="Search exceptions">
      <select data-xf="status" aria-label="Status">${opt("open", "Open + in progress", filters.status)}${STATUSES.map((s) => opt(s, s, filters.status)).join("")}${opt("all", "All statuses", filters.status)}</select>
      <select data-xf="sev" aria-label="Severity">${opt("", "All severities", filters.sev)}${SEVERITIES.map((s) => opt(s, s, filters.sev)).join("")}</select>
      <select data-xf="cat" aria-label="Category">${opt("", "All categories", filters.cat)}${CATEGORIES.map((s) => opt(s, s, filters.cat)).join("")}</select>
      ${fixedOwner ? "" : `<select data-xf="owner" aria-label="Owner">${opt("", "All owners", filters.owner)}${owners.map((s) => opt(s, s, filters.owner)).join("")}</select>`}
      <select data-xf="supplier" aria-label="Supplier">${opt("", "All suppliers", filters.supplier)}${suppliers.map((s) => opt(s, s, filters.supplier)).join("")}</select>
      <span class="muted">${shown.length} shown of ${base.length} · most severe first, past SLA first, then by value</span>
    </div>
    <div class="table-wrap"><table class="grid inbox"><thead><tr><th>Severity</th><th>Exception</th><th>Part / supplier</th><th class="n">Impact</th><th class="n">Weeks to impact</th>
      ${fixedOwner ? "" : "<th>Owner</th>"}<th class="n">Age / SLA</th><th>Status</th><th>Resolution</th><th>Detail and next step</th></tr></thead><tbody>
    ${rows.map((x) => `<tr class="${x.open ? "" : "closed"}${x.pastSla ? " past-sla" : ""}">
      <td class="nowrap">${sevTag(x)}${x.escalatedTo ? `<div class="issue-block small">Past SLA → ${x.escalatedTo}</div>` : ""}</td>
      <td>${esc(x.label)}<div class="muted small">${esc(x.cat)} · ${esc(x.source)}</div></td>
      <td>${x.part ? `<span class="pn clickable" tabindex="0" data-part="${esc(x.part.part_number)}">${esc(x.part.part_number)}</span>` : ""}<div class="muted small">${esc(x.supplier)}</div></td>
      <td class="n">${impact(x)}</td>
      <td class="n">${x.wti == null ? dash : x.wti === 0 ? "now" : `wk ${x.wti}`}${x.lt && x.wti != null && ["Supply at risk", "Cash to commit"].includes(x.kind) ? `<div class="muted small">LT ${x.lt}</div>` : ""}</td>
      ${fixedOwner ? "" : `<td>${x.owner}</td>`}
      <td class="n nowrap"><span class="${x.pastSla ? "issue-block" : ""}">${x.age} d</span> / ${x.sla} d<div class="muted small">due ${x.due}</div></td>
      <td>${x.locked ? `<span title="Managed in the Freshness tab">${x.status}</span><div class="muted small">via Freshness</div>`
        : `<select data-xstatus="${esc(x.id)}" aria-label="Status of ${esc(x.label)} ${esc(x.part?.part_number || x.supplier)}">${STATUSES.map((s) => `<option${s === x.status ? " selected" : ""}>${s}</option>`).join("")}</select>`}</td>
      <td>${x.locked ? dash : `<select data-xres="${esc(x.id)}" aria-label="Resolution"><option value="">—</option>${resolutionCodes(x.cat).map((c) => `<option${c === x.resolution ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>`}</td>
      <td class="detail">${esc(x.detail)}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}<div class="small"><b>Next:</b> ${esc(x.action)}</div></td></tr>`).join("")
      || `<tr><td colspan="${fixedOwner ? 9 : 10}" class="muted">No exception for this filter.</td></tr>`}
    </tbody></table></div>
    ${shown.length > rows.length ? `<p class="hint">Showing ${rows.length} of ${shown.length}. <button type="button" class="btn btn-ghost" data-xall>Show all</button></p>` : ""}`;
}

const sevKpis = (X, list, totalLabel = "") => {
  const c = (i) => list.filter((x) => x.sev === i).length;
  return `${kpi("Critical", fmtN(c(0)), "act today: supply hit now, or inside the lead time and large", c(0) ? "claim" : "")}
    ${totalLabel ? kpi("Open exceptions", fmtN(list.length), totalLabel) : ""}
    ${kpi("High", fmtN(c(1)), "inside the lead time, or large impact", c(1) ? "aging" : "")}
    ${kpi("Medium · Low", `${c(2)} · ${c(3)}`, "impact later, or no money attached")}
    ${kpi("Past SLA", fmtN(list.filter((x) => x.pastSla).length), "escalated one level up", list.some((x) => x.pastSla) ? "claim" : "")}`;
};

export function renderExceptionsTab(X, filters, lib, P, eventsLabel) {
  const ev = X.events;
  return `<div class="fresh-src"><span class="muted">One queue for everything that broke a rule. Detected from the data already loaded, plus supply events (${esc(eventsLabel || "none loaded")}: ${ev.valid} valid${ev.invalid.length ? `, ${ev.invalid.length} invalid` : ""}${ev.belowThreshold.length ? `, ${ev.belowThreshold.length} below threshold` : ""}). Thresholds and SLAs in Policy → Exceptions. Status is kept for this session only.</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="events" hidden>Upload events CSV</label>
      <button class="btn" type="button" data-export="exceptions">Export inbox CSV</button></div>
    <div class="kpis fresh-kpis">${sevKpis(X, X.open, `all owners: ${X.open.filter((x) => x.owner === "Planner").length} planner, ${X.open.filter((x) => x.owner === "Manager").length} manager`)}</div>
    <h3>Impact of open exceptions</h3>
    <p class="hint">Each kind is different money, so they are listed side by side and never added: ${X.byKind.filter((k) => k.n).map((k) => `<b>${esc(k.kind)}</b> ${fmtM(k.value)} (${k.n})`).join(" · ")}.</p>
    <h3>Inbox</h3>
    ${renderInbox(X, filters, lib)}
    <h3>Where exceptions repeat</h3>
    <p class="hint">An exception that comes back every week is not bad luck: the program, the policy or the supplier is wrong. Fix the cause, then resolve with "Policy changed".</p>
    <div class="row2 exc-repeat">
      <div class="table-wrap"><table class="grid"><thead><tr><th>Supplier</th><th class="n">Open</th><th class="n">Critical</th><th class="n">Past SLA</th><th class="n">Supply at risk</th><th class="n">Cost increase / yr</th></tr></thead><tbody>
        ${X.bySupplier.map((g) => `<tr class="clickable" tabindex="0" data-xsupplier="${esc(g.supplier)}"><td>${esc(g.supplier)}</td><td class="n">${g.n}</td><td class="n">${g.critical || dash}</td><td class="n">${g.pastSla || dash}</td><td class="n">${fmtM(g.supplyRisk)}</td><td class="n">${g.costYr ? fmtM(g.costYr) : dash}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">None.</td></tr>`}
      </tbody></table></div>
      <div><p class="hint"><b>${plural(X.repeatParts.length, "part")}</b> carry ${P.exc_repeat} or more kinds of exception: review their program and parameters first.</p>
        <div class="table-wrap"><table class="grid"><thead><tr><th>Part</th><th>Program</th><th>Exceptions</th></tr></thead><tbody>
        ${X.repeatParts.slice(0, 12).map((g) => `<tr class="clickable" tabindex="0" data-part="${esc(g.part.part_number)}"><td class="pn">${esc(g.part.part_number)}<div class="muted small">${esc(g.part.supplier)}</div></td><td>${g.part.analyzed ? badge(g.part.recommended_program) : `<span class="badge blocked">Blocked</span>`}</td><td class="detail">${[...g.types].map(esc).join(", ")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No part repeats.</td></tr>`}
        </tbody></table></div></div>
    </div>
    ${ev.invalid.length || ev.belowThreshold.length ? `<h3>Events not raised</h3>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Event</th><th>Type</th><th>Part</th><th>Why</th></tr></thead><tbody>
      ${ev.invalid.map((e) => `<tr><td class="nowrap">${esc(e.row.event_id)}</td><td>${esc(e.row.event_type)}</td><td class="pn">${esc(e.row.part_number)}</td><td class="issue-warn">${esc(e.errors.join("; "))}</td></tr>`).join("")}
      ${ev.belowThreshold.map((e) => `<tr><td class="nowrap">${esc(e.id)}</td><td>${esc(e.row.event_type)}</td><td class="pn">${esc(e.part.part_number)}</td><td class="muted">${esc(e.why)}: logged, not an exception</td></tr>`).join("")}
    </tbody></table></div>` : ""}`;
}

export function renderPlannerExceptions(X, filters, lib) {
  const mine = X.open.filter((x) => x.owner === "Planner");
  const up = X.open.filter((x) => x.owner === "Manager");
  return `<p class="hint">The planner owns <b>${mine.length}</b> of the <b>${X.open.length}</b> open exceptions; the manager's Exceptions tab and the executive view count all ${X.open.length}. The other ${plural(up.length, "decision")} (EOL, allocation, tariffs, price, lead time, suppliers, E&amp;O) sit with the manager and are not shown here. SLA by severity: past it, an item goes to the manager; past twice the SLA, to the director.</p>
    <div class="kpis fresh-kpis">${sevKpis(X, mine)}</div>
    ${renderInbox(X, filters, lib, "Planner")}`;
}

export function renderExecExceptions(X) {
  const top = X.executive.slice(0, 8);
  return `<article class="card story-card wide">
    <div class="story-card-head"><div class="eyebrow">Exceptions</div></div>
    <h2 class="headline">${X.counts.Critical} critical exceptions open; ${plural(X.executive.length, "item needs", "items need")} a director: past SLA or a critical decision</h2>
    <p class="hint">Counts cover all ${X.open.length} open exceptions, the same queue as the manager's Exceptions tab (${X.open.filter((x) => x.owner === "Planner").length} owned by planners, ${X.open.filter((x) => x.owner === "Manager").length} by the manager); the Planner layer shows only its own. Each kind of impact is different money and is not added up.</p>
    <div class="table-wrap story-table"><table class="grid"><thead><tr><th>Category</th><th class="n">Open</th><th class="n">Critical</th><th class="n">Past SLA</th><th>Impact</th></tr></thead><tbody>
      ${X.byCat.filter((c) => c.n).map((c) => `<tr><td>${esc(c.cat)}</td><td class="n">${c.n}</td><td class="n">${c.critical || dash}</td><td class="n">${c.pastSla ? `<span class="issue-block">${c.pastSla}</span>` : dash}</td>
        <td class="small">${c.kinds.map((k) => `${esc(k.kind)} <b>${fmtM(k.value)}</b>`).join(" · ") || dash}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Needs a director</h3>
    <div class="table-wrap story-table"><table class="grid"><thead><tr><th>Severity</th><th>Exception</th><th>Part / supplier</th><th class="n">Impact</th><th class="n">Age / SLA</th><th>Owner</th></tr></thead><tbody>
      ${top.map((x) => `<tr class="clickable" tabindex="0" data-goto="manager:exceptions"><td class="nowrap">${sevTag(x)}</td><td>${esc(x.label)}<div class="muted small">${esc(x.detail)}</div></td>
        <td>${x.part ? esc(x.part.part_number) : ""}<div class="muted small">${esc(x.supplier)}</div></td><td class="n">${impact(x)}</td>
        <td class="n nowrap"><span class="${x.pastSla ? "issue-block" : ""}">${x.age} d</span> / ${x.sla} d</td><td>${x.owner}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nothing needs a director today.</td></tr>`}
    </tbody></table></div>
    ${X.executive.length > top.length ? `<p class="hint">Top ${top.length} of ${X.executive.length} by severity and value.</p>` : ""}
    <p class="exec-link"><a href="#" data-goto="manager:exceptions">Open the exceptions inbox</a></p>
  </article>`;
}

// Drawer section: open exceptions for one part.
export function drawerExceptions(list) {
  if (!list.length) return "";
  return `<h3>Open exceptions</h3><ul class="exc-list">${list.map((x) => `<li>${sevTag(x)} <b>${esc(x.label)}</b>${x.value && x.kind ? ` · ${fmtM(x.value)} ${esc(x.kind.toLowerCase())}` : ""}<div class="muted small">${esc(x.detail)} Next: ${esc(x.action)}.</div></li>`).join("")}</ul>`;
}
