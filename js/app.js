import { analyze, DEFAULT_POLICY, clonePolicy, PROGRAMS, RESULT_COLUMNS, resultRow } from "./segment.js?v=19";
import { renderStory, destroyStory, fmtMetric } from "./story.js?v=19";
import { insights, scenarioMetrics, SCENARIO_ROWS } from "./insights.js?v=19";
import { exportDeck, canvasPng } from "./deck.js?v=19";
import { esc, fmtN, fmtUSD, fmtM, fmtPct, fmtCost, fmtCompact, fmtDate } from "./format.js?v=19";
import { sellIn } from "./sales.js?v=19";
import { freshness, ANALYSIS_DATE, CLAIM_COLUMNS, claimRow } from "./freshness.js?v=19";
import { pipeline, scorecard, opportunities, valuePipeline, executive, cashBridge, ESCALATION_COLUMNS, escalationRow } from "./v2.js?v=19";
import { renderExecTop, plannerActions, renderPlanner, renderPipelineTab, renderScorecard, renderOppsTab, drawerCoverage, renderExceptionsTab, drawerExceptions, claimTextFor } from "./layers.js?v=19";
import { exceptions, STATUSES as XSTATUSES, SEVERITIES, CATEGORIES, resolutionCodes, EXCEPTION_COLUMNS, exceptionRow } from "./exceptions.js?v=19";
import { renderSales, destroySales } from "./sales-view.js?v=19";
import { t, tv, tx, getLang, setLang, onLang, applyStatic } from "./i18n.js?v=19";
import { pc, badge, blockedBadge, paged, rowLimits, PAGE } from "./ui.js?v=19";

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
  sourceLabel: "", sample: false,
};
function emptyXFilters() { return { search: "", status: "open", sev: "", cat: "", owner: "", supplier: "", all: false }; }
const XLIB = { STATUSES: XSTATUSES, SEVERITIES, CATEGORIES, resolutionCodes };
function emptyFilters() {
  return { search: "", commodity: "", supplier: "", abc: "", current: "", rec: "", superA: false, change: false, issue: false, cell: null, mig: null };
}

const $ = (s, el = document) => el.querySelector(s);
const issuesText = (p) => p.issues.map((m) => tx("issue.", m)).join("; ");

/* ---------------- data loading ---------------- */
const REQUIRED = ["part_number", "unit_cost_usd", "lead_time_weeks", "moq", "current_program", "on_hand_qty"];

function loadText(text, label) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const fields = parsed.meta.fields || [];
  const missing = REQUIRED.filter((c) => !fields.includes(c));
  const weeks = fields.filter((c) => /^w\d+$/.test(c));
  if (missing.length || !weeks.length) {
    const cols = [...missing, ...(weeks.length ? [] : ["w01…w26"])];
    showNotice(t("notice.missingCols", { file: esc(label), n: cols.length, cols: esc(cols.join(", ")) }) + ` <a href="#" data-guide>${t("notice.seeFormatTemplate")}</a>.`);
    return;
  }
  const rows = parsed.data.filter((r) => String(r.part_number ?? "").trim() !== "");
  if (!rows.length) { showNotice(t("notice.noParts", { file: esc(label) })); return; }
  showNotice("");
  state.rows = rows;
  state.filters = emptyFilters();
  state.openPart = null;
  rowLimits.clear();
  state.sample = /\(sample\)$/.test(label);
  state.sourceLabel = state.sample ? label.replace(/ \(sample\)$/, "") : label;
  renderSource();
  closeDrawer();
  buildFilterOptions();
  syncFilterInputs();
  state.justLoaded = state.sample ? null : label;
  recompute();
}

function renderSource() {
  const el = $("#source");
  if (!state.sourceLabel) { el.textContent = t("header.noData"); el.title = ""; return; }
  el.textContent = t("header.source", { file: state.sourceLabel + (state.sample ? ` ${t("common.sampleTag")}` : ""), n: fmtN(state.rows.length) });
  el.title = state.sourceLabel;
}

function showNotice(html, kind = "error") {
  const n = $("#notice");
  n.innerHTML = html;
  n.hidden = !html;
  n.classList.toggle("ok", kind === "ok");
  n.setAttribute("role", kind === "ok" ? "status" : "alert");
}

// Every upload goes through here: uploaded files are untrusted input.
// Only .csv / text files up to MAX_UPLOAD_MB, not empty, not binary. Parsing errors never blank the page:
// the previous data stays loaded and a notice explains what went wrong.
const MAX_UPLOAD_MB = 10;
function readUpload(input, onText) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const name = esc(file.name);
  const isCsv = /\.csv$/i.test(file.name) || /^text\/(csv|plain)$/i.test(file.type);
  if (!isCsv) { showNotice(t("notice.notCsv", { file: name }) + ` <a href="#" data-guide>${t("notice.seeFormat")}</a>.`); return; }
  if (file.size === 0) { showNotice(t("notice.empty", { file: name })); return; }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { showNotice(t("notice.tooBig", { file: name, mb: fmtN(file.size / 1048576, 1), max: MAX_UPLOAD_MB })); return; }
  Promise.all([file.text(), papaReady]).then(([text]) => {
    if (text.slice(0, 4096).includes("\u0000")) { showNotice(t("notice.binary", { file: name })); return; }
    try { onText(text.replace(/^﻿/, ""), file.name); }
    catch (err) { console.error(err); showNotice(t("notice.parseError", { file: name, err: esc(err.message || String(err)) })); }
  }, () => showNotice(t("notice.cantOpen", { file: name })));
}

// Papa Parse loads async (index.html), so the sample files download while it arrives.
const papaReady = typeof Papa !== "undefined" ? Promise.resolve() : new Promise((ok, fail) => {
  const s = document.querySelector('script[src*="papaparse"]');
  if (!s) { fail(new Error("Papa Parse missing")); return; }
  s.addEventListener("load", ok); s.addEventListener("error", () => fail(new Error("Papa Parse failed to load")));
});

async function loadSample() {
  let text;
  try {
    const res = await fetch("data/sample_parts.csv");
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
    await papaReady;
  } catch {
    state.sourceLabel = ""; renderSource();
    showNotice(t("notice.sampleFailed"));
    document.documentElement.classList.remove("loading");
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
    state.bridge = cashBridge(state.result, state.insights, state.opps);
    state.exec = executive({ result: state.result, insights: state.insights, pipe: state.pipe, score: state.score });
    state.exc = exceptions({ result: state.result, insights: state.insights, pipe: state.pipe, fresh: state.fresh, score: state.score, events: state.events, P, claimStatus: cs, statusOf: (id) => state.excStatus.get(id) });
    renderAll();
  });
}

// Only what is on screen is rendered; hidden Manager tabs are marked stale and drawn when opened.
const stale = new Set();
function renderAll() {
  if (state.justLoaded) {
    const S = state.result.summary;
    showNotice(t("notice.loaded", { file: esc(state.justLoaded), n: fmtN(S.parts), a: fmtN(S.analyzed) }) + (S.blocked ? t("notice.loadedBlocked", { n: fmtN(S.blocked) }) : "") + ". " + t("notice.staysHere"), "ok");
    state.justLoaded = null;
  }
  renderCounts();
  renderPolicyDiff();
  for (const tab of TABS) stale.add(tab);
  if (state.view === "analysis") renderManager();
  if (state.view === "story") { drawExecTop(); drawStory(); }
  if (state.view === "sales") drawSales();
  if (state.view === "planner") drawPlanner();
  if (state.openPart) renderDrawer(state.openPart);
  document.documentElement.classList.remove("loading");
}
function renderManager() {
  renderKPIs();
  renderMatrix();
  renderMigration();
  renderTab(state.tab);
}
const TAB_RENDER = {
  parts: () => renderTable(),
  exceptions: () => renderExceptions(),
  suppliers: () => { renderSuppliers(); $("#scorecard").innerHTML = renderScorecard(state.score, state.policy); },
  pipeline: () => { $("#tab-pipeline").innerHTML = renderPipelineTab(state.pipe, state.policy); },
  opps: () => { $("#tab-opps").innerHTML = renderOppsTab(state.opps, state.policy); },
  waves: () => renderWaves(),
  risk: () => renderRisk(),
  scenarios: () => renderScenarios(),
  freshness: () => renderFreshness(),
  integrity: () => renderIntegrity(),
};
function renderTab(tab) {
  if (!state.result) return;
  stale.delete(tab);
  TAB_RENDER[tab]();
}
function renderCounts() {
  const X = state.exc;
  $("#excCount").textContent = X.counts.Critical || "";
  $("#escCount").textContent = state.pipe.escalate.length || "";
  $("#claimCount").textContent = state.fresh.claimable.length || "";
  $("#issueCount").textContent = state.result.parts.filter((p) => p.issues.length).length;
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
  history.replaceState(null, "", view === "analysis" ? location.pathname + location.search : `${location.pathname}${location.search}#${view === "story" ? "exec" : view}`);
  if (view === "analysis" && state.result) renderManager();
  if (view === "planner" && state.result) drawPlanner();
  if (view === "story" && state.result) { drawExecTop(); drawStory(); }
  else destroyStory();
  if (view === "sales" && state.result) drawSales();
  else destroySales();
  window.scrollTo(0, 0);
}

