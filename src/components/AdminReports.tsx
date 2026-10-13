'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { isExpensePublished } from '@/lib/expenses';
import { annualSupportFee, type SupportFeeEntry } from '@/lib/finance';
import {
  displaySupportOutstanding,
  supportOverpayment,
  type SupportAssessmentBalanceRow,
} from '@/lib/supportFeeBalance';
import { supportLedgerKindLabelKey } from '@/lib/supportFeeReversal';
import {
  apartmentCategoryBreakdown,
  buildCapitalReportSnapshot,
  buildSupportFeeReportSnapshot,
  buildUtilitiesReportSnapshot,
  outstandingFromUtilityBalance,
  type FundTotalsLike,
} from '@/lib/financeReporting';
import { downloadHtmlAsPdf } from '@/lib/pdfDownload';
import { useI18n } from '@/i18n/I18nProvider';
import {
  labelPriority,
  labelRequestStatus,
  labelStaffRole,
} from '@/i18n/labels';
import type { Translate } from '@/i18n/translate';
import { AdminPageHeader, AdminCard, AdminFilterBar, AdminInlineAlert, AdminPrimaryButton, adminFieldClass } from '@/components/admin/AdminUi';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { emptyBalance, formatEur, type UtilityBalance } from '@/lib/utilities';

type Property = Database['public']['Tables']['properties']['Row'];
type Request = Database['public']['Tables']['requests']['Row'];
type UkExpense = Database['public']['Tables']['uk_expenses']['Row'];
type CapitalLedger = Database['public']['Tables']['capital_repair_ledger']['Row'];
type UtilityLedgerRow = {
  id: string;
  property_id: number;
  kind: string;
  amount_eur: number;
  created_at: string;
  note?: string | null;
};

type StaffRow = {
  name: string;
  role: string;
  salary_eur: number | null;
  active: boolean;
};

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateInPeriod(iso: string, year: number, quarter: number) {
  const y = Number(iso.slice(0, 4));
  if (y !== year) return false;
  if (quarter === 0) return true;
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(m) || m < 1) return false;
  return Math.ceil(m / 3) === quarter;
}

function ledgerInPeriod(entry: SupportFeeEntry, year: number, quarter: number) {
  if (quarter === 0) {
    return String(entry.period ?? '').includes(String(year)) || entry.created_at.slice(0, 4) === String(year);
  }
  return dateInPeriod(entry.created_at, year, quarter);
}

function sortApts(properties: Property[]) {
  return [...properties].sort((a, b) => {
    const na = Number(a.apartment_number);
    const nb = Number(b.apartment_number);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a.apartment_number).localeCompare(String(b.apartment_number), undefined, { numeric: true });
  });
}

