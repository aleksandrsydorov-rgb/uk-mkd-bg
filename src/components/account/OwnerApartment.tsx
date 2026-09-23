'use client';

import { ApartmentPicker } from '@/components/ApartmentPicker';
import { listingStatus } from '@/lib/ownership';
import {
  labelIdealPartsSource,
  labelListing,
  labelOccupancy,
  labelOccupantKind,
  labelOwnerType,
  labelRegistryRelation,
} from '@/i18n/labels';
import { useI18n } from '@/i18n/I18nProvider';
import type { ApartmentPet } from '@/lib/registry';
import { householdPeople } from '@/lib/registry';
import {
  displayedPropertyOwners,
  formatIdealPartsPercent,
  registryPersonLabel,
  type PropertyAbsencePeriod,
  type PropertyRegistryPerson,
} from '@/lib/propertyBook';
import type { Database } from '@/lib/database.types';
import { useEffect, useId, useState, type ReactNode } from 'react';

type Property = Database['public']['Tables']['properties']['Row'];
type AptTab = 'object' | 'people' | 'residency' | 'animals' | 'extra';

type Guest = {
  id: number;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  is_permanent?: boolean | null;
  check_in: string | null;
  check_out: string | null;
};

type PersonItem = { key: string; name: string; role: string; lines: string[] };

function PersonCard({ name, role, lines }: { name: string; role: string; lines: string[] }) {
  return (
    <article className="rounded-xl border border-border bg-background px-3 py-3">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <p className="mt-0.5 text-xs text-muted">{role}</p>
      {lines.map((line) => (
        <p key={line} className="mt-0.5 text-sm text-secondary">
          {line}
        </p>
      ))}
    </article>
  );
}

