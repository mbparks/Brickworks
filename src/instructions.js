/* BRICKWORK — assembly instructions.
 *
 * Produces an editable starting point, not a guaranteed real-world build
 * order: pieces are grouped bottom-up and steps that would bury a piece are
 * flagged so you can reorder them yourself.
 */
import { uid, round, VERSION, getColor } from './core.js';
import { getPart } from './parts.js';
import { billOfMaterials, stats } from './analysis.js';
import { PDF, measure } from './pdf.js';
import { download, safeName } from './io.js';

/** Suggest a build order: bottom-up, then front-to-back within each level. */
export function generatePlan(model, { perStep = 6 } = {}) {
  const bricks = [...model.bricks.values()];
  bricks.sort((a, b) => {
    const ba = model.worldBounds(a), bb = model.worldBounds(b);
    return ba.y0 - bb.y0 || ba.z0 - bb.z0 || ba.x0 - bb.x0;
  });
  const steps = [];
  let cur = null, curY = null, curPart = null;
  for (const b of bricks) {
    const y = model.worldBounds(b).y0;
    const samePart = b.part === curPart && b.color === (cur && model.bricks.get(cur.ids[0])?.color);
    if (!cur || y !== curY || cur.ids.length >= (samePart ? perStep + 4 : perStep)) {
      cur = { id: uid('step'), title: '', note: '', ids: [] };
      steps.push(cur); curY = y;
    }
    cur.ids.push(b.id);
    curPart = b.part;
  }
  steps.forEach((s, i) => { if (!s.title) s.title = defaultTitle(model, s, i); });
  return {
    version: 1, app: VERSION, generated: Date.now(),
    camera: { theta: -0.78, phi: 1.05, radiusScale: 1.25 },
    steps,
  };
}

