import { describe, expect, it } from 'vitest';
import {
  emailHistoryFailureReasonKey,
  emailHistoryStatusHintKey,
  emailHistoryStatusLabelKey,
  emailHistoryUserStatus,
} from '@/lib/email/historyStatus';
import { isPermanentProviderFailure } from '@/lib/emailCore';
import { renderTransactionalEmail } from '@/lib/email/templates';

describe('email history status honesty', () => {
  it('does not show awaiting for queued rows with missing_api_key', () => {
    expect(
      emailHistoryUserStatus({
        status: 'queued',
        lastErrorCode: 'missing_api_key',
        attempts: 1,
      })
    ).toBe('failed');
    expect(emailHistoryFailureReasonKey('missing_api_key')).toBe('admin.emailHistFailMissingKey');
  });

  it('maps token_decrypt_failed and claim incomplete to failed with reason', () => {
    expect(
      emailHistoryUserStatus({
        status: 'failed',
        lastErrorCode: 'token_decrypt_failed',
      })
    ).toBe('failed');
    expect(emailHistoryFailureReasonKey('token_decrypt_failed')).toBe(
      'admin.emailHistFailTokenDecrypt'
    );
    expect(
      emailHistoryUserStatus({
        status: 'failed',
        lastErrorCode: 'probe_claim_incomplete',
      })
    ).toBe('failed');
  });

  it('keeps plain queued without error as awaiting', () => {
    expect(emailHistoryUserStatus({ status: 'queued', lastErrorCode: null })).toBe('awaiting');
  });

  it('treats config credential errors as permanent; timeout is not', () => {
    expect(isPermanentProviderFailure('missing_api_key', 'rejected')).toBe(true);
    expect(isPermanentProviderFailure('token_decrypt_failed', 'rejected')).toBe(true);
    expect(isPermanentProviderFailure('timeout', 'error')).toBe(false);
    expect(isPermanentProviderFailure('network_error', 'error')).toBe(false);
  });

  it('labels accepted as sent with service-accepted hint; delivered only via webhook event', () => {
    expect(emailHistoryUserStatus({ status: 'sent' })).toBe('accepted');
    expect(emailHistoryStatusLabelKey('accepted')).toBe('admin.emailHistAccepted');
    expect(emailHistoryStatusHintKey('accepted')).toBe('admin.emailHistAcceptedHint');
    expect(emailHistoryUserStatus({ status: 'sent', latestEventType: 'delivered' })).toBe(
      'delivered'
    );
    expect(emailHistoryStatusHintKey('delivered')).toBeNull();
  });

  it('email_test copy has no E2E / Email Core jargon', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      const r = renderTransactionalEmail({
        templateKey: 'email_test',
        locale,
        complexName: 'AMADEUS XI E2E',
      });
      expect(r.subject + r.html + r.text).not.toMatch(/Email Core/i);
      expect(r.html + r.text).not.toMatch(/контролируем/i);
      expect(r.html + r.text).not.toMatch(/controlled Email Core/i);
      // Complex name may contain E2E from settings; body jargon must not.
      expect(r.html).toMatch(/AMADEUS XI E2E/);
    }
  });
});
