import { describe, expect, it } from 'vitest';
import { presentComplexFormErrors } from '@/lib/firstRun';

const RU: Record<string, string> = {
  'admin.firstRunComplexInvalid': 'Проверьте поля формы.',
  'admin.firstRunComplexFixRetry': 'Исправьте отмеченные поля и снова нажмите «Продолжить».',
  'admin.firstRunComplexAction_display_name': '«Название комплекса»: укажите название.',
  'admin.firstRunComplexAction_bank_iban':
    '«IBAN»: введите корректный IBAN (код страны и контрольные цифры) и повторите.',
};

describe('presentComplexFormErrors', () => {
  const t = (key: string) => RU[key] ?? key;

  it('lists concrete fields and retry hint', () => {
    const msg = presentComplexFormErrors(['display_name', 'bank_0_iban'], t);
    expect(msg).toContain('Название комплекса');
    expect(msg).toContain('IBAN');
    expect(msg).toContain('Продолжить');
    expect(msg).not.toBe(RU['admin.firstRunComplexInvalid']);
  });

  it('dedupes multiple bank iban codes', () => {
    const msg = presentComplexFormErrors(['bank_0_iban', 'bank_1_iban'], t);
    expect(msg.match(/«IBAN»/g)?.length).toBe(1);
    expect(msg).toContain('Продолжить');
  });
});
