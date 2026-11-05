import { analyze, DEFAULT_POLICY, clonePolicy, PROGRAMS, RESULT_COLUMNS, resultRow } from "./segment.js?v=15";
import { renderStory, destroyStory, fmtMetric } from "./story.js?v=15";
import { insights, scenarioMetrics, SCENARIO_ROWS } from "./insights.js?v=15";
import { exportDeck, canvasPng } from "./deck.js?v=15";
import { esc, fmtN, fmtUSD, fmtM, fmtPct, fmtCost } from "./format.js?v=15";
import { sellIn } from "./sales.js?v=15";
import { freshness, ANALYSIS_DATE, CLAIM_COLUMNS, claimRow } from "./freshness.js?v=15";
import { pipeline, scorecard, opportunities, valuePipeline, executive, ESCALATION_COLUMNS, escalationRow } from "./v2.js?v=15";
import { renderExecTop, plannerActions, renderPlanner, renderPipelineTab, renderScorecard, renderOppsTab, drawerCoverage, renderExceptionsTab, drawerExceptions } from "./layers.js?v=15";
import { exceptions, STATUSES as XSTATUSES, SEVERITIES, CATEGORIES, resolutionCodes, EXCEPTION_COLUMNS, exceptionRow } from "./exceptions.js?v=15";
import { renderSales, destroySales } from "./sales-view.js?v=15";

/* ---------------- state ---------------- */
const VIEW_HASH = { "#story": "story", "#exec": "story", "#sales": "sales", "#planner": "planner" };
const state = {
  rows: [],
  policy: clonePolicy(),
  result: null,
  insights: null,
  scenarios: [],
  filters: emptyFilters(),
  sort: { key: "annual_spend", dir: -1 },
  tab: "parts",
  view: VIEW_HASH[location.hash] || "analysis",
  openPart: null,
  lots: [], suppliersV2: [], lotsLabel: "", suppliersLabel: "", claimStatus: new Map(), openClaim: null,
  forecast: [], forecastLabel: "", ptab: "actions", pfilters: { search: "", action: "", supplier: "" },
  events: [], eventsLabel: "", excStatus: new Map(), xfilters: emptyXFilters(), pxfilters: emptyXFilters(),
};
function emptyXFilters() { return { search: "", status: "open", sev: "", cat: "", owner: "", supplier: "", all: false }; }
const XLIB = { STATUSES: XSTATUSES, SEVERITIES, CATEGORIES, resolutionCodes };
function emptyFilters() {
  return { search: "", commodity: "", supplier: "", abc: "", current: "", rec: "", superA: false, change: false, issue: false, cell: null, mig: null };
}

const $ = (s, el = document) => el.querySelector(s);
const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };
const pc = (prog) => `--c: var(${PVAR[prog] || "--mrp"})`;
const badge = (prog) => prog ? `<span class="badge" style="${pc(prog)}">${esc(prog)}</span>` : `<span class="muted">—</span>`;


/* ---------------- data loading ---------------- */
const REQUIRED = ["part_number", "unit_cost_usd", "lead_time_weeks", "moq", "current_program", "on_hand_qty"];

function loadText(text, label) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const fields = parsed.meta.fields || [];
  const missing = REQUIRED.filter((c) => !fields.includes(c));
  const weeks = fields.filter((c) => /^w\d+$/.test(c));
  if (missing.length || !weeks.length) {
    showNotice(`Couldn't read <b>${esc(label)}</b>: missing column${missing.length === 1 ? "" : "s"} ${esc([...missing, ...(weeks.length ? [] : ["w01…w26"])].join(", "))}. <a href="#" data-guide>See the CSV format and download a template</a>.`);
    return;
  }
  showNotice("");
  state.rows = parsed.data.filter((r) => String(r.part_number ?? "").trim() !== "");
  state.filters = emptyFilters();
  state.openPart = null;
  $("#source").textContent = `${label} · ${state.rows.length} parts`;
  $("#source").title = label;
  closeDrawer();
  buildFilterOptions();
  syncFilterInputs();
  state.justLoaded = /\(sample\)$/.test(label) ? null : label;
  recompute();
}

function showNotice(html, kind = "error") {
  const n = $("#notice");
  n.innerHTML = html;
  n.hidden = !html;
  n.classList.toggle("ok", kind === "ok");
  n.setAttribute("role", kind === "ok" ? "status" : "alert");
}

async function loadSample() {
  let text;
  try {
    const res = await fetch("sample_parts.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
  } catch {
    $("#source").textContent = "No data loaded";
    showNotice("The sample file couldn't be loaded (opening the page from disk blocks it). Serve the folder over HTTP, or use <b>Upload CSV</b>.");
    return;
  }
  loadText(text, "sample_parts.csv (sample)");
}

/* ---------------- compute + render ---------------- */
let pending = 0;
function recompute() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    state.result = analyze(state.rows, state.policy);
    state.insights = insights(state.result, state.policy);
    state.sales = sellIn(state.result, state.policy);
    state.fresh = freshness(state.lots, state.suppliersV2, state.result.parts, state.policy);
    const P = state.policy, cs = (c) => state.claimStatus.get(c.lot_id) || c.status;
    state.pipe = pipeline(state.result.parts, state.forecast, P);
    state.pipeByPart = new Map([...state.pipe.escalate, ...state.pipe.watch, ...state.pipe.covered, ...state.pipe.noLeadTime].map((r) => [r.part.part_number, r]));
    state.score = scorecard(state.result, state.suppliersV2, state.fresh, P, cs);
    state.opps = opportunities(state.result, P);
    state.value = valuePipeline({ result: state.result, insights: state.insights, fresh: state.fresh, pipe: state.pipe, score: state.score, opps: state.opps, P, claimStatus: cs });
    state.exec = executive({ result: state.result, insights: state.insights, pipe: state.pipe, score: state.score });
    state.exc = exceptions({ result: state.result, insights: state.insights, pipe: state.pipe, fresh: state.fresh, score: state.score, events: state.events, P, claimStatus: cs, statusOf: (id) => state.excStatus.get(id) });
    renderAll();
  });
}

function renderAll() {
  if (state.justLoaded) {
    const S = state.result.summary;
    showNotice(`Loaded <b>${esc(state.justLoaded)}</b>: ${S.parts} parts, ${S.analyzed} analyzed${S.blocked ? `, ${S.blocked} blocked by data (see Data integrity)` : ""}. The file stays in this browser.`, "ok");
    state.justLoaded = null;
  }
  renderKPIs();
  renderMatrix();
  renderMigration();
  renderTable();
  renderSuppliers();
  renderIntegrity();
  renderFreshness();
  renderV2Tabs();
  renderExceptions();
  renderWaves();
  renderRisk();
  renderScenarios();
  renderPolicyDiff();
  if (state.view === "story") { drawExecTop(); drawStory(); }
  if (state.view === "sales") drawSales();
  if (state.view === "planner") drawPlanner();
  if (state.openPart) renderDrawer(state.openPart);
}

function setView(view) {
  state.view = view;
  const layer = view === "story" || view === "sales" ? "exec" : view;
  for (const b of document.querySelectorAll("[data-layer]")) b.setAttribute("aria-pressed", String(b.dataset.layer === layer));
  for (const b of document.querySelectorAll("[data-subview]")) b.setAttribute("aria-pressed", String(b.dataset.subview === view));
  for (const el of document.querySelectorAll("[data-layers]")) el.hidden = !el.dataset.layers.split(" ").includes(layer);
  if (layer !== "analysis") togglePolicy(false);
  $("#execBar").hidden = layer !== "exec";
  $("#execTop").hidden = view !== "story";
  $("#story").hidden = view !== "story";
  $("#sales").hidden = view !== "sales";
  $("#planner").hidden = view !== "planner";
  for (const el of document.querySelectorAll("[data-analysis]")) el.hidden = view !== "analysis";
  history.replaceState(null, "", view === "analysis" ? location.pathname + location.search : `#${view === "story" ? "exec" : view}`);
  if (view === "planner" && state.result) drawPlanner();
  if (view === "story" && state.result) { drawExecTop(); drawStory(); }
  else destroyStory();
  if (view === "sales" && state.result) drawSales();
  else destroySales();
  window.scrollTo(0, 0);
}

/* ---------------- KPIs ---------------- */
function renderKPIs() {
  const S = state.result.summary;
  const invDelta = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;
  const tol = state.policy.tolerance;
  const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  $("#kpis").innerHTML = [
    kpi("Parts analyzed", `${S.analyzed}<span class="arrow"> / ${S.parts}</span>`,
      `${S.blocked} blocked by data · ${S.with_issue} with any issue`),
    kpi("Annual spend", fmtM(S.annual_spend), `${S.super_a} Super A parts carry ${fmtPct(state.policy.super_a)} of it`),
    kpi("Inventory now → target", `${fmtM(S.inv_now)}<span class="arrow">→</span>${fmtM(S.inv_target)}`,
      `<span class="delta-down">${invDelta <= 0 ? "−" : "+"}${fmtPct(Math.abs(invDelta))}</span> at recommended policy`),
    kpi("Excess (right-sizing)", fmtM(S.excess), `On hand above target × ${tol.toFixed(2)}`, "excess"),
    kpi("Carrying cost avoided", `${fmtM(state.insights.carrying.avoided)}<span class="arrow">/yr</span>`,
      `Recurring P&L at ${fmtPct(state.policy.carrying_rate)} carrying rate`, "excess"),
    kpi("Consignment transfer", state.policy.consignment ? fmtM(S.consignment) : "Off",
      state.policy.consignment ? "VMI stock moving to supplier ownership. Not a saving." : "Consignment is off in Policy", "consign"),
    kpi("Spend in pull programs", `${fmtPct(S.pull_share_now)}<span class="arrow">→</span>${fmtPct(S.pull_share_rec)}`, "Today vs recommended (VMI, CRP, Kanban)"),
    kpi("Program changes", `${S.program_changes}<span class="arrow"> / ${S.analyzed}</span>`,
      `${fmtPct(S.analyzed ? S.program_changes / S.analyzed : 0)} of analyzed parts move`),
  ].join("");
}

