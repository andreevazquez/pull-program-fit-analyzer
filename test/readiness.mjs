// Checks for js/readiness.js: which files are loaded and which views they feed.
// Usage: node test/readiness.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js?v=25";
import { readiness, FILES, READY_STATES } from "../js/readiness.js?v=25";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv");
const all = { forecast: read("data/forecast.csv"), suppliers: read("data/suppliers.csv"), lots: read("data/inventory_lots.csv"), events: read("data/supply_events.csv") };
let failures = 0;
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures++; };
const result = analyze(parts, clonePolicy());
const byKey = (R) => Object.fromEntries(R.files.map((f) => [f.key, f]));

console.log("Sample files:");
const R = readiness({ result, ...all });
const f = byKey(R);
check("one entry per file, in order", R.files.map((x) => x.key).join() === FILES.map((x) => x.key).join());
check("every state is a known state", R.files.every((x) => READY_STATES.includes(x.state)));
check("parts: partial because 7 parts are blocked by data", f.parts.state === "Partial" && f.parts.note.k === "blocked" && f.parts.note.n === 7);
check("forecast, suppliers, lots: ready", ["forecast", "suppliers", "lots"].every((k) => f[k].state === "Ready"), R.files.map((x) => `${x.key} ${x.state}`).join(", "));
check("events: partial, the sample's deliberate event for an unknown part (EV-030)", f.events.state === "Partial" && f.events.note.k === "eventsUnknown" && f.events.note.n === 1);
check("nothing blocked with every file loaded", R.blockedViews.length === 0 && R.loaded === 5);

console.log("Parts only:");
const P0 = readiness({ result });
const g = byKey(P0);
check("the four optional files show as missing", ["forecast", "suppliers", "lots", "events"].every((k) => g[k].state === "Missing" && g[k].rows === 0));
check("pipeline, what-if and freshness are listed as not running", ["pipeline", "whatif", "freshness", "scorecard"].every((v) => P0.blockedViews.includes(v)));
check("segmentation still runs", !P0.blockedViews.includes("segmentation"));

console.log("Partial matches:");
const lots = [...all.lots, { lot_id: "X-1", part_number: "NOT-A-PART", qty: "1", date_code: "2501", received_date: "2025-03-01" }];
const fc = all.forecast.slice(10);
const sup = all.suppliers.slice(1);
const Q = byKey(readiness({ result, ...all, lots, forecast: fc, suppliers: sup }));
check("a lot for an unknown part makes lots partial", Q.lots.state === "Partial" && Q.lots.note.n === 1);
check("parts without a forecast row make forecast partial", Q.forecast.state === "Partial" && Q.forecast.note.k === "partsNoFc" && Q.forecast.note.n === 10, `${Q.forecast.note?.n}`);
check("a supplier missing from the master makes suppliers partial", Q.suppliers.state === "Partial" && Q.suppliers.note.k === "supNotInMaster");
const noPo = byKey(readiness({ result, ...all, forecast: all.forecast.map((r) => ({ ...r, open_po_qty: "0" })) }));
check("a forecast without open POs says the what-if has nothing to delay", noPo.forecast.note.k === "noPo");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll readiness checks passed");
process.exit(failures ? 1 : 0);
