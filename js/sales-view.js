// Supplier impact view: the same parts from the supplier's side. Charts only, one takeaway each,
// headlines computed from sellIn() so they follow the Policy panel live.
import { theme, legend, axisCat, axisVal, money, opts } from "./story.js?v=25";
import { esc, fmtM, fmtPct, fmtN, plain } from "./format.js?v=25";
import { t as tr } from "./i18n.js?v=25";

const charts = new Map();
const pct = fmtPct;
const wk = (v) => fmtN(v, 1);

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

export function destroySales() {
  for (const c of charts.values()) c.destroy();
  charts.clear();
}

// ctx: { filterSupplier(name) }
export function renderSales(container, result, P, X, ctx = {}) {
  const s = result.analyzed;
  if (!s.length) {
    destroySales();
    container.innerHTML = `<div class="card"><p class="hint">${tr("sv.empty")}</p></div>`;
    return;
  }
  const t = theme();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const T = X.totals, D = X.D, H = X.H;
  const firstD = Math.min(D, H);
  const recoverTxt = T.recover_week <= H ? tr("sv.week", { w: T.recover_week }) : tr("sv.afterWeek", { w: H });

  const down = X.suppliers.filter((g) => g.net < -0.5), up = X.suppliers.filter((g) => g.net > 0.5);
  const worst = down[0];
  const supChart = [...X.suppliers].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 8).sort((a, b) => a.net - b.net);
  const coverChart = [...X.suppliers].sort((a, b) => b.inv_now - a.inv_now).slice(0, 8);
  const mostCover = [...X.suppliers].filter((g) => g.through_week > 0).sort((a, b) => b.cover_now - a.cover_now)[0];
  const trendSup = X.suppliers.filter((g) => g.ramp + g.declining > 0).sort((a, b) => (b.ramp + b.declining) - (a.ramp + a.declining)).slice(0, 8);
  const topRamp = [...X.suppliers].sort((a, b) => b.ramp - a.ramp)[0];

  let n = 0;
  const hero = (label, value, sub, cls = "") => `<div class="hero ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const card = (eyebrow, headline, sub, id, { wide = false, body = "" } = {}) => `
    <article class="card story-card ${wide ? "wide" : ""}" data-eyebrow="${esc(eyebrow)}">
      <div class="story-card-head"><div class="eyebrow">${++n} · ${esc(eyebrow)}</div>
        ${id ? `<button type="button" class="btn btn-ghost png" data-png="${id}" title="${tr("st.pngTitle")}">PNG</button>` : ""}</div>
      <h2 class="headline">${headline}</h2>
      <p class="hint">${sub}</p>
      ${id ? `<div class="story-chart"><canvas id="${id}" role="img" aria-label="${esc(plain(headline))}"></canvas></div>` : ""}${body}
    </article>`;

  const less = T.dip_window_pct < 0;
  container.innerHTML = `
    <div class="story-toolbar">
      <p class="hint">${tr("sv.intro")}</p>
      <div class="story-actions"><button type="button" class="btn" data-act="present">${tr("st.present")}</button></div>
    </div>
    <div class="story-hero">
      ${hero(tr("sv.hThrough"), `${fmtM(T.through_week)}<span class="unit">${tr("unit.perWk")}</span>`, tr("sv.hThroughSub", { v: fmtM(T.through_annual) }))}
      ${hero(tr("sv.hStock"), `${wk(T.cover_now)}<span class="arrow">→</span><wbr>${wk(T.cover_target)}<span class="unit">${tr("unit.wks")}</span>`, tr("sv.hStockSub", { now: fmtM(T.inv_now), tgt: fmtM(T.inv_target) }))}
      ${hero(tr("sv.hSellIn", { n: firstD }), `${less ? "−" : "+"}${pct(Math.abs(T.dip_window_pct))}`, tr(less ? "sv.hSellInLess" : "sv.hSellInMore", { v: fmtM(Math.abs(T.dip_window)) }), "dip")}
      ${hero(tr("sv.hBack"), T.recover_week <= H ? tr("sv.weekCap", { w: T.recover_week }) : tr("sv.overWks", { w: H }), tr("sv.hBackSub"))}
      ${hero(tr("kpi.consign"), P.consignment ? fmtM(T.consignment) : tr("common.off"), tr("sv.hConsignSub"), "consign")}
    </div>
    <div class="story-grid">
      ${card(tr("sv.e1"),
        tr(less ? "sv.h1below" : "sv.h1above", { p: pct(Math.abs(T.dip_window_pct)), n: firstD, v: fmtM(T.dip) }),
        tr("sv.s1", { w: fmtM(T.through_week), r: recoverTxt, b: fmtM(T.build), n: D }),
        "slFlow", { wide: true })}
      ${worst ? card(tr("sv.e2"),
        tr("sv.h2", { s: esc(worst.supplier), v: fmtM(-worst.net), h: H, p: pct(Math.abs(worst.change)) }),
        tr("sv.s2", { n: down.length, total: X.suppliers.length, h: H, up: tr("sv.nSuppliers", { n: up.length }) }),
        "slSup") : ""}
      ${card(tr("sv.e3"),
        tr("sv.h3", { now: wk(T.cover_now), tgt: wk(T.cover_target) }),
        mostCover ? tr("sv.s3", { s: esc(mostCover.supplier), w: wk(mostCover.cover_now) }) : "",
        "slCover")}
      ${trendSup.length ? card(tr("sv.e4"),
        tr("sv.h4", { r: fmtM(T.ramp), d: fmtM(T.declining) }),
        `${topRamp?.ramp > 0 ? tr("sv.s4top", { s: esc(topRamp.supplier) }) + " " : ""}${tr("sv.s4")}`,
        "slTrend", { wide: true }) : ""}
    </div>`;

  const pick = (list) => (i) => ctx.filterSupplier?.(list[i].supplier);

  // 1. Weekly flow: 26 weeks of actual consumption, then the projection.
  const hist = X.history, nh = hist.length;
  const labels = [...hist.map((_, i) => `W${String(i + 1).padStart(2, "0")}`), ...X.sellin.map((_, k) => `+${k + 1}`)];
  const pad = (a, before, after) => [...new Array(before).fill(null), ...a, ...new Array(after).fill(null)];
  draw("slFlow", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar", label: tr("sv.cSellIn"), data: pad(X.sellin, nh, 0), backgroundColor: accent, borderRadius: 3, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.9, order: 2 },
        { type: "line", label: tr("sv.cThrough"), data: [...hist, ...X.through], borderColor: t.ink2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, order: 1,
          segment: { borderDash: (c) => (c.p0DataIndex >= nh - 1 ? [5, 4] : undefined) } },
      ],
    },
    options: opts({
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legend(t),
        tooltip: { callbacks: { title: (i) => (i[0].dataIndex < nh ? tr("sv.tActual", { w: i[0].label.slice(1) }) : tr("sv.tProj", { w: i[0].label })), label: (i) => (i.parsed.y == null ? null : `${i.dataset.label}: ${fmtM(i.parsed.y)}`) } },
      },
      scales: {
        x: axisCat(t, { ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, title: { display: true, text: tr("sv.cAxis"), color: t.muted, font: { size: 11 } } }),
        y: axisVal(t, { beginAtZero: true, ticks: money(t) }),
      },
    }),
  });

  // 2. Net change in sell-in by supplier over the horizon.
  if (worst) draw("slSup", {
    type: "bar",
    data: {
      labels: supChart.map((g) => g.supplier),
      datasets: [{ label: tr("sv.cNet", { n: H }), data: supChart.map((g) => g.net),
        backgroundColor: supChart.map((g) => (g.net < 0 ? accent : t.muted)), borderRadius: 4, borderSkipped: false, barPercentage: 0.7 }],
    },
    options: opts({
      indexAxis: "y",
      layout: { padding: { right: 8 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => tr("sv.tNet", { v: fmtM(i.parsed.x), p: pct(supChart[i.dataIndex].change, 1) }) } } },
      scales: { x: axisVal(t, { ticks: money(t) }), y: axisCat(t) },
    }),
  }, pick(supChart));

  // 3. Weeks of cover the plant holds, now vs target, by supplier.
  draw("slCover", {
    type: "bar",
    data: {
      labels: coverChart.map((g) => g.supplier),
      datasets: [
        { label: tr("sv.cCoverNow"), data: coverChart.map((g) => g.cover_now), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: tr("st.cAtTarget"), data: coverChart.map((g) => g.cover_target), backgroundColor: accent, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
      ],
    },
    options: opts({
      indexAxis: "y",
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${wk(i.parsed.x)} ${tr("unit.wks")}` } } },
      scales: { x: axisVal(t, { beginAtZero: true, title: { display: true, text: tr("sv.cWeeksThrough"), color: t.muted, font: { size: 11 } } }), y: axisCat(t) },
    }),
  }, pick(coverChart));

  // 4. Ramping vs declining annual sell-through by supplier.
  if (trendSup.length) draw("slTrend", {
    type: "bar",
    data: {
      labels: trendSup.map((g) => g.supplier),
      datasets: [
        { label: tr("sv.cRamping"), data: trendSup.map((g) => g.ramp), backgroundColor: accent, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: tr("sv.cDeclining"), data: trendSup.map((g) => g.declining), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
      ],
    },
    options: opts({
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.y)}${tr("unit.perYr")}` } } },
      scales: { x: axisCat(t, { ticks: { color: t.ink2, font: { size: 11 }, maxRotation: 0, autoSkip: false } }), y: axisVal(t, { beginAtZero: true, ticks: money(t) }) },
    }),
  }, pick(trendSup));
}
