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
  type Poll,
  type PollOption,
  type PollTallyAggregate,
  type PollVote,
} from '@/lib/polls';
import { BrandMark } from '@/components/BrandMark';
import { ApartmentPicker } from '@/components/ApartmentPicker';
import { listingStatus, listingStatusClass, transferStatusClass, type OwnerTransfer } from '@/lib/ownership';
import {
  labelListing,
  labelOwnerType,
  labelOccupantKind,
  labelPriority,
  labelTransfer,
} from '@/i18n/labels';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { DEFAULT_SUPPORT_RATE, annualSupportFee, monthlySupportFee, type SupportFeeEntry } from '@/lib/finance';
import { OwnerSupportFee } from '@/components/account/OwnerSupportFee';
import {
  type SupportFeeAllocation,
  type SupportFeeAssessment,
} from '@/lib/supportFeeAnnual';
import { OwnerUtilities, type FinanceTab, type MeterTab } from '@/components/account/OwnerUtilities';
import { OwnerOverview } from '@/components/account/OwnerOverview';
import { OwnerManagement, type ManagementTab } from '@/components/account/OwnerManagement';
import { OwnerPolls } from '@/components/account/OwnerPolls';
import { OwnerApartment } from '@/components/account/OwnerApartment';
import { OwnerOccupancy, type OccupancySavePayload, type GuestInsertPayload, type PetInsertPayload } from '@/components/account/OwnerOccupancy';
import { OwnerDocumentsDecisions } from '@/components/account/OwnerDocumentsDecisions';
import { PillTabs } from '@/components/account/ownerUi';
import { OwnerElectricity } from '@/components/account/OwnerElectricity';
import type { WaterTariff, WaterMode } from '@/lib/utilities';
import { DEFAULT_WATER_MODE, parseWaterMode, isOwnerModuleEnabled } from '@/lib/utilities';
import {
  currentElectricityTariff,
  formatElectricityTariff,
  DEFAULT_ELECTRICITY_MODE,
  parseElectricityMode,
  pairElectricityReadings,
  activeElectricityMeter,
  electricityActiveMeterReadings,
  type ElectricityMode,
  type ElectricityMeter,
  type ElectricityTariff,
} from '@/lib/electricity';
import { isExpensePublished } from '@/lib/expenses';
import { MAX_CHAT_FILE_BYTES } from '@/lib/chatMedia';
import { normalizeOccupantKind, type ApartmentPet, type OccupantKind } from '@/lib/registry';
import {
  type PropertyAbsencePeriod,
  type PropertyRegistryPerson,
} from '@/lib/propertyBook';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { ownerMgmtParam, ownerSectionParam, parseOwnerNav } from '@/lib/ownerNav';
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
  middle_name?: string | null;
  birth_year: number | null;
  is_child: boolean;
  check_in: string | null;
  check_out: string | null;
  is_permanent?: boolean | null;
}

type MenuSection =
  | 'обзор'
  | 'квартира'
  | 'жильцы'
  | 'финансы'
  | 'ук'
  | 'счётчики'
  | 'документы'
  | 'опросы';

