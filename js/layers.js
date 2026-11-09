// Role layers. Executive: the portfolio in money, service and plan. Planner: what to do this week,
// part by part. Also the Manager tabs added in v2 (pipeline coverage, supplier scorecard, MOQ & LT).
// Render functions return HTML strings; js/app.js wires events. No computation beyond presentation.
import { esc, fmtN, fmtUSD, fmtM, fmtPct, fmtCost } from "./format.js?v=19";
import { VALUE_TYPES } from "./v2.js?v=19";
import { t, tv, tx, getLang } from "./i18n.js?v=19";
import { badge, blockedBadge, paged } from "./ui.js?v=19";

const money = (v) => (Number.isFinite(v) ? fmtUSD(v) : `<span class="muted" title="${t("common.noCost")}">—</span>`);
const dash = `<span class="muted">—</span>`;
const yn = (b) => (b ? t("common.yes") : `<span class="issue-warn">${t("common.no")}</span>`);
const hero = (label, value, sub, cls = "") => `<div class="hero ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const arrow = `<span class="arrow">→</span>`;
const TYPE_CLS = { "Cash, one-time": "t-cash", "P&L, per year": "t-pl", Recovery: "t-rec", "Ownership transfer": "t-own", "Risk to manage": "t-risk" };
const th = (k, n, vars) => `<th${n ? ' class="n"' : ""}>${t(k, vars)}</th>`;

/* ================= Executive ================= */
export function renderExecTop({ E, V, pipe, score, S, P, X, B }) {
  const typeRows = VALUE_TYPES.map((type) => {
    const lines = V.lines.filter((l) => l.type === type);
    const sub = V.byType.find((x) => x.type === type);
    return `<tr class="vp-type"><th colspan="4"><span class="vp-dot ${TYPE_CLS[type]}"></span>${esc(tv("vtype", type))}</th><th class="n">${fmtM(sub.value)}${type === "P&L, per year" ? t("unit.perYr") : ""}</th></tr>` +
      lines.map((l) => `<tr class="clickable" tabindex="0" data-goto="${l.layer}:${l.tab}">
        <td>${esc(tx("vp.i.", l.initiative))}</td><td class="muted">${esc(tx("vp.owner.", l.owner))}</td><td class="muted">${esc(tx("vp.when.", l.when))}</td><td>${esc(tx("vp.status.", l.status))}</td>
        <td class="n"><b>${fmtM(l.value)}</b></td></tr>`).join("");
  }).join("");
  const top = pipe.escalate[0];
  return `
    <div class="story-hero exec-hero">
      ${hero(t("exec.turns"), `${fmtN(E.turns_now, 1)}${arrow}${fmtN(E.turns_target, 1)}`, t("exec.turnsSub"))}
      ${hero(t("exec.dio"), `${fmtN(E.dio_now, 0)}${arrow}${fmtN(E.dio_target, 0)}<span class="unit">${t("unit.days")}</span>`, `${fmtM(S.inv_now)} → ${fmtM(S.inv_target)}`)}
      ${hero(t("exec.wc"), fmtM(E.working_capital), t("exec.wcSub", { e: fmtM(S.excess) }), "excess")}
      ${hero(t("exec.service"), `${E.escalations}<span class="unit">${t("unit.parts")}</span>`, t("exec.serviceSub", { v: fmtM(E.escalation_value) }), "risk")}
      ${hero(t("exec.pull"), `${fmtPct(E.pull_now)}${arrow}${fmtPct(E.pull_rec)}`, t("exec.pullSub", { v0: fmtPct(E.vmi_now), v1: fmtPct(E.vmi_rec), e: fmtPct(E.edi, 1) }))}
    </div>
    <div class="story-grid">
      <article class="card story-card wide">
        <div class="story-card-head"><div class="eyebrow">${t("exec.vp")}</div></div>
        <h2 class="headline">${t("exec.vpHead", { c: fmtM(V.byType[0].value), p: fmtM(V.byType[1].value), r: fmtM(V.byType[4].value) })}</h2>
        <p class="hint">${t("exec.vpHint")}</p>
        <div class="table-wrap story-table"><table class="grid vp"><thead><tr>${th("exec.initiative")}${th("exec.owner")}${th("exec.when")}${th("col.status")}${th("common.value", 1)}</tr></thead>
          <tbody>${typeRows}</tbody></table></div>
        ${B ? cashBridgeTable(B, P) : ""}
      </article>
      ${X ? renderExecExceptions(X) : ""}
      <article class="card story-card">
        <div class="story-card-head"><div class="eyebrow">${t("exec.ship")}</div></div>
        <h2 class="headline">${pipe.escalate.length ? t("exec.shipHead", { n: pipe.escalate.length, p: fmtPct(pipe.top3Share), v: fmtM(pipe.escalateValue) }) : t("exec.shipNone")}</h2>
        <p class="hint">${t("exec.shipHint")}${top ? " " + t("exec.shipTop", { pn: esc(top.part.part_number), s: esc(top.part.supplier), w: top.first_short_week, v: fmtM(top.short_value) }) : ""} ${t("exec.shipWatch", { n: pipe.watch.length, up: pipe.upside.length, down: pipe.downside.length })}</p>
        <p class="exec-link"><a href="#planner" data-goto="planner:escalations">${t("exec.shipLink")}</a></p>
      </article>
      <article class="card story-card">
        <div class="story-card-head"><div class="eyebrow">${t("exec.base")}</div></div>
        <h2 class="headline">${t("exec.baseHead", { e: fmtPct(score.edi_penetration, 1), v0: fmtPct(score.vmi_now), v1: fmtPct(score.vmi_rec) })}</h2>
        <p class="hint">${score.noAgreementParts ? t("exec.baseNoAgr", { n: score.noAgreementParts, v: fmtM(score.noAgreementSpend) }) : t("exec.baseAgrOk")} ${score.hubEnding.length ? t("exec.hubs", { n: score.hubEnding.length, m: P.hub_warn_months, list: score.hubEnding.map((g) => `${esc(g.hub)} (${esc(g.supplier)}, ${esc(g.hub_contract_end)})`).join("; ") }) : ""}</p>
        <p class="exec-link"><a href="#" data-goto="analysis:suppliers">${t("exec.baseLink")}</a></p>
      </article>
    </div>`;
}

// Reconciliation of the three cash figures shown across the app (v2.js cashBridge).
export function cashBridgeTable(B, P) {
  const row = (op, label, v, note, cls = "") => `<tr class="${cls}"><td class="nowrap">${op}</td><td>${label}</td><td class="n">${fmtM(v)}</td><td class="muted small">${note}</td></tr>`;
  return `<h3>${t("bridge.h")}</h3>
    <p class="hint">${t("bridge.hint")}</p>
    <div class="table-wrap story-table"><table class="grid bridge"><thead><tr><th></th>${th("bridge.step")}${th("common.value", 1)}${th("bridge.what")}</tr></thead><tbody>
      ${row("", t("bridge.excess"), B.excess, t("bridge.excessNote", { tol: fmtN(P.tolerance, 2) }))}
      ${row("+", t("bridge.band"), B.band, t("bridge.bandNote"))}
      ${row("=", t("bridge.gross"), B.gross_release, t("bridge.grossNote"), "sub")}
      ${row("−", t("bridge.build"), B.build_up, t("bridge.buildNote"))}
      ${row("=", t("bridge.net"), B.working_capital, t("bridge.netNote"), "sub")}
      ${row("+", t("bridge.moqlt"), B.moq + B.lt_plant, t("bridge.moqltNote"))}
      ${row("=", t("bridge.pipe"), B.pipeline_cash, t("bridge.pipeNote"), "sub")}
    </tbody></table></div>`;
}

/* ================= Planner ================= */
// One row per part with a reason to act, highest priority first. Details are built in the current language.
export const ACTIONS = [
  { key: "expedite", cls: "issue-block" },
  { key: "fix", cls: "issue-block" },
  { key: "build", cls: "issue-warn" },
  { key: "po", cls: "issue-warn" },
  { key: "claim", cls: "issue-warn" },
  { key: "forecast", cls: "" },
  { key: "aging", cls: "" },
  { key: "excess", cls: "" },
];

export function plannerActions({ result, insights, pipe, fresh }) {
  const map = new Map();
  const add = (p, key, detail, weight = 0) => {
    const g = map.get(p.part_number) || { part: p, actions: [], weight: 0 };
    g.actions.push({ key, detail });
    g.weight = Math.max(g.weight, weight);
    map.set(p.part_number, g);
  };
  const byPn = new Map(result.parts.map((p) => [p.part_number, p]));
  const W = Object.fromEntries(ACTIONS.map((a, i) => [a.key, (ACTIONS.length - i) * 1e12]));
  for (const r of pipe.escalate) add(r.part, "expedite", t("pl.dExpedite", { w: r.first_short_week, lt: r.lt, q: fmtN(r.short_qty), v: fmtM(r.short_value) }) + (r.po_week ? t("pl.dOpenPo", { q: fmtN(r.po_qty), w: r.po_week }) : t("pl.dNoPo")), W.expedite + (r.short_value || 0));
  for (const p of result.parts) if (p.blocking || p.issues.length) add(p, "fix", p.issues.map((m) => tx("issue.", m)).join("; "), W.fix);
  for (const l of fresh?.invalid || []) { const p = byPn.get(l.part_number); if (p) add(p, "fix", t("pl.dLot", { lot: l.lot_id, e: l.errors.map((e) => tx("err.", e)).join("; ") }), W.fix); }
  for (const r of insights.critical) add(r.part, "build", t("pl.dBuild", { oh: fmtN(r.part.on_hand_qty), ss: fmtN(r.safety), b: fmtN(r.build_qty) }), W.build + (r.build_value || 0));
  for (const r of pipe.watch) add(r.part, "po", t("pl.dPo", { w: r.first_short_week, by: r.order_by_week, lt: r.lt, q: fmtN(r.short_qty) }), W.po + (r.short_value || 0));
  for (const c of fresh?.claimable || []) { const p = byPn.get(c.part_number); if (p) add(p, "claim", t("pl.dClaim", { lot: c.lot_id, dc: c.date_code, a: fmtN(c.age_receipt, 1), r: c.rule }), W.claim + (c.value || 0)); }
  for (const r of [...pipe.upside, ...pipe.downside]) add(r.part, "forecast", t("pl.dForecast", { f: fmtN(r.fc_avg), h: fmtN(r.hist_avg), r: Number.isFinite(r.fc_ratio) ? `${fmtN(r.fc_ratio, 2)}×` : t("pl.noHistory") }), W.forecast);
  for (const l of fresh?.aging || []) { const p = byPn.get(l.part_number); if (p) add(p, "aging", t("pl.dAging", { lot: l.lot_id, r: l.rule, d: l.expires }), W.aging + (l.value || 0)); }
  // Excess is measured on today's stock against the 26-week average; a shortage comes from the 13-week
  // forecast. When a part has both, say which is when, so nobody cancels the order that covers the shortage.
  const short = new Map([...pipe.escalate, ...pipe.watch].map((r) => [r.part.part_number, r]));
  for (const p of result.analyzed) {
    if (!(p.excess_value > 0)) continue;
    const r = short.get(p.part_number);
    const detail = r
      ? t("pl.dSplit", {
        cov: fmtN(p.on_hand_qty / Math.max(1e-9, r.fc_avg), 1), prog: p.recommended_program, tw: fmtN(p.target_qty / p.avg_weekly, 1),
        rw: t(p.calc.R === 1 ? "pl.everyWeek" : "pl.everyWeeks", { n: p.calc.R }), live: p.program_change ? t("pl.onceLive") : "",
        plan: r.po_week ? t("pl.planPo", { w: r.po_week }) : t("pl.planNoPo"), fc: r.fc_ratio > 1.2 ? t("pl.fcAbove", { p: fmtPct(r.fc_ratio - 1) }) : "",
        w: r.first_short_week, e: fmtM(p.excess_value), act: r.status === "Escalate" ? t("pl.actExpedite") : t("pl.actPo"),
      })
      : t("pl.dExcess", { e: fmtM(p.excess_value) });
    add(p, "excess", detail, W.excess + p.excess_value);
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

export function renderPlanner({ rows, pipe, insights, fresh, result, filters, tab, X, xfilters, lib }) {
  const count = (k) => rows.filter((r) => r.actions.some((a) => a.key === k)).length;
  const fixes = result.parts.filter((p) => p.issues.length).length + (fresh?.invalid.length || 0);
  const kpis = `<div class="kpis planner-kpis">
    ${kpi(t("act.expedite"), `${pipe.escalate.length} · ${fmtM(pipe.escalateValue)}`, t("pl.kExpedite"), "claim")}
    ${kpi(t("pl.kPo"), fmtN(pipe.watch.length), t("pl.kPoSub"), "aging")}
    ${kpi(t("act.build"), fmtN(insights.critical.length), t("pl.kBuildSub", { v: fmtM(insights.criticalBuild) }), "aging")}
    ${kpi(t("act.forecast"), t("common.upDown", { u: pipe.upside.length, d: pipe.downside.length }), t("pl.kFcSub"))}
    ${kpi(t("pl.kFresh"), fmtN(fresh?.claimable.length || 0), t("pl.kFreshSub", { n: fresh?.aging.length || 0 }))}
    ${kpi(t("pl.kData"), fmtN(fixes), t("pl.kDataSub"))}
  </div>`;
  const mineCrit = X ? X.open.filter((x) => x.owner === "Planner" && x.sev === 0).length : 0;
  const tabs = [["actions", t("pl.tActions")], ["exceptions", `${t("tab.exceptions")}${mineCrit ? ` <span class="pill" title="${t("pl.critTitle")}">${mineCrit}</span>` : ""}`], ["escalations", t("pl.tEsc")], ["forecast", t("pl.tFc")], ["fixes", t("pl.tFix")]];
  const tabBar = `<div class="tabs" role="tablist" aria-label="${t("layer.planner")}">${tabs.map(([k, l]) => `<button role="tab" class="tab" data-ptab="${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (tab === "actions") {
    const suppliers = [...new Set(rows.map((r) => r.part.supplier))].sort();
    const q = filters.search.toLowerCase();
    const shown = rows.filter((r) => (!filters.action || r.actions.some((a) => a.key === filters.action))
      && (!filters.supplier || r.part.supplier === filters.supplier)
      && (!q || `${r.part.part_number} ${r.part.description}`.toLowerCase().includes(q)));
    const actCls = Object.fromEntries(ACTIONS.map((a) => [a.key, a.cls]));
    body = `<div class="filters planner-filters">
        <input type="search" placeholder="${t("pl.search")}" data-pf="search" value="${esc(filters.search)}" aria-label="${t("pl.search")}">
        <select data-pf="action" aria-label="${t("pl.action")}"><option value="">${t("pl.allActions")}</option>${ACTIONS.map((a) => `<option value="${a.key}"${filters.action === a.key ? " selected" : ""}>${t(`act.${a.key}`)} (${count(a.key)})</option>`).join("")}</select>
        <select data-pf="supplier" aria-label="${t("col.supplier")}"><option value="">${t("filter.allSuppliers")}</option>${suppliers.map((s) => `<option value="${esc(s)}"${filters.supplier === s ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <span class="muted">${t("pl.shown", { n: shown.length, a: rows.length, total: result.parts.length })}</span>
      </div>
      <div class="table-wrap"><table class="grid planner-table"><thead><tr>${th("col.part_number")}${th("col.supplier")}${th("pl.program")}${th("drawer.onHand", 1)}${th("col.dos_current", 1)}${th("col.dos_target", 1)}${th("pl.action")}${th("integ.detail")}</tr></thead><tbody>
      ${paged(shown, "planner", (r) => {
        const p = r.part, [first, ...more] = r.actions;
        return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td class="pn">${esc(p.part_number)}<div class="muted small">${esc(p.description)}</div></td><td>${esc(p.supplier)}</td>
          <td>${p.analyzed ? badge(p.recommended_program) : blockedBadge()}</td><td class="n">${fmtN(p.on_hand_qty)}</td>
          <td class="n">${p.analyzed ? fmtN(p.dos_current, 0) : dash}</td><td class="n">${p.analyzed ? fmtN(p.dos_target, 0) : dash}</td>
          <td class="nowrap"><span class="${actCls[first.key]}">${t(`act.${first.key}`)}</span>${more.length ? `<div class="muted small">+ ${more.map((m) => t(`act.${m.key}`).toLowerCase()).filter((v, i, x) => x.indexOf(v) === i).join(", ")}</div>` : ""}</td>
          <td class="detail">${esc(first.detail)}${more.length ? more.map((m) => `<div class="muted small">${esc(m.detail)}</div>`).join("") : ""}</td></tr>`;
      }, 8) || `<tr><td colspan="8" class="muted">${t("pl.none")}</td></tr>`}
      </tbody></table></div>`;
  } else if (tab === "escalations") {
    body = `<div class="fresh-src"><span class="muted">${t("pl.escSrc")}</span>
        <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="forecast" hidden>${t("pipe.upload")}</label>
        <button class="btn" type="button" data-export="escalations">${t("pipe.export")}</button></div>
      ${coverageTable(pipe.escalate, "Escalate", t("pipe.noEsc"), true, "plEsc")}
      <h3>${t("pl.hPo")}</h3>
      ${coverageTable(pipe.watch, "Place PO", t("pipe.noWatch"), true, "plWatch")}
      ${pipe.noLeadTime.length ? `<p class="hint">${t("pl.noLt", { n: pipe.noLeadTime.length, list: pipe.noLeadTime.map((r) => esc(r.part.part_number)).join(", ") })}</p>` : ""}`;
  } else if (tab === "exceptions") {
    body = X ? renderPlannerExceptions(X, xfilters, lib) : "";
  } else if (tab === "forecast") {
    body = forecastTable(pipe, "plFc");
  } else {
    body = `<h3>${t("pl.hMaster")}</h3>
      <div class="table-wrap"><table class="grid"><thead><tr>${th("col.part_number")}${th("col.supplier")}${th("integ.issue")}${th("integ.effect")}</tr></thead><tbody>
      ${paged(result.parts.filter((p) => p.issues.length), "plFix", (p) => `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td class="pn">${esc(p.part_number)}</td><td>${esc(p.supplier)}</td><td>${esc(p.issues.map((m) => tx("issue.", m)).join("; "))}</td><td class="muted">${p.blocking ? t("pl.effBlock") : t("pl.effWarn")}</td></tr>`, 4) || `<tr><td colspan="4" class="muted">${t("pl.noMaster")}</td></tr>`}
      </tbody></table></div>
      <h3>${t("pl.hLots")}</h3>
      <div class="table-wrap"><table class="grid"><thead><tr>${th("fresh.lot")}${th("col.part_number")}${th("fresh.dateCode", 1)}${th("fresh.received", 1)}${th("fresh.problem")}</tr></thead><tbody>
      ${paged(fresh?.invalid || [], "plLots", (l) => `<tr><td class="nowrap">${esc(l.lot_id)}</td><td class="pn">${esc(l.part_number)}</td><td class="n">${esc(l.date_code)}</td><td class="n">${esc(l.received_date)}</td><td class="issue-warn">${esc(l.errors.map((e) => tx("err.", e)).join("; "))}</td></tr>`, 5) || `<tr><td colspan="5" class="muted">${t("fresh.allValid")}</td></tr>`}
      </tbody></table></div>`;
  }
  return `<div class="card planner-card">
      <div class="card-head"><h2>${t("layer.planner")}</h2><span class="hint">${t("pl.intro")}</span></div>
      ${kpis}${tabBar}<div class="tabpanel">${body}</div></div>`;
}

function coverageTable(list, status, empty, detail, key) {
  const label = status === "Escalate" ? t("pipe.escalate") : t("pipe.placePo");
  const cols = detail ? 11 : 9;
  return `<div class="table-wrap"><table class="grid"><thead><tr>${th("col.status")}${th("col.part_number")}${th("col.supplier")}${th("pipe.lt", 1)}${th("drawer.onHand", 1)}${th("pipe.openPo", 1)}
      ${th("pipe.firstShort", 1)}${th("pipe.shortQty", 1)}${th("pipe.shortValue", 1)}${detail ? `${th("pipe.orderBy", 1)}${th("pipe.proj13")}` : ""}</tr></thead><tbody>
    ${paged(list, key, (r) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td><span class="${r.status === "Escalate" ? "issue-block" : "issue-warn"}">${label}</span></td>
      <td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td><td class="n">${r.lt}</td><td class="n">${fmtN(r.part.on_hand_qty)}</td>
      <td class="n">${r.po_week ? `${fmtN(r.po_qty)} <span class="muted">${t("pipe.wkN", { w: r.po_week })}</span>` : dash}</td><td class="n"><b>${r.first_short_week}</b></td>
      <td class="n">${fmtN(r.short_qty)}</td><td class="n">${money(r.short_value)}</td>
      ${detail ? `<td class="n">${r.order_by_week ? t("pipe.wkN", { w: r.order_by_week }) : `<span class="muted">${t("pipe.tooLate")}</span>`}</td><td>${spark(r.proj)}</td>` : ""}</tr>`, cols)
      || `<tr><td colspan="${cols}" class="muted">${empty}</td></tr>`}
    </tbody></table></div>`;
}

// 13 tiny bars: positive = covered, negative = short.
function spark(proj) {
  const max = Math.max(1, ...proj.map((v) => Math.abs(v)));
  return `<span class="spark" role="img" aria-label="${t("pipe.sparkAria", { list: proj.map((v) => fmtN(v)).join(", ") })}">${proj.map((v) =>
    `<i class="${v < 0 ? "neg" : ""}" style="height:${Math.max(2, Math.round((Math.abs(v) / max) * 18))}px"></i>`).join("")}</span>`;
}

function forecastTable(pipe, key = "fc") {
  const rows = [...pipe.upside.map((r) => ["Upside", r]), ...pipe.downside.map((r) => ["Downside", r])];
  return `<p class="hint">${t("fc.hint")}</p>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("fc.flag")}${th("col.part_number")}${th("col.supplier")}${th("fc.fcAvg", 1)}${th("fc.actAvg", 1)}${th("fc.ratio", 1)}${th("drawer.onHand", 1)}</tr></thead><tbody>
    ${paged(rows, key, ([flag, r]) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td><span class="${flag === "Upside" ? "issue-warn" : ""}">${t(flag === "Upside" ? "fc.upside" : "fc.downside")}</span></td><td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td>
      <td class="n">${fmtN(r.fc_avg)}</td><td class="n">${fmtN(r.hist_avg)}</td><td class="n"><b>${Number.isFinite(r.fc_ratio) ? `${fmtN(r.fc_ratio, 2)}×` : t("fc.new")}</b></td><td class="n">${fmtN(r.part.on_hand_qty)}</td></tr>`, 7)
      || `<tr><td colspan="7" class="muted">${t("fc.none")}</td></tr>`}
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
  return `<div class="fresh-src"><span class="muted">${t("pipe.src")}</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="forecast" hidden>${t("pipe.upload")}</label>
      <button class="btn" type="button" data-export="escalations">${t("pipe.export")}</button></div>
    <div class="kpis fresh-kpis">
      ${kpi(t("pipe.escalate"), `${pipe.escalate.length} · ${fmtM(pipe.escalateValue)}`, t("pipe.kEscSub", { p: fmtPct(pipe.top3Share) }), "claim")}
      ${kpi(t("pipe.placePo"), `${pipe.watch.length} · ${fmtM(pipe.watchValue)}`, t("pipe.kPoSub"), "aging")}
      ${kpi(t("pipe.kCovered"), fmtN(pipe.covered.length), t("pipe.kCoveredSub", { n: pipe.noLeadTime.length }))}
      ${kpi(t("pipe.kFc"), t("common.upDown", { u: pipe.upside.length, d: pipe.downside.length }), t("pipe.kFcSub", { u: P.fc_upside, d: P.fc_downside, w: P.fc_hist_weeks }))}
    </div>
    <h3>${t("pipe.hBySup")}</h3>
    <p class="hint">${sup.map((g) => `${esc(g.supplier)} ${g.n} (${fmtM(g.value)})`).join(" · ") || t("common.none")}</p>
    <h3>${t("pipe.hList")}</h3>
    ${coverageTable(pipe.escalate.slice(0, 25), "Escalate", t("pipe.noEsc"), false, "pipeEsc")}
    ${pipe.escalate.length > 25 ? `<p class="hint">${t("pipe.top25", { n: pipe.escalate.length })}</p>` : ""}
    <h3>${t("pipe.kFc")}</h3>${forecastTable(pipe, "pipeFc")}`;
}

