'use client';

import { useI18n } from '@/i18n/I18nProvider';

export type PaymentReceiptPayFieldValues = {
  payerName: string;
  paymentMethod: string;
  /** Kept for receipt-intent API compat; always false — UI no longer offers advance. */
  isAdvance: boolean;
  externalRef: string;
};

export function PaymentReceiptPayFields({
  values,
  onChange,
  fieldClass,
  defaultPayerHint,
}: {
  values: PaymentReceiptPayFieldValues;
  onChange: (next: PaymentReceiptPayFieldValues) => void;
  fieldClass: string;
  defaultPayerHint?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <label className="block text-sm text-secondary">
        {t('receipt.payerName')}
        <input
          className={`mt-1 block w-full ${fieldClass}`}
          value={values.payerName}
          placeholder={defaultPayerHint || t('receipt.payerPlaceholder')}
          onChange={(e) => onChange({ ...values, payerName: e.target.value })}
        />
      </label>
      <label className="block text-sm text-secondary">
        {t('receipt.paymentMethod')}
        <select
          className={`mt-1 block w-full ${fieldClass}`}
          value={values.paymentMethod}
          onChange={(e) => onChange({ ...values, paymentMethod: e.target.value })}
        >
          <option value="">{t('receipt.methodUnspecified')}</option>
          <option value="cash">{t('receipt.methodCash')}</option>
          <option value="bank">{t('receipt.methodBank')}</option>
          <option value="card">{t('receipt.methodCard')}</option>
        </select>
      </label>
      <label className="block text-sm text-secondary">
        {t('receipt.externalRef')}
        <input
          className={`mt-1 block w-full ${fieldClass}`}
          value={values.externalRef}
          placeholder={t('receipt.externalRefHint')}
          onChange={(e) => onChange({ ...values, externalRef: e.target.value })}
        />
      </label>
    </div>
  );
}

export const emptyReceiptPayFields = (): PaymentReceiptPayFieldValues => ({
  payerName: '',
  paymentMethod: '',
  isAdvance: false,
  externalRef: '',
});
