import { describe, expect, it } from 'vitest';
import { amountEurToWordsBg } from '@/lib/paymentReceipts/amountWordsBg';
import { buildPaymentReceiptHtml } from '@/lib/paymentReceipts/buildReceiptHtml';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

describe('amountEurToWordsBg', () => {
  it('formats whole euros', () => {
    expect(amountEurToWordsBg(400)).toContain('четиристотин евро');
    expect(amountEurToWordsBg(400)).toContain('00/100');
  });

  it('formats cents', () => {
    expect(amountEurToWordsBg(417.58)).toMatch(/евро и 58\/100/);
  });
});

describe('buildPaymentReceiptHtml', () => {
  it('renders Bulgarian title and stamp for 400 EUR partial payment', () => {
    const row: PaymentReceiptRow = {
      id: '00000000-0000-4000-8000-000000000001',
      series: 'KP',
      number: 1,
      number_display: 'KP-000001',
      status: 'pending_pdf',
      source_module: 'electricity',
      ledger_id: '5e9d0ad3-f8cb-4943-a0e1-cc45930ed391',
      property_id: 47,
      amount_eur: 400,
      currency: 'EUR',
      payment_at: '2026-11-05T00:19:06.249836+00:00',
      payment_date: '2026-11-05',
      issued_at: '2026-11-05T01:00:00.000Z',
      voided_at: null,
      void_reason: null,
      payer_name: 'Тестов Платец',
      payer_details: {},
      payment_method: 'cash',
      external_refs: {},
      purpose_lines: [
        {
          service_code: 'electricity',
          service_label_bg: 'Електроенергия',
          description_bg: 'Електроенергия',
          amount_eur: 400,
          is_advance: false,
        },
      ],
      note: null,
      is_advance: false,
      recorded_by_email: 'admin@uxf-mod1.local',
      recorded_by_name: 'MOD1 Admin',
      owner_email_at_issue: 'owner@example.com',
      apartment_number: '47',
      party_snapshot: {
        complex: {
          display_name: 'Amadeus 11',
          address: 'ул. Пример 11, Слънчев бряг',
        },
        management_company: {
          legal_name: 'УК Амадеус 11 ООД',
          registration_number: '205012345',
          registered_address: 'гр. София, ул. Витоша 1',
          vat_number: 'BG205012345',
        },
        bank_accounts: [{ iban: 'BG80BNBG96611020345678', bank_name: 'Test Bank', is_primary: true }],
      },
      missing_uk_fields: [],
      storage_path: null,
      pdf_sha256: null,
      pdf_error: null,
    };
    const html = buildPaymentReceiptHtml(row);
    expect(html).toContain('КВИТАНЦИЯ ЗА ПОЛУЧЕНО ПЛАЩАНЕ');
    expect(html).toContain('ПЛАЩАНЕТО');
    expect(html).toContain('Е ПОЛУЧЕНО');
    expect(html).toContain('400');
    expect(html).toContain('Не замества фискален бон');
    expect(html).toContain('УК Амадеус 11 ООД');
    expect(html).toContain('Тестов Платец');
    expect(html).not.toContain('417,58');
  });
});