/* ---------------- matrix ---------------- */
function renderMatrix() {
  const S = state.result.summary, P = state.policy;
  const total = S.annual_spend || 1;
  const colHead = {
    X: `CV &lt; ${P.cv_x}`,
    Y: `CV ${P.cv_x}–${P.cv_y}`,
    Z: `CV ≥ ${P.cv_y} or &gt;${fmtPct(P.zero_share_z)} zero wks`,
  };
  const rowHead = { A: `&lt; ${fmtPct(P.abc_a)}`, B: `&lt; ${fmtPct(P.abc_b)}`, C: "rest" };
  let html = `<div></div>` + "XYZ".split("").map((x) => `<div class="axis col"><b>${x}</b><span>${colHead[x]}</span></div>`).join("");
  for (const a of "ABC") {
    const rowSpend = "XYZ".split("").reduce((t, x) => t + S.matrix[a + x].spend, 0);
    html += `<div class="axis"><b>${a}</b><span>${fmtPct(rowSpend / total)} spend</span></div>`;
    for (const x of "XYZ") {
      const k = a + x, c = S.matrix[k];
      if (!c.count) { html += `<div class="cell empty"><div class="count">0</div></div>`; continue; }
      const progs = Object.entries(c.programs).sort((m, n) => n[1] - m[1]);
      const dom = progs[0][0];
      const mix = progs.map(([p, n]) => `<span style="${pc(p)}; flex:${n}"></span>`).join("");
      const label = progs.slice(0, 3).map(([p, n]) => (progs.length === 1 ? p : `${p} ${n}`)).join(" · ");
      html += `<button type="button" class="cell ${state.filters.cell === k ? "active" : ""}" data-cell="${k}" style="${pc(dom)}"
        aria-label="${k}: ${c.count} parts, ${fmtM(c.spend)}, ${label}">
        <div class="count">${c.count}<small>parts</small></div>
        <div class="spend">${fmtM(c.spend)} · ${fmtPct(c.spend / total)}</div>
        <div class="prog">${label}</div>
        <div class="mix">${mix}</div></button>`;
    }
  }
  $("#matrix").innerHTML = html;
  $("#legend").innerHTML = PROGRAMS.map((p) => `<span><i style="${pc(p)}"></i>${p}${p === "MRP" ? " (no pull program)" : ""}</span>`).join("");
}

/* ---------------- migration ---------------- */
function renderMigration() {
  const s = state.result.analyzed;
  const currents = [...PROGRAMS, ...new Set(s.map((p) => p.current_program).filter((c) => !PROGRAMS.includes(c)))];
  const n = {}, spend = {};
  for (const p of s) {
    const k = p.current_program + "→" + p.recommended_program;
    n[k] = (n[k] || 0) + 1;
    spend[k] = (spend[k] || 0) + p.annual_spend;
  }
  const maxOff = Math.max(1, ...Object.entries(n).filter(([k]) => { const [a, b] = k.split("→"); return a !== b; }).map(([, v]) => v));
  let html = `<table class="mig"><thead><tr><th class="rowh">Current ↓ / Recommended →</th>${PROGRAMS.map((p) => `<th>${badge(p)}</th>`).join("")}<th>Total</th></tr></thead><tbody>`;
  for (const c of currents) {
    const rowTotal = s.filter((p) => p.current_program === c).length;
    if (!rowTotal && !PROGRAMS.includes(c)) continue;
    html += `<tr><th class="rowh">${badge(c)}</th>`;
    for (const r of PROGRAMS) {
      const k = c + "→" + r, v = n[k] || 0;
      const cls = !v ? "zero" : c === r ? "stay" : "move";
      const active = state.filters.mig === k ? "active" : "";
      html += `<td><button type="button" class="${cls} ${active}" ${v ? `data-mig="${esc(k)}"` : "disabled"}
        style="${pc(r)}; --w:${(v / maxOff).toFixed(3)}" title="${esc(c)} → ${r}: ${v} parts, ${fmtM(spend[k] || 0)} spend">${v || "·"}</button></td>`;
    }
    html += `<td class="tot">${rowTotal}</td></tr>`;
  }
  html += `<tr><th class="rowh">Total</th>${PROGRAMS.map((r) => `<td class="tot">${s.filter((p) => p.recommended_program === r).length}</td>`).join("")}<td class="tot">${s.length}</td></tr></tbody></table>`;
  const moves = Object.entries(n).filter(([k]) => { const [a, b] = k.split("→"); return a !== b; }).sort((a, b) => b[1] - a[1]);
  const changes = state.result.summary.program_changes;
  if (moves.length) {
    const [k, v] = moves[0];
    const toPull = s.filter((p) => p.current_program === "MRP" && p.recommended_program !== "MRP").length;
    const toMrp = s.filter((p) => p.current_program !== "MRP" && p.recommended_program === "MRP").length;
    html += `<p class="hint mig-note">${changes} of ${s.length} parts change program. Largest move: <b>${esc(k.replace("→", " → "))}</b> (${v}).
      ${toPull} parts leave MRP for a pull program; ${toMrp} pull parts should go back to MRP.</p>`;
  }
  $("#migration").innerHTML = html;
}

/* ---------------- parts table ---------------- */
const COLS = [
  { key: "part_number", label: "Part" },
  { key: "commodity", label: "Commodity" },
  { key: "supplier", label: "Supplier" },
  { key: "abc", label: "ABC" },
  { key: "xyz", label: "XYZ" },
  { key: "trend", label: "Trend" },
  { key: "current_program", label: "Current" },
  { key: "recommended_program", label: "Recommended" },
  { key: "reason", label: "Reason" },
  { key: "annual_spend", label: "Spend / yr", n: true },
  { key: "dos_current", label: "DOS now", n: true },
  { key: "dos_target", label: "DOS target", n: true },
  { key: "excess_value", label: "Excess $", n: true },
];

function filteredParts() {
  const f = state.filters, q = f.search.trim().toLowerCase();
  return state.result.parts.filter((p) => {
    if (q && !`${p.part_number} ${p.description} ${p.manufacturer} ${p.supplier} ${p.commodity}`.toLowerCase().includes(q)) return false;
    if (f.commodity && p.commodity !== f.commodity) return false;
    if (f.supplier && p.supplier !== f.supplier) return false;
    if (f.abc && p.abc !== f.abc) return false;
    if (f.current && p.current_program !== f.current) return false;
    if (f.rec && (f.rec === "Blocked" ? !p.blocking : p.recommended_program !== f.rec)) return false;
    if (f.superA && !p.super_a) return false;
    if (f.change && !p.program_change) return false;
    if (f.issue && !p.issues.length) return false;
    if (f.cell && (p.abc + p.xyz) !== f.cell) return false;
    if (f.mig && `${p.current_program}→${p.recommended_program}` !== f.mig) return false;
    return true;
  });
}

