// Small render helpers shared by js/app.js and js/layers.js.
import { esc } from "./format.js?v=24";
import { t } from "./i18n.js?v=24";

export const PVAR = { VMI: "--vmi", CRP: "--crp", Kanban: "--kanban", MRP: "--mrp" };
export const pc = (prog) => `--c: var(${PVAR[prog] || "--mrp"})`;
export const badge = (prog) => (prog ? `<span class="badge" style="${pc(prog)}">${esc(prog)}</span>` : `<span class="muted">—</span>`);
export const blockedBadge = () => `<span class="badge blocked">${t("common.blocked")}</span>`;

// Long tables render one page of rows; "Show more" / "Show all" add rows (js/app.js handles [data-more]).
// Keeps the DOM small with thousands of parts. Limits reset when a new file is loaded.
export const PAGE = 100;
export const rowLimits = new Map();
export function paged(list, key, renderRow, colspan) {
  const lim = rowLimits.get(key) || PAGE;
  const html = list.slice(0, lim).map(renderRow).join("");
  if (list.length <= lim) return html;
  return html + `<tr class="more-row"><td colspan="${colspan}"><span class="muted">${t("common.showingOf", { shown: lim, total: list.length })}</span>
    <button type="button" class="btn btn-ghost" data-more="${key}">${t("common.showMore", { n: Math.min(PAGE, list.length - lim) })}</button>
    <button type="button" class="btn btn-ghost" data-more="${key}" data-all>${t("common.showAll", { n: list.length })}</button></td></tr>`;
}
