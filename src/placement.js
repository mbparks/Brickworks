/* BRICKWORK — placement and snapping.
 *
 * Turns a pointer ray hit into a concrete, validated grid position. Every
 * rejection carries a human-readable reason, and every automatic adjustment
 * (raising a brick to clear an obstruction, for example) is reported so a
 * brick is never silently moved somewhere unexpected.
 */
import { HALF, PLATE, clamp } from './core.js';
import { getPart } from './parts.js';
import { footprint, rot as rotBox } from './model.js';

/** Snap step in half-stud units. */
export function step(settings) { return settings.snapHalf ? 1 : 2; }

function snap(v, s) { return Math.round(v / s) * s; }

/**
 * @param {object} o
 *  model, partId, r, fine, settings
 *  point   {x,y,z} world mm intersection
 *  normal  {x,y,z} face normal of the hit (world)
 *  target  brick record that was hit, or null for the build surface
 *  skip    Set of brick ids to ignore for collisions (the moving selection)
 * @returns {{ok, x, y, z, r, reason, snapType, blockers, adjusted}}
 */
export function resolvePlacement(o) {
  const { model, partId, settings, point, normal, target, skip = null } = o;
  const p = getPart(partId);
  const r = (o.r | 0) & 3;
  if (!p) return { ok: false, reason: 'That piece is not in the catalog.', snapType: 'none' };

  const fp = footprint(p, r);
  const s = step(settings);
  let snapType = 'surface';
  let baseY = 0;
  let adjusted = null;

  // ---- vertical reference ------------------------------------------------
  if (target) {
    const bb = model.worldBounds(target);
    if (normal && normal.y > 0.5) { baseY = bb.y1; snapType = 'stud'; }
    else if (normal && normal.y < -0.5) { baseY = bb.y0 - p.h; snapType = 'under'; }
    else { baseY = bb.y0; snapType = 'side'; }
  }

  // ---- horizontal position ----------------------------------------------
  let hx = point.x / HALF, hz = point.z / HALF;
  if (snapType === 'side' && normal) {
    // nudge outward so the new brick sits beside, not inside, the target
    hx += normal.x * fp.w * 0.5;
    hz += normal.z * fp.d * 0.5;
  }
  let x, z;
  if (settings.freePlace) {
    x = Math.round(hx - fp.w / 2);
    z = Math.round(hz - fp.d / 2);
    snapType = 'free';
  } else {
    const assist = clamp(settings.snapAssist ?? 1, 0, 1);
    const rawX = hx - fp.w / 2, rawZ = hz - fp.d / 2;
    const sx = snap(rawX, s), sz = snap(rawZ, s);
    // snap assist below 1 blends toward the raw position, then rounds to the
    // nearest whole half-stud so the grid is still honoured.
    x = Math.round(sx * assist + rawX * (1 - assist));
    z = Math.round(sz * assist + rawZ * (1 - assist));
    if (assist >= 0.999) { x = sx; z = sz; }
  }

  // ---- technic hole snapping --------------------------------------------
  if (target && (p.kind === 'pin' || p.kind === 'axle' || p.kind === 'bar')) {
    const hole = nearestHole(model, target, point);
    if (hole) {
      snapType = 'hole';
      const axisR = hole.axis === 'x' ? 1 : 0;
      return finish({ x: hole.x - (axisR ? 0 : 0), y: hole.y, z: hole.z, r: axisR });
    }
  }

  return finish({ x, y: baseY, z, r });

  function finish(pos) {
    const cand = { id: '__ghost__', part: partId, x: pos.x, y: pos.y, z: pos.z, r: pos.r ?? r, layer: model.activeLayer };
    let blockers = model.collisions(cand, skip);

    if (blockers.length && !settings.collisionOverride && settings.mode === 'easy') {
      // Easy Mode lifts the piece clear rather than refusing outright.
      for (let lift = 1; lift <= 24 && blockers.length; lift++) {
        cand.y = pos.y + lift;
        blockers = model.collisions(cand, skip);
        if (!blockers.length) adjusted = `Raised ${lift} plate${lift === 1 ? '' : 's'} to clear the piece below.`;
      }
      pos.y = cand.y;
    }
    if (cand.y < 0) {
      return { ...pos, ok: false, snapType, blockers, adjusted,
        reason: 'That is below the building surface. Aim at the table or the top of a brick.' };
    }
    if (blockers.length) {
      if (settings.collisionOverride) {
        return { ...pos, ok: true, snapType, blockers, adjusted,
          reason: `Overlaps ${blockers.length} piece${blockers.length === 1 ? '' : 's'} — collision override is on.`, warn: true };
      }
      const first = model.bricks.get(blockers[0]);
      const nm = first ? (getPart(first.part)?.name || 'a piece') : 'a piece';
      return { ...pos, ok: false, snapType, blockers, adjusted,
        reason: `That space is taken by ${nm}${blockers.length > 1 ? ` and ${blockers.length - 1} more` : ''}.` };
    }
    return { ...pos, ok: true, snapType, blockers: [], adjusted, reason: describe(snapType, adjusted) };
  }
}

