// Reading side: PDF.js behind a gate. Documents Blot cannot honestly
// flatten are refused with a reason, never half-handled, because a
// redactor that guesses is worse than none.

import * as pdfjs from "../vendor/pdfjs/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;

export const MAX_PAGES = 60;

// Widget annotations are the reliable field signal: the field-tree API can
// come back empty for documents whose widgets parse fine.
async function scanForFields(doc) {
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget") continue;
      if (a.fieldType === "Sig") return "signed";
      return "forms";
    }
  }
  const fields = await doc.getFieldObjects();
  if (fields && Object.keys(fields).length > 0) {
    for (const list of Object.values(fields)) {
      if (list.some((f) => f.type === "signature")) return "signed";
    }
    return "forms";
  }
  return null;
}

// -> { doc, task, pages } or { refusal: "encrypted"|"xfa"|"signed"|"forms"|"toolong"|"unreadable" }
export async function loadPdf(bytes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
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
// the page's physical size in points so the output preserves it.
export async function renderPage(doc, pageNum, scale = 150 / 72) {
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
  return { canvas, widthPt: base.width, heightPt: base.height };
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
