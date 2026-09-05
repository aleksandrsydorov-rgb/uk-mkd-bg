export async function downloadHtmlAsPdf(filename: string, html: string) {
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
    pdf.save(filename);
  } finally {
    host.remove();
  }
}
