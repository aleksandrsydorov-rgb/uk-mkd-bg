import { amountEurToWordsBg } from '@/lib/paymentReceipts/amountWordsBg';
import {
  RECEIPT_MARGIN_MM,
  formatReceiptDateBg,
  formatReceiptMoney,
  formatReceiptSeriesNumber,
  receiptLineAmount,
  receiptLineDescription,
  receiptPaymentMethodLabel,
  receiptPurposeLines,
} from '@/lib/paymentReceipts/receiptFormat';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Print-oriented HTML mirror of the PDF layout (for preview / debug).
 * Actual stored document is produced by buildPaymentReceiptPdf (jsPDF + embedded font).
 */
export function buildPaymentReceiptHtml(row: PaymentReceiptRow): string {
  const mgmt = row.party_snapshot?.management_company ?? {};
  const complex = row.party_snapshot?.complex ?? {};
  const banks = Array.isArray(row.party_snapshot?.bank_accounts)
    ? (row.party_snapshot?.bank_accounts as Array<Record<string, unknown>>)
    : [];
  const primaryBank = banks.find((b) => b.is_primary === true) ?? banks[0] ?? null;
  const lines = receiptPurposeLines(row);
  const amount = Number(row.amount_eur);
  const voided = row.status === 'voided';
  const complexAddr = String(
    complex.address ??
      [complex.address_street, complex.address_building_number, complex.address_postal_code, complex.address_city, complex.address_country]
        .filter(Boolean)
        .join(', '),
  );

  const primaryBic = primaryBank?.bic_swift ?? primaryBank?.bic;
  const bankBlock = primaryBank
    ? `<div class="muted">IBAN: ${esc(primaryBank.iban ?? '—')}${
        primaryBank.bank_name ? ` · ${esc(primaryBank.bank_name)}` : ''
      }${primaryBic ? ` · BIC ${esc(primaryBic)}` : ''}</div>`
    : '';

  const refs = row.external_refs ?? {};
  const refParts = [
    refs.bank_reference ? `Банкова операция: ${esc(refs.bank_reference)}` : '',
    refs.account_reference ? `Свързан документ: ${esc(refs.account_reference)}` : '',
    refs.fiscal_receipt_number ? `Фискален бон № ${esc(refs.fiscal_receipt_number)}` : '',
  ].filter(Boolean);

  const tableRows = lines
    .map((line) => {
      return `<tr>
        <td>${esc(receiptLineDescription(line))}</td>
        <td class="num">${esc(formatReceiptMoney(receiptLineAmount(line), row.currency))}</td>
      </tr>`;
    })
    .join('');

  const staff = esc(row.recorded_by_name || row.recorded_by_email || '—');

  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: ${RECEIPT_MARGIN_MM}mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Noto Sans", "DejaVu Sans", "Segoe UI", Arial, sans-serif;
    color: #111;
    font-size: 10.5pt;
    line-height: 1.3;
    background: #fff;
  }
  h1 {
    font-size: 16pt;
    font-weight: 700;
    margin: 0 0 6mm;
    text-align: center;
    letter-spacing: 0.02em;
  }
  .meta {
    text-align: center;
    color: #333;
    font-size: 9.5pt;
    margin-bottom: 5mm;
  }
  .rule { border: 0; border-top: 0.3pt solid #c8c8c8; margin: 4mm 0; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 4mm; }
  .parties h2, .object h2 {
    font-size: 9pt;
    margin: 0 0 2mm;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #555;
    font-weight: 700;
  }
  .name { font-weight: 700; font-size: 10.5pt; word-break: break-word; }
  .muted { color: #333; font-size: 9.5pt; margin-top: 1mm; word-break: break-word; }
  .object { margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 5mm; }
  th, td {
    border: 0.3pt solid #cfcfcf;
    padding: 3.2mm 3.5mm;
    vertical-align: top;
    font-size: 10pt;
  }
  th { background: #f0f0f0; text-align: left; font-size: 9.5pt; font-weight: 700; }
  td.num, th.num { text-align: right; white-space: nowrap; width: 28%; }
  .total-label { font-weight: 700; font-size: 10pt; }
  .total-sum { font-size: 15pt; font-weight: 700; text-align: right; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; margin-bottom: 2mm; }
  .words { font-size: 10pt; margin-bottom: 3mm; }
  .note { font-size: 9.5pt; margin-top: 2mm; }
  .bottom {
    display: grid;
    grid-template-columns: 1fr 36mm;
    gap: 6mm;
    align-items: start;
    margin-top: 6mm;
  }
  .stamp {
    width: 34mm; height: 34mm;
    border: 0.7mm solid #1a6b4a;
    color: #1a6b4a;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; font-weight: 700; font-size: 8pt; line-height: 1.25;
  }
  .stamp.voided { border-color: #8a1f1f; color: #8a1f1f; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 5mm; }
  .signs .line {
    margin-top: 8mm;
    border-top: 0.3pt solid #333;
    padding-top: 1.5mm;
    font-size: 9pt;
  }
  .disclaimer {
    margin-top: 5mm;
    font-size: 9pt;
    color: #555;
  }
  .void-banner {
    color: #8a1f1f; font-weight: 700; text-align: center;
    margin-bottom: 4mm; text-transform: uppercase; font-size: 11pt;
  }
</style>
</head>
<body>
  ${voided ? `<div class="void-banner">Аннулирана${row.void_reason ? ` — ${esc(row.void_reason)}` : ''}</div>` : ''}
  <h1>КВИТАНЦИЯ ЗА ПОЛУЧЕНО ПЛАЩАНЕ</h1>
  <div class="meta">${esc(formatReceiptSeriesNumber(row))} &nbsp;·&nbsp; Дата на издаване: ${formatReceiptDateBg(row.issued_at)} &nbsp;·&nbsp; Дата на плащане: ${formatReceiptDateBg(row.payment_date)}</div>
  <hr class="rule" />

  <div class="parties">
    <div>
      <h2>Получател</h2>
      <div class="name">${esc(mgmt.legal_name ?? '—')}</div>
      <div class="muted">ЕИК/БУЛСТАТ: ${esc(mgmt.registration_number ?? '—')}</div>
      ${mgmt.vat_number ? `<div class="muted">ДДС №: ${esc(mgmt.vat_number)}</div>` : ''}
      <div class="muted">${esc(mgmt.registered_address ?? '—')}</div>
      ${mgmt.phone || mgmt.email ? `<div class="muted">${esc([mgmt.phone, mgmt.email].filter(Boolean).join(' · '))}</div>` : ''}
      ${bankBlock}
    </div>
    <div>
      <h2>Вносител</h2>
      <div class="name">${esc(row.payer_name)}</div>
      <div class="muted">Апартамент № ${esc(row.apartment_number)}</div>
    </div>
  </div>

  <div class="object">
    <h2>Обект</h2>
    <div class="muted">Комплекс: ${esc(complex.display_name ?? '—')} · ${esc(complexAddr || '—')}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Основание / период</th>
        <th class="num">Сума</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div class="total-row">
    <div class="total-label">Получена сума</div>
    <div class="total-sum">${esc(formatReceiptMoney(amount, row.currency))}</div>
  </div>
  <div class="words">${esc(amountEurToWordsBg(amount))}</div>
  <div class="note"><strong>Начин на плащане:</strong> ${esc(receiptPaymentMethodLabel(row.payment_method))}</div>
  ${refParts.length ? `<div class="note">${refParts.join(' · ')}</div>` : ''}
  ${row.note ? `<div class="note"><strong>Забележка:</strong> ${esc(row.note)}</div>` : ''}
  ${row.is_advance ? `<div class="note">Авансово плащане — квитанцията потвърждава получената сума без разпределение по начисления.</div>` : ''}

  <hr class="rule" />
  <div class="note">Приел плащането: ${staff}</div>
  <div class="bottom">
    <div class="signs">
      <div>
        <div>Получил сумата: ${staff}</div>
        <div class="line">Подпис: ____________</div>
      </div>
      <div>
        <div>Вносител: ${esc(row.payer_name)}</div>
        <div class="line">Подпис: ____________</div>
      </div>
    </div>
    <div class="stamp${voided ? ' voided' : ''}">
      ${voided ? 'АНУЛИРАНА' : 'ПЛАЩАНЕТО<br/>Е ПОЛУЧЕНО'}
      <div style="margin-top:2mm;font-size:8pt;">${formatReceiptDateBg(row.payment_date)}</div>
    </div>
  </div>
  <div class="disclaimer">Не замества фискален бон, когато такъв се изисква.</div>
</body>
</html>`;
}
