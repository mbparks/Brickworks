/* BRICKWORK — core constants, units, colour system, small utilities.
 * No dependencies. Everything downstream imports units and helpers from here. */

export const VERSION = '1.0.0';
export const SCHEMA_VERSION = 3;      // project file schema
export const APP_NAME = 'BRICKWORK';

/* ---------------------------------------------------------------- units --
 * Scene units are millimetres.
 * Grid coordinates are integers:
 *   x, z  in HALF-STUD units  (4 mm)   — allows half-stud offsets
 *   y     in PLATE units      (3.2 mm) — 3 plates = 1 brick
 */
export const STUD = 8;          // stud pitch, mm
export const HALF = STUD / 2;   // 4 mm
export const PLATE = 3.2;       // plate height, mm
export const BRICK_H = PLATE * 3;
export const STUD_R = 2.4;      // stud radius, mm
export const STUD_H = 1.8;      // stud height, mm
export const BEVEL = 0.35;      // edge chamfer, mm
export const PLASTIC_DENSITY = 1.05e-3; // g / mm^3 (ABS)

export const gx = (h) => h * HALF;   // half-stud -> mm
export const gy = (p) => p * PLATE;  // plate     -> mm

/* -------------------------------------------------------------- helpers -- */
let _seq = 0;
export function uid(prefix = 'b') {
  _seq = (_seq + 1) % 1e6;
  return prefix + '_' + Date.now().toString(36) + '_' + _seq.toString(36) +
    Math.floor(Math.random() * 1296).toString(36);
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
export function deepClone(o) {
  return (typeof structuredClone === 'function') ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}
export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms) {
  let last = 0, pend = null;
  return (...a) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(pend); pend = setTimeout(() => { last = performance.now(); fn(...a); }, ms - (now - last)); }
  };
}
export function fmtInt(n) { return (n | 0).toLocaleString(); }
export function fmtMM(n) { return round(n, 1).toLocaleString() + ' mm'; }
export function fmtMass(g) {
  return g >= 1000 ? round(g / 1000, 2) + ' kg' : round(g, g < 10 ? 2 : 1) + ' g';
}
export function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

/* ---------------------------------------------------------------- colour --
 * Palette in the spirit of common interlocking-brick colours. Names and hex
 * values are our own; nothing here is taken from a proprietary colour list.
 * type: solid | trans | metal | rubber | glow
 */
