'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { bucketForStoredPath } from '@/lib/privateMedia';

const SIGNED_URL_SECONDS = 600;

export function useSignedStorageUrl(stored: string | null | undefined) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const path = stored?.trim() ?? '';
    const bucket = bucketForStoredPath(path);
    if (!bucket) {
      setHref(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        if (!cancelled) setHref(data?.signedUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setHref(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stored]);

  return href;
}

export function SignedStorageLink({
  stored,
  className,
  children,
}: {
  stored: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const href = useSignedStorageUrl(stored);
  if (!stored) return null;
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

export function SignedStorageImage({
  stored,
  alt,
  className,
}: {
  stored: string;
  alt: string;
  className?: string;
}) {
  const href = useSignedStorageUrl(stored);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} alt={alt} className={className} />
    </a>
  );
}