function wrapReport(t: Translate, title: string, generated: string, body: string, categoryNote?: string) {
  const note = categoryNote
    ? `<div style="margin:0 0 14px;padding:8px 10px;border-left:3px solid #94a3b8;background:#f8fafc;color:#475569;font-size:11px;">${escapeHtml(categoryNote)}</div>`
    : '';
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;padding:28px 32px 40px;color:#111;font-size:12px;line-height:1.45;background:#fff;">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#667;">${escapeHtml(t('admin.pdfBuilding'))}</div>
    <h1 style="margin:6px 0 4px;font-size:22px;font-weight:700;">${escapeHtml(title)}</h1>
    <div style="margin-bottom:12px;color:#666;font-size:11px;">${escapeHtml(generated)}</div>
    ${note}
    ${body}
  </div>`;
}

function table(headers: string[], rows: string[][], footer?: string[]) {
  const head = headers
    .map((h) => `<th style="text-align:left;padding:7px 8px;border-bottom:1px solid #ccc;font-size:11px;color:#444;">${escapeHtml(h)}</th>`)
    .join('');
  const body = rows.length
    ? rows
        .map(
          (r, i) =>
            `<tr style="background:${i % 2 ? '#f6f7f7' : '#fff'};">${r
              .map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;">${c}</td>`)
              .join('')}</tr>`,
        )
        .join('')
    : `<tr><td colspan="${headers.length}" style="padding:16px 8px;color:#888;">—</td></tr>`;
  const foot = footer
    ? `<tr>${footer
        .map(
          (c, i) =>
            `<td style="padding:8px;border-top:2px solid #111;font-weight:700;">${i === 0 ? escapeHtml(c) : c}</td>`,
        )
        .join('')}</tr>`
    : '';
  return `<table style="width:100%;border-collapse:collapse;">${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>`;
}

function kpiGrid(items: { label: string; value: string }[]) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px;">${items
    .map(
      (item) =>
        `<div style="border:1px solid #e5e7e6;border-radius:10px;padding:10px 12px;"><div style="font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(item.label)}</div><div style="font-size:16px;font-weight:700;margin-top:4px;">${escapeHtml(item.value)}</div></div>`,
    )
    .join('')}</div>`;
}

function firstBalance(data: UtilityBalance[] | UtilityBalance | null | undefined): UtilityBalance {
  if (Array.isArray(data)) return data[0] ?? emptyBalance();
  return data ?? emptyBalance();
}

function moneyOrDash(n: number | null | undefined, money: (v: number) => string, dash: string) {
  if (n == null || !Number.isFinite(n)) return dash;
  return money(n);
}

type ReportCard = {
  id: string;
  category: 'overview' | 'support_fee' | 'capital' | 'utilities' | 'ops';
  title: string;
  hint: string;
  build: () => string;
};

export function AdminReports({
  supabase,
  properties,
  requests,
  ukExpenses,
  ledger,
  staff,
  supportRate,
  years,
  showSalary = false,
  supportAssessments = [],
  supportAssessmentsLoaded = false,
}: {
  supabase: SupabaseClient<Database>;
  properties: Property[];
  requests: Request[];
  ukExpenses: UkExpense[];
  ledger: SupportFeeEntry[];
  staff: StaffRow[];
  supportRate: number | null;
  years: number[];
  showSalary?: boolean;
  supportAssessments?: SupportAssessmentBalanceRow[];
  supportAssessmentsLoaded?: boolean;
}) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatEur(n, locale);
  const dash = t('admin.reportUnavailable');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [capitalFund, setCapitalFund] = useState<FundTotalsLike | null>(null);
  const [capitalLoaded, setCapitalLoaded] = useState(false);
  const [capitalLedger, setCapitalLedger] = useState<CapitalLedger[]>([]);
  const [waterByProperty, setWaterByProperty] = useState<Map<number, UtilityBalance> | null>(null);
  const [electricityByProperty, setElectricityByProperty] = useState<Map<number, UtilityBalance> | null>(null);
  const [internetByProperty, setInternetByProperty] = useState<Map<number, UtilityBalance> | null>(null);
  const [utilityLedgers, setUtilityLedgers] = useState<{
    water: UtilityLedgerRow[];
    electricity: UtilityLedgerRow[];
    internet: UtilityLedgerRow[];
  }>({ water: [], electricity: [], internet: [] });
  const [domainLoadNote, setDomainLoadNote] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    const set = new Set(years);
    set.add(new Date().getFullYear());
    for (const e of ledger) {
      const fromPeriod = Number(String(e.period ?? '').slice(0, 4));
      const fromCreated = Number(e.created_at.slice(0, 4));
      if (fromPeriod) set.add(fromPeriod);
      if (fromCreated) set.add(fromCreated);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [years, ledger]);
  const apts = useMemo(() => sortApts(properties), [properties]);
  const yearNum = Number(year);
  const periodKey = quarter === 0 ? year : `${year}-q${quarter}`;
  const quarterLabels = [t('admin.reportsYearly'), t('admin.reportsQ1'), t('admin.reportsQ2'), t('admin.reportsQ3'), t('admin.reportsQ4')];
  const periodLabel = quarter === 0 ? `${quarterLabels[0]} ${year}` : `${year} · ${quarterLabels[quarter]}`;
  const byId = useMemo(() => new Map(apts.map((p) => [p.id, p])), [apts]);

  useEffect(() => {
    let cancelled = false;
    async function loadDomains() {
      const notes: string[] = [];
      const ids = properties.map((p) => p.id);

      const capitalRes = await supabase.rpc('get_capital_repair_fund_totals');
      if (!cancelled) {
        if (capitalRes.error) {
          setCapitalFund(null);
          setCapitalLoaded(false);
          notes.push(t('admin.reportCapitalUnavailable'));
        } else {
          const row = Array.isArray(capitalRes.data) ? capitalRes.data[0] : capitalRes.data;
          setCapitalFund((row as FundTotalsLike) ?? { charged_eur: 0, paid_eur: 0, balance_eur: 0, apartments_with_debt: 0 });
          setCapitalLoaded(true);
        }
      }

      const capLedRes = await supabase
        .from('capital_repair_ledger')
        .select('id, property_id, kind, amount_eur, created_at, note')
        .order('created_at', { ascending: false })
        .limit(200);
      if (!cancelled) {
        if (!capLedRes.error) setCapitalLedger((capLedRes.data as CapitalLedger[]) ?? []);
      }

      async function loadBalances(
        rpcName: 'get_water_balance' | 'get_electricity_balance' | 'get_internet_balance'
      ) {
        const map = new Map<number, UtilityBalance>();
        const results = await Promise.all(
          ids.map(async (id) => {
            const res = await supabase.rpc(rpcName, { p_property_id: id });
            return { id, res };
          })
        );
        let ok = 0;
        for (const { id, res } of results) {
          if (res.error) continue;
          map.set(id, firstBalance(res.data as UtilityBalance[] | null));
          ok += 1;
        }
        return { map: ok > 0 ? map : null, ok, total: ids.length };
      }

      const [water, elec, net] = await Promise.all([
        loadBalances('get_water_balance'),
        loadBalances('get_electricity_balance'),
        loadBalances('get_internet_balance'),
      ]);
      if (cancelled) return;

      setWaterByProperty(water.map);
      setElectricityByProperty(elec.map);
      setInternetByProperty(net.map);
      if (!water.map) notes.push(t('admin.reportWaterUnavailable'));
      if (!elec.map) notes.push(t('admin.reportElectricityUnavailable'));
      if (!net.map) notes.push(t('admin.reportInternetUnavailable'));

      const [wLed, eLed, iLed] = await Promise.all([
        supabase.from('water_ledger').select('id, property_id, kind, amount_eur, created_at, note').order('created_at', { ascending: false }).limit(150),
        supabase.from('electricity_ledger').select('id, property_id, kind, amount_eur, created_at, note').order('created_at', { ascending: false }).limit(150),
        supabase.from('internet_ledger').select('id, property_id, kind, amount_eur, created_at, note').order('created_at', { ascending: false }).limit(150),
      ]);
      if (!cancelled) {
        setUtilityLedgers({
          water: (!wLed.error ? (wLed.data as UtilityLedgerRow[]) : []) ?? [],
          electricity: (!eLed.error ? (eLed.data as UtilityLedgerRow[]) : []) ?? [],
          internet: (!iLed.error ? (iLed.data as UtilityLedgerRow[]) : []) ?? [],
        });
        setDomainLoadNote(notes.length ? notes.join(' · ') : null);
      }
    }
    void loadDomains();
    return () => {
      cancelled = true;
    };
  }, [properties, supabase, t]);

  const [capitalByProperty, setCapitalByProperty] = useState<Map<number, UtilityBalance> | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadCapApt() {
      const map = new Map<number, UtilityBalance>();
      const results = await Promise.all(
        properties.map(async (p) => {
          const res = await supabase.rpc('get_capital_repair_balance', { p_property_id: p.id });
          return { id: p.id, res };
        })
      );
      let ok = 0;
      for (const { id, res } of results) {
        if (res.error) continue;
        map.set(id, firstBalance(res.data as UtilityBalance[] | null));
        ok += 1;
      }
      if (!cancelled) setCapitalByProperty(ok > 0 ? map : null);
    }
    void loadCapApt();
    return () => {
      cancelled = true;
    };
  }, [properties, supabase]);

  async function run(id: string, filename: string, html: string) {
    setBusy(id);
    setPdfError(null);
    try {
      await downloadHtmlAsPdf(filename, html);
    } catch (e: unknown) {
      setPdfError(e instanceof Error ? e.message : t('err.sendShort'));
    } finally {
      setBusy(null);
    }
  }

  function generatedLine() {
    return `${t('admin.pdfGenerated')}: ${formatOwnerDateTime(new Date().toISOString(), locale)} · ${periodLabel}`;
  }

  function sfDebt(p: Property) {
    return displaySupportOutstanding({
      assessmentsLoaded: supportAssessmentsLoaded,
      assessments: supportAssessments,
      propertyId: p.id,
      portalDebt: p.debt,
    });
  }

  const sfSnap = useMemo(
    () =>
      buildSupportFeeReportSnapshot({
        properties: apts,
        assessments: supportAssessments,
        assessmentsLoaded: supportAssessmentsLoaded,
        ledger,
      }),
    [apts, supportAssessments, supportAssessmentsLoaded, ledger]
  );
  const capitalSnap = useMemo(
    () => buildCapitalReportSnapshot(capitalFund, capitalLoaded),
    [capitalFund, capitalLoaded]
  );
  const utilitiesSnap = useMemo(
    () =>
      buildUtilitiesReportSnapshot({
        waterByProperty,
        electricityByProperty,
        internetByProperty,
      }),
    [waterByProperty, electricityByProperty, internetByProperty]
  );

  const cards: ReportCard[] = [
    {
      id: 'summary',
      category: 'overview',
      title: t('admin.reportSummary'),
      hint: t('admin.reportSummaryHint'),
      build: () => {
        const area = apts.reduce((s, p) => s + Number(p.area_sqm ?? 0), 0);
        const exp = ukExpenses
          .filter((e) => isExpensePublished(e) && dateInPeriod(e.expense_date, yearNum, quarter))
          .reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const salary = showSalary
          ? staff.filter((s) => s.active).reduce((s, x) => s + Number(x.salary_eur ?? 0), 0)
          : 0;
        const activeReq = requests.filter((r) => r.status !== 'выполнена' && r.status !== 'отклонена' && dateInPeriod(r.created_at, yearNum, quarter)).length;
        const summaryKpis = [
          { label: t('admin.apts'), value: String(apts.length) },
          { label: t('form.colArea'), value: `${area.toFixed(1)} ${t('common.sqm')}` },
          { label: t('admin.sfOutstandingLabel'), value: money(sfSnap.outstanding) },
          { label: t('admin.sfOverpaymentLabel'), value: money(sfSnap.overpayment) },
          { label: t('admin.reportCatCapital'), value: moneyOrDash(capitalSnap.outstanding, money, dash) },
          {
            label: t('admin.reportCatUtilities'),
            value: moneyOrDash(utilitiesSnap.combinedDomainOutstanding, money, dash),
          },
          {
            label: t('admin.feeYear'),
            value: (() => {
              const fee = annualSupportFee(area, supportRate);
              return fee == null ? '—' : money(fee);
            })(),
          },
          { label: t('admin.ukSpend'), value: money(exp) },
          { label: t('admin.activeReq'), value: String(activeReq) },
        ];
        if (showSalary) summaryKpis.push({ label: t('admin.staff'), value: money(salary) });
        const body =
          `<p style="margin:0 0 12px;color:#64748b;font-size:11px;">${escapeHtml(t('admin.reportNoCombinedDebtNote'))}</p>` +
          kpiGrid(summaryKpis) +
          table(
            showSalary
              ? [t('admin.pdfStaff'), t('admin.pdfRole'), t('admin.pdfSalary')]
              : [t('admin.pdfStaff'), t('admin.pdfRole'), t('admin.status')],
            staff.map((s) =>
              showSalary
                ? [
                    escapeHtml(s.name),
                    escapeHtml(labelStaffRole(s.role, t)),
                    escapeHtml(`${money(Number(s.salary_eur ?? 0))} · ${s.active ? t('admin.pdfActive') : t('admin.pdfInactive')}`),
                  ]
                : [
                    escapeHtml(s.name),
                    escapeHtml(labelStaffRole(s.role, t)),
                    escapeHtml(s.active ? t('admin.pdfActive') : t('admin.pdfInactive')),
                  ]
            )
          );
        return wrapReport(t, `${t('admin.reportSummary')} · ${periodLabel}`, generatedLine(), body, t('admin.reportCategoryScopeNote'));
      },
    },
    {
      id: 'support-fee',
      category: 'support_fee',
      title: t('admin.reportSupportFee'),
      hint: t('admin.reportSupportFeeHint'),
      build: () => {
        const periodLedger = ledger.filter((e) => ledgerInPeriod(e, yearNum, quarter));
        const periodSnap = buildSupportFeeReportSnapshot({
          properties: apts,
          assessments: supportAssessments,
          assessmentsLoaded: supportAssessmentsLoaded,
          ledger: periodLedger,
        });
        const body =
          kpiGrid([
            { label: t('admin.sfOutstandingLabel'), value: money(sfSnap.outstanding) },
            { label: t('admin.sfOverpaymentLabel'), value: money(sfSnap.overpayment) },
            { label: t('admin.reportSfCharges'), value: money(periodSnap.charges) },
            { label: t('admin.reportSfPayments'), value: money(periodSnap.payments) },
            { label: t('admin.reportSfReversals'), value: money(periodSnap.reversals) },
            { label: t('admin.reportSfVoids'), value: money(periodSnap.voids) },
            { label: t('admin.reportSfAptsWithDue'), value: String(sfSnap.apartmentsWithOutstanding) },
            { label: t('admin.reportReliability'), value: t('admin.reportReliabilityD1') },
          ]) +
          table(
            [t('form.colApt'), t('form.colOwner'), t('admin.sfOutstandingLabel'), t('admin.sfOverpaymentLabel')],
            apts.map((p) => [
              escapeHtml(p.apartment_number),
              escapeHtml(p.owner_name),
              escapeHtml(money(sfDebt(p))),
              escapeHtml(money(supportOverpayment(p.overpayment))),
            ])
          );
        return wrapReport(
          t,
          `${t('admin.reportSupportFee')} · ${periodLabel}`,
          generatedLine(),
          body,
          t('admin.reportSupportFeeScope')
        );
      },
    },
    {
      id: 'debt',
      category: 'support_fee',
      title: t('admin.reportDebt'),
      hint: t('admin.reportDebtHint'),
      build: () => {
        const rows = apts.filter((p) => sfDebt(p) > 0);
        const total = rows.reduce((s, p) => s + sfDebt(p), 0);
        const body = table(
          [t('form.colApt'), t('form.colOwner'), t('form.colFloor'), t('admin.sfOutstandingLabel')],
          rows.map((p) => [
            escapeHtml(p.apartment_number),
            escapeHtml(p.owner_name),
            escapeHtml(p.floor ?? '—'),
            escapeHtml(money(sfDebt(p))),
          ]),
          rows.length ? [t('admin.pdfTotal'), '', '', escapeHtml(money(total))] : undefined
        );
        return wrapReport(
          t,
          `${t('admin.reportDebt')} · ${periodLabel}`,
          generatedLine(),
          rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`,
          t('admin.reportSupportFeeScope')
        );
      },
    },
    {
      id: 'fee',
      category: 'support_fee',
      title: t('admin.reportFee'),
      hint: t('admin.reportFeeHint'),
      build: () => {
        const rows = ledger
          .filter((e) => ledgerInPeriod(e, yearNum, quarter))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const charges = rows.filter((e) => e.kind === 'charge').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const pays = rows.filter((e) => e.kind === 'payment').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const reversals = rows.filter((e) => e.kind === 'payment_reversal').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const voids = rows.filter((e) => e.kind === 'assessment_void').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const body =
          kpiGrid([
            { label: t('admin.pdfKindCharge'), value: money(charges) },
            { label: t('admin.pdfKindPay'), value: money(pays) },
            { label: t('admin.kindPaymentReversal'), value: money(reversals) },
            { label: t('admin.kindAssessmentVoid'), value: money(voids) },
          ]) +
          table(
            [t('admin.pdfDate'), t('form.colApt'), t('admin.pdfKind'), t('admin.pdfAmount'), t('admin.pdfNote')],
            rows.map((e) => {
              const apt = byId.get(e.property_id);
              return [
                escapeHtml(e.created_at.slice(0, 10)),
                escapeHtml(apt?.apartment_number ?? e.property_id),
                escapeHtml(t(supportLedgerKindLabelKey(e.kind))),
                escapeHtml(money(Number(e.amount ?? 0))),
                escapeHtml(e.note),
              ];
            })
          );
        return wrapReport(t, `${t('admin.reportFee')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`, t('admin.reportSupportFeeScope'));
      },
    },
    {
      id: 'capital',
      category: 'capital',
      title: t('admin.reportCapital'),
      hint: t('admin.reportCapitalHint'),
      build: () => {
        if (capitalSnap.reliability === 'unavailable') {
          return wrapReport(
            t,
            `${t('admin.reportCapital')} · ${periodLabel}`,
            generatedLine(),
            `<p>${escapeHtml(t('admin.reportCapitalUnavailable'))}</p>`,
            t('admin.reportCapitalScope')
          );
        }
        const periodRows = capitalLedger.filter((e) => dateInPeriod(e.created_at, yearNum, quarter));
        const body =
          kpiGrid([
            { label: t('admin.reportCapCharged'), value: money(capitalSnap.charged ?? 0) },
            { label: t('admin.reportCapPaid'), value: money(capitalSnap.paid ?? 0) },
            { label: t('admin.reportCapOutstanding'), value: money(capitalSnap.outstanding ?? 0) },
            { label: t('admin.reportCapDebtApts'), value: String(capitalSnap.apartmentsWithDebt ?? 0) },
            { label: t('admin.reportReliability'), value: t('admin.reportReliabilityLedger') },
          ]) +
          table(
            [t('admin.pdfDate'), t('form.colApt'), t('admin.pdfKind'), t('admin.pdfAmount'), t('admin.pdfNote')],
            periodRows.map((e) => {
              const apt = byId.get(e.property_id);
              return [
                escapeHtml(e.created_at.slice(0, 10)),
                escapeHtml(apt?.apartment_number ?? e.property_id),
                escapeHtml(e.kind),
                escapeHtml(money(Number(e.amount_eur ?? 0))),
                escapeHtml(e.note),
              ];
            })
          );
        return wrapReport(
          t,
          `${t('admin.reportCapital')} · ${periodLabel}`,
          generatedLine(),
          body,
          t('admin.reportCapitalScope')
        );
      },
    },
    {
      id: 'utilities',
      category: 'utilities',
      title: t('admin.reportUtilities'),
      hint: t('admin.reportUtilitiesHint'),
      build: () => {
        if (utilitiesSnap.reliability === 'unavailable') {
          return wrapReport(
            t,
            `${t('admin.reportUtilities')} · ${periodLabel}`,
            generatedLine(),
            `<p>${escapeHtml(t('admin.reportUtilitiesUnavailable'))}</p>`,
            t('admin.reportUtilitiesScope')
          );
        }
        const body =
          kpiGrid([
            { label: t('admin.water'), value: moneyOrDash(utilitiesSnap.waterOutstanding, money, dash) },
            { label: t('admin.electricityFinance'), value: moneyOrDash(utilitiesSnap.electricityOutstanding, money, dash) },
            { label: t('admin.internet'), value: moneyOrDash(utilitiesSnap.internetOutstanding, money, dash) },
            {
              label: t('admin.reportUtilitiesDomainSum'),
              value: moneyOrDash(utilitiesSnap.combinedDomainOutstanding, money, dash),
            },
            { label: t('admin.reportReliability'), value: t('admin.reportReliabilityLedger') },
          ]) +
          `<p style="margin:0 0 12px;color:#64748b;font-size:11px;">${escapeHtml(t('admin.reportUtilitiesNotConsumption'))}</p>` +
          table(
            [t('form.colApt'), t('admin.water'), t('admin.electricity'), t('admin.internet')],
            apts.map((p) => [
              escapeHtml(p.apartment_number),
              escapeHtml(moneyOrDash(waterByProperty ? outstandingFromUtilityBalance(waterByProperty.get(p.id)) : null, money, dash)),
              escapeHtml(moneyOrDash(electricityByProperty ? outstandingFromUtilityBalance(electricityByProperty.get(p.id)) : null, money, dash)),
              escapeHtml(moneyOrDash(internetByProperty ? outstandingFromUtilityBalance(internetByProperty.get(p.id)) : null, money, dash)),
            ])
          );
        const hist = (['water', 'electricity', 'internet'] as const).flatMap((domain) =>
          utilityLedgers[domain]
            .filter((e) => dateInPeriod(e.created_at, yearNum, quarter))
            .map((e) => {
              const apt = byId.get(e.property_id);
              return [
                escapeHtml(e.created_at.slice(0, 10)),
                escapeHtml(domain),
                escapeHtml(apt?.apartment_number ?? e.property_id),
                escapeHtml(e.kind),
                escapeHtml(money(Number(e.amount_eur ?? 0))),
              ];
            })
        );
        const histTable = table(
          [t('admin.pdfDate'), t('admin.reportCatUtilities'), t('form.colApt'), t('admin.pdfKind'), t('admin.pdfAmount')],
          hist
        );
        return wrapReport(
          t,
          `${t('admin.reportUtilities')} · ${periodLabel}`,
          generatedLine(),
          body + histTable,
          t('admin.reportUtilitiesScope')
        );
      },
    },
    {
      id: 'apts',
      category: 'overview',
      title: t('admin.reportApts'),
      hint: t('admin.reportAptsHint'),
      build: () => {
        const body =
          `<p style="margin:0 0 12px;color:#64748b;font-size:11px;">${escapeHtml(t('admin.reportNoCombinedDebtNote'))}</p>` +
          table(
            [
              t('form.colApt'),
              t('form.colOwner'),
              t('admin.reportCatSupportFee'),
              t('admin.reportCatCapital'),
              t('admin.water'),
              t('admin.electricityFinance'),
              t('admin.internet'),
            ],
            apts.map((p) => {
              const br = apartmentCategoryBreakdown({
                supportOutstanding: sfDebt(p),
                capitalOutstanding: capitalByProperty
                  ? outstandingFromUtilityBalance(capitalByProperty.get(p.id))
                  : null,
                waterOutstanding: waterByProperty
                  ? outstandingFromUtilityBalance(waterByProperty.get(p.id))
                  : null,
                electricityOutstanding: electricityByProperty
                  ? outstandingFromUtilityBalance(electricityByProperty.get(p.id))
                  : null,
                internetOutstanding: internetByProperty
                  ? outstandingFromUtilityBalance(internetByProperty.get(p.id))
                  : null,
              });
              return [
                escapeHtml(p.apartment_number),
                `${escapeHtml(p.owner_name)}<div style="color:#777;font-size:10px;">${escapeHtml(p.owner_email)}</div>`,
                escapeHtml(money(br.supportFee)),
                escapeHtml(moneyOrDash(br.capital, money, dash)),
                escapeHtml(moneyOrDash(br.utilities.water, money, dash)),
                escapeHtml(moneyOrDash(br.utilities.electricity, money, dash)),
                escapeHtml(moneyOrDash(br.utilities.internet, money, dash)),
              ];
            })
          );
        return wrapReport(t, `${t('admin.reportApts')} · ${periodLabel}`, generatedLine(), body, t('admin.reportCategoryScopeNote'));
      },
    },
    {
      id: 'expenses',
      category: 'ops',
      title: t('admin.reportExpenses'),
      hint: t('admin.reportExpensesHint'),
      build: () => {
        const rows = ukExpenses
          .filter((e) => dateInPeriod(e.expense_date, yearNum, quarter))
          .sort((a, b) => a.expense_date.localeCompare(b.expense_date));
        const published = rows.filter(isExpensePublished);
        const total = published.reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const body = table(
          [t('admin.pdfDate'), t('admin.pdfTitle'), t('admin.pdfAmount'), t('form.colStatus')],
          rows.map((e) => [
            escapeHtml(e.expense_date.slice(0, 10)),
            escapeHtml(e.title),
            escapeHtml(money(Number(e.amount ?? 0))),
            escapeHtml(isExpensePublished(e) ? t('admin.published') : t('admin.pending')),
          ]),
          rows.length ? [t('admin.pdfTotal'), t('admin.published'), escapeHtml(money(total)), ''] : undefined
        );
        return wrapReport(t, `${t('admin.reportExpenses')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
    {
      id: 'requests',
      category: 'ops',
      title: t('admin.reportRequests'),
      hint: t('admin.reportRequestsHint'),
      build: () => {
        const rows = [...requests]
          .filter((r) => dateInPeriod(r.created_at, yearNum, quarter))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        const body = table(
          [t('admin.pdfDate'), t('form.colApt'), t('admin.pdfSubject'), t('form.colStatus'), t('admin.pdfPriority')],
          rows.map((r) => {
            const apt = r.property_id != null ? byId.get(r.property_id) : undefined;
            return [
              escapeHtml(r.created_at.slice(0, 10)),
              escapeHtml(apt?.apartment_number ?? '—'),
              escapeHtml(r.subject || r.description),
              escapeHtml(labelRequestStatus(r.status, t)),
              escapeHtml(labelPriority(r.priority, t)),
            ];
          })
        );
        return wrapReport(t, `${t('admin.reportRequests')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
  ];

  const categoryOrder: Array<{ key: ReportCard['category']; title: string }> = [
    { key: 'overview', title: t('admin.reportGroupOverview') },
    { key: 'support_fee', title: t('admin.reportCatSupportFee') },
    { key: 'capital', title: t('admin.reportCatCapital') },
    { key: 'utilities', title: t('admin.reportCatUtilities') },
    { key: 'ops', title: t('admin.reportGroupOps') },
  ];

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.reports')} secondary={t('admin.reportsLead')} />
      <AdminFilterBar>
        {pdfError && <AdminInlineAlert tone="danger">{pdfError}</AdminInlineAlert>}
        {domainLoadNote ? <AdminInlineAlert tone="warning">{domainLoadNote}</AdminInlineAlert> : null}
        <AdminInlineAlert tone="info">{t('admin.reportNoCombinedDebtNote')}</AdminInlineAlert>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm text-secondary">
            <span>{t('admin.reportsYear')}</span>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={adminFieldClass}>
              {yearOptions.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-sm text-secondary">{t('admin.reportsScope')}</div>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarter(q)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    quarter === q
                      ? 'border-accent/30 bg-accent-bg text-accent'
                      : 'border-border bg-surface-secondary text-secondary hover:bg-hover'
                  }`}
                >
                  {q === 0 ? t('admin.reportsYearly') : t(`admin.reportsQ${q}` as 'admin.reportsQ1')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </AdminFilterBar>

      {categoryOrder.map((group) => {
        const groupCards = cards.filter((c) => c.category === group.key);
        if (!groupCards.length) return null;
        return (
          <AdminCard key={group.key}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{group.title}</p>
            <div className="mt-2 divide-y divide-border">
              {groupCards.map((card) => (
                <div key={card.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
                    <p className="text-sm text-muted">{card.hint}</p>
                  </div>
                  <AdminPrimaryButton
                    type="button"
                    disabled={busy !== null}
                    className="shrink-0 self-start sm:self-center"
                    onClick={() => void run(card.id, `mkd-${card.id}-${periodKey}.pdf`, card.build())}
                  >
                    {busy === card.id ? t('common.preparingPdf') : t('common.downloadPdf')}
                  </AdminPrimaryButton>
                </div>
              ))}
            </div>
          </AdminCard>
        );
      })}
    </div>
  );
}
