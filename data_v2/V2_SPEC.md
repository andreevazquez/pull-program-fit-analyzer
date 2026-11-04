# v2 data — extends the app to the rest of the Flex Supply Chain Manager role

Do NOT modify `sample_parts.csv` or the v1 logic; v1 acceptance tests must keep passing.
All files join on `part_number` (and `supplier` for suppliers.csv). Analysis date: **2026-11-04**.

## Files
- `suppliers.csv` — supplier master: edi_enabled, vmi_agreement, hub_3pl, hub_contract_end, freshness_rule_months, otd_pct, payment_terms_days
- `forecast.csv` — next 13 weeks of forecast (f01..f13) + one open PO per part (open_po_qty, open_po_due_week; blank = no PO)
- `inventory_lots.csv` — on-hand split into lots with date code (YYWW, ISO week) and received_date

## New tabs

### 1. Pipeline coverage (JD: "Forecast analysis for pipeline coverage (escalations)")
Per part, week by week for 13 weeks: projected = on_hand + open PO (in its due week) − cumulative forecast.
- **Escalate** if projected < 0 in any week ≤ lead time (can't be fixed with a new PO in time). Show first short week and shortage qty/value.
- **Watch** if projected < 0 only after lead time (a normal PO fixes it).
- Also flag **forecast vs history**: avg(f01..f13) / avg(last 8 actual weeks) > 1.5 (upside) or < 0.6 (downside).
- Output: escalation list sorted by shortage value, with supplier and LT.

### 2. Freshness claims (JD: "Freshness claims (validation, escalation, closure)")
Date code YYWW → manufacture date = Monday of that ISO week. Rule = supplier's freshness_rule_months.
- **Claimable**: age at receipt > rule → supplier's responsibility. Status Open, with a generated claim text (part, lot, date code, age at receipt, rule, qty, value).
- **Internal aging**: fresh at receipt but over the rule today → our problem (excess/slow movers), NOT a supplier claim. Show separately.
- Validate date code format (4 digits, week 01–53) and flag invalid ones.
Expected on the sample: 304 lots, **25 claimable**, **18 internal aging**.

### 3. Supplier scorecard (JD: "Increase VMI, reduced LT and EDI penetration", "Hub/3PL Management")
Per supplier: annual spend, % spend recommended for pull, EDI Y/N, VMI agreement Y/N, hub/3PL and contract end, OTD, payment terms, open freshness claims, avg LT.
- KPI: **EDI penetration % of spend** (expected ≈ 71.9% on sample) and **VMI penetration % of spend** current vs recommended.
- Flag: parts recommended for VMI whose supplier has no VMI agreement → "negotiate agreement first". Flag hub contracts ending within 6 months.

### 4. MOQ & LT opportunities (JD: "MOQ reduction projects", "LT reduction initiatives")
- MOQ: parts where MOQ > 4 weeks of avg demand. Show the inventory value carried only because of MOQ = (MOQ/2 − avg×R/2) × cost when positive. Rank by that value.
- LT: Super A and A parts with LT > 12 weeks; show how much safety stock value a 4-week LT reduction would free (recompute safety stock with L−4).

## Rules
Same as v1: every threshold above goes into the Policy panel, and the claim text and escalation list are exportable to CSV.
