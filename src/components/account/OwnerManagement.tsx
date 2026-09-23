'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { labelCategory, labelPriority } from '@/i18n/labels';
import { ExpensePhotoStrip } from '@/components/ExpensePhotoStrip';
import { ChatMedia } from '@/components/ChatMedia';
import { expensePhotoUrls } from '@/lib/expenses';
import { formatEur } from '@/lib/utilities';
import { announcementGroup, chatDayLabel, formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import {
  CompactCard,
  EmptyState,
  PillTabs,
  PrimaryButton,
  SectionHeader,
  StatusBadge,
  TextLinkButton,
} from '@/components/account/ownerUi';

export type ManagementTab = 'заявки' | 'объявления' | 'расходы' | 'чат';

type Apt = { id: number; apartment_number: string | number | null };
type RequestRow = {
  id: number;
  property_id: number | null;
  subject: string | null;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  photo_url: string | null;
  created_at: string;
};
type AnnouncementRow = { id: number; title: string | null; body: string | null; created_at: string };
type ExpenseRow = {
  id: number;
  title: string | null;
  amount: number;
  expense_date: string;
  photo_urls: string[] | null;
};
type ChatRow = {
  id: number;
  created_at: string;
  sender: 'owner' | 'uk';
  message: string;
  read_by_uk: boolean;
  read_by_owner: boolean;
  photo_url?: string | null;
  file_name?: string | null;
};

function isFinishedRequest(status: string | null | undefined) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'выполнена' || s === 'отклонена' || s === 'закрыта' || s === 'completed' || s === 'rejected' || s === 'cancelled';
}

function requestTone(status: string | null | undefined): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'выполнена' || s === 'completed') return 'success';
  if (s === 'отклонена' || s === 'rejected' || s === 'cancelled') return 'danger';
  if (s === 'в работе' || s === 'принята' || s === 'in_progress' || s === 'accepted') return 'warning';
  return 'info';
}

function requestHuman(status: string | null | undefined, t: (k: string) => string) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'выполнена' || s === 'completed') return t('account.reqStDone');
  if (s === 'отклонена' || s === 'rejected') return t('account.reqStReject');
  if (s === 'закрыта' || s === 'cancelled') return t('account.reqStClosed');
  if (s === 'в работе' || s === 'in_progress') return t('account.reqStWork');
  if (s === 'принята' || s === 'accepted') return t('account.reqStAccepted');
  return t('account.reqStNew');
}

