'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  firstRunTariffStepReady,
  formatFirstRunTariffPrepSummary,
  isFirstRunTariffPrepared,
  type FirstRunAnnualTariffPrep,
  type FirstRunElectricityTariffPrep,
  type FirstRunInternetTariffPrep,
  type FirstRunTariffKey,
  type FirstRunTariffPrepMap,
  type FirstRunWaterTariffPrep,
} from '@/lib/firstRun';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { normalizeTariffListRow, sofiaTodayIsoDate, type TariffListRow } from '@/lib/tariffs';
import { FirstRunStatusBanner } from '@/components/admin/FirstRunStatusBanner';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './FirstRunFrame.module.css';

type T = (key: string) => string;

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

type DecisionOption = { id: string; decision_number: string; title: string };

type AnnualForm = {
  rate: string;
  rate_legal: string;
  basis_mode: 'external_decision' | 'general_meeting';
  decision_id: string;
  basis_reference: string;
  basis_date: string;
  basis_note: string;
};

type UtilityForm = {
  rate: string;
  day: string;
  night: string;
  package_30: string;
  basis_reference: string;
  basis_date: string;
  basis_note: string;
};

export type FirstRunTariffPrepHandle = {
  /** Persist current form into tariff_prep when values look complete enough; returns false if user should confirm leave. */
  persistDraft: () => Promise<boolean>;
  /** True while the operator is editing an already prepared tariff. */
  isEditing: () => boolean;
};

export type FirstRunTariffGate = {
  prepared: boolean;
  editing: boolean;
  /** Import / opening confirmations may proceed only when prepared and not editing. */
  unlockOpening: boolean;
};

function emptyAnnual(today: string): AnnualForm {
  return {
    rate: '',
    rate_legal: '',
    basis_mode: 'external_decision',
    decision_id: '',
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  };
}

function emptyUtility(today: string): UtilityForm {
  return {
    rate: '',
    day: '',
    night: '',
    package_30: '',
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  };
}

function hasAnyInput(key: FirstRunTariffKey, annual: AnnualForm, utility: UtilityForm): boolean {
  if (key === 'support_fee' || key === 'capital_repair') {
    return Boolean(
      annual.rate.trim() ||
        annual.rate_legal.trim() ||
        annual.basis_reference.trim() ||
        annual.basis_note.trim() ||
        annual.decision_id,
    );
  }
  if (key === 'water') {
    return Boolean(utility.rate.trim() || utility.basis_reference.trim() || utility.basis_note.trim());
  }
  if (key === 'electricity') {
    return Boolean(
      utility.day.trim() || utility.night.trim() || utility.basis_reference.trim() || utility.basis_note.trim(),
    );
  }
  return Boolean(
    utility.package_30.trim() ||
      utility.day.trim() ||
      utility.basis_reference.trim() ||
      utility.basis_note.trim(),
  );
}

