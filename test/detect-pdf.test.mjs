// The sweep through real pdf.js text items on pages whose geometry is not
// the plain case: a CropBox, a MediaBox that does not start at 0 0, a
// /Rotate, rotated text. poppler says where the word really is.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "../app/vendor/pdfjs/pdf.mjs";
import { sweepPatterns } from "../app/js/detect.js";
import { makeTextPdf, makeCropBoxPdf, makeOffsetOriginPdf, makeRotatedPagePdf, makeRotatedTextPdf } from "./fixtures-pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(new URL("../app/vendor/pdfjs/pdf.worker.mjs", import.meta.url));

const SCALE = 150 / 72;
const SECRET = "SECRET-SSN-123-45-6789";
// Helvetica advance widths: "SECRET-SSN-" is 6778 of the line's 12448 units.
const SSN_STARTS_AT = 6778 / 12448;

// The same shape renderPage hands to the sweep.
async function renderInfo(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const base = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    return { items, scale: SCALE, widthPt: base.width, heightPt: base.height, transform: viewport.transform };
  } finally {
    await task.destroy();
  }
}

// poppler's box for the word holding the SSN, in the rendered page's pixels.
function popplerWord(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), "blot-detect-"));
  try {
    const file = path.join(dir, "in.pdf");
    writeFileSync(file, bytes);
    const xml = execFileSync("pdftotext", ["-cropbox", "-bbox", file, "-"], { encoding: "utf8" });
    const m = xml.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">[^<]*123-45-6789<\/word>/);
    assert.ok(m, xml);
    const [x0, y0, x1, y1] = m.slice(1).map((v) => Number(v) * SCALE);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Where the SSN's own glyphs sit inside that word, given which way the text runs on screen.
function ssnSpan(word, runs) {
  const k = SSN_STARTS_AT;
  if (runs === "right") return { ...word, x: word.x + word.w * k, w: word.w * (1 - k) };
  if (runs === "down") return { ...word, y: word.y + word.h * k, h: word.h * (1 - k) };
  return { ...word, h: word.h * (1 - k) };
}

const inside = (inner, outer, pad) =>
  inner.x >= outer.x - pad &&
  inner.y >= outer.y - pad &&
  inner.x + inner.w <= outer.x + outer.w + pad &&
  inner.y + inner.h <= outer.y + outer.h + pad;

const cases = [
  ["plain page", makeTextPdf([SECRET]), "right"],
  ["CropBox inside the MediaBox", makeCropBoxPdf(SECRET), "right"],
  ["MediaBox that starts at 100 100", makeOffsetOriginPdf(SECRET), "right"],
  ["/Rotate 90", makeRotatedPagePdf(SECRET), "down"],
  ["text set running up the page", makeRotatedTextPdf(SECRET), "up"],
];

for (const [name, bytes, runs] of cases) {
  test(`sweep hit sits on the SSN: ${name}`, async () => {
    const info = await renderInfo(bytes);
    const hits = sweepPatterns(info.items, info).filter((h) => h.pattern === "ssn");
    assert.equal(hits.length, 1, JSON.stringify(hits));
    const hit = hits[0].rect;
    const word = popplerWord(bytes);
    // The box reaches a full font size above the baseline, poppler's word stops at the ascent: 7 px at this scale.
    assert.ok(inside(hit, word, 8), `hit ${JSON.stringify(hit)} not on word ${JSON.stringify(word)}`);
    const ssn = ssnSpan(word, runs);
    assert.ok(inside(ssn, hit, 1), `ssn ${JSON.stringify(ssn)} not covered by ${JSON.stringify(hit)}`);
  });
}

// Recorded from the plain fixture before the geometry moved to the viewport
// transform: x, y and width stay put, the height gained the descent.
test("plain page hit matches the old geometry, plus the descent", async () => {
  const info = await renderInfo(makeTextPdf(["Rental dispute summary", SECRET, "The unit was inspected."]));
  const [hit] = sweepPatterns(info.items, info).filter((h) => h.pattern === "ssn");
  const head = { x: 259.7667, y: 208.3333, w: 155.6, h: 25 };
  assert.ok(Math.abs(hit.rect.x - head.x) < 1, JSON.stringify(hit.rect));
  assert.ok(Math.abs(hit.rect.y - head.y) < 1, JSON.stringify(hit.rect));
  assert.ok(Math.abs(hit.rect.w - head.w) < 1, JSON.stringify(hit.rect));
  assert.ok(Math.abs(hit.rect.h - (head.h + 0.25 * 12 * SCALE)) < 1, JSON.stringify(hit.rect));
});