function sortParts(list) {
  const { key, dir } = state.sort;
  const val = (p) => (key === "recommended_program" && p.blocking ? "~Blocked" : p[key]);
  return [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    const ea = va === undefined || va === null || va === "" || Number.isNaN(va);
    const eb = vb === undefined || vb === null || vb === "" || Number.isNaN(vb);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    if (typeof va === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function renderTable() {
  const thead = $("#partsTable thead"), tbody = $("#partsTable tbody");
  thead.innerHTML = `<tr>${COLS.map((c) => {
    const sorted = state.sort.key === c.key;
    return `<th tabindex="0" class="sortable ${c.n ? "n" : ""} ${sorted ? "sorted" : ""}" data-sort="${c.key}" data-dir="${state.sort.dir > 0 ? "↑" : "↓"}"
      aria-sort="${sorted ? (state.sort.dir > 0 ? "ascending" : "descending") : "none"}">${c.label}</th>`;
  }).join("")}</tr>`;
  const list = sortParts(filteredParts());
  tbody.innerHTML = list.map((p) => {
    if (p.blocking) {
      return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
        <td class="pn">${esc(p.part_number)}</td><td>${esc(p.commodity)}</td><td>${esc(p.supplier)}</td>
        <td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>
        <td>${badge(p.current_program)}</td><td><span class="badge blocked">Blocked</span></td>
        <td class="reason">${esc(p.data_issues)}</td><td class="n muted">—</td><td class="n muted">—</td><td class="n muted">—</td><td class="n muted">—</td></tr>`;
    }
    const warn = p.issues.length ? ` <span class="tag" title="${esc(p.data_issues)}">!</span>` : "";
    return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
      <td class="pn">${esc(p.part_number)}${warn}</td><td>${esc(p.commodity)}</td><td>${esc(p.supplier)}</td>
      <td>${p.abc}${p.super_a ? '<span class="tag" title="Super A">SA</span>' : ""}</td><td>${p.xyz}</td>
      <td class="${p.trend === "Flat" ? "muted" : ""}">${p.trend}</td>
      <td>${badge(p.current_program)}</td>
      <td>${badge(p.recommended_program)}${p.program_change ? "" : ' <span class="tag">keep</span>'}</td>
      <td class="reason">${esc(p.reason)}</td>
      <td class="n">${fmtM(p.annual_spend)}</td>
      <td class="n">${fmtN(p.dos_current, 1)}</td>
      <td class="n">${fmtN(p.dos_target, 1)}</td>
      <td class="n ${p.excess_value ? "" : "muted"}">${p.excess_value ? fmtUSD(p.excess_value) : "0"}</td></tr>`;
  }).join("") || `<tr><td colspan="${COLS.length}" class="muted">No parts match these filters.</td></tr>`;

  const a = list.filter((p) => p.analyzed);
  const sum = (k) => a.reduce((t, p) => t + p[k], 0);
  $("#partsFoot").textContent = `${list.length} of ${state.result.parts.length} parts shown · spend ${fmtM(sum("annual_spend"))} · inventory ${fmtM(sum("inv_value_current"))} → ${fmtM(sum("inv_value_target"))} · excess ${fmtM(sum("excess_value"))}`;
  renderChips();
}

function renderChips() {
  const f = state.filters, chips = [];
  if (f.cell) chips.push(["cell", `Matrix: ${f.cell}`]);
  if (f.mig) chips.push(["mig", `Migration: ${f.mig.replace("→", " → ")}`]);
  $("#chips").innerHTML = chips.map(([k, l]) => `<button type="button" class="chip" data-chip="${k}">${esc(l)}</button>`).join("");
}

function buildFilterOptions() {
  const parts = state.rows;
  const uniq = (k) => [...new Set(parts.map((r) => String(r[k] ?? "").trim()).filter(Boolean))].sort();
  const opts = (el, all, values) => { el.innerHTML = `<option value="">${all}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(""); };
  opts($("#fCommodity"), "All commodities", uniq("commodity"));
  opts($("#fSupplier"), "All suppliers", uniq("supplier"));
  opts($("#fAbc"), "All classes", ["A", "B", "C"]);
  opts($("#fCurrent"), "Any current program", [...new Set([...PROGRAMS, ...uniq("current_program")])]);
  opts($("#fRec"), "Any recommendation", [...PROGRAMS, "Blocked"]);
}

function syncFilterInputs() {
  const f = state.filters;
  $("#fSearch").value = f.search; $("#fCommodity").value = f.commodity; $("#fSupplier").value = f.supplier;
  $("#fAbc").value = f.abc; $("#fCurrent").value = f.current; $("#fRec").value = f.rec;
  $("#fSuperA").checked = f.superA; $("#fChange").checked = f.change; $("#fIssue").checked = f.issue;
}

/* ---------------- supplier view ---------------- */
function renderSuppliers() {
  const by = new Map();
  for (const p of state.result.analyzed) {
    const g = by.get(p.supplier) || { supplier: p.supplier, n: 0, spend: 0, vmiN: 0, vmiS: 0, crpN: 0, crpS: 0, kanN: 0, mrpN: 0, already: 0, consign: 0, excess: 0, mix: {} };
    g.n++; g.spend += p.annual_spend; g.excess += p.excess_value; g.consign += p.consignment_transfer_value;
    g.mix[p.recommended_program] = (g.mix[p.recommended_program] || 0) + p.annual_spend;
    if (p.recommended_program === "VMI") { g.vmiN++; g.vmiS += p.annual_spend; }
    if (p.recommended_program === "CRP") { g.crpN++; g.crpS += p.annual_spend; }
    if (p.recommended_program === "Kanban") g.kanN++;
    if (p.recommended_program === "MRP") g.mrpN++;
    if ((p.recommended_program === "VMI" || p.recommended_program === "CRP") && p.current_program === p.recommended_program) g.already++;
    by.set(p.supplier, g);
  }
  const rows = [...by.values()].sort((a, b) => (b.vmiS + b.crpS) - (a.vmiS + a.crpS) || b.spend - a.spend);
  const max = Math.max(1, ...rows.map((g) => g.vmiS + g.crpS));
  $("#supplierTable").innerHTML = `<thead><tr>
      <th>#</th><th>Supplier</th><th class="n">VMI parts</th><th class="n">VMI spend</th><th class="n">CRP parts</th><th class="n">CRP spend</th>
      <th class="n">VMI + CRP spend</th><th></th><th class="n">Already in place</th><th class="n">Consignment transfer</th>
      <th class="n">Parts</th><th class="n">Total spend</th><th>Spend mix (recommended)</th></tr></thead><tbody>` +
    rows.map((g, i) => {
      const vc = g.vmiS + g.crpS;
      const mix = PROGRAMS.filter((p) => g.mix[p]).map((p) => `<span style="${pc(p)}; flex:${g.mix[p]}" title="${p} ${fmtM(g.mix[p])}"></span>`).join("");
      return `<tr class="clickable" tabindex="0" data-supplier="${esc(g.supplier)}">
        <td class="muted">${i + 1}</td><td class="pn">${esc(g.supplier)}</td>
        <td class="n">${g.vmiN || '<span class="muted">0</span>'}</td><td class="n">${g.vmiS ? fmtM(g.vmiS) : '<span class="muted">—</span>'}</td>
        <td class="n">${g.crpN || '<span class="muted">0</span>'}</td><td class="n">${g.crpS ? fmtM(g.crpS) : '<span class="muted">—</span>'}</td>
        <td class="n"><b>${fmtM(vc)}</b></td>
        <td><span class="bar" style="width:${Math.max(2, (vc / max) * 120)}px; ${pc(g.vmiS >= g.crpS ? "VMI" : "CRP")}"></span></td>
        <td class="n">${g.already} of ${g.vmiN + g.crpN}</td>
        <td class="n">${g.consign ? fmtM(g.consign) : '<span class="muted">—</span>'}</td>
        <td class="n">${g.n}</td><td class="n">${fmtM(g.spend)}</td>
        <td><div class="stackbar">${mix}</div></td></tr>`;
    }).join("") + "</tbody>";
}

/* ---------------- data integrity ---------------- */
function issueDetail(p, msg) {
  if (msg.startsWith("Missing lead time")) return "lead_time_weeks is blank";
  if (msg.startsWith("Zero/blank cost")) return `unit_cost_usd = ${Number.isFinite(p.unit_cost_usd) ? p.unit_cost_usd : "blank"}`;
  if (msg.startsWith("No demand")) return "Every week w01–w26 is 0";
  if (msg.startsWith("Duplicate")) return `${esc(p.part_number)} appears more than once in the file`;
  if (msg.startsWith("MOQ")) return `MOQ ${fmtN(p.moq)} = ${fmtN(p.moq / p.avg_weekly, 1)} wks of avg demand (${fmtN(p.avg_weekly)}/wk)`;
  return "";
}
const BLOCKING_ISSUES = ["Missing lead time", "Zero/blank cost", "No demand"];
function renderIntegrity() {
  const list = state.result.parts.filter((p) => p.issues.length);
  $("#issueCount").textContent = list.length;
  $("#integrityTable").innerHTML = `<thead><tr><th>Part</th><th>Description</th><th>Supplier</th><th>Severity</th><th>Issue</th><th>Detail</th><th>Effect</th></tr></thead><tbody>` +
    (list.map((p) => p.issues.map((msg, i) => {
      const blocking = BLOCKING_ISSUES.some((k) => msg.startsWith(k));
      return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
        <td class="pn">${i ? "" : esc(p.part_number)}</td><td>${i ? "" : esc(p.description)}</td><td>${i ? "" : esc(p.supplier)}</td>
        <td class="${blocking ? "issue-block" : "issue-warn"}">${blocking ? "Blocking" : "Warning"}</td>
        <td>${esc(msg)}</td><td class="muted">${esc(issueDetail(p, msg))}</td>
        <td class="muted">${blocking ? "Excluded from segmentation" : msg.startsWith("MOQ") ? "Analyzed; MOQ drives cycle stock" : "Analyzed; fix so each part appears once"}</td></tr>`;
    }).join("")).join("") || `<tr><td colspan="7" class="muted">No data issues found.</td></tr>`) + "</tbody>";
}

/* ---------------- freshness claims (V2_SPEC.md section 2) ---------------- */
const CLAIM_STATUSES = ["Open", "Escalated", "Closed"];
const parseCsvText = (text) => Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });

