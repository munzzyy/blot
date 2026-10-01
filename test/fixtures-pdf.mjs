// Hand-assembled PDFs for tests: a real text document (the thing Blot must
// destroy), an AcroForm document, and a signature-field document (both of
// which Blot must refuse). Offsets are computed, not hand-counted.

const enc = new TextEncoder();

function assemble(bodyObjects) {
  const header = "%PDF-1.4\n";
  let out = header;
  const offsets = new Map();
  for (const { id, src } of bodyObjects) {
    offsets.set(id, out.length);
    out += src;
  }
  const maxId = Math.max(...bodyObjects.map((o) => o.id));
  const xrefAt = out.length;
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    out += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return enc.encode(out);
}

// One page of Helvetica text lines.
export function makeTextPdf(lines) {
  const content = `BT /F1 12 Tf 50 700 Td ${lines
    .map((l, i) => `${i ? "0 -20 Td " : ""}(${l.replace(/[\\()]/g, "\\$&")}) Tj `)
    .join("")}ET`;
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    {
      id: 3,
      src:
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    },
    { id: 4, src: "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" },
    { id: 5, src: `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` },
  ]);
}

const pdfString = (s) => `(${s.replace(/[\\()]/g, "\\$&")})`;

// One line of Helvetica text on a page with whatever geometry the caller
// gives it: a CropBox, a MediaBox that does not start at 0 0, a /Rotate,
// or a rotated text matrix.
function oneLinePdf(text, { box = "/MediaBox [0 0 612 792]", tm = "1 0 0 1 50 700" } = {}) {
  const content = `BT /F1 12 Tf ${tm} Tm ${pdfString(text)} Tj ET`;
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    {
      id: 3,
      src: `3 0 obj\n<< /Type /Page /Parent 2 0 R ${box} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    },
    { id: 4, src: "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" },
    { id: 5, src: `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` },
  ]);
}

export const makeCropBoxPdf = (text) => oneLinePdf(text, { box: "/MediaBox [0 0 612 792] /CropBox [36 36 576 756]" });
export const makeOffsetOriginPdf = (text) => oneLinePdf(text, { box: "/MediaBox [100 100 712 892]", tm: "1 0 0 1 150 800" });
export const makeRotatedPagePdf = (text) => oneLinePdf(text, { box: "/MediaBox [0 0 612 792] /Rotate 90" });
export const makeRotatedTextPdf = (text) => oneLinePdf(text, { tm: "0 1 -1 0 300 200" });

// A name whose surname switches to bold: pdf.js hands it over as separate items.
export function makeBoldSurnamePdf() {
  const content = "BT /F1 12 Tf 50 700 Td (Patient: John ) Tj /F2 12 Tf (Smith) Tj ET";
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    {
      id: 3,
      src:
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    },
    { id: 4, src: "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" },
    { id: 5, src: `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` },
    { id: 6, src: "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n" },
  ]);
}

// Two pages, same size, for exercising repeat-across-pages: a box drawn
// on page 1 should be cloneable onto page 2.
export function makeTwoPageTextPdf(page1Lines, page2Lines) {
  const c1 = `BT /F1 12 Tf 50 700 Td ${page1Lines.map((l, i) => `${i ? "0 -20 Td " : ""}(${l.replace(/[\\()]/g, "\\$&")}) Tj `).join("")}ET`;
  const c2 = `BT /F1 12 Tf 50 700 Td ${page2Lines.map((l, i) => `${i ? "0 -20 Td " : ""}(${l.replace(/[\\()]/g, "\\$&")}) Tj `).join("")}ET`;
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R 4 0 R ] /Count 2 >>\nendobj\n" },
    {
      id: 3,
      src:
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    },
    {
      id: 4,
      src:
        "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>\nendobj\n",
    },
    { id: 5, src: `5 0 obj\n<< /Length ${c1.length} >>\nstream\n${c1}\nendstream\nendobj\n` },
    { id: 6, src: "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" },
    { id: 7, src: `7 0 obj\n<< /Length ${c2.length} >>\nstream\n${c2}\nendstream\nendobj\n` },
  ]);
}

// A scanned page: an image XObject, no BT/Tj text content anywhere.
export function makeImageOnlyPdf() {
  const pixel = String.fromCharCode(0x40); // stays under 128 so assemble()'s TextEncoder pass leaves it unchanged
  const content = "q 400 0 0 400 100 100 cm /Im1 Do Q";
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    {
      id: 3,
      src:
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    },
    { id: 5, src: `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` },
    {
      id: 6,
      src:
        "6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 " +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n${pixel}\nendstream\nendobj\n`,
    },
  ]);
}

function formPdf(fieldExtra) {
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [ 6 0 R ] >> >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    {
      id: 3,
      src:
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Annots [ 6 0 R ] /Contents 5 0 R >>\nendobj\n",
    },
    { id: 5, src: "5 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n" },
    {
      id: 6,
      src:
        "6 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [ 50 600 300 620 ] " +
        `${fieldExtra} /T (field1) /P 3 0 R >>\nendobj\n`,
    },
  ]);
}

export const makeFormPdf = () => formPdf("/FT /Tx /V (typed-into-a-form)");
export const makeBlankFormPdf = () => formPdf("/FT /Tx /V ()");
export const makeSigPdf = () => formPdf("/FT /Sig");

// A pure XFA form: the catalog says it needs rendering and the AcroForm
// carries an XFA template but no AcroForm fields of its own.
export function makeXfaPdf() {
  const xdp =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">\n' +
    '<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">\n' +
    '<subform name="form1" layout="tb" locale="en_US">\n' +
    '<pageSet><pageArea name="Page1" id="Page1"><contentArea x="0.25in" y="0.25in" w="8in" h="10.5in"/>' +
    '<medium stock="letter" short="8.5in" long="11in"/></pageArea></pageSet>\n' +
    '<subform w="8in" h="10.5in"><field name="Name" w="3in" h="0.3in"><ui><textEdit/></ui></field></subform>\n' +
    "</subform>\n</template>\n</xdp:xdp>";
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /NeedsRendering true /AcroForm << /Fields [] /XFA 6 0 R >> >>\nendobj\n" },
    { id: 2, src: "2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n" },
    { id: 3, src: "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n" },
    { id: 5, src: "5 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n" },
    { id: 6, src: `6 0 obj\n<< /Length ${xdp.length} >>\nstream\n${xdp}\nendstream\nendobj\n` },
  ]);
}

// n blank one-inch pages: small enough that the page limit itself renders fast.
export function makeLongPdf(n) {
  const kids = Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(" ");
  return assemble([
    { id: 1, src: "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" },
    { id: 2, src: `2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${n} >>\nendobj\n` },
    ...Array.from({ length: n }, (_, i) => ({
      id: i + 3,
      src: `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>\nendobj\n`,
    })),
  ]);
}

// Bytes that are not a PDF at all, the same every run.
export function makeGarbagePdf(length = 4096) {
  const out = new Uint8Array(length);
  let x = 0x2545;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

// An /Encrypt entry in the trailer makes readers demand a password; the
// dict here is not a valid cipher setup, which is fine: the load must
// refuse either way.
export function makeEncryptedish() {
  const base = new TextDecoder("latin1").decode(makeTextPdf(["locked"]));
  const patched = base.replace("/Root 1 0 R >>", "/Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -44 >> >>");
  return Uint8Array.from(patched, (c) => c.charCodeAt(0));
}
