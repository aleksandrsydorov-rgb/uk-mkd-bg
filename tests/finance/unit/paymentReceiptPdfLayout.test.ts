import { describe, expect, it } from 'vitest';
import { looksLikePdf } from '@/lib/pdfDownload';
import { buildPaymentReceiptPdfBytes } from '@/lib/paymentReceipts/buildReceiptPdf';
import { formatReceiptSeriesNumber, RECEIPT_MARGIN_MM } from '@/lib/paymentReceipts/receiptFormat';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

function fixture(overrides: Partial<PaymentReceiptRow> = {}): PaymentReceiptRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    series: 'KP',
    number: 2,
    number_display: 'KP-000002',
    status: 'pending_pdf',
    source_module: 'electricity',
    ledger_id: '400',
    property_id: 47,
    amount_eur: 125.5,
    currency: 'EUR',
    payment_at: '2026-11-05T10:00:00Z',
    payment_date: '2026-11-05',
    issued_at: '2026-11-05T10:01:00Z',
    voided_at: null,
    void_reason: null,
    payer_name: 'Тестов Платец ООД с много дълго юридическо наименование за проверка на пренос',
    payer_details: null,
    payment_method: 'bank',
    external_refs: { bank_reference: 'TRX-998877' },
    purpose_lines: [
      {
        description_bg: 'Електрическа енергия',
        period: '10.2026',
        amount_eur: 80,
      },
      {
        description_bg: 'Такса поддръжка',
        period: '2026',
        amount_eur: 45.5,
      },
    ],
    note: null,
    is_advance: false,
    recorded_by_email: 'admin@uxf-mod1.local',
    recorded_by_name: 'Админ Тест',
    owner_email_at_issue: 'owner@example.com',
    apartment_number: '47',
    party_snapshot: {
      management_company: {
        legal_name: 'УК Амадеус 11 ООД',
        registration_number: '205012345',
        vat_number: 'BG205012345',
        registered_address: 'гр. София, ул. Витоша 1, много дълъг адрес за проверка на пренос на редове',
        phone: '+359 88 111 1111',
        email: 'mgmt@uxf-mod1.local',
      },
      complex: {
        display_name: 'Amadeus 11',
        address: 'ул. Пример 11, 8256 Слънчев бряг, България',
      },
      bank_accounts: [
        {
          is_primary: true,
          iban: 'BG80BNBG96611020345678',
          bank_name: 'УниКредит Булбанк',
          bic: 'UNCRBGSF',
        },
      ],
    },
    missing_uk_fields: [],
    storage_path: null,
    pdf_sha256: null,
    pdf_error: null,
    ...overrides,
  };
}

describe('payment receipt PDF layout', () => {
  it('formats series and number for display without rewriting storage key', () => {
    expect(formatReceiptSeriesNumber(fixture())).toBe('Серия KP · № 000002');
    expect(RECEIPT_MARGIN_MM).toBe(18);
  });

  it('builds a real multi-page-capable PDF with embedded content', async () => {
    const bytes = await buildPaymentReceiptPdfBytes(fixture());
    expect(looksLikePdf(bytes)).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(5_000);
  });

  it('builds a long multipage receipt when many purpose lines are present', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      description_bg: `Услуга ${i + 1} — подробно основание за плащане с пояснение`,
      period: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      amount_eur: 12.5,
    }));
    const bytes = await buildPaymentReceiptPdfBytes(
      fixture({
        purpose_lines: many,
        amount_eur: many.reduce((s, l) => s + l.amount_eur, 0),
      }),
    );
    expect(looksLikePdf(bytes)).toBe(true);
    // Multipage PDFs contain multiple page objects
    const asText = Buffer.from(bytes).toString('latin1');
    const pageCount = (asText.match(/\/Type\s*\/Page\b/g) || []).length;
    expect(pageCount).toBeGreaterThan(1);
  });
});
