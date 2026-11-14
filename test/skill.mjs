// Checks for the Claude skill in claude-skill/pull-program-fit:
// the engine copies match js/, the CLI reproduces reference/expected_results.csv, ERP-style headers
// give the same answer, the what-if and proposal options work, and the zip holds SKILL.md.
// Usage: node test/skill.mjs   (exit code 0 = pass)
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "claude-skill", "pull-program-fit");
const cli = join(skill, "scripts", "analyze.mjs");
let failures = 0;
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures++; };
const run = (args, cwd) => execFileSync(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

console.log("Package:");
let inSync = true;
try { execFileSync(process.execPath, [join(root, "scripts", "build-skill.mjs"), "--check"], { stdio: "pipe" }); } catch (e) { inSync = false; console.log(e.stderr?.toString()); }
check("engine copies match js/ (run node scripts/build-skill.mjs after engine changes)", inSync);
const md = readFileSync(join(skill, "SKILL.md"), "utf8");
const fm = md.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
check("SKILL.md has name and description front matter", !!fm && fm[1] === "pull-program-fit" && fm[2].length > 100 && fm[2].length <= 1024, fm ? `${fm[2].length} chars` : "missing");
const zip = join(root, "downloads", "pull-program-fit-skill.zip");
let listing = "";
try { listing = execFileSync("unzip", ["-l", zip]).toString(); } catch { /* unzip missing */ }
check("downloads/pull-program-fit-skill.zip holds SKILL.md, the CLI and the engine", existsSync(zip) && (!listing || ["pull-program-fit/SKILL.md", "pull-program-fit/scripts/analyze.mjs", "pull-program-fit/scripts/engine/segment.js"].every((f) => listing.includes(f))));

console.log("Sample run:");
const dir = mkdtempSync(join(tmpdir(), "ppfa-skill-"));
const out = run(["--sample", "--whatif", "Distribuidor Norte (VMI-capable)", "--weeks", "4", "--proposal", "Distribuidor Pacífico", "--out", "o"], dir);
const got = new Map(parseCSV(readFileSync(join(dir, "o", "results.csv"), "utf8")).map((r) => [r.part_number, r]));
const exp = parseCSV(readFileSync(join(root, "reference", "expected_results.csv"), "utf8"));
const cols = Object.keys(exp[0]);
const bad = [];
for (const e of exp) {
  const g = got.get(e.part_number);
  if (!g) { bad.push(`${e.part_number} missing`); continue; }
  for (const c of cols) {
    const a = e[c], b = g[c];
    const na = Number(a), nb = Number(b);
    const same = a === b || (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= Math.max(0.011, Math.abs(na) * 1e-9));
    if (!same) bad.push(`${e.part_number}.${c}: ${a} vs ${b}`);
  }
}
check(`results.csv matches reference/expected_results.csv (${exp.length} parts × ${cols.length} columns)`, !bad.length, bad.slice(0, 3).join("; "));
const S = JSON.parse(readFileSync(join(dir, "o", "summary.json"), "utf8"));
check("summary.json: 143 analyzed, 106 changes, $2.27M net working capital", S.analyzed === 143 && S.program_changes === 106 && Math.round(S.value_by_type.net_working_capital / 1e4) === 227);
check("summary keeps value types apart (no total)", /never add them/.test(out) && !/total savings/i.test(out));
check("expedites: 12 escalate", S.expedites.escalate === 12);
check("what-if CSV and section written", existsSync(join(dir, "o", "whatif_distribuidor-norte-vmi-capable_4wk.csv")) && /4 weeks late/.test(out));
const prop = existsSync(join(dir, "o", "proposal_distribuidor-pacifico.md")) ? readFileSync(join(dir, "o", "proposal_distribuidor-pacifico.md"), "utf8") : "";
check("proposal draft marked DRAFT, with asks and the part list", /^DRAFT/.test(prop) && /VMI agreement/.test(prop) && existsSync(join(dir, "o", "proposal_distribuidor-pacifico.csv")));

console.log("ERP-style headers:");
const text = readFileSync(join(root, "data", "sample_parts.csv"), "utf8").replace(/^﻿/, "");
const [head, ...lines] = text.split(/\r?\n/);
const rename = { part_number: "Item", unit_cost_usd: "Standard Cost", lead_time_weeks: "Lead Time Days", moq: "Min Order Qty", on_hand_qty: "Qty On Hand", supplier: "Vendor", manufacturer: "Mfr", current_program: "Program" };
const h = head.split(","), li = h.indexOf("lead_time_weeks");
const erp = [h.map((c) => rename[c] || c.replace(/^w0?(\d+)$/, "Week $1")).join(","), ...lines.filter(Boolean).map((l) => {
  const cells = parseCSV(`${head}\n${l}`)[0];
  const v = h.map((c) => cells[c]);
  if (v[li] !== "") v[li] = String(Number(v[li]) * 7);
  return v.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",");
})].join("\n");
writeFileSync(join(dir, "erp.csv"), "﻿" + erp);
const out2 = run(["erp.csv", "--out", "e"], dir);
const got2 = new Map(parseCSV(readFileSync(join(dir, "e", "results.csv"), "utf8")).map((r) => [r.part_number, r]));
check("Item / Vendor / Qty On Hand / Lead Time Days / Week 1… give the same recommendations", exp.every((e) => got2.get(e.part_number)?.recommended_program === e.recommended_program && got2.get(e.part_number)?.target_qty === got.get(e.part_number)?.target_qty));
check("the summary says how columns were read", /Columns read as: .*lead_time_days ÷ 7/.test(out2));

console.log("Errors:");
let msg = "";
writeFileSync(join(dir, "bad.csv"), "part_number,cost\nA,1\n");
try { run(["bad.csv"], dir); } catch (e) { msg = e.stderr.toString(); }
check("missing columns: clear message, non-zero exit", /missing columns: .*lead_time_weeks/.test(msg));
const out3 = run(["--sample", "--whatif", "Nobody", "--out", "n"], dir);
check("unknown supplier for the what-if lists the valid names", /No open POs inside 13 weeks for "Nobody"\. Suppliers with open POs: Distribuidor Norte/.test(out3));
rmSync(dir, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : "\nAll skill checks passed");
process.exit(failures ? 1 : 0);
