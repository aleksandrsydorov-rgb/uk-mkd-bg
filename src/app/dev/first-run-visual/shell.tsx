'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/I18nProvider';
import { FirstRunFrame, FirstRunWelcome } from '@/components/admin/FirstRunFrame';
import { AdminFirstRunBudget } from '@/components/admin/AdminFirstRunBudget';
import { AdminFirstRunTariffs } from '@/components/admin/AdminFirstRunTariffs';
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
} from '@/components/admin/FirstRunSteps';
import {
  visibleFirstRunStages,
  type FirstRunStageKey,
  type FirstRunStageRow,
} from '@/lib/firstRun';
import type { Database } from '@/lib/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

const noop = () => {};

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
  complex: 'complex_card',
  'complex-errors': 'complex_card',
  book: 'property_book',
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
  'complex_card',
  'property_book',
  'meters_select',
  'meters_water',
  'meters_electricity',
  'support_fee_opening',
  'capital_repair_opening',
  'tariffs',
  'budget',
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

export function FirstRunVisualShell() {
  const params = useSearchParams();
  const view = params.get('view') ?? 'welcome';
  const { t } = useI18n();
  const supabase = useMemo(() => visualSupabase(view), [view]);
  const stage: FirstRunStageKey = STAGE_BY_VIEW[view] ?? 'welcome';
  const selection =
    stage === 'meters_water'
      ? { water: true, electricity: false }
      : stage === 'meters_electricity'
        ? { water: false, electricity: true }
        : stage === 'meters_select' || stage === 'welcome' || stage === 'complex_card' || stage === 'property_book'
          ? null
          : { water: true, electricity: true };
  const stages = visibleFirstRunStages(selection);
  const currentIndex = ORDER.indexOf(stage);
  const done = new Set(ORDER.filter((_, i) => i < currentIndex && stages.includes(_)));
  if (view === 'complete-blocked') done.delete('tariffs');
  const stageRows = stages.map((key) => stageRow(key, done.has(key) ? 'complete' : 'pending'));

  const stageLabel = (key: FirstRunStageKey) => {
    const map: Record<FirstRunStageKey, string> = {
      welcome: 'admin.firstRunStageWelcome',
      complex_card: 'admin.firstRunStageComplex',
      property_book: 'admin.firstRunStagePropertyBook',
      meters_select: 'admin.firstRunStageMetersSelect',
      meters_water: 'admin.firstRunStageMetersWater',
      meters_electricity: 'admin.firstRunStageMetersElectricity',
      support_fee_opening: 'admin.firstRunStageSupportFee',
      capital_repair_opening: 'admin.firstRunStageCapitalRepair',
      tariffs: 'admin.firstRunStageTariffs',
      budget: 'admin.firstRunStageBudget',
      complete: 'admin.firstRunStageComplete',
    };
    return t(map[key]);
  };

  return (
    <main style={{ minHeight: '100vh', background: '#f3f6f5', padding: 16 }}>
      <FirstRunFrame
        t={t}
        stages={stages}
        stage={stage}
        stageRows={stageRows}
        stageLabel={stageLabel}
        initialStepsOpen={params.get('steps') === 'open'}
      >
        {view === 'complex' ? (
          <FirstRunComplexCard
            t={t}
            busy={false}
            showBack={false}
            formErrors={[]}
            form={{
              display_name: 'AMADEUS 11',
              address: 'Слънчев бряг, ул. Пример 1',
              apartment_count: '24',
              contact_phone: '+359 88 000 0000',
              contact_email: 'office@example.test',
            }}
            onChange={noop}
            onSave={noop}
            onBack={noop}
          />
        ) : null}
        {view === 'book' ? (
          <FirstRunBookImport
            t={t}
            apartmentCount="24"
            busy={false}
            committed={false}
            needsComplexFix={false}
            countMismatch={null}
            dry={{
              ok: false,
              newCount: 2,
              existingCount: 1,
              changesCount: 0,
              requiresOverwriteConfirmation: false,
            }}
            errorRows={[
              { sheet: 'objects', row: '4', apartment: '12', field: 'area_sqm', reason: 'Площадь не число' },
              { sheet: 'owners', row: '8', apartment: '3', field: 'email', reason: 'Некорректный email' },
            ]}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
            onEditComplex={noop}
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
                opening_balance_kind: 'zero',
                opening_balance_eur: '0',
              },
              {
                apartment_number: '2',
                meter_number: 'W-1002',
                initial_reading: '88',
                opening_balance_kind: 'debt',
                opening_balance_eur: '15.40',
              },
              {
                apartment_number: '10',
                meter_number: 'W-1010',
                initial_reading: '10',
                opening_balance_kind: 'overpayment',
                opening_balance_eur: '4.20',
              },
            ]}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
            onEditComplex={noop}
          />
        ) : null}
        {view === 'complex-errors' ? (
          <FirstRunComplexCard
            t={t}
            busy={false}
            showBack={false}
            formErrors={['display_name', 'address', 'apartment_count', 'contact_email']}
            form={{
              display_name: '',
              address: '',
              apartment_count: '0',
              contact_phone: '+359 88 000 0000',
              contact_email: 'не адрес',
            }}
            onChange={noop}
            onSave={noop}
            onBack={noop}
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
            onEditComplex={noop}
          />
        ) : null}
        {view === 'electricity' ? (
          <FirstRunMetersImport
            utility="electricity"
            t={t}
            busy={false}
            committed={false}
            dry={{ ok: true, rowCount: 2, skippedExisting: 0 }}
            errorRows={[]}
            rows={[
              {
                apartment_number: '14-А',
                meter_number: 'EL-2026-00018432-DAY',
                initial_reading: '1234567.8901',
                opening_balance_kind: 'debt',
                opening_balance_eur: '1234567.89',
              },
              {
                apartment_number: '2',
                meter_number: 'EL-2026-00018433-NIGHT',
                initial_reading: '88.1250',
                opening_balance_kind: 'overpayment',
                opening_balance_eur: '890123.45',
              },
            ]}
            onDownload={noop}
            onFile={noop}
            onCommit={noop}
            onContinue={noop}
            onEditComplex={noop}
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
                      reason: 'Сумма долга не число: 1 234 567,89 € (длинная подпись строки)',
                    },
                    {
                      sheet: 'support_fee',
                      row: '9',
                      apartment: '14-А',
                      field: 'billing_year',
                      reason: 'Период обязателен',
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
            busy={view === 'tariffs-busy'}
            onBusy={noop}
            onContinue={async () => {}}
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
