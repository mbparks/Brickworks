/* BRICKWORK — application wiring.
 *
 * Owns the tools, pointer and keyboard input, and the action set the
 * interface calls into. Every model change goes through a transaction so
 * undo and redo stay complete, and every change is reflected incrementally
 * in the view rather than by rebuilding the scene.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import {
  VERSION, HALF, PLATE, STUD, clamp, emit, on, getColor, uid, deepClone, fmtInt,
} from './core.js';
import { getPart, EASY_PART_IDS } from './parts.js';
import { model, validateProject, footprint } from './model.js';
import { View } from './view.js';
import { Catalog } from './catalog.js';
import { UI } from './ui.js';
import {
  resolvePlacement, validateMove, rotatedRecords, mirroredRecords, dropRecords, step as snapStep,
} from './placement.js';
import { analyse, stats } from './analysis.js';
import * as persist from './persist.js';
import * as io from './io.js';
import * as instr from './instructions.js';
import { exampleProject, TUTORIAL } from './content.js';

/* ---------------------------------------------------------------- boot -- */
const canvas = document.getElementById('gl');
if (!hasWebGL()) {
  document.body.innerHTML = '<div style="max-width:640px;margin:12vh auto;padding:0 24px;font:16px/1.6 system-ui">' +
    '<h1 style="font-size:1.5rem">BRICKWORK needs WebGL</h1>' +
    '<p>This browser could not create a WebGL context, so the 3D workspace cannot run. ' +
    'Try a recent version of Chrome, Edge, Firefox or Safari, check that hardware acceleration is enabled in the browser settings, ' +
    'and make sure the graphics driver is up to date.</p>' +
    '<p style="color:#777">Nothing has been sent anywhere — BRICKWORK runs entirely on this machine.</p></div>';
  throw new Error('WebGL unavailable');
}
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const prefs = persist.getPrefs();
const state = {
  tool: 'place',
  partId: prefs.lastPart || 'brick-2x4',
  colorId: prefs.lastColor || 'red',
  rot: 0,
  fine: 0,
  clipboard: null,
  ghost: null,
  tutorial: -1,
  timerStart: 0,
};

const view = new View(canvas, model);
const ui = new UI({ model, view, state, actions: {} });
const catalog = new Catalog({
  model, state,
  onPickPart: (id) => setPart(id),
  onPickColor: (id) => pickColor(id),
});
const app = { model, view, state, ui, catalog, actions: null };
ui.app = app;

