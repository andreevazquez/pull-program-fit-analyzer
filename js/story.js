// Story view: charts only, one takeaway per chart, for steering meetings.
// Every headline is computed from the current result, so it follows the Policy panel.
import { PROGRAMS } from "./segment.js?v=19";
import { SCENARIO_ROWS } from "./insights.js?v=19";
import { esc, fmtM, fmtPct, fmtN, plain } from "./format.js?v=19";
import { t as tr, tx } from "./i18n.js?v=19";

const charts = new Map();

const pct = fmtPct;
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };
export const fmtMetric = (v, f) => (f === "pct" ? pct(v) : f === "int" ? fmtN(v) : fmtM(v));

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
    container.innerHTML = `<div class="card"><p class="hint">${tr("st.empty")}</p></div>`;
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
        ${id ? `<button type="button" class="btn btn-ghost png" data-png="${id}" title="${tr("st.pngTitle")}">PNG</button>` : ""}</div>
      <h2 class="headline">${headline}</h2>
      <p class="hint">${sub}</p>
      ${id ? `<div class="story-chart"><canvas id="${id}" role="img" aria-label="${esc(plain(headline))}"></canvas></div>` : body}
    </article>`;

  const consignSub = P.consignment ? tr("st.consignOn", { v: fmtM(S.consignment) }) : tr("st.consignOff");

  const scen = ctx.scenarios || [];
  const dflt = tr("scen.defaultPolicy");
  const scenarioTable = scen.length ? `<div class="table-wrap story-table"><table class="grid">
      <thead><tr><th>${tr("scen.metric")}</th><th class="n">${tr("scen.current")}</th>${scen.map((x) => `<th class="n">${esc(x.name)}</th>`).join("")}</tr></thead>
      <tbody>${SCENARIO_ROWS.map((r) => `<tr><td>${tr(`scenRow.${r.key}`)}</td><td class="n"><b>${fmtMetric(ctx.current[r.key], r.fmt)}</b></td>${scen.map((x) => `<td class="n">${fmtMetric(x.metrics[r.key], r.fmt)}</td>`).join("")}</tr>`).join("")}
      <tr><td>${tr("scen.changes")}</td><td class="muted">${esc(ctx.currentChanges || dflt)}</td>${scen.map((x) => `<td class="muted">${esc(x.changes || dflt)}</td>`).join("")}</tr>
      </tbody></table></div>` : "";

  const wave1 = W[0];
  const totalNet = W[2].cumulative;
  const wave2Names = W[1].suppliers.map((x) => x.supplier);
  const tol = fmtN(P.tolerance, 2);
  const watchCount = { n: watchN };

  container.innerHTML = `
    <div class="story-toolbar">
      <p class="hint">${tr("st.live")}</p>
      <div class="story-actions">
        <button type="button" class="btn" data-act="present">${tr("st.present")}</button>
        <button type="button" class="btn btn-primary" data-act="deck">${tr("st.deck")}</button>
      </div>
    </div>
    <div class="story-hero">
      ${hero(tr("st.hPull"), `${pct(S.pull_share_now)}<span class="arrow">→</span>${pct(S.pull_share_rec)}`, tr("story.todayVsRec"))}
      ${hero(tr("story.inventory"), `${fmtM(S.inv_now)}<span class="arrow">→</span>${fmtM(S.inv_target)}`, tr("story.invSub", { d: `${sign(invDelta)}${pct(Math.abs(invDelta))}` }))}
      ${hero(tr("st.hExcess"), fmtM(S.excess), tr("story.excessSub", { tol, net: fmtM(S.inv_now - S.inv_target) }), "excess")}
      ${hero(tr("kpi.carry"), `${fmtM(C.avoided)}<span class="unit">${tr("unit.perYr")}</span>`, tr("st.hCarrySub", { r: pct(C.rate) }), "excess")}
      ${hero(tr("kpi.consign"), P.consignment ? fmtM(S.consignment) : tr("common.off"), tr("st.hConsignSub"), "consign")}
    </div>
    <div class="story-grid">
      ${card(tr("st.e1"),
        tr("st.h1", { n: nA, p: pct(nA / N), s: pct(shareA) }),
        tr("st.s1", { n: S.super_a, p: pct(shareSA) }),
        "stPareto")}
      ${card(tr("st.e2"),
        tr("st.h2", { now: pct(S.pull_share_now), rec: pct(S.pull_share_rec) }),
        tr("st.s2", { c: S.program_changes, n: N, from: fromMrp, to: toMrp }),
        "stMix")}
      ${card(tr("st.e3"),
        tr(invDelta <= 0 ? "st.h3down" : "st.h3up", { now: fmtM(S.inv_now), tgt: fmtM(S.inv_target), d: `${sign(invDelta)}${pct(Math.abs(invDelta))}` }),
        tr("st.s3", { over: fmtM(over), under: fmtM(under), net: fmtM(S.inv_now - S.inv_target), tol, e: fmtM(S.excess) }),
        "stBridge")}
      ${card(tr("st.e4"),
        tr("st.h4", { v: fmtM(C.avoided) }),
        tr("st.s4", { r: pct(C.rate), now: fmtM(C.now), tgt: fmtM(C.target), c: fmtM(C.consignShift) }),
        "stCarry")}
      ${card(tr("st.e5"),
        tr("st.h5", { p: esc(biggest.prog), now: fmtM(biggest.now), tgt: fmtM(biggest.target) }),
        tr("st.s5", { list: byProg.filter((g) => g.n).map((g) => `${g.prog} ${Math.round(g.dos)}`).join(", ") }),
        "stProg")}
      ${card(tr("st.e6"),
        ins.critical.length ? tr("st.h6", { n: ins.critical.length, v: fmtM(ins.criticalBuild) }) : tr("st.h6none"),
        tr("st.s6", { ...watchCount, v: fmtM(ins.riskBuild), o: fmtM(over) }),
        riskTop.length ? "stRisk" : "", { body: `<p class="hint">${tr("st.b6")}</p>` })}
      ${card(tr("st.e7"),
        ins.eo.length ? tr("st.h7", { v: fmtM(ins.eoValue), w: P.eo_horizon_weeks }) : tr("st.h7none", { w: P.eo_horizon_weeks }),
        tr("st.s7", { n: ins.eo.length, tw: P.trend_weeks, d: P.eo_dos_days }),
        eoTop.length ? "stEO" : "", { body: `<p class="hint">${tr("st.b7")}</p>` })}
      ${top ? card(tr("st.e8"),
        tr("st.h8", { s: esc(top.supplier), n: top.n, v: fmtM(top.VMI + top.CRP) }),
        `${tr("st.s8", { p: pct(top3Share) })} ${consignSub}`,
        "stSup", { wide: true }) : ""}
      ${card(tr("st.e9"),
        tr("st.h9", { w1: fmtM(wave1.net), all: fmtM(totalNet), m: 3 * P.wave_months }),
        tr("st.s9", { when: esc(tx("vp.when.", wave1.when)), n: wave1.n, what: tr("wave.what.1").toLowerCase(), sup: wave2Names.length ? esc(wave2Names.join(", ")) : tr("st.noSupplier"), k: W[2].suppliers.length }),
        "stWaves", { wide: true })}
      ${scen.length ? card(tr("st.e10"),
        tr("st.h10", { n: scen.length + 1 }),
        tr("st.s10"),
        "", { wide: true, body: scenarioTable }) : ""}
    </div>`;

  // ---- charts ----
  draw("stPareto", {
    type: "line",
    data: {
      labels: curve.map((_, i) => i + 1),
      datasets: [
        { label: tr("st.cCum"), data: curve, borderColor: t.prog("VMI"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
        { label: tr("st.cA", { p: pct(P.abc_a) }), data: curve.map(() => P.abc_a), borderColor: t.muted, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0 },
        { label: tr("st.cB", { p: pct(P.abc_b) }), data: curve.map(() => P.abc_b), borderColor: t.axis, borderWidth: 1, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0 },
      ],
    },
    options: opts({
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legend(t),
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { title: (i) => tr("st.cTop", { n: i[0].label }), label: (i) => tr("st.cOfSpend", { p: pct(i.parsed.y, 1) }) } },
      },
      scales: {
        x: axisCat(t, { title: { display: true, text: tr("st.cRanked"), color: t.muted, font: { size: 11 } }, ticks: { color: t.muted, maxTicksLimit: 8, maxRotation: 0 } }),
        y: axisVal(t, { min: 0, max: 1, ticks: { color: t.muted, callback: (v) => pct(v), maxTicksLimit: 6 } }),
      },
    }),
  });

  draw("stMix", {
    type: "bar",
    data: {
      labels: [tr("st.cToday"), tr("st.cRec")],
      datasets: PROGRAMS.map((prog, i) => ({
        label: prog, data: [mixNow[i], mixRec[i]], backgroundColor: t.prog(prog),
        borderColor: t.surface, borderWidth: { left: 0, right: 2, top: 0, bottom: 0 }, borderSkipped: false, maxBarThickness: 44, barPercentage: 0.7,
      })),
    },
    options: opts({
      indexAxis: "y",
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${tr("st.cOfSpend", { p: pct(i.parsed.x, 1) })}` } } },
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
      labels: [tr("st.bNow").split("|"), tr("st.bOver").split("|"), tr("st.bUnder").split("|"), [tr("st.bTarget"), ""]],
      datasets: [{
        label: tr("st.cInvValue"),
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
      labels: [tr("st.cToday"), tr("st.cAtTarget"), (P.consignment ? tr("st.cNetConsign") : tr("st.cNoConsign")).split("|")],
      datasets: [{ label: tr("st.cCarryYr"), data: carryVals, backgroundColor: [t.ink2, t.good, t.muted], borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 }],
    },
    plugins: [barLabels(carryVals.map((v) => `${fmtM(v)}${tr("unit.perYr")}`), t.ink)],
    options: opts({
      indexAxis: "y",
      layout: { padding: { right: 80 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${fmtM(i.parsed.x)}${tr("unit.perYr")}` } } },
      scales: { x: axisVal(t, { beginAtZero: true, ticks: money(t) }), y: axisCat(t, { ticks: { color: t.ink2, font: { size: 12 } } }) },
    }),
  });

  draw("stProg", {
    type: "bar",
    data: {
      labels: byProg.map((g) => `${g.prog} (${g.n})`),
      datasets: [
        { label: tr("st.cNow"), data: byProg.map((g) => g.now), backgroundColor: byProg.map((g) => `${t.prog(g.prog)}59`), borderColor: byProg.map((g) => t.prog(g.prog)), borderWidth: 1, borderRadius: 4, borderSkipped: "start" },
        { label: tr("st.bTarget"), data: byProg.map((g) => g.target), backgroundColor: byProg.map((g) => t.prog(g.prog)), borderRadius: 4, borderSkipped: "start" },
      ],
    },
    options: opts({
      plugins: {
        legend: { ...legend(t), labels: { ...legend(t).labels, generateLabels: () => [
          { text: tr("st.cNowLight"), fillStyle: `${t.muted}59`, strokeStyle: t.muted, lineWidth: 1, fontColor: t.ink2 },
          { text: tr("st.cTargetSolid"), fillStyle: t.muted, strokeStyle: t.muted, lineWidth: 0, fontColor: t.ink2 },
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
          label: tier === "Critical" ? tr("risk.belowSafety") : tr("risk.belowTarget"),
          data: riskTop.map((r) => (r.tier === tier ? r.build_value : null)),
          backgroundColor: tier === "Critical" ? t.crit : t.warn, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.8,
        })),
      },
      plugins: [barLabels(riskTop.map((r) => tr("st.cCover", { v: fmtM(r.build_value), w: fmtN(r.weeks_cover, 1) })), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 140 } },
        plugins: {
          legend: legend(t),
          tooltip: { callbacks: { label: (i) => { const r = riskTop[i.dataIndex]; return [tr("st.tBuild", { v: fmtM(r.build_value) }), tr("st.tOnHandSafety", { oh: fmtN(r.part.on_hand_qty), ss: fmtN(r.safety) }), tr("st.tRec", { p: r.part.recommended_program })]; } } },
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
        datasets: [{ label: tr("risk.exposure"), data: eoTop.map((e) => e.value), backgroundColor: t.ink2, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.7 }],
      },
      plugins: [barLabels(eoTop.map((e) => `${fmtM(e.value)} · ${tr(e.part.trend === "Declining" ? "st.declining" : "st.slow")}`), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 120 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (i) => { const e = eoTop[i.dataIndex]; return [tr("st.tExposure", { v: fmtM(e.value) }), tx("why.", e.why), tr("st.tNeeded", { oh: fmtN(e.part.on_hand_qty), c: fmtN(e.covered), w: P.eo_horizon_weeks })]; } } },
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
      plugins: [barLabels(topSup.map((g) => `${fmtM(g.VMI + g.CRP)} · ${tr("st.nParts", { n: g.n })}`), t.ink2)],
      options: opts({
        indexAxis: "y",
        layout: { padding: { right: 120 } },
        plugins: {
          legend: legend(t),
          tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.x)}`, afterBody: (items) => { const g = topSup[items[0].dataIndex]; return [tr("st.nParts", { n: g.n }), g.consign ? tr("st.tConsign", { v: fmtM(g.consign) }) : ""].filter(Boolean); } } },
        },
        scales: { x: axisVal(t, { stacked: true, beginAtZero: true, ticks: money(t) }), y: axisCat(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12 } } }) },
      }),
    }, (i) => ctx.filterSupplier?.(topSup[i].supplier));
  }

  draw("stWaves", {
    type: "bar",
    data: {
      labels: W.map((w, i) => [tr("wave.label", { n: i + 1 }), tx("vp.when.", w.when), tr("st.nParts", { n: w.n })]),
      datasets: [
        { label: tr("wave.released"), data: W.map((w) => w.released), backgroundColor: t.good, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 },
        { label: tr("risk.build"), data: W.map((w) => -w.built), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", maxBarThickness: 44, barPercentage: 0.6 },
      ],
    },
    plugins: [{
      id: "waveLabels",
      afterDatasetsDraw(chart) {
        const { ctx: c } = chart, meta = chart.getDatasetMeta(0);
        c.save();
        c.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif"; c.fillStyle = t.ink; c.textAlign = "center"; c.textBaseline = "bottom";
        meta.data.forEach((bar, i) => c.fillText(chart.width < 520 ? tr("st.wNet", { v: fmtM(W[i].net) }) : tr("st.wNetCum", { v: fmtM(W[i].net), c: fmtM(W[i].cumulative) }), bar.x, bar.y - 4));
        c.restore();
      },
    }],
    options: opts({
      layout: { padding: { top: 30 } },
      plugins: {
        legend: legend(t),
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(Math.abs(i.parsed.y))}`, afterBody: (items) => { const w = W[items[0].dataIndex]; return [tr(`wave.what.${items[0].dataIndex + 1}`), w.suppliers.length ? tr("st.tSuppliers", { list: w.suppliers.map((x) => x.supplier).join(", ") }) : ""].filter(Boolean); } } },
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

// Shared with the Supplier impact view (js/sales-view.js), so both read as one system.
export { theme, legend, axisCat, axisVal, money, opts, barLabels };