/* ---------------- KPIs ---------------- */
const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
function renderKPIs() {
  const S = state.result.summary, P = state.policy;
  const invDelta = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;
  $("#kpis").innerHTML = [
    kpi(t("kpi.parts"), `${fmtN(S.analyzed)}<span class="arrow"> / ${fmtN(S.parts)}</span>`, t("kpi.partsSub", { b: fmtN(S.blocked), i: fmtN(S.with_issue) })),
    kpi(t("kpi.spend"), fmtM(S.annual_spend), t("kpi.spendSub", { n: S.super_a, p: fmtPct(P.super_a) })),
    kpi(t("kpi.inv"), `${fmtM(S.inv_now)}<span class="arrow">→</span>${fmtM(S.inv_target)}`,
      `<span class="delta-down">${invDelta <= 0 ? "−" : "+"}${fmtPct(Math.abs(invDelta))}</span> ${t("kpi.invSub")}`),
    kpi(t("kpi.excess"), fmtM(S.excess), t("kpi.excessSub", { tol: fmtN(P.tolerance, 2), wc: fmtM(state.bridge.working_capital) }), "excess"),
    kpi(t("kpi.carry"), `${fmtM(state.insights.carrying.avoided)}<span class="arrow">${t("unit.perYr")}</span>`, t("kpi.carrySub", { r: fmtPct(P.carrying_rate) }), "excess"),
    kpi(t("kpi.consign"), P.consignment ? fmtM(S.consignment) : t("common.off"), P.consignment ? t("kpi.consignSub") : t("kpi.consignOff"), "consign"),
    kpi(t("kpi.pull"), `${fmtPct(S.pull_share_now)}<span class="arrow">→</span>${fmtPct(S.pull_share_rec)}`, t("kpi.pullSub")),
    kpi(t("kpi.changes"), `${fmtN(S.program_changes)}<span class="arrow"> / ${fmtN(S.analyzed)}</span>`, t("kpi.changesSub", { p: fmtPct(S.analyzed ? S.program_changes / S.analyzed : 0) })),
  ].join("");
}

/* ---------------- matrix ---------------- */
function renderMatrix() {
  const S = state.result.summary, P = state.policy;
  const total = S.annual_spend || 1;
  const colHead = {
    X: `CV &lt; ${fmtN(P.cv_x, 2)}`,
    Y: `CV ${fmtN(P.cv_x, 2)}–${fmtN(P.cv_y, 2)}`,
    Z: t("matrix.zHead", { cv: fmtN(P.cv_y, 2), z: fmtPct(P.zero_share_z) }),
  };
  const rowHead = { A: `&lt; ${fmtPct(P.abc_a)}`, B: `&lt; ${fmtPct(P.abc_b)}`, C: t("matrix.rest") };
  let html = `<div></div>` + "XYZ".split("").map((x) => `<div class="axis col"><b>${x}</b><span>${colHead[x]}</span></div>`).join("");
  for (const a of "ABC") {
    const rowSpend = "XYZ".split("").reduce((tt, x) => tt + S.matrix[a + x].spend, 0);
    html += `<div class="axis"><b>${a}</b><span>${rowHead[a]} · ${t("matrix.spendShare", { p: fmtPct(rowSpend / total) })}</span></div>`;
    for (const x of "XYZ") {
      const k = a + x, c = S.matrix[k];
      if (!c.count) { html += `<div class="cell empty"><div class="count">0</div></div>`; continue; }
      const progs = Object.entries(c.programs).sort((m, n) => n[1] - m[1]);
      const dom = progs[0][0];
      const mix = progs.map(([p, n]) => `<span style="${pc(p)}; flex:${n}"></span>`).join("");
      const label = progs.slice(0, 3).map(([p, n]) => (progs.length === 1 ? p : `${p} ${n}`)).join(" · ");
      html += `<button type="button" class="cell ${state.filters.cell === k ? "active" : ""}" data-cell="${k}" style="${pc(dom)}"
        aria-label="${t("matrix.cellAria", { k, n: c.count, s: fmtM(c.spend), l: label })}">
        <div class="count">${c.count}<small>${t("matrix.parts")}</small></div>
        <div class="spend">${fmtM(c.spend)} · ${fmtPct(c.spend / total)}</div>
        <div class="prog">${label}</div>
        <div class="mix">${mix}</div></button>`;
    }
  }
  $("#matrix").innerHTML = html;
  $("#legend").innerHTML = PROGRAMS.map((p) => `<span><i style="${pc(p)}"></i>${p}${p === "MRP" ? ` ${t("matrix.noPull")}` : ""}</span>`).join("");
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
  let html = `<table class="mig"><thead><tr><th class="rowh">${t("mig.corner")}</th>${PROGRAMS.map((p) => `<th>${badge(p)}</th>`).join("")}<th>${t("common.total")}</th></tr></thead><tbody>`;
  for (const c of currents) {
    const rowTotal = s.filter((p) => p.current_program === c).length;
    if (!rowTotal && !PROGRAMS.includes(c)) continue;
    html += `<tr><th class="rowh">${badge(c)}</th>`;
    for (const r of PROGRAMS) {
      const k = c + "→" + r, v = n[k] || 0;
      const cls = !v ? "zero" : c === r ? "stay" : "move";
      const active = state.filters.mig === k ? "active" : "";
      html += `<td><button type="button" class="${cls} ${active}" ${v ? `data-mig="${esc(k)}"` : "disabled"}
        style="${pc(r)}; --w:${(v / maxOff).toFixed(3)}" title="${t("mig.cellTitle", { c: esc(c), r, n: v, s: fmtM(spend[k] || 0) })}">${v || "·"}</button></td>`;
    }
    html += `<td class="tot">${rowTotal}</td></tr>`;
  }
  html += `<tr><th class="rowh">${t("common.total")}</th>${PROGRAMS.map((r) => `<td class="tot">${s.filter((p) => p.recommended_program === r).length}</td>`).join("")}<td class="tot">${s.length}</td></tr></tbody></table>`;
  const moves = Object.entries(n).filter(([k]) => { const [a, b] = k.split("→"); return a !== b; }).sort((a, b) => b[1] - a[1]);
  if (moves.length) {
    const [k, v] = moves[0];
    const toPull = s.filter((p) => p.current_program === "MRP" && p.recommended_program !== "MRP").length;
    const toMrp = s.filter((p) => p.current_program !== "MRP" && p.recommended_program === "MRP").length;
    html += `<p class="hint mig-note">${t("mig.note", { c: state.result.summary.program_changes, n: s.length, k: esc(k.replace("→", " → ")), v, up: toPull, down: toMrp })}</p>`;
  }
  $("#migration").innerHTML = html;
}

