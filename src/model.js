/* BRICKWORK — project model.
 *
 * Holds the authoritative project state: bricks, layers, groups, settings.
 * Every mutation goes through `model.transaction()`, which records an undo
 * entry, so undo and redo cover all editing operations uniformly.
 *
 * A brick record:
 *   { id, part, color, x, y, z, r, fine?, layer, group?, hidden?, locked? }
 * where x,z are half-stud units, y is plate units, r is 0..3 (90° steps) and
 * `fine` is extra degrees of yaw for parts that allow it.
 */
import { SCHEMA_VERSION, VERSION, uid, emit, deepClone, clamp } from './core.js';
import { getPart } from './parts.js';

export const DEFAULT_SETTINGS = () => ({
  mode: 'easy',                 // easy | advanced
  renderStyle: 'realistic',
  theme: 'dark',
  background: '#20262e',
  showGrid: true,
  showShadows: true,
  showBaseplate: true,
  baseW: 32, baseD: 32,         // building surface, studs
  autoExpand: true,
  snapHalf: false,              // allow half-stud offsets
  freePlace: false,             // ignore stud snapping
  snapAssist: 0.8,              // 0..1
  collisionOverride: false,
  sound: false,
  haptics: true,
  reducedMotion: false,
  highContrast: false,
  uiScale: 1,
  shadowQuality: 'medium',      // off | low | medium | high
  performanceMode: false,
  turntable: false,
  ortho: false,
  costPerBrick: 0.10,
  currency: '$',
});

export class Model {
  constructor() { this.reset(); }

  reset(name = 'Untitled build') {
    this.id = uid('proj');
    this.name = name;
    this.created = Date.now();
    this.modified = Date.now();
    this.bricks = new Map();
    this.layers = [{ id: 'layer_base', name: 'Layer 1', color: '#F5CD2F', visible: true, locked: false }];
    this.groups = new Map();
    this.settings = DEFAULT_SETTINGS();
    this.steps = null;                 // instruction plan, when generated
    this.activeLayer = 'layer_base';
    this.selection = new Set();
    this.undoStack = []; this.redoStack = [];
    this._tx = null;
    this._grid = new Map();
    this.dirty = false;
    this.savedAt = 0;
  }

