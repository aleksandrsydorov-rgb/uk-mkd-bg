'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  BOOK_ENTITY_KINDS,
  EMPTY_PROPERTY_BOOK_LIST_FILTERS,
  OWNERSHIP_TYPES,
  canSeePropertyBookAdmin,
  collectPropertyBookFilterOptions,
  downloadPropertyBookExcelTemplate,
  filterPropertyBookListRows,
  parsePropertyBookWorkbook,
  propertyBookListFiltersActive,
  type BookEntityKind,
  type OwnershipType,
  type PropertyBookClarificationIssue,
  type PropertyBookListFilters,
  type PropertyBookListRow,
} from '@/lib/propertyBookAdmin';

function bookRowNeedsClarification(row: PropertyBookListRow): boolean {
  return (
    row.needs_clarification === true ||
    row.clarification?.needs_clarification === true ||
    (!row.book_complete && row.validation?.importable !== false)
  );
}

function bookStatusBadge(row: PropertyBookListRow, t: (k: string) => string): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (row.book_complete) return { label: t('admin.bookComplete'), tone: 'success' };
  if (bookRowNeedsClarification(row)) {
    return { label: t('admin.bookNeedsClarification'), tone: 'warning' };
  }
  return { label: t('admin.bookIncomplete'), tone: 'danger' };
}
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminFilterBar,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTabBar,
  AdminTableShell,
  AdminInfoRow,
  adminCardClass,
  adminInfoGridClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { AppFilePicker, formatAcceptHint } from '@/components/ui/AppFilePicker';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';

type CardTab = 'apartment' | 'owners' | 'ideal' | 'history';

const CARD_TABS: CardTab[] = ['apartment', 'owners', 'ideal', 'history'];

/** Map clarification / validation codes to the card tab that owns the field. */
function cardTabForIssueCode(code: string): CardTab {
  const c = code.toLowerCase();
  if (
    c.includes('object_ideal') ||
    c === 'ideal_parts_percent' ||
    c === 'ideal_parts_source' ||
    c === 'ideal_parts_note' ||
    (c.includes('ideal_parts') && !c.includes('owner_ideal'))
  ) {
    return 'ideal';
  }
  if (
    c.includes('owner') ||
    c.includes('ownership') ||
    c.includes('entity') ||
    c.includes('eik') ||
    c.includes('email') ||
    c.includes('share') ||
    c.includes('natural_name') ||
    c.includes('legal_name') ||
    c.includes('sole_trader') ||
    c.includes('mixed')
  ) {
    return 'owners';
  }
  return 'apartment';
}

const shortFieldClass = `${adminFieldClass} max-w-[12rem]`;
const midFieldClass = `${adminFieldClass} max-w-sm`;
import { AdminModal } from '@/components/admin/AdminModal';
import { StatusBadge } from '@/components/account/ownerUi';
import { buildInviteAbsoluteUrl } from '@/lib/publicAppUrl';
import {
  emailCoreCancelPb1InviteOutbox,
  emailCoreNotifyPb1Invite,
} from '@/lib/emailCoreAdapters';
import { presentPropertyBookHistoryEntry } from '@/lib/propertyBookHistory';
import { formatIdealPartsPercent, ownershipComposition } from '@/lib/propertyBook';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { normalizeFirstRunErrors, type FirstRunErrorRow } from '@/lib/firstRun';
import { presentImportReason } from '@/lib/firstRunUserMessage';
import { FirstRunErrorTable } from '@/components/admin/FirstRunSteps';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
};

type OwnerForm = {
  id?: number | null;
  entity_kind: BookEntityKind;
  first_name: string;
  middle_name: string;
  last_name: string;
  entity_name: string;
  eik_bulstat: string;
  email: string;
  phone: string;
  phone_secondary: string;
  ownership_share_percent: string;
  ideal_parts_percent: string;
};

const emptyOwner = (): OwnerForm => ({
  id: null,
  entity_kind: 'natural_person',
  first_name: '',
  middle_name: '',
  last_name: '',
  entity_name: '',
  eik_bulstat: '',
  email: '',
  phone: '',
  phone_secondary: '',
  ownership_share_percent: '100',
  ideal_parts_percent: '',
});

function mapOwnerFromRpc(o: Record<string, unknown>): OwnerForm {
  return {
    id: o.id != null ? Number(o.id) : null,
    entity_kind: String(o.entity_kind || 'natural_person') as BookEntityKind,
    first_name: String(o.first_name ?? ''),
    middle_name: String(o.middle_name ?? ''),
    last_name: String(o.last_name ?? ''),
    entity_name: String(o.entity_name ?? ''),
    eik_bulstat: String(o.eik_bulstat ?? ''),
    email: String(o.email ?? ''),
    phone: String(o.phone ?? ''),
    phone_secondary: String(o.phone_secondary ?? ''),
    ownership_share_percent:
      o.ownership_share_percent != null ? String(o.ownership_share_percent) : '',
    ideal_parts_percent: o.ideal_parts_percent != null ? String(o.ideal_parts_percent) : '',
  };
}

function aptLabel(v: string | number | null | undefined) {
  return String(v ?? '');
}

function serializeCardDraft(args: {
  apartmentNumber: string;
  floor: string;
  sectionCode: string;
  blockCode: string;
  purpose: string;
  areaSqm: string;
  idealParts: string;
  idealPartsSource: string;
  idealPartsNote: string;
  ownershipType: OwnershipType;
  owners: OwnerForm[];
}) {
  return JSON.stringify({
    apartmentNumber: args.apartmentNumber,
    floor: args.floor,
    sectionCode: args.sectionCode,
    blockCode: args.blockCode,
    purpose: args.purpose,
    areaSqm: args.areaSqm,
    idealParts: args.idealParts,
    idealPartsSource: args.idealPartsSource,
    idealPartsNote: args.idealPartsNote,
    ownershipType: args.ownershipType,
    owners: args.owners.map((o) => ({
      id: o.id ?? null,
      entity_kind: o.entity_kind,
      first_name: o.first_name,
      middle_name: o.middle_name,
      last_name: o.last_name,
      entity_name: o.entity_name,
      eik_bulstat: o.eik_bulstat,
      email: o.email,
      phone: o.phone,
      phone_secondary: o.phone_secondary,
      ownership_share_percent: o.ownership_share_percent,
      ideal_parts_percent: o.ideal_parts_percent,
    })),
  });
}

function parseCardDraft(raw: string): {
  apartmentNumber: string;
  floor: string;
  sectionCode: string;
  blockCode: string;
  purpose: string;
  areaSqm: string;
  idealParts: string;
  idealPartsSource: string;
  idealPartsNote: string;
  ownershipType: OwnershipType;
  owners: OwnerForm[];
} {
  const d = JSON.parse(raw) as {
    apartmentNumber?: string;
    floor?: string;
    sectionCode?: string;
    blockCode?: string;
    purpose?: string;
    areaSqm?: string;
    idealParts?: string;
    idealPartsSource?: string;
    idealPartsNote?: string;
    ownershipType?: OwnershipType;
    owners?: Array<Partial<OwnerForm>>;
  };
  return {
    apartmentNumber: String(d.apartmentNumber ?? ''),
    floor: String(d.floor ?? ''),
    sectionCode: String(d.sectionCode ?? ''),
    blockCode: String(d.blockCode ?? ''),
    purpose: String(d.purpose ?? ''),
    areaSqm: String(d.areaSqm ?? ''),
    idealParts: String(d.idealParts ?? ''),
    idealPartsSource: String(d.idealPartsSource ?? ''),
    idealPartsNote: String(d.idealPartsNote ?? ''),
    ownershipType: d.ownershipType === 'shared' ? 'shared' : 'sole',
    owners: (d.owners ?? []).map((o) =>
      mapOwnerFromRpc({
        ...o,
        id: o.id ?? null,
        entity_kind: o.entity_kind,
        phone_secondary: o.phone_secondary ?? '',
      }),
    ),
  };
}

function displayValue(raw: string | null | undefined, emptyLabel: string) {
  const v = String(raw ?? '').trim();
  return v || emptyLabel;
}

function ownerDisplayName(o: OwnerForm, fallback: string) {
  const name = [o.first_name, o.middle_name, o.last_name, o.entity_name]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ');
  return name || o.email.trim() || fallback;
}

