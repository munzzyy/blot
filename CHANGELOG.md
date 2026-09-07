# Changelog

## 0.2.0

The iOS round, and the missing codecs.

- An iOS wrapper in `ios/` on the permanent `blot://localhost` origin, with
  the redacted PDF reaching the system share sheet through a native bridge
  and a loud failure if the bridge is missing. docs/IOS.md tells the truth
  about what Android still does better.
- pdf.js 6's wasm codecs (JBIG2, JPEG 2000) are vendored and checksummed
  now; pages using them render instead of silently losing image content,
  and CI re-verifies every vendored byte on push.
- Form refusal narrowed to forms that are actually filled; blank AcroForms
  open, with fixtures proving both sides.
- The canvas tells screen readers what it is and where the accessible route
  is, refusals and errors move focus and announce, the close confirm lost
  its timer, and output filenames keep the original's stem.

## 0.1.0

First release.

- Flatten-and-verify redaction: pages render to pixels, ink burns in, and
  a brand new image-only PDF is built by a writer that has no code paths
  for text, forms, annotations, or metadata.
- Proof screen: the output is reopened and re-checked in front of you
  (text items, annotations, form fields, all zero or shown).
- Honest refusals with explanations: encrypted, filled forms, XFA,
  signed, and over-length documents.
- Page navigation, per-page ink with undo/redo, keyboard operation.
- Offline PWA; Android wrapper with zero permissions, PDF share-in and
  share-out. One vendored dependency (PDF.js), pinned and
  checksum-verified, documented in PROVENANCE.md.