/* ---------------- parts table ---------------- */
const COLS = [
  { key: "part_number" }, { key: "commodity" }, { key: "supplier" }, { key: "abc" }, { key: "xyz" }, { key: "trend" },
  { key: "current_program" }, { key: "recommended_program" }, { key: "reason" },
  { key: "annual_spend", n: true }, { key: "dos_current", n: true }, { key: "dos_target", n: true }, { key: "excess_value", n: true },
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

function partRow(p) {
  if (p.blocking) {
    return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
      <td class="pn">${esc(p.part_number)}</td><td>${esc(p.commodity)}</td><td>${esc(p.supplier)}</td>
      <td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>
      <td>${badge(p.current_program)}</td><td>${blockedBadge()}</td>
      <td class="reason">${esc(issuesText(p))}</td><td class="n muted">—</td><td class="n muted">—</td><td class="n muted">—</td><td class="n muted">—</td></tr>`;
  }
  const warn = p.issues.length ? ` <span class="tag" title="${esc(issuesText(p))}">!</span>` : "";
  return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
    <td class="pn">${esc(p.part_number)}${warn}</td><td>${esc(p.commodity)}</td><td>${esc(p.supplier)}</td>
    <td>${p.abc}${p.super_a ? `<span class="tag" title="Super A">SA</span>` : ""}</td><td>${p.xyz}</td>
    <td class="${p.trend === "Flat" ? "muted" : ""}">${tv("trend", p.trend)}</td>
    <td>${badge(p.current_program)}</td>
    <td>${badge(p.recommended_program)}${p.program_change ? "" : ` <span class="tag">${t("parts.keep")}</span>`}</td>
    <td class="reason">${esc(tx("reason.", p.reason))}</td>
    <td class="n">${fmtM(p.annual_spend)}</td>
    <td class="n">${fmtN(p.dos_current, 1)}</td>
    <td class="n">${fmtN(p.dos_target, 1)}</td>
    <td class="n ${p.excess_value ? "" : "muted"}">${p.excess_value ? fmtUSD(p.excess_value) : "0"}</td></tr>`;
}

function renderTable() {
  const thead = $("#partsTable thead"), tbody = $("#partsTable tbody");
  thead.innerHTML = `<tr>${COLS.map((c) => {
    const sorted = state.sort.key === c.key;
    return `<th tabindex="0" class="sortable ${c.n ? "n" : ""} ${sorted ? "sorted" : ""}" data-sort="${c.key}" data-dir="${state.sort.dir > 0 ? "↑" : "↓"}"
      aria-sort="${sorted ? (state.sort.dir > 0 ? "ascending" : "descending") : "none"}">${t(`col.${c.key}`)}</th>`;
  }).join("")}</tr>`;
  const list = sortParts(filteredParts());
  tbody.innerHTML = paged(list, "parts", partRow, COLS.length) || `<tr><td colspan="${COLS.length}" class="muted">${t("parts.none")}</td></tr>`;

  const a = list.filter((p) => p.analyzed);
  const sum = (k) => a.reduce((tt, p) => tt + p[k], 0);
  $("#partsFoot").textContent = t("parts.foot", { n: fmtN(list.length), total: fmtN(state.result.parts.length), s: fmtM(sum("annual_spend")), i0: fmtM(sum("inv_value_current")), i1: fmtM(sum("inv_value_target")), e: fmtM(sum("excess_value")) });
  renderChips();
}

function renderChips() {
  const f = state.filters, chips = [];
  if (f.cell) chips.push(["cell", t("parts.chipCell", { k: f.cell })]);
  if (f.mig) chips.push(["mig", t("parts.chipMig", { k: f.mig.replace("→", " → ") })]);
  $("#chips").innerHTML = chips.map(([k, l]) => `<button type="button" class="chip" data-chip="${k}">${esc(l)}</button>`).join("");
}

function buildFilterOptions() {
  const parts = state.rows;
  const uniq = (k) => [...new Set(parts.map((r) => String(r[k] ?? "").trim()).filter(Boolean))].sort();
  const opts = (el, all, values, label = (v) => v) => { el.innerHTML = `<option value="">${all}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(label(v))}</option>`).join(""); };
  opts($("#fCommodity"), t("filter.allCommodities"), uniq("commodity"));
  opts($("#fSupplier"), t("filter.allSuppliers"), uniq("supplier"));
  opts($("#fAbc"), t("filter.allClasses"), ["A", "B", "C"]);
  opts($("#fCurrent"), t("filter.anyCurrent"), [...new Set([...PROGRAMS, ...uniq("current_program")])]);
  opts($("#fRec"), t("filter.anyRec"), [...PROGRAMS, "Blocked"], (v) => (v === "Blocked" ? t("common.blocked") : v));
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
  const zero = `<span class="muted">0</span>`, dash = `<span class="muted">—</span>`;
  $("#supplierTable").innerHTML = `<thead><tr>
      <th>#</th><th>${t("col.supplier")}</th><th class="n">${t("sup.vmiParts")}</th><th class="n">${t("sup.vmiSpend")}</th><th class="n">${t("sup.crpParts")}</th><th class="n">${t("sup.crpSpend")}</th>
      <th class="n">${t("sup.vmiCrpSpend")}</th><th></th><th class="n">${t("sup.already")}</th><th class="n">${t("kpi.consign")}</th>
      <th class="n">${t("sup.parts")}</th><th class="n">${t("sup.totalSpend")}</th><th>${t("sup.mix")}</th></tr></thead><tbody>` +
    paged(rows, "suppliers", (g, i) => {
      const vc = g.vmiS + g.crpS;
      const mix = PROGRAMS.filter((p) => g.mix[p]).map((p) => `<span style="${pc(p)}; flex:${g.mix[p]}" title="${p} ${fmtM(g.mix[p])}"></span>`).join("");
      return `<tr class="clickable" tabindex="0" data-supplier="${esc(g.supplier)}">
        <td class="muted">${i + 1}</td><td class="pn">${esc(g.supplier)}</td>
        <td class="n">${g.vmiN || zero}</td><td class="n">${g.vmiS ? fmtM(g.vmiS) : dash}</td>
        <td class="n">${g.crpN || zero}</td><td class="n">${g.crpS ? fmtM(g.crpS) : dash}</td>
        <td class="n"><b>${fmtM(vc)}</b></td>
        <td><span class="bar" style="width:${Math.max(2, (vc / max) * 120)}px; ${pc(g.vmiS >= g.crpS ? "VMI" : "CRP")}"></span></td>
        <td class="n">${t("sup.alreadyOf", { a: g.already, n: g.vmiN + g.crpN })}</td>
        <td class="n">${g.consign ? fmtM(g.consign) : dash}</td>
        <td class="n">${g.n}</td><td class="n">${fmtM(g.spend)}</td>
        <td><div class="stackbar">${mix}</div></td></tr>`;
    }, 13) + "</tbody>";
}

/* ---------------- data integrity ---------------- */
function issueDetail(p, msg) {
  if (msg.startsWith("Missing lead time")) return t("integ.dLt");
  if (msg.startsWith("Zero/blank cost")) return t("integ.dCost", { v: Number.isFinite(p.unit_cost_usd) ? p.unit_cost_usd : t("integ.blank") });
  if (msg.startsWith("No demand")) return t("integ.dDemand");
  if (msg.startsWith("Duplicate")) return t("integ.dDup", { pn: p.part_number });
  if (msg.startsWith("MOQ")) return t("integ.dMoq", { moq: fmtN(p.moq), w: fmtN(p.moq / p.avg_weekly, 1), a: fmtN(p.avg_weekly) });
  return "";
}
const BLOCKING_ISSUES = ["Missing lead time", "Zero/blank cost", "No demand"];
function renderIntegrity() {
  const list = state.result.parts.filter((p) => p.issues.length);
  $("#integrityTable").innerHTML = `<thead><tr><th>${t("col.part_number")}</th><th>${t("col.description")}</th><th>${t("col.supplier")}</th><th>${t("integ.severity")}</th><th>${t("integ.issue")}</th><th>${t("integ.detail")}</th><th>${t("integ.effect")}</th></tr></thead><tbody>` +
    (paged(list, "integrity", (p) => p.issues.map((m, i) => {
      const blocking = BLOCKING_ISSUES.some((k) => m.startsWith(k));
      return `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}">
        <td class="pn">${i ? "" : esc(p.part_number)}</td><td>${i ? "" : esc(p.description)}</td><td>${i ? "" : esc(p.supplier)}</td>
        <td class="${blocking ? "issue-block" : "issue-warn"}">${blocking ? t("integ.blocking") : t("integ.warning")}</td>
        <td>${esc(tx("issue.", m))}</td><td class="muted">${esc(issueDetail(p, m))}</td>
        <td class="muted">${blocking ? t("integ.eBlock") : m.startsWith("MOQ") ? t("integ.eMoq") : t("integ.eDup")}</td></tr>`;
    }).join(""), 7) || `<tr><td colspan="7" class="muted">${t("integ.none")}</td></tr>`) + "</tbody>";
}

/* ---------------- freshness claims (docs/specs/V2_SPEC.md section 2) ---------------- */
const CLAIM_STATUSES = ["Open", "Escalated", "Closed"];
const parseCsvText = (text) => Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });

async function loadV2() {
  const get = async (f) => { const r = await fetch(`data/${f}`); if (!r.ok) throw new Error(r.status); return r.text(); };
  const events = get("supply_events.csv").catch(() => null);
  try {
    const [lots, sup, fc] = await Promise.all([get("inventory_lots.csv"), get("suppliers.csv"), get("forecast.csv")]);
    await papaReady;
    state.forecast = parseCsvText(fc).data; state.forecastLabel = "forecast.csv";
    state.lots = parseCsvText(lots).data; state.lotsLabel = "inventory_lots.csv";
    state.suppliersV2 = parseCsvText(sup).data; state.suppliersLabel = "suppliers.csv";
  } catch { /* freshness tab explains how to upload */ }
  try {
    const text = await events;
    if (text != null) { await papaReady; state.events = parseCsvText(text).data; state.eventsLabel = "supply_events.csv"; }
  } catch { /* exceptions tab explains how to upload */ }
  if (state.result) recompute();
}