/* ------------------------------------------------------------- actions -- */
const A = {
  /* --- tools and pointer piece --------------------------------------- */
  setTool(t) {
    state.tool = t;
    for (const b of document.querySelectorAll('#tools .btn')) {
      const on = b.dataset.tool === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    canvas.className = 'tool-' + t;
    view.showGizmo = (t === 'move' || t === 'rotate');
    view.updateGizmo();
    if (t !== 'place') view.hideGhost();
    ui.setTool(t[0].toUpperCase() + t.slice(1));
    ui.setStatus(TOOL_HINTS[t]);
    ui.refreshInspector();
  },
  selectIds(ids, additive = false) {
    if (!additive) model.selection.clear();
    for (const id of ids) if (model.bricks.has(id)) model.selection.add(id);
    afterSelection();
  },
  clearSelection() { model.selection.clear(); afterSelection(); },
  selectAll() { A.selectIds([...model.bricks.keys()]); },
  selectConnected() {
    const seed = [...model.selection];
    const out = new Set();
    for (const id of seed) for (const n of model.connectedTo(id)) out.add(n);
    A.selectIds([...out]);
  },
  selectMatching(by) {
    const seed = [...model.selection].map((id) => model.bricks.get(id)).filter(Boolean);
    if (!seed.length) return;
    const keys = new Set(seed.map((b) => b[by]));
    A.selectIds([...model.bricks.values()].filter((b) => keys.has(b[by])).map((b) => b.id));
  },

  /* --- editing -------------------------------------------------------- */
  deleteSelection() {
    const ids = editable();
    if (!ids.length) return warnNothing();
    model.transaction(`Delete ${ids.length} piece${ids.length === 1 ? '' : 's'}`, () => {
      for (const id of ids) model.removeBrick(id);
    });
    model.selection.clear();
    afterSelection();
    ui.flash(`Deleted ${ids.length} piece${ids.length === 1 ? '' : 's'}.`);
  },
  duplicate() {
    const ids = editable();
    if (!ids.length) return warnNothing();
    const made = [];
    model.transaction('Duplicate', () => {
      for (const id of ids) {
        const b = model.bricks.get(id);
        const copy = { ...deepClone(b), id: uid('brk'), x: b.x + 2, z: b.z + 2 };
        delete copy.group;
        const nb = model.addBrick(copy);
        if (nb) made.push(nb.id);
      }
    });
    A.selectIds(made);
    ui.flash('Duplicated, offset by one stud.');
  },
  rotateSelection(dir = 1) {
    const ids = editable();
    if (!ids.length) return warnNothing();
    const next = rotatedRecords(model, ids, dir);
    const set = new Set(ids);
    const clash = next.some((r) => model.collisions({ ...model.bricks.get(r.id), ...r }, set).length);
    if (clash && !model.settings.collisionOverride) {
      ui.flash('Turning this would overlap something. Move it clear first.', 'bad');
      return;
    }
    model.transaction('Rotate', () => { for (const r of next) model.updateBrick(r.id, r); });
  },
  mirror(axis) {
    const ids = editable();
    if (!ids.length) return warnNothing();
    const next = mirroredRecords(model, ids, axis);
    model.transaction('Mirror', () => { for (const r of next) model.updateBrick(r.id, r); });
    ui.flash('Mirrored. Check for overlaps — mirroring can leave pieces touching.');
  },
  dropToSurface() {
    const ids = editable();
    if (!ids.length) return warnNothing();
    const next = dropRecords(model, ids);
    if (!next.length) { ui.flash('Already resting on something.'); return; }
    model.transaction('Bring to the surface', () => { for (const r of next) model.updateBrick(r.id, { y: r.y }); });
  },
  nudge(dx, dy, dz) {
    const ids = editable();
    if (!ids.length) return false;
    const v = validateMove(model, ids, { dx, dy, dz });
    if (!v.ok && !model.settings.collisionOverride) { ui.flash(v.reason, 'bad'); return true; }
    model.transaction('Move', () => {
      for (const id of ids) {
        const b = model.bricks.get(id);
        model.updateBrick(id, { x: b.x + dx, y: b.y + dy, z: b.z + dz });
      }
    });
    return true;
  },
  recolor(colorId) {
    const ids = editable();
    if (!ids.length) return false;
    model.transaction('Recolour', () => { for (const id of ids) model.updateBrick(id, { color: colorId }); });
    return true;
  },
  toggleHidden() {
    const ids = [...model.selection];
    if (!ids.length) return warnNothing();
    const to = !model.bricks.get(ids[0])?.hidden;
    model.transaction(to ? 'Hide' : 'Show', () => { for (const id of ids) model.updateBrick(id, { hidden: to }); });
    view.rebuildAll();
    ui.refreshInspector();
  },
  toggleLocked() {
    const ids = [...model.selection];
    if (!ids.length) return warnNothing();
    const to = !model.bricks.get(ids[0])?.locked;
    model.transaction(to ? 'Lock' : 'Unlock', () => { for (const id of ids) model.updateBrick(id, { locked: to }); });
    ui.refreshInspector();
  },
  replacePart(partId) {
    const ids = editable();
    if (!ids.length) return;
    model.transaction('Replace piece', () => { for (const id of ids) model.updateBrick(id, { part: partId }); });
    ui.flash('Replaced. Watch for new overlaps if the piece got bigger.');
  },
  setFine(deg) {
    const ids = editable();
    model.transaction('Fine turn', () => { for (const id of ids) model.updateBrick(id, { fine: deg }); });
  },
  copy() {
    const ids = [...model.selection];
    if (!ids.length) return;
    const list = ids.map((id) => deepClone(model.bricks.get(id))).filter(Boolean);
    const minX = Math.min(...list.map((b) => b.x)), minY = Math.min(...list.map((b) => b.y)), minZ = Math.min(...list.map((b) => b.z));
    state.clipboard = list.map((b) => ({ ...b, x: b.x - minX, y: b.y - minY, z: b.z - minZ }));
    ui.flash(`Copied ${list.length} piece${list.length === 1 ? '' : 's'}.`);
  },
  paste() {
    if (!state.clipboard || !state.clipboard.length) { ui.flash('Nothing has been copied yet.', 'bad'); return; }
    const anchor = state.ghost && state.ghost.ok ? state.ghost : { x: 0, y: 0, z: 0 };
    const made = [];
    model.transaction('Paste', () => {
      for (const b of state.clipboard) {
        const nb = model.addBrick({ ...b, id: uid('brk'), x: b.x + anchor.x, y: b.y + anchor.y, z: b.z + anchor.z, group: undefined });
        if (nb) made.push(nb.id);
      }
    });
    A.selectIds(made);
    ui.flash(`Pasted ${made.length} piece${made.length === 1 ? '' : 's'}.`);
  },

  /* --- groups and layers ---------------------------------------------- */
  group() {
    const ids = editable();
    if (ids.length < 2) { ui.flash('Select at least two pieces to group them.', 'bad'); return; }
    const gid = uid('grp');
    model.transaction('Group', () => {
      const g = new Map(model.groups);
      g.set(gid, { id: gid, name: `Group ${g.size + 1}`, collapsed: true });
      model.setGroups(g);
      for (const id of ids) model.updateBrick(id, { group: gid });
    });
    ui.refreshLayers();
  },
  ungroup() {
    const ids = editable();
    model.transaction('Ungroup', () => { for (const id of ids) model.updateBrick(id, { group: undefined }); });
    ui.refreshLayers();
  },
  toggleGroup(gid) {
    const g = new Map(model.groups);
    const e = g.get(gid);
    if (e) { g.set(gid, { ...e, collapsed: !e.collapsed }); model.transaction('Collapse group', () => model.setGroups(g)); }
    ui.refreshLayers();
  },
  async saveSubassembly() {
    const ids = [...model.selection];
    if (!ids.length) return warnNothing();
    const name = await ui.prompt('Save to your tray', 'Name this subassembly', `Assembly ${persist.getPrefs().trays.length + 1}`);
    if (!name) return;
    const list = ids.map((id) => deepClone(model.bricks.get(id))).filter(Boolean);
    const minX = Math.min(...list.map((b) => b.x)), minY = Math.min(...list.map((b) => b.y)), minZ = Math.min(...list.map((b) => b.z));
    const trays = [...persist.getPrefs().trays, {
      id: uid('sub'), name,
      bricks: list.map((b) => ({ part: b.part, color: b.color, x: b.x - minX, y: b.y - minY, z: b.z - minZ, r: b.r, fine: b.fine })),
    }];
    persist.setPref('trays', trays);
    catalog.render();
    ui.flash(`Saved "${name}" to your tray.`);
  },
  stampSubassembly(sub) {
    const anchor = state.ghost && state.ghost.ok ? state.ghost : { x: 0, y: 0, z: 0 };
    const made = [];
    model.transaction('Place ' + sub.name, () => {
      for (const b of sub.bricks) {
        const nb = model.addBrick({ ...b, id: uid('brk'), x: b.x + anchor.x, y: b.y + anchor.y, z: b.z + anchor.z });
        if (nb) made.push(nb.id);
      }
    });
    A.selectIds(made);
    A.setTool('move');
    ui.flash('Stamped. Drag it into place, then check for overlaps.');
  },
  addLayer() {
    const colors = ['#F5CD2F', '#36C2F5', '#4EC97A', '#E0574E', '#C870A0', '#F07C1F'];
    const l = { id: uid('lyr'), name: `Layer ${model.layers.length + 1}`, color: colors[model.layers.length % colors.length], visible: true, locked: false };
    model.transaction('Add layer', () => model.setLayers([...model.layers, l]));
    model.activeLayer = l.id;
    ui.refreshLayers();
  },
  duplicateLayer() {
    const src = model.layer(model.activeLayer);
    const l = { ...src, id: uid('lyr'), name: src.name + ' copy' };
    model.transaction('Duplicate layer', () => {
      model.setLayers([...model.layers, l]);
      for (const b of [...model.bricks.values()]) {
        if (b.layer === src.id) model.addBrick({ ...deepClone(b), id: uid('brk'), layer: l.id, y: b.y });
      }
    });
    ui.flash('Layer duplicated in place — the copies sit exactly on top of the originals.');
    ui.refreshLayers();
  },
  async deleteLayer() {
    if (model.layers.length < 2) { ui.flash('A project needs at least one layer.', 'bad'); return; }
    const l = model.layer(model.activeLayer);
    const n = [...model.bricks.values()].filter((b) => b.layer === l.id).length;
    if (!await ui.confirm('Delete this layer?', `"${l.name}" holds ${fmtInt(n)} piece${n === 1 ? '' : 's'}. They will be deleted too. This can be undone.`, 'Delete the layer')) return;
    model.transaction('Delete layer', () => {
      for (const b of [...model.bricks.values()]) if (b.layer === l.id) model.removeBrick(b.id);
      model.setLayers(model.layers.filter((x) => x.id !== l.id));
    });
    model.activeLayer = model.layers[0].id;
    view.rebuildAll();
    ui.refreshLayers();
  },
  async renameLayer(id) {
    const l = model.layer(id);
    const name = await ui.prompt('Rename layer', 'Layer name', l.name);
    if (!name) return;
    model.transaction('Rename layer', () => model.setLayers(model.layers.map((x) => (x.id === id ? { ...x, name } : x))));
    ui.refreshLayers();
  },
  toggleLayer(id, key) {
    model.transaction('Layer visibility', () => model.setLayers(model.layers.map((x) => (x.id === id ? { ...x, [key]: !x[key] } : x))));
    view.rebuildAll();
    ui.refreshLayers();
  },
  moveLayer(id, dir) {
    const i = model.layers.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= model.layers.length) return;
    const next = [...model.layers];
    [next[i], next[j]] = [next[j], next[i]];
    model.transaction('Reorder layers', () => model.setLayers(next));
    ui.refreshLayers();
  },
  moveToLayer(layerId) {
    const ids = editable();
    model.transaction('Move to layer', () => { for (const id of ids) model.updateBrick(id, { layer: layerId }); });
    ui.refreshLayers();
  },

  /* --- settings ------------------------------------------------------- */
  setSetting(key, value) {
    model.set(key, value);
    applySettings();
    if (key === 'performanceMode' || key === 'shadowQuality' || key === 'background') view.applyStyle();
    if (['showGrid', 'showBaseplate', 'showShadows'].includes(key)) view.updateSurface();
    ui.refreshSurface();
  },
  setSurface(key, value) {
    model.transaction('Resize the building surface', () => model.set(key, value, true));
    view.updateSurface();
    ui.refreshSurface();
  },
  setRenderStyle(id) {
    model.set('renderStyle', id);
    view.applyStyle();
    ui.flash('Render style: ' + id);
  },
  setMode(mode) {
    model.set('mode', mode);
    document.getElementById('mode-easy').classList.toggle('on', mode === 'easy');
    document.getElementById('mode-advanced').classList.toggle('on', mode === 'advanced');
    document.getElementById('mode-easy').setAttribute('aria-checked', String(mode === 'easy'));
    document.getElementById('mode-advanced').setAttribute('aria-checked', String(mode === 'advanced'));
    for (const el of document.querySelectorAll('.adv')) el.style.display = mode === 'advanced' ? '' : 'none';
    if (mode === 'easy' && !EASY_PART_IDS.has(state.partId)) setPart('brick-2x4');
    if (mode === 'easy') { model.set('freePlace', false); model.set('collisionOverride', false); }
    catalog.render();
    ui.refreshAll();
    ui.flash(mode === 'easy'
      ? 'Easy Mode: a smaller catalog, automatic snapping and no overlaps. Your model is unchanged.'
      : 'Advanced Mode: full catalog, layers, groups, free placement and precise coordinates. Your model is unchanged.');
  },
  toggleTheme() {
    const next = model.settings.theme === 'dark' ? 'light' : 'dark';
    model.set('theme', next);
    applySettings();
    view.applyStyle();
  },

  /* --- camera --------------------------------------------------------- */
  setView(name) { view.rig.setView(name); },
  frameSelection() {
    const ids = model.selection.size ? model.selection : null;
    const bb = model.bounds(ids);
    if (!bb) { A.frameAll(); return; }
    view.rig.frame(boxOf(bb));
  },
  frameAll() {
    const bb = model.bounds();
    if (bb) view.rig.frame(boxOf(bb));
    else {
      const s = model.settings;
      view.rig.frame(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s.baseW * STUD, 10, s.baseD * STUD)));
    }
  },
  resetCamera() { view._centred = false; view.centreDefault(); view.rig.setView('iso'); },
  toggleOrtho() {
    view.rig.ortho3d = !view.rig.ortho3d;
    model.set('ortho', view.rig.ortho3d);
    view.rig.update();
    document.getElementById('btn-ortho').textContent = view.rig.ortho3d ? 'Ortho' : 'Persp';
  },
  toggleTurntable() {
    model.set('turntable', !model.settings.turntable);
    document.getElementById('btn-turntable').classList.toggle('on', model.settings.turntable);
  },

  /* --- projects ------------------------------------------------------- */
  async newProject() {
    if (model.bricks.size && !await ui.confirm('Start a new project?',
      `"${model.name}" has ${fmtInt(model.bricks.size)} pieces. It stays in your saved projects, and this one starts empty.`, 'Start a new project')) return;
    closeDialogs();
    model.reset('Untitled build');
    view.rebuildAll();
    view.updateSurface();
    ui.refreshAll();
    persist.scheduleAutosave(() => model.toJSON(), 200);
    ui.flash('New project.');
  },
  async rename() {
    const name = await ui.prompt('Rename project', 'Project name', model.name);
    if (!name) return;
    model.name = name;
    model.touch();
    persist.scheduleAutosave(() => model.toJSON(), 200);
    ui.flash('Renamed to "' + name + '".');
  },
  async saveNow() {
    try {
      persist.cancelAutosave();
      await persist.saveProject(model.toJSON());
      model.dirty = false;
      ui.flash('Saved.');
    } catch (e) { ui.error('Save failed', e.message); }
  },
  async saveCopy() {
    const name = await ui.prompt('Save a copy', 'Name for the copy', model.name + ' copy');
    if (!name) return;
    const json = model.toJSON();
    json.id = uid('proj'); json.name = name; json.created = Date.now();
    try { await persist.saveProject(json); ui.flash(`Saved a copy as "${name}".`); }
    catch (e) { ui.error('Save failed', e.message); }
  },
  async openProject(id) {
    try {
      const data = await persist.loadProject(id);
      await loadData(data, 'Opened');
      closeDialogs();
    } catch (e) { ui.error('Could not open that project', e.message); }
  },
  async duplicateProject(id) {
    try { await persist.duplicateProject(id); ui.flash('Copied.'); closeDialogs(); ui.openProject(); }
    catch (e) { ui.error('Could not copy that project', e.message); }
  },
  async deleteProject(id, name) {
    if (!await ui.confirm('Delete this project?', `"${name}" will be removed from this browser. There is no undo for this.`, 'Delete it')) return;
    try { await persist.deleteProject(id); closeDialogs(); ui.openProject(); }
    catch (e) { ui.error('Could not delete that project', e.message); }
  },
  async loadExample(id) {
    const data = exampleProject(id);
    if (model.bricks.size && !await ui.confirm('Replace the current build?',
      `"${model.name}" has ${fmtInt(model.bricks.size)} pieces. A recovery point is made first.`, 'Load the example')) return;
    if (model.bricks.size) await persist.saveCheckpoint(model.toJSON(), 'Before loading ' + data.name);
    await loadData(data, 'Loaded');
    if (data.note) ui.flash(data.note);
    closeDialogs();
  },
  async clearSampleData() {
    if (!await ui.confirm('Clear the sample build?',
      'This empties the workspace and clears the example that was loaded. Your other saved projects are untouched.', 'Clear it')) return;
    model.transaction('Clear sample data', () => { for (const id of [...model.bricks.keys()]) model.removeBrick(id); });
    model.name = 'Untitled build';
    model.steps = null;
    view.rebuildAll();
    ui.refreshAll();
    closeDialogs();
    ui.flash('Cleared. The table is empty.');
  },
  async clearAllData() {
    if (!await ui.confirm('Erase everything on this machine?',
      'Every saved project, recovery point, favourite and preference stored by BRICKWORK in this browser will be deleted. Exported files on your disk are not affected. This cannot be undone.', 'Erase everything')) return;
    try {
      await persist.clearAllData();
      ui.flash('Erased. Reloading.');
      setTimeout(() => location.reload(), 700);
    } catch (e) { ui.error('Could not erase storage', e.message); }
  },
  async importProject(share = false) {
    const file = await io.pickFile('.json,.bwp,.bwshare,application/json');
    if (!file) return;
    try {
      const { data, warnings } = await io.parseProjectFile(file);
      if (model.bricks.size) {
        if (!await ui.confirm('Replace the current build?',
          `"${file.name}" holds ${fmtInt((data.bricks || []).length)} pieces. A recovery point is saved before it replaces "${model.name}".`, 'Import it')) return;
        await persist.saveCheckpoint(model.toJSON(), 'Before importing ' + file.name);
      }
      const w = await loadData(data, 'Imported');
      for (const msg of warnings.concat(w || [])) ui.toast(msg, 'warn');
      closeDialogs();
    } catch (e) { ui.error('That file could not be imported', e.message); }
  },
  async recoverAutosave() {
    const a = await persist.getAutosave();
    if (!a || !a.data) { ui.error('Nothing to recover', 'There is no autosave in this browser yet.'); return; }
    if (!await ui.confirm('Recover the last autosave?',
      `Saved ${new Date(a.at).toLocaleString()} — "${a.data.name}", ${fmtInt((a.data.bricks || []).length)} pieces. The current build is checkpointed first.`, 'Recover it')) return;
    await persist.saveCheckpoint(model.toJSON(), 'Before recovering autosave');
    await loadData(a.data, 'Recovered');
    closeDialogs();
  },
  async restoreCheckpoint(key) {
    try {
      const data = await persist.loadCheckpoint(key);
      await loadData(data, 'Restored');
      closeDialogs();
    } catch (e) { ui.error('Could not restore that recovery point', e.message); }
  },

  /* --- export --------------------------------------------------------- */
  exportProject() { io.exportProject(model); ui.flash('Project exported.'); },
  exportShare() { io.exportShare(model); ui.flash('Share file exported.'); },
  exportInventory() { io.exportInventory(model); },
  exportBOM() { io.exportBOMCSV(model); },
  exportPNG(transparent) {
    try { io.exportPNG(view, model, transparent); ui.flash('Screenshot saved.'); }
    catch (e) { ui.error('Screenshot failed', e.message); }
  },
  exportMesh(kind) {
    if (!model.bricks.size) { ui.error('Nothing to export', 'Place some bricks first.'); return; }
    const tris = io.countTriangles(model);
    const go = () => {
      try {
        if (kind === 'obj') io.exportOBJ(model); else io.exportSTL(model);
        ui.flash(`${kind.toUpperCase()} exported — visualisation geometry only.`);
      } catch (e) { ui.error('Export failed', e.message); }
    };
    if (tris > 900000) {
      ui.confirm('That is a large mesh',
        `This model comes to about ${fmtInt(Math.round(tris))} triangles. The file will be big and may take a while to write. Exported geometry has no clearances or tolerances and is not manufacturing-ready.`,
        'Export anyway').then((ok) => { if (ok) go(); });
    } else go();
  },
  async previewCard() {
    try {
      const blob = await io.previewCard(view, model);
      io.download(blob, io.safeName(model.name, '.card.png'));
      ui.flash('Preview card saved.');
    } catch (e) { ui.error('Could not make the preview card', e.message); }
  },
  copySummary() {
    const text = io.projectSummary(model);
    navigator.clipboard?.writeText(text).then(
      () => ui.flash('Summary copied to the clipboard.'),
      () => ui.dialog('Project summary', document.createElement('pre')).querySelector('pre').textContent = text);
  },
  shareLink() {
    const r = io.shareURL(model);
    if (!r.ok) { ui.error('This build is too big for a link', r.reason); return; }
    const input = document.createElement('input');
    input.className = 'ctl'; input.value = r.url; input.readOnly = true;
    const body = document.createElement('div');
    body.append(
      Object.assign(document.createElement('p'), { textContent: `The whole model is encoded in the link itself — ${fmtInt(r.length)} characters. Nothing is uploaded.`, style: 'margin-top:0' }),
      input);
    ui.dialog('Share this build', body);
    setTimeout(() => { input.focus(); input.select(); }, 40);
  },

  /* --- instructions --------------------------------------------------- */
  generateInstructions() {
    if (!model.bricks.size) { ui.error('Nothing to document', 'Place some bricks first.'); return; }
    model.transaction('Generate instructions', () => model.setSteps(instr.generatePlan(model)));
    ui.previewStep = null;
    ui.refreshSteps();
    ui.flash(`${model.steps.steps.length} steps generated. Reorder them as you like.`);
  },
  previewStep(i) {
    ui.previewStep = i;
    if (i == null) view.filter = null;
    else {
      const upto = instr.bricksThrough(model.steps, i);
      view.filter = (b) => upto.has(b.id) && model.isVisible(b);
    }
    view.rebuildAll();
    ui.refreshSteps();
  },
  async renameStep(i) {
    const s = model.steps.steps[i];
    const t = await ui.prompt('Step ' + (i + 1), 'Step title', s.title);
    if (t == null) return;
    const next = deepClone(model.steps);
    next.steps[i].title = t;
    model.transaction('Rename step', () => model.setSteps(next));
    ui.refreshSteps();
  },
  moveStep(i, dir) {
    const j = i + dir;
    const next = deepClone(model.steps);
    if (j < 0 || j >= next.steps.length) return;
    [next.steps[i], next.steps[j]] = [next.steps[j], next.steps[i]];
    model.transaction('Reorder steps', () => model.setSteps(next));
    ui.refreshSteps();
  },
  mergeStep(i) {
    if (i < 1) return;
    const next = deepClone(model.steps);
    next.steps[i - 1].ids.push(...next.steps[i].ids);
    next.steps.splice(i, 1);
    model.transaction('Merge steps', () => model.setSteps(next));
    ui.refreshSteps();
  },
  async exportInstructionsPDF() {
    if (!model.steps) A.generateInstructions();
    if (!model.steps) return;
    const t = ui.toast('Building the PDF…', 'info', 0);
    try {
      await instr.exportPDF(view, model, model.steps, {
        onProgress: (i, n, label) => { t.firstChild.textContent = `${label} (${i}/${n})`; },
      });
      t.remove();
      ui.flash('Instructions PDF saved.');
    } catch (e) { t.remove(); ui.error('The PDF could not be written', e.message); }
  },
  async exportStepImages() {
    if (!model.steps) A.generateInstructions();
    if (!model.steps) return;
    const t = ui.toast(`Rendering ${model.steps.steps.length} step images…`, 'info', 0);
    try { await instr.exportStepImages(view, model, model.steps); t.remove(); ui.flash('Step images saved.'); }
    catch (e) { t.remove(); ui.error('Step images failed', e.message); }
  },

  /* --- challenges and tutorial ---------------------------------------- */
  setChallenge(c) {
    ui.challenge = c;
    if (!c && ui.timer) { clearInterval(ui.timer); ui.timer = null; }
    ui.refreshChallenges();
    if (c) ui.flash(c.brief, 'ok');
  },
  toggleTimer() {
    if (ui.timer) { clearInterval(ui.timer); ui.timer = null; ui.refreshChallenges(); return; }
    state.timerStart = Date.now();
    ui.timer = setInterval(() => {
      const s = Math.floor((Date.now() - state.timerStart) / 1000);
      ui.timerText = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      ui.refreshChallenges();
    }, 1000);
    ui.refreshChallenges();
  },
  startTutorial() { A.tutorialStep(0); },
  tutorialStep(i) {
    if (i >= TUTORIAL.length) {
      document.getElementById('dlg-tutorial').close();
      persist.setPref('tutorialSeen', true);
      ui.flash('Have fun. Press ? any time.');
      return;
    }
    state.tutorial = i;
    ui.tutorial(i, A);
  },
};
app.actions = A;
ui.app = app;

