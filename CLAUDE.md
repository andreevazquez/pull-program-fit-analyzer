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
- **Cache busting**: every module import and the CSS/JS links in `index.html` carry `?v=N`. Before each deploy run `node scripts/release.mjs`: it runs every test and bumps N everywhere, so browsers never mix old and new files.
- **Tests**: `test/check.mjs` (reference match), `test/insights.mjs` (director-view invariants), `test/robustness.mjs` (formatted numbers, program spelling, duplicates). GitHub Actions runs all three on every push (`.github/workflows/test.yml`).
- **Input tolerance**: numbers may include `$`, thousands separators or spaces. `current_program` is matched case-insensitively (`VMI/SMI` maps to VMI). Duplicate part numbers are flagged as a warning. Headers are matched case-insensitively.
- **UI conventions**: `js/format.js` holds the only number formatters. The view toggle uses `--accent` (indigo, deliberately not a program color). Text colors meet WCAG AA 4.5:1 in both themes. Clickable rows and sortable headers are keyboard-operable.

## Out of scope for v1
Supplier capacity, multi-site, forecast vs actual comparison, freshness/date-code rules (possible v2 tab), login, persistence beyond the session.
