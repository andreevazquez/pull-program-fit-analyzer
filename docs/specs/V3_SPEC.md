# V3: Exceptions inbox

Management by exception: the app watches every part, and people only see what broke a rule.
Logic in `js/exceptions.js`, checked by `test/exceptions.mjs`. Synthetic data, fictional parts and suppliers.

## Sources

1. **Detected** from the data already loaded (no new file):

| Type | Rule | Owner | Value kind |
|---|---|---|---|
| Shortage inside lead time | pipeline Escalate | Planner | Supply at risk |
| Place PO | pipeline Watch, weeks to impact = order-by week, at most High | Planner | Supply at risk |
| Below safety stock | on hand < safety stock | Planner | Supply at risk |
| Forecast swing | pipeline forecast flag; value = abs(forecast 13 wk − history × 13) × cost | Planner | Supply (upside) / Inventory (downside) at risk |
| Freshness claim | claimable lot; status follows the Freshness tab | Planner | Recovery |
| Aged lot | internal aging | Planner | Inventory at risk |
| E&O exposure | insights E&O | Manager | Inventory at risk |
| Bad data | part master issue (blocking = at least Medium) or invalid lot | Planner | — |
| VMI without agreement | per supplier; value = inventory release on those parts | Manager | Cash blocked |
| Hub contract ending | within `hub_warn_months` | Manager | — |
| Supplier OTD below target | `otd_pct` < `exc_otd_min`; value = shortages at that supplier | Manager | Supply at risk |

2. **Events**: `data_v3/supply_events.csv`, replaceable by upload.

`event_id, event_type, part_number, supplier, announced_date, effective_date, value, detail`

| event_type | value | Impact |
|---|---|---|
| EOL | — | last-time buy = max(0, avg × `exc_ltb_weeks` − on hand − open PO) × cost (Cash to commit); weeks to impact = weeks to the last order date |
| PCN | — | 13 weeks of supply × cost to qualify (Supply at risk) |
| Allocation | % of orders confirmed | 13-week projection with the open PO × %; value = extra shortage × cost |
| Tariff | duty % | annual spend × % (Cost increase / yr) |
| Price increase | % | annual spend × %, only from `exc_price_pct` |
| LT increase | new lead time, weeks | only from `exc_lt_jump_weeks` added; avg × weeks added × cost (Cash to commit) |
| Quality hold | qty held | projection with on hand − held; extra shortage (Supply at risk), else held stock (Inventory at risk) |
| Shipment delay | weeks | projection with the open PO moved; beyond week 13 it drops out |

Invalid (listed, not raised): unknown type, part not in the parts file, bad or future announced date, bad effective date, missing value where one is needed, duplicate id.

## Severity, SLA, escalation

- Supply kinds (Supply at risk, Cash to commit): **Critical** if hit within `exc_now_weeks` with value, or inside the lead time and ≥ `exc_big_value`; **High** if inside the lead time, or ≥ `exc_big_value`; **Medium** with value; **Low** without.
- Other kinds: value only (≥ `exc_big_value` High, > 0 Medium, else Low).
- SLA days by severity (`sla_*_days`). Opened = announced date for events, the analysis date (2026-11-04) for detected items.
- Past SLA moves one level up: a planner item goes to the Manager, and to the Executive past twice its SLA; a manager item goes to the Executive.
- Status Open / In progress / Resolved / Risk accepted with a resolution code, session only.

## Layers

- **Planner**: Exceptions tab with the planner-owned queue.
- **Manager**: Exceptions tab with the full queue, impact by kind, repeats by supplier and parts with `exc_repeat`+ kinds of exception ("review the program"), plus the events not raised.
- **Executive**: counts and impact by category, plus the items that need a director (escalated to Executive, or Critical with the manager).

Value kinds are different money and are never added into one total.

## Sample values (default policy)

32 events: 29 valid, 3 invalid (EV-030, EV-031, EV-032), 2 below threshold (EV-015, EV-020).
241 exceptions: 20 Critical, 135 High, 78 Medium, 8 Low; 18 past SLA; 17 need a director.
