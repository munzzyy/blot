// What pdf.js 6.3.289's legacy build still calls on a WebView older than Chromium 124.

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

// pdf.js never touches the source buffer again, so a copy that does not detach it is enough.
if (typeof ArrayBuffer.prototype.transferToFixedLength !== "function") {
  ArrayBuffer.prototype.transferToFixedLength = function transferToFixedLength(newByteLength) {
    const length = newByteLength === undefined ? this.byteLength : newByteLength;
    const dest = new ArrayBuffer(length);
    new Uint8Array(dest).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
    return dest;
  };
}

if (typeof ReadableStream !== "undefined" && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = function asyncIterator() {
    const reader = this.getReader();
    return {
      async next() {
        const step = await reader.read();
        if (step.done) reader.releaseLock();
        return step;
      },
      async return(value) {
        const cancelled = reader.cancel(value);
        reader.releaseLock();
        await cancelled;
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}
