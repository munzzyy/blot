// Gaps pdf.js 6.3.289's legacy build does not cover on an Android System
// WebView older than about Chromium 124, found by actually opening a PDF
// there rather than by reading the bundle. Import this before pdf.mjs
// (main thread, from pdfdoc.js) and before pdf.worker.mjs (worker thread,
// from pdf-worker-entry.mjs). Neither vendored file is touched.

// The legacy build's core-js bundle polyfills Math.sumPrecise, Promise.try,
// Uint8Array.fromBase64/toHex and URL.parse for engines that lack them, but
// not Promise.withResolvers, which both files call unguarded and often,
// once per pending capability. Chrome shipped it at 119; without this the
// app throws before it gets past opening the document.
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// pdf.worker.mjs calls ArrayBuffer.prototype.transferToFixedLength while
// compiling substituted system font data for a page's operator list, an
// ArrayBuffer method Chrome shipped at 114. pdf.js only reads the returned
// buffer and never touches the original afterward, so a copy that does not
// truly detach the source is functionally equivalent here.
if (typeof ArrayBuffer.prototype.transferToFixedLength !== "function") {
  ArrayBuffer.prototype.transferToFixedLength = function transferToFixedLength(newByteLength) {
    const length = newByteLength === undefined ? this.byteLength : newByteLength;
    const dest = new ArrayBuffer(length);
    new Uint8Array(dest).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
    return dest;
  };
}

// Both files read a page's text and operator list with
// `for await (const x of readableStream)`, which needs
// ReadableStream.prototype[Symbol.asyncIterator]. Chrome shipped that at
// 124; without it every render throws "readableStream is not async
// iterable" and the page that was about to open bounces back to the start
// screen. The reference shape from the Streams spec: wrap a reader.
if (typeof ReadableStream !== "undefined" && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = function asyncIterator() {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      return: (value) => {
        reader.releaseLock();
        return Promise.resolve({ done: true, value });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}
