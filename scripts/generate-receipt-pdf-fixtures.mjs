/**
 * Generate isolated receipt PDF fixtures (no DB writes) for visual print review.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const root = process.cwd();
const outDir = path.join(root, 'tmp', 'receipts', 'layout-v2');
fs.mkdirSync(outDir, { recursive: true });

// Use vitest/tsx-less dynamic import via compiled path is hard; call jsPDF directly mirroring builder.
const { jsPDF } = await import('jspdf');

function loadFont(name) {
  return fs.readFileSync(path.join(root, 'public', 'fonts', name)).toString('base64');
}

const regular = loadFont('NotoSans-Regular.ttf');
const bold = loadFont('NotoSans-Bold.ttf');

function makePdf({ titleExtra = '', lines = 2, longNames = false, voided = false }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.addFileToVFS('NotoSans-Regular.ttf', regular);
  pdf.addFileToVFS('NotoSans-Bold.ttf', bold);
  pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  pdf.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  const M = 18;
  const W = 210 - M * 2;
  let y = M;
  pdf.setFont('NotoSans', 'bold');
  pdf.setFontSize(16);
  const title = 'КВИТАНЦИЯ ЗА ПОЛУЧЕНО ПЛАЩАНЕ';
  pdf.text(title, M + (W - pdf.getTextWidth(title)) / 2, y + 5);
  y += 12;
  pdf.setFont('NotoSans', 'normal');
  pdf.setFontSize(9.5);
  const meta = `Серия KP · № 000002   ·   Дата на издаване: 05.11.2026   ·   Дата на плащане: 05.11.2026${titleExtra}`;
  pdf.text(meta, M + (W - pdf.getTextWidth(meta)) / 2, y);
  y += 8;
  pdf.setDrawColor('#c8c8c8');
  pdf.setLineWidth(0.25);
  pdf.line(M, y, M + W, y);
  y += 6;

  const payer = longNames
    ? 'Тестов Платец ООД с изключително дълго юридическо наименование за проверка на пренос'
    : 'Тестов Платец ООД';
  const mgmt = longNames
    ? 'Управляваща компания Амадеус Единадесет ООД с допълнителен текст в наименованието'
    : 'УК Амадеус 11 ООД';

  pdf.setFont('NotoSans', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor('#555555');
  pdf.text('ПОЛУЧАТЕЛ', M, y);
  pdf.text('ВНОСИТЕЛ', M + W / 2 + 3, y);
  y += 5;
  pdf.setTextColor('#111111');
  pdf.setFont('NotoSans', 'bold');
  pdf.setFontSize(10.5);
  const leftLines = pdf.splitTextToSize(mgmt, W / 2 - 4);
  const rightLines = pdf.splitTextToSize(payer, W / 2 - 4);
  leftLines.forEach((l, i) => pdf.text(l, M, y + i * 4.4));
  rightLines.forEach((l, i) => pdf.text(l, M + W / 2 + 3, y + i * 4.4));
  y += Math.max(leftLines.length, rightLines.length) * 4.4 + 8;

  pdf.setFont('NotoSans', 'normal');
  pdf.setFontSize(9.5);
  pdf.text('Комплекс: Amadeus 11 · ул. Пример 11, 8256 Слънчев бряг', M, y);
  y += 8;

  // table
  const drawHeader = () => {
    pdf.setFillColor(240, 240, 240);
    pdf.rect(M, y, W, 7.5, 'FD');
    pdf.setFont('NotoSans', 'bold');
    pdf.setFontSize(9.5);
    pdf.text('Основание / период', M + 3, y + 5);
    const h = 'Сума';
    pdf.text(h, M + W - 3 - pdf.getTextWidth(h), y + 5);
    y += 7.5;
  };
  drawHeader();
  for (let i = 0; i < lines; i += 1) {
    const rowH = 9;
    if (y + rowH > 297 - M - 50) {
      // stamp/sign reserve on last page only — for middle pages continue
      if (y + rowH > 297 - M - 8) {
        pdf.addPage();
        y = M;
        drawHeader();
      }
    }
    pdf.setDrawColor('#cfcfcf');
    pdf.rect(M, y, W, rowH);
    pdf.setFont('NotoSans', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Услуга ${i + 1} · период 2026-${String((i % 12) + 1).padStart(2, '0')}`, M + 3, y + 5.5);
    const amt = '12,50 EUR';
    pdf.text(amt, M + W - 3 - pdf.getTextWidth(amt), y + 5.5);
    y += rowH;
  }

  y += 6;
  if (y > 297 - M - 55) {
    pdf.addPage();
    y = M;
  }
  pdf.setFont('NotoSans', 'bold');
  pdf.setFontSize(10);
  pdf.text('Получена сума', M, y);
  pdf.setFontSize(15);
  const total = `${(lines * 12.5).toFixed(2).replace('.', ',')} EUR`;
  pdf.text(total, M + W - pdf.getTextWidth(total), y);
  y += 8;
  pdf.setFont('NotoSans', 'normal');
  pdf.setFontSize(10);
  pdf.text('Сто двадесет и пет евро и петдесет евроцента', M, y);
  y += 8;
  pdf.setFontSize(9.5);
  pdf.text('Начин на плащане: Банков превод', M, y);
  y += 5;
  pdf.text('Банкова операция: TRX-998877', M, y);
  y += 8;

  // stamp no rotation
  const stamp = 34;
  const sx = M + W - stamp;
  const sy = y;
  pdf.setDrawColor(voided ? '#8a1f1f' : '#1a6b4a');
  pdf.setTextColor(voided ? '#8a1f1f' : '#1a6b4a');
  pdf.setLineWidth(0.7);
  pdf.rect(sx, sy, stamp, stamp);
  pdf.setFont('NotoSans', 'bold');
  pdf.setFontSize(8);
  const st = voided ? ['АНУЛИРАНА'] : ['ПЛАЩАНЕТО', 'Е ПОЛУЧЕНО'];
  st.forEach((t, i) => {
    pdf.text(t, sx + (stamp - pdf.getTextWidth(t)) / 2, sy + 12 + i * 5);
  });
  pdf.text('05.11.2026', sx + (stamp - pdf.getTextWidth('05.11.2026')) / 2, sy + 26);
  pdf.setTextColor('#111111');

  pdf.setFont('NotoSans', 'normal');
  pdf.setFontSize(9.5);
  pdf.text('Получил сумата: Админ Тест', M, y + 4);
  pdf.line(M, y + 14, M + 55, y + 14);
  pdf.setFontSize(9);
  pdf.text('Подпис: ____________', M, y + 19);
  pdf.setFontSize(9.5);
  pdf.text(`Вносител: ${payer}`.slice(0, 42), M + 60, y + 4);
  pdf.line(M + 60, y + 14, M + 115, y + 14);
  pdf.setFontSize(9);
  pdf.text('Подпис: ____________', M + 60, y + 19);

  y = Math.max(y + 28, sy + stamp + 4);
  pdf.setFontSize(9);
  pdf.setTextColor('#555555');
  pdf.text('Не замества фискален бон, когато такъв се изисква.', M, y);

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setFont('NotoSans', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor('#777777');
    const label = `${p} / ${pages}`;
    pdf.text(label, 105 - pdf.getTextWidth(label) / 2, 297 - M + 4);
  }
  return pdf;
}

const cases = [
  { name: 'short-one-payment', lines: 1, longNames: false },
  { name: 'long-party-names', lines: 2, longNames: true },
  { name: 'multi-services', lines: 5, longNames: false },
  { name: 'multipage-many-lines', lines: 42, longNames: false },
];

for (const c of cases) {
  const pdf = makePdf(c);
  const file = path.join(outDir, `${c.name}.pdf`);
  fs.writeFileSync(file, Buffer.from(pdf.output('arraybuffer')));
  console.log('wrote', file, 'pages', pdf.getNumberOfPages());
}

console.log('MARGIN_MM=18 fixtures ready in', outDir);
console.log('NOTE: production generator is src/lib/paymentReceipts/buildReceiptPdf.ts — these fixtures mirror layout constraints for review.');
