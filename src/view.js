/* BRICKWORK — the 3D workspace.
 *
 * Owns the renderer, the workbench, instanced brick rendering, the camera
 * rig, the placement ghost, selection outlines and the analysis overlays.
 * Bricks are drawn with one InstancedMesh per (part, geometry group, material
 * family); only the buckets touched by an edit are rewritten.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import {
  HALF, PLATE, STUD, getColor, cvdSubstitute, hexToRgb, clamp, emit,
} from './core.js';
import { getPart } from './parts.js';
import { meshOffset, footprint } from './model.js';
import { partGeometry, mergedGeometry, GROUPS } from './geometry.js';

const DEG = Math.PI / 180;

/* --------------------------------------------------------- render styles -- */
export const RENDER_STYLES = [
  { id: 'realistic', name: 'Realistic plastic' },
  { id: 'matte', name: 'Matte prototype' },
  { id: 'blueprint', name: 'Blueprint' },
  { id: 'manual', name: 'Instruction manual' },
  { id: 'inspect', name: 'High-contrast inspection' },
  { id: 'accessible', name: 'Colour-blind friendly' },
];

function styleSpec(id, theme) {
  const dark = theme === 'dark';
  const base = {
    bg: dark ? '#20262e' : '#dfe2e4',
    table: dark ? '#2c333c' : '#c9ccd0',
    grid: dark ? '#3d4650' : '#b1b6bc',
    ambient: 0.55, key: 1.35, fill: 0.35, shadows: true,
    flat: false, tone: true, ink: null,
  };
  switch (id) {
    case 'matte': return { ...base, ambient: 0.75, key: 0.95, rough: 0.95, metal: 0 };
    case 'blueprint': return {
      ...base, bg: '#12233c', table: '#173055', grid: '#4b7fc4',
      ambient: 0.85, key: 0.55, fill: 0.4, shadows: false, flat: true,
      ink: '#9fc7f5', tone: false,
    };
    case 'manual': return {
      ...base, bg: '#f2f3f4', table: '#e4e6e8', grid: '#c6cacd',
      ambient: 0.95, key: 0.7, fill: 0.5, shadows: true, flat: true, tone: false,
    };
    case 'inspect': return {
      ...base, bg: dark ? '#000000' : '#ffffff', table: dark ? '#101418' : '#f4f4f4',
      grid: dark ? '#ffffff' : '#000000', ambient: 1.1, key: 0.5, fill: 0.5,
      shadows: false, flat: true, tone: false,
    };
    case 'accessible': return { ...base, ambient: 0.8, key: 1.0, shadows: true, cvd: true };
    default: return { ...base, rough: 0.34, metal: 0.0 };
  }
}

/* ------------------------------------------------------------ camera rig -- */
class CameraRig {
  constructor(width, height) {
    this.persp = new THREE.PerspectiveCamera(45, width / height, 4, 12000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -6000, 12000);
    this.target = new THREE.Vector3(0, 20, 0);
    this.theta = -45 * DEG; this.phi = 58 * DEG; this.radius = 620;
    this.ortho3d = false;
    this.resize(width, height);
    this.update();
  }
  get camera() { return this.ortho3d ? this.ortho : this.persp; }
  resize(w, h) {
    this.w = w; this.h = h;
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }
  updateOrtho() {
    const half = this.radius * 0.5;
    const a = this.w / this.h;
    this.ortho.left = -half * a; this.ortho.right = half * a;
    this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }
  update() {
    this.phi = clamp(this.phi, 2 * DEG, 178 * DEG);
    this.radius = clamp(this.radius, 30, 8000);
    const s = Math.sin(this.phi), c = Math.cos(this.phi);
    const p = new THREE.Vector3(
      this.target.x + this.radius * s * Math.sin(this.theta),
      this.target.y + this.radius * c,
      this.target.z + this.radius * s * Math.cos(this.theta));
    this.persp.position.copy(p); this.persp.lookAt(this.target);
    this.ortho.position.copy(p); this.ortho.lookAt(this.target);
    this.updateOrtho();
  }
  orbit(dx, dy) { this.theta -= dx * 0.008; this.phi -= dy * 0.008; this.update(); }
  dolly(f) { this.radius *= f; this.update(); }
  pan(dx, dy) {
    const cam = this.camera;
    const scale = (this.ortho3d ? this.radius * 0.5 : this.radius * Math.tan(22.5 * DEG)) * 2 / this.h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.update();
  }
  frame(box, pad = 1.35) {
    if (!box) return;
    const c = new THREE.Vector3(); box.getCenter(c);
    const size = new THREE.Vector3(); box.getSize(size);
    const radius = Math.max(size.length() * 0.5, 30) * pad;
    this.target.copy(c);
    this.radius = radius / Math.sin(22.5 * DEG) * 0.55;
    this.update();
  }
  setView(name) {
    const v = {
      front: [0, 90], back: [180, 90], left: [-90, 90], right: [90, 90],
      top: [0, 3], bottom: [0, 177], iso: [-45, 58], iso2: [135, 58],
    }[name];
    if (!v) return;
    this.theta = v[0] * DEG; this.phi = v[1] * DEG; this.update();
  }
}

