// The writer and the fixtures are validated by poppler, a completely
// independent PDF implementation: fixtures must yield their text to
// pdftotext (proving they are real text PDFs), and writer output must
// yield nothing (proving image-only pages by construction).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPdf } from "../app/js/pdfwrite.js";
import { makeTextPdf, makeFormPdf, makeSigPdf, makeEncryptedish } from "./fixtures-pdf.mjs";

const SECRET = "SECRET-SSN-123-45-6789";

// A tiny valid JPEG: 1x1 white pixel, hard-coded bytes from libjpeg output.
const TINY_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03,
  0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
  0x06, 0x05, 0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a,
  0x0b, 0x0e, 0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c,
  0x12, 0x13, 0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0x80, 0xff, 0xd9,
]);

test("text fixture is a real PDF whose text poppler can read", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "blot-fix-"));
  try {
    const file = path.join(dir, "text.pdf");
    writeFileSync(file, makeTextPdf(["Rental dispute summary", SECRET, "and a third line"]));
    const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
    assert.ok(text.includes(SECRET), text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writer output opens in poppler and yields zero text", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "blot-out-"));
  try {
    const pdf = buildPdf([
      { jpeg: TINY_JPEG, width: 1, height: 1, widthPt: 612, heightPt: 792 },
      { jpeg: TINY_JPEG, width: 1, height: 1, widthPt: 595, heightPt: 842 },
    ]);
    const file = path.join(dir, "out.pdf");
    writeFileSync(file, pdf);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    assert.match(info, /Pages:\s+2/);
    const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
    assert.equal(text.trim(), "");
    // No metadata either: poppler shows no Producer/Author/Title lines.
    assert.ok(!/Producer:|Author:|Title:.*\S/.test(info.replace(/Title:\s*\n/, "Title:\n")), info);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("form and signature fixtures carry what the app must refuse", () => {
  const form = new TextDecoder("latin1").decode(makeFormPdf());
  assert.ok(form.includes("/AcroForm"));
  assert.ok(form.includes("/FT /Tx"));
  const sig = new TextDecoder("latin1").decode(makeSigPdf());
  assert.ok(sig.includes("/FT /Sig"));
  const locked = new TextDecoder("latin1").decode(makeEncryptedish());
  assert.ok(locked.includes("/Encrypt"));
});
