'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { Receipt } from 'lucide-react';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import {
  FirstRunTariffPrepBlock,
  type FirstRunTariffPrepHandle,
} from '@/components/admin/FirstRunTariffPrepBlock';
import styles from './FirstRunFrame.module.css';
import {
  firstRunTariffSetupStage,
  firstRunTariffStepReady,
  formatFirstRunTariffPrepSummary,
  isFirstRunTariffPrepared,
  requiredFirstRunTariffKeys,
  type FirstRunModuleChoice,
  type FirstRunStageKey,
  type FirstRunTariffKey,
  type FirstRunTariffPrepMap,
} from '@/lib/firstRun';
import { tariffBasisLabel } from '@/lib/firstRunUserMessage';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { FirstRunErrorNote } from '@/components/admin/FirstRunFinance';
import { normalizeTariffListRow, type TariffListRow } from '@/lib/tariffs';
import { useI18n } from '@/i18n/I18nProvider';

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

function labelKey(key: FirstRunTariffKey): string {
  switch (key) {
    case 'water':
      return 'admin.firstRunTariffWater';
    case 'electricity':
      return 'admin.firstRunTariffElectricity';
    case 'internet':
      return 'admin.firstRunTariffInternet';
    case 'support_fee':
      return 'admin.firstRunTariffSupportFee';
    case 'capital_repair':
      return 'admin.firstRunTariffCapitalRepair';
  }
}

export type FirstRunTariffsNavHandle = {
  persistDraft: () => Promise<boolean>;
};

export function AdminFirstRunTariffs({
  supabase,
  t,
  selection,
  prep,
  busy,
  onBusy,
  onSavePrep,
  onContinue,
  onGoToStage,
  onNavHandle,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  selection: Pick<FirstRunModuleChoice, 'water' | 'electricity'> &
    Partial<Pick<FirstRunModuleChoice, 'internet' | 'budget' | 'extra'>>;
  prep?: FirstRunTariffPrepMap;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onSavePrep: (next: FirstRunTariffPrepMap) => Promise<void>;
  onContinue: () => Promise<void>;
  onGoToStage: (stage: FirstRunStageKey) => void;
  onNavHandle?: (handle: FirstRunTariffsNavHandle | null) => void;
}) {
  const { locale } = useI18n();
  const required = useMemo(() => requiredFirstRunTariffKeys(selection), [selection]);
  const savedPrep = prep ?? {};
  const editRefs = useRef<Partial<Record<FirstRunTariffKey, FirstRunTariffPrepHandle | null>>>({});
  const [editing, setEditing] = useState<FirstRunTariffKey | null>(null);

  const [rows, setRows] = useState<TariffListRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await untyped(supabase).rpc('list_tariffs', {
      p_module_key: null,
      p_active_only: true,
      p_limit: 50,
    });
    if (error) {
      setLoadError(toUserFacingMessage(error, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
      setRows([]);
      return;
    }
    const list = Array.isArray(data)
      ? (data as Record<string, unknown>[]).map((r) => normalizeTariffListRow(r))
      : [];
    setRows(list);
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onNavHandle?.({
      persistDraft: async () => {
        if (!editing) return true;
        const handle = editRefs.current[editing];
        return (await handle?.persistDraft()) ?? true;
      },
    });
    return () => onNavHandle?.(null);
  }, [editing, onNavHandle]);

  const byKey = useMemo(() => {
    const m = new Map<string, TariffListRow>();
    for (const r of rows) m.set(r.tariff_key, r);
    return m;
  }, [rows]);

  const readyOf = useCallback(
    (key: FirstRunTariffKey) => firstRunTariffStepReady(key, byKey.get(key), savedPrep),
    [byKey, savedPrep],
  );
  const allReady = required.every((key) => readyOf(key));

  return (
    <FirstRunScreen
      icon={Receipt}
      iconClass="text-teal-700"
      title={t('admin.firstRunStageTariffs')}
      lead={t('admin.firstRunTariffsSummaryLead')}
      busy={busy}
    >
      <p className={styles.hint}>{t('admin.firstRunTariffsNoCharge')}</p>
      <p className={styles.hint}>{t('admin.firstRunTariffActivationHint')}</p>

      <ul className={styles.choices}>
        {required.map((key) => {
          const row = byKey.get(key);
          const prepared = isFirstRunTariffPrepared(key, savedPrep);
          const published = Boolean(row?.current_version_id);
          const ok = prepared || published;
          const summary = formatFirstRunTariffPrepSummary(key, savedPrep, t, locale);
          const status = prepared
            ? t('admin.firstRunTariffStatusPrepared')
            : published
              ? t('admin.firstRunTariffStatusPublished')
                  .replace('{from}', row?.current_valid_from ?? '—')
                  .replace(
                    '{basis}',
                    [
                      tariffBasisLabel(row?.current_basis_type, t),
                      row?.current_basis_date,
                      row?.current_basis_note,
                    ]
                      .filter((item) => item != null && String(item).trim().length > 0)
                      .join(' · ') || '—',
                  )
              : t('admin.firstRunTariffStatusMissing');
          const setupStage = firstRunTariffSetupStage(key);
          const showInlineEdit = editing === key;
          return (
            <li key={key} className={`${styles.stepBlock} ${styles.tariffCard} ${ok ? styles.choiceOn : ''}`}>
              <div className={styles.tariffCardBody}>
                <div>{t(labelKey(key))}</div>
                <div className={ok ? styles.okNote : styles.hint}>{status}</div>
                {summary ? <div className={styles.tariffRateSummary}>{summary}</div> : null}
                {row?.unit_code && !summary ? (
                  <div className={styles.hint}>
                    {t('admin.firstRunTariffUnitHint').replace(
                      '{unit}',
                      row.unit_code === 'm2'
                        ? `€/${t('admin.tcUnitM2')}`
                        : row.unit_code === 'm3'
                          ? `€/${t('admin.tcUnitM3')}`
                          : row.unit_code === 'kwh'
                            ? `€/${t('admin.tcUnitKwh')}`
                            : row.unit_code === 'item'
                              ? t('admin.tcUnitAptYear')
                              : row.unit_code,
                    )}
                  </div>
                ) : null}

                {showInlineEdit ? (
                  <FirstRunTariffPrepBlock
                    ref={(handle) => {
                      editRefs.current[key] = handle;
                    }}
                    tariffKey={key}
                    supabase={supabase}
                    t={t}
                    prep={savedPrep}
                    busy={busy}
                    onBusy={onBusy}
                    onSavePrep={async (next) => {
                      await onSavePrep(next);
                      await load();
                      if (isFirstRunTariffPrepared(key, next)) {
                        setEditing(null);
                      }
                    }}
                    compact
                  />
                ) : null}
              </div>

              <div className={styles.tariffCardActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => setEditing(editing === key ? null : key)}
                >
                  {editing === key ? t('admin.firstRunTariffHideEdit') : t('admin.firstRunTariffEdit')}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => onGoToStage(setupStage)}
                >
                  {t('admin.firstRunTariffGoToSetup')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {loadError ? <FirstRunErrorNote raw={loadError} t={t} /> : null}

      {allReady ? (
        <div className={styles.stepBlock}>
          <p className={styles.okNote}>{t('admin.firstRunTariffsReady')}</p>
          <FirstRunStageActions>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void onContinue()}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunTariffsContinue')}
            </button>
          </FirstRunStageActions>
        </div>
      ) : (
        <FirstRunStageActions />
      )}
    </FirstRunScreen>
  );
}
