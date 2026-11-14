// Checks for js/i18n.js and the dictionaries in js/i18n/.
// 1. en and es have the same keys, the same placeholders and the same plural shape.
// 2. Every key the code and index.html use exists.
// 3. Every sentence the engine produces (reasons, issues, errors, exception details, value pipeline)
//    matches an English template, and renders in Spanish with no leftover placeholder.
// Usage: node test/i18n.mjs   (exit code 0 = pass)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import en from "../js/i18n/en.js?v=25";
import es from "../js/i18n/es.js?v=25";
import { matchEngine, setLang, tx, tl, getLang } from "../js/i18n.js?v=25";
import { analyze, clonePolicy } from "../js/segment.js?v=25";
import { insights } from "../js/insights.js?v=25";
import { freshness } from "../js/freshness.js?v=25";
import { pipeline, scorecard, opportunities, valuePipeline } from "../js/v2.js?v=25";
import { exceptions, EXC_TYPES, STATUSES, SEVERITIES, CATEGORIES, VALUE_KINDS, resolutionCodes } from "../js/exceptions.js?v=25";
import { VALUE_TYPES } from "../js/v2.js?v=25";
import { parseCSV } from "./csv.mjs";
import { IMPACTS } from "../js/whatif.js?v=25";
import { PROPOSAL_STATUSES } from "../js/proposal.js?v=25";
import { READY_STATES, FILES } from "../js/readiness.js?v=25";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `\n       ${detail}` : ""}`); if (!ok) failures++; };

/* ---------- 1. parity ---------- */
console.log("Dictionary parity:");
const holes = (s) => [...String(s).matchAll(/\{(\w+)(?::\w+)?\}/g)].map((m) => m[1]).sort().join(",");
const shape = (v) => (typeof v === "object" ? Object.keys(v).sort().join("|") : "string");
const onlyEn = Object.keys(en).filter((k) => !(k in es)), onlyEs = Object.keys(es).filter((k) => !(k in en));
check(`same keys (${Object.keys(en).length})`, !onlyEn.length && !onlyEs.length, `only en: ${onlyEn.join(", ")} · only es: ${onlyEs.join(", ")}`);
const badShape = Object.keys(en).filter((k) => k in es && shape(en[k]) !== shape(es[k]));
check("same plural shape", !badShape.length, badShape.join(", "));
const badHoles = Object.keys(en).filter((k) => k in es && shape(en[k]) === shape(es[k])).filter((k) => {
  const forms = typeof en[k] === "object" ? Object.keys(en[k]) : [null];
  return forms.some((f) => holes(f ? en[k][f] : en[k]) !== holes(f ? es[k][f] : es[k]));
});
check("same placeholders", !badHoles.length, badHoles.join(", "));
const empty = Object.entries(es).filter(([, v]) => (typeof v === "object" ? Object.values(v) : [v]).some((s) => !String(s).trim()));
check("no empty Spanish strings", !empty.length, empty.map(([k]) => k).join(", "));
// Glossary: supply chain terms stay in English in the Spanish text.
const esText = Object.values(es).flatMap((v) => (typeof v === "object" ? Object.values(v) : [v])).join("\n");
const banned = [/inventario de seguridad/i, /tiempo de entrega/i, /pronóstico/i, /orden de compra/i, /costo de mantener/i];
check("glossary: safety stock, lead time, forecast, PO, carrying cost stay in English", banned.every((re) => !re.test(esText)), banned.filter((re) => re.test(esText)).join(" "));

/* ---------- 2. keys used in code ---------- */
console.log("Keys used in code:");
const files = readdirSync(join(root, "js")).filter((f) => f.endsWith(".js")).map((f) => join(root, "js", f)).concat(join(root, "index.html"));
const used = new Set();
for (const f of files) {
  const s = readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "");
  for (const m of s.matchAll(/\b(?:t|tr|th)\(\s*"([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/\b(?:t|tr)\(\s*[^"()]+?\?\s*"([\w.]+)"\s*:\s*"([\w.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of s.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(";")) used.add(p.split(":")[1].trim());
}
const missing = [...used].filter((k) => !(k in en));
check(`${used.size} literal keys exist`, !missing.length, missing.join(", "));
// Keys built at run time.
const P0 = clonePolicy();
const dyn = [
  ...["expedite", "fix", "build", "po", "claim", "forecast", "aging", "excess"].map((k) => `act.${k}`),
  ...[1, 2, 3].map((n) => `wave.what.${n}`),
  ...["lots", "forecast", "events", "suppliers"].map((k) => `notice.kind.${k}`),
  ...["abc", "xyz", "trend", "rules", "z", "excess", "director", "fresh", "pipe", "opps", "exc", "sales"].map((k) => `polg.${k}`),
  ...Object.keys(P0).filter((k) => typeof P0[k] === "number").map((k) => `pol.${k}`),
  "pol.z.A", "pol.z.B", "pol.z.C",
  ...["pull_share_rec", "program_changes", "inv_target", "inv_reduction", "excess", "consignment", "carrying_avoided", "critical", "risk_build", "eo_value"].map((k) => `scenRow.${k}`),
  ...["part_number", "commodity", "supplier", "abc", "xyz", "trend", "current_program", "recommended_program", "reason", "annual_spend", "dos_current", "dos_target", "excess_value"].map((k) => `col.${k}`),
  ...["Flat", "Ramp", "Declining"].map((v) => `trend.${v}`),
  ...["Open", "Escalated", "Closed"].map((v) => `claimSt.${v}`),
  ...SEVERITIES.map((v) => `sev.${v}`), ...STATUSES.map((v) => `xst.${v}`), ...CATEGORIES.map((v) => `cat.${v}`),
  ...VALUE_KINDS.map((v) => `kind.${v}`), ...VALUE_TYPES.map((v) => `vtype.${v}`),
  ...["Planner", "Manager", "Executive"].map((v) => `owner.${v}`), "holder.Plant", "holder.Supplier", ...IMPACTS.map((v) => `wi.imp.${v}`), ...PROPOSAL_STATUSES.flatMap((v) => [`pr.st.${v}`, `pr.review.${v}`]), ...READY_STATES.map((v) => `ready.st.${v}`), ...FILES.flatMap((f) => f.feeds.map((v) => `ready.v.${v}`)), ...["blocked", "noPo", "partsNoFc", "openPo", "supNotInMaster", "noOtd", "lotsUnknown", "eventsUnknown"].map((k) => `ready.n.${k}`),
  ...Object.values(EXC_TYPES).map((x) => `exc.t.${x.label}`), ...Object.values(EXC_TYPES).map((x) => `exc.a.${x.action}`),
  ...[...new Set(CATEGORIES.flatMap((c) => resolutionCodes(c)))].map((v) => `res.${v}`),
];
const missingDyn = dyn.filter((k) => !(k in en));
check(`${dyn.length} run-time keys exist (enum values, policy fields, tabs)`, !missingDyn.length, missingDyn.join(", "));

/* ---------- 3. engine sentences ---------- */
console.log("Engine sentences:");
const read = (f) => parseCSV(readFileSync(join(root, f), "utf8"));
const parts = read("data/sample_parts.csv"), fc = read("data/forecast.csv"), sup = read("data/suppliers.csv"), lots = read("data/inventory_lots.csv"), events = read("data/supply_events.csv");
// Edge rows so every error message appears at least once.
const badLots = [
  { lot_id: "X1", part_number: parts[0].part_number, date_code: "12AB", received_date: "2026-01-05", qty: "10" },
  { lot_id: "X2", part_number: parts[0].part_number, date_code: "", received_date: "2026-01-05", qty: "10" },
  { lot_id: "X3", part_number: parts[0].part_number, date_code: "2599", received_date: "2026-01-05", qty: "10" },
  { lot_id: "X4", part_number: parts[0].part_number, date_code: "2153", received_date: "2026-01-05", qty: "10" },
  { lot_id: "X5", part_number: parts[0].part_number, date_code: "2510", received_date: "05/01/2026", qty: "10" },
  { lot_id: "X6", part_number: parts[0].part_number, date_code: "2510", received_date: "", qty: "10" },
  { lot_id: "X7", part_number: parts[0].part_number, date_code: "2650", received_date: "2026-01-05", qty: "10" },
  { lot_id: "X8", part_number: "NOPE-1", date_code: "2510", received_date: "2026-01-05", qty: "10" },
];
const ev0 = events[0];
const badEvents = [
  { ...ev0, event_id: "" }, { ...ev0 }, { ...ev0, event_id: "B3", event_type: "meteor" }, { ...ev0, event_id: "B4", part_number: "NOPE-1" },
  { ...ev0, event_id: "B5", part_number: "" }, { ...ev0, event_id: "B6", announced_date: "soon" }, { ...ev0, event_id: "B7", announced_date: "2027-01-01" },
  { ...ev0, event_id: "B8", effective_date: "later" }, { ...ev0, event_id: "B9", event_type: "price", value: "" },
  { ...ev0, event_id: "B10", event_type: "price", value: "0.5" }, { ...ev0, event_id: "B11", event_type: "lead_time", value: String((+parts[0].lead_time_weeks || 4) + 1) },
];
const extraParts = [...parts, { ...parts[1] }]; // a duplicate part number

const seen = new Map(); // prefix -> Set(text)
const add = (prefix, text) => { if (text == null || text === "") return; if (!seen.has(prefix)) seen.set(prefix, new Set()); seen.get(prefix).add(String(text)); };
for (const [P, partsIn, lotsIn, evIn] of [
  [clonePolicy(), extraParts, [...lots, ...badLots], [...events, ...badEvents]],
  [Object.assign(clonePolicy(), { consignment: false }), parts, lots, events],
  [Object.assign(clonePolicy(), { trend_up: 1.1, trend_down: 0.9, moq_weeks_flag: 2 }), parts, lots, events],
]) {
  const res = analyze(partsIn, P), I = insights(res, P), F = freshness(lotsIn, sup, res.parts, P);
  const pipe = pipeline(res.parts, fc, P), score = scorecard(res, sup, F, P), opps = opportunities(res, P);
  const X = exceptions({ result: res, insights: I, pipe, fresh: F, score, events: evIn, P });
  const V = valuePipeline({ result: res, insights: I, pipe, fresh: F, score, opps, P });
  for (const p of res.parts) { add("reason.", p.reason); for (const m of p.issues) add("issue.", m); }
  for (const e of I.eo) add("why.", e.why);
  for (const l of F.invalid) for (const e of l.errors) add("err.", e);
  for (const e of X.events.invalid) for (const m of e.errors) add("evErr.", m);
  for (const e of X.events.belowThreshold) add("evErr.", e.why);
  for (const x of X.items) add("exc.d.", x.detail);
  for (const l of V.lines) { add("vp.i.", l.initiative); add("vp.owner.", l.owner); add("vp.when.", l.when); add("vp.status.", l.status); }
}
for (const w of ["Months 0–3", "Months 3–6"]) add("vp.when.", w);
// Sentences the sample data doesn't produce, written as the engine would write them.
for (const [p, s] of [
  ["reason.", "High spend, stable, short LT"], ["why.", "Slow mover, 412 days on hand"], ["evErr.", "Needs a positive value (duty %)"],
  ["exc.d.", "Next 13 weeks new demand vs no recent actuals (upside)"], ["exc.d.", "Next 13 weeks new demand vs no recent actuals (downside)"],
  ["exc.d.", "Hub Norte contract expired 2026-10-31"],
  ["exc.d.", "Lead time 8 → 14 weeks: orders go out 6 weeks earlier (1,200 more units in the pipeline). Short from week 9, now inside the new lead time"],
  ["exc.d.", "500 of 4,000 on hand quarantined: the rest still covers 13 weeks"], ["exc.d.", "No open PO inside 13 weeks to delay; confirm with the supplier"],
  ["exc.d.", "Open PO 2,000 moves from week 6 to beyond the 13-week horizon: still covered"], ["vp.i.", "Wave 2: VMI/CRP with no supplier"],
]) add(p, s);
for (const v of ["allocation %", "duty %", "increase %", "new lead time (weeks)", "quantity held", "delay (weeks)"]) add("need.", v);

const unmatched = [];
let total = 0;
const hitKeys = new Set();
for (const [prefix, set] of seen) for (const s of set) {
  total++;
  const hit = matchEngine(prefix, s);
  if (!hit || (prefix === "exc.d." && hit.key === "exc.d.data" && !s.split("; ").every((x) => matchEngine("issue.", x)))) unmatched.push(`${prefix} ${s}`);
  else hitKeys.add(hit.key);
}
check(`${total} distinct engine sentences match an English template`, !unmatched.length, unmatched.slice(0, 12).join("\n       "));
const engineKeys = Object.keys(en).filter((k) => /^(reason|issue|why|err|evErr|need|exc\.d|vp\.(i|owner|when|status))\./.test(k));
const never = engineKeys.filter((k) => !hitKeys.has(k));
console.log(`  info ${engineKeys.length - never.length}/${engineKeys.length} engine templates exercised by the sample and edge cases${never.length ? ` (not hit: ${never.join(", ")})` : ""}`);

await setLang("es");
check("setLang works without a browser", getLang() === "es");
const leftovers = [], untranslated = [];
for (const [prefix, set] of seen) for (const s of set) {
  const out = tx(prefix, s);
  if (/\{\w+(?::\w+)?\}/.test(out)) leftovers.push(out);
  const hit = matchEngine(prefix, s);
  const esVal = hit && es[hit.key], enVal = hit && en[hit.key];
  if (hit && JSON.stringify(esVal) !== JSON.stringify(enVal) && out === s) untranslated.push(`${prefix} ${s}`);
}
check("Spanish renders with no leftover placeholders", !leftovers.length, leftovers.slice(0, 5).join("\n       "));
check("every matched engine sentence comes out in Spanish", !untranslated.length, untranslated.slice(0, 8).join("\n       "));
check("nested lists translate (issues inside exception detail)", /Falta el lead time/.test(tx("exc.d.", "Missing lead time; Zero/blank cost (kept out of the analysis)")));
check("compact money in Spanish gets a space ($1.20 M)", tx("exc.d.", "5.0% increase on $1.20M/yr of spend from 2026-12-01") === "5.0% de aumento sobre $1.20\u00a0M/año de gasto desde 2026-12-01");
check("plural picks the form (1 part vs 2 parts)", tl("es", "st.nParts", { n: 1 }) === "1 parte" && tl("es", "st.nParts", { n: 2 }) === "2 partes");
check("es-MX numbers: comma thousands, dot decimals", tl("es", "common.showingOf", { shown: 1234, total: 5000.5 }).includes("1,234") && tl("es", "common.showingOf", { shown: 1, total: 5000 }).includes("5,000"));
await setLang("en");
check("English text passes through unchanged", tx("exc.d.", "Missing lead time") === "Missing lead time");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll i18n checks passed");
process.exit(failures ? 1 : 0);
