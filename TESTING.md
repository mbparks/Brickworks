# BRICKWORK — testing checklist

Two parts: what was verified automatically in this container, and what still
needs a human with a browser. The automated section is real — the scripts ran
against the shipped source. The manual section has **not** been run, because
the build environment has no browser and no WebGL.

---

## Part 1 — verified automatically

These ran against the real modules (`node`, ES modules, three.js stubbed only
where a DOM is required). Results as of version 1.0.0.

| # | Check | Result |
| --- | --- | --- |
| 1 | Every module parses and imports cleanly | 15/15 modules |
| 2 | Every named import resolves to a real export | no dangling imports |
| 3 | All 89 catalog parts have a collision volume, a positive height and a positive mass | 0 defects |
| 4 | All 89 parts generate geometry that fits inside their declared footprint | 0 out-of-bounds |
| 5 | Total catalog geometry cost | 50,292 triangles, 565 average per part |
| 6 | Every example build loads with **zero** overlapping pieces | house 84, vehicle 16, bridge 36, tower 2, sculpture 43, technic 15 |
| 7 | Every example build has **zero** floating pieces | all connected to the surface |
| 8 | Placement resolves correctly on the surface, when stacking, and when blocked | correct position and a specific refusal reason |
| 9 | Project JSON round-trips losslessly | bricks, colours, layers and settings byte-identical; only `modified` differs |
| 10 | File validation rejects bad input with a specific message | not-a-project, missing schema, future schema, missing brick list all refused |
| 11 | Unknown parts are skipped on import rather than corrupting the model | 1 of 2 bricks loaded, no throw |
| 12 | Older schema versions are upgraded, not refused | schema 1 loads with a warning |
| 13 | Share encoding round-trips exactly | vehicle 351 chars, house 935 chars, sculpture 543 chars — all identical after decode |
| 14 | Four quarter-turns return a model to its exact starting bounds | identical, 0 overlaps |
| 15 | Mirroring twice returns a model to its exact starting bounds | identical, 0 overlaps |
| 16 | Drop-to-surface restores the original resting height with no overlaps | exact |
| 17 | Move validation rejects moving below the surface | rejected with a reason |
| 18 | The PDF writer produces a structurally valid file | correct header, trailer, `%%EOF`, and every xref offset points at its object |
| 19 | Instruction generation and burial warnings run on a large model | 150 steps from 1,200 bricks, 0 burial warnings |
| 20 | Interface render paths execute without throwing | 16 paths: inspector (empty/single/multi/advanced), stats, analysis, steps, challenges, layers, workspace, BOM/help/project/tutorial dialogs, catalog render/search/list, toasts |

### Performance measured on 1,200 bricks

| Operation | Time |
| --- | --- |
| Adding 1,200 bricks in one transaction | 29 ms |
| Building the full connection graph | 53 ms |
| Complete stability analysis | 61 ms |
| Generating a 150-step instruction plan | 6 ms |
| Undoing all 1,200 additions | 5 ms |

These are the model-layer costs. Frame rate depends on the GPU and has not
been measured — see the manual checklist below.

### Reproducing

The scripts are not shipped in the ZIP. To re-run the checks, import the
modules directly:

```bash
cd brickwork
node --input-type=module -e "
  const { model } = await import('./src/model.js');
  const { exampleProject } = await import('./src/content.js');
  const { analyse } = await import('./src/analysis.js');
  model.loadJSON(exampleProject('house'));
  const a = analyse(model);
  console.log('overlaps', a.collisions.length, 'floating', a.floating.length);
"
```

Modules that touch three.js (`geometry`, `view`, `catalog`, `io`) need `self`,
`window` and a minimal `document` stub defined before import.

---

## Part 2 — manual browser checklist

**Nothing below has been run.** Work through it in a real browser before
trusting the build. Anything marked ⚠ is a place where a bug is most likely,
because it depends on GPU behaviour or pointer semantics that cannot be
exercised headlessly.

### First run

- [ ] Serve the folder over `http://` and open it. The workspace appears with a
      building surface, a stud grid and no console errors.
- [ ] The welcome dialog offers Blank build, Guided build and Example model.
- [ ] ⚠ Brick thumbnails in the left trays render as small 3D previews and fill
      in progressively as you scroll, without freezing the interface.
- [ ] Opening with WebGL disabled shows the plain explanatory page, not a
      broken canvas.

### Placing and snapping

- [ ] Pick Brick 2 × 4, aim at the table: a translucent preview follows the
      pointer and the status strip reads a position.
- [ ] Click places it. The brick lands exactly where the preview was.
- [ ] Aim at the top of that brick: the preview snaps to its studs and the
      status strip says so.
- [ ] Aim at a spot already occupied: the preview turns red and the message
      names the piece in the way.
- [ ] ⚠ In Easy Mode, a blocked placement is raised clear instead, and the
      message says how far it was raised. Nothing moves silently.
- [ ] `R` turns the piece. Four presses returns it to the start.
- [ ] Toggle half-stud offsets with `H` and confirm the preview steps by half a
      stud.
- [ ] Turn on free placement in Workspace and confirm the piece stops snapping.
- [ ] ⚠ Drag a brick from a tray onto the table: it places where dropped.

### Camera

- [ ] Right-drag orbits, middle-drag pans, scroll zooms.
- [ ] `1`–`6` snap to front, back, left, right, top and isometric.
- [ ] ⚠ Clicking each face of the orientation cube changes to that view.
- [ ] `F` frames the selection, `Shift+F` frames everything.
- [ ] The Persp/Ortho button switches projection without jumping the view.
- [ ] Spin runs a slow turntable and stops when pressed again.
- [ ] ⚠ On a touchscreen: one finger orbits, two fingers pan and pinch, a short
      tap places. A tap does not orbit and a drag does not place.

