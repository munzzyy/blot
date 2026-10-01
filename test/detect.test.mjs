// Pure geometry and pattern matching, no pdf.js or DOM needed: items are
// hand-built the same shape pdf.js's getTextContent() returns.

import test from "node:test";
import assert from "node:assert/strict";
import { pageTransform, itemRect, findMatches, sweepPatterns, PATTERNS, isTextless } from "../app/js/detect.js";

const SCALE = 150 / 72;
const PAGE = { transform: pageTransform(SCALE, 792) };

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
// 792pt-tall page, rendered at 150/72 scale. The box runs from one font
// size above the baseline to a quarter of one below it.
test("itemRect does not double-apply the item's own font-size scale", () => {
  const it = { str: "x", width: 149.376, height: 12, transform: [12, 0, 0, 12, 50, 680] };
  const r = itemRect(it, PAGE);
  assert.ok(Math.abs(r.x - 104.17) < 0.5, JSON.stringify(r));
  assert.ok(Math.abs(r.y - 208.33) < 0.5, JSON.stringify(r));
  assert.ok(Math.abs(r.w - 311.2) < 1, JSON.stringify(r));
  assert.ok(Math.abs(r.h - 31.25) < 0.5, JSON.stringify(r));
});

test("itemRect splits along the advance and never collapses to zero width", () => {
  const it = { str: "x", width: 48, height: 12, transform: [12, 0, 0, 12, 0, 792] };
  const page = { transform: pageTransform(1, 792) };
  const r = itemRect(it, page, 0.25, 0.75);
  assert.equal(r.x, 12);
  assert.equal(r.w, 24);
  const zero = itemRect(it, page, 0.5, 0.5);
  assert.ok(zero.w >= 1);
});

test("itemRect follows rotated text: text running up the page gets a tall box", () => {
  const it = { str: "x", width: 100, height: 10, transform: [0, 10, -10, 0, 300, 200] };
  const r = itemRect(it, { transform: pageTransform(1, 792) });
  assert.ok(r.h > r.w * 5, JSON.stringify(r));
  assert.ok(Math.abs(r.x - 290) < 0.01 && Math.abs(r.y - 492) < 0.01, JSON.stringify(r));
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
