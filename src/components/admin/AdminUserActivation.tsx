'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminMetricCard,
  AdminPageHeader,
  AdminSecondaryButton,
  AdminTableShell,
  StatusBadge,
  adminCardClass,
  adminFieldClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import {
  USER_ACTIVATION_ONLINE_MINUTES,
  activationStateTone,
  canSeeUserActivationAdmin,
  createUserActivationReminder,
  fetchUserActivationDashboard,
  fetchUserActivationList,
  type UserActivationDashboard,
  type UserActivationFilter,
  type UserActivationPropertyRef,
  type UserActivationRow,
} from '@/lib/userActivation';

const FILTERS: UserActivationFilter[] = [
  'all',
  'not_invited',
  'invited',
  'registered',
  'never_logged_in',
  'first_login',
  'active',
  'dormant',
  'needs_attention',
];

/** Shared header/body cell: same padding, left-aligned, top-aligned for multi-line rows. */
const CELL = 'overflow-hidden px-3 py-2.5 text-left align-top';

/** Compact date/time; omit year when it matches the current year. */
function formatCompactDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function apartmentLabel(p: UserActivationPropertyRef): string {
  return p.apartment_number?.trim() || String(p.property_id);
}

/** Natural ascending sort for apartment labels (2, 10, 11 — not 10, 11, 2). */
function sortApartmentLabels(labels: string[]): string[] {
  return [...labels].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

function formatCompactApartments(
  properties: UserActivationPropertyRef[],
  maxVisible = 3,
): { label: string; title: string } {
  if (!properties.length) return { label: '—', title: '' };
  const labels = sortApartmentLabels(properties.map(apartmentLabel));
  const title = labels.join(', ');
  if (labels.length <= maxVisible) return { label: title, title };
  const shown = labels.slice(0, maxVisible).join(', ');
  return { label: `${shown} +${labels.length - maxVisible}`, title };
}

function CompactMetric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-surface-secondary/40 px-3 py-2">
      <p className="truncate text-[11px] leading-tight text-muted">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums leading-none ${
          alert ? 'text-danger' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function AdminUserActivation({
  supabase,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
}) {
  const { t } = useI18n();
  const canSee = canSeeUserActivationAdmin(staffRole);

  const [dashboard, setDashboard] = useState<UserActivationDashboard | null>(null);
  const [rows, setRows] = useState<UserActivationRow[]>([]);
  const [filter, setFilter] = useState<UserActivationFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  const stateLabel = useCallback(
    (state: string) => {
      const key = `admin.uaState_${state}` as const;
      const v = t(key);
      return v === key ? state : v;
    },
    [t],
  );

  const filterLabel = useCallback(
    (f: UserActivationFilter) => {
      const key = `admin.uaFilter_${f}` as const;
      const v = t(key);
      return v === key ? f : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [dash, list] = await Promise.all([
        fetchUserActivationDashboard(supabase),
        fetchUserActivationList(supabase, filter, search),
      ]);
      setDashboard(dash);
      setRows(list);
      setMigrationNeeded(false);
    } catch (e) {
      const err = e as { message?: string };
      if (
        isMissingRelation(err, 'user_activation') ||
        isMissingRelation(err, 'admin_user_activation_dashboard')
      ) {
        setMigrationNeeded(true);
        setError(t('admin.uaMigrationNeeded'));
      } else {
        setError(ownerVisibleError(e, t('admin.errGeneric')));
      }
    } finally {
      setLoading(false);
    }
  }, [canSee, filter, search, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remind(row: UserActivationRow, resendInvite: boolean) {
    setBusyEmail(row.email);
    setError(null);
    setSuccess(null);
    try {
      const result = await createUserActivationReminder(supabase, {
        ownerEmail: row.email,
        reminderType: resendInvite ? 'invite_resend' : 'activation_nudge',
        propertyId: row.properties[0]?.property_id ?? null,
        resendInvite,
      });
      if (result.invite_token) {
        const link = `${window.location.origin}/auth/invite?token=${result.invite_token}`;
        try {
          await navigator.clipboard.writeText(link);
          setSuccess(
            t('admin.uaReminderInviteCopied', { status: result.delivery_status }),
          );
        } catch {
          setSuccess(`${t('admin.uaReminderCreated', { status: result.delivery_status })} ${link}`);
        }
      } else {
        setSuccess(t('admin.uaReminderCreated', { status: result.delivery_status }));
      }
      await load();
    } catch (e) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusyEmail(null);
    }
  }

  if (!canSee) {
    return (
      <AdminEmptyState title={t('admin.uaTitle')} text={t('admin.uaAccessDenied')} />
    );
  }

  const onlineHint = t('admin.uaOnlineHint', {
    minutes: String(USER_ACTIVATION_ONLINE_MINUTES),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <AdminPageHeader title={t('admin.uaTitle')} secondary={t('admin.uaLead')} />
        <p
          className="max-w-3xl text-[11px] leading-snug text-muted"
          title={onlineHint}
        >
          {onlineHint}
        </p>
      </div>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? (
        <AdminInlineAlert tone="success" onDismiss={() => setSuccess(null)}>
          {success}
        </AdminInlineAlert>
      ) : null}
      {migrationNeeded ? (
        <AdminInlineAlert tone="warning">{t('admin.uaMigrationNeeded')}</AdminInlineAlert>
      ) : null}

      {dashboard ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard
              label={t('admin.uaMetricTotal')}
              value={String(dashboard.total_owners)}
            />
            <AdminMetricCard
              label={t('admin.uaMetricRegistered')}
              value={String(dashboard.registered)}
            />
            <AdminMetricCard
              label={t('admin.uaMetricActive30')}
              value={String(dashboard.active_last_30_days)}
            />
            <AdminMetricCard
              label={t('admin.uaMetricActivationPct')}
              value={`${dashboard.activation_percent}%`}
              secondary={t('admin.uaMetricActiveApartments', {
                n: String(dashboard.properties_with_active_owner),
                total: String(dashboard.properties_total),
              })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <CompactMetric
              label={t('admin.uaMetricInvited')}
              value={String(dashboard.invited)}
            />
            <CompactMetric
              label={t('admin.uaMetricFirstLogin')}
              value={String(dashboard.first_login_completed)}
            />
            <CompactMetric
              label={t('admin.uaMetricNeverLogin')}
              value={String(dashboard.never_logged_in)}
              alert={dashboard.never_logged_in > 0}
            />
            <CompactMetric
              label={t('admin.uaFilter_dormant')}
              value={String(dashboard.dormant)}
              alert={dashboard.dormant > 0}
            />
          </div>
        </div>
      ) : null}

      <section className={`${adminCardClass} p-3`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="grid min-w-0 flex-1 gap-1 text-[11px] text-muted sm:max-w-xs">
            <span className="sr-only">{t('admin.uaColState')}</span>
            <select
              className={adminFieldClass}
              value={filter}
              onChange={(e) => setFilter(e.target.value as UserActivationFilter)}
              aria-label={t('admin.uaColState')}
            >
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {filterLabel(f)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 flex-[1.4] gap-1 text-[11px] text-muted">
            <span className="sr-only">{t('admin.uaSearch')}</span>
            <input
              className={adminFieldClass}
              value={search}
              placeholder={t('admin.uaSearchPh')}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('admin.uaSearch')}
            />
          </label>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-muted">{t('admin.loading')}</p>
      ) : rows.length === 0 ? (
        <AdminEmptyState title={t('admin.uaEmpty')} text={t('admin.uaEmptyHint')} />
      ) : (
        <AdminTableShell>
          <table className="w-full table-fixed text-sm max-md:min-w-[640px]">
            <colgroup>
              <col style={{ width: '27%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '17%' }} />
            </colgroup>
            <thead>
              <tr className={adminTableHeadRowClass}>
                <th scope="col" className={CELL}>
                  {t('admin.uaColOwner')}
                </th>
                <th scope="col" className={CELL}>
                  {t('admin.uaColProperties')}
                </th>
                <th scope="col" className={CELL}>
                  {t('admin.uaColState')}
                </th>
                <th scope="col" className={CELL}>
                  {t('admin.uaColAccess')}
                </th>
                <th scope="col" className={CELL}>
                  {t('admin.uaColLastActivity')}
                </th>
                <th scope="col" className={CELL}>
                  {t('admin.uaColReminder')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const apts = formatCompactApartments(row.properties);
                const registeredAt = formatCompactDateTime(row.registered_at);
                const lastLoginAt = formatCompactDateTime(row.last_login_at);
                const activityAt = formatCompactDateTime(row.last_activity_at);
                const reminderAt = formatCompactDateTime(row.last_reminder_at);

                return (
                  <tr key={row.email} className={adminTableRowClass}>
                    <td className={CELL}>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium leading-5 text-foreground">
                            {row.display_name}
                          </span>
                          {row.needs_attention ? (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                              title={t('admin.uaNeedsAttention')}
                              aria-label={t('admin.uaNeedsAttention')}
                            />
                          ) : null}
                        </div>
                        <p
                          className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-4 text-muted"
                          title={row.email}
                        >
                          {row.email}
                        </p>
                      </div>
                    </td>
                    <td className={CELL}>
                      <p
                        className="truncate text-xs leading-5 text-secondary"
                        title={apts.title || undefined}
                      >
                        {apts.label}
                      </p>
                    </td>
                    <td className={CELL}>
                      <div className="flex justify-start">
                        <StatusBadge
                          tone={activationStateTone(row.activation_state)}
                          label={stateLabel(row.activation_state)}
                        />
                      </div>
                    </td>
                    <td className={CELL}>
                      {!row.is_registered ? (
                        <span className="text-xs leading-5 text-muted">—</span>
                      ) : (
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate text-xs leading-5 text-secondary">
                            {registeredAt ?? '—'}
                          </p>
                          {lastLoginAt ? (
                            <p className="truncate text-[11px] leading-4 text-muted">
                              {t('admin.uaLastLoginLine', { date: lastLoginAt })}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className={CELL}>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <span className="truncate text-xs leading-5 text-secondary">
                          {activityAt ?? '—'}
                        </span>
                        {row.recently_active ? (
                          <StatusBadge
                            tone="success"
                            label={t('admin.uaOnlineLabel')}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className={CELL}>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <span className="truncate text-[11px] leading-4 text-muted">
                          {reminderAt ?? '—'}
                        </span>
                        <AdminSecondaryButton
                          className="!min-h-0 !w-[5.75rem] !shrink-0 !justify-center !rounded-lg !px-2 !py-0.5 !text-xs"
                          disabled={busyEmail === row.email || migrationNeeded}
                          onClick={() => void remind(row, !row.is_registered)}
                        >
                          {t('admin.uaActionRemind')}
                        </AdminSecondaryButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTableShell>
      )}
    </div>
  );
}