export function renderScorecard(score, P) {
  return `<h3>${t("score.h")}</h3>
    <div class="kpis fresh-kpis">
      ${kpi(t("score.edi"), fmtPct(score.edi_penetration, 1), t("score.ediSub"))}
      ${kpi(t("score.vmi"), `${fmtPct(score.vmi_now)}${arrow}${fmtPct(score.vmi_rec)}`, t("score.vmiSub"))}
      ${kpi(t("score.noAgr"), `${score.noAgreementParts} · ${fmtM(score.noAgreementSpend)}`, t("score.noAgrSub"), score.noAgreementParts ? "aging" : "")}
      ${kpi(t("score.hubs"), fmtN(score.hubEnding.length), t("score.hubsSub", { n: P.hub_warn_months }), score.hubEnding.length ? "aging" : "")}
    </div>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("col.supplier")}${th("score.spend", 1)}${th("score.pullRec", 1)}<th>EDI</th>${th("score.vmiAgr")}<th>Hub / 3PL</th>${th("score.end", 1)}
      <th class="n">OTD</th>${th("score.terms", 1)}${th("score.avgLt", 1)}${th("score.claims", 1)}${th("score.flags")}</tr></thead><tbody>
    ${paged(score.rows, "score", (g) => {
      const flags = [
        g.noAgreement.length ? `<span class="issue-warn">${t("score.fNoAgr", { n: g.noAgreement.length, v: fmtM(g.noAgreementSpend) })}</span>` : "",
        g.hub_ending ? `<span class="issue-warn">${t(g.hub_expired ? "score.fHubExpired" : "score.fHubEnds", { d: esc(g.hub_contract_end) })}</span>` : "",
        !g.in_master ? `<span class="issue-warn">${t("score.fNotMaster")}</span>` : "",
      ].filter(Boolean).join("<br>");
      return `<tr class="clickable" tabindex="0" data-supplier="${esc(g.supplier)}"><td class="pn">${esc(g.supplier)}</td><td class="n">${fmtM(g.spend)}</td><td class="n">${fmtPct(g.pull_rec_share)}</td>
        <td>${yn(g.edi)}</td><td>${yn(g.vmi_agreement)}</td><td>${g.hub ? esc(g.hub) : dash}</td><td class="n">${g.hub_contract_end ? esc(g.hub_contract_end) : dash}</td>
        <td class="n">${Number.isFinite(g.otd) ? `${fmtN(g.otd, 1)}%` : dash}</td><td class="n">${Number.isFinite(g.terms) ? t("score.daysN", { n: g.terms }) : dash}</td><td class="n">${fmtN(g.avg_lt, 1)} ${t("unit.wk")}</td>
        <td class="n">${g.claimsOpen ? `${g.claimsOpen} · ${fmtM(g.claimsOpenValue)}` : dash}</td><td>${flags || dash}</td></tr>`;
    }, 12)}
    </tbody></table></div>`;
}