async function loadV2() {
  const get = async (f) => { const r = await fetch(`data_v2/${f}`, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.text(); };
  try {
    const [lots, sup, fc] = await Promise.all([get("inventory_lots.csv"), get("suppliers.csv"), get("forecast.csv")]);
    state.forecast = parseCsvText(fc).data; state.forecastLabel = "forecast.csv (sample)";
    state.lots = parseCsvText(lots).data; state.lotsLabel = "inventory_lots.csv (sample)";
    state.suppliersV2 = parseCsvText(sup).data; state.suppliersLabel = "suppliers.csv (sample)";
  } catch { /* freshness tab explains how to upload */ }
  try {
    const r = await fetch("data_v3/supply_events.csv", { cache: "no-cache" });
    if (r.ok) { state.events = parseCsvText(await r.text()).data; state.eventsLabel = "supply_events.csv (sample)"; }
  } catch { /* exceptions tab explains how to upload */ }
  if (state.result) recompute();
}

function loadV2Text(kind, text, label) {
  const { data, meta } = parseCsvText(text);
  const need = kind === "lots" ? ["lot_id", "part_number", "supplier", "qty", "date_code", "received_date"]
    : kind === "forecast" ? ["part_number", "f01", "open_po_qty", "open_po_due_week"]
    : kind === "events" ? ["event_id", "event_type", "part_number", "announced_date", "effective_date", "value"] : ["supplier", "freshness_rule_months"];
  const missing = need.filter((c) => !(meta.fields || []).includes(c));
  if (missing.length) { showNotice(`Couldn't read <b>${esc(label)}</b>: missing column${missing.length === 1 ? "" : "s"} ${esc(missing.join(", "))}.`); return; }
  showNotice(`Loaded <b>${esc(label)}</b>: ${data.length} ${kind === "lots" ? "lots" : kind === "forecast" ? "forecast rows" : kind === "events" ? "events" : "suppliers"}. The file stays in this browser.`, "ok");
  if (kind === "events") { state.events = data; state.eventsLabel = label; state.excStatus.clear(); }
  else if (kind === "forecast") { state.forecast = data; state.forecastLabel = label; }
  else if (kind === "lots") { state.lots = data; state.lotsLabel = label; state.claimStatus.clear(); }
  else { state.suppliersV2 = data; state.suppliersLabel = label; }
  recompute();
}

const claimStatus = (c) => state.claimStatus.get(c.lot_id) || c.status;

function renderFreshness() {
  const F = state.fresh, P = state.policy, el = $("#tab-freshness");
  $("#claimCount").textContent = F.claimable.length || "";
  const byStatus = Object.fromEntries(CLAIM_STATUSES.map((k) => [k, F.claimable.filter((c) => claimStatus(c) === k)]));
  const sv = (a) => a.reduce((t, c) => t + (Number.isFinite(c.value) ? c.value : 0), 0);
  const money = (v) => (Number.isFinite(v) ? fmtUSD(v) : `<span class="muted" title="Part has no valid unit cost">—</span>`);
  const mo = (v) => fmtN(v, 1);
  const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const uploads = `<div class="fresh-src">
      <span class="muted">Lots: ${esc(state.lotsLabel || "none loaded")} · Suppliers: ${esc(state.suppliersLabel || "none loaded")} · Analysis date ${ANALYSIS_DATE}</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="lots" hidden>Upload lots CSV</label>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="suppliers" hidden>Upload suppliers CSV</label>
      <button class="btn" type="button" data-fresh="export" ${F.claimable.length ? "" : "disabled"}>Export claims CSV</button>
    </div>`;
  if (!F.lots) {
    el.innerHTML = `${uploads}<p class="hint">Upload <code>inventory_lots.csv</code> (lot_id, part_number, supplier, qty, date_code YYWW, received_date YYYY-MM-DD) and <code>suppliers.csv</code> (supplier, freshness_rule_months) to check freshness.</p>`;
    return;
  }
  const claimRows = F.claimable.map((c) => {
    const st = claimStatus(c), open = state.openClaim === c.lot_id;
    return `<tr class="${st === "Closed" ? "closed" : ""}">
      <td><select data-status="${esc(c.lot_id)}" aria-label="Status of claim for lot ${esc(c.lot_id)}">${CLAIM_STATUSES.map((k) => `<option${k === st ? " selected" : ""}>${k}</option>`).join("")}</select></td>
      <td class="nowrap">${esc(c.lot_id)}</td><td class="pn clickable" tabindex="0" data-part="${esc(c.part_number)}">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td>
      <td class="n">${esc(c.date_code)}</td><td class="n">${c.mfg_date}</td><td class="n">${esc(c.received_date)}</td>
      <td class="n"><b>${mo(c.age_receipt)}</b></td><td class="n">${c.rule}${c.rule_source === "default" ? "*" : ""}</td><td class="n">+${mo(c.age_receipt - c.rule)}</td>
      <td class="n">${fmtN(c.qty)}</td><td class="n">${money(c.value)}</td>
      <td><button type="button" class="btn btn-ghost" data-claim="${esc(c.lot_id)}" aria-expanded="${open}">${open ? "Hide" : "Claim text"}</button></td></tr>
      ${open ? `<tr class="claim-text-row"><td colspan="13"><p class="claim-text">${esc(c.claim_text)}</p>
        <button type="button" class="btn" data-copy="${esc(c.lot_id)}">Copy claim text</button></td></tr>` : ""}`;
  }).join("");
  el.innerHTML = `${uploads}
    <div class="kpis fresh-kpis">
      ${kpi("Lots checked", fmtN(F.lots), `${F.ok.length} within the freshness rule`)}
      ${kpi("Supplier claims", `${F.claimable.length} · ${fmtM(F.claimValue)}`, `old at receipt: ${byStatus.Open.length} open, ${byStatus.Escalated.length} escalated, ${byStatus.Closed.length} closed`, "claim")}
      ${kpi("Internal aging", `${F.aging.length} · ${fmtM(F.agingValue)}`, "fresh at receipt, over the rule today: ours, not a claim", "aging")}
      ${kpi("Invalid lots", fmtN(F.invalid.length), F.invalid.length ? "date code or data to fix before claiming" : "all date codes valid (YYWW, week 01–53)")}
    </div>
    <h3>Supplier claims: old at receipt</h3>
    <p class="hint">Age at receipt = received date − manufacture date (Monday of the date code's ISO week), against the supplier's freshness rule${P.fresh_grace_months ? ` plus ${P.fresh_grace_months} months of tolerance` : ""}. These are the supplier's responsibility. Still open: ${fmtM(sv(byStatus.Open) + sv(byStatus.Escalated))}.${F.claimable.some((c) => c.rule_source === "default") ? ` * Supplier has no rule; Policy default of ${P.fresh_default_rule_months} months used.` : ""}</p>
    ${F.bySupplier.length ? `<p class="hint">By supplier: ${F.bySupplier.map((g) => `${esc(g.supplier)} ${g.n} (${fmtM(g.value)})`).join(" · ")}</p>` : ""}
    <div class="table-wrap"><table class="grid"><thead><tr><th>Status</th><th>Lot</th><th>Part</th><th>Supplier</th><th class="n">Date code</th><th class="n">Manufactured</th><th class="n">Received</th><th class="n">Age at receipt (mo)</th><th class="n">Rule (mo)</th><th class="n">Over (mo)</th><th class="n">Qty</th><th class="n">Value</th><th></th></tr></thead>
      <tbody>${claimRows || `<tr><td colspan="13" class="muted">No lot was old at receipt.</td></tr>`}</tbody></table></div>
    <h3>Internal aging: not a supplier claim</h3>
    <p class="hint">These lots were within the rule when received and aged here. The cost is ours: treat them as excess or slow movers (use first, sell back, or reserve), not as claims.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Lot</th><th>Part</th><th>Supplier</th><th class="n">Date code</th><th class="n">Received</th><th class="n">Age at receipt (mo)</th><th class="n">Age today (mo)</th><th class="n">Rule (mo)</th><th class="n">Expired on</th><th class="n">Qty</th><th class="n">Value</th></tr></thead><tbody>
      ${F.aging.map((c) => `<tr class="clickable" tabindex="0" data-part="${esc(c.part_number)}"><td class="nowrap">${esc(c.lot_id)}</td><td class="pn">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td>
        <td class="n">${esc(c.date_code)}</td><td class="n">${esc(c.received_date)}</td><td class="n">${mo(c.age_receipt)}</td><td class="n"><b>${mo(c.age_today)}</b></td><td class="n">${c.rule}</td>
        <td class="n">${c.expires}</td><td class="n">${fmtN(c.qty)}</td><td class="n">${money(c.value)}</td></tr>`).join("") || `<tr><td colspan="11" class="muted">No internal aging.</td></tr>`}
    </tbody></table></div>
    <h3>Invalid lots</h3>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Lot</th><th>Part</th><th>Supplier</th><th class="n">Date code</th><th class="n">Received</th><th>Problem</th></tr></thead><tbody>
      ${F.invalid.map((c) => `<tr><td>${esc(c.lot_id)}</td><td class="pn">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td><td class="n">${esc(c.date_code)}</td><td class="n">${esc(c.received_date)}</td><td class="issue-warn">${esc(c.errors.join("; "))}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Every lot has a valid date code and received date.</td></tr>`}
    </tbody></table></div>`;
}

function exportClaims() {
  const F = state.fresh;
  if (!F?.claimable.length) return;
  const csv = Papa.unparse({ fields: CLAIM_COLUMNS, data: F.claimable.map((c) => claimRow(c, claimStatus(c))) });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "freshness_claims.csv" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function bindFreshness() {
  const el = $("#tab-freshness");
  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-claim],[data-copy],[data-fresh]");
    if (!t) return;
    if (t.dataset.claim) { state.openClaim = state.openClaim === t.dataset.claim ? null : t.dataset.claim; renderFreshness(); }
    if (t.dataset.fresh === "export") exportClaims();
    if (t.dataset.copy) {
      const c = state.fresh.claimable.find((x) => x.lot_id === t.dataset.copy);
      navigator.clipboard?.writeText(c.claim_text).then(() => { t.textContent = "Copied"; }, () => { t.textContent = "Select the text to copy"; });
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.status) { state.claimStatus.set(e.target.dataset.status, e.target.value); recompute(); }
    const kind = e.target.dataset.v2, file = e.target.files?.[0];
    if (kind && file) file.text().then((t) => loadV2Text(kind, t, file.name));
  });
}

/* ---------------- layers (v2) ---------------- */
function renderV2Tabs() {
  const P = state.policy;
  $("#tab-pipeline").innerHTML = renderPipelineTab(state.pipe, P);
  $("#tab-opps").innerHTML = renderOppsTab(state.opps, P);
  $("#scorecard").innerHTML = renderScorecard(state.score, P);
  $("#escCount").textContent = state.pipe.escalate.length || "";
}

function drawExecTop() {
  if (!state.result) return;
  $("#execTop").innerHTML = renderExecTop({ E: state.exec, V: state.value, pipe: state.pipe, score: state.score, S: state.result.summary, P: state.policy, X: state.exc });
}

function drawPlanner() {
  if (!state.result) return;
  const rows = plannerActions({ result: state.result, insights: state.insights, pipe: state.pipe, fresh: state.fresh });
  const el = $("#planner"), active = document.activeElement?.dataset?.pf, xactive = document.activeElement?.dataset?.xf;
  el.innerHTML = renderPlanner({ rows, pipe: state.pipe, insights: state.insights, fresh: state.fresh, result: state.result, filters: state.pfilters, tab: state.ptab, X: state.exc, xfilters: state.pxfilters, lib: XLIB });
  if (xactive) refocus(el, `[data-xf="${xactive}"]`);
  if (active) { const f = el.querySelector(`[data-pf="${active}"]`); f?.focus(); if (f?.type === "search") f.setSelectionRange(f.value.length, f.value.length); }
}

function exportEscalations() {
  const rows = [...state.pipe.escalate, ...state.pipe.watch];
  if (!rows.length) return;
  const csv = Papa.unparse({ fields: ESCALATION_COLUMNS, data: rows.map(escalationRow) });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "pipeline_escalations.csv" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function refocus(el, sel) { const f = el.querySelector(sel); f?.focus(); if (f?.type === "search") f.setSelectionRange(f.value.length, f.value.length); }

function renderExceptions() {
  const el = $("#tab-exceptions"), xactive = el.contains(document.activeElement) && document.activeElement.dataset.xf;
  el.innerHTML = renderExceptionsTab(state.exc, state.xfilters, XLIB, state.policy, state.eventsLabel);
  if (xactive) refocus(el, `[data-xf="${xactive}"]`);
  $("#excCount").textContent = state.exc.counts.Critical || "";
}

function exportExceptions() {
  if (!state.exc?.items.length) return;
  const csv = Papa.unparse({ fields: EXCEPTION_COLUMNS, data: state.exc.items.map(exceptionRow) });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "exceptions_inbox.csv" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Shared by the Manager tab (#tab-exceptions) and the Planner layer (#planner).
function bindExceptions() {
  const setStatus = (id, patch) => { state.excStatus.set(id, { ...(state.excStatus.get(id) || {}), ...patch }); recompute(); };
  for (const [sel, key, redraw] of [["#tab-exceptions", "xfilters", () => renderExceptions()], ["#planner", "pxfilters", () => drawPlanner()]]) {
    const el = $(sel);
    el.addEventListener("input", (e) => { if (e.target.dataset.xf === "search") { state[key].search = e.target.value; redraw(); } });
    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.xf && t.dataset.xf !== "search") { state[key][t.dataset.xf] = t.value; state[key].all = false; redraw(); }
      if (t.dataset.xstatus) setStatus(t.dataset.xstatus, { status: t.value });
      if (t.dataset.xres) setStatus(t.dataset.xres, { resolution: t.value, ...(t.value && !state.excStatus.get(t.dataset.xres)?.status ? { status: "Resolved" } : {}) });
    });
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-xall]")) { state[key].all = true; redraw(); }
      const s = e.target.closest("[data-xsupplier]");
      if (s) { state[key] = { ...emptyXFilters(), supplier: s.dataset.xsupplier }; redraw(); }
      if (e.target.closest('[data-export="exceptions"]')) exportExceptions();
    });
  }
  $("#tab-exceptions").addEventListener("change", (e) => {
    const kind = e.target.dataset.v2, file = e.target.files?.[0];
    if (kind && file) file.text().then((t) => loadV2Text(kind, t, file.name));
  });
}