function defaultTitle(model, step, i) {
  const counts = new Map();
  for (const id of step.ids) {
    const b = model.bricks.get(id);
    if (!b) continue;
    counts.set(b.part, (counts.get(b.part) || 0) + 1);
  }
  const [topPart, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const p = topPart ? getPart(topPart) : null;
  if (!p) return `Step ${i + 1}`;
  return counts.size === 1 ? `Add ${n} × ${p.name}` : `Add ${step.ids.length} pieces`;
}

/** Steps whose pieces would be unreachable by the time they are added. */
export function accessibilityWarnings(model, plan) {
  const placedAbove = new Map();  // "x,z" -> highest top y already placed
  const warnings = [];
  const seen = [];
  plan.steps.forEach((step, i) => {
    for (const id of step.ids) {
      const b = model.bricks.get(id);
      if (!b) continue;
      const bb = model.worldBounds(b);
      let blocked = false;
      for (const prev of seen) {
        if (prev.y0 >= bb.y1 && prev.x0 < bb.x1 && bb.x0 < prev.x1 && prev.z0 < bb.z1 && bb.z0 < prev.z1) { blocked = true; break; }
      }
      if (blocked) {
        warnings.push({ step: i, id, text: `Step ${i + 1} places a piece underneath something already built.` });
        break;
      }
    }
    for (const id of step.ids) {
      const b = model.bricks.get(id);
      if (b) seen.push(model.worldBounds(b));
    }
  });
  return warnings;
}

/** Which bricks are visible at (and including) step index `i`. */
export function bricksThrough(plan, i) {
  const set = new Set();
  for (let k = 0; k <= i && k < plan.steps.length; k++) for (const id of plan.steps[k].ids) set.add(id);
  return set;
}

/** Render one step to a JPEG data URL, with new pieces outlined. */
export function renderStep(view, model, plan, i, width, height) {
  const upTo = bricksThrough(plan, i);
  const isNew = new Set(plan.steps[i]?.ids || []);
  const savedSel = new Set(model.selection);
  const savedFilter = view.filter;
  view.filter = (b) => upTo.has(b.id) && model.isVisible(b);
  model.selection = isNew;
  view.rebuildAll();
  view.updateSelection();
  const url = view.frameJPEG(width, height, 0.85);
  view.filter = savedFilter;
  model.selection = savedSel;
  view.rebuildAll();
  view.updateSelection();
  return url;
}

/** Export every step as a numbered PNG (one download per step). */
export async function exportStepImages(view, model, plan, size = 900) {
  for (let i = 0; i < plan.steps.length; i++) {
    const url = renderStep(view, model, plan, i, size, Math.round(size * 0.72));
    const blob = await (await fetch(url)).blob();
    download(blob, safeName(model.name, `.step-${String(i + 1).padStart(2, '0')}.jpg`));
    await new Promise((r) => setTimeout(r, 120));
  }
}

/* ------------------------------------------------------------------ PDF -- */
const A4 = { w: 595.28, h: 841.89 };
const INK = [0.09, 0.11, 0.13];
const MUTED = [0.42, 0.46, 0.5];
const ACCENT = [0.96, 0.8, 0.18];

export async function exportPDF(view, model, plan, { onProgress } = {}) {
  const pdf = new PDF(A4.w, A4.h, { title: model.name + ' — building instructions' });
  const M = 46;
  const cw = A4.w - M * 2;
  const s = stats(model);

  /* cover ---------------------------------------------------------------- */
  pdf.fill(0, 0, A4.w, 150, [0.98, 0.98, 0.97]);
  pdf.fill(0, 148, A4.w, 5, ACCENT);
  pdf.text(M, 66, 30, model.name, { bold: true, color: INK });
  pdf.text(M, 96, 12, 'Building instructions', { color: MUTED });
  pdf.text(M, 118, 10, `${s.count.toLocaleString()} pieces · ${s.uniqueParts} unique parts · ${plan.steps.length} steps`, { color: MUTED });

  onProgress?.(0, plan.steps.length + 2, 'Rendering the cover');
  const hero = view.frameJPEG(1000, 720, 0.88);
  pdf.image(hero, M, 180, cw, cw * 0.72, 1000, 720);
  let y = 180 + cw * 0.72 + 26;
  pdf.text(M, y, 9, `Generated by BRICKWORK ${VERSION} on ${new Date().toLocaleDateString()}`, { color: MUTED });
  y += 16;
  pdf.paragraph(M, y, cw, 8.5,
    'These instructions are generated automatically from the model. The order is a starting point: check each step before building, and reorder steps where a piece would be hard to reach.',
    { color: MUTED });

  /* inventory ------------------------------------------------------------ */
  pdf.addPage();
  onProgress?.(1, plan.steps.length + 2, 'Laying out the inventory');
  pdf.text(M, 60, 18, 'Pieces you will need', { bold: true, color: INK });
  pdf.line(M, 70, A4.w - M, 70, ACCENT, 2.5);
  const rows = billOfMaterials(model);
  let ry = 96;
  pdf.text(M, ry, 9, 'QTY', { bold: true, color: MUTED });
  pdf.text(M + 44, ry, 9, 'PIECE', { bold: true, color: MUTED });
  pdf.text(M + 300, ry, 9, 'COLOUR', { bold: true, color: MUTED });
  pdf.text(M + 430, ry, 9, 'MASS', { bold: true, color: MUTED });
  ry += 8;
  pdf.line(M, ry, A4.w - M, ry, [0.8, 0.82, 0.84], 0.6);
  ry += 16;
  for (const r of rows) {
    if (ry > A4.h - 70) {
      pdf.addPage();
      pdf.text(M, 60, 14, 'Pieces you will need (continued)', { bold: true, color: INK });
      ry = 90;
    }
    const col = hexToTriple(r.hex);
    pdf.text(M, ry, 10, String(r.qty), { bold: true, color: INK });
    pdf.text(M + 44, ry, 10, r.part, { color: INK });
    pdf.fill(M + 300, ry - 8, 10, 10, col);
    pdf.stroke(M + 300, ry - 8, 10, 10, [0.7, 0.72, 0.74], 0.5);
    pdf.text(M + 316, ry, 9.5, r.color, { color: MUTED });
    pdf.text(M + 430, ry, 9.5, r.mass + ' g', { color: MUTED });
    ry += 17;
  }
  pdf.line(M, ry - 6, A4.w - M, ry - 6, [0.8, 0.82, 0.84], 0.6);
  pdf.text(M, ry + 10, 10, `Total: ${s.count.toLocaleString()} pieces, about ${s.mass} g`, { bold: true, color: INK });

  /* steps ---------------------------------------------------------------- */
  const warn = new Set(accessibilityWarnings(model, plan).map((w) => w.step));
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    onProgress?.(i + 2, plan.steps.length + 2, `Rendering step ${i + 1} of ${plan.steps.length}`);
    if (i % 2 === 0) pdf.addPage();
    const top = i % 2 === 0 ? 56 : A4.h / 2 + 14;
    const imgH = (A4.h / 2 - 120);
    const imgW = imgH * 1.34;
    pdf.text(M, top, 22, String(i + 1), { bold: true, color: ACCENT });
    pdf.text(M + 30, top, 12.5, step.title || `Step ${i + 1}`, { bold: true, color: INK });
    const bits = pieceSummary(model, step);
    pdf.text(M + 30, top + 16, 9, bits, { color: MUTED });
    if (step.note) pdf.paragraph(M + 30, top + 30, cw - 30, 8.5, step.note, { color: MUTED });
    if (warn.has(i)) {
      pdf.text(M + 30, top + (step.note ? 44 : 30), 8.5, '! This step adds a piece under something already built.', { color: [0.75, 0.42, 0.05] });
    }
    const url = renderStep(view, model, plan, i, 880, Math.round(880 / 1.34));
    pdf.image(url, A4.w - M - imgW, top + 26, imgW, imgH, 880, Math.round(880 / 1.34));
    if (i % 2 === 0 && i < plan.steps.length - 1) {
      pdf.line(M, A4.h / 2, A4.w - M, A4.h / 2, [0.85, 0.87, 0.89], 0.6);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress?.(plan.steps.length + 2, plan.steps.length + 2, 'Writing the file');
  download(pdf.blob(), safeName(model.name, '.instructions.pdf'));
}

function pieceSummary(model, step) {
  const counts = new Map();
  for (const id of step.ids) {
    const b = model.bricks.get(id);
    if (!b) continue;
    const p = getPart(b.part);
    const k = (p?.name || b.part) + ' · ' + getColor(b.color).name;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const bits = [...counts.entries()].map(([k, n]) => `${n} × ${k}`);
  let out = bits.join('   ');
  while (measure(out, 9) > 470 && bits.length > 1) { bits.pop(); out = bits.join('   ') + ' …'; }
  return out;
}
function hexToTriple(hex) {
  return [1, 3, 5].map((i) => round(parseInt(hex.slice(i, i + 2), 16) / 255, 3));
}
