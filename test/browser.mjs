// End-to-end checks in headless Chrome, driven over the DevTools protocol (no dependencies).
//   1. Untrusted input: CSVs with <script>, <img onerror> and attribute-breaking HTML in every text field
//      are uploaded through the real file inputs; every view, tab and the part drawer are opened; no markup
//      from the files may become DOM.
//   2. Malformed files: empty, header only, missing columns, bad numbers, binary, non-CSV, oversize.
//      Each gives a clear notice and the page keeps working.
//   3. Speed: a synthetic 5,000-part CSV; upload, analysis, view switches and a policy change are timed.
//   4. Languages: ?lang=es at 390 px wide: Spanish UI, no horizontal scroll, no missing keys.
//   5. The page loads, and the deck export works, under the site's Content-Security-Policy with no console errors.
// The server applies the headers in _headers, like Cloudflare does.
// Usage: node test/browser.mjs   (needs Chrome or Chromium; CHROME_PATH overrides the path; skips if none)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { parseCSV } from "./csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures++; };

/* ---------- Chrome ---------- */
function findChrome() {
  const c = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { c.push(execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch { /* not installed */ }
  }
  return c.find((p) => p && existsSync(p));
}
const chromePath = findChrome();
if (!chromePath) { console.log("SKIP test/browser.mjs: no Chrome found (set CHROME_PATH)"); process.exit(0); }

/* ---------- static server with the _headers rules ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".md": "text/markdown" };
const siteHeaders = {};
{
  let inAll = false;
  for (const line of readFileSync(join(root, "_headers"), "utf8").split("\n")) {
    if (/^\S/.test(line)) inAll = line.trim() === "/*";
    else if (inAll && line.includes(":")) { const i = line.indexOf(":"); siteHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  // upgrade-insecure-requests would rewrite http://127.0.0.1 subresources; drop it for the local server only.
  const h = { ...siteHeaders, "Content-Security-Policy": siteHeaders["Content-Security-Policy"].replace(/;\s*upgrade-insecure-requests/, "") };
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store", ...h });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

/* ---------- CDP ---------- */
const profile = mkdtempSync(join(tmpdir(), "ppfa-chrome-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
let page;
for (let i = 0; i < 100 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { await sleep(100); }
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon|cloudflareinsights/.test(m.params.entry.url || "") && !/ERR_BLOCKED_BY_CLIENT/.test(m.params.entry.text)) errors.push(`${m.params.entry.source}: ${m.params.entry.text}`);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waits.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expression)) return Date.now() - t0; await sleep(20); }
  throw new Error(`timed out waiting for ${expression}`);
};
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable"); await send("DOM.enable"); await send("Network.enable");
// Cloudflare Web Analytics rejects a localhost origin; it is not part of the app.
await send("Network.setBlockedURLs", { urls: ["*cloudflareinsights.com*"] });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

const work = mkdtempSync(join(tmpdir(), "ppfa-files-"));
const toFile = (name, content) => { const f = join(work, name); writeFileSync(f, content); return f; };
async function upload(selector, file) {
  const { root: doc } = await send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: doc.nodeId, selector });
  if (!nodeId) throw new Error(`no file input ${selector}`);
  await send("DOM.setFileInputFiles", { nodeId, files: [file] });
}
async function open(url) {
  await send("Page.navigate", { url });
  await waitFor(`document.readyState === "complete" && !document.documentElement.classList.contains("loading") && !!document.querySelector("#kpis .kpi") && !!document.querySelector("#partsTable tbody tr")`);
}
const clickAll = (sel) => evaluate(`(async () => { for (const b of document.querySelectorAll(${JSON.stringify(sel)})) { b.click(); await new Promise(r => setTimeout(r, 30)); } return true; })()`);
const notice = () => evaluate(`document.querySelector("#notice").hidden ? "" : document.querySelector("#notice").textContent`);
const healthy = () => evaluate(`document.querySelectorAll("#kpis .kpi").length >= 6 && document.querySelector("#partsTable tbody tr") !== null`);

/* ---------- CSV helpers ---------- */
const read = (f) => parseCSV(readFileSync(join(root, "data", f), "utf8"));
const csvCell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCSV = (rows) => { const head = Object.keys(rows[0]); return [head.join(","), ...rows.map((r) => head.map((h) => csvCell(r[h] ?? "")).join(","))].join("\n") + "\n"; };

