'use client';

import { Building2 } from 'lucide-react';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import { FirstRunStatusBanner } from '@/components/admin/FirstRunStatusBanner';
import styles from './FirstRunFrame.module.css';
import {
  emptyBankAccount,
  presentComplexFormErrors,
  type FirstRunBankAccount,
  type FirstRunComplexForm,
} from '@/lib/firstRun';

type T = (key: string, vars?: Record<string, string>) => string;

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`${styles.field}${wide ? ` ${styles.span2}` : ''}`}>
      <span>{label}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}

export function FirstRunComplexProfile({
  t,
  form,
  formErrors,
  busy,
  onChange,
  onSave,
  saveLabel,
}: {
  t: T;
  form: FirstRunComplexForm;
  formErrors: string[];
  busy: boolean;
  onChange: (next: FirstRunComplexForm) => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const err = (key: string) => (formErrors.includes(key) ? t(`admin.firstRunComplexErr_${key}`) : null);

  function setBank(index: number, patch: Partial<FirstRunBankAccount>) {
    const next = form.bank_accounts.map((row, i) => {
      if (i !== index) {
        if (patch.is_primary === true) return { ...row, is_primary: false };
        return row;
      }
      return { ...row, ...patch };
    });
    onChange({ ...form, bank_accounts: next });
  }

  return (
    <FirstRunScreen
      icon={Building2}
      iconClass="text-teal-700"
      title={t('admin.firstRunComplexTitle')}
      lead={t('admin.firstRunComplexLead')}
      busy={busy}
    >
      {formErrors.length > 0 ? (
        <FirstRunStatusBanner
          tone="error"
          title={t('admin.firstRunComplexInvalid')}
          detail={presentComplexFormErrors(formErrors, t)}
        />
      ) : null}
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunGroupComplex')}</h3>
        <div className={styles.formGrid}>
          <Field label={t('admin.firstRunFieldName')} hint={t('admin.firstRunFieldNameHint')} error={err('display_name')} wide>
            <input
              className={styles.input}
              value={form.display_name}
              disabled={busy}
              onChange={(e) => onChange({ ...form, display_name: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldCountry')} error={err('address_country')}>
            <input
              className={styles.input}
              value={form.address_country}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address_country: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldCity')} error={err('address_city')}>
            <input
              className={styles.input}
              value={form.address_city}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address_city: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldPostal')} error={err('address_postal_code')}>
            <input
              className={styles.input}
              value={form.address_postal_code}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address_postal_code: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldStreet')} error={err('address_street')}>
            <input
              className={styles.input}
              value={form.address_street}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address_street: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldBuildingNo')} error={err('address_building_number')}>
            <input
              className={styles.input}
              value={form.address_building_number}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address_building_number: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.firstRunFieldApartmentCount')}
            hint={t('admin.firstRunFieldApartmentCountHint')}
            error={err('apartment_count')}
          >
            <input
              className={styles.input}
              inputMode="numeric"
              value={form.apartment_count}
              disabled={busy}
              onChange={(e) => onChange({ ...form, apartment_count: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldPhone')} hint={t('admin.firstRunFieldPhoneHint')}>
            <input
              className={styles.input}
              type="tel"
              value={form.contact_phone}
              disabled={busy}
              onChange={(e) => onChange({ ...form, contact_phone: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldEmail')} error={err('contact_email')} wide>
            <input
              className={styles.input}
              type="email"
              value={form.contact_email}
              disabled={busy}
              onChange={(e) => onChange({ ...form, contact_email: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunGroupMgmt')}</h3>
        <p className={styles.hint}>{t('admin.firstRunGroupMgmtHint')}</p>
        <div className={styles.formGrid}>
          <Field label={t('admin.firstRunFieldMgmtLegalName')} error={err('mgmt_legal_name')} wide>
            <input
              className={styles.input}
              value={form.mgmt_legal_name}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_legal_name: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtLegalForm')} error={err('mgmt_legal_form')}>
            <input
              className={styles.input}
              value={form.mgmt_legal_form}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_legal_form: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtRegCountry')} error={err('mgmt_registration_country')}>
            <input
              className={styles.input}
              value={form.mgmt_registration_country}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_registration_country: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.firstRunFieldMgmtRegNumber')}
            hint={t('admin.firstRunFieldMgmtRegNumberHint')}
            error={err('mgmt_registration_number')}
          >
            <input
              className={styles.input}
              value={form.mgmt_registration_number}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_registration_number: e.target.value })}
            />
          </Field>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={form.mgmt_vat_registered}
              disabled={busy}
              onChange={(e) =>
                onChange({
                  ...form,
                  mgmt_vat_registered: e.target.checked,
                  mgmt_vat_number: e.target.checked ? form.mgmt_vat_number : '',
                })
              }
            />
            <span>{t('admin.firstRunFieldMgmtVatRegistered')}</span>
          </label>
          {form.mgmt_vat_registered ? (
            <Field label={t('admin.firstRunFieldMgmtVatNumber')} error={err('mgmt_vat_number')}>
              <input
                className={styles.input}
                value={form.mgmt_vat_number}
                disabled={busy}
                onChange={(e) => onChange({ ...form, mgmt_vat_number: e.target.value })}
              />
            </Field>
          ) : null}
          <Field label={t('admin.firstRunFieldMgmtRegAddress')} error={err('mgmt_registered_address')} wide>
            <input
              className={styles.input}
              value={form.mgmt_registered_address}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_registered_address: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.firstRunFieldMgmtCorrAddress')}
            hint={t('admin.firstRunFieldMgmtCorrAddressHint')}
            wide
          >
            <input
              className={styles.input}
              value={form.mgmt_correspondence_address}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_correspondence_address: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtRepName')} error={err('mgmt_representative_name')}>
            <input
              className={styles.input}
              value={form.mgmt_representative_name}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_representative_name: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtRepTitle')}>
            <input
              className={styles.input}
              value={form.mgmt_representative_title}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_representative_title: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtPhone')} error={err('mgmt_phone')}>
            <input
              className={styles.input}
              type="tel"
              value={form.mgmt_phone}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_phone: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldMgmtEmail')} error={err('mgmt_email')}>
            <input
              className={styles.input}
              type="email"
              value={form.mgmt_email}
              disabled={busy}
              onChange={(e) => onChange({ ...form, mgmt_email: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunGroupBanks')}</h3>
        <p className={styles.hint}>{t('admin.firstRunGroupBanksHint')}</p>
        {form.bank_accounts.map((bank, index) => (
          <div key={index} className={styles.panel} style={{ marginBottom: '0.75rem' }}>
            <div className={styles.formGrid}>
              <Field label={t('admin.firstRunFieldBankPurpose')}>
                <input
                  className={styles.input}
                  value={bank.purpose}
                  disabled={busy}
                  onChange={(e) => setBank(index, { purpose: e.target.value })}
                />
              </Field>
              <Field
                label={t('admin.firstRunFieldBankHolder')}
                error={formErrors.includes(`bank_${index}_account_holder`) ? t('admin.firstRunComplexErr_bank_account_holder') : null}
              >
                <input
                  className={styles.input}
                  value={bank.account_holder}
                  disabled={busy}
                  onChange={(e) => setBank(index, { account_holder: e.target.value })}
                />
              </Field>
              <Field
                label={t('admin.firstRunFieldBankName')}
                error={formErrors.includes(`bank_${index}_bank_name`) ? t('admin.firstRunComplexErr_bank_name') : null}
              >
                <input
                  className={styles.input}
                  value={bank.bank_name}
                  disabled={busy}
                  onChange={(e) => setBank(index, { bank_name: e.target.value })}
                />
              </Field>
              <Field
                label={t('admin.firstRunFieldBankIban')}
                error={formErrors.includes(`bank_${index}_iban`) ? t('admin.firstRunComplexErr_bank_iban') : null}
              >
                <input
                  className={styles.input}
                  value={bank.iban}
                  disabled={busy}
                  onChange={(e) => setBank(index, { iban: e.target.value })}
                />
              </Field>
              <Field label={t('admin.firstRunFieldBankBic')}>
                <input
                  className={styles.input}
                  value={bank.bic_swift}
                  disabled={busy}
                  onChange={(e) => setBank(index, { bic_swift: e.target.value })}
                />
              </Field>
              <Field label={t('admin.firstRunFieldBankCurrency')}>
                <input
                  className={styles.input}
                  value={bank.currency}
                  disabled={busy}
                  onChange={(e) => setBank(index, { currency: e.target.value.toUpperCase() })}
                />
              </Field>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={bank.is_primary}
                  disabled={busy}
                  onChange={(e) => setBank(index, { is_primary: e.target.checked })}
                />
                <span>{t('admin.firstRunFieldBankPrimary')}</span>
              </label>
            </div>
            {form.bank_accounts.length > 1 ? (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() =>
                    onChange({
                      ...form,
                      bank_accounts: form.bank_accounts.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t('admin.firstRunBankRemove')}
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => onChange({ ...form, bank_accounts: [...form.bank_accounts, emptyBankAccount(false)] })}
          >
            {t('admin.firstRunBankAdd')}
          </button>
        </div>
      </div>

      <FirstRunStageActions>
        <button type="button" className={styles.primary} disabled={busy} onClick={onSave}>
          {busy ? t('admin.firstRunBusy') : saveLabel ?? t('admin.firstRunContinue')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}
