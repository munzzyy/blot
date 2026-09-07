// bakedOpRect/cropOutRect are pure geometry (no canvas needed), split out
// of bake() so the coverage check in main.js can agree with bake() about
// exactly where an op landed, instead of re-deriving its own version of
// the same math and drifting from it.

import test from "node:test";
import assert from "node:assert/strict";
import { createEditor, setCrop, outputRect } from "../app/js/editor.js";
import { cropOutRect, bakedOpRect } from "../app/js/render.js";

test("cropOutRect is the full canvas with no crop", () => {
  const ed = createEditor(100, 200);
  assert.deepEqual(cropOutRect(ed), { x: 0, y: 0, w: 100, h: 200 });
});

test("cropOutRect snaps a fractional crop inward", () => {
  const ed = createEditor(100, 200);
  setCrop(ed, { x: 10.4, y: 20.9, w: 60, h: 80 });
  const out = cropOutRect(ed);
  assert.equal(out.x, Math.ceil(10.4));
  assert.equal(out.y, Math.ceil(20.9));
});

test("bakedOpRect returns the full rect, offset by the crop origin, for an in-frame box", () => {
  const out = { x: 0, y: 0, w: 100, h: 100 };
  const op = { rect: { x: 10, y: 10, w: 20, h: 20 } };
  const r = bakedOpRect(op, out, 100, 100);
  assert.deepEqual(r, { x: 10, y: 10, w: 20, h: 20 });
});

// The exact regression this guards: a crop can push an ink box fully off
// the kept frame. bake() already skips drawing it there; the coverage
// check must agree, or a stray cropped-away box reads as "something
// survived" for content that was never in the output at all.
test("bakedOpRect returns null for a box entirely outside the cropped frame", () => {
  const editor = createEditor(300, 300);
  setCrop(editor, { x: 0, y: 0, w: 100, h: 100 }); // keep only the top-left corner
  const outsideBox = { rect: { x: 150, y: 150, w: 30, h: 30 } }; // well outside the kept area
  const out = outputRect(editor);
  const r = bakedOpRect(outsideBox, out, 100, 100);
  assert.equal(r, null);
});

test("bakedOpRect clips a partially in-frame box to the canvas bounds instead of returning off-canvas coordinates", () => {
  const out = { x: 0, y: 0, w: 100, h: 100 };
  const op = { rect: { x: 90, y: 90, w: 30, h: 30 } }; // hangs off the bottom-right edge
  const r = bakedOpRect(op, out, 100, 100);
  assert.ok(r, "should still be reported: part of it is in frame");
  assert.ok(r.x + r.w <= 100 && r.y + r.h <= 100, JSON.stringify(r));
});

test("bakedOpRect offsets by a nonzero crop origin the same way bake() draws", () => {
  const editor = createEditor(300, 300);
  setCrop(editor, { x: 50, y: 60, w: 100, h: 100 });
  const out = outputRect(editor);
  const op = { rect: { x: 70, y: 80, w: 20, h: 20 } }; // inside the kept crop area
  const r = bakedOpRect(op, out, 100, 100);
  assert.ok(r);
  assert.equal(r.x, 70 - Math.ceil(50));
  assert.equal(r.y, 80 - Math.ceil(60));
});
