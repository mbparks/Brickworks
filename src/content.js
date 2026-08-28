/* BRICKWORK — starter content.
 *
 * Example builds are generated procedurally so they always load cleanly and
 * never ship as opaque data blobs. Every example is placed on the building
 * surface with no overlaps.
 */
import { SCHEMA_VERSION, VERSION, uid } from './core.js';

const B = (part, color, x, y, z, r = 0) => ({ part, color, x, y, z, r });

/* ------------------------------------------------------------ examples -- */
function blank() { return { bricks: [], baseW: 32, baseD: 32 }; }

function house() {
  const out = [];
  const W = 8, D = 6;                 // studs
  const OX = 12, OZ = 12;             // near the middle of the plate
  const wall = 'tan', trim = 'white', roof = 'darkred';
  const doorX = 2, doorW = 4;         // doorway in the front wall
  const winZ = 2;                     // window in the left wall

  const free = (x, z, course) => {
    if (z === 0 && x >= doorX && x < doorX + doorW) return false;
    if (x === 0 && z >= winZ && z < winZ + 2 && course >= 1 && course <= 2) return false;
    return true;
  };
  for (let c = 0; c < 6; c++) {
    const y = c * 3;
    for (const z of [0, D - 1]) {
      for (let x = 0; x < W; x += 2) {
        if (!free(x, z, c) || !free(x + 1, z, c)) continue;
        out.push(B('brick-1x2', wall, (OX + x) * 2, y, (OZ + z) * 2, 1));
      }
    }
    for (const x of [0, W - 1]) {
      for (let z = 1; z < D - 1; z += 2) {
        if (!free(x, z, c) || !free(x, z + 1, c)) continue;
        out.push(B('brick-1x2', wall, (OX + x) * 2, y, (OZ + z) * 2, 0));
      }
    }
  }
  out.push(B('door-1x4x6', 'brown', (OX + doorX) * 2, 0, OZ * 2, 1));
  out.push(B('window-1x2x2', trim, OX * 2, 3, (OZ + winZ) * 2, 0));
  // floor inside the walls
  for (let x = 1; x < W - 1; x += 2) out.push(B('plate-2x4', 'lightgray', (OX + x) * 2, 0, (OZ + 1) * 2, 0));
  // roof deck: 8 x 2 plates laid across the walls, tying every column together
  for (let z = 0; z < D; z += 2) out.push(B('plate-2x8', trim, OX * 2, 18, (OZ + z) * 2, 1));
  // eaves and ridge
  for (let x = 0; x < W; x += 2) {
    out.push(B('slope-2x2-45', roof, (OX + x) * 2, 19, OZ * 2, 0));
    out.push(B('slope-2x2-45', roof, (OX + x) * 2, 19, (OZ + 4) * 2, 2));
    out.push(B('brick-2x2', roof, (OX + x) * 2, 19, (OZ + 2) * 2, 0));
    if (x !== 6) out.push(B('tile-2x2', roof, (OX + x) * 2, 22, (OZ + 2) * 2, 0));
  }
  out.push(B('round-2x2-brick', 'darkgray', (OX + 6) * 2, 22, (OZ + 2) * 2, 0));
  // garden and a path leading away from the door
  out.push(B('plant-stem', 'brightgreen', (OX - 2) * 2, 0, (OZ + 1) * 2, 0));
  out.push(B('plant-stem', 'brightgreen', (OX + 9) * 2, 0, (OZ + 4) * 2, 0));
  out.push(B('tile-1x4', 'lightgray', (OX + 3) * 2, 0, (OZ - 4) * 2, 0));
  out.push(B('tile-1x4', 'lightgray', (OX + 4) * 2, 0, (OZ - 4) * 2, 0));
  return { bricks: out, baseW: 32, baseD: 32 };
}

