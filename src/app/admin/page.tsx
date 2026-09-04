'use client';

import { useEffect, useState, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';
import Link from 'next/link';
import {
  isMissingRelation,
  isPollAcceptingVotes,
  pollCategoryClass,
  pollDecisionLabel,
  tallyPoll,
  type Poll,
  type PollCategory,
  type PollOption,
  type PollVote,
  type PollVoteHistory,
} from '@/lib/polls';
import { PollDetails, PollOptionBars } from '@/components/PollPanel';
import { listingStatus, listingStatusClass, transferStatusClass, type OwnerTransfer } from '@/lib/ownership';
import { normalizePriority, priorityClass } from '@/lib/requests';
import { BrandMark } from '@/components/BrandMark';
import { resolveAccess } from '@/lib/access';
import { clearSessionEmail, normalizeEmail, readSessionEmail } from '@/lib/session';
import { useRouter } from 'next/navigation';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { useI18n } from '@/i18n/I18nProvider';
import {
  labelCategory,
  labelListing,
  labelOccupancy,
  labelPriority,
  labelRequestStatus,
  labelTransfer,
} from '@/i18n/labels';
import {
  DEFAULT_SUPPORT_RATE,
  STAFF_ROLE_OPTIONS,
  annualSupportFee,
  applySupportCharge,
  applySupportPayment,
  canApproveUkExpenses,
  canRecordSupportPayments,
  canSetSupportRate,
  monthlySupportFee,
  type SupportFeeEntry,
} from '@/lib/finance';
import { EXPENSE_PENDING, EXPENSE_PUBLISHED, MAX_EXPENSE_PHOTOS, expensePhotoUrls, isExpensePublished } from '@/lib/expenses';
import { ExpensePhotoStrip } from '@/components/ExpensePhotoStrip';

type Property = Database['public']['Tables']['properties']['Row'];
type Request = Database['public']['Tables']['requests']['Row'];
type Announcement = Database['public']['Tables']['announcements']['Row'];
type UkExpense = Database['public']['Tables']['uk_expenses']['Row'];

interface StaffMember {
  id: number;
  name: string;
  role: string;
  phone: string | null;
  salary_eur: number | null;
  active: boolean;
  email?: string | null;
}

interface MeterReading {
  id: number;
  property_id: number;
  meter_type: 'electricity_day' | 'electricity_night' | 'cold_water';
  value: number;
  reading_date: string;
  submitted_by: string | null;
}

interface ChatMessage {
  id: number;
  created_at: string;
  property_id: number;
  sender: 'owner' | 'uk';
  message: string;
  read_by_uk: boolean;
  read_by_owner: boolean;
}

interface ApartmentGuest {
  id: number;
  property_id: number;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  is_child: boolean;
  check_in: string | null;
  check_out: string | null;
}

type AdminSection =
  | 'обзор'
  | 'квартиры'
  | 'смены'
  | 'заявки'
  | 'счётчики'
  | 'персонал'
  | 'такса'
  | 'расходы'
  | 'опросы'
  | 'объявления'
  | 'чат';

function formatUkDate(dateStr: string) {
  const [y, m, d] = dateStr.slice(0, 10).split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y}`;
}

function expenseYearOf(dateStr: string) {
  const y = Number(dateStr.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : 0;
}

const DAY_RATE = 0.14;
const NIGHT_RATE = 0.09;
const WATER_RATE = 3;

export default function AdminPage() {
  const router = useRouter();
  const { t, dateLocale } = useI18n();
  const MENU_ITEMS: { key: AdminSection; label: string; icon: string }[] = [
    { key: 'обзор', label: t('admin.overview'), icon: '📊' },
    { key: 'квартиры', label: t('admin.apartments'), icon: '🏠' },
    { key: 'смены', label: t('admin.transfers'), icon: '🔁' },
    { key: 'заявки', label: t('admin.requests'), icon: '📋' },
    { key: 'счётчики', label: t('admin.meters'), icon: '⚡' },
    { key: 'персонал', label: t('admin.staff'), icon: '👷' },
    { key: 'такса', label: t('admin.fee'), icon: '💶' },
    { key: 'расходы', label: t('admin.expenses'), icon: '🧾' },
    { key: 'опросы', label: t('admin.polls'), icon: '🗳️' },
    { key: 'объявления', label: t('admin.announcements'), icon: '📢' },
    { key: 'чат', label: t('admin.chat'), icon: '💬' },
  ];
  const [sessionEmail, setSessionEmail] = useState('');
  const [staffRole, setStaffRole] = useState('');
  const [hasCabinet, setHasCabinet] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [supportRate, setSupportRate] = useState(DEFAULT_SUPPORT_RATE);
  const [supportRateInput, setSupportRateInput] = useState(String(DEFAULT_SUPPORT_RATE));
  const [supportFeeMissing, setSupportFeeMissing] = useState(false);
  const [ledger, setLedger] = useState<SupportFeeEntry[]>([]);
  const [payPropertyId, setPayPropertyId] = useState<number | ''>('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [chargeYear, setChargeYear] = useState(String(new Date().getFullYear()));
  const [chargeSaving, setChargeSaving] = useState(false);
  // ---------- STATE ----------
  const [activeMenu, setActiveMenu] = useState<AdminSection>('обзор');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Данные
  const [properties, setProperties] = useState<Property[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [ukExpenses, setUkExpenses] = useState<UkExpense[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [allGuests, setAllGuests] = useState<ApartmentGuest[]>([]);
  const [allChatMessages, setAllChatMessages] = useState<ChatMessage[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollOptions, setPollOptions] = useState<PollOption[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [pollVoteHistory, setPollVoteHistory] = useState<PollVoteHistory[]>([]);
  const [ownerTransfers, setOwnerTransfers] = useState<OwnerTransfer[]>([]);
  const [expandedPollHistory, setExpandedPollHistory] = useState<number | null>(null);

  // ---------- ФИЛЬТРЫ КВАРТИР ----------
  const [aptSearch, setAptSearch] = useState('');
  const [aptFloorFilter, setAptFloorFilter] = useState<string>('');
  const [aptStatusFilter, setAptStatusFilter] = useState<string>('');
  const [aptOccupancyFilter, setAptOccupancyFilter] = useState<string>('');
  const [aptOwnerTypeFilter, setAptOwnerTypeFilter] = useState<string>('');
  const [aptDebtFilter, setAptDebtFilter] = useState<string>(''); // '' | 'has_debt' | 'no_debt' | 'debt_50' | 'debt_100'
  const [aptGuestsFilter, setAptGuestsFilter] = useState<string>(''); // '' | 'has_guests' | 'no_guests'
  const [aptPetsFilter, setAptPetsFilter] = useState<string>(''); // '' | 'has_pets' | 'no_pets'
  const [aptSort, setAptSort] = useState<string>('apartment_number_asc');

  // ---------- ФИЛЬТРЫ ЗАЯВОК ----------
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('');
  const [reqCategoryFilter, setReqCategoryFilter] = useState<string>('');
  const [reqPriorityFilter, setReqPriorityFilter] = useState<string>('');
  const [reqAptFilter, setReqAptFilter] = useState<string>('');
  const [reqSearch, setReqSearch] = useState('');

  // ---------- ФИЛЬТРЫ СЧЁТЧИКОВ ----------
  const [meterAptFilter, setMeterAptFilter] = useState<string>('');
  const [meterTypeFilter, setMeterTypeFilter] = useState<string>('');

  // ---------- ДЕТАЛЬНЫЙ ПРОСМОТР КВАРТИРЫ ----------
  const [detailProperty, setDetailProperty] = useState<Property | null>(null);

  // ---------- CHAT STATE ----------
  const [chatProperties, setChatProperties] = useState<
    { property: Property; lastMessage: ChatMessage | null; unread: number }[]
  >([]);
  const [selectedChatProperty, setSelectedChatProperty] = useState<Property | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [totalUnreadChats, setTotalUnreadChats] = useState(0);

  // ---------- ФОРМЫ ----------
  const [showPropForm, setShowPropForm] = useState(false);
  const [editingProp, setEditingProp] = useState<Property | null>(null);
  const [propForm, setPropForm] = useState({
    apartment_number: '',
    floor: '',
    area_sqm: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    owner_type: 'физическое лицо',
    company_name: '',
    status: 'в собственности',
    debt: '0',
    overpayment: '0',
    occupancy_status: 'owner',
    pet_info: '',
  });

  const [showMeterForm, setShowMeterForm] = useState(false);
  const [meterForm, setMeterForm] = useState({
    property_id: '',
    meter_type: 'electricity_day' as 'electricity_day' | 'electricity_night' | 'cold_water',
    value: '',
    reading_date: new Date().toISOString().slice(0, 10),
    submitted_by: 'УК',
  });

  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annForm, setAnnForm] = useState({ title: '', body: '', created_by: 'УК' });

  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<UkExpense | null>(null);
  const [expenseYearFilter, setExpenseYearFilter] = useState<number | 'all'>(
    new Date().getFullYear()
  );
  const [expenseForm, setExpenseForm] = useState({
    expense_date: new Date().toISOString().slice(0, 10),
    amount: '',
    title: '',
    created_by: 'УК',
  });
  const [expensePhotoFiles, setExpensePhotoFiles] = useState<File[]>([]);
  const [expenseExistingUrls, setExpenseExistingUrls] = useState<string[]>([]);

  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: '',
    role: '',
    phone: '',
    email: '',
    salary_eur: '',
    active: true,
  });

  const [showPollForm, setShowPollForm] = useState(false);
  const [pollForm, setPollForm] = useState({
    title: '',
    body: '',
    category: 'ремонт' as PollCategory,
    voting_starts: '',
    deadline: '',
    budget_eur: '',
    created_by: 'УК',
    options: ['За', 'Против'] as string[],
  });
  const [pollPhoto, setPollPhoto] = useState<File | null>(null);

  // ---------- ЗАГРУЗКА ВСЕХ ДАННЫХ ----------
  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [
        propsRes, reqsRes, annsRes, staffRes, expRes, metersRes, guestsRes, chatRes,
        pollsRes, optRes, voteRes, histRes,
      ] = await Promise.all([
        supabase.from('properties').select('*').order('apartment_number', { ascending: true }),
        supabase.from('requests').select('*').order('created_at', { ascending: false }),
        supabase.from('announcements').select('*').order('created_at', { ascending: false }),
        supabase.from('staff').select('*').order('name', { ascending: true }),
        supabase.from('uk_expenses').select('*').order('expense_date', { ascending: false }),
        supabase.from('meter_readings').select('*').order('reading_date', { ascending: false }),
        supabase.from('apartment_guests').select('*').order('created_at', { ascending: true }),
        supabase.from('chat_messages').select('*').order('created_at', { ascending: true }),
        supabase.from('polls').select('*').order('created_at', { ascending: false }),
        supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
        supabase.from('poll_votes').select('*'),
        supabase.from('poll_vote_history').select('*').order('created_at', { ascending: false }),
      ]);

      if (propsRes.error) throw propsRes.error;
      if (reqsRes.error) throw reqsRes.error;
      if (annsRes.error) throw annsRes.error;
      if (staffRes.error) throw staffRes.error;
      if (expRes.error) {
        const msg = expRes.error.message ?? '';
        if (!msg.includes('uk_expenses') && !msg.includes('schema cache')) throw expRes.error;
        setUkExpenses([]);
      } else {
        setUkExpenses((expRes.data as UkExpense[]) ?? []);
      }
      if (metersRes.error) throw metersRes.error;
      if (guestsRes.error) throw guestsRes.error;
      if (chatRes.error) throw chatRes.error;
      if (pollsRes.error) {
        if (!isMissingRelation(pollsRes.error, 'polls')) throw pollsRes.error;
        setPolls([]);
      } else {
        setPolls((pollsRes.data as Poll[]) ?? []);
      }
      if (optRes.error) {
        if (!isMissingRelation(optRes.error, 'poll_options')) throw optRes.error;
        setPollOptions([]);
      } else {
        setPollOptions((optRes.data as PollOption[]) ?? []);
      }
      if (voteRes.error) {
        if (!isMissingRelation(voteRes.error, 'poll_votes')) throw voteRes.error;
        setPollVotes([]);
      } else {
        setPollVotes((voteRes.data as PollVote[]) ?? []);
      }
      if (histRes.error) {
        if (!isMissingRelation(histRes.error, 'poll_vote_history')) throw histRes.error;
        setPollVoteHistory([]);
      } else {
        setPollVoteHistory((histRes.data as PollVoteHistory[]) ?? []);
      }

      setProperties((propsRes.data as Property[]) ?? []);
      setRequests((reqsRes.data as Request[]) ?? []);
      setAnnouncements((annsRes.data as Announcement[]) ?? []);
      setStaff((staffRes.data as StaffMember[]) ?? []);
      setMeterReadings((metersRes.data as MeterReading[]) ?? []);
      setAllGuests((guestsRes.data as ApartmentGuest[]) ?? []);
      setAllChatMessages((chatRes.data as ChatMessage[]) ?? []);

      const trRes = await supabase
        .from('owner_transfers')
        .select('*')
        .order('created_at', { ascending: false });
      if (trRes.error) {
        if (!isMissingRelation(trRes.error, 'owner_transfers')) throw trRes.error;
        setOwnerTransfers([]);
      } else {
        setOwnerTransfers((trRes.data as OwnerTransfer[]) ?? []);
      }

      const settingsRes = await supabase.from('building_settings').select('*').eq('id', 1).maybeSingle();
      const ledgerRes = await supabase
        .from('support_fee_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (settingsRes.error && isMissingRelation(settingsRes.error, 'building_settings')) {
        setSupportFeeMissing(true);
        setSupportRate(DEFAULT_SUPPORT_RATE);
        setSupportRateInput(String(DEFAULT_SUPPORT_RATE));
      } else if (settingsRes.error) {
        throw settingsRes.error;
      } else {
        const rate = Number(settingsRes.data?.support_rate_eur_per_sqm_year ?? DEFAULT_SUPPORT_RATE);
        setSupportRate(rate > 0 ? rate : DEFAULT_SUPPORT_RATE);
        setSupportRateInput(String(rate > 0 ? rate : DEFAULT_SUPPORT_RATE));
        setSupportFeeMissing(false);
      }

      if (ledgerRes.error) {
        if (!isMissingRelation(ledgerRes.error, 'support_fee_ledger')) throw ledgerRes.error;
        setLedger([]);
        setSupportFeeMissing(true);
      } else {
        setLedger((ledgerRes.data as SupportFeeEntry[]) ?? []);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function gate() {
      const email = readSessionEmail();
      if (!email) {
        router.replace('/account');
        return;
      }
      try {
        const access = await resolveAccess(email);
        if (cancelled) return;
        if (!access.isStaff) {
          router.replace('/account');
          return;
        }
        setSessionEmail(email);
        setStaffRole(access.staff?.role ?? '');
        setHasCabinet(access.isOwner);
        setAllowed(true);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Нет доступа');
          router.replace('/account');
        }
      }
    }
    gate();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (allowed) loadAll();
  }, [allowed]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ---------- ЗАГРУЗКА СПИСКА ЧАТОВ ----------
  async function loadChatList() {
    const allMsgs = allChatMessages;
    const byProp = new Map<number, ChatMessage[]>();
    for (const m of allMsgs) {
      if (!byProp.has(m.property_id)) byProp.set(m.property_id, []);
      byProp.get(m.property_id)!.push(m);
    }

    const list: { property: Property; lastMessage: ChatMessage | null; unread: number }[] = [];
    for (const prop of properties) {
      const msgsForProp = byProp.get(prop.id) ?? [];
      if (msgsForProp.length === 0) continue;
      const last = msgsForProp[msgsForProp.length - 1];
      const unread = msgsForProp.filter((m) => m.sender === 'owner' && !m.read_by_uk).length;
      list.push({ property: prop, lastMessage: last, unread });
    }

    list.sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1;
      if (a.unread === 0 && b.unread > 0) return 1;
      const aTime = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      const bTime = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return bTime - aTime;
    });

    setChatProperties(list);
    setTotalUnreadChats(list.reduce((sum, item) => sum + item.unread, 0));
  }

  const loadChatMessages = useCallback(async () => {
    if (!selectedChatProperty) return;
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('property_id', selectedChatProperty.id)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) return;
      setChatMessages((data as ChatMessage[]) ?? []);
    } catch {}
  }, [selectedChatProperty]);

  useEffect(() => {
    loadChatList();
    chatPollRef.current = setInterval(async () => {
      const { data: freshMsgs } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true });
      if (freshMsgs) setAllChatMessages(freshMsgs as ChatMessage[]);
      if (selectedChatProperty) {
        const { data } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('property_id', selectedChatProperty.id)
          .order('created_at', { ascending: true })
          .limit(500);
        if (data) setChatMessages(data as ChatMessage[]);
      }
    }, 5000);
    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current);
    };
  }, [properties, allChatMessages, selectedChatProperty]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (!selectedChatProperty) return;
    loadChatMessages();
    const unread = chatMessages.filter((m) => m.sender === 'owner' && !m.read_by_uk);
    if (unread.length > 0) {
      supabase
        .from('chat_messages')
        .update({ read_by_uk: true })
        .in('id', unread.map((m) => m.id))
        .then(() => {
          loadChatMessages();
          loadAll();
        });
    }
  }, [selectedChatProperty]); // eslint-disable-line

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChatProperty) return;
    const msg = chatInput.trim();
    if (!msg) return;
    setChatSending(true);
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('chat_messages')
        .insert({
          property_id: selectedChatProperty.id,
          sender: 'uk',
          message: msg,
          read_by_uk: true,
        })
        .select('*')
        .single();
      if (insertErr) throw insertErr;
      setChatMessages((prev) => [...prev, inserted as ChatMessage]);
      setChatInput('');
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка отправки');
    } finally {
      setChatSending(false);
    }
  }

  // ---------- РАСЧЁТЫ ДЛЯ ОБЗОРА ----------
  const totalDebt = useMemo(
    () => properties.reduce((sum, p) => sum + Number(p.debt ?? 0), 0),
    [properties]
  );
  const totalOverpayment = useMemo(
    () => properties.reduce((sum, p) => sum + Number(p.overpayment ?? 0), 0),
    [properties]
  );
  const totalArea = useMemo(
    () => properties.reduce((sum, p) => sum + Number(p.area_sqm ?? 0), 0),
    [properties]
  );
  const annualSupportTotal = totalArea * supportRate;
  const activeRequests = useMemo(
    () => requests.filter((r) => r.status !== 'выполнена' && r.status !== 'отклонена'),
    [requests]
  );
  const totalSalary = useMemo(
    () => staff.filter((s) => s.active).reduce((sum, s) => sum + Number(s.salary_eur ?? 0), 0),
    [staff]
  );
  const totalUkExpenses = useMemo(
    () => ukExpenses.filter(isExpensePublished).reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
    [ukExpenses]
  );
  const pendingUkExpenses = useMemo(
    () => ukExpenses.filter((e) => !isExpensePublished(e)),
    [ukExpenses]
  );
  const currentCalendarYear = new Date().getFullYear();
  const expenseYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentCalendarYear);
    for (const e of ukExpenses) {
      const y = expenseYearOf(e.expense_date);
      if (y) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [ukExpenses, currentCalendarYear]);
  const expensesByYear = useMemo(() => {
    const map = new Map<number, { items: UkExpense[]; total: number; pendingTotal: number }>();
    for (const e of ukExpenses) {
      const y = expenseYearOf(e.expense_date);
      if (!y) continue;
      const cur = map.get(y) ?? { items: [], total: 0, pendingTotal: 0 };
      cur.items.push(e);
      const amount = Number(e.amount ?? 0);
      if (isExpensePublished(e)) cur.total += amount;
      else cur.pendingTotal += amount;
      map.set(y, cur);
    }
    for (const cur of map.values()) {
      cur.items.sort((a, b) => Number(isExpensePublished(a)) - Number(isExpensePublished(b)));
    }
    return map;
  }, [ukExpenses]);
  const openPollsCount = useMemo(
    () => polls.filter((p) => isPollAcceptingVotes(p)).length,
    [polls]
  );
  const pendingTransfersCount = useMemo(
    () => ownerTransfers.filter((t) => t.status === 'ожидает').length,
    [ownerTransfers]
  );

  // ---------- ВСПОМОГАТЕЛЬНЫЕ ----------
  function propertyNameById(id: number) {
    const p = properties.find((x) => x.id === id);
    return p ? t('picker.apt', { n: p.apartment_number }) : `#${id}`;
  }

  function propertyFullById(id: number) {
    const p = properties.find((x) => x.id === id);
    return p ? `${t('picker.apt', { n: p.apartment_number })}, ${p.owner_name}` : `#${id}`;
  }

  function guestsForProperty(propId: number) {
    return allGuests.filter((g) => g.property_id === propId);
  }

  function requestsForProperty(propId: number) {
    return requests.filter((r) => r.property_id === propId);
  }

  function metersForProperty(propId: number) {
    return meterReadings.filter((m) => m.property_id === propId);
  }

  function chatForProperty(propId: number) {
    return allChatMessages.filter((m) => m.property_id === propId);
  }

  function occupancyLabel(status: string | null) {
    switch (status) {
      case 'owner': return labelOccupancy('owner', t);
      case 'standby': return labelOccupancy('standby', t);
      case 'rented': return labelOccupancy('rented', t);
      default: return labelOccupancy('owner', t);
    }
  }

  function occupancyColor(status: string | null) {
    switch (status) {
      case 'owner': return 'text-emerald-300';
      case 'standby': return 'text-yellow-300';
      case 'rented': return 'text-cyan-300';
      default: return 'text-emerald-300';
    }
  }

  function occupancyBadgeClass(status: string | null) {
    switch (status) {
      case 'owner': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'standby': return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
      case 'rented': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
      default: return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    }
  }

  // ---------- ФИЛЬТРАЦИЯ КВАРТИР ----------
  const uniqueFloors = useMemo(() => {
    const floors = new Set<number>();
    properties.forEach((p) => { if (p.floor != null) floors.add(Number(p.floor)); });
    return Array.from(floors).sort((a, b) => a - b);
  }, [properties]);

  const filteredProperties = useMemo(() => {
    let result = [...properties];

    // Поиск
    if (aptSearch.trim()) {
      const q = aptSearch.trim().toLowerCase();
      result = result.filter((p) =>
        String(p.apartment_number ?? '').toLowerCase().includes(q) ||
        String(p.owner_name ?? '').toLowerCase().includes(q) ||
        String(p.owner_email ?? '').toLowerCase().includes(q) ||
        String(p.owner_phone ?? '').toLowerCase().includes(q) ||
        String(p.company_name ?? '').toLowerCase().includes(q)
      );
    }

    // Этаж
    if (aptFloorFilter !== '') {
      result = result.filter((p) => String(p.floor) === aptFloorFilter);
    }

    // Статус
    if (aptStatusFilter !== '') {
      result = result.filter((p) => listingStatus(p.status) === aptStatusFilter);
    }

    // Режим проживания
    if (aptOccupancyFilter !== '') {
      result = result.filter((p) => (p.occupancy_status ?? 'owner') === aptOccupancyFilter);
    }

    // Тип собственника
    if (aptOwnerTypeFilter !== '') {
      result = result.filter((p) => p.owner_type === aptOwnerTypeFilter);
    }

    // Долг
    if (aptDebtFilter !== '') {
      switch (aptDebtFilter) {
        case 'has_debt':
          result = result.filter((p) => Number(p.debt ?? 0) > 0);
          break;
        case 'no_debt':
          result = result.filter((p) => Number(p.debt ?? 0) <= 0);
          break;
        case 'debt_50':
          result = result.filter((p) => Number(p.debt ?? 0) >= 50);
          break;
        case 'debt_100':
          result = result.filter((p) => Number(p.debt ?? 0) >= 100);
          break;
      }
    }

    // Жильцы
    if (aptGuestsFilter !== '') {
      const propsWithGuests = new Set(allGuests.map((g) => g.property_id));
      if (aptGuestsFilter === 'has_guests') {
        result = result.filter((p) => propsWithGuests.has(p.id));
      } else {
        result = result.filter((p) => !propsWithGuests.has(p.id));
      }
    }

    // Питомцы
    if (aptPetsFilter !== '') {
      if (aptPetsFilter === 'has_pets') {
        result = result.filter((p) => p.pet_info && p.pet_info.trim() !== '');
      } else {
        result = result.filter((p) => !p.pet_info || p.pet_info.trim() === '');
      }
    }

    // Сортировка
    switch (aptSort) {
      case 'apartment_number_asc':
        result.sort((a, b) => String(a.apartment_number).localeCompare(String(b.apartment_number), 'numeric'));
        break;
      case 'apartment_number_desc':
        result.sort((a, b) => String(b.apartment_number).localeCompare(String(a.apartment_number), 'numeric'));
        break;
      case 'debt_desc':
        result.sort((a, b) => Number(b.debt ?? 0) - Number(a.debt ?? 0));
        break;
      case 'debt_asc':
        result.sort((a, b) => Number(a.debt ?? 0) - Number(b.debt ?? 0));
        break;
      case 'area_desc':
        result.sort((a, b) => Number(b.area_sqm ?? 0) - Number(a.area_sqm ?? 0));
        break;
      case 'area_asc':
        result.sort((a, b) => Number(a.area_sqm ?? 0) - Number(b.area_sqm ?? 0));
        break;
      case 'owner_asc':
        result.sort((a, b) => String(a.owner_name ?? '').localeCompare(String(b.owner_name ?? '')));
        break;
    }

    return result;
  }, [properties, aptSearch, aptFloorFilter, aptStatusFilter, aptOccupancyFilter,
      aptOwnerTypeFilter, aptDebtFilter, aptGuestsFilter, aptPetsFilter, aptSort, allGuests]);

  // ---------- ФИЛЬТРАЦИЯ ЗАЯВОК ----------
  const filteredRequests = useMemo(() => {
    let result = [...requests];

    if (reqStatusFilter !== '') {
      result = result.filter((r) => r.status === reqStatusFilter);
    }
    if (reqCategoryFilter !== '') {
      result = result.filter((r) => r.category === reqCategoryFilter);
    }
    if (reqPriorityFilter !== '') {
      result = result.filter((r) => normalizePriority(r.priority) === reqPriorityFilter);
    }
    if (reqAptFilter !== '') {
      result = result.filter((r) => String(r.property_id) === reqAptFilter);
    }
    if (reqSearch.trim()) {
      const q = reqSearch.trim().toLowerCase();
      result = result.filter((r) =>
        String(r.subject ?? '').toLowerCase().includes(q) ||
        String(r.description ?? '').toLowerCase().includes(q) ||
        String(r.owner_name ?? '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [requests, reqStatusFilter, reqCategoryFilter, reqPriorityFilter, reqAptFilter, reqSearch]);

  // ---------- ФИЛЬТРАЦИЯ СЧЁТЧИКОВ ----------
  const filteredMeters = useMemo(() => {
    let result = [...meterReadings];
    if (meterAptFilter !== '') {
      result = result.filter((m) => String(m.property_id) === meterAptFilter);
    }
    if (meterTypeFilter !== '') {
      result = result.filter((m) => m.meter_type === meterTypeFilter);
    }
    return result;
  }, [meterReadings, meterAptFilter, meterTypeFilter]);

  // ---------- CRUD ----------
  function startEditProp(p: Property) {
    setEditingProp(p);
    setPropForm({
      apartment_number: p.apartment_number ?? '',
      floor: String(p.floor ?? ''),
      area_sqm: String(p.area_sqm ?? ''),
      owner_name: p.owner_name ?? '',
      owner_email: p.owner_email ?? '',
      owner_phone: p.owner_phone ?? '',
      owner_type: p.owner_type ?? 'физическое лицо',
      company_name: p.company_name ?? '',
      status: listingStatus(p.status),
      debt: String(p.debt ?? 0),
      overpayment: String(p.overpayment ?? 0),
      occupancy_status: p.occupancy_status ?? 'owner',
      pet_info: p.pet_info ?? '',
    });
    setShowPropForm(true);
  }

  function startNewProp() {
    setEditingProp(null);
    setPropForm({
      apartment_number: '', floor: '', area_sqm: '', owner_name: '', owner_email: '',
      owner_phone: '', owner_type: 'физическое лицо', company_name: '', status: 'в собственности',
      debt: '0', overpayment: '0', occupancy_status: 'owner', pet_info: '',
    });
    setShowPropForm(true);
  }

  async function handleSaveProp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      apartment_number: propForm.apartment_number.trim(),
      floor: Number(propForm.floor) || null,
      area_sqm: Number(propForm.area_sqm) || null,
      owner_name: propForm.owner_name.trim(),
      owner_email: normalizeEmail(propForm.owner_email),
      owner_phone: propForm.owner_phone.trim() || null,
      owner_type: propForm.owner_type,
      company_name: propForm.company_name.trim() || null,
      status: propForm.status,
      debt: Number(propForm.debt) || 0,
      overpayment: Number(propForm.overpayment) || 0,
      occupancy_status: propForm.occupancy_status,
      pet_info: propForm.pet_info.trim() || null,
    };
    try {
      if (editingProp) {
        const { error: updErr } = await supabase.from('properties').update(payload).eq('id', editingProp.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('properties').insert(payload);
        if (insErr) throw insErr;
      }
      setShowPropForm(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка сохранения');
    }
  }

  async function handleDeleteProp(id: number) {
    if (!confirm('Удалить квартиру? Все связанные данные будут потеряны.')) return;
    try {
      const { error } = await supabase.from('properties').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  async function handleSaveMeter(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { error } = await supabase.from('meter_readings').insert({
        property_id: Number(meterForm.property_id),
        meter_type: meterForm.meter_type,
        value: Number(meterForm.value),
        reading_date: meterForm.reading_date,
        submitted_by: meterForm.submitted_by,
      });
      if (error) throw error;
      setShowMeterForm(false);
      setMeterForm({ property_id: '', meter_type: 'electricity_day', value: '',
        reading_date: new Date().toISOString().slice(0, 10), submitted_by: 'УК' });
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка сохранения показания');
    }
  }

  async function handleDeleteMeter(id: number) {
    try {
      const { error } = await supabase.from('meter_readings').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  async function handleSaveAnn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { error } = await supabase.from('announcements').insert({
        title: annForm.title.trim(), body: annForm.body.trim(),
        created_by: annForm.created_by.trim() || 'УК',
      });
      if (error) throw error;
      setShowAnnForm(false);
      setAnnForm({ title: '', body: '', created_by: 'УК' });
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка создания объявления');
    }
  }

  async function handleDeleteAnn(id: number) {
    if (!confirm('Удалить объявление?')) return;
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  function startNewExpense() {
    setEditingExpense(null);
    setExpenseForm({
      expense_date: new Date().toISOString().slice(0, 10),
      amount: '',
      title: '',
      created_by: sessionEmail || 'УК',
    });
    setExpensePhotoFiles([]);
    setExpenseExistingUrls([]);
    setShowExpenseForm(true);
  }

  function startEditExpense(e: UkExpense) {
    setEditingExpense(e);
    setExpenseForm({
      expense_date: e.expense_date.slice(0, 10),
      amount: String(e.amount ?? ''),
      title: e.title ?? '',
      created_by: e.created_by ?? (sessionEmail || 'УК'),
    });
    setExpensePhotoFiles([]);
    setExpenseExistingUrls(expensePhotoUrls(e));
    setShowExpenseForm(true);
  }

  async function uploadExpensePhotos(expenseId: number, files: File[]) {
    const urls: string[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `uk-expenses/${expenseId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('request-photos')
        .upload(filePath, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      urls.push(supabase.storage.from('request-photos').getPublicUrl(uploadData.path).data.publicUrl);
    }
    return urls;
  }

  async function handleSaveExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const title = expenseForm.title.trim();
    const amount = Number(expenseForm.amount);
    if (!expenseForm.expense_date || !title || Number.isNaN(amount) || amount <= 0) {
      setError('Укажите дату, назначение и сумму больше нуля.');
      return;
    }
    if (expenseExistingUrls.length + expensePhotoFiles.length > MAX_EXPENSE_PHOTOS) {
      setError(`Можно приложить не больше ${MAX_EXPENSE_PHOTOS} фото.`);
      return;
    }
    const published = editingExpense ? isExpensePublished(editingExpense) : false;
    const keepPublished = published && canApproveUkExpenses(staffRole);
    const payload = {
      expense_date: expenseForm.expense_date,
      amount,
      title,
      created_by: expenseForm.created_by.trim() || sessionEmail || 'УК',
      status: keepPublished ? EXPENSE_PUBLISHED : EXPENSE_PENDING,
      approved_by: keepPublished ? (editingExpense?.approved_by ?? sessionEmail) : null,
      approved_at: keepPublished ? (editingExpense?.approved_at ?? null) : null,
    };
    try {
      let expenseId = editingExpense?.id;
      if (editingExpense) {
        const { error } = await supabase.from('uk_expenses').update(payload).eq('id', editingExpense.id);
        if (error) {
          if (error.message?.includes('status') || error.message?.includes('photo_urls')) {
            throw new Error('Выполните supabase/uk_expenses_approval.sql в SQL Editor.');
          }
          throw error;
        }
      } else {
        const { data, error } = await supabase.from('uk_expenses').insert(payload).select('id').single();
        if (error) {
          if (error.message?.includes('status') || error.message?.includes('photo_urls')) {
            throw new Error('Выполните supabase/uk_expenses_approval.sql в SQL Editor.');
          }
          throw error;
        }
        expenseId = data.id as number;
      }
      if (expenseId && expensePhotoFiles.length > 0) {
        const uploaded = await uploadExpensePhotos(expenseId, expensePhotoFiles);
        const photo_urls = [...expenseExistingUrls, ...uploaded].slice(0, MAX_EXPENSE_PHOTOS);
        const { error: photoErr } = await supabase.from('uk_expenses').update({ photo_urls }).eq('id', expenseId);
        if (photoErr) throw photoErr;
      } else if (expenseId && editingExpense) {
        const { error: photoErr } = await supabase
          .from('uk_expenses')
          .update({ photo_urls: expenseExistingUrls })
          .eq('id', expenseId);
        if (photoErr && !photoErr.message?.includes('photo_urls')) throw photoErr;
      }
      setShowExpenseForm(false);
      setEditingExpense(null);
      setExpensePhotoFiles([]);
      setExpenseExistingUrls([]);
      setExpenseYearFilter(Number(expenseForm.expense_date.slice(0, 4)) || new Date().getFullYear());
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка сохранения расхода');
    }
  }

  async function handleApproveExpense(exp: UkExpense) {
    if (!canApproveUkExpenses(staffRole)) {
      setError('Публиковать расходы может только администратор.');
      return;
    }
    try {
      const { error } = await supabase.from('uk_expenses').update({
        status: EXPENSE_PUBLISHED,
        approved_by: sessionEmail,
        approved_at: new Date().toISOString(),
      }).eq('id', exp.id);
      if (error) {
        if (error.message?.includes('status')) {
          throw new Error('Выполните supabase/uk_expenses_approval.sql в SQL Editor.');
        }
        throw error;
      }
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Не удалось утвердить расход');
    }
  }

  async function handleDeleteExpense(id: number) {
    if (!confirm('Удалить расход?')) return;
    try {
      const { error } = await supabase.from('uk_expenses').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  async function persistSupportBalances(
    property: Property,
    kind: 'payment' | 'charge',
    amount: number,
    next: { debt: number; overpayment: number },
    period: string | null,
    note: string | null,
  ) {
    const { error: ledErr } = await supabase.from('support_fee_ledger').insert({
      property_id: property.id,
      kind,
      amount,
      period,
      note,
      recorded_by: sessionEmail,
      debt_after: next.debt,
      overpayment_after: next.overpayment,
    });
    if (ledErr) throw ledErr;
    const { error: propErr } = await supabase
      .from('properties')
      .update({ debt: next.debt, overpayment: next.overpayment })
      .eq('id', property.id);
    if (propErr) throw propErr;
  }

  async function handleSaveSupportRate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSetSupportRate(staffRole)) {
      setError('Ставку таксы меняет только администратор.');
      return;
    }
    const rate = Number(supportRateInput.replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) {
      setError('Укажите ставку больше нуля (€/м² в год).');
      return;
    }
    setRateSaving(true);
    setError(null);
    try {
      const { error } = await supabase.from('building_settings').upsert({
        id: 1,
        support_rate_eur_per_sqm_year: rate,
        updated_at: new Date().toISOString(),
        updated_by: sessionEmail,
      });
      if (error) {
        if (isMissingRelation(error, 'building_settings')) {
          setSupportFeeMissing(true);
          throw new Error('Выполните supabase/support_fee.sql в SQL Editor.');
        }
        throw error;
      }
      setSupportRate(rate);
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Не удалось сохранить ставку');
    } finally {
      setRateSaving(false);
    }
  }

  async function handleRecordSupportPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!canRecordSupportPayments(staffRole)) {
      setError('Принимать таксу могут администратор и бухгалтер.');
      return;
    }
    const property = properties.find((p) => p.id === Number(payPropertyId));
    const amount = Number(String(payAmount).replace(',', '.'));
    if (!property) {
      setError('Выберите квартиру.');
      return;
    }
    setPaySaving(true);
    setError(null);
    try {
      const next = applySupportPayment(Number(property.debt ?? 0), Number(property.overpayment ?? 0), amount);
      await persistSupportBalances(property, 'payment', amount, next, null, payNote.trim() || 'Оплата таксы поддержки');
      setPayAmount('');
      setPayNote('');
      await loadAll();
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (isMissingRelation(err, 'support_fee_ledger')) {
        setSupportFeeMissing(true);
        setError('Выполните supabase/support_fee.sql в SQL Editor.');
      } else {
        setError(msg || 'Не удалось записать оплату');
      }
    } finally {
      setPaySaving(false);
    }
  }

  async function chargeSupportForProperty(property: Property, year: string) {
    const amount = annualSupportFee(property.area_sqm, supportRate);
    if (amount <= 0) return;
    const next = applySupportCharge(Number(property.debt ?? 0), Number(property.overpayment ?? 0), amount);
    await persistSupportBalances(
      property,
      'charge',
      amount,
      next,
      year,
      `Начисление таксы за ${year}`,
    );
  }

  async function handleChargeSupport(propertyIds: number[]) {
    if (!canRecordSupportPayments(staffRole)) {
      setError('Начислять таксу могут администратор и бухгалтер.');
      return;
    }
    const year = chargeYear.trim();
    if (!/^\d{4}$/.test(year)) {
      setError('Укажите год начисления, например 2026.');
      return;
    }
    const targets = properties.filter((p) => propertyIds.includes(p.id));
    if (targets.length === 0) return;
    if (!confirm(
      targets.length === 1
        ? `Начислить таксу ${annualSupportFee(targets[0].area_sqm, supportRate).toFixed(2)} € квартире ${targets[0].apartment_number} за ${year}?`
        : `Начислить годовую таксу всем выбранным квартирам (${targets.length}) за ${year}? Повторно за этот год начислить нельзя.`,
    )) return;
    setChargeSaving(true);
    setError(null);
    try {
      for (const property of targets) {
        try {
          await chargeSupportForProperty(property, year);
        } catch (err: any) {
          const msg = err?.message ?? '';
          if (msg.includes('support_fee_ledger_charge_period') || msg.includes('duplicate')) {
            continue;
          }
          throw err;
        }
      }
      await loadAll();
    } catch (err: any) {
      if (isMissingRelation(err, 'support_fee_ledger')) {
        setSupportFeeMissing(true);
        setError('Выполните supabase/support_fee.sql в SQL Editor.');
      } else {
        setError(err?.message ?? 'Не удалось начислить таксу');
      }
    } finally {
      setChargeSaving(false);
    }
  }

  function startEditStaff(s: StaffMember) {
    setEditingStaff(s);
    setStaffForm({
      name: s.name,
      role: s.role,
      phone: s.phone ?? '',
      email: s.email ?? '',
      salary_eur: String(s.salary_eur ?? ''),
      active: s.active,
    });
    setShowStaffForm(true);
  }

  function startNewStaff() {
    setEditingStaff(null);
    setStaffForm({ name: '', role: '', phone: '', email: '', salary_eur: '', active: true });
    setShowStaffForm(true);
  }

  async function handleSaveStaff(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: staffForm.name.trim(),
      role: staffForm.role.trim(),
      phone: staffForm.phone.trim() || null,
      email: staffForm.email.trim() ? normalizeEmail(staffForm.email) : null,
      salary_eur: Number(staffForm.salary_eur) || null,
      active: staffForm.active,
    };
    try {
      if (editingStaff) {
        const { error } = await supabase.from('staff').update(payload).eq('id', editingStaff.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('staff').insert(payload);
        if (error) throw error;
      }
      setShowStaffForm(false);
      await loadAll();
    } catch (e: any) {
      const msg = e?.message ?? 'Ошибка сохранения';
      setError(
        msg.includes('email')
          ? `${msg} Выполните supabase/staff_email.sql в SQL Editor.`
          : msg
      );
    }
  }

  async function handleDeleteStaff(id: number) {
    if (!confirm('Удалить сотрудника?')) return;
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  function startNewPoll() {
    setPollForm({
      title: '',
      body: '',
      category: 'ремонт',
      voting_starts: new Date().toISOString().slice(0, 10),
      deadline: '',
      budget_eur: '',
      created_by: 'УК',
      options: ['За', 'Против'],
    });
    setPollPhoto(null);
    setShowPollForm(true);
  }

  async function handleSavePoll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const title = pollForm.title.trim();
    const options = pollForm.options.map((o) => o.trim()).filter(Boolean);
    if (!title || options.length < 2) {
      setError('Нужны заголовок и минимум два варианта ответа.');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('polls')
        .insert({
          title,
          body: pollForm.body.trim() || null,
          category: pollForm.category,
          status: 'открыт',
          result: 'идёт',
          voting_starts: pollForm.voting_starts || null,
          deadline: pollForm.deadline || null,
          budget_eur: pollForm.budget_eur ? Number(pollForm.budget_eur) : null,
          created_by: pollForm.created_by.trim() || 'УК',
        })
        .select('id')
        .single();
      if (error) throw error;
      const pollId = data.id as number;
      const { error: optErr } = await supabase.from('poll_options').insert(
        options.map((label, i) => ({ poll_id: pollId, label, sort_order: i }))
      );
      if (optErr) throw optErr;
      if (pollPhoto) {
        const ext = pollPhoto.name.split('.').pop()?.toLowerCase() || 'jpg';
        const filePath = `polls/${pollId}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('request-photos')
          .upload(filePath, pollPhoto, { upsert: true });
        if (!uploadErr && uploadData) {
          const publicUrl = supabase.storage.from('request-photos').getPublicUrl(uploadData.path).data.publicUrl;
          await supabase.from('polls').update({ photo_url: publicUrl }).eq('id', pollId);
        }
      }
      setShowPollForm(false);
      setPollPhoto(null);
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка создания опроса');
    }
  }

  async function handleTogglePoll(poll: Poll) {
    try {
      if (poll.status === 'открыт') {
        const options = pollOptions.filter((o) => o.poll_id === poll.id);
        const votes = pollVotes.filter((v) => v.poll_id === poll.id);
        const tally = tallyPoll(options, votes, properties);
        const accepted = tally.accepted;
        const { error } = await supabase.from('polls').update({
          status: 'закрыт',
          result: accepted ? 'принято' : 'не принято',
          result_option_id: accepted ? tally.winner?.option.id ?? null : null,
        }).eq('id', poll.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('polls').update({
          status: 'открыт',
          result: 'идёт',
        }).eq('id', poll.id);
        if (error) throw error;
      }
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка смены статуса');
    }
  }

  async function handleDeletePoll(id: number) {
    if (!confirm('Удалить опрос и все голоса?')) return;
    try {
      const { error } = await supabase.from('polls').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка удаления');
    }
  }

  async function handleApproveTransfer(t: OwnerTransfer) {
    if (!confirm(`Утвердить смену собственника кв. ${propertyNameById(t.property_id)}?`)) return;
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({
          owner_name: t.to_owner_name,
          owner_email: normalizeEmail(t.to_owner_email),
          owner_phone: t.to_owner_phone,
        })
        .eq('id', t.property_id);
      if (updErr) throw updErr;
      const { error } = await supabase
        .from('owner_transfers')
        .update({
          status: 'утверждена',
          decided_at: new Date().toISOString(),
          decided_by: sessionEmail,
        })
        .eq('id', t.id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка утверждения');
    }
  }

  async function handleRejectTransfer(t: OwnerTransfer) {
    const reason = prompt('Причина отклонения (необязательно):') ?? '';
    try {
      const { error } = await supabase
        .from('owner_transfers')
        .update({
          status: 'отклонена',
          decided_at: new Date().toISOString(),
          decided_by: sessionEmail,
          reject_reason: reason.trim() || null,
        })
        .eq('id', t.id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка отклонения');
    }
  }

  async function handleUpdateRequestStatus(reqId: number, newStatus: string) {
    try {
      const { error } = await supabase.from('requests').update({ status: newStatus }).eq('id', reqId);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка обновления статуса');
    }
  }

  async function handleDeleteRequest(id: number) {
    if (!confirm('Удалить заявку?')) return;
    try {
      const { error } = await supabase.from('requests').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
  }

  // ---------- ОЧИСТКА ФИЛЬТРОВ ----------
  function clearAptFilters() {
    setAptSearch('');
    setAptFloorFilter('');
    setAptStatusFilter('');
    setAptOccupancyFilter('');
    setAptOwnerTypeFilter('');
    setAptDebtFilter('');
    setAptGuestsFilter('');
    setAptPetsFilter('');
    setAptSort('apartment_number_asc');
  }

  const aptActiveFiltersCount = [
    aptSearch, aptFloorFilter, aptStatusFilter, aptOccupancyFilter,
    aptOwnerTypeFilter, aptDebtFilter, aptGuestsFilter, aptPetsFilter,
  ].filter((v) => v !== '' && v !== 'apartment_number_asc').length
    + (aptSort !== 'apartment_number_asc' ? 1 : 0);

  function clearReqFilters() {
    setReqStatusFilter('');
    setReqCategoryFilter('');
    setReqPriorityFilter('');
    setReqAptFilter('');
    setReqSearch('');
  }

  const reqActiveFiltersCount = [
    reqStatusFilter, reqCategoryFilter, reqPriorityFilter, reqAptFilter, reqSearch,
  ].filter((v) => v !== '').length;

  // ===================================================================
  // РЕНДЕР СЕКЦИЙ
  // ===================================================================
  function renderContent() {
    switch (activeMenu) {
      // =============================================================
      // ОБЗОР
      // =============================================================
      case 'обзор': {
        const rentedCount = properties.filter((p) => p.occupancy_status === 'rented').length;
        const standbyCount = properties.filter((p) => p.occupancy_status === 'standby').length;
        const ownerCount = properties.filter((p) => p.occupancy_status === 'owner' || !p.occupancy_status).length;
        const petsCount = properties.filter((p) => p.pet_info && p.pet_info.trim() !== '').length;
        const forSaleCount = properties.filter((p) => listingStatus(p.status) === 'на продаже').length;
        const debtCount = properties.filter((p) => Number(p.debt ?? 0) > 0).length;
        const attention = [
          totalUnreadChats > 0 && { key: 'чат' as AdminSection, label: 'чаты', value: totalUnreadChats },
          activeRequests.length > 0 && { key: 'заявки' as AdminSection, label: 'заявки', value: activeRequests.length },
          openPollsCount > 0 && { key: 'опросы' as AdminSection, label: 'опросы', value: openPollsCount },
          pendingTransfersCount > 0 && { key: 'смены' as AdminSection, label: 'смены', value: pendingTransfersCount },
          pendingUkExpenses.length > 0 && { key: 'расходы' as AdminSection, label: 'расходы на проверке', value: pendingUkExpenses.length },
          totalDebt > 0 && { key: 'такса' as AdminSection, label: 'долг', value: `${totalDebt.toFixed(0)} €` },
        ].filter(Boolean) as { key: AdminSection; label: string; value: string | number }[];

        return (
          <div className="space-y-4">
            {attention.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attention.map((item) => (
                  <button
                    key={item.key + String(item.label)}
                    type="button"
                    onClick={() => setActiveMenu(item.key)}
                    className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/15"
                  >
                    {item.label}: <span className="font-semibold">{item.value}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <OverviewGroup
                title={t('admin.house')}
                hint={`${totalArea.toFixed(0)} м² · ${supportRate} €/м²`}
                actionLabel={t('admin.apartments')}
                onAction={() => setActiveMenu('квартиры')}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric label={t('admin.apts')} value={String(properties.length)} />
                  <Metric label={t('admin.forSale')} value={String(forSaleCount)} alert={forSaleCount > 0} />
                  <Metric label={t('admin.withPets')} value={String(petsCount)} />
                  <Metric label={t('admin.owner')} value={String(ownerCount)} />
                  <Metric label={t('admin.tenants')} value={String(rentedCount)} />
                  <Metric label={t('admin.away')} value={String(standbyCount)} />
                </div>
              </OverviewGroup>

              <OverviewGroup
                title={t('admin.fee')}
                hint={t('account.ukOnlyFee')}
                actionLabel={t('admin.publish')}
                onAction={() => setActiveMenu('такса')}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Metric label={t('admin.debt')} value={`${totalDebt.toFixed(2)} €`} alert={totalDebt > 0} />
                  <Metric label={t('admin.overpay')} value={`${totalOverpayment.toFixed(2)} €`} />
                  <Metric label={t('admin.withDebt')} value={String(debtCount)} alert={debtCount > 0} />
                  <Metric label={t('admin.feeYear')} value={`${annualSupportTotal.toFixed(0)} €`} />
                </div>
              </OverviewGroup>

              <OverviewGroup
                title={t('admin.work')}
                hint={`${staff.filter((s) => s.active).length}`}
                actionLabel={t('admin.requests')}
                onAction={() => setActiveMenu('заявки')}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Metric label={t('admin.activeReq')} value={String(activeRequests.length)} alert={activeRequests.length > 0} />
                  <Metric label={t('admin.unread')} value={String(totalUnreadChats)} alert={totalUnreadChats > 0} />
                  <Metric label={t('admin.openPolls')} value={String(openPollsCount)} alert={openPollsCount > 0} />
                  <Metric label={t('admin.ukSpend')} value={`${totalUkExpenses.toFixed(0)} €`} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setActiveMenu('чат')} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">{t('admin.chats')}</button>
                  <button type="button" onClick={() => setActiveMenu('опросы')} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">{t('admin.polls')}</button>
                  <button type="button" onClick={() => setActiveMenu('расходы')} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">{t('admin.expenses')}</button>
                  <button type="button" onClick={() => setActiveMenu('персонал')} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">{t('admin.staff')}</button>
                </div>
              </OverviewGroup>

              <OverviewGroup title={t('admin.floors')} hint={t('admin.floorDebtHint')}>
                {uniqueFloors.length === 0 ? (
                  <p className="text-sm text-white/40">{t('common.noData')}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {uniqueFloors.map((floor) => {
                      const floorApts = properties.filter((p) => Number(p.floor) === floor);
                      const floorDebt = floorApts.reduce((s, p) => s + Number(p.debt ?? 0), 0);
                      return (
                        <div key={floor} className="rounded-lg bg-white/[0.04] px-2.5 py-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm text-white">{floor} этаж</span>
                            <span className="text-xs text-white/40">{floorApts.length} кв.</span>
                          </div>
                          <div className={`mt-0.5 text-xs ${floorDebt > 0 ? 'text-yellow-300' : 'text-emerald-300/70'}`}>
                            {floorDebt.toFixed(0)} €
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </OverviewGroup>
            </div>

            <OverviewGroup
              title={t('admin.recentRequests')}
              actionLabel={t('common.all')}
              onAction={() => setActiveMenu('заявки')}
            >
              {requests.length === 0 ? (
                <p className="text-sm text-white/40">{t('admin.noRequests')}</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {requests.slice(0, 5).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white">{r.subject}</div>
                        <div className="truncate text-xs text-white/40">
                          {propertyFullById(r.property_id ?? 0)} · {labelPriority(r.priority, t)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                        r.status === 'новая' ? 'border-blue-500/30 text-blue-300' :
                        r.status === 'в работе' ? 'border-yellow-500/30 text-yellow-300' :
                        r.status === 'выполнена' ? 'border-emerald-500/30 text-emerald-300' :
                        'border-red-500/30 text-red-300'
                      }`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </OverviewGroup>
          </div>
        );
      }

      // =============================================================
      // КВАРТИРЫ
      // =============================================================
      case 'квартиры':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-emerald-400">{t('admin.apartments')}</h2>
                <span className="text-sm text-white/50">
                  {t('admin.shownOf', { n: filteredProperties.length, total: properties.length })}
                </span>
              </div>
              <div className="flex gap-2">
                {aptActiveFiltersCount > 0 && (
                  <button onClick={clearAptFilters}
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white/70 hover:bg-white/10">
                    {t('admin.resetN', { n: aptActiveFiltersCount })}
                  </button>
                )}
                <button onClick={startNewProp}
                  className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                  {t('admin.addPlus')}
                </button>
              </div>
            </div>

            {/* ФОРМА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ */}
            {showPropForm && (
              <form onSubmit={handleSaveProp}
                className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-300">
                  {editingProp ? t('admin.editApt') : t('admin.newApt')}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phAptNo')} value={propForm.apartment_number}
                    onChange={(e) => setPropForm({ ...propForm, apartment_number: e.target.value })} required />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phFloor')} type="number" value={propForm.floor}
                    onChange={(e) => setPropForm({ ...propForm, floor: e.target.value })} />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phArea')} type="number" value={propForm.area_sqm}
                    onChange={(e) => setPropForm({ ...propForm, area_sqm: e.target.value })} />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phOwner')} value={propForm.owner_name}
                    onChange={(e) => setPropForm({ ...propForm, owner_name: e.target.value })} required />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Email" type="email" value={propForm.owner_email}
                    onChange={(e) => setPropForm({ ...propForm, owner_email: e.target.value })} required />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phPhone')} value={propForm.owner_phone}
                    onChange={(e) => setPropForm({ ...propForm, owner_phone: e.target.value })} />
                  <select className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={propForm.owner_type}
                    onChange={(e) => setPropForm({ ...propForm, owner_type: e.target.value })}>
                    <option value="физическое лицо">{t('ownerType.personShort')}</option>
                    <option value="юридическое лицо">{t('ownerType.companyShort')}</option>
                  </select>
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phCompany')} value={propForm.company_name}
                    onChange={(e) => setPropForm({ ...propForm, company_name: e.target.value })} />
                  <select className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={propForm.status}
                    onChange={(e) => setPropForm({ ...propForm, status: e.target.value })}>
                    <option value="в собственности">{t('account.owned')}</option>
                    <option value="на продаже">{t('account.forSale')}</option>
                  </select>
                  <select className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={propForm.occupancy_status}
                    onChange={(e) => setPropForm({ ...propForm, occupancy_status: e.target.value })}>
                    <option value="owner">{t('status.occOwner')}</option>
                    <option value="standby">{t('status.occStandby')}</option>
                    <option value="rented">{t('status.occRented')}</option>
                  </select>
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phDebt')} type="number" value={propForm.debt}
                    onChange={(e) => setPropForm({ ...propForm, debt: e.target.value })} />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder={t('admin.phOver')} type="number" value={propForm.overpayment}
                    onChange={(e) => setPropForm({ ...propForm, overpayment: e.target.value })} />
                </div>
                <input className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                  placeholder={t('account.pets')} value={propForm.pet_info}
                  onChange={(e) => setPropForm({ ...propForm, pet_info: e.target.value })} />
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    {t('common.save')}
                  </button>
                  <button type="button" onClick={() => setShowPropForm(false)}
                    className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}

            {/* ПАНЕЛЬ ФИЛЬТРОВ */}
            <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-white/50">
                <span className="font-medium text-white/70">{t('common.filters')}</span>
                {aptActiveFiltersCount > 0 && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-300 rounded-full px-2 py-0.5">
                    {t('admin.activeN', { n: aptActiveFiltersCount })}
                  </span>
                )}
              </div>

              {/* Поиск */}
              <input className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white placeholder-white/40"
                placeholder={t('admin.searchApts')}
                value={aptSearch} onChange={(e) => setAptSearch(e.target.value)} />

              {/* Выпадающие фильтры */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <select value={aptFloorFilter} onChange={(e) => setAptFloorFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allFloors')}</option>
                  {uniqueFloors.map((f) => <option key={f} value={String(f)}>{t('form.floorN', { n: f })}</option>)}
                </select>

                <select value={aptStatusFilter} onChange={(e) => setAptStatusFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.anyStatus')}</option>
                  <option value="в собственности">{t('account.owned')}</option>
                  <option value="на продаже">{t('account.forSale')}</option>
                </select>

                <select value={aptOccupancyFilter} onChange={(e) => setAptOccupancyFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.anyMode')}</option>
                  <option value="owner">{t('status.occOwner')}</option>
                  <option value="standby">{t('status.occStandby')}</option>
                  <option value="rented">{t('status.occRented')}</option>
                </select>

                <select value={aptOwnerTypeFilter} onChange={(e) => setAptOwnerTypeFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.anyOwnerType')}</option>
                  <option value="физическое лицо">{t('ownerType.personShort')}</option>
                  <option value="юридическое лицо">{t('ownerType.companyShort')}</option>
                </select>

                <select value={aptDebtFilter} onChange={(e) => setAptDebtFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.anyDebt')}</option>
                  <option value="has_debt">{t('form.hasDebt')}</option>
                  <option value="no_debt">{t('form.noDebt')}</option>
                  <option value="debt_50">{t('form.debt50')}</option>
                  <option value="debt_100">{t('form.debt100')}</option>
                </select>

                <select value={aptGuestsFilter} onChange={(e) => setAptGuestsFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allGuests')}</option>
                  <option value="has_guests">{t('form.withGuests')}</option>
                  <option value="no_guests">{t('form.noGuests')}</option>
                </select>

                <select value={aptPetsFilter} onChange={(e) => setAptPetsFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allPets')}</option>
                  <option value="has_pets">{t('form.withPets')}</option>
                  <option value="no_pets">{t('form.noPets')}</option>
                </select>

                <select value={aptSort} onChange={(e) => setAptSort(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="apartment_number_asc">{t('form.sortAptAsc')}</option>
                  <option value="apartment_number_desc">{t('form.sortAptDesc')}</option>
                  <option value="debt_desc">{t('form.sortDebtDesc')}</option>
                  <option value="debt_asc">{t('form.sortDebtAsc')}</option>
                  <option value="area_desc">{t('form.sortAreaDesc')}</option>
                  <option value="area_asc">{t('form.sortAreaAsc')}</option>
                  <option value="owner_asc">{t('form.sortOwner')}</option>
                </select>
              </div>
            </div>

            {/* ТАБЛИЦА КВАРТИР */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/50 border-b border-white/10">
                    <th className="py-2 px-3">{t('form.colApt')}</th>
                    <th className="py-2 px-3">{t('form.colFloor')}</th>
                    <th className="py-2 px-3">{t('form.colArea')}</th>
                    <th className="py-2 px-3">{t('form.colOwner')}</th>
                    <th className="py-2 px-3">{t('form.colStatus')}</th>
                    <th className="py-2 px-3">{t('account.colType')}</th>
                    <th className="py-2 px-3">{t('account.debt')}</th>
                    <th className="py-2 px-3">{t('account.overpay')}</th>
                    <th className="py-2 px-3">{t('form.colFeeYear')}</th>
                    <th className="py-2 px-3">{t('form.colMode')}</th>
                    <th className="py-2 px-3">{t('form.colGuests')}</th>
                    <th className="py-2 px-3">{t('form.colPets')}</th>
                    <th className="py-2 px-3">{t('account.requests')}</th>
                    <th className="py-2 px-3">{t('form.colChat')}</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.map((p) => {
                    const g = guestsForProperty(p.id);
                    const reqs = requestsForProperty(p.id);
                    const chats = chatForProperty(p.id);
                    const unreadChats = chats.filter((m) => m.sender === 'owner' && !m.read_by_uk).length;
                    const annualFee = annualSupportFee(p.area_sqm, supportRate);
                    const listing = listingStatus(p.status);
                    return (
                      <tr key={p.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                        <td className="py-2 px-3 text-white font-medium">{p.apartment_number}</td>
                        <td className="py-2 px-3 text-white/70">{p.floor}</td>
                        <td className="py-2 px-3 text-white/70">{p.area_sqm} м²</td>
                        <td className="py-2 px-3">
                          <div className="text-white">{p.owner_name}</div>
                          <div className="text-xs text-white/40">{p.owner_email}</div>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex min-w-[5.5rem] flex-col items-center rounded-full border px-2 py-1 text-center text-[11px] leading-tight ${listingStatusClass(listing)}`}>
                            {labelListing(listing, t)}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white/50 text-xs">{p.owner_type === 'юридическое лицо' ? t('ownerType.companyShort') : t('ownerType.personShort')}</td>
                        <td className="py-2 px-3">
                          <span className={Number(p.debt) > 0 ? 'text-red-400 font-medium' : 'text-emerald-300'}>
                            {Number(p.debt ?? 0).toFixed(2)} €
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={Number(p.overpayment) > 0 ? 'text-emerald-300' : 'text-white/40'}>
                            {Number(p.overpayment ?? 0).toFixed(2)} €
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white/50 text-xs">{annualFee.toFixed(2)} €</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs rounded-full px-2 py-1 border ${occupancyBadgeClass(p.occupancy_status)}`}>
                            {occupancyLabel(p.occupancy_status)}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {g.length > 0 ? (
                            <span className="text-cyan-300 text-xs">{g.length} чел.</span>
                          ) : (
                            <span className="text-white/30 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-white/50 text-xs">
                          {p.pet_info ? '🐾' : '—'}
                        </td>
                        <td className="py-2 px-3">
                          {reqs.length > 0 ? (
                            <span className="text-xs text-white/70">{reqs.length}</span>
                          ) : (
                            <span className="text-white/30 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {chats.length > 0 ? (
                            <span className="text-xs text-white/70">
                              {chats.length} сообщ.
                              {unreadChats > 0 && (
                                <span className="ml-1 text-red-400 font-medium">({unreadChats} нов.)</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-white/30 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <button onClick={() => setDetailProperty(p)} title="Детали"
                              className="rounded px-2 py-1 text-xs bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-300">
                              👁
                            </button>
                            <button onClick={() => startEditProp(p)} title="Редактировать"
                              className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/10 text-white/80">✎</button>
                            <button onClick={() => handleDeleteProp(p.id)} title="Удалить"
                              className="rounded px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredProperties.length === 0 && (
              <div className="text-center text-sm text-white/40 py-8">
                Нет квартир по выбранным фильтрам.
              </div>
            )}

            {/* МОДАЛЬНОЕ ОКНО — ДЕТАЛЬНЫЙ ПРОСМОТР КВАРТИРЫ */}
            {detailProperty && (
              <ApartmentDetailModal
                property={detailProperty}
                requests={requestsForProperty(detailProperty.id)}
                meterReadings={metersForProperty(detailProperty.id)}
                guests={guestsForProperty(detailProperty.id)}
                chatMessages={chatForProperty(detailProperty.id)}
                supportRate={supportRate}
                onClose={() => setDetailProperty(null)}
                onEdit={() => { startEditProp(detailProperty); setDetailProperty(null); }}
                onOpenChat={() => { setSelectedChatProperty(detailProperty); setDetailProperty(null); setActiveMenu('чат'); }}
                onTakePayment={() => {
                  setPayPropertyId(detailProperty.id);
                  const debt = Number(detailProperty.debt ?? 0);
                  setPayAmount(
                    debt > 0
                      ? debt.toFixed(2)
                      : String(monthlySupportFee(detailProperty.area_sqm, supportRate)),
                  );
                  setDetailProperty(null);
                  setActiveMenu('такса');
                }}
              />
            )}
          </div>
        );

      // =============================================================
      // ЗАЯВКИ
      // =============================================================
      case 'смены':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-emerald-400 mb-1">{t('admin.transfers')}</h2>
            <p className="text-sm text-white/50 mb-4">
              {t('admin.transferLead')}
            </p>
            {ownerTransfers.length === 0 ? (
              <div className="text-sm text-white/40">{t('admin.noTransfers')}</div>
            ) : (
              <div className="space-y-3">
                {ownerTransfers.map((tr) => (
                  <div key={tr.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-white/50">{propertyFullById(tr.property_id)}</div>
                        <div className="mt-1 text-sm text-white/70">
                          {tr.from_owner_name} ({tr.from_owner_email}) → {tr.to_owner_name} ({tr.to_owner_email})
                        </div>
                        {tr.to_owner_phone && (
                          <div className="text-xs text-white/40">{t('form.tel', { n: tr.to_owner_phone })}</div>
                        )}
                        {tr.note && <div className="mt-2 text-sm text-white/60">{tr.note}</div>}
                        {tr.reject_reason && (
                          <div className="mt-1 text-xs text-red-300">{t('form.reason', { n: tr.reject_reason })}</div>
                        )}
                        <div className="mt-2 text-xs text-white/40">
                          {new Date(tr.created_at).toLocaleString(dateLocale)}
                          {tr.decided_by ? ` · ${tr.decided_by}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${transferStatusClass(tr.status)}`}>{labelTransfer(tr.status, t)}</div>
                        {tr.status === 'ожидает' && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleApproveTransfer(tr)}
                              className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-200"
                            >
                              {t('admin.approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectTransfer(tr)}
                              className="rounded-lg bg-red-500/15 border border-red-500/30 px-3 py-1.5 text-xs text-red-200"
                            >
                              {t('admin.reject')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'заявки':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-emerald-400">{t('admin.requests')}</h2>
                <span className="text-sm text-white/50">
                  {t('admin.shownOf', { n: filteredRequests.length, total: requests.length })}
                </span>
              </div>
              {reqActiveFiltersCount > 0 && (
                <button onClick={clearReqFilters}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white/70 hover:bg-white/10">
                    {t('admin.resetN', { n: reqActiveFiltersCount })}
                </button>
              )}
            </div>

            {/* ПАНЕЛЬ ФИЛЬТРОВ ЗАЯВОК */}
            <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
              <input className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white placeholder-white/40"
                placeholder={t('common.search')}
                value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select value={reqStatusFilter} onChange={(e) => setReqStatusFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allStatuses')}</option>
                  <option value="новая">{t('status.reqNew')}</option>
                  <option value="в работе">{t('status.reqWork')}</option>
                  <option value="выполнена">{t('status.reqDone')}</option>
                  <option value="отклонена">{t('status.reqReject')}</option>
                </select>
                <select value={reqCategoryFilter} onChange={(e) => setReqCategoryFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allCategories')}</option>
                  <option value="сантехника">{t('cat.plumbing')}</option>
                  <option value="электрика">{t('cat.electric')}</option>
                  <option value="уборка">{t('cat.cleaning')}</option>
                  <option value="отопление">{t('cat.heating')}</option>
                  <option value="другое">{t('cat.other')}</option>
                </select>
                <select value={reqPriorityFilter} onChange={(e) => setReqPriorityFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.anyPriority')}</option>
                  <option value="низкий">{t('status.prioLow')}</option>
                  <option value="средний">{t('status.prioMid')}</option>
                  <option value="высокий">{t('status.prioHigh')}</option>
                </select>
                <select value={reqAptFilter} onChange={(e) => setReqAptFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">{t('form.allApts')}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {t('form.aptOwner', { n: p.apartment_number, owner: p.owner_name ?? '' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* СПИСОК ЗАЯВОК */}
            <div className="space-y-3">
              {filteredRequests.length === 0 && <div className="text-sm text-white/40">{t('form.noRequestsFound')}</div>}
              {filteredRequests.map((r) => (
                <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium">{r.subject}</div>
                      <div className="text-sm text-white/50 mt-1">{r.description}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-xs text-white/40">{propertyFullById(r.property_id ?? 0)}</span>
                        <span className="text-xs rounded-full bg-white/10 px-2 py-0.5 text-white/70 border border-white/15">{labelCategory(r.category, t)}</span>
                        <span className={`text-xs rounded-full px-2 py-0.5 border ${priorityClass(r.priority)}`}>
                          {labelPriority(r.priority, t)}
                        </span>
                        {r.photo_url && (
                          <a href={r.photo_url} target="_blank" rel="noreferrer"
                            className="text-xs text-cyan-300 hover:underline">{t('form.photo')}</a>
                        )}
                      </div>
                      <div className="text-xs text-white/40 mt-2">
                        {new Date(r.created_at).toLocaleString(dateLocale)}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <select value={r.status ?? 'новая'}
                        onChange={(e) => handleUpdateRequestStatus(r.id, e.target.value)}
                        className="rounded-lg border border-white/10 bg-[#101816] px-3 py-1.5 text-sm text-white">
                        <option value="новая">{t('status.reqNew')}</option>
                        <option value="в работе">{t('status.reqWork')}</option>
                        <option value="выполнена">{t('status.reqDone')}</option>
                        <option value="отклонена">{t('status.reqReject')}</option>
                      </select>
                      <button onClick={() => handleDeleteRequest(r.id)}
                        className="text-xs text-red-400 hover:text-red-300">{t('common.delete')}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // =============================================================
      // СЧЁТЧИКИ
      // =============================================================
      case 'счётчики':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-emerald-400">Показания счётчиков</h2>
              <button onClick={() => setShowMeterForm(true)}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                + Добавить
              </button>
            </div>

            {/* ФИЛЬТРЫ СЧЁТЧИКОВ */}
            <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <select value={meterAptFilter} onChange={(e) => setMeterAptFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">Все квартиры</option>
                  {properties.map((p) => (
                    <option key={p.id} value={String(p.id)}>кв. {p.apartment_number} — {p.owner_name}</option>
                  ))}
                </select>
                <select value={meterTypeFilter} onChange={(e) => setMeterTypeFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white">
                  <option value="">Все типы</option>
                  <option value="electricity_day">Э/э день</option>
                  <option value="electricity_night">Э/э ночь</option>
                  <option value="cold_water">Холодная вода</option>
                </select>
                {(meterAptFilter !== '' || meterTypeFilter !== '') && (
                  <button onClick={() => { setMeterAptFilter(''); setMeterTypeFilter(''); }}
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white/70 hover:bg-white/10">
                    Сбросить
                  </button>
                )}
              </div>
            </div>

            {showMeterForm && (
              <form onSubmit={handleSaveMeter}
                className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-300">Новое показание</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <select className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={meterForm.property_id}
                    onChange={(e) => setMeterForm({ ...meterForm, property_id: e.target.value })} required>
                    <option value="">Выберите квартиру</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>кв. {p.apartment_number} — {p.owner_name}</option>
                    ))}
                  </select>
                  <select className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={meterForm.meter_type}
                    onChange={(e) => setMeterForm({ ...meterForm, meter_type: e.target.value as any })}>
                    <option value="electricity_day">Э/э день</option>
                    <option value="electricity_night">Э/э ночь</option>
                    <option value="cold_water">Холодная вода</option>
                  </select>
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Показание" type="number" step="0.01" value={meterForm.value}
                    onChange={(e) => setMeterForm({ ...meterForm, value: e.target.value })} required />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    type="date" value={meterForm.reading_date}
                    onChange={(e) => setMeterForm({ ...meterForm, reading_date: e.target.value })} required />
                </div>
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setShowMeterForm(false)}
                    className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                    Отмена
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/50 border-b border-white/10">
                    <th className="py-2 px-3">Квартира</th>
                    <th className="py-2 px-3">Тип</th>
                    <th className="py-2 px-3">Показание</th>
                    <th className="py-2 px-3">Дата</th>
                    <th className="py-2 px-3">Кто внёс</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMeters.slice(0, 100).map((m) => (
                    <tr key={m.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                      <td className="py-2 px-3 text-white">{propertyNameById(m.property_id)}</td>
                      <td className="py-2 px-3 text-white/70">
                        {m.meter_type === 'electricity_day' ? 'Э/э день' :
                         m.meter_type === 'electricity_night' ? 'Э/э ночь' : 'Вода'}
                      </td>
                      <td className="py-2 px-3 text-white">{m.value}</td>
                      <td className="py-2 px-3 text-white/50">
                        {new Date(m.reading_date).toLocaleDateString(dateLocale)}
                      </td>
                      <td className="py-2 px-3 text-white/50">{m.submitted_by ?? '—'}</td>
                      <td className="py-2 px-3">
                        <button onClick={() => handleDeleteMeter(m.id)}
                          className="rounded px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredMeters.length === 0 && (
              <div className="text-center text-sm text-white/40 py-4">Показаний не найдено.</div>
            )}
          </div>
        );

      // =============================================================
      // РАСХОДЫ УК
      // =============================================================
      case 'расходы': {
        const yearsToShow =
          expenseYearFilter === 'all' ? expenseYears : [expenseYearFilter];
        const visibleTotal =
          expenseYearFilter === 'all'
            ? totalUkExpenses
            : expensesByYear.get(expenseYearFilter)?.total ?? 0;
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-emerald-400">Расходы УК</h2>
                <div className="text-sm text-white/50 mt-1">
                  Опубликовано {expenseYearFilter === 'all' ? 'всего' : expenseYearFilter}: {visibleTotal.toFixed(2)} €
                  {pendingUkExpenses.length > 0 && (
                    <span className="ml-2 text-amber-200">
                      · на проверке {pendingUkExpenses.length} ({pendingUkExpenses.reduce((s, x) => s + Number(x.amount ?? 0), 0).toFixed(2)} €)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-white/40">
                  {t('admin.expenseHint')}
                </p>
              </div>
              <button onClick={startNewExpense}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                + Добавить
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={() => setExpenseYearFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  expenseYearFilter === 'all'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-white/[0.04] text-white/50 border-white/10 hover:text-white/80'
                }`}
              >
                Все годы
              </button>
              {expenseYears.map((year) => {
                const total = expensesByYear.get(year)?.total ?? 0;
                return (
                  <button
                    key={year}
                    onClick={() => setExpenseYearFilter(year)}
                    className={`rounded-lg px-3 py-1.5 text-sm border ${
                      expenseYearFilter === year
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-white/[0.04] text-white/50 border-white/10 hover:text-white/80'
                    }`}
                  >
                    {year}
                    <span className="ml-2 text-xs text-white/40">{total.toFixed(2)} €</span>
                    {(expensesByYear.get(year)?.pendingTotal ?? 0) > 0 && (
                      <span className="ml-1 text-xs text-amber-200">+{expensesByYear.get(year)?.pendingTotal.toFixed(0)}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {showExpenseForm && (
              <form onSubmit={handleSaveExpense}
                className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-300">
                  {editingExpense ? 'Редактировать расход' : 'Новый расход'}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="date" required
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={expenseForm.expense_date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} />
                  <input type="number" step="0.01" min="0.01" required
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Сумма (€)" value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                  <input
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white sm:col-span-2"
                    placeholder="Куда потрачено (ремонт, уборка, материалы...)"
                    value={expenseForm.title}
                    onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs text-white/50">
                    Фото чека и покупки — до {MAX_EXPENSE_PHOTOS} шт.
                  </p>
                  {(expenseExistingUrls.length > 0 || expensePhotoFiles.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {expenseExistingUrls.map((url) => (
                        <div key={url} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="h-16 w-16 rounded-lg border border-white/10 object-cover" />
                          <button
                            type="button"
                            onClick={() => setExpenseExistingUrls((prev) => prev.filter((u) => u !== url))}
                            className="absolute -right-1 -top-1 rounded-full bg-black/70 px-1.5 text-xs text-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {expensePhotoFiles.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={URL.createObjectURL(file)} alt="" className="h-16 w-16 rounded-lg border border-white/10 object-cover" />
                          <button
                            type="button"
                            onClick={() => setExpensePhotoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute -right-1 -top-1 rounded-full bg-black/70 px-1.5 text-xs text-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {expenseExistingUrls.length + expensePhotoFiles.length < MAX_EXPENSE_PHOTOS && (
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="w-full text-sm text-white/50 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white/80"
                      onChange={(e) => {
                        const room = MAX_EXPENSE_PHOTOS - expenseExistingUrls.length - expensePhotoFiles.length;
                        const added = Array.from(e.target.files ?? []).slice(0, room);
                        setExpensePhotoFiles((prev) => [...prev, ...added]);
                        e.target.value = '';
                      }}
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    {editingExpense && isExpensePublished(editingExpense) && canApproveUkExpenses(staffRole)
                      ? 'Сохранить'
                      : 'Отправить на утверждение'}
                  </button>
                  <button type="button" onClick={() => { setShowExpenseForm(false); setEditingExpense(null); setExpensePhotoFiles([]); }}
                    className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                    Отмена
                  </button>
                </div>
              </form>
            )}
            {ukExpenses.length === 0 && !showExpenseForm ? (
              <div className="text-center text-sm text-white/40 py-4">Расходов пока нет.</div>
            ) : (
              <div className="space-y-6">
                {yearsToShow.map((year) => {
                  const group = expensesByYear.get(year);
                  const items = group?.items ?? [];
                  return (
                    <div key={year}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-emerald-300">{year}</h3>
                        <span className="text-sm text-white/50">
                          опубликовано {(group?.total ?? 0).toFixed(2)} €
                          {(group?.pendingTotal ?? 0) > 0 && (
                            <span className="ml-2 text-amber-200">на проверке {(group?.pendingTotal ?? 0).toFixed(2)} €</span>
                          )}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <div className="text-sm text-white/40 py-2">За {year} год расходов нет.</div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((exp) => {
                            const published = isExpensePublished(exp);
                            const photos = expensePhotoUrls(exp);
                            return (
                              <div key={exp.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium text-white">{exp.title?.trim() || 'Без названия'}</span>
                                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                        published
                                          ? 'border-emerald-500/30 text-emerald-300'
                                          : 'border-amber-500/30 text-amber-200'
                                      }`}>
                                        {published ? 'опубликован' : 'на проверке'}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs text-white/40">
                                      {formatUkDate(exp.expense_date)} · {exp.created_by || 'УК'}
                                      {exp.approved_by ? ` · утвердил ${exp.approved_by}` : ''}
                                    </div>
                                    {photos.length > 0 && (
                                      <div className="mt-2">
                                        <ExpensePhotoStrip urls={photos} size="sm" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-2">
                                    <div className="text-sm font-semibold text-white">{Number(exp.amount).toFixed(2)} €</div>
                                    <div className="flex flex-wrap justify-end gap-1">
                                      {!published && canApproveUkExpenses(staffRole) && (
                                        <button
                                          type="button"
                                          onClick={() => handleApproveExpense(exp)}
                                          className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200"
                                        >
                                          Опубликовать
                                        </button>
                                      )}
                                      {( !published || canApproveUkExpenses(staffRole) ) && (
                                        <button type="button" onClick={() => startEditExpense(exp)}
                                          className="rounded px-2 py-1 text-xs bg-white/10 text-white/80">✎</button>
                                      )}
                                      <button type="button" onClick={() => handleDeleteExpense(exp.id)}
                                        className="rounded px-2 py-1 text-xs bg-red-900/50 text-red-300">✕</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      // =============================================================
      // ПЕРСОНАЛ
      // =============================================================
      case 'персонал':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-emerald-400">Персонал</h2>
              <button onClick={startNewStaff}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                + Добавить
              </button>
            </div>
            {showStaffForm && (
              <form onSubmit={handleSaveStaff}
                className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-300">
                  {editingStaff ? 'Редактировать сотрудника' : 'Новый сотрудник'}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Имя" value={staffForm.name}
                    onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} required />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    list="staff-roles"
                    placeholder="Должность" value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} required />
                  <datalist id="staff-roles">
                    {STAFF_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role} />
                    ))}
                  </datalist>
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Email для входа" type="email" value={staffForm.email}
                    onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Телефон" value={staffForm.phone}
                    onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
                  <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Зарплата (€/мес)" type="number" value={staffForm.salary_eur}
                    onChange={(e) => setStaffForm({ ...staffForm, salary_eur: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input type="checkbox" checked={staffForm.active}
                      onChange={(e) => setStaffForm({ ...staffForm, active: e.target.checked })} />
                    Активен
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setShowStaffForm(false)}
                    className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                    Отмена
                  </button>
                </div>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/50 border-b border-white/10">
                    <th className="py-2 px-3">Имя</th>
                    <th className="py-2 px-3">Должность</th>
                    <th className="py-2 px-3">Email</th>
                    <th className="py-2 px-3">Телефон</th>
                    <th className="py-2 px-3">Зарплата</th>
                    <th className="py-2 px-3">Статус</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="border-b border-white/10 hover:bg-white/[0.04]">
                      <td className="py-2 px-3 text-white">{s.name}</td>
                      <td className="py-2 px-3 text-white/70">{s.role}</td>
                      <td className="py-2 px-3 text-white/50">{s.email ?? '—'}</td>
                      <td className="py-2 px-3 text-white/50">{s.phone ?? '—'}</td>
                      <td className="py-2 px-3 text-white">
                        {s.salary_eur ? `${Number(s.salary_eur).toFixed(2)} €` : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <span className={s.active ? 'text-emerald-300' : 'text-white/40'}>
                          {s.active ? 'Активен' : 'Неактивен'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex gap-1">
                          <button onClick={() => startEditStaff(s)}
                            className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/10 text-white/80">✎</button>
                          <button onClick={() => handleDeleteStaff(s.id)}
                            className="rounded px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      // =============================================================
      // ОПРОСЫ
      // =============================================================
      case 'опросы':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-emerald-400">Опросы жильцов</h2>
                <button onClick={startNewPoll}
                  className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                  + Новый опрос
                </button>
              </div>
              {showPollForm && (
                <form onSubmit={handleSavePoll}
                  className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-emerald-300">Вынести на рассмотрение</h3>
                  <select
                    className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    value={pollForm.category}
                    onChange={(e) => setPollForm({ ...pollForm, category: e.target.value as PollCategory })}
                  >
                    <option value="ремонт">Ремонт</option>
                    <option value="покупка">Покупка</option>
                    <option value="опрос">Опрос</option>
                  </select>
                  <input className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Что купить или отремонтировать?" value={pollForm.title}
                    onChange={(e) => setPollForm({ ...pollForm, title: e.target.value })} required />
                  <textarea className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                    placeholder="Пояснение для жильцов" rows={3} value={pollForm.body}
                    onChange={(e) => setPollForm({ ...pollForm, body: e.target.value })} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="text-xs text-white/50 mb-1 block">Начало голосования</label>
                      <input type="date"
                        className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                        value={pollForm.voting_starts}
                        onChange={(e) => setPollForm({ ...pollForm, voting_starts: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 mb-1 block">Окончание голосования</label>
                      <input type="date"
                        className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                        value={pollForm.deadline}
                        onChange={(e) => setPollForm({ ...pollForm, deadline: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 mb-1 block">Бюджет (€)</label>
                      <input type="number" step="0.01" min="0"
                        className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                        placeholder="0.00" value={pollForm.budget_eur}
                        onChange={(e) => setPollForm({ ...pollForm, budget_eur: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Фото</label>
                    <input type="file" accept="image/*"
                      className="w-full text-sm text-white/50 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white/80"
                      onChange={(e) => setPollPhoto(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-white/50">Варианты ответа</div>
                    {pollForm.options.map((opt, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="flex-1 rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                          value={opt}
                          onChange={(e) => {
                            const next = [...pollForm.options];
                            next[i] = e.target.value;
                            setPollForm({ ...pollForm, options: next });
                          }}
                          required
                        />
                        {pollForm.options.length > 2 && (
                          <button type="button"
                            onClick={() => setPollForm({
                              ...pollForm,
                              options: pollForm.options.filter((_, idx) => idx !== i),
                            })}
                            className="rounded px-2 text-xs text-red-300 bg-red-900/40">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}
                      className="text-xs text-emerald-300 hover:text-emerald-400">
                      + Добавить вариант
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit"
                      className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                      Опубликовать
                    </button>
                    <button type="button" onClick={() => setShowPollForm(false)}
                      className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                      Отмена
                    </button>
                  </div>
                </form>
              )}
              {polls.length === 0 && !showPollForm && (
                <div className="text-sm text-white/40">Опросов нет. Создайте голосование по покупке или ремонту.</div>
              )}
              <div className="space-y-4">
                {polls.map((poll) => {
                  const options = pollOptions
                    .filter((o) => o.poll_id === poll.id)
                    .sort((a, b) => a.sort_order - b.sort_order);
                  const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
                  const history = pollVoteHistory.filter((h) => h.poll_id === poll.id);
                  const open = isPollAcceptingVotes(poll);
                  const tally = tallyPoll(options, votesForPoll, properties);
                  const decision = pollDecisionLabel(poll, tally.accepted);
                  return (
                    <div key={poll.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className={`text-xs rounded-full px-2 py-0.5 border ${pollCategoryClass(poll.category)}`}>
                              {poll.category}
                            </span>
                            <span className={`text-xs ${open ? 'text-emerald-300' : 'text-white/40'}`}>
                              {poll.status}
                            </span>
                            <span className={`text-xs ${
                              decision === 'принято' ? 'text-emerald-300' :
                              decision === 'не принято' ? 'text-red-300' : 'text-white/50'
                            }`}>
                              {decision}
                            </span>
                          </div>
                          <h3 className="text-white font-semibold">{poll.title}</h3>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleTogglePoll(poll)}
                            className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/10 text-white/80">
                            {poll.status === 'открыт' ? 'Закрыть' : 'Открыть'}
                          </button>
                          <button onClick={() => handleDeletePoll(poll.id)}
                            className="rounded px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300">
                            Удалить
                          </button>
                        </div>
                      </div>
                      <PollDetails poll={poll} options={options} votes={votesForPoll} properties={properties} />
                      <div className="mt-3">
                        <PollOptionBars poll={poll} options={options} votes={votesForPoll} properties={properties} alwaysShowStats />
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedPollHistory(expandedPollHistory === poll.id ? null : poll.id)}
                        className="mt-3 text-xs text-emerald-300 hover:text-emerald-400"
                      >
                        {expandedPollHistory === poll.id ? 'Скрыть историю' : `История голосования (${history.length})`}
                      </button>
                      {expandedPollHistory === poll.id && (
                        <div className="mt-2 overflow-x-auto">
                          {history.length === 0 ? (
                            <div className="text-xs text-white/40">Записей пока нет.</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-white/40 border-b border-white/10">
                                  <th className="py-1 pr-2">Когда</th>
                                  <th className="py-1 pr-2">Квартира</th>
                                  <th className="py-1 pr-2">Голос</th>
                                  <th className="py-1 text-right">Вес, м²</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.map((h) => (
                                  <tr key={h.id} className="border-b border-white/10 text-white/70">
                                    <td className="py-1 pr-2">
                                      {new Date(h.created_at).toLocaleString(dateLocale)}
                                    </td>
                                    <td className="py-1 pr-2">{propertyNameById(h.property_id)}</td>
                                    <td className="py-1 pr-2">
                                      {options.find((o) => o.id === h.option_id)?.label ?? h.option_id}
                                    </td>
                                    <td className="py-1 text-right">{Number(h.weight ?? 0).toFixed(1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );

      // =============================================================
      // ОБЪЯВЛЕНИЯ
      // =============================================================
      case 'объявления':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-emerald-400">Объявления</h2>
              <button onClick={() => setShowAnnForm(true)}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                + Создать
              </button>
            </div>
            {showAnnForm && (
              <form onSubmit={handleSaveAnn}
                className="mb-6 rounded-xl border border-emerald-700/50 bg-white/[0.05] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-300">Новое объявление</h3>
                <input className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                  placeholder="Заголовок" value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} required />
                <textarea className="w-full rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                  placeholder="Текст объявления" rows={4} value={annForm.body}
                  onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })} required />
                <input className="rounded-lg border border-white/10 bg-[#101816] px-3 py-2 text-sm text-white"
                  placeholder="От кого" value={annForm.created_by}
                  onChange={(e) => setAnnForm({ ...annForm, created_by: e.target.value })} />
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    Опубликовать
                  </button>
                  <button type="button" onClick={() => setShowAnnForm(false)}
                    className="rounded-lg border border-white/10 bg-[#101816] px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                    Отмена
                  </button>
                </div>
              </form>
            )}
            <div className="space-y-3">
              {announcements.length === 0 && <div className="text-sm text-white/40">Объявлений нет.</div>}
              {announcements.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-semibold">{a.title}</h3>
                    <button onClick={() => handleDeleteAnn(a.id)}
                      className="text-xs text-red-400 hover:text-red-300">Удалить</button>
                  </div>
                  <p className="text-sm text-white/70 whitespace-pre-wrap">{a.body}</p>
                  <div className="mt-2 text-xs text-white/40">
                    {a.created_by && `От: ${a.created_by} · `}
                    {new Date(a.created_at).toLocaleString(dateLocale)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // =============================================================
      // ЧАТ
      // =============================================================
      case 'чат':
        return (
          <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
            style={{ height: 'calc(100vh - 160px)' }}>
            <div className="w-72 flex-shrink-0 border-r border-white/10 flex flex-col">
              <div className="px-4 py-3 border-b border-white/10 bg-white/[0.05]">
                <h2 className="text-sm font-semibold text-emerald-400">
                  Диалоги {totalUnreadChats > 0 && `(${totalUnreadChats} новых)`}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                {chatProperties.length === 0 ? (
                  <div className="p-4 text-sm text-white/40">Нет активных диалогов.</div>
                ) : (
                  chatProperties.map((item) => (
                    <button key={item.property.id}
                      onClick={() => setSelectedChatProperty(item.property)}
                      className={`w-full text-left px-4 py-3 border-b border-white/10 hover:bg-white/[0.04] transition-colors ${
                        selectedChatProperty?.id === item.property.id ? 'bg-emerald-500/10 border-l-2 border-l-emerald-500' : ''
                      }`}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-white font-medium truncate">
                            кв. {item.property.apartment_number}
                          </div>
                          <div className="text-xs text-white/40 truncate">{item.property.owner_name}</div>
                          {item.lastMessage && (
                            <div className="text-xs text-white/30 truncate mt-1">
                              {item.lastMessage.sender === 'owner' ? '' : 'УК: '}{item.lastMessage.message}
                            </div>
                          )}
                        </div>
                        {item.unread > 0 && (
                          <span className="ml-2 flex-shrink-0 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                            {item.unread}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              {selectedChatProperty ? (
                <>
                  <div className="px-5 py-3 border-b border-white/10 bg-white/[0.05] flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-emerald-400">
                        кв. {selectedChatProperty.apartment_number} — {selectedChatProperty.owner_name}
                      </h2>
                      <div className="text-xs text-white/40">
                        {selectedChatProperty.owner_email}
                        {selectedChatProperty.owner_phone && ` · ${selectedChatProperty.owner_phone}`}
                        {' · '}
                        <span className={occupancyColor(selectedChatProperty.occupancy_status)}>
                          {occupancyLabel(selectedChatProperty.occupancy_status)}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedChatProperty(null)}
                      className="text-white/50 hover:text-white/80 text-sm">✕ Закрыть</button>
                  </div>
                  <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                    {chatMessages.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-sm text-white/40">
                        Нет сообщений.
                      </div>
                    ) : (
                      chatMessages.map((m) => {
                        const isUk = m.sender === 'uk';
                        return (
                          <div key={m.id} className={`flex ${isUk ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                              isUk ? 'bg-teal-600 text-gray-50 rounded-br-sm'
                                   : 'bg-white/10 text-white rounded-bl-sm border border-white/15'
                            }`}>
                              <div className="whitespace-pre-wrap break-words">{m.message}</div>
                              <div className={`mt-1 text-[10px] ${isUk ? 'text-teal-200/70' : 'text-white/50'}`}>
                                {new Date(m.created_at).toLocaleString(dateLocale,
                                  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {!m.read_by_uk && !isUk && <span className="ml-2 text-red-400">● новое</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <form onSubmit={handleSendChat}
                    className="flex items-center gap-2 p-3 border-t border-white/10 bg-white/[0.05]">
                    <input className="flex-1 rounded-lg border border-white/10 bg-[#101816] px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-teal-500/50"
                      value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ответ жильцу..." disabled={chatSending} />
                    <button type="submit" disabled={chatSending || !chatInput.trim()}
                      className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed">
                      {chatSending ? '...' : 'Отправить'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-white/40">
                  Выберите диалог слева
                </div>
              )}
            </div>
          </div>
        );

      // =============================================================
      // ТАКСА ПОДДЕРЖКИ
      // =============================================================
      case 'такса': {
        const canPay = canRecordSupportPayments(staffRole);
        const canRate = canSetSupportRate(staffRole);
        const selectedPay = properties.find((p) => p.id === Number(payPropertyId));
        const yearCharges = ledger.filter((e) => e.kind === 'charge' && e.period === chargeYear);
        const yearPayments = ledger.filter((e) => e.kind === 'payment').reduce((s, e) => s + Number(e.amount), 0);
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
              УК принимает только таксу поддержки. Электричество и воду собственники платят сами.
            </div>

            {supportFeeMissing && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Нет таблиц в базе. Выполните <span className="font-mono text-amber-200">supabase/support_fee.sql</span> в SQL Editor.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">Ставка таксы</p>
                <div className="mt-1 text-3xl font-semibold text-white">{supportRate} € <span className="text-base font-normal text-white/40">/ м² в год</span></div>
                <p className="mt-2 text-sm text-white/45">
                  По дому {annualSupportTotal.toFixed(2)} € в год
                </p>
                {canRate ? (
                  <form onSubmit={handleSaveSupportRate} className="mt-4 flex flex-wrap items-end gap-2">
                    <label className="text-sm text-white/60">
                      Новая ставка
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={supportRateInput}
                        onChange={(e) => setSupportRateInput(e.target.value)}
                        className="mt-1 block w-36 rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={rateSaving || supportFeeMissing}
                      className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {rateSaving ? 'Сохранение…' : 'Сохранить ставку'}
                    </button>
                  </form>
                ) : (
                  <p className="mt-3 text-xs text-white/40">Ставку меняет только администратор.</p>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">Начисление за год</p>
                <p className="mt-2 text-sm text-white/50">
                  Добавляет годовую таксу в долг (переплата гасится первой). Повторно за тот же год не начисляется.
                </p>
                <div className="mt-4 flex flex-wrap items-end gap-2">
                  <label className="text-sm text-white/60">
                    Год
                    <input
                      type="number"
                      min="2020"
                      max="2100"
                      value={chargeYear}
                      onChange={(e) => setChargeYear(e.target.value)}
                      className="mt-1 block w-28 rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={chargeSaving || !canPay || supportFeeMissing}
                    onClick={() => handleChargeSupport(properties.map((p) => p.id))}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
                  >
                    {chargeSaving ? 'Начисление…' : `Начислить всем (${chargeYear})`}
                  </button>
                </div>
                <p className="mt-2 text-xs text-white/35">Уже начислено за {chargeYear}: {yearCharges.length} кв.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">Принять оплату таксы</p>
              {!canPay && (
                <p className="mt-2 text-sm text-amber-200">Принимать оплату могут администратор и бухгалтер.</p>
              )}
              <form onSubmit={handleRecordSupportPayment} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm text-white/60 sm:col-span-2">
                  Квартира
                  <select
                    required
                    disabled={!canPay}
                    value={payPropertyId}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : '';
                      setPayPropertyId(id);
                      const p = properties.find((x) => x.id === id);
                      if (!p) return;
                      const debt = Number(p.debt ?? 0);
                      setPayAmount(
                        debt > 0 ? debt.toFixed(2) : String(monthlySupportFee(p.area_sqm, supportRate)),
                      );
                    }}
                    className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                  >
                    <option value="">Выберите квартиру</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        № {p.apartment_number} · {p.owner_name ?? 'без владельца'} · долг {Number(p.debt ?? 0).toFixed(2)} €
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-white/60">
                  Сумма €
                  <input
                    required
                    disabled={!canPay}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-sm text-white/60">
                  Комментарий
                  <input
                    disabled={!canPay}
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder="Наличные, банк…"
                    className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                  />
                </label>
                {selectedPay && (
                  <div className="sm:col-span-2 flex flex-wrap gap-2 text-xs">
                    <button type="button" className="rounded-full border border-white/10 px-3 py-1 text-white/70"
                      onClick={() => setPayAmount(Number(selectedPay.debt ?? 0) > 0 ? Number(selectedPay.debt).toFixed(2) : '0.01')}>
                      Весь долг
                    </button>
                    <button type="button" className="rounded-full border border-white/10 px-3 py-1 text-white/70"
                      onClick={() => setPayAmount(String(monthlySupportFee(selectedPay.area_sqm, supportRate)))}>
                      Месяц
                    </button>
                    <button type="button" className="rounded-full border border-white/10 px-3 py-1 text-white/70"
                      onClick={() => setPayAmount(String(annualSupportFee(selectedPay.area_sqm, supportRate)))}>
                      Год
                    </button>
                  </div>
                )}
                <div className="sm:col-span-2 lg:col-span-4">
                  <button
                    type="submit"
                    disabled={!canPay || paySaving || supportFeeMissing}
                    className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {paySaving ? 'Запись…' : 'Внести оплату'}
                  </button>
                </div>
              </form>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">Журнал таксы</p>
                <p className="text-xs text-white/40">Оплаты в журнале: {yearPayments.toFixed(2)} €</p>
              </div>
              {ledger.length === 0 ? (
                <p className="mt-3 text-sm text-white/40">Записей пока нет.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-white/40 border-b border-white/10">
                        <th className="py-2 pr-3">Дата</th>
                        <th className="py-2 pr-3">Кв.</th>
                        <th className="py-2 pr-3">Тип</th>
                        <th className="py-2 pr-3">Сумма</th>
                        <th className="py-2 pr-3">После</th>
                        <th className="py-2 pr-3">Кто</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.slice(0, 40).map((row) => {
                        const apt = properties.find((p) => p.id === row.property_id);
                        return (
                          <tr key={row.id} className="border-b border-white/5">
                            <td className="py-2 pr-3 text-white/50">
                              {new Date(row.created_at).toLocaleString(dateLocale)}
                            </td>
                            <td className="py-2 pr-3 text-white">{apt?.apartment_number ?? row.property_id}</td>
                            <td className="py-2 pr-3">
                              <span className={row.kind === 'payment' ? 'text-emerald-300' : 'text-amber-200'}>
                                {row.kind === 'payment' ? 'оплата' : `начисление ${row.period ?? ''}`}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-white">{Number(row.amount).toFixed(2)} €</td>
                            <td className="py-2 pr-3 text-white/50 text-xs">
                              долг {Number(row.debt_after ?? 0).toFixed(2)} · +{Number(row.overpayment_after ?? 0).toFixed(2)}
                            </td>
                            <td className="py-2 pr-3 text-white/40 text-xs">{row.recorded_by ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  }

  if (!allowed || loading) {
    return (
      <div className="min-h-screen bg-[#070b0a] text-white flex items-center justify-center">
        <div className="text-lg text-white/50">{t('admin.loading')}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-[#070b0a] text-white">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label={t('common.closeMenu')}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(18rem,88vw)] flex-col border-r border-white/10 bg-[#101816] transition-transform duration-300 md:pointer-events-auto md:static md:h-auto md:w-auto md:flex-shrink-0 ${
        sidebarOpen
          ? 'translate-x-0 md:w-64'
          : 'pointer-events-none -translate-x-full md:pointer-events-auto md:w-16 md:translate-x-0'
      }`}>
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          {sidebarOpen && <BrandMark compact />}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg bg-white/10 p-2 text-white/70 md:hidden"
            aria-label={t('common.closeMenu')}
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden rounded-lg bg-white/10 p-1.5 text-white/70 md:block"
            title={sidebarOpen ? t('common.collapse') : t('common.expand')}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {MENU_ITEMS.map((item) => (
            <button key={item.key} onClick={() => {
              setActiveMenu(item.key);
              if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
            }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeMenu === item.key
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent'
              }`} title={item.label}>
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              {sidebarOpen && (
                <span className="flex items-center gap-2 truncate">
                  {item.label}
                  {item.key === 'чат' && totalUnreadChats > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {totalUnreadChats}
                    </span>
                  )}
                  {item.key === 'смены' && pendingTransfersCount > 0 && (
                    <span className="ml-auto bg-amber-500 text-gray-900 text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {pendingTransfersCount}
                    </span>
                  )}
                  {item.key === 'опросы' && openPollsCount > 0 && (
                    <span className="ml-auto bg-amber-500 text-gray-900 text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {openPollsCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-white/10 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {sidebarOpen ? (
            <div className="space-y-2">
              <LanguageSwitcher compact />
              <div className="text-xs text-white/40 truncate">{sessionEmail}</div>
              {hasCabinet && (
                <Link href="/account"
                  className="block text-center text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-emerald-300">
                  {t('account.myApts')}
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  clearSessionEmail();
                  router.replace('/account');
                }}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-white/10 px-2 text-sm"
              >
                {t('common.logout')}
              </button>
              <Link href="/"
                className="block text-center text-xs rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 hover:bg-white/10">
                {t('common.home')}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {hasCabinet && (
                <Link href="/account" className="p-1.5 rounded-lg bg-emerald-500/20 text-xs" title={t('account.myApts')}>🏠</Link>
              )}
              <button
                type="button"
                onClick={() => {
                  clearSessionEmail();
                  router.replace('/account');
                }}
                className="p-1.5 rounded-lg bg-white/10 text-xs"
                title={t('common.logout')}
              >
                🚪
              </button>
              <Link href="/" className="p-1.5 rounded-lg bg-white/10 hover:bg-white/10 text-xs" title={t('common.home')}>←</Link>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#070b0a]/90 px-3 py-2.5 backdrop-blur md:px-6 md:py-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold md:text-xl">
              {MENU_ITEMS.find((m) => m.key === activeMenu)?.icon}{' '}
              {MENU_ITEMS.find((m) => m.key === activeMenu)?.label}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearSessionEmail();
                router.replace('/account');
              }}
              className="min-h-10 rounded-lg border border-white/15 px-3 text-sm text-white/80 md:hidden"
            >
              {t('common.logout')}
            </button>
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <LanguageSwitcher compact />
              <Link href="/" className="text-sm text-white/50 hover:text-white/80">{t('common.backHome')}</Link>
            </div>
          </div>
        </div>
        <div className="p-3 md:p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-red-800 bg-red-900/20 p-4 text-red-200">
              {error}
              <button onClick={() => setError(null)} className="ml-3 text-xs text-red-400 hover:text-red-300">✕</button>
            </div>
          )}
          {renderContent()}
        </div>
      </main>
      <MobileBottomNav
        items={[
          { key: 'обзор', label: t('admin.overview'), icon: '📊' },
          { key: 'заявки', label: t('admin.requests'), icon: '📋' },
          { key: 'расходы', label: t('admin.expenses'), icon: '🧾' },
          { key: 'чат', label: t('account.tabChat'), icon: '💬', badge: totalUnreadChats || undefined },
        ]}
        activeKey={activeMenu}
        moreActive={!['обзор', 'заявки', 'расходы', 'чат'].includes(activeMenu)}
        onSelect={(key) => setActiveMenu(key as AdminSection)}
        onMore={() => setSidebarOpen(true)}
        hidden={sidebarOpen}
      />
    </div>
  );
}

// =====================================================================
// КАРТОЧКА СТАТИСТИКИ
// =====================================================================
function OverviewGroup({
  title,
  hint,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">{title}</h2>
          {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
        </div>
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs text-emerald-300 hover:bg-white/5"
          >
            {actionLabel ?? 'Открыть'}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${alert ? 'text-yellow-300' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

// =====================================================================
// МОДАЛЬНОЕ ОКНО — ДЕТАЛЬНЫЙ ПРОСМОТР ВСЕХ ДАННЫХ КВАРТИРЫ
// =====================================================================
function ApartmentDetailModal({
  property, requests, meterReadings, guests, chatMessages, supportRate, onClose, onEdit, onOpenChat, onTakePayment,
}: {
  property: Property;
  requests: Request[];
  meterReadings: MeterReading[];
  guests: ApartmentGuest[];
  chatMessages: ChatMessage[];
  supportRate: number;
  onClose: () => void;
  onEdit: () => void;
  onOpenChat: () => void;
  onTakePayment: () => void;
}) {
  const { t, dateLocale } = useI18n();
  const [activeTab, setActiveTab] = useState<'инфо' | 'финансы' | 'счётчики' | 'заявки' | 'жильцы' | 'чат'>('инфо');

  const annualFee = annualSupportFee(property.area_sqm, supportRate);
  const monthlyFee = monthlySupportFee(property.area_sqm, supportRate);
  const unreadChats = chatMessages.filter((m) => m.sender === 'owner' && !m.read_by_uk).length;

  function meterTypeLabel(kind: string) {
    if (kind === 'electricity_day') return t('form.elDayShort');
    if (kind === 'electricity_night') return t('form.elNightShort');
    return t('account.water');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#101816] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* ШАПКА */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-xl font-semibold text-emerald-400">
              Кв. {property.apartment_number} — {property.owner_name}
            </h3>
            <div className="text-xs text-white/40 mt-1">
              {property.owner_email}{property.owner_phone && ` · ${property.owner_phone}`}
              {' · '}
              <span className={
                property.occupancy_status === 'owner' ? 'text-emerald-300' :
                property.occupancy_status === 'standby' ? 'text-yellow-300' : 'text-cyan-300'
              }>
                {property.occupancy_status === 'owner' ? 'Собственник' :
                 property.occupancy_status === 'standby' ? 'В отъезде' : 'Арендаторы'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onOpenChat}
              className="rounded-lg border border-teal-600/50 bg-teal-600/20 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-600/30">
              💬 Чат {unreadChats > 0 && `(${unreadChats})`}
            </button>
            <button onClick={onEdit}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
              ✎ Редактировать
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white/80 text-xl px-2">✕</button>
          </div>
        </div>

        {/* ВКЛАДКИ */}
        <div className="px-6 pt-3 border-b border-white/10 flex gap-1 flex-shrink-0 overflow-x-auto">
          {[
            { key: 'инфо', label: 'Инфо', count: null },
            { key: 'финансы', label: 'Финансы', count: null },
            { key: 'счётчики', label: 'Счётчики', count: meterReadings.length },
            { key: 'заявки', label: 'Заявки', count: requests.length },
            { key: 'жильцы', label: 'Жильцы', count: guests.length },
            { key: 'чат', label: 'Чат', count: chatMessages.length },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 text-sm rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-300 bg-white/[0.04]'
                  : 'border-transparent text-white/50 hover:text-white/80'
              }`}>
              {tab.label}
              {tab.count !== null && tab.count > 0 && (
                <span className="ml-1 text-xs bg-white/10 rounded-full px-1.5 py-0.5 text-white/70">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* КОНТЕНТ ВКЛАДОК */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ИНФО */}
          {activeTab === 'инфо' && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoRow label="Номер квартиры" value={String(property.apartment_number ?? '—')} />
                <InfoRow label="Этаж" value={String(property.floor ?? '—')} />
                <InfoRow label="Площадь" value={`${property.area_sqm ?? '—'} м²`} />
                <InfoRow label="Статус" value={listingStatus(property.status)} />
                <InfoRow label="Владелец" value={property.owner_name ?? '—'} />
                <InfoRow label="Тип собственника" value={property.owner_type ?? '—'} />
                <InfoRow label="Email" value={property.owner_email ?? '—'} />
                <InfoRow label="Телефон" value={property.owner_phone ?? '—'} />
                {property.company_name && <InfoRow label="Компания" value={property.company_name} />}
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-white/50 text-xs mb-2">Режим проживания</div>
                <div className={`text-lg font-medium ${
                  property.occupancy_status === 'owner' ? 'text-emerald-300' :
                  property.occupancy_status === 'standby' ? 'text-yellow-300' : 'text-cyan-300'
                }`}>
                  {property.occupancy_status === 'owner' ? '🏠 Собственник проживает' :
                   property.occupancy_status === 'standby' ? '✈️ В отъезде' : '👥 Арендаторы'}
                </div>
              </div>
              {property.pet_info && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-white/50 text-xs mb-1">🐾 Питомцы</div>
                  <div className="text-white">{property.pet_info}</div>
                </div>
              )}
            </div>
          )}

          {/* ФИНАНСЫ */}
          {activeTab === 'финансы' && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-white/50 text-xs">Задолженность</div>
                  <div className={`text-2xl font-bold mt-1 ${
                    Number(property.debt) > 0 ? 'text-red-400' : 'text-emerald-300'
                  }`}>
                    {Number(property.debt ?? 0).toFixed(2)} €
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-white/50 text-xs">Переплата</div>
                  <div className={`text-2xl font-bold mt-1 ${
                    Number(property.overpayment) > 0 ? 'text-emerald-300' : 'text-white/40'
                  }`}>
                    {Number(property.overpayment ?? 0).toFixed(2)} €
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-white/50 text-xs">Такса поддержки (годовая)</div>
                  <div className="text-xl font-semibold text-white mt-1">
                    {annualFee.toFixed(2)} €
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    {supportRate} €/м² × {property.area_sqm} м²
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-white/50 text-xs">Такса поддержки (мес.)</div>
                  <div className="text-xl font-semibold text-white mt-1">
                    {monthlyFee.toFixed(2)} €
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-white/50 text-xs mb-2">Тарифы</div>
                <div className="grid gap-1 text-xs text-white/70 sm:grid-cols-2">
                  <div>Э/э день: {DAY_RATE} €/кВтч</div>
                  <div>Э/э ночь: {NIGHT_RATE} €/кВтч</div>
                  <div>Вода: {WATER_RATE} €/м³</div>
                  <div>Такса: {supportRate} €/м²·год</div>
                </div>
                <p className="mt-2 text-xs text-white/40">Электричество и воду собственник платит сам. УК принимает только таксу поддержки.</p>
                <button
                  type="button"
                  onClick={onTakePayment}
                  className="mt-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  Принять оплату таксы
                </button>
              </div>
            </div>
          )}

          {/* СЧЁТЧИКИ */}
          {activeTab === 'счётчики' && (
            <div>
              {meterReadings.length === 0 ? (
                <div className="text-sm text-white/40">Показаний счётчиков нет.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/50 border-b border-white/10">
                      <th className="py-2 px-3">Тип</th>
                      <th className="py-2 px-3">Показание</th>
                      <th className="py-2 px-3">Дата</th>
                      <th className="py-2 px-3">Кто внёс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meterReadings.map((m) => (
                      <tr key={m.id} className="border-b border-white/10">
                        <td className="py-2 px-3 text-white">{meterTypeLabel(m.meter_type)}</td>
                        <td className="py-2 px-3 text-white">{m.value}</td>
                        <td className="py-2 px-3 text-white/50">
                          {new Date(m.reading_date).toLocaleDateString(dateLocale)}
                        </td>
                        <td className="py-2 px-3 text-white/50">{m.submitted_by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ЗАЯВКИ */}
          {activeTab === 'заявки' && (
            <div className="space-y-3">
              {requests.length === 0 ? (
                <div className="text-sm text-white/40">Заявок нет.</div>
              ) : (
                requests.map((r) => (
                  <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-white font-medium text-sm">{r.subject}</div>
                      <span className={`text-xs rounded-full px-2 py-1 border ${
                        r.status === 'новая' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' :
                        r.status === 'в работе' ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' :
                        r.status === 'выполнена' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                        'bg-red-500/15 text-red-300 border-red-500/30'
                      }`}>{labelRequestStatus(r.status, t)}</span>
                    </div>
                    <div className="text-sm text-white/50 mt-1">{r.description}</div>
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs text-white/40">{labelCategory(r.category, t)} · {labelPriority(r.priority, t)}</span>
                      {r.photo_url && (
                        <a href={r.photo_url} target="_blank" rel="noreferrer"
                          className="text-xs text-cyan-300 hover:underline">📷 Фото</a>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      {new Date(r.created_at).toLocaleString(dateLocale)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ЖИЛЬЦЫ */}
          {activeTab === 'жильцы' && (
            <div>
              {guests.length === 0 ? (
                <div className="text-sm text-white/40">Жильцы не зарегистрированы.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/50 border-b border-white/10">
                      <th className="py-2 px-3">№</th>
                      <th className="py-2 px-3">Имя</th>
                      <th className="py-2 px-3">Фамилия</th>
                      <th className="py-2 px-3">Год рожд.</th>
                      <th className="py-2 px-3">Тип</th>
                      <th className="py-2 px-3">Заезд</th>
                      <th className="py-2 px-3">Отъезд</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g, i) => (
                      <tr key={g.id} className="border-b border-white/10">
                        <td className="py-2 px-3 text-white/40">{i + 1}</td>
                        <td className="py-2 px-3 text-white">{g.first_name}</td>
                        <td className="py-2 px-3 text-white">{g.last_name}</td>
                        <td className="py-2 px-3 text-white/70">{g.birth_year ?? '—'}</td>
                        <td className="py-2 px-3">
                          {g.is_child ? <span className="text-yellow-300">Ребёнок</span>
                                     : <span className="text-emerald-300">Взрослый</span>}
                        </td>
                        <td className="py-2 px-3 text-white/50 text-xs">
                          {g.check_in ? new Date(g.check_in).toLocaleDateString(dateLocale) : '—'}
                        </td>
                        <td className="py-2 px-3 text-white/50 text-xs">
                          {g.check_out ? new Date(g.check_out).toLocaleDateString(dateLocale) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ЧАТ */}
          {activeTab === 'чат' && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-white/40">Нет сообщений.</div>
              ) : (
                chatMessages.map((m) => {
                  const isOwner = m.sender === 'owner';
                  return (
                    <div key={m.id} className={`flex ${isOwner ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                        isOwner ? 'bg-white/10 text-white border border-white/15' : 'bg-teal-600 text-gray-50'
                      }`}>
                        <div className="text-xs text-white/50 mb-1">
                          {isOwner ? 'Жилец' : 'УК'}
                        </div>
                        <div className="whitespace-pre-wrap break-words">{m.message}</div>
                        <div className="text-[10px] text-white/40 mt-1">
                          {new Date(m.created_at).toLocaleString(dateLocale)}
                          {isOwner && !m.read_by_uk && <span className="ml-2 text-red-400">● не прочитано</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/10">
      <span className="text-white/50">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}