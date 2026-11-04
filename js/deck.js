// Builds a PowerPoint deck from the Story view: one slide per card, charts rendered as images
// in light theme at 2x, plus title, summary and a policy appendix. PptxGenJS loads on first use.
import { storyCards } from "./story.js?v=7";

const PPTX_SRC = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
const FONT = "Arial";
const C = { ink: "0B0B0B", ink2: "52514E", muted: "898781", grid: "E1E0D9", surface: "FCFCFB", good: "006300", vmi: "2A78D6" };

let loading = null;
function loadPptx() {
  if (window.PptxGenJS) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: PPTX_SRC, async: true });
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("Couldn't load the PowerPoint library. Check the connection and try again.")); };
    document.head.appendChild(s);
  });
  return loading;
}

// Canvas -> PNG data URL on a solid background (Chart.js canvases are transparent).
export function canvasPng(canvas, bg) {
  const out = document.createElement("canvas");
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return { data: out.toDataURL("image/png"), w: out.width, h: out.height };
}

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

// Re-render the story in light theme at 2x, capture every card, then restore.
async function captureLight(storyEl, rerender) {
  const root = document.documentElement;
  const prevDpr = Chart.defaults.devicePixelRatio;
  root.classList.add("force-light");
  Chart.defaults.devicePixelRatio = 2;
  try {
    rerender();
    await nextFrame();
    return storyCards(storyEl).map((c) => ({ ...c, image: c.canvas ? canvasPng(c.canvas, "#FFFFFF") : null, rows: c.table ? tableRows(c.table) : null }));
  } finally {
    root.classList.remove("force-light");
    Chart.defaults.devicePixelRatio = prevDpr;
    rerender();
  }
}

function tableRows(table) {
  return [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
}

// kpis: [{label, value, sub}], policyRows: [{label, def, cur, changed}]
export async function exportDeck({ storyEl, rerender, kpis, policyRows, meta }) {
  await loadPptx();
  const cards = await captureLight(storyEl, rerender);
  const pptx = new window.PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = "Pull program portfolio review";
  const W = 13.333, M = 0.6;

  pptx.defineSlideMaster({
    title: "STORY",
    background: { color: "FFFFFF" },
    objects: [
      { line: { x: M, y: 7.0, w: W - 2 * M, h: 0, line: { color: C.grid, width: 0.75 } } },
      { text: { text: meta.footer, options: { x: M, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted } } },
    ],
    slideNumber: { x: W - M - 0.6, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted, align: "right" },
  });

  // Title
  const t = pptx.addSlide({ masterName: "STORY" });
  t.addText("Pull program portfolio review", { x: M, y: 2.2, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 36, bold: true, color: C.ink });
  t.addText("Which parts belong in VMI, CRP, Kanban or MRP, what it does to inventory, and how to roll it out", { x: M, y: 3.1, w: W - 2 * M, h: 0.6, fontFace: FONT, fontSize: 16, color: C.ink2 });
  t.addText(meta.subtitle, { x: M, y: 4.1, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 12, color: C.muted });
  t.addText(meta.policyNote, { x: M, y: 4.45, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 12, color: C.muted });

  // Summary
  const s = pptx.addSlide({ masterName: "STORY" });
  s.addText("Summary", { x: M, y: 0.4, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
  s.addText(meta.summaryHeadline, { x: M, y: 0.8, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 24, bold: true, color: C.ink, valign: "top" });
  const cols = kpis.length, gap = 0.2, bw = (W - 2 * M - gap * (cols - 1)) / cols;
  kpis.forEach((k, i) => {
    const x = M + i * (bw + gap);
    s.addShape(pptx.ShapeType.rect, { x, y: 2.3, w: bw, h: 2.2, fill: { color: "F6F6F3" }, line: { color: C.grid, width: 0.75 } });
    if (k.accent) s.addShape(pptx.ShapeType.rect, { x, y: 2.3, w: 0.06, h: 2.2, fill: { color: k.accent }, line: { color: k.accent, width: 0 } });
    s.addText(k.label, { x: x + 0.2, y: 2.45, w: bw - 0.3, h: 0.4, fontFace: FONT, fontSize: 12, color: C.ink2 });
    s.addText(k.value, { x: x + 0.2, y: 2.9, w: bw - 0.3, h: 0.8, fontFace: FONT, fontSize: k.value.length > 12 ? 20 : 26, bold: true, color: C.ink, fit: "shrink" });
    s.addText(k.sub, { x: x + 0.2, y: 3.7, w: bw - 0.3, h: 0.7, fontFace: FONT, fontSize: 10, color: C.muted, valign: "top" });
  });
  s.addText("Excess is one-time cash; carrying cost avoided is the recurring P&L effect; consignment moves ownership to suppliers and is not a saving. They are never added together.",
    { x: M, y: 4.9, w: W - 2 * M, h: 0.6, fontFace: FONT, fontSize: 11, color: C.ink2, italic: true });

  // One slide per story card
  for (const c of cards) {
    const sl = pptx.addSlide({ masterName: "STORY" });
    sl.addText(c.eyebrow.toUpperCase(), { x: M, y: 0.35, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: C.muted, charSpacing: 1 });
    sl.addText(c.headline, { x: M, y: 0.65, w: W - 2 * M, h: 0.85, fontFace: FONT, fontSize: 22, bold: true, color: C.ink, valign: "top", fit: "shrink" });
    sl.addText(c.sub, { x: M, y: 1.5, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 12, color: C.ink2, valign: "top", fit: "shrink" });
    const top = 2.3, maxH = 6.85 - top, maxW = W - 2 * M;
    if (c.image) {
      const ratio = c.image.w / c.image.h;
      let w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      sl.addImage({ data: c.image.data, x: M + (maxW - w) / 2, y: top, w, h });
    } else if (c.rows) {
      sl.addTable(c.rows.map((r, ri) => r.map((cell, ci) => ({
        text: cell,
        options: { fontFace: FONT, fontSize: 10, color: ri === 0 ? C.ink2 : C.ink, bold: ri === 0 || ci === 1, align: ci === 0 ? "left" : "right", fill: { color: ri === 0 ? "F3F2EE" : "FFFFFF" } },
      }))), { x: M, y: top, w: maxW, border: { type: "solid", pt: 0.5, color: C.grid }, autoPage: false });
    }
  }

  // Appendix: policy
  const a = pptx.addSlide({ masterName: "STORY" });
  a.addText("APPENDIX", { x: M, y: 0.35, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: C.muted, charSpacing: 1 });
  a.addText("Policy used for this review", { x: M, y: 0.65, w: W - 2 * M, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: C.ink });
  const half = Math.ceil(policyRows.length / 2);
  [policyRows.slice(0, half), policyRows.slice(half)].forEach((rows, k) => {
    const head = ["Parameter", "Default", "Used"].map((h) => ({ text: h, options: { bold: true, color: C.ink2, fill: { color: "F3F2EE" } } }));
    a.addTable([head, ...rows.map((r) => [r.label, r.def, r.cur].map((v, ci) => ({
      text: String(v), options: { color: r.changed && ci === 2 ? C.vmi : C.ink, bold: r.changed && ci === 2, align: ci ? "right" : "left" },
    })))], { x: M + k * ((W - 2 * M) / 2 + 0.1), y: 1.4, w: (W - 2 * M) / 2 - 0.1, fontFace: FONT, fontSize: 8, rowH: 0.19, border: { type: "solid", pt: 0.5, color: C.grid }, autoPage: false });
  });

  const date = new Date().toISOString().slice(0, 10);
  await pptx.writeFile({ fileName: `pull-program-review-${date}.pptx` });
}
