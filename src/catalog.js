/* BRICKWORK — the parts browser.
 *
 * Category trays, search, filters, favourites, recents and frequently used
 * pieces. Thumbnails are rendered on demand by one small offscreen renderer,
 * so opening a category never blocks the workspace.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { getColor, COLOR_TYPES, allColors, registerCustomColor, emit } from './core.js';
import { ALL_PARTS, CATEGORIES, EASY_PART_IDS, getPart } from './parts.js';
import { partGeometry, GROUPS } from './geometry.js';
import { getPrefs, setPref } from './persist.js';

/* --------------------------------------------------------- thumbnails --- */
const THUMB_W = 132, THUMB_H = 108;
let tRenderer = null, tScene = null, tCam = null, tRoot = null, thumbsBroken = false;
const queue = [];
let running = false;

function initThumbs() {
  if (tRenderer || thumbsBroken) return;
  try {
    tRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    tRenderer.setSize(THUMB_W, THUMB_H, false);
    tRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  } catch { thumbsBroken = true; return; }
  tScene = new THREE.Scene();
  tCam = new THREE.PerspectiveCamera(34, THUMB_W / THUMB_H, 1, 3000);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(90, 160, 130);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  fill.position.set(-110, 60, -90);
  tScene.add(new THREE.HemisphereLight(0xffffff, 0x6a7078, 1.0), key, fill);
  tRoot = new THREE.Group();
  tScene.add(tRoot);
}
const thumbMats = new Map();
function thumbMat(kind, hex) {
  const key = kind + hex;
  if (thumbMats.has(key)) return thumbMats.get(key);
  let m;
  if (kind === 'dark') m = new THREE.MeshStandardMaterial({ color: 0x21262c, roughness: .8 });
  else if (kind === 'light') m = new THREE.MeshStandardMaterial({ color: 0xb9bfbd, roughness: .6 });
  else if (kind === 'glass') m = new THREE.MeshStandardMaterial({ color: 0xd8ecf5, roughness: .08, transparent: true, opacity: .35 });
  else if (kind === 'trans') m = new THREE.MeshStandardMaterial({ color: hex, roughness: .1, transparent: true, opacity: .55 });
  else if (kind === 'metal') m = new THREE.MeshStandardMaterial({ color: hex, roughness: .26, metalness: .88 });
  else if (kind === 'rubber') m = new THREE.MeshStandardMaterial({ color: hex, roughness: .97 });
  else if (kind === 'glow') m = new THREE.MeshStandardMaterial({ color: hex, roughness: .5, emissive: new THREE.Color(hex), emissiveIntensity: .4 });
  else m = new THREE.MeshStandardMaterial({ color: hex, roughness: .4 });
  thumbMats.set(key, m);
  return m;
}
export function drawThumb(partId, colorId, canvas) {
  initThumbs();
  if (!tRenderer) return false;
  const gs = partGeometry(partId);
  const part = getPart(partId);
  if (!gs || !part) return false;
  const col = getColor(colorId || part.color);
  tRoot.clear();
  for (const g of GROUPS) {
    if (!gs[g]) continue;
    const kind = g === 'main' ? (col.type === 'solid' ? 'solid' : col.type) : g;
    tRoot.add(new THREE.Mesh(gs[g], thumbMat(kind, col.hex)));
  }
  const box = new THREE.Box3().setFromObject(tRoot);
  const c = new THREE.Vector3(); box.getCenter(c);
  const size = new THREE.Vector3(); box.getSize(size);
  tRoot.position.set(-c.x, -c.y, -c.z);
  const r = Math.max(size.length() * 0.5, 5);
  const d = r / Math.sin(17 * Math.PI / 180) * 0.62;
  tCam.position.set(d * 0.6, d * 0.62, d * 0.72);
  tCam.lookAt(0, 0, 0);
  tRenderer.render(tScene, tCam);
  canvas.width = THUMB_W; canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, THUMB_W, THUMB_H);
  ctx.drawImage(tRenderer.domElement, 0, 0, THUMB_W, THUMB_H);
  canvas.dataset.drawn = '1';
  return true;
}
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(() => fn(null), 16));
function enqueue(job) {
  queue.push(job);
  if (running) return;
  running = true;
  const pump = (deadline) => {
    let n = 0;
    while (queue.length && (n < 3 || (deadline && deadline.timeRemaining && deadline.timeRemaining() > 5))) {
      queue.shift()(); n++;
    }
    if (queue.length) idle(pump); else running = false;
  };
  idle(pump);
}
let observer = null;
function observe(canvas, partId, colorId) {
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const cv = e.target;
        observer.unobserve(cv);
        if (cv.dataset.drawn) continue;
        enqueue(() => { try { drawThumb(cv.dataset.part, cv.dataset.color, cv); } catch (err) { console.warn('[brickwork] thumbnail failed', err); } });
      }
    }, { rootMargin: '200px' });
  }
  canvas.dataset.part = partId;
  canvas.dataset.color = colorId || '';
  observer.observe(canvas);
}