export const COLORS = [
  { id: 'white', name: 'White', hex: '#F2F3F2', type: 'solid' },
  { id: 'lightgray', name: 'Light Stone', hex: '#A3A9A8', type: 'solid' },
  { id: 'gray', name: 'Medium Stone', hex: '#6C6E68', type: 'solid' },
  { id: 'darkgray', name: 'Dark Stone', hex: '#4A4D4C', type: 'solid' },
  { id: 'black', name: 'Black', hex: '#1B2A34', type: 'solid' },
  { id: 'red', name: 'Bright Red', hex: '#C4281B', type: 'solid' },
  { id: 'darkred', name: 'Dark Red', hex: '#7B2222', type: 'solid' },
  { id: 'orange', name: 'Bright Orange', hex: '#F07C1F', type: 'solid' },
  { id: 'yellow', name: 'Bright Yellow', hex: '#F5CD2F', type: 'solid' },
  { id: 'tan', name: 'Brick Yellow', hex: '#D9BB7C', type: 'solid' },
  { id: 'darktan', name: 'Dark Tan', hex: '#A08155', type: 'solid' },
  { id: 'brown', name: 'Reddish Brown', hex: '#6C3A2A', type: 'solid' },
  { id: 'green', name: 'Dark Green', hex: '#237841', type: 'solid' },
  { id: 'brightgreen', name: 'Bright Green', hex: '#58AB41', type: 'solid' },
  { id: 'lime', name: 'Lime', hex: '#BBE90B', type: 'solid' },
  { id: 'sand', name: 'Sand Green', hex: '#93AD9C', type: 'solid' },
  { id: 'teal', name: 'Teal', hex: '#008F9B', type: 'solid' },
  { id: 'blue', name: 'Bright Blue', hex: '#1E5AA8', type: 'solid' },
  { id: 'skyblue', name: 'Medium Blue', hex: '#6D9FD4', type: 'solid' },
  { id: 'darkblue', name: 'Earth Blue', hex: '#1B2A4A', type: 'solid' },
  { id: 'purple', name: 'Bright Violet', hex: '#6A3AA0', type: 'solid' },
  { id: 'lavender', name: 'Lavender', hex: '#B39CD0', type: 'solid' },
  { id: 'magenta', name: 'Bright Purple', hex: '#C870A0', type: 'solid' },
  { id: 'pink', name: 'Light Pink', hex: '#F6ADCD', type: 'solid' },
  { id: 'transclear', name: 'Transparent', hex: '#EDF3F5', type: 'trans' },
  { id: 'transred', name: 'Transparent Red', hex: '#C91A09', type: 'trans' },
  { id: 'transorange', name: 'Transparent Orange', hex: '#F08F1C', type: 'trans' },
  { id: 'transyellow', name: 'Transparent Yellow', hex: '#F5CD2F', type: 'trans' },
  { id: 'transgreen', name: 'Transparent Green', hex: '#5AC24E', type: 'trans' },
  { id: 'transblue', name: 'Transparent Blue', hex: '#3E95CE', type: 'trans' },
  { id: 'transpurple', name: 'Transparent Violet', hex: '#8A6FB8', type: 'trans' },
  { id: 'transsmoke', name: 'Transparent Smoke', hex: '#5C5B57', type: 'trans' },
  { id: 'silver', name: 'Silver', hex: '#B9BDBC', type: 'metal' },
  { id: 'gold', name: 'Gold', hex: '#C9A227', type: 'metal' },
  { id: 'copper', name: 'Copper', hex: '#A05A34', type: 'metal' },
  { id: 'steel', name: 'Steel', hex: '#6E7679', type: 'metal' },
  { id: 'rubberblack', name: 'Rubber Black', hex: '#22252A', type: 'rubber' },
  { id: 'rubbergray', name: 'Rubber Grey', hex: '#4C5157', type: 'rubber' },
  { id: 'glowgreen', name: 'Glow Green', hex: '#D4F5C0', type: 'glow' },
  { id: 'glowblue', name: 'Glow Blue', hex: '#C3E8F5', type: 'glow' },
];
export const COLOR_TYPES = [
  { id: 'solid', name: 'Solid' },
  { id: 'trans', name: 'Transparent' },
  { id: 'metal', name: 'Metallic' },
  { id: 'rubber', name: 'Rubber' },
  { id: 'glow', name: 'Glow' },
];
const COLOR_MAP = new Map(COLORS.map((c) => [c.id, c]));
/** Custom colours are registered at runtime as `#rrggbb` ids. */
const CUSTOM = new Map();
export function registerCustomColor(hex, type = 'solid') {
  hex = normalizeHex(hex);
  if (!hex) return null;
  const id = 'x' + hex.slice(1).toLowerCase();
  if (!CUSTOM.has(id)) CUSTOM.set(id, { id, name: 'Custom ' + hex.toUpperCase(), hex, type, custom: true });
  return id;
}
export function getColor(id) {
  return COLOR_MAP.get(id) || CUSTOM.get(id) ||
    { id: id || 'lightgray', name: 'Unknown colour', hex: '#A3A9A8', type: 'solid', missing: true };
}
export function allColors() { return COLORS.concat([...CUSTOM.values()]); }
export function normalizeHex(h) {
  if (typeof h !== 'string') return null;
  h = h.trim();
  if (/^#?[0-9a-fA-F]{3}$/.test(h)) {
    h = h.replace('#', '');
    return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (/^#?[0-9a-fA-F]{6}$/.test(h)) return '#' + h.replace('#', '').toLowerCase();
  return null;
}
export function hexToRgb(h) {
  const n = parseInt(normalizeHex(h).slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function readableInk(hex) { return relLuminance(hex) > 0.42 ? '#14181d' : '#f4f6f8'; }

/* Colour-blind-friendly substitution map, used by the "Accessible palette"
 * render style. Values are from a high-separation qualitative ramp. */
export const CVD_RAMP = ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442',
  '#0072B2', '#D55E00', '#CC79A7', '#FFFFFF', '#767676'];
export function cvdSubstitute(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CVD_RAMP[h % CVD_RAMP.length];
}

/* ---------------------------------------------------------- feedback bus -- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  const s = listeners.get(evt);
  if (s) for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error('[brickwork]', evt, e); } }
}
