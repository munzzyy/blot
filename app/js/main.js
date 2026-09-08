// Boot and flow: open a PDF (or get refused with a reason), ink pages,
// flatten to an image-only PDF, verify the output, hand it back.

import { loadPdf, renderPage, verifyOutput, checkCoverage, MAX_PAGES } from "./pdfdoc.js";
import { buildPdf } from "./pdfwrite.js";
import { createEditor, addOp, undo, redo, paintOps, setCrop, cropOffset, repeatAcrossPages, padToMinSize } from "./editor.js";
import { bake, encode, makeMosaic, cropOutRect, bakedOpRect } from "./render.js";
import { createCanvasView } from "./canvasview.js";
import { setLocale, resolveLocale, translateDom, t, LOCALE_CHOICES } from "./i18n.js";
import { isWrapper, isIOSScheme, deliverNative } from "./platform.js";
import { findMatches, sweepPatterns, PATTERN_KEYS, isTextless } from "./detect.js";

const VERSION = "0.3.0";

globalThis.__blotErrors = [];
window.addEventListener("error", (ev) => __blotErrors.push(String(ev.message)));
window.addEventListener("unhandledrejection", (ev) => __blotErrors.push(String(ev.reason)));
document.addEventListener("securitypolicyviolation", (ev) =>
  __blotErrors.push(`csp: ${ev.violatedDirective} ${ev.blockedURI}`),
);

const $ = (id) => document.getElementById(id);

