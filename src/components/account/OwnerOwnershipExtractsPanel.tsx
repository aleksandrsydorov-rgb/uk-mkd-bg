'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRpcError } from '@/lib/ownershipChange';
import {
  downloadAttachedExtractPdf,
  generateAndAttachPropertyBookPdfs,
  type ExtractRow,
} from '@/lib/propertyBookExtract';

type HistoryPayload = {
  current_owners?: Array<Record<string, unknown>>;
  transfers?: Array<{
    id: number;
    status: string;
    change_kind?: string | null;
    change_reason?: string | null;
    legal_effective_date?: string | null;
    book_updated_at?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    document_date?: string | null;
    has_supporting_document?: boolean;
    previous_composition?: Array<Record<string, unknown>>;
    new_composition?: Array<Record<string, unknown>>;
  }>;
  corrections?: Array<{
    id: number;
    created_at: string;
    reason: string;
    has_evidence?: boolean;
  }>;
};

type Props = {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  sessionEmail: string | null;
  onError: (message: string) => void;
};

function ownerName(o: Record<string, unknown>) {
  const entity = String(o.entity_name ?? '').trim();
  if (entity) return entity;
  return [o.first_name, o.last_name].filter(Boolean).join(' ') || '—';
}

export function OwnerOwnershipExtractsPanel({
  supabase,
  propertyId,
  sessionEmail,
  onError,
}: Props) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<'idle' | 'generate' | 'certified' | 'download'>('idle');
  const [extracts, setExtracts] = useState<ExtractRow[]>([]);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [exRes, histRes] = await Promise.all([
      supabase.rpc('owner_list_property_book_extracts', { p_property_id: propertyId }),
      supabase.rpc('owner_list_ownership_history', { p_property_id: propertyId }),
    ]);
    if (exRes.error) {
      if (!isMissingRpcError(exRes.error)) onError(exRes.error.message);
    } else {
      setExtracts((exRes.data as ExtractRow[]) ?? []);
    }
    if (histRes.error) {
      if (!isMissingRpcError(histRes.error)) onError(histRes.error.message);
    } else if (histRes.data && typeof histRes.data === 'object') {
      setHistory(histRes.data as HistoryPayload);
    }
  }, [supabase, propertyId, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleGenerate() {
    setBusy('generate');
    setStatusMsg(t('xfer.extractGenerating'));
    try {
      const result = await generateAndAttachPropertyBookPdfs({
        supabase,
        propertyId,
        sessionEmail,
      });
      setStatusMsg(
        t('xfer.extractGenerated', {
          n: result.base_number,
          count: String(result.attached.length),
        })
      );
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errExtract'));
      setStatusMsg(null);
    } finally {
      setBusy('idle');
    }
  }

  async function handleCertified() {
    setBusy('certified');
    try {
      const { error } = await supabase.rpc('owner_request_certified_extract', {
        p_property_id: propertyId,
        p_note: null,
      });
      if (error) throw error;
      setStatusMsg(t('xfer.certifiedRequested'));
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errExtract'));
    } finally {
      setBusy('idle');
    }
  }

  async function handleDownload(id: number) {
    setBusy('download');
    try {
      await downloadAttachedExtractPdf({ supabase, extractId: id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PDF_NOT_ATTACHED') {
        onError(t('xfer.errPdfNotAttached'));
      } else if (isMissingRpcError(err)) {
        onError(t('xfer.errMigrationRequired'));
      } else {
        onError(err instanceof Error ? err.message : t('xfer.errExtract'));
      }
    } finally {
      setBusy('idle');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background px-3 py-3 space-y-4">
      <div className="text-sm font-medium text-foreground">{t('xfer.extractTitle')}</div>
      <p className="text-xs text-muted">{t('xfer.extractLeadStage4')}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== 'idle'}
          onClick={() => void handleGenerate()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === 'generate' ? t('common.preparingPdf') : t('xfer.generateExtractPdf')}
        </button>
        <button
          type="button"
          disabled={busy !== 'idle'}
          onClick={() => void handleCertified()}
          className="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-foreground disabled:opacity-50"
        >
          {busy === 'certified' ? t('common.saving') : t('xfer.requestCertified')}
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-accent/25 bg-accent-bg px-3 py-2 text-xs text-accent">
          {statusMsg}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs text-muted">{t('xfer.ownershipHistory')}</div>
        {history?.current_owners && history.current_owners.length > 0 && (
          <ul className="space-y-1 text-xs text-secondary">
            {history.current_owners.map((o, i) => (
              <li key={i}>
                {ownerName(o)}
                {o.ownership_share_percent != null ? ` · ${String(o.ownership_share_percent)}%` : ''}
                {o.ideal_parts_percent != null
                  ? ` · ${t('xfer.idealParts')}: ${String(o.ideal_parts_percent)}`
                  : ''}
              </li>
            ))}
          </ul>
        )}
        {(history?.transfers ?? []).slice(0, 8).map((tr) => (
          <div key={tr.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-secondary">
            <div>
              {tr.change_reason || tr.change_kind || '—'} · {tr.status}
            </div>
            <div className="text-muted">
              {t('xfer.legalDate')}: {tr.legal_effective_date || '—'}
              {' · '}
              {t('xfer.bookUpdated')}:{' '}
              {tr.book_updated_at ? formatOwnerDateTime(tr.book_updated_at, locale) : '—'}
            </div>
            {(tr.document_type || tr.document_number) && (
              <div className="text-muted">
                {tr.document_type} {tr.document_number}
                {tr.document_date ? ` · ${tr.document_date}` : ''}
                {tr.has_supporting_document ? ` · ${t('xfer.docOnFile')}` : ''}
              </div>
            )}
          </div>
        ))}
        {(history?.corrections ?? []).slice(0, 5).map((c) => (
          <div key={`c-${c.id}`} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-secondary">
            {t('xfer.reasonCorrection')}: {c.reason}
            <div className="text-muted">{formatOwnerDateTime(c.created_at, locale)}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted">{t('xfer.extractArchive')}</div>
        {extracts.length === 0 ? (
          <div className="text-xs text-muted">{t('xfer.noExtracts')}</div>
        ) : (
          extracts.map((ex) => (
            <div
              key={ex.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
            >
              <div className="text-secondary">
                <div className="font-medium text-foreground">{ex.extract_number}</div>
                <div>
                  {ex.locale.toUpperCase()} ·{' '}
                  {ex.extract_kind === 'certified_request'
                    ? t('xfer.certifiedLabel')
                    : t('xfer.informational')}
                  {' · '}
                  {ex.has_pdf ? t('xfer.pdfReady') : t('xfer.pdfNotAttached')}
                  {ex.certified_request_status
                    ? ` · ${ex.certified_request_status}`
                    : ''}
                  {ex.is_signed ? '' : ` · ${t('xfer.unsigned')}`}
                </div>
                <div className="text-muted">{formatOwnerDateTime(ex.generated_at, locale)}</div>
              </div>
              {ex.has_pdf && (
                <button
                  type="button"
                  disabled={busy !== 'idle'}
                  onClick={() => void handleDownload(ex.id)}
                  className="rounded-lg border border-accent/25 bg-accent-bg px-3 py-1.5 text-xs text-accent"
                >
                  {t('common.downloadPdf')}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
