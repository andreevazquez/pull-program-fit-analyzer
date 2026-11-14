// Generated from js/exceptions.js by scripts/build-skill.mjs. Edit the source, not this copy.
// Exceptions inbox: management by exception. Pure functions, no DOM. Never changes analyze() results.
// One queue, one shape. Two sources:
//   Detected: rules over data already loaded (pipeline, safety stock, forecast, freshness, E&O, suppliers, data).
//   Events:   data/supply_events.csv (EOL, PCN, allocation, tariff, price increase, LT increase,
//             quality hold, shipment delay). Spec: docs/specs/V3_SPEC.md.
// Every item has impact $ (with its value kind), weeks to impact, severity, owner, SLA and status.
// Value kinds are different money and are never added into one total.
import { ANALYSIS_DATE, parseDate } from "./freshness.js";
import { projectCoverage } from "./v2.js";
import { fmtM } from "./format.js";

export const EXC_DEFAULTS = Object.freeze({
  exc_now_weeks: 2,         // supply impact within this many weeks = act now
  exc_big_value: 100000,    // impact at or above this ($) raises severity
  exc_lt_jump_weeks: 4,     // LT increase event becomes an exception from this many weeks
  exc_price_pct: 0.1,       // price increase event becomes an exception from this share
  exc_otd_min: 90,          // supplier OTD % below this = exception
  exc_ltb_weeks: 52,        // last-time buy covers this many weeks of demand (time to redesign)
  exc_repeat: 3,            // part with this many exception types = review its program
  sla_critical_days: 1,
  sla_high_days: 3,
  sla_medium_days: 10,
  sla_low_days: 20,
});

export const SEVERITIES = ["Critical", "High", "Medium", "Low"];
export const STATUSES = ["Open", "In progress", "Resolved", "Risk accepted"];
export const isOpen = (s) => s === "Open" || s === "In progress";
export const VALUE_KINDS = ["Supply at risk", "Inventory at risk", "Cost increase / yr", "Cash to commit", "Cash blocked", "Recovery"];
const SUPPLY_KINDS = ["Supply at risk", "Cash to commit"]; // urgency (weeks to impact vs lead time) applies to these

const CODES = {
  Supply: ["Expedited", "PO pulled in", "Alternate source", "Allocation agreed", "Customer schedule moved", "Safety stock built"],
  Demand: ["Forecast confirmed", "Forecast corrected", "Orders adjusted"],
  Quality: ["Lot released", "Returned to supplier", "Sorted / reworked", "Claim recovered"],
  Inventory: ["Consumed first", "Returned to supplier", "Pushed out / cancelled", "Written off"],
  Data: ["Data fixed"],
  Supplier: ["Agreement signed", "Contract renewed", "Improvement plan", "Volume moved"],
  Lifecycle: ["Last-time buy placed", "Alternate qualified", "Redesign", "PCN qualified"],
  Cost: ["Negotiated", "Passed to customer", "Alternate source", "Origin changed"],
};
export const resolutionCodes = (cat) => [...(CODES[cat] || []), "Policy changed"];

