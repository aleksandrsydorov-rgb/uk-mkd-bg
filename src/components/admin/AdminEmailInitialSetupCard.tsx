'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { AdminCard } from '@/components/admin/AdminUi';

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  canManage?: boolean;
  /** Navigate to Settings → Notifications (single configuration surface). */
  onOpenEmailSettings?: () => void;
};

/**
 * Initial Setup pointer only — email connection lives in Settings → Notifications.
 * Avoids a second independent configuration form.
 */
export function AdminEmailInitialSetupCard({ t, onOpenEmailSettings }: Props) {
  return (
    <AdminCard>
      <h3 className="text-sm font-semibold text-foreground">{t('admin.emailIsTitle')}</h3>
      <p className="mt-1 text-xs text-secondary">{t('admin.emailIsUseSettings')}</p>
      {onOpenEmailSettings ? (
        <button
          type="button"
          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          onClick={onOpenEmailSettings}
        >
          {t('admin.emailIsOpenSettings')}
        </button>
      ) : null}
    </AdminCard>
  );
}
