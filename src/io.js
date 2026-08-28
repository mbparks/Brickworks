/* BRICKWORK — import and export.
 *
 * Everything here runs locally. Files are produced with Blob URLs and handed
 * to the browser's own download mechanism; nothing is uploaded.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { SCHEMA_VERSION, VERSION, HALF, PLATE, getColor, round, uid } from './core.js';
import { getPart } from './parts.js';
import { validateProject } from './model.js';
import { mergedGeometry } from './geometry.js';
import { composeMatrix } from './view.js';
import { billOfMaterials, stats } from './analysis.js';

/* ---------------------------------------------------------------- files -- */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function safeName(s, ext) {
  const base = String(s || 'brickwork').replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'brickwork';
  return base + ext;
}
export function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`"${file.name}" could not be read.`));
    if (as === 'text') r.readAsText(file); else r.readAsArrayBuffer(file);
  });
}
export async function pickFile(accept = '.json,.bwp,.bwshare') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files && i.files[0] ? i.files[0] : null);
    i.oncancel = () => resolve(null);
    i.click();
  });
}

/* --------------------------------------------------------------- import -- */
export async function parseProjectFile(file) {
  const text = await readFile(file, 'text');
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`"${file.name}" is not valid JSON, so it cannot be a BRICKWORK project.`); }
  const v = validateProject(data);
  if (!v.ok) throw new Error(v.error);
  return { data, warnings: v.warnings };
}

