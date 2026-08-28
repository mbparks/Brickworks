/* BRICKWORK — brick catalog.
 *
 * Every part is described by data only; geometry.js turns these descriptions
 * into meshes procedurally. Nothing here is derived from proprietary model
 * files. Pieces are LEGO-compatible in dimension only; no branding is used.
 *
 * Coordinate conventions (see core.js):
 *   footprint cells are stud units;
 *   anchors and collision boxes are half-stud (x,z) / plate (y) units;
 *   a part at rotation 0 occupies [0..w*2) x [0..h) x [0..d*2).
 */
import { STUD, PLATE, PLASTIC_DENSITY, round } from './core.js';

export const CATEGORIES = [
  { id: 'bricks', name: 'Bricks', hint: 'Standard three-plate-high bricks' },
  { id: 'plates', name: 'Plates', hint: 'One plate high' },
  { id: 'tiles', name: 'Tiles', hint: 'Smooth top, no studs' },
  { id: 'slopes', name: 'Slopes', hint: 'Angled and inverted slopes' },
  { id: 'round', name: 'Round', hint: 'Cylinders, cones and round plates' },
  { id: 'arches', name: 'Arches', hint: 'Spans and corner bricks' },
  { id: 'technic', name: 'Technic-style', hint: 'Holes, beams, axles and pins' },
  { id: 'wheels', name: 'Wheels', hint: 'Wheels, tyres and holders' },
  { id: 'windows', name: 'Windows & doors', hint: 'Frames, panes and doors' },
  { id: 'clips', name: 'Clips & bars', hint: 'Hinges, clips, bars and holders' },
  { id: 'decor', name: 'Decorative', hint: 'Small detail pieces' },
  { id: 'base', name: 'Baseplates', hint: 'Large flat building surfaces' },
];

const PARTS = [];
const byId = new Map();

/* Solid-volume fraction per geometry kind, used for the mass estimate. */
const SOLIDITY = {
  boxy: 0.48, plate: 0.60, tile: 0.74, slope: 0.52, slopeInv: 0.52, cells: 0.48,
  cyl: 0.52, cone: 0.45, arch: 0.50, technic: 0.46, beam: 0.44, axle: 0.62,
  pin: 0.55, wheel: 0.55, tyre: 0.70, window: 0.42, door: 0.40, hinge: 0.55,
  clip: 0.55, bar: 0.60, dish: 0.35, antenna: 0.40, base: 0.78, panel: 0.40,
};

function rectCells(w, d) {
  const c = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) c.push([x, z]);
  return c;
}

/** Register a part. `def` is sparse; this fills in every derived field. */
function part(def) {
  const p = Object.assign({
    cat: 'bricks', kind: 'boxy', w: 1, d: 1, h: 3,
    studs: 'grid',     // 'grid' | 'none' | explicit [[hx,hz], ...]
    tubes: true,       // can sit on top of studs
    fine: false,       // allows fine (non-90°) rotation
    side: null,        // 'studs' | 'clip' | null — side attachment behaviour
    holes: null,       // technic hole anchors
    color: 'red',
    allow: null,       // null = all colours, else list of colour type ids
    opts: {},
    kw: '',
  }, def);

  p.cells = p.cells || rectCells(p.w, p.d);
  // occupied half-stud footprint boxes (local, rotation 0)
  p.collision = p.collision || p.cells.map(([x, z]) => ({ x: x * 2, y: 0, z: z * 2, w: 2, h: p.h, d: 2 }));
  if (p.studs === 'grid') p.studs = p.cells.map(([x, z]) => [x * 2 + 1, z * 2 + 1]);
  else if (p.studs === 'none') p.studs = [];
  p.hx = p.w * 2; p.hz = p.d * 2;                 // footprint in half studs

  const cellVol = p.cells.length * STUD * STUD * p.h * PLATE;
  p.volume = round(cellVol, 1);
  p.mass = round(cellVol * (SOLIDITY[p.kind] ?? 0.5) * PLASTIC_DENSITY, 3); // grams
  p.sizeKey = p.w <= p.d ? `${p.w}x${p.d}` : `${p.d}x${p.w}`;
  p.search = (p.id + ' ' + p.name + ' ' + p.cat + ' ' + p.sizeKey + ' ' + p.kw).toLowerCase();
  PARTS.push(p); byId.set(p.id, p);
  return p;
}