export function renderOppsTab(opps, P) {
  return `<p class="hint">${t("opps.intro")}</p>
    <h3>${t("opps.hMoq")}</h3>
    <p class="hint">${t("opps.moqHint", { w: P.moq_opp_weeks, n: opps.moq.length, v: fmtM(opps.moqValue) })}</p>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("col.part_number")}${th("col.supplier")}${th("pl.program")}<th class="n">MOQ</th>${th("opps.avg", 1)}${th("opps.moqWeeks", 1)}${th("opps.r", 1)}${th("drawer.unitCost", 1)}${th("opps.carried", 1)}</tr></thead><tbody>
    ${paged(opps.moq, "moq", (o) => `<tr class="clickable" tabindex="0" data-part="${esc(o.part.part_number)}"><td class="pn">${esc(o.part.part_number)}</td><td>${esc(o.part.supplier)}</td><td>${badge(o.part.recommended_program)}</td>
      <td class="n">${fmtN(o.part.moq)}</td><td class="n">${fmtN(o.part.avg_weekly)}</td><td class="n"><b>${fmtN(o.moq_weeks, 1)}</b></td><td class="n">${o.R}</td><td class="n">${fmtCost(o.part.unit_cost_usd)}</td><td class="n"><b>${fmtUSD(o.value)}</b></td></tr>`, 9)
      || `<tr><td colspan="9" class="muted">${t("opps.noMoq", { w: P.moq_opp_weeks })}</td></tr>`}
    </tbody></table></div>
    <h3>${t("opps.hLt", { c: P.lt_cut_weeks, m: P.lt_opp_min_weeks })}</h3>
    <p class="hint">${t("opps.ltHint", { c: P.lt_cut_weeks, plant: fmtM(opps.ltPlantValue), e: P.exposure.VMI, sup: fmtM(opps.ltSupplierValue) })}</p>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("col.part_number")}${th("col.supplier")}${th("opps.class")}${th("pl.program")}${th("opps.ltNowAfter", 1)}${th("opps.ssNowAfter", 1)}${th("opps.holder")}${th("opps.freed", 1)}${th("opps.note")}</tr></thead><tbody>
    ${paged(opps.lt, "lt", (o) => `<tr class="clickable" tabindex="0" data-part="${esc(o.part.part_number)}"><td class="pn">${esc(o.part.part_number)}</td><td>${esc(o.part.supplier)}</td><td>${o.part.abc}${o.part.super_a ? " · Super A" : ""}</td><td>${badge(o.part.recommended_program)}</td>
      <td class="n">${o.L} → ${o.L2}</td><td class="n">${fmtN(o.ss)} → ${fmtN(o.ss2)}</td><td>${tv("holder", o.holder)}</td><td class="n"><b>${fmtUSD(o.value)}</b></td>
      <td class="muted">${o.crossesVmi ? t("opps.crossesVmi", { w: o.vmiRule }) : ""}</td></tr>`, 9)
      || `<tr><td colspan="9" class="muted">${t("opps.noLt", { m: P.lt_opp_min_weeks })}</td></tr>`}
    </tbody></table></div>`;
}