const TOOL_HINTS = {
  place: 'Aim at the table or the top of a brick and click to place. R turns the piece.',
  select: 'Click a piece to select it. Shift-click adds, and dragging draws a box.',
  move: 'Drag the arrows to move the selection, or nudge it with the arrow keys.',
  rotate: 'Drag left or right to turn the selection in quarter turns.',
  orbit: 'Drag to orbit the camera. Scroll to zoom.',
};

/* --------------------------------------------------------------- state -- */
function setPart(id) {
  if (!getPart(id)) return;
  state.partId = id;
  state.rot = 0; state.fine = 0;
  persist.setPref('lastPart', id);
  view.setGhost(id, state.colorId, state.rot, state.fine);
  if (state.tool !== 'place') A.setTool('place');
  catalog.render();
  ui.refreshInspector();
  ui.setStatus(`${getPart(id).name} on the pointer. Click to place it.`);
}
function pickColor(id) {
  state.colorId = id;
  persist.setPref('lastColor', id);
  if (model.selection.size) A.recolor(id);
  catalog.renderColors();
  ui.refreshInspector();
}
function editable() {
  return [...model.selection].filter((id) => model.isEditable(model.bricks.get(id)));
}
function warnNothing() {
  ui.flash(model.selection.size ? 'Those pieces are locked or on a locked layer.' : 'Nothing is selected.', 'bad');
}
function afterSelection() {
  view.updateSelection();
  ui.refreshInspector();
  ui.refreshLayers();
}
function boxOf(bb) {
  return new THREE.Box3(
    new THREE.Vector3(bb.x0 * HALF, bb.y0 * PLATE, bb.z0 * HALF),
    new THREE.Vector3(bb.x1 * HALF, bb.y1 * PLATE, bb.z1 * HALF));
}
function closeDialogs() { for (const d of document.querySelectorAll('dialog')) if (d.open) d.close(); }

