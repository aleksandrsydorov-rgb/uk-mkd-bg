'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { adminFieldClass } from '@/components/admin/AdminUi';
import { formatEur } from '@/lib/utilities';

/**
 * Shared confirmation panel for MTR-5 meter reading corrections.
 * Calls existing correct_* RPCs only — no direct table writes.
 */
export function AdminMeterCorrectionPanel({
  originalSummary,
  valueFields,
  reason,
  onReasonChange,
  confirmed,
  onConfirmedChange,
  hasCharge,
  estimatedDeltaEur,
  busy,
  onSubmit,
  onCancel,
}: {
  originalSummary: ReactNode;
  valueFields: ReactNode;
  reason: string;
  onReasonChange: (value: string) => void;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  hasCharge: boolean;
  /** When null and hasCharge, show server-side calculation note (no invented amount). */
  estimatedDeltaEur: number | null;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const fieldClass = adminFieldClass;
  const canSubmit = confirmed && reason.trim().length > 0 && !busy;

  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
      <p className="font-medium text-foreground">{t('admin.meterCorrection')}</p>
      <p className="mt-1 text-xs text-secondary">{t('admin.meterCorrectionHint')}</p>
      <div className="mt-3 space-y-1 text-xs text-secondary">{originalSummary}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{valueFields}</div>
      <label className="mt-3 block text-secondary">
        {t('admin.meterCorrectionReason')}
        <input
          required
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className={`mt-1 block w-full ${fieldClass}`}
          disabled={busy}
        />
      </label>
      {hasCharge ? (
        <p className="mt-2 text-xs text-secondary">
          {estimatedDeltaEur != null
            ? t('admin.meterCorrectionImpact', {
                amount: formatEur(estimatedDeltaEur, locale),
              })
            : t('admin.meterCorrectionImpactServer')}
        </p>
      ) : (
        <p className="mt-2 text-xs text-secondary">{t('admin.meterCorrectionNoCharge')}</p>
      )}
      <label className="mt-2 flex items-center gap-2 text-secondary">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          disabled={busy}
        />
        {t('admin.feeActionConfirm')}
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t('common.saving') : t('admin.meterCorrectionSubmit')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-1.5 text-sm text-secondary"
        >
          {t('admin.feeActionCancel')}
        </button>
      </div>
    </div>
  );
}
