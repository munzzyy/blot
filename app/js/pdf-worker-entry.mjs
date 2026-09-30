// The module Worker pdf.mjs launches for pdf.worker.mjs runs on its own
// global, so a shim imported by the main-thread bundle never reaches it.
// This is what GlobalWorkerOptions.workerSrc points at instead: the shim
// runs first, then the real worker module, unmodified.
import "./old-webview-shims.mjs";
import "../vendor/pdfjs/pdf.worker.mjs";
