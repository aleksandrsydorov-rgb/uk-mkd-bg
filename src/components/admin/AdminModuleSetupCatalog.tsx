'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { LOCALE_META } from '@/i18n/config';
import {
  groupModulesByCategory,
  moduleCategoryMessageKey,
  moduleLabelMessageKey,
  type BuildingModuleV2Row,
} from '@/lib/modules';
import {
  moduleSetupCatalogAction,
  type ModuleSetupCatalogRow,
  type ModuleSetupCatalogStatus,
} from '@/lib/moduleSetupCatalog';
import { modulePurposeMessageKey, moduleVisual } from '@/lib/moduleVisuals';
import styles from './AdminModuleSetupCatalog.module.css';

type Props = {
  rows: ModuleSetupCatalogRow[];
  t: (key: string) => string;
  onOpen: (moduleKey: string) => void;
};

function statusClass(status: ModuleSetupCatalogStatus): string {
  if (status === 'setup_started') return `${styles.status} ${styles.statusStarted}`;
  if (status === 'needs_setup') return `${styles.status} ${styles.statusNeedsSetup}`;
  return `${styles.status} ${styles.statusNotConnected}`;
}

function statusLabel(t: (key: string) => string, status: ModuleSetupCatalogStatus): string {
  if (status === 'setup_started') return t('admin.moduleSetupStatusStarted');
  if (status === 'needs_setup') return t('admin.moduleSetupStatusNeedsSetup');
  return t('admin.moduleSetupStatusNotConnected');
}

function actionLabel(t: (key: string) => string, status: ModuleSetupCatalogStatus): string {
  return moduleSetupCatalogAction(status) === 'continue'
    ? t('admin.moduleSetupActionContinue')
    : t('admin.moduleSetupActionConfigure');
}

function titleFor(t: (key: string) => string, row: ModuleSetupCatalogRow): string {
  if (row.moduleKey === 'property_book') return t('admin.firstRunStagePropertyBook');
  if (row.moduleKey === 'budget') return t('admin.firstRunStageBudget');
  const key = moduleLabelMessageKey(row.moduleKey);
  return key ? t(`admin.${key}`) : row.defaultName || row.moduleKey;
}

export function AdminModuleSetupCatalog({ rows, t, onOpen }: Props) {
  const { locale } = useI18n();
  const dateLocale = LOCALE_META[locale].dates;

  const groups = useMemo(() => {
    const asCatalog: BuildingModuleV2Row[] = rows.map((row) => ({
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
          rows.find((r) => r.moduleKey === a.module_key)!,
        ).localeCompare(
          titleFor(
            t,
            rows.find((r) => r.moduleKey === b.module_key)!,
          ),
          dateLocale,
          { sensitivity: 'base' },
        ),
      ),
    }));
  }, [rows, t, dateLocale]);

  if (rows.length === 0) {
    return <p className={styles.empty}>{t('admin.moduleSetupCatalogEmpty')}</p>;
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const catKey = moduleCategoryMessageKey(group.category);
        return (
          <section key={group.category} className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {catKey ? t(`admin.${catKey}`) : group.category}
            </h3>
            <div className={styles.grid}>
              {group.modules.map((mod) => {
                const row = rows.find((r) => r.moduleKey === mod.module_key)!;
                const visual = moduleVisual(row.moduleKey);
                const Icon = visual.icon;
                const purposeKey = modulePurposeMessageKey(row.moduleKey);
                return (
                  <button
                    key={row.moduleKey}
                    type="button"
                    className={styles.card}
                    onClick={() => onOpen(row.moduleKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(row.moduleKey);
                      }
                    }}
                  >
                    <div className={styles.cardTop}>
                      <span className={styles.iconWrap}>
                        <Icon className={`h-4 w-4 ${visual.iconClass}`} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className={styles.title}>{titleFor(t, row)}</p>
                        {purposeKey ? <p className={styles.purpose}>{t(purposeKey)}</p> : null}
                      </div>
                    </div>
                    <div className={styles.footer}>
                      <div className="min-w-0">
                        <span className={statusClass(row.status)}>{statusLabel(t, row.status)}</span>
                        {row.pendingReasonKey ? (
                          <p className={styles.purpose}>{t(row.pendingReasonKey)}</p>
                        ) : null}
                      </div>
                      <span className={styles.action}>{actionLabel(t, row.status)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
