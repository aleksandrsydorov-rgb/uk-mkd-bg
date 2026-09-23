'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/database.types';
import Link from 'next/link';
import {
  accountVoteWeight,
  isMissingRelation,
  isPollAcceptingVotes,
  pollCategoryClass,
  pollDecisionLabel,
  tallyFromAggregates,
  type Poll,
  type PollOption,
  type PollTallyAggregate,
  type PollVote,
} from '@/lib/polls';
import { PollDetails, PollOptionBars } from '@/components/PollPanel';
import { BrandMark } from '@/components/BrandMark';
import { LoginScreen } from '@/components/LoginScreen';
import { ApartmentPicker } from '@/components/ApartmentPicker';
import { listingStatus, listingStatusClass, transferStatusClass, type OwnerTransfer } from '@/lib/ownership';
import {
  labelCategory,
  labelListing,
  labelOwnerType,
  labelOccupantKind,
  labelPollCategory,
  labelPollDecision,
  labelPriority,
  labelRequestStatus,
  labelTransfer,
} from '@/i18n/labels';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { DEFAULT_SUPPORT_RATE, annualSupportFee, monthlySupportFee, type SupportFeeEntry } from '@/lib/finance';
import { OwnerUtilities, type FinanceTab, type MeterTab } from '@/components/account/OwnerUtilities';
import { OwnerElectricity } from '@/components/account/OwnerElectricity';
import type { WaterTariff, WaterMode } from '@/lib/utilities';
import { DEFAULT_WATER_MODE, parseWaterMode, isOwnerModuleEnabled } from '@/lib/utilities';
import {
  DEFAULT_ELECTRICITY_MODE,
  parseElectricityMode,
  pairElectricityReadings,
  activeElectricityMeter,
  electricityActiveMeterReadings,
  type ElectricityMode,
  type ElectricityMeter,
} from '@/lib/electricity';
import { expensePhotoUrls, isExpensePublished } from '@/lib/expenses';
import { ExpensePhotoStrip } from '@/components/ExpensePhotoStrip';
import { ChatMedia } from '@/components/ChatMedia';
import { MAX_CHAT_FILE_BYTES } from '@/lib/chatMedia';
import { normalizeOccupantKind, type ApartmentPet, type OccupantKind } from '@/lib/registry';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { useI18n } from '@/i18n/I18nProvider';
type Category = 'сантехника' | 'электрика' | 'уборка' | 'отопление' | 'другое';
type Priority = 'низкий' | 'средний' | 'высокий';
type OccupancyStatus = 'owner' | 'standby' | 'rented';

type Property = Database['public']['Tables']['properties']['Row'] & {
  occupancy_status?: OccupancyStatus | string | null;
  pet_info?: string | null;
};
type Request = Database['public']['Tables']['requests']['Row'];
type Announcement = Database['public']['Tables']['announcements']['Row'];
type UkExpense = Database['public']['Tables']['uk_expenses']['Row'];

interface MeterReading {
  id: number;
  property_id: number;
  meter_type: 'electricity_day' | 'electricity_night' | 'cold_water';
  value: number;
  reading_date: string;
  submitted_by: string | null;
  created_at?: string;
  submitted_source?: string | null;
  idempotency_key?: string | null;
  electricity_meter_id?: string | null;
}

interface ChatMessage {
  id: number;
  created_at: string;
  property_id: number;
  sender: 'owner' | 'uk';
  message: string;
  read_by_uk: boolean;
  read_by_owner: boolean;
  photo_url?: string | null;
  file_name?: string | null;
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
  is_permanent?: boolean | null;
}

type MenuSection =
  | 'квартира'
  | 'жильцы'
  | 'финансы'
  | 'расходы_ук'
  | 'счётчики'
  | 'заявки'
  | 'сообщения'
  | 'опросы'
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