// Drawer section: the 13-week projection for one part.
export function drawerCoverage(r) {
  if (!r) return "";
  return `<h3>${t("cov.h")}</h3>
    <p class="hint">${t("cov.hint", { oh: fmtN(r.part.on_hand_qty), po: r.po_week ? t("cov.po", { q: fmtN(r.po_qty), w: r.po_week }) : t("cov.noPo"), lt: r.lt || t("drawer.missing") })}${r.status ? ` <b>${r.status === "Escalate" ? t("pipe.escalate") : t("pipe.placePo")}</b>: ${t("cov.shortFrom", { w: r.first_short_week })}` : ""}</p>
    <div class="table-wrap"><table class="grid cov13"><thead><tr>${th("cov.week")}${r.forecast.map((_, i) => `<th class="n">${i + 1}</th>`).join("")}</tr></thead><tbody>
      <tr><td>Forecast</td>${r.forecast.map((v) => `<td class="n">${fmtN(v)}</td>`).join("")}</tr>
      <tr><td>${t("cov.projected")}</td>${r.proj.map((v, i) => `<td class="n ${v < 0 ? "issue-block" : ""}${r.lt && i + 1 === Math.min(13, Math.ceil(r.lt)) ? " lt-edge" : ""}">${fmtN(v)}</td>`).join("")}</tr>
    </tbody></table></div>`;
}

