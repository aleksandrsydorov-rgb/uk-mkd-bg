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

export function emailHistoryUserStatus(row: {
  status: string;
  latestEventType?: string | null;
  lastErrorCode?: string | null;
  userStatus?: string | null;
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
  const err = String(row.lastErrorCode ?? '')
    .trim()
    .toLowerCase();

  if (status === 'sent') return 'accepted';
  if (status === 'queued' || status === 'held' || status === 'sending') return 'awaiting';
  if (
    status === 'cancelled' ||
    status.startsWith('blocked_') ||
    err.startsWith('blocked_') ||
    err === 'blocked_pre_registration_event' ||
    err === 'blocked_not_registered' ||
    err === 'blocked_not_ready'
  ) {
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

/** Short user-facing skip reason — no raw error codes. */
export function emailHistorySkipReasonKey(
  lastErrorCode: string | null | undefined
): 'admin.emailHistSkipRegistration' | 'admin.emailHistSkipNotReady' | 'admin.emailHistSkipOther' | null {
  const err = String(lastErrorCode ?? '')
    .trim()
    .toLowerCase();
  if (!err) return null;
  if (err === 'blocked_pre_registration_event' || err === 'blocked_not_registered') {
    return 'admin.emailHistSkipRegistration';
  }
  if (err === 'blocked_not_ready' || err.startsWith('blocked_')) {
    return 'admin.emailHistSkipNotReady';
  }
  return 'admin.emailHistSkipOther';
}

export function emailHistorySkipReasonFromRow(row: {
  status?: string | null;
  lastErrorCode?: string | null;
}): ReturnType<typeof emailHistorySkipReasonKey> {
  const err = String(row.lastErrorCode ?? '')
    .trim()
    .toLowerCase();
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