function vehicle() {
  const out = [];
  const OX = 14, OZ = 12;
  const body = 'red';
  const X = (s) => (OX + s) * 2, Z = (s) => (OZ + s) * 2;
  // chassis, wheels and holders
  out.push(B('plate-2x6', 'darkgray', X(0), 3, Z(0), 0));
  for (const z of [0, 4]) {
    out.push(B('wheel-small', 'rubberblack', X(-2), 0, Z(z), 0));
    out.push(B('wheel-small', 'rubberblack', X(2), 0, Z(z), 0));
    out.push(B('wheel-holder-2x2', 'darkgray', X(0), 1, Z(z), 0));
  }
  // deck: cabin floor over studs 0-4, bonnet slope over studs 4-6
  out.push(B('plate-2x4', body, X(0), 4, Z(0), 0));
  out.push(B('slope-2x2-45', body, X(0), 4, Z(4), 2));
  // cabin
  out.push(B('brick-2x2', body, X(0), 5, Z(0), 0));
  out.push(B('slope-2x2-45', 'transblue', X(0), 5, Z(2), 2));
  out.push(B('plate-2x4', body, X(0), 8, Z(0), 0));
  out.push(B('tile-2x2', body, X(0), 9, Z(0), 0));
  out.push(B('tile-2x2', body, X(0), 9, Z(2), 0));
  // lamps on the high edge of the bonnet
  out.push(B('round-1x1-plate', 'transyellow', X(0), 7, Z(4), 0));
  out.push(B('round-1x1-plate', 'transyellow', X(1), 7, Z(4), 0));
  return { bricks: out, baseW: 32, baseD: 32 };
}

function bridgeStart() {
  const out = [];
  const gap = 20, OZ = 14;
  for (const ox of [4, 4 + gap + 4]) {
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < 4; x += 2) for (let z = 0; z < 4; z += 2) {
        out.push(B('brick-2x2', c % 2 ? 'darkgray' : 'gray', (ox + x) * 2, c * 3, (OZ + z) * 2, 0));
      }
    }
    for (let x = 0; x < 4; x += 2) out.push(B('plate-2x4', 'lightgray', (ox + x) * 2, 12, OZ * 2, 0));
  }
  return { bricks: out, baseW: 40, baseD: 32, note: `Span the ${gap}-stud gap between the two piers.` };
}

function towerStart() {
  const OX = 15, OZ = 15;
  return {
    bricks: [
      B('plate-4x4', 'gray', (OX - 1) * 2, 0, (OZ - 1) * 2, 0),
      B('brick-2x4', 'red', (OX - 1) * 2, 1, OZ * 2, 1),
    ],
    baseW: 32, baseD: 32,
    note: 'Build the tallest tower you can with 30 bricks.',
  };
}

function sculpture() {
  // A twisted tower: every course turns a quarter, so each brick still
  // overlaps the one below by two studs.
  const out = [];
  const cx = 15, cz = 15;
  const palette = ['magenta', 'purple', 'blue', 'teal', 'brightgreen', 'yellow', 'orange', 'red'];
  for (let i = 0; i < 26; i++) {
    const r = i & 1;
    const x = r ? cx - 1 : cx;
    const z = r ? cz : cz - 1;
    out.push(B('brick-2x4', palette[i % palette.length], x * 2, i * 3, z * 2, r));
  }
  out.push(B('cone-2x2', 'gold', cx * 2, 78, cz * 2, 0));
  for (let i = 0; i < 8; i++) {
    out.push(B('round-1x1-brick', 'transclear', (cx + 6) * 2, i * 3, (cz - 6) * 2, 0));
    out.push(B('round-1x1-brick', 'transgreen', (cx - 6) * 2, i * 3, (cz + 6) * 2, 0));
  }
  return { bricks: out, baseW: 32, baseD: 32 };
}

function technicDemo() {
  const out = [];
  const OX = 10, OZ = 12;
  const X = (s) => (OX + s) * 2, Z = (s) => (OZ + s) * 2;
  for (let c = 0; c < 3; c++) {
    out.push(B('technic-brick-1x8', 'darkgray', X(0), c * 3, Z(0), 0));
    out.push(B('technic-brick-1x8', 'darkgray', X(5), c * 3, Z(0), 0));
  }
  out.push(B('plate-2x8', 'lightgray', X(0), 9, Z(0), 0));
  out.push(B('plate-2x8', 'lightgray', X(4), 9, Z(0), 0));
  out.push(B('beam-1x7', 'steel', X(1), 10, Z(1), 0));
  out.push(B('beam-1x7', 'steel', X(4), 10, Z(1), 0));
  out.push(B('axle-6', 'black', X(2), 11, Z(1), 0));
  out.push(B('pin-friction', 'blue', X(1), 11, Z(0), 0));
  out.push(B('pin-long', 'blue', X(4), 11, Z(-1), 0));
  out.push(B('wheel-large', 'rubberblack', X(-3), 0, Z(2), 0));
  out.push(B('wheel-large', 'rubberblack', X(6), 0, Z(2), 0));
  return { bricks: out, baseW: 32, baseD: 32, note: 'Technic-style bricks, beams, pins and axles in one frame.' };
}

