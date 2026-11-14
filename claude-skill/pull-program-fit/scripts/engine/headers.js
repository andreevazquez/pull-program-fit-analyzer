// Generated from js/headers.js by scripts/build-skill.mjs. Edit the source, not this copy.
// Header aliases for the parts file, so a CSV exported from an ERP (item master + on-hand + usage)
// can be read without renaming columns by hand. Matching is case-insensitive and ignores spaces,
// dashes and dots. Canonical names always win: an alias is used only when the canonical column is absent.
// Pure functions, no DOM; used by js/app.js and the Claude skill (claude-skill/).

const ALIASES = {
  part_number: ["item", "item_number", "item_no", "item_id", "item_code", "part", "part_no", "part_num", "pn", "internal_part_number"],
  description: ["item_description", "part_description", "display_name", "desc"],
  commodity: ["category", "item_category", "commodity_code", "product_group"],
  manufacturer: ["mfr", "mfg", "manufacturer_name", "mfr_name"],
  supplier: ["vendor", "preferred_vendor", "vendor_name", "supplier_name"],
  unit_cost_usd: ["unit_cost", "cost", "standard_cost", "std_cost", "purchase_price", "unit_price", "last_purchase_price"],
  lead_time_weeks: ["lead_time_wks", "lt_weeks", "leadtime_weeks", "lead_time_in_weeks"],
  moq: ["min_order_qty", "minimum_order_quantity", "min_order_quantity", "minimum_order_qty"],
  current_program: ["program", "replenishment_program", "replenishment_method", "supply_program"],
  on_hand_qty: ["on_hand", "qty_on_hand", "quantity_on_hand", "onhand", "onhand_qty", "available_qty"],
};
const DAY_COLUMNS = ["lead_time_days", "lead_time_in_days", "lt_days", "leadtime_days"];
const BY_ALIAS = new Map(Object.entries(ALIASES).flatMap(([canon, list]) => list.map((a) => [a, canon])));

// "Qty On Hand" → "qty_on_hand"; "W1" / "Week 1" / "wk_01" → "w01".
export function normalizeHeader(h) {
  const s = String(h ?? "").replace(/^﻿/, "").trim().toLowerCase().replace(/[\s.\-/]+/g, "_").replace(/^_+|_+$/g, "");
  const wk = s.match(/^(?:w|wk|week)_?0*(\d{1,2})$/);
  return wk && +wk[1] >= 1 && +wk[1] <= 52 ? `w${wk[1].padStart(2, "0")}` : s;
}

// Rename alias columns to their canonical names (when the canonical one is missing) and convert a lead
// time given in days to weeks. Returns { rows, renamed: [[from, to]], converted: "lead_time_days" | null }.
export function canonicalRows(rows) {
  if (!rows.length) return { rows, renamed: [], converted: null };
  const fields = Object.keys(rows[0]);
  const present = new Set(fields);
  const renamed = [];
  for (const f of fields) {
    const canon = BY_ALIAS.get(f);
    if (canon && !present.has(canon) && !renamed.some(([, to]) => to === canon)) renamed.push([f, canon]);
  }
  const dayCol = !present.has("lead_time_weeks") && !renamed.some(([, to]) => to === "lead_time_weeks") ? DAY_COLUMNS.find((c) => present.has(c)) : null;
  if (!renamed.length && !dayCol) return { rows, renamed, converted: null };
  const out = rows.map((r) => {
    const o = { ...r };
    for (const [from, to] of renamed) o[to] = r[from];
    if (dayCol) {
      const d = Number(String(r[dayCol] ?? "").replace(/[,\s]/g, ""));
      o.lead_time_weeks = String(r[dayCol] ?? "").trim() === "" || !Number.isFinite(d) ? "" : String(Math.round((d / 7) * 100) / 100);
    }
    return o;
  });
  return { rows: out, renamed, converted: dayCol || null };
}