/* --------------------------------------------------------------- export -- */
export function exportProject(model) {
  const json = model.toJSON();
  download(new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' }), safeName(model.name, '.bwp.json'));
  return json;
}
export function exportShare(model) {
  const json = model.toJSON();
  json.format = 'brickwork-share';
  delete json.steps;
  download(new Blob([JSON.stringify(json)], { type: 'application/json' }), safeName(model.name, '.bwshare.json'));
}
export function exportInventory(model) {
  const rows = billOfMaterials(model);
  const doc = {
    format: 'brickwork-inventory', schema: SCHEMA_VERSION, app: VERSION,
    project: model.name, generated: new Date().toISOString(),
    total: model.bricks.size, lines: rows,
  };
  download(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), safeName(model.name, '.inventory.json'));
}
export function exportBOMCSV(model) {
  const rows = billOfMaterials(model);
  const head = ['Quantity', 'Part ID', 'Part', 'Category', 'Size', 'Colour', 'Hex', 'Unit mass (g)', 'Total mass (g)', 'Est. cost'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.qty, r.partId, r.part, r.category, r.size, r.color, r.hex, r.unitMass, r.mass, r.cost]
      .map(csv).join(','));
  }
  const s = stats(model);
  lines.push('');
  lines.push(csv('Total pieces') + ',' + s.count);
  lines.push(csv('Unique parts') + ',' + s.uniqueParts);
  lines.push(csv('Estimated mass (g)') + ',' + s.mass);
  download(new Blob([lines.join('\r\n')], { type: 'text/csv' }), safeName(model.name, '.bom.csv'));
}
function csv(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function exportPNG(view, model, transparent) {
  const url = view.snapshot({ transparent });
  fetch(url).then((r) => r.blob()).then((b) => download(b, safeName(model.name, transparent ? '.transparent.png' : '.png')));
}

/* --------------------------------------------------------- mesh exports -- */
function triangles(model, onTri) {
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const brick of model.bricks.values()) {
    const p = getPart(brick.part);
    const geo = mergedGeometry(brick.part);
    if (!p || !geo) continue;
    composeMatrix(m, p, brick);
    nm.getNormalMatrix(m);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(m);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(m);
      nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      onTri(a, b, c, nrm, brick);
    }
  }
}
export function countTriangles(model) {
  let n = 0;
  for (const brick of model.bricks.values()) {
    const g = mergedGeometry(brick.part);
    if (g) n += g.getAttribute('position').count / 3;
  }
  return n;
}
export function exportOBJ(model) {
  const out = [
    '# BRICKWORK ' + VERSION + ' — ' + model.name,
    '# Millimetre units. Visualisation geometry only: it has no clearances,',
    '# no wall thickness rules and no manufacturing tolerances.',
    'mtllib ' + safeName(model.name, '.mtl'),
  ];
  const mtl = ['# BRICKWORK materials'];
  const seen = new Set();
  let vi = 1;
  let current = '';
  triangles(model, (a, b, c, n, brick) => {
    if (brick.color !== current) {
      current = brick.color;
      const col = getColor(current);
      if (!seen.has(current)) {
        seen.add(current);
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(col.hex.slice(i, i + 2), 16) / 255);
        mtl.push(`newmtl ${current}`, `Kd ${round(r, 3)} ${round(g, 3)} ${round(bl, 3)}`,
          `Ks 0.2 0.2 0.2`, `Ns 40`, col.type === 'trans' ? 'd 0.55' : 'd 1.0', '');
      }
      out.push('usemtl ' + current);
    }
    out.push(`v ${f(a.x)} ${f(a.y)} ${f(a.z)}`, `v ${f(b.x)} ${f(b.y)} ${f(b.z)}`, `v ${f(c.x)} ${f(c.y)} ${f(c.z)}`);
    out.push(`vn ${f(n.x)} ${f(n.y)} ${f(n.z)}`);
    const k = (vi - 1) / 3 + 1;
    out.push(`f ${vi}//${k} ${vi + 1}//${k} ${vi + 2}//${k}`);
    vi += 3;
  });
  download(new Blob([out.join('\n')], { type: 'text/plain' }), safeName(model.name, '.obj'));
  download(new Blob([mtl.join('\n')], { type: 'text/plain' }), safeName(model.name, '.mtl'));
}
export function exportSTL(model) {
  const n = countTriangles(model);
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = `BRICKWORK ${VERSION} ${model.name} - visualisation geometry, not manufacturing ready`;
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 32);
  dv.setUint32(80, n, true);
  let o = 84;
  triangles(model, (a, b, c, nr) => {
    dv.setFloat32(o, nr.x, true); dv.setFloat32(o + 4, nr.y, true); dv.setFloat32(o + 8, nr.z, true);
    dv.setFloat32(o + 12, a.x, true); dv.setFloat32(o + 16, a.y, true); dv.setFloat32(o + 20, a.z, true);
    dv.setFloat32(o + 24, b.x, true); dv.setFloat32(o + 28, b.y, true); dv.setFloat32(o + 32, b.z, true);
    dv.setFloat32(o + 36, c.x, true); dv.setFloat32(o + 40, c.y, true); dv.setFloat32(o + 44, c.z, true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  });
  download(new Blob([buf], { type: 'model/stl' }), safeName(model.name, '.stl'));
}
const f = (v) => (Math.round(v * 1000) / 1000).toString();