export function AdminPropertyBook({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const canSee = canSeePropertyBookAdmin(staffRole);
  const [rows, setRows] = useState<PropertyBookListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOwnerComposition, setLoadedOwnerComposition] = useState<string>('empty');
  const [success, setSuccess] = useState<string | null>(null);
  const [listFilters, setListFilters] = useState<PropertyBookListFilters>(
    EMPTY_PROPERTY_BOOK_LIST_FILTERS,
  );

  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [floor, setFloor] = useState('');
  const [sectionCode, setSectionCode] = useState('');
  const [blockCode, setBlockCode] = useState('');
  const [purpose, setPurpose] = useState('');
  const [areaSqm, setAreaSqm] = useState('');
  const [idealParts, setIdealParts] = useState('');
  const [idealPartsSource, setIdealPartsSource] = useState('');
  const [idealPartsNote, setIdealPartsNote] = useState('');
  const [ownershipType, setOwnershipType] = useState<OwnershipType>('sole');
  const [owners, setOwners] = useState<OwnerForm[]>([emptyOwner()]);
  const [changeLog, setChangeLog] = useState<
    Array<{
      id: string;
      changed_at: string;
      changed_by_email: string | null;
      entity: string;
      action: string;
      changes: Record<string, unknown>;
    }>
  >([]);
  const [importErrors, setImportErrors] = useState<string | null>(null);
  const [importErrorRows, setImportErrorRows] = useState<FirstRunErrorRow[]>([]);
  const [inviteOwnerId, setInviteOwnerId] = useState<number | ''>('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [invites, setInvites] = useState<
    Array<{
      id: string;
      email: string;
      status: string;
      expires_at: string;
      created_at: string;
      registry_people_id?: number | null;
    }>
  >([]);
  const [importAllowCreate, setImportAllowCreate] = useState(false);
  const [importAllowOverwrite, setImportAllowOverwrite] = useState(false);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [massFloor, setMassFloor] = useState('');
  const [massSection, setMassSection] = useState('');
  const [massBlock, setMassBlock] = useState('');
  const [massResult, setMassResult] = useState<{
    dry_run: boolean;
    property_count: number;
    created_count: number;
    skipped_count: number;
    created: Array<{
      property_id: number;
      apartment_number: string;
      email: string;
      token?: string;
      status?: string;
    }>;
    skipped: Array<{
      property_id: number;
      apartment_number: string;
      email: string | null;
      reason: string;
    }>;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [massConfirmAll, setMassConfirmAll] = useState(false);
  const [cardBaseline, setCardBaseline] = useState<string | null>(null);
  const [cardTab, setCardTab] = useState<CardTab>('apartment');
  const [cardEditing, setCardEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const importBtnRef = useRef<HTMLButtonElement>(null);
  const inviteBtnRef = useRef<HTMLButtonElement>(null);
  const rowFocusRef = useRef<HTMLElement | null>(null);
  const aptNoRef = useRef<HTMLInputElement>(null);
  const purposeRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);
  const idealPartsRef = useRef<HTMLInputElement>(null);
  const ownershipTypeRef = useRef<HTMLSelectElement>(null);

  const massFiltersEmpty =
    !massFloor.trim() && !massSection.trim() && !massBlock.trim();
  const cardDirty =
    selectedId !== '' &&
    cardBaseline != null &&
    serializeCardDraft({
      apartmentNumber,
      floor,
      sectionCode,
      blockCode,
      purpose,
      areaSqm,
      idealParts,
      idealPartsSource,
      idealPartsNote,
      ownershipType,
      owners,
    }) !== cardBaseline;
  const importPrepared =
    importFile != null ||
    importPreview != null ||
    importErrorRows.length > 0 ||
    Boolean(importErrors);

  useEffect(() => {
    if (!cardDirty && !importPrepared) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [cardDirty, importPrepared]);

  const sortedProps = useMemo(
    () =>
      [...properties].sort(
        (a, b) => Number(a.apartment_number) - Number(b.apartment_number),
      ),
    [properties],
  );

  const filterOptions = useMemo(() => collectPropertyBookFilterOptions(rows), [rows]);
  const filtered = useMemo(
    () => filterPropertyBookListRows(rows, listFilters),
    [rows, listFilters],
  );
  const filtersActive = propertyBookListFiltersActive(listFilters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_list_property_book', {
        p_limit: 1000,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'admin_list_property_book')) {
          setRows([]);
          setError(t('admin.bookMigrationNeeded'));
          return;
        }
        throw rpcErr;
      }
      setRows((data as PropertyBookListRow[] | null) ?? []);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  async function openProperty(id: number) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_get_property_book', {
        p_property_id: id,
      });
      if (rpcErr) throw rpcErr;
      const payload = data as {
        property: {
          id: number;
          apartment_number?: number | string | null;
          floor?: number | null;
          section_code?: string | null;
          block_code?: string | null;
          purpose: string | null;
          area_sqm: number | null;
          ideal_parts_percent: number | null;
          ideal_parts_source?: string | null;
          ideal_parts_note?: string | null;
          ownership_type: string | null;
        };
        owners: Array<Record<string, unknown>>;
      };
      setSelectedId(id);
      setCardTab('apartment');
      setCardEditing(false);
      setFieldErrors({});
      setApartmentNumber(
        payload.property.apartment_number != null
          ? String(payload.property.apartment_number)
          : '',
      );
      setFloor(payload.property.floor != null ? String(payload.property.floor) : '');
      setSectionCode(payload.property.section_code ?? '');
      setBlockCode(payload.property.block_code ?? '');
      setPurpose(payload.property.purpose ?? '');
      setAreaSqm(payload.property.area_sqm != null ? String(payload.property.area_sqm) : '');
      setIdealParts(
        payload.property.ideal_parts_percent != null
          ? String(payload.property.ideal_parts_percent)
          : '',
      );
      setIdealPartsSource(payload.property.ideal_parts_source ?? '');
      setIdealPartsNote(payload.property.ideal_parts_note ?? '');
      setOwnershipType(
        payload.property.ownership_type === 'shared' ? 'shared' : 'sole',
      );
      const mapped = (payload.owners ?? []).map((o) => mapOwnerFromRpc(o as Record<string, unknown>));
      setOwners(mapped.length > 0 ? mapped : [emptyOwner()]);
      setLoadedOwnerComposition(ownershipComposition(mapped.map((o) => o.entity_kind)));
      setInviteOwnerId(mapped.find((o) => o.id != null)?.id ?? '');
      const { data: invData, error: invErr } = await supabase.rpc('admin_list_property_invites', {
        p_property_id: id,
      });
      if (!invErr) {
        setInvites(
          ((invData as Array<Record<string, unknown>>) ?? []).map((i) => ({
            id: String(i.id),
            email: String(i.email ?? ''),
            status: String(i.status ?? ''),
            expires_at: String(i.expires_at ?? ''),
            created_at: String(i.created_at ?? ''),
            registry_people_id:
              i.registry_people_id != null ? Number(i.registry_people_id) : null,
          })),
        );
      } else {
        setInvites([]);
      }
      const { data: logData, error: logErr } = await supabase.rpc('admin_list_property_change_log', {
        p_property_id: id,
        p_limit: 40,
      });
      if (!logErr && Array.isArray(logData)) {
        setChangeLog(
          (logData as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id),
            changed_at: String(row.changed_at ?? ''),
            changed_by_email: row.changed_by_email != null ? String(row.changed_by_email) : null,
            entity: String(row.entity ?? 'property'),
            action: String(row.action ?? 'update'),
            changes: (row.changes as Record<string, unknown>) ?? {},
          })),
        );
      } else {
        setChangeLog([]);
      }
      setInviteLink(null);
      const mappedForBaseline =
        mapped.length > 0 ? mapped : [emptyOwner()];
      setCardBaseline(
        serializeCardDraft({
          apartmentNumber:
            payload.property.apartment_number != null
              ? String(payload.property.apartment_number)
              : '',
          floor: payload.property.floor != null ? String(payload.property.floor) : '',
          sectionCode: payload.property.section_code ?? '',
          blockCode: payload.property.block_code ?? '',
          purpose: payload.property.purpose ?? '',
          areaSqm: payload.property.area_sqm != null ? String(payload.property.area_sqm) : '',
          idealParts:
            payload.property.ideal_parts_percent != null
              ? String(payload.property.ideal_parts_percent)
              : '',
          idealPartsSource: payload.property.ideal_parts_source ?? '',
          idealPartsNote: payload.property.ideal_parts_note ?? '',
          ownershipType:
            payload.property.ownership_type === 'shared' ? 'shared' : 'sole',
          owners: mappedForBaseline,
        }),
      );
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setBusy(false);
    }
  }

  async function createOwnerInvite(registryPeopleId: number) {
    if (!selectedId) return;
    setInviteOwnerId(registryPeopleId);
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_create_property_invite', {
        p_property_id: selectedId,
        p_registry_people_id: registryPeopleId,
      });
      if (rpcErr) throw rpcErr;
      const payload = data as {
        id?: string;
        token?: string;
        email?: string;
        email_sent?: boolean;
        delivery_status?: string;
      };
      const token = String(payload.token ?? '');
      const link = buildInviteAbsoluteUrl(token);
      setInviteLink(link);
      let honesty = String(payload.delivery_status ?? 'COPY_LINK');
      try {
        const notify = await emailCoreNotifyPb1Invite(supabase, {
          inviteId: String(payload.id ?? token),
          toEmail: String(payload.email ?? ''),
          inviteLink: link,
          apartment: apartmentNumber || null,
          locale,
        });
        honesty = notify.honesty;
      } catch {
        /* keep COPY_LINK */
      }
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        /* clipboard optional */
      }
      const linkMsg = t('admin.bookInviteLinkCopied');
      const emailMsg =
        honesty === 'ACCEPTED'
          ? t('admin.emailAcceptedByService')
          : honesty === 'QUEUED' || honesty === 'SENT'
            ? t('admin.bookInviteEmailQueued')
            : t('admin.bookInviteEmailNotSent');
      setSuccess(`${linkMsg} ${emailMsg}`);
      const { data: invData } = await supabase.rpc('admin_list_property_invites', {
        p_property_id: selectedId,
      });
      setInvites(
        ((invData as Array<Record<string, unknown>>) ?? []).map((i) => ({
          id: String(i.id),
          email: String(i.email ?? ''),
          status: String(i.status ?? ''),
          expires_at: String(i.expires_at ?? ''),
          created_at: String(i.created_at ?? ''),
          registry_people_id:
            i.registry_people_id != null ? Number(i.registry_people_id) : null,
        })),
      );
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setBusy(false);
    }
  }

  function focusCardField(field: string) {
    const map: Record<string, HTMLElement | null | undefined> = {
      apartment_number: aptNoRef.current,
      purpose: purposeRef.current,
      area_sqm: areaRef.current,
      area: areaRef.current,
      ideal_parts_percent: idealPartsRef.current,
      object_ideal_parts: idealPartsRef.current,
      ownership_type: ownershipTypeRef.current,
    };
    const el = map[field];
    if (el && typeof el.focus === 'function') {
      window.setTimeout(() => el.focus(), 0);
    }
  }

  function applyCardDraft(raw: string) {
    const d = parseCardDraft(raw);
    setApartmentNumber(d.apartmentNumber);
    setFloor(d.floor);
    setSectionCode(d.sectionCode);
    setBlockCode(d.blockCode);
    setPurpose(d.purpose);
    setAreaSqm(d.areaSqm);
    setIdealParts(d.idealParts);
    setIdealPartsSource(d.idealPartsSource);
    setIdealPartsNote(d.idealPartsNote);
    setOwnershipType(d.ownershipType);
    setOwners(d.owners.length > 0 ? d.owners : [emptyOwner()]);
  }

  async function cancelCardEdit() {
    if (cardDirty) {
      const ok = await confirm({
        title: t('common.discardChangesTitle'),
        description: t('admin.bookUnsavedClose'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (cardBaseline) applyCardDraft(cardBaseline);
    setFieldErrors({});
    setError(null);
    setCardEditing(false);
  }

  function openCardTabForCodes(codes: string[]) {
    setCardEditing(true);
    for (const code of codes) {
      const tab = cardTabForIssueCode(code);
      if (tab !== 'apartment' || codes.length === 1) {
        setCardTab(tab);
        const field =
          code.includes('area')
            ? 'area_sqm'
            : code.includes('purpose')
              ? 'purpose'
              : code.includes('object_ideal') || code === 'ideal_parts_percent'
                ? 'ideal_parts_percent'
                : code.includes('ownership_type')
                  ? 'ownership_type'
                  : code.includes('apartment')
                    ? 'apartment_number'
                    : '';
        if (field) focusCardField(field);
        return tab;
      }
    }
    setCardTab('apartment');
    return 'apartment' as CardTab;
  }

  async function saveCard() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    const nextComposition = ownershipComposition(owners.map((o) => o.entity_kind));
    if (nextComposition === 'mixed' && loadedOwnerComposition !== 'mixed') {
      setBusy(false);
      setCardEditing(true);
      setCardTab('owners');
      setError(t('admin.errMixedOwnership'));
      setFieldErrors({ ownership_type: t('admin.errMixedOwnership') });
      focusCardField('ownership_type');
      return;
    }
    try {
      const { error: objErr } = await supabase.rpc('admin_upsert_property_book_object', {
        p_property_id: selectedId,
        p_purpose: purpose,
        p_area_sqm: Number(areaSqm),
        p_ideal_parts_percent: Number(idealParts),
        p_ownership_type: ownershipType,
        p_ideal_parts_source: idealPartsSource || null,
        p_apartment_number: Number(apartmentNumber) || null,
        p_floor: Number(floor) || null,
        p_ideal_parts_note: idealPartsNote || null,
        p_ideal_parts_meeting_ref: null,
        p_section_code: sectionCode.trim() || '',
        p_block_code: blockCode.trim() || '',
      });
      if (objErr) throw objErr;

      const { data, error: ownErr } = await supabase.rpc('admin_replace_property_book_owners', {
        p_property_id: selectedId,
        p_owners: owners.map((o) => ({
          entity_kind: o.entity_kind,
          first_name: o.first_name || null,
          middle_name: o.middle_name || null,
          last_name: o.last_name || null,
          entity_name: o.entity_name || null,
          eik_bulstat: o.eik_bulstat || null,
          email: o.email || null,
          phone: o.phone || null,
          phone_secondary: o.phone_secondary || null,
          ownership_share_percent: o.ownership_share_percent,
          ideal_parts_percent: o.ideal_parts_percent,
        })),
      });
      if (ownErr) throw ownErr;
      const payload = data as {
        validation?: { ok?: boolean; errors?: string[] };
        owners?: Array<Record<string, unknown>>;
      };
      const validation = payload?.validation;
      if (Array.isArray(payload.owners)) {
        const mapped = payload.owners.map((o) => mapOwnerFromRpc(o));
        setOwners(mapped.length > 0 ? mapped : [emptyOwner()]);
        setLoadedOwnerComposition(ownershipComposition(mapped.map((o) => o.entity_kind)));
        setInviteOwnerId(mapped.find((o) => o.id != null)?.id ?? '');
      }
      if (validation && validation.ok === false) {
        setSuccess(null);
        const codes = (validation.errors ?? []).map((code) => String(code));
        const reasons = codes.map((code) => presentImportReason(code, t)).filter(Boolean);
        setError(
          reasons.length
            ? `${t('admin.bookSavedIncomplete')}: ${Array.from(new Set(reasons)).join('; ')}`
            : t('admin.bookSavedIncomplete'),
        );
        const nextErrors: Partial<Record<string, string>> = {};
        for (const code of codes) {
          const msg = presentImportReason(code, t) || code;
          if (code.includes('area')) nextErrors.area_sqm = msg;
          else if (code.includes('purpose')) nextErrors.purpose = msg;
          else if (code.includes('object_ideal') || code === 'ideal_parts_percent') {
            nextErrors.ideal_parts_percent = msg;
          } else if (code.includes('ownership_type')) nextErrors.ownership_type = msg;
        }
        setFieldErrors(nextErrors);
        openCardTabForCodes(codes.length > 0 ? codes : ['owners_required']);
      } else {
        setSuccess(t('admin.bookSaved'));
        setFieldErrors({});
        setCardEditing(false);
      }
      await load();
      const { data: logData } = await supabase.rpc('admin_list_property_change_log', {
        p_property_id: selectedId,
        p_limit: 40,
      });
      if (Array.isArray(logData)) {
        setChangeLog(
          (logData as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id),
            changed_at: String(row.changed_at ?? ''),
            changed_by_email: row.changed_by_email != null ? String(row.changed_by_email) : null,
            entity: String(row.entity ?? 'property'),
            action: String(row.action ?? 'update'),
            changes: (row.changes as Record<string, unknown>) ?? {},
          })),
        );
      }
      setCardBaseline(
        serializeCardDraft({
          apartmentNumber,
          floor,
          sectionCode,
          blockCode,
          purpose,
          areaSqm,
          idealParts,
          idealPartsSource,
          idealPartsNote,
          ownershipType,
          owners: Array.isArray(payload.owners)
            ? (payload.owners as Array<Record<string, unknown>>).map((o) => mapOwnerFromRpc(o))
            : owners,
        }),
      );
    } catch (e: unknown) {
      const msg = ownerVisibleError(e, t('admin.errGeneric'), t);
      setError(msg);
      const lower = msg.toLowerCase();
      const codes: string[] = [];
      if (lower.includes('mixed') || lower.includes('смеш')) codes.push('mixed_ownership');
      if (lower.includes('area') || lower.includes('площад') || lower.includes('площ')) {
        codes.push('area_required');
      }
      if (lower.includes('ideal') || lower.includes('идеал')) codes.push('object_ideal_parts_required');
      if (lower.includes('owner') || lower.includes('собствен') || lower.includes('собств')) {
        codes.push('owners_required');
      }
      if (codes.length > 0) openCardTabForCodes(codes);
    } finally {
      setBusy(false);
    }
  }

  async function requestCloseCard() {
    if (cardDirty) {
      const ok = await confirm({
        title: t('common.discardChangesTitle'),
        description: t('admin.bookUnsavedClose'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setSelectedId('');
    setCardBaseline(null);
    setCardTab('apartment');
    setCardEditing(false);
    setFieldErrors({});
    setInviteLink(null);
    setChangeLog([]);
    setInvites([]);
  }

  async function requestCloseImport() {
    if (importPrepared) {
      const ok = await confirm({
        title: t('common.discardChangesTitle'),
        description: t('admin.bookImportDiscardClose'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setImportOpen(false);
    setImportFile(null);
    setImportPreview(null);
    setImportErrors(null);
    setImportErrorRows([]);
  }

  function requestCloseInvite() {
    setInviteOpen(false);
  }

  function ensureMassScopeAllowed(): boolean {
    if (!massFiltersEmpty) return true;
    if (massConfirmAll) return true;
    setError(t('admin.bookMassInviteNeedConfirmAll'));
    return false;
  }

  async function runMassInvite(dryRun: boolean) {
    if (!ensureMassScopeAllowed()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_mass_create_property_invites', {
        p_floor: massFloor.trim() ? Number(massFloor) : null,
        p_section_code: massSection.trim() || null,
        p_block_code: massBlock.trim() || null,
        p_dry_run: dryRun,
        p_skip_existing: true,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'admin_mass_create_property_invites')) {
          setError(t('admin.bookMigrationNeeded'));
          return;
        }
        throw rpcErr;
      }
      const result = data as {
        dry_run: boolean;
        property_count: number;
        created_count: number;
        skipped_count: number;
        created: Array<{
          property_id: number;
          apartment_number: string;
          email: string;
          token?: string;
          status?: string;
        }>;
        skipped: Array<{
          property_id: number;
          apartment_number: string;
          email: string | null;
          reason: string;
        }>;
      };
      setMassResult(result);
      if (dryRun) {
        setSuccess(
          t('admin.bookMassInvitePreview', {
            n: String(result.created_count ?? 0),
            p: String(result.property_count ?? 0),
          }),
        );
      } else {
        const links = (result.created ?? [])
          .filter((c) => c.token)
          .map(
            (c) =>
              `${c.apartment_number}\t${c.email}\t${buildInviteAbsoluteUrl(String(c.token))}`,
          )
          .join('\n');
        if (links) {
          try {
            await navigator.clipboard.writeText(links);
            setSuccess(t('admin.bookMassInviteCopied', { n: String(result.created_count ?? 0) }));
          } catch {
            setSuccess(t('admin.bookMassInviteDone', { n: String(result.created_count ?? 0) }));
          }
        } else {
          setSuccess(t('admin.bookMassInviteDone', { n: String(result.created_count ?? 0) }));
        }
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(file: File, dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setImportErrors(null);
    setImportErrorRows([]);
    // Keep prepared file; only clear preview/errors before a new check/apply.
    setImportPreview(null);
    try {
      const { objects: objectRows, owners: ownerRows } = await parsePropertyBookWorkbook(file);
      if (objectRows.length === 0) throw new Error(t('admin.bookExcelEmptyObjects'));
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: objectRows,
        p_owners: ownerRows,
        p_dry_run: dryRun,
        p_allow_create_missing: importAllowCreate,
        p_allow_overwrite: importAllowOverwrite,
      });
      if (rpcErr) throw rpcErr;
      const result = data as {
        ok: boolean;
        dry_run: boolean;
        errors: unknown[];
        warnings?: unknown[];
        complete_count?: number;
        importable_count?: number;
        clarification_count?: number;
        blocking_error_count?: number;
        existing_properties?: unknown[];
        new_properties?: unknown[];
        changes?: unknown[];
        duplicates?: unknown[];
        requires_create_confirmation?: boolean;
        requires_overwrite_confirmation?: boolean;
      };
      const errors = Array.isArray(result.errors) ? result.errors : [];
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const blocking = Number(result.blocking_error_count ?? errors.length) || 0;
      const clarify = Number(result.clarification_count ?? warnings.length) || 0;
      const importable = Number(result.importable_count ?? 0) || 0;
      const mixed = errors.some((e) => {
        const r = e && typeof e === 'object' ? (e as { code?: unknown; reason?: unknown }) : null;
        return r?.code === 'mixed_natural_legal_forbidden' || r?.reason === 'mixed_natural_legal_forbidden';
      });
      setImportErrorRows(normalizeFirstRunErrors([...errors, ...warnings]));
      setImportPreview(
        t('admin.bookImportDryOkDetailed', {
          importable: String(importable),
          clarify: String(clarify),
          blocking: String(blocking),
        }),
      );
      if (!result.ok) {
        setImportErrors(mixed ? t('admin.errMixedOwnership') : t('admin.bookImportHasErrors'));
        setError(mixed ? t('admin.errMixedOwnership') : t('admin.bookImportHasErrors'));
      } else if (dryRun) {
        setSuccess(
          t('admin.bookImportDryOkDetailed', {
            importable: String(result.importable_count ?? 0),
            clarify: String(result.clarification_count ?? 0),
            blocking: String(result.blocking_error_count ?? 0),
          }),
        );
      } else {
        setSuccess(
          t('admin.bookImportAppliedDetailed', {
            n: String(result.importable_count ?? result.complete_count ?? 0),
            clarify: String(result.clarification_count ?? 0),
          }),
        );
        await load();
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.book')} secondary={t('admin.bookLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dialog}
      <AdminPageHeader title={t('admin.book')} secondary={t('admin.bookLead')} />
      {error && !importOpen && !inviteOpen && !selectedId ? (
        <AdminInlineAlert tone="danger">{error}</AdminInlineAlert>
      ) : null}
      {success && !importOpen && !inviteOpen && !selectedId ? (
        <AdminInlineAlert tone="success">{success}</AdminInlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <AdminSecondaryButton
          ref={importBtnRef}
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setImportOpen(true);
          }}
        >
          {t('admin.bookImport')}
        </AdminSecondaryButton>
        <AdminSecondaryButton
          ref={inviteBtnRef}
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setMassResult(null);
            setMassConfirmAll(false);
            setInviteOpen(true);
          }}
        >
          {t('admin.bookCabinetInvites')}
        </AdminSecondaryButton>
        <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
          {t('admin.secRefresh')}
        </AdminSecondaryButton>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">{t('admin.bookList')}</h3>

        <AdminFilterBar>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1 text-xs text-secondary">
              {t('admin.status')}
              <select
                className={adminFieldClass}
                value={listFilters.completeness}
                onChange={(e) =>
                  setListFilters((prev) => ({
                    ...prev,
                    completeness: e.target.value as PropertyBookListFilters['completeness'],
                  }))
                }
              >
                <option value="all">{t('admin.bookFilterAll')}</option>
                <option value="complete">{t('admin.bookFilterComplete')}</option>
                <option value="incomplete">{t('admin.bookFilterIncomplete')}</option>
                <option value="needs_clarification">{t('admin.bookFilterNeedsClarification')}</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-secondary">
              {t('admin.bookBlock')}
              <select
                className={adminFieldClass}
                value={listFilters.block}
                onChange={(e) => setListFilters((prev) => ({ ...prev, block: e.target.value }))}
              >
                <option value="">{t('admin.bookFilterAll')}</option>
                {filterOptions.blocks.map((block) => (
                  <option key={block} value={block}>
                    {block}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-secondary">
              {t('admin.bookSection')}
              <select
                className={adminFieldClass}
                value={listFilters.section}
                onChange={(e) => setListFilters((prev) => ({ ...prev, section: e.target.value }))}
              >
                <option value="">{t('admin.bookFilterAll')}</option>
                {filterOptions.sections.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-secondary">
              {t('admin.phFloor')}
              <select
                className={adminFieldClass}
                value={listFilters.floor}
                onChange={(e) => setListFilters((prev) => ({ ...prev, floor: e.target.value }))}
              >
                <option value="">{t('admin.bookFilterAll')}</option>
                {filterOptions.floors.map((floorOption) => (
                  <option key={floorOption} value={floorOption}>
                    {floorOption}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-secondary">
              {t('admin.apartments')}
              <input
                className={adminFieldClass}
                value={listFilters.apartmentQuery}
                placeholder={t('admin.bookFilterAptPh')}
                onChange={(e) =>
                  setListFilters((prev) => ({ ...prev, apartmentQuery: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {t('admin.bookFilterCount', {
                shown: String(filtered.length),
                total: String(rows.length),
              })}
            </p>
            <AdminSecondaryButton
              type="button"
              className="min-h-9 px-3 text-sm"
              disabled={!filtersActive}
              onClick={() => setListFilters(EMPTY_PROPERTY_BOOK_LIST_FILTERS)}
            >
              {t('common.resetFilters')}
            </AdminSecondaryButton>
          </div>
        </AdminFilterBar>

        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <AdminEmptyState title={t('admin.bookEmpty')} />
        ) : (
          <>
            <div className="space-y-1.5 md:hidden">
              {filtered.map((row) => {
                const active = selectedId === row.property_id;
                return (
                  <button
                    key={row.property_id}
                    type="button"
                    disabled={busy}
                    data-book-row={row.property_id}
                    onClick={(e) => {
                      rowFocusRef.current = e.currentTarget;
                      void openProperty(row.property_id);
                    }}
                    className={`${adminCardClass} w-full px-3 py-2.5 text-left ${
                      active ? 'border-accent/40 ring-1 ring-accent/25' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          № {row.apartment_number}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {[
                            row.block_code,
                            row.section_code,
                            row.floor != null ? `${t('common.floor')} ${row.floor}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </p>
                        {row.owner_phone?.trim() ? (
                          <p className="truncate text-xs text-muted">
                            {t('admin.phPhonePrimary')}: {row.owner_phone}
                          </p>
                        ) : null}
                        {row.owner_phone_secondary?.trim() ? (
                          <p className="truncate text-xs text-muted">
                            {t('admin.phPhoneSecondary')}: {row.owner_phone_secondary}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge
                        label={bookStatusBadge(row, t).label}
                        tone={bookStatusBadge(row, t).tone}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <AdminTableShell className="hidden md:block">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                    <th className={adminTableCellClass}>{t('admin.bookBlock')}</th>
                    <th className={adminTableCellClass}>{t('admin.bookSection')}</th>
                    <th className={adminTableCellClass}>{t('admin.phFloor')}</th>
                    <th className={adminTableCellClass}>{t('admin.bookOwnershipType')}</th>
                    <th className={adminTableCellClass}>{t('admin.bookOwners')}</th>
                    <th className={adminTableCellClass}>{t('admin.phPhonePrimary')}</th>
                    <th className={adminTableCellClass}>{t('admin.phPhoneSecondary')}</th>
                    <th className={adminTableCellClass}>{t('admin.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const active = selectedId === row.property_id;
                    return (
                      <tr
                        key={row.property_id}
                        tabIndex={0}
                        data-book-row={row.property_id}
                        className={`${adminTableRowClass} cursor-pointer ${
                          active ? 'bg-accent-bg/60' : ''
                        }`}
                        onClick={(e) => {
                          if (busy) return;
                          rowFocusRef.current = e.currentTarget;
                          void openProperty(row.property_id);
                        }}
                        onKeyDown={(e) => {
                          if (busy) return;
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          rowFocusRef.current = e.currentTarget;
                          void openProperty(row.property_id);
                        }}
                      >
                        <td className={`${adminTableCellClass} font-semibold text-foreground`}>
                          № {row.apartment_number}
                        </td>
                        <td className={adminTableCellClass}>{row.block_code || '—'}</td>
                        <td className={adminTableCellClass}>{row.section_code || '—'}</td>
                        <td className={adminTableCellClass}>
                          {row.floor != null ? String(row.floor) : '—'}
                        </td>
                        <td className={adminTableCellClass}>
                          {row.ownership_type
                            ? t(`admin.bookType_${row.ownership_type}`)
                            : '—'}
                        </td>
                        <td className={adminTableCellClass}>{row.owner_count}</td>
                        <td className={adminTableCellClass}>
                          {row.owner_phone?.trim() || '—'}
                        </td>
                        <td className={adminTableCellClass}>
                          {row.owner_phone_secondary?.trim() || '—'}
                        </td>
                        <td className={adminTableCellClass}>
                          <StatusBadge
                            label={bookStatusBadge(row, t).label}
                            tone={bookStatusBadge(row, t).tone}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableShell>
          </>
        )}
      </section>

      <AdminModal
        open={importOpen}
        title={t('admin.bookImport')}
        size="xl"
        closeLabel={t('common.close')}
        returnFocusRef={importBtnRef}
        onRequestClose={requestCloseImport}
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <AdminSecondaryButton type="button" disabled={busy} onClick={requestCloseImport}>
              {t('common.close')}
            </AdminSecondaryButton>
            <AdminSecondaryButton
              type="button"
              disabled={busy || !importFile}
              onClick={() => {
                if (!importFile) {
                  setError(t('admin.bookFileRequired'));
                  return;
                }
                void runImport(importFile, true);
              }}
            >
              {t('admin.bookCheck')}
            </AdminSecondaryButton>
            <AdminPrimaryButton
              type="button"
              disabled={busy || !importFile}
              onClick={() => {
                if (!importFile) {
                  setError(t('admin.bookFileRequired'));
                  return;
                }
                void runImport(importFile, false);
              }}
            >
              {t('admin.bookApplyImport')}
            </AdminPrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-secondary">{t('admin.bookImportHint')}</p>
          {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
          {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}
          <AdminSecondaryButton
            type="button"
            onClick={() => downloadPropertyBookExcelTemplate(locale)}
          >
            {t('admin.bookTplExcel')}
          </AdminSecondaryButton>
          <AppFilePicker
            label={t('admin.bookFileExcel')}
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            files={importFile ? [importFile] : []}
            hint={t('common.fileHintFormats', {
              formats: formatAcceptHint('.xlsx,.xls'),
            })}
            onChange={(picked) => {
              const f = picked[0] ?? null;
              setImportFile(f);
              setImportPreview(null);
              setImportErrors(null);
              setImportErrorRows([]);
            }}
          />
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={importAllowCreate}
              onChange={(e) => setImportAllowCreate(e.target.checked)}
            />
            {t('admin.bookImportAllowCreate')}
          </label>
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={importAllowOverwrite}
              onChange={(e) => setImportAllowOverwrite(e.target.checked)}
            />
            {t('admin.bookImportAllowOverwrite')}
          </label>
          {importPreview ? (
            <p className="whitespace-pre-wrap rounded-lg bg-background p-3 text-xs text-secondary">
              {importPreview}
            </p>
          ) : null}
          {importErrors ? <AdminInlineAlert tone="danger">{importErrors}</AdminInlineAlert> : null}
          {importErrorRows.length > 0 ? <FirstRunErrorTable rows={importErrorRows} t={t} /> : null}
        </div>
      </AdminModal>

      <AdminModal
        open={inviteOpen}
        title={t('admin.bookCabinetInvites')}
        size="lg"
        closeLabel={t('common.close')}
        returnFocusRef={inviteBtnRef}
        onRequestClose={requestCloseInvite}
        onClose={requestCloseInvite}
        footer={
          <>
            <AdminSecondaryButton type="button" disabled={busy} onClick={requestCloseInvite}>
              {t('common.close')}
            </AdminSecondaryButton>
            <AdminSecondaryButton
              type="button"
              disabled={busy}
              onClick={() => void runMassInvite(true)}
            >
              {t('admin.bookMassInvitePreviewBtn')}
            </AdminSecondaryButton>
            <AdminPrimaryButton
              type="button"
              disabled={busy || !massResult || massResult.created_count < 1}
              onClick={() => {
                void (async () => {
                  if (!massResult?.dry_run) {
                    setError(t('admin.bookMassInvitePreviewFirst'));
                    return;
                  }
                  const ok = await confirm({
                    title: t('common.confirmAction'),
                    description: t('admin.bookMassInviteConfirm'),
                    confirmLabel: t('admin.bookMassInviteSend'),
                    cancelLabel: t('common.cancel'),
                    tone: 'default',
                  });
                  if (!ok) return;
                  void runMassInvite(false);
                })();
              }}
            >
              {t('admin.bookMassInviteSend')}
            </AdminPrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-secondary">{t('admin.bookMassInviteHint')}</p>
          {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
          {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookSection')}
              <input
                className={adminFieldClass}
                placeholder={t('admin.bookSectionPh')}
                value={massSection}
                onChange={(e) => {
                  setMassSection(e.target.value);
                  setMassResult(null);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookBlock')}
              <input
                className={adminFieldClass}
                placeholder={t('admin.bookBlockPh')}
                value={massBlock}
                onChange={(e) => {
                  setMassBlock(e.target.value);
                  setMassResult(null);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.phFloor')}
              <input
                className={adminFieldClass}
                type="number"
                placeholder={t('admin.bookMassFloorPh')}
                value={massFloor}
                onChange={(e) => {
                  setMassFloor(e.target.value);
                  setMassResult(null);
                }}
              />
            </label>
          </div>
          {massFiltersEmpty ? (
            <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <p className="text-xs text-secondary">{t('admin.bookMassInviteEmptyFilter')}</p>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={massConfirmAll}
                  onChange={(e) => setMassConfirmAll(e.target.checked)}
                />
                <span>{t('admin.bookMassInviteConfirmAll')}</span>
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('admin.bookMassInviteScopedHint')}</p>
          )}
          {massResult ? (
            <div className="space-y-2 text-xs">
              <p className="text-sm font-medium text-foreground">
                {t('admin.bookMassInviteStats', {
                  p: String(massResult.property_count),
                  c: String(massResult.created_count),
                  s: String(massResult.skipped_count),
                })}
              </p>
              <p className="text-secondary">
                {t('admin.bookMassInviteRecipients', {
                  n: String(massResult.created_count),
                })}
              </p>
              {massResult.created.length > 0 ? (
                <AdminTableShell>
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                        <th className={adminTableCellClass}>{t('login.emailLabel')}</th>
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {massResult.created.slice(0, 40).map((row, idx) => (
                        <tr
                          key={`${row.property_id}-${row.email}-${idx}`}
                          className={adminTableRowClass}
                        >
                          <td className={adminTableCellClass}>{row.apartment_number}</td>
                          <td className={adminTableCellClass}>{row.email}</td>
                          <td className={adminTableCellClass}>
                            {massResult.dry_run
                              ? t('admin.bookMassInviteWould')
                              : t('admin.bookInviteStatus_pending')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              ) : null}
              {massResult.skipped.length > 0 ? (
                <p className="text-muted">
                  {t('admin.bookMassInviteSkipped')}:{' '}
                  {massResult.skipped
                    .slice(0, 12)
                    .map(
                      (s) =>
                        `${s.apartment_number}${s.email ? ` (${s.email})` : ''} — ${s.reason}`,
                    )
                    .join('; ')}
                  {massResult.skipped.length > 12 ? '…' : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">{t('admin.bookMassInvitePreviewHint')}</p>
          )}
        </div>
      </AdminModal>

            <AdminModal
        open={Boolean(selectedId)}
        title={t('admin.bookAptTitle', {
          n: aptLabel(
            apartmentNumber ||
              sortedProps.find((p) => p.id === selectedId)?.apartment_number ||
              rows.find((r) => r.property_id === selectedId)?.apartment_number,
          ),
        })}
        size="2xl"
        closeLabel={t('common.close')}
        returnFocusRef={rowFocusRef}
        onRequestClose={requestCloseCard}
        onClose={requestCloseCard}
        titleMeta={(() => {
          const selectedRow = rows.find((r) => r.property_id === selectedId);
          const badge = selectedRow ? bookStatusBadge(selectedRow, t) : null;
          const metaParts: string[] = [];
          if (areaSqm.trim()) metaParts.push(`${areaSqm.trim()} ${t('common.sqm')}`);
          if (floor.trim()) metaParts.push(`${floor.trim()} ${t('common.floor')}`);
          if (sectionCode.trim()) metaParts.push(`${t('admin.bookSection')}: ${sectionCode.trim()}`);
          if (blockCode.trim()) metaParts.push(`${t('admin.bookBlock')}: ${blockCode.trim()}`);
          return (
            <>
              {metaParts.length > 0 ? <span>{metaParts.join(' · ')}</span> : null}
              {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
            </>
          );
        })()}
        headerActions={
          !cardEditing ? (
            <AdminSecondaryButton type="button" disabled={busy} onClick={() => setCardEditing(true)}>
              {t('common.edit')}
            </AdminSecondaryButton>
          ) : null
        }
        subheader={(() => {
          const selectedRow = rows.find((r) => r.property_id === selectedId);
          const issues = (selectedRow?.clarification?.issues ??
            []) as PropertyBookClarificationIssue[];
          const showIssues =
            selectedRow && bookRowNeedsClarification(selectedRow) && issues.length > 0;
          const badgeFor = (tab: CardTab) =>
            Boolean(
              showIssues &&
                issues.some((i) => cardTabForIssueCode(String(i.code ?? i.field ?? '')) === tab),
            );
          return (
            <AdminTabBar
              active={cardTab}
              onChange={(id) => setCardTab(id as CardTab)}
              tabs={CARD_TABS.map((id) => ({
                id,
                label: t(`admin.bookCardTab_${id}`),
                badge: badgeFor(id),
                badgeLabel: badgeFor(id)
                  ? `${t(`admin.bookCardTab_${id}`)} — ${t('admin.bookNeedsClarification')}`
                  : undefined,
              }))}
            />
          );
        })()}
        footer={
          cardEditing ? (
            <>
              <p className={`min-w-0 flex-1 text-xs ${cardDirty ? 'text-warning' : 'text-muted'}`}>
                {cardDirty ? t('admin.bookUnsavedChanges') : t('admin.bookNoUnsavedChanges')}
              </p>
              <div className="flex flex-wrap gap-2">
                <AdminSecondaryButton type="button" disabled={busy} onClick={() => void cancelCardEdit()}>
                  {t('common.cancel')}
                </AdminSecondaryButton>
                <AdminPrimaryButton type="button" disabled={busy} onClick={() => void saveCard()}>
                  {busy ? t('common.saving') : t('common.save')}
                </AdminPrimaryButton>
              </div>
            </>
          ) : (
            <div className="flex w-full justify-end">
              <AdminSecondaryButton type="button" disabled={busy} onClick={requestCloseCard}>
                {t('common.close')}
              </AdminSecondaryButton>
            </div>
          )
        }
      >
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
          {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}
          {(() => {
            const selectedRow = rows.find((r) => r.property_id === selectedId);
            const issues = (selectedRow?.clarification?.issues ??
              []) as PropertyBookClarificationIssue[];
            if (!selectedRow || !bookRowNeedsClarification(selectedRow) || issues.length === 0) {
              return null;
            }
            const tabIssues = issues.filter(
              (i) => cardTabForIssueCode(String(i.code ?? i.field ?? '')) === cardTab,
            );
            if (tabIssues.length === 0) return null;
            const missingCodes = tabIssues
              .map((i) => String(i.code ?? i.field ?? ''))
              .filter(Boolean);
            const requestText = [
              t('admin.bookClarificationRequestTitle', {
                n: String(selectedRow.apartment_number ?? ''),
              }),
              ...tabIssues.map((i) => {
                const who = i.label ? `${i.label}: ` : '';
                const code = String(i.code ?? 'unknown');
                const labelKey = `admin.bookIssue_${code}`;
                const label = t(labelKey);
                return `• ${who}${label === labelKey ? code : label}`;
              }),
            ].join('\n');
            return (
              <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-3">
                <p className="text-sm font-semibold text-foreground">
                  {t('admin.bookNeedsClarification')}
                </p>
                <ul className="space-y-1 text-xs text-secondary">
                  {tabIssues.map((issue, idx) => {
                    const code = String(issue.code ?? 'unknown');
                    const labelKey = `admin.bookIssue_${code}`;
                    const label = t(labelKey);
                    return (
                      <li key={`${issue.code}-${issue.registry_people_id ?? idx}-${issue.field}`}>
                        {issue.label ? `${issue.label}: ` : ''}
                        {label === labelKey ? code : label}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <AdminSecondaryButton
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(requestText);
                        if (typeof selectedId !== 'number') return;
                        const { error: rpcErr } = await supabase.rpc(
                          'admin_record_property_book_clarification_request',
                          {
                            p_property_id: selectedId,
                            p_channel: 'manual_copy',
                            p_message_text: requestText,
                            p_missing_codes: missingCodes,
                          },
                        );
                        if (
                          rpcErr &&
                          !isMissingRelation(rpcErr, 'admin_record_property_book_clarification_request')
                        ) {
                          throw rpcErr;
                        }
                        setSuccess(t('admin.bookClarificationCopied'));
                      } catch (e: unknown) {
                        setError(ownerVisibleError(e, t('admin.errGeneric'), t));
                      }
                    }}
                  >
                    {t('admin.bookClarificationCopyRequest')}
                  </AdminSecondaryButton>
                </div>
                {cardTab === 'owners' && owners.some((o) => o.id != null && !o.email.trim()) ? (
                  <p className="text-xs text-muted">{t('admin.bookEmailNotSet')}</p>
                ) : null}
              </div>
            );
          })()}

          {cardTab === 'apartment' ? (
            cardEditing ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.phAptNo')}
                  <input
                    ref={aptNoRef}
                    className={shortFieldClass}
                    type="number"
                    value={apartmentNumber}
                    onChange={(e) => setApartmentNumber(e.target.value)}
                  />
                  {fieldErrors.apartment_number ? (
                    <span className="text-xs text-danger">{fieldErrors.apartment_number}</span>
                  ) : null}
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.phFloor')}
                  <input
                    className={shortFieldClass}
                    type="number"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.bookSection')}
                  <input
                    className={shortFieldClass}
                    value={sectionCode}
                    onChange={(e) => setSectionCode(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.bookBlock')}
                  <input
                    className={shortFieldClass}
                    value={blockCode}
                    onChange={(e) => setBlockCode(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.bookPurpose')}
                  <input
                    ref={purposeRef}
                    className={midFieldClass}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                  {fieldErrors.purpose ? (
                    <span className="text-xs text-danger">{fieldErrors.purpose}</span>
                  ) : null}
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.bookArea')}
                  <span className="text-xs text-muted">{t('admin.bookAreaHint')}</span>
                  <input
                    ref={areaRef}
                    className={shortFieldClass}
                    value={areaSqm}
                    onChange={(e) => setAreaSqm(e.target.value)}
                  />
                  {fieldErrors.area_sqm ? (
                    <span className="text-xs text-danger">{fieldErrors.area_sqm}</span>
                  ) : null}
                </label>
              </div>
            ) : (
              <div className={`${adminInfoGridClass} text-sm`}>
                <AdminInfoRow
                  label={t('admin.phAptNo')}
                  value={displayValue(apartmentNumber, t('book.notSpecified'))}
                />
                <AdminInfoRow
                  label={t('admin.phFloor')}
                  value={displayValue(floor, t('book.notSpecified'))}
                />
                <AdminInfoRow
                  label={t('admin.bookSection')}
                  value={displayValue(sectionCode, t('book.notSpecified'))}
                />
                <AdminInfoRow
                  label={t('admin.bookBlock')}
                  value={displayValue(blockCode, t('book.notSpecified'))}
                />
                <AdminInfoRow
                  label={t('admin.bookPurpose')}
                  value={displayValue(purpose, t('book.notSpecified'))}
                />
                <AdminInfoRow
                  label={t('admin.bookArea')}
                  value={
                    areaSqm.trim()
                      ? `${areaSqm.trim()} ${t('common.sqm')}`
                      : t('book.notSpecified')
                  }
                />
              </div>
            )
          ) : null}

          {cardTab === 'owners' ? (
            <div className="space-y-4">
              {cardEditing ? (
                <label className="grid max-w-sm gap-1 text-sm text-secondary">
                  {t('admin.bookOwnershipType')}
                  <select
                    ref={ownershipTypeRef}
                    className={adminFieldClass}
                    value={ownershipType}
                    onChange={(e) => setOwnershipType(e.target.value as OwnershipType)}
                  >
                    {OWNERSHIP_TYPES.map((ot) => (
                      <option key={ot} value={ot}>
                        {t(`admin.bookType_${ot}`)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.ownership_type ? (
                    <span className="text-xs text-danger">{fieldErrors.ownership_type}</span>
                  ) : null}
                </label>
              ) : (
                <div className={`${adminInfoGridClass} text-sm`}>
                  <AdminInfoRow
                    label={t('admin.bookOwnershipType')}
                    value={t(`admin.bookType_${ownershipType}`)}
                  />
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{t('admin.bookOwners')}</h4>
                  {cardEditing ? (
                    <AdminSecondaryButton
                      type="button"
                      onClick={() => setOwners((prev) => [...prev, emptyOwner()])}
                    >
                      {t('admin.bookAddOwner')}
                    </AdminSecondaryButton>
                  ) : null}
                </div>
                {owners.map((owner, idx) => {
                  const empty = t('book.notSpecified');
                  const title = ownerDisplayName(owner, `${t('admin.bookOwners')} ${idx + 1}`);
                  const shareFmt =
                    formatIdealPartsPercent(owner.ownership_share_percent, locale) ??
                    displayValue(owner.ownership_share_percent, empty);
                  const idealFmt =
                    formatIdealPartsPercent(owner.ideal_parts_percent, locale) ??
                    displayValue(owner.ideal_parts_percent, empty);
                  if (!cardEditing) {
                    return (
                      <div key={owner.id ?? idx} className={`${adminCardClass} space-y-2 p-5`}>
                        <p className="min-w-0 break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                          {title}
                        </p>
                        <div className={adminInfoGridClass}>
                          <AdminInfoRow
                            label={t('admin.bookEntityKind')}
                            value={t(`admin.bookEntity_${owner.entity_kind}`)}
                          />
                          <AdminInfoRow label={t('login.emailLabel')} value={displayValue(owner.email, empty)} />
                          <AdminInfoRow
                            label={t('admin.phPhonePrimary')}
                            value={displayValue(owner.phone, empty)}
                          />
                          <AdminInfoRow
                            label={t('admin.phPhoneSecondary')}
                            value={displayValue(owner.phone_secondary, empty)}
                          />
                          <AdminInfoRow
                            label={t('admin.bookShare')}
                            value={
                              owner.ownership_share_percent.trim()
                                ? `${shareFmt} %`
                                : empty
                            }
                          />
                          <AdminInfoRow
                            label={t('admin.bookOwnerIdeal')}
                            value={
                              owner.ideal_parts_percent.trim() ? `${idealFmt} %` : empty
                            }
                          />
                          {owner.entity_kind === 'legal_entity' ||
                          owner.entity_kind === 'sole_trader' ? (
                            <>
                              <AdminInfoRow
                                label={t('admin.bookEntityName')}
                                value={displayValue(owner.entity_name, empty)}
                                className="md:col-span-2"
                              />
                              <AdminInfoRow
                                label={t('admin.bookEik')}
                                value={displayValue(owner.eik_bulstat, empty)}
                              />
                            </>
                          ) : null}
                          {owner.entity_kind !== 'legal_entity' ? (
                            <>
                              <AdminInfoRow
                                label={t('admin.bookFirstName')}
                                value={displayValue(owner.first_name, empty)}
                              />
                              <AdminInfoRow
                                label={t('admin.bookLastName')}
                                value={displayValue(owner.last_name, empty)}
                              />
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={owner.id ?? idx} className="space-y-2 rounded-xl border border-border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('admin.bookEntityKind')}
                          <select
                            className={adminFieldClass}
                            value={owner.entity_kind}
                            onChange={(e) => {
                              const v = e.target.value as BookEntityKind;
                              setOwners((prev) =>
                                prev.map((o, i) => (i === idx ? { ...o, entity_kind: v } : o)),
                              );
                            }}
                          >
                            {BOOK_ENTITY_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {t(`admin.bookEntity_${k}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('login.emailLabel')}
                          <input
                            className={adminFieldClass}
                            value={owner.email}
                            onChange={(e) =>
                              setOwners((prev) =>
                                prev.map((o, i) => (i === idx ? { ...o, email: e.target.value } : o)),
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('admin.phPhonePrimary')}
                          <input
                            className={adminFieldClass}
                            value={owner.phone}
                            onChange={(e) =>
                              setOwners((prev) =>
                                prev.map((o, i) => (i === idx ? { ...o, phone: e.target.value } : o)),
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('admin.phPhoneSecondary')}
                          <input
                            className={adminFieldClass}
                            value={owner.phone_secondary}
                            onChange={(e) =>
                              setOwners((prev) =>
                                prev.map((o, i) =>
                                  i === idx ? { ...o, phone_secondary: e.target.value } : o,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('admin.bookShare')}
                          <input
                            className={shortFieldClass}
                            value={owner.ownership_share_percent}
                            onChange={(e) =>
                              setOwners((prev) =>
                                prev.map((o, i) =>
                                  i === idx ? { ...o, ownership_share_percent: e.target.value } : o,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-secondary">
                          {t('admin.bookOwnerIdeal')}
                          <input
                            className={shortFieldClass}
                            value={owner.ideal_parts_percent}
                            onChange={(e) =>
                              setOwners((prev) =>
                                prev.map((o, i) =>
                                  i === idx ? { ...o, ideal_parts_percent: e.target.value } : o,
                                ),
                              )
                            }
                          />
                        </label>
                        {owner.entity_kind === 'legal_entity' || owner.entity_kind === 'sole_trader' ? (
                          <>
                            <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
                              {t('admin.bookEntityName')}
                              <input
                                className={adminFieldClass}
                                value={owner.entity_name}
                                onChange={(e) =>
                                  setOwners((prev) =>
                                    prev.map((o, i) =>
                                      i === idx ? { ...o, entity_name: e.target.value } : o,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs text-secondary">
                              {t('admin.bookEik')}
                              <input
                                className={shortFieldClass}
                                value={owner.eik_bulstat}
                                onChange={(e) =>
                                  setOwners((prev) =>
                                    prev.map((o, i) =>
                                      i === idx ? { ...o, eik_bulstat: e.target.value } : o,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </>
                        ) : null}
                        {owner.entity_kind !== 'legal_entity' ? (
                          <>
                            <label className="grid gap-1 text-xs text-secondary">
                              {t('admin.bookFirstName')}
                              <input
                                className={adminFieldClass}
                                value={owner.first_name}
                                onChange={(e) =>
                                  setOwners((prev) =>
                                    prev.map((o, i) =>
                                      i === idx ? { ...o, first_name: e.target.value } : o,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs text-secondary">
                              {t('admin.bookLastName')}
                              <input
                                className={adminFieldClass}
                                value={owner.last_name}
                                onChange={(e) =>
                                  setOwners((prev) =>
                                    prev.map((o, i) =>
                                      i === idx ? { ...o, last_name: e.target.value } : o,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </>
                        ) : null}
                      </div>
                      {owners.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-danger hover:underline"
                          onClick={() => setOwners((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          {t('common.delete')}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h4 className="text-sm font-semibold">{t('admin.bookInvite')}</h4>
                <p className="text-xs text-secondary">{t('admin.bookInviteHint')}</p>
                {(() => {
                  const inviteable = owners.filter((o) => o.id != null && o.email.trim());
                  const withoutEmail = owners.filter((o) => o.id != null && !o.email.trim());
                  if (inviteable.length === 0) {
                    return (
                      <div className="space-y-1">
                        <p className="text-xs text-muted">{t('admin.bookInviteNoOwners')}</p>
                        {withoutEmail.length > 0 ? (
                          <p className="text-xs text-muted">{t('admin.bookEmailNotSet')}</p>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <ul className="space-y-1.5">
                      {inviteable.map((o) => {
                        const name = ownerDisplayName(o, o.email);
                        const latestInvite = invites.find((inv) => inv.registry_people_id === o.id);
                        const selected = inviteOwnerId === o.id;
                        return (
                          <li
                            key={o.id!}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 ${
                              selected ? 'border-accent/40' : 'border-border'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground" title={name}>
                                {name}
                              </p>
                              <p className="truncate text-xs text-muted">{o.email}</p>
                              {o.phone.trim() ? (
                                <p className="truncate text-xs text-muted">
                                  {t('admin.phPhonePrimary')}: {o.phone}
                                </p>
                              ) : null}
                              {o.phone_secondary.trim() ? (
                                <p className="truncate text-xs text-muted">
                                  {t('admin.phPhoneSecondary')}: {o.phone_secondary}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {latestInvite ? (
                                <StatusBadge
                                  label={t(
                                    `admin.bookInviteStatus_${latestInvite.status}` as 'admin.bookInviteStatus_pending',
                                  )}
                                  tone={
                                    latestInvite.status === 'accepted'
                                      ? 'success'
                                      : latestInvite.status === 'revoked' ||
                                          latestInvite.status === 'expired'
                                        ? 'warning'
                                        : 'info'
                                  }
                                />
                              ) : null}
                              <AdminSecondaryButton
                                type="button"
                                className="min-h-9 px-3 text-sm"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void createOwnerInvite(o.id!);
                                }}
                              >
                                {t('admin.bookInviteSend')}
                              </AdminSecondaryButton>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
                {inviteLink ? (
                  <p className="break-all text-xs text-muted">
                    {t('admin.bookInviteLink')}: {inviteLink}
                  </p>
                ) : null}
                {invites.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    <li className="text-xs font-medium uppercase tracking-wide text-muted">
                      {t('admin.bookInvites')}
                    </li>
                    {invites.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span>
                          {inv.email} ·{' '}
                          {t(
                            `admin.bookInviteStatus_${inv.status}` as 'admin.bookInviteStatus_pending',
                          )}
                        </span>
                        <span className="flex flex-wrap gap-3">
                          {(inv.status === 'pending' || inv.status === 'expired') &&
                          inv.registry_people_id != null ? (
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              disabled={busy}
                              onClick={() => {
                                void (async () => {
                                  setBusy(true);
                                  setError(null);
                                  try {
                                    const { data, error: rpcErr } = await supabase.rpc(
                                      'admin_resend_property_invite',
                                      { p_invite_id: inv.id },
                                    );
                                    if (rpcErr) throw rpcErr;
                                    const payload = data as {
                                      id?: string;
                                      token?: string;
                                      email?: string;
                                    };
                                    const token = String(payload.token ?? '');
                                    const link = buildInviteAbsoluteUrl(token);
                                    setInviteLink(link);
                                    let honesty = 'COPY_LINK';
                                    try {
                                      const notify = await emailCoreNotifyPb1Invite(supabase, {
                                        inviteId: String(payload.id ?? inv.id),
                                        toEmail: String(payload.email ?? inv.email),
                                        inviteLink: link,
                                        apartment: apartmentNumber || null,
                                        locale,
                                      });
                                      honesty = notify.honesty;
                                    } catch {
                                      /* keep COPY_LINK */
                                    }
                                    try {
                                      await navigator.clipboard.writeText(link);
                                    } catch {
                                      /* clipboard optional */
                                    }
                                    const linkMsg = t('admin.bookInviteLinkCopied');
                                    const emailMsg =
                                      honesty === 'ACCEPTED'
                                        ? t('admin.emailAcceptedByService')
                                        : honesty === 'QUEUED' || honesty === 'SENT'
                                          ? t('admin.bookInviteEmailQueued')
                                          : t('admin.bookInviteEmailNotSent');
                                    setSuccess(`${linkMsg} ${emailMsg}`);
                                    const { data: invData } = await supabase.rpc(
                                      'admin_list_property_invites',
                                      { p_property_id: selectedId as number },
                                    );
                                    setInvites(
                                      ((invData as Array<Record<string, unknown>>) ?? []).map(
                                        (i) => ({
                                          id: String(i.id),
                                          email: String(i.email ?? ''),
                                          status: String(i.status ?? ''),
                                          expires_at: String(i.expires_at ?? ''),
                                          created_at: String(i.created_at ?? ''),
                                          registry_people_id:
                                            i.registry_people_id != null
                                              ? Number(i.registry_people_id)
                                              : null,
                                        }),
                                      ),
                                    );
                                  } catch (e: unknown) {
                                    setError(ownerVisibleError(e, t('admin.errGeneric'), t));
                                  } finally {
                                    setBusy(false);
                                  }
                                })();
                              }}
                            >
                              {t('admin.bookInviteResend')}
                            </button>
                          ) : null}
                          {inv.status === 'pending' ? (
                            <button
                              type="button"
                              className="text-xs text-danger hover:underline"
                              disabled={busy}
                              onClick={() => {
                                void (async () => {
                                  setBusy(true);
                                  try {
                                    const { error: rpcErr } = await supabase.rpc(
                                      'admin_revoke_property_invite',
                                      { p_invite_id: inv.id },
                                    );
                                    if (rpcErr) throw rpcErr;
                                    await emailCoreCancelPb1InviteOutbox(supabase, inv.id);
                                    setInvites((prev) =>
                                      prev.map((x) =>
                                        x.id === inv.id ? { ...x, status: 'revoked' } : x,
                                      ),
                                    );
                                  } catch (e: unknown) {
                                    setError(ownerVisibleError(e, t('admin.errGeneric'), t));
                                  } finally {
                                    setBusy(false);
                                  }
                                })();
                              }}
                            >
                              {t('admin.bookInviteRevoke')}
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {cardTab === 'ideal' ? (
            <div className="space-y-4">
              {cardEditing ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-secondary">
                    {t('admin.bookIdealParts')}
                    <input
                      ref={idealPartsRef}
                      className={shortFieldClass}
                      value={idealParts}
                      onChange={(e) => setIdealParts(e.target.value)}
                    />
                    {fieldErrors.ideal_parts_percent ? (
                      <span className="text-xs text-danger">{fieldErrors.ideal_parts_percent}</span>
                    ) : null}
                  </label>
                  <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                    {t('admin.bookIdealSource')}
                    <input
                      className={midFieldClass}
                      value={idealPartsSource}
                      onChange={(e) => setIdealPartsSource(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                    {t('admin.bookIdealNote')}
                    <input
                      className={adminFieldClass}
                      value={idealPartsNote}
                      onChange={(e) => setIdealPartsNote(e.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className={`${adminInfoGridClass} text-sm`}>
                  <AdminInfoRow
                    label={t('admin.bookIdealParts')}
                    value={
                      idealParts.trim()
                        ? `${formatIdealPartsPercent(idealParts, locale) ?? idealParts} %`
                        : t('book.notSpecified')
                    }
                  />
                  <AdminInfoRow
                    label={t('admin.bookIdealSource')}
                    value={displayValue(idealPartsSource, t('book.notSpecified'))}
                  />
                  <AdminInfoRow
                    label={t('admin.bookIdealNote')}
                    value={displayValue(idealPartsNote, t('book.notSpecified'))}
                    className="md:col-span-2"
                  />
                </div>
              )}
              <div className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {t('admin.bookIdealOwnersSummary')}
                </p>
                <p className="mt-1 text-xs text-secondary">{t('admin.bookIdealOwnersSummaryHint')}</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {owners.map((o, idx) => {
                    const name = ownerDisplayName(o, `${t('admin.bookOwners')} ${idx + 1}`);
                    const idealFmt = formatIdealPartsPercent(o.ideal_parts_percent, locale);
                    const shareFmt = formatIdealPartsPercent(o.ownership_share_percent, locale);
                    return (
                      <li
                        key={o.id ?? idx}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1 last:border-0"
                      >
                        <span className="min-w-0 truncate text-foreground" title={name}>
                          {name}
                        </span>
                        <span className="tabular-nums text-secondary">
                          {o.ideal_parts_percent.trim()
                            ? `${t('admin.bookOwnerIdeal')}: ${idealFmt ?? o.ideal_parts_percent} %`
                            : `${t('admin.bookOwnerIdeal')}: —`}
                          {o.ownership_share_percent.trim()
                            ? ` · ${t('admin.bookShare')} ${shareFmt ?? o.ownership_share_percent}%`
                            : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : null}

          {cardTab === 'history' ? (
            <div className="space-y-3">
              {changeLog.length === 0 ? (
                <p className="text-xs text-muted">{t('admin.bookHistoryEmpty')}</p>
              ) : (
                <ul className="max-h-[28rem] space-y-2 overflow-auto">
                  {changeLog.map((entry) => {
                    const presented = presentPropertyBookHistoryEntry(entry, apartmentNumber, t);
                    return (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <p className="text-sm font-medium text-foreground">{presented.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {entry.changed_at
                            ? formatOwnerDateTime(entry.changed_at, locale)
                            : t('admin.bookHistEmptyValue')}
                          {entry.changed_by_email
                            ? ` · ${t('admin.bookHistoryBy')} ${entry.changed_by_email}`
                            : ''}
                        </p>
                        <ul className="mt-1.5 space-y-0.5 text-xs text-secondary">
                          {presented.details.map((line, idx) => (
                            <li key={`${entry.id}-${idx}`} className="leading-snug">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </AdminModal>

    </div>
  );
}