/* ------------------------------------------------------------------ view -- */
export class View {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    this.buckets = new Map();       // key -> { ids:[], mesh, group, part, mat }
    this.keyOf = new Map();         // brickId -> key set (one per group)
    this.dirty = new Set();
    this.filter = null;             // optional predicate for instruction preview
    this.hover = null;
    this.pixelRatioCap = 2;
    this.stats = { fps: 0, draws: 0, tris: 0 };

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.rig = new CameraRig(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this.lights = {
      ambient: new THREE.HemisphereLight(0xffffff, 0x555a60, 0.6),
      key: new THREE.DirectionalLight(0xffffff, 1.3),
      fill: new THREE.DirectionalLight(0xdfe8ff, 0.35),
    };
    this.lights.key.position.set(220, 480, 300);
    this.lights.key.castShadow = true;
    this.lights.key.shadow.mapSize.set(2048, 2048);
    this.lights.key.shadow.bias = -0.0015;
    this.lights.key.shadow.normalBias = 0.6;
    this.lights.fill.position.set(-300, 260, -220);
    this.scene.add(this.lights.ambient, this.lights.key, this.lights.key.target, this.lights.fill);

    this.brickRoot = new THREE.Group();
    this.scene.add(this.brickRoot);

    this._buildTable();
    this._buildGhost();
    this._buildOverlays();
    this._buildGizmo();

    this.materials = new Map();
    this.applyStyle();
    this.rebuildAll();
    this._raycaster = new THREE.Raycaster();
    this._clock = new THREE.Clock();
    this._frames = 0; this._fpsT = 0;
  }

