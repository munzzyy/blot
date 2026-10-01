// The proof that matters: a real text PDF with a planted secret goes in,
// ink goes over it, and the output is checked OUTSIDE the app: pdftotext
// (poppler) must extract nothing, the secret must not exist anywhere in
// the output bytes, and the inked region must be dark when the output is
// rendered back. Refusal gates get their own fixtures.
//
// Run from the repo root:  node test/e2e_app.mjs

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  makeTextPdf,
  makeFormPdf,
  makeBlankFormPdf,
  makeSigPdf,
  makeEncryptedish,
  makeTwoPageTextPdf,
  makeImageOnlyPdf,
  makeCropBoxPdf,
  makeXfaPdf,
  makeLongPdf,
  makeGarbagePdf,
} from "./fixtures-pdf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8961;
const CDP_PORT = 9361;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const SHOTS = path.join(ROOT, "test", "screenshots");
const SECRET = "SECRET-SSN-123-45-6789";

const fails = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name} ${detail}`);
    fails.push(name);
  }
}

async function waitFor(fn, desc, timeout = 30000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = String(err);
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${desc}; last: ${JSON.stringify(last)}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails)}`);
    return r.result?.result?.value;
  };
  return {
    send,
    evalJs,
    open: new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    }),
    close: () => ws.close(),
  };
}

// The exported PDF, written to disk for poppler.
async function saveExport(c, file) {
  const b64 = await c.evalJs(
    `(() => { const b = __blotApi.session().exported.bytes;
      let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(out); })()`,
  );
  const bytes = Buffer.from(b64, "base64");
  writeFileSync(file, bytes);
  return bytes;
}

// Mean gray level over a pixel rect of page 1, rendered by poppler at 150 dpi.
function meanGray(pdfFile, rect, work) {
  const prefix = path.join(work, `gray-${path.basename(pdfFile, ".pdf")}`);
  execFileSync("pdftoppm", ["-r", "150", "-gray", "-cropbox", "-f", "1", "-l", "1", "-singlefile", pdfFile, prefix]);
  const pgm = readFileSync(`${prefix}.pgm`);
  const head = pgm.toString("latin1", 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const [w, h] = [Number(head[1]), Number(head[2])];
  const data = pgm.subarray(head[0].length);
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(h, Math.ceil(rect.y + rect.h)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(w, Math.ceil(rect.x + rect.w)); x++) {
      sum += data[y * w + x];
      n++;
    }
  }
  return n ? sum / n : 255;
}

