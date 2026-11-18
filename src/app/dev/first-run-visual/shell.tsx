'use client';

import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/I18nProvider';
import { AdminFirstRunWizard } from '@/components/admin/AdminFirstRunWizard';
import { FirstRunFrame, FirstRunWelcome } from '@/components/admin/FirstRunFrame';
import { AdminFirstRunBudget } from '@/components/admin/AdminFirstRunBudget';
import { AdminFirstRunTariffs } from '@/components/admin/AdminFirstRunTariffs';
import type { FirstRunTariffPrepMap } from '@/lib/firstRun';
import {
  FirstRunCapitalRepair,
  FirstRunErrorNote,
  FirstRunFinish,
  FirstRunSupportFee,
} from '@/components/admin/FirstRunFinance';
import {
  FirstRunBookImport,
  FirstRunComplexCard,
  FirstRunMetersImport,
  FirstRunMetersSelectForm,
  FirstRunModulesSelect,
} from '@/components/admin/FirstRunSteps';
import {
  complexToForm,
  emptyModuleChoice,
  visibleFirstRunStages,
  type FirstRunComplexForm,
  type FirstRunModuleChoice,
  type FirstRunStageKey,
  type FirstRunStageRow,
} from '@/lib/firstRun';
import type { BuildingModuleV2Row } from '@/lib/modules';
import type { Database } from '@/lib/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import electricity55Fixture from './electricity55.fixture.json';

const noop = () => {};

const VISUAL_MODULES: BuildingModuleV2Row[] = [
  { module_key: 'budget', enabled: true, default_name: 'Бюджет', category: 'finance', sort_order: 30, implemented: true },
  { module_key: 'uk_expenses', enabled: true, default_name: 'Расходы УК', category: 'finance', sort_order: 40, implemented: true },
  { module_key: 'tariffs', enabled: true, default_name: 'Тарифы', category: 'finance', sort_order: 5, implemented: true },
  { module_key: 'support_fee', enabled: true, default_name: 'Такса поддержки', category: 'finance', sort_order: 10, implemented: true },
  { module_key: 'capital_repair', enabled: true, default_name: 'Капитальный ремонт', category: 'finance', sort_order: 20, implemented: true },
  { module_key: 'water', enabled: true, default_name: 'Вода', category: 'utilities', sort_order: 10, implemented: true },
  { module_key: 'electricity', enabled: true, default_name: 'Электроэнергия', category: 'utilities', sort_order: 20, implemented: true },
  { module_key: 'internet', enabled: false, default_name: 'Интернет', category: 'utilities', sort_order: 30, implemented: true },
  { module_key: 'parking', enabled: false, default_name: 'Парковка', category: 'utilities', sort_order: 40, implemented: false },
  { module_key: 'requests', enabled: true, default_name: 'Заявки', category: 'communication', sort_order: 10, implemented: true },
  { module_key: 'chat', enabled: true, default_name: 'Чат', category: 'communication', sort_order: 20, implemented: true },
  { module_key: 'polls', enabled: true, default_name: 'Опросы', category: 'communication', sort_order: 30, implemented: true },
  { module_key: 'announcements', enabled: true, default_name: 'Объявления', category: 'communication', sort_order: 40, implemented: true },
  { module_key: 'service_lock', enabled: true, default_name: 'Блокировка услуг', category: 'communication', sort_order: 50, implemented: true },
  { module_key: 'property_book', enabled: true, default_name: 'Книга собственности', category: 'documents', sort_order: 5, implemented: true },
  { module_key: 'general_meeting', enabled: false, default_name: 'Общие собрания', category: 'documents', sort_order: 10, implemented: true },
  { module_key: 'building_documents', enabled: true, default_name: 'Документы', category: 'documents', sort_order: 20, implemented: true },
  { module_key: 'security', enabled: false, default_name: 'Охрана', category: 'services', sort_order: 10, implemented: true },
  { module_key: 'cleaning', enabled: false, default_name: 'Уборка', category: 'services', sort_order: 20, implemented: true },
  { module_key: 'inventory', enabled: false, default_name: 'Инвентарь', category: 'services', sort_order: 60, implemented: true },
  { module_key: 'guest_mode', enabled: true, default_name: 'Гостевой доступ', category: 'services', sort_order: 80, implemented: true },
  { module_key: 'residence_status', enabled: true, default_name: 'Статус проживания', category: 'services', sort_order: 15, implemented: true },
  { module_key: 'platform_support', enabled: true, default_name: 'Платформа', category: 'services', sort_order: 90, implemented: true },
  { module_key: 'user_activation', enabled: true, default_name: 'Активация', category: 'services', sort_order: 100, implemented: true },
  { module_key: 'rental', enabled: false, default_name: 'Аренда', category: 'commercial', sort_order: 10, implemented: false },
  { module_key: 'maintenance', enabled: false, default_name: 'Обслуживание', category: 'services', sort_order: 30, implemented: false },
];

