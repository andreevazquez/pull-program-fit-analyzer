# Pull Program Fit Analyzer

**English** · [Español](README.es.md)

**Live demo: [andreevazquez.github.io/pull-program-fit-analyzer](https://andreevazquez.github.io/pull-program-fit-analyzer/)** · [en español](https://andreevazquez.github.io/pull-program-fit-analyzer/?lang=es)

Pull programs are a portfolio decision. This tool makes the purchasing policy explicit and adjustable.

[![Manager view: KPIs, ABC × XYZ matrix colored by recommended program, program migration and parts table](docs/img/manager.png)](https://andreevazquez.github.io/pull-program-fit-analyzer/)

## What it does

**Problem.** In an EMS plant, hundreds of purchased components sit in MRP by default. VMI, CRP or Kanban would carry them with less inventory and less planner effort. Moving a part to a pull program is usually decided one part at a time, in a meeting, with rules nobody wrote down.

**Approach.** The analyzer takes 26 weeks of demand per part and classifies the whole portfolio:
- ABC by annual spend and XYZ by demand variability, with a trend check.
- A program assignment from an explicit rule set.
- A target inventory sized per program: safety stock, cycle stock and a days-of-supply floor.

Every threshold is editable in a Policy panel, and the whole analysis recomputes in the browser as you type.

**Outcome.** On the 150-part sample:
- 106 parts change program, and spend under pull goes from 29% to 78%.
- Inventory goes from $4.74M to a $2.47M target, which is 7.3 to 14.1 turns.
- That releases **$2.27M of net working capital** and avoids **$568k a year** of carrying cost.
- $839k of VMI stock would move to supplier ownership on consignment. That figure is reported separately, because an ownership transfer is not a saving.

## Three views, one policy

The same analysis is shown at three levels. The manager owns the policy, and the other two views follow it.

### Executive: money, service and the plan
Turns and days of inventory, now vs. target. Also:
- **Net working capital** to release, and service risk.
- **Pull, VMI and EDI penetration.**
- **Value pipeline**: every initiative with its owner, timing and status. Cash, P&L, recovery, ownership transfer and risk are subtotaled separately and never added into one number. A cash bridge shows how excess, working capital and pipeline cash tie together.
- **Exceptions that need a director.**

![Executive view: turns, days of inventory, working capital, service risk and the value pipeline](docs/img/exec.png)

### Manager: segmentation and policy
- **ABC × XYZ matrix** and program migration.
- **Parts table** with a step-by-step drawer for each recommendation.
- **Supplier negotiation list** and scorecard.
- **Pipeline coverage**, MOQ and lead-time projects, rollout waves, risk and scenarios.
- **Freshness claims**, the exceptions inbox and data integrity.
- **Policy panel**, where every threshold is set.

![Manager view with the Policy panel open](docs/img/policy.png)

### Planner: what to do this week
One row per part, ordered by urgency and then value:
- **Supply actions:** expedite, place PO, below safety stock, push out excess.
- **Checks:** check forecast, validate freshness claim, use aged lot first.
- **Data:** fix master data.

When a part is short in the pipeline and in excess at the same time, the detail line explains the timing split, so nobody cancels the order that covers the shortage.

![Planner view: action list with expedites first](docs/img/planner.png)

## Supplier what-if, proposal drafts and a Claude skill

Four features take their cue from the workflows in [Claude for Manufacturing](https://claude.com/resources/articles/claude-for-manufacturing): drafts that end in a person's review, figures that trace back to the data, and a setup check that says what can't run yet.

- **Supplier delay what-if** (Manager → Pipeline). Pick a supplier and a delay: its open POs move out and the 13-week projection reruns. The view shows:
  - which parts now go short inside their lead time, so a new PO can't help;
  - the added value at risk and the first short week;
  - what to expedite or second-source, and what must be ordered earlier.
  On the sample, Distribuidor Norte four weeks late puts 39 parts short inside their lead time, with $317k more at risk.
- **VMI/CRP proposal draft** (Manager → Suppliers). For one supplier, the parts the policy moves to VMI or CRP, with:
  - min (safety stock) and max (min plus one review cycle, or the MOQ) per part;
  - the asks the scorecard implies: VMI agreement, EDI, consignment, lead-time cut, OTD recovery, hub renewal.
  The text comes in EN/ES with a CSV part list. Status goes Draft → Reviewed → Sent, and it can't be marked Sent before it is Reviewed.
- **Data readiness** (the Data r/n button and the CSV format dialog). For each file: loaded or not, how many rows match the parts file, and which views it feeds.
- **Claude skill** ([download](https://andreevazquez.github.io/pull-program-fit-analyzer/downloads/pull-program-fit-skill.zip), source in [claude-skill/](claude-skill/pull-program-fit/SKILL.md)). The same engine as a skill Claude runs on an ERP export: results, expedites, what-if and proposal CSVs, plus a summary that keeps value types apart. Common export headers are read as-is (Item, Vendor, Qty On Hand, Standard Cost, Week 1…, lead time in days). Upload it to Claude as a custom skill, in the same workspace where a team uses Claude for Manufacturing or its ERP connectors.

These are independent features inspired by that launch, not an official integration.

## How the policy works

Full rules, formulas and code locations: **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)** ([en español](docs/METHODOLOGY.es.md)). Terms: [docs/GLOSSARY.md](docs/GLOSSARY.md).

**1. Classify.**
- ABC by cumulative share of annual spend: A < 80%, B < 95%. Super A is < 50%.
- XYZ by coefficient of variation: X < 0.5 ≤ Y < 1.0 ≤ Z. A part with more than 30% zero weeks is also Z.
- Trend compares the last 8 weeks with the first 8: Ramp above 1.5×, Declining below 0.5×.

**2. Assign a program.** Ramp or Declining parts stay in MRP. Otherwise:

| | X (stable) | Y (moderate) | Z (erratic) |
|---|---|---|---|
| **A** | VMI if LT ≥ 8 wks, else CRP | VMI if LT ≥ 12 wks, else CRP | MRP |
| **B** | Kanban if unit cost < $1, else CRP | CRP | MRP |
| **C** | Kanban | Kanban | MRP |

**3. Size the target.**
- `safety = z × σ × √(R + L)`
- `cycle = max(avg × R, MOQ) / 2`
- `target = max(safety + cycle, floor days of demand)`
- Each program has its own review period R, exposure L and floor. Under MRP the plant carries the full lead time.

**4. Measure.**
- Days of supply now vs. target.
- Excess above target × 1.20.
- Consignment transfer for VMI parts.
- Carrying cost at 25% a year.

## Languages

The UI is in English and Mexican Spanish. The language comes from `?lang=en` or `?lang=es` in the URL, then the last choice saved in this browser, then the browser language, else English. The EN | ES toggle in the header switches without a reload.

- Dictionaries: `js/i18n/en.js` and `js/i18n/es.js` (the Spanish one loads only when needed). `js/i18n.js` holds `t()`, plurals, and the `Intl` formatters (`en-US` / `es-MX`).
- The engine (`js/segment.js`, `js/v2.js`, …) stays in English, so tests and CSV exports are the same in both languages; its sentences are translated at display time.
- Spanish is Mexican business Spanish; supply chain terms used in English on the plant floor stay in English. See the [glossary](docs/GLOSSARY.md).

## Input format

One row per purchased part. A 150-part sample loads on open; upload your own CSV in the same format (`.csv` only, up to 10 MB).

| Column | Type | Notes |
|---|---|---|
| `part_number` | text | Unique; duplicates are flagged |
| `description` | text | |
| `commodity` | text | Used for filters |
| `manufacturer` | text | |
| `supplier` | text | Groups the negotiation list and rollout waves |
| `unit_cost_usd` | number | `$` and thousands separators are accepted; ≤ 0 or blank blocks the part |
| `lead_time_weeks` | number | Blank blocks the part |
| `moq` | number | MOQ above 8 weeks of demand is flagged |
| `current_program` | text | MRP, VMI, CRP or Kanban (any case; `VMI/SMI` reads as VMI) |
| `on_hand_qty` | number | Units on hand today |
| `w01` … `w26` | number | Weekly demand in units, oldest to newest |

Optional files, also replaceable by upload:

| File | Contents |
|---|---|
| `data/forecast.csv` | 13 weeks of forecast and the open PO |
| `data/suppliers.csv` | Supplier master: EDI, VMI agreement, hub, OTD, freshness rule |
| `data/inventory_lots.csv` | Lots with date codes |
| `data/supply_events.csv` | EOL, PCN, allocation, tariffs and other supply events |

Specs: [docs/specs](docs/specs).

## Run locally

No build step and no dependencies to install. Serve the folder over HTTP, because ES modules don't load from `file://`:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To run the tests (Node 18 or later; `test/browser.mjs` also needs Chrome or Chromium):

```bash
for t in test/*.mjs; do [ "$t" = test/csv.mjs ] || node "$t" || break; done
```

| Test | Checks |
|---|---|
| `test/policy.mjs` | Unit tests for the policy engine: every classification and sizing rule at its boundaries |
| `test/check.mjs` | The JS reproduces `reference/expected_results.csv` from the Python reference (`reference/segment.py`) |
| `test/insights.mjs`, `test/v2.mjs` | Director views, pipeline coverage, scorecard, cash bridge |
| `test/freshness.mjs`, `test/exceptions.mjs`, `test/sales.mjs`, `test/robustness.mjs` | Freshness claims, exceptions inbox, sell-in identity, spreadsheet edge cases |
| `test/whatif.mjs`, `test/proposal.mjs`, `test/readiness.mjs` | Supplier delay what-if, proposal min/max and asks, data readiness |
| `test/skill.mjs` | Claude skill: engine copy in sync, CLI output equals the reference, ERP-style headers give the same answer |
| `test/i18n.mjs` | EN/ES key, plural and placeholder parity; every key used in the code exists; every engine sentence has a Spanish template; glossary terms stay in English |
| `test/browser.mjs` | Headless Chrome under the site's CSP: CSVs with `<script>` and HTML in every field, malformed files, a 5,000-part upload with timings, Spanish at 390 px, deck export, no console errors |

GitHub Actions runs all of them on every push. `node scripts/release.mjs` runs them, then bumps the cache-busting version before a deploy.

```
index.html, css/, js/     the app (plain ES modules; Papa Parse and Chart.js from cdnjs,
                          PptxGenJS from jsdelivr only when you download the deck)
data/                     sample data
docs/                     methodology, specs, screenshots
reference/                Python reference implementation and expected results
claude-skill/             the Claude skill (scripts/engine/ is generated by scripts/build-skill.mjs)
downloads/                the skill as a zip
test/, scripts/           tests, the release script and the skill build
```

## Security

- Every value from an uploaded CSV is untrusted and escaped before display. `test/browser.mjs` uploads files with `<script>`, `<img onerror>` and attribute-breaking HTML in every text field and checks that none of it becomes DOM.
- Uploads: `.csv` only, up to 10 MB. Empty, binary, header-only or column-missing files get a clear message and the page keeps working.
- `_headers` sets Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and `X-Frame-Options` on Cloudflare. GitHub Pages can't send headers, so `index.html` carries the same CSP and referrer policy as `<meta>` tags.
- CDN libraries are pinned and loaded with Subresource Integrity.

## Data and privacy

**Synthetic data.** Part numbers, manufacturers and suppliers are fictional.

Everything runs in your browser. An uploaded file never leaves the page, and nothing is stored after the tab closes except the language choice. The only other request is Cloudflare Web Analytics, which counts anonymous page views with no cookies and never sees your data.

## Author

**Ricardo Vázquez**: supply chain, from the plant floor to the system rollout.
[LinkedIn](https://www.linkedin.com/in/ricardovazquez88)

Released under the [MIT License](LICENSE).
