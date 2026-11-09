import { describe, expect, it } from 'vitest';
import {
  formatMeterReadingCell,
  meterOpeningBalanceCells,
  summarizeMeterOpeningBalances,
} from '@/lib/firstRunMetersPreview';

describe('firstRunMetersPreview', () => {
  it('keeps zero readings as 0 instead of dash', () => {
    expect(formatMeterReadingCell('0')).toBe('0');
    expect(formatMeterReadingCell('18.5')).toBe('18.5');
    expect(formatMeterReadingCell('')).toBe('—');
  });

  it('maps debt / overpayment / zero into separate money columns', () => {
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
    expect(cells.overpaymentText).toBe('0,00');
  });

  it('summarizes debt and overpayment separately', () => {
    expect(
      summarizeMeterOpeningBalances([
        { opening_balance_kind: 'debt', opening_balance_eur: '55.00' },
        { opening_balance_kind: 'overpayment', opening_balance_eur: '12.00' },
        { opening_balance_kind: 'zero', opening_balance_eur: '' },
      ]),
    ).toEqual({ debtTotal: 55, overpaymentTotal: 12 });
  });
});
