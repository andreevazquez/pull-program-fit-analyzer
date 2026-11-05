// Sales view: the same parts from the supplier's side. Charts only, one takeaway each,
// headlines computed from sellIn() so they follow the Policy panel live.
import { theme, legend, axisCat, axisVal, money, opts } from "./story.js?v=14";
import { esc, fmtM, fmtPct, plain } from "./format.js?v=14";

const charts = new Map();
const pct = fmtPct;
const wk = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

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
    container.innerHTML = `<div class="card"><p class="hint">Load a CSV to see the sales view.</p></div>`;
    return;
  }
  const t = theme();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const T = X.totals, D = X.D, H = X.H;
  const firstD = Math.min(D, H);
  const recoverTxt = T.recover_week <= H ? `week ${T.recover_week}` : `after week ${H}`;

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
        ${id ? `<button type="button" class="btn btn-ghost png" data-png="${id}" title="Download this chart as PNG">PNG</button>` : ""}</div>
      <h2 class="headline">${headline}</h2>
      <p class="hint">${sub}</p>
      ${id ? `<div class="story-chart"><canvas id="${id}" role="img" aria-label="${esc(plain(headline))}"></canvas></div>` : ""}${body}
    </article>`;

  const mapping = `<div class="table-wrap story-table"><table class="grid sales-map">
      <thead><tr><th>In this plant</th><th>For a brand selling into retail or distribution</th></tr></thead>
      <tbody>
        <tr><td>Plant consumption</td><td>Sell-out at the shelf (POS)</td></tr>
        <tr><td>Stock the plant holds</td><td>Channel inventory at the retailer or distributor</td></tr>
        <tr><td>What suppliers ship</td><td>Sell-in</td></tr>
        <tr><td>Destock to target days of supply</td><td>Retailer cutting weeks of cover; quarter-end loading unwinding</td></tr>
        <tr><td>VMI / CRP with suppliers</td><td>VMI / CRP with key accounts, replenished from POS</td></tr>
        <tr><td>Consignment</td><td>Revenue recognized at sell-out instead of at shipment</td></tr>
      </tbody></table></div>
    <p class="hint sales-cta">Bring sell-in, sell-out and channel stock by account and SKU, and this view is measured instead of modeled: weeks of cover by account, where shipments ran ahead of the shelf, and how much sell-in is already sitting in the channel.
      <a href="https://www.linkedin.com/in/ricardovazquez88" target="_blank" rel="noopener noreferrer">Let's talk on LinkedIn<span class="sr-only"> (opens in a new tab)</span></a></p>`;

  container.innerHTML = `
    <div class="story-toolbar">
      <p class="hint">The same parts, seen by the suppliers' sales teams. The plant's consumption is their sell-through and its stock is their channel inventory. Follows Policy → Sales view.</p>
      <div class="story-actions"><button type="button" class="btn" data-act="present">Present</button></div>
    </div>
    <div class="story-hero">
      ${hero("Sell-through", `${fmtM(T.through_week)}<span class="unit">/wk</span>`, `${fmtM(T.through_annual)} a year of plant consumption`)}
      ${hero("Stock at the customer", `${wk(T.cover_now)}<span class="arrow">→</span>${wk(T.cover_target)}<span class="unit">wks</span>`, `${fmtM(T.inv_now)} → ${fmtM(T.inv_target)} at the recommended policy`)}
      ${hero(`Sell-in, next ${firstD} weeks`, `${T.dip_window_pct < 0 ? "−" : "+"}${pct(Math.abs(T.dip_window_pct))}`, `vs sell-through: ${fmtM(Math.abs(T.dip_window))} ${T.dip_window < 0 ? "less" : "more"} while the plant destocks`, "dip")}
      ${hero("Back to run-rate", T.recover_week <= H ? `Week ${T.recover_week}` : `> ${H} wks`, "sell-in within 1% of sell-through")}
      ${hero("Consignment", P.consignment ? fmtM(T.consignment) : "Off", "VMI stock suppliers would own; revenue moves to consumption", "consign")}
    </div>
    <div class="story-grid">
      ${card("Sell-in vs sell-through",
        `Sell-in runs ${pct(Math.abs(T.dip_window_pct))} ${T.dip_window_pct < 0 ? "below" : "above"} sell-through for ${firstD} weeks while the plant works off ${fmtM(T.dip)} of stock`,
        `Consumption does not change: ${fmtM(T.through_week)} a week. What changes is how much stock the plant keeps, so suppliers ship less until each part reaches target, and sell-in is back at run-rate by ${recoverTxt}. Parts below target pull ${fmtM(T.build)} forward. The last 26 weeks are actual consumption; shipment history is not in the file, so sell-in is projected (destock over ${plural(D, "week")} in Policy).`,
        "slFlow", { wide: true })}
      ${worst ? card("Which accounts feel it",
        `${esc(worst.supplier)} takes the largest hit: ${fmtM(-worst.net)} less sell-in over ${H} weeks (−${pct(Math.abs(worst.change))})`,
        `${plural(down.length, "supplier")} of ${X.suppliers.length} ship less over the next ${H} weeks; ${plural(up.length, "supplier")} ship more because the plant runs below target on their parts. Click a bar to see the parts behind it.`,
        "slSup") : ""}
      ${card("Sell-in already in the channel",
        `The plant holds ${wk(T.cover_now)} weeks of sell-through today; the policy targets ${wk(T.cover_target)}`,
        mostCover ? `${esc(mostCover.supplier)} sits deepest at ${wk(mostCover.cover_now)} weeks of cover. Stock above target is revenue suppliers already booked: it will not repeat as sell-in.` : "",
        "slCover")}
      ${trendSup.length ? card("Where demand is moving",
        `${fmtM(T.ramp)} of annual sell-through is ramping and ${fmtM(T.declining)} is declining`,
        `${topRamp?.ramp > 0 ? `${esc(topRamp.supplier)} has the most ramping volume. ` : ""}The analysis keeps these parts in MRP until demand settles; for a sales team they are the accounts to grow and the ones to protect.`,
        "slTrend", { wide: true }) : ""}
      ${card("Same logic, any channel",
        "Sell-in = sell-through ± the change in channel stock",
        "Nothing here is specific to electronics. Any business that sells through someone else's stock has the same three numbers, and the same gap between them.",
        "", { wide: true, body: mapping })}
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
        { type: "bar", label: "Projected sell-in (supplier shipments)", data: pad(X.sellin, nh, 0), backgroundColor: accent, borderRadius: 3, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.9, order: 2 },
        { type: "line", label: "Sell-through (plant consumption)", data: [...hist, ...X.through], borderColor: t.ink2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, order: 1,
          segment: { borderDash: (c) => (c.p0DataIndex >= nh - 1 ? [5, 4] : undefined) } },
      ],
    },
    options: opts({
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legend(t),
        tooltip: { callbacks: { title: (i) => (i[0].dataIndex < nh ? `Week ${i[0].label.slice(1)} (actual)` : `Week ${i[0].label} (projected)`), label: (i) => (i.parsed.y == null ? null : `${i.dataset.label}: ${fmtM(i.parsed.y)}`) } },
      },
      scales: {
        x: axisCat(t, { ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, title: { display: true, text: "Last 26 weeks actual · next weeks projected", color: t.muted, font: { size: 11 } } }),
        y: axisVal(t, { beginAtZero: true, ticks: money(t) }),
      },
    }),
  });

  // 2. Net change in sell-in by supplier over the horizon.
  if (worst) draw("slSup", {
    type: "bar",
    data: {
      labels: supChart.map((g) => g.supplier),
      datasets: [{ label: `Sell-in vs sell-through, next ${H} weeks`, data: supChart.map((g) => g.net),
        backgroundColor: supChart.map((g) => (g.net < 0 ? accent : t.muted)), borderRadius: 4, borderSkipped: false, barPercentage: 0.7 }],
    },
    options: opts({
      indexAxis: "y",
      layout: { padding: { right: 8 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${fmtM(i.parsed.x)} (${pct(supChart[i.dataIndex].change, 1)} of sell-through)` } } },
      scales: { x: axisVal(t, { ticks: money(t) }), y: axisCat(t) },
    }),
  }, pick(supChart));

  // 3. Weeks of cover the plant holds, now vs target, by supplier.
  draw("slCover", {
    type: "bar",
    data: {
      labels: coverChart.map((g) => g.supplier),
      datasets: [
        { label: "Weeks of cover now", data: coverChart.map((g) => g.cover_now), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: "At target", data: coverChart.map((g) => g.cover_target), backgroundColor: accent, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
      ],
    },
    options: opts({
      indexAxis: "y",
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${wk(i.parsed.x)} wks` } } },
      scales: { x: axisVal(t, { beginAtZero: true, title: { display: true, text: "Weeks of sell-through", color: t.muted, font: { size: 11 } } }), y: axisCat(t) },
    }),
  }, pick(coverChart));

  // 4. Ramping vs declining annual sell-through by supplier.
  if (trendSup.length) draw("slTrend", {
    type: "bar",
    data: {
      labels: trendSup.map((g) => g.supplier),
      datasets: [
        { label: "Ramping", data: trendSup.map((g) => g.ramp), backgroundColor: accent, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: "Declining", data: trendSup.map((g) => g.declining), backgroundColor: t.muted, borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.7 },
      ],
    },
    options: opts({
      plugins: { legend: legend(t), tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.y)} a year` } } },
      scales: { x: axisCat(t, { ticks: { color: t.ink2, font: { size: 11 }, maxRotation: 0, autoSkip: false } }), y: axisVal(t, { beginAtZero: true, ticks: money(t) }) },
    }),
  }, pick(trendSup));
}
