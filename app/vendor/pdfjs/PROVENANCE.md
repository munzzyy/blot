# Vendored: pdfjs-dist 6.3.289 (Apache-2.0, Mozilla)

The one third-party dependency in this app, vendored deliberately:
rendering PDFs safely is a decade of Mozilla's work and not something to
hand-roll. Files are the NON-minified legacy build, taken unmodified from
the npm tarball whose sha512 integrity matched the registry record at
vendoring time:

    pdfjs-dist-6.3.289.tgz
    sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==

To re-verify: `npm view pdfjs-dist@6.3.289 dist.integrity`, download the
tarball, hash it, diff these files against legacy/build/ inside it.

Runtime containment: the app's CSP has no unsafe-eval (PDF.js is loaded
with isEvalSupported false), no network origins, and the worker runs
same-origin. PDF.js parses hostile bytes, but it does so inside the same
sandbox every Firefox user already trusts it in.