### Selecting and editing

- [ ] Select tool, click a brick: it highlights and the inspector fills in.
- [ ] Shift-click adds and removes from the selection.
- [ ] Drag a box around several bricks: all inside are selected.
- [ ] Select connected, Same part, Same colour and Same layer each behave as
      named.
- [ ] Arrow keys nudge the selection; `PgUp`/`PgDn` move it a plate.
- [ ] ⚠ The move gizmo drags along each axis in whole stud and plate steps.
- [ ] ⚠ The rotate gizmo turns in quarter steps and one drag produces one
      undo entry, not dozens.
- [ ] Duplicate, Mirror, Drop to surface, Hide, Lock, Delete all work and all
      undo cleanly.
- [ ] `Ctrl+C` then `Ctrl+V` pastes at the pointer.
- [ ] Recolour with `C` applies the current swatch to the selection.
- [ ] Locked bricks and bricks on a locked layer refuse to move, with a reason.

### Undo

- [ ] Perform twenty mixed operations, then undo all twenty. The model returns
      exactly to its starting state.
- [ ] Redo replays them.
- [ ] The undo button's tooltip names the operation it would undo.

### Modes, layers and groups

- [ ] Switching Easy ⇄ Advanced changes the visible panels and catalog but
      leaves the model untouched.
- [ ] Add, rename, reorder, hide, lock and delete layers.
- [ ] Group a selection, confirm it appears in the model tree, ungroup it.
- [ ] Save a selection as a subassembly, then stamp it back onto the table.

### Analysis and statistics

- [ ] Build statistics update live as pieces are added.
- [ ] The bill of materials lists the right quantities and exports as CSV.
- [ ] Run the stability check on an intentionally unstable build: floating and
      single-connection pieces are listed, and Show selects them.
- [ ] ⚠ The overlay draws on the model and clears when switched off.
- [ ] The disclaimer about it not being an engineering result is present.

### Instructions

- [ ] Generate instructions on the house example: steps run bottom-up.
- [ ] Preview a step: only pieces up to that step are shown.
- [ ] Rename, reorder and merge steps.
- [ ] ⚠ Export the instructions PDF and open it. Cover, inventory and numbered
      step pages render; images are present and the page count is right.
- [ ] Export step images: one JPEG per step lands in Downloads.

### Saving and files

- [ ] Edit, wait two seconds, and watch the indicator go Unsaved → Saving →
      Saved.
- [ ] Reload the page: the build comes back.
- [ ] Export a project, start a new one, import the file: identical geometry
      and colours.
- [ ] Import a deliberately corrupted JSON: a specific error, no crash, and the
      current model is left alone.
- [ ] ⚠ Fill browser storage and confirm the save-failure message names the
      cause and suggests exporting.
- [ ] Recovery points exist after loading an example over an existing build.
- [ ] Erase every project: everything clears and the page reloads empty.

### Exports

- [ ] PNG screenshot matches the view. The transparent variant has no
      background.
- [ ] ⚠ OBJ opens in a mesh viewer with correct geometry and materials.
- [ ] ⚠ STL opens in a slicer, is watertight enough to slice, and carries the
      not-manufacturing-ready warning in the accompanying notice.
- [ ] Preview card PNG includes the caption strip.
- [ ] Share link opens the same model in a new tab; an oversized model refuses
      with an explanation instead of producing a broken link.

### Accessibility

- [ ] Tab through the entire interface: every control is reachable and the
      focus ring is clearly visible.
- [ ] ⚠ Build a small model using only the keyboard — arrow keys to position,
      `Enter` to place.
- [ ] Screen reader announces the tool, the status messages and the dialogs.
- [ ] High contrast and Reduce motion both take effect immediately.
- [ ] Interface scale changes the whole interface, not just the panels.
- [ ] Valid and invalid placement are distinguishable with colour vision
      deficiency — the message and the ✓ / ✕ glyph carry the meaning, not just
      the colour.
- [ ] All destructive actions ask first and say what will be lost.

### Performance

- [ ] ⚠ Build or load about 1,000 bricks and confirm interaction stays smooth.
- [ ] ⚠ At about 3,000 bricks the complexity warning appears.
- [ ] Performance mode and lower shadow quality both produce a visible
      improvement.
- [ ] Hiding a layer removes its cost from the frame.

### Cross-browser

- [ ] Chrome, Edge, Firefox and Safari on desktop.
- [ ] Safari on iPad and Chrome on Android for touch behaviour.
- [ ] ⚠ Safari specifically: IndexedDB persistence, `<dialog>` behaviour and
      canvas `toBlob` for exports.

---

## Known weak points

Ranked by where a first bug is most likely:

1. **Gizmo dragging** (`main.js` `dragGizmo`). Screen-space to axis mapping is
   derived from the camera's right vector; at certain orbit angles the sign may
   invert and dragging could go the wrong way.
2. **Instanced bucket bookkeeping** (`view.js`). Buckets grow, shrink and
   re-index as bricks are added, hidden, recoloured and deleted. A stale index
   would show as a brick that does not disappear, or a ghost copy left behind.
3. **Touch tap versus drag thresholds** (`main.js` `onUp`). Tuned by reasoning,
   not by using a real touchscreen.
4. **Instruction PDF images.** The JPEG capture path resizes the renderer and
   restores it; if the restore misses, the workspace canvas would be left at
   the wrong size until the next window resize.
5. **Compass picking** (`view.js` `pickCompass`). It raycasts into a scissored
   corner viewport with its own camera; the coordinate mapping is the fiddly
   part.
6. **Storage-full handling.** The error paths are written but were never
   triggered against a genuinely full quota.
