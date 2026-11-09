'use client';

import { useCallback, useEffect, useState } from 'react';
import { toUserFacingMessage } from '@/lib/userFacingError';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  complexFormToPayload,
  complexToForm,
  parseFirstRunState,
  validateComplexFormWithIban,
  type FirstRunComplex,
  type FirstRunComplexForm,
} from '@/lib/firstRun';
import { isValidIban } from '@/lib/iban';
import { FirstRunComplexProfile } from '@/components/admin/FirstRunComplexProfile';
import { adminCardClass } from '@/components/admin/AdminUi';

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export function AdminBuildingProfile({
  supabase,
  t,
  canEdit,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string, vars?: Record<string, string>) => string;
  canEdit: boolean;
}) {
  const [form, setForm] = useState<FirstRunComplexForm>(() => complexToForm(null));
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const rpc = supabase as unknown as UntypedRpc;
      const { data, error: rpcErr } = await rpc.rpc('admin_get_building_profile');
      if (rpcErr) throw rpcErr;
      const complex = (data ?? {}) as FirstRunComplex;
      setForm(complexToForm(complex));
    } catch (err: unknown) {
      // Fallback through first-run state if profile RPC unavailable mid-deploy.
      try {
        const { data } = await (supabase as unknown as UntypedRpc).rpc('admin_get_first_run_state');
        const state = parseFirstRunState(data);
        setForm(complexToForm(state?.complex ?? null));
      } catch {
        setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      }
    } finally {
      setBusy(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    if (!canEdit) {
      setError(t('admin.buildingProfileNoAccess'));
      return;
    }
    const errs = validateComplexFormWithIban(form, isValidIban);
    setFormErrors(errs);
    if (errs.length > 0) {
      setError(t('admin.firstRunComplexInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { error: rpcErr } = await (supabase as unknown as UntypedRpc).rpc('admin_update_building_profile', {
        p_complex: complexFormToPayload(form),
      });
      if (rpcErr) throw rpcErr;
      setNote(t('admin.buildingProfileSaved'));
      await load();
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className={`${adminCardClass} p-4`}>
        <p className="text-sm text-secondary">{t('admin.buildingProfileNoAccess')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {note ? <p className="text-sm text-secondary">{note}</p> : null}
      <FirstRunComplexProfile
        t={t}
        form={form}
        formErrors={formErrors}
        busy={busy}
        onChange={setForm}
        onSave={() => void onSave()}
        saveLabel={t('admin.buildingProfileSave')}
      />
    </div>
  );
}