async function loadData(data, verb) {
  try {
    const warnings = model.loadJSON(data);
    view._centred = false;
    view.updateSurface();
    view.applyStyle();
    view.rebuildAll();
    applySettings();
    ui.previewStep = null;
    ui.analysisOn = false;
    view.showAnalysis(null);
    ui.refreshAll();
    A.frameAll();
    persist.scheduleAutosave(() => model.toJSON(), 400);
    ui.flash(`${verb} "${model.name}" — ${fmtInt(model.bricks.size)} pieces.`);
    return warnings;
  } catch (e) {
    ui.error('That project could not be loaded', e.message);
    throw e;
  }
}

function applySettings() {
  const s = model.settings;
  const root = document.documentElement;
  root.classList.toggle('theme-light', s.theme === 'light');
  root.classList.toggle('theme-dark', s.theme !== 'light');
  document.body.classList.toggle('hc', !!s.highContrast);
  document.body.classList.toggle('reduce', !!s.reducedMotion);
  root.style.setProperty('--ui', String(s.uiScale || 1));
  view.rig.ortho3d = !!s.ortho;
  view.rig.update();
  document.getElementById('sel-style').value = s.renderStyle;
  document.getElementById('btn-ortho').textContent = view.rig.ortho3d ? 'Ortho' : 'Persp';
  document.getElementById('btn-turntable').classList.toggle('on', !!s.turntable);
  for (const el of document.querySelectorAll('.adv')) el.style.display = s.mode === 'advanced' ? '' : 'none';
  document.getElementById('mode-easy').classList.toggle('on', s.mode === 'easy');
  document.getElementById('mode-advanced').classList.toggle('on', s.mode === 'advanced');
}

