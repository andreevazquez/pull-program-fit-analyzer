# Methodology

Every rule the analyzer applies, with its default value and where it lives in the code. Each default can be changed in the **Policy** panel (Manager view); changing it recomputes everything in the browser.

`reference/segment.py` is the source of truth for sections 1–6. `js/segment.js` is a line-for-line port, and `test/check.mjs` checks that it reproduces `reference/expected_results.csv` on the sample. `test/policy.mjs` checks each rule at its boundaries on hand-built parts.

Notation: `avg` and `sd` are the mean and **population** standard deviation (ddof = 0) of the 26 weekly demand buckets. `R` is the review period and `L` the exposure lead time, both in weeks.

---

## 1. Data integrity

| Check | Effect | Code |
|---|---|---|
| Lead time missing | **Blocks** the part from segmentation | `js/segment.js` `analyze()` |
| Unit cost ≤ 0 or blank | **Blocks** | `js/segment.js` `analyze()` |
| No demand in 26 weeks | **Blocks** | `js/segment.js` `analyze()` |
| MOQ > 8 weeks of average demand (`moq_weeks_flag`) | Warning; the part is still analyzed | `js/segment.js` `analyze()` |
| Duplicate part number | Warning (app only, not in the Python) | `js/segment.js` `analyze()` |

Blocked parts are left out of the spend ranking, so they don't shift other parts' ABC class.

## 2. ABC by annual spend

```
annual_spend = avg × 52 × unit_cost
```

Parts are sorted by annual spend, descending. Each part gets the **cumulative share before it**, so the largest part always starts at 0%.

| Class | Rule | Default | Code |
|---|---|---|---|
| A | cumulative-before < `abc_a` | 80% | `js/segment.js` `analyze()` |
| B | cumulative-before < `abc_b` | 95% | `js/segment.js` `analyze()` |
| C | otherwise | | `js/segment.js` `analyze()` |
| Super A | cumulative-before < `super_a` | 50% | `js/segment.js` `analyze()` |

Using the share *before* the part means the part that crosses 80% is still A.

## 3. XYZ by demand variability

```
CV = sd / avg          zero_share = weeks with 0 demand / 26
```

| Class | Rule | Default | Code |
|---|---|---|---|
| Z | zero_share > `zero_share_z` **or** CV ≥ `cv_y` | 30%, 1.0 | `js/segment.js` `analyze()` |
| Y | CV ≥ `cv_x` | 0.5 | `js/segment.js` `analyze()` |
| X | otherwise | | `js/segment.js` `analyze()` |

## 4. Trend

Evaluated only when zero_share ≤ 30%, because intermittent parts have no meaningful trend (`js/segment.js` `analyze()`). The rule compares the mean of the last `trend_weeks` weeks with the mean of the first `trend_weeks` weeks.

| Trend | Rule | Default | Code |
|---|---|---|---|
| Ramp | last > `trend_up` × first | 1.5× | `js/segment.js` `analyze()` |
| Declining | last < `trend_down` × first | 0.5× | `js/segment.js` `analyze()` |
| Flat | otherwise | | |

`trend_weeks` defaults to 8.

## 5. Program assignment

The trend overrides the matrix (`js/segment.js` `recommend()`, `reference/segment.py` `recommend`).

| Condition | Program | Why |
|---|---|---|
| Ramp | MRP | Demand not stable yet; revisit after the ramp |
| Declining | MRP | EOL risk: don't ask a supplier to buffer it |
| AX, LT ≥ `vmi_lt_ax` (8 wks) | VMI | High spend, stable, long lead time: the supplier holds the pipeline |
| AX, shorter LT | CRP | High spend, stable, short lead time |
| AY, LT ≥ `vmi_lt_ay` (12 wks) | VMI | Moderate variability needs a longer LT to justify VMI |
| AY, shorter LT | CRP | |
| BX, unit cost < `kanban_max_cost` ($1) | Kanban | Mid spend, stable, cheap: two-bin |
| BX, unit cost ≥ $1 | CRP | |
| BY | CRP | |
| CX, CY | Kanban | Low spend: simplest control |
| AZ, BZ, CZ | MRP | Erratic or intermittent: pull would hide the risk |