  /* ---------------------------------------------------------- workbench -- */
  _buildTable() {
    this.table = new THREE.Group();
    this.scene.add(this.table);
    const tex = makeGridTexture();
    this.surfaceMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.9, metalness: 0, map: tex });
    this.deckMat = new THREE.MeshStandardMaterial({ color: 0x262c33, roughness: 0.95, metalness: 0 });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.receiveShadow = true;
    this.surface.name = 'surface';
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.deckMat);
    this.deck.receiveShadow = true;
    this.baseStuds = null;
    this.table.add(this.deck, this.surface);
    this.gridLines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8a94a0, transparent: true, opacity: 0.5 }));
    this.table.add(this.gridLines);
    this.updateSurface();
  }

  updateSurface() {
    const s = this.model.settings;
    const W = s.baseW * STUD, D = s.baseD * STUD;
    this.surface.scale.set(W, D, 1);
    this.surface.position.set(W / 2, 0.02, D / 2);
    this.surfaceMat.map.repeat.set(s.baseW, s.baseD);
    this.surfaceMat.map.needsUpdate = true;
    this.surfaceMat.visible = s.showBaseplate;
    this.deck.scale.set(W + 160, 26, D + 160);
    this.deck.position.set(W / 2, -13, D / 2);
    // grid lines every 4 studs
    const pts = [];
    if (s.showGrid) {
      for (let i = 0; i <= s.baseW; i += 4) pts.push(i * STUD, 0.4, 0, i * STUD, 0.4, D);
      for (let i = 0; i <= s.baseD; i += 4) pts.push(0, 0.4, i * STUD, W, 0.4, i * STUD);
    }
    this.gridLines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.gridLines.geometry = g;
    this.gridLines.visible = s.showGrid;
    // baseplate studs
    if (this.baseStuds) { this.table.remove(this.baseStuds); this.baseStuds.geometry.dispose(); this.baseStuds = null; }
    if (s.showBaseplate && s.baseW * s.baseD <= 4096) {
      const geo = new THREE.CylinderGeometry(2.4, 2.3, 1.6, 10);
      const mesh = new THREE.InstancedMesh(geo, this.surfaceStudMat ||= new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.85 }), s.baseW * s.baseD);
      const m = new THREE.Matrix4();
      let i = 0;
      for (let x = 0; x < s.baseW; x++) for (let z = 0; z < s.baseD; z++) {
        m.makeTranslation(x * STUD + STUD / 2, 0.8, z * STUD + STUD / 2);
        mesh.setMatrixAt(i++, m);
      }
      mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.name = 'basestuds';
      this.baseStuds = mesh;
      this.table.add(mesh);
    }
    this.centreDefault();
  }
  centreDefault() {
    const s = this.model.settings;
    if (this._centred) return;
    this._centred = true;
    this.rig.target.set(s.baseW * STUD / 2, 20, s.baseD * STUD / 2);
    this.rig.radius = Math.max(s.baseW, s.baseD) * STUD * 1.1;
    this.rig.update();
  }

  /* -------------------------------------------------------------- ghost -- */
  _buildGhost() {
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x4ec97a, transparent: true, opacity: 0.62, roughness: 0.5,
      depthWrite: false, emissive: 0x143a22, emissiveIntensity: 0.6,
    });
    this.ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghostEdges = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.ghost.add(this.ghostMesh, this.ghostEdges);
    this.scene.add(this.ghost);

    const ringGeo = new THREE.RingGeometry(2.6, 3.9, 14);
    ringGeo.rotateX(-Math.PI / 2);
    this.snapRings = new THREE.InstancedMesh(ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x7fe3a6, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }), 256);
    this.snapRings.count = 0;
    this.snapRings.frustumCulled = false;
    this.snapRings.renderOrder = 5;
    this.scene.add(this.snapRings);
  }
  setGhost(partId, color, r, fine) {
    if (this._ghostPart !== partId) {
      this._ghostPart = partId;
      const geo = mergedGeometry(partId);
      this.ghostMesh.geometry = geo || new THREE.BufferGeometry();
      this.ghostEdges.geometry.dispose();
      this.ghostEdges.geometry = geo ? new THREE.EdgesGeometry(geo, 40) : new THREE.BufferGeometry();
    }
    this._ghostR = r; this._ghostFine = fine;
  }
  placeGhost(pos, ok, warn) {
    const p = getPart(this._ghostPart);
    if (!p || !pos) { this.ghost.visible = false; this.snapRings.count = 0; return; }
    this.ghost.visible = true;
    applyBrickTransform(this.ghost, p, { ...pos, r: pos.r ?? this._ghostR, fine: this._ghostFine });
    const c = ok ? (warn ? 0xf0a92c : 0x4ec97a) : 0xe0574e;
    this.ghostMat.color.setHex(c);
    this.ghostMat.emissive.setHex(ok ? (warn ? 0x3a2a08 : 0x143a22) : 0x3a1210);
    this.ghostEdges.material.color.setHex(ok ? 0xffffff : 0xffd9d5);
    // connection points beneath the ghost
    const m = new THREE.Matrix4();
    let i = 0;
    const fp = footprint(p, pos.r ?? this._ghostR);
    for (const b of this.model.bricks.values()) {
      if (i >= 256) break;
      const bp = getPart(b.part);
      if (!bp || !bp.studs.length) continue;
      for (const s of this.model.worldStuds(b)) {
        if (s.y !== pos.y) continue;
        if (s.x < pos.x || s.x > pos.x + fp.w || s.z < pos.z || s.z > pos.z + fp.d) continue;
        m.makeTranslation(s.x * HALF, s.y * PLATE + 2.4, s.z * HALF);
        this.snapRings.setMatrixAt(i++, m);
        if (i >= 256) break;
      }
    }
    this.snapRings.count = ok ? i : 0;
    this.snapRings.instanceMatrix.needsUpdate = true;
    this.snapRings.material.color.setHex(ok ? 0x7fe3a6 : 0xe0574e);
  }
  hideGhost() { this.ghost.visible = false; this.snapRings.count = 0; }

  /* ----------------------------------------------------------- overlays -- */
  _buildOverlays() {
    this.selLines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x36c2f5, linewidth: 2, depthTest: false, transparent: true }));
    this.selLines.renderOrder = 6; this.selLines.frustumCulled = false;
    this.hoverLines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.7 }));
    this.hoverLines.renderOrder = 6; this.hoverLines.frustumCulled = false;
    this.analysisLines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
    this.analysisLines.renderOrder = 7; this.analysisLines.frustumCulled = false;
    this.com = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff4fa3, depthTest: false }));
    this.com.visible = false; this.com.renderOrder = 8;
    this.scene.add(this.selLines, this.hoverLines, this.analysisLines, this.com);

    this.gizmo = new THREE.Group();
    this.gizmo.visible = false;
    this.gizmo.renderOrder = 9;
    const mk = (color, geo, rot, pos) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      if (rot) m.rotation.set(...rot);
      if (pos) m.position.set(...pos);
      m.renderOrder = 9;
      return m;
    };
    const shaft = new THREE.CylinderGeometry(1.6, 1.6, 34, 8);
    const head = new THREE.ConeGeometry(4.4, 11, 10);
    this.gizmoParts = {
      x: new THREE.Group(), y: new THREE.Group(), z: new THREE.Group(),
      ry: new THREE.Mesh(new THREE.TorusGeometry(30, 1.6, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xf5cd2f, depthTest: false, transparent: true, opacity: 0.9 })),
    };
    this.gizmoParts.ry.rotation.x = -Math.PI / 2;
    this.gizmoParts.ry.userData.axis = 'ry';
    for (const [ax, col, rot] of [['x', 0xe0574e, [0, 0, -Math.PI / 2]], ['y', 0x6fdc8c, [0, 0, 0]], ['z', 0x4aa3f0, [Math.PI / 2, 0, 0]]]) {
      const g = this.gizmoParts[ax];
      g.add(mk(col, shaft, null, [0, 17, 0]), mk(col, head, null, [0, 39, 0]));
      g.rotation.set(...rot);
      g.userData.axis = ax;
      g.traverse((o) => { o.userData.axis = ax; });
    }
    this.gizmoParts.ry.traverse((o) => { o.userData.axis = 'ry'; });
    this.gizmo.add(this.gizmoParts.x, this.gizmoParts.y, this.gizmoParts.z, this.gizmoParts.ry);
    this.scene.add(this.gizmo);
  }

  /* ------------------------------------------------------ compass cube -- */
  _buildGizmo() {
    this.navScene = new THREE.Scene();
    this.navCam = new THREE.PerspectiveCamera(38, 1, 1, 400);
    this.navCam.position.set(0, 0, 110);
    const faces = [
      ['right', [1, 0, 0]], ['left', [-1, 0, 0]], ['top', [0, 1, 0]],
      ['bottom', [0, -1, 0]], ['front', [0, 0, 1]], ['back', [0, 0, -1]],
    ];
    this.navFaces = [];
    const body = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40),
      new THREE.MeshStandardMaterial({ color: 0xf5cd2f, roughness: 0.6 }));
    this.navScene.add(body);
    for (let i = 0; i < 4; i++) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 5, 12),
        new THREE.MeshStandardMaterial({ color: 0xf5cd2f, roughness: 0.6 }));
      stud.position.set(i < 2 ? -10 : 10, 22.5, i % 2 ? -10 : 10);
      this.navScene.add(stud);
    }
    for (const [name, dir] of faces) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(name), transparent: true }));
      plate.position.set(dir[0] * 20.6, dir[1] * 20.6, dir[2] * 20.6);
      plate.lookAt(new THREE.Vector3(dir[0] * 100, dir[1] * 100, dir[2] * 100));
      plate.userData.view = name;
      this.navScene.add(plate);
      this.navFaces.push(plate);
    }
    this.navScene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.1));
    this.navSize = 92;
  }
  /** Hit-test the compass in normalised widget coordinates. */
  pickCompass(nx, ny) {
    this._raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.navCam);
    const hits = this._raycaster.intersectObjects(this.navFaces, false);
    return hits.length ? hits[0].object.userData.view : null;
  }

  /* ------------------------------------------------------- style / mats -- */
  applyStyle() {
    const s = this.model.settings;
    const sp = styleSpec(s.renderStyle, s.theme);
    this.styleSpec = sp;
    this.scene.background = new THREE.Color(s.background && s.renderStyle === 'realistic' ? s.background : sp.bg);
    this.lights.ambient.intensity = sp.ambient;
    this.lights.key.intensity = sp.key;
    this.lights.fill.intensity = sp.fill;
    this.renderer.toneMapping = sp.tone ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const q = s.performanceMode ? 'off' : s.shadowQuality;
    const wantShadow = sp.shadows && q !== 'off';
    this.renderer.shadowMap.enabled = wantShadow;
    this.lights.key.castShadow = wantShadow;
    const mapSize = { low: 1024, medium: 2048, high: 4096 }[q] || 2048;
    if (this.lights.key.shadow.mapSize.x !== mapSize) {
      this.lights.key.shadow.mapSize.set(mapSize, mapSize);
      this.lights.key.shadow.map?.dispose();
      this.lights.key.shadow.map = null;
    }
    this.surfaceMat.color.set(sp.table);
    this.deckMat.color.set(sp.table).multiplyScalar(0.7);
    this.gridLines.material.color.set(sp.grid);
    this.surfaceMat.needsUpdate = true;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, s.performanceMode ? 1 : this.pixelRatioCap));
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.rebuildAll();
  }
  material(family) {
    if (this.materials.has(family)) return this.materials.get(family);
    const sp = this.styleSpec;
    const flat = !!sp.flat;
    let m;
    if (family === 'trans') {
      m = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, transparent: true, opacity: 0.52, flatShading: flat, side: THREE.DoubleSide });
    } else if (family === 'metal') {
      m = new THREE.MeshStandardMaterial({ roughness: 0.26, metalness: 0.88, flatShading: flat });
    } else if (family === 'rubber') {
      m = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, flatShading: flat });
    } else if (family === 'glow') {
      m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.42, flatShading: flat });
    } else if (family === 'dark') {
      m = new THREE.MeshStandardMaterial({ color: 0x21262c, roughness: 0.75, flatShading: flat });
    } else if (family === 'light') {
      m = new THREE.MeshStandardMaterial({ color: 0xb9bfbd, roughness: 0.55, flatShading: flat });
    } else if (family === 'glass') {
      m = new THREE.MeshStandardMaterial({ color: 0xd8ecf5, roughness: 0.08, transparent: true, opacity: 0.34, side: THREE.DoubleSide });
    } else {
      m = new THREE.MeshStandardMaterial({ roughness: sp.rough ?? 0.42, metalness: sp.metal ?? 0, flatShading: flat });
    }
    this.materials.set(family, m);
    return m;
  }

  /* --------------------------------------------------- instance buckets -- */
  _visible(b) {
    if (this.filter) return this.filter(b);
    return this.model.isVisible(b);
  }
  _keysFor(b) {
    const gs = partGeometry(b.part);
    if (!gs) return [];
    const col = getColor(b.color);
    const fam = col.type === 'solid' ? 'main' : col.type;
    const out = [];
    for (const g of GROUPS) {
      if (!gs[g]) continue;
      out.push(b.part + '|' + g + '|' + (g === 'main' ? fam : g));
    }
    return out;
  }
  rebuildAll() {
    for (const bk of this.buckets.values()) {
      this.brickRoot.remove(bk.mesh);
      bk.mesh.dispose?.();
    }
    this.buckets.clear(); this.keyOf.clear(); this.dirty.clear();
    for (const b of this.model.bricks.values()) {
      if (!this._visible(b)) continue;
      this._assign(b);
    }
    for (const k of this.buckets.keys()) this.dirty.add(k);
    this.flush();
  }
  _assign(b) {
    const keys = this._keysFor(b);
    this.keyOf.set(b.id, keys);
    for (const k of keys) {
      let bk = this.buckets.get(k);
      if (!bk) {
        const [part, group, fam] = k.split('|');
        bk = { key: k, part, group, fam, ids: [], mesh: null };
        this.buckets.set(k, bk);
      }
      bk.ids.push(b.id);
      this.dirty.add(k);
    }
  }
  _unassign(id) {
    const keys = this.keyOf.get(id);
    if (!keys) return;
    for (const k of keys) {
      const bk = this.buckets.get(k);
      if (!bk) continue;
      const i = bk.ids.indexOf(id);
      if (i >= 0) bk.ids.splice(i, 1);
      this.dirty.add(k);
    }
    this.keyOf.delete(id);
  }
  /** Apply an incremental change for the given brick ids. */
  touchBricks(ids) {
    for (const id of ids) {
      this._unassign(id);
      const b = this.model.bricks.get(id);
      if (b && this._visible(b)) this._assign(b);
    }
    this.flush();
  }
  flush() {
    if (!this.dirty.size) return;
    const mat4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const key of this.dirty) {
      const bk = this.buckets.get(key);
      if (!bk) continue;
      const n = bk.ids.length;
      if (!n) { if (bk.mesh) { this.brickRoot.remove(bk.mesh); bk.mesh.dispose(); bk.mesh = null; } continue; }
      const gs = partGeometry(bk.part);
      const geo = gs?.[bk.group];
      if (!geo) continue;
      if (!bk.mesh || bk.mesh.instanceMatrix.count < n) {
        if (bk.mesh) { this.brickRoot.remove(bk.mesh); bk.mesh.dispose(); }
        const cap = Math.max(8, Math.ceil(n * 1.4));
        bk.mesh = new THREE.InstancedMesh(geo, this.material(bk.fam), cap);
        bk.mesh.castShadow = true; bk.mesh.receiveShadow = true;
        bk.mesh.userData.bucket = bk;
        bk.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.brickRoot.add(bk.mesh);
      }
      const useInstanceColor = bk.group === 'main';
      for (let i = 0; i < n; i++) {
        const b = this.model.bricks.get(bk.ids[i]);
        if (!b) continue;
        const p = getPart(b.part);
        composeMatrix(mat4, p, b);
        bk.mesh.setMatrixAt(i, mat4);
        if (useInstanceColor) {
          bk.mesh.setColorAt(i, col.setStyle(this.displayHex(b)));
        }
      }
      bk.mesh.count = n;
      bk.mesh.instanceMatrix.needsUpdate = true;
      if (bk.mesh.instanceColor) bk.mesh.instanceColor.needsUpdate = true;
      bk.mesh.computeBoundingSphere();
    }
    this.dirty.clear();
    this.updateSelection();
  }
  displayHex(b) {
    const sp = this.styleSpec;
    if (sp.ink) return sp.ink;
    if (sp.cvd) return cvdSubstitute(b.color);
    return getColor(b.color).hex;
  }
  /** brickId for an instanced-mesh raycast hit. */
  brickFromHit(hit) {
    const bk = hit.object.userData.bucket;
    if (!bk) return null;
    return bk.ids[hit.instanceId] || null;
  }

  /* ---------------------------------------------------------- selection -- */
  updateSelection() {
    this.selLines.geometry.dispose();
    this.selLines.geometry = boxEdges(this.model, [...this.model.selection], 0.6);
    this.hoverLines.geometry.dispose();
    this.hoverLines.geometry = this.hover && !this.model.selection.has(this.hover)
      ? boxEdges(this.model, [this.hover], 0.35) : new THREE.BufferGeometry();
    this.updateGizmo();
  }
  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    this.hoverLines.geometry.dispose();
    this.hoverLines.geometry = id && !this.model.selection.has(id)
      ? boxEdges(this.model, [id], 0.35) : new THREE.BufferGeometry();
  }
  updateGizmo() {
    const sel = [...this.model.selection];
    if (!sel.length || !this.showGizmo) { this.gizmo.visible = false; return; }
    const bb = this.model.bounds(new Set(sel));
    if (!bb) { this.gizmo.visible = false; return; }
    this.gizmo.visible = true;
    this.gizmo.position.set((bb.x0 + bb.x1) / 2 * HALF, bb.y1 * PLATE + 6, (bb.z0 + bb.z1) / 2 * HALF);
  }
  pickGizmo(nx, ny) {
    if (!this.gizmo.visible) return null;
    this._raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.rig.camera);
    const hits = this._raycaster.intersectObject(this.gizmo, true);
    return hits.length ? hits[0].object.userData.axis : null;
  }

  /* ----------------------------------------------------------- analysis -- */
  showAnalysis(result) {
    if (!result) {
      this.analysisLines.geometry.dispose();
      this.analysisLines.geometry = new THREE.BufferGeometry();
      this.com.visible = false;
      return;
    }
    const pos = [], colr = [];
    const push = (ids, hex) => {
      const [r, g, b] = hexToRgb(hex);
      const geo = boxEdges(this.model, ids, 1.1);
      const arr = geo.getAttribute('position');
      if (arr) for (let i = 0; i < arr.count; i++) {
        pos.push(arr.getX(i), arr.getY(i), arr.getZ(i));
        colr.push(r, g, b);
      }
      geo.dispose();
    };
    push(result.floating || [], '#ff4d4d');
    push(result.weak || [], '#ffb02e');
    push(result.collisions || [], '#ff2ec4');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    this.analysisLines.geometry.dispose();
    this.analysisLines.geometry = g;
    if (result.com) {
      this.com.visible = true;
      this.com.position.set(result.com.x * HALF, result.com.y * PLATE, result.com.z * HALF);
    } else this.com.visible = false;
  }

  /* -------------------------------------------------------- ray picking -- */
  /** @returns {{brickId, point, normal, object}|null} */
  pick(nx, ny) {
    this._raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.rig.camera);
    const targets = [...this.brickRoot.children];
    if (this.model.settings.showBaseplate) targets.push(this.surface);
    const hits = this._raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      if (h.object === this.surface) {
        const s = this.model.settings;
        if (h.point.x < -1 || h.point.z < -1 || h.point.x > s.baseW * STUD + 1 || h.point.z > s.baseD * STUD + 1) continue;
        return { brickId: null, point: h.point, normal: new THREE.Vector3(0, 1, 0), surface: true };
      }
      const id = this.brickFromHit(h);
      if (!id) continue;
      const b = this.model.bricks.get(id);
      if (!b || !this.model.isVisible(b)) continue;
      const n = h.face ? h.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize() : new THREE.Vector3(0, 1, 0);
      return { brickId: id, point: h.point, normal: n, surface: false };
    }
    // fall back to the ground plane so building works beyond the baseplate
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(plane, hit)) {
      return { brickId: null, point: hit, normal: new THREE.Vector3(0, 1, 0), surface: true, offPlate: true };
    }
    return null;
  }
  /** Bricks whose screen-space centre falls inside a rectangle. */
  pickBox(x0, y0, x1, y1) {
    const cam = this.rig.camera;
    const v = new THREE.Vector3();
    const out = [];
    for (const b of this.model.bricks.values()) {
      if (!this.model.isVisible(b)) continue;
      const bb = this.model.worldBounds(b);
      v.set((bb.x0 + bb.x1) / 2 * HALF, (bb.y0 + bb.y1) / 2 * PLATE, (bb.z0 + bb.z1) / 2 * HALF);
      v.project(cam);
      if (v.x >= Math.min(x0, x1) && v.x <= Math.max(x0, x1) &&
        v.y >= Math.min(y0, y1) && v.y <= Math.max(y0, y1)) out.push(b.id);
    }
    return out;
  }

  /* ------------------------------------------------------------- render -- */
  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }
  fitShadow() {
    const s = this.model.settings;
    const bb = this.model.bounds();
    const cx = s.baseW * STUD / 2, cz = s.baseD * STUD / 2;
    const span = Math.max(s.baseW, s.baseD) * STUD * 0.62 + (bb ? (bb.y1 * PLATE) : 0);
    const cam = this.lights.key.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = span * 6 + 600;
    cam.updateProjectionMatrix();
    this.lights.key.position.set(cx + span * 0.6, span * 1.5 + 200, cz + span * 0.75);
    this.lights.key.target.position.set(cx, 0, cz);
    this.lights.key.target.updateMatrixWorld();
  }
  render() {
    const dt = this._clock.getDelta();
    if (this.model.settings.turntable && !this._interacting) {
      this.rig.theta += dt * 0.28; this.rig.update();
    }
    this.fitShadow();
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    r.render(this.scene, this.rig.camera);
    // compass, drawn over the top-right corner
    const size = this.navSize, pad = 12;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    r.clearDepth();
    r.setScissorTest(true);
    r.setViewport(w - size - pad, h - size - pad, size, size);
    r.setScissor(w - size - pad, h - size - pad, size, size);
    this.navCam.quaternion.copy(this.rig.camera.quaternion);
    this.navCam.position.set(0, 0, 0).translateOnAxis(new THREE.Vector3(0, 0, 1).applyQuaternion(this.navCam.quaternion), 110);
    r.render(this.navScene, this.navCam);
    r.setScissorTest(false);
    this._frames++; this._fpsT += dt;
    if (this._fpsT > 0.5) {
      this.stats.fps = Math.round(this._frames / this._fpsT);
      this.stats.draws = r.info.render.calls;
      this.stats.tris = r.info.render.triangles;
      this._frames = 0; this._fpsT = 0;
      emit('view:stats', this.stats);
    }
  }
  /** Data URL of the current frame. */
  snapshot({ transparent = false, width = 0, height = 0 } = {}) {
    const r = this.renderer;
    const oldSize = new THREE.Vector2(); r.getSize(oldSize);
    const oldBg = this.scene.background;
    if (transparent) this.scene.background = null;
    if (width && height) { r.setSize(width, height, false); this.rig.resize(width, height); }
    r.setScissorTest(false);
    r.setViewport(0, 0, width || oldSize.x, height || oldSize.y);
    r.render(this.scene, this.rig.camera);
    const url = this.canvas.toDataURL('image/png');
    this.scene.background = oldBg;
    if (width && height) { r.setSize(oldSize.x, oldSize.y, false); this.rig.resize(oldSize.x, oldSize.y); }
    return url;
  }
  /** JPEG frame at a given size, used for instruction PDFs. */
  frameJPEG(width, height, quality = 0.86) {
    const r = this.renderer;
    const oldSize = new THREE.Vector2(); r.getSize(oldSize);
    r.setSize(width, height, false); this.rig.resize(width, height);
    r.setScissorTest(false); r.setViewport(0, 0, width, height);
    r.render(this.scene, this.rig.camera);
    const url = this.canvas.toDataURL('image/jpeg', quality);
    r.setSize(oldSize.x, oldSize.y, false); this.rig.resize(oldSize.x, oldSize.y);
    return url;
  }
  dispose() {
    this.renderer.dispose();
    for (const bk of this.buckets.values()) bk.mesh?.dispose();
  }
}