try {
  /* ---------- 0. clean load under the CSP ---------- */
  console.log("Sample load under the site's Content-Security-Policy");
  await open(base);
  check("sample loads: KPIs, matrix and tables render", await healthy());
  check("no console errors or CSP violations on load", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ---------- 1. untrusted input (in English, then in Spanish) ---------- */
  for (const lang of ["en", "es"]) {
  console.log(`Untrusted input: HTML and script in every text field (${lang})`);
  if (lang !== "en") await open(`${base}?lang=${lang}`);
  const X = (n) => `<img src=x data-xss="${n}" onerror="window.__xss=${n}">"'><b data-xss="${n}b">x</b><script>window.__xss=${n}</script>`;
  const parts = read("sample_parts.csv"), sup0 = parts[0].supplier, pn0 = parts[0].part_number, pn1 = parts[1].part_number;
  const evilSup = `Evil ${X(1)}`, evilPn = `PN${X(2)}`;
  const swapSup = (r) => (r.supplier === sup0 ? { ...r, supplier: evilSup } : r);
  const swapPn = (r) => (r.part_number === pn0 ? { ...r, part_number: evilPn } : r);
  const evilParts = parts.map((r, i) => swapPn(swapSup({
    ...r,
    description: i < 40 ? `Desc ${X(3)}` : r.description,
    commodity: i % 10 === 0 ? `Comm ${X(4)}` : r.commodity,
    manufacturer: i < 40 ? `Mfr ${X(5)}` : r.manufacturer,
    current_program: r.part_number === pn1 ? `VMI${X(6)}` : r.current_program,
  })));
  const evilLots = read("inventory_lots.csv").map((r, i) => swapPn(swapSup({ ...r, lot_id: i < 30 ? `L${i}${X(7)}` : r.lot_id, date_code: i === 3 ? `24${X(8)}` : r.date_code, received_date: i === 4 ? `2025${X(9)}` : r.received_date })));
  const evilSuppliers = read("suppliers.csv").map((r) => swapSup({ ...r, hub_3pl: `Hub ${X(10)}`, hub_contract_end: r.hub_contract_end ? r.hub_contract_end : r.hub_contract_end, payment_terms_days: r.payment_terms_days }));
  evilSuppliers.push({ ...evilSuppliers[0], supplier: `Other ${X(11)}`, hub_contract_end: `2027${X(12)}` });
  const evilForecast = read("forecast.csv").map(swapPn);
  const evilEvents = read("supply_events.csv").map((r, i) => swapPn(swapSup({ ...r, event_id: `EV${i}${X(13)}`, event_type: i === 0 ? `EOL${X(14)}` : r.event_type, detail: `Detail ${X(15)}` })));

  await upload("#upload", toFile("evil_parts.csv", toCSV(evilParts)));
  await waitFor(`/evil_parts/.test(document.querySelector("#source").textContent)`);
  await evaluate(`document.querySelector("#tabbtn-freshness").click(); true`);
  await upload('input[data-v2="lots"]', toFile("evil_lots.csv", toCSV(evilLots)));
  await waitFor(`/evil_lots/.test(document.querySelector("#tab-freshness").textContent)`);
  await upload('input[data-v2="suppliers"]', toFile("evil_suppliers.csv", toCSV(evilSuppliers)));
  await waitFor(`/evil_suppliers/.test(document.querySelector("#tab-freshness").textContent)`);
  await evaluate(`document.querySelector("#tabbtn-pipeline").click(); true`);
  await upload('#tab-pipeline input[data-v2="forecast"]', toFile("evil_forecast.csv", toCSV(evilForecast)));
  await waitFor(`/evil_forecast/.test(document.querySelector("#notice").textContent)`);
  await evaluate(`document.querySelector("#tabbtn-exceptions").click(); true`);
  await upload('input[data-v2="events"]', toFile("evil_events.csv", toCSV(evilEvents)));
  await waitFor(`/evil_events/.test(document.querySelector("#notice").textContent)`);

  // Visit everything that renders file content.
  await clickAll(".tab");
  await evaluate(`document.querySelector('[data-xall]')?.click(); true`);
  await evaluate(`[...document.querySelectorAll("#tab-freshness [data-claim]")].slice(0, 3).forEach((b) => b.click()); true`);
  await clickAll("#partsTable tbody tr.clickable:nth-child(-n+3)");
  await evaluate(`document.querySelector("#policyToggle").click(); true`);
  await evaluate(`document.querySelector("#scenName") && (document.querySelector("#scenName").value = ${JSON.stringify(`Scen ${X(16)}`)}); document.querySelector("[data-scen=save]")?.click(); true`);
  await evaluate(`document.querySelector("#policyClose").click(); document.querySelector("[data-layer=planner]").click(); true`);
  await clickAll("[data-ptab]");
  await evaluate(`document.querySelector("[data-layer=exec]").click(); true`);
  await sleep(300);
  await evaluate(`document.querySelector("[data-subview=sales]")?.click(); true`);
  await sleep(300);
  const shown = await evaluate(`document.body.textContent.includes('data-xss="1"') || document.body.textContent.includes("data-xss")`);
  await evaluate(`document.querySelector("[data-layer=analysis]").click(); true`);
  await evaluate(`(() => { const r = [...document.querySelectorAll("#partsTable tbody tr.clickable")].find((t) => t.dataset.part.startsWith("PN<img")); r?.click(); return !!r; })()`);
  await sleep(200);
  const injected = await evaluate(`[...document.querySelectorAll("[data-xss]")].map((e) => e.outerHTML.slice(0, 80))`);
  const ran = await evaluate(`window.__xss ?? null`);
  check("no element from the uploaded files became DOM", injected.length === 0, injected.slice(0, 2).join(" | "));
  check("no script from the uploaded files ran", ran === null, String(ran));
  check("the payloads are shown as literal text", shown);
  check("drawer opened for the part whose number holds HTML", await evaluate(`!document.querySelector("#drawer").hidden && document.querySelector("#dTitle").textContent.startsWith("PN<img")`));
  await evaluate(`document.querySelector("#dClose").click(); true`);
  }
  const parts = read("sample_parts.csv");
  await open(`${base}?lang=en`);

  /* ---------- 2. malformed files ---------- */
  console.log("Malformed files: clear message, page keeps working");
  await open(base);
  errors.length = 0;
  const head = Object.keys(parts[0]).join(",");
  const cases = [
    ["empty.csv", "", /empty/i],
    ["header_only.csv", head + "\n", /no parts/i],
    ["missing_columns.csv", "part_number,description\nA,B\n", /missing column/i],
    ["not_a_table.csv", "hello world\njust text\n", /missing column/i],
    ["binary.csv", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x14, 0, 0x06, 0]), /binary/i],
    ["picture.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), /isn't a CSV/i],
    ["huge.csv", "x".repeat(11 * 1024 * 1024), /limit is 10 MB/i],
  ];
  for (const [name, content, msg] of cases) {
    await upload("#upload", toFile(name, content));
    await waitFor(`!document.querySelector("#notice").hidden && document.querySelector("#notice").textContent.includes(${JSON.stringify(name)})`, 8000).catch(() => {});
    const n = await notice();
    check(`${name}: "${n.slice(0, 70)}…"`, msg.test(n) && (await healthy()) && /sample_parts/.test(await evaluate(`document.querySelector("#source").textContent`)));
  }
  const bad = parts.slice(0, 20).map((r, i) => ({ ...r, unit_cost_usd: i === 0 ? "abc" : i === 1 ? "$1,234.50" : r.unit_cost_usd, lead_time_weeks: i === 2 ? "n/a" : r.lead_time_weeks, w05: i === 3 ? "lots" : r.w05, on_hand_qty: i === 4 ? "" : r.on_hand_qty, moq: i === 5 ? "-" : r.moq }));
  await upload("#upload", toFile("bad_numbers.csv", toCSV(bad)));
  await waitFor(`/bad_numbers/.test(document.querySelector("#source").textContent)`);
  check("bad numbers: file loads, bad rows are blocked with a reason, nothing breaks", (await healthy()) && (await evaluate(`/blocked by data/.test(document.querySelector("#notice").textContent)`)));
  await evaluate(`document.querySelector("#tabbtn-freshness").click(); true`);
  await upload('input[data-v2="lots"]', toFile("lots_missing.csv", "lot_id,qty\n1,2\n"));
  await sleep(150);
  check("secondary upload with missing columns: clear message", /missing column/i.test(await notice()));
  check("no console errors from malformed files", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ---------- 3. 5,000 parts ---------- */
  console.log("Speed: synthetic 5,000-part file");
  const weeks = Array.from({ length: 26 }, (_, i) => "w" + String(i + 1).padStart(2, "0"));
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const progs = ["MRP", "MRP", "MRP", "VMI", "CRP", "Kanban"];
  const comms = ["MLCC Capacitor", "Resistor", "Microcontroller", "Connector", "Inductor", "Memory", "Power IC", "Crystal"];
  const big = Array.from({ length: 5000 }, (_, i) => {
    const avg = Math.round(10 ** (1 + rnd() * 4)), cv = rnd() * 1.2, zero = rnd() < 0.15;
    const cost = +(10 ** (-2 + rnd() * 3.5)).toFixed(4);
    return {
      part_number: `SYN-${String(i + 1).padStart(5, "0")}`, description: `Synthetic part ${i + 1}`, commodity: comms[i % comms.length],
      manufacturer: `Maker ${i % 37}`, supplier: `Supplier ${String(i % 60).padStart(2, "0")}`, unit_cost_usd: cost,
      lead_time_weeks: 2 + Math.floor(rnd() * 24), moq: Math.round(avg * rnd() * 6), current_program: progs[i % progs.length],
      on_hand_qty: Math.round(avg * rnd() * 12),
      ...Object.fromEntries(weeks.map((w) => [w, zero && rnd() < 0.5 ? 0 : Math.max(0, Math.round(avg * (1 + cv * (rnd() * 2 - 1))))])),
    };
  });
  const bigFile = toFile("parts_5000.csv", toCSV(big));
  await open(base);
  errors.length = 0;
  let t0 = Date.now();
  await upload("#upload", bigFile);
  await waitFor(`/parts_5000/.test(document.querySelector("#source").textContent) && /Loaded/.test(document.querySelector("#notice").textContent)`, 60000);
  await evaluate(`new Promise((r) => requestAnimationFrame(() => setTimeout(r)))`);
  const tUpload = Date.now() - t0;
  const timeClick = (sel) => evaluate(`(async () => { const t = performance.now(); document.querySelector(${JSON.stringify(sel)}).click(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r))); return Math.round(performance.now() - t); })()`);
  const tExec = await timeClick("[data-layer=exec]");
  const tSales = await timeClick("[data-subview=sales]");
  const tPlanner = await timeClick("[data-layer=planner]");
  const tManager = await timeClick("[data-layer=analysis]");
  check("view switches took effect (Executive, Supplier impact, Planner, Manager)", await evaluate(`document.querySelector("[data-layer][aria-pressed=true]")?.dataset.layer === "analysis"`));
  const tPolicy = await evaluate(`(async () => { document.querySelector("#policyToggle").click(); const f = document.querySelector("#pol-abc_a"); const t = performance.now(); f.value = "0.7"; f.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => requestAnimationFrame(() => setTimeout(r))); return Math.round(performance.now() - t); })()`);
  const tSort = await timeClick('#partsTable th[data-sort="excess_value"]');
  const tFilter = await evaluate(`(async () => { const f = document.querySelector("#fSearch"); const t = performance.now(); f.value = "SYN-04"; f.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => requestAnimationFrame(() => setTimeout(r))); return Math.round(performance.now() - t); })()`);
  const nodes = await evaluate(`document.getElementsByTagName("*").length`);
  console.log(`    upload + analysis ${tUpload} ms · Executive ${tExec} ms · Supplier impact ${tSales} ms · Planner ${tPlanner} ms · Manager ${tManager} ms · policy change ${tPolicy} ms · sort ${tSort} ms · search ${tFilter} ms · ${nodes} DOM elements`);
  check("upload + analysis of 5,000 parts under 4 s", tUpload < 4000, `${tUpload} ms`);
  check("each view switch under 1.5 s", Math.max(tExec, tSales, tPlanner, tManager) < 1500);
  check("a policy change recomputes everything under 1.5 s", tPolicy < 1500, `${tPolicy} ms`);
  check("sort and search under 500 ms", tSort < 500 && tFilter < 500);
  check("DOM stays small (long tables are paged)", nodes < 8000, `${nodes} elements`);
  check("no console errors with 5,000 parts", errors.length === 0, errors.slice(0, 3).join(" | "));
  if (process.env.PPFA_TIMINGS) writeFileSync(process.env.PPFA_TIMINGS, JSON.stringify({ tUpload, tExec, tSales, tPlanner, tManager, tPolicy, tSort, tFilter, nodes }));

  /* ---------- 4. Spanish at 390 px ---------- */
  console.log("Spanish at 390 px");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  errors.length = 0;
  for (const layer of ["exec", "analysis", "planner"]) {
    await open(`${base}?lang=es`);
    await evaluate(`document.querySelector("[data-layer=${layer}]").click(); true`);
    await sleep(400);
    const r = await evaluate(`({ lang: document.documentElement.lang, w: document.documentElement.scrollWidth, text: document.body.innerText, on: document.querySelector("[data-layer][aria-pressed=true]")?.dataset.layer })`);
    check(`${layer}: the layer switch took effect`, r.on === layer, `pressed: ${r.on}`);
    const missing = r.text.match(/\b[a-z]+(\.[a-zA-Z0-9]+)+\b/g)?.filter((k) => /^(kpi|tab|policy|exec|planner|mgr|sales|story|drawer|exc|fresh|common|notice|guide|footer|header|deck|waves|risk|scen|integrity|pipe|score|opps|matrix|mig|parts|sup|reason|issue|action)\./.test(k)) || [];
    check(`${layer}: lang=es, no horizontal scroll (${r.w}px), no raw keys`, r.lang === "es" && r.w <= 390 && !missing.length, missing.slice(0, 3).join(", "));
    check(`${layer}: reads in Spanish`, /\b(de|los|las|para|por)\b/.test(r.text) && /Inventario|inventario|Proveedor|proveedor/.test(r.text));
  }
  check("no console errors in Spanish", errors.length === 0, errors.slice(0, 3).join(" | "));
  await send("Emulation.clearDeviceMetricsOverride");

  /* ---------- 5. deck export under the CSP ---------- */
  console.log("Deck export (PptxGenJS from jsdelivr, SRI-pinned) under the CSP");
  const dl = mkdtempSync(join(tmpdir(), "ppfa-dl-"));
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl }).catch(() => send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl }));
  await open(`${base}?lang=en`);
  errors.length = 0;
  await evaluate(`document.querySelector("[data-layer=exec]").click(); true`);
  await waitFor(`!!document.querySelector('#story [data-act="deck"]')`).catch(async (e) => {
    console.log("     debug:", JSON.stringify(await evaluate(`({ href: location.href, storyHidden: document.querySelector("#story").hidden, story: document.querySelector("#story").innerHTML.slice(0, 200), layer: [...document.querySelectorAll("[data-layer][aria-pressed=true]")].map((b) => b.dataset.layer) })`)));
    throw e;
  });
  await evaluate(`document.querySelector('#story [data-act="deck"]').click(); true`);
  let deck = null;
  for (let i = 0; i < 150 && !deck; i++) { await sleep(200); deck = readdirSync(dl).find((f) => f.endsWith(".pptx")); }
  check("deck downloads as .pptx", !!deck && statSync(join(dl, deck)).size > 50000, deck ? `${Math.round(statSync(join(dl, deck)).size / 1024)} KB` : "no file");
  check("no console errors or CSP violations during the deck export", errors.length === 0, errors.slice(0, 3).join(" | "));
  rmSync(dl, { recursive: true, force: true });
} catch (e) {
  console.log(`FAIL ${e.message}`);
  if (errors.length) console.log(`     page errors: ${errors.slice(0, 5).join(" | ")}`);
  failures++;
} finally {
  ws.close(); chrome.kill(); server.close();
  rmSync(work, { recursive: true, force: true });
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
}
console.log(failures ? `\n${failures} browser check(s) failed` : "\nAll browser checks passed");
setTimeout(() => process.exit(failures ? 1 : 0), 600);
