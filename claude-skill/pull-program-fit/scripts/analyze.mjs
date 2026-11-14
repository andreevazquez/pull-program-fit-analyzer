#!/usr/bin/env node
// Pull Program Fit Analyzer, command-line version for the Claude skill.
// Runs the same engine as https://andreevazquez.github.io/pull-program-fit-analyzer/ (scripts/engine/ is a
// generated copy of the app's js/ modules) and writes CSVs plus a Markdown summary for review.
//
// Usage:
//   node scripts/analyze.mjs <parts.csv> [--forecast f.csv] [--suppliers s.csv] [--lots l.csv] [--events e.csv]
//        [--policy policy.json] [--whatif "Supplier name" [--weeks 2]] [--proposal "Supplier name"] [--out dir]
//   node scripts/analyze.mjs --sample            (runs on the bundled sample files)
// Nothing is sent anywhere and no system of record is changed: the output is for a person to review.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { parseCSV } from "./engine/csv.js";
import { analyze, clonePolicy, RESULT_COLUMNS, resultRow, PROGRAMS } from "./engine/segment.js";
import { insights } from "./engine/insights.js";
import { freshness } from "./engine/freshness.js";
import { pipeline, scorecard, opportunities, executive, ESCALATION_COLUMNS, escalationRow } from "./engine/v2.js";
import { exceptions, isOpen } from "./engine/exceptions.js";
import { delayCandidates, delayScenario, WHATIF_COLUMNS, whatifRow } from "./engine/whatif.js";
import { proposalCandidates, proposal, PROPOSAL_COLUMNS, proposalRow } from "./engine/proposal.js";
import { readiness } from "./engine/readiness.js";
import { normalizeHeader, canonicalRows } from "./engine/headers.js";

const here = dirname(fileURLToPath(import.meta.url));

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name) => argv.includes(`--${name}`);
const valued = new Set(["forecast", "suppliers", "lots", "events", "policy", "whatif", "weeks", "proposal", "out"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && valued.has(argv[i - 1].slice(2))));
const sample = flag("sample");
const asset = (f) => join(here, "..", "assets", f);
const partsPath = sample ? asset("sample_parts.csv") : positional[0];
if (!partsPath || flag("help")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(partsPath ? 0 : 1);
}
const paths = {
  forecast: opt("forecast") ?? (sample ? asset("forecast.csv") : undefined),
  suppliers: opt("suppliers") ?? (sample ? asset("suppliers.csv") : undefined),
  lots: opt("lots"), events: opt("events"),
};
const outDir = opt("out") || "ppfa-output";

/* ---------- read ---------- */
function readCsv(path, { canonical = false } = {}) {
  if (!existsSync(path)) { console.error(`File not found: ${path}`); process.exit(2); }
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const raw = parseCSV(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normalizeHeader(k), v])));
  return canonical ? canonicalRows(raw) : { rows: raw, renamed: [], converted: null };
}
const partsIn = readCsv(partsPath, { canonical: true });
const REQUIRED = ["part_number", "unit_cost_usd", "lead_time_weeks", "moq", "current_program", "on_hand_qty"];
const fields = partsIn.rows.length ? Object.keys(partsIn.rows[0]) : [];
const missing = REQUIRED.filter((c) => !fields.includes(c));
if (!fields.some((f) => /^w\d+$/.test(f))) missing.push("w01..w26 (weekly demand)");
if (missing.length) {
  console.error(`${basename(partsPath)} is missing columns: ${missing.join(", ")}.\nSee SKILL.md "Input" for the format and accepted header names.`);
  process.exit(2);
}
const rows = partsIn.rows.filter((r) => String(r.part_number ?? "").trim() !== "");
const extra = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, p ? readCsv(p).rows : []]));

const P = clonePolicy();
if (opt("policy")) {
  const o = JSON.parse(readFileSync(opt("policy"), "utf8"));
  for (const [k, v] of Object.entries(o)) {
    if (!(k in P)) { console.error(`Unknown policy parameter: ${k}`); process.exit(2); }
    P[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...P[k], ...v } : v;
  }
}

/* ---------- compute (same calls as the web app) ---------- */
const result = analyze(rows, P);
const S = result.summary;
const ins = insights(result, P);
const fresh = freshness(extra.lots, extra.suppliers, result.parts, P);
const pipe = pipeline(result.parts, extra.forecast, P);
const score = scorecard(result, extra.suppliers, fresh, P);
const opps = opportunities(result, P);
const E = executive({ result, insights: ins, pipe, score });
const X = exceptions({ result, insights: ins, pipe, fresh, score, events: extra.events, P });
const R = readiness({ result, ...extra }, { parts: basename(partsPath), ...Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, p ? basename(p) : ""])) });

