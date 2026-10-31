/**
 * Task 16 — Announcements admin presentation helpers (no ACL / schema changes).
 * Current model: insert publishes immediately; there is no draft column.
 */

export type AnnouncementStatus = 'published';

export function announcementStatus(_row?: {
  id?: number | null;
  created_at?: string | null;
}): AnnouncementStatus {
  return 'published';
}

export function announcementStatusLabelKey(status: AnnouncementStatus): string {
  return status === 'published' ? 'admin.annStatusPublished' : 'admin.annStatusPublished';
}

export function announcementStatusTone(
  status: AnnouncementStatus,
): 'success' | 'info' | 'neutral' {
  return status === 'published' ? 'info' : 'neutral';
}

export function announcementBodyPreview(
  body: string | null | undefined,
  maxChars = 140,
): string {
  const text = String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function validateAnnouncementInput(input: {
  title: string;
  body: string;
}): { ok: true } | { ok: false; errorKey: string } {
  if (!String(input.title ?? '').trim()) {
    return { ok: false, errorKey: 'admin.annErrTitle' };
  }
  if (!String(input.body ?? '').trim()) {
    return { ok: false, errorKey: 'admin.annErrBody' };
  }
  return { ok: true };
}