export const EXC_TYPES = {
  shortage:   { label: "Shortage inside lead time", cat: "Supply", owner: "Planner", action: "Expedite or ask for allocation" },
  po:         { label: "Place PO", cat: "Supply", owner: "Planner", action: "Place the PO by the order-by week" },
  safety:     { label: "Below safety stock", cat: "Supply", owner: "Planner", action: "Build to target" },
  forecast:   { label: "Forecast swing", cat: "Demand", owner: "Planner", action: "Confirm with the customer" },
  claim:      { label: "Freshness claim", cat: "Quality", owner: "Planner", action: "Validate and send the claim" },
  aged:       { label: "Aged lot", cat: "Inventory", owner: "Planner", action: "Use first or reserve" },
  eo:         { label: "E&O exposure", cat: "Inventory", owner: "Manager", action: "Disposition at the E&O review" },
  data:       { label: "Bad data", cat: "Data", owner: "Planner", action: "Fix the record" },
  vmi:        { label: "VMI without agreement", cat: "Supplier", owner: "Manager", action: "Negotiate the VMI agreement" },
  hub:        { label: "Hub contract ending", cat: "Supplier", owner: "Manager", action: "Renew or move the hub" },
  otd:        { label: "Supplier OTD below target", cat: "Supplier", owner: "Manager", action: "Improvement plan or move volume" },
  eol:        { label: "End of life (EOL)", cat: "Lifecycle", owner: "Manager", action: "Decide last-time buy or alternate" },
  pcn:        { label: "Product change (PCN)", cat: "Lifecycle", owner: "Manager", action: "Qualify the change with engineering and the customer" },
  allocation: { label: "Supplier allocation", cat: "Supply", owner: "Manager", action: "Allocation call with supplier and customer" },
  tariff:     { label: "Tariff or origin change", cat: "Cost", owner: "Manager", action: "Negotiate, pass through or change origin" },
  price:      { label: "Price increase", cat: "Cost", owner: "Manager", action: "Negotiate or pass through" },
  lt:         { label: "Lead-time increase", cat: "Supply", owner: "Manager", action: "Pull orders forward; review program" },
  hold:       { label: "Quality hold", cat: "Quality", owner: "Planner", action: "Disposition the lot; check coverage" },
  delay:      { label: "Shipment delay", cat: "Supply", owner: "Planner", action: "Confirm new date; expedite if short" },
};
export const CATEGORIES = [...new Set(Object.values(EXC_TYPES).map((t) => t.cat))];

// Accepted spellings in supply_events.csv → type key
const EVENT_TYPES = { eol: "eol", "end of life": "eol", pcn: "pcn", allocation: "allocation", tariff: "tariff", "price increase": "price",
  "lt increase": "lt", "lead time increase": "lt", "lead-time increase": "lt", "quality hold": "hold", "shipment delay": "delay" };
const NEEDS_VALUE = { allocation: "allocation %", tariff: "duty %", price: "increase %", lt: "new lead time (weeks)", hold: "quantity held", delay: "delay (weeks)" };

