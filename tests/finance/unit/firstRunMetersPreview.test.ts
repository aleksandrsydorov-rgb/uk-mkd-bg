import { describe, expect, it } from 'vitest';
import {
  formatMeterReadingCell,
  groupMeterPreviewRowsByEntrance,
  meterOpeningBalanceCells,
  meterOpeningBalanceStatus,
  presentMeterOpeningBalanceStatus,
  summarizeMeterOpeningBalances,
} from '@/lib/firstRunMetersPreview';
import {
  collectApartmentOpeningBalanceConflicts,
  resolveMeterOpeningBalance,
} from '@/lib/moduleCore/adapters/metersOpening';

describe('firstRunMetersPreview', () => {
  it('keeps zero readings as 0 instead of dash', () => {
    expect(formatMeterReadingCell('0')).toBe('0');
    expect(formatMeterReadingCell('18.5')).toBe('18.5');
    expect(formatMeterReadingCell('')).toBe('—');
  });

  it('maps debt / overpayment / zero into separate money columns (legacy kind)', () => {
    expect(
      meterOpeningBalanceCells(
        { opening_balance_kind: 'debt', opening_balance_eur: '55.00' },
        { locale: 'ru', errorLabel: 'ERR' },
      ),
    ).toEqual({
      debtText: '55,00',
      overpaymentText: '0,00',
      debtInvalid: false,
      overpaymentInvalid: false,
    });

    expect(
      meterOpeningBalanceCells(
        { opening_balance_kind: 'overpayment', opening_balance_eur: '12.00' },
        { locale: 'ru', errorLabel: 'ERR' },
      ),
    ).toEqual({
      debtText: '0,00',
      overpaymentText: '12,00',
      debtInvalid: false,
      overpaymentInvalid: false,
    });

    expect(
      meterOpeningBalanceCells(
        { opening_balance_kind: 'zero', opening_balance_eur: '' },
        { locale: 'ru', errorLabel: 'ERR' },
      ),
    ).toEqual({
      debtText: '0,00',
      overpaymentText: '0,00',
      debtInvalid: false,
      overpaymentInvalid: false,
    });
  });

  it('does not coerce missing debt amount to zero', () => {
    const cells = meterOpeningBalanceCells(
      { opening_balance_kind: 'debt', opening_balance_eur: '' },
      { locale: 'ru', errorLabel: 'ERR' },
    );
    expect(cells.debtText).toBe('ERR');
    expect(cells.debtInvalid).toBe(true);
    expect(cells.overpaymentText).toBe('ERR');
    expect(cells.overpaymentInvalid).toBe(true);
  });

  it('resolves signed amounts without kind column', () => {
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '50' })).toEqual({
      kind: 'debt',
      amountAbs: 50,
      errors: [],
    });
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '+50' })).toEqual({
      kind: 'debt',
      amountAbs: 50,
      errors: [],
    });
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '-50' })).toEqual({
      kind: 'overpayment',
      amountAbs: 50,
      errors: [],
    });
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '0' })).toEqual({
      kind: 'zero',
      amountAbs: 0,
      errors: [],
    });
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '' })).toEqual({
      kind: null,
      amountAbs: 0,
      errors: [],
    });
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '-' }).errors).toContain(
      'invalid:opening_balance_eur_hyphen',
    );
    expect(resolveMeterOpeningBalance({ opening_balance_eur: '50,5' })).toEqual({
      kind: 'debt',
      amountAbs: 50.5,
      errors: [],
    });
  });

  it('presents signed balance status labels', () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (key.endsWith('Unspecified')) return 'Начальный остаток не указан';
      if (key.endsWith('Zero')) return 'Остаток 0,00 €';
      if (key.endsWith('Debt')) return `Долг ${params?.amount} €`;
      if (key.endsWith('Credit')) return `Переплата ${params?.amount} €`;
      return key;
    };
    expect(
      presentMeterOpeningBalanceStatus(
        meterOpeningBalanceStatus({ opening_balance_eur: '50' }, { locale: 'ru', errorLabel: 'ERR' }),
        t,
      ),
    ).toBe('Долг 50,00 €');
    expect(
      presentMeterOpeningBalanceStatus(
        meterOpeningBalanceStatus({ opening_balance_eur: '-12' }, { locale: 'ru', errorLabel: 'ERR' }),
        t,
      ),
    ).toBe('Переплата 12,00 €');
    expect(
      presentMeterOpeningBalanceStatus(
        meterOpeningBalanceStatus({ opening_balance_eur: '0' }, { locale: 'ru', errorLabel: 'ERR' }),
        t,
      ),
    ).toBe('Остаток 0,00 €');
    expect(
      presentMeterOpeningBalanceStatus(
        meterOpeningBalanceStatus({ opening_balance_eur: '' }, { locale: 'ru', errorLabel: 'ERR' }),
        t,
      ),
    ).toBe('Начальный остаток не указан');
  });

  it('summarizes debt and overpayment once per apartment', () => {
    expect(
      summarizeMeterOpeningBalances([
        {
          apartment_number: '1',
          section_code: 'A',
          opening_balance_eur: '55.00',
        },
        {
          apartment_number: '1',
          section_code: 'A',
          opening_balance_eur: '',
        },
        {
          apartment_number: '2',
          section_code: 'A',
          opening_balance_eur: '-12.00',
        },
        {
          apartment_number: '3',
          section_code: 'Б',
          opening_balance_eur: '0',
        },
      ]),
    ).toEqual({ debtTotal: 55, overpaymentTotal: 12 });
  });

  it('flags a second opening balance claim on the same apartment', () => {
    const conflicts = collectApartmentOpeningBalanceConflicts([
      { apartment_number: '15', section_code: 'В', opening_balance_eur: '25' },
      { apartment_number: '15', section_code: 'В', opening_balance_eur: '10' },
      { apartment_number: '15', section_code: 'В', opening_balance_eur: '' },
    ]);
    expect(conflicts.get(1)).toBe('opening_balance_conflict_same_apartment');
    expect(conflicts.has(2)).toBe(false);
  });

  it('groups preview rows by entrance', () => {
    const groups = groupMeterPreviewRowsByEntrance([
      { apartment_number: '2', section_code: 'Б' },
      { apartment_number: '1', section_code: 'A' },
      { apartment_number: '3', section_code: 'A' },
    ]);
    expect(groups.map((g) => g.sectionCode)).toEqual(['A', 'Б']);
    expect(groups[0].rows).toHaveLength(2);
  });
});