function stageRow(key: string, status: string): FirstRunStageRow {
  return {
    stage_key: key,
    sort_order: 0,
    required: true,
    module_key: null,
    label_i18n_key: '',
    status,
    draft: {},
    completed_at: status === 'complete' ? '2026-11-02T00:00:00.000Z' : null,
  };
}

const STAGE_BY_VIEW: Record<string, FirstRunStageKey> = {
  modules: 'modules_select',
  complex: 'complex_card',
  'complex-errors': 'complex_card',
  book: 'property_book_objects',
  'book-ok': 'property_book_objects',
  'book-warn': 'property_book_objects',
  'book-saved': 'property_book_objects',
  'meters-select': 'meters_select',
  meters: 'meters_water',
  electricity: 'meters_electricity',
  sf: 'support_fee_opening',
  'sf-error': 'support_fee_opening',
  'sf-busy': 'support_fee_opening',
  cr: 'capital_repair_opening',
  tariffs: 'tariffs',
  'tariffs-error': 'tariffs',
  'tariffs-busy': 'tariffs',
  'internet-opening': 'internet_opening',
  'internet-opening-none': 'internet_opening',
  'budget-zero': 'budget',
  'budget-long': 'budget',
  'budget-error': 'budget',
  'budget-busy': 'budget',
  complete: 'complete',
  'complete-blocked': 'complete',
  'complete-busy': 'complete',
};

const ORDER: FirstRunStageKey[] = [
  'welcome',
  'modules_select',
  'complex_card',
  'property_book',
  'meters_select',
  'meters_water',
  'meters_electricity',
  'support_fee_opening',
  'capital_repair_opening',
  'tariffs',
  'internet_opening',
  'budget',
  'uk_expenses_opening',
  'complete',
];

function tariffRow(key: string, published: boolean, note: string) {
  const annual = key === 'support_fee' || key === 'capital_repair';
  return {
    tariff_key: key,
    tariff_id: key,
    component_keys: [],
    current_version_id: published && !annual ? `ver-${key}` : null,
    nearest_future_version_id: published && annual ? `fut-${key}` : null,
    current_valid_from: published && !annual ? '2026-01-01' : null,
    nearest_future_valid_from: published && annual ? '2027-01-01' : null,
    current_basis_type: published && !annual ? 'external_decision' : null,
    nearest_future_basis_type: published && annual ? 'external_decision' : null,
    current_basis_date: published && !annual ? '2026-10-01' : null,
    nearest_future_basis_date: published && annual ? '2026-10-01' : null,
    current_basis_note: published && !annual ? note : null,
    nearest_future_basis_note: published && annual ? note : null,
  };
}

const LONG_BASIS =
  'Решение поставщика № 2026/Э-14 от 01.10.2026, приложение с длинным наименованием документа-основания';

