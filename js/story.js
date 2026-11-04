// Story view: charts only, one takeaway per chart, for steering meetings.
// Every headline is computed from the current result, so it follows the Policy panel.
import { PROGRAMS } from "./segment.js";

const charts = new Map();

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
function fmtM(v) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${nf0.format(a / 1e3)}k`;
  return `${sign}$${nf0.format(a)}`;
}
const pct = (v, d = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };

function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    v, ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"), grid: v("--grid"), axis: v("--axis"),
    surface: v("--surface"), good: v("--good"), prog: (p) => v(PVAR[p] || "--mrp"),
  };
}

function baseOptions(t, extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { position: "top", align: "start", labels: { color: t.ink2, boxWidth: 10, boxHeight: 10, font: { size: 12 } } },
      tooltip: {},
    },
    ...extra,
  };
}
const axisX = (t, o = {}) => ({ grid: { display: false }, border: { color: t.axis }, ticks: { color: t.muted, font: { size: 11 } }, ...o });
const axisY = (t, o = {}) => ({ grid: { color: t.grid }, border: { display: false }, ticks: { color: t.muted, font: { size: 11 }, maxTicksLimit: 6 }, ...o });

function draw(id, config) {
  charts.get(id)?.destroy();
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  charts.set(id, new Chart(el, config));
}

export function destroyStory() {
  for (const c of charts.values()) c.destroy();
  charts.clear();
}

export function renderStory(container, result, P) {
  const S = result.summary, s = result.analyzed;
  if (!s.length) {
    destroyStory();
    container.innerHTML = `<div class="card"><p class="hint">Load a CSV to see the story.</p></div>`;
    return;
  }
  const t = theme();
  const N = s.length, total = S.annual_spend;

  // 1. Concentration
  const sorted = [...s].sort((a, b) => b.annual_spend - a.annual_spend);
  let cum = 0;
  const curve = sorted.map((p) => (cum += p.annual_spend) / total);
  const nA = s.filter((p) => p.abc === "A").length;
  const shareA = sum(s.filter((p) => p.abc === "A"), (p) => p.annual_spend) / total;
  const shareSA = sum(s.filter((p) => p.super_a), (p) => p.annual_spend) / total;

  // 2. Program mix by spend
  const mix = (key) => PROGRAMS.map((prog) => sum(s.filter((p) => (PROGRAMS.includes(p[key]) ? p[key] : "MRP") === prog), (p) => p.annual_spend) / total);
  const mixNow = mix("current_program"), mixRec = mix("recommended_program");
  const toMrp = s.filter((p) => p.current_program !== "MRP" && p.recommended_program === "MRP").length;
  const fromMrp = s.filter((p) => p.current_program === "MRP" && p.recommended_program !== "MRP").length;

  // 3. Inventory bridge
  const over = sum(s, (p) => Math.max(0, p.inv_value_current - p.inv_value_target));
  const under = sum(s, (p) => Math.max(0, p.inv_value_target - p.inv_value_current));
  const invDelta = S.inv_now ? (S.inv_target - S.inv_now) / S.inv_now : 0;

  // 4. By recommended program
  const byProg = PROGRAMS.map((prog) => {
    const g = s.filter((p) => p.recommended_program === prog);
    return { prog, n: g.length, now: sum(g, (p) => p.inv_value_current), target: sum(g, (p) => p.inv_value_target), dos: median(g.map((p) => p.dos_target)) };
  });
  const biggest = [...byProg].sort((a, b) => (b.now - b.target) - (a.now - a.target))[0];

  // 5. Suppliers to negotiate with
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

  const hero = (label, value, sub, cls = "") => `<div class="hero ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const card = (n, eyebrow, headline, sub, id, wide = false) => `
    <article class="card story-card ${wide ? "wide" : ""}">
      <div class="eyebrow">${n} · ${eyebrow}</div>
      <h2 class="headline">${headline}</h2>
      <p class="hint">${sub}</p>
      <div class="story-chart"><canvas id="${id}" role="img" aria-label="${esc(eyebrow)}"></canvas></div>
    </article>`;

  const consignSub = P.consignment
    ? `If VMI runs on consignment, ${fmtM(S.consignment)} of stock moves to supplier ownership. That is a working-capital transfer, not a saving, so it is kept apart from excess.`
    : "Consignment is off in Policy, so no ownership transfer is assumed.";
  const top = suppliers[0];

  container.innerHTML = `
    <div class="story-hero">
      ${hero("Spend under pull programs", `${pct(S.pull_share_now)}<span class="arrow">→</span>${pct(S.pull_share_rec)}`, "today vs recommended")}
      ${hero("Inventory", `${fmtM(S.inv_now)}<span class="arrow">→</span>${fmtM(S.inv_target)}`, `${invDelta <= 0 ? "−" : "+"}${pct(Math.abs(invDelta))} at the recommended policy`)}
      ${hero("Excess to right-size", fmtM(S.excess), `on hand above target × ${P.tolerance.toFixed(2)}`, "excess")}
      ${hero("Consignment transfer", P.consignment ? fmtM(S.consignment) : "Off", "ownership moves to suppliers, not a saving", "consign")}
    </div>
    <div class="story-grid">
      ${card(1, "Where the money is",
        `${nA} parts, ${pct(nA / N)} of the portfolio, carry ${pct(shareA)} of annual spend`,
        `${S.super_a} Super A parts alone carry ${pct(shareSA)}. That is where VMI and CRP pay back the effort; the long tail is better served by a two-bin Kanban.`,
        "stPareto")}
      ${card(2, "How we buy today vs. recommended",
        `Pull programs cover ${pct(S.pull_share_now)} of spend today; the policy puts ${pct(S.pull_share_rec)} under pull`,
        `${S.program_changes} of ${N} parts change program: ${fromMrp} leave MRP for a pull program, and ${toMrp} go back to MRP because demand is ramping, declining or erratic.`,
        "stMix")}
      ${card(3, "What it does to inventory",
        `Inventory ${invDelta <= 0 ? "falls" : "rises"} from ${fmtM(S.inv_now)} to ${fmtM(S.inv_target)} (${invDelta <= 0 ? "−" : "+"}${pct(Math.abs(invDelta))})`,
        `Overstocked parts give back ${fmtM(over)}; understocked parts need ${fmtM(under)} more. The actionable right-sizing, stock above target × ${P.tolerance.toFixed(2)}, is ${fmtM(S.excess)}.`,
        "stBridge")}
      ${card(4, "By recommended program",
        `${esc(biggest.prog)} parts drive the largest reduction: ${fmtM(biggest.now)} → ${fmtM(biggest.target)}`,
        `Median target days of supply: ${byProg.filter((g) => g.n).map((g) => `${g.prog} ${Math.round(g.dos)}`).join(", ")}.`,
        "stProg")}
      ${top ? card(5, "Who to sit down with first",
        `Start with ${esc(top.supplier)}: ${top.n} parts, ${fmtM(top.VMI + top.CRP)} recommended for VMI or CRP`,
        `The top 3 suppliers hold ${pct(top3Share)} of the spend recommended for VMI or CRP. ${consignSub}`,
        "stSup", true) : ""}
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
    options: baseOptions(t, {
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: baseOptions(t).plugins.legend,
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { title: (i) => `Top ${i[0].label} parts`, label: (i) => `${pct(i.parsed.y, 1)} of spend` } },
      },
      scales: {
        x: axisX(t, { title: { display: true, text: "Parts ranked by annual spend", color: t.muted, font: { size: 11 } }, ticks: { color: t.muted, maxTicksLimit: 8, maxRotation: 0 } }),
        y: axisY(t, { min: 0, max: 1, ticks: { color: t.muted, callback: (v) => pct(v), maxTicksLimit: 6 } }),
      },
    }),
  });

  draw("stMix", {
    type: "bar",
    data: {
      labels: ["Today", "Recommended"],
      datasets: PROGRAMS.map((prog, i) => ({
        label: prog, data: [mixNow[i], mixRec[i]], backgroundColor: t.prog(prog),
        borderColor: t.surface, borderWidth: { left: 0, right: 2, top: 0, bottom: 0 }, borderSkipped: false, barPercentage: 0.7,
      })),
    },
    options: baseOptions(t, {
      indexAxis: "y",
      plugins: { legend: baseOptions(t).plugins.legend, tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${pct(i.parsed.x, 1)} of spend` } } },
      scales: {
        x: axisY(t, { stacked: true, min: 0, max: 1, ticks: { color: t.muted, callback: (v) => pct(v) } }),
        y: axisX(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12, weight: "600" } } }),
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
        backgroundColor: [t.ink2, t.good, t.muted, t.ink],
        borderRadius: 4, borderSkipped: false, barPercentage: 0.6,
      }],
    },
    plugins: [{
      id: "bridgeLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart, meta = chart.getDatasetMeta(0);
        const text = [fmtM(S.inv_now), `−${fmtM(over)}`, `+${fmtM(under)}`, fmtM(S.inv_target)];
        ctx.save();
        ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillStyle = t.ink; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        meta.data.forEach((bar, i) => ctx.fillText(text[i], bar.x, Math.min(bar.y, bar.base) - 4));
        ctx.restore();
      },
    }],
    options: baseOptions(t, {
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (i) => { const [a, b] = i.raw; const d = b - a; return i.dataIndex === 1 ? `−${fmtM(d)}` : i.dataIndex === 2 ? `+${fmtM(d)}` : fmtM(d); } } },
      },
      scales: { x: axisX(t, { ticks: { color: t.ink2, font: { size: 11 }, maxRotation: 0, autoSkip: false } }), y: axisY(t, { beginAtZero: true, ticks: { color: t.muted, callback: (v) => fmtM(v), maxTicksLimit: 6 } }) },
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
    options: baseOptions(t, {
      plugins: {
        legend: { ...baseOptions(t).plugins.legend, labels: { ...baseOptions(t).plugins.legend.labels, generateLabels: () => [
          { text: "Now (light)", fillStyle: `${t.muted}59`, strokeStyle: t.muted, lineWidth: 1, fontColor: t.ink2 },
          { text: "Target (solid)", fillStyle: t.muted, strokeStyle: t.muted, lineWidth: 0, fontColor: t.ink2 },
        ] } },
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.y)}` } },
      },
      scales: { x: axisX(t, { ticks: { color: t.ink2, font: { size: 12 } } }), y: axisY(t, { beginAtZero: true, ticks: { color: t.muted, callback: (v) => fmtM(v), maxTicksLimit: 6 } }) },
    }),
  });

  if (top) {
    draw("stSup", {
      type: "bar",
      data: {
        labels: topSup.map((g) => g.supplier),
        datasets: ["VMI", "CRP"].map((prog) => ({
          label: prog, data: topSup.map((g) => g[prog]), backgroundColor: t.prog(prog),
          borderColor: t.surface, borderWidth: { right: 2, left: 0, top: 0, bottom: 0 }, borderSkipped: false, barPercentage: 0.7,
        })),
      },
      options: baseOptions(t, {
        indexAxis: "y",
        plugins: {
          legend: baseOptions(t).plugins.legend,
          tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtM(i.parsed.x)}`, afterBody: (items) => { const g = topSup[items[0].dataIndex]; return [`${g.n} parts`, g.consign ? `Consignment transfer ${fmtM(g.consign)}` : ""].filter(Boolean); } } },
        },
        scales: {
          x: axisY(t, { stacked: true, beginAtZero: true, ticks: { color: t.muted, callback: (v) => fmtM(v), maxTicksLimit: 6 } }),
          y: axisX(t, { stacked: true, ticks: { color: t.ink2, font: { size: 12 } } }),
        },
      }),
    });
  }
}
