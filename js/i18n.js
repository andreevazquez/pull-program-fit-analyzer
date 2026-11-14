// EN/ES. Dictionaries: js/i18n/en.js (source) and js/i18n/es.js (Mexican business Spanish; supply chain
// terms stay in English, see docs/GLOSSARY.md). test/i18n.mjs checks that both have the same keys and placeholders.
//
// Language: ?lang=es|en, else the last choice (localStorage), else navigator.language, else English.
// Node (tests) always runs in English.
//
// Templates: {name} inserts a value as is; {name:fmt} formats it in the language's locale:
//   int, 1, 2 (decimals), money (compact $), usd, pct, pct1, cost.
// A value can be { one, other } for plurals, chosen by vars.n.
// Engine modules (segment, insights, v2, freshness, exceptions) build their English text with
// tl("en", key, vars) and also keep { k, v } (msg()); the UI renders that message with tm() in the
// current language. So tests and CSV exports stay English, and the screen follows the toggle.
import en from "./i18n/en.js?v=25";
import { fmtFor, setFormatLang } from "./format.js?v=25";

// English is always loaded (fallback, and the source of the engine templates); other languages load on demand.
export const DICTS = { en };
const LOADERS = { es: () => import("./i18n/es.js?v=25") };
async function loadDict(l) { if (!DICTS[l] && LOADERS[l]) DICTS[l] = (await LOADERS[l]()).default; }
export const LANGS = ["en", "es"];
const STORE = "ppfa.lang";
const browser = typeof window !== "undefined";

function detect() {
  if (!browser) return "en";
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(q)) { try { localStorage.setItem(STORE, q); } catch { /* private mode */ } return q; }
  } catch { /* no URL */ }
  try { const s = localStorage.getItem(STORE); if (LANGS.includes(s)) return s; } catch { /* storage blocked */ }
  return /^es\b/i.test(navigator.language || "") ? "es" : "en";
}

let lang = detect();
if (lang !== "en") { try { await loadDict(lang); } catch { lang = "en"; } }
setFormatLang(lang);
const listeners = new Set();

export const getLang = () => lang;
export const onLang = (fn) => listeners.add(fn);
export async function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  await loadDict(next);
  lang = next;
  setFormatLang(lang);
  if (browser) {
    try { localStorage.setItem(STORE, lang); } catch { /* storage blocked */ }
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  for (const fn of listeners) fn(lang);
}

function value(F, v, f) {
  if (v === undefined || v === null) return "";
  switch (f) {
    case "int": return F.N(v, 0);
    case "1": return F.N(v, 1);
    case "2": return F.N(v, 2);
    case "money": return F.M(v);
    case "usd": return F.USD(v);
    case "pct": return F.Pct(v);
    case "pct1": return F.Pct(v, 1);
    case "cost": return F.Cost(v);
    default: return String(v);
  }
}

// Translate in an explicit language.
export function tl(l, key, vars = {}) {
  let s = DICTS[l]?.[key] ?? DICTS.en[key];
  if (s === undefined) return key;
  if (typeof s === "object") s = vars.n === 1 ? s.one : s.other;
  const F = fmtFor(l);
  return s.replace(/\{(\w+)(?::(\w+))?\}/g, (_, k, f) => value(F, vars[k], f));
}
// Translate in the current language.
export const t = (key, vars) => tl(lang, key, vars);
// Does the dictionary have this key (for optional keys such as enum values)?
export const has = (key) => key in DICTS.en;

// Engine messages: { k, v } built once, rendered in any language.
export const msg = (k, v = {}) => ({ k, v });
export const tm = (m) => (m ? t(m.k, m.v) : "");
// Enumerated values (trend, severity, status, owner, …) stay English in the data; the screen shows them translated.
export const tv = (group, v) => (v == null || v === "" ? "" : has(`${group}.${v}`) ? t(`${group}.${v}`) : String(v));

// Static markup: data-i18n (text), data-i18n-html (trusted dictionary HTML), data-i18n-attr="attr:key;attr:key".
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) { const [a, k] = pair.split(":"); el.setAttribute(a.trim(), t(k.trim())); }
  }
}

// English text produced by the engine → current language, using the English templates under a key prefix
// (reason., issue., why., err., evErr., need., exc.d., vp.i., vp.owner., vp.when., vp.status.).
// Values captured from the English text are reused as they are (es-MX writes numbers like en-US).
// Captured values named issues, errors, why or what are translated too (lists joined with "; ").
const NESTED = { issues: "issue.", errors: "err.", why: "why.", what: "need." };
const compiled = new Map(), seen = new Map();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function compile(prefix) {
  if (compiled.has(prefix)) return compiled.get(prefix);
  const list = [];
  for (const [key, val] of Object.entries(en)) {
    if (!key.startsWith(prefix)) continue;
    for (const [form, s] of typeof val === "object" ? Object.entries(val) : [["", val]]) {
      const names = [], fmts = [];
      const body = s.split(/(\{\w+(?::\w+)?\})/).map((part) => {
        const m = part.match(/^\{(\w+)(?::(\w+))?\}$/);
        if (!m) return reEsc(part);
        names.push(m[1]); fmts.push(m[2]);
        return "(.+?)";
      }).join("");
      list.push({ key, form, re: new RegExp(`^${body}$`, "s"), names, fmts, lit: s.replace(/\{[^}]+\}/g, "").length });
    }
  }
  list.sort((a, b) => b.lit - a.lit);
  compiled.set(prefix, list);
  return list;
}
// Returns { key, form, vars } for an engine sentence, or null (used by test/i18n.mjs for coverage).
export function matchEngine(prefix, text) {
  for (const c of compile(prefix)) {
    const m = c.re.exec(text);
    if (m) return { key: c.key, form: c.form, vars: Object.fromEntries(c.names.map((n, i) => [n, m[i + 1]])), fmts: Object.fromEntries(c.names.map((n, i) => [n, c.fmts[i]])) };
  }
  return null;
}
export function tx(prefix, text) {
  if (lang === "en" || text == null || text === "") return text ?? "";
  const ck = `${lang}|${prefix}|${text}`;
  if (seen.has(ck)) return seen.get(ck);
  const hit = matchEngine(prefix, String(text));
  let out = String(text);
  if (hit) {
    let s = DICTS[lang][hit.key] ?? en[hit.key];
    if (typeof s === "object") s = s[hit.form] ?? s.other;
    out = s.replace(/\{(\w+)(?::(\w+))?\}/g, (_, k) => {
      let v = hit.vars[k] ?? "";
      if (NESTED[k]) v = v.split("; ").map((x) => tx(NESTED[k], x)).join("; ");
      if (hit.fmts[k] === "money" && lang === "es") v = v.replace(/\$([\d.,]+)([Mk])/g, "$$$1\u00a0$2");
      return v;
    });
  }
  if (seen.size > 20000) seen.clear();
  seen.set(ck, out);
  return out;
}