export function OwnerApartment({
  property,
  properties,
  occupancyStatus,
  guests,
  pets,
  people,
  absences,
  bookRequestOpen,
  listingSaving,
  onSelectProperty,
  onOpenOccupancy,
  onReportChange,
  onUpdateListing,
  extra,
}: {
  property: Property;
  properties: Pick<Property, 'id' | 'apartment_number' | 'area_sqm'>[];
  occupancyStatus: string;
  guests: Guest[];
  pets: ApartmentPet[];
  people: PropertyRegistryPerson[];
  absences: PropertyAbsencePeriod[];
  bookRequestOpen: boolean;
  listingSaving: boolean;
  onSelectProperty: (id: number) => void;
  onOpenOccupancy: () => void;
  onReportChange: (message: string) => Promise<void>;
  onUpdateListing: (next: 'в собственности' | 'на продаже') => void;
  extra?: ReactNode;
}) {
  const { t, locale, dateLocale } = useI18n();
  const tabsId = useId();
  const [tab, setTab] = useState<AptTab>('object');
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeText, setChangeText] = useState('');
  const [changeSaving, setChangeSaving] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  useEffect(() => {
    setTab('object');
    setChangeOpen(false);
    setTransferOpen(false);
  }, [property.id]);

  const owners = people.filter((p) => p.relation_type === 'owner');
  const users = people.filter((p) => p.relation_type === 'user_of_property');
  const bookHousehold = people.filter((p) => p.relation_type === 'household_member');
  const occupants = people.filter((p) => p.relation_type === 'occupant');
  const ownerModeGuests = occupancyStatus === 'owner';
  const household = ownerModeGuests ? guests : householdPeople(guests);
  const guestOccupants = ownerModeGuests ? [] : guests.filter((g) => g.is_permanent === false);

  const ideal = formatIdealPartsPercent(property.ideal_parts_percent, locale);
  const listing = listingStatus(property.status);
  const purpose = (property.purpose ?? '').trim();
  const sourceLabel = labelIdealPartsSource(property.ideal_parts_source, t);
  const meetingRef = (property.ideal_parts_meeting_ref ?? '').trim();
  const idealNote = (property.ideal_parts_note ?? '').trim();
  const agreement = (property.owner_user_management_agreement ?? '').trim();

  const displayedOwners = displayedPropertyOwners(property, people);
  const personItems: PersonItem[] = [];
  if (owners.length === 0 && users.length === 0) {
    for (const o of displayedOwners) {
      personItems.push({
        key: o.key,
        name: o.name || t('account.occOwnerNameMissing'),
        role: t('book.owner'),
        lines: [
          property.owner_type ? labelOwnerType(property.owner_type, t) : '',
          property.company_name || '',
          o.email || '',
        ].filter(Boolean),
      });
    }
    if (property.occupant_kind && property.occupant_kind !== 'owner') {
      personItems.push({
        key: 'portal-user',
        name: property.occupant_name || '—',
        role: labelOccupantKind(property.occupant_kind, t),
        lines: [
          property.occupant_email || '',
          property.occupant_until
            ? `${t('book.deregisteredAt')}: ${fmtDate(property.occupant_until)}`
            : '',
        ].filter(Boolean),
      });
    }
  } else {
    for (const o of displayedOwners) {
      const src = owners.find((p) => o.key === `reg-owner-${p.id}`);
      personItems.push({
        key: o.key,
        name: o.name || t('account.occOwnerNameMissing'),
        role: labelRegistryRelation('owner', t),
        lines: [
          src && (src.entity_kind === 'legal_entity' || src.entity_kind === 'sole_trader')
            ? `${t('book.eik')}: ${src.eik_bulstat || '—'}`
            : '',
          o.email || '',
        ].filter(Boolean),
      });
    }
    for (const p of users) {
      personItems.push({
        key: `u-${p.id}`,
        name: registryPersonLabel(p),
        role: labelRegistryRelation('user_of_property', t),
        lines: [p.email || ''].filter(Boolean),
      });
    }
  }
  for (const p of bookHousehold) {
    personItems.push({
      key: `bh-${p.id}`,
      name: registryPersonLabel(p),
      role: labelRegistryRelation('household_member', t),
      lines: [p.lives_on_property === false ? t('book.notLiving') : t('book.living')],
    });
  }
  for (const g of household) {
    personItems.push({
      key: `g-${g.id}`,
      name: [g.first_name, g.middle_name, g.last_name].filter(Boolean).join(' '),
      role: labelRegistryRelation('household_member', t),
      lines: [t('book.living')],
    });
  }
  for (const p of occupants) {
    personItems.push({
      key: `oc-${p.id}`,
      name: registryPersonLabel(p),
      role: labelRegistryRelation('occupant', t),
      lines: [
        `${t('book.registeredAt')}: ${fmtDate(p.registered_at)}`,
        `${t('book.deregisteredAt')}: ${p.deregistered_at ? fmtDate(p.deregistered_at) : t('book.stillRegistered')}`,
      ],
    });
  }
  for (const g of guestOccupants) {
    personItems.push({
      key: `go-${g.id}`,
      name: [g.first_name, g.middle_name, g.last_name].filter(Boolean).join(' '),
      role: labelRegistryRelation('occupant', t),
      lines: [
        `${t('book.registeredAt')}: ${fmtDate(g.check_in)}`,
        `${t('book.deregisteredAt')}: ${g.check_out ? fmtDate(g.check_out) : t('book.stillRegistered')}`,
      ],
    });
  }

  const occupantRows = [
    ...occupants.map((p) => ({
      key: `or-${p.id}`,
      name: registryPersonLabel(p),
      in: p.registered_at,
      out: p.deregistered_at,
    })),
    ...guestOccupants.map((g) => ({
      key: `gor-${g.id}`,
      name: [g.first_name, g.middle_name, g.last_name].filter(Boolean).join(' '),
      in: g.check_in,
      out: g.check_out,
    })),
  ];

  const tabs: { id: AptTab; label: string }[] = [
    { id: 'object', label: t('book.tabObject') },
    { id: 'people', label: t('book.tabPeople') },
    { id: 'residency', label: t('book.tabResidency') },
    { id: 'animals', label: t('book.tabAnimals') },
    { id: 'extra', label: t('book.tabExtra') },
  ];

  function fmtDate(raw: string | null | undefined) {
    if (!raw) return '—';
    return new Date(raw).toLocaleDateString(dateLocale);
  }

  async function submitChange(e: React.FormEvent) {
    e.preventDefault();
    const msg = changeText.trim();
    if (msg.length < 8) {
      setChangeError(t('book.changeTooShort'));
      return;
    }
    setChangeSaving(true);
    setChangeError(null);
    try {
      await onReportChange(msg);
      setChangeText('');
      setChangeOpen(false);
    } catch (err: unknown) {
      setChangeError(err instanceof Error ? err.message : t('err.save'));
    } finally {
      setChangeSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <ApartmentPicker
        properties={properties}
        selectedId={property.id}
        onSelect={onSelectProperty}
      />

      <header className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
        <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {t('book.aptTitle', { n: String(property.apartment_number ?? '—') })}
        </h2>
        <p className="mt-1 text-sm text-secondary">
          {property.area_sqm != null ? `${property.area_sqm} ${t('common.sqm')}` : t('account.areaUnknown')}
          {' · '}
          {property.floor != null ? t('account.floorN', { n: property.floor }) : t('account.floorUnknown')}
        </p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted">{t('account.occupancy')}:</dt>
            <dd className="font-medium text-foreground">{labelOccupancy(occupancyStatus, t)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted">{t('book.idealParts')}:</dt>
            <dd className="font-medium text-foreground">{ideal ? `${ideal} %` : t('book.idealUnknown')}</dd>
          </div>
        </dl>
        {ideal == null ? <p className="mt-1 text-xs text-muted">{t('book.idealHint')}</p> : null}
        <button
          type="button"
          onClick={() => setChangeOpen((v) => !v)}
          className="mt-3 rounded-full border border-border bg-background px-4 py-2 text-sm text-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {t('book.reportChange')}
        </button>
        {bookRequestOpen ? <p className="mt-2 text-xs text-warning">{t('book.changePending')}</p> : null}
        {changeOpen ? (
          <form onSubmit={submitChange} className="mt-3 space-y-2">
            <p className="text-xs text-muted">{t('book.changeHint')}</p>
            <textarea
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              rows={3}
              value={changeText}
              onChange={(e) => setChangeText(e.target.value)}
              placeholder={t('book.changePlaceholder')}
              required
            />
            {changeError ? <p className="text-xs text-danger">{changeError}</p> : null}
            <button
              type="submit"
              disabled={changeSaving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {changeSaving ? t('account.sending') : t('book.submitChange')}
            </button>
          </form>
        ) : null}
      </header>

      <div>
        <div
          role="tablist"
          aria-label={t('account.apt')}
          className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible"
        >
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${tabsId}-${item.id}`}
                aria-selected={selected}
                aria-controls={`${tabsId}-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const i = tabs.findIndex((x) => x.id === tab);
                  const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
                  setTab(tabs[next].id);
                  const el = document.getElementById(`${tabsId}-${tabs[next].id}`);
                  el?.focus();
                }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  selected
                    ? 'bg-accent text-white'
                    : 'border border-border bg-surface text-secondary hover:bg-hover'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${tabsId}-panel-${tab}`}
          aria-labelledby={`${tabsId}-${tab}`}
          className="mt-3 rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5"
        >
          {tab === 'object' ? (
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-xs text-muted">{t('book.number')}</dt>
                <dd className="font-medium text-foreground">{String(property.apartment_number ?? '—')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('common.floor')}</dt>
                <dd className="font-medium text-foreground">
                  {property.floor != null ? String(property.floor) : t('book.notSpecified')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('book.purpose')}</dt>
                <dd className="font-medium text-foreground">{purpose || t('book.notSpecified')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('book.builtArea')}</dt>
                <dd className="font-medium text-foreground">
                  {property.area_sqm != null
                    ? `${property.area_sqm} ${t('common.sqm')}`
                    : t('book.notSpecified')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('book.idealParts')}</dt>
                <dd className="font-medium text-foreground">{ideal ? `${ideal} %` : t('book.idealUnknown')}</dd>
                {ideal == null ? <p className="mt-0.5 text-xs text-muted">{t('book.idealHint')}</p> : null}
              </div>
              {sourceLabel ? (
                <div>
                  <dt className="text-xs text-muted">{t('book.idealSource')}</dt>
                  <dd className="font-medium text-foreground">{sourceLabel}</dd>
                </div>
              ) : null}
              {idealNote ? (
                <div>
                  <dt className="text-xs text-muted">{t('book.idealNote')}</dt>
                  <dd className="text-secondary">{idealNote}</dd>
                </div>
              ) : null}
              {meetingRef ? (
                <div>
                  <dt className="text-xs text-muted">{t('book.meetingRef')}</dt>
                  <dd className="text-secondary">{meetingRef}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {tab === 'people' ? (
            personItems.length === 0 ? (
              <p className="text-sm text-secondary">{t('book.peopleEmpty')}</p>
            ) : (
              <div className="grid gap-2">
                {personItems.map((item) => (
                  <PersonCard key={item.key} name={item.name} role={item.role} lines={item.lines} />
                ))}
              </div>
            )
          ) : null}

          {tab === 'residency' ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted">{t('account.occupancy')}</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{labelOccupancy(occupancyStatus, t)}</p>
                <button
                  type="button"
                  onClick={onOpenOccupancy}
                  className="mt-2 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {t('book.openOccupancy')} →
                </button>
              </div>
              <div>
                <p className="text-xs text-muted">{t('book.absence')}</p>
                {absences.length === 0 ? (
                  <p className="mt-1 text-sm text-secondary">{t('book.absenceEmpty')}</p>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {absences.map((a) => (
                      <PersonCard
                        key={a.id}
                        name={`${fmtDate(a.from_date)} — ${a.to_date ? fmtDate(a.to_date) : '…'}`}
                        role={t('book.absence')}
                        lines={a.note ? [a.note] : []}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted">{t('book.occupantsLongStay')}</p>
                {occupantRows.length === 0 ? (
                  <p className="mt-1 text-sm text-secondary">{t('book.occupantsEmpty')}</p>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {occupantRows.map((row) => (
                      <PersonCard
                        key={row.key}
                        name={row.name}
                        role={labelRegistryRelation('occupant', t)}
                        lines={[
                          `${t('book.registeredAt')}: ${fmtDate(row.in)}`,
                          `${t('book.deregisteredAt')}: ${row.out ? fmtDate(row.out) : t('book.stillRegistered')}`,
                        ]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === 'animals' ? (
            pets.length === 0 ? (
              <p className="text-sm text-secondary">{t('book.animalsEmpty')}</p>
            ) : (
              <div className="grid gap-2">
                {pets.map((pet) => (
                  <article key={pet.id} className="rounded-xl border border-border bg-background px-3 py-3 text-sm">
                    <p className="font-medium text-foreground">
                      {pet.species === 'dog'
                        ? t('registry.dog')
                        : pet.species === 'cat'
                          ? t('registry.cat')
                          : t('registry.otherPet')}
                    </p>
                    <p className="mt-0.5 text-secondary">{pet.name || t('book.unnamedAnimal')}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {pet.is_taken_to_public_places ? t('book.takenPublicYes') : t('book.takenPublicNo')}
                    </p>
                    {pet.passport_no ? (
                      <p className="mt-0.5 text-xs text-muted">
                        {t('book.vetPassport')}: {pet.passport_no}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )
          ) : null}

          {tab === 'extra' ? (
            <div className="space-y-3">
              {agreement ? (
                <div>
                  <p className="text-xs text-muted">{t('book.agreement')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-secondary">{agreement}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-muted">{t('account.objectStatus')}</p>
                <div className="mt-2 inline-flex w-full rounded-full bg-background p-1 sm:w-auto">
                  <button
                    type="button"
                    disabled={listingSaving}
                    onClick={() => onUpdateListing('в собственности')}
                    className={`flex-1 rounded-full px-4 py-2 text-sm transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex-none ${
                      listing === 'в собственности' ? 'bg-accent-bg text-accent' : 'text-secondary'
                    }`}
                  >
                    {labelListing('в собственности', t)}
                  </button>
                  <button
                    type="button"
                    disabled={listingSaving}
                    onClick={() => onUpdateListing('на продаже')}
                    className={`flex-1 rounded-full px-4 py-2 text-sm transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex-none ${
                      listing === 'на продаже' ? 'bg-warning/20 text-warning' : 'text-secondary'
                    }`}
                  >
                    {labelListing('на продаже', t)}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTransferOpen((v) => !v)}
                aria-expanded={transferOpen}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">{t('account.ownerTransfer')}</span>
                  <span className="block text-xs text-secondary">{t('account.ownerTransferHint')}</span>
                </span>
                <span className="text-muted" aria-hidden>
                  →
                </span>
              </button>
              {transferOpen ? extra : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
