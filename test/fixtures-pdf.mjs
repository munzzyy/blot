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
export const makeSigPdf = () => formPdf("/FT /Sig");

// An /Encrypt entry in the trailer makes readers demand a password; the
// dict here is not a valid cipher setup, which is fine: the load must
// refuse either way.
export function makeEncryptedish() {
  const base = new TextDecoder("latin1").decode(makeTextPdf(["locked"]));
  const patched = base.replace("/Root 1 0 R >>", "/Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -44 >> >>");
  return Uint8Array.from(patched, (c) => c.charCodeAt(0));
}
