// Suggestion engine: search the INPUT's own text layer, nothing else. No
// OCR, no guessing about what pixels say. A hit exists only where pdf.js's
// own text extraction found a string, so every rectangle this file returns
// is a SUGGESTION for a human to look at and accept, never a box that gets
// inked on its own. Two entry points share this file: free-text search
// (find-and-cover) and the preset pattern sweep that runs automatically on
// open.

// Combines two PDF-style 2x3 affine matrices. [a, b, c, d, e, f] maps
// (x, y) -> (a*x + c*y + e, b*x + d*y + f).
export function combine(outer, inner) {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function applyPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Same transform pdf.js's own TextLayer builder uses to place its DOM
// spans: unscaled page space (points, y pointing up) flipped to canvas
// space (y pointing down) and scaled to the same pixel scale renderPage
// used. Assumes the page's own coordinate origin is (0, 0), which is true
// for the overwhelming majority of PDFs; a nonzero MediaBox origin would
// shift every rect by a constant offset, a known limitation.
export function pageTransform(scale, heightPt) {
  return [scale, 0, 0, -scale, 0, scale * heightPt];
}

// Bounding box of one pdf.js text item, in the same pixel space the page
// canvas was rendered into. `page` is { scale, heightPt }, the same scale
// and (unscaled) page height renderPage used.
//
// item.width/item.height are NOT vectors in item.transform's own basis:
// pdf.js already reports them in page-point units (the same units as
// item.transform's own translation, e/f), so they only need the OUTER
// page-to-pixel scale applied, never item.transform's own font-size
// scale (a/b/c/d) a second time. Multiplying them through the full
// combined matrix double-applies the font size and throws every rect
// wildly off; item.transform is used here only for the item's ORIGIN
// (its translation), which the linear part does not affect.
export function itemRect(item, page) {
  const outer = pageTransform(page.scale, page.heightPt);
  const origin = applyPoint(combine(outer, item.transform), 0, 0);
  const scaleFactor = Math.hypot(outer[0], outer[1]);
  const w = item.width * scaleFactor;
  const h = item.height * scaleFactor;
  // Unrotated text (the overwhelming common case): the baseline start
  // sits at `origin`, and the glyph box extends rightward by w and
  // upward (toward smaller pixel y) by h. Rotated text would need the
  // item's own angle worked in too; a known limitation, same as a
  // nonzero MediaBox origin.
  return { x: origin[0], y: origin[1] - h, w, h };
}

// A sub-range of an item's own box, splitting its width evenly across its
// character count. Real glyphs are not evenly spaced, so this is an
// approximation, not exact metrics; it is why a hit stays a suggestion
// instead of an auto-applied box.
export function subRect(rect, start, end, len) {
  if (len <= 0 || end <= start) return rect;
  const x0 = rect.x + (rect.w * start) / len;
  const x1 = rect.x + (rect.w * end) / len;
  return { x: x0, y: rect.y, w: Math.max(1, x1 - x0), h: rect.h };
}

// Empty or whitespace-only text items: the sweep and search find nothing here no matter what the page shows.
export function isTextless(items) {
  return !items || items.every((it) => !(it.str || "").trim());
}

// Preset patterns for the automatic sweep. Loose on purpose: a redaction
// tool that suggests too much costs a rejected suggestion; one that
// suggests too little costs a leak. account is the loosest of the four and
// will catch plenty of non-accounts (order numbers, zip+4, page counters).
// The on-screen sweep copy itself stays generic ("N possible matches");
// this file, not the UI, is where that specific tradeoff is documented.
export const PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  email: /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g,
  account: /\b\d{9,17}\b/g,
};

export const PATTERN_KEYS = Object.keys(PATTERNS);

// Every place a query (string or RegExp) occurs inside a page's text
// items. page: { scale, heightPt }, the same scale and page height
// renderPage used, or rects land in the wrong place.
export function findMatches(items, page, query) {
  const hits = [];
  const isRe = query instanceof RegExp;
  for (const item of items) {
    const str = item.str || "";
    if (!str) continue;
    const rect = itemRect(item, page);
    if (isRe) {
      const re = new RegExp(query.source, query.flags.includes("g") ? query.flags : query.flags + "g");
      let m;
      while ((m = re.exec(str))) {
        hits.push({ rect: subRect(rect, m.index, m.index + m[0].length, str.length), text: m[0] });
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      const needle = String(query).toLowerCase();
      if (!needle) continue;
      const hay = str.toLowerCase();
      let at = 0;
      let idx;
      while ((idx = hay.indexOf(needle, at)) !== -1) {
        hits.push({ rect: subRect(rect, idx, idx + needle.length, str.length), text: str.slice(idx, idx + needle.length) });
        at = idx + needle.length;
      }
    }
  }
  return hits;
}

// Runs every preset pattern (or a subset) over one page's text items.
export function sweepPatterns(items, page, keys = PATTERN_KEYS) {
  const hits = [];
  for (const key of keys) {
    for (const hit of findMatches(items, page, PATTERNS[key])) {
      hits.push({ ...hit, pattern: key });
    }
  }
  return hits;
}
