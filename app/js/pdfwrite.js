// Minimal PDF writer: image-only pages, nothing else. The whole point of
// the output format is what it cannot contain: no text layer, no fonts,
// no annotations, no forms, no info dictionary, no metadata stream. One
// JPEG per page, placed at the page's physical size.

const enc = new TextEncoder();

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// pages: [{ jpeg: Uint8Array, width, height, widthPt, heightPt }]
export function buildPdf(pages) {
  const objects = [];
  const kidsIds = [];
  let nextId = 3;
  for (const page of pages) {
    const imgId = nextId++;
    const contentId = nextId++;
    const pageId = nextId++;
    kidsIds.push(pageId);
    objects.push({
      id: imgId,
      head:
        `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      stream: page.jpeg,
      tail: "\nendstream\nendobj\n",
    });
    const w = page.widthPt.toFixed(2);
    const h = page.heightPt.toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    objects.push({
      id: contentId,
      head: `${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`,
      stream: enc.encode(content),
      tail: "\nendstream\nendobj\n",
    });
    objects.push({
      id: pageId,
      head:
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    });
  }
  const header = enc.encode("%PDF-1.4\n%\xb5\xb6\n");
  const catalog = enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pagesObj = enc.encode(
    `2 0 obj\n<< /Type /Pages /Kids [ ${kidsIds.map((id) => `${id} 0 R`).join(" ")} ] /Count ${pages.length} >>\nendobj\n`,
  );

  const parts = [];
  const offsets = new Map();
  parts.push(header);
  let cursor = header.length;
  offsets.set(1, cursor);
  parts.push(catalog);
  cursor += catalog.length;
  offsets.set(2, cursor);
  parts.push(pagesObj);
  cursor += pagesObj.length;
  for (const obj of objects) {
    offsets.set(obj.id, cursor);
    const head = enc.encode(obj.head);
    parts.push(head);
    cursor += head.length;
    if (obj.stream) {
      parts.push(obj.stream);
      cursor += obj.stream.length;
      const tail = enc.encode(obj.tail);
      parts.push(tail);
      cursor += tail.length;
    }
  }
  const maxId = nextId - 1;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    xref += `${String(offsets.get(id)).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  parts.push(enc.encode(xref + trailer));
  return concat(parts);
}