  /* --------------------------------------------------------- geometry --- */
  /** World-space collision boxes (half-stud / plate units) for a brick. */
  worldBoxes(b) {
    const p = getPart(b.part);
    if (!p) return [];
    return p.collision.map((c) => rot(c, p, b));
  }
  worldBounds(b) {
    const boxes = this.worldBoxes(b);
    if (!boxes.length) return null;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const q of boxes) {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); z0 = Math.min(z0, q.z);
      x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); z1 = Math.max(z1, q.z + q.d);
    }
    return { x0, y0, z0, x1, y1, z1 };
  }
  /** World stud anchor positions (half-stud x/z, plate y) on top of a brick. */
  worldStuds(b) {
    const p = getPart(b.part);
    if (!p) return [];
    const y = b.y + p.h;
    return p.studs.map(([sx, sz]) => {
      const [wx, wz] = rotPoint(sx, sz, p, b);
      return { x: wx, z: wz, y };
    });
  }
  /** World footprint of the whole model. */
  bounds(ids = null) {
    let r = null;
    for (const b of this.bricks.values()) {
      if (ids && !ids.has(b.id)) continue;
      const bb = this.worldBounds(b);
      if (!bb) continue;
      r = r ? {
        x0: Math.min(r.x0, bb.x0), y0: Math.min(r.y0, bb.y0), z0: Math.min(r.z0, bb.z0),
        x1: Math.max(r.x1, bb.x1), y1: Math.max(r.y1, bb.y1), z1: Math.max(r.z1, bb.z1),
      } : { ...bb };
    }
    return r;
  }

  /* ---------------------------------------------------- spatial index --- */
  _keys(bb) {
    const out = [];
    for (let x = Math.floor(bb.x0 / 8); x <= Math.floor((bb.x1 - 0.001) / 8); x++)
      for (let y = Math.floor(bb.y0 / 6); y <= Math.floor((bb.y1 - 0.001) / 6); y++)
        for (let z = Math.floor(bb.z0 / 8); z <= Math.floor((bb.z1 - 0.001) / 8); z++)
          out.push(x + ',' + y + ',' + z);
    return out;
  }
  _index(b, add) {
    const bb = this.worldBounds(b);
    if (!bb) return;
    for (const k of this._keys(bb)) {
      let s = this._grid.get(k);
      if (add) { if (!s) this._grid.set(k, s = new Set()); s.add(b.id); }
      else if (s) { s.delete(b.id); if (!s.size) this._grid.delete(k); }
    }
  }
  /** Bricks whose bucket overlaps this world bounding box. */
  near(bb, pad = 0) {
    const q = { x0: bb.x0 - pad, y0: bb.y0 - pad, z0: bb.z0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad, z1: bb.z1 + pad };
    const out = new Set();
    for (const k of this._keys(q)) { const s = this._grid.get(k); if (s) for (const id of s) out.add(id); }
    return out;
  }
  /** ids of bricks physically overlapping the candidate (excluding `skip`). */
  collisions(candidate, skip = null) {
    const bb = this.worldBounds(candidate);
    if (!bb) return [];
    const boxes = this.worldBoxes(candidate);
    const hits = [];
    for (const id of this.near(bb)) {
      if (id === candidate.id || (skip && skip.has(id))) continue;
      const other = this.bricks.get(id);
      if (!other) continue;
      const ob = this.worldBoxes(other);
      if (boxes.some((a) => ob.some((c) => overlap(a, c)))) hits.push(id);
    }
    return hits;
  }

  /* ------------------------------------------------------ transactions --- */
  transaction(label, fn) {
    if (this._tx) { fn(); return; }            // nested — join the parent
    const tx = { label, ops: [], at: Date.now() };
    this._tx = tx;
    let result;
    try { result = fn(); }
    finally {
      this._tx = null;
      if (tx.ops.length) {
        this.undoStack.push(tx);
        if (this.undoStack.length > 250) this.undoStack.shift();
        this.redoStack.length = 0;
        this.touch();
        emit('model:changed', { label, tx });
      }
    }
    return result;
  }
  _record(op) { if (this._tx) this._tx.ops.push(op); }
  touch() { this.modified = Date.now(); this.dirty = true; emit('model:dirty'); }

  undo() { return this._replay(this.undoStack, this.redoStack, true); }
  redo() { return this._replay(this.redoStack, this.undoStack, false); }
  _replay(from, to, reverse) {
    const tx = from.pop();
    if (!tx) return null;
    const ops = reverse ? [...tx.ops].reverse() : tx.ops;
    for (const op of ops) this._applyOp(op, reverse);
    to.push(tx);
    this.touch();
    emit('model:changed', { label: (reverse ? 'Undo ' : 'Redo ') + tx.label, tx, replay: true });
    return tx.label;
  }
  _applyOp(op, reverse) {
    switch (op.op) {
      case 'add':
        if (reverse) this._rawRemove(op.brick.id); else this._rawAdd(deepClone(op.brick));
        break;
      case 'remove':
        if (reverse) this._rawAdd(deepClone(op.brick)); else this._rawRemove(op.brick.id);
        break;
      case 'update': {
        const b = this.bricks.get(op.id);
        if (!b) break;
        this._index(b, false);
        Object.assign(b, deepClone(reverse ? op.before : op.after));
        this._index(b, true);
        break;
      }
      case 'layers': this.layers = deepClone(reverse ? op.before : op.after); break;
      case 'groups': this.groups = new Map(deepClone(reverse ? op.before : op.after)); break;
      case 'settings': this.settings = deepClone(reverse ? op.before : op.after); break;
      case 'steps': this.steps = deepClone(reverse ? op.before : op.after); break;
    }
  }
  get undoLabel() { return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null; }
  get redoLabel() { return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null; }

  /* ---------------------------------------------------------- mutation --- */
  _rawAdd(b) { this.bricks.set(b.id, b); this._index(b, true); }
  _rawRemove(id) { const b = this.bricks.get(id); if (b) { this._index(b, false); this.bricks.delete(id); this.selection.delete(id); } }

  addBrick(def) {
    const b = Object.assign({
      id: uid('brk'), part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0, r: 0,
      layer: this.activeLayer,
    }, def);
    if (!getPart(b.part)) return null;
    if (!this.layers.some((l) => l.id === b.layer)) b.layer = this.layers[0].id;
    this._rawAdd(b);
    this._record({ op: 'add', brick: deepClone(b) });
    return b;
  }
  removeBrick(id) {
    const b = this.bricks.get(id);
    if (!b) return false;
    this._record({ op: 'remove', brick: deepClone(b) });
    this._rawRemove(id);
    return true;
  }
  updateBrick(id, props) {
    const b = this.bricks.get(id);
    if (!b) return false;
    const before = {}, after = {};
    let any = false;
    for (const k of Object.keys(props)) {
      if (b[k] === props[k]) continue;
      before[k] = b[k]; after[k] = props[k]; any = true;
    }
    if (!any) return false;
    this._index(b, false);
    Object.assign(b, after);
    this._index(b, true);
    this._record({ op: 'update', id, before: deepClone(before), after: deepClone(after) });
    return true;
  }
  /** Mutate without recording undo — used for live drag previews only. */
  setSilent(id, props) {
    const b = this.bricks.get(id);
    if (!b) return;
    this._index(b, false);
    Object.assign(b, props);
    this._index(b, true);
  }
  setLayers(next, label = 'Layers') {
    this._record({ op: 'layers', before: deepClone(this.layers), after: deepClone(next) });
    this.layers = next;
  }
  setGroups(next) {
    this._record({ op: 'groups', before: [...this.groups], after: [...next] });
    this.groups = next;
  }
  setSteps(next) {
    this._record({ op: 'steps', before: deepClone(this.steps), after: deepClone(next) });
    this.steps = next;
  }
  /** Settings changes are not undoable by default (they are view preferences),
   *  but destructive ones (surface size) pass `undoable: true`. */
  set(key, value, undoable = false) {
    if (this.settings[key] === value) return;
    if (undoable) {
      const before = deepClone(this.settings);
      this.settings[key] = value;
      this._record({ op: 'settings', before, after: deepClone(this.settings) });
    } else this.settings[key] = value;
    this.touch();
    emit('settings:changed', { key, value });
  }

  /* ---------------------------------------------------------- queries --- */
  layer(id) { return this.layers.find((l) => l.id === id) || this.layers[0]; }
  isEditable(b) {
    if (!b || b.locked) return false;
    const l = this.layer(b.layer);
    return !(l.locked || !l.visible) && !b.hidden;
  }
  isVisible(b) {
    if (!b || b.hidden) return false;
    const l = this.layer(b.layer);
    return !!l.visible;
  }
  visibleBricks() { return [...this.bricks.values()].filter((b) => this.isVisible(b)); }
  groupMembers(gid) { return [...this.bricks.values()].filter((b) => b.group === gid); }

  /** Bricks connected to `id` through stud/tube contact. */
  connectedTo(id, limit = 100000) {
    const seen = new Set([id]);
    const queue = [id];
    const adj = this.adjacency();
    while (queue.length && seen.size < limit) {
      const cur = queue.pop();
      for (const n of adj.get(cur) || []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen;
  }
  /** Connection graph. A→B when their footprints overlap on a shared face and
   *  the lower piece has studs the upper piece can accept. */
  adjacency(force = false) {
    if (!force && this._adjCache && this._adjKey === this.bricks.size + ':' + this.modified) return this._adjCache;
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    };
    for (const b of this.bricks.values()) {
      adj.set(b.id, adj.get(b.id) || new Set());
      const p = getPart(b.part);
      if (!p) continue;
      const bb = this.worldBounds(b);
      for (const oid of this.near(bb, 2)) {
        if (oid <= b.id) continue;
        const o = this.bricks.get(oid);
        if (!o) continue;
        const op = getPart(o.part);
        if (!op) continue;
        const ob = this.worldBounds(o);
        const E = 0.001;
        if (bb.x0 > ob.x1 + E || ob.x0 > bb.x1 + E || bb.z0 > ob.z1 + E || ob.z0 > bb.z1 + E) continue;
        const overXZ = bb.x0 < ob.x1 && ob.x0 < bb.x1 && bb.z0 < ob.z1 && ob.z0 < bb.z1;
        // studs into tubes, or a studless piece (beam, axle, bar, wheel)
        // simply resting on top of something
        const bOnO = overXZ && Math.abs(bb.y0 - ob.y1) < E && (op.studs.length > 0 || !p.tubes);
        const oOnB = overXZ && Math.abs(ob.y0 - bb.y1) < E && (p.studs.length > 0 || !op.tubes);
        // side attachment: faces in contact where at least one piece is a
        // studless connector or carries side studs or a clip
        const faceX = (Math.abs(bb.x0 - ob.x1) < E || Math.abs(ob.x0 - bb.x1) < E) && bb.z0 < ob.z1 && ob.z0 < bb.z1;
        const faceZ = (Math.abs(bb.z0 - ob.z1) < E || Math.abs(ob.z0 - bb.z1) < E) && bb.x0 < ob.x1 && ob.x0 < bb.x1;
        const yOverlap = bb.y0 < ob.y1 && ob.y0 < bb.y1;
        const sideOK = yOverlap && (faceX || faceZ) && (!p.tubes || !op.tubes || p.side || op.side);
        if (bOnO || oOnB || sideOK) link(b.id, oid);
      }
    }
    this._adjCache = adj;
    this._adjKey = this.bricks.size + ':' + this.modified;
    return adj;
  }

  /* ------------------------------------------------------ serialisation --- */
  toJSON() {
    return {
      format: 'brickwork-project',
      schema: SCHEMA_VERSION,
      app: VERSION,
      id: this.id,
      name: this.name,
      created: this.created,
      modified: this.modified,
      settings: deepClone(this.settings),
      layers: deepClone(this.layers),
      groups: [...this.groups.values()].map((g) => deepClone(g)),
      steps: this.steps ? deepClone(this.steps) : null,
      bricks: [...this.bricks.values()].map((b) => compact(b)),
    };
  }
  loadJSON(data) {
    const v = validateProject(data);
    if (!v.ok) throw new Error(v.error);
    this.reset(data.name || 'Imported build');
    this.id = data.id || this.id;
    this.created = data.created || Date.now();
    this.settings = Object.assign(DEFAULT_SETTINGS(), data.settings || {});
    if (Array.isArray(data.layers) && data.layers.length) this.layers = deepClone(data.layers);
    this.activeLayer = this.layers[0].id;
    this.groups = new Map((data.groups || []).map((g) => [g.id, g]));
    this.steps = data.steps || null;
    for (const raw of data.bricks || []) {
      const b = expand(raw);
      if (!getPart(b.part)) { v.warnings.push('Unknown part skipped: ' + b.part); continue; }
      if (!this.layers.some((l) => l.id === b.layer)) b.layer = this.layers[0].id;
      this._rawAdd(b);
    }
    this.dirty = false;
    emit('model:loaded', { warnings: v.warnings });
    return v.warnings;
  }
}

