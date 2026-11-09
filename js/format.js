// Shared display helpers, so every view and the deck format numbers the same way.
// Locale-aware: en-US or es-MX (js/i18n.js sets the language). Engine modules pass an explicit
// language through fmtFor() so their English text never depends on the UI language.

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LOCALES = { en: "en-US", es: "es-MX" };
let current = "en";
export const setFormatLang = (lang) => { current = LOCALES[lang] ? lang : "en"; };
export const localeOf = (lang = current) => LOCALES[lang] || LOCALES.en;

const cache = new Map();
const nf = (lang, d) => {
  const k = `${lang}|${d}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: d, maximumFractionDigits: d }));
  return cache.get(k);
};

// Formatters for one language. Compact money: en $4.74M, $568k, $5.3k, $812; es $4.74 M, $568 k (CLDR es-MX).
export function fmtFor(lang) {
  const N = (v, d = 0) => (Number.isFinite(v) ? nf(lang, d).format(v) : "—");
  const sp = lang === "es" ? " " : "";
  return {
    N,
    USD: (v, d = 0) => (Number.isFinite(v) ? (v < 0 ? "−$" : "$") + N(Math.abs(v), d) : "—"),
    Pct: (v, d = 0) => (Number.isFinite(v) ? N(v * 100, d) + "%" : "—"),
    Cost: (v) => (Number.isFinite(v) ? "$" + N(v, v < 1 ? 4 : 2) : "—"),
    M(v) {
      if (!Number.isFinite(v)) return "—";
      const a = Math.abs(v), sign = v < 0 ? "−" : "";
      if (a >= 1e6) return `${sign}$${N(a / 1e6, 2)}${sp}M`;
      if (a >= 1e4) return `${sign}$${N(Math.round(a / 1e3))}${sp}k`;
      if (a >= 1e3) return `${sign}$${N(a / 1e3, 1)}${sp}k`;
      return `${sign}$${N(Math.round(a))}`;
    },
    compact: (v) => new Intl.NumberFormat(localeOf(lang), { notation: "compact" }).format(v),
    date: (d) => d.toLocaleDateString(localeOf(lang), { year: "numeric", month: "long", day: "numeric" }),
  };
}

export const fmtN = (v, d = 0) => fmtFor(current).N(v, d);
export const fmtUSD = (v, d = 0) => fmtFor(current).USD(v, d);
export const fmtPct = (v, d = 0) => fmtFor(current).Pct(v, d);
export const fmtCost = (v) => fmtFor(current).Cost(v);
export const fmtM = (v) => fmtFor(current).M(v);
export const fmtCompact = (v) => fmtFor(current).compact(v);
export const fmtDate = (d) => fmtFor(current).date(d);

// Strip tags from a headline built as HTML, for aria-labels and file names.
export const plain = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
