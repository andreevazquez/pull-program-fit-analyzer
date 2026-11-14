// Generated from js/freshness.js by scripts/build-skill.mjs. Edit the source, not this copy.
// Freshness claims (V2_SPEC.md section 2). Pure functions, no DOM.
// Date code YYWW = ISO year 20YY, ISO week WW; manufacture date = Monday of that week.
// Rule = the supplier's freshness_rule_months (suppliers.csv).
//   Claimable:      age at receipt > rule (+ grace)  → the supplier shipped old stock; open a claim.
//   Internal aging: fresh at receipt, over the rule today → our own excess / slow mover, not a claim.
// Never changes analyze() results.

export const ANALYSIS_DATE = "2026-11-04"; // fixed by V2_SPEC.md, so results don't drift with the clock

export const FRESHNESS_DEFAULTS = Object.freeze({
  fresh_default_rule_months: 24, // used when a lot's supplier has no rule in suppliers.csv
  fresh_grace_months: 0,         // claim only when age at receipt exceeds the rule by more than this
});

const DAY = 86400000;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
export const iso = (d) => d.toISOString().slice(0, 10);

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = utc(+m[1], +m[2] - 1, +m[3]);
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}

// Monday of ISO week 1 is the Monday on or before 4 January.
const isoWeek1 = (y) => { const j4 = utc(y, 0, 4); return new Date(j4 - ((j4.getUTCDay() + 6) % 7) * DAY); };
export const isoWeeksInYear = (y) => Math.round((isoWeek1(y + 1) - isoWeek1(y)) / (7 * DAY));

// Returns { date } or { error }.
export function parseDateCode(code) {
  const s = String(code ?? "").trim();
  if (!/^\d{4}$/.test(s)) return { error: s ? `"${s}" is not 4 digits (YYWW)` : "Missing date code" };
  const y = 2000 + +s.slice(0, 2), w = +s.slice(2);
  if (w < 1 || w > 53) return { error: `Week ${s.slice(2)} is outside 01–53` };
  if (w > isoWeeksInYear(y)) return { error: `${y} has no ISO week 53` };
  return { date: new Date(+isoWeek1(y) + (w - 1) * 7 * DAY), year: y, week: w };
}

export function addMonths(d, n) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const last = utc(y, m + 1, 0).getUTCDate();
  return utc(y, m, Math.min(d.getUTCDate(), last));
}
export const monthsBetween = (a, b) => (b - a) / DAY / 30.4375;

const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };
const fmtQty = (v) => new Intl.NumberFormat("en-US").format(v);
const fmtMoney = (v) => "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtUnit = (v) => "$" + (v < 1 ? v.toFixed(4) : v.toFixed(2));

export function claimText(c) {
  return [
    `Freshness claim: lot ${c.lot_id}, part ${c.part_number}${c.description ? ` (${c.description})` : ""}.`,
    `Supplier: ${c.supplier}.`,
    `Date code ${c.date_code} = ISO week ${String(c.week).padStart(2, "0")} of ${c.year}, manufactured ${c.mfg_date}. Received ${c.received_date}.`,
    `Age at receipt ${c.age_receipt.toFixed(1)} months vs the supplier's ${c.rule}-month freshness rule (${(c.age_receipt - c.rule).toFixed(1)} months over).`,
    `Quantity ${fmtQty(c.qty)} units${Number.isFinite(c.value) ? `, value ${fmtMoney(c.value)} at ${fmtUnit(c.unit_cost)}/unit` : " (value pending: the part has no valid unit cost)"}.`,
    `Requested: replacement with in-date stock or credit for the full lot.`,
  ].join(" ");
}

