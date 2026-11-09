'use client';

import { useMemo, useState } from 'react';
import { AdminToggle, adminFieldClass } from '@/components/admin/AdminUi';
import { FIRST_RUN_LOCKED_MODULES } from '@/lib/firstRun';
import {
  groupModulesByCategory,
  isModuleToggleable,
  isPlatformCoreModuleKey,
  isRelease1DistributionExcluded,
  moduleCategoryMessageKey,
  moduleLabelMessageKey,
  type BuildingModuleV2Row,
} from '@/lib/modules';
import {
  type ModuleSetupCatalogRow,
  type ModuleSetupCatalogStatus,
} from '@/lib/moduleSetupCatalog';
import { modulePurposeMessageKey, moduleVisual } from '@/lib/moduleVisuals';
import styles from './AdminModuleCatalogPanel.module.css';

export type ModuleCatalogStatusKind =
  | 'not_implemented'
  | 'r1_unavailable'
  | 'enabled'
  | 'disabled'
  | 'saving';

export type ModuleCatalogFilterId = 'all' | 'active' | 'off' | 'needs_setup';

export function moduleCatalogStatusKind(opts: {
  implemented: boolean;
  enabled: boolean;
  moduleKey: string;
  saving?: boolean;
}): ModuleCatalogStatusKind {
  if (opts.saving) return 'saving';
  // R1 exclusions are “unavailable”, never “not implemented” or “disabled”.
  if (isRelease1DistributionExcluded(opts.moduleKey)) return 'r1_unavailable';
  if (!opts.implemented) return 'not_implemented';
  return opts.enabled ? 'enabled' : 'disabled';
}

export function parseModuleCatalogFilter(raw: string | null | undefined): ModuleCatalogFilterId {
  const v = String(raw ?? '').trim();
  if (v === 'active' || v === 'off' || v === 'needs_setup') return v;
  return 'all';
}

export function isMandatoryBuildingModule(moduleKey: string): boolean {
  return (FIRST_RUN_LOCKED_MODULES as readonly string[]).includes(moduleKey);
}

type Props = {
  rows: ModuleSetupCatalogRow[];
  canChange: boolean;
  savingKey: string | null;
  /** Visual override while wizard is open before activation succeeds. */
  pendingEnableKey?: string | null;
  filter: ModuleCatalogFilterId;
  onFilterChange: (filter: ModuleCatalogFilterId) => void;
  onToggle: (moduleKey: string, enabled: boolean) => void;
  onOpenSetup: (moduleKey: string) => void;
  t: (key: string) => string;
  dateLocale?: string;
};

function titleFor(t: (key: string) => string, row: ModuleSetupCatalogRow): string {
  if (row.moduleKey === 'property_book') return t('admin.firstRunStagePropertyBook');
  if (row.moduleKey === 'budget') return t('admin.firstRunStageBudget');
  if (row.moduleKey === 'uk_expenses') return t('admin.moduleUkExpenses');
  const key = moduleLabelMessageKey(row.moduleKey);
  return key ? t(`admin.${key}`) : row.defaultName || row.moduleKey;
}

function statusPresentation(
  row: ModuleSetupCatalogRow,
  saving: boolean,
  t: (key: string) => string,
): { className: string; label: string } {
  if (saving) {
    return { className: `${styles.status} ${styles.statusSaving}`, label: t('admin.moduleSaving') };
  }
  if (row.status === 'setup_started') {
    return {
      className: `${styles.status} ${styles.statusStarted}`,
      label: t('admin.moduleSetupStatusStarted'),
    };
  }
  if (row.status === 'needs_setup' || row.status === 'not_connected') {
    return {
      className: `${styles.status} ${styles.statusNeedsSetup}`,
      label:
        row.status === 'not_connected'
          ? t('admin.moduleSetupStatusNotConnected')
          : t('admin.moduleSetupStatusNeedsSetup'),
    };
  }
  if (row.buildingEnabled) {
    return { className: `${styles.status} ${styles.statusEnabled}`, label: t('admin.moduleEnabled') };
  }
  return { className: `${styles.status} ${styles.statusDisabled}`, label: t('admin.moduleDisabled') };
}

function needsAttention(status: ModuleSetupCatalogStatus): boolean {
  return status === 'needs_setup' || status === 'setup_started' || status === 'not_connected';
}