function goTo(target) {
  const [layer, tab] = target.split(":");
  if (layer === "planner") { state.ptab = tab || "actions"; setView("planner"); return; }
  setView("analysis");
  if (tab) { setTab(tab); $(`#tabbtn-${tab}`)?.scrollIntoView({ block: "center" }); }
}

function bindLayers() {
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); goTo(g.dataset.goto === "manager" ? "analysis" : g.dataset.goto.replace(/^manager:/, "analysis:")); return; }
    const sub = e.target.closest("[data-subview]");
    if (sub && sub.dataset.subview !== state.view) setView(sub.dataset.subview);
    if (e.target.closest('[data-export="escalations"]')) exportEscalations();
  });
  for (const sel of ["#planner", "#tab-pipeline"]) {
    $(sel).addEventListener("change", (e) => {
      const kind = e.target.dataset.v2, file = e.target.files?.[0];
      if (kind && file) file.text().then((t) => loadV2Text(kind, t, file.name));
    });
  }
  const pl = $("#planner");
  pl.addEventListener("click", (e) => { const t = e.target.closest("[data-ptab]"); if (t) { state.ptab = t.dataset.ptab; drawPlanner(); } });
  const pf = (e) => { const k = e.target.dataset.pf; if (!k) return; state.pfilters[k] = e.target.value; drawPlanner(); };
  pl.addEventListener("input", (e) => { if (e.target.dataset.pf === "search") pf(e); });
  pl.addEventListener("change", (e) => { if (e.target.dataset.pf && e.target.dataset.pf !== "search") pf(e); });
  $("#scorecard").addEventListener("click", (e) => {
    const r = e.target.closest("[data-supplier]");
    if (r) { state.filters = { ...emptyFilters(), supplier: r.dataset.supplier }; syncFilterInputs(); setTab("parts"); renderMatrix(); renderMigration(); renderTable(); }
  });
}

/* ---------------- drawer ---------------- */
let chart = null;
let drawerReturnFocus = null;
function openDrawer(pn) {
  if ($("#drawer").hidden) drawerReturnFocus = document.activeElement;
  state.openPart = pn;
  $("#drawer").hidden = false;
  $("#scrim").hidden = false;
  renderDrawer(pn);
  $("#dClose").focus();
}
function closeDrawer() {
  state.openPart = null;
  $("#drawer").hidden = true;
  $("#scrim").hidden = true;
  if (chart) { chart.destroy(); chart = null; }
  if (drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
  drawerReturnFocus = null;
}

function ruleText(p, P) {
  if (p.trend === "Ramp" || p.trend === "Declining") return `Trend ${p.trend} overrides the matrix → MRP`;
  const k = p.abc + p.xyz;
  if (k === "AX") return `AX: LT ${p.lead_time_weeks} wks ${p.lead_time_weeks >= P.vmi_lt_ax ? "≥" : "<"} ${P.vmi_lt_ax} → ${p.recommended_program}`;
  if (k === "AY") return `AY: LT ${p.lead_time_weeks} wks ${p.lead_time_weeks >= P.vmi_lt_ay ? "≥" : "<"} ${P.vmi_lt_ay} → ${p.recommended_program}`;
  if (k === "BX") return `BX: unit cost ${fmtCost(p.unit_cost_usd)} ${p.unit_cost_usd < P.kanban_max_cost ? "<" : "≥"} ${fmtCost(P.kanban_max_cost)} → ${p.recommended_program}`;
  if (k === "BY") return "BY → CRP";
  if (k === "CX" || k === "CY") return `${k} → Kanban`;
  return `${k} → MRP`;
}

function renderDrawer(pn) {
  const p = state.result.parts.find((x) => x.part_number === pn);
  if (!p) { closeDrawer(); return; }
  const P = state.policy;
  $("#dTitle").textContent = p.part_number;
  $("#dSub").textContent = [p.description, p.commodity, p.manufacturer, p.supplier].filter(Boolean).join(" · ");

  const stat = (l, v) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`;
  const zeroWeeks = p.demand.filter((x) => x === 0).length;
  const stats = `<div class="stats">
    ${stat("Avg / week", fmtN(p.avg_weekly))}${stat("Std dev (pop.)", fmtN(p.sd_weekly))}
    ${stat("CV", fmtN(p.cv, 3))}${stat("Zero weeks", `${zeroWeeks} / ${p.demand.length}`)}
    ${stat("Unit cost", fmtCost(p.unit_cost_usd))}${stat("Lead time", Number.isFinite(p.lead_time_weeks) ? p.lead_time_weeks + " wks" : "missing")}
    ${stat("MOQ", fmtN(p.moq))}${stat("On hand", fmtN(p.on_hand_qty))}</div>`;

  let body = "";
  if (p.blocking) {
    body = `<div class="verdict"><span class="badge blocked big">Blocked</span><span>${esc(p.data_issues)}</span></div>
      <h3>26-week demand</h3><div class="chartbox"><canvas id="dChart"></canvas></div>
      <h3>Stats</h3>${stats}
      <p class="hint" style="margin-top:12px">Fix the master data and re-upload to segment this part.</p>`;
  } else {
    const c = p.calc;
    const L_label = P.exposure[p.recommended_program] ? `${c.L} wks exposure` : `${c.L} wks (part lead time)`;
    const nT = Math.max(1, Math.min(Math.round(P.trend_weeks), p.demand.length));
    const ratio = p.trend_first ? p.trend_last / p.trend_first : NaN;
    const trendRow = p.zero_share <= P.zero_share_z
      ? `<tr><td>Trend</td><td class="formula">last ${nT} wks ${fmtN(p.trend_last)} ÷ first ${nT} wks ${fmtN(p.trend_first)} = ${Number.isFinite(ratio) ? fmtN(ratio, 2) + "×" : "n/a"} (Ramp &gt; ${P.trend_up}, Declining &lt; ${P.trend_down})</td><td class="res">${p.trend}</td></tr>`
      : `<tr><td>Trend</td><td class="formula">not tested: zero-demand share ${fmtPct(p.zero_share)} &gt; ${fmtPct(P.zero_share_z)}</td><td class="res">${p.trend}</td></tr>`;
    const formulaWins = !c.floorBinds;
    const progC = pc(p.recommended_program);

    body = `<div class="verdict">${badge(p.current_program)}<span class="muted">→</span><span class="big">${badge(p.recommended_program)}</span>
        <span>${esc(p.reason)}</span>${p.program_change ? "" : '<span class="tag">no change</span>'}</div>
      <h3>26-week demand</h3><div class="chartbox"><canvas id="dChart"></canvas></div>
      <h3>Stats</h3>${stats}
      <h3>Why this program</h3>
      <table class="steps"><tbody>
        <tr><td>Annual spend</td><td class="formula">${fmtN(p.avg_weekly)} /wk × 52 × ${fmtCost(p.unit_cost_usd)}</td><td class="res">${fmtUSD(p.annual_spend)}</td></tr>
        <tr><td>ABC</td><td class="formula">rank ${p.spend_rank} of ${state.result.analyzed.length}; cumulative share before this part ${fmtPct(p.cum_before, 1)} (A &lt; ${fmtPct(P.abc_a)}, B &lt; ${fmtPct(P.abc_b)})${p.super_a ? `; Super A (&lt; ${fmtPct(P.super_a)})` : ""}</td><td class="res">${p.abc}${p.super_a ? " · Super A" : ""}</td></tr>
        <tr><td>XYZ</td><td class="formula">CV ${fmtN(p.cv, 3)} (Y ≥ ${P.cv_x}, Z ≥ ${P.cv_y}); zero weeks ${fmtPct(p.zero_share, 1)} (Z if &gt; ${fmtPct(P.zero_share_z)})</td><td class="res">${p.xyz}</td></tr>
        ${trendRow}
        <tr class="win" style="${progC}"><td>Rule</td><td class="formula">${esc(ruleText(p, P))}</td><td class="res">${p.recommended_program}</td></tr>
      </tbody></table>
      <h3>Target inventory (${p.recommended_program})</h3>
      <table class="steps"><tbody>
        <tr><td>Review R, exposure L</td><td class="formula">R = ${c.R} wk${c.R === 1 ? "" : "s"}, L = ${L_label}</td><td class="res">R + L = ${c.R + c.L}</td></tr>
        <tr><td>Service factor z</td><td class="formula">class ${p.abc}</td><td class="res">${c.z}</td></tr>
        <tr><td>Safety stock</td><td class="formula">z × σ × √(R+L) = ${c.z} × ${fmtN(p.sd_weekly)} × √${c.R + c.L}</td><td class="res">${fmtN(c.ss)}</td></tr>
        <tr><td>Cycle stock</td><td class="formula">max(avg × R, MOQ) ÷ 2 = max(${fmtN(p.avg_weekly * c.R)}, ${fmtN(p.moq)}) ÷ 2</td><td class="res">${fmtN(c.cycle)}</td></tr>
        <tr class="${formulaWins ? "win" : "dim"}" style="${progC}"><td>Safety + cycle</td><td class="formula">${fmtN(c.ss)} + ${fmtN(c.cycle)}</td><td class="res">${fmtN(c.ss + c.cycle)}</td></tr>
        <tr class="${formulaWins ? "dim" : "win"}" style="${progC}"><td>Floor</td><td class="formula">${c.floorDays} days × ${fmtN(c.daily, 1)} /day</td><td class="res">${fmtN(c.floorQty)}</td></tr>
        <tr><td><b>Target</b></td><td class="formula">max of the two, rounded (${formulaWins ? "formula binds" : "floor binds"})</td><td class="res">${fmtN(p.target_qty)} units</td></tr>
        <tr><td>DOS target</td><td class="formula">${fmtN(p.target_qty)} ÷ ${fmtN(c.daily, 1)} /day</td><td class="res">${fmtN(p.dos_target, 1)} days</td></tr>
      </tbody></table>
      <h3>What changes</h3>
      <table class="steps"><tbody>
        <tr><td>Now</td><td class="formula">${fmtN(p.on_hand_qty)} on hand = ${fmtN(p.dos_current, 1)} days</td><td class="res">${fmtUSD(p.inv_value_current, 2)}</td></tr>
        <tr><td>At target</td><td class="formula">${fmtN(p.target_qty)} × ${fmtCost(p.unit_cost_usd)}</td><td class="res">${fmtUSD(p.inv_value_target, 2)}</td></tr>
        <tr><td>Excess (right-sizing)</td><td class="formula">max(0, ${fmtN(p.on_hand_qty)} − ${fmtN(p.target_qty)} × ${P.tolerance}) × ${fmtCost(p.unit_cost_usd)}</td><td class="res">${fmtUSD(p.excess_value, 2)}</td></tr>
        ${p.recommended_program === "VMI" ? `<tr><td>Consignment transfer</td><td class="formula">${P.consignment
          ? `max(0, ${fmtN(p.target_qty)} − ${P.lineside_days} days × ${fmtN(c.daily, 1)}) × ${fmtCost(p.unit_cost_usd)}. Ownership moves to the supplier; reported apart from excess.`
          : "Consignment is off in Policy"}</td><td class="res">${fmtUSD(p.consignment_transfer_value, 2)}</td></tr>` : ""}
      </tbody></table>`;
  }
  $("#dBody").innerHTML = body + drawerExceptions(state.exc?.open.filter((x) => x.part?.part_number === p.part_number) || []) + drawerCoverage(state.pipeByPart?.get(p.part_number));
  drawChart(p);
}

function drawChart(p) {
  if (chart) { chart.destroy(); chart = null; }
  const canvas = $("#dChart");
  if (!canvas || typeof Chart === "undefined") return;
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const labels = state.result.weeks.length ? state.result.weeks : p.demand.map((_, i) => "w" + String(i + 1).padStart(2, "0"));
  chart = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Weekly demand", data: p.demand, backgroundColor: v("--vmi"), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.9, order: 2 },
        { type: "line", label: `Avg ${fmtN(p.avg_weekly)} /wk`, data: p.demand.map(() => p.avg_weekly), borderColor: v("--ink"), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: v("--ink-2"), boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => ctx.datasetIndex === 0 ? `Demand ${fmtN(ctx.parsed.y)}` : `Average ${fmtN(p.avg_weekly)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: v("--axis") }, ticks: { color: v("--muted"), font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 13 } },
        y: { beginAtZero: true, grid: { color: v("--grid") }, border: { display: false }, ticks: { color: v("--muted"), font: { size: 10 }, maxTicksLimit: 5, callback: (x) => Intl.NumberFormat("en-US", { notation: "compact" }).format(x) } },
      },
    },
  });
}

