async function renderHtmlToPdf(html: string) {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const html2canvas = html2canvasMod.default;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: 794,
    });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    let y = 0;
    let remaining = imgH;
    pdf.addImage(imgData, 'JPEG', 0, y, imgW, imgH);
    remaining -= pageH;
    while (remaining > 0.5) {
      y -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, y, imgW, imgH);
      remaining -= pageH;
    }
    return pdf;
  } finally {
    host.remove();
  }
}

export async function downloadHtmlAsPdf(filename: string, html: string) {
  const pdf = await renderHtmlToPdf(html);
  pdf.save(filename);
}

/** Build a real PDF Blob from frozen HTML (browser). */
export async function htmlToPdfBlob(html: string): Promise<Blob> {
  const pdf = await renderHtmlToPdf(html);
  return pdf.output('blob');
}

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True only when bytes start with %PDF */
export function looksLikePdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (
    u8.length >= 4 &&
    u8[0] === 0x25 &&
    u8[1] === 0x50 &&
    u8[2] === 0x44 &&
    u8[3] === 0x46
  );
}
