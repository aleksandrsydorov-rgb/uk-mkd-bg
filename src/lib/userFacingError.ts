/**
 * Single user-facing error surface for AMADEUS UI.
 * Prefer stable codes → i18n. Never show SQL/RPC/SDK/stack/UUID dumps in the UI.
 * Technical text goes to the console (redacted) for developers.
 */

import { explainFirstRunFailure, firstRunFailureText, redactDiagnostic } from '@/lib/firstRunUserMessage';
import { mapAdminRpcError } from '@/lib/utilities';
import { expenseReceiptServerErrorKey } from '@/lib/expenses';
import { messageForUploadError } from '@/lib/privateMedia';

export type UserFacingTranslate = (key: string) => string;

export type UserFacingContext =
  | 'generic'
  | 'load'
  | 'save'
  | 'login'
  | 'finance'
  | 'file'
  | 'first_run';

type ErrorParts = {
  message: string;
  code: string;
  details: string;
  hint: string;
  status: number | null;
  name: string;
};

export type UserFacingOptions = {
  /** Already-translated fallback for this action. */
  fallback?: string;
  /** Narrows generic copy (load vs save vs finance). */
  context?: UserFacingContext;
  /** True when a money-moving request may have been accepted without a clear response. */
  financeUncertain?: boolean;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function extractErrorParts(raw: unknown): ErrorParts {
  if (typeof raw === 'string') {
    return { message: raw.trim(), code: '', details: '', hint: '', status: null, name: '' };
  }
  if (raw instanceof Error) {
    const anyErr = raw as Error & { code?: unknown; details?: unknown; hint?: unknown; status?: unknown };
    return {
      message: raw.message.trim(),
      code: str(anyErr.code),
      details: str(anyErr.details),
      hint: str(anyErr.hint),
      status: typeof anyErr.status === 'number' ? anyErr.status : null,
      name: raw.name || '',
    };
  }
  const obj = asRecord(raw);
  if (!obj) {
    return { message: '', code: '', details: '', hint: '', status: null, name: '' };
  }
  return {
    message: str(obj.message) || str(obj.error_description) || str(obj.error),
    code: str(obj.code) || str(obj.error_code) || str(obj.error),
    details: str(obj.details),
    hint: str(obj.hint),
    status: typeof obj.status === 'number' ? obj.status : typeof obj.statusCode === 'number' ? obj.statusCode : null,
    name: str(obj.name),
  };
}

export function isTechnicalErrorText(text: string): boolean {
  if (!text.trim()) return false;
  return /PGRST|PostgREST|invalid api key|\bjwt\b|JWKS|permission denied|schema cache|42P01|42703|23505|23503|42501|57014|could not find the function|row-level security|violates row-level|service_role|\bsmtp\b|lettermint|bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.|rpc_[a-z0-9_]+|relation ["']?\w+|column ["']?\w+|function [a-z0-9_.]+|stack trace|TypeError|ReferenceError|SyntaxError|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|Failed to fetch|NetworkError|AbortError|supabase|postgres|SQLSTATE|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    text,
  );
}

function combinedProbe(parts: ErrorParts): string {
  return [parts.code, parts.message, parts.details, parts.hint, parts.name].filter(Boolean).join(' | ');
}

function logDev(_raw: unknown, parts: ErrorParts): void {
  // Safe diagnostics only: code + short message. No full object, details/hint dumps,
  // tokens, emails, or money amounts.
  const probe = redactDiagnostic([parts.code, parts.message].filter(Boolean).join(' | '))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:BG)?\d{9,13}\b/g, '[id]')
    .replace(/\b\d+[.,]\d{2}\s*(?:EUR|BGN|€)?\b/gi, '[amount]')
    .slice(0, 240);
  if (probe) console.error('[user-facing-error]', probe);
}

function isNetworkFailure(parts: ErrorParts, raw: unknown): boolean {
  const probe = combinedProbe(parts).toLowerCase();
  if (parts.name === 'AbortError' || parts.name === 'TimeoutError') return true;
  if (/failed to fetch|networkerror|load failed|econn|enotfound|etimedout|network request failed|the internet connection appears|err_network/i.test(probe)) {
    return true;
  }
  if (raw instanceof TypeError && /fetch/i.test(raw.message)) return true;
  return false;
}