export default function AccountPage() {
  const router = useRouter();
  const { t, dateLocale } = useI18n();
  const [supabase] = useState(() => createClient());
  const MENU_ITEMS: { key: MenuSection; label: string; icon: string }[] = [
    { key: 'квартира', label: t('account.apt'), icon: '🏠' },
    { key: 'жильцы', label: t('account.occupancy'), icon: '👥' },
    { key: 'финансы', label: t('account.finance'), icon: '💰' },
    { key: 'счётчики', label: t('account.meters'), icon: '⚡' },
    { key: 'заявки', label: t('account.requests'), icon: '📋' },
    { key: 'сообщения', label: t('account.announcements'), icon: '📢' },
    { key: 'расходы_ук', label: t('account.expenses'), icon: '🧾' },
    { key: 'опросы', label: t('account.polls'), icon: '🗳️' },
    { key: 'чат', label: t('account.chat'), icon: '💬' },
  ];
  // ---------- DEV-ЛОГИН ----------
  const [devEmail, setDevEmail] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);

  // ---------- ОСНОВНЫЕ ДАННЫЕ ----------
  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const property = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId) ?? properties[0] ?? null,
    [properties, selectedPropertyId]
  );
  const [requests, setRequests] = useState<Request[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ukExpenses, setUkExpenses] = useState<UkExpense[]>([]);
  const [supportRate, setSupportRate] = useState(DEFAULT_SUPPORT_RATE);
  const [electricityMode, setElectricityMode] = useState<ElectricityMode>(DEFAULT_ELECTRICITY_MODE);
  const [waterMode, setWaterMode] = useState<WaterMode>(DEFAULT_WATER_MODE);
  const waterEnabled = isOwnerModuleEnabled(waterMode);
  const electricityEnabled = isOwnerModuleEnabled(electricityMode);
  const [waterTariff, setWaterTariff] = useState<WaterTariff | null>(null);
  const [supportLedger, setSupportLedger] = useState<SupportFeeEntry[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollOptions, setPollOptions] = useState<PollOption[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [pollTallies, setPollTallies] = useState<PollTallyAggregate[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ---------- СЧЁТЧИКИ ----------
  const [meterReadings, setMeterReadings] = useState<{
    electricity_day: MeterReading[];
    electricity_night: MeterReading[];
    cold_water: MeterReading[];
  }>({ electricity_day: [], electricity_night: [], cold_water: [] });
  const [electricityMeters, setElectricityMeters] = useState<ElectricityMeter[]>([]);

  // ---------- ЖИЛЬЦЫ ----------
  const [guests, setGuests] = useState<ApartmentGuest[]>([]);
  const [guestForm, setGuestForm] = useState({
    first_name: '',
    last_name: '',
    birth_year: '',
    is_child: false,
    check_in: '',
    check_out: '',
    is_permanent: true,
  });
  const [pets, setPets] = useState<ApartmentPet[]>([]);
  const [petForm, setPetForm] = useState({ species: 'dog', name: '', chip_no: '', passport_no: '' });
  const [petSaving, setPetSaving] = useState(false);
  const [petInfo, setPetInfo] = useState<string>('');
  const [occupancySaving, setOccupancySaving] = useState(false);
  const [guestAdding, setGuestAdding] = useState(false);
  const [occupantForm, setOccupantForm] = useState({
    name: '',
    phone: '',
    email: '',
    until: '',
  });

  // ---------- ЧАТ ----------
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- МЕНЮ ----------
  const [activeMenu, setActiveMenu] = useState<MenuSection>('квартира');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expenseYearFilter, setExpenseYearFilter] = useState<number | 'all'>(
    new Date().getFullYear()
  );
  const [financeTab, setFinanceTab] = useState<FinanceTab>('support');
  const [meterTab, setMeterTab] = useState<MeterTab>('water');

  // ---------- ФОРМА ЗАЯВКИ ----------
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('другое');
  const [priority, setPriority] = useState<Priority>('средний');
  const [photo, setPhoto] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [votingPollId, setVotingPollId] = useState<number | null>(null);
  const [listingSaving, setListingSaving] = useState(false);
  const [transfers, setTransfers] = useState<OwnerTransfer[]>([]);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [ownerTransferOpen, setOwnerTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    to_owner_name: '',
    to_owner_email: '',
    to_owner_phone: '',
    note: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function restoreUser() {
      try {
        const { data } = await supabase.auth.getUser();
        const authenticatedEmail = normalizeEmail(data.user?.email ?? '');
        if (authenticatedEmail && !cancelled) {
          setDevEmail(authenticatedEmail);
          setEmailInput(authenticatedEmail);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    void restoreUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const email = normalizeEmail(emailInput);
    if (!email || !passwordInput) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: passwordInput,
      });
      if (error) {
        setLoginError(error.message);
        return;
      }
      const authenticatedEmail = normalizeEmail(data.user?.email ?? '');
      if (!authenticatedEmail) {
        setLoginError('No email on authenticated user');
        return;
      }
      setEmailInput(authenticatedEmail);
      setDevEmail(authenticatedEmail);
      setPasswordInput('');
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Local session is still cleared below.
    } finally {
      setDevEmail('');
      setEmailInput('');
      setPasswordInput('');
      setLoginError('');
      setIsStaff(false);
      setProperties([]);
      setSelectedPropertyId(null);
      setRequests([]);
      setAnnouncements([]);
      setUkExpenses([]);
      setPolls([]);
      setPollOptions([]);
      setPollVotes([]);
      setPollTallies([]);
      setTransfers([]);
      setGuests([]);
      setMeterReadings({ electricity_day: [], electricity_night: [], cold_water: [] });
      setElectricityMeters([]);
      setChatMessages([]);
      setUnreadChatCount(0);
      setError(null);
      router.replace('/');
    }
  }

  // ===================================================================
  // ЗАГРУЗКА ВСЕХ ДАННЫХ
  // ===================================================================
  useEffect(() => {
    async function load() {
      if (!devEmail) return;
      setLoading(true);
      setError(null);
      try {
        const access = await resolveAccess(devEmail, supabase);
        setIsStaff(access.isStaff);
        if (!access.isOwner) {
          setProperties([]);
          setSelectedPropertyId(null);
          if (access.isStaff) {
            router.replace('/admin');
            return;
          }
          setError(t('account.noAccess'));
          return;
        }

        setProperties(access.properties);
        const nextId =
          selectedPropertyId && access.properties.some((p) => p.id === selectedPropertyId)
            ? selectedPropertyId
            : access.properties[0].id;
        setSelectedPropertyId(nextId);
        const ids = access.properties.map((p) => p.id);
        const selected = access.properties.find((p) => p.id === nextId) ?? access.properties[0];
        setPetInfo(selected.pet_info ?? '');

        const { data: reqData, error: reqErr } = await supabase
          .from('requests')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false });
        if (reqErr) throw reqErr;
        setRequests(reqData ?? []);

        const { data: annData, error: annErr } = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', { ascending: false });
        if (annErr) throw annErr;
        setAnnouncements(annData ?? []);

        const { data: expData, error: expErr } = await supabase
          .from('uk_expenses')
          .select('*')
          .order('expense_date', { ascending: false });
        if (expErr) {
          const msg = expErr.message ?? '';
          if (!msg.includes('uk_expenses') && !msg.includes('schema cache')) throw expErr;
          setUkExpenses([]);
        } else {
          setUkExpenses((expData as UkExpense[]) ?? []);
        }

        const [pollsRes, optRes, voteRes, tallyRes] = await Promise.all([
          supabase.from('polls').select('*').order('created_at', { ascending: false }),
          supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
          supabase.from('poll_votes').select('*'),
          supabase.rpc('get_poll_tallies'),
        ]);
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
        if (tallyRes.error) {
          if (!isMissingRelation(tallyRes.error, 'get_poll_tallies')) throw tallyRes.error;
          setPollTallies([]);
        } else {
          setPollTallies((tallyRes.data as PollTallyAggregate[]) ?? []);
        }

        const { data: trData, error: trErr } = await supabase
          .from('owner_transfers')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false });
        if (trErr) {
          if (!isMissingRelation(trErr, 'owner_transfers')) throw trErr;
          setTransfers([]);
        } else {
          setTransfers((trData as OwnerTransfer[]) ?? []);
        }

        const settingsRes = await supabase.from('building_settings').select('*').eq('id', 1).maybeSingle();
        if (settingsRes.error) {
          if (!isMissingRelation(settingsRes.error, 'building_settings')) throw settingsRes.error;
          setSupportRate(DEFAULT_SUPPORT_RATE);
        } else {
          const rate = Number(settingsRes.data?.support_rate_eur_per_sqm_year ?? DEFAULT_SUPPORT_RATE);
          setSupportRate(rate > 0 ? rate : DEFAULT_SUPPORT_RATE);
          setElectricityMode(parseElectricityMode(settingsRes.data?.electricity_mode));
          setWaterMode(parseWaterMode(settingsRes.data?.water_mode));
        }

        const waterTariffRes = await supabase
          .from('water_tariffs')
          .select('*')
          .order('valid_from', { ascending: false })
          .limit(1);
        if (waterTariffRes.error) {
          if (!isMissingRelation(waterTariffRes.error, 'water_tariffs')) throw waterTariffRes.error;
          setWaterTariff(null);
        } else {
          setWaterTariff(((waterTariffRes.data as WaterTariff[] | null) ?? [])[0] ?? null);
        }

        const ledRes = await supabase
          .from('support_fee_ledger')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false })
          .limit(50);
        if (ledRes.error) {
          if (!isMissingRelation(ledRes.error, 'support_fee_ledger')) throw ledRes.error;
          setSupportLedger([]);
        } else {
          setSupportLedger((ledRes.data as SupportFeeEntry[]) ?? []);
        }
      } catch (e: any) {
        setError(e?.message ?? t('err.load'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [devEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const fromFinance = url.searchParams.get('financeTab');
      if (fromFinance === 'support' || fromFinance === 'water' || fromFinance === 'capital') {
        setFinanceTab(fromFinance);
      } else {
        const storedFinance = sessionStorage.getItem('amadeus-finance-tab');
        if (storedFinance === 'support' || storedFinance === 'water' || storedFinance === 'capital') {
          setFinanceTab(storedFinance);
        }
      }
      const fromMeter = url.searchParams.get('meterTab');
      const storedMeter = sessionStorage.getItem('amadeus-meter-tab');
      const candidate =
        fromMeter === 'water' || fromMeter === 'electricity'
          ? fromMeter
          : storedMeter === 'water' || storedMeter === 'electricity'
            ? storedMeter
            : null;
      if (candidate) setMeterTab(candidate);
    } catch {
      /* ignore */
    }
  }, []);

  const reloadMeterReadings = useCallback(async (propertyId: number) => {
    const [dayRes, nightRes, waterRes, metersRes] = await Promise.all([
      supabase
        .from('meter_readings')
        .select('*')
        .eq('property_id', propertyId)
        .eq('meter_type', 'electricity_day')
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('meter_readings')
        .select('*')
        .eq('property_id', propertyId)
        .eq('meter_type', 'electricity_night')
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('meter_readings')
        .select('*')
        .eq('property_id', propertyId)
        .eq('meter_type', 'cold_water')
        .order('reading_date', { ascending: false })
        .limit(2),
      supabase
        .from('electricity_meters')
        .select('*')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false }),
    ]);
    if (dayRes.error) throw dayRes.error;
    if (nightRes.error) throw nightRes.error;
    if (waterRes.error) throw waterRes.error;
    if (metersRes.error) {
      if (!isMissingRelation(metersRes.error, 'electricity_meters')) throw metersRes.error;
      setElectricityMeters([]);
    } else {
      setElectricityMeters((metersRes.data as ElectricityMeter[]) ?? []);
    }
    setMeterReadings({
      electricity_day: (dayRes.data as MeterReading[]) ?? [],
      electricity_night: (nightRes.data as MeterReading[]) ?? [],
      cold_water: (waterRes.data as MeterReading[]) ?? [],
    });
  }, [supabase]);

  useEffect(() => {
    async function loadPropertyScoped() {
      if (!property) return;
      setPetInfo(property.pet_info ?? '');
      setOccupantForm({
        name: property.occupant_name ?? '',
        phone: property.occupant_phone ?? '',
        email: property.occupant_email ?? '',
        until: property.occupant_until ? String(property.occupant_until).slice(0, 10) : '',
      });
      try {
        const { data: guestData, error: guestErr } = await supabase
          .from('apartment_guests')
          .select('*')
          .eq('property_id', property.id)
          .order('created_at', { ascending: true });
        if (guestErr) throw guestErr;
        setGuests((guestData as ApartmentGuest[]) ?? []);

        const petsRes = await supabase
          .from('apartment_pets')
          .select('*')
          .eq('property_id', property.id)
          .order('created_at', { ascending: true });
        if (petsRes.error) {
          if (!isMissingRelation(petsRes.error, 'apartment_pets')) throw petsRes.error;
          setPets([]);
        } else {
          setPets((petsRes.data as ApartmentPet[]) ?? []);
        }

        await reloadMeterReadings(property.id);

        const { data: chatData, error: chatErr } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('property_id', property.id)
          .order('created_at', { ascending: true });
        if (chatErr) throw chatErr;
        const allMsgs = (chatData as ChatMessage[]) ?? [];
        setChatMessages(allMsgs);
        setUnreadChatCount(allMsgs.filter((m) => m.sender === 'uk' && !m.read_by_owner).length);
      } catch (e: any) {
        setError(e?.message ?? t('err.loadApt'));
      }
    }
    loadPropertyScoped();
  }, [property?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!waterEnabled && !electricityEnabled) return;
    if (!waterEnabled && meterTab === 'water') {
      setMeterTab('electricity');
      persistQueryTab('meterTab', 'electricity', 'water', 'amadeus-meter-tab');
    }
    if (!electricityEnabled && meterTab === 'electricity') {
      setMeterTab('water');
      persistQueryTab('meterTab', 'water', 'water', 'amadeus-meter-tab');
    }
  }, [electricityEnabled, waterEnabled, meterTab]);

  useEffect(() => {
    if (!waterEnabled && financeTab === 'water') {
      setFinanceTab('support');
      persistQueryTab('financeTab', 'support', 'support', 'amadeus-finance-tab');
    }
  }, [waterEnabled, financeTab]);

  // ===================================================================
  // ЧАТ — ПОЛИНГ
  // ===================================================================
  const loadChatMessages = useCallback(async () => {
    if (!property) return;
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('property_id', property.id)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) return;
      const msgs = (data as ChatMessage[]) ?? [];
      setChatMessages(msgs);
      setUnreadChatCount(msgs.filter((m) => m.sender === 'uk' && !m.read_by_owner).length);
    } catch {}
  }, [property]);

  useEffect(() => {
    if (!property) return;
    loadChatMessages();
    chatPollRef.current = setInterval(loadChatMessages, 5000);
    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current);
    };
  }, [property, loadChatMessages]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (activeMenu !== 'чат' || !property) return;
    void markOwnerMessagesRead(property.id);
  }, [activeMenu, property?.id]); // eslint-disable-line

  async function markOwnerMessagesRead(propertyId: number) {
    const { error } = await supabase
      .from('chat_messages')
      .update({ read_by_owner: true })
      .eq('property_id', propertyId)
      .eq('sender', 'uk')
      .eq('read_by_owner', false);
    if (error) return;
    setChatMessages((prev) =>
      prev.map((m) => (m.sender === 'uk' ? { ...m, read_by_owner: true } : m)),
    );
    setUnreadChatCount(0);
  }

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!property) return;
    const msg = chatInput.trim();
    if (!msg && !chatFile) return;
    if (chatFile && chatFile.size > MAX_CHAT_FILE_BYTES) {
      setError(t('account.fileTooBig'));
      return;
    }
    setChatSending(true);
    setError(null);
    try {
      await markOwnerMessagesRead(property.id);
      let photoUrl: string | null = null;
      if (chatFile) photoUrl = await uploadPhotoIfAny(chatFile, 'chat');
      const payload: Database['public']['Tables']['chat_messages']['Insert'] = {
        property_id: property.id,
        sender: 'owner',
        message: msg,
        read_by_owner: true,
      };
      if (photoUrl) {
        payload.photo_url = photoUrl;
        payload.file_name = chatFile?.name ?? null;
      }
      const { data: inserted, error: insertErr } = await supabase
        .from('chat_messages')
        .insert(payload)
        .select('*')
        .single();
      if (insertErr) {
        const hint = insertErr.message?.includes('photo_url') || insertErr.message?.includes('file_name')
          ? t('err.chatFileSql')
          : insertErr.message;
        throw new Error(hint);
      }
      setChatMessages((prev) => [...prev, inserted as ChatMessage]);
      setChatInput('');
      setChatFile(null);
      if (chatFileRef.current) chatFileRef.current.value = '';
    } catch (e: any) {
      setError(e?.message ?? t('err.send'));
    } finally {
      setChatSending(false);
    }
  }

  // ===================================================================
  // ЖИЛЬЦЫ — ФУНКЦИИ
  // ===================================================================
  async function handleUpdateOccupantKind(kind: OccupantKind) {
    if (!property) return;
    setOccupancySaving(true);
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({ occupant_kind: kind })
        .eq('id', property.id);
      if (updErr) {
        const msg = updErr.message ?? '';
        throw new Error(msg.includes('occupant_kind') ? t('err.registrySql') : msg);
      }
      setProperties((prev) =>
        prev.map((p) => (p.id === property.id ? { ...p, occupant_kind: kind } : p)),
      );
    } catch (e: any) {
      setError(e?.message ?? t('err.status'));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleSaveOccupantDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!property) return;
    setOccupancySaving(true);
    setError(null);
    try {
      const payload = {
        occupant_name: occupantForm.name.trim() || null,
        occupant_phone: occupantForm.phone.trim() || null,
        occupant_email: occupantForm.email.trim() || null,
        occupant_until: occupantForm.until || null,
      };
      const { error: updErr } = await supabase.from('properties').update(payload).eq('id', property.id);
      if (updErr) {
        const msg = updErr.message ?? '';
        throw new Error(msg.includes('occupant_') ? t('err.registrySql') : msg);
      }
      setProperties((prev) =>
        prev.map((p) => (p.id === property.id ? { ...p, ...payload } : p)),
      );
    } catch (err: any) {
      setError(err?.message ?? t('err.save'));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleUpdateOccupancy(status: OccupancyStatus) {
    if (!property) return;
    setOccupancySaving(true);
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({ occupancy_status: status })
        .eq('id', property.id);
      if (updErr) throw updErr;
      setProperties((prev) =>
        prev.map((p) => (p.id === property.id ? { ...p, occupancy_status: status } : p))
      );
    } catch (e: any) {
      setError(e?.message ?? t('err.status'));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleUpdateListing(next: 'в собственности' | 'на продаже') {
    if (!property) return;
    setListingSaving(true);
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({ status: next })
        .eq('id', property.id);
      if (updErr) throw updErr;
      setProperties((prev) =>
        prev.map((p) => (p.id === property.id ? { ...p, status: next } : p))
      );
    } catch (e: any) {
      setError(e?.message ?? t('err.listing'));
    } finally {
      setListingSaving(false);
    }
  }

  async function handleSubmitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!property) return;
    const toName = transferForm.to_owner_name.trim();
    const toEmail = normalizeEmail(transferForm.to_owner_email);
    if (!toName || !toEmail) return;
    setTransferSubmitting(true);
    setError(null);
    try {
      const { error: insErr } = await supabase.from('owner_transfers').insert({
        property_id: property.id,
        from_owner_name: property.owner_name,
        from_owner_email: property.owner_email,
        from_owner_phone: property.owner_phone,
        to_owner_name: toName,
        to_owner_email: toEmail,
        to_owner_phone: transferForm.to_owner_phone.trim() || null,
        note: transferForm.note.trim() || null,
        status: 'ожидает',
      });
      if (insErr) throw insErr;
      const { data } = await supabase
        .from('owner_transfers')
        .select('*')
        .in('property_id', properties.map((p) => p.id))
        .order('created_at', { ascending: false });
      setTransfers((data as OwnerTransfer[]) ?? []);
      setTransferForm({ to_owner_name: '', to_owner_email: '', to_owner_phone: '', note: '' });
    } catch (e: any) {
      const msg = e?.message ?? t('err.transfer');
      setError(
        msg.includes('owner_transfers')
          ? t('err.transferSql', { msg })
          : msg
      );
    } finally {
      setTransferSubmitting(false);
    }
  }

  async function handleAddGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!property) return;
    const fn = guestForm.first_name.trim();
    const ln = guestForm.last_name.trim();
    if (!fn || !ln) return;
    setGuestAdding(true);
    try {
      const payload = {
        property_id: property.id,
        first_name: fn,
        last_name: ln,
        birth_year: guestForm.birth_year ? Number(guestForm.birth_year) : null,
        is_child: guestForm.is_child,
        is_permanent: guestForm.is_permanent,
        check_in: guestForm.check_in || null,
        check_out: guestForm.check_out || null,
      };
      let { data: inserted, error: insErr } = await supabase
        .from('apartment_guests')
        .insert(payload)
        .select('*')
        .single();
      if (insErr && (insErr.message.includes('is_permanent') || insErr.message.includes('schema cache'))) {
        const { is_permanent: _ignored, ...legacy } = payload;
        const retry = await supabase.from('apartment_guests').insert(legacy).select('*').single();
        inserted = retry.data;
        insErr = retry.error;
      }
      if (insErr) throw insErr;
      setGuests((prev) => [...prev, inserted as ApartmentGuest]);
      setGuestForm({
        first_name: '',
        last_name: '',
        birth_year: '',
        is_child: false,
        check_in: guestForm.check_in,
        check_out: guestForm.check_out,
        is_permanent: true,
      });
    } catch (e: any) {
      setError(e?.message ?? t('err.addGuest'));
    } finally {
      setGuestAdding(false);
    }
  }

  async function handleRemoveGuest(id: number) {
    if (!confirm(t('confirm.removeGuest'))) return;
    try {
      const { error: delErr } = await supabase.from('apartment_guests').delete().eq('id', id);
      if (delErr) throw delErr;
      setGuests((prev) => prev.filter((g) => g.id !== id));
    } catch (e: any) {
      setError(e?.message ?? t('err.removeGuest'));
    }
  }

  async function handleAddPet(e: React.FormEvent) {
    e.preventDefault();
    if (!property) return;
    setPetSaving(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('apartment_pets')
        .insert({
          property_id: property.id,
          species: petForm.species,
          name: petForm.name.trim() || null,
          chip_no: petForm.chip_no.trim() || null,
          passport_no: petForm.passport_no.trim() || null,
        })
        .select('*')
        .single();
      if (error) {
        throw new Error(error.message.includes('apartment_pets') ? t('err.registrySql') : error.message);
      }
      setPets((prev) => [...prev, data as ApartmentPet]);
      setPetForm({ species: 'dog', name: '', chip_no: '', passport_no: '' });
    } catch (e: any) {
      setError(e?.message ?? t('err.save'));
    } finally {
      setPetSaving(false);
    }
  }

  async function handleRemovePet(id: number) {
    if (!confirm(t('confirm.removePet'))) return;
    try {
      const { error } = await supabase.from('apartment_pets').delete().eq('id', id);
      if (error) throw error;
      setPets((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      setError(e?.message ?? t('err.delete'));
    }
  }

  async function handleSavePetInfo() {
    if (!property) return;
    setOccupancySaving(true);
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({ pet_info: petInfo.trim() || null })
        .eq('id', property.id);
      if (updErr) throw updErr;
      setProperties((prev) =>
        prev.map((p) => (p.id === property.id ? { ...p, pet_info: petInfo.trim() || null } : p))
      );
    } catch (e: any) {
      setError(e?.message ?? t('err.save'));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleClearAllGuests() {
    if (!property || !confirm(t('confirm.clearGuests'))) return;
    try {
      const { error: delErr } = await supabase
        .from('apartment_guests')
        .delete()
        .eq('property_id', property.id);
      if (delErr) throw delErr;
      setGuests([]);
    } catch (e: any) {
      setError(e?.message ?? t('err.clear'));
    }
  }

  // ===================================================================
  // ЗАЯВКИ
  // ===================================================================
  async function uploadPhotoIfAny(file: File | null, folder?: string) {
    if (!file || !property) return null;
    const fileExt = file.name.split('.').pop();
    const safeExt = fileExt ? fileExt.toLowerCase() : 'jpg';
    const prefix = folder ? `${folder}/` : '';
    const filePath = `${prefix}${property.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('request-photos')
      .upload(filePath, file, { upsert: true });
    if (uploadErr) throw uploadErr;
    const publicUrl = supabase.storage.from('request-photos').getPublicUrl(uploadData.path).data.publicUrl;
    return publicUrl;
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!property || !devEmail) return;
    const sub = subject.trim();
    const desc = description.trim();
    if (!sub || !desc) return;
    setCreating(true);
    setError(null);
    try {
      let photoUrl: string | null = null;
      if (photo) photoUrl = await uploadPhotoIfAny(photo);

      const { error: insertErr } = await supabase.from('requests').insert({
        property_id: property.id,
        subject: sub,
        description: desc,
        status: 'новая',
        priority,
        category,
        owner_name: property.owner_name,
        owner_phone: property.owner_phone,
        photo_url: photoUrl,
      });
      if (insertErr) throw insertErr;

      const { data: reqData, error: reqErr } = await supabase
        .from('requests')
        .select('*')
        .in('property_id', properties.map((p) => p.id))
        .order('created_at', { ascending: false });
      if (reqErr) throw reqErr;
      setRequests(reqData ?? []);
      setSubject('');
      setDescription('');
      setCategory('другое');
      setPriority('средний');
      setPhoto(null);
      setShowRequestForm(false);
    } catch (e: any) {
      setError(e?.message ?? t('err.createRequest'));
    } finally {
      setCreating(false);
    }
  }

  function persistQueryTab(param: 'financeTab' | 'meterTab', value: string, defaultValue: string, storageKey: string) {
    try {
      sessionStorage.setItem(storageKey, value);
      const url = new URL(window.location.href);
      if (value === defaultValue) url.searchParams.delete(param);
      else url.searchParams.set(param, value);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }

  function selectFinanceTab(tab: FinanceTab) {
    const next = tab === 'water' && !waterEnabled ? 'support' : tab;
    setFinanceTab(next);
    persistQueryTab('financeTab', next, 'support', 'amadeus-finance-tab');
  }

  function selectMeterTab(tab: MeterTab) {
    let next = tab;
    if (tab === 'electricity' && !electricityEnabled) next = waterEnabled ? 'water' : 'electricity';
    if (tab === 'water' && !waterEnabled) next = electricityEnabled ? 'electricity' : 'water';
    setMeterTab(next);
    persistQueryTab('meterTab', next, waterEnabled ? 'water' : 'electricity', 'amadeus-meter-tab');
  }

  async function refreshPolls() {
    const [pollsRes, optRes, voteRes, tallyRes] = await Promise.all([
      supabase.from('polls').select('*').order('created_at', { ascending: false }),
      supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
      supabase.from('poll_votes').select('*'),
      supabase.rpc('get_poll_tallies'),
    ]);
    if (!pollsRes.error) setPolls((pollsRes.data as Poll[]) ?? []);
    if (!optRes.error) setPollOptions((optRes.data as PollOption[]) ?? []);
    if (!voteRes.error) setPollVotes((voteRes.data as PollVote[]) ?? []);
    if (!tallyRes.error) setPollTallies((tallyRes.data as PollTallyAggregate[]) ?? []);
  }

  async function handleVote(poll: Poll, optionId: number) {
    if (properties.length === 0) return;
    if (!isPollAcceptingVotes(poll)) return;
    const ownedIds = new Set(properties.map((p) => p.id));
    if (pollVotes.some((v) => v.poll_id === poll.id && ownedIds.has(v.property_id))) return;
    setVotingPollId(poll.id);
    setError(null);
    try {
      const { error } = await supabase.rpc('cast_poll_vote', {
        p_poll_id: poll.id,
        p_option_id: optionId,
      });
      if (error) throw error;
      await refreshPolls();
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string'
          ? (e as { message: string }).message
          : t('err.vote');
      const lower = message.toLowerCase();
      if (
        lower.includes('already voted')
        || lower.includes('duplicate key')
        || lower.includes('poll_votes_poll_id_property_id')
      ) {
        setError(t('err.voteAlready'));
      } else {
        setError(message);
      }
    } finally {
      setVotingPollId(null);
    }
  }

  // ===================================================================
  // MEMO
  // ===================================================================
  const myPropertyIds = useMemo(() => properties.map((p) => p.id), [properties]);
  const myVoteWeight = useMemo(() => accountVoteWeight(properties), [properties]);

  const debtColor = useMemo(() => {
    const d = properties.reduce((sum, p) => sum + Number(p.debt ?? 0), 0);
    if (d <= 0) return 'text-muted';
    return 'text-danger';
  }, [properties]);

  const overColor = useMemo(() => {
    const o = properties.reduce((sum, p) => sum + Number(p.overpayment ?? 0), 0);
    if (o <= 0) return 'text-muted';
    return 'text-success';
  }, [properties]);

  const annualSupportFeeEur = useMemo(() => {
    return properties.reduce(
      (sum, p) => sum + annualSupportFee(p.area_sqm, supportRate),
      0
    );
  }, [properties, supportRate]);

  const publishedUkExpenses = useMemo(
    () => ukExpenses.filter(isExpensePublished),
    [ukExpenses]
  );
  const ukExpensesTotal = useMemo(
    () => publishedUkExpenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
    [publishedUkExpenses]
  );

  const unansweredPollsCount = useMemo(() => {
    if (myPropertyIds.length === 0) return 0;
    return polls.filter((p) => {
      if (!isPollAcceptingVotes(p)) return false;
      return !pollVotes.some((v) => v.poll_id === p.id && myPropertyIds.includes(v.property_id));
    }).length;
  }, [polls, pollVotes, myPropertyIds]);

  const currentCalendarYear = new Date().getFullYear();
  const expenseYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentCalendarYear);
    for (const e of publishedUkExpenses) {
      const y = expenseYearOf(e.expense_date);
      if (y) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [publishedUkExpenses, currentCalendarYear]);

  const expensesByYear = useMemo(() => {
    const map = new Map<number, { items: UkExpense[]; total: number }>();
    for (const e of publishedUkExpenses) {
      const y = expenseYearOf(e.expense_date);
      if (!y) continue;
      const cur = map.get(y) ?? { items: [], total: 0 };
      cur.items.push(e);
      cur.total += Number(e.amount ?? 0);
      map.set(y, cur);
    }
    return map;
  }, [publishedUkExpenses]);

  const occupancyStatus = (property?.occupancy_status ?? 'owner') as OccupancyStatus;
  const occupantKind = normalizeOccupantKind(property?.occupant_kind);
  const currentListing = listingStatus(property?.status);
  const pendingTransfer = useMemo(
    () =>
      property
        ? transfers.find((t) => t.property_id === property.id && t.status === 'ожидает')
        : undefined,
    [transfers, property]
  );
  const electricityHistory = useMemo(
    () => pairElectricityReadings([...meterReadings.electricity_day, ...meterReadings.electricity_night], electricityMeters),
    [meterReadings.electricity_day, meterReadings.electricity_night, electricityMeters],
  );
  const activeElMeter = useMemo(() => activeElectricityMeter(electricityMeters), [electricityMeters]);
  const latestElectric = useMemo(
    () => electricityActiveMeterReadings(electricityHistory, activeElMeter),
    [electricityHistory, activeElMeter],
  );

  // ===================================================================
  // ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ СЧЁТЧИКА
  // ===================================================================
  function renderMeterBlock(label: string, unit: string, readings: MeterReading[]) {
    const current = readings[0] ?? null;
    const previous = readings[1] ?? null;
    const consumption = current && previous ? current.value - previous.value : null;

    return (
      <div className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
        <div className="text-sm text-secondary">{label}</div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-secondary">{t('account.currentReading')}</span>
            <span className="text-2xl font-semibold text-accent">
              {current ? current.value : '—'} {unit}
            </span>
          </div>
          {previous && (
            <div className="flex items-center justify-between text-sm text-muted">
              <span>{t('account.previousReading')}</span>
              <span>{previous.value} {unit}</span>
            </div>
          )}
          {consumption !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">{t('account.consumption')}</span>
              <span className="text-warning font-medium">{consumption.toFixed(2)} {unit}</span>
            </div>
          )}
          {current && (
            <div className="text-xs text-muted mt-1">
              {t('account.fromDate', { d: new Date(current.reading_date).toLocaleDateString(dateLocale) })}
            </div>
          )}
          {previous && (
            <div className="text-xs text-muted">
              {t('account.prevDate', { d: new Date(previous.reading_date).toLocaleDateString(dateLocale) })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===================================================================
  // КОНТЕНТ ПО СЕКЦИЯМ
  // ===================================================================
  function renderContent() {
    switch (activeMenu) {
      // ===========================================================
      // КВАРТИРА
      // ===========================================================
      case 'квартира':
        return (
          <div className="space-y-4">
            {properties.length > 1 && (
              <div className="rounded-[14px] border border-border bg-surface shadow-card p-4 text-sm text-secondary">
                {t('account.onAccount', { count: properties.length, area: myVoteWeight.toFixed(1) })}
              </div>
            )}
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
              <div className="relative px-5 pb-5 pt-5 md:px-6 md:pt-6">
                <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-accent-bg blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                      {properties.length > 1 ? t('account.selectedApt') : t('account.yourApt')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                        № {property?.apartment_number ?? '—'}
                      </h2>
                      <p className="text-sm text-muted">
                        {property?.floor != null ? t('account.floorN', { n: property.floor }) : t('account.floorUnknown')}
                        {' · '}
                        {property?.area_sqm != null ? `${property.area_sqm} ${t('common.sqm')}` : t('account.areaUnknown')}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-secondary">
                      {property?.owner_name || t('account.ownerUnknown')}
                      {property?.owner_type ? (
                        <span className="text-muted">
                          {' · '}
                          {labelOwnerType(property.owner_type, t)}
                          {property.company_name ? ` · ${property.company_name}` : ''}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${listingStatusClass(currentListing)}`}>
                      {labelListing(currentListing, t)}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${
                      occupancyStatus === 'owner'
                        ? 'border-accent/25 bg-accent-bg text-accent'
                        : occupancyStatus === 'standby'
                          ? 'border-warning/25 bg-warning-bg text-warning'
                          : 'border-accent/25 bg-accent-bg text-accent'
                    }`}>
                      {occupancyStatus === 'owner' && t('account.livesOwner')}
                      {occupancyStatus === 'standby' && t('account.away')}
                      {occupancyStatus === 'rented' && t('account.tenants')}
                    </span>
                  </div>
                </div>

                <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.debt')}</div>
                    <div className={`mt-1 text-lg font-semibold ${
                      Number(property?.debt ?? 0) <= 0 ? 'text-muted' : 'text-danger'
                    }`}>
                      {Number(property?.debt ?? 0).toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.overpay')}</div>
                    <div className={`mt-1 text-lg font-semibold ${
                      Number(property?.overpayment ?? 0) > 0 ? 'text-success' : 'text-muted'
                    }`}>
                      {Number(property?.overpayment ?? 0).toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.feeYear')}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {annualSupportFee(property?.area_sqm, supportRate).toFixed(0)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.openRequests')}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {requests.filter((r) =>
                        r.property_id === property?.id &&
                        r.status !== 'выполнена' &&
                        r.status !== 'отклонена'
                      ).length}
                    </div>
                  </div>
                </div>

                <div className="relative mt-5">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.objectStatus')}</p>
                  <div className="inline-flex w-full rounded-full bg-surface p-1 sm:w-auto">
                    <button
                      type="button"
                      disabled={listingSaving}
                      onClick={() => handleUpdateListing('в собственности')}
                      className={`flex-1 rounded-full px-4 py-2 text-sm transition disabled:opacity-50 sm:flex-none ${
                        currentListing === 'в собственности'
                          ? 'bg-accent-bg text-accent'
                          : 'text-secondary hover:text-foreground'
                      }`}
                    >
                      {t('account.owned')}
                    </button>
                    <button
                      type="button"
                      disabled={listingSaving}
                      onClick={() => handleUpdateListing('на продаже')}
                      className={`flex-1 rounded-full px-4 py-2 text-sm transition disabled:opacity-50 sm:flex-none ${
                        currentListing === 'на продаже'
                          ? 'bg-warning/20 text-warning shadow-sm'
                          : 'text-secondary hover:text-foreground'
                      }`}
                    >
                      {t('account.forSale')}
                    </button>
                  </div>
                </div>

                <div className="relative mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('жильцы')}
                    className="rounded-full bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white shadow-card"
                  >
                    {t('account.manageOccupancy')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('заявки')}
                    className="rounded-full border border-border bg-surface-secondary px-4 py-2 text-sm text-secondary hover:bg-hover"
                  >
                    {t('account.requests')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('финансы')}
                    className="rounded-full border border-border bg-surface-secondary px-4 py-2 text-sm text-secondary hover:bg-hover"
                  >
                    {t('account.finance')}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[14px] border border-border bg-surface shadow-card">
              <button
                type="button"
                onClick={() => setOwnerTransferOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left md:p-6"
                aria-expanded={ownerTransferOpen}
              >
                <div>
                  <h2 className="text-lg font-semibold text-accent">{t('account.ownerTransfer')}</h2>
                  <p className="mt-0.5 text-sm text-secondary">
                    {pendingTransfer
                      ? t('account.transferPending')
                      : t('account.ownerTransferHint')}
                  </p>
                </div>
                <span className="shrink-0 text-muted">{ownerTransferOpen ? '▲' : '▼'}</span>
              </button>
              {ownerTransferOpen && (
              <div className="border-t border-border px-4 pb-6 pt-4 md:px-6">
              <p className="text-sm text-secondary mb-4">
                {t('account.transferLead')}
              </p>
              {pendingTransfer ? (
                <div className="rounded-xl border border-warning/25 bg-warning-bg p-4 text-sm text-warning">
                  {t('account.transferPending')}
                  <div className="mt-2 text-secondary">
                    {t('account.newOwner')}: {pendingTransfer.to_owner_name} ({pendingTransfer.to_owner_email})
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitTransfer} className="space-y-3">
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.phOwnerName')}
                    value={transferForm.to_owner_name}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_name: e.target.value })}
                    required
                  />
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.phOwnerEmail')}
                    type="email"
                    value={transferForm.to_owner_email}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_email: e.target.value })}
                    required
                  />
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.phPhoneOpt')}
                    value={transferForm.to_owner_phone}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_phone: e.target.value })}
                  />
                  <textarea
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.phCommentUk')}
                    rows={3}
                    value={transferForm.note}
                    onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
                  />
                  <button
                    type="submit"
                    disabled={transferSubmitting}
                    className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {transferSubmitting ? t('account.sending') : t('account.submitTransfer')}
                  </button>
                </form>
              )}
              {transfers.filter((tr) => tr.property_id === property?.id).length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs text-muted">{t('account.transferHistory')}</div>
                  {transfers
                    .filter((tr) => tr.property_id === property?.id)
                    .slice(0, 5)
                    .map((tr) => (
                      <div key={tr.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                        <span className={transferStatusClass(tr.status)}>{labelTransfer(tr.status, t)}</span>
                        {' · '}
                        {tr.to_owner_name} ({tr.to_owner_email})
                        {tr.reject_reason ? ` · ${tr.reject_reason}` : ''}
                      </div>
                    ))}
                </div>
              )}
              </div>
              )}
            </div>
          </div>
        );

      // ===========================================================
      // ЖИЛЬЦЫ
      // ===========================================================
      case 'жильцы':
        return (
          <div className="space-y-6">
            {/* Статус проживания */}
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <h2 className="text-lg font-semibold text-accent mb-2">{t('account.occTitle')}</h2>
              <p className="text-sm text-secondary mb-4">
                {t('account.occLead', { n: String(property?.apartment_number ?? '') })}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {/* Собственник */}
                <button
                  onClick={() => handleUpdateOccupancy('owner')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'owner'
                      ? 'border-accent bg-accent-bg'
                      : 'border-border bg-surface hover:border-border'
                  }`}
                >
                  <div className="text-2xl mb-2">🏠</div>
                  <div className="text-sm font-medium text-foreground">{t('account.occOwner')}</div>
                  <div className="text-xs text-muted mt-1">{t('account.occOwnerHint')}</div>
                </button>

                {/* В отъезде */}
                <button
                  onClick={() => handleUpdateOccupancy('standby')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'standby'
                      ? 'border-warning bg-warning-bg'
                      : 'border-border bg-surface hover:border-border'
                  }`}
                >
                  <div className="text-2xl mb-2">✈️</div>
                  <div className="text-sm font-medium text-foreground">{t('account.occStandby')}</div>
                  <div className="text-xs text-muted mt-1">{t('account.occStandbyHint')}</div>
                </button>

                {/* Арендаторы */}
                <button
                  onClick={() => handleUpdateOccupancy('rented')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'rented'
                      ? 'border-accent bg-accent-bg'
                      : 'border-border bg-surface hover:border-border'
                  }`}
                >
                  <div className="text-2xl mb-2">👥</div>
                  <div className="text-sm font-medium text-foreground">{t('account.occRent')}</div>
                  <div className="text-xs text-muted mt-1">{t('account.occRentHint')}</div>
                </button>
              </div>
            </div>

            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <h2 className="text-lg font-semibold text-accent mb-2">{t('registry.occupantKind')}</h2>
              <p className="text-sm text-secondary mb-4">{t('registry.occupantLead')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['owner', 'tenant', 'user'] as OccupantKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => handleUpdateOccupantKind(kind)}
                    disabled={occupancySaving}
                    className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                      occupantKind === kind
                        ? 'border-accent bg-accent-bg'
                        : 'border-border bg-surface hover:border-border'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">{labelOccupantKind(kind, t)}</div>
                  </button>
                ))}
              </div>
              {occupantKind !== 'owner' && (
                <form onSubmit={handleSaveOccupantDetails} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.occupantName')}
                    value={occupantForm.name}
                    onChange={(e) => setOccupantForm({ ...occupantForm, name: e.target.value })}
                  />
                  <input
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.occupantPhone')}
                    value={occupantForm.phone}
                    onChange={(e) => setOccupantForm({ ...occupantForm, phone: e.target.value })}
                  />
                  <input
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.occupantEmail')}
                    type="email"
                    value={occupantForm.email}
                    onChange={(e) => setOccupantForm({ ...occupantForm, email: e.target.value })}
                  />
                  <label className="text-sm text-secondary">
                    {t('registry.occupantUntil')}
                    <input
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      type="date"
                      value={occupantForm.until}
                      onChange={(e) => setOccupantForm({ ...occupantForm, until: e.target.value })}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={occupancySaving}
                    className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
                  >
                    {occupancySaving ? t('common.saving') : t('common.save')}
                  </button>
                </form>
              )}
            </div>

            {/* Информация о жильцах */}
            <>
                {/* Период аренды */}
                <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
                  <h2 className="text-lg font-semibold text-accent mb-4">{t('account.stayPeriod')}</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm text-secondary mb-1 block">{t('account.checkIn')}</label>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={guestForm.check_in}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_in: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm text-secondary mb-1 block">{t('account.checkOut')}</label>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={guestForm.check_out}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_out: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted mt-2">
                    {t('account.stayDatesHint')}
                  </p>
                </div>

                {/* Форма добавления жильца */}
                <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
                  <h2 className="text-lg font-semibold text-accent mb-4">
                    {t('account.addGuest')}
                  </h2>
                  <form onSubmit={handleAddGuest} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <input
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        placeholder={t('account.firstName')}
                        value={guestForm.first_name}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, first_name: e.target.value })
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        placeholder={t('account.lastName')}
                        value={guestForm.last_name}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, last_name: e.target.value })
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        placeholder={t('account.birthYear')}
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={guestForm.birth_year}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, birth_year: e.target.value })
                        }
                      />
                      <label className="flex items-center gap-2 text-sm text-secondary sm:col-span-1">
                        <input
                          type="checkbox"
                          checked={guestForm.is_child}
                          onChange={(e) =>
                            setGuestForm({ ...guestForm, is_child: e.target.checked })
                          }
                          className="w-4 h-4 accent-accent"
                        />
                        {t('account.child18')}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-secondary sm:col-span-1">
                        <input
                          type="checkbox"
                          checked={guestForm.is_permanent}
                          onChange={(e) =>
                            setGuestForm({ ...guestForm, is_permanent: e.target.checked })
                          }
                          className="w-4 h-4 accent-accent"
                        />
                        {t('registry.resident')}
                      </label>
                      <input
                        type="date"
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={guestForm.check_in}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_in: e.target.value })
                        }
                        title={t('account.checkIn')}
                      />
                      <input
                        type="date"
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={guestForm.check_out}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_out: e.target.value })
                        }
                        title={t('account.checkOut')}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={guestAdding}
                      className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                    >
                      {guestAdding ? t('account.adding') : t('account.addGuestPlus')}
                    </button>
                  </form>
                </div>

                {/* Список жильцов */}
                <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-accent">
                      {t('account.guestsN', { n: guests.length })}
                    </h2>
                    {guests.length > 0 && (
                      <button
                        onClick={handleClearAllGuests}
                        className="text-xs text-danger hover:text-danger"
                      >
                        {t('account.clearAll')}
                      </button>
                    )}
                  </div>

                  {guests.length === 0 ? (
                    <div className="text-sm text-muted">{t('account.noGuests')}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-secondary border-b border-border">
                            <th className="py-2 px-3">№</th>
                            <th className="py-2 px-3">{t('account.firstName')}</th>
                            <th className="py-2 px-3">{t('account.lastName')}</th>
                            <th className="py-2 px-3">{t('account.birthYearShort')}</th>
                            <th className="py-2 px-3">{t('account.colType')}</th>
                            <th className="py-2 px-3">{t('registry.resident')}</th>
                            <th className="py-2 px-3">{t('account.checkIn')}</th>
                            <th className="py-2 px-3">{t('account.checkOut')}</th>
                            <th className="py-2 px-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {guests.map((g, i) => (
                            <tr
                              key={g.id}
                              className="border-b border-border hover:bg-surface"
                            >
                              <td className="py-2 px-3 text-muted">{i + 1}</td>
                              <td className="py-2 px-3 text-foreground">{g.first_name}</td>
                              <td className="py-2 px-3 text-foreground">{g.last_name}</td>
                              <td className="py-2 px-3 text-secondary">
                                {g.birth_year ?? '—'}
                              </td>
                              <td className="py-2 px-3">
                                {g.is_child ? (
                                  <span className="text-warning">{t('account.child')}</span>
                                ) : (
                                  <span className="text-accent">{t('account.adult')}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-secondary text-xs">
                                {g.is_permanent ? t('common.yes') : t('common.no')}
                              </td>
                              <td className="py-2 px-3 text-secondary text-xs">
                                {g.check_in
                                  ? new Date(g.check_in).toLocaleDateString(dateLocale)
                                  : '—'}
                              </td>
                              <td className="py-2 px-3 text-secondary text-xs">
                                {g.check_out
                                  ? new Date(g.check_out).toLocaleDateString(dateLocale)
                                  : '—'}
                              </td>
                              <td className="py-2 px-3">
                                <button
                                  onClick={() => handleRemoveGuest(g.id)}
                                  className="rounded px-2 py-1 text-xs bg-danger-bg hover:bg-danger-bg text-danger"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>

            {/* Домашние животные — показывается всегда */}
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <h2 className="text-lg font-semibold text-accent mb-2">
                {t('registry.petsTitle')} 🐾
              </h2>
              <p className="text-sm text-secondary mb-4">
                {t('registry.petsHintChip')}
              </p>
              <form onSubmit={handleAddPet} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <select
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={petForm.species}
                  onChange={(e) => setPetForm({ ...petForm, species: e.target.value })}
                >
                  <option value="dog">{t('registry.dog')}</option>
                  <option value="cat">{t('registry.cat')}</option>
                  <option value="other">{t('registry.otherPet')}</option>
                </select>
                <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  placeholder={t('registry.petName')} value={petForm.name}
                  onChange={(e) => setPetForm({ ...petForm, name: e.target.value })} />
                <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  placeholder={t('registry.chip')} value={petForm.chip_no}
                  onChange={(e) => setPetForm({ ...petForm, chip_no: e.target.value })} />
                <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  placeholder={t('registry.passport')} value={petForm.passport_no}
                  onChange={(e) => setPetForm({ ...petForm, passport_no: e.target.value })} />
                <button type="submit" disabled={petSaving}
                  className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {t('registry.addPet')}
                </button>
              </form>
              {pets.length > 0 && (
                <div className="mb-4 space-y-2">
                  {pets.map((pet) => (
                    <div key={pet.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                      <div>
                        <div className="text-foreground">
                          {pet.species === 'dog' ? t('registry.dog') : pet.species === 'cat' ? t('registry.cat') : t('registry.otherPet')}
                          {pet.name ? ` · ${pet.name}` : ''}
                        </div>
                        <div className="text-xs text-muted">
                          {pet.chip_no ? `${t('registry.chip')}: ${pet.chip_no}` : ''}
                          {pet.passport_no ? ` · ${t('registry.passport')}: ${pet.passport_no}` : ''}
                        </div>
                      </div>
                      <button type="button" onClick={() => handleRemovePet(pet.id)} className="text-xs text-danger">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-sm text-secondary mb-2">{t('account.petsHint')}</p>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder={t('account.petsPh')}
                rows={3}
                value={petInfo}
                onChange={(e) => setPetInfo(e.target.value)}
              />
              <button
                onClick={handleSavePetInfo}
                disabled={occupancySaving}
                className="mt-3 rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {occupancySaving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        );

      // ===========================================================
      // ФИНАНСЫ
      // ===========================================================
      case 'финансы': {
        const totalDebt = Number(property?.debt ?? 0);
        const totalOver = Number(property?.overpayment ?? 0);
        const supportArea = Number(property?.area_sqm ?? 0);
        const monthlyFee = monthlySupportFee(supportArea, supportRate);
        const annualFee = annualSupportFee(supportArea, supportRate);
        const balanceValue = totalDebt > 0 ? totalDebt : totalOver;
        const propertyLedger = property
          ? supportLedger.filter((row) => row.property_id === property.id)
          : supportLedger;
        return (
          <div className="space-y-4">
            {properties.length > 1 && (
              <div className="rounded-[14px] border border-border bg-surface shadow-card px-4 py-3 text-sm text-secondary">
                {t('account.summaryApts', { count: properties.length, area: myVoteWeight.toFixed(1) })}
              </div>
            )}

            {properties.length > 1 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPropertyId(p.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      p.id === property?.id
                        ? 'border-accent/30 bg-accent-bg'
                        : 'border-border bg-surface hover:bg-surface'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">№ {p.apartment_number}</span>
                      <span className="text-xs text-muted">{Number(p.area_sqm ?? 0)} {t('common.sqm')}</span>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm">
                      <span className={Number(p.debt ?? 0) > 0 ? 'text-warning' : 'text-secondary'}>
                        {t('account.debtAmt', { n: Number(p.debt ?? 0).toFixed(2) })}
                      </span>
                      <span className={Number(p.overpayment ?? 0) > 0 ? 'text-success' : 'text-muted'}>
                        +{Number(p.overpayment ?? 0).toFixed(2)} €
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="-mx-1 overflow-x-auto pb-1">
              <div className="flex min-w-min gap-2 px-1">
                {([
                  ['support', t('account.financeTabSupport')],
                  ...(waterEnabled ? ([['water', t('account.financeTabWater')]] as const) : []),
                  ['capital', t('account.financeTabCapital')],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectFinanceTab(id)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap ${
                      financeTab === id
                        ? 'border-accent/25 bg-accent-bg text-accent'
                        : 'border-border bg-surface text-secondary hover:bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {property && (
              <OwnerUtilities
                key={`finance-${property.id}`}
                supabase={supabase}
                propertyId={property.id}
                variant="finance"
                currentTariff={waterTariff}
                financeTab={financeTab === 'water' && !waterEnabled ? 'support' : financeTab}
                onSelectFinanceTab={selectFinanceTab}
                supportDebt={totalDebt}
                supportOver={totalOver}
                waterEnabled={waterEnabled}
              />
            )}

            {financeTab === 'support' && (
              <>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
              <div className="relative px-5 pb-5 pt-5 md:px-6 md:pt-6">
                <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-accent-bg blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                      {t('account.financeTabSupport')}
                    </p>
                    <div className={`mt-1 text-3xl font-semibold tracking-tight md:text-4xl ${
                      totalDebt > 0 ? debtColor : 'text-muted'
                    }`}>
                      {balanceValue.toFixed(2)} €
                    </div>
                    <p className="mt-2 text-sm text-secondary">
                      {totalDebt > 0
                        ? t('account.hasDebt')
                        : totalOver > 0
                          ? t('account.hasOver')
                          : t('account.noDebt')}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${
                    totalDebt > 0
                      ? 'border-yellow-500/30 bg-yellow-500/10 text-warning'
                      : 'border-accent/25 bg-accent-bg text-accent'
                  }`}>
                    {totalDebt > 0 ? t('account.needPay') : t('account.paid')}
                  </span>
                </div>

                <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.debt')}</div>
                    <div className={`mt-1 text-lg font-semibold ${debtColor}`}>
                      {totalDebt.toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.overpay')}</div>
                    <div className={`mt-1 text-lg font-semibold ${overColor}`}>
                      {totalOver.toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.feeYear')}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {annualFee.toFixed(0)} €
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {supportArea.toFixed(1)} м² × {supportRate} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-3">
                    <div className="text-[11px] text-muted">{t('account.feeMonth')}</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {monthlyFee.toFixed(2)} €
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{t('account.approx')}</div>
                  </div>
                </div>

                <div className="relative mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('счётчики')}
                    className="rounded-full bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white shadow-card"
                  >
                    {t('account.metersBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('расходы_ук')}
                    className="rounded-full border border-border bg-surface-secondary px-4 py-2 text-sm text-secondary hover:bg-hover"
                  >
                    {t('account.expenses')}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('account.houseTariffs')}
              </p>
              <div className={`mt-3 grid gap-2 ${electricityEnabled ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
                {electricityEnabled && (
                <>
                <div className="rounded-xl bg-surface px-3 py-3">
                  <div className="text-[11px] text-muted">{t('account.elDay')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{DAY_RATE}</div>
                  <div className="text-[11px] text-muted">{t('account.perKwh')}</div>
                </div>
                <div className="rounded-xl bg-surface px-3 py-3">
                  <div className="text-[11px] text-muted">{t('account.elNight')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{NIGHT_RATE}</div>
                  <div className="text-[11px] text-muted">{t('account.perKwh')}</div>
                </div>
                </>
                )}
                <div className="rounded-xl bg-surface px-3 py-3">
                  <div className="text-[11px] text-muted">{t('account.supportFee')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{supportRate}</div>
                  <div className="text-[11px] text-muted">{t('account.perSqmYear')}</div>
                </div>
              </div>
            </div>

            {propertyLedger.length > 0 ? (
              <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                  {t('account.feePayments')}
                </p>
                <div className="mt-3 space-y-2">
                  {propertyLedger.slice(0, 8).map((row) => (
                    <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="text-secondary">
                        {new Date(row.created_at).toLocaleDateString(dateLocale)}
                      </span>
                      <span className={row.kind === 'payment' ? 'text-accent' : 'text-warning'}>
                        {row.kind === 'payment' ? '+' : `${t('account.charge')} `}
                        {Number(row.amount).toFixed(2)} €
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
                <p className="text-sm text-secondary">{t('account.feePaymentsEmpty')}</p>
              </div>
            )}
              </>
            )}
          </div>
        );
      }

      // ===========================================================
      // РАСХОДЫ УК
      // ===========================================================
      case 'расходы_ук': {
        const yearsToShow =
          expenseYearFilter === 'all' ? expenseYears : [expenseYearFilter];
        const visibleTotal =
          expenseYearFilter === 'all'
            ? ukExpensesTotal
            : expensesByYear.get(expenseYearFilter)?.total ?? 0;
        return (
          <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-accent">{t('account.expensesTitle')}</h2>
              <div className="text-sm text-secondary">
                {expenseYearFilter === 'all' ? t('account.allYears') : expenseYearFilter}:{' '}
                <span className="font-semibold text-accent">{visibleTotal.toFixed(2)} €</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={() => setExpenseYearFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  expenseYearFilter === 'all'
                    ? 'bg-accent-bg text-accent border-accent/25'
                    : 'bg-surface-secondary text-secondary border-border hover:text-foreground'
                }`}
              >
                {t('account.allYears')}
              </button>
              {expenseYears.map((year) => {
                const total = expensesByYear.get(year)?.total ?? 0;
                return (
                  <button
                    key={year}
                    onClick={() => setExpenseYearFilter(year)}
                    className={`rounded-lg px-3 py-1.5 text-sm border ${
                      expenseYearFilter === year
                        ? 'bg-accent-bg text-accent border-accent/25'
                        : 'bg-surface-secondary text-secondary border-border hover:text-foreground'
                    }`}
                  >
                    {year}
                    <span className="ml-2 text-xs text-muted">{total.toFixed(2)} €</span>
                  </button>
                );
              })}
            </div>
            <p className="mb-4 text-sm text-secondary">
              {t('account.expensesPublished')}
            </p>
            {publishedUkExpenses.length === 0 ? (
              <div className="text-sm text-secondary">{t('account.expensesEmpty')}</div>
            ) : (
              <div className="space-y-6">
                {yearsToShow.map((year) => {
                  const group = expensesByYear.get(year);
                  const items = group?.items ?? [];
                  return (
                    <div key={year}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-accent">{year}</h3>
                        <span className="text-sm text-secondary">
                          {(group?.total ?? 0).toFixed(2)} €
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <div className="text-sm text-muted">{t('account.noExpensesYear', { year })}</div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((e) => {
                            const photos = expensePhotoUrls(e);
                            return (
                              <div key={e.id} className="rounded-xl border border-border bg-surface p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-foreground">{e.title?.trim() || '—'}</div>
                                    <div className="mt-0.5 text-xs text-muted">{formatUkDate(e.expense_date)}</div>
                                    {photos.length > 0 && (
                                      <div className="mt-2">
                                        <ExpensePhotoStrip urls={photos} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-sm font-semibold text-foreground">
                                    {Number(e.amount).toFixed(2)} €
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

      // ===========================================================
      // СЧЁТЧИКИ
      // ===========================================================
      case 'счётчики': {
        const metersUnused = !waterEnabled && !electricityEnabled;
        const meterTabs = (
          [
            ...(waterEnabled ? ([['water', t('account.meterTabWater')]] as const) : []),
            ...(electricityEnabled ? ([['electricity', t('account.meterTabElectricity')]] as const) : []),
          ]
        );
        const shownMeterTab = !waterEnabled && electricityEnabled ? 'electricity' : !electricityEnabled && waterEnabled ? 'water' : meterTab;
        if (metersUnused) {
          return (
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <p className="text-sm text-secondary">{t('account.metersUnused')}</p>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {meterTabs.length > 1 && (
            <div className="-mx-1 overflow-x-auto pb-1">
              <div className="flex min-w-min gap-2 px-1">
                {meterTabs.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectMeterTab(id)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap ${
                      shownMeterTab === id
                        ? 'border-accent/25 bg-accent-bg text-accent'
                        : 'border-border bg-surface text-secondary hover:bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            )}

            {property && (
              <OwnerUtilities
                key={`meters-${property.id}`}
                supabase={supabase}
                propertyId={property.id}
                variant="meters"
                currentTariff={waterTariff}
                meterTab={shownMeterTab}
                onSelectMeterTab={selectMeterTab}
                waterMode={waterMode}
                waterEnabled={waterEnabled}
                electricityEnabled={electricityEnabled}
                electricLastDay={latestElectric.currentDay}
                electricLastNight={latestElectric.currentNight}
                electricLastDate={latestElectric.readingDate}
                electricMeterNumber={activeElMeter?.meter_number ?? null}
              />
            )}

            {electricityEnabled && shownMeterTab === 'electricity' && property && (
              <OwnerElectricity
                supabase={supabase}
                propertyId={property.id}
                mode={electricityMode}
                rows={[...meterReadings.electricity_day, ...meterReadings.electricity_night]}
                meters={electricityMeters}
                onSubmitted={() => reloadMeterReadings(property.id)}
              />
            )}
          </div>
        );
      }

      // ===========================================================
      // ЗАЯВКИ
      // ===========================================================
      case 'заявки':
        return (
          <div className="space-y-6">
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-accent">{t('account.requests')}</h2>
                <button
                  type="button"
                  onClick={() => setShowRequestForm((v) => !v)}
                  className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white"
                >
                  {showRequestForm ? t('account.hideForm') : t('account.createRequest')}
                </button>
              </div>
              {showRequestForm && (
                <form onSubmit={handleCreateRequest} className="mb-6 space-y-4 rounded-xl border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold text-accent">
                    {t('account.newRequest')}{property ? ` · ${t('picker.apt', { n: property.apartment_number })}` : ''}
                  </h3>
                  <div>
                    <label className="text-sm text-secondary mb-1 block">{t('account.subject')}</label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={t('account.phReqTitle')}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm text-secondary mb-1 block">{t('account.description')}</label>
                    <textarea
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('account.phReqBody')}
                      rows={4}
                      required
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm text-secondary mb-1 block">{t('account.category')}</label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={category}
                        onChange={(e) => setCategory(e.target.value as Category)}
                      >
                        <option value="сантехника">{t('cat.plumbing')}</option>
                        <option value="электрика">{t('cat.electric')}</option>
                        <option value="уборка">{t('cat.cleaning')}</option>
                        <option value="отопление">{t('cat.heating')}</option>
                        <option value="другое">{t('cat.other')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-secondary mb-1 block">{t('account.priority')}</label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                      >
                        <option value="низкий">{t('status.prioLow')}</option>
                        <option value="средний">{t('status.prioMid')}</option>
                        <option value="высокий">{t('status.prioHigh')}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-secondary mb-1 block">{t('account.photoOpt')}</label>
                    <input
                      type="file"
                      accept="image/*"
                      className="w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-hover file:px-4 file:py-2 file:text-sm file:text-secondary hover:file:bg-hover"
                      onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    {creating ? t('account.sending') : t('account.submitRequest')}
                  </button>
                </form>
              )}
              <div className="text-sm text-secondary mb-3">{t('account.countPcs', { n: requests.length })}</div>
              <div className="space-y-3">
              {requests.length === 0 ? (
                <div className="text-sm text-secondary">{t('account.noRequestsYet')}</div>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-[14px] border border-border bg-surface p-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-secondary">
                          {t('picker.apt', { n: String(properties.find((p) => p.id === r.property_id)?.apartment_number ?? r.property_id ?? '') })} · {t('account.categoryOf', { c: labelCategory(r.category, t) })}
                        </div>
                        <div className="text-foreground font-medium">{r.subject}</div>
                      </div>
                      <div className="text-sm text-secondary">
                        {t('account.priority')}: <span className="text-foreground">{labelPriority(r.priority, t)}</span>
                        <div>
                          {t('home.tagStatus')}: <span className="text-foreground">{labelRequestStatus(r.status, t)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-secondary">{r.description}</div>
                    {r.photo_url && (
                      <a
                        className="mt-3 block text-sm text-accent hover:underline"
                        href={r.photo_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('account.viewPhoto')}
                      </a>
                    )}
                    <div className="mt-2 text-xs text-muted">
                      {new Date(r.created_at).toLocaleString(dateLocale)}
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>
          </div>
        );

      // ===========================================================
      // СООБЩЕНИЯ ОТ УК
      // ===========================================================
      case 'сообщения':
        return (
          <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
            <h2 className="text-lg font-semibold text-accent mb-4">
              {t('account.announcementsTitle')}
            </h2>
            <div className="space-y-3">
              {announcements.length === 0 ? (
                <div className="text-sm text-secondary">{t('account.noAnnouncements')}</div>
              ) : (
                announcements.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-[14px] border border-border bg-surface p-4 shadow-card"
                  >
                    <h3 className="text-foreground font-semibold">{a.title}</h3>
                    <p className="mt-2 text-sm text-secondary whitespace-pre-wrap">{a.body}</p>
                    <div className="mt-2 text-xs text-muted">
                      {a.created_by && `${t('account.fromBy', { name: a.created_by })} · `}
                      {new Date(a.created_at).toLocaleString(dateLocale)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      // ===========================================================
      // ОПРОСЫ УК
      // ===========================================================
      case 'опросы':
        return (
          <div className="space-y-6">
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6">
              <h2 className="text-lg font-semibold text-accent mb-1">{t('account.pollsTitle')}</h2>
              <p className="text-sm text-secondary mb-4">
                {t('account.pollsLead')}
              </p>
              {polls.length === 0 ? (
                <div className="text-sm text-secondary">{t('account.noPolls')}</div>
              ) : (
                <div className="space-y-4">
                  {polls.map((poll) => {
                    const options = pollOptions
                      .filter((o) => o.poll_id === poll.id)
                      .sort((a, b) => a.sort_order - b.sort_order);
                    const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
                    const myVote = votesForPoll.find((v) => myPropertyIds.includes(v.property_id));
                    const open = isPollAcceptingVotes(poll);
                    const tally = tallyFromAggregates(options, pollTallies);
                    const decision = pollDecisionLabel(poll, tally.accepted);
                    const decisionLabel = labelPollDecision(decision, t);
                    return (
                      <div key={poll.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${pollCategoryClass(poll.category)}`}>
                            {labelPollCategory(poll.category, t)}
                          </span>
                          <span className={`text-xs ${
                            decision === 'принято' ? 'text-accent' :
                            decision === 'не принято' ? 'text-danger' : 'text-secondary'
                          }`}>
                            {decisionLabel}
                          </span>
                          {myVoteWeight > 0 && (
                            <span className="text-xs text-muted">
                              {t('account.yourWeight', { n: myVoteWeight.toFixed(1) })}
                              {properties.length > 1 ? ` · ${t('account.aptsShort', { n: properties.length })}` : ''}
                            </span>
                          )}
                        </div>
                        <h3 className="text-foreground font-semibold mb-2">{poll.title}</h3>
                        <PollDetails
                          poll={poll}
                          options={options}
                          tally={tally}
                        />
                        <div className="mt-3">
                          <PollOptionBars
                            poll={poll}
                            options={options}
                            tally={tally}
                            myOptionId={myVote?.option_id}
                            disabled={!open || Boolean(myVote) || votingPollId === poll.id}
                            onVote={open && !myVote ? (optionId) => handleVote(poll, optionId) : undefined}
                          />
                        </div>
                        <div className="mt-2 text-xs text-muted">
                          {myVote ? t('account.voteLocked') : open ? t('account.notVotedYet') : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );

      // ===========================================================
      // ЧАТ С УК
      // ===========================================================
      case 'чат':
        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:m-4 md:rounded-2xl md:border md:border-border">
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-bg text-xs font-semibold text-accent">
                {t('common.uk')}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{t('account.chatTitle')}</div>
                <div className="truncate text-xs text-muted">
                  {t('common.apt')} {property?.apartment_number}
                  {property?.owner_name ? ` · ${property.owner_name}` : ''}
                </div>
              </div>
            </div>

            <div ref={chatScrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {chatMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-secondary text-2xl">💬</div>
                  <p className="max-w-xs text-sm text-muted">{t('account.chatEmpty')}</p>
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-3xl flex-col">
                {chatMessages.map((m, i) => {
                    const isOwner = m.sender === 'owner';
                    const prev = chatMessages[i - 1];
                    const next = chatMessages[i + 1];
                    const newDay = !prev || prev.created_at.slice(0, 10) !== m.created_at.slice(0, 10);
                    const tight = Boolean(
                      prev &&
                        prev.sender === m.sender &&
                        !newDay &&
                        Math.abs(new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000,
                    );
                    const lastInGroup = !(
                      next &&
                      next.sender === m.sender &&
                      next.created_at.slice(0, 10) === m.created_at.slice(0, 10) &&
                      Math.abs(new Date(next.created_at).getTime() - new Date(m.created_at).getTime()) < 5 * 60 * 1000
                    );
                    const created = new Date(m.created_at);
                    const dayLabel = newDay
                      ? created.toDateString() === new Date().toDateString()
                        ? t('common.today')
                        : created.toDateString() === new Date(Date.now() - 86400000).toDateString()
                          ? t('common.yesterday')
                          : created.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' })
                      : null;
                    return (
                      <div key={m.id}>
                        {dayLabel && (
                          <div className="my-4 flex justify-center">
                            <span className="rounded-full bg-hover px-3 py-1 text-[11px] text-muted">
                              {dayLabel}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} ${tight ? 'mt-0.5' : 'mt-2'}`}>
                          <div
                            className={`inline-flex max-w-[85%] flex-col px-3.5 py-2 text-[15px] leading-snug ${
                              isOwner
                                ? `bg-accent-bg text-foreground ${lastInGroup ? 'rounded-2xl rounded-br-md' : 'rounded-2xl'}`
                                : `bg-surface-secondary text-foreground ${lastInGroup ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl'}`
                            }`}
                          >
                            {m.photo_url && (
                              <div className={m.message.trim() ? 'mb-2' : ''}>
                                <ChatMedia url={m.photo_url} fileName={m.file_name} />
                              </div>
                            )}
                            {m.message.trim() ? (
                              <div className="whitespace-pre-wrap break-words">{m.message}</div>
                            ) : null}
                            {lastInGroup && (
                              <div className={`mt-1 flex items-center gap-1 text-[10px] ${isOwner ? 'justify-end text-secondary' : 'text-muted'}`}>
                                <span>
                                  {created.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {isOwner && (
                                  <span className={m.read_by_uk ? 'text-accent' : 'text-muted'}>
                                    {m.read_by_uk ? '✓✓' : '✓'}
                                  </span>
                                )}
                                {!isOwner && !m.read_by_owner && (
                                  <span className="text-accent">● {t('account.newMsg')}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <form
              onSubmit={handleSendChat}
              className="shrink-0 border-t border-border px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4"
            >
              <div className="mx-auto w-full max-w-3xl">
              {chatFile && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-sm text-secondary">
                  <span className="min-w-0 flex-1 truncate">📎 {chatFile.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setChatFile(null);
                      if (chatFileRef.current) chatFileRef.current.value = '';
                    }}
                    className="shrink-0 text-xs text-secondary hover:text-foreground"
                  >
                    {t('account.removeFile')}
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={chatFileRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(e) => setChatFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => chatFileRef.current?.click()}
                  disabled={chatSending}
                  aria-label={t('account.attachFile')}
                  title={t('account.attachFile')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-[#1a2422] text-foreground hover:bg-hover disabled:opacity-40"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-2.5 text-base text-foreground placeholder:text-placeholder outline-none transition focus:border-accent md:text-sm"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={t('account.chatPlaceholder')}
                  disabled={chatSending}
                />
                <button
                  type="submit"
                  disabled={chatSending || (!chatInput.trim() && !chatFile)}
                  aria-label={t('common.send')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-lg text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chatSending ? '…' : '↑'}
                </button>
              </div>
              </div>
            </form>
          </div>
        );

      default:
        return null;
    }
  }

  // ===================================================================
  // ЭКРАН ВХОДА
  // ===================================================================
  if (!authReady) {
    return (
      <div className="relative min-h-dvh bg-background text-foreground flex items-center justify-center px-4">
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-6 text-center text-secondary">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!devEmail) {
    return (
      <LoginScreen
        email={emailInput}
        onEmailChange={setEmailInput}
        password={passwordInput}
        onPasswordChange={setPasswordInput}
        loginError={loginError}
        loginLoading={loginLoading}
        onSubmit={handleLogin}
      />
    );
  }

  // ===================================================================
  // ОСНОВНОЙ LAYOUT
  // ===================================================================
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-[rgba(20,25,30,0.25)] md:hidden"
          aria-label={t('common.closeMenu')}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(18rem,88vw)] flex-col border-r border-border bg-surface transition-transform duration-300 md:pointer-events-auto md:static md:h-auto md:w-auto md:flex-shrink-0 ${
          sidebarOpen
            ? 'translate-x-0 md:w-64'
            : 'pointer-events-none -translate-x-full md:pointer-events-auto md:w-16 md:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          {sidebarOpen && <BrandMark compact />}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg bg-hover p-2 text-secondary md:hidden"
            aria-label={t('common.closeMenu')}
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden rounded-lg bg-hover p-1.5 text-secondary md:block"
            title={sidebarOpen ? t('common.collapse') : t('common.expand')}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setActiveMenu(item.key);
                if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeMenu === item.key
                  ? 'bg-accent-bg text-accent border border-accent/25'
                  : 'text-secondary hover:bg-hover hover:text-foreground border border-transparent'
              }`}
              title={item.label}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              {sidebarOpen && (
                <span className="flex items-center gap-2 text-left leading-tight">
                  {item.label}
                  {item.key === 'чат' && unreadChatCount > 0 && (
                    <span className="ml-auto bg-danger text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unreadChatCount}
                    </span>
                  )}
                  {item.key === 'опросы' && unansweredPollsCount > 0 && (
                    <span className="ml-auto bg-warning text-gray-900 text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unansweredPollsCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="space-y-2 border-t border-border p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {sidebarOpen ? (
            <div className="space-y-2">
              <LanguageSwitcher compact />
              <div className="text-xs text-muted truncate">{devEmail}</div>
              <div className="flex gap-2">
                {isStaff && (
                  <Link
                    href="/admin"
                    className="flex-1 text-center text-xs rounded-lg border border-accent/25 bg-accent-bg px-2 py-1.5 text-accent"
                  >
                    {t('common.uk')}
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="min-h-11 flex-1 rounded-xl border border-border bg-hover px-2 text-sm hover:bg-hover"
                >
                  {t('common.logout')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <LanguageSwitcher compact />
              {isStaff && (
                <Link
                  href="/admin"
                  className="p-1.5 rounded-lg bg-accent-bg text-xs"
                  title={t('account.ukManage')}
                >
                  ⚙
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg bg-hover hover:bg-hover text-xs"
                title={t('common.logout')}
              >
                🚪
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ===== ОСНОВНОЙ КОНТЕНТ ===== */}
      <main className={`min-w-0 flex-1 ${
        activeMenu === 'чат'
          ? 'flex h-dvh flex-col overflow-hidden pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0'
          : 'overflow-y-auto pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0'
      }`}>
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2.5 md:px-6 md:py-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold tracking-[0.02em] text-foreground">{t('brand.name')}</p>
            <h1 className="truncate text-base font-semibold md:text-lg">
              {property ? `№ ${property.apartment_number}` : MENU_ITEMS.find((m) => m.key === activeMenu)?.label}
              {property?.owner_name ? ` · ${property.owner_name}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-10 rounded-lg border border-border px-3 text-sm text-secondary md:hidden"
            >
              {t('common.logout')}
            </button>
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <LanguageSwitcher compact />
              <Link href="/" className="text-sm text-secondary hover:text-foreground">
                {t('common.backHome')}
              </Link>
            </div>
          </div>
        </div>

        <div className={activeMenu === 'чат' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'mx-auto w-full max-w-5xl p-4 md:p-8'}>
          {properties.length > 1 && (
            <div className={activeMenu === 'чат' ? 'shrink-0 px-4 pt-3' : undefined}>
            <ApartmentPicker
              properties={properties}
              selectedId={property?.id ?? null}
              onSelect={setSelectedPropertyId}
            />
            </div>
          )}
          {loading && (
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6 text-center text-secondary">
              {t('common.loading')}
            </div>
          )}

          {error && (
            <div className={`rounded-xl border border-danger/25 bg-danger-bg p-4 text-danger ${activeMenu === 'чат' ? 'mx-3 mt-3 md:mx-4 shrink-0' : 'mb-4'}`}>
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-3 text-xs text-danger hover:text-danger"
              >
                ✕
              </button>
            </div>
          )}

          {!loading && property && (
            activeMenu === 'чат'
              ? <div className="flex min-h-0 flex-1 flex-col">{renderContent()}</div>
              : renderContent()
          )}

          {!loading && !property && !error && (
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-6 text-center text-secondary">
              {t('account.aptNotFound')}
            </div>
          )}
        </div>
      </main>
      <MobileBottomNav
        items={[
          { key: 'квартира', label: t('account.apt'), icon: '🏠' },
          { key: 'финансы', label: t('account.finance'), icon: '💰' },
          { key: 'заявки', label: t('account.requests'), icon: '📋' },
          { key: 'чат', label: t('account.tabChat'), icon: '💬', badge: unreadChatCount || undefined },
        ]}
        activeKey={activeMenu}
        moreActive={!['квартира', 'финансы', 'заявки', 'чат'].includes(activeMenu)}
        onSelect={(key) => setActiveMenu(key as MenuSection)}
        onMore={() => setSidebarOpen(true)}
        hidden={sidebarOpen}
      />
    </div>
  );
}