async function pickFile(c, file) {
  const { root } = (await c.send("DOM.getDocument")).result;
  const input = (await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" })).result;
  await c.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "blot-e2e-"));
  const work = mkdtempSync(path.join(tmpdir(), "blot-e2e-work-"));
  const server = spawn("node", [path.join(ROOT, "test", "serve_local.mjs"), String(HTTP_PORT)], { stdio: "ignore" });
  const chromium = spawn(
    "chromium",
    ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(async () => {
      const [a, b] = await Promise.all([
        fetch(`${BASE}/index.html`).then((r) => r.ok).catch(() => false),
        fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false),
      ]);
      return a && b;
    }, "server and devtools up");

    // Fixture files on disk for the real file-input path, under the repo
    // tree: CI runners' chromium cannot always read another process's
    // temp directory.
    const fixDir = path.join(ROOT, "test", "fixtures");
    mkdirSync(fixDir, { recursive: true });
    const textPdf = path.join(fixDir, "dispute.pdf");
    writeFileSync(textPdf, makeTextPdf(["Rental dispute summary", SECRET, "The unit was inspected."]));
    check(
      "negative control: poppler extracts the secret from the INPUT",
      execFileSync("pdftotext", [textPdf, "-"], { encoding: "utf8" }).includes(SECRET),
    );
    const formPdf = path.join(fixDir, "form.pdf");
    writeFileSync(formPdf, makeFormPdf());
    const blankFormPdf = path.join(fixDir, "blank-form.pdf");
    writeFileSync(blankFormPdf, makeBlankFormPdf());
    const sigPdf = path.join(fixDir, "signed.pdf");
    writeFileSync(sigPdf, makeSigPdf());
    const lockedPdf = path.join(fixDir, "locked.pdf");
    writeFileSync(lockedPdf, makeEncryptedish());
    const xfaPdf = path.join(fixDir, "xfa.pdf");
    writeFileSync(xfaPdf, makeXfaPdf());
    const longPdf = path.join(fixDir, "long-61.pdf");
    writeFileSync(longPdf, makeLongPdf(61));
    const limitPdf = path.join(fixDir, "long-60.pdf");
    writeFileSync(limitPdf, makeLongPdf(60));
    const garbagePdf = path.join(fixDir, "garbage.pdf");
    writeFileSync(garbagePdf, makeGarbagePdf());

    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
    const tab = await res.json();
    const c = connect(tab.webSocketDebuggerUrl);
    await c.open;
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("DOM.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: BASE + "/" });
    await waitFor(() => c.evalJs("!!window.__blotApi && __blotApi.state.screen === 'start'"), "start screen");

    // ---------------------------------------------- wasm codecs reachable
    // JBIG2/JPEG2000 pages decode through these; before wasmUrl was wired
    // up, the worker's fetch prefix was the literal string "null" and both
    // codecs failed silently, leaving the page image blank with no error
    // anywhere in the UI. This proves the served bytes are real, valid
    // wasm, from the exact URL app/js/pdfdoc.js hands the worker.
    for (const codec of ["jbig2", "openjpeg"]) {
      const ok = await c.evalJs(
        `fetch("/vendor/pdfjs/wasm/${codec}.wasm").then((r) => r.arrayBuffer()).then((buf) => WebAssembly.compile(buf).then(() => true, () => false))`,
        true,
      );
      check(`${codec}.wasm serves and compiles`, ok === true);
    }

    // -------------------------------------------------------- refusals
    for (const [file, label, expected] of [
      [formPdf, "filled form", "This PDF is a filled form"],
      [sigPdf, "digitally signed", "This PDF is digitally signed"],
      [lockedPdf, "password", "This PDF is password protected"],
      [xfaPdf, "XFA", "This PDF uses XFA forms"],
      [longPdf, "61 page", "This PDF is too long"],
      [garbagePdf, "not-a-PDF", "This file could not be read as a PDF"],
    ]) {
      await pickFile(c, file);
      await waitFor(() => c.evalJs("__blotApi.state.screen === 'refusal'"), `refusal for ${label}`);
      const title = await c.evalJs("document.getElementById('refusal-title').textContent");
      check(`refuses the ${label} fixture`, title === expected, title);
      await c.evalJs("document.getElementById('btn-refusal-back').click(); 'ok'");
      await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start");
    }

    await pickFile(c, limitPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen !== 'start' && (__blotApi.state.screen === 'refusal' || __blotApi.state.pages === 60)"), "60 page pdf opened");
    check("60 pages, the limit itself, opens", (await c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages")) === 60);
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start after 60 pages");

    // The refusal hint was translated once at module load, before the
    // saved language was applied, so Spanish refusals ended in English.
    await c.evalJs("localStorage.setItem('blot-locale', 'es'); 'ok'");
    await c.send("Page.reload");
    await waitFor(() => c.evalJs("!!window.__blotApi && __blotApi.state.screen === 'start' && document.documentElement.lang === 'es'"), "Spanish start screen");
    await pickFile(c, formPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'refusal'"), "Spanish refusal");
    const esBody = await c.evalJs("document.getElementById('refusal-body').textContent");
    check(
      "Spanish refusal: the phone steps are in Spanish too",
      esBody.includes("En el móvil: ábrelo en tu visor de PDF") && !esBody.includes("On a phone"),
      esBody,
    );
    await c.evalJs("localStorage.removeItem('blot-locale'); 'ok'");
    await c.send("Page.reload");
    await waitFor(() => c.evalJs("!!window.__blotApi && __blotApi.state.screen === 'start' && document.documentElement.lang === 'en'"), "English start screen again");

    // A blank AcroForm field (no /V value) has nothing outside the page
    // stream to lose; it must open into the editor like any other PDF,
    // not get refused as though it were filled.
    await pickFile(c, blankFormPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "blank form opened");
    check("blank form fixture is NOT refused", true);
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start after blank form");

    // ------------------------------------------------- open + ink + export
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf rendered");
    const shot1 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "01-editor.png"), Buffer.from(shot1.result.data, "base64"));

    // The secret sits on line 2 at y=680pt from the bottom on a 792pt page,
    // rendered at 150 DPI. Cover generously in page-pixel space via the API
    // (pointer coords depend on the fit transform; the editor is the same
    // code path either way and pointer input is covered by sepia's suite).
    await c.evalJs(`(() => {
      const s = __blotApi.session();
      const page = s.pages[0];
      const scale = 150 / 72;
      const y = (792 - 700 - 14) * scale;
      const { addOp } = window.__blotTestHooks;
      addOp(page.editor, "ink", { x: 40 * scale, y: y, w: 400 * scale, h: 40 * scale });
      return page.editor.ops.length;
    })()`);
    check("ink op registered", (await c.evalJs("__blotApi.state.boxes")) === 1);
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "export done", 60000);
    const done = await c.evalJs(`(() => ({
      badge: document.getElementById("done-badge").textContent,
      title: document.getElementById("done-title").textContent,
      errs: (__blotErrors || []).slice(0, 5),
    }))()`);
    check("proof: clean badge", done.badge === "✓", JSON.stringify(done));
    check("proof: console clean", done.errs.length === 0, JSON.stringify(done.errs));
    // Let the proof ceremony's staggered entrance finish before the shot:
    // a screenshot mid-animation would show a half-empty screen that
    // never actually looks that way to a real visitor.
    await sleep(900);
    const shot2 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "02-proof.png"), Buffer.from(shot2.result.data, "base64"));

    // ------------------------------------ independent output verification
    const outLen = await c.evalJs("__blotApi.session().exported.bytes.length");
    check("exported bytes exist in the page", outLen > 5000, String(outLen));
    const outB64 = await c.evalJs(
      `(() => { const b = __blotApi.session().exported.bytes;
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
    );
    check("b64 extraction non-empty", typeof outB64 === "string" && outB64.length > 1000, String(outB64).slice(0, 40));
    const outFile = path.join(work, "redacted.pdf");
    const outBytes = Buffer.from(outB64, "base64");
    writeFileSync(outFile, outBytes);

    const outText = execFileSync("pdftotext", [outFile, "-"], { encoding: "utf8" });
    check("independent: poppler extracts ZERO text from the output", outText.trim() === "", JSON.stringify(outText.slice(0, 60)));
    check("independent: the secret exists nowhere in the output bytes", !outBytes.includes(SECRET));
    check("output is a real multi-reader PDF (pdfinfo parses it)", /Pages:\s+1/.test(execFileSync("pdfinfo", [outFile], { encoding: "utf8" })));

    // Render the output back and probe the inked region.
    execFileSync("pdftoppm", ["-r", "72", "-png", outFile, path.join(work, "page")]);
    const png = readFileSync(path.join(work, "page-1.png"));
    const probe = await c.evalJs(
      `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
        return { inked: at(Math.round(bmp.width * 0.3), Math.round(bmp.height * 0.12)), corner: at(5, Math.round(bmp.height - 5)), w: bmp.width, h: bmp.height };
      })()`,
      true,
    );
    const dark = (p) => p[0] < 60 && p[1] < 60 && p[2] < 60;
    check("pixels: inked area is dark in the rendered output", dark(probe.inked), JSON.stringify(probe));
    check("pixels: untouched area stays light", !dark(probe.corner), JSON.stringify(probe.corner));

    // ---------------------------------------------- scanned-page notice
    const scannedPdf = path.join(fixDir, "scanned.pdf");
    writeFileSync(scannedPdf, makeImageOnlyPdf());
    check(
      "negative control: poppler extracts ZERO text from the scanned fixture (it really has no text layer)",
      execFileSync("pdftotext", [scannedPdf, "-"], { encoding: "utf8" }).trim() === "",
    );
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for scanned-page notice run");
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf reopened for notice check");
    check("scanned-page notice stays hidden on a real text page", (await c.evalJs("document.getElementById('scan-notice').hidden")) === true);
    check("no scanned pages reported for a real text page", (await c.evalJs("__blotApi.state.scannedPages.length")) === 0);
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start after text page notice check");
    await pickFile(c, scannedPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "scanned pdf opened");
    const notice = await c.evalJs(
      `(() => { const el = document.getElementById("scan-notice"); return { hidden: el.hidden, text: el.textContent }; })()`,
    );
    check("scanned-page notice appears for an image-only page", notice.hidden === false, JSON.stringify(notice));
    check("scanned-page notice names the page number", notice.text.includes("1"), notice.text);
    check(
      "automatic pattern sweep found nothing on the scanned page (it cannot read it)",
      (await c.evalJs("__blotApi.state.suggestions")) === 0,
    );
    check("scannedPages state names page 1", JSON.stringify(await c.evalJs("__blotApi.state.scannedPages")) === "[1]");
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start after scanned-page notice run");

    // ------------------------------------------------- find-and-cover e2e
    // Real search over the real text layer, accept a real suggestion,
    // flatten, and re-check the exported bytes completely outside the app.
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for find-and-cover run");
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf reopened");

    // Pattern sweep runs automatically on open. The fixture's secret line
    // ("SECRET-SSN-123-45-6789") contains a real SSN-shaped run
    // ("123-45-6789"); finding it proves the sweep ran through real pdf.js
    // text extraction and this app's own coordinate math, not a hand-fed
    // fixture like detect.test.mjs uses.
    const sweptCount = await c.evalJs("__blotApi.state.suggestions");
    check("pattern sweep found the embedded SSN-shaped run on open", sweptCount >= 1, String(sweptCount));

    const spoken = await c.evalJs(`(() => {
      const cv = document.getElementById("canvas");
      cv.focus();
      cv.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      const said = document.getElementById("sr-live").textContent;
      cv.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return said;
    })()`);
    check("screen reader hears what a suggestion matched", spoken.includes("123-45-6789") && spoken.includes("SSN-shaped match"), spoken);
    check("screen reader no longer hears 'Code suggestion'", !spoken.includes("Code suggestion"), spoken);

    // Free-text search through the real find bar UI.
    await c.evalJs(`(() => {
      document.getElementById("btn-find-toggle").click();
      const input = document.getElementById("find-input");
      input.value = "inspected";
      document.getElementById("btn-find-go").click();
      return true;
    })()`);
    await waitFor(() => c.evalJs(`__blotApi.state.suggestions > ${sweptCount}`), "search added a suggestion");
    const afterSearch = await c.evalJs("__blotApi.state.suggestions");
    check("search added at least one suggestion for a real word on the page", afterSearch > sweptCount, `${sweptCount} -> ${afterSearch}`);
    // The find-count bump animation needs a moment to settle before a
    // screenshot: capturing mid-animation once caught a stale compositor
    // frame with the text visually shifted, even though computed style
    // and layout were already correct by query time.
    await sleep(500);
    const shot3 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "03-find.png"), Buffer.from(shot3.result.data, "base64"));

    // Accept one suggestion the same way canvasview's own click handler
    // would (the accept function under the hood), using a rect this
    // app's own producer computed from real text content.
    await c.evalJs(`(() => {
      const p = __blotApi.session().pages[0];
      __blotTestHooks.acceptSuggestion(p.suggestions[0]);
      return true;
    })()`);
    check("accepted suggestion became an ink box", (await c.evalJs("__blotApi.state.boxes")) >= 1);

    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "find-and-cover export done", 60000);
    check("find-and-cover proof: clean badge", (await c.evalJs("document.getElementById('done-badge').textContent")) === "✓");
    await sleep(900);
    const shot4 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "04-receipt.png"), Buffer.from(shot4.result.data, "base64"));

    const outB64f = await c.evalJs(
      `(() => { const b = __blotApi.session().exported.bytes;
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
    );
    const outFileF = path.join(work, "find-and-cover.pdf");
    const outBytesF = Buffer.from(outB64f, "base64");
    writeFileSync(outFileF, outBytesF);
    const outTextF = execFileSync("pdftotext", [outFileF, "-"], { encoding: "utf8" });
    check("find-and-cover output: poppler extracts ZERO text from the output", outTextF.trim() === "", JSON.stringify(outTextF.slice(0, 60)));
    check("find-and-cover output: the secret exists nowhere in the output bytes", !outBytesF.includes(SECRET));

    // ------------------------------------------------- proof receipt (item 4)
    const hashCheck = await c.evalJs(
      `(async () => {
        const hexShown = document.getElementById("done-hash").textContent;
        const bytes = __blotApi.session().exported.bytes;
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        return { hexShown, hex, match: hexShown === hex, len: hexShown.length };
      })()`,
      true,
    );
    check("proof receipt: displayed hash matches an independent SHA-256 of the exact exported bytes", hashCheck.match, JSON.stringify(hashCheck));
    check("proof receipt: hash is a real 64-char hex digest, not a placeholder", hashCheck.len === 64, JSON.stringify(hashCheck));

    // ---------------------------------------------- coverage check (item 6)
    // Negative control run inline (not just at unit-test time): an
    // un-inked spot must come back NOT ok, proving this is a real check
    // and not theater.
    const covNeg = await c.evalJs(
      `(async () => {
        const bytes = new Uint8Array(__blotApi.session().exported.bytes);
        const r = await __blotTestHooks.checkCoverage(bytes, [[{ x: 5, y: 5, w: 10, h: 10 }]]);
        return r;
      })()`,
      true,
    );
    check("coverage check negative control: an un-inked spot correctly reports NOT ok", covNeg.ok === false, JSON.stringify(covNeg));

    // ------------------------------------------------------- pixelate (item 3)
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for pixelate run");
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf reopened for pixelate");
    await c.evalJs("document.getElementById('tool-pixelate').click(); 'ok'");
    check(
      "pixelate tool selectable via the toolbar",
      (await c.evalJs("document.getElementById('tool-pixelate').getAttribute('aria-checked')")) === "true",
    );
    await c.evalJs(`(() => {
      const s = __blotApi.session();
      const page = s.pages[0];
      const scale = 150 / 72;
      const y = (792 - 700 - 14) * scale;
      __blotTestHooks.addOp(page.editor, "pixelate", { x: 40 * scale, y, w: 400 * scale, h: 40 * scale });
      return page.editor.ops.length;
    })()`);
    // The addOp test hook writes straight into the editor's data model
    // (the same shortcut the ink flow above uses) and does not itself
    // trigger a canvas repaint the way a real drag does; force one so the
    // screenshot actually shows what got added.
    await c.evalJs("__blotTestHooks.render(); 'ok'");
    await sleep(500);
    const shot5 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "05-pixelate.png"), Buffer.from(shot5.result.data, "base64"));
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "pixelate export done", 60000);
    check("pixelate proof: clean badge", (await c.evalJs("document.getElementById('done-badge').textContent")) === "✓");
    const outB64p = await c.evalJs(
      `(() => { const b = __blotApi.session().exported.bytes;
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
    );
    const outFileP = path.join(work, "pixelated.pdf");
    writeFileSync(outFileP, Buffer.from(outB64p, "base64"));
    const outTextP = execFileSync("pdftotext", [outFileP, "-"], { encoding: "utf8" });
    check("pixelate output: poppler extracts ZERO text", outTextP.trim() === "", JSON.stringify(outTextP.slice(0, 60)));
    execFileSync("pdftoppm", ["-r", "72", "-png", outFileP, path.join(work, "pixpage")]);
    const pngP = readFileSync(path.join(work, "pixpage-1.png"));
    const probeP = await c.evalJs(
      `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(pngP.toString("base64"))}), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
        return { spot: at(Math.round(bmp.width * 0.3), Math.round(bmp.height * 0.12)) };
      })()`,
      true,
    );
    const brightnessP = (probeP.spot[0] + probeP.spot[1] + probeP.spot[2]) / 3;
    check("pixelate: covered region is visually distinct from solid ink (not near-black)", brightnessP > 40, JSON.stringify(probeP));

    // ------------------------------------------------ pixelate over ink
    // Pixelating across an ink box used to average the ink with the page
    // around it, so the coverage probe read light and blocked the export.
    const bakeOrder = await c.evalJs(
      `(async () => {
        const { bake } = await import("/js/render.js");
        const { createEditor, addOp } = await import("/js/editor.js");
        const ink = { x: 100, y: 50, w: 100, h: 40 };
        const pix = { x: 50, y: 20, w: 200, h: 120 };
        const page = (marks) => {
          const cv = document.createElement("canvas");
          cv.width = 400;
          cv.height = 200;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, 400, 200);
          ctx.fillStyle = "#3a6";
          ctx.fillRect(60, 30, 30, 100);
          ctx.fillRect(220, 60, 20, 70);
          if (marks) {
            ctx.fillStyle = "#000";
            ctx.fillRect(102, 52, 20, 36);
            ctx.fillRect(150, 60, 48, 28);
          }
          return cv;
        };
        const out = {};
        for (const order of [["ink", "pixelate"], ["pixelate", "ink"]]) {
          const run = (cv) => {
            const ed = createEditor(400, 200);
            for (const type of order) addOp(ed, type, type === "ink" ? ink : pix);
            const baked = bake(cv, ed);
            return baked.getContext("2d").getImageData(0, 0, baked.width, baked.height).data;
          };
          const plain = run(page(false));
          const marked = run(page(true));
          let same = plain.length === marked.length;
          for (let i = 0; same && i < plain.length; i++) if (plain[i] !== marked[i]) same = false;
          let solid = true;
          for (let y = ink.y; y < ink.y + ink.h; y++) {
            for (let x = ink.x; x < ink.x + ink.w; x++) {
              const i = (y * 400 + x) * 4;
              if (marked[i] !== 0x0e || marked[i + 1] !== 0x0c || marked[i + 2] !== 0x0a) solid = false;
            }
          }
          out[order.join(" then ")] = { same, solid };
        }
        return out;
      })()`,
      true,
    );
    for (const [order, r] of Object.entries(bakeOrder)) {
      check(`bake, ${order}: nothing under the ink reaches the output`, r.same, JSON.stringify(r));
      check(`bake, ${order}: the ink stays solid ink`, r.solid, JSON.stringify(r));
    }

    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for pixelate over ink");
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf reopened for pixelate over ink");
    const labelBefore = await c.evalJs(`(() => {
      const editor = __blotApi.session().pages[0].editor;
      __blotTestHooks.addOp(editor, "ink", { x: 100, y: 150, w: 400, h: 60 });
      __blotTestHooks.addOp(editor, "pixelate", { x: 300, y: 120, w: 400, h: 120 });
      window.__digests = 0;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (...args) => {
        window.__digests++;
        return digest(...args);
      };
      return document.getElementById("btn-export").textContent;
    })()`);
    await c.evalJs(`(() => {
      for (let i = 0; i < 2; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      return true;
    })()`);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done' && !document.getElementById('btn-export').disabled"), "pixelate over ink export done", 60000);
    await sleep(500);
    const overInk = await c.evalJs(`(() => {
      const out = {
        title: document.getElementById("done-title").textContent,
        share: !document.getElementById("btn-share").hidden,
        digests: window.__digests,
        label: document.getElementById("btn-export").textContent,
      };
      delete crypto.subtle.digest;
      return out;
    })()`);
    check("pixelate over ink: Checked clean", overInk.title === "Checked clean", JSON.stringify(overInk));
    check("pixelate over ink: Share is offered", overInk.share, JSON.stringify(overInk));
    check("two quick Ctrl+Enter presses export once", overInk.digests === 1, JSON.stringify(overInk));
    check("export button gets its own label back", overInk.label === labelBefore, JSON.stringify({ labelBefore, ...overInk }));
    const outFileOi = path.join(work, "pixelate-over-ink.pdf");
    await saveExport(c, outFileOi);
    check("pixelate over ink: poppler extracts ZERO text", execFileSync("pdftotext", [outFileOi, "-"], { encoding: "utf8" }).trim() === "");

    const failFacts = await c.evalJs(`(() => {
      __blotTestHooks.renderProof(
        { ok: true, pages: 1, textItems: 0, annotations: 0, formFields: 0 },
        { ok: false, pages: [{ page: 1, ok: false, checked: 5 }] },
        1000,
      );
      return document.getElementById("done-facts").textContent;
    })()`);
    check("failed coverage says so and names the page", failFacts.includes("Ink coverage: a covered spot re-rendered light") && /page\(s\) 1\b/.test(failFacts), failFacts);

    // ----------------------------------------------------------- crop (item 3)
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for crop run");
    await pickFile(c, textPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "text pdf reopened for crop");
    // A stray ink box outside the area about to be kept: bake() already
    // discards it, and checkCoverage must agree instead of reading its
    // now-uninked spot as "something survived" for content that was
    // never in the output to begin with.
    const strayBox = await c.evalJs(`(() => {
      const editor = __blotApi.session().pages[0].editor;
      const op = __blotTestHooks.addOp(editor, "ink", { x: editor.width - 100, y: editor.height - 100, w: 60, h: 60 });
      return !!op;
    })()`);
    check("stray ink box placed outside the area about to be kept", strayBox === true);
    await c.evalJs("document.getElementById('tool-crop').click(); 'ok'");
    const cropInfo = await c.evalJs(`(() => {
      const editor = __blotApi.session().pages[0].editor;
      const rect = { x: 0, y: 0, w: Math.round(editor.width / 2), h: Math.round(editor.height / 2) };
      return { applied: !!__blotTestHooks.setCrop(editor, rect) };
    })()`);
    check("crop applied via the editor API", cropInfo.applied === true, JSON.stringify(cropInfo));
    await c.evalJs("__blotTestHooks.render(); 'ok'");
    await sleep(500);
    const shot6 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "06-crop.png"), Buffer.from(shot6.result.data, "base64"));
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "crop export done", 60000);
    check(
      "crop proof: clean badge, including with a stray box cropped away (regression: this used to false-fail coverage)",
      (await c.evalJs("document.getElementById('done-badge').textContent")) === "✓",
    );
    const outB64c = await c.evalJs(
      `(() => { const b = __blotApi.session().exported.bytes;
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
    );
    const outFileC = path.join(work, "cropped.pdf");
    writeFileSync(outFileC, Buffer.from(outB64c, "base64"));
    const infoC = execFileSync("pdfinfo", [outFileC], { encoding: "utf8" });
    const sizeMatch = infoC.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
    const cropW = sizeMatch ? Number(sizeMatch[1]) : NaN;
    const cropH = sizeMatch ? Number(sizeMatch[2]) : NaN;
    check("crop output: MediaBox physically shrank to roughly half width and height, not stretched", cropW < 612 * 0.6 && cropH < 792 * 0.6, infoC);
    execFileSync("pdftoppm", ["-r", "72", "-png", outFileC, path.join(work, "croppage")]);
    const pngC = readFileSync(path.join(work, "croppage-1.png"));
    const dimsC = await c.evalJs(
      `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(pngC.toString("base64"))}), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        return { w: bmp.width, h: bmp.height };
      })()`,
      true,
    );
    check("crop output: rendered image pixel size is the cropped size, not the full page", dimsC.w < 450 && dimsC.h < 500, JSON.stringify(dimsC));

    // ------------------------------------------------- repeat-across-pages (item 2)
    // Driven through the real button and the real selection path
    // (addKeyboardBox is the same code "B" runs, including selecting the
    // new box), not a bare call into editor.js: this proves the wiring,
    // not just the pure function detect.test.mjs/editor.test.mjs cover.
    const twoPagePdf = path.join(fixDir, "two-page.pdf");
    writeFileSync(twoPagePdf, makeTwoPageTextPdf(["Page one, header line"], ["Page two, different header"]));
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for repeat run");
    await pickFile(c, twoPagePdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 2"), "two-page pdf opened");
    await c.evalJs("__blotTestHooks.addKeyboardBox(); 'ok'");
    check("box added and selected on page 1", (await c.evalJs("__blotApi.state.boxes")) === 1);

    // Small-motion polish (item 8): the armed-close toast and pulse were
    // previously unasserted in e2e.
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    check("close-armed toast becomes visible", (await c.evalJs("document.getElementById('toast').classList.contains('show')")) === true);
    check("close button gets the armed pulse class", (await c.evalJs("document.getElementById('btn-close').classList.contains('armed')")) === true);
    await c.evalJs("document.getElementById('page-ind').click(); 'ok'");
    check("armed class clears once disarmed", (await c.evalJs("document.getElementById('btn-close').classList.contains('armed')")) === false);

    check("repeat button appears once a box is selected on a multi-page doc", (await c.evalJs("document.getElementById('btn-repeat').hidden")) === false);
    await sleep(500);
    const shot7 = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "07-repeat.png"), Buffer.from(shot7.result.data, "base64"));
    await c.evalJs("document.getElementById('btn-repeat').click(); 'ok'");
    check("repeat-across-pages: the box landed on both pages", (await c.evalJs("__blotApi.state.boxes")) === 2);

    // ------------------------------------- suggestion on a CropBox page
    // A CropBox inside the MediaBox once moved every hit 75 px up and
    // right: accepting it inked blank paper and the SSN stayed readable.
    const cropBoxPdf = path.join(fixDir, "cropbox.pdf");
    writeFileSync(cropBoxPdf, makeCropBoxPdf(SECRET));
    const bboxXml = execFileSync("pdftotext", ["-cropbox", "-bbox", cropBoxPdf, "-"], { encoding: "utf8" });
    const wm = bboxXml.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">[^<]*123-45-6789<\/word>/);
    check("negative control: poppler finds the SSN word on the CropBox input", !!wm, bboxXml);
    const [wx0, wy0, wx1, wy1] = (wm ? wm.slice(1) : [0, 0, 0, 0]).map((v) => (Number(v) * 150) / 72);
    // Helvetica advance widths: "SECRET-SSN-" is 6778 of the line's 12448 units.
    const ssnBox = { x: wx0 + ((wx1 - wx0) * 6778) / 12448, y: wy0, w: ((wx1 - wx0) * 5670) / 12448, h: wy1 - wy0 };
    const inputGray = meanGray(cropBoxPdf, ssnBox, work);
    check("negative control: the uncovered SSN fails the ink test in the input", inputGray > 60 && inputGray < 245, `mean ${inputGray.toFixed(1)}`);
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start for CropBox run");
    await pickFile(c, cropBoxPdf);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "CropBox pdf opened");
    const accepted = await c.evalJs(`(() => {
      const p = __blotApi.session().pages[0];
      const s = p.suggestions.find((x) => x.pattern === "ssn");
      if (!s) return null;
      __blotTestHooks.acceptSuggestion(s);
      return s.rect;
    })()`);
    check("CropBox page: the sweep offers the SSN", !!accepted, JSON.stringify(accepted));
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "CropBox export done", 60000);
    check("CropBox page: Checked clean", (await c.evalJs("document.getElementById('done-title').textContent")) === "Checked clean");
    const outFileCb = path.join(work, "cropbox-out.pdf");
    await saveExport(c, outFileCb);
    check("CropBox page: poppler extracts ZERO text from the output", execFileSync("pdftotext", [outFileCb, "-"], { encoding: "utf8" }).trim() === "");
    const ssnGray = meanGray(outFileCb, ssnBox, work);
    check("CropBox page: the SSN's own spot is inked in the output", ssnGray < 60, `mean ${ssnGray.toFixed(1)} over ${JSON.stringify(ssnBox)}`);

    const finalErrs = await c.evalJs("(__blotErrors || []).slice(0, 10)");
    check("console stayed clean across every new flow (find-and-cover, pixelate, crop, repeat)", finalErrs.length === 0, JSON.stringify(finalErrs));

    c.close();
  } finally {
    chromium.kill();
    server.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(work, { recursive: true, force: true });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E APP PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