function describe(snapType, adjusted) {
  if (adjusted) return adjusted;
  return {
    stud: 'Snapped to the studs below.',
    under: 'Attaching underneath.',
    side: 'Placing alongside.',
    hole: 'Aligned with the hole.',
    free: 'Free placement — snapping is off.',
    surface: 'Placing on the building surface.',
  }[snapType] || 'Ready to place.';
}

/** Nearest technic hole anchor on `target` to a world point, within 6 mm. */
export function nearestHole(model, target, point) {
  const p = getPart(target.part);
  if (!p || !p.holes) return null;
  let best = null, bestD = 36;
  for (const h of p.holes) {
    const w = rotBox({ x: h.x, y: h.y, z: h.z, w: 0, h: 0, d: 0 }, p, target);
    const dx = w.x * HALF - point.x, dy = w.y * PLATE - point.y, dz = w.z * HALF - point.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD * bestD) {
      bestD = Math.sqrt(d);
      const axis = (target.r & 1) ? (h.axis === 'x' ? 'z' : 'x') : h.axis;
      best = { x: Math.round(w.x - 1), y: Math.round(w.y - 0.5), z: Math.round(w.z - 1), axis };
    }
  }
  return best;
}

/** Can this exact brick record sit here? */
export function canPlace(model, brick, skip = null) {
  if (brick.y < 0) return { ok: false, reason: 'Below the building surface.' };
  const hits = model.collisions(brick, skip);
  if (hits.length) return { ok: false, reason: 'Overlaps another piece.', blockers: hits };
  return { ok: true };
}

/** Validate a whole-selection move. Returns {ok, blockers, reason}. */
export function validateMove(model, ids, delta) {
  const set = new Set(ids);
  const blockers = new Set();
  for (const id of ids) {
    const b = model.bricks.get(id);
    if (!b) continue;
    const cand = { ...b, x: b.x + delta.dx, y: b.y + delta.dy, z: b.z + delta.dz };
    if (cand.y < 0) return { ok: false, reason: 'That would push pieces below the building surface.' };
    for (const h of model.collisions(cand, set)) blockers.add(h);
  }
  if (blockers.size) {
    return { ok: false, blockers: [...blockers], reason: `Blocked by ${blockers.size} piece${blockers.size === 1 ? '' : 's'}.` };
  }
  return { ok: true, blockers: [] };
}

/** Validate a rotation of the selection about its own centre. */
export function rotatedRecords(model, ids, quarter) {
  const list = ids.map((id) => model.bricks.get(id)).filter(Boolean);
  if (!list.length) return [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of list) {
    const bb = model.worldBounds(b);
    x0 = Math.min(x0, bb.x0); z0 = Math.min(z0, bb.z0);
    x1 = Math.max(x1, bb.x1); z1 = Math.max(z1, bb.z1);
  }
  const w = x1 - x0, d = z1 - z0;
  return list.map((b) => {
    const p = getPart(b.part);
    const fpb = footprint(p, b.r);
    // rotate the brick's min corner about the selection footprint
    const lx = b.x - x0, lz = b.z - z0;
    let nx, nz;
    if (quarter > 0) { nx = d - lz - fpb.d; nz = lx; }
    else { nx = lz; nz = w - lx - fpb.w; }
    return { id: b.id, x: Math.round(x0 + nx), z: Math.round(z0 + nz), r: (b.r + (quarter > 0 ? 1 : 3)) & 3 };
  });
}

/** Mirror the selection across its own X or Z centre line. */
export function mirroredRecords(model, ids, axis = 'x') {
  const list = ids.map((id) => model.bricks.get(id)).filter(Boolean);
  if (!list.length) return [];
  let a0 = Infinity, a1 = -Infinity;
  for (const b of list) {
    const bb = model.worldBounds(b);
    a0 = Math.min(a0, axis === 'x' ? bb.x0 : bb.z0);
    a1 = Math.max(a1, axis === 'x' ? bb.x1 : bb.z1);
  }
  return list.map((b) => {
    const p = getPart(b.part);
    const fpb = footprint(p, b.r);
    if (axis === 'x') {
      const nr = (4 - b.r) & 3;
      const nfp = footprint(p, nr);
      return { id: b.id, x: Math.round(a0 + a1 - b.x - fpb.w + (fpb.w - nfp.w)), r: nr };
    }
    const nr = (2 - b.r + 4) & 3;
    const nfp = footprint(p, nr);
    return { id: b.id, z: Math.round(a0 + a1 - b.z - fpb.d + (fpb.d - nfp.d)), r: nr };
  });
}

/** Lower the whole selection, keeping its shape, until it rests on the
 *  surface or on something that is not part of the selection. */
export function dropRecords(model, ids) {
  const set = new Set(ids);
  const list = ids.map((id) => model.bricks.get(id)).filter(Boolean);
  if (!list.length) return [];
  const minY = Math.min(...list.map((b) => model.worldBounds(b).y0));
  let drop = 0;
  for (let d = 1; d <= minY; d++) {
    if (list.some((b) => model.collisions({ ...b, y: b.y - d }, set).length)) break;
    drop = d;
  }
  if (!drop) return [];
  return list.map((b) => ({ id: b.id, y: b.y - drop }));
}