export const EXAMPLES = [
  { id: 'blank', name: 'Blank baseplate', blurb: 'An empty 32 × 32 surface. Start from nothing.', build: blank, icon: '▦' },
  { id: 'house', name: 'Small house', blurb: 'Walls, a door, a window and a pitched roof.', build: house, icon: '⌂' },
  { id: 'vehicle', name: 'Simple vehicle', blurb: 'Four wheels, a windscreen and lights.', build: vehicle, icon: '⛟' },
  { id: 'bridge', name: 'Bridge challenge', blurb: 'Two piers and a 20-stud gap. Cross it.', build: bridgeStart, icon: '⌒' },
  { id: 'tower', name: 'Tower challenge', blurb: 'A base plate and one brick. Go up.', build: towerStart, icon: '⇡' },
  { id: 'sculpture', name: 'Abstract sculpture', blurb: 'A rotating stack that climbs in a spiral.', build: sculpture, icon: '✦' },
  { id: 'technic', name: 'Technic-style mechanism', blurb: 'Beams, pins, axles and big wheels.', build: technicDemo, icon: '⚙' },
];

export function exampleProject(id) {
  const ex = EXAMPLES.find((e) => e.id === id) || EXAMPLES[0];
  const r = ex.build();
  return {
    format: 'brickwork-project', schema: SCHEMA_VERSION, app: VERSION,
    id: uid('proj'), name: ex.name, created: Date.now(), sample: true,
    settings: { baseW: r.baseW, baseD: r.baseD },
    layers: [{ id: 'layer_base', name: 'Layer 1', color: '#F5CD2F', visible: true, locked: false }],
    groups: [],
    bricks: r.bricks.map((b) => ({ i: uid('brk'), p: b.part, c: b.color, x: b.x, y: b.y, z: b.z, r: b.r, l: 'layer_base' })),
    note: r.note || null,
  };
}

/* ---------------------------------------------------------- challenges -- */
export const CHALLENGES = [
  { id: 'tallest', name: 'Tallest stable tower', brief: 'Build the tallest tower you can using 30 bricks. It has to stand on its own — no floating pieces.', limit: 30, check: 'height' },
  { id: 'span', name: 'Span the gap', brief: 'Cross a 20-stud gap. Only the two ends may touch the surface.', check: 'span' },
  { id: 'fourwheels', name: 'Exactly four wheels', brief: 'Build a vehicle that uses exactly four wheels. Anything else is fair game.', check: 'wheels' },
  { id: 'twocolor', name: 'Two-colour animal', brief: 'Make a recognisable animal using no more than two colours.', check: 'colors2' },
  { id: 'silhouette', name: 'Rebuild from a silhouette', brief: 'Switch to the Blueprint render style, look at the outline only, and rebuild the shape from memory.', check: null },
  { id: 'symmetry', name: 'Symmetrical on two axes', brief: 'Build something that is symmetrical front-to-back and left-to-right.', check: 'symmetry' },
  { id: 'only2x4', name: 'Only 2 × 4 bricks', brief: 'Build anything at all — but every piece has to be a 2 × 4 brick.', check: 'only2x4' },
];