// lots: rows of inventory_lots.csv; suppliers: rows of suppliers.csv; parts: analyze().parts (any, joined on part_number)
export function freshness(lots, suppliers, parts, P, today = ANALYSIS_DATE) {
  const now = parseDate(today);
  const rules = new Map(suppliers.map((s) => [String(s.supplier ?? "").trim(), num(s.freshness_rule_months)]));
  const partMap = new Map(parts.map((p) => [p.part_number, p]));
  const claimable = [], aging = [], invalid = [], ok = [];

  for (const r of lots) {
    const lot = {
      lot_id: String(r.lot_id ?? "").trim(),
      part_number: String(r.part_number ?? "").trim(),
      supplier: String(r.supplier ?? "").trim(),
      qty: num(r.qty) || 0,
      date_code: String(r.date_code ?? "").trim(),
      received_date: String(r.received_date ?? "").trim(),
    };
    const part = partMap.get(lot.part_number);
    lot.description = part?.description || "";
    lot.unit_cost = part && part.unit_cost_usd > 0 ? part.unit_cost_usd : NaN;
    lot.value = lot.qty * lot.unit_cost;
    const supRule = rules.get(lot.supplier);
    lot.rule = Number.isFinite(supRule) && supRule > 0 ? supRule : P.fresh_default_rule_months;
    lot.rule_source = Number.isFinite(supRule) && supRule > 0 ? "supplier" : "default";

    const dc = parseDateCode(lot.date_code);
    const rec = parseDate(lot.received_date);
    const errors = [];
    if (dc.error) errors.push(dc.error);
    if (!rec) errors.push(lot.received_date ? `Received date "${lot.received_date}" is not YYYY-MM-DD` : "Missing received date");
    if (dc.date && rec && dc.date > rec) errors.push(`Date code ${lot.date_code} is after the received date`);
    if (!part) errors.push("Part not in the parts file");
    if (errors.length) { invalid.push({ ...lot, errors }); continue; }

    lot.year = dc.year; lot.week = dc.week;
    lot.mfg_date = iso(dc.date);
    lot.age_receipt = monthsBetween(dc.date, rec);
    lot.age_today = monthsBetween(dc.date, now);
    lot.expires = iso(addMonths(dc.date, lot.rule));
    if (rec > addMonths(dc.date, lot.rule + P.fresh_grace_months)) {
      claimable.push({ ...lot, status: "Open", claim_text: "" });
    } else if (now > addMonths(dc.date, lot.rule)) {
      aging.push(lot);
    } else ok.push(lot);
  }
  for (const c of claimable) c.claim_text = claimText(c);
  const byValue = (a, b) => (Number.isFinite(b.value) ? b.value : -1) - (Number.isFinite(a.value) ? a.value : -1);
  claimable.sort(byValue); aging.sort(byValue);

  const val = (a) => a.reduce((t, x) => t + (Number.isFinite(x.value) ? x.value : 0), 0);
  const bySupplier = new Map();
  for (const c of claimable) {
    const g = bySupplier.get(c.supplier) || { supplier: c.supplier, n: 0, value: 0 };
    g.n++; g.value += Number.isFinite(c.value) ? c.value : 0;
    bySupplier.set(c.supplier, g);
  }
  return {
    today, lots: lots.length, claimable, aging, invalid, ok,
    claimValue: val(claimable), agingValue: val(aging),
    bySupplier: [...bySupplier.values()].sort((a, b) => b.value - a.value),
  };
}

export const CLAIM_COLUMNS = ["lot_id", "part_number", "description", "supplier", "date_code", "mfg_date", "received_date",
  "age_receipt_months", "rule_months", "months_over", "qty", "unit_cost_usd", "value_usd", "status", "claim_text"];
export const claimRow = (c, status = c.status) => [c.lot_id, c.part_number, c.description, c.supplier, c.date_code, c.mfg_date, c.received_date,
  c.age_receipt.toFixed(1), c.rule, (c.age_receipt - c.rule).toFixed(1), c.qty, Number.isFinite(c.unit_cost) ? c.unit_cost : "",
  Number.isFinite(c.value) ? c.value.toFixed(2) : "", status, c.claim_text];
