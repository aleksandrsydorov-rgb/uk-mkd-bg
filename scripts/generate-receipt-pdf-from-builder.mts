import fs from 'fs';
import path from 'path';
import { buildPaymentReceiptPdfBytes } from '../src/lib/paymentReceipts/buildReceiptPdf.ts';
import type { PaymentReceiptRow } from '../src/lib/paymentReceipts/types.ts';

const outDir = path.join(process.cwd(), 'tmp', 'receipts', 'layout-v2');
fs.mkdirSync(outDir, { recursive: true });

function base(overrides: Partial<PaymentReceiptRow> = {}): PaymentReceiptRow {
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
    payer_name: 'Тестов Платец ООД',
    payer_details: null,
    payment_method: 'bank',
    external_refs: { bank_reference: 'TRX-998877' },
    purpose_lines: [
      { description_bg: 'Електрическа енергия', period: '10.2026', amount_eur: 80 },
      { description_bg: 'Такса поддръжка', period: '2026', amount_eur: 45.5 },
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
        registered_address: 'гр. София, ул. Витоша 1',
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

const cases: Array<{ file: string; row: PaymentReceiptRow }> = [
  { file: 'short-one-payment.pdf', row: base({ purpose_lines: [{ description_bg: 'Електрическа енергия', period: '10.2026', amount_eur: 125.5 }], amount_eur: 125.5 }) },
  {
    file: 'long-party-names.pdf',
    row: base({
      payer_name:
        'Тестов Платец ООД с изключително дълго юридическо наименование за проверка на пренос на редове в блока Вносител',
      party_snapshot: {
        ...base().party_snapshot!,
        management_company: {
          ...base().party_snapshot!.management_company!,
          legal_name:
            'Управляваща компания Амадеус Единадесет ООД с допълнителен текст в наименованието и дълъг адрес',
          registered_address:
            'гр. София, район Триадица, ул. Витоша 1, ет. 3, офис 12, пощенски код 1000, Република България',
          email: 'management-company-very-long-email-address@uxf-mod1.local',
        },
      },
    }),
  },
  {
    file: 'multi-services.pdf',
    row: base({
      purpose_lines: [
        { description_bg: 'Студена вода', period: '10.2026', amount_eur: 20 },
        { description_bg: 'Електрическа енергия', period: '10.2026', amount_eur: 40 },
        { description_bg: 'Интернет', period: '10.2026', amount_eur: 25 },
        { description_bg: 'Такса поддръжка', period: '2026', amount_eur: 30 },
        { description_bg: 'Капитален ремонт', period: '2026', amount_eur: 10.5 },
      ],
      amount_eur: 125.5,
    }),
  },
  {
    file: 'multipage-many-lines.pdf',
    row: base({
      purpose_lines: Array.from({ length: 40 }, (_, i) => ({
        description_bg: `Услуга ${i + 1} — подробно основание за плащане`,
        period: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
        amount_eur: 12.5,
      })),
      amount_eur: 500,
    }),
  },
];

for (const c of cases) {
  const bytes = await buildPaymentReceiptPdfBytes(c.row);
  const file = path.join(outDir, c.file);
  fs.writeFileSync(file, Buffer.from(bytes));
  console.log('wrote', file, 'bytes', bytes.byteLength);
}