/* ---------------------------------------------------------- share links -- */
/** Compact binary encoding for very small models, carried in a URL fragment. */
export function encodeShare(model) {
  const bricks = [...model.bricks.values()];
  const parts = [], colors = [];
  const pi = new Map(), ci = new Map();
  for (const b of bricks) {
    if (!pi.has(b.part)) { pi.set(b.part, parts.length); parts.push(b.part); }
    if (!ci.has(b.color)) { ci.set(b.color, colors.length); colors.push(b.color); }
  }
  const bytes = [];
  const u8 = (v) => bytes.push(v & 0xff);
  const varint = (v) => { v = v >>> 0; while (v > 127) { u8((v & 127) | 128); v >>>= 7; } u8(v); };
  const zig = (v) => varint((v << 1) ^ (v >> 31));
  const str = (s) => { varint(s.length); for (let i = 0; i < s.length; i++) u8(s.charCodeAt(i)); };
  u8(0x42); u8(0x57); u8(1);                    // "BW", version 1
  str(model.name.slice(0, 48));
  varint(model.settings.baseW); varint(model.settings.baseD);
  varint(parts.length); for (const p of parts) str(p);
  varint(colors.length); for (const c of colors) str(c);
  varint(bricks.length);
  for (const b of bricks) {
    varint(pi.get(b.part)); varint(ci.get(b.color));
    zig(b.x); zig(b.y); zig(b.z); u8(b.r & 3);
  }
  let bin = '';
  for (const v of bytes) bin += String.fromCharCode(v);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeShare(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let o = 0;
  const u8 = () => bytes[o++];
  const varint = () => { let v = 0, s = 0, c; do { c = bytes[o++]; v |= (c & 127) << s; s += 7; } while (c & 128); return v >>> 0; };
  const zig = () => { const v = varint(); return (v >>> 1) ^ -(v & 1); };
  const str = () => { const n = varint(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[o++]); return s; };
  if (u8() !== 0x42 || u8() !== 0x57) throw new Error('That link does not contain a BRICKWORK model.');
  const ver = u8();
  if (ver !== 1) throw new Error('That shared link uses a newer format than this build understands.');
  const name = str();
  const baseW = varint(), baseD = varint();
  const parts = []; let n = varint();
  for (let i = 0; i < n; i++) parts.push(str());
  const colors = []; n = varint();
  for (let i = 0; i < n; i++) colors.push(str());
  const count = varint();
  const bricks = [];
  for (let i = 0; i < count; i++) {
    const p = parts[varint()], c = colors[varint()];
    const x = zig(), y = zig(), z = zig(), r = u8() & 3;
    bricks.push({ i: uid('brk'), p, c, x, y, z, r, l: 'layer_base' });
  }
  return {
    format: 'brickwork-project', schema: SCHEMA_VERSION, app: VERSION,
    id: uid('proj'), name: name || 'Shared build', created: Date.now(),
    settings: { baseW, baseD }, layers: null, groups: [], bricks,
  };
}
export const SHARE_LIMIT = 4000;   // characters of fragment we are willing to make
export function shareURL(model) {
  const frag = encodeShare(model);
  if (frag.length > SHARE_LIMIT) return { ok: false, length: frag.length, reason: `This model encodes to ${frag.length.toLocaleString()} characters, past the ${SHARE_LIMIT.toLocaleString()}-character limit for links. Export a share file instead.` };
  return { ok: true, url: location.origin + location.pathname + '#build=' + frag, length: frag.length };
}

/* --------------------------------------------------------- summary card -- */
export function projectSummary(model) {
  const s = stats(model);
  const rows = billOfMaterials(model).slice(0, 8);
  const L = [];
  L.push(`${model.name}`);
  L.push(`${s.count.toLocaleString()} pieces · ${s.uniqueParts} unique parts · ${s.colors} colours`);
  if (s.size) L.push(`Size: ${s.size.studsX} × ${s.size.studsZ} studs, ${s.size.plates} plates tall (${s.size.mmX} × ${s.size.mmZ} × ${s.size.mmY} mm)`);
  L.push(`Estimated mass: ${s.mass} g`);
  L.push('');
  L.push('Most-used pieces:');
  for (const r of rows) L.push(`  ${String(r.qty).padStart(4)} × ${r.part} (${r.color})`);
  L.push('');
  L.push(`Made with BRICKWORK ${VERSION}`);
  return L.join('\n');
}
/** A shareable preview card: rendered image plus a caption strip. */
export async function previewCard(view, model) {
  const img = view.snapshot({ transparent: false });
  const s = stats(model);
  const W = 1200, H = 760;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#161b21'; g.fillRect(0, 0, W, H);
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('The preview image could not be drawn.')); im.src = img; });
  const scale = Math.min(W / im.width, (H - 120) / im.height);
  const dw = im.width * scale, dh = im.height * scale;
  g.drawImage(im, (W - dw) / 2, 0, dw, dh);
  g.fillStyle = '#f5cd2f'; g.fillRect(0, H - 118, W, 6);
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillText(model.name.slice(0, 40), 40, H - 58);
  g.font = '24px system-ui, sans-serif';
  g.fillStyle = '#9aa5b1';
  g.fillText(`${s.count.toLocaleString()} pieces · ${s.uniqueParts} unique parts · ${s.mass} g · built in BRICKWORK`, 40, H - 20);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