const RANDOM_BITS = {
  subject: ['a house', 'a creature', 'a vehicle', 'a bridge', 'a tree', 'a machine', 'a chair', 'a boat', 'a robot', 'a lighthouse'],
  constraint: ['using no more than three colours', 'without any 2 × 4 bricks', 'that is exactly 12 studs tall', 'that fits inside 6 × 6 studs',
    'with at least one transparent piece', 'using only plates', 'that is symmetrical', 'with nothing floating',
    'that uses every colour on the palette at least once', 'using fewer than 25 pieces'],
  twist: ['in under ten minutes', 'without undo', 'starting from the top down', 'with the grid turned off',
    'using only pieces you have never placed before', 'in one continuous sitting'],
};
export function randomChallenge() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    id: 'random_' + Date.now(),
    name: 'Random constraint',
    brief: `Build ${pick(RANDOM_BITS.subject)} ${pick(RANDOM_BITS.constraint)}, ${pick(RANDOM_BITS.twist)}.`,
    check: null,
  };
}

/** Light-touch progress readout for the checkable challenges. */
export function challengeProgress(challenge, model, analysis) {
  if (!challenge) return null;
  const bricks = [...model.bricks.values()];
  const n = bricks.length;
  switch (challenge.check) {
    case 'height': {
      const bb = model.bounds();
      const h = bb ? bb.y1 : 0;
      return { text: `${h} plates tall · ${n}/${challenge.limit} bricks`,
        ok: n <= (challenge.limit || Infinity) && !analysis?.floating.length };
    }
    case 'wheels': {
      const w = bricks.filter((b) => b.part.startsWith('wheel-') && b.part !== 'wheel-holder-2x2').length;
      return { text: `${w} wheel${w === 1 ? '' : 's'} placed`, ok: w === 4 };
    }
    case 'colors2': {
      const c = new Set(bricks.map((b) => b.color));
      return { text: `${c.size} colour${c.size === 1 ? '' : 's'} used`, ok: c.size > 0 && c.size <= 2 };
    }
    case 'only2x4': {
      const bad = bricks.filter((b) => b.part !== 'brick-2x4').length;
      return { text: bad ? `${bad} piece${bad === 1 ? '' : 's'} that are not 2 × 4 bricks` : `${n} pieces, all 2 × 4`, ok: n > 0 && bad === 0 };
    }
    case 'symmetry': {
      const bb = model.bounds();
      if (!bb) return { text: 'Nothing built yet', ok: false };
      const cells = new Set();
      for (const b of bricks) {
        const w = model.worldBounds(b);
        cells.add(`${w.x0},${w.y0},${w.z0}`);
      }
      let mirrored = 0;
      for (const b of bricks) {
        const w = model.worldBounds(b);
        const mx = bb.x0 + bb.x1 - w.x1;
        if (cells.has(`${mx},${w.y0},${w.z0}`)) mirrored++;
      }
      const pct = n ? Math.round(mirrored / n * 100) : 0;
      return { text: `${pct}% of pieces have a left-right mirror`, ok: pct > 92 };
    }
    case 'span': {
      const ground = bricks.filter((b) => model.worldBounds(b).y0 === 0).length;
      return { text: `${ground} piece${ground === 1 ? '' : 's'} touching the surface`, ok: ground > 0 && !analysis?.floating.length };
    }
    default:
      return { text: `${n} piece${n === 1 ? '' : 's'} placed`, ok: null };
  }
}

/* ------------------------------------------------------------ tutorial -- */
export const TUTORIAL = [
  { title: 'Look around', body: 'Drag with the right mouse button to orbit. Two fingers on a touchscreen do the same. Scroll or pinch to zoom.', hint: 'Try orbiting now.' },
  { title: 'Pick a brick', body: 'Choose any piece from the trays on the left. It follows your pointer as a translucent preview.', hint: 'Click a brick in the catalog.' },
  { title: 'Place it', body: 'Click on the building surface. Green means the piece fits; red means something is in the way.', hint: 'Place your first brick.' },
  { title: 'Turn it', body: 'Press R to rotate the piece a quarter turn before you place it.', hint: 'Rotate, then place another.' },
  { title: 'Stack it', body: 'Aim at the top of a brick you already placed. The new piece snaps onto the studs.', hint: 'Stack one brick on another.' },
  { title: 'Change your mind', body: 'Press Ctrl+Z to undo, or switch to the Select tool and press Delete to remove a piece.', hint: 'Undo something.' },
  { title: 'That is the whole idea', body: 'Everything else — layers, instructions, exports — sits in the panels around the edge, and your work saves itself as you go.', hint: '' },
];
