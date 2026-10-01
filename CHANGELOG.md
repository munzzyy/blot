# Changelog

## Unreleased

- Sweep and search hits land on the text on pages with a CropBox, a
  MediaBox that does not start at 0 0, a /Rotate, or text set at an angle.
  On a cropped page they used to sit 75 px off, so accepting one inked
  blank paper and left the SSN readable.
- Search and the sweep find text that pdf.js hands over in pieces, like a
  surname set in bold or an SSN broken after the second dash. The sweep
  also flags card numbers, IBANs, and SSNs written with spaces.
- Text typed onto a PDF with a viewer's text box tool is swept and
  searched too. It always ended up in the output, but nothing flagged it.
- The proof screen says how many sweep or search matches were left
  uncovered, and on which pages. It does not block Share or Save. Delete
  or Backspace on a focused suggestion dismisses it.
- Pixelating across an ink box no longer fails the export with "Something
  survived". When the coverage check does fail, it names the pages.
- Screen readers hear what a suggestion matched, such as an SSN-shaped
  match and its digits, instead of "Code suggestion".
- Spanish says tachar instead of redactar, which means to write. The
  refusal hints and the app's share hint stay in Spanish after a language
  change.
- Android: a PDF shared in from another app keeps its name in the export.
  On Android 9, saving through the picker says "Saved" instead of "Saved to
  Downloads".
- iOS: the app reports its real version and build number instead of 1.0.
- The Gradle wrapper checks the sha256 of the Gradle it downloads.

## 0.4.3

- A new icon: a black ink blot on plum, so Blot no longer looks like the
  other apps' white page on a colored square. The Android icon has a
  single-color layer too, for launchers that theme icons.

## 0.4.2

- Android: runs on Android 9. A redacted PDF is saved there through the
  system file picker, since Android 9 has no Downloads folder an app can
  write to without asking.
- Android: with an Android System WebView older than Chromium 109, Blot
  shows a plain screen asking you to update it, with a button to its store
  page, instead of a blank page. Phones with Google Play keep it current.
- Android: on Android 9, Blot says once that Google's last security fixes
  for it came out in January 2022.

## 0.4.1

- License moved from MIT to GPL-3.0-or-later.
- Android: tapping to choose a PDF did nothing, because the WebView had no
  chooser wired up. Fixed.
- Android: on an Android System WebView older than Chromium 124, PDF.js
  failed to open or render a document. Three missing browser features are
  now filled in ahead of it (Promise.withResolvers,
  ArrayBuffer.transferToFixedLength and async iteration of streams).

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
