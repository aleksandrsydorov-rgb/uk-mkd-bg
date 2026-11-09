import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n/translate';
import { ownerVisibleError } from '@/lib/ownerError';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { mapAdminRpcError } from '@/lib/utilities';
import {
  presentFirstRunErrorRow,
  presentImportReason,
} from '@/lib/firstRunUserMessage';
import { normalizeFirstRunErrors } from '@/lib/firstRun';

const ru = (key: string) => translate('ru', key);
const en = (key: string) => translate('en', key);
const bg = (key: string) => translate('bg', key);

describe('user-facing error mapper', () => {
  it('maps access, session, network, conflict and finance-uncertain cases in three locales', () => {
    expect(toUserFacingMessage({ message: 'permission denied for table staff' }, ru)).toBe(
      'У вас нет прав для этого действия.',
    );
    expect(toUserFacingMessage({ message: 'JWT expired' }, en)).toBe('Your session has ended. Sign in again.');
    expect(toUserFacingMessage(new TypeError('Failed to fetch'), bg, { context: 'load' })).toBe(
      'Данните не можаха да се заредят. Опитайте отново.',
    );
    expect(toUserFacingMessage({ message: 'idempotency key conflict' }, ru)).toContain('уже была отправлена');
    expect(
      toUserFacingMessage(new TypeError('Failed to fetch'), en, {
        context: 'finance',
        financeUncertain: true,
      }),
    ).toBe('Could not confirm the operation result. Check the operations history before sending it again.');
  });

  it('does not show finance-uncertain copy for ordinary load failures', () => {
    const msg = toUserFacingMessage(new TypeError('Failed to fetch'), ru, { context: 'load' });
    expect(msg).toBe(ru('common.errLoad'));
    expect(msg).not.toContain('подтверждение');
  });

  it('never returns SQL/RPC dumps through ownerVisibleError', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = ownerVisibleError(
      { message: 'Could not find the function public.admin_foo(unknown) in the schema cache', code: 'PGRST202' },
      'SAFE_FALLBACK',
      ru,
    );
    expect(msg).toBe('SAFE_FALLBACK');
    expect(msg).not.toMatch(/PGRST|schema cache|admin_foo/i);
    spy.mockRestore();
  });

  it('mapAdminRpcError unknown fallback is a key, never the raw server text', () => {
    const raw = 'permission denied for relation secret_table xyz';
    expect(mapAdminRpcError(raw)).toBe('admin.errNoAccess');
    expect(mapAdminRpcError('totally unknown widget glitch 42')).toBe('admin.errGeneric');
    expect(mapAdminRpcError('totally unknown widget glitch 42')).not.toContain('widget');
  });

  it('unknown technical errors fall back without echoing server text', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = toUserFacingMessage(
      { message: 'operator does not exist: uuid = text', code: '42883', details: 'stack dump here' },
      ru,
      { fallback: 'SAFE' },
    );
    expect(msg).toBe('SAFE');
    expect(msg).not.toMatch(/operator|uuid|stack/i);
    expect(spy).toHaveBeenCalled();
    const logged = String(spy.mock.calls[0]?.[1] ?? '');
    expect(logged).not.toMatch(/stack dump/i);
    spy.mockRestore();
  });

  it('keeps known first-run and receipt reasons specific', () => {
    expect(toUserFacingMessage('first_run: stage tariffs not complete', ru, { context: 'first_run' })).toBe(
      'Завершите настройку тарифов, затем повторите попытку.',
    );
    expect(toUserFacingMessage({ message: 'uk_expenses: receipt required' }, en)).toBe(
      'Attach a supporting document to the expense.',
    );
  });

  it('maps bad login credentials without leaking Auth SDK text', () => {
    expect(toUserFacingMessage({ message: 'Invalid login credentials' }, ru, { context: 'login' })).toBe(
      'Неверный email или пароль. Проверьте данные и попробуйте снова.',
    );
  });

  it('presents property-book import codes as friendly labels without exposing codes', () => {
    expect(presentImportReason('mixed_natural_legal_forbidden', ru)).toBe(ru('admin.errMixedOwnership'));
    expect(presentImportReason('purpose_required', en)).toBe(en('admin.bookIssue_purpose_required'));
    expect(presentImportReason('shares_must_sum_100', bg)).toBe(bg('admin.bookImport_shares_sum_100'));
    const rows = normalizeFirstRunErrors([
      {
        sheet: 'validation',
        row: 4,
        field: 'owners',
        code: 'mixed_natural_legal_forbidden',
        severity: 'error',
        apartment_number: '12',
        codes: ['mixed_natural_legal_forbidden', 'owners'],
      },
      {
        sheet: 'owners',
        row: 5,
        field: 'email',
        code: 'owner_email_required',
        severity: 'warning',
        apartment_number: '12',
      },
    ]);
    expect(rows[0].reason).toBe('mixed_natural_legal_forbidden');
    expect(rows[0].reason).not.toContain('owners');
    const presented = presentFirstRunErrorRow(rows[0], ru);
    expect(presented.reason).toBe(ru('admin.errMixedOwnership'));
    expect(presented.reason).toContain('физическое и юридическое лицо');
    expect(presented.sheet).toBe('owners');
    expect(presented.sheet).not.toBe('validation');
    expect(presented.field).toBe(ru('admin.bookImportFieldOwners'));
    expect(presentFirstRunErrorRow(rows[1], ru).severity).toBe('warning');
    expect(presentFirstRunErrorRow({ ...rows[0], row: '' }, ru).row).toBe('—');
  });

  it('keeps meter/SF/CR severity and uses safe fallback for unknown codes', () => {
    expect(presentImportReason('invalid:opening_balance_kind', ru)).toBe(
      ru('admin.importIssue_opening_balance_kind_invalid'),
    );
    expect(presentImportReason('unknown_apartment', en)).toBe(en('admin.importIssue_unknown_apartment'));
    expect(presentImportReason('mutually_exclusive:debt_and_overpayment', bg)).toBe(
      bg('admin.importIssue_debt_credit_xor'),
    );
    const unknownBlocking = presentFirstRunErrorRow(
      {
        sheet: 'meters',
        row: '7',
        field: 'meter_number',
        reason: 'totally_unknown_code_xyz',
        apartment: '14',
        severity: 'error',
      },
      ru,
      { nothingSaved: true },
    );
    expect(unknownBlocking.severity).toBe('error');
    expect(unknownBlocking.apartment).toBe('14');
    expect(unknownBlocking.row).toBe('7');
    expect(unknownBlocking.reason).toContain(ru('admin.firstRunImportRowCheckFailed'));
    expect(unknownBlocking.reason).toContain(ru('admin.firstRunImportNotSaved'));
    expect(unknownBlocking.reason).not.toBe(ru('admin.bookIssue_unknown'));

    const unknownAfterSave = presentImportReason('totally_unknown_code_xyz', ru, {
      severity: 'error',
      nothingSaved: false,
    });
    expect(unknownAfterSave).toBe(ru('admin.firstRunImportRowCheckFailed'));
    expect(unknownAfterSave).not.toContain(ru('admin.firstRunImportNotSaved'));

    const warnUnknown = presentFirstRunErrorRow(
      {
        sheet: 'owners',
        row: '3',
        field: 'email',
        reason: 'weird_warn_code',
        apartment: '2',
        severity: 'warning',
      },
      en,
      { nothingSaved: true },
    );
    expect(warnUnknown.severity).toBe('warning');
    expect(warnUnknown.reason).toBe(en('admin.firstRunImportRowCheckFailed'));
    expect(warnUnknown.reason).not.toContain(en('admin.firstRunImportNotSaved'));
    expect(warnUnknown.reason).not.toBe(en('admin.bookIssue_unknown'));
  });

  it('does not treat Cyrillic text as automatically safe to show', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = toUserFacingMessage({ message: 'Случайный сырой текст без кода' }, ru, {
      fallback: 'SAFE',
    });
    expect(msg).toBe('SAFE');
    spy.mockRestore();
  });
});