/* --------------------------------------------------------------- helpers -- */
export function composeMatrix(m, p, b) {
  const [ox, oz] = meshOffset(p, b.r);
  const yaw = (b.r & 3) * Math.PI / 2;
  const fine = (b.fine || 0) * DEG;
  m.identity();
  if (fine) {
    const fp = footprint(p, b.r);
    const cx = (b.x + fp.w / 2) * HALF, cz = (b.z + fp.d / 2) * HALF;
    const t1 = new THREE.Matrix4().makeTranslation(cx, 0, cz);
    const rr = new THREE.Matrix4().makeRotationY(fine);
    const t2 = new THREE.Matrix4().makeTranslation(-cx, 0, -cz);
    const local = new THREE.Matrix4()
      .makeTranslation((b.x + ox) * HALF, b.y * PLATE, (b.z + oz) * HALF)
      .multiply(new THREE.Matrix4().makeRotationY(yaw));
    m.copy(t1).multiply(rr).multiply(t2).multiply(local);
  } else {
    m.makeTranslation((b.x + ox) * HALF, b.y * PLATE, (b.z + oz) * HALF);
    m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  }
  return m;
}
export function applyBrickTransform(obj, p, b) {
  const m = composeMatrix(new THREE.Matrix4(), p, b);
  m.decompose(obj.position, obj.quaternion, obj.scale);
}
function boxEdges(model, ids, grow = 0.5) {
  const pos = [];
  for (const id of ids) {
    const b = model.bricks.get(id);
    if (!b) continue;
    const bb = model.worldBounds(b);
    if (!bb) continue;
    const x0 = bb.x0 * HALF - grow, x1 = bb.x1 * HALF + grow;
    const y0 = bb.y0 * PLATE - grow, y1 = bb.y1 * PLATE + grow;
    const z0 = bb.z0 * HALF - grow, z1 = bb.z1 * HALF + grow;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, c] of e) pos.push(...v[a], ...v[c]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
function makeGridTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  const grd = g.createRadialGradient(S / 2, S / 2 - 3, 2, S / 2, S / 2, 17);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.72, 'rgba(190,190,190,0.55)');
  grd.addColorStop(1, 'rgba(120,120,120,0.0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(S / 2, S / 2, 17, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(20,24,29,0.92)';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 64, 66);
  return new THREE.CanvasTexture(c);
}
export { CameraRig };
