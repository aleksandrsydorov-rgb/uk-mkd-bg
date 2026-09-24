'use client';

import { useEffect, useState, useMemo, useRef, useCallback, Suspense, type ReactNode } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/database.types';
import Link from 'next/link';
import {
  isMissingRelation,
  isPollAcceptingVotes,
  pollDecisionLabel,
  tallyPoll,
  type Poll,
  type PollCategory,
  type PollOption,
  type PollVote,
  type PollVoteHistory,
} from '@/lib/polls';
import { PollDetails, PollOptionBars } from '@/components/PollPanel';
import { listingStatus, transferStatusClass, type OwnerTransfer } from '@/lib/ownership';
import { normalizePriority, priorityClass } from '@/lib/requests';
import { BrandMark } from '@/components/BrandMark';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { useI18n } from '@/i18n/I18nProvider';
import { labelCategory, labelExpenseStatus, labelListing, labelOccupancy, labelOccupantKind, labelOwnerType, labelPollCategory, labelPollDecision, labelPollStatus, labelPriority, labelRequestStatus, labelStaffRole, labelTransfer } from '@/i18n/labels';
import { StatusBadge } from '@/components/account/ownerUi';
import {
  AdminPageHeader,
  AdminCard,
  AdminMetricCard,
  AdminTableShell,
  AdminFilterBar,
  AdminEmptyState,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminInlineAlert,
  AdminTabBar,
  parseAdminUtilityTab,
  type AdminUtilityTab,
  adminFieldClass,
  adminFormPanelClass,
  adminTableHeadRowClass,
  adminTableRowClass,
  adminTableCellClass,
  adminModalOverlayClass,
  adminModalPanelClass,
  adminModalHeaderClass,
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminBtnTertiaryClass,
  adminBtnDangerClass,
  adminCardClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  DEFAULT_SUPPORT_RATE,
  STAFF_ROLE_OPTIONS,
  annualSupportFee,
  canApproveUkExpenses,
  canRecordSupportPayments,
  canSetSupportRate,
  isUkAccountantRole,
  isUkAdminRole,
  monthlySupportFee,
  supportPaymentIdempotencySignature,
  type SupportFeeEntry,
} from '@/lib/finance';
import { EXPENSE_PENDING, EXPENSE_PUBLISHED, MAX_EXPENSE_PHOTOS, expensePhotoUrls, isExpensePublished } from '@/lib/expenses';
import { ExpensePhotoStrip } from '@/components/ExpensePhotoStrip';
import { AdminReports } from '@/components/AdminReports';
import { ChatMedia } from '@/components/ChatMedia';
import { SignedStorageLink } from '@/components/SignedStorageMedia';
import {
  CHAT_FILES_BUCKET,
  EXPENSE_RECEIPTS_BUCKET,
  POLL_IMAGES_BUCKET,
  chatFilePath,
  expenseReceiptPath,
  pollImagePath,
  uploadPrivateFile,
} from '@/lib/privateMedia';
import { AdminWater } from '@/components/admin/AdminWater';
import { AdminCapital } from '@/components/admin/AdminCapital';
import { AdminDocumentsDecisions } from '@/components/admin/AdminDocumentsDecisions';
import { AdminElectricityFinance } from '@/components/admin/AdminElectricityFinance';
import { AdminSupportFeeAnnual } from '@/components/admin/AdminSupportFeeAnnual';
import {
  canSeeCapitalAdmin,
  canSeeWaterAdmin,
  canSeeElectricityFinance,
  mapAdminRpcError,
  todayIsoDate,
  parseWaterMode,
  DEFAULT_WATER_MODE,
  formatKwh,
  formatM3,
  formatEur,
  type WaterMode,
} from '@/lib/utilities';
import {
  currentElectricityTariff,
  formatElectricityTariff,
  canSubmitElectricityStaff,
  canManageElectricityMeter,
  activeElectricityMeter,
  electricityActiveMeterReadings,
  pairElectricityReadings,
  displayElectricityMeterNumber,
  parseElectricityMode,
  DEFAULT_ELECTRICITY_MODE,
  mapSubmitElectricityError,
  type ElectricityMode,
  type ElectricityMeter,
  type ElectricityTariff,
} from '@/lib/electricity';
import { chatPreviewText, MAX_CHAT_FILE_BYTES } from '@/lib/chatMedia';
import {
  buildRegistryPdfHtml,
  dogChips,
  downloadCsv,
  householdNames,
  householdPeople,
  normalizeOccupantKind,
  type ApartmentPet,
} from '@/lib/registry';
import { downloadHtmlAsPdf } from '@/lib/pdfDownload';

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
  submitted_source?: string | null;
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

const UK_CHAT_SEEN_KEY = 'uk_chat_seen_v1';

