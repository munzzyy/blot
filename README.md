# Blot

Redaction that destroys what it covers.

The redaction failures that make the news share one anatomy: a black
rectangle drawn over text that was still in the file. Copy, paste, and
the "redacted" names are on the clipboard. Courts have done it, law firms
have done it, government agencies keep doing it, because most PDF tools
treat redaction as decoration.

Blot treats it as demolition. Your document's pages are rendered to plain
pixels, your ink is painted into those pixels, and a brand new PDF is
built containing only the pictures. There is no text layer in the output
because there is no text in it at all, no annotations, no form data, no
attachments, no metadata, no earlier versions. The finished file is then
reopened and re-checked in front of you: zero extractable text items,
zero annotations, zero form fields, or you see exactly what survived.

Documents Blot cannot flatten honestly get refused with an explanation,
not half-handled: password-protected files, filled forms, XFA, and
digitally signed documents each get told why and what to do instead. The
trade is stated plainly too: the output is a picture of a document. It
prints and reads fine; it is not editable and not searchable. That is
the cost of certain.

## Check the claims

`npm test` validates the PDF writer against poppler, a completely
independent implementation: image-only output must yield zero text to
pdftotext. `npm run e2e` goes end to end: a real PDF with a planted
secret goes in, ink goes over it, and the output is checked outside the
app three ways: pdftotext extracts nothing, the secret string exists
nowhere in the raw output bytes, and the re-rendered page is probed to
confirm the ink is really there. The Android APK requests no permissions.

One dependency, on purpose: Mozilla's PDF.js reads the input, vendored at
a pinned version whose checksum is verified against the npm registry.
Provenance and re-verification steps: `app/vendor/pdfjs/PROVENANCE.md`.
Everything else, including the PDF writer, is dependency-free.

## Run it

Web: serve `app/` from any static host, or `node test/serve_local.mjs`
locally. Android: `cd android && ./gradlew assembleRelease`.

MIT (PDF.js is Apache-2.0).
