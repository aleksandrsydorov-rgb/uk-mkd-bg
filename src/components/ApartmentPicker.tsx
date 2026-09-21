'use client';

import { useI18n } from '@/i18n/I18nProvider';

type Apt = {
  id: number;
  apartment_number: string | number;
  area_sqm: number | null;
};

export function ApartmentPicker({
  properties,
  selectedId,
  onSelect,
}: {
  properties: Apt[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useI18n();
  if (properties.length <= 1) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {properties.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
              active
                ? 'border-accent/30 bg-accent-bg text-accent'
                : 'border-border bg-surface text-secondary hover:border-border-strong'
            }`}
          >
            <div className="font-medium">{t('picker.apt', { n: String(p.apartment_number) })}</div>
            <div className="text-xs text-muted">{Number(p.area_sqm ?? 0).toFixed(1)} {t('common.sqm')}</div>
          </button>
        );
      })}
    </div>
  );
}