function messageTime(iso: string) {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function loadUkChatSeenMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(UK_CHAT_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistUkChatSeenMap(map: Record<string, string>) {
  try {
    localStorage.setItem(UK_CHAT_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Owner message is new until UK opened/replied at or after it, or sent a later reply in the thread. */
function isNewOwnerMessage(m: ChatMessage, thread: ChatMessage[], seenAt?: string) {
  if (m.sender === 'uk') return false;
  const t = messageTime(m.created_at);
  if (seenAt && t <= messageTime(seenAt)) return false;
  if (thread.some((x) => x.sender === 'uk' && messageTime(x.created_at) >= t)) return false;
  return true;
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

type AdminSection =
  | 'обзор'
  | 'квартиры'
  | 'смены'
  | 'заявки'
  | 'счётчики'
  | 'вода'
  | 'персонал'
  | 'настройки'
  | 'такса'
  | 'электроэнергия'
  | 'капремонт'
  | 'расходы'
  | 'опросы'
  | 'документы'
  | 'объявления'
  | 'отчётность'
  | 'чат';

const ADMIN_SECTIONS: readonly AdminSection[] = [
  'обзор',
  'квартиры',
  'смены',
  'заявки',
  'счётчики',
  'вода',
  'персонал',
  'настройки',
  'такса',
  'электроэнергия',
  'капремонт',
  'расходы',
  'опросы',
  'документы',
  'объявления',
  'отчётность',
  'чат',
] as const;

const DEFAULT_ADMIN_SECTION: AdminSection = 'обзор';

function isAdminSection(value: string | null | undefined): value is AdminSection {
  return Boolean(value && (ADMIN_SECTIONS as readonly string[]).includes(value));
}

type AdminMenuItem = { key: AdminSection; label: string; icon: string };
type AdminMenuGroup = { id: string; label: string; items: AdminSection[] };

function NavChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden>
      <path
        d={open ? 'M4 6.25 8 10.25 12 6.25' : 'M6.25 4 10.25 8 6.25 12'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavGroupIcon({ id }: { id: string }) {
  const paths: Record<string, string> = {
    objects: 'M3 13.5V6.2L8 3l5 3.2v7.3M6.5 13.5V8.5h3v5',
    utilities: 'M8.5 2.5 4.5 9h3L7 13.5 12 7H9l.5-4.5',
    finance: 'M3 12.5V4.5M5.5 12.5V7.5M8 12.5V5.5M10.5 12.5V8.5M13 12.5V6.5',
    comms: 'M3 4.5h10v6.2H6.2L3.5 13V4.5z',
    docs: 'M4 2.5h5.2L12.5 6v7.5h-8.5zM9 2.8V6h3.1',
    system: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 2.5v1.2M8 12.3v1.2M3.4 4.2l.9.9M11.7 10.9l.9.9M2.5 8h1.2M12.3 8h1.2M3.4 11.8l.9-.9M11.7 5.1l.9-.9',
  };
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden>
      <path d={paths[id] ?? paths.objects} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatUkDate(dateStr: string) {
  return formatOwnerDate(dateStr);
}

function expenseYearOf(dateStr: string) {
  const y = Number(dateStr.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : 0;
}

function AdminPortal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const money = (n: number | null | undefined) => formatEur(Number(n) || 0, locale);
  const [supabase] = useState(() => createBrowserClient());
  const MENU_ITEMS: AdminMenuItem[] = useMemo(
    () => [
      { key: 'обзор', label: t('admin.overview'), icon: '📊' },
      { key: 'квартиры', label: t('admin.apartments'), icon: '🏠' },
      { key: 'смены', label: t('admin.transfers'), icon: '🔁' },
      { key: 'заявки', label: t('admin.requests'), icon: '📋' },
      { key: 'счётчики', label: t('admin.meters'), icon: '⚡' },
      { key: 'вода', label: t('admin.water'), icon: '💧' },
      { key: 'персонал', label: t('admin.staff'), icon: '👷' },
      { key: 'настройки', label: t('admin.settings'), icon: '⚙️' },
      { key: 'такса', label: t('admin.fee'), icon: '💶' },
      { key: 'электроэнергия', label: t('admin.electricityFinance'), icon: '⚡' },
      { key: 'капремонт', label: t('admin.capital'), icon: '🏗️' },
      { key: 'расходы', label: t('admin.expenses'), icon: '🧾' },
      { key: 'отчётность', label: t('admin.reports'), icon: '📄' },
      { key: 'опросы', label: t('admin.polls'), icon: '🗳️' },
      { key: 'документы', label: t('admin.docsMenu'), icon: '📁' },
      { key: 'объявления', label: t('admin.announcements'), icon: '📢' },
      { key: 'чат', label: t('admin.chat'), icon: '💬' },
    ],
    [t],
  );
  const menuByKey = useMemo(() => new Map(MENU_ITEMS.map((item) => [item.key, item])), [MENU_ITEMS]);
  const [sessionEmail, setSessionEmail] = useState('');
  const [staffRole, setStaffRole] = useState('');
  const [staffActive, setStaffActive] = useState(false);
  const showWater = canSeeWaterAdmin(staffRole);
  const showCapital = canSeeCapitalAdmin(staffRole);
  const showElectricityFinance = canSeeElectricityFinance(staffRole);
  const canEditStaff = isUkAdminRole(staffRole);
  const canManageCriticalAccess = staffActive && isUkAdminRole(staffRole);
  const canReadPropertyDirectory = staffActive && (
    isUkAdminRole(staffRole) || isUkAccountantRole(staffRole) || staffRole === 'инженер'
  );
  const canReadSupportFinance = staffActive && canRecordSupportPayments(staffRole);
  const showStaffSalary = staffRole.trim().toLowerCase() === 'администрация';
  const MENU_GROUPS: AdminMenuGroup[] = useMemo(() => {
    const groups: AdminMenuGroup[] = [
      { id: 'overview', label: t('admin.overview'), items: ['обзор'] },
      ...(canManageCriticalAccess
        ? [{ id: 'objects', label: t('admin.menuObjects'), items: ['квартиры', 'смены'] as AdminSection[] }]
        : []),
      {
        id: 'utilities',
        label: t('admin.menuUtilities'),
        items: [
          ...(showWater ? (['вода'] as const) : []),
          'электроэнергия',
        ],
      },
      {
        id: 'finance',
        label: t('admin.menuFinance'),
        items: [
          ...(canReadSupportFinance ? (['такса'] as const) : []),
          ...(showCapital ? (['капремонт'] as const) : []),
          'расходы',
          ...(canReadSupportFinance ? (['отчётность'] as const) : []),
        ],
      },
      {
        id: 'comms',
        label: t('admin.menuComm'),
        items: [
          ...(canManageCriticalAccess ? (['заявки'] as const) : []),
          'объявления',
          'опросы',
          ...(canManageCriticalAccess ? (['чат'] as const) : []),
        ],
      },
      { id: 'docs', label: t('admin.menuDocs'), items: ['документы'] },
      { id: 'system', label: t('admin.menuSystem'), items: ['персонал', 'настройки'] },
    ];
    return groups.filter((group) => group.items.length > 0);
  }, [t, showWater, showCapital, canManageCriticalAccess, canReadSupportFinance]);
  const visibleSectionSet = useMemo(() => {
    const keys = new Set<AdminSection>();
    for (const group of MENU_GROUPS) {
      for (const key of group.items) keys.add(key);
    }
    return keys;
  }, [MENU_GROUPS]);
  const financeGroup = useMemo(
    () => MENU_GROUPS.find((group) => group.id === 'finance'),
    [MENU_GROUPS],
  );
  const [hasCabinet, setHasCabinet] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [supportRate, setSupportRate] = useState(DEFAULT_SUPPORT_RATE);
  const [supportRateInput, setSupportRateInput] = useState(String(DEFAULT_SUPPORT_RATE));
  const [electricityMode, setElectricityMode] = useState<ElectricityMode>(DEFAULT_ELECTRICITY_MODE);
  const [waterMode, setWaterMode] = useState<WaterMode>(DEFAULT_WATER_MODE);
  const [supportFeeMissing, setSupportFeeMissing] = useState(false);
  const [ledger, setLedger] = useState<SupportFeeEntry[]>([]);
  const [payPropertyId, setPayPropertyId] = useState<number | ''>('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const supportPayKeyRef = useRef<{ key: string; sig: string } | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [chargeYear, setChargeYear] = useState(String(new Date().getFullYear()));
  const [chargeSaving, setChargeSaving] = useState(false);
  const [feeChargeExisting, setFeeChargeExisting] = useState<number | null>(null);
  const [feeBulkResult, setFeeBulkResult] = useState<string | null>(null);
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
  const [electricityMeters, setElectricityMeters] = useState<ElectricityMeter[]>([]);
  const [allGuests, setAllGuests] = useState<ApartmentGuest[]>([]);
  const [allPets, setAllPets] = useState<ApartmentPet[]>([]);
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
  const [aptFiltersOpen, setAptFiltersOpen] = useState(false);

  // ---------- ФИЛЬТРЫ ЗАЯВОК ----------
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('');
  const [reqCategoryFilter, setReqCategoryFilter] = useState<string>('');
  const [reqPriorityFilter, setReqPriorityFilter] = useState<string>('');
  const [reqAptFilter, setReqAptFilter] = useState<string>('');
  const [reqSearch, setReqSearch] = useState('');
  const [reqFiltersOpen, setReqFiltersOpen] = useState(false);
  const [requestDetailId, setRequestDetailId] = useState<number | null>(null);
  const [annDetailId, setAnnDetailId] = useState<number | null>(null);
  const [pollDetailId, setPollDetailId] = useState<number | null>(null);

  // ---------- ФИЛЬТРЫ СЧЁТЧИКОВ ----------
  const [meterAptFilter] = useState<string>('');

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
  const [chatFile, setChatFile] = useState<File | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedChatRef = useRef<Property | null>(null);
  selectedChatRef.current = selectedChatProperty;
  const [totalUnreadChats, setTotalUnreadChats] = useState(0);
  const [ukChatSeen, setUkChatSeen] = useState<Record<string, string>>({});

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
    occupancy_status: 'owner',
    occupant_kind: 'owner',
    occupant_name: '',
    occupant_phone: '',
    occupant_email: '',
    occupant_until: '',
    pet_info: '',
  });

  const [showMeterForm, setShowMeterForm] = useState(false);
  const [meterForm, setMeterForm] = useState({
    property_id: '',
    day: '',
    night: '',
    reading_date: new Date().toISOString().slice(0, 10),
  });
  const meterIdempotencyRef = useRef<string | null>(null);
  const [elMeterPropertyId, setElMeterPropertyId] = useState('');
  const [showElAssign, setShowElAssign] = useState(false);
  const [showElReplace, setShowElReplace] = useState(false);
  const [elMeterBusy, setElMeterBusy] = useState(false);
  const [elMeterNumber, setElMeterNumber] = useState('');
  const [elInitialDay, setElInitialDay] = useState('');
  const [elInitialNight, setElInitialNight] = useState('');
  const [elInstalledAt, setElInstalledAt] = useState(todayIsoDate());
  const [elReplaceNumber, setElReplaceNumber] = useState('');
  const [elReplaceDay, setElReplaceDay] = useState('');
  const [elReplaceNight, setElReplaceNight] = useState('');
  const [elReplaceDate, setElReplaceDate] = useState(todayIsoDate());
  const [elReplaceReason, setElReplaceReason] = useState('');

  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annForm, setAnnForm] = useState({ title: '', body: '', created_by: 'УК' });

  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<UkExpense | null>(null);
  const [expenseYearFilter, setExpenseYearFilter] = useState<number | 'all'>(
    new Date().getFullYear()
  );
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<'all' | 'pending' | 'published'>('all');
  const [expenseDetailId, setExpenseDetailId] = useState<number | null>(null);
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
      const emptyList = <T,>() => Promise.resolve({ data: [] as T[], error: null });
      const [
        propsRes, reqsRes, annsRes, staffRes, expRes, metersRes, guestsRes, petsRes, chatRes,
        pollsRes, optRes, voteRes, histRes,
      ] = await Promise.all([
        canManageCriticalAccess
          ? supabase.from('properties').select('*').order('apartment_number', { ascending: true })
          : canReadPropertyDirectory
            ? supabase.rpc('list_staff_property_directory')
            : emptyList<Property>(),
        canManageCriticalAccess
          ? supabase.from('requests').select('*').order('created_at', { ascending: false })
          : emptyList<Request>(),
        supabase.from('announcements').select('*').order('created_at', { ascending: false }),
        supabase
          .from('staff')
          .select('id, name, role, phone, email, active')
          .order('name', { ascending: true }),
        supabase.from('uk_expenses').select('*').order('expense_date', { ascending: false }),
        supabase.from('meter_readings').select('*').order('reading_date', { ascending: false }),
        canManageCriticalAccess
          ? supabase.from('apartment_guests').select('*').order('created_at', { ascending: true })
          : emptyList<ApartmentGuest>(),
        supabase.from('apartment_pets').select('*').order('created_at', { ascending: true }),
        canManageCriticalAccess
          ? supabase.from('chat_messages').select('*').order('created_at', { ascending: true })
          : emptyList<ChatMessage>(),
        supabase.from('polls').select('*').order('created_at', { ascending: false }),
        supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
        canManageCriticalAccess
          ? supabase.from('poll_votes').select('*')
          : emptyList<PollVote>(),
        canManageCriticalAccess
          ? supabase.from('poll_vote_history').select('*').order('created_at', { ascending: false })
          : emptyList<PollVoteHistory>(),
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
      if (petsRes.error) {
        if (!isMissingRelation(petsRes.error, 'apartment_pets')) throw petsRes.error;
        setAllPets([]);
      } else {
        setAllPets((petsRes.data as ApartmentPet[]) ?? []);
      }
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

      let staffRows: StaffMember[] = ((staffRes.data as Omit<StaffMember, 'salary_eur'>[]) ?? [])
        .map((member) => ({
          ...member,
          active: member.active === true,
          salary_eur: null,
        }));

      if (showStaffSalary && staffActive) {
        const salaryRes = await supabase.rpc('get_staff_salaries');
        if (salaryRes.error) throw salaryRes.error;
        const salaries = new Map(
          (salaryRes.data ?? []).map((row) => [row.id, row.salary_eur] as const),
        );
        staffRows = staffRows.map((member) => ({
          ...member,
          salary_eur: salaries.get(member.id) ?? null,
        }));
      }

      setProperties((propsRes.data as Property[]) ?? []);
      setRequests((reqsRes.data as Request[]) ?? []);
      setAnnouncements((annsRes.data as Announcement[]) ?? []);
      setStaff(staffRows);
      setMeterReadings((metersRes.data as MeterReading[]) ?? []);
      const elMetersRes = await supabase.from('electricity_meters').select('*').order('created_at', { ascending: false });
      if (elMetersRes.error) {
        if (!isMissingRelation(elMetersRes.error, 'electricity_meters')) throw elMetersRes.error;
        setElectricityMeters([]);
      } else {
        setElectricityMeters((elMetersRes.data as ElectricityMeter[]) ?? []);
      }
      setAllGuests((guestsRes.data as ApartmentGuest[]) ?? []);
      if (!petsRes.error) setAllPets((petsRes.data as ApartmentPet[]) ?? []);
      setAllChatMessages((chatRes.data as ChatMessage[]) ?? []);

      const trRes = canManageCriticalAccess
        ? await supabase
          .from('owner_transfers')
          .select('*')
          .order('created_at', { ascending: false })
        : { data: [] as OwnerTransfer[], error: null };
      if (trRes.error) {
        if (!isMissingRelation(trRes.error, 'owner_transfers')) throw trRes.error;
        setOwnerTransfers([]);
      } else {
        setOwnerTransfers((trRes.data as OwnerTransfer[]) ?? []);
      }

      const settingsRes = await supabase.rpc('read_building_settings');
      const ledgerRes = canReadSupportFinance
        ? await supabase
          .from('support_fee_ledger')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200)
        : { data: [] as SupportFeeEntry[], error: null };

      const settingsRow = Array.isArray(settingsRes.data) ? settingsRes.data[0] : settingsRes.data;
      if (settingsRes.error && isMissingRelation(settingsRes.error, 'building_settings')) {
        setSupportFeeMissing(true);
        setSupportRate(DEFAULT_SUPPORT_RATE);
        setSupportRateInput(String(DEFAULT_SUPPORT_RATE));
      } else if (settingsRes.error) {
        throw settingsRes.error;
      } else {
        const rate = settingsRow?.support_rate_eur_per_sqm_year;
        if (rate != null && Number(rate) > 0) {
          setSupportRate(Number(rate));
          setSupportRateInput(String(rate));
        }
        setElectricityMode(parseElectricityMode(settingsRow?.electricity_mode));
        setWaterMode(parseWaterMode(settingsRow?.water_mode));
        setSupportFeeMissing(false);
      }

      if (ledgerRes.error) {
        if (!isMissingRelation(ledgerRes.error, 'support_fee_ledger')) throw ledgerRes.error;
        setLedger([]);
        setSupportFeeMissing(true);
      } else {
        setLedger((ledgerRes.data as SupportFeeEntry[]) ?? []);
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!/^\d{4}$/.test(chargeYear.trim())) {
      setFeeChargeExisting(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('support_fee_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'charge')
      .eq('period', chargeYear.trim())
      .then(({ count }) => {
        if (!cancelled) setFeeChargeExisting(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [chargeYear, chargeSaving, supabase]);

  useEffect(() => {
    let cancelled = false;
    async function gate() {
      try {
        const { data } = await supabase.auth.getUser();
        const email = normalizeEmail(data.user?.email ?? '');

        if (!email) {
          router.replace('/');
          return;
        }

        const access = await resolveAccess(email, supabase);
        if (cancelled) return;
        if (!access.isStaff) {
          router.replace(access.isOwner ? '/account' : '/');
          return;
        }
        setSessionEmail(email);
        setStaffRole(access.staff?.role ?? '');
        setStaffActive(access.staff?.active === true);
        setHasCabinet(access.isOwner);
        setAllowed(true);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(ownerVisibleError(e, t('admin.errGeneric')));
          router.replace('/');
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }
    gate();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // logout UI должен продолжиться
    } finally {
      setSessionEmail('');
        setStaffRole('');
        setStaffActive(false);
      setHasCabinet(false);
      setAllowed(false);
      router.replace('/');
    }
  }

  useEffect(() => {
    if (allowed) loadAll();
  }, [allowed]);

  const sectionQuery = searchParams.get('section');
  const activeMenu: AdminSection = useMemo(() => {
    if (sectionQuery === 'счётчики' && visibleSectionSet.has('электроэнергия')) return 'электроэнергия';
    if (isAdminSection(sectionQuery) && visibleSectionSet.has(sectionQuery)) return sectionQuery;
    return DEFAULT_ADMIN_SECTION;
  }, [sectionQuery, visibleSectionSet]);
  const activeNavGroup = useMemo(() => {
    const group = MENU_GROUPS.find((item) => item.id !== 'overview' && item.items.includes(activeMenu));
    return group?.id ?? null;
  }, [MENU_GROUPS, activeMenu]);
  const [navGroupOverride, setNavGroupOverride] = useState<{ section: AdminSection; groupId: string | null } | null>(null);
  const openNavGroup = navGroupOverride?.section === activeMenu ? navGroupOverride.groupId : activeNavGroup;

  function toggleNavGroup(id: string) {
    setNavGroupOverride({ section: activeMenu, groupId: openNavGroup === id ? null : id });
  }

  const closeMobileNav = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setSidebarOpen(false);
    }
  }, []);

  const navigateAdminSection = useCallback(
    (key: AdminSection) => {
      if (!visibleSectionSet.has(key)) {
        closeMobileNav();
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('section', key);
      params.delete('tab');
      const qs = params.toString();
      if (qs !== searchParams.toString()) {
        router.push(`${pathname}?${qs}`, { scroll: false });
      }
      closeMobileNav();
    },
    [closeMobileNav, pathname, router, searchParams, visibleSectionSet],
  );

  const openUtilityTab = useCallback(
    (key: 'вода' | 'электроэнергия', nextTab: AdminUtilityTab) => {
      if (!visibleSectionSet.has(key)) {
        closeMobileNav();
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('section', key);
      params.set('tab', nextTab);
      const qs = params.toString();
      if (qs !== searchParams.toString()) {
        router.push(`${pathname}?${qs}`, { scroll: false });
      }
      closeMobileNav();
    },
    [closeMobileNav, pathname, router, searchParams, visibleSectionSet],
  );

  const openSectionTab = useCallback(
    (key: AdminSection, nextTab: string) => {
      if (!visibleSectionSet.has(key)) {
        closeMobileNav();
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('section', key);
      params.set('tab', nextTab);
      const qs = params.toString();
      if (qs !== searchParams.toString()) {
        router.push(`${pathname}?${qs}`, { scroll: false });
      }
      closeMobileNav();
    },
    [closeMobileNav, pathname, router, searchParams, visibleSectionSet],
  );

  useEffect(() => {
    if (!allowed || !authReady) return;
    if (sectionQuery === 'счётчики') {
      const params = new URLSearchParams(searchParams.toString());
      if (visibleSectionSet.has('электроэнергия')) {
        params.set('section', 'электроэнергия');
        params.set('tab', 'meter');
      } else {
        params.delete('section');
        params.delete('tab');
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return;
    }
    if (sectionQuery == null || sectionQuery === '') return;
    if (isAdminSection(sectionQuery) && visibleSectionSet.has(sectionQuery)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('section');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [allowed, authReady, pathname, router, searchParams, sectionQuery, visibleSectionSet]);

  useEffect(() => {
    if (!allowed || !authReady || !staffRole || sectionQuery !== 'электроэнергия') return;
    const raw = searchParams.get('tab');
    if (!raw) return;
    const allowedTabs = ['overview', 'meter', 'readings', ...(showElectricityFinance ? ['tariff', 'finance'] : [])];
    if (allowedTabs.includes(raw)) return;
    openUtilityTab('электроэнергия', 'overview');
  }, [allowed, authReady, openUtilityTab, searchParams, sectionQuery, showElectricityFinance, staffRole]);

  useEffect(() => {
    if (!allowed || !authReady) return;
    if (sectionQuery !== 'такса' && sectionQuery !== 'капремонт') return;
    const raw = searchParams.get('tab');
    if (!raw) return;
    const allowedTabs = sectionQuery === 'такса'
      ? ['overview', 'policy', 'operations', 'register']
      : ['overview', 'charges', 'operations'];
    if (allowedTabs.includes(raw)) return;
    openSectionTab(sectionQuery, 'overview');
  }, [allowed, authReady, openSectionTab, searchParams, sectionQuery]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setUkChatSeen(loadUkChatSeenMap());
  }, []);

  function markUkChatSeen(propertyId: number, at = new Date().toISOString()) {
    const key = String(propertyId);
    setUkChatSeen((prev) => {
      const prevAt = prev[key];
      if (prevAt && messageTime(prevAt) >= messageTime(at)) return prev;
      const next = { ...prev, [key]: at };
      persistUkChatSeenMap(next);
      return next;
    });
    void supabase
      .from('chat_messages')
      .update({ read_by_uk: true })
      .eq('property_id', propertyId)
      .neq('sender', 'uk');
  }

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
      const seenAt = ukChatSeen[String(prop.id)];
      const unread = msgsForProp.filter((m) => isNewOwnerMessage(m, msgsForProp, seenAt)).length;
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
  }, [properties, allChatMessages, ukChatSeen]); // eslint-disable-line

  useEffect(() => {
    if (!allowed) return;
    chatPollRef.current = setInterval(async () => {
      const { data: freshMsgs } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true });
      if (!freshMsgs) return;
      const msgs = freshMsgs as ChatMessage[];
      setAllChatMessages(msgs);
      const sel = selectedChatRef.current;
      if (sel) {
        const thread = msgs.filter((m) => m.property_id === sel.id);
        setChatMessages(thread);
        markUkChatSeen(sel.id);
      }
    }, 5000);
    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current);
    };
  }, [allowed]); // eslint-disable-line

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (!selectedChatProperty) return;
    setChatFile(null);
    if (chatFileRef.current) chatFileRef.current.value = '';
    markUkChatSeen(selectedChatProperty.id);
    let cancelled = false;
    (async () => {
      await loadChatMessages();
      if (cancelled) return;
      markUkChatSeen(selectedChatProperty.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChatProperty]); // eslint-disable-line

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
    if (!selectedChatProperty) return;
    const msg = chatInput.trim();
    if (!msg && !chatFile) return;
    if (chatFile && chatFile.size > MAX_CHAT_FILE_BYTES) {
      setError(t('account.fileTooBig'));
      return;
    }
    setChatSending(true);
    try {
      markUkChatSeen(selectedChatProperty.id);
      let photoUrl: string | null = null;
      if (chatFile) {
        const filePath = chatFilePath(selectedChatProperty.id, chatFile.name);
        photoUrl = await uploadPrivateFile(supabase, CHAT_FILES_BUCKET, filePath, chatFile);
      }
      const payload: Database['public']['Tables']['chat_messages']['Insert'] = {
        property_id: selectedChatProperty.id,
        sender: 'uk',
        message: msg,
        read_by_uk: true,
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
      const row = inserted as ChatMessage;
      markUkChatSeen(selectedChatProperty.id, row.created_at);
      setChatMessages((prev) => [...prev, row]);
      setAllChatMessages((prev) => [...prev, row]);
      setChatInput('');
      setChatFile(null);
      if (chatFileRef.current) chatFileRef.current.value = '';
    } catch (e: any) {
      setError(e?.message ?? t('err.sendShort'));
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

  function petsForProperty(propId: number) {
    return allPets.filter((p) => p.property_id === propId);
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
      case 'owner': return 'text-accent';
      case 'standby': return 'text-warning';
      case 'rented': return 'text-accent';
      default: return 'text-accent';
    }
  }

  async function exportRegistry(format: 'csv' | 'pdf') {
    const rows = [...properties].sort((a, b) =>
      String(a.apartment_number).localeCompare(String(b.apartment_number), undefined, { numeric: true }),
    );
    const headers = [
      t('form.colApt'),
      t('form.colFloor'),
      t('form.colArea'),
      t('form.colOwner'),
      t('registry.colOccupant'),
      t('registry.occupantKind'),
      t('registry.colPeople'),
      t('registry.household'),
      t('registry.colDogs'),
    ];
    const data = rows.map((p) => {
      const guests = guestsForProperty(p.id);
      const pets = petsForProperty(p.id);
      const kind = normalizeOccupantKind(p.occupant_kind);
      const occupant =
        kind === 'owner'
          ? (p.owner_name ?? '')
          : (p.occupant_name || p.owner_name || '');
      return [
        String(p.apartment_number ?? ''),
        String(p.floor ?? ''),
        p.area_sqm != null ? String(p.area_sqm) : '',
        p.owner_name ?? '',
        occupant,
        labelOccupantKind(kind, t),
        String(householdPeople(guests).length),
        householdNames(guests),
        dogChips(pets) || (p.pet_info ?? ''),
      ];
    });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      downloadCsv(`kniga-zues-${stamp}.csv`, [headers, ...data]);
      return;
    }
    await downloadHtmlAsPdf(
      `kniga-zues-${stamp}.pdf`,
      buildRegistryPdfHtml({
        title: t('registry.book'),
        generated: `${t('admin.pdfGenerated')}: ${formatOwnerDateTime(new Date().toISOString(), locale)}`,
        hint: t('registry.exportHint'),
        headers,
        rows: data,
      }),
    );
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
      const propsWithPets = new Set(allPets.map((x) => x.property_id));
      if (aptPetsFilter === 'has_pets') {
        result = result.filter((p) => (p.pet_info && p.pet_info.trim() !== '') || propsWithPets.has(p.id));
      } else {
        result = result.filter((p) => (!p.pet_info || p.pet_info.trim() === '') && !propsWithPets.has(p.id));
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
      aptOwnerTypeFilter, aptDebtFilter, aptGuestsFilter, aptPetsFilter, aptSort, allGuests, allPets]);

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
      occupancy_status: p.occupancy_status ?? 'owner',
      occupant_kind: normalizeOccupantKind(p.occupant_kind),
      occupant_name: p.occupant_name ?? '',
      occupant_phone: p.occupant_phone ?? '',
      occupant_email: p.occupant_email ?? '',
      occupant_until: p.occupant_until ? String(p.occupant_until).slice(0, 10) : '',
      pet_info: p.pet_info ?? '',
    });
    setShowPropForm(true);
  }

  function startNewProp() {
    if (!canManageCriticalAccess) {
      setError('Добавлять квартиры может только активный администратор.');
      return;
    }
    setEditingProp(null);
    setPropForm({
      apartment_number: '', floor: '', area_sqm: '', owner_name: '', owner_email: '',
      owner_phone: '', owner_type: 'физическое лицо', company_name: '', status: 'в собственности',
      occupancy_status: 'owner',
      occupant_kind: 'owner', occupant_name: '', occupant_phone: '', occupant_email: '', occupant_until: '',
      pet_info: '',
    });
    setShowPropForm(true);
  }

  async function handleSaveProp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!editingProp && !canManageCriticalAccess) {
      setError('Добавлять квартиры может только активный администратор.');
      return;
    }
    const operationalPayload = {
      apartment_number: propForm.apartment_number.trim(),
      floor: Number(propForm.floor) || null,
      area_sqm: Number(propForm.area_sqm) || null,
      status: propForm.status,
      occupancy_status: propForm.occupancy_status,
      occupant_kind: propForm.occupant_kind,
      occupant_name: propForm.occupant_name.trim() || null,
      occupant_phone: propForm.occupant_phone.trim() || null,
      occupant_email: propForm.occupant_email.trim() || null,
      occupant_until: propForm.occupant_until || null,
      pet_info: propForm.pet_info.trim() || null,
    };
    const payload = canManageCriticalAccess
      ? {
          ...operationalPayload,
          owner_name: propForm.owner_name.trim(),
          owner_email: normalizeEmail(propForm.owner_email),
          owner_phone: propForm.owner_phone.trim() || null,
          owner_type: propForm.owner_type,
          company_name: propForm.company_name.trim() || null,
        }
      : operationalPayload;
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
      const msg = e?.message ?? t('err.save');
      setError(
        msg.includes('occupant_kind') || msg.includes('occupant_name')
          ? t('err.registrySql')
          : msg,
      );
    }
  }

  async function handleDeleteProp(id: number) {
    if (!canManageCriticalAccess) {
      setError('Удалять квартиры может только активный администратор.');
      return;
    }
    if (!confirm(t('confirm.deleteApt'))) return;
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
    if (electricityMode === 'disabled') {
      setError(t('account.elErrDisabled'));
      return;
    }
    if (!canSubmitElectricityStaff(staffRole, staffActive)) {
      setError(t('admin.errNoAccess'));
      return;
    }
    const day = Number(String(meterForm.day).replace(',', '.'));
    const night = Number(String(meterForm.night).replace(',', '.'));
    if (!Number.isFinite(day) || !Number.isFinite(night)) {
      setError(t('account.utilNeedNumber'));
      return;
    }
    if (!meterIdempotencyRef.current) {
      meterIdempotencyRef.current = crypto.randomUUID();
    }
    try {
      const { error } = await supabase.rpc('submit_electricity_reading', {
        p_property_id: Number(meterForm.property_id),
        p_day_reading: Number(day.toFixed(3)),
        p_night_reading: Number(night.toFixed(3)),
        p_reading_date: meterForm.reading_date,
        p_idempotency_key: meterIdempotencyRef.current,
      });
      if (error) {
        const key = mapSubmitElectricityError(error.message);
        const map = {
          lower: t('account.utilErrLower'),
          datePrev: t('account.utilErrDatePrev'),
          future: t('account.utilErrFuture'),
          conflict: t('account.utilErrConflict'),
          disabled: t('account.elErrDisabled'),
          staffOnly: t('account.elStaffOnly'),
          noMeter: t('account.elErrNoMeter'),
          generic: error.message || t('account.utilErrGeneric'),
        } as const;
        throw new Error(map[key]);
      }
      setShowMeterForm(false);
      setMeterForm({
        property_id: '',
        day: '',
        night: '',
        reading_date: new Date().toISOString().slice(0, 10),
      });
      meterIdempotencyRef.current = null;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка сохранения показания');
    }
  }

  async function handleAssignElectricityMeter(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageElectricityMeter(staffRole, staffActive)) {
      setError(t('admin.errNoAccess'));
      return;
    }
    const propertyId = Number(elMeterPropertyId || meterAptFilter);
    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      setError(t('form.pickApt'));
      return;
    }
    const day = Number(String(elInitialDay).replace(',', '.'));
    const night = Number(String(elInitialNight).replace(',', '.'));
    if (!elMeterNumber.trim() || !Number.isFinite(day) || !Number.isFinite(night) || day < 0 || night < 0) {
      setError(t('account.utilNeedNumber'));
      return;
    }
    setElMeterBusy(true);
    setError(null);
    try {
      const { error } = await supabase.rpc('assign_electricity_meter', {
        p_property_id: propertyId,
        p_meter_number: elMeterNumber.trim(),
        p_initial_day_reading: Number(day.toFixed(3)),
        p_initial_night_reading: Number(night.toFixed(3)),
        p_installed_at: elInstalledAt,
      });
      if (error) throw new Error(t(mapAdminRpcError(error.message)));
      setShowElAssign(false);
      setElMeterNumber('');
      setElInitialDay('');
      setElInitialNight('');
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? t('admin.errGeneric'));
    } finally {
      setElMeterBusy(false);
    }
  }

  async function handleReplaceElectricityMeter(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageElectricityMeter(staffRole, staffActive)) {
      setError(t('admin.errNoAccess'));
      return;
    }
    const propertyId = Number(elMeterPropertyId || meterAptFilter);
    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      setError(t('form.pickApt'));
      return;
    }
    const day = Number(String(elReplaceDay).replace(',', '.'));
    const night = Number(String(elReplaceNight).replace(',', '.'));
    if (!elReplaceNumber.trim() || !elReplaceReason.trim() || !Number.isFinite(day) || !Number.isFinite(night) || day < 0 || night < 0) {
      setError(t('account.utilNeedNumber'));
      return;
    }
    setElMeterBusy(true);
    setError(null);
    try {
      const { error } = await supabase.rpc('replace_electricity_meter', {
        p_property_id: propertyId,
        p_new_meter_number: elReplaceNumber.trim(),
        p_initial_day_reading: Number(day.toFixed(3)),
        p_initial_night_reading: Number(night.toFixed(3)),
        p_installed_at: elReplaceDate,
        p_replacement_reason: elReplaceReason.trim(),
      });
      if (error) throw new Error(t(mapAdminRpcError(error.message)));
      setShowElReplace(false);
      setElReplaceNumber('');
      setElReplaceDay('');
      setElReplaceNight('');
      setElReplaceReason('');
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? t('admin.errGeneric'));
    } finally {
      setElMeterBusy(false);
    }
  }

  async function handleSaveElectricityMode(mode: ElectricityMode) {
    if (staffRole.trim().toLowerCase() !== 'администрация') {
      setError(t('admin.errNoAccess'));
      return;
    }
    setError(null);
    try {
      const { error } = await supabase.from('building_settings').upsert({
        id: 1,
        support_rate_eur_per_sqm_year: supportRate,
        electricity_mode: mode,
        updated_at: new Date().toISOString(),
        updated_by: sessionEmail,
      }).select('id');
      if (error) throw error;
      setElectricityMode(mode);
    } catch (e: any) {
      setError(e?.message ?? t('admin.errGeneric'));
    }
  }

  async function handleSaveWaterMode(mode: WaterMode) {
    if (staffRole.trim().toLowerCase() !== 'администрация') {
      setError(t('admin.errNoAccess'));
      return;
    }
    setError(null);
    try {
      const { error } = await supabase.from('building_settings').upsert({
        id: 1,
        support_rate_eur_per_sqm_year: supportRate,
        electricity_mode: electricityMode,
        water_mode: mode,
        updated_at: new Date().toISOString(),
        updated_by: sessionEmail,
      }).select('id');
      if (error) throw error;
      setWaterMode(mode);
    } catch (e: any) {
      setError(e?.message ?? t('admin.errGeneric'));
    }
  }

  async function handleSaveAnn(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
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
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return false;
    }
    if (!confirm(t('confirm.deleteAnn'))) return false;
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      setAnnDetailId((current) => (current === id ? null : current));
      await loadAll();
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
      return false;
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
      const filePath = expenseReceiptPath(expenseId, file.name);
      urls.push(await uploadPrivateFile(supabase, EXPENSE_RECEIPTS_BUCKET, filePath, file));
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
    if (!canManageCriticalAccess) {
      setError('Удалять расходы может только активный администратор.');
      return;
    }
    if (!confirm('Удалить расход?')) return;
    try {
      const { error } = await supabase.from('uk_expenses').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
    }
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
      }).select('id');
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
      setError(t('err.pickApt'));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Сумма должна быть больше нуля');
      return;
    }
    const note = payNote.trim();
    const sig = supportPaymentIdempotencySignature({
      mode: 'regular',
      propertyId: property.id,
      amount,
      note,
    });
    if (!supportPayKeyRef.current || supportPayKeyRef.current.sig !== sig) {
      supportPayKeyRef.current = { key: crypto.randomUUID(), sig };
    }
    setPaySaving(true);
    setError(null);
    try {
      const { error } = await supabase.rpc('record_support_payment', {
        p_property_id: property.id,
        p_amount: amount,
        p_note: note || null,
        p_idempotency_key: supportPayKeyRef.current.key,
      });
      if (error) throw error;
      supportPayKeyRef.current = null;
      setPayAmount('');
      setPayNote('');
      await loadAll();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message ?? '')
          : '';
      if (isMissingRelation(err as { message?: string }, 'support_fee_ledger')) {
        setSupportFeeMissing(true);
        setError('Выполните supabase/support_fee.sql в SQL Editor.');
      } else if (msg.toLowerCase().includes('idempotency key conflict')) {
        setError(t('admin.errIdempotency'));
      } else {
        setError(msg || 'Не удалось записать оплату');
      }
    } finally {
      setPaySaving(false);
    }
  }

  async function handleChargeSupportBulk() {
    if (!canRecordSupportPayments(staffRole)) {
      setError('Начислять таксу могут администратор и бухгалтер.');
      return;
    }
    const year = chargeYear.trim();
    if (!/^\d{4}$/.test(year)) {
      setError('Укажите год начисления, например 2026.');
      return;
    }
    const total = properties.length;
    if (total === 0) return;
    const existingCount = feeChargeExisting ?? 0;
    const will = Math.max(0, total - existingCount);
    if (!confirm(t('confirm.bulkSupport', { year, total, existing: existingCount, will }))) return;
    setChargeSaving(true);
    setError(null);
    setFeeBulkResult(null);
    try {
      const { data, error } = await supabase.rpc('charge_support_fee_bulk', { p_period: year });
      if (error) throw error;
      const summary = readBulkAccrualSummary(data);
      if (!summary) {
        setError(t('admin.errGeneric'));
        return;
      }
      const base = t('admin.bulkResult', { created: summary.created, skipped: summary.skipped_existing });
      setFeeBulkResult(
        summary.not_applied > 0 ? `${base} ${t('admin.bulkNotApplied', { n: summary.not_applied })}` : base,
      );
      await loadAll();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message ?? '') : '';
      if (isMissingRelation(err as { message?: string }, 'support_fee_ledger')) {
        setSupportFeeMissing(true);
        setError('Выполните supabase/support_fee.sql в SQL Editor.');
      } else if (/could not find the function/i.test(msg)) {
        setError(t('admin.bulkUnavailable'));
      } else {
        setError(msg || 'Не удалось начислить таксу');
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
    if (!canEditStaff) return;
    setError(null);
    const payload: {
      name: string;
      role: string;
      phone: string | null;
      email: string | null;
      active: boolean;
      salary_eur?: number | null;
    } = {
      name: staffForm.name.trim(),
      role: staffForm.role.trim(),
      phone: staffForm.phone.trim() || null,
      email: staffForm.email.trim() ? normalizeEmail(staffForm.email) : null,
      active: staffForm.active,
    };
    if (showStaffSalary) payload.salary_eur = Number(staffForm.salary_eur) || null;
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
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    }
  }

  async function handleDeleteStaff(id: number) {
    if (!canEditStaff) return;
    if (!confirm(t('confirm.deleteStaff'))) return;
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    }
  }

  function startNewPoll() {
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
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
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
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
        const filePath = pollImagePath(pollId, pollPhoto.name);
        const storedPath = await uploadPrivateFile(supabase, POLL_IMAGES_BUCKET, filePath, pollPhoto);
        await supabase.from('polls').update({ photo_url: storedPath }).eq('id', pollId);
      }
      setShowPollForm(false);
      setPollPhoto(null);
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка создания опроса');
    }
  }

  async function handleTogglePoll(poll: Poll) {
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
    try {
      const { error } = await supabase.rpc('set_poll_lifecycle', {
        p_poll_id: poll.id,
        p_close: poll.status === 'открыт',
      });
      if (error) throw error;
      await loadAll();
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка смены статуса');
    }
  }

  async function handleDeletePoll(id: number) {
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return false;
    }
    if (!confirm(t('confirm.deletePoll'))) return false;
    try {
      const { error } = await supabase.from('polls').delete().eq('id', id);
      if (error) throw error;
      setPollDetailId((current) => (current === id ? null : current));
      setExpandedPollHistory((current) => (current === id ? null : current));
      await loadAll();
      return true;
    } catch (err: any) {
      setError(err?.message ?? 'Ошибка удаления');
      return false;
    }
  }

  async function handleApproveTransfer(tr: OwnerTransfer) {
    if (!canManageCriticalAccess) {
      setError('Решение по смене собственника принимает только активный администратор.');
      return;
    }
    if (!confirm(t('admin.approveTransfer', { n: propertyNameById(tr.property_id) }))) return;
    try {
      const { error: updErr } = await supabase
        .from('properties')
        .update({
          owner_name: tr.to_owner_name,
          owner_email: normalizeEmail(tr.to_owner_email),
          owner_phone: tr.to_owner_phone,
        })
        .eq('id', tr.property_id);
      if (updErr) throw updErr;
      const { error } = await supabase
        .from('owner_transfers')
        .update({
          status: 'утверждена',
          decided_at: new Date().toISOString(),
          decided_by: sessionEmail,
        })
        .eq('id', tr.id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка утверждения');
    }
  }

  async function handleRejectTransfer(t: OwnerTransfer) {
    if (!canManageCriticalAccess) {
      setError('Решение по смене собственника принимает только активный администратор.');
      return;
    }
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
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
    try {
      const { error } = await supabase.from('requests').update({ status: newStatus }).eq('id', reqId);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка обновления статуса');
    }
  }

  async function handleDeleteRequest(id: number) {
    if (!canManageCriticalAccess) {
      setError(t('admin.errNoAccess'));
      return;
    }
    if (!confirm(t('confirm.deleteRequest'))) return false;
    try {
      const { error } = await supabase.from('requests').delete().eq('id', id);
      if (error) throw error;
      setRequestDetailId((current) => (current === id ? null : current));
      await loadAll();
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
      return false;
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
        const debtCount = properties.filter((p) => Number(p.debt ?? 0) > 0).length;
        const attention: {
          key: AdminSection;
          title: string;
          detail: string;
          badge: string;
          tone: 'danger' | 'warning' | 'info';
        }[] = [];
        if (activeRequests.length > 0) {
          attention.push({
            key: 'заявки',
            title: t('admin.activeReq'),
            detail: t('admin.attnReqDetail', { n: activeRequests.length }),
            badge: String(activeRequests.length),
            tone: 'warning',
          });
        }
        if (pendingTransfersCount > 0) {
          attention.push({
            key: 'смены',
            title: t('admin.transfers'),
            detail: t('admin.attnTransferDetail', { n: pendingTransfersCount }),
            badge: String(pendingTransfersCount),
            tone: 'warning',
          });
        }
        if (pendingUkExpenses.length > 0) {
          attention.push({
            key: 'расходы',
            title: t('admin.expenses'),
            detail: t('admin.attnExpenseDetail', { n: pendingUkExpenses.length }),
            badge: String(pendingUkExpenses.length),
            tone: 'warning',
          });
        }
        if (totalDebt > 0) {
          attention.push({
            key: 'такса',
            title: t('admin.kpiDebtTitle'),
            detail: t('admin.attnDebtDetail', { n: debtCount }),
            badge: money(totalDebt),
            tone: 'danger',
          });
        }
        if (openPollsCount > 0) {
          attention.push({
            key: 'опросы',
            title: t('admin.kpiPollsTitle'),
            detail: t('admin.attnPollDetail', { n: openPollsCount }),
            badge: String(openPollsCount),
            tone: 'info',
          });
        }
        if (totalUnreadChats > 0) {
          attention.push({
            key: 'чат',
            title: t('admin.chat'),
            detail: t('admin.attnChatDetail', { n: totalUnreadChats }),
            badge: String(totalUnreadChats),
            tone: 'info',
          });
        }

        return (
          <div className="space-y-3">
            <AdminPageHeader title={t('admin.overview')} secondary={t('admin.overviewLead')} />

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {canReadPropertyDirectory ? (
              <AdminMetricCard
                align="center"
                label={t('admin.apartments')}
                value={String(properties.length)}
                secondary={t('admin.kpiAllObjects')}
                onClick={() => navigateAdminSection('квартиры')}
              />
              ) : null}
              {canManageCriticalAccess ? (
              <AdminMetricCard
                align="center"
                label={t('admin.activeReq')}
                value={String(activeRequests.length)}
                secondary={t('admin.kpiNeedWork')}
                alert={activeRequests.length > 0}
                onClick={() => navigateAdminSection('заявки')}
              />
              ) : null}
              {canReadSupportFinance ? (
              <AdminMetricCard
                align="center"
                label={t('admin.kpiDebtTitle')}
                value={money(totalDebt)}
                secondary={t('admin.kpiDebtHomes', { n: debtCount })}
                alert={totalDebt > 0}
                onClick={() => navigateAdminSection('такса')}
              />
              ) : null}
              <AdminMetricCard
                align="center"
                label={t('admin.kpiPollsTitle')}
                value={String(openPollsCount)}
                secondary={t('admin.kpiPollsHint')}
                onClick={() => navigateAdminSection('опросы')}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <AdminCard pad className="!p-3 md:!p-4">
                <h2 className="text-sm font-semibold text-foreground">{t('admin.attentionTitle')}</h2>
                {attention.length === 0 ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-foreground">{t('admin.attentionOkTitle')}</p>
                    <p className="mt-0.5 text-sm text-secondary">{t('admin.attentionOkText')}</p>
                  </div>
                ) : (
                  <div className="mt-1 divide-y divide-border">
                    {attention.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => navigateAdminSection(item.key)}
                        className="flex w-full items-center gap-3 py-2 text-left hover:bg-hover/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{item.title}</span>
                          <span className="block text-xs text-secondary">{item.detail}</span>
                        </span>
                        <StatusBadge label={item.badge} tone={item.tone} />
                        <span className="text-sm text-muted" aria-hidden>→</span>
                      </button>
                    ))}
                  </div>
                )}
              </AdminCard>

              <AdminCard pad className="!p-3 md:!p-4">
                <h2 className="text-sm font-semibold text-foreground">{t('admin.quickActions')}</h2>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {canManageCriticalAccess ? (
                    <button
                      type="button"
                      onClick={() => { navigateAdminSection('объявления'); setShowAnnForm(true); }}
                      className={adminBtnPrimaryClass}
                    >
                      {t('admin.quickAnnounce')}
                    </button>
                  ) : null}
                  {canManageCriticalAccess ? (
                    <button
                      type="button"
                      onClick={() => { startNewPoll(); navigateAdminSection('опросы'); }}
                      className={adminBtnSecondaryClass}
                    >
                      {t('admin.quickPoll')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => { navigateAdminSection('расходы'); setShowExpenseForm(true); }}
                    className={adminBtnSecondaryClass}
                  >
                    {t('admin.quickExpense')}
                  </button>
                </div>
              </AdminCard>
            </div>

            <AdminCard pad className="!p-3 md:!p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">{t('admin.occComplex')}</h2>
                <button
                  type="button"
                  onClick={() => navigateAdminSection('квартиры')}
                  className={adminBtnTertiaryClass}
                >
                  {t('admin.apartments')}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  [t('admin.occOwnersLive'), ownerCount],
                  [t('admin.occRentedShort'), rentedCount],
                  [t('admin.occUnused'), standbyCount],
                ].map(([label, count]) => (
                  <div key={String(label)} className={`${adminCardClass} flex h-full flex-col items-center justify-center px-2 py-2.5 text-center`}>
                    <span className="break-words text-xs leading-tight text-muted">{label}</span>
                    <span className="mt-1 text-xl font-semibold tabular-nums leading-none text-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>
        );
      }

      // =============================================================
      // КВАРТИРЫ
      // =============================================================
      case 'квартиры':
        return (
          <div className="md:rounded-2xl md:border md:border-border md:bg-surface md:p-6">
            <div className="mb-3 hidden md:mb-4 md:block">
              <AdminPageHeader
                title={t('admin.apartments')}
                secondary={`${t('admin.apartmentsLead')} ${t('admin.shownOf', { n: filteredProperties.length, total: properties.length })}`}
                action={
                  <div className="flex flex-wrap justify-end gap-2">
                    {aptActiveFiltersCount > 0 && (
                      <button type="button" onClick={clearAptFilters} className={adminBtnSecondaryClass}>
                        {t('admin.resetN', { n: aptActiveFiltersCount })}
                      </button>
                    )}
                    {canManageCriticalAccess ? (
                      <button type="button" onClick={startNewProp} className={adminBtnPrimaryClass}>
                        {t('admin.addPlus')}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => exportRegistry('csv')} className={adminBtnSecondaryClass}>
                      {t('registry.exportCsv')}
                    </button>
                    <button type="button" onClick={() => exportRegistry('pdf')} className={adminBtnSecondaryClass}>
                      {t('registry.exportPdf')}
                    </button>
                  </div>
                }
              />
            </div>

            <div className="mb-3 flex gap-2 md:hidden">
              <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-placeholder"
                placeholder={t('common.search')}
                value={aptSearch} onChange={(e) => setAptSearch(e.target.value)} />
              <button
                type="button"
                onClick={() => setAptFiltersOpen((v) => !v)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${
                  aptFiltersOpen || aptActiveFiltersCount > 0
                    ? 'border-accent/30 bg-accent-bg text-accent'
                    : 'border-border bg-surface text-secondary'
                }`}
              >
                {t('common.filters')}
                {aptActiveFiltersCount > 0 ? ` ${aptActiveFiltersCount}` : ''}
              </button>
              {canManageCriticalAccess ? (
                <button type="button" onClick={startNewProp}
                  className="shrink-0 rounded-xl bg-accent hover:bg-accent-hover px-3 py-2 text-sm font-semibold text-white">
                  +
                </button>
              ) : null}
            </div>

            {/* ФОРМА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ */}
            {showPropForm && (
              <form onSubmit={handleSaveProp} className={`mb-4 ${adminFormPanelClass}`}>
                <h3 className="text-sm font-semibold text-foreground">
                  {editingProp ? t('admin.editApt') : t('admin.newApt')}
                </h3>
                <p className="text-xs font-medium text-muted">{t('admin.aptGroupObject')}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input className={adminFieldClass}
                    placeholder={t('admin.phAptNo')} value={propForm.apartment_number}
                    onChange={(e) => setPropForm({ ...propForm, apartment_number: e.target.value })} required />
                  <input className={adminFieldClass}
                    placeholder={t('admin.phFloor')} type="number" value={propForm.floor}
                    onChange={(e) => setPropForm({ ...propForm, floor: e.target.value })} />
                  <input className={adminFieldClass}
                    placeholder={t('admin.phArea')} type="number" value={propForm.area_sqm}
                    onChange={(e) => setPropForm({ ...propForm, area_sqm: e.target.value })} />
                  <select className={adminFieldClass}
                    value={propForm.status}
                    onChange={(e) => setPropForm({ ...propForm, status: e.target.value })}>
                    <option value="в собственности">{t('account.owned')}</option>
                    <option value="на продаже">{t('account.forSale')}</option>
                  </select>
                  <select className={adminFieldClass}
                    value={propForm.occupancy_status}
                    onChange={(e) => setPropForm({ ...propForm, occupancy_status: e.target.value })}>
                    <option value="owner">{t('status.occOwner')}</option>
                    <option value="standby">{t('status.occStandby')}</option>
                    <option value="rented">{t('status.occRented')}</option>
                  </select>
                </div>
                <p className="text-xs font-medium text-muted">{t('admin.aptGroupOwner')}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input className={adminFieldClass}
                    placeholder={t('admin.phOwner')} value={propForm.owner_name}
                    onChange={(e) => setPropForm({ ...propForm, owner_name: e.target.value })}
                    readOnly={!canManageCriticalAccess}
                    required />
                  <input className={adminFieldClass}
                    placeholder="Email" type="email" value={propForm.owner_email}
                    onChange={(e) => setPropForm({ ...propForm, owner_email: e.target.value })}
                    readOnly={!canManageCriticalAccess}
                    required />
                  <input className={adminFieldClass}
                    placeholder={t('admin.phPhone')} value={propForm.owner_phone}
                    onChange={(e) => setPropForm({ ...propForm, owner_phone: e.target.value })}
                    readOnly={!canManageCriticalAccess} />
                </div>
                <p className="text-xs font-medium text-muted">{t('admin.aptGroupMore')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className={adminFieldClass}
                    value={propForm.owner_type}
                    onChange={(e) => setPropForm({ ...propForm, owner_type: e.target.value })}
                    disabled={!canManageCriticalAccess}>
                    <option value="физическое лицо">{t('ownerType.personShort')}</option>
                    <option value="юридическое лицо">{t('ownerType.companyShort')}</option>
                  </select>
                  <input className={adminFieldClass}
                    placeholder={t('admin.phCompany')} value={propForm.company_name}
                    onChange={(e) => setPropForm({ ...propForm, company_name: e.target.value })}
                    readOnly={!canManageCriticalAccess} />
                </div>
                {editingProp ? (
                  <p className="text-xs text-secondary">
                    {t('admin.debt')}: {money(editingProp.debt)} · {t('admin.overpay')}: {money(editingProp.overpayment)}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={adminBtnPrimaryClass}>{t('common.save')}</button>
                  <button type="button" onClick={() => setShowPropForm(false)} className={adminBtnSecondaryClass}>
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}

            {/* ПАНЕЛЬ ФИЛЬТРОВ */}
            <AdminFilterBar className={`mb-4 ${aptFiltersOpen ? 'block' : 'hidden'} md:block`}>
              <div className="hidden items-center gap-2 text-sm text-secondary md:flex">
                <span className="font-medium text-secondary">{t('common.filters')}</span>
                {aptActiveFiltersCount > 0 && (
                  <span className="text-xs bg-accent-bg text-accent rounded-full px-2 py-0.5">
                    {t('admin.activeN', { n: aptActiveFiltersCount })}
                  </span>
                )}
              </div>
              <input className={`hidden md:block ${adminFieldClass}`}
                placeholder={t('admin.searchApts')}
                value={aptSearch} onChange={(e) => setAptSearch(e.target.value)} />
              {aptActiveFiltersCount > 0 && (
                <button type="button" onClick={clearAptFilters}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-secondary md:hidden">
                  {t('admin.resetN', { n: aptActiveFiltersCount })}
                </button>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <select value={aptFloorFilter} onChange={(e) => setAptFloorFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.allFloors')}</option>
                  {uniqueFloors.map((f) => <option key={f} value={String(f)}>{t('form.floorN', { n: f })}</option>)}
                </select>

                <select value={aptStatusFilter} onChange={(e) => setAptStatusFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.anyStatus')}</option>
                  <option value="в собственности">{t('account.owned')}</option>
                  <option value="на продаже">{t('account.forSale')}</option>
                </select>

                <select value={aptOccupancyFilter} onChange={(e) => setAptOccupancyFilter(e.target.value)}
                  className={adminFieldClass}>
                  <option value="">{t('form.anyMode')}</option>
                  <option value="owner">{t('status.occOwner')}</option>
                  <option value="standby">{t('status.occStandby')}</option>
                  <option value="rented">{t('status.occRented')}</option>
                </select>

                <select value={aptOwnerTypeFilter} onChange={(e) => setAptOwnerTypeFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.anyOwnerType')}</option>
                  <option value="физическое лицо">{t('ownerType.personShort')}</option>
                  <option value="юридическое лицо">{t('ownerType.companyShort')}</option>
                </select>

                <select value={aptDebtFilter} onChange={(e) => setAptDebtFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.anyDebt')}</option>
                  <option value="has_debt">{t('form.hasDebt')}</option>
                  <option value="no_debt">{t('form.noDebt')}</option>
                  <option value="debt_50">{t('form.debt50')}</option>
                  <option value="debt_100">{t('form.debt100')}</option>
                </select>

                <select value={aptGuestsFilter} onChange={(e) => setAptGuestsFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.allGuests')}</option>
                  <option value="has_guests">{t('form.withGuests')}</option>
                  <option value="no_guests">{t('form.noGuests')}</option>
                </select>

                <select value={aptPetsFilter} onChange={(e) => setAptPetsFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="">{t('form.allPets')}</option>
                  <option value="has_pets">{t('form.withPets')}</option>
                  <option value="no_pets">{t('form.noPets')}</option>
                </select>

                <select value={aptSort} onChange={(e) => setAptSort(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                  <option value="apartment_number_asc">{t('form.sortAptAsc')}</option>
                  <option value="apartment_number_desc">{t('form.sortAptDesc')}</option>
                  <option value="debt_desc">{t('form.sortDebtDesc')}</option>
                  <option value="debt_asc">{t('form.sortDebtAsc')}</option>
                  <option value="area_desc">{t('form.sortAreaDesc')}</option>
                  <option value="area_asc">{t('form.sortAreaAsc')}</option>
                  <option value="owner_asc">{t('form.sortOwner')}</option>
                </select>
              </div>
            </AdminFilterBar>

            {/* СПИСОК КВАРТИР — МОБИЛЬНЫЕ КАРТОЧКИ */}
            <div className="space-y-2 md:hidden">
              {filteredProperties.map((p) => {
                const ownerPrimary = (p.owner_name ?? '').trim() || (p.owner_email ?? '').trim() || '—';
                const debtN = Number(p.debt ?? 0);
                const overN = Number(p.overpayment ?? 0);
                return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDetailProperty(p)}
                  className={`${adminCardClass} w-full p-3 text-left`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">№ {p.apartment_number}</div>
                      <div className="truncate text-sm text-secondary">{ownerPrimary}</div>
                    </div>
                    <StatusBadge label={occupancyLabel(p.occupancy_status)} tone={p.occupancy_status === 'standby' ? 'warning' : 'info'} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {p.area_sqm ?? '—'} {t('common.sqm')} · {p.floor ?? '—'} {t('common.floor')}
                  </div>
                  <div className={`mt-1 text-sm ${debtN > 0 ? 'font-medium text-danger' : 'text-secondary'}`}>
                    {debtN > 0 ? money(p.debt) : overN > 0 ? money(p.overpayment) : t('admin.aptNoDebt')}
                  </div>
                  <div className="mt-1 text-xs text-accent">{t('admin.aptDetails')} →</div>
                </button>
                );
              })}
            </div>

            {/* ТАБЛИЦА КВАРТИР */}
            <AdminTableShell className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('form.colApt')}</th>
                    <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                    <th className={adminTableCellClass}>{t('form.colArea')}</th>
                    <th className={adminTableCellClass}>{t('form.colFloor')}</th>
                    <th className={adminTableCellClass}>{t('form.colMode')}</th>
                    <th className={adminTableCellClass}>{t('account.debt')}</th>
                    <th className={adminTableCellClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.map((p) => {
                    const ownerName = (p.owner_name ?? '').trim();
                    const ownerMail = (p.owner_email ?? '').trim();
                    const debtN = Number(p.debt ?? 0);
                    const overN = Number(p.overpayment ?? 0);
                    return (
                      <tr
                        key={p.id}
                        className={`${adminTableRowClass} cursor-pointer`}
                        onClick={() => setDetailProperty(p)}
                      >
                        <td className={`${adminTableCellClass} font-semibold text-foreground`}>№ {p.apartment_number}</td>
                        <td className={adminTableCellClass}>
                          <div className="text-foreground">{ownerName || ownerMail || '—'}</div>
                          {ownerName && ownerMail ? <div className="text-xs text-muted">{ownerMail}</div> : null}
                        </td>
                        <td className={`${adminTableCellClass} text-secondary`}>{p.area_sqm ?? '—'} {t('common.sqm')}</td>
                        <td className={`${adminTableCellClass} text-secondary`}>{p.floor ?? '—'} {t('common.floor')}</td>
                        <td className={adminTableCellClass}>
                          <StatusBadge
                            label={occupancyLabel(p.occupancy_status)}
                            tone={p.occupancy_status === 'standby' ? 'warning' : 'info'}
                          />
                        </td>
                        <td className={`${adminTableCellClass} ${debtN > 0 ? 'font-medium text-danger' : 'text-secondary'}`}>
                          {debtN > 0 ? money(p.debt) : overN > 0 ? money(p.overpayment) : t('admin.aptNoDebt')}
                        </td>
                        <td className={adminTableCellClass}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailProperty(p); }}
                            className={adminBtnTertiaryClass}
                          >
                            {t('admin.aptDetails')} →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableShell>

            {properties.length === 0 ? (
              <AdminEmptyState
                title={t('admin.aptNone')}
                action={canManageCriticalAccess
                  ? <button type="button" onClick={startNewProp} className={adminBtnPrimaryClass}>{t('admin.addPlus')}</button>
                  : undefined}
              />
            ) : filteredProperties.length === 0 ? (
              <AdminEmptyState title={t('admin.noAptsFilter')} />
            ) : null}

            {/* МОДАЛЬНОЕ ОКНО — ДЕТАЛЬНЫЙ ПРОСМОТР КВАРТИРЫ */}
            {detailProperty && (
              <ApartmentDetailModal
                property={detailProperty}
                requests={requestsForProperty(detailProperty.id)}
                meterReadings={metersForProperty(detailProperty.id)}
                guests={guestsForProperty(detailProperty.id)}
                pets={petsForProperty(detailProperty.id)}
                chatMessages={chatForProperty(detailProperty.id)}
                chatSeenAt={ukChatSeen[String(detailProperty.id)]}
                supportRate={supportRate}
                onClose={() => setDetailProperty(null)}
                onEdit={() => { startEditProp(detailProperty); setDetailProperty(null); }}
                onOpenChat={() => { setSelectedChatProperty(detailProperty); setDetailProperty(null); navigateAdminSection('чат'); }}
                onChanged={loadAll}
                onDelete={canManageCriticalAccess ? () => { void handleDeleteProp(detailProperty.id); } : undefined}
                onOpenTransfer={() => { setDetailProperty(null); navigateAdminSection('смены'); }}
                onTakePayment={() => {
                  setPayPropertyId(detailProperty.id);
                  const debt = Number(detailProperty.debt ?? 0);
                  setPayAmount(
                    debt > 0
                      ? debt.toFixed(2)
                      : String(monthlySupportFee(detailProperty.area_sqm, supportRate)),
                  );
                  setDetailProperty(null);
                  navigateAdminSection('такса');
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
          <div className="space-y-4">
            <AdminPageHeader title={t('admin.transfers')} secondary={t('admin.transferLead')} />
            <AdminCard>
            {ownerTransfers.length === 0 ? (
              <AdminEmptyState title={t('admin.noTransfers')} />
            ) : (
              <div className="space-y-3">
                {ownerTransfers.map((tr) => (
                  <div key={tr.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-secondary">{propertyFullById(tr.property_id)}</div>
                        <div className="mt-1 text-sm text-secondary">
                          {tr.from_owner_name} ({tr.from_owner_email}) → {tr.to_owner_name} ({tr.to_owner_email})
                        </div>
                        {tr.to_owner_phone && (
                          <div className="text-xs text-muted">{t('form.tel', { n: tr.to_owner_phone })}</div>
                        )}
                        {tr.note && <div className="mt-2 text-sm text-secondary">{tr.note}</div>}
                        {tr.reject_reason && (
                          <div className="mt-1 text-xs text-danger">{t('form.reason', { n: tr.reject_reason })}</div>
                        )}
                        <div className="mt-2 text-xs text-muted">
                          {formatOwnerDateTime(tr.created_at, locale)}
                          {tr.decided_by ? ` · ${tr.decided_by}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${transferStatusClass(tr.status)}`}>{labelTransfer(tr.status, t)}</div>
                        {tr.status === 'ожидает' && canManageCriticalAccess && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleApproveTransfer(tr)}
                              className="rounded-lg bg-accent-bg border border-accent/25 px-3 py-1.5 text-xs text-accent"
                            >
                              {t('admin.approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectTransfer(tr)}
                              className="rounded-lg bg-danger-bg border border-danger/25 px-3 py-1.5 text-xs text-danger"
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
            </AdminCard>
          </div>
        );

      case 'заявки': {
        const requestDetail = requests.find((r) => r.id === requestDetailId) ?? null;
        const requestStatusTone = (status: string | null): 'warning' | 'info' | 'success' | 'danger' => {
          if (status === 'в работе') return 'info';
          if (status === 'выполнена') return 'success';
          if (status === 'отклонена') return 'danger';
          return 'warning';
        };
        return (
          <div className="space-y-4 md:rounded-2xl md:border md:border-border md:bg-surface md:p-6">
            <AdminPageHeader
              title={t('admin.requests')}
              secondary={`${t('admin.requestsLead')} ${t('admin.shownOf', { n: filteredRequests.length, total: requests.length })}`}
              action={
                reqActiveFiltersCount > 0 ? (
                  <AdminSecondaryButton type="button" onClick={clearReqFilters}>
                    {t('admin.resetN', { n: reqActiveFiltersCount })}
                  </AdminSecondaryButton>
                ) : undefined
              }
            />

            <div className="mb-3 flex gap-2 md:hidden">
              <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-placeholder"
                placeholder={t('common.search')}
                value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} />
              <button
                type="button"
                onClick={() => setReqFiltersOpen((v) => !v)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${
                  reqFiltersOpen || reqActiveFiltersCount > 0
                    ? 'border-accent/30 bg-accent-bg text-accent'
                    : 'border-border bg-surface text-secondary'
                }`}
              >
                {t('common.filters')}
                {reqActiveFiltersCount > 0 ? ` ${reqActiveFiltersCount}` : ''}
              </button>
            </div>

            {/* ПАНЕЛЬ ФИЛЬТРОВ ЗАЯВОК */}
            <AdminFilterBar className={`mb-4 ${reqFiltersOpen ? 'block' : 'hidden'} md:block`}>
              <input className={`${adminFieldClass} hidden md:block`}
                placeholder={t('common.search')}
                value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select value={reqStatusFilter} onChange={(e) => setReqStatusFilter(e.target.value)}
                  className={adminFieldClass}>
                  <option value="">{t('form.allStatuses')}</option>
                  <option value="новая">{t('status.reqNew')}</option>
                  <option value="в работе">{t('status.reqWork')}</option>
                  <option value="выполнена">{t('status.reqDone')}</option>
                  <option value="отклонена">{t('status.reqReject')}</option>
                </select>
                <select value={reqCategoryFilter} onChange={(e) => setReqCategoryFilter(e.target.value)}
                  className={adminFieldClass}>
                  <option value="">{t('form.allCategories')}</option>
                  <option value="сантехника">{t('cat.plumbing')}</option>
                  <option value="электрика">{t('cat.electric')}</option>
                  <option value="уборка">{t('cat.cleaning')}</option>
                  <option value="отопление">{t('cat.heating')}</option>
                  <option value="другое">{t('cat.other')}</option>
                </select>
                <select value={reqPriorityFilter} onChange={(e) => setReqPriorityFilter(e.target.value)}
                  className={adminFieldClass}>
                  <option value="">{t('form.anyPriority')}</option>
                  <option value="низкий">{t('status.prioLow')}</option>
                  <option value="средний">{t('status.prioMid')}</option>
                  <option value="высокий">{t('status.prioHigh')}</option>
                </select>
                <ApartmentCombobox
                  properties={properties}
                  value={reqAptFilter ? Number(reqAptFilter) : ''}
                  onChange={(id) => setReqAptFilter(id === '' ? '' : String(id))}
                />
              </div>
            </AdminFilterBar>

            {requests.length === 0 ? (
              <AdminEmptyState title={t('account.noRequestsYet')} />
            ) : filteredRequests.length === 0 ? (
              <AdminEmptyState title={t('admin.noAptsFilter')} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {filteredRequests.map((r) => {
                    const preview = String(r.description ?? '').replace(/\s+/g, ' ').trim();
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRequestDetailId(r.id)}
                        className="w-full rounded-[14px] border border-border bg-surface p-3 text-left shadow-card"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-muted">{formatOwnerDateTime(r.created_at, locale)}</span>
                          <StatusBadge label={labelRequestStatus(r.status, t)} tone={requestStatusTone(r.status)} />
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-foreground">{r.subject || '—'}</div>
                        {preview ? <div className="truncate text-xs text-secondary">{preview}</div> : null}
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                          <span className="truncate">{propertyFullById(r.property_id ?? 0)}</span>
                          {r.photo_url ? <span className="shrink-0">{t('admin.reqPhoto')}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <AdminTableShell className="hidden md:block">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.date')}</th>
                        <th className={adminTableCellClass}>{t('admin.aptLabel')}</th>
                        <th className={adminTableCellClass}>{t('account.subject')}</th>
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                        <th className={adminTableCellClass}>{t('admin.reqPhoto')}</th>
                        <th className={adminTableCellClass}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((r) => {
                        const preview = String(r.description ?? '').replace(/\s+/g, ' ').trim();
                        return (
                          <tr key={r.id} className={adminTableRowClass}>
                            <td className={`${adminTableCellClass} whitespace-nowrap text-xs text-muted`}>
                              {formatOwnerDateTime(r.created_at, locale)}
                            </td>
                            <td className={adminTableCellClass}>{propertyFullById(r.property_id ?? 0)}</td>
                            <td className={adminTableCellClass}>
                              <div className="max-w-md truncate font-medium text-foreground">{r.subject || '—'}</div>
                              {preview ? <div className="max-w-md truncate text-xs text-secondary">{preview}</div> : null}
                            </td>
                            <td className={adminTableCellClass}>
                              <StatusBadge label={labelRequestStatus(r.status, t)} tone={requestStatusTone(r.status)} />
                            </td>
                            <td className={`${adminTableCellClass} text-xs text-muted`}>{r.photo_url ? t('admin.reqPhoto') : '—'}</td>
                            <td className={adminTableCellClass}>
                              <button type="button" onClick={() => setRequestDetailId(r.id)} className={adminBtnTertiaryClass}>
                                {t('admin.reqDetails')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </AdminTableShell>
              </>
            )}
            {requestDetail ? (
              <div className={adminModalOverlayClass} onClick={() => setRequestDetailId(null)}>
                <div className={`${adminModalPanelClass} max-w-lg`} onClick={(e) => e.stopPropagation()}>
                  <div className={adminModalHeaderClass}>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold text-foreground">{requestDetail.subject || '—'}</h3>
                      <p className="mt-0.5 text-sm text-secondary">{propertyFullById(requestDetail.property_id ?? 0)}</p>
                    </div>
                    <button type="button" onClick={() => setRequestDetailId(null)} className={adminBtnSecondaryClass}>
                      {t('common.close')}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={labelRequestStatus(requestDetail.status, t)} tone={requestStatusTone(requestDetail.status)} />
                      <span className="text-xs text-muted">{labelCategory(requestDetail.category, t)}</span>
                      <span className={`text-xs rounded-full border px-2 py-0.5 ${priorityClass(requestDetail.priority)}`}>
                        {labelPriority(requestDetail.priority, t)}
                      </span>
                    </div>
                    <div className="text-sm text-foreground">
                      <div>{requestDetail.owner_name || '—'}</div>
                      {requestDetail.owner_phone ? (
                        <div className="text-secondary">{t('form.tel', { n: requestDetail.owner_phone })}</div>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-secondary">{requestDetail.description || '—'}</p>
                    {requestDetail.photo_url ? (
                      <SignedStorageLink stored={requestDetail.photo_url} className="text-sm text-accent hover:underline">
                        {t('form.photo')}
                      </SignedStorageLink>
                    ) : null}
                    <div className="text-xs text-muted">{formatOwnerDateTime(requestDetail.created_at, locale)}</div>
                    <div>
                      <label className="mb-1 block text-xs text-secondary">{t('admin.status')}</label>
                      <select
                        value={requestDetail.status ?? 'новая'}
                        onChange={(e) => handleUpdateRequestStatus(requestDetail.id, e.target.value)}
                        className={adminFieldClass}
                      >
                        <option value="новая">{t('status.reqNew')}</option>
                        <option value="в работе">{t('status.reqWork')}</option>
                        <option value="выполнена">{t('status.reqDone')}</option>
                        <option value="отклонена">{t('status.reqReject')}</option>
                      </select>
                    </div>
                    <div className="border-t border-border pt-4">
                      <button type="button" onClick={() => handleDeleteRequest(requestDetail.id)} className="text-sm text-danger hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      }

      // =============================================================
      // СЧЁТЧИКИ
      // =============================================================
      case 'вода':
        return (
          <AdminWater
            supabase={supabase}
            properties={properties}
            staffRole={staffRole}
            staffActive={staffActive}
            waterMode={waterMode}
            canChangeWaterMode={staffRole.trim().toLowerCase() === 'администрация'}
            onSaveWaterMode={handleSaveWaterMode}
            tab={searchParams.get('tab')}
            onTabChange={(next) => openUtilityTab('вода', next)}
          />
        );

      case 'капремонт':
        return (
          <AdminCapital
            supabase={supabase}
            properties={properties}
            staffRole={staffRole}
            tab={searchParams.get('tab')}
            onTabChange={(next) => openSectionTab('капремонт', next)}
          />
        );

      case 'документы':
        return (
          <AdminDocumentsDecisions
            supabase={supabase}
            properties={properties}
            staffRole={staffRole}
            staffActive={staffActive}
          />
        );

      case 'счётчики':
      case 'электроэнергия': {
        const canElSubmit =
          electricityMode !== 'disabled' && canSubmitElectricityStaff(staffRole, staffActive);
        const canChangeElMode = staffRole.trim().toLowerCase() === 'администрация';
        const elModeLabel =
          electricityMode === 'staff_only'
            ? t('admin.elModeStaffOnly')
            : electricityMode === 'disabled'
              ? t('admin.elModeDisabled')
              : t('admin.elModeOwnerAndStaff');
        const elTabItems: { id: AdminUtilityTab; label: string }[] = [
          { id: 'overview', label: t('admin.utilTabOverview') },
          { id: 'meter', label: t('admin.utilTabMeter') },
          { id: 'readings', label: t('admin.utilTabReadings') },
        ];
        if (showElectricityFinance) {
          elTabItems.push(
            { id: 'tariff', label: t('admin.utilTabTariff') },
            { id: 'finance', label: t('admin.utilTabFinance') },
          );
        }
        const elTab = parseAdminUtilityTab(
          sectionQuery === 'счётчики' ? 'meter' : searchParams.get('tab'),
          elTabItems.map((item) => item.id),
        );
        const selectedElId = elMeterPropertyId || (properties[0] ? String(properties[0].id) : '');
        const selectedElMeters = electricityMeters.filter((m) => String(m.property_id) === selectedElId);
        const activeEl = activeElectricityMeter(selectedElMeters);
        const elPairs = pairElectricityReadings(
          meterReadings.filter((m) => String(m.property_id) === selectedElId),
          electricityMeters,
        );
        const elSnapshot = electricityActiveMeterReadings(elPairs, activeEl);
        const retiredEl = selectedElMeters.filter((m) => m.retired_at);
        return (
          <div className="space-y-4">
            <AdminPageHeader
              title={t('admin.electricityFinance')}
              secondary={t('admin.electricityLead')}
              action={
                elTab === 'readings' && canElSubmit ? (
                  <AdminPrimaryButton type="button" onClick={() => setShowMeterForm(true)}>
                    + {t('account.elSubmit')}
                  </AdminPrimaryButton>
                ) : undefined
              }
            />
            <AdminCard>
              <p className="text-[11px] uppercase tracking-wider text-muted">{t('admin.electricityMode')}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{elModeLabel}</p>
              {canChangeElMode && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {([
                    ['owner_and_staff', t('admin.elModeOwnerAndStaff')],
                    ['staff_only', t('admin.elModeStaffOnly')],
                    ['disabled', t('admin.elModeDisabled')],
                  ] as const).map(([id, label]) => (
                    <button
                      key={`el-${id}`}
                      type="button"
                      onClick={() => void handleSaveElectricityMode(id)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        electricityMode === id
                          ? 'border-accent/25 bg-accent-bg text-accent'
                          : 'border-border text-secondary hover:bg-hover'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {electricityMode === 'disabled' && (
                <p className="mt-3 text-sm text-secondary">{t('account.elErrDisabled')}</p>
              )}
              <label className="mt-4 block text-xs text-muted">{t('admin.pickProperty')}</label>
              <ApartmentCombobox
                className="mt-1 max-w-xl"
                properties={properties}
                value={selectedElId ? Number(selectedElId) : ''}
                onChange={(id) => {
                  setElMeterPropertyId(id === '' ? '' : String(id));
                  setShowElAssign(false);
                  setShowElReplace(false);
                }}
              />
            </AdminCard>

            <AdminTabBar
              tabs={elTabItems}
              active={elTab}
              onChange={(id) => openUtilityTab('электроэнергия', id as AdminUtilityTab)}
            />

            {elTab === 'overview' && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <AdminMetricCard label={t('admin.electricityMode')} value={elModeLabel} />
                <AdminMetricCard
                  label={t('admin.utilTabMeter')}
                  value={activeEl ? displayElectricityMeterNumber(activeEl.meter_number) : '—'}
                  secondary={activeEl ? undefined : t('admin.noElectricityMeter')}
                  onClick={() => openUtilityTab('электроэнергия', 'meter')}
                />
                <AdminMetricCard
                  label={t('admin.elLastDay')}
                  value={elSnapshot.currentDay != null ? formatKwh(elSnapshot.currentDay, locale) : '—'}
                  secondary={elSnapshot.readingDate ? formatOwnerDate(elSnapshot.readingDate) : t('admin.noReadings')}
                  onClick={() => openUtilityTab('электроэнергия', 'readings')}
                />
                <AdminMetricCard
                  label={t('admin.elLastNight')}
                  value={elSnapshot.currentNight != null ? formatKwh(elSnapshot.currentNight, locale) : '—'}
                  onClick={() => openUtilityTab('электроэнергия', 'readings')}
                />
              </div>
            )}

            {elTab === 'meter' && (() => {
              const canElMeter = canManageElectricityMeter(staffRole, staffActive);
              const fieldClass = adminFieldClass;
              return (
                <div className="rounded-[14px] border border-border bg-background px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted">{t('account.elMeter')}</p>
                  {!activeEl ? (
                    <div className="mt-3">
                      <AdminEmptyState title={t('admin.noElectricityMeter')} />
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                      <div>
                        <div className="text-[11px] text-muted">{t('account.elMeterNumber')}</div>
                        <div className="mt-0.5 font-semibold tabular-nums">{displayElectricityMeterNumber(activeEl.meter_number)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">{t('account.elInstalledAt')}</div>
                        <div className="mt-0.5 tabular-nums">{formatOwnerDate(activeEl.installed_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">{t('account.elInitialDay')}</div>
                        <div className="mt-0.5 tabular-nums">{formatKwh(Number(activeEl.initial_day_reading), locale)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">{t('account.elInitialNight')}</div>
                        <div className="mt-0.5 tabular-nums">{formatKwh(Number(activeEl.initial_night_reading), locale)}</div>
                      </div>
                    </div>
                  )}
                  {canElMeter && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!activeEl && (
                        <button
                          type="button"
                          onClick={() => { setShowElAssign((v) => !v); setShowElReplace(false); if (!elMeterPropertyId) setElMeterPropertyId(selectedElId); }}
                          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                        >
                          {t('account.elAssignMeter')}
                        </button>
                      )}
                      {activeEl && (
                        <button
                          type="button"
                          onClick={() => { setShowElReplace((v) => !v); setShowElAssign(false); if (!elMeterPropertyId) setElMeterPropertyId(selectedElId); }}
                          className="rounded-xl border border-border px-4 py-2 text-sm text-secondary hover:bg-hover"
                        >
                          {t('account.elReplaceMeter')}
                        </button>
                      )}
                    </div>
                  )}
                  {canElMeter && showElAssign && (
                    <form onSubmit={handleAssignElectricityMeter} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <input className={fieldClass} placeholder={t('account.elMeterNumber')} value={elMeterNumber} onChange={(e) => setElMeterNumber(e.target.value)} required />
                      <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('account.elInitialDay')} value={elInitialDay} onChange={(e) => setElInitialDay(e.target.value)} required />
                      <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('account.elInitialNight')} value={elInitialNight} onChange={(e) => setElInitialNight(e.target.value)} required />
                      <input className={fieldClass} type="date" max={todayIsoDate()} value={elInstalledAt} onChange={(e) => setElInstalledAt(e.target.value)} required />
                      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                        <button type="submit" disabled={elMeterBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                          {elMeterBusy ? t('common.saving') : t('common.save')}
                        </button>
                        <button type="button" onClick={() => setShowElAssign(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover">
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                  {canElMeter && showElReplace && activeEl && (
                    <form onSubmit={handleReplaceElectricityMeter} className="mt-4 grid gap-3 sm:grid-cols-2">
                      <input className={fieldClass} placeholder={t('admin.newMeterNumber')} value={elReplaceNumber} onChange={(e) => setElReplaceNumber(e.target.value)} required />
                      <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('account.elInitialDay')} value={elReplaceDay} onChange={(e) => setElReplaceDay(e.target.value)} required />
                      <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('account.elInitialNight')} value={elReplaceNight} onChange={(e) => setElReplaceNight(e.target.value)} required />
                      <input className={fieldClass} type="date" max={todayIsoDate()} value={elReplaceDate} onChange={(e) => setElReplaceDate(e.target.value)} required />
                      <input className={fieldClass} placeholder={t('account.elReplaceReason')} value={elReplaceReason} onChange={(e) => setElReplaceReason(e.target.value)} required />
                      <div className="flex gap-2 sm:col-span-2">
                        <button type="submit" disabled={elMeterBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                          {elMeterBusy ? t('common.saving') : t('common.save')}
                        </button>
                        <button type="button" onClick={() => setShowElReplace(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover">
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                  <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.utilMeterHistory')}</p>
                  {retiredEl.length === 0 ? (
                    <div className="mt-3">
                      <AdminEmptyState title={t('admin.utilNoMeterHistory')} />
                    </div>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[28rem] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted">
                            <th className="py-2 pr-3">{t('account.elMeterNumber')}</th>
                            <th className="py-2 pr-3">{t('account.elInstalledAt')}</th>
                            <th className="py-2 pr-3">{t('account.elInitialDay')}</th>
                            <th className="py-2 pr-3">{t('account.elInitialNight')}</th>
                            <th className="py-2 pr-3">{t('admin.date')}</th>
                            <th className="py-2 pr-3">{t('admin.note')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {retiredEl.map((row) => (
                            <tr key={row.id} className="border-t border-border">
                              <td className="py-2 pr-3 tabular-nums">{displayElectricityMeterNumber(row.meter_number)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.installed_at)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatKwh(Number(row.initial_day_reading), locale)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatKwh(Number(row.initial_night_reading), locale)}</td>
                              <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.retired_at)}</td>
                              <td className="py-2 pr-3 text-secondary">{row.replacement_reason ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {elTab === 'readings' && showMeterForm && canElSubmit && (
              <form onSubmit={handleSaveMeter}
                className="mb-6 rounded-[14px] border border-accent/20 bg-surface shadow-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-accent">{t('account.meterTabElectricity')}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ApartmentCombobox
                    required
                    properties={properties}
                    value={meterForm.property_id ? Number(meterForm.property_id) : ''}
                    onChange={(id) => {
                      meterIdempotencyRef.current = null;
                      setMeterForm({ ...meterForm, property_id: id === '' ? '' : String(id) });
                    }}
                  />
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('admin.elDayReading')} type="number" step="0.001" value={meterForm.day}
                    onChange={(e) => {
                      meterIdempotencyRef.current = null;
                      setMeterForm({ ...meterForm, day: e.target.value });
                    }} required />
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('admin.elNightReading')} type="number" step="0.001" value={meterForm.night}
                    onChange={(e) => {
                      meterIdempotencyRef.current = null;
                      setMeterForm({ ...meterForm, night: e.target.value });
                    }} required />
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    type="date" value={meterForm.reading_date}
                    onChange={(e) => {
                      meterIdempotencyRef.current = null;
                      setMeterForm({ ...meterForm, reading_date: e.target.value });
                    }} required />
                </div>
                <div className="flex gap-2">
                  <button type="submit"
                    className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    {t('account.elSubmit')}
                  </button>
                  <button type="button" onClick={() => setShowMeterForm(false)}
                    className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-hover">
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}

            {elTab === 'readings' && (
              elPairs.length === 0 ? (
                <AdminEmptyState title={t('admin.noReadings')} />
              ) : (
                <AdminTableShell>
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.date')}</th>
                        <th className={adminTableCellClass}>{t('account.elMeter')}</th>
                        <th className={adminTableCellClass}>{t('account.elDay')}</th>
                        <th className={adminTableCellClass}>{t('account.elNight')}</th>
                        <th className={adminTableCellClass}>{t('account.elConsDay')}</th>
                        <th className={adminTableCellClass}>{t('account.elConsNight')}</th>
                        <th className={adminTableCellClass}>{t('account.elSubmittedBy')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elPairs.slice(0, 100).map((row) => (
                        <tr key={row.key} className={adminTableRowClass}>
                          <td className={adminTableCellClass}>{formatOwnerDate(row.reading_date)}</td>
                          <td className={adminTableCellClass}>{displayElectricityMeterNumber(row.meter_number) || '—'}</td>
                          <td className={adminTableCellClass}>{row.day != null ? `${formatKwh(row.day, locale)} ${t('account.kwh')}` : '—'}</td>
                          <td className={adminTableCellClass}>{row.night != null ? `${formatKwh(row.night, locale)} ${t('account.kwh')}` : '—'}</td>
                          <td className={adminTableCellClass}>{row.consumptionDay != null ? `${formatKwh(row.consumptionDay, locale)} ${t('account.kwh')}` : '—'}</td>
                          <td className={adminTableCellClass}>{row.consumptionNight != null ? `${formatKwh(row.consumptionNight, locale)} ${t('account.kwh')}` : '—'}</td>
                          <td className={adminTableCellClass}>
                            {row.source === 'owner'
                              ? t('account.elByOwner')
                              : row.source === 'staff'
                                ? t('account.elByStaff')
                                : (row.submitted_by ?? '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              )
            )}

            {showElectricityFinance && (
              <div className={elTab === 'overview' || elTab === 'tariff' || elTab === 'finance' ? undefined : 'hidden'}>
                <AdminElectricityFinance
                  supabase={supabase}
                  properties={properties}
                  staffRole={staffRole}
                  embedded
                  panel={elTab === 'tariff' ? 'tariff' : elTab === 'finance' ? 'finance' : 'overview'}
                  focusPropertyId={selectedElId ? Number(selectedElId) : ''}
                  onPropertyChange={(id) => {
                    if (id !== '') setElMeterPropertyId(String(id));
                  }}
                  onOpenTab={(next) => openUtilityTab('электроэнергия', next)}
                />
              </div>
            )}
          </div>
        );
      }

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
          <div className="space-y-4">
            <AdminPageHeader
              title={t('admin.expenses')}
              secondary={`${t('admin.expenseHint')} · ${t('admin.expensePublished')} ${expenseYearFilter === 'all' ? t('admin.expenseAllYears') : expenseYearFilter}: ${money(visibleTotal)}${
                pendingUkExpenses.length > 0
                  ? ` · ${t('admin.expensePending')} ${pendingUkExpenses.length}`
                  : ''
              }`}
              action={
                <AdminPrimaryButton type="button" onClick={startNewExpense}>
                  + {t('admin.addPlus')}
                </AdminPrimaryButton>
              }
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AdminMetricCard label={t('admin.expensePublished')} value={money(visibleTotal)} />
              <AdminMetricCard
                label={t('admin.expensePending')}
                value={String(pendingUkExpenses.length)}
                alert={pendingUkExpenses.length > 0}
              />
            </div>
            <AdminFilterBar>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <label className="text-sm text-secondary">
                  {t('admin.reportsYear')}
                  <select
                    className={`${adminFieldClass} mt-1`}
                    value={expenseYearFilter === 'all' ? 'all' : String(expenseYearFilter)}
                    onChange={(e) => setExpenseYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  >
                    <option value="all">{t('admin.expenseAllYears')}</option>
                    {expenseYears.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-secondary">
                  {t('admin.status')}
                  <select
                    className={`${adminFieldClass} mt-1`}
                    value={expenseStatusFilter}
                    onChange={(e) => setExpenseStatusFilter(e.target.value as 'all' | 'pending' | 'published')}
                  >
                    <option value="all">{t('admin.expAllStatuses')}</option>
                    <option value="pending">{t('status.expPending')}</option>
                    <option value="published">{t('status.expPublished')}</option>
                  </select>
                </label>
              </div>
            </AdminFilterBar>
            {showExpenseForm && (
              <form onSubmit={handleSaveExpense}
                className="mb-6 rounded-[14px] border border-accent/20 bg-surface shadow-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-accent">
                  {editingExpense ? t('admin.expEdit') : t('admin.expNew')}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="date" required
                    className={adminFieldClass}
                    value={expenseForm.expense_date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} />
                  <input type="number" step="0.01" min="0.01" required
                    className={adminFieldClass}
                    placeholder={t('admin.expAmountPh')} value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                  <input
                    className={`${adminFieldClass} sm:col-span-2`}
                    placeholder={t('admin.expTitlePh')}
                    value={expenseForm.title}
                    onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs text-secondary">
                    {t('admin.expPhotos', { n: MAX_EXPENSE_PHOTOS })}
                  </p>
                  {(expenseExistingUrls.length > 0 || expensePhotoFiles.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {expenseExistingUrls.map((url) => (
                        <div key={url} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
                          <button
                            type="button"
                            onClick={() => setExpenseExistingUrls((prev) => prev.filter((u) => u !== url))}
                            className="absolute -right-1 -top-1 rounded-full bg-black/70 px-1.5 text-xs text-foreground"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {expensePhotoFiles.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={URL.createObjectURL(file)} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
                          <button
                            type="button"
                            onClick={() => setExpensePhotoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute -right-1 -top-1 rounded-full bg-black/70 px-1.5 text-xs text-foreground"
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
                      className="w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-hover file:px-4 file:py-2 file:text-sm file:text-secondary"
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
                    className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white hover:opacity-95">
                    {editingExpense && isExpensePublished(editingExpense) && canApproveUkExpenses(staffRole)
                      ? t('admin.expSavePublished')
                      : t('admin.expSubmitReview')}
                  </button>
                  <button type="button" onClick={() => { setShowExpenseForm(false); setEditingExpense(null); setExpensePhotoFiles([]); }}
                    className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-hover">
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
            {ukExpenses.length === 0 && !showExpenseForm ? (
              <AdminEmptyState title={t('admin.expNone')} />
            ) : (
              <div className="space-y-6">
                {yearsToShow.map((year) => {
                  const group = expensesByYear.get(year);
                  const items = (group?.items ?? []).filter((exp) => {
                    if (expenseStatusFilter === 'all') return true;
                    const published = isExpensePublished(exp);
                    return expenseStatusFilter === 'published' ? published : !published;
                  });
                  return (
                    <div key={year}>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-accent">{year}</h3>
                        <span className="text-sm text-secondary">
                          {t('admin.expensePublished')} {money(group?.total ?? 0)}
                          {(group?.pendingTotal ?? 0) > 0 && (
                            <span className="ml-2 text-warning">{t('admin.expensePending')} {money(group?.pendingTotal ?? 0)}</span>
                          )}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <AdminEmptyState title={t('admin.expNoneYear', { year })} />
                      ) : (
                        <>
                          <div className="hidden md:block">
                            <AdminTableShell>
                              <table className="w-full min-w-[40rem] text-sm">
                                <thead>
                                  <tr className={adminTableHeadRowClass}>
                                    <th className={adminTableCellClass}>{t('admin.date')}</th>
                                    <th className={adminTableCellClass}>{t('admin.pdfTitle')}</th>
                                    <th className={adminTableCellClass}>{t('admin.amount')}</th>
                                    <th className={adminTableCellClass}>{t('admin.status')}</th>
                                    <th className={adminTableCellClass} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((exp) => {
                                    const published = isExpensePublished(exp);
                                    const photos = expensePhotoUrls(exp);
                                    const open = expenseDetailId === exp.id;
                                    return (
                                      <tr key={exp.id} className={adminTableRowClass}>
                                        <td className={adminTableCellClass}>{formatUkDate(exp.expense_date)}</td>
                                        <td className={adminTableCellClass}>
                                          <div>{exp.title?.trim() || t('admin.expUntitled')}</div>
                                          {open && (
                                            <div className="mt-2 space-y-2">
                                              <div className="text-xs text-muted">
                                                {exp.created_by || t('common.uk')}
                                                {exp.approved_by ? ` · ${t('admin.expApprovedBy', { name: exp.approved_by })}` : ''}
                                              </div>
                                              {photos.length > 0 && <ExpensePhotoStrip urls={photos} size="sm" />}
                                            </div>
                                          )}
                                        </td>
                                        <td className={`${adminTableCellClass} tabular-nums`}>{money(exp.amount)}</td>
                                        <td className={adminTableCellClass}>
                                          <StatusBadge label={labelExpenseStatus(published, t)} tone={published ? 'info' : 'warning'} />
                                        </td>
                                        <td className={adminTableCellClass}>
                                          <div className="flex flex-wrap justify-end gap-1">
                                            <button type="button" onClick={() => setExpenseDetailId(open ? null : exp.id)} className="rounded px-2 py-1 text-xs text-accent hover:bg-hover">
                                              {t('admin.expDetails')}
                                            </button>
                                            {!published && canApproveUkExpenses(staffRole) && (
                                              <button type="button" onClick={() => handleApproveExpense(exp)} className="rounded-full bg-accent-bg px-3 py-1 text-xs text-accent">
                                                {t('admin.expPublish')}
                                              </button>
                                            )}
                                            {(!published || canApproveUkExpenses(staffRole)) && (
                                              <button type="button" onClick={() => startEditExpense(exp)} className="rounded px-2 py-1 text-xs bg-hover text-secondary">✎</button>
                                            )}
                                            {canManageCriticalAccess ? (
                                              <button type="button" onClick={() => handleDeleteExpense(exp.id)} className="rounded px-2 py-1 text-xs bg-danger-bg text-danger">✕</button>
                                            ) : null}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </AdminTableShell>
                          </div>
                          <div className="space-y-2 md:hidden">
                            {items.map((exp) => {
                              const published = isExpensePublished(exp);
                              const photos = expensePhotoUrls(exp);
                              const open = expenseDetailId === exp.id;
                              return (
                                <div key={exp.id} className="rounded-xl border border-border bg-surface p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="text-sm font-medium">{exp.title?.trim() || t('admin.expUntitled')}</div>
                                      <div className="mt-1 text-xs text-muted">{formatUkDate(exp.expense_date)}</div>
                                    </div>
                                    <div className="text-sm font-semibold tabular-nums">{money(exp.amount)}</div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <StatusBadge label={labelExpenseStatus(published, t)} tone={published ? 'info' : 'warning'} />
                                    <button type="button" onClick={() => setExpenseDetailId(open ? null : exp.id)} className="text-xs text-accent">
                                      {t('admin.expDetails')}
                                    </button>
                                    {!published && canApproveUkExpenses(staffRole) && (
                                      <button type="button" onClick={() => handleApproveExpense(exp)} className="text-xs text-accent">
                                        {t('admin.expPublish')}
                                      </button>
                                    )}
                                    {(!published || canApproveUkExpenses(staffRole)) && (
                                      <button type="button" onClick={() => startEditExpense(exp)} className="text-xs text-secondary">✎</button>
                                    )}
                                    {canManageCriticalAccess ? (
                                      <button type="button" onClick={() => handleDeleteExpense(exp.id)} className="text-xs text-danger">✕</button>
                                    ) : null}
                                  </div>
                                  {open && photos.length > 0 && (
                                    <div className="mt-2">
                                      <ExpensePhotoStrip urls={photos} size="sm" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
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
          <div className="min-w-0 space-y-4">
            <AdminPageHeader
              title={t('admin.staff')}
              secondary={t('admin.staffLead')}
              action={canEditStaff ? (
                <AdminPrimaryButton type="button" onClick={startNewStaff}>
                  + {t('admin.addPlus')}
                </AdminPrimaryButton>
              ) : undefined}
            />
            {canEditStaff && showStaffForm && (
              <form onSubmit={handleSaveStaff} className={adminFormPanelClass}>
                <h3 className="text-sm font-semibold text-foreground">
                  {editingStaff ? t('admin.staffEdit') : t('admin.staffNew')}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input className={adminFieldClass}
                    placeholder={t('admin.staffNamePh')} value={staffForm.name}
                    onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} required />
                  <select className={adminFieldClass}
                    value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} required>
                    <option value="" disabled>{t('admin.staffRolePh')}</option>
                    {STAFF_ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>{labelStaffRole(role.value, t)}</option>
                    ))}
                  </select>
                  <input className={adminFieldClass}
                    placeholder={t('admin.staffEmailPh')} type="email" value={staffForm.email}
                    onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} />
                  <input className={adminFieldClass}
                    placeholder={t('admin.staffPhonePh')} value={staffForm.phone}
                    onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
                  {showStaffSalary ? (
                    <input className={adminFieldClass}
                      placeholder={t('admin.staffSalaryPh')} type="number" value={staffForm.salary_eur}
                      onChange={(e) => setStaffForm({ ...staffForm, salary_eur: e.target.value })} />
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input type="checkbox" checked={staffForm.active}
                      onChange={(e) => setStaffForm({ ...staffForm, active: e.target.checked })} />
                    {t('admin.staffActive')}
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AdminPrimaryButton type="submit">{t('common.save')}</AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setShowStaffForm(false)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            )}
            {staff.length === 0 ? (
              <AdminEmptyState title={t('admin.staffEmpty')} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {staff.map((s) => (
                    <div key={s.id} className="rounded-[14px] border border-border bg-surface p-3 shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                          <div className="text-xs text-secondary">{labelStaffRole(s.role, t)}</div>
                        </div>
                        <StatusBadge label={s.active ? t('admin.staffActive') : t('admin.staffInactive')} tone={s.active ? 'success' : 'neutral'} />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {[s.phone, s.email].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {showStaffSalary ? (
                        <div className="mt-1 text-sm text-foreground">{s.salary_eur ? money(s.salary_eur) : '—'}</div>
                      ) : null}
                      {canEditStaff ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => startEditStaff(s)} className={adminBtnTertiaryClass}>{t('admin.staffEdit')}</button>
                          <button type="button" onClick={() => handleDeleteStaff(s.id)} className="text-sm text-danger hover:underline">{t('common.delete')}</button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <AdminTableShell className="hidden md:block">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.staffNamePh')}</th>
                        <th className={adminTableCellClass}>{t('admin.staffRolePh')}</th>
                        <th className={adminTableCellClass}>{t('admin.staffEmailPh')}</th>
                        <th className={adminTableCellClass}>{t('admin.staffPhonePh')}</th>
                        {showStaffSalary ? <th className={adminTableCellClass}>{t('admin.staffSalaryPh')}</th> : null}
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                        {canEditStaff ? <th className={adminTableCellClass} /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map((s) => (
                        <tr key={s.id} className={adminTableRowClass}>
                          <td className={`${adminTableCellClass} font-medium text-foreground`}>{s.name}</td>
                          <td className={adminTableCellClass}>{labelStaffRole(s.role, t)}</td>
                          <td className={adminTableCellClass}>{s.email ?? '—'}</td>
                          <td className={adminTableCellClass}>{s.phone ?? '—'}</td>
                          {showStaffSalary ? (
                            <td className={adminTableCellClass}>{s.salary_eur ? money(s.salary_eur) : '—'}</td>
                          ) : null}
                          <td className={adminTableCellClass}>
                            <StatusBadge label={s.active ? t('admin.staffActive') : t('admin.staffInactive')} tone={s.active ? 'success' : 'neutral'} />
                          </td>
                          {canEditStaff ? (
                            <td className={adminTableCellClass}>
                              <div className="flex flex-wrap items-center gap-3">
                                <button type="button" onClick={() => startEditStaff(s)} className={adminBtnTertiaryClass}>{t('admin.staffEdit')}</button>
                                <button type="button" onClick={() => handleDeleteStaff(s.id)} className="text-sm text-danger hover:underline">{t('common.delete')}</button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              </>
            )}
          </div>
        );

      case 'настройки': {
        const moduleModeLabel = (mode: string) =>
          mode === 'staff_only'
            ? t('admin.elModeStaffOnly')
            : mode === 'disabled'
              ? t('admin.elModeDisabled')
              : t('admin.elModeOwnerAndStaff');
        const canRate = canSetSupportRate(staffRole);
        return (
          <div className="min-w-0 space-y-4">
            <AdminPageHeader title={t('admin.settingsTitle')} secondary={t('admin.settingsLead')} />
            <AdminCard className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('admin.settingsFinance')}</h3>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{t('admin.feeCurrentRate')}</p>
              <p className="text-xl font-semibold text-foreground">
                {money(supportRate)} <span className="text-sm font-normal text-muted">{t('admin.feePerSqm')}</span>
              </p>
              {canRate ? (
                <form onSubmit={handleSaveSupportRate} className="flex flex-wrap items-end gap-2">
                  <label className="text-sm text-secondary">
                    {t('admin.feeNewRate')}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={supportRateInput}
                      onChange={(e) => setSupportRateInput(e.target.value)}
                      className={`${adminFieldClass} mt-1 w-36`}
                    />
                  </label>
                  <AdminPrimaryButton type="submit" disabled={rateSaving || supportFeeMissing}>
                    {rateSaving ? t('admin.feeSaving') : t('admin.feeSaveRate')}
                  </AdminPrimaryButton>
                </form>
              ) : (
                <p className="text-xs text-muted">{t('admin.feeAdminOnlyRate')}</p>
              )}
              <p className="text-xs text-muted">{t('admin.settingsRateAlso')}</p>
            </AdminCard>
            <AdminCard className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('admin.settingsModules')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted">{t('admin.waterMode')}</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{moduleModeLabel(waterMode)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">{t('admin.electricityMode')}</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{moduleModeLabel(electricityMode)}</p>
                </div>
              </div>
              <p className="text-xs text-muted">{t('admin.settingsModesReadOnly')}</p>
            </AdminCard>
          </div>
        );
      }

      // =============================================================
      // ОПРОСЫ
      // =============================================================
      case 'опросы': {
        const selectedPoll = polls.find((p) => p.id === pollDetailId) ?? null;
        const detailOptions = selectedPoll
          ? pollOptions.filter((o) => o.poll_id === selectedPoll.id).sort((a, b) => a.sort_order - b.sort_order)
          : [];
        const detailVotes = selectedPoll ? pollVotes.filter((v) => v.poll_id === selectedPoll.id) : [];
        const detailHistory = selectedPoll ? pollVoteHistory.filter((h) => h.poll_id === selectedPoll.id) : [];
        const detailDecision = selectedPoll
          ? pollDecisionLabel(selectedPoll, tallyPoll(detailOptions, detailVotes, properties).accepted)
          : 'идёт';
        return (
          <div className="space-y-4">
            <AdminPageHeader
              title={t('admin.polls')}
              secondary={t('admin.pollsLeadAdmin')}
              action={canManageCriticalAccess ? (
                <AdminPrimaryButton type="button" onClick={startNewPoll}>
                  + {t('admin.quickPoll')}
                </AdminPrimaryButton>
              ) : undefined}
            />
            <p className="text-xs text-muted">{t('account.pollsNotMeeting')}</p>
            <AdminCard>
              {showPollForm && (
                <form onSubmit={handleSavePoll} className={`${adminFormPanelClass} mb-6`}>
                  <h3 className="text-sm font-semibold text-foreground">{t('admin.pollFormTitle')}</h3>
                  <select
                    className={adminFieldClass}
                    value={pollForm.category}
                    onChange={(e) => setPollForm({ ...pollForm, category: e.target.value as PollCategory })}
                  >
                    <option value="ремонт">{labelPollCategory('ремонт', t)}</option>
                    <option value="покупка">{labelPollCategory('покупка', t)}</option>
                    <option value="опрос">{labelPollCategory('опрос', t)}</option>
                  </select>
                  <input className={adminFieldClass}
                    placeholder={t('admin.pollWhatPh')} value={pollForm.title}
                    onChange={(e) => setPollForm({ ...pollForm, title: e.target.value })} required />
                  <textarea className={adminFieldClass}
                    placeholder={t('admin.pollBodyPh')} rows={3} value={pollForm.body}
                    onChange={(e) => setPollForm({ ...pollForm, body: e.target.value })} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="text-xs text-secondary mb-1 block">{t('admin.pollStarts')}</label>
                      <input type="date"
                        className={adminFieldClass}
                        value={pollForm.voting_starts}
                        onChange={(e) => setPollForm({ ...pollForm, voting_starts: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-secondary mb-1 block">{t('admin.pollEnds')}</label>
                      <input type="date"
                        className={adminFieldClass}
                        value={pollForm.deadline}
                        onChange={(e) => setPollForm({ ...pollForm, deadline: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-secondary mb-1 block">{t('admin.pollBudget')}</label>
                      <input type="number" step="0.01" min="0"
                        className={adminFieldClass}
                        placeholder="0.00" value={pollForm.budget_eur}
                        onChange={(e) => setPollForm({ ...pollForm, budget_eur: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-secondary mb-1 block">{t('admin.pollPhoto')}</label>
                    <input type="file" accept="image/*"
                      className="w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-hover file:px-4 file:py-2 file:text-sm file:text-secondary"
                      onChange={(e) => setPollPhoto(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-secondary">{t('admin.pollOptions')}</div>
                    {pollForm.options.map((opt, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className={adminFieldClass}
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
                            className="rounded px-2 text-xs text-danger bg-danger-bg">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}
                      className={adminBtnTertiaryClass}>
                      + {t('admin.pollAddOption')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AdminPrimaryButton type="submit">{t('admin.pollPublish')}</AdminPrimaryButton>
                    <AdminSecondaryButton type="button" onClick={() => setShowPollForm(false)}>
                      {t('common.cancel')}
                    </AdminSecondaryButton>
                  </div>
                </form>
              )}
              {polls.length === 0 && !showPollForm && (
                <AdminEmptyState title={t('account.noPolls')} />
              )}
              {polls.length > 0 && (
                <>
                  <div className="space-y-2 md:hidden">
                    {polls.map((poll) => {
                      const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
                      const options = pollOptions.filter((o) => o.poll_id === poll.id);
                      const tally = tallyPoll(options, votesForPoll, properties);
                      const decision = pollDecisionLabel(poll, tally.accepted);
                      return (
                        <button
                          key={poll.id}
                          type="button"
                          onClick={() => setPollDetailId(poll.id)}
                          className="w-full rounded-[14px] border border-border bg-surface p-3 text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{poll.title}</span>
                            <StatusBadge
                              label={labelPollStatus(poll.status, t)}
                              tone={poll.status === 'открыт' ? 'info' : 'neutral'}
                            />
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {formatOwnerDate(poll.voting_starts, locale)} – {formatOwnerDate(poll.deadline, locale)}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-secondary">{t('admin.pollVotesN', { n: votesForPoll.length })}</span>
                            <StatusBadge
                              label={labelPollDecision(decision, t)}
                              tone={decision === 'принято' ? 'success' : decision === 'не принято' ? 'danger' : 'warning'}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <AdminTableShell className="hidden md:block">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className={adminTableHeadRowClass}>
                          <th className={adminTableCellClass}>{t('account.subject')}</th>
                          <th className={adminTableCellClass}>{t('admin.status')}</th>
                          <th className={adminTableCellClass}>{t('admin.pollColVotes')}</th>
                          <th className={adminTableCellClass}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {polls.map((poll) => {
                          const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
                          const options = pollOptions.filter((o) => o.poll_id === poll.id);
                          const tally = tallyPoll(options, votesForPoll, properties);
                          const decision = pollDecisionLabel(poll, tally.accepted);
                          return (
                            <tr key={poll.id} className={adminTableRowClass}>
                              <td className={adminTableCellClass}>
                                <div className="font-medium text-foreground">{poll.title}</div>
                                <div className="text-xs text-muted">
                                  {labelPollCategory(poll.category, t)} · {formatOwnerDate(poll.voting_starts, locale)} – {formatOwnerDate(poll.deadline, locale)}
                                </div>
                              </td>
                              <td className={adminTableCellClass}>
                                <div className="flex flex-wrap gap-1">
                                  <StatusBadge
                                    label={labelPollStatus(poll.status, t)}
                                    tone={poll.status === 'открыт' ? 'info' : 'neutral'}
                                  />
                                  <StatusBadge
                                    label={labelPollDecision(decision, t)}
                                    tone={decision === 'принято' ? 'success' : decision === 'не принято' ? 'danger' : 'warning'}
                                  />
                                </div>
                              </td>
                              <td className={`${adminTableCellClass} text-secondary`}>
                                {t('admin.pollVotesN', { n: votesForPoll.length })}
                              </td>
                              <td className={adminTableCellClass}>
                                <button type="button" onClick={() => setPollDetailId(poll.id)} className={adminBtnTertiaryClass}>
                                  {t('admin.annOpen')}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </AdminTableShell>
                </>
              )}
              {selectedPoll ? (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-foreground">{selectedPoll.title}</h3>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <StatusBadge label={labelPollCategory(selectedPoll.category, t)} />
                          <StatusBadge
                            label={labelPollStatus(selectedPoll.status, t)}
                            tone={selectedPoll.status === 'открыт' ? 'info' : 'neutral'}
                          />
                          <StatusBadge
                            label={labelPollDecision(detailDecision, t)}
                            tone={detailDecision === 'принято' ? 'success' : detailDecision === 'не принято' ? 'danger' : 'warning'}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <AdminSecondaryButton type="button" onClick={() => setPollDetailId(null)}>
                          {t('common.close')}
                        </AdminSecondaryButton>
                        {canManageCriticalAccess ? (
                        <button type="button" onClick={() => handleTogglePoll(selectedPoll)} className={adminBtnSecondaryClass}>
                          {selectedPoll.status === 'открыт' ? t('admin.pollClose') : t('admin.pollReopen')}
                        </button>
                        ) : null}
                      </div>
                    </div>
                    <PollDetails poll={selectedPoll} options={detailOptions} votes={detailVotes} properties={properties} />
                    <PollOptionBars poll={selectedPoll} options={detailOptions} votes={detailVotes} properties={properties} alwaysShowStats />
                    <button
                      type="button"
                      onClick={() => setExpandedPollHistory(expandedPollHistory === selectedPoll.id ? null : selectedPoll.id)}
                      className={adminBtnTertiaryClass}
                    >
                      {expandedPollHistory === selectedPoll.id
                        ? t('admin.pollHideHistory')
                        : t('admin.pollHistory', { n: detailHistory.length })}
                    </button>
                    {expandedPollHistory === selectedPoll.id && (
                      detailHistory.length === 0 ? (
                        <AdminEmptyState title={t('admin.pollNoHistory')} />
                      ) : (
                        <AdminTableShell>
                          <table className="w-full min-w-[520px] text-xs">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>{t('admin.pollWhen')}</th>
                                <th className={adminTableCellClass}>{t('admin.aptLabel')}</th>
                                <th className={adminTableCellClass}>{t('admin.pollVote')}</th>
                                <th className={`${adminTableCellClass} text-right`}>{t('admin.pollWeight')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailHistory.map((h) => (
                                <tr key={h.id} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{formatOwnerDateTime(h.created_at, locale)}</td>
                                  <td className={adminTableCellClass}>{propertyNameById(h.property_id)}</td>
                                  <td className={adminTableCellClass}>
                                    {detailOptions.find((o) => o.id === h.option_id)?.label ?? h.option_id}
                                  </td>
                                  <td className={`${adminTableCellClass} text-right`}>{formatM3(Number(h.weight ?? 0), locale)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </AdminTableShell>
                      )
                    )}
                    {canManageCriticalAccess ? (
                    <div className="border-t border-border pt-3">
                      <button type="button" onClick={() => handleDeletePoll(selectedPoll.id)} className="text-sm text-danger hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                    ) : null}
                  </div>
              ) : null}
            </AdminCard>
          </div>
        );
      }

      // =============================================================
      // ОБЪЯВЛЕНИЯ
      // =============================================================
      case 'объявления': {
        const selectedAnn = announcements.find((a) => a.id === annDetailId) ?? null;
        return (
          <div className="space-y-4">
            <AdminPageHeader
              title={t('admin.announcements')}
              secondary={t('admin.announcementsLead')}
              action={canManageCriticalAccess ? (
                <AdminPrimaryButton type="button" onClick={() => setShowAnnForm(true)}>
                  + {t('admin.quickAnnounce')}
                </AdminPrimaryButton>
              ) : undefined}
            />
            {showAnnForm && (
              <form onSubmit={handleSaveAnn} className={adminFormPanelClass}>
                <h3 className="text-sm font-semibold text-foreground">{t('admin.annNew')}</h3>
                <input className={adminFieldClass}
                  placeholder={t('admin.annTitlePh')} value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} required />
                <textarea className={adminFieldClass}
                  placeholder={t('admin.annBodyPh')} rows={4} value={annForm.body}
                  onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })} required />
                <input className={adminFieldClass}
                  placeholder={t('admin.annFromPh')} value={annForm.created_by}
                  onChange={(e) => setAnnForm({ ...annForm, created_by: e.target.value })} />
                <div className="flex flex-wrap gap-2">
                  <AdminPrimaryButton type="submit">{t('admin.pollPublish')}</AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setShowAnnForm(false)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            )}
            {announcements.length === 0 ? (
              <AdminEmptyState title={t('account.noAnnouncements')} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {announcements.map((a) => {
                    const preview = String(a.body ?? '').replace(/\s+/g, ' ').trim();
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAnnDetailId(a.id)}
                        className="w-full rounded-[14px] border border-border bg-surface p-3 text-left shadow-card"
                      >
                        <div className="truncate text-sm font-medium text-foreground">{a.title}</div>
                        <div className="mt-1 text-xs text-muted">{formatOwnerDateTime(a.created_at, locale)}</div>
                        {preview ? <div className="mt-1 line-clamp-2 text-xs text-secondary">{preview}</div> : null}
                      </button>
                    );
                  })}
                </div>
                <AdminTableShell className="hidden md:block">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.annTitlePh')}</th>
                        <th className={adminTableCellClass}>{t('admin.date')}</th>
                        <th className={adminTableCellClass}>{t('account.description')}</th>
                        <th className={adminTableCellClass}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {announcements.map((a) => {
                        const preview = String(a.body ?? '').replace(/\s+/g, ' ').trim();
                        return (
                          <tr key={a.id} className={adminTableRowClass}>
                            <td className={`${adminTableCellClass} font-medium text-foreground`}>{a.title}</td>
                            <td className={`${adminTableCellClass} whitespace-nowrap text-xs text-muted`}>
                              {formatOwnerDateTime(a.created_at, locale)}
                            </td>
                            <td className={adminTableCellClass}>
                              <div className="max-w-md truncate text-secondary">{preview || '—'}</div>
                            </td>
                            <td className={adminTableCellClass}>
                              <button type="button" onClick={() => setAnnDetailId(a.id)} className={adminBtnTertiaryClass}>
                                {t('admin.annOpen')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </AdminTableShell>
              </>
            )}
            {selectedAnn ? (
              <div className={adminModalOverlayClass} onClick={() => setAnnDetailId(null)}>
                <div className={`${adminModalPanelClass} max-w-lg`} onClick={(e) => e.stopPropagation()}>
                  <div className={adminModalHeaderClass}>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground">{selectedAnn.title}</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {selectedAnn.created_by ? `${t('admin.annFrom', { name: selectedAnn.created_by })} · ` : ''}
                        {formatOwnerDateTime(selectedAnn.created_at, locale)}
                      </p>
                    </div>
                    <button type="button" onClick={() => setAnnDetailId(null)} className={adminBtnSecondaryClass}>
                      {t('common.close')}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <p className="whitespace-pre-wrap text-sm text-secondary">{selectedAnn.body}</p>
                    {canManageCriticalAccess ? (
                    <div className="border-t border-border pt-4">
                      <button type="button" onClick={() => handleDeleteAnn(selectedAnn.id)} className="text-sm text-danger hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      }

      case 'отчётность':
        return (
          <AdminReports
            properties={properties}
            requests={requests}
            ukExpenses={ukExpenses}
            ledger={ledger}
            staff={staff}
            supportRate={supportRate}
            years={expenseYears}
            showSalary={showStaffSalary}
          />
        );

      // =============================================================
      // ЧАТ
      // =============================================================
      case 'чат':
        return (
          <div
            className={`flex overflow-hidden bg-surface md:rounded-2xl md:border md:border-border ${
              selectedChatProperty
                ? 'h-[calc(100dvh-3.4rem)] md:h-[calc(100vh-10rem)]'
                : 'h-[calc(100dvh-8.1rem-env(safe-area-inset-bottom))] md:h-[calc(100vh-10rem)]'
            }`}
          >
            <div
              className={`w-full flex-col md:w-72 md:flex-shrink-0 md:border-r md:border-border ${
                selectedChatProperty ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="px-4 py-3 border-b border-border bg-surface">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('admin.dialogs')}{' '}
                  {totalUnreadChats > 0 && t('admin.dialogsNew', { n: totalUnreadChats })}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                {chatProperties.length === 0 ? (
                  <div className="p-4">
                    <AdminEmptyState title={t('admin.noDialogs')} />
                  </div>
                ) : (
                  chatProperties.map((item) => (
                    <button key={item.property.id}
                      onClick={() => setSelectedChatProperty(item.property)}
                      className={`w-full text-left px-4 py-3 border-b border-border hover:bg-surface transition-colors ${
                        selectedChatProperty?.id === item.property.id ? 'bg-accent-bg border-l-2 border-l-accent' : ''
                      }`}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground font-medium truncate">
                            {t('common.apt')} {item.property.apartment_number}
                          </div>
                          <div className="text-xs text-muted truncate">{item.property.owner_name}</div>
                          {item.lastMessage && (
                            <div className="text-xs text-muted truncate mt-1">
                              {item.lastMessage.sender === 'owner' ? '' : `${t('common.uk')}: `}{chatPreviewText(item.lastMessage.message, item.lastMessage.file_name, item.lastMessage.photo_url)}
                            </div>
                          )}
                        </div>
                        {item.unread > 0 && (
                          <span className="ml-2 flex-shrink-0 bg-danger text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                            {item.unread}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div
              className={`min-w-0 flex-1 flex-col ${
                selectedChatProperty ? 'flex' : 'hidden md:flex'
              }`}
            >
              {selectedChatProperty ? (
                <>
                  <div className="flex items-start gap-2 border-b border-border bg-surface px-3 py-3 md:px-5">
                    <button
                      type="button"
                      onClick={() => setSelectedChatProperty(null)}
                      className="mt-0.5 shrink-0 rounded-lg px-2 py-1 text-sm text-secondary hover:bg-hover md:hidden"
                    >
                      ← {t('common.back')}
                    </button>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold text-accent">
                        {t('common.apt')} {selectedChatProperty.apartment_number} — {selectedChatProperty.owner_name}
                      </h2>
                      <div className="truncate text-xs text-muted">
                        {selectedChatProperty.owner_email}
                        {selectedChatProperty.owner_phone && ` · ${selectedChatProperty.owner_phone}`}
                        {' · '}
                        <span className={occupancyColor(selectedChatProperty.occupancy_status)}>
                          {occupancyLabel(selectedChatProperty.occupancy_status)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedChatProperty(null)}
                      className="hidden shrink-0 text-sm text-secondary hover:text-foreground md:inline"
                    >
                      ✕ {t('common.close')}
                    </button>
                  </div>
                  <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3 md:p-4">
                    {chatMessages.length === 0 ? (
                      <div className="flex h-full items-center justify-center p-4">
                        <AdminEmptyState title={t('admin.noChatMessages')} />
                      </div>
                    ) : (
                      chatMessages.map((m) => {
                        const isUk = m.sender === 'uk';
                        return (
                          <div key={m.id} className={`flex ${isUk ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-fit max-w-[85%] rounded-2xl px-4 py-2.5 text-sm md:max-w-[75%] ${
                              isUk ? 'bg-accent-bg text-foreground rounded-br-sm'
                                   : 'bg-hover text-foreground rounded-bl-sm border border-border'
                            }`}>
                              {m.photo_url && (
                                <div className={m.message.trim() ? 'mb-2' : ''}>
                                  <ChatMedia url={m.photo_url} fileName={m.file_name} />
                                </div>
                              )}
                              {m.message.trim() ? (
                                <div className="whitespace-pre-wrap break-words">{m.message}</div>
                              ) : null}
                              <div className={`mt-1 text-[10px] ${isUk ? 'text-secondary' : 'text-secondary'}`}>
                                {formatOwnerDateTime(m.created_at, locale)}
                                {!isUk && isNewOwnerMessage(m, chatMessages, ukChatSeen[String(selectedChatProperty.id)]) && (
                                  <span className="ml-2 text-danger">● {t('account.newMsg')}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <form onSubmit={handleSendChat}
                    className="border-t border-border bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
                    {chatFile && (
                      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-secondary">
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
                    <div className="flex items-center gap-2">
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
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-secondary hover:bg-hover disabled:opacity-40"
                    >
                      📎
                    </button>
                    <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-foreground placeholder:text-placeholder focus:outline-none focus:border-accent md:text-sm"
                      value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                      placeholder={t('account.chatPlaceholder')} disabled={chatSending} />
                    <button type="submit" disabled={chatSending || (!chatInput.trim() && !chatFile)}
                      className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed">
                      {chatSending ? '...' : t('common.send')}
                    </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted">
                  {t('admin.pickDialog')}
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
        const yearPayments = ledger.filter((e) => e.kind === 'payment').reduce((s, e) => s + Number(e.amount), 0);
        const feeBulkTotal = properties.length;
        const feeBulkExisting = feeChargeExisting ?? 0;
        const feeBulkWill = Math.max(0, feeBulkTotal - feeBulkExisting);
        const feeTabs = [
          { id: 'overview', label: t('admin.feeTabOverview') },
          { id: 'policy', label: t('admin.feeTabPolicy') },
          { id: 'operations', label: t('admin.feeTabOperations') },
          { id: 'register', label: t('admin.feeTabRegister') },
        ] as const;
        const feeRaw = searchParams.get('tab');
        const feeTab = feeTabs.some((item) => item.id === feeRaw) ? feeRaw : 'overview';
        return (
          <div className="space-y-4">
            <AdminPageHeader title={t('admin.fee')} secondary={t('admin.feeLead')} />
            {supportFeeMissing && (
              <AdminInlineAlert tone="warning">{t('admin.feeMissingTables')}</AdminInlineAlert>
            )}
            <AdminTabBar
              tabs={[...feeTabs]}
              active={feeTab ?? 'overview'}
              onChange={(id) => openSectionTab('такса', id)}
            />
            {feeTab === 'overview' && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <AdminMetricCard
                  label={t('admin.feeCurrentRate')}
                  value={money(supportRate)}
                  secondary={t('admin.feePerSqm')}
                  onClick={() => openSectionTab('такса', 'operations')}
                />
                <AdminMetricCard
                  label={t('admin.feeYear')}
                  value={money(annualSupportTotal)}
                  secondary={String(new Date().getFullYear())}
                  onClick={() => openSectionTab('такса', 'policy')}
                />
                <AdminMetricCard
                  label={t('admin.debt')}
                  value={money(totalDebt)}
                  alert={totalDebt > 0}
                  onClick={() => openSectionTab('такса', 'register')}
                />
                <AdminMetricCard
                  label={t('admin.overpay')}
                  value={money(totalOverpayment)}
                  onClick={() => openSectionTab('такса', 'register')}
                />
              </div>
            )}

            <div className={feeTab === 'policy' || feeTab === 'register' ? undefined : 'hidden'}>
            <AdminSupportFeeAnnual
              supabase={supabase}
              properties={properties}
              supportRate={supportRate}
              canPay={canPay}
              canRate={canRate}
              onReload={loadAll}
              onError={setError}
              panel={feeTab === 'register' ? 'register' : 'policy'}
            />
            </div>

            {feeTab === 'operations' && (
            <>
            <div className="grid gap-4">
              <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.feeCurrentRate')}</p>
                <div className="mt-1 text-xl font-semibold text-foreground">{money(supportRate)} <span className="text-sm font-normal text-muted">{t('admin.feePerSqm')}</span></div>
                <p className="mt-2 text-sm text-muted">
                  {t('admin.feeYear')}: {money(annualSupportTotal)}
                </p>
                {canRate ? (
                  <form onSubmit={handleSaveSupportRate} className="mt-4 flex flex-wrap items-end gap-2">
                    <label className="text-sm text-secondary">
                      {t('admin.feeNewRate')}
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={supportRateInput}
                        onChange={(e) => setSupportRateInput(e.target.value)}
                        className="mt-1 block w-36 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={rateSaving || supportFeeMissing}
                      className="rounded-full bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {rateSaving ? t('admin.feeSaving') : t('admin.feeSaveRate')}
                    </button>
                  </form>
                ) : (
                  <p className="mt-3 text-xs text-muted">{t('admin.feeAdminOnlyRate')}</p>
                )}
              </div>

            </div>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.bulkTitle')}</p>
              <p className="mt-2 text-sm text-secondary">{t('admin.feeChargeHint')}</p>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="text-sm text-secondary">
                  {t('admin.sfYear')}
                  <input
                    type="number"
                    min="2020"
                    max="2100"
                    value={chargeYear}
                    onChange={(e) => {
                      setChargeYear(e.target.value);
                      setFeeBulkResult(null);
                    }}
                    className="mt-1 block w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted">{t('admin.bulkTotal')}</dt>
                  <dd className="font-medium tabular-nums">{feeBulkTotal}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('admin.bulkExisting')}</dt>
                  <dd className="font-medium tabular-nums">{feeChargeExisting == null ? '—' : feeBulkExisting}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('admin.bulkWill')}</dt>
                  <dd className="font-medium tabular-nums">{feeChargeExisting == null ? '—' : feeBulkWill}</dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={chargeSaving || !canPay || supportFeeMissing || feeBulkTotal === 0}
                onClick={() => void handleChargeSupportBulk()}
                className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {chargeSaving ? t('admin.feeCharging') : t('admin.bulkChargeAll')}
              </button>
              {feeBulkResult ? <p className="mt-3 text-sm text-secondary">{feeBulkResult}</p> : null}
            </div>
            </>
            )}

            {feeTab === 'operations' && (
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.feePayTitle')}</p>
              {!canPay && (
                <p className="mt-2 text-sm text-warning">{t('admin.feePayWho')}</p>
              )}
              <p className="mt-2 text-sm text-secondary">{t('admin.feeWillRecord')}</p>
              <form onSubmit={handleRecordSupportPayment} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm text-secondary sm:col-span-2">
                  {t('admin.aptLabel')}
                  <ApartmentCombobox
                    className="mt-1"
                    required
                    disabled={!canPay}
                    properties={properties}
                    value={payPropertyId}
                    onChange={(id) => {
                      setPayPropertyId(id);
                      const p = properties.find((x) => x.id === id);
                      if (!p) return;
                      const debt = Number(p.debt ?? 0);
                      setPayAmount(
                        debt > 0 ? debt.toFixed(2) : String(monthlySupportFee(p.area_sqm, supportRate)),
                      );
                    }}
                  />
                </label>
                <label className="text-sm text-secondary">
                  {t('admin.feeAmount')}
                  <input
                    required
                    disabled={!canPay}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="text-sm text-secondary">
                  {t('admin.note')}
                  <input
                    disabled={!canPay}
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder={t('admin.feeNotePh')}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                {selectedPay && (
                  <div className="sm:col-span-2 flex flex-wrap gap-2 text-xs">
                    <button type="button" className="rounded-full border border-border px-3 py-1 text-secondary"
                      onClick={() => setPayAmount(Number(selectedPay.debt ?? 0) > 0 ? Number(selectedPay.debt).toFixed(2) : '0.01')}>
                      {t('admin.feeAllDebt')}
                    </button>
                    <button type="button" className="rounded-full border border-border px-3 py-1 text-secondary"
                      onClick={() => setPayAmount(String(monthlySupportFee(selectedPay.area_sqm, supportRate)))}>
                      {t('admin.feeMonth')}
                    </button>
                    <button type="button" className="rounded-full border border-border px-3 py-1 text-secondary"
                      onClick={() => setPayAmount(String(annualSupportFee(selectedPay.area_sqm, supportRate)))}>
                      {t('admin.feeOneYear')}
                    </button>
                  </div>
                )}
                <div className="sm:col-span-2 lg:col-span-4">
                  <button
                    type="submit"
                    disabled={!canPay || paySaving || supportFeeMissing}
                    className="rounded-full bg-accent hover:bg-accent-hover px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {paySaving ? t('admin.feePaying') : t('admin.feePaySubmit')}
                  </button>
                </div>
              </form>
            </div>
            )}

            {feeTab === 'operations' && (
            <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.feeLedger')}</p>
                <p className="text-xs text-muted">{t('admin.kindPayment')}: {money(yearPayments)}</p>
              </div>
              {ledger.length === 0 ? (
                <div className="mt-3"><AdminEmptyState title={t('admin.feeNoLedger')} /></div>
              ) : (
                <div className="mt-3">
                  <AdminTableShell>
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.date')}</th>
                        <th className={adminTableCellClass}>{t('form.colApt')}</th>
                        <th className={adminTableCellClass}>{t('admin.kind')}</th>
                        <th className={adminTableCellClass}>{t('admin.amount')}</th>
                        <th className={adminTableCellClass}>{t('admin.debt')}</th>
                        <th className={adminTableCellClass}>{t('admin.overpay')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.slice(0, 40).map((row) => {
                        const apt = properties.find((p) => p.id === row.property_id);
                        const debtAfter = Number(row.debt_after ?? 0);
                        const overAfter = Number(row.overpayment_after ?? 0);
                        return (
                          <tr key={row.id} className={adminTableRowClass}>
                            <td className={adminTableCellClass}>
                              {formatOwnerDateTime(row.created_at, locale)}
                            </td>
                            <td className={adminTableCellClass}>{apt?.apartment_number ?? row.property_id}</td>
                            <td className={adminTableCellClass}>
                              {row.kind === 'payment' ? t('admin.kindPayment') : `${t('admin.kindCharge')}${row.period ? ` ${row.period}` : ''}`}
                            </td>
                            <td className={`${adminTableCellClass} tabular-nums`}>{money(row.amount)}</td>
                            <td className={adminTableCellClass}>
                              {debtAfter > 0 ? (
                                <StatusBadge label={money(debtAfter)} tone="danger" />
                              ) : (
                                <span className="text-muted">{money(0)}</span>
                              )}
                            </td>
                            <td className={adminTableCellClass}>
                              {overAfter > 0 ? (
                                <StatusBadge label={money(overAfter)} tone="success" />
                              ) : (
                                <span className="text-muted">{money(0)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </AdminTableShell>
                </div>
              )}
            </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  }

  function navBadge(key: AdminSection) {
    if (key === 'смены') return pendingTransfersCount;
    if (key === 'опросы') return openPollsCount;
    if (key === 'чат') return totalUnreadChats;
    if (key === 'заявки') return activeRequests.length;
    if (key === 'расходы') return pendingUkExpenses.length;
    return 0;
  }

  function renderNavButton(key: AdminSection, nested: boolean) {
    const item = menuByKey.get(key);
    if (!item) return null;
    const active = activeMenu === key;
    const badge = navBadge(key);
    return (
      <button
        key={key}
        type="button"
        onClick={() => navigateAdminSection(key)}
        title={item.label}
        className={`flex w-full min-w-0 items-center overflow-hidden rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          sidebarOpen ? (nested ? 'h-8 gap-2 pl-8 pr-2' : 'h-9 gap-2.5 px-2.5') : 'h-9 justify-center px-0'
        } ${
          active
            ? 'border-accent/25 bg-accent-bg text-accent'
            : 'border-transparent text-secondary hover:bg-hover hover:text-foreground'
        }`}
      >
        <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center text-base leading-none">
          {item.icon}
          {!sidebarOpen && badge > 0 ? (
            <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${key === 'чат' ? 'bg-danger' : 'bg-warning'}`} />
          ) : null}
        </span>
        {sidebarOpen ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-left">{item.label}</span>
            {badge > 0 ? (
              <span
                className={`ml-auto min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ${
                  key === 'чат' ? 'bg-danger text-white' : 'bg-warning text-gray-900'
                }`}
              >
                {badge}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-lg text-secondary">{t('common.loading')}</div>
      </div>
    );
  }

  if (!allowed || loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-lg text-secondary">{t('admin.loading')}</div>
      </div>
    );
  }

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
      <aside className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(18rem,88vw)] flex-col overflow-hidden border-r border-border bg-surface transition-[transform,width] duration-300 md:pointer-events-auto md:static md:h-auto md:flex-shrink-0 ${
        sidebarOpen
          ? 'translate-x-0 md:w-64 md:min-w-64 md:max-w-64'
          : 'pointer-events-none -translate-x-full md:pointer-events-auto md:w-16 md:min-w-16 md:max-w-16 md:translate-x-0'
      }`}>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border p-3">
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
        <nav className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto p-2">
          {sidebarOpen ? (
            <>
              {renderNavButton('обзор', false)}
              {MENU_GROUPS.filter((group) => group.id !== 'overview' && group.items.length > 0).map((group) => {
                const expanded = openNavGroup === group.id;
                return (
                  <div key={group.id} className="space-y-0.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleNavGroup(group.id)}
                      className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        expanded ? 'bg-hover text-foreground' : 'text-secondary hover:bg-hover hover:text-foreground'
                      }`}
                    >
                      <NavGroupIcon id={group.id} />
                      <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                      <NavChevron open={expanded} />
                    </button>
                    {expanded ? <div className="space-y-0.5">{group.items.map((key) => renderNavButton(key, true))}</div> : null}
                  </div>
                );
              })}
            </>
          ) : (
            MENU_GROUPS.map((group) => (
              <div key={group.id} className="space-y-0.5">
                {group.items.map((key) => renderNavButton(key, false))}
              </div>
            ))
          )}
        </nav>
        <div className="space-y-2 border-t border-border p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {sidebarOpen ? (
            <div className="space-y-2">
              <LanguageSwitcher compact />
              <div className="text-xs text-muted truncate">{sessionEmail}</div>
              {hasCabinet && (
                <Link href="/account"
                  className="block text-center text-xs rounded-lg border border-accent/25 bg-accent-bg px-2 py-1.5 text-accent">
                  {t('account.myApts')}
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleLogout();
                }}
                className="min-h-11 w-full rounded-xl border border-border bg-hover px-2 text-sm"
              >
                {t('common.logout')}
              </button>
              <Link href="/"
                className="block text-center text-xs rounded-lg border border-border bg-hover px-2 py-1.5 hover:bg-hover">
                {t('common.home')}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {hasCabinet && (
                <Link href="/account" className="p-1.5 rounded-lg bg-accent-bg text-xs" title={t('account.myApts')}>🏠</Link>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleLogout();
                }}
                className="p-1.5 rounded-lg bg-hover text-xs"
                title={t('common.logout')}
              >
                🚪
              </button>
              <Link href="/" className="p-1.5 rounded-lg bg-hover hover:bg-hover text-xs" title={t('common.home')}>←</Link>
            </div>
          )}
        </div>
      </aside>

      <main className={`min-w-0 flex-1 ${
        activeMenu === 'чат'
          ? 'overflow-hidden pb-0'
          : 'overflow-y-auto pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0'
      }`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2.5 md:px-6 md:py-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold tracking-[0.02em] text-foreground">{t('brand.name')}</p>
            <h1 className="truncate text-base font-semibold md:text-lg">
              {menuByKey.get(activeMenu)?.label}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleLogout();
              }}
              className="min-h-10 rounded-lg border border-border px-3 text-sm text-secondary md:hidden"
            >
              {t('common.logout')}
            </button>
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <LanguageSwitcher compact />
              <Link href="/" className="text-sm text-secondary hover:text-foreground">{t('common.backHome')}</Link>
            </div>
          </div>
        </div>
        <div className={activeMenu === 'чат' ? 'p-0 md:p-4' : 'mx-auto w-full max-w-7xl p-3 md:px-6 md:py-5'}>
          {error && (
            <div className="mb-4">
              <AdminInlineAlert tone="danger" onDismiss={() => setError(null)}>
                {error}
              </AdminInlineAlert>
            </div>
          )}
          {renderContent()}
        </div>
      </main>
      <MobileBottomNav
        items={[
          { key: 'обзор', label: t('admin.overview'), icon: '📊' },
          { key: 'чат', label: t('account.tabChat'), icon: '💬', badge: totalUnreadChats || undefined },
          { key: 'заявки', label: t('admin.requests'), icon: '📋', badge: activeRequests.length || undefined },
          { key: '__finance', label: t('admin.menuFinance'), icon: '💶', badge: pendingUkExpenses.length || undefined },
        ]}
        activeKey={
          financeGroup?.items.includes(activeMenu)
            ? '__finance'
            : activeMenu === 'заявки' || activeMenu === 'чат' || activeMenu === 'обзор'
              ? activeMenu
              : '__more'
        }
        moreActive={!['обзор', 'чат', 'заявки', ...(financeGroup?.items ?? [])].includes(activeMenu)}
        onSelect={(key) => {
          if (key === '__finance') {
            const first = financeGroup?.items[0];
            if (first && financeGroup && !financeGroup.items.includes(activeMenu)) {
              navigateAdminSection(first);
            }
            return;
          }
          if (isAdminSection(key)) navigateAdminSection(key);
        }}
        onMore={() => {
          setSidebarOpen(true);
        }}
        hidden={sidebarOpen || (activeMenu === 'чат' && Boolean(selectedChatProperty))}
      />
    </div>
  );
}

export default function AdminPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
          <div className="text-lg text-secondary">{t('admin.loading')}</div>
        </div>
      }
    >
      <AdminPortal />
    </Suspense>
  );
}

// =====================================================================
// КАРТОЧКА СТАТИСТИКИ
// =====================================================================
// =====================================================================
// МОДАЛЬНОЕ ОКНО — ДЕТАЛЬНЫЙ ПРОСМОТР ВСЕХ ДАННЫХ КВАРТИРЫ
// =====================================================================
function ApartmentDetailModal({
  property, requests, meterReadings, guests, pets, chatMessages, chatSeenAt, supportRate, onClose, onEdit, onOpenChat, onTakePayment, onChanged, onDelete, onOpenTransfer,
}: {
  property: Property;
  requests: Request[];
  meterReadings: MeterReading[];
  guests: ApartmentGuest[];
  pets: ApartmentPet[];
  chatMessages: ChatMessage[];
  chatSeenAt?: string;
  supportRate: number;
  onClose: () => void;
  onEdit: () => void;
  onOpenChat: () => void;
  onTakePayment: () => void;
  onChanged: () => Promise<void> | void;
  onDelete?: () => void;
  onOpenTransfer: () => void;
}) {
  const { t, locale } = useI18n();
  const [supabase] = useState(() => createBrowserClient());
  const [activeTab, setActiveTab] = useState<'инфо' | 'финансы' | 'счётчики' | 'заявки' | 'жильцы' | 'чат'>('инфо');
  const [waterTariffPrice, setWaterTariffPrice] = useState<number | null>(null);
  const [electricityTariff, setElectricityTariff] = useState<ElectricityTariff | null>(null);
  const [petForm, setPetForm] = useState({ species: 'dog', name: '', chip_no: '', passport_no: '' });
  const [petSaving, setPetSaving] = useState(false);
  const [guestForm, setGuestForm] = useState({
    first_name: '',
    last_name: '',
    birth_year: '',
    is_child: false,
    is_permanent: true,
    check_in: '',
    check_out: '',
  });
  const [guestSaving, setGuestSaving] = useState(false);

  const annualFee = annualSupportFee(property.area_sqm, supportRate);
  const monthlyFee = monthlySupportFee(property.area_sqm, supportRate);
  const unreadChats = chatMessages.filter((m) => isNewOwnerMessage(m, chatMessages, chatSeenAt)).length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('water_tariffs')
        .select('price_eur_per_m3')
        .order('valid_from', { ascending: false })
        .limit(1);
      const elRes = await supabase
        .from('electricity_tariffs')
        .select('*')
        .order('valid_from', { ascending: false });
      if (cancelled) return;
      if (error || !data?.[0]) {
        setWaterTariffPrice(null);
      } else {
        setWaterTariffPrice(Number(data[0].price_eur_per_m3));
      }
      if (elRes.error || !elRes.data) {
        setElectricityTariff(null);
      } else {
        setElectricityTariff(currentElectricityTariff((elRes.data as ElectricityTariff[]) ?? []));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function meterTypeLabel(kind: string) {
    if (kind === 'electricity_day') return t('form.elDayShort');
    if (kind === 'electricity_night') return t('form.elNightShort');
    return t('account.water');
  }

  async function handleAddPet(e: React.FormEvent) {
    e.preventDefault();
    setPetSaving(true);
    try {
      const { error } = await supabase.from('apartment_pets').insert({
        property_id: property.id,
        species: petForm.species,
        name: petForm.name.trim() || null,
        chip_no: petForm.chip_no.trim() || null,
        passport_no: petForm.passport_no.trim() || null,
      });
      if (error) throw error;
      setPetForm({ species: 'dog', name: '', chip_no: '', passport_no: '' });
      await onChanged();
    } catch (err: any) {
      alert(err?.message?.includes('apartment_pets') ? t('err.registrySql') : (err?.message ?? t('err.save')));
    } finally {
      setPetSaving(false);
    }
  }

  async function handleRemovePet(id: number) {
    if (!confirm(t('confirm.removePet'))) return;
    const { error } = await supabase.from('apartment_pets').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    await onChanged();
  }

  async function handleAddGuest(e: React.FormEvent) {
    e.preventDefault();
    const fn = guestForm.first_name.trim();
    const ln = guestForm.last_name.trim();
    if (!fn || !ln) return;
    setGuestSaving(true);
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
      let { error } = await supabase.from('apartment_guests').insert(payload);
      if (error && (error.message.includes('is_permanent') || error.message.includes('schema cache'))) {
        const { is_permanent: _ignored, ...legacy } = payload;
        const retry = await supabase.from('apartment_guests').insert(legacy);
        error = retry.error;
      }
      if (error) throw error;
      setGuestForm({
        first_name: '',
        last_name: '',
        birth_year: '',
        is_child: false,
        is_permanent: true,
        check_in: guestForm.check_in,
        check_out: guestForm.check_out,
      });
      await onChanged();
    } catch (err: any) {
      alert(err?.message ?? t('err.addGuest'));
    } finally {
      setGuestSaving(false);
    }
  }

  async function handleRemoveGuest(id: number) {
    if (!confirm(t('confirm.removeGuest'))) return;
    const { error } = await supabase.from('apartment_guests').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    await onChanged();
  }

  return (
    <div className={adminModalOverlayClass} onClick={onClose}>
      <div className={`${adminModalPanelClass} max-w-4xl`}
        onClick={(e) => e.stopPropagation()}>
        {/* ШАПКА */}
        <div className={adminModalHeaderClass}>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">
              {t('picker.apt', { n: property.apartment_number })}
            </h3>
            <p className="mt-0.5 truncate text-sm text-secondary">
              {(property.owner_name ?? '').trim() || (property.owner_email ?? '').trim() || '—'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{property.area_sqm ?? '—'} {t('common.sqm')} · {property.floor ?? '—'} {t('common.floor')}</span>
              <StatusBadge
                label={labelOccupancy(property.occupancy_status, t)}
                tone={property.occupancy_status === 'standby' ? 'warning' : 'info'}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onOpenChat} className={adminBtnSecondaryClass}>
              {t('admin.tabChat')}{unreadChats > 0 ? ` (${unreadChats})` : ''}
            </button>
            <button type="button" onClick={onEdit} className={adminBtnSecondaryClass}>{t('admin.aptEdit')}</button>
            {onDelete ? (
              <button type="button" onClick={onDelete} className={adminBtnDangerClass}>{t('admin.aptDelete')}</button>
            ) : null}
            <button type="button" onClick={onClose} className="px-2 text-xl text-secondary hover:text-foreground">✕</button>
          </div>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2">
          {[
            { key: 'инфо', label: t('admin.tabObject'), count: null },
            { key: 'жильцы', label: t('admin.tabStay'), count: guests.length + pets.length },
            { key: 'финансы', label: t('admin.tabFinance'), count: null },
            { key: 'счётчики', label: t('admin.tabMeters'), count: meterReadings.length },
            { key: 'заявки', label: t('admin.tabRequests'), count: requests.length },
            { key: 'чат', label: t('admin.tabChat'), count: chatMessages.length },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key as 'инфо' | 'финансы' | 'счётчики' | 'заявки' | 'жильцы' | 'чат')}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${
                activeTab === tab.key
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-hover'
              }`}>
              {tab.label}
              {tab.count !== null && tab.count > 0 && (
                <span className="ml-1 text-xs bg-hover rounded-full px-1.5 py-0.5 text-secondary">
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
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <InfoRow label={t('admin.phAptNo')} value={String(property.apartment_number ?? '—')} />
              <InfoRow label={t('admin.phFloor')} value={String(property.floor ?? '—')} />
              <InfoRow label={t('admin.phArea')} value={`${property.area_sqm ?? '—'} ${t('common.sqm')}`} />
              <InfoRow label={t('form.colStatus')} value={labelListing(listingStatus(property.status), t)} />
              <InfoRow label={t('admin.phOwner')} value={property.owner_name ?? '—'} />
              <InfoRow label={t('account.colType')} value={labelOwnerType(property.owner_type, t) || '—'} />
              <InfoRow label="Email" value={property.owner_email ?? '—'} />
              <InfoRow label={t('admin.phPhone')} value={property.owner_phone ?? '—'} />
              {property.company_name ? <InfoRow label={t('admin.phCompany')} value={property.company_name} /> : null}
              <InfoRow
                label={t('admin.idealParts')}
                value={formatIdealPartsPercent(property.ideal_parts_percent, locale) ?? '—'}
              />
            </div>
          )}

          {/* ФИНАНСЫ */}
          {activeTab === 'финансы' && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`${adminCardClass} p-3`}>
                  <div className="text-secondary text-xs">{t('admin.kpiDebtTitle')}</div>
                  <div className={`mt-1 text-lg font-semibold ${
                    Number(property.debt) > 0 ? 'text-danger' : 'text-foreground'
                  }`}>
                    {formatEur(Number(property.debt ?? 0), locale)}
                  </div>
                </div>
                <div className={`${adminCardClass} p-3`}>
                  <div className="text-secondary text-xs">{t('admin.overpay')}</div>
                  <div className={`mt-1 text-lg font-semibold ${
                    Number(property.overpayment) > 0 ? 'text-foreground' : 'text-muted'
                  }`}>
                    {formatEur(Number(property.overpayment ?? 0), locale)}
                  </div>
                </div>
                <div className={`${adminCardClass} p-3`}>
                  <div className="text-secondary text-xs">{t('admin.feeYear')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatEur(annualFee, locale)}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {supportRate} €/м² × {property.area_sqm} м²
                  </div>
                </div>
                <div className={`${adminCardClass} p-3`}>
                  <div className="text-secondary text-xs">{t('account.feeMonth')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatEur(monthlyFee, locale)}
                  </div>
                </div>
              </div>
              <div className={`${adminCardClass} p-3`}>
                <div className="text-secondary text-xs mb-2">Тарифы</div>
                <div className="grid gap-1 text-xs text-secondary sm:grid-cols-2">
                  <div>{t('admin.elDayShort')}: {electricityTariff ? formatElectricityTariff(Number(electricityTariff.day_price_eur_per_kwh), locale) : '—'}</div>
                  <div>{t('admin.elNightShort')}: {electricityTariff ? formatElectricityTariff(Number(electricityTariff.night_price_eur_per_kwh), locale) : '—'}</div>
                  <div>{t('admin.water')}: {waterTariffPrice == null || Number.isNaN(waterTariffPrice) ? '—' : `${formatEur(waterTariffPrice, locale)}/м³`}</div>
                  <div>Такса: {supportRate} €/м²·год</div>
                </div>
                <button
                  type="button"
                  onClick={onTakePayment}
                  className={`${adminBtnPrimaryClass} mt-3`}
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
                <AdminEmptyState title={t('admin.noMeterRows')} />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary border-b border-border">
                      <th className="py-2 px-3">Тип</th>
                      <th className="py-2 px-3">Показание</th>
                      <th className="py-2 px-3">Дата</th>
                      <th className="py-2 px-3">Кто внёс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meterReadings.map((m) => (
                      <tr key={m.id} className="border-b border-border">
                        <td className="py-2 px-3 text-foreground">{meterTypeLabel(m.meter_type)}</td>
                        <td className="py-2 px-3 text-foreground">
                          {m.meter_type === 'cold_water'
                            ? `${formatM3(Number(m.value), locale)} ${t('account.m3')}`
                            : `${formatKwh(Number(m.value), locale)} ${t('account.kwh')}`}
                        </td>
                        <td className="py-2 px-3 text-secondary">
                          {formatOwnerDate(m.reading_date)}
                        </td>
                        <td className="py-2 px-3 text-secondary">{m.submitted_by ?? '—'}</td>
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
                <AdminEmptyState title={t('admin.noRequestRows')} />
              ) : (
                requests.map((r) => (
                  <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-foreground font-medium text-sm">{r.subject}</div>
                      <StatusBadge
                        label={labelRequestStatus(r.status, t)}
                        tone={
                          r.status === 'новая' ? 'info' :
                          r.status === 'в работе' ? 'warning' :
                          r.status === 'выполнена' ? 'success' : 'danger'
                        }
                      />
                    </div>
                    <div className="text-sm text-secondary mt-1">{r.description}</div>
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs text-muted">{labelCategory(r.category, t)} · {labelPriority(r.priority, t)}</span>
                      {r.photo_url && (
                        <SignedStorageLink stored={r.photo_url} className="text-xs text-accent hover:underline">
                          📷 Фото
                        </SignedStorageLink>
                      )}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {formatOwnerDateTime(r.created_at, locale)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ЖИЛЬЦЫ */}
          {activeTab === 'жильцы' && (
            <div className="space-y-5">
              <div className={`${adminCardClass} p-3`}>
                <p className="text-xs text-muted">{t('admin.aptStayNow')}</p>
                <div className="mt-1">
                  <StatusBadge
                    label={labelOccupancy(property.occupancy_status, t)}
                    tone={property.occupancy_status === 'standby' ? 'warning' : 'info'}
                  />
                </div>
                {property.occupancy_status !== 'rented' && property.occupancy_status !== 'standby' ? (
                  <p className="mt-2 text-sm text-foreground">
                    {(property.owner_name ?? '').trim() || '—'}
                    <span className="text-secondary"> · {t('admin.aptOwnerLine')}</span>
                  </p>
                ) : null}
                {property.occupancy_status === 'rented' || normalizeOccupantKind(property.occupant_kind) !== 'owner' ? (
                  <div className="mt-2 text-sm">
                    <p className="text-foreground">{property.occupant_name || '—'}</p>
                    <p className="text-xs text-secondary">{labelOccupantKind(property.occupant_kind, t)}</p>
                    {property.occupant_phone ? <p className="text-xs text-muted">{property.occupant_phone}</p> : null}
                    {property.occupant_email ? <p className="text-xs text-muted">{property.occupant_email}</p> : null}
                  </div>
                ) : null}
                {property.occupancy_status === 'standby' ? (
                  <p className="mt-2 text-sm text-secondary">{t('admin.aptStandbyNote')}</p>
                ) : null}
                <button type="button" onClick={onOpenTransfer} className={`${adminBtnTertiaryClass} mt-2`}>
                  {t('admin.aptTransferGo')} →
                </button>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  {property.occupancy_status === 'owner' || !property.occupancy_status ? t('admin.aptCoResidents') : t('admin.aptResidents')}
                </h4>
                <p className="mb-3 text-xs text-muted">{t('registry.householdHint')}</p>
                <form onSubmit={handleAddGuest} className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.firstName')}
                    value={guestForm.first_name}
                    onChange={(e) => setGuestForm({ ...guestForm, first_name: e.target.value })}
                    required
                  />
                  <input
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.lastName')}
                    value={guestForm.last_name}
                    onChange={(e) => setGuestForm({ ...guestForm, last_name: e.target.value })}
                    required
                  />
                  <input
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('account.birthYear')}
                    type="number"
                    min="1900"
                    max={new Date().getFullYear()}
                    value={guestForm.birth_year}
                    onChange={(e) => setGuestForm({ ...guestForm, birth_year: e.target.value })}
                  />
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={guestForm.is_child}
                      onChange={(e) => setGuestForm({ ...guestForm, is_child: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    {t('account.child18')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={guestForm.is_permanent}
                      onChange={(e) => setGuestForm({ ...guestForm, is_permanent: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    {t('registry.resident')}
                  </label>
                  <input
                    type="date"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    value={guestForm.check_in}
                    onChange={(e) => setGuestForm({ ...guestForm, check_in: e.target.value })}
                    title={t('account.checkIn')}
                  />
                  <input
                    type="date"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    value={guestForm.check_out}
                    onChange={(e) => setGuestForm({ ...guestForm, check_out: e.target.value })}
                    title={t('account.checkOut')}
                  />
                  <button
                    type="submit"
                    disabled={guestSaving}
                    className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {guestSaving ? t('account.adding') : t('account.addGuestPlus')}
                  </button>
                </form>
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
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g, i) => (
                      <tr key={g.id} className="border-b border-border">
                        <td className="py-2 px-3 text-muted">{i + 1}</td>
                        <td className="py-2 px-3 text-foreground">{g.first_name}</td>
                        <td className="py-2 px-3 text-foreground">{g.last_name}</td>
                        <td className="py-2 px-3 text-secondary">{g.birth_year ?? '—'}</td>
                        <td className="py-2 px-3">
                          {g.is_child ? <span className="text-warning">{t('account.child')}</span>
                                     : <span className="text-accent">{t('account.adult')}</span>}
                        </td>
                        <td className="py-2 px-3 text-secondary text-xs">
                          {g.is_permanent ? t('common.yes') : t('common.no')}
                        </td>
                        <td className="py-2 px-3 text-secondary text-xs">
                          {g.check_in ? formatOwnerDate(g.check_in) : '—'}
                        </td>
                        <td className="py-2 px-3 text-secondary text-xs">
                          {g.check_out ? formatOwnerDate(g.check_out) : '—'}
                        </td>
                        <td className="py-2 px-3">
                          <button type="button" onClick={() => handleRemoveGuest(g.id)} className="text-xs text-danger">
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
              <div>
                <h4 className="mb-2 text-sm font-semibold text-accent">{t('registry.petsTitle')}</h4>
                <p className="mb-3 text-xs text-muted">{t('registry.petsHintChip')}</p>
                <form onSubmit={handleAddPet} className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <select className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    value={petForm.species} onChange={(e) => setPetForm({ ...petForm, species: e.target.value })}>
                    <option value="dog">{t('registry.dog')}</option>
                    <option value="cat">{t('registry.cat')}</option>
                    <option value="other">{t('registry.otherPet')}</option>
                  </select>
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.petName')} value={petForm.name}
                    onChange={(e) => setPetForm({ ...petForm, name: e.target.value })} />
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.chip')} value={petForm.chip_no}
                    onChange={(e) => setPetForm({ ...petForm, chip_no: e.target.value })} />
                  <input className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder={t('registry.passport')} value={petForm.passport_no}
                    onChange={(e) => setPetForm({ ...petForm, passport_no: e.target.value })} />
                  <button type="submit" disabled={petSaving}
                    className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
                    {t('registry.addPet')}
                  </button>
                </form>
                {pets.length === 0 ? (
                  <div className="text-sm text-muted">—</div>
                ) : (
                  <div className="space-y-2">
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
              </div>
            </div>
          )}

          {/* ЧАТ */}
          {activeTab === 'чат' && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {chatMessages.length === 0 ? (
                <AdminEmptyState title={t('admin.noChatRows')} />
              ) : (
                chatMessages.map((m) => {
                  const isOwner = m.sender === 'owner';
                  return (
                    <div key={m.id} className={`flex ${isOwner ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                        isOwner ? 'bg-hover text-foreground border border-border' : 'bg-accent-bg text-foreground'
                      }`}>
                        <div className="text-xs text-secondary mb-1">
                          {isOwner ? 'Жилец' : 'УК'}
                        </div>
                        {m.photo_url && (
                          <div className={m.message.trim() ? 'mb-2' : ''}>
                            <ChatMedia url={m.photo_url} fileName={m.file_name} />
                          </div>
                        )}
                        {m.message.trim() ? (
                          <div className="whitespace-pre-wrap break-words">{m.message}</div>
                        ) : null}
                        <div className="text-[10px] text-muted mt-1">
                          {formatOwnerDateTime(m.created_at, locale)}
                          {isOwner && isNewOwnerMessage(m, chatMessages, chatSeenAt) && (
                            <span className="ml-2 text-danger">● не прочитано</span>
                          )}
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
    <div className="flex items-center justify-between py-2 border-b border-border">
      <span className="text-secondary">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}