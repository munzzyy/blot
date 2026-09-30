// pdf.mjs starts this as its own module Worker, which never sees the main thread's shims.
import "./old-webview-shims.mjs";
import "../vendor/pdfjs/pdf.worker.mjs";
