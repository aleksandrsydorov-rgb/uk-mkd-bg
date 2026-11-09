import { describe, expect, it } from 'vitest';
import { isValidIban, normalizeIban } from '@/lib/iban';
import {
  complexFormToPayload,
  complexToForm,
  validateComplexFormWithIban,
} from '@/lib/firstRun';

describe('IBAN helpers', () => {
  it('normalizes and validates mod-97', () => {
    expect(normalizeIban('gb82 west 1234 5698 7654 32')).toBe('GB82WEST12345698765432');
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
});

describe('building profile bank rows', () => {
  it('rejects invalid IBAN on a filled bank row and drops empty rows from payload', () => {
    const form = complexToForm(null);
    Object.assign(form, {
      display_name: 'A',
      address_country: 'BG',
      address_city: 'Sofia',
      address_street: 'Str',
      address_building_number: '1',
      apartment_count: '1',
      mgmt_legal_name: 'UK',
      mgmt_registration_country: 'BG',
      mgmt_registration_number: '1',
      mgmt_registered_address: 'Addr',
      mgmt_representative_name: 'Rep',
      mgmt_phone: '1',
      mgmt_email: 'a@b.c',
      bank_accounts: [
        {
          purpose: 'current',
          account_holder: 'Someone Else',
          bank_name: 'Bank',
          iban: 'GB82WEST12345698765433',
          bic_swift: '',
          currency: 'EUR',
          is_primary: true,
        },
      ],
    });
    expect(validateComplexFormWithIban(form, isValidIban)).toContain('bank_0_iban');
    form.bank_accounts[0].iban = 'GB82WEST12345698765432';
    expect(validateComplexFormWithIban(form, isValidIban)).toEqual([]);
    expect(complexFormToPayload(form).bank_accounts).toHaveLength(1);
  });
});
