'use client';

import { ApartmentPicker } from '@/components/ApartmentPicker';
import { labelOccupantKind } from '@/i18n/labels';
import { useI18n } from '@/i18n/I18nProvider';
import type { OccupantKind } from '@/lib/registry';
import type { ApartmentPet } from '@/lib/registry';
import { displayedPropertyOwners, type PropertyRegistryPerson } from '@/lib/propertyBook';
import { useEffect, useState } from 'react';

export type OccupancyStatus = 'owner' | 'standby' | 'rented';

export type OccupancyGuest = {
  id: number;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  birth_year: number | null;
  is_child: boolean;
  check_in: string | null;
  check_out: string | null;
  is_permanent?: boolean | null;
};

export type OccupancySavePayload = {
  occupancy_status: OccupancyStatus;
  occupant_kind: OccupantKind;
  occupant_name: string | null;
  occupant_phone: string | null;
  occupant_email: string | null;
  occupant_until: string | null;
};

export type GuestInsertPayload = {
  first_name: string;
  last_name: string;
  birth_year: number | null;
  is_child: boolean;
  is_permanent: boolean;
  check_in: string | null;
  check_out: string | null;
};

export type PetInsertPayload = {
  species: string;
  name: string | null;
  chip_no: string | null;
  passport_no: string | null;
  is_taken_to_public_places: boolean;
};

const emptyGuestForm = {
  first_name: '',
  last_name: '',
  birth_year: '',
  is_child: false,
  is_permanent: true,
  check_in: '',
  check_out: '',
};