## 6. Target inventory and days of supply

Code: `js/segment.js` `computeTarget()`.

| Program | R (weeks) | L (weeks) | Floor (days) |
|---|---|---|---|
| VMI | 1 | 2 | 14 |
| CRP | 1 | 2 | 14 |
| Kanban | 2 | 2 | 21 |
| MRP | 2 | the part's own lead time | 21 |

Under VMI, CRP and Kanban the plant is exposed only for `L`, because the supplier replenishes against consumption. Under MRP the plant carries the whole lead time.

The service factor `z` depends on the ABC class: A 1.65, B 1.65, C 2.05. C parts get the highest service level because their stock is cheap and a stockout of a cheap part stops the line just the same.

```
safety  = z × sd × √(R + L)                                  js/segment.js computeTarget()
cycle   = max(avg × R, MOQ) / 2                              js/segment.js computeTarget()
floor   = floor_days × avg / 7                               js/segment.js computeTarget()
target  = max(safety + cycle, floor), rounded to a unit      js/segment.js computeTarget()
DOS     = quantity ÷ (avg / 7)   (calendar days)             js/segment.js computeTarget()
```

The part drawer shows this calculation with the part's own numbers.

## 7. Excess and consignment

```
excess                 = max(0, on_hand − target × tolerance) × unit_cost      js/segment.js computeTarget()
consignment transfer   = max(0, target − lineside_days × avg/7) × unit_cost    js/segment.js computeTarget()
                         (VMI parts only, when consignment is on)
```

`tolerance` defaults to 1.20 and `lineside_days` to 2.

These two figures are never added together. Excess is right-sizing. Consignment moves ownership of stock to the supplier, so it is not a saving.

### How the cash figures tie

The app shows three one-time cash figures. Each is one step from the previous one. The bridge is computed in `js/v2.js` `cashBridge()`, shown under the Executive value pipeline, and checked in `test/v2.mjs`.

| Step | Sample |
|---|---|
| **Excess**: stock above target × 1.20 (Manager, Planner) | $2.66M |
| + tolerance band: stock between target and target × 1.20 | $0.24M |
| = gross release: every overstocked part brought to target | $2.90M |
| − build-up: stock to buy for parts below target | $0.63M |
| = **net working capital**: inventory now − target (Executive) | $2.27M |
| + MOQ and LT projects, which lower the target itself | $0.23M |
| = **value pipeline, one-time cash** | $2.50M |

## 8. Carrying cost

```
carrying cost avoided / yr = max(0, inventory now − inventory target) × carrying_rate     js/insights.js insights()
```

`carrying_rate` defaults to 25% a year (`js/insights.js` `INSIGHT_DEFAULTS`).

This is the recurring P&L number. It is kept apart from excess, which is one-time cash, and from consignment, which is an ownership transfer.

## 9. Stockout risk, E&O and rollout waves

Code: `js/insights.js`.

**Stockout risk** (`js/insights.js` `insights()`)
- Critical: on hand < safety stock.
- Watch: safety stock ≤ on hand < target.
- Build-up = (target − on hand) × cost.

**E&O exposure** (`js/insights.js` `insights()`)
- Formula: max(0, on hand − last-8-week run-rate × `eo_horizon_weeks` (26)) × cost.
- Applies only to Declining parts, or parts above `eo_dos_days` (180) days on hand.

**Waves** (`js/insights.js` `insights()`)
- Wave 1: everything that needs no supplier agreement (Kanban, back to MRP, right-size in place).
- VMI/CRP changes are grouped by supplier, ranked by spend. Suppliers whose cumulative share before them is below `wave2_share` (70%) go to Wave 2; the rest go to Wave 3.