// Claim text for the supplier, in the screen's language. The CSV export keeps the English text (freshness.js claimText).
export function claimTextFor(c) {
  if (getLang() === "en") return c.claim_text;
  return [
    t("claim.l1", { lot: c.lot_id, pn: c.part_number, d: c.description ? ` (${c.description})` : "" }),
    t("claim.l2", { s: c.supplier }),
    t("claim.l3", { dc: c.date_code, w: String(c.week).padStart(2, "0"), y: c.year, m: c.mfg_date, r: c.received_date }),
    t("claim.l4", { a: fmtN(c.age_receipt, 1), rule: c.rule, o: fmtN(c.age_receipt - c.rule, 1) }),
    Number.isFinite(c.value) ? t("claim.l5", { q: fmtN(c.qty), v: fmtUSD(c.value, 2), u: fmtCost(c.unit_cost) }) : t("claim.l5none", { q: fmtN(c.qty) }),
    t("claim.l6"),
  ].join(" ");
}

/* ================= Exceptions inbox ================= */
const SEV_CLS = ["sev-crit", "sev-high", "sev-med", "sev-low"];
const sevTag = (x) => `<span class="sev ${SEV_CLS[x.sev]}">${tv("sev", x.severity)}</span>`;
const impact = (x) => (x.kind && x.value ? `<b>${fmtM(x.value)}</b><div class="muted small">${esc(tv("kind", x.kind))}</div>` : dash);
const owners = ["Planner", "Manager"];
const xDetail = (x) => esc(tx("exc.d.", x.detail));
const xSource = (x) => (x.source === "Detected" ? t("exc.detected") : t("exc.event", { id: esc(x.source.replace(/^Event /, "")) }));