/* -------------------------------------------------------- model events -- */
on('model:changed', ({ tx }) => {
  const ids = new Set();
  let full = false;
  for (const op of tx.ops) {
    if (op.op === 'add' || op.op === 'remove') ids.add(op.brick.id);
    else if (op.op === 'update') ids.add(op.id);
    else full = true;
  }
  if (full) view.rebuildAll(); else view.touchBricks([...ids]);
  view.updateSelection();
  scheduleUI();
  persist.scheduleAutosave(() => model.toJSON());
  autoExpand();
});
on('tray:stamp', (sub) => A.stampSubassembly(sub));

let uiTimer = 0;
function scheduleUI() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    ui.refreshAll();
    document.getElementById('btn-undo').disabled = !model.undoStack.length;
    document.getElementById('btn-redo').disabled = !model.redoStack.length;
    document.getElementById('btn-undo').title = model.undoLabel ? 'Undo ' + model.undoLabel + ' (Ctrl+Z)' : 'Nothing to undo';
    document.getElementById('btn-redo').title = model.redoLabel ? 'Redo ' + model.redoLabel + ' (Ctrl+Shift+Z)' : 'Nothing to redo';
  }, 90);
}
function autoExpand() {
  const s = model.settings;
  if (!s.autoExpand) return;
  const bb = model.bounds();
  if (!bb) return;
  let w = s.baseW, d = s.baseD, changed = false;
  while (bb.x1 / 2 > w - 2 && w < 96) { w += 8; changed = true; }
  while (bb.z1 / 2 > d - 2 && d < 96) { d += 8; changed = true; }
  if (changed) {
    model.set('baseW', w); model.set('baseD', d);
    view.updateSurface();
    ui.refreshSurface();
    ui.flash(`The building surface grew to ${w} × ${d} studs.`);
  }
}