/* ---------------- policy panel ---------------- */
const pctF = { pct: true, step: 1, min: 0, max: 100 };
const POLICY_GROUPS = [
  { title: "ABC by annual spend", fields: [
    { path: "abc_a", label: "A if cumulative share before <", unit: "%", ...pctF },
    { path: "abc_b", label: "B if cumulative share before <", unit: "%", ...pctF },
    { path: "super_a", label: "Super A if cumulative share before <", unit: "%", ...pctF },
  ] },
  { title: "XYZ by variability", fields: [
    { path: "cv_x", label: "Y from CV ≥", step: 0.05, min: 0 },
    { path: "cv_y", label: "Z from CV ≥", step: 0.05, min: 0 },
    { path: "zero_share_z", label: "Z if zero-demand weeks >", unit: "%", ...pctF },
  ] },
  { title: "Trend (overrides the matrix)", fields: [
    { path: "trend_weeks", label: "Compare first vs last N weeks", step: 1, min: 1, max: 13, int: true },
    { path: "trend_up", label: "Ramp if last ÷ first >", step: 0.05, min: 0 },
    { path: "trend_down", label: "Declining if last ÷ first <", step: 0.05, min: 0 },
  ] },
  { title: "Program rules", fields: [
    { path: "vmi_lt_ax", label: "AX → VMI if lead time ≥", hint: "weeks; else CRP", step: 1, min: 0 },
    { path: "vmi_lt_ay", label: "AY → VMI if lead time ≥", hint: "weeks; else CRP", step: 1, min: 0 },
    { path: "kanban_max_cost", label: "BX → Kanban if unit cost <", hint: "USD; else CRP", step: 0.1, min: 0 },
  ] },
  { title: "Service factor z by class", fields: [
    { path: "z.A", label: "Class A", step: 0.05, min: 0 },
    { path: "z.B", label: "Class B", step: 0.05, min: 0 },
    { path: "z.C", label: "Class C", step: 0.05, min: 0 },
  ] },
  { title: "Excess, MOQ and consignment", fields: [
    { path: "tolerance", label: "Excess above target ×", hint: "1.20 = 20% tolerance", step: 0.05, min: 1 },
    { path: "moq_weeks_flag", label: "Flag MOQ above", hint: "weeks of avg demand", step: 1, min: 0 },
    { path: "lineside_days", label: "Line-side stock the plant keeps", hint: "days, VMI consignment", step: 1, min: 0 },
  ] },
  { title: "Director views", fields: [
    { path: "carrying_rate", label: "Carrying cost rate", hint: "% of inventory value per year", unit: "%", ...pctF },
    { path: "eo_horizon_weeks", label: "E&O horizon", hint: "weeks of recent run-rate", step: 1, min: 1, int: true },
    { path: "eo_dos_days", label: "Slow mover above", hint: "days on hand", step: 10, min: 0 },
    { path: "wave2_share", label: "Wave 2 covers", hint: "% of VMI/CRP spend, top suppliers", unit: "%", ...pctF },
    { path: "wave_months", label: "Months per wave", step: 1, min: 1, int: true },
  ] },
  { title: "Freshness claims", fields: [
    { path: "fresh_default_rule_months", label: "Default freshness rule", hint: "months; when the supplier has none", step: 1, min: 1, int: true },
    { path: "fresh_grace_months", label: "Claim only if over the rule by more than", hint: "months at receipt", step: 1, min: 0 },
  ] },
  { title: "Pipeline coverage", fields: [
    { path: "fc_upside", label: "Forecast upside if ÷ history >", step: 0.05, min: 0 },
    { path: "fc_downside", label: "Forecast downside if ÷ history <", step: 0.05, min: 0 },
    { path: "fc_hist_weeks", label: "History compared", hint: "last N actual weeks", step: 1, min: 1, max: 26, int: true },
  ] },
  { title: "Suppliers and MOQ & LT", fields: [
    { path: "hub_warn_months", label: "Flag hub contracts ending within", hint: "months", step: 1, min: 0, int: true },
    { path: "moq_opp_weeks", label: "MOQ opportunity above", hint: "weeks of avg demand", step: 1, min: 0 },
    { path: "lt_opp_min_weeks", label: "LT opportunity for A parts above", hint: "weeks of lead time", step: 1, min: 0 },
    { path: "lt_cut_weeks", label: "Lead-time cut to evaluate", hint: "weeks", step: 1, min: 1 },
  ] },
  { title: "Exceptions", fields: [
    { path: "exc_now_weeks", label: "Act now if supply is hit within", hint: "weeks", step: 1, min: 0, int: true },
    { path: "exc_big_value", label: "Large impact from", hint: "USD; raises severity", step: 10000, min: 0 },
    { path: "exc_lt_jump_weeks", label: "Lead-time increase exception from", hint: "weeks added", step: 1, min: 0 },
    { path: "exc_price_pct", label: "Price increase exception from", unit: "%", ...pctF },
    { path: "exc_otd_min", label: "Supplier OTD target", hint: "%; below = exception", step: 1, min: 0, max: 100 },
    { path: "exc_ltb_weeks", label: "Last-time buy covers", hint: "weeks of demand", step: 1, min: 0, int: true },
    { path: "exc_repeat", label: "Review a part's program from", hint: "kinds of exception", step: 1, min: 2, int: true },
    { path: "sla_critical_days", label: "SLA Critical", hint: "days", step: 1, min: 0, int: true },
    { path: "sla_high_days", label: "SLA High", hint: "days", step: 1, min: 0, int: true },
    { path: "sla_medium_days", label: "SLA Medium", hint: "days", step: 1, min: 0, int: true },
    { path: "sla_low_days", label: "SLA Low", hint: "days", step: 1, min: 0, int: true },
  ] },
  { title: "Sales view", fields: [
    { path: "destock_weeks", label: "Plant reaches target stock in", hint: "weeks; sets the sell-in dip", step: 1, min: 1, int: true },
    { path: "sales_horizon_weeks", label: "Sell-in projection", hint: "weeks ahead", step: 1, min: 4, max: 52, int: true },
  ] },
];
const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }
const display = (f, v) => (v === null ? "" : f.pct ? +(v * 100).toFixed(4) : v);

function buildPolicyForm() {
  const field = (f) => `<div class="field"><label for="pol-${f.path}">${f.label}${f.hint ? `<small>${f.hint}</small>` : ""}</label>
    <input id="pol-${f.path}" type="number" inputmode="decimal" data-path="${f.path}" ${f.pct ? "data-pct" : ""} ${f.int ? "data-int" : ""}
      step="${f.step}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""}></div>`;
  let html = POLICY_GROUPS.slice(0, 5).map((g) => `<fieldset><legend>${g.title}</legend>${g.fields.map(field).join("")}</fieldset>`).join("");
  html += `<fieldset><legend>Target inventory per program</legend>
    <table class="ptable"><thead><tr><th>Program</th><th>R wks</th><th>L wks</th><th>Floor days</th></tr></thead><tbody>
    ${PROGRAMS.map((p) => `<tr><td>${badge(p)}</td>
      <td><input type="number" step="1" min="0" data-path="review.${p}" aria-label="${p} review period"></td>
      <td><input type="number" step="1" min="0" data-path="exposure.${p}" data-nullable ${p === "MRP" ? 'placeholder="LT"' : ""} aria-label="${p} exposure lead time"></td>
      <td><input type="number" step="1" min="0" data-path="floor_days.${p}" aria-label="${p} floor days"></td></tr>`).join("")}
    </tbody></table>
    <p class="hint" style="margin-top:6px">Blank L = use the part's own lead time. Safety = z × σ × √(R+L); cycle = max(avg × R, MOQ) ÷ 2; target = max(safety + cycle, floor).</p>
    </fieldset>`;
  const g = POLICY_GROUPS[5];
  html += `<fieldset><legend>${g.title}</legend>${g.fields.map(field).join("")}
    <label class="toggle"><span>VMI on consignment<small class="hint" style="display:block">Report the ownership transfer for VMI parts</small></span><input type="checkbox" id="pol-consignment" data-path="consignment"></label></fieldset>`;
  html += POLICY_GROUPS.slice(6).map((g) => `<fieldset><legend>${g.title}</legend>${g.fields.map(field).join("")}</fieldset>`).join("");
  $("#policyForm").innerHTML = html;
  syncPolicyInputs();
}

function syncPolicyInputs() {
  for (const el of $("#policyForm").querySelectorAll("[data-path]")) {
    const path = el.dataset.path, v = getPath(state.policy, path), d = getPath(DEFAULT_POLICY, path);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = display({ pct: el.hasAttribute("data-pct") }, v);
    el.classList.toggle("changed", JSON.stringify(v) !== JSON.stringify(d));
  }
}

