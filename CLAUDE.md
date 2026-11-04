# Pull Program Fit Analyzer

## What this is
A static web app that takes a list of purchased electronic components with 26 weeks of demand and recommends which pull program each part belongs in (VMI/SMI, CRP, Kanban, or stay in MRP), the target days of supply (DOS) for that program, and how much inventory the change frees up.

Audience: a Supply Chain Manager at an EMS plant (Flex-style), and hiring managers who open the link from LinkedIn. The tone is a decision tool for whoever owns purchasing policy, not a planner's lookup.

The point to make in 10 seconds: **pull programs are a portfolio decision, and the policy is explicit and adjustable.**

## Stack and constraints
- Static site, deployed to GitHub Pages. No backend, no build step required (plain HTML + JS modules are fine; Vite only if it clearly helps).
- Libraries from CDN, pinned versions: Papa Parse (CSV), Chart.js (charts). Nothing else unless necessary.
- `sample_parts.csv` loads automatically on open. The user can also upload their own CSV in the same format.
- All computation in the browser. No data leaves the page.
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

## Out of scope for v1
Supplier capacity, multi-site, forecast vs actual comparison, freshness/date-code rules (possible v2 tab), login, persistence beyond the session.
