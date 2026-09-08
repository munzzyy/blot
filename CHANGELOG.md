# Changelog

## 0.4.0

The blind spot in the sweep.

- Free search and the pattern sweep only ever look at a page's text
  layer. A scanned page has none, so it returned zero matches and read
  exactly like a clean page, not a page nobody checked. The editor now
  names any textless pages on open and says plainly that automatic
  search cannot read them; cover anything on those pages by hand.

## 0.3.0

Find what should be covered.

- A text-layer suggestion engine: free search finds every match, a pattern
  sweep on open flags SSN, phone, email, and account shapes. Every hit is
  a suggestion a person accepts; nothing is inked by itself, and the copy
  says plainly this finds patterns, not everything.
- Repeat a box across pages for headers, footers, and stamps. Pixelate and
  crop tools ship, with the honest warning that pixels on text are weaker
  than ink.
- The proof got teeth: a coverage check reopens the finished PDF and
  probes inside every ink box, blocking export if a single spot leaked. A
  copyable proof receipt hashes the exact exported bytes.

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
