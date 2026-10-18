'use client';

import { useMemo, useState } from 'react';
import {
  AdminToggle,
  adminCardClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  groupModulesByCategory,
  isModuleToggleable,
  isPlatformCoreModuleKey,
  moduleCategoryMessageKey,
  moduleLabelMessageKey,
  type BuildingModuleV2Row,
} from '@/lib/modules';

export type ModuleCatalogStatusKind =
  | 'not_implemented'
  | 'enabled'
  | 'disabled'
  | 'saving';

export function moduleCatalogStatusKind(opts: {
  implemented: boolean;
  enabled: boolean;
  moduleKey: string;
  saving?: boolean;
}): ModuleCatalogStatusKind {
  if (opts.saving) return 'saving';
  if (!opts.implemented) return 'not_implemented';
  return opts.enabled ? 'enabled' : 'disabled';
}

type FilterId = 'all' | 'active' | 'off' | 'unavailable';

type Props = {
  catalog: BuildingModuleV2Row[];
  canChange: boolean;
  savingKey: string | null;
  onToggle: (key: string, enabled: boolean) => void;
  t: (key: string) => string;
  /** Optional deep-link when a module has its own settings section */
  onOpenModuleSettings?: (moduleKey: string) => void;
};

const MODULE_SETTINGS_SECTION: Partial<Record<string, string>> = {
  tariffs: 'тарифы',
  support_fee: 'такса',
  capital_repair: 'капремонт',
  water: 'вода',
  electricity: 'электроэнергия',
  internet: 'интернет',
  inventory: 'инвентарь',
  security: 'охрана',
  cleaning: 'уборка',
  budget: 'бюджет',
};

export function AdminModuleCatalogPanel({
  catalog,
  canChange,
  savingKey,
  onToggle,
  t,
  onOpenModuleSettings,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');

  const rows = useMemo(
    () => catalog.filter((row) => !isPlatformCoreModuleKey(row.module_key)),
    [catalog],
  );

  const resolveLabel = (row: BuildingModuleV2Row) => {
    const msgKey = moduleLabelMessageKey(row.module_key);
    if (msgKey) return t(`admin.${msgKey}`);
    return row.default_name || row.module_key;
  };

  const resolveCategory = (category: string) => {
    const msgKey = moduleCategoryMessageKey(category);
    if (msgKey) return t(`admin.${msgKey}`);
    return category;
  };

  const statusLabel = (kind: ModuleCatalogStatusKind) => {
    switch (kind) {
      case 'not_implemented':
        return t('admin.moduleNotImplemented');
      case 'enabled':
        return t('admin.moduleEnabled');
      case 'disabled':
        return t('admin.moduleDisabled');
      case 'saving':
        return t('admin.moduleSaving');
      default:
        return kind;
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const label = resolveLabel(row).toLowerCase();
      if (q && !label.includes(q) && !row.module_key.toLowerCase().includes(q)) {
        return false;
      }
      const kind = moduleCatalogStatusKind({
        implemented: row.implemented === true,
        enabled: row.enabled === true,
        moduleKey: row.module_key,
      });
      if (filter === 'active') return kind === 'enabled';
      if (filter === 'off') return kind === 'disabled';
      if (filter === 'unavailable') {
        return kind === 'not_implemented';
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t/resolveLabel stable enough via messages
  }, [rows, query, filter, t]);

  const grouped = groupModulesByCategory(filtered);

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all', label: t('admin.settingsModuleFilterAll') },
    { id: 'active', label: t('admin.settingsModuleFilterActive') },
    { id: 'off', label: t('admin.settingsModuleFilterOff') },
    { id: 'unavailable', label: t('admin.settingsModuleFilterUnavailable') },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-medium text-muted" htmlFor="module-catalog-search">
            {t('admin.settingsModuleSearch')}
          </label>
          <input
            id="module-catalog-search"
            className={`${adminFieldClass} mt-1`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.settingsModuleSearchPh')}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('admin.settingsModuleFilters')}>
          {filters.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  on
                    ? 'bg-accent text-white'
                    : 'border border-border bg-surface text-secondary hover:bg-hover'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted">{t('admin.moduleDisableHint')}</p>

      {grouped.length === 0 ? (
        <div className={`${adminCardClass} px-4 py-5`}>
          <p className="text-sm text-muted">{t('admin.settingsModuleEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.category} className="space-y-2">
              <p className="px-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-secondary">
                {resolveCategory(group.category)}
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface">
                {group.modules.map((row) => {
                  const saving = savingKey === row.module_key;
                  const kind = moduleCatalogStatusKind({
                    implemented: row.implemented === true,
                    enabled: row.enabled === true,
                    moduleKey: row.module_key,
                    saving,
                  });
                  const toggleable = isModuleToggleable(
                    row.module_key,
                    row.implemented === true,
                  );
                  const settingsSection = MODULE_SETTINGS_SECTION[row.module_key];
                  const statusTone =
                    kind === 'enabled'
                      ? 'text-accent'
                      : kind === 'not_implemented'
                        ? 'text-muted'
                        : 'text-secondary';

                  return (
                    <li
                      key={row.module_key}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {resolveLabel(row)}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <span className={statusTone}>{statusLabel(kind)}</span>
                          {row.implemented ? (
                            <span className="text-muted">
                              · {t('admin.settingsModuleImplemented')}
                            </span>
                          ) : null}
                          {settingsSection && kind === 'enabled' && onOpenModuleSettings ? (
                            <button
                              type="button"
                              className="text-accent hover:underline"
                              onClick={() => onOpenModuleSettings(row.module_key)}
                            >
                              {t('admin.settingsModuleOpenSettings')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {toggleable ? (
                        canChange ? (
                          <AdminToggle
                            checked={row.enabled === true}
                            busy={saving}
                            disabled={savingKey != null && !saving}
                            label={`${resolveLabel(row)}: ${t('admin.moduleToggle')}`}
                            onChange={(next) => onToggle(row.module_key, next)}
                          />
                        ) : (
                          <span className="text-xs text-muted">{t('admin.feeAdminOnlyRate')}</span>
                        )
                      ) : (
                        <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] text-muted">
                          {statusLabel(kind)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
