/* BRICKWORK — procedural geometry.
 *
 * Every piece is generated from its data description in parts.js. No model
 * files are loaded or distributed. Geometry is authored in millimetres with
 * the local origin at the minimum corner of the footprint, so a part occupies
 *   x: 0 .. w*STUD    y: 0 .. h*PLATE    z: 0 .. d*STUD
 * plus studs standing above the top face.
 *
 * A part builds into up to four *groups*, each of which becomes its own
 * instanced mesh at render time:
 *   main  — takes the brick's colour
 *   dark  — fixed dark detail (hole recesses, axle bores)
 *   light — fixed light detail (wheel hubs, hinge knuckles)
 *   glass — fixed transparent detail (window panes)
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { STUD, PLATE, STUD_R, STUD_H, BEVEL } from './core.js';
import { getPart } from './parts.js';

export const GROUPS = ['main', 'dark', 'light', 'glass'];

/* ------------------------------------------------------------- builder --- */
class Mesh3 {
  constructor() { this.p = []; this.n = []; }
  get empty() { return this.p.length === 0; }
  vert(x, y, z, nx, ny, nz) { this.p.push(x, y, z); this.n.push(nx, ny, nz); }
  tri(a, b, c, na, nb, nc) {
    this.vert(a[0], a[1], a[2], na[0], na[1], na[2]);
    this.vert(b[0], b[1], b[2], nb[0], nb[1], nb[2]);
    this.vert(c[0], c[1], c[2], nc[0], nc[1], nc[2]);
  }
  /** Quad with an automatically outward-facing normal, away from `ref`. */
  quadO(a, b, c, d, ref) {
    let n = normal(a, b, c);
    const cx = (a[0] + b[0] + c[0] + d[0]) / 4 - ref[0];
    const cy = (a[1] + b[1] + c[1] + d[1]) / 4 - ref[1];
    const cz = (a[2] + b[2] + c[2] + d[2]) / 4 - ref[2];
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) { [b, d] = [d, b]; n = normal(a, b, c); }
    this.tri(a, b, c, n, n, n); this.tri(a, c, d, n, n, n);
  }
  triO(a, b, c, ref) {
    let n = normal(a, b, c);
    const cx = (a[0] + b[0] + c[0]) / 3 - ref[0], cy = (a[1] + b[1] + c[1]) / 3 - ref[1], cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) { [b, c] = [c, b]; n = normal(a, b, c); }
    this.tri(a, b, c, n, n, n);
  }
  /** Quad with supplied per-vertex normals (for smooth curved surfaces). */
  quadN(a, b, c, d, na, nb, nc, nd) { this.tri(a, b, c, na, nb, nc); this.tri(a, c, d, na, nc, nd); }

  /** Chamfered box spanning [x,x+w] × [y,y+h] × [z,z+d]. */
  box(x, y, z, w, h, d, bev = BEVEL) {
    const b = Math.min(bev, w / 2.5, h / 2.5, d / 2.5);
    const cx = x + w / 2, cy = y + h / 2, cz = z + d / 2;
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const ref = [cx, cy, cz];
    const P = (ax, sx, sy, sz) => {
      const ex = ax === 0 ? hx : hx - b, ey = ax === 1 ? hy : hy - b, ez = ax === 2 ? hz : hz - b;
      return [cx + sx * ex, cy + sy * ey, cz + sz * ez];
    };
    for (const s of [-1, 1]) {
      this.quadO(P(0, s, -1, -1), P(0, s, -1, 1), P(0, s, 1, 1), P(0, s, 1, -1), ref);
      this.quadO(P(1, -1, s, -1), P(1, -1, s, 1), P(1, 1, s, 1), P(1, 1, s, -1), ref);
      this.quadO(P(2, -1, -1, s), P(2, -1, 1, s), P(2, 1, 1, s), P(2, 1, -1, s), ref);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1])
      this.quadO(P(0, sx, sy, -1), P(1, sx, sy, -1), P(1, sx, sy, 1), P(0, sx, sy, 1), ref);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      this.quadO(P(0, sx, -1, sz), P(2, sx, -1, sz), P(2, sx, 1, sz), P(0, sx, 1, sz), ref);
    for (const sy of [-1, 1]) for (const sz of [-1, 1])
      this.quadO(P(1, -1, sy, sz), P(2, -1, sy, sz), P(2, 1, sy, sz), P(1, 1, sy, sz), ref);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      this.triO(P(0, sx, sy, sz), P(1, sx, sy, sz), P(2, sx, sy, sz), ref);
  }

  /** Cylinder / truncated cone along `axis` (0=x, 1=y, 2=z), smooth sides. */
  tube(cx, cy, cz, r0, r1, len, axis = 1, seg = 14, capA = true, capB = true) {
    const half = len / 2;
    const at = (r, t, off) => {
      const c = Math.cos(t) * r, s = Math.sin(t) * r;
      if (axis === 1) return [cx + c, cy + off, cz + s];
      if (axis === 0) return [cx + off, cy + c, cz + s];
      return [cx + c, cy + s, cz + off];
    };
    const nrm = (t, slope) => {
      const c = Math.cos(t), s = Math.sin(t);
      const l = Math.hypot(1, slope);
      if (axis === 1) return [c / l, slope / l, s / l];
      if (axis === 0) return [slope / l, c / l, s / l];
      return [c / l, s / l, slope / l];
    };
    const slope = (r0 - r1) / len;
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      const a = at(r0, t0, -half), b = at(r0, t1, -half), c = at(r1, t1, half), d = at(r1, t0, half);
      this.quadN(a, d, c, b, nrm(t0, slope), nrm(t0, slope), nrm(t1, slope), nrm(t1, slope));
    }
    const axN = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
    const neg = axN.map((v) => -v);
    if (capB && r1 > 0.001) {
      const c = at(0, 0, half);
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        this.tri(c, at(r1, t0, half), at(r1, t1, half), axN, axN, axN);
      }
    }
    if (capA && r0 > 0.001) {
      const c = at(0, 0, -half);
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        this.tri(c, at(r0, t1, -half), at(r0, t0, -half), neg, neg, neg);
      }
    }
  }

  /** Flat annulus facing +/- along `axis`. */
  ring(cx, cy, cz, rIn, rOut, axis, dir, seg = 14) {
    const at = (r, t) => {
      const c = Math.cos(t) * r, s = Math.sin(t) * r;
      if (axis === 1) return [cx + c, cy, cz + s];
      if (axis === 0) return [cx, cy + c, cz + s];
      return [cx + c, cy + s, cz];
    };
    const n = axis === 0 ? [dir, 0, 0] : axis === 1 ? [0, dir, 0] : [0, 0, dir];
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      const a = at(rIn, t0), b = at(rOut, t0), c = at(rOut, t1), d = at(rIn, t1);
      if (dir > 0) this.quadN(a, b, c, d, n, n, n, n); else this.quadN(a, d, c, b, n, n, n, n);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/* -------------------------------------------------------- part builders -- */
function addStuds(m, p, seg = 12) {
  const top = p.h * PLATE;
  for (const [hx, hz] of p.studs) {
    m.tube(hx * (STUD / 2), top + STUD_H / 2, hz * (STUD / 2), STUD_R, STUD_R * 0.95, STUD_H, 1, seg, false, true);
  }
}
function rowRuns(cells) {           // merge occupancy cells into z-runs per x
  const byX = new Map();
  for (const [x, z] of cells) { if (!byX.has(x)) byX.set(x, []); byX.get(x).push(z); }
  const runs = [];
  for (const [x, zs] of byX) {
    zs.sort((a, b) => a - b);
    let s = zs[0], prev = zs[0];
    for (let i = 1; i <= zs.length; i++) {
      if (i < zs.length && zs[i] === prev + 1) { prev = zs[i]; continue; }
      runs.push([x, s, prev - s + 1]);
      if (i < zs.length) { s = zs[i]; prev = zs[i]; }
    }
  }
  return runs;
}

const BUILDERS = {
  boxy(m, p) {
    for (const [x, z, len] of rowRuns(p.cells)) m.main.box(x * STUD, 0, z * STUD, STUD, p.h * PLATE, len * STUD);
    addStuds(m.main, p);
  },
  cells(m, p) { BUILDERS.boxy(m, p); },
  plate(m, p) { BUILDERS.boxy(m, p); },
  tile(m, p) {
    for (const [x, z, len] of rowRuns(p.cells)) m.main.box(x * STUD, 0, z * STUD, STUD, p.h * PLATE, len * STUD, 0.6);
  },
  base(m, p) {
    m.main.box(0, 0, 0, p.w * STUD, p.h * PLATE, p.d * STUD, 0.5);
    addStuds(m.main, p, p.cells.length > 200 ? 6 : 10);
  },
  slope(m, p) {
    const H = p.h * PLATE, W = p.w * STUD, D = p.d * STUD, run = (p.d - 1) * STUD;
    const lip = PLATE * 0.9;
    if (p.d > 1) { m.main.box(0, 0, run, W, H, D - run); addStuds(m.main, p); }
    // sloping wedge from (z=0, y=lip) up to (z=run, y=H)
    const steps = p.opts.curved ? 8 : 1;
    let prevZ = 0, prevY = lip;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const z = t * run;
      const y = p.opts.curved ? lip + (H - lip) * Math.sin(t * Math.PI / 2) : lip + (H - lip) * t;
      const ref = [W / 2, 0, run / 2];
      m.main.quadO([0, prevY, prevZ], [W, prevY, prevZ], [W, y, z], [0, y, z], [W / 2, -50, run / 2]);
      m.main.triO([0, 0, prevZ], [0, prevY, prevZ], [0, y, z], [W + 5, 0, 0]);
      m.main.triO([0, 0, prevZ], [0, y, z], [0, 0, z], [W + 5, 0, 0]);
      m.main.triO([W, 0, prevZ], [W, prevY, prevZ], [W, y, z], [-5, 0, 0]);
      m.main.triO([W, 0, prevZ], [W, y, z], [W, 0, z], [-5, 0, 0]);
      m.main.quadO([0, 0, prevZ], [W, 0, prevZ], [W, 0, z], [0, 0, z], ref);
      prevZ = z; prevY = y;
    }
    m.main.quadO([0, 0, 0], [W, 0, 0], [W, lip, 0], [0, lip, 0], [W / 2, H / 2, D / 2]);
    if (p.d === 1) m.main.quadO([0, 0, D], [W, 0, D], [W, H, D], [0, H, D], [W / 2, H / 2, 0]);
  },
  slopeInv(m, p) {
    const H = p.h * PLATE, W = p.w * STUD, D = p.d * STUD;
    const lip = PLATE;
    const ref = [W / 2, H / 2, D / 2];
    m.main.box(0, H - PLATE, 0, W, PLATE, D, 0.4);   // top plate with studs
    addStuds(m.main, p);
    // wedge underneath: full height at z=D, thin at z=0
    m.main.quadO([0, lip, 0], [W, lip, 0], [W, H - PLATE, D], [0, H - PLATE, D], [W / 2, H + 40, D / 2]);
    m.main.triO([0, lip, 0], [0, H - PLATE, 0], [0, H - PLATE, D], [W + 5, 0, 0]);
    m.main.triO([W, lip, 0], [W, H - PLATE, 0], [W, H - PLATE, D], [-5, 0, 0]);
    m.main.quadO([0, lip, 0], [W, lip, 0], [W, H - PLATE, 0], [0, H - PLATE, 0], ref);
    m.main.box(0, 0, D - STUD * 0.55, W, lip, STUD * 0.55, 0.3);
  },
  cyl(m, p) {
    const H = p.h * PLATE, r = p.w * STUD / 2 - 0.3;
    m.main.tube(p.w * STUD / 2, H / 2, p.d * STUD / 2, r, r, H, 1, p.w > 1 ? 20 : 14);
    addStuds(m.main, p);
  },
  cone(m, p) {
    const H = p.h * PLATE, r = p.w * STUD / 2 - 0.3, top = r * (p.opts.top ?? 0.5);
    m.main.tube(p.w * STUD / 2, H / 2, p.d * STUD / 2, r, top, H, 1, p.w > 1 ? 20 : 14);
    if (p.w === 1) m.main.tube(p.w * STUD / 2, H + STUD_H / 2, p.d * STUD / 2, STUD_R * 0.75, STUD_R * 0.7, STUD_H, 1, 12, false, true);
    else addStuds(m.main, p);
  },
  arch(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD;
    m.main.box(0, H - PLATE, 0, W, PLATE, D);                   // top slab
    m.main.box(0, 0, 0, W, H - PLATE, STUD);                    // legs
    m.main.box(0, 0, D - STUD, W, H - PLATE, STUD);
    // curved soffit
    const seg = 10, r = (D - 2 * STUD) / 2, y0 = H - PLATE, cz = D / 2;
    const depth = Math.min(y0 - 0.5, r * 0.55);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI, t1 = ((i + 1) / seg) * Math.PI;
      const a = [0, y0 - Math.sin(t0) * depth, cz - Math.cos(t0) * r];
      const b = [W, a[1], a[2]];
      const c = [W, y0 - Math.sin(t1) * depth, cz - Math.cos(t1) * r];
      const d = [0, c[1], c[2]];
      m.main.quadO(a, b, c, d, [W / 2, y0 + 30, cz]);
    }
    addStuds(m.main, p);
  },
  technic(m, p) {
    BUILDERS.boxy(m, p);
    const y = 1.5 * PLATE;
    for (const h of p.holes || []) {
      const z = h.z * (STUD / 2);
      m.dark.tube(STUD / 2, y, z, 2.45, 2.45, STUD - 0.6, 0, 12, false, false);
      m.dark.ring(0.3, y, z, 0, 2.45, 0, -1, 12);
      m.dark.ring(STUD - 0.3, y, z, 0, 2.45, 0, 1, 12);
    }
  },
  beam(m, p) {
    const th = 7.4, y0 = (p.h * PLATE - th) / 2, r = 3.8;
    const z0 = STUD / 2, z1 = (p.d - 0.5) * STUD;
    m.main.box(0.3, y0, z0, STUD - 0.6, th, z1 - z0);
    m.main.tube(STUD / 2, y0 + th / 2, z0, r, r, th, 1, 16);
    m.main.tube(STUD / 2, y0 + th / 2, z1, r, r, th, 1, 16);
    for (const h of p.holes || []) {
      const z = h.z * (STUD / 2);
      m.dark.tube(STUD / 2, y0 + th / 2, z, 2.45, 2.45, th + 0.4, 0, 12, false, false);
      m.dark.ring(0.1, y0 + th / 2, z, 0, 2.45, 0, -1, 12);
      m.dark.ring(STUD - 0.1, y0 + th / 2, z, 0, 2.45, 0, 1, 12);
    }
  },
  axle(m, p) {
    const L = p.opts.len * STUD - 0.6, y = p.h * PLATE / 2, cx = STUD / 2, cz = L / 2 + 0.3;
    m.main.box(cx - 2.4, y - 0.95, cz - L / 2, 4.8, 1.9, L, 0.2);
    m.main.box(cx - 0.95, y - 2.4, cz - L / 2, 1.9, 4.8, L, 0.2);
  },
  pin(m, p) {
    const L = p.opts.len * 4, cx = STUD / 2, y = p.h * PLATE / 2, cz = L / 2;
    m.main.tube(cx, y, cz, 2.35, 2.35, L, 2, 14);
    m.main.tube(cx, y, cz, 3.2, 3.2, 1.6, 2, 14);
    if (p.opts.axleEnd) {
      m.main.box(cx - 2.4, y - 0.95, cz + L / 2, 4.8, 1.9, 4, 0.2);
      m.main.box(cx - 0.95, y - 2.4, cz + L / 2, 1.9, 4.8, 4, 0.2);
    } else { m.main.tube(cx, y, L - 1, 2.8, 2.4, 1.4, 2, 14); }
  },
  wheel(m, p) {
    const R = p.opts.r, wd = p.opts.width;
    const cx = p.w * STUD / 2, cz = p.d * STUD / 2, cy = R;
    m.main.tube(cx, cy, cz, R, R, wd, 0, 22, false, false);       // tyre tread
    m.main.ring(cx - wd / 2, cy, cz, R * 0.62, R, 0, -1, 22);
    m.main.ring(cx + wd / 2, cy, cz, R * 0.62, R, 0, 1, 22);
    m.light.tube(cx, cy, cz, R * 0.62, R * 0.62, wd * 0.8, 0, 18);  // hub
    m.dark.tube(cx, cy, cz, 2.5, 2.5, wd * 0.85, 0, 12, false, false);
    m.dark.ring(cx - wd * 0.42, cy, cz, 0, 2.5, 0, -1, 12);
    m.dark.ring(cx + wd * 0.42, cy, cz, 0, 2.5, 0, 1, 12);
  },
  window(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD, f = 3.2;
    m.main.box(0, 0, 0, W, H, f);                       // side frames
    m.main.box(0, 0, D - f, W, H, f);
    m.main.box(0, H - PLATE, 0, W, PLATE, D);           // head
    m.main.box(0, 0, 0, W, PLATE, D);                   // sill
    addStuds(m.main, p);
    if (p.opts.pane) m.glass.box(W / 2 - 0.8, PLATE, f, 1.6, H - 2 * PLATE, D - 2 * f, 0.2);
  },
  door(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD, f = 3.2;
    m.main.box(0, 0, 0, W, H, f);
    m.main.box(0, 0, D - f, W, H, f);
    m.main.box(0, H - PLATE, 0, W, PLATE, D);
    m.main.box(0, 0, 0, W, PLATE, D);
    addStuds(m.main, p);
    m.light.box(W / 2 - 1.4, PLATE, f + 0.4, 2.8, H - 2 * PLATE - 0.4, D - 2 * f - 0.8, 0.3);
    m.dark.tube(W / 2 - 2.4, H * 0.45, D - f - 3, 1.1, 1.1, 2.4, 0, 8);
  },
  panel(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD, th = p.opts.thin ? 1.6 : 3.2;
    m.main.box((W - th) / 2, 0, 0, th, H, D, 0.3);
    if (!p.opts.thin) { m.main.box(0, 0, 0, W, PLATE, D); addStuds(m.main, p); }
    if (p.opts.rail) m.main.tube(W / 2, H, D / 2, 1.4, 1.4, D, 2, 10);
  },
  hinge(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD;
    m.main.box(0, 0, 0, W, H, D - STUD * 0.45);
    addStuds(m.main, p);
    m.light.tube(W / 2, H - PLATE / 2, D - STUD * 0.28, 2.6, 2.6, W - 0.6, 0, 14);
  },
  clip(m, p) {
    const H = p.h * PLATE, W = STUD, D = p.d * STUD;
    m.main.box(0, 0, 0, W, PLATE, D);
    for (const [hx, hz] of p.studs) {
      m.main.tube(hx * (STUD / 2), PLATE + STUD_H / 2, hz * (STUD / 2), STUD_R, STUD_R * 0.95, STUD_H, 1, 12, false, true);
    }
    if (p.opts.holder) {
      const cy = H - 2.3;
      m.main.box(W / 2 - 0.8, PLATE, D - 2, 1.6, Math.max(0.6, cy - PLATE), 1.6, 0.2);
      m.main.tube(W / 2, cy, D - 1.2, 2.2, 2.2, 1.6, 2, 12, false, false);
      m.main.ring(W / 2, cy, D - 2.0, 1.3, 2.2, 2, -1, 12);
      m.main.ring(W / 2, cy, D - 0.4, 1.3, 2.2, 2, 1, 12);
    } else {
      m.main.box(0.6, PLATE, D - 2.6, 1.6, H - PLATE, 2.6, 0.3);
      m.main.box(W - 2.2, PLATE, D - 2.6, 1.6, H - PLATE, 2.6, 0.3);
    }
  },
  bar(m, p) {
    const D = p.d * STUD;
    m.main.tube(STUD / 2, p.h * PLATE / 2, D / 2, 1.6, 1.6, D - 0.8, 2, 10);
  },
  dish(m, p) {
    const R = p.w * STUD / 2 - 0.4, H = p.h * PLATE;
    m.main.tube(p.w * STUD / 2, H / 2, p.d * STUD / 2, R * 0.45, R, H, 1, 20, true, false);
    m.main.ring(p.w * STUD / 2, H, p.d * STUD / 2, R * 0.55, R, 1, 1, 20);
  },
  antenna(m, p) {
    const H = p.h * PLATE;
    m.main.box(0, 0, 0, STUD, PLATE, STUD, 0.3);
    if (p.opts.leaves) {
      m.main.tube(STUD / 2, H / 2, STUD / 2, 1.2, 1.0, H - PLATE, 1, 8);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const x = STUD / 2 + Math.cos(a) * 2.6, z = STUD / 2 + Math.sin(a) * 2.6;
        m.main.box(x - 1.7, H - 1.2, z - 1.7, 3.4, 0.9, 3.4, 0.3);
      }
    } else {
      m.main.tube(STUD / 2, PLATE + (H - PLATE) / 2, STUD / 2, 1.5, 0.9, H - PLATE, 1, 10);
    }
  },
};