const DAY = 86400000;
const num = (v) => { const s = String(v ?? "").replace(/[$,%\s]/g, ""); if (s === "") return NaN; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const pct = (v) => (v > 1 ? v / 100 : v); // 25 or 0.25 → 0.25
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const shortOf = (proj) => -Math.min(0, ...proj);
const firstShort = (proj) => { const i = proj.findIndex((v) => v < 0); return i < 0 ? null : i + 1; };
const fin = (v) => (Number.isFinite(v) ? v : 0);

// Supply kinds: urgency first (weeks to impact vs now and vs lead time), then value. Other kinds: value only.
// cap = best severity allowed, floor = worst severity allowed (indices into SEVERITIES).
export function severityOf({ value, wti, lt, kind, cap = 0, floor = 3 }, P) {
  const v = fin(value), urgent = SUPPLY_KINDS.includes(kind) && wti != null;
  let s;
  if (urgent && wti <= P.exc_now_weeks && v > 0) s = 0;
  else if (urgent && lt > 0 && wti <= lt && v >= P.exc_big_value) s = 0;
  else if ((urgent && lt > 0 && wti <= lt) || v >= P.exc_big_value) s = 1;
  else if (v > 0) s = 2;
  else s = 3;
  return Math.min(Math.max(s, cap), floor);
}
export const slaDays = (sev, P) => [P.sla_critical_days, P.sla_high_days, P.sla_medium_days, P.sla_low_days][sev];

// Validate and read events. Returns { valid: [{ row, type, part, announced, effective, value }], invalid: [{ row, errors }] }.
export function readEvents(rows, partsByPn, today = ANALYSIS_DATE) {
  const valid = [], invalid = [], seen = new Set(), now = parseDate(today);
  for (const row of rows || []) {
    const errors = [];
    const id = String(row.event_id ?? "").trim();
    if (!id) errors.push("Missing event_id");
    else if (seen.has(id)) errors.push(`Duplicate event_id ${id}`);
    seen.add(id);
    const type = EVENT_TYPES[String(row.event_type ?? "").trim().toLowerCase()];
    if (!type) errors.push(`Unknown event type "${String(row.event_type ?? "").trim()}"`);
    const pn = String(row.part_number ?? "").trim(), part = partsByPn.get(pn);
    if (!part) errors.push(pn ? `Part ${pn} is not in the parts file` : "Missing part_number");
    const announced = parseDate(row.announced_date), effective = parseDate(row.effective_date);
    if (!announced) errors.push(`Announced date "${String(row.announced_date ?? "").trim()}" is not YYYY-MM-DD`);
    else if (announced > now) errors.push(`Announced after the analysis date ${today}`);
    if (!effective) errors.push(`Effective date "${String(row.effective_date ?? "").trim()}" is not YYYY-MM-DD`);
    const value = num(row.value);
    if (type && NEEDS_VALUE[type] && !(value > 0)) errors.push(`Needs a positive value (${NEEDS_VALUE[type]})`);
    if (errors.length) invalid.push({ row, errors });
    else valid.push({ row, id, type, part, announced, effective, value });
  }
  return { valid, invalid };
}

export function exceptions({ result, insights, pipe, fresh, score, events = [], P, today = ANALYSIS_DATE, claimStatus = (c) => c.status, statusOf = () => null }) {
  const now = parseDate(today);
  const parts = new Map(result.parts.map((p) => [p.part_number, p]));
  const rows = new Map([...pipe.escalate, ...pipe.watch, ...pipe.covered, ...pipe.noLeadTime].map((r) => [r.part.part_number, r]));
  const weeksTo = (d) => Math.max(0, Math.ceil((d - now) / (7 * DAY)));
  const items = [];
  const add = (type, o) => {
    const T = EXC_TYPES[type];
    items.push({ type, label: T.label, cat: T.cat, owner: T.owner, action: T.action, part: null, supplier: o.part?.supplier ?? "", value: 0, wti: null,
      lt: o.part?.lead_time_weeks || 0, opened: today, source: "Detected", locked: false, ...o });
  };

  /* ---- Detected from data already loaded ---- */
  for (const r of pipe.escalate) add("shortage", { id: `shortage:${r.part.part_number}`, part: r.part, kind: "Supply at risk", value: r.short_value, wti: r.first_short_week,
    detail: `Short from week ${r.first_short_week} inside the ${r.lt}-week lead time: ${Math.round(r.short_qty).toLocaleString("en-US")} units` });
  for (const r of pipe.watch) add("po", { id: `po:${r.part.part_number}`, part: r.part, kind: "Supply at risk", value: r.short_value, wti: r.order_by_week, lt: 0, cap: 1,
    detail: `Short from week ${r.first_short_week}; PO needed by week ${r.order_by_week}` });
  for (const r of insights.critical) {
    const pr = rows.get(r.part.part_number);
    add("safety", { id: `safety:${r.part.part_number}`, part: r.part, kind: "Supply at risk", value: r.build_value, wti: pr?.first_short_week ?? null,
      detail: `On hand below safety stock; ${Math.round(r.build_qty).toLocaleString("en-US")} units to target` });
  }
  for (const r of [...pipe.upside, ...pipe.downside]) {
    const up = r.fc_ratio > 1;
    add("forecast", { id: `forecast:${r.part.part_number}`, part: r.part, kind: up ? "Supply at risk" : "Inventory at risk",
      value: Math.abs(sum(r.forecast, (x) => x) - r.hist_avg * r.forecast.length) * fin(r.cost),
      detail: `Next 13 weeks ${Number.isFinite(r.fc_ratio) ? `${r.fc_ratio.toFixed(2)}×` : "new demand vs no"} recent actuals (${up ? "upside" : "downside"})` });
  }
  for (const c of fresh?.claimable || []) {
    const st = claimStatus(c);
    add("claim", { id: `claim:${c.lot_id}`, part: parts.get(c.part_number), supplier: c.supplier, kind: "Recovery", value: c.value, locked: true,
      fixedStatus: st === "Closed" ? "Resolved" : st === "Escalated" ? "In progress" : "Open",
      detail: `Lot ${c.lot_id} was ${c.age_receipt.toFixed(1)} months old at receipt vs a ${c.rule}-month rule` });
  }
  for (const l of fresh?.aging || []) add("aged", { id: `aged:${l.lot_id}`, part: parts.get(l.part_number), supplier: l.supplier, kind: "Inventory at risk", value: l.value,
    detail: `Lot ${l.lot_id} passed its ${l.rule}-month rule on ${l.expires}` });
  for (const e of insights.eo) add("eo", { id: `eo:${e.part.part_number}`, part: e.part, kind: "Inventory at risk", value: e.value, detail: `${e.why}: stock beyond the E&O horizon` });
  for (const p of result.parts) if (p.issues.length) add("data", { id: `data:${p.part_number}`, part: p, kind: null, floor: p.blocking ? 2 : 3,
    detail: `${p.issues.join("; ")}${p.blocking ? " (kept out of the analysis)" : ""}` });
  for (const l of fresh?.invalid || []) add("data", { id: `data:${l.lot_id}`, part: parts.get(l.part_number) || null, supplier: l.supplier, kind: null,
    detail: `Lot ${l.lot_id}: ${l.errors.join("; ")}` });
  for (const g of score.rows) {
    if (g.noAgreement.length) {
      const release = sum(g.noAgreement, (p) => Math.max(0, p.inv_value_current - p.inv_value_target));
      add("vmi", { id: `vmi:${g.supplier}`, supplier: g.supplier, kind: "Cash blocked", value: release,
        detail: `${g.noAgreement.length} part${g.noAgreement.length === 1 ? "" : "s"} recommended for VMI; inventory release waits for the agreement` });
    }
    if (g.hub_ending) {
      const end = parseDate(g.hub_contract_end);
      add("hub", { id: `hub:${g.supplier}`, supplier: g.supplier, kind: null, wti: weeksTo(end), floor: 2,
        detail: `${g.hub} contract ${g.hub_expired ? "expired" : "ends"} ${g.hub_contract_end}` });
    }
    if (Number.isFinite(g.otd) && g.otd < P.exc_otd_min) {
      const short = pipe.escalate.filter((r) => r.part.supplier === g.supplier);
      add("otd", { id: `otd:${g.supplier}`, supplier: g.supplier, kind: "Supply at risk", value: sum(short, (r) => fin(r.short_value)),
        detail: `On-time delivery ${g.otd}% vs ${P.exc_otd_min}% target, with ${short.length} shortage${short.length === 1 ? "" : "s"} inside lead time at this supplier` });
    }
  }

  /* ---- Events (supply_events.csv) ---- */
  const ev = readEvents(events, parts, today);
  const belowThreshold = [];
  for (const e of ev.valid) {
    const p = e.part, r = rows.get(p.part_number), cost = p.unit_cost_usd > 0 ? p.unit_cost_usd : NaN;
    const spend = fin(p.annual_spend);
    const base = { id: `ev:${e.id}`, part: p, opened: e.row.announced_date, source: `Event ${e.id}`, note: String(e.row.detail ?? "").trim(), effective: e.row.effective_date };
    const eff = weeksTo(e.effective);
    const coverage = (proj) => { const inc = r ? shortOf(proj) - shortOf(r.proj) : 0; return { inc, first: firstShort(proj) }; };
    const units = (v) => Math.round(v).toLocaleString("en-US");
    if (e.type === "eol") {
      const qty = Math.max(0, fin(p.avg_weekly) * P.exc_ltb_weeks - p.on_hand_qty - (r?.po_qty || 0));
      add("eol", { ...base, kind: "Cash to commit", value: qty * cost, wti: eff,
        detail: `Last order ${e.row.effective_date} (${eff} weeks). Last-time buy for ${P.exc_ltb_weeks} weeks of demand: ${units(qty)} units after stock and open PO` });
    } else if (e.type === "pcn") {
      add("pcn", { ...base, kind: "Supply at risk", value: fin(p.avg_weekly) * 13 * cost, wti: eff,
        detail: `Change effective ${e.row.effective_date} (${eff} weeks): 13 weeks of supply ride on qualifying it` });
    } else if (e.type === "allocation") {
      const a = pct(e.value);
      if (!r || !r.po_week) {
        add("allocation", { ...base, kind: "Supply at risk", value: 0, wti: null,
          detail: `${Math.round(a * 100)}% allocation from ${e.row.effective_date}. No open PO inside 13 weeks, so coverage is unchanged now; size the next orders to the allocation` });
      } else {
        const { inc, first } = coverage(projectCoverage(p.on_hand_qty, r.forecast, r.po_qty * a, r.po_week));
        add("allocation", { ...base, kind: "Supply at risk", value: inc * cost, wti: inc > 0 ? first : null,
          detail: `${Math.round(a * 100)}% of the open PO (${units(r.po_qty)} → ${units(r.po_qty * a)}, week ${r.po_week}): ${inc > 0 ? `${units(inc)} more units short, from week ${first}` : "still covered for 13 weeks"}` });
      }
    } else if (e.type === "tariff" || e.type === "price") {
      const a = pct(e.value);
      if (e.type === "price" && a < P.exc_price_pct) { belowThreshold.push({ ...e, why: `${(a * 100).toFixed(1)}% is below the ${(P.exc_price_pct * 100).toFixed(0)}% price threshold` }); continue; }
      add(e.type, { ...base, kind: "Cost increase / yr", value: spend * a, wti: eff,
        detail: `${(a * 100).toFixed(1)}% ${e.type === "tariff" ? "duty" : "increase"} on ${fmtM(spend)}/yr of spend from ${e.row.effective_date}` });
    } else if (e.type === "lt") {
      const L = p.lead_time_weeks, L2 = e.value, d = L2 - (L || 0);
      if (!(d >= P.exc_lt_jump_weeks)) { belowThreshold.push({ ...e, why: `+${d} weeks is below the ${P.exc_lt_jump_weeks}-week threshold` }); continue; }
      const nowInside = r?.first_short_week != null && r.first_short_week <= L2 && !(r.first_short_week <= L);
      add("lt", { ...base, kind: "Cash to commit", value: fin(p.avg_weekly) * d * cost, wti: r?.first_short_week ?? null, lt: L2,
        detail: `Lead time ${L} → ${L2} weeks: orders go out ${d} weeks earlier (${units(fin(p.avg_weekly) * d)} more units in the pipeline)${nowInside ? `. Short from week ${r.first_short_week}, now inside the new lead time` : ""}` });
    } else if (e.type === "hold") {
      const h = Math.min(e.value, p.on_hand_qty);
      const { inc, first } = r ? coverage(projectCoverage(p.on_hand_qty - h, r.forecast, r.po_qty, r.po_week)) : { inc: 0, first: null };
      add("hold", { ...base, kind: inc > 0 ? "Supply at risk" : "Inventory at risk", value: inc > 0 ? inc * cost : h * cost, wti: inc > 0 ? first : null,
        detail: `${units(h)} of ${units(p.on_hand_qty)} on hand quarantined: ${inc > 0 ? `${units(inc)} more units short, from week ${first}` : "the rest still covers 13 weeks"}` });
    } else if (e.type === "delay") {
      if (!r || !r.po_week) {
        add("delay", { ...base, kind: "Supply at risk", value: 0, wti: null, detail: `No open PO inside 13 weeks to delay; confirm with the supplier` });
      } else {
        const w2 = r.po_week + Math.round(e.value);
        const { inc, first } = coverage(projectCoverage(p.on_hand_qty, r.forecast, r.po_qty, w2 <= 13 ? w2 : null));
        add("delay", { ...base, kind: "Supply at risk", value: inc * cost, wti: inc > 0 ? first : null,
          detail: `Open PO ${units(r.po_qty)} moves from week ${r.po_week} to ${w2 <= 13 ? `week ${w2}` : "beyond the 13-week horizon"}: ${inc > 0 ? `${units(inc)} more units short, from week ${first}` : "still covered"}` });
      }
    }
  }

  /* ---- Severity, SLA, status, escalation ---- */
  for (const x of items) {
    x.value = fin(x.value);
    x.sev = severityOf(x, P);
    x.severity = SEVERITIES[x.sev];
    x.sla = slaDays(x.sev, P);
    const opened = parseDate(x.opened) || now;
    x.age = Math.max(0, Math.round((now - opened) / DAY));
    x.due = new Date(+opened + x.sla * DAY).toISOString().slice(0, 10);
    const s = statusOf(x.id);
    x.status = x.locked ? x.fixedStatus : s?.status || "Open";
    x.resolution = s?.resolution || "";
    x.open = isOpen(x.status);
    x.pastSla = x.open && x.age > x.sla;
    // Escalation ladder: past SLA moves one level up; a planner item past twice its SLA reaches the executive.
    x.escalatedTo = !x.pastSla ? null : x.owner === "Manager" || x.age > 2 * x.sla ? "Executive" : "Manager";
  }
  items.sort((a, b) => a.sev - b.sev || Number(b.pastSla) - Number(a.pastSla) || b.value - a.value);

  const open = items.filter((x) => x.open);
  const kindTotals = (list) => VALUE_KINDS.map((k) => ({ kind: k, value: sum(list.filter((x) => x.kind === k), (x) => x.value), n: list.filter((x) => x.kind === k).length }));
  const byCat = CATEGORIES.map((cat) => {
    const l = open.filter((x) => x.cat === cat);
    return { cat, n: l.length, critical: l.filter((x) => x.sev === 0).length, pastSla: l.filter((x) => x.pastSla).length, kinds: kindTotals(l).filter((k) => k.n && k.value) };
  });
  const bySupplierMap = new Map();
  for (const x of open) {
    if (!x.supplier) continue;
    const g = bySupplierMap.get(x.supplier) || { supplier: x.supplier, n: 0, critical: 0, pastSla: 0, supplyRisk: 0, costYr: 0, types: new Set() };
    g.n++; g.critical += x.sev === 0; g.pastSla += x.pastSla; g.types.add(x.label);
    if (x.kind === "Supply at risk") g.supplyRisk += x.value;
    if (x.kind === "Cost increase / yr") g.costYr += x.value;
    bySupplierMap.set(x.supplier, g);
  }
  const byPart = new Map();
  for (const x of open) if (x.part) { const g = byPart.get(x.part.part_number) || { part: x.part, types: new Set(), n: 0 }; g.types.add(x.label); g.n++; byPart.set(x.part.part_number, g); }
  const repeatParts = [...byPart.values()].filter((g) => g.types.size >= P.exc_repeat).sort((a, b) => b.types.size - a.types.size || b.n - a.n);

  return {
    items, open,
    events: { valid: ev.valid.length, invalid: ev.invalid, belowThreshold, total: (events || []).length },
    counts: Object.fromEntries(SEVERITIES.map((s, i) => [s, open.filter((x) => x.sev === i).length])),
    pastSla: open.filter((x) => x.pastSla),
    byOwner: { Planner: open.filter((x) => x.owner === "Planner").length, Manager: open.filter((x) => x.owner === "Manager").length },
    byKind: kindTotals(open),
    byCat,
    bySupplier: [...bySupplierMap.values()].sort((a, b) => b.critical - a.critical || b.supplyRisk - a.supplyRisk),
    repeatParts,
    executive: open.filter((x) => x.escalatedTo === "Executive" || (x.sev === 0 && x.owner === "Manager")),
  };
}

export const EXCEPTION_COLUMNS = ["id", "severity", "type", "category", "owner", "status", "resolution", "part_number", "supplier", "value_usd", "value_kind",
  "weeks_to_impact", "opened", "age_days", "sla_days", "due", "past_sla", "escalated_to", "source", "detail", "next_action"];
export const exceptionRow = (x) => [x.id, x.severity, x.label, x.cat, x.owner, x.status, x.resolution, x.part?.part_number || "", x.supplier, x.value ? x.value.toFixed(2) : "",
  x.kind || "", x.wti ?? "", x.opened, x.age, x.sla, x.due, x.pastSla ? "Y" : "", x.escalatedTo || "", x.source, x.detail + (x.note ? ` (${x.note})` : ""), x.action];
