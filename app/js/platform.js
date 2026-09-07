// Host detection and native delivery. Android injects BlotNative directly
// into the page; there is nothing equivalent to detect it by scheme. iOS
// injects no globalThis object at all, only a WKScriptMessageHandler
// reachable at webkit.messageHandlers.save, so wrapper-mode UI (stripping
// the web landing, no browser-install hints) has to be driven by the
// blot: origin itself, independent of whether the save bridge exists yet.

export const isIOSScheme = () => globalThis.location?.protocol === "blot:";
const iosSaveHandler = () => globalThis.webkit?.messageHandlers?.save ?? null;

// True inside either wrapper shell, regardless of whether the iOS save
// bridge is actually present. Drives UI-only behavior.
export const isWrapper = () => !!globalThis.BlotNative || isIOSScheme();

// True only when there is a real way to hand a finished file to the OS.
// Narrower than isWrapper(): a wrapper build shipped before the bridge
// existed is still on the blot: scheme but cannot deliver anything, and
// that case must fail loud rather than fall through to a web download
// that the navigation policy silently kills.
export const canDeliverNative = () => !!globalThis.BlotNative || (isIOSScheme() && !!iosSaveHandler());

export function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Hands the file to whichever native bridge is present and returns true,
// or returns false if none exists. Never throws, never silently no-ops:
// the caller decides what "false" means to the user.
export function deliverNative(kind, bytes, mime, name) {
  const android = globalThis.BlotNative;
  if (android) {
    const b64 = toBase64(bytes);
    if (kind === "share") android.shareFile(b64, mime, name);
    else android.saveFile(b64, mime, name);
    return true;
  }
  const handler = isIOSScheme() ? iosSaveHandler() : null;
  if (handler) {
    handler.postMessage({ name, mime, b64: toBase64(bytes) });
    return true;
  }
  return false;
}
