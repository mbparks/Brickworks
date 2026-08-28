# BRICKWORK — virtual brick building sandbox

Version 1.0.0 · project schema 3

BRICKWORK is a browser-based sandbox for building models out of virtual
interlocking toy bricks. It is meant to feel like opening a big box of bricks
on a workbench: pick a piece, click the table, keep going. There is no account,
no backend and no telemetry. Your builds live in your own browser until you
export them.

It is not affiliated with, sponsored by, or endorsed by the LEGO Group or any
other toy manufacturer. No proprietary logos, minifigure designs, branding,
colour lists or model files are used. Every piece in the catalog is generated
procedurally from a dimensional description; the pieces are *compatible* with
common interlocking bricks in the sense that they share the same 8 mm stud
pitch and 3.2 mm plate height.

---

## Browser requirements

* A current version of **Chrome, Edge, Firefox or Safari** with WebGL enabled.
* Roughly 60 MB of free browser storage for projects (BRICKWORK will tell you
  if storage is full or unavailable, and you can still export to files).
* Desktop, laptop or tablet. It works on a phone but the panels get cramped.

If WebGL is unavailable, BRICKWORK says so on a plain page instead of showing a
broken workspace.

## Running it locally

BRICKWORK uses ES modules, so it needs to be served over `http://` rather than
opened as a `file://` path. Any static server will do:

```bash
cd brickwork
python3 -m http.server 8080
# then open http://localhost:8080/
```

or

```bash
npx serve .
```

There is no build step, no bundler, no package install and no compilation. What
you see in the folder is what runs.

## Putting it on a web server

Upload the whole `brickwork/` folder to any static host — Apache, nginx, Caddy,
GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, the `public_html`
directory on shared hosting. No server-side configuration is required beyond
serving `.js` files as `text/javascript` (every current server does this by
default). It works fine in a subdirectory.

Once loaded, BRICKWORK makes no network requests at all. You can pull the
network cable and keep building.

---

## Camera and building controls

### Camera

| Action | Mouse / trackpad | Touch |
| --- | --- | --- |
| Orbit | Right-drag, Alt-drag, or the Orbit tool | One finger drag |
| Pan | Middle-drag, or Shift + right-drag | Two fingers drag |
| Zoom | Scroll wheel | Pinch |
| Jump to a view | Click a face of the orientation cube (top right) | Tap a face |
| Frame selection / model | `F` / `Shift+F`, or the Frame / All buttons | Buttons |

A short tap places or selects; a drag moves the camera. Touch will not place a
brick by accident.

### Building

1. Pick a piece from the trays on the left (or search for it).
2. Move the pointer over the table. The piece follows as a translucent preview.
3. **Green** preview and a `✓` message means it fits. **Red** and a `✕` message
   means something is in the way, and the status strip says exactly what.
4. Click to place it. Aim at the top of an existing brick to stack.

Placement never moves a piece somewhere you did not ask for without telling you.
In Easy Mode a piece that would collide is raised clear instead, and the
message says how far it was raised.

Snapping options live in the **Workspace** panel: half-stud offsets, free
placement (no stud snapping), snap strength, and — in Advanced Mode — an
override that allows deliberate overlaps.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1` – `6` | Front, back, left, right, top, isometric views |
| `P` `V` `M` `T` `O` | Place, Select, Move, Rotate, Orbit tools |
| `R` / `Shift+R` | Rotate a quarter turn (either way) |
| `D` | Duplicate the selection |
| `C` | Recolour the selection with the current colour |
| `F` / `Shift+F` | Frame the selection / the whole model |
| `G` | Toggle the grid |
| `H` | Toggle half-stud offsets |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` (or `Ctrl+Y`) | Redo |
| `Ctrl/Cmd + C` / `V` | Copy / paste |
| `Ctrl/Cmd + A` | Select everything |
| `Ctrl/Cmd + S` | Save now |
| `Arrow keys` | Nudge the piece or the selection |
| `PgUp` / `PgDn` | Move up or down one plate |
| `Enter` | Place the piece at the current marker |
| `Esc` | Cancel, or clear the selection |
| `?` | Help and shortcut reference |

Arrow keys plus `Enter` are a complete alternative to drag-and-drop: nothing in
BRICKWORK requires a mouse drag.

## Easy and Advanced modes

**Easy Mode** shows a smaller, friendlier catalog, snaps automatically,
prevents overlaps, and keeps the technical panels out of the way.

**Advanced Mode** adds layers, groups and subassemblies, the connection
inspector, precise coordinates, free placement, collision override, the
stability assistant, the piece inventory, instruction generation and the
performance controls.

Switching modes changes what is on screen. It never changes, moves or discards
anything in your model.

---

## Saving, importing and exporting

### Autosave

Your project is written to IndexedDB about two seconds after you stop editing.
The save indicator in the bottom strip shows **Unsaved**, **Saving…**, **Saved**
or **Save failed** — and if a save fails, it tells you why (usually storage is
full) rather than failing silently.