function expenseYearOf(dateStr: string) {
  const y = Number(dateStr.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : 0;
}

export default function AccountPage() {
  const router = useRouter();
  const { t, dateLocale } = useI18n();
  const [supabase] = useState(() => createClient());
  const MENU_ITEMS: { key: MenuSection; label: string; icon: string }[] = [
    { key: 'обзор', label: t('account.overview'), icon: '▦' },
    { key: 'квартира', label: t('account.apt'), icon: '🏠' },
    { key: 'жильцы', label: t('account.occupancy'), icon: '👥' },
    { key: 'финансы', label: t('account.finance'), icon: '💰' },
    { key: 'счётчики', label: t('account.meters'), icon: '⚡' },
    { key: 'документы', label: t('account.docsMenu'), icon: '📁' },
    { key: 'опросы', label: t('account.polls'), icon: '🗳️' },
    { key: 'ук', label: t('account.mgmtTitle'), icon: '🏢' },
  ];
  // ---------- DEV-ЛОГИН ----------
  const [devEmail, setDevEmail] = useState<string>('');
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
  const [electricityTariff, setElectricityTariff] = useState<ElectricityTariff | null>(null);
  const [supportLedger, setSupportLedger] = useState<SupportFeeEntry[]>([]);
  const [supportAssessments, setSupportAssessments] = useState<SupportFeeAssessment[]>([]);
  const [supportAllocations, setSupportAllocations] = useState<SupportFeeAllocation[]>([]);
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
  const [registryPeople, setRegistryPeople] = useState<PropertyRegistryPerson[]>([]);
  const [absences, setAbsences] = useState<PropertyAbsencePeriod[]>([]);
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
  const [petsLoadFailed, setPetsLoadFailed] = useState(false);
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
  const [activeMenu, setActiveMenu] = useState<MenuSection>('обзор');
  const [managementTab, setManagementTab] = useState<ManagementTab>('заявки');
  const inMgmtChat = activeMenu === 'ук' && managementTab === 'чат';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expenseYearFilter, setExpenseYearFilter] = useState<number>(
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
    if (!authReady) return;
    if (!devEmail) router.replace('/');
  }, [authReady, devEmail, router]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Local session is still cleared below.
    } finally {
      setDevEmail('');
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
      setRegistryPeople([]);
      setAbsences([]);
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

        const elTariffRes = await supabase
          .from('electricity_tariffs')
          .select('*')
          .order('valid_from', { ascending: false });
        if (elTariffRes.error) {
          if (!isMissingRelation(elTariffRes.error, 'electricity_tariffs')) throw elTariffRes.error;
          setElectricityTariff(null);
        } else {
          setElectricityTariff(currentElectricityTariff((elTariffRes.data as ElectricityTariff[] | null) ?? []));
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

        const assRes = await supabase
          .from('support_fee_assessments')
          .select('*')
          .in('property_id', ids)
          .order('billing_year', { ascending: false });
        if (assRes.error) {
          if (!isMissingRelation(assRes.error, 'support_fee_assessments')) throw assRes.error;
          setSupportAssessments([]);
        } else {
          setSupportAssessments((assRes.data as SupportFeeAssessment[]) ?? []);
        }

        const allocRes = await supabase
          .from('support_fee_allocations')
          .select('*')
          .order('created_at', { ascending: true });
        if (allocRes.error) {
          if (!isMissingRelation(allocRes.error, 'support_fee_allocations')) throw allocRes.error;
          setSupportAllocations([]);
        } else {
          setSupportAllocations((allocRes.data as SupportFeeAllocation[]) ?? []);
        }
      } catch (e: any) {
        setError(ownerVisibleError(e, t('err.load')));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [devEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const nav = parseOwnerNav(url);
      if (nav.menu) setActiveMenu(nav.menu);
      if (nav.mgmt) {
        setManagementTab(nav.mgmt);
        if (!nav.menu) setActiveMenu('ук');
      }
      const fromFinance = url.searchParams.get('financeTab');
      if (fromFinance === 'support' || fromFinance === 'water' || fromFinance === 'electricity' || fromFinance === 'capital') {
        setFinanceTab(fromFinance);
      } else {
        const storedFinance = sessionStorage.getItem('amadeus-finance-tab');
        if (storedFinance === 'support' || storedFinance === 'water' || storedFinance === 'electricity' || storedFinance === 'capital') {
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
          if (!isMissingRelation(petsRes.error, 'apartment_pets')) {
            setPetsLoadFailed(true);
            setPets([]);
          } else {
            setPetsLoadFailed(false);
            setPets([]);
          }
        } else {
          setPetsLoadFailed(false);
          setPets((petsRes.data as ApartmentPet[]) ?? []);
        }

        const peopleRes = await supabase
          .from('property_registry_people')
          .select('*')
          .eq('property_id', property.id)
          .order('created_at', { ascending: true });
        if (peopleRes.error) {
          if (!isMissingRelation(peopleRes.error, 'property_registry_people')) throw peopleRes.error;
          setRegistryPeople([]);
        } else {
          setRegistryPeople((peopleRes.data as PropertyRegistryPerson[]) ?? []);
        }

        const absenceRes = await supabase
          .from('property_absence_periods')
          .select('*')
          .eq('property_id', property.id)
          .order('from_date', { ascending: false });
        if (absenceRes.error) {
          if (!isMissingRelation(absenceRes.error, 'property_absence_periods')) throw absenceRes.error;
          setAbsences([]);
        } else {
          setAbsences((absenceRes.data as PropertyAbsencePeriod[]) ?? []);
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
        setError(ownerVisibleError(e, t('err.loadApt')));
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
    if (!electricityEnabled && financeTab === 'electricity') {
      setFinanceTab('support');
      persistQueryTab('financeTab', 'support', 'support', 'amadeus-finance-tab');
    }
  }, [waterEnabled, electricityEnabled, financeTab]);

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
    if (!inMgmtChat || !property) return;
    void markOwnerMessagesRead(property.id);
  }, [inMgmtChat, property?.id]); // eslint-disable-line

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
      setError(ownerVisibleError(e, t('err.send')));
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
      setError(ownerVisibleError(e, t('err.status')));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleReportBookChange(message: string) {
    if (!property) throw new Error(t('err.save'));
    const { error } = await supabase.rpc('submit_property_book_change', {
      p_property_id: property.id,
      p_message: message,
      p_payload: { source: 'owner_apartment' },
    });
    if (error) {
      if (isMissingRelation(error, 'submit_property_book_change')) {
        const { error: insertErr } = await supabase.from('requests').insert({
          property_id: property.id,
          subject: t('book.aptTitle', { n: String(property.apartment_number ?? '') }),
          description: message,
          status: 'новая',
          priority: 'средний',
          category: 'книга',
          owner_name: property.owner_name,
          owner_phone: property.owner_phone,
        });
        if (insertErr) throw insertErr;
      } else {
        throw error;
      }
    }
    const { data: reqData, error: reqErr } = await supabase
      .from('requests')
      .select('*')
      .in('property_id', properties.map((p) => p.id))
      .order('created_at', { ascending: false });
    if (reqErr) throw reqErr;
    setRequests(reqData ?? []);
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
      setError(ownerVisibleError(err, t('err.save')));
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleSaveOccupancy(payload: OccupancySavePayload) {
    if (!property) throw new Error(t('err.status'));
    setOccupancySaving(true);
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({
          occupancy_status: payload.occupancy_status,
          occupant_kind: payload.occupant_kind,
          occupant_name: payload.occupant_name,
          occupant_phone: payload.occupant_phone,
          occupant_email: payload.occupant_email,
          occupant_until: payload.occupant_until,
        })
        .eq('id', property.id);
      if (updErr) {
        const msg = updErr.message ?? '';
        throw new Error(msg.includes('occupant_') || msg.includes('occupancy_status') ? t('err.registrySql') : msg);
      }
      setProperties((prev) =>
        prev.map((p) =>
          p.id === property.id
            ? {
                ...p,
                occupancy_status: payload.occupancy_status,
                occupant_kind: payload.occupant_kind,
                occupant_name: payload.occupant_name,
                occupant_phone: payload.occupant_phone,
                occupant_email: payload.occupant_email,
                occupant_until: payload.occupant_until,
              }
            : p,
        ),
      );
      setOccupantForm({
        name: payload.occupant_name ?? '',
        phone: payload.occupant_phone ?? '',
        email: payload.occupant_email ?? '',
        until: payload.occupant_until ? String(payload.occupant_until).slice(0, 10) : '',
      });
    } finally {
      setOccupancySaving(false);
    }
  }

  async function handleUpdateOccupancy(status: OccupancyStatus) {
    await handleSaveOccupancy({
      occupancy_status: status,
      occupant_kind: occupantKind,
      occupant_name: occupantForm.name.trim() || null,
      occupant_phone: occupantForm.phone.trim() || null,
      occupant_email: occupantForm.email.trim() || null,
      occupant_until: occupantForm.until || null,
    });
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
      setError(ownerVisibleError(e, t('err.listing')));
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

  async function handleAddGuest(payload: GuestInsertPayload) {
    if (!property) throw new Error(t('err.addGuest'));
    const fn = payload.first_name.trim();
    const ln = payload.last_name.trim();
    if (!fn || !ln) throw new Error(t('err.addGuest'));
    setGuestAdding(true);
    try {
      const row = {
        property_id: property.id,
        first_name: fn,
        last_name: ln,
        birth_year: payload.birth_year,
        is_child: payload.is_child,
        is_permanent: payload.is_permanent,
        check_in: payload.check_in,
        check_out: payload.check_out,
      };
      let { data: inserted, error: insErr } = await supabase
        .from('apartment_guests')
        .insert(row)
        .select('*')
        .single();
      if (insErr && (insErr.message.includes('is_permanent') || insErr.message.includes('schema cache'))) {
        const { is_permanent: _ignored, ...legacy } = row;
        const retry = await supabase.from('apartment_guests').insert(legacy).select('*').single();
        inserted = retry.data;
        insErr = retry.error;
      }
      if (insErr) throw insErr;
      setGuests((prev) => [...prev, inserted as ApartmentGuest]);
    } finally {
      setGuestAdding(false);
    }
  }

  async function handleUpdateGuest(id: number, payload: GuestInsertPayload) {
    const fn = payload.first_name.trim();
    const ln = payload.last_name.trim();
    if (!fn || !ln) throw new Error(t('err.updateGuest'));
    setGuestAdding(true);
    try {
      const { data, error } = await supabase.rpc('update_apartment_guest', {
        p_guest_id: id,
        p_first_name: fn,
        p_last_name: ln,
        p_birth_year: payload.birth_year,
        p_is_child: payload.is_child,
        p_is_permanent: payload.is_permanent,
        p_check_in: payload.check_in,
        p_check_out: payload.is_permanent ? null : payload.check_out,
      });
      if (error) throw new Error(error.message || t('err.updateGuest'));
      const row = (Array.isArray(data) ? data[0] : data) as ApartmentGuest | null;
      if (!row) throw new Error(t('err.updateGuest'));
      setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, ...row } : g)));
    } finally {
      setGuestAdding(false);
    }
  }

  async function handleRemoveGuest(id: number) {
    const { error: delErr } = await supabase.from('apartment_guests').delete().eq('id', id);
    if (delErr) throw delErr;
    setGuests((prev) => prev.filter((g) => g.id !== id));
  }

  async function handleAddPet(payload: PetInsertPayload) {
    if (!property) throw new Error(t('err.save'));
    setPetSaving(true);
    try {
      const full = {
        property_id: property.id,
        species: payload.species,
        name: payload.name,
        chip_no: payload.chip_no,
        passport_no: payload.passport_no,
        is_taken_to_public_places: payload.is_taken_to_public_places,
      };
      let { data, error } = await supabase.from('apartment_pets').insert(full).select('*').single();
      if (error && (error.message.includes('is_taken_to_public_places') || error.message.includes('schema cache'))) {
        const { is_taken_to_public_places: _ignored, ...legacy } = full;
        const retry = await supabase.from('apartment_pets').insert(legacy).select('*').single();
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        throw new Error(error.message.includes('apartment_pets') ? t('err.registrySql') : error.message);
      }
      setPets((prev) => [...prev, data as ApartmentPet]);
    } finally {
      setPetSaving(false);
    }
  }

  async function handleRemovePet(id: number) {
    const { error } = await supabase.from('apartment_pets').delete().eq('id', id);
    if (error) throw error;
    setPets((prev) => prev.filter((p) => p.id !== id));
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
      setError(ownerVisibleError(e, t('err.save')));
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
      setError(ownerVisibleError(e, t('err.clear')));
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
      setError(ownerVisibleError(e, t('err.createRequest')));
    } finally {
      setCreating(false);
    }
  }

  function persistSearchParam(param: string, value: string | null) {
    try {
      const url = new URL(window.location.href);
      if (!value) url.searchParams.delete(param);
      else url.searchParams.set(param, value);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }

  function persistQueryTab(param: 'financeTab' | 'meterTab', value: string, defaultValue: string, storageKey: string) {
    try {
      sessionStorage.setItem(storageKey, value);
      persistSearchParam(param, value === defaultValue ? null : value);
    } catch {
      persistSearchParam(param, value === defaultValue ? null : value);
    }
  }

  useEffect(() => {
    persistSearchParam('section', ownerSectionParam(activeMenu));
    persistSearchParam('tab', activeMenu === 'ук' ? ownerMgmtParam(managementTab) : null);
  }, [activeMenu, managementTab]);

  function selectFinanceTab(tab: FinanceTab) {
    let next = tab;
    if (tab === 'water' && !waterEnabled) next = 'support';
    if (tab === 'electricity' && !electricityEnabled) next = 'support';
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

  function openFinanceFromOverview(tab: FinanceTab) {
    selectFinanceTab(tab);
    setActiveMenu('финансы');
  }

  function openMetersFromOverview(tab: MeterTab) {
    selectMeterTab(tab);
    setActiveMenu('счётчики');
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
        setError(ownerVisibleError(e, t('err.vote')));
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
              {t('account.fromDate', { d: formatOwnerDate(current.reading_date, dateLocale) })}
            </div>
          )}
          {previous && (
            <div className="text-xs text-muted">
              {t('account.prevDate', { d: formatOwnerDate(previous.reading_date, dateLocale) })}
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
      case 'обзор': {
        const openRequestsCount = requests.filter(
          (r) =>
            r.property_id === property?.id &&
            r.status !== 'выполнена' &&
            r.status !== 'отклонена',
        ).length;
        return (
          <OwnerOverview
            supabase={supabase}
            property={property!}
            properties={properties}
            onSelectProperty={setSelectedPropertyId}
            waterEnabled={waterEnabled}
            electricityEnabled={electricityEnabled}
            supportDebt={Math.max(0, Number(property?.debt ?? 0))}
            supportOver={Math.max(0, Number(property?.overpayment ?? 0))}
            supportAssessment={supportAssessments.find((a) => a.property_id === property?.id) ?? null}
            occupancyStatus={occupancyStatus}
            polls={polls}
            pollVotes={pollVotes}
            openRequestsCount={openRequestsCount}
            unreadChatCount={unreadChatCount}
            electricLastDay={latestElectric.currentDay}
            electricLastNight={latestElectric.currentNight}
            electricLastDate={latestElectric.readingDate}
            electricMeter={activeElMeter ?? null}
            onOpenFinance={openFinanceFromOverview}
            onOpenMeters={openMetersFromOverview}
            onOpenApartment={() => setActiveMenu('квартира')}
            onOpenPolls={() => setActiveMenu('опросы')}
            onOpenRequests={() => {
              setManagementTab('заявки');
              setActiveMenu('ук');
            }}
            onOpenChat={() => {
              setManagementTab('чат');
              setActiveMenu('ук');
            }}
            onOpenDocuments={() => setActiveMenu('документы')}
          />
        );
      }
      // ===========================================================
      // КВАРТИРА
      // ===========================================================
      case 'квартира': {
        const bookRequestOpen = requests.some(
          (r) =>
            r.property_id === property?.id &&
            r.category === 'книга' &&
            r.status !== 'выполнена' &&
            r.status !== 'отклонена',
        );
        return (
          <OwnerApartment
            property={property!}
            properties={properties}
            occupancyStatus={occupancyStatus}
            guests={guests}
            pets={pets}
            people={registryPeople}
            absences={absences}
            bookRequestOpen={bookRequestOpen}
            onSelectProperty={setSelectedPropertyId}
            onOpenOccupancy={() => setActiveMenu('жильцы')}
            onReportChange={handleReportBookChange}
            listingSaving={listingSaving}
            onUpdateListing={handleUpdateListing}
            extra={(
              <div className="rounded-xl border border-border bg-background px-3 py-3">
              <p className="text-sm text-secondary mb-3">
                {t('account.transferLead')}
              </p>
              {pendingTransfer ? (
                <div className="rounded-xl border border-warning/25 bg-warning-bg p-3 text-sm text-warning">
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
          />
        );
      }


      case 'жильцы':
        return (
          <OwnerOccupancy
            apartmentNumber={String(property?.apartment_number ?? '')}
            properties={properties}
            selectedId={property?.id ?? null}
            occupancyStatus={occupancyStatus}
            occupantKind={occupantKind}
            occupantName={property?.occupant_name ?? null}
            occupantPhone={property?.occupant_phone ?? null}
            occupantEmail={property?.occupant_email ?? null}
            occupantUntil={property?.occupant_until ? String(property.occupant_until).slice(0, 10) : null}
            ownerName={property?.owner_name ?? null}
            ownerEmail={property?.owner_email ?? null}
            registryPeople={registryPeople}
            bookRequestOpen={requests.some(
              (r) =>
                r.property_id === property?.id &&
                r.category === 'книга' &&
                r.status !== 'выполнена' &&
                r.status !== 'отклонена',
            )}
            guests={guests}
            pets={pets}
            occupancySaving={occupancySaving}
            guestAdding={guestAdding}
            petSaving={petSaving}
            petsLoadFailed={petsLoadFailed}
            onSelectProperty={setSelectedPropertyId}
            onSaveStatus={handleSaveOccupancy}
            onAddGuest={handleAddGuest}
            onUpdateGuest={handleUpdateGuest}
            onRemoveGuest={handleRemoveGuest}
            onAddPet={handleAddPet}
            onRemovePet={handleRemovePet}
            onReportChange={handleReportBookChange}
          />
        );


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

            <PillTabs
              items={[
                { id: 'support' as const, label: t('account.financeTabSupport') },
                ...(waterEnabled ? [{ id: 'water' as const, label: t('account.financeTabWater') }] : []),
                ...(electricityEnabled ? [{ id: 'electricity' as const, label: t('account.financeTabElectricity') }] : []),
                { id: 'capital' as const, label: t('account.financeTabCapital') },
              ]}
              value={
                (financeTab === 'water' && !waterEnabled) || (financeTab === 'electricity' && !electricityEnabled)
                  ? 'support'
                  : financeTab
              }
              onChange={selectFinanceTab}
            />

            {property && (
              <OwnerUtilities
                key={`finance-${property.id}`}
                supabase={supabase}
                propertyId={property.id}
                variant="finance"
                currentTariff={waterTariff}
                financeTab={
                  (financeTab === 'water' && !waterEnabled) || (financeTab === 'electricity' && !electricityEnabled)
                    ? 'support'
                    : financeTab
                }
                onSelectFinanceTab={selectFinanceTab}
                supportDebt={totalDebt}
                supportOver={totalOver}
                waterEnabled={waterEnabled}
                electricityEnabled={electricityEnabled}
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

                <div className="relative mt-5">
                  {property ? (
                    <OwnerSupportFee
                      supabase={supabase}
                      propertyId={property.id}
                      assessments={supportAssessments.filter((a) => a.property_id === property.id)}
                      allocations={supportAllocations}
                      overpayment={totalOver}
                    />
                  ) : null}
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
                    onClick={() => {
                      setManagementTab('расходы');
                      setActiveMenu('ук');
                    }}
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
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {electricityTariff ? formatElectricityTariff(Number(electricityTariff.day_price_eur_per_kwh)) : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-surface px-3 py-3">
                  <div className="text-[11px] text-muted">{t('account.elNight')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {electricityTariff ? formatElectricityTariff(Number(electricityTariff.night_price_eur_per_kwh)) : '—'}
                  </div>
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
                        {formatOwnerDate(row.created_at, dateLocale)}
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
      // УК
      // ===========================================================
      case 'ук':
        return (
          <OwnerManagement
            tab={managementTab}
            onTab={setManagementTab}
            properties={properties}
            requests={requests}
            announcements={announcements}
            expenseYears={expenseYears}
            expensesByYear={expensesByYear}
            expenseYear={expenseYearFilter}
            onExpenseYear={setExpenseYearFilter}
            requestFormOpen={showRequestForm}
            onRequestFormOpen={setShowRequestForm}
            unreadChatCount={unreadChatCount}
            requestForm={
              <form onSubmit={handleCreateRequest} className="space-y-3 rounded-[14px] border border-border bg-surface px-4 py-3">
                <h3 className="text-sm font-semibold">
                  {t('account.newRequest')}{property ? ` · ${t('picker.apt', { n: property.apartment_number })}` : ''}
                </h3>
                <div>
                  <label className="mb-1 block text-sm text-secondary">{t('account.subject')}</label>
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('account.phReqTitle')}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-secondary">{t('account.description')}</label>
                  <textarea
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('account.phReqBody')}
                    rows={4}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-secondary">{t('account.category')}</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
                    <label className="mb-1 block text-sm text-secondary">{t('account.priority')}</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
                  <label className="mb-1 block text-sm text-secondary">{t('account.photoOpt')}</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-hover file:px-4 file:py-2 file:text-sm"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {creating ? t('account.sending') : t('account.submitRequest')}
                </button>
              </form>
            }
            chat={{
              messages: chatMessages,
              input: chatInput,
              setInput: setChatInput,
              file: chatFile,
              setFile: setChatFile,
              sending: chatSending,
              onSend: handleSendChat,
              fileRef: chatFileRef,
              scrollRef: chatScrollRef,
              apartmentNumber: property?.apartment_number,
              ownerName: property?.owner_name,
            }}
          />
        );

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
              <PillTabs
                items={meterTabs.map(([id, label]) => ({ id, label }))}
                value={shownMeterTab}
                onChange={selectMeterTab}
              />
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
                onOpenFinance={openFinanceFromOverview}
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
                onOpenFinance={openFinanceFromOverview}
              />
            )}
          </div>
        );
      }

      // ===========================================================
      // ЗАЯВКИ
      // ===========================================================
      case 'документы':
        return <OwnerDocumentsDecisions supabase={supabase} />;

      case 'опросы':
        return (
          <OwnerPolls
            polls={polls}
            pollOptions={pollOptions}
            pollVotes={pollVotes}
            pollTallies={pollTallies}
            myPropertyIds={properties.map((p) => p.id)}
            myVoteWeight={myVoteWeight}
            votingPollId={votingPollId}
            onVote={handleVote}
          />
        );

      default:
        return null;
    }
  }

  // ===================================================================
  // ЭКРАН ВХОДА
  // ===================================================================
  if (!authReady || !devEmail) {
    return (
      <div className="relative min-h-dvh bg-background text-foreground flex items-center justify-center px-4">
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-6 text-center text-secondary">
          {t('common.loading')}
        </div>
      </div>
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
              type="button"
              onClick={() => {
                setActiveMenu(item.key);
                if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                activeMenu === item.key
                  ? 'bg-accent-bg text-accent border border-accent/25'
                  : 'text-secondary hover:bg-hover hover:text-foreground border border-transparent'
              }`}
              title={item.label}
            >
              <span className="text-lg flex-shrink-0 leading-none">{item.icon}</span>
              {sidebarOpen && (
                <span className="flex min-w-0 flex-1 items-center gap-2 text-left leading-tight">
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.key === 'ук' && unreadChatCount > 0 && (
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
        inMgmtChat
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

        <div className={
          inMgmtChat
            ? 'mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden p-3 md:px-6'
            : 'mx-auto w-full max-w-6xl p-3 md:px-6 md:py-5'
        }>
          {properties.length > 1 &&
            activeMenu !== 'обзор' &&
            activeMenu !== 'квартира' &&
            activeMenu !== 'жильцы' &&
            activeMenu !== 'финансы' && (
            <div className={inMgmtChat ? 'shrink-0' : undefined}>
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
            <div className={`rounded-xl border border-danger/25 bg-danger-bg p-4 text-danger ${inMgmtChat ? 'mb-3 shrink-0' : 'mb-4'}`}>
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
            inMgmtChat
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
          { key: 'обзор', label: t('account.overview'), icon: '▦' },
          { key: 'финансы', label: t('account.finance'), icon: '💰' },
          { key: 'ук', label: t('account.mgmtTitle'), icon: '🏢', badge: unreadChatCount || undefined },
          { key: 'опросы', label: t('account.polls'), icon: '🗳️', badge: unansweredPollsCount || undefined },
        ]}
        activeKey={activeMenu}
        moreActive={!['обзор', 'финансы', 'ук', 'опросы'].includes(activeMenu)}
        onSelect={(key) => setActiveMenu(key as MenuSection)}
        onMore={() => setSidebarOpen(true)}
        hidden={sidebarOpen}
      />
    </div>
  );
}