let toastTimer = 0;
function toast(msg, ms = 4000) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  announce(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
const announce = (msg) => {
  $("sr-live").textContent = msg;
};

// ------------------------------------------------------------------ state

// session: { pages: [{canvas, widthPt, heightPt, editor, textItems, scale,
// suggestions, mosaic}], current, name, exported }
let session = null;
let view = null;
let closeArmed = false;
let currentTool = "ink";

const app = {
  get state() {
    const screens = ["start", "refusal", "edit", "done"];
    return {
      screen: screens.find((s) => !$(`screen-${s}`).hidden) || "none",
      pages: session?.pages.length ?? 0,
      current: session?.current ?? 0,
      boxes: session ? session.pages.reduce((n, p) => n + paintOps(p.editor).length, 0) : 0,
      suggestions: session ? session.pages.reduce((n, p) => n + p.suggestions.length, 0) : 0,
      scannedPages: session?.scannedPages ?? [],
      version: VERSION,
      wrapper: isWrapper(),
    };
  },
  openBytes,
  session: () => session,
};
globalThis.__blotApi = app;
// Deterministic op placement and suggestion acceptance for the e2e;
// pointer input itself is exercised by the shared canvasview suite in the
// sibling repo. checkCoverage is exposed so the e2e can run the same
// negative control this build's own gauntlet expects: drop a box, confirm
// the check fails.
globalThis.__blotTestHooks = {
  addOp,
  acceptSuggestion,
  checkCoverage,
  setCrop,
  cropOffset,
  addKeyboardBox: () => view.addKeyboardBox(),
  render: () => view.render(),
};

// focusReturn: this screen is a refusal/error return, not the initial
// boot, so move focus there too instead of leaving it stranded on a node
// that just got hidden.
function show(name, focusReturn) {
  for (const s of ["start", "refusal", "edit", "done"]) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo(0, 0);
  if (name === "edit") $("canvas").focus({ preventScroll: true });
  if (name === "done") $("done-title").focus({ preventScroll: true });
  if (name === "refusal") $("refusal-title").focus({ preventScroll: true });
  if (name === "start" && focusReturn) $("dropzone").focus({ preventScroll: true });
}

const PRINT_TO_PDF_HINT = t("On a phone: open it in your PDF viewer, use Share or the menu, choose Print, then pinch open the print preview and share or save THAT as a PDF.");

const REFUSALS = {
  encrypted: () => [t("This PDF is password protected"), t("Blot will not guess at partial decryption. Remove the password in your PDF viewer first, then bring the unlocked file here.")],
  forms: () => [t("This PDF is a filled form"), `${t("Form answers live outside the page image, where flattening can silently lose or miss them. Print the form to a new PDF from your viewer, check the result shows everything, then redact that file here.")} ${PRINT_TO_PDF_HINT}`],
  signed: () => [t("This PDF is digitally signed"), t("Flattening would destroy the signature, and a redactor should not quietly break the one thing this file was issued for. If you accept losing the signature, print to PDF first and bring that.")],
  xfa: () => [t("This PDF uses XFA forms"), `${t("XFA content renders unreliably outside Adobe tools, and redacting what you cannot fully see is how leaks happen. Print it to a regular PDF first.")} ${PRINT_TO_PDF_HINT}`],
  toolong: () => [t("This PDF is too long"), t("Blot handles up to {max} pages at a time, because every page is held in memory as an image. Split the document and redact the parts: most PDF viewers, including the Files app on a phone, can export a page range as a new PDF.", { max: MAX_PAGES })],
  unreadable: () => [t("This file could not be read as a PDF"), t("It may be damaged, or not really a PDF. Nothing was processed.")],
};

// ------------------------------------------------------------------ open

async function openBytes(bytes, name = "document.pdf") {
  // Whatever was open before is gone the moment a new open starts; a
  // refusal or failed render must not leave the old document alive in
  // memory behind the start screen.
  session = null;
  currentTool = "ink";
  view.clearSelection();
  view.render();
  const res = await loadPdf(bytes);
  if (res.refusal) {
    const [title, body] = (REFUSALS[res.refusal] || REFUSALS.unreadable)();
    $("refusal-title").textContent = title;
    $("refusal-body").textContent = body;
    show("refusal");
    return false;
  }
  show("edit");
  $("render-progress").hidden = false;
  const pages = [];
  try {
    for (let n = 1; n <= res.pages; n++) {
      $("render-progress-text").textContent = t("Rendering page {n} of {total}", { n, total: res.pages });
      const { canvas, widthPt, heightPt, textItems, scale } = await renderPage(res.doc, n);
      pages.push({
        canvas,
        widthPt,
        heightPt,
        textItems,
        scale,
        mosaic: null,
        suggestions: [],
        editor: createEditor(canvas.width, canvas.height),
      });
    }
  } catch (err) {
    __blotErrors.push(`render: ${err}`);
    toast(t("Rendering failed partway; this document may be too large for this device."), 6000);
    show("start", true);
    return false;
  } finally {
    $("render-progress").hidden = true;
    res.task.destroy().catch(() => {});
  }
  const scannedPages = pages.map((p, i) => (isTextless(p.textItems) ? i + 1 : null)).filter((n) => n);
  session = { pages, current: 0, name, exported: null, scannedPages };
  const swept = runPatternSweep();
  setTool("ink");
  $("find-input").value = "";
  $("find-bar").hidden = true;
  $("btn-find-toggle").setAttribute("aria-expanded", "false");
  updatePageUi();
  updateFindUi();
  updateScanNotice();
  view.fit();
  $("canvas").focus({ preventScroll: true });
  announce(
    swept
      ? t("{total} pages rendered. Pattern sweep found {n} possible match(es); Tab to review. Drag or press B to ink.", { total: pages.length, n: swept })
      : t("{total} pages rendered. Drag or press B to ink.", { total: pages.length }),
  );
  return true;
}

// Runs the preset SSN/phone/email/account patterns over every page's own
// text layer right after open. A suggestion, never an auto-redaction: it
// stays a dashed outline until a human accepts it, and it only ever sees
// what pdf.js's own text extraction already found, so a scanned page with
// no text layer yields nothing here no matter what it shows.
function runPatternSweep() {
  let total = 0;
  for (const page of session.pages) {
    const hits = sweepPatterns(page.textItems, { scale: page.scale, heightPt: page.heightPt }, PATTERN_KEYS).map(
      (h) => ({ ...h, source: "pattern" }),
    );
    page.suggestions.push(...hits);
    total += hits.length;
  }
  return total;
}

// Free-text search (find-and-cover): replaces only the previous SEARCH
// suggestions, so a new query does not wipe out the pattern sweep's own
// hits. Searches every page's text layer, not just the one on screen.
function runSearch(query) {
  if (!session) return 0;
  let total = 0;
  let firstHitPage = -1;
  for (let i = 0; i < session.pages.length; i++) {
    const page = session.pages[i];
    page.suggestions = page.suggestions.filter((s) => s.source !== "search");
    if (!query) continue;
    const hits = findMatches(page.textItems, { scale: page.scale, heightPt: page.heightPt }, query).map((h) => ({
      ...h,
      source: "search",
    }));
    page.suggestions.push(...hits);
    total += hits.length;
    if (hits.length && firstHitPage === -1) firstHitPage = i;
  }
  if (firstHitPage !== -1 && session.pages[session.current].suggestions.every((s) => s.source !== "search")) {
    gotoPage(firstHitPage);
  }
  view.render();
  return total;
}

function acceptSuggestion(s) {
  if (!session) return;
  const page = session.pages[session.current];
  // A suggestion can measure under addOp's own minimum (a 1-2 character
  // match inside a long text item): pad it up to that minimum, centered
  // on the same spot, rather than silently dropping the suggestion with
  // no ink and no explanation. The user asked for this to be covered;
  // covering a hair more than the exact rect beats covering nothing.
  const rect = padToMinSize(s.rect, page.editor.width, page.editor.height);
  const op = addOp(page.editor, "ink", rect);
  page.suggestions = page.suggestions.filter((x) => x !== s);
  if (op) {
    session.exported = null;
    announce(t("Suggestion covered"));
  } else {
    // Only reachable if the page itself is smaller than MIN_SIZE, which
    // never happens for a rendered page; still, never fail silently.
    announce(t("Could not cover that suggestion; it was too small to place."));
  }
  updatePageUi();
  updateFindUi();
  view.render();
}

const toolNote = (tool) => {
  if (tool === "pixelate") {
    return t("Pixelation blurs blocks of pixels together. It is weaker than ink on text: small type or a short string can sometimes be reconstructed from a heavily pixelated block. Use ink for anything you need to be sure is gone.");
  }
  if (tool === "crop") return t("Drag on the page, or press B, to draft a crop area. Everything outside it is discarded on export.");
  return "";
};

function setTool(tool) {
  currentTool = tool;
  for (const id of ["ink", "pixelate", "crop"]) {
    const btn = $(`tool-${id}`);
    btn.classList.toggle("active", id === tool);
    btn.setAttribute("aria-checked", String(id === tool));
  }
  const note = $("tool-note");
  const text = toolNote(tool);
  note.textContent = text;
  note.hidden = !text;
  $("crop-bar").hidden = tool !== "crop";
  if (tool !== "crop") view?.setCropDraft(null);
  view?.clearSelection();
}

// Re-triggers a CSS animation on an element by dropping the class and
// forcing a reflow before adding it back, instead of a timer that would
// need to unset it later.
function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function updateFindUi() {
  const el = $("find-count");
  if (!el || !session) return;
  const total = session.pages.reduce((n, p) => n + p.suggestions.length, 0);
  const text = total
    ? t("{count} suggestion(s) across the document. Tab on the page to review.", { count: total })
    : t("No open suggestions.");
  if (text !== el.textContent) {
    el.textContent = text;
    if (total) bump(el);
  }
}

// A textless page reads as zero sweep matches either way; this says so.
function updateScanNotice() {
  const el = $("scan-notice");
  if (!el || !session) return;
  const pages = session.scannedPages;
  el.hidden = pages.length === 0;
  el.textContent = pages.length
    ? t("Page(s) {list}: no text layer, so automatic search cannot check them. They are images; cover anything there by hand.", { list: pages.join(", ") })
    : "";
}

function updatePageUi() {
  if (!session) return;
  $("page-ind").textContent = t("Page {n} of {total}", { n: session.current + 1, total: session.pages.length });
  const boxes = app.state.boxes;
  const boxText = boxes ? t("{count} box(es)", { count: boxes }) : "";
  const boxEl = $("box-count");
  if (boxText !== boxEl.textContent) {
    boxEl.textContent = boxText;
    if (boxes) bump(boxEl);
  }
  $("btn-prev").disabled = session.current === 0;
  $("btn-next").disabled = session.current === session.pages.length - 1;
  updateUndoRedo();
}

function updateUndoRedo() {
  if (!session) return;
  const ed = session.pages[session.current].editor;
  $("btn-undo").disabled = ed.ops.length === 0;
  $("btn-redo").disabled = ed.undone.length === 0;
}

function gotoPage(idx) {
  if (!session) return;
  session.current = Math.max(0, Math.min(session.pages.length - 1, idx));
  session.exported = null;
  view.clearSelection();
  updatePageUi();
  view.fit();
  announce(t("Page {n} of {total}", { n: session.current + 1, total: session.pages.length }));
}

function closeDoc() {
  session = null;
  view.clearSelection();
  view.render();
  show("start");
}

// ---------------------------------------------------------------- export

async function runExport() {
  if (!session) return;
  const btn = $("btn-export");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t("Flattening…");
  announce(t("Flattening…"));
  try {
    const outPages = [];
    const perPageBoxes = [];
    for (const page of session.pages) {
      const baked = bake(page.canvas, page.editor);
      const blob = await encode(baked, "image/jpeg", 0.9);
      // A crop shrinks the baked canvas to the crop rect; the MediaBox has
      // to shrink with it in the same proportion, or the smaller image
      // gets stretched back out to the original page size in the output.
      const widthPt = page.widthPt * (baked.width / page.editor.width);
      const heightPt = page.heightPt * (baked.height / page.editor.height);
      outPages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        width: baked.width,
        height: baked.height,
        widthPt,
        heightPt,
      });
      // Use bake()'s own rect math (same snap, same skip-if-fully-outside
      // rule) so a box a crop pushed off-frame is never checked: bake()
      // never drew it there, so checkCoverage must not expect it there
      // either, or a crop that removed a stray box would come back as a
      // false "something survived" instead of the clean export it is.
      const out = cropOutRect(page.editor);
      perPageBoxes.push(
        paintOps(page.editor)
          .filter((o) => o.type === "ink")
          .map((o) => bakedOpRect(o, out, baked.width, baked.height))
          .filter((r) => r && r.w > 0 && r.h > 0),
      );
    }
    const pdf = buildPdf(outPages);
    // PDF.js transfers the buffer it is given to its worker, detaching it;
    // every reopening step below gets its own fresh copy so the export
    // itself survives being checked.
    const verify = await verifyOutput(new Uint8Array(pdf));
    const coverage = verify.ok ? await checkCoverage(new Uint8Array(pdf), perPageBoxes) : { ok: true, pages: [] };
    const clean = verify.ok && coverage.ok;
    // A failed check means nothing leaves: no exported bytes, no live
    // Share/Save under a screen that says do not share.
    session.exported = clean ? { bytes: pdf, verify, coverage, hash: await hashHex(pdf) } : null;
    renderProof(verify, coverage, pdf.length);
    $("btn-share").hidden = !clean;
    $("btn-save").hidden = !clean;
    show("done");
  } catch (err) {
    __blotErrors.push(`export: ${err}`);
    toast(t("Could not build the output. The document may be too large for this device."), 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// SHA-256 of the exact bytes about to be handed to Share/Save, as hex.
// This is a checksum a document can be re-hashed against later, not a
// signature: it proves the file was not altered after this screen, not
// who made it or that it is trustworthy.
async function hashHex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderProof(verify, coverage, size) {
  const clean = verify.ok && coverage.ok;
  const badge = $("done-badge");
  badge.textContent = clean ? "✓" : "!";
  badge.classList.toggle("warn", !clean);
  $("done-title").textContent = clean ? t("Checked clean") : t("Something survived");
  $("done-sub").textContent = clean
    ? t("The finished file was reopened and re-checked: no extractable text, no annotations, no form fields. Pixels only.")
    : t("The finished file was re-checked and something unexpected is in it. Do not share it; please report this.");
  $("done-report-contact").hidden = clean;
  const facts = $("done-facts");
  facts.textContent = "";
  const checkedBoxes = coverage.pages.reduce((n, p) => n + (p.ok ? p.checked : 0), 0);
  const lines = [
    t("{count} page(s), images only", { count: verify.pages ?? 0 }),
    t("Extractable text items: {count}", { count: verify.textItems ?? "?" }),
    t("Annotations and comments: {count}", { count: verify.annotations ?? "?" }),
    t("Form fields: {count}", { count: verify.formFields ?? "?" }),
    t("Size: {kb} KB", { kb: Math.round(size / 1024) }),
  ];
  if (verify.ok && checkedBoxes > 0) {
    lines.push(
      coverage.ok
        ? t("Ink coverage: every covered spot re-rendered dark")
        : t("Ink coverage: a covered spot re-rendered light. Do not share this file."),
    );
  }
  for (const text of lines) {
    const li = document.createElement("li");
    li.textContent = text;
    facts.append(li);
  }
  const receipt = $("done-receipt");
  if (receipt) receipt.hidden = !clean;
  const hashEl = $("done-hash");
  if (hashEl) hashEl.textContent = clean ? session.exported.hash : "";
}

// Keeps a trace of what the file was, so it doesn't come back as a bare
// random tag with nothing to tell it apart from the next export. The
// random tag stays too: two redactions of the same document must not
// collide or silently overwrite each other.
const outName = (original) => {
  const raw = crypto.getRandomValues(new Uint8Array(4));
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let tag = "";
  for (const b of raw) tag += alphabet[b % alphabet.length];
  const stem = String(original || "")
    .replace(/\.[^./\\]*$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return stem ? `redacted-${stem}-${tag}.pdf` : `redacted-${tag}.pdf`;
};

async function deliver(kind) {
  if (!session?.exported) return;
  const blob = new Blob([session.exported.bytes], { type: "application/pdf" });
  const name = outName(session.name);
  if (isWrapper()) {
    if (deliverNative(kind, session.exported.bytes, "application/pdf", name)) {
      // The bridge only starts a hand-off; the OS (share sheet, Downloads,
      // Save to Files) decides where the file actually lands. "Downloaded"
      // would be a lie here.
      if (isIOSScheme()) toast(t("Choose where to save it."));
      return;
    }
    // On iOS the web fallback below is dead: a blob: download navigation
    // is cancelled by the wrapper's navigation policy, so it would fail
    // silently while the UI kept going. A build without the save bridge
    // must say so instead.
    toast(t("This build of Blot cannot save or share files yet. Update the app and try again."), 6000);
    return;
  }
  if (kind === "share" && navigator.canShare) {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (kind === "share") toast(t("Sharing is not available here, so it downloaded instead."));
}

// ------------------------------------------------------------------ boot

function wireEvents() {
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  });
  for (const [enter, cls] of [["dragover", true], ["dragleave", false], ["drop", false]]) {
    document.addEventListener(enter, (ev) => {
      if (enter !== "dragleave" && ![...(ev.dataTransfer?.types || [])].includes("Files")) return;
      ev.preventDefault();
      dropzone.classList.toggle("dragging", cls);
      if (enter === "drop" && ev.dataTransfer.files.length) {
        const file = ev.dataTransfer.files[0];
        file.arrayBuffer().then((buf) => openBytes(new Uint8Array(buf), file.name));
      }
    });
  }

  $("btn-refusal-back").addEventListener("click", () => show("start"));

  // Armed state has no timeout: a timed window is unreachable for anyone
  // who needs more than a few seconds to act. It stays armed until either
  // the second press discards the document, or any other interaction
  // disarms it, so a slower press never lands on a stale state.
  function disarmClose() {
    if (!closeArmed) return;
    closeArmed = false;
    $("btn-close").classList.remove("armed");
    $("btn-close").setAttribute("aria-label", t("Close this document"));
  }
  $("btn-close").addEventListener("click", () => {
    if (session && app.state.boxes > 0 && !closeArmed) {
      closeArmed = true;
      $("btn-close").classList.add("armed");
      $("btn-close").setAttribute("aria-label", t("Press again to discard your ink"));
      toast(t("Your ink is not exported yet. Tap close again to discard it."));
      return;
    }
    closeArmed = false;
    $("btn-close").classList.remove("armed");
    closeDoc();
  });
  document.addEventListener(
    "click",
    (ev) => {
      if (closeArmed && ev.target !== $("btn-close")) disarmClose();
    },
    true,
  );
  document.addEventListener("keydown", (ev) => {
    if (closeArmed && ev.key === "Escape") disarmClose();
  });

  $("btn-prev").addEventListener("click", () => gotoPage(session.current - 1));
  $("btn-next").addEventListener("click", () => gotoPage(session.current + 1));
  $("btn-undo").addEventListener("click", () => {
    undo(session.pages[session.current].editor);
    session.exported = null;
    view.clearSelection();
    updatePageUi();
    announce(t("Box removed. {count} on this page.", { count: paintOps(session.pages[session.current].editor).length }));
  });
  $("btn-redo").addEventListener("click", () => {
    redo(session.pages[session.current].editor);
    session.exported = null;
    view.render();
    updatePageUi();
    announce(t("Box restored. {count} on this page.", { count: paintOps(session.pages[session.current].editor).length }));
  });
  $("btn-del-box").addEventListener("click", () => view.deleteSelected());
  $("btn-export").addEventListener("click", runExport);
  $("btn-share").addEventListener("click", () => deliver("share"));
  $("btn-save").addEventListener("click", () => deliver("save"));
  $("btn-again").addEventListener("click", closeDoc);

  document.addEventListener("keydown", (ev) => {
    if (!session || $("screen-edit").hidden) return;
    if (ev.key === "PageDown") {
      gotoPage(session.current + 1);
      ev.preventDefault();
    } else if (ev.key === "PageUp") {
      gotoPage(session.current - 1);
      ev.preventDefault();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      runExport();
      ev.preventDefault();
    }
  });

  const kbdHint = $("kbd-hint");
  $("canvas").addEventListener("focus", () => {
    kbdHint.hidden = false;
  });
  $("canvas").addEventListener("blur", () => {
    kbdHint.hidden = true;
  });

  // ---------------------------------------------------------- tools

  $("tool-ink").addEventListener("click", () => setTool("ink"));
  $("tool-pixelate").addEventListener("click", () => setTool("pixelate"));
  $("tool-crop").addEventListener("click", () => setTool("crop"));

  // role="radio" in a role="radiogroup" advertises arrow-key navigation
  // to a screen reader; without this, that advertised behavior did
  // nothing. Left/Up and Right/Down cycle and select, matching how a
  // native radio group actually behaves.
  const TOOL_IDS = ["ink", "pixelate", "crop"];
  const TOOL_DIRS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  function toolKeyNav(ev) {
    const dir = TOOL_DIRS[ev.key];
    if (dir === undefined) return;
    ev.preventDefault();
    const at = TOOL_IDS.indexOf(currentTool);
    const next = TOOL_IDS[(at + dir + TOOL_IDS.length) % TOOL_IDS.length];
    setTool(next);
    $(`tool-${next}`).focus();
  }
  for (const id of TOOL_IDS) $(`tool-${id}`).addEventListener("keydown", toolKeyNav);

  $("btn-crop-apply").addEventListener("click", () => {
    if (!session) return;
    const draft = view.getCropDraft();
    if (!draft) {
      toast(t("Draft a crop area first: drag on the page, or press B."));
      return;
    }
    const editor = session.pages[session.current].editor;
    if (!setCrop(editor, draft)) {
      toast(t("That crop area is too small."));
      return;
    }
    view.setCropDraft(null);
    session.exported = null;
    setTool("ink");
    // setTool("ink") just hid the crop bar that held the button this
    // click came from; move focus to the tool that took over instead of
    // letting it fall to <body>, where a keyboard user loses their place.
    $("tool-ink").focus();
    updatePageUi();
    announce(t("Crop applied. Everything outside it will be discarded on export."));
    view.render();
  });
  $("btn-crop-cancel").addEventListener("click", () => {
    // Unlike Apply, Cancel does not change tool, so the crop bar (and the
    // button focus already sitting on) stays put; nothing to redirect.
    view.setCropDraft(null);
    view.render();
  });

  // ------------------------------------------------------- find & sweep

  function doSearch() {
    if (!session) return;
    const q = $("find-input").value.trim();
    const total = runSearch(q);
    updateFindUi();
    announce(
      q
        ? t("{count} match(es) for \"{query}\" in this document's text layer.", { count: total, query: q })
        : t("Search cleared."),
    );
  }
  $("btn-find-toggle").addEventListener("click", () => {
    const bar = $("find-bar");
    bar.hidden = !bar.hidden;
    $("btn-find-toggle").setAttribute("aria-expanded", String(!bar.hidden));
    if (!bar.hidden) $("find-input").focus();
  });
  $("btn-find-go").addEventListener("click", doSearch);
  $("find-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      doSearch();
    }
  });
  $("btn-find-clear").addEventListener("click", () => {
    $("find-input").value = "";
    doSearch();
  });

  // ------------------------------------------------------ repeat a box

  $("btn-repeat").addEventListener("click", () => {
    if (!session) return;
    const sel = view.getSelected();
    if (!sel) return;
    const source = session.pages[session.current];
    const targets = session.pages
      .map((page, index) => ({ index, editor: page.editor }))
      .filter((p) => p.index !== session.current);
    const results = repeatAcrossPages(
      sel.rect,
      { width: source.editor.width, height: source.editor.height },
      sel.type,
      targets,
    );
    session.exported = null;
    const applied = results.filter((r) => r.applied).length;
    const clamped = results.filter((r) => r.clamped).length;
    updatePageUi();
    toast(
      clamped
        ? t("Added to {applied} of {total} pages. {clamped} had a different page size and were scaled to fit; check them.", { applied, total: results.length, clamped })
        : t("Added to {applied} of {total} pages.", { applied, total: results.length }),
    );
  });

  // -------------------------------------------------------- proof receipt

  $("btn-copy-hash").addEventListener("click", async () => {
    const hash = $("done-hash").textContent;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      toast(t("Copied."));
    } catch {
      toast(t("Could not copy. Select and copy the hash by hand."));
    }
  });
}

