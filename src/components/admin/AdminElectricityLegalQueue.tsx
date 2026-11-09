'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { canSubmitElectricityStaff } from '@/lib/electricity';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { formatEur, formatKwh } from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { adminCardClass, adminFieldClass } from '@/components/admin/AdminUi';

type PendingReading = Database['public']['Functions']['admin_list_pending_electricity_readings']['Returns'][number];

function blockText(
  reason: string | null,
  t: (key: string) => string,
) {
  if (reason === 'mixed') return t('admin.elMixedBlock');
  if (reason === 'unknown') return t('admin.elUnknownBlock');
  if (reason === 'not_legal') return t('admin.elNotLegalBlock');
  return null;
}

function parseRate(raw: string) {
  const value = Number(raw.replace(',', '.').trim());
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function AdminElectricityLegalQueue({
  supabase,
  staffRole,
  staffActive,
  showFilter,
  filterOn,
  onFilterChange,
  onPendingIds,
  onChanged,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
  staffActive: boolean;
  showFilter?: boolean;
  filterOn?: boolean;
  onFilterChange?: (on: boolean) => void;
  onPendingIds?: (ids: number[]) => void;
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const canConfirm = canSubmitElectricityStaff(staffRole, staffActive);
  const [rows, setRows] = useState<PendingReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onPendingIdsRef = useRef(onPendingIds);
  onPendingIdsRef.current = onPendingIds;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcErr } = await supabase.rpc('admin_list_pending_electricity_readings');
    setLoading(false);
    if (rpcErr) {
      setError(toUserFacingMessage(rpcErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setRows([]);
      onPendingIdsRef.current?.([]);
      return;
    }
    const list = data ?? [];
    setRows(list);
    setError(null);
    onPendingIdsRef.current?.(list.map((row) => row.day_reading_id));
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.elPendingCalc')}
          {rows.length > 0 ? ` · ${rows.length}` : ''}
        </p>
        {showFilter && onFilterChange ? (
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              filterOn
                ? 'border-accent/25 bg-accent-bg text-accent'
                : 'border-border text-secondary hover:bg-hover'
            }`}
            onClick={() => onFilterChange(!filterOn)}
          >
            {t('admin.elPendingFilter')}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-accent">{notice}</p> : null}
      {loading ? <p className="text-sm text-muted">{t('common.loading')}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-sm text-secondary">{t('admin.elPendingEmpty')}</p>
      ) : null}
      {rows.map((row) => (
        <LegalChargeCard
          key={`${row.day_reading_id}-${row.night_reading_id}`}
          supabase={supabase}
          row={row}
          canConfirm={canConfirm}
          locale={locale}
          onDone={async (message) => {
            setNotice(message);
            await load();
            onChanged?.();
          }}
          onError={setError}
        />
      ))}
    </div>
  );
}

function LegalChargeCard({
  supabase,
  row,
  canConfirm,
  locale,
  onDone,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  row: PendingReading;
  canConfirm: boolean;
  locale: string;
  onDone: (message: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [dayRate, setDayRate] = useState('');
  const [nightRate, setNightRate] = useState('');
  const [quote, setQuote] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const blocked = blockText(row.block_reason, t);
  const dateLocale = locale === 'bg' ? 'bg-BG' : locale === 'en' ? 'en-GB' : 'ru-RU';

  async function refreshQuote(nextDay: string, nextNight: string) {
    setQuote(null);
    if (blocked || !canConfirm) return;
    const day = parseRate(nextDay);
    const night = parseRate(nextNight);
    if (day == null || night == null) return;
    const { data, error } = await supabase.rpc('quote_electricity_legal_charge', {
      p_day_reading_id: row.day_reading_id,
      p_night_reading_id: row.night_reading_id,
      p_day_rate: day,
      p_night_rate: night,
    });
    if (error) {
      onError(toUserFacingMessage(error, t, { fallback: t('admin.errGeneric') }));
      return;
    }
    const total = data?.[0]?.total_amount_eur;
    setQuote(total == null ? null : Number(total));
  }

  async function confirm() {
    if (!canConfirm || blocked) return;
    const day = parseRate(dayRate);
    const night = parseRate(nightRate);
    if (day == null || night == null) {
      onError(t('admin.elRateInvalid'));
      return;
    }
    setBusy(true);
    onError(null);
    const { data, error } = await supabase.rpc('confirm_electricity_legal_charge', {
      p_day_reading_id: row.day_reading_id,
      p_night_reading_id: row.night_reading_id,
      p_day_rate: day,
      p_night_rate: night,
      p_idempotency_key: key,
    });
    setBusy(false);
    if (error) {
      onError(toUserFacingMessage(error, t, { context: 'finance', fallback: t('common.errFinance') }));
      return;
    }
    const total = data?.[0]?.total_amount_eur;
    const amount = total == null ? '' : ` ${formatEur(Number(total), locale)}`;
    await onDone(`${t('admin.elConfirmOk')}${amount}`);
  }

  return (
    <div className={`${adminCardClass} space-y-3 p-4 md:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {t('admin.pickProperty')} {row.apartment_number}
          {row.meter_number ? ` · ${t('account.elMeter')} ${row.meter_number}` : ''}
        </p>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-secondary">
          {t('admin.elPendingCalc')}
        </span>
      </div>
      <dl className="grid gap-2 text-sm text-secondary sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{t('account.elDay')}</dt>
          <dd>
            {formatKwh(Number(row.previous_day), locale)} → {formatKwh(Number(row.current_day), locale)} {t('account.kwh')}
            {' · '}
            {row.previous_day_date ? formatOwnerDate(row.previous_day_date, dateLocale) : '—'}
            {' → '}
            {formatOwnerDate(row.reading_date, dateLocale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('account.elNight')}</dt>
          <dd>
            {formatKwh(Number(row.previous_night), locale)} → {formatKwh(Number(row.current_night), locale)} {t('account.kwh')}
            {' · '}
            {row.previous_night_date ? formatOwnerDate(row.previous_night_date, dateLocale) : '—'}
            {' → '}
            {formatOwnerDate(row.reading_date, dateLocale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('account.elConsDay')}</dt>
          <dd>{formatKwh(Number(row.consumption_day), locale)} {t('account.kwh')}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('account.elConsNight')}</dt>
          <dd>{formatKwh(Number(row.consumption_night), locale)} {t('account.kwh')}</dd>
        </div>
      </dl>
      {blocked ? <p className="text-sm text-danger">{blocked}</p> : null}
      {!canConfirm ? <p className="text-sm text-secondary">{t('admin.elConfirmStaffOnly')}</p> : null}
      {canConfirm && !blocked ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-secondary">
            {t('admin.elLegalDayRate')}
            <input
              className={`mt-1 ${adminFieldClass}`}
              type="number"
              min="0"
              step="0.0001"
              value={dayRate}
              onChange={(event) => {
                setDayRate(event.target.value);
                void refreshQuote(event.target.value, nightRate);
              }}
              required
            />
          </label>
          <label className="block text-sm text-secondary">
            {t('admin.elLegalNightRate')}
            <input
              className={`mt-1 ${adminFieldClass}`}
              type="number"
              min="0"
              step="0.0001"
              value={nightRate}
              onChange={(event) => {
                setNightRate(event.target.value);
                void refreshQuote(dayRate, event.target.value);
              }}
              required
            />
          </label>
        </div>
      ) : null}
      <p className="text-sm text-foreground">
        {t('admin.elPreliminaryTotal')}: {quote == null ? '—' : formatEur(quote, locale)}
      </p>
      {canConfirm ? (
        <button
          type="button"
          disabled={busy || !!blocked || quote == null}
          onClick={() => void confirm()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('common.saving') : t('admin.elConfirmCharge')}
        </button>
      ) : null}
    </div>
  );
}