/* ------------------------------------------------------------- bricks --- */
const BRICK_SIZES = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8]];
for (const [w, d] of BRICK_SIZES) {
  part({
    id: `brick-${w}x${d}`, name: `Brick ${w} × ${d}`, cat: 'bricks',
    w, d, h: 3, kind: 'boxy', color: 'red', kw: 'standard block basic',
  });
}
/* ------------------------------------------------------------- plates --- */
const PLATE_SIZES = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8], [4, 4], [4, 6], [6, 8]];
for (const [w, d] of PLATE_SIZES) {
  part({
    id: `plate-${w}x${d}`, name: `Plate ${w} × ${d}`, cat: 'plates',
    w, d, h: 1, kind: 'plate', color: 'lightgray', kw: 'thin flat',
  });
}
/* -------------------------------------------------------------- tiles --- */
for (const [w, d] of [[1, 1], [1, 2], [1, 4], [1, 6], [2, 2], [2, 4]]) {
  part({
    id: `tile-${w}x${d}`, name: `Tile ${w} × ${d}`, cat: 'tiles',
    w, d, h: 1, kind: 'tile', studs: 'none', color: 'darkgray',
    kw: 'smooth finish top no studs',
  });
}
/* ------------------------------------------------------------- slopes --- */
for (const [w, d, deg] of [[2, 1, 45], [2, 2, 45], [2, 3, 45], [2, 4, 45], [1, 2, 33]]) {
  part({
    id: `slope-${w}x${d}-${deg}`, name: `Slope ${deg}° ${w} × ${d}`, cat: 'slopes',
    w, d, h: 3, kind: 'slope', opts: { deg, run: d },
    studs: (() => { // studs only on the flat top run (last cell row keeps full height)
      const s = [];
      for (let x = 0; x < w; x++) s.push([x * 2 + 1, (d - 1) * 2 + 1]);
      return d > 1 ? s : [];
    })(),
    color: 'blue', kw: 'roof angle ramp wedge',
  });
}
for (const [w, d] of [[2, 1], [2, 2], [2, 3]]) {
  part({
    id: `slopeinv-${w}x${d}`, name: `Inverted slope 45° ${w} × ${d}`, cat: 'slopes',
    w, d, h: 3, kind: 'slopeInv', opts: { deg: 45, run: d },
    color: 'blue', kw: 'underside overhang negative',
  });
}
part({
  id: 'slope-curved-2x2', name: 'Curved slope 2 × 2', cat: 'slopes',
  w: 2, d: 2, h: 3, kind: 'slope', opts: { deg: 45, run: 2, curved: true },
  studs: [[1, 3], [3, 3]], color: 'brightgreen', kw: 'bow round roof',
});
/* -------------------------------------------------------------- round --- */
part({ id: 'round-1x1-brick', name: 'Round brick 1 × 1', cat: 'round', w: 1, d: 1, h: 3, kind: 'cyl', color: 'yellow', kw: 'cylinder column post' });
part({ id: 'round-2x2-brick', name: 'Round brick 2 × 2', cat: 'round', w: 2, d: 2, h: 3, kind: 'cyl', color: 'yellow', kw: 'cylinder drum' });
part({ id: 'round-1x1-plate', name: 'Round plate 1 × 1', cat: 'round', w: 1, d: 1, h: 1, kind: 'cyl', color: 'transred', kw: 'stud dot light' });
part({ id: 'round-2x2-plate', name: 'Round plate 2 × 2', cat: 'round', w: 2, d: 2, h: 1, kind: 'cyl', color: 'white', kw: 'disc circle' });
part({ id: 'cone-1x1', name: 'Cone 1 × 1', cat: 'round', w: 1, d: 1, h: 3, kind: 'cone', opts: { top: 0.55 }, color: 'orange', kw: 'nose taper point' });
part({ id: 'cone-2x2', name: 'Cone 2 × 2', cat: 'round', w: 2, d: 2, h: 3, kind: 'cone', opts: { top: 0.5 }, studs: [[1, 1], [3, 1], [1, 3], [3, 3]], color: 'orange', kw: 'taper roof turret' });
part({ id: 'cyl-2x2-tall', name: 'Cylinder 2 × 2 × 2', cat: 'round', w: 2, d: 2, h: 6, kind: 'cyl', color: 'lightgray', kw: 'tall tube barrel' });
/* ------------------------------------------------- arches and corners --- */
for (const d of [3, 4, 6]) {
  part({
    id: `arch-1x${d}`, name: `Arch 1 × ${d}`, cat: 'arches',
    w: 1, d, h: 3, kind: 'arch', opts: { span: d },
    // legs at each end are full height; the middle is only the top plate
    collision: [
      { x: 0, y: 0, z: 0, w: 2, h: 3, d: 2 },
      { x: 0, y: 0, z: (d - 1) * 2, w: 2, h: 3, d: 2 },
      { x: 0, y: 2, z: 2, w: 2, h: 1, d: (d - 2) * 2 },
    ],
    color: 'tan', kw: 'bridge span opening doorway',
  });
}
part({
  id: 'corner-brick-2x2', name: 'Corner brick 2 × 2', cat: 'arches',
  w: 2, d: 2, h: 3, kind: 'cells', cells: [[0, 0], [1, 0], [0, 1]],
  color: 'green', kw: 'L angle elbow',
});
part({
  id: 'corner-plate-2x2', name: 'Corner plate 2 × 2', cat: 'arches',
  w: 2, d: 2, h: 1, kind: 'cells', cells: [[0, 0], [1, 0], [0, 1]],
  color: 'green', kw: 'L angle elbow flat',
});
part({
  id: 'corner-brick-3x3', name: 'Corner brick 3 × 3', cat: 'arches',
  w: 3, d: 3, h: 3, kind: 'cells',
  cells: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]],
  color: 'green', kw: 'L angle wall corner',
});
/* ------------------------------------------------------------ technic --- */
function technicHoles(len) {  // one hole per stud except the ends of odd runs
  const holes = [];
  for (let i = 0; i < len; i++) holes.push({ axis: 'x', x: 1, y: 1.5, z: i * 2 + 1 });
  return holes;
}
for (const d of [2, 4, 6, 8]) {
  part({
    id: `technic-brick-1x${d}`, name: `Technic brick 1 × ${d}`, cat: 'technic',
    w: 1, d, h: 3, kind: 'technic', opts: { holes: d },
    holes: technicHoles(d), color: 'darkgray', kw: 'hole pin beam functional',
  });
}
for (const d of [3, 5, 7]) {
  part({
    id: `beam-1x${d}`, name: `Beam 1 × ${d}`, cat: 'technic',
    w: 1, d, h: 3, kind: 'beam', opts: { holes: d },
    studs: 'none', tubes: false, holes: technicHoles(d),
    color: 'steel', kw: 'liftarm studless frame',
  });
}
for (const len of [3, 4, 6, 8]) {
  part({
    id: `axle-${len}`, name: `Axle ${len}`, cat: 'technic',
    w: 1, d: len, h: 2, kind: 'axle', opts: { len },
    studs: 'none', tubes: false, fine: true,
    color: 'black', allow: ['solid', 'metal'], kw: 'shaft rod cross drive',
  });
}
part({ id: 'pin-friction', name: 'Connector pin', cat: 'technic', w: 1, d: 1, h: 2, kind: 'pin', opts: { len: 2 }, studs: 'none', tubes: false, fine: true, color: 'black', kw: 'connector joiner peg' });
part({ id: 'pin-long', name: 'Connector pin, long', cat: 'technic', w: 1, d: 2, h: 2, kind: 'pin', opts: { len: 3 }, studs: 'none', tubes: false, fine: true, color: 'blue', kw: 'connector joiner peg long' });
part({ id: 'pin-axle', name: 'Pin with axle end', cat: 'technic', w: 1, d: 2, h: 2, kind: 'pin', opts: { len: 3, axleEnd: true }, studs: 'none', tubes: false, fine: true, color: 'brown', kw: 'connector half axle' });
/* ------------------------------------------------------------- wheels --- */
part({ id: 'wheel-small', name: 'Wheel, small (with tyre)', cat: 'wheels', w: 2, d: 2, h: 4, kind: 'wheel', opts: { r: 6.4, width: 8 }, studs: 'none', tubes: false, fine: true, color: 'rubberblack', kw: 'tyre tire roll vehicle car' });
part({ id: 'wheel-large', name: 'Wheel, large (with tyre)', cat: 'wheels', w: 3, d: 3, h: 7, kind: 'wheel', opts: { r: 11.2, width: 12 }, studs: 'none', tubes: false, fine: true, color: 'rubberblack', kw: 'tyre tire roll vehicle truck' });
part({ id: 'wheel-holder-2x2', name: 'Wheel holder plate 2 × 2', cat: 'wheels', w: 2, d: 2, h: 2, kind: 'boxy', color: 'darkgray', kw: 'axle plate mount car base' });
/* --------------------------------------------------- windows and doors -- */
part({
  id: 'window-1x2x2', name: 'Window frame 1 × 2 × 2', cat: 'windows',
  w: 1, d: 2, h: 6, kind: 'window', opts: { pane: true },
  color: 'white', kw: 'glass opening frame house',
});
part({
  id: 'window-1x4x3', name: 'Window frame 1 × 4 × 3', cat: 'windows',
  w: 1, d: 4, h: 9, kind: 'window', opts: { pane: true },
  color: 'white', kw: 'glass opening frame wide house',
});
part({
  id: 'door-1x4x6', name: 'Door frame 1 × 4 × 6', cat: 'windows',
  w: 1, d: 4, h: 18, kind: 'door', opts: {},
  color: 'brown', kw: 'entrance opening house doorway',
});
part({
  id: 'pane-1x2x2', name: 'Glass pane 1 × 2 × 2', cat: 'windows',
  w: 1, d: 2, h: 6, kind: 'panel', opts: { thin: true },
  color: 'transclear', kw: 'window glazing transparent flat',
});
/* ------------------------------------------------------ clips and bars -- */
part({ id: 'hinge-plate-1x2', name: 'Hinge plate 1 × 2', cat: 'clips', w: 1, d: 2, h: 1, kind: 'hinge', fine: true, color: 'lightgray', kw: 'pivot rotate joint swivel' });
part({ id: 'hinge-brick-1x2', name: 'Hinge brick 1 × 2', cat: 'clips', w: 1, d: 2, h: 3, kind: 'hinge', opts: { tall: true }, fine: true, color: 'lightgray', kw: 'pivot rotate joint swivel' });
part({ id: 'clip-plate-1x1', name: 'Plate 1 × 1 with clip', cat: 'clips', w: 1, d: 1, h: 2, kind: 'clip', side: 'clip', color: 'lightgray', kw: 'grip hold bar attach' });
part({ id: 'clip-plate-1x2', name: 'Plate 1 × 2 with clip', cat: 'clips', w: 1, d: 2, h: 2, kind: 'clip', side: 'clip', color: 'lightgray', kw: 'grip hold bar attach' });
part({ id: 'bar-1x4', name: 'Bar 4 long', cat: 'clips', w: 1, d: 4, h: 1, kind: 'bar', studs: 'none', tubes: false, fine: true, color: 'silver', kw: 'rod pole handle rail' });
part({ id: 'bar-holder-1x1', name: 'Plate 1 × 1 with bar holder', cat: 'clips', w: 1, d: 1, h: 3, kind: 'clip', opts: { holder: true }, side: 'clip', color: 'lightgray', kw: 'ring loop hold bar' });
part({ id: 'bracket-1x2', name: 'Bracket 1 × 2 with side studs', cat: 'clips', w: 1, d: 2, h: 2, kind: 'boxy', side: 'studs', color: 'lightgray', kw: 'sideways sns headlight mount' });
/* --------------------------------------------------------- decorative -- */
part({ id: 'antenna-1x1', name: 'Antenna 1 × 1', cat: 'decor', w: 1, d: 1, h: 4, kind: 'antenna', studs: 'none', color: 'black', kw: 'aerial mast spike' });
part({ id: 'dish-2x2', name: 'Dish 2 × 2', cat: 'decor', w: 2, d: 2, h: 1, kind: 'dish', studs: 'none', color: 'silver', kw: 'radar satellite bowl' });
part({ id: 'panel-1x2x2', name: 'Panel 1 × 2 × 2', cat: 'decor', w: 1, d: 2, h: 6, kind: 'panel', color: 'white', kw: 'wall thin side fence' });
part({ id: 'plate-1x2-rail', name: 'Plate 1 × 2 with rail', cat: 'decor', w: 1, d: 2, h: 2, kind: 'panel', opts: { rail: true }, color: 'white', kw: 'fence rail balcony ledge' });
part({ id: 'plant-stem', name: 'Plant stem', cat: 'decor', w: 1, d: 1, h: 3, kind: 'antenna', opts: { leaves: true }, studs: 'none', color: 'brightgreen', kw: 'flower tree leaf garden' });
/* -------------------------------------------------------- baseplates --- */
part({ id: 'baseplate-16x16', name: 'Baseplate 16 × 16', cat: 'base', w: 16, d: 16, h: 1, kind: 'base', tubes: false, color: 'green', kw: 'ground floor field large' });
part({ id: 'baseplate-32x32', name: 'Baseplate 32 × 32', cat: 'base', w: 32, d: 32, h: 1, kind: 'base', tubes: false, color: 'green', kw: 'ground floor field huge' });
part({ id: 'baseplate-8x16', name: 'Baseplate 8 × 16', cat: 'base', w: 8, d: 16, h: 1, kind: 'base', tubes: false, color: 'darkgray', kw: 'road ground strip' });

