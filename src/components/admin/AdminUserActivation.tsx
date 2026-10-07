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
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';
import {
  USER_ACTIVATION_ONLINE_MINUTES,
  activationStateTone,
  canSeeUserActivationAdmin,
  createUserActivationReminder,
  fetchUserActivationDashboard,
  fetchUserActivationList,
  formatOwnerProperties,
  type UserActivationDashboard,
  type UserActivationFilter,
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

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.uaTitle')} secondary={t('admin.uaLead')} />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? (
        <AdminInlineAlert tone="success" onDismiss={() => setSuccess(null)}>
          {success}
        </AdminInlineAlert>
      ) : null}
      {migrationNeeded ? (
        <AdminInlineAlert tone="warning">{t('admin.uaMigrationNeeded')}</AdminInlineAlert>
      ) : null}

      <AdminInlineAlert tone="info">
        {t('admin.uaOnlineHint', { minutes: String(USER_ACTIVATION_ONLINE_MINUTES) })}
      </AdminInlineAlert>

      {dashboard ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminMetricCard label={t('admin.uaMetricTotal')} value={String(dashboard.total_owners)} />
          <AdminMetricCard label={t('admin.uaMetricInvited')} value={String(dashboard.invited)} />
          <AdminMetricCard
            label={t('admin.uaMetricRegistered')}
            value={String(dashboard.registered)}
          />
          <AdminMetricCard
            label={t('admin.uaMetricFirstLogin')}
            value={String(dashboard.first_login_completed)}
          />
          <AdminMetricCard
            label={t('admin.uaMetricActive30')}
            value={String(dashboard.active_last_30_days)}
          />
          <AdminMetricCard
            label={t('admin.uaMetricNeverLogin')}
            value={String(dashboard.never_logged_in)}
            alert={dashboard.never_logged_in > 0}
          />
          <AdminMetricCard
            label={t('admin.uaMetricDormant')}
            value={String(dashboard.dormant)}
            alert={dashboard.dormant > 0}
          />
          <AdminMetricCard
            label={t('admin.uaMetricActivationPct')}
            value={`${dashboard.activation_percent}%`}
            secondary={t('admin.uaMetricPropertyCoverage', {
              n: String(dashboard.properties_with_active_owner),
              total: String(dashboard.properties_total),
            })}
          />
        </div>
      ) : null}

      <section className={`${adminCardClass} space-y-3 p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  filter === f
                    ? 'bg-accent text-white'
                    : 'border border-border bg-surface text-secondary hover:bg-hover'
                }`}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>
          <label className="grid w-full max-w-sm gap-1 text-xs text-secondary">
            {t('admin.uaSearch')}
            <input
              className={adminFieldClass}
              value={search}
              placeholder={t('admin.uaSearchPh')}
              onChange={(e) => setSearch(e.target.value)}
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
          <table className="min-w-full text-sm">
            <thead>
              <tr className={adminTableHeadRowClass}>
                <th className={adminTableCellClass}>{t('admin.uaColOwner')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColEmail')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColProperties')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColInvite')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColRegistered')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColFirstLogin')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColLastLogin')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColLastActivity')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColState')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColReminder')}</th>
                <th className={adminTableCellClass}>{t('admin.uaColActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.email} className={adminTableRowClass}>
                  <td className={adminTableCellClass}>
                    <div className="font-medium text-foreground">{row.display_name}</div>
                    {row.recently_active ? (
                      <p className="text-[11px] text-success">{t('admin.uaRecentlyActive')}</p>
                    ) : null}
                    {row.needs_attention ? (
                      <p className="text-[11px] text-warning">{t('admin.uaNeedsAttention')}</p>
                    ) : null}
                  </td>
                  <td className={`${adminTableCellClass} break-all`}>{row.email}</td>
                  <td className={adminTableCellClass}>{formatOwnerProperties(row.properties)}</td>
                  <td className={adminTableCellClass}>
                    {row.has_invite ? t('admin.uaYes') : t('admin.uaNo')}
                    {row.last_invite_at ? (
                      <p className="text-[11px] text-muted">{formatDate(row.last_invite_at)}</p>
                    ) : null}
                  </td>
                  <td className={adminTableCellClass}>
                    {row.is_registered ? t('admin.uaYes') : t('admin.uaNo')}
                    {row.registered_at ? (
                      <p className="text-[11px] text-muted">{formatDate(row.registered_at)}</p>
                    ) : null}
                  </td>
                  <td className={adminTableCellClass}>{formatDate(row.first_login_at)}</td>
                  <td className={adminTableCellClass}>{formatDate(row.last_login_at)}</td>
                  <td className={adminTableCellClass}>{formatDate(row.last_activity_at)}</td>
                  <td className={adminTableCellClass}>
                    <StatusBadge
                      tone={activationStateTone(row.activation_state)}
                      label={stateLabel(row.activation_state)}
                    />
                  </td>
                  <td className={adminTableCellClass}>{formatDate(row.last_reminder_at)}</td>
                  <td className={adminTableCellClass}>
                    <div className="flex flex-col gap-1">
                      {!row.is_registered ? (
                        <AdminPrimaryButton
                          disabled={busyEmail === row.email || migrationNeeded}
                          onClick={() => void remind(row, true)}
                        >
                          {t('admin.uaActionResendInvite')}
                        </AdminPrimaryButton>
                      ) : (
                        <AdminSecondaryButton
                          disabled={busyEmail === row.email || migrationNeeded}
                          onClick={() => void remind(row, false)}
                        >
                          {t('admin.uaActionNudge')}
                        </AdminSecondaryButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableShell>
      )}
    </div>
  );
}
