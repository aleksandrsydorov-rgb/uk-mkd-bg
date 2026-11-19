'use client';

import { useI18n } from '@/i18n/I18nProvider';
import { formatM3, todayIsoDate } from '@/lib/utilities';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';
import { formatSectionBlock } from '@/lib/utilityModuleRegister';
import {
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name?: string | null;
};

type MeterOption = {
  id: string;
  meter_number: string | null;
};

/**
 * Shared water reading submit fields — used by toolbar shell and row popup.
 * Does not call APIs; parent owns submit / validation / rights.
 */
export function AdminWaterReadingSubmitForm({
  mode,
  properties,
  propertyId,
  onPropertyChange,
  meters,
  selectedMeterId,
  onMeterChange,
  lastKnownValue,
  submitValue,
  onSubmitValueChange,
  submitDate,
  onSubmitDateChange,
  busy,
  metersLoading = false,
  canSubmit,
  onSubmit,
  onCancel,
  onGoToMeters,
}: {
  mode: 'picker' | 'locked';
  properties: PropertyOption[];
  propertyId: number | '';
  onPropertyChange: (id: number | '') => void;
  meters: MeterOption[];
  selectedMeterId: string;
  onMeterChange: (id: string) => void;
  lastKnownValue: number | null;
  submitValue: string;
  onSubmitValueChange: (v: string) => void;
  submitDate: string;
  onSubmitDateChange: (v: string) => void;
  busy: boolean;
  /** While property meters are loading — do not treat empty as «no meter». */
  metersLoading?: boolean;
  canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  onGoToMeters?: () => void;
}) {
  const { t, locale } = useI18n();
  const fieldClass = adminFieldClass;
  const selected = propertyId === '' ? null : properties.find((p) => p.id === propertyId) ?? null;
  const activeMeters = meters;
  const noMeter = propertyId !== '' && !metersLoading && activeMeters.length === 0;
  const multiMeter = !metersLoading && activeMeters.length > 1;
  const selectedMeter =
    selectedMeterId
      ? activeMeters.find((m) => m.id === selectedMeterId) ?? null
      : activeMeters.length === 1
        ? activeMeters[0]
        : null;
  const meterReady =
    !metersLoading &&
    !noMeter &&
    (activeMeters.length === 1 || Boolean(selectedMeter));
  const meterNumberLabel =
    selectedMeter?.meter_number?.trim() ||
    (activeMeters.length === 1 ? activeMeters[0]?.meter_number?.trim() : '') ||
    '';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'picker' ? (
        <label className="block text-xs text-muted">
          {t('admin.pickProperty')}
          <ApartmentCombobox
            className="mt-1"
            properties={properties}
            value={propertyId}
            onChange={onPropertyChange}
          />
        </label>
      ) : selected ? (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-muted">{t('admin.utilFinApartment')}</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {formatPropertyIdentity(selected, t)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">{t('admin.utilRegColSection')}</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {formatSectionBlock(selected.section_code ?? '', selected.block_code ?? '')}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">{t('admin.meterNumber')}</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {meterNumberLabel || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">{t('admin.waterReadingsLastKnown')}</dt>
            <dd className="mt-0.5 tabular-nums text-foreground">
              {lastKnownValue == null ? '—' : formatM3(lastKnownValue, locale)}
            </dd>
          </div>
        </dl>
      ) : null}

      {metersLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : null}

      {noMeter ? (
        <AdminInlineAlert tone="warning">
          <p>{t('admin.waterReadingsNoMeterExplain')}</p>
          {onGoToMeters ? (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
              onClick={onGoToMeters}
            >
              {t('admin.waterReadingsGoToMeters')}
            </button>
          ) : null}
        </AdminInlineAlert>
      ) : null}

      {mode === 'picker' && propertyId !== '' && activeMeters.length === 1 ? (
        <p className="text-sm text-secondary">
          {t('admin.meterNumber')}:{' '}
          <span className="font-medium text-foreground">
            {activeMeters[0]?.meter_number?.trim() ? activeMeters[0].meter_number : '—'}
          </span>
          {lastKnownValue != null ? (
            <>
              {' · '}
              {t('admin.waterReadingsLastKnown')}:{' '}
              <span className="tabular-nums font-medium text-foreground">
                {formatM3(lastKnownValue, locale)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {mode === 'picker' && multiMeter ? (
        <label className="block text-xs text-muted">
          {t('admin.waterReadingsPickMeter')}
          <select
            className={`mt-1 block w-full ${fieldClass}`}
            value={selectedMeterId}
            onChange={(e) => onMeterChange(e.target.value)}
            disabled={busy}
            required
          >
            <option value="">{t('admin.waterReadingsPickMeterPh')}</option>
            {activeMeters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.meter_number?.trim() ? m.meter_number : m.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {mode === 'picker' && multiMeter && selectedMeter ? (
        <p className="text-sm text-secondary">
          {t('admin.waterReadingsLastKnown')}:{' '}
          <span className="tabular-nums font-medium text-foreground">
            {lastKnownValue == null ? '—' : formatM3(lastKnownValue, locale)}
          </span>
        </p>
      ) : null}

      {!noMeter && meterReady ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            {t('account.utilCurrentM3')}
            <input
              className={`mt-1 block w-full ${fieldClass}`}
              type="number"
              min="0"
              step="0.1"
              value={submitValue}
              onChange={(e) => onSubmitValueChange(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="block text-xs text-muted">
            {t('admin.date')}
            <input
              className={`mt-1 block w-full ${fieldClass}`}
              type="date"
              max={todayIsoDate()}
              value={submitDate}
              onChange={(e) => onSubmitDateChange(e.target.value)}
              required
              disabled={busy}
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!noMeter && meterReady ? (
          <AdminPrimaryButton
            type="submit"
            disabled={busy || !canSubmit || propertyId === ''}
          >
            {busy ? t('account.utilSubmitting') : t('admin.waterReadingsSubmit')}
          </AdminPrimaryButton>
        ) : null}
        <AdminSecondaryButton type="button" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </AdminSecondaryButton>
      </div>
    </form>
  );
}
