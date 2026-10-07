'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { Translate } from '@/i18n/translate';
import {
  electionSlotsPresentOnAgenda,
  type MeetingElectionType,
} from '@/lib/meetingCore';
import {
  adminFieldClass,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
} from '@/components/admin/AdminUi';
import { ownerVisibleError } from '@/lib/ownerError';

type OwnerOption = {
  picker_key: string;
  source: string;
  registry_people_id: number | null;
  staff_id: number | null;
  property_id: number | null;
  apartment_number: string | null;
  display_name: string;
};

type CandidateRow = Database['public']['Tables']['meeting_candidates']['Row'];
type SeatRow = Pick<Database['public']['Tables']['meeting_election_seats']['Row'], 'election_type' | 'seat_count'>;

function emptyTriple(): [string, string, string] {
  return ['', '', ''];
}

function aptSortKey(raw: string | null | undefined): [number, string] {
  const s = (raw ?? '').trim();
  const m = s.match(/^(\d+)/);
  return [m ? Number(m[1]) : Number.POSITIVE_INFINITY, s.toLowerCase()];
}

function sortOwnerOptions(rows: OwnerOption[]): OwnerOption[] {
  return [...rows].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'admin' ? 1 : -1;
    const [an, as] = aptSortKey(a.apartment_number);
    const [bn, bs] = aptSortKey(b.apartment_number);
    if (an !== bn) return an - bn;
    if (as !== bs) return as.localeCompare(bs, 'bg');
    return a.display_name.localeCompare(b.display_name, 'bg');
  });
}

function keysFromTriple(triple: [string, string, string]): string[] | null {
  const keys = triple.map((v) => v.trim()).filter(Boolean);
  if (keys.length !== 3) return null;
  if (new Set(keys).size !== 3) return null;
  return keys;
}

function pickerKeyForCandidate(c: CandidateRow): string {
  if (c.staff_id != null) return `admin:${c.staff_id}`;
  if (c.registry_people_id != null) return `owner:${c.registry_people_id}`;
  return '';
}

