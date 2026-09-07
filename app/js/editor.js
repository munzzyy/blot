// Redaction editor state. Pure data and geometry: rectangles live in image
// pixel coordinates, the canvas layer renders them, the export step burns
// them. No DOM, no canvas here, so all of it runs under node's test runner.

let nextId = 1;

export function createEditor(width, height) {
  return {
    width,
    height,
    ops: [],
    crop: null,
    undone: [],
  };
}

// Drag rectangles arrive in any direction and can spill off the canvas.
export function normRect(rect, width, height) {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = Math.max(0, Math.min(x, width));
  const y0 = Math.max(0, Math.min(y, height));
  const x1 = Math.max(0, Math.min(x + w, width));
  const y1 = Math.max(0, Math.min(y + h, height));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const MIN_SIZE = 4;

export function addOp(editor, type, rect) {
  const r = normRect(rect, editor.width, editor.height);
  if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
  const op = { id: nextId++, type, rect: r };
  editor.ops.push(op);
  editor.undone = [];
  return op;
}

// Grows a rect that is under MIN_SIZE on one or both axes up to MIN_SIZE,
// keeping it centered on its original middle point and clamped to the
// page. A suggestion the producer measured at 1-2 pixels wide (a short
// match inside a long text item) still needs to become a real box on
// accept; failing it silently would drop the suggestion with no ink and
// no feedback, which is worse than covering a hair more than asked.
export function padToMinSize(rect, width, height) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const w = Math.max(rect.w, MIN_SIZE);
  const h = Math.max(rect.h, MIN_SIZE);
  return normRect({ x: cx - w / 2, y: cy - h / 2, w, h }, width, height);
}

export function setCrop(editor, rect) {
  const r = normRect(rect, editor.width, editor.height);
  if (r.w < MIN_SIZE * 4 || r.h < MIN_SIZE * 4) return null;
  editor.undone = [];
  const prev = editor.crop;
  editor.crop = r;
  editor.ops.push({ id: nextId++, type: "crop", rect: r, prev });
  return editor.crop;
}

export function undo(editor) {
  const op = editor.ops.pop();
  if (!op) return false;
  if (op.type === "crop") editor.crop = op.prev ?? null;
  editor.undone.push(op);
  return true;
}

export function redo(editor) {
  const op = editor.undone.pop();
  if (!op) return false;
  if (op.type === "crop") editor.crop = op.rect;
  editor.ops.push(op);
  return true;
}

export function removeOp(editor, id) {
  const idx = editor.ops.findIndex((o) => o.id === id && o.type !== "crop");
  if (idx === -1) return false;
  editor.ops.splice(idx, 1);
  return true;
}

export const paintOps = (editor) => editor.ops.filter((o) => o.type !== "crop");

export function moveOp(editor, id, dx, dy) {
  const op = editor.ops.find((o) => o.id === id && o.type !== "crop");
  if (!op) return false;
  const r = op.rect;
  r.x = Math.max(0, Math.min(editor.width - r.w, r.x + dx));
  r.y = Math.max(0, Math.min(editor.height - r.h, r.y + dy));
  return true;
}

export function resizeOp(editor, id, dw, dh) {
  const op = editor.ops.find((o) => o.id === id && o.type !== "crop");
  if (!op) return false;
  const r = op.rect;
  r.w = Math.max(MIN_SIZE, Math.min(editor.width - r.x, r.w + dw));
  r.h = Math.max(MIN_SIZE, Math.min(editor.height - r.y, r.h + dh));
  return true;
}

export function hitOp(editor, x, y) {
  for (let i = editor.ops.length - 1; i >= 0; i--) {
    const o = editor.ops[i];
    if (o.type === "crop") continue;
    const r = o.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return o;
  }
  return null;
}

// Pixelation cells sized from the region so a big region gets big cells.
// Small cells on text are reversible; the floor keeps every cell chunky and
// the UI still warns that ink is the safe tool for text.
export function pixelCell(rect) {
  return Math.max(16, Math.round(Math.min(rect.w, rect.h) / 8));
}

// What the exported image will be: the crop area, or the full frame.
export function outputRect(editor) {
  return editor.crop ?? { x: 0, y: 0, w: editor.width, h: editor.height };
}

// The same integer-snapped crop origin bake() uses. Anything that needs
// to map a rect from full-canvas pixel space into output-image pixel
// space (the coverage check) must use this, or it disagrees with what
// bake() actually drew.
export function cropOffset(editor) {
  const raw = outputRect(editor);
  return { x: Math.ceil(raw.x), y: Math.ceil(raw.y) };
}

// Clones a box onto a set of other pages' editors, scaled to each
// target's own pixel dimensions so the same relative spot (a header,
// footer, or Bates stamp) lands correctly even across a mixed-size
// document. Reports what happened per page instead of trusting the
// silent clamp in normRect/addOp: a page whose scaled box got clamped
// smaller than intended is flagged so the caller can say so.
export function repeatAcrossPages(sourceRect, sourceSize, type, targets) {
  return targets.map(({ index, editor }) => {
    const sx = editor.width / sourceSize.width;
    const sy = editor.height / sourceSize.height;
    const scaled = {
      x: sourceRect.x * sx,
      y: sourceRect.y * sy,
      w: sourceRect.w * sx,
      h: sourceRect.h * sy,
    };
    const clamped = normRect(scaled, editor.width, editor.height);
    const clampedByEdge = Math.abs(clamped.w - scaled.w) > 0.5 || Math.abs(clamped.h - scaled.h) > 0.5;
    const op = addOp(editor, type, scaled);
    return { index, applied: !!op, clamped: clampedByEdge };
  });
}
