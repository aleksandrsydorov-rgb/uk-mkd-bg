import { isImageAttachment } from '@/lib/chatMedia';

export function ChatMedia({
  url,
  fileName,
}: {
  url: string;
  fileName?: string | null;
}) {
  if (isImageAttachment(url, fileName)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={fileName ?? ''}
          className="max-h-56 max-w-full rounded-xl object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-lg bg-hover px-3 py-2 text-sm hover:bg-hover"
    >
      <span aria-hidden>📎</span>
      <span className="truncate">{fileName || url}</span>
    </a>
  );
}
