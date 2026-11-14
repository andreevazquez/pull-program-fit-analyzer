// Data readiness: for each input file, is it loaded, how well does it match the parts file, and which
// views it feeds. Lets someone with their own data see what will and won't run before reading results.
// Pure functions, no DOM.

const key = (v) => String(v ?? "").trim();
const has = (rows, col) => rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], col);

// FEEDS: view keys each file unlocks (labels live in the dictionaries under ready.v.*).
export const FILES = [
  { key: "parts", file: "sample_parts.csv", required: true, feeds: ["segmentation", "policy", "suppliers", "waves", "risk", "scenarios", "executive", "proposal"] },
  { key: "forecast", file: "forecast.csv", feeds: ["pipeline", "whatif", "planner", "forecastFlags"] },
  { key: "suppliers", file: "suppliers.csv", feeds: ["scorecard", "proposalAsks", "freshnessRules", "supplierExceptions"] },
  { key: "lots", file: "inventory_lots.csv", feeds: ["freshness", "aging"] },
  { key: "events", file: "supply_events.csv", feeds: ["supplyEvents"] },
];
export const READY_STATES = ["Ready", "Partial", "Missing"];

// input: { result, forecast, suppliers, lots, events } (rows as parsed); labels: { parts, forecast, ... } file names.
export function readiness({ result, forecast = [], suppliers = [], lots = [], events = [] }, labels = {}) {
  const partSet = new Set((result?.parts || []).map((p) => p.part_number));
  const analyzed = result?.analyzed?.length || 0;
  const supSet = new Set((result?.analyzed || []).map((p) => p.supplier).filter(Boolean));
  const out = [];

  {
    const n = result?.parts?.length || 0, blocked = n - analyzed;
    out.push({ key: "parts", rows: n, matched: analyzed, of: n, state: analyzed ? (blocked ? "Partial" : "Ready") : "Missing", note: blocked ? { k: "blocked", n: blocked } : null });
  }
  {
    const pn = new Set(forecast.map((r) => key(r.part_number)));
    const matched = [...partSet].filter((p) => pn.has(p)).length;
    const po = forecast.filter((r) => Number(String(r.open_po_qty ?? "").replace(/[$,\s]/g, "")) > 0).length;
    const st = !forecast.length ? "Missing" : matched === partSet.size ? "Ready" : matched ? "Partial" : "Missing";
    out.push({ key: "forecast", rows: forecast.length, matched, of: partSet.size, state: st,
      note: !forecast.length ? null : !po ? { k: "noPo" } : matched < partSet.size ? { k: "partsNoFc", n: partSet.size - matched } : { k: "openPo", n: po } });
  }
  {
    const names = new Set(suppliers.map((r) => key(r.supplier)));
    const matched = [...supSet].filter((s) => names.has(s)).length;
    const st = !suppliers.length ? "Missing" : matched === supSet.size ? "Ready" : matched ? "Partial" : "Missing";
    out.push({ key: "suppliers", rows: suppliers.length, matched, of: supSet.size, state: st,
      note: suppliers.length && matched < supSet.size ? { k: "supNotInMaster", n: supSet.size - matched } : (suppliers.length && !has(suppliers, "otd_pct") ? { k: "noOtd" } : null) });
  }
  {
    const matched = lots.filter((r) => partSet.has(key(r.part_number))).length;
    const st = !lots.length ? "Missing" : matched === lots.length ? "Ready" : matched ? "Partial" : "Missing";
    out.push({ key: "lots", rows: lots.length, matched, of: lots.length, state: st, note: lots.length && matched < lots.length ? { k: "lotsUnknown", n: lots.length - matched } : null });
  }
  {
    const matched = events.filter((r) => !key(r.part_number) || partSet.has(key(r.part_number))).length;
    const st = !events.length ? "Missing" : matched === events.length ? "Ready" : matched ? "Partial" : "Missing";
    out.push({ key: "events", rows: events.length, matched, of: events.length, state: st, note: events.length && matched < events.length ? { k: "eventsUnknown", n: events.length - matched } : null });
  }

  const files = out.map((f) => ({ ...FILES.find((x) => x.key === f.key), ...f, label: labels[f.key] || "" }));
  const blockedViews = files.filter((f) => f.state === "Missing").flatMap((f) => f.feeds);
  const partialViews = files.filter((f) => f.state === "Partial").flatMap((f) => f.feeds);
  return { files, ready: files.filter((f) => f.state === "Ready").length, loaded: files.filter((f) => f.state !== "Missing").length, total: files.length, blockedViews, partialViews };
}