function onPolicyInput(e) {
  const el = e.target;
  if (!el.dataset.path) return;
  const path = el.dataset.path;
  let v;
  if (el.type === "checkbox") v = el.checked;
  else if (el.value.trim() === "" && el.hasAttribute("data-nullable")) v = null;
  else {
    v = Number(el.value);
    if (el.value.trim() === "" || !Number.isFinite(v) || el.validity.rangeUnderflow || el.validity.rangeOverflow) return; // keep last valid value
    if (el.hasAttribute("data-pct")) v = v / 100;
    if (el.hasAttribute("data-int")) v = Math.round(v);
  }
  setPath(state.policy, path, v);
  el.classList.toggle("changed", JSON.stringify(v) !== JSON.stringify(getPath(DEFAULT_POLICY, path)));
  recompute();
}

function policyDiffCount() {
  let n = 0;
  const walk = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === "object") walk(a[k], b[k]); else if (a[k] !== b[k]) n++; } };
  walk(state.policy, DEFAULT_POLICY);
  return n;
}
function renderPolicyDiff() {
  const n = policyDiffCount(), el = $("#policyDiff");
  el.hidden = !n;
  el.textContent = n;
  el.title = `${n} parameter${n === 1 ? "" : "s"} changed from defaults`;
}

function togglePolicy(open) {
  const panel = $("#policy");
  const isOpen = open ?? panel.hidden;
  panel.hidden = !isOpen;
  $("#policyToggle").setAttribute("aria-expanded", String(isOpen));
}

/* ---------------- export ---------------- */
function exportCSV() {
  if (!state.result?.parts.length) return;
  const cols = ["part_number", "description", "commodity", "supplier", ...RESULT_COLUMNS.slice(1)];
  const data = state.result.parts.map((p) => ({ description: p.description, commodity: p.commodity, supplier: p.supplier, ...resultRow(p) }));
  const csv = Papa.unparse({ fields: cols, data: data.map((r) => cols.map((c) => r[c])) });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "pull_program_fit_results.csv" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- template ---------------- */
function downloadTemplate() {
  const weeks = Array.from({ length: 26 }, (_, i) => "w" + String(i + 1).padStart(2, "0"));
  const head = ["part_number", "description", "commodity", "manufacturer", "supplier", "unit_cost_usd", "lead_time_weeks", "moq", "current_program", "on_hand_qty", ...weeks];
  const demand = (base, swing) => weeks.map((_, i) => Math.round(base + swing * Math.sin(i * 1.7)));
  const rows = [
    ["EX-0001", "Example MLCC capacitor", "MLCC Capacitor", "Example Manufacturer", "Example Distributor", 0.012, 14, 10000, "MRP", 250000, ...demand(60000, 8000)],
    ["EX-0002", "Example microcontroller", "Microcontroller", "Example Semiconductor", "Example Franchise", 3.85, 22, 490, "VMI", 6200, ...demand(1400, 200)],
  ];
  const csv = [head, ...rows].map((r) => r.join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "pull_program_template.csv" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- events ---------------- */
const TABS = ["parts", "exceptions", "suppliers", "pipeline", "opps", "waves", "risk", "scenarios", "freshness", "integrity"];
function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".tab")) { const on = b.dataset.tab === tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
  for (const t of TABS) $(`#tab-${t}`).hidden = t !== tab;
}

function bind() {
  $("#upload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => loadText(t, file.name));
    e.target.value = "";
  });
  $("#export").addEventListener("click", exportCSV);
  const guide = $("#guide");
  const openGuide = (e) => { e?.preventDefault(); guide.showModal(); };
  $("#formatHelp").addEventListener("click", openGuide);
  $("#notice").addEventListener("click", (e) => { if (e.target.closest("[data-guide]")) openGuide(e); });
  guide.addEventListener("click", (e) => { if (e.target === guide || e.target.closest("[data-close]")) guide.close(); });
  $("#dlTemplate").addEventListener("click", downloadTemplate);
  $("#policyToggle").addEventListener("click", () => togglePolicy());
  $("#policyClose").addEventListener("click", () => togglePolicy(false));
  $("#policyReset").addEventListener("click", () => { state.policy = clonePolicy(); syncPolicyInputs(); recompute(); });
  $("#policyForm").addEventListener("input", onPolicyInput);
  $("#policyForm").addEventListener("change", onPolicyInput);
  $("#policyForm").addEventListener("submit", (e) => e.preventDefault());

  const onF = () => {
    Object.assign(state.filters, {
      search: $("#fSearch").value, commodity: $("#fCommodity").value, supplier: $("#fSupplier").value,
      abc: $("#fAbc").value, current: $("#fCurrent").value, rec: $("#fRec").value,
      superA: $("#fSuperA").checked, change: $("#fChange").checked, issue: $("#fIssue").checked,
    });
    renderTable();
  };
  $("#filters").addEventListener("input", onF);
  $("#filters").addEventListener("change", onF);
  $("#fClear").addEventListener("click", () => { state.filters = emptyFilters(); syncFilterInputs(); renderMatrix(); renderMigration(); renderTable(); });

  $("#matrix").addEventListener("click", (e) => {
    const c = e.target.closest("[data-cell]");
    if (!c) return;
    state.filters.cell = state.filters.cell === c.dataset.cell ? null : c.dataset.cell;
    setTab("parts"); renderMatrix(); renderTable();
  });
  $("#migration").addEventListener("click", (e) => {
    const c = e.target.closest("[data-mig]");
    if (!c) return;
    state.filters.mig = state.filters.mig === c.dataset.mig ? null : c.dataset.mig;
    setTab("parts"); renderMigration(); renderTable();
  });
  $("#chips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-chip]");
    if (!c) return;
    state.filters[c.dataset.chip] = null;
    renderMatrix(); renderMigration(); renderTable();
  });

  $("#partsTable thead").addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const key = th.dataset.sort, col = COLS.find((c) => c.key === key);
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: col.n ? -1 : 1 };
    renderTable();
  });
  for (const sel of ["#partsTable tbody", "#integrityTable", "#tab-waves", "#tab-risk", "#tab-freshness", "#tab-pipeline", "#tab-opps", "#planner", "#tab-exceptions"]) {
    $(sel).addEventListener("click", (e) => { const r = e.target.closest("[data-part]"); if (r) openDrawer(r.dataset.part); });
  }
  $("#supplierTable").addEventListener("click", (e) => {
    const r = e.target.closest("[data-supplier]");
    if (!r) return;
    state.filters = { ...emptyFilters(), supplier: r.dataset.supplier };
    syncFilterInputs(); setTab("parts"); renderMatrix(); renderMigration(); renderTable();
  });
  document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });

  $("#dClose").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#drawer").hidden) closeDrawer(); else togglePolicy(false); } });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.openPart) renderDrawer(state.openPart);
    if (state.view === "story" && state.result) drawStory();
    if (state.view === "sales" && state.result) drawSales();
  });
  document.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b && b.dataset.view !== state.view) setView(b.dataset.view); });
}

/* ---------------- director views ---------------- */
function policyRowsAll(policy = state.policy) {
  const fields = POLICY_GROUPS.flatMap((g) => g.fields);
  const rows = fields.map((f) => ({ path: f.path, label: f.label, pct: f.pct }));
  for (const p of PROGRAMS) {
    rows.push({ path: `review.${p}`, label: `${p} review period R (wks)` });
    rows.push({ path: `exposure.${p}`, label: `${p} exposure L (wks)` });
    rows.push({ path: `floor_days.${p}`, label: `${p} floor (days)` });
  }
  rows.push({ path: "consignment", label: "VMI on consignment" });
  const show = (r, v) => (v === null ? "Part LT" : typeof v === "boolean" ? (v ? "On" : "Off") : r.pct ? fmtPct(v, 1).replace(".0%", "%") : String(v));
  return rows.map((r) => {
    const def = getPath(DEFAULT_POLICY, r.path), cur = getPath(policy, r.path);
    return { ...r, def: show(r, def), cur: show(r, cur), changed: JSON.stringify(def) !== JSON.stringify(cur) };
  });
}
const describeChanges = (policy) => policyRowsAll(policy).filter((r) => r.changed).map((r) => `${r.label}: ${r.def} → ${r.cur}`).join("; ");

function drawStory() {
  if (!state.result) return;
  renderStory($("#story"), state.result, state.policy, state.insights, {
    scenarios: state.scenarios,
    current: scenarioMetrics(state.result, state.insights),
    currentChanges: describeChanges(state.policy),
    openPart: (pn) => openDrawer(pn),
    filterSupplier,
  });
}

function filterSupplier(sup) {
  state.filters = { ...emptyFilters(), supplier: sup };
  syncFilterInputs(); setView("analysis"); setTab("parts"); renderMatrix(); renderMigration(); renderTable();
}

function drawSales() {
  if (!state.result) return;
  renderSales($("#sales"), state.result, state.policy, state.sales, { filterSupplier });
}

