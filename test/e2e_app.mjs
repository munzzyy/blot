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
import { makeTextPdf, makeFormPdf, makeBlankFormPdf, makeSigPdf, makeEncryptedish } from "./fixtures-pdf.mjs";

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
