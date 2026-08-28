/* BRICKWORK — panels, dialogs and status.
 *
 * The interface layer knows how to render the model; it never mutates it
 * directly. Every command it offers is routed back through the actions object
 * supplied by main.js, so undo history stays complete.
 */
import {
  VERSION, getColor, allColors, fmtInt, fmtMass, round, emit, on, HALF, PLATE,
} from './core.js';
import { getPart, compatibleSizes, CATEGORIES } from './parts.js';
import { RENDER_STYLES } from './view.js';
import { stats, billOfMaterials, analyse, complexity } from './analysis.js';
import { CHALLENGES, randomChallenge, challengeProgress, EXAMPLES, TUTORIAL } from './content.js';
import { getPrefs, setPref, listProjects, listCheckpoints, estimateUsage, getSaveState } from './persist.js';
import { accessibilityWarnings } from './instructions.js';

/* ------------------------------------------------------------ dom help --- */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const btn = (label, opts = {}) => h('button', { class: 'btn ' + (opts.cls || ''), title: opts.title, onclick: opts.on, disabled: opts.disabled }, label);
const sbtn = (label, on, opts = {}) => btn(label, { ...opts, cls: 'sm ' + (opts.cls || ''), on });

/* ----------------------------------------------------------------- UI ---- */
export class UI {
  constructor(app) {
    this.app = app;
    this.model = app.model;
    this.el = {};
    for (const id of ['inspector', 'stats', 'analysis', 'layers', 'steps', 'surface', 'challenges',
      'sel-count', 'analysis-state', 'steps-count', 'chal-state', 'st-tool', 'st-pos', 'st-snap',
      'st-count', 'st-fps', 'st-save', 'st-savedot', 'st-msg', 'stage-msg', 'ver', 'sel-style']) {
      this.el[id] = document.getElementById(id);
    }
    this.el.ver.textContent = 'v' + VERSION;
    this.analysisOn = false;
    this.challenge = null;
    this.timer = null;
    this._setupSections();
    this._setupStyleSelect();
    on('view:stats', (s) => { this.el['st-fps'].textContent = s.fps || '—'; });
    on('save:state', (s) => this.setSaveState(s.state, s.detail));
    on('toast', (t) => this.toast(t.text, t.level));
  }

  /* -------------------------------------------------------- chrome ----- */
  _setupSections() {
    for (const sec of document.querySelectorAll('.psection')) {
      const head = sec.querySelector('.phead');
      head.addEventListener('click', () => {
        sec.classList.toggle('closed');
        head.setAttribute('aria-expanded', String(!sec.classList.contains('closed')));
        if (sec.id === 'sec-analysis' && !sec.classList.contains('closed')) this.refreshAnalysis(true);
      });
    }
  }
  _setupStyleSelect() {
    const s = this.el['sel-style'];
    s.replaceChildren(...RENDER_STYLES.map((r) => h('option', { value: r.id }, r.name)));
    s.value = this.model.settings.renderStyle;
    s.addEventListener('change', () => this.app.actions.setRenderStyle(s.value));
  }

