'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  currentElectricityTariff,
  formatElectricityTariff,
  type ElectricityCharge,
  type ElectricityLedger,
  type ElectricityTariff,
} from '@/lib/electricity';
import {
  balanceTone,
  canManageElectricityTariff,
  canSeeElectricityFinance,
  emptyBalance,
  formatEur,
  formatKwh,
  mapAdminRpcError,
  todayIsoDate,
  type UtilityBalance,
} from '@/lib/utilities';
import {
  AdminPageHeader,
  AdminMetricCard,
  AdminEmptyState,
  AdminInlineAlert,
  adminCardClass,
  adminFieldClass,
  type AdminUtilityTab,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function AdminElectricityFinance({
  supabase,
  properties,
  staffRole,
  embedded = false,
  panel,
  focusPropertyId,
  onPropertyChange,
  onOpenTab,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  embedded?: boolean;
  panel?: 'overview' | 'tariff' | 'finance';
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  onOpenTab?: (tab: AdminUtilityTab) => void;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeElectricityFinance(staffRole);
  const canTariff = canManageElectricityTariff(staffRole);
  const canFinance = canSee;

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>(sorted[0]?.id ?? '');

  useEffect(() => {
    if (focusPropertyId == null || focusPropertyId === '') return;
    setPropertyId((current) => (current === focusPropertyId ? current : focusPropertyId));
  }, [focusPropertyId]);
  const [tariffs, setTariffs] = useState<ElectricityTariff[]>([]);
  const [charges, setCharges] = useState<ElectricityCharge[]>([]);
  const [ledger, setLedger] = useState<ElectricityLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [listLoading, setListLoading] = useState(false);
  const [propLoading, setPropLoading] = useState(false);
  const [tariffBusy, setTariffBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dayPrice, setDayPrice] = useState('');
  const [nightPrice, setNightPrice] = useState('');
  const [tariffFrom, setTariffFrom] = useState(todayIsoDate());
  const [tariffNote, setTariffNote] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const payKeyRef = useRef(crypto.randomUUID());

  const tariff = useMemo(() => currentElectricityTariff(tariffs), [tariffs]);

  const loadTariffs = useCallback(async () => {
    setListLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('electricity_tariffs')
        .select('*')
        .order('valid_from', { ascending: false });
      if (qErr) {
        if (!isMissingRelation(qErr, 'electricity_tariffs')) throw qErr;
        setTariffs([]);
        return;
      }
      setTariffs((data as ElectricityTariff[] | null) ?? []);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setTariffs([]);
    } finally {
      setListLoading(false);
    }
  }, [supabase]);

  const loadProperty = useCallback(async () => {
    if (propertyId === '') {
      setCharges([]);
      setLedger([]);
      setBalance(emptyBalance());
      return;
    }
    setPropLoading(true);
    try {
      const [chargeRes, ledgerRes, balRes] = await Promise.all([
        supabase
          .from('electricity_charges')
          .select('*')
          .eq('property_id', propertyId)
          .order('reading_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('electricity_ledger')
          .select('*')
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase.rpc('get_electricity_balance', { p_property_id: Number(propertyId) }),
      ]);
      if (chargeRes.error && !isMissingRelation(chargeRes.error, 'electricity_charges')) throw chargeRes.error;
      setCharges((chargeRes.data as ElectricityCharge[] | null) ?? []);
      if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'electricity_ledger')) throw ledgerRes.error;
      setLedger((ledgerRes.data as ElectricityLedger[] | null) ?? []);
      if (balRes.error && !isMissingRelation(balRes.error, 'get_electricity_balance')) throw balRes.error;
      const row = firstRow(balRes.data as UtilityBalance[] | null);
      setBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setCharges([]);
      setLedger([]);
      setBalance(emptyBalance());
    } finally {
      setPropLoading(false);
    }
  }, [propertyId, supabase]);

  useEffect(() => {
    void loadTariffs();
  }, [loadTariffs]);

  useEffect(() => {
    void loadProperty();
  }, [loadProperty]);

  function flash(message: string) {
    setSuccess(message);
    setError(null);
  }

  function rpcFail(message: string | undefined) {
    setSuccess(null);
    setError(t(mapAdminRpcError(message ?? '')));
  }

  async function handleTariff(e: React.FormEvent) {
    e.preventDefault();
    if (!canTariff) return;
    const day = Number(dayPrice);
    const night = Number(nightPrice);
    if (!(day >= 0) || !(night >= 0) || Number.isNaN(day) || Number.isNaN(night)) {
      setError(t('admin.errTariffPrice'));
      return;
    }
    setTariffBusy(true);
    const { error: rpcErr } = await supabase.rpc('set_electricity_tariff', {
      p_day_price_eur_per_kwh: day,
      p_night_price_eur_per_kwh: night,
      p_valid_from: tariffFrom,
      p_note: tariffNote.trim() || null,
    });
    setTariffBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    setDayPrice('');
    setNightPrice('');
    setTariffNote('');
    flash(t('admin.okTariff'));
    await loadTariffs();
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canFinance) return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    const { error: rpcErr } = await supabase.rpc('record_electricity_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: payKeyRef.current,
    });
    setPayBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    flash(t('admin.okElectricityPay'));
    await loadProperty();
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
      </div>
    );
  }

  const tone = balanceTone(balance.balance_eur);
  const statusLabel =
    tone === 'debt' ? t('admin.balDebt') : tone === 'over' ? t('admin.balOver') : t('admin.balSettled');
  const showTariff = !panel || panel === 'tariff';
  const showFinance = !panel || panel === 'finance';

  if (panel === 'overview') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <AdminMetricCard
          label={t('admin.utilTabTariff')}
          value={
            listLoading
              ? t('common.loading')
              : tariff
                ? formatElectricityTariff(Number(tariff.day_price_eur_per_kwh), locale)
                : '—'
          }
          secondary={
            tariff
              ? `${t('account.elNight')} ${formatElectricityTariff(Number(tariff.night_price_eur_per_kwh), locale)}`
              : t('admin.noTariff')
          }
          onClick={() => onOpenTab?.('tariff')}
        />
        <AdminMetricCard
          label={t('admin.electricityBalance')}
          value={propLoading ? t('common.loading') : formatEur(Math.abs(balance.balance_eur), locale)}
          secondary={statusLabel}
          alert={tone === 'debt'}
          onClick={() => onOpenTab?.('finance')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && <AdminPageHeader title={t('admin.electricityFinance')} secondary={t('admin.electricityLead')} />}
      {showFinance && !embedded && <div className={cardClass}>
        <label className="block text-xs text-muted">{t('admin.pickProperty')}</label>
        <ApartmentCombobox
          className="mt-1 max-w-xl"
          properties={sorted}
          value={propertyId}
          onChange={(id) => {
            setPropertyId(id);
            onPropertyChange?.(id);
            setSuccess(null);
            setError(null);
          }}
        />
      </div>}

      {error && (
        <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm text-success">{success}</div>
      )}

      {showTariff && canTariff && (
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.electricityTariff')}</p>
          {listLoading ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : tariff ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="text-2xl font-semibold text-foreground">{formatElectricityTariff(Number(tariff.day_price_eur_per_kwh), locale)}</p>
              <p className="text-2xl font-semibold text-foreground">{formatElectricityTariff(Number(tariff.night_price_eur_per_kwh), locale)}</p>
              <p className="text-xs text-muted">{t('account.elDay')}</p>
              <p className="text-xs text-muted">{t('account.elNight')}</p>
            </div>
          ) : (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.noTariff')} />
            </div>
          )}
          {tariff && (
            <p className="mt-1 text-sm text-muted">
              {t('admin.validFrom')}: {formatOwnerDate(tariff.valid_from)}
            </p>
          )}
          <form onSubmit={handleTariff} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input className={fieldClass} type="number" min="0" step="0.01" placeholder={t('admin.elDayPrice')} value={dayPrice} onChange={(e) => setDayPrice(e.target.value)} required />
            <input className={fieldClass} type="number" min="0" step="0.01" placeholder={t('admin.elNightPrice')} value={nightPrice} onChange={(e) => setNightPrice(e.target.value)} required />
            <input className={fieldClass} type="date" value={tariffFrom} onChange={(e) => setTariffFrom(e.target.value)} required />
            <input className={fieldClass} placeholder={t('admin.noteOptional')} value={tariffNote} onChange={(e) => setTariffNote(e.target.value)} />
            <button type="submit" disabled={tariffBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-fit">
              {tariffBusy ? t('common.saving') : t('admin.setTariff')}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted">{t('admin.tariffImmutable')}</p>
          {tariffs.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.noTariffHistory')} />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3">{t('admin.validFrom')}</th>
                    <th className="py-2 pr-3">{t('account.elDay')}</th>
                    <th className="py-2 pr-3">{t('account.elNight')}</th>
                    <th className="py-2 pr-3">{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.valid_from)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatElectricityTariff(Number(row.day_price_eur_per_kwh), locale)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatElectricityTariff(Number(row.night_price_eur_per_kwh), locale)}</td>
                      <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showFinance && canFinance && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cardClass}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.electricityBalance')}</p>
            {propLoading ? (
              <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <>
                <p className={`mt-2 text-2xl font-semibold ${tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-foreground'}`}>
                  {formatEur(Math.abs(balance.balance_eur), locale)}
                </p>
                <p className="text-sm text-secondary">{statusLabel}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">{t('admin.charged')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.charged_eur, locale)}</dd>
                  <dt className="text-muted">{t('admin.paid')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.paid_eur, locale)}</dd>
                  <dt className="text-muted">{t('admin.adjDebit')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.adjustments_debit_eur, locale)}</dd>
                  <dt className="text-muted">{t('admin.adjCredit')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.adjustments_credit_eur, locale)}</dd>
                </dl>
              </>
            )}
          </div>
          <div className={cardClass}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.recordPayment')}</p>
            <form onSubmit={handlePay} className="mt-4 space-y-3">
              <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.amountEur')} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
              <input className={fieldClass} placeholder={t('admin.noteOptional')} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              <button type="submit" disabled={payBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {payBusy ? t('common.saving') : t('admin.recordPayment')}
              </button>
            </form>
          </div>
        </div>
      )}

      {showFinance && (
      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.elChargeHistory')}</p>
        {charges.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('account.utilNoReadings')} />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3">{t('account.utilColDate')}</th>
                  <th className="py-2 pr-3">{t('account.elConsDay')}</th>
                  <th className="py-2 pr-3">{t('account.elConsNight')}</th>
                  <th className="py-2 pr-3">{t('account.elTariffDay')}</th>
                  <th className="py-2 pr-3">{t('account.elTariffNight')}</th>
                  <th className="py-2 pr-3">{t('account.utilCharged')}</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.reading_date)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatKwh(Number(row.consumption_day), locale)} {t('account.kwh')}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatKwh(Number(row.consumption_night), locale)} {t('account.kwh')}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatElectricityTariff(Number(row.day_tariff_eur_per_kwh), locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatElectricityTariff(Number(row.night_tariff_eur_per_kwh), locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.total_amount_eur), locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {showFinance && canFinance && (
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.elOpsHistory')}</p>
          {ledger.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('account.utilNoElLedger')} />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3">{t('admin.date')}</th>
                    <th className="py-2 pr-3">{t('admin.kind')}</th>
                    <th className="py-2 pr-3">{t('admin.amount')}</th>
                    <th className="py-2 pr-3">{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.created_at)}</td>
                      <td className="py-2 pr-3">{labelLedgerKind(row.kind, t)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.amount_eur), locale)}</td>
                      <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
