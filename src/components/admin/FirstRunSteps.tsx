'use client';

import { useState, type ReactNode, type Ref } from 'react';
import {
  BookOpen,
  Check,
  ClipboardList,
  Droplets,
  FileText,
  Gauge,
  Landmark,
  LayoutGrid,
  Lock,
  Megaphone,
  MessagesSquare,
  Package,
  Puzzle,
  Receipt,
  Shield,
  Sparkles,
  Users,
  Vote,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  isFirstRunTariffPrepared,
  type FirstRunErrorRow,
  type FirstRunMeterUtility,
  type FirstRunModuleChoice,
  type FirstRunTariffPrepMap,
} from '@/lib/firstRun';
import {
  presentBookApartmentCardContent,
  presentBookPreviewIssue,
  presentBookPreviewIssueWhere,
  presentFirstRunErrorRow,
} from '@/lib/firstRunUserMessage';
import {
  formatMeterMoney,
  formatMeterReadingCell,
  groupMeterPreviewRowsByEntrance,
  meterOpeningBalanceStatus,
  presentMeterOpeningBalanceStatus,
  summarizeMeterOpeningBalances,
} from '@/lib/firstRunMetersPreview';
import {
  buildMetersOpeningClarify,
  formatAptCountAfterPo,
  formatMeterEntranceGroupTitle,
  presentMeterClarifyMessage,
  presentMetersReadySummary,
  type MeterClarifyItem,
} from '@/lib/firstRunMetersImportPreview';
import {
  apartmentsWithOwnersCount,
  buildBookPreviewIssues,
  buildBookSectionBreakdown,
  clarifyGroupSummary,
  formatBookApartmentCardHeading,
  formatEntranceGroupTitle,
  formatSectionCountsLine,
  groupBookApartmentCardsByEntrance,
  groupBookPreviewByApartment,
  groupClarifyIssuesByReason,
  supplementApartmentCardsFromOwners,
} from '@/lib/propertyBookImportPreview';
import {
  FirstRunTariffPrepBlock,
  type FirstRunTariffPrepHandle,
} from '@/components/admin/FirstRunTariffPrepBlock';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { useI18n } from '@/i18n/I18nProvider';
import { LOCALE_META } from '@/i18n/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  groupModulesByCategory,
  isPlatformCoreModuleKey,
  moduleCategoryMessageKey,
  moduleLabelMessageKey,
  type BuildingModuleV2Row,
} from '@/lib/modules';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import styles from './FirstRunFrame.module.css';

type T = (key: string, params?: Record<string, string | number>) => string;

