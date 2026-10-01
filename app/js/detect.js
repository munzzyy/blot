// Suggestion engine: search the INPUT's own text layer, nothing else. No
// OCR, no guessing about what pixels say. A hit exists only where pdf.js's
// own text extraction found a string, so every rectangle this file returns
// is a SUGGESTION for a human to look at and accept, never a box that gets
// inked on its own. Two entry points share this file: free-text search
// (find-and-cover) and the preset pattern sweep that runs automatically on
// open.

// [a, b, c, d, e, f] maps (x, y) to (a*x + c*y + e, b*x + d*y + f).
function applyPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Viewport transform of an unrotated page whose MediaBox starts at 0 0.
// Real pages use pdf.js's viewport.transform, which also carries a
// CropBox, an offset origin and /Rotate.
export function pageTransform(scale, heightPt) {
  return [scale, 0, 0, -scale, 0, scale * heightPt];
}

// How far below the baseline a box reaches, in font sizes: descenders on
// g, p, y and commas hang there.
const DESCENT_EM = 0.25;

// Pixel bounding box of the stretch [t0, t1] (fractions of the advance) of
// one pdf.js text item, through the viewport transform the page rendered
// with. item.width/height are already in page points, so item.transform
// only gives the origin and directions; its font size must not apply twice.
export function itemRect(item, page, t0 = 0, t1 = 1) {
  const [a, b, c, d, e, f] = item.transform;
  const run = Math.hypot(a, b) || 1;
  const rise = Math.hypot(c, d) || 1;
  const xs = [];
  const ys = [];
  for (const s of [t0 * item.width, t1 * item.width]) {
    for (const q of [-DESCENT_EM * item.height, item.height]) {
      const [x, y] = applyPoint(page.transform, e + (s * a) / run + (q * c) / rise, f + (s * b) / run + (q * d) / rise);
      xs.push(x);
      ys.push(y);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
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
// items. page.transform must be the viewport transform renderPage used,
// or rects land in the wrong place. A match's share of an item is split
// evenly by character count, which real glyph widths do not follow; it
// is why a hit stays a suggestion instead of an auto-applied box.
export function findMatches(items, page, query) {
  const hits = [];
  const isRe = query instanceof RegExp;
  for (const item of items) {
    const str = item.str || "";
    if (!str) continue;
    const part = (from, to) => itemRect(item, page, from / str.length, to / str.length);
    if (isRe) {
      const re = new RegExp(query.source, query.flags.includes("g") ? query.flags : query.flags + "g");
      let m;
      while ((m = re.exec(str))) {
        hits.push({ rect: part(m.index, m.index + m[0].length), text: m[0] });
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      const needle = String(query).toLowerCase();
      if (!needle) continue;
      const hay = str.toLowerCase();
      let at = 0;
      let idx;
      while ((idx = hay.indexOf(needle, at)) !== -1) {
        hits.push({ rect: part(idx, idx + needle.length), text: str.slice(idx, idx + needle.length) });
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