export function OwnerManagement({
  tab,
  onTab,
  properties,
  requests,
  announcements,
  expenseYears,
  expensesByYear,
  expenseYear,
  onExpenseYear,
  requestForm,
  requestFormOpen,
  onRequestFormOpen,
  unreadChatCount,
  chat,
}: {
  tab: ManagementTab;
  onTab: (tab: ManagementTab) => void;
  properties: Apt[];
  requests: RequestRow[];
  announcements: AnnouncementRow[];
  expenseYears: number[];
  expensesByYear: Map<number, { items: ExpenseRow[]; total: number }>;
  expenseYear: number;
  onExpenseYear: (year: number) => void;
  requestForm: ReactNode;
  requestFormOpen: boolean;
  onRequestFormOpen: (open: boolean) => void;
  unreadChatCount: number;
  chat: {
    messages: ChatRow[];
    input: string;
    setInput: (v: string) => void;
    file: File | null;
    setFile: (f: File | null) => void;
    sending: boolean;
    onSend: (e: FormEvent) => void;
    fileRef: RefObject<HTMLInputElement | null>;
    scrollRef: RefObject<HTMLDivElement | null>;
    apartmentNumber: string | number | null | undefined;
    ownerName: string | null | undefined;
  };
}) {
  const { t, dateLocale } = useI18n();
  const [reqFilter, setReqFilter] = useState<'active' | 'done' | 'all'>('active');
  const [openReq, setOpenReq] = useState<number | null>(null);
  const [openAnn, setOpenAnn] = useState<number | null>(null);
  const [jumpNew, setJumpNew] = useState(false);
  const stickRef = useRef(true);
  const prevChatLen = useRef(chat.messages.length);

  const activeReqs = requests.filter((r) => !isFinishedRequest(r.status));
  const doneReqs = requests.filter((r) => isFinishedRequest(r.status));
  const shownReqs = reqFilter === 'active' ? activeReqs : reqFilter === 'done' ? doneReqs : requests;

  const yearGroup = expensesByYear.get(expenseYear);
  const yearItems = yearGroup?.items ?? [];
  const yearTotal = yearGroup?.total ?? 0;

  useEffect(() => {
    if (tab !== 'чат') return;
    stickRef.current = true;
    const el = chat.scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab, chat.scrollRef]);

  useEffect(() => {
    if (tab !== 'чат') return;
    const el = chat.scrollRef.current;
    if (!el) return;
    const grew = chat.messages.length > prevChatLen.current;
    prevChatLen.current = chat.messages.length;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setJumpNew(false);
    } else if (grew) {
      setJumpNew(true);
    }
  }, [chat.messages, chat.scrollRef, tab]);

  const groupedAnn = useMemo(() => {
    const buckets: Array<{ label: string; items: AnnouncementRow[] }> = [];
    const order = [t('common.today'), t('common.yesterday'), t('account.annEarlier')];
    const map = new Map<string, AnnouncementRow[]>();
    for (const a of announcements) {
      const g = announcementGroup(a.created_at, t('common.today'), t('common.yesterday'), t('account.annEarlier'));
      const list = map.get(g) ?? [];
      list.push(a);
      map.set(g, list);
    }
    for (const label of order) {
      const items = map.get(label);
      if (items?.length) buckets.push({ label, items });
    }
    return buckets;
  }, [announcements, t]);

  const tabs: Array<{ id: ManagementTab; label: string; count?: number }> = [
    { id: 'заявки', label: t('account.requests'), count: activeReqs.length || undefined },
    { id: 'объявления', label: t('account.announcements'), count: announcements.length || undefined },
    { id: 'расходы', label: t('account.mgmtTabExpenses') },
    { id: 'чат', label: t('account.tabChat'), count: unreadChatCount || undefined },
  ];

  return (
    <div className={tab === 'чат' ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}>
      <div className={tab === 'чат' ? 'shrink-0 space-y-3' : 'space-y-3'}>
        <SectionHeader title={t('account.mgmtTitle')} secondary={t('account.mgmtLead')} />
        <PillTabs items={tabs} value={tab} onChange={onTab} />
      </div>

      {tab === 'заявки' ? (
        <div className="space-y-3">
          <SectionHeader
            title={t('account.requests')}
            secondary={t('account.reqLead')}
            action={
              <PrimaryButton onClick={() => onRequestFormOpen(!requestFormOpen)}>
                {requestFormOpen ? t('account.hideForm') : t('account.createRequestPlus')}
              </PrimaryButton>
            }
          />
          {requestFormOpen ? requestForm : null}
          {requests.length > 0 ? (
            <PillTabs
              items={[
                { id: 'active', label: t('account.filterActive'), count: activeReqs.length },
                { id: 'done', label: t('account.filterDone'), count: doneReqs.length },
                { id: 'all', label: t('account.filterAll') },
              ]}
              value={reqFilter}
              onChange={setReqFilter}
            />
          ) : null}
          {shownReqs.length === 0 ? (
            <EmptyState
              title={
                requests.length === 0
                  ? t('account.noRequestsYet')
                  : reqFilter === 'active'
                    ? t('account.noActiveReqs')
                    : t('account.noRequestsYet')
              }
              text={requests.length === 0 ? t('account.reqEmptyHint') : undefined}
              action={
                requests.length === 0 ? (
                <PrimaryButton onClick={() => onRequestFormOpen(true)}>{t('account.createRequestPlus')}</PrimaryButton>
                ) : undefined
              }
            />
          ) : (
            shownReqs.map((r) => {
              const apt = properties.find((p) => p.id === r.property_id);
              const open = openReq === r.id;
              return (
                <CompactCard key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{r.subject}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t('picker.apt', { n: String(apt?.apartment_number ?? r.property_id ?? '') })} · {labelCategory(r.category, t)}
                      </p>
                    </div>
                    <StatusBadge label={requestHuman(r.status, t)} tone={requestTone(r.status)} />
                  </div>
                  <p className="mt-2 text-xs text-muted">{formatOwnerDateTime(r.created_at, dateLocale)}</p>
                  <p className="mt-1 text-xs text-secondary">
                    {t('account.priority')}: {labelPriority(r.priority, t)}
                  </p>
                  {open ? (
                    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm text-secondary">
                      <p className="whitespace-pre-wrap">{r.description}</p>
                      {r.photo_url ? (
                        <a className="text-accent hover:underline" href={r.photo_url} target="_blank" rel="noreferrer">
                          {t('account.viewPhoto')}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <TextLinkButton onClick={() => setOpenReq(open ? null : r.id)}>
                      {open ? t('common.close') : t('account.moreArrow')}
                    </TextLinkButton>
                  </div>
                </CompactCard>
              );
            })
          )}
        </div>
      ) : null}

      {tab === 'объявления' ? (
        <div className="space-y-3">
          <SectionHeader title={t('account.announcements')} secondary={t('account.annLead')} />
          {announcements.length === 0 ? (
            <EmptyState title={t('account.noAnnouncements')} text={t('account.annEmptyHint')} />
          ) : (
            groupedAnn.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{group.label}</p>
                {group.items.map((a) => {
                  const open = openAnn === a.id;
                  const body = a.body?.trim() ?? '';
                  const long = body.length > 180;
                  return (
                    <CompactCard key={a.id}>
                      <p className="font-medium text-foreground">{a.title}</p>
                      <p className={`mt-1 text-sm text-secondary whitespace-pre-wrap ${open || !long ? '' : 'line-clamp-3'}`}>
                        {body}
                      </p>
                      <p className="mt-2 text-xs text-muted">{formatOwnerDateTime(a.created_at, dateLocale)}</p>
                      {long ? (
                        <div className="mt-2">
                          <TextLinkButton onClick={() => setOpenAnn(open ? null : a.id)}>
                            {open ? t('common.close') : t('account.moreArrow')}
                          </TextLinkButton>
                        </div>
                      ) : null}
                    </CompactCard>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'расходы' ? (
        <div className="space-y-3">
          <SectionHeader title={t('account.expensesTitle')} secondary={t('account.expLead')} />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="rounded-[14px] border border-border bg-surface px-4 py-3">
              <p className="text-xs text-muted">{expenseYear}</p>
              <p className="mt-1 text-[11px] text-secondary">{t('account.expTotal')}</p>
              <p className="text-lg font-semibold tabular-nums">{formatEur(yearTotal)}</p>
              <p className="mt-1 text-[11px] text-secondary">{t('account.expCount')}</p>
              <p className="text-sm tabular-nums text-foreground">{yearItems.length}</p>
            </div>
            <PillTabs
              items={expenseYears.map((y) => ({ id: String(y), label: String(y) }))}
              value={String(expenseYear)}
              onChange={(id) => onExpenseYear(Number(id))}
            />
          </div>
          {yearItems.length === 0 ? (
            <EmptyState title={t('account.noExpensesYear', { year: expenseYear })} text={t('account.expEmptyHint')} />
          ) : (
            yearItems.map((e) => {
              const photos = expensePhotoUrls(e);
              return (
                <CompactCard key={e.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{e.title?.trim() || '—'}</p>
                    <p className="font-semibold tabular-nums">{formatEur(Number(e.amount))}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted">{formatOwnerDate(e.expense_date, dateLocale)}</p>
                  {photos.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-secondary">
                        {photos.some((u) => /\.pdf($|\?)/i.test(u))
                          ? t('account.openReceipt')
                          : t('account.openPhotos')}
                      </p>
                      <ExpensePhotoStrip urls={photos} size="sm" />
                    </div>
                  ) : null}
                </CompactCard>
              );
            })
          )}
        </div>
      ) : null}

      {tab === 'чат' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface md:min-h-[min(36rem,calc(100dvh-14rem))]">
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">{t('account.tabChat')}</p>
            <p className="truncate text-xs text-muted">
              {t('common.uk')} · {t('common.apt')} {chat.apartmentNumber}
              {chat.ownerName ? ` · ${chat.ownerName}` : ''}
            </p>
          </div>
          <div
            ref={chat.scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              if (stickRef.current) setJumpNew(false);
            }}
          >
            {chat.messages.length === 0 ? (
              <EmptyState title={t('account.chatEmptyTitle')} text={t('account.chatEmptyHint')} />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-0">
                {chat.messages.map((m, i) => {
                  const isOwner = m.sender === 'owner';
                  const prev = chat.messages[i - 1];
                  const newDay = !prev || prev.created_at.slice(0, 10) !== m.created_at.slice(0, 10);
                  const tight = Boolean(
                    prev &&
                      prev.sender === m.sender &&
                      !newDay &&
                      Math.abs(new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000,
                  );
                  const dayLabel = newDay
                    ? chatDayLabel(m.created_at, dateLocale, t('common.today'), t('common.yesterday'))
                    : null;
                  return (
                    <div key={m.id}>
                      {dayLabel ? (
                        <div className="my-2 flex justify-center">
                          <span className="rounded-full bg-hover px-2.5 py-0.5 text-[11px] text-muted">{dayLabel}</span>
                        </div>
                      ) : null}
                      <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} ${tight ? 'mt-0.5' : 'mt-1.5'}`}>
                        <div
                          className={`inline-flex max-w-[85%] flex-col px-3 py-2 text-sm leading-snug md:max-w-[70%] ${
                            isOwner
                              ? 'rounded-2xl rounded-br-md bg-accent-bg text-foreground'
                              : 'rounded-2xl rounded-bl-md bg-surface-secondary text-foreground'
                          }`}
                        >
                          {m.photo_url ? (
                            <div className={m.message.trim() ? 'mb-1.5' : ''}>
                              <ChatMedia url={m.photo_url} fileName={m.file_name} />
                            </div>
                          ) : null}
                          {m.message.trim() ? <div className="whitespace-pre-wrap break-words">{m.message}</div> : null}
                          <div className={`mt-1 flex items-center gap-1 text-[10px] ${isOwner ? 'justify-end text-secondary' : 'text-muted'}`}>
                            <span>
                              {new Date(m.created_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isOwner ? <span className={m.read_by_uk ? 'text-accent' : 'text-muted'}>{m.read_by_uk ? '✓✓' : '✓'}</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {jumpNew ? (
            <div className="flex justify-center py-1">
              <button
                type="button"
                className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-accent"
                onClick={() => {
                  const el = chat.scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                  stickRef.current = true;
                  setJumpNew(false);
                }}
              >
                {t('account.chatNewDown')}
              </button>
            </div>
          ) : null}
          <form onSubmit={chat.onSend} className="shrink-0 border-t border-border px-3 py-2.5">
            {chat.file ? (
              <div className="mb-2 flex items-center gap-2 text-sm text-secondary">
                <span className="min-w-0 flex-1 truncate">📎 {chat.file.name}</span>
                <button type="button" className="text-xs" onClick={() => chat.setFile(null)}>
                  {t('account.removeFile')}
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <input
                ref={chat.fileRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => chat.setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => chat.fileRef.current?.click()}
                disabled={chat.sending}
                aria-label={t('account.attachFile')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-secondary hover:bg-hover"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input
                className="min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-sm"
                value={chat.input}
                onChange={(e) => chat.setInput(e.target.value)}
                placeholder={t('account.chatPlaceholder')}
                aria-label={t('account.chatPlaceholder')}
                disabled={chat.sending}
              />
              <button
                type="submit"
                disabled={chat.sending || (!chat.input.trim() && !chat.file)}
                aria-label={t('common.send')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
              >
                {chat.sending ? '…' : '↑'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
