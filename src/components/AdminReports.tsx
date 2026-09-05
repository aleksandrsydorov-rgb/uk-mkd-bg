'use client';

import { useMemo, useState } from 'react';
import type { Database } from '@/lib/database.types';
import { isExpensePublished } from '@/lib/expenses';
import { annualSupportFee, type SupportFeeEntry } from '@/lib/finance';
import { downloadHtmlAsPdf } from '@/lib/pdfDownload';
import { useI18n } from '@/i18n/I18nProvider';
import {
  labelListing,
  labelOccupancy,
  labelPriority,
  labelRequestStatus,
} from '@/i18n/labels';
import type { Translate } from '@/i18n/translate';

type Property = Database['public']['Tables']['properties']['Row'];
type Request = Database['public']['Tables']['requests']['Row'];
type UkExpense = Database['public']['Tables']['uk_expenses']['Row'];

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

function money(n: number) {
  return `${n.toFixed(2)} €`;
}

function sortApts(properties: Property[]) {
  return [...properties].sort((a, b) => {
    const na = Number(a.apartment_number);
    const nb = Number(b.apartment_number);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a.apartment_number).localeCompare(String(b.apartment_number), undefined, { numeric: true });
  });
}

function wrapReport(t: Translate, title: string, generated: string, body: string) {
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;padding:28px 32px 40px;color:#111;font-size:12px;line-height:1.45;background:#fff;">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#667;">${escapeHtml(t('admin.pdfBuilding'))}</div>
    <h1 style="margin:6px 0 4px;font-size:22px;font-weight:700;">${escapeHtml(title)}</h1>
    <div style="margin-bottom:18px;color:#666;font-size:11px;">${escapeHtml(generated)}</div>
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

export function AdminReports({
  properties,
  requests,
  ukExpenses,
  ledger,
  staff,
  supportRate,
  years,
}: {
  properties: Property[];
  requests: Request[];
  ukExpenses: UkExpense[];
  ledger: SupportFeeEntry[];
  staff: StaffRow[];
  supportRate: number;
  years: number[];
}) {
  const { t, dateLocale } = useI18n();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

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
    return `${t('admin.pdfGenerated')}: ${new Date().toLocaleString(dateLocale)} · ${periodLabel}`;
  }

  function occupancy(p: Property) {
    return labelOccupancy(p.occupancy_status, t);
  }

  const cards = [
    {
      id: 'summary',
      title: t('admin.reportSummary'),
      hint: t('admin.reportSummaryHint'),
      build: () => {
        const area = apts.reduce((s, p) => s + Number(p.area_sqm ?? 0), 0);
        const debt = apts.reduce((s, p) => s + Number(p.debt ?? 0), 0);
        const over = apts.reduce((s, p) => s + Number(p.overpayment ?? 0), 0);
        const exp = ukExpenses
          .filter((e) => isExpensePublished(e) && dateInPeriod(e.expense_date, yearNum, quarter))
          .reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const salary = staff.filter((s) => s.active).reduce((s, x) => s + Number(x.salary_eur ?? 0), 0);
        const activeReq = requests.filter((r) => r.status !== 'выполнена' && r.status !== 'отклонена' && dateInPeriod(r.created_at, yearNum, quarter)).length;
        const body =
          kpiGrid([
            { label: t('admin.apts'), value: String(apts.length) },
            { label: t('form.colArea'), value: `${area.toFixed(1)} ${t('common.sqm')}` },
            { label: t('admin.debt'), value: money(debt) },
            { label: t('admin.overpay'), value: money(over) },
            { label: t('admin.feeYear'), value: money(annualSupportFee(area, supportRate)) },
            { label: t('admin.ukSpend'), value: money(exp) },
            { label: t('admin.activeReq'), value: String(activeReq) },
            { label: t('admin.staff'), value: money(salary) },
          ]) +
          table(
            [t('admin.pdfStaff'), t('admin.pdfRole'), t('admin.pdfSalary')],
            staff.map((s) => [
              escapeHtml(s.name),
              escapeHtml(s.role || '—'),
              escapeHtml(`${money(Number(s.salary_eur ?? 0))} · ${s.active ? t('admin.pdfActive') : t('admin.pdfInactive')}`),
            ]),
          );
        return wrapReport(t, `${t('admin.reportSummary')} · ${periodLabel}`, generatedLine(), body);
      },
    },
    {
      id: 'debt',
      title: t('admin.reportDebt'),
      hint: t('admin.reportDebtHint'),
      build: () => {
        const rows = apts.filter((p) => Number(p.debt ?? 0) > 0);
        const total = rows.reduce((s, p) => s + Number(p.debt ?? 0), 0);
        const body = table(
          [t('form.colApt'), t('form.colOwner'), t('form.colFloor'), t('admin.debt')],
          rows.map((p) => [
            escapeHtml(p.apartment_number),
            escapeHtml(p.owner_name),
            escapeHtml(p.floor ?? '—'),
            escapeHtml(money(Number(p.debt ?? 0))),
          ]),
          rows.length ? [t('admin.pdfTotal'), '', '', escapeHtml(money(total))] : undefined,
        );
        return wrapReport(t, `${t('admin.reportDebt')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
    {
      id: 'apts',
      title: t('admin.reportApts'),
      hint: t('admin.reportAptsHint'),
      build: () => {
        const body = table(
          [t('form.colApt'), t('form.colOwner'), t('form.colArea'), t('form.colStatus'), t('form.colMode'), t('admin.debt'), t('admin.overpay')],
          apts.map((p) => [
            escapeHtml(p.apartment_number),
            `${escapeHtml(p.owner_name)}<div style="color:#777;font-size:10px;">${escapeHtml(p.owner_email)}</div>`,
            escapeHtml(p.area_sqm != null ? `${p.area_sqm}` : '—'),
            escapeHtml(labelListing(p.status, t)),
            escapeHtml(occupancy(p)),
            escapeHtml(money(Number(p.debt ?? 0))),
            escapeHtml(money(Number(p.overpayment ?? 0))),
          ]),
        );
        return wrapReport(t, `${t('admin.reportApts')} · ${periodLabel}`, generatedLine(), body);
      },
    },
    {
      id: 'expenses',
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
          rows.length ? [t('admin.pdfTotal'), t('admin.published'), escapeHtml(money(total)), ''] : undefined,
        );
        return wrapReport(t, `${t('admin.reportExpenses')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
    {
      id: 'fee',
      title: t('admin.reportFee'),
      hint: t('admin.reportFeeHint'),
      build: () => {
        const rows = ledger
          .filter((e) => ledgerInPeriod(e, yearNum, quarter))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const charges = rows.filter((e) => e.kind === 'charge').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const pays = rows.filter((e) => e.kind === 'payment').reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const body =
          kpiGrid([
            { label: t('admin.pdfKindCharge'), value: money(charges) },
            { label: t('admin.pdfKindPay'), value: money(pays) },
          ]) +
          table(
            [t('admin.pdfDate'), t('form.colApt'), t('admin.pdfKind'), t('admin.pdfAmount'), t('admin.pdfNote')],
            rows.map((e) => {
              const apt = byId.get(e.property_id);
              return [
                escapeHtml(e.created_at.slice(0, 10)),
                escapeHtml(apt?.apartment_number ?? e.property_id),
                escapeHtml(e.kind === 'charge' ? t('admin.pdfKindCharge') : t('admin.pdfKindPay')),
                escapeHtml(money(Number(e.amount ?? 0))),
                escapeHtml(e.note),
              ];
            }),
          );
        return wrapReport(t, `${t('admin.reportFee')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
    {
      id: 'requests',
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
          }),
        );
        return wrapReport(t, `${t('admin.reportRequests')} · ${periodLabel}`, generatedLine(), rows.length ? body : `<p>${escapeHtml(t('admin.pdfNoRows'))}</p>`);
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="text-sm text-white/55">{t('admin.reportsLead')}</p>
        {pdfError && <p className="mt-2 text-sm text-red-400">{pdfError}</p>}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-sm text-white/70">
            <span>{t('admin.reportsYear')}</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-white"
            >
              {yearOptions.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-sm text-white/70">{t('admin.reportsScope')}</div>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarter(q)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    quarter === q
                      ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/10 bg-white/5 text-white/55 hover:bg-white/10'
                  }`}
                >
                  {q === 0 ? t('admin.reportsYearly') : t(`admin.reportsQ${q}` as 'admin.reportsQ1')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <div key={card.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-emerald-400">{card.title}</h2>
            <p className="mt-1 text-sm text-white/45">{card.hint}</p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(card.id, `mkd-${card.id}-${periodKey}.pdf`, card.build())}
              className="mt-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {busy === card.id ? t('common.preparingPdf') : t('common.downloadPdf')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
