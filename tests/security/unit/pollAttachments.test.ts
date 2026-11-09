import { describe, expect, it } from 'vitest';
import { bg, en, ru } from '@/i18n/messages';
import {
  MAX_POLL_ATTACHMENTS,
  POLL_ATTACHMENT_ACCEPT,
  isPollAttachmentImage,
  isPollAttachmentPdf,
  pollAttachmentFromFile,
  pollAttachmentList,
  pollLegacyPhotoUrl,
} from '@/lib/polls';
import {
  POLL_IMAGES_BUCKET,
  privateUploadRejectReason,
  MAX_PRIVATE_UPLOAD_BYTES,
} from '@/lib/privateMedia';
import { formatAcceptHint } from '@/components/ui/AppFilePicker';

function fakeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(Math.min(Math.max(size, 1), 64))], { type });
  const file = new File([blob], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

describe('poll attachments helpers', () => {
  it('falls back to legacy photo_url and prefers attachments jsonb', () => {
    expect(pollAttachmentList({ photo_url: null, attachments: null })).toEqual([]);
    const legacy = pollAttachmentList({
      photo_url: 'polls/3/aaaaaaaa-bbbb-4ccc-addd-eeeeeeee0001.jpg',
      attachments: [],
    });
    expect(legacy).toHaveLength(1);
    expect(isPollAttachmentImage(legacy[0]!)).toBe(true);

    const multi = pollAttachmentList({
      photo_url: 'polls/3/old.jpg',
      attachments: [
        {
          path: 'polls/3/aaaaaaaa-bbbb-4ccc-addd-eeeeeeee0002.pdf',
          name: 'смета.pdf',
          size: 1200,
          contentType: 'application/pdf',
        },
        {
          path: 'polls/3/aaaaaaaa-bbbb-4ccc-addd-eeeeeeee0003.png',
          name: 'photo.png',
          size: 800,
          contentType: 'image/png',
        },
      ],
    });
    expect(multi).toHaveLength(2);
    expect(isPollAttachmentPdf(multi[0]!)).toBe(true);
    expect(isPollAttachmentImage(multi[1]!)).toBe(true);
    expect(pollLegacyPhotoUrl(multi)).toBe(multi[1]!.path);
  });

  it('builds attachment meta from File without treating PDF as image', () => {
    const pdf = fakeFile('doc.pdf', 'application/pdf', 2048);
    const att = pollAttachmentFromFile(pdf, 'polls/9/aaaaaaaa-bbbb-4ccc-addd-eeeeeeee0099.pdf');
    expect(isPollAttachmentPdf(att)).toBe(true);
    expect(isPollAttachmentImage(att)).toBe(false);
    expect(att.name).toBe('doc.pdf');
    expect(att.size).toBe(pdf.size);
  });

  it('allows PDF on poll-images bucket; rejects wrong type and oversize', () => {
    expect(
      privateUploadRejectReason(
        POLL_IMAGES_BUCKET,
        fakeFile('a.pdf', 'application/pdf', 100),
      ),
    ).toBeNull();
    expect(
      privateUploadRejectReason(
        POLL_IMAGES_BUCKET,
        fakeFile('a.jpg', 'image/jpeg', 100),
      ),
    ).toBeNull();
    expect(
      privateUploadRejectReason(
        POLL_IMAGES_BUCKET,
        fakeFile('a.docx', 'application/msword', 100),
      ),
    ).toBe('type');
    expect(
      privateUploadRejectReason(
        POLL_IMAGES_BUCKET,
        fakeFile('big.pdf', 'application/pdf', MAX_PRIVATE_UPLOAD_BYTES + 1),
      ),
    ).toBe('size');
  });

  it('exposes human extension accept list without image/* jargon', () => {
    expect(POLL_ATTACHMENT_ACCEPT.includes('image/*')).toBe(false);
    expect(POLL_ATTACHMENT_ACCEPT.toLowerCase()).toContain('.pdf');
    const hint = formatAcceptHint(POLL_ATTACHMENT_ACCEPT);
    expect(hint.toLowerCase()).toContain('pdf');
    expect(hint.toLowerCase()).toMatch(/image/);
    expect(hint.includes('image/*')).toBe(false);
    expect(hint.includes('application/')).toBe(false);
    expect(MAX_POLL_ATTACHMENTS).toBe(5);
    const imageHint = formatAcceptHint('image/*,.pdf');
    expect(imageHint.includes('image/*')).toBe(false);
    expect(imageHint.toLowerCase()).toContain('pdf');
    expect(imageHint.toLowerCase()).toMatch(/image/);
  });

  it('keeps poll attachment keys in ru/en/bg', () => {
    for (const key of [
      'pollAttachments',
      'pollAttachmentsHint',
      'pollAttachmentOpen',
      'pollAttachmentsPartialFail',
    ] as const) {
      expect(ru.admin[key]).toBeTruthy();
      expect(en.admin[key]).toBeTruthy();
      expect(bg.admin[key]).toBeTruthy();
    }
    expect(ru.admin.pollAttachments).toBe('Вложения');
    expect(ru.admin.pollPhoto).toBe('Вложения');
  });
});
