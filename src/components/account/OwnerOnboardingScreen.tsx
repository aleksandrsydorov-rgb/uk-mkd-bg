'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PublicFooter } from '@/components/public/PublicFooter';
import { useI18n } from '@/i18n/I18nProvider';
import { createClient } from '@/lib/supabase/client';
import { signOutFully } from '@/lib/authSession';
import { acceptPath } from '@/lib/portalLegal/acceptance';
import {
  loadOwnerFirstLoginStatus,
  type OwnerOnboardingProperty,
} from '@/lib/ownerOnboarding';

function Field({
  label,
  value,
  onChange,
  required,
  readOnly,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm text-secondary">
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:bg-hover disabled:text-muted"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        disabled={readOnly}
        required={required && !readOnly}
        placeholder={placeholder}
      />
    </label>
  );
}

function propertyHeading(p: OwnerOnboardingProperty, t: (k: string, v?: Record<string, string>) => string) {
  const apt = p.apartment_number || '—';
  const section = p.section_code ? String(p.section_code) : '';
  if (section) return t('onboarding.aptWithSection', { apt, section });
  return t('onboarding.aptOnly', { apt });
}

export function OwnerOnboardingScreen() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/account';
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ukBlocked, setUkBlocked] = useState(false);
  const [props, setProps] = useState<OwnerOnboardingProperty[]>([]);
  const [forms, setForms] = useState<
    Record<
      number,
      {
        first_name: string;
        middle_name: string;
        last_name: string;
        email: string;
        phone: string;
      }
    >
  >({});

  const incomplete = useMemo(
    () => props.filter((p) => !p.access_ready && p.invite_accepted),
    [props],
  );

  async function refresh() {
    const status = await loadOwnerFirstLoginStatus(supabase, locale);
    if (!status) {
      setError(t('onboarding.loadFailed'));
      setLoading(false);
      return;
    }
    if (!status.must_complete_profile) {
      if (status.must_accept_terms) {
        router.replace(acceptPath(next));
      } else {
        router.replace(next);
      }
      return;
    }
    setProps(status.properties);
    const nextForms: typeof forms = {};
    for (const p of status.properties) {
      nextForms[p.property_id] = {
        first_name: p.first_name ?? '',
        middle_name: p.middle_name ?? '',
        last_name: p.last_name ?? '',
        email: p.email ?? '',
        phone: p.phone ?? '',
      };
      const uk = p.clarification?.uk_only_fields ?? [];
      if (Array.isArray(uk) && uk.length > 0 && !(p.clarification?.owner_can_complete)) {
        setUkBlocked(true);
      }
    }
    setForms(nextForms);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace('/');
        return;
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale/next drive reload
  }, [locale, next, router, supabase]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      for (const p of incomplete) {
        const form = forms[p.property_id];
        if (!form) continue;
        const missing = p.clarification?.missing_fields ?? [];
        if (missing.includes('ownership_share_percent') || missing.includes('entity_name')) {
          setUkBlocked(true);
          setError(t('onboarding.ukOnlyFields'));
          setBusy(false);
          return;
        }
        if (!form.first_name.trim() || !form.last_name.trim()) {
          setError(t('onboarding.namesRequired'));
          setBusy(false);
          return;
        }
        const patch: Record<string, string> = {};
        if (!(p.first_name ?? '').trim()) patch.first_name = form.first_name.trim();
        if (!(p.last_name ?? '').trim()) patch.last_name = form.last_name.trim();
        if (!(p.middle_name ?? '').trim() && form.middle_name.trim()) {
          patch.middle_name = form.middle_name.trim();
        }
        if (!(p.email ?? '').trim() && form.email.trim()) patch.email = form.email.trim();
        if (!(p.phone ?? '').trim() && form.phone.trim()) patch.phone = form.phone.trim();

        const { error: rpcErr } = await supabase.rpc('owner_update_own_registry_contact', {
          p_property_id: p.property_id,
          p_patch: patch,
        });
        if (rpcErr) throw rpcErr;
      }
      const status = await loadOwnerFirstLoginStatus(supabase, locale);
      if (status?.must_complete_profile) {
        setError(t('onboarding.stillIncomplete'));
        await refresh();
        return;
      }
      if (status?.must_accept_terms) {
        router.replace(acceptPath(next));
        return;
      }
      router.replace(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('err.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="legal-page">
      <main className="legal-main">
        <div className="mb-4 flex items-center justify-between gap-3">
          <BrandMark compact showTagline={false} />
          <LanguageSwitcher />
        </div>
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.lead')}</p>
        {loading ? <p>{t('common.loading')}</p> : null}
        {error ? <p className="legal-note">{error}</p> : null}
        {ukBlocked ? <p className="legal-note">{t('onboarding.ukOnlyFields')}</p> : null}
        {!loading && incomplete.length > 0 ? (
          <form className="space-y-6" onSubmit={(e) => void handleSave(e)}>
            {incomplete.map((p) => {
              const form = forms[p.property_id] ?? {
                first_name: '',
                middle_name: '',
                last_name: '',
                email: '',
                phone: '',
              };
              const firstLocked = Boolean((p.first_name ?? '').trim());
              const lastLocked = Boolean((p.last_name ?? '').trim());
              const emailLocked = Boolean((p.email ?? '').trim());
              const phoneLocked = Boolean((p.phone ?? '').trim());
              return (
                <section key={p.property_id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
                  <h2 className="text-base font-semibold text-foreground">{propertyHeading(p, t)}</h2>
                  <p className="text-xs text-secondary">{t('onboarding.readOnlyHint')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('onboarding.apartment')}
                      value={p.apartment_number ?? '—'}
                      readOnly
                    />
                    <Field
                      label={t('onboarding.section')}
                      value={p.section_code ?? '—'}
                      readOnly
                    />
                    <Field
                      label={t('onboarding.share')}
                      value={
                        p.ownership_share_percent != null ? String(p.ownership_share_percent) : '—'
                      }
                      readOnly
                    />
                    <Field
                      label={t('onboarding.entityKind')}
                      value={p.entity_kind ?? '—'}
                      readOnly
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label={t('book.firstName')}
                      value={form.first_name}
                      required={!firstLocked}
                      readOnly={firstLocked}
                      onChange={(v) =>
                        setForms((prev) => ({
                          ...prev,
                          [p.property_id]: { ...form, first_name: v },
                        }))
                      }
                    />
                    <Field
                      label={t('book.middleName')}
                      value={form.middle_name}
                      placeholder={t('onboarding.middleOptional')}
                      readOnly={Boolean((p.middle_name ?? '').trim())}
                      onChange={(v) =>
                        setForms((prev) => ({
                          ...prev,
                          [p.property_id]: { ...form, middle_name: v },
                        }))
                      }
                    />
                    <Field
                      label={t('book.lastName')}
                      value={form.last_name}
                      required={!lastLocked}
                      readOnly={lastLocked}
                      onChange={(v) =>
                        setForms((prev) => ({
                          ...prev,
                          [p.property_id]: { ...form, last_name: v },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('login.emailLabel')}
                      value={form.email}
                      required={!emailLocked}
                      readOnly={emailLocked}
                      onChange={(v) =>
                        setForms((prev) => ({
                          ...prev,
                          [p.property_id]: { ...form, email: v },
                        }))
                      }
                    />
                    <Field
                      label={t('onboarding.phone')}
                      value={form.phone}
                      readOnly={phoneLocked}
                      placeholder={t('onboarding.phoneOptional')}
                      onChange={(v) =>
                        setForms((prev) => ({
                          ...prev,
                          [p.property_id]: { ...form, phone: v },
                        }))
                      }
                    />
                  </div>
                </section>
              );
            })}
            <button type="submit" className="login-embed-submit" disabled={busy || ukBlocked}>
              {busy ? t('common.saving') : t('onboarding.saveContinue')}
            </button>
          </form>
        ) : null}
        <p className="legal-actions">
          <Link href="/legal/operator">{t('legal.linkContacts')}</Link>
          <button
            type="button"
            className="home-foot-nav-link"
            onClick={() => void signOutFully(supabase).then(() => router.replace('/'))}
          >
            {t('legal.acceptLogout')}
          </button>
        </p>
      </main>
      <PublicFooter cabinetHref="/" />
    </div>
  );
}
