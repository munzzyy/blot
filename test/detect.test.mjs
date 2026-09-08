// Pure geometry and pattern matching, no pdf.js or DOM needed: items are
// hand-built the same shape pdf.js's getTextContent() returns.

import test from "node:test";
import assert from "node:assert/strict";
import { combine, pageTransform, itemRect, subRect, findMatches, sweepPatterns, PATTERNS, isTextless } from "../app/js/detect.js";

const SCALE = 150 / 72;
const PAGE = { scale: SCALE, heightPt: 792 };

// A pdf.js text item at PDF-space origin (x, y). Matches real pdf.js
// shape: item.transform bakes the font size into its own a/d (NOT 1),
// while item.width/height are already in plain page-point units, the
// same space item.transform's own e/f translation lives in. A fixture
// that used an identity transform here would hide the exact bug that
// shipped once: multiplying width/height through the item's own font
// matrix a second time.
function item(str, x, y, fontSize = 12, widthPerChar = 7) {
  return { str, width: str.length * widthPerChar, height: fontSize, transform: [fontSize, 0, 0, fontSize, x, y] };
}

test("combine matches manual matrix multiplication", () => {
  const outer = [2, 0, 0, 2, 10, 10];
  const inner = [1, 0, 0, 1, 3, 4];
  assert.deepEqual(combine(outer, inner), [2, 0, 0, 2, 2 * 3 + 10, 2 * 4 + 10]);
});

test("pageTransform flips y and applies scale", () => {
  const m = pageTransform(2, 100);
  // A point at the bottom of the page (y=0) must land at pixel y = 200
  // (page height * scale); a point at the top (y=100) must land at 0.
  assert.deepEqual(m, [2, 0, 0, -2, 0, 200]);
});

test("itemRect places text near the top of the page near pixel y = 0", () => {
  const it = item("hello", 50, 700); // near the top of a 792pt page
  const r = itemRect(it, PAGE);
  assert.ok(r.x > 0 && r.y > 0, JSON.stringify(r));
  assert.ok(r.y < (792 * SCALE) / 2, JSON.stringify(r));
});

test("itemRect places text near the bottom of the page near pixel y = pageHeight", () => {
  const it = item("hello", 50, 40); // near the bottom
  const r = itemRect(it, PAGE);
  assert.ok(r.y > (792 * SCALE) / 2, JSON.stringify(r));
});

// Regression: item.width/height must be scaled by the OUTER page->pixel
// transform only, never by item.transform's own font-size scale a second
// time. That bug once threw every rect thousands of pixels off-canvas and
// silently dropped every accepted suggestion (normRect clamped it to
// nothing). Numbers below are hand-computed from a real pdf.js item this
// exact fixture matches: "SECRET-SSN-123-45-6789" at (50, 680) on a
// 792pt-tall page, rendered at 150/72 scale.
test("itemRect does not double-apply the item's own font-size scale", () => {
  const page = { scale: 150 / 72, heightPt: 792 };
  const it = { str: "x", width: 149.376, height: 12, transform: [12, 0, 0, 12, 50, 680] };
  const r = itemRect(it, page);
  assert.ok(Math.abs(r.x - 104.17) < 0.5, JSON.stringify(r));
  assert.ok(Math.abs(r.y - 208.33) < 0.5, JSON.stringify(r));
  assert.ok(Math.abs(r.w - 311.2) < 1, JSON.stringify(r));
  assert.ok(Math.abs(r.h - 25) < 0.5, JSON.stringify(r));
});

test("subRect splits proportionally and never collapses to zero width", () => {
  const rect = { x: 0, y: 0, w: 100, h: 10 };
  const r = subRect(rect, 5, 10, 20);
  assert.equal(r.x, 25);
  assert.equal(r.w, 25);
  const zero = subRect(rect, 3, 3, 20);
  assert.ok(zero.w >= 1);
});

test("findMatches: plain-text search is case-insensitive and finds repeats", () => {
  const items = [item("Case CASE case", 0, 0)];
  const hits = findMatches(items, PAGE, "case");
  assert.equal(hits.length, 3);
});

test("findMatches: no query, no hits", () => {
  const items = [item("anything at all", 0, 0)];
  assert.equal(findMatches(items, PAGE, "").length, 0);
});

// -------------------------------------------------------------- patterns

const cases = {
  ssn: { hit: "SSN on file: 123-45-6789 end", miss: "not an ssn: 123-456-789" },
  phone: { hit: "call (415) 555-0132 now", miss: "not a phone: 55-0132" },
  email: { hit: "reach me at jane.doe@example.com please", miss: "no at-sign here.example.com" },
  account: { hit: "acct 00481293754 on file", miss: "short 12345 code" },
};

for (const [name, { hit, miss }] of Object.entries(cases)) {
  test(`pattern ${name}: true case matches`, () => {
    const items = [item(hit, 0, 0)];
    const hits = findMatches(items, PAGE, PATTERNS[name]);
    assert.ok(hits.length >= 1, JSON.stringify(hits));
  });
  test(`pattern ${name}: false case does not match`, () => {
    const items = [item(miss, 0, 0)];
    const hits = findMatches(items, PAGE, PATTERNS[name]);
    assert.equal(hits.length, 0, JSON.stringify(hits));
  });
}

test("sweepPatterns runs every preset and tags each hit with its pattern key", () => {
  const items = [item("ssn 123-45-6789 and email a@b.com", 0, 0)];
  const hits = sweepPatterns(items, PAGE);
  const keys = new Set(hits.map((h) => h.pattern));
  assert.ok(keys.has("ssn"));
  assert.ok(keys.has("email"));
});

test("sweepPatterns can be scoped to a subset of keys", () => {
  const items = [item("ssn 123-45-6789 and email a@b.com", 0, 0)];
  const hits = sweepPatterns(items, PAGE, ["email"]);
  assert.ok(hits.every((h) => h.pattern === "email"));
  assert.ok(hits.length >= 1);
});

test("isTextless is true for a scanned page's empty item array", () => {
  assert.equal(isTextless([]), true);
});

test("isTextless is true when every item is whitespace only", () => {
  assert.equal(isTextless([{ str: "  " }, { str: "\n\t" }, { str: "" }]), true);
});

test("isTextless is false as soon as one item carries real text", () => {
  assert.equal(isTextless([{ str: "   " }, item("hello", 0, 0)]), false);
});
