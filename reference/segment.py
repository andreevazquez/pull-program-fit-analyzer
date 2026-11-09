"""Reference implementation of the Pull Program Fit Analyzer logic.
The JS app must reproduce these results on sample_parts.csv (see CLAUDE.md, Acceptance tests).
Run: python reference/segment.py  ->  writes reference/expected_results.csv and prints summary."""
import pandas as pd, numpy as np, os

P = dict(  # policy parameters (defaults; editable in the app)
    abc_a=0.80, abc_b=0.95, super_a=0.50,      # cumulative annual-spend cutoffs
    cv_x=0.5, cv_y=1.0, zero_share_z=0.30,     # variability cutoffs
    trend_up=1.5, trend_down=0.5, trend_weeks=8,
    vmi_lt_ax=8, vmi_lt_ay=12, kanban_max_cost=1.0,
    z={"A": 1.65, "B": 1.65, "C": 2.05},
    review={"VMI": 1, "CRP": 1, "Kanban": 2, "MRP": 2},       # R, weeks
    exposure={"VMI": 2, "CRP": 2, "Kanban": 2, "MRP": None},  # L, weeks (None = part lead time)
    floor_days={"VMI": 14, "CRP": 14, "Kanban": 21, "MRP": 21},
    tolerance=1.20,            # inventory above target*tolerance counts as excess
    moq_weeks_flag=8, consignment=True, lineside_days=2,
)

here = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(os.path.join(here, "..", "data", "sample_parts.csv"))
wk = [c for c in df.columns if c[0] == "w" and c[1:].isdigit()]
D = df[wk].astype(float)
df["avg_weekly"] = D.mean(axis=1)
df["sd_weekly"] = D.std(axis=1, ddof=0)            # population std
df["cv"] = np.where(df.avg_weekly > 0, df.sd_weekly / df.avg_weekly, np.nan)
df["zero_share"] = (D == 0).mean(axis=1)
df["lt_wk"] = pd.to_numeric(df.lead_time_weeks, errors="coerce")

issues = pd.Series([[] for _ in range(len(df))])
for m, msg in [(df.lt_wk.isna(), "Missing lead time"), (df.unit_cost_usd <= 0, "Zero/blank cost"),
               (df.avg_weekly == 0, "No demand in 26 wks")]:
    for i in df.index[m]: issues[i].append(msg)
for i in df.index[(df.avg_weekly > 0) & (df.moq > P["moq_weeks_flag"] * df.avg_weekly)]:
    issues[i].append("MOQ > 8 wks of demand")
df["data_issues"] = issues.apply("; ".join)
blocking = df.lt_wk.isna() | (df.unit_cost_usd <= 0) | (df.avg_weekly == 0)

s = df[~blocking].copy()
s["annual_spend"] = s.avg_weekly * 52 * s.unit_cost_usd
s = s.sort_values("annual_spend", ascending=False)
s["cum_before"] = (s.annual_spend.cumsum() - s.annual_spend) / s.annual_spend.sum()
s["abc"] = np.select([s.cum_before < P["abc_a"], s.cum_before < P["abc_b"]], ["A", "B"], "C")
s["super_a"] = s.cum_before < P["super_a"]
s["xyz"] = np.select([(s.zero_share > P["zero_share_z"]) | (s.cv >= P["cv_y"]), s.cv >= P["cv_x"]], ["Z", "Y"], "X")
first = D.loc[s.index, wk[:P["trend_weeks"]]].mean(axis=1)
last = D.loc[s.index, wk[-P["trend_weeks"]:]].mean(axis=1)
s["trend"] = np.select([(s.zero_share <= P["zero_share_z"]) & (last > P["trend_up"] * first),
                        (s.zero_share <= P["zero_share_z"]) & (last < P["trend_down"] * first)],
                       ["Ramp", "Declining"], "Flat")