export function AdminModuleCatalogPanel({
  rows,
  canChange,
  savingKey,
  pendingEnableKey = null,
  filter,
  onFilterChange,
  onToggle,
  onOpenSetup,
  t,
  dateLocale = 'ru',
}: Props) {
  const [query, setQuery] = useState('');

  const visibleBase = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.catalogImplemented &&
          !isPlatformCoreModuleKey(row.moduleKey) &&
          !isRelease1DistributionExcluded(row.moduleKey),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleBase.filter((row) => {
      const label = titleFor(t, row).toLowerCase();
      if (q && !label.includes(q) && !row.moduleKey.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === 'active') return row.buildingEnabled === true;
      if (filter === 'off') return row.buildingEnabled !== true;
      if (filter === 'needs_setup') return needsAttention(row.status);
      return true;
    });
  }, [visibleBase, query, filter, t]);

  const grouped = useMemo(() => {
    const asCatalog: BuildingModuleV2Row[] = filtered.map((row) => ({
      module_key: row.moduleKey,
      enabled: row.buildingEnabled,
      default_name: row.defaultName,
      category: row.category,
      sort_order: row.sortOrder,
      implemented: row.catalogImplemented,
    }));
    return groupModulesByCategory(asCatalog).map((group) => ({
      ...group,
      modules: [...group.modules].sort((a, b) =>
        titleFor(
          t,
          filtered.find((r) => r.moduleKey === a.module_key)!,
        ).localeCompare(
          titleFor(
            t,
            filtered.find((r) => r.moduleKey === b.module_key)!,
          ),
          dateLocale,
          { sensitivity: 'base' },
        ),
      ),
    }));
  }, [filtered, t, dateLocale]);

  const filters: { id: ModuleCatalogFilterId; label: string }[] = [
    { id: 'all', label: t('admin.settingsModuleFilterAll') },
    { id: 'active', label: t('admin.settingsModuleFilterActive') },
    { id: 'off', label: t('admin.settingsModuleFilterOff') },
    { id: 'needs_setup', label: t('admin.settingsModuleFilterNeedsSetup') },
  ];

  return (
    <section className="space-y-4">
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <label className={styles.searchLabel} htmlFor="module-catalog-search">
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
        <div className={styles.filters} role="group" aria-label={t('admin.settingsModuleFilters')}>
          {filters.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilterChange(f.id)}
                className={`${styles.filterBtn} ${on ? styles.filterBtnOn : ''}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.hint}>{t('admin.moduleDisableHint')}</p>

      {grouped.length === 0 ? (
        <div className={styles.empty}>
          <p className="text-sm text-muted">{t('admin.settingsModuleEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => {
            const catKey = moduleCategoryMessageKey(group.category);
            return (
              <div key={group.category} className={styles.section}>
                <p className={styles.sectionTitle}>
                  {catKey ? t(`admin.${catKey}`) : group.category}
                </p>
                <div className={styles.grid}>
                  {group.modules.map((mod) => {
                    const row = filtered.find((r) => r.moduleKey === mod.module_key)!;
                    const saving = savingKey === row.moduleKey;
                    const mandatory = isMandatoryBuildingModule(row.moduleKey);
                    const toggleable = isModuleToggleable(row.moduleKey, true) && !mandatory;
                    const visual = moduleVisual(row.moduleKey);
                    const Icon = visual.icon;
                    const purposeKey = modulePurposeMessageKey(row.moduleKey);
                    const status = statusPresentation(row, saving, t);
                    const showContinue =
                      row.status === 'setup_started' ||
                      (row.buildingEnabled && needsAttention(row.status));
                    const showConfigure =
                      !row.buildingEnabled && needsAttention(row.status) && row.status !== 'setup_started';
                    const checked =
                      mandatory ||
                      (pendingEnableKey === row.moduleKey
                        ? false
                        : row.buildingEnabled === true);

                    return (
                      <article key={row.moduleKey} className={styles.card}>
                        <div className={styles.toggleWrap}>
                          {mandatory ? (
                            <AdminToggle
                              checked
                              busy={false}
                              disabled
                              label={`${titleFor(t, row)}: ${t('admin.moduleToggle')}`}
                              onChange={() => undefined}
                            />
                          ) : toggleable ? (
                            canChange ? (
                              <AdminToggle
                                checked={checked}
                                busy={saving}
                                disabled={savingKey != null && !saving}
                                label={`${titleFor(t, row)}: ${t('admin.moduleToggle')}`}
                                onChange={(next) => onToggle(row.moduleKey, next)}
                              />
                            ) : (
                              <span className="text-xs text-muted">{t('admin.feeAdminOnlyRate')}</span>
                            )
                          ) : null}
                        </div>

                        <div className={styles.cardTop}>
                          <span className={styles.iconWrap}>
                            <Icon className={`h-4 w-4 ${visual.iconClass}`} aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <div className={styles.titleRow}>
                              <p className={styles.title}>{titleFor(t, row)}</p>
                              {mandatory ? (
                                <span className={styles.badge}>{t('admin.settingsModuleMandatory')}</span>
                              ) : null}
                            </div>
                            {purposeKey ? <p className={styles.purpose}>{t(purposeKey)}</p> : null}
                          </div>
                        </div>

                        <div className={styles.footer}>
                          <div className="min-w-0">
                            <span className={status.className}>{status.label}</span>
                            {row.pendingReasonKey && needsAttention(row.status) ? (
                              <p className={styles.pending}>{t(row.pendingReasonKey)}</p>
                            ) : null}
                          </div>
                          {showContinue ? (
                            <button
                              type="button"
                              className={styles.action}
                              onClick={() => onOpenSetup(row.moduleKey)}
                            >
                              {t('admin.moduleSetupActionContinue')}
                            </button>
                          ) : null}
                          {showConfigure && canChange ? (
                            <button
                              type="button"
                              className={styles.action}
                              onClick={() => onOpenSetup(row.moduleKey)}
                            >
                              {t('admin.moduleSetupActionConfigure')}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
