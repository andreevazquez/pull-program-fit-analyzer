// Story view: charts only, one takeaway per chart, for steering meetings.
// Every headline is computed from the current result, so it follows the Policy panel.
import { PROGRAMS } from "./segment.js?v=7";
import { SCENARIO_ROWS } from "./insights.js?v=7";
import { esc, fmtM, fmtPct, plain } from "./format.js?v=7";

const charts = new Map();

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pct = fmtPct;
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };
export const fmtMetric = (v, f) => (f === "pct" ? pct(v) : f === "int" ? nf0.format(v) : fmtM(v));

function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"), grid: v("--grid"), axis: v("--axis"),
    surface: v("--surface"), good: v("--good"), crit: v("--crit"), warn: v("--warn-fill"), prog: (p) => v(PVAR[p] || "--mrp"),
  };
}

const legend = (t) => ({ position: "top", align: "start", labels: { color: t.ink2, boxWidth: 10, boxHeight: 10, font: { size: 12 } } });
const axisCat = (t, o = {}) => ({ grid: { display: false }, border: { color: t.axis }, ticks: { color: t.ink2, font: { size: 11 } }, ...o });
const axisVal = (t, o = {}) => ({ grid: { color: t.grid }, border: { display: false }, ticks: { color: t.muted, font: { size: 11 }, maxTicksLimit: 6 }, ...o });
const money = (t) => ({ color: t.muted, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => fmtM(v) });
const opts = (o) => ({ responsive: true, maintainAspectRatio: false, animation: false, ...o });

// Value labels drawn at the end of each bar (horizontal or vertical).
const barLabels = (texts, color) => ({
  id: "barLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart, horizontal = chart.options.indexAxis === "y";
    ctx.save();
    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = color;
    texts.forEach((text, i) => {
      if (!text) return;
      // the outermost visible bar for this category across datasets
      let bar = null;
      chart.data.datasets.forEach((_, d) => {
        const el = chart.getDatasetMeta(d).data[i];
        if (el && chart.data.datasets[d].data[i] != null) {
          if (!bar) bar = el;
          else if (horizontal ? el.x > bar.x : el.y < bar.y) bar = el;
        }
      });
      if (!bar) return;
      if (horizontal) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, Math.max(bar.x, bar.base) + 6, bar.y); }
      else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(text, bar.x, Math.min(bar.y, bar.base) - 4); }
    });
    ctx.restore();
  },
});

function draw(id, config, onPick) {
  charts.get(id)?.destroy();
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  if (onPick) {
    config.options.onClick = (_, els) => { if (els.length) onPick(els[0].index); };
    config.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  }
  charts.set(id, new Chart(el, config));
}

export function destroyStory() {
  for (const c of charts.values()) c.destroy();
  charts.clear();
}

