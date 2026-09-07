# Changelog

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