function buildPrepItem(
  key: FirstRunTariffKey,
  annual: AnnualForm,
  utility: UtilityForm,
  t: T,
): FirstRunAnnualTariffPrep | FirstRunWaterTariffPrep | FirstRunElectricityTariffPrep | FirstRunInternetTariffPrep {
  if (key === 'support_fee' || key === 'capital_repair') {
    const rate = Number(annual.rate);
    const rateLegal = Number(annual.rate_legal.trim() || annual.rate);
    if (!(rate > 0) || !(rateLegal > 0)) throw new Error(t('admin.tcErrRate'));
    if (!annual.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
    if (!annual.basis_date) throw new Error(t('admin.tcErrBasisDate'));
    if (annual.basis_mode === 'external_decision' && !annual.basis_reference.trim()) {
      throw new Error(t('admin.tcErrBasisReference'));
    }
    if (annual.basis_mode === 'general_meeting' && !annual.decision_id) {
      throw new Error(t('admin.tcDecisionPick'));
    }
    return {
      rate_natural: rate,
      rate_legal: rateLegal,
      basis_type: annual.basis_mode,
      basis_reference: annual.basis_mode === 'external_decision' ? annual.basis_reference.trim() : null,
      basis_date: annual.basis_date,
      basis_note: annual.basis_note.trim(),
      decision_id: annual.basis_mode === 'general_meeting' ? annual.decision_id : null,
    };
  }
  if (key === 'water') {
    const rate = Number(utility.rate);
    if (!(rate >= 0) || Number.isNaN(rate)) throw new Error(t('admin.tcErrRate'));
    if (!utility.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
    if (!utility.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
    return {
      rate,
      basis_type: 'supplier_notice',
      basis_reference: utility.basis_reference.trim(),
      basis_date: utility.basis_date || null,
      basis_note: utility.basis_note.trim(),
    };
  }
  if (key === 'internet') {
    const package30 = Number(utility.package_30);
    const day = Number(utility.day);
    if (Number.isNaN(package30) || Number.isNaN(day) || package30 < 0 || day < 0) {
      throw new Error(t('admin.tcErrRate'));
    }
    if (!utility.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
    if (!utility.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
    return {
      package_30: package30,
      day,
      basis_type: 'supplier_notice',
      basis_reference: utility.basis_reference.trim(),
      basis_date: utility.basis_date || null,
      basis_note: utility.basis_note.trim(),
    };
  }
  const day = Number(utility.day);
  const night = Number(utility.night);
  if (Number.isNaN(day) || Number.isNaN(night) || day < 0 || night < 0) {
    throw new Error(t('admin.tcErrRate'));
  }
  if (!utility.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
  if (!utility.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
  return {
    day,
    night,
    basis_type: 'supplier_notice',
    basis_reference: utility.basis_reference.trim(),
    basis_date: utility.basis_date || null,
    basis_note: utility.basis_note.trim(),
  };
}

function applyPrepToForms(
  tariffKey: FirstRunTariffKey,
  item: FirstRunTariffPrepMap[FirstRunTariffKey] | undefined,
  today: string,
  setAnnual: (v: AnnualForm) => void,
  setUtility: (v: UtilityForm) => void,
) {
  if (!item) {
    setAnnual(emptyAnnual(today));
    setUtility(emptyUtility(today));
    return;
  }
  if (tariffKey === 'support_fee' || tariffKey === 'capital_repair') {
    if (!('rate_natural' in item)) return;
    setAnnual({
      rate: String(item.rate_natural),
      rate_legal: String(item.rate_legal),
      basis_mode: item.basis_type,
      decision_id: item.decision_id ?? '',
      basis_reference: item.basis_reference ?? '',
      basis_date: item.basis_date,
      basis_note: item.basis_note,
    });
    return;
  }
  if (tariffKey === 'water' && 'rate' in item) {
    setUtility({
      ...emptyUtility(today),
      rate: String(item.rate),
      basis_reference: item.basis_reference,
      basis_date: item.basis_date ?? today,
      basis_note: item.basis_note,
    });
    return;
  }
  if (tariffKey === 'electricity' && 'day' in item && 'night' in item) {
    setUtility({
      ...emptyUtility(today),
      day: String(item.day),
      night: String(item.night),
      basis_reference: item.basis_reference,
      basis_date: item.basis_date ?? today,
      basis_note: item.basis_note,
    });
    return;
  }
  if (tariffKey === 'internet' && 'package_30' in item) {
    setUtility({
      ...emptyUtility(today),
      package_30: String(item.package_30),
      day: String(item.day),
      basis_reference: item.basis_reference,
      basis_date: item.basis_date ?? today,
      basis_note: item.basis_note,
    });
  }
}

export const FirstRunTariffPrepBlock = forwardRef<
  FirstRunTariffPrepHandle,
  {
    tariffKey: FirstRunTariffKey;
    supabase: SupabaseClient<Database>;
    t: T;
    prep: FirstRunTariffPrepMap;
    busy: boolean;
    onBusy?: (v: boolean) => void;
    onSavePrep: (next: FirstRunTariffPrepMap) => Promise<void>;
    compact?: boolean;
    /** Notify parent when prepared/editing gate for opening data changes. */
    onGateChange?: (gate: FirstRunTariffGate) => void;
  }
>(function FirstRunTariffPrepBlock(
  { tariffKey, supabase, t, prep, busy, onBusy, onSavePrep, compact, onGateChange },
  ref,
) {
  const { locale } = useI18n();
  const today = sofiaTodayIsoDate();
  const savedItem = prep[tariffKey];
  const savedSnap = useMemo(() => JSON.stringify(savedItem ?? null), [savedItem]);
  const prepared = isFirstRunTariffPrepared(tariffKey, prep);

  const [row, setRow] = useState<TariffListRow | null>(null);
  const [decisions, setDecisions] = useState<DecisionOption[]>([]);
  const [annual, setAnnual] = useState<AnnualForm>(() => emptyAnnual(today));
  const [utility, setUtility] = useState<UtilityForm>(() => emptyUtility(today));
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(() => !prepared);
  const dirtyRef = useRef(false);

  const loadCatalog = useCallback(async () => {
    const { data } = await untyped(supabase).rpc('list_tariffs', {
      p_module_key: null,
      p_active_only: true,
      p_limit: 50,
    });
    const list = Array.isArray(data)
      ? (data as Record<string, unknown>[]).map((r) => normalizeTariffListRow(r))
      : [];
    setRow(list.find((r) => r.tariff_key === tariffKey) ?? null);
    try {
      const { data: dec } = await supabase
        .from('general_meeting_decisions')
        .select('id, decision_number, title')
        .order('decision_number', { ascending: false })
        .limit(50);
      setDecisions(
        ((dec as DecisionOption[] | null) ?? []).map((d) => ({
          id: String(d.id),
          decision_number: String(d.decision_number ?? ''),
          title: String(d.title ?? ''),
        })),
      );
    } catch {
      setDecisions([]);
    }
  }, [supabase, tariffKey]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    dirtyRef.current = false;
    applyPrepToForms(tariffKey, prep[tariffKey], today, setAnnual, setUtility);
    setEditing(!isFirstRunTariffPrepared(tariffKey, prep));
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tariffKey, savedSnap, today]);

  const onGateChangeRef = useRef(onGateChange);
  onGateChangeRef.current = onGateChange;
  useLayoutEffect(() => {
    onGateChangeRef.current?.({
      prepared,
      editing,
      unlockOpening: prepared && !editing,
    });
  }, [prepared, editing]);

  const ready = firstRunTariffStepReady(tariffKey, row, prep);
  const published = Boolean(row?.current_version_id);
  const showForm = !prepared || editing;
  const summary = formatFirstRunTariffPrepSummary(tariffKey, prep, t, locale);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const save = useCallback(
    async (opts?: { quiet?: boolean }): Promise<boolean> => {
      setFormError(null);
      try {
        if (!row) {
          setFormError(t('admin.firstRunTariffCatalogMissing'));
          return false;
        }
        onBusy?.(true);
        const item = buildPrepItem(tariffKey, annual, utility, t);
        const next: FirstRunTariffPrepMap = { ...prep, [tariffKey]: item };
        await onSavePrep(next);
        dirtyRef.current = false;
        setEditing(false);
        await loadCatalog();
        return true;
      } catch (err: unknown) {
        // Keep typed values so the operator can fix the cause and retry.
        setFormError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
        return false;
      } finally {
        onBusy?.(false);
      }
    },
    [annual, loadCatalog, onBusy, onSavePrep, prep, row, t, tariffKey, utility],
  );

  const cancelEdit = () => {
    applyPrepToForms(tariffKey, prep[tariffKey], today, setAnnual, setUtility);
    dirtyRef.current = false;
    setFormError(null);
    setEditing(false);
  };

  useImperativeHandle(
    ref,
    () => ({
      persistDraft: async () => {
        if (!dirtyRef.current) return true;
        if (!hasAnyInput(tariffKey, annual, utility)) return true;
        const ok = await save({ quiet: true });
        return ok;
      },
      isEditing: () => editing,
    }),
    [annual, editing, save, tariffKey, utility],
  );

  const title =
    tariffKey === 'electricity' ? t('admin.firstRunTariffElectricityNaturalTitle') : t('admin.firstRunTariffCurrentTitle');

  const unitLabel =
    tariffKey === 'water'
      ? `€/${t('admin.tcUnitM3')}`
      : tariffKey === 'electricity'
        ? `€/${t('admin.tcUnitKwh')}`
        : tariffKey === 'support_fee' || tariffKey === 'capital_repair'
          ? t('admin.perSqmYear')
          : tariffKey === 'internet'
              ? '€'
              : null;
  const unitHint = unitLabel ? t('admin.firstRunTariffUnitHint').replace('{unit}', unitLabel) : null;

  return (
    <div className={styles.stepBlock}>
      <p className={styles.importLabel}>{title}</p>
      <p className={styles.hint}>{t('admin.firstRunTariffActivationHint')}</p>
      {!prepared && !published ? <p className={styles.hint}>{t('admin.firstRunTariffStatusMissing')}</p> : null}
      {unitHint && showForm ? <p className={styles.hint}>{unitHint}</p> : null}

      {tariffKey === 'electricity' ? (
        <p className={styles.hint}>{t('admin.firstRunTariffElectricityLegalNote')}</p>
      ) : null}

      {prepared && !editing ? (
        <>
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunTariffPreparedBanner')}
            detail={summary ?? undefined}
          />
          <div className={styles.actions} style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                setEditing(true);
                setFormError(null);
              }}
            >
              {t('admin.firstRunTariffChange')}
            </button>
          </div>
          {!compact ? <p className={styles.hint}>{t('admin.firstRunTariffNoChargeLocal')}</p> : null}
        </>
      ) : null}

      {showForm ? (
        <form
          className={styles.formGrid}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {tariffKey === 'support_fee' || tariffKey === 'capital_repair' ? (
            <>
              <label className={styles.field}>
                {tariffKey === 'capital_repair'
                  ? t('admin.tcCapitalRateNatural')
                  : t('admin.tcSupportRateNatural')}
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={annual.rate}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setAnnual({ ...annual, rate: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>
                  {tariffKey === 'capital_repair'
                    ? t('admin.tcCapitalRateUnitHint')
                    : t('admin.tcSupportRateUnitHint')}
                </span>
              </label>
              <label className={styles.field}>
                {tariffKey === 'capital_repair'
                  ? t('admin.tcCapitalRateLegal')
                  : t('admin.tcSupportRateLegal')}
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={annual.rate_legal}
                  disabled={busy}
                  placeholder={annual.rate || undefined}
                  onChange={(e) => {
                    markDirty();
                    setAnnual({ ...annual, rate_legal: e.target.value });
                  }}
                />
                <span className={styles.hint}>{t('admin.tcRateLegalHint')}</span>
              </label>
              <label className={`${styles.field} ${styles.span2}`}>
                {t('admin.tcBasis')}
                <select
                  className={styles.input}
                  value={annual.basis_mode}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setAnnual({
                      ...annual,
                      basis_mode: e.target.value as AnnualForm['basis_mode'],
                    });
                  }}
                >
                  <option value="external_decision">{t('admin.tcBasisExternal')}</option>
                  {decisions.length > 0 ? <option value="general_meeting">{t('admin.tcBasisGm')}</option> : null}
                </select>
                <span className={styles.hint}>{t('admin.tcBasisModeHint')}</span>
              </label>
              {annual.basis_mode === 'general_meeting' && decisions.length > 0 ? (
                <label className={`${styles.field} ${styles.span2}`}>
                  {t('admin.tcDecision')}
                  <select
                    className={styles.input}
                    value={annual.decision_id}
                    disabled={busy}
                    onChange={(e) => {
                      markDirty();
                      setAnnual({ ...annual, decision_id: e.target.value });
                    }}
                    required
                  >
                    <option value="">{t('admin.tcDecisionPick')}</option>
                    {decisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.decision_number} · {d.title}
                      </option>
                    ))}
                  </select>
                  <span className={styles.hint}>{t('admin.tcDecisionHint')}</span>
                </label>
              ) : (
                <label className={`${styles.field} ${styles.span2}`}>
                  {t('admin.tcBasisReference')}
                  <input
                    className={styles.input}
                    value={annual.basis_reference}
                    disabled={busy}
                    onChange={(e) => {
                      markDirty();
                      setAnnual({ ...annual, basis_reference: e.target.value });
                    }}
                    required
                  />
                  <span className={styles.hint}>
                    {annual.basis_mode === 'general_meeting'
                      ? t('admin.tcBasisReferenceHintGm')
                      : t('admin.tcBasisReferenceHintExternal')}
                  </span>
                </label>
              )}
              <label className={styles.field}>
                {t('admin.tcBasisDate')}
                <input
                  className={styles.input}
                  type="date"
                  value={annual.basis_date}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setAnnual({ ...annual, basis_date: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.tcBasisDateHint')}</span>
              </label>
              <label className={`${styles.field} ${styles.span2}`}>
                {t('admin.tcBasisNote')}
                <input
                  className={styles.input}
                  value={annual.basis_note}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setAnnual({ ...annual, basis_note: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.tcBasisNoteHintAnnual')}</span>
              </label>
            </>
          ) : null}

          {tariffKey === 'water' ? (
            <label className={styles.field}>
              {t('admin.firstRunTariffWaterRate')}
              <input
                className={styles.input}
                type="number"
                step="0.0001"
                min="0"
                value={utility.rate}
                disabled={busy}
                onChange={(e) => {
                  markDirty();
                  setUtility({ ...utility, rate: e.target.value });
                }}
                required
              />
              <span className={styles.hint}>{t('admin.firstRunTariffWaterSingle')}</span>
            </label>
          ) : null}

          {tariffKey === 'electricity' ? (
            <>
              <label className={styles.field}>
                {t('admin.firstRunTariffElectricityDay')}
                <input
                  className={styles.input}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.day}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, day: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.firstRunTariffElectricityDayHint')}</span>
              </label>
              <label className={styles.field}>
                {t('admin.firstRunTariffElectricityNight')}
                <input
                  className={styles.input}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.night}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, night: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.firstRunTariffElectricityNightHint')}</span>
              </label>
            </>
          ) : null}

          {tariffKey === 'internet' ? (
            <>
              <label className={styles.field}>
                {t('admin.internetTariffPackage30')}
                <span className={styles.hint}>{t('admin.internetTariffCalendarHint')}</span>
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={utility.package_30}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, package_30: e.target.value });
                  }}
                  required
                />
              </label>
              <label className={styles.field}>
                {t('admin.internetTariffDay24')}
                <span className={styles.hint}>{t('admin.internetTariffCalendarHint')}</span>
                <input
                  className={styles.input}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.day}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, day: e.target.value });
                  }}
                  required
                />
              </label>
            </>
          ) : null}

          {tariffKey === 'water' || tariffKey === 'electricity' || tariffKey === 'internet' ? (
            <>
              <label className={styles.field}>
                {t('admin.tcSupplierRef')}
                <input
                  className={styles.input}
                  value={utility.basis_reference}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, basis_reference: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.tcSupplierRefHint')}</span>
              </label>
              <label className={styles.field}>
                {t('admin.tcBasisDate')}
                <input
                  className={styles.input}
                  type="date"
                  value={utility.basis_date}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, basis_date: e.target.value });
                  }}
                />
                <span className={styles.hint}>{t('admin.tcBasisDateOptionalHint')}</span>
              </label>
              <label className={`${styles.field} ${styles.span2}`}>
                {t('admin.tcBasisNote')}
                <input
                  className={styles.input}
                  value={utility.basis_note}
                  disabled={busy}
                  onChange={(e) => {
                    markDirty();
                    setUtility({ ...utility, basis_note: e.target.value });
                  }}
                  required
                />
                <span className={styles.hint}>{t('admin.tcBasisNoteHintUtility')}</span>
              </label>
            </>
          ) : null}

          <div className={`${styles.actions} ${styles.span2}`}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunTariffConfirm')}
            </button>
            {prepared && editing ? (
              <button type="button" className={styles.secondary} disabled={busy} onClick={cancelEdit}>
                {t('admin.firstRunTariffCancelEdit')}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {formError ? <p className={styles.fieldError}>{formError}</p> : null}
      {showForm && !compact ? <p className={styles.hint}>{t('admin.firstRunTariffNoChargeLocal')}</p> : null}
      {ready ? null : null}
    </div>
  );
});
