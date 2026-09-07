// Reading side: PDF.js behind a gate. Documents Blot cannot honestly
// flatten are refused with a reason, never half-handled, because a
// redactor that guesses is worse than none.

import * as pdfjs from "../vendor/pdfjs/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;

// JBIG2 and JPEG2000 pages decode through these; without a wasmUrl the
// worker's fetch for jbig2.wasm/openjpeg.wasm fails silently and the page
// image comes back blank. Trailing slash required: pdf.js rejects a
// factory URL without one.
const WASM_URL = new URL("../vendor/pdfjs/wasm/", import.meta.url).href;

export const MAX_PAGES = 60;

// ~150 DPI equivalent. Shared by renderPage and anything that has to
// reopen the finished output and land on the exact same pixel grid the
// editor drew boxes in (the coverage check, the text-layer search).
export const RENDER_SCALE = 150 / 72;

// A blank AcroForm field renders as whatever its normal appearance stream
// shows (usually just an outline box) and flattens exactly like any other
// page content: nothing outside the page stream to lose. Only a FILLED
// field carries content that lives outside the page image, which is the
// actual risk the refusal exists for, so refuse on the value, not the
// widget's mere presence.
function isFilledValue(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some((x) => x != null && x !== "" && x !== "Off");
  if (typeof v === "string") return v !== "" && v !== "Off";
  return true;
}

// Widget annotations are the reliable field signal: the field-tree API can
// come back empty for documents whose widgets parse fine.
async function scanForFields(doc) {
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget") continue;
      if (a.fieldType === "Sig") return "signed";
      if (isFilledValue(a.fieldValue)) return "forms";
    }
  }
  const fields = await doc.getFieldObjects();
  if (fields && Object.keys(fields).length > 0) {
    for (const list of Object.values(fields)) {
      if (list.some((f) => f.type === "signature")) return "signed";
      if (list.some((f) => isFilledValue(f.fieldValue))) return "forms";
    }
  }
  return null;
}

// -> { doc, task, pages } or { refusal: "encrypted"|"xfa"|"signed"|"forms"|"toolong"|"unreadable" }
export async function loadPdf(bytes) {
  // enableXfa makes isPureXfa trustworthy; without it the XFA gate is
  // dead code and dynamic forms sail through half-rendered.
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: true, wasmUrl: WASM_URL });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err?.name === "PasswordException") return { refusal: "encrypted" };
    return { refusal: "unreadable" };
  }
  try {
    if (doc.isPureXfa) {
      await task.destroy();
      return { refusal: "xfa" };
    }
    if (doc.numPages > MAX_PAGES) {
      await task.destroy();
      return { refusal: "toolong" };
    }
    const fieldRefusal = await scanForFields(doc);
    if (fieldRefusal) {
      await task.destroy();
      return { refusal: fieldRefusal };
    }
  } catch {
    await task.destroy().catch(() => {});
    return { refusal: "unreadable" };
  }
  return { doc, task, pages: doc.numPages };
}

// Renders one page into a fresh canvas at ~150 DPI equivalent, and reports
// the page's physical size in points so the output preserves it. Also
// pulls the page's own text content while the pdf.js task is still alive
// (main.js destroys it right after this render loop finishes), so the
// suggestion engine has something to search without reopening the file.
export async function renderPage(doc, pageNum, scale = RENDER_SCALE) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const base = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  return { canvas, widthPt: base.width, heightPt: base.height, textItems: textContent.items, scale };
}

// The proof step: reopen the finished bytes and count everything that
// should not exist. Zero text items, zero annotations, zero form fields.
export async function verifyOutput(bytes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    await task.destroy().catch(() => {});
    return { ok: false, reason: "unreadable" };
  }
  let textItems = 0;
  let annotations = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    textItems += (await page.getTextContent()).items.length;
    annotations += (await page.getAnnotations()).length;
  }
  const fields = await doc.getFieldObjects();
  const formFields = fields ? Object.keys(fields).length : 0;
  const pages = doc.numPages;
  await task.destroy();
  return {
    ok: textItems === 0 && annotations === 0 && formFields === 0,
    pages,
    textItems,
    annotations,
    formFields,
  };
}

// Probe points inset from a box's edges, so a probe never lands on a
// JPEG's ringing artifacts at a hard ink/background boundary.
const PROBE_INSET = 3;
function probePoints(rect) {
  const x0 = Math.min(rect.w / 2, PROBE_INSET);
  const y0 = Math.min(rect.h / 2, PROBE_INSET);
  return [
    [rect.x + x0, rect.y + y0],
    [rect.x + rect.w - x0, rect.y + y0],
    [rect.x + x0, rect.y + rect.h - y0],
    [rect.x + rect.w - x0, rect.y + rect.h - y0],
    [rect.x + rect.w / 2, rect.y + rect.h / 2],
  ];
}

export const isDarkPixel = (r, g, b) => r < 60 && g < 60 && b < 60;

// The proof screen claims ink covered something; this closes the gap
// between that claim and the actual output bytes by reopening the
// finished PDF, rendering each page that has ink boxes, and sampling
// pixels inside every box. perPageBoxes[n] is the array of pixel rects
// (in the SAME space bake() drew into: full editor pixels, minus the
// crop offset) that must be solid ink on page n+1 of the output. Pages
// with no boxes to check are never rendered. Each page's canvas is
// released before the next one renders, so this stays flat in memory
// across a 60-page document instead of holding every page at once.
export async function checkCoverage(bytes, perPageBoxes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const boxes = perPageBoxes[n - 1] || [];
      if (!boxes.length) {
        pages.push({ page: n, ok: true, checked: 0 });
        continue;
      }
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      let ok = true;
      let checked = 0;
      for (const box of boxes) {
        for (const [px, py] of probePoints(box)) {
          const x = Math.round(Math.min(canvas.width - 1, Math.max(0, px)));
          const y = Math.round(Math.min(canvas.height - 1, Math.max(0, py)));
          const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
          checked++;
          if (!isDarkPixel(r, g, b)) ok = false;
        }
      }
      pages.push({ page: n, ok, checked });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await task.destroy();
  }
  return { ok: pages.every((p) => p.ok), pages };
}
