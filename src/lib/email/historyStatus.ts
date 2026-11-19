/**
 * User-facing send-history statuses — never expose raw outbox enums in UI.
 */

export const EMAIL_HISTORY_USER_STATUSES = [
  'awaiting',
  'accepted',
  'delivered',
  'failed',
  'skipped',
] as const;

export type EmailHistoryUserStatus = (typeof EMAIL_HISTORY_USER_STATUSES)[number];

/** Config / credential errors that must not display as endless "awaiting". */
const TERMINAL_CONFIG_ERRORS = new Set([
  'missing_api_key',
  'token_decrypt_failed',
  'provider_not_configured',
  'provider_token_missing',
  'encryption_key_not_configured',
  'probe_claim_incomplete',
  'claim_failed',
  'claim_missed_target',
]);

function normalizeError(lastErrorCode: string | null | undefined): string {
  return String(lastErrorCode ?? '')
    .trim()
    .toLowerCase()
    .replace(/^permanent:/, '');
}

export function emailHistoryUserStatus(row: {
  status: string;
  latestEventType?: string | null;
  lastErrorCode?: string | null;
  userStatus?: string | null;
  attempts?: number | null;
}): EmailHistoryUserStatus {
  const preset = String(row.userStatus ?? '')
    .trim()
    .toLowerCase();
  if ((EMAIL_HISTORY_USER_STATUSES as readonly string[]).includes(preset)) {
    return preset as EmailHistoryUserStatus;
  }

  const ev = String(row.latestEventType ?? '')
    .trim()
    .toLowerCase();
  if (ev === 'delivered') return 'delivered';

  const status = String(row.status ?? '')
    .trim()
    .toLowerCase();
  const err = normalizeError(row.lastErrorCode);

  if (status === 'sent') return 'accepted';

  // Queued/held with a terminal config error → failed (not infinite awaiting).
  if (
    (status === 'queued' || status === 'held' || status === 'sending' || status === 'failed') &&
    err &&
    (TERMINAL_CONFIG_ERRORS.has(err) || err.startsWith('permanent:'))
  ) {
    return 'failed';
  }
  if (status === 'failed') return 'failed';

  if (status === 'queued' || status === 'held' || status === 'sending') return 'awaiting';
  if (
    status === 'cancelled' ||
    status.startsWith('blocked_') ||
    err.startsWith('blocked_') ||
    err === 'blocked_pre_registration_event' ||
    err === 'blocked_not_registered' ||
    err === 'blocked_not_ready' ||
    err === 'cleared_before_controlled_test' ||
    err === 'probe_claim_incomplete'
  ) {
    if (err === 'probe_claim_incomplete') return 'failed';
    return 'skipped';
  }
  return 'failed';
}

export function emailHistoryStatusLabelKey(
  status: EmailHistoryUserStatus
):
  | 'admin.emailHistAwaiting'
  | 'admin.emailHistAccepted'
  | 'admin.emailHistDelivered'
  | 'admin.emailHistFailed'
  | 'admin.emailHistSkipped' {
  switch (status) {
    case 'accepted':
      return 'admin.emailHistAccepted';
    case 'delivered':
      return 'admin.emailHistDelivered';
    case 'failed':
      return 'admin.emailHistFailed';
    case 'skipped':
      return 'admin.emailHistSkipped';
    default:
      return 'admin.emailHistAwaiting';
  }
}

/** Optional second line under the status (accepted ≠ delivered). */
export function emailHistoryStatusHintKey(
  status: EmailHistoryUserStatus
): 'admin.emailHistAcceptedHint' | null {
  if (status === 'accepted') return 'admin.emailHistAcceptedHint';
  return null;
}

/** Short user-facing skip reason — no raw error codes. */
export function emailHistorySkipReasonKey(
  lastErrorCode: string | null | undefined
): 'admin.emailHistSkipRegistration' | 'admin.emailHistSkipNotReady' | 'admin.emailHistSkipOther' | null {
  const err = normalizeError(lastErrorCode);
  if (!err) return null;
  if (err === 'blocked_pre_registration_event' || err === 'blocked_not_registered') {
    return 'admin.emailHistSkipRegistration';
  }
  if (err === 'blocked_not_ready' || err.startsWith('blocked_')) {
    return 'admin.emailHistSkipNotReady';
  }
  if (err === 'cleared_before_controlled_test') {
    return 'admin.emailHistSkipOther';
  }
  return 'admin.emailHistSkipOther';
}

/** User-facing failure / block reason under the status label. */
export function emailHistoryFailureReasonKey(
  lastErrorCode: string | null | undefined
):
  | 'admin.emailHistFailTokenDecrypt'
  | 'admin.emailHistFailMissingKey'
  | 'admin.emailHistFailProviderConfig'
  | 'admin.emailHistFailClaim'
  | 'admin.emailHistFailOther'
  | null {
  const err = normalizeError(lastErrorCode);
  if (!err) return null;
  if (err === 'token_decrypt_failed') return 'admin.emailHistFailTokenDecrypt';
  if (err === 'missing_api_key') return 'admin.emailHistFailMissingKey';
  if (
    err === 'provider_not_configured' ||
    err === 'provider_token_missing' ||
    err === 'encryption_key_not_configured'
  ) {
    return 'admin.emailHistFailProviderConfig';
  }
  if (
    err === 'probe_claim_incomplete' ||
    err === 'claim_failed' ||
    err === 'claim_missed_target'
  ) {
    return 'admin.emailHistFailClaim';
  }
  if (err.startsWith('blocked_') || err === 'cleared_before_controlled_test') return null;
  return 'admin.emailHistFailOther';
}

export function emailHistorySkipReasonFromRow(row: {
  status?: string | null;
  lastErrorCode?: string | null;
}): ReturnType<typeof emailHistorySkipReasonKey> {
  const err = normalizeError(row.lastErrorCode);
  if (err) return emailHistorySkipReasonKey(err);
  const status = String(row.status ?? '')
    .trim()
    .toLowerCase();
  if (status.startsWith('blocked_') || status === 'cancelled') {
    return status.includes('registration')
      ? 'admin.emailHistSkipRegistration'
      : 'admin.emailHistSkipNotReady';
  }
  return null;
}

/** UI groups for complex notification policy (email channel only). */
export const NOTIFY_SETTINGS_GROUPS = [
  {
    id: 'finance',
    moduleKeys: ['support_fee', 'capital_repair', 'uk_budget_expenses'] as const,
  },
  {
    id: 'meters',
    moduleKeys: ['meters', 'internet'] as const,
  },
  {
    id: 'requests',
    moduleKeys: ['tickets_chat'] as const,
  },
  {
    id: 'messages',
    moduleKeys: ['meetings'] as const,
  },
  {
    id: 'documents',
    moduleKeys: [
      'property_book',
      'ownership_transfer',
      'user_activation',
      'residence_status',
      'cleaning',
      'inventory',
    ] as const,
  },
] as const;

export type NotifySettingsGroupId = (typeof NOTIFY_SETTINGS_GROUPS)[number]['id'];
