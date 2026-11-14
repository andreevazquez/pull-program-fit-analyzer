// Generated from js/insights.js by scripts/build-skill.mjs. Edit the source, not this copy.
// Director-level views built on top of analyze() results.
// These extend the reference logic in segment.py (they don't change it): carrying cost,
// stockout risk, rollout waves, excess & obsolescence (E&O) exposure, and scenario metrics.
// Pure functions, no DOM.

export const INSIGHT_DEFAULTS = Object.freeze({
  carrying_rate: 0.25,     // annual cost of holding inventory, share of value (capital, storage, insurance, shrink)
  eo_horizon_weeks: 26,    // E&O: stock beyond this many weeks of recent run-rate is exposed
  eo_dos_days: 180,        // E&O: non-declining parts count as slow movers above this DOS
  wave2_share: 0.70,       // Wave 2 = suppliers covering this share of VMI/CRP spend (ranked); rest is Wave 3
  wave_months: 3,          // months per wave, for the timeline labels
});

const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

export function insights(result, P) {
  const s = result.analyzed, S = result.summary;
  const rate = P.carrying_rate;

  // 1. Carrying cost: the recurring P&L effect, separate from one-time cash and from ownership transfer.
  const carrying = {
    rate,
    now: S.inv_now * rate,
    target: S.inv_target * rate,
    avoided: Math.max(0, S.inv_now - S.inv_target) * rate,
    onExcess: S.excess * rate,
    consignShift: S.consignment * rate,
    targetOwned: Math.max(0, S.inv_target - S.consignment) * rate,
  };

  // 2. Stockout risk: on hand below the safety stock (critical) or below target (watch).
  const risk = [];
  for (const p of s) {
    const ss = p.calc.ss;
    const tier = p.on_hand_qty < ss ? "Critical" : p.on_hand_qty < p.target_qty ? "Watch" : null;
    if (!tier) continue;
    risk.push({
      part: p, tier, safety: ss,
      weeks_cover: p.on_hand_qty / p.avg_weekly,
      build_qty: p.target_qty - p.on_hand_qty,
      build_value: (p.target_qty - p.on_hand_qty) * p.unit_cost_usd,
    });
  }
  risk.sort((a, b) => (a.tier === b.tier ? b.build_value - a.build_value : a.tier === "Critical" ? -1 : 1));
  const critical = risk.filter((r) => r.tier === "Critical");

  // 3. E&O exposure: stock beyond the horizon at the recent run-rate, on declining or slow-moving parts.
  const eo = [];
  for (const p of s) {
    const runRate = p.trend_last; // mean of the last trend_weeks weeks
    const covered = runRate * P.eo_horizon_weeks;
    const value = Math.max(0, p.on_hand_qty - covered) * p.unit_cost_usd;
    const declining = p.trend === "Declining", slow = p.dos_current > P.eo_dos_days;
    if (value > 0 && (declining || slow)) {
      eo.push({ part: p, runRate, covered, excess_qty: p.on_hand_qty - covered, value, why: declining ? "Declining demand" : `Slow mover, ${Math.round(p.dos_current)} days on hand` });
    }
  }
  eo.sort((a, b) => b.value - a.value);

  // 4. Rollout waves. Wave 1 needs no supplier agreement (Kanban, back to MRP, right-size in place);
  // VMI/CRP moves go by supplier, biggest VMI/CRP spend first.
  const needsSupplier = (p) => p.program_change && (p.recommended_program === "VMI" || p.recommended_program === "CRP");
  const supSpend = new Map();
  for (const p of s.filter(needsSupplier)) supSpend.set(p.supplier, (supSpend.get(p.supplier) || 0) + p.annual_spend);
  const ranked = [...supSpend.entries()].sort((a, b) => b[1] - a[1]);
  const pullTotal = sum(ranked, (r) => r[1]);
  const supWave = new Map();
  let cum = 0;
  for (const [sup, v] of ranked) {
    supWave.set(sup, pullTotal && cum / pullTotal < P.wave2_share ? 2 : 3);
    cum += v;
  }
  const waveOf = (p) => (needsSupplier(p) ? supWave.get(p.supplier) : 1);
  const m = P.wave_months;
  const meta = {
    1: { label: "Wave 1", when: `Months 0–${m}`, what: "Internal moves: Kanban, back to MRP, right-size in place" },
    2: { label: "Wave 2", when: `Months ${m}–${2 * m}`, what: "VMI/CRP with anchor suppliers" },
    3: { label: "Wave 3", when: `Months ${2 * m}–${3 * m}`, what: "VMI/CRP with remaining suppliers" },
  };
  const waves = [1, 2, 3].map((w) => {
    const parts = s.filter((p) => waveOf(p) === w);
    const delta = parts.map((p) => p.inv_value_current - p.inv_value_target);
    return {
      wave: w, ...meta[w], parts,
      n: parts.length,
      changes: parts.filter((p) => p.program_change).length,
      released: sum(delta, (d) => Math.max(0, d)),
      built: sum(delta, (d) => Math.max(0, -d)),
      net: sum(delta, (d) => d),
      excess: sum(parts, (p) => p.excess_value),
      consignment: sum(parts, (p) => p.consignment_transfer_value),
      suppliers: w === 1 ? [] : ranked.filter(([sup]) => supWave.get(sup) === w).map(([sup, v]) => ({ supplier: sup, spend: v })),
    };
  });
  let running = 0;
  for (const w of waves) w.cumulative = running += w.net;

  return {
    carrying, risk, critical, eo, waves,
    riskBuild: sum(risk, (r) => r.build_value),
    criticalBuild: sum(critical, (r) => r.build_value),
    eoValue: sum(eo, (e) => e.value),
  };
}

// The numbers a scenario comparison needs, from one analyze()+insights() pass.
export function scenarioMetrics(result, ins) {
  const S = result.summary;
  return {
    pull_share_rec: S.pull_share_rec,
    program_changes: S.program_changes,
    inv_target: S.inv_target,
    inv_reduction: S.inv_now - S.inv_target,
    excess: S.excess,
    consignment: S.consignment,
    carrying_avoided: ins.carrying.avoided,
    critical: ins.critical.length,
    risk_build: ins.riskBuild,
    eo_value: ins.eoValue,
  };
}

export const SCENARIO_ROWS = [
  { key: "pull_share_rec", label: "Spend under pull programs", fmt: "pct" },
  { key: "program_changes", label: "Program changes", fmt: "int" },
  { key: "inv_target", label: "Inventory at target", fmt: "usd", better: "low" },
  { key: "inv_reduction", label: "Inventory reduction", fmt: "usd", better: "high" },
  { key: "excess", label: "Excess to right-size (one-time cash)", fmt: "usd" },
  { key: "consignment", label: "Consignment transfer (ownership)", fmt: "usd" },
  { key: "carrying_avoided", label: "Carrying cost avoided / yr (P&L)", fmt: "usd", better: "high" },
  { key: "critical", label: "Parts below safety stock", fmt: "int", better: "low" },
  { key: "risk_build", label: "Build-up needed below target", fmt: "usd", better: "low" },
  { key: "eo_value", label: "E&O exposure", fmt: "usd", better: "low" },
];