/* ------------------------------------------------------------- lookup --- */
export const ALL_PARTS = PARTS;
export function getPart(id) { return byId.get(id) || null; }
export function hasPart(id) { return byId.has(id); }
export function partsIn(cat) { return PARTS.filter((p) => p.cat === cat); }

/** Parts offered in Easy Mode — a friendly, forgiving subset. */
export const EASY_PART_IDS = new Set([
  'brick-1x1', 'brick-1x2', 'brick-1x4', 'brick-1x6', 'brick-2x2', 'brick-2x3', 'brick-2x4', 'brick-2x6',
  'plate-1x2', 'plate-1x4', 'plate-2x2', 'plate-2x4', 'plate-2x6', 'plate-4x4', 'plate-4x6',
  'tile-1x2', 'tile-2x2', 'tile-1x4',
  'slope-2x2-45', 'slope-2x1-45', 'slope-curved-2x2', 'slopeinv-2x2',
  'round-1x1-brick', 'round-2x2-brick', 'round-1x1-plate', 'cone-1x1',
  'arch-1x4', 'corner-brick-2x2',
  'wheel-small', 'wheel-holder-2x2',
  'window-1x2x2', 'door-1x4x6',
  'dish-2x2', 'plant-stem', 'antenna-1x1',
  'baseplate-16x16',
]);

/** Same footprint & height — used by "Replace with compatible size". */
export function compatibleSizes(partId) {
  const p = getPart(partId);
  if (!p) return [];
  return PARTS.filter((q) => q.id !== p.id && q.cat === p.cat && q.h === p.h)
    .sort((a, b) => (a.w * a.d) - (b.w * b.d));
}

/** True if this part can hold another brick above it. */
export function hasTopStuds(p) { return p.studs.length > 0; }