const BUDGET_CATS = [
  {
    id: 'c1',
    code: 'cleaning',
    name_ru: 'Почистване на общите части и прилежащата територия',
    name_en: 'Cleaning of common areas and the grounds',
    name_bg: 'Почистване на общите части и прилежащата територия',
    active: true,
  },
  { id: 'c2', code: 'repairs', name_ru: 'Текущи ремонти', name_en: 'Current repairs', name_bg: 'Текущи ремонти', active: true },
  { id: 'c3', code: 'lift', name_ru: 'Асансьор', name_en: 'Lift', name_bg: 'Асансьор', active: true },
  { id: 'c4', code: 'admin', name_ru: 'Администрация', name_en: 'Administration', name_bg: 'Администрация', active: true },
];

function budgetLines(zero: boolean) {
  const amounts: Record<string, number> = zero
    ? { c1: 0, c2: 0, c3: 0, c4: 0 }
    : { c1: 1234567.89, c2: 890123.45, c3: 2400, c4: 180.5 };
  return BUDGET_CATS.map((c) => ({
    id: `line-${c.id}`,
    year_id: 'year-1',
    category_id: c.id,
    category_code: c.code,
    category_name_ru: c.name_ru,
    planned_amount_eur: amounts[c.id],
    note: null,
  }));
}

