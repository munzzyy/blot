// Pure geometry, no canvas or DOM: node's test runner exercises all of it
// directly.

import test from "node:test";
import assert from "node:assert/strict";
import { createEditor, addOp, setCrop, outputRect, cropOffset, repeatAcrossPages, paintOps, padToMinSize, MIN_SIZE } from "../app/js/editor.js";

test("cropOffset is (0,0) with no crop", () => {
  const ed = createEditor(100, 200);
  assert.deepEqual(cropOffset(ed), { x: 0, y: 0 });
});

test("cropOffset matches the ceil-snapped crop origin bake() uses", () => {
  const ed = createEditor(100, 200);
  setCrop(ed, { x: 10.4, y: 20.9, w: 60, h: 80 });
  assert.deepEqual(cropOffset(ed), { x: Math.ceil(10.4), y: Math.ceil(20.9) });
});

test("repeatAcrossPages clones a box onto every target at the same relative spot", () => {
  const source = createEditor(100, 100);
  const targetA = createEditor(100, 100); // same size
  const targetB = createEditor(200, 100); // double width
  const rect = { x: 10, y: 10, w: 20, h: 10 };
  const results = repeatAcrossPages(
    rect,
    { width: 100, height: 100 },
    "ink",
    [
      { index: 1, editor: targetA },
      { index: 2, editor: targetB },
    ],
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.applied));
  assert.ok(results.every((r) => !r.clamped));
  assert.equal(paintOps(targetA).length, 1);
  assert.deepEqual(paintOps(targetA)[0].rect, rect);
  // targetB is 2x the width: the box should have scaled proportionally.
  const bRect = paintOps(targetB)[0].rect;
  assert.equal(bRect.x, 20);
  assert.equal(bRect.w, 40);
  assert.equal(bRect.y, 10);
});

test("repeatAcrossPages reports clamped:true when a target is too small to hold the scaled box", () => {
  const rect = { x: 90, y: 90, w: 20, h: 20 }; // runs off a 100x100 source
  const tiny = createEditor(50, 50);
  const results = repeatAcrossPages(rect, { width: 100, height: 100 }, "ink", [{ index: 0, editor: tiny }]);
  assert.equal(results[0].clamped, true);
});

test("repeatAcrossPages reports applied:false when the scaled box is too small to place", () => {
  const rect = { x: 0, y: 0, w: 2, h: 2 }; // below addOp's MIN_SIZE once shrunk further
  const target = createEditor(100, 100);
  const results = repeatAcrossPages(rect, { width: 1000, height: 1000 }, "ink", [{ index: 0, editor: target }]);
  assert.equal(results[0].applied, false);
});

// ------------------------------------------------------------- padToMinSize

test("padToMinSize leaves a rect already at or above MIN_SIZE unchanged", () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };
  assert.deepEqual(padToMinSize(rect, 100, 100), rect);
});

test("padToMinSize grows a too-thin rect up to MIN_SIZE, centered on the same middle point", () => {
  const rect = { x: 50, y: 50, w: 1, h: 1 };
  const padded = padToMinSize(rect, 200, 200);
  assert.ok(padded.w >= MIN_SIZE && padded.h >= MIN_SIZE, JSON.stringify(padded));
  // Center should stay put: 50 + 1/2 = 50.5.
  assert.ok(Math.abs(padded.x + padded.w / 2 - 50.5) < 0.01, JSON.stringify(padded));
});

test("padToMinSize followed by addOp succeeds where the unpadded rect would have been rejected", () => {
  const ed = createEditor(300, 300);
  const tiny = { x: 100, y: 100, w: 1, h: 1 };
  assert.equal(addOp(ed, "ink", tiny), null, "sanity: the unpadded rect really is rejected");
  const padded = padToMinSize(tiny, ed.width, ed.height);
  const op = addOp(ed, "ink", padded);
  assert.ok(op, "padded rect should be accepted");
});

test("padToMinSize clamps to the page edge instead of growing off it", () => {
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  const padded = padToMinSize(rect, 100, 100);
  assert.ok(padded.x >= 0 && padded.y >= 0, JSON.stringify(padded));
});
