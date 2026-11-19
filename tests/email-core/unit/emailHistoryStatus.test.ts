import { describe, expect, it } from 'vitest';
import {
  emailHistoryFailureReasonKey,
  emailHistoryUserStatus,
} from '@/lib/email/historyStatus';
import { isPermanentProviderFailure } from '@/lib/emailCore';

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
});