/* ------------------------------------------------------------- catalog --- */
export class Catalog {
  constructor(ctx) {
    this.ctx = ctx;                     // { state, model, onPickPart, onPickColor }
    this.query = '';
    this.cat = 'all';
    this.colorType = 'all';
    this.sizeFilter = 'all';
    this.closedTrays = new Set();
    const p = getPrefs();
    this.view = p.catalogView;
    this.thumb = p.thumbSize;
    this.el = {
      trays: document.getElementById('trays'),
      chips: document.getElementById('cat-chips'),
      filters: document.getElementById('cat-filters'),
      q: document.getElementById('q'),
      count: document.getElementById('cat-count'),
      swatches: document.getElementById('swatches'),
      colorTypes: document.getElementById('color-types'),
      colorName: document.getElementById('color-name'),
    };
    this._wire();
    this.renderChips();
    this.renderColors();
    this.render();
  }

  _wire() {
    this.el.q.addEventListener('input', () => { this.query = this.el.q.value.trim().toLowerCase(); this.render(); });
    document.getElementById('btn-view-toggle').addEventListener('click', () => {
      this.view = this.view === 'grid' ? 'list' : 'grid';
      setPref('catalogView', this.view);
      this.render();
    });
    document.getElementById('btn-thumb-size').addEventListener('click', () => {
      this.thumb = this.thumb >= 96 ? 52 : this.thumb + 22;
      setPref('thumbSize', this.thumb);
      this.render();
    });
    document.getElementById('btn-custom').addEventListener('click', () => {
      const id = registerCustomColor(document.getElementById('custom-color').value, 'solid');
      if (id) { this.ctx.onPickColor(id); this.renderColors(); }
    });
  }

  renderChips() {
    const cats = [{ id: 'all', name: 'All' }, ...CATEGORIES];
    this.el.chips.replaceChildren(...cats.map((c) => {
      const b = document.createElement('button');
      b.className = 'chip' + (this.cat === c.id ? ' on' : '');
      b.textContent = c.name;
      b.title = c.hint || 'Every piece in the catalog';
      b.setAttribute('aria-pressed', String(this.cat === c.id));
      b.addEventListener('click', () => { this.cat = c.id; this.renderChips(); this.render(); });
      return b;
    }));
    const sizes = ['all', '1x1', '1x2', '1x4', '2x2', '2x4', 'big'];
    const labels = { all: 'Any size', big: '4 studs +' };
    this.el.filters.replaceChildren(...sizes.map((s) => {
      const b = document.createElement('button');
      b.className = 'chip' + (this.sizeFilter === s ? ' on' : '');
      b.textContent = labels[s] || s.replace('x', ' \u00d7 ');
      b.setAttribute('aria-pressed', String(this.sizeFilter === s));
      b.addEventListener('click', () => { this.sizeFilter = s; this.renderChips(); this.render(); });
      return b;
    }));
  }

