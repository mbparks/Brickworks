/* BRICKWORK — persistence.
 *
 * Projects live in IndexedDB; small interface preferences live in
 * localStorage. Nothing is ever sent anywhere. All failures are surfaced to
 * the interface through the `save:state` event rather than swallowed.
 */
import { emit, uid, VERSION } from './core.js';

const DB_NAME = 'brickwork';
const DB_VERSION = 1;
const PREF_KEY = 'brickwork.prefs.v1';
let dbPromise = null;
export let storageAvailable = true;
export let storageError = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('This browser has no IndexedDB, so projects cannot be saved here. Export to a file instead.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('modified', 'modified');
      }
      if (!db.objectStoreNames.contains('checkpoints')) {
        db.createObjectStore('checkpoints', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Browser storage could not be opened.'));
    req.onblocked = () => reject(new Error('Another BRICKWORK tab is upgrading storage. Close other tabs and reload.'));
  }).catch((e) => { storageAvailable = false; storageError = e; throw e; });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted.'));
  }));
}

function friendlyError(e) {
  const n = e && (e.name || '');
  if (n === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
    return 'Browser storage is full. Delete an old project, or export this one to a file and clear some space.';
  }
  return (e && e.message) || 'Storage failed for an unknown reason.';
}

/* ---------------------------------------------------------------- saving -- */
let saveTimer = 0;
let saveState = 'saved';
export function getSaveState() { return saveState; }
function setSaveState(s, detail) { saveState = s; emit('save:state', { state: s, detail }); }

export async function saveProject(json, { silent = false } = {}) {
  if (!silent) setSaveState('saving');
  const record = {
    id: json.id, name: json.name, modified: Date.now(), created: json.created,
    bricks: json.bricks.length, app: VERSION, data: json,
  };
  try {
    await tx('projects', 'readwrite', (s) => s.put(record));
    setSaveState('saved', record.modified);
    return record;
  } catch (e) {
    setSaveState('failed', friendlyError(e));
    throw e;
  }
}
export function scheduleAutosave(getJSON, delay = 1800) {
  setSaveState('unsaved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const json = getJSON();
      await saveProject(json, { silent: true });
      await setMeta('autosave', { at: Date.now(), id: json.id, data: json });
      setSaveState('saved', Date.now());
    } catch (e) { setSaveState('failed', friendlyError(e)); }
  }, delay);
}
export function cancelAutosave() { clearTimeout(saveTimer); }

export async function listProjects() {
  try {
    const rows = await tx('projects', 'readonly', (s) => s.getAll());
    return (rows || []).map((r) => ({ id: r.id, name: r.name, modified: r.modified, created: r.created, bricks: r.bricks, app: r.app }))
      .sort((a, b) => b.modified - a.modified);
  } catch { return []; }
}
export async function loadProject(id) {
  const r = await tx('projects', 'readonly', (s) => s.get(id));
  if (!r) throw new Error('That project is no longer in browser storage.');
  return r.data;
}
export async function deleteProject(id) { return tx('projects', 'readwrite', (s) => s.delete(id)); }
export async function duplicateProject(id, name) {
  const data = await loadProject(id);
  data.id = uid('proj');
  data.name = name || (data.name + ' copy');
  data.created = Date.now();
  return saveProject(data);
}

/* ----------------------------------------------------------- checkpoints -- */
export async function saveCheckpoint(json, label) {
  const rec = { key: 'cp_' + Date.now(), at: Date.now(), label, name: json.name, data: json };
  try {
    await tx('checkpoints', 'readwrite', (s) => s.put(rec));
    const all = await tx('checkpoints', 'readonly', (s) => s.getAll());
    const old = (all || []).sort((a, b) => b.at - a.at).slice(6);
    for (const o of old) await tx('checkpoints', 'readwrite', (s) => s.delete(o.key));
    return rec.key;
  } catch (e) { console.warn('[brickwork] checkpoint failed', e); return null; }
}
export async function listCheckpoints() {
  try {
    const all = await tx('checkpoints', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.at - a.at);
  } catch { return []; }
}
export async function loadCheckpoint(key) {
  const r = await tx('checkpoints', 'readonly', (s) => s.get(key));
  if (!r) throw new Error('That recovery point is gone.');
  return r.data;
}

/* ------------------------------------------------------------------ meta -- */
export async function setMeta(key, value) {
  try { return await tx('meta', 'readwrite', (s) => s.put(value, key)); }
  catch (e) { return null; }
}
export async function getMeta(key) {
  try { return await tx('meta', 'readonly', (s) => s.get(key)); }
  catch { return null; }
}
export async function getAutosave() { return getMeta('autosave'); }
export async function clearAutosave() { return setMeta('autosave', null); }

/* --------------------------------------------------------- preferences --- */
const defaultPrefs = {
  leftWidth: 300, rightWidth: 322, leftOpen: true, rightOpen: true,
  tutorialSeen: false, favorites: [], recents: [], usage: {},
  catalogView: 'grid', thumbSize: 68, lastPart: 'brick-2x4', lastColor: 'red',
  trays: [],
};
let prefs = null;
export function getPrefs() {
  if (prefs) return prefs;
  try {
    prefs = Object.assign({}, defaultPrefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}'));
  } catch { prefs = { ...defaultPrefs }; }
  return prefs;
}
export function setPref(key, value) {
  const p = getPrefs();
  p[key] = value;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); }
  catch (e) { emit('toast', { level: 'warn', text: 'Interface preferences could not be saved — browser storage is full.' }); }
  return p;
}
export function resetPrefs() {
  prefs = { ...defaultPrefs };
  try { localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
}
/** Wipe every project, checkpoint and preference. */
export async function clearAllData() {
  resetPrefs();
  try {
    await tx('projects', 'readwrite', (s) => s.clear());
    await tx('checkpoints', 'readwrite', (s) => s.clear());
    await tx('meta', 'readwrite', (s) => s.clear());
  } catch (e) { throw new Error(friendlyError(e)); }
}
export async function estimateUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    } catch { /* ignore */ }
  }
  return null;
}