/** In-memory stand-in. It never calls fetch or a Supabase host. */
function visualSupabase(view: string): SupabaseClient<Database> {
  const rpc = async (fn: string) => {
    if (view === 'tariffs-error' && fn === 'list_tariffs') {
      return { data: null, error: { message: 'list_tariffs failed' } };
    }
    if (fn === 'list_tariffs') {
      return {
        data: [
          tariffRow('water', true, LONG_BASIS),
          tariffRow('electricity', false, ''),
          tariffRow('support_fee', true, LONG_BASIS),
          tariffRow('capital_repair', true, LONG_BASIS),
        ],
        error: null,
      };
    }
    if (view === 'budget-error' && fn === 'admin_list_budget_categories') {
      return { data: null, error: { message: 'admin_list_budget_categories failed' } };
    }
    if (fn === 'admin_list_budget_categories') return { data: BUDGET_CATS, error: null };
    if (fn === 'admin_list_budget_years') {
      return {
        data: [
          {
            id: 'year-1',
            calendar_year: 2026,
            status: 'draft',
            title: null,
            decision_note: 'Протокол № 14 от 01.10.2026 с длинным названием основания',
            decision_id: null,
            published_at: null,
            adopted_at: null,
            closed_at: null,
          },
        ],
        error: null,
      };
    }
    if (fn === 'admin_list_budget_lines') {
      return { data: budgetLines(view === 'budget-zero'), error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select() {
      return chain;
    },
    order() {
      return chain;
    },
    limit: async () => ({ data: [], error: null }),
  };
  return {
    rpc,
    from() {
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

const CARD_NAV_STATE = {
  ok: true,
  installation_id: 'visual-stand',
  first_run_status: 'in_progress',
  first_run_stage: 'complex_card',
  gate_required: true,
  complex: {
    display_name: '',
    complex_name: '',
    address: '',
    address_country: '',
    address_city: '',
    address_postal_code: '',
    address_street: '',
    address_building_number: '',
    apartment_count: null,
    contact_phone: '',
    contact_email: '',
    mgmt_legal_name: '',
    mgmt_legal_form: '',
    mgmt_registration_country: '',
    mgmt_registration_number: '',
    mgmt_vat_registered: false,
    mgmt_vat_number: '',
    mgmt_registered_address: '',
    mgmt_correspondence_address: '',
    mgmt_representative_name: '',
    mgmt_representative_title: '',
    mgmt_phone: '',
    mgmt_email: '',
    bank_accounts: [],
  },
  draft: {},
  stages: [
    {
      stage_key: 'welcome',
      sort_order: 1,
      required: true,
      module_key: null,
      label_i18n_key: '',
      status: 'complete',
      draft: {},
      completed_at: '2026-11-02T00:00:00.000Z',
    },
    {
      stage_key: 'complex_card',
      sort_order: 2,
      required: true,
      module_key: null,
      label_i18n_key: '',
      status: 'pending',
      draft: {},
      completed_at: null,
    },
  ],
  completed_at: null,
};

export function FirstRunVisualShell() {
  const params = useSearchParams();
  const view = params.get('view') ?? 'welcome';
  const { t } = useI18n();
  const supabase = useMemo(() => visualSupabase(view), [view]);
  const cardNavRpc = useRef<string[]>([]);
  const [cardNavRpcCount, setCardNavRpcCount] = useState(0);
  const [tariffPrep, setTariffPrep] = useState<FirstRunTariffPrepMap>({});
  const cardNavClient = useMemo(() => {
    const rpc = async (fn: string) => {
      cardNavRpc.current.push(fn);
      setCardNavRpcCount(cardNavRpc.current.length);
      if (fn === 'admin_get_first_run_state') return { data: CARD_NAV_STATE, error: null };
      if (fn === 'get_building_modules_v2') return { data: VISUAL_MODULES, error: null };
      return { data: null, error: { message: 'stand refused' } };
    };
    const chain = {
      select() {
        return chain;
      },
      order() {
        return chain;
      },
      limit: async () => ({ data: [], error: null }),
    };
    return {
      rpc,
      from() {
        return chain;
      },
    } as unknown as SupabaseClient<Database>;
  }, []);
  const [moduleChoice, setModuleChoice] = useState(emptyModuleChoice());
  const stage: FirstRunStageKey = STAGE_BY_VIEW[view] ?? 'welcome';
  const selection: FirstRunModuleChoice =
    stage === 'meters_water'
      ? { water: true, electricity: false, internet: false, budget: false, extra: [] }
      : stage === 'meters_electricity'
        ? { water: false, electricity: true, internet: false, budget: false, extra: [] }
        : stage === 'budget'
          ? { water: false, electricity: false, internet: false, budget: true, extra: [] }
          : stage === 'internet_opening'
            ? { water: false, electricity: false, internet: true, budget: true, extra: [] }
            : stage === 'meters_select'
              ? { water: true, electricity: true, internet: false, budget: false, extra: [] }
              : emptyModuleChoice();
  const stages = visibleFirstRunStages(view === 'modules' ? moduleChoice : selection);
  const currentIndex = ORDER.indexOf(stage);
  const done = new Set(ORDER.filter((_, i) => i < currentIndex && stages.includes(_)));
  if (view === 'complete-blocked') done.delete('tariffs');
  const stageRows = stages.map((key) => stageRow(key, done.has(key) ? 'complete' : 'pending'));

  const stageLabel = (key: FirstRunStageKey) => {
    const map: Record<FirstRunStageKey, string> = {
      welcome: 'admin.firstRunStageWelcome',
      modules_select: 'admin.firstRunStageModules',
      complex_card: 'admin.firstRunStageComplex',
      property_book: 'admin.firstRunStagePropertyBook',
      property_book_objects: 'admin.firstRunStagePropertyBook',
      property_book_owners: 'admin.firstRunStagePropertyBook',
      meters_select: 'admin.firstRunStageMetersSelect',
      meters_water: 'admin.firstRunStageMetersWater',
      meters_electricity: 'admin.firstRunStageMetersElectricity',
      support_fee_opening: 'admin.firstRunStageSupportFee',
      capital_repair_opening: 'admin.firstRunStageCapitalRepair',
      tariffs: 'admin.firstRunStageTariffs',
      internet_opening: 'admin.firstRunStageInternetOpening',
      budget: 'admin.firstRunStageBudget',
      uk_expenses_opening: 'admin.firstRunStageOpeningExpenses',
      inventory_opening: 'admin.firstRunStageInventory',
      complete: 'admin.firstRunStageComplete',
    };
    return t(map[key]);
  };

  if (view === 'card-nav') {
    return (
      <main style={{ minHeight: '100vh', background: '#f3f6f5', padding: 16 }}>
        <div hidden data-rpc-count={cardNavRpcCount} data-rpc-names={cardNavRpc.current.join(' ')} />
        <AdminFirstRunWizard supabase={cardNavClient} t={t} onDone={noop} />
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: '#f3f6f5', padding: 16 }}>
      <FirstRunFrame
        t={t}
        stages={stages}
        stage={stage}
        stageRows={stageRows}
        stageLabel={stageLabel}
        initialStepsOpen={params.get('steps') === 'open'}
        showBack={view !== 'welcome'}
        onBack={noop}
      >
        {view === 'modules' ? (
          <FirstRunModulesSelect
            t={t}
            choice={moduleChoice}
            catalog={VISUAL_MODULES}
            lockedOff={[]}
            busy={false}
            onChange={setModuleChoice}
            onSave={noop}
          />
        ) : null}
        {view === 'complex' ? (
          <FirstRunComplexCard
            t={t}
            busy={false}
            formErrors={[]}
            form={
              {
                ...complexToForm(null),
                display_name: 'AMADEUS 11',
                address_country: 'България',
                address_city: 'Слънчев бряг',
                address_street: 'ул. Пример',
                address_building_number: '1',
                apartment_count: '24',
                contact_phone: '+359 88 000 0000',
                contact_email: 'office@example.test',
                mgmt_legal_name: 'УК Пример ООД',
                mgmt_registration_country: 'България',
                mgmt_registration_number: '123456789',
                mgmt_registered_address: 'София',
                mgmt_representative_name: 'Иван Иванов',
                mgmt_phone: '+359880000000',
                mgmt_email: 'uk@example.test',
              } satisfies FirstRunComplexForm
            }
            onChange={noop}
            onSave={noop}
          />
        ) : null}
        {view === 'book' || view === 'book-ok' || view === 'book-warn' || view === 'book-saved' ? (
          <FirstRunBookImport
            t={t}
            phase="objects"
            apartmentCount="24"
            busy={false}
            committed={view === 'book-saved' || view === 'book-warn'}
            commitSummary={
              view === 'book-warn'
                ? { clarificationCount: 5, importableCount: 24 }
                : view === 'book-saved'
                  ? { clarificationCount: 0, importableCount: 24 }
                  : null
            }
            error={null}
            needsComplexFix={false}
            countMismatch={null}
            dry={
              view === 'book-ok'
                ? {
                    ok: true,
                    newCount: 22,
                    existingCount: 2,
                    changesCount: 0,
                    requiresOverwriteConfirmation: false,
                    importableCount: 24,
                    clarificationCount: 0,
                    blockingErrorCount: 0,
                  }
                : view === 'book'
                  ? {
                      ok: false,
                      newCount: 2,
                      existingCount: 1,
                      changesCount: 0,
                      requiresOverwriteConfirmation: false,
                      importableCount: 0,
                      clarificationCount: 1,
                      blockingErrorCount: 2,
                    }
                  : null
            }
            errorRows={
              view === 'book'
                ? [
                    {
                      sheet: 'objects',
                      row: '4',
                      apartment: '12',
                      field: 'area_sqm',
                      reason: 'area_sqm_invalid',
                      severity: 'error',
                    },
                    {
                      sheet: 'owners',
                      row: '8',
                      apartment: '3',
                      field: 'email',
                      reason: 'owner_email_required',
                      severity: 'warning',
                    },
                    {
                      sheet: 'validation',
                      row: '8',
                      apartment: '3',
                      field: 'owners',
                      reason: 'mixed_natural_legal_forbidden',
                      severity: 'error',
                    },
                  ]
                : view === 'book-warn'
                  ? [
                      {
                        sheet: 'owners',
                        row: '8',
                        apartment: '3',
                        field: 'email',
                        reason: 'owner_email_required',
                        severity: 'warning',
                      },
                    ]
                  : []
            }
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'meters' ? (
          <FirstRunMetersImport
            utility="water"
            t={t}
            busy={false}
            committed={false}
            dry={{ ok: true, rowCount: 3, skippedExisting: 1 }}
            errorRows={[]}
            rows={[
              {
                apartment_number: '1',
                meter_number: 'W-1001',
                initial_reading: '120.5',
                installed_at: '2026-01-15',
                opening_balance_kind: 'zero',
                opening_balance_eur: '',
              },
              {
                apartment_number: '2',
                meter_number: 'W-1002',
                initial_reading: '88',
                installed_at: '2026-01-15',
                opening_balance_kind: 'debt',
                opening_balance_eur: '15.40',
              },
              {
                apartment_number: '10',
                meter_number: 'W-1010',
                initial_reading: '10',
                installed_at: '2026-01-15',
                opening_balance_kind: 'overpayment',
                opening_balance_eur: '4.20',
              },
            ]}
            supabase={supabase}
            tariffPrep={tariffPrep}
            onSaveTariffPrep={async (next) => {
              setTariffPrep(next);
            }}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'complex-errors' ? (
          <FirstRunComplexCard
            t={t}
            busy={false}
            formErrors={['display_name', 'address_country', 'apartment_count', 'mgmt_legal_name']}
            form={{
              ...complexToForm(null),
              apartment_count: '0',
              contact_phone: '+359 88 000 0000',
              contact_email: 'не адрес',
            }}
            onChange={noop}
            onSave={noop}
          />
        ) : null}
        {view === 'meters-select' ? (
          <FirstRunMetersSelectForm
            t={t}
            water={false}
            electricity={false}
            busy={false}
            valid={false}
            onWater={noop}
            onElectricity={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'electricity' ? (
          <FirstRunMetersImport
            utility="electricity"
            t={t}
            busy={false}
            committed={false}
            dry={{ ok: true, rowCount: electricity55Fixture.length, skippedExisting: 0 }}
            errorRows={[]}
            rows={electricity55Fixture as Record<string, string>[]}
            supabase={supabase}
            tariffPrep={tariffPrep}
            onSaveTariffPrep={async (next) => {
              setTariffPrep(next);
            }}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'sf' || view === 'sf-error' || view === 'sf-busy' ? (
          <FirstRunSupportFee
            t={t}
            busy={view === 'sf-busy'}
            committed={false}
            canCommit={view === 'sf'}
            note={null}
            error={view === 'sf-error' ? t('admin.firstRunSfImportFailed') : null}
            supabase={supabase}
            tariffPrep={tariffPrep}
            onSaveTariffPrep={async (next) => {
              setTariffPrep(next);
            }}
            rows={
              view === 'sf-error'
                ? [
                    {
                      apartment_number: '12',
                      section_code: 'A',
                      billing_year: '2026',
                      assessed_amount: '',
                      historically_paid_amount: '',
                      remaining_debt: 'abc',
                      opening_overpayment: '',
                      transition_date: '2026-01-01',
                      source_reference: '',
                      notes: '',
                    },
                    {
                      apartment_number: '14-А',
                      section_code: 'A',
                      billing_year: '',
                      assessed_amount: '10',
                      historically_paid_amount: '0',
                      remaining_debt: '10',
                      opening_overpayment: '0',
                      transition_date: '2026-01-01',
                      source_reference: '',
                      notes: '',
                    },
                  ]
                : [
                    {
                      apartment_number: '1',
                      section_code: 'A',
                      billing_year: '2026',
                      assessed_amount: '120',
                      historically_paid_amount: '40',
                      remaining_debt: '80',
                      opening_overpayment: '0',
                      transition_date: '2026-01-01',
                      source_reference: 'ledger',
                      notes: '',
                    },
                    {
                      apartment_number: '2',
                      section_code: 'A',
                      billing_year: '2026',
                      assessed_amount: '',
                      historically_paid_amount: '',
                      remaining_debt: '',
                      opening_overpayment: '',
                      transition_date: '2026-01-01',
                      source_reference: '',
                      notes: '',
                    },
                  ]
            }
            dry={
              view === 'sf-error'
                ? {
                    ok: false,
                    errors: [{}, {}],
                    rowCount: 4,
                    createCount: 0,
                    skippedExisting: 0,
                    debtSum: 0,
                    creditSum: 0,
                  }
                : {
                    ok: true,
                    errors: [],
                    rowCount: 24,
                    createCount: 22,
                    skippedExisting: 2,
                    debtSum: 1234567.89,
                    creditSum: 890123.45,
                  }
            }
            errorRows={
              view === 'sf-error'
                ? [
                    {
                      sheet: 'support_fee',
                      row: '6',
                      apartment: '12',
                      field: 'opening_balance_eur',
                      reason: 'Сумма долга не число',
                      severity: 'error',
                    },
                    {
                      sheet: 'support_fee',
                      row: '9',
                      apartment: '14-А',
                      field: 'billing_year',
                      reason: 'Период обязателен',
                      severity: 'error',
                    },
                  ]
                : []
            }
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'cr' ? (
          <FirstRunCapitalRepair
            t={t}
            busy={false}
            committed={false}
            canCommit
            fundOk={false}
            balance="1234567.89"
            date="2026-10-01"
            source="Банкова справка № 2026/КР-88 от 01.10.2026, дълго наименование на документа"
            notes="Начален запис на касата към датата. Не е текущ остатък на фонда."
            note={null}
            error={null}
            rows={[
              {
                apartment_number: '1',
                section_code: 'A',
                billing_year: '2025',
                assessment_title: 'Капитальный ремонт 2025',
                assessed_amount: '120',
                historically_paid_amount: '105',
                remaining_debt: '15',
                opening_overpayment: '0',
              },
              {
                apartment_number: '2',
                section_code: 'A',
                billing_year: '2025',
                assessment_title: 'Капитальный ремонт 2025',
                assessed_amount: '120',
                historically_paid_amount: '140',
                remaining_debt: '0',
                opening_overpayment: '20',
              },
              {
                apartment_number: '3',
                section_code: 'A',
                billing_year: '2025',
                assessment_title: 'Капитальный ремонт 2025',
                assessed_amount: '100',
                historically_paid_amount: '100',
                remaining_debt: '0',
                opening_overpayment: '0',
              },
            ]}
            dry={{
              ok: true,
              errors: [],
              rowCount: 24,
              createCount: 24,
              skippedExisting: 0,
              debtSum: 1234567.89,
              creditSum: 890123.45,
            }}
            errorRows={[]}
            supabase={supabase}
            tariffPrep={tariffPrep}
            onSaveTariffPrep={async (next) => {
              setTariffPrep(next);
            }}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onBalance={noop}
            onDate={noop}
            onSource={noop}
            onNotes={noop}
            onFundConfirm={noop}
            onContinue={noop}
          />
        ) : null}
        {view === 'tariffs' || view === 'tariffs-error' || view === 'tariffs-busy' ? (
          <AdminFirstRunTariffs
            supabase={supabase}
            t={t}
            selection={{ water: true, electricity: true }}
            prep={tariffPrep}
            busy={view === 'tariffs-busy'}
            onBusy={noop}
            onSavePrep={async (next) => {
              setTariffPrep(next);
            }}
            onContinue={async () => {}}
            onGoToStage={noop}
          />
        ) : null}
        {view === 'budget-zero' || view === 'budget-long' || view === 'budget-error' || view === 'budget-busy' ? (
          <AdminFirstRunBudget
            supabase={supabase}
            t={t}
            busy={view === 'budget-busy'}
            draft={{
              budget_calendar_year: 2026,
              budget_year_id: 'year-1',
              budget_ui_step: view === 'budget-error' ? 'year' : 'review',
              budget_zero_confirmed: false,
              budget_decision_note: 'Протокол № 14 от 01.10.2026 с длинным названием основания',
            }}
            onBusy={noop}
            onState={noop}
            onContinue={async () => {}}
          />
        ) : null}
        {view === 'complete' || view === 'complete-blocked' || view === 'complete-busy' ? (
          <>
            {view === 'complete-blocked' ? (
              <FirstRunErrorNote raw="first_run: stage tariffs not complete" t={t} />
            ) : null}
            <FirstRunFinish t={t} busy={view === 'complete-busy'} onFinish={noop} />
          </>
        ) : null}
        {view === 'welcome' ? <FirstRunWelcome t={t} busy={false} onStart={noop} /> : null}
      </FirstRunFrame>
    </main>
  );
}
