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

// ------------------------------------------------- text split across items

// Helvetica widths at 12 pt: "Patient: John" is 69.804, a space 3.336,
// "Smith" in Helvetica-Bold 33.336.
const patient = [
  { str: "Patient: John", width: 69.804, height: 12, transform: [12, 0, 0, 12, 50, 700] },
  { str: " ", width: 3.336, height: 12, transform: [12, 0, 0, 12, 119.804, 700] },
  { str: "Smith", width: 33.336, height: 12, transform: [12, 0, 0, 12, 123.14, 700] },
];

test("findMatches: a name split across items on one baseline is one hit", () => {
  const hits = findMatches(patient, PAGE, "John Smith");
  assert.equal(hits.length, 1, JSON.stringify(hits));
  const john = itemRect(patient[0], PAGE, 9 / 13, 1);
  const smith = itemRect(patient[2], PAGE);
  const r = hits[0].rect;
  assert.ok(Math.abs(r.x - john.x) < 0.01, JSON.stringify({ r, john }));
  assert.ok(Math.abs(r.x + r.w - (smith.x + smith.w)) < 0.01, JSON.stringify({ r, smith }));
  assert.equal(hits[0].text, "John Smith");
});

test("findMatches: runs of spaces in the query match a single space", () => {
  assert.equal(findMatches(patient, PAGE, "John  Smith").length, 1);
});

test("sweepPatterns: an SSN split across two items is one hit", () => {
  const items = [item("SSN 123-45-", 50, 700), item("6789", 50 + 11 * 7, 700)];
  const hits = sweepPatterns(items, PAGE).filter((h) => h.pattern === "ssn");
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].text, "123-45-6789");
});

test("sweepPatterns: items far apart on one baseline never join", () => {
  const items = [item("Total 123", 50, 700), item("45-6789", 300, 700)];
  assert.equal(sweepPatterns(items, PAGE).filter((h) => h.pattern === "ssn").length, 0);
});

test("findMatches: a gap narrower than a space joins with a space between", () => {
  const items = [item("John", 50, 700), item("Smith", 50 + 4 * 7 + 2, 700)];
  assert.equal(findMatches(items, PAGE, "john smith").length, 1);
});

test("sweepPatterns: the same text on the next line down does not join", () => {
  const items = [item("SSN 123-45-", 50, 700), item("6789", 50 + 11 * 7, 686)];
  assert.equal(sweepPatterns(items, PAGE).filter((h) => h.pattern === "ssn").length, 0);
});

// -------------------------------------------------------------- patterns

const cases = {
  ssn: { hit: "SSN on file: 123-45-6789 end", miss: "not an ssn: 123-456-789" },
  phone: { hit: "call (415) 555-0132 now", miss: "not a phone: 55-0132" },
  email: { hit: "reach me at jane.doe@example.com please", miss: "no at-sign here.example.com" },
  card: { hit: "card 4111 1111 1111 1111 exp 09/29", miss: "ref 4111 1111 1111 only" },
  iban: { hit: "IBAN ES91 2100 0418 4502 0005 1332 please", miss: "code AB12 3456 only" },
  account: { hit: "acct 00481293754 on file", miss: "short 12345 code" },
};

for (const [name, text] of [
  ["card", "4111 1111 1111 1111"],
  ["card", "4111-1111-1111-1111"],
  ["card", "3782 822463 10005"],
  ["iban", "ES91 2100 0418 4502 0005 1332"],
  ["iban", "GB29NWBK60161331926819"],
  ["ssn", "123 45 6789"],
]) {
  test(`pattern ${name} matches ${text}`, () => {
    const hits = findMatches([item(text, 0, 0)], PAGE, PATTERNS[name]);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].text, text);
  });
}

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
