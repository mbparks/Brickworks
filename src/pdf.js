/* BRICKWORK — a very small PDF writer.
 *
 * Enough of PDF 1.4 to lay out instruction pages: Helvetica text, filled and
 * stroked rectangles, and JPEG images embedded directly with DCTDecode. No
 * third-party library is involved, which keeps the distribution self-contained.
 */

const enc = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
const esc = (s) => String(s).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, '?');

export function dataURLToBytes(url) {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class PDF {
  /** @param {number} w page width in points @param {number} h page height */
  constructor(w = 595.28, h = 841.89, meta = {}) {
    this.W = w; this.H = h;
    this.pages = [];
    this.images = [];
    this.meta = meta;
    this.page = null;
    this.addPage();
  }
  addPage() {
    this.page = { ops: [], xobjects: new Set() };
    this.pages.push(this.page);
    return this.page;
  }
  /* -------------------------------------------------------------- draw -- */
  fill(x, y, w, h, color = [0, 0, 0]) {
    this.page.ops.push(`q ${color.join(' ')} rg ${n(x)} ${n(this.H - y - h)} ${n(w)} ${n(h)} re f Q`);
  }
  stroke(x, y, w, h, color = [0, 0, 0], lw = 0.8) {
    this.page.ops.push(`q ${color.join(' ')} RG ${n(lw)} w ${n(x)} ${n(this.H - y - h)} ${n(w)} ${n(h)} re S Q`);
  }
  line(x0, y0, x1, y1, color = [0, 0, 0], lw = 0.8) {
    this.page.ops.push(`q ${color.join(' ')} RG ${n(lw)} w ${n(x0)} ${n(this.H - y0)} m ${n(x1)} ${n(this.H - y1)} l S Q`);
  }
  text(x, y, size, str, { bold = false, color = [0, 0, 0], align = 'left', width = 0 } = {}) {
    const font = bold ? '/F2' : '/F1';
    let tx = x;
    if (align !== 'left' && width) {
      const w = measure(str, size, bold);
      tx = align === 'center' ? x + (width - w) / 2 : x + width - w;
    }
    this.page.ops.push(`BT ${font} ${n(size)} Tf ${color.join(' ')} rg ${n(tx)} ${n(this.H - y)} Td (${esc(str)}) Tj ET`);
  }
  /** Wrapped paragraph. Returns the y position after the last line. */
  paragraph(x, y, width, size, str, opts = {}) {
    const words = String(str).split(/\s+/);
    let line = '', yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (measure(test, size, opts.bold) > width && line) {
        this.text(x, yy, size, line, opts); yy += size * 1.35; line = w;
      } else line = test;
    }
    if (line) { this.text(x, yy, size, line, opts); yy += size * 1.35; }
    return yy;
  }
  /** @param {string} dataURL a `data:image/jpeg;base64,...` frame */
  image(dataURL, x, y, w, h, pxW, pxH) {
    const bytes = dataURLToBytes(dataURL);
    const idx = this.images.length;
    this.images.push({ bytes, w: pxW, h: pxH });
    const name = `/Im${idx}`;
    this.page.xobjects.add(idx);
    this.page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.H - y - h)} cm ${name} Do Q`);
  }
  /* ------------------------------------------------------------- build -- */
  blob() {
    const chunks = [];
    let len = 0;
    const push = (s) => { const b = typeof s === 'string' ? enc(s) : s; chunks.push(b); len += b.length; };
    const offsets = [0];
    const obj = (id, body, stream) => {
      offsets[id] = len;
      push(`${id} 0 obj\n${body}\n`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    };
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

    const nImg = this.images.length;
    const idCatalog = 1, idPages = 2, idF1 = 3, idF2 = 4;
    const idImg0 = 5;
    const idPage0 = idImg0 + nImg;
    const idContent0 = idPage0 + this.pages.length;

    obj(idCatalog, `<< /Type /Catalog /Pages ${idPages} 0 R >>`);
    const kids = this.pages.map((_, i) => `${idPage0 + i} 0 R`).join(' ');
    obj(idPages, `<< /Type /Pages /Count ${this.pages.length} /Kids [${kids}] >>`);
    obj(idF1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(idF2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.images.forEach((im, i) => {
      obj(idImg0 + i,
        `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`,
        im.bytes);
    });
    this.pages.forEach((pg, i) => {
      const xo = [...pg.xobjects].map((k) => `/Im${k} ${idImg0 + k} 0 R`).join(' ');
      obj(idPage0 + i,
        `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${n(this.W)} ${n(this.H)}] ` +
        `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> ${xo ? `/XObject << ${xo} >>` : ''} >> ` +
        `/Contents ${idContent0 + i} 0 R >>`);
    });
    this.pages.forEach((pg, i) => {
      const body = pg.ops.join('\n');
      obj(idContent0 + i, `<< /Length ${body.length} >>`, enc(body));
    });
    const idInfo = idContent0 + this.pages.length;
    obj(idInfo, `<< /Title (${esc(this.meta.title || 'BRICKWORK instructions')}) /Creator (BRICKWORK) /Producer (BRICKWORK) >>`);

    const xrefAt = len;
    const count = idInfo + 1;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) xref += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push(`trailer\n<< /Size ${count} /Root ${idCatalog} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }
}

function n(v) { return (Math.round(v * 100) / 100).toString(); }

/* Helvetica advance widths (1000-unit em), enough for sensible wrapping. */
const W_REG = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, '{': 334, '|': 260, '}': 334, '~': 584 };
function charWidth(c, bold) {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return 556;
  if (code >= 65 && code <= 90) return bold ? 722 : 667;
  if (code >= 97 && code <= 122) return bold ? 583 : 528;
  return W_REG[c] ?? 500;
}
export function measure(str, size, bold) {
  let w = 0;
  for (const c of String(str)) w += charWidth(c, bold);
  return w * size / 1000;
}