export function FirstRunScreen({
  icon: Icon,
  iconClass,
  title,
  lead,
  busy,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  lead: string;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.screen} aria-busy={busy}>
      <header className={styles.screenHead}>
        <Icon className={`${styles.screenIcon} ${iconClass}`} aria-hidden="true" />
        <div>
          <h2 className={styles.screenTitle}>{title}</h2>
          <p className={styles.screenLead}>{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint: string;
  error?: string | null;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.span2 : ''}`}>
      {label}
      {children}
      <span className={styles.hint}>{hint}</span>
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}

/** @deprecated Use FirstRunComplexProfile — kept for the visual stand import path. */
export { FirstRunComplexProfile as FirstRunComplexCard } from '@/components/admin/FirstRunComplexProfile';

const OPTIONAL_ICON: Record<string, { icon: LucideIcon; iconClass: string }> = {
  water: { icon: Droplets, iconClass: 'text-sky-600' },
  electricity: { icon: Zap, iconClass: 'text-amber-600' },
  budget: { icon: Wallet, iconClass: 'text-emerald-700' },
  internet: { icon: Wifi, iconClass: 'text-sky-600' },
  service_lock: { icon: Lock, iconClass: 'text-slate-600' },
  security: { icon: Shield, iconClass: 'text-slate-700' },
  requests: { icon: ClipboardList, iconClass: 'text-teal-700' },
  chat: { icon: MessagesSquare, iconClass: 'text-sky-700' },
  polls: { icon: Vote, iconClass: 'text-violet-600' },
  announcements: { icon: Megaphone, iconClass: 'text-orange-600' },
  general_meeting: { icon: Landmark, iconClass: 'text-indigo-600' },
  building_documents: { icon: FileText, iconClass: 'text-slate-600' },
  guest_mode: { icon: Users, iconClass: 'text-teal-600' },
  cleaning: { icon: Sparkles, iconClass: 'text-sky-600' },
  inventory: { icon: Package, iconClass: 'text-amber-700' },
  uk_expenses: { icon: Receipt, iconClass: 'text-emerald-700' },
};

const MODULE_PURPOSE: Record<string, string> = {
  property_book: 'admin.firstRunModuleAboutPropertyBook',
  support_fee: 'admin.firstRunModuleAboutSupportFee',
  capital_repair: 'admin.firstRunModuleAboutCapitalRepair',
  budget: 'admin.firstRunModuleAboutBudget',
  water: 'admin.firstRunModuleAboutWater',
  electricity: 'admin.firstRunModuleAboutElectricity',
  internet: 'admin.firstRunModuleAboutInternet',
  requests: 'admin.firstRunModuleAboutRequests',
  chat: 'admin.firstRunModuleAboutChat',
  polls: 'admin.firstRunModuleAboutPolls',
  announcements: 'admin.firstRunModuleAboutAnnouncements',
  general_meeting: 'admin.firstRunModuleAboutGeneralMeeting',
  service_lock: 'admin.firstRunModuleAboutServiceLock',
  cleaning: 'admin.firstRunModuleAboutCleaning',
  inventory: 'admin.firstRunModuleAboutInventory',
  uk_expenses: 'admin.firstRunModuleAboutUkExpenses',
  security: 'admin.firstRunModuleAboutSecurity',
  building_documents: 'admin.firstRunModuleAboutDocuments',
  guest_mode: 'admin.firstRunModuleAboutGuestMode',
};

const LOCKED = [
  { key: 'property_book', label: 'admin.firstRunStagePropertyBook', icon: BookOpen, iconClass: 'text-indigo-600' },
  { key: 'support_fee', label: 'admin.moduleSupportFee', icon: Wallet, iconClass: 'text-emerald-600' },
  { key: 'capital_repair', label: 'admin.moduleCapitalRepair', icon: Landmark, iconClass: 'text-orange-700' },
  { key: 'budget', label: 'admin.firstRunStageBudget', icon: Wallet, iconClass: 'text-teal-700' },
  { key: 'uk_expenses', label: 'admin.moduleUkExpenses', icon: Receipt, iconClass: 'text-emerald-700' },
  { key: 'guest_mode', label: 'admin.moduleGuestMode', icon: Users, iconClass: 'text-teal-600' },
] as const;

function moduleTitle(t: T, key: string, fallback: string): string {
  const labelKey = moduleLabelMessageKey(key);
  return labelKey ? t(`admin.${labelKey}`) : fallback;
}

function cardTitle(t: T, key: string, fallback: string): string {
  if (key === 'property_book' || key === 'property_book_objects' || key === 'property_book_owners') {
    return t('admin.firstRunStagePropertyBook');
  }
  if (key === 'budget') return t('admin.firstRunStageBudget');
  return moduleTitle(t, key, fallback);
}

export function FirstRunModulesSelect({
  t,
  choice,
  catalog,
  lockedOff,
  busy,
  onChange,
  onSave,
}: {
  t: T;
  choice: FirstRunModuleChoice;
  catalog: BuildingModuleV2Row[];
  lockedOff: string[];
  busy: boolean;
  onChange: (next: FirstRunModuleChoice) => void;
  onSave: () => void;
}) {
  const { locale } = useI18n();
  const locked = new Set<string>(LOCKED.map((item) => item.key));
  const visible = catalog.filter(
    (row) =>
      row.implemented === true &&
      row.module_key !== 'tariffs' &&
      row.module_key !== 'property_book_objects' &&
      row.module_key !== 'property_book_owners' &&
      !isPlatformCoreModuleKey(row.module_key),
  );
  for (const item of LOCKED) {
    if (!visible.some((row) => row.module_key === item.key)) {
      visible.push({
        module_key: item.key,
        enabled: true,
        default_name: t(item.label),
        category:
          item.key === 'property_book'
            ? 'documents'
            : item.key === 'budget'
              ? 'finance'
              : item.key === 'uk_expenses'
                ? 'finance'
                : item.key === 'guest_mode'
                  ? 'complex_owners'
                  : 'utilities',
        sort_order: 0,
        implemented: true,
      });
    }
  }
  const groups = groupModulesByCategory(
    visible.map((row) => (row.module_key === 'guest_mode' ? { ...row, category: 'complex_owners' } : row)),
  ).map((group) => ({
    ...group,
    modules: [...group.modules].sort((a, b) =>
      cardTitle(t, a.module_key, a.default_name).localeCompare(cardTitle(t, b.module_key, b.default_name), LOCALE_META[locale].dates, {
        sensitivity: 'base',
      }),
    ),
  }));

  function checked(key: string): boolean {
    if (locked.has(key)) return true;
    if (key === 'water') return choice.water;
    if (key === 'internet') return choice.internet;
    if (key === 'electricity') return choice.electricity;
    return choice.extra.includes(key);
  }

  function toggle(key: string) {
    if (locked.has(key) || lockedOff.includes(key) || busy) return;
    if (key === 'water') onChange({ ...choice, water: !choice.water });
    else if (key === 'electricity') onChange({ ...choice, electricity: !choice.electricity });
    else if (key === 'internet') onChange({ ...choice, internet: !choice.internet });
    else if (choice.extra.includes(key)) onChange({ ...choice, extra: choice.extra.filter((item) => item !== key) });
    else onChange({ ...choice, extra: [...choice.extra, key] });
  }

  return (
    <FirstRunScreen
      icon={LayoutGrid}
      iconClass="text-teal-700"
      title={t('admin.firstRunModulesTitle')}
      lead={t('admin.firstRunModulesLead')}
      busy={busy}
    >
      <div className={styles.moduleSections}>
        {groups.map((group) => {
          const categoryKey = moduleCategoryMessageKey(group.category);
          return (
            <section key={group.category} className={styles.moduleSection}>
              <h3 className={styles.moduleSectionTitle}>{categoryKey ? t(`admin.${categoryKey}`) : group.category}</h3>
              <div className={styles.moduleGrid}>
                {group.modules.map((row) => {
                  const required = locked.has(row.module_key);
                  const frozen = required || lockedOff.includes(row.module_key);
                  const on = checked(row.module_key);
                  const preset = LOCKED.find((item) => item.key === row.module_key);
                  const visual = preset ?? OPTIONAL_ICON[row.module_key] ?? { icon: Puzzle, iconClass: 'text-slate-500' };
                  const Icon = visual.icon;
                  const aboutKey = MODULE_PURPOSE[row.module_key];
                  return (
                    <label
                      key={row.module_key}
                      className={`${styles.moduleCard} ${on ? styles.moduleCardOn : ''} ${frozen ? styles.moduleCardLocked : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={frozen || busy}
                        onChange={() => toggle(row.module_key)}
                      />
                      <span className={styles.moduleBody}>
                        <span className={styles.moduleTitleRow}>
                          <Icon className={`h-4 w-4 ${visual.iconClass}`} aria-hidden="true" />
                          <span className={styles.moduleTitle}>{cardTitle(t, row.module_key, row.default_name)}</span>
                          {required ? (
                            <span className={`${styles.badge} ${styles.badgeRequired}`}>{t('admin.firstRunModuleRequired')}</span>
                          ) : null}
                        </span>
                        {aboutKey ? <span className={`${styles.hint} ${styles.modulePurpose}`}>{t(aboutKey)}</span> : null}
                        {lockedOff.includes(row.module_key) ? (
                          <span className={styles.fieldError}>{t('admin.firstRunModuleCannotRemove')}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <FirstRunStageActions>
        <button type="button" className={styles.primary} disabled={busy} onClick={onSave}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}

export function FirstRunErrorTable({
  rows,
  t,
  nothingSaved = true,
}: {
  rows: FirstRunErrorRow[];
  t: T;
  /** When false, unknown blocking errors omit “import not performed”. */
  nothingSaved?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('admin.firstRunErrRow')}</th>
            <th>{t('admin.firstRunErrApartment')}</th>
            <th>{t('admin.firstRunErrField')}</th>
            <th>{t('admin.firstRunErrReason')}</th>
            <th>{t('admin.firstRunErrSheet')}</th>
            <th>{t('admin.bookImportSeverity')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, index) => {
            const presented = presentFirstRunErrorRow(row, t, { nothingSaved });
            return (
              <tr key={`${row.sheet}-${row.row}-${row.field}-${row.reason}-${index}`}>
                <td>{presented.row}</td>
                <td>{presented.apartment}</td>
                <td>{presented.field}</td>
                <td>{presented.reason}</td>
                <td>{presented.sheet}</td>
                <td>{presented.severityLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 200 ? (
        <p className={styles.hint}>{t('admin.firstRunErrTruncated').replace('{n}', String(rows.length))}</p>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export function FirstRunBookImport({
  t,
  phase = 'objects',
  apartmentCount,
  busy,
  dry,
  errorRows,
  countMismatch,
  committed,
  objectsDone = false,
  ownersDone = false,
  ownersReachable = false,
  commitSummary,
  error,
  needsComplexFix,
  previewObjects,
  previewOwners,
  onSelectPhase,
  onDownload,
  onFile,
  onCommit,
  onContinue,
}: {
  t: T;
  /** objects = apartments step; owners = owners step (overwrite allowed). */
  phase?: 'objects' | 'owners';
  apartmentCount: string;
  busy: boolean;
  dry: {
    ok: boolean;
    newCount: number;
    existingCount: number;
    changesCount: number;
    requiresOverwriteConfirmation: boolean;
    importableCount?: number;
    clarificationCount?: number;
    blockingErrorCount?: number;
    foundApartmentCount?: number | null;
    expectedApartmentCount?: number | null;
  } | null;
  errorRows: FirstRunErrorRow[];
  countMismatch: { expected: number | null; actual: number | null } | null;
  committed: boolean;
  /** Apartments substage complete (for dual-step indicator). */
  objectsDone?: boolean;
  /** Owners substage complete. */
  ownersDone?: boolean;
  /** Owners pill clickable only when apartments are done. */
  ownersReachable?: boolean;
  /** Counts from the confirmed save response only — never from expected apartment count. */
  commitSummary: {
    clarificationCount: number;
    importableCount: number | null;
    ownerRowCount?: number | null;
    apartmentsWithOwnersCount?: number | null;
  } | null;
  error?: string | null;
  needsComplexFix: boolean;
  previewObjects?: Array<Record<string, string>>;
  previewOwners?: Array<Record<string, string>>;
  onSelectPhase?: (phase: 'objects' | 'owners') => void;
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
}) {
  const isOwners = phase === 'owners';
  const [expandedClarify, setExpandedClarify] = useState<Record<string, boolean>>({});
  const importable =
    dry && typeof dry.importableCount === 'number' ? dry.importableCount : dry ? dry.newCount : 0;
  const clarify = dry?.clarificationCount ?? 0;
  const savedClarify = commitSummary?.clarificationCount ?? 0;
  const breakdown = buildBookSectionBreakdown(previewObjects ?? []);
  const ownerRows = previewOwners?.length ?? 0;
  const ownerUnits = apartmentsWithOwnersCount(previewOwners ?? []);
  const savedOwnerRows = commitSummary?.ownerRowCount ?? ownerRows;
  const savedOwnerUnits = commitSummary?.apartmentsWithOwnersCount ?? ownerUnits;
  const found =
    dry?.foundApartmentCount ??
    (breakdown.total > 0 ? breakdown.total : countMismatch?.actual ?? null);
  const expected =
    dry?.expectedApartmentCount ??
    countMismatch?.expected ??
    (apartmentCount && apartmentCount !== '—' ? Number(apartmentCount) : null);
  const issues = buildBookPreviewIssues(errorRows, {
    objects: previewObjects,
    owners: previewOwners,
  });
  const blockingIssues = issues.filter((i) => i.severity === 'error');
  const clarifyIssues = issues.filter((i) => i.severity === 'warning');
  const clarifyGroups = groupClarifyIssuesByReason(clarifyIssues);
  const apartmentPreview = groupBookPreviewByApartment(issues);
  const apartmentCards = isOwners
    ? supplementApartmentCardsFromOwners(apartmentPreview.cards, previewOwners ?? [])
    : apartmentPreview.cards;
  const entranceGroups = groupBookApartmentCardsByEntrance(apartmentCards);
  const blocking = dry?.blockingErrorCount ?? blockingIssues.length;
  // Owners commit uses allow_overwrite — do not block the confirm button.
  const overwriteBlocked = !isOwners && dry?.requiresOverwriteConfirmation === true;
  const foundLabel =
    found != null && expected != null && Number.isFinite(expected)
      ? t('admin.bookImportSummaryFound', {
          found: String(found),
          expected: String(expected),
        })
      : t('admin.bookImportSummaryFoundOnly', {
          found: String(found ?? '—'),
        });
  const lead = isOwners
    ? t('admin.firstRunBookOwnersLead')
    : t('admin.firstRunBookObjectsLead').replace('{n}', apartmentCount);

  return (
    <FirstRunScreen
      icon={BookOpen}
      iconClass={isOwners ? 'text-indigo-700' : 'text-indigo-600'}
      title={t('admin.firstRunStagePropertyBook')}
      lead={lead}
      busy={busy}
    >
      <ol className={styles.bookSubstages} aria-label={t('admin.firstRunStagePropertyBook')}>
        <li
          className={`${styles.bookSubstage} ${!isOwners ? styles.bookSubstageCurrent : ''} ${
            objectsDone ? styles.bookSubstageDone : ''
          }`}
          aria-current={!isOwners ? 'step' : undefined}
        >
          <button
            type="button"
            className={styles.bookSubstageButton}
            disabled={busy || !isOwners}
            onClick={() => onSelectPhase?.('objects')}
          >
            <span className={styles.bookSubstageIndex}>1</span>
            <span className={styles.bookSubstageLabel}>{t('admin.firstRunBookSubstageApartments')}</span>
            {objectsDone ? <Check className={styles.bookSubstageCheck} aria-hidden="true" /> : null}
          </button>
        </li>
        <li
          className={`${styles.bookSubstage} ${isOwners ? styles.bookSubstageCurrent : ''} ${
            ownersDone ? styles.bookSubstageDone : ''
          } ${!ownersReachable ? styles.bookSubstageLocked : ''}`}
          aria-current={isOwners ? 'step' : undefined}
        >
          <button
            type="button"
            className={styles.bookSubstageButton}
            disabled={busy || isOwners || !ownersReachable}
            onClick={() => onSelectPhase?.('owners')}
          >
            <span className={styles.bookSubstageIndex}>2</span>
            <span className={styles.bookSubstageLabel}>{t('admin.firstRunBookSubstageOwners')}</span>
            {ownersDone ? <Check className={styles.bookSubstageCheck} aria-hidden="true" /> : null}
          </button>
        </li>
      </ol>
      <FirstRunStatusStack>
        {error ? (
          <FirstRunStatusBanner tone="error" title={t('admin.firstRunBookOpFailedTitle')} detail={error} />
        ) : null}
        {committed ? (
          <FirstRunStatusBanner
            tone="success"
            title={
              isOwners
                ? t('admin.firstRunBookOwnersSavedTitle')
                : t('admin.firstRunBookObjectsSavedTitle')
            }
            detail={
              isOwners
                ? undefined
                : t('admin.firstRunBookObjectsSavedDetail').replace(
                    '{n}',
                    String(commitSummary?.importableCount ?? found ?? '—'),
                  )
            }
          />
        ) : null}
        {committed && isOwners ? (
          <div className={styles.stats}>
            <Stat value={String(savedOwnerRows)} label={t('admin.firstRunBookOwnersStatRows')} />
            <Stat value={String(savedOwnerUnits)} label={t('admin.firstRunBookOwnersStatUnits')} />
          </div>
        ) : null}
        {committed && savedClarify > 0 ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunBookClarifyWarnTitle')}
            detail={t('admin.firstRunBookClarifyWarnDetail').replace('{n}', String(savedClarify))}
          />
        ) : null}
        {!committed && dry ? (
          <FirstRunStatusBanner
            tone={dry.ok ? 'success' : 'error'}
            title={dry.ok ? t('admin.firstRunBookCheckOkTitle') : t('admin.firstRunBookCheckFailTitle')}
            detail={[
              isOwners
                ? `${t('admin.firstRunBookOwnersStatRows')}: ${ownerRows} · ${t('admin.firstRunBookOwnersStatUnits')}: ${ownerUnits}`
                : foundLabel,
              dry.ok
                ? t('admin.firstRunBookCheckOkDetail', {
                    importable: String(isOwners ? ownerRows : importable),
                    clarify: String(clarify),
                  })
                : t('admin.firstRunBookCheckFailDetail', { n: String(blocking) }),
              t('admin.bookImportSummaryErrorRows', {
                errors: String(blockingIssues.reduce((n, i) => n + Math.max(i.rows.length, 1), 0)),
              }),
            ].join(' · ')}
          />
        ) : null}
        {!committed && dry?.ok && clarify > 0 ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunBookClarifyWarnTitle')}
            detail={t('admin.firstRunBookClarifyWarnDetail').replace('{n}', String(clarify))}
          />
        ) : null}
        {!committed && overwriteBlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunBookOverwriteBlockedTitle')}
            detail={t('admin.firstRunBookOverwriteBlocked')}
          />
        ) : null}
        {needsComplexFix ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunBookCountMismatchTitle')}
            detail={`${t('admin.firstRunBookCountMismatch')
              .replace('{expected}', String(countMismatch?.expected ?? apartmentCount))
              .replace('{actual}', String(countMismatch?.actual ?? '—'))} ${t('admin.firstRunBookUseBackToComplex')}`}
          />
        ) : null}
      </FirstRunStatusStack>

      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} onClick={onDownload}>
            {t('admin.firstRunBookDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <AppFilePicker
            accept=".xlsx"
            disabled={busy || committed}
            resetInputAfterChange
            hint={
              committed
                ? undefined
                : `${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`
            }
            onChange={(picked) => onFile(picked[0] ?? null)}
          />
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {dry && !committed ? (
            <div className={styles.stats}>
              {isOwners ? (
                <>
                  <Stat value={String(ownerRows)} label={t('admin.firstRunBookOwnersStatRows')} />
                  <Stat value={String(ownerUnits)} label={t('admin.firstRunBookOwnersStatUnits')} />
                  <Stat
                    value={String(blocking)}
                    label={`${t('admin.firstRunBookStatBlocking')} · ${t('admin.bookPreviewCountLabelBlockingRows')}`}
                  />
                </>
              ) : (
                <>
                  <Stat
                    value={String(found ?? importable)}
                    label={`${t('admin.firstRunBookStatImportable')} · ${t('admin.bookPreviewCountLabelApartments')}`}
                  />
                  <Stat
                    value={String(clarify)}
                    label={`${t('admin.firstRunBookStatClarify')} · ${t('admin.bookPreviewCountLabelClarifyUnits')}`}
                  />
                  <Stat
                    value={String(blocking)}
                    label={`${t('admin.firstRunBookStatBlocking')} · ${t('admin.bookPreviewCountLabelBlockingRows')}`}
                  />
                </>
              )}
            </div>
          ) : committed ? (
            <p className={styles.hint}>{t('admin.firstRunBookImportSavedHint')}</p>
          ) : (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          )}

          {dry && !committed && !isOwners && breakdown.sections.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <p className={styles.importLabel}>{t('admin.bookPreviewSectionsTitle')}</p>
              <p className={styles.hint} style={{ marginBottom: 4 }}>
                {foundLabel}
              </p>
              <p className={styles.hint}>{formatSectionCountsLine(t, breakdown)}</p>
            </div>
          ) : null}

          {dry && !committed && (apartmentCards.length > 0 || apartmentPreview.unlinked.length > 0) ? (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <p className={styles.importLabel}>{t('admin.bookPreviewAptCardsTitle')}</p>
              {entranceGroups.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  {entranceGroups.map((group) => (
                    <div key={group.key} style={{ marginBottom: 16 }}>
                      <p className={styles.importLabel} style={{ marginBottom: 8 }}>
                        {formatEntranceGroupTitle(group, t)}
                      </p>
                      <ul
                        className={styles.hint}
                        style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}
                      >
                        {group.cards.map((card) => (
                          <li
                            key={card.key}
                            style={{
                              marginBottom: 12,
                              padding: '10px 12px',
                              border: '1px solid var(--admin-border, #d8dde6)',
                              borderRadius: 8,
                            }}
                          >
                            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
                              {formatBookApartmentCardHeading(t, card)}
                            </p>
                            <div style={{ margin: 0 }}>
                              {(() => {
                                const content = presentBookApartmentCardContent(
                                  card,
                                  previewOwners ?? [],
                                  t,
                                );
                                if (content.blocks.length === 0 && !content.where) return null;
                                return (
                                  <>
                                    {content.blocks.map((block, idx) => (
                                      <div
                                        key={block.key}
                                        style={{
                                          marginBottom:
                                            idx === content.blocks.length - 1 && !content.where
                                              ? 0
                                              : 8,
                                        }}
                                      >
                                        {block.heading ? (
                                          <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                            {block.heading}
                                          </div>
                                        ) : null}
                                        {block.lines.map((line) => (
                                          <div key={`${block.key}-${line}`}>{line}</div>
                                        ))}
                                      </div>
                                    ))}
                                    {content.where ? (
                                      <div style={{ opacity: 0.85, marginTop: 4 }}>
                                        {content.where}
                                      </div>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
              {apartmentPreview.unlinked.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <p className={styles.importLabel}>{t('admin.bookPreviewUnlinkedRowsTitle')}</p>
                  <p className={styles.hint}>{t('admin.bookPreviewUnlinkedHint')}</p>
                  <ul className={styles.hint} style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {apartmentPreview.unlinked.map((row) => (
                      <li key={row.key} style={{ marginBottom: 6 }}>
                        <div>{presentBookPreviewIssue(row.issue, t)}</div>
                        <div style={{ opacity: 0.85 }}>
                          {presentBookPreviewIssueWhere(row.issue, t)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {dry && !committed && !isOwners && clarifyGroups.length > 0 && apartmentPreview.cards.length === 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <p className={styles.importLabel}>{t('admin.bookPreviewClarifyTitle')}</p>
              <p className={styles.hint}>{t('admin.bookPreviewClarifyHint')}</p>
              <div style={{ marginTop: 8 }}>
                {clarifyGroups.map((group) => {
                  const open = expandedClarify[group.reason] === true;
                  const summary = clarifyGroupSummary(group, t);
                  return (
                    <div key={`clarify-g-${group.reason}`} style={{ marginBottom: 10 }}>
                      <p className={styles.hint} style={{ marginBottom: 4 }}>
                        {summary}
                      </p>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() =>
                          setExpandedClarify((prev) => ({
                            ...prev,
                            [group.reason]: !open,
                          }))
                        }
                      >
                        {open
                          ? t('admin.bookPreviewClarifyHideApartments')
                          : t('admin.bookPreviewClarifyShowApartments')}
                      </button>
                      {open ? (
                        <ul className={styles.hint} style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {group.issues.map((issue, idx) => (
                            <li key={`clarify-${issue.reason}-${issue.apartment}-${idx}`}>
                              {presentBookPreviewIssue(issue, t)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {dry && !committed && issues.length === 0 && errorRows.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 8 }}>
              <FirstRunErrorTable rows={errorRows} t={t} />
            </div>
          ) : null}
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <FirstRunStageActions>
            {!committed ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !dry?.ok || overwriteBlocked}
                onClick={onCommit}
              >
                {busy ? t('admin.firstRunImporting') : t('admin.firstRunBookCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} disabled={busy} onClick={onContinue}>
                {isOwners ? t('admin.firstRunContinue') : t('admin.firstRunBookContinueOwners')}
              </button>
            )}
          </FirstRunStageActions>
        </div>
      </div>
    </FirstRunScreen>
  );
}

export function FirstRunMetersSelectForm({
  t,
  water,
  electricity,
  busy,
  valid,
  onWater,
  onElectricity,
  onContinue,
}: {
  t: T;
  water: boolean;
  electricity: boolean;
  busy: boolean;
  valid: boolean;
  onWater: (checked: boolean) => void;
  onElectricity: (checked: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <FirstRunScreen
      icon={Gauge}
      iconClass="text-amber-600"
      title={t('admin.firstRunMetersSelectTitle')}
      lead={t('admin.firstRunMetersSelectLead')}
      busy={busy}
    >
      <div className={styles.choices}>
        <label className={`${styles.choice} ${water ? styles.choiceOn : ''}`}>
          <input type="checkbox" checked={water} disabled={busy} onChange={(e) => onWater(e.target.checked)} />
          <Droplets className="h-4 w-4 text-sky-600" aria-hidden="true" />
          {t('admin.firstRunMetersSelectWater')}
        </label>
        <label className={`${styles.choice} ${electricity ? styles.choiceOn : ''}`}>
          <input
            type="checkbox"
            checked={electricity}
            disabled={busy}
            onChange={(e) => onElectricity(e.target.checked)}
          />
          <Zap className="h-4 w-4 text-yellow-600" aria-hidden="true" />
          {t('admin.firstRunMetersSelectElectricity')}
        </label>
      </div>
      {!valid ? <p className={styles.fieldError}>{t('admin.firstRunMetersSelectRequired')}</p> : null}
      <FirstRunStageActions>
        <button type="button" className={styles.primary} disabled={busy || !valid} onClick={onContinue}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}

function FirstRunMetersPreviewTable({
  utility,
  rows,
  t,
  locale,
  clarifyByRow,
}: {
  utility: FirstRunMeterUtility;
  rows: Record<string, string>[];
  t: T;
  locale: string;
  clarifyByRow?: Map<number, MeterClarifyItem>;
}) {
  const errorLabel = t('admin.firstRunMetersAmountError');
  const isElectricity = utility === 'electricity';
  const groups = groupMeterPreviewRowsByEntrance(rows);
  return (
    <div className={styles.tableWrap} style={{ marginTop: 8 }}>
      {groups.map((group) => (
        <div key={group.key} style={{ marginBottom: 16 }}>
          <p className={styles.importLabel} style={{ marginBottom: 8 }}>
            {formatMeterEntranceGroupTitle(
              {
                key: group.key,
                sectionCode: group.sectionCode,
                items: group.rows.map((entry) => ({
                  key: String(entry.index),
                  apartment: String(entry.row.apartment_number ?? ''),
                  sectionCode: group.sectionCode,
                  blockCode: String(entry.row.block_code ?? ''),
                  excelRow: entry.index + 2,
                  kind: 'missing_meter_and_reading' as const,
                })),
              },
              t,
            )}
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('admin.firstRunMetersColApartment')}</th>
                <th>{t('admin.firstRunMetersColMeterNumber')}</th>
                {isElectricity ? (
                  <>
                    <th>{t('admin.firstRunMetersColDay')}</th>
                    <th>{t('admin.firstRunMetersColNight')}</th>
                  </>
                ) : (
                  <th>{t('admin.firstRunMetersColReading')}</th>
                )}
                <th>{t('admin.firstRunMetersColInstalled')}</th>
                <th>{t('admin.firstRunMetersColBalance')}</th>
                <th>{t('admin.firstRunMetersStatClarify')}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map(({ row, index }) => {
                const status = meterOpeningBalanceStatus(row, { locale, errorLabel });
                const clarify = clarifyByRow?.get(index);
                return (
                  <tr key={`${row.meter_number ?? ''}-${row.apartment_number ?? ''}-${index}`}>
                    <td>{row.apartment_number?.trim() || '—'}</td>
                    <td>{row.meter_number?.trim() || '—'}</td>
                    {isElectricity ? (
                      <>
                        <td>{formatMeterReadingCell(row.initial_day_reading)}</td>
                        <td>{formatMeterReadingCell(row.initial_night_reading)}</td>
                      </>
                    ) : (
                      <td>{formatMeterReadingCell(row.initial_reading)}</td>
                    )}
                    <td>{row.installed_at?.trim() || '—'}</td>
                    <td className={status.invalid ? styles.fieldError : undefined}>
                      {presentMeterOpeningBalanceStatus(status, t)}
                    </td>
                    <td>
                      {clarify
                        ? presentMeterClarifyMessage(clarify, t)
                        : t('admin.firstRunMetersStatComplete')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function FirstRunMetersImport({
  utility,
  t,
  busy,
  dry,
  rows,
  errorRows,
  committed,
  error,
  supabase,
  tariffPrep,
  onSaveTariffPrep,
  onTariffBusy,
  tariffNavRef,
  onDownload,
  onFile,
  onCommit,
  onContinue,
}: {
  utility: FirstRunMeterUtility;
  t: T;
  busy: boolean;
  dry: {
    ok: boolean;
    rowCount: number;
    skippedExisting: number;
    deferredCount?: number;
    preservedCount?: number;
    warnings?: unknown[];
  } | null;
  rows: Record<string, string>[] | null;
  errorRows: FirstRunErrorRow[];
  committed: boolean;
  error?: string | null;
  supabase?: SupabaseClient<Database>;
  tariffPrep?: FirstRunTariffPrepMap;
  onSaveTariffPrep?: (next: FirstRunTariffPrepMap) => Promise<void>;
  onTariffBusy?: (v: boolean) => void;
  tariffNavRef?: Ref<FirstRunTariffPrepHandle>;
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
}) {
  const { locale } = useI18n();
  const title = utility === 'water' ? t('admin.firstRunStageMetersWater') : t('admin.firstRunStageMetersElectricity');
  const Icon = utility === 'water' ? Droplets : Zap;
  const iconClass = utility === 'water' ? 'text-sky-600' : 'text-yellow-600';
  const openingTotals = rows && rows.length > 0 ? summarizeMeterOpeningBalances(rows) : null;
  const tariffKey = utility === 'water' ? 'water' : 'electricity';
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared(tariffKey, tariffPrep ?? {}),
  );
  const showImportForm = openingUnlocked || committed;
  const clarify = rows && rows.length > 0 ? buildMetersOpeningClarify(utility, rows) : null;
  const deferredApartments = clarify?.deferredApartments ?? dry?.deferredCount ?? 0;
  const readyDetail = clarify ? presentMetersReadySummary(clarify, t, locale) : null;
  return (
    <FirstRunScreen
      icon={Icon}
      iconClass={iconClass}
      title={title}
      lead={
        utility === 'water'
          ? t('admin.firstRunMetersLead')
          : t('admin.firstRunMetersLeadElectricity')
      }
      busy={busy}
    >
      <FirstRunStatusStack>
        {error ? (
          <FirstRunStatusBanner tone="error" title={t('admin.firstRunMetersOpFailedTitle')} detail={error} />
        ) : null}
        {committed ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunMetersImportOkTitle')}
            detail={
              deferredApartments > 0
                ? t('admin.firstRunMetersImportOkDeferredDetail', {
                    deferredLabel: formatAptCountAfterPo(deferredApartments, t, locale),
                  })
                : t('admin.firstRunMetersImportOkDetail')
            }
          />
        ) : null}
        {!committed && dry?.ok ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunMetersReadyTitle')}
            detail={
              readyDetail ??
              t('admin.firstRunMetersDryRunOk')
                .replace('{rows}', String(dry.rowCount))
                .replace('{skipped}', String(dry.skippedExisting))
            }
          />
        ) : null}
        {!committed && dry && !dry.ok ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunMetersBlockingTitle')}
            detail={t('admin.firstRunMetersBlockingDetail')}
          />
        ) : null}
        {committed && !openingUnlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunTariffNeededAfterImportTitle')}
            detail={t('admin.firstRunTariffNeededAfterImportDetail')}
          />
        ) : null}
      </FirstRunStatusStack>
      {supabase && onSaveTariffPrep ? (
        <FirstRunTariffPrepBlock
          ref={tariffNavRef}
          tariffKey={tariffKey}
          supabase={supabase}
          t={t}
          prep={tariffPrep ?? {}}
          busy={busy}
          onBusy={onTariffBusy}
          onSavePrep={onSaveTariffPrep}
          onGateChange={(gate) => setOpeningUnlocked(gate.unlockOpening)}
        />
      ) : null}
      <p className={styles.importLabel}>{t('admin.firstRunSectionOpeningData')}</p>
      <p className={styles.hint}>{t('admin.firstRunSectionOpeningBalancesHint')}</p>
      {!showImportForm ? (
        <p className={styles.hint}>{t('admin.firstRunOpeningLockedUntilTariff')}</p>
      ) : (
      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} disabled={busy || !openingUnlocked} onClick={onDownload}>
            {t('admin.firstRunMetersDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <AppFilePicker
            accept=".xlsx"
            disabled={busy || committed || !openingUnlocked}
            resetInputAfterChange
            hint={
              committed
                ? undefined
                : `${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`
            }
            onChange={(picked) => onFile(picked[0] ?? null)}
          />
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {dry && !committed ? (
            <>
              <div className={styles.stats}>
                <Stat
                  value={String(clarify?.apartmentCount ?? dry.rowCount)}
                  label={t('admin.firstRunMetersStatApartments')}
                />
                <Stat
                  value={String(clarify?.completeApartments ?? Math.max(0, dry.rowCount - (dry.deferredCount ?? 0)))}
                  label={t('admin.firstRunMetersStatComplete')}
                />
                <Stat
                  value={String(clarify?.deferredApartments ?? dry.deferredCount ?? 0)}
                  label={t('admin.firstRunMetersStatClarify')}
                />
                <Stat value={String(dry.rowCount)} label={t('admin.firstRunMetersStatMeters')} />
                <Stat value={String(dry.skippedExisting)} label={t('admin.firstRunMetersStatSkipped')} />
                {openingTotals ? (
                  <>
                    <Stat
                      value={formatMeterMoney(openingTotals.debtTotal, locale)}
                      label={t('admin.firstRunMetersStatDebt')}
                    />
                    <Stat
                      value={formatMeterMoney(openingTotals.overpaymentTotal, locale)}
                      label={t('admin.firstRunMetersStatOverpayment')}
                    />
                  </>
                ) : null}
              </div>
              <p className={styles.hint}>{t('admin.firstRunMetersPreviewHint')}</p>
            </>
          ) : committed ? (
            <p className={styles.hint}>{t('admin.firstRunMetersImportSavedHint')}</p>
          ) : (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          )}
          {rows && rows.length > 0 && !committed ? (
            <FirstRunMetersPreviewTable
              utility={utility}
              rows={rows}
              t={t}
              locale={locale}
              clarifyByRow={
                clarify
                  ? new Map(
                      clarify.items.map((item) => [
                        Math.max(0, (item.excelRow ?? 2) - 2),
                        item,
                      ]),
                    )
                  : undefined
              }
            />
          ) : null}
          <div style={{ marginTop: 8 }}>
            {!dry?.ok && errorRows.length > 0 ? (
              <p className={styles.hint} style={{ marginBottom: 8 }}>
                {t('admin.firstRunMetersBlockingDetail')}
              </p>
            ) : null}
            <FirstRunErrorTable rows={errorRows} t={t} nothingSaved={!committed} />
          </div>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          {!openingUnlocked && !committed ? (
            <p className={styles.hint}>{t('admin.firstRunOpeningConfirmLockedWhileEditing')}</p>
          ) : null}
          <FirstRunStageActions>
            {!committed ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !dry?.ok || !openingUnlocked}
                onClick={onCommit}
              >
                {busy ? t('admin.firstRunImporting') : t('admin.firstRunMetersCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} disabled={busy || !openingUnlocked} onClick={onContinue}>
                {t('admin.firstRunContinue')}
              </button>
            )}
          </FirstRunStageActions>
        </div>
      </div>
      )}
    </FirstRunScreen>
  );
}