  /* --------------------------------------------------------- status ---- */
  setStatus(text) { this.el['st-msg'].textContent = text; }
  setTool(name) { this.el['st-tool'].textContent = name; }
  setPointer(pos, snapType) {
    this.el['st-pos'].textContent = pos
      ? `${round(pos.x / 2, 1)}, ${pos.y}, ${round(pos.z / 2, 1)}`
      : '—';
    this.el['st-snap'].textContent = snapType ? snapType[0].toUpperCase() + snapType.slice(1) : '—';
  }
  setCount(n) { this.el['st-count'].textContent = fmtInt(n); }
  setSaveState(state, detail) {
    const map = {
      unsaved: ['Unsaved', ''], saving: ['Saving…', 'busy'],
      saved: ['Saved', 'ok'], failed: ['Save failed', 'bad'],
    };
    const [label, cls] = map[state] || ['—', ''];
    this.el['st-save'].textContent = label;
    this.el['st-savedot'].className = 'dot ' + cls;
    if (state === 'failed' && detail) {
      this.el['st-savedot'].title = detail;
      if (this._lastFail !== detail) { this._lastFail = detail; this.toast(detail, 'error'); }
    }
  }
  /** Transient message over the workspace. */
  flash(text, kind = '') {
    const m = this.el['stage-msg'];
    m.textContent = text;
    m.className = 'show ' + kind;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { m.className = kind; }, 2600);
  }
  hoverMessage(text, kind) {
    const m = this.el['stage-msg'];
    if (!text) { m.className = ''; return; }
    m.textContent = text;
    m.className = 'show ' + (kind || '');
    clearTimeout(this._flashT);
  }
  toast(text, level = 'info', ms = 6000) {
    const host = document.getElementById('toasts');
    const close = h('button', { 'aria-label': 'Dismiss' }, '×');
    const t = h('div', { class: 'toast ' + level, role: level === 'error' ? 'alert' : 'status' },
      h('span', { style: 'flex:1' }, text), close);
    close.addEventListener('click', () => t.remove());
    host.append(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }

  /* -------------------------------------------------------- dialogs ---- */
  dialog(title, body, foot = []) {
    const d = document.getElementById('dlg-main');
    document.getElementById('dlg-main-title').textContent = title;
    const b = document.getElementById('dlg-main-body');
    b.replaceChildren(body);
    const f = document.getElementById('dlg-main-foot');
    f.replaceChildren(...foot, btn('Close', { on: () => d.close() }));
    if (!d.open) d.showModal();
    return d;
  }
  confirm(title, body, yes = 'Yes, do it') {
    return new Promise((resolve) => {
      const d = document.getElementById('dlg-confirm');
      document.getElementById('dlg-confirm-title').textContent = title;
      const bodyEl = document.getElementById('dlg-confirm-body');
      bodyEl.replaceChildren(typeof body === 'string' ? h('p', { style: 'margin:0' }, body) : body);
      const y = document.getElementById('confirm-yes');
      const n = document.getElementById('confirm-no');
      y.textContent = yes;
      const done = (v) => { d.close(); y.removeEventListener('click', okay); n.removeEventListener('click', nope); resolve(v); };
      const okay = () => done(true);
      const nope = () => done(false);
      y.addEventListener('click', okay);
      n.addEventListener('click', nope);
      d.showModal();
    });
  }
  prompt(title, label, value = '') {
    return new Promise((resolve) => {
      const d = document.getElementById('dlg-prompt');
      document.getElementById('prompt-title').textContent = title;
      document.getElementById('prompt-label').textContent = label;
      const input = document.getElementById('prompt-input');
      input.value = value;
      const y = document.getElementById('prompt-yes');
      const n = document.getElementById('prompt-no');
      const done = (v) => { d.close(); y.removeEventListener('click', okay); n.removeEventListener('click', nope); input.removeEventListener('keydown', key); resolve(v); };
      const okay = () => done(input.value.trim() || null);
      const nope = () => done(null);
      const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); okay(); } };
      y.addEventListener('click', okay);
      n.addEventListener('click', nope);
      input.addEventListener('keydown', key);
      d.showModal();
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }
  error(title, message) {
    this.dialog(title, h('p', { style: 'margin:0' }, message));
  }

  /* ------------------------------------------------------ refresh all -- */
  refreshAll() {
    this.refreshInspector();
    this.refreshStats();
    this.refreshLayers();
    this.refreshSteps();
    this.refreshSurface();
    this.refreshChallenges();
    this.setCount(this.model.bricks.size);
    if (this.analysisOn) this.refreshAnalysis(true);
    else this.el['analysis-state'].textContent = 'not run';
    const c = complexity(this.model);
    if (c && this._lastComplexity !== c.text) { this._lastComplexity = c.text; this.toast(c.text, c.level); }
  }

  /* ------------------------------------------------------- inspector --- */
  refreshInspector() {
    const m = this.model;
    const sel = [...m.selection];
    const A = this.app.actions;
    this.el['sel-count'].textContent = sel.length ? `${sel.length} selected` : '';
    const box = this.el.inspector;
    const adv = m.settings.mode === 'advanced';

    if (!sel.length) {
      const p = getPart(this.app.state.partId);
      box.replaceChildren(
        h('p', { class: 'eyebrow' }, 'Piece on the pointer'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Piece'), h('dd', {}, p ? p.name : '—'),
          h('dt', {}, 'Colour'), h('dd', {}, getColor(this.app.state.colorId).name),
          h('dt', {}, 'Turn'), h('dd', {}, (this.app.state.rot * 90) + '°'),
          p ? h('dt', {}, 'Size') : null,
          p ? h('dd', {}, `${p.w} × ${p.d} × ${p.h}p`) : null,
          p ? h('dt', {}, 'Mass') : null,
          p ? h('dd', {}, fmtMass(p.mass)) : null),
        h('p', { class: 'hint' }, 'Nothing is selected. Click a brick with the Select tool to inspect it, or drag a box around several.'),
      );
      return;
    }

    const first = m.bricks.get(sel[0]);
    const part = first ? getPart(first.part) : null;
    const kids = [];
    if (sel.length === 1 && first) {
      const bb = m.worldBounds(first);
      const conn = m.adjacency().get(first.id);
      kids.push(
        h('p', { class: 'eyebrow' }, 'Selected piece'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Piece'), h('dd', {}, part ? part.name : first.part),
          h('dt', {}, 'Colour'), h('dd', {}, getColor(first.color).name),
          h('dt', {}, 'Turn'), h('dd', {}, (first.r * 90) + '°' + (first.fine ? ` + ${first.fine}°` : '')),
          ...(adv ? [
            h('dt', {}, 'Stud X/Z'), h('dd', {}, `${round(first.x / 2, 1)}, ${round(first.z / 2, 1)}`),
            h('dt', {}, 'Plate Y'), h('dd', {}, String(first.y)),
            h('dt', {}, 'Extent'), h('dd', {}, `${round((bb.x1 - bb.x0) / 2, 1)} × ${round((bb.z1 - bb.z0) / 2, 1)} × ${bb.y1 - bb.y0}p`),
            h('dt', {}, 'Connections'), h('dd', {}, String(conn ? conn.size : 0)),
            h('dt', {}, 'Layer'), h('dd', {}, m.layer(first.layer).name),
          ] : []),
        ));
    } else {
      const parts = new Set(sel.map((id) => m.bricks.get(id)?.part));
      const cols = new Set(sel.map((id) => m.bricks.get(id)?.color));
      let mass = 0;
      for (const id of sel) mass += getPart(m.bricks.get(id)?.part)?.mass || 0;
      kids.push(
        h('p', { class: 'eyebrow' }, 'Multiple selection'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Pieces'), h('dd', {}, fmtInt(sel.length)),
          h('dt', {}, 'Part types'), h('dd', {}, String(parts.size)),
          h('dt', {}, 'Colours'), h('dd', {}, String(cols.size)),
          h('dt', {}, 'Mass'), h('dd', {}, fmtMass(mass))));
    }

    const row = (...b) => h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:9px' }, ...b);
    kids.push(
      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Edit'),
      row(
        sbtn('Duplicate', () => A.duplicate(), { title: 'Duplicate (D)' }),
        sbtn('Rotate', () => A.rotateSelection(1), { title: 'Rotate a quarter turn (R)' }),
        sbtn('Delete', () => A.deleteSelection(), { cls: 'danger', title: 'Delete (Del)' }),
      ),
      row(
        sbtn('Mirror ←→', () => A.mirror('x')),
        sbtn('Mirror ↑↓', () => A.mirror('z')),
        sbtn('Drop to surface', () => A.dropToSurface()),
      ),
      row(
        sbtn(first && first.hidden ? 'Show' : 'Hide', () => A.toggleHidden()),
        sbtn(first && first.locked ? 'Unlock' : 'Lock', () => A.toggleLocked()),
        sbtn('Select connected', () => A.selectConnected()),
      ),
      row(
        sbtn('Same part', () => A.selectMatching('part')),
        sbtn('Same colour', () => A.selectMatching('color')),
        sbtn('Same layer', () => A.selectMatching('layer')),
      ),
    );

    if (adv) {
      kids.push(
        h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Organise'),
        row(
          sbtn('Group', () => A.group()),
          sbtn('Ungroup', () => A.ungroup()),
          sbtn('Save to tray', () => A.saveSubassembly()),
        ));
      if (m.layers.length > 1) {
        const sel2 = h('select', { class: 'ctl', style: 'margin-top:8px' },
          ...m.layers.map((l) => h('option', { value: l.id }, 'Move to ' + l.name)));
        sel2.value = first ? first.layer : m.layers[0].id;
        sel2.addEventListener('change', () => A.moveToLayer(sel2.value));
        kids.push(sel2);
      }
      if (sel.length === 1 && part) {
        const alts = compatibleSizes(part.id).slice(0, 24);
        if (alts.length) {
          const rep = h('select', { class: 'ctl', style: 'margin-top:8px' },
            h('option', { value: '' }, 'Replace with a compatible size…'),
            ...alts.map((q) => h('option', { value: q.id }, q.name)));
          rep.addEventListener('change', () => { if (rep.value) A.replacePart(rep.value); });
          kids.push(rep);
        }
        if (part.fine) {
          const fine = h('input', { class: 'ctl', type: 'range', min: -45, max: 45, step: 1, value: first.fine || 0 });
          fine.addEventListener('input', () => A.setFine(Number(fine.value)));
          kids.push(h('label', { class: 'row', style: 'margin-top:8px' },
            h('span', {}, 'Fine turn'), h('span', { style: 'font-family:var(--font-mono)' }, (first.fine || 0) + '°')), fine);
        }
      }
    }
    box.replaceChildren(...kids);
  }

  /* ----------------------------------------------------------- stats --- */
  refreshStats() {
    const s = stats(this.model);
    const A = this.app.actions;
    const cell = (n, l) => h('div', { class: 'stat' }, h('span', { class: 'n' }, n), h('span', { class: 'l' }, l));
    const kids = [
      h('div', { class: 'stat-grid' },
        cell(fmtInt(s.count), 'bricks'),
        cell(String(s.uniqueParts), 'unique parts'),
        cell(String(s.colors), 'colours'),
        cell(fmtMass(s.mass), 'estimated mass')),
    ];
    if (s.size) {
      kids.push(h('dl', { class: 'kv', style: 'margin-top:10px' },
        h('dt', {}, 'Studs'), h('dd', {}, `${s.size.studsX} × ${s.size.studsZ}`),
        h('dt', {}, 'Height'), h('dd', {}, `${s.size.plates} plates`),
        h('dt', {}, 'Millimetres'), h('dd', {}, `${s.size.mmX} × ${s.size.mmZ} × ${s.size.mmY}`),
        h('dt', {}, 'Assemblies'), h('dd', {}, String(s.subassemblies))));
    }
    const cost = h('input', { class: 'ctl', type: 'number', min: 0, step: 0.01, value: this.model.settings.costPerBrick });
    cost.addEventListener('change', () => { this.model.set('costPerBrick', Number(cost.value) || 0); this.refreshStats(); });
    kids.push(
      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Estimated cost'),
      h('div', { style: 'display:flex;gap:6px;align-items:center' },
        h('span', { style: 'font-family:var(--font-mono)' }, this.model.settings.currency), cost,
        h('span', { style: 'font-family:var(--font-mono);white-space:nowrap' }, '= ' + s.currency + s.cost.toFixed(2))),
      h('p', { class: 'hint' }, 'Your own per-piece figure. BRICKWORK does not look up prices.'),
      h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:10px' },
        sbtn('Bill of materials', () => this.openBOM()),
        sbtn('Copy summary', () => A.copySummary())),
    );
    this.el.stats.replaceChildren(...kids);
  }

  openBOM() {
    const rows = billOfMaterials(this.model);
    const table = h('table', { class: 'bom' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Qty'), h('th', {}, 'Piece'), h('th', {}, 'Colour'), h('th', {}, 'Mass'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', { class: 'n' }, String(r.qty)),
        h('td', {}, r.part),
        h('td', {}, h('span', { class: 'sw-dot', style: 'background:' + r.hex }), r.color),
        h('td', { class: 'n' }, r.mass + ' g')))));
    const body = rows.length ? table : h('p', {}, 'There are no bricks in this model yet.');
    this.dialog('Bill of materials', body, [
      btn('Export CSV', { on: () => this.app.actions.exportBOM() }),
      btn('Export inventory JSON', { on: () => this.app.actions.exportInventory() }),
    ]);
  }

  /* -------------------------------------------------------- analysis --- */
  refreshAnalysis(run = false) {
    const box = this.el.analysis;
    const A = this.app.actions;
    if (!run && !this.analysisOn) {
      box.replaceChildren(
        h('p', { class: 'hint', style: 'margin-top:0' },
          'The stability assistant looks for pieces that are floating, hanging by one connection, overlapping, or unsupported over a long span.'),
        btn('Check this build', { cls: 'primary', on: () => { this.analysisOn = true; this.refreshAnalysis(true); } }),
      );
      return;
    }
    const r = analyse(this.model);
    this.lastAnalysis = r;
    this.app.view.showAnalysis(this.showOverlay === false ? null : r);
    const worst = r.notes.some((n) => n.level === 'error') ? 'issues' : r.notes.some((n) => n.level === 'warn') ? 'warnings' : 'clear';
    this.el['analysis-state'].textContent = worst;
    const notes = r.notes.map((n) => h('div', { class: 'note ' + n.level },
      h('span', { style: 'flex:1' }, n.text),
      n.ids && n.ids.length ? sbtn('Show', () => A.selectIds(n.ids)) : null));
    box.replaceChildren(
      ...notes,
      h('dl', { class: 'kv', style: 'margin-top:10px' },
        h('dt', {}, 'Assemblies'), h('dd', {}, String(r.components)),
        h('dt', {}, 'On the surface'), h('dd', {}, String(r.grounded)),
        h('dt', {}, 'Support area'), h('dd', {}, r.footprintArea + ' studs²'),
        h('dt', {}, 'Centre of mass'), h('dd', {}, r.com ? `${round(r.com.x / 2, 1)}, ${round(r.com.y, 1)}p, ${round(r.com.z / 2, 1)}` : '—')),
      h('label', { class: 'row', style: 'margin-top:8px' },
        h('input', {
          type: 'checkbox', checked: this.showOverlay !== false,
          onchange: (e) => { this.showOverlay = e.target.checked; this.app.view.showAnalysis(e.target.checked ? r : null); },
        }), h('span', {}, 'Show the overlay in the workspace')),
      h('div', { style: 'display:flex;gap:5px;margin-top:8px' },
        sbtn('Check again', () => this.refreshAnalysis(true)),
        sbtn('Stop checking', () => { this.analysisOn = false; this.app.view.showAnalysis(null); this.refreshAnalysis(); })),
      h('p', { class: 'hint' },
        'This is a rough guide, not an engineering result. It reads connections and mass distribution only — it does not model friction, clutch power or real materials.'),
    );
  }

  /* -------------------------------------------- layers and model tree -- */
  refreshLayers() {
    const m = this.model;
    const A = this.app.actions;
    const box = this.el.layers;
    const kids = [
      h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px' },
        sbtn('Add layer', () => A.addLayer()),
        sbtn('Duplicate', () => A.duplicateLayer()),
        sbtn('Delete', () => A.deleteLayer(), { cls: 'danger' })),
    ];
    const tree = h('div', { class: 'tree' });
    m.layers.forEach((l, i) => {
      const count = [...m.bricks.values()].filter((b) => b.layer === l.id).length;
      const active = m.activeLayer === l.id;
      tree.append(h('div', { class: 'tnode' + (active ? ' on' : '') },
        h('span', { class: 'sw-dot', style: 'background:' + l.color }),
        h('span', {
          class: 'nm', title: 'Click to make this the active layer, double-click to rename',
          onclick: () => { m.activeLayer = l.id; this.refreshLayers(); },
          ondblclick: () => A.renameLayer(l.id),
        }, l.name + '  (' + count + ')'),
        h('button', { class: 'mini', title: l.visible ? 'Hide this layer' : 'Show this layer', onclick: () => A.toggleLayer(l.id, 'visible') }, l.visible ? '👁' : '⃠'),
        h('button', { class: 'mini', title: l.locked ? 'Unlock this layer' : 'Lock this layer', onclick: () => A.toggleLayer(l.id, 'locked') }, l.locked ? '🔒' : '🔓'),
        h('button', { class: 'mini', title: 'Move up', disabled: i === 0, onclick: () => A.moveLayer(l.id, -1) }, '↑'),
        h('button', { class: 'mini', title: 'Move down', disabled: i === m.layers.length - 1, onclick: () => A.moveLayer(l.id, 1) }, '↓'),
      ));
      const child = h('div', { class: 'tchild' });
      const groups = new Map();
      const loose = [];
      for (const b of m.bricks.values()) {
        if (b.layer !== l.id) continue;
        if (b.group) {
          if (!groups.has(b.group)) groups.set(b.group, []);
          groups.get(b.group).push(b);
        } else loose.push(b);
      }
      for (const [gid, members] of groups) {
        const g = m.groups.get(gid) || { id: gid, name: 'Group', collapsed: true };
        child.append(h('div', { class: 'tnode', onclick: () => A.selectIds(members.map((b) => b.id)) },
          h('span', {}, g.collapsed ? '▸' : '▾'),
          h('span', { class: 'nm' }, `${g.name} (${members.length})`),
          h('button', { class: 'mini', title: 'Expand or collapse', onclick: (e) => { e.stopPropagation(); A.toggleGroup(gid); } }, '⇕')));
        if (!g.collapsed) {
          const sub = h('div', { class: 'tchild' });
          for (const b of members.slice(0, 60)) sub.append(this._brickNode(b));
          child.append(sub);
        }
      }
      for (const b of loose.slice(0, 80)) child.append(this._brickNode(b));
      if (loose.length > 80) child.append(h('p', { class: 'hint' }, `…and ${loose.length - 80} more pieces on this layer.`));
      tree.append(child);
    });
    kids.push(tree);
    box.replaceChildren(...kids);
  }
  _brickNode(b) {
    const p = getPart(b.part);
    const col = getColor(b.color);
    return h('div', {
      class: 'tnode' + (this.model.selection.has(b.id) ? ' on' : ''),
      onclick: (e) => this.app.actions.selectIds([b.id], e.shiftKey),
    },
      h('span', { class: 'sw-dot', style: 'background:' + col.hex }),
      h('span', { class: 'nm' }, (p ? p.name : b.part) + (b.hidden ? ' — hidden' : '') + (b.locked ? ' — locked' : '')));
  }

  /* ------------------------------------------------------- instructions */
  refreshSteps() {
    const m = this.model;
    const A = this.app.actions;
    const box = this.el.steps;
    this.el['steps-count'].textContent = m.steps ? `${m.steps.steps.length} steps` : '';
    if (!m.steps) {
      box.replaceChildren(
        h('p', { class: 'hint', style: 'margin-top:0' },
          'Generate a build order from the model. It groups pieces bottom-up and you can reorder, retitle or merge steps afterwards.'),
        btn('Generate instructions', { cls: 'primary', on: () => A.generateInstructions(), disabled: m.bricks.size === 0 }));
      return;
    }
    const warns = new Set(accessibilityWarnings(m, m.steps).map((w) => w.step));
    const list = h('div', {});
    m.steps.steps.forEach((s, i) => {
      const on = this.previewStep === i;
      list.append(h('div', { class: 'step-row' + (on ? ' on' : '') },
        h('span', { class: 'no' }, String(i + 1)),
        h('span', { class: 't', title: s.title, onclick: () => A.previewStep(on ? null : i) }, s.title || `Step ${i + 1}`),
        warns.has(i) ? h('span', { class: 'warnflag', title: 'This step adds a piece under something already built' }, '!') : null,
        h('button', { class: 'mini', title: 'Rename this step', onclick: () => A.renameStep(i) }, '✎'),
        h('button', { class: 'mini', title: 'Move earlier', disabled: i === 0, onclick: () => A.moveStep(i, -1) }, '↑'),
        h('button', { class: 'mini', title: 'Move later', disabled: i === m.steps.steps.length - 1, onclick: () => A.moveStep(i, 1) }, '↓'),
        h('button', { class: 'mini', title: 'Merge into the previous step', disabled: i === 0, onclick: () => A.mergeStep(i) }, '⌥')));
    });
    box.replaceChildren(
      h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px' },
        sbtn('Regenerate', () => A.generateInstructions()),
        sbtn(this.previewStep == null ? 'Preview' : 'Stop preview', () => A.previewStep(this.previewStep == null ? 0 : null)),
        sbtn('Export PDF', () => A.exportInstructionsPDF()),
        sbtn('Export step images', () => A.exportStepImages())),
      warns.size ? h('div', { class: 'note warn' }, `${warns.size} step${warns.size === 1 ? '' : 's'} would bury a piece. Reorder them, or build that part first.`) : null,
      list,
      h('p', { class: 'hint' }, 'The order is a starting point. Check it before you build.'));
  }

  /* --------------------------------------------------------- workspace  */
  refreshSurface() {
    const m = this.model;
    const s = m.settings;
    const A = this.app.actions;
    const num = (label, key, min, max) => {
      const i = h('input', { class: 'ctl', type: 'number', min, max, step: 1, value: s[key] });
      i.addEventListener('change', () => A.setSurface(key, Math.max(min, Math.min(max, Number(i.value) | 0))));
      return h('label', { class: 'row' }, h('span', {}, label), h('span', { style: 'width:82px' }, i));
    };
    const check = (label, key, note) => h('label', { class: 'row', title: note || '' },
      h('input', { type: 'checkbox', checked: s[key], onchange: (e) => A.setSetting(key, e.target.checked) }),
      h('span', {}, label));
    const sel = (label, key, options) => {
      const el = h('select', { class: 'ctl', style: 'width:auto' }, ...options.map((o) => h('option', { value: o[0] }, o[1])));
      el.value = s[key];
      el.addEventListener('change', () => A.setSetting(key, el.value));
      return h('label', { class: 'row' }, h('span', {}, label), el);
    };
    this.el.surface.replaceChildren(
      h('p', { class: 'eyebrow' }, 'Building surface'),
      num('Width (studs)', 'baseW', 8, 96),
      num('Depth (studs)', 'baseD', 8, 96),
      check('Show the baseplate', 'showBaseplate'),
      check('Show the grid', 'showGrid'),
      check('Ground shadow', 'showShadows'),
      check('Grow the surface when you build near an edge', 'autoExpand'),
      h('label', { class: 'row' }, h('span', {}, 'Background'),
        h('input', {
          type: 'color', value: s.background, style: 'width:38px;height:28px;padding:0;border:1px solid var(--line);border-radius:5px',
          onchange: (e) => A.setSetting('background', e.target.value),
        })),

      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Snapping'),
      check('Allow half-stud offsets', 'snapHalf'),
      check('Free placement (no stud snapping)', 'freePlace'),
      m.settings.mode === 'advanced' ? check('Allow overlapping pieces', 'collisionOverride') : null,
      h('label', { class: 'row' }, h('span', {}, 'Snap strength'),
        h('input', {
          class: 'ctl', type: 'range', min: 0, max: 1, step: 0.05, value: s.snapAssist,
          style: 'width:110px', oninput: (e) => A.setSetting('snapAssist', Number(e.target.value)),
        })),

      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Performance'),
      sel('Shadow quality', 'shadowQuality', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      check('Performance mode', 'performanceMode', 'Drops shadows and pixel ratio for large models'),

      h('p', { class: 'eyebrow', style: 'margin-top:14px' }, 'Accessibility'),
      check('High contrast', 'highContrast'),
      check('Reduce motion', 'reducedMotion'),
      h('label', { class: 'row' }, h('span', {}, 'Interface scale'),
        h('input', {
          class: 'ctl', type: 'range', min: 0.85, max: 1.5, step: 0.05, value: s.uiScale,
          style: 'width:110px', oninput: (e) => A.setSetting('uiScale', Number(e.target.value)),
        })),
      check('Placement sound', 'sound'),
      check('Haptic feedback on touch', 'haptics'),
      h('p', { class: 'hint' }, 'Placement state is shown by shape and wording as well as colour.'),
    );
  }

  /* -------------------------------------------------------- challenges  */
  refreshChallenges() {
    const box = this.el.challenges;
    const A = this.app.actions;
    const kids = [];
    if (this.challenge) {
      const prog = challengeProgress(this.challenge, this.model, this.lastAnalysis);
      this.el['chal-state'].textContent = 'active';
      kids.push(
        h('div', { class: 'challenge' },
          h('b', {}, this.challenge.name),
          h('p', {}, this.challenge.brief),
          prog ? h('p', { class: 'state-tag ' + (prog.ok === true ? 'ok' : prog.ok === false ? 'warn' : '') }, prog.text) : null,
          this.timer ? h('div', { class: 'timer' }, this.timerText || '00:00') : null,
          h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' },
            sbtn(this.timer ? 'Stop timer' : 'Start timer', () => A.toggleTimer()),
            sbtn('Give up', () => A.setChallenge(null), { cls: 'danger' }))));
    } else {
      this.el['chal-state'].textContent = '';
      kids.push(h('p', { class: 'hint', style: 'margin-top:0' },
        'Optional prompts. They never block free building — pick one, or ignore the drawer entirely.'));
      for (const c of CHALLENGES) {
        kids.push(h('div', { class: 'challenge' },
          h('b', {}, c.name), h('p', {}, c.brief),
          sbtn('Take this on', () => A.setChallenge(c))));
      }
      kids.push(btn('Roll a random constraint', { cls: 'sm', on: () => A.setChallenge(randomChallenge()) }));
    }
    box.replaceChildren(...kids);
  }

  /* ------------------------------------------------------ big dialogs -- */
  async openProject() {
    const A = this.app.actions;
    const m = this.model;
    const projects = await listProjects();
    const checkpoints = await listCheckpoints();
    const usage = await estimateUsage();
    const grp = (title, ...b) => h('div', { style: 'margin-bottom:16px' },
      h('p', { class: 'eyebrow' }, title),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, ...b));

    const list = h('div', { class: 'tree', style: 'max-height:210px;overflow:auto;border:1px solid var(--line);border-radius:7px;padding:6px' });
    if (!projects.length) list.append(h('p', { class: 'hint', style: 'margin:4px' }, 'No saved projects yet. This one saves itself as you build.'));
    for (const p of projects) {
      list.append(h('div', { class: 'tnode' + (p.id === m.id ? ' on' : '') },
        h('span', { class: 'nm' }, `${p.name} — ${fmtInt(p.bricks)} bricks, ${new Date(p.modified).toLocaleString()}`),
        sbtn('Open', () => A.openProject(p.id)),
        sbtn('Copy', () => A.duplicateProject(p.id)),
        sbtn('Delete', () => A.deleteProject(p.id, p.name), { cls: 'danger' })));
    }

    const cps = h('div', { class: 'tree' });
    for (const c of checkpoints.slice(0, 5)) {
      cps.append(h('div', { class: 'tnode' },
        h('span', { class: 'nm' }, `${c.label} — ${new Date(c.at).toLocaleString()}`),
        sbtn('Restore', () => A.restoreCheckpoint(c.key))));
    }

    const body = h('div', {},
      h('p', { style: 'margin-top:0' }, h('b', {}, m.name), ' — ', fmtInt(m.bricks.size), ' bricks. ',
        h('span', { class: 'hint' }, 'Saved in this browser only.')),
      grp('This project',
        btn('New project', { on: () => A.newProject() }),
        btn('Rename', { on: () => A.rename() }),
        btn('Save now', { on: () => A.saveNow() }),
        btn('Save a copy', { on: () => A.saveCopy() }),
        btn('Clear sample data', { cls: 'danger', on: () => A.clearSampleData() })),
      grp('Import',
        btn('Open a project file', { on: () => A.importProject() }),
        btn('Import a shared build', { on: () => A.importProject(true) }),
        btn('Recover the last autosave', { on: () => A.recoverAutosave() })),
      grp('Export',
        btn('Project JSON', { on: () => A.exportProject() }),
        btn('Screenshot PNG', { on: () => A.exportPNG(false) }),
        btn('PNG, transparent', { on: () => A.exportPNG(true) }),
        btn('Instructions PDF', { on: () => A.exportInstructionsPDF() }),
        btn('Bill of materials CSV', { on: () => A.exportBOM() }),
        btn('Inventory JSON', { on: () => A.exportInventory() }),
        btn('OBJ mesh', { on: () => A.exportMesh('obj') }),
        btn('STL mesh', { on: () => A.exportMesh('stl') })),
      grp('Share',
        btn('Share file', { on: () => A.exportShare() }),
        btn('Link', { on: () => A.shareLink() }),
        btn('Preview card', { on: () => A.previewCard() }),
        btn('Summary text', { on: () => A.copySummary() })),
      h('p', { class: 'eyebrow' }, 'Examples'),
      h('div', { class: 'cards', style: 'margin-bottom:16px' },
        ...EXAMPLES.map((e) => h('button', { class: 'card', onclick: () => A.loadExample(e.id) },
          h('span', { class: 'ic' }, e.icon), h('b', {}, e.name), h('span', {}, e.blurb)))),
      h('p', { class: 'eyebrow' }, 'Saved projects'),
      list,
      checkpoints.length ? h('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Recovery points') : null,
      checkpoints.length ? cps : null,
      h('p', { class: 'hint', style: 'margin-top:14px' },
        'Meshes are for looking at and for personal prototyping. They carry no clearances or tolerances and are not manufacturing-ready.' +
        (usage ? ` Browser storage in use: ${(usage.used / 1048576).toFixed(1)} MB of about ${(usage.quota / 1048576).toFixed(0)} MB.` : '')),
      h('p', { class: 'hint' },
        h('button', { class: 'btn sm danger', onclick: () => A.clearAllData() }, 'Erase every project on this machine')),
    );
    this.dialog('Project', body);
  }

  openHelp() {
    const K = (k, d) => h('div', {}, h('kbd', {}, k), h('span', {}, d));
    const body = h('div', {},
      h('p', { style: 'margin-top:0' },
        'Pick a brick on the left, aim at the table, and click. Green means it fits, red means something is in the way, and the strip along the bottom always says why.'),
      h('p', { class: 'eyebrow' }, 'Camera'),
      h('p', { class: 'hint', style: 'margin-top:0' },
        'Right-drag or Alt-drag to orbit. Middle-drag or Shift+right-drag to pan. Scroll or pinch to zoom. ' +
        'On a touchscreen, one finger orbits, two fingers pan and pinch, and a tap places or selects. ' +
        'Click a face of the orientation cube to jump to that view.'),
      h('p', { class: 'eyebrow' }, 'Keyboard'),
      h('div', { class: 'shortcut-grid' },
        K('1 – 6', 'Front, back, left, right, top, isometric'),
        K('P / V / M / T / O', 'Place, select, move, rotate, orbit tools'),
        K('R', 'Rotate a quarter turn'),
        K('Shift + R', 'Rotate the other way'),
        K('D', 'Duplicate the selection'),
        K('C', 'Recolour the selection'),
        K('F', 'Frame the selection'),
        K('Shift + F', 'Frame the whole model'),
        K('G', 'Toggle the grid'),
        K('H', 'Toggle half-stud offsets'),
        K('Delete', 'Delete the selection'),
        K('Ctrl/Cmd + Z', 'Undo'),
        K('Ctrl/Cmd + Shift + Z', 'Redo'),
        K('Ctrl/Cmd + C / V', 'Copy and paste'),
        K('Ctrl/Cmd + A', 'Select everything'),
        K('Ctrl/Cmd + S', 'Save now'),
        K('Arrow keys', 'Nudge the piece or the selection'),
        K('PgUp / PgDn', 'Move up or down a plate'),
        K('Enter', 'Place the piece at the marker'),
        K('Esc', 'Cancel, or clear the selection'),
        K('?', 'This panel')),
      h('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Where things are'),
      h('p', { class: 'hint', style: 'margin-top:0' },
        'Left: bricks, colours and challenges. Right: the inspector, statistics, stability, layers, instructions and workspace settings. ' +
        'Advanced Mode adds layers, groups, free placement, precise coordinates and the full catalog; switching modes never changes your model.'),
      h('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Privacy'),
      h('p', { class: 'hint', style: 'margin-top:0' },
        'BRICKWORK is local-first. Projects live in this browser’s storage, exports go to your own disk, and the application makes no network requests once it has loaded.'),
      h('p', { class: 'hint' }, 'BRICKWORK ' + VERSION + '. Not affiliated with, or endorsed by, any toy manufacturer. Pieces are dimensionally compatible with common interlocking bricks.'),
    );
    this.dialog('Help & keyboard shortcuts', body, [
      btn('Run the guided build', { on: () => { document.getElementById('dlg-main').close(); this.app.actions.startTutorial(); } }),
    ]);
  }

  welcome() {
    const d = document.getElementById('dlg-welcome');
    const cards = document.getElementById('welcome-cards');
    const A = this.app.actions;
    const pick = (fn) => { d.close(); fn(); };
    cards.replaceChildren(
      h('button', { class: 'card', onclick: () => pick(() => A.loadExample('blank')) },
        h('span', { class: 'ic' }, '▦'), h('b', {}, 'Blank build'), h('span', {}, 'An empty table. Start placing bricks now.')),
      h('button', { class: 'card', onclick: () => pick(() => A.startTutorial()) },
        h('span', { class: 'ic' }, '☞'), h('b', {}, 'Guided build'), h('span', {}, 'Six short prompts that cover everything you need.')),
      h('button', { class: 'card', onclick: () => pick(() => A.loadExample('house')) },
        h('span', { class: 'ic' }, '⌂'), h('b', {}, 'Example model'), h('span', {}, 'Open the small house and pull it apart.')),
    );
    const never = document.getElementById('welcome-never');
    never.checked = !!getPrefs().tutorialSeen;
    never.onchange = () => setPref('tutorialSeen', never.checked);
    d.showModal();
  }

  tutorial(index, actions) {
    const d = document.getElementById('dlg-tutorial');
    const step = TUTORIAL[index];
    if (!step) { d.close(); return; }
    document.getElementById('tut-title').textContent = `Guided build — ${index + 1} of ${TUTORIAL.length}`;
    document.getElementById('tut-body').replaceChildren(
      h('h3', { style: 'margin:0 0 6px;font-family:var(--font-display)' }, step.title),
      h('p', { style: 'margin:0' }, step.body),
      step.hint ? h('p', { class: 'hint' }, step.hint) : null);
    const back = document.getElementById('tut-back');
    const next = document.getElementById('tut-next');
    back.disabled = index === 0;
    next.textContent = index === TUTORIAL.length - 1 ? 'Start building' : 'Next';
    back.onclick = () => actions.tutorialStep(index - 1);
    next.onclick = () => actions.tutorialStep(index + 1);
    document.getElementById('tut-quit').onclick = () => { d.close(); setPref('tutorialSeen', true); };
    if (!d.open) d.showModal();
  }
}

/* Close buttons on every dialog. */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-close]');
  if (b) b.closest('dialog')?.close();
});
