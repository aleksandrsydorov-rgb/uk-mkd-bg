'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  normalizeAuthOtpType,
  safeNextPath,
} from '@/lib/auth/emailConfirmation';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function AuthCallbackInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const next = safeNextPath(searchParams.get('next'), '/account');

      try {
        const code = searchParams.get('code');
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          if (!cancelled) router.replace(next);
          return;
        }

        const tokenHash =
          searchParams.get('token_hash') ?? searchParams.get('tokenHash') ?? '';
        const type = normalizeAuthOtpType(searchParams.get('type'));
        if (tokenHash) {
          const { error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (otpErr) throw otpErr;
          if (!cancelled) router.replace(next);
          return;
        }

        // Already signed in (e.g. hash tokens processed by client library)
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (!cancelled) router.replace(next);
          return;
        }

        if (!cancelled) {
          setError(t('authCallback.errMissing'));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('authCallback.errGeneric'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, t]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <BrandMark />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-lg space-y-4 px-4 py-8">
        <h1 className="text-xl font-semibold">{t('authCallback.title')}</h1>
        {error ? (
          <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('authCallback.working')}</p>
        )}
      </main>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">…</div>}>
      <AuthCallbackInner />
    </Suspense>
  );
}
