'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { formatKwh, formatM3 } from '@/lib/utilities';
import {
  filterHistoryByPeriod,
  sortHistoryNewestFirst,
  type MeterReadingHistoryEntry,
} from '@/lib/meterReadingHistory';
import {
  AdminEmptyState,
  AdminTableShell,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { SignedStorageImage, SignedStorageLink } from '@/components/SignedStorageMedia';
import { StatusBadge } from '@/components/account/ownerUi';

function statusLabel(
  status: MeterReadingHistoryEntry['status'],
  t: (k: string) => string,
): string {
  if (status === 'opening') return t('admin.meterHistStatusOpening');
  if (status === 'pending_review') return t('admin.meterHistStatusPending');
  if (status === 'accepted') return t('admin.meterHistStatusAccepted');
  if (status === 'rejected') return t('admin.meterHistStatusRejected');
  return t('admin.valueUnknown');
}

function statusTone(
  status: MeterReadingHistoryEntry['status'],
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'opening') return 'info';
  if (status === 'pending_review') return 'warning';
  if (status === 'accepted') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function sourceLabel(
  source: MeterReadingHistoryEntry['source'],
  t: (k: string) => string,
): string {
  if (source === 'owner') return t('admin.meterHistSourceOwner');
  if (source === 'staff') return t('admin.meterHistSourceStaff');
  if (source === 'system') return t('admin.meterHistSourceInitial');
  return '—';
}

function formatConsumption(
  value: number | null,
  utility: MeterReadingHistoryEntry['utility'],
  locale: string,
  unit: string,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = utility === 'water' ? formatM3(value, locale) : formatKwh(value, locale);
  return `${n} ${unit}`;
}

function formatReadingValue(
  value: number | null,
  utility: MeterReadingHistoryEntry['utility'],
  locale: string,
  unit: string,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = utility === 'water' ? formatM3(value, locale) : formatKwh(value, locale);
  return `${n} ${unit}`;
}

export function MeterReadingHistory({
  entries,
  utility,
  title,
  emptyTitle,
  rowActions,
  compact,
  periodFrom,
  periodTo,
  /** Parent owns filters/title (e.g. apartment history shell). */
  embedded = false,
  /** Use admin table shell/tokens (admin history popup). */
  adminTable = false,
}: {
  entries: MeterReadingHistoryEntry[];
  utility: 'water' | 'electricity';
  title?: string;
  emptyTitle?: string;
  rowActions?: (entry: MeterReadingHistoryEntry) => ReactNode;
  /** Denser layout for owner cards. */
  compact?: boolean;
  /** Optional seed / controlled period from a parent register. */
  periodFrom?: string;
  periodTo?: string;
  embedded?: boolean;
  adminTable?: boolean;
}) {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(periodFrom ?? '');
  const [to, setTo] = useState(periodTo ?? '');
  const unit = utility === 'water' ? t('account.m3') : t('account.kwh');

  useEffect(() => {
    if (periodFrom !== undefined) setFrom(periodFrom);
  }, [periodFrom]);
  useEffect(() => {
    if (periodTo !== undefined) setTo(periodTo);
  }, [periodTo]);

  const visible = useMemo(
    () => sortHistoryNewestFirst(filterHistoryByPeriod(entries, from, to)),
    [entries, from, to],
  );

  const thClass = adminTable
    ? adminTableCellClass
    : 'py-2 pr-3 font-medium';
  const tdClass = adminTable ? adminTableCellClass : 'py-2 pr-3';
  const headRowClass = adminTable
    ? adminTableHeadRowClass
    : 'text-left text-xs text-muted';
  const bodyRowClass = (rejected: boolean) =>
    adminTable
      ? `${adminTableRowClass} ${rejected ? 'text-muted' : ''}`
      : `border-t border-border ${rejected ? 'text-muted' : ''}`;

  const table = (
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={headRowClass}>
                  <th className={thClass}>{t('admin.date')}</th>
                  <th className={thClass}>
                    {t(utility === 'electricity' ? 'account.elMeterNumber' : 'admin.meterNumber')}
                  </th>
                  {utility === 'water' ? (
                    <>
                      <th className={thClass}>{t('admin.meterHistReading')}</th>
                      <th className={thClass}>{t('admin.meterHistConsumption')}</th>
                    </>
                  ) : (
                    <>
                      <th className={thClass}>{t('account.elDayShort')}</th>
                      <th className={thClass}>{t('account.elNightShort')}</th>
                      <th className={thClass}>{t('account.elUseDay')}</th>
                      <th className={thClass}>{t('account.elUseNight')}</th>
                    </>
                  )}
                  <th className={thClass}>{t('admin.meterHistSource')}</th>
                  <th className={thClass}>{t('admin.status')}</th>
                  <th className={thClass}>{t('admin.meterHistPhoto')}</th>
                  <th className={thClass}>{t('admin.meterHistReason')}</th>
                  {rowActions ? <th className={thClass} /> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr
                    key={entry.id}
                    className={bodyRowClass(entry.status === 'rejected')}
                  >
                    <td className={`${tdClass} tabular-nums whitespace-nowrap`}>
                      {entry.readingDate ? formatOwnerDate(entry.readingDate, locale) : '—'}
                    </td>
                    <td className={`${tdClass} tabular-nums`}>{entry.meterNumber ?? '—'}</td>
                    {utility === 'water' ? (
                      <>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatReadingValue(entry.valuePrimary, utility, locale, unit)}
                        </td>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatConsumption(entry.consumptionPrimary, utility, locale, unit)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatReadingValue(entry.valuePrimary, utility, locale, unit)}
                        </td>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatReadingValue(entry.valueSecondary, utility, locale, unit)}
                        </td>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatConsumption(entry.consumptionPrimary, utility, locale, unit)}
                        </td>
                        <td className={`${tdClass} tabular-nums`}>
                          {formatConsumption(entry.consumptionSecondary, utility, locale, unit)}
                        </td>
                      </>
                    )}
                    <td className={tdClass}>{sourceLabel(entry.source, t)}</td>
                    <td className={tdClass}>
                      <StatusBadge label={statusLabel(entry.status, t)} tone={statusTone(entry.status)} />
                    </td>
                    <td className={tdClass}>
                      {entry.photoUrl ? (
                        <SignedStorageLink
                          stored={entry.photoUrl}
                          className="text-accent hover:underline"
                        >
                          {t('admin.meterHistOpenPhoto')}
                        </SignedStorageLink>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`${tdClass} max-w-[14rem] text-xs text-secondary break-words`}>
                      {entry.reason ?? '—'}
                    </td>
                    {rowActions ? <td className={tdClass}>{rowActions(entry)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
  );

  return (
    <div className="space-y-3">
      {!embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {title ?? t('account.utilHistory')}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-0.5 text-xs text-secondary">
              <span>{t('admin.meterHistPeriodFrom')}</span>
              <input
                type="date"
                className={`${adminFieldClass} min-h-9 max-w-[11rem] py-1.5`}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="grid gap-0.5 text-xs text-secondary">
              <span>{t('admin.meterHistPeriodTo')}</span>
              <input
                type="date"
                className={`${adminFieldClass} min-h-9 max-w-[11rem] py-1.5`}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            {from || to ? (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                {t('admin.meterHistPeriodClear')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <AdminEmptyState title={emptyTitle ?? t('admin.noReadings')} />
      ) : (
        <>
          {/* Mobile cards */}
          <ul className={`space-y-2 md:hidden ${compact ? '' : ''}`}>
            {visible.map((entry) => (
              <li
                key={entry.id}
                className={`rounded-xl border border-border bg-background px-3 py-2.5 ${
                  entry.status === 'rejected' ? 'opacity-80' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {entry.readingDate ? formatOwnerDate(entry.readingDate, locale) : '—'}
                  </p>
                  <StatusBadge label={statusLabel(entry.status, t)} tone={statusTone(entry.status)} />
                </div>
                <dl className="mt-2 grid gap-1 text-xs text-secondary">
                  {utility === 'water' ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt>{t('admin.meterHistReading')}</dt>
                        <dd className="font-medium text-foreground tabular-nums">
                          {formatReadingValue(entry.valuePrimary, utility, locale, unit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('admin.meterHistConsumption')}</dt>
                        <dd className="tabular-nums">
                          {formatConsumption(entry.consumptionPrimary, utility, locale, unit)}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt>{t('account.elDayShort')}</dt>
                        <dd className="font-medium text-foreground tabular-nums">
                          {formatReadingValue(entry.valuePrimary, utility, locale, unit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('account.elNightShort')}</dt>
                        <dd className="font-medium text-foreground tabular-nums">
                          {formatReadingValue(entry.valueSecondary, utility, locale, unit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('account.elUseDay')}</dt>
                        <dd className="tabular-nums">
                          {formatConsumption(entry.consumptionPrimary, utility, locale, unit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t('account.elUseNight')}</dt>
                        <dd className="tabular-nums">
                          {formatConsumption(entry.consumptionSecondary, utility, locale, unit)}
                        </dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt>{t('admin.meterHistSource')}</dt>
                    <dd>{sourceLabel(entry.source, t)}</dd>
                  </div>
                  {entry.meterNumber ? (
                    <div className="flex justify-between gap-2">
                      <dt>{t(utility === 'electricity' ? 'account.elMeterNumber' : 'admin.meterNumber')}</dt>
                      <dd className="tabular-nums">{entry.meterNumber}</dd>
                    </div>
                  ) : null}
                  {entry.reason ? (
                    <div className="pt-1 text-xs text-danger">
                      {t('admin.meterHistReason')}: {entry.reason}
                    </div>
                  ) : null}
                  {entry.photoUrl ? (
                    <div className="pt-1">
                      <SignedStorageLink
                        stored={entry.photoUrl}
                        className="text-accent hover:underline"
                      >
                        {t('admin.meterHistOpenPhoto')}
                      </SignedStorageLink>
                      <div className="mt-1 max-w-[12rem]">
                        <SignedStorageImage
                          stored={entry.photoUrl}
                          alt={t('admin.meterHistPhoto')}
                          className="max-h-28 w-full rounded-lg object-cover"
                        />
                      </div>
                    </div>
                  ) : null}
                  {rowActions ? <div className="pt-1">{rowActions(entry)}</div> : null}
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden md:block">
            {adminTable ? <AdminTableShell>{table}</AdminTableShell> : (
              <div className="overflow-x-auto">{table}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
