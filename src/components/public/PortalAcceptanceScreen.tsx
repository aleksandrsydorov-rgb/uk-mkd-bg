'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PublicFooter } from '@/components/public/PublicFooter';
import { useI18n } from '@/i18n/I18nProvider';
import { createClient } from '@/lib/supabase/client';
import { signOutFully } from '@/lib/authSession';
import {
  loadAcceptanceStatus,
  recordAcknowledgements,
  type AcceptanceStatus,
  type LegalOffer,
} from '@/lib/portalLegal/acceptance';
import { portalLegalSlug } from '@/lib/portalLegal/kinds';

function formatDate(value: string | null, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'long',
  }).format(date);
}

function OfferRow({
  offer,
  statement,
  checked,
  required,
  onChange,
}: {
  offer: LegalOffer;
  statement: string;
  checked: boolean;
  required?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const slug = portalLegalSlug(offer.document_kind) ?? 'terms';
  return (
    <label className="legal-offer">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{statement}</strong>
        {required ? <span className="legal-note-inline"> {t('legal.acceptRequired')}</span> : null}
        <span className="legal-meta">
          {offer.title}
          {' · '}
          {t('legal.revision', { number: offer.revision_number })}
          {' · '}
          {t('legal.effective', { date: formatDate(offer.effective_on, locale) })}
        </span>
        {offer.test_edition ? <span className="legal-meta">{t('legal.testBanner')}</span> : null}
        {offer.translation_missing ? <span className="legal-meta">{t('legal.translationMissing')}</span> : null}
        <Link href={`/legal/${slug}/${offer.revision_id}`}>{t('legal.openText')}</Link>
      </span>
    </label>
  );
}

export function PortalAcceptanceScreen() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/account';
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<AcceptanceStatus | null>(null);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace('/');
        return;
      }
      const nextStatus = await loadAcceptanceStatus(supabase, locale);
      if (cancelled) return;
      setError('');
      if (!nextStatus || nextStatus.role === 'staff' || nextStatus.role === 'admin' || !nextStatus.must_accept) {
        router.replace(next);
        return;
      }
      setStatus(nextStatus);
      setTerms(false);
      setPrivacy(false);
      setRules(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, next, router, supabase]);

  async function continueToCabinet() {
    if (!status?.terms) return;
    if (!terms) {
      setError(t('legal.acceptRequired'));
      return;
    }
    setBusy(true);
    setError('');
    const items = [
      { action: 'accept_terms', revision_id: status.terms.revision_id, text_id: status.terms.text_id },
    ];
    if (privacy && status.privacy) {
      items.push({ action: 'ack_privacy', revision_id: status.privacy.revision_id, text_id: status.privacy.text_id });
    }
    if (rules && status.house_rules) {
      items.push({
        action: 'ack_house_rules',
        revision_id: status.house_rules.revision_id,
        text_id: status.house_rules.text_id,
      });
    }
    const result = await recordAcknowledgements(supabase, locale, items);
    setBusy(false);
    if (result.stale && result.status) {
      setStatus(result.status);
      setTerms(false);
      setPrivacy(false);
      setRules(false);
      setStale(true);
      return;
    }
    if (!result.ok || result.status?.must_accept) {
      setError(t('legal.acceptFailed'));
      return;
    }
    router.replace(next);
  }

  return (
    <div className="legal-page">
      <main className="legal-main">
        <div className="mb-4 flex items-center justify-between gap-3">
          <BrandMark compact showTagline={false} />
          <LanguageSwitcher />
        </div>
        <h1>{status?.is_update ? t('legal.acceptUpdateTitle') : t('legal.acceptTitle')}</h1>
        <p>{t('legal.acceptLead')}</p>
        {stale ? <p className="legal-note">{t('legal.acceptStale')}</p> : null}
        {error ? <p className="legal-note">{error}</p> : null}
        {status ? (
          <div className="legal-offers">
            {status.terms ? (
              <OfferRow
                offer={status.terms}
                statement={status.statements.accept_terms}
                checked={terms}
                required
                onChange={setTerms}
              />
            ) : null}
            {status.privacy ? (
              <OfferRow
                offer={status.privacy}
                statement={status.statements.ack_privacy}
                checked={privacy}
                onChange={setPrivacy}
              />
            ) : null}
            {status.house_rules ? (
              <OfferRow
                offer={status.house_rules}
                statement={status.statements.ack_house_rules}
                checked={rules}
                onChange={setRules}
              />
            ) : null}
            <button type="button" className="login-embed-submit" disabled={busy} onClick={() => void continueToCabinet()}>
              {busy ? t('common.saving') : t('legal.acceptContinue')}
            </button>
          </div>
        ) : (
          <p>{t('common.loading')}</p>
        )}
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