/* -------------------------------------------------------------- input -- */
const pointers = new Map();
let drag = null;
let ghostScreen = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('pointerleave', () => { if (!drag) { view.hideGhost(); ui.hoverMessage(null); } });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.rig.dolly(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016));
  updateGhostFromLast();
}, { passive: false });

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, px: e.clientX - r.left, py: e.clientY - r.top };
}

function onDown(e) {
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
  view._interacting = true;
  if (pointers.size === 2) { drag = { mode: 'pinch', ...pinchState() }; return; }
  if (pointers.size > 2) return;

  const p = ndc(e);
  const touch = e.pointerType === 'touch';
  const orbitBtn = e.button === 2 || (e.button === 0 && e.altKey);
  const panBtn = e.button === 1 || (e.button === 2 && e.shiftKey);

  if (panBtn) { drag = { mode: 'pan', x: e.clientX, y: e.clientY }; return; }
  if (orbitBtn) { drag = { mode: 'orbit', x: e.clientX, y: e.clientY }; return; }
  if (e.button !== 0) return;
  if (touch) { drag = { mode: 'touch1', x: e.clientX, y: e.clientY, start: p }; return; }

  if (state.tool === 'orbit') { drag = { mode: 'orbit', x: e.clientX, y: e.clientY }; return; }
  if (state.tool === 'move' || state.tool === 'rotate') {
    const axis = view.pickGizmo(p.x, p.y);
    if (axis) { drag = startGizmo(axis, e); return; }
  }
  if (state.tool === 'select') { drag = { mode: 'marquee', x: p.px, y: p.py, sx: p.x, sy: p.y, shift: e.shiftKey }; return; }
  drag = { mode: 'click', x: e.clientX, y: e.clientY, shift: e.shiftKey };
}

function onMove(e) {
  const rec = pointers.get(e.pointerId);
  if (rec) {
    rec.moved += Math.abs(e.clientX - rec.x) + Math.abs(e.clientY - rec.y);
    rec.x = e.clientX; rec.y = e.clientY;
  }
  ghostScreen = ndc(e);

  if (drag && drag.mode === 'pinch' && pointers.size >= 2) {
    const s = pinchState();
    view.rig.dolly(clamp(drag.dist / s.dist, 0.6, 1.6));
    view.rig.pan(s.cx - drag.cx, s.cy - drag.cy);
    drag.dist = s.dist; drag.cx = s.cx; drag.cy = s.cy;
    return;
  }
  if (drag && drag.mode === 'touch1') {
    const d = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (d > 9) { drag.mode = 'orbit'; }
    else return;
  }
  if (drag && (drag.mode === 'orbit' || drag.mode === 'pan')) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'orbit') view.rig.orbit(dx, dy); else view.rig.pan(dx, dy);
    return;
  }
  if (drag && drag.mode === 'marquee') {
    const m = document.getElementById('marquee');
    m.style.display = 'block';
    const p = ghostScreen;
    m.style.left = Math.min(drag.x, p.px) + 'px';
    m.style.top = Math.min(drag.y, p.py) + 'px';
    m.style.width = Math.abs(p.px - drag.x) + 'px';
    m.style.height = Math.abs(p.py - drag.y) + 'px';
    return;
  }
  if (drag && drag.mode === 'gizmo') { dragGizmo(e); return; }
  if (drag && drag.mode === 'click') {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.mode = 'orbit';
    return;
  }
  updateGhost(ghostScreen);
}

function onUp(e) {
  const rec = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size === 0) view._interacting = false;
  const p = ndc(e);
  const d = drag;
  if (pointers.size >= 1 && d && d.mode === 'pinch') { drag = null; return; }
  drag = null;
  document.getElementById('marquee').style.display = 'none';
  if (!d) return;

  if (d.mode === 'marquee') {
    const dist = Math.hypot(p.px - d.x, p.py - d.y);
    if (dist > 8) {
      const ids = view.pickBox(d.sx, d.sy, p.x, p.y);
      A.selectIds(ids, d.shift);
      ui.flash(`${ids.length} piece${ids.length === 1 ? '' : 's'} selected.`);
    } else doClick(p, d.shift);
    return;
  }
  if (d.mode === 'gizmo') { endGizmo(); return; }
  if (d.mode === 'click') { doClick(p, d.shift); return; }
  if (d.mode === 'touch1') {
    const quick = rec && rec.moved < 12 && performance.now() - rec.t < 600;
    if (quick) { updateGhost(p); doClick(p, false); }
    return;
  }
}
function pinchState() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function doClick(p, shift) {
  if (state.tool === 'place') { doPlace(p); return; }
  const hit = view.pick(p.x, p.y);
  const id = hit && hit.brickId;
  if (!id) { if (!shift) A.clearSelection(); return; }
  if (shift) {
    if (model.selection.has(id)) model.selection.delete(id); else model.selection.add(id);
    afterSelection();
  } else A.selectIds([id]);
}