/* ------------------------------------------------------------- caching --- */
const cache = new Map();

/** Returns `{ main, dark, light, glass }` — missing groups are null. */
export function partGeometry(partId) {
  if (cache.has(partId)) return cache.get(partId);
  const p = getPart(partId);
  if (!p) return null;
  const m = { main: new Mesh3(), dark: new Mesh3(), light: new Mesh3(), glass: new Mesh3() };
  (BUILDERS[p.kind] || BUILDERS.boxy)(m, p);
  const out = {};
  for (const g of GROUPS) out[g] = m[g].empty ? null : m[g].geometry();
  out.part = p;
  cache.set(partId, out);
  return out;
}

/** One merged geometry for the placement ghost and for OBJ/STL export. */
const mergedCache = new Map();
export function mergedGeometry(partId) {
  if (mergedCache.has(partId)) return mergedCache.get(partId);
  const gs = partGeometry(partId);
  if (!gs) return null;
  let n = 0;
  for (const g of GROUPS) if (gs[g]) n += gs[g].getAttribute('position').array.length;
  const pos = new Float32Array(n), nor = new Float32Array(n);
  let o = 0;
  for (const g of GROUPS) {
    if (!gs[g]) continue;
    const a = gs[g].getAttribute('position').array, b = gs[g].getAttribute('normal').array;
    pos.set(a, o); nor.set(b, o); o += a.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  mergedCache.set(partId, geo);
  return geo;
}

export function triangleCount(partId) {
  const gs = partGeometry(partId);
  let n = 0;
  for (const g of GROUPS) if (gs[g]) n += gs[g].getAttribute('position').count / 3;
  return n;
}
export function disposeGeometryCache() {
  for (const gs of cache.values()) for (const g of GROUPS) gs[g]?.dispose();
  for (const g of mergedCache.values()) g.dispose();
  cache.clear(); mergedCache.clear();
}