const V2_NEED = {
  lots: ["lot_id", "part_number", "supplier", "qty", "date_code", "received_date"],
  forecast: ["part_number", "f01", "open_po_qty", "open_po_due_week"],
  events: ["event_id", "event_type", "part_number", "announced_date", "effective_date", "value"],
  suppliers: ["supplier", "freshness_rule_months"],
};
function loadV2Text(kind, text, label) {
  const { data, meta } = parseCsvText(text);
  const missing = V2_NEED[kind].filter((c) => !(meta.fields || []).includes(c));
  if (missing.length) { showNotice(t("notice.missingCols", { file: esc(label), n: missing.length, cols: esc(missing.join(", ")) }) + "."); return; }
  if (!data.length) { showNotice(t("notice.noRows", { file: esc(label) })); return; }
  showNotice(t("notice.loadedV2", { file: esc(label), n: fmtN(data.length), what: t(`notice.kind.${kind}`, { n: data.length }) }) + " " + t("notice.staysHere"), "ok");
  if (kind === "events") { state.events = data; state.eventsLabel = label; state.excStatus.clear(); }
  else if (kind === "forecast") { state.forecast = data; state.forecastLabel = label; }
  else if (kind === "lots") { state.lots = data; state.lotsLabel = label; state.claimStatus.clear(); }
  else { state.suppliersV2 = data; state.suppliersLabel = label; }
  rowLimits.clear();
  recompute();
}

const claimStatus = (c) => state.claimStatus.get(c.lot_id) || c.status;

function renderFreshness() {
  const F = state.fresh, P = state.policy, el = $("#tab-freshness");
  const byStatus = Object.fromEntries(CLAIM_STATUSES.map((k) => [k, F.claimable.filter((c) => claimStatus(c) === k)]));
  const sv = (a) => a.reduce((tt, c) => tt + (Number.isFinite(c.value) ? c.value : 0), 0);
  const money = (v) => (Number.isFinite(v) ? fmtUSD(v) : `<span class="muted" title="${t("common.noCost")}">—</span>`);
  const mo = (v) => fmtN(v, 1);
  const none = t("fresh.noneLoaded");
  const uploads = `<div class="fresh-src">
      <span class="muted">${t("fresh.src", { lots: esc(state.lotsLabel || none), sup: esc(state.suppliersLabel || none), d: ANALYSIS_DATE })}</span>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="lots" hidden>${t("fresh.uploadLots")}</label>
      <label class="btn"><input type="file" accept=".csv,text/csv" data-v2="suppliers" hidden>${t("fresh.uploadSup")}</label>
      <button class="btn" type="button" data-fresh="export" ${F.claimable.length ? "" : "disabled"}>${t("fresh.export")}</button>
    </div>`;
  if (!F.lots) { el.innerHTML = `${uploads}<p class="hint">${t("fresh.empty")}</p>`; return; }
  const claimRow = (c) => {
    const st = claimStatus(c), open = state.openClaim === c.lot_id;
    return `<tr class="${st === "Closed" ? "closed" : ""}">
      <td><select data-status="${esc(c.lot_id)}" aria-label="${t("fresh.statusAria", { lot: esc(c.lot_id) })}">${CLAIM_STATUSES.map((k) => `<option value="${k}"${k === st ? " selected" : ""}>${tv("claimSt", k)}</option>`).join("")}</select></td>
      <td class="nowrap">${esc(c.lot_id)}</td><td class="pn clickable" tabindex="0" data-part="${esc(c.part_number)}">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td>
      <td class="n">${esc(c.date_code)}</td><td class="n">${c.mfg_date}</td><td class="n">${esc(c.received_date)}</td>
      <td class="n"><b>${mo(c.age_receipt)}</b></td><td class="n">${c.rule}${c.rule_source === "default" ? "*" : ""}</td><td class="n">+${mo(c.age_receipt - c.rule)}</td>
      <td class="n">${fmtN(c.qty)}</td><td class="n">${money(c.value)}</td>
      <td><button type="button" class="btn btn-ghost" data-claim="${esc(c.lot_id)}" aria-expanded="${open}">${open ? t("fresh.hide") : t("fresh.claimText")}</button></td></tr>
      ${open ? `<tr class="claim-text-row"><td colspan="13"><p class="claim-text">${esc(claimTextFor(c))}</p>
        <button type="button" class="btn" data-copy="${esc(c.lot_id)}">${t("fresh.copy")}</button></td></tr>` : ""}`;
  };
  const th = (k, n) => `<th${n ? ' class="n"' : ""}>${t(k)}</th>`;
  el.innerHTML = `${uploads}
    <div class="kpis fresh-kpis">
      ${kpi(t("fresh.kLots"), fmtN(F.lots), t("fresh.kLotsSub", { n: fmtN(F.ok.length) }))}
      ${kpi(t("fresh.kClaims"), `${F.claimable.length} · ${fmtM(F.claimValue)}`, t("fresh.kClaimsSub", { o: byStatus.Open.length, e: byStatus.Escalated.length, c: byStatus.Closed.length }), "claim")}
      ${kpi(t("fresh.kAging"), `${F.aging.length} · ${fmtM(F.agingValue)}`, t("fresh.kAgingSub"), "aging")}
      ${kpi(t("fresh.kInvalid"), fmtN(F.invalid.length), F.invalid.length ? t("fresh.kInvalidSub") : t("fresh.kInvalidOk"))}
    </div>
    <h3>${t("fresh.hClaims")}</h3>
    <p class="hint">${t("fresh.claimsHint", { open: fmtM(sv(byStatus.Open) + sv(byStatus.Escalated)) })}${P.fresh_grace_months ? " " + t("fresh.grace", { n: P.fresh_grace_months }) : ""}${F.claimable.some((c) => c.rule_source === "default") ? " " + t("fresh.defaultRule", { n: P.fresh_default_rule_months }) : ""}</p>
    ${F.bySupplier.length ? `<p class="hint">${t("fresh.bySupplier")} ${F.bySupplier.map((g) => `${esc(g.supplier)} ${g.n} (${fmtM(g.value)})`).join(" · ")}</p>` : ""}
    <div class="table-wrap"><table class="grid"><thead><tr>${th("col.status")}${th("fresh.lot")}${th("col.part_number")}${th("col.supplier")}${th("fresh.dateCode", 1)}${th("fresh.mfg", 1)}${th("fresh.received", 1)}${th("fresh.ageRec", 1)}${th("fresh.rule", 1)}${th("fresh.over", 1)}${th("common.qty", 1)}${th("common.value", 1)}<th></th></tr></thead>
      <tbody>${paged(F.claimable, "claims", claimRow, 13) || `<tr><td colspan="13" class="muted">${t("fresh.noClaims")}</td></tr>`}</tbody></table></div>
    <h3>${t("fresh.hAging")}</h3>
    <p class="hint">${t("fresh.agingHint")}</p>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("fresh.lot")}${th("col.part_number")}${th("col.supplier")}${th("fresh.dateCode", 1)}${th("fresh.received", 1)}${th("fresh.ageRec", 1)}${th("fresh.ageToday", 1)}${th("fresh.rule", 1)}${th("fresh.expired", 1)}${th("common.qty", 1)}${th("common.value", 1)}</tr></thead><tbody>
      ${paged(F.aging, "aging", (c) => `<tr class="clickable" tabindex="0" data-part="${esc(c.part_number)}"><td class="nowrap">${esc(c.lot_id)}</td><td class="pn">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td>
        <td class="n">${esc(c.date_code)}</td><td class="n">${esc(c.received_date)}</td><td class="n">${mo(c.age_receipt)}</td><td class="n"><b>${mo(c.age_today)}</b></td><td class="n">${c.rule}</td>
        <td class="n">${c.expires}</td><td class="n">${fmtN(c.qty)}</td><td class="n">${money(c.value)}</td></tr>`, 11) || `<tr><td colspan="11" class="muted">${t("fresh.noAging")}</td></tr>`}
    </tbody></table></div>
    <h3>${t("fresh.hInvalid")}</h3>
    <div class="table-wrap"><table class="grid"><thead><tr>${th("fresh.lot")}${th("col.part_number")}${th("col.supplier")}${th("fresh.dateCode", 1)}${th("fresh.received", 1)}${th("fresh.problem")}</tr></thead><tbody>
      ${paged(F.invalid, "invalid", (c) => `<tr><td>${esc(c.lot_id)}</td><td class="pn">${esc(c.part_number)}</td><td>${esc(c.supplier)}</td><td class="n">${esc(c.date_code)}</td><td class="n">${esc(c.received_date)}</td><td class="issue-warn">${esc(c.errors.map((e) => tx("err.", e)).join("; "))}</td></tr>`, 6) || `<tr><td colspan="6" class="muted">${t("fresh.allValid")}</td></tr>`}
    </tbody></table></div>`;
}

function downloadCsv(name, fields, data) {
  const csv = Papa.unparse({ fields, data });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Exports keep English column names and values (they feed ERP/BI loads and supplier e-mails).
function exportClaims() {
  const F = state.fresh;
  if (F?.claimable.length) downloadCsv("freshness_claims.csv", CLAIM_COLUMNS, F.claimable.map((c) => claimRow(c, claimStatus(c))));
}

function bindFreshness() {
  const el = $("#tab-freshness");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-claim],[data-copy],[data-fresh]");
    if (!b) return;
    if (b.dataset.claim) { state.openClaim = state.openClaim === b.dataset.claim ? null : b.dataset.claim; renderFreshness(); }
    if (b.dataset.fresh === "export") exportClaims();
    if (b.dataset.copy) {
      const c = state.fresh.claimable.find((x) => x.lot_id === b.dataset.copy);
      navigator.clipboard?.writeText(claimTextFor(c)).then(() => { b.textContent = t("fresh.copied"); }, () => { b.textContent = t("fresh.selectToCopy"); });
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.status) { state.claimStatus.set(e.target.dataset.status, e.target.value); recompute(); }
    const kind = e.target.dataset.v2;
    if (kind && e.target.files) readUpload(e.target, (txt, name) => loadV2Text(kind, txt, name));
  });
}

