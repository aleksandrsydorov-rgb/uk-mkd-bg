'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminCard,
  AdminPageHeader,
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import {
  bootstrapModuleSetupAdapters,
  buildImportPreview,
  canTransitionModuleLifecycle,
  downloadModuleXlsxTemplate,
  getModuleAdapter,
  listRegisteredModuleAdapters,
  parseModuleXlsxBuffer,
  setupCompleteFromDraft,
  setupSupportsManual,
  setupSupportsXlsx,
  type ImportPreviewResult,
  type ModuleLifecycleState,
} from '@/lib/moduleCore';
import { moduleLabelMessageKey } from '@/lib/modules';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type LifecycleRow = {
  installation_key: string;
  module_key: string;
  state: string;
  setup_schema_version: string | null;
  catalog_implemented: boolean;
  building_enabled: boolean;
  last_transition_at: string;
  has_setup_draft: boolean;
};

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
};

export function AdminInitialSetup({ supabase, t }: Props) {
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  useEffect(() => {
    bootstrapModuleSetupAdapters();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_list_module_lifecycle');
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setRows((data as LifecycleRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => rows.find((r) => r.module_key === selectedKey) ?? null,
    [rows, selectedKey],
  );
  const adapter = selectedKey ? getModuleAdapter(selectedKey) : null;
  const registeredExtra = listRegisteredModuleAdapters().filter(
    (a) => !rows.some((r) => r.module_key === a.registration.moduleKey),
  );

  const labelFor = (moduleKey: string) => {
    const msg = moduleLabelMessageKey(moduleKey);
    if (msg) return t(`admin.${msg}`);
    const reg = getModuleAdapter(moduleKey)?.registration;
    if (reg?.nameKey) {
      const k = `admin.${reg.nameKey}`;
      const translated = t(k);
      if (translated !== k) return translated;
    }
    return moduleKey;
  };

  async function transition(to: ModuleLifecycleState, reason?: string) {
    if (!selectedKey) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('admin_transition_module_lifecycle', {
      p_module_key: selectedKey,
      p_to_state: to,
      p_reason: reason ?? null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function saveDraft() {
    if (!selectedKey || !adapter) return;
    setBusy(true);
    const draft = { confirmed: draftConfirmed };
    const { error: err } = await supabase.rpc('admin_save_module_setup_progress', {
      p_module_key: selectedKey,
      p_current_step: adapter.registration.setup?.steps[0]?.id ?? 'confirm',
      p_draft: draft,
      p_validation_errors: [],
      p_setup_schema_version: adapter.registration.setup?.schemaVersion ?? '1.0',
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (
      selected &&
      canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
    ) {
      await transition('SETUP_IN_PROGRESS', 'setup_draft_saved');
    } else {
      await load();
    }
  }

  async function markReady() {
    if (!selectedKey || !adapter) return;
    const complete = setupCompleteFromDraft(adapter.registration, {
      confirmed: draftConfirmed,
    });
    if (adapter.registration.requiresInitialSetup && !complete) {
      setError(t('admin.is1SetupIncomplete'));
      return;
    }
    if (selected?.state === 'SETUP_IN_PROGRESS' || selected?.state === 'SETUP_REQUIRED') {
      await transition('READY', 'setup_complete');
    } else if (selected?.state === 'DISABLED' && !adapter.registration.requiresInitialSetup) {
      await transition('READY', 'no_setup_required');
    }
  }

  async function onXlsxSelected(file: File | null) {
    setPreview(null);
    setPreviewNote(null);
    if (!file || !selectedKey || !adapter?.registration.setup?.xlsx) return;
    const schema = adapter.registration.setup.xlsx;
    const buf = await file.arrayBuffer();
    const parsed = parseModuleXlsxBuffer(buf, schema);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = buildImportPreview(parsed.rows, schema, (row) => {
      const apt = row.apartment_number?.trim();
      if (!apt) return { operation: 'error', errors: ['required:apartment_number'] };
      return { operation: 'create', matchKey: apt.toLowerCase() };
    });
    setPreview(result);

    const { data, error: err } = await supabase.rpc('admin_create_module_import_batch', {
      p_module_key: selectedKey,
      p_schema_version: schema.schemaVersion,
      p_source: 'xlsx',
      p_file_name: file.name,
      p_preview: result,
      p_row_count: result.rows.length,
      p_create_count: result.createCount,
      p_update_count: result.updateCount,
      p_skip_count: result.skipCount,
      p_error_count: result.errorCount,
      p_error_report: result.rows.filter((r) => r.errors.length).map((r) => ({
        rowNumber: r.rowNumber,
        errors: r.errors,
      })),
    });
    if (err) {
      setError(err.message);
      return;
    }
    setPreviewNote(
      t('admin.is1PreviewSaved').replace('{id}', String((data as { id?: string })?.id ?? '')),
    );
  }

  function downloadTemplate() {
    const schema = adapter?.registration.setup?.xlsx;
    if (!schema) return;
    const labels: Record<string, string> = {};
    for (const col of schema.columns) {
      labels[col.labelKey] = t(`admin.${col.labelKey}`);
    }
    downloadModuleXlsxTemplate(schema, labels, `${selectedKey ?? 'module'}-template.xlsx`);
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.is1Title')}
        secondary={t('admin.is1Lead')}
        action={
          <button type="button" className={adminBtnSecondaryClass} onClick={() => void load()} disabled={loading}>
            {t('admin.is1Refresh')}
          </button>
        }
      />

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <p className="text-sm text-secondary">{t('admin.is1CompatibilityNote')}</p>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <AdminCard>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('admin.is1ModuleList')}</h3>
          {loading ? (
            <p className="text-sm text-muted">{t('admin.loading')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.is1ColModule')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColLifecycle')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColUxEnabled')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColSetup')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.module_key}
                      className={`${adminTableRowClass} cursor-pointer ${
                        selectedKey === row.module_key ? 'bg-accent/5' : ''
                      }`}
                      onClick={() => {
                        setSelectedKey(row.module_key);
                        setPreview(null);
                        setDraftConfirmed(false);
                        setError(null);
                      }}
                    >
                      <td className={adminTableCellClass}>{labelFor(row.module_key)}</td>
                      <td className={adminTableCellClass}>
                        <code className="text-xs">{row.state}</code>
                      </td>
                      <td className={adminTableCellClass}>
                        {row.building_enabled ? t('admin.is1Yes') : t('admin.is1No')}
                      </td>
                      <td className={adminTableCellClass}>
                        {getModuleAdapter(row.module_key)?.registration.requiresInitialSetup
                          ? t('admin.is1SetupRequired')
                          : t('admin.is1SetupOptional')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {registeredExtra.length ? (
                <p className="mt-3 text-xs text-muted">
                  {t('admin.is1ExtraAdapters')}:{' '}
                  {registeredExtra.map((a) => a.registration.moduleKey).join(', ')}
                </p>
              ) : null}
            </div>
          )}
        </AdminCard>

        <AdminCard>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('admin.is1DetailTitle')}</h3>
          {!selected ? (
            <p className="text-sm text-muted">{t('admin.is1SelectModule')}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{labelFor(selected.module_key)}</div>
                <div className="text-xs text-muted">
                  <code>{selected.module_key}</code> · {selected.state}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_REQUIRED') ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('SETUP_REQUIRED')}
                  >
                    {t('admin.is1ToSetupRequired')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'READY') &&
                !adapter?.registration.requiresInitialSetup ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('READY', 'no_setup_required')}
                  >
                    {t('admin.is1MarkReady')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'ACTIVE') ? (
                  <button
                    type="button"
                    className={adminBtnPrimaryClass}
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t('admin.is1ActivateConfirm'))) return;
                      void transition('ACTIVE', 'admin_confirm_activate');
                    }}
                  >
                    {t('admin.is1Activate')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SUSPENDED') ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('SUSPENDED', 'admin_suspend')}
                  >
                    {t('admin.is1Suspend')}
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-secondary">{t('admin.is1NoUxToggleNote')}</p>

              {adapter && setupSupportsManual(adapter.registration.setup) ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="font-medium">{t('admin.is1ManualEntry')}</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftConfirmed}
                      onChange={(e) => setDraftConfirmed(e.target.checked)}
                    />
                    {t('admin.is1ManualConfirm')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={adminBtnSecondaryClass} disabled={busy} onClick={() => void saveDraft()}>
                      {t('admin.is1SaveProgress')}
                    </button>
                    <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void markReady()}>
                      {t('admin.is1CompleteSetup')}
                    </button>
                  </div>
                </div>
              ) : null}

              {adapter && setupSupportsXlsx(adapter.registration.setup) ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="font-medium">{t('admin.is1XlsxImport')}</div>
                  <button type="button" className={adminBtnSecondaryClass} onClick={downloadTemplate}>
                    {t('admin.is1DownloadTemplate')}
                  </button>
                  <input
                    className={adminFieldClass}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => void onXlsxSelected(e.target.files?.[0] ?? null)}
                  />
                  {previewNote ? <p className="text-xs text-secondary">{previewNote}</p> : null}
                  {preview ? (
                    <p className="text-xs text-muted">
                      {t('admin.is1PreviewSummary')
                        .replace('{c}', String(preview.createCount))
                        .replace('{u}', String(preview.updateCount))
                        .replace('{s}', String(preview.skipCount))
                        .replace('{e}', String(preview.errorCount))}
                    </p>
                  ) : null}
                  <p className="text-xs text-secondary">{t('admin.is1NoAutoCommit')}</p>
                </div>
              ) : null}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