// filters: { search, sev, cat, owner, status: "open" | "all" | one of STATUSES, supplier }; fixedOwner hides the owner filter.
export function renderInbox(X, filters, { STATUSES, SEVERITIES, CATEGORIES, resolutionCodes }, fixedOwner = null) {
  const owner = fixedOwner || filters.owner;
  const base = X.items.filter((x) => !owner || x.owner === owner);
  const q = filters.search.toLowerCase();
  const shown = base.filter((x) => (filters.status === "all" || (filters.status === "open" ? x.open : x.status === filters.status))
    && (filters.sev === "" || x.severity === filters.sev) && (!filters.cat || x.cat === filters.cat) && (!filters.supplier || x.supplier === filters.supplier)
    && (!q || `${x.part?.part_number || ""} ${x.part?.description || ""} ${x.supplier} ${x.label} ${x.detail} ${tv("exc.t", x.label)} ${tx("exc.d.", x.detail)}`.toLowerCase().includes(q)));
  const suppliers = [...new Set(base.map((x) => x.supplier).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`;
  const LIMIT = 150, rows = shown.slice(0, filters.all ? shown.length : LIMIT);
  return `<div class="filters planner-filters">
      <input type="search" placeholder="${t("inbox.search")}" data-xf="search" value="${esc(filters.search)}" aria-label="${t("inbox.searchAria")}">
      <select data-xf="status" aria-label="${t("col.status")}">${opt("open", t("inbox.openInProg"), filters.status)}${STATUSES.map((s) => opt(s, tv("xst", s), filters.status)).join("")}${opt("all", t("inbox.allStatuses"), filters.status)}</select>
      <select data-xf="sev" aria-label="${t("integ.severity")}">${opt("", t("inbox.allSev"), filters.sev)}${SEVERITIES.map((s) => opt(s, tv("sev", s), filters.sev)).join("")}</select>
      <select data-xf="cat" aria-label="${t("inbox.category")}">${opt("", t("inbox.allCat"), filters.cat)}${CATEGORIES.map((s) => opt(s, tv("cat", s), filters.cat)).join("")}</select>
      ${fixedOwner ? "" : `<select data-xf="owner" aria-label="${t("exec.owner")}">${opt("", t("inbox.allOwners"), filters.owner)}${owners.map((s) => opt(s, tv("owner", s), filters.owner)).join("")}</select>`}
      <select data-xf="supplier" aria-label="${t("col.supplier")}">${opt("", t("filter.allSuppliers"), filters.supplier)}${suppliers.map((s) => opt(s, s, filters.supplier)).join("")}</select>
      <span class="muted">${t("inbox.shown", { n: shown.length, total: base.length })}</span>
    </div>
    <div class="table-wrap"><table class="grid inbox"><thead><tr>${th("integ.severity")}${th("inbox.exception")}${th("inbox.partSup")}${th("inbox.impact", 1)}${th("inbox.wti", 1)}
      ${fixedOwner ? "" : th("exec.owner")}${th("inbox.ageSla", 1)}${th("col.status")}${th("inbox.resolution")}${th("inbox.detailNext")}</tr></thead><tbody>
    ${rows.map((x) => `<tr class="${x.open ? "" : "closed"}${x.pastSla ? " past-sla" : ""}">
      <td class="nowrap">${sevTag(x)}${x.escalatedTo ? `<div class="issue-block small">${t("inbox.pastSlaTo", { to: tv("owner", x.escalatedTo) })}</div>` : ""}</td>
      <td>${esc(tv("exc.t", x.label))}<div class="muted small">${esc(tv("cat", x.cat))} · ${xSource(x)}</div></td>
      <td>${x.part ? `<span class="pn clickable" tabindex="0" data-part="${esc(x.part.part_number)}">${esc(x.part.part_number)}</span>` : ""}<div class="muted small">${esc(x.supplier)}</div></td>
      <td class="n">${impact(x)}</td>
      <td class="n">${x.wti == null ? dash : x.wti === 0 ? t("inbox.now") : t("pipe.wkN", { w: x.wti })}${x.lt && x.wti != null && ["Supply at risk", "Cash to commit"].includes(x.kind) ? `<div class="muted small">LT ${x.lt}</div>` : ""}</td>
      ${fixedOwner ? "" : `<td>${tv("owner", x.owner)}</td>`}
      <td class="n nowrap"><span class="${x.pastSla ? "issue-block" : ""}">${t("inbox.d", { n: x.age })}</span> / ${t("inbox.d", { n: x.sla })}<div class="muted small">${t("inbox.due", { d: x.due })}</div></td>
      <td>${x.locked ? `<span title="${t("inbox.viaFreshTitle")}">${tv("xst", x.status)}</span><div class="muted small">${t("inbox.viaFresh")}</div>`
        : `<select data-xstatus="${esc(x.id)}" aria-label="${t("inbox.statusAria", { l: esc(tv("exc.t", x.label)), p: esc(x.part?.part_number || x.supplier) })}">${STATUSES.map((s) => `<option value="${esc(s)}"${s === x.status ? " selected" : ""}>${esc(tv("xst", s))}</option>`).join("")}</select>`}</td>
      <td>${x.locked ? dash : `<select data-xres="${esc(x.id)}" aria-label="${t("inbox.resolution")}"><option value="">—</option>${resolutionCodes(x.cat).map((c) => `<option value="${esc(c)}"${c === x.resolution ? " selected" : ""}>${esc(tv("res", c))}</option>`).join("")}</select>`}</td>
      <td class="detail">${xDetail(x)}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ""}<div class="small"><b>${t("inbox.next")}</b> ${esc(tv("exc.a", x.action))}</div></td></tr>`).join("")
      || `<tr><td colspan="${fixedOwner ? 9 : 10}" class="muted">${t("inbox.none")}</td></tr>`}
    </tbody></table></div>
    ${shown.length > rows.length ? `<p class="hint">${t("inbox.showing", { n: rows.length, total: shown.length })} <button type="button" class="btn btn-ghost" data-xall>${t("common.showAll", { n: shown.length })}</button></p>` : ""}`;
}

const sevKpis = (X, list, totalLabel = "") => {
  const c = (i) => list.filter((x) => x.sev === i).length;
  return `${kpi(tv("sev", "Critical"), fmtN(c(0)), t("inbox.kCrit"), c(0) ? "claim" : "")}
    ${totalLabel ? kpi(t("inbox.kOpen"), fmtN(list.length), totalLabel) : ""}
    ${kpi(tv("sev", "High"), fmtN(c(1)), t("inbox.kHigh"), c(1) ? "aging" : "")}
    ${kpi(`${tv("sev", "Medium")} · ${tv("sev", "Low")}`, `${c(2)} · ${c(3)}`, t("inbox.kMedLow"))}
    ${kpi(t("inbox.kPast"), fmtN(list.filter((x) => x.pastSla).length), t("inbox.kPastSub"), list.some((x) => x.pastSla) ? "claim" : "")}`;
};

export function renderExceptionsTab(X, filters, lib, P, eventsLabel) {
  const ev = X.events;
  const evInfo = t("exc.evInfo", { f: esc(eventsLabel || t("fresh.noneLoaded")), v: ev.valid }) + (ev.invalid.length ? t("exc.evInvalid", { n: ev.invalid.length }) : "") + (ev.belowThreshold.length ? t("exc.evBelow", { n: ev.belowThreshold.length }) : "");
  return `<div class="fresh-src"><span class="muted">${t("exc.src", { ev: evInfo })}</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="events" hidden>${t("exc.upload")}</label>
      <button class="btn" type="button" data-export="exceptions">${t("exc.export")}</button></div>
    <div class="kpis fresh-kpis">${sevKpis(X, X.open, t("exc.allOwners", { p: X.open.filter((x) => x.owner === "Planner").length, m: X.open.filter((x) => x.owner === "Manager").length }))}</div>
    <h3>${t("exc.hImpact")}</h3>
    <p class="hint">${t("exc.impactHint")} ${X.byKind.filter((k) => k.n).map((k) => `<b>${esc(tv("kind", k.kind))}</b> ${fmtM(k.value)} (${k.n})`).join(" · ")}.</p>
    <h3>${t("exc.hInbox")}</h3>
    ${renderInbox(X, filters, lib)}
    <h3>${t("exc.hRepeat")}</h3>
    <p class="hint">${t("exc.repeatHint")}</p>
    <div class="row2 exc-repeat">
      <div class="table-wrap"><table class="grid"><thead><tr>${th("col.supplier")}${th("exc.open", 1)}${th("exc.critical", 1)}${th("inbox.kPast", 1)}${th("exc.supplyRisk", 1)}${th("exc.costYr", 1)}</tr></thead><tbody>
        ${paged(X.bySupplier, "xsup", (g) => `<tr class="clickable" tabindex="0" data-xsupplier="${esc(g.supplier)}"><td>${esc(g.supplier)}</td><td class="n">${g.n}</td><td class="n">${g.critical || dash}</td><td class="n">${g.pastSla || dash}</td><td class="n">${fmtM(g.supplyRisk)}</td><td class="n">${g.costYr ? fmtM(g.costYr) : dash}</td></tr>`, 6) || `<tr><td colspan="6" class="muted">${t("common.none")}</td></tr>`}
      </tbody></table></div>
      <div><p class="hint">${t("exc.repeatParts", { n: X.repeatParts.length, k: P.exc_repeat })}</p>
        <div class="table-wrap"><table class="grid"><thead><tr>${th("col.part_number")}${th("pl.program")}${th("tab.exceptions")}</tr></thead><tbody>
        ${X.repeatParts.slice(0, 12).map((g) => `<tr class="clickable" tabindex="0" data-part="${esc(g.part.part_number)}"><td class="pn">${esc(g.part.part_number)}<div class="muted small">${esc(g.part.supplier)}</div></td><td>${g.part.analyzed ? badge(g.part.recommended_program) : blockedBadge()}</td><td class="detail">${[...g.types].map((x) => esc(tv("exc.t", x))).join(", ")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">${t("exc.noRepeat")}</td></tr>`}
        </tbody></table></div></div>
    </div>
    ${ev.invalid.length || ev.belowThreshold.length ? `<h3>${t("exc.hNotRaised")}</h3>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("exc.event2")}${th("exc.type")}${th("col.part_number")}${th("risk.why")}</tr></thead><tbody>
      ${ev.invalid.map((e) => `<tr><td class="nowrap">${esc(e.row.event_id)}</td><td>${esc(e.row.event_type)}</td><td class="pn">${esc(e.row.part_number)}</td><td class="issue-warn">${esc(e.errors.map((x) => tx("evErr.", x)).join("; "))}</td></tr>`).join("")}
      ${ev.belowThreshold.map((e) => `<tr><td class="nowrap">${esc(e.id)}</td><td>${esc(e.row.event_type)}</td><td class="pn">${esc(e.part.part_number)}</td><td class="muted">${esc(t("exc.logged", { why: tx("evErr.", e.why) }))}</td></tr>`).join("")}
    </tbody></table></div>` : ""}`;
}

export function renderPlannerExceptions(X, filters, lib) {
  const mine = X.open.filter((x) => x.owner === "Planner");
  const up = X.open.filter((x) => x.owner === "Manager");
  return `<p class="hint">${t("exc.plIntro", { m: mine.length, n: X.open.length, up: up.length })}</p>
    <div class="kpis fresh-kpis">${sevKpis(X, mine)}</div>
    ${renderInbox(X, filters, lib, "Planner")}`;
}

export function renderExecExceptions(X) {
  const top = X.executive.slice(0, 8);
  return `<article class="card story-card wide">
    <div class="story-card-head"><div class="eyebrow">${t("tab.exceptions")}</div></div>
    <h2 class="headline">${t("exc.execHead", { c: X.counts.Critical, n: X.executive.length })}</h2>
    <p class="hint">${t("exc.execHint", { n: X.open.length, p: X.open.filter((x) => x.owner === "Planner").length, m: X.open.filter((x) => x.owner === "Manager").length })}</p>
    <div class="table-wrap story-table"><table class="grid"><thead><tr>${th("inbox.category")}${th("exc.open", 1)}${th("exc.critical", 1)}${th("inbox.kPast", 1)}${th("inbox.impact")}</tr></thead><tbody>
      ${X.byCat.filter((c) => c.n).map((c) => `<tr><td>${esc(tv("cat", c.cat))}</td><td class="n">${c.n}</td><td class="n">${c.critical || dash}</td><td class="n">${c.pastSla ? `<span class="issue-block">${c.pastSla}</span>` : dash}</td>
        <td class="small">${c.kinds.map((k) => `${esc(tv("kind", k.kind))} <b>${fmtM(k.value)}</b>`).join(" · ") || dash}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>${t("exc.hDirector")}</h3>
    <div class="table-wrap story-table"><table class="grid"><thead><tr>${th("integ.severity")}${th("inbox.exception")}${th("inbox.partSup")}${th("inbox.impact", 1)}${th("inbox.ageSla", 1)}${th("exec.owner")}</tr></thead><tbody>
      ${top.map((x) => `<tr class="clickable" tabindex="0" data-goto="manager:exceptions"><td class="nowrap">${sevTag(x)}</td><td>${esc(tv("exc.t", x.label))}<div class="muted small">${xDetail(x)}</div></td>
        <td>${x.part ? esc(x.part.part_number) : ""}<div class="muted small">${esc(x.supplier)}</div></td><td class="n">${impact(x)}</td>
        <td class="n nowrap"><span class="${x.pastSla ? "issue-block" : ""}">${t("inbox.d", { n: x.age })}</span> / ${t("inbox.d", { n: x.sla })}</td><td>${tv("owner", x.owner)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">${t("exc.noDirector")}</td></tr>`}
    </tbody></table></div>
    ${X.executive.length > top.length ? `<p class="hint">${t("exc.topOf", { n: top.length, total: X.executive.length })}</p>` : ""}
    <p class="exec-link"><a href="#" data-goto="manager:exceptions">${t("exc.openInbox")}</a></p>
  </article>`;
}

// Drawer section: open exceptions for one part.
export function drawerExceptions(list) {
  if (!list.length) return "";
  return `<h3>${t("exc.hDrawer")}</h3><ul class="exc-list">${list.map((x) => `<li>${sevTag(x)} <b>${esc(tv("exc.t", x.label))}</b>${x.value && x.kind ? ` · ${fmtM(x.value)} ${esc(tv("kind", x.kind).toLowerCase())}` : ""}<div class="muted small">${xDetail(x)} ${t("inbox.next")} ${esc(tv("exc.a", x.action))}.</div></li>`).join("")}</ul>`;
}