/* ---------------- layers (v2) ---------------- */
function drawExecTop() {
  if (!state.result) return;
  $("#execTop").innerHTML = renderExecTop({ E: state.exec, V: state.value, pipe: state.pipe, score: state.score, S: state.result.summary, P: state.policy, X: state.exc, B: state.bridge });
}

function drawPlanner() {
  if (!state.result) return;
  const rows = plannerActions({ result: state.result, insights: state.insights, pipe: state.pipe, fresh: state.fresh });
  const el = $("#planner"), active = document.activeElement?.dataset?.pf, xactive = document.activeElement?.dataset?.xf;
  el.innerHTML = renderPlanner({ rows, pipe: state.pipe, insights: state.insights, fresh: state.fresh, result: state.result, filters: state.pfilters, tab: state.ptab, X: state.exc, xfilters: state.pxfilters, lib: XLIB });
  if (xactive) refocus(el, `[data-xf="${xactive}"]`);
  if (active) refocus(el, `[data-pf="${active}"]`);
}

function exportEscalations() {
  const rows = [...state.pipe.escalate, ...state.pipe.watch];
  if (rows.length) downloadCsv("pipeline_escalations.csv", ESCALATION_COLUMNS, rows.map(escalationRow));
}

function refocus(el, sel) { const f = el.querySelector(sel); f?.focus(); if (f?.type === "search") f.setSelectionRange(f.value.length, f.value.length); }

function renderExceptions() {
  const el = $("#tab-exceptions"), xactive = el.contains(document.activeElement) && document.activeElement.dataset.xf;
  el.innerHTML = renderExceptionsTab(state.exc, state.xfilters, XLIB, state.policy, state.eventsLabel);
  if (xactive) refocus(el, `[data-xf="${xactive}"]`);
}

function exportExceptions() {
  if (state.exc?.items.length) downloadCsv("exceptions_inbox.csv", EXCEPTION_COLUMNS, state.exc.items.map(exceptionRow));
}

// Shared by the Manager tab (#tab-exceptions) and the Planner layer (#planner).
function bindExceptions() {
  const setStatus = (id, patch) => { state.excStatus.set(id, { ...(state.excStatus.get(id) || {}), ...patch }); recompute(); };
  for (const [sel, key, redraw] of [["#tab-exceptions", "xfilters", () => renderExceptions()], ["#planner", "pxfilters", () => drawPlanner()]]) {
    const el = $(sel);
    el.addEventListener("input", (e) => { if (e.target.dataset.xf === "search") { state[key].search = e.target.value; redraw(); } });
    el.addEventListener("change", (e) => {
      const x = e.target;
      if (x.dataset.xf && x.dataset.xf !== "search") { state[key][x.dataset.xf] = x.value; state[key].all = false; redraw(); }
      if (x.dataset.xstatus) setStatus(x.dataset.xstatus, { status: x.value });
      if (x.dataset.xres) setStatus(x.dataset.xres, { resolution: x.value, ...(x.value && !state.excStatus.get(x.dataset.xres)?.status ? { status: "Resolved" } : {}) });
    });
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-xall]")) { state[key].all = true; redraw(); }
      const s = e.target.closest("[data-xsupplier]");
      if (s) { state[key] = { ...emptyXFilters(), supplier: s.dataset.xsupplier }; redraw(); }
      if (e.target.closest('[data-export="exceptions"]')) exportExceptions();
    });
  }
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
    const more = e.target.closest("[data-more]");
    if (more) {
      const k = more.dataset.more;
      rowLimits.set(k, more.hasAttribute("data-all") ? Infinity : (rowLimits.get(k) || PAGE) + PAGE);
      renderAll();
    }
    const lb = e.target.closest("[data-lang]");
    if (lb) setLang(lb.dataset.lang);
  });
  // Every secondary upload input (lots, suppliers, forecast, events) sits in one of these containers.
  for (const sel of ["#planner", "#tab-pipeline", "#tab-exceptions"]) {
    $(sel).addEventListener("change", (e) => {
      const kind = e.target.dataset.v2;
      if (kind && e.target.files) readUpload(e.target, (txt, name) => loadV2Text(kind, txt, name));
    });
  }
  const pl = $("#planner");
  pl.addEventListener("click", (e) => { const b = e.target.closest("[data-ptab]"); if (b) { state.ptab = b.dataset.ptab; drawPlanner(); } });
  const pf = (e) => { const k = e.target.dataset.pf; if (!k) return; state.pfilters[k] = e.target.value; drawPlanner(); };
  pl.addEventListener("input", (e) => { if (e.target.dataset.pf === "search") pf(e); });
  pl.addEventListener("change", (e) => { if (e.target.dataset.pf && e.target.dataset.pf !== "search") pf(e); });
  $("#scorecard").addEventListener("click", (e) => {
    const r = e.target.closest("[data-supplier]");
    if (r) filterSupplier(r.dataset.supplier);
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
  if (p.trend === "Ramp" || p.trend === "Declining") return t("drawer.ruleTrend", { trend: tv("trend", p.trend) });
  const k = p.abc + p.xyz;
  if (k === "AX") return `AX: LT ${p.lead_time_weeks} ${t("unit.wks")} ${p.lead_time_weeks >= P.vmi_lt_ax ? "≥" : "<"} ${P.vmi_lt_ax} → ${p.recommended_program}`;
  if (k === "AY") return `AY: LT ${p.lead_time_weeks} ${t("unit.wks")} ${p.lead_time_weeks >= P.vmi_lt_ay ? "≥" : "<"} ${P.vmi_lt_ay} → ${p.recommended_program}`;
  if (k === "BX") return t("drawer.ruleBX", { c: fmtCost(p.unit_cost_usd), op: p.unit_cost_usd < P.kanban_max_cost ? "<" : "≥", cap: fmtCost(P.kanban_max_cost), prog: p.recommended_program });
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
    ${stat(t("drawer.avg"), fmtN(p.avg_weekly))}${stat(t("drawer.sd"), fmtN(p.sd_weekly))}
    ${stat("CV", fmtN(p.cv, 3))}${stat(t("drawer.zeroWeeks"), `${zeroWeeks} / ${p.demand.length}`)}
    ${stat(t("drawer.unitCost"), fmtCost(p.unit_cost_usd))}${stat(t("drawer.lt"), Number.isFinite(p.lead_time_weeks) ? `${p.lead_time_weeks} ${t("unit.wks")}` : t("drawer.missing"))}
    ${stat("MOQ", fmtN(p.moq))}${stat(t("drawer.onHand"), fmtN(p.on_hand_qty))}</div>`;
  const demandH = `<h3>${t("drawer.demand")}</h3><div class="chartbox"><canvas id="dChart" role="img" aria-label="${t("drawer.demandAria", { pn: esc(p.part_number) })}"></canvas></div>`;
  const row = (a, b, c, cls = "", style = "") => `<tr${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}><td>${a}</td><td class="formula">${b}</td><td class="res">${c}</td></tr>`;

  let body = "";
  if (p.blocking) {
    body = `<div class="verdict">${blockedBadge().replace('class="badge blocked"', 'class="badge blocked big"')}<span>${esc(issuesText(p))}</span></div>
      ${demandH}<h3>${t("drawer.stats")}</h3>${stats}
      <p class="hint" style="margin-top:12px">${t("drawer.fixData")}</p>`;
  } else {
    const c = p.calc;
    const L_label = P.exposure[p.recommended_program] ? t("drawer.lExposure", { l: c.L }) : t("drawer.lPart", { l: c.L });
    const nT = Math.max(1, Math.min(Math.round(P.trend_weeks), p.demand.length));
    const ratio = p.trend_first ? p.trend_last / p.trend_first : NaN;
    const trendRow = p.zero_share <= P.zero_share_z
      ? row(t("col.trend"), t("drawer.trendCalc", { n: nT, last: fmtN(p.trend_last), first: fmtN(p.trend_first), r: Number.isFinite(ratio) ? fmtN(ratio, 2) + "×" : "n/a", up: P.trend_up, down: P.trend_down }), tv("trend", p.trend))
      : row(t("col.trend"), t("drawer.trendSkip", { z: fmtPct(p.zero_share), max: fmtPct(P.zero_share_z) }), tv("trend", p.trend));
    const formulaWins = !c.floorBinds;
    const progC = pc(p.recommended_program);
    const wk = (n) => (n === 1 ? t("unit.wk") : t("unit.wks"));

    body = `<div class="verdict">${badge(p.current_program)}<span class="muted">→</span><span class="big">${badge(p.recommended_program)}</span>
        <span>${esc(tx("reason.", p.reason))}</span>${p.program_change ? "" : `<span class="tag">${t("drawer.noChange")}</span>`}</div>
      ${demandH}<h3>${t("drawer.stats")}</h3>${stats}
      <h3>${t("drawer.why")}</h3>
      <table class="steps"><tbody>
        ${row(t("kpi.spend"), `${fmtN(p.avg_weekly)} ${t("unit.perWk")} × 52 × ${fmtCost(p.unit_cost_usd)}`, fmtUSD(p.annual_spend))}
        ${row("ABC", t("drawer.abcCalc", { r: p.spend_rank, n: state.result.analyzed.length, c: fmtPct(p.cum_before, 1), a: fmtPct(P.abc_a), b: fmtPct(P.abc_b) }) + (p.super_a ? `; Super A (&lt; ${fmtPct(P.super_a)})` : ""), `${p.abc}${p.super_a ? " · Super A" : ""}`)}
        ${row("XYZ", t("drawer.xyzCalc", { cv: fmtN(p.cv, 3), x: P.cv_x, y: P.cv_y, z: fmtPct(p.zero_share, 1), zmax: fmtPct(P.zero_share_z) }), p.xyz)}
        ${trendRow}
        ${row(t("drawer.rule"), esc(ruleText(p, P)), p.recommended_program, "win", progC)}
      </tbody></table>
      <h3>${t("drawer.target", { prog: p.recommended_program })}</h3>
      <table class="steps"><tbody>
        ${row(t("drawer.rl"), `R = ${c.R} ${wk(c.R)}, L = ${L_label}`, `R + L = ${c.R + c.L}`)}
        ${row(t("drawer.z"), t("drawer.zClass", { c: p.abc }), c.z)}
        ${row("Safety stock", `z × σ × √(R+L) = ${c.z} × ${fmtN(p.sd_weekly)} × √${c.R + c.L}`, fmtN(c.ss))}
        ${row(t("drawer.cycle"), `max(avg × R, MOQ) ÷ 2 = max(${fmtN(p.avg_weekly * c.R)}, ${fmtN(p.moq)}) ÷ 2`, fmtN(c.cycle))}
        ${row(t("drawer.ssCycle"), `${fmtN(c.ss)} + ${fmtN(c.cycle)}`, fmtN(c.ss + c.cycle), formulaWins ? "win" : "dim", progC)}
        ${row(t("drawer.floor"), t("drawer.floorCalc", { d: c.floorDays, r: fmtN(c.daily, 1) }), fmtN(c.floorQty), formulaWins ? "dim" : "win", progC)}
        ${row(`<b>${t("drawer.targetQ")}</b>`, formulaWins ? t("drawer.maxFormula") : t("drawer.maxFloor"), t("drawer.units", { n: fmtN(p.target_qty) }))}
        ${row(t("col.dos_target"), `${fmtN(p.target_qty)} ÷ ${fmtN(c.daily, 1)} ${t("unit.perDay")}`, t("drawer.days", { n: fmtN(p.dos_target, 1) }))}
      </tbody></table>
      <h3>${t("drawer.changes")}</h3>
      <table class="steps"><tbody>
        ${row(t("drawer.now"), t("drawer.nowCalc", { q: fmtN(p.on_hand_qty), d: fmtN(p.dos_current, 1) }), fmtUSD(p.inv_value_current, 2))}
        ${row(t("drawer.atTarget"), `${fmtN(p.target_qty)} × ${fmtCost(p.unit_cost_usd)}`, fmtUSD(p.inv_value_target, 2))}
        ${row(t("drawer.excess"), `max(0, ${fmtN(p.on_hand_qty)} − ${fmtN(p.target_qty)} × ${P.tolerance}) × ${fmtCost(p.unit_cost_usd)}`, fmtUSD(p.excess_value, 2))}
        ${p.recommended_program === "VMI" ? row(t("kpi.consign"), P.consignment
          ? t("drawer.consignCalc", { q: fmtN(p.target_qty), d: P.lineside_days, r: fmtN(c.daily, 1), c: fmtCost(p.unit_cost_usd) })
          : t("kpi.consignOff"), fmtUSD(p.consignment_transfer_value, 2)) : ""}
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
        { type: "bar", label: t("drawer.weekly"), data: p.demand, backgroundColor: v("--vmi"), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.9, order: 2 },
        { type: "line", label: t("drawer.avgLine", { n: fmtN(p.avg_weekly) }), data: p.demand.map(() => p.avg_weekly), borderColor: v("--ink"), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: v("--ink-2"), boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => (ctx.datasetIndex === 0 ? t("drawer.tipDemand", { n: fmtN(ctx.parsed.y) }) : t("drawer.tipAvg", { n: fmtN(p.avg_weekly) })) } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: v("--axis") }, ticks: { color: v("--muted"), font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 13 } },
        y: { beginAtZero: true, grid: { color: v("--grid") }, border: { display: false }, ticks: { color: v("--muted"), font: { size: 10 }, maxTicksLimit: 5, callback: (x) => fmtCompact(x) } },
      },
    },
  });
}

