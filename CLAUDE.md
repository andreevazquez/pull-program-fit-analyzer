# Pull Program Fit Analyzer

## What this is
A static web app that takes a list of purchased electronic components with 26 weeks of demand and recommends which pull program each part belongs in (VMI/SMI, CRP, Kanban, or stay in MRP), the target days of supply (DOS) for that program, and how much inventory the change frees up.

Audience: a Supply Chain Manager at an EMS plant (Flex-style), and hiring managers who open the link from LinkedIn. The tone is a decision tool for whoever owns purchasing policy, not a planner's lookup.

The point to make in 10 seconds: **pull programs are a portfolio decision, and the policy is explicit and adjustable.**

## Stack and constraints
- Static site, deployed to GitHub Pages. No backend, no build step required (plain HTML + JS modules are fine; Vite only if it clearly helps).
- Libraries from CDN, pinned versions: Papa Parse (CSV), Chart.js (charts). Nothing else unless necessary.
- `sample_parts.csv` loads automatically on open. The user can also upload their own CSV in the same format.
- All computation in the browser. No data leaves the page. The only external call besides the CDNs is Cloudflare Web Analytics (anonymous page views, no cookies, never sees uploaded data).
- UI in English. Light and dark mode via `prefers-color-scheme`. Responsive down to phone width.
- Footer: "Synthetic data. Part numbers, manufacturers and suppliers are fictional." plus author credit and LinkedIn link (https://www.linkedin.com/in/ricardovazquez88).

## Input format (`sample_parts.csv`)
`part_number, description, commodity, manufacturer, supplier, unit_cost_usd, lead_time_weeks, moq, current_program, on_hand_qty, w01 … w26`
- `w01..w26`: weekly demand in units, oldest to newest.
- `current_program`: one of MRP, VMI, CRP, Kanban.
- The sample deliberately contains bad rows (missing lead time, zero cost, no demand, oversized MOQ). Do not clean them out of the file.

## Logic (source of truth: `reference/segment.py`)
The JS must reproduce `reference/expected_results.csv` exactly (to rounding). If anything in this section seems to disagree with the Python, the Python wins.

1. **Per-part stats**: avg weekly demand, population std dev (ddof=0), CV = sd/avg, zero_share = share of weeks with 0 demand.
2. **Data integrity**: flag missing lead time, cost ≤ 0, no demand in 26 weeks (these three **block** the part from segmentation), and MOQ > 8 weeks of avg demand (warning only).
3. **ABC by annual spend** (avg weekly × 52 × unit cost), sorted descending, using cumulative share *before* the part: A < 80%, B < 95%, else C. **Super A** = cumulative-before < 50%.
4. **XYZ**: Z if zero_share > 30% or CV ≥ 1.0; Y if CV ≥ 0.5; else X.
5. **Trend** (only when zero_share ≤ 30%): mean of last 8 weeks vs first 8. > 1.5× = Ramp, < 0.5× = Declining, else Flat.
6. **Recommendation** (trend overrides the matrix):
   - Ramp or Declining → MRP
   - AX → VMI if LT ≥ 8 wks, else CRP
   - AY → VMI if LT ≥ 12 wks, else CRP
   - BX → Kanban if unit cost < $1, else CRP
   - BY → CRP
   - CX, CY → Kanban
   - AZ, BZ, CZ → MRP
   Each recommendation carries a one-line reason (see the Python).
7. **Target inventory** per program, with review period R and exposure lead time L in weeks:
   VMI R1/L2, CRP R1/L2, Kanban R2/L2, MRP R2/L = part lead time.
   z by class: A 1.65, B 1.65, C 2.05.
   `safety = z × sd × √(R+L)`, `cycle = max(avg × R, MOQ) / 2`,
   `target = max(safety + cycle, floor_days × avg / 7)` with floors VMI 14, CRP 14, Kanban 21, MRP 21 days.
8. **Outputs**: DOS current and target (calendar days, avg/7 per day), inventory value current and target, **excess** = max(0, on_hand − target × 1.2) × cost, and for VMI with consignment ON, **consignment transfer** = max(0, target − 2 days of demand) × cost.
   Keep excess and consignment transfer as **separate numbers**. Never add them into one "savings" headline: one is right-sizing, the other is moving ownership to the supplier.

## Policy panel (this is the feature that matters)
Every parameter in `P` in the Python is editable in a collapsible "Policy" panel: ABC cutoffs, CV cutoffs, zero-share cutoff, trend thresholds, VMI LT thresholds, Kanban cost cap, z per class, R/L/floor per program, excess tolerance, consignment on/off, line-side days.
Changing any value recomputes everything instantly. Include "Reset to defaults".

## Screens
1. **Summary**: KPI cards for parts analyzed / blocked by data, annual spend, inventory now vs target, excess, consignment transfer, % of spend in pull programs today vs recommended, and number of program changes.
2. **ABC × XYZ matrix**: 3×3 grid showing part count and spend per cell, colored by recommended program. Clicking a cell filters the table.
3. **Program migration**: current program → recommended program counts (a simple from/to table is fine; Sankey optional).
4. **Parts table**: sortable and filterable by commodity, supplier, class, current/recommended program, Super A, change-only, and has-issue. Columns: part, commodity, supplier, ABC, XYZ, trend, current, recommended, reason, DOS now, DOS target, excess $.
5. **Part detail** (drawer or modal): 26-week demand chart with avg line, the stats, and the target calculation shown step by step with actual numbers, so the recommendation can be defended line by line.
6. **Data integrity**: list of flagged parts and what is wrong with each.
7. **Supplier view**: per supplier, the count and spend of parts recommended for VMI/CRP. This is the negotiation list: which suppliers to sit down with first.
8. **Export**: download the results table as CSV.

## Acceptance tests (on `sample_parts.csv` with default policy)
- 150 parts; 143 analyzable; 7 blocked; 9 with any issue
- ABC×XYZ counts: A 18/7/3, B 28/4/11, C 51/9/12 (X/Y/Z)
- Super A: 8. Trend: Flat 126, Declining 9, Ramp 8
- Recommended: Kanban 70, MRP 43, VMI 19, CRP 11; program changes 106
- Annual spend ≈ $34,652,985; inventory now ≈ $4,737,299; target ≈ $2,466,113
- Excess ≈ $2,664,467; consignment transfer ≈ $838,601
- Per-part values match `reference/expected_results.csv`

Write a small test (Node script or in-page dev check) that loads the CSV, runs the JS logic and compares against `expected_results.csv`. Do not deploy until it passes.

## Design direction
Clean and dense, like an internal ops tool done well. One accent color per program (VMI, CRP, Kanban, MRP) used consistently across the matrix, table badges and charts. No stock imagery, no emojis, no marketing hero. The summary and the matrix should be visible without scrolling on a laptop.

## v1.1 extensions (director views)
Added on top of v1. They never change the `segment.py` outputs; `test/check.mjs` must still pass unchanged.
- **Story view** (`js/story.js`): header toggle Analysis | Story, also opened with `#story`. Charts only, each with a headline computed from the data, so it follows the Policy panel live. Bars click through to the part drawer or the supplier filter.
- **Deck export** (`js/deck.js`): "Download deck (.pptx)" builds one slide per Story card, plus title, summary and a policy appendix. Charts are re-rendered in light theme at 2x for the slides. PptxGenJS 3.12.0 loads from jsdelivr only when the button is clicked. Each card also has a PNG button, and "Present" puts the Story view in fullscreen.
- **Insights** (`js/insights.js`, checked by `test/insights.mjs`). New policy parameters live under Policy → Director views:
  - **Carrying cost** = inventory value × `carrying_rate` (default 25%/yr). "Avoided" = max(0, now − target) × rate. This is the recurring P&L number. Keep it separate from excess (one-time cash) and consignment (ownership transfer).
  - **Stockout risk**: Critical = on hand < safety stock; Watch = safety stock ≤ on hand < target. Build-up = (target − on hand) × cost.
  - **E&O exposure** = max(0, on hand − last-`trend_weeks` run-rate × `eo_horizon_weeks`) × cost, only for Declining parts or parts above `eo_dos_days` days on hand.
  - **Rollout waves**: Wave 1 = everything that needs no supplier agreement (Kanban, back to MRP, right-size in place). VMI/CRP program changes go by supplier, ranked by VMI/CRP spend: suppliers whose cumulative share before them is < `wave2_share` go to Wave 2, the rest to Wave 3. `wave_months` sets the timeline labels.
  - **Scenarios**: save the current policy with its metrics (in memory, this session only), compare side by side, and apply one back. Shown in Analysis → Scenarios, in the Story view and in the deck.
- **Sales view** (`js/sales.js` logic, `js/sales-view.js` charts, checked by `test/sales.mjs`): third header toggle, also `#sales`. Same data, seen by the suppliers' sales teams: plant consumption = their sell-through, plant on-hand = their channel inventory. Projected weekly sell-in = run-rate − drawdown of stock above target (spread over `destock_weeks`, never below zero) + build-up of shortfalls (same weeks), over `sales_horizon_weeks`. No sell-in history is in the file, so sell-in is projected, and the view says so. It closes with a mapping to retail/distribution (POS sell-out, channel inventory, VMI/CRP with key accounts) for non-electronics readers. No extra data file.
- **Role layers** (header toggle Executive | Manager | Planner; `#exec` (alias `#story`), default, `#planner`). Each role sees only its layer:
  - **Executive** (Director/VP): turns and DIO now → target, working capital, service risk, pull/VMI/EDI penetration, the **value pipeline**, "Will we ship?", supplier base, then the Story cards. Sub-toggle Overview | Sell-in (`#sales`). No Policy, upload or export buttons; it follows the manager's Policy.
  - **Manager** (Supply Chain Manager): the v1 analysis plus tabs Suppliers (negotiation list + scorecard), Pipeline, MOQ & LT, Waves, Risk, Scenarios, Freshness, Data integrity. Owns the Policy panel.
  - **Planner**: action list per part (expedite, fix data, below safety stock, place PO, validate freshness claim, check forecast, use aged lot first, push out excess), ordered by urgency then value; tabs This week, Escalations (week-by-week projection), Forecast flags, Data fixes. No Policy.
- **v2 data** lives in `data_v2/` (spec in `data_v2/V2_SPEC.md`; `filesv2/` is the user's drop folder and is git-ignored). All four sections are implemented. `js/v2.js` (checked by `test/v2.mjs`) holds sections 1, 3, 4 and the executive roll-up; `js/layers.js` renders the Executive and Planner layers and the new Manager tabs.
- **Pipeline coverage** (section 1): projected = on hand + open PO (in its due week) − cumulative forecast, 13 weeks. Escalate = first short week ≤ lead time (shortage = worst shortfall inside the LT); Watch/"Place PO" = short only after the LT, with order-by week = first short week − LT. Parts without LT are listed apart. Forecast flag: avg(f01..f13) ÷ avg(last `fc_hist_weeks`) > `fc_upside` or < `fc_downside`. Export: `pipeline_escalations.csv`. Forecast CSV can be uploaded. Sample: 96 escalate (top 10 = 78% of $4.29M), 6 watch.
- **Supplier scorecard** (section 3): per supplier spend, % recommended pull (VMI/CRP/Kanban), EDI, VMI agreement, hub/3PL and contract end, OTD, terms, avg LT, open freshness claims. EDI penetration = share of spend with EDI suppliers (sample 71.9%); VMI penetration current vs recommended. Flags: VMI-recommended parts at a supplier without agreement ("negotiate agreement first"), hub contracts ending within `hub_warn_months`.
- **MOQ & LT** (section 4): MOQ > `moq_opp_weeks` × avg → value = max(0, MOQ/2 − avg × R/2) × cost. LT: A or Super A with LT > `lt_opp_min_weeks`; safety stock over the lead time z × sd × √(R + LT) recomputed with LT − `lt_cut_weeks`. "Plant" holds that buffer when the target's exposure is the part LT (MRP); otherwise "Supplier" (a negotiating point, not plant cash). Only plant value enters the value pipeline.
- **Executive roll-up**: turns = annual spend ÷ inventory; DIO = inventory ÷ (annual spend / 365) (sample 7.3 → 14.1 turns, 50 → 26 days). The value pipeline lists every initiative with type, owner, timing and status. Types (cash one-time, P&L per year, recovery, ownership transfer, risk) are subtotaled separately and **never added into one total**.
- **Freshness claims** (`js/freshness.js`, checked by `test/freshness.mjs`): Analysis → Freshness tab. Loads `data_v2/inventory_lots.csv` and `data_v2/suppliers.csv` on open; both can be replaced by upload. Date code YYWW → Monday of ISO week WW of 20YY (week 53 only in 53-week years). Analysis date fixed at 2026-11-04. Claimable = received after manufacture + rule (+ `fresh_grace_months`) calendar months → supplier claim, status Open/Escalated/Closed (session only), generated claim text, exportable CSV. Internal aging = fresh at receipt, past the rule today → ours, shown separately, never a claim. Invalid: bad date code, bad received date, date code after receipt, part not in the parts file. Supplier without a rule uses `fresh_default_rule_months`. Sample: 304 lots, 25 claimable, 18 internal aging, 0 invalid.
- **Cache busting**: every module import and the CSS/JS links in `index.html` carry `?v=N`. Before each deploy run `node scripts/release.mjs`: it runs every test and bumps N everywhere, so browsers never mix old and new files.
- **Tests**: `test/check.mjs` (reference match), `test/insights.mjs` (director-view invariants), `test/robustness.mjs` (formatted numbers, program spelling, duplicates), `test/sales.mjs` (sell-in identity), `test/freshness.mjs` (V2 freshness expected values), `test/v2.mjs` (V2 sections 1, 3, 4 and roll-up). GitHub Actions runs all six on every push (`.github/workflows/test.yml`).
- **Input tolerance**: numbers may include `$`, thousands separators or spaces. `current_program` is matched case-insensitively (`VMI/SMI` maps to VMI). Duplicate part numbers are flagged as a warning. Headers are matched case-insensitively.
- **UI conventions**: `js/format.js` holds the only number formatters. The view toggle uses `--accent` (indigo, deliberately not a program color). Text colors meet WCAG AA 4.5:1 in both themes. Clickable rows and sortable headers are keyboard-operable.

## Out of scope for v1
Supplier capacity, multi-site, forecast vs actual comparison, login, persistence beyond the session.
