# Vendored: pdfjs-dist 6.3.289 (Apache-2.0, Mozilla)

The one third-party dependency in this app, vendored deliberately:
rendering PDFs safely is a decade of Mozilla's work and not something to
hand-roll. Files are the NON-minified legacy build, taken unmodified from
the npm tarball whose sha512 integrity matched the registry record at
vendoring time:

    pdfjs-dist-6.3.289.tgz
    sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==

`pdf.mjs` and `pdf.worker.mjs` come from `legacy/build/` in that tarball.
`wasm/` is the tarball's own `wasm/` directory, copied whole: the JBIG2
and JPEG2000 decoders pdf.worker.mjs loads at runtime for pages that use
those codecs, plus their pure-JS fallbacks and per-codec licenses. Without
it the worker's fetch for `jbig2.wasm`/`openjpeg.wasm` fails, the page
image comes back blank, and nothing in the UI says so. `app/js/pdfdoc.js`
points `getDocument()` at this directory via the `wasmUrl` option.

`SHA256SUMS` lists a sha256 for every vendored file, computed once at
vendoring time from these same extracted files. Re-verify with
`sha256sum -c SHA256SUMS` from this directory; CI runs the same check on
every push (`.github/workflows/ci.yml`, "vendored pdf.js checksums").
That step catches drift in the files already here. To check the files
themselves against the registry instead:

    npm view pdfjs-dist@6.3.289 dist.integrity
    curl -sL -o pdfjs-dist-6.3.289.tgz https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz
    sha512sum pdfjs-dist-6.3.289.tgz   # compare against dist.integrity, base64-decoded
    tar xzf pdfjs-dist-6.3.289.tgz
    diff pdf.mjs package/legacy/build/pdf.mjs
    diff pdf.worker.mjs package/legacy/build/pdf.worker.mjs
    diff -r wasm package/wasm

Runtime containment: the app's CSP has no unsafe-eval (PDF.js is loaded
with isEvalSupported false), no network origins, and the worker runs
same-origin. PDF.js parses hostile bytes, but it does so inside the same
sandbox every Firefox user already trusts it in.
