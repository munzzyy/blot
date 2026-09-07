// Boot and flow: open a PDF (or get refused with a reason), ink pages,
// flatten to an image-only PDF, verify the output, hand it back.

import { loadPdf, renderPage, verifyOutput, MAX_PAGES } from "./pdfdoc.js";
import { buildPdf } from "./pdfwrite.js";
import { createEditor, addOp, undo, redo, paintOps } from "./editor.js";
import { bake, encode } from "./render.js";
import { createCanvasView } from "./canvasview.js";
import { setLocale, resolveLocale, translateDom, t, LOCALE_CHOICES } from "./i18n.js";
import { isWrapper, isIOSScheme, deliverNative } from "./platform.js";

const VERSION = "0.2.0";

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

// session: { pages: [{canvas, widthPt, heightPt, editor}], current, name, exported }
let session = null;
let view = null;
let closeArmed = false;

const app = {
  get state() {
    const screens = ["start", "refusal", "edit", "done"];
    return {
      screen: screens.find((s) => !$(`screen-${s}`).hidden) || "none",
      pages: session?.pages.length ?? 0,
      current: session?.current ?? 0,
      boxes: session ? session.pages.reduce((n, p) => n + paintOps(p.editor).length, 0) : 0,
      version: VERSION,
      wrapper: isWrapper(),
    };
  },
  openBytes,
  session: () => session,
};
globalThis.__blotApi = app;
// Deterministic op placement for the e2e; pointer input is exercised by the
// shared canvasview suite in the sibling repo.
globalThis.__blotTestHooks = { addOp };

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
      const { canvas, widthPt, heightPt } = await renderPage(res.doc, n);
      pages.push({ canvas, widthPt, heightPt, editor: createEditor(canvas.width, canvas.height) });
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
  session = { pages, current: 0, name, exported: null };
  updatePageUi();
  view.fit();
  $("canvas").focus({ preventScroll: true });
  announce(t("{total} pages rendered. Drag or press B to ink.", { total: pages.length }));
  return true;
}

function updatePageUi() {
  if (!session) return;
  $("page-ind").textContent = t("Page {n} of {total}", { n: session.current + 1, total: session.pages.length });
  const boxes = app.state.boxes;
  $("box-count").textContent = boxes ? t("{count} box(es)", { count: boxes }) : "";
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
    for (const page of session.pages) {
      const baked = bake(page.canvas, page.editor);
      const blob = await encode(baked, "image/jpeg", 0.9);
      outPages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        width: baked.width,
        height: baked.height,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
      });
    }
    const pdf = buildPdf(outPages);
    // PDF.js transfers the buffer it is given to its worker, detaching it;
    // the verifier gets a copy so the export survives being checked.
    const verify = await verifyOutput(new Uint8Array(pdf));
    // A failed verification means nothing leaves: no exported bytes, no
    // live Share/Save under a screen that says do not share.
    session.exported = verify.ok ? { bytes: pdf, verify } : null;
    renderProof(verify, pdf.length);
    $("btn-share").hidden = !verify.ok;
    $("btn-save").hidden = !verify.ok;
    show("done");
  } catch (err) {
    __blotErrors.push(`export: ${err}`);
    toast(t("Could not build the output. The document may be too large for this device."), 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderProof(verify, size) {
  const clean = verify.ok;
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
  const lines = [
    t("{count} page(s), images only", { count: verify.pages ?? 0 }),
    t("Extractable text items: {count}", { count: verify.textItems ?? "?" }),
    t("Annotations and comments: {count}", { count: verify.annotations ?? "?" }),
    t("Form fields: {count}", { count: verify.formFields ?? "?" }),
    t("Size: {kb} KB", { kb: Math.round(size / 1024) }),
  ];
  for (const text of lines) {
    const li = document.createElement("li");
    li.textContent = text;
    facts.append(li);
  }
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
    $("btn-close").setAttribute("aria-label", t("Close this document"));
  }
  $("btn-close").addEventListener("click", () => {
    if (session && app.state.boxes > 0 && !closeArmed) {
      closeArmed = true;
      $("btn-close").setAttribute("aria-label", t("Press again to discard your ink"));
      toast(t("Your ink is not exported yet. Tap close again to discard it."));
      return;
    }
    closeArmed = false;
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
    getMosaic: () => null,
    getEditor: () => session?.pages[session.current]?.editor ?? createEditor(1, 1),
    getTool: () => "ink",
    getSuggestions: () => [],
    acceptSuggestion: () => {},
    onChange: () => {
      if (session) session.exported = null;
      updatePageUi();
    },
    onSelect: () => {
      $("btn-del-box").hidden = !view?.getSelected();
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