/* ---------- format ---------- */
const usd = (v) => (Number.isFinite(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const M = (v) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${Math.round(v / 1e3)}k` : usd(v));
const pct = (v) => `${Math.round(v * 100)}%`;
const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, body) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (name, cols, data) => { writeFileSync(join(outDir, name), [cols, ...data].map((r) => r.map(csvCell).join(",")).join("\n") + "\n"); written.push(name); };
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const written = [];
const plural = (n, one, other) => `${n} ${n === 1 ? one : other}`;
const NOTES = {
  blocked: (n) => `${plural(n, "part", "parts")} blocked by data`, noPo: () => "no open POs: nothing for a delay what-if",
  partsNoFc: (n) => `${plural(n, "part has", "parts have")} no forecast row`, openPo: (n) => `${plural(n, "open PO", "open POs")}`,
  supNotInMaster: (n) => `${plural(n, "supplier", "suppliers")} not in the master`, noOtd: () => "no otd_pct column",
  lotsUnknown: (n) => `${plural(n, "lot", "lots")} for parts not in the parts file`, eventsUnknown: (n) => `${plural(n, "event", "events")} for parts not in the parts file`,
};
mkdirSync(outDir, { recursive: true });

/* ---------- outputs ---------- */
const RESULT_OUT = ["part_number", "description", "commodity", "supplier", ...RESULT_COLUMNS.slice(1)];
writeCsv("results.csv", RESULT_OUT, result.parts.map((p) => { const r = { description: p.description, commodity: p.commodity, supplier: p.supplier, ...resultRow(p) }; return RESULT_OUT.map((c) => r[c]); }));
if (extra.forecast.length) writeCsv("expedites.csv", ESCALATION_COLUMNS, [...pipe.escalate, ...pipe.watch].map(escalationRow));

const md = [];
md.push(`# Pull program fit: ${basename(partsPath)}`, "");
md.push("Recommendations for the supply chain manager to review. Nothing was sent to a supplier or changed in any system.", "");
const changedPolicy = opt("policy") ? `Policy overrides from ${basename(opt("policy"))}.` : "Default policy (see references/METHODOLOGY.md).";
md.push(changedPolicy, "");

md.push("## Data", "", table(["File", "Status", "Rows", "Matched", "Note"], R.files.map((f) => [f.label || f.file, f.state, f.rows, f.of ? `${f.matched}/${f.of}` : "—", f.note ? NOTES[f.note.k](f.note.n) : ""])), "");
if (partsIn.renamed.length || partsIn.converted) md.push(`Columns read as: ${[...partsIn.renamed.map(([a, b]) => `${a} → ${b}`), ...(partsIn.converted ? [`${partsIn.converted} ÷ 7 → lead_time_weeks`] : [])].join(", ")}.`, "");
if (R.blockedViews.length) md.push(`Not run (file missing): ${[...new Set(R.blockedViews)].join(", ")}.`, "");

md.push("## Portfolio", "");
md.push(`- Parts: ${S.parts} in the file, ${S.analyzed} analyzed, ${S.blocked} blocked by data, ${S.with_issue} with an issue.`);
md.push(`- Annual spend: ${M(S.annual_spend)}. Inventory now ${M(S.inv_now)} → target ${M(S.inv_target)}: ${n1(E.turns_now)} → ${n1(E.turns_target)} turns, ${Math.round(E.dio_now)} → ${Math.round(E.dio_target)} days.`);
md.push(`- Recommended: ${PROGRAMS.map((p) => `${p} ${S.recommended[p] || 0}`).join(", ")}. ${S.program_changes} parts change program. Spend under pull ${pct(S.pull_share_now)} → ${pct(S.pull_share_rec)}.`, "");
md.push("Value by type. These are different kinds of money: never add them into one number.", "");
md.push(table(["Type", "Value", "What it is"], [
  ["Net working capital (cash, one-time)", M(S.inv_now - S.inv_target), "inventory now − target"],
  ["Excess (cash, one-time, gross)", M(S.excess), `stock above target × ${P.tolerance}`],
  ["Carrying cost avoided (P&L, per year)", M(ins.carrying.avoided), `(now − target) × ${pct(P.carrying_rate)}`],
  ["Consignment transfer (ownership)", P.consignment ? M(S.consignment) : "off", "VMI stock the supplier would own until consumed; not a saving"],
  ["Build-up (cash to commit)", M(ins.riskBuild), "stock to buy for parts below target"],
]), "");

const changes = result.analyzed.filter((p) => p.program_change).sort((a, b) => b.annual_spend - a.annual_spend);
md.push(`## Program changes, by spend (top ${Math.min(15, changes.length)} of ${changes.length})`, "");
md.push(table(["Part", "Supplier", "Class", "Trend", "Now → recommended", "Reason", "DOS now → target", "Excess"], changes.slice(0, 15).map((p) =>
  [p.part_number, p.supplier, `${p.abc}${p.xyz}${p.super_a ? " Super A" : ""}`, p.trend, `${p.current_program} → ${p.recommended_program}`, p.reason, `${n1(p.dos_current)} → ${n1(p.dos_target)}`, p.excess_value ? usd(p.excess_value) : ""])), "");

const cands = proposalCandidates(result);
if (cands.length) {
  md.push("## Negotiation list: suppliers by VMI/CRP spend", "");
  md.push(table(["Supplier", "VMI", "CRP", "Spend/yr", "Asks before go-live"], cands.slice(0, 10).map((c) => {
    const x = proposal(result, score, opps, P, c.supplier);
    return [c.supplier, x.vmiN, x.crpN, M(x.annual_spend), extra.suppliers.length ? x.asks.map((a) => a.code).join(", ") || "none" : "load suppliers.csv to see asks"];
  })), "");
}

if (extra.forecast.length) {
  md.push(`## Expedites: short inside the lead time (${pipe.escalate.length}, ${M(pipe.escalateValue)})`, "");
  md.push(pipe.escalate.length ? table(["Part", "Supplier", "Short from week", "LT (wks)", "Short value", "Open PO"], pipe.escalate.slice(0, 15).map((r) =>
    [r.part.part_number, r.part.supplier, r.first_short_week, r.lt, usd(r.short_value), r.po_week ? `${r.po_qty} in wk ${r.po_week}` : "none"])) : "None.", "");
  if (pipe.watch.length) md.push(`Place PO (short only after the lead time): ${pipe.watch.length} parts, ${M(pipe.watchValue)}. Full list in expedites.csv.`, "");
}

const open = X.items.filter((x) => isOpen(x.status));
if (open.length) md.push(`## Exceptions`, "", `${open.length} open: ${["Critical", "High", "Medium", "Low"].map((s) => `${open.filter((x) => x.severity === s).length} ${s.toLowerCase()}`).join(", ")}.`, "");

const blocked = result.parts.filter((p) => p.issues.length);
if (blocked.length) {
  md.push(`## Data issues (${blocked.length})`, "");
  md.push(table(["Part", "Blocks analysis", "Issues"], blocked.map((p) => [p.part_number, p.blocking ? "yes" : "no", p.issues.join("; ")])), "");
}

if (opt("whatif") !== undefined) {
  const c = delayCandidates(result.parts, extra.forecast);
  const sup = c.find((x) => x.supplier === opt("whatif"));
  if (!sup) md.push("## Supplier delay what-if", "", `No open POs inside 13 weeks for "${opt("whatif")}". Suppliers with open POs: ${c.map((x) => x.supplier).join(", ") || "none (load a forecast with open POs)"}.`, "");
  else {
    const W = delayScenario(result.parts, extra.forecast, P, { supplier: sup.supplier, weeks: Number(opt("weeks") ?? 2) });
    writeCsv(`whatif_${slug(W.supplier)}_${W.weeks}wk.csv`, WHATIF_COLUMNS, W.rows.map(whatifRow));
    md.push(`## Supplier delay what-if: ${W.supplier}, ${W.weeks} weeks late`, "");
    md.push(`${W.newExpedite} new expedites and ${W.deeper} deeper shortages inside the lead time, ${M(W.addedValue)} more at risk${W.firstShortWeek ? `, first short week ${W.firstShortWeek}` : ""}. ${plural(W.orderNow, "part", "parts")} must be ordered earlier; ${W.unaffected} unaffected.`, "");
    const hit = W.rows.filter((r) => r.impact !== "No change");
    if (hit.length) md.push(table(["Part", "Commodity", "Impact", "PO week", "Short from", "Added at risk", "Action"], hit.slice(0, 20).map((r) =>
      [r.part.part_number, r.part.commodity, r.impact, `${r.po_week_before} → ${r.po_week_after > 13 ? "after 13" : r.po_week_after}`, r.first_short_after ?? "—", usd(r.added_value),
        r.impact === "Order now" ? `Place PO by week ${r.order_by_week}` : r.impact === "Shorter cover" ? "Watch" : "Expedite or second-source"])), "");
  }
}

if (opt("proposal") !== undefined) {
  const c = cands.find((x) => x.supplier === opt("proposal"));
  if (!c) md.push("## Proposal draft", "", `No VMI/CRP parts at "${opt("proposal")}". Suppliers with VMI/CRP parts: ${cands.map((x) => x.supplier).join(", ") || "none"}.`, "");
  else {
    const X2 = proposal(result, score, opps, P, c.supplier);
    writeCsv(`proposal_${slug(c.supplier)}.csv`, PROPOSAL_COLUMNS, X2.lines.map(proposalRow));
    const ask = (a) => ({
      vmi_agreement: `A VMI agreement in place before go-live (${a.n} VMI parts, ${M(a.value)} a year).`,
      edi: "Forecast and consumption exchanged by EDI.",
      consignment: `Consignment on VMI parts: stock stays yours until we consume it (${M(a.value)} at target levels).`,
      lead_time: `A ${a.weeks}-week lead-time reduction on ${a.n} parts: ${a.parts?.join(", ")}.`,
      otd: `A recovery plan for on-time delivery: ${a.otd}% against our ${a.target}% minimum.`,
      hub: a.expired ? `A new ${a.hub} hub contract: the current one ended ${a.end}.` : `Renewal of the ${a.hub} hub contract, which ends ${a.end}, before VMI starts.`,
    })[a.code];
    const progs = [X2.vmiN ? `${X2.vmiN} in VMI (${P.review.VMI}-week review cycle)` : "", X2.crpN ? `${X2.crpN} in CRP (${P.review.CRP}-week review cycle)` : ""].filter(Boolean).join(" and ");
    const text = [
      `Subject: VMI/CRP replenishment proposal for ${c.supplier}`, "",
      `We propose to move ${X2.lines.length} parts (${M(X2.annual_spend)} of annual spend) to supplier-managed replenishment: ${progs}.`,
      "The attached list has the min and max per part: min is our safety stock, max is min plus one review cycle (or the MOQ). Levels are sized on our last 26 weeks of consumption.",
      ...(X2.asks.length ? ["", "To start, we need:", ...X2.asks.map((a, i) => `${i + 1}. ${ask(a)}`)] : []), "",
      "We will share 13 weeks of forecast and our open orders every week. Please confirm levels, pack sizes and lead times by part.",
    ].join("\n");
    writeFileSync(join(outDir, `proposal_${slug(c.supplier)}.md`), `DRAFT: review levels, pack sizes and lead times with the buyer before sending.\n\n${text}\n`);
    written.push(`proposal_${slug(c.supplier)}.md`);
    md.push(`## Proposal draft: ${c.supplier} (DRAFT, not sent)`, "", "```", text, "```", "", `Part list with min/max: proposal_${slug(c.supplier)}.csv.`, "");
  }
}

md.push("## Files", "", written.map((f) => `- ${f}`).join("\n"), "- summary.md, summary.json", "");
writeFileSync(join(outDir, "summary.md"), md.join("\n"));
writeFileSync(join(outDir, "summary.json"), JSON.stringify({
  parts: S.parts, analyzed: S.analyzed, blocked: S.blocked, program_changes: S.program_changes, recommended: S.recommended,
  annual_spend: S.annual_spend, inv_now: S.inv_now, inv_target: S.inv_target, turns_now: E.turns_now, turns_target: E.turns_target,
  value_by_type: { net_working_capital: S.inv_now - S.inv_target, excess_gross: S.excess, carrying_avoided_per_year: ins.carrying.avoided, consignment_transfer: P.consignment ? S.consignment : 0, build_up: ins.riskBuild },
  expedites: extra.forecast.length ? { escalate: pipe.escalate.length, escalate_value: pipe.escalateValue, place_po: pipe.watch.length } : null,
  readiness: R.files.map((f) => ({ file: f.label || f.file, state: f.state, rows: f.rows })),
}, null, 2) + "\n");
console.log(md.join("\n"));
console.error(`\nWrote ${[...written, "summary.md", "summary.json"].map((f) => join(outDir, f)).join(", ")}`);
