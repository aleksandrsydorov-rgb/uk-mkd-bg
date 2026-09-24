'use client';

import { isImageAttachment } from '@/lib/chatMedia';
import { SignedStorageImage, SignedStorageLink } from '@/components/SignedStorageMedia';

export function ChatMedia({
  url,
  fileName,
}: {
  url: string;
  fileName?: string | null;
}) {
  if (isImageAttachment(url, fileName)) {
    return (
      <SignedStorageImage
        stored={url}
        alt={fileName ?? ''}
        className="max-h-56 max-w-full rounded-xl object-cover"
      />
    );
  }

  return (
    <SignedStorageLink
      stored={url}
      className="inline-flex max-w-full items-center gap-2 rounded-lg bg-hover px-3 py-2 text-sm hover:bg-hover"
    >
      <span aria-hidden>📎</span>
      <span className="truncate">{fileName?.trim() || '…'}</span>
    </SignedStorageLink>
  );
}
