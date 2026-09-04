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
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20'
            }`}
          >
            <div className="font-medium">{t('picker.apt', { n: String(p.apartment_number) })}</div>
            <div className="text-xs text-white/40">{Number(p.area_sqm ?? 0).toFixed(1)} {t('common.sqm')}</div>
          </button>
        );
      })}
    </div>
  );
}
