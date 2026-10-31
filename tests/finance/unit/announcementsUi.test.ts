import { describe, expect, it } from 'vitest';
import {
  announcementBodyPreview,
  announcementStatus,
  announcementStatusLabelKey,
  announcementStatusTone,
  validateAnnouncementInput,
} from '@/lib/announcementsUi';

describe('Task 16 · announcements UI helpers', () => {
  it('treats live rows as published and formats previews', () => {
    expect(announcementStatus({ id: 1 })).toBe('published');
    expect(announcementStatusLabelKey('published')).toBe('admin.annStatusPublished');
    expect(announcementStatusTone('published')).toBe('info');
    expect(announcementBodyPreview('  hello   world  ')).toBe('hello world');
    expect(announcementBodyPreview('x'.repeat(200)).endsWith('…')).toBe(true);
  });

  it('validates title and body for create/edit', () => {
    expect(validateAnnouncementInput({ title: '', body: 'a' })).toEqual({
      ok: false,
      errorKey: 'admin.annErrTitle',
    });
    expect(validateAnnouncementInput({ title: 'T', body: '  ' })).toEqual({
      ok: false,
      errorKey: 'admin.annErrBody',
    });
    expect(validateAnnouncementInput({ title: 'T', body: 'Body' })).toEqual({ ok: true });
  });
});