function renderWaves() {
  const W = state.insights.waves;
  const cards = W.map((w) => `<div class="wave">
      <div class="wave-head"><b>${w.label}</b><span class="muted">${w.when}</span></div>
      <p class="hint">${esc(w.what)}</p>
      <div class="wave-num">${fmtM(w.net)}<small> net inventory released</small></div>
      <div class="wave-sub">${fmtM(w.released)} released · ${fmtM(w.built)} built up · cumulative ${fmtM(w.cumulative)}</div>
      <div class="wave-sub">${w.n} parts · ${w.changes} program changes · excess ${fmtM(w.excess)}${w.consignment ? ` · consignment ${fmtM(w.consignment)}` : ""}</div>
      ${w.suppliers.length ? `<div class="wave-sup">${w.suppliers.map((x) => `<span class="chip-static">${esc(x.supplier)} <span class="muted">${fmtM(x.spend)}</span></span>`).join("")}</div>` : ""}
    </div>`).join("");
  const rows = W.flatMap((w) => [...w.parts].sort((a, b) => (b.inv_value_current - b.inv_value_target) - (a.inv_value_current - a.inv_value_target)).map((p) => `
    <tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td>${w.label}</td><td class="pn">${esc(p.part_number)}</td><td>${esc(p.supplier)}</td>
      <td>${badge(p.current_program)}</td><td>${badge(p.recommended_program)}${p.program_change ? "" : ' <span class="tag">keep</span>'}</td>
      <td class="n">${fmtUSD(p.inv_value_current - p.inv_value_target)}</td><td class="n ${p.excess_value ? "" : "muted"}">${fmtUSD(p.excess_value)}</td></tr>`)).join("");
  $("#tab-waves").innerHTML = `<p class="hint">Wave 1 needs no supplier agreement. Waves 2 and 3 move VMI/CRP parts supplier by supplier, largest VMI/CRP spend first. Thresholds are in Policy → Director views.</p>
    <div class="waves">${cards}</div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Wave</th><th>Part</th><th>Supplier</th><th>Current</th><th>Recommended</th><th class="n">Inventory released</th><th class="n">Excess $</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRisk() {
  const I = state.insights, P = state.policy;
  const tier = (t) => `<span class="${t === "Critical" ? "issue-block" : "issue-warn"}">${t === "Critical" ? "Below safety" : "Below target"}</span>`;
  $("#tab-risk").innerHTML = `
    <h3>Stockout risk</h3>
    <p class="hint">${I.critical.length} parts below safety stock (build-up ${fmtM(I.criticalBuild)}) and ${I.risk.length - I.critical.length} below target. Bringing all of them to target takes ${fmtM(I.riskBuild)}.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Status</th><th>Part</th><th>Supplier</th><th>Recommended</th><th class="n">On hand</th><th class="n">Safety stock</th><th class="n">Target</th><th class="n">Weeks of cover</th><th class="n">Build-up $</th></tr></thead><tbody>
    ${I.risk.map((r) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td>${tier(r.tier)}</td><td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td>
      <td>${badge(r.part.recommended_program)}</td><td class="n">${fmtN(r.part.on_hand_qty)}</td><td class="n">${fmtN(r.safety)}</td><td class="n">${fmtN(r.part.target_qty)}</td>
      <td class="n">${fmtN(r.weeks_cover, 1)}</td><td class="n">${fmtUSD(r.build_value)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">No part below target.</td></tr>`}
    </tbody></table></div>
    <h3>Excess &amp; obsolescence (E&amp;O) exposure</h3>
    <p class="hint">Stock beyond ${P.eo_horizon_weeks} weeks at the recent run-rate (last ${P.trend_weeks} weeks), on declining parts or slow movers (over ${P.eo_dos_days} days on hand): ${fmtM(I.eoValue)} across ${I.eo.length} parts.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Part</th><th>Supplier</th><th>Why</th><th class="n">On hand</th><th class="n">Run-rate / wk</th><th class="n">Needed in ${P.eo_horizon_weeks} wks</th><th class="n">Exposed qty</th><th class="n">Exposure $</th></tr></thead><tbody>
    ${I.eo.map((e) => `<tr class="clickable" tabindex="0" data-part="${esc(e.part.part_number)}"><td class="pn">${esc(e.part.part_number)}</td><td>${esc(e.part.supplier)}</td><td>${esc(e.why)}</td>
      <td class="n">${fmtN(e.part.on_hand_qty)}</td><td class="n">${fmtN(e.runRate)}</td><td class="n">${fmtN(e.covered)}</td><td class="n">${fmtN(e.excess_qty)}</td><td class="n">${fmtUSD(e.value)}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No exposure at the current thresholds.</td></tr>`}
    </tbody></table></div>`;
}

function renderScenarios() {
  const cur = scenarioMetrics(state.result, state.insights);
  const all = [{ name: "Current policy", metrics: cur, changes: describeChanges(state.policy), current: true }, ...state.scenarios];
  const best = (r) => {
    if (!r.better || all.length < 2) return -1;
    const vals = all.map((x) => x.metrics[r.key]);
    const v = r.better === "low" ? Math.min(...vals) : Math.max(...vals);
    return vals.filter((x) => x === v).length === vals.length ? -1 : vals.indexOf(v);
  };
  const nextName = `Scenario ${String.fromCharCode(65 + state.scenarios.length)}`;
  $("#tab-scenarios").innerHTML = `
    <div class="scen-bar">
      <input type="text" id="scenName" placeholder="${nextName}" aria-label="Scenario name" maxlength="40">
      <button type="button" class="btn btn-primary" data-scen="save">Save current policy as scenario</button>
      <span class="hint">Adjust Policy, save, repeat. Scenarios last for this session and appear in the Story view and the deck.</span>
    </div>
    <div class="table-wrap"><table class="grid scen"><thead><tr><th>Metric</th>${all.map((x, i) => `<th class="n">${esc(x.name)}${x.current ? "" : `<div class="scen-actions"><button type="button" class="btn btn-ghost" data-scen="apply" data-i="${i - 1}">Apply</button><button type="button" class="btn btn-ghost" data-scen="remove" data-i="${i - 1}">Remove</button></div>`}</th>`).join("")}</tr></thead>
    <tbody>${SCENARIO_ROWS.map((r) => { const b = best(r); return `<tr><td>${r.label}</td>${all.map((x, i) => `<td class="n ${i === b ? "best" : ""}">${fmtMetric(x.metrics[r.key], r.fmt)}</td>`).join("")}</tr>`; }).join("")}
      <tr><td>Policy changes vs. default</td>${all.map((x) => `<td class="muted small">${esc(x.changes || "Default policy")}</td>`).join("")}</tr></tbody></table></div>
    ${state.scenarios.length ? "" : `<p class="hint" style="margin-top:8px">No scenarios saved yet. Try: save the default, then raise z to 2.05 for class A and save again.</p>`}`;
}

function saveScenario() {
  const name = ($("#scenName")?.value || "").trim() || `Scenario ${String.fromCharCode(65 + state.scenarios.length)}`;
  state.scenarios.push({ name, policy: clonePolicy(state.policy), metrics: scenarioMetrics(state.result, state.insights), changes: describeChanges(state.policy) });
  renderScenarios();
  if (state.view === "story") drawStory();
}

function storyKpis() {
  const S = state.result.summary, C = state.insights.carrying, P = state.policy;
  const d = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;
  return [
    { label: "Spend under pull programs", value: `${fmtPct(S.pull_share_now)} → ${fmtPct(S.pull_share_rec)}`, sub: "today vs recommended" },
    { label: "Inventory", value: `${fmtM(S.inv_now)} → ${fmtM(S.inv_target)}`, sub: `${d <= 0 ? "−" : "+"}${fmtPct(Math.abs(d))} at the recommended policy` },
    { label: "Excess to right-size", value: fmtM(S.excess), sub: `one-time cash, above target × ${P.tolerance.toFixed(2)}`, accent: "006300" },
    { label: "Carrying cost avoided", value: `${fmtM(C.avoided)}/yr`, sub: `recurring P&L at ${fmtPct(C.rate)}`, accent: "006300" },
    { label: "Consignment transfer", value: P.consignment ? fmtM(S.consignment) : "Off", sub: "ownership to suppliers, not a saving", accent: "2A78D6" },
  ];
}

async function downloadDeck(btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Building deck…";
  try {
    const S = state.result.summary, C = state.insights.carrying;
    const changed = policyRowsAll().filter((r) => r.changed).length;
    await exportDeck({
      storyEl: $("#story"),
      rerender: drawStory,
      kpis: storyKpis(),
      policyRows: policyRowsAll(),
      meta: {
        subtitle: `${S.analyzed} of ${S.parts} parts analyzed · ${fmtM(S.annual_spend)} annual spend · ${$("#source").title || "uploaded data"} · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
        policyNote: changed ? `Policy: ${changed} parameter${changed === 1 ? "" : "s"} changed from defaults (see appendix)` : "Policy: defaults (see appendix)",
        summaryHeadline: `Pull coverage goes from ${fmtPct(S.pull_share_now)} to ${fmtPct(S.pull_share_rec)} of spend, inventory from ${fmtM(S.inv_now)} to ${fmtM(S.inv_target)}, avoiding ${fmtM(C.avoided)} a year in carrying cost`,
        footer: /sample/.test($("#source").title) ? "Synthetic data. Part numbers, manufacturers and suppliers are fictional." : "Pull Program Fit Analyzer",
      },
    });
  } catch (err) {
    console.error(err);
    showNotice(esc(err.message || String(err)));
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

function downloadPng(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff";
  const { data } = canvasPng(canvas, bg);
  const name = (canvas.closest(".story-card")?.dataset.eyebrow || id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = Object.assign(document.createElement("a"), { href: data, download: `${name}.png` });
  document.body.appendChild(a); a.click(); a.remove();
}

function bindKeyboard() {
  // Enter/Space activate clickable rows and sortable headers, like buttons.
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr.clickable, th.sortable, .pn.clickable")) { e.preventDefault(); e.target.click(); }
  });
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); setTab(next.dataset.tab);
  });
  // Scenarios live in memory only: warn before they are lost.
  window.addEventListener("beforeunload", (e) => { if (state.scenarios.length) { e.preventDefault(); e.returnValue = ""; } });
}

function bindDirector() {
  $("#story").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act?.dataset.act === "deck") downloadDeck(act);
    if (act?.dataset.act === "present") {
      const el = $("#story");
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.().catch(() => {});
    }
    const png = e.target.closest("[data-png]");
    if (png) downloadPng(png.dataset.png);
  });
  $("#sales").addEventListener("click", (e) => {
    if (e.target.closest("[data-act]")?.dataset.act === "present") {
      if (document.fullscreenElement) document.exitFullscreen();
      else $("#sales").requestFullscreen?.().catch(() => {});
    }
    const png = e.target.closest("[data-png]");
    if (png) downloadPng(png.dataset.png);
  });
  document.addEventListener("fullscreenchange", () => { if (state.view === "story") drawStory(); if (state.view === "sales") drawSales(); });
  $("#tab-scenarios").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scen]");
    if (!b) return;
    if (b.dataset.scen === "save") saveScenario();
    if (b.dataset.scen === "apply") { state.policy = clonePolicy(state.scenarios[+b.dataset.i].policy); syncPolicyInputs(); recompute(); }
    if (b.dataset.scen === "remove") { state.scenarios.splice(+b.dataset.i, 1); renderScenarios(); if (state.view === "story") drawStory(); }
  });
  $("#tab-scenarios").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "scenName") saveScenario(); });
}

bind();
bindDirector();
bindFreshness();
bindLayers();
bindExceptions();
bindKeyboard();
setView(state.view);
window.addEventListener("hashchange", () => { const v = VIEW_HASH[location.hash] || "analysis"; if (v !== state.view) setView(v); });
buildPolicyForm();
loadSample();
loadV2();