When you reopen BRICKWORK it resumes the last autosave. `Project ▸ Recover the
last autosave` and `Project ▸ Recovery points` let you go further back;
BRICKWORK writes a recovery checkpoint automatically before anything
destructive, such as importing a file over an existing build.

### Import

* `Project ▸ Open a project file` reads a `.bwp.json` project.
* `Project ▸ Import a shared build` reads a `.bwshare.json` share file.
* A link with a `#build=…` fragment opens that model directly.

Every imported file is validated before it replaces anything: the format
marker, schema version and every brick record are checked. Unknown parts are
skipped with a warning rather than corrupting the model, and a project written
by a newer version of BRICKWORK is refused with a clear message instead of
loading half of it.

### Export formats

| Format | What it is for |
| --- | --- |
| Project JSON (`.bwp.json`) | The complete, versioned project. Round-trips exactly. |
| Share file (`.bwshare.json`) | The model without instruction data, for handing to someone else. |
| Share link | Very small models encoded into a URL fragment (up to 4,000 characters, about 350 bricks). Nothing is uploaded. |
| PNG screenshot | The current view, with an optional transparent background. |
| Preview card PNG | The render plus a caption strip, for posting. |
| Instructions PDF | Cover, inventory and numbered step pages. |
| Step images | One JPEG per instruction step. |
| Bill of materials CSV | Quantity, part, colour, mass and your cost estimate. |
| Inventory JSON | The same data in machine-readable form. |
| OBJ + MTL / STL | Mesh geometry for visualisation or personal prototyping. |

**About the mesh exports:** OBJ and STL are visualisation geometry. They carry
no clearances, no wall-thickness rules, no draft and no tolerances. They are
fine for rendering or for a personal print you intend to clean up yourself.
They are **not manufacturing-ready** and will not produce parts that clutch
correctly with real bricks.

---

## Performance

BRICKWORK draws bricks with instanced rendering: one draw call per
(part, material) combination, no matter how many copies of that piece exist.
Editing rewrites only the buckets an edit touched, never the whole scene.
Collision and snapping queries go through a spatial hash rather than scanning
the model.

What to expect on an ordinary desktop:

* **Up to ~1,000 bricks** — smooth interaction with shadows on.
* **1,000–3,000 bricks** — comfortable; drop shadow quality if it stutters.
* **3,000–6,000 bricks** — BRICKWORK warns you and suggests Performance mode.
* **Beyond 6,000** — usable for editing but not for smooth orbiting.

If it feels slow, in the **Workspace** panel: turn on **Performance mode**
(drops shadows and pixel ratio), set **Shadow quality** to Low or Off, or hide
layers you are not working on. Turning the grid and baseplate off also helps on
weak integrated graphics.

## Privacy and local-first behaviour

* No account, no sign-in, no server.
* No analytics, no telemetry, no error reporting, no fonts or scripts from a CDN.
* After the page loads, BRICKWORK makes **no network requests whatsoever**.
* Projects live in this browser's IndexedDB; interface preferences live in
  `localStorage`. Nothing else is stored.
* Sharing happens through files you export and links you copy — a model is
  never uploaded anywhere by BRICKWORK.
* `Project ▸ Erase every project on this machine` deletes all of it.

---

## Current limitations

Worth knowing before you start something ambitious:

* **Collision uses axis-aligned boxes per piece.** A slope's overhang, a cone's
  taper and a wheel's roundness are all treated as their bounding box, except
  for arches and corner pieces, which carry explicit multi-box shapes. You can
  occasionally not place something that would physically fit.
* **Fine rotation is visual only.** Pieces that allow a non-90° turn (hinges,
  axles, bars, wheels) render at the angle you set, but collision and
  connection still use the piece's 90° footprint.
* **Undersides are solid.** Bricks are modelled without hollow undersides and
  tubes. This is a deliberate trade for triangle count; it is only visible if
  you orbit below the table.
* **The stability assistant is approximate.** It reads the connection graph and
  the mass distribution. It knows nothing about friction, clutch power, real
  material strength or dynamics. Treat it as a second pair of eyes, not a
  result.
* **Instruction order is a starting point.** BRICKWORK groups pieces bottom-up
  and flags steps that would bury a piece, but it does not guarantee a build
  order that works in the real world. Reorder steps yourself.
* **Technic pin and hole snapping is simplified.** Pins and axles align to the
  nearest hole anchor; they do not simulate a mechanism.
* **Share links carry small models only.** Past about 350 bricks, export a
  share file instead.
* **Instruction PDFs embed JPEG frames.** They print well but are not vector
  drawings.
* **One project open at a time.** There are no tabs.

## File structure