/* ---------------- policy panel ---------------- */
// Labels and hints: pol.<path> and pol.<path>.hint in the dictionaries; group titles: polg.<id>.
const pctF = { pct: true, step: 1, min: 0, max: 100 };
const POLICY_GROUPS = [
  { id: "abc", fields: [{ path: "abc_a", ...pctF }, { path: "abc_b", ...pctF }, { path: "super_a", ...pctF }] },
  { id: "xyz", fields: [{ path: "cv_x", step: 0.05, min: 0 }, { path: "cv_y", step: 0.05, min: 0 }, { path: "zero_share_z", ...pctF }] },
  { id: "trend", fields: [{ path: "trend_weeks", step: 1, min: 1, max: 13, int: true }, { path: "trend_up", step: 0.05, min: 0 }, { path: "trend_down", step: 0.05, min: 0 }] },
  { id: "rules", fields: [{ path: "vmi_lt_ax", hint: 1, step: 1, min: 0 }, { path: "vmi_lt_ay", hint: 1, step: 1, min: 0 }, { path: "kanban_max_cost", hint: 1, step: 0.1, min: 0 }] },
  { id: "z", fields: [{ path: "z.A", step: 0.05, min: 0 }, { path: "z.B", step: 0.05, min: 0 }, { path: "z.C", step: 0.05, min: 0 }] },
  { id: "excess", fields: [{ path: "tolerance", hint: 1, step: 0.05, min: 1 }, { path: "moq_weeks_flag", hint: 1, step: 1, min: 0 }, { path: "lineside_days", hint: 1, step: 1, min: 0 }] },
  { id: "director", fields: [
    { path: "carrying_rate", hint: 1, ...pctF }, { path: "eo_horizon_weeks", hint: 1, step: 1, min: 1, int: true }, { path: "eo_dos_days", hint: 1, step: 10, min: 0 },
    { path: "wave2_share", hint: 1, ...pctF }, { path: "wave_months", step: 1, min: 1, int: true },
  ] },
  { id: "fresh", fields: [{ path: "fresh_default_rule_months", hint: 1, step: 1, min: 1, int: true }, { path: "fresh_grace_months", hint: 1, step: 1, min: 0 }] },
  { id: "pipe", fields: [{ path: "fc_upside", step: 0.05, min: 0 }, { path: "fc_downside", step: 0.05, min: 0 }, { path: "fc_hist_weeks", hint: 1, step: 1, min: 1, max: 26, int: true }] },
  { id: "opps", fields: [
    { path: "hub_warn_months", hint: 1, step: 1, min: 0, int: true }, { path: "moq_opp_weeks", hint: 1, step: 1, min: 0 },
    { path: "lt_opp_min_weeks", hint: 1, step: 1, min: 0 }, { path: "lt_cut_weeks", hint: 1, step: 1, min: 1 },
  ] },
  { id: "exc", fields: [
    { path: "exc_now_weeks", hint: 1, step: 1, min: 0, int: true }, { path: "exc_big_value", hint: 1, step: 10000, min: 0 },
    { path: "exc_lt_jump_weeks", hint: 1, step: 1, min: 0 }, { path: "exc_price_pct", ...pctF }, { path: "exc_otd_min", hint: 1, step: 1, min: 0, max: 100 },
    { path: "exc_ltb_weeks", hint: 1, step: 1, min: 0, int: true }, { path: "exc_repeat", hint: 1, step: 1, min: 2, int: true },
    { path: "sla_critical_days", hint: 1, step: 1, min: 0, int: true }, { path: "sla_high_days", hint: 1, step: 1, min: 0, int: true },
    { path: "sla_medium_days", hint: 1, step: 1, min: 0, int: true }, { path: "sla_low_days", hint: 1, step: 1, min: 0, int: true },
  ] },
  { id: "sales", fields: [{ path: "destock_weeks", hint: 1, step: 1, min: 1, int: true }, { path: "sales_horizon_weeks", hint: 1, step: 1, min: 4, max: 52, int: true }] },
];
const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }
const display = (f, v) => (v === null ? "" : f.pct ? +(v * 100).toFixed(4) : v);

