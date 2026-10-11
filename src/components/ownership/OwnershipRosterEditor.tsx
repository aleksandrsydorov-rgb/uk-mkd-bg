'use client';

import { useI18n } from '@/i18n/I18nProvider';
import {
  emptyRosterOwner,
  validateRosterForms,
  type RosterOwnerForm,
} from '@/lib/ownershipChange';

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

type Props = {
  owners: RosterOwnerForm[];
  onChange: (owners: RosterOwnerForm[]) => void;
  propertyIdealParts: number;
  disabled?: boolean;
  compact?: boolean;
};

export function OwnershipRosterEditor({
  owners,
  onChange,
  propertyIdealParts,
  disabled = false,
  compact = false,
}: Props) {
  const { t } = useI18n();
  const validation = validateRosterForms(owners, propertyIdealParts);

  function patch(key: string, patch: Partial<RosterOwnerForm>) {
    onChange(owners.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {t('xfer.shareSum')}: {validation.shareSum.toFixed(3)}% · {t('xfer.idealSum')}:{' '}
          {validation.idealSum.toFixed(6)} / {propertyIdealParts}
        </span>
        {!disabled && (
          <button
            type="button"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground"
            onClick={() => onChange([...owners, emptyRosterOwner()])}
          >
            {t('xfer.addOwner')}
          </button>
        )}
      </div>

      {!validation.ok && (
        <div className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs text-danger">
          {validation.errors.includes('share_total') && <div>{t('xfer.errShareTotal')}</div>}
          {validation.errors.includes('ideal_total') && <div>{t('xfer.errIdealTotal')}</div>}
          {(validation.errors.includes('email') ||
            validation.errors.includes('name') ||
            validation.errors.includes('entity_name') ||
            validation.errors.includes('share') ||
            validation.errors.includes('ideal')) && <div>{t('xfer.errRosterFields')}</div>}
        </div>
      )}

      {owners.map((o, idx) => (
        <div
          key={o.key}
          className={`space-y-2 rounded-xl border border-border bg-surface p-3 ${compact ? '' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-secondary">
              {t('xfer.ownerN', { n: idx + 1 })}
            </div>
            {!disabled && owners.length > 1 && (
              <button
                type="button"
                className="text-xs text-danger"
                onClick={() => onChange(owners.filter((x) => x.key !== o.key))}
              >
                {t('xfer.removeOwner')}
              </button>
            )}
          </div>

          <select
            className={fieldClass}
            disabled={disabled}
            value={o.entity_kind}
            onChange={(e) =>
              patch(o.key, {
                entity_kind: e.target.value as RosterOwnerForm['entity_kind'],
              })
            }
          >
            <option value="natural_person">{t('xfer.entityNatural')}</option>
            <option value="legal_entity">{t('xfer.entityLegal')}</option>
            <option value="sole_trader">{t('xfer.entitySole')}</option>
          </select>

          {o.entity_kind === 'legal_entity' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={fieldClass}
                disabled={disabled}
                placeholder={t('xfer.entityName')}
                value={o.entity_name}
                onChange={(e) => patch(o.key, { entity_name: e.target.value })}
              />
              <input
                className={fieldClass}
                disabled={disabled}
                placeholder={t('xfer.eik')}
                value={o.eik_bulstat}
                onChange={(e) => patch(o.key, { eik_bulstat: e.target.value })}
              />
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className={fieldClass}
                disabled={disabled}
                placeholder={t('account.firstName')}
                value={o.first_name}
                onChange={(e) => patch(o.key, { first_name: e.target.value })}
              />
              <input
                className={fieldClass}
                disabled={disabled}
                placeholder={t('xfer.middleName')}
                value={o.middle_name}
                onChange={(e) => patch(o.key, { middle_name: e.target.value })}
              />
              <input
                className={fieldClass}
                disabled={disabled}
                placeholder={t('account.lastName')}
                value={o.last_name}
                onChange={(e) => patch(o.key, { last_name: e.target.value })}
              />
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className={`${fieldClass} sm:col-span-1`}
              disabled={disabled}
              type="email"
              placeholder={t('account.phOwnerEmail')}
              value={o.email}
              onChange={(e) => patch(o.key, { email: e.target.value })}
            />
            <input
              className={fieldClass}
              disabled={disabled}
              inputMode="decimal"
              placeholder={t('xfer.sharePercent')}
              value={o.ownership_share_percent}
              onChange={(e) => patch(o.key, { ownership_share_percent: e.target.value })}
            />
            <input
              className={fieldClass}
              disabled={disabled}
              inputMode="decimal"
              placeholder={t('xfer.idealParts')}
              value={o.ideal_parts_percent}
              onChange={(e) => patch(o.key, { ideal_parts_percent: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
