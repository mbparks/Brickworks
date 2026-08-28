/* BRICKWORK — statistics, bill of materials and the stability assistant.
 *
 * The stability assistant is deliberately approximate. It reads the connection
 * graph and the mass distribution and offers suggestions; it is not a
 * structural engineering calculation and never claims to be.
 */
import { HALF, PLATE, STUD, getColor, round } from './core.js';
import { getPart } from './parts.js';

export function stats(model) {
  const bricks = [...model.bricks.values()];
  const parts = new Set(), colors = new Set();
  let mass = 0;
  for (const b of bricks) {
    parts.add(b.part); colors.add(b.color);
    mass += getPart(b.part)?.mass || 0;
  }
  const bb = model.bounds();
  const size = bb ? {
    studsX: round((bb.x1 - bb.x0) / 2, 1),
    studsZ: round((bb.z1 - bb.z0) / 2, 1),
    plates: bb.y1 - bb.y0,
    mmX: round((bb.x1 - bb.x0) * HALF, 1),
    mmZ: round((bb.z1 - bb.z0) * HALF, 1),
    mmY: round((bb.y1 - bb.y0) * PLATE, 1),
  } : null;
  const comps = components(model);
  return {
    count: bricks.length,
    uniqueParts: parts.size,
    colors: colors.size,
    mass: round(mass, 2),
    size,
    subassemblies: comps.length,
    cost: round(bricks.length * (model.settings.costPerBrick || 0), 2),
    currency: model.settings.currency || '$',
  };
}

/** Connected components of the stud/tube contact graph. */
export function components(model) {
  const adj = model.adjacency();
  const seen = new Set();
  const out = [];
  for (const id of model.bricks.keys()) {
    if (seen.has(id)) continue;
    const comp = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of adj.get(cur) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    out.push(comp);
  }
  return out;
}

/** Bill of materials grouped by part and colour. */
export function billOfMaterials(model) {
  const map = new Map();
  for (const b of model.bricks.values()) {
    const key = b.part + '|' + b.color;
    let row = map.get(key);
    if (!row) {
      const p = getPart(b.part);
      const c = getColor(b.color);
      row = {
        partId: b.part, part: p?.name || b.part, category: p?.cat || '?',
        size: p ? `${p.w}×${p.d}` : '?', colorId: b.color, color: c.name, hex: c.hex,
        qty: 0, unitMass: p?.mass || 0,
      };
      map.set(key, row);
    }
    row.qty++;
  }
  const rows = [...map.values()];
  for (const r of rows) {
    r.mass = round(r.qty * r.unitMass, 2);
    r.cost = round(r.qty * (model.settings.costPerBrick || 0), 2);
  }
  rows.sort((a, b) => b.qty - a.qty || a.part.localeCompare(b.part));
  return rows;
}