function buildPolicyForm() {
  const field = (f) => `<div class="field"><label for="pol-${f.path}">${t(`pol.${f.path}`)}${f.hint ? `<small>${t(`pol.${f.path}.hint`)}</small>` : ""}</label>
    <input id="pol-${f.path}" type="number" inputmode="decimal" data-path="${f.path}" ${f.pct ? "data-pct" : ""} ${f.int ? "data-int" : ""}
      step="${f.step}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""}></div>`;
  const group = (g, extra = "") => `<fieldset><legend>${t(`polg.${g.id}`)}</legend>${g.fields.map(field).join("")}${extra}</fieldset>`;
  let html = POLICY_GROUPS.slice(0, 5).map((g) => group(g)).join("");
  html += `<fieldset><legend>${t("polg.target")}</legend>
    <table class="ptable"><thead><tr><th>${t("pol.program")}</th><th>${t("pol.rWks")}</th><th>${t("pol.lWks")}</th><th>${t("pol.floorDays")}</th></tr></thead><tbody>
    ${PROGRAMS.map((p) => `<tr><td>${badge(p)}</td>
      <td><input type="number" step="1" min="0" data-path="review.${p}" aria-label="${t("pol.rAria", { p })}"></td>
      <td><input type="number" step="1" min="0" data-path="exposure.${p}" data-nullable ${p === "MRP" ? 'placeholder="LT"' : ""} aria-label="${t("pol.lAria", { p })}"></td>
      <td><input type="number" step="1" min="0" data-path="floor_days.${p}" aria-label="${t("pol.floorAria", { p })}"></td></tr>`).join("")}
    </tbody></table>
    <p class="hint" style="margin-top:6px">${t("pol.targetHint")}</p>
    </fieldset>`;
  html += group(POLICY_GROUPS[5], `<label class="toggle"><span>${t("pol.consignment")}<small class="hint" style="display:block">${t("pol.consignment.hint")}</small></span><input type="checkbox" id="pol-consignment" data-path="consignment"></label>`);
  html += POLICY_GROUPS.slice(6).map((g) => group(g)).join("");
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
  el.title = t("pol.changedTitle", { n });
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
  downloadCsv("pull_program_fit_results.csv", cols, data.map((r) => cols.map((c) => r[c])));
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
  downloadCsv("pull_program_template.csv", head, rows);
}

/* ---------------- events ---------------- */
const TABS = ["parts", "exceptions", "suppliers", "pipeline", "opps", "waves", "risk", "scenarios", "freshness", "integrity"];
function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".tab[data-tab]")) { const on = b.dataset.tab === tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
  for (const x of TABS) $(`#tab-${x}`).hidden = x !== tab;
  if (stale.has(tab) && state.view === "analysis") renderTab(tab);
}

function filterSupplier(sup) {
  state.filters = { ...emptyFilters(), supplier: sup };
  syncFilterInputs();
  if (state.view !== "analysis") setView("analysis");
  setTab("parts"); renderMatrix(); renderMigration(); renderTable();
}