## 10. Pipeline coverage (expedites)

Code: `js/v2.js` `pipeline()`.

```
projected[k] = on_hand + open PO (from its due week) − cumulative forecast,   k = 1..13
```

| Status | Rule | Planner action |
|---|---|---|
| Escalate | first short week ≤ lead time (`js/v2.js` `pipeline()`) | **Expedite**: a new PO can't arrive in time |
| Watch | short only after the lead time (`js/v2.js` `pipeline()`) | **Place PO** by week = first short week − LT |
| Forecast flag | avg(next 13) ÷ avg(last 8 actual) > 1.5 or < 0.6 | **Check forecast** |

A part can be short in the pipeline and in excess at the same time. The two measures look at different things:
- Excess compares today's stock with a target sized on the 26-week average under the *recommended* program.
- The shortage comes from today's supply plan: the open PO, the current lead time and the 13-week forecast.

The Planner detail line spells out this timing split, so nobody cancels the order that covers the shortage (`js/layers.js` `plannerActions()`).

## 11. MOQ and lead-time opportunities

Code: `js/v2.js` `opportunities()`.

**MOQ**
- Applies when MOQ > `moq_opp_weeks` (4) × avg.
- Value = max(0, MOQ/2 − avg × R/2) × cost: the cycle stock the MOQ adds.

**Lead time**
- Applies to A or Super A parts with LT > `lt_opp_min_weeks` (12).
- Safety stock z × sd × √(R + LT) is recomputed with LT − `lt_cut_weeks` (4).
- Under MRP the plant holds that buffer, so the cut frees plant cash. Under VMI/CRP the supplier holds it: it is a negotiating point, not plant cash.

## 12. Freshness rule

Code: `js/freshness.js`. The analysis date is fixed at 2026-11-04 (`js/freshness.js` `ANALYSIS_DATE`).

**Date code**
- Format YYWW, read as ISO week WW of 20YY (`js/freshness.js` `parseDateCode()`).
- Manufacture date = Monday of that week.

**Rule**
- The supplier's `freshness_rule_months` (`data/suppliers.csv`).
- If the supplier has no rule: `fresh_default_rule_months` (24) (`js/freshness.js` `freshness()`).

**Outcomes**

| Outcome | Rule | Code |
|---|---|---|
| **Claimable** (supplier's responsibility) | received after manufacture + rule + `fresh_grace_months` (0) | `js/freshness.js` `freshness()` |
| **Internal aging** (ours, never a claim) | fresh at receipt, past the rule today | `js/freshness.js` `freshness()` |
| **Invalid** | bad date code, bad received date, date code after receipt, or part not in the parts file | `js/freshness.js` `freshness()` |

## 13. Exceptions: severity and escalation

Code: `js/exceptions.js` `severityOf()`.

**Severity for supply kinds**

| Severity | Rule |
|---|---|
| Critical | hit within `exc_now_weeks` (2), or inside the lead time and ≥ `exc_big_value` ($100k) |
| High | inside the lead time, or ≥ $100k |
| Medium | has a value |
| Low | otherwise |

Other kinds of impact use value only.

**SLA by severity:** 1, 3, 10 and 20 days.

**Escalation past SLA** (`js/exceptions.js` `exceptions()`)
- A planner item goes to the manager, and to the executive past twice its SLA.
- A manager item goes to the executive.

**Counts across views**
- The Manager tab and the Executive card count the whole open queue.
- The Planner tab counts only planner-owned items.
- The Planner's *This week* list has one row per part, not one per exception.

## 14. Executive roll-up

Code: `js/v2.js` `turns()`, `dio()`.

```
turns = annual spend ÷ inventory
DIO   = inventory ÷ (annual spend / 365)
```

The value pipeline subtotals each type of value separately and never adds them into one number. The types are cash one-time, P&L per year, recovery, ownership transfer and risk.
