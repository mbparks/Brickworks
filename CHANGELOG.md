# Changelog

All notable changes to BRICKWORK. Versions follow semantic versioning; the
project file schema is versioned separately and is currently **3**.

## [1.0.0] — 2026-08-28

First release.

### Building
- 89-piece catalog across 12 categories: bricks, plates, tiles, slopes, round
  and cone pieces, arches, corners, technic bricks and beams, axles and pins,
  wheels, windows and doors, hinges, clips and bars, decorative pieces and
  baseplates. Every piece is generated procedurally from a dimensional
  description.
- 40-colour palette in five families — solid, transparent, metallic, rubber and
  glow — plus user-defined custom colours.
- Placement with stud snapping, half-stud offsets, underside and side
  attachment, technic hole alignment, adjustable snap strength and a free
  placement mode.
- Green and red placement preview backed by a specific written reason for every
  refusal. A blocked placement is never silently relocated; in Easy Mode it is
  raised clear and the amount is reported.
- Select, box-select, select connected, select by part, colour or layer.
- Move, rotate, duplicate, mirror, drop to surface, recolour, replace with a
  compatible size, hide, lock, group and save as a reusable subassembly.
- Transactional undo and redo, 250 deep, covering every operation uniformly.
- Easy and Advanced modes that change the interface without touching the model.

### Workspace
- Hand-written camera rig: orbit, pan, zoom, six fixed views, isometric,
  perspective and orthographic projection, turntable and a clickable
  orientation cube.
- Adjustable building surface with an optional stud grid, baseplate and ground
  shadow, and automatic expansion when you build near an edge.
- Six render styles: realistic, matte, blueprint, instruction manual,
  inspection and high-contrast accessible.
- Dark and light themes, high contrast, reduced motion and interface scaling.

### Analysis
- Live build statistics: piece count, unique parts, colours, dimensions in
  studs, plates and millimetres, estimated mass and a cost estimate from your
  own per-piece figure.
- Bill of materials with CSV and JSON export.
- Approximate stability assistant: overlaps, floating pieces, single-connection
  subassemblies, unsupported spans, centre of mass and support footprint —
  clearly labelled as a guide rather than an engineering result.

### Instructions
- Automatic bottom-up build order with editable step titles, reordering and
  merging.
- Warnings for steps that would bury a piece already placed.
- Step preview in the workspace.
- Instruction PDF with cover, inventory and numbered step pages, written by a
  dependency-free PDF generator.
- Step images as individual JPEGs.

### Files
- Autosave to IndexedDB with a visible save state and honest failure messages.
- Project management: multiple projects, duplicate, rename, save a copy, and
  automatic recovery checkpoints before anything destructive.
- Versioned project schema with validation, upgrade of older files and a clear
  refusal for newer ones.
- Exports: project JSON, share file, share link, PNG with optional
  transparency, preview card, instructions PDF, step images, bill of materials
  CSV, inventory JSON, OBJ with MTL, and binary STL.
- Seven starter builds and a seven-step guided tutorial.
- Optional challenge drawer with a timer and a random constraint generator.

### Engineering
- Instanced rendering with incremental bucket updates; one draw call per
  part and material family regardless of copy count.
- Spatial hash for collision, snapping and connection queries.
- Deferred, idle-scheduled catalog thumbnails.
- Performance mode and adjustable shadow quality; complexity warnings as models
  grow.
- Entirely local: no account, no backend, no analytics, and no network requests
  after the page loads.
