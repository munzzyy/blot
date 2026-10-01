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
// suggests too little costs a leak. account is the loosest of them and
// will catch plenty of non-accounts (order numbers, zip+4, page counters).
// The on-screen sweep copy itself stays generic ("N possible matches");
// this file, not the UI, is where that specific tradeoff is documented.
export const PATTERNS = {
  ssn: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  email: /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g,
  card: /\b(?:\d{4}[- ]){3}\d{4}\b|\b\d{4}[- ]\d{6}[- ]\d{5}\b/g,
  iban: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
  account: /\b\d{9,17}\b/g,
};

export const PATTERN_KEYS = Object.keys(PATTERNS);

// Items closer than this along one baseline read as one string, so a name
// whose surname switches to bold still matches. A wider gap is a column.
const JOIN_GAP_EM = 0.3;
// A gap this wide with no space character in it still reads as a space.
const SPACE_GAP_EM = 0.1;

// Gap from the end of item a to the start of item b along a's baseline,
// in page points, or null when b is not on that baseline.
function gapAlong(a, b) {
  const [a0, a1] = a.transform;
  const [b0, b1] = b.transform;
  const la = Math.hypot(a0, a1);
  const lb = Math.hypot(b0, b1);
  if (!la || !lb || (a0 * b0 + a1 * b1) / (la * lb) < 0.99) return null;
  const ux = a0 / la;
  const uy = a1 / la;
  const dx = b.transform[4] - a.transform[4];
  const dy = b.transform[5] - a.transform[5];
  const size = Math.max(a.height, b.height, 1);
  if (Math.abs(dy * ux - dx * uy) > 0.2 * size) return null;
  return dx * ux + dy * uy - a.width;
}

// Joins neighbouring items into runs of text. Whitespace collapses to one
// space; each character keeps the item and index it came from.
function textRuns(items) {
  const runs = [];
  let run = null;
  let prev = null;
  for (const item of items) {
    const str = item.str || "";
    if (!str) continue;
    const gap = prev && item.transform && prev.transform ? gapAlong(prev, item) : null;
    const size = Math.max(item.height || 0, prev?.height || 0, 1);
    if (!run || gap === null || gap < -0.5 * size || gap > JOIN_GAP_EM * size) {
      run = { text: "", lower: "", from: [] };
      runs.push(run);
    } else if (gap > SPACE_GAP_EM * size && !/\s$/.test(run.text) && !/^\s/.test(str)) {
      run.text += " ";
      run.lower += " ";
      run.from.push(null);
    }
    for (let i = 0; i < str.length; i++) {
      let ch = str[i];
      if (/\s/.test(ch)) {
        if (/\s$/.test(run.text)) continue;
        ch = " ";
      }
      const low = ch.toLowerCase();
      run.text += ch;
      run.lower += low.length === 1 ? low : ch;
      run.from.push({ item, at: i });
    }
    prev = item;
  }
  return runs;
}

// The box around characters [start, end) of a run: each item's share is
// split evenly by character count, which real glyph widths do not follow,
// so a hit stays a suggestion instead of an auto-applied box.
function runRect(run, start, end, page) {
  const spans = new Map();
  for (let i = start; i < end; i++) {
    const f = run.from[i];
    if (!f) continue;
    const span = spans.get(f.item);
    if (span) span.to = f.at + 1;
    else spans.set(f.item, { from: f.at, to: f.at + 1 });
  }
  let box = null;
  for (const [item, { from, to }] of spans) {
    const r = itemRect(item, page, from / item.str.length, to / item.str.length);
    if (!box) box = r;
    else {
      const x = Math.min(box.x, r.x);
      const y = Math.min(box.y, r.y);
      box = { x, y, w: Math.max(box.x + box.w, r.x + r.w) - x, h: Math.max(box.y + box.h, r.y + r.h) - y };
    }
  }
  return box;
}

// Every place a query (string or RegExp) occurs in a page's text items,
// including across items that sit next to each other on one baseline.
// page.transform must be the viewport transform renderPage used, or rects
// land in the wrong place.
export function findMatches(items, page, query) {
  const hits = [];
  const isRe = query instanceof RegExp;
  const needle = isRe ? "" : String(query).replace(/\s+/g, " ").trim().toLowerCase();
  if (!isRe && !needle) return hits;
  for (const run of textRuns(items)) {
    const found = [];
    if (isRe) {
      const re = new RegExp(query.source, query.flags.includes("g") ? query.flags : query.flags + "g");
      let m;
      while ((m = re.exec(run.text))) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        found.push([m.index, m.index + m[0].length]);
      }
    } else {
      let at = 0;
      let idx;
      while ((idx = run.lower.indexOf(needle, at)) !== -1) {
        found.push([idx, idx + needle.length]);
        at = idx + needle.length;
      }
    }
    for (const [start, end] of found) {
      const rect = runRect(run, start, end, page);
      if (rect) hits.push({ rect, text: run.text.slice(start, end) });
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
