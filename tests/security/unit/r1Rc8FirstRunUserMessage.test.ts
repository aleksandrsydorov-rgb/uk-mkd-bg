import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n/translate';
import {
  budgetYearStatusLabel,
  explainFirstRunFailure,
  presentInternetConnectionState,
  presentInternetImportOutcome,
  presentInternetImportWarning,
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
    expect(view.detail).toBeNull();
    expect(explainFirstRunFailure('first_run: stage tariffs not complete', en).message).toBe(
      'Finish the tariff setup, then try again.',
    );
    expect(explainFirstRunFailure('first_run: stage tariffs not complete', bg).message).toBe(
      'Завършете настройката на тарифите, след това опитайте отново.',
    );
  });

  it('maps opening_import budget-year errors instead of the generic action-failed copy', () => {
    const missing = explainFirstRunFailure('opening_import: budget year missing', ru);
    expect(missing.message).toBe(ru('admin.firstRunErrBudgetYear'));
    expect(missing.message).not.toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(explainFirstRunFailure('opening_import: budget year missing', en).message).toBe(
      en('admin.firstRunErrBudgetYear'),
    );
    expect(explainFirstRunFailure('opening_import: budget year 2026 missing', ru).message).toContain(
      '2026',
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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unknown = explainFirstRunFailure('first_run: something new happened', ru);
    expect(unknown.message).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(unknown.detail).toBeNull();

    const secret = explainFirstRunFailure('jwt rejected eyJaaaaaaaa.bbbbbbbb.cccccccc', ru);
    expect(secret.message).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(secret.detail).toBeNull();
    expect(String(spy.mock.calls.at(-1)?.[1] ?? '')).not.toMatch(/eyJaaaaaaaa/);
    spy.mockRestore();

    expect(redactDiagnostic('bearer abc.def.ghi')).toBe('bearer [redacted]');
  });

  it('does not treat Cyrillic free text as a safe message without a dictionary hit', () => {
    const view = explainFirstRunFailure('Укажите название.', ru);
    expect(view).toEqual({
      message: 'Не удалось выполнить действие. Повторите попытку.',
      detail: null,
    });
  });

  it('localizes internet opening preview outcomes before and after commit', () => {
    expect(presentInternetImportOutcome('CREATE', ru)).toBe('Будет добавлено');
    expect(presentInternetImportOutcome('UPDATE', ru)).toBe('Будет обновлено');
    expect(presentInternetImportOutcome('SKIP', ru)).toBe('Без изменений');
    expect(presentInternetImportOutcome('CREATE', ru, { committed: true })).toBe('Добавлено');
    expect(presentInternetImportOutcome('CREATE', en)).toBe('Will be added');
    expect(presentInternetImportOutcome('CREATE', bg)).toBe('Ще бъде добавено');
    expect(presentInternetImportOutcome('WEIRD_CODE', ru)).toBe('Действие не определено');
    expect(presentInternetImportOutcome('CREATED', ru, { committed: true })).toBe('Добавлено');
    expect(presentInternetImportOutcome('SKIPPED_EXISTING', ru, { committed: true })).toBe(
      'Без изменений',
    );
    expect(presentInternetImportOutcome('FAILED', ru, { committed: true })).toBe('Не выполнено');
    expect(presentInternetImportOutcome('NOT_PROCESSED', ru)).toBe('Не обработано');
    expect(presentInternetImportOutcome('CONFLICT', en)).toBe('Conflicts with existing data');
  });

  it('translates internet warnings and hides prepaid next_charge noise', () => {
    expect(presentInternetImportWarning('paid_through_only_no_period_start', ru)).toBe(
      'Указана дата окончания оплаты, дата начала неизвестна.',
    );
    expect(presentInternetImportWarning('paid_period_gap', ru)).toBe(
      'Между указанными периодами нет сведений об оплате.',
    );
    expect(
      presentInternetImportWarning('next_charge_not_scheduled_paid_through_not_after_today', ru, {
        billingMode: 'prepaid_period',
      }),
    ).toBeNull();
    expect(
      presentInternetImportWarning('next_charge_not_scheduled_paid_period_expired', ru, {
        billingMode: 'monthly',
      }),
    ).toBe('Месячное начисление не запланировано: оплаченный период уже истёк.');
    expect(presentInternetImportWarning('totally_unknown_warn_code', ru)).toBe(
      'Есть замечание по этой строке. Проверьте даты и суммы.',
    );
    expect(presentInternetImportWarning('paid_through_only_no_period_start', en)).toMatch(
      /payment end date is set/i,
    );
    expect(presentInternetImportWarning('paid_period_gap', bg)).toMatch(/няма данни/i);
  });

  it('localizes connection state without leaking enums', () => {
    expect(presentInternetConnectionState('active', ru)).toBe('Подключён');
    expect(presentInternetConnectionState('inactive', ru)).toBe('Отключён');
    expect(presentInternetConnectionState('active', en)).toBe('Connected');
    expect(presentInternetConnectionState('inactive', bg)).toBe('Изключен');
    expect(presentInternetConnectionState('weird', ru)).toBe('Состояние не распознано');
  });
});
