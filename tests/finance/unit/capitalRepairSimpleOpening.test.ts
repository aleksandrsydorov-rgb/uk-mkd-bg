import { describe, expect, it } from 'vitest';
import {
  crKindFromSignedAmount,
  mapSimpleCrOpeningRow,
  parseCrOpeningAmount,
  parseCapitalRepairOpeningWorkbook,
} from '@/lib/capitalRepairSimpleOpening';
import { buildCapitalRepairSimpleTemplateBuffer } from '@/lib/importTemplates/specs/capitalRepairSimple';
import { buildCapitalRepairOpeningPreview } from '@/lib/firstRunCapitalRepairPreview';

const meta = { transitionDate: '2026-01-01', sourceReference: 'TEST-CR' };

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

  it('maps debt / overpayment / zero / defer / hyphen', () => {
    const debt = mapSimpleCrOpeningRow(
      {
        apartment_number: '2',
        section_code: 'A',
        block_code: '',
        billing_year: '2026',
        opening_balance_eur: '70,70',
      },
      2,
      meta,
    );
    expect(debt.rpcRow?.remaining_debt).toBe('70.70');
    expect(debt.rpcRow?.assessed_amount).toBe('70.70');
    expect(debt.rpcRow?.historically_paid_amount).toBe('0');

    const over = mapSimpleCrOpeningRow(
      {
        apartment_number: '8',
        section_code: 'A',
        block_code: '',
        billing_year: '2026',
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
        billing_year: '2026',
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
        billing_year: '2026',
        opening_balance_eur: '',
      },
      5,
      meta,
    );
    expect(defer.deferred).toBe(true);
    expect(defer.rpcRow).not.toBeNull();
    expect(defer.rpcRow?.assessed_amount).toBe('');
    expect(defer.rpcRow?.historically_paid_amount).toBe('');
    expect(defer.rpcRow?.remaining_debt).toBe('');
    expect(defer.rpcRow?.opening_overpayment).toBe('');
    expect(defer.rpcRow?.transition_date).toBe('');
    expect(defer.rpcRow?.source_reference).toBe('');
    expect(defer.previewRow?._deferred).toBe('1');

    const hyphen = mapSimpleCrOpeningRow(
      {
        apartment_number: '13',
        section_code: 'B',
        block_code: '',
        billing_year: '2026',
        opening_balance_eur: '-',
      },
      6,
      meta,
    );
    expect(hyphen.errors[0]?.reason).toBe('invalid:opening_balance_eur_hyphen');
  });

  it('builds RU/BG/EN five-column templates and round-trips', () => {
    for (const loc of ['ru', 'bg', 'en'] as const) {
      const buf = buildCapitalRepairSimpleTemplateBuffer(loc);
      const parsed = parseCapitalRepairOpeningWorkbook(buf, loc, meta);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.mode).toBe('simple');
    }
  });

  it('preview labels debt / credit / zero / defer', () => {
    const rows = [
      mapSimpleCrOpeningRow(
        {
          apartment_number: '2',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '70,70',
        },
        2,
        meta,
      ).previewRow!,
      mapSimpleCrOpeningRow(
        {
          apartment_number: '8',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '-50,00',
        },
        3,
        meta,
      ).previewRow!,
      mapSimpleCrOpeningRow(
        {
          apartment_number: '10',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '0',
        },
        4,
        meta,
      ).previewRow!,
      mapSimpleCrOpeningRow(
        {
          apartment_number: '12',
          section_code: 'B',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '',
        },
        5,
        meta,
      ).previewRow!,
    ];
    const preview = buildCapitalRepairOpeningPreview(rows);
    expect(preview.debtCount).toBe(1);
    expect(preview.creditCount).toBe(1);
    expect(preview.zeroCount).toBe(1);
    expect(preview.deferCount).toBe(1);
    expect(preview.debtSum).toBe(70.7);
  });
});
