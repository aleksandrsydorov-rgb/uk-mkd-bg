/**
 * EML-2 — Initial Setup / admin Email Core configuration validation.
 * Never enables sending. Never touches host EMAIL_SENDING_ENABLED.
 */

import type { EmailTemplateLocale } from '@/lib/emailCore';

export type EmailSetupDraft = {
  senderName: string;
  replyToEmail: string;
  templateLocale: EmailTemplateLocale;
  /** Optional; only valid when already verified by ops. */
  senderEmail?: string | null;
};

export type EmailSetupValidation = {
  ok: boolean;
  canSaveIdentity: boolean;
  canEnableSending: boolean;
  errors: string[];
  warnings: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeOptionalEmail(value: string | null | undefined): string | null {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  return v;
}

export function isValidEmailAddress(value: string | null | undefined): boolean {
  const v = normalizeOptionalEmail(value);
  if (!v) return false;
  return EMAIL_RE.test(v) && v.includes('.') && v.length <= 254;
}

export function validateEmailSetupDraft(
  draft: EmailSetupDraft,
  opts?: {
    verifiedSenderEmails?: readonly string[];
    domainStatus?: string | null;
    verifiedDomain?: string | null;
    emailEnabled?: boolean;
  }
): EmailSetupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const senderName = String(draft.senderName ?? '').trim();
  const replyTo = normalizeOptionalEmail(draft.replyToEmail);
  const locale = draft.templateLocale;
  const senderEmail = normalizeOptionalEmail(draft.senderEmail);
  const verified = (opts?.verifiedSenderEmails ?? []).map((e) =>
    String(e).trim().toLowerCase()
  );

  if (!senderName) {
    errors.push('sender_name_required');
  } else if (senderName.length > 120) {
    errors.push('sender_name_too_long');
  }

  if (draft.replyToEmail.trim() && !replyTo) {
    errors.push('reply_to_invalid');
  } else if (replyTo && !isValidEmailAddress(replyTo)) {
    errors.push('reply_to_invalid');
  }

  if (locale !== 'bg' && locale !== 'ru' && locale !== 'en') {
    errors.push('locale_invalid');
  }

  if (senderEmail) {
    if (!isValidEmailAddress(senderEmail)) {
      errors.push('sender_email_invalid');
    } else if (!verified.includes(senderEmail)) {
      errors.push('sender_email_not_verified');
    }
  } else {
    warnings.push('sender_email_pending_ops_verification');
  }

  const domainOk =
    opts?.domainStatus === 'verified' && Boolean(String(opts?.verifiedDomain ?? '').trim());
  const senderOk = Boolean(senderEmail && verified.includes(senderEmail));
  const canEnableSending = domainOk && senderOk && errors.length === 0;

  if (!domainOk) {
    warnings.push('domain_not_verified');
  }

  if (opts?.emailEnabled) {
    warnings.push('email_enabled_true_requires_host_gate');
  }

  return {
    ok: errors.length === 0,
    canSaveIdentity: errors.length === 0,
    canEnableSending,
    errors,
    warnings,
  };
}

/** Templates available for admin preview (no send). */
export const EMAIL_PREVIEW_TEMPLATE_KEYS = [
  'pb1_property_invite',
  'ua_nudge',
  'ownership_change_approved',
  'meeting_notice',
  'email_test',
] as const;

export type EmailPreviewTemplateKey = (typeof EMAIL_PREVIEW_TEMPLATE_KEYS)[number];
