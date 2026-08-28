# Third-party notices

BRICKWORK bundles one third-party library. It is vendored into the repository
so the application has no network dependencies and no install step.

---

## three.js

* **Version:** r185 (npm `three@0.185.1`)
* **Location:** `vendor/three/three.module.min.js`, `vendor/three/three.core.min.js`
* **Homepage:** https://threejs.org/
* **Source:** https://github.com/mrdoob/three.js
* **Licence:** MIT — the full text is reproduced in `vendor/three/LICENSE`

```
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Only the core module is used. No three.js addons, loaders, controls or
post-processing passes are bundled — the camera rig, the picking, the
instanced drawing and the mesh exporters in BRICKWORK are written directly
against the core API.

---

## Everything else

Written for this project, MIT licensed under `LICENSE`:

* The PDF writer (`src/pdf.js`) — a minimal PDF 1.4 generator, no library.
* The OBJ, MTL and STL exporters (`src/io.js`).
* All brick geometry (`src/geometry.js`) — generated from dimensions, not
  derived from any existing model file or parts library.
* The colour palette (`src/core.js`) — named descriptively, not copied from
  any manufacturer's official colour list.
* The icons (`icons/`) and all styling (`css/app.css`).

**Fonts.** No fonts are bundled or fetched. BRICKWORK uses the system font
stack, so text renders in whatever the operating system already provides.