  renderColors() {
    const st = this.ctx.state;
    const types = [{ id: 'all', name: 'All' }, ...COLOR_TYPES];
    this.el.colorTypes.replaceChildren(...types.map((t) => {
      const b = document.createElement('button');
      b.className = 'chip' + (this.colorType === t.id ? ' on' : '');
      b.textContent = t.name;
      b.addEventListener('click', () => { this.colorType = t.id; this.renderColors(); });
      return b;
    }));
    const list = allColors().filter((c) => this.colorType === 'all' || c.type === this.colorType);
    this.el.swatches.replaceChildren(...list.map((c) => {
      const b = document.createElement('button');
      b.className = 'sw ' + c.type + (st.colorId === c.id ? ' on' : '');
      b.style.background = c.hex;
      b.title = c.name + (c.type !== 'solid' ? ' (' + c.type + ')' : '');
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(st.colorId === c.id));
      b.addEventListener('click', () => this.ctx.onPickColor(c.id));
      return b;
    }));
    this.el.colorName.textContent = getColor(st.colorId).name;
  }

  visibleParts() {
    const easy = this.ctx.model.settings.mode === 'easy';
    return ALL_PARTS.filter((p) => {
      if (easy && !EASY_PART_IDS.has(p.id)) return false;
      if (this.cat !== 'all' && p.cat !== this.cat) return false;
      if (this.query && !p.search.includes(this.query)) return false;
      if (this.sizeFilter !== 'all') {
        if (this.sizeFilter === 'big') { if (Math.max(p.w, p.d) < 4) return false; }
        else if (p.sizeKey !== this.sizeFilter) return false;
      }
      return true;
    });
  }

  render() {
    const prefs = getPrefs();
    const parts = this.visibleParts();
    const set = new Set(parts.map((p) => p.id));
    this.el.count.textContent = parts.length + ' piece' + (parts.length === 1 ? '' : 's');
    this.el.trays.style.setProperty('--thumb', this.thumb + 'px');

    const trays = [];
    const fav = prefs.favorites.map(getPart).filter((p) => p && set.has(p.id));
    if (fav.length) trays.push(['Favourites', fav, 'fav']);
    const recent = prefs.recents.map(getPart).filter((p) => p && set.has(p.id));
    if (recent.length) trays.push(['Recently used', recent.slice(0, 12), 'recent']);
    const freq = Object.entries(prefs.usage).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id]) => getPart(id)).filter((p) => p && set.has(p.id));
    if (freq.length > 2) trays.push(['Used most often', freq, 'freq']);
    if (prefs.trays.length) trays.push(['My subassemblies', prefs.trays, 'subs']);

    if (this.cat === 'all') {
      for (const c of CATEGORIES) {
        const list = parts.filter((p) => p.cat === c.id);
        if (list.length) trays.push([c.name, list, c.id]);
      }
    } else {
      const c = CATEGORIES.find((x) => x.id === this.cat);
      if (parts.length) trays.push([c ? c.name : 'Results', parts, this.cat]);
    }

    const frag = document.createDocumentFragment();
    if (!parts.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.padding = '16px';
      p.textContent = this.ctx.model.settings.mode === 'easy'
        ? 'Nothing here matches. Easy Mode shows a smaller set of pieces — switch to Advanced for the full catalog.'
        : 'No pieces match that search. Try a shorter word, or clear the size filter.';
      frag.append(p);
    }
    for (const [name, list, key] of trays) frag.append(this._tray(name, list, key));
    this.el.trays.replaceChildren(frag);
  }

  _tray(name, list, key) {
    const wrap = document.createElement('div');
    wrap.className = 'tray' + (this.closedTrays.has(key) ? ' closed' : '');
    const h = document.createElement('button');
    h.className = 'tray-title';
    h.setAttribute('aria-expanded', String(!this.closedTrays.has(key)));
    const chev = document.createElement('span');
    chev.className = 'chev'; chev.textContent = '\u25be';
    const label = document.createElement('span'); label.textContent = name;
    const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = list.length;
    h.append(chev, label, cnt);
    h.addEventListener('click', () => {
      if (this.closedTrays.has(key)) this.closedTrays.delete(key); else this.closedTrays.add(key);
      wrap.classList.toggle('closed');
      h.setAttribute('aria-expanded', String(!wrap.classList.contains('closed')));
    });
    const body = document.createElement('div');
    body.className = this.view === 'grid' ? 'grid' : 'list';
    for (const p of list) body.append(key === 'subs' ? this._subChip(p) : this._chip(p));
    wrap.append(h, body);
    return wrap;
  }

  _chip(p) {
    const st = this.ctx.state;
    const on = st.partId === p.id;
    const b = document.createElement('button');
    b.className = 'pchip' + (on ? ' on' : '');
    b.title = p.name + ' — ' + p.w + ' \u00d7 ' + p.d + ', ' + p.h + ' plate' + (p.h === 1 ? '' : 's') + ' high';
    b.setAttribute('aria-pressed', String(on));
    b.draggable = true;
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', p.name);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = p.name;
    const prefs = getPrefs();
    const isFav = prefs.favorites.includes(p.id);
    const fav = document.createElement('span');
    fav.className = 'fav' + (isFav ? ' on' : '');
    fav.textContent = isFav ? '\u2605' : '\u2606';
    fav.title = isFav ? 'Remove from favourites' : 'Add to favourites';
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = [...getPrefs().favorites];
      const i = f.indexOf(p.id);
      if (i >= 0) f.splice(i, 1); else f.push(p.id);
      setPref('favorites', f);
      this.render();
    });
    b.append(cv, nm, fav);
    b.addEventListener('click', () => this.ctx.onPickPart(p.id));
    b.addEventListener('dragstart', (e) => {
      this.ctx.onPickPart(p.id);
      e.dataTransfer.setData('text/plain', 'brickwork:part:' + p.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    observe(cv, p.id, this.ctx.state.colorId);
    return b;
  }

  _subChip(sub) {
    const b = document.createElement('button');
    b.className = 'pchip';
    b.title = sub.name + ' — ' + sub.bricks.length + ' pieces. Click to stamp a copy onto the surface.';
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:1.6em;color:var(--muted)';
    ph.textContent = '\u25a4';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = sub.name;
    b.append(ph, nm);
    b.addEventListener('click', () => emit('tray:stamp', sub));
    return b;
  }

  markUsed(partId) {
    const prefs = getPrefs();
    setPref('recents', [partId, ...prefs.recents.filter((x) => x !== partId)].slice(0, 14));
    const u = { ...prefs.usage };
    u[partId] = (u[partId] || 0) + 1;
    setPref('usage', u);
  }
}
