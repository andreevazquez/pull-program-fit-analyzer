// Shared display helpers, so the Analysis view, the Story view and the deck format numbers the same way.

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nfCache = new Map();
const nf = (d) => {
  if (!nfCache.has(d)) nfCache.set(d, new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  return nfCache.get(d);
};

export const fmtN = (v, d = 0) => (Number.isFinite(v) ? nf(d).format(v) : "—");
export const fmtUSD = (v, d = 0) => (Number.isFinite(v) ? (v < 0 ? "−$" : "$") + nf(d).format(Math.abs(v)) : "—");
export const fmtPct = (v, d = 0) => (Number.isFinite(v) ? (v * 100).toFixed(d) + "%" : "—");
export const fmtCost = (v) => (Number.isFinite(v) ? "$" + (v < 1 ? v.toFixed(4) : v.toFixed(2)) : "—");

// Compact money: $4.74M, $568k, $5.3k, $812.
export function fmtM(v) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

// Strip tags from a headline built as HTML, for aria-labels and file names.
export const plain = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