function buildLocalePicker() {
  const select = $("locale-pick");
  for (const { id, label } of LOCALE_CHOICES) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    select.append(opt);
  }
  let pref = "auto";
  try {
    pref = localStorage.getItem("blot-locale") || "auto";
  } catch {}
  select.value = pref;
  select.addEventListener("change", () => {
    try {
      localStorage.setItem("blot-locale", select.value);
    } catch {}
    setLocale(resolveLocale(select.value));
    translateDom();
  });
}

async function boot() {
  let pref = "auto";
  try {
    pref = localStorage.getItem("blot-locale") || "auto";
  } catch {}
  setLocale(resolveLocale(pref));
  translateDom();
  buildLocalePicker();

  const native = globalThis.BlotNative;
  if (isWrapper()) {
    for (const node of document.querySelectorAll(".web-only")) node.remove();
    // Android accepts a PDF shared in from any app; iOS has no equivalent
    // yet, so it gets the same in-app file picker a web visitor has.
    $("drop-hint").textContent = native ? t("or share a PDF to Blot from any app") : t("or open one from Files");
  } else if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const ver = $("ver");
  if (ver) ver.textContent = `v${VERSION}`;

  view = createCanvasView({
    canvas: $("canvas"),
    wrap: $("canvas-wrap"),
    getBitmap: () => session?.pages[session.current]?.canvas ?? null,
    getMosaic: () => {
      const page = session?.pages[session.current];
      if (!page) return null;
      if (!page.mosaic) page.mosaic = makeMosaic(page.canvas);
      return page.mosaic;
    },
    getEditor: () => session?.pages[session.current]?.editor ?? createEditor(1, 1),
    getTool: () => currentTool,
    getSuggestions: () => session?.pages[session.current]?.suggestions ?? [],
    acceptSuggestion,
    onChange: () => {
      if (session) session.exported = null;
      updatePageUi();
    },
    onSelect: () => {
      const sel = view?.getSelected();
      $("btn-del-box").hidden = !sel;
      $("btn-repeat").hidden = !sel || !session || session.pages.length < 2;
    },
    onCropDraft: () => {},
    announce,
  });

  wireEvents();
  show("start");

  // Installed-PWA "open with Blot" from a file manager.
  globalThis.launchQueue?.setConsumer?.(async (params) => {
    const handle = (params.files || [])[0];
    if (!handle) return;
    try {
      const file = await handle.getFile();
      await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (err) {
      __blotErrors.push(`launch: ${err}`);
    }
  });

  // Wrapper share-in: one-shot tokens over the asset origin.
  globalThis.__blotShared = async (payload) => {
    const tokens = Array.isArray(payload) ? payload : payload ? [String(payload)] : [];
    if (!tokens.length) return;
    try {
      const res = await fetch(`/shared/${tokens[0]}`);
      if (!res.ok) throw new Error(String(res.status));
      await openBytes(new Uint8Array(await res.arrayBuffer()));
      if (tokens.length > 1) toast(t("Blot opens one document at a time; the first shared file was opened."));
    } catch (err) {
      __blotErrors.push(`shared: ${err}`);
      toast(t("Could not read the shared file."));
    }
  };
  try {
    const parsed = JSON.parse(native?.sharedTokens?.() || "[]");
    if (Array.isArray(parsed) && parsed.length) globalThis.__blotShared(parsed);
  } catch {}
}

boot();
