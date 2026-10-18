'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  otpTypeForTokenHashVerify,
  safeNextPath,
} from '@/lib/auth/emailConfirmation';
import {
  isJwtSignatureUnverifiableError,
  readAuthRedirectError,
} from '@/lib/auth/jwtAuthErrors';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function AuthCallbackInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  /** One-time tokens must not be verified twice (remount / Strict Mode / back-nav). */
  const consumedTokenHashRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const next = safeNextPath(searchParams.get('next'), '/account');

      try {
        const hash =
          typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';

        const redirectErr = readAuthRedirectError({
          searchParams,
          hash,
        });
        if (redirectErr) {
          if (!cancelled) setError(redirectErr);
          return;
        }

        const code = searchParams.get('code');
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          if (!cancelled) router.replace(next);
          return;
        }

        const tokenHash =
          searchParams.get('token_hash') ?? searchParams.get('tokenHash') ?? '';
        const type = otpTypeForTokenHashVerify(searchParams.get('type'));
        if (tokenHash) {
          if (consumedTokenHashRef.current === tokenHash) {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              if (!cancelled) router.replace(next);
              return;
            }
            if (!cancelled) {
              setError(t('authCallback.errGeneric'));
            }
            return;
          }
          consumedTokenHashRef.current = tokenHash;
          const { error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (otpErr) throw otpErr;
          // Drop one-time params so remount/back cannot re-verify.
          if (typeof window !== 'undefined') {
            const clean = new URL(window.location.href);
            clean.searchParams.delete('token_hash');
            clean.searchParams.delete('tokenHash');
            clean.searchParams.delete('type');
            window.history.replaceState(null, '', `${clean.pathname}${clean.search}`);
          }
          if (!cancelled) router.replace(next);
          return;
        }

        // Implicit grant / recovery links land with tokens in the URL hash.
        // Prefer them over any stale browser session (e.g. another user still signed in).
        if (hash.includes('access_token')) {
          const params = new URLSearchParams(hash);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: sessErr } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (sessErr) throw sessErr;
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${window.location.search}`,
            );
            if (!cancelled) router.replace(next);
            return;
          }
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
          const msg =
            err instanceof Error ? err.message : t('authCallback.errGeneric');
          if (isJwtSignatureUnverifiableError(msg)) {
            setError(
              `${msg} — open the operator invite URL that uses token_hash (not an expired Auth action_link), with the SSH tunnel on localhost:3080.`,
            );
          } else {
            setError(msg);
          }
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