function ConfirmBar({
  text,
  onYes,
  onNo,
}: {
  text: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-foreground">{text}</p>
      <button
        type="button"
        onClick={onYes}
        className="rounded-lg bg-danger-bg px-3 py-1.5 text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t('common.delete')}
      </button>
      <button
        type="button"
        onClick={onNo}
        className="rounded-lg border border-border px-3 py-1.5 text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}

export function OwnerOccupancy({
  apartmentNumber,
  properties,
  selectedId,
  occupancyStatus,
  occupantKind,
  occupantName,
  occupantPhone,
  occupantEmail,
  occupantUntil,
  ownerName,
  ownerEmail,
  registryPeople,
  bookRequestOpen,
  guests,
  pets,
  occupancySaving,
  guestAdding,
  petSaving,
  petsLoadFailed,
  onSelectProperty,
  onSaveStatus,
  onAddGuest,
  onUpdateGuest,
  onRemoveGuest,
  onAddPet,
  onRemovePet,
  onReportChange,
}: {
  apartmentNumber: string;
  properties: { id: number; apartment_number: string | number; area_sqm: number | null }[];
  selectedId: number | null;
  occupancyStatus: OccupancyStatus;
  occupantKind: OccupantKind;
  occupantName: string | null;
  occupantPhone: string | null;
  occupantEmail: string | null;
  occupantUntil: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  registryPeople: PropertyRegistryPerson[];
  bookRequestOpen?: boolean;
  guests: OccupancyGuest[];
  pets: ApartmentPet[];
  occupancySaving: boolean;
  guestAdding: boolean;
  petSaving: boolean;
  petsLoadFailed?: boolean;
  onSelectProperty: (id: number) => void;
  onSaveStatus: (payload: OccupancySavePayload) => Promise<void>;
  onAddGuest: (payload: GuestInsertPayload) => Promise<void>;
  onUpdateGuest: (id: number, payload: GuestInsertPayload) => Promise<void>;
  onRemoveGuest: (id: number) => Promise<void>;
  onAddPet: (payload: PetInsertPayload) => Promise<void>;
  onRemovePet: (id: number) => Promise<void>;
  onReportChange: (message: string) => Promise<void>;
}) {
  const { t, dateLocale } = useI18n();
  const [draft, setDraft] = useState<OccupancyStatus>(occupancyStatus);
  const [rentedKind, setRentedKind] = useState<OccupantKind>(
    occupantKind === 'owner' ? 'tenant' : occupantKind,
  );
  const [until, setUntil] = useState(occupantUntil ?? '');
  const [untilUnknown, setUntilUnknown] = useState(!occupantUntil);
  const [rentedCheckIn, setRentedCheckIn] = useState('');
  const [details, setDetails] = useState({
    name: occupantName ?? '',
    phone: occupantPhone ?? '',
    email: occupantEmail ?? '',
  });
  const [guestOpen, setGuestOpen] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<number | null>(null);
  const [petOpen, setPetOpen] = useState(false);
  const [guestForm, setGuestForm] = useState(emptyGuestForm);
  const [petForm, setPetForm] = useState({
    species: 'dog',
    name: '',
    chip_no: '',
    passport_no: '',
    is_taken_to_public_places: false,
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [petError, setPetError] = useState<string | null>(null);
  const [pendingGuestId, setPendingGuestId] = useState<number | null>(null);
  const [pendingPetId, setPendingPetId] = useState<number | null>(null);
  const [ownerChangeOpen, setOwnerChangeOpen] = useState(false);
  const [ownerChangeText, setOwnerChangeText] = useState('');
  const [ownerChangeSaving, setOwnerChangeSaving] = useState(false);
  const [ownerChangeError, setOwnerChangeError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(occupancyStatus);
    setRentedKind(occupantKind === 'owner' ? 'tenant' : occupantKind);
    setUntil(occupantUntil ?? '');
    setUntilUnknown(!occupantUntil);
    setRentedCheckIn('');
    setDetails({
      name: occupantName ?? '',
      phone: occupantPhone ?? '',
      email: occupantEmail ?? '',
    });
    setGuestOpen(false);
    setEditingGuestId(null);
    setGuestForm(emptyGuestForm);
  }, [occupancyStatus, occupantKind, occupantName, occupantPhone, occupantEmail, occupantUntil, selectedId]);

  const kindForSave: OccupantKind = draft === 'owner' ? 'owner' : draft === 'rented' ? rentedKind : occupantKind;
  const untilForSave =
    draft === 'standby' ? (untilUnknown ? null : until || null) : draft === 'rented' ? until || null : occupantUntil;
  const dirty =
    draft !== occupancyStatus ||
    (draft === 'rented' && rentedKind !== occupantKind) ||
    (draft === 'owner' && occupantKind !== 'owner') ||
    (draft === 'standby' && (untilForSave ?? '') !== (occupantUntil ?? '')) ||
    (draft === 'rented' &&
      ((details.name.trim() || null) !== (occupantName ?? null) ||
        (details.phone.trim() || null) !== (occupantPhone ?? null) ||
        (details.email.trim() || null) !== (occupantEmail ?? null) ||
        (until || null) !== (occupantUntil ?? null)));

  const peopleCount = guests.length;
  const displayedOwners = displayedPropertyOwners(
    { owner_name: ownerName, owner_email: ownerEmail },
    registryPeople,
  );
  const primaryOwnerName = displayedOwners.find((o) => o.name)?.name ?? null;
  const ownerNameMissing = displayedOwners.every((o) => !o.name);
  const summaryPeople =
    occupancyStatus === 'owner'
      ? peopleCount === 0
        ? t('account.occLiveAlone')
        : t('account.occYouPlusN', { n: String(peopleCount) })
      : occupancyStatus === 'rented'
        ? t('account.occResidentsN', { n: String(1 + peopleCount) })
        : peopleCount > 0
          ? t('account.occResidentsN', { n: String(peopleCount) })
          : null;
  const rentedPrimaryName = (details.name.trim() || occupantName || '').trim();

  function fmtDate(raw: string | null | undefined) {
    if (!raw) return null;
    return new Date(raw).toLocaleDateString(dateLocale);
  }

  function stayLabel(g: OccupancyGuest) {
    if (g.is_permanent !== false) return t('account.occPermanent');
    const from = fmtDate(g.check_in);
    const to = fmtDate(g.check_out);
    if (from && to) return t('account.occStayFromTo', { from, to });
    if (from) return `${t('account.checkIn')}: ${from}`;
    if (to) return `${t('account.checkOut')}: ${to}`;
    return t('account.occUntilUnknown');
  }

  function flash() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  }

  async function submitOwnerChange(e: React.FormEvent) {
    e.preventDefault();
    const msg = ownerChangeText.trim();
    if (msg.length < 8) {
      setOwnerChangeError(t('book.changeTooShort'));
      return;
    }
    setOwnerChangeSaving(true);
    setOwnerChangeError(null);
    try {
      await onReportChange(msg);
      setOwnerChangeText('');
      setOwnerChangeOpen(false);
      flash();
    } catch (err: unknown) {
      setOwnerChangeError(err instanceof Error ? err.message : t('err.save'));
    } finally {
      setOwnerChangeSaving(false);
    }
  }

  async function saveStatus() {
    setStatusError(null);
    try {
      await onSaveStatus({
        occupancy_status: draft,
        occupant_kind: kindForSave,
        occupant_name: draft === 'rented' ? details.name.trim() || null : occupantName,
        occupant_phone: draft === 'rented' ? details.phone.trim() || null : occupantPhone,
        occupant_email: draft === 'rented' ? details.email.trim() || null : occupantEmail,
        occupant_until: untilForSave,
      });
      flash();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : t('err.status'));
    }
  }

  function payloadFromForm(): GuestInsertPayload {
    return {
      first_name: guestForm.first_name.trim(),
      last_name: guestForm.last_name.trim(),
      birth_year: guestForm.birth_year ? Number(guestForm.birth_year) : null,
      is_child: guestForm.is_child,
      is_permanent: guestForm.is_permanent,
      check_in: guestForm.check_in || null,
      check_out: guestForm.is_permanent ? null : guestForm.check_out || null,
    };
  }

  async function submitGuest(e: React.FormEvent) {
    e.preventDefault();
    setGuestError(null);
    try {
      const payload = payloadFromForm();
      if (editingGuestId != null) {
        await onUpdateGuest(editingGuestId, payload);
      } else {
        await onAddGuest(payload);
      }
      setGuestForm(emptyGuestForm);
      setGuestOpen(false);
      setEditingGuestId(null);
      flash();
    } catch (err) {
      setGuestError(
        err instanceof Error
          ? err.message
          : editingGuestId != null
            ? t('err.updateGuest')
            : t('err.addGuest'),
      );
    }
  }

  function beginEdit(g: OccupancyGuest) {
    setEditingGuestId(g.id);
    setGuestOpen(true);
    setPendingGuestId(null);
    setGuestForm({
      first_name: g.first_name,
      last_name: g.last_name,
      birth_year: g.birth_year != null ? String(g.birth_year) : '',
      is_child: g.is_child,
      is_permanent: g.is_permanent !== false,
      check_in: g.check_in ? String(g.check_in).slice(0, 10) : '',
      check_out: g.check_out ? String(g.check_out).slice(0, 10) : '',
    });
  }

  async function submitPet(e: React.FormEvent) {
    e.preventDefault();
    setPetError(null);
    try {
      await onAddPet({
        species: petForm.species,
        name: petForm.name.trim() || null,
        chip_no: petForm.chip_no.trim() || null,
        passport_no: petForm.passport_no.trim() || null,
        is_taken_to_public_places: petForm.is_taken_to_public_places,
      });
      setPetForm({
        species: 'dog',
        name: '',
        chip_no: '',
        passport_no: '',
        is_taken_to_public_places: false,
      });
      setPetOpen(false);
      flash();
    } catch (err) {
      setPetError(err instanceof Error ? err.message : t('err.save'));
    }
  }

  const choices: { id: OccupancyStatus; title: string; hint: string }[] = [
    { id: 'owner', title: t('account.occOwner'), hint: t('account.occOwnerHint') },
    { id: 'standby', title: t('account.occStandby'), hint: t('account.occStandbyHint') },
    { id: 'rented', title: t('account.occRent'), hint: t('account.occRentHint') },
  ];

  const allowAddPeople = draft === 'owner' || draft === 'rented';
  const showPeople = draft === 'owner' || draft === 'rented' || guests.length > 0;
  const peopleTitle =
    draft === 'owner'
      ? t('account.occLivingWithYou')
      : draft === 'rented'
        ? t('account.occOtherResidents')
        : t('account.guests');

  return (
    <div className="space-y-4">
      <ApartmentPicker properties={properties} selectedId={selectedId} onSelect={onSelectProperty} />

      <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{t('account.occTitle')}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">
          {t('account.occNowLabel')}:{' '}
          {occupancyStatus === 'standby'
            ? t('account.occNowStandby')
            : occupancyStatus === 'rented'
              ? t('account.occNowRented')
              : t('account.occNowOwner')}
        </p>
        {occupancyStatus === 'owner' && primaryOwnerName ? (
          <p className="mt-1 text-sm font-medium text-foreground">{primaryOwnerName}</p>
        ) : occupancyStatus === 'rented' && rentedPrimaryName ? (
          <p className="mt-1 text-sm font-medium text-foreground">{rentedPrimaryName}</p>
        ) : null}
        {summaryPeople ? <p className="mt-1 text-sm text-secondary">{summaryPeople}</p> : null}
        <p className="mt-1 text-sm text-secondary">{t('account.occLead', { n: apartmentNumber })}</p>
        {savedFlash ? <p className="mt-2 text-sm text-success">✓ {t('account.occSaved')}</p> : null}
      </section>

      <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {choices.map((choice) => {
            const active = draft === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => setDraft(choice.id)}
                className={`rounded-xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  active ? 'border-accent bg-accent-bg' : 'border-border bg-background hover:bg-hover'
                }`}
              >
                <p className="text-sm font-medium text-foreground">{choice.title}</p>
                <p className="mt-1 text-xs text-muted">{choice.hint}</p>
              </button>
            );
          })}
        </div>
        {dirty ? (
          <button
            type="button"
            disabled={occupancySaving}
            onClick={() => void saveStatus()}
            className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {occupancySaving ? t('common.saving') : t('account.occSaveChanges')}
          </button>
        ) : null}
        {statusError ? <p className="mt-2 text-sm text-danger">{statusError}</p> : null}
      </section>

      {draft === 'owner' ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            {t('account.occWhoLives')}
          </p>
          <div className="mt-3 grid gap-2">
            {displayedOwners.map((o) => (
              <article key={o.key} className="rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-sm font-medium text-foreground">
                  {o.name || t('account.occOwnerNameMissing')}
                </p>
                <p className="mt-0.5 text-xs text-muted">{t('book.owner')}</p>
                {o.email ? <p className="mt-0.5 text-xs text-secondary">{o.email}</p> : null}
              </article>
            ))}
          </div>
          {ownerNameMissing ? (
            <div className="mt-3">
              {bookRequestOpen ? (
                <p className="text-sm text-warning">{t('book.changePending')}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => setOwnerChangeOpen((v) => !v)}
                  className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {t('book.reportChange')} →
                </button>
              )}
              {ownerChangeOpen && !bookRequestOpen ? (
                <form onSubmit={submitOwnerChange} className="mt-3 grid gap-2">
                  <textarea
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    rows={3}
                    placeholder={t('book.changePlaceholder')}
                    value={ownerChangeText}
                    onChange={(e) => setOwnerChangeText(e.target.value)}
                  />
                  {ownerChangeError ? <p className="text-sm text-danger">{ownerChangeError}</p> : null}
                  <button
                    type="submit"
                    disabled={ownerChangeSaving}
                    className="w-fit rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {ownerChangeSaving ? t('common.saving') : t('book.submitChange')}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {draft === 'standby' ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <p className="text-sm font-medium text-foreground">{t('account.occStandbyDates')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-secondary">
              {t('account.occUntil')}
              <input
                type="date"
                disabled={untilUnknown}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-secondary sm:mt-6">
              <input
                type="checkbox"
                className="accent-accent"
                checked={untilUnknown}
                onChange={(e) => {
                  setUntilUnknown(e.target.checked);
                  if (e.target.checked) setUntil('');
                }}
              />
              {t('account.occUntilUnknown')}
            </label>
          </div>
        </section>
      ) : null}

      {draft === 'rented' ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            {t('account.occWhoLives')}
          </p>
          {rentedPrimaryName ? (
            <article className="mt-3 rounded-xl border border-border bg-background px-3 py-3">
              <p className="text-sm font-medium text-foreground">{rentedPrimaryName}</p>
              <p className="mt-0.5 text-xs text-muted">{labelOccupantKind(rentedKind, t)}</p>
              {(details.email.trim() || occupantEmail) ? (
                <p className="mt-0.5 text-xs text-secondary">{details.email.trim() || occupantEmail}</p>
              ) : null}
            </article>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(['tenant', 'user'] as OccupantKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setRentedKind(kind)}
                className={`rounded-xl border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  rentedKind === kind ? 'border-accent bg-accent-bg font-medium' : 'border-border bg-background'
                }`}
              >
                {labelOccupantKind(kind, t)}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-1">
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={t('registry.occupantName')}
              value={details.name}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
            />
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={t('registry.occupantPhone')}
              value={details.phone}
              onChange={(e) => setDetails({ ...details, phone: e.target.value })}
            />
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={t('registry.occupantEmail')}
              type="email"
              value={details.email}
              onChange={(e) => setDetails({ ...details, email: e.target.value })}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-1">
            <label className="text-sm text-secondary">
              {t('account.checkIn')}
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={rentedCheckIn}
                onChange={(e) => setRentedCheckIn(e.target.value)}
              />
            </label>
            <label className="text-sm text-secondary">
              {t('account.checkOut')}
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </div>
        </section>
      ) : null}

      {showPeople ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {peopleTitle}
              {guests.length > 0 ? ` · ${guests.length}` : ''}
            </h3>
            {allowAddPeople ? (
              <button
                type="button"
                onClick={() => {
                  setEditingGuestId(null);
                  setGuestForm({ ...emptyGuestForm, check_in: rentedCheckIn });
                  setGuestOpen((v) => !v);
                }}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {t('account.occAddResidentPlus')}
              </button>
            ) : null}
          </div>
          {guests.length === 0 && !guestOpen ? (
            <p className="mt-2 text-sm text-secondary">
              {draft === 'owner' ? t('account.occLiveAlone') : t('account.guestsEmpty')}
            </p>
          ) : null}
          {guestOpen && allowAddPeople ? (
            <form onSubmit={submitGuest} className="mt-3 grid gap-3 sm:grid-cols-1">
              <input
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t('account.firstName')}
                value={guestForm.first_name}
                onChange={(e) => setGuestForm({ ...guestForm, first_name: e.target.value })}
              />
              <input
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t('account.lastName')}
                value={guestForm.last_name}
                onChange={(e) => setGuestForm({ ...guestForm, last_name: e.target.value })}
              />
              <input
                type="number"
                min="1900"
                max={new Date().getFullYear()}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t('account.birthYear')}
                value={guestForm.birth_year}
                onChange={(e) => setGuestForm({ ...guestForm, birth_year: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={guestForm.is_child}
                  onChange={(e) => setGuestForm({ ...guestForm, is_child: e.target.checked })}
                />
                {t('account.child')}
              </label>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={guestForm.is_permanent}
                  onChange={(e) => setGuestForm({ ...guestForm, is_permanent: e.target.checked })}
                />
                {t('account.occPermanent')}
              </label>
              <label className="text-sm text-secondary">
                {t('account.checkIn')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={guestForm.check_in}
                  onChange={(e) => setGuestForm({ ...guestForm, check_in: e.target.value })}
                />
              </label>
              {!guestForm.is_permanent ? (
                <label className="text-sm text-secondary">
                  {t('account.checkOut')}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={guestForm.check_out}
                    onChange={(e) => setGuestForm({ ...guestForm, check_out: e.target.value })}
                  />
                </label>
              ) : null}
              <button
                type="submit"
                disabled={guestAdding}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {guestAdding
                  ? t('common.saving')
                  : editingGuestId != null
                    ? t('common.save')
                    : t('account.occAddResidentPlus')}
              </button>
            </form>
          ) : null}
          {guestError ? <p className="mt-2 text-sm text-danger">{guestError}</p> : null}
          {guests.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {guests.map((g) => (
                <article key={g.id} className="rounded-xl border border-border bg-background px-3 py-3">
                  <p className="text-sm font-medium text-foreground">
                    {g.first_name} {g.last_name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {g.is_child
                      ? `${t('account.child')} · ${t('account.occHouseholdMember')}`
                      : t('account.occHouseholdMember')}
                  </p>
                  <p className="mt-0.5 text-xs text-secondary">{stayLabel(g)}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {allowAddPeople ? (
                      <button
                        type="button"
                        onClick={() => beginEdit(g)}
                        className="text-xs text-accent hover:underline"
                      >
                        {t('account.occEdit')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPendingGuestId(g.id)}
                      className="text-xs text-danger hover:underline"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                  {pendingGuestId === g.id ? (
                    <ConfirmBar
                      text={t('confirm.removeGuestNamed', { n: `${g.first_name} ${g.last_name}` })}
                      onNo={() => setPendingGuestId(null)}
                      onYes={() => {
                        void onRemoveGuest(g.id)
                          .then(() => {
                            setPendingGuestId(null);
                            if (editingGuestId === g.id) {
                              setEditingGuestId(null);
                              setGuestOpen(false);
                            }
                          })
                          .catch((err) =>
                            setGuestError(err instanceof Error ? err.message : t('err.removeGuest')),
                          );
                      }}
                    />
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{t('registry.petsTitle')}</h3>
          <button
            type="button"
            onClick={() => setPetOpen((v) => !v)}
            className="rounded-full border border-border px-3 py-1.5 text-sm text-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {t('account.addPetPlus')}
          </button>
        </div>
        {petsLoadFailed ? <p className="mt-2 text-sm text-danger">{t('account.petsLoadFail')}</p> : null}
        {pets.length === 0 && !petOpen ? <p className="mt-2 text-sm text-secondary">{t('account.petsEmpty')}</p> : null}
        {petOpen ? (
          <form onSubmit={submitPet} className="mt-3 grid gap-3 sm:grid-cols-1">
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={petForm.species}
              onChange={(e) => setPetForm({ ...petForm, species: e.target.value })}
            >
              <option value="dog">{t('registry.dog')}</option>
              <option value="cat">{t('registry.cat')}</option>
              <option value="other">{t('registry.otherPet')}</option>
            </select>
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder={t('registry.petName')}
              value={petForm.name}
              onChange={(e) => setPetForm({ ...petForm, name: e.target.value })}
            />
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder={t('registry.chip')}
              value={petForm.chip_no}
              onChange={(e) => setPetForm({ ...petForm, chip_no: e.target.value })}
            />
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder={t('book.vetPassport')}
              value={petForm.passport_no}
              onChange={(e) => setPetForm({ ...petForm, passport_no: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input
                type="checkbox"
                className="accent-accent"
                checked={petForm.is_taken_to_public_places}
                onChange={(e) => setPetForm({ ...petForm, is_taken_to_public_places: e.target.checked })}
              />
              {t('book.takenPublicYes')}
            </label>
            <button
              type="submit"
              disabled={petSaving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {petSaving ? t('common.saving') : t('registry.addPet')}
            </button>
          </form>
        ) : null}
        {petError ? <p className="mt-2 text-sm text-danger">{petError}</p> : null}
        {pets.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {pets.map((pet) => (
              <article key={pet.id} className="rounded-xl border border-border bg-background px-3 py-3 text-sm">
                <p className="font-medium text-foreground">
                  {pet.species === 'dog'
                    ? t('registry.dog')
                    : pet.species === 'cat'
                      ? t('registry.cat')
                      : t('registry.otherPet')}
                  {pet.name ? ` · ${pet.name}` : ''}
                </p>
                {pet.chip_no ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {t('registry.chip')}: {pet.chip_no}
                  </p>
                ) : null}
                {pet.passport_no ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {t('book.vetPassport')}: {pet.passport_no}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted">
                  {pet.is_taken_to_public_places ? t('book.takenPublicYes') : t('book.takenPublicNo')}
                </p>
                <button
                  type="button"
                  onClick={() => setPendingPetId(pet.id)}
                  className="mt-2 text-xs text-danger hover:underline"
                >
                  {t('common.delete')}
                </button>
                {pendingPetId === pet.id ? (
                  <ConfirmBar
                    text={t('confirm.removePetNamed', { n: pet.name || t('book.unnamedAnimal') })}
                    onNo={() => setPendingPetId(null)}
                    onYes={() => {
                      void onRemovePet(pet.id)
                        .then(() => setPendingPetId(null))
                        .catch((err) => setPetError(err instanceof Error ? err.message : t('err.delete')));
                    }}
                  />
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
