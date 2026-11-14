'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useI18n } from '@/i18n/I18nProvider';
import { loadMyAcknowledgements, type AcknowledgementItem } from '@/lib/portalLegal/acceptance';
import { portalLegalSlug } from '@/lib/portalLegal/kinds';

const ACTION_KEY = {
  accept_terms: 'legal.actionAccept',
  ack_privacy: 'legal.actionPrivacy',
  ack_house_rules: 'legal.actionRules',
} as const;

export function OwnerLegalAcknowledgements({ supabase }: { supabase: SupabaseClient }) {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<AcknowledgementItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMyAcknowledgements(supabase).then((items) => {
      if (!cancelled) setRows(items ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('legal.cabinetSection')}</h2>
      <div>
        <h3 className="text-sm font-semibold">{t('legal.cabinetCurrent')}</h3>
        <p className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link href="/legal/terms">{t('legal.linkTerms')}</Link>
          <Link href="/legal/privacy">{t('legal.linkPrivacy')}</Link>
          <Link href="/legal/house-rules">{t('legal.linkRules')}</Link>
        </p>
      </div>
      <div>
        <h3 className="text-sm font-semibold">{t('legal.cabinetHistory')}</h3>
        {rows == null ? <p className="text-sm">{t('common.loading')}</p> : null}
        {rows?.length === 0 ? <p className="text-sm text-secondary">{t('legal.cabinetEmpty')}</p> : null}
        <ul className="mt-2 space-y-3">
          {(rows ?? []).map((row) => {
            const slug = portalLegalSlug(row.document_kind) ?? 'terms';
            const when = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
              dateStyle: 'long',
              timeStyle: 'short',
            }).format(new Date(row.confirmed_at));
            return (
              <li key={row.acknowledgement_id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <div className="font-medium">{row.title}</div>
                <div>
                  {t(ACTION_KEY[row.action])}
                  {' · '}
                  {t('legal.revision', { number: row.revision_number })}
                  {' · '}
                  {row.document_locale.toUpperCase()}
                  {' · '}
                  {when}
                </div>
                <div className="mt-1 flex gap-3">
                  <Link href={`/legal/${slug}/${row.revision_id}`}>{t('legal.openText')}</Link>
                  <a href={`/api/account/legal-snapshot/${row.acknowledgement_id}`}>{t('legal.linkDownload')}</a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