function doPlace(p) {
  const res = computePlacement(p);
  if (!res) { ui.flash('Aim at the table or at a brick.', 'bad'); return; }
  if (!res.ok) { ui.flash(res.reason, 'bad'); return; }
  let made = null;
  model.transaction('Place ' + (getPart(state.partId)?.name || 'brick'), () => {
    made = model.addBrick({
      part: state.partId, color: state.colorId,
      x: res.x, y: res.y, z: res.z, r: res.r ?? state.rot,
      fine: state.fine || undefined,
    });
  });
  if (!made) { ui.flash('That piece could not be added.', 'bad'); return; }
  catalog.markUsed(state.partId);
  if (res.adjusted) ui.flash(res.adjusted);
  if (model.settings.haptics && navigator.vibrate) navigator.vibrate(8);
  if (model.settings.sound) blip();
  if (state.tutorial >= 0) checkTutorial('place');
}

function computePlacement(p) {
  const hit = view.pick(p.x, p.y);
  if (!hit) return null;
  const target = hit.brickId ? model.bricks.get(hit.brickId) : null;
  return resolvePlacement({
    model, partId: state.partId, r: state.rot, fine: state.fine,
    settings: model.settings, point: hit.point, normal: hit.normal, target,
  });
}
function updateGhost(p) {
  if (state.tool !== 'place') {
    const hit = view.pick(p.x, p.y);
    view.setHover(hit ? hit.brickId : null);
    return;
  }
  const res = computePlacement(p);
  state.ghost = res;
  if (!res) { view.hideGhost(); ui.setPointer(null, null); ui.hoverMessage(null); return; }
  view.setGhost(state.partId, state.colorId, res.r ?? state.rot, state.fine);
  view.placeGhost(res, res.ok, res.warn);
  ui.setPointer(res, res.snapType);
  ui.hoverMessage(res.reason, res.ok ? (res.warn ? 'warn' : 'ok') : 'bad');
}
function updateGhostFromLast() { if (state.tool === 'place') updateGhost(ghostScreen); }

/* ------------------------------------------------------------- gizmo --- */
function startGizmo(axis, e) {
  return { mode: 'gizmo', axis, x: e.clientX, y: e.clientY, applied: { dx: 0, dy: 0, dz: 0, r: 0 }, ids: editable() };
}
function dragGizmo(e) {
  const d = drag;
  if (!d.ids.length) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  const perPx = 5 + view.rig.radius / 90;
  if (d.axis === 'ry') {
    const want = Math.round(dx / 70);
    const delta = want - d.applied.r;
    if (delta) {
      for (let i = 0; i < Math.abs(delta); i++) A.rotateSelection(Math.sign(delta));
      d.applied.r = want;
    }
    return;
  }
  const cam = view.rig.camera;
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
  let want = { dx: 0, dy: 0, dz: 0 };
  if (d.axis === 'y') want.dy = Math.round(-dy / perPx);
  else if (d.axis === 'x') want.dx = Math.round((dx * Math.sign(right.x || 1)) / perPx) * 2;
  else want.dz = Math.round((dx * Math.sign(right.z || 1)) / perPx) * 2;
  const delta = { dx: want.dx - d.applied.dx, dy: want.dy - d.applied.dy, dz: want.dz - d.applied.dz };
  if (delta.dx || delta.dy || delta.dz) {
    if (A.nudge(delta.dx, delta.dy, delta.dz) !== true) return;
    d.applied = want;
  }
}
function endGizmo() { view.updateGizmo(); }

/* ---------------------------------------------------------- keyboard --- */
addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  const meta = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (meta) {
    switch (k.toLowerCase()) {
      case 'z': e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return;
      case 'y': e.preventDefault(); doRedo(); return;
      case 'c': e.preventDefault(); A.copy(); return;
      case 'v': e.preventDefault(); A.paste(); return;
      case 'a': e.preventDefault(); A.selectAll(); return;
      case 's': e.preventDefault(); A.saveNow(); return;
      case 'd': e.preventDefault(); A.duplicate(); return;
      default: return;
    }
  }
  if (k >= '1' && k <= '6') { A.setView(['front', 'back', 'left', 'right', 'top', 'iso'][Number(k) - 1]); return; }
  switch (k) {
    case 'r': case 'R':
      state.rot = (state.rot + (e.shiftKey ? 3 : 1)) & 3;
      if (model.selection.size) A.rotateSelection(e.shiftKey ? -1 : 1);
      else { view.setGhost(state.partId, state.colorId, state.rot, state.fine); updateGhostFromLast(); ui.refreshInspector(); }
      break;
    case 'p': case 'P': A.setTool('place'); break;
    case 'v': case 'V': A.setTool('select'); break;
    case 'm': case 'M': A.setTool('move'); break;
    case 't': case 'T': A.setTool('rotate'); break;
    case 'o': case 'O': A.setTool('orbit'); break;
    case 'd': case 'D': A.duplicate(); break;
    case 'c': case 'C': if (model.selection.size) A.recolor(state.colorId); break;
    case 'f': case 'F': e.shiftKey ? A.frameAll() : A.frameSelection(); break;
    case 'g': case 'G': A.setSetting('showGrid', !model.settings.showGrid); break;
    case 'h': case 'H': A.setSetting('snapHalf', !model.settings.snapHalf); ui.flash(model.settings.snapHalf ? 'Half-stud offsets on.' : 'Half-stud offsets off.'); break;
    case 'Delete': case 'Backspace': e.preventDefault(); A.deleteSelection(); break;
    case 'Escape':
      if (model.selection.size) A.clearSelection();
      else if (state.tool !== 'place') A.setTool('place');
      break;
    case '?': ui.openHelp(); break;
    case 'Enter': if (state.tool === 'place') doPlace(ghostScreen); break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      e.preventDefault();
      const s = model.settings.snapHalf ? 1 : 2;
      const map = { ArrowLeft: [-s, 0, 0], ArrowRight: [s, 0, 0], ArrowUp: [0, 0, -s], ArrowDown: [0, 0, s] };
      const [dx, dy, dz] = map[k];
      if (model.selection.size) A.nudge(dx, dy, dz);
      else if (state.ghost) {
        state.ghost = { ...state.ghost, x: state.ghost.x + dx, z: state.ghost.z + dz };
        view.placeGhost(state.ghost, true);
        ui.setPointer(state.ghost, 'keyboard');
      }
      break;
    }
    case 'PageUp': case 'PageDown': {
      e.preventDefault();
      const dy = k === 'PageUp' ? 1 : -1;
      if (model.selection.size) A.nudge(0, dy, 0);
      else if (state.ghost) {
        state.ghost = { ...state.ghost, y: Math.max(0, state.ghost.y + dy) };
        view.placeGhost(state.ghost, true);
        ui.setPointer(state.ghost, 'keyboard');
      }
      break;
    }
    default: return;
  }
});
function doUndo() {
  const l = model.undo();
  if (l) ui.flash('Undid: ' + l); else ui.flash('Nothing left to undo.');
  afterSelection(); scheduleUI();
}
function doRedo() {
  const l = model.redo();
  if (l) ui.flash('Redid: ' + l); else ui.flash('Nothing to redo.');
  afterSelection(); scheduleUI();
}