```
brickwork/
├── index.html                 the whole interface shell
├── manifest.webmanifest       installable-app metadata
├── README.md                  this file
├── LICENSE                    MIT, for BRICKWORK itself
├── THIRD-PARTY-NOTICES.md     licences of bundled dependencies
├── TESTING.md                 the acceptance checklist
├── CHANGELOG.md
├── css/
│   └── app.css                every style in the application
├── icons/
│   ├── icon.svg  icon-192.png  icon-512.png
├── examples/                  the starter builds as importable .bwp.json files
├── vendor/
│   └── three/                 three.js r185, MIT, bundled locally
└── src/
    ├── core.js                units, colour system, event bus, helpers
    ├── parts.js               the brick catalog (data only)
    ├── geometry.js            procedural geometry for every piece
    ├── model.js               project state, spatial index, transactional undo
    ├── placement.js           snapping, collision resolution, rotate/mirror/drop
    ├── view.js                renderer, camera rig, instanced drawing, overlays
    ├── analysis.js            statistics, bill of materials, stability
    ├── persist.js             IndexedDB, autosave, checkpoints, preferences
    ├── io.js                  import and export in every format
    ├── pdf.js                 a small dependency-free PDF writer
    ├── instructions.js        build order, step editing, printable output
    ├── content.js             example builds, challenges, the tutorial script
    ├── catalog.js             the parts browser and thumbnail renderer
    ├── ui.js                  panels, dialogs, status strip
    └── main.js                tools, input, and the action set
```

The separation is deliberate: state, rendering, placement, persistence,
input and interface do not reach into each other. Every model change is a
transaction, which is what makes undo cover everything uniformly.

## Adding new brick definitions

Two steps: describe the piece, then teach the generator how to draw it.

### 1. Describe it in `src/parts.js`

```js
part({
  id: 'brick-2x10',            // unique, stable — it goes into saved projects
  name: 'Brick 2 × 10',
  cat: 'bricks',               // a category id from CATEGORIES
  w: 2, d: 10,                 // footprint in studs
  h: 3,                        // height in plates (3 = a standard brick)
  kind: 'boxy',                // which generator draws it
  color: 'red',                // default colour id
  kw: 'long beam wall',        // extra search keywords
});
```

Everything else is derived: stud anchors, the collision volume, mass, the
size filter key and the search index.

Useful optional fields:

| Field | Meaning |
| --- | --- |
| `cells` | Non-rectangular footprint, e.g. `[[0,0],[1,0],[0,1]]` for an L |
| `collision` | Explicit collision boxes in half-stud / plate units (see the arches) |
| `studs` | `'grid'` (default), `'none'`, or explicit `[[hx,hz], …]` anchors |
| `tubes` | `false` if the piece cannot sit on studs (beams, axles, wheels) |
| `holes` | Technic hole anchors, `{ axis, x, y, z }` |
| `fine` | `true` to allow non-90° rotation |
| `side` | `'studs'` or `'clip'` for side-attaching pieces |
| `allow` | Restrict to certain colour types, e.g. `['solid','metal']` |
| `opts` | Free-form options passed to the geometry generator |

Coordinates: `x` and `z` are in **half-studs** (4 mm), `y` is in **plates**
(3.2 mm). A piece at rotation 0 occupies `[0, w*2) × [0, h) × [0, d*2)`.

### 2. Draw it in `src/geometry.js`

If your piece is a box with studs, `kind: 'boxy'` already handles it and you are
done. Otherwise add a generator to the `BUILDERS` map:

```js
BUILDERS.mypiece = (m, p) => {
  // m.main / m.dark / m.light / m.glass are mesh builders.
  // main takes the brick's colour; the others are fixed detail materials.
  m.main.box(0, 0, 0, p.w * STUD, p.h * PLATE, p.d * STUD);   // chamfered box
  m.main.tube(cx, cy, cz, r0, r1, len, axis, segments);        // cylinder / cone
  m.main.ring(cx, cy, cz, rIn, rOut, axis, dir, segments);     // flat annulus
  addStuds(m.main, p);                                        // studs on top
};
```

Geometry is authored in millimetres with the origin at the minimum corner of
the footprint. Cache invalidation is automatic; reload the page to see changes.

To add the piece to Easy Mode, add its id to `EASY_PART_IDS` in `parts.js`.

**Colours** are added the same way, in the `COLORS` array in `src/core.js`:
an `id`, a `name`, a `hex` and a `type` of `solid`, `trans`, `metal`, `rubber`
or `glow`. Users can also add one-off colours from the Colours panel at any
time without touching the code.

---

## The project file

`.bwp.json` files carry `"format": "brickwork-project"` and a numeric `schema`.
The current schema is **3**. Brick records are stored in short form to keep
files small:

```json
{ "i": "brk_…", "p": "brick-2x4", "c": "red",
  "x": 8, "y": 3, "z": 12, "r": 1, "l": "layer_base" }
```

`i` id · `p` part · `c` colour · `x`/`z` half-studs · `y` plates · `r` quarter
turns · `l` layer · optional `f` fine angle, `g` group, `H` hidden, `L` locked.

Long-form records (`part`, `color`, …) are also accepted on import, so
hand-written files work. Older schemas are upgraded on load; newer ones are
refused with an explanation.

## Credits

Built as a single self-contained static application. The only bundled
dependency is [three.js](https://threejs.org/) (MIT), included in
`vendor/three/`. See `THIRD-PARTY-NOTICES.md`.
