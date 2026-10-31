'use client';

import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { categoryLabel, type BudgetCategory } from '@/lib/budget';
import { ownerVisibleError } from '@/lib/ownerError';
import { sofiaCurrentYear, sofiaTodayIsoDate } from '@/lib/tariffs';
import {
  defaultUkExpenseOpeningManualSourceRef,
  defaultUkExpenseOpeningTransitionDate,
  ukExpenseOpeningRequiresReceipt,
  ukExpenseOpeningYearBounds,
  validateUkExpenseOpeningManualInput,
} from '@/lib/ukExpenseOpeningManual';
import {
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminCardClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';

export function AdminUkExpenseOpeningForm({
  supabase,
  budgetCategories,
  canSubmit,
  onDone,
  onError,
  onCancel,
}: {
  supabase: SupabaseClient<Database>;
  budgetCategories: BudgetCategory[];
  canSubmit: boolean;
  onDone: () => Promise<void> | void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const year = sofiaCurrentYear();
  const bounds = ukExpenseOpeningYearBounds(year);
  const today = sofiaTodayIsoDate();

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(bounds.from);
  const [transitionDate, setTransitionDate] = useState(defaultUkExpenseOpeningTransitionDate());
  const [categoryId, setCategoryId] = useState('');
  const [sourceDocument, setSourceDocument] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceRef, setSourceRef] = useState(() =>
    defaultUkExpenseOpeningManualSourceRef({ expenseDate: bounds.from }),
  );
  const [busy, setBusy] = useState(false);

  const categoryCode = useMemo(() => {
    const row = budgetCategories.find((c) => c.id === categoryId);
    return row?.code ? String(row.code) : null;
  }, [budgetCategories, categoryId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      onError(t('admin.expOpeningAdminOnly'));
      return;
    }
    const amt = Number(String(amount).replace(',', '.'));
    const check = validateUkExpenseOpeningManualInput(
      {
        title,
        amount: amt,
        expenseDate,
        transitionDate,
        sourceRef,
        sourceDocument,
        notes,
        categoryCode,
      },
      { sofiaTodayIso: today, billingYear: year },
    );
    if (!check.ok) {
      onError(t(check.errorKey));
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc('import_uk_expense_opening_row', {
        p_source_ref: sourceRef.trim(),
        p_title: title.trim(),
        p_expense_date: expenseDate,
        p_amount: amt,
        p_transition_date: transitionDate,
        p_category_code: categoryCode,
        p_source_document: sourceDocument.trim() || null,
        p_notes: notes.trim() || null,
        p_idempotency_key: crypto.randomUUID(),
        p_batch_id: null,
      });
      if (error) throw error;
      await onDone();
    } catch (err: unknown) {
      onError(ownerVisibleError(err, t('admin.expOpeningSaveFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className={`${adminCardClass} border-accent/20 p-4 space-y-3`}
    >
      <div>
        <h3 className="text-sm font-semibold text-accent">{t('admin.expOpeningTitle')}</h3>
        <p className="mt-1 text-xs text-muted">{t('admin.expOpeningHint', { year: String(year) })}</p>
        {!ukExpenseOpeningRequiresReceipt() ? (
          <p className="mt-1 text-xs text-secondary">{t('admin.expOpeningNoReceipt')}</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs text-secondary">
          {t('admin.date')}
          <input
            type="date"
            required
            min={bounds.from}
            max={transitionDate < bounds.to ? transitionDate : bounds.to}
            className={adminFieldClass}
            value={expenseDate}
            onChange={(e) => {
              const next = e.target.value;
              setExpenseDate(next);
              setSourceRef(defaultUkExpenseOpeningManualSourceRef({ expenseDate: next }));
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary">
          {t('admin.expOpeningTransition')}
          <input
            type="date"
            required
            min={bounds.from}
            max={today}
            className={adminFieldClass}
            value={transitionDate}
            onChange={(e) => setTransitionDate(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary">
          {t('admin.expAmountPh')}
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            className={adminFieldClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary sm:col-span-2 lg:col-span-1">
          {t('admin.expBudgetCategory')}
          <select
            className={adminFieldClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t('admin.expBudgetCategoryNone')}</option>
            {budgetCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-secondary sm:col-span-2 lg:col-span-4">
          {t('admin.expTitlePh')}
          <input
            required
            className={adminFieldClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
          {t('admin.expOpeningSource')}
          <input
            required
            className={adminFieldClass}
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
          {t('admin.expOpeningSourceDoc')}
          <input
            className={adminFieldClass}
            value={sourceDocument}
            onChange={(e) => setSourceDocument(e.target.value)}
            placeholder={t('admin.expOpeningSourceDocPh')}
          />
        </label>
        <label className="grid gap-1 text-xs text-secondary sm:col-span-2 lg:col-span-4">
          {t('admin.noteOptional')}
          <input
            className={adminFieldClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <AdminPrimaryButton type="submit" disabled={busy || !canSubmit}>
          {busy ? t('common.saving') : t('admin.expOpeningSubmit')}
        </AdminPrimaryButton>
        <AdminSecondaryButton type="button" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </AdminSecondaryButton>
      </div>
    </form>
  );
}
