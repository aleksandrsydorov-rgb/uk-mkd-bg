'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicFooter } from '@/components/public/PublicFooter';
import { useI18n } from '@/i18n/I18nProvider';
import { CLIENT_STORAGE_INVENTORY, COOKIE_BANNER_REQUIRED } from '@/lib/portalLegal/cookies';
import { portalLegalKind, type PortalLegalSlug } from '@/lib/portalLegal/kinds';
import { OPERATOR_FACTS } from '@/lib/portalLegal/operatorFacts';
import type { LegalArchiveItem, LegalSnapshot } from '@/lib/portalLegal/server';

function formatDate(value: string | null, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'long',
  }).format(date);
}

export function LegalDocumentView({
  slug,
  revisionId,
}: {
  slug: PortalLegalSlug;
  revisionId?: string;
}) {
  const { locale, t } = useI18n();
  const [snapshot, setSnapshot] = useState<LegalSnapshot | null>(null);
  const [archive, setArchive] = useState<LegalArchiveItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'unavailable'>('loading');

  useEffect(() => {
    const kind = portalLegalKind(slug);
    const controller = new AbortController();
    const snapshotUrl = revisionId
      ? `/api/public/legal/revision/${revisionId}?locale=${locale}`
      : `/api/public/legal/${slug}?locale=${locale}`;
    Promise.all([
      fetch(snapshotUrl, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
        if (response.status === 404) return 'missing' as const;
        if (!response.ok) return 'unavailable' as const;
        setSnapshot((await response.json()) as LegalSnapshot);
        return 'ready' as const;
      }),
      fetch(`/api/public/legal/${slug}/archive`, { signal: controller.signal, cache: 'no-store' })
        .then(async (response) => (response.ok ? ((await response.json()) as LegalArchiveItem[]) : []))
        .catch(() => [] as LegalArchiveItem[]),
    ])
      .then(([nextState, items]) => {
        if (controller.signal.aborted) return;
        setArchive(items);
        setState(nextState);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('unavailable');
      });
    return () => controller.abort();
  }, [locale, revisionId, slug]);

  const downloadHref = snapshot
    ? `/api/public/legal/revision/${snapshot.revision_id}/download?locale=${snapshot.locale}`
    : null;

  return (
    <div className="legal-page">
      <main className="legal-main">
        <p className="legal-kicker">{t('legal.footerComplex')}</p>
        <h1>{t(`legal.link${slug === 'operator' ? 'Contacts' : slug === 'terms' ? 'Terms' : slug === 'privacy' ? 'Privacy' : slug === 'cookies' ? 'Cookies' : 'Rules'}`)}</h1>
        {slug === 'operator' ? <OperatorFacts /> : null}
        {slug === 'cookies' ? <CookieFacts /> : null}
        {slug === 'house-rules' ? <p className="legal-note">{t('legal.rulesDraft')}</p> : null}
        {state === 'loading' ? <p>{t('common.loading')}</p> : null}
        {state === 'unavailable' ? <p className="legal-note">{t('legal.unavailable')}</p> : null}
        {state === 'missing' ? <p className="legal-note">{t('legal.notFound')}</p> : null}
        {state === 'ready' && snapshot ? (
          <article className="legal-article">
            {snapshot.test_edition ? <p className="legal-test">{t('legal.testBanner')}</p> : null}
            <p className="legal-meta">
              {t('legal.revision', { number: snapshot.revision_number })}
              {' · '}
              {t('legal.effective', { date: formatDate(snapshot.effective_on, locale) })}
              {' · '}
              {t('legal.published', { date: formatDate(snapshot.published_at, locale) })}
              {' · '}
              {!revisionId || snapshot.status === 'published'
                ? t('legal.statusPublished')
                : t('legal.statusSuperseded')}
            </p>
            <p className="legal-meta">{t('legal.originalBg')}</p>
            {snapshot.translation_missing ? <p className="legal-note">{t('legal.translationMissing')}</p> : null}
            <h2>{snapshot.title}</h2>
            <div className="legal-body">
              {snapshot.body.split('\n').map((line, index) => (
                <p key={`${snapshot.text_id}-${index}`}>{line || '\u00a0'}</p>
              ))}
            </div>
            <p className="legal-actions">
              {downloadHref ? (
                <a className="home-foot-nav-link" href={downloadHref}>
                  {t('legal.linkDownload')}
                </a>
              ) : null}
              <a className="home-foot-nav-link" href="#archive">
                {t('legal.linkArchive')}
              </a>
            </p>
            <p className="legal-id">
              revision_id {snapshot.revision_id}
              <br />
              text_id {snapshot.text_id}
            </p>
          </article>
        ) : null}
        {archive.length > 0 ? (
          <section className="legal-archive" id="archive">
            <h2>{t('legal.linkArchive')}</h2>
            <ul>
              {archive.map((item) => (
                <li key={item.revision_id}>
                  <Link href={`/legal/${slug}/${item.revision_id}`}>
                    {t('legal.revision', { number: item.revision_number })}
                  </Link>
                  <span>
                    {' '}
                    · {snapshot && item.revision_id === snapshot.revision_id && !revisionId
                      ? t('legal.statusPublished')
                      : item.status === 'published'
                        ? t('legal.statusPublished')
                        : t('legal.statusSuperseded')}
                    {' · '}
                    {formatDate(item.effective_on, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p>
          <Link href="/">{t('legal.backHome')}</Link>
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}

function OperatorFacts() {
  const { t } = useI18n();
  return (
    <section className="legal-facts">
      <p>
        <strong>{OPERATOR_FACTS.operatorName}</strong>
        {' · ЕИК '}
        {OPERATOR_FACTS.eik}
      </p>
      <p>
        {t('legal.managerLabel')}: {OPERATOR_FACTS.manager}
      </p>
      <p>
        {t('legal.addressLabel')}: {OPERATOR_FACTS.registeredAddress}
      </p>
      <p className="legal-note">{t('legal.addressUnverified')}</p>
      <p>
        {t('legal.certificateLabel')}:{' '}
        {t('legal.certificateValue', {
          number: OPERATOR_FACTS.certificateNumber,
          issued: OPERATOR_FACTS.certificateIssuedOn,
          until: OPERATOR_FACTS.certificateValidUntil,
        })}
      </p>
      <h2>{t('legal.registriesTitle')}</h2>
      <ul>
        {OPERATOR_FACTS.registries.map((item) => (
          <li key={item.id}>
            <a href={item.href} rel="noreferrer">
              {item.id === 'commercial' ? t('legal.registryCommercial') : t('legal.registryMrrb')}
            </a>
          </li>
        ))}
      </ul>
      <h2>{t('legal.missingTitle')}</h2>
      <ul>
        <li>{t('legal.missingPhone')}</li>
        <li>{t('legal.missingEmail')}</li>
        <li>{t('legal.missingActivity')}</li>
        <li>{t('legal.missingVat')}</li>
      </ul>
    </section>
  );
}

function CookieFacts() {
  const { t } = useI18n();
  return (
    <section className="legal-facts">
      <p>{t('legal.cookieIntro')}</p>
      <p>{t('legal.cookieNoneOptional')}</p>
      <p>{t('legal.cookieReject')}</p>
      {!COOKIE_BANNER_REQUIRED ? null : <p>{t('legal.cookieNoneOptional')}</p>}
      <h2>{t('legal.cookieNecessary')}</h2>
      <ul>
        {CLIENT_STORAGE_INVENTORY.filter((item) => item.class === 'strictly_necessary').map((item) => (
          <li key={item.name}>
            <code>{item.name}</code> ({item.where}) — {t(item.purposeKey)}
          </li>
        ))}
      </ul>
      <h2>{t('legal.cookieFunctional')}</h2>
      <ul>
        {CLIENT_STORAGE_INVENTORY.filter((item) => item.class === 'functional').map((item) => (
          <li key={item.name}>
            <code>{item.name}</code> ({item.where}) — {t(item.purposeKey)}
          </li>
        ))}
      </ul>
    </section>
  );
}