/* ------------------------------------------------------- chrome wiring -- */
for (const b of document.querySelectorAll('#tools .btn')) b.addEventListener('click', () => A.setTool(b.dataset.tool));
for (const b of document.querySelectorAll('#viewbar [data-view]')) b.addEventListener('click', () => A.setView(b.dataset.view));
document.getElementById('btn-undo').addEventListener('click', doUndo);
document.getElementById('btn-redo').addEventListener('click', doRedo);
document.getElementById('btn-project').addEventListener('click', () => ui.openProject());
document.getElementById('btn-help').addEventListener('click', () => ui.openHelp());
document.getElementById('btn-theme').addEventListener('click', () => A.toggleTheme());
document.getElementById('mode-easy').addEventListener('click', () => A.setMode('easy'));
document.getElementById('mode-advanced').addEventListener('click', () => A.setMode('advanced'));
document.getElementById('btn-frame-sel').addEventListener('click', () => A.frameSelection());
document.getElementById('btn-frame-all').addEventListener('click', () => A.frameAll());
document.getElementById('btn-ortho').addEventListener('click', () => A.toggleOrtho());
document.getElementById('btn-turntable').addEventListener('click', () => A.toggleTurntable());
document.getElementById('btn-reset-cam').addEventListener('click', () => A.resetCamera());

for (const [btnId, panelId, pref] of [['btn-left', 'left', 'leftOpen'], ['btn-right', 'right', 'rightOpen']]) {
  const b = document.getElementById(btnId), panel = document.getElementById(panelId);
  b.addEventListener('click', () => {
    const open = panel.classList.toggle('collapsed');
    b.setAttribute('aria-pressed', String(!open));
    persist.setPref(pref, !open);
    setTimeout(() => view.resize(), 60);
  });
}
setupGrip('grip-left', 'left', 'leftWidth', 1);
setupGrip('grip-right', 'right', 'rightWidth', -1);
function setupGrip(gripId, panelId, prefKey, sign) {
  const grip = document.getElementById(gripId);
  const panel = document.getElementById(panelId);
  panel.style.width = clamp(persist.getPrefs()[prefKey], 180, 560) + 'px';
  if (!persist.getPrefs()[prefKey === 'leftWidth' ? 'leftOpen' : 'rightOpen']) {
    panel.classList.add('collapsed');
    document.getElementById(prefKey === 'leftWidth' ? 'btn-left' : 'btn-right').setAttribute('aria-pressed', 'false');
  }
  let startX = 0, startW = 0;
  const move = (e) => {
    const w = clamp(startW + (e.clientX - startX) * sign, 180, 560);
    panel.style.width = w + 'px';
    view.resize();
  };
  const up = () => {
    grip.classList.remove('dragging');
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    persist.setPref(prefKey, parseInt(panel.style.width, 10));
  };
  grip.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startW = panel.offsetWidth;
    grip.classList.add('dragging');
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    panel.style.width = clamp(panel.offsetWidth + d * sign, 180, 560) + 'px';
    persist.setPref(prefKey, parseInt(panel.style.width, 10));
    view.resize();
  });
}

/* orientation cube */
const compass = document.getElementById('compass-hit');
compass.addEventListener('click', (e) => {
  const r = compass.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const v = view.pickCompass(nx, ny);
  if (v) { A.setView(v); ui.flash(v[0].toUpperCase() + v.slice(1) + ' view.'); }
  else A.setView('iso');
});
compass.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); A.setView('iso'); } });

/* drag a brick from the catalog onto the table */
canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const d = String(e.dataTransfer.getData('text/plain') || '');
  if (!d.startsWith('brickwork:part:')) return;
  setPart(d.slice(15));
  const p = ndc(e);
  updateGhost(p);
  doPlace(p);
});

addEventListener('resize', () => view.resize());
addEventListener('beforeunload', (e) => {
  if (model.dirty && persist.getSaveState() !== 'saved') { e.preventDefault(); e.returnValue = ''; }
});

/* --------------------------------------------------------- tutorial ---- */
function checkTutorial(event) {
  if (state.tutorial < 0) return;
  const step = TUTORIAL[state.tutorial];
  if (!step) return;
  if (event === 'place' && (state.tutorial === 2 || state.tutorial === 3 || state.tutorial === 4)) {
    A.tutorialStep(state.tutorial + 1);
  }
}
function blip() {
  try {
    const ctx = blip.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 640;
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.08);
  } catch { /* audio is optional */ }
}

/* ------------------------------------------------------------ startup -- */
async function start() {
  applySettings();
  A.setTool('place');
  setPart(state.partId);
  view.setGhost(state.partId, state.colorId, 0, 0);
  view.resize();
  ui.refreshAll();
  ui.setCount(0);
  ui.setSaveState('saved');

  // shared link takes priority
  const frag = location.hash.match(/#build=(.+)$/);
  if (frag) {
    try {
      const data = io.decodeShare(frag[1]);
      await loadData(data, 'Opened the shared build');
      history.replaceState(null, '', location.pathname);
      loop();
      return;
    } catch (e) {
      ui.error('That shared link could not be opened', e.message);
      history.replaceState(null, '', location.pathname);
    }
  }

  // otherwise resume the last autosave
  try {
    const a = await persist.getAutosave();
    if (a && a.data && (a.data.bricks || []).length) {
      await loadData(a.data, 'Recovered your last session —');
      ui.toast('Recovered the session that was interrupted. Project ▸ Recovery points has earlier copies.', 'info');
    } else if (!persist.getPrefs().tutorialSeen) ui.welcome();
  } catch {
    if (!persist.getPrefs().tutorialSeen) ui.welcome();
  }
  if (!persist.storageAvailable) {
    ui.toast('Browser storage is unavailable, so projects will not autosave. Export to a file before you close this tab.', 'warn', 12000);
  }
  loop();
}
function loop() {
  requestAnimationFrame(loop);
  view.render();
}
start();

/* Exposed for the console and for testing; not used by the interface. */
window.BRICKWORK = { model, view, ui, actions: A, state, VERSION, analyse, stats };
