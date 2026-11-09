import { jsPDF } from 'jspdf';
import { amountEurToWordsBg } from '@/lib/paymentReceipts/amountWordsBg';
import {
  RECEIPT_CONTENT_W_MM,
  RECEIPT_MARGIN_MM,
  RECEIPT_PAGE_H_MM,
  RECEIPT_PAGE_W_MM,
  formatReceiptDateBg,
  formatReceiptMoney,
  formatReceiptSeriesNumber,
  receiptLineAmount,
  receiptLineDescription,
  receiptPaymentMethodLabel,
  receiptPurposeLines,
} from '@/lib/paymentReceipts/receiptFormat';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

type FontCache = { regular: string; bold: string } | null;
let fontCache: FontCache = null;

async function arrayBufferToBase64(buf: ArrayBuffer): Promise<string> {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64');
  }
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchFontBase64(url: string): Promise<string> {
  if (typeof window === 'undefined') {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    const buf = await fs.readFile(filePath);
    return buf.toString('base64');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font_load_failed:${url}`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

export async function loadReceiptFonts(): Promise<{ regular: string; bold: string }> {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all([
    fetchFontBase64('/fonts/NotoSans-Regular.ttf'),
    fetchFontBase64('/fonts/NotoSans-Bold.ttf'),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

function wrapText(pdf: jsPDF, text: string, maxWidth: number): string[] {
  const raw = String(text || '').trim() || '—';
  return pdf.splitTextToSize(raw, maxWidth) as string[];
}

type DrawCtx = {
  pdf: jsPDF;
  y: number;
  page: number;
  pages: number[];
};

function contentBottom(): number {
  // Leave room for page number strip inside margin zone visually above bottom margin.
  return RECEIPT_PAGE_H_MM - RECEIPT_MARGIN_MM - 6;
}

function ensureSpace(ctx: DrawCtx, needMm: number) {
  if (ctx.y + needMm <= contentBottom()) return;
  ctx.pdf.addPage();
  ctx.page += 1;
  ctx.pages.push(ctx.page);
  ctx.y = RECEIPT_MARGIN_MM;
}

function setFont(pdf: jsPDF, style: 'normal' | 'bold', size: number) {
  pdf.setFont('NotoSans', style === 'bold' ? 'bold' : 'normal');
  pdf.setFontSize(size);
}

function drawHRule(ctx: DrawCtx, color = '#c8c8c8') {
  ensureSpace(ctx, 3);
  const { pdf, y } = ctx;
  pdf.setDrawColor(color);
  pdf.setLineWidth(0.25);
  pdf.line(RECEIPT_MARGIN_MM, y, RECEIPT_MARGIN_MM + RECEIPT_CONTENT_W_MM, y);
  ctx.y = y + 4;
}

function drawLabeledBlock(
  ctx: DrawCtx,
  title: string,
  lines: string[],
  x: number,
  width: number,
  startY: number,
): number {
  const { pdf } = ctx;
  let y = startY;
  setFont(pdf, 'bold', 9);
  pdf.setTextColor('#555555');
  pdf.text(title, x, y);
  y += 5;
  pdf.setTextColor('#111111');
  lines.forEach((line, idx) => {
    setFont(pdf, idx === 0 ? 'bold' : 'normal', idx === 0 ? 10.5 : 9.5);
    const wrapped = wrapText(pdf, line, width);
    wrapped.forEach((w) => {
      pdf.text(w, x, y);
      y += 4.4;
    });
  });
  return y;
}

function drawStamp(
  pdf: jsPDF,
  x: number,
  y: number,
  size: number,
  voided: boolean,
  paymentDate: string,
) {
  const color = voided ? '#8a1f1f' : '#1a6b4a';
  pdf.setDrawColor(color);
  pdf.setTextColor(color);
  pdf.setLineWidth(0.7);
  pdf.rect(x, y, size, size);
  setFont(pdf, 'bold', 8);
  const lines = voided
    ? ['АНУЛИРАНА']
    : ['ПЛАЩАНЕТО', 'Е ПОЛУЧЕНО'];
  let ty = y + size / 2 - (lines.length + 1) * 2.2;
  lines.forEach((line) => {
    const tw = pdf.getTextWidth(line);
    pdf.text(line, x + (size - tw) / 2, ty);
    ty += 4.4;
  });
  setFont(pdf, 'bold', 8);
  const date = formatReceiptDateBg(paymentDate);
  const dw = pdf.getTextWidth(date);
  pdf.text(date, x + (size - dw) / 2, ty + 1.5);
  pdf.setTextColor('#111111');
}

/**
 * Build an A4 portrait PDF with 18 mm safe margins and embedded Noto Sans (BG Cyrillic).
 * Does not regenerate payment data — uses the frozen receipt row / party snapshot.
 */
export async function buildPaymentReceiptPdf(row: PaymentReceiptRow): Promise<jsPDF> {
  const fonts = await loadReceiptFonts();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
  pdf.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
  pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  pdf.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  pdf.setFont('NotoSans', 'normal');

  const mgmt = row.party_snapshot?.management_company ?? {};
  const complex = row.party_snapshot?.complex ?? {};
  const banks = Array.isArray(row.party_snapshot?.bank_accounts)
    ? (row.party_snapshot?.bank_accounts as Array<Record<string, unknown>>)
    : [];
  const primaryBank = banks.find((b) => b.is_primary === true) ?? banks[0] ?? null;
  const lines = receiptPurposeLines(row);
  const amount = Number(row.amount_eur);
  const voided = row.status === 'voided';
  const left = RECEIPT_MARGIN_MM;
  const contentW = RECEIPT_CONTENT_W_MM;
  const gap = 6;
  const colW = (contentW - gap) / 2;

  const ctx: DrawCtx = { pdf, y: RECEIPT_MARGIN_MM, page: 1, pages: [1] };

  if (voided) {
    setFont(pdf, 'bold', 11);
    pdf.setTextColor('#8a1f1f');
    const banner = `АНУЛИРАНА${row.void_reason ? ` — ${row.void_reason}` : ''}`;
    const tw = pdf.getTextWidth(banner);
    pdf.text(banner, left + (contentW - tw) / 2, ctx.y + 4);
    pdf.setTextColor('#111111');
    ctx.y += 10;
  }

  // Title
  setFont(pdf, 'bold', 16);
  const title = 'КВИТАНЦИЯ ЗА ПОЛУЧЕНО ПЛАЩАНЕ';
  const titleW = pdf.getTextWidth(title);
  pdf.text(title, left + (contentW - titleW) / 2, ctx.y + 5);
  ctx.y += 10;

  // Meta line
  setFont(pdf, 'normal', 9.5);
  pdf.setTextColor('#333333');
  const meta = [
    formatReceiptSeriesNumber(row),
    `Дата на издаване: ${formatReceiptDateBg(row.issued_at)}`,
    `Дата на плащане: ${formatReceiptDateBg(row.payment_date)}`,
  ].join('   ·   ');
  const metaLines = wrapText(pdf, meta, contentW);
  metaLines.forEach((m) => {
    const mw = pdf.getTextWidth(m);
    pdf.text(m, left + (contentW - mw) / 2, ctx.y);
    ctx.y += 4.5;
  });
  pdf.setTextColor('#111111');
  ctx.y += 3;
  drawHRule(ctx);

  // Recipient / Payer
  const recipientLines: string[] = [
    String(mgmt.legal_name ?? '—'),
    `ЕИК/БУЛСТАТ: ${mgmt.registration_number ?? '—'}`,
  ];
  if (mgmt.vat_number) recipientLines.push(`ДДС №: ${mgmt.vat_number}`);
  recipientLines.push(String(mgmt.registered_address ?? '—'));
  const contact = [mgmt.phone, mgmt.email].filter(Boolean).join(' · ');
  if (contact) recipientLines.push(contact);
  if (primaryBank) {
    const bankBits = [
      primaryBank.iban ? `IBAN: ${primaryBank.iban}` : '',
      primaryBank.bank_name ? String(primaryBank.bank_name) : '',
      primaryBank.bic ? `BIC ${primaryBank.bic}` : '',
    ].filter(Boolean);
    if (bankBits.length) recipientLines.push(bankBits.join(' · '));
  }

  const complexAddr = String(
    complex.address ??
      [complex.address_street, complex.address_building_number, complex.address_postal_code, complex.address_city, complex.address_country]
        .filter(Boolean)
        .join(', '),
  );
  const payerLines: string[] = [
    String(row.payer_name || '—'),
    `Апартамент № ${row.apartment_number || '—'}`,
  ];

  const blockStart = ctx.y;
  const yLeft = drawLabeledBlock(ctx, 'ПОЛУЧАТЕЛ', recipientLines, left, colW, blockStart);
  const yRight = drawLabeledBlock(ctx, 'ВНОСИТЕЛ', payerLines, left + colW + gap, colW, blockStart);
  ctx.y = Math.max(yLeft, yRight) + 3;

  // Complex separately — not as payer address
  setFont(pdf, 'bold', 9);
  pdf.setTextColor('#555555');
  pdf.text('ОБЕКТ', left, ctx.y);
  ctx.y += 4.5;
  pdf.setTextColor('#111111');
  setFont(pdf, 'normal', 9.5);
  const objectLines = wrapText(
    pdf,
    `Комплекс: ${complex.display_name ?? '—'} · ${complexAddr || '—'}`,
    contentW,
  );
  objectLines.forEach((l) => {
    pdf.text(l, left, ctx.y);
    ctx.y += 4.4;
  });
  ctx.y += 2;
  drawHRule(ctx);

  // Table
  const colDescW = contentW * 0.72;
  const colAmtW = contentW - colDescW;
  const rowPad = 3.2;

  function drawTableHeader() {
    ensureSpace(ctx, 10);
    pdf.setFillColor(240, 240, 240);
    pdf.setDrawColor('#bdbdbd');
    pdf.setLineWidth(0.3);
    pdf.rect(left, ctx.y, contentW, 7.5, 'FD');
    setFont(pdf, 'bold', 9.5);
    pdf.text('Основание / период', left + rowPad, ctx.y + 5);
    const amtHeader = 'Сума';
    pdf.text(amtHeader, left + contentW - rowPad - pdf.getTextWidth(amtHeader), ctx.y + 5);
    ctx.y += 7.5;
  }

  drawTableHeader();

  for (const line of lines) {
    const desc = receiptLineDescription(line);
    const amt = formatReceiptMoney(receiptLineAmount(line), row.currency);
    setFont(pdf, 'normal', 10);
    const descWrapped = wrapText(pdf, desc, colDescW - rowPad * 2);
    const rowH = Math.max(8, descWrapped.length * 4.4 + rowPad * 2);
    if (ctx.y + rowH > contentBottom()) {
      ctx.pdf.addPage();
      ctx.page += 1;
      ctx.pages.push(ctx.page);
      ctx.y = RECEIPT_MARGIN_MM;
      drawTableHeader();
      // Header leaves bold selected — restore body weight for the continued row.
      setFont(pdf, 'normal', 10);
    }
    pdf.setDrawColor('#cfcfcf');
    pdf.setLineWidth(0.25);
    pdf.rect(left, ctx.y, contentW, rowH);
    pdf.line(left + colDescW, ctx.y, left + colDescW, ctx.y + rowH);
    let ty = ctx.y + rowPad + 3.5;
    setFont(pdf, 'normal', 10);
    descWrapped.forEach((w) => {
      pdf.text(w, left + rowPad, ty);
      ty += 4.4;
    });
    pdf.text(amt, left + contentW - rowPad - pdf.getTextWidth(amt), ctx.y + rowPad + 3.5);
    ctx.y += rowH;
  }

  ctx.y += 5;

  // Total block (no heavy black frame)
  ensureSpace(ctx, 22);
  setFont(pdf, 'bold', 10);
  pdf.text('Получена сума', left, ctx.y);
  setFont(pdf, 'bold', 15);
  const total = formatReceiptMoney(amount, row.currency);
  pdf.text(total, left + contentW - pdf.getTextWidth(total), ctx.y);
  ctx.y += 6;
  setFont(pdf, 'normal', 10);
  const words = wrapText(pdf, amountEurToWordsBg(amount), contentW);
  words.forEach((w) => {
    pdf.text(w, left, ctx.y);
    ctx.y += 4.5;
  });
  ctx.y += 3;

  setFont(pdf, 'normal', 9.5);
  pdf.text(`Начин на плащане: ${receiptPaymentMethodLabel(row.payment_method)}`, left, ctx.y);
  ctx.y += 5;

  const refs = row.external_refs ?? {};
  const refParts = [
    refs.bank_reference ? `Банкова операция: ${refs.bank_reference}` : '',
    refs.account_reference ? `Свързан документ: ${refs.account_reference}` : '',
    refs.fiscal_receipt_number ? `Фискален бон № ${refs.fiscal_receipt_number}` : '',
  ].filter(Boolean);
  if (refParts.length) {
    const refWrapped = wrapText(pdf, refParts.join(' · '), contentW);
    refWrapped.forEach((w) => {
      pdf.text(w, left, ctx.y);
      ctx.y += 4.4;
    });
  }
  if (row.note) {
    const noteWrapped = wrapText(pdf, `Забележка: ${row.note}`, contentW);
    noteWrapped.forEach((w) => {
      pdf.text(w, left, ctx.y);
      ctx.y += 4.4;
    });
  }
  if (row.is_advance) {
    const adv = wrapText(
      pdf,
      'Авансово плащане — квитанцията потвърждава получената сума без разпределение по начисления.',
      contentW,
    );
    adv.forEach((w) => {
      pdf.text(w, left, ctx.y);
      ctx.y += 4.4;
    });
  }

  ctx.y += 4;
  drawHRule(ctx);

  // Bottom: staff + stamp + signatures — keep as one block when possible
  const stampSize = 34;
  const bottomNeed = 52;
  ensureSpace(ctx, bottomNeed);

  const staffName = row.recorded_by_name || row.recorded_by_email || '—';
  setFont(pdf, 'normal', 9.5);
  pdf.text(`Приел плащането: ${staffName}`, left, ctx.y);
  ctx.y += 6;

  const stampX = left + contentW - stampSize;
  const stampY = ctx.y;
  drawStamp(pdf, stampX, stampY, stampSize, voided, row.payment_date);

  const signY = Math.max(ctx.y, stampY + stampSize - 18);
  const signColW = (contentW - stampSize - 10) / 2;

  setFont(pdf, 'normal', 9.5);
  pdf.text(`Получил сумата: ${staffName}`, left, signY);
  pdf.setDrawColor('#333333');
  pdf.setLineWidth(0.3);
  pdf.line(left, signY + 10, left + signColW - 4, signY + 10);
  setFont(pdf, 'normal', 9);
  pdf.text('Подпис: ____________', left, signY + 15);

  const rightX = left + signColW + 4;
  setFont(pdf, 'normal', 9.5);
  const payerNameLines = wrapText(pdf, `Вносител: ${row.payer_name || '—'}`, signColW - 2);
  let py = signY;
  payerNameLines.forEach((w) => {
    pdf.text(w, rightX, py);
    py += 4.2;
  });
  pdf.line(rightX, Math.max(py, signY) + 6, rightX + signColW - 4, Math.max(py, signY) + 6);
  setFont(pdf, 'normal', 9);
  pdf.text('Подпис: ____________', rightX, Math.max(py, signY) + 11);

  ctx.y = Math.max(stampY + stampSize, signY + 18) + 6;

  setFont(pdf, 'normal', 9);
  pdf.setTextColor('#555555');
  const disc = wrapText(
    pdf,
    'Не замества фискален бон, когато такъв се изисква.',
    contentW,
  );
  disc.forEach((w) => {
    ensureSpace(ctx, 5);
    pdf.text(w, left, ctx.y);
    ctx.y += 4.2;
  });
  pdf.setTextColor('#111111');

  // Page numbers on every page
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    pdf.setPage(p);
    setFont(pdf, 'normal', 8);
    pdf.setTextColor('#777777');
    const label = `${p} / ${totalPages}`;
    pdf.text(
      label,
      RECEIPT_PAGE_W_MM / 2 - pdf.getTextWidth(label) / 2,
      RECEIPT_PAGE_H_MM - RECEIPT_MARGIN_MM + 4,
    );
    pdf.setTextColor('#111111');
  }

  return pdf;
}

export async function buildPaymentReceiptPdfBlob(row: PaymentReceiptRow): Promise<Blob> {
  const pdf = await buildPaymentReceiptPdf(row);
  return pdf.output('blob');
}

export async function buildPaymentReceiptPdfBytes(row: PaymentReceiptRow): Promise<Uint8Array> {
  const pdf = await buildPaymentReceiptPdf(row);
  const ab = pdf.output('arraybuffer');
  return new Uint8Array(ab);
}