function isSessionFailure(parts: ErrorParts): boolean {
  const probe = combinedProbe(parts).toLowerCase();
  if (parts.status === 401) return true;
  return /session.?expired|jwt expired|invalid.?jwt|not authenticated|refresh.?token|auth session missing|login required|unauthorized|invalid.?claim/i.test(
    probe,
  );
}

function isAccessFailure(parts: ErrorParts): boolean {
  const probe = combinedProbe(parts).toLowerCase();
  if (parts.status === 403 || parts.code === '42501' || /^PGRST301$/i.test(parts.code)) return true;
  return /not authorized|permission denied|row-level security|insufficient.?privilege|forbidden|access denied|нет прав|нямате права/i.test(
    probe,
  );
}

function isConflictFailure(parts: ErrorParts): boolean {
  const probe = combinedProbe(parts).toLowerCase();
  if (parts.code === '23505' || parts.status === 409) return true;
  return /idempotency key conflict|concurrent|stale|was modified|version conflict|already exists for this|optimistic/i.test(
    probe,
  );
}

function isAuthCredentialFailure(parts: ErrorParts): boolean {
  const probe = combinedProbe(parts).toLowerCase();
  return /invalid login credentials|invalid.?email.?or.?password|email not confirmed|user not found|wrong password|invalid credentials/i.test(
    probe,
  );
}

function defaultFallback(t: UserFacingTranslate, context: UserFacingContext, explicit?: string): string {
  if (explicit?.trim()) return explicit;
  switch (context) {
    case 'load':
      return t('common.errLoad');
    case 'save':
      return t('common.errSave');
    case 'login':
      return t('common.errLogin');
    case 'finance':
      return t('common.errFinance');
    case 'file':
      return t('common.errFile');
    case 'first_run':
      return t('admin.firstRunErrUnknown');
    default:
      return t('common.errUnknown');
  }
}

/**
 * Map any thrown/returned error into a localized, safe UI string.
 * Never returns SQL/RPC/details/hint/stack content.
 */
export function toUserFacingMessage(
  raw: unknown,
  t: UserFacingTranslate,
  options: UserFacingOptions = {},
): string {
  const context = options.context ?? 'generic';
  const fallback = defaultFallback(t, context, options.fallback);
  const parts = extractErrorParts(raw);
  const probe = combinedProbe(parts);

  if (options.financeUncertain || (context === 'finance' && isNetworkFailure(parts, raw))) {
    if (options.financeUncertain || isNetworkFailure(parts, raw)) {
      logDev(raw, parts);
      return t('common.errFinanceUncertain');
    }
  }

  if (isNetworkFailure(parts, raw)) {
    logDev(raw, parts);
    return context === 'load' ? t('common.errLoad') : t('common.errNetwork');
  }

  if (isSessionFailure(parts)) {
    logDev(raw, parts);
    return t('common.errSession');
  }

  if (isAccessFailure(parts)) {
    logDev(raw, parts);
    return t('common.errNoAccess');
  }

  if (isAuthCredentialFailure(parts)) {
    return t('common.errBadCredentials');
  }

  if (isConflictFailure(parts)) {
    if (/idempotency key conflict/i.test(probe)) return t('admin.errIdempotency');
    return t('common.errConflict');
  }

  const receiptKey = expenseReceiptServerErrorKey(parts.message || probe);
  if (receiptKey) return t(receiptKey);

  const uploadMsg = messageForUploadError(raw, t('common.errFileType'), t('common.errFileSize'));
  if (uploadMsg) return uploadMsg;

  if (/^first_run:/i.test(parts.message) || context === 'first_run') {
    const view = explainFirstRunFailure(raw, t);
    return view.message || fallback;
  }

  if (parts.message) {
    const adminKey = mapAdminRpcError(parts.message);
    if (adminKey !== 'admin.errGeneric') return t(adminKey);
  }

  // No script-based “looks human” heuristic — dictionary / fallback only.
  if (probe) logDev(raw, parts);
  return fallback;
}

/** Safe reference code for support (not an exception dump). */
export function userFacingReferenceCode(raw: unknown): string | null {
  const parts = extractErrorParts(raw);
  const seed = redactDiagnostic(parts.code || parts.message).replace(/[^a-zA-Z0-9]/g, '');
  if (!seed) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `AMA-${hash.toString(16).toUpperCase().slice(0, 8)}`;
}

/** Extract plain text for mappers that still take a string (legacy bridges). */
export function errorTextForMapper(raw: unknown): string {
  return firstRunFailureText(raw);
}