function bind() {
  $("#upload").addEventListener("change", (e) => readUpload(e.target, loadText));
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
    if (r) filterSupplier(r.dataset.supplier);
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
  document.querySelector("#layerSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b && b.dataset.view !== state.view) setView(b.dataset.view); });
}

/* ---------------- language ---------------- */
function renderLangToggle() {
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
}
onLang(() => {
  applyStatic();
  renderLangToggle();
  renderSource();
  const keep = { ...state.filters };
  buildPolicyForm();
  if (state.rows.length) { buildFilterOptions(); state.filters = keep; syncFilterInputs(); }
  showNotice("");
  if (state.result) renderAll();
});

/* ---------------- director views ---------------- */
function policyRowsAll(policy = state.policy) {
  const rows = POLICY_GROUPS.flatMap((g) => g.fields).map((f) => ({ path: f.path, label: t(`pol.${f.path}`), pct: f.pct }));
  for (const p of PROGRAMS) {
    rows.push({ path: `review.${p}`, label: t("pol.rowR", { p }) });
    rows.push({ path: `exposure.${p}`, label: t("pol.rowL", { p }) });
    rows.push({ path: `floor_days.${p}`, label: t("pol.rowFloor", { p }) });
  }
  rows.push({ path: "consignment", label: t("pol.consignment") });
  const show = (r, v) => (v === null ? t("pol.partLt") : typeof v === "boolean" ? (v ? t("common.on") : t("common.off")) : r.pct ? fmtPct(v, 1).replace(/[.,]0%$/, "%") : String(v));
  return rows.map((r) => {
    const def = getPath(DEFAULT_POLICY, r.path), cur = getPath(policy, r.path);
    return { ...r, def: show(r, def), cur: show(r, cur), changed: JSON.stringify(def) !== JSON.stringify(cur) };
  });
}
const describeChanges = (policy) => policyRowsAll(policy).filter((r) => r.changed).map((r) => `${r.label}: ${r.def} → ${r.cur}`).join("; ");

function drawStory() {
  if (!state.result) return;
  renderStory($("#story"), state.result, state.policy, state.insights, {
    scenarios: state.scenarios.map((x) => ({ ...x, changes: describeChanges(x.policy) })),
    current: scenarioMetrics(state.result, state.insights),
    currentChanges: describeChanges(state.policy),
    openPart: (pn) => openDrawer(pn),
    filterSupplier,
  });
}

function drawSales() {
  if (!state.result) return;
  renderSales($("#sales"), state.result, state.policy, state.sales, { filterSupplier });
}

function renderWaves() {
  const W = state.insights.waves;
  const cards = W.map((w) => `<div class="wave">
      <div class="wave-head"><b>${t("wave.label", { n: w.wave })}</b><span class="muted">${esc(tx("vp.when.", w.when))}</span></div>
      <p class="hint">${t(`wave.what.${w.wave}`)}</p>
      <div class="wave-num">${fmtM(w.net)}<small> ${t("wave.net")}</small></div>
      <div class="wave-sub">${t("wave.sub1", { r: fmtM(w.released), b: fmtM(w.built), c: fmtM(w.cumulative) })}</div>
      <div class="wave-sub">${t("wave.sub2", { n: w.n, ch: w.changes, e: fmtM(w.excess) })}${w.consignment ? ` · ${t("wave.consign", { v: fmtM(w.consignment) })}` : ""}</div>
      ${w.suppliers.length ? `<div class="wave-sup">${w.suppliers.map((x) => `<span class="chip-static">${esc(x.supplier)} <span class="muted">${fmtM(x.spend)}</span></span>`).join("")}</div>` : ""}
    </div>`).join("");
  const rows = W.flatMap((w) => [...w.parts].sort((a, b) => (b.inv_value_current - b.inv_value_target) - (a.inv_value_current - a.inv_value_target)).map((p) => ({ w, p })));
  $("#tab-waves").innerHTML = `<p class="hint">${t("wave.hint")}</p>
    <div class="waves">${cards}</div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>${t("wave.col")}</th><th>${t("col.part_number")}</th><th>${t("col.supplier")}</th><th>${t("col.current_program")}</th><th>${t("col.recommended_program")}</th><th class="n">${t("wave.released")}</th><th class="n">${t("col.excess_value")}</th></tr></thead><tbody>
    ${paged(rows, "waves", ({ w, p }) => `<tr class="clickable" tabindex="0" data-part="${esc(p.part_number)}"><td>${t("wave.label", { n: w.wave })}</td><td class="pn">${esc(p.part_number)}</td><td>${esc(p.supplier)}</td>
      <td>${badge(p.current_program)}</td><td>${badge(p.recommended_program)}${p.program_change ? "" : ` <span class="tag">${t("parts.keep")}</span>`}</td>
      <td class="n">${fmtUSD(p.inv_value_current - p.inv_value_target)}</td><td class="n ${p.excess_value ? "" : "muted"}">${fmtUSD(p.excess_value)}</td></tr>`, 7)}</tbody></table></div>`;
}

function renderRisk() {
  const I = state.insights, P = state.policy;
  const tier = (x) => `<span class="${x === "Critical" ? "issue-block" : "issue-warn"}">${x === "Critical" ? t("risk.belowSafety") : t("risk.belowTarget")}</span>`;
  $("#tab-risk").innerHTML = `
    <h3>${t("risk.h")}</h3>
    <p class="hint">${t("risk.hint", { c: I.critical.length, cb: fmtM(I.criticalBuild), w: I.risk.length - I.critical.length, all: fmtM(I.riskBuild) })}</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>${t("col.status")}</th><th>${t("col.part_number")}</th><th>${t("col.supplier")}</th><th>${t("col.recommended_program")}</th><th class="n">${t("drawer.onHand")}</th><th class="n">Safety stock</th><th class="n">${t("risk.target")}</th><th class="n">${t("risk.cover")}</th><th class="n">${t("risk.build")}</th></tr></thead><tbody>
    ${paged(I.risk, "risk", (r) => `<tr class="clickable" tabindex="0" data-part="${esc(r.part.part_number)}"><td>${tier(r.tier)}</td><td class="pn">${esc(r.part.part_number)}</td><td>${esc(r.part.supplier)}</td>
      <td>${badge(r.part.recommended_program)}</td><td class="n">${fmtN(r.part.on_hand_qty)}</td><td class="n">${fmtN(r.safety)}</td><td class="n">${fmtN(r.part.target_qty)}</td>
      <td class="n">${fmtN(r.weeks_cover, 1)}</td><td class="n">${fmtUSD(r.build_value)}</td></tr>`, 9) || `<tr><td colspan="9" class="muted">${t("risk.none")}</td></tr>`}
    </tbody></table></div>
    <h3>${t("risk.eoH")}</h3>
    <p class="hint">${t("risk.eoHint", { h: P.eo_horizon_weeks, tw: P.trend_weeks, d: P.eo_dos_days, v: fmtM(I.eoValue), n: I.eo.length })}</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th>${t("col.part_number")}</th><th>${t("col.supplier")}</th><th>${t("risk.why")}</th><th class="n">${t("drawer.onHand")}</th><th class="n">${t("risk.runRate")}</th><th class="n">${t("risk.needed", { h: P.eo_horizon_weeks })}</th><th class="n">${t("risk.exposedQty")}</th><th class="n">${t("risk.exposure")}</th></tr></thead><tbody>
    ${paged(I.eo, "eo", (e) => `<tr class="clickable" tabindex="0" data-part="${esc(e.part.part_number)}"><td class="pn">${esc(e.part.part_number)}</td><td>${esc(e.part.supplier)}</td><td>${esc(tx("why.", e.why))}</td>
      <td class="n">${fmtN(e.part.on_hand_qty)}</td><td class="n">${fmtN(e.runRate)}</td><td class="n">${fmtN(e.covered)}</td><td class="n">${fmtN(e.excess_qty)}</td><td class="n">${fmtUSD(e.value)}</td></tr>`, 8) || `<tr><td colspan="8" class="muted">${t("risk.eoNone")}</td></tr>`}
    </tbody></table></div>`;
}

const scenarioLetter = (i) => t("scen.default", { l: String.fromCharCode(65 + i) });
function renderScenarios() {
  const cur = scenarioMetrics(state.result, state.insights);
  const all = [{ name: t("scen.current"), metrics: cur, policy: state.policy, current: true }, ...state.scenarios];
  const best = (r) => {
    if (!r.better || all.length < 2) return -1;
    const vals = all.map((x) => x.metrics[r.key]);
    const v = r.better === "low" ? Math.min(...vals) : Math.max(...vals);
    return vals.filter((x) => x === v).length === vals.length ? -1 : vals.indexOf(v);
  };
  $("#tab-scenarios").innerHTML = `
    <div class="scen-bar">
      <input type="text" id="scenName" placeholder="${scenarioLetter(state.scenarios.length)}" aria-label="${t("scen.nameAria")}" maxlength="40">
      <button type="button" class="btn btn-primary" data-scen="save">${t("scen.save")}</button>
      <span class="hint">${t("scen.hint")}</span>
    </div>
    <div class="table-wrap"><table class="grid scen"><thead><tr><th>${t("scen.metric")}</th>${all.map((x, i) => `<th class="n">${esc(x.name)}${x.current ? "" : `<div class="scen-actions"><button type="button" class="btn btn-ghost" data-scen="apply" data-i="${i - 1}">${t("scen.apply")}</button><button type="button" class="btn btn-ghost" data-scen="remove" data-i="${i - 1}">${t("scen.remove")}</button></div>`}</th>`).join("")}</tr></thead>
    <tbody>${SCENARIO_ROWS.map((r) => { const b = best(r); return `<tr><td>${t(`scenRow.${r.key}`)}</td>${all.map((x, i) => `<td class="n ${i === b ? "best" : ""}">${fmtMetric(x.metrics[r.key], r.fmt)}</td>`).join("")}</tr>`; }).join("")}
      <tr><td>${t("scen.changes")}</td>${all.map((x) => `<td class="muted small">${esc(describeChanges(x.policy) || t("scen.defaultPolicy"))}</td>`).join("")}</tr></tbody></table></div>
    ${state.scenarios.length ? "" : `<p class="hint" style="margin-top:8px">${t("scen.empty")}</p>`}`;
}

function saveScenario() {
  const name = ($("#scenName")?.value || "").trim() || scenarioLetter(state.scenarios.length);
  state.scenarios.push({ name, policy: clonePolicy(state.policy), metrics: scenarioMetrics(state.result, state.insights) });
  renderScenarios();
  if (state.view === "story") drawStory();
}

function storyKpis() {
  const S = state.result.summary, C = state.insights.carrying, P = state.policy;
  const d = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;
  return [
    { label: t("kpi.pullSpend"), value: `${fmtPct(S.pull_share_now)} → ${fmtPct(S.pull_share_rec)}`, sub: t("story.todayVsRec") },
    { label: t("story.inventory"), value: `${fmtM(S.inv_now)} → ${fmtM(S.inv_target)}`, sub: t("story.invSub", { d: `${d <= 0 ? "−" : "+"}${fmtPct(Math.abs(d))}` }) },
    { label: t("kpi.excess"), value: fmtM(S.excess), sub: t("story.excessSub", { tol: fmtN(P.tolerance, 2), net: fmtM(S.inv_now - S.inv_target) }), accent: "006300" },
    { label: t("kpi.carry"), value: `${fmtM(C.avoided)}${t("unit.perYr")}`, sub: t("deck.carrySub", { r: fmtPct(C.rate) }), accent: "006300" },
    { label: t("kpi.consign"), value: P.consignment ? fmtM(S.consignment) : t("common.off"), sub: t("deck.consignSub"), accent: "2A78D6" },
  ];
}

async function downloadDeck(btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t("story.building");
  try {
    const S = state.result.summary, C = state.insights.carrying;
    const changed = policyRowsAll().filter((r) => r.changed).length;
    await exportDeck({
      storyEl: $("#story"),
      rerender: drawStory,
      kpis: storyKpis(),
      policyRows: policyRowsAll(),
      meta: {
        subtitle: t("deck.subtitle", { a: fmtN(S.analyzed), n: fmtN(S.parts), s: fmtM(S.annual_spend), src: state.sourceLabel || t("deck.uploaded"), d: fmtDate(new Date()) }),
        policyNote: changed ? t("deck.policyChanged", { n: changed }) : t("deck.policyDefault"),
        summaryHeadline: t("deck.summary", { a: fmtPct(S.pull_share_now), b: fmtPct(S.pull_share_rec), i0: fmtM(S.inv_now), i1: fmtM(S.inv_target), c: fmtM(C.avoided) }),
        footer: state.sample ? t("footer.synthetic") : t("app.title"),
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
  const name = (canvas.closest(".story-card")?.dataset.eyebrow || id).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
    const tabs = [...document.querySelectorAll(".tab[data-tab]")];
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

applyStatic();
renderLangToggle();
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
// Chart.js loads async (index.html) so the first paint doesn't wait for it; the Manager view needs no chart
// to show. When it arrives, draw whatever chart is already on screen.
if (typeof Chart === "undefined") {
  document.querySelector('script[src*="chart.umd"]')?.addEventListener("load", () => {
    if (state.result && state.view !== "analysis") renderAll();
    if (state.openPart) renderDrawer(state.openPart);
  });
}

// Phone layout: tables with many columns read as stacked cards below 640px (css: table.grid.stacked).
// Each cell gets its column name as data-label; tables whose rows don't line up with the header keep scrolling.
function stackTables() {
  for (const tb of document.querySelectorAll("table.grid:not(.cov13):not(.guide-table):not(.bridge)")) {
    if (tb.closest("[hidden]")) continue;
    const heads = [...tb.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const rows = [...tb.querySelectorAll("tbody tr")];
    const fits = heads.length >= 4 && rows.every((r) => r.cells.length === heads.length || r.cells.length === 1);
    tb.classList.toggle("stacked", fits);
    if (fits) for (const r of rows) [...r.cells].forEach((c, i) => { if (r.cells.length > 1 && c.dataset.label !== heads[i]) c.dataset.label = heads[i] || ""; });
  }
}
let stackQueued = false;
new MutationObserver(() => { if (!stackQueued) { stackQueued = true; requestAnimationFrame(() => { stackQueued = false; stackTables(); }); } })
  .observe(document.body, { childList: true, subtree: true });
