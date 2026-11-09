// Supplier impact view: the same parts, seen from the supplier's side of the table.
// The plant's consumption is each supplier's sell-through; the plant's on-hand stock is
// inventory sitting at the customer. When the plant moves to its target stock, sell-in
// (what suppliers ship) differs from sell-through by exactly that change in stock:
//   sell-in = sell-through − stock drawdown + stock build-up
// Pure functions, no DOM. Built on analyze() results; never changes them.

export const SALES_DEFAULTS = Object.freeze({
  destock_weeks: 13,        // weeks the plant takes to work excess down to target (and to build up shortfalls)
  sales_horizon_weeks: 26,  // weeks of sell-in projection
});

const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

// One part: weekly sell-in in units over the horizon, versus a flat sell-through run-rate.
export function projectPart(p, D, H) {
  const c = p.avg_weekly;
  const over = Math.max(0, p.on_hand_qty - p.target_qty);
  const under = Math.max(0, p.target_qty - p.on_hand_qty);
  // Burn the excess at over/D per week, but the plant cannot buy less than nothing:
  // if over/D exceeds consumption, sell-in stops and the burn takes longer than D weeks.
  const rate = Math.min(c, over / D);
  let left = over;
  const units = [];
  for (let k = 0; k < H; k++) {
    const burn = Math.min(rate, left);
    left -= burn;
    const build = k < D ? under / D : 0;
    units.push(c - burn + build);
  }
  return {
    units,
    over, under,
    weeks_to_target: over > 0 ? (rate > 0 ? over / rate : Infinity) : 0,
    dip_qty: over - left,                       // drawdown that falls inside the horizon
    build_qty: under * Math.min(1, H / D),
  };
}

export function sellIn(result, P) {
  const D = Math.max(1, P.destock_weeks), H = Math.max(1, Math.round(P.sales_horizon_weeks));
  const s = result.analyzed;
  const through = new Array(H).fill(0), sellin = new Array(H).fill(0);
  const history = (result.weeks || []).map(() => 0);
  const bySup = new Map();
  const consign = P.consignment;

  for (const p of s) {
    const pr = projectPart(p, D, H);
    const cost = p.unit_cost_usd;
    for (let k = 0; k < H; k++) { through[k] += p.avg_weekly * cost; sellin[k] += pr.units[k] * cost; }
    p.demand.forEach((q, i) => { if (i < history.length) history[i] += q * cost; });

    const g = bySup.get(p.supplier) || {
      supplier: p.supplier, n: 0, through_annual: 0, through_week: 0, inv_now: 0, inv_target: 0,
      dip: 0, build: 0, pull: 0, consignment: 0, ramp: 0, declining: 0, worst: null,
    };
    g.n++;
    g.through_annual += p.annual_spend;
    g.through_week += p.avg_weekly * cost;
    g.inv_now += p.inv_value_current;
    g.inv_target += p.inv_value_target;
    g.dip += pr.dip_qty * cost;
    g.build += pr.build_qty * cost;
    if (p.recommended_program === "VMI" || p.recommended_program === "CRP") g.pull += p.annual_spend;
    if (consign) g.consignment += p.consignment_transfer_value;
    if (p.trend === "Ramp") g.ramp += p.annual_spend;
    if (p.trend === "Declining") g.declining += p.annual_spend;
    const dipV = pr.dip_qty * cost;
    if (!g.worst || dipV > g.worst.dip) g.worst = { part_number: p.part_number, dip: dipV, weeks: pr.weeks_to_target };
    bySup.set(p.supplier, g);
  }

  const suppliers = [...bySup.values()].map((g) => {
    const throughH = g.through_week * H;
    const net = g.build - g.dip;
    return {
      ...g,
      net,
      through_h: throughH,
      sellin_h: throughH + net,
      change: throughH ? net / throughH : 0,
      cover_now: g.through_week ? g.inv_now / g.through_week : 0,
      cover_target: g.through_week ? g.inv_target / g.through_week : 0,
    };
  }).sort((a, b) => a.net - b.net);

  const throughH = sum(through, (x) => x), sellinH = sum(sellin, (x) => x);
  const dip = sum(suppliers, (g) => g.dip), build = sum(suppliers, (g) => g.build);
  const weekly = through[0] || 0;
  // First week from which sell-in is back within 1% of sell-through.
  let recover = H + 1;
  for (let k = 0; k < H; k++) {
    if (sellin.slice(k).every((v, j) => Math.abs(v - through[k + j]) <= 0.01 * through[k + j])) { recover = k + 1; break; }
  }
  const firstD = Math.min(D, H);
  const dipWindow = sum(sellin.slice(0, firstD), (x) => x) - sum(through.slice(0, firstD), (x) => x);

  return {
    D, H, through, sellin, history,
    suppliers,
    totals: {
      through_annual: result.summary.annual_spend,
      through_week: weekly,
      through_h: throughH,
      sellin_h: sellinH,
      net: sellinH - throughH,
      dip, build,
      dip_window: dipWindow,                         // sell-in minus sell-through over the first D weeks
      dip_window_pct: weekly ? dipWindow / (weekly * firstD) : 0,
      inv_now: result.summary.inv_now,
      inv_target: result.summary.inv_target,
      cover_now: weekly ? result.summary.inv_now / weekly : 0,
      cover_target: weekly ? result.summary.inv_target / weekly : 0,
      recover_week: recover,                         // H + 1 = not back to run-rate within the horizon
      consignment: consign ? result.summary.consignment : 0,
      ramp: sum(suppliers, (g) => g.ramp),
      declining: sum(suppliers, (g) => g.declining),
    },
  };
}
