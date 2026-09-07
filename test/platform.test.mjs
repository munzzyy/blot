// Wrapper detection and native delivery routing, exercised directly with
// fakes: no browser needed for this part, and a real WKWebView is not
// available in CI anyway. The negative control matters as much as the
// happy path: a stale iOS build with no save bridge must fail loud, not
// silently fall through to a downstream path that iOS's navigation
// policy would cancel without telling anyone.

import test from "node:test";
import assert from "node:assert/strict";
import { isIOSScheme, isWrapper, canDeliverNative, deliverNative, toBase64 } from "../app/js/platform.js";

function withGlobals(vals, fn) {
  const had = {};
  for (const k of Object.keys(vals)) had[k] = { has: k in globalThis, value: globalThis[k] };
  try {
    for (const [k, v] of Object.entries(vals)) globalThis[k] = v;
    return fn();
  } finally {
    for (const k of Object.keys(vals)) {
      if (had[k].has) globalThis[k] = had[k].value;
      else delete globalThis[k];
    }
  }
}

test("plain web: not a wrapper, cannot deliver natively", () => {
  withGlobals({ location: { protocol: "https:" }, BlotNative: undefined, webkit: undefined }, () => {
    assert.equal(isIOSScheme(), false);
    assert.equal(isWrapper(), false);
    assert.equal(canDeliverNative(), false);
    assert.equal(deliverNative("save", new Uint8Array([1]), "application/pdf", "x.pdf"), false);
  });
});

test("android: wrapper and deliverable via BlotNative", () => {
  const calls = [];
  const native = {
    shareFile: (b64, mime, name) => calls.push(["share", b64, mime, name]),
    saveFile: (b64, mime, name) => calls.push(["save", b64, mime, name]),
  };
  withGlobals({ location: { protocol: "https:" }, BlotNative: native, webkit: undefined }, () => {
    assert.equal(isWrapper(), true);
    assert.equal(canDeliverNative(), true);
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(deliverNative("share", bytes, "application/pdf", "out.pdf"), true);
    assert.deepEqual(calls[0], ["share", toBase64(bytes), "application/pdf", "out.pdf"]);
  });
});

test("iOS with the save bridge present: wrapper, deliverable, message posted", () => {
  const posted = [];
  withGlobals(
    {
      location: { protocol: "blot:" },
      BlotNative: undefined,
      webkit: { messageHandlers: { save: { postMessage: (msg) => posted.push(msg) } } },
    },
    () => {
      assert.equal(isIOSScheme(), true);
      assert.equal(isWrapper(), true);
      assert.equal(canDeliverNative(), true);
      const bytes = new Uint8Array([9, 9, 9]);
      const ok = deliverNative("save", bytes, "application/pdf", "redacted-x.pdf");
      assert.equal(ok, true);
      assert.deepEqual(posted, [{ name: "redacted-x.pdf", mime: "application/pdf", b64: toBase64(bytes) }]);
    },
  );
});

test("negative control: iOS scheme with NO save bridge is a wrapper but cannot deliver", () => {
  withGlobals({ location: { protocol: "blot:" }, BlotNative: undefined, webkit: undefined }, () => {
    assert.equal(isIOSScheme(), true);
    assert.equal(isWrapper(), true, "UI must still treat this as a wrapper (strip web-only landing)");
    assert.equal(canDeliverNative(), false, "no bridge exists, so nothing can be delivered");
    const ok = deliverNative("save", new Uint8Array([1]), "application/pdf", "x.pdf");
    assert.equal(ok, false, "must report failure instead of silently doing nothing");
  });
});

test("negative control: iOS scheme with an empty messageHandlers object still cannot deliver", () => {
  withGlobals({ location: { protocol: "blot:" }, BlotNative: undefined, webkit: { messageHandlers: {} } }, () => {
    assert.equal(canDeliverNative(), false);
    assert.equal(deliverNative("share", new Uint8Array([1]), "application/pdf", "x.pdf"), false);
  });
});
