import { describe, expect, it } from 'vitest';
import {
  crKindFromSignedAmount,
  mapSimpleCrOpeningRow,
  parseCrOpeningAmount,
  parseCapitalRepairOpeningWorkbook,
} from '@/lib/capitalRepairSimpleOpening';
import { buildCapitalRepairSimpleTemplateBuffer } from '@/lib/importTemplates/specs/capitalRepairSimple';
import { buildCapitalRepairOpeningPreview } from '@/lib/firstRunCapitalRepairPreview';

const meta = {
  billingYear: '2026',
  transitionDate: '2026-01-01',
  sourceReference: '',
};

describe('capitalRepairSimpleOpening', () => {
  it('parses signed amounts and hyphen', () => {
    expect(parseCrOpeningAmount('70,70')).toEqual({ ok: true, value: 70.7 });
    expect(parseCrOpeningAmount('-50,00')).toEqual({ ok: true, value: -50 });
    expect(parseCrOpeningAmount('0')).toEqual({ ok: true, value: 0 });
    expect(parseCrOpeningAmount('')).toEqual({ ok: true, value: null });
    expect(parseCrOpeningAmount('-')).toEqual({ ok: false, reason: 'hyphen' });
    expect(crKindFromSignedAmount(70.7)).toBe('debt');
    expect(crKindFromSignedAmount(-50)).toBe('overpayment');
    expect(crKindFromSignedAmount(0)).toBe('zero');
  });

  it('maps debt / overpayment / zero / defer / hyphen using activation year', () => {
    const debt = mapSimpleCrOpeningRow(
      {
        apartment_number: '2',
        section_code: 'A',
        block_code: '',
        opening_balance_eur: '70,70',
      },
      2,
      meta,
    );
    expect(debt.rpcRow?.billing_year).toBe('2026');
    expect(debt.rpcRow?.remaining_debt).toBe('70.70');
    expect(debt.rpcRow?.assessed_amount).toBe('70.70');
    expect(debt.rpcRow?.historically_paid_amount).toBe('0');
    expect(debt.rpcRow?.source_reference).toBe('');

    const over = mapSimpleCrOpeningRow(
      {
        apartment_number: '8',
        section_code: 'A',
        block_code: '',
        opening_balance_eur: '-50,00',
      },
      3,
      meta,
    );
    expect(over.rpcRow?.opening_overpayment).toBe('50.00');
    expect(over.rpcRow?.remaining_debt).toBe('0');

    const zero = mapSimpleCrOpeningRow(
      {
        apartment_number: '10',
        section_code: 'A',
        block_code: '',
        opening_balance_eur: '0',
      },
      4,
      meta,
    );
    expect(zero.rpcRow?.remaining_debt).toBe('0');
    expect(zero.deferred).toBe(false);

    const defer = mapSimpleCrOpeningRow(
      {
        apartment_number: '12',
        section_code: 'B',
        block_code: '',
        opening_balance_eur: '',
      },
      5,
      meta,
    );
    expect(defer.deferred).toBe(true);
    expect(defer.rpcRow).not.toBeNull();
    expect(defer.rpcRow?.assessed_amount).toBe('');
    expect(defer.rpcRow?.billing_year).toBe('2026');
    expect(defer.previewRow?._deferred).toBe('1');

    const hyphen = mapSimpleCrOpeningRow(
      {
        apartment_number: '13',
        section_code: 'B',
        block_code: '',
        opening_balance_eur: '-',
      },
      6,
      meta,
    );
    expect(hyphen.errors.some((e) => e.reason.includes('hyphen'))).toBe(true);
    expect(hyphen.rpcRow).toBeNull();
  });

  it('prefers legacy file billing_year when present', () => {
    const row = mapSimpleCrOpeningRow(
      {
        apartment_number: '2',
        section_code: 'A',
        block_code: '',
        billing_year: '2025',
        opening_balance_eur: '10',
      },
      2,
      meta,
    );
    expect(row.rpcRow?.billing_year).toBe('2025');
  });

  it('builds 4-column prefilled template without billing year column', () => {
    const buf = buildCapitalRepairSimpleTemplateBuffer('ru', [
      { apartment_number: '2', section_code: 'A', block_code: '' },
      { apartment_number: '33', section_code: 'Б', block_code: '3' },
    ]);
    expect(buf.byteLength).toBeGreaterThan(1000);
    const parsed = parseCapitalRepairOpeningWorkbook(buf, 'ru', meta);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.mode).toBe('simple');
    // Empty amounts → defer rows for both apartments
    expect(parsed.deferredCount).toBe(2);
    expect(parsed.previewRows).toHaveLength(2);
  });

  it('preview groups by entrance', () => {
    const preview = buildCapitalRepairOpeningPreview(
      [
        {
          apartment_number: '2',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          remaining_debt: '10',
          opening_overpayment: '0',
          assessed_amount: '10',
          historically_paid_amount: '0',
          _simple_kind: 'debt',
          rowNumber: '2',
        },
      ],
      { t: (k) => k },
    );
    expect(preview.groups.length).toBeGreaterThan(0);
    expect(preview.debtCount).toBe(1);
  });
});