def recommend(r):
    if r.trend == "Ramp": return "MRP", "Ramp-up: demand not stable yet, keep in MRP and revisit"
    if r.trend == "Declining": return "MRP", "Declining/EOL risk: don't commit a supplier to buffer it"
    k = r.abc + r.xyz
    if k == "AX": return ("VMI", "High spend, stable demand, long LT") if r.lt_wk >= P["vmi_lt_ax"] else ("CRP", "High spend, stable, short LT")
    if k == "AY": return ("VMI", "High spend, moderate variability, LT >= 12 wks") if r.lt_wk >= P["vmi_lt_ay"] else ("CRP", "High spend, moderate variability")
    if k == "BX": return ("Kanban", "Mid spend, stable, low unit cost") if r.unit_cost_usd < P["kanban_max_cost"] else ("CRP", "Mid spend, stable, higher unit cost")
    if k == "BY": return "CRP", "Mid spend, moderate variability"
    if k in ("CX", "CY"): return "Kanban", "Low spend: simplest control, two-bin"
    return "MRP", "Erratic/intermittent demand: pull would hide risk"
s[["recommended_program", "reason"]] = s.apply(lambda r: pd.Series(recommend(r)), axis=1)

def target(r):
    prog = r.recommended_program
    R = P["review"][prog]; L = P["exposure"][prog] or r.lt_wk
    ss = P["z"][r.abc] * r.sd_weekly * np.sqrt(R + L)
    cycle = max(r.avg_weekly * R, r.moq) / 2
    return max(ss + cycle, P["floor_days"][prog] * r.avg_weekly / 7)
s["target_qty"] = s.apply(target, axis=1).round(0)
daily = s.avg_weekly / 7
s["dos_current"] = (s.on_hand_qty / daily).round(1)
s["dos_target"] = (s.target_qty / daily).round(1)
s["inv_value_current"] = (s.on_hand_qty * s.unit_cost_usd).round(2)
s["inv_value_target"] = (s.target_qty * s.unit_cost_usd).round(2)
s["excess_value"] = ((s.on_hand_qty - s.target_qty * P["tolerance"]).clip(lower=0) * s.unit_cost_usd).round(2)
vmi = s.recommended_program == "VMI"
s["consignment_transfer_value"] = np.where(vmi & P["consignment"],
    ((s.target_qty - daily * P["lineside_days"]).clip(lower=0)) * s.unit_cost_usd, 0).round(2)
s["program_change"] = s.recommended_program != s.current_program

out = df[["part_number", "data_issues"]].merge(s[["part_number", "abc", "super_a", "xyz", "trend", "cv", "zero_share",
    "annual_spend", "current_program", "recommended_program", "reason", "program_change", "target_qty",
    "dos_current", "dos_target", "inv_value_current", "inv_value_target", "excess_value",
    "consignment_transfer_value"]], on="part_number", how="left")
out.round(4).to_csv(os.path.join(here, "expected_results.csv"), index=False)

print("Parts:", len(df), "| analyzable:", len(s), "| blocked by data:", int(blocking.sum()), "| with any issue:", int((df.data_issues != "").sum()))
print("ABC x XYZ:\n", pd.crosstab(s.abc, s.xyz))
print("Super A:", int(s.super_a.sum()), "| Trend:", s.trend.value_counts().to_dict())
print("Recommended:", s.recommended_program.value_counts().to_dict(), "| program changes:", int(s.program_change.sum()))
print(f"Annual spend ${s.annual_spend.sum():,.0f} | Inv now ${s.inv_value_current.sum():,.0f} | Target ${s.inv_value_target.sum():,.0f}")
print(f"Excess (above target x{P['tolerance']}) ${s.excess_value.sum():,.0f} | Consignment transfer ${s.consignment_transfer_value.sum():,.0f}")
print(s.groupby("recommended_program")[["inv_value_current", "excess_value", "dos_target"]].agg({"inv_value_current": "sum", "excess_value": "sum", "dos_target": "median"}).round(0))
