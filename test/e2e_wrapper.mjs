// Wrapper-mode contract: web-only sections gone, a shared-in PDF opens
// straight into the editor, and the export leaves through the bridge.
//
// Run from the repo root:  node test/e2e_wrapper.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { makeTextPdf } from "./fixtures-pdf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8962;
const CDP_PORT = 9362;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

const fails = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name} ${detail}`);
    fails.push(name);
  }
}

const BRIDGE_STUB = `window.BlotNative = {
  platform: () => "android",
  version: () => "e2e",
  sharedTokens: () => JSON.stringify(["e2etoken"]),
  shareFile: (b64, mime, name) => { window.__shared = { size: b64.length, mime, name }; },
  saveFile: (b64, mime, name) => { window.__saved = { size: b64.length, mime, name }; },
};`;

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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
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

async function main() {
  mkdirSync(path.join(ROOT, "test", "fixtures"), { recursive: true });
  writeFileSync(path.join(ROOT, "test", "fixtures", "shared.pdf"), makeTextPdf(["Shared document", "with text to remove"]));
  const profile = mkdtempSync(path.join(tmpdir(), "blot-wrap-e2e-"));
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

    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
    const tab = await res.json();
    const c = connect(tab.webSocketDebuggerUrl);
    await c.open;
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE_STUB });
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send("Page.navigate", { url: BASE + "/" });
    await waitFor(() => c.evalJs("!!window.__blotApi"), "app booted");

    check("wrapper: web-only sections removed", (await c.evalJs("document.querySelectorAll('.web-only').length")) === 0);
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'edit' && __blotApi.state.pages === 1"), "shared pdf opened");
    check("share-in: shared PDF opens into the editor", true);

    await c.evalJs(`(() => {
      const { addOp } = window.__blotTestHooks;
      const page = __blotApi.session().pages[0];
      addOp(page.editor, "ink", { x: 50, y: 50, w: 300, h: 80 });
    })()`);
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__blotApi.state.screen === 'done'"), "export done", 60000);
    await c.evalJs("document.getElementById('btn-share').click(); 'ok'");
    await waitFor(() => c.evalJs("!!window.__shared"), "share handed to bridge");
    const out = await c.evalJs("window.__shared");
    check("share-out: pdf reaches the bridge", out.size > 1000 && out.mime === "application/pdf" && /^redacted-[a-z2-9]{4}\.pdf$/.test(out.name), JSON.stringify(out));

    const errs = await c.evalJs("(__blotErrors || []).slice(0, 5)");
    check("console clean", errs.length === 0, JSON.stringify(errs));
    c.close();
  } finally {
    chromium.kill();
    server.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E WRAPPER PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
