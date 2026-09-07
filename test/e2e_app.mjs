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
import { makeTextPdf, makeFormPdf, makeBlankFormPdf, makeSigPdf, makeEncryptedish, makeTwoPageTextPdf } from "./fixtures-pdf.mjs";

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
    for (const [file, label] of [
      [formPdf, "filled form"],
      [sigPdf, "digitally signed"],
      [lockedPdf, "password"],
    ]) {
      await pickFile(c, file);
      await waitFor(() => c.evalJs("__blotApi.state.screen === 'refusal'"), `refusal for ${label}`);
      const title = await c.evalJs("document.getElementById('refusal-title').textContent");
      check(`refuses the ${label} fixture`, title.length > 5, title);
      await c.evalJs("document.getElementById('btn-refusal-back').click(); 'ok'");
      await waitFor(() => c.evalJs("__blotApi.state.screen === 'start'"), "back to start");
    }

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
