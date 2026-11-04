// Invariant checks for js/insights.js (director views). There is no Python reference for these,
// so the test asserts properties that must hold for any data and policy.
// Usage: node test/insights.mjs   (exit code 0 = pass)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, clonePolicy } from "../js/segment.js";
import { insights } from "../js/insights.js?v=5";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = parseCSV(readFileSync(join(root, "sample_parts.csv"), "utf8"));
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const isPullMove = (p) => p.program_change && ["VMI", "CRP"].includes(p.recommended_program);

function run(label, tweak) {
  const P = clonePolicy(); tweak?.(P);
  const res = analyze(rows, P), I = insights(res, P), S = res.summary, W = I.waves;
  console.log(`${label}:`);
  check("waves partition the analyzed parts", W.reduce((t, w) => t + w.n, 0) === res.analyzed.length
    && new Set(W.flatMap((w) => w.parts)).size === res.analyzed.length);
  check("waves' net release adds up to inventory now − target", near(W[2].cumulative, S.inv_now - S.inv_target));
  check("released − built = net in every wave", W.every((w) => near(w.released - w.built, w.net)));
  check("wave 1 has no VMI/CRP program change", W[0].parts.every((p) => !isPullMove(p)));
  check("waves 2–3 only hold VMI/CRP program changes", W.slice(1).every((w) => w.parts.every(isPullMove)));
  check("each supplier sits in a single wave", (() => {
    const m = new Map();
    for (const w of W.slice(1)) for (const p of w.parts) { if (m.has(p.supplier) && m.get(p.supplier) !== w.wave) return false; m.set(p.supplier, w.wave); }
    return true;
  })());
  check("excess and consignment are preserved across waves",
    near(W.reduce((t, w) => t + w.excess, 0), S.excess) && near(W.reduce((t, w) => t + w.consignment, 0), S.consignment));
  check("carrying avoided = max(0, now − target) × rate", near(I.carrying.avoided, Math.max(0, S.inv_now - S.inv_target) * P.carrying_rate));
  check("critical parts are below safety stock", I.critical.every((r) => r.part.on_hand_qty < r.safety));
  check("watch parts are between safety stock and target",
    I.risk.filter((r) => r.tier === "Watch").every((r) => r.part.on_hand_qty >= r.safety && r.part.on_hand_qty < r.part.target_qty));
  check("no part at or above target is flagged at risk",
    res.analyzed.filter((p) => p.on_hand_qty >= p.target_qty).every((p) => !I.risk.some((r) => r.part === p)));
  check("E&O parts are declining or slow, with positive exposure",
    I.eo.every((e) => e.value > 0 && (e.part.trend === "Declining" || e.part.dos_current > P.eo_dos_days)));
  console.log(`  → waves ${W.map((w) => `${w.n} parts / $${Math.round(w.net)}`).join(" | ")}; critical ${I.critical.length}, watch ${I.risk.length - I.critical.length}; E&O ${I.eo.length} parts $${Math.round(I.eoValue)}; carrying avoided $${Math.round(I.carrying.avoided)}/yr`);
  return { W, I };
}

run("Default policy");
const all = run("Wave 2 covers 100% of VMI/CRP spend", (P) => { P.wave2_share = 1; });
check("with wave2_share = 100%, wave 3 is empty", all.W[2].n === 0);
run("Conservative policy (z +0.4, floors +7 days, no consignment)", (P) => {
  for (const k of "ABC") P.z[k] += 0.4;
  for (const k of Object.keys(P.floor_days)) P.floor_days[k] += 7;
  P.consignment = false;
});

console.log(failures ? `FAILED (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
