import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n/translate';
import {
  budgetYearStatusLabel,
  explainFirstRunFailure,
  redactDiagnostic,
  tariffBasisLabel,
} from '@/lib/firstRunUserMessage';

const ru = (key: string) => translate('ru', key);
const en = (key: string) => translate('en', key);
const bg = (key: string) => translate('bg', key);

describe('first-run user-facing messages', () => {
  it('turns the tariff stage failure into the Russian sentence', () => {
    const view = explainFirstRunFailure('first_run: stage tariffs not complete', ru);
    expect(view.message).toBe('Завершите настройку тарифов, затем повторите попытку.');
    expect(view.detail).toBe('first_run: stage tariffs not complete');
    expect(explainFirstRunFailure('first_run: stage tariffs not complete', en).message).toBe(
      'Finish the tariff setup, then try again.',
    );
    expect(explainFirstRunFailure('first_run: stage tariffs not complete', bg).message).toBe(
      'Завършете настройката на тарифите, след това опитайте отново.',
    );
  });

  it('localizes budget year statuses and hides an unknown code', () => {
    expect(budgetYearStatusLabel('draft', ru)).toBe('Черновик');
    expect(budgetYearStatusLabel('published', en)).toBe('Published');
    expect(budgetYearStatusLabel('adopted', bg)).toBe('Приет');
    expect(budgetYearStatusLabel('closed', ru)).toBe('Закрыт');
    expect(budgetYearStatusLabel('internal_code', ru)).toBe(
      'Не удалось выполнить действие. Повторите попытку.',
    );
  });

  it('localizes a known tariff basis and omits an unknown code', () => {
    expect(tariffBasisLabel('external_decision', ru)).toBe('Внешнее решение');
    expect(tariffBasisLabel('supplier_notice', en)).toBe('Supplier notice');
    expect(tariffBasisLabel('not_a_basis', ru)).toBeNull();
  });

  it('keeps an unknown first-run phrase out of the main sentence and redacts secrets', () => {
    const unknown = explainFirstRunFailure('first_run: something new happened', ru);
    expect(unknown.message).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(unknown.detail).toBe('first_run: something new happened');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = explainFirstRunFailure('jwt rejected eyJaaaaaaaa.bbbbbbbb.cccccccc', ru);
    expect(secret.message).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(secret.detail).toBeNull();
    expect(String(spy.mock.calls[0]?.[1])).not.toMatch(/eyJaaaaaaaa/);
    spy.mockRestore();

    expect(redactDiagnostic('bearer abc.def.ghi')).toBe('bearer [redacted]');
  });

  it('leaves an already readable message unchanged', () => {
    const view = explainFirstRunFailure('Укажите название.', ru);
    expect(view).toEqual({ message: 'Укажите название.', detail: null });
  });
});
