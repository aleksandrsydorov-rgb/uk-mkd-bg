'use client';

import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { SignedStorageImage, SignedStorageLink } from '@/components/SignedStorageMedia';
import {
  isPollAttachmentImage,
  isPollAttachmentPdf,
  type PollAttachment,
} from '@/lib/polls';

function LocalImageThumb({ file, className }: { file: File; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!src) return <div className={className} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={src} alt={file.name} className={className} />
  );
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Saved attachments: image thumbs + PDF cards (signed, never public). */
export function PollAttachmentsView({
  attachments,
  alt,
}: {
  attachments: PollAttachment[];
  alt?: string;
}) {
  const { t } = useI18n();
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((att) =>
        isPollAttachmentPdf(att) || !isPollAttachmentImage(att) ? (
          <div
            key={att.path}
            className="flex min-w-[11rem] max-w-full flex-1 items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 sm:flex-none"
          >
            <FileText className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground" title={att.name}>
                {att.name}
              </p>
              <p className="text-xs text-muted">{formatBytes(att.size)}</p>
            </div>
            <SignedStorageLink
              stored={att.path}
              className="shrink-0 text-xs font-semibold text-accent hover:underline"
            >
              {t('admin.pollAttachmentOpen')}
            </SignedStorageLink>
          </div>
        ) : (
          <SignedStorageImage
            key={att.path}
            stored={att.path}
            alt={alt || att.name}
            className="h-20 w-20 rounded-xl border border-border object-cover sm:h-24 sm:w-24"
          />
        ),
      )}
    </div>
  );
}

/** Pending local files before upload — remove one without clearing the rest. */
export function PollPendingAttachments({
  files,
  onRemove,
  disabled,
}: {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, i) => {
        const isPdf =
          file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        return (
          <div key={`${file.name}-${file.size}-${i}`} className="relative">
            {isPdf ? (
              <div className="flex min-w-[11rem] max-w-[14rem] items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 pr-8">
                <FileText className="h-5 w-5 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                </div>
              </div>
            ) : (
              <LocalImageThumb
                file={file}
                className="h-20 w-20 rounded-xl border border-border object-cover sm:h-24 sm:w-24"
              />
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(i)}
              aria-label={t('admin.pollAttachmentRemove')}
              className="absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-sm hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
