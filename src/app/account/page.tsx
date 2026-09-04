'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';
import Link from 'next/link';
import {
  accountVoteWeight,
  isMissingRelation,
  isPollAcceptingVotes,
  pollCategoryClass,
  pollDecisionLabel,
  propertyVoteWeight,
  tallyPoll,
  type AreaShare,
  type Poll,
  type PollOption,
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
  labelPollCategory,
  labelPollDecision,
  labelPriority,
  labelRequestStatus,
  labelTransfer,
} from '@/i18n/labels';
import { resolveAccess } from '@/lib/access';
import { clearSessionEmail, normalizeEmail, readSessionEmail, writeSessionEmail } from '@/lib/session';
import { DEFAULT_SUPPORT_RATE, annualSupportFee, monthlySupportFee, type SupportFeeEntry } from '@/lib/finance';
import { expensePhotoUrls, isExpensePublished } from '@/lib/expenses';
import { ExpensePhotoStrip } from '@/components/ExpensePhotoStrip';
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
const WATER_RATE = 3;

export default function AccountPage() {
  const router = useRouter();
  const { t, dateLocale } = useI18n();
  const MENU_ITEMS: { key: MenuSection; label: string; icon: string }[] = [
    { key: 'квартира', label: t('account.apt'), icon: '🏠' },
    { key: 'жильцы', label: t('account.occupancy'), icon: '👥' },
    { key: 'финансы', label: t('account.finance'), icon: '💰' },
    { key: 'расходы_ук', label: t('account.expenses'), icon: '🧾' },
    { key: 'счётчики', label: t('account.meters'), icon: '⚡' },
    { key: 'заявки', label: t('account.requests'), icon: '📋' },
    { key: 'сообщения', label: t('account.announcements'), icon: '📢' },
    { key: 'опросы', label: t('account.polls'), icon: '🗳️' },
    { key: 'чат', label: t('account.chat'), icon: '💬' },
  ];
  // ---------- DEV-ЛОГИН ----------
  const [devEmail, setDevEmail] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
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
  const [supportLedger, setSupportLedger] = useState<SupportFeeEntry[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollOptions, setPollOptions] = useState<PollOption[]>([]);
  const [pollVotes, setPollVotes] = useState<PollVote[]>([]);
  const [apartmentShares, setApartmentShares] = useState<AreaShare[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ---------- СЧЁТЧИКИ ----------
  const [meterReadings, setMeterReadings] = useState<{
    electricity_day: MeterReading[];
    electricity_night: MeterReading[];
    cold_water: MeterReading[];
  }>({ electricity_day: [], electricity_night: [], cold_water: [] });

  // ---------- ЖИЛЬЦЫ ----------
  const [guests, setGuests] = useState<ApartmentGuest[]>([]);
  const [guestForm, setGuestForm] = useState({
    first_name: '',
    last_name: '',
    birth_year: '',
    is_child: false,
    check_in: '',
    check_out: '',
  });
  const [petInfo, setPetInfo] = useState<string>('');
  const [occupancySaving, setOccupancySaving] = useState(false);
  const [guestAdding, setGuestAdding] = useState(false);

  // ---------- ЧАТ ----------
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- МЕНЮ ----------
  const [activeMenu, setActiveMenu] = useState<MenuSection>('квартира');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expenseYearFilter, setExpenseYearFilter] = useState<number | 'all'>(
    new Date().getFullYear()
  );

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

  // ===================================================================
  // DEV-ЛОГИН
  // ===================================================================
  useEffect(() => {
    const saved = readSessionEmail();
    if (saved) {
      setDevEmail(saved);
      setEmailInput(saved);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const email = normalizeEmail(emailInput);
    if (!email) return;
    writeSessionEmail(email);
    setDevEmail(email);
  }

  function handleLogout() {
    clearSessionEmail();
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
    setApartmentShares([]);
    setTransfers([]);
    setGuests([]);
    setMeterReadings({ electricity_day: [], electricity_night: [], cold_water: [] });
    setChatMessages([]);
    setUnreadChatCount(0);
    setError(null);
    setEmailInput('');
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
        const access = await resolveAccess(devEmail);
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

        const [pollsRes, optRes, voteRes, sharesRes] = await Promise.all([
          supabase.from('polls').select('*').order('created_at', { ascending: false }),
          supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
          supabase.from('poll_votes').select('*'),
          supabase.from('properties').select('id, area_sqm'),
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
        if (sharesRes.error) {
          setApartmentShares(access.properties.map((p) => ({ id: p.id, area_sqm: p.area_sqm })));
        } else {
          setApartmentShares((sharesRes.data as AreaShare[]) ?? []);
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
    async function loadPropertyScoped() {
      if (!property) return;
      setPetInfo(property.pet_info ?? '');
      try {
        const { data: guestData, error: guestErr } = await supabase
          .from('apartment_guests')
          .select('*')
          .eq('property_id', property.id)
          .order('created_at', { ascending: true });
        if (guestErr) throw guestErr;
        setGuests((guestData as ApartmentGuest[]) ?? []);

        const [dayRes, nightRes, waterRes] = await Promise.all([
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', property.id)
            .eq('meter_type', 'electricity_day')
            .order('reading_date', { ascending: false })
            .limit(2),
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', property.id)
            .eq('meter_type', 'electricity_night')
            .order('reading_date', { ascending: false })
            .limit(2),
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', property.id)
            .eq('meter_type', 'cold_water')
            .order('reading_date', { ascending: false })
            .limit(2),
        ]);
        if (dayRes.error) throw dayRes.error;
        if (nightRes.error) throw nightRes.error;
        if (waterRes.error) throw waterRes.error;
        setMeterReadings({
          electricity_day: (dayRes.data as MeterReading[]) ?? [],
          electricity_night: (nightRes.data as MeterReading[]) ?? [],
          cold_water: (waterRes.data as MeterReading[]) ?? [],
        });

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
    if (!msg) return;
    setChatSending(true);
    try {
      await markOwnerMessagesRead(property.id);
      const { data: inserted, error: insertErr } = await supabase
        .from('chat_messages')
        .insert({
          property_id: property.id,
          sender: 'owner',
          message: msg,
          read_by_owner: true,
        })
        .select('*')
        .single();
      if (insertErr) throw insertErr;
      setChatMessages((prev) => [...prev, inserted as ChatMessage]);
      setChatInput('');
    } catch (e: any) {
      setError(e?.message ?? t('err.send'));
    } finally {
      setChatSending(false);
    }
  }

  // ===================================================================
  // ЖИЛЬЦЫ — ФУНКЦИИ
  // ===================================================================
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
      const { data: inserted, error: insErr } = await supabase
        .from('apartment_guests')
        .insert({
          property_id: property.id,
          first_name: fn,
          last_name: ln,
          birth_year: guestForm.birth_year ? Number(guestForm.birth_year) : null,
          is_child: guestForm.is_child,
          check_in: guestForm.check_in || null,
          check_out: guestForm.check_out || null,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      setGuests((prev) => [...prev, inserted as ApartmentGuest]);
      setGuestForm({
        first_name: '',
        last_name: '',
        birth_year: '',
        is_child: false,
        check_in: guestForm.check_in,
        check_out: guestForm.check_out,
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
  async function uploadPhotoIfAny(file: File | null) {
    if (!file || !property) return null;
    const fileExt = file.name.split('.').pop();
    const safeExt = fileExt ? fileExt.toLowerCase() : 'jpg';
    const filePath = `${property.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;
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

  async function refreshPolls(propertyId: number) {
    const [pollsRes, optRes, voteRes, sharesRes] = await Promise.all([
      supabase.from('polls').select('*').order('created_at', { ascending: false }),
      supabase.from('poll_options').select('*').order('sort_order', { ascending: true }),
      supabase.from('poll_votes').select('*'),
      supabase.from('properties').select('id, area_sqm'),
    ]);
    if (!pollsRes.error) setPolls((pollsRes.data as Poll[]) ?? []);
    if (!optRes.error) setPollOptions((optRes.data as PollOption[]) ?? []);
    if (!voteRes.error) setPollVotes((voteRes.data as PollVote[]) ?? []);
    if (!sharesRes.error) setApartmentShares((sharesRes.data as AreaShare[]) ?? []);
  }

  async function handleVote(poll: Poll, optionId: number) {
    if (properties.length === 0) return;
    if (!isPollAcceptingVotes(poll)) return;
    setVotingPollId(poll.id);
    setError(null);
    const rows = properties.map((p) => ({
      poll_id: poll.id,
      option_id: optionId,
      property_id: p.id,
      weight: propertyVoteWeight(p.area_sqm),
    }));
    try {
      const { error } = await supabase.from('poll_votes').upsert(rows, {
        onConflict: 'poll_id,property_id',
      });
      if (error) throw error;
      await supabase.from('poll_vote_history').insert(rows);
      const { data: votesData } = await supabase.from('poll_votes').select('*').eq('poll_id', poll.id);
      const options = pollOptions.filter((o) => o.poll_id === poll.id);
      const tally = tallyPoll(options, (votesData as PollVote[]) ?? [], apartmentShares);
      if (tally.accepted) {
        await supabase.from('polls').update({
          status: 'закрыт',
          result: 'принято',
          result_option_id: tally.winner?.option.id ?? optionId,
        }).eq('id', poll.id);
      }
      await refreshPolls(properties[0].id);
    } catch (e: any) {
      setError(e?.message ?? t('err.vote'));
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
    if (d <= 0) return 'text-emerald-300';
    if (d < 100) return 'text-yellow-300';
    return 'text-red-400';
  }, [properties]);

  const overColor = useMemo(() => {
    const o = properties.reduce((sum, p) => sum + Number(p.overpayment ?? 0), 0);
    if (o <= 0) return 'text-emerald-300';
    return 'text-emerald-400';
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
  const currentListing = listingStatus(property?.status);
  const pendingTransfer = useMemo(
    () =>
      property
        ? transfers.find((t) => t.property_id === property.id && t.status === 'ожидает')
        : undefined,
    [transfers, property]
  );

  // ===================================================================
  // ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ СЧЁТЧИКА
  // ===================================================================
  function renderMeterBlock(label: string, unit: string, readings: MeterReading[]) {
    const current = readings[0] ?? null;
    const previous = readings[1] ?? null;
    const consumption = current && previous ? current.value - previous.value : null;

    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <div className="text-sm text-white/50">{label}</div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/70">{t('account.currentReading')}</span>
            <span className="text-2xl font-semibold text-emerald-400">
              {current ? current.value : '—'} {unit}
            </span>
          </div>
          {previous && (
            <div className="flex items-center justify-between text-sm text-white/40">
              <span>{t('account.previousReading')}</span>
              <span>{previous.value} {unit}</span>
            </div>
          )}
          {consumption !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">{t('account.consumption')}</span>
              <span className="text-yellow-300 font-medium">{consumption.toFixed(2)} {unit}</span>
            </div>
          )}
          {current && (
            <div className="text-xs text-white/40 mt-1">
              {t('account.fromDate', { d: new Date(current.reading_date).toLocaleDateString(dateLocale) })}
            </div>
          )}
          {previous && (
            <div className="text-xs text-white/40">
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
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
                {t('account.onAccount', { count: properties.length, area: myVoteWeight.toFixed(1) })}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="relative px-5 pb-5 pt-5 md:px-6 md:pt-6">
                <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                      {properties.length > 1 ? t('account.selectedApt') : t('account.yourApt')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
                        № {property?.apartment_number ?? '—'}
                      </h2>
                      <p className="text-sm text-white/45">
                        {property?.floor != null ? t('account.floorN', { n: property.floor }) : t('account.floorUnknown')}
                        {' · '}
                        {property?.area_sqm != null ? `${property.area_sqm} ${t('common.sqm')}` : t('account.areaUnknown')}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-white/70">
                      {property?.owner_name || t('account.ownerUnknown')}
                      {property?.owner_type ? (
                        <span className="text-white/35">
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
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : occupancyStatus === 'standby'
                          ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                          : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    }`}>
                      {occupancyStatus === 'owner' && t('account.livesOwner')}
                      {occupancyStatus === 'standby' && t('account.away')}
                      {occupancyStatus === 'rented' && t('account.tenants')}
                    </span>
                  </div>
                </div>

                <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.debt')}</div>
                    <div className={`mt-1 text-lg font-semibold ${
                      Number(property?.debt ?? 0) <= 0 ? 'text-emerald-300' :
                      Number(property?.debt ?? 0) < 100 ? 'text-yellow-300' : 'text-red-400'
                    }`}>
                      {Number(property?.debt ?? 0).toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.overpay')}</div>
                    <div className={`mt-1 text-lg font-semibold ${
                      Number(property?.overpayment ?? 0) > 0 ? 'text-emerald-400' : 'text-white'
                    }`}>
                      {Number(property?.overpayment ?? 0).toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.feeYear')}</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {annualSupportFee(property?.area_sqm, supportRate).toFixed(0)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.openRequests')}</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {requests.filter((r) =>
                        r.property_id === property?.id &&
                        r.status !== 'выполнена' &&
                        r.status !== 'отклонена'
                      ).length}
                    </div>
                  </div>
                </div>

                <div className="relative mt-5">
                  <p className="mb-2 text-[11px] uppercase tracking-wider text-white/35">{t('account.objectStatus')}</p>
                  <div className="inline-flex w-full rounded-full bg-white/[0.04] p-1 sm:w-auto">
                    <button
                      type="button"
                      disabled={listingSaving}
                      onClick={() => handleUpdateListing('в собственности')}
                      className={`flex-1 rounded-full px-4 py-2 text-sm transition disabled:opacity-50 sm:flex-none ${
                        currentListing === 'в собственности'
                          ? 'bg-emerald-500/20 text-emerald-200 shadow-sm'
                          : 'text-white/50 hover:text-white/80'
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
                          ? 'bg-amber-500/20 text-amber-200 shadow-sm'
                          : 'text-white/50 hover:text-white/80'
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
                    className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/15"
                  >
                    {t('account.manageOccupancy')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('заявки')}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                  >
                    {t('account.requests')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('финансы')}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                  >
                    {t('account.finance')}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
              <button
                type="button"
                onClick={() => setOwnerTransferOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left md:p-6"
                aria-expanded={ownerTransferOpen}
              >
                <div>
                  <h2 className="text-lg font-semibold text-emerald-400">{t('account.ownerTransfer')}</h2>
                  <p className="mt-0.5 text-sm text-white/50">
                    {pendingTransfer
                      ? t('account.transferPending')
                      : t('account.ownerTransferHint')}
                  </p>
                </div>
                <span className="shrink-0 text-white/40">{ownerTransferOpen ? '▲' : '▼'}</span>
              </button>
              {ownerTransferOpen && (
              <div className="border-t border-white/10 px-4 pb-6 pt-4 md:px-6">
              <p className="text-sm text-white/50 mb-4">
                {t('account.transferLead')}
              </p>
              {pendingTransfer ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  {t('account.transferPending')}
                  <div className="mt-2 text-white/70">
                    {t('account.newOwner')}: {pendingTransfer.to_owner_name} ({pendingTransfer.to_owner_email})
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitTransfer} className="space-y-3">
                  <input
                    className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                    placeholder={t('account.phOwnerName')}
                    value={transferForm.to_owner_name}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_name: e.target.value })}
                    required
                  />
                  <input
                    className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                    placeholder={t('account.phOwnerEmail')}
                    type="email"
                    value={transferForm.to_owner_email}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_email: e.target.value })}
                    required
                  />
                  <input
                    className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                    placeholder={t('account.phPhoneOpt')}
                    value={transferForm.to_owner_phone}
                    onChange={(e) => setTransferForm({ ...transferForm, to_owner_phone: e.target.value })}
                  />
                  <textarea
                    className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                    placeholder={t('account.phCommentUk')}
                    rows={3}
                    value={transferForm.note}
                    onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
                  />
                  <button
                    type="submit"
                    disabled={transferSubmitting}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {transferSubmitting ? t('account.sending') : t('account.submitTransfer')}
                  </button>
                </form>
              )}
              {transfers.filter((tr) => tr.property_id === property?.id).length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs text-white/40">{t('account.transferHistory')}</div>
                  {transfers
                    .filter((tr) => tr.property_id === property?.id)
                    .slice(0, 5)
                    .map((tr) => (
                      <div key={tr.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
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
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-semibold text-emerald-400 mb-2">{t('account.occTitle')}</h2>
              <p className="text-sm text-white/50 mb-4">
                {t('account.occLead', { n: String(property?.apartment_number ?? '') })}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {/* Собственник */}
                <button
                  onClick={() => handleUpdateOccupancy('owner')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'owner'
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : 'border-white/10 bg-white/[0.04] hover:border-white/15'
                  }`}
                >
                  <div className="text-2xl mb-2">🏠</div>
                  <div className="text-sm font-medium text-white">{t('account.occOwner')}</div>
                  <div className="text-xs text-white/40 mt-1">{t('account.occOwnerHint')}</div>
                </button>

                {/* В отъезде */}
                <button
                  onClick={() => handleUpdateOccupancy('standby')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'standby'
                      ? 'border-yellow-500 bg-yellow-500/15'
                      : 'border-white/10 bg-white/[0.04] hover:border-white/15'
                  }`}
                >
                  <div className="text-2xl mb-2">✈️</div>
                  <div className="text-sm font-medium text-white">{t('account.occStandby')}</div>
                  <div className="text-xs text-white/40 mt-1">{t('account.occStandbyHint')}</div>
                </button>

                {/* Арендаторы */}
                <button
                  onClick={() => handleUpdateOccupancy('rented')}
                  disabled={occupancySaving}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                    occupancyStatus === 'rented'
                      ? 'border-cyan-500 bg-cyan-500/15'
                      : 'border-white/10 bg-white/[0.04] hover:border-white/15'
                  }`}
                >
                  <div className="text-2xl mb-2">👥</div>
                  <div className="text-sm font-medium text-white">{t('account.occRent')}</div>
                  <div className="text-xs text-white/40 mt-1">{t('account.occRentHint')}</div>
                </button>
              </div>
            </div>

            {/* Информация о жильцах (показывается при статусе rented) */}
            {occupancyStatus === 'rented' && (
              <>
                {/* Период аренды */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h2 className="text-lg font-semibold text-emerald-400 mb-4">{t('account.stayPeriod')}</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm text-white/70 mb-1 block">{t('account.checkIn')}</label>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        value={guestForm.check_in}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_in: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm text-white/70 mb-1 block">{t('account.checkOut')}</label>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        value={guestForm.check_out}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_out: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-white/40 mt-2">
                    {t('account.stayDatesHint')}
                  </p>
                </div>

                {/* Форма добавления жильца */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h2 className="text-lg font-semibold text-emerald-400 mb-4">
                    {t('account.addGuest')}
                  </h2>
                  <form onSubmit={handleAddGuest} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <input
                        className="rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        placeholder={t('account.firstName')}
                        value={guestForm.first_name}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, first_name: e.target.value })
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        placeholder={t('account.lastName')}
                        value={guestForm.last_name}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, last_name: e.target.value })
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        placeholder={t('account.birthYear')}
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={guestForm.birth_year}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, birth_year: e.target.value })
                        }
                      />
                      <label className="flex items-center gap-2 text-sm text-white/70 sm:col-span-1">
                        <input
                          type="checkbox"
                          checked={guestForm.is_child}
                          onChange={(e) =>
                            setGuestForm({ ...guestForm, is_child: e.target.checked })
                          }
                          className="w-4 h-4 accent-emerald-500"
                        />
                        {t('account.child18')}
                      </label>
                      <input
                        type="date"
                        className="rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                        value={guestForm.check_in}
                        onChange={(e) =>
                          setGuestForm({ ...guestForm, check_in: e.target.value })
                        }
                        title={t('account.checkIn')}
                      />
                      <input
                        type="date"
                        className="rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
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
                      className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                    >
                      {guestAdding ? t('account.adding') : t('account.addGuestPlus')}
                    </button>
                  </form>
                </div>

                {/* Список жильцов */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-emerald-400">
                      {t('account.guestsN', { n: guests.length })}
                    </h2>
                    {guests.length > 0 && (
                      <button
                        onClick={handleClearAllGuests}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        {t('account.clearAll')}
                      </button>
                    )}
                  </div>

                  {guests.length === 0 ? (
                    <div className="text-sm text-white/40">{t('account.noGuests')}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-white/50 border-b border-white/10">
                            <th className="py-2 px-3">№</th>
                            <th className="py-2 px-3">{t('account.firstName')}</th>
                            <th className="py-2 px-3">{t('account.lastName')}</th>
                            <th className="py-2 px-3">{t('account.birthYearShort')}</th>
                            <th className="py-2 px-3">{t('account.colType')}</th>
                            <th className="py-2 px-3">{t('account.checkIn')}</th>
                            <th className="py-2 px-3">{t('account.checkOut')}</th>
                            <th className="py-2 px-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {guests.map((g, i) => (
                            <tr
                              key={g.id}
                              className="border-b border-white/10 hover:bg-white/[0.04]"
                            >
                              <td className="py-2 px-3 text-white/40">{i + 1}</td>
                              <td className="py-2 px-3 text-white">{g.first_name}</td>
                              <td className="py-2 px-3 text-white">{g.last_name}</td>
                              <td className="py-2 px-3 text-white/70">
                                {g.birth_year ?? '—'}
                              </td>
                              <td className="py-2 px-3">
                                {g.is_child ? (
                                  <span className="text-yellow-300">{t('account.child')}</span>
                                ) : (
                                  <span className="text-emerald-300">{t('account.adult')}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-white/50 text-xs">
                                {g.check_in
                                  ? new Date(g.check_in).toLocaleDateString(dateLocale)
                                  : '—'}
                              </td>
                              <td className="py-2 px-3 text-white/50 text-xs">
                                {g.check_out
                                  ? new Date(g.check_out).toLocaleDateString(dateLocale)
                                  : '—'}
                              </td>
                              <td className="py-2 px-3">
                                <button
                                  onClick={() => handleRemoveGuest(g.id)}
                                  className="rounded px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300"
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
            )}

            {/* Домашние животные — показывается всегда */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-semibold text-emerald-400 mb-2">
                {t('account.pets')} 🐾
              </h2>
              <p className="text-sm text-white/50 mb-4">
                {t('account.petsHint')}
              </p>
              <textarea
                className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                placeholder={t('account.petsPh')}
                rows={3}
                value={petInfo}
                onChange={(e) => setPetInfo(e.target.value)}
              />
              <button
                onClick={handleSavePetInfo}
                disabled={occupancySaving}
                className="mt-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
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
        const totalDebt = properties.reduce((s, p) => s + Number(p.debt ?? 0), 0);
        const totalOver = properties.reduce((s, p) => s + Number(p.overpayment ?? 0), 0);
        const monthlyFee = monthlySupportFee(
          properties.reduce((s, p) => s + Number(p.area_sqm ?? 0), 0),
          supportRate,
        );
        const balanceLabel = totalDebt > 0 ? t('account.toPay') : totalOver > 0 ? t('account.overpay') : t('account.balance');
        const balanceValue = totalDebt > 0 ? totalDebt : totalOver;
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
              {t('account.ukOnlyFee')}
            </div>
            {properties.length > 1 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
                {t('account.summaryApts', { count: properties.length, area: myVoteWeight.toFixed(1) })}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="relative px-5 pb-5 pt-5 md:px-6 md:pt-6">
                <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                      {t('account.toPay')}
                    </p>
                    <div className={`mt-1 text-3xl font-semibold tracking-tight md:text-4xl ${
                      totalDebt > 0 ? debtColor : 'text-emerald-300'
                    }`}>
                      {balanceValue.toFixed(2)} €
                    </div>
                    <p className="mt-2 text-sm text-white/50">
                      {totalDebt > 0
                        ? t('account.hasDebt')
                        : totalOver > 0
                          ? t('account.hasOver')
                          : t('account.noDebt')}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${
                    totalDebt > 0
                      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {totalDebt > 0 ? t('account.needPay') : t('account.paid')}
                  </span>
                </div>

                <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.debt')}</div>
                    <div className={`mt-1 text-lg font-semibold ${debtColor}`}>
                      {totalDebt.toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.overpay')}</div>
                    <div className={`mt-1 text-lg font-semibold ${overColor}`}>
                      {totalOver.toFixed(2)} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.feeYear')}</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {annualSupportFeeEur.toFixed(0)} €
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/35">
                      {myVoteWeight.toFixed(1)} м² × {supportRate} €
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <div className="text-[11px] text-white/40">{t('account.feeMonth')}</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {monthlyFee.toFixed(2)} €
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/35">{t('account.approx')}</div>
                  </div>
                </div>

                <div className="relative mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('счётчики')}
                    className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/15"
                  >
                    {t('account.metersBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('расходы_ук')}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                  >
                    {t('account.expenses')}
                  </button>
                </div>
              </div>
            </div>

            {properties.length > 1 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPropertyId(p.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      p.id === property?.id
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-white">№ {p.apartment_number}</span>
                      <span className="text-xs text-white/40">{Number(p.area_sqm ?? 0)} {t('common.sqm')}</span>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm">
                      <span className={Number(p.debt ?? 0) > 0 ? 'text-yellow-300' : 'text-white/50'}>
                        {t('account.debtAmt', { n: Number(p.debt ?? 0).toFixed(2) })}
                      </span>
                      <span className={Number(p.overpayment ?? 0) > 0 ? 'text-emerald-300' : 'text-white/40'}>
                        +{Number(p.overpayment ?? 0).toFixed(2)} €
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                {t('account.houseTariffs')}
              </p>
              <p className="mt-1 text-xs text-white/40">{t('account.tariffsHint')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                  <div className="text-[11px] text-white/40">{t('account.elDay')}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{DAY_RATE}</div>
                  <div className="text-[11px] text-white/35">{t('account.perKwh')}</div>
                </div>
                <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                  <div className="text-[11px] text-white/40">{t('account.elNight')}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{NIGHT_RATE}</div>
                  <div className="text-[11px] text-white/35">{t('account.perKwh')}</div>
                </div>
                <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                  <div className="text-[11px] text-white/40">{t('account.water')}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{WATER_RATE}</div>
                  <div className="text-[11px] text-white/35">{t('account.perM3')}</div>
                </div>
                <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                  <div className="text-[11px] text-white/40">{t('account.supportFee')}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{supportRate}</div>
                  <div className="text-[11px] text-white/35">{t('account.perSqmYear')}</div>
                </div>
              </div>
            </div>

            {supportLedger.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                  {t('account.feePayments')}
                </p>
                <div className="mt-3 space-y-2">
                  {supportLedger.slice(0, 8).map((row) => (
                    <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="text-white/50">
                        {new Date(row.created_at).toLocaleDateString(dateLocale)}
                        {properties.length > 1 ? ` · ${t('picker.apt', { n: properties.find((p) => p.id === row.property_id)?.apartment_number ?? '' })}` : ''}
                      </span>
                      <span className={row.kind === 'payment' ? 'text-emerald-300' : 'text-amber-200'}>
                        {row.kind === 'payment' ? '+' : `${t('account.charge')} `}
                        {Number(row.amount).toFixed(2)} €
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-emerald-400">{t('account.expensesTitle')}</h2>
              <div className="text-sm text-white/70">
                {expenseYearFilter === 'all' ? t('account.allYears') : expenseYearFilter}:{' '}
                <span className="font-semibold text-emerald-400">{visibleTotal.toFixed(2)} €</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={() => setExpenseYearFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  expenseYearFilter === 'all'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-[#070b0a]/40 text-white/50 border-white/10 hover:text-white/80'
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
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-[#070b0a]/40 text-white/50 border-white/10 hover:text-white/80'
                    }`}
                  >
                    {year}
                    <span className="ml-2 text-xs text-white/40">{total.toFixed(2)} €</span>
                  </button>
                );
              })}
            </div>
            <p className="mb-4 text-sm text-white/50">
              {t('account.expensesPublished')}
            </p>
            {publishedUkExpenses.length === 0 ? (
              <div className="text-sm text-white/50">{t('account.expensesEmpty')}</div>
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
                          {(group?.total ?? 0).toFixed(2)} €
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <div className="text-sm text-white/40">{t('account.noExpensesYear', { year })}</div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((e) => {
                            const photos = expensePhotoUrls(e);
                            return (
                              <div key={e.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-white">{e.title?.trim() || '—'}</div>
                                    <div className="mt-0.5 text-xs text-white/40">{formatUkDate(e.expense_date)}</div>
                                    {photos.length > 0 && (
                                      <div className="mt-2">
                                        <ExpensePhotoStrip urls={photos} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-sm font-semibold text-white">
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
      case 'счётчики':
        return (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-emerald-400 mb-4">
              {t('account.metersTitle')}{property ? ` · ${t('picker.apt', { n: property.apartment_number })}` : ''}
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {renderMeterBlock(t('account.elDayFull'), t('account.kwh'), meterReadings.electricity_day)}
              {renderMeterBlock(t('account.elNightFull'), t('account.kwh'), meterReadings.electricity_night)}
              {renderMeterBlock(t('account.water'), t('account.m3'), meterReadings.cold_water)}
            </div>
          </div>
        );

      // ===========================================================
      // ЗАЯВКИ
      // ===========================================================
      case 'заявки':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-emerald-400">{t('account.requests')}</h2>
                <button
                  type="button"
                  onClick={() => setShowRequestForm((v) => !v)}
                  className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  {showRequestForm ? t('account.hideForm') : t('account.createRequest')}
                </button>
              </div>
              {showRequestForm && (
                <form onSubmit={handleCreateRequest} className="mb-6 space-y-4 rounded-xl border border-emerald-700/40 bg-white/[0.04] p-4">
                  <h3 className="text-sm font-semibold text-emerald-300">
                    {t('account.newRequest')}{property ? ` · ${t('picker.apt', { n: property.apartment_number })}` : ''}
                  </h3>
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">{t('account.subject')}</label>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={t('account.phReqTitle')}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">{t('account.description')}</label>
                    <textarea
                      className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('account.phReqBody')}
                      rows={4}
                      required
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm text-white/70 mb-1 block">{t('account.category')}</label>
                      <select
                        className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
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
                      <label className="text-sm text-white/70 mb-1 block">{t('account.priority')}</label>
                      <select
                        className="w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-sm text-white"
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
                    <label className="text-sm text-white/70 mb-1 block">{t('account.photoOpt')}</label>
                    <input
                      type="file"
                      accept="image/*"
                      className="w-full text-sm text-white/50 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:text-white/80 hover:file:bg-white/20"
                      onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    {creating ? t('account.sending') : t('account.submitRequest')}
                  </button>
                </form>
              )}
              <div className="text-sm text-white/50 mb-3">{t('account.countPcs', { n: requests.length })}</div>
              <div className="space-y-3">
              {requests.length === 0 ? (
                <div className="text-sm text-white/50">{t('account.noRequestsYet')}</div>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-white/70">
                          {t('picker.apt', { n: String(properties.find((p) => p.id === r.property_id)?.apartment_number ?? r.property_id ?? '') })} · {t('account.categoryOf', { c: labelCategory(r.category, t) })}
                        </div>
                        <div className="text-white font-medium">{r.subject}</div>
                      </div>
                      <div className="text-sm text-white/70">
                        {t('account.priority')}: <span className="text-white">{labelPriority(r.priority, t)}</span>
                        <div>
                          {t('home.tagStatus')}: <span className="text-white">{labelRequestStatus(r.status, t)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-white/80">{r.description}</div>
                    {r.photo_url && (
                      <a
                        className="mt-3 block text-sm text-cyan-200 hover:underline"
                        href={r.photo_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('account.viewPhoto')}
                      </a>
                    )}
                    <div className="mt-2 text-xs text-white/40">
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-emerald-400 mb-4">
              {t('account.announcementsTitle')}
            </h2>
            <div className="space-y-3">
              {announcements.length === 0 ? (
                <div className="text-sm text-white/50">{t('account.noAnnouncements')}</div>
              ) : (
                announcements.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
                  >
                    <h3 className="text-white font-semibold">{a.title}</h3>
                    <p className="mt-2 text-sm text-white/70 whitespace-pre-wrap">{a.body}</p>
                    <div className="mt-2 text-xs text-white/40">
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
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-semibold text-emerald-400 mb-1">{t('account.pollsTitle')}</h2>
              <p className="text-sm text-white/50 mb-4">
                {t('account.pollsLead')}
              </p>
              {polls.length === 0 ? (
                <div className="text-sm text-white/50">{t('account.noPolls')}</div>
              ) : (
                <div className="space-y-4">
                  {polls.map((poll) => {
                    const options = pollOptions
                      .filter((o) => o.poll_id === poll.id)
                      .sort((a, b) => a.sort_order - b.sort_order);
                    const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
                    const myVote = votesForPoll.find((v) => myPropertyIds.includes(v.property_id));
                    const open = isPollAcceptingVotes(poll);
                    const decision = pollDecisionLabel(
                      poll,
                      tallyPoll(options, votesForPoll, apartmentShares).accepted
                    );
                    const decisionLabel = labelPollDecision(decision, t);
                    return (
                      <div key={poll.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${pollCategoryClass(poll.category)}`}>
                            {labelPollCategory(poll.category, t)}
                          </span>
                          <span className={`text-xs ${
                            decision === 'принято' ? 'text-emerald-300' :
                            decision === 'не принято' ? 'text-red-300' : 'text-white/50'
                          }`}>
                            {decisionLabel}
                          </span>
                          {myVoteWeight > 0 && (
                            <span className="text-xs text-white/40">
                              {t('account.yourWeight', { n: myVoteWeight.toFixed(1) })}
                              {properties.length > 1 ? ` · ${t('account.aptsShort', { n: properties.length })}` : ''}
                            </span>
                          )}
                        </div>
                        <h3 className="text-white font-semibold mb-2">{poll.title}</h3>
                        <PollDetails
                          poll={poll}
                          options={options}
                          votes={votesForPoll}
                          properties={apartmentShares}
                        />
                        <div className="mt-3">
                          <PollOptionBars
                            poll={poll}
                            options={options}
                            votes={votesForPoll}
                            properties={apartmentShares}
                            myOptionId={myVote?.option_id}
                            disabled={!open || votingPollId === poll.id}
                            onVote={open ? (optionId) => handleVote(poll, optionId) : undefined}
                          />
                        </div>
                        <div className="mt-2 text-xs text-white/40">
                          {myVote ? t('account.voteSaved') : open ? t('account.notVotedYet') : ''}
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
          <div
            className="flex h-[calc(100dvh-11.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] md:h-[calc(100vh-160px)]"
          >
            {/* Шапка чата */}
            <div className="px-5 py-3 border-b border-white/10 bg-[#070b0a]/50">
              <h2 className="text-sm font-semibold text-emerald-400">
                {t('account.chatTitle')}
              </h2>
              <div className="text-xs text-white/40">
                {t('account.chatApt', { n: String(property?.apartment_number ?? ''), owner: property?.owner_name ?? '' })}
              </div>
            </div>

            {/* Лента сообщений */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-white/40">
                  {t('account.chatEmpty')}
                </div>
              ) : (
                chatMessages.map((m) => {
                  const isOwner = m.sender === 'owner';
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isOwner ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          isOwner
                            ? 'bg-emerald-500/80 text-gray-50 rounded-br-sm'
                            : 'bg-white/10 text-white rounded-bl-sm border border-white/15'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.message}</div>
                        <div
                          className={`mt-1 text-[10px] ${
                            isOwner ? 'text-emerald-100/70' : 'text-white/50'
                          }`}
                        >
                          {new Date(m.created_at).toLocaleString(dateLocale, {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {!m.read_by_owner && !isOwner && (
                            <span className="ml-2 text-cyan-400">● {t('account.newMsg')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Поле ввода */}
            <form
              onSubmit={handleSendChat}
              className="flex items-center gap-2 p-3 border-t border-white/10 bg-[#070b0a]/50"
            >
              <input
                className="flex-1 rounded-lg border border-white/10 bg-[#101816] px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-emerald-500/50"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t('account.chatPlaceholder')}
                disabled={chatSending}
              />
              <button
                type="submit"
                disabled={chatSending || !chatInput.trim()}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {chatSending ? '...' : t('common.send')}
              </button>
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
  if (!devEmail) {
    return (
      <LoginScreen
        email={emailInput}
        onEmailChange={setEmailInput}
        onSubmit={handleLogin}
      />
    );
  }

  // ===================================================================
  // ОСНОВНОЙ LAYOUT
  // ===================================================================
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
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(18rem,88vw)] flex-col border-r border-white/10 bg-[#101816] transition-transform duration-300 md:pointer-events-auto md:static md:h-auto md:w-auto md:flex-shrink-0 ${
          sidebarOpen
            ? 'translate-x-0 md:w-64'
            : 'pointer-events-none -translate-x-full md:pointer-events-auto md:w-16 md:translate-x-0'
        }`}
      >
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
            <button
              key={item.key}
              onClick={() => {
                setActiveMenu(item.key);
                if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeMenu === item.key
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent'
              }`}
              title={item.label}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              {sidebarOpen && (
                <span className="flex items-center gap-2 text-left leading-tight">
                  {item.label}
                  {item.key === 'чат' && unreadChatCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unreadChatCount}
                    </span>
                  )}
                  {item.key === 'опросы' && unansweredPollsCount > 0 && (
                    <span className="ml-auto bg-amber-500 text-gray-900 text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unansweredPollsCount}
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
              <div className="text-xs text-white/40 truncate">{devEmail}</div>
              <div className="flex gap-2">
                {isStaff && (
                  <Link
                    href="/admin"
                    className="flex-1 text-center text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-emerald-300"
                  >
                    {t('common.uk')}
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/10 px-2 text-sm hover:bg-white/10"
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
                  className="p-1.5 rounded-lg bg-emerald-500/20 text-xs"
                  title={t('account.ukManage')}
                >
                  ⚙
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/10 text-xs"
                title={t('common.logout')}
              >
                🚪
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ===== ОСНОВНОЙ КОНТЕНТ ===== */}
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
              onClick={handleLogout}
              className="min-h-10 rounded-lg border border-white/15 px-3 text-sm text-white/80 md:hidden"
            >
              {t('common.logout')}
            </button>
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <LanguageSwitcher compact />
              <Link href="/" className="text-sm text-white/50 hover:text-white/80">
                {t('common.backHome')}
              </Link>
            </div>
          </div>
        </div>

        <div className="p-3 md:p-6">
          {properties.length > 1 && (
            <ApartmentPicker
              properties={properties}
              selectedId={property?.id ?? null}
              onSelect={setSelectedPropertyId}
            />
          )}
          {loading && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-white/50">
              {t('common.loading')}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-800 bg-red-900/20 p-4 text-red-200">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-3 text-xs text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          )}

          {!loading && property && renderContent()}

          {!loading && !property && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-white/50">
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