/* --------------------------------------------------------------- utils --- */
export function overlap(a, c) {
  return a.x < c.x + c.w && c.x < a.x + a.w &&
    a.y < c.y + c.h && c.y < a.y + a.h &&
    a.z < c.z + c.d && c.z < a.z + a.d;
}
/** Rotate a local box into world half-stud/plate space. */
export function rot(c, p, b) {
  const { hx, hz } = p;
  switch (b.r & 3) {
    case 1: return { x: b.x + c.z, y: b.y + c.y, z: b.z + hx - c.x - c.w, w: c.d, h: c.h, d: c.w };
    case 2: return { x: b.x + hx - c.x - c.w, y: b.y + c.y, z: b.z + hz - c.z - c.d, w: c.w, h: c.h, d: c.d };
    case 3: return { x: b.x + hz - c.z - c.d, y: b.y + c.y, z: b.z + c.x, w: c.d, h: c.h, d: c.w };
    default: return { x: b.x + c.x, y: b.y + c.y, z: b.z + c.z, w: c.w, h: c.h, d: c.d };
  }
}
export function rotPoint(lx, lz, p, b) {
  const { hx, hz } = p;
  switch (b.r & 3) {
    case 1: return [b.x + lz, b.z + hx - lx];
    case 2: return [b.x + hx - lx, b.z + hz - lz];
    case 3: return [b.x + hz - lz, b.z + lx];
    default: return [b.x + lx, b.z + lz];
  }
}
/** Footprint size in half-studs after rotation. */
export function footprint(p, r) { return (r & 1) ? { w: p.hz, d: p.hx } : { w: p.hx, d: p.hz }; }
/** Mesh translation (half-studs) that keeps the rotated part at its min corner. */
export function meshOffset(p, r) {
  switch (r & 3) {
    case 1: return [0, p.hx];
    case 2: return [p.hx, p.hz];
    case 3: return [p.hz, 0];
    default: return [0, 0];
  }
}