/** Approximate stability review. */
export function analyse(model) {
  const bricks = [...model.bricks.values()];
  const adj = model.adjacency();
  const notes = [];
  const floating = [], weak = [], collisions = new Set(), unsupported = [];

  // ---- collisions --------------------------------------------------------
  for (const b of bricks) {
    if (model.collisions(b).length) collisions.add(b.id);
  }

  // ---- grounded / floating ----------------------------------------------
  const comps = components(model);
  let grounded = 0;
  for (const comp of comps) {
    const touchesGround = comp.some((id) => model.worldBounds(model.bricks.get(id)).y0 === 0);
    if (touchesGround) { grounded++; continue; }
    for (const id of comp) floating.push(id);
  }
  for (const b of bricks) {
    const n = adj.get(b.id);
    const bb = model.worldBounds(b);
    if (bb.y0 > 0 && (!n || n.size === 0)) unsupported.push(b.id);
  }

  // ---- weak connections --------------------------------------------------
  //   a brick that carries other pieces through a single contact
  for (const b of bricks) {
    const n = [...(adj.get(b.id) || [])];
    if (n.length !== 1) continue;
    const bb = model.worldBounds(b);
    if (bb.y0 === 0) continue;
    const carried = model.connectedTo(b.id).size;
    if (carried > 3) weak.push(b.id);
  }

  // ---- spans -------------------------------------------------------------
  const spanNotes = spans(model);

  // ---- mass distribution -------------------------------------------------
  let m = 0, cx = 0, cy = 0, cz = 0;
  const contact = [];
  for (const b of bricks) {
    const p = getPart(b.part);
    if (!p) continue;
    const bb = model.worldBounds(b);
    const w = p.mass || 0.1;
    m += w;
    cx += ((bb.x0 + bb.x1) / 2) * w;
    cy += ((bb.y0 + bb.y1) / 2) * w;
    cz += ((bb.z0 + bb.z1) / 2) * w;
    if (bb.y0 === 0) contact.push(bb);
  }
  const com = m ? { x: cx / m, y: cy / m, z: cz / m } : null;
  let footprint = null;
  if (contact.length) {
    footprint = {
      x0: Math.min(...contact.map((b) => b.x0)), x1: Math.max(...contact.map((b) => b.x1)),
      z0: Math.min(...contact.map((b) => b.z0)), z1: Math.max(...contact.map((b) => b.z1)),
      cells: contact.reduce((a, b) => a + (b.x1 - b.x0) * (b.z1 - b.z0) / 4, 0),
    };
  }
  const bb = model.bounds();
  let topHeavy = false;
  if (com && footprint && bb && bb.y1 > 0) {
    const rel = (com.y - bb.y0) / Math.max(1, bb.y1 - bb.y0);
    const inX = com.x > footprint.x0 && com.x < footprint.x1;
    const inZ = com.z > footprint.z0 && com.z < footprint.z1;
    const spanW = Math.min(footprint.x1 - footprint.x0, footprint.z1 - footprint.z0) * HALF;
    const height = (bb.y1 - bb.y0) * PLATE;
    topHeavy = rel > 0.62 && (height > spanW * 2.2 || !inX || !inZ);
  }

  // ---- notes -------------------------------------------------------------
  if (collisions.size) notes.push({ level: 'error', text: `${collisions.size} piece${collisions.size === 1 ? '' : 's'} overlap other pieces.`, ids: [...collisions] });
  if (floating.length) notes.push({ level: 'error', text: `${floating.length} piece${floating.length === 1 ? ' is' : 's are'} not connected to anything touching the surface.`, ids: floating });
  if (unsupported.length) notes.push({ level: 'warn', text: `${unsupported.length} piece${unsupported.length === 1 ? ' has' : 's have'} no connection at all.`, ids: unsupported });
  if (weak.length) notes.push({ level: 'warn', text: `${weak.length} subassembl${weak.length === 1 ? 'y hangs' : 'ies hang'} from a single connection.`, ids: weak });
  for (const s of spanNotes) notes.push(s);
  if (topHeavy) notes.push({ level: 'warn', text: 'The centre of mass sits high over a narrow base. This build would tip easily.', ids: [] });
  if (comps.length > 1) notes.push({ level: 'info', text: `The model is in ${comps.length} separate pieces.`, ids: [] });
  if (!notes.length && bricks.length) notes.push({ level: 'ok', text: 'Everything is connected and nothing overlaps.', ids: [] });

  return {
    notes, floating, weak, unsupported, collisions: [...collisions],
    com, footprint, components: comps.length, grounded, topHeavy,
    footprintArea: footprint ? round(footprint.cells, 1) : 0,
  };
}

/** Horizontal runs with nothing underneath, longer than 8 studs. */
function spans(model) {
  const byLevel = new Map();
  for (const b of model.bricks.values()) {
    const bb = model.worldBounds(b);
    if (bb.y0 === 0) continue;
    if (!byLevel.has(bb.y0)) byLevel.set(bb.y0, []);
    byLevel.get(bb.y0).push(bb);
  }
  const out = [];
  for (const [y, boxes] of byLevel) {
    const below = new Set();
    for (const b of model.bricks.values()) {
      const bb = model.worldBounds(b);
      if (bb.y1 !== y) continue;
      for (let x = bb.x0; x < bb.x1; x += 2) for (let z = bb.z0; z < bb.z1; z += 2) below.add(x + ',' + z);
    }
    let longest = 0;
    for (const bx of boxes) {
      let run = 0;
      for (let x = bx.x0; x < bx.x1; x += 2) {
        let any = false;
        for (let z = bx.z0; z < bx.z1; z += 2) if (below.has(x + ',' + z)) any = true;
        run = any ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      run = 0;
      for (let z = bx.z0; z < bx.z1; z += 2) {
        let any = false;
        for (let x = bx.x0; x < bx.x1; x += 2) if (below.has(x + ',' + z)) any = true;
        run = any ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
    }
    if (longest > 8) {
      out.push({ level: 'warn', text: `An unsupported span of about ${longest} studs at plate level ${y}. Real bricks sag over long gaps.`, ids: [] });
    }
  }
  return out.slice(0, 3);
}

/** Model complexity guidance shown in the status strip. */
export function complexity(model) {
  const n = model.bricks.size;
  if (n > 6000) return { level: 'error', text: `${n.toLocaleString()} bricks — editing will be slow. Turn on Performance mode.` };
  if (n > 3000) return { level: 'warn', text: `${n.toLocaleString()} bricks — approaching the comfortable limit.` };
  return null;
}

export { STUD };
