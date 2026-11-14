---
name: pull-program-fit
description: Recommends which purchased parts belong in VMI, CRP, Kanban or MRP, sizes min/max and target inventory, and lists what to expedite, from an item master + on-hand + weekly usage CSV (exported from NetSuite, Infor or any ERP). Use when a supply chain manager, buyer or planner asks which parts to move to a pull program or supplier-managed inventory, how much inventory or working capital a replenishment policy frees, what is short inside its lead time, what happens if a supplier ships late, or to draft a VMI/CRP proposal for a supplier.
---

# Pull program fit

Runs the engine of the Pull Program Fit Analyzer (https://andreevazquez.github.io/pull-program-fit-analyzer/) on the user's files. The rules are explicit and every number traces back to a part. Full rules and formulas: `references/METHODOLOGY.md`.

The output is a recommendation for a person to review. This skill never sends anything to a supplier and never writes to an ERP or any system of record.

## When to use

- "Which of our parts should go to VMI / consignment / Kanban?"
- "How much inventory would we free if we moved to pull programs?"
- "What do we need to expedite?" (needs a forecast file with open POs)
- "What happens if <supplier> is 2 weeks late?"
- "Draft a VMI proposal for <supplier>."

## Getting the data

If the team uses connectors (Microsoft 365, NetSuite, Infor) or Claude for Manufacturing, export from there. Otherwise the user exports a saved search or report.

**Required, one row per purchased part** (`parts.csv`):

| Column | Accepted header names | Notes |
|---|---|---|
| `part_number` | item, item number, item no, part, part no, pn | |
| `unit_cost_usd` | unit cost, cost, standard cost, purchase price, unit price | > 0, or the part is blocked |
| `lead_time_weeks` | lead time wks, lt weeks; or `lead_time_days` (converted ÷ 7) | Blank blocks the part |
| `moq` | min order qty, minimum order quantity | |
| `current_program` | program, replenishment method | MRP, VMI (or VMI/SMI), CRP, Kanban |
| `on_hand_qty` | on hand, qty on hand, quantity on hand | Units |
| `w01` … `w26` | W1…W26, Week 1…Week 26 | Weekly usage in units, oldest first. 26 weeks recommended |

Recommended: `description`, `commodity` (category), `manufacturer` (mfr), `supplier` (vendor).

Headers are case-insensitive; spaces and dashes are ignored. `$` and thousands separators in numbers are fine.

**Optional files:**
- `forecast.csv`: `part_number, open_po_qty, open_po_due_week, f01…f13`. Needed for expedites and the delay what-if.
- `suppliers.csv`: `supplier, edi_enabled, vmi_agreement, hub_3pl, hub_contract_end, freshness_rule_months, otd_pct, payment_terms_days`. Needed for the proposal asks.
- `inventory_lots.csv` and `supply_events.csv`: as in the web app. They only feed the exception counts here.

If the user has no data yet, run with `--sample` to show how it works on 150 synthetic parts.

## How to run

```bash
node scripts/analyze.mjs parts.csv --forecast forecast.csv --suppliers suppliers.csv --out ppfa-output
```

Options:
- `--whatif "<supplier>" --weeks 2`: delay that supplier's open POs.
- `--proposal "<supplier>"`: VMI/CRP proposal draft.
- `--policy policy.json`: override policy parameters, e.g. `{"tolerance": 1.3, "z": {"C": 1.65}, "vmi_lt_ax": 6}`. Parameter names are listed in `references/METHODOLOGY.md`.
- `--sample`: use the bundled sample files.

Node 18 or later. No packages to install. The script prints `summary.md` and writes these files to `--out`:
- `results.csv`: one row per part, with class, program, reason, target, days of supply and excess.
- `expedites.csv`, `whatif_*.csv`, `proposal_*.csv`, `proposal_*.md`, depending on the options.
- `summary.json`.

If the supplier name for `--whatif` or `--proposal` doesn't match, the summary lists the valid names. Run again with one of them.

## How to present the results

1. **Start with the Data table.** Say which files were missing and which views did not run. Name parts blocked by bad data, so the user can fix the master data.
2. **Keep value types separate.** Never add them into one "savings" number:
   - Net working capital and excess are one-time cash.
   - Carrying cost avoided is P&L per year.
   - Consignment is an ownership transfer to the supplier, not a saving.
   - Build-up is cash to commit.
3. **Tie every claim to parts.** Cite part numbers and the CSV the user can open. For "why", use the `reason` column and the formulas in METHODOLOGY.md, with that part's own numbers.
4. **Treat proposals as drafts.** Say they must be reviewed (levels, pack sizes, lead times with the buyer) before anything goes to the supplier. Do not send them.
5. **Expedites are about timing.** A part can be short in the 13-week plan and still be in excess against the target. Don't recommend cancelling the PO that covers the shortage.
6. **Answer in the user's language.** The engine output is in English, but supply chain terms (VMI, safety stock, lead time, forecast, PO, MOQ) usually stay in English in Spanish-speaking plants.

## Limits

- Single site. No supplier capacity. Demand history is the 26 weeks in the file, and the forecast only feeds expedites and the what-if.
- Default z-factors, review periods and floors are a starting policy for EMS components, not a standard. Show `--policy` overrides when the user's plant runs differently.