function SlotPickers({
  label,
  options,
  values,
  disabled,
  onChange,
  t,
}: {
  label: string;
  options: OwnerOption[];
  values: [string, string, string];
  disabled?: boolean;
  onChange: (next: [string, string, string]) => void;
  t: Translate;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid gap-2 md:grid-cols-3">
        {[0, 1, 2].map((idx) => (
          <label key={idx} className="grid gap-1 text-xs text-secondary">
            {t('docs.elecCandidateN', { n: String(idx + 1) })}
            <select
              className={adminFieldClass}
              disabled={disabled}
              value={values[idx]}
              onChange={(e) => {
                const next = [...values] as [string, string, string];
                next[idx] = e.target.value;
                onChange(next);
              }}
            >
              <option value="">{t('docs.elecPickOwner')}</option>
              {options.map((o) => (
                <option key={o.picker_key} value={o.picker_key}>
                  {o.source === 'admin'
                    ? `${t('docs.elecAdminBadge')} · ${o.display_name}`
                    : `${o.apartment_number ? `№${o.apartment_number} · ` : ''}${o.display_name}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

export function AdminMeetingElectionCandidates({
  supabase,
  meetingId,
  agenda,
  canWrite,
  locked,
  t,
  onChanged,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  meetingId: string;
  agenda: ReadonlyArray<{ title?: string | null }>;
  canWrite: boolean;
  locked: boolean;
  t: Translate;
  onChanged: () => void | Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const slots = useMemo(() => electionSlotsPresentOnAgenda(agenda), [agenda]);
  const editable = canWrite && !locked;

  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [controlMode, setControlMode] = useState<'controller' | 'board'>('controller');
  const [mgmtSeatDraft, setMgmtSeatDraft] = useState('3');
  const [ctrlSeatDraft, setCtrlSeatDraft] = useState('3');

  const [chair, setChair] = useState<[string, string, string]>(emptyTriple);
  const [secretary, setSecretary] = useState<[string, string, string]>(emptyTriple);
  const [controller, setController] = useState<[string, string, string]>(emptyTriple);
  const [boardSlots, setBoardSlots] = useState<Record<string, [string, string, string]>>({});

  const hasChair = slots.some((s) => s.electionType === 'meeting_chair');
  const hasSecretary = slots.some((s) => s.electionType === 'meeting_secretary');
  const hasControl = slots.some((s) => s.templateKey === 'control_election');
  const hasMgmt = slots.some((s) => s.electionType === 'management_board');

  const mgmtSeatCount = seats.find((s) => s.election_type === 'management_board')?.seat_count ?? null;
  const ctrlSeatCount = seats.find((s) => s.election_type === 'control_board')?.seat_count ?? null;

  const load = useCallback(async () => {
    const [ownersRes, candRes, seatRes] = await Promise.all([
      supabase.rpc('gm_list_owner_candidates'),
      supabase
        .from('meeting_candidates')
        .select('id,meeting_id,election_type,display_name,registry_people_id,staff_id,status,agenda_item_id,locked_at,created_at,seat_index,sort_order')
        .eq('meeting_id', meetingId),
      supabase
        .from('meeting_election_seats')
        .select('election_type,seat_count')
        .eq('meeting_id', meetingId),
    ]);

    if (ownersRes.error) {
      onError(ownerVisibleError(ownersRes.error.message, t('admin.errGeneric')));
      return;
    }
    setOwners(sortOwnerOptions((ownersRes.data ?? []) as OwnerOption[]));

    if (candRes.error) setCandidates([]);
    else setCandidates((candRes.data ?? []) as CandidateRow[]);

    if (seatRes.error) {
      setSeats([]);
    } else {
      const nextSeats = (seatRes.data ?? []) as SeatRow[];
      setSeats(nextSeats);
      const mgmt = nextSeats.find((s) => s.election_type === 'management_board');
      const ctrl = nextSeats.find((s) => s.election_type === 'control_board');
      if (mgmt) setMgmtSeatDraft(String(mgmt.seat_count));
      if (ctrl) {
        setCtrlSeatDraft(String(ctrl.seat_count));
        setControlMode('board');
      } else {
        setControlMode('controller');
      }
    }
  }, [meetingId, onError, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function tripleFor(type: string, seat: number | null): [string, string, string] {
      const rows = candidates
        .filter((c) => c.election_type === type && c.seat_index === seat)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      return [
        rows[0] ? pickerKeyForCandidate(rows[0]) : '',
        rows[1] ? pickerKeyForCandidate(rows[1]) : '',
        rows[2] ? pickerKeyForCandidate(rows[2]) : '',
      ];
    }
    setChair(tripleFor('meeting_chair', null));
    setSecretary(tripleFor('meeting_secretary', null));
    setController(tripleFor('controller', null));

    const next: Record<string, [string, string, string]> = {};
    for (const type of ['management_board', 'control_board'] as const) {
      const n = seats.find((s) => s.election_type === type)?.seat_count ?? 0;
      for (let i = 1; i <= n; i += 1) {
        next[`${type}:${i}`] = tripleFor(type, i);
      }
    }
    setBoardSlots(next);
  }, [candidates, seats]);

  async function saveSlot(
    electionType: MeetingElectionType,
    seatIndex: number | null,
    triple: [string, string, string],
  ) {
    const keys = keysFromTriple(triple);
    if (!keys) {
      onError(t('docs.elecNeedThreeDistinct'));
      return;
    }
    setBusy(true);
    onError(null);
    const { error } = await supabase.rpc('gm_set_meeting_slot_candidates', {
      p_meeting_id: meetingId,
      p_election_type: electionType,
      p_seat_index: seatIndex,
      p_picker_keys: keys,
    });
    setBusy(false);
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    await load();
    await onChanged();
  }

  async function saveSeatCount(electionType: 'management_board' | 'control_board', raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 21) {
      onError(t('docs.elecSeatCountInvalid'));
      return;
    }
    setBusy(true);
    onError(null);
    const { error } = await supabase.rpc('gm_set_election_seat_count', {
      p_meeting_id: meetingId,
      p_election_type: electionType,
      p_seat_count: n,
    });
    setBusy(false);
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    if (electionType === 'control_board') setControlMode('board');
    await load();
    await onChanged();
  }

  async function switchControlToController() {
    setBusy(true);
    onError(null);
    const { error } = await supabase.rpc('gm_clear_election_seat_count', {
      p_meeting_id: meetingId,
      p_election_type: 'control_board',
    });
    setBusy(false);
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    setControlMode('controller');
    await load();
    await onChanged();
  }

  if (slots.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{t('docs.elecTitle')}</p>
        <p className="text-xs text-muted">{t('docs.elecHint')}</p>
      </div>
      {!editable ? (
        <AdminInlineAlert tone="info">{t('docs.elecLockedHint')}</AdminInlineAlert>
      ) : null}

      {hasChair ? (
        <div className="space-y-2">
          <SlotPickers
            label={t('docs.elecChair')}
            options={owners}
            values={chair}
            disabled={!editable || busy}
            onChange={setChair}
            t={t}
          />
          {editable ? (
            <AdminSecondaryButton
              type="button"
              disabled={busy}
              onClick={() => void saveSlot('meeting_chair', null, chair)}
            >
              {t('docs.elecSaveSlot')}
            </AdminSecondaryButton>
          ) : null}
        </div>
      ) : null}

      {hasSecretary ? (
        <div className="space-y-2">
          <SlotPickers
            label={t('docs.elecSecretary')}
            options={owners}
            values={secretary}
            disabled={!editable || busy}
            onChange={setSecretary}
            t={t}
          />
          {editable ? (
            <AdminSecondaryButton
              type="button"
              disabled={busy}
              onClick={() => void saveSlot('meeting_secretary', null, secretary)}
            >
              {t('docs.elecSaveSlot')}
            </AdminSecondaryButton>
          ) : null}
        </div>
      ) : null}

      {hasControl ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">{t('docs.elecControl')}</p>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <AdminSecondaryButton
                type="button"
                disabled={busy || controlMode === 'controller'}
                onClick={() => void switchControlToController()}
              >
                {t('docs.elecModeController')}
              </AdminSecondaryButton>
              <AdminSecondaryButton
                type="button"
                disabled={busy || controlMode === 'board'}
                onClick={() => setControlMode('board')}
              >
                {t('docs.elecModeBoard')}
              </AdminSecondaryButton>
            </div>
          ) : null}

          {controlMode === 'controller' ? (
            <>
              <SlotPickers
                label={t('docs.elecController')}
                options={owners}
                values={controller}
                disabled={!editable || busy}
                onChange={setController}
                t={t}
              />
              {editable ? (
                <AdminSecondaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void saveSlot('controller', null, controller)}
                >
                  {t('docs.elecSaveSlot')}
                </AdminSecondaryButton>
              ) : null}
            </>
          ) : (
            <>
              <label className="grid max-w-[12rem] gap-1 text-xs text-secondary">
                {t('docs.elecSeatCount')}
                <input
                  className={adminFieldClass}
                  type="number"
                  min={1}
                  max={21}
                  disabled={!editable || busy}
                  value={ctrlSeatDraft}
                  onChange={(e) => setCtrlSeatDraft(e.target.value)}
                />
              </label>
              {editable ? (
                <AdminPrimaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void saveSeatCount('control_board', ctrlSeatDraft)}
                >
                  {t('docs.elecSaveSeats')}
                </AdminPrimaryButton>
              ) : null}
              {ctrlSeatCount
                ? Array.from({ length: ctrlSeatCount }, (_, i) => i + 1).map((seat) => {
                    const key = `control_board:${seat}`;
                    const values = boardSlots[key] ?? emptyTriple();
                    return (
                      <div key={key} className="space-y-2">
                        <SlotPickers
                          label={t('docs.elecSeatN', { n: String(seat) })}
                          options={owners}
                          values={values}
                          disabled={!editable || busy}
                          onChange={(next) => setBoardSlots((prev) => ({ ...prev, [key]: next }))}
                          t={t}
                        />
                        {editable ? (
                          <AdminSecondaryButton
                            type="button"
                            disabled={busy}
                            onClick={() => void saveSlot('control_board', seat, values)}
                          >
                            {t('docs.elecSaveSlot')}
                          </AdminSecondaryButton>
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </>
          )}
        </div>
      ) : null}

      {hasMgmt ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">{t('docs.elecMgmtBoard')}</p>
          <label className="grid max-w-[12rem] gap-1 text-xs text-secondary">
            {t('docs.elecSeatCount')}
            <input
              className={adminFieldClass}
              type="number"
              min={1}
              max={21}
              disabled={!editable || busy}
              value={mgmtSeatDraft}
              onChange={(e) => setMgmtSeatDraft(e.target.value)}
            />
          </label>
          {editable ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void saveSeatCount('management_board', mgmtSeatDraft)}
            >
              {t('docs.elecSaveSeats')}
            </AdminPrimaryButton>
          ) : null}
          {mgmtSeatCount ? (
            Array.from({ length: mgmtSeatCount }, (_, i) => i + 1).map((seat) => {
              const key = `management_board:${seat}`;
              const values = boardSlots[key] ?? emptyTriple();
              return (
                <div key={key} className="space-y-2">
                  <SlotPickers
                    label={t('docs.elecSeatN', { n: String(seat) })}
                    options={owners}
                    values={values}
                    disabled={!editable || busy}
                    onChange={(next) => setBoardSlots((prev) => ({ ...prev, [key]: next }))}
                    t={t}
                  />
                  {editable ? (
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy}
                      onClick={() => void saveSlot('management_board', seat, values)}
                    >
                      {t('docs.elecSaveSlot')}
                    </AdminSecondaryButton>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-muted">{t('docs.elecSetSeatsFirst')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