function compact(b) {
  const o = { i: b.id, p: b.part, c: b.color, x: b.x, y: b.y, z: b.z, r: b.r, l: b.layer };
  if (b.fine) o.f = b.fine;
  if (b.group) o.g = b.group;
  if (b.hidden) o.H = 1;
  if (b.locked) o.L = 1;
  return o;
}
function expand(o) {
  if (o.part) return { ...o };  // already long-form
  const b = { id: o.i || uid('brk'), part: o.p, color: o.c, x: o.x | 0, y: o.y | 0, z: o.z | 0, r: (o.r | 0) & 3, layer: o.l };
  if (o.f) b.fine = o.f;
  if (o.g) b.group = o.g;
  if (o.H) b.hidden = true;
  if (o.L) b.locked = true;
  return b;
}

/** Structural validation of an imported project file. */
export function validateProject(data) {
  const warnings = [];
  if (!data || typeof data !== 'object') return { ok: false, error: 'The file is not a BRICKWORK project.' };
  if (data.format !== 'brickwork-project' && data.format !== 'brickwork-share') {
    return { ok: false, error: 'This file is not a BRICKWORK project — the format marker is missing.' };
  }
  const schema = data.schema | 0;
  if (!schema) return { ok: false, error: 'The project file has no schema version.' };
  if (schema > SCHEMA_VERSION) {
    return { ok: false, error: `This project was saved by a newer version of BRICKWORK (schema ${schema}, this build reads ${SCHEMA_VERSION}). Update BRICKWORK to open it.` };
  }
  if (schema < SCHEMA_VERSION) warnings.push(`Project written for schema ${schema}; upgraded on load.`);
  if (!Array.isArray(data.bricks)) return { ok: false, error: 'The project file has no brick list.' };
  let bad = 0;
  for (const b of data.bricks) {
    const part = b.part || b.p;
    if (!part || typeof part !== 'string') { bad++; continue; }
    const x = b.x, y = b.y, z = b.z;
    if (![x, y, z].every((n) => Number.isFinite(n))) bad++;
  }
  if (bad) warnings.push(`${bad} brick record${bad === 1 ? '' : 's'} were malformed and will be skipped.`);
  if (bad === data.bricks.length && bad > 0) return { ok: false, error: 'Every brick record in this file is malformed.' };
  return { ok: true, warnings };
}

export const model = new Model();
export { clamp };