// ctx: { scenarios, current, currentChanges, openPart(pn), filterSupplier(name) }
export function renderStory(container, result, P, ins, ctx = {}) {
  const S = result.summary, s = result.analyzed;
  if (!s.length) {
    destroyStory();
    container.innerHTML = `<div class="card"><p class="hint">Load a CSV to see the story.</p></div>`;
    return;
  }
  const t = theme();
  const N = s.length, total = S.annual_spend, C = ins.carrying;

  // Concentration
  const sorted = [...s].sort((a, b) => b.annual_spend - a.annual_spend);
  let cum = 0;
  const curve = sorted.map((p) => (cum += p.annual_spend) / total);
  const nA = s.filter((p) => p.abc === "A").length;
  const shareA = sum(s.filter((p) => p.abc === "A"), (p) => p.annual_spend) / total;
  const shareSA = sum(s.filter((p) => p.super_a), (p) => p.annual_spend) / total;

  // Program mix by spend
  const mix = (key) => PROGRAMS.map((prog) => sum(s.filter((p) => (PROGRAMS.includes(p[key]) ? p[key] : "MRP") === prog), (p) => p.annual_spend) / total);
  const mixNow = mix("current_program"), mixRec = mix("recommended_program");
  const toMrp = s.filter((p) => p.current_program !== "MRP" && p.recommended_program === "MRP").length;
  const fromMrp = s.filter((p) => p.current_program === "MRP" && p.recommended_program !== "MRP").length;

  // Inventory bridge
  const over = sum(s, (p) => Math.max(0, p.inv_value_current - p.inv_value_target));
  const under = sum(s, (p) => Math.max(0, p.inv_value_target - p.inv_value_current));
  const invDelta = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;
  const sign = (d) => (d <= 0 ? "−" : "+");

  // By recommended program
  const byProg = PROGRAMS.map((prog) => {
    const g = s.filter((p) => p.recommended_program === prog);
    return { prog, n: g.length, now: sum(g, (p) => p.inv_value_current), target: sum(g, (p) => p.inv_value_target), dos: median(g.map((p) => p.dos_target)) };
  });
  const biggest = [...byProg].sort((a, b) => (b.now - b.target) - (a.now - a.target))[0];

  // Suppliers to negotiate with
  const sup = new Map();
  for (const p of s) {
    if (p.recommended_program !== "VMI" && p.recommended_program !== "CRP") continue;
    const g = sup.get(p.supplier) || { supplier: p.supplier, n: 0, VMI: 0, CRP: 0, consign: 0 };
    g.n++; g[p.recommended_program] += p.annual_spend; g.consign += p.consignment_transfer_value;
    sup.set(p.supplier, g);
  }
  const suppliers = [...sup.values()].sort((a, b) => (b.VMI + b.CRP) - (a.VMI + a.CRP));
  const topSup = suppliers.slice(0, 6);
  const pullSpend = sum(suppliers, (g) => g.VMI + g.CRP);
  const top3Share = pullSpend ? sum(suppliers.slice(0, 3), (g) => g.VMI + g.CRP) / pullSpend : 0;
  const top = suppliers[0];

  // Risk, E&O, waves
  const riskTop = ins.risk.slice(0, 8), eoTop = ins.eo.slice(0, 8), W = ins.waves;
  const watchN = ins.risk.length - ins.critical.length;

  let n = 0;
  const hero = (label, value, sub, cls = "") => `<div class="hero ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const card = (eyebrow, headline, sub, id, { wide = false, body = "" } = {}) => `
    <article class="card story-card ${wide ? "wide" : ""}" data-eyebrow="${esc(eyebrow)}" ${id ? `data-chart="${id}"` : ""}>
      <div class="story-card-head"><div class="eyebrow">${++n} · ${esc(eyebrow)}</div>
        ${id ? `<button type="button" class="btn btn-ghost png" data-png="${id}" title="Download this chart as PNG">PNG</button>` : ""}</div>
      <h2 class="headline">${headline}</h2>
      <p class="hint">${sub}</p>
      ${id ? `<div class="story-chart"><canvas id="${id}" role="img" aria-label="${esc(plain(headline))}"></canvas></div>` : body}
    </article>`;

  const consignSub = P.consignment
    ? `If VMI runs on consignment, ${fmtM(S.consignment)} of stock moves to supplier ownership. That is a working-capital transfer, not a saving, so it is kept apart from excess.`
    : "Consignment is off in Policy, so no ownership transfer is assumed.";

  const scen = ctx.scenarios || [];
  const scenarioTable = scen.length ? `<div class="table-wrap story-table"><table class="grid">
      <thead><tr><th>Metric</th><th class="n">Current policy</th>${scen.map((x) => `<th class="n">${esc(x.name)}</th>`).join("")}</tr></thead>
      <tbody>${SCENARIO_ROWS.map((r) => `<tr><td>${r.label}</td><td class="n"><b>${fmtMetric(ctx.current[r.key], r.fmt)}</b></td>${scen.map((x) => `<td class="n">${fmtMetric(x.metrics[r.key], r.fmt)}</td>`).join("")}</tr>`).join("")}
      <tr><td>Policy changes vs. default</td><td class="muted">${esc(ctx.currentChanges || "Default policy")}</td>${scen.map((x) => `<td class="muted">${esc(x.changes || "Default policy")}</td>`).join("")}</tr>
      </tbody></table></div>` : "";

  const wave1 = W[0];
  const totalNet = W[2].cumulative;
  const wave2Names = W[1].suppliers.map((x) => x.supplier);

  container.innerHTML = `
    <div class="story-toolbar">
      <p class="hint">Live: every chart follows the current policy. Click a bar to drill into the parts behind it.</p>
      <div class="story-actions">
        <button type="button" class="btn" data-act="present">Present</button>
        <button type="button" class="btn btn-primary" data-act="deck">Download deck (.pptx)</button>
      </div>
    </div>
    <div class="story-hero">
      ${hero("Spend under pull programs", `${pct(S.pull_share_now)}<span class="arrow">→</span>${pct(S.pull_share_rec)}`, "today vs recommended")}
      ${hero("Inventory", `${fmtM(S.inv_now)}<span class="arrow">→</span>${fmtM(S.inv_target)}`, `${sign(invDelta)}${pct(Math.abs(invDelta))} at the recommended policy`)}
      ${hero("Excess to right-size", fmtM(S.excess), `one-time cash, above target × ${P.tolerance.toFixed(2)}`, "excess")}
      ${hero("Carrying cost avoided", `${fmtM(C.avoided)}<span class="unit">/yr</span>`, `P&L, at ${pct(C.rate)} carrying rate`, "excess")}
      ${hero("Consignment transfer", P.consignment ? fmtM(S.consignment) : "Off", "ownership moves to suppliers, not a saving", "consign")}
    </div>
    <div class="story-grid">
      ${card("Where the money is",
        `${nA} parts, ${pct(nA / N)} of the portfolio, carry ${pct(shareA)} of annual spend`,
        `${S.super_a} Super A parts alone carry ${pct(shareSA)}. That is where VMI and CRP pay back the effort; the long tail is better served by a two-bin Kanban.`,
        "stPareto")}
      ${card("How we buy today vs. recommended",
        `Pull programs cover ${pct(S.pull_share_now)} of spend today; the policy puts ${pct(S.pull_share_rec)} under pull`,
        `${S.program_changes} of ${N} parts change program: ${fromMrp} leave MRP for a pull program, and ${toMrp} go back to MRP because demand is ramping, declining or erratic.`,
        "stMix")}
      ${card("What it does to inventory",
        `Inventory ${invDelta <= 0 ? "falls" : "rises"} from ${fmtM(S.inv_now)} to ${fmtM(S.inv_target)} (${sign(invDelta)}${pct(Math.abs(invDelta))})`,
        `Overstocked parts give back ${fmtM(over)}; understocked parts need ${fmtM(under)} more. The actionable right-sizing, stock above target × ${P.tolerance.toFixed(2)}, is ${fmtM(S.excess)}.`,
        "stBridge")}
      ${card("What finance will see",
        `Reaching target avoids ${fmtM(C.avoided)} a year in carrying cost`,
        `At a ${pct(C.rate)} carrying rate, holding inventory costs ${fmtM(C.now)}/yr today and ${fmtM(C.target)}/yr at target. That recurring saving is the P&L number; the excess is one-time cash. Consignment would shift another ${fmtM(C.consignShift)}/yr of carrying cost to suppliers.`,
        "stCarry")}
      ${card("By recommended program",
        `${esc(biggest.prog)} parts drive the largest reduction: ${fmtM(biggest.now)} → ${fmtM(biggest.target)}`,
        `Median target days of supply: ${byProg.filter((g) => g.n).map((g) => `${g.prog} ${Math.round(g.dos)}`).join(", ")}.`,
        "stProg")}
      ${card("The other side of the ledger",
        ins.critical.length
          ? `${ins.critical.length} part${ins.critical.length === 1 ? "" : "s"} sit below safety stock today; building them up takes ${fmtM(ins.criticalBuild)}`
          : "No part sits below safety stock today",
        `Another ${watchN} part${watchN === 1 ? " is" : "s are"} below target but above safety stock. Bringing everything up to target takes ${fmtM(ins.riskBuild)}, part of the same plan that releases ${fmtM(over)} elsewhere.`,
        riskTop.length ? "stRisk" : "", { body: `<p class="hint">Nothing to build up.</p>` })}
      ${card("Excess & obsolescence exposure",
        ins.eo.length
          ? `${fmtM(ins.eoValue)} of stock on declining or slow parts exceeds the next ${P.eo_horizon_weeks} weeks of demand`
          : `No declining or slow part holds more than ${P.eo_horizon_weeks} weeks of demand`,
        `${ins.eo.length} part${ins.eo.length === 1 ? "" : "s"}, measured at their recent run-rate (last ${P.trend_weeks} weeks). Slow movers are parts with more than ${P.eo_dos_days} days on hand. This is the stock to sell back, return or reserve for before it becomes a write-off.`,
        eoTop.length ? "stEO" : "", { body: `<p class="hint">No exposure at the current thresholds.</p>` })}
      ${top ? card("Who to sit down with first",
        `Start with ${esc(top.supplier)}: ${top.n} parts, ${fmtM(top.VMI + top.CRP)} recommended for VMI or CRP`,
        `The top 3 suppliers hold ${pct(top3Share)} of the spend recommended for VMI or CRP. ${consignSub}`,
        "stSup", { wide: true }) : ""}
      ${card("Rollout in three waves",
        `Wave 1 frees ${fmtM(wave1.net)} without a single supplier negotiation; all three waves free ${fmtM(totalNet)} in ${3 * P.wave_months} months`,
        `Wave 1 (${wave1.when.toLowerCase()}), ${wave1.n} parts: ${wave1.what}. Wave 2: VMI/CRP with ${wave2Names.length ? esc(wave2Names.join(", ")) : "no supplier"}. Wave 3: the remaining ${W[2].suppliers.length} supplier${W[2].suppliers.length === 1 ? "" : "s"}.`,
        "stWaves", { wide: true })}
      ${scen.length ? card("Scenarios side by side",
        `${scen.length + 1} policies compared on the same data`,
        "Current policy against the scenarios saved this session. Excess and consignment stay separate; carrying cost is the recurring P&L effect.",
        "", { wide: true, body: scenarioTable }) : ""}
    </div>`;

  // ---- charts ----
  draw("stPareto", {
    type: "line",
    data: {
      labels: curve.map((_, i) => i + 1),
      datasets: [
        { label: "Cumulative share of spend", data: curve, borderColor: t.prog("VMI"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
        { label: `A cutoff ${pct(P.abc_a)}`, data: curve.map(() => P.abc_a), borderColor: t.muted, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0 },
        { label: `B cutoff ${pct(P.abc_b)}`, data: curve.map(() => P.abc_b), borderColor: t.axis, borderWidth: 1, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0 },
      ],
    },
    options: opts({
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legend(t),
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { title: (i) => `Top ${i[0].label} parts`, label: (i) => `${pct(i.parsed.y, 1)} of spend` } },
      },
      scales: {
        x: axisCat(t, { title: { display: true, text: "Parts ranked by annual spend", color: t.muted, font: { size: 11 } }, ticks: { color: t.muted, maxTicksLimit: 8, maxRotation: 0 } }),
        y: axisVal(t, { min: 0, max: 1, ticks: { color: t.muted, callback: (v) => pct(v), maxTicksLimit: 6 } }),
      },
    }),
  });

  draw("stMix", {
    type: "bar",
    data: {
      labels: ["Today", "Recommended"],
      datasets: PROGRAMS.map((prog, i) => ({
        label: prog, data: [mixNow[i], mixRec[i]], backgroundColor: t.prog(prog),
        borderColor: t.surface, borderWidth: { left: 0, right: 2, top: 0, bottom: 0 }, borderSkipped: false, maxBarThickness: 44, barPercentage: 0.7,
      })),
    },
    options: opts({
      indexAxis: "y",
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${pct(i.parsed.x, 1)} of spend` } } },
      scales: {
        x: axisVal(t, { stacked: true, min: 0, max: 1, ticks: { color: t.muted, callback: (v) => pct(v) } }),
        y: axisCat(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12, weight: "600" } } }),
      },
    }),
  });

  const afterOver = S.inv_now - over;
  draw("stBridge", {
    type: "bar",
    data: {
      labels: [["Inventory", "now"], ["Overstock", "given back"], ["Understock", "built"], ["Target", ""]],
      datasets: [{
        label: "Inventory value",
        data: [[0, S.inv_now], [afterOver, S.inv_now], [afterOver, afterOver + under], [0, S.inv_target]],
        backgroundColor: [t.ink2, t.good, t.muted, t.ink], borderRadius: 4, borderSkipped: false, maxBarThickness: 44, barPercentage: 0.6,
      }],
    },
    plugins: [barLabels([fmtM(S.inv_now), `−${fmtM(over)}`, `+${fmtM(under)}`, fmtM(S.inv_target)], t.ink)],
    options: opts({
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (i) => { const [a, b] = i.raw; const d = b - a; return i.dataIndex === 1 ? `−${fmtM(d)}` : i.dataIndex === 2 ? `+${fmtM(d)}` : fmtM(d); } } },
      },
      scales: { x: axisCat(t, { ticks: { color: t.ink2, font: { size: 11 }, maxRotation: 0, autoSkip: false } }), y: axisVal(t, { beginAtZero: true, ticks: money(t) }) },
    }),
  });

  const carryVals = [C.now, C.target, C.targetOwned];
  draw("stCarry", {
    type: "bar",
    data: {
      labels: ["Today", "At target", P.consignment ? ["At target, net", "of consignment"] : ["At target", "(no consignment)"]],
      datasets: [{ label: "Carrying cost per year", data: carryVals, backgroundColor: [t.ink2, t.good, t.muted], borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 }],
    },
    plugins: [barLabels(carryVals.map((v) => `${fmtM(v)}/yr`), t.ink)],
    options: opts({
      indexAxis: "y",
      layout: { padding: { right: 80 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${fmtM(i.parsed.x)} per year` } } },
      scales: { x: axisVal(t, { beginAtZero: true, ticks: money(t) }), y: axisCat(t, { ticks: { color: t.ink2, font: { size: 12 } } }) },
    }),
  });

  draw("stProg", {
    type: "bar",
    data: {
      labels: byProg.map((g) => `${g.prog} (${g.n})`),
      datasets: [
        { label: "Now", data: byProg.map((g) => g.now), backgroundColor: byProg.map((g) => `${t.prog(g.prog)}59`), borderColor: byProg.map((g) => t.prog(g.prog)), borderWidth: 1, borderRadius: 4, borderSkipped: "start" },
        { label: "Target", data: byProg.map((g) => g.target), backgroundColor: byProg.map((g) => t.prog(g.prog)), borderRadius: 4, borderSkipped: "start" },
      ],
    },
    options: opts({
      plugins: {
        legend: { ...legend(t), labels: { ...legend(t).labels, generateLabels: () => [
          { text: "Now (light)", fillStyle: `${t.muted}59`, strokeStyle: t.muted, lineWidth: 1, fontColor: t.ink2 },
          { text: "Target (solid)", fillStyle: t.muted, strokeStyle: t.muted, lineWidth: 0, fontColor: t.ink2 },
        ] } },
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.y)}` } },
      },
      scales: { x: axisCat(t, { ticks: { color: t.ink2, font: { size: 12 } } }), y: axisVal(t, { beginAtZero: true, ticks: money(t) }) },
    }),
  });

  if (riskTop.length) {
    draw("stRisk", {
      type: "bar",
      data: {
        labels: riskTop.map((r) => r.part.part_number),
        datasets: ["Critical", "Watch"].map((tier) => ({
          label: tier === "Critical" ? "Below safety stock" : "Below target",
          data: riskTop.map((r) => (r.tier === tier ? r.build_value : null)),
          backgroundColor: tier === "Critical" ? t.crit : t.warn, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.8,
        })),
      },
      plugins: [barLabels(riskTop.map((r) => `${fmtM(r.build_value)} · ${r.weeks_cover.toFixed(1)} wks cover`), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 140 } },
        plugins: {
          legend: legend(t),
          tooltip: { callbacks: { label: (i) => { const r = riskTop[i.dataIndex]; return [`Build-up ${fmtM(r.build_value)}`, `On hand ${nf0.format(r.part.on_hand_qty)} vs safety ${nf0.format(r.safety)}`, `Recommended ${r.part.recommended_program}`]; } } },
        },
        scales: { x: axisVal(t, { stacked: true, beginAtZero: true, ticks: money(t) }), y: axisCat(t, { stacked: true, ticks: { color: t.ink2, font: { size: 11 } } }) },
      }),
    }, (i) => ctx.openPart?.(riskTop[i].part.part_number));
  }

  if (eoTop.length) {
    draw("stEO", {
      type: "bar",
      data: {
        labels: eoTop.map((e) => e.part.part_number),
        datasets: [{ label: "Exposure", data: eoTop.map((e) => e.value), backgroundColor: t.ink2, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.7 }],
      },
      plugins: [barLabels(eoTop.map((e) => `${fmtM(e.value)} · ${e.part.trend === "Declining" ? "declining" : "slow"}`), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 120 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (i) => { const e = eoTop[i.dataIndex]; return [`Exposure ${fmtM(e.value)}`, e.why, `On hand ${nf0.format(e.part.on_hand_qty)} vs ${nf0.format(e.covered)} needed in ${P.eo_horizon_weeks} wks`]; } } },
        },
        scales: { x: axisVal(t, { beginAtZero: true, ticks: money(t) }), y: axisCat(t, { ticks: { color: t.ink2, font: { size: 11 } } }) },
      }),
    }, (i) => ctx.openPart?.(eoTop[i].part.part_number));
  }

  if (top) {
    draw("stSup", {
      type: "bar",
      data: {
        labels: topSup.map((g) => g.supplier),
        datasets: ["VMI", "CRP"].map((prog) => ({
          label: prog, data: topSup.map((g) => g[prog]), backgroundColor: t.prog(prog),
          borderColor: t.surface, borderWidth: { right: 2, left: 0, top: 0, bottom: 0 }, borderSkipped: false, maxBarThickness: 44, barPercentage: 0.7,
        })),
      },
      plugins: [barLabels(topSup.map((g) => `${fmtM(g.VMI + g.CRP)} · ${g.n} parts`), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 120 } },
        plugins: {
          legend: legend(t),
          tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.x)}`, afterBody: (items) => { const g = topSup[items[0].dataIndex]; return [`${g.n} parts`, g.consign ? `Consignment transfer ${fmtM(g.consign)}` : ""].filter(Boolean); } } },
        },
        scales: { x: axisVal(t, { stacked: true, beginAtZero: true, ticks: money(t) }), y: axisCat(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12 } } }) },
      }),
    }, (i) => ctx.filterSupplier?.(topSup[i].supplier));
  }

  draw("stWaves", {
    type: "bar",
    data: {
      labels: W.map((w) => [w.label, w.when, `${w.n} parts`]),
      datasets: [
        { label: "Inventory released", data: W.map((w) => w.released), backgroundColor: t.good, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 },
        { label: "Build-up", data: W.map((w) => -w.built), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 },
      ],
    },
    plugins: [{
      id: "waveLabels",
      afterDatasetsDraw(chart) {
        const { ctx: c } = chart, meta = chart.getDatasetMeta(0);
        c.save();
        c.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif"; c.fillStyle = t.ink; c.textAlign = "center"; c.textBaseline = "bottom";
        meta.data.forEach((bar, i) => c.fillText(chart.width < 520 ? `net ${fmtM(W[i].net)}` : `net ${fmtM(W[i].net)} · cumulative ${fmtM(W[i].cumulative)}`, bar.x, bar.y - 4));
        c.restore();
      },
    }],
    options: opts({
      layout: { padding: { top: 30 } },
      plugins: {
        legend: legend(t),
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(Math.abs(i.parsed.y))}`, afterBody: (items) => { const w = W[items[0].dataIndex]; return [w.what, w.suppliers.length ? `Suppliers: ${w.suppliers.map((x) => x.supplier).join(", ")}` : ""].filter(Boolean); } } },
      },
      scales: {
        x: axisCat(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12 }, maxRotation: 0, autoSkip: false } }),
        y: axisVal(t, { stacked: true, ticks: money(t) }),
      },
    }),
  });
}

// For export: each story card in order, with its chart canvas (if any).
export function storyCards(container) {
  return [...container.querySelectorAll(".story-card")].map((el) => ({
    eyebrow: el.dataset.eyebrow,
    headline: el.querySelector(".headline")?.textContent.trim() ?? "",
    sub: el.querySelector(".hint")?.textContent.trim() ?? "",
    canvas: el.dataset.chart ? document.getElementById(el.dataset.chart) : null,
    table: el.querySelector("table"),
  }));